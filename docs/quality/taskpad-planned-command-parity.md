# TASKPAD Planned Command Parity Contract

## Purpose

Define a deterministic contract that validates every newly planned Work Queue item remains executable from queue marker → plan slice → command surface.

## Problem Statement

`TASKPAD.md` currently contains many `planned-YYYY-MM-DD` items whose referenced commands are not guaranteed to exist in `package.json` scripts or executable tool paths. This allows intake slices to look complete while handoff verification can still fail late (or silently drift) when a planned command is missing.

We need one deterministic contract that proves every newly planned Work Queue item remains executable from queue marker → plan slice → command surface.

## CLI Contract

### Command Inputs

| Argument | Required | Description |
|-----------|-----------|-------------|
| `--taskpad <path>` | ✅ | Path to TASKPAD markdown file |
| `--plan <path>` | ✅ | Path to IMPLEMENTATION_PLAN markdown file |
| `--package <path>` | ✅ | Path to package.json file |
| `--format <format>` | ❌ | Output format: `json` or `human` (default: json) |
| `--help, -h` | ❌ | Show help message and exit |

### Exit Codes

| Exit Code | Condition |
|-----------|-----------|
| `0` | All commands pass parity validation |
| `1` | One or more commands fail parity validation (missing, unmapped, or non-executable) |
| `2` | Input validation failure (invalid arguments, unreadable files) |

## Deterministic Output Schema

### JSON Format

When `--format json` is specified, the command MUST emit exactly one JSON object:

```json
{
  "status": "pass|fail",
  "inputs": {
    "taskpadPath": "string",
    "planPath": "string",
    "packagePath": "string"
  },
  "taskpadAnalysis": {
    "plannedItems": [
      {
        "lineNumber": 1,
        "rawText": "- [ ] planned-2026-03-01 Example task",
        "plannedDate": "2026-03-01",
        "markerShape": "unparenthesized",
        "sourceText": "Example task"
      }
    ],
    "plannedCount": 1
  },
  "planAnalysis": {
    "activeSlice": {
      "heading": "## TASKPAD Intake Slice (2026-03-01): ...",
      "line": 1,
      "date": "2026-03-01"
    },
    "verificationCommands": [
      "bun run typecheck",
      "bun test tests/tools/example.test.ts"
    ],
    "verificationCommandCount": 2
  },
  "commandSurface": {
    "packageScripts": {
      "taskpad:queue-health": "bun run tools/taskpad-queue-health.ts",
      "taskpad:auto-ideation": "bun run tools/taskpad-auto-ideation.ts",
      "taskpad:plan-seed": "bun run tools/taskpad-plan-seed.ts",
      ...
    },
    "toolPaths": [
      "tools/taskpad-queue-health.ts",
      "tools/taskpad-auto-ideation.ts",
      "tools/taskpad-plan-seed.ts",
      ...
    ]
  },
  "parityCheck": {
    "plannedCommands": [
      {
        "source": "work-queue|verification-block",
        "sourceLine": 42,
        "sourceItem": "planned-2026-03-01 Example task",
        "command": "taskpad:example-command",
        "mappedTo": "package-script|tool-path",
        "executable": true,
        "validationStatus": "VALID|MISSING_MAPPING|MISSING_SCRIPT|NON_EXECUTABLE_PATH|STALE_REFERENCE"
      }
    ],
    "summary": {
      "totalPlannedCommands": 5,
      "validCommands": 4,
      "invalidCommands": 1,
      "invalidCommandCount": 1
    }
  },
  "violations": [
    {
      "ruleId": "PARITY001_MISSING_SCRIPT",
      "severity": "error|warning",
      "source": "work-queue|verification-block",
      "sourceLine": 42,
      "sourceItem": "planned-2026-03-01 Example task",
      "command": "taskpad:missing-command",
      "details": {
        "scriptKey": "taskpad:missing-command",
        "scriptExists": false,
        "toolPath": null,
        "toolExists": false
      },
      "remediation": "Add the missing script to package.json or update the taskpad item to reference an existing command."
    }
  ],
  "timestamp": "2026-03-01T12:00:00.000Z"
}
```

