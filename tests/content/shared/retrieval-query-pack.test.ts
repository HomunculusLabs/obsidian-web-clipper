/**
 * Retrieval Query Pack Tests - Content Layer
 *
 * Tests for deterministic query generation, scoring, tie-breaking,
 * truncation, and diagnostics emission at the content integration layer.
 *
 * Coverage areas:
 * - No-query cases: Empty results when minimal/no artifacts
 * - Minimal cases: Basic query generation with limited artifacts
 * - Full cases: Complete query generation with all artifact types
 * - Truncation: Behavior when queries exceed MAX_*_QUERIES bounds
 * - Tie-break determinism: Stable ordering when scores are equal
 */

import { describe, expect, test } from "bun:test";
import {
  QUERY_PACK_VERSION,
  MAX_EXACT_PHRASE_QUERIES,
  MAX_KEYWORD_BOOLEAN_QUERIES,
  MAX_ENTITY_QUERY_SEEDS,
  MAX_TOTAL_QUERIES,
  DEFAULT_NO_QUERY_DIAGNOSTICS,
  extractQueryPackDiagnostics,
  renderRetrievalQueryPackSection,
  type RetrievalQueryPackInput,
  type QueryPackDiagnostics,
} from "../../../src/shared/retrievalQueryPackContract";
import {
  buildRetrievalQueryPack,
  isEmptyQueryPack,
  getNoQueryDiagnostics,
  validateQueryPack,
} from "../../../src/shared/retrievalQueryPackBuilder";

// =============================================================================
// NO-QUERY CASES - Empty results when minimal/no artifacts
// =============================================================================

