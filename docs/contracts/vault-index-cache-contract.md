# Vault Index Cache Contract

> Specification for deterministic vault-index snapshot caching used by Related Clips and Retrieval Query Pack synthesis
>
> **Slice**: Deterministic vault-index cache for low-latency related/query synthesis
> **Date**: 2026-03-03
> **Task**: TP001

---

## Overview

This document defines the contract for caching vault-index snapshots to reduce repeated vault scanning cost during clip-save operations. The cache stores the result of `indexVault()` (CandidateNote array and indexing metadata) and enables fast cache hits when the vault note corpus is unchanged.

**Purpose**: Keep clip-save latency stable on large vaults while preserving deterministic output guarantees and strong corruption fallback behavior.

---

## Cache Snapshot Schema

### File Location

Cache files are stored in a well-known location relative to the vault root:

```
.obsidian-web-clipper/
└── cache/
    └── vault-index-<fingerprint>.json
```

The `.obsidian-web-clipper/cache/` directory is created if it does not exist.

### Cache File Naming Convention

Cache files use a deterministic fingerprint in their filename:

```
vault-index-<vault_fingerprint>.json
```

Where `<vault_fingerprint>` is a 16-character hex string derived from the vault's structural fingerprint (see [Deterministic Key/Fingerprint Strategy](#deterministic-keyfingerprint-strategy)).

### Cache File Format (Version 1.0.0)

```typescript
interface VaultIndexCacheSnapshot {
  /** Contract version - increment when schema changes */
  version: "1.0.0";

  /** Vault path this cache belongs to (absolute path, normalized) */
  vaultPath: string;

  /** Vault fingerprint used as cache key */
  vaultFingerprint: string;

  /** Timestamp when cache was created (ISO 8601) */
  createdAt: string;

  /** Timestamp when cache was last validated (ISO 8601) */
  lastValidatedAt: string;

  /** Indexing options used to build this cache */
  options: {
    vaultPath: string;
    maxDepth?: number;
    includeHidden?: boolean;
    requiredTags?: string[];
    minDate?: string;
    maxFiles?: number;
  };

  /** Indexed candidate notes (cached from VaultIndexResult.candidates) */
  candidates: CachedCandidateNote[];

  /** Indexing metadata (cached from VaultIndexResult) */
  metadata: {
    filesScanned: number;
    filesWithFrontmatter: number;
    filesSkipped: number;
    errors: IndexError[];
  };

  /** Diagnostics fields for observability */
  diagnostics: CacheDiagnostics;
}

interface CachedCandidateNote {
  path: string;
  title: string;
  sourceUrl: string;
  domain?: string;
  contentType: string;
  entities: string[];
  tags: string[];
  timestamp: string;
  id: string;
}

interface IndexError {
  filePath: string;
  error: string;
  errorType: "read_error" | "parse_error" | "frontmatter_error" | "invalid_metadata";
}

interface CacheDiagnostics {
  /** Whether this cache entry is from a hit or miss */
  cacheHit: boolean;

  /** Cache age in milliseconds at time of use */
  cacheAgeMs: number;

  /** Whether cache was rebuilt on this run */
  cacheRebuilt: boolean;

  /** Rebuild reason if cache was rebuilt */
  rebuildReason?: CacheRebuildReason;

  /** Number of vault files fingerprinted during validation */
  vaultFilesFingerprinted: number;
}

type CacheRebuildReason =
  | "cache_file_not_found"
  | "cache_version_mismatch"
  | "vault_path_mismatch"
  | "vault_fingerprint_changed"
  | "indexing_options_changed"
  | "cache_corrupted"
  | "cache_missing_required_fields"
  | "cache_invalid_schema";
```

### JSON Serialization Rules

For deterministic outputs, cached JSON must follow these rules:

1. **Key ordering**: All object keys are sorted alphabetically
2. **Array ordering**: CandidateNote arrays are sorted deterministically:
   - Primary: `path` lexicographically ascending
   - Secondary: `timestamp` descending (most recent first)
3. **Whitespace**: No extra whitespace between values
4. **Numeric formats**: Integers as numbers (not strings), ISO 8601 dates as strings
5. **Empty arrays**: Always include empty arrays `[]` (never omit)
6. **String normalization**: All strings are trimmed of leading/trailing whitespace

---

## Versioning

### Version Number Format

