# TASKPAD Execution Queue Contracts

> Specification for `taskpad:execution-queue-prune` and `taskpad:execution-queue-archive-parity`
>
> **Slice**: Execution Queue archive-prune + parity gate for executable queue hygiene
> **Date**: 2026-03-03
> **Task**: TP001

---

## Overview

This document defines deterministic contracts for Execution Queue pruning and archive parity validation. These contracts mirror the Work Queue semantics but target the `## Execution Queue` section in TASKPAD.

**Purpose**: Keep the secondary executable queue history compact and auditable while preserving unchecked execution tasks for autonomous queue-health flows.

---

## Command: `taskpad:execution-queue-prune`

### Purpose

Archive completed/planned `## Execution Queue` bullets into monthly `docs/archive/TASKPAD_ARCHIVE_YYYY-MM.md` while preserving unchecked execution tasks.

### Inputs

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `--taskpad` | `string` | Yes | Path to TASKPAD.md file |
| `--archive` | `string` | Yes | Path to monthly archive file (e.g., `docs/archive/TASKPAD_ARCHIVE_2026-03.md`) |
| `--format` | `"json"\|"human"` | No | Output format; default: `"json"` |

### Archive Policy

**Archived bullets** (removed from TASKPAD and moved to archive):
- Checked bullets: `- [x] Task text`
- Planned bullets (any checkbox state): `- [ ] Task text planned-2026-03-03`

**Preserved bullets** (remain in TASKPAD):
- Unchecked bullets without planned markers: `- [ ] Active execution task`

**Archive format**:
- Monthly sections: `## Archived from YYYY-MM-DD`
- Each bullet annotated with fingerprint: `- [x] Task text <!-- fingerprint: abc123def456 -->`
- Source metadata in archive header with generation timestamp

### Fingerprint Schema

```typescript
interface ExecutionQueueBulletFingerprint {
  lineNumber: number;           // 1-indexed line number in TASKPAD
  rawText: string;              // Original line including checkbox and markers
  checkboxState: "checked" | "unchecked";
  markerShape: "unparenthesized" | "parenthesized" | "none";  // planned marker format
  plannedDate: string | null;   // YYYY-MM-DD if planned marker present
  taskText: string;             // Normalized task text (checkbox and markers removed)
  fingerprintHash: string;      // SHA-256(16) of normalized fields
}
```

**Fingerprint computation** (deterministic):
```typescript
const normalized = [
  fingerprint.lineNumber,
  fingerprint.checkboxState,
  fingerprint.markerShape,
  fingerprint.plannedDate,
  fingerprint.taskText.trim(),
].join("|");

const fingerprintHash = createHash("sha256")
  .update(normalized)
  .digest("hex")
  .slice(0, 16);  // First 16 hex characters
```

### Deterministic Rule IDs

| Rule ID | Status | Meaning |
|---------|--------|---------|
| `EQP001_PRUNE_OK` | success | Prune completed successfully |
| `EQP002_PRUNE_NOOP_NO_ARCHIVE_CANDIDATES` | noop | No checked/planned bullets to archive |
| `EQP003_PRUNE_NOOP_EXECUTION_QUEUE_MISSING` | noop | No `## Execution Queue` heading in TASKPAD |
| `EQP004_PRUNE_INPUT_INVALID` | error | Invalid input parameters |
| `EQP005_PRUNE_TASKPAD_READ_FAILED` | error | Failed to read TASKPAD.md |
| `EQP006_PRUNE_TASKPAD_STRUCTURE_INVALID` | error | Multiple `## Execution Queue` headings found |
| `EQP007_PRUNE_ARCHIVE_WRITE_FAILED` | error | Failed to write archive file |
| `EQP008_PRUNE_TASKPAD_WRITE_FAILED` | error | Failed to write TASKPAD.md |
| `EQP009_PRUNE_ATOMIC_COMMIT_ABORTED` | error | Atomic write transaction failed, rollback attempted |

