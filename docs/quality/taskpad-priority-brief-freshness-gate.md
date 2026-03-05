# TASKPAD Priority Brief Freshness Gate

## Purpose

Define a deterministic contract that validates kickoff/priority briefs are fresh versus their source artifacts, blocking stale briefing context before AI coding/writing sessions start.

## Problem Statement

Kickoff briefs (`knowledge-trust-kickoff-brief.md`, `markitdown-conversion-priority-brief.md`) drive session-start prioritization, but current parity gates only validate wiring presence—not freshness versus upstream source artifacts. A stale brief can pass wiring checks while silently lagging behind `knowledge-trust-dashboard*.md` or MarkItDown review/state-sync updates, causing sessions to start from outdated risk priorities.

We need a focused freshness gate that deterministically blocks stale briefing artifacts before release by comparing fingerprints against source artifacts.

## Brief Family Targets

The gate MUST validate freshness for these brief families:

| Brief Family | Brief Artifact | Description |
|--------------|----------------|-------------|
| **Trust** | `knowledge-trust-kickoff-brief.md` | High-risk trust items for session kickoff |
| **MarkItDown** | `markitdown-conversion-priority-brief.md` | Conversion priority items for session kickoff |

## Source Artifact Mapping

### Trust Brief Sources (Precedence Order)

| Precedence | Source Artifact | Fingerprint Field | Description |
|------------|-----------------|-------------------|-------------|
| 1 (highest) | `knowledge-trust-dashboard.md` | `dashboard_fingerprint` | Primary trust state |
| 2 | `knowledge-trust-dashboard-state-sync.md` | `state_sync_fingerprint` | Sync status overrides |
| 3 (lowest) | `knowledge-trust-dashboard-history.ndjson` | `history_fingerprint` | Historical context |

### MarkItDown Brief Sources (Precedence Order)

| Precedence | Source Artifact | Fingerprint Field | Description |
|------------|-----------------|-------------------|-------------|
| 1 (highest) | `markitdown-conversion-review-inbox.md` | `review_inbox_fingerprint` | Primary conversion review state |
| 2 | `markitdown-conversion-state-sync.md` | `state_sync_fingerprint` | Sync status overrides |
| 3 (lowest) | `markitdown-conversion-history.ndjson` | `history_fingerprint` | Historical context |

## Staleness Detection

### Fingerprint Types

| Type | Format | Priority |
|------|--------|----------|
| Content Hash | `sha256:<hex>` | Preferred |
| Mtime | ISO 8601 timestamp | Fallback |

### Staleness Rules

A brief is **STALE** when ANY of these are true:

1. **Source is newer**: Source artifact has a newer fingerprint than recorded in brief
2. **Missing fingerprint**: Brief lacks fingerprint for an existing source artifact
3. **Parse error**: Brief frontmatter has malformed fingerprint data

A brief is **FRESH** when ALL of these are true:

1. Brief exists and has valid frontmatter
2. All source artifacts have matching or older fingerprints
3. No fingerprint parse errors

### Mtime Tolerance

To avoid false positives from filesystem timestamp jitter:

```typescript
const MTIME_TOLERANCE_MS = 1000;  // 1 second tolerance
```

## Deterministic Rule ID Taxonomy

All rule IDs follow the pattern `PBFG###_<DESCRIPTION>` for stable machine-readable diagnostics.

| Rule ID | Severity | Description |
|---------|----------|-------------|
| `PBFG001_BRIEF_NOT_FOUND` | warning | Brief artifact does not exist |
| `PBFG002_SOURCE_STALE_DASHBOARD` | error | Dashboard source is newer than brief |
| `PBFG003_SOURCE_STALE_STATE_SYNC` | error | State-sync source is newer than brief |
| `PBFG004_SOURCE_STALE_HISTORY` | error | History source is newer than brief |
| `PBFG005_MISSING_FINGERPRINT` | error | Brief lacks fingerprint for existing source |
| `PBFG006_SOURCE_MISSING` | warning | Source artifact does not exist |
| `PBFG007_NO_SOURCES_FOUND` | warning | No source artifacts found for brief family |
| `PBFG008_FINGERPRINT_PARSE_ERROR` | error | Brief frontmatter has malformed fingerprint data |
| `PBFG009_TRUST_FAMILY_STALE` | error | Trust brief family has stale sources (aggregated) |
| `PBFG010_MARKITDOWN_FAMILY_STALE` | error | MarkItDown brief family has stale sources (aggregated) |

