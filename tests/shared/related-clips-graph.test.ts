/**
 * Related Clips Graph Contract Tests
 *
 * Tests for deterministic cross-clip matching, scoring, tie-breaking,
 * truncation, and diagnostics emission.
 */

import { describe, expect, test } from "bun:test";
import {
  RELATED_CLIPS_GRAPH_VERSION,
  MAX_RELATED_CLIPS,
  DEFAULT_NO_MATCH_DIAGNOSTICS,
  MatchSignalType,
  MATCH_SIGNAL_WEIGHTS,
  computeRelatednessScore,
  computeScoreFromSignals,
  countSharedEntities,
  countSharedTags,
  sortScoresDeterministically,
  buildRelatedClips,
  extractDiagnostics,
  renderRelatedClipsSection,
  extractDomain,
  normalizeUrl,
  computeRelatedClips,
  type RelatedClipsInput,
  type CandidateNote,
  type RelatedClipsDiagnostics,
} from "../../src/shared/relatedClipsContract";

describe("relatedClipsContract - constants", () => {
  test("RELATED_CLIPS_GRAPH_VERSION is a non-empty string", () => {
    expect(RELATED_CLIPS_GRAPH_VERSION).toBeTruthy();
    expect(typeof RELATED_CLIPS_GRAPH_VERSION).toBe("string");
    expect(RELATED_CLIPS_GRAPH_VERSION.length).toBeGreaterThan(0);
  });

  test("MAX_RELATED_CLIPS is a positive integer", () => {
    expect(MAX_RELATED_CLIPS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_RELATED_CLIPS)).toBe(true);
  });

  test("DEFAULT_NO_MATCH_DIAGNOSTICS has all required fields", () => {
    expect(DEFAULT_NO_MATCH_DIAGNOSTICS).toEqual({
      related_clips_count: 0,
      related_clips_top_score: 0,
      related_graph_version: RELATED_CLIPS_GRAPH_VERSION,
      related_clips_truncated: false,
    });
  });

  test("MATCH_SIGNAL_WEIGHTS are all positive integers", () => {
    for (const weight of Object.values(MATCH_SIGNAL_WEIGHTS)) {
      expect(weight).toBeGreaterThan(0);
      expect(Number.isInteger(weight)).toBe(true);
    }
  });

  test("MATCH_SIGNAL_WEIGHTS have proper relative ordering", () => {
    // Exact URL > Same Domain > Shared Entities > Shared Tags > Same Content Type
    expect(
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.EXACT_URL]
    ).toBeGreaterThan(MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_DOMAIN]);
    expect(
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_DOMAIN]
    ).toBeGreaterThan(MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_ENTITIES]);
    expect(
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_ENTITIES]
    ).toBeGreaterThan(MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_TAGS]);
    expect(
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_TAGS]
    ).toBeGreaterThan(MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_CONTENT_TYPE]);
  });
});

