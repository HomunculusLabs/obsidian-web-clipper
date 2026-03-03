# Fallback Artifact Parity Fixtures

This directory contains a comprehensive fixture corpus for `taskpad:fallback-artifact-parity` gate validation. These fixtures cover pass (`applied`, `noop`), fail (pending, mismatched, stale), and deterministic ordering/idempotency cases.

## Fixture Structure

```
fallback-artifact-parity/
├── artifacts/                          # Fallback artifacts and apply evidence
│   ├── taskpad-auto-ideation/         # Auto-ideation artifacts
│   ├── taskpad-plan-seed/             # Plan-seed artifacts
│   └── taskpad-apply-fallback/       # Apply evidence files
├── taskpad/                           # TASKPAD markdown files
├── plan/                             # IMPLEMENTATION_PLAN markdown files
├── *.expected.json                    # Expected gate outputs
└── FIXTURES.md                       # This file
```

## Fixture Scenarios

### Pass Scenarios

#### `pass-applied`
- **Lifecycle State**: `applied`
- **Description**: Artifact has been successfully applied to the target TASKPAD
- **Files**:
  - `taskpad/pass-applied.taskpad.md` - TASKPAD with artifact applied
  - `plan/pass-applied.plan.md` - Implementation plan
  - `artifacts/taskpad-auto-ideation/pass-applied.artifact.json` - Fallback artifact
  - `artifacts/taskpad-apply-fallback/apply-fallback-pass-applied.evidence.json` - Apply evidence
  - `pass-applied.expected.json` - Expected gate output (status="pass")

#### `pass-noop`
- **Lifecycle State**: `noop`
- **Description**: Artifact is idempotent (already applied, re-run is no-op)
- **Files**:
  - `taskpad/pass-noop.taskpad.md` - TASKPAD with artifact changes already reflected
  - `plan/pass-noop.plan.md` - Implementation plan
  - `artifacts/taskpad-auto-ideation/pass-noop.artifact.json` - Fallback artifact
  - `artifacts/taskpad-apply-fallback/apply-fallback-pass-noop.evidence.json` - Apply evidence
  - `pass-noop.expected.json` - Expected gate output (status="pass")

### Fail Scenarios

#### `fail-pending`
- **Lifecycle State**: `pending`
- **Description**: Artifact exists but has not been applied to target TASKPAD
- **Expected Violation**: `FAP001_PENDING_ARTIFACT`
- **Files**:
  - `taskpad/fail-pending.taskpad.md` - TASKPAD without artifact applied
  - `artifacts/taskpad-auto-ideation/fail-pending.artifact.json` - Fallback artifact
  - `fail-pending.expected.json` - Expected gate output (status="fail")

#### `fail-mismatched-sha`
- **Lifecycle State**: `rejected`
- **Description**: TASKPAD hash changed after artifact generation (drift detection)
- **Expected Violation**: `FAP010_REJECTED_ARTIFACT`
- **Files**:
  - `taskpad/fail-mismatched-sha.taskpad.md` - TASKPAD with drift
  - `artifacts/taskpad-auto-ideation/fail-mismatched-sha.artifact.json` - Fallback artifact with non-matching SHA
  - `artifacts/taskpad-apply-fallback/apply-fallback-rejected.evidence.json` - Reject evidence
  - `fail-mismatched-sha.expected.json` - Expected gate output (status="fail")

#### `fail-mismatched-path`
- **Lifecycle State**: `pending` (with FAP003 violation)
- **Description**: Artifact's taskpadPath does not match input TASKPAD path
- **Expected Violation**: `FAP003_SHA_PATH_MISMATCH`
- **Files**:
  - `taskpad/fail-mismatched-path.taskpad.md` - TASKPAD file
  - `artifacts/taskpad-auto-ideation/fail-mismatched-path.artifact.json` - Artifact with wrong path

#### `fail-stale`
- **Lifecycle State**: `stale`
- **Description**: Artifact is superseded by a newer artifact for same TASKPAD
- **Expected Violation**: `FAP004_STALE_ARTIFACT` (warning, not blocking)
- **Files**:
  - `taskpad/fail-stale.taskpad.md` - TASKPAD with newest artifact applied
  - `artifacts/taskpad-auto-ideation/fail-stale.artifact.json` - Older artifact
  - `fail-stale.expected.json` - Expected gate output (status="pass" with warning)

### Deterministic Ordering and Idempotency

#### `multi-artifact`
- **Lifecycle States**: `applied` (newest), `stale` (older)
- **Description**: Multiple artifacts for same TASKPAD demonstrating:
  - Deterministic ordering (newest first)
  - Stale artifact detection
  - Multi-artifact resolution
