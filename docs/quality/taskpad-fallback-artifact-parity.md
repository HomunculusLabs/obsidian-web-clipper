# TASKPAD Fallback Artifact Parity Contract

## Purpose

Define a deterministic contract that validates mutator fallback artifacts are in a resolved state (`applied`, `noop`, or `rejected`) before allowing autonomous Builder handoff.

## Problem Statement

The intake toolchain now emits deterministic fallback artifacts when TASKPAD paths are non-writable, but intake verification can still pass without proving those artifacts were actually resolved (`applied|noop|rejected`). This creates a high-impact drift gap between "planned" status and real TASKPAD/plan mutation parity on vault paths.

We need one deterministic gate that blocks autonomous handoff when mutator fallback artifacts remain unresolved.

## Artifact Lifecycle States

Mutator fallback artifacts progress through these deterministic lifecycle states:

| State | Description | Evidence Required |
|-------|-------------|-------------------|
| **`generated`** | Artifact was emitted by a mutator in fallback mode | Artifact JSON file exists at `artifactPath` with `kind`, `taskpadPath`, `taskpadSha256`, `patch` |
| **`pending`** | Artifact exists but has not been applied to target TASKPAD | Artifact exists, target TASKPAD hash does NOT match artifact `taskpadSha256` |
| **`applied`** | Artifact was successfully applied to target TASKPAD | `taskpad:apply-fallback` returned `status=applied` with `reasonCode=null` |
| **`noop`** | Artifact is idempotent (changes already reflected in target) | `taskpad:apply-fallback` returned `status=noop` with `reasonCode=null` |
| **`rejected`** | Artifact cannot be applied (hash mismatch, format error, or explicit rejection) | `taskpad:apply-fallback` returned `status=rejected` with non-null `reasonCode` |
| **`stale`** | Artifact is superseded by a newer artifact for the same target | Multiple artifacts exist for same `taskpadPath`, only the newest is considered current |

## Mutators That Emit Fallback Artifacts

The following TASKPAD mutators MUST emit deterministic fallback artifacts when `write-mode=fallback-artifact`:

1. **`taskpad:auto-ideation`** - Emits `kind: "taskpad-auto-ideation-fallback-patch"` when queues are empty and TASKPAD is non-writable
2. **`taskpad:plan-seed`** - Emits `kind: "taskpad-plan-seed-fallback-patch"` when promoting backlog item and target files are non-writable
3. **`taskpad:intake:autoplan`** - Propagates fallback artifacts from `taskpad:plan-seed` post-recover
4. **`queue-reconcile` write paths** - Emit fallback artifacts when healing TASKPAD section structure on non-writable targets

## Artifact Evidence Fields

All mutator fallback artifacts MUST contain these evidence fields for parity validation:

### Base Fields (required for all artifact kinds)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `number` | ✅ | Artifact schema version (must be `1`) |
| `kind` | `string` | ✅ | Artifact kind identifier (e.g., `"taskpad-auto-ideation-fallback-patch"`) |
| `taskpadPath` | `string` | ✅ | Absolute path to target TASKPAD file |
| `taskpadSha256` | `string` | ✅ | SHA-256 hash of TASKPAD file content before mutation (64 lowercase hex chars) |
| `applyHint` | `string` | ✅ | Human-readable hint about how to apply the artifact |

### Auto-Ideation Artifact Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `selectedCandidateId` | `string` | ✅ | Identifier of selected backlog candidate |
| `selectedOutcome` | `object` | ✅ | Outcome metadata for selected candidate |
| `selectedOutcome.action` | `"would-insert"` | ✅ | Action that would be performed |
| `selectedOutcome.canonicalBullet` | `string` | ✅ | Canonical bullet text to insert |
| `selectedOutcome.insertedLine` | `number` | ✅ | Line number where insertion would occur |
| `patch` | `object` | ✅ | Unified diff for TASKPAD mutation |
| `patch.format` | `"unified-diff"` | ✅ | Patch format (must be `"unified-diff"`) |
| `patch.targetPath` | `string` | ✅ | Target file path (must match `taskpadPath`) |
| `patch.content` | `string` | ✅ | Unified diff body |