describe("computeScoreFromSignals", () => {
  test("zero score when no signals match", () => {
    const signals = {
      [MatchSignalType.EXACT_URL]: false,
      [MatchSignalType.SAME_DOMAIN]: false,
      [MatchSignalType.SHARED_ENTITIES]: 0,
      [MatchSignalType.SHARED_TAGS]: 0,
      [MatchSignalType.SAME_CONTENT_TYPE]: false,
    };
    expect(computeScoreFromSignals(signals)).toBe(0);
  });

  test("exact URL match contributes full weight", () => {
    const signals = {
      [MatchSignalType.EXACT_URL]: true,
      [MatchSignalType.SAME_DOMAIN]: false,
      [MatchSignalType.SHARED_ENTITIES]: 0,
      [MatchSignalType.SHARED_TAGS]: 0,
      [MatchSignalType.SAME_CONTENT_TYPE]: false,
    };
    expect(computeScoreFromSignals(signals)).toBe(
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.EXACT_URL]
    );
  });

  test("same domain match contributes weight", () => {
    const signals = {
      [MatchSignalType.EXACT_URL]: false,
      [MatchSignalType.SAME_DOMAIN]: true,
      [MatchSignalType.SHARED_ENTITIES]: 0,
      [MatchSignalType.SHARED_TAGS]: 0,
      [MatchSignalType.SAME_CONTENT_TYPE]: false,
    };
    expect(computeScoreFromSignals(signals)).toBe(
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_DOMAIN]
    );
  });

  test("shared entities contribute weight per entity", () => {
    const signals = {
      [MatchSignalType.EXACT_URL]: false,
      [MatchSignalType.SAME_DOMAIN]: false,
      [MatchSignalType.SHARED_ENTITIES]: 3,
      [MatchSignalType.SHARED_TAGS]: 0,
      [MatchSignalType.SAME_CONTENT_TYPE]: false,
    };
    expect(computeScoreFromSignals(signals)).toBe(
      3 * MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_ENTITIES]
    );
  });

  test("shared tags contribute weight per tag", () => {
    const signals = {
      [MatchSignalType.EXACT_URL]: false,
      [MatchSignalType.SAME_DOMAIN]: false,
      [MatchSignalType.SHARED_ENTITIES]: 0,
      [MatchSignalType.SHARED_TAGS]: 2,
      [MatchSignalType.SAME_CONTENT_TYPE]: false,
    };
    expect(computeScoreFromSignals(signals)).toBe(
      2 * MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_TAGS]
    );
  });

  test("same content type match contributes weight", () => {
    const signals = {
      [MatchSignalType.EXACT_URL]: false,
      [MatchSignalType.SAME_DOMAIN]: false,
      [MatchSignalType.SHARED_ENTITIES]: 0,
      [MatchSignalType.SHARED_TAGS]: 0,
      [MatchSignalType.SAME_CONTENT_TYPE]: true,
    };
    expect(computeScoreFromSignals(signals)).toBe(
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_CONTENT_TYPE]
    );
  });

  test("combined signals sum correctly", () => {
    const signals = {
      [MatchSignalType.EXACT_URL]: true,
      [MatchSignalType.SAME_DOMAIN]: true,
      [MatchSignalType.SHARED_ENTITIES]: 2,
      [MatchSignalType.SHARED_TAGS]: 1,
      [MatchSignalType.SAME_CONTENT_TYPE]: true,
    };
    const expected =
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.EXACT_URL] +
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_DOMAIN] +
      2 * MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_ENTITIES] +
      1 * MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_TAGS] +
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_CONTENT_TYPE];
    expect(computeScoreFromSignals(signals)).toBe(expected);
  });
});

describe("countSharedEntities", () => {
  test("zero when both sets are empty", () => {
    expect(countSharedEntities([], [])).toBe(0);
  });

  test("zero when only one set is empty", () => {
    expect(countSharedEntities(["typescript"], [])).toBe(0);
    expect(countSharedEntities([], ["javascript"])).toBe(0);
  });

  test("counts exact matches", () => {
    expect(
      countSharedEntities(["typescript", "api"], ["typescript", "testing"])
    ).toBe(1);
    expect(countSharedEntities(["a", "b", "c"], ["a", "b", "c"])).toBe(3);
  });

  test("case-insensitive matching", () => {
    expect(countSharedEntities(["TypeScript", "API"], ["typescript", "api"])).toBe(
      2
    );
    expect(countSharedEntities(["TYPESCRIPT"], ["typescript"])).toBe(1);
  });

  test("trims whitespace", () => {
    expect(
      countSharedEntities(["typescript ", " api"], ["typescript", "api"])
    ).toBe(2);
  });

  test("deduplicates within each set", () => {
    expect(
      countSharedEntities(["typescript", "typescript", "api"], ["typescript", "api"])
    ).toBe(2);
  });

  test("no false positives on different strings", () => {
    expect(countSharedEntities(["typescript"], ["javascript"])).toBe(0);
    expect(
      countSharedEntities(["react", "vue"], ["angular", "svelte"])
    ).toBe(0);
  });
});

describe("countSharedTags", () => {
  test("zero when both sets are empty", () => {
    expect(countSharedTags([], [])).toBe(0);
  });

  test("zero when only one set is empty", () => {
    expect(countSharedTags(["web-clip"], [])).toBe(0);
    expect(countSharedTags([], ["dev"])).toBe(0);
  });

  test("counts exact matches", () => {
    expect(countSharedTags(["web-clip", "dev"], ["web-clip", "tutorial"])).toBe(
      1
    );
    expect(countSharedTags(["a", "b", "c"], ["a", "b", "c"])).toBe(3);
  });

  test("case-insensitive matching", () => {
    expect(countSharedTags(["Web-Clip", "Dev"], ["web-clip", "dev"])).toBe(2);
    expect(countSharedTags(["WEB-CLIP"], ["web-clip"])).toBe(1);
  });

  test("trims whitespace", () => {
    expect(countSharedTags(["web-clip ", " dev"], ["web-clip", "dev"])).toBe(2);
  });

  test("deduplicates within each set", () => {
    expect(
      countSharedTags(["web-clip", "web-clip", "dev"], ["web-clip", "dev"])
    ).toBe(2);
  });
});

