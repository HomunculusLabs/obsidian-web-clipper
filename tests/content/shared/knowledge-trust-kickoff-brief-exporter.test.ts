/**
 * Knowledge Trust Kickoff Brief Exporter Tests
 *
 * Tests for deterministic exporter/renderer with explicit empty-state
 * and bounded metadata behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  // Constants
  DEFAULT_BRIEF_FILENAME,

  // Functions
  resolveBriefPath,
  isBriefEmpty,
  computeBoundedMetadataDiagnostics,
  renderEmptyBrief,
  exportKnowledgeTrustKickoffBrief,
  exportEmptyBrief,
  briefFileExists,
  readBriefFile,
  deleteBriefFile,
  getDefaultExportOptions,
  formatBoundedMetadataDiagnostics,
  getBoundedMetadataSeverity,
  validateBoundedMetadata,

  // Types
  type ExportBriefOptions,
  type BoundedMetadataDiagnostics,
} from "../../../src/shared/knowledgeTrustKickoffBriefExporter";

import {
  KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
  MAX_BRIEF_ITEMS,
  MAX_SOURCE_REFS,
  MAX_DESCRIPTION_LENGTH,
  RiskBand,
  TrustItemType,
  TrustSourceType,
  BriefItemStatus,
  buildKnowledgeTrustKickoffBrief,
  type TrustItemInput,
  type KnowledgeTrustKickoffBrief,
} from "../../../src/shared/knowledgeTrustKickoffBriefContract";

describe("Knowledge Trust Kickoff Brief Exporter", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brief-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe("Constants", () => {
    it("should have correct default filename", () => {
      expect(DEFAULT_BRIEF_FILENAME).toBe("knowledge-trust-kickoff-brief.md");
    });
  });

  describe("resolveBriefPath", () => {
    it("should resolve to vault root by default", () => {
      const options: ExportBriefOptions = {
        vaultPath: "/path/to/vault",
      };
      const resolved = resolveBriefPath(options);
      expect(resolved).toBe("/path/to/vault/knowledge-trust-kickoff-brief.md");
    });

    it("should resolve with custom folder", () => {
      const options: ExportBriefOptions = {
        vaultPath: "/path/to/vault",
        briefFolder: "notes/trust",
      };
      const resolved = resolveBriefPath(options);
      expect(resolved).toBe("/path/to/vault/notes/trust/knowledge-trust-kickoff-brief.md");
    });

    it("should resolve with custom filename", () => {
      const options: ExportBriefOptions = {
        vaultPath: "/path/to/vault",
        briefFilename: "custom-brief.md",
      };
      const resolved = resolveBriefPath(options);
      expect(resolved).toBe("/path/to/vault/custom-brief.md");
    });

    it("should resolve with both custom folder and filename", () => {
      const options: ExportBriefOptions = {
        vaultPath: "/path/to/vault",
        briefFolder: "notes",
        briefFilename: "custom-brief.md",
      };
      const resolved = resolveBriefPath(options);
      expect(resolved).toBe("/path/to/vault/notes/custom-brief.md");
    });

    it("should normalize folder path with leading/trailing slashes", () => {
      const options: ExportBriefOptions = {
        vaultPath: "/path/to/vault",
        briefFolder: "/notes/trust/",
      };
      const resolved = resolveBriefPath(options);
      expect(resolved).toBe("/path/to/vault/notes/trust/knowledge-trust-kickoff-brief.md");
    });

    it("should normalize backslashes to forward slashes", () => {
      const options: ExportBriefOptions = {
        vaultPath: "/path/to/vault",
        briefFolder: "notes\\trust",
      };
      const resolved = resolveBriefPath(options);
      expect(resolved).toBe("/path/to/vault/notes/trust/knowledge-trust-kickoff-brief.md");
    });
  });

  describe("isBriefEmpty", () => {
    it("should return true for empty brief", () => {
      const brief: KnowledgeTrustKickoffBrief = {
        entries: [],
        total_items: 0,
        active_items: 0,
        in_progress_items: 0,
        resolved_items: 0,
        dismissed_items: 0,
        risk_band_counts: {
          [RiskBand.CRITICAL]: 0,
          [RiskBand.HIGH]: 0,
          [RiskBand.MEDIUM]: 0,
          [RiskBand.LOW]: 0,
        },
        truncated: false,
        brief_version: KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
        generated_at: "2026-03-04T10:00:00.000Z",
      };
      expect(isBriefEmpty(brief)).toBe(true);
    });

    it("should return false for non-empty brief", () => {
      const brief: KnowledgeTrustKickoffBrief = {
        entries: [
          {
            brief_item_id: "test-id",
            dashboard_item_id: "item-1",
            item_type: TrustItemType.CONTRADICTION,
            description: "Test",
            description_truncated: false,
            risk_band: RiskBand.HIGH,
            priority_reason: "Test reason",
            recommended_next_action: "review-now" as const,
            status: BriefItemStatus.ACTIVE,
            source_refs: [],
            source_ref_count: 0,
            source_refs_truncated: false,
            score: 50,
            last_updated_at: "2026-03-04T10:00:00.000Z",
            first_detected_at: "2026-03-01T10:00:00.000Z",
          },
        ],
        total_items: 1,
        active_items: 1,
        in_progress_items: 0,
        resolved_items: 0,
        dismissed_items: 0,
        risk_band_counts: {
          [RiskBand.CRITICAL]: 0,
          [RiskBand.HIGH]: 1,
          [RiskBand.MEDIUM]: 0,
          [RiskBand.LOW]: 0,
        },
        truncated: false,
        brief_version: KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
        generated_at: "2026-03-04T10:00:00.000Z",
      };
      expect(isBriefEmpty(brief)).toBe(false);
    });
  });

  describe("computeBoundedMetadataDiagnostics", () => {
    it("should compute diagnostics for empty brief", () => {
      const brief: KnowledgeTrustKickoffBrief = {
        entries: [],
        total_items: 0,
        active_items: 0,
        in_progress_items: 0,
        resolved_items: 0,
        dismissed_items: 0,
        risk_band_counts: {
          [RiskBand.CRITICAL]: 0,
          [RiskBand.HIGH]: 0,
          [RiskBand.MEDIUM]: 0,
          [RiskBand.LOW]: 0,
        },
        truncated: false,
        brief_version: KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
        generated_at: "2026-03-04T10:00:00.000Z",
      };

      const diagnostics = computeBoundedMetadataDiagnostics(brief);

      expect(diagnostics.entriesTruncated).toBe(false);
      expect(diagnostics.entriesIncluded).toBe(0);
      expect(diagnostics.entriesExcluded).toBe(0);
      expect(diagnostics.resolvedItems).toBe(0);
      expect(diagnostics.dismissedItems).toBe(0);
      expect(diagnostics.itemsWithTruncatedDescriptions).toBe(0);
      expect(diagnostics.itemsWithTruncatedSourceRefs).toBe(0);
      expect(diagnostics.maxEntries).toBe(MAX_BRIEF_ITEMS);
      expect(diagnostics.maxSourceRefs).toBe(MAX_SOURCE_REFS);
      expect(diagnostics.maxDescriptionLength).toBe(MAX_DESCRIPTION_LENGTH);
    });

    it("should count truncated descriptions", () => {
      const brief: KnowledgeTrustKickoffBrief = {
        entries: [
          {
            brief_item_id: "id-1",
            dashboard_item_id: "item-1",
            item_type: TrustItemType.CONTRADICTION,
            description: "Test",
            description_truncated: true,
            risk_band: RiskBand.HIGH,
            priority_reason: "Test",
            recommended_next_action: "review-now" as const,
            status: BriefItemStatus.ACTIVE,
            source_refs: [],
            source_ref_count: 0,
            source_refs_truncated: false,
            score: 50,
            last_updated_at: "2026-03-04T10:00:00.000Z",
            first_detected_at: "2026-03-01T10:00:00.000Z",
          },
          {
            brief_item_id: "id-2",
            dashboard_item_id: "item-2",
            item_type: TrustItemType.CONTRADICTION,
            description: "Test",
            description_truncated: false,
            risk_band: RiskBand.HIGH,
            priority_reason: "Test",
            recommended_next_action: "review-now" as const,
            status: BriefItemStatus.ACTIVE,
            source_refs: [],
            source_ref_count: 0,
            source_refs_truncated: false,
            score: 50,
            last_updated_at: "2026-03-04T10:00:00.000Z",
            first_detected_at: "2026-03-01T10:00:00.000Z",
          },
        ],
        total_items: 2,
        active_items: 2,
        in_progress_items: 0,
        resolved_items: 0,
        dismissed_items: 0,
        risk_band_counts: {
          [RiskBand.CRITICAL]: 0,
          [RiskBand.HIGH]: 2,
          [RiskBand.MEDIUM]: 0,
          [RiskBand.LOW]: 0,
        },
        truncated: false,
        brief_version: KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
        generated_at: "2026-03-04T10:00:00.000Z",
      };

      const diagnostics = computeBoundedMetadataDiagnostics(brief);

      expect(diagnostics.itemsWithTruncatedDescriptions).toBe(1);
      expect(diagnostics.itemsWithTruncatedSourceRefs).toBe(0);
    });

    it("should count truncated source refs", () => {
      const brief: KnowledgeTrustKickoffBrief = {
        entries: [
          {
            brief_item_id: "id-1",
            dashboard_item_id: "item-1",
            item_type: TrustItemType.CONTRADICTION,
            description: "Test",
            description_truncated: false,
            risk_band: RiskBand.HIGH,
            priority_reason: "Test",
            recommended_next_action: "review-now" as const,
            status: BriefItemStatus.ACTIVE,
            source_refs: [],
            source_ref_count: 10,
            source_refs_truncated: true,
            score: 50,
            last_updated_at: "2026-03-04T10:00:00.000Z",
            first_detected_at: "2026-03-01T10:00:00.000Z",
          },
        ],
        total_items: 1,
        active_items: 1,
        in_progress_items: 0,
        resolved_items: 0,
        dismissed_items: 0,
        risk_band_counts: {
          [RiskBand.CRITICAL]: 0,
          [RiskBand.HIGH]: 1,
          [RiskBand.MEDIUM]: 0,
          [RiskBand.LOW]: 0,
        },
        truncated: false,
        brief_version: KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
        generated_at: "2026-03-04T10:00:00.000Z",
      };

      const diagnostics = computeBoundedMetadataDiagnostics(brief);

      expect(diagnostics.itemsWithTruncatedSourceRefs).toBe(1);
    });

    it("should count excluded entries when truncated", () => {
      const brief: KnowledgeTrustKickoffBrief = {
        entries: Array.from({ length: MAX_BRIEF_ITEMS }, (_, i) => ({
          brief_item_id: `id-${i}`,
          dashboard_item_id: `item-${i}`,
          item_type: TrustItemType.CONTRADICTION,
          description: "Test",
          description_truncated: false,
          risk_band: RiskBand.HIGH,
          priority_reason: "Test",
          recommended_next_action: "review-now" as const,
          status: BriefItemStatus.ACTIVE,
          source_refs: [],
          source_ref_count: 0,
          source_refs_truncated: false,
          score: 50,
          last_updated_at: "2026-03-04T10:00:00.000Z",
          first_detected_at: "2026-03-01T10:00:00.000Z",
        })),
        total_items: MAX_BRIEF_ITEMS + 10,
        active_items: MAX_BRIEF_ITEMS + 10,
        in_progress_items: 0,
        resolved_items: 0,
        dismissed_items: 0,
        risk_band_counts: {
          [RiskBand.CRITICAL]: 0,
          [RiskBand.HIGH]: MAX_BRIEF_ITEMS + 10,
          [RiskBand.MEDIUM]: 0,
          [RiskBand.LOW]: 0,
        },
        truncated: true,
        brief_version: KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
        generated_at: "2026-03-04T10:00:00.000Z",
      };

      const diagnostics = computeBoundedMetadataDiagnostics(brief);

      expect(diagnostics.entriesTruncated).toBe(true);
      expect(diagnostics.entriesIncluded).toBe(MAX_BRIEF_ITEMS);
      expect(diagnostics.entriesExcluded).toBe(10);
    });

    it("should count resolved and dismissed items", () => {
      const brief: KnowledgeTrustKickoffBrief = {
        entries: [],
        total_items: 10,
        active_items: 0,
        in_progress_items: 0,
        resolved_items: 7,
        dismissed_items: 3,
        risk_band_counts: {
          [RiskBand.CRITICAL]: 0,
          [RiskBand.HIGH]: 10,
          [RiskBand.MEDIUM]: 0,
          [RiskBand.LOW]: 0,
        },
        truncated: false,
        brief_version: KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
        generated_at: "2026-03-04T10:00:00.000Z",
      };

      const diagnostics = computeBoundedMetadataDiagnostics(brief);

      expect(diagnostics.resolvedItems).toBe(7);
      expect(diagnostics.dismissedItems).toBe(3);
    });
  });

  describe("renderEmptyBrief", () => {
    it("should render valid markdown for empty brief", () => {
      const markdown = renderEmptyBrief("2026-03-04T10:00:00.000Z");

      expect(markdown).toContain("---");
      expect(markdown).toContain("brief_version:");
      expect(markdown).toContain("items_count: 0");
      expect(markdown).toContain("active_items: 0");
      expect(markdown).toContain("in_progress_items: 0");
      expect(markdown).toContain("resolved_items: 0");
      expect(markdown).toContain("dismissed_items: 0");
      expect(markdown).toContain("brief_truncated: false");
      expect(markdown).toContain("# Knowledge Trust Kickoff Brief");
      expect(markdown).toContain("✅ No active trust issues");
    });

    it("should use current timestamp when not provided", () => {
      const markdown = renderEmptyBrief();
      expect(markdown).toContain("generated_at:");
    });

    it("should have all risk band counts as zero", () => {
      const markdown = renderEmptyBrief("2026-03-04T10:00:00.000Z");

      expect(markdown).toContain("critical: 0");
      expect(markdown).toContain("high: 0");
      expect(markdown).toContain("medium: 0");
      expect(markdown).toContain("low: 0");
    });
  });

  describe("exportKnowledgeTrustKickoffBrief", () => {
    it("should export brief to file", async () => {
      const inputs: TrustItemInput[] = [
        {
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          description: "Test contradiction",
          risk_band: RiskBand.HIGH,
          source_type: TrustSourceType.DASHBOARD,
          source_path: "dashboard.md",
          first_detected_at: "2026-03-01T10:00:00.000Z",
          last_updated_at: "2026-03-04T10:00:00.000Z",
          status: BriefItemStatus.ACTIVE,
        },
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      const result = await exportKnowledgeTrustKickoffBrief(brief, options);

      expect(result.created).toBe(true);
      expect(result.isEmpty).toBe(false);
      expect(result.metadata.items_count).toBe(1);
      expect(result.filePath).toBe(path.join(tempDir, "knowledge-trust-kickoff-brief.md"));

      // Verify file was written
      const fileContent = await fs.promises.readFile(result.filePath, "utf-8");
      expect(fileContent).toContain("# Knowledge Trust Kickoff Brief");
      expect(fileContent).toContain("Test contradiction");
    });

    it("should create folder when needed", async () => {
      const inputs: TrustItemInput[] = [];
      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
        briefFolder: "notes/trust",
      };

      const result = await exportKnowledgeTrustKickoffBrief(brief, options);

      expect(result.filePath).toBe(path.join(tempDir, "notes/trust/knowledge-trust-kickoff-brief.md"));

      // Verify folder was created
      const folderExists = await fs.promises
        .access(path.join(tempDir, "notes/trust"))
        .then(() => true)
        .catch(() => false);
      expect(folderExists).toBe(true);
    });

    it("should update existing file", async () => {
      const filePath = path.join(tempDir, "knowledge-trust-kickoff-brief.md");
      await fs.promises.writeFile(filePath, "old content", "utf-8");

      const inputs: TrustItemInput[] = [
        {
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          description: "New content",
          risk_band: RiskBand.HIGH,
          source_type: TrustSourceType.DASHBOARD,
          source_path: "dashboard.md",
          first_detected_at: "2026-03-01T10:00:00.000Z",
          last_updated_at: "2026-03-04T10:00:00.000Z",
          status: BriefItemStatus.ACTIVE,
        },
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      const result = await exportKnowledgeTrustKickoffBrief(brief, options);

      expect(result.created).toBe(false);

      const fileContent = await fs.promises.readFile(filePath, "utf-8");
      expect(fileContent).toContain("New content");
      expect(fileContent).not.toContain("old content");
    });

    it("should return empty state warning for empty brief", async () => {
      const inputs: TrustItemInput[] = [];
      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      const result = await exportKnowledgeTrustKickoffBrief(brief, options);

      expect(result.isEmpty).toBe(true);
      expect(result.warnings).toContain("Brief is empty (no active or in-progress trust items)");
    });

    it("should return truncation warnings", async () => {
      const inputs: TrustItemInput[] = Array.from({ length: MAX_BRIEF_ITEMS + 5 }, (_, i) => ({
        dashboard_item_id: `item-${i}`,
        item_type: TrustItemType.CONTRADICTION,
        description: "Test",
        risk_band: RiskBand.HIGH,
        source_type: TrustSourceType.DASHBOARD,
        source_path: "dashboard.md",
        first_detected_at: "2026-03-01T10:00:00.000Z",
        last_updated_at: "2026-03-04T10:00:00.000Z",
        status: BriefItemStatus.ACTIVE,
      }));

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      const result = await exportKnowledgeTrustKickoffBrief(brief, options);

      expect(result.boundedMetadata.entriesTruncated).toBe(true);
      expect(result.warnings.some(w => w.includes("truncated"))).toBe(true);
    });

    it("should include bounded metadata in result", async () => {
      const inputs: TrustItemInput[] = [
        {
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          description: "Test",
          risk_band: RiskBand.HIGH,
          source_type: TrustSourceType.DASHBOARD,
          source_path: "dashboard.md",
          first_detected_at: "2026-03-01T10:00:00.000Z",
          last_updated_at: "2026-03-04T10:00:00.000Z",
          status: BriefItemStatus.ACTIVE,
        },
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      const result = await exportKnowledgeTrustKickoffBrief(brief, options);

      expect(result.boundedMetadata).toBeDefined();
      expect(result.boundedMetadata.entriesIncluded).toBe(1);
      expect(result.boundedMetadata.maxEntries).toBe(MAX_BRIEF_ITEMS);
      expect(result.boundedMetadata.maxSourceRefs).toBe(MAX_SOURCE_REFS);
      expect(result.boundedMetadata.maxDescriptionLength).toBe(MAX_DESCRIPTION_LENGTH);
    });
  });

  describe("exportEmptyBrief", () => {
    it("should export empty brief", async () => {
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      const result = await exportEmptyBrief(options, "2026-03-04T10:00:00.000Z");

      expect(result.isEmpty).toBe(true);
      expect(result.metadata.items_count).toBe(0);
      expect(result.metadata.active_items).toBe(0);

      const fileContent = await fs.promises.readFile(result.filePath, "utf-8");
      expect(fileContent).toContain("✅ No active trust issues");
    });
  });

  describe("briefFileExists", () => {
    it("should return true when file exists", async () => {
      const filePath = path.join(tempDir, "knowledge-trust-kickoff-brief.md");
      await fs.promises.writeFile(filePath, "content", "utf-8");

      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      const exists = await briefFileExists(options);
      expect(exists).toBe(true);
    });

    it("should return false when file does not exist", async () => {
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      const exists = await briefFileExists(options);
      expect(exists).toBe(false);
    });
  });

  describe("readBriefFile", () => {
    it("should read existing file", async () => {
      const filePath = path.join(tempDir, "knowledge-trust-kickoff-brief.md");
      await fs.promises.writeFile(filePath, "test content", "utf-8");

      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      const content = await readBriefFile(options);
      expect(content).toBe("test content");
    });

    it("should return null for non-existent file", async () => {
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      const content = await readBriefFile(options);
      expect(content).toBeNull();
    });
  });

  describe("deleteBriefFile", () => {
    it("should delete existing file", async () => {
      const filePath = path.join(tempDir, "knowledge-trust-kickoff-brief.md");
      await fs.promises.writeFile(filePath, "content", "utf-8");

      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      const deleted = await deleteBriefFile(options);
      expect(deleted).toBe(true);

      const exists = await fs.promises
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it("should return false for non-existent file", async () => {
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      const deleted = await deleteBriefFile(options);
      expect(deleted).toBe(false);
    });
  });

  describe("getDefaultExportOptions", () => {
    it("should return default options", () => {
      const options = getDefaultExportOptions("/path/to/vault");

      expect(options.vaultPath).toBe("/path/to/vault");
      expect(options.briefFolder).toBeUndefined();
      expect(options.briefFilename).toBe(DEFAULT_BRIEF_FILENAME);
      expect(options.createFolder).toBe(true);
    });
  });

  describe("formatBoundedMetadataDiagnostics", () => {
    it("should format empty diagnostics", () => {
      const diagnostics: BoundedMetadataDiagnostics = {
        entriesTruncated: false,
        entriesIncluded: 0,
        entriesExcluded: 0,
        resolvedItems: 0,
        dismissedItems: 0,
        itemsWithTruncatedDescriptions: 0,
        itemsWithTruncatedSourceRefs: 0,
        maxEntries: MAX_BRIEF_ITEMS,
        maxSourceRefs: MAX_SOURCE_REFS,
        maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
      };

      const formatted = formatBoundedMetadataDiagnostics(diagnostics);

      expect(formatted).toContain("Brief Bounded Metadata Diagnostics");
      expect(formatted).toContain("Entries: 0 included");
      expect(formatted).toContain(`Max entries: ${MAX_BRIEF_ITEMS}`);
    });

    it("should format truncation info", () => {
      const diagnostics: BoundedMetadataDiagnostics = {
        entriesTruncated: true,
        entriesIncluded: MAX_BRIEF_ITEMS,
        entriesExcluded: 10,
        resolvedItems: 5,
        dismissedItems: 3,
        itemsWithTruncatedDescriptions: 2,
        itemsWithTruncatedSourceRefs: 1,
        maxEntries: MAX_BRIEF_ITEMS,
        maxSourceRefs: MAX_SOURCE_REFS,
        maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
      };

      const formatted = formatBoundedMetadataDiagnostics(diagnostics);

      expect(formatted).toContain("10 excluded");
      expect(formatted).toContain("5 resolved");
      expect(formatted).toContain("3 dismissed");
      expect(formatted).toContain("2 items with truncated descriptions");
      expect(formatted).toContain("1 items with truncated source refs");
    });
  });

  describe("getBoundedMetadataSeverity", () => {
    it("should return 'none' for no issues", () => {
      const diagnostics: BoundedMetadataDiagnostics = {
        entriesTruncated: false,
        entriesIncluded: 10,
        entriesExcluded: 0,
        resolvedItems: 0,
        dismissedItems: 0,
        itemsWithTruncatedDescriptions: 0,
        itemsWithTruncatedSourceRefs: 0,
        maxEntries: MAX_BRIEF_ITEMS,
        maxSourceRefs: MAX_SOURCE_REFS,
        maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
      };

      expect(getBoundedMetadataSeverity(diagnostics)).toBe("none");
    });

    it("should return 'low' for minor truncation", () => {
      const diagnostics: BoundedMetadataDiagnostics = {
        entriesTruncated: false,
        entriesIncluded: 10,
        entriesExcluded: 0,
        resolvedItems: 0,
        dismissedItems: 0,
        itemsWithTruncatedDescriptions: 2,
        itemsWithTruncatedSourceRefs: 0,
        maxEntries: MAX_BRIEF_ITEMS,
        maxSourceRefs: MAX_SOURCE_REFS,
        maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
      };

      expect(getBoundedMetadataSeverity(diagnostics)).toBe("low");
    });

    it("should return 'medium' for moderate truncation", () => {
      const diagnostics: BoundedMetadataDiagnostics = {
        entriesTruncated: true,
        entriesIncluded: 15,
        entriesExcluded: 8,
        resolvedItems: 0,
        dismissedItems: 0,
        itemsWithTruncatedDescriptions: 6,
        itemsWithTruncatedSourceRefs: 0,
        maxEntries: MAX_BRIEF_ITEMS,
        maxSourceRefs: MAX_SOURCE_REFS,
        maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
      };

      expect(getBoundedMetadataSeverity(diagnostics)).toBe("medium");
    });

    it("should return 'high' for significant truncation", () => {
      const diagnostics: BoundedMetadataDiagnostics = {
        entriesTruncated: true,
        entriesIncluded: 10,
        entriesExcluded: 15,
        resolvedItems: 0,
        dismissedItems: 0,
        itemsWithTruncatedDescriptions: 12,
        itemsWithTruncatedSourceRefs: 0,
        maxEntries: MAX_BRIEF_ITEMS,
        maxSourceRefs: MAX_SOURCE_REFS,
        maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
      };

      expect(getBoundedMetadataSeverity(diagnostics)).toBe("high");
    });
  });

  describe("validateBoundedMetadata", () => {
    it("should validate correct brief", () => {
      const brief: KnowledgeTrustKickoffBrief = {
        entries: [],
        total_items: 0,
        active_items: 0,
        in_progress_items: 0,
        resolved_items: 0,
        dismissed_items: 0,
        risk_band_counts: {
          [RiskBand.CRITICAL]: 0,
          [RiskBand.HIGH]: 0,
          [RiskBand.MEDIUM]: 0,
          [RiskBand.LOW]: 0,
        },
        truncated: false,
        brief_version: KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
        generated_at: "2026-03-04T10:00:00.000Z",
      };

      const result = validateBoundedMetadata(brief);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("should detect missing version", () => {
      const brief = {
        entries: [],
        total_items: 0,
        active_items: 0,
        in_progress_items: 0,
        resolved_items: 0,
        dismissed_items: 0,
        risk_band_counts: {
          [RiskBand.CRITICAL]: 0,
          [RiskBand.HIGH]: 0,
          [RiskBand.MEDIUM]: 0,
          [RiskBand.LOW]: 0,
        },
        truncated: false,
        brief_version: "",
        generated_at: "2026-03-04T10:00:00.000Z",
      } as KnowledgeTrustKickoffBrief;

      const result = validateBoundedMetadata(brief);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain("Missing brief_version");
    });

    it("should detect missing generated_at", () => {
      const brief = {
        entries: [],
        total_items: 0,
        active_items: 0,
        in_progress_items: 0,
        resolved_items: 0,
        dismissed_items: 0,
        risk_band_counts: {
          [RiskBand.CRITICAL]: 0,
          [RiskBand.HIGH]: 0,
          [RiskBand.MEDIUM]: 0,
          [RiskBand.LOW]: 0,
        },
        truncated: false,
        brief_version: KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
        generated_at: "",
      } as KnowledgeTrustKickoffBrief;

      const result = validateBoundedMetadata(brief);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain("Missing generated_at");
    });

    it("should detect mismatched risk band counts", () => {
      const brief: KnowledgeTrustKickoffBrief = {
        entries: [],
        total_items: 5,
        active_items: 0,
        in_progress_items: 0,
        resolved_items: 0,
        dismissed_items: 0,
        risk_band_counts: {
          [RiskBand.CRITICAL]: 1,
          [RiskBand.HIGH]: 1,
          [RiskBand.MEDIUM]: 1,
          [RiskBand.LOW]: 1,
        },
        truncated: false,
        brief_version: KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
        generated_at: "2026-03-04T10:00:00.000Z",
      };

      const result = validateBoundedMetadata(brief);

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes("does not match"))).toBe(true);
    });
  });

  describe("Determinism", () => {
    it("should produce identical file content on multiple exports", async () => {
      const inputs: TrustItemInput[] = [
        {
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          description: "Test contradiction",
          risk_band: RiskBand.CRITICAL,
          source_type: TrustSourceType.DASHBOARD,
          source_path: "dashboard.md",
          first_detected_at: "2026-03-01T10:00:00.000Z",
          last_updated_at: "2026-03-04T10:00:00.000Z",
          status: BriefItemStatus.ACTIVE,
        },
        {
          dashboard_item_id: "item-2",
          item_type: TrustItemType.EVIDENCE_GAP,
          description: "Test evidence gap",
          risk_band: RiskBand.HIGH,
          source_type: TrustSourceType.DASHBOARD,
          source_path: "dashboard.md",
          first_detected_at: "2026-03-02T10:00:00.000Z",
          last_updated_at: "2026-03-03T10:00:00.000Z",
          status: BriefItemStatus.ACTIVE,
        },
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      // Export twice
      await exportKnowledgeTrustKickoffBrief(brief, options);
      const content1 = await fs.promises.readFile(
        path.join(tempDir, "knowledge-trust-kickoff-brief.md"),
        "utf-8"
      );

      await exportKnowledgeTrustKickoffBrief(brief, options);
      const content2 = await fs.promises.readFile(
        path.join(tempDir, "knowledge-trust-kickoff-brief.md"),
        "utf-8"
      );

      // Compare structure (excluding generated_at timestamp)
      const lines1 = content1.split("\n").filter(l => !l.startsWith("generated_at:"));
      const lines2 = content2.split("\n").filter(l => !l.startsWith("generated_at:"));

      expect(lines1).toEqual(lines2);
    });

    it("should produce deterministic empty brief", async () => {
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      // Export empty brief twice with same timestamp
      await exportEmptyBrief(options, "2026-03-04T10:00:00.000Z");
      const content1 = await fs.promises.readFile(
        path.join(tempDir, "knowledge-trust-kickoff-brief.md"),
        "utf-8"
      );

      await exportEmptyBrief(options, "2026-03-04T10:00:00.000Z");
      const content2 = await fs.promises.readFile(
        path.join(tempDir, "knowledge-trust-kickoff-brief.md"),
        "utf-8"
      );

      expect(content1).toBe(content2);
    });
  });

  describe("Empty-state behavior", () => {
    it("should always create file even when empty", async () => {
      const inputs: TrustItemInput[] = [];
      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      const result = await exportKnowledgeTrustKickoffBrief(brief, options);

      // Verify file exists
      const fileExists = await fs.promises
        .access(result.filePath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Verify content has all metadata fields
      const content = await fs.promises.readFile(result.filePath, "utf-8");
      expect(content).toContain("brief_version:");
      expect(content).toContain("items_count: 0");
      expect(content).toContain("active_items: 0");
      expect(content).toContain("in_progress_items: 0");
      expect(content).toContain("resolved_items: 0");
      expect(content).toContain("dismissed_items: 0");
      expect(content).toContain("brief_truncated: false");
    });

    it("should include all risk band counts in empty brief", async () => {
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      await exportEmptyBrief(options, "2026-03-04T10:00:00.000Z");
      const content = await fs.promises.readFile(
        path.join(tempDir, "knowledge-trust-kickoff-brief.md"),
        "utf-8"
      );

      expect(content).toContain("critical: 0");
      expect(content).toContain("high: 0");
      expect(content).toContain("medium: 0");
      expect(content).toContain("low: 0");
    });
  });

  describe("Bounded metadata behavior", () => {
    it("should always include all metadata fields", async () => {
      const inputs: TrustItemInput[] = [
        {
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          description: "Test",
          risk_band: RiskBand.HIGH,
          source_type: TrustSourceType.DASHBOARD,
          source_path: "dashboard.md",
          first_detected_at: "2026-03-01T10:00:00.000Z",
          last_updated_at: "2026-03-04T10:00:00.000Z",
          status: BriefItemStatus.ACTIVE,
        },
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      await exportKnowledgeTrustKickoffBrief(brief, options);
      const content = await fs.promises.readFile(
        path.join(tempDir, "knowledge-trust-kickoff-brief.md"),
        "utf-8"
      );

      // All required fields should be present
      expect(content).toContain("brief_version:");
      expect(content).toContain("items_count:");
      expect(content).toContain("active_items:");
      expect(content).toContain("in_progress_items:");
      expect(content).toContain("resolved_items:");
      expect(content).toContain("dismissed_items:");
      expect(content).toContain("risk_band_counts:");
      expect(content).toContain("brief_truncated:");
      expect(content).toContain("generated_at:");
    });

    it("should include explicit truncation flag", async () => {
      const inputs: TrustItemInput[] = [
        {
          dashboard_item_id: "item-1",
          item_type: TrustItemType.CONTRADICTION,
          description: "Test",
          risk_band: RiskBand.HIGH,
          source_type: TrustSourceType.DASHBOARD,
          source_path: "dashboard.md",
          first_detected_at: "2026-03-01T10:00:00.000Z",
          last_updated_at: "2026-03-04T10:00:00.000Z",
          status: BriefItemStatus.ACTIVE,
        },
      ];

      const brief = buildKnowledgeTrustKickoffBrief(inputs);
      const options: ExportBriefOptions = {
        vaultPath: tempDir,
      };

      await exportKnowledgeTrustKickoffBrief(brief, options);
      const content = await fs.promises.readFile(
        path.join(tempDir, "knowledge-trust-kickoff-brief.md"),
        "utf-8"
      );

      // Should have explicit false value
      expect(content).toContain("brief_truncated: false");
    });
  });
});
