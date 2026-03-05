# Priority Brief Freshness Gate Contract

> Contract specification for `taskpad:priority-brief-freshness-gate` deterministic freshness validation.
> 
> **Version**: 1.0.0  
> **Artifact Targets**: `knowledge-trust-kickoff-brief.md`, `markitdown-conversion-priority-brief.md`  
> **TP Reference**: TP001 (Specify freshness gate contract)

---

## 1. Purpose

This gate validates that the newest generated kickoff/priority briefs are fresh versus their required source artifacts. It detects staleness by comparing artifact fingerprints (content hash or mtime) and emits deterministic violations with machine-readable remediation payloads when briefs lag behind their sources.

**Problem Solved**: A brief can pass wiring checks (parity gates) while silently lagging behind source artifact updates, causing AI coding/writing sessions to start from outdated risk priorities.

---

## 2. Source↔Brief Mapping

### 2.1 Knowledge Trust Kickoff Brief

| Field | Value |
|-------|-------|
| `briefName` | `knowledge-trust-kickoff-brief` |
| `briefFilename` | `knowledge-trust-kickoff-brief.md` |
| `briefHandler` | `refreshKnowledgeTrustKickoffBrief` |

**Source Artifacts** (ordered by precedence for staleness detection):

| Precedence | Source Artifact | Fingerprint Field | Description |
|------------|-----------------|-------------------|-------------|
| 1 (highest) | `knowledge-trust-dashboard.md` | `dashboard_fingerprint` | Primary trust state |
| 2 | `knowledge-trust-dashboard-state-sync.md` | `state_sync_fingerprint` | Sync status overrides |
| 3 (lowest) | `knowledge-trust-dashboard-history.ndjson` | `history_fingerprint` | Historical context |

### 2.2 MarkItDown Conversion Priority Brief

| Field | Value |
|-------|-------|
| `briefName` | `markitdown-conversion-priority-brief` |
| `briefFilename` | `markitdown-conversion-priority-brief.md` |
| `briefHandler` | `refreshMarkitdownConversionPriorityBrief` |

**Source Artifacts** (ordered by precedence for staleness detection):

| Precedence | Source Artifact | Fingerprint Field | Description |
|------------|-----------------|-------------------|-------------|
| 1 (highest) | `markitdown-conversion-review-inbox.md` | `review_inbox_fingerprint` | Primary conversion review state |
| 2 | `markitdown-conversion-state-sync.md` | `state_sync_fingerprint` | Sync status overrides |
| 3 (lowest) | `markitdown-conversion-history.ndjson` | `history_fingerprint` | Historical context |

### 2.3 Brief Family Detection

A brief is associated with a "family" based on filename prefix:

```
knowledge-trust-* → Trust family
markitdown-conversion-* → MarkItDown family
```

---

## 3. Staleness Heuristics

### 3.1 Fingerprint Comparison

A brief is considered **stale** when ANY of its source artifacts has a newer fingerprint than the brief's recorded source fingerprint.

#### Fingerprint Types

```typescript
type Fingerprint = ContentHash | MtimeFingerprint;

interface ContentHash {
  type: "content-hash";
  algorithm: "sha256";
  value: string;  // hex-encoded hash
}

interface MtimeFingerprint {
  type: "mtime";
  value: string;  // ISO 8601 timestamp
}
```

#### Fingerprint Precedence Rules

1. **Content Hash Preferred**: When content hash is available for both brief and source, use content hash comparison (most accurate).
2. **Mtime Fallback**: When content hash is unavailable, fall back to mtime comparison.
3. **Missing Fingerprint = Stale**: If a source artifact exists but the brief lacks its fingerprint, the brief is stale.

### 3.2 Staleness Detection Algorithm