### Canonical Rule ID Ordering

Violations are reported in this deterministic order:

```
PBFG001_BRIEF_NOT_FOUND
PBFG002_SOURCE_STALE_DASHBOARD
PBFG003_SOURCE_STALE_STATE_SYNC
PBFG004_SOURCE_STALE_HISTORY
PBFG005_MISSING_FINGERPRINT
PBFG006_SOURCE_MISSING
PBFG007_NO_SOURCES_FOUND
PBFG008_FINGERPRINT_PARSE_ERROR
PBFG009_TRUST_FAMILY_STALE
PBFG010_MARKITDOWN_FAMILY_STALE
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
| `0` | All briefs are fresh (pass) |
| `1` | One or more briefs are stale (fail) |
| `2` | Input validation failure |

## Deterministic Output Schema

### JSON Format

```json
{
  "status": "pass|fail",
  "inputs": {
    "taskpadPath": "string",
    "planPath": "string",
    "projectRoot": "string"
  },
  "briefs": [
    {
      "briefName": "knowledge-trust-kickoff-brief",
      "briefPath": "string",
      "exists": true,
      "isStale": false,
      "hasFingerprints": true,
      "generatedAt": "2026-03-04T22:30:00.000Z",
      "sourceChecks": [
        {
          "sourceName": "knowledge-trust-dashboard",
          "sourcePath": "string",
          "exists": true,
          "isStale": false,
          "briefFingerprint": "sha256:abc123...",
          "currentFingerprint": "sha256:abc123...",
          "stalenessReason": null
        }
      ]
    }
  ],
  "summary": {
    "totalBriefs": 2,
    "freshBriefs": 2,
    "staleBriefs": 0,
    "missingBriefs": 0
  },
  "violations": [
    {
      "ruleId": "PBFG002_SOURCE_STALE_DASHBOARD",
      "severity": "error",
      "briefName": "knowledge-trust-kickoff-brief",
      "briefPath": "string",
      "sourceName": "knowledge-trust-dashboard",
      "sourcePath": "string",
      "details": {
        "briefFingerprint": "sha256:old...",
        "currentFingerprint": "sha256:new...",
        "briefGeneratedAt": "2026-03-04T20:00:00.000Z",
        "sourceModifiedAt": "2026-03-04T22:00:00.000Z"
      },
      "remediation": {
        "description": "Dashboard source is newer than brief. Run scaffold command to refresh.",
        "scaffoldCommand": "bun run verify:taskpad:intake:auto -- --taskpad \"TASKPAD.md\" --plan IMPLEMENTATION_PLAN.md"
      }
    }
  ],
  "timestamp": "2026-03-04T22:30:00.000Z"
}
```

### Human Format

```
TASKPAD Priority Brief Freshness Gate: PASS
──────────────────────────────────────────────────

Inputs:
  - taskpad: TASKPAD.md
  - plan: IMPLEMENTATION_PLAN.md
  - project-root: .

Briefs: 2
  1. knowledge-trust-kickoff-brief
     - Exists: yes
     - Fresh: yes
     - Generated: 2026-03-04T22:30:00.000Z
     - Sources:
       - knowledge-trust-dashboard: ✓ fresh
       - knowledge-trust-dashboard-state-sync: ✓ fresh
       - knowledge-trust-dashboard-history: ✓ fresh

  2. markitdown-conversion-priority-brief
     - Exists: yes
     - Fresh: yes
     - Generated: 2026-03-04T22:30:00.000Z
     - Sources:
       - markitdown-conversion-review-inbox: ✓ fresh
       - markitdown-conversion-state-sync: ✓ fresh
       - markitdown-conversion-history: ✓ fresh

