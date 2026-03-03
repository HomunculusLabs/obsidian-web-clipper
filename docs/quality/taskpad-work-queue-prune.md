# TASKPAD Work Queue Prune and Archive Parity Contracts

## Purpose
Define deterministic contracts for archiving completed/planned Work Queue bullets and validating archive↔TASKPAD fingerprint parity to maintain auditability while keeping active TASKPAD lean for ideation.

## Overview

### Two Commands, One Contract

This contract defines two complementary commands:

1. **`taskpad:work-queue-prune`** — Archives checked/planned Work Queue bullets into monthly archive files while preserving unchecked executable items in-place.

2. **`taskpad:work-queue-archive-parity`** — Validates one-to-one fingerprint parity between pruned TASKPAD bullets and archive entries, detecting drift with actionable diagnostics.

Both commands share the same fingerprint schema, rule IDs, and JSON output ordering for deterministic integration into intake-auto flows.

---

## `taskpad:work-queue-prune` Contract

### Inputs

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `--taskpad` | string | Yes | Path to TASKPAD.md file |
| `--archive` | string | Yes | Path to archive file (e.g., `docs/archive/TASKPAD_ARCHIVE_2026-03.md`) |
| `--format` | `"json"\|"human"` | No | Output format (default: `json`) |

### Archive Path Policy

**Canonical archive location:** `docs/archive/TASKPAD_ARCHIVE_YYYY-MM.md`

- Archives are stored under `docs/archive/` directory
- Archive filename pattern: `TASKPAD_ARCHIVE_YYYY-MM.md` where `YYYY-MM` is the current month
- Archive directory structure: `{projectRoot}/docs/archive/`
- If archive directory doesn't exist, prune command MUST create it (recursive)

**Archive naming rules:**
1. Always use current month's archive file for new prune operations
2. Append to existing archive file if it exists (do not overwrite)
3. Use separator `---\n\n` between archived sections
4. Preserve original markdown formatting (whitespace, indentation, checkbox states)

### Bullet Selection Rules

**Archived bullets (checked/planned):**

A Work Queue bullet is eligible for archiving when it matches **ALL** of:

1. Located under `## Work Queue` heading (case-sensitive)
2. Has a **checked checkbox**: `- [x]` or `- [X]` (internal whitespace variants allowed)
3. **OR** has a **planned marker**: `planned-YYYY-MM-DD` or `(planned-YYYY-MM-DD)`

**Preserved bullets (unchecked, no planned marker):**

A Work Queue bullet is preserved in-place when it matches **ANY** of:

1. Has an **unchecked checkbox**: `- [ ]`
2. Has **no planned marker** in the text after checkbox prefix

**Pattern definitions:**

```typescript
// Checkbox patterns
const CHECKED_CHECKBOX_REGEX = /^(\s*[-*+]\s+\[[xX]\]\s+)/;
const UNCHECKED_CHECKBOX_REGEX = /^(\s*[-*+]\s+\[\s*\]\s+)/;

// Planned marker patterns (both shapes supported)
const UNPARENTHESIZED_MARKER_REGEX = /^(planned-(\d{4}-\d{2}-\d{2}))/;
const PARENTHESIZED_MARKER_REGEX = /^\((planned-(\d{4}-\d{2}-\d{2}))\)/;
```

### Fingerprint Schema

Each archived bullet receives a **deterministic fingerprint** used for parity validation.

```typescript
interface WorkQueueBulletFingerprint {
  /** Original line number in TASKPAD (1-indexed) */
  lineNumber: number;

  /** Full original text including checkbox prefix */
  rawText: string;

  /** Checkbox state: "checked" or "unchecked" */
  checkboxState: "checked" | "unchecked";

  /** Marker shape if present */
  markerShape: "unparenthesized" | "parenthesized" | "none";

  /** Planned date if marker present (YYYY-MM-DD format) */
  plannedDate: string | null;

  /** Task text after removing checkbox and marker */
  taskText: string;

  /** Deterministic hash for parity checks */
  fingerprintHash: string;
}
```