```typescript
interface FreshnessCheck {
  briefName: string;
  briefFingerprint: BriefFingerprint | null;
  sourceArtifacts: SourceArtifactFingerprint[];
  isStale: boolean;
  staleSources: StaleSource[];
}

interface BriefFingerprint {
  generated_at: string;  // ISO 8601
  source_fingerprints: Record<string, string>;  // source_name → fingerprint
}

interface SourceArtifactFingerprint {
  source_name: string;
  source_path: string;
  exists: boolean;
  fingerprint: string | null;
  fingerprint_type: "content-hash" | "mtime";
}

interface StaleSource {
  source_name: string;
  source_path: string;
  brief_fingerprint: string | null;
  current_fingerprint: string;
  staleness_reason: StalenessReason;
}

type StalenessReason = 
  | "source-newer"        // Source mtime/content is newer than brief
  | "missing-fingerprint" // Brief lacks fingerprint for existing source
  | "source-missing";     // Source doesn't exist (warning, not error)
```

### 3.3 Mtime Window Tolerance

To avoid false positives from file system timestamp jitter:

```typescript
const MTIME_TOLERANCE_MS = 1000;  // 1 second tolerance

function isStaleByMtime(briefMtime: Date, sourceMtime: Date): boolean {
  return (sourceMtime.getTime() - briefMtime.getTime()) > MTIME_TOLERANCE_MS;
}
```

---

## 4. Deterministic Fingerprint Precedence

### 4.1 Precedence Ordering

When multiple source artifacts are stale, violations are reported in this order:

1. **By Precedence Level** (highest precedence first - see §2)
2. **By Source Name** (alphabetical, for deterministic tie-breaking within same precedence)

### 4.2 Fingerprint Calculation

#### Content Hash (Preferred)

```typescript
async function calculateContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

#### Mtime Fingerprint (Fallback)

```typescript
function formatMtimeFingerprint(mtime: Date): string {
  return mtime.toISOString();
}
```

### 4.3 Brief Fingerprint Storage

Brief fingerprints are stored in the brief's frontmatter:

```yaml
---
generated_at: "2026-03-04T22:30:00.000Z"
brief_version: "1.0.0"
source_fingerprints:
  knowledge-trust-dashboard: "sha256:abc123..."
  knowledge-trust-dashboard-state-sync: "sha256:def456..."
  knowledge-trust-dashboard-history: "sha256:ghi789..."
items_count: 15
truncated: false
---
```

---

## 5. Deterministic Rule IDs

### 5.1 Rule ID Schema

All rule IDs follow the pattern: `PBFG###_<DESCRIPTION>`

| Rule ID | Severity | Description |
|---------|----------|-------------|
| `PBFG001_BRIEF_NOT_FOUND` | warning | Brief artifact does not exist (cannot check freshness) |
| `PBFG002_SOURCE_STALE_DASHBOARD` | error | Dashboard source is newer than brief |
| `PBFG003_SOURCE_STALE_STATE_SYNC` | error | State-sync source is newer than brief |
| `PBFG004_SOURCE_STALE_HISTORY` | error | History source is newer than brief |
| `PBFG005_MISSING_FINGERPRINT` | error | Brief lacks fingerprint for existing source |
| `PBFG006_SOURCE_MISSING` | warning | Source artifact does not exist |
| `PBFG007_NO_SOURCES_FOUND` | warning | No source artifacts found for brief family |
| `PBFG008_FINGERPRINT_PARSE_ERROR` | error | Brief frontmatter has malformed fingerprint data |
| `PBFG009_TRUST_FAMILY_STALE` | error | Trust brief family has stale sources (aggregated) |
| `PBFG010_MARKITDOWN_FAMILY_STALE` | error | MarkItDown brief family has stale sources (aggregated) |

### 5.2 Canonical Rule ID Ordering

Violations are sorted by rule ID in this canonical order:

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

### 5.3 Family-Specific Aggregation Rules

For machine-readable output, family-level violations aggregate individual source staleness:

- `PBFG009_TRUST_FAMILY_STALE` fires when any trust source is stale
- `PBFG010_MARKITDOWN_FAMILY_STALE` fires when any MarkItDown source is stale

Both family-level and source-level violations are reported for complete diagnostics.

---

## 6. Remediation Payload Schema

### 6.1 Violation Structure