Summary:
  - Total briefs: 2
  - Fresh: 2
  - Stale: 0
  - Missing: 0

All priority briefs are fresh.
```

## Remediation Payload Schema

### Scaffold Commands

Each violation includes a scaffold command for regeneration:

**Trust Brief Refresh:**
```bash
bun run verify:taskpad:intake:auto -- \
  --taskpad "TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --refresh-stale-briefs
```

### Remediation Templates

| Rule ID | Description Template |
|---------|---------------------|
| `PBFG001` | "Brief `{briefName}` does not exist. Generate it via the save flow or refresh command." |
| `PBFG002-004` | "Source `{sourceName}` is newer than brief. Brief: `{briefGeneratedAt}`, Source: `{sourceModifiedAt}`. Run `{scaffoldCommand}` to refresh." |
| `PBFG005` | "Brief lacks fingerprint for source `{sourceName}`. Regenerate to add fingerprints." |
| `PBFG006` | "Source `{sourceName}` does not exist. Brief may be orphaned." |
| `PBFG007` | "No source artifacts found for brief family. Sources need generation first." |
| `PBFG008` | "Brief frontmatter has malformed fingerprint data. Regenerate to fix." |
| `PBFG009-010` | "Brief family has stale sources. Run `{scaffoldCommand}` to refresh." |

## Pass/Fail Conditions

### PASS Conditions

The gate returns `status="pass"` (exit `0`) when:

- All briefs exist and have valid frontmatter
- All source artifacts have matching or older fingerprints than recorded
- No error-level violations (warnings allowed)

### FAIL Conditions

The gate returns `status="fail"` (exit `1`) when ANY of these are true:

- At least one brief is stale (source newer than recorded fingerprint)
- At least one brief has missing fingerprint for existing source
- At least one brief has fingerprint parse error
- At least one error-level violation exists

## Integration with verify:taskpad:intake:auto

The `verify:taskpad:intake:auto` command MUST compose `taskpad:priority-brief-freshness-gate` with other intake gates.

**Expected order:**
1. `taskpad:queue-health` (validate queues)
2. `taskpad:execution-queue-prune` / `taskpad:work-queue-prune` (prune completed items)
3. `taskpad:priority-brief-freshness-gate` (validate brief freshness) ← **THIS GATE**
4. `taskpad:evidence-gap-refresh-contract-parity` (validate evidence-gap wiring)
5. `taskpad:knowledge-revalidation-refresh-contract-parity` (validate revalidation wiring)
6. `taskpad:markitdown-priority-brief-refresh-contract-parity` (validate MarkItDown wiring)
7. `verify:taskpad:intake:full` (full verification suite)

**Integration behavior:**
- Freshness gate runs after queue pruning and before wiring parity gates
- Stale briefs fail fast before Builder dispatch
- Staleness violations surface as actionable blockers with scaffold commands

## Non-Goals

- **Implementing brief content generation** - This gate validates freshness; content generation is out of scope
- **Validating brief wiring** - Use `taskpad:*-refresh-contract-parity` gates for wiring validation
- **Auto-refreshing stale briefs** - This gate detects staleness; auto-refresh is out of scope
- **Validating non-priority briefs** - Only trust and MarkItDown kickoff briefs are in scope

## Verification Commands

```bash
# Run priority brief freshness gate on live project
bun run taskpad:priority-brief-freshness-gate -- \
  --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --project-root . \
  --format json

# Run as part of full intake verification (includes freshness gate)
bun run verify:taskpad:intake:auto -- \
  --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --format json
```

## References

- [`docs/contracts/priority-brief-freshness-gate.md`](../contracts/priority-brief-freshness-gate.md) - Full contract specification
- [`taskpad-markitdown-priority-brief-refresh-contract-parity.md`](./taskpad-markitdown-priority-brief-refresh-contract-parity.md) - MarkItDown wiring parity gate
- [`taskpad-evidence-gap-refresh-contract-parity.md`](./taskpad-evidence-gap-refresh-contract-parity.md) - Evidence-gap wiring parity gate
- [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) - Active slice containing freshness gate planning