### Plan-Seed Artifact Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `planPath` | `string` | ✅ | Absolute path to IMPLEMENTATION_PLAN.md |
| `planSha256` | `string` | ✅ | SHA-256 hash of IMPLEMENTATION_PLAN before mutation |
| `mutationId` | `string` | ✅ | Unique identifier for this plan-seed mutation |
| `mutationOutcome` | `object` | ✅ | Outcome metadata for mutation |
| `mutationOutcome.action` | `"would-insert-taskpad"` \| `"would-insert-plan"` | ✅ | Action that would be performed |
| `mutationOutcome.taskpadUpdatedLine` | `string \| null` | ✅ | Updated TASKPAD line (if applicable) |
| `mutationOutcome.planInsertHeading` | `string \| null` | ✅ | Plan slice heading to insert (if applicable) |
| `mutationOutcome.selectedBacklogLine` | `number` | ✅ | Line number of selected backlog item |
| `patch` | `object` | ✅ | Dual-file patch for TASKPAD + IMPLEMENTATION_PLAN |
| `patch.format` | `"unified-diff"` | ✅ | Patch format |
| `patch.taskpadTargetPath` | `string` | ✅ | TASKPAD target path |
| `patch.planTargetPath` | `string` | ✅ | IMPLEMENTATION_PLAN target path |
| `patch.taskpadPatchContent` | `string \| null` | ✅ | TASKPAD patch body (or null if no TASKPAD mutation) |
| `patch.planPatchContent` | `string \| null` | ✅ | IMPLEMENTATION_PLAN patch body (or null if no plan mutation) |

## CLI Contract

### Command Inputs

| Argument | Required | Description |
|-----------|-----------|-------------|
| `--taskpad <path>` | ✅ | Path to TASKPAD markdown file |
| `--plan <path>` | ✅ | Path to IMPLEMENTATION_PLAN markdown file |
| `--format <format>` | ❌ | Output format: `json` or `human` (default: json) |
| `--help, -h` | ❌ | Show help message and exit |

### Exit Codes

| Exit Code | Condition |
|-----------|-----------|
| `0` | All fallback artifacts are in resolved state (`applied`, `noop`, or `rejected`) |
| `1` | One or more fallback artifacts are unresolved (`pending` or `stale`) |
| `2` | Input validation failure (invalid arguments, unreadable files) |

## Deterministic Output Schema

### JSON Format

When `--format json` is specified, the command MUST emit exactly one JSON object:

```json
{
  "status": "pass|fail",
  "inputs": {
    "taskpadPath": "string",
    "planPath": "string"
  },
  "artifacts": [
    {
      "artifactPath": "string",
      "artifactKind": "taskpad-auto-ideation-fallback-patch|taskpad-plan-seed-fallback-patch",
      "taskpadPath": "string",
      "mutatorSource": "taskpad:auto-ideation|taskpad:plan-seed|taskpad:intake:autoplan|queue-reconcile",
      "lifecycleState": "generated|pending|applied|noop|rejected|stale",
      "evidence": {
        "artifactExists": true,
        "artifactSha256": "string|null",
        "taskpadSha256": "string|null",
        "hashMatches": true,
        "applyEvidence": {
          "status": "applied|noop|rejected|null",
          "reasonCode": "string|null",
          "appliedAt": "string|null",
          "artifactPath": "string|null"
        }
      }
    }
  ],
  "summary": {
    "totalArtifacts": 3,
    "resolvedArtifacts": 2,
    "pendingArtifacts": 1,
    "rejectedArtifacts": 0,
    "staleArtifacts": 0
  },
  "violations": [
    {
      "ruleId": "FAP001_PENDING_ARTIFACT",
      "severity": "error|warning",
      "artifactPath": "string",
      "artifactKind": "string",
      "taskpadPath": "string",
      "mutatorSource": "string",
      "details": {
        "lifecycleState": "pending",
        "artifactExists": true,
        "taskpadSha256": "string",
        "artifactSha256": "string",
        "hashMatches": false
      },
      "remediation": "Apply the fallback artifact using taskpad:apply-fallback or explicitly reject it."
    }
  ],
  "timestamp": "2026-03-02T00:00:00.000Z"
}
```