describe("NO-QUERY CASES - Empty results for minimal content", () => {
  test("no-query: empty title produces no queries", () => {
    const input: RetrievalQueryPackInput = {
      title: "",
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    expect(pack.exactPhrases).toHaveLength(0);
    expect(pack.keywordBooleans).toHaveLength(0);
    expect(pack.entitySeeds).toHaveLength(0);
    expect(pack.totalGenerated).toBe(0);
    expect(pack.totalIncluded).toBe(0);
    expect(pack.truncated).toBe(false);
  });

  test("no-query: title with only stopwords produces no queries", () => {
    const input: RetrievalQueryPackInput = {
      title: "The And Or But",
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    expect(isEmptyQueryPack(pack)).toBe(true);
    expect(pack.totalGenerated).toBe(0);
  });

  test("no-query: single word title produces no exact phrases", () => {
    const input: RetrievalQueryPackInput = {
      title: "TypeScript",
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // Single word can't form 3+ word phrases
    expect(pack.exactPhrases).toHaveLength(0);
    // But may produce entity seeds
    expect(pack.entitySeeds.length).toBeGreaterThanOrEqual(0);
  });

  test("no-query: DEFAULT_NO_QUERY_DIAGNOSTICS has correct values", () => {
    expect(DEFAULT_NO_QUERY_DIAGNOSTICS).toEqual({
      query_pack_exact_phrases: 0,
      query_pack_keyword_booleans: 0,
      query_pack_entity_seeds: 0,
      query_pack_total_queries: 0,
      query_pack_truncated: false,
      query_pack_version: QUERY_PACK_VERSION,
    });
  });

  test("no-query: getNoQueryDiagnostics returns correct defaults", () => {
    const diagnostics = getNoQueryDiagnostics();

    expect(diagnostics.query_pack_exact_phrases).toBe(0);
    expect(diagnostics.query_pack_keyword_booleans).toBe(0);
    expect(diagnostics.query_pack_entity_seeds).toBe(0);
    expect(diagnostics.query_pack_total_queries).toBe(0);
    expect(diagnostics.query_pack_truncated).toBe(false);
    expect(diagnostics.query_pack_version).toBe(QUERY_PACK_VERSION);
  });

  test("no-query: renderRetrievalQueryPackSection returns empty for empty pack", () => {
    const input: RetrievalQueryPackInput = {
      title: "",
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);
    const section = renderRetrievalQueryPackSection(pack);

    expect(section).toBe("");
  });

  test("no-query: extractQueryPackDiagnostics reflects empty pack", () => {
    const input: RetrievalQueryPackInput = {
      title: "The An A",
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);
    const diagnostics = extractQueryPackDiagnostics(pack);

    expect(diagnostics.query_pack_exact_phrases).toBe(0);
    expect(diagnostics.query_pack_keyword_booleans).toBe(0);
    expect(diagnostics.query_pack_entity_seeds).toBe(0);
    expect(diagnostics.query_pack_total_queries).toBe(0);
    expect(diagnostics.query_pack_truncated).toBe(false);
  });

  test("no-query: validateQueryPack passes for empty valid pack", () => {
    const input: RetrievalQueryPackInput = {
      title: "",
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    expect(validateQueryPack(pack)).toBe(true);
  });
});

// =============================================================================
// MINIMAL CASES - Basic query generation with limited artifacts
// =============================================================================

describe("MINIMAL CASES - Basic query generation", () => {
  test("minimal: short title generates phrases from title words", () => {
    const input: RetrievalQueryPackInput = {
      title: "TypeScript API Design",
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // 3-word title generates at least one 3-word phrase
    expect(pack.exactPhrases.length).toBeGreaterThanOrEqual(1);
    // Title alone doesn't generate entity seeds (need keywords/entities/taxonomy)
    expect(pack.entitySeeds.length).toBe(0);
    expect(pack.totalIncluded).toBeGreaterThanOrEqual(1);
  });

  test("minimal: title with description generates more queries", () => {
    const input: RetrievalQueryPackInput = {
      title: "TypeScript Guide",
      description: "A comprehensive guide to TypeScript programming",
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // Should have some queries from combined sources
    expect(pack.totalIncluded).toBeGreaterThanOrEqual(1);
    expect(pack.version).toBe(QUERY_PACK_VERSION);
  });

  test("minimal: keywords produce boolean queries", () => {
    const input: RetrievalQueryPackInput = {
      title: "Test",
      keywords: ["typescript", "javascript", "programming"],
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // Keywords should generate entity seeds and boolean queries
    expect(pack.entitySeeds.length).toBeGreaterThanOrEqual(3);
    expect(pack.keywordBooleans.length).toBeGreaterThanOrEqual(1);
  });

  test("minimal: single keyword combines with title for boolean queries", () => {
    const input: RetrievalQueryPackInput = {
      title: "Test",
      keywords: ["typescript"],
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // Single keyword becomes entity seed
    expect(pack.entitySeeds.length).toBeGreaterThanOrEqual(1);
    // Boolean queries combine keyword with title words (test + typescript)
    expect(pack.keywordBooleans.length).toBeGreaterThanOrEqual(1);
  });

  test("minimal: knowledge entities produce entity seeds", () => {
    const input: RetrievalQueryPackInput = {
      title: "Guide",
      knowledgeEntities: ["interface", "generics", "type inference"],
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // All entities should become seeds
    expect(pack.entitySeeds.length).toBeGreaterThanOrEqual(3);
    // Multi-word entities may also produce phrases
    expect(pack.totalIncluded).toBeGreaterThanOrEqual(3);
  });

  test("minimal: concept taxonomy generates queries", () => {
    const input: RetrievalQueryPackInput = {
      title: "Test",
      conceptTaxonomy: ["Technology", "Programming", "TypeScript"],
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // Taxonomy generates entity seeds
    expect(pack.entitySeeds.length).toBeGreaterThanOrEqual(3);
  });

  test("minimal: diagnostics reflect actual counts", () => {
    const input: RetrievalQueryPackInput = {
      title: "TypeScript Best Practices",
      keywords: ["typescript", "javascript"],
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);
    const diagnostics = extractQueryPackDiagnostics(pack);

    expect(diagnostics.query_pack_exact_phrases).toBe(pack.exactPhrases.length);
    expect(diagnostics.query_pack_keyword_booleans).toBe(pack.keywordBooleans.length);
    expect(diagnostics.query_pack_entity_seeds).toBe(pack.entitySeeds.length);
    expect(diagnostics.query_pack_total_queries).toBe(pack.totalIncluded);
    expect(diagnostics.query_pack_truncated).toBe(pack.truncated);
    expect(diagnostics.query_pack_version).toBe(QUERY_PACK_VERSION);
  });

  test("minimal: render produces only sections with content", () => {
    const input: RetrievalQueryPackInput = {
      title: "Test",
      keywords: ["a", "b", "c"], // Only generates entity seeds
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);
    const section = renderRetrievalQueryPackSection(pack);

    // Should have the header and entity seeds section
    expect(section).toContain("## Retrieval Query Pack");
    expect(section).toContain("### Entity Query Seeds");
    // Should not have empty sections
    if (pack.exactPhrases.length === 0) {
      expect(section).not.toContain("### Exact Phrase Queries");
    }
  });
});

// =============================================================================
// FULL CASES - Complete query generation with all artifact types
// =============================================================================

describe("FULL CASES - Complete query generation", () => {
  const fullInput: RetrievalQueryPackInput = {
    title: "Advanced TypeScript Patterns for Scalable API Design in Modern Web Applications",
    description: "Learn how to leverage TypeScript interfaces, generics, and type inference to build robust APIs with comprehensive type safety guarantees",
    conceptTaxonomy: ["Technology", "Programming", "TypeScript", "API Design", "Web Development"],
    knowledgeEntities: ["interface definition", "generic constraints", "type inference engine", "api contract", "type safety"],
    keywords: ["typescript", "api", "generics", "interfaces", "type-safety"],
    sourceUrl: "https://example.com/typescript-guide",
    contentType: "article",
    author: "TypeScript Expert",
    publishedDate: "2026-02-15T00:00:00.000Z",
  };

  test("full: generates queries from all artifact types", () => {
    const pack = buildRetrievalQueryPack(fullInput);

    // Should have queries from all sources
    expect(pack.exactPhrases.length).toBeGreaterThan(0);
    expect(pack.keywordBooleans.length).toBeGreaterThan(0);
    expect(pack.entitySeeds.length).toBeGreaterThan(0);
    expect(pack.totalIncluded).toBeGreaterThan(5);
    expect(pack.version).toBe(QUERY_PACK_VERSION);
  });

  test("full: scores are within valid range", () => {
    const pack = buildRetrievalQueryPack(fullInput);

    // All scores should be 0-100
    for (const phrase of pack.exactPhrases) {
      expect(phrase.score).toBeGreaterThanOrEqual(0);
      expect(phrase.score).toBeLessThanOrEqual(100);
    }
    for (const bool of pack.keywordBooleans) {
      expect(bool.score).toBeGreaterThanOrEqual(0);
      expect(bool.score).toBeLessThanOrEqual(100);
    }
    for (const seed of pack.entitySeeds) {
      expect(seed.score).toBeGreaterThanOrEqual(0);
      expect(seed.score).toBeLessThanOrEqual(100);
    }
  });

  test("full: exact phrases sorted by score descending", () => {
    const pack = buildRetrievalQueryPack(fullInput);

    for (let i = 1; i < pack.exactPhrases.length; i++) {
      expect(pack.exactPhrases[i - 1].score).toBeGreaterThanOrEqual(
        pack.exactPhrases[i].score
      );
    }
  });

  test("full: keyword booleans sorted by score descending", () => {
    const pack = buildRetrievalQueryPack(fullInput);

    for (let i = 1; i < pack.keywordBooleans.length; i++) {
      expect(pack.keywordBooleans[i - 1].score).toBeGreaterThanOrEqual(
        pack.keywordBooleans[i].score
      );
    }
  });

  test("full: entity seeds sorted by score descending", () => {
    const pack = buildRetrievalQueryPack(fullInput);

    for (let i = 1; i < pack.entitySeeds.length; i++) {
      expect(pack.entitySeeds[i - 1].score).toBeGreaterThanOrEqual(
        pack.entitySeeds[i].score
      );
    }
  });

  test("full: validateQueryPack passes for valid pack", () => {
    const pack = buildRetrievalQueryPack(fullInput);

    expect(validateQueryPack(pack)).toBe(true);
  });

  test("full: render produces complete markdown section", () => {
    const pack = buildRetrievalQueryPack(fullInput);
    const section = renderRetrievalQueryPackSection(pack);

    expect(section).toContain("## Retrieval Query Pack");

    if (pack.exactPhrases.length > 0) {
      expect(section).toContain("### Exact Phrase Queries");
      expect(section).toContain('"'); // Phrases quoted
    }
    if (pack.keywordBooleans.length > 0) {
      expect(section).toContain("### Keyword Boolean Queries");
    }
    if (pack.entitySeeds.length > 0) {
      expect(section).toContain("### Entity Query Seeds");
    }
  });

  test("full: recent content gets higher scores", () => {
    const recentInput: RetrievalQueryPackInput = {
      ...fullInput,
      publishedDate: new Date().toISOString(), // Today
    };

    const oldInput: RetrievalQueryPackInput = {
      ...fullInput,
      publishedDate: "2020-01-01T00:00:00.000Z", // Old
    };

    const recentPack = buildRetrievalQueryPack(recentInput);
    const oldPack = buildRetrievalQueryPack(oldInput);

    // Recent content should generally have higher or equal scores
    // (at least one query type should benefit)
    const recentTotalScore = recentPack.exactPhrases.reduce((s, q) => s + q.score, 0) +
      recentPack.keywordBooleans.reduce((s, q) => s + q.score, 0) +
      recentPack.entitySeeds.reduce((s, q) => s + q.score, 0);
    const oldTotalScore = oldPack.exactPhrases.reduce((s, q) => s + q.score, 0) +
      oldPack.keywordBooleans.reduce((s, q) => s + q.score, 0) +
      oldPack.entitySeeds.reduce((s, q) => s + q.score, 0);

    expect(recentTotalScore).toBeGreaterThanOrEqual(oldTotalScore);
  });
});

// =============================================================================
// TRUNCATION CASES - Behavior when queries exceed bounds
// =============================================================================

describe("TRUNCATION CASES - Query limit enforcement", () => {
  const manyEntitiesInput: RetrievalQueryPackInput = {
    title: "Comprehensive Guide to TypeScript Type System and Advanced Patterns for Enterprise Software Development with Generic Programming Techniques",
    description: "This extensive guide covers TypeScript interfaces, type aliases, union types, intersection types, conditional types, mapped types, template literal types, inference, constraints, variance, and much more in depth",
    conceptTaxonomy: [
      "Technology", "Programming", "TypeScript", "Software Engineering",
      "Web Development", "Frontend", "Backend", "Full Stack", "Enterprise",
    ],
    knowledgeEntities: [
      "interface definition", "type alias", "union type", "intersection type",
      "conditional type", "mapped type", "template literal type", "type inference",
      "generic constraint", "variance annotation", "type predicate", "assertion function",
      "declaration merging", "module augmentation", "ambient declaration",
    ],
    keywords: [
      "typescript", "types", "generics", "interfaces", "inference",
      "constraints", "conditional", "mapped", "template", "enterprise",
      "advanced", "patterns", "software", "engineering",
    ],
    contentType: "article",
  };

  test("truncation: exact phrases limited to MAX_EXACT_PHRASE_QUERIES", () => {
    const pack = buildRetrievalQueryPack(manyEntitiesInput);

    expect(pack.exactPhrases.length).toBeLessThanOrEqual(MAX_EXACT_PHRASE_QUERIES);
  });

  test("truncation: keyword booleans limited to MAX_KEYWORD_BOOLEAN_QUERIES", () => {
    const pack = buildRetrievalQueryPack(manyEntitiesInput);

    expect(pack.keywordBooleans.length).toBeLessThanOrEqual(MAX_KEYWORD_BOOLEAN_QUERIES);
  });

  test("truncation: entity seeds limited to MAX_ENTITY_QUERY_SEEDS", () => {
    const pack = buildRetrievalQueryPack(manyEntitiesInput);

    expect(pack.entitySeeds.length).toBeLessThanOrEqual(MAX_ENTITY_QUERY_SEEDS);
  });

  test("truncation: total queries bounded", () => {
    const pack = buildRetrievalQueryPack(manyEntitiesInput);

    expect(pack.totalIncluded).toBeLessThanOrEqual(MAX_TOTAL_QUERIES);
  });

  test("truncation: flag set when queries are truncated", () => {
    const pack = buildRetrievalQueryPack(manyEntitiesInput);

    // With many entities, should be truncated
    if (pack.totalGenerated > pack.totalIncluded) {
      expect(pack.truncated).toBe(true);
    }
  });

  test("truncation: diagnostics report truncation correctly", () => {
    const pack = buildRetrievalQueryPack(manyEntitiesInput);
    const diagnostics = extractQueryPackDiagnostics(pack);

    expect(diagnostics.query_pack_truncated).toBe(pack.truncated);
    if (pack.truncated) {
      expect(diagnostics.query_pack_truncated).toBe(true);
    }
  });

  test("truncation: totalGenerated reflects pre-truncation count", () => {
    const pack = buildRetrievalQueryPack(manyEntitiesInput);

    // totalGenerated should be >= totalIncluded (what was kept after truncation)
    expect(pack.totalGenerated).toBeGreaterThanOrEqual(pack.totalIncluded);
    // When truncated, totalGenerated should be strictly greater
    if (pack.truncated) {
      expect(pack.totalGenerated).toBeGreaterThan(pack.totalIncluded);
    } else {
      expect(pack.totalGenerated).toBe(pack.totalIncluded);
    }
  });

  test("truncation: keeps highest scoring queries", () => {
    const pack = buildRetrievalQueryPack(manyEntitiesInput);

    if (pack.exactPhrases.length >= 2) {
      // Higher index = lower score after sorting
      expect(pack.exactPhrases[0].score).toBeGreaterThanOrEqual(
        pack.exactPhrases[pack.exactPhrases.length - 1].score
      );
    }
  });

  test("truncation: no truncation when under limits", () => {
    const minimalInput: RetrievalQueryPackInput = {
      title: "Short",
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(minimalInput);

    expect(pack.truncated).toBe(false);
    expect(pack.totalGenerated).toBe(pack.totalIncluded);
  });
});

// =============================================================================
// TIE-BREAK DETERMINISM CASES - Stable ordering when scores are equal
// =============================================================================

describe("TIE-BREAK DETERMINISM CASES - Stable ordering", () => {
  test("tie-break: exact phrases with equal scores sorted by source priority", () => {
    const input: RetrievalQueryPackInput = {
      title: "TypeScript API Design Patterns",
      description: "TypeScript API Design Patterns",
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // When scores are equal, source priority should determine order
    // title > description > taxonomy > entities
    for (let i = 1; i < pack.exactPhrases.length; i++) {
      const prev = pack.exactPhrases[i - 1];
      const curr = pack.exactPhrases[i];

      if (prev.score === curr.score) {
        const sourceOrder = ["title", "description", "taxonomy", "entities"];
        const prevIdx = sourceOrder.indexOf(prev.source);
        const currIdx = sourceOrder.indexOf(curr.source);
        expect(prevIdx).toBeLessThanOrEqual(currIdx);
      }
    }
  });

  test("tie-break: keyword booleans with equal scores sorted by source priority", () => {
    const input: RetrievalQueryPackInput = {
      title: "TypeScript",
      keywords: ["typescript", "api"],
      conceptTaxonomy: ["Programming"],
      knowledgeEntities: ["typescript"],
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // When scores are equal, source priority should determine order
    // keywords > taxonomy > entities > title
    for (let i = 1; i < pack.keywordBooleans.length; i++) {
      const prev = pack.keywordBooleans[i - 1];
      const curr = pack.keywordBooleans[i];

      if (prev.score === curr.score) {
        const sourceOrder = ["keywords", "taxonomy", "entities", "title"];
        const prevIdx = sourceOrder.indexOf(prev.source);
        const currIdx = sourceOrder.indexOf(curr.source);
        expect(prevIdx).toBeLessThanOrEqual(currIdx);
      }
    }
  });

  test("tie-break: entity seeds with equal scores sorted by source priority", () => {
    const input: RetrievalQueryPackInput = {
      title: "Test",
      knowledgeEntities: ["typescript"],
      conceptTaxonomy: ["typescript"],
      keywords: ["typescript"],
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // Should have at least one entity seed
    expect(pack.entitySeeds.length).toBeGreaterThanOrEqual(1);

    // When scores are equal, source priority should determine order
    // knowledge_entities > taxonomy > keywords
    for (let i = 1; i < pack.entitySeeds.length; i++) {
      const prev = pack.entitySeeds[i - 1];
      const curr = pack.entitySeeds[i];

      if (prev.score === curr.score) {
        const sourceOrder = ["knowledge_entities", "taxonomy", "keywords"];
        const prevIdx = sourceOrder.indexOf(prev.source);
        const currIdx = sourceOrder.indexOf(curr.source);
        expect(prevIdx).toBeLessThanOrEqual(currIdx);
      }
    }
  });

  test("tie-break: equal scores and source sorted lexicographically", () => {
    // Create input where many queries will have same score
    const input: RetrievalQueryPackInput = {
      title: "A B C D E F G H I J K L M N O P",
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // Check exact phrases for lexicographic ordering on ties
    for (let i = 1; i < pack.exactPhrases.length; i++) {
      const prev = pack.exactPhrases[i - 1];
      const curr = pack.exactPhrases[i];

      if (prev.score === curr.score && prev.source === curr.source) {
        expect(prev.phrase.localeCompare(curr.phrase)).toBeLessThanOrEqual(0);
      }
    }
  });

  test("tie-break: multiple runs produce identical output", () => {
    const input: RetrievalQueryPackInput = {
      title: "TypeScript Generics and Advanced Type Patterns",
      description: "Understanding TypeScript generics and type patterns",
      conceptTaxonomy: ["Programming", "TypeScript"],
      knowledgeEntities: ["generics", "type inference"],
      keywords: ["typescript", "generics"],
      contentType: "article",
    };

    const pack1 = buildRetrievalQueryPack(input);
    const pack2 = buildRetrievalQueryPack(input);
    const pack3 = buildRetrievalQueryPack(input);

    // All should be identical
    expect(pack1.exactPhrases).toEqual(pack2.exactPhrases);
    expect(pack2.exactPhrases).toEqual(pack3.exactPhrases);
    expect(pack1.keywordBooleans).toEqual(pack2.keywordBooleans);
    expect(pack2.keywordBooleans).toEqual(pack3.keywordBooleans);
    expect(pack1.entitySeeds).toEqual(pack2.entitySeeds);
    expect(pack2.entitySeeds).toEqual(pack3.entitySeeds);
    expect(pack1.totalGenerated).toBe(pack2.totalGenerated);
    expect(pack2.totalGenerated).toBe(pack3.totalGenerated);
  });

  test("tie-break: rendered markdown is deterministic", () => {
    const input: RetrievalQueryPackInput = {
      title: "TypeScript Guide",
      description: "Complete guide",
      keywords: ["typescript", "guide"],
      contentType: "article",
    };

    const pack1 = buildRetrievalQueryPack(input);
    const pack2 = buildRetrievalQueryPack(input);

    const section1 = renderRetrievalQueryPackSection(pack1);
    const section2 = renderRetrievalQueryPackSection(pack2);

    expect(section1).toBe(section2);
  });

  test("tie-break: diagnostics are deterministic", () => {
    const input: RetrievalQueryPackInput = {
      title: "TypeScript Guide",
      description: "Complete guide",
      keywords: ["typescript", "guide"],
      contentType: "article",
    };

    const pack1 = buildRetrievalQueryPack(input);
    const pack2 = buildRetrievalQueryPack(input);

    const diag1 = extractQueryPackDiagnostics(pack1);
    const diag2 = extractQueryPackDiagnostics(pack2);

    expect(diag1).toEqual(diag2);
  });
});

// =============================================================================
// EDGE CASES - Boundary conditions and special scenarios
// =============================================================================

describe("EDGE CASES - Boundary conditions", () => {
  test("edge: duplicate entities are deduplicated", () => {
    const input: RetrievalQueryPackInput = {
      title: "Test",
      knowledgeEntities: ["typescript", "typescript", "typescript"],
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // Should dedupe to single entity
    const typescriptSeeds = pack.entitySeeds.filter(
      (s) => s.entity.toLowerCase() === "typescript"
    );
    expect(typescriptSeeds.length).toBeLessThanOrEqual(1);
  });

  test("edge: exact-case entity deduplication", () => {
    const input: RetrievalQueryPackInput = {
      title: "Test",
      knowledgeEntities: ["typescript", "typescript", "typescript"],
      conceptTaxonomy: ["TypeScript"], // Different case = different entity
      keywords: ["TYPESCRIPT"], // Different case = different entity
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // Exact duplicates are deduplicated (same case)
    const typescriptSeeds = pack.entitySeeds.filter(
      (s) => s.entity === "typescript"
    );
    expect(typescriptSeeds.length).toBeLessThanOrEqual(1);
    // Different cases are preserved as separate entities
    const allCaseSeeds = pack.entitySeeds.filter(
      (s) => s.entity.toLowerCase() === "typescript"
    );
    expect(allCaseSeeds.length).toBeGreaterThanOrEqual(1);
  });

  test("edge: very long phrases are handled", () => {
    const input: RetrievalQueryPackInput = {
      title: "A".repeat(200),
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    // Should not crash and should handle gracefully
    expect(pack).toBeDefined();
    expect(validateQueryPack(pack)).toBe(true);
  });

  test("edge: special characters in text are handled", () => {
    const input: RetrievalQueryPackInput = {
      title: "TypeScript: A Guide (2024) - With Examples!",
      description: "Learn TypeScript @ https://example.com \"quoted\" and 'apostrophe'",
      knowledgeEntities: ["type-safety", "compile-time"],
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    expect(pack).toBeDefined();
    expect(validateQueryPack(pack)).toBe(true);

    // Should still produce some queries
    expect(pack.totalIncluded).toBeGreaterThan(0);
  });

  test("edge: empty arrays in input handled gracefully", () => {
    const input: RetrievalQueryPackInput = {
      title: "Test",
      keywords: [],
      conceptTaxonomy: [],
      knowledgeEntities: [],
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    expect(pack).toBeDefined();
    expect(validateQueryPack(pack)).toBe(true);
  });

  test("edge: undefined optional fields handled", () => {
    const input: RetrievalQueryPackInput = {
      title: "Test",
      contentType: "article",
      // description, keywords, etc. are undefined
    };

    const pack = buildRetrievalQueryPack(input);

    expect(pack).toBeDefined();
    expect(validateQueryPack(pack)).toBe(true);
  });

  test("edge: unicode characters in text", () => {
    const input: RetrievalQueryPackInput = {
      title: "TypeScript 类型系统指南 💻",
      description: "学习 TypeScript 的高级特性",
      contentType: "article",
    };

    const pack = buildRetrievalQueryPack(input);

    expect(pack).toBeDefined();
    expect(validateQueryPack(pack)).toBe(true);
  });

  test("edge: version is always set correctly", () => {
    const inputs: RetrievalQueryPackInput[] = [
      { title: "", contentType: "article" },
      { title: "Test", contentType: "article" },
      { title: "Full Test", description: "Desc", keywords: ["a", "b"], contentType: "article" },
    ];

    for (const input of inputs) {
      const pack = buildRetrievalQueryPack(input);
      expect(pack.version).toBe(QUERY_PACK_VERSION);
    }
  });
});

// =============================================================================
// INTEGRATION CASES - Full pipeline verification
// =============================================================================

describe("INTEGRATION CASES - Full pipeline", () => {
  test("integration: complete flow from input to markdown output", () => {
    const input: RetrievalQueryPackInput = {
      title: "Building Scalable APIs with TypeScript",
      description: "Learn to design robust APIs using TypeScript type system",
      conceptTaxonomy: ["Technology", "Programming", "API Design"],
      knowledgeEntities: ["interface", "type safety", "validation"],
      keywords: ["typescript", "api", "scalability"],
      sourceUrl: "https://example.com/ts-api-guide",
      contentType: "article",
      author: "Dev Expert",
      publishedDate: "2026-02-01T00:00:00.000Z",
    };

    // Full pipeline
    const pack = buildRetrievalQueryPack(input);
    const diagnostics = extractQueryPackDiagnostics(pack);
    const section = renderRetrievalQueryPackSection(pack);

    // Verify pack structure
    expect(pack.totalIncluded).toBeGreaterThan(0);
    expect(pack.version).toBe(QUERY_PACK_VERSION);

    // Verify diagnostics
    expect(diagnostics.query_pack_exact_phrases).toBe(pack.exactPhrases.length);
    expect(diagnostics.query_pack_keyword_booleans).toBe(pack.keywordBooleans.length);
    expect(diagnostics.query_pack_entity_seeds).toBe(pack.entitySeeds.length);
    expect(diagnostics.query_pack_total_queries).toBe(pack.totalIncluded);
    expect(diagnostics.query_pack_version).toBe(QUERY_PACK_VERSION);

    // Verify markdown output
    expect(section).toContain("## Retrieval Query Pack");
    if (pack.exactPhrases.length > 0) {
      expect(section).toContain("### Exact Phrase Queries");
    }
  });

  test("integration: video content type produces valid queries", () => {
    const input: RetrievalQueryPackInput = {
      title: "TypeScript Tutorial Video",
      description: "Learn TypeScript in this comprehensive video tutorial",
      contentType: "video",
      author: "Code Channel",
      publishedDate: "2026-01-15T00:00:00.000Z",
    };

    const pack = buildRetrievalQueryPack(input);

    expect(pack).toBeDefined();
    expect(validateQueryPack(pack)).toBe(true);
    expect(pack.totalIncluded).toBeGreaterThanOrEqual(0);
  });

  test("integration: tweet content type produces valid queries", () => {
    const input: RetrievalQueryPackInput = {
      title: "TypeScript 5.0 is here with decorators",
      contentType: "tweet",
      author: "TypeScript Team",
    };

    const pack = buildRetrievalQueryPack(input);

    expect(pack).toBeDefined();
    expect(validateQueryPack(pack)).toBe(true);
  });

  test("integration: multiple runs produce identical diagnostics", () => {
    const input: RetrievalQueryPackInput = {
      title: "Advanced TypeScript Patterns",
      keywords: ["typescript", "patterns", "advanced"],
      contentType: "article",
    };

    const diag1 = extractQueryPackDiagnostics(buildRetrievalQueryPack(input));
    const diag2 = extractQueryPackDiagnostics(buildRetrievalQueryPack(input));
    const diag3 = extractQueryPackDiagnostics(buildRetrievalQueryPack(input));

    expect(diag1).toEqual(diag2);
    expect(diag2).toEqual(diag3);
  });

  test("integration: isEmptyQueryPack correctly identifies empty packs", () => {
    const emptyInput: RetrievalQueryPackInput = {
      title: "",
      contentType: "article",
    };

    const fullInput: RetrievalQueryPackInput = {
      title: "TypeScript Guide",
      keywords: ["typescript"],
      contentType: "article",
    };

    const emptyPack = buildRetrievalQueryPack(emptyInput);
    const fullPack = buildRetrievalQueryPack(fullInput);

    expect(isEmptyQueryPack(emptyPack)).toBe(true);
    expect(isEmptyQueryPack(fullPack)).toBe(false);
  });
});
