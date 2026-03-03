/**
 * Contract Tests for Knowledge Confidence State Sync Exporter
 *
 * Tests the deterministic export path including:
 * - File path resolution
 * - Empty-state behavior (bounded, always creates file)
 * - Conflict diagnostics computation
 * - Atomic file writes
 * - Error handling
 * - Status transitions
 * - Precedence conflicts
 * - Truncation
 * - Rerun determinism
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { ConfidenceItemInput, ConfidenceStateSync } from "../../../src/shared/knowledgeConfidenceStateSyncContract";
import {
  ConfidenceStatus,
  SourceType,
  StatusSource,
  buildConfidenceStateSync,
  renderConfidenceStateSync,
  extractSyncMetadata,
  computeConfidenceItemFingerprint,
  confidenceItemsAreEquivalent,
  reconcileStatus,
  shouldWriteBackStatus,
  truncateDescription,
  buildSourceArtifactRefs,
  CONFIDENCE_STATE_SYNC_VERSION,
  MAX_CONFIDENCE_ITEMS,
  MAX_SOURCE_REFS,
  MAX_DESCRIPTION_LENGTH,
  type ConfidenceStateEntry,
  type SourceArtifactRef,
} from "../../../src/shared/knowledgeConfidenceStateSyncContract";
import {
  resolveSyncPath,
  isSyncEmpty,
  computeConflictDiagnostics,
  renderEmptySync,
  exportConfidenceStateSync,
  exportEmptySync,
  syncFileExists,
  readSyncFile,
  deleteSyncFile,
  getDefaultExportOptions,
  formatConflictDiagnostics,
  getConflictSeverity,
  DEFAULT_SYNC_FILENAME,
  type ExportSyncOptions,
  type ConflictDiagnostics,
} from "../../../src/shared/knowledgeConfidenceStateSyncExporter";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

// ============================================================================
// SETUP & TEARDOWN
// ============================================================================

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "confidence-state-sync-test-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

// ============================================================================
// FILE PATH RESOLUTION TESTS
// ============================================================================

describe("File Path Resolution", () => {
  it("should resolve to vault root by default", () => {
    const options: ExportSyncOptions = {
      vaultPath: "/vault",
    };

    const filePath = resolveSyncPath(options);
    expect(filePath).toBe("/vault/knowledge-confidence-state-sync.md");
  });

  it("should use custom folder when specified", () => {
    const options: ExportSyncOptions = {
      vaultPath: "/vault",
      syncFolder: "inbox",
    };

    const filePath = resolveSyncPath(options);
    expect(filePath).toBe("/vault/inbox/knowledge-confidence-state-sync.md");
  });

  it("should use custom filename when specified", () => {
    const options: ExportSyncOptions = {
      vaultPath: "/vault",
      syncFilename: "my-sync.md",
    };

    const filePath = resolveSyncPath(options);
    expect(filePath).toBe("/vault/my-sync.md");
  });

  it("should handle nested folders", () => {
    const options: ExportSyncOptions = {
      vaultPath: "/vault",
      syncFolder: "some/nested/folder",
    };

    const filePath = resolveSyncPath(options);
    expect(filePath).toBe("/vault/some/nested/folder/knowledge-confidence-state-sync.md");
  });

  it("should normalize leading/trailing slashes in folder", () => {
    const options: ExportSyncOptions = {
      vaultPath: "/vault",
      syncFolder: "/inbox/",
    };

    const filePath = resolveSyncPath(options);
    expect(filePath).toBe("/vault/inbox/knowledge-confidence-state-sync.md");
  });

  it("should have correct default filename constant", () => {
    expect(DEFAULT_SYNC_FILENAME).toBe("knowledge-confidence-state-sync.md");
  });
});

// ============================================================================
// EMPTY-STATE TESTS
// ============================================================================

describe("Empty-State Behavior", () => {
  it("should detect empty sync", () => {
    const sync: ConfidenceStateSync = {
      entries: [],
      totalItems: 0,
      statusCounts: { unverified: 0, verified: 0, rejected: 0, deferred: 0 },
      totalSourceArtifacts: 0,
      totalSourceRefs: 0,
      truncated: false,
      sync_version: CONFIDENCE_STATE_SYNC_VERSION,
      generated_at: "2026-03-03T10:00:00.000Z",
    };

    expect(isSyncEmpty(sync)).toBe(true);
  });

  it("should not detect non-empty sync as empty", () => {
    const input: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);

    expect(isSyncEmpty(sync)).toBe(false);
    expect(sync.entries).toHaveLength(1);
  });

  it("should render empty sync with explicit metadata", () => {
    const markdown = renderEmptySync("2026-03-03T10:00:00.000Z");

    expect(markdown).toContain("---");
    expect(markdown).toContain("sync_version: 1.0.0");
    expect(markdown).toContain("items_count: 0");
    expect(markdown).toContain("status_counts_unverified: 0");
    expect(markdown).toContain("status_counts_verified: 0");
    expect(markdown).toContain("status_counts_rejected: 0");
    expect(markdown).toContain("status_counts_deferred: 0");
    expect(markdown).toContain("source_artifacts_processed: 0");
    expect(markdown).toContain("total_source_refs: 0");
    expect(markdown).toContain("sync_truncated: false");
    expect(markdown).toContain("generated_at: 2026-03-03T10:00:00.000Z");
    expect(markdown).toContain("# Knowledge Confidence State Sync");
    expect(markdown).toContain("> No confidence items found.");
  });

  it("should render empty sync with default timestamp when not provided", () => {
    const markdown = renderEmptySync();

    expect(markdown).toContain("generated_at:");
    expect(markdown).toContain("items_count: 0");
  });
});

// ============================================================================
// CONFLICT DIAGNOSTICS TESTS
// ============================================================================

describe("Conflict Diagnostics", () => {
  it("should have zero diagnostics for empty sync", () => {
    const sync: ConfidenceStateSync = {
      entries: [],
      totalItems: 0,
      statusCounts: { unverified: 0, verified: 0, rejected: 0, deferred: 0 },
      totalSourceArtifacts: 0,
      totalSourceRefs: 0,
      truncated: false,
      sync_version: CONFIDENCE_STATE_SYNC_VERSION,
      generated_at: "2026-03-03T10:00:00.000Z",
    };

    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics).toEqual({
      itemsWithConflictingSources: 0,
      itemsWithInferredStatus: 0,
      itemsWithManualStatus: 0,
      itemsWithAutomatedStatus: 0,
      itemsWithTruncatedSources: 0,
      itemsWithTruncatedDescriptions: 0,
      totalItemsWithMarkers: 0,
    });
  });

  it("should detect conflicting source statuses", () => {
    const input1: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox1.md",
      artifactTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Test item", // Same description = same item
      sourceType: SourceType.OPEN_QUESTIONS,
      artifactPath: "/inbox2.md",
      artifactTitle: "Inbox 2",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED, // Different status!
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics.itemsWithConflictingSources).toBe(1);
    expect(diagnostics.totalItemsWithMarkers).toBe(1);
  });

  it("should detect inferred status", () => {
    const input: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.INFERRED,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics.itemsWithInferredStatus).toBe(1);
    expect(diagnostics.totalItemsWithMarkers).toBe(1);
  });

  it("should detect manual status", () => {
    const input: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics.itemsWithManualStatus).toBe(1);
    expect(diagnostics.totalItemsWithMarkers).toBe(1);
  });

  it("should detect automated status", () => {
    const input: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.AUTOMATED,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics.itemsWithAutomatedStatus).toBe(1);
    expect(diagnostics.totalItemsWithMarkers).toBe(1);
  });

  it("should detect truncated descriptions", () => {
    const longDescription = "A".repeat(MAX_DESCRIPTION_LENGTH + 100);
    const input: ConfidenceItemInput = {
      description: longDescription,
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics.itemsWithTruncatedDescriptions).toBe(1);
    expect(diagnostics.totalItemsWithMarkers).toBe(1);
  });

  it("should aggregate multiple conflict markers", () => {
    const input1: ConfidenceItemInput = {
      description: "Item 1",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox1.md",
      artifactTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Item 2",
      sourceType: SourceType.OPEN_QUESTIONS,
      artifactPath: "/inbox2.md",
      artifactTitle: "Inbox 2",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.INFERRED,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics.itemsWithManualStatus).toBe(1);
    expect(diagnostics.itemsWithInferredStatus).toBe(1);
    expect(diagnostics.totalItemsWithMarkers).toBe(2);
  });

  it("should format conflict diagnostics as human-readable", () => {
    const diagnostics: ConflictDiagnostics = {
      itemsWithConflictingSources: 2,
      itemsWithInferredStatus: 1,
      itemsWithManualStatus: 3,
      itemsWithAutomatedStatus: 1,
      itemsWithTruncatedSources: 1,
      itemsWithTruncatedDescriptions: 0,
      totalItemsWithMarkers: 5,
    };

    const formatted = formatConflictDiagnostics(diagnostics);

    expect(formatted).toContain("5 item(s) with conflict/ambiguity markers");
    expect(formatted).toContain("2 item(s) have conflicting source statuses");
    expect(formatted).toContain("1 item(s) have inferred status");
    expect(formatted).toContain("3 item(s) have manual status overrides");
    expect(formatted).toContain("1 item(s) have automated status");
  });

  it("should format zero diagnostics correctly", () => {
    const diagnostics: ConflictDiagnostics = {
      itemsWithConflictingSources: 0,
      itemsWithInferredStatus: 0,
      itemsWithManualStatus: 0,
      itemsWithAutomatedStatus: 0,
      itemsWithTruncatedSources: 0,
      itemsWithTruncatedDescriptions: 0,
      totalItemsWithMarkers: 0,
    };

    const formatted = formatConflictDiagnostics(diagnostics);

    expect(formatted).toContain("✅ No conflicts or ambiguities detected");
  });

  it("should compute conflict severity levels", () => {
    const none: ConflictDiagnostics = {
      itemsWithConflictingSources: 0,
      itemsWithInferredStatus: 0,
      itemsWithManualStatus: 0,
      itemsWithAutomatedStatus: 0,
      itemsWithTruncatedSources: 0,
      itemsWithTruncatedDescriptions: 0,
      totalItemsWithMarkers: 0,
    };

    const low: ConflictDiagnostics = {
      itemsWithConflictingSources: 0,
      itemsWithInferredStatus: 0,
      itemsWithManualStatus: 2,
      itemsWithAutomatedStatus: 0,
      itemsWithTruncatedSources: 0,
      itemsWithTruncatedDescriptions: 0,
      totalItemsWithMarkers: 2,
    };

    const medium: ConflictDiagnostics = {
      itemsWithConflictingSources: 1,
      itemsWithInferredStatus: 0,
      itemsWithManualStatus: 0,
      itemsWithAutomatedStatus: 0,
      itemsWithTruncatedSources: 0,
      itemsWithTruncatedDescriptions: 0,
      totalItemsWithMarkers: 1,
    };

    const high: ConflictDiagnostics = {
      itemsWithConflictingSources: 6,
      itemsWithInferredStatus: 0,
      itemsWithManualStatus: 0,
      itemsWithAutomatedStatus: 0,
      itemsWithTruncatedSources: 0,
      itemsWithTruncatedDescriptions: 0,
      totalItemsWithMarkers: 6,
    };

    expect(getConflictSeverity(none)).toBe("none");
    expect(getConflictSeverity(low)).toBe("low");
    expect(getConflictSeverity(medium)).toBe("medium");
    expect(getConflictSeverity(high)).toBe("high");
  });
});

// ============================================================================
// STATUS TRANSITION TESTS
// ============================================================================

describe("Status Transitions", () => {
  it("should handle UNVERIFIED -> VERIFIED transition", () => {
    const input1: ConfidenceItemInput = {
      description: "Insight to verify",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/takeaways.md",
      artifactTitle: "Takeaways",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Insight to verify",
      sourceType: SourceType.KNOWLEDGE_TRIAGE,
      artifactPath: "/triage.md",
      artifactTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.VERIFIED);
    expect(sync.entries[0]!.status_source).toBe(StatusSource.MANUAL);
  });

  it("should handle UNVERIFIED -> REJECTED transition", () => {
    const input1: ConfidenceItemInput = {
      description: "Inaccurate insight",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/takeaways.md",
      artifactTitle: "Takeaways",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Inaccurate insight",
      sourceType: SourceType.OPEN_QUESTIONS,
      artifactPath: "/questions.md",
      artifactTitle: "Questions",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: ConfidenceStatus.REJECTED,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.REJECTED);
    expect(sync.statusCounts.rejected).toBe(1);
    expect(sync.statusCounts.unverified).toBe(0);
  });

  it("should handle UNVERIFIED -> DEFERRED transition", () => {
    const input1: ConfidenceItemInput = {
      description: "Deferred insight",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/takeaways.md",
      artifactTitle: "Takeaways",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Deferred insight",
      sourceType: SourceType.KNOWLEDGE_TRIAGE,
      artifactPath: "/triage.md",
      artifactTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: ConfidenceStatus.DEFERRED,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.DEFERRED);
    expect(sync.entries[0]!.status_source).toBe(StatusSource.MANUAL);
  });

  it("should handle VERIFIED -> REJECTED transition (reopening)", () => {
    const input1: ConfidenceItemInput = {
      description: "Re-verified item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/takeaways.md",
      artifactTitle: "Takeaways",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Re-verified item",
      sourceType: SourceType.KNOWLEDGE_TRIAGE,
      artifactPath: "/triage.md",
      artifactTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: ConfidenceStatus.REJECTED,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.REJECTED);
    expect(sync.entries[0]!.status_source).toBe(StatusSource.MANUAL);
  });

  it("should handle REJECTED -> VERIFIED transition (unrejecting)", () => {
    const input1: ConfidenceItemInput = {
      description: "Unrejected item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/takeaways.md",
      artifactTitle: "Takeaways",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: ConfidenceStatus.REJECTED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Unrejected item",
      sourceType: SourceType.KNOWLEDGE_TRIAGE,
      artifactPath: "/triage.md",
      artifactTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.VERIFIED);
  });

  it("should handle VERIFIED -> DEFERRED transition", () => {
    const input1: ConfidenceItemInput = {
      description: "Deferred verified item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/takeaways.md",
      artifactTitle: "Takeaways",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Deferred verified item",
      sourceType: SourceType.KNOWLEDGE_TRIAGE,
      artifactPath: "/triage.md",
      artifactTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: ConfidenceStatus.DEFERRED,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.DEFERRED);
  });

  it("should handle DEFERRED -> UNVERIFIED transition (undeferring)", () => {
    const input1: ConfidenceItemInput = {
      description: "Undeferred item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/takeaways.md",
      artifactTitle: "Takeaways",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: ConfidenceStatus.DEFERRED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Undeferred item",
      sourceType: SourceType.KNOWLEDGE_TRIAGE,
      artifactPath: "/triage.md",
      artifactTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.UNVERIFIED);
  });

  it("should track status counts correctly across mixed statuses", () => {
    const inputs: ConfidenceItemInput[] = [
      {
        description: "Unverified item 1",
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: "/inbox1.md",
        artifactTitle: "Inbox 1",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Verified item",
        sourceType: SourceType.OPEN_QUESTIONS,
        artifactPath: "/inbox2.md",
        artifactTitle: "Inbox 2",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.VERIFIED,
        statusSource: StatusSource.MANUAL,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Rejected item",
        sourceType: SourceType.CONTRADICTION,
        artifactPath: "/inbox3.md",
        artifactTitle: "Inbox 3",
        entryId: "entry3",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.REJECTED,
        statusSource: StatusSource.MANUAL,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Deferred item",
        sourceType: SourceType.EVIDENCE_GAP,
        artifactPath: "/inbox4.md",
        artifactTitle: "Inbox 4",
        entryId: "entry4",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.DEFERRED,
        statusSource: StatusSource.MANUAL,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    const sync = buildConfidenceStateSync(inputs);

    expect(sync.statusCounts.unverified).toBe(1);
    expect(sync.statusCounts.verified).toBe(1);
    expect(sync.statusCounts.rejected).toBe(1);
    expect(sync.statusCounts.deferred).toBe(1);
  });
});

// ============================================================================
// PRECEDENCE CONFLICT TESTS
// ============================================================================

describe("Precedence Conflicts", () => {
  it("should prioritize MANUAL over ARTIFACT status (same timestamp)", () => {
    const input1: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox1.md",
      artifactTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KNOWLEDGE_TRIAGE,
      artifactPath: "/triage.md",
      artifactTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);

    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.VERIFIED);
    expect(sync.entries[0]!.status_source).toBe(StatusSource.MANUAL);
  });

  it("should prioritize MANUAL over AUTOMATED status", () => {
    const input1: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox1.md",
      artifactTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.REJECTED,
      statusSource: StatusSource.AUTOMATED,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KNOWLEDGE_TRIAGE,
      artifactPath: "/triage.md",
      artifactTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);

    expect(sync.entries[0]!.status_source).toBe(StatusSource.MANUAL);
    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.UNVERIFIED);
  });

  it("should prioritize AUTOMATED over ARTIFACT status", () => {
    const input1: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox1.md",
      artifactTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.OPEN_QUESTIONS,
      artifactPath: "/questions.md",
      artifactTitle: "Questions",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.AUTOMATED,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);

    expect(sync.entries[0]!.status_source).toBe(StatusSource.AUTOMATED);
    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.VERIFIED);
  });

  it("should prioritize ARTIFACT over INFERRED status", () => {
    const input1: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox1.md",
      artifactTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.DEFERRED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.OPEN_QUESTIONS,
      artifactPath: "/questions.md",
      artifactTitle: "Questions",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.INFERRED,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);

    expect(sync.entries[0]!.status_source).toBe(StatusSource.ARTIFACT);
    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.DEFERRED);
  });

  it("should use most recent status_changed_at when same precedence", () => {
    const input1: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox1.md",
      artifactTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.OPEN_QUESTIONS,
      artifactPath: "/questions.md",
      artifactTitle: "Questions",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);

    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.VERIFIED);
    expect(sync.entries[0]!.status_changed_at).toBe("2026-03-02T10:00:00.000Z");
  });

  it("should use status value precedence when same precedence and timestamp (REJECTED > VERIFIED > DEFERRED > UNVERIFIED)", () => {
    const input1: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox1.md",
      artifactTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.OPEN_QUESTIONS,
      artifactPath: "/questions.md",
      artifactTitle: "Questions",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.REJECTED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);

    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.REJECTED);
  });

  it("should detect conflicting source statuses across three artifacts", () => {
    const inputs: ConfidenceItemInput[] = [
      {
        description: "Conflicting item",
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: "/inbox1.md",
        artifactTitle: "Inbox 1",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Conflicting item",
        sourceType: SourceType.OPEN_QUESTIONS,
        artifactPath: "/questions.md",
        artifactTitle: "Questions",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.VERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Conflicting item",
        sourceType: SourceType.CONTRADICTION,
        artifactPath: "/contradiction.md",
        artifactTitle: "Contradiction",
        entryId: "entry3",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.DEFERRED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    const sync = buildConfidenceStateSync(inputs);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(sync.entries).toHaveLength(1);
    expect(diagnostics.itemsWithConflictingSources).toBe(1);
    expect(sync.entries[0]!.source_artifact_count).toBe(3);
  });

  it("should handle four-way status source precedence correctly", () => {
    const inputs: ConfidenceItemInput[] = [
      {
        description: "Precedence test",
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: "/inbox1.md",
        artifactTitle: "Inbox 1",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.VERIFIED,
        statusSource: StatusSource.INFERRED,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Precedence test",
        sourceType: SourceType.OPEN_QUESTIONS,
        artifactPath: "/questions.md",
        artifactTitle: "Questions",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.REJECTED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Precedence test",
        sourceType: SourceType.CONTRADICTION,
        artifactPath: "/contradiction.md",
        artifactTitle: "Contradiction",
        entryId: "entry3",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.DEFERRED,
        statusSource: StatusSource.AUTOMATED,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Precedence test",
        sourceType: SourceType.KNOWLEDGE_TRIAGE,
        artifactPath: "/triage.md",
        artifactTitle: "Triage",
        entryId: "entry4",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.MANUAL,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    const sync = buildConfidenceStateSync(inputs);

    // MANUAL should win despite UNVERIFIED being lowest status value
    expect(sync.entries[0]!.status_source).toBe(StatusSource.MANUAL);
    expect(sync.entries[0]!.status).toBe(ConfidenceStatus.UNVERIFIED);
  });
});

// ============================================================================
// TRUNCATION TESTS
// ============================================================================

describe("Truncation", () => {
  it("should truncate items to MAX_CONFIDENCE_ITEMS (500)", () => {
    const inputs: ConfidenceItemInput[] = [];
    for (let i = 0; i < MAX_CONFIDENCE_ITEMS + 50; i++) {
      inputs.push({
        description: `Item ${i}`,
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: "/inbox.md",
        artifactTitle: "Inbox",
        entryId: `entry${i}`,
        firstSeenAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
        lastSeenAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
      });
    }

    const sync = buildConfidenceStateSync(inputs);

    expect(sync.entries.length).toBe(MAX_CONFIDENCE_ITEMS);
    expect(sync.totalItems).toBe(MAX_CONFIDENCE_ITEMS + 50);
    expect(sync.truncated).toBe(true);
  });

  it("should keep most recently changed items when truncating", () => {
    const inputs: ConfidenceItemInput[] = [];
    for (let i = 0; i < MAX_CONFIDENCE_ITEMS + 10; i++) {
      inputs.push({
        description: `Item ${i}`,
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: "/inbox.md",
        artifactTitle: "Inbox",
        entryId: `entry${i}`,
        firstSeenAt: "2026-03-01T10:00:00.000Z",
        lastSeenAt: "2026-03-01T10:00:00.000Z",
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`, // Each item has different timestamp
      });
    }

    const sync = buildConfidenceStateSync(inputs);

    // Most recent items should be kept (higher index = more recent)
    const keptDescriptions = sync.entries.map(e => e.description);
    expect(keptDescriptions).toContain("Item 509"); // Most recent
    expect(keptDescriptions).toContain(`Item ${MAX_CONFIDENCE_ITEMS + 9}`); // Most recent
    expect(keptDescriptions).not.toContain("Item 0"); // Oldest, should be truncated
  });

  it("should truncate source refs to MAX_SOURCE_REFS (20)", () => {
    const inputs: ConfidenceItemInput[] = [];
    // Create 25 refs for the same item across different inboxes
    for (let i = 0; i < 25; i++) {
      inputs.push({
        description: "Multi-source item",
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: `/inbox${i}.md`,
        artifactTitle: `Inbox ${i}`,
        entryId: `entry${i}`,
        firstSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        lastSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
      });
    }

    const sync = buildConfidenceStateSync(inputs);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.source_refs.length).toBe(MAX_SOURCE_REFS);
    expect(sync.entries[0]!.source_artifact_count).toBe(25);
    expect(sync.entries[0]!.source_refs_truncated).toBe(true);
  });

  it("should keep most recent source refs when truncating", () => {
    const inputs: ConfidenceItemInput[] = [];
    for (let i = 0; i < 25; i++) {
      inputs.push({
        description: "Multi-source item",
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: `/inbox${i}.md`,
        artifactTitle: `Inbox ${i}`,
        entryId: `entry${i}`,
        firstSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        lastSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
      });
    }

    const sync = buildConfidenceStateSync(inputs);

    // Most recent refs should be kept (higher index = more recent timestamp)
    const keptPaths = sync.entries[0]!.source_refs.map(r => r.artifactPath);
    expect(keptPaths).toContain("/inbox24.md"); // Most recent
    expect(keptPaths).toContain("/inbox5.md"); // 20th most recent
    expect(keptPaths).not.toContain("/inbox4.md"); // 21st most recent, should be truncated
  });

  it("should truncate descriptions to MAX_DESCRIPTION_LENGTH (500)", () => {
    const longDescription = "A".repeat(MAX_DESCRIPTION_LENGTH + 100);
    const input: ConfidenceItemInput = {
      description: longDescription,
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);

    expect(sync.entries[0]!.description.length).toBe(MAX_DESCRIPTION_LENGTH);
    expect(sync.entries[0]!.description.endsWith("...")).toBe(true);
    expect(sync.entries[0]!.description_truncated).toBe(true);
  });

  it("should not truncate descriptions at or below MAX_DESCRIPTION_LENGTH", () => {
    const exactLengthDescription = "A".repeat(MAX_DESCRIPTION_LENGTH);
    const input: ConfidenceItemInput = {
      description: exactLengthDescription,
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);

    expect(sync.entries[0]!.description.length).toBe(MAX_DESCRIPTION_LENGTH);
    expect(sync.entries[0]!.description_truncated).toBe(false);
  });

  it("should compute truncation diagnostics correctly", () => {
    const inputs: ConfidenceItemInput[] = [];
    
    // Add an item with truncated description
    inputs.push({
      description: "A".repeat(MAX_DESCRIPTION_LENGTH + 50),
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    });

    // Add items that cause source ref truncation
    for (let i = 0; i < 25; i++) {
      inputs.push({
        description: "Multi-source item",
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: `/inbox${i}.md`,
        artifactTitle: `Inbox ${i}`,
        entryId: `entry${i}`,
        firstSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        lastSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
      });
    }

    const sync = buildConfidenceStateSync(inputs);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics.itemsWithTruncatedDescriptions).toBe(1);
    expect(diagnostics.itemsWithTruncatedSources).toBe(1);
  });

  it("should handle triple truncation (items, refs, descriptions)", async () => {
    const inputs: ConfidenceItemInput[] = [];
    
    // Create more items than MAX_CONFIDENCE_ITEMS, each with long descriptions
    for (let i = 0; i < MAX_CONFIDENCE_ITEMS + 10; i++) {
      inputs.push({
        description: `Item ${i}: ${"A".repeat(MAX_DESCRIPTION_LENGTH + 50)}`,
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: "/inbox.md",
        artifactTitle: "Inbox",
        entryId: `entry${i}`,
        firstSeenAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
        lastSeenAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
      });
    }

    const sync = buildConfidenceStateSync(inputs);
    const result = await exportConfidenceStateSync(sync, { vaultPath: tempDir });

    expect(sync.entries.length).toBe(MAX_CONFIDENCE_ITEMS);
    expect(sync.truncated).toBe(true);
    expect(sync.entries.every(e => e.description_truncated)).toBe(true);
    expect(result.warnings.some(w => w.includes("truncated"))).toBe(true);
  });
});

// ============================================================================
// RERUN DETERMINISM TESTS
// ============================================================================

describe("Rerun Determinism", () => {
  it("should produce identical output for identical inputs", async () => {
    const input: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    // Build sync twice
    const sync1 = buildConfidenceStateSync([input]);
    const sync2 = buildConfidenceStateSync([input]);

    // Render both
    const rendered1 = renderConfidenceStateSync(sync1);
    const rendered2 = renderConfidenceStateSync(sync2);

    expect(rendered1).toBe(rendered2);
  });

  it("should produce stable confidence_item_id for same item across runs", () => {
    const input1: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Test item", // Same description
      sourceType: SourceType.OPEN_QUESTIONS, // Different source
      artifactPath: "/questions.md",
      artifactTitle: "Questions",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync1 = buildConfidenceStateSync([input1]);
    const sync2 = buildConfidenceStateSync([input2]);

    // Same item ID because descriptions are equivalent
    expect(sync1.entries[0]!.confidence_item_id).toBe(sync2.entries[0]!.confidence_item_id);
  });

  it("should produce stable fingerprint across different inputs with same normalized description", () => {
    const fingerprint1 = computeConfidenceItemFingerprint("Test Item");
    const fingerprint2 = computeConfidenceItemFingerprint("  test   item  ");
    const fingerprint3 = computeConfidenceItemFingerprint("Test item.");

    expect(fingerprint1.hash).toBe(fingerprint2.hash);
    expect(fingerprint2.hash).toBe(fingerprint3.hash);
  });

  it("should correctly identify equivalent items", () => {
    const item1 = "Test Item";
    const item2 = "  test   item  ";
    const item3 = "Different item";

    expect(confidenceItemsAreEquivalent(item1, item2)).toBe(true);
    expect(confidenceItemsAreEquivalent(item1, item3)).toBe(false);
  });

  it("should maintain stable entry order across reruns with same inputs", () => {
    const inputs: ConfidenceItemInput[] = [
      {
        description: "Item A",
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: "/inbox.md",
        artifactTitle: "Inbox",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Item B",
        sourceType: SourceType.OPEN_QUESTIONS,
        artifactPath: "/questions.md",
        artifactTitle: "Questions",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.VERIFIED,
        statusSource: StatusSource.MANUAL,
        statusChangedAt: "2026-03-03T11:00:00.000Z",
      },
      {
        description: "Item C",
        sourceType: SourceType.CONTRADICTION,
        artifactPath: "/contradiction.md",
        artifactTitle: "Contradiction",
        entryId: "entry3",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.REJECTED,
        statusSource: StatusSource.MANUAL,
        statusChangedAt: "2026-03-03T09:00:00.000Z",
      },
    ];

    const sync1 = buildConfidenceStateSync(inputs);
    const sync2 = buildConfidenceStateSync(inputs);

    expect(sync1.entries.map(e => e.confidence_item_id))
      .toEqual(sync2.entries.map(e => e.confidence_item_id));
  });

  it("should produce deterministic markdown output", async () => {
    const input: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);

    // Render multiple times
    const rendered1 = renderConfidenceStateSync(sync);
    const rendered2 = renderConfidenceStateSync(sync);
    const rendered3 = renderConfidenceStateSync(sync);

    expect(rendered1).toBe(rendered2);
    expect(rendered2).toBe(rendered3);
  });

  it("should produce deterministic export results", async () => {
    const input: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);
    const options: ExportSyncOptions = { vaultPath: tempDir };

    // Export twice
    const result1 = await exportConfidenceStateSync(sync, options);
    const result2 = await exportConfidenceStateSync(sync, options);

    // Results should be equivalent
    expect(result1.metadata).toEqual(result2.metadata);
    expect(result1.conflictDiagnostics).toEqual(result2.conflictDiagnostics);
    expect(result1.isEmpty).toBe(result2.isEmpty);

    // Second export should not be "created" (file already exists)
    expect(result1.created).toBe(true);
    expect(result2.created).toBe(false);
  });

  it("should maintain stable metadata across reruns", async () => {
    const inputs: ConfidenceItemInput[] = [
      {
        description: "Item 1",
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: "/inbox.md",
        artifactTitle: "Inbox",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.VERIFIED,
        statusSource: StatusSource.MANUAL,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Item 2",
        sourceType: SourceType.OPEN_QUESTIONS,
        artifactPath: "/questions.md",
        artifactTitle: "Questions",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    const sync1 = buildConfidenceStateSync(inputs);
    const metadata1 = extractSyncMetadata(sync1);

    const sync2 = buildConfidenceStateSync(inputs);
    const metadata2 = extractSyncMetadata(sync2);

    expect(metadata1.items_count).toBe(metadata2.items_count);
    expect(metadata1.status_counts_unverified).toBe(metadata2.status_counts_unverified);
    expect(metadata1.status_counts_verified).toBe(metadata2.status_counts_verified);
    expect(metadata1.status_counts_rejected).toBe(metadata2.status_counts_rejected);
    expect(metadata1.status_counts_deferred).toBe(metadata2.status_counts_deferred);
    expect(metadata1.total_source_refs).toBe(metadata2.total_source_refs);
  });
});

// ============================================================================
// EXPORT PATH TESTS
// ============================================================================

describe("Export Path", () => {
  it("should export sync to file", async () => {
    const input: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);
    const options: ExportSyncOptions = { vaultPath: tempDir };

    const result = await exportConfidenceStateSync(sync, options);

    expect(result.created).toBe(true);
    expect(result.isEmpty).toBe(false);
    expect(result.filePath).toContain("knowledge-confidence-state-sync.md");
    expect(result.metadata.items_count).toBe(1);
    expect(result.conflictDiagnostics.totalItemsWithMarkers).toBe(0);
  });

  it("should export empty sync", async () => {
    const options: ExportSyncOptions = { vaultPath: tempDir };

    const result = await exportEmptySync(options);

    expect(result.created).toBe(true);
    expect(result.isEmpty).toBe(true);
    expect(result.metadata.items_count).toBe(0);
    expect(result.conflictDiagnostics.totalItemsWithMarkers).toBe(0);
    expect(result.warnings).toContain("Sync is empty (no confidence items)");

    // Verify file exists and has correct content
    const exists = await syncFileExists(options);
    expect(exists).toBe(true);

    const content = await readSyncFile(options);
    expect(content).toContain("items_count: 0");
    expect(content).toContain("> No confidence items found.");
  });

  it("should update existing file instead of creating new one", async () => {
    const input: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);
    const options: ExportSyncOptions = { vaultPath: tempDir };

    // First export - should create
    const result1 = await exportConfidenceStateSync(sync, options);
    expect(result1.created).toBe(true);

    // Second export - should update
    const result2 = await exportConfidenceStateSync(sync, options);
    expect(result2.created).toBe(false);
  });

  it("should add truncation warning when sync is truncated", async () => {
    // Create more items than MAX_CONFIDENCE_ITEMS
    const inputs: ConfidenceItemInput[] = [];
    for (let i = 0; i < MAX_CONFIDENCE_ITEMS + 10; i++) {
      inputs.push({
        description: `Item ${i}`,
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: "/inbox.md",
        artifactTitle: "Inbox",
        entryId: `entry${i}`,
        firstSeenAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
        lastSeenAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
      });
    }

    const sync = buildConfidenceStateSync(inputs);
    const options: ExportSyncOptions = { vaultPath: tempDir };

    const result = await exportConfidenceStateSync(sync, options);

    expect(result.metadata.sync_truncated).toBe(true);
    expect(result.metadata.items_count).toBe(MAX_CONFIDENCE_ITEMS);
    expect(result.warnings.some(w => w.includes("truncated"))).toBe(true);
  });

  it("should add conflict warning when conflicts exist", async () => {
    const input1: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox1.md",
      artifactTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: ConfidenceItemInput = {
      description: "Test item", // Same description = same item
      sourceType: SourceType.OPEN_QUESTIONS,
      artifactPath: "/inbox2.md",
      artifactTitle: "Inbox 2",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED, // Different status!
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input1, input2]);
    const options: ExportSyncOptions = { vaultPath: tempDir };

    const result = await exportConfidenceStateSync(sync, options);

    expect(result.conflictDiagnostics.itemsWithConflictingSources).toBe(1);
    expect(result.warnings.some(w => w.includes("conflicting source statuses"))).toBe(true);
  });

  it("should create parent folder if it doesn't exist", async () => {
    const sync: ConfidenceStateSync = {
      entries: [],
      totalItems: 0,
      statusCounts: { unverified: 0, verified: 0, rejected: 0, deferred: 0 },
      totalSourceArtifacts: 0,
      totalSourceRefs: 0,
      truncated: false,
      sync_version: CONFIDENCE_STATE_SYNC_VERSION,
      generated_at: "2026-03-03T10:00:00.000Z",
    };

    const options: ExportSyncOptions = {
      vaultPath: tempDir,
      syncFolder: "some/nested/folder",
      createFolder: true,
    };

    const result = await exportConfidenceStateSync(sync, options);

    expect(result.created).toBe(true);
    expect(result.filePath).toContain("some/nested/folder");

    // Verify file exists
    const exists = await syncFileExists(options);
    expect(exists).toBe(true);
  });

  it("should write file atomically (check temp file cleanup)", async () => {
    const sync: ConfidenceStateSync = {
      entries: [],
      totalItems: 0,
      statusCounts: { unverified: 0, verified: 0, rejected: 0, deferred: 0 },
      totalSourceArtifacts: 0,
      totalSourceRefs: 0,
      truncated: false,
      sync_version: CONFIDENCE_STATE_SYNC_VERSION,
      generated_at: "2026-03-03T10:00:00.000Z",
    };

    const options: ExportSyncOptions = { vaultPath: tempDir };

    await exportConfidenceStateSync(sync, options);

    // Temp file should not exist after successful export
    const tempPath = `${resolveSyncPath(options)}.tmp`;
    const tempExists = await fs.access(tempPath).then(() => true).catch(() => false);
    expect(tempExists).toBe(false);
  });

  it("should generate correct default export options", () => {
    const options = getDefaultExportOptions("/vault");

    expect(options.vaultPath).toBe("/vault");
    expect(options.syncFolder).toBeUndefined();
    expect(options.syncFilename).toBe(DEFAULT_SYNC_FILENAME);
    expect(options.createFolder).toBe(true);
  });
});

// ============================================================================
// FILE OPERATIONS TESTS
// ============================================================================

describe("File Operations", () => {
  it("should check if sync file exists", async () => {
    const options: ExportSyncOptions = { vaultPath: tempDir };

    // File doesn't exist yet
    let exists = await syncFileExists(options);
    expect(exists).toBe(false);

    // Create file
    await exportEmptySync(options);

    // File now exists
    exists = await syncFileExists(options);
    expect(exists).toBe(true);
  });

  it("should read existing sync file", async () => {
    const options: ExportSyncOptions = { vaultPath: tempDir };

    await exportEmptySync(options);

    const content = await readSyncFile(options);

    expect(content).not.toBeNull();
    expect(content).toContain("# Knowledge Confidence State Sync");
  });

  it("should return null when reading non-existent file", async () => {
    const options: ExportSyncOptions = { vaultPath: tempDir };

    const content = await readSyncFile(options);

    expect(content).toBeNull();
  });

  it("should delete existing sync file", async () => {
    const options: ExportSyncOptions = { vaultPath: tempDir };

    await exportEmptySync(options);

    // Verify file exists
    let exists = await syncFileExists(options);
    expect(exists).toBe(true);

    // Delete file
    const deleted = await deleteSyncFile(options);
    expect(deleted).toBe(true);

    // Verify file is gone
    exists = await syncFileExists(options);
    expect(exists).toBe(false);
  });

  it("should return false when deleting non-existent file", async () => {
    const options: ExportSyncOptions = { vaultPath: tempDir };

    const deleted = await deleteSyncFile(options);
    expect(deleted).toBe(false);
  });
});

// ============================================================================
// FINGERPRINTING TESTS
// ============================================================================

describe("Fingerprinting", () => {
  it("should normalize descriptions consistently", () => {
    const fp1 = computeConfidenceItemFingerprint("Test Item");
    const fp2 = computeConfidenceItemFingerprint("  test   item  ");
    const fp3 = computeConfidenceItemFingerprint("TEST ITEM");
    const fp4 = computeConfidenceItemFingerprint("Test item.");

    expect(fp1.hash).toBe(fp2.hash);
    expect(fp2.hash).toBe(fp3.hash);
    expect(fp3.hash).toBe(fp4.hash);
  });

  it("should strip markdown links while keeping text", () => {
    const fp1 = computeConfidenceItemFingerprint("Test [[link|path]] item");
    const fp2 = computeConfidenceItemFingerprint("Test link item");

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("should strip checkbox markers", () => {
    const fp1 = computeConfidenceItemFingerprint("[ ] Test item");
    const fp2 = computeConfidenceItemFingerprint("[x] Test item");
    const fp3 = computeConfidenceItemFingerprint("Test item");

    expect(fp1.hash).toBe(fp3.hash);
    expect(fp2.hash).toBe(fp3.hash);
  });

  it("should collapse multiple whitespace", () => {
    const fp1 = computeConfidenceItemFingerprint("Test   item   here");
    const fp2 = computeConfidenceItemFingerprint("Test item here");

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("should remove trailing punctuation", () => {
    const fp1 = computeConfidenceItemFingerprint("Test item.");
    const fp2 = computeConfidenceItemFingerprint("Test item!");
    const fp3 = computeConfidenceItemFingerprint("Test item?");
    const fp4 = computeConfidenceItemFingerprint("Test item");

    expect(fp1.hash).toBe(fp4.hash);
    expect(fp2.hash).toBe(fp4.hash);
    expect(fp3.hash).toBe(fp4.hash);
  });

  it("should produce different hashes for different descriptions", () => {
    const fp1 = computeConfidenceItemFingerprint("Test item 1");
    const fp2 = computeConfidenceItemFingerprint("Test item 2");

    expect(fp1.hash).not.toBe(fp2.hash);
  });

  it("should produce stable 64-character hex hashes", () => {
    const fp = computeConfidenceItemFingerprint("Test item");

    expect(fp.hash).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/.test(fp.hash)).toBe(true);
  });
});

// ============================================================================
// WRITEBACK POLICY TESTS
// ============================================================================

describe("Writeback Policy", () => {
  it("should always write back MANUAL status", () => {
    const input: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);
    const entry = sync.entries[0]!;

    expect(shouldWriteBackStatus(entry.status, entry.status_source, entry.source_refs)).toBe(true);
  });

  it("should always write back AUTOMATED status", () => {
    const input: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.AUTOMATED,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);
    const entry = sync.entries[0]!;

    expect(shouldWriteBackStatus(entry.status, entry.status_source, entry.source_refs)).toBe(true);
  });

  it("should never write back ARTIFACT status", () => {
    const input: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildConfidenceStateSync([input]);
    const entry = sync.entries[0]!;

    expect(shouldWriteBackStatus(entry.status, entry.status_source, entry.source_refs)).toBe(false);
  });

  it("should write back INFERRED status only when upgrading", () => {
    const input1: ConfidenceItemInput = {
      description: "Test item",
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    // INFERRED VERIFIED should write back (upgrades UNVERIFIED)
    const sync1 = buildConfidenceStateSync([input1]);
    const entry1 = sync1.entries[0]!;
    expect(shouldWriteBackStatus(ConfidenceStatus.VERIFIED, StatusSource.INFERRED, entry1.source_refs)).toBe(true);

    // INFERRED UNVERIFIED should NOT write back (doesn't upgrade)
    expect(shouldWriteBackStatus(ConfidenceStatus.UNVERIFIED, StatusSource.INFERRED, entry1.source_refs)).toBe(false);
  });
});

// ============================================================================
// DESCRIPTION TRUNCATION TESTS
// ============================================================================

describe("Description Truncation", () => {
  it("should truncate descriptions at MAX_DESCRIPTION_LENGTH", () => {
    const longDesc = "A".repeat(MAX_DESCRIPTION_LENGTH + 100);
    const result = truncateDescription(longDesc);

    expect(result.truncated).toBe("A".repeat(MAX_DESCRIPTION_LENGTH - 3) + "...");
    expect(result.wasTruncated).toBe(true);
  });

  it("should not truncate short descriptions", () => {
    const shortDesc = "Short description";
    const result = truncateDescription(shortDesc);

    expect(result.truncated).toBe(shortDesc);
    expect(result.wasTruncated).toBe(false);
  });

  it("should not truncate descriptions at exact MAX_DESCRIPTION_LENGTH", () => {
    const exactDesc = "A".repeat(MAX_DESCRIPTION_LENGTH);
    const result = truncateDescription(exactDesc);

    expect(result.truncated).toBe(exactDesc);
    expect(result.wasTruncated).toBe(false);
  });
});

// ============================================================================
// SOURCE REFS TRUNCATION TESTS
// ============================================================================

describe("Source Refs Truncation", () => {
  it("should truncate source refs to MAX_SOURCE_REFS", () => {
    const refs: SourceArtifactRef[] = Array.from({ length: 25 }, (_, i) => ({
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: `/path${i}.md`,
      artifactTitle: `Title ${i}`,
      entryId: `entry${i}`,
      firstSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
      lastSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
    }));

    const result = buildSourceArtifactRefs(refs);

    expect(result.refs.length).toBe(MAX_SOURCE_REFS);
    expect(result.truncated).toBe(true);
  });

  it("should not truncate few source refs", () => {
    const refs: SourceArtifactRef[] = [
      {
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: "/path1.md",
        artifactTitle: "Title 1",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        sourceType: SourceType.OPEN_QUESTIONS,
        artifactPath: "/path2.md",
        artifactTitle: "Title 2",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    const result = buildSourceArtifactRefs(refs);

    expect(result.refs.length).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("should keep most recent refs when truncating", () => {
    const refs: SourceArtifactRef[] = Array.from({ length: 25 }, (_, i) => ({
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: `/path${i}.md`,
      artifactTitle: `Title ${i}`,
      entryId: `entry${i}`,
      firstSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
      lastSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
    }));

    const result = buildSourceArtifactRefs(refs);

    // Most recent refs (higher indices) should be kept
    expect(result.refs[0]!.artifactPath).toBe("/path24.md");
    expect(result.refs[19]!.artifactPath).toBe("/path5.md");
    expect(result.refs.every(r => r.artifactPath !== "/path4.md")).toBe(true);
  });
});

// ============================================================================
// STATUS RECONCILIATION TESTS
// ============================================================================

describe("Status Reconciliation", () => {
  it("should reconcile single ref correctly", () => {
    const ref = {
      sourceType: SourceType.KEY_TAKEAWAYS,
      artifactPath: "/inbox.md",
      artifactTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: ConfidenceStatus.VERIFIED,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const reconciled = reconcileStatus([ref]);

    expect(reconciled.status).toBe(ConfidenceStatus.VERIFIED);
    expect(reconciled.statusSource).toBe(StatusSource.MANUAL);
    expect(reconciled.statusChangedAt).toBe("2026-03-03T10:00:00.000Z");
  });

  it("should return default for empty refs", () => {
    const reconciled = reconcileStatus([]);

    expect(reconciled.status).toBe(ConfidenceStatus.UNVERIFIED);
    expect(reconciled.statusSource).toBe(StatusSource.ARTIFACT);
  });

  it("should resolve conflicts by precedence", () => {
    const refs = [
      {
        sourceType: SourceType.KEY_TAKEAWAYS,
        artifactPath: "/inbox.md",
        artifactTitle: "Inbox",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.UNVERIFIED,
        statusSource: StatusSource.ARTIFACT,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        sourceType: SourceType.KNOWLEDGE_TRIAGE,
        artifactPath: "/triage.md",
        artifactTitle: "Triage",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: ConfidenceStatus.VERIFIED,
        statusSource: StatusSource.MANUAL,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    const reconciled = reconcileStatus(refs);

    expect(reconciled.status).toBe(ConfidenceStatus.VERIFIED);
    expect(reconciled.statusSource).toBe(StatusSource.MANUAL);
  });
});