### Human Format

When `--format human` is specified or default, the command MUST emit:

```
TASKPAD Planned Command Parity: PASS
─────────────────────────────────────────
Inputs:
  - taskpad: /path/to/TASKPAD.md
  - plan: /path/to/IMPLEMENTATION_PLAN.md
  - package: /path/to/package.json

Planned Items (TASKPAD):
  - 1 planned items found

Active Slice (IMPLEMENTATION_PLAN):
  - ## TASKPAD Intake Slice (2026-03-01): ...
  - 2 verification commands

Parity Check:
  - Total planned commands: 5
  - Valid commands: 4
  - Invalid commands: 1

Violations: 0

All planned commands are executable from queue → slice → command surface.
```

For failures:

```
TASKPAD Planned Command Parity: FAIL
─────────────────────────────────────────
Inputs:
  - taskpad: /path/to/TASKPAD.md
  - plan: /path/to/IMPLEMENTATION_PLAN.md
  - package: /path/to/package.json

Planned Items (TASKPAD):
  - 1 planned items found

Active Slice (IMPLEMENTATION_PLAN):
  - ## TASKPAD Intake Slice (2026-03-01): ...
  - 2 verification commands

Parity Check:
  - Total planned commands: 5
  - Valid commands: 4
  - Invalid commands: 1

Violations: 1
  - [PARITY001_MISSING_SCRIPT] work-queue:42: planned-2026-03-01 Example task references 'taskpad:missing-command' which does not exist in package.json
    Remediation: Add the missing script to package.json or update the taskpad item to reference an existing command.
```

## Planned-Marker Detection Contract

### Accepted Marker Shapes

The parity gate supports TWO deterministic planned-marker shapes for checked Work Queue items. Both shapes are recognized as valid planned markers.

**Marker shape definitions:**

| Shape | Pattern | Example | Canonical Form |
|-------|---------|---------|----------------|
| **Unparenthesized** | `planned-YYYY-MM-DD` | `planned-2026-03-01` | `planned-2026-03-01` |
| **Parenthesized** | `(planned-YYYY-MM-DD)` | `(planned-2026-03-01)` | `planned-2026-03-01` |

**Examples:**

```
- [ ] planned-2026-03-01 Implement feature X Verify: typecheck
- [ ] (planned-2026-03-02) Implement feature Y Verify: test
- [ ] planned-2026-03-03 Mixed marker style Verify: lint
```

**Canonicalization rules:**
- All markers are normalized to the unparenthesized form (`planned-YYYY-MM-DD`) internally
- The original marker shape is preserved in `markerShape` metadata for observability
- Marker shape does NOT affect parity validation—both shapes are equally valid

### Date Format Requirements

All planned markers MUST follow strict ISO 8601 date format:

- **Pattern**: `YYYY-MM-DD`
- **Year**: 4 digits (`\d{4}`)
- **Month**: 2 digits (`01`–`12`)
- **Day**: 2 digits (`01`–`31`)
- **Separator**: Hyphen (`-`)

**Valid examples:**
- `2026-03-01`
- `2025-12-31`
- `2024-01-01`

**Invalid examples:**
- `2026-3-1` (missing zero padding)
- `03-01-2026` (wrong order)
- `2026/03/01` (wrong separator)
- `2026-13-01` (invalid month)
- `2026-03-32` (invalid day)

### Ambiguity Rules

The parser follows deterministic ambiguity resolution rules to ensure stable behavior:

#### Rule 1: First Marker Wins

If a line contains multiple markers (unlikely but possible), only the first marker is recognized as the planned date.

**Example:**
```
- [ ] planned-2026-03-01 Task description (planned-2026-03-02) Verify: test
```
- Recognized marker: `planned-2026-03-01`
- Result: `plannedDate = "2026-03-01"`
- Rule ID emitted: `PARITY008_MULTIPLE_MARKERS` (warning)