### Output Schema

```typescript
interface ExecutionQueuePruneResult {
  status: "success" | "noop" | "error";
  reasonCode: ExecutionQueuePruneReasonCode;
  inputs: {
    taskpadPath: string;
    archivePath: string;
  };
  stats: {
    totalExecutionQueueLines: number;
    archivedBulletsCount: number;
    preservedBulletsCount: number;
  };
  archivedBullets: ExecutionQueueBulletFingerprint[];
  structuralErrors: string[];
  timestamp: string;  // ISO 8601
}
```

### Output Ordering (Deterministic)

- `archivedBullets`: Sorted by `lineNumber` ascending, then `rawText` lexicographically
- `structuralErrors`: Sorted alphabetically
- JSON keys: Alphabetical order for machine parsing

### Exit Codes

- `0`: success or noop
- `1`: error (any `EQP00*` error rule)
- `2`: input validation error (missing required arguments)

### Example JSON Output

```json
TASKPAD_EXECUTION_QUEUE_PRUNE_JSON_START
{
  "archivedBullets": [
    {
      "checkboxState": "checked",
      "fingerprintHash": "a1b2c3d4e5f6g7h8",
      "lineNumber": 42,
      "markerShape": "none",
      "plannedDate": null,
      "rawText": "  - [x] Fix authentication flow",
      "taskText": "Fix authentication flow"
    }
  ],
  "inputs": {
    "archivePath": "/path/to/docs/archive/TASKPAD_ARCHIVE_2026-03.md",
    "taskpadPath": "/path/to/TASKPAD.md"
  },
  "reasonCode": "EQP001_PRUNE_OK",
  "stats": {
    "archivedBulletsCount": 1,
    "preservedBulletsCount": 2,
    "totalExecutionQueueLines": 3
  },
  "status": "success",
  "structuralErrors": [],
  "timestamp": "2026-03-03T12:00:00.000Z"
}
TASKPAD_EXECUTION_QUEUE_PRUNE_JSON_END
```

---

## Command: `taskpad:execution-queue-archive-parity`

### Purpose

Validate one-to-one fingerprint parity between pruned Execution Queue bullets and archive entries. Detect drift with actionable diagnostics.

### Inputs

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `--taskpad` | `string` | Yes | Path to TASKPAD.md file |
| `--archive` | `string` | Yes | Path to monthly archive file |
| `--format` | `"json"\|"human"` | No | Output format; default: `"json"` |

### Parity Contract

**Valid parity** (status: `pass`):
- Every checked/planned bullet in TASKPAD `## Execution Queue` has exactly one matching fingerprint in archive
- No extra fingerprint entries in archive beyond TASKPAD bullets
- All fingerprints are unique (no duplicates)

**Invalid parity** (status: `fail`):
- Missing fingerprints: TASKPAD bullet not found in archive
- Extra fingerprints: Archive entry not matching any TASKPAD bullet
- Duplicate fingerprints: Same fingerprint appears multiple times in archive
- Mutated fingerprints: Fingerprint hash computed differently than expected

### Deterministic Rule IDs

| Rule ID | Severity | Drift Type | Meaning |
|---------|----------|------------|---------|
| `EQAP001_PARITY_OK` | — | — | Parity validation passed |
| `EQAP002_PARITY_ARCHIVE_MISSING` | error | — | Archive file does not exist and TASKPAD has archived bullets |
| `EQAP003_PARITY_TASKPAD_MISSING` | error | — | TASKPAD file not found |
| `EQAP004_PARITY_MISSING_FINGERPRINT` | error | missing_fingerprint | Archive entry missing fingerprint comment |
| `EQAP005_PARITY_DUPLICATE_FINGERPRINT` | warning | duplicate_fingerprint | Same fingerprint appears multiple times |
| `EQAP006_PARITY_MISSING_FROM_ARCHIVE` | error | missing_from_taskpad | TASKPAD bullet not found in archive |
| `EQAP007_PARITY_EXTRA_IN_ARCHIVE` | error | extra_in_archive | Archive entry not matching any TASKPAD bullet |
| `EQAP008_PARITY_MUTATED_FINGERPRINT` | error | mutated_fingerprint | Fingerprint hash mismatch detected |
| `EQAP009_PARITY_INPUT_INVALID` | error | — | Invalid input parameters |