```typescript
interface FreshnessViolation {
  ruleId: string;           // Deterministic rule ID (PBFG###)
  severity: "error" | "warning";
  briefName: string;        // e.g., "knowledge-trust-kickoff-brief"
  briefPath: string;        // Full path to brief file
  sourceName?: string;      // e.g., "knowledge-trust-dashboard"
  sourcePath?: string;      // Full path to source file
  details: {
    briefFingerprint?: string;
    currentFingerprint?: string;
    briefGeneratedAt?: string;
    sourceModifiedAt?: string;
    stalenessDuration?: string;  // Human-readable time delta
  };
  remediation: {
    description: string;           // Human-readable fix description
    scaffoldCommand: string;       // Shell command to regenerate brief
  };
}
```

### 6.2 Scaffold Commands

Each violation includes a scaffold command to regenerate the stale brief:

#### Trust Brief Refresh

```bash
# Regenerate knowledge-trust-kickoff-brief.md
bun run refresh:knowledge-trust-kickoff-brief -- \
  --vault-path "/path/to/vault" \
  --cli-path "/path/to/obsidian-cli" \
  --vault "MyVault"
```

#### MarkItDown Brief Refresh

```bash
# Regenerate markitdown-conversion-priority-brief.md
bun run refresh:markitdown-conversion-priority-brief -- \
  --vault-path "/path/to/vault" \
  --cli-path "/path/to/obsidian-cli" \
  --vault "MyVault"
```

#### Unified Refresh (Both Briefs)

```bash
# Regenerate all stale briefs
bun run verify:taskpad:intake:auto -- \
  --taskpad "TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --refresh-stale-briefs
```

### 6.3 Remediation Description Templates

| Rule ID | Description Template |
|---------|---------------------|
| `PBFG001` | "Brief `{briefName}` does not exist. Run `{scaffoldCommand}` to generate it." |
| `PBFG002` | "Dashboard source is newer than brief. Brief was generated at `{briefGeneratedAt}` but source was modified at `{sourceModifiedAt}`. Run `{scaffoldCommand}` to refresh." |
| `PBFG003` | "State-sync source is newer than brief. Brief was generated at `{briefGeneratedAt}` but source was modified at `{sourceModifiedAt}`. Run `{scaffoldCommand}` to refresh." |
| `PBFG004` | "History source is newer than brief. Brief was generated at `{briefGeneratedAt}` but source was modified at `{sourceModifiedAt}`. Run `{scaffoldCommand}` to refresh." |
| `PBFG005` | "Brief lacks fingerprint for source `{sourceName}`. Run `{scaffoldCommand}` to regenerate with proper fingerprints." |
| `PBFG006` | "Source `{sourceName}` does not exist. Brief may be orphaned. Consider removing or regenerating." |
| `PBFG007` | "No source artifacts found for brief family. Brief may be orphaned or sources need to be generated first." |
| `PBFG008` | "Brief frontmatter has malformed fingerprint data. Run `{scaffoldCommand}` to regenerate with valid fingerprints." |
| `PBFG009` | "Trust brief family has stale sources. Run `{scaffoldCommand}` to refresh all trust briefs." |
| `PBFG010` | "MarkItDown brief family has stale sources. Run `{scaffoldCommand}` to refresh all MarkItDown briefs." |

---

## 7. Output Format

### 7.1 JSON Output Schema

```typescript
interface PriorityBriefFreshnessResult {
  status: "pass" | "fail";
  inputs: {
    taskpadPath: string;
    planPath: string;
    projectRoot: string;
    vaultPath?: string;
  };
  briefs: BriefFreshnessCheck[];
  summary: {
    totalBriefs: number;
    freshBriefs: number;
    staleBriefs: number;
    missingBriefs: number;
  };
  violations: FreshnessViolation[];
  timestamp: string;  // ISO 8601
}

interface BriefFreshnessCheck {
  briefName: string;
  briefPath: string;
  exists: boolean;
  isStale: boolean;
  generatedAt?: string;
  sourceChecks: SourceFreshnessCheck[];
}

interface SourceFreshnessCheck {
  sourceName: string;
  sourcePath: string;
  exists: boolean;
  isStale: boolean;
  briefFingerprint?: string;
  currentFingerprint?: string;
  stalenessReason?: StalenessReason;
}
```