#### Rule 2: Parentheses Must Be Balanced

Parenthesized markers MUST have matching opening and closing parentheses.

**Examples:**
- ✅ Valid: `(planned-2026-03-01)` → `plannedDate = "2026-03-01"`, `markerShape = "parenthesized"`
- ❌ Invalid: `(planned-2026-03-01` → Emits `PARITY009_UNBALANCED_PARENS`
- ❌ Invalid: `planned-2026-03-01)` → Emits `PARITY009_UNBALANCED_PARENS`

#### Rule 3: No Whitespace in Marker String

The marker string (with or without parentheses) MUST NOT contain internal whitespace.

**Examples:**
- ✅ Valid: `planned-2026-03-01` → `plannedDate = "2026-03-01"`
- ❌ Invalid: `planned 2026-03-01` → Emits `PARITY010_WHITESPACE_IN_MARKER`
- ❌ Invalid: `(planned-2026-03-01 )` → Emits `PARITY010_WHITESPACE_IN_MARKER`

#### Rule 4: Marker Must Follow Checkbox

Planned markers MUST immediately follow the unchecked checkbox pattern `- [ ]`.

**Pattern:** `^\s*[-*+]\s+\[\s*\]\s+(planned-YYYY-MM-DD|(planned-YYYY-MM-DD))`

**Examples:**
- ✅ Valid: `- [ ] planned-2026-03-01 Task`
- ✅ Valid: `* [ ] (planned-2026-03-02) Task`
- ❌ Invalid: `- [x] planned-2026-03-01 Task` → Checked item, ignored (not a planned marker)
- ❌ Invalid: `- [ ] Task planned-2026-03-01` → Emits `PARITY011_MARKER_POSITION`

### Deterministic Rule IDs for Marker Detection

| Rule ID | Name | Severity | Condition | Remediation |
|---------|------|-----------|-----------|-------------|
| `PARITY008_MULTIPLE_MARKERS` | Multiple markers detected | warning | Line contains more than one planned marker; only the first is used. Remove or consolidate markers. |
| `PARITY009_UNBALANCED_PARENS` | Unbalanced parentheses | error | Parenthesized marker has mismatched parentheses. Fix opening/closing parentheses. |
| `PARITY010_WHITESPACE_IN_MARKER` | Whitespace in marker | error | Marker string contains invalid internal whitespace. Remove spaces within marker. |
| `PARITY011_MARKER_POSITION` | Marker not after checkbox | warning | Marker does not follow unchecked checkbox pattern. Move marker to correct position. |
| `PARITY012_INVALID_DATE_FORMAT` | Invalid date format | error | Date portion is not valid ISO 8601 format. Fix date to `YYYY-MM-DD`. |
| `PARITY013_MARKER_AMBIGUOUS` | Ambiguous marker | error | Marker cannot be deterministically parsed. Rewrite line with canonical marker shape. |

### Marker Shape Metadata

The parity report includes marker shape metadata for each detected planned item to enable observability and migration analysis.

**Extended `PlannedItem` schema:**
```json
{
  "lineNumber": 42,
  "rawText": "- [ ] (planned-2026-03-01) Task description Verify: typecheck",
  "plannedDate": "2026-03-01",
  "markerShape": "parenthesized",
  "sourceText": "Task description",
  "verifyCommands": ["typecheck"]
}
```

**`markerShape` enum values:**
- `"unparenthesized"` — Marker format: `planned-YYYY-MM-DD`
- `"parenthesized"` — Marker format: `(planned-YYYY-MM-DD)`

**Canonical output:**
- All planned items in output use the canonical form `planned-YYYY-MM-DD` regardless of input shape
- The `markerShape` field preserves the original shape for analysis
- This ensures deterministic JSON ordering while maintaining observability

### Migration Guidance

For new TASKPAD planning runs, prefer the **unparenthesized** marker shape (`planned-YYYY-MM-DD`) as the canonical form.

