# TASKPAD Queue Health Parser Contract

## Purpose
Define deterministic parsing and pass/fail semantics for the queue-health gate that protects intake runs from an empty executable backlog.

## Queue Classification

### Executable Queues (Ready for Builder/Engineer)
These queues contain immediately actionable work items that can be executed in the next cycle:

1. `## Work Queue` — Primary execution queue for Builder-ready tasks
2. `## Execution Queue` — Secondary execution queue for runtime/ops tasks

### Intake/Planning Queues (Not Directly Executable)
These queues contain backlog items that require promotion/seeding before becoming executable:

3. `## Autonomous Kickoff Queue` — Auto-ideation candidate pool
4. `## Self-Improvement Backlog` — Future improvement ideas and staging area

## Target Sections (exact headings)
The checker MUST only inspect unchecked work items inside these H2 sections:

1. `## Work Queue` (executable)
2. `## Execution Queue` (executable)
3. `## Autonomous Kickoff Queue` (intake/planning)
4. `## Self-Improvement Backlog` (intake/planning)

No unchecked items outside these sections count toward queue health.

## Section Boundary Rules
- Heading match is case-sensitive and must match exact text above after trim.
- Section content starts on the line after the matched H2 heading.
- Section content ends at the next H2 heading (`## ...`) or end-of-file.
- The four sections may appear in any order.

## Unchecked Item Detection Rules
Within each target section, count a line as an executable unchecked item when it matches a markdown task bullet with an unchecked box:
- Accept common bullet markers: `-`, `*`, `+`.
- Accept optional indentation before bullet.
- Accept `[ ]` and `[ ]` with internal whitespace variants (e.g., `[  ]`).
- Ignore checked items (`[x]`/`[X]`).
- Ignore non-task bullets, prose, and tasks in non-target sections.

Nested unchecked items inside the target sections are valid and count.

## Contract Output Semantics

### Per-Section Count Fields (Deterministic Ordering)
The tool MUST compute per-section unchecked counts in this exact order:

```typescript
interface QueueHealthCounts {
  // Executable queues (Builder-ready)
  workQueueUncheckedCount: number;
  executionQueueUncheckedCount: number;

  // Intake/planning queues (require promotion/seeding)
  autonomousUncheckedCount: number;
  selfImprovementUncheckedCount: number;

  // Aggregates (for backward compatibility and quick checks)
  executableQueueTotal: number;       // workQueueUncheckedCount + executionQueueUncheckedCount
  intakeQueueTotal: number;           // autonomousUncheckedCount + selfImprovementUncheckedCount
  totalUnchecked: number;             // all sections combined
}
```

**Deterministic JSON output ordering (keys alphabetically sorted):**
```json
{
  "autonomousUncheckedCount": 0,
  "executionQueueUncheckedCount": 0,
  "intakeQueueTotal": 0,
  "selfImprovementUncheckedCount": 0,
  "totalUnchecked": 0,
  "workQueueUncheckedCount": 0,
  "executableQueueTotal": 0
}
```

### Readiness Semantics

#### Executable Readiness (Primary Signal)
The **canonical readiness signal** for auto-ideation/ideation gating is:

- **READY**: `executableQueueTotal >= 1`
  - At least one unchecked item exists in `Work Queue` or `Execution Queue`
  - Builder/Engineer loops can proceed with directly executable work

- **NOT READY**: `executableQueueTotal === 0`
  - No unchecked items exist in either executable queue
  - Auto-ideation MUST be triggered to seed a Work Queue item
  - Intake returns `hold` until executable queue is populated

#### Intake Readiness (Secondary Signal)
For planning/intake context only (does not gate Builder):

- **Intake has backlog**: `intakeQueueTotal >= 1`
  - At least one unchecked item in `Autonomous Kickoff Queue` or `Self-Improvement Backlog`
  - Indicates potential future work that can be promoted/seeded

- **Intake empty**: `intakeQueueTotal === 0`
  - Both intake queues are empty
  - Requires explicit backlog addition or auto-ideation to generate new candidates

### PASS/FAIL Determinism

#### PASS (Exit 0)
The tool exits with code `0` when `executableQueueTotal >= 1`.