### Output Schema

```typescript
interface ExecutionQueueArchiveParityResult {
  status: "pass" | "fail";
  reasonCode: ExecutionQueueArchiveParityReasonCode;
  inputs: {
    taskpadPath: string;
    archivePath: string;
  };
  stats: {
    archivedBulletsInTaskpad: number;
    fingerprintRecordsInArchive: number;
    missingFingerprints: number;
    duplicateFingerprints: number;
    missingFromArchive: number;
    extraInArchive: number;
    mutatedFingerprints: number;
  };
  violations: ParityViolation[];
  timestamp: string;
}

interface ParityViolation {
  ruleId: string;
  severity: "error" | "warning";
  driftType: "missing_fingerprint" | "duplicate_fingerprint" | "missing_from_taskpad" | "extra_in_archive" | "mutated_fingerprint";
  fingerprintHash?: string;
  lineNumber?: number;
  taskText?: string;
  remediation: string;
}
```

### Violation Remediation Mapping

| Drift Type | Rule ID | Remediation Pattern |
|------------|---------|---------------------|
| `missing_fingerprint` | `EQAP004` | Add fingerprint comment to archive entry |
| `duplicate_fingerprint` | `EQAP005` | Remove duplicate fingerprint entries from archive |
| `missing_from_taskpad` | `EQAP006` | Re-run prune or manually add fingerprint to archive |
| `extra_in_archive` | `EQAP007` | Remove extra archive entry or verify TASKPAD source |
| `mutated_fingerprint` | `EQAP008` | Re-compute fingerprint and update archive comment |

### Canonical Violation Ordering

Violations are sorted deterministically for stable test outputs:

1. **Primary sort**: Canonical rule ID order
   - `EQAP004_PARITY_MISSING_FINGERPRINT`
   - `EQAP005_PARITY_DUPLICATE_FINGERPRINT`
   - `EQAP006_PARITY_MISSING_FROM_ARCHIVE`
   - `EQAP007_PARITY_EXTRA_IN_ARCHIVE`
   - `EQAP008_PARITY_MUTATED_FINGERPRINT`

2. **Secondary sort**: `driftType` lexicographically

3. **Tertiary sort**: `lineNumber` ascending (if present)

4. **Quaternary sort**: `fingerprintHash` lexicographically (if present)

### Output Ordering (Deterministic)

- `violations`: Sorted by canonical violation ordering (see above)
- JSON keys: Alphabetical order
- `stats`: All numeric fields, alphabetically sorted

### Exit Codes

- `0`: pass (parity validated)
- `1`: fail (parity violations detected)
- `2`: input validation error (missing/invalid arguments)

### Example JSON Output

```json
TASKPAD_EXECUTION_QUEUE_ARCHIVE_PARITY_JSON_START
{
  "inputs": {
    "archivePath": "/path/to/docs/archive/TASKPAD_ARCHIVE_2026-03.md",
    "taskpadPath": "/path/to/TASKPAD.md"
  },
  "reasonCode": "EQAP001_PARITY_OK",
  "stats": {
    "archivedBulletsInTaskpad": 3,
    "duplicateFingerprints": 0,
    "extraInArchive": 0,
    "fingerprintRecordsInArchive": 3,
    "missingFingerprints": 0,
    "missingFromArchive": 0,
    "mutatedFingerprints": 0
  },
  "status": "pass",
  "timestamp": "2026-03-03T12:00:00.000Z",
  "violations": []
}
TASKPAD_EXECUTION_QUEUE_ARCHIVE_PARITY_JSON_END
```

