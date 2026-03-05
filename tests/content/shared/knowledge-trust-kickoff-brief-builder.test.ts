/**
 * Knowledge Trust Kickoff Brief Builder Tests
 *
 * Tests for builder utilities that merge unresolved trust dashboard entries
 * with state-sync/history context and emit stable recommended_next_action output.
 */

import { describe, it, expect } from "bun:test";
import {
  // Parsing functions
  parseFrontmatter,
  parseKnowledgeTrustDashboard,
  parseKnowledgeTrustStateSync,
  parseKnowledgeTrustHistory,

  // Conversion functions
  dashboardToInputs,
  historyEntriesToInputs,

  // Builder functions
  mergeTrustItems,
  computeRecommendedActions,
  extractTrustItemsFromNote,

  // Types
  type HistoryEntry,
  type ParsedTrustDashboard,
} from "../../../src/shared/knowledgeTrustKickoffBriefBuilder";

import {
  RiskBand,
  TrustItemType,
  TrustSourceType,
  BriefItemStatus,
  RecommendedAction,
} from "../../../src/shared/knowledgeTrustKickoffBriefContract";

describe("Knowledge Trust Kickoff Brief Builder", () => {
  describe("parseFrontmatter", () => {
    it("should parse basic frontmatter", () => {
      const content = `---
title: Test Note
date: 2026-03-04
---

# Content`;

      const frontmatter = parseFrontmatter(content);
      expect(frontmatter).not.toBeNull();
      expect(frontmatter?.title).toBe("Test Note");
      expect(frontmatter?.date).toBe("2026-03-04");
    });

    it("should return null for content without frontmatter", () => {
      const content = `# Just a heading\n\nSome content`;
      const frontmatter = parseFrontmatter(content);
      expect(frontmatter).toBeNull();
    });

    it("should parse arrays in frontmatter", () => {
      const content = `---
tags: [tag1, tag2, tag3]
---

Content`;

      const frontmatter = parseFrontmatter(content);
      expect(frontmatter?.tags).toEqual(["tag1", "tag2", "tag3"]);
    });

    it("should parse boolean values", () => {
      const content = `---
published: true
draft: false
---

Content`;

      const frontmatter = parseFrontmatter(content);
      expect(frontmatter?.published).toBe(true);
      expect(frontmatter?.draft).toBe(false);
    });
  });

  describe("parseKnowledgeTrustDashboard", () => {
    it("should parse dashboard with items", () => {
      const content = `---
dashboard_version: 1.0.0
generated_at: 2026-03-04T10:00:00.000Z
---

# Knowledge Trust Dashboard

## Active Items

### [CRITICAL] contradiction-item-1

**Type:** contradiction
**Description:** Critical contradiction detected between claims
**Status:** active
**First detected:** 2026-03-01
**Last updated:** 2026-03-04

---

### [HIGH] evidence-gap-item-1

**Type:** evidence-gap
**Description:** Missing evidence for key assumption
**Status:** in-progress
**First detected:** 2026-03-02
**Last updated:** 2026-03-03

---

## Resolved Items

### [MEDIUM] resolved-item-1

**Type:** state-change
**Description:** Previously active issue now resolved
**Status:** resolved
**First detected:** 2026-02-01
**Last updated:** 2026-03-01
`;

      const dashboard = parseKnowledgeTrustDashboard(content, "knowledge-trust-dashboard.md");
      expect(dashboard).not.toBeNull();
      expect(dashboard?.dashboardTitle).toBe("knowledge-trust-dashboard");
      expect(dashboard?.items.length).toBeGreaterThanOrEqual(2);

      // Check first item
      const firstItem = dashboard?.items[0];
      expect(firstItem?.risk_band).toBe(RiskBand.CRITICAL);
      expect(firstItem?.item_type).toBe(TrustItemType.CONTRADICTION);
      expect(firstItem?.status).toBe(BriefItemStatus.ACTIVE);
    });

    it("should return null for content without dashboard", () => {
      const content = `# Regular Note\n\nJust some content`;
      const dashboard = parseKnowledgeTrustDashboard(content, "note.md");
      expect(dashboard).toBeNull();
    });

    it("should handle empty dashboard", () => {
      const content = `---
dashboard_version: 1.0.0
---

# Knowledge Trust Dashboard

## Active Items

No active items.
`;

      const dashboard = parseKnowledgeTrustDashboard(content, "knowledge-trust-dashboard.md");
      expect(dashboard).not.toBeNull();
      expect(dashboard?.items).toEqual([]);
    });
  });

  describe("parseKnowledgeTrustStateSync", () => {
    it("should parse state sync with items", () => {
      const content = `---
sync_version: 1.0.0
generated_at: 2026-03-04T10:00:00.000Z
---

# Knowledge Trust State Sync

## Sync Items

### [HIGH] sync-item-1

**Type:** low-confidence
**Description:** Confidence override applied
**Status:** active
**First detected:** 2026-03-01
**Last updated:** 2026-03-04

---
`;

      const sync = parseKnowledgeTrustStateSync(content, "knowledge-trust-dashboard-state-sync.md");
      expect(sync).not.toBeNull();
      expect(sync?.items.length).toBeGreaterThanOrEqual(1);
      expect(sync?.items[0]?.risk_band).toBe(RiskBand.HIGH);
    });

    it("should return null for content without state sync", () => {
      const content = `# Regular Note\n\nJust some content`;
      const sync = parseKnowledgeTrustStateSync(content, "note.md");
      expect(sync).toBeNull();
    });
  });

  describe("parseKnowledgeTrustHistory", () => {
    it("should parse ndjson history entries", () => {
      const content = `
{"history_item_id":"hist-1","dashboard_item_id":"item-1","item_type":"contradiction","risk_band":"critical","description":"Contradiction detected","status":"active","event_type":"created","timestamp":"2026-03-01T10:00:00.000Z"}
{"history_item_id":"hist-2","dashboard_item_id":"item-1","item_type":"contradiction","risk_band":"critical","description":"Contradiction updated","status":"in-progress","event_type":"updated","timestamp":"2026-03-02T10:00:00.000Z"}
{"history_item_id":"hist-3","dashboard_item_id":"item-2","item_type":"evidence-gap","risk_band":"high","description":"Evidence gap noted","status":"active","event_type":"created","timestamp":"2026-03-03T10:00:00.000Z"}
`.trim();

      const entries = parseKnowledgeTrustHistory(content, "knowledge-trust-dashboard-history.ndjson");
      expect(entries.length).toBe(3);
      expect(entries[0]?.dashboard_item_id).toBe("item-1");
      expect(entries[0]?.item_type).toBe(TrustItemType.CONTRADICTION);
      expect(entries[2]?.dashboard_item_id).toBe("item-2");
    });

    it("should skip invalid JSON lines", () => {
      const content = `
{"history_item_id":"hist-1","dashboard_item_id":"item-1","timestamp":"2026-03-01T10:00:00.000Z"}
invalid json line
{"history_item_id":"hist-2","dashboard_item_id":"item-2","timestamp":"2026-03-02T10:00:00.000Z"}
`.trim();

      const entries = parseKnowledgeTrustHistory(content, "history.ndjson");
      expect(entries.length).toBe(2);
    });

    it("should handle empty content", () => {
      const content = "";
      const entries = parseKnowledgeTrustHistory(content, "history.ndjson");
      expect(entries).toEqual([]);
    });

    it("should set defaults for missing fields", () => {
      const content = `{"dashboard_item_id":"item-1","timestamp":"2026-03-01T10:00:00.000Z"}`;
      const entries = parseKnowledgeTrustHistory(content, "history.ndjson");
      expect(entries.length).toBe(1);
      expect(entries[0]?.item_type).toBe(TrustItemType.STATE_CHANGE);
      expect(entries[0]?.risk_band).toBe(RiskBand.MEDIUM);
      expect(entries[0]?.status).toBe(BriefItemStatus.ACTIVE);
    });
  });

  describe("dashboardToInputs", () => {
    it("should convert dashboard to trust item inputs", () => {
      const dashboard: ParsedTrustDashboard = {
        dashboardPath: "knowledge-trust-dashboard.md",
        dashboardTitle: "Knowledge Trust Dashboard",
        items: [
          {
            dashboard_item_id: "item-1",
            item_type: TrustItemType.CONTRADICTION,
            description: "Test contradiction",
            risk_band: RiskBand.CRITICAL,
            status: BriefItemStatus.ACTIVE,
            first_detected_at: "2026-03-01T10:00:00.000Z",
            last_updated_at: "2026-03-04T10:00:00.000Z",
            related_clip_paths: ["clip-1.md"],
          },
        ],
      };

      const inputs = dashboardToInputs(dashboard, TrustSourceType.DASHBOARD);
      expect(inputs.length).toBe(1);
      expect(inputs[0]?.dashboard_item_id).toBe("item-1");
      expect(inputs[0]?.source_type).toBe(TrustSourceType.DASHBOARD);
      expect(inputs[0]?.source_path).toBe("knowledge-trust-dashboard.md");
      expect(inputs[0]?.related_clip_paths).toEqual(["clip-1.md"]);
    });
  });

  describe("historyEntriesToInputs", () => {
    it("should convert history entries to trust item inputs", () => {
      const entries: HistoryEntry[] = [
        {
          history_item_id: "hist-1",
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          risk_band: RiskBand.CRITICAL,
          description: "Contradiction created",
          status: BriefItemStatus.ACTIVE,
          event_type: "created",
          timestamp: "2026-03-01T10:00:00.000Z",
        },
        {
          history_item_id: "hist-2",
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          risk_band: RiskBand.CRITICAL,
          description: "Contradiction updated",
          status: BriefItemStatus.IN_PROGRESS,
          event_type: "updated",
          timestamp: "2026-03-02T10:00:00.000Z",
        },
      ];

      const inputs = historyEntriesToInputs(entries, "history.ndjson");
      expect(inputs.length).toBe(1); // Grouped by dashboard_item_id
      expect(inputs[0]?.dashboard_item_id).toBe("item-1");
      expect(inputs[0]?.source_type).toBe(TrustSourceType.HISTORY);
      expect(inputs[0]?.status).toBe(BriefItemStatus.IN_PROGRESS); // Most recent
      expect(inputs[0]?.first_detected_at).toBe("2026-03-01T10:00:00.000Z"); // Oldest
      expect(inputs[0]?.last_updated_at).toBe("2026-03-02T10:00:00.000Z"); // Most recent
    });

    it("should handle multiple distinct items", () => {
      const entries: HistoryEntry[] = [
        {
          history_item_id: "hist-1",
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          risk_band: RiskBand.CRITICAL,
          description: "Item 1",
          status: BriefItemStatus.ACTIVE,
          event_type: "created",
          timestamp: "2026-03-01T10:00:00.000Z",
        },
        {
          history_item_id: "hist-2",
          dashboard_item_id: "item-2",
          item_type: TrustItemType.EVIDENCE_GAP,
          risk_band: RiskBand.HIGH,
          description: "Item 2",
          status: BriefItemStatus.ACTIVE,
          event_type: "created",
          timestamp: "2026-03-02T10:00:00.000Z",
        },
      ];

      const inputs = historyEntriesToInputs(entries, "history.ndjson");
      expect(inputs.length).toBe(2);
      expect(inputs[0]?.dashboard_item_id).toBe("item-1");
      expect(inputs[1]?.dashboard_item_id).toBe("item-2");
    });
  });

  describe("mergeTrustItems", () => {
    it("should dedupe items by dashboard_item_id", () => {
      const inputs = [
        {
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          description: "Dashboard version",
          risk_band: RiskBand.HIGH,
          source_type: TrustSourceType.DASHBOARD,
          source_path: "dashboard.md",
          first_detected_at: "2026-03-01T10:00:00.000Z",
          last_updated_at: "2026-03-04T10:00:00.000Z",
          status: BriefItemStatus.ACTIVE,
        },
        {
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          description: "History version",
          risk_band: RiskBand.CRITICAL, // Higher risk in history
          source_type: TrustSourceType.HISTORY,
          source_path: "history.ndjson",
          first_detected_at: "2026-03-01T10:00:00.000Z",
          last_updated_at: "2026-03-03T10:00:00.000Z",
          status: BriefItemStatus.ACTIVE,
        },
      ];

      const merged = mergeTrustItems(inputs);
      expect(merged.length).toBe(1);
      expect(merged[0]?.risk_band).toBe(RiskBand.CRITICAL); // Escalated to highest
    });

    it("should prefer DASHBOARD over HISTORY", () => {
      const inputs = [
        {
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          description: "History version",
          risk_band: RiskBand.HIGH,
          source_type: TrustSourceType.HISTORY,
          source_path: "history.ndjson",
          first_detected_at: "2026-03-01T10:00:00.000Z",
          last_updated_at: "2026-03-04T10:00:00.000Z",
          status: BriefItemStatus.ACTIVE,
        },
        {
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          description: "Dashboard version",
          risk_band: RiskBand.HIGH,
          source_type: TrustSourceType.DASHBOARD,
          source_path: "dashboard.md",
          first_detected_at: "2026-03-01T10:00:00.000Z",
          last_updated_at: "2026-03-03T10:00:00.000Z",
          status: BriefItemStatus.ACTIVE,
        },
      ];

      const merged = mergeTrustItems(inputs);
      expect(merged.length).toBe(1);
      expect(merged[0]?.source_type).toBe(TrustSourceType.DASHBOARD);
      expect(merged[0]?.description).toBe("Dashboard version");
    });
  });

  describe("computeRecommendedActions", () => {
    it("should recommend REVIEW_NOW for critical contradictions", () => {
      const items = [
        {
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          description: "Critical contradiction",
          risk_band: RiskBand.CRITICAL,
          source_type: TrustSourceType.DASHBOARD,
          source_path: "dashboard.md",
          first_detected_at: "2026-03-01T10:00:00.000Z",
          last_updated_at: "2026-03-04T10:00:00.000Z",
          status: BriefItemStatus.ACTIVE,
        },
      ];

      const actions = computeRecommendedActions(items);
      expect(actions.length).toBe(1);
      expect(actions[0]?.action).toBe(RecommendedAction.REVIEW_NOW);
      expect(actions[0]?.reason).toContain("contradiction");
    });

    it("should recommend MONITOR for low historical patterns", () => {
      const items = [
        {
          dashboard_item_id: "item-1",
          item_type: TrustItemType.HISTORICAL_PATTERN,
          description: "Historical pattern",
          risk_band: RiskBand.LOW,
          source_type: TrustSourceType.DASHBOARD,
          source_path: "dashboard.md",
          first_detected_at: "2026-03-01T10:00:00.000Z",
          last_updated_at: "2026-03-04T10:00:00.000Z",
          status: BriefItemStatus.ACTIVE,
        },
      ];

      const actions = computeRecommendedActions(items);
      expect(actions.length).toBe(1);
      expect(actions[0]?.action).toBe(RecommendedAction.MONITOR);
    });
  });

  describe("extractTrustItemsFromNote", () => {
    it("should extract items from dashboard note", () => {
      const content = `---
title: Knowledge Trust Dashboard
---

# Knowledge Trust Dashboard

## Active Items

### [CRITICAL] item-1

**Type:** contradiction
**Description:** Test contradiction
**Status:** active
**First detected:** 2026-03-01
**Last updated:** 2026-03-04
`;

      const items = extractTrustItemsFromNote(content, "knowledge-trust-dashboard.md");
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items[0]?.dashboard_item_id).toBe("item-1");
      expect(items[0]?.source_type).toBe(TrustSourceType.DASHBOARD);
    });

    it("should extract items from state sync note", () => {
      const content = `---
title: Knowledge Trust State Sync
---

# Knowledge Trust State Sync

## Sync Items

### [HIGH] sync-item-1

**Type:** state-change
**Description:** State updated
**Status:** active
**First detected:** 2026-03-01
**Last updated:** 2026-03-04
`;

      const items = extractTrustItemsFromNote(
        content,
        "knowledge-trust-dashboard-state-sync.md",
        [TrustSourceType.STATE_SYNC]
      );
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items[0]?.source_type).toBe(TrustSourceType.STATE_SYNC);
    });
  });

  describe("Integration: End-to-end builder flow", () => {
    it("should build brief from merged dashboard, state-sync, and history", () => {
      // Simulate dashboard content
      const dashboardContent = `---
dashboard_version: 1.0.0
---

# Knowledge Trust Dashboard

## Active Items

### [CRITICAL] item-1

**Type:** contradiction
**Description:** Critical contradiction from dashboard
**Status:** active
**First detected:** 2026-03-01
**Last updated:** 2026-03-04

---

### [MEDIUM] item-2

**Type:** evidence-gap
**Description:** Evidence gap from dashboard
**Status:** active
**First detected:** 2026-03-02
**Last updated:** 2026-03-03
`;

      // Simulate state sync content
      const stateSyncContent = `---
sync_version: 1.0.0
---

# Knowledge Trust State Sync

## Sync Items

### [HIGH] item-1

**Type:** contradiction
**Description:** State sync update for item-1
**Status:** in-progress
**First detected:** 2026-03-01
**Last updated:** 2026-03-05
`;

      // Simulate history content
      const historyContent = `
{"history_item_id":"hist-1","dashboard_item_id":"item-3","item_type":"low-confidence","risk_band":"high","description":"Low confidence item from history","status":"active","event_type":"created","timestamp":"2026-03-01T10:00:00.000Z"}
{"history_item_id":"hist-2","dashboard_item_id":"item-1","item_type":"contradiction","risk_band":"critical","description":"History entry for item-1","status":"active","event_type":"updated","timestamp":"2026-03-02T10:00:00.000Z"}
`.trim();

      // Extract from all sources
      const dashboardItems = extractTrustItemsFromNote(
        dashboardContent,
        "knowledge-trust-dashboard.md",
        [TrustSourceType.DASHBOARD]
      );
      const stateSyncItems = extractTrustItemsFromNote(
        stateSyncContent,
        "knowledge-trust-dashboard-state-sync.md",
        [TrustSourceType.STATE_SYNC]
      );
      const historyItems = extractTrustItemsFromNote(
        historyContent,
        "knowledge-trust-dashboard-history.ndjson",
        [TrustSourceType.HISTORY]
      );

      // Merge all items
      const allItems = [...dashboardItems, ...stateSyncItems, ...historyItems];
      const mergedItems = mergeTrustItems(allItems);

      // Verify merged results
      expect(mergedItems.length).toBeGreaterThanOrEqual(2);

      // item-1 should appear once (deduped from dashboard, state-sync, and history)
      const item1Items = mergedItems.filter(i => i.dashboard_item_id === "item-1");
      expect(item1Items.length).toBe(1);

      // item-1 should have CRITICAL risk (escalated from dashboard/history)
      expect(item1Items[0]?.risk_band).toBe(RiskBand.CRITICAL);

      // Compute recommended actions
      const actions = computeRecommendedActions(mergedItems);
      expect(actions.length).toBe(mergedItems.length);

      // Critical item should have REVIEW_NOW action
      const item1Action = actions.find(a => a.item.dashboard_item_id === "item-1");
      expect(item1Action?.action).toBe(RecommendedAction.REVIEW_NOW);
    });
  });

  describe("Determinism", () => {
    it("should produce identical output on multiple runs with same inputs", () => {
      const dashboardContent = `---
dashboard_version: 1.0.0
---

# Knowledge Trust Dashboard

## Active Items

### [CRITICAL] item-1

**Type:** contradiction
**Description:** Test item
**Status:** active
**First detected:** 2026-03-01
**Last updated:** 2026-03-04

---

### [HIGH] item-2

**Type:** evidence-gap
**Description:** Another test item
**Status:** active
**First detected:** 2026-03-02
**Last updated:** 2026-03-03
`;

      const items1 = extractTrustItemsFromNote(dashboardContent, "dashboard.md");
      const items2 = extractTrustItemsFromNote(dashboardContent, "dashboard.md");
      const items3 = extractTrustItemsFromNote(dashboardContent, "dashboard.md");

      expect(items1.map(i => i.dashboard_item_id)).toEqual(
        items2.map(i => i.dashboard_item_id)
      );
      expect(items2.map(i => i.dashboard_item_id)).toEqual(
        items3.map(i => i.dashboard_item_id)
      );
    });
  });
});
