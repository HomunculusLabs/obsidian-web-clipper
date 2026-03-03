/**
 * Vault Index Cache Module
 *
 * Implements deterministic caching for vault index snapshots with atomic file updates
 * and deterministic serialization ordering.
 *
 * Cache reduces repeated vault scanning cost during clip-save operations while
 * preserving deterministic output guarantees.
 */

import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";

import type { CandidateNote } from "./relatedClipsContract";
import type { VaultIndexOptions, VaultIndexResult, IndexError } from "./vaultIndex";

// =============================================================================
// Constants
// =============================================================================

/**
 * Current cache contract version
 */
export const VAULT_INDEX_CACHE_VERSION = "1.0.0" as const;

/**
 * Cache directory name (relative to vault root)
 */
const CACHE_DIR_NAME = ".obsidian-web-clipper/cache";

/**
 * Cache filename prefix
 */
const CACHE_FILE_PREFIX = "vault-index-";

/**
 * Cache filename extension
 */
const CACHE_FILE_EXTENSION = ".json";

// =============================================================================
// Error Codes
// =============================================================================

export const CACHE_ERROR_CODES = {
  CACHE_READ_FAILED: "VIC_ERR_001",
  CACHE_WRITE_FAILED: "VIC_ERR_002",
  CACHE_DELETE_FAILED: "VIC_ERR_003",
  FINGERPRINT_COMPUTE_FAILED: "VIC_ERR_004",
  INDEX_VAULT_FAILED: "VIC_ERR_005",
  CACHE_VALIDATION_FAILED: "VIC_ERR_006",
  OPTIONS_MISMATCH: "VIC_ERR_007",
} as const;

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Cached candidate note (stored in cache snapshot)
 */
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

/**
 * Vault index metadata (stored in cache snapshot)
 */
export interface VaultIndexMetadata {
  filesScanned: number;
  filesWithFrontmatter: number;
  filesSkipped: number;
  errors: IndexError[];
}

/**
 * Cache diagnostics for observability
 */
export interface CacheDiagnostics {
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

/**
 * Reason why cache was rebuilt
 */
export type CacheRebuildReason =
  | "cache_file_not_found"
  | "cache_version_mismatch"
  | "vault_path_mismatch"
  | "vault_fingerprint_changed"
  | "indexing_options_changed"
  | "cache_corrupted"
  | "cache_missing_required_fields"
  | "cache_invalid_schema";

/**
 * Vault index cache snapshot (on-disk format)
 */
export interface VaultIndexCacheSnapshot {
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
  options: VaultIndexOptions;

  /** Indexed candidate notes (cached from VaultIndexResult.candidates) */
  candidates: CachedCandidateNote[];

  /** Indexing metadata (cached from VaultIndexResult) */
  metadata: VaultIndexMetadata;

  /** Diagnostics fields for observability */
  diagnostics: CacheDiagnostics;
}

/**
 * Cache resolution result
 */
export interface VaultIndexCacheResult {
  /** Resolution status: hit (cache used), miss (cache rebuilt), error (rebuild failed) */
  status: "hit" | "miss" | "error";

  /** Indexed candidate notes (from cache or rebuild) */
  candidates: CachedCandidateNote[];

  /** Indexing metadata (from cache or rebuild) */
  metadata: VaultIndexMetadata;

  /** Cache diagnostics for observability */
  diagnostics: CacheDiagnostics;