**Output format (human + JSON):**
```
TASKPAD queue health: PASS
- workQueueUncheckedCount: 1
- executionQueueUncheckedCount: 0
- autonomousUncheckedCount: 2
- selfImprovementUncheckedCount: 1
- executableQueueTotal: 1
- intakeQueueTotal: 3
- totalUnchecked: 4
```

#### FAIL (Exit 1)
The tool exits with code `1` when `executableQueueTotal === 0`.

**Failure cases (all map to exit 1):**
- `Work Queue` missing or empty (no unchecked bullets)
- `Execution Queue` missing or empty (no unchecked bullets)
- Both executable queues empty
- Intake queues may or may not have unchecked items (irrelevant to executable readiness)

**Output format (human + JSON):**
```
TASKPAD queue health: FAIL
- reasonCode: "QH001_EXECUTABLE_QUEUES_EMPTY"
- workQueueUncheckedCount: 0
- executionQueueUncheckedCount: 0
- autonomousUncheckedCount: 0
- selfImprovementUncheckedCount: 2
- executableQueueTotal: 0
- intakeQueueTotal: 2
- totalUnchecked: 2
```

**Fail remediation message:**
```
Intake blocked: both executable queues are empty.
Seed at least one unchecked item in Work Queue using this canonical bullet template:
- [ ] planned-YYYY-MM-DD <actionable next step> Verify: <command>

Or run auto-ideation with Work Queue routing:
bun run taskpad:auto-ideation -- --taskpad <path> --plan <plan> --target-queue work
```

### Reason Codes (Deterministic)

| Reason Code | Condition | Description |
|-------------|-----------|-------------|
| `QH001_EXECUTABLE_QUEUES_EMPTY` | `executableQueueTotal === 0` | Both executable queues have no unchecked items |
| `QH002_QUEUE_READY` | `executableQueueTotal >= 1` | At least one executable queue has unchecked items |
| `QH003_WORK_QUEUE_MISSING` | `## Work Queue` heading not found | Required executable section is missing |
| `QH004_EXECUTION_QUEUE_MISSING` | `## Execution Queue` heading not found | Required executable section is missing |

### Backward Compatibility (Legacy Fields)

To maintain compatibility with existing tooling, the following legacy fields remain available but are deprecated for new integrations:

- `autonomousUncheckedCount` — Mapped from intake queue (prefer `intakeQueueTotal` for aggregation)
- `selfImprovementUncheckedCount` — Mapped from intake queue (prefer `intakeQueueTotal` for aggregation)
- `totalUnchecked` — All sections combined (prefer `executableQueueTotal` for readiness gating)

**Migration guidance:**
- Replace `totalUnchecked === 0` checks with `executableQueueTotal === 0`
- Replace intake-only checks with `intakeQueueTotal >= 1`
- New tooling SHOULD use explicit queue fields instead of legacy aggregators

## Non-Goals (for this checker)
- Validating task wording quality, priority tags, or due dates.
- Parsing queue state from headings other than the four contract headings.
- Mutating TASKPAD content automatically.

## Intake-Auto Decision Logic (Executable-Queue-Aware)

### Auto-Ideation Trigger Condition
Auto-ideation (`taskpad:auto-ideation`) MUST trigger when:

```
executableQueueTotal === 0
```

**Intentional design:** The presence of unchecked items in intake queues (`Autonomous Kickoff Queue`, `Self-Improvement Backlog`) does NOT prevent ideation when executable queues are empty. This ensures autonomous loops always produce immediately plannable Work Queue items without manual queue promotion.

### Intake-Auto Flow (Canonical Sequence)

```
1. Run queue-health check
   └─ If executableQueueTotal >= 1: Skip ideation, proceed to verification
   └─ If executableQueueTotal === 0: Trigger ideation

2. If ideation triggered:
   └─ Run: taskpad:auto-ideation --target-queue work
   └─ Ensures new item goes to Work Queue (executable)

3. Work Queue maintenance (deterministic archive + parity):
   └─ Run: taskpad:work-queue-prune --taskpad <path> --archive <path>
   └─ Archives checked/planned Work Queue bullets to monthly archive
   └─ Run: taskpad:work-queue-archive-parity --taskpad <path> --archive <path>
   └─ Validates one-to-one fingerprint parity between TASKPAD and archive

4. Post-ideation verification:
   └─ Re-check queue-health to confirm executableQueueTotal >= 1
   └─ Run full intake verification gates
```

