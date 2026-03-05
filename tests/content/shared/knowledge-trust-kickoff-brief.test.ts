/**
 * Knowledge Trust Kickoff Brief Contract Tests
 *
 * Tests for deterministic ranking, dedupe, truncation, and rerun determinism.
 */

import { describe, it, expect } from "bun:test";
import {
  // Constants
  KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
  MAX_BRIEF_ITEMS,
  MAX_SOURCE_REFS,
  MAX_DESCRIPTION_LENGTH,

  // Enums
  RiskBand,
  TrustSourceType,
  TrustItemType,
  BriefItemStatus,
  RecommendedAction,

  // Functions
  computeBriefItemId,
  computeEntryScore,
  sortEntriesDeterministically,
  dedupeTrustItemInputs,
  buildSourceRefs,
  truncateDescription,
  buildBriefEntry,
  buildKnowledgeTrustKickoffBrief,
  extractBriefMetadata,
  renderKnowledgeTrustKickoffBrief,
  determineRecommendedAction,
  computePriorityReason,

  // Types
  type TrustItemInput,
  type BriefEntry,
} from "../../../src/shared/knowledgeTrustKickoffBriefContract";

describe("Knowledge Trust Kickoff Brief Contract", () => {
  describe("Constants", () => {
    it("should have correct version", () => {
      expect(KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION).toBe("1.0.0");
    });

    it("should have correct max items limit", () => {
      expect(MAX_BRIEF_ITEMS).toBe(20);
    });

    it("should have correct max source refs limit", () => {
      expect(MAX_SOURCE_REFS).toBe(5);
    });

    it("should have correct max description length", () => {
      expect(MAX_DESCRIPTION_LENGTH).toBe(300);
    });
  });

  describe("computeBriefItemId", () => {
    it("should generate deterministic IDs", () => {
      const id1 = computeBriefItemId("item-123", TrustSourceType.DASHBOARD);
      const id2 = computeBriefItemId("item-123", TrustSourceType.DASHBOARD);
      expect(id1).toBe(id2);
      expect(id1).toHaveLength(64); // 256-bit hex hash
    });

    it("should generate different IDs for different inputs", () => {
      const id1 = computeBriefItemId("item-123", TrustSourceType.DASHBOARD);
      const id2 = computeBriefItemId("item-124", TrustSourceType.DASHBOARD);
      const id3 = computeBriefItemId("item-123", TrustSourceType.STATE_SYNC);
      expect(id1).not.toBe(id2);
      expect(id1).not.toBe(id3);
    });
  });

  describe("computeEntryScore", () => {
    it("should score critical items higher than high", () => {
      const now = new Date().toISOString();
      const criticalScore = computeEntryScore(
        RiskBand.CRITICAL,
        TrustItemType.CONTRADICTION,
        now
      );
      const highScore = computeEntryScore(
        RiskBand.HIGH,
        TrustItemType.CONTRADICTION,
        now
      );
      expect(criticalScore).toBeGreaterThan(highScore);
    });

    it("should score contradictions higher than historical patterns", () => {
      const now = new Date().toISOString();
      const contradictionScore = computeEntryScore(
        RiskBand.HIGH,
        TrustItemType.CONTRADICTION,
        now
      );
      const patternScore = computeEntryScore(
        RiskBand.HIGH,
        TrustItemType.HISTORICAL_PATTERN,
        now
      );
      expect(contradictionScore).toBeGreaterThan(patternScore);
    });

    it("should decrease score with age", () => {
      const now = new Date();
      const recentDate = now.toISOString();
      const oldDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago

      const recentScore = computeEntryScore(
        RiskBand.HIGH,
        TrustItemType.CONTRADICTION,
        recentDate
      );
      const oldScore = computeEntryScore(
        RiskBand.HIGH,
        TrustItemType.CONTRADICTION,
        oldDate
      );
      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it("should produce deterministic scores", () => {
      const date = "2026-03-04T10:00:00.000Z";
      const score1 = computeEntryScore(RiskBand.HIGH, TrustItemType.CONTRADICTION, date);
      const score2 = computeEntryScore(RiskBand.HIGH, TrustItemType.CONTRADICTION, date);
      expect(score1).toBe(score2);
    });
  });

  describe("sortEntriesDeterministically", () => {
    it("should sort by score descending", () => {
      const entries: BriefEntry[] = [
        createMockEntry({ brief_item_id: "a", score: 50, risk_band: RiskBand.MEDIUM }),
        createMockEntry({ brief_item_id: "b", score: 80, risk_band: RiskBand.MEDIUM }),
        createMockEntry({ brief_item_id: "c", score: 30, risk_band: RiskBand.MEDIUM }),
      ];

      const sorted = sortEntriesDeterministically(entries);
      expect(sorted[0]!.brief_item_id).toBe("b");
      expect(sorted[1]!.brief_item_id).toBe("a");
      expect(sorted[2]!.brief_item_id).toBe("c");
    });

    it("should tie-break by risk band", () => {
      const entries: BriefEntry[] = [
        createMockEntry({ brief_item_id: "a", score: 70, risk_band: RiskBand.MEDIUM }),
        createMockEntry({ brief_item_id: "b", score: 70, risk_band: RiskBand.CRITICAL }),
        createMockEntry({ brief_item_id: "c", score: 70, risk_band: RiskBand.HIGH }),
      ];

      const sorted = sortEntriesDeterministically(entries);
      expect(sorted[0]!.brief_item_id).toBe("b"); // CRITICAL
      expect(sorted[1]!.brief_item_id).toBe("c"); // HIGH
      expect(sorted[2]!.brief_item_id).toBe("a"); // MEDIUM
    });

    it("should tie-break by last_updated_at", () => {
      const entries: BriefEntry[] = [
        createMockEntry({
          brief_item_id: "a",
          score: 70,
          risk_band: RiskBand.HIGH,
          last_updated_at: "2026-03-01T10:00:00.000Z",
        }),
        createMockEntry({
          brief_item_id: "b",
          score: 70,
          risk_band: RiskBand.HIGH,
          last_updated_at: "2026-03-03T10:00:00.000Z",
        }),
      ];

      const sorted = sortEntriesDeterministically(entries);
      expect(sorted[0]!.brief_item_id).toBe("b"); // More recent
      expect(sorted[1]!.brief_item_id).toBe("a");
    });

    it("should tie-break by brief_item_id for determinism", () => {
      const entries: BriefEntry[] = [
        createMockEntry({
          brief_item_id: "z",
          score: 70,
          risk_band: RiskBand.HIGH,
          last_updated_at: "2026-03-01T10:00:00.000Z",
        }),
        createMockEntry({
          brief_item_id: "a",
          score: 70,
          risk_band: RiskBand.HIGH,
          last_updated_at: "2026-03-01T10:00:00.000Z",
        }),
      ];

      const sorted = sortEntriesDeterministically(entries);
      expect(sorted[0]!.brief_item_id).toBe("a"); // Ascending
      expect(sorted[1]!.brief_item_id).toBe("z");
    });

    it("should produce stable output on identical inputs", () => {
      const entries: BriefEntry[] = [
        createMockEntry({ brief_item_id: "a", score: 50 }),
        createMockEntry({ brief_item_id: "b", score: 80 }),
        createMockEntry({ brief_item_id: "c", score: 30 }),
      ];

      const sorted1 = sortEntriesDeterministically(entries);
      const sorted2 = sortEntriesDeterministically(entries);

      expect(sorted1.map((e) => e.brief_item_id)).toEqual(
        sorted2.map((e) => e.brief_item_id)
      );
    });
  });

  describe("dedupeTrustItemInputs", () => {
    it("should dedupe by dashboard_item_id", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({ dashboard_item_id: "item-1", source_type: TrustSourceType.DASHBOARD }),
        createMockInput({ dashboard_item_id: "item-1", source_type: TrustSourceType.HISTORY }),
        createMockInput({ dashboard_item_id: "item-2", source_type: TrustSourceType.DASHBOARD }),
      ];

      const deduped = dedupeTrustItemInputs(inputs);
      expect(deduped).toHaveLength(2);
      expect(deduped.map((i) => i.dashboard_item_id).sort()).toEqual(["item-1", "item-2"]);
    });

    it("should prefer DASHBOARD over STATE_SYNC over HISTORY", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({
          dashboard_item_id: "item-1",
          source_type: TrustSourceType.HISTORY,
          description: "history version",
        }),
        createMockInput({
          dashboard_item_id: "item-1",
          source_type: TrustSourceType.STATE_SYNC,
          description: "state sync version",
        }),
        createMockInput({
          dashboard_item_id: "item-1",
          source_type: TrustSourceType.DASHBOARD,
          description: "dashboard version",
        }),
      ];

      const deduped = dedupeTrustItemInputs(inputs);
      expect(deduped).toHaveLength(1);
      expect(deduped[0]!.source_type).toBe(TrustSourceType.DASHBOARD);
      expect(deduped[0]!.description).toBe("dashboard version");
    });

    it("should escalate to highest risk band", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({
          dashboard_item_id: "item-1",
          source_type: TrustSourceType.DASHBOARD,
          risk_band: RiskBand.LOW,
        }),
        createMockInput({
          dashboard_item_id: "item-1",
          source_type: TrustSourceType.HISTORY,
          risk_band: RiskBand.CRITICAL,
        }),
      ];

      const deduped = dedupeTrustItemInputs(inputs);
      expect(deduped[0]!.risk_band).toBe(RiskBand.CRITICAL);
    });

    it("should merge related clip paths", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({
          dashboard_item_id: "item-1",
          source_type: TrustSourceType.DASHBOARD,
          related_clip_paths: ["clip-a.md"],
        }),
        createMockInput({
          dashboard_item_id: "item-1",
          source_type: TrustSourceType.HISTORY,
          related_clip_paths: ["clip-b.md", "clip-c.md"],
        }),
      ];

      const deduped = dedupeTrustItemInputs(inputs);
      expect(deduped[0]!.related_clip_paths!.sort()).toEqual(["clip-a.md", "clip-b.md", "clip-c.md"]);
    });

    it("should merge context fields", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({
          dashboard_item_id: "item-1",
          source_type: TrustSourceType.DASHBOARD,
          context: { key1: "value1" },
        }),
        createMockInput({
          dashboard_item_id: "item-1",
          source_type: TrustSourceType.HISTORY,
          context: { key2: "value2" },
        }),
      ];

      const deduped = dedupeTrustItemInputs(inputs);
      expect(deduped[0]!.context).toEqual({ key1: "value1", key2: "value2" });
    });
  });

  describe("buildSourceRefs", () => {
    it("should sort by timestamp descending", () => {
      const refs = [
        { source_type: TrustSourceType.DASHBOARD, source_path: "a.md", dashboard_item_id: "1", timestamp: "2026-03-01T10:00:00.000Z" },
        { source_type: TrustSourceType.DASHBOARD, source_path: "b.md", dashboard_item_id: "2", timestamp: "2026-03-03T10:00:00.000Z" },
        { source_type: TrustSourceType.DASHBOARD, source_path: "c.md", dashboard_item_id: "3", timestamp: "2026-03-02T10:00:00.000Z" },
      ];

      const { refs: sorted } = buildSourceRefs(refs);
      expect(sorted[0]!.source_path).toBe("b.md");
      expect(sorted[1]!.source_path).toBe("c.md");
      expect(sorted[2]!.source_path).toBe("a.md");
    });

    it("should truncate to MAX_SOURCE_REFS", () => {
      const refs = Array.from({ length: 10 }, (_, i) => ({
        source_type: TrustSourceType.DASHBOARD,
        source_path: `file-${i}.md`,
        dashboard_item_id: `${i}`,
        timestamp: `2026-03-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
      }));

      const { refs: trimmed, truncated } = buildSourceRefs(refs);
      expect(trimmed).toHaveLength(MAX_SOURCE_REFS);
      expect(truncated).toBe(true);
    });

    it("should not truncate when under limit", () => {
      const refs = Array.from({ length: 3 }, (_, i) => ({
        source_type: TrustSourceType.DASHBOARD,
        source_path: `file-${i}.md`,
        dashboard_item_id: `${i}`,
        timestamp: `2026-03-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
      }));

      const { refs: trimmed, truncated } = buildSourceRefs(refs);
      expect(trimmed).toHaveLength(3);
      expect(truncated).toBe(false);
    });
  });

  describe("truncateDescription", () => {
    it("should not truncate short descriptions", () => {
      const short = "Short description";
      const { truncated, wasTruncated } = truncateDescription(short);
      expect(truncated).toBe(short);
      expect(wasTruncated).toBe(false);
    });

    it("should truncate long descriptions", () => {
      const long = "a".repeat(500);
      const { truncated, wasTruncated } = truncateDescription(long);
      expect(truncated).toHaveLength(MAX_DESCRIPTION_LENGTH);
      expect(truncated.endsWith("...")).toBe(true);
      expect(wasTruncated).toBe(true);
    });

    it("should truncate at exactly MAX_DESCRIPTION_LENGTH", () => {
      const exact = "a".repeat(MAX_DESCRIPTION_LENGTH);
      const { truncated, wasTruncated } = truncateDescription(exact);
      expect(truncated).toBe(exact);
      expect(wasTruncated).toBe(false);
    });

    it("should truncate one over MAX_DESCRIPTION_LENGTH", () => {
      const over = "a".repeat(MAX_DESCRIPTION_LENGTH + 1);
      const { truncated, wasTruncated } = truncateDescription(over);
      expect(truncated).toHaveLength(MAX_DESCRIPTION_LENGTH);
      expect(wasTruncated).toBe(true);
    });
  });

  describe("determineRecommendedAction", () => {
    it("should recommend REVIEW_NOW for critical items", () => {
      const action = determineRecommendedAction(
        RiskBand.CRITICAL,
        TrustItemType.CONTRADICTION,
        BriefItemStatus.ACTIVE
      );
      expect(action).toBe(RecommendedAction.REVIEW_NOW);
    });

    it("should recommend REVIEW_NOW for high contradictions", () => {
      const action = determineRecommendedAction(
        RiskBand.HIGH,
        TrustItemType.CONTRADICTION,
        BriefItemStatus.ACTIVE
      );
      expect(action).toBe(RecommendedAction.REVIEW_NOW);
    });

    it("should recommend UPDATE_CONFIDENCE for high low-confidence items", () => {
      const action = determineRecommendedAction(
        RiskBand.HIGH,
        TrustItemType.LOW_CONFIDENCE,
        BriefItemStatus.ACTIVE
      );
      expect(action).toBe(RecommendedAction.UPDATE_CONFIDENCE);
    });

    it("should recommend ARCHIVE for resolved items", () => {
      const action = determineRecommendedAction(
        RiskBand.CRITICAL,
        TrustItemType.CONTRADICTION,
        BriefItemStatus.RESOLVED
      );
      expect(action).toBe(RecommendedAction.ARCHIVE);
    });

    it("should recommend MONITOR for low items", () => {
      const action = determineRecommendedAction(
        RiskBand.LOW,
        TrustItemType.HISTORICAL_PATTERN,
        BriefItemStatus.ACTIVE
      );
      expect(action).toBe(RecommendedAction.MONITOR);
    });
  });

  describe("computePriorityReason", () => {
    it("should return critical contradiction reason", () => {
      const reason = computePriorityReason(RiskBand.CRITICAL, TrustItemType.CONTRADICTION);
      expect(reason).toContain("contradiction");
      expect(reason).toContain("blocks");
    });

    it("should return high evidence gap reason", () => {
      const reason = computePriorityReason(RiskBand.HIGH, TrustItemType.EVIDENCE_GAP);
      expect(reason).toContain("Missing evidence");
    });

    it("should return fallback for unknown combinations", () => {
      const reason = computePriorityReason(RiskBand.LOW, TrustItemType.HISTORICAL_PATTERN);
      expect(reason).toBeDefined();
      expect(typeof reason).toBe("string");
    });
  });

  describe("buildBriefEntry", () => {
    it("should create entry with computed fields", () => {
      const input = createMockInput({
        dashboard_item_id: "test-item",
        item_type: TrustItemType.CONTRADICTION,
        risk_band: RiskBand.HIGH,
        description: "Test description",
      });

      const entry = buildBriefEntry(input);

      expect(entry.brief_item_id).toHaveLength(64);
      expect(entry.dashboard_item_id).toBe("test-item");
      expect(entry.item_type).toBe(TrustItemType.CONTRADICTION);
      expect(entry.risk_band).toBe(RiskBand.HIGH);
      expect(entry.score).toBeGreaterThan(0);
      expect(entry.priority_reason).toBeDefined();
      expect(entry.recommended_next_action).toBeDefined();
    });

    it("should truncate long descriptions", () => {
      const input = createMockInput({
        description: "a".repeat(500),
      });

      const entry = buildBriefEntry(input);
      expect(entry.description_truncated).toBe(true);
      expect(entry.description).toHaveLength(MAX_DESCRIPTION_LENGTH);
    });
  });

  describe("buildKnowledgeTrustKickoffBrief", () => {
    it("should build brief with correct metadata", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({ dashboard_item_id: "item-1", status: BriefItemStatus.ACTIVE }),
        createMockInput({ dashboard_item_id: "item-2", status: BriefItemStatus.RESOLVED }),
        createMockInput({ dashboard_item_id: "item-3", status: BriefItemStatus.IN_PROGRESS }),
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);

      expect(brief.brief_version).toBe(KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION);
      expect(brief.total_items).toBe(3);
      expect(brief.active_items).toBe(1);
      expect(brief.in_progress_items).toBe(1);
      expect(brief.resolved_items).toBe(1);
      expect(brief.entries).toHaveLength(2); // Only active + in-progress
    });

    it("should dedupe inputs", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({ dashboard_item_id: "item-1", source_type: TrustSourceType.DASHBOARD }),
        createMockInput({ dashboard_item_id: "item-1", source_type: TrustSourceType.HISTORY }),
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      expect(brief.total_items).toBe(1);
      expect(brief.entries).toHaveLength(1);
    });

    it("should truncate to MAX_BRIEF_ITEMS", () => {
      const inputs = Array.from({ length: 50 }, (_, i) => {
        return createMockInput({
          dashboard_item_id: `item-${i}`,
          risk_band: i % 2 === 0 ? RiskBand.HIGH : RiskBand.LOW,
        });
      });

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      expect(brief.entries).toHaveLength(MAX_BRIEF_ITEMS);
      expect(brief.truncated).toBe(true);
    });

    it("should sort entries by score", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({
          dashboard_item_id: "low",
          risk_band: RiskBand.LOW,
          item_type: TrustItemType.HISTORICAL_PATTERN,
        }),
        createMockInput({
          dashboard_item_id: "critical",
          risk_band: RiskBand.CRITICAL,
          item_type: TrustItemType.CONTRADICTION,
        }),
        createMockInput({
          dashboard_item_id: "high",
          risk_band: RiskBand.HIGH,
          item_type: TrustItemType.EVIDENCE_GAP,
        }),
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      expect(brief.entries[0]!.dashboard_item_id).toBe("critical");
      expect(brief.entries[1]!.dashboard_item_id).toBe("high");
      expect(brief.entries[2]!.dashboard_item_id).toBe("low");
    });

    it("should count risk bands correctly", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({ risk_band: RiskBand.CRITICAL }),
        createMockInput({ risk_band: RiskBand.HIGH }),
        createMockInput({ risk_band: RiskBand.HIGH }),
        createMockInput({ risk_band: RiskBand.MEDIUM }),
        createMockInput({ risk_band: RiskBand.LOW }),
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      expect(brief.risk_band_counts[RiskBand.CRITICAL]).toBe(1);
      expect(brief.risk_band_counts[RiskBand.HIGH]).toBe(2);
      expect(brief.risk_band_counts[RiskBand.MEDIUM]).toBe(1);
      expect(brief.risk_band_counts[RiskBand.LOW]).toBe(1);
    });

    it("should be deterministic on identical inputs", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({ dashboard_item_id: "item-1", risk_band: RiskBand.HIGH }),
        createMockInput({ dashboard_item_id: "item-2", risk_band: RiskBand.MEDIUM }),
      ];

      const brief1 = buildKnowledgeTrustKickoffBrief(inputs);
      const brief2 = buildKnowledgeTrustKickoffBrief(inputs);

      expect(brief1.entries.map((e) => e.brief_item_id)).toEqual(
        brief2.entries.map((e) => e.brief_item_id)
      );
      expect(brief1.risk_band_counts).toEqual(brief2.risk_band_counts);
    });

    it("should handle empty inputs", () => {
      const brief = buildKnowledgeTrustKickoffBrief([]);

      expect(brief.entries).toHaveLength(0);
      expect(brief.total_items).toBe(0);
      expect(brief.active_items).toBe(0);
      expect(brief.truncated).toBe(false);
      expect(brief.risk_band_counts[RiskBand.CRITICAL]).toBe(0);
    });
  });

  describe("extractBriefMetadata", () => {
    it("should extract correct metadata", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({ risk_band: RiskBand.HIGH }),
        createMockInput({ risk_band: RiskBand.MEDIUM }),
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const metadata = extractBriefMetadata(brief);

      expect(metadata.brief_version).toBe(KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION);
      expect(metadata.items_count).toBe(brief.entries.length);
      expect(metadata.active_items).toBe(brief.active_items);
      expect(metadata.risk_band_counts).toEqual(brief.risk_band_counts);
      expect(metadata.brief_truncated).toBe(brief.truncated);
    });
  });

  describe("renderKnowledgeTrustKickoffBrief", () => {
    it("should render valid markdown", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          risk_band: RiskBand.CRITICAL,
          description: "Critical contradiction detected",
        }),
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const markdown = renderKnowledgeTrustKickoffBrief(brief);

      expect(markdown).toContain("---");
      expect(markdown).toContain("brief_version:");
      expect(markdown).toContain("# Knowledge Trust Kickoff Brief");
      expect(markdown).toContain("[CRITICAL]");
      expect(markdown).toContain("contradiction");
    });

    it("should render empty state", () => {
      const brief = buildKnowledgeTrustKickoffBrief([]);
      const markdown = renderKnowledgeTrustKickoffBrief(brief);

      expect(markdown).toContain("✅ No active trust issues");
      expect(markdown).toContain("items_count: 0");
    });

    it("should include all metadata fields", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({ risk_band: RiskBand.HIGH }),
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const markdown = renderKnowledgeTrustKickoffBrief(brief);

      expect(markdown).toContain("brief_version:");
      expect(markdown).toContain("items_count:");
      expect(markdown).toContain("active_items:");
      expect(markdown).toContain("in_progress_items:");
      expect(markdown).toContain("resolved_items:");
      expect(markdown).toContain("dismissed_items:");
      expect(markdown).toContain("risk_band_counts:");
      expect(markdown).toContain("brief_truncated:");
      expect(markdown).toContain("generated_at:");
    });

    it("should render risk distribution", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({ risk_band: RiskBand.CRITICAL }),
        createMockInput({ risk_band: RiskBand.HIGH }),
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const markdown = renderKnowledgeTrustKickoffBrief(brief);

      expect(markdown).toContain("🔴 Critical:");
      expect(markdown).toContain("🟠 High:");
      expect(markdown).toContain("🟡 Medium:");
      expect(markdown).toContain("🟢 Low:");
    });

    it("should include truncation warning when truncated", () => {
      const inputs = Array.from({ length: 50 }, (_, i) => {
        return createMockInput({ dashboard_item_id: `item-${i}` });
      });

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const markdown = renderKnowledgeTrustKickoffBrief(brief);

      expect(brief.truncated).toBe(true);
      expect(markdown).toContain("truncated");
    });
  });

  describe("Rerun determinism", () => {
    it("should produce identical output on multiple runs", () => {
      const inputs: TrustItemInput[] = [
        createMockInput({ dashboard_item_id: "a", risk_band: RiskBand.HIGH }),
        createMockInput({ dashboard_item_id: "b", risk_band: RiskBand.CRITICAL }),
        createMockInput({ dashboard_item_id: "c", risk_band: RiskBand.MEDIUM }),
      ];

      const brief1 = buildKnowledgeTrustKickoffBrief(inputs);
      const brief2 = buildKnowledgeTrustKickoffBrief(inputs);
      const brief3 = buildKnowledgeTrustKickoffBrief(inputs);

      // Check all fields match
      expect(brief1.entries.map((e) => e.brief_item_id)).toEqual(
        brief2.entries.map((e) => e.brief_item_id)
      );
      expect(brief2.entries.map((e) => e.brief_item_id)).toEqual(
        brief3.entries.map((e) => e.brief_item_id)
      );

      expect(brief1.risk_band_counts).toEqual(brief2.risk_band_counts);
      expect(brief2.risk_band_counts).toEqual(brief3.risk_band_counts);

      // Check rendered output matches
      const markdown1 = renderKnowledgeTrustKickoffBrief(brief1);
      const markdown2 = renderKnowledgeTrustKickoffBrief(brief2);

      // Compare structure (excluding generated_at timestamp)
      const lines1 = markdown1.split("\n").filter((l) => !l.startsWith("generated_at:"));
      const lines2 = markdown2.split("\n").filter((l) => !l.startsWith("generated_at:"));
      expect(lines1).toEqual(lines2);
    });
  });
});