### Example Fail Output

```json
TASKPAD_EXECUTION_QUEUE_ARCHIVE_PARITY_JSON_START
{
  "inputs": {
    "archivePath": "/path/to/docs/archive/TASKPAD_ARCHIVE_2026-03.md",
    "taskpadPath": "/path/to/TASKPAD.md"
  },
  "reasonCode": "EQAP006_PARITY_MISSING_FROM_ARCHIVE",
  "stats": {
    "archivedBulletsInTaskpad": 3,
    "duplicateFingerprints": 0,
    "extraInArchive": 1,
    "fingerprintRecordsInArchive": 2,
    "missingFingerprints": 0,
    "missingFromArchive": 1,
    "mutatedFingerprints": 0
  },
  "status": "fail",
  "timestamp": "2026-03-03T12:00:00.000Z",
  "violations": [
    {
      "driftType": "extra_in_archive",
      "fingerprintHash": "deadbeefdeadbeef",
      "lineNumber": 15,
      "remediation": "Remove archive entry with fingerprint deadbeefdeadbeef or verify TASKPAD source",
      "ruleId": "EQAP007_PARITY_EXTRA_IN_ARCHIVE",
      "severity": "error",
      "taskText": "Orphaned archive entry"
    },
    {
      "driftType": "missing_from_taskpad",
      "fingerprintHash": "cafe1234cafe1234",
      "lineNumber": 47,
      "remediation": "Add fingerprint metadata for bullet at line 47 to archive",
      "ruleId": "EQAP006_PARITY_MISSING_FROM_ARCHIVE",
      "severity": "error",
      "taskText": "Unarchived checked task"
    }
  ]
}
TASKPAD_EXECUTION_QUEUE_ARCHIVE_PARITY_JSON_END
```

---

## Shared Contracts

### Heading Detection

```typescript
const EXECUTION_QUEUE_HEADING_REGEX = /^##\s+Execution Queue\b/;
```

- Must match exactly `## Execution Queue` (case-sensitive)
- Rejects variants like `## Execution Queue - Active` or `### Execution Queue`
- Multiple headings: error (`EQP006_PRUNE_TASKPAD_STRUCTURE_INVALID`)

### Checkbox Detection

```typescript
const CHECKED_CHECKBOX_REGEX = /^(\s*[-*+]\s+\[[xX]\]\s+)/;
const UNCHECKED_CHECKBOX_REGEX = /^(\s*[-*+\]\s+\[\s*\]\s+)/;
```

### Planned Marker Extraction

- **Unparenthesized**: `planned-YYYY-MM-DD` anywhere in line
- **Parenthesized**: `(planned-YYYY-MM-DD)` anywhere in line
- Both forms are valid; shape is tracked in fingerprint

```typescript
function extractPlannedMarker(line: string): { date: string | null; shape: MarkerShape } {
  // Unparenthesized: planned-YYYY-MM-DD
  const unparenthesizedMatch = line.match(/(?:^|\s)(planned-(\d{4}-\d{2}-\d{2}))(?:\s|$)/);
  if (unparenthesizedMatch) {
    return { date: unparenthesizedMatch[2], shape: "unparenthesized" };
  }

  // Parenthesized: (planned-YYYY-MM-DD)
  const parenthesizedMatch = line.match(/\(planned-(\d{4}-\d{2}-\d{2})\)/);
  if (parenthesizedMatch) {
    return { date: parenthesizedMatch[1], shape: "parenthesized" };
  }

  return { date: null, shape: "none" };
}
```

### Fingerprint Comment Parsing

```typescript
const FINGERPRINT_COMMENT_REGEX = /<!--\s*fingerprint:\s*([a-f0-9]{16})\s*-->/;
```

- Extracts 16-character hex fingerprint from HTML comment
- Used by parity validator to read archived fingerprints

### Archive Candidate Determination