**Work Queue Pruning Contract:**

Work Queue pruning (`taskpad:work-queue-prune`) and archive parity (`taskpad:work-queue-archive-parity`) are now part of the canonical intake-auto verification flow. These commands ensure:

- **Auditability**: Completed/planned Work Queue bullets are archived to `docs/archive/TASKPAD_ARCHIVE_YYYY-MM.md` with deterministic fingerprints
- **Lean ideation context**: Archived items are removed from active TASKPAD, keeping ideation readable
- **Parity guarantees**: Archive parity gate validates one-to-one fingerprint matching, detecting drift with actionable rule IDs (`WQAP001_MISSING_ARCHIVE_ENTRY`, `WQAP002_EXTRA_ARCHIVE_ENTRY`, `WQAP003_FINGERPRINT_MISMATCH`)

**Canonical work queue maintenance commands:**

```bash
# Prune completed/planned Work Queue items to monthly archive
bun run taskpad:work-queue-prune -- \
  --taskpad "8 - Projects/.../TASKPAD.md" \
  --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" \
  --format json

# Validate archive↔TASKPAD fingerprint parity
bun run taskpad:work-queue-archive-parity -- \
  --taskpad "8 - Projects/.../TASKPAD.md" \
  --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" \
  --format json
```

For full contract documentation, see: `docs/quality/taskpad-work-queue-prune.md`

**Execution Queue Pruning Contract:**

Execution Queue pruning (`taskpad:execution-queue-prune`) and archive parity (`taskpad:execution-queue-archive-parity`) are now part of the canonical intake-auto verification flow. These commands ensure:

- **Auditability**: Completed/planned Execution Queue bullets are archived to `docs/archive/TASKPAD_ARCHIVE_YYYY-MM.md` with deterministic fingerprints
- **Lean runtime context**: Archived items are removed from active TASKPAD, keeping runtime/ops tracking readable
- **Parity guarantees**: Archive parity gate validates one-to-one fingerprint matching for Execution Queue entries, detecting drift with actionable rule IDs (`EQAP001_PARITY_OK`, `EQAP006_PARITY_MISSING_FROM_ARCHIVE`, `EQAP007_PARITY_EXTRA_IN_ARCHIVE`, `EQAP008_PARITY_MUTATED_FINGERPRINT`)

**Canonical Execution Queue maintenance commands:**

```bash
# Prune completed/planned Execution Queue items to monthly archive
bun run taskpad:execution-queue-prune -- \
  --taskpad "8 - Projects/.../TASKPAD.md" \
  --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" \
  --format json

# Validate archive↔TASKPAD fingerprint parity for Execution Queue
bun run taskpad:execution-queue-archive-parity -- \
  --taskpad "8 - Projects/.../TASKPAD.md" \
  --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" \
  --format json
```

For full contract documentation, see: `docs/quality/taskpad-execution-queue-prune.md`

### Decision Matrix

| `executableQueueTotal` | `intakeQueueTotal` | Ideation Triggered | Verdict |
|----------------------|---------------------|-------------------|----------|
| 0 | 0 | YES | Seed Work Queue + verify |
| 0 | 1+ | YES | Seed Work Queue + verify |
| 1+ | 0 | NO | Verify existing executable work |
| 1+ | 1+ | NO | Verify existing executable work |

**Key invariant:** Ideation is driven solely by executable queue emptiness, not intake queue state.

## CLI Output Format

### Human-Readable Mode (default)
```
TASKPAD queue health: PASS
- reasonCode: "QH002_QUEUE_READY"
- workQueueUncheckedCount: 1
- executionQueueUncheckedCount: 0
- autonomousUncheckedCount: 2
- selfImprovementUncheckedCount: 1
- executableQueueTotal: 1
- intakeQueueTotal: 3
- totalUnchecked: 4
```

### JSON Mode (`--format json`)
Output is a single JSON object wrapped in stable markers:

```
QUEUE_HEALTH_JSON_START
{
  "status": "pass|fail",
  "reasonCode": "QH001_EXECUTABLE_QUEUES_EMPTY|QH002_QUEUE_READY|QH003_WORK_QUEUE_MISSING|QH004_EXECUTION_QUEUE_MISSING",
  "queueHealth": {
    "autonomousUncheckedCount": 0,
    "executionQueueUncheckedCount": 0,
    "intakeQueueTotal": 0,
    "selfImprovementUncheckedCount": 0,
    "totalUnchecked": 0,
    "workQueueUncheckedCount": 0,
    "executableQueueTotal": 0
  }
}
QUEUE_HEALTH_JSON_END
```