  /** Error details if status is "error" */
  error?: CacheError;
}

/**
 * Cache error details
 */
export interface CacheError {
  message: string;
  code: string;
  originalError?: unknown;
}

/**
 * Cache validation result
 */
export interface CacheValidationResult {
  valid: boolean;
  reason?: CacheRebuildReason;
  errors: ValidationError[];
}

/**
 * Validation error details
 */
export interface ValidationError {
  fieldPath: string;
  expectedType: string;
  actualValue: unknown;
  errorType: string;
}

/**
 * Cache corruption details
 */
export interface CacheCorruptionDetails {
  cacheFilePath: string;
  corruptionType: CacheCorruptionType;
  errorMessage?: string;
  validationErrors: ValidationError[];
  timestamp: string;
}

/**
 * Type of cache corruption
 */
export type CacheCorruptionType =
  | "json_parse_error"
  | "missing_required_field"
  | "type_mismatch"
  | "invalid_enum_value"
  | "invalid_date_format"
  | "invalid_url"
  | "negative_count"
  | "inconsistent_counts";

// =============================================================================
// Required Fields
// =============================================================================

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

// =============================================================================
// Fingerprint Computation
// =============================================================================

/**
 * File tuple for fingerprint computation
 */
interface FileTuple {
  path: string;
  mtime: number;  // seconds (rounded from mtimeMs)
  size: number;
}

/**
 * Find all markdown files in a directory
 */
async function findMarkdownFiles(
  dir: string,
  options: Pick<VaultIndexOptions, "includeHidden" | "maxDepth"> & { currentDepth?: number }
): Promise<string[]> {
  const { includeHidden = false, maxDepth = 0, currentDepth = 0 } = options;

  // Check depth limit (stop before recursing beyond maxDepth)
  if (maxDepth > 0 && currentDepth > maxDepth) {
    return [];
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      // Skip hidden files/folders unless included
      if (!includeHidden && entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively search subdirectories
        const subFiles = await findMarkdownFiles(fullPath, {
          includeHidden,
          maxDepth,
          currentDepth: currentDepth + 1
        });
        files.push(...subFiles);
      } else if (entry.isFile()) {
        // Include markdown files (.md, .markdown)
        if (
          entry.name.endsWith(".md") ||
          entry.name.endsWith(".markdown")
        ) {
          files.push(fullPath);
        }
      }
    }

    return files;
  } catch (error) {
    console.warn(`[VaultIndexCache] Failed to read directory ${dir}:`, error);
    return [];
  }
}

/**
 * Compute vault fingerprint deterministically
 *
 * The fingerprint captures the structural state of all markdown files
 * that could be indexed. It's derived from file paths, modification times,
 * and sizes.
 *
 * @param vaultPath - Root path of the vault
 * @param options - Indexing options (includeHidden, maxDepth)
 * @returns 16-character hex fingerprint
 */
