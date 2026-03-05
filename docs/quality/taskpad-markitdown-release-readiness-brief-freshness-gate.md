# TASKPAD MarkItDown Release Readiness Brief Freshness Gate

## Purpose

Define a deterministic contract that validates the release-readiness brief is fresh versus its composite MarkItDown source artifacts, blocking stale aggregate context before release decisions are made.

## Problem Statement

The `markitdown-release-readiness-brief.md` aggregates go/no-go context from multiple MarkItDown artifacts, but there was no dedicated freshness gate proving the brief is current versus its composite sources. Existing freshness/parity checks cover component artifacts individually, yet a stale aggregate brief can still pass those checks and mislead release decisions.

We need a focused freshness gate that deterministically blocks stale release-readiness output by comparing fingerprints against required composite inputs and upstream surfaces.

## Brief Target

| Field | Value |
|-------|-------|
| Brief Name | `markitdown-release-readiness-brief` |
| Brief Filename | `markitdown-release-readiness-brief.md` |
| Brief Handler | `refreshMarkitdownReleaseReadinessBrief` |

## Source Artifact Mapping

### Required Composite Inputs (Precedence Order)

These artifacts are **required** for freshness validation. If any is stale, the gate **fails**.

| Precedence | Source Artifact | Fingerprint Field | Description |
|------------|-----------------|-------------------|-------------|
| 1 (highest) | `markitdown-conversion-priority-brief.md` | `priority_brief_fingerprint` | Priority-ranked conversion issues |
| 2 | `markitdown-conversion-regression-hotspots.md` | `regression_hotspots_fingerprint` | Recurring fidelity regression patterns |
| 3 | `markitdown-conversion-remediation-playbook.md` | `remediation_playbook_fingerprint` | Remediation action sequences |
| 4 | `markitdown-conversion-state-sync.md` | `state_sync_fingerprint` | Sync status overrides |

### Canonical Upstream Surfaces (Precedence Order)

These artifacts provide **supporting context**. Staleness here causes **warning** but not failure.

| Precedence | Source Artifact | Fingerprint Field | Description |
|------------|-----------------|-------------------|-------------|
| 5 | `markitdown-conversion-review-inbox.md` | `review_inbox_fingerprint` | Raw conversion review queue |
| 6 (lowest) | `markitdown-conversion-history.ndjson` | `history_fingerprint` | Historical conversion records |

## Staleness Detection

### Fingerprint Types

| Type | Format | Priority |
|------|--------|----------|
| Content Hash | `sha256:<hex>` | Preferred |
| Mtime | ISO 8601 timestamp | Fallback |

### Staleness Rules

A brief is **STALE** when ANY of these are true:

1. **Source is newer**: Required composite input has a newer fingerprint than recorded in brief
2. **Missing fingerprint**: Brief lacks fingerprint for an existing required source
3. **Parse error**: Brief frontmatter has malformed fingerprint data

A brief is **FRESH** when ALL of these are true:

1. Brief exists and has valid frontmatter
2. All required composite inputs have matching or older fingerprints
3. No fingerprint parse errors

### Mtime Tolerance

To avoid false positives from filesystem timestamp jitter:

```typescript
const MTIME_TOLERANCE_MS = 1000;  // 1 second tolerance
```

## Deterministic Rule ID Taxonomy

All rule IDs follow the pattern `RRFG###_<DESCRIPTION>` (Release Readiness Freshness Gate) for stable machine-readable diagnostics.

| Rule ID | Severity | Description |
|---------|----------|-------------|
| `RRFG001_BRIEF_NOT_FOUND` | warning | Release-readiness brief does not exist |
| `RRFG002_PRIORITY_BRIEF_STALE` | error | Priority-brief source is newer than release-readiness brief |
| `RRFG003_REGRESSION_HOTSPOTS_STALE` | error | Regression-hotspots source is newer |
| `RRFG004_REMEDIATION_PLAYBOOK_STALE` | error | Remediation-playbook source is newer |
| `RRFG005_STATE_SYNC_STALE` | error | State-sync source is newer |
| `RRFG006_REVIEW_INBOX_STALE` | warning | Review-inbox upstream surface is newer |
| `RRFG007_HISTORY_STALE` | warning | History upstream surface is newer |
| `RRFG008_MISSING_FINGERPRINT` | error | Brief lacks fingerprint for existing source |
| `RRFG009_SOURCE_MISSING` | warning | Source artifact does not exist |
| `RRFG010_NO_SOURCES_FOUND` | warning | No source artifacts found |
| `RRFG011_FINGERPRINT_PARSE_ERROR` | error | Brief frontmatter has malformed fingerprint data |
| `RRFG012_AGGREGATE_STALE` | error | Release-readiness brief has stale composite inputs (aggregated) |