**Fingerprint hash computation:**

```typescript
function computeFingerprintHash(fingerprint: WorkQueueBulletFingerprint): string {
  const normalized = [
    fingerprint.lineNumber,
    fingerprint.checkboxState,
    fingerprint.markerShape,
    fingerprint.plannedDate,
    fingerprint.taskText.trim(),
  ].join("|");
  
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
```

The fingerprint hash is **deterministic** based on:
- Line number (preserves original ordering context)
- Checkbox state (checked/unchecked)
- Marker shape (unparenthesized/parenthesized/none)
- Planned date (if present)
- Task text (trimmed, case-sensitive)

### Deterministic Rule IDs

```typescript
const WORK_QUEUE_PRUNE_RULE_IDS = {
  PRUNE_OK: "WQP001_PRUNE_OK",
  PRUNE_NOOP_NO_ARCHIVE_CANDIDATES: "WQP002_PRUNE_NOOP_NO_ARCHIVE_CANDIDATES",
  PRUNE_NOOP_WORK_QUEUE_MISSING: "WQP003_PRUNE_NOOP_WORK_QUEUE_MISSING",
  PRUNE_INPUT_INVALID: "WQP004_PRUNE_INPUT_INVALID",
  PRUNE_TASKPAD_READ_FAILED: "WQP005_PRUNE_TASKPAD_READ_FAILED",
  PRUNE_TASKPAD_STRUCTURE_INVALID: "WQP006_PRUNE_TASKPAD_STRUCTURE_INVALID",
  PRUNE_ARCHIVE_WRITE_FAILED: "WQP007_PRUNE_ARCHIVE_WRITE_FAILED",
  PRUNE_TASKPAD_WRITE_FAILED: "WQP008_PRUNE_TASKPAD_WRITE_FAILED",
  PRUNE_ATOMIC_COMMIT_ABORTED: "WQP009_PRUNE_ATOMIC_COMMIT_ABORTED",
} as const;
```

### JSON Output Ordering

**Prune output schema (deterministic key order):**

```typescript
interface WorkQueuePruneResult {
  status: "success" | "noop" | "error";
  reasonCode: string;
  
  // Input paths
  inputs: {
    taskpadPath: string;
    archivePath: string;
  };
  
  // Statistics
  stats: {
    totalWorkQueueLines: number;
    archivedBulletsCount: number;
    preservedBulletsCount: number;
  };
  
  // Archived bullets (with fingerprints)
  archivedBullets: WorkQueueBulletFingerprint[];
  
  // Structural errors (if any)
  structuralErrors: string[];
  
  // Timestamp
  timestamp: string;
}
```

**Deterministic JSON ordering (alphabetical by key):**

```json
{
  "archivedBullets": [...],
  "inputs": {...},
  "reasonCode": "WQP001_PRUNE_OK",
  "stats": {...},
  "status": "success",
  "structuralErrors": [],
  "timestamp": "2026-03-03T04:00:00.000Z"
}
```

**Archived bullets array ordering:**

- Sorted by `lineNumber` ascending (preserves original TASKPAD order)
- Within same lineNumber (should not occur), sorted by `rawText` lexicographically

### Exit Codes

| Exit Code | Meaning | When |
|-----------|---------|------|
| 0 | Success / Noop | Prune succeeded or had no bullets to archive |
| 1 | Error | Atomic commit failed or file I/O error |
| 2 | Input Validation | Invalid arguments or file not found |

### Atomic Write Guarantees

The prune command MUST write changes atomically:

1. **Read original TASKPAD and archive** (if exists)
2. **Compute pruned bullets** and archive candidates
3. **Write temp files** for both TASKPAD and archive
4. **Rename temp to archive** first (new archive content)
5. **Rename temp to TASKPAD** second (pruned taskpad content)
6. **On any error**: rollback both files to original state

**Temp file naming pattern:**
```
{targetPath}.taskpad-work-queue-prune.tmp-{pid}-{timestamp}-{random}
```