**Machine-readable schema (TypeScript):**
```typescript
interface QueueHealthResult {
  status: "pass" | "fail";
  reasonCode: string;
  queueHealth: QueueHealthCounts;
}
```

**Deterministic output rules:**
- Object keys MUST be alphabetically sorted
- Numbers MUST be emitted as JSON numbers (not strings)
- Reason codes MUST match the deterministic set above
- Status MUST be `pass` only when `executableQueueTotal >= 1`
- Markers MUST be `QUEUE_HEALTH_JSON_START` and `QUEUE_HEALTH_JSON_END` exactly

## Verification Commands

### Basic Health Check
```bash
bun run taskpad:queue-health -- --taskpad "8 - Projects/.../TASKPAD.md"
```

### JSON Output for CI/Automation
```bash
bun run taskpad:queue-health -- --taskpad "8 - Projects/.../TASKPAD.md" --format json
```

### Verify Executable Queue Readiness
```bash
# Should output executableQueueTotal >= 1 for ready state
bun run taskpad:queue-health -- --taskpad "8 - Projects/.../TASKPAD.md" --format json | jq '.queueHealth.executableQueueTotal'
```

### Auto-Ideation Trigger Check
```bash
# Exit 0 (ideation needed) if executableQueueTotal === 0
bun run taskpad:queue-health -- --taskpad "8 - Projects/.../TASKPAD.md" --format json | jq -e '.queueHealth.executableQueueTotal == 0'
```

## Example Queue States

### State 1: Executable Ready (Ideation Skipped)
```markdown
## Work Queue
- [ ] planned-2026-03-02 Implement queue-health parser updates Verify: bun run test:queue-health

## Execution Queue
(empty)

## Autonomous Kickoff Queue
- [ ] Add queue-health tests for mixed queue states
- [ ] Update intake-autoplan to use executable-queue gating

## Self-Improvement Backlog
- [ ] Refactor queue-health to use section registry pattern
```

**Queue health output:**
```
status: "pass"
executableQueueTotal: 1
intakeQueueTotal: 3
ideationTriggered: false
```

### State 2: Executable Empty, Intake Has Backlog (Ideation Needed)
```markdown
## Work Queue
(empty)

## Execution Queue
(empty)

## Autonomous Kickoff Queue
- [ ] Add queue-health tests for mixed queue states
- [ ] Update intake-autoplan to use executable-queue gating

## Self-Improvement Backlog
- [ ] Refactor queue-health to use section registry pattern
```

**Queue health output:**
```
status: "fail"
reasonCode: "QH001_EXECUTABLE_QUEUES_EMPTY"
executableQueueTotal: 0
intakeQueueTotal: 3
ideationTriggered: true (should seed Work Queue)
```

### State 3: Fully Empty (All Queues Empty)
```markdown
## Work Queue
(empty)

## Execution Queue
(empty)

## Autonomous Kickoff Queue
(empty)

## Self-Improvement Backlog
(empty)
```

**Queue health output:**
```
status: "fail"
reasonCode: "QH001_EXECUTABLE_QUEUES_EMPTY"
executableQueueTotal: 0
intakeQueueTotal: 0
ideationTriggered: true (should seed Work Queue via auto-ideation)
```

### State 4: Execution Queue Only (Non-Primary Executable Path)
```markdown
## Work Queue
(empty)

## Execution Queue
- [ ] planned-2026-03-02 Fix production hotfix Verify: bun run deploy:hotfix

## Autonomous Kickoff Queue
(empty)

## Self-Improvement Backlog
(empty)
```

**Queue health output:**
```
status: "pass"
executableQueueTotal: 1
ideationTriggered: false (Execution Queue counts as executable)
```

## Fixture/Test Requirements (TP004)

The queue-health parser MUST include deterministic fixture coverage for these queue states:

### Required Fixture States