Version strings follow semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking schema changes (requires cache invalidation)
- **MINOR**: Non-breaking additions (new optional fields)
- **PATCH**: Bug fixes or clarifications (no schema change)

Current version: `1.0.0`

### Version Compatibility Rules

| Cache Version | Current Code | Behavior |
|---------------|--------------|----------|
| Same | Same | Use cache (hit) |
| Same MAJOR, lower MINOR/PATCH | Same | Use cache (backward compatible) |
| Lower MAJOR | Same | Invalidate and rebuild |
| Higher MAJOR | Same | Invalidate and rebuild (unexpected future version) |

### Version Bumping Triggers

Increment version when:

- **MAJOR**: Required field added/removed, field type changed, array element schema changed
- **MINOR**: New optional diagnostic field added, new metadata field added
- **PATCH**: Documentation-only changes, field description clarifications

---

## Deterministic Key/Fingerprint Strategy

### Cache Key Derivation

The cache key (filename suffix) is derived from a vault fingerprint that captures the structural state of all markdown files that could be indexed.

**Fingerprint input components:**

1. **File list** (sorted paths of all `.md` and `.markdown` files):
   - Recursive scan of vault path
   - Filter by extension: `.md`, `.markdown`
   - Respect `includeHidden` option
   - Respect `maxDepth` option (if specified)
   - Sort paths lexicographically

2. **File modification times** (mtime for each file):
   - Read using `fs.stat()` for each file
   - Use `mtimeMs` (milliseconds since epoch)
   - Round to nearest second (to ignore sub-second filesystem precision variations)

3. **File sizes** (bytes for each file):
   - Read using `fs.stat()` for each file
   - Use `size` field in bytes

### Fingerprint Computation Algorithm

```typescript
async function computeVaultFingerprint(
  vaultPath: string,
  options: Pick<VaultIndexOptions, "includeHidden" | "maxDepth">
): Promise<string> {
  // 1. Find all markdown files
  const files = await findMarkdownFiles(vaultPath, options);

  // 2. For each file, compute (path, mtime, size) tuple
  const fileTuples: Array<{
    path: string;
    mtime: number;  // seconds
    size: number;
  }> = [];

  for (const filePath of files) {
    const stats = await fs.stat(filePath);
    fileTuples.push({
      path: filePath,
      mtime: Math.floor(stats.mtimeMs / 1000),  // Round to nearest second
      size: stats.size,
    });
  }

  // 3. Sort tuples by path lexicographically (deterministic order)
  fileTuples.sort((a, b) => a.path.localeCompare(b.path));

  // 4. Build normalized fingerprint string
  const fingerprintLines = fileTuples.map(
    (t) => `${t.path}|${t.mtime}|${t.size}`
  );
  const fingerprintString = fingerprintLines.join("\n");

  // 5. Compute SHA-256 hash and take first 16 hex characters
  const hash = createHash("sha256")
    .update(fingerprintString)
    .digest("hex")
    .slice(0, 16);

  return hash;
}
```

### Fingerprint Determinism Guarantees

The fingerprint is guaranteed to be **identical** across all runs if and only if:

1. The same set of markdown files exist in the vault
2. Each file has the same modification time (second precision)
3. Each file has the same size in bytes
4. The same `includeHidden` and `maxDepth` options are used

**Edge cases handled:**

- **Sub-second mtime differences**: Rounded to nearest second
- **Case-insensitive filesystems**: Paths are compared case-sensitively (original case preserved)
- **Symlinks**: Followed to the target file (use `lstat` to detect, `stat` to read)
- **Empty vault**: Empty fingerprint string → SHA-256("") → first 16 chars
- **Race conditions during scan**: Files added/deleted during scan are not included (acceptable)

### Indexing Options Fingerprint

For cache invalidation based on indexing option changes, compute a separate fingerprint:

```typescript
function computeOptionsFingerprint(options: VaultIndexOptions): string {
  const normalized = {
    maxDepth: options.maxDepth ?? 0,
    includeHidden: options.includeHidden ?? false,
    requiredTags: (options.requiredTags ?? []).sort(),
    minDate: options.minDate ?? null,
    maxFiles: options.maxFiles ?? null,
  };

  const sorted = Object.entries(normalized)
    .sort(([k1], [k2]) => k1.localeCompare(k2))
    .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
    .join("|");

  return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}
```