```typescript
function isArchiveCandidate(bullet: ExecutionQueueBulletFingerprint): boolean {
  return bullet.checkboxState === "checked" || bullet.plannedDate !== null;
}
```

---

## Atomic Write Contract

Both prune operations use atomic writes to ensure data consistency:

1. Write temporary files: `<target>.taskpad-execution-queue-prune.tmp-<pid>-<timestamp>-<random>`
2. Write archive temp file first, then TASKPAD temp file
3. Rename archive temp → archive (committed)
4. Rename TASKPAD temp → TASKPAD (committed)
5. On any error, rollback both files to original state

**Failure modes**:
- Write failure before commit: No files modified
- Write failure after archive commit: Rollback archive, no TASKPAD modification
- Write failure after TASKPAD commit: Best-effort rollback (data may be inconsistent, but parity gate will detect)

---

## Integration with Intake-Auto Flow

### Canonical Invocation Sequence

```bash
# 1. Prune Execution Queue
bun run taskpad:execution-queue-prune \
  -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" \
     --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" \
     --format json

# 2. Validate parity
bun run taskpad:execution-queue-archive-parity \
  -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" \
     --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" \
     --format json

# 3. Run intake-auto (only if parity passes)
bun run verify:taskpad:intake:auto \
  -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" \
     --plan IMPLEMENTATION_PLAN.md \
     --format json
```

### Verification Pack Integration

Both commands emit machine-readable JSON with delimiters:

- `TASKPAD_EXECUTION_QUEUE_PRUNE_JSON_START` / `TASKPAD_EXECUTION_QUEUE_PRUNE_JSON_END`
- `TASKPAD_EXECUTION_QUEUE_ARCHIVE_PARITY_JSON_START` / `TASKPAD_EXECUTION_QUEUE_ARCHIVE_PARITY_JSON_END`

These delimiters enable verification pack extraction and downstream telemetry.

---

## Differences from Work Queue Contracts

| Aspect | Work Queue | Execution Queue |
|--------|------------|-----------------|
| Heading | `## Work Queue` | `## Execution Queue` |
| Rule prefix | `WQP*`, `WQAP*` | `EQP*`, `EQAP*` |
| Temp file tag | `.taskpad-work-queue-prune.tmp` | `.taskpad-execution-queue-prune.tmp` |
| JSON delimiter | `TASKPAD_WORK_QUEUE_*` | `TASKPAD_EXECUTION_QUEUE_*` |
| Function names | `parseWorkQueue*`, `pruneWorkQueue` | `parseExecutionQueue*`, `pruneExecutionQueue` |

All other contracts (fingerprint schema, archive policy, parity semantics, output ordering) are **identical** to Work Queue contracts for consistency and maintainability.

---

## Test Coverage Requirements

### Prune Tests (`tests/tools/taskpad-execution-queue-prune.test.ts`)

- **Pass scenarios**:
  - Multiple checked bullets → all archived
  - Mix of checked and unchecked → only checked archived
  - Planned unchecked bullets → archived
  - New archive file → created with header
  - Existing archive file → appended with new section

- **Noop scenarios**:
  - No Execution Queue heading → status `noop`, reason `EQP003`
  - Only unchecked bullets → status `noop`, reason `EQP002`
  - Empty Execution Queue → status `noop`, reason `EQP002`

- **Error scenarios**:
  - Multiple Execution Queue headings → error, reason `EQP006`
  - Invalid TASKPAD path → error, reason `EQP005`
  - Unwritable archive directory → error, reason `EQP007`
  - Atomic write failure → error, reason `EQP009`

### Parity Tests (`tests/tools/taskpad-execution-queue-archive-parity.test.ts`)

- **Pass scenarios**:
  - Fresh archive with all fingerprints → status `pass`
  - No archive, no archived bullets → status `pass`
  - Mixed archive with correct fingerprints → status `pass`