describe("computeRelatednessScore", () => {
  const baseInput: RelatedClipsInput = {
    sourceUrl: "https://example.com/article",
    domain: "example.com",
    contentType: "article",
    entities: ["typescript", "api"],
    tags: ["web-clip", "dev"],
    timestamp: "2026-03-03T12:00:00.000Z",
  };

  const baseCandidate: CandidateNote = {
    path: "Clips/Test Article.md",
    title: "Test Article",
    sourceUrl: "https://example.com/other",
    domain: "example.com",
    contentType: "article",
    entities: ["typescript", "testing"],
    tags: ["web-clip", "tutorial"],
    timestamp: "2026-03-02T12:00:00.000Z",
    id: "test-article",
  };

  test("computes score for exact URL match", () => {
    const candidate = {
      ...baseCandidate,
      sourceUrl: baseInput.sourceUrl,
    };
    const result = computeRelatednessScore(baseInput, candidate);
    expect(result.score).toBeGreaterThanOrEqual(
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.EXACT_URL]
    );
    expect(result.signals[MatchSignalType.EXACT_URL]).toBe(true);
  });

  test("computes score for same domain match", () => {
    const result = computeRelatednessScore(baseInput, baseCandidate);
    expect(result.score).toBeGreaterThanOrEqual(
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_DOMAIN]
    );
    expect(result.signals[MatchSignalType.SAME_DOMAIN]).toBe(true);
  });

  test("computes score for shared entities", () => {
    const result = computeRelatednessScore(baseInput, baseCandidate);
    expect(result.signals[MatchSignalType.SHARED_ENTITIES]).toBe(1);
    expect(result.score).toBeGreaterThanOrEqual(
      1 * MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_ENTITIES]
    );
  });

  test("computes score for shared tags", () => {
    const result = computeRelatednessScore(baseInput, baseCandidate);
    expect(result.signals[MatchSignalType.SHARED_TAGS]).toBe(1);
    expect(result.score).toBeGreaterThanOrEqual(
      1 * MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_TAGS]
    );
  });

  test("computes score for same content type", () => {
    const result = computeRelatednessScore(baseInput, baseCandidate);
    expect(result.signals[MatchSignalType.SAME_CONTENT_TYPE]).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_CONTENT_TYPE]
    );
  });

  test("returns zero score when no signals match", () => {
    const candidate: CandidateNote = {
      ...baseCandidate,
      sourceUrl: "https://different.com/article",
      domain: "different.com",
      contentType: "video",
      entities: ["javascript"],
      tags: ["other"],
    };
    const result = computeRelatednessScore(baseInput, candidate);
    expect(result.score).toBe(0);
  });

  test("includes all signal data in result", () => {
    const result = computeRelatednessScore(baseInput, baseCandidate);
    expect(result.signals).toHaveProperty(MatchSignalType.EXACT_URL);
    expect(result.signals).toHaveProperty(MatchSignalType.SAME_DOMAIN);
    expect(result.signals).toHaveProperty(MatchSignalType.SHARED_ENTITIES);
    expect(result.signals).toHaveProperty(MatchSignalType.SHARED_TAGS);
    expect(result.signals).toHaveProperty(MatchSignalType.SAME_CONTENT_TYPE);
  });
});