**Rationale:**
1. The unparenthesized shape is the original format used by parity tooling
2. It is more readable and concise
3. No parentheses to balance or potentially mistype
4. Existing parenthesized markers are fully supported and do not require immediate migration

**Recommended canonical marker format:**
```
- [ ] planned-YYYY-MM-DD Task description Verify: <command>
```

**Canonical formatting checklist for future TASKPAD planning runs:**

When creating new planned Work Queue items, follow these conventions:

- [ ] Use unparenthesized marker: `planned-YYYY-MM-DD` (not `(planned-YYYY-MM-DD)`)
- [ ] Use ISO 8601 date format with zero-padding: `2026-03-01` (not `2026-3-1`)
- [ ] Place marker immediately after checkbox: `- [ ] planned-YYYY-MM-DD ...` (no intervening space)
- [ ] Include Verify: clause with executable command reference
- [ ] Use comma separation for multiple verification commands

**Examples for future planning runs:**

```markdown
# Single verification command
- [ ] planned-2026-03-01 Implement user authentication Verify: bun test tests/auth.test.ts

# Multiple verification commands
- [ ] planned-2026-03-02 Add API integration Verify: typecheck, bun test tests/api.test.ts

# Complex verification flow
- [ ] planned-2026-03-03 Deploy production pipeline Verify: bun run test:e2e, bun run verify:production
```

**Migration checklist (optional):**
- [ ] Audit existing planned items for marker shape consistency
- [ ] Document marker shape preferences in intake tooling docs
- [ ] Consider adding `taskpad:normalize-planned-markers` command for bulk migration (planned future enhancement)

### Parsing Implementation Notes

The parser MUST implement the following logic:

1. **Match Work Queue items** using pattern: `^\s*[-*+]\s+\[\s*\]\s+`
2. **Extract marker** using alternation pattern:
   - Option 1: `planned-(\d{4}-\d{2}-\d{2})`
   - Option 2: `\(planned-(\d{4}-\d{2}-\d{2})\)`
3. **Validate date** using strict ISO 8601 format:
   - Year: 1900–2100 (reasonable range)
   - Month: 01–12
   - Day: 01–31 (month-specific validation optional)
4. **Emit rule IDs** for any detected ambiguities or violations
5. **Canonicalize marker** to `planned-YYYY-MM-DD` for output
6. **Preserve `markerShape`** metadata from original input

**Deterministic ordering guarantees:**
- Planned items are sorted by line number (ascending)
- Marker violations are sorted by canonical rule ID order (PARITY008 → PARITY013)
- Within each rule ID, violations are sorted by line number

## Command Reference Parsing

### Work Queue Verify: Clauses

Planned Work Queue items in TASKPAD may include optional `Verify:` clauses that specify command(s) used for verification.

**Canonical Verify: clause format:**
```
- [ ] planned-YYYY-MM-DD <task description> Verify: <command>
```

**Parenthesized marker variant:**
```
- [ ] (planned-YYYY-MM-DD) <task description> Verify: <command>
```

**Multiple Verify: commands:**
```
- [ ] planned-2026-03-01 <task description> Verify: <command1>, <command2>, <command3>
```

**Command forms:**
1. **package.json script alias**: `taskpad:queue-health`, `plan:integrity`, `test:quality:headless`
2. **npm script alias**: `typecheck`, `test`, `lint`
3. **Direct tool path**: `tools/taskpad-queue-health.ts`, `bun run tools/example.ts`

**Extraction rules:**
- `Verify:` is case-insensitive
- Commands are separated by commas (`,`) or `and` keyword
- Whitespace around commands is trimmed
- If `Verify:` is absent, no command reference is assumed (planned item is queue-only)

### Plan Slice Verification Commands Block

The newest active intake slice's `### Verification Commands` section contains a fenced bash block with executable commands.

**Canonical format:**
```markdown
### Verification Commands
```bash
bun run typecheck
bun test tests/tools/example.test.ts
```
```

