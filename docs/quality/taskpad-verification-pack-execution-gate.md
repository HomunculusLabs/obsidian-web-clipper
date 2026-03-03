# TASKPAD Verification Pack Execution Gate Contract

## Purpose

Define a deterministic execution gate contract that evaluates verification-pack command sets against current repo state before Builder handoff. This gate provides runtime-proof that commands in the newest verification pack can execute successfully.

## Problem Statement

Current intake safeguards (`taskpad:planned-command-parity`, `verification-pack` contract/readiness checks, and history telemetry) validate structure and liveness, but they do not prove that the newest verification-pack command set can execute successfully in the current repo state. This leaves a false-green path: a pack can be syntactically valid while at least one referenced command fails at runtime, causing Builder-loop stalls after handoff.

## Input Sources

The execution gate requires the following inputs:

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `--taskpad <path>` | `string` | ✅ | Path to TASKPAD.md markdown file |
| `--plan <path>` | `string` | ✅ | Path to IMPLEMENTATION_PLAN.md markdown file |
| `--pack <path>` | `string` | ✅ | Path to verification pack JSON file |
| `--package <path>` | `string` | ✅ | Path to package.json for command resolution |

### Input Resolution Order

Commands are resolved in this order:
1. **package.json scripts**: Check if command matches a script name (e.g., `typecheck`, `test`)
2. **Direct tool paths**: Check if command resolves to a `.ts` file in `tools/` directory
3. **Bun run patterns**: Parse `bun run <script>` patterns and resolve to package.json scripts
4. **Bun test patterns**: Parse `bun test <file>` patterns and resolve to test files

## Allowed Command Policy

The execution gate enforces a bounded execution policy for safety and determinism.

### Allowed Command Classes

| Command Class | Pattern | Examples | Constraints |
|---------------|---------|----------|-------------|
| `package-script` | `bun run <script>` or `<script>` | `typecheck`, `test`, `lint` | Must exist in `package.json scripts` |
| `test-runner` | `bun test <pattern>` | `bun test tests/tools/*.test.ts` | Test files must exist, glob patterns expanded |
| `tool-entry` | `bun run tools/<tool>.ts` | `bun run tools/taskpad-queue-health.ts` | Tool file must exist in `tools/` |
| `verification-command` | `bun run <name>` (verification tools) | `bun run taskpad:verification-pack` | Must be a known verification tool |

### Guarded Invocation Rules

| Rule | Description |
|------|-------------|
| **G001_TIMEOUT_BOUND** | All commands have a maximum execution timeout (default: 30s per command) |
| **G002_STDOUT_CAPTURE** | stdout/stderr are captured up to 1MB total (prevents runaway output) |
| **G003_NO_MUTATION** | Commands are not allowed to modify input files (read-only execution mode) |
| **G004_DETERMINISTIC_CWD** | Commands execute from the project root directory (deterministic working dir) |
| **G005_ENV_SANITIZED** | Only a allowlisted set of environment variables is passed to commands |

### Disallowed Command Classes

| Command Class | Reason |
|---------------|--------|
| `network-fetch` | External network calls break determinism |
| `file-write` | Mutating files during gate violates read-only contract |
| `shell-exec` | Direct shell execution (`sh`, `bash`, etc.) is unsafe |
| `interactive` | Commands requiring stdin are disallowed |

## Deterministic Output Schema

### Execution Gate Result

```typescript
interface ExecutionGateResult {
  /** Schema version (must be 1) */
  version: number;

  /** Overall verdict: "pass" or "fail" */
  status: "pass" | "fail";

  /** Verification pack hash being evaluated */
  packHash: string;

  /** Work queue fingerprint from the pack */
  workQueueFingerprint: string;

  /** Slice ID from the pack */
  sliceId: string;

  /** Number of commands evaluated */
  commandCount: number;

  /** Number of commands that passed */
  passedCount: number;

  /** Number of commands that failed */
  failedCount: number;

  /** Per-command execution results (deterministic ordering) */
  commandResults: CommandExecutionResult[];

  /** Linkage to verification-pack history lineage */
  lineage: {
    /** Slice ID matching pack history */
    sliceId: string;

    /** Work queue fingerprint matching pack history */
    workQueueFingerprint: string;

    /** Pack hash matching the evaluated pack */
    packHash: string;

    /** Timestamp of pack generation (from pack file) */
    packGeneratedAt: string;
  };

  /** Diagnostics explaining the result */
  diagnostics: string[];

  /** ISO 8601 timestamp of gate evaluation */
  evaluatedAt: string;
}
```

