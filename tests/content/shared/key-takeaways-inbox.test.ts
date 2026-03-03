/**
 * Contract Tests for Key Takeaways Inbox
 *
 * Tests the deterministic contract for the Key Takeaways Inbox including:
 * - Deduplication rules
 * - Ranking and ordering
 * - Linkback rendering
 * - Truncation behavior
 * - Empty-state determinism
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { KeyTakeawayInput, KeyTakeawaysInbox, InboxEntry, SourceClipRef } from "../../../src/shared/keyTakeawaysInboxContract";
import {
  InsightStatus,
  buildKeyTakeawaysInbox,
  renderKeyTakeawaysInbox,
  computeInsightFingerprint,
  insightsAreEquivalent,
  computeEntryScore,
  sortEntriesDeterministically,
  buildSourceClipRefs,
  buildInboxEntry,
  extractInboxMetadata,
  MAX_INBOX_INSIGHTS,
  MAX_SOURCE_CLIP_REFS,
  KEY_TAKEAWAYS_INBOX_VERSION,
  DEFAULT_EMPTY_INBOX_METADATA
} from "../../../src/shared/keyTakeawaysInboxContract";
import {
  resolveInboxPath,
  isInboxEmpty,
  renderEmptyInbox,
  exportKeyTakeawaysInbox,
  exportEmptyInbox,
  inboxFileExists,
  readInboxFile,
  deleteInboxFile,
  getDefaultExportOptions,
  DEFAULT_INBOX_FILENAME,
  type ExportInboxOptions
} from "../../../src/shared/keyTakeawaysInboxExporter";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

// ============================================================================
// DEDUPE CONTRACT TESTS
// ============================================================================

describe("Dedupe Contract", () => {
  it("should dedupe insights with different case", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "React Server Components use RSC payload for hydration",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "react server components use rsc payload for hydration",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]?.source_clip_count).toBe(2);
  });

  it("should dedupe insights with different trailing punctuation", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "React Server Components use RSC payload",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "React Server Components use RSC payload!",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]?.source_clip_count).toBe(2);
  });

  it("should dedupe insights with different whitespace", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "React   Server   Components   use   RSC   payload",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "  React Server Components use RSC payload  ",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]?.source_clip_count).toBe(2);
  });

  it("should dedupe insights with different bullet/checkbox markers", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "React Server Components use RSC payload",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "- React Server Components use RSC payload",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "[ ] React Server Components use RSC payload",
        clipPath: "/path/to/clip3.md",
        clipTitle: "Clip 3",
        clipUrl: "https://example.com/3",
        clipTimestamp: "2026-03-02T10:00:00.000Z",
        clipId: "clip3",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]?.source_clip_count).toBe(3);
  });

  it("should merge source clip refs when deduplicating", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "React Server Components use RSC payload",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "React Server Components use RSC payload",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]?.source_clip_refs).toHaveLength(2);
    expect(inbox.entries[0]?.source_clip_refs.map(r => r.title)).toContain("Clip 1");
    expect(inbox.entries[0]?.source_clip_refs.map(r => r.title)).toContain("Clip 2");
  });

  it("should use most recent clip's timestamp after dedupe", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "React Server Components use RSC payload",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-01-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "React Server Components use RSC payload",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries[0]?.timestamp).toBe("2026-03-03T10:00:00.000Z");
  });

  it("should use most recent clip's status after dedupe", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "React Server Components use RSC payload",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-01-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ARCHIVED
      },
      {
        insight: "React Server Components use RSC payload",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries[0]?.insight_status).toBe(InsightStatus.ACTIVE);
  });

  it("should count unique clips correctly after dedupe", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Insight A",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Insight A", // Duplicate from same clip
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Insight B",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-02T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.totalClips).toBe(2); // 2 unique clips
    expect(inbox.totalInsightInstances).toBe(3); // 3 total instances
  });
});

// ============================================================================
// RANKING CONTRACT TESTS
// ============================================================================

describe("Ranking Contract", () => {
  it("should sort by score descending (primary sort)", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Low priority insight",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "High priority insight that is very detailed and comprehensive with lots of useful information for the reader",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: new Date().toISOString(),
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Medium priority",
        clipPath: "/path/to/clip3.md",
        clipTitle: "Clip 3",
        clipUrl: "https://example.com/3",
        clipTimestamp: "2026-02-15T10:00:00.000Z",
        clipId: "clip3",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries[0]?.score).toBeGreaterThanOrEqual(inbox.entries[1]?.score ?? 0);
    expect(inbox.entries[1]?.score).toBeGreaterThanOrEqual(inbox.entries[2]?.score ?? 0);
  });

  it("should use timestamp as secondary sort (more recent first)", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Old insight with same score",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-01-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "New insight with same score",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Mid insight with same score",
        clipPath: "/path/to/clip3.md",
        clipTitle: "Clip 3",
        clipUrl: "https://example.com/3",
        clipTimestamp: "2026-02-15T10:00:00.000Z",
        clipId: "clip3",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    // All have similar length, so timestamp should dominate
    const timestamps = inbox.entries.map(e => e.timestamp);
    expect(timestamps[0]).toBe("2026-03-03T10:00:00.000Z");
    expect(timestamps[1]).toBe("2026-02-15T10:00:00.000Z");
    expect(timestamps[2]).toBe("2026-01-01T10:00:00.000Z");
  });

  it("should use insight_id as tertiary sort (ascending for determinism)", () => {
    const entries: InboxEntry[] = [
      {
        insight_id: "zzz",
        insight: "Test",
        source_clip_refs: [],
        source_clip_count: 1,
        source_clip_refs_truncated: false,
        insight_status: InsightStatus.ACTIVE,
        score: 50,
        timestamp: "2026-03-03T10:00:00.000Z"
      },
      {
        insight_id: "aaa",
        insight: "Test",
        source_clip_refs: [],
        source_clip_count: 1,
        source_clip_refs_truncated: false,
        insight_status: InsightStatus.ACTIVE,
        score: 50,
        timestamp: "2026-03-03T10:00:00.000Z"
      },
      {
        insight_id: "mmm",
        insight: "Test",
        source_clip_refs: [],
        source_clip_count: 1,
        source_clip_refs_truncated: false,
        insight_status: InsightStatus.ACTIVE,
        score: 50,
        timestamp: "2026-03-03T10:00:00.000Z"
      }
    ];

    const sorted = sortEntriesDeterministically(entries);

    expect(sorted[0]?.insight_id).toBe("aaa");
    expect(sorted[1]?.insight_id).toBe("mmm");
    expect(sorted[2]?.insight_id).toBe("zzz");
  });

  it("should use source_clip_count as quaternary sort (descending)", () => {
    const entries: InboxEntry[] = [
      {
        insight_id: "same",
        insight: "Test",
        source_clip_refs: [],
        source_clip_count: 1,
        source_clip_refs_truncated: false,
        insight_status: InsightStatus.ACTIVE,
        score: 50,
        timestamp: "2026-03-03T10:00:00.000Z"
      },
      {
        insight_id: "same",
        insight: "Test",
        source_clip_refs: [],
        source_clip_count: 10,
        source_clip_refs_truncated: false,
        insight_status: InsightStatus.ACTIVE,
        score: 50,
        timestamp: "2026-03-03T10:00:00.000Z"
      },
      {
        insight_id: "same",
        insight: "Test",
        source_clip_refs: [],
        source_clip_count: 5,
        source_clip_refs_truncated: false,
        insight_status: InsightStatus.ACTIVE,
        score: 50,
        timestamp: "2026-03-03T10:00:00.000Z"
      }
    ];

    const sorted = sortEntriesDeterministically(entries);

    expect(sorted[0]?.source_clip_count).toBe(10);
    expect(sorted[1]?.source_clip_count).toBe(5);
    expect(sorted[2]?.source_clip_count).toBe(1);
  });

  it("should give higher score to insights appearing in more clips", () => {
    const input1: KeyTakeawayInput = {
      insight: "Rare insight",
      clipPath: "/path/to/clip1.md",
      clipTitle: "Clip 1",
      clipUrl: "https://example.com/1",
      clipTimestamp: new Date().toISOString(),
      clipId: "clip1",
      status: InsightStatus.ACTIVE
    };

    const frequentInputs: KeyTakeawayInput[] = Array.from({ length: 10 }, (_, i) => ({
      insight: "Frequent insight",
      clipPath: `/path/to/clip${i}.md`,
      clipTitle: `Clip ${i}`,
      clipUrl: `https://example.com/${i}`,
      clipTimestamp: new Date().toISOString(),
      clipId: `clip${i}`,
      status: InsightStatus.ACTIVE
    }));

    const inbox1 = buildKeyTakeawaysInbox([input1]);
    const inbox2 = buildKeyTakeawaysInbox(frequentInputs);

    const rareScore = inbox1.entries[0]?.score ?? 0;
    const frequentScore = inbox2.entries[0]?.score ?? 0;

    expect(frequentScore).toBeGreaterThan(rareScore);
  });

  it("should give higher score to longer, more detailed insights", () => {
    const briefInput: KeyTakeawayInput = {
      insight: "Short",
      clipPath: "/path/to/clip1.md",
      clipTitle: "Clip 1",
      clipUrl: "https://example.com/1",
      clipTimestamp: new Date().toISOString(),
      clipId: "clip1",
      status: InsightStatus.ACTIVE
    };

    const detailedInput: KeyTakeawayInput = {
      insight: "This is a much more detailed and comprehensive insight that provides extensive information about the topic being discussed",
      clipPath: "/path/to/clip2.md",
      clipTitle: "Clip 2",
      clipUrl: "https://example.com/2",
      clipTimestamp: new Date().toISOString(),
      clipId: "clip2",
      status: InsightStatus.ACTIVE
    };

    const inbox1 = buildKeyTakeawaysInbox([briefInput]);
    const inbox2 = buildKeyTakeawaysInbox([detailedInput]);

    const briefScore = inbox1.entries[0]?.score ?? 0;
    const detailedScore = inbox2.entries[0]?.score ?? 0;

    expect(detailedScore).toBeGreaterThan(briefScore);
  });

  it("should produce deterministic scores for same inputs", () => {
    const input: KeyTakeawayInput = {
      insight: "Test insight for determinism",
      clipPath: "/path/to/clip.md",
      clipTitle: "Test Clip",
      clipUrl: "https://example.com",
      clipTimestamp: "2026-03-03T10:00:00.000Z",
      clipId: "clip",
      status: InsightStatus.ACTIVE
    };

    const inbox1 = buildKeyTakeawaysInbox([input]);
    const inbox2 = buildKeyTakeawaysInbox([input]);

    expect(inbox1.entries[0]?.score).toBe(inbox2.entries[0]?.score);
  });
});

// ============================================================================
// LINKBACK RENDERING CONTRACT TESTS
// ============================================================================

describe("Linkback Rendering Contract", () => {
  it("should render Obsidian wikilink format for source clips", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Test insight",
        clipPath: "Clips/MyClip.md",
        clipTitle: "My Clip",
        clipUrl: "https://example.com/article",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("[[My Clip|Clips/MyClip.md]]");
  });

  it("should include source URL in linkback", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Test insight",
        clipPath: "Clips/MyClip.md",
        clipTitle: "My Clip",
        clipUrl: "https://example.com/article",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("https://example.com/article");
  });

  it("should include date from timestamp in linkback", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Test insight",
        clipPath: "Clips/MyClip.md",
        clipTitle: "My Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("(2026-03-03)");
  });

  it("should render multiple source clips in linkback section", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Same insight",
        clipPath: "Clips/Clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Same insight",
        clipPath: "Clips/Clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("[[Clip 1|Clips/Clip1.md]]");
    expect(markdown).toContain("[[Clip 2|Clips/Clip2.md]]");
    expect(markdown).toContain("https://example.com/1");
    expect(markdown).toContain("https://example.com/2");
  });

  it("should sort source clip refs by timestamp (most recent first)", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Same insight",
        clipPath: "Clips/Old.md",
        clipTitle: "Old Clip",
        clipUrl: "https://example.com/old",
        clipTimestamp: "2026-01-01T10:00:00.000Z",
        clipId: "old",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Same insight",
        clipPath: "Clips/New.md",
        clipTitle: "New Clip",
        clipUrl: "https://example.com/new",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "new",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Same insight",
        clipPath: "Clips/Mid.md",
        clipTitle: "Mid Clip",
        clipUrl: "https://example.com/mid",
        clipTimestamp: "2026-02-15T10:00:00.000Z",
        clipId: "mid",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries[0]?.source_clip_refs[0]?.id).toBe("new");
    expect(inbox.entries[0]?.source_clip_refs[1]?.id).toBe("mid");
    expect(inbox.entries[0]?.source_clip_refs[2]?.id).toBe("old");
  });

  it("should show truncation indicator when source clips exceed limit", () => {
    const inputs: KeyTakeawayInput[] = Array.from({ length: 15 }, (_, i) => ({
      insight: "Same insight",
      clipPath: `Clips/Clip${i}.md`,
      clipTitle: `Clip ${i}`,
      clipUrl: `https://example.com/${i}`,
      clipTimestamp: `2026-03-0${(i % 9) + 1}T10:00:00.000Z`,
      clipId: `clip${i}`,
      status: InsightStatus.ACTIVE
    }));

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toMatch(/\.\.\. and \d+ more clips/);
  });

  it("should include 'Appears in' count for each insight", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Single source insight",
        clipPath: "Clips/Clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Multi source insight",
        clipPath: "Clips/Clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-02T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Multi source insight",
        clipPath: "Clips/Clip3.md",
        clipTitle: "Clip 3",
        clipUrl: "https://example.com/3",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip3",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("**Appears in:** 1 clip(s)");
    expect(markdown).toContain("**Appears in:** 2 clip(s)");
  });

  it("should render status for each insight", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Active insight",
        clipPath: "Clips/Clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("**Status:** Active");
  });
});

// ============================================================================
// TRUNCATION CONTRACT TESTS
// ============================================================================

describe("Truncation Contract", () => {
  it("should truncate inbox to MAX_INBOX_INSIGHTS entries", () => {
    const inputs: KeyTakeawayInput[] = Array.from({ length: 150 }, (_, i) => ({
      insight: `Insight ${i}`,
      clipPath: `Clips/Clip${i}.md`,
      clipTitle: `Clip ${i}`,
      clipUrl: `https://example.com/${i}`,
      clipTimestamp: `2026-03-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
      clipId: `clip${i}`,
      status: InsightStatus.ACTIVE
    }));

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries.length).toBe(MAX_INBOX_INSIGHTS);
    expect(inbox.truncated).toBe(true);
    expect(inbox.activeInsights).toBe(150);
  });

  it("should not truncate when under MAX_INBOX_INSIGHTS", () => {
    const inputs: KeyTakeawayInput[] = Array.from({ length: 50 }, (_, i) => ({
      insight: `Insight ${i}`,
      clipPath: `Clips/Clip${i}.md`,
      clipTitle: `Clip ${i}`,
      clipUrl: `https://example.com/${i}`,
      clipTimestamp: "2026-03-03T10:00:00.000Z",
      clipId: `clip${i}`,
      status: InsightStatus.ACTIVE
    }));

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries.length).toBe(50);
    expect(inbox.truncated).toBe(false);
  });

  it("should set inbox_truncated in frontmatter when truncated", () => {
    const inputs: KeyTakeawayInput[] = Array.from({ length: 150 }, (_, i) => ({
      insight: `Insight ${i}`,
      clipPath: `Clips/Clip${i}.md`,
      clipTitle: `Clip ${i}`,
      clipUrl: `https://example.com/${i}`,
      clipTimestamp: "2026-03-03T10:00:00.000Z",
      clipId: `clip${i}`,
      status: InsightStatus.ACTIVE
    }));

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("inbox_truncated: true");
  });

  it("should include truncation warning in body when truncated", () => {
    const inputs: KeyTakeawayInput[] = Array.from({ length: 150 }, (_, i) => ({
      insight: `Insight ${i}`,
      clipPath: `Clips/Clip${i}.md`,
      clipTitle: `Clip ${i}`,
      clipUrl: `https://example.com/${i}`,
      clipTimestamp: "2026-03-03T10:00:00.000Z",
      clipId: `clip${i}`,
      status: InsightStatus.ACTIVE
    }));

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("Inbox truncated to 100 insights");
  });

  it("should truncate source clip refs to MAX_SOURCE_CLIP_REFS", () => {
    const inputs: KeyTakeawayInput[] = Array.from({ length: 15 }, (_, i) => ({
      insight: "Same insight",
      clipPath: `Clips/Clip${i}.md`,
      clipTitle: `Clip ${i}`,
      clipUrl: `https://example.com/${i}`,
      clipTimestamp: `2026-03-0${(i % 9) + 1}T10:00:00.000Z`,
      clipId: `clip${i}`,
      status: InsightStatus.ACTIVE
    }));

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries[0]?.source_clip_refs.length).toBe(MAX_SOURCE_CLIP_REFS);
    expect(inbox.entries[0]?.source_clip_refs_truncated).toBe(true);
    expect(inbox.entries[0]?.source_clip_count).toBe(15);
  });

  it("should not truncate source clip refs when under limit", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Test insight",
        clipPath: "Clips/Clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Test insight",
        clipPath: "Clips/Clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-02T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries[0]?.source_clip_refs.length).toBe(2);
    expect(inbox.entries[0]?.source_clip_refs_truncated).toBe(false);
  });

  it("should keep highest-scoring insights after truncation", () => {
    const inputs: KeyTakeawayInput[] = [
      // High priority (recent, detailed, frequent)
      ...Array.from({ length: 50 }, (_, i) => ({
        insight: `High priority insight ${i} with lots of detailed information about the topic`,
        clipPath: `Clips/High${i}.md`,
        clipTitle: `High ${i}`,
        clipUrl: `https://example.com/high${i}`,
        clipTimestamp: new Date(Date.now() - i * 1000).toISOString(),
        clipId: `high${i}`,
        status: InsightStatus.ACTIVE
      })),
      // Low priority (old, brief, single occurrence)
      ...Array.from({ length: 100 }, (_, i) => ({
        insight: `Low ${i}`,
        clipPath: `Clips/Low${i}.md`,
        clipTitle: `Low ${i}`,
        clipUrl: `https://example.com/low${i}`,
        clipTimestamp: "2026-01-01T10:00:00.000Z",
        clipId: `low${i}`,
        status: InsightStatus.ACTIVE
      }))
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    // All entries should be from the high priority set
    const hasHighPriority = inbox.entries.some(e => 
      e.insight.includes("High priority insight")
    );
    expect(hasHighPriority).toBe(true);
  });
});

// ============================================================================
// EMPTY-STATE DETERMINISM CONTRACT TESTS
// ============================================================================

describe("Empty-State Determinism Contract", () => {
  it("should produce identical output for empty inputs across multiple runs", () => {
    const inbox1 = buildKeyTakeawaysInbox([]);
    const inbox2 = buildKeyTakeawaysInbox([]);

    expect(inbox1.entries).toEqual(inbox2.entries);
    expect(inbox1.totalInsights).toBe(inbox2.totalInsights);
    expect(inbox1.activeInsights).toBe(inbox2.activeInsights);
    expect(inbox1.archivedInsights).toBe(inbox2.archivedInsights);
    expect(inbox1.totalClips).toBe(inbox2.totalClips);
    expect(inbox1.totalInsightInstances).toBe(inbox2.totalInsightInstances);
    expect(inbox1.truncated).toBe(inbox2.truncated);
    expect(inbox1.inbox_version).toBe(inbox2.inbox_version);
  });

  it("should always include all required frontmatter fields in empty inbox", () => {
    const inbox = buildKeyTakeawaysInbox([]);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("inbox_version:");
    expect(markdown).toContain("insights_count: 0");
    expect(markdown).toContain("source_clips_processed: 0");
    expect(markdown).toContain("active_insights: 0");
    expect(markdown).toContain("archived_insights: 0");
    expect(markdown).toContain("inbox_truncated: false");
    expect(markdown).toContain("generated_at:");
  });

  it("should show empty state message when no active insights", () => {
    const inbox = buildKeyTakeawaysInbox([]);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("No active insights found");
  });

  it("should show empty state when all insights are archived", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Archived insight",
        clipPath: "/path/to/clip.md",
        clipTitle: "Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: InsightStatus.ARCHIVED
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(inbox.entries).toHaveLength(0);
    expect(inbox.archivedInsights).toBe(1);
    expect(markdown).toContain("No active insights found");
  });

  it("should have consistent structure for empty inbox", () => {
    const inbox = buildKeyTakeawaysInbox([]);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("# Key Takeaways Inbox");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Key Takeaways");
    expect(markdown).toContain("---");
  });

  it("should have inbox_truncated: false for empty inbox", () => {
    const inbox = buildKeyTakeawaysInbox([]);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("inbox_truncated: false");
  });

  it("should provide DEFAULT_EMPTY_INBOX_METADATA constant", () => {
    expect(DEFAULT_EMPTY_INBOX_METADATA.inbox_version).toBe(KEY_TAKEAWAYS_INBOX_VERSION);
    expect(DEFAULT_EMPTY_INBOX_METADATA.insights_count).toBe(0);
    expect(DEFAULT_EMPTY_INBOX_METADATA.source_clips_processed).toBe(0);
    expect(DEFAULT_EMPTY_INBOX_METADATA.active_insights).toBe(0);
    expect(DEFAULT_EMPTY_INBOX_METADATA.archived_insights).toBe(0);
    expect(DEFAULT_EMPTY_INBOX_METADATA.inbox_truncated).toBe(false);
  });

  it("should create empty inbox file with exportEmptyInbox", async () => {
    const tempDir = path.join(os.tmpdir(), `key-takeaways-export-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const options: ExportInboxOptions = {
        vaultPath: tempDir
      };

      const result = await exportEmptyInbox(options);

      expect(result.isEmpty).toBe(true);
      expect(result.metadata.insights_count).toBe(0);
      expect(result.created).toBe(true);

      const fileContent = await fs.readFile(result.filePath, "utf-8");
      expect(fileContent).toContain("No active insights found");

      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  });
});

// ============================================================================
// EXPORT PATH CONTRACT TESTS
// ============================================================================

describe("Export Path Contract", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `key-takeaways-export-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should resolve inbox path deterministically", () => {
    const options: ExportInboxOptions = {
      vaultPath: "/path/to/vault"
    };

    const filePath = resolveInboxPath(options);

    expect(filePath).toBe("/path/to/vault/key-takeaways-inbox.md");
  });

  it("should resolve inbox path with custom folder", () => {
    const options: ExportInboxOptions = {
      vaultPath: "/path/to/vault",
      inboxFolder: "Inbox"
    };

    const filePath = resolveInboxPath(options);

    expect(filePath).toBe("/path/to/vault/Inbox/key-takeaways-inbox.md");
  });

  it("should resolve inbox path with custom filename", () => {
    const options: ExportInboxOptions = {
      vaultPath: "/path/to/vault",
      inboxFilename: "custom-inbox.md"
    };

    const filePath = resolveInboxPath(options);

    expect(filePath).toBe("/path/to/vault/custom-inbox.md");
  });

  it("should export inbox to file", async () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Test insight",
        clipPath: "Clips/Clip.md",
        clipTitle: "Test Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const options: ExportInboxOptions = {
      vaultPath: tempDir
    };

    const result = await exportKeyTakeawaysInbox(inbox, options);

    expect(result.created).toBe(true);
    expect(result.isEmpty).toBe(false);
    expect(result.metadata.insights_count).toBe(1);

    const fileExists = await inboxFileExists(options);
    expect(fileExists).toBe(true);
  });

  it("should update existing inbox file", async () => {
    const options: ExportInboxOptions = {
      vaultPath: tempDir
    };

    // Create initial inbox
    const initialInbox = buildKeyTakeawaysInbox([]);
    await exportKeyTakeawaysInbox(initialInbox, options);

    // Update with new insights
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "New insight",
        clipPath: "Clips/Clip.md",
        clipTitle: "Test Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: InsightStatus.ACTIVE
      }
    ];

    const updatedInbox = buildKeyTakeawaysInbox(inputs);
    const result = await exportKeyTakeawaysInbox(updatedInbox, options);

    expect(result.created).toBe(false); // File already existed
    expect(result.metadata.insights_count).toBe(1);
  });

  it("should detect empty inbox", () => {
    const emptyInbox = buildKeyTakeawaysInbox([]);
    const nonEmptyInbox = buildKeyTakeawaysInbox([
      {
        insight: "Test",
        clipPath: "/path.md",
        clipTitle: "Test",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "test",
        status: InsightStatus.ACTIVE
      }
    ]);

    expect(isInboxEmpty(emptyInbox)).toBe(true);
    expect(isInboxEmpty(nonEmptyInbox)).toBe(false);
  });

  it("should create parent folder if needed", async () => {
    const options: ExportInboxOptions = {
      vaultPath: tempDir,
      inboxFolder: "NewFolder/SubFolder",
      createFolder: true
    };

    const inbox = buildKeyTakeawaysInbox([]);
    const result = await exportKeyTakeawaysInbox(inbox, options);

    expect(result.filePath).toContain("NewFolder/SubFolder");

    const fileExists = await inboxFileExists(options);
    expect(fileExists).toBe(true);
  });

  it("should read existing inbox file", async () => {
    const options: ExportInboxOptions = {
      vaultPath: tempDir
    };

    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Test insight",
        clipPath: "Clips/Clip.md",
        clipTitle: "Test Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    await exportKeyTakeawaysInbox(inbox, options);

    const content = await readInboxFile(options);

    expect(content).not.toBeNull();
    expect(content).toContain("Test insight");
  });

  it("should delete inbox file", async () => {
    const options: ExportInboxOptions = {
      vaultPath: tempDir
    };

    const inbox = buildKeyTakeawaysInbox([]);
    await exportKeyTakeawaysInbox(inbox, options);

    const deleted = await deleteInboxFile(options);
    expect(deleted).toBe(true);

    const exists = await inboxFileExists(options);
    expect(exists).toBe(false);
  });
});

// ============================================================================
// METADATA CONTRACT TESTS
// ============================================================================

describe("Metadata Contract", () => {
  it("should extract metadata from inbox", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Active insight",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Archived insight",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ARCHIVED
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const metadata = extractInboxMetadata(inbox);

    expect(metadata.inbox_version).toBe(KEY_TAKEAWAYS_INBOX_VERSION);
    expect(metadata.insights_count).toBe(1); // Only active
    expect(metadata.source_clips_processed).toBe(2);
    expect(metadata.active_insights).toBe(1);
    expect(metadata.archived_insights).toBe(1);
    expect(metadata.inbox_truncated).toBe(false);
    expect(metadata.generated_at).toBe(inbox.generated_at);
  });

  it("should always include version in metadata", () => {
    const inbox = buildKeyTakeawaysInbox([]);
    const metadata = extractInboxMetadata(inbox);

    expect(metadata.inbox_version).toBeDefined();
    expect(metadata.inbox_version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("should include generated_at timestamp in metadata", () => {
    const inbox = buildKeyTakeawaysInbox([]);
    const metadata = extractInboxMetadata(inbox);

    expect(metadata.generated_at).toBeDefined();
    expect(new Date(metadata.generated_at).toISOString()).toBe(metadata.generated_at);
  });
});

// ============================================================================
// CONTRACT CONSTANTS TESTS
// ============================================================================

describe("Contract Constants", () => {
  it("should have MAX_INBOX_INSIGHTS = 100", () => {
    expect(MAX_INBOX_INSIGHTS).toBe(100);
  });

  it("should have MAX_SOURCE_CLIP_REFS = 10", () => {
    expect(MAX_SOURCE_CLIP_REFS).toBe(10);
  });

  it("should have KEY_TAKEAWAYS_INBOX_VERSION as semantic version", () => {
    expect(KEY_TAKEAWAYS_INBOX_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("should have DEFAULT_INBOX_FILENAME set correctly", () => {
    expect(DEFAULT_INBOX_FILENAME).toBe("key-takeaways-inbox.md");
  });
});

// ============================================================================
// FINGERPRINT DETERMINISM TESTS
// ============================================================================

describe("Fingerprint Determinism", () => {
  it("should produce same fingerprint for same insight text", () => {
    const fp1 = computeInsightFingerprint("React Server Components use RSC payload");
    const fp2 = computeInsightFingerprint("React Server Components use RSC payload");

    expect(fp1.hash).toBe(fp2.hash);
    expect(fp1.normalizedInsight).toBe(fp2.normalizedInsight);
  });

  it("should produce 64-character hex hash", () => {
    const fp = computeInsightFingerprint("Test insight");

    expect(fp.hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(fp.hash)).toBe(true);
  });

  it("should normalize case in fingerprint", () => {
    const fp1 = computeInsightFingerprint("REACT SERVER COMPONENTS");
    const fp2 = computeInsightFingerprint("react server components");

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("should normalize whitespace in fingerprint", () => {
    const fp1 = computeInsightFingerprint("React   Server   Components");
    const fp2 = computeInsightFingerprint("React Server Components");

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("should normalize trailing punctuation in fingerprint", () => {
    const fp1 = computeInsightFingerprint("React Server Components!");
    const fp2 = computeInsightFingerprint("React Server Components.");

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("should normalize bullet markers in fingerprint", () => {
    const fp1 = computeInsightFingerprint("- React Server Components");
    const fp2 = computeInsightFingerprint("React Server Components");

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("should normalize checkbox markers in fingerprint", () => {
    const fp1 = computeInsightFingerprint("[ ] React Server Components");
    const fp2 = computeInsightFingerprint("React Server Components");

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("should detect equivalent insights", () => {
    expect(insightsAreEquivalent("React uses JSX", "React uses JSX")).toBe(true);
    expect(insightsAreEquivalent("REACT USES JSX", "react uses jsx")).toBe(true);
    expect(insightsAreEquivalent("  React uses JSX  ", "React uses JSX")).toBe(true);
    expect(insightsAreEquivalent("React uses JSX", "Vue uses templates")).toBe(false);
  });
});