**Rollback behavior:**
- If archive rename succeeded but TASKPAD rename failed: restore original archive (or delete if newly created)
- If TASKPAD rename succeeded but archive rename failed (should not happen with order above): restore original TASKPAD

### Human Output Format

```
TASKPAD Work Queue Prune: SUCCESS
────────────────────────────────────
Input:
  - taskpad: path/to/TASKPAD.md
  - archive: path/to/TASKPAD_ARCHIVE_2026-03.md

Stats:
  - totalWorkQueueLines: 15
  - archivedBulletsCount: 5
  - preservedBulletsCount: 3

Archived bullets: 5
Preserved bullets: 3

Reason: WQP001_PRUNE_OK
```

---

## `taskpad:work-queue-archive-parity` Contract

### Inputs

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `--taskpad` | string | Yes | Path to TASKPAD.md file |
| `--archive` | string | Yes | Path to archive file (e.g., `docs/archive/TASKPAD_ARCHIVE_2026-03.md`) |
| `--format` | `"json"\|"human"` | No | Output format (default: `json`) |

### Parity Validation Rules

**Archive-to-TASKPAD parity check:**

For each entry in the archive file, verify:

1. **Fingerprint hash exists** in archived bullet metadata
2. **Fingerprint is unique** (no duplicates within archive)
3. **No missing bullets** from TASKPAD (every archived bullet has a fingerprint record)
4. **No extra bullets** in archive (all archive entries have matching TASKPAD fingerprints)

**Drift detection types:**

```typescript
type ParityDriftType =
  | "missing_fingerprint"        // Archive entry missing fingerprint metadata
  | "duplicate_fingerprint"       // Same fingerprint appears multiple times
  | "missing_from_taskpad"        // Archived bullet not in TASKPAD anymore
  | "extra_in_archive"            // Archive entry has no TASKPAD source
  | "mutated_fingerprint";        // Fingerprint hash doesn't match computed value
```

### Deterministic Rule IDs

```typescript
const WORK_QUEUE_ARCHIVE_PARITY_RULE_IDS = {
  PARITY_OK: "WQAP001_PARITY_OK",
  PARITY_ARCHIVE_MISSING: "WQAP002_PARITY_ARCHIVE_MISSING",
  PARITY_TASKPAD_MISSING: "WQAP003_PARITY_TASKPAD_MISSING",
  PARITY_MISSING_FINGERPRINT: "WQAP004_PARITY_MISSING_FINGERPRINT",
  PARITY_DUPLICATE_FINGERPRINT: "WQAP005_PARITY_DUPLICATE_FINGERPRINT",
  PARITY_MISSING_FROM_TASKPAD: "WQAP006_PARITY_MISSING_FROM_TASKPAD",
  PARITY_EXTRA_IN_ARCHIVE: "WQAP007_PARITY_EXTRA_IN_ARCHIVE",
  PARITY_MUTATED_FINGERPRINT: "WQAP008_PARITY_MUTATED_FINGERPRINT",
  PARITY_INPUT_INVALID: "WQAP009_PARITY_INPUT_INVALID",
} as const;
```

### JSON Output Ordering

**Parity output schema (deterministic key order):**

```typescript
interface WorkQueueArchiveParityResult {
  status: "pass" | "fail";
  reasonCode: string;
  
  // Input paths
  inputs: {
    taskpadPath: string;
    archivePath: string;
  };
  
  // Statistics
  stats: {
    archivedBulletsInTaskpad: number;
    fingerprintRecordsInArchive: number;
    missingFingerprints: number;
    duplicateFingerprints: number;
    missingFromTaskpad: number;
    extraInArchive: number;
    mutatedFingerprints: number;
  };
  
  // Drift violations (deterministic ordering)
  violations: ParityViolation[];
  
  // Timestamp
  timestamp: string;
}

interface ParityViolation {
  ruleId: string;
  severity: "error" | "warning";
  driftType: ParityDriftType;
  
  // For missing_fingerprint, duplicate_fingerprint, mutated_fingerprint
  fingerprintHash?: string;
  lineNumber?: number;
  
  // For missing_from_taskpad, extra_in_archive
  taskText?: string;
  
  // Remediation guidance
  remediation: string;
}
```