- **Files**:
  - `taskpad/multi-artifact.taskpad.md` - TASKPAD with multiple changes
  - `plan/multi-artifact.plan.md` - Implementation plan
  - `artifacts/taskpad-auto-ideation/multi-artifact-newest.artifact.json` - Newest auto-ideation artifact
  - `artifacts/taskpad-auto-ideation/multi-artifact-older.artifact.json` - Older auto-ideation artifact
  - `artifacts/taskpad-plan-seed/multi-artifact-newest.artifact.json` - Newest plan-seed artifact
  - `artifacts/taskpad-apply-fallback/apply-fallback-multi-artifact-1.evidence.json` - Apply evidence #1
  - `artifacts/taskpad-apply-fallback/apply-fallback-multi-artifact-2.evidence.json` - Apply evidence #2
  - `multi-artifact.expected.json` - Expected gate output with 3 artifacts

## Artifact Contract Reference

All fallback artifacts follow the contract defined in `docs/quality/taskpad-fallback-artifact-parity.md`:

### Auto-Ideation Artifact Schema

```json
{
  "version": 1,
  "kind": "taskpad-auto-ideation-fallback-patch",
  "taskpadPath": "/absolute/path/to/TASKPAD.md",
  "taskpadSha256": "64-char-lowercase-hex",
  "selectedCandidateId": "AIC001",
  "selectedOutcome": {
    "action": "would-insert",
    "canonicalBullet": "- [ ] Bullet text",
    "insertedLine": 4
  },
  "patch": {
    "format": "unified-diff",
    "targetPath": "/absolute/path/to/TASKPAD.md",
    "content": "--- a/TASKPAD.md\n+++ b/TASKPAD.md\n@@ -2,6 +2,7 @@\n ..."
  },
  "applyHint": "Apply patch.content to patch.targetPath in a writable environment."
}
```

### Plan-Seed Artifact Schema

```json
{
  "version": 1,
  "kind": "taskpad-plan-seed-fallback-patch",
  "taskpadPath": "/absolute/path/to/TASKPAD.md",
  "taskpadSha256": "64-char-lowercase-hex",
  "planPath": "/absolute/path/to/IMPLEMENTATION_PLAN.md",
  "planSha256": "64-char-lowercase-hex",
  "mutationId": "plan-seed-tp005-2026-03-02",
  "mutationOutcome": {
    "action": "would-insert-plan",
    "taskpadUpdatedLine": "- [x] planned-2026-03-02 TP005",
    "planInsertHeading": "## TASKPAD Intake Slice",
    "selectedBacklogLine": 3
  },
  "patch": {
    "format": "unified-diff",
    "taskpadTargetPath": "/absolute/path/to/TASKPAD.md",
    "planTargetPath": "/absolute/path/to/IMPLEMENTATION_PLAN.md",
    "taskpadPatchContent": null | "unified-diff",
    "planPatchContent": "unified-diff"
  },
  "applyHint": "Apply both TASKPAD and IMPLEMENTATION_PLAN patches atomically."
}
```

### Apply Evidence Schema

```json
{
  "status": "applied" | "noop" | "rejected",
  "taskpadPath": "/absolute/path/to/TASKPAD.md",
  "artifactPath": "/absolute/path/to/artifact.json",
  "reasonCode": "ERR_TASKPAD_HASH_MISMATCH" | null,
  "message": "Human-readable outcome message",
  "remediationHint": "How to fix if rejected" | null,
  "appliedAt": "2026-03-02T00:30:00.000Z"
}
```

## Lifecycle States

| State | Description | Evidence |
|--------|-------------|-----------|
| `generated` | Artifact was emitted by a mutator | Artifact JSON file exists |
| `pending` | Artifact exists but not applied | Artifact exists, no apply evidence, hash mismatch |
| `applied` | Artifact successfully applied | `taskpad:apply-fallback` returned `status=applied` |
| `noop` | Artifact is idempotent | `taskpad:apply-fallback` returned `status=noop` |
| `rejected` | Artifact cannot be applied | `taskpad:apply-fallback` returned `status=rejected` |
| `stale` | Superseded by newer artifact | Multiple artifacts for same taskpadPath |

## Rule ID Taxonomy

| Rule ID | Severity | Trigger |
|----------|----------|----------|
| `FAP001_PENDING_ARTIFACT` | error | Artifact in pending state |
| `FAP002_MISSING_APPLY_EVIDENCE` | error | Generated artifact without apply evidence |
| `FAP003_SHA_PATH_MISMATCH` | error | Artifact taskpadPath does not match input |
| `FAP004_STALE_ARTIFACT` | warning | Artifact superseded by newer |
| `FAP005_ARTIFACT_NOT_FOUND` | error | Referenced artifact missing |
| `FAP006_ARTIFACT_PARSE_ERROR` | error | Invalid JSON |
| `FAP007_ARTIFACT_SCHEMA_INVALID` | error | Missing/invalid fields |
| `FAP008_ARTIFACT_VERSION_UNSUPPORTED` | error | Version != 1 |
| `FAP009_ARTIFACT_KIND_UNKNOWN` | warning | Unknown artifact kind |
| `FAP010_REJECTED_ARTIFACT` | error | Apply-fallback rejected artifact |

## Using Fixtures in Tests

### Example: Testing Pass Scenario