### Human Format

When `--format human` is specified or default, the command MUST emit:

```
TASKPAD Fallback Artifact Parity: PASS
─────────────────────────────────────────
Inputs:
  - taskpad: /path/to/TASKPAD.md
  - plan: /path/to/IMPLEMENTATION_PLAN.md

Artifacts: 0

Summary:
  - Total artifacts: 0
  - Resolved: 0
  - Pending: 0
  - Rejected: 0
  - Stale: 0

All fallback artifacts are in resolved state.
```

For failures:

```
TASKPAD Fallback Artifact Parity: FAIL
─────────────────────────────────────────
Inputs:
  - taskpad: /path/to/TASKPAD.md
  - plan: /path/to/IMPLEMENTATION_PLAN.md

Artifacts: 2
  1. /tmp/taskpad.auto-ideation.fallback.json
     - kind: taskpad-auto-ideation-fallback-patch
     - source: taskpad:auto-ideation
     - state: pending
     - Hash mismatch: artifact expects sha256:abc123, actual: def456

  2. /tmp/taskpad.plan-seed.fallback.json
     - kind: taskpad-plan-seed-fallback-patch
     - source: taskpad:plan-seed
     - state: applied
     - Applied at: 2026-03-01T12:00:00.000Z

Summary:
  - Total artifacts: 2
  - Resolved: 1
  - Pending: 1
  - Rejected: 0
  - Stale: 0

Violations: 1
  - [FAP001_PENDING_ARTIFACT] /tmp/taskpad.auto-ideation.fallback.json (taskpad:auto-ideation) is pending - artifact hash does not match current TASKPAD state
    Remediation: Apply the fallback artifact using taskpad:apply-fallback or explicitly reject it.
```

## Deterministic Rule ID Taxonomy

All validation rule IDs follow the pattern `FAPXXX_DESCRIPTION` for stable machine-readable diagnostics.

| Rule ID | Description | Severity | Condition |
|---------|-------------|----------|-----------|
| `FAP001_PENDING_ARTIFACT` | Fallback artifact exists but has not been applied | `error` | Artifact exists, target TASKPAD hash does NOT match artifact `taskpadSha256`, no `taskpad:apply-fallback` evidence found |
| `FAP002_MISSING_APPLY_EVIDENCE` | Artifact exists but no apply evidence found | `error` | Artifact exists in `generated` state but no corresponding apply record found |
| `FAP003_SHA_PATH_MISMATCH` | Artifact taskpadPath does not match input TASKPAD | `error` | Artifact `taskpadPath` resolves to a different file than CLI `--taskpad` argument |
| `FAP004_STALE_ARTIFACT` | Artifact is superseded by a newer artifact | `warning` | Multiple artifacts exist for same `taskpadPath`, older ones are marked stale |
| `FAP005_ARTIFACT_NOT_FOUND` | Referenced artifact file does not exist | `error` | Apply evidence references an artifact path that does not exist |
| `FAP006_ARTIFACT_PARSE_ERROR` | Artifact JSON cannot be parsed | `error` | Artifact file exists but is not valid JSON |
| `FAP007_ARTIFACT_SCHEMA_INVALID` | Artifact does not match required schema | `error` | Artifact JSON is valid but missing required fields or has invalid types |
| `FAP008_ARTIFACT_VERSION_UNSUPPORTED` | Artifact version is not supported | `error` | Artifact `version` field is not `1` |
| `FAP009_ARTIFACT_KIND_UNKNOWN` | Artifact kind is not recognized | `warning` | Artifact `kind` field is not a supported value |
| `FAP010_REJECTED_ARTIFACT` | Artifact was explicitly rejected by apply-fallback | `error` | Apply evidence shows `status=rejected` with non-null `reasonCode` |