### Command Execution Result

```typescript
interface CommandExecutionResult {
  /** The command string from the verification pack */
  command: string;

  /** Resolved command type */
  commandType: "package-script" | "test-runner" | "tool-entry" | "verification-command" | "unknown";

  /** Whether the command resolved successfully */
  resolved: boolean;

  /** Whether the command executed successfully */
  passed: boolean;

  /** Exit code from command execution (or null if not executed) */
  exitCode: number | null;

  /** Execution duration in milliseconds (or null if not executed) */
  durationMs: number | null;

  /** Rule ID indicating failure reason (null on success) */
  ruleId: string | null;

  /** Human-readable explanation */
  message: string;

  /** Captured stdout (truncated to 100KB) */
  stdout?: string;

  /** Captured stderr (truncated to 100KB) */
  stderr?: string;
}
```

## Rule IDs

### Resolution Failures

| Rule ID | Severity | Description |
|---------|----------|-------------|
| `EG001_COMMAND_NOT_RESOLVED` | `error` | Command could not be resolved to any known command class |
| `EG002_SCRIPT_NOT_FOUND` | `error` | Referenced package.json script does not exist |
| `EG003_TOOL_NOT_FOUND` | `error` | Referenced tool file does not exist in `tools/` |
| `EG004_TEST_FILE_NOT_FOUND` | `error` | Referenced test file does not exist |
| `EG005_COMMAND_CLASS_DISALLOWED` | `error` | Command belongs to a disallowed command class |

### Execution Failures

| Rule ID | Severity | Description |
|---------|----------|-------------|
| `EG101_COMMAND_TIMEOUT` | `error` | Command execution exceeded timeout limit |
| `EG102_NON_ZERO_EXIT` | `error` | Command exited with non-zero status code |
| `EG103_EXECUTION_ERROR` | `error` | Command failed to start (spawn error) |
| `EG104_OUTPUT_TRUNCATED` | `warning` | Command output exceeded capture limit |

### Stale Pack Failures

| Rule ID | Severity | Description |
|---------|----------|-------------|
| `EG201_STALE_PACK_HASH` | `error` | Pack hash does not match any history event |
| `EG202_STALE_SLICE_ID` | `error` | Pack slice ID does not match current active slice |
| `EG203_STALE_FINGERPRINT` | `error` | Pack work queue fingerprint does not match current state |

## Stale-Pack Linkage Rules

The execution gate validates that the pack being evaluated is fresh and linked to current state.

### Linkage Validation

1. **Pack Hash Lookup**: Scan verification-pack-history.ndjson for the most recent `pack-generated` event with matching `packHash`
2. **Slice ID Validation**: If found, verify the event's `sliceId` matches the pack's `sliceId`
3. **Fingerprint Validation**: Verify the pack's `workQueueFingerprint` matches current TASKPAD state
4. **Generation Timestamp**: Ensure pack was generated within a reasonable time window (configurable, default: 24 hours)

### Stale Pack Detection

A pack is considered stale if ANY of these conditions are true:

| Condition | Rule ID |
|-----------|---------|
| No `pack-generated` history event exists with matching `packHash` | `EG201_STALE_PACK_HASH` |
| Pack's `sliceId` does not match current active slice from IMPLEMENTATION_PLAN | `EG202_STALE_SLICE_ID` |
| Pack's `workQueueFingerprint` does not match current TASKPAD Work Queue | `EG203_STALE_FINGERPRINT` |
| Pack was generated >24 hours ago (configurable) | `EG201_STALE_PACK_HASH` |

### Fallback Behavior on Stale Pack

If a stale pack is detected:
- Execution gate returns `status: "fail"`
- All command results are marked with `resolved: false, passed: false`
- Diagnostic explains the stale condition with actionable guidance
- Suggests running `taskpad:verification-pack` to generate a fresh pack

## Deterministic Ordering

All output arrays MUST follow canonical ordering rules:

### Command Results Ordering

Command results MUST be output in the exact order they appear in the verification pack's `verificationCommands` array. This ensures stable, reproducible output across runs.