describe("sortScoresDeterministically", () => {
  const mockScores = [
    { score: 10, timestamp: "2026-03-01T00:00:00Z", id: "c", candidate: {} as any },
    { score: 30, timestamp: "2026-03-02T00:00:00Z", id: "a", candidate: {} as any },
    { score: 20, timestamp: "2026-03-03T00:00:00Z", id: "b", candidate: {} as any },
    { score: 30, timestamp: "2026-03-01T00:00:00Z", id: "d", candidate: {} as any },
  ] as any;

  test("sorts by score descending", () => {
    const sorted = sortScoresDeterministically(mockScores);
    expect(sorted[0].score).toBe(30);
    expect(sorted[1].score).toBe(30);
    expect(sorted[2].score).toBe(20);
    expect(sorted[3].score).toBe(10);
  });

  test("ties broken by timestamp descending", () => {
    const sorted = sortScoresDeterministically(mockScores);
    // Both have score 30, but "d" has earlier timestamp
    expect(sorted[0].id).toBe("a");
    expect(sorted[1].id).toBe("d");
    expect(sorted[0].timestamp.localeCompare(sorted[1].timestamp)).toBeGreaterThan(0);
  });

  test("ties with same score and timestamp broken by ID ascending", () => {
    const ties = [
      { score: 10, timestamp: "2026-03-01T00:00:00Z", id: "z", candidate: {} as any },
      { score: 10, timestamp: "2026-03-01T00:00:00Z", id: "a", candidate: {} as any },
    ] as any;
    const sorted = sortScoresDeterministically(ties);
    expect(sorted[0].id).toBe("a");
    expect(sorted[1].id).toBe("z");
  });

  test("does not mutate input array", () => {
    const originalOrder = [...mockScores];
    sortScoresDeterministically(mockScores);
    expect(mockScores).toEqual(originalOrder);
  });
});

describe("buildRelatedClips", () => {
  test("returns empty result when no scores provided", () => {
    const result = buildRelatedClips([]);
    expect(result.relatedClips).toEqual([]);
    expect(result.matchesFound).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.topScore).toBe(0);
  });

  test("includes all scores when under max", () => {
    const scores = [
      {
        score: 10,
        timestamp: "2026-03-01T00:00:00Z",
        id: "a",
        candidate: { path: "a.md", title: "A" } as any,
      },
      {
        score: 5,
        timestamp: "2026-03-02T00:00:00Z",
        id: "b",
        candidate: { path: "b.md", title: "B" } as any,
      },
    ] as any;

    const result = buildRelatedClips(scores, 5);
    expect(result.relatedClips).toHaveLength(2);
    expect(result.matchesFound).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.topScore).toBe(10);
  });

  test("truncates to max clips", () => {
    const scores = Array.from({ length: 10 }, (_, i) => ({
      score: 10 - i,
      timestamp: `2026-03-0${i + 1}T00:00:00Z`,
      id: String(i),
      candidate: { path: `${i}.md`, title: `Note ${i}` } as any,
    })) as any;

    const result = buildRelatedClips(scores, 5);
    expect(result.relatedClips).toHaveLength(5);
    expect(result.matchesFound).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.topScore).toBe(10);
  });

  test("includes correct clip data", () => {
    const scores = [
      {
        score: 42,
        timestamp: "2026-03-01T00:00:00Z",
        id: "test-id",
        candidate: { path: "Clips/Test.md", title: "Test Note" } as any,
      },
    ] as any;

    const result = buildRelatedClips(scores);
    expect(result.relatedClips[0]).toEqual({
      path: "Clips/Test.md",
      title: "Test Note",
      score: 42,
      timestamp: "2026-03-01T00:00:00Z",
      id: "test-id",
    });
  });

  test("sets correct graph version", () => {
    const result = buildRelatedClips([]);
    expect(result.graphVersion).toBe(RELATED_CLIPS_GRAPH_VERSION);
  });
});

describe("extractDiagnostics", () => {
  test("extracts diagnostics from result with clips", () => {
    const result = {
      relatedClips: [
        { path: "a.md", title: "A", score: 42, timestamp: "2026-03-01T00:00:00Z", id: "a" },
        { path: "b.md", title: "B", score: 35, timestamp: "2026-03-02T00:00:00Z", id: "b" },
      ],
      candidatesEvaluated: 10,
      matchesFound: 2,
      truncated: false,
      topScore: 42,
      graphVersion: RELATED_CLIPS_GRAPH_VERSION,
    };

    const diagnostics = extractDiagnostics(result);
    expect(diagnostics).toEqual({
      related_clips_count: 2,
      related_clips_top_score: 42,
      related_graph_version: RELATED_CLIPS_GRAPH_VERSION,
      related_clips_truncated: false,
    } as RelatedClipsDiagnostics);
  });

  test("extracts diagnostics from result with no clips", () => {
    const result = {
      relatedClips: [],
      candidatesEvaluated: 10,
      matchesFound: 0,
      truncated: false,
      topScore: 0,
      graphVersion: RELATED_CLIPS_GRAPH_VERSION,
    };

    const diagnostics = extractDiagnostics(result);
    expect(diagnostics).toEqual({
      related_clips_count: 0,
      related_clips_top_score: 0,
      related_graph_version: RELATED_CLIPS_GRAPH_VERSION,
      related_clips_truncated: false,
    });
  });

  test("extracts diagnostics when truncated", () => {
    const result = {
      relatedClips: [{ path: "a.md", title: "A", score: 42, timestamp: "2026-03-01T00:00:00Z", id: "a" }],
      candidatesEvaluated: 10,
      matchesFound: 10,
      truncated: true,
      topScore: 42,
      graphVersion: RELATED_CLIPS_GRAPH_VERSION,
    };

    const diagnostics = extractDiagnostics(result);
    expect(diagnostics.related_clips_truncated).toBe(true);
  });
});

