# MarkItDown Release Readiness Brief Freshness Gate Contract

> Contract specification for `taskpad:markitdown-release-readiness-brief-freshness-gate` deterministic freshness validation.
> 
> **Version**: 1.0.0  
> **Artifact Target**: `markitdown-release-readiness-brief.md`  
> **TP Reference**: TP001 (Specify freshness-gate contract)

---

## 1. Purpose

This gate validates that the generated release-readiness brief is fresh versus its composite MarkItDown source artifacts. It detects staleness by comparing artifact fingerprints (content hash or mtime) and emits deterministic violations with machine-readable remediation payloads when the aggregate brief lags behind any of its component inputs.

**Problem Solved**: A release-readiness brief can pass individual component freshness checks (priority-brief, regression-hotspots, remediation-playbook, state-sync) while being stale as an aggregate, causing release decisions to be made from outdated context.

---

## 2. Required Artifact Set

### 2.1 Target Brief

| Field | Value |
|-------|-------|
| `briefName` | `markitdown-release-readiness-brief` |
| `briefFilename` | `markitdown-release-readiness-brief.md` |
| `briefHandler` | `refreshMarkitdownReleaseReadinessBrief` |

### 2.2 Required Composite Inputs

These artifacts are **required** for freshness validation. If any is missing, the gate reports a warning but cannot fully validate freshness.

| Artifact | Fingerprint Field | Description |
|----------|-------------------|-------------|
| `markitdown-conversion-priority-brief.md` | `priority_brief_fingerprint` | Priority-ranked conversion issues |
| `markitdown-conversion-regression-hotspots.md` | `regression_hotspots_fingerprint` | Recurring fidelity regression patterns |
| `markitdown-conversion-remediation-playbook.md` | `remediation_playbook_fingerprint` | Remediation action sequences |
| `markitdown-conversion-state-sync.md` | `state_sync_fingerprint` | Sync status overrides |

### 2.3 Canonical Upstream Surfaces

These artifacts provide **supporting context**. Staleness here indicates the brief may not reflect the latest upstream state, but is less severe than composite input staleness.

| Artifact | Fingerprint Field | Description |
|----------|-------------------|-------------|
| `markitdown-conversion-review-inbox.md` | `review_inbox_fingerprint` | Raw conversion review queue |
| `markitdown-conversion-history.ndjson` | `history_fingerprint` | Historical conversion records |

---

## 3. Source Precedence

### 3.1 Precedence Levels

When multiple sources are stale, violations are reported in precedence order:

| Level | Source | Type | Rationale |
|-------|--------|------|-----------|
| 1 (highest) | `markitdown-conversion-priority-brief.md` | Required Composite | Direct input to release decisions |
| 2 | `markitdown-conversion-regression-hotspots.md` | Required Composite | Critical for regression awareness |
| 3 | `markitdown-conversion-remediation-playbook.md` | Required Composite | Action guidance for blockers |
| 4 | `markitdown-conversion-state-sync.md` | Required Composite | Status reconciliation |
| 5 | `markitdown-conversion-review-inbox.md` | Upstream Surface | Source material for priority-brief |
| 6 (lowest) | `markitdown-conversion-history.ndjson` | Upstream Surface | Historical context |

### 3.2 Precedence Rules

1. **Required Composite > Upstream Surface**: Required composite inputs take precedence over upstream surfaces for staleness severity.
2. **Within Same Type**: Alphabetical by source name for deterministic tie-breaking.
3. **Violation Ordering**: See §7 for canonical ordering rules.

---

## 4. Stale-Threshold Policy

### 4.1 Fingerprint Comparison

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

#### Staleness Detection Algorithm

```typescript
interface ReleaseReadinessFreshnessCheck {
  briefName: string;
  briefFingerprint: BriefFingerprint | null;
  requiredCompositeInputs: SourceArtifactFingerprint[];
  upstreamSurfaces: SourceArtifactFingerprint[];
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
  precedence_level: number;
  is_required: boolean;
  exists: boolean;
  fingerprint: string | null;
  fingerprint_type: "content-hash" | "mtime";
}

interface StaleSource {
  source_name: string;
  source_path: string;
  precedence_level: number;
  is_required: boolean;
  brief_fingerprint: string | null;
  current_fingerprint: string;
  staleness_reason: StalenessReason;
}

type StalenessReason = 
  | "source-newer"        // Source mtime/content is newer than brief
  | "missing-fingerprint" // Brief lacks fingerprint for existing source
  | "source-missing";     // Source doesn't exist (warning, not error)
```