**Extraction rules:**
- Parse only the fenced `bash` block under `### Verification Commands`
- Ignore comment lines (starting with `#`)
- Ignore empty lines
- Each non-empty, non-comment line is a verification command

### Normalization Pipeline

For each extracted command reference:

1. **Strip execution prefix**: Remove `bun run`, `npm run`, `node`, `bunx`, `npx` prefixes
2. **Trim whitespace**: Collapse multiple spaces to single space, trim leading/trailing
3. **Resolve alias to script name**:
   - `taskpad:*` → look up in `package.json` scripts
   - `plan:*` → look up in `package.json` scripts
   - `pilot:*` → look up in `package.json` scripts
   - `test:*` → look up in `package.json` scripts
   - `typecheck`, `test`, `lint`, etc. → look up in `package.json` scripts
4. **Resolve direct tool path**:
   - If command looks like a file path (`tools/*.ts`, `*.ts`), verify file exists
   - File path is resolved relative to repository root

## Command Surface Validation

### package.json Script Validation

**Validation steps:**

1. **Parse package.json** and extract `scripts` object
2. **For each script reference**:
   - Check if script key exists in `scripts` object
   - If exists, extract the script command value
   - Validate the script command itself is executable (resolve any nested script references)
3. **Resolve nested scripts**: If script A references script B (e.g., `"taskpad:queue-health": "bun run tools/taskpad-queue-health.ts"`), validate B exists

**Validation outcome:**
- `VALID`: Script exists and command is resolvable
- `MISSING_SCRIPT`: Script key does not exist in `package.json`

### Tool Path Validation

**Validation steps:**

1. **Normalize path**:
   - Remove `bun run`, `npm run`, `node` prefixes
   - Resolve relative to repository root
2. **Check file existence**:
   - Verify `.ts` or `.js` file exists
   - Verify file is readable
3. **Check executable context** (heuristic):
   - If `.ts` file, assume `bun run` execution context
   - If `.js` file, assume `node` or `bun` execution context

**Validation outcome:**
- `VALID`: Tool file exists and is executable within project context
- `NON_EXECUTABLE_PATH`: Tool file does not exist or is not in expected location
- `STALE_REFERENCE`: Path exists but is deprecated/moved (manual review required)

## Rule Taxonomy

### Stable Rule IDs

| Rule ID | Name | Severity | Condition |
|----------|-------|-----------|
| `PARITY001_MISSING_SCRIPT` | Missing script reference | error | Referenced package.json script does not exist |
| `PARITY002_MISSING_TOOL_PATH` | Missing tool path | error | Referenced tool file does not exist |
| `PARITY003_NON_EXECUTABLE_PATH` | Non-executable path | error | Referenced path is not executable (wrong extension, invalid location) |
| `PARITY004_STALE_REFERENCE` | Stale reference | warning | Referenced script/path exists but is marked deprecated in docs |
| `PARITY005_NO_COMMAND_REFERENCE` | No command reference | warning | Planned item has no `Verify:` clause and no verification command is mapped |
| `PARITY006_AMBIGUOUS_MAPPING` | Ambiguous mapping | error | Command reference could map to multiple scripts/paths |
| `PARITY007_PARSE_FAILURE` | Parse failure | error | Cannot parse TASKPAD or IMPLEMENTATION_PLAN structure |
| `PARITY008_MULTIPLE_MARKERS` | Multiple markers detected | warning | Line contains more than one planned marker; only the first is used |
| `PARITY009_UNBALANCED_PARENS` | Unbalanced parentheses | error | Parenthesized marker has mismatched parentheses |
| `PARITY010_WHITESPACE_IN_MARKER` | Whitespace in marker | error | Marker string contains invalid internal whitespace |
| `PARITY011_MARKER_POSITION` | Marker not after checkbox | warning | Marker does not follow unchecked checkbox pattern |
| `PARITY012_INVALID_DATE_FORMAT` | Invalid date format | error | Date portion is not valid ISO 8601 format |
| `PARITY013_MARKER_AMBIGUOUS` | Ambiguous marker | error | Marker cannot be deterministically parsed |