### Diagnostics Ordering

Diagnostic messages MUST be ordered by severity first, then by rule ID in canonical order:

1. All error-level diagnostics
2. All warning-level diagnostics
3. All info-level diagnostics

Within each severity level, diagnostics MUST be sorted by rule ID in the order defined in the Rule IDs section above.

## Failure Taxonomy

### Pass Conditions

The execution gate returns `status: "pass"` when ALL of these are true:
- Pack is not stale (all linkage rules pass)
- Every command in the verification pack resolves to a known command class
- Every resolved command executes successfully (exit code 0)
- No command execution exceeds the timeout limit
- No commands violate the allowed command policy

### Fail Conditions

The execution gate returns `status: "fail"` when ANY of these are true:
- Pack is stale (stale-pack linkage rules fail)
- At least one command cannot be resolved to a known command class
- At least one resolved command executes with non-zero exit code
- At least one command execution times out
- At least one command violates the allowed command policy

### Noop Conditions

The execution gate returns `status: "noop"` when:
- Verification pack contains zero verification commands (empty command set)
- All commands are marked as skipped via command-level metadata (future extension)

## CLI Contract

### Usage

```bash
bun run taskpad:verification-pack-execution-gate -- \
  --taskpad <path> \
  --plan <path> \
  --pack <path> \
  --package <path> \
  [--format <json|human>] \
  [--timeout <seconds>] \
  [--history <path>]
```