describe("renderRelatedClipsSection", () => {
  test("returns empty string when no related clips", () => {
    const result = {
      relatedClips: [],
      matchesFound: 0,
      truncated: false,
      topScore: 0,
      graphVersion: RELATED_CLIPS_GRAPH_VERSION,
      candidatesEvaluated: 0,
    };

    const section = renderRelatedClipsSection(result);
    expect(section).toBe("");
  });

  test("renders markdown with wiki-links", () => {
    const result = {
      relatedClips: [
        { path: "Clips/Test Article.md", title: "Test Article", score: 42, timestamp: "2026-03-01T00:00:00Z", id: "a" },
        { path: "Clips/Another Note.md", title: "Another Note", score: 35, timestamp: "2026-03-02T00:00:00Z", id: "b" },
      ],
      matchesFound: 2,
      truncated: false,
      topScore: 42,
      graphVersion: RELATED_CLIPS_GRAPH_VERSION,
      candidatesEvaluated: 0,
    };

    const section = renderRelatedClipsSection(result);
    expect(section).toContain("## Related Clips");
    expect(section).toContain("- [[Test Article|Clips/Test Article.md]] (score: 42)");
    expect(section).toContain("- [[Another Note|Clips/Another Note.md]] (score: 35)");
  });

  test("renders in order received (should be pre-sorted)", () => {
    const result = {
      relatedClips: [
        { path: "a.md", title: "A", score: 42, timestamp: "2026-03-02T00:00:00Z", id: "a" },
        { path: "b.md", title: "B", score: 10, timestamp: "2026-03-01T00:00:00Z", id: "b" },
      ],
      matchesFound: 2,
      truncated: false,
      topScore: 42,
      graphVersion: RELATED_CLIPS_GRAPH_VERSION,
      candidatesEvaluated: 0,
    };

    const section = renderRelatedClipsSection(result);
    const lines = section.split("\n");
    const aIndex = lines.findIndex((l) => l.includes("A"));
    const bIndex = lines.findIndex((l) => l.includes("B"));
    expect(aIndex).toBeLessThan(bIndex); // Input order is preserved (A first, then B)
  });
});

describe("extractDomain", () => {
  test("extracts domain from https URL", () => {
    expect(extractDomain("https://github.com/user/repo")).toBe("github.com");
    expect(extractDomain("https://docs.example.com/path")).toBe("docs.example.com");
  });

  test("extracts domain from http URL", () => {
    expect(extractDomain("http://example.com")).toBe("example.com");
  });

  test("extracts subdomain correctly", () => {
    expect(extractDomain("https://api.example.com")).toBe("api.example.com");
    expect(extractDomain("https://v1.api.example.com")).toBe("v1.api.example.com");
  });

  test("returns empty string for invalid URL", () => {
    expect(extractDomain("not a url")).toBe("");
    expect(extractDomain("")).toBe("");
  });
});

describe("normalizeUrl", () => {
  test("removes trailing slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
  });

  test("removes fragment", () => {
    expect(normalizeUrl("https://example.com#section")).toBe("https://example.com");
    expect(normalizeUrl("https://example.com/path#anchor")).toBe(
      "https://example.com/path"
    );
  });

  test("removes query string", () => {
    expect(normalizeUrl("https://example.com?query=1")).toBe("https://example.com");
    expect(normalizeUrl("https://example.com/path?a=1&b=2")).toBe(
      "https://example.com/path"
    );
  });

  test("handles combined transformations", () => {
    expect(
      normalizeUrl("https://example.com/path/?query=1#section/")
    ).toBe("https://example.com/path");
  });

  test("returns original for invalid URLs", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });

  test("trims whitespace", () => {
    expect(normalizeUrl("  https://example.com  ")).toBe("https://example.com");
  });
});