### Severity Levels

- **error**: Blocking issue that must be fixed before Builder dispatch
- **warning**: Non-blocking issue that should be reviewed but does not block handoff

### Canonical Ordering

Violations MUST be emitted in this exact order for deterministic output:

1. `PARITY008_MULTIPLE_MARKERS` (all instances)
2. `PARITY009_UNBALANCED_PARENS` (all instances)
3. `PARITY010_WHITESPACE_IN_MARKER` (all instances)
4. `PARITY011_MARKER_POSITION` (all instances)
5. `PARITY012_INVALID_DATE_FORMAT` (all instances)
6. `PARITY013_MARKER_AMBIGUOUS` (all instances)
7. `PARITY001_MISSING_SCRIPT` (all instances)
8. `PARITY002_MISSING_TOOL_PATH` (all instances)
9. `PARITY003_NON_EXECUTABLE_PATH` (all instances)
10. `PARITY004_STALE_REFERENCE` (all instances)
11. `PARITY005_NO_COMMAND_REFERENCE` (all instances)
12. `PARITY006_AMBIGUOUS_MAPPING` (all instances)
13. `PARITY007_PARSE_FAILURE` (all instances)

Within each rule ID, violations MUST be sorted by:
1. Source (`work-queue` before `verification-block`)
2. Line number (ascending)

## Queue → Slice Linking Assumptions

### Assumption 1: Planned Date Mappings to Active Slice Date

When validating parity, the gate MUST assume that `planned-YYYY-MM-DD` items in TASKPAD map to the active intake slice in IMPLEMENTATION_PLAN with matching or newer date.

**Validation rule:**
- If a planned item has date `2026-03-01`, verify that:
  - The active slice date is `>= 2026-03-01`, OR
  - No slice with date `>= 2026-03-01` exists (item is pre-slice)
- This ensures planned items are not orphaned (planned but never promoted to a slice)

### Assumption 2: Verification Commands Are Slice-Scoped

Verification commands in the `### Verification Commands` block are assumed to validate the work described in that slice only.

**Validation rule:**
- Do NOT cross-reference verification commands from other slices
- Only validate the newest (top) slice's verification commands
- Historical slice verification commands are out of scope for parity checking

### Assumption 3: Work Queue Items Are Pre-Execution

Planned items in Work Queue are assumed to be pre-execution markers.

**Validation rule:**
- A planned item with `Verify:` clause indicates the verification command(s) to be used when that item is actively worked on
- The gate validates that the verification command(s) exist and are executable
- The gate does NOT execute the commands or validate their runtime behavior

### Assumption 4: Fallback Artifacts Are Out of Scope

Fallback artifacts generated by `taskpad:auto-ideation`, `taskpad:plan-seed`, etc. are NOT validated by this gate.

**Validation rule:**
- Only validate explicit `Verify:` clauses and `### Verification Commands` block
- Ignore fallback artifact references and apply hints
- Fallback parity is covered by separate validation gates

## Deterministic Ordering Guarantees

### Output Ordering

The following outputs MUST be deterministically ordered:

1. **`plannedItems` array**: Sorted by line number (ascending)
2. **`verificationCommands` array**: Sorted by occurrence order in source (line number ascending)
3. **`plannedCommands` array**: Sorted by:
   - Source (`work-queue` before `verification-block`)
   - Line number (ascending)
4. **`violations` array**: Sorted by:
   - Rule ID (canonical order)
   - Source (`work-queue` before `verification-block`)
   - Line number (ascending)

### String Comparison

All string comparisons (task text, command references, etc.) MUST be:

- Case-insensitive for matching (e.g., `Verify:` matches `verify:`)
- Preserved case for output (original text is displayed as-is)
- Whitespace-normalized (collapsed spaces, trimmed) for semantic comparison

### Date Parsing