```typescript
import { analyzeFallbackArtifactParity } from "../../tools/taskpad-fallback-artifact-parity";

test("pass-applied scenario", () => {
  const cwd = join(fixturesDir, "fallback-artifact-parity");
  const result = analyzeFallbackArtifactParity(
    "taskpad/pass-applied.taskpad.md",
    "plan/pass-applied.plan.md",
    cwd
  );
  
  const expected = readJson("fallback-artifact-parity/pass-applied.expected.json");
  expect(result).toEqual(expected);
  expect(result.status).toBe("pass");
  expect(result.artifacts[0].lifecycleState).toBe("applied");
});
```

### Example: Testing Fail Scenario

```typescript
test("fail-pending scenario detects pending artifact", () => {
  const cwd = join(fixturesDir, "fallback-artifact-parity");
  const result = analyzeFallbackArtifactParity(
    "taskpad/fail-pending.taskpad.md",
    "plan/pass-applied.plan.md",
    cwd
  );
  
  expect(result.status).toBe("fail");
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0].ruleId).toBe("FAP001_PENDING_ARTIFACT");
  expect(result.summary.pendingArtifacts).toBe(1);
});
```

### Example: Testing Deterministic Ordering

```typescript
test("multi-artifact scenario shows deterministic ordering", () => {
  const cwd = join(fixturesDir, "fallback-artifact-parity");
  const result = analyzeFallbackArtifactParity(
    "taskpad/multi-artifact.taskpad.md",
    "plan/multi-artifact.plan.md",
    cwd
  );
  
  // Newest artifacts first
  expect(result.artifacts[0].lifecycleState).toBe("applied");
  expect(result.artifacts[1].lifecycleState).toBe("applied");
  
  // Stale artifact last
  expect(result.artifacts[2].lifecycleState).toBe("stale");
  expect(result.violations[0].ruleId).toBe("FAP004_STALE_ARTIFACT");
  
  // Stale is a warning, not blocking
  expect(result.status).toBe("pass");
  expect(result.summary.staleArtifacts).toBe(1);
});
```

## Verification Commands

Run the parity gate against fixtures:

```bash
# Pass: Applied artifact
bun run taskpad:fallback-artifact-parity -- \
  --taskpad tests/tools/fixtures/fallback-artifact-parity/taskpad/pass-applied.taskpad.md \
  --plan tests/tools/fixtures/fallback-artifact-parity/plan/pass-applied.plan.md \
  --format json

# Pass: Noop (idempotent)
bun run taskpad:fallback-artifact-parity -- \
  --taskpad tests/tools/fixtures/fallback-artifact-parity/taskpad/pass-noop.taskpad.md \
  --plan tests/tools/fixtures/fallback-artifact-parity/plan/pass-noop.plan.md \
  --format json

# Fail: Pending artifact
bun run taskpad:fallback-artifact-parity -- \
  --taskpad tests/tools/fixtures/fallback-artifact-parity/taskpad/fail-pending.taskpad.md \
  --plan tests/tools/fixtures/fallback-artifact-parity/plan/pass-applied.plan.md \
  --format json

# Fail: Mismatched SHA
bun run taskpad:fallback-artifact-parity -- \
  --taskpad tests/tools/fixtures/fallback-artifact-parity/taskpad/fail-mismatched-sha.taskpad.md \
  --plan tests/tools/fixtures/fallback-artifact-parity/plan/pass-applied.plan.md \
  --format json

# Multi-artifact: Deterministic ordering + stale detection
bun run taskpad:fallback-artifact-parity -- \
  --taskpad tests/tools/fixtures/fallback-artifact-parity/taskpad/multi-artifact.taskpad.md \
  --plan tests/tools/fixtures/fallback-artifact-parity/plan/multi-artifact.plan.md \
  --format json
```

## Idempotency Testing

To verify idempotency, run the gate multiple times and ensure consistent output:

```bash
# First run
bun run taskpad:fallback-artifact-parity -- --taskpad ... --plan ... > run1.json

# Second run (should be identical)
bun run taskpad:fallback-artifact-parity -- --taskpad ... --plan ... > run2.json

# Compare (should have no meaningful differences)
diff run1.json run2.json
```

## Adding New Fixtures

When adding new fixture scenarios:

1. Create TASKPAD and plan markdown files under `taskpad/` and `plan/`
2. Generate appropriate fallback artifacts under `artifacts/taskpad-auto-ideation/` or `artifacts/taskpad-plan-seed/`
3. Create apply evidence files under `artifacts/taskpad-apply-fallback/`
4. Run the gate and capture output to `*.expected.json`
5. Update this `FIXTURES.md` with scenario description

## Related Documentation

- [`docs/quality/taskpad-fallback-artifact-parity.md`](../../docs/quality/taskpad-fallback-artifact-parity.md) - Gate contract
- [`tools/taskpad-fallback-artifact-parity.ts`](../../tools/taskpad-fallback-artifact-parity.ts) - Implementation
- [`tools/taskpad-apply-fallback.ts`](../../tools/taskpad-apply-fallback.ts) - Artifact applier