---

## Invalidation Triggers

Cache is considered invalid and triggers a rebuild when any of the following conditions are met:

### 1. Cache File Not Found (VIC001)

- **Condition**: No cache file exists at `.obsidian-web-clipper/cache/vault-index-<fingerprint>.json`
- **Behavior**: Rebuild cache from scratch
- **Rebuild reason**: `cache_file_not_found`

### 2. Cache Version Mismatch (VIC002)

- **Condition**: Cache `version` field does not match current expected version
- **Behavior**: Invalidate and rebuild cache
- **Rebuild reason**: `cache_version_mismatch`

### 3. Vault Path Mismatch (VIC003)

- **Condition**: Cache `vaultPath` does not match normalized vault path (case-sensitive)
- **Behavior**: Invalidate and rebuild cache
- **Rebuild reason**: `vault_path_mismatch`

### 4. Vault Fingerprint Changed (VIC004)

- **Condition**: Current computed vault fingerprint differs from cache `vaultFingerprint`
- **Behavior**: Invalidate and rebuild cache
- **Rebuild reason**: `vault_fingerprint_changed`

### 5. Indexing Options Changed (VIC005)

- **Condition**: Current options fingerprint differs from cached options
- **Behavior**: Invalidate and rebuild cache
- **Rebuild reason**: `indexing_options_changed`

### 6. Cache Corrupted (VIC006)

- **Condition**: JSON parsing fails or required fields are missing
- **Behavior**: Delete corrupted cache file and rebuild
- **Rebuild reason**: `cache_corrupted`

### 7. Cache Missing Required Fields (VIC007)

- **Condition**: Valid JSON but missing required fields from schema
- **Behavior**: Treat as corrupted, delete and rebuild
- **Rebuild reason**: `cache_missing_required_fields`

### 8. Cache Invalid Schema (VIC008)

- **Condition**: Field types don't match expected schema (e.g., string where number expected)
- **Behavior**: Treat as corrupted, delete and rebuild
- **Rebuild reason**: `cache_invalid_schema`

### Invalidation Decision Flow

```typescript
async function resolveVaultIndexCache(
  vaultPath: string,
  options: VaultIndexOptions
): Promise<VaultIndexCacheResult> {
  // 1. Compute current vault fingerprint
  const currentVaultFingerprint = await computeVaultFingerprint(vaultPath, options);

  // 2. Compute current options fingerprint
  const currentOptionsFingerprint = computeOptionsFingerprint(options);

  // 3. Locate cache file
  const cacheFilePath = path.join(
    vaultPath,
    ".obsidian-web-clipper/cache",
    `vault-index-${currentVaultFingerprint}.json`
  );

  // 4. Check if cache file exists
  const cacheExists = await fileExists(cacheFilePath);
  if (!cacheExists) {
    return await rebuildCache(vaultPath, options, "cache_file_not_found");
  }

  // 5. Load and parse cache
  let cache: VaultIndexCacheSnapshot;
  try {
    const cacheContent = await fs.readFile(cacheFilePath, "utf-8");
    cache = JSON.parse(cacheContent) as VaultIndexCacheSnapshot;
  } catch (error) {
    // JSON parse failed or read error
    await safeDelete(cacheFilePath);
    return await rebuildCache(vaultPath, options, "cache_corrupted");
  }

  // 6. Validate cache structure
  const validationResult = validateCacheStructure(cache);
  if (!validationResult.valid) {
    await safeDelete(cacheFilePath);
    return await rebuildCache(vaultPath, options, validationResult.reason ?? "cache_invalid_schema");
  }

  // 7. Check version compatibility
  if (!isVersionCompatible(cache.version, CURRENT_VERSION)) {
    await safeDelete(cacheFilePath);
    return await rebuildCache(vaultPath, options, "cache_version_mismatch");
  }

  // 8. Check vault path match
  const normalizedVaultPath = normalizePath(vaultPath);
  if (cache.vaultPath !== normalizedVaultPath) {
    await safeDelete(cacheFilePath);
    return await rebuildCache(vaultPath, options, "vault_path_mismatch");
  }

  // 9. Check vault fingerprint match
  if (cache.vaultFingerprint !== currentVaultFingerprint) {
    await safeDelete(cacheFilePath);
    return await rebuildCache(vaultPath, options, "vault_fingerprint_changed");
  }

  // 10. Check options fingerprint match
  const cachedOptionsFingerprint = computeOptionsFingerprint(cache.options);
  if (cachedOptionsFingerprint !== currentOptionsFingerprint) {
    await safeDelete(cacheFilePath);
    return await rebuildCache(vaultPath, options, "indexing_options_changed");
  }

  // 11. Cache hit - update diagnostics
  const cacheAgeMs = Date.now() - new Date(cache.createdAt).getTime();
  const result: VaultIndexCacheResult = {
    status: "hit",
    candidates: cache.candidates,
    metadata: cache.metadata,
    diagnostics: {
      ...cache.diagnostics,
      cacheHit: true,
      cacheAgeMs,
      cacheRebuilt: false,
    },
  };

  // 12. Update cache validation timestamp (async, non-blocking)
  updateCacheValidationTimestamp(cacheFilePath).catch(() => {
    // Silently ignore errors - this is best-effort telemetry
  });

  return result;
}
```