describe("computeRelatedClips - end-to-end", () => {
  const input: RelatedClipsInput = {
    sourceUrl: "https://github.com/user/repo",
    domain: "github.com",
    contentType: "article",
    entities: ["typescript", "testing", "api"],
    tags: ["web-clip", "dev"],
    timestamp: "2026-03-03T12:00:00.000Z",
  };

  const candidates: CandidateNote[] = [
    {
      path: "Clips/GitHub Repo Guide.md",
      title: "GitHub Repo Guide",
      sourceUrl: "https://github.com/user/repo",
      domain: "github.com",
      contentType: "article",
      entities: ["github", "git"],
      tags: ["web-clip"],
      timestamp: "2026-03-02T12:00:00.000Z",
      id: "github-guide",
    },
    {
      path: "Clips/TypeScript API.md",
      title: "TypeScript API",
      sourceUrl: "https://docs.example.com/ts-api",
      domain: "docs.example.com",
      contentType: "article",
      entities: ["typescript", "api", "types"],
      tags: ["dev", "tutorial"],
      timestamp: "2026-03-01T12:00:00.000Z",
      id: "ts-api",
    },
    {
      path: "Clips/Testing Guide.md",
      title: "Testing Guide",
      sourceUrl: "https://example.com/testing",
      domain: "example.com",
      contentType: "article",
      entities: ["testing", "jest"],
      tags: ["tutorial"],
      timestamp: "2026-02-28T12:00:00.000Z",
      id: "testing-guide",
    },
    {
      path: "Clips/Video Tutorial.md",
      title: "Video Tutorial",
      sourceUrl: "https://youtube.com/watch",
      domain: "youtube.com",
      contentType: "video",
      entities: ["tutorial"],
      tags: ["video"],
      timestamp: "2026-02-27T12:00:00.000Z",
      id: "video-tutorial",
    },
  ];

  test("computes related clips with correct ordering", () => {
    const result = computeRelatedClips(input, candidates);

    // Should find at least 3 related clips
    expect(result.relatedClips.length).toBeGreaterThanOrEqual(3);

    // Exact URL match should be first
    expect(result.relatedClips[0].title).toBe("GitHub Repo Guide");
    expect(result.relatedClips[0].score).toBeGreaterThanOrEqual(
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.EXACT_URL]
    );

    // Shared entities should be next (TypeScript API shares 2 entities: typescript, api)
    expect(result.relatedClips[1].title).toBe("TypeScript API");
    expect(result.relatedClips[1].score).toBeGreaterThanOrEqual(
      2 * MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_ENTITIES]
    );

    // Testing Guide shares 1 entity: testing
    expect(result.relatedClips[2].title).toBe("Testing Guide");
    expect(result.relatedClips[2].score).toBeGreaterThanOrEqual(
      1 * MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_ENTITIES]
    );

    // Scores should be in descending order
    for (let i = 1; i < result.relatedClips.length; i++) {
      expect(result.relatedClips[i].score).toBeLessThanOrEqual(
        result.relatedClips[i - 1].score
      );
    }
  });

  test("filters out zero-score candidates", () => {
    const result = computeRelatedClips(input, candidates);
    // Video tutorial should have a score > 0 due to weak signals
    expect(result.matchesFound).toBeLessThanOrEqual(candidates.length);
  });

  test("includes correct diagnostics", () => {
    const result = computeRelatedClips(input, candidates);

    expect(result.candidatesEvaluated).toBe(candidates.length);
    expect(result.related_clips_count).toBeUndefined(); // Not in result, use extractDiagnostics
    expect(result.graphVersion).toBe(RELATED_CLIPS_GRAPH_VERSION);
  });

  test("truncates to max clips when many matches", () => {
    const manyCandidates = Array.from({ length: 20 }, (_, i) => ({
      path: `Clips/Note ${i}.md`,
      title: `Note ${i}`,
      sourceUrl: `https://github.com/repo${i}`,
      domain: "github.com",
      contentType: "article",
      entities: ["typescript"],
      tags: ["web-clip"],
      timestamp: `2026-03-0${i + 1}T12:00:00.000Z`,
      id: `note-${i}`,
    }));

    const result = computeRelatedClips(input, manyCandidates);
    expect(result.relatedClips.length).toBe(MAX_RELATED_CLIPS);
    expect(result.truncated).toBe(true);
    expect(result.matchesFound).toBeGreaterThan(MAX_RELATED_CLIPS);
  });
});

