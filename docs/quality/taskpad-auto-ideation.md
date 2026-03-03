# TASKPAD Auto-Ideation Contract

## Purpose
Define deterministic rules for auto-seeding one next backlog item when TASKPAD execution queues are empty.

## Shared Mutator Write-Mode Contract

**Purpose**: All TASKPAD mutators that produce content edits MUST use a shared write-mode contract to handle non-writable targets deterministically.

**Contract location**: `tools/lib/taskpad-mutator-contract.ts`

**Full documentation**: See [`README.md#TASKPAD Mutator Fallback/Apply Flow`](../../README.md#taskpad-mutator-fallbackapply-flow) for the complete canonical flow, including:
- Write modes and deterministic reason-code mapping
- Shared artifact schema
- Canonical fallback/apply flow (preflight → mutator execution → artifact application)
- Exit semantics and idempotency guarantees

### Write Modes
The shared contract defines three deterministic write modes:

- `direct-write`: Mutator proceeds with direct file writes (target is writable).
- `fallback-artifact`: Mutator emits a deterministic fallback artifact instead of mutating.
- `error`: Mutator fails with non-zero exit; no writes or artifacts generated.

### Deterministic Reason-Code Mapping

All TASKPAD mutators MUST use the following reason codes from `tools/lib/taskpad-mutator-contract.ts`:

**Preflight reason codes** (writeability probe):
- `MUTATOR_PREFLIGHT_OK` → `direct-write`
- `MUTATOR_PERMISSION_EPERM` → `fallback-artifact`
- `MUTATOR_PERMISSION_EACCES` → `fallback-artifact`
- `MUTATOR_PERMISSION_EROFS` → `fallback-artifact`
- `MUTATOR_PERMISSION_DENIED_GENERIC` → `fallback-artifact`
- `MUTATOR_TARGET_NOT_FOUND` → `error`
- `MUTATOR_TARGET_PATH_INVALID` → `error`
- `MUTATOR_TARGET_NOT_WRITABLE_FILE` → `error`
- `MUTATOR_PARENT_DIR_NOT_FOUND` → `error`
- `MUTATOR_IO_UNEXPECTED` → `error`

**Execution reason codes** (mutation outcome):
- `MUTATOR_EXECUTION_OK` → mutation succeeded
- `MUTATOR_EXECUTION_NOOP` → mutation no-op (e.g., duplicate detected)
- `MUTATOR_FALLBACK_ARTIFACT_GENERATED` → artifact emitted instead of mutation
- `MUTATOR_WRITE_FAILED` → write operation failed
- `MUTATOR_ATOMIC_COMMIT_FAILED` → atomic transaction failed
- `MUTATOR_VALIDATION_FAILED` → pre-apply validation failed
- `MUTATOR_CONTRACT_VIOLATION` → contract requirements violated

### Permission Classes

- `none`: No permission issue (write succeeded or no write attempted).
- `permission-denied`: OS-level permission denied (EPERM, EACCES, EROFS).
- `non-permission`: Other non-permission errors (missing file, invalid path, I/O error).

### Exit Semantics

- Exit `0` when `mode` is `direct-write` or `fallback-artifact`.
- Exit non-zero when `mode` is `error`.
- Non-zero exits MUST still emit full machine-readable output.

## Mutators Using This Contract

The following TASKPAD mutators MUST use the shared write-mode contract:

1. **`taskpad:auto-ideation`** - Already uses the contract (legacy implementation migrated to shared types)
2. **`taskpad:plan-seed`** - MUST be migrated to use shared contract (TP002)
3. **`taskpad:intake:autoplan`** - MUST be migrated to use shared contract (TP003)
4. **`queue-reconcile` write paths** - MUST emit fallback artifacts using shared schema (TP002, TP003)

### Legacy Migration Status

## Target Queue Routing Contract (TP001)

Auto-ideation supports deterministic target queue selection via `--target-queue` CLI argument.

### Auto-Intake Recovery Contract (`verify:taskpad:intake:auto`)

The `verify:taskpad:intake:auto` command enforces Work Queue routing for autonomous empty-queue recovery. This command provides a single-entrypoint for intake loops that automatically detects empty queues, seeds an immediately plannable Work Queue item, and runs full intake verification.

**Command Definition:**

```bash
bun run verify:taskpad:intake:auto -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md
```

**Deterministic Execution Flow:**

1. **Queue Health Check** - Run `taskpad:queue-health` first
   - If queues have unchecked items (`totalUnchecked >= 1`): Skip auto-ideation, go to step 3
   - If queues are empty (`totalUnchecked === 0`): Continue to step 2

2. **Auto-Ideation with Work Queue Routing** - Run `taskpad:auto-ideation --target-queue work`
   - Enforced routing: MUST use `--target-queue work` for empty queues
   - This ensures an immediately plannable Work Queue item is created
   - No manual queue promotion required

3. **Full Intake Verification** - Run `verify:taskpad:intake:full`
   - Always runs regardless of whether auto-ideation was triggered
   - Validates queue health, planned command parity, fallback artifact parity, and plan integrity

**Enforced Routing Semantics:**

When `taskpad:queue-health` reports empty queues, `verify:taskpad:intake:auto` MUST invoke:

```bash
bun run taskpad:auto-ideation -- \
  --taskpad "$TASKPAD_PATH" \
  --plan "$PLAN_PATH" \
  --target-queue work
```

This enforced routing is not configurable via flags in `verify:taskpad:intake:auto` — it is a hard contract for autonomous intake loops.

**Deterministic Rule ID:**

| Rule ID | Description |
|---------|-------------|
| `TQR004_WORK_QUEUE_PATH` | Work Queue insertion path selected (enforced routing in auto-intake recovery) |

The `targetQueueRouting.ruleId` field in auto-ideation output will be `TQR004_WORK_QUEUE_PATH` when invoked via `verify:taskpad:intake:auto` on empty queues.

**Machine-Readable Output Examples:**

**Empty-queue recovery triggered (auto-ideation runs with enforced Work Queue routing):**

```bash
bun run verify:taskpad:intake:auto -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md
```

Expected auto-ideation output when queues are empty:
```json
{
  "status": "seeded",
  "triggered": true,
  "targetQueueRouting": {
    "targetQueue": "work",
    "insertionSection": "## Work Queue",
    "ruleId": "TQR004_WORK_QUEUE_PATH"
  },
  "queueHealth": {
    "autonomousUncheckedCount": 0,
    "selfImprovementUncheckedCount": 0,
    "totalUnchecked": 0
  }
}
```

**Queues already populated (auto-ideation skipped):**

```bash
bun run verify:taskpad:intake:auto -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md
```

Expected behavior: No auto-ideation output, full intake verification runs directly.

**Exit Codes:**

- `0`: Recovery succeeded or queues already populated (intake verification passes)
- `1`: Auto-ideation failed, or intake verification fails (with deterministic diagnostics)

**Verification Evidence Checklist:**

When documenting `verify:taskpad:intake:auto` runs:

- [ ] Capture pre-command queue health showing empty state (`totalUnchecked: 0`)
- [ ] Confirm auto-ideation was triggered and output includes `targetQueueRouting.ruleId: "TQR004_WORK_QUEUE_PATH"`
- [ ] Capture post-ideation queue health showing `autonomousUncheckedCount >= 1`
- [ ] Confirm full intake verification passes after recovery
- [ ] For non-empty queue runs, confirm auto-ideation was skipped (no auto-ideation output)
- [ ] Keep compact command + JSON snippets in `docs/quality/taskpad-auto-ideation-report.md`

### Allowed Queue Values

| Queue Value | Insertion Section | Use Case |
|-------------|-------------------|----------|
| `self-improvement` | `## Self-Improvement Backlog` | Default; staging area for future improvement ideas |
| `work` | `## Work Queue` | Immediately executable work items for Engineer loops |

### Enforcement in Intake Pipeline

The `verify:taskpad:intake:auto` orchestration command enforces Work Queue routing when queue-health reports no unchecked executable queue items. This ensures autonomous empty-queue recovery always produces an immediately plannable Work Queue item without requiring manual queue promotion.

**Contract requirement:** When `taskpad:queue-health` detects empty queues (`totalUnchecked === 0`), the `verify:taskpad:intake:auto` flow MUST invoke `taskpad:auto-ideation --target-queue work` before running the full intake verification gate.

**Diagnostic observability:** The auto-ideation output includes deterministic routing metadata under `targetQueueRouting`:
- `targetQueue`: "work"
- `insertionSection`: "## Work Queue"
- `ruleId`: "TQR004_WORK_QUEUE_PATH" (enforced routing via auto-intake recovery)
- `ruleId`: "TQR003_DEFAULT_TARGET_QUEUE" (implicit routing when calling `taskpad:auto-ideation` directly without `--target-queue` flag)

This routing metadata is machine-readable and appears in both human and JSON output, enabling deterministic assertions in logs and tests.

**For detailed auto-intake recovery contract documentation**, see the [Auto-Intake Recovery Contract](#auto-intake-recovery-contract-verifytaskpadintakeauto) section above.

### Default Behavior (Backward Compatibility)

When `--target-queue` is not specified, the command defaults to `self-improvement` for backward compatibility.

### Deterministic Rule IDs

| Rule ID | Description |
|---------|-------------|
| `TQR001_VALID_TARGET_QUEUE` | Target queue value is valid and supported |
| `TQR002_INVALID_TARGET_QUEUE` | Target queue value is invalid or unsupported |
| `TQR003_DEFAULT_TARGET_QUEUE` | Default target queue used (backward compatibility) |
| `TQR004_WORK_QUEUE_PATH` | Work Queue insertion path selected |
| `TQR005_SELF_IMPROVEMENT_PATH` | Self-Improvement Backlog insertion path selected |

### Verification Guidance in the Intake Pipeline

When using `--target-queue work` in autonomous intake loops, follow this verification sequence to ensure the Work Queue has an immediately executable item after ideation.

**Step 1: Queue Health Check (Pre-Ideation)**

Verify that queues are empty before triggering ideation:

```bash
bun run taskpad:queue-health -- \
  --taskpad "/path/to/TASKPAD.md" \
  --format json
```

Expected output when queues are empty:
```json
{
  "status": "fail",
  "reasonCode": "QH001_QUEUE_EMPTY",
  "queueHealth": {
    "autonomousUncheckedCount": 0,
    "selfImprovementUncheckedCount": 0,
    "totalUnchecked": 0
  }
}
```

**Step 2: Run Work Queue-Target Ideation**

Seed Work Queue with `--target-queue work`:

```bash
bun run taskpad:auto-ideation -- \
  --taskpad "/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --target-queue work \
  --format json
```

Expected output includes `targetQueueRouting` metadata:
```json
{
  "status": "seeded",
  "triggered": true,
  "targetQueueRouting": {
    "targetQueue": "work",
    "insertionSection": "## Work Queue",
    "ruleId": "TQR004_WORK_QUEUE_PATH"
  },
  "queueHealth": {
    "autonomousUncheckedCount": 0,
    "selfImprovementUncheckedCount": 0,
    "totalUnchecked": 0
  },
  "selectedOutcome": {
    "action": "inserted",
    "taskpadPath": "/path/to/TASKPAD.md",
    "insertedLine": 42,
    "matchedExistingLine": null
  }
}
```

**Step 3: Queue Health Re-Check (Post-Ideation)**

Confirm Work Queue has unchecked item after ideation:

```bash
bun run taskpad:queue-health -- \
  --taskpad "/path/to/TASKPAD.md" \
  --format json
```

Expected output when Work Queue is now populated:
```json
{
  "status": "pass",
  "queueHealth": {
    "autonomousUncheckedCount": 1,
    "selfImprovementUncheckedCount": 0,
    "totalUnchecked": 1
  }
}
```

**Step 4: Full Intake Verification**

Run full intake gate before Builder dispatch:

```bash
bun run verify:taskpad:intake:full -- \
  --taskpad "/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --format json
```

Expected output when all gates pass:
```json
{
  "status": "pass",
  "verdict": "ready",
  "gates": {
    "queueHealth": { "status": "pass" },
    "plannedCommandParity": { "status": "pass" },
    "fallbackArtifactParity": { "status": "pass" },
    "planIntegrity": { "status": "pass" }
  }
}
```

**Deduplication Behavior**

If `--target-queue work` is run multiple times with the same plan state:

- First run: `status="seeded"`, `selectedOutcome.action="inserted"`
- Second run: `status="deduped"`, `selectedOutcome.action="deduped"`, `matchedExistingLine` points to existing bullet
- Queue health remains stable (no duplicate Work Queue items)

**Canonical Bullet Format**

Inserted Work Queue bullets follow this format:

```markdown
- [ ] planned-YYYY-MM-DD <actionable next step>
```

Example:
```markdown
- [ ] planned-2026-03-02 Add Work Queue-target ideation verification guidance to README and quality docs
```

**Integration with `taskpad:intake:recover`**

The `taskpad:intake:recover` orchestrator automatically handles empty queues by running `taskpad:auto-ideation`. To use Work Queue-target seeding in this flow, ensure the recover configuration or intake pipeline specifies `--target-queue work` when executing auto-ideation.

**Verification Evidence Checklist**

When documenting Work Queue-target ideation runs:

- [ ] Capture pre-ideation queue health showing `totalUnchecked: 0`
- [ ] Capture `taskpad:auto-ideation` output with `targetQueueRouting.targetQueue: "work"`
- [ ] Confirm `targetQueueRouting.ruleId: "TQR004_WORK_QUEUE_PATH"`
- [ ] Capture post-ideation queue health showing `autonomousUncheckedCount >= 1`
- [ ] Confirm `selectedOutcome.action: "inserted"` or `"deduped"` (both are valid)
- [ ] Confirm inserted bullet follows canonical format: `- [ ] planned-YYYY-MM-DD <text>`
- [ ] Confirm full intake verification passes before proceeding to Builder dispatch

### CLI Usage

```bash
# Default (self-improvement) - backward compatible
bun run taskpad:auto-ideation -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md

# Explicit self-improvement
bun run taskpad:auto-ideation -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --target-queue self-improvement

# Work queue for immediately executable items (recommended for empty queues)
bun run taskpad:auto-ideation -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --target-queue work

# Work queue with JSON output for CI/automation
bun run taskpad:auto-ideation -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --target-queue work --format json
```

**Recommended flow for autonomous intake loops:**
When intake verification detects empty executable queues (no unchecked Work Queue items), use `--target-queue work` to seed an immediately plannable Work Queue item. This ensures the next Engineer loop has executable work without manual queue promotion.

```bash
# 1) Detect empty queues
bun run taskpad:queue-health -- --taskpad TASKPAD.md

# 2) If empty, seed Work Queue
bun run taskpad:auto-ideation -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --target-queue work

# 3) Verify Work Queue is now populated
bun run taskpad:queue-health -- --taskpad TASKPAD.md

# 4) Run full intake verification
bun run verify:taskpad:intake:full -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md
```

### Machine-Readable Output

The CLI result includes `targetQueueRouting` metadata:

```json
{
  "targetQueueRouting": {
    "targetQueue": "work",
    "insertionSection": "## Work Queue",
    "ruleId": "TQR004_WORK_QUEUE_PATH"
  }
}
```

- `taskpad:write-preflight.ts` - Uses legacy reason codes (`PRECHECK_*`) that map to shared contract
- `taskpad:apply-fallback.ts` - Uses auto-ideation-specific artifact kind; will be extended for other mutator kinds (TP004)

---

## Trigger Condition (must run / must no-op)
Auto-ideation MUST evaluate queue health using the same section semantics as `taskpad-queue-health`.

### Run condition
Execute ideation only when both counts are zero:
- `autonomousUncheckedCount === 0`
- `selfImprovementUncheckedCount === 0`

### No-op condition
If either queue has unchecked work (`totalUnchecked >= 1`), auto-ideation MUST:
- make no TASKPAD edits,
- return a deterministic no-op result,
- exit success (`0`) so orchestrators can continue normal intake.

## `taskpad:write-preflight` Contract
`taskpad:write-preflight` MUST probe a TASKPAD path and return a deterministic writeability decision before any queue mutation.

### Command Inputs
- `--taskpad <path>` (required): target TASKPAD markdown path, absolute or cwd-relative.
- `--help, -h` (optional): print usage and exit success.

### Normalized Input Context
Required fields in diagnostics:
- `taskpadPath`: normalized absolute path.
- `taskpadExists`: whether the target file exists.
- `parentDirPath`: normalized parent directory path.
- `runtimeError` (optional): raw exception object/message when probing throws.

The probe MAY create/remove a temporary probe file in `parentDirPath`, but it MUST NOT modify TASKPAD business content.

### Deterministic Output Schema
Command output MUST be one JSON object (machine-readable):

```json
{
  "taskpadPath": "string",
  "taskpadExists": true,
  "parentDirPath": "string",
  "writable": true,
  "reasonCode": "PRECHECK_OK",
  "mode": "direct-write|fallback-artifact|error",
  "permissionClass": "none|permission-denied|non-permission",
  "detail": "string"
}
```

The command SHOULD emit this object between stable markers to simplify deterministic parsing:

```
TASKPAD_WRITE_PRECHECK_JSON_START
{...payload...}
TASKPAD_WRITE_PRECHECK_JSON_END
```

### Deterministic reason-code mapping
Allowed reason codes (exhaustive):
- `PRECHECK_OK`
- `PRECHECK_PERMISSION_EPERM`
- `PRECHECK_PERMISSION_EACCES`
- `PRECHECK_PERMISSION_EROFS`
- `PRECHECK_PERMISSION_DENIED_GENERIC`
- `PRECHECK_TASKPAD_NOT_FOUND`
- `PRECHECK_TASKPAD_PATH_INVALID`
- `PRECHECK_PARENT_DIR_NOT_FOUND`
- `PRECHECK_IO_UNEXPECTED`

Decision matrix (deterministic):

| reasonCode | writable | permissionClass | mode |
|---|---|---|---|
| `PRECHECK_OK` | `true` | `none` | `direct-write` |
| `PRECHECK_PERMISSION_EPERM` | `false` | `permission-denied` | `fallback-artifact` |
| `PRECHECK_PERMISSION_EACCES` | `false` | `permission-denied` | `fallback-artifact` |
| `PRECHECK_PERMISSION_EROFS` | `false` | `permission-denied` | `fallback-artifact` |
| `PRECHECK_PERMISSION_DENIED_GENERIC` | `false` | `permission-denied` | `fallback-artifact` |
| `PRECHECK_TASKPAD_NOT_FOUND` | `false` | `non-permission` | `error` |
| `PRECHECK_TASKPAD_PATH_INVALID` | `false` | `non-permission` | `error` |
| `PRECHECK_PARENT_DIR_NOT_FOUND` | `false` | `non-permission` | `error` |
| `PRECHECK_IO_UNEXPECTED` | `false` | `non-permission` | `error` |

Identical path and exception class MUST produce identical `{writable,reasonCode,mode,permissionClass}`.

### Exit Semantics
- Exit `0` when `mode` is `direct-write` or `fallback-artifact`.
- Exit non-zero when `mode` is `error`.
- Non-zero exits MUST still emit the full machine-readable JSON payload.

### Routing Semantics for `taskpad:auto-ideation`
- `mode=direct-write`: proceed with direct `taskpad:auto-ideation` mutation.
- `mode=fallback-artifact`: skip direct TASKPAD writes, emit fallback patch artifact + apply hint path.
- `mode=error`: do not proceed to insertion or fallback artifact generation; return hard failure.

## Candidate Generation Contract (exactly 3)
When run condition is met, the tool MUST synthesize exactly **3** candidate backlog bullets.

Rules:
- Candidate count is always 3 (not 2, not 4+).
- Candidates must be derived only from repository-local inputs (no network/LLM).
- Candidate ordering before ranking must be deterministic (stable tie-breakers).
- Candidate text should be immediately actionable and scoped to one follow-on task.

## Ranking Inputs (deterministic)
The candidate ranking score MUST be computed from these inputs only:

1. **Intake-gate failure signal**
   - Empty-queue failure context and latest gate diagnostics.
2. **Recent completed-slice themes**
   - The most recent completed TASKPAD intake slice themes in `IMPLEMENTATION_PLAN.md`.
3. **Unresolved quality risks**
   - Repo-local quality artifacts indicating unresolved gaps, fails, or explicit follow-on risks.

No hidden/manual weighting is allowed. Identical input files MUST produce identical ranked order.

## Selection Rule
- Pick the highest-ranked candidate as `selectedCandidate`.
- If scores tie, break ties deterministically via the ranking snapshot tie-break chain defined below.

## Ranking Snapshot Contract (drift-gate required)
When `triggered=true` and `preflight.mode !== error`, output MUST include ranking snapshot metadata suitable for deterministic fixture assertions.

### Required per-candidate ranking snapshot fields
Each candidate entry MUST include:
- `scoreBreakdown`: object with numeric components (`intakeGate`, `recentSliceTheme`, `qualityRisk`) and `total`.
- `stableSortKey`: deterministic string key used for final ordering comparisons.
- `tieBreak`: object with required deterministic fields:
  - `canonicalCandidateId` (string)
  - `canonicalTitle` (string; lowercase/whitespace-normalized)
  - `canonicalBullet` (string; canonical insertion form)

### Stable ordering + tie-break expectations
Final ranking MUST be sorted using this exact key precedence:
1. `scoreBreakdown.total` (descending)
2. `scoreBreakdown.qualityRisk` (descending)
3. `scoreBreakdown.recentSliceTheme` (descending)
4. `scoreBreakdown.intakeGate` (descending)
5. `tieBreak.canonicalCandidateId` (ascending lexical)
6. `tieBreak.canonicalTitle` (ascending lexical)
7. `tieBreak.canonicalBullet` (ascending lexical)

`stableSortKey` MUST encode the same precedence so fixture diffs can compare one canonical value.

### Snapshot determinism rules
- Identical input files MUST produce byte-identical ordering for the top-3 ranked candidates.
- Ranking fixtures MUST assert candidate order and the `stableSortKey`/`scoreBreakdown`/`tieBreak` fields for each ranked candidate.
- Any ranking heuristic change that alters order or tie-break metadata MUST fail snapshot verification until fixtures are intentionally updated.

## Dedupe Rule (before write)
Before inserting, compare `selectedCandidate` against existing unchecked bullets under `## Self-Improvement Backlog`.

### Semantic dedupe normalization contract
Semantic dedupe MUST be based on a deterministic `semanticKey` generated from both:
- the selected candidate bullet, and
- each existing unchecked self-improvement bullet.

A match is `semantic-equivalent` only when both `semanticKey` values are identical.

#### Normalization pipeline (required order)
1. Parse unchecked bullet content by removing markdown checkbox prefix (`- [ ]`) and any leading `planned-YYYY-MM-DD` (or concrete `planned-YYYY-MM-DD` date stamp).
2. Normalize text to lowercase and collapse all repeated whitespace to single spaces.
3. Replace punctuation separators (`/`, `-`, `_`, `,`, `.`, `:`, `;`, `(`, `)`) with spaces before tokenization.
4. Tokenize on spaces.
5. Drop empty tokens.
6. Apply synonym folding via static map (below).
7. Remove ignored tokens (below).
8. De-duplicate remaining tokens.
9. Sort tokens lexicographically (`localeCompare`, stable for identical input).
10. Join with a single `:` to produce final `semanticKey`.

#### Synonym folding map (static, repo-local)
Implementations MUST fold these token variants to the listed canonical token before ignored-token filtering:

- `dedupe`: `dedupe`, `deduped`, `deduping`, `duplicate`, `duplicates`, `duplicated`, `duplication`
- `normalize`: `normalize`, `normalized`, `normalization`, `normalise`, `canonical`, `canonicalize`, `canonicalized`, `canonicalization`
- `verify`: `verify`, `verified`, `verification`, `validate`, `validated`, `validation`
- `preflight`: `preflight`, `precheck`, `pre-check`
- `writable`: `writable`, `writeable`
- `taskpad`: `taskpad`, `backlog`, `queue`

No LLM/stemming/embedding behavior is allowed; only explicit static folding rules.

#### Ignored tokens (static)
After synonym folding, ignore these tokens:
`a`, `an`, `the`, `and`, `or`, `to`, `for`, `of`, `in`, `on`, `by`, `with`, `from`, `into`, `via`, `is`, `are`, `be`, `this`, `that`, `one`, `next`, `item`

Additionally, ignore any token that is exactly:
- `planned`
- an ISO date fragment (`yyyy`, `mm`, `dd`) produced by planned-prefix parsing
- purely numeric

#### Deterministic ordering/comparison
- `semanticKey` comparison MUST be strict string equality.
- Candidate/existing bullet traversal order may vary internally, but final dedupe decision MUST be deterministic for identical file contents.
- On first equal `semanticKey` match in source line order, return `deduped` and record that matched line.

If a semantically equivalent canonical bullet already exists:
- do not append a duplicate,
- return status `deduped` with the matched existing line reference.

If no duplicate exists:
- append exactly one unchecked bullet under `## Self-Improvement Backlog`.

## Canonical Inserted Bullet Shape
Inserted bullet MUST follow:
- `- [ ] planned-YYYY-MM-DD <actionable next step>`

Date must be deterministic for the run date; text must be normalized to avoid formatting-only duplicates.

## Fallback Patch Artifact Contract
When fallback mode is triggered, the tool MUST emit one deterministic patch artifact describing the exact insertion that could not be written.

### Canonical location
- Artifact root: `artifacts/taskpad-auto-ideation/`
- Artifact file: `<taskpad-basename>.auto-ideation.patch.json`
  - Example: `artifacts/taskpad-auto-ideation/TASKPAD.md.auto-ideation.patch.json`

### Artifact schema
```json
{
  "version": 1,
  "kind": "taskpad-auto-ideation-fallback-patch",
  "taskpadPath": "string",
  "taskpadSha256": "string",
  "selectedCandidateId": "string",
  "selectedOutcome": {
    "action": "would-insert",
    "canonicalBullet": "- [ ] planned-YYYY-MM-DD ...",
    "insertedLine": "number"
  },
  "patch": {
    "format": "unified-diff",
    "targetPath": "string",
    "content": "string"
  },
  "applyHint": "string"
}
```

Schema constraints:
- Artifact content MUST be deterministic for identical inputs (stable line endings, stable date formatting, stable diff formatting).
- `patch.targetPath` must match `taskpadPath`.
- `selectedOutcome.insertedLine` is the intended insertion line in the post-patch file.
- `applyHint` must tell Engineer/orchestrator exactly how to apply the artifact in a writable step.

## `taskpad:apply-fallback` Contract
`taskpad:apply-fallback` is the deterministic applier for artifacts created by `taskpad:auto-ideation` fallback mode.

### CLI Inputs
- `--taskpad <path>`: path to the TASKPAD file to mutate.
- `--artifact <path>`: path to one fallback patch artifact JSON file.

The command MUST reject missing flags, empty values, unreadable paths, or non-file targets.

### Required Artifact Fields
The artifact JSON MUST contain all fields below with exact types/values:

- `version: 1`
- `kind: "taskpad-auto-ideation-fallback-patch"`
- `taskpadPath: string` (non-empty)
- `taskpadSha256: string` (exactly 64 lowercase hex chars)
- `selectedCandidateId: string` (non-empty)
- `selectedOutcome: object`
  - `selectedOutcome.action: "would-insert"`
  - `selectedOutcome.canonicalBullet: string` (non-empty canonical backlog bullet)
  - `selectedOutcome.insertedLine: number` (integer >= 1)
- `patch: object`
  - `patch.format: "unified-diff"`
  - `patch.targetPath: string` (non-empty)
  - `patch.content: string` (non-empty unified diff body)
- `applyHint: string` (non-empty)

Unknown fields MAY exist, but required-field validation MUST remain strict and deterministic.

### Validation Order (deterministic, pre-write)
`taskpad:apply-fallback` MUST validate in this exact order before any file mutation:

1. **Artifact parse**
   - Artifact file is readable JSON object.
   - Failure code: `ERR_ARTIFACT_PARSE`.
2. **Artifact schema/version/kind**
   - Required fields/types match contract.
   - `version === 1` and `kind === "taskpad-auto-ideation-fallback-patch"`.
   - Failure codes: `ERR_ARTIFACT_SCHEMA`, `ERR_ARTIFACT_VERSION_UNSUPPORTED`.
3. **Path alignment**
   - CLI `--taskpad`, `artifact.taskpadPath`, and `patch.targetPath` all resolve to the same canonical file.
   - Failure code: `ERR_TASKPAD_PATH_MISMATCH`.
4. **Target existence/readability**
   - Canonical TASKPAD path exists and is readable as a file.
   - Failure code: `ERR_TASKPAD_NOT_FOUND`.
5. **Hash match**
   - SHA-256(current TASKPAD bytes) exactly equals `taskpadSha256`.
   - Failure code: `ERR_TASKPAD_HASH_MISMATCH`.
6. **Patch guard + apply simulation (in-memory only)**
   - Diff is valid single-target unified diff for the same TASKPAD.
   - Diff shape is consistent with one planned insertion.
   - Failure codes: `ERR_PATCH_FORMAT_INVALID`, `ERR_PATCH_APPLY_FAILED`.
7. **Atomic write commit**
   - Persist updated TASKPAD atomically when step 6 yields `applied`.
   - Failure code: `ERR_WRITE_FAILED`.

No write is allowed before steps 1-6 pass.

### Output Contract + Status/Reason Matrix
Machine-readable JSON MUST include at least:
- `status: "applied" | "noop" | "rejected"`
- `taskpadPath: string`
- `artifactPath: string`
- `reasonCode: string | null`
- `message: string`

Deterministic matrix:

| Condition | status | reasonCode | Exit |
|---|---|---|---|
| Valid artifact, patch applied, atomic write succeeds | `applied` | `null` | `0` |
| Valid artifact, hash matches, diff already reflected (no content change) | `noop` | `null` | `0` |
| Any parse/schema/version/path/existence/hash/patch/write failure | `rejected` | one deterministic `ERR_*` code | non-zero |

Failure code set:
- `ERR_ARTIFACT_PARSE`
- `ERR_ARTIFACT_SCHEMA`
- `ERR_ARTIFACT_VERSION_UNSUPPORTED`
- `ERR_TASKPAD_PATH_MISMATCH`
- `ERR_TASKPAD_NOT_FOUND`
- `ERR_TASKPAD_HASH_MISMATCH`
- `ERR_PATCH_FORMAT_INVALID`
- `ERR_PATCH_APPLY_FAILED`
- `ERR_WRITE_FAILED`

### Idempotency Expectations
- Behavior MUST be deterministic for repeated runs of the same artifact.
- Re-run outcome depends on current TASKPAD state:
  - If TASKPAD still matches artifact pre-image and insertion is already represented in diff terms, return `status="noop"`.
  - If TASKPAD drifted after initial apply (pre-image hash mismatch), return `status="rejected"` + `ERR_TASKPAD_HASH_MISMATCH`.
- Best-effort merge/coercion is forbidden.

## `taskpad:intake:recover` Orchestration Contract
`taskpad:intake:recover` MUST provide one deterministic intake-recovery entrypoint that composes existing commands without redefining their business rules.

### Command Inputs
- `--taskpad <path>` (required): TASKPAD markdown path.
- `--plan <path>` (required): `IMPLEMENTATION_PLAN.md` path.
- Optional passthrough flags MAY be added later, but default behavior MUST remain deterministic with only these required inputs.

### Deterministic Step Order (fixed)
The orchestrator MUST execute steps in this exact order:

1. `taskpad:queue-health`
2. Conditional `taskpad:auto-ideation` (only when step 1 reports both queues empty)
3. Conditional `taskpad:apply-fallback` (only when step 2 returns `status=fallback` with non-null `artifactPath`)
4. Conditional `taskpad:queue-health` re-check (required if step 2 ran)
5. `plan:integrity`
6. `verify:taskpad:intake:full`

Any step that is skipped by branch rules MUST be emitted as `status=skipped` with deterministic `reasonCode`.

### Branching Rules (deterministic)
- If initial queue health passes (`totalUnchecked >= 1`), skip steps 2-4 and continue to steps 5-6.
- If initial queue health fails due empty queues, run step 2 (`taskpad:auto-ideation`).
- If step 2 returns `seeded|deduped`, skip step 3 and run step 4.
- If step 2 returns `fallback`:
  - require `artifactPath` to exist,
  - run step 3 with that artifact,
  - run step 4 after step 3.
- If step 2 returns `noop` while initial queue health failed-empty, treat as contract violation (`blocked`).
- If step 4 still reports empty queues, verdict MUST be `hold` (do not continue recovery loops inside this command).
- Steps 5-6 always run unless a prior step produced a hard orchestrator/runtime block.

### Deterministic Output Schema
`taskpad:intake:recover` MUST emit one machine-readable JSON packet:

```json
{
  "status": "pass|fail",
  "verdict": "ready|hold|blocked",
  "reasonCode": "RECOVER_READY|RECOVER_HOLD_QUEUE_EMPTY|RECOVER_BLOCKED_RUNTIME",
  "taskpadPath": "string",
  "planPath": "string",
  "steps": [
    {
      "id": "queue-health-initial|auto-ideation|apply-fallback|queue-health-recheck|plan-integrity|verify-intake-full",
      "command": "string",
      "status": "pass|fail|skipped",
      "exitCode": 0,
      "reasonCode": "string|null",
      "summary": "string"
    }
  ],
  "artifacts": {
    "autoIdeationArtifactPath": "string|null"
  },
  "nextActions": ["string"]
}
```

Schema constraints:
- `steps` MUST always include all six canonical step IDs in fixed order.
- `status=skipped` requires non-null deterministic `reasonCode` (`SKIP_QUEUE_NOT_EMPTY`, `SKIP_NO_FALLBACK_ARTIFACT`, `SKIP_AUTO_IDEATION_NOT_RUN`).
- `verdict=ready` requires step 5 and step 6 to be `pass`.
- `verdict=hold` requires deterministic intake-gate failure semantics (for example: queue still empty after recovery path or deterministic gate hold from full verify).
- `verdict=blocked` is reserved for runtime/contract failures (invalid input, malformed child output, command execution failure, missing required artifact, non-deterministic/unknown status).
- `nextActions` MUST be deterministic for each `verdict/reasonCode` pair.

### Verdict Semantics
- `ready`: Intake is healthy and execution can proceed to normal Builder dispatch.
- `hold`: Intake rules intentionally blocked progression but state is recoverable via explicit operator action (for example, add/adjust queue seed item).
- `blocked`: Orchestrator could not complete deterministically due contract/runtime failure; human intervention required before retry.

### Exit Semantics
- Exit `0` only when `verdict=ready`.
- Exit non-zero when `verdict=hold|blocked`.
- Non-zero exits MUST still emit the full machine-readable packet above.

## `taskpad:plan-seed` Contract
`taskpad:plan-seed` MUST deterministically promote exactly one unchecked self-improvement backlog item into a new top `IMPLEMENTATION_PLAN` intake slice scaffold and mark that source backlog line as planned in the same successful run.

### Selection Order (source backlog pick)
The command MUST select the source item using this exact order:
1. Parse `## Self-Improvement Backlog` in TASKPAD.
2. Read bullets in source line order.
3. Pick the first unchecked bullet (`- [ ] ...`) that is not already marked complete.
4. Ignore checked bullets and out-of-section bullets.

Determinism rules:
- Identical file bytes MUST produce the same `selectedBacklogLine`.
- If no eligible unchecked backlog bullet exists, return deterministic no-op status (`status=noop`, `reasonCode=PLAN_SEED_NO_UNCHECKED_SELF_IMPROVEMENT`) with no file writes.

### Plan Scaffold Template (required shape)
On successful selection, the command MUST create exactly one new **top** slice block in `IMPLEMENTATION_PLAN.md` using this heading and required subsections:

```md
## TASKPAD Intake Slice (YYYY-MM-DD): <promoted backlog theme> (`taskpad:plan-seed`)

### Distilled Scope
**Problem**
- TODO

**In scope**
- TODO

**Out of scope**
- TODO

### RepoPrompt Builder Context
- **Entry files (paths):**
  - TODO
- **Search queries/patterns:**
  - TODO
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "..."`
  - `select set ...`
  - `context --files --tree`

### Task Graph
- [ ] **TP001**: TODO
- [ ] **TP002**: TODO

### Acceptance Criteria
- TODO

### Verification Commands
~~~bash
bun run typecheck
~~~
```

Scaffold rules:
- New slice MUST be inserted before the current first `## TASKPAD Intake Slice ...` block (newest-at-top ordering).
- `Task Graph` TP IDs MUST start at `TP001` and be strictly ascending within the scaffold.
- Required headings MUST exist exactly once in the seeded block: `Distilled Scope`, `RepoPrompt Builder Context`, `Task Graph`, `Acceptance Criteria`, `Verification Commands`.

### Atomic Update Semantics (cross-file)
`taskpad:plan-seed` mutates two files in one logical transaction:
1. `IMPLEMENTATION_PLAN.md` (insert top scaffold)
2. `TASKPAD.md` (mark selected source bullet as `planned-YYYY-MM-DD`)

Required behavior:
- Apply both updates or neither (`all-or-nothing`).
- Write via atomic file replacement semantics (temp write + rename or equivalent).
- Any failure before commit MUST leave both target files byte-identical to pre-run state.
- Report output MUST include `selectedBacklogLine`, `newSliceHeading`, and `reasonCode` fields.

### Failure Reason Codes (deterministic set)
The command MUST use stable machine-readable reason codes:

- `PLAN_SEED_OK` — promotion applied, both files updated.
- `PLAN_SEED_NO_UNCHECKED_SELF_IMPROVEMENT` — no eligible unchecked source bullet; no-op.
- `PLAN_SEED_TASKPAD_SECTION_MISSING` — `## Self-Improvement Backlog` missing/invalid.
- `PLAN_SEED_PLAN_INSERT_ANCHOR_MISSING` — could not find valid insertion point for top intake slice.
- `PLAN_SEED_PLAN_REQUIRED_HEADING_MISSING` — destination plan does not satisfy required structure contract for seeded slice insertion.
- `PLAN_SEED_TASKPAD_WRITE_FAILED` — TASKPAD mutation write failed.
- `PLAN_SEED_PLAN_WRITE_FAILED` — IMPLEMENTATION_PLAN mutation write failed.
- `PLAN_SEED_ATOMIC_COMMIT_ABORTED` — transaction aborted to preserve all-or-nothing guarantee.
- `PLAN_SEED_INPUT_INVALID` — CLI/path/input contract invalid.

Reason-code rules:
- `status=seeded` requires `reasonCode=PLAN_SEED_OK`.
- `status=noop` requires one no-op code only (`PLAN_SEED_NO_UNCHECKED_SELF_IMPROVEMENT`).
- Structural validation failures MUST be non-zero exit with no file mutation.

## `taskpad:intake:autoplan` Contract
`taskpad:intake:autoplan` MUST provide one deterministic intake-to-plan handoff command that composes `taskpad:intake:recover`, `taskpad:plan-seed`, and `taskpad:plan-contract` (or `plan:integrity` when `taskpad:plan-contract` is not yet wired) into a single machine-readable verdict packet.

### Command Inputs
- `--taskpad <path>` (required): TASKPAD markdown path.
- `--plan <path>` (required): `IMPLEMENTATION_PLAN.md` path.
- `--date YYYY-MM-DD` (optional): deterministic marker date passthrough for `taskpad:plan-seed`.

### Deterministic Step Order (fixed)
The command MUST execute these canonical step IDs in exact order:
1. `intake-recover` → `taskpad:intake:recover`
2. `plan-seed` → `taskpad:plan-seed`
3. `plan-contract` → `taskpad:plan-contract` (or `plan:integrity` equivalent)

`steps` output MUST always include all three step IDs in this order, even when skipped.

### No-op Semantics (deterministic)
- If `intake-recover` returns `verdict != ready`, `plan-seed` and `plan-contract` MUST be `skipped` and final verdict MUST be `hold|blocked` matching recovery semantics.
- If `intake-recover` returns `ready` and `plan-seed` returns `status=noop` with `PLAN_SEED_NO_UNCHECKED_SELF_IMPROVEMENT`, then:
  - `plan-contract` MUST still run against the current plan,
  - final verdict MAY be `ready` when plan contract passes,
  - final `reasonCode` MUST be `AUTOPLAN_READY_NOOP_ALREADY_PLANNED`.
- If `plan-seed` returns `seeded`, `plan-contract` MUST run and validate the post-seed plan.
- Any unknown/malformed child output status MUST produce final `verdict=blocked` with deterministic runtime reason code.

### Output Schema (machine-readable)
`taskpad:intake:autoplan` MUST emit one JSON object:

```json
{
  "status": "pass|fail",
  "verdict": "ready|hold|blocked",
  "reasonCode": "AUTOPLAN_READY_PLANNED|AUTOPLAN_READY_NOOP_ALREADY_PLANNED|AUTOPLAN_HOLD_RECOVERY|AUTOPLAN_HOLD_PLAN_CONTRACT|AUTOPLAN_BLOCKED_RUNTIME",
  "taskpadPath": "string",
  "planPath": "string",
  "selectedBacklogLine": "string|null",
  "plannedMarker": "planned-YYYY-MM-DD|null",
  "newSliceHeading": "string|null",
  "steps": [
    {
      "id": "intake-recover|plan-seed|plan-contract",
      "command": "string",
      "status": "pass|fail|skipped",
      "exitCode": 0,
      "reasonCode": "string|null",
      "summary": "string"
    }
  ],
  "nextActions": ["string"]
}
```

Schema constraints:
- `status=pass` is allowed only when `verdict=ready`.
- `steps` MUST have exactly three entries in canonical order.
- `selectedBacklogLine`, `plannedMarker`, and `newSliceHeading` MUST be non-null only when `plan-seed` status is `pass` with seeded output.
- `plan-seed` skipped states require deterministic `reasonCode` (`SKIP_RECOVER_NOT_READY`).
- `plan-contract` skipped states require deterministic `reasonCode` (`SKIP_RECOVER_NOT_READY` or `SKIP_PLAN_SEED_FAILED`).
- `nextActions` MUST be deterministic for each `verdict/reasonCode` pair.

### Reason Codes (deterministic set)
- `AUTOPLAN_READY_PLANNED` — recover passed, plan seeded, plan contract passed.
- `AUTOPLAN_READY_NOOP_ALREADY_PLANNED` — recover passed, no unchecked self-improvement remained, plan contract passed.
- `AUTOPLAN_HOLD_RECOVERY` — recover returned `hold` and downstream steps were skipped.
- `AUTOPLAN_HOLD_PLAN_CONTRACT` — recover/seed passed but plan contract failed deterministic quality rules.
- `AUTOPLAN_BLOCKED_RUNTIME` — input/IO/child-contract/runtime failure, unknown status, missing required fields, or command execution failure.

### Exit Semantics
- Exit `0` only when `verdict=ready`.
- Exit non-zero when `verdict=hold|blocked`.
- Non-zero exits MUST still emit the full machine-readable JSON packet.

### Script wiring + operator usage
`package.json` MUST expose the orchestration entrypoint:

```json
"taskpad:intake:autoplan": "bun run tools/taskpad-intake-autoplan.ts"
```

Canonical usage:

```bash
bun run taskpad:intake:autoplan -- \
  --taskpad <path-to-TASKPAD.md> \
  --plan <path-to-IMPLEMENTATION_PLAN.md> \
  [--date YYYY-MM-DD]
```

## `taskpad:plan-prune` Contract
`taskpad:plan-prune` MUST deterministically compact `IMPLEMENTATION_PLAN.md` by archiving older **completed** intake slices while preserving active planning context at the top of the plan.

### Command Inputs
- `--plan <path>` (required): target `IMPLEMENTATION_PLAN.md`.
- `--keep <int>` (optional): number of newest completed slices to keep in-place. Default `5`.
- `--date YYYY-MM-DD` (optional): deterministic archive date override; default runtime local date.

Input rules:
- `keep` MUST be an integer `>= 0`; invalid values are contract errors.
- Command MUST reject unreadable/non-file plan paths.

### Keep-window Rules (deterministic)
1. Parse slices in source order using `## TASKPAD Intake Slice ...` headings.
2. Classify slice as `completed` only when its `Task Graph` contains zero unchecked TP entries (`- [ ] **TP...`).
3. Classify all other slices as `active`.
4. Determine prune candidates from completed slices only:
   - keep newest `keep` completed slices in place,
   - prune remaining older completed slices.
5. Active slices MUST remain byte-identical in the rewritten plan.

Determinism constraints:
- Identical plan bytes + identical flags MUST produce identical `kept/pruned` sets.
- Source order of pruned slices MUST be preserved in archive output.

### Archive Naming + Placement
- Archive root: `docs/archive/` (relative to repo root).
- Archive file name: `IMPLEMENTATION_PLAN_ARCHIVE_YYYY-MM-DD.md` where date comes from `--date` or runtime date.
- When archive file already exists for the same date, pruned slices MUST be appended (not overwritten) in deterministic source order.

### Machine-readable Output Schema
`taskpad:plan-prune` MUST emit one JSON object:

```json
{
  "status": "pruned|noop|rejected",
  "reasonCode": "PLAN_PRUNE_OK|PLAN_PRUNE_NOOP_WITHIN_KEEP_WINDOW|PLAN_PRUNE_INPUT_INVALID|PLAN_PRUNE_PLAN_READ_FAILED|PLAN_PRUNE_PLAN_STRUCTURE_INVALID|PLAN_PRUNE_ARCHIVE_WRITE_FAILED|PLAN_PRUNE_PLAN_WRITE_FAILED|PLAN_PRUNE_ATOMIC_COMMIT_ABORTED",
  "planPath": "string",
  "archivePath": "string|null",
  "keepWindow": 5,
  "completedSliceCount": 0,
  "keptCount": 0,
  "prunedCount": 0,
  "keptSliceHeadings": ["string"],
  "prunedSliceHeadings": ["string"],
  "summary": "string"
}
```

Schema constraints:
- `status=pruned` requires `reasonCode=PLAN_PRUNE_OK`, `prunedCount>0`, and non-null `archivePath`.
- `status=noop` requires `reasonCode=PLAN_PRUNE_NOOP_WITHIN_KEEP_WINDOW`, `prunedCount=0`, and `archivePath=null`.
- `status=rejected` MUST use one deterministic failure reason code and non-zero exit.
- `keptCount + prunedCount` MUST equal `completedSliceCount`.
- `keptSliceHeadings` and `prunedSliceHeadings` MUST preserve plan source order.

### Reason Codes (deterministic set)
- `PLAN_PRUNE_OK` — prune/archive + plan rewrite committed successfully.
- `PLAN_PRUNE_NOOP_WITHIN_KEEP_WINDOW` — completed slice count already within keep window; no writes.
- `PLAN_PRUNE_INPUT_INVALID` — missing/invalid flags (bad `--keep`, missing plan path, etc.).
- `PLAN_PRUNE_PLAN_READ_FAILED` — plan file missing/unreadable.
- `PLAN_PRUNE_PLAN_STRUCTURE_INVALID` — required intake-slice structure cannot be parsed safely.
- `PLAN_PRUNE_ARCHIVE_WRITE_FAILED` — archive write failed.
- `PLAN_PRUNE_PLAN_WRITE_FAILED` — plan rewrite failed.
- `PLAN_PRUNE_ATOMIC_COMMIT_ABORTED` — transaction aborted to preserve all-or-nothing safety.

### Exit + Write Semantics
- Exit `0` only for `status=pruned|noop`.
- Exit non-zero for `status=rejected`.
- Prune path MUST be atomic/all-or-nothing:
  - archive append/create and plan rewrite both commit, or neither commits.
  - partial writes are forbidden.

### Script wiring + operator usage
`package.json` MUST expose the prune entrypoint:

```json
"taskpad:plan-prune": "bun run tools/taskpad-plan-prune.ts"
```

Canonical usage:

```bash
bun run taskpad:plan-prune -- \
  --plan <path-to-IMPLEMENTATION_PLAN.md> \
  [--keep <int>] \
  [--date YYYY-MM-DD]
```

### Verification evidence checklist (`taskpad:plan-prune` TP005)
- Include one `pruned` run (`reasonCode=PLAN_PRUNE_OK`) with non-zero `prunedCount` and non-null `archivePath`.
- Include one `noop` run (`reasonCode=PLAN_PRUNE_NOOP_WITHIN_KEEP_WINDOW`) with `prunedCount=0` and `archivePath=null`.
- Validate `keptCount + prunedCount === completedSliceCount` in each captured JSON output.
- Confirm `prunedSliceHeadings` preserve source order and active/incomplete slices remain unchanged.
- Store compact command/result evidence in `docs/quality/taskpad-auto-ideation-report.md`.

## Output Schema (machine-readable)
Tool output MUST include a machine-readable JSON object with this schema shape:

```json
{
  "status": "seeded|deduped|noop|fallback",
  "triggered": true,
  "queueHealth": {
    "autonomousUncheckedCount": 0,
    "selfImprovementUncheckedCount": 0,
    "totalUnchecked": 0
  },
  "preflight": {
    "mode": "direct-write|fallback-artifact|error",
    "writable": true,
    "reasonCode": "PRECHECK_OK",
    "permissionClass": "none|permission-denied|non-permission",
    "detail": "string"
  },
  "candidates": [
    {
      "id": "string",
      "title": "string",
      "canonicalBullet": "- [ ] planned-YYYY-MM-DD ...",
      "score": 0,
      "rankingInputs": {
        "intakeGateSignal": "string",
        "recentSliceTheme": "string",
        "qualityRiskSignal": "string"
      },
      "scoreBreakdown": {
        "intakeGate": 0,
        "recentSliceTheme": 0,
        "qualityRisk": 0,
        "total": 0
      },
      "stableSortKey": "string",
      "tieBreak": {
        "canonicalCandidateId": "string",
        "canonicalTitle": "string",
        "canonicalBullet": "string"
      }
    }
  ],
  "selectedCandidateId": "string",
  "selectedOutcome": {
    "action": "inserted|deduped|noop|fallback-artifact",
    "taskpadPath": "string",
    "insertedLine": "number|null",
    "matchedExistingLine": "number|null",
    "semanticDedupe": {
      "decision": "inserted|deduped|not-applicable",
      "candidateSemanticKey": "string|null",
      "matchedSemanticKey": "string|null",
      "rationale": "string"
    }
  },
  "artifactPath": "string|null",
  "applyHint": "string|null"
}
```

Schema constraints:
- `preflight` is required when `triggered: true`.
- `preflight.mode=direct-write` requires `preflight.writable=true`.
- `preflight.mode=fallback-artifact` requires `preflight.writable=false` and permission-class reason code.
- `preflight.mode=error` requires non-zero exit and no TASKPAD mutation.
- `candidates.length === 3` when `triggered: true` and `preflight.mode !== error`.
- `candidates` must be sorted by the ranking snapshot precedence (`total DESC`, `qualityRisk DESC`, `recentSliceTheme DESC`, `intakeGate DESC`, then tie-break lexical fields ASC).
- Every candidate requires non-null `scoreBreakdown`, `stableSortKey`, and `tieBreak` fields.
- `stableSortKey` must be deterministic and unique within a single candidate set.
- `selectedCandidateId` must match the first candidate ID after sorting when triggered and `preflight.mode !== error`.
- `selectedOutcome.semanticDedupe` is required and additive-only (existing fields unchanged).
- `selectedOutcome.semanticDedupe.decision=deduped` requires non-null `candidateSemanticKey` and `matchedSemanticKey` with exact string equality.
- `selectedOutcome.semanticDedupe.decision=inserted` requires non-null `candidateSemanticKey` and null `matchedSemanticKey`.
- `selectedOutcome.semanticDedupe.decision=not-applicable` is reserved for `status=noop` and requires both semantic keys to be null.
- `status=noop` is used for non-empty-queue runs (`triggered: false` allowed in that case).
- `status=fallback` requires non-null `artifactPath` and `applyHint`.
- `status` values `seeded|deduped|noop` must keep backward-compatible meanings from the original contract.

## Status Semantics
- `seeded`: candidate inserted directly into TASKPAD (write succeeded).
- `deduped`: selected candidate already existed; no new insertion.
- `noop`: queues were not empty; ideation intentionally skipped.
- `fallback`: preflight classified path as non-writable (`permissionClass=permission-denied`); deterministic patch artifact emitted instead of mutating TASKPAD.

## Exit Semantics
- **PASS / seeded or deduped or noop or fallback**: exit `0` with JSON payload.
- **FAIL**: exit `1` for parse/contract/runtime errors, including `preflight.mode=error` non-permission failures (invalid paths, missing files, unexpected IO/runtime faults).

## Non-Goals
- LLM-generated freeform roadmap planning.
- Writing multiple new backlog bullets in one run.
- Re-prioritizing queues when unchecked work already exists.