---

## Corruption Fallback Behavior

### Corruption Detection

Cache corruption is detected in these scenarios:

1. **JSON parse failure**: `JSON.parse()` throws an exception
2. **Required field missing**: Any required field is `undefined`
3. **Type mismatch**: Field value doesn't match expected type
4. **Invalid enum value**: String enum doesn't match allowed values
5. **Invalid date format**: ISO 8601 date string fails `Date.parse()`
6. **Invalid URL**: `sourceUrl` or `domain` is not a valid URL string
7. **Negative counts**: `filesScanned`, `filesWithFrontmatter`, `filesSkipped` are negative
8. **Inconsistent counts**: `filesWithFrontmatter + filesSkipped > filesScanned`

### Fallback Strategy

When corruption is detected:

1. **Delete corrupted cache file** (if it exists)
2. **Log corruption details** to console with cache path and error type
3. **Rebuild cache from scratch** using `indexVault()`
4. **Write new cache** with `cacheRebuilt: true` in diagnostics
5. **Return rebuilt result** to caller (caller should not see a failure)

### Safe Delete Operation

```typescript
async function safeDelete(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Log but don't throw - cache may have been deleted by another process
    console.warn(`[VaultIndexCache] Failed to delete cache file ${filePath}:`, error);
  }
}
```

### Corruption Diagnostics

When corruption triggers a rebuild, include detailed diagnostics:

```typescript
interface CacheCorruptionDetails {
  cacheFilePath: string;
  corruptionType: CacheCorruptionType;
  errorMessage?: string;
  validationErrors: ValidationError[];
  timestamp: string;
}

type CacheCorruptionType =
  | "json_parse_error"
  | "missing_required_field"
  | "type_mismatch"
  | "invalid_enum_value"
  | "invalid_date_format"
  | "invalid_url"
  | "negative_count"
  | "inconsistent_counts";

interface ValidationError {
  fieldPath: string;  // e.g., "candidates.0.sourceUrl"
  expectedType: string;
  actualValue: unknown;
  errorType: string;
}
```

### Atomic Write Contract

When writing a new cache file, use atomic writes to prevent partial writes:

```typescript
async function writeCacheAtomically(
  cacheFilePath: string,
  cache: VaultIndexCacheSnapshot
): Promise<void> {
  const tempFilePath = `${cacheFilePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    // 1. Write to temp file
    const cacheJson = serializeCacheDeterministically(cache);
    await fs.writeFile(tempFilePath, cacheJson, "utf-8");

    // 2. Sync temp file to disk (fsync)
    const fd = await fs.open(tempFilePath, "r");
    await fd.sync();
    await fd.close();

    // 3. Ensure cache directory exists
    const cacheDir = path.dirname(cacheFilePath);
    await fs.mkdir(cacheDir, { recursive: true });

    // 4. Atomic rename (temp → target)
    await fs.rename(tempFilePath, cacheFilePath);
  } catch (error) {
    // 5. On error, clean up temp file
    await safeDelete(tempFilePath);
    throw error;
  }
}
```

---

## Diagnostics Fields

### Cache Resolution Result

```typescript
interface VaultIndexCacheResult {
  /** Resolution status: hit (cache used), miss (cache rebuilt), error (rebuild failed) */
  status: "hit" | "miss" | "error";