`planned-YYYY-MM-DD` dates MUST be parsed as:

- Strict ISO 8601 format: `YYYY-MM-DD`
- UTC timezone assumed
- Validation: Year must be 4 digits, month 2 digits, day 2 digits
- Invalid dates fail with `PARITY007_PARSE_FAILURE`

## Intake Verification Integration

### Pre-Dispatch Gate

The `taskpad:planned-command-parity` gate MUST be run as a pre-dispatch check in the intake verification flow.

**Canonical verification command:**
```bash
bun run taskpad:planned-command-parity -- \
  --taskpad "/path/to/TASKPAD.md" \
  --plan "/path/to/IMPLEMENTATION_PLAN.md" \
  --package "/path/to/package.json" \
  --format json
```

**Exit semantics:**
- Exit `0` → All planned commands have parity; safe to dispatch Builder
- Exit `1` → One or more planned commands lack parity; fail fast before Builder dispatch
- Exit `2` → Input validation failed; fix arguments/file paths and retry

### Integration with verify:taskpad:intake:full

The `verify:taskpad:intake:full` command MUST compose `taskpad:planned-command-parity` with other intake gates.

**Expected order:**
1. `taskpad:queue-health` (validate queues have unchecked work)
2. `plan:integrity` (validate plan structure and active slice)
3. `taskpad:planned-command-parity` (validate command parity for planned items)
4. Final verdict: pass/fail based on combined gate results

## Fixture Requirements

### Pass Fixtures

Fixtures demonstrating successful parity MUST include:

1. **Planned items with valid Verify:** clauses referencing existing package.json scripts
2. **Active slice with Verification Commands block containing valid, executable commands
3. **All commands resolve** to either a package.json script or an existing tool path
4. **Zero violations** in the output

**Example fixture data:**
```
TASKPAD:
  - [ ] planned-2026-03-01 Implement feature X Verify: taskpad:auto-ideation

IMPLEMENTATION_PLAN:
  ### Verification Commands
  ```bash
  bun run typecheck
  bun test tests/tools/taskpad-auto-ideation.test.ts
  ```

package.json:
  "scripts": {
    "taskpad:auto-ideation": "bun run tools/taskpad-auto-ideation.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  }
```

**Marker shape pass fixture (mixed styles):**
```
TASKPAD:
  - [ ] planned-2026-03-01 Unparenthesized marker task Verify: typecheck
  - [ ] (planned-2026-03-02) Parenthesized marker task Verify: test
  - [ ] planned-2026-03-03 Another unparenthesized marker Verify: lint
  - [ ] (planned-2026-03-04) Another parenthesized marker Verify: format:check

IMPLEMENTATION_PLAN:
  ### Verification Commands
  ```bash
  bun run typecheck
  bun test
  bun run lint
  bun run format:check
  ```

package.json:
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "lint": "eslint src tools tests",
    "format:check": "prettier --check \"src/**/*.ts\""
  }
```

### Failure Fixtures

Fixtures MUST cover each failure class:

1. **PARITY001_MISSING_SCRIPT**: Planned item references non-existent package.json script
2. **PARITY002_MISSING_TOOL_PATH**: Planned item references non-existent tool file
3. **PARITY003_NON_EXECUTABLE_PATH**: Planned item references path with wrong extension or invalid location
4. **PARITY004_STALE_REFERENCE**: Planned item references deprecated script/path (commented or marked as moved)
5. **PARITY005_NO_COMMAND_REFERENCE**: Planned item has no `Verify:` clause and slice has no matching command
6. **PARITY006_AMBIGUOUS_MAPPING**: Command reference could map to multiple scripts
7. **PARITY007_PARSE_FAILURE**: TASKPAD or IMPLEMENTATION_PLAN has malformed structure
8. **PARITY008_MULTIPLE_MARKERS**: Line contains multiple planned markers
9. **PARITY009_UNBALANCED_PARENS**: Parenthesized marker has mismatched parentheses
10. **PARITY010_WHITESPACE_IN_MARKER**: Marker contains invalid internal whitespace
11. **PARITY011_MARKER_POSITION**: Marker does not follow unchecked checkbox pattern
12. **PARITY012_INVALID_DATE_FORMAT**: Date is not valid ISO 8601 format
13. **PARITY013_MARKER_AMBIGUOUS**: Marker cannot be deterministically parsed

