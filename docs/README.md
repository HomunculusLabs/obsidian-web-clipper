# Obsidian Web Clipper - Documentation

This directory contains project documentation and contract specifications for core system behaviors.

## Contents

- [Headless Scenario Matrix](#headless-scenario-matrix) - Deterministic E2E validation contract
- [Quality Assurance](#quality-assurance) - Quality gates and validation reports
- [Distribution Artifacts](#distribution-artifacts) - Pilot and release evidence

---

## Headless Scenario Matrix

### Overview

The headless scenario matrix is a deterministic validation gate for web clip workflows. It defines a manifest-based contract that enforces required coverage for major clip entrypoints (generic web, SeedFinder, CLI-save) and emits machine-readable diagnostics for autonomous verification.

### Required Scenario IDs

The matrix MUST include at minimum these three required scenarios:

| Scenario ID | Description | Entry Point | Required |
|-------------|-------------|-------------|----------|
| `generic-web-clip` | Generic web page clipping through headless extraction | `clip-url.ts` → `extractWebPageContent()` | ✅ Yes |
| `seedfinder-strain-profile` | SeedFinder strain profile with template extraction | `clip-url.ts` → SeedFinder template path | ✅ Yes |
| `cli-save-contract` | CLI save contract validation via `obsidianCliSave.ts` | `tools/clip-stdin.ts` / `tools/clip-url.ts` → `saveViaCli()` | ✅ Yes |

Additional scenarios MAY be added to the manifest but MUST NOT weaken or remove required scenarios.

### Manifest Schema

The scenario manifest is a JSON file located at `tests/e2e/fixtures/clip-scenario-manifest.json`.

```typescript
interface ClipScenarioManifest {
  /** Manifest version for schema evolution control */
  manifestVersion: string;

  /** Human-readable description of this manifest */
  description: string;

  /** All registered scenarios (required and optional) */
  scenarios: Scenario[];
}

interface Scenario {
  /** Stable scenario identifier (required scenarios must use exact IDs above) */
  id: string;

  /** Human-readable scenario name */
  name: string;

  /** Whether this scenario is required for gate pass */
  required: boolean;

  /** Clip entry point type */
  entryPoint: "url" | "stdin" | "cli-save" | "template";

  /** Tool or function reference for execution */
  executor: {
    /** Tool file path relative to repo root */
    tool?: string;
    /** Test file path for harness integration */
    testFile?: string;
    /** Named test case or scenario marker */
    testCase?: string;
  };

  /** Fixture input configuration */
  fixture: {
    /** Path to fixture file (HTML, markdown, or custom format) */
    path: string;
    /** URL to simulate (for web clipping scenarios) */
    simulatedUrl?: string;
    /** Expected page type for routing assertions */
    pageType?: "web" | "youtube" | "pdf" | "article" | "video" | "document";
  };

  /** Expected output assertions */
  expectations: {
    /** Frontmatter keys that MUST be present */
    frontmatterKeys: string[];

    /** Required tags in the output */
    requiredTags?: string[];

    /** Content signals that MUST appear in markdown body */
    contentSignals?: string[];

    /** Content signals that MUST NOT appear (for negative assertions) */
    contentSignalsExcluded?: string[];

    /** Custom assertion rules (extensible for scenario-specific checks) */
    customAssertions?: Record<string, unknown>;
  };
}
```

### Example Manifest

```json
{
  "manifestVersion": "1.0.0",
  "description": "Headless clip scenario matrix for Obsidian Web Clipper validation gate",
  "scenarios": [
    {
      "id": "generic-web-clip",
      "name": "Generic web clip flow",
      "required": true,
      "entryPoint": "url",
      "executor": {
        "testFile": "tests/e2e/headless-clip-harness.test.ts",
        "testCase": "scenario #1: generic web clip assertions"
      },
      "fixture": {
        "path": "tests/extractors/fixtures/article.html",
        "simulatedUrl": "https://example.com/article",
        "pageType": "web"
      },
      "expectations": {
        "frontmatterKeys": ["source", "title", "date_clipped", "tags", "type"],
        "requiredTags": ["web-clip", "headless-harness"],
        "contentSignals": ["Test Article Title", "This is the first paragraph"],
        "customAssertions": {
          "extractedSuccess": true,
          "minMarkdownLength": 50
        }
      }
    },
    {
      "id": "seedfinder-strain-profile",
      "name": "SeedFinder strain profile integrity",
      "required": true,
      "entryPoint": "url",
      "executor": {
        "testFile": "tests/e2e/headless-clip-harness.test.ts",
        "testCase": "scenario #2: SeedFinder integrity assertions"
      },
      "fixture": {
        "path": "tests/templates/fixtures/seedfinder-strain.html",
        "simulatedUrl": "https://en.seedfinder.eu/strain-info/Blue_Dream/",
        "pageType": "article"
      },
      "expectations": {
        "frontmatterKeys": ["source", "title", "date_clipped", "tags", "type"],
        "requiredTags": ["web-clip", "headless-harness"],
        "contentSignals": ["## Strain Profile", "Blueberry x Haze", "17-24%"],
        "customAssertions": {
          "templateUsed": "SeedFinder",
          "seedFinderProfile": {
            "lineage": "Blueberry x Haze",
            "potency": { "thc": { "minPercent": 17, "maxPercent": 24 } }
          }
        }
      }
    },
    {
      "id": "cli-save-contract",
      "name": "CLI save contract validation",
      "required": true,
      "entryPoint": "cli-save",
      "executor": {
        "testFile": "tests/e2e/headless-clip-harness.test.ts",
        "testCase": "scenario #3: CLI save contract assertions"
      },
      "fixture": {
        "path": "tests/extractors/fixtures/article.html",
        "simulatedUrl": "https://example.com/article",
        "pageType": "web"
      },
      "expectations": {
        "frontmatterKeys": ["source", "title", "date_clipped", "tags", "type"],
        "customAssertions": {
          "saveViaCliInvoked": true,
          "expectedCommand": "obsidian-cli-mock",
          "expectedArgs": ["create", "--content", "--vault", "--overwrite"]
        }
      }
    }
  ]
}
```

### Deterministic Ordering and Tie-Break Rules

The matrix runner MUST produce deterministic output across multiple runs with the same manifest.

#### Scenario Ordering

1. **Primary sort key**: `required` (required scenarios run first, `true` before `false`)
2. **Secondary sort key**: `id` (alphabetical, case-sensitive)

This ensures required scenarios are always validated first, and scenario order is stable across runs.

#### Assertion Ordering

Within a scenario, assertion diagnostics MUST be ordered:

1. `frontmatterKeys` (alphabetical)
2. `requiredTags` (alphabetical)
3. `contentSignals` (order as specified in manifest)
4. `contentSignalsExcluded` (order as specified in manifest)
5. `customAssertions` (key-sorted alphabetical)

#### Failure Sorting

When multiple failures occur, they MUST be reported in this order:

1. **Required scenario missing** (highest priority)
2. **Schema validation failures** (malformed manifest, missing required fields)
3. **Frontmatter key failures** (missing keys in output)
4. **Content assertion failures** (missing signals in markdown)
5. **Custom assertion failures** (scenario-specific checks)
6. **Optional scenario failures** (lowest priority)

### Machine-Readable Failure Codes

The matrix runner MUST emit machine-readable failure codes for autonomous consumption. All codes are prefixed with `MATRIX_`.

#### Status Codes

| Code | Severity | Description |
|------|----------|-------------|
| `OK` | success | All scenarios passed |
| `ERROR` | error | Internal error during execution |
| `FAIL` | failure | One or more scenarios failed validation |

#### Error Codes

| Code | Category | Description |
|------|----------|-------------|
| `MATRIX_MANIFEST_PARSE_ERROR` | Schema | Failed to parse manifest JSON |
| `MATRIX_MANIFEST_SCHEMA_INVALID` | Schema | Manifest does not conform to schema |
| `MATRIX_REQUIRED_SCENARIO_MISSING` | Coverage | Required scenario ID not found in manifest |
| `MATRIX_SCENARIO_EXECUTION_ERROR` | Runtime | Unhandled error during scenario execution |

#### Failure Codes

| Code | Category | Description |
|------|----------|-------------|
| `MATRIX_FRONTMATTER_KEY_MISSING` | Frontmatter | Required frontmatter key not found in output |
| `MATRIX_TAG_MISSING` | Frontmatter | Required tag not found in output tags array |
| `MATRIX_CONTENT_SIGNAL_MISSING` | Content | Expected content signal not found in markdown body |
| `MATRIX_CONTENT_SIGNAL_FOUND` | Content | Excluded content signal found in markdown body |
| `MATRIX_CUSTOM_ASSERTION_FAILED` | Custom | Scenario-specific custom assertion failed |
| `MATRIX_EXTRACTION_ERROR` | Extraction | Content extraction returned error |
| `MATRIX_SAVE_ERROR` | Save | CLI save operation failed |

### Output Format

#### JSON Format

The `test:e2e:matrix` command with `--format json` MUST produce this envelope:

```typescript
interface MatrixResult {
  /** Overall status */
  status: "OK" | "ERROR" | "FAIL";

  /** Manifest path used for this run */
  manifestPath: string;

  /** Timestamp of run (ISO 8601) */
  timestamp: string;

  /** Total scenarios evaluated */
  total: number;

  /** Number of scenarios passed */
  passed: number;

  /** Number of scenarios failed */
  failed: number;

  /** Required scenarios that were missing from manifest */
  missingRequired: string[];

  /** Detailed results per scenario */
  scenarios: ScenarioResult[];

  /** Errors that prevented execution (non-empty on ERROR status) */
  errors: MatrixError[];
}

interface ScenarioResult {
  /** Scenario ID */
  id: string;

  /** Whether scenario passed all assertions */
  passed: boolean;

  /** Whether scenario is required for gate pass */
  required: boolean;

  /** Execution duration in milliseconds */
  durationMs: number;

  /** Assertion failures (empty if passed) */
  failures: AssertionFailure[];
}

interface AssertionFailure {
  /** Machine-readable failure code */
  code: string;

  /** Human-readable description */
  message: string;

  /** Assertion context (key, tag, signal, etc.) */
  context?: Record<string, unknown>;

  /** Expected value (if applicable) */
  expected?: unknown;

  /** Actual value (if applicable) */
  actual?: unknown;
}

interface MatrixError {
  /** Machine-readable error code */
  code: string;

  /** Human-readable message */
  message: string;

  /** Additional context (file path, line number, etc.) */
  context?: Record<string, unknown>;
}
```

#### Human-Readable Format

The `test:e2e:matrix` command with `--format human` (default) produces a compact summary:

```
Headless Scenario Matrix
─────────────────────────
Manifest: tests/e2e/fixtures/clip-scenario-manifest.json
Status: FAIL
Time: 1.234s

Summary: 2/3 passed (1 failed, 0 missing required)

✅ generic-web-clip (required) - 45ms
✅ seedfinder-strain-profile (required) - 62ms
❌ cli-save-contract (required) - 78ms
   MATRIX_FRONTMATTER_KEY_MISSING: Required key 'date_clipped' not found
   Expected: ['source', 'title', 'date_clipped', 'tags', 'type']
   Actual: ['source', 'title', 'tags', 'type']

Failed assertions: 1
Errors: 0
```

### Usage

#### Run matrix with default manifest

```bash
bun run test:e2e:matrix
```

#### Run with explicit manifest path

```bash
bun run test:e2e:matrix -- --manifest tests/e2e/fixtures/clip-scenario-manifest.json
```

#### Get JSON output for CI/automation

```bash
bun run test:e2e:matrix -- --manifest tests/e2e/fixtures/clip-scenario-manifest.json --format json
```

#### Run specific scenario only

```bash
bun run test:e2e:matrix -- --manifest tests/e2e/fixtures/clip-scenario-manifest.json --scenario generic-web-clip
```

### Integration with Quality Gates

The scenario matrix composes with the existing `test:quality:headless` workflow:

1. Run scenario matrix first: `bun run test:e2e:matrix`
2. If matrix passes, run full headless quality suite: `bun run test:quality:headless`

The matrix provides a fast, deterministic coverage gate before running the full quality suite.

### Change Control

Modifications to this contract MUST follow these rules:

1. **Required scenario IDs**: May NOT be removed or renamed without implementation plan update
2. **Manifest schema version**: MUST be incremented when schema changes are introduced
3. **Failure codes**: New codes MAY be added, existing codes MUST NOT change meaning
4. **Deterministic ordering rules**: MUST NOT change without manifest version increment
5. **Backward compatibility**: Matrix runners MUST support at least one previous manifest version

### References

- Implementation plan: `IMPLEMENTATION_PLAN.md` (TASKPAD Intake Slice: Deterministic headless scenario-matrix gate)
- Test harness: `tests/e2e/headless-clip-harness.test.ts`
- Sandbox utilities: `tests/e2e/support/test-vault-sandbox.ts`
- Quality spec: `docs/quality/headless-harness-spec.md`

---

## Quality Assurance

The `docs/quality/` directory contains quality gate specifications, smoke validation reports, and implementation integrity evidence.

- `headless-harness-spec.md` - Specification for deterministic headless regression harness
- `headless-harness-report.md` - Harness execution reports and coverage evidence
- `taskpad-auto-ideation.md` - TASKPAD auto-ideation quality contract and validation
- `taskpad-queue-health.md` - TASKPAD queue health check specification
- `implementation-plan-integrity.md` - Implementation plan integrity checks

---

## Distribution Artifacts

The `docs/distribution/` directory contains release and pilot evidence, including batch summaries, response logs, and quality validation reports.

### Pilot Artifacts (first-pilot-2026-02)

- `pilot-run-sheet.md` - Send tracking and outreach state
- `pilot-response-log.md` - Response tracking with decision states
- `pilot-event-log.md` - Append-only event ledger for audit trail
- `pilot-batch-summary.md` - Batch performance summary
- `pilot-outreach-message.md` - Outreach message templates
- `pilot-consistency-qa.md` - Artifact consistency validation

### Quality Validation Artifacts

- `pilot-latency-contract.md` - Response latency analysis contract
- `pilot-latency-smoke-validation.md` - Latency tool execution evidence
- `pilot-price-signal-smoke-validation.md` - Price signal analyzer validation
- `pilot-sample-gap-planner-smoke-validation.md` - Sample gap planner validation
- `pilot-ingest-replies-smoke-validation.md` - Reply ingestion validation
- `pilot-response-proof-smoke-validation.md` - Response proof validation
- `pilot-rebuild-smoke-validation.md` - Rebuild gate validation
- `seedfinder-demo-clip.md` - SeedFinder clipping demonstration

---

## TASKPAD Queue Reconcile Contract

### Overview

The post-seed queue reconcile is a deterministic validation and auto-heal step that runs after `taskpad:plan-seed` or `taskpad:intake:autoplan` to ensure the target TASKPAD file conforms to canonical queue section structure and ordering.

This reconcile step addresses a critical drift class: queue contracts can appear green in validation tools while the actual target TASKPAD file used by intake misses canonical section headings or has incorrect ordering, causing degradation in planning selection, queue promotion, and human auditability.

### Canonical Queue Section Order

A canonical TASKPAD file MUST contain these queue sections in this exact order (as H2 headings):

| Order | Section Heading | Required | Description |
|-------|----------------|-----------|-------------|
| 1 | `## Work Queue` | ✅ Yes | Pending work items that have been promoted from backlogs but not yet started |
| 2 | `## Execution Queue` | ✅ Yes | Active work items currently being executed (may mirror Work Queue selections) |
| 3 | `## Autonomous Kickoff Queue` | ✅ Yes | Autonomous/automated tasks ready to trigger without manual intervention |
| 4 | `## Self-Improvement Backlog` | ✅ Yes | Candidate items for future intake slices (source for plan-seed) |

#### Section Ordering Rules

1. **Primary ordering**: Sections MUST appear in the exact order listed above.
2. **Missing sections**: Any missing canonical section is a reconcile failure requiring auto-heal.
3. **Out-of-order sections**: Any canonical section appearing in wrong position is a reconcile failure requiring reordering.
4. **Extra sections**: Non-canonical H2 headings are allowed but ignored by reconcile.
5. **Empty sections**: A section with no content after its heading is valid (no heal required).
6. **Duplicate headings**: Multiple occurrences of the same canonical heading is a reconcile failure.

#### Section Boundary Rules

- **Heading match**: Exact case-sensitive match after `trim()` (e.g., `"## Execution Queue"`).
- **Section start**: Line immediately after the matched H2 heading.
- **Section end**: Next H2 heading (`## ...`) or end-of-file.
- **Leading/trailing whitespace**: Whitespace-only lines within section boundaries are allowed.

### Healing Rules

The reconcile helper MUST auto-heal detected drift with deterministic behavior and no data loss.

#### Auto-Heal: Missing Canonical Sections

When a canonical section is missing:
1. Determine correct insertion position based on canonical order.
2. Insert heading at that position with one blank line before and after.
3. Insert section with no content (empty section).
4. Report `healedSections` including the missing heading name.

**Insertion anchor strategy**:
- If all higher-order canonical sections exist, insert after the last one.
- If no canonical sections exist, insert at document start (after any frontmatter).
- If lower-order canonical sections exist, insert before the first one.

**Example**: TASKPAD with only `## Self-Improvement Backlog` and `## Autonomous Kickoff Queue`:
- Detect missing `## Work Queue` (order 1) and `## Execution Queue` (order 2).
- Insert `## Work Queue` at document start (or after frontmatter).
- Insert `## Execution Queue` after `## Work Queue`.
- Resulting order: Work Queue → Execution Queue → Autonomous Kickoff Queue → Self-Improvement Backlog.

#### Auto-Heal: Out-of-Order Canonical Sections

When canonical sections exist but are in wrong order:
1. Collect all canonical sections with their current positions.
2. Compute canonical order mapping.
3. Reorder sections by moving section blocks to correct positions.
4. Preserve all non-canonical content between sections (move with adjacent canonical section or stay in place).

**Preservation guarantees**:
- Section content (task bullets, prose, metadata) is preserved byte-for-byte.
- Non-canonical H2 headings and their content remain in original relative positions.
- Blank lines between sections are preserved where possible.

#### Auto-Heal: Duplicate Canonical Headings

When the same canonical heading appears multiple times:
1. Treat first occurrence as canonical.
2. Mark subsequent occurrences as non-canonical (ignore in reconcile).
3. Emit reason code `RECONCILE_DUPLICATE_HEADING` with line numbers.
4. Do NOT auto-remove duplicates (preserve user content).

**Example**: TASKPAD with `## Execution Queue` at lines 10 and 30:
- Use line 10 as the canonical `## Execution Queue` section.
- Line 30 is treated as a non-canonical H2 heading.
- Reason code emitted, no deletion performed.

#### No-Heal Scenarios

The reconcile MUST NOT modify the TASKPAD in these cases:
- All canonical sections present and in correct order (status `canonical`).
- Extra non-canonical H2 headings present (ignored, not an error).
- Empty canonical sections with no task bullets (valid state).
- TASKPAD file does not exist (emit `RECONCILE_TASKPAD_NOT_FOUND`, no heal).

### Idempotency Guarantees

Repeated reconcile runs on the same TASKPAD file MUST be idempotent:

| Condition | First Run | Second Run | Behavior |
|-----------|------------|-------------|----------|
| Missing sections | Heals (adds headings) | No-op (already present) | No heading churn |
| Out-of-order sections | Reorders | No-op (already correct) | Stable output |
| Canonical file | No-op | No-op | No mutations |
| Duplicate headings | Emits code, no delete | Emits code, no delete | Stable diagnostics |
| Extra non-canonical | Ignored | Ignored | No mutations |

#### Deterministic Output Semantics

- **Healed sections list**: Alphabetically sorted, deduplicated.
- **Reason codes**: Stable order, deduplicated.
- **Section positions**: 1-indexed line numbers consistent across runs.
- **Whitespace handling**: Normalized line endings (`\n`) but original indentation preserved.

#### Byte-Stable No-Op

When `status=canonical`, reconcile MUST return:
- `healedSections: []` (empty array)
- `reasonCodes: []` (empty array)
- `sectionsPresent` matching canonical order exactly
- Zero mutations to TASKPAD file bytes

### Machine-Readable Reason-Code Taxonomy

The reconcile output MUST include deterministic machine-readable reason codes. All codes are prefixed with `RECONCILE_`.

#### Success Status Codes

| Code | Severity | Description |
|------|----------|-------------|
| `RECONCILE_CANONICAL` | success | All canonical sections present and in correct order |
| `RECONCILE_HEALED` | success | Drift detected and healed (idempotent on next run) |

#### Error Codes

| Code | Category | Description |
|------|----------|-------------|
| `RECONCILE_TASKPAD_NOT_FOUND` | Input | TASKPAD file does not exist at provided path |
| `RECONCILE_TASKPAD_READ_FAILED` | Input | Failed to read TASKPAD file (IO error, permission denied) |
| `RECONCILE_TASKPAD_PARSE_FAILED` | Parsing | Failed to parse TASKPAD markdown (invalid encoding, corruption) |
| `RECONCILE_SECTION_ORDER_INVALID` | Structural | Cannot determine canonical order (internal invariant violation) |

#### Warning Codes (Non-Blocking)

| Code | Category | Description |
|------|----------|-------------|
| `RECONCILE_MISSING_SECTION` | Missing | One or more canonical sections are missing |
| `RECONCILE_OUT_OF_ORDER` | Ordering | One or more canonical sections appear in wrong position |
| `RECONCILE_DUPLICATE_HEADING` | Duplication | Same canonical heading appears multiple times (no auto-delete) |
| `RECONCILE_EMPTY_SECTION` | Empty | Canonical section exists but has no content (informational only) |

#### Deterministic Code Ordering

When multiple reason codes apply, they MUST be emitted in this order:

1. Error codes (highest priority): `RECONCILE_TASKPAD_NOT_FOUND`, `RECONCILE_TASKPAD_READ_FAILED`, `RECONCILE_TASKPAD_PARSE_FAILED`
2. Missing sections: `RECONCILE_MISSING_SECTION`
3. Out-of-order sections: `RECONCILE_OUT_OF_ORDER`
4. Duplicate headings: `RECONCILE_DUPLICATE_HEADING`
5. Empty sections: `RECONCILE_EMPTY_SECTION` (lowest priority)

Within each category, codes are emitted in deterministic order based on section index or line number.

### Reconcile Output Schema

The reconcile step MUST emit a machine-readable JSON envelope with this structure:

```typescript
interface QueueReconcileResult {
  /** Overall reconcile status */
  status: "canonical" | "healed" | "error";

  /** Canonical section presence flags */
  sectionsPresent: {
    workQueue: boolean;
    executionQueue: boolean;
    autonomousKickoffQueue: boolean;
    selfImprovementBacklog: boolean;
  };

  /** Sections that were healed (empty when status=canonical) */
  healedSections: string[];

  /** Deterministic reason codes (see taxonomy above) */
  reasonCodes: string[];

  /** Section ordering details */
  ordering: {
    /** Current order of canonical section headings */
    currentOrder: string[];
    /** Expected canonical order */
    expectedOrder: string[];
    /** Whether order matches canonical */
    isCanonicalOrder: boolean;
  };

  /** TASKPAD file metadata */
  taskpad: {
    path: string;
    lineCount: number;
    sectionCount: number;
  };

  /** Error details (populated when status=error) */
  error?: {
    code: string;
    message: string;
    line?: number;
  };
}
```

### Integration with Intake Tools

The reconcile helper is invoked as a post-mutation step by:

1. **`taskpad:plan-seed`**: After successful backlog promotion and plan slice insertion.
2. **`taskpad:intake:autoplan`**: After successful `plan-seed` step, before final verdict.

#### Invocation Contract

- **Input**: TASKPAD file path (same as primary mutation target).
- **Output**: Reconcile result JSON embedded in tool output markers.
- **Failure semantics**: Reconcile failures block intake verdict (`verdict=blocked|hold`).
- **Idempotency**: Repeated calls on already-canonical files return no-op deterministically.

#### Output Marker Format

Reconcile results MUST be emitted between stable markers:

```
QUEUE_RECONCILE_JSON_START
{...QueueReconcileResult...}
QUEUE_RECONCILE_JSON_END
```

### Change Control

Modifications to this contract MUST follow these rules:

1. **Canonical section set**: May extend with new required sections via implementation plan update.
2. **Section order**: May renumber but MUST preserve relative order of existing sections unless breaking change.
3. **Reason codes**: New codes MAY be added, existing codes MUST NOT change meaning.
4. **Healing rules**: May extend healing behavior but MUST NOT remove idempotency guarantees.
5. **Versioning**: Contract version MUST be incremented when schema changes are introduced.

### References

- Implementation plan: `IMPLEMENTATION_PLAN.md` (TASKPAD Intake Slice: Post-seed queue reconcile)
- Queue health check: `tools/taskpad-queue-health.ts`
- Auto-ideation contract: `docs/quality/taskpad-auto-ideation.md`
- Plan-seed tool: `tools/taskpad-plan-seed.ts`
- Intake autoplan orchestrator: `tools/taskpad-intake-autoplan.ts`

---

## Documentation Standards

All documentation in this directory MUST follow these conventions:

1. **Markdown format** - Use GitHub Flavored Markdown with YAML frontmatter where applicable
2. **Versioned contracts** - Include version identifiers for evolving specifications
3. **Machine-readable examples** - Provide JSON schema examples for tool integration
4. **Cross-references** - Link related specifications and implementation artifacts
5. **Change logs** - Document contract changes with dates and rationale

For new documentation, use the templates and patterns established in existing files.