  /** Indexed candidate notes (from cache or rebuild) */
  candidates: CachedCandidateNote[];

  /** Indexing metadata (from cache or rebuild) */
  metadata: {
    filesScanned: number;
    filesWithFrontmatter: number;
    filesSkipped: number;
    errors: IndexError[];
  };

  /** Cache diagnostics for observability */
  diagnostics: CacheDiagnostics;

  /** Error details if status is "error" */
  error?: {
    message: string;
    code: string;
    originalError?: unknown;
  };
}
```

### Diagnostics Fields Description

| Field | Type | Description |
|-------|------|-------------|
| `cacheHit` | `boolean` | `true` if cache was used, `false` if rebuilt |
| `cacheAgeMs` | `number` | Cache age in milliseconds at time of use |
| `cacheRebuilt` | `boolean` | `true` if cache was rebuilt on this run |
| `rebuildReason` | `CacheRebuildReason?` | Why cache was rebuilt (if `cacheRebuilt` is true) |
| `vaultFilesFingerprinted` | `number` | Number of files scanned during fingerprint computation |

### Frontmatter Integration

When a clip is saved with cached vault index, include diagnostics in frontmatter:

```typescript
interface VaultIndexCacheFrontmatterDiagnostics {
  /** Version of the cache contract */
  vault_index_cache_version: string;

  /** Whether cache was a hit or miss for this save */
  vault_index_cache_hit: boolean;

  /** Cache age in milliseconds at time of save */
  vault_index_cache_age_ms: number;

  /** Whether cache was rebuilt before this save */
  vault_index_cache_rebuilt: boolean;

  /** Rebuild reason if cache was rebuilt */
  vault_index_cache_rebuild_reason?: CacheRebuildReason;

  /** Number of candidates from cached vault index */
  vault_index_candidate_count: number;
}
```

Example frontmatter:

```yaml
---
source: https://example.com/article
title: Example Article
vault_index_cache_version: "1.0.0"
vault_index_cache_hit: true
vault_index_cache_age_ms: 86400000
vault_index_cache_rebuilt: false
vault_index_candidate_count: 42
---
```

### Observability Recommendations

For telemetry and monitoring, track these metrics:

1. **Cache hit rate**: `count(cacheHit=true) / count(all saves)`
2. **Cache age distribution**: Histogram of `cacheAgeMs` values
3. **Rebuild reasons**: Frequency of each `CacheRebuildReason`
4. **Cache size distribution**: Histogram of `candidates.length`
5. **Fingerprint compute time**: Time to compute vault fingerprint
6. **Index rebuild time**: Time to rebuild from scratch

---

## Validation Rules

### Required Fields

The following fields are required in `VaultIndexCacheSnapshot`:

```typescript
const REQUIRED_FIELDS = [
  "version",
  "vaultPath",
  "vaultFingerprint",
  "createdAt",
  "lastValidatedAt",
  "options",
  "candidates",
  "metadata",
  "diagnostics",
] as const;
```

### Type Validation

```typescript
interface CacheValidationResult {
  valid: boolean;
  reason?: CacheRebuildReason;
  errors: ValidationError[];
}