## Artifact Discovery Rules

### Mutator Outcome Extraction

The gate MUST extract fallback artifact metadata from mutator command outputs in this priority order:

1. **JSON envelope parsing** - Parse JSON between `TASKPAD_AUTO_IDEATION_JSON_START`/`TASKPAD_AUTO_IDEATION_JSON_END` markers
2. **Artifact metadata field** - Look for `artifactPath` field in parsed JSON
3. **Apply-fallback evidence** - Look for `artifact` metadata in `taskpad:apply-fallback` output

### Artifact File Discovery

Artifact files MUST be discovered at these canonical locations:

| Mutator | Artifact Location Pattern |
|---------|--------------------------|
| `taskpad:auto-ideation` | `/tmp/taskpad.auto-ideation.{timestamp}.json` |
| `taskpad:plan-seed` | `/tmp/taskpad.plan-seed.{timestamp}.json` |
| `taskpad:intake:autoplan` | Inherits from `taskpad:plan-seed` artifact |
| `queue-reconcile` | `/tmp/taskpad.queue-reconcile.{timestamp}.json` |

### Newest Artifact Selection

When multiple artifacts exist for the same `taskpadPath`:

1. Sort by artifact file modification timestamp (newest first)
2. Select the newest as "current"
3. Mark older artifacts as `stale` (warning-level violations, not blocking)

## Apply Evidence Validation

### taskpad:apply-fallback Output Parsing

The gate MUST parse `taskpad:apply-fallback` JSON output to extract apply evidence:

```json
{
  "status": "applied|noop|rejected",
  "taskpadPath": "string",
  "artifactPath": "string",
  "reasonCode": "string|null",
  "message": "string"
}
```

### Apply Evidence Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `"applied"\|"noop"\|"rejected"` | ✅ | Apply outcome |
| `taskpadPath` | `string` | ✅ | Path to TASKPAD that was mutated (or validated) |
| `artifactPath` | `string` | ✅ | Path to artifact that was applied |
| `reasonCode` | `string\|null` | ✅ | Error code if `status=rejected` |
| `message` | `string` | ✅ | Human-readable outcome message |

### Evidence Correlation

Apply evidence MUST be correlated to artifacts by:

1. Matching `artifactPath` exactly
2. Validating `taskpadPath` matches artifact's `taskpadSha256` target
3. Checking `status` to determine lifecycle state:
   - `status=applied` → lifecycle state = `applied`
   - `status=noop` → lifecycle state = `noop`
   - `status=rejected` → lifecycle state = `rejected`

## Deterministic Validation Order

The gate MUST validate artifacts in this exact order for deterministic output:

1. **Parse CLI arguments** - Validate `--taskpad`, `--plan` inputs
2. **Discover mutator artifacts** - Find all fallback artifact files
3. **Parse artifact JSON** - Validate each artifact is parseable JSON
4. **Validate artifact schema** - Check required fields, version, kind
5. **Hash validation** - Compute current TASKPAD SHA-256 and compare to artifact
6. **Discover apply evidence** - Parse `taskpad:apply-fallback` outputs
7. **Correlate evidence** - Match artifacts to apply evidence
8. **Determine lifecycle state** - Map each artifact to lifecycle state
9. **Generate violations** - Emit rule violations for unresolved artifacts
10. **Compute summary** - Aggregate counts for all artifacts

## Pass/Fail Conditions

### PASS Conditions

The gate MUST return `status="pass"` (exit `0`) when ALL of these are true:

- No artifacts are in `pending` state
- No artifacts are in `generated` state without apply evidence
- No error-level violations (warnings are allowed but do not fail the gate)

### FAIL Conditions

The gate MUST return `status="fail"` (exit `1`) when ANY of these are true:

- At least one artifact is in `pending` state
- At least one artifact is in `generated` state without apply evidence
- At least one error-level violation exists

### Input Validation Failures

The gate MUST return exit code `2` when:

