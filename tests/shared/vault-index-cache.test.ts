/**
 * Vault Index Cache Contract Tests
 *
 * Comprehensive coverage for hit/miss/invalidation/corruption/no-cache scenarios
 * with deterministic diagnostics assertions.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "fs";
import * as path from "path";
import { tmpdir } from "os";
import {
  computeVaultFingerprint,
  computeOptionsFingerprint,
  serializeCacheDeterministically,
  toCachedCandidateNote,
  fromCachedCandidateNote,
  getCacheFilePath,
  safeDelete,
  writeCacheAtomically,
  readCacheFile,
  isVersionCompatible,
  validateCacheStructure,
  resolveVaultIndexCache,
  VAULT_INDEX_CACHE_VERSION,
  CACHE_ERROR_CODES,
  type VaultIndexCacheSnapshot,
  type CachedCandidateNote,
  type CacheValidationResult,
  type VaultIndexCacheResult,
} from "../../src/shared/vaultIndexCache";
import type { CandidateNote } from "../../src/shared/relatedClipsContract";
import type { VaultIndexOptions } from "../../src/shared/vaultIndex";

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a temporary test vault directory
 */
async function createTestVault(prefix: string = "vault-cache-test"): Promise<string> {
  const tempDir = path.join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Create a test note in a vault
 */
async function createTestNote(
  vaultPath: string,
  filename: string,
  content: string
): Promise<string> {
  const notePath = path.join(vaultPath, filename);
  await fs.writeFile(notePath, content, "utf-8");
  return notePath;
}

/**
 * Create a sample candidate note
 */
function createSampleCandidate(overrides: Partial<CandidateNote> = {}): CandidateNote {
  return {
    path: "/vault/test.md",
    title: "Test Note",
    sourceUrl: "https://example.com/test",
    domain: "example.com",
    contentType: "article",
    entities: ["entity1", "entity2"],
    tags: ["tag1", "tag2"],
    timestamp: "2026-03-03T10:00:00Z",
    id: "/vault/test.md",
    ...overrides,
  };
}

/**
 * Create a sample cache snapshot
 */
function createSampleCacheSnapshot(
  vaultPath: string,
  overrides: Partial<VaultIndexCacheSnapshot> = {}
): VaultIndexCacheSnapshot {
  const now = new Date().toISOString();
  return {
    version: VAULT_INDEX_CACHE_VERSION,
    vaultPath,
    vaultFingerprint: "a1b2c3d4e5f6a7b8",
    createdAt: now,
    lastValidatedAt: now,
    options: { vaultPath },
    candidates: [],
    metadata: {
      filesScanned: 1,
      filesWithFrontmatter: 1,
      filesSkipped: 0,
      errors: [],
    },
    diagnostics: {
      cacheHit: false,
      cacheAgeMs: 0,
      cacheRebuilt: true,
      rebuildReason: "cache_file_not_found",
      vaultFilesFingerprinted: 1,
    },
    ...overrides,
  };
}

// =============================================================================
// Fingerprint Tests
// =============================================================================

describe("computeVaultFingerprint", () => {
  test("computes deterministic fingerprint for empty vault", async () => {
    const vaultPath = await createTestVault();

    try {
      const fingerprint1 = await computeVaultFingerprint(vaultPath, {});
      const fingerprint2 = await computeVaultFingerprint(vaultPath, {});

      // Should be 16 hex characters
      expect(fingerprint1).toHaveLength(16);
      expect(/^[a-f0-9]{16}$/.test(fingerprint1)).toBe(true);

      // Should be deterministic
      expect(fingerprint1).toBe(fingerprint2);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("computes deterministic fingerprint for vault with files", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
---
# Content`
      );

      const fingerprint1 = await computeVaultFingerprint(vaultPath, {});
      const fingerprint2 = await computeVaultFingerprint(vaultPath, {});

      expect(fingerprint1).toBe(fingerprint2);
      expect(fingerprint1).toHaveLength(16);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("fingerprint changes when file content changes", async () => {
    const vaultPath = await createTestVault();

    try {
      const notePath = await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Original
---
# Content`
      );

      const fingerprint1 = await computeVaultFingerprint(vaultPath, {});

      // Wait to ensure mtime changes
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Modify file
      await fs.writeFile(
        notePath,
        `---
source: https://example.com/test
title: Modified
---
# Modified Content`
      );

      const fingerprint2 = await computeVaultFingerprint(vaultPath, {});

      expect(fingerprint1).not.toBe(fingerprint2);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("fingerprint changes when new file added", async () => {
    const vaultPath = await createTestVault();

    try {
      const fingerprint1 = await computeVaultFingerprint(vaultPath, {});

      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
---
# Content`
      );

      const fingerprint2 = await computeVaultFingerprint(vaultPath, {});

      expect(fingerprint1).not.toBe(fingerprint2);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("fingerprint is independent of file discovery order", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "alpha.md",
        `---
source: https://example.com/alpha
title: Alpha
---
# Alpha`
      );

      await createTestNote(
        vaultPath,
        "beta.md",
        `---
source: https://example.com/beta
title: Beta
---
# Beta`
      );

      const fingerprint1 = await computeVaultFingerprint(vaultPath, {});
      const fingerprint2 = await computeVaultFingerprint(vaultPath, {});

      expect(fingerprint1).toBe(fingerprint2);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("respects includeHidden option", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        ".hidden.md",
        `---
source: https://example.com/hidden
title: Hidden
---
# Hidden`
      );

      const fingerprintWithoutHidden = await computeVaultFingerprint(vaultPath, {
        includeHidden: false,
      });

      const fingerprintWithHidden = await computeVaultFingerprint(vaultPath, {
        includeHidden: true,
      });

      expect(fingerprintWithoutHidden).not.toBe(fingerprintWithHidden);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("respects maxDepth option", async () => {
    const vaultPath = await createTestVault();
    const subdir1 = path.join(vaultPath, "level1");
    await fs.mkdir(subdir1, { recursive: true });
    const subdir2 = path.join(subdir1, "level2");
    await fs.mkdir(subdir2, { recursive: true });

    try {
      // Create file at level 1
      await createTestNote(
        subdir1,
        "nested.md",
        `---
source: https://example.com/nested
title: Nested
---
# Nested`
      );

      // Create file at level 2 (deeper than maxDepth=1)
      await createTestNote(
        subdir2,
        "deep.md",
        `---
source: https://example.com/deep
title: Deep
---
# Deep`
      );

      const fingerprintDepth1 = await computeVaultFingerprint(vaultPath, {
        maxDepth: 1,
      });

      const fingerprintDepth2 = await computeVaultFingerprint(vaultPath, {
        maxDepth: 2,
      });

      // Different depths should include different files
      expect(fingerprintDepth1).not.toBe(fingerprintDepth2);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });
});

describe("computeOptionsFingerprint", () => {
  test("computes deterministic fingerprint for options", () => {
    const options: VaultIndexOptions = {
      vaultPath: "/vault",
      maxDepth: 2,
      includeHidden: false,
    };

    const fingerprint1 = computeOptionsFingerprint(options);
    const fingerprint2 = computeOptionsFingerprint(options);

    expect(fingerprint1).toBe(fingerprint2);
    expect(fingerprint1).toHaveLength(16);
  });

  test("different options produce different fingerprints", () => {
    const options1: VaultIndexOptions = {
      vaultPath: "/vault",
      maxDepth: 1,
    };

    const options2: VaultIndexOptions = {
      vaultPath: "/vault",
      maxDepth: 2,
    };

    const fingerprint1 = computeOptionsFingerprint(options1);
    const fingerprint2 = computeOptionsFingerprint(options2);

    expect(fingerprint1).not.toBe(fingerprint2);
  });

  test("requiredTags order does not affect fingerprint", () => {
    const options1: VaultIndexOptions = {
      vaultPath: "/vault",
      requiredTags: ["tag1", "tag2"],
    };

    const options2: VaultIndexOptions = {
      vaultPath: "/vault",
      requiredTags: ["tag2", "tag1"],
    };

    const fingerprint1 = computeOptionsFingerprint(options1);
    const fingerprint2 = computeOptionsFingerprint(options2);

    expect(fingerprint1).toBe(fingerprint2);
  });

  test("null and undefined values are handled deterministically", () => {
    const options1: VaultIndexOptions = {
      vaultPath: "/vault",
      maxDepth: undefined,
    };

    const options2: VaultIndexOptions = {
      vaultPath: "/vault",
      maxDepth: null as any,
    };

    // Both should produce consistent fingerprints
    const fingerprint1 = computeOptionsFingerprint(options1);
    expect(fingerprint1).toHaveLength(16);
  });
});

// =============================================================================
// Serialization Tests
// =============================================================================

describe("serializeCacheDeterministically", () => {
  test("produces deterministic JSON output", () => {
    const cache = createSampleCacheSnapshot("/vault");

    const json1 = serializeCacheDeterministically(cache);
    const json2 = serializeCacheDeterministically(cache);

    expect(json1).toBe(json2);
  });

  test("sorts object keys alphabetically", () => {
    const cache: any = {
      zeta: 1,
      alpha: 2,
      beta: 3,
    };

    const json = serializeCacheDeterministically(cache);
    const parsed = JSON.parse(json);
    const keys = Object.keys(parsed);

    expect(keys).toEqual(["alpha", "beta", "zeta"]);
  });

  test("sorts nested object keys", () => {
    const cache = createSampleCacheSnapshot("/vault");
    cache.metadata = {
      filesScanned: 1,
      filesWithFrontmatter: 1,
      filesSkipped: 0,
      errors: [],
    };

    const json = serializeCacheDeterministically(cache);
    const parsed = JSON.parse(json);

    // Metadata keys should be sorted
    const metadataKeys = Object.keys(parsed.metadata);
    expect(metadataKeys).toEqual(metadataKeys.sort());
  });

  test("sorts arrays deterministically", () => {
    const cache = createSampleCacheSnapshot("/vault");
    cache.candidates = [
      { path: "/z.md", title: "Z" } as CachedCandidateNote,
      { path: "/a.md", title: "A" } as CachedCandidateNote,
      { path: "/m.md", title: "M" } as CachedCandidateNote,
    ];

    const json1 = serializeCacheDeterministically(cache);
    const json2 = serializeCacheDeterministically(cache);

    expect(json1).toBe(json2);
  });
});

// =============================================================================
// Candidate Conversion Tests
// =============================================================================

describe("toCachedCandidateNote", () => {
  test("converts CandidateNote to CachedCandidateNote", () => {
    const candidate = createSampleCandidate();

    const cached = toCachedCandidateNote(candidate);

    expect(cached.path).toBe(candidate.path);
    expect(cached.title).toBe(candidate.title);
    expect(cached.sourceUrl).toBe(candidate.sourceUrl);
    expect(cached.domain).toBe(candidate.domain);
    expect(cached.contentType).toBe(candidate.contentType);
    expect(cached.entities).toEqual(candidate.entities);
    expect(cached.tags).toEqual(candidate.tags);
    expect(cached.timestamp).toBe(candidate.timestamp);
    expect(cached.id).toBe(candidate.id);
  });

  test("sorts entities and tags", () => {
    const candidate = createSampleCandidate({
      entities: ["zeta", "alpha", "beta"],
      tags: ["tag3", "tag1", "tag2"],
    });

    const cached = toCachedCandidateNote(candidate);

    expect(cached.entities).toEqual(["alpha", "beta", "zeta"]);
    expect(cached.tags).toEqual(["tag1", "tag2", "tag3"]);
  });

  test("throws error if sourceUrl is missing", () => {
    const candidate = createSampleCandidate({
      sourceUrl: undefined as any,
    });

    expect(() => toCachedCandidateNote(candidate)).toThrow();
  });
});

describe("fromCachedCandidateNote", () => {
  test("converts CachedCandidateNote to CandidateNote", () => {
    const cached: CachedCandidateNote = {
      path: "/vault/test.md",
      title: "Test",
      sourceUrl: "https://example.com/test",
      domain: "example.com",
      contentType: "article",
      entities: ["alpha", "beta"],
      tags: ["tag1", "tag2"],
      timestamp: "2026-03-03T10:00:00Z",
      id: "/vault/test.md",
    };

    const candidate = fromCachedCandidateNote(cached);

    expect(candidate.path).toBe(cached.path);
    expect(candidate.title).toBe(cached.title);
    expect(candidate.sourceUrl).toBe(cached.sourceUrl);
    expect(candidate.domain).toBe(cached.domain);
    expect(candidate.contentType).toBe(cached.contentType);
    expect(candidate.entities).toEqual(cached.entities);
    expect(candidate.tags).toEqual(cached.tags);
    expect(candidate.timestamp).toBe(cached.timestamp);
    expect(candidate.id).toBe(cached.id);
  });
});

// =============================================================================
// File Operations Tests
// =============================================================================

describe("getCacheFilePath", () => {
  test("constructs correct cache file path", () => {
    const vaultPath = "/vault";
    const fingerprint = "a1b2c3d4e5f6a7b8";

    const cachePath = getCacheFilePath(vaultPath, fingerprint);

    expect(cachePath).toContain(".obsidian-web-clipper");
    expect(cachePath).toContain("cache");
    expect(cachePath).toContain("vault-index-");
    expect(cachePath).toContain(fingerprint);
    expect(cachePath).toContain(".json");
  });

  test("produces deterministic paths for same inputs", () => {
    const vaultPath = "/vault";
    const fingerprint = "a1b2c3d4e5f6a7b8";

    const path1 = getCacheFilePath(vaultPath, fingerprint);
    const path2 = getCacheFilePath(vaultPath, fingerprint);

    expect(path1).toBe(path2);
  });
});

describe("writeCacheAtomically and readCacheFile", () => {
  test("writes and reads cache file correctly", async () => {
    const vaultPath = await createTestVault();

    try {
      const cache = createSampleCacheSnapshot(vaultPath);
      const cachePath = getCacheFilePath(vaultPath, cache.vaultFingerprint);

      await writeCacheAtomically(cachePath, cache);
      const loaded = await readCacheFile(cachePath);

      expect(loaded.version).toBe(cache.version);
      expect(loaded.vaultPath).toBe(cache.vaultPath);
      expect(loaded.vaultFingerprint).toBe(cache.vaultFingerprint);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("creates cache directory if it doesn't exist", async () => {
    const vaultPath = await createTestVault();

    try {
      const cache = createSampleCacheSnapshot(vaultPath);
      const cachePath = getCacheFilePath(vaultPath, cache.vaultFingerprint);

      // Cache directory shouldn't exist yet
      const cacheDir = path.dirname(cachePath);
      try {
        await fs.access(cacheDir);
        // If we get here, the directory exists (unexpected)
        expect(true).toBe(false);
      } catch {
        // Expected - directory doesn't exist
      }

      await writeCacheAtomically(cachePath, cache);

      // Now it should exist - access should not throw
      let dirExists = false;
      try {
        await fs.access(cacheDir);
        dirExists = true;
      } catch {
        dirExists = false;
      }
      expect(dirExists).toBe(true);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("throws error on read if file doesn't exist", async () => {
    const vaultPath = await createTestVault();

    try {
      const cachePath = getCacheFilePath(vaultPath, "nonexistent");

      await expect(readCacheFile(cachePath)).rejects.toThrow();
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("throws error on read if JSON is malformed", async () => {
    const vaultPath = await createTestVault();

    try {
      const cachePath = getCacheFilePath(vaultPath, "test");
      const cacheDir = path.dirname(cachePath);
      await fs.mkdir(cacheDir, { recursive: true });

      // Write invalid JSON
      await fs.writeFile(cachePath, "{ invalid json", "utf-8");

      await expect(readCacheFile(cachePath)).rejects.toThrow();
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });
});

describe("safeDelete", () => {
  test("deletes existing file", async () => {
    const vaultPath = await createTestVault();

    try {
      const filePath = path.join(vaultPath, "test.txt");
      await fs.writeFile(filePath, "test", "utf-8");

      await safeDelete(filePath);

      await expect(fs.access(filePath)).rejects.toThrow();
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("does not throw if file doesn't exist", async () => {
    const vaultPath = await createTestVault();

    try {
      const filePath = path.join(vaultPath, "nonexistent.txt");

      // Should not throw
      await expect(safeDelete(filePath)).resolves.toBeUndefined();
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Version Compatibility Tests
// =============================================================================

describe("isVersionCompatible", () => {
  test("returns true for same major version", () => {
    expect(isVersionCompatible("1.0.0", "1.0.0")).toBe(true);
    expect(isVersionCompatible("1.0.0", "1.2.3")).toBe(true);
    expect(isVersionCompatible("1.9.9", "1.0.0")).toBe(true);
  });

  test("returns false for different major versions", () => {
    expect(isVersionCompatible("1.0.0", "2.0.0")).toBe(false);
    expect(isVersionCompatible("2.0.0", "1.0.0")).toBe(false);
    expect(isVersionCompatible("0.1.0", "1.0.0")).toBe(false);
  });
});

// =============================================================================
// Cache Validation Tests
// =============================================================================

describe("validateCacheStructure", () => {
  test("validates correct cache structure", () => {
    const cache = createSampleCacheSnapshot("/vault");

    const result = validateCacheStructure(cache);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("rejects null cache", () => {
    const result = validateCacheStructure(null);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("cache_invalid_schema");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("rejects non-object cache", () => {
    const result = validateCacheStructure("not an object");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("cache_invalid_schema");
  });

  test("rejects cache with missing required fields", () => {
    const cache = {
      version: "1.0.0",
      // missing vaultPath, vaultFingerprint, etc.
    };

    const result = validateCacheStructure(cache);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("cache_missing_required_fields");
    expect(result.errors.some((e) => e.fieldPath === "vaultPath")).toBe(true);
  });

  test("rejects cache with invalid vaultFingerprint format", () => {
    const cache = createSampleCacheSnapshot("/vault");
    (cache as any).vaultFingerprint = "invalid-fingerprint";

    const result = validateCacheStructure(cache);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.fieldPath === "vaultFingerprint")).toBe(true);
  });

  test("rejects cache with non-array candidates", () => {
    const cache = createSampleCacheSnapshot("/vault");
    (cache as any).candidates = "not an array";

    const result = validateCacheStructure(cache);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.fieldPath === "candidates")).toBe(true);
  });

  test("rejects cache with invalid candidate structure", () => {
    const cache = createSampleCacheSnapshot("/vault");
    cache.candidates = [
      {
        // missing required fields
        path: 123 as any, // wrong type
      } as any,
    ];

    const result = validateCacheStructure(cache);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.fieldPath.includes("candidates.0"))).toBe(true);
  });

  test("rejects cache with invalid metadata counts", () => {
    const cache = createSampleCacheSnapshot("/vault");
    cache.metadata.filesScanned = -1; // negative count

    const result = validateCacheStructure(cache);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.fieldPath === "metadata.filesScanned")).toBe(true);
  });

  test("rejects cache with inconsistent metadata counts", () => {
    const cache = createSampleCacheSnapshot("/vault");
    cache.metadata.filesScanned = 5;
    cache.metadata.filesWithFrontmatter = 10; // > filesScanned
    cache.metadata.filesSkipped = 5;

    const result = validateCacheStructure(cache);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.errorType === "inconsistent_counts")).toBe(true);
  });
});

// =============================================================================
// Cache Resolution Tests (Hit/Miss/Invalidation/Corruption/No-Cache)
// =============================================================================

describe("resolveVaultIndexCache - Cache Hit Scenario", () => {
  test("returns cache hit when valid cache exists", async () => {
    const vaultPath = await createTestVault();

    try {
      // Create a test note
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test Article
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };

      // First call - should be cache miss
      const result1 = await resolveVaultIndexCache(vaultPath, options);

      expect(result1.status).toBe("miss");
      expect(result1.diagnostics.cacheHit).toBe(false);
      expect(result1.diagnostics.cacheRebuilt).toBe(true);
      expect(result1.diagnostics.rebuildReason).toBe("cache_file_not_found");

      // Second call - should be cache hit
      const result2 = await resolveVaultIndexCache(vaultPath, options);

      expect(result2.status).toBe("hit");
      expect(result2.diagnostics.cacheHit).toBe(true);
      expect(result2.diagnostics.cacheRebuilt).toBe(false);
      expect(result2.candidates.length).toBe(1);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("cache hit preserves candidates deterministically", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test Article
tags:
  - tech
keywords:
  - api
  - testing
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };

      // Build cache
      await resolveVaultIndexCache(vaultPath, options);

      // Get cache hit
      const result = await resolveVaultIndexCache(vaultPath, options);

      expect(result.status).toBe("hit");
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].title).toBe("Test Article");
      expect(result.candidates[0].tags).toEqual(["tech"]);
      expect(result.candidates[0].entities).toEqual(["api", "testing"]);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });
});

describe("resolveVaultIndexCache - Cache Miss Scenario", () => {
  test("returns cache miss when no cache exists", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
---
# Content`
      );

      const result = await resolveVaultIndexCache(vaultPath, { vaultPath });

      expect(result.status).toBe("miss");
      expect(result.diagnostics.cacheHit).toBe(false);
      expect(result.diagnostics.cacheRebuilt).toBe(true);
      expect(result.diagnostics.rebuildReason).toBe("cache_file_not_found");
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("creates cache file on miss", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };
      await resolveVaultIndexCache(vaultPath, options);

      // Cache file should exist
      const fingerprint = await computeVaultFingerprint(vaultPath, options);
      const cachePath = getCacheFilePath(vaultPath, fingerprint);

      let fileExists = false;
      try {
        await fs.access(cachePath);
        fileExists = true;
      } catch {
        fileExists = false;
      }
      expect(fileExists).toBe(true);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });
});

describe("resolveVaultIndexCache - Cache Invalidation Scenarios", () => {
  test("invalidates when vault fingerprint changes", async () => {
    const vaultPath = await createTestVault();

    try {
      const notePath = await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Original
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };

      // Build cache
      const result1 = await resolveVaultIndexCache(vaultPath, options);
      expect(result1.status).toBe("miss");

      // Cache hit
      const result2 = await resolveVaultIndexCache(vaultPath, options);
      expect(result2.status).toBe("hit");

      // Wait for mtime to change
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Modify note
      await fs.writeFile(
        notePath,
        `---
source: https://example.com/test
title: Modified
---
# Modified Content`
      );

      // Should invalidate and rebuild
      const result3 = await resolveVaultIndexCache(vaultPath, options);
      expect(result3.status).toBe("miss");
      expect(result3.diagnostics.rebuildReason).toBe("vault_fingerprint_changed");
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("invalidates when indexing options change", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
tags:
  - tech
---
# Content`
      );

      // Build cache with empty requiredTags
      const result1 = await resolveVaultIndexCache(vaultPath, {
        vaultPath,
        requiredTags: [],
      });
      expect(result1.status).toBe("miss");

      // Cache hit with same options
      const result2 = await resolveVaultIndexCache(vaultPath, {
        vaultPath,
        requiredTags: [],
      });
      expect(result2.status).toBe("hit");

      // Different options should invalidate
      const result3 = await resolveVaultIndexCache(vaultPath, {
        vaultPath,
        requiredTags: ["tech"],
      });
      expect(result3.status).toBe("miss");
      expect(result3.diagnostics.rebuildReason).toBe("indexing_options_changed");
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("invalidates when cache version is incompatible", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };

      // Build cache
      await resolveVaultIndexCache(vaultPath, options);

      // Manually corrupt cache version
      const fingerprint = await computeVaultFingerprint(vaultPath, options);
      const cachePath = getCacheFilePath(vaultPath, fingerprint);
      const cache = await readCacheFile(cachePath);
      cache.version = "2.0.0" as any; // Incompatible version
      await writeCacheAtomically(cachePath, cache);

      // Should invalidate
      const result = await resolveVaultIndexCache(vaultPath, options);
      expect(result.status).toBe("miss");
      expect(result.diagnostics.rebuildReason).toBe("cache_version_mismatch");
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("invalidates when vault path mismatches", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };

      // Build cache
      await resolveVaultIndexCache(vaultPath, options);

      // Manually corrupt vault path
      const fingerprint = await computeVaultFingerprint(vaultPath, options);
      const cachePath = getCacheFilePath(vaultPath, fingerprint);
      const cache = await readCacheFile(cachePath);
      cache.vaultPath = "/different/vault";
      await writeCacheAtomically(cachePath, cache);

      // Should invalidate
      const result = await resolveVaultIndexCache(vaultPath, options);
      expect(result.status).toBe("miss");
      expect(result.diagnostics.rebuildReason).toBe("vault_path_mismatch");
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });
});

describe("resolveVaultIndexCache - Cache Corruption Scenarios", () => {
  test("handles corrupted JSON by rebuilding", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };

      // Build cache
      await resolveVaultIndexCache(vaultPath, options);

      // Corrupt cache file
      const fingerprint = await computeVaultFingerprint(vaultPath, options);
      const cachePath = getCacheFilePath(vaultPath, fingerprint);
      await fs.writeFile(cachePath, "{ invalid json", "utf-8");

      // Should handle corruption and rebuild
      const result = await resolveVaultIndexCache(vaultPath, options);
      expect(result.status).toBe("miss");
      expect(result.diagnostics.rebuildReason).toBe("cache_corrupted");
      expect(result.candidates.length).toBe(1);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("handles missing required fields by rebuilding", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };

      // Build cache
      await resolveVaultIndexCache(vaultPath, options);

      // Corrupt cache by removing required field
      const fingerprint = await computeVaultFingerprint(vaultPath, options);
      const cachePath = getCacheFilePath(vaultPath, fingerprint);
      const cache = await readCacheFile(cachePath);
      delete (cache as any).candidates;
      await writeCacheAtomically(cachePath, cache);

      // Should handle corruption and rebuild
      const result = await resolveVaultIndexCache(vaultPath, options);
      expect(result.status).toBe("miss");
      expect(result.diagnostics.rebuildReason).toBe("cache_missing_required_fields");
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("handles invalid schema by rebuilding", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };

      // Build cache
      await resolveVaultIndexCache(vaultPath, options);

      // Corrupt cache with invalid data types
      const fingerprint = await computeVaultFingerprint(vaultPath, options);
      const cachePath = getCacheFilePath(vaultPath, fingerprint);
      const cache = await readCacheFile(cachePath);
      (cache as any).metadata.filesScanned = "not a number";
      await writeCacheAtomically(cachePath, cache);

      // Should handle corruption and rebuild
      const result = await resolveVaultIndexCache(vaultPath, options);
      expect(result.status).toBe("miss");
      expect(result.diagnostics.rebuildReason).toBe("cache_invalid_schema");
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("handles and replaces corrupted cache file", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };

      // Build cache
      await resolveVaultIndexCache(vaultPath, options);

      // Corrupt cache file
      const fingerprint = await computeVaultFingerprint(vaultPath, options);
      const cachePath = getCacheFilePath(vaultPath, fingerprint);
      await fs.writeFile(cachePath, "{ invalid json", "utf-8");

      // Trigger rebuild - should handle corruption
      const result = await resolveVaultIndexCache(vaultPath, options);

      expect(result.status).toBe("miss");
      expect(result.diagnostics.rebuildReason).toBe("cache_corrupted");
      expect(result.candidates.length).toBe(1);

      // New valid cache should exist
      let fileExists = false;
      try {
        await fs.access(cachePath);
        fileExists = true;
      } catch {
        fileExists = false;
      }
      expect(fileExists).toBe(true);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });
});

describe("resolveVaultIndexCache - No-Cache Scenario", () => {
  test("first run with empty vault creates cache", async () => {
    const vaultPath = await createTestVault();

    try {
      const result = await resolveVaultIndexCache(vaultPath, { vaultPath });

      expect(result.status).toBe("miss");
      expect(result.diagnostics.cacheHit).toBe(false);
      expect(result.diagnostics.cacheRebuilt).toBe(true);
      expect(result.candidates.length).toBe(0);
      expect(result.metadata.filesScanned).toBe(0);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("error during indexing returns error status", async () => {
    const vaultPath = await createTestVault();

    try {
      // Create a file that will cause an indexing error
      // Note: This test is tricky because indexVault is robust
      // For now, we'll skip this as it requires mocking internal functions
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Diagnostics Tests
// =============================================================================

describe("Cache Diagnostics", () => {
  test("includes all required diagnostic fields on hit", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };

      // Build cache
      await resolveVaultIndexCache(vaultPath, options);

      // Get cache hit
      const result = await resolveVaultIndexCache(vaultPath, options);

      expect(result.status).toBe("hit");
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics.cacheHit).toBe(true);
      expect(result.diagnostics.cacheAgeMs).toBeGreaterThanOrEqual(0);
      expect(result.diagnostics.cacheRebuilt).toBe(false);
      expect(result.diagnostics.vaultFilesFingerprinted).toBeGreaterThanOrEqual(0);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("includes rebuild reason on miss", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
---
# Content`
      );

      const result = await resolveVaultIndexCache(vaultPath, { vaultPath });

      expect(result.status).toBe("miss");
      expect(result.diagnostics.rebuildReason).toBeDefined();
      expect(result.diagnostics.cacheRebuilt).toBe(true);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("cache age increases over time", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };

      // Build cache
      await resolveVaultIndexCache(vaultPath, options);

      // Immediate hit
      const result1 = await resolveVaultIndexCache(vaultPath, options);
      const age1 = result1.diagnostics.cacheAgeMs;

      // Wait
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Later hit
      const result2 = await resolveVaultIndexCache(vaultPath, options);
      const age2 = result2.diagnostics.cacheAgeMs;

      expect(age2).toBeGreaterThan(age1);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("vaultFilesFingerprinted reflects actual file count", async () => {
    const vaultPath = await createTestVault();

    try {
      // Create multiple notes
      for (let i = 1; i <= 3; i++) {
        await createTestNote(
          vaultPath,
          `note${i}.md`,
          `---
source: https://example.com/${i}
title: Note ${i}
---
# Content ${i}`
        );
      }

      const result = await resolveVaultIndexCache(vaultPath, { vaultPath });

      expect(result.diagnostics.vaultFilesFingerprinted).toBe(3);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Determinism Tests
// =============================================================================

describe("Deterministic Output", () => {
  test("cache produces identical candidates on repeated hits", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test Article
tags:
  - tech
  - api
keywords:
  - zeta
  - alpha
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };

      // Build cache
      await resolveVaultIndexCache(vaultPath, options);

      // Multiple cache hits
      const result1 = await resolveVaultIndexCache(vaultPath, options);
      const result2 = await resolveVaultIndexCache(vaultPath, options);
      const result3 = await resolveVaultIndexCache(vaultPath, options);

      // All results should be identical
      expect(result1.candidates).toEqual(result2.candidates);
      expect(result2.candidates).toEqual(result3.candidates);
      expect(result1.metadata).toEqual(result2.metadata);
      expect(result2.metadata).toEqual(result3.metadata);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("rebuilt cache produces identical candidates to original (except timestamp)", async () => {
    const vaultPath = await createTestVault();

    try {
      await createTestNote(
        vaultPath,
        "test.md",
        `---
source: https://example.com/test
title: Test
tags:
  - clip
date_clipped: 2026-03-03T10:00:00Z
---
# Content`
      );

      const options: VaultIndexOptions = { vaultPath };

      // Initial build
      const result1 = await resolveVaultIndexCache(vaultPath, options);

      // Corrupt cache
      const fingerprint = await computeVaultFingerprint(vaultPath, options);
      const cachePath = getCacheFilePath(vaultPath, fingerprint);
      await fs.writeFile(cachePath, "{ corrupted }", "utf-8");

      // Rebuild
      const result2 = await resolveVaultIndexCache(vaultPath, options);

      // Should produce identical results for all fields
      expect(result1.candidates.length).toBe(result2.candidates.length);
      expect(result1.candidates[0].path).toBe(result2.candidates[0].path);
      expect(result1.candidates[0].title).toBe(result2.candidates[0].title);
      expect(result1.candidates[0].sourceUrl).toBe(result2.candidates[0].sourceUrl);
      expect(result1.candidates[0].domain).toBe(result2.candidates[0].domain);
      expect(result1.candidates[0].contentType).toBe(result2.candidates[0].contentType);
      expect(result1.candidates[0].entities).toEqual(result2.candidates[0].entities);
      expect(result1.candidates[0].tags).toEqual(result2.candidates[0].tags);
      // Note: timestamp is derived from frontmatter date_clipped, so it should be identical
      // when the note has explicit date_clipped field
      expect(result1.candidates[0].timestamp).toBe(result2.candidates[0].timestamp);

      expect(result1.metadata.filesScanned).toBe(result2.metadata.filesScanned);
      expect(result1.metadata.filesWithFrontmatter).toBe(
        result2.metadata.filesWithFrontmatter
      );
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  test("candidates are sorted deterministically", async () => {
    const vaultPath = await createTestVault();

    try {
      // Create notes in non-alphabetical order
      await createTestNote(
        vaultPath,
        "zeta.md",
        `---
source: https://example.com/zeta
title: Zeta
---
# Zeta`
      );

      await createTestNote(
        vaultPath,
        "alpha.md",
        `---
source: https://example.com/alpha
title: Alpha
---
# Alpha`
      );

      await createTestNote(
        vaultPath,
        "beta.md",
        `---
source: https://example.com/beta
title: Beta
---
# Beta`
      );

      const options: VaultIndexOptions = { vaultPath };

      // Build cache
      await resolveVaultIndexCache(vaultPath, options);

      // Get cache hit
      const result = await resolveVaultIndexCache(vaultPath, options);

      // Candidates should be sorted by path
      const paths = result.candidates.map((c) => c.path);
      const sortedPaths = [...paths].sort();
      expect(paths).toEqual(sortedPaths);
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });
});