### 7.2 Human Output Format

```
TASKPAD Priority Brief Freshness Gate: {PASS|FAIL}
──────────────────────────────────────────────────

Inputs:
  - taskpad: {path}
  - plan: {path}
  - project-root: {path}
  - vault-path: {path}

Briefs: {count}
  1. knowledge-trust-kickoff-brief
     - Exists: {yes|no}
     - Fresh: {yes|no}
     - Generated: {timestamp}
     - Sources:
       - knowledge-trust-dashboard: {✓ fresh|✗ stale|⚠ missing}
       - knowledge-trust-dashboard-state-sync: {✓ fresh|✗ stale|⚠ missing}
       - knowledge-trust-dashboard-history: {✓ fresh|✗ stale|⚠ missing}

  2. markitdown-conversion-priority-brief
     - Exists: {yes|no}
     - Fresh: {yes|no}
     - Generated: {timestamp}
     - Sources:
       - markitdown-conversion-review-inbox: {✓ fresh|✗ stale|⚠ missing}
       - markitdown-conversion-state-sync: {✓ fresh|✗ stale|⚠ missing}
       - markitdown-conversion-history: {✓ fresh|✗ stale|⚠ missing}

Summary:
  - Total briefs: {n}
  - Fresh: {n}
  - Stale: {n}
  - Missing: {n}

Violations: {count}
  - [{ruleId}] {briefName}: {description}
    Remediation: {scaffoldCommand}
```

---

## 8. Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All briefs are fresh (pass) |
| 1 | One or more briefs are stale (fail) |
| 2 | Input validation failure (invalid arguments, unreadable files) |

---

## 9. Integration Points

### 9.1 Package.json Script

```json
{
  "scripts": {
    "taskpad:priority-brief-freshness-gate": "bun run tools/taskpad-priority-brief-freshness-gate.ts"
  }
}
```

### 9.2 Intake Auto Verification

The gate is invoked as part of `verify:taskpad:intake:auto`:

```bash
bun run taskpad:priority-brief-freshness-gate \
  -- --taskpad "$taskpad" \
  --plan "$plan" \
  --project-root . \
  --vault-path "$vaultPath" \
  --format json
```

### 9.3 Test Integration

Tests verify:
- Pass state when brief is fresh (fingerprints match)
- Fail state when source is newer
- Warning state when brief/source missing
- Deterministic output ordering
- Scaffold command generation
- Family-level aggregation

---

## 10. Edge Cases

### 10.1 Missing Brief

When a brief doesn't exist:
- Report `PBFG001_BRIEF_NOT_FOUND` (warning)
- Cannot determine staleness (no fingerprint to compare)
- Remediation: Generate the brief

### 10.2 Missing Source

When a source artifact doesn't exist:
- Report `PBFG006_SOURCE_MISSING` (warning)
- Brief may be orphaned or source needs generation first
- Does not cause overall failure

### 10.3 Malformed Frontmatter

When brief frontmatter is unparseable:
- Report `PBFG008_FINGERPRINT_PARSE_ERROR` (error)
- Treat as stale (regenerate to fix)

### 10.4 No Sources Found

When no source artifacts exist for a brief family:
- Report `PBFG007_NO_SOURCES_FOUND` (warning)
- Brief may be orphaned
- Does not cause overall failure

### 10.5 Content Hash vs Mtime Mismatch

When brief uses content hash but source only has mtime:
- Fall back to mtime comparison
- Log warning about fingerprint type mismatch

---

## 11. Related Contracts

| Contract | Purpose |
|----------|---------|
| `markitdown-priority-brief-refresh-contract-parity` | MarkItDown brief wiring validation |
| `knowledge-trust-kickoff-brief-contract` | Trust brief content schema |
| `taskpad-intake-autoplan` | Intake orchestration that consumes freshness results |

---

## 12. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-04 | Initial contract specification for TP001 |