### 4.2 Mtime Window Tolerance

To avoid false positives from file system timestamp jitter:

```typescript
const MTIME_TOLERANCE_MS = 1000;  // 1 second tolerance

function isStaleByMtime(briefMtime: Date, sourceMtime: Date): boolean {
  return (sourceMtime.getTime() - briefMtime.getTime()) > MTIME_TOLERANCE_MS;
}
```

### 4.3 Required vs Optional Staleness

- **Required Composite Input Stale**: Causes gate **failure** (exit code 1)
- **Upstream Surface Stale**: Causes **warning** but gate may still pass if all required inputs are fresh

---

## 5. Deterministic Rule IDs

### 5.1 Rule ID Schema

All rule IDs follow the pattern: `RRFG###_<DESCRIPTION>` (Release Readiness Freshness Gate)

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

### 5.2 Canonical Rule ID Ordering

Violations are sorted by rule ID in this canonical order:

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

### 5.3 Aggregation Rule

`RRFG012_AGGREGATE_STALE` fires when any required composite input is stale. This provides a single summary violation for CI/CD consumption while detailed violations provide full diagnostics.

---

## 6. Remediation Payload Schema

### 6.1 Violation Structure

```typescript
interface ReleaseReadinessFreshnessViolation {
  ruleId: string;           // Deterministic rule ID (RRFG###)
  severity: "error" | "warning";
  briefName: string;        // "markitdown-release-readiness-brief"
  briefPath: string;        // Full path to brief file
  sourceName?: string;      // e.g., "markitdown-conversion-priority-brief"
  sourcePath?: string;      // Full path to source file
  details: {
    briefFingerprint?: string;
    currentFingerprint?: string;
    briefGeneratedAt?: string;
    sourceModifiedAt?: string;
    stalenessDuration?: string;  // Human-readable time delta
    precedenceLevel?: number;
    isRequired?: boolean;
  };
  remediation: {
    description: string;           // Human-readable fix description
    scaffoldCommand: string;       // Shell command to regenerate brief
  };
}
```

### 6.2 Scaffold Commands

#### Release Readiness Brief Refresh

```bash
# Regenerate markitdown-release-readiness-brief.md
bun run refresh:markitdown-release-readiness-brief -- \
  --vault-path "/path/to/vault" \
  --cli-path "/path/to/obsidian-cli" \
  --vault "MyVault"
```

#### Unified Refresh (Via Intake Auto)

```bash
# Regenerate stale release-readiness brief as part of intake verification
bun run verify:taskpad:intake:auto -- \
  --taskpad "TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --refresh-stale-briefs
```

### 6.3 Remediation Description Templates

| Rule ID | Description Template |
|---------|---------------------|
| `RRFG001` | "Release-readiness brief does not exist. Run `{scaffoldCommand}` to generate it." |
| `RRFG002` | "Priority-brief source is newer than release-readiness brief. Brief generated at `{briefGeneratedAt}` but source modified at `{sourceModifiedAt}`. Run `{scaffoldCommand}` to refresh." |
| `RRFG003` | "Regression-hotspots source is newer than release-readiness brief. Brief generated at `{briefGeneratedAt}` but source modified at `{sourceModifiedAt}`. Run `{scaffoldCommand}` to refresh." |
| `RRFG004` | "Remediation-playbook source is newer than release-readiness brief. Brief generated at `{briefGeneratedAt}` but source modified at `{sourceModifiedAt}`. Run `{scaffoldCommand}` to refresh." |
| `RRFG005` | "State-sync source is newer than release-readiness brief. Brief generated at `{briefGeneratedAt}` but source modified at `{sourceModifiedAt}`. Run `{scaffoldCommand}` to refresh." |
| `RRFG006` | "Review-inbox upstream surface is newer than release-readiness brief. Consider refreshing for latest context. Run `{scaffoldCommand}`." |
| `RRFG007` | "History upstream surface is newer than release-readiness brief. Consider refreshing for latest context. Run `{scaffoldCommand}`." |
| `RRFG008` | "Brief lacks fingerprint for source `{sourceName}`. Run `{scaffoldCommand}` to regenerate with proper fingerprints." |
| `RRFG009` | "Source `{sourceName}` does not exist. Brief may be orphaned. Consider generating source first or removing brief." |
| `RRFG010` | "No source artifacts found. Brief may be orphaned or sources need to be generated first." |
| `RRFG011` | "Brief frontmatter has malformed fingerprint data. Run `{scaffoldCommand}` to regenerate with valid fingerprints." |
| `RRFG012` | "Release-readiness brief has stale composite inputs. Run `{scaffoldCommand}` to refresh with latest source data." |