**Deterministic JSON ordering (alphabetical by key):**

```json
{
  "inputs": {...},
  "reasonCode": "WQAP001_PARITY_OK",
  "stats": {...},
  "status": "pass",
  "timestamp": "2026-03-03T04:00:00.000Z",
  "violations": []
}
```

**Violations array ordering:**

Sorted by (in priority order):
1. **Rule ID** (canonical alphabetical order)
2. **Drift type** (alphabetical)
3. **Line number** (ascending, if present)
4. **Fingerprint hash** (lexicographical, if present)

**Canonical violation order:**

```typescript
const CANONICAL_VIOLATION_ORDER: string[] = [
  "WQAP004_PARITY_MISSING_FINGERPRINT",
  "WQAP005_PARITY_DUPLICATE_FINGERPRINT",
  "WQAP006_PARITY_MISSING_FROM_TASKPAD",
  "WQAP007_PARITY_EXTRA_IN_ARCHIVE",
  "WQAP008_PARITY_MUTATED_FINGERPRINT",
];
```

### Exit Codes

| Exit Code | Meaning | When |
|-----------|---------|------|
| 0 | Pass | Archive parity validated successfully |
| 1 | Fail | One or more parity violations detected |
| 2 | Input Validation | Invalid arguments or file not found |

### Parity Check Algorithm

```typescript
function validateArchiveParity(
  taskpadMarkdown: string,
  archiveMarkdown: string | null,
): WorkQueueArchiveParityResult {
  // Step 1: Parse TASKPAD for archived bullets (checked/planned)
  const taskpadAnalysis = parseArchivedWorkQueueBullets(taskpadMarkdown);
  
  // Step 2: Parse archive for fingerprint records
  const archiveAnalysis = parseArchiveFingerprints(archiveMarkdown);
  
  // Step 3: Compute fingerprints for TASKPAD bullets
  const taskpadFingerprints = taskpadAnalysis.bullets.map(computeFingerprintHash);
  
  // Step 4: Build lookup maps
  const fingerprintSet = new Set(taskpadFingerprints.map(f => f.fingerprintHash));
  const archiveFingerprintSet = new Set(archiveAnalysis.fingerprints.map(f => f.fingerprintHash));
  
  // Step 5: Detect drift
  const violations: ParityViolation[] = [];
  
  // Check for missing fingerprints in archive
  for (const tf of taskpadFingerprints) {
    if (!archiveFingerprintSet.has(tf.fingerprintHash)) {
      violations.push({
        ruleId: RULE_IDS.PARITY_MISSING_FROM_TASKPAD,
        severity: "error",
        driftType: "missing_from_taskpad",
        fingerprintHash: tf.fingerprintHash,
        lineNumber: tf.lineNumber,
        taskText: tf.taskText,
        remediation: `Add fingerprint metadata for bullet at line ${tf.lineNumber} to archive`,
      });
    }
  }
  
  // Check for extra entries in archive
  for (const af of archiveAnalysis.fingerprints) {
    if (!fingerprintSet.has(af.fingerprintHash)) {
      violations.push({
        ruleId: RULE_IDS.PARITY_EXTRA_IN_ARCHIVE,
        severity: "error",
        driftType: "extra_in_archive",
        fingerprintHash: af.fingerprintHash,
        remediation: `Remove archive entry with fingerprint ${af.fingerprintHash} or verify TASKPAD source`,
      });
    }
  }
  
  // Check for duplicate fingerprints
  const fingerprintCounts = new Map<string, number>();
  for (const af of archiveAnalysis.fingerprints) {
    fingerprintCounts.set(af.fingerprintHash, (fingerprintCounts.get(af.fingerprintHash) || 0) + 1);
  }
  for (const [hash, count] of fingerprintCounts.entries()) {
    if (count > 1) {
      violations.push({
        ruleId: RULE_IDS.PARITY_DUPLICATE_FINGERPRINT,
        severity: "warning",
        driftType: "duplicate_fingerprint",
        fingerprintHash: hash,
        remediation: `Remove duplicate fingerprint entries for ${hash} from archive`,
      });
    }
  }
  
  // Step 6: Sort violations in canonical order
  const sortedViolations = sortViolationsCanonical(violations);
  
  // Step 7: Determine status
  const errorViolations = sortedViolations.filter(v => v.severity === "error");
  const status: "pass" | "fail" = errorViolations.length === 0 ? "pass" : "fail";
  
  return {
    status,
    reasonCode: status === "pass" ? "WQAP001_PARITY_OK" : "WQAP006_PARITY_MISSING_FROM_TASKPAD",
    inputs: { taskpadPath, archivePath },
    stats: {
      archivedBulletsInTaskpad: taskpadAnalysis.bullets.length,
      fingerprintRecordsInArchive: archiveAnalysis.fingerprints.length,
      missingFingerprints: violations.filter(v => v.driftType === "missing_fingerprint").length,
      duplicateFingerprints: violations.filter(v => v.driftType === "duplicate_fingerprint").length,
      missingFromTaskpad: violations.filter(v => v.driftType === "missing_from_taskpad").length,
      extraInArchive: violations.filter(v => v.driftType === "extra_in_archive").length,
      mutatedFingerprints: violations.filter(v => v.driftType === "mutated_fingerprint").length,
    },
    violations: sortedViolations,
    timestamp: new Date().toISOString(),
  };
}
```