- **Fail scenarios**:
  - Missing fingerprints in archive → status `fail`, reason `EQAP006`
  - Extra fingerprints in archive → status `fail`, reason `EQAP007`
  - Duplicate fingerprints → status `fail`, reason `EQAP005`
  - Archive missing, bullets exist → status `fail`, reason `EQAP002`

- **Deterministic ordering**:
  - Violations sorted by canonical rule ID order
  - Stable JSON output across runs

---

## Implementation Checklist (for TP002-TP004)

- [ ] TP002: Implement `tools/taskpad-execution-queue-prune.ts`
  - [ ] Parse `## Execution Queue` section
  - [ ] Build bullet fingerprints with deterministic hash
  - [ ] Filter archive candidates (checked/planned)
  - [ ] Build archive markdown with fingerprint annotations
  - [ ] Rewrite TASKPAD without archived bullets
  - [ ] Atomic write with rollback
  - [ ] JSON/human output formatting
  - [ ] CLI argument parsing

- [ ] TP003: Implement `tools/taskpad-execution-queue-archive-parity.ts`
  - [ ] Parse TASKPAD for archived bullets
  - [ ] Parse archive for fingerprint records
  - [ ] Compare fingerprint sets
  - [ ] Detect missing/extra/duplicate fingerprints
  - [ ] Generate violations with remediation
  - [ ] Sort violations deterministically
  - [ ] JSON/human output formatting
  - [ ] CLI argument parsing

- [ ] TP004: Add tests
  - [ ] `tests/tools/taskpad-execution-queue-prune.test.ts`
  - [ ] `tests/tools/taskpad-execution-queue-archive-parity.test.ts`
  - [ ] Fixture corpus for all scenarios
  - [ ] Deterministic output assertions

- [ ] TP005: Wire scripts/docs
  - [ ] Add npm scripts to `package.json`
  - [ ] Update `README.md` with canonical invocation
  - [ ] Update `docs/quality/taskpad-queue-health.md` with execution queue coverage
  - [ ] Integrate into `verify:taskpad:intake:auto` flow

---

## Appendix: TypeScript Type Exports

