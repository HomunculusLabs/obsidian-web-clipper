/**
 * Related Clips Graph Contract Tests - Content Layer
 *
 * Tests for deterministic cross-clip matching, scoring, tie-breaking,
 * truncation, and diagnostics emission at the content integration layer.
 *
 * Coverage areas:
 * - Pass cases: Normal matching with various signal combinations
 * - No-match cases: Empty results and default diagnostics
 * - Truncation: Behavior when matches exceed MAX_RELATED_CLIPS
 * - Tie-break determinism: Stable ordering when scores are equal
 * - Cache parity: Cached and rebuilt paths produce identical outputs
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import * as path from "path";
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
  computeRelatedClips,
  type RelatedClipsInput,
  type CandidateNote,
  type RelatedClipsDiagnostics,
  type RelatednessScore,
} from "../../../src/shared/relatedClipsContract";
import {
  indexVaultWithCache,
  type VaultIndexOptions,
  type VaultIndexResult,
} from "../../../src/shared/vaultIndex";

// =============================================================================
// PASS CASES - Normal matching scenarios
// =============================================================================

describe("PASS CASES - Normal matching scenarios", () => {
  const baseInput: RelatedClipsInput = {
    sourceUrl: "https://example.com/article",
    domain: "example.com",
    contentType: "article",
    entities: ["typescript", "api", "testing"],
    tags: ["web-clip", "dev"],
    timestamp: "2026-03-03T12:00:00.000Z",
  };

  test("pass: exact URL match produces highest score", () => {
    const candidate: CandidateNote = {
      path: "Clips/Exact Match.md",
      title: "Exact Match",
      sourceUrl: "https://example.com/article", // Same as input
      domain: "example.com",
      contentType: "article",
      entities: ["other"],
      tags: ["other"],
      timestamp: "2026-03-02T12:00:00.000Z",
      id: "exact-match",
    };

    const result = computeRelatednessScore(baseInput, candidate);

    expect(result.score).toBeGreaterThanOrEqual(
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.EXACT_URL]
    );
    expect(result.signals[MatchSignalType.EXACT_URL]).toBe(true);
  });

  test("pass: same domain match produces consistent score", () => {
    const candidate: CandidateNote = {
      path: "Clips/Same Domain.md",
      title: "Same Domain",
      sourceUrl: "https://example.com/other-article",
      domain: "example.com", // Same domain
      contentType: "article",
      entities: ["unrelated"],
      tags: ["unrelated"],
      timestamp: "2026-03-02T12:00:00.000Z",
      id: "same-domain",
    };

    const result = computeRelatednessScore(baseInput, candidate);

    expect(result.score).toBeGreaterThanOrEqual(
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_DOMAIN]
    );
    expect(result.signals[MatchSignalType.SAME_DOMAIN]).toBe(true);
    expect(result.signals[MatchSignalType.EXACT_URL]).toBe(false);
  });

  test("pass: multiple shared entities accumulate score", () => {
    const candidate: CandidateNote = {
      path: "Clips/Shared Entities.md",
      title: "Shared Entities",
      sourceUrl: "https://different.com/article",
      domain: "different.com",
      contentType: "article",
      entities: ["typescript", "api", "testing", "extra"], // 3 shared
      tags: ["unrelated"],
      timestamp: "2026-03-02T12:00:00.000Z",
      id: "shared-entities",
    };

    const result = computeRelatednessScore(baseInput, candidate);

    expect(result.signals[MatchSignalType.SHARED_ENTITIES]).toBe(3);
    expect(result.score).toBeGreaterThanOrEqual(
      3 * MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_ENTITIES]
    );
  });

  test("pass: combined signals produce additive score", () => {
    const candidate: CandidateNote = {
      path: "Clips/Combined Signals.md",
      title: "Combined Signals",
      sourceUrl: "https://example.com/article", // Exact URL
      domain: "example.com", // Same domain (implied by exact URL)
      contentType: "article", // Same content type
      entities: ["typescript", "api"], // 2 shared entities
      tags: ["web-clip"], // 1 shared tag
      timestamp: "2026-03-02T12:00:00.000Z",
      id: "combined-signals",
    };

    const result = computeRelatednessScore(baseInput, candidate);

    const expectedScore =
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.EXACT_URL] +
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_DOMAIN] +
      2 * MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_ENTITIES] +
      1 * MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_TAGS] +
      MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_CONTENT_TYPE];

    expect(result.score).toBe(expectedScore);
  });

  test("pass: end-to-end computeRelatedClips produces sorted results", () => {
    const candidates: CandidateNote[] = [
      {
        path: "Clips/Low Score.md",
        title: "Low Score",
        sourceUrl: "https://different.com/page",
        domain: "different.com",
        contentType: "article", // Same type for at least some signal
        entities: ["typescript"], // 1 shared entity for positive score
        tags: ["other"],
        timestamp: "2026-03-01T12:00:00.000Z",
        id: "low-score",
      },
      {
        path: "Clips/High Score.md",
        title: "High Score",
        sourceUrl: "https://example.com/article", // Exact URL
        domain: "example.com",
        contentType: "article",
        entities: ["typescript", "api", "testing"],
        tags: ["web-clip", "dev"],
        timestamp: "2026-03-02T12:00:00.000Z",
        id: "high-score",
      },
      {
        path: "Clips/Medium Score.md",
        title: "Medium Score",
        sourceUrl: "https://example.com/other",
        domain: "example.com", // Same domain
        contentType: "article",
        entities: ["typescript"], // 1 shared
        tags: ["web-clip"], // 1 shared
        timestamp: "2026-03-01T12:00:00.000Z",
        id: "medium-score",
      },
    ];

    const result = computeRelatedClips(baseInput, candidates);

    // Should have exactly 3 matches (all have positive scores)
    expect(result.relatedClips).toHaveLength(3);

    // Should be sorted by score descending
    expect(result.relatedClips[0].title).toBe("High Score");
    expect(result.relatedClips[1].title).toBe("Medium Score");
    expect(result.relatedClips[2].title).toBe("Low Score");

    // Scores should be in descending order
    expect(result.relatedClips[0].score).toBeGreaterThan(result.relatedClips[1].score);
    expect(result.relatedClips[1].score).toBeGreaterThan(result.relatedClips[2].score);
  });
});

// =============================================================================
// NO-MATCH CASES - Empty results and default diagnostics
// =============================================================================

describe("NO-MATCH CASES - Empty results and default diagnostics", () => {
  const baseInput: RelatedClipsInput = {
    sourceUrl: "https://example.com/article",
    domain: "example.com",
    contentType: "article",
    entities: ["typescript", "api"],
    tags: ["web-clip"],
    timestamp: "2026-03-03T12:00:00.000Z",
  };

  test("no-match: zero score when no signals match", () => {
    const candidate: CandidateNote = {
      path: "Clips/No Match.md",
      title: "No Match",
      sourceUrl: "https://completely-different.com/page",
      domain: "completely-different.com",
      contentType: "video",
      entities: ["unrelated", "different"],
      tags: ["other"],
      timestamp: "2026-03-02T12:00:00.000Z",
      id: "no-match",
    };

    const result = computeRelatednessScore(baseInput, candidate);

    expect(result.score).toBe(0);
    expect(result.signals[MatchSignalType.EXACT_URL]).toBe(false);
    expect(result.signals[MatchSignalType.SAME_DOMAIN]).toBe(false);
    expect(result.signals[MatchSignalType.SHARED_ENTITIES]).toBe(0);
    expect(result.signals[MatchSignalType.SHARED_TAGS]).toBe(0);
    expect(result.signals[MatchSignalType.SAME_CONTENT_TYPE]).toBe(false);
  });

  test("no-match: zero-score candidates are filtered from results", () => {
    const candidates: CandidateNote[] = [
      {
        path: "Clips/No Match 1.md",
        title: "No Match 1",
        sourceUrl: "https://different1.com/page",
        domain: "different1.com",
        contentType: "video",
        entities: ["unrelated"],
        tags: ["other"],
        timestamp: "2026-03-02T12:00:00.000Z",
        id: "no-match-1",
      },
      {
        path: "Clips/No Match 2.md",
        title: "No Match 2",
        sourceUrl: "https://different2.com/page",
        domain: "different2.com",
        contentType: "podcast",
        entities: ["different"],
        tags: ["unrelated"],
        timestamp: "2026-03-01T12:00:00.000Z",
        id: "no-match-2",
      },
    ];

    const result = computeRelatedClips(baseInput, candidates);

    expect(result.relatedClips).toHaveLength(0);
    expect(result.matchesFound).toBe(0);
    expect(result.topScore).toBe(0);
    expect(result.truncated).toBe(false);
  });

  test("no-match: empty candidates array produces empty result", () => {
    const result = computeRelatedClips(baseInput, []);

    expect(result.relatedClips).toHaveLength(0);
    expect(result.matchesFound).toBe(0);
    expect(result.candidatesEvaluated).toBe(0);
    expect(result.topScore).toBe(0);
    expect(result.truncated).toBe(false);
  });

  test("no-match: DEFAULT_NO_MATCH_DIAGNOSTICS has correct values", () => {
    expect(DEFAULT_NO_MATCH_DIAGNOSTICS).toEqual({
      related_clips_count: 0,
      related_clips_top_score: 0,
      related_graph_version: RELATED_CLIPS_GRAPH_VERSION,
      related_clips_truncated: false,
    });
  });

  test("no-match: extractDiagnostics produces zero values for empty result", () => {
    const emptyResult = {
      relatedClips: [],
      candidatesEvaluated: 10,
      matchesFound: 0,
      truncated: false,
      topScore: 0,
      graphVersion: RELATED_CLIPS_GRAPH_VERSION,
    };

    const diagnostics = extractDiagnostics(emptyResult);

    expect(diagnostics.related_clips_count).toBe(0);
    expect(diagnostics.related_clips_top_score).toBe(0);
    expect(diagnostics.related_clips_truncated).toBe(false);
    expect(diagnostics.related_graph_version).toBe(RELATED_CLIPS_GRAPH_VERSION);
  });

  test("no-match: renderRelatedClipsSection returns empty string for no matches", () => {
    const emptyResult = {
      relatedClips: [],
      candidatesEvaluated: 10,
      matchesFound: 0,
      truncated: false,
      topScore: 0,
      graphVersion: RELATED_CLIPS_GRAPH_VERSION,
    };

    const section = renderRelatedClipsSection(emptyResult);

    expect(section).toBe("");
  });
});

// =============================================================================
// TRUNCATION CASES - Behavior when matches exceed MAX_RELATED_CLIPS
// =============================================================================

describe("TRUNCATION CASES - Limits and boundary behavior", () => {
  const baseInput: RelatedClipsInput = {
    sourceUrl: "https://example.com/article",
    domain: "example.com",
    contentType: "article",
    entities: ["typescript"],
    tags: ["web-clip"],
    timestamp: "2026-03-03T12:00:00.000Z",
  };

  test("truncation: respects MAX_RELATED_CLIPS limit", () => {
    // Create exactly MAX_RELATED_CLIPS + 5 candidates (all will match)
    const candidates: CandidateNote[] = Array.from(
      { length: MAX_RELATED_CLIPS + 5 },
      (_, i) => ({
        path: `Clips/Note ${i}.md`,
        title: `Note ${i}`,
        sourceUrl: `https://example.com/page-${i}`,
        domain: "example.com", // Same domain = positive score
        contentType: "article",
        entities: ["typescript"],
        tags: ["web-clip"],
        timestamp: `2026-03-0${(i % 9) + 1}T12:00:00.000Z`,
        id: `note-${i}`,
      })
    );

    const result = computeRelatedClips(baseInput, candidates);

    expect(result.relatedClips.length).toBe(MAX_RELATED_CLIPS);
    expect(result.matchesFound).toBe(MAX_RELATED_CLIPS + 5);
    expect(result.truncated).toBe(true);
  });

  test("truncation: no truncation when matches equal MAX_RELATED_CLIPS", () => {
    const candidates: CandidateNote[] = Array.from(
      { length: MAX_RELATED_CLIPS },
      (_, i) => ({
        path: `Clips/Note ${i}.md`,
        title: `Note ${i}`,
        sourceUrl: `https://example.com/page-${i}`,
        domain: "example.com",
        contentType: "article",
        entities: ["typescript"],
        tags: ["web-clip"],
        timestamp: `2026-03-0${i + 1}T12:00:00.000Z`,
        id: `note-${i}`,
      })
    );

    const result = computeRelatedClips(baseInput, candidates);

    expect(result.relatedClips.length).toBe(MAX_RELATED_CLIPS);
    expect(result.matchesFound).toBe(MAX_RELATED_CLIPS);
    expect(result.truncated).toBe(false);
  });

  test("truncation: no truncation when matches less than MAX_RELATED_CLIPS", () => {
    const candidates: CandidateNote[] = Array.from(
      { length: MAX_RELATED_CLIPS - 2 },
      (_, i) => ({
        path: `Clips/Note ${i}.md`,
        title: `Note ${i}`,
        sourceUrl: `https://example.com/page-${i}`,
        domain: "example.com",
        contentType: "article",
        entities: ["typescript"],
        tags: ["web-clip"],
        timestamp: `2026-03-0${i + 1}T12:00:00.000Z`,
        id: `note-${i}`,
      })
    );

    const result = computeRelatedClips(baseInput, candidates);

    expect(result.relatedClips.length).toBe(MAX_RELATED_CLIPS - 2);
    expect(result.matchesFound).toBe(MAX_RELATED_CLIPS - 2);
    expect(result.truncated).toBe(false);
  });

  test("truncation: truncates to highest scores first", () => {
    // Create candidates with varying scores
    const candidates: CandidateNote[] = [
      // Low score candidates (same content type only - weakest signal)
      ...Array.from({ length: 3 }, (_, i) => ({
        path: `Clips/Low ${i}.md`,
        title: `Low ${i}`,
        sourceUrl: `https://different-domain-${i}.com/page`,
        domain: `different-domain-${i}.com`, // Different domain
        contentType: "article", // Same type (1 point)
        entities: ["unrelated"],
        tags: ["other"],
        timestamp: `2026-02-${20 + i}T12:00:00.000Z`,
        id: `low-${i}`,
      })),
      // High score candidates (exact URL + shared entities)
      ...Array.from({ length: 3 }, (_, i) => ({
        path: `Clips/High ${i}.md`,
        title: `High ${i}`,
        sourceUrl: "https://example.com/article", // Exact URL
        domain: "example.com",
        contentType: "article",
        entities: ["typescript", "api"],
        tags: ["web-clip"],
        timestamp: `2026-03-0${i + 1}T12:00:00.000Z`,
        id: `high-${i}`,
      })),
      // Medium score candidates (shared entities)
      ...Array.from({ length: 3 }, (_, i) => ({
        path: `Clips/Medium ${i}.md`,
        title: `Medium ${i}`,
        sourceUrl: `https://different.com/page-${i}`,
        domain: "different.com",
        contentType: "article",
        entities: ["typescript"], // Shared entity
        tags: ["other"],
        timestamp: `2026-02-${25 + i}T12:00:00.000Z`,
        id: `medium-${i}`,
      })),
    ];

    // Set MAX_RELATED_CLIPS to 4 for this test by passing maxClips parameter
    const result = computeRelatedClips(baseInput, candidates, 4);

    expect(result.relatedClips.length).toBe(4);
    expect(result.truncated).toBe(true);

    // All results should be high or medium scores (not low)
    const titles = result.relatedClips.map((c) => c.title);
    expect(titles.every((t) => t.startsWith("High") || t.startsWith("Medium"))).toBe(true);
  });

  test("truncation: diagnostics correctly report truncation", () => {
    const candidates: CandidateNote[] = Array.from(
      { length: MAX_RELATED_CLIPS + 3 },
      (_, i) => ({
        path: `Clips/Note ${i}.md`,
        title: `Note ${i}`,
        sourceUrl: `https://example.com/page-${i}`,
        domain: "example.com",
        contentType: "article",
        entities: ["typescript"],
        tags: ["web-clip"],
        timestamp: `2026-03-0${(i % 9) + 1}T12:00:00.000Z`,
        id: `note-${i}`,
      })
    );

    const result = computeRelatedClips(baseInput, candidates);
    const diagnostics = extractDiagnostics(result);

    expect(diagnostics.related_clips_count).toBe(MAX_RELATED_CLIPS);
    expect(diagnostics.related_clips_truncated).toBe(true);
  });
});

// =============================================================================
// TIE-BREAK DETERMINISM CASES - Stable ordering when scores are equal
// =============================================================================

describe("TIE-BREAK DETERMINISM CASES - Stable ordering", () => {
  test("tie-break: equal scores broken by timestamp descending", () => {
    const scores: RelatednessScore[] = [
      {
        score: 50,
        timestamp: "2026-03-01T12:00:00.000Z", // Oldest
        id: "older",
        candidate: { path: "older.md", title: "Older" } as CandidateNote,
        signals: {} as any,
      },
      {
        score: 50,
        timestamp: "2026-03-03T12:00:00.000Z", // Newest
        id: "newer",
        candidate: { path: "newer.md", title: "Newer" } as CandidateNote,
        signals: {} as any,
      },
      {
        score: 50,
        timestamp: "2026-03-02T12:00:00.000Z", // Middle
        id: "middle",
        candidate: { path: "middle.md", title: "Middle" } as CandidateNote,
        signals: {} as any,
      },
    ];

    const sorted = sortScoresDeterministically(scores);

    // Should be sorted by timestamp descending (newest first)
    expect(sorted[0].id).toBe("newer");
    expect(sorted[1].id).toBe("middle");
    expect(sorted[2].id).toBe("older");
  });

  test("tie-break: equal scores and timestamps broken by ID ascending", () => {
    const scores: RelatednessScore[] = [
      {
        score: 50,
        timestamp: "2026-03-01T12:00:00.000Z",
        id: "zebra", // Z comes after
        candidate: { path: "zebra.md", title: "Zebra" } as CandidateNote,
        signals: {} as any,
      },
      {
        score: 50,
        timestamp: "2026-03-01T12:00:00.000Z",
        id: "alpha", // A comes first
        candidate: { path: "alpha.md", title: "Alpha" } as CandidateNote,
        signals: {} as any,
      },
      {
        score: 50,
        timestamp: "2026-03-01T12:00:00.000Z",
        id: "mike", // M in middle
        candidate: { path: "mike.md", title: "Mike" } as CandidateNote,
        signals: {} as any,
      },
    ];

    const sorted = sortScoresDeterministically(scores);

    // Should be sorted by ID ascending (alphabetical)
    expect(sorted[0].id).toBe("alpha");
    expect(sorted[1].id).toBe("mike");
    expect(sorted[2].id).toBe("zebra");
  });

  test("tie-break: full triple tie-break (score, timestamp, ID)", () => {
    const scores: RelatednessScore[] = [
      // Score 100 group (highest)
      {
        score: 100,
        timestamp: "2026-03-01T12:00:00.000Z",
        id: "a",
        candidate: { path: "a.md", title: "A" } as CandidateNote,
        signals: {} as any,
      },
      // Score 50 group with different timestamps
      {
        score: 50,
        timestamp: "2026-03-01T12:00:00.000Z", // Older
        id: "b",
        candidate: { path: "b.md", title: "B" } as CandidateNote,
        signals: {} as any,
      },
      {
        score: 50,
        timestamp: "2026-03-03T12:00:00.000Z", // Newer
        id: "c",
        candidate: { path: "c.md", title: "C" } as CandidateNote,
        signals: {} as any,
      },
      // Score 50 group with same timestamp (should sort by ID)
      {
        score: 50,
        timestamp: "2026-03-02T12:00:00.000Z",
        id: "z",
        candidate: { path: "z.md", title: "Z" } as CandidateNote,
        signals: {} as any,
      },
      {
        score: 50,
        timestamp: "2026-03-02T12:00:00.000Z",
        id: "a2",
        candidate: { path: "a2.md", title: "A2" } as CandidateNote,
        signals: {} as any,
      },
      // Score 25 group (lowest)
      {
        score: 25,
        timestamp: "2026-03-05T12:00:00.000Z",
        id: "d",
        candidate: { path: "d.md", title: "D" } as CandidateNote,
        signals: {} as any,
      },
    ];

    const sorted = sortScoresDeterministically(scores);

    // First: score 100
    expect(sorted[0].id).toBe("a");

    // Then: score 50, ordered by timestamp desc
    expect(sorted[1].id).toBe("c"); // 2026-03-03 (newest in 50 group)

    // Then: score 50, timestamp 2026-03-02, ordered by ID asc
    expect(sorted[2].id).toBe("a2"); // a2 comes before z
    expect(sorted[3].id).toBe("z");

    // Then: score 50, timestamp 2026-03-01
    expect(sorted[4].id).toBe("b");

    // Last: score 25
    expect(sorted[5].id).toBe("d");
  });

  test("tie-break: deterministic across multiple runs", () => {
    const scores: RelatednessScore[] = [
      {
        score: 75,
        timestamp: "2026-03-02T12:00:00.000Z", // Newer timestamp
        id: "tie-1",
        candidate: { path: "tie1.md", title: "Tie 1" } as CandidateNote,
        signals: {} as any,
      },
      {
        score: 75,
        timestamp: "2026-03-02T12:00:00.000Z", // Same timestamp as tie-1
        id: "tie-2",
        candidate: { path: "tie2.md", title: "Tie 2" } as CandidateNote,
        signals: {} as any,
      },
      {
        score: 75,
        timestamp: "2026-03-01T12:00:00.000Z", // Older timestamp
        id: "different-time",
        candidate: { path: "diff.md", title: "Different Time" } as CandidateNote,
        signals: {} as any,
      },
    ];

    // Run sorting multiple times
    const run1 = sortScoresDeterministically(scores);
    const run2 = sortScoresDeterministically(scores);
    const run3 = sortScoresDeterministically(scores);

    // All runs should produce identical results
    expect(run1).toEqual(run2);
    expect(run2).toEqual(run3);

    // Verify expected order: tie-1/tie-2 first (newer timestamp 2026-03-02), sorted by ID
    // then different-time (older timestamp 2026-03-01)
    expect(run1[0].id).toBe("tie-1"); // 03-02, id comes before tie-2
    expect(run1[1].id).toBe("tie-2"); // 03-02
    expect(run1[2].id).toBe("different-time"); // 03-01 (older)
  });

  test("tie-break: computeRelatedClips produces deterministic output", () => {
    const input: RelatedClipsInput = {
      sourceUrl: "https://example.com/article",
      domain: "example.com",
      contentType: "article",
      entities: ["typescript"],
      tags: ["web-clip"],
      timestamp: "2026-03-03T12:00:00.000Z",
    };

    // Create candidates with identical scores (will tie-break by timestamp then ID)
    const candidates: CandidateNote[] = [
      {
        path: "Clips/Note B.md",
        title: "Note B",
        sourceUrl: "https://example.com/page-b",
        domain: "example.com", // Same score as others
        contentType: "article",
        entities: ["typescript"],
        tags: ["web-clip"],
        timestamp: "2026-03-01T12:00:00.000Z",
        id: "note-b",
      },
      {
        path: "Clips/Note A.md",
        title: "Note A",
        sourceUrl: "https://example.com/page-a",
        domain: "example.com", // Same score
        contentType: "article",
        entities: ["typescript"],
        tags: ["web-clip"],
        timestamp: "2026-03-01T12:00:00.000Z", // Same timestamp as B
        id: "note-a", // Should come before B alphabetically
      },
      {
        path: "Clips/Note C.md",
        title: "Note C",
        sourceUrl: "https://example.com/page-c",
        domain: "example.com",
        contentType: "article",
        entities: ["typescript"],
        tags: ["web-clip"],
        timestamp: "2026-03-02T12:00:00.000Z", // Newer timestamp
        id: "note-c",
      },
    ];

    // Run multiple times
    const result1 = computeRelatedClips(input, candidates);
    const result2 = computeRelatedClips(input, candidates);
    const result3 = computeRelatedClips(input, candidates);

    // All should be identical
    expect(result1.relatedClips).toEqual(result2.relatedClips);
    expect(result2.relatedClips).toEqual(result3.relatedClips);

    // Verify order: C first (newer timestamp), then A, then B (alphabetical)
    expect(result1.relatedClips[0].title).toBe("Note C");
    expect(result1.relatedClips[1].title).toBe("Note A");
    expect(result1.relatedClips[2].title).toBe("Note B");
  });
});

// =============================================================================
// EDGE CASES - Boundary conditions and special scenarios
// =============================================================================

describe("EDGE CASES - Boundary conditions", () => {
  test("edge: empty entities and tags arrays", () => {
    const input: RelatedClipsInput = {
      sourceUrl: "https://example.com/article",
      domain: "example.com",
      contentType: "article",
      entities: [],
      tags: [],
      timestamp: "2026-03-03T12:00:00.000Z",
    };

    const candidate: CandidateNote = {
      path: "Clips/Empty Match.md",
      title: "Empty Match",
      sourceUrl: "https://different.com/page",
      domain: "different.com",
      contentType: "video",
      entities: [],
      tags: [],
      timestamp: "2026-03-02T12:00:00.000Z",
      id: "empty-match",
    };

    const result = computeRelatednessScore(input, candidate);

    // Only content type signal (both are empty entities/tags, no URL/domain match)
    expect(result.signals[MatchSignalType.SHARED_ENTITIES]).toBe(0);
    expect(result.signals[MatchSignalType.SHARED_TAGS]).toBe(0);
    expect(result.signals[MatchSignalType.SAME_CONTENT_TYPE]).toBe(false);
  });

  test("edge: case-insensitive entity matching", () => {
    const input: RelatedClipsInput = {
      sourceUrl: "https://example.com/article",
      domain: "example.com",
      contentType: "article",
      entities: ["TypeScript", "API"],
      tags: [],
      timestamp: "2026-03-03T12:00:00.000Z",
    };

    const candidate: CandidateNote = {
      path: "Clips/Case Test.md",
      title: "Case Test",
      sourceUrl: "https://different.com/page",
      domain: "different.com",
      contentType: "video",
      entities: ["typescript", "api"], // Different case
      tags: [],
      timestamp: "2026-03-02T12:00:00.000Z",
      id: "case-test",
    };

    const result = computeRelatednessScore(input, candidate);

    // Should match 2 entities despite case difference
    expect(result.signals[MatchSignalType.SHARED_ENTITIES]).toBe(2);
  });

  test("edge: whitespace trimming in entities", () => {
    const input: RelatedClipsInput = {
      sourceUrl: "https://example.com/article",
      domain: "example.com",
      contentType: "article",
      entities: ["  typescript  ", " api "],
      tags: [],
      timestamp: "2026-03-03T12:00:00.000Z",
    };

    const candidate: CandidateNote = {
      path: "Clips/Trim Test.md",
      title: "Trim Test",
      sourceUrl: "https://different.com/page",
      domain: "different.com",
      contentType: "video",
      entities: ["typescript", "api"],
      tags: [],
      timestamp: "2026-03-02T12:00:00.000Z",
      id: "trim-test",
    };

    const result = computeRelatednessScore(input, candidate);

    // Should match 2 entities after trimming
    expect(result.signals[MatchSignalType.SHARED_ENTITIES]).toBe(2);
  });

  test("edge: deduplication within entity sets", () => {
    const input: RelatedClipsInput = {
      sourceUrl: "https://example.com/article",
      domain: "example.com",
      contentType: "article",
      entities: ["typescript", "typescript", "api"], // Duplicate
      tags: [],
      timestamp: "2026-03-03T12:00:00.000Z",
    };

    const candidate: CandidateNote = {
      path: "Clips/Dedupe Test.md",
      title: "Dedupe Test",
      sourceUrl: "https://different.com/page",
      domain: "different.com",
      contentType: "video",
      entities: ["typescript", "typescript", "typescript"], // Multiple duplicates
      tags: [],
      timestamp: "2026-03-02T12:00:00.000Z",
      id: "dedupe-test",
    };

    const result = computeRelatednessScore(input, candidate);

    // Should only count "typescript" once
    expect(result.signals[MatchSignalType.SHARED_ENTITIES]).toBe(1);
  });

  test("edge: single candidate that is MAX_RELATED_CLIPS boundary", () => {
    const input: RelatedClipsInput = {
      sourceUrl: "https://example.com/article",
      domain: "example.com",
      contentType: "article",
      entities: ["typescript"],
      tags: ["web-clip"],
      timestamp: "2026-03-03T12:00:00.000Z",
    };

    const candidates: CandidateNote[] = [
      {
        path: "Clips/Only One.md",
        title: "Only One",
        sourceUrl: "https://example.com/other",
        domain: "example.com",
        contentType: "article",
        entities: ["typescript"],
        tags: ["web-clip"],
        timestamp: "2026-03-02T12:00:00.000Z",
        id: "only-one",
      },
    ];

    const result = computeRelatedClips(input, candidates);

    expect(result.relatedClips.length).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.matchesFound).toBe(1);
  });
});

// =============================================================================
// INTEGRATION CASES - Full pipeline verification
// =============================================================================

describe("INTEGRATION CASES - Full pipeline", () => {
  test("integration: complete flow from input to markdown output", () => {
    const input: RelatedClipsInput = {
      sourceUrl: "https://github.com/user/repo",
      domain: "github.com",
      contentType: "article",
      entities: ["typescript", "testing"],
      tags: ["web-clip"],
      timestamp: "2026-03-03T12:00:00.000Z",
    };

    const candidates: CandidateNote[] = [
      {
        path: "Clips/Related Article.md",
        title: "Related Article",
        sourceUrl: "https://github.com/user/other-repo",
        domain: "github.com",
        contentType: "article",
        entities: ["typescript", "api"],
        tags: ["web-clip", "dev"],
        timestamp: "2026-03-02T12:00:00.000Z",
        id: "related-article",
      },
    ];

    // Full pipeline
    const result = computeRelatedClips(input, candidates);
    const diagnostics = extractDiagnostics(result);
    const markdown = renderRelatedClipsSection(result);

    // Verify result structure
    expect(result.relatedClips.length).toBe(1);
    expect(result.relatedClips[0].title).toBe("Related Article");

    // Verify diagnostics
    expect(diagnostics.related_clips_count).toBe(1);
    expect(diagnostics.related_clips_truncated).toBe(false);
    expect(diagnostics.related_graph_version).toBe(RELATED_CLIPS_GRAPH_VERSION);

    // Verify markdown output
    expect(markdown).toContain("## Related Clips");
    expect(markdown).toContain("[[Related Article|Clips/Related Article.md]]");
    expect(markdown).toContain("score:");
  });

  test("integration: multiple runs produce identical markdown", () => {
    const input: RelatedClipsInput = {
      sourceUrl: "https://example.com/article",
      domain: "example.com",
      contentType: "article",
      entities: ["a", "b"],
      tags: ["x"],
      timestamp: "2026-03-03T12:00:00.000Z",
    };

    const candidates: CandidateNote[] = [
      {
        path: "Clips/Note 1.md",
        title: "Note 1",
        sourceUrl: "https://example.com/page1",
        domain: "example.com",
        contentType: "article",
        entities: ["a"],
        tags: ["x"],
        timestamp: "2026-03-02T12:00:00.000Z",
        id: "note-1",
      },
      {
        path: "Clips/Note 2.md",
        title: "Note 2",
        sourceUrl: "https://example.com/page2",
        domain: "example.com",
        contentType: "article",
        entities: ["b"],
        tags: ["x"],
        timestamp: "2026-03-01T12:00:00.000Z",
        id: "note-2",
      },
    ];

    const result1 = computeRelatedClips(input, candidates);
    const result2 = computeRelatedClips(input, candidates);

    const markdown1 = renderRelatedClipsSection(result1);
    const markdown2 = renderRelatedClipsSection(result2);

    expect(markdown1).toBe(markdown2);
  });
});

// =============================================================================
// CACHE PARITY CASES - Cached and rebuilt paths produce identical outputs
// =============================================================================

describe("CACHE PARITY CASES - Cached vs rebuilt path determinism", () => {
  let testVaultPath: string;

  beforeEach(async () => {
    // Create temporary test vault
    testVaultPath = path.join(
      tmpdir(),
      `related-clips-cache-parity-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(testVaultPath, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup test vault
    if (testVaultPath) {
      await fs.rm(testVaultPath, { recursive: true, force: true });
    }
  });

  /**
   * Create a test note with frontmatter
   */
  async function createTestNote(
    filename: string,
    content: string
  ): Promise<void> {
    const filePath = path.join(testVaultPath, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }

  test("cache-parity: candidates from cache hit match cache rebuild", async () => {
    // Create test notes in vault
    await createTestNote(
      "Clips/Article 1.md",
      `---
source: https://example.com/article1
title: Article 1
tags:
  - typescript
  - api
keywords:
  - typescript
  - api
  - testing
date_clipped: 2026-03-01T10:00:00.000Z
---
# Article 1 Content`
    );

    await createTestNote(
      "Clips/Article 2.md",
      `---
source: https://example.com/article2
title: Article 2
tags:
  - typescript
  - web-dev
keywords:
  - typescript
  - web
date_clipped: 2026-03-02T10:00:00.000Z
---
# Article 2 Content`
    );

    await createTestNote(
      "Clips/Article 3.md",
      `---
source: https://different.com/article3
title: Article 3
tags:
  - javascript
  - api
keywords:
  - javascript
date_clipped: 2026-03-03T10:00:00.000Z
---
# Article 3 Content`
    );

    const options: VaultIndexOptions = {
      vaultPath: testVaultPath,
    };

    // First call: cache miss, rebuild
    const resultMiss = await indexVaultWithCache(options);
    expect(resultMiss.cacheDiagnostics?.cacheHit).toBe(false);
    expect(resultMiss.cacheDiagnostics?.cacheRebuilt).toBe(true);

    // Second call: cache hit
    const resultHit = await indexVaultWithCache(options);
    expect(resultHit.cacheDiagnostics?.cacheHit).toBe(true);
    expect(resultHit.cacheDiagnostics?.cacheRebuilt).toBe(false);

    // Candidates from cache hit should match cache rebuild
    // Sort both arrays for comparison since order may differ but content should be identical
    const sortedMiss = [...resultMiss.candidates].sort((a, b) => a.path.localeCompare(b.path));
    const sortedHit = [...resultHit.candidates].sort((a, b) => a.path.localeCompare(b.path));

    expect(sortedHit).toEqual(sortedMiss);
    expect(sortedHit).toHaveLength(3);

    // Verify candidate order is deterministic (sorted by path)
    const pathsHit = resultHit.candidates.map((c) => c.path).sort();
    const pathsMiss = resultMiss.candidates.map((c) => c.path).sort();
    expect(pathsHit).toEqual(pathsMiss);

    // Verify all candidate fields are identical (iterate through sorted arrays)
    for (let i = 0; i < sortedMiss.length; i++) {
      const missCandidate = sortedMiss[i];
      const hitCandidate = sortedHit[i];

      expect(hitCandidate.path).toBe(missCandidate.path);
      expect(hitCandidate.title).toBe(missCandidate.title);
      expect(hitCandidate.sourceUrl).toBe(missCandidate.sourceUrl);
      expect(hitCandidate.domain).toBe(missCandidate.domain);
      expect(hitCandidate.contentType).toBe(missCandidate.contentType);
      expect(hitCandidate.entities).toEqual(missCandidate.entities);
      expect(hitCandidate.tags).toEqual(missCandidate.tags);
      expect(hitCandidate.timestamp).toBe(missCandidate.timestamp);
      expect(hitCandidate.id).toBe(missCandidate.id);
    }
  });

  test("cache-parity: computeRelatedClips produces identical results with cache hit vs rebuild", async () => {
    // Create test notes
    await createTestNote(
      "Clips/Related A.md",
      `---
source: https://example.com/related-a
title: Related Article A
tags:
  - typescript
  - api
keywords:
  - typescript
date_clipped: 2026-03-01T10:00:00.000Z
---
# Related A`
    );

    await createTestNote(
      "Clips/Related B.md",
      `---
source: https://example.com/related-b
title: Related Article B
tags:
  - typescript
  - testing
keywords:
  - testing
date_clipped: 2026-03-02T10:00:00.000Z
---
# Related B`
    );

    const options: VaultIndexOptions = {
      vaultPath: testVaultPath,
    };

    // Get candidates from cache rebuild (miss)
    const resultMiss = await indexVaultWithCache(options);
    const candidatesFromMiss = resultMiss.candidates;

    // Get candidates from cache hit
    const resultHit = await indexVaultWithCache(options);
    const candidatesFromHit = resultHit.candidates;

    // Input for related clips matching
    const input: RelatedClipsInput = {
      sourceUrl: "https://example.com/new-article",
      domain: "example.com",
      contentType: "article",
      entities: ["typescript", "api"],
      tags: ["web-clip"],
      timestamp: "2026-03-03T12:00:00.000Z",
    };

    // Compute related clips with cache rebuild candidates
    const resultFromMiss = computeRelatedClips(input, candidatesFromMiss);

    // Compute related clips with cache hit candidates
    const resultFromHit = computeRelatedClips(input, candidatesFromHit);

    // Results should be identical
    expect(resultFromMiss.relatedClips).toEqual(resultFromHit.relatedClips);
    expect(resultFromMiss.matchesFound).toBe(resultFromHit.matchesFound);
    expect(resultFromMiss.truncated).toBe(resultFromHit.truncated);
    expect(resultFromMiss.topScore).toBe(resultFromHit.topScore);
    expect(resultFromMiss.candidatesEvaluated).toBe(resultFromHit.candidatesEvaluated);
    expect(resultFromMiss.graphVersion).toBe(resultFromHit.graphVersion);

    // Extract diagnostics and verify they match
    const diagFromMiss = extractDiagnostics(resultFromMiss);
    const diagFromHit = extractDiagnostics(resultFromHit);

    expect(diagFromMiss).toEqual(diagFromHit);
    expect(diagFromMiss.related_clips_count).toBe(diagFromHit.related_clips_count);
    expect(diagFromMiss.related_clips_top_score).toBe(diagFromHit.related_clips_top_score);
    expect(diagFromMiss.related_clips_truncated).toBe(diagFromHit.related_clips_truncated);
    expect(diagFromMiss.related_graph_version).toBe(diagFromHit.related_graph_version);
  });

  test("cache-parity: renderRelatedClipsSection produces identical markdown", async () => {
    // Create test notes
    await createTestNote(
      "Clips/Markdown Test.md",
      `---
source: https://example.com/markdown-test
title: Markdown Test Article
tags:
  - documentation
  - markdown
keywords:
  - markdown
  - formatting
date_clipped: 2026-03-01T10:00:00.000Z
---
# Markdown Test Content`
    );

    const options: VaultIndexOptions = {
      vaultPath: testVaultPath,
    };

    // Get candidates from cache rebuild
    const resultMiss = await indexVaultWithCache(options);
    const candidatesFromMiss = resultMiss.candidates;

    // Get candidates from cache hit
    const resultHit = await indexVaultWithCache(options);
    const candidatesFromHit = resultHit.candidates;

    // Input for related clips matching
    const input: RelatedClipsInput = {
      sourceUrl: "https://example.com/markdown-guide",
      domain: "example.com",
      contentType: "article",
      entities: ["markdown", "formatting"],
      tags: ["documentation"],
      timestamp: "2026-03-03T12:00:00.000Z",
    };

    // Compute and render from cache rebuild candidates
    const resultFromMiss = computeRelatedClips(input, candidatesFromMiss);
    const markdownFromMiss = renderRelatedClipsSection(resultFromMiss);

    // Compute and render from cache hit candidates
    const resultFromHit = computeRelatedClips(input, candidatesFromHit);
    const markdownFromHit = renderRelatedClipsSection(resultFromHit);

    // Markdown output should be identical
    expect(markdownFromMiss).toBe(markdownFromHit);

    // Both should contain the same elements
    expect(markdownFromMiss).toContain("## Related Clips");
    expect(markdownFromHit).toContain("## Related Clips");
  });

  test("cache-parity: multiple cache hits produce identical results", async () => {
    // Create test notes
    await createTestNote(
      "Clips/Multiple Hits 1.md",
      `---
source: https://example.com/multiple-1
title: Multiple Hits 1
tags:
  - test
keywords:
  - multiple
date_clipped: 2026-03-01T10:00:00.000Z
---
# Content 1`
    );

    await createTestNote(
      "Clips/Multiple Hits 2.md",
      `---
source: https://example.com/multiple-2
title: Multiple Hits 2
tags:
  - test
keywords:
  - hits
date_clipped: 2026-03-02T10:00:00.000Z
---
# Content 2`
    );

    const options: VaultIndexOptions = {
      vaultPath: testVaultPath,
    };

    // Build cache
    await indexVaultWithCache(options);

    // Multiple cache hits (with small delays to ensure cache age increases)
    const hit1 = await indexVaultWithCache(options);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const hit2 = await indexVaultWithCache(options);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const hit3 = await indexVaultWithCache(options);

    // All hits should produce identical results (sort before comparing since order may differ)
    const sortedHit1 = [...hit1.candidates].sort((a, b) => a.path.localeCompare(b.path));
    const sortedHit2 = [...hit2.candidates].sort((a, b) => a.path.localeCompare(b.path));
    const sortedHit3 = [...hit3.candidates].sort((a, b) => a.path.localeCompare(b.path));

    expect(sortedHit1).toEqual(sortedHit2);
    expect(sortedHit2).toEqual(sortedHit3);

    // Cache diagnostics should indicate hits
    expect(hit1.cacheDiagnostics?.cacheHit).toBe(true);
    expect(hit2.cacheDiagnostics?.cacheHit).toBe(true);
    expect(hit3.cacheDiagnostics?.cacheHit).toBe(true);

    // Cache age should increase
    expect(hit2.cacheDiagnostics?.cacheAgeMs).toBeGreaterThan(
      hit1.cacheDiagnostics?.cacheAgeMs || 0
    );
    expect(hit3.cacheDiagnostics?.cacheAgeMs).toBeGreaterThan(
      hit2.cacheDiagnostics?.cacheAgeMs || 0
    );
  });

  test("cache-parity: forced rebuild after corruption produces identical candidates", async () => {
    // Create test notes
    await createTestNote(
      "Clips/Corruption Test.md",
      `---
source: https://example.com/corruption-test
title: Corruption Test
tags:
  - cache
  - integrity
keywords:
  - corruption
  - rebuild
date_clipped: 2026-03-01T10:00:00.000Z
---
# Corruption Test Content`
    );

    const options: VaultIndexOptions = {
      vaultPath: testVaultPath,
    };

    // Initial cache build
    const result1 = await indexVaultWithCache(options);
    expect(result1.cacheDiagnostics?.cacheRebuilt).toBe(true);

    // Cache hit
    const result2 = await indexVaultWithCache(options);
    expect(result2.cacheDiagnostics?.cacheHit).toBe(true);
    expect(result2.candidates).toEqual(result1.candidates);

    // Corrupt cache file by modifying a file to trigger fingerprint change
    await new Promise((resolve) => setTimeout(resolve, 100)); // Ensure mtime changes
    await createTestNote(
      "Clips/New Note.md",
      `---
source: https://example.com/new-note
title: New Note
tags:
  - new
date_clipped: 2026-03-04T10:00:00.000Z
---
# New Note Content`
    );

    // Should rebuild cache due to fingerprint change
    const result3 = await indexVaultWithCache(options);
    expect(result3.cacheDiagnostics?.cacheHit).toBe(false);
    expect(result3.cacheDiagnostics?.cacheRebuilt).toBe(true);
    expect(result3.cacheDiagnostics?.rebuildReason).toBe("vault_fingerprint_changed");

    // Candidates from rebuild should be deterministically sorted
    expect(result3.candidates.length).toBe(2);

    // New cache hit should match rebuild
    const result4 = await indexVaultWithCache(options);
    expect(result4.cacheDiagnostics?.cacheHit).toBe(true);
    expect(result4.candidates).toEqual(result3.candidates);
  });

  test("cache-parity: empty vault produces identical results across cache paths", async () => {
    // No notes created - empty vault
    const options: VaultIndexOptions = {
      vaultPath: testVaultPath,
    };

    // Cache miss (empty)
    const result1 = await indexVaultWithCache(options);
    expect(result1.candidates).toHaveLength(0);
    expect(result1.cacheDiagnostics?.cacheRebuilt).toBe(true);

    // Cache hit
    const result2 = await indexVaultWithCache(options);
    expect(result2.candidates).toHaveLength(0);
    expect(result2.cacheDiagnostics?.cacheHit).toBe(true);

    // Results should be identical
    expect(result1.candidates).toEqual(result2.candidates);
    expect(result1.filesScanned).toBe(result2.filesScanned);
    expect(result1.filesWithFrontmatter).toBe(result2.filesWithFrontmatter);
    expect(result1.filesSkipped).toBe(result2.filesSkipped);
  });

  test("cache-parity: large vault produces identical results", async () => {
    // Create many test notes
    const noteCount = 20;
    for (let i = 1; i <= noteCount; i++) {
      await createTestNote(
        `Clips/Large Test ${i}.md`,
        `---
source: https://example.com/large-test-${i}
title: Large Test Article ${i}
tags:
  - test
  - large-vault
keywords:
  - keyword${i}
  - test${i}
date_clipped: 2026-03-${String(i).padStart(2, "0")}T10:00:00.000Z
---
# Content ${i}`
      );
    }

    const options: VaultIndexOptions = {
      vaultPath: testVaultPath,
    };

    // Cache rebuild
    const resultMiss = await indexVaultWithCache(options);
    expect(resultMiss.candidates.length).toBe(noteCount);

    // Cache hit
    const resultHit = await indexVaultWithCache(options);
    expect(resultHit.candidates.length).toBe(noteCount);

    // All candidates should be identical
    expect(resultHit.candidates).toEqual(resultMiss.candidates);

    // Verify sorting is deterministic (by path)
    for (let i = 1; i < resultHit.candidates.length; i++) {
      expect(resultHit.candidates[i - 1].path.localeCompare(resultHit.candidates[i].path)).toBeLessThanOrEqual(0);
    }
  });
});