### Human Output Format

**Pass case:**
```
TASKPAD Work Queue Archive Parity: PASS
───────────────────────────────────────────
Input:
  - taskpad: path/to/TASKPAD.md
  - archive: path/to/TASKPAD_ARCHIVE_2026-03.md

Stats:
  - archivedBulletsInTaskpad: 5
  - fingerprintRecordsInArchive: 5
  - missingFingerprints: 0
  - duplicateFingerprints: 0
  - missingFromTaskpad: 0
  - extraInArchive: 0
  - mutatedFingerprints: 0

Violations: 0

Reason: WQAP001_PARITY_OK
```

**Fail case:**
```
TASKPAD Work Queue Archive Parity: FAIL
───────────────────────────────────────────
Input:
  - taskpad: path/to/TASKPAD.md
  - archive: path/to/TASKPAD_ARCHIVE_2026-03.md

Stats:
  - archivedBulletsInTaskpad: 5
  - fingerprintRecordsInArchive: 4
  - missingFingerprints: 0
  - duplicateFingerprints: 0
  - missingFromTaskpad: 1
  - extraInArchive: 0
  - mutatedFingerprints: 0

Violations: 1
  - [WQAP006] missing_from_taskpad: Line 42 bullet not in archive
    Remediation: Add fingerprint metadata for bullet at line 42 to archive

Reason: WQAP006_PARITY_MISSING_FROM_TASKPAD
```

---

## Archive File Format

### Archive File Structure

Archive files use the following format:

```markdown
<!-- 
TASKPAD Work Queue Archive: 2026-03
Generated: 2026-03-03T04:00:00.000Z
Source TASKPAD: path/to/TASKPAD.md
-->

---

## Archived from 2026-03-03

- [x] planned-2026-03-01 Completed task 1 <!-- fingerprint: a1b2c3d4e5f6... -->
- [x] Completed task 2 (planned-2026-03-01) <!-- fingerprint: 7f8e9d0c1b2a... -->

---

## Archived from 2026-03-02

- [x] planned-2026-03-02 Completed task 3 <!-- fingerprint: 3f4e5d6c7b8a... -->
```

**Archive file rules:**

1. **Header comment** at top with metadata (optional but recommended for human readability)
2. **Section separator**: `---\n\n` (three hyphens followed by two newlines)
3. **Section headings**: `## Archived from YYYY-MM-DD`
4. **Fingerprint metadata**: inline HTML comment `<!-- fingerprint: {hash} -->`
5. **Preserve original formatting**: checkbox state, indentation, marker shape

**Fingerprint comment format:**

```html
<!-- fingerprint: a1b2c3d4e5f6g7h8 -->
```