export async function computeVaultFingerprint(
  vaultPath: string,
  options: Pick<VaultIndexOptions, "includeHidden" | "maxDepth">
): Promise<string> {
  try {
    // 1. Find all markdown files
    const files = await findMarkdownFiles(vaultPath, options);

    // 2. For each file, compute (path, mtime, size) tuple
    const fileTuples: FileTuple[] = [];

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
  } catch (error) {
    console.error("[VaultIndexCache] Failed to compute vault fingerprint:", error);
    throw new Error(
      `${CACHE_ERROR_CODES.FINGERPRINT_COMPUTE_FAILED}: Failed to compute vault fingerprint: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Compute indexing options fingerprint
 *
 * The options fingerprint captures the indexing parameters that affect
 * which files are included in the index. Changes to these options should
 * invalidate the cache.
 *
 * @param options - Indexing options
 * @returns 16-character hex fingerprint
 */
export function computeOptionsFingerprint(options: VaultIndexOptions): string {
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

// =============================================================================
// Deterministic Serialization
// =============================================================================

/**
 * Serialize a cache snapshot deterministically
 *
 * Ensures consistent JSON output across runs with:
 * - Alphabetically sorted object keys
 * - Deterministically sorted arrays
 * - Consistent number formatting
 * - No extra whitespace
 *
 * @param cache - Cache snapshot to serialize
 * @returns Deterministic JSON string
 */
export function serializeCacheDeterministically(cache: VaultIndexCacheSnapshot): string {
  // Deep clone and sort
  const sorted = deepSortObject(cache);

  return JSON.stringify(sorted);
}

/**
 * Deep sort an object deterministically
 *
 * Sorts all object keys alphabetically and sorts arrays by
 * their natural order (strings alphabetically, numbers numerically).
 *
 * @param value - Value to sort
 * @returns Sorted value
 */
function deepSortObject(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    // Sort arrays deterministically
    return value
      .map((item) => deepSortObject(item))
      .sort((a, b) => {
        // String comparison for most items
        const aStr = JSON.stringify(a);
        const bStr = JSON.stringify(b);
        return aStr.localeCompare(bStr);
      });
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    // Sort keys alphabetically
    const keys = Object.keys(obj).sort();

    for (const key of keys) {
      sorted[key] = deepSortObject(obj[key]);
    }

    return sorted;
  }

  return value;
}

/**
 * Convert CandidateNote to CachedCandidateNote
 *
 * Note: sourceUrl should always be present for candidates that passed
 * vault indexing (notes without sourceUrl are filtered out).
 */
export function toCachedCandidateNote(candidate: CandidateNote): CachedCandidateNote {
  if (!candidate.sourceUrl) {
    throw new Error(`CandidateNote at path ${candidate.path} is missing sourceUrl (should have been filtered during indexing)`);
  }
  return {
    path: candidate.path,
    title: candidate.title,
    sourceUrl: candidate.sourceUrl,
    domain: candidate.domain,
    contentType: candidate.contentType,
    entities: [...candidate.entities].sort(),
    tags: [...candidate.tags].sort(),
    timestamp: candidate.timestamp,
    id: candidate.id,
  };
}

/**
 * Convert CachedCandidateNote to CandidateNote
 */
export function fromCachedCandidateNote(cached: CachedCandidateNote): CandidateNote {
  return {
    path: cached.path,
    title: cached.title,
    sourceUrl: cached.sourceUrl,
    domain: cached.domain,
    contentType: cached.contentType,
    entities: [...cached.entities].sort(),
    tags: [...cached.tags].sort(),
    timestamp: cached.timestamp,
    id: cached.id,
  };
}

// =============================================================================
// File Operations
// =============================================================================

/**
 * Get cache file path for a vault
 *
 * @param vaultPath - Vault root path
 * @param fingerprint - Vault fingerprint
 * @returns Absolute path to cache file
 */
export function getCacheFilePath(vaultPath: string, fingerprint: string): string {
  const cacheDir = path.join(vaultPath, CACHE_DIR_NAME);
  return path.join(cacheDir, `${CACHE_FILE_PREFIX}${fingerprint}${CACHE_FILE_EXTENSION}`);
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely delete a file (ignores errors)
 *
 * Used to clean up temp files or corrupted cache files.
 *
 * @param filePath - Path to delete
 */
export async function safeDelete(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Log but don't throw - cache may have been deleted by another process
    console.warn(`[VaultIndexCache] Failed to delete file ${filePath}:`, error);
  }
}

/**
 * Write cache atomically
 *
 * Uses a temp file + rename pattern to ensure atomic writes and
 * prevent partial cache files on failure.
 *
 * @param cacheFilePath - Target cache file path
 * @param cache - Cache snapshot to write
 */
export async function writeCacheAtomically(
  cacheFilePath: string,
  cache: VaultIndexCacheSnapshot
): Promise<void> {
  const tempFilePath = `${cacheFilePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    // 1. Serialize cache deterministically
    const cacheJson = serializeCacheDeterministically(cache);

    // 2. Write to temp file
    await fs.writeFile(tempFilePath, cacheJson, "utf-8");

    // 3. Sync temp file to disk (fsync)
    const fd = await fs.open(tempFilePath, "r");
    await fd.sync();
    await fd.close();

    // 4. Ensure cache directory exists
    const cacheDir = path.dirname(cacheFilePath);
    await fs.mkdir(cacheDir, { recursive: true });

    // 5. Atomic rename (temp → target)
    await fs.rename(tempFilePath, cacheFilePath);
  } catch (error) {
    // 6. On error, clean up temp file
    await safeDelete(tempFilePath);
    throw new Error(
      `${CACHE_ERROR_CODES.CACHE_WRITE_FAILED}: Failed to write cache atomically: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Read cache file
 *
 * @param cacheFilePath - Path to cache file
 * @returns Parsed cache snapshot
 * @throws Error if file doesn't exist or JSON is invalid
 */
export async function readCacheFile(
  cacheFilePath: string
): Promise<VaultIndexCacheSnapshot> {
  try {
    const cacheContent = await fs.readFile(cacheFilePath, "utf-8");
    const cache = JSON.parse(cacheContent) as unknown;
    return cache as VaultIndexCacheSnapshot;
  } catch (error) {
    throw new Error(
      `${CACHE_ERROR_CODES.CACHE_READ_FAILED}: Failed to read cache file ${cacheFilePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// =============================================================================
// Cache Validation
// =============================================================================

/**
 * Check if a version string is compatible with current version
 *
 * Same MAJOR version = compatible. Different MAJOR = incompatible.
 *
 * @param cacheVersion - Version from cache file
 * @param currentVersion - Current contract version
 * @returns True if compatible
 */
export function isVersionCompatible(
  cacheVersion: string,
  currentVersion: string
): boolean {
  const cacheMajor = parseInt(cacheVersion.split(".")[0], 10);
  const currentMajor = parseInt(currentVersion.split(".")[0], 10);

  return cacheMajor === currentMajor;
}

/**
 * Validate cache structure
 *
 * Checks that all required fields are present and have correct types.
 *
 * @param cache - Cache snapshot to validate
 * @returns Validation result
 */
export function validateCacheStructure(
  cache: unknown
): CacheValidationResult {
  const errors: ValidationError[] = [];

  // 1. Check that cache is an object
  if (typeof cache !== "object" || cache === null) {
    return {
      valid: false,
      reason: "cache_invalid_schema",
      errors: [{
        fieldPath: "$",
        expectedType: "object",
        actualValue: cache,
        errorType: "type_mismatch"
      }],
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
    errors.push({
      fieldPath: "version",
      expectedType: "string",
      actualValue: obj.version,
      errorType: "type_mismatch"
    });
  }

  if (typeof obj.vaultPath !== "string") {
    errors.push({
      fieldPath: "vaultPath",
      expectedType: "string",
      actualValue: obj.vaultPath,
      errorType: "type_mismatch"
    });
  }

  if (typeof obj.vaultFingerprint !== "string") {
    errors.push({
      fieldPath: "vaultFingerprint",
      expectedType: "string",
      actualValue: obj.vaultFingerprint,
      errorType: "type_mismatch"
    });
  } else {
    // Validate vaultFingerprint is 16 hex characters
    if (!/^[a-f0-9]{16}$/.test(obj.vaultFingerprint)) {
      errors.push({
        fieldPath: "vaultFingerprint",
        expectedType: "hex16",
        actualValue: obj.vaultFingerprint,
        errorType: "invalid_format"
      });
    }
  }

  // 4. Validate candidates array
  if (!Array.isArray(obj.candidates)) {
    errors.push({
      fieldPath: "candidates",
      expectedType: "array",
      actualValue: obj.candidates,
      errorType: "type_mismatch"
    });
  } else {
    // Validate each candidate
    for (let i = 0; i < obj.candidates.length; i++) {
      const candidate = obj.candidates[i];
      const prefix = `candidates.${i}`;

      if (typeof candidate !== "object" || candidate === null) {
        errors.push({
          fieldPath: prefix,
          expectedType: "object",
          actualValue: candidate,
          errorType: "type_mismatch"
        });
        continue;
      }

      const cand = candidate as Record<string, unknown>;

      if (typeof cand.path !== "string") {
        errors.push({
          fieldPath: `${prefix}.path`,
          expectedType: "string",
          actualValue: cand.path,
          errorType: "type_mismatch"
        });
      }

      if (typeof cand.title !== "string") {
        errors.push({
          fieldPath: `${prefix}.title`,
          expectedType: "string",
          actualValue: cand.title,
          errorType: "type_mismatch"
        });
      }

      if (cand.sourceUrl !== undefined && typeof cand.sourceUrl !== "string") {
        errors.push({
          fieldPath: `${prefix}.sourceUrl`,
          expectedType: "string",
          actualValue: cand.sourceUrl,
          errorType: "type_mismatch"
        });
      }

      if (!Array.isArray(cand.entities)) {
        errors.push({
          fieldPath: `${prefix}.entities`,
          expectedType: "array",
          actualValue: cand.entities,
          errorType: "type_mismatch"
        });
      }

      if (!Array.isArray(cand.tags)) {
        errors.push({
          fieldPath: `${prefix}.tags`,
          expectedType: "array",
          actualValue: cand.tags,
          errorType: "type_mismatch"
        });
      }
    }
  }

  // 5. Validate metadata
  if (typeof obj.metadata !== "object" || obj.metadata === null) {
    errors.push({
      fieldPath: "metadata",
      expectedType: "object",
      actualValue: obj.metadata,
      errorType: "type_mismatch"
    });
  } else {
    const meta = obj.metadata as Record<string, unknown>;

    if (typeof meta.filesScanned !== "number") {
      errors.push({
        fieldPath: "metadata.filesScanned",
        expectedType: "number",
        actualValue: meta.filesScanned,
        errorType: "type_mismatch"
      });
    }

    if (typeof meta.filesWithFrontmatter !== "number") {
      errors.push({
        fieldPath: "metadata.filesWithFrontmatter",
        expectedType: "number",
        actualValue: meta.filesWithFrontmatter,
        errorType: "type_mismatch"
      });
    }

    if (typeof meta.filesSkipped !== "number") {
      errors.push({
        fieldPath: "metadata.filesSkipped",
        expectedType: "number",
        actualValue: meta.filesSkipped,
        errorType: "type_mismatch"
      });
    }

    // Check for negative counts
    if (typeof meta.filesScanned === "number" && meta.filesScanned < 0) {
      errors.push({
        fieldPath: "metadata.filesScanned",
        expectedType: "non-negative number",
        actualValue: meta.filesScanned,
        errorType: "invalid_value"
      });
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

  return { valid: true, errors: [] };
}

// =============================================================================
// Cache Resolution
// =============================================================================

/**
 * Import indexVault function dynamically to avoid circular dependency
 */
async function getIndexVaultFunction(): Promise<(options: VaultIndexOptions) => Promise<VaultIndexResult>> {
  const vaultIndexModule = await import("./vaultIndex");
  return vaultIndexModule.indexVault;
}

/**
 * Normalize file path (resolve to absolute, normalize separators)
 */
function normalizePath(filePath: string): string {
  return path.normalize(filePath);
}

/**
 * Rebuild cache from scratch
 *
 * @param vaultPath - Vault root path
 * @param options - Indexing options
 * @param reason - Rebuild reason for diagnostics
 * @param currentVaultFingerprint - Current vault fingerprint (already computed)
 * @returns Cache result with rebuilt data
 */
async function rebuildCache(
  vaultPath: string,
  options: VaultIndexOptions,
  reason: CacheRebuildReason,
  currentVaultFingerprint?: string
): Promise<VaultIndexCacheResult> {
  try {
    const indexVault = await getIndexVaultFunction();
    const vaultFingerprint = currentVaultFingerprint ?? await computeVaultFingerprint(vaultPath, options);

    // 1. Build new index
    const indexResult = await indexVault(options);

    // 2. Convert to cached format with deterministic sorting
    const candidates: CachedCandidateNote[] = indexResult.candidates
      .map(toCachedCandidateNote)
      .sort((a, b) => {
        // Primary: path ascending
        const pathCmp = a.path.localeCompare(b.path);
        if (pathCmp !== 0) return pathCmp;
        // Secondary: timestamp descending (most recent first)
        return b.timestamp.localeCompare(a.timestamp);
      });

    // 3. Sort errors deterministically
    const sortedErrors: IndexError[] = [...indexResult.errors].sort((a, b) => {
      const filePathCmp = a.filePath.localeCompare(b.filePath);
      if (filePathCmp !== 0) return filePathCmp;
      return a.error.localeCompare(b.error);
    });

    const metadata: VaultIndexMetadata = {
      filesScanned: indexResult.filesScanned,
      filesWithFrontmatter: indexResult.filesWithFrontmatter,
      filesSkipped: indexResult.filesSkipped,
      errors: sortedErrors,
    };

    // 4. Build cache snapshot
    const now = new Date().toISOString();
    const normalizedVaultPath = normalizePath(vaultPath);

    const cacheSnapshot: VaultIndexCacheSnapshot = {
      version: VAULT_INDEX_CACHE_VERSION,
      vaultPath: normalizedVaultPath,
      vaultFingerprint,
      createdAt: now,
      lastValidatedAt: now,
      options,
      candidates,
      metadata,
      diagnostics: {
        cacheHit: false,
        cacheAgeMs: 0,
        cacheRebuilt: true,
        rebuildReason: reason,
        vaultFilesFingerprinted: indexResult.filesScanned,
      },
    };

    // 5. Write cache atomically
    const cacheFilePath = getCacheFilePath(vaultPath, vaultFingerprint);
    await writeCacheAtomically(cacheFilePath, cacheSnapshot);

    // 6. Return result
    return {
      status: "miss",
      candidates,
      metadata,
      diagnostics: cacheSnapshot.diagnostics,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[VaultIndexCache] Failed to rebuild cache:", error);
    return {
      status: "error",
      candidates: [],
      metadata: {
        filesScanned: 0,
        filesWithFrontmatter: 0,
        filesSkipped: 0,
        errors: [],
      },
      diagnostics: {
        cacheHit: false,
        cacheAgeMs: 0,
        cacheRebuilt: false,
        rebuildReason: undefined,
        vaultFilesFingerprinted: 0,
      },
      error: {
        message: errorMessage,
        code: CACHE_ERROR_CODES.INDEX_VAULT_FAILED,
        originalError: error,
      },
    };
  }
}

/**
 * Update cache validation timestamp (async, non-blocking)
 *
 * Updates the lastValidatedAt field in the cache file to track
 * when the cache was last used. This is best-effort telemetry.
 *
 * @param cacheFilePath - Path to cache file
 */
async function updateCacheValidationTimestamp(cacheFilePath: string): Promise<void> {
  try {
    const cache = await readCacheFile(cacheFilePath);
    cache.lastValidatedAt = new Date().toISOString();
    await writeCacheAtomically(cacheFilePath, cache);
  } catch (error) {
    // Silently ignore errors - this is best-effort telemetry
    console.warn("[VaultIndexCache] Failed to update validation timestamp:", error);
  }
}

/**
 * Resolve vault index cache
 *
 * Main entry point for cache resolution. Attempts to load and validate
 * cached index data, falling back to a full rebuild if the cache is
 * missing, invalid, or corrupted.
 *
 * @param vaultPath - Vault root path
 * @param options - Indexing options
 * @returns Cache resolution result
 *
 * @example
 * ```ts
 * const result = await resolveVaultIndexCache("/path/to/vault", {
 *   vaultPath: "/path/to/vault",
 *   includeHidden: false,
 * });
 *
 * if (result.status === "hit") {
 *   console.log(`Cache hit! Age: ${result.diagnostics.cacheAgeMs}ms`);
 * } else if (result.status === "miss") {
 *   console.log(`Cache miss. Rebuilt reason: ${result.diagnostics.rebuildReason}`);
 * }
 * ```
 */
export async function resolveVaultIndexCache(
  vaultPath: string,
  options: VaultIndexOptions
): Promise<VaultIndexCacheResult> {
  // 1. Compute current vault fingerprint
  const currentVaultFingerprint = await computeVaultFingerprint(vaultPath, options);

  // 2. Compute current options fingerprint
  const currentOptionsFingerprint = computeOptionsFingerprint(options);

  // 3. Locate cache file
  const cacheFilePath = getCacheFilePath(vaultPath, currentVaultFingerprint);

  // 4. Check if cache file exists
  const cacheExists = await fileExists(cacheFilePath);
  if (!cacheExists) {
    return await rebuildCache(vaultPath, options, "cache_file_not_found", currentVaultFingerprint);
  }

  // 5. Load and parse cache
  let cache: VaultIndexCacheSnapshot;
  try {
    cache = await readCacheFile(cacheFilePath);
  } catch (error) {
    // JSON parse failed or read error
    await safeDelete(cacheFilePath);
    return await rebuildCache(vaultPath, options, "cache_corrupted", currentVaultFingerprint);
  }

  // 6. Validate cache structure
  const validationResult = validateCacheStructure(cache);
  if (!validationResult.valid) {
    await safeDelete(cacheFilePath);
    return await rebuildCache(
      vaultPath,
      options,
      validationResult.reason ?? "cache_invalid_schema",
      currentVaultFingerprint
    );
  }

  // 7. Check version compatibility
  if (!isVersionCompatible(cache.version, VAULT_INDEX_CACHE_VERSION)) {
    await safeDelete(cacheFilePath);
    return await rebuildCache(vaultPath, options, "cache_version_mismatch", currentVaultFingerprint);
  }

  // 8. Check vault path match
  const normalizedVaultPath = normalizePath(vaultPath);
  if (cache.vaultPath !== normalizedVaultPath) {
    await safeDelete(cacheFilePath);
    return await rebuildCache(vaultPath, options, "vault_path_mismatch", currentVaultFingerprint);
  }

  // 9. Check vault fingerprint match
  if (cache.vaultFingerprint !== currentVaultFingerprint) {
    await safeDelete(cacheFilePath);
    return await rebuildCache(vaultPath, options, "vault_fingerprint_changed", currentVaultFingerprint);
  }

  // 10. Check options fingerprint match
  const cachedOptionsFingerprint = computeOptionsFingerprint(cache.options);
  if (cachedOptionsFingerprint !== currentOptionsFingerprint) {
    await safeDelete(cacheFilePath);
    return await rebuildCache(vaultPath, options, "indexing_options_changed", currentVaultFingerprint);
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