```typescript
// Shared types
export type CheckboxState = "checked" | "unchecked";
export type MarkerShape = "unparenthesized" | "parenthesized" | "none";

// Execution Queue Prune types
export const EXECUTION_QUEUE_PRUNE_RULE_IDS = {
  PRUNE_OK: "EQP001_PRUNE_OK",
  PRUNE_NOOP_NO_ARCHIVE_CANDIDATES: "EQP002_PRUNE_NOOP_NO_ARCHIVE_CANDIDATES",
  PRUNE_NOOP_EXECUTION_QUEUE_MISSING: "EQP003_PRUNE_NOOP_EXECUTION_QUEUE_MISSING",
  PRUNE_INPUT_INVALID: "EQP004_PRUNE_INPUT_INVALID",
  PRUNE_TASKPAD_READ_FAILED: "EQP005_PRUNE_TASKPAD_READ_FAILED",
  PRUNE_TASKPAD_STRUCTURE_INVALID: "EQP006_PRUNE_TASKPAD_STRUCTURE_INVALID",
  PRUNE_ARCHIVE_WRITE_FAILED: "EQP007_PRUNE_ARCHIVE_WRITE_FAILED",
  PRUNE_TASKPAD_WRITE_FAILED: "EQP008_PRUNE_TASKPAD_WRITE_FAILED",
  PRUNE_ATOMIC_COMMIT_ABORTED: "EQP009_PRUNE_ATOMIC_COMMIT_ABORTED",
} as const;

export type ExecutionQueuePruneReasonCode =
  (typeof EXECUTION_QUEUE_PRUNE_RULE_IDS)[keyof typeof EXECUTION_QUEUE_PRUNE_RULE_IDS];

export interface ExecutionQueueBulletFingerprint {
  lineNumber: number;
  rawText: string;
  checkboxState: CheckboxState;
  markerShape: MarkerShape;
  plannedDate: string | null;
  taskText: string;
  fingerprintHash: string;
}

export interface ExecutionQueueParseResult {
  reasonCode: ExecutionQueuePruneReasonCode;
  executionQueueHeadingFound: boolean;
  executionQueueStartLine: number;
  executionQueueEndLine: number;
  allBullets: ExecutionQueueBulletFingerprint[];
  archivedBullets: ExecutionQueueBulletFingerprint[];
  preservedBullets: ExecutionQueueBulletFingerprint[];
  structuralErrors: string[];
}

export interface ExecutionQueuePruneResult {
  status: "success" | "noop" | "error";
  reasonCode: ExecutionQueuePruneReasonCode;
  inputs: {
    taskpadPath: string;
    archivePath: string;
  };
  stats: {
    totalExecutionQueueLines: number;
    archivedBulletsCount: number;
    preservedBulletsCount: number;
  };
  archivedBullets: ExecutionQueueBulletFingerprint[];
  structuralErrors: string[];
  timestamp: string;
}

// Execution Queue Parity types
export const EXECUTION_QUEUE_ARCHIVE_PARITY_RULE_IDS = {
  PARITY_OK: "EQAP001_PARITY_OK",
  PARITY_ARCHIVE_MISSING: "EQAP002_PARITY_ARCHIVE_MISSING",
  PARITY_TASKPAD_MISSING: "EQAP003_PARITY_TASKPAD_MISSING",
  PARITY_MISSING_FINGERPRINT: "EQAP004_PARITY_MISSING_FINGERPRINT",
  PARITY_DUPLICATE_FINGERPRINT: "EQAP005_PARITY_DUPLICATE_FINGERPRINT",
  PARITY_MISSING_FROM_ARCHIVE: "EQAP006_PARITY_MISSING_FROM_ARCHIVE",
  PARITY_EXTRA_IN_ARCHIVE: "EQAP007_PARITY_EXTRA_IN_ARCHIVE",
  PARITY_MUTATED_FINGERPRINT: "EQAP008_PARITY_MUTATED_FINGERPRINT",
  PARITY_INPUT_INVALID: "EQAP009_PARITY_INPUT_INVALID",
} as const;

export type ExecutionQueueArchiveParityReasonCode =
  (typeof EXECUTION_QUEUE_ARCHIVE_PARITY_RULE_IDS)[keyof typeof EXECUTION_QUEUE_ARCHIVE_PARITY_RULE_IDS];

export type ParityDriftType =
  | "missing_fingerprint"
  | "duplicate_fingerprint"
  | "missing_from_taskpad"
  | "extra_in_archive"
  | "mutated_fingerprint";

export type ViolationSeverity = "error" | "warning";

export interface ArchiveFingerprintRecord {
  lineNumber: number;
  rawLine: string;
  fingerprintHash: string;
  taskText: string;
}

export interface ExecutionQueueAnalysis {
  archivedBullets: ExecutionQueueBulletFingerprint[];
  allBullets: ExecutionQueueBulletFingerprint[];
  parseErrors: string[];
}

export interface ParityViolation {
  ruleId: string;
  severity: ViolationSeverity;
  driftType: ParityDriftType;
  fingerprintHash?: string;
  lineNumber?: number;
  taskText?: string;
  remediation: string;
}

export interface ExecutionQueueArchiveParityResult {
  status: "pass" | "fail";
  reasonCode: ExecutionQueueArchiveParityReasonCode;
  inputs: {
    taskpadPath: string;
    archivePath: string;
  };
  specs: {
    archivedBulletsInTaskpad: number;
    fingerprintRecordsInArchive: number;
    missingFingerprints: number;
    duplicateFingerprints: number;
    missingFromArchive: number;
    extraInArchive: number;
    mutatedFingerprints: number;
  };
  violations: ParityViolation[];
  timestamp: string;
}
```

---

**Contract Status**: DRAFT
**Next Task**: TP002 - Implement `tools/taskpad-execution-queue-prune.ts`