- CLI arguments are invalid (missing required flags, invalid file paths)
- Input files (`--taskpad`, `--plan`) are not readable

## Idempotency Guarantees

The gate MUST be idempotent for repeated runs with identical inputs:

- Artifact discovery returns the same set of artifacts
- Hash computation produces the same SHA-256 for identical file content
- Lifecycle state determination is deterministic given artifact + evidence state
- Output JSON has stable field ordering across runs

## Assumptions

### Assumption 1: Mutator Output is Machine-Readable

Mutator commands MUST emit machine-readable JSON output with `artifactPath` fields when operating in fallback-artifact mode.

**Rationale**: Without structured output, artifact discovery would require fragile string parsing.

### Assumption 2: Apply Evidence is Durable

Apply evidence MUST be deterministically discoverable by parsing `taskpad:apply-fallback` output files or logs.

**Rationale**: If apply evidence is not captured, the gate cannot distinguish between `pending` and `applied` states.

### Assumption 3: Artifact Paths are Absolute

All artifact `taskpadPath` and file paths MUST be absolute paths for deterministic comparison.

**Rationale**: Relative paths can resolve differently depending on cwd, causing non-deterministic failures.

### Assumption 4: Hash Computation is Deterministic

SHA-256 hash computation MUST produce identical results for identical file content across runs.

**Rationale**: Hash comparison is the primary mechanism for detecting whether an artifact's pre-image matches the current file state.

### Assumption 5: Mutators Do Not Emit Duplicate Artifacts

Mutators MUST NOT emit multiple fallback artifacts for the same mutation in a single run.

**Rationale**: Duplicate artifacts would create ambiguity about which artifact is "current."

## Integration with verify:taskpad:intake:full

The `verify:taskpad:intake:full` command MUST compose `taskpad:fallback-artifact-parity` with other intake gates.

**Expected order:**
1. `taskpad:queue-health` (validate queues have unchecked work)
2. `taskpad:planned-command-parity` (validate planned items reference executable commands)
3. `taskpad:fallback-artifact-parity` (validate fallback artifacts are resolved)
4. `plan:integrity` (validate IMPLEMENTATION_PLAN structure)

**Integration behavior:**
- Fallback artifact parity check runs after command parity check
- Gate failures MUST fail fast before Builder dispatch
- Unresolved fallback artifacts MUST be surfaced as actionable blockers

## Non-Goals

- **Applying fallback artifacts automatically** - This gate validates state; `taskpad:apply-fallback` handles application
- **Validating product clipping features** - This gate is scoped to TASKPAD mutator artifacts only
- **Redesigning queue contracts** - This gate does not validate queue structure or content
- **Validating non-mutator artifacts** - Only artifacts emitted by TASKPAD mutators are in scope

## Documentation Requirements

When implementing or using this gate, maintain:

1. **Quality contract** - This document (`docs/quality/taskpad-fallback-artifact-parity.md`)
2. **README integration** - Usage examples and verification flow documentation in `README.md`
3. **Fixture evidence** - Test fixtures demonstrating pass/fail scenarios
4. **Rule ID mapping** - Stable rule ID taxonomy in violation output

## Verification Commands

```bash
# Run fallback artifact parity gate on live vault
bun run taskpad:fallback-artifact-parity -- \
  --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --format json

# Run as part of full intake verification
bun run verify:taskpad:intake:full -- \
  --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --format json
```

## References

- [`taskpad-auto-ideation.md`](./taskpad-auto-ideation.md) - Shared mutator write-mode contract
- [`taskpad-planned-command-parity.md`](./taskpad-planned-command-parity.md) - Planned command validation contract
- [`tools/taskpad-apply-fallback.ts`](../tools/taskpad-apply-fallback.ts) - Fallback artifact applier
- [`tools/taskpad-intake-autoplan.ts`](../tools/taskpad-intake-autoplan.ts) - Intake orchestration
- [`tools/taskpad-plan-seed.ts`](../tools/taskpad-plan-seed.ts) - Plan slice seeder