| Fixture ID | Work Queue | Execution Queue | Autonomous | Self-Improvement | Expected `executableQueueTotal` | Expected `intakeQueueTotal` | Expected Reason |
|------------|-------------|-----------------|-------------|-------------------|-------------------------------|----------------------------|-----------------|
| `fixture-executable-ready` | 1+ unchecked | 0 | any | any | >= 1 | any | `QH002_QUEUE_READY` |
| `fixture-executable-empty-intake-full` | 0 | 0 | 1+ | 1+ | 0 | >= 1 | `QH001_EXECUTABLE_QUEUES_EMPTY` |
| `fixture-executable-empty-intake-empty` | 0 | 0 | 0 | 0 | 0 | 0 | `QH001_EXECUTABLE_QUEUES_EMPTY` |
| `fixture-execution-only` | 0 | 1+ | any | any | >= 1 | any | `QH002_QUEUE_READY` |
| `fixture-both-executable` | 1+ | 1+ | any | any | >= 2 | any | `QH002_QUEUE_READY` |
| `fixture-work-only-checked` | 0 (all checked) | 0 | any | any | 0 | any | `QH001_EXECUTABLE_QUEUES_EMPTY` |

### Fixture Format
Fixtures MUST be stored in `tests/tools/fixtures/` with naming pattern `taskpad-queue-health-*.md`.

Each fixture MUST:
1. Include all four H2 section headings (even if empty)
2. Use canonical unchecked bullet format: `- [ ] planned-YYYY-MM-DD <text>`
3. Include checked bullets for negative test cases: `- [x] completed task`
4. Be deterministic (same content produces identical JSON output byte-for-byte)

### Test Assertion Requirements

For each fixture, tests MUST assert:
1. All four section counts are correct (`workQueueUncheckedCount`, `executionQueueUncheckedCount`, `autonomousUncheckedCount`, `selfImprovementUncheckedCount`)
2. Aggregates are correct (`executableQueueTotal`, `intakeQueueTotal`, `totalUnchecked`)
3. `status` field matches expected (`pass` or `fail`)
4. `reasonCode` matches expected deterministic reason ID
5. JSON output keys are alphabetically sorted
6. JSON output is byte-stable across multiple runs

### Integration Test Requirements

Tests MUST verify:
1. Queue-health correctly triggers auto-ideation when `executableQueueTotal === 0`
2. Queue-health does NOT trigger auto-ideation when `executableQueueTotal >= 1` (even if `intakeQueueTotal === 0`)
3. Auto-ideation with `--target-queue work` results in `workQueueUncheckedCount >= 1` after run
4. Mixed queue states (some sections empty, some populated) produce deterministic counts

## Migration Guide

### For Existing Tooling

**Old pattern (deprecated):**
```typescript
if (counts.totalUnchecked === 0) {
  triggerIdeation();
}
```

**New pattern (executable-queue-aware):**
```typescript
if (counts.executableQueueTotal === 0) {
  triggerIdeation();  // Use --target-queue work
}
```

**Old intake-autoplan gating (deprecated):**
```typescript
if (counts.autonomousUncheckedCount === 0 && counts.selfImprovementUncheckedCount === 0) {
  // Trigger ideation
}
```

**New intake-autoplan gating:**
```typescript
if (counts.workQueueUncheckedCount === 0 && counts.executionQueueUncheckedCount === 0) {
  // Trigger ideation with Work Queue routing
  await runAutoIdeation({ targetQueue: "work" });
}
```

### For New Tooling

New integrations SHOULD:
1. Use `executableQueueTotal` for readiness gating (not `totalUnchecked`)
2. Use `intakeQueueTotal` for backlog health checks (not per-section counts)
3. Use explicit section fields when queue-specific logic is needed
4. Depend on `--format json` output for machine-readable checks
5. Handle legacy fields gracefully but prefer new schema fields

### Rollout Strategy

1. **Phase 1**: Update queue-health parser to emit new fields (TP002)
2. **Phase 2**: Update intake-autoplan to use executable-queue gating (TP003)
3. **Phase 3**: Add fixture/test coverage for all queue states (TP004)
4. **Phase 4**: Update documentation and deprecate legacy field usage (TP005)

During rollout, both legacy (`autonomousUncheckedCount`, `selfImprovementUncheckedCount`, `totalUnchecked`) and new fields (`workQueueUncheckedCount`, `executionQueueUncheckedCount`, `executableQueueTotal`, `intakeQueueTotal`) are emitted. New tooling prefers new fields; existing tooling continues working via legacy fields.