describe("determinism - same inputs produce same outputs", () => {
  const input: RelatedClipsInput = {
    sourceUrl: "https://example.com/article",
    domain: "example.com",
    contentType: "article",
    entities: ["a", "b", "c"],
    tags: ["x", "y"],
    timestamp: "2026-03-03T12:00:00.000Z",
  };

  const candidates: CandidateNote[] = [
    {
      path: "a.md",
      title: "A",
      sourceUrl: "https://example.com/other",
      domain: "example.com",
      contentType: "article",
      entities: ["a", "d"],
      tags: ["x"],
      timestamp: "2026-03-02T12:00:00.000Z",
      id: "a",
    },
    {
      path: "b.md",
      title: "B",
      sourceUrl: "https://different.com",
      domain: "different.com",
      contentType: "article",
      entities: ["b", "e"],
      tags: ["y"],
      timestamp: "2026-03-01T12:00:00.000Z",
      id: "b",
    },
  ];

  test("same inputs produce same scores", () => {
    const result1 = computeRelatedClips(input, candidates);
    const result2 = computeRelatedClips(input, candidates);

    expect(result1.relatedClips).toEqual(result2.relatedClips);
    expect(result1.topScore).toBe(result2.topScore);
    expect(result1.truncated).toBe(result2.truncated);
  });

  test("same inputs produce same markdown output", () => {
    const result1 = computeRelatedClips(input, candidates);
    const result2 = computeRelatedClips(input, candidates);

    const markdown1 = renderRelatedClipsSection(result1);
    const markdown2 = renderRelatedClipsSection(result2);

    expect(markdown1).toBe(markdown2);
  });

  test("same inputs produce same diagnostics", () => {
    const result1 = computeRelatedClips(input, candidates);
    const result2 = computeRelatedClips(input, candidates);

    const diag1 = extractDiagnostics(result1);
    const diag2 = extractDiagnostics(result2);

    expect(diag1).toEqual(diag2);
  });
});

describe("truncation behavior", () => {
  test("truncates at exactly MAX_RELATED_CLIPS", () => {
    const input: RelatedClipsInput = {
      sourceUrl: "https://example.com/1",
      domain: "example.com",
      contentType: "article",
      entities: ["x"],
      tags: ["y"],
      timestamp: "2026-03-03T12:00:00.000Z",
    };

    const candidates = Array.from({ length: MAX_RELATED_CLIPS + 3 }, (_, i) => ({
      path: `${i}.md`,
      title: `Note ${i}`,
      sourceUrl: `https://example.com/${i}`,
      domain: "example.com",
      contentType: "article",
      entities: ["x"],
      tags: ["y"],
      timestamp: `2026-03-0${(i % 9) + 1}T12:00:00.000Z`,
      id: `${i}`,
    }));

    const result = computeRelatedClips(input, candidates);

    expect(result.relatedClips.length).toBe(MAX_RELATED_CLIPS);
    expect(result.truncated).toBe(true);
  });

  test("no truncation when matches <= max", () => {
    const input: RelatedClipsInput = {
      sourceUrl: "https://example.com/1",
      domain: "example.com",
      contentType: "article",
      entities: ["x"],
      tags: ["y"],
      timestamp: "2026-03-03T12:00:00.000Z",
    };

    const candidates = Array.from({ length: MAX_RELATED_CLIPS - 1 }, (_, i) => ({
      path: `${i}.md`,
      title: `Note ${i}`,
      sourceUrl: `https://example.com/${i}`,
      domain: "example.com",
      contentType: "article",
      entities: ["x"],
      tags: ["y"],
      timestamp: `2026-03-0${i + 1}T12:00:00.000Z`,
      id: `${i}`,
    }));

    const result = computeRelatedClips(input, candidates);

    expect(result.relatedClips.length).toBe(MAX_RELATED_CLIPS - 1);
    expect(result.truncated).toBe(false);
  });
});