### Canonical Rule ID Ordering

Violations are reported in this deterministic order:

```
RRFG001_BRIEF_NOT_FOUND
RRFG002_PRIORITY_BRIEF_STALE
RRFG003_REGRESSION_HOTSPOTS_STALE
RRFG004_REMEDIATION_PLAYBOOK_STALE
RRFG005_STATE_SYNC_STALE
RRFG006_REVIEW_INBOX_STALE
RRFG007_HISTORY_STALE
RRFG008_MISSING_FINGERPRINT
RRFG009_SOURCE_MISSING
RRFG010_NO_SOURCES_FOUND
RRFG011_FINGERPRINT_PARSE_ERROR
RRFG012_AGGREGATE_STALE
```

## CLI Contract

### Command Inputs

| Argument | Required | Description |
|----------|----------|-------------|
| `--taskpad <path>` | ✅ | Path to TASKPAD markdown file |
| `--plan <path>` | ✅ | Path to IMPLEMENTATION_PLAN markdown file |
| `--project-root <path>` | ✅ | Project root directory (for resolving paths) |
| `--vault-path <path>` | ❌ | Vault path for brief/source resolution |
| `--format <format>` | ❌ | Output format: `json` or `human` (default: `json`) |
| `--help, -h` | ❌ | Show help message and exit |

### Exit Codes

| Exit Code | Condition |
|-----------|-----------|
| `0` | Brief is fresh (all required composite inputs fresh) |
| `1` | Brief is stale (one or more required composite inputs stale) |
| `2` | Input validation failure |

## Deterministic Output Schema

### JSON Format

```json
{
  "status": "pass|fail",
  "inputs": {
    "taskpadPath": "string",
    "planPath": "string",
    "projectRoot": "string",
    "vaultPath": "string"
  },
  "brief": {
    "briefName": "markitdown-release-readiness-brief",
    "briefPath": "string",
    "exists": true,
    "isStale": false,
    "generatedAt": "2026-03-05T00:30:00.000Z"
  },
  "sources": {
    "requiredCompositeInputs": [
      {
        "sourceName": "markitdown-conversion-priority-brief",
        "sourcePath": "string",
        "precedenceLevel": 1,
        "isRequired": true,
        "exists": true,
        "isStale": false,
        "briefFingerprint": "sha256:abc123...",
        "currentFingerprint": "sha256:abc123..."
      }
    ],
    "upstreamSurfaces": [
      {
        "sourceName": "markitdown-conversion-review-inbox",
        "sourcePath": "string",
        "precedenceLevel": 5,
        "isRequired": false,
        "exists": true,
        "isStale": false
      }
    ]
  },
  "summary": {
    "totalSources": 6,
    "freshSources": 6,
    "staleSources": 0,
    "missingSources": 0,
    "requiredStale": 0,
    "upstreamStale": 0
  },
  "violations": [],
  "timestamp": "2026-03-05T00:30:00.000Z"
}
```

### Human Format

```
TASKPAD MarkItDown Release Readiness Brief Freshness Gate: PASS
────────────────────────────────────────────────────────────────────

Inputs:
  - taskpad: TASKPAD.md
  - plan: IMPLEMENTATION_PLAN.md
  - project-root: .
  - vault-path: /path/to/vault

Brief: markitdown-release-readiness-brief
  - Exists: yes
  - Fresh: yes
  - Generated: 2026-03-05T00:30:00.000Z

Required Composite Inputs:
  1. markitdown-conversion-priority-brief
     - Precedence: 1
     - Exists: yes
     - Fresh: ✓

  2. markitdown-conversion-regression-hotspots
     - Precedence: 2
     - Exists: yes
     - Fresh: ✓

  3. markitdown-conversion-remediation-playbook
     - Precedence: 3
     - Exists: yes
     - Fresh: ✓

  4. markitdown-conversion-state-sync
     - Precedence: 4
     - Exists: yes
     - Fresh: ✓

Upstream Surfaces:
  5. markitdown-conversion-review-inbox
     - Precedence: 5
     - Exists: yes
     - Fresh: ✓

  6. markitdown-conversion-history.ndjson
     - Precedence: 6
     - Exists: yes
     - Fresh: ✓

Summary:
  - Total sources: 6
  - Fresh: 6
  - Stale: 0
  - Missing: 0
  - Required stale: 0
  - Upstream stale: 0

Violations: 0

Release-readiness brief is fresh.
```

