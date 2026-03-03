# IMPLEMENTATION_PLAN Active-Slice Integrity Contract

## Purpose
Define deterministic pass/fail rules for validating the newest TASKPAD intake slice in `IMPLEMENTATION_PLAN.md` before dispatching work to Builder.

## Active Slice Selection Rule
- The checker MUST locate the first (top-most) H2 heading matching `## TASKPAD Intake Slice ...`.
- Only that newest slice is validated.
- Older slices and archived plan files are out of scope.

## Required Headings Rule
Inside the active slice, these H3 headings MUST exist exactly once:

1. `### Distilled Scope`
2. `### RepoPrompt Builder Context`
3. `### Task Graph`
4. `### Acceptance Criteria`
5. `### Verification Commands`

Heading text matching is case-sensitive after trim.

## TP Task Format and Ordering Rule
Within `### Task Graph`, every executable task line MUST match:

- `- [ ] **TP###**: <task description>`

Where:
- `###` is exactly three digits.
- TP IDs are strictly ascending (e.g., `TP001`, `TP002`, `TP003`, ...).
- TP IDs are unique (no duplicates).
- No non-matching task-checkbox lines are allowed in the Task Graph.

## Verification Block Rule
Under `### Verification Commands`, the active slice MUST include one fenced bash block:

- Opening fence: ```` ```bash ````
- Closing fence: ```` ``` ````
- Block must contain at least one runnable command line.

A runnable command line is any non-empty, non-comment line (not starting with `#` after trim).

## Exit Semantics
### PASS (exit code `0`)
Return success only when all rules pass for the active slice.

### FAIL (exit code `1`)
Return failure when any rule fails, including but not limited to:
- no active TASKPAD intake slice found;
- missing/duplicate required headings;
- malformed TP task lines;
- TP IDs out of order or duplicated;
- missing/empty verification bash block.

Failure output should include:
- deterministic rule IDs,
- the failing slice heading,
- concise remediation guidance.

## Rule IDs (canonical)
### Base Integrity Rules
- `PLI001_ACTIVE_SLICE_MISSING`
- `PLI002_REQUIRED_HEADING_MISSING`
- `PLI003_REQUIRED_HEADING_DUPLICATE`
- `PLI004_TP_FORMAT_INVALID`
- `PLI005_TP_ORDER_INVALID`
- `PLI006_TP_DUPLICATE_ID`
- `PLI007_VERIFICATION_BLOCK_MISSING`
- `PLI008_VERIFICATION_BLOCK_EMPTY`

### Strict Active-Slice Rules
- `PLI009_NO_UNCHECKED_TP_TASKS`
- `PLI010_AMBIGUOUS_ACTIVE_SLICE`

## Strict Active-Slice Mode (`--strict-active-slice`)

### Purpose
Add deterministic enforcement for autonomous loops to prevent continued execution when the newest intake slice has no unchecked work or when top-slice activeness is ambiguous. This prevents intake drift where loops appear healthy while no executable TP tasks exist.

### Invocation
The strict mode is activated via the `--strict-active-slice` CLI flag:

```bash
bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice --format json
```

### Strict Mode Rules

#### PLI009_NO_UNCHECKED_TP_TASKS
**Condition**: The newest TASKPAD intake slice contains zero unchecked TP tasks.

**Detection**:
- Parse all task lines under `### Task Graph` in the active slice
- Count task lines where the checkbox is `[ ]` (unchecked)
- Fail if unchecked count equals zero

**Failure Signal**:
```
[PLI009_NO_UNCHECKED_TP_TASKS] Newest intake slice has no unchecked TP tasks.
Details:
  - Total TP tasks found: N
  - Unchecked TP tasks: 0
  - Checked TP tasks: N
Remediation: Archive the completed slice (via taskpad:plan-prune) or add new unchecked TP tasks to the active slice.
```

**Pass Condition**: At least one TP task in the active slice has an unchecked `[ ]` checkbox.

#### PLI010_AMBIGUOUS_ACTIVE_SLICE
**Condition**: Top-slice activeness cannot be deterministically resolved.

**Detection Scenarios**:
1. Multiple H2 headings match the `## TASKPAD Intake Slice` pattern before encountering a different H2 pattern
2. The first matching slice heading lacks a date component in parentheses `(YYYY-MM-DD)`
3. Zero or more than one slice exists in the IMPLEMENTATION_PLAN (no candidates OR multiple candidates with no clear ordering)