// Helper functions

function createMockInput(overrides: Partial<TrustItemInput> = {}): TrustItemInput {
  return {
    dashboard_item_id: `item-${Math.random().toString(36).slice(2)}`,
    item_type: TrustItemType.CONTRADICTION,
    description: "Test description",
    risk_band: RiskBand.HIGH,
    source_type: TrustSourceType.DASHBOARD,
    source_path: "knowledge-trust-dashboard.md",
    first_detected_at: "2026-03-01T10:00:00.000Z",
    last_updated_at: "2026-03-04T10:00:00.000Z",
    status: BriefItemStatus.ACTIVE,
    ...overrides,
  };
}

function createMockEntry(overrides: Partial<BriefEntry> = {}): BriefEntry {
  return {
    brief_item_id: `id-${Math.random().toString(36).slice(2)}`,
    dashboard_item_id: "item-1",
    item_type: TrustItemType.CONTRADICTION,
    description: "Test description",
    description_truncated: false,
    risk_band: RiskBand.HIGH,
    priority_reason: "Test reason",
    recommended_next_action: RecommendedAction.REVIEW_NOW,
    status: BriefItemStatus.ACTIVE,
    source_refs: [],
    source_ref_count: 0,
    source_refs_truncated: false,
    score: 50,
    last_updated_at: "2026-03-04T10:00:00.000Z",
    first_detected_at: "2026-03-01T10:00:00.000Z",
    ...overrides,
  };
}