---

## 7. Violation Ordering

### 7.1 Canonical Ordering Rules

Violations are ordered deterministically as follows:

1. **By Severity**: `error` violations before `warning` violations
2. **By Rule ID**: Within same severity, by rule ID (see §5.2)
3. **By Precedence Level**: For multiple stale sources with same rule pattern, lower precedence level first
4. **By Source Name**: Alphabetical tie-breaking within same precedence

### 7.2 Ordering Algorithm

```typescript
function compareViolations(a: Violation, b: Violation): number {
  // 1. Severity: error < warning
  const severityOrder = { error: 0, warning: 1 };
  const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
  if (severityDiff !== 0) return severityDiff;

  // 2. Rule ID (canonical order from §5.2)
  const ruleOrder = [
    "RRFG001", "RRFG002", "RRFG003", "RRFG004", "RRFG005",
    "RRFG006", "RRFG007", "RRFG008", "RRFG009", "RRFG010",
    "RRFG011", "RRFG012"
  ];
  const ruleDiff = ruleOrder.indexOf(a.ruleId.slice(0, 7)) - 
                   ruleOrder.indexOf(b.ruleId.slice(0, 7));
  if (ruleDiff !== 0) return ruleDiff;

  // 3. Precedence level (lower = higher priority)
  const precDiff = (a.details.precedenceLevel ?? 99) - 
                   (b.details.precedenceLevel ?? 99);
  if (precDiff !== 0) return precDiff;

  // 4. Source name (alphabetical)
  return (a.sourceName ?? "").localeCompare(b.sourceName ?? "");
}
```

---

## 8. Output Format

### 8.1 JSON Output Schema

```typescript
interface ReleaseReadinessFreshnessResult {
  status: "pass" | "fail";
  inputs: {
    taskpadPath: string;
    planPath: string;
    projectRoot: string;
    vaultPath?: string;
  };
  brief: {
    briefName: string;
    briefPath: string;
    exists: boolean;
    isStale: boolean;
    generatedAt?: string;
  };
  sources: {
    requiredCompositeInputs: SourceFreshnessCheck[];
    upstreamSurfaces: SourceFreshnessCheck[];
  };
  summary: {
    totalSources: number;
    freshSources: number;
    staleSources: number;
    missingSources: number;
    requiredStale: number;
    upstreamStale: number;
  };
  violations: ReleaseReadinessFreshnessViolation[];
  timestamp: string;  // ISO 8601
}

interface SourceFreshnessCheck {
  sourceName: string;
  sourcePath: string;
  precedenceLevel: number;
  isRequired: boolean;
  exists: boolean;
  isStale: boolean;
  briefFingerprint?: string;
  currentFingerprint?: string;
  stalenessReason?: StalenessReason;
}
```

### 8.2 Human Output Format