- 16-character SHA256 hex suffix
- Placed at end of bullet line (after task text)
- Required for parity validation

---

## Integration into Intake-Auto Flow

### Canonical Verification Sequence

```bash
# 1. Check queue health (existing)
bun run taskpad:queue-health -- --taskpad TASKPAD.md --format json

# 2. If executable queues empty, trigger auto-ideation (existing)
bun run taskpad:auto-ideation -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --target-queue work

# 3. Prune Work Queue if needed (NEW - TP001)
bun run taskpad:work-queue-prune -- --taskpad TASKPAD.md --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" --format json

# 4. Validate archive parity (NEW - TP001)
bun run taskpad:work-queue-archive-parity -- --taskpad TASKPAD.md --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" --format json

# 5. Run full intake verification (existing)
bun run verify:taskpad:intake:full -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md
```

### Decision Matrix

| `executableQueueTotal` | Checked/planned bullets | Prune needed? | Parity check needed? |
|----------------------|-------------------------|---------------|---------------------|
| 1+ | 0 | NO (noop) | YES (verify clean) |
| 1+ | 1+ | YES | YES (after prune) |
| 0 | 0 | NO (noop) | YES (verify clean) |
| 0 | 1+ | YES | YES (after prune) |

**Invariant:** Archive parity check MUST always run after prune to validate the operation, even if prune was a noop.

---

## Verification Commands (for TP004 tests)

```bash
# Prune with human output
bun run taskpad:work-queue-prune -- --taskpad tests/tools/fixtures/taskpad-work-queue.md --archive /tmp/TASKPAD_ARCHIVE_2026-03.md

# Prune with JSON output
bun run taskpad:work-queue-prune -- --taskpad tests/tools/fixtures/taskpad-work-queue.md --archive /tmp/TASKPAD_ARCHIVE_2026-03.md --format json

# Parity check with human output
bun run taskpad:work-queue-archive-parity -- --taskpad tests/tools/fixtures/taskpad-work-queue.md --archive /tmp/TASKPAD_ARCHIVE_2026-03.md

# Parity check with JSON output
bun run taskpad:work-queue-archive-parity -- --taskpad tests/tools/fixtures/taskpad-work-queue.md --archive /tmp/TASKPAD_ARCHIVE_2026-03.md --format json
```

---

## Non-Goals

For this contract slice:

- Validating task wording quality or priority tags.
- Re-ranking Work Queue items.
- Changing archive file location policy (canonical: `docs/archive/TASKPAD_ARCHIVE_YYYY-MM.md`).
- Modifying checked/planned detection patterns beyond defined regexes.
- Supporting non-Work Queue sections in prune operations.

---

## Migration Notes

### From `taskpad:plan-prune` Pattern

The Work Queue prune command follows the same architecture as `taskpad:plan-prune`:

| Aspect | `taskpad:plan-prune` | `taskpad:work-queue-prune` |
|--------|---------------------|----------------------------|
| Prune target | IMPLEMENTATION_PLAN slices | Work Queue bullets |
| Archive location | `docs/archive/IMPLEMENTATION_PLAN_ARCHIVE_YYYY-MM.md` | `docs/archive/TASKPAD_ARCHIVE_YYYY-MM.md` |
| Prune criterion | Completed slices (no unchecked TPs) | Checked bullets OR planned markers |
| Atomic writes | Yes | Yes |
| Parity gate | `taskpad:planned-command-parity` | `taskpad:work-queue-archive-parity` |

**Key difference:** Work Queue prune operates on individual bullet items with fingerprint metadata, while plan prune operates on entire slice sections.

### Backward Compatibility

Existing intake-auto flows continue to work without Work Queue pruning. Adding the prune command is opt-in via:

```bash
bun run verify:taskpad:intake:full
```

Will be extended in TP005 to include prune + parity steps.

---

## Future Extensions (out of scope for TP001)

- Automatic monthly archive rotation (creating new archive files)
- Archive compaction for old months
- Archive search/query utilities
- Cross-month bullet tracking
- Archive statistics and reporting