**Mixed marker shape fixture:**
```
TASKPAD:
  - [ ] planned-2026-03-01 Task with unparenthesized marker Verify: typecheck
  - [ ] (planned-2026-03-02) Task with parenthesized marker Verify: test
  - [ ] planned-2026-03-03 Task without Verify clause

IMPLEMENTATION_PLAN:
  ### Verification Commands
  ```bash
  bun run typecheck
  bun test
  ```

package.json:
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  }
```

**Invalid marker shape fixtures:**
- `taskpad-planned-command-parity-invalid-marker-1.taskpad.md`: Unbalanced parentheses `(planned-2026-03-01`
- `taskpad-planned-command-parity-invalid-marker-2.taskpad.md`: Whitespace in marker `planned 2026-03-01`
- `taskpad-planned-command-parity-invalid-marker-3.taskpad.md`: Invalid date `planned-2026-3-1`
- `taskpad-planned-command-parity-invalid-marker-4.taskpad.md`: Marker not after checkbox `- [x] planned-2026-03-01`

**Fixture naming convention:**
- `tests/tools/fixtures/taskpad-planned-command-parity-pass.taskpad.md`
- `tests/tools/fixtures/taskpad-planned-command-parity-pass.plan.md`
- `tests/tools/fixtures/taskpad-planned-command-parity-pass.package.json`
- `tests/tools/fixtures/taskpad-planned-command-parity-missing-script.taskpad.md`
- `tests/tools/fixtures/taskpad-planned-command-parity-missing-tool-path.plan.md`
- (etc.)

## Documentation Requirements

### README.md Updates

The project README MUST include:

1. **CLI entry point**: `taskpad:planned-command-parity` script in package.json scripts section
2. **Usage example**: Clear command invocation with required arguments
3. **Exit code reference**: Documented 0/1/2 exit semantics
4. **Integration notes**: How this gate fits into intake verification flow

**Example README section:**
```markdown
### TASKPAD Planned Command Parity
Validates that every planned Work Queue item has an executable command reference in package.json or tool paths.

```bash
# Check command parity for planned items
bun run taskpad:planned-command-parity -- \
  --taskpad "/path/to/TASKPAD.md" \
  --plan "/path/to/IMPLEMENTATION_PLAN.md" \
  --package "/path/to/package.json"

# Get JSON output for CI/automation
bun run taskpad:planned-command-parity -- \
  --taskpad "/path/to/TASKPAD.md" \
  --plan "/path/to/IMPLEMENTATION_PLAN.md" \
  --package "/path/to/package.json" \
  --format json
```

**Exit codes:**
- `0`: All planned commands have parity
- `1`: One or more commands fail parity (missing/unmapped/non-executable)
- `2`: Input validation failure

See full contract: [docs/quality/taskpad-planned-command-parity.md](docs/quality/taskpad-planned-command-parity.md)
```

### Quality Contract Docs

Update `docs/quality/taskpad-auto-ideation.md` or create a new section referencing this contract.

**Required documentation points:**
1. Link to this contract document
2. When to run the gate (pre-dispatch)
3. How to interpret violations and remediation steps
4. Integration with `verify:taskpad:intake:full`

## Non-Goals

The following are explicitly OUT OF SCOPE:

- Executing verification commands (only validates executability, not runtime behavior)
- Validating fallback artifact commands (covered by separate validation)
- Rewriting planned items or implementation plan slices
- Validating historical (archived) slices or completed tasks
- Cross-referencing commands across different slices
- Runtime performance or timeout validation for commands

## Version

Contract version: 1.0

Last updated: 2026-03-01