```
TASKPAD MarkItDown Release Readiness Brief Freshness Gate: {PASS|FAIL}
────────────────────────────────────────────────────────────────────

Inputs:
  - taskpad: {path}
  - plan: {path}
  - project-root: {path}
  - vault-path: {path}

Brief: markitdown-release-readiness-brief
  - Exists: {yes|no}
  - Fresh: {yes|no}
  - Generated: {timestamp}

Required Composite Inputs:
  1. markitdown-conversion-priority-brief
     - Precedence: 1
     - Exists: {yes|no}
     - Fresh: {✓|✗ stale|⚠ missing}
  
  2. markitdown-conversion-regression-hotspots
     - Precedence: 2
     - Exists: {yes|no}
     - Fresh: {✓|✗ stale|⚠ missing}
  
  3. markitdown-conversion-remediation-playbook
     - Precedence: 3
     - Exists: {yes|no}
     - Fresh: {✓|✗ stale|⚠ missing}
  
  4. markitdown-conversion-state-sync
     - Precedence: 4
     - Exists: {yes|no}
     - Fresh: {✓|✗ stale|⚠ missing}

Upstream Surfaces:
  5. markitdown-conversion-review-inbox
     - Precedence: 5
     - Exists: {yes|no}
     - Fresh: {✓|✗ stale|⚠ missing}
  
  6. markitdown-conversion-history.ndjson
     - Precedence: 6
     - Exists: {yes|no}
     - Fresh: {✓|✗ stale|⚠ missing}

Summary:
  - Total sources: {n}
  - Fresh: {n}
  - Stale: {n}
  - Missing: {n}
  - Required stale: {n}
  - Upstream stale: {n}

Violations: {count}
  - [{ruleId}] {severity}: {description}
    Source: {sourceName}
    Remediation: {scaffoldCommand}
```

---

## 9. Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Brief is fresh (all required composite inputs fresh) |
| 1 | Brief is stale (one or more required composite inputs stale) |
| 2 | Input validation failure (invalid arguments, unreadable files) |

---

## 10. Integration Points

### 10.1 Package.json Script

```json
{
  "scripts": {
    "taskpad:markitdown-release-readiness-brief-freshness-gate": "bun run tools/taskpad-markitdown-release-readiness-brief-freshness-gate.ts"
  }
}
```

### 10.2 Intake Auto Verification

The gate is invoked as part of `verify:taskpad:intake:auto`:

```bash
bun run taskpad:markitdown-release-readiness-brief-freshness-gate \
  -- --taskpad "$taskpad" \
  --plan "$plan" \
  --project-root . \
  --vault-path "$vaultPath" \
  --format json
```

### 10.3 Test Integration

Tests verify:
- Pass state when brief is fresh (fingerprints match all sources)
- Fail state when required composite input is newer
- Warning state when upstream surface is newer (but gate passes)
- Warning state when brief/source missing
- Deterministic output ordering
- Scaffold command generation
- Aggregate violation behavior

---

## 11. Edge Cases

### 11.1 Missing Brief

When the brief doesn't exist:
- Report `RRFG001_BRIEF_NOT_FOUND` (warning)
- Cannot determine staleness (no fingerprint to compare)
- Remediation: Generate the brief

### 11.2 Missing Required Composite Input

When a required composite input doesn't exist:
- Report `RRFG009_SOURCE_MISSING` (warning)
- Cannot fully validate freshness
- Gate may pass if other sources are fresh, but with warning

### 11.3 Missing Upstream Surface

When an upstream surface doesn't exist:
- Report `RRFG009_SOURCE_MISSING` (warning)
- Less severe than missing required input
- Does not cause gate failure

### 11.4 Malformed Frontmatter

When brief frontmatter is unparseable:
- Report `RRFG011_FINGERPRINT_PARSE_ERROR` (error)
- Treat as stale (regenerate to fix)

### 11.5 No Sources Found

When no source artifacts exist:
- Report `RRFG010_NO_SOURCES_FOUND` (warning)
- Brief may be orphaned
- Does not cause failure (no sources = nothing to be stale against)

### 11.6 All Upstream Stale, Required Fresh

When all upstream surfaces are stale but required composites are fresh:
- Report warnings for upstream staleness
- Gate **passes** (required inputs are what matters for release decisions)

---

## 12. Related Contracts

| Contract | Purpose |
|----------|---------|
| `priority-brief-freshness-gate` | Priority-brief freshness validation |
| `markitdown-priority-brief-refresh-contract-parity` | MarkItDown priority-brief wiring validation |
| `taskpad-intake-autoplan` | Intake orchestration that consumes freshness results |

---

## 13. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-05 | Initial contract specification for TP001 |