function validateCacheStructure(cache: unknown): CacheValidationResult {
  const errors: ValidationError[] = [];

  // 1. Check that cache is an object
  if (typeof cache !== "object" || cache === null) {
    return {
      valid: false,
      reason: "cache_invalid_schema",
      errors: [{ fieldPath: "$", expectedType: "object", actualValue: cache, errorType: "type_mismatch" }],
    };
  }

  const obj = cache as Record<string, unknown>;

  // 2. Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj)) {
      errors.push({
        fieldPath: field,
        expectedType: field,
        actualValue: undefined,
        errorType: "missing_required_field",
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, reason: "cache_missing_required_fields", errors };
  }

  // 3. Validate field types
  if (typeof obj.version !== "string") {
    errors.push({ fieldPath: "version", expectedType: "string", actualValue: obj.version, errorType: "type_mismatch" });
  }

  if (typeof obj.vaultPath !== "string") {
    errors.push({ fieldPath: "vaultPath", expectedType: "string", actualValue: obj.vaultPath, errorType: "type_mismatch" });
  }

  if (typeof obj.vaultFingerprint !== "string") {
    errors.push({ fieldPath: "vaultFingerprint", expectedType: "string", actualValue: obj.vaultFingerprint, errorType: "type_mismatch" });
  }

  // Validate vaultFingerprint is 16 hex characters
  if (typeof obj.vaultFingerprint === "string" && !/^[a-f0-9]{16}$/.test(obj.vaultFingerprint)) {
    errors.push({ fieldPath: "vaultFingerprint", expectedType: "hex16", actualValue: obj.vaultFingerprint, errorType: "invalid_format" });
  }

  // 4. Validate candidates array
  if (!Array.isArray(obj.candidates)) {
    errors.push({ fieldPath: "candidates", expectedType: "array", actualValue: obj.candidates, errorType: "type_mismatch" });
  } else {
    // Validate each candidate
    for (let i = 0; i < obj.candidates.length; i++) {
      const candidate = obj.candidates[i];
      const prefix = `candidates.${i}`;

      if (typeof candidate !== "object" || candidate === null) {
        errors.push({ fieldPath: prefix, expectedType: "object", actualValue: candidate, errorType: "type_mismatch" });
        continue;
      }

      const cand = candidate as Record<string, unknown>;

      if (typeof cand.path !== "string") {
        errors.push({ fieldPath: `${prefix}.path`, expectedType: "string", actualValue: cand.path, errorType: "type_mismatch" });
      }

      if (typeof cand.title !== "string") {
        errors.push({ fieldPath: `${prefix}.title`, expectedType: "string", actualValue: cand.title, errorType: "type_mismatch" });
      }

      if (cand.sourceUrl !== undefined && typeof cand.sourceUrl !== "string") {
        errors.push({ fieldPath: `${prefix}.sourceUrl`, expectedType: "string", actualValue: cand.sourceUrl, errorType: "type_mismatch" });
      }

      if (!Array.isArray(cand.entities)) {
        errors.push({ fieldPath: `${prefix}.entities`, expectedType: "array", actualValue: cand.entities, errorType: "type_mismatch" });
      }

      if (!Array.isArray(cand.tags)) {
        errors.push({ fieldPath: `${prefix}.tags`, expectedType: "array", actualValue: cand.tags, errorType: "type_mismatch" });
      }
    }
  }

  // 5. Validate metadata
  if (typeof obj.metadata !== "object" || obj.metadata === null) {
    errors.push({ fieldPath: "metadata", expectedType: "object", actualValue: obj.metadata, errorType: "type_mismatch" });
  } else {
    const meta = obj.metadata as Record<string, unknown>;

    if (typeof meta.filesScanned !== "number") {
      errors.push({ fieldPath: "metadata.filesScanned", expectedType: "number", actualValue: meta.filesScanned, errorType: "type_mismatch" });
    }

    if (typeof meta.filesWithFrontmatter !== "number") {
      errors.push({ fieldPath: "metadata.filesWithFrontmatter", expectedType: "number", actualValue: meta.filesWithFrontmatter, errorType: "type_mismatch" });
    }

    if (typeof meta.filesSkipped !== "number") {
      errors.push({ fieldPath: "metadata.filesSkipped", expectedType: "number", actualValue: meta.filesSkipped, errorType: "type_mismatch" });
    }

    // Check for negative counts
    if (typeof meta.filesScanned === "number" && meta.filesScanned < 0) {
      errors.push({ fieldPath: "metadata.filesScanned", expectedType: "non-negative number", actualValue: meta.filesScanned, errorType: "invalid_value" });
    }

    // Check count consistency
    if (
      typeof meta.filesScanned === "number" &&
      typeof meta.filesWithFrontmatter === "number" &&
      typeof meta.filesSkipped === "number" &&
      meta.filesWithFrontmatter + meta.filesSkipped > meta.filesScanned
    ) {
      errors.push({
        fieldPath: "metadata",
        expectedType: "consistent counts",
        actualValue: `${meta.filesWithFrontmatter} + ${meta.filesSkipped} > ${meta.filesScanned}`,
        errorType: "inconsistent_counts",
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, reason: "cache_invalid_schema", errors };
  }

  return { valid: true };
}
```

---

## Deterministic Output Guarantees

The cache system must preserve deterministic outputs for the following flows:

1. **Cache hit on unchanged vault**: Same `indexVault()` result as previous run
2. **Cache rebuild on changed vault**: Same `indexVault()` result as fresh `indexVault()` call
3. **Corruption fallback**: Rebuild produces same result as fresh `indexVault()` call

### Determinism Invariants

1. **Candidate order**: `candidates` array sorted by `path` (ascending), then `timestamp` (descending)
2. **Array ordering**: All arrays (`entities`, `tags`, `errors`) sorted deterministically
3. **Key ordering**: JSON object keys sorted alphabetically
4. **String normalization**: All strings trimmed and Unicode normalized (NFC)
5. **Number formatting**: Integers as numbers, no floating-point precision variations

### Testing Determinism

```typescript
// Test that cache hit produces identical output
async function testCacheHitDeterminism(): Promise<void> {
  const options: VaultIndexOptions = { vaultPath: "/test/vault" };

  // First run - builds cache
  const result1 = await resolveVaultIndexCache(options);

  // Second run - uses cache
  const result2 = await resolveVaultIndexCache(options);

  // Results must be identical
  assert.deepStrictEqual(result1.candidates, result2.candidates);
  assert.deepStrictEqual(result1.metadata, result2.metadata);
}

// Test that cache rebuild produces identical output
async function testCacheRebuildDeterminism(): Promise<void> {
  const options: VaultIndexOptions = { vaultPath: "/test/vault" };

  // First run - builds cache
  await resolveVaultIndexCache(options);

  // Touch a file to change fingerprint
  await touchFile("/test/vault/note.md");

  // Second run - rebuilds cache
  const result = await resolveVaultIndexCache(options);

  // Compare to fresh indexVault call
  const fresh = await indexVault(options);

  assert.deepStrictEqual(result.candidates, fresh.candidates);
  assert.deepStrictEqual(result.metadata, fresh.metadata);
}
```

---

## Error Handling

### Error Categories

| Error Type | Severity | Recovery Strategy |
|------------|----------|-------------------|
| `cache_file_not_found` | info | Rebuild cache |
| `cache_corrupted` | warning | Delete cache, rebuild |
| `version_mismatch` | warning | Delete cache, rebuild |
| `vault_path_mismatch` | warning | Delete cache, rebuild |
| `fingerprint_changed` | info | Delete cache, rebuild |
| `indexing_failed` | error | Propagate error to caller |

### Error Codes

```typescript
const CACHE_ERROR_CODES = {
  CACHE_READ_FAILED: "VIC_ERR_001",
  CACHE_WRITE_FAILED: "VIC_ERR_002",
  CACHE_DELETE_FAILED: "VIC_ERR_003",
  FINGERPRINT_COMPUTE_FAILED: "VIC_ERR_004",
  INDEX_VAULT_FAILED: "VIC_ERR_005",
  CACHE_VALIDATION_FAILED: "VIC_ERR_006",
  OPTIONS_MISMATCH: "VIC_ERR_007",
} as const;
```

### Error Propagation

Most cache errors are handled internally (corruption, miss, etc.). Only unrecoverable errors are propagated to the caller:

- **Unrecoverable**: `indexVault()` fails after cache miss
- **Recoverable**: Cache corruption, version mismatch, fingerprint change

The caller should see:

- **Cache hit**: `{ status: "hit", candidates: [...], metadata: {...}, diagnostics: {...} }`
- **Cache miss (rebuild success)**: `{ status: "miss", candidates: [...], metadata: {...}, diagnostics: { cacheRebuilt: true, rebuildReason: "..." } }`
- **Cache miss (rebuild failure)**: `{ status: "error", error: { message: "...", code: "VIC_ERR_005", originalError: ... } }`

---

## Implementation Checklist (for TP002-TP004)

- [ ] TP002: Implement shared cache read/write module
  - [ ] Compute vault fingerprint deterministically
  - [ ] Compute options fingerprint
  - [ ] Serialize cache with deterministic ordering
  - [ ] Deserialize and validate cache structure
  - [ ] Atomic cache write with temp file
  - [ ] Safe cache delete on corruption
  - [ ] Cache resolution logic (hit/miss/rebuild)
  - [ ] Diagnostics field population

- [ ] TP003: Integrate cache into `src/shared/vaultIndex.ts`
  - [ ] Add cache-aware wrapper for `indexVault()`
  - [ ] Pass cache options through indexing pipeline
  - [ ] Update frontmatter with cache diagnostics
  - [ ] Integrate into related clips matching path
  - [ ] Integrate into Retrieval Query Pack synthesis path

- [ ] TP004: Integrate cache into shared query path
  - [ ] Share single cache read per clip save
  - [ ] Ensure both related and query use same cached index
  - [ ] Verify deterministic output across cached and rebuilt paths

- [ ] TP005: Add test coverage
  - [ ] `tests/shared/vault-index-cache.test.ts` for cache hit/miss/invalidation/corruption
  - [ ] Extend `tests/content/shared/related-clips-graph.test.ts` for cache parity
  - [ ] Extend `tests/content/shared/retrieval-query-pack.test.ts` for cache parity
  - [ ] Extend `tests/e2e/headless-clip-harness.test.ts` for end-to-end cache behavior

---

## Appendix: TypeScript Type Exports

```typescript
// Cache contract types
export const VAULT_INDEX_CACHE_VERSION = "1.0.0" as const;

export interface VaultIndexCacheSnapshot {
  version: "1.0.0";
  vaultPath: string;
  vaultFingerprint: string;
  createdAt: string;
  lastValidatedAt: string;
  options: VaultIndexOptions;
  candidates: CachedCandidateNote[];
  metadata: VaultIndexMetadata;
  diagnostics: CacheDiagnostics;
}

export interface CachedCandidateNote {
  path: string;
  title: string;
  sourceUrl: string;
  domain?: string;
  contentType: string;
  entities: string[];
  tags: string[];
  timestamp: string;
  id: string;
}

export interface VaultIndexMetadata {
  filesScanned: number;
  filesWithFrontmatter: number;
  filesSkipped: number;
  errors: IndexError[];
}

export interface CacheDiagnostics {
  cacheHit: boolean;
  cacheAgeMs: number;
  cacheRebuilt: boolean;
  rebuildReason?: CacheRebuildReason;
  vaultFilesFingerprinted: number;
}

export type CacheRebuildReason =
  | "cache_file_not_found"
  | "cache_version_mismatch"
  | "vault_path_mismatch"
  | "vault_fingerprint_changed"
  | "indexing_options_changed"
  | "cache_corrupted"
  | "cache_missing_required_fields"
  | "cache_invalid_schema";

export interface VaultIndexCacheResult {
  status: "hit" | "miss" | "error";
  candidates: CachedCandidateNote[];
  metadata: VaultIndexMetadata;
  diagnostics: CacheDiagnostics;
  error?: CacheError;
}

export interface CacheError {
  message: string;
  code: string;
  originalError?: unknown;
}

export interface CacheValidationResult {
  valid: boolean;
  reason?: CacheRebuildReason;
  errors: ValidationError[];
}

export interface ValidationError {
  fieldPath: string;
  expectedType: string;
  actualValue: unknown;
  errorType: string;
}

export type CacheCorruptionType =
  | "json_parse_error"
  | "missing_required_field"
  | "type_mismatch"
  | "invalid_enum_value"
  | "invalid_date_format"
  | "invalid_url"
  | "negative_count"
  | "inconsistent_counts";

export interface CacheCorruptionDetails {
  cacheFilePath: string;
  corruptionType: CacheCorruptionType;
  errorMessage?: string;
  validationErrors: ValidationError[];
  timestamp: string;
}

export interface VaultIndexCacheFrontmatterDiagnostics {
  vault_index_cache_version: string;
  vault_index_cache_hit: boolean;
  vault_index_cache_age_ms: number;
  vault_index_cache_rebuilt: boolean;
  vault_index_cache_rebuild_reason?: CacheRebuildReason;
  vault_index_candidate_count: number;
}

// Cache error codes
export const CACHE_ERROR_CODES = {
  CACHE_READ_FAILED: "VIC_ERR_001",
  CACHE_WRITE_FAILED: "VIC_ERR_002",
  CACHE_DELETE_FAILED: "VIC_ERR_003",
  FINGERPRINT_COMPUTE_FAILED: "VIC_ERR_004",
  INDEX_VAULT_FAILED: "VIC_ERR_005",
  CACHE_VALIDATION_FAILED: "VIC_ERR_006",
  OPTIONS_MISMATCH: "VIC_ERR_007",
} as const;
```

---

**Contract Status**: SPECIFIED
**Next Task**: TP002 - Implement shared cache read/write module for vault index snapshots