**Failure Signal**:
```
[PLI010_AMBIGUOUS_ACTIVE_SLICE] Cannot deterministically identify the active TASKPAD intake slice.
Details:
  - Candidates found: N (must be exactly 1)
  - Slice headings: ["## TASKPAD Intake Slice (2026-03-01)", "## TASKPAD Intake Slice (2026-02-28)"]
  - First heading lacks date component: false|true
Remediation: Ensure exactly one top-most H2 heading matches '## TASKPAD Intake Slice (<date>)' with a valid ISO date.
```

**Pass Condition**: Exactly one H2 heading matches the pattern and includes a valid date component, with no competing slices before it.

### Success/Failure Matrix

| Scenario | Strict Mode | Base Mode | Exit Code | Rule IDs Fired |
|----------|-------------|-----------|-----------|----------------|
| Valid slice with unchecked tasks | ✅ PASS | ✅ PASS | 0 | None |
| Valid slice, all tasks checked | ❌ FAIL | ✅ PASS | 1 | PLI009 |
| Multiple candidate slices | ❌ FAIL | ⚠️ PASS* | 1 | PLI010 |
| Slice heading missing date | ❌ FAIL | ⚠️ PASS* | 1 | PLI010 |
| No TASKPAD slice at all | ❌ FAIL | ❌ FAIL | 1 | PLI001 |
| Missing required heading | ❌ FAIL | ❌ FAIL | 1 | PLI002/PLI003 |
| Malformed TP task lines | ❌ FAIL | ❌ FAIL | 1 | PLI004/PLI005/PLI006 |
| Invalid verification block | ❌ FAIL | ❌ FAIL | 1 | PLI007/PLI008 |

*Base mode may select the first matching slice by simple regex, accepting ambiguous state as "good enough" for manual review.

### Machine-Readable Output Format

When `--format json` is used with strict mode, the output envelope includes strict-mode diagnostics:

```json
{
  "status": "fail" | "pass",
  "mode": "strict",
  "activeSlice": {
    "heading": "## TASKPAD Intake Slice (2026-03-01): ...",
    "line": 1,
    "hasUncheckedTasks": false,
    "totalTpTasks": 5,
    "uncheckedTpTasks": 0,
    "checkedTpTasks": 5
  },
  "violations": [
    {
      "ruleId": "PLI009_NO_UNCHECKED_TP_TASKS",
      "summary": "Newest intake slice has no unchecked TP tasks.",
      "details": {
        "totalTpTasks": 5,
        "uncheckedTpTasks": 0,
        "checkedTpTasks": 5
      },
      "remediation": "Archive the completed slice or add new unchecked TP tasks."
    }
  ],
  "baseViolations": [
    // Base integrity rule violations (if any)
  ],
  "validatedRules": [
    "PLI001_ACTIVE_SLICE_MISSING",
    "PLI002_REQUIRED_HEADING_MISSING",
    // ...
    "PLI009_NO_UNCHECKED_TP_TASKS",
    "PLI010_AMBIGUOUS_ACTIVE_SLICE"
  ]
}
```

### Deterministic Rule ID Ordering
When multiple violations occur, strict-mode rule IDs are emitted in this order:
1. `PLI001_ACTIVE_SLICE_MISSING` (base rule, takes precedence)
2. `PLI010_AMBIGUOUS_ACTIVE_SLICE` (must resolve slice identity before checking tasks)
3. `PLI009_NO_UNCHECKED_TP_TASKS` (task-state check)
4. Remaining base rules in canonical order (PLI002 through PLI008)

### Integration with Autoplan Loops
The `taskpad:intake:autoplan` tool uses strict mode to surface actionable blockers:

**When PLI009 fires**:
- Verdict: `hold` (not blocked, intentional stop point)
- Reason code: `AUTOPLAN_HOLD_STRICT_NO_UNCHECKED_TASKS`
- Next action: Archive completed slice via `taskpad:plan-prune` or add new tasks
- Does NOT create duplicate top slices

**When PLI010 fires**:
- Verdict: `blocked` (contract violation requiring manual fix)
- Reason code: `AUTOPLAN_BLOCKED_STRICT_AMBIGUOUS_SLICE`
- Next action: Fix IMPLEMENTATION_PLAN.md to have exactly one active slice with date

**When base rules fire in strict mode**:
- Verdict: `hold` (same as base mode)
- Reason code: `AUTOPLAN_HOLD_PLAN_CONTRACT`
- Next action: Fix base integrity issues per remediation guidance

### Verification Commands (Strict Mode)
```bash
# Check integrity with strict mode (JSON output for autonomous loops)
bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice --format json

# Human-readable strict mode output
bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice

# Base mode only (for backward compatibility)
bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md
```

## Non-Goals
- Auto-fixing malformed plan content.
- Validating historical/non-active intake slices.
- Enforcing task quality beyond structural integrity rules above.
- Automatically archiving completed slices (that's handled by `taskpad:plan-prune`).