## Remediation Payload Schema

### Scaffold Commands

Each violation includes a scaffold command for regeneration:

**Release Readiness Brief Refresh:**
```bash
bun run refresh:refreshMarkitdownReleaseReadinessBrief -- \
  --vault-path "/path/to/vault"
```

### Remediation Templates

| Rule ID | Description Template |
|---------|---------------------|
| `RRFG001` | "Release-readiness brief does not exist. Run `{scaffoldCommand}` to generate it." |
| `RRFG002-005` | "Source `{sourceName}` is newer than release-readiness brief. Brief: `{briefGeneratedAt}`, Source: `{sourceModifiedAt}`. Run `{scaffoldCommand}` to refresh." |
| `RRFG006-007` | "Upstream surface `{sourceName}` is newer. Consider refreshing for latest context. Run `{scaffoldCommand}`." |
| `RRFG008` | "Brief lacks fingerprint for source `{sourceName}`. Run `{scaffoldCommand}` to regenerate with proper fingerprints." |
| `RRFG009` | "Source `{sourceName}` does not exist. Brief may be orphaned. Consider generating source first." |
| `RRFG010` | "No source artifacts found. Brief may be orphaned or sources need to be generated first." |
| `RRFG011` | "Brief frontmatter has malformed fingerprint data. Run `{scaffoldCommand}` to regenerate with valid fingerprints." |
| `RRFG012` | "Release-readiness brief has stale composite inputs. Run `{scaffoldCommand}` to refresh with latest source data." |

## Pass/Fail Conditions

### PASS Conditions

The gate returns `status="pass"` (exit `0`) when:

- Brief exists and has valid frontmatter
- All required composite inputs have matching or older fingerprints
- No error-level violations (warnings for upstream staleness allowed)

### FAIL Conditions

The gate returns `status="fail"` (exit `1`) when ANY of these are true:

- At least one required composite input is stale
- Brief lacks fingerprint for existing required source
- Brief has fingerprint parse error
- At least one error-level violation exists

## Integration with verify:taskpad:intake:auto

The `verify:taskpad:intake:auto` command MUST compose `taskpad:markitdown-release-readiness-brief-freshness-gate` with other intake gates.

**Expected order (after TP005 integration):**
1. `taskpad:queue-health` (validate queues)
2. `taskpad:execution-queue-prune` / `taskpad:work-queue-prune` (prune completed items)
3. `taskpad:priority-brief-freshness-gate` (validate priority brief freshness)
4. `taskpad:markitdown-release-readiness-brief-freshness-gate` (validate release-readiness freshness) ← **THIS GATE**
5. `taskpad:evidence-gap-refresh-contract-parity` (validate evidence-gap wiring)
6. `taskpad:knowledge-revalidation-refresh-contract-parity` (validate revalidation wiring)
7. `taskpad:markitdown-priority-brief-refresh-contract-parity` (validate MarkItDown wiring)
8. `verify:taskpad:intake:full` (full verification suite)

**Integration behavior:**
- Freshness gate runs after queue pruning and priority-brief freshness
- Stale release-readiness briefs fail fast before release decisions
- Staleness violations surface as actionable blockers with scaffold commands

## Non-Goals

- **Implementing brief content generation** - This gate validates freshness; content generation is out of scope
- **Validating brief wiring** - Use `taskpad:*-refresh-contract-parity` gates for wiring validation
- **Auto-refreshing stale briefs** - This gate detects staleness; auto-refresh is out of scope
- **Validating non-release-readiness briefs** - Only `markitdown-release-readiness-brief.md` is in scope

## Verification Commands

```bash
# Run release-readiness brief freshness gate on live project
bun run taskpad:markitdown-release-readiness-brief-freshness-gate -- \
  --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --project-root . \
  --format json

# Run as part of full intake verification (will include this gate after TP005)
bun run verify:taskpad:intake:auto -- \
  --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --format json
```

## References

- [`docs/contracts/markitdown-release-readiness-brief-freshness-gate.md`](../contracts/markitdown-release-readiness-brief-freshness-gate.md) - Full contract specification
- [`taskpad-priority-brief-freshness-gate.md`](./taskpad-priority-brief-freshness-gate.md) - Priority-brief freshness gate
- [`taskpad-markitdown-priority-brief-refresh-contract-parity.md`](./taskpad-markitdown-priority-brief-refresh-contract-parity.md) - MarkItDown wiring parity gate
- [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) - Active slice containing freshness gate planning