### Arguments

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--taskpad <path>` | ✅ | - | Path to TASKPAD.md |
| `--plan <path>` | ✅ | - | Path to IMPLEMENTATION_PLAN.md |
| `--pack <path>` | ✅ | - | Path to verification pack JSON |
| `--package <path>` | ✅ | - | Path to package.json |
| `--format <json|human>` | ❌ | `json` | Output format |
| `--timeout <seconds>` | ❌ | `30` | Per-command timeout in seconds |
| `--history <path>` | ❌ | `docs/quality/taskpad-verification-pack-history.ndjson` | History file for stale-pack validation |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Execution gate passed (all commands executed successfully) |
| `1` | Execution gate failed (at least one command failed or pack is stale) |
| `2` | Input validation error (missing or invalid inputs) |

## Example Output

### Pass Case (JSON)

```json
{
  "version": 1,
  "status": "pass",
  "packHash": "f6e5d4c3b2a1...",
  "workQueueFingerprint": "a1b2c3d4e5f6...",
  "sliceId": "2026-03-02-verification-pack-execution-gate",
  "commandCount": 3,
  "passedCount": 3,
  "failedCount": 0,
  "commandResults": [
    {
      "command": "bun run typecheck",
      "commandType": "package-script",
      "resolved": true,
      "passed": true,
      "exitCode": 0,
      "durationMs": 1234,
      "ruleId": null,
      "message": "Command executed successfully"
    },
    {
      "command": "bun test tests/tools/taskpad-verification-pack-execution-gate.test.ts",
      "commandType": "test-runner",
      "resolved": true,
      "passed": true,
      "exitCode": 0,
      "durationMs": 5678,
      "ruleId": null,
      "message": "Command executed successfully"
    },
    {
      "command": "bun run taskpad:verification-pack-contract",
      "commandType": "verification-command",
      "resolved": true,
      "passed": true,
      "exitCode": 0,
      "durationMs": 2345,
      "ruleId": null,
      "message": "Command executed successfully"
    }
  ],
  "lineage": {
    "sliceId": "2026-03-02-verification-pack-execution-gate",
    "workQueueFingerprint": "a1b2c3d4e5f6...",
    "packHash": "f6e5d4c3b2a1...",
    "packGeneratedAt": "2026-03-02T10:00:00.000Z"
  },
  "diagnostics": [
    "Execution gate passed: all 3 commands executed successfully"
  ],
  "evaluatedAt": "2026-03-02T11:00:00.000Z"
}
```

### Fail Case - Stale Pack (JSON)

```json
{
  "version": 1,
  "status": "fail",
  "packHash": "f6e5d4c3b2a1...",
  "workQueueFingerprint": "a1b2c3d4e5f6...",
  "sliceId": "2026-03-01-old-slice",
  "commandCount": 0,
  "passedCount": 0,
  "failedCount": 0,
  "commandResults": [],
  "lineage": {
    "sliceId": "2026-03-01-old-slice",
    "workQueueFingerprint": "a1b2c3d4e5f6...",
    "packHash": "f6e5d4c3b2a1...",
    "packGeneratedAt": "2026-03-01T10:00:00.000Z"
  },
  "diagnostics": [
    "Stale pack detected: slice ID '2026-03-01-old-slice' does not match current active slice '2026-03-02-verification-pack-execution-gate'",
    "Rule ID: EG202_STALE_SLICE_ID",
    "Suggestion: Run 'bun run taskpad:verification-pack -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md' to generate a fresh pack"
  ],
  "evaluatedAt": "2026-03-02T11:00:00.000Z"
}
```

### Fail Case - Command Execution (JSON)

```json
{
  "version": 1,
  "status": "fail",
  "packHash": "f6e5d4c3b2a1...",
  "workQueueFingerprint": "a1b2c3d4e5f6...",
  "sliceId": "2026-03-02-verification-pack-execution-gate",
  "commandCount": 2,
  "passedCount": 1,
  "failedCount": 1,
  "commandResults": [
    {
      "command": "bun run typecheck",
      "commandType": "package-script",
      "resolved": true,
      "passed": true,
      "exitCode": 0,
      "durationMs": 1234,
      "ruleId": null,
      "message": "Command executed successfully"
    },
    {
      "command": "bun test tests/nonexistent/test.test.ts",
      "commandType": "test-runner",
      "resolved": true,
      "passed": false,
      "exitCode": 1,
      "durationMs": 234,
      "ruleId": "EG102_NON_ZERO_EXIT",
      "message": "Command exited with non-zero status code 1",
      "stderr": "error: test file not found: tests/nonexistent/test.test.ts\n"
    }
  ],
  "lineage": {
    "sliceId": "2026-03-02-verification-pack-execution-gate",
    "workQueueFingerprint": "a1b2c3d4e5f6...",
    "packHash": "f6e5d4c3b2a1...",
    "packGeneratedAt": "2026-03-02T10:00:00.000Z"
  },
  "diagnostics": [
    "Execution gate failed: 1 of 2 commands failed",
    "Failed command: bun test tests/nonexistent/test.test.ts",
    "Rule ID: EG102_NON_ZERO_EXIT",
    "Message: Command exited with non-zero status code 1"
  ],
  "evaluatedAt": "2026-03-02T11:00:00.000Z"
}
```

## History Integration

The execution gate reads from verification-pack-history.ndjson to validate pack lineage:

### History Events Referenced

| Event Type | Purpose |
|------------|---------|
| `pack-generated` | Validate pack exists in history and extract generation timestamp |
| `contract-evaluated` | Validate pack passed contract evaluation (optional, for strict mode) |

### History Read Contract

- History file is read-only during execution gate evaluation
- No history events are written by the execution gate
- History events are read using the canonical history parser from `tools/lib/taskpad-verification-pack-history.ts`

## TypeScript Types

Canonical type definitions will be in `tools/lib/taskpad-verification-pack-execution-gate.ts`.

## Verification Commands

```bash
# Run execution gate with full verification flow
bun run typecheck
bun test tests/tools/taskpad-verification-pack-execution-gate.test.ts
bun run taskpad:verification-pack -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --out docs/quality/taskpad-verification-pack.json --history docs/quality/taskpad-verification-pack-history.ndjson
bun run taskpad:verification-pack-contract -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --pack docs/quality/taskpad-verification-pack.json --history docs/quality/taskpad-verification-pack-history.ndjson --package package.json
bun run taskpad:verification-pack-execution-gate -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --pack docs/quality/taskpad-verification-pack.json --package package.json
bun run verify:taskpad:intake:full -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md
```

## Canonical Intake Verification Flow

The execution gate is the final step in the canonical intake verification sequence before Builder handoff:

1. **Generate verification pack**: `taskpad:verification-pack`
2. **Evaluate contract**: `taskpad:verification-pack-contract`
3. **Execute commands** (NEW): `taskpad:verification-pack-execution-gate`
4. **Full intake verification**: `verify:taskpad:intake:full`

The execution gate ensures that verification commands can actually execute, providing runtime-proof that Builder will not encounter unexpected failures.
