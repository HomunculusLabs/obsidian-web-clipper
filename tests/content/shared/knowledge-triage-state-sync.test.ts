/**
 * Contract Tests for Knowledge Triage State Sync Exporter
 *
 * Tests the deterministic export path including:
 * - File path resolution
 * - Empty-state behavior (bounded, always creates file)
 * - Conflict diagnostics computation
 * - Atomic file writes
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { TriageStateSync, TriageItemInput } from "../../../src/shared/knowledgeTriageStateSyncContract";
import {
  TriageStatus,
  SourceInboxType,
  StatusSource,
  buildTriageStateSync,
  renderTriageStateSync,
  extractSyncMetadata,
  TRIAGE_STATE_SYNC_VERSION,
  MAX_TRIAGE_ITEMS,
  MAX_SOURCE_REFS,
  MAX_DESCRIPTION_LENGTH
} from "../../../src/shared/knowledgeTriageStateSyncContract";
import {
  resolveSyncPath,
  isSyncEmpty,
  computeConflictDiagnostics,
  renderEmptySync,
  exportTriageStateSync,
  exportEmptySync,
  syncFileExists,
  readSyncFile,
  deleteSyncFile,
  getDefaultExportOptions,
  formatConflictDiagnostics,
  getConflictSeverity,
  DEFAULT_SYNC_FILENAME,
  type ExportSyncOptions,
  type ConflictDiagnostics
} from "../../../src/shared/knowledgeTriageStateSyncExporter";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

// ============================================================================
// SETUP & TEARDOWN
// ============================================================================

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "triage-state-sync-test-"));
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
    expect(filePath).toBe("/vault/knowledge-triage-state-sync.md");
  });

  it("should use custom folder when specified", () => {
    const options: ExportSyncOptions = {
      vaultPath: "/vault",
      syncFolder: "inbox",
    };

    const filePath = resolveSyncPath(options);
    expect(filePath).toBe("/vault/inbox/knowledge-triage-state-sync.md");
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
    expect(filePath).toBe("/vault/some/nested/folder/knowledge-triage-state-sync.md");
  });

  it("should normalize leading/trailing slashes in folder", () => {
    const options: ExportSyncOptions = {
      vaultPath: "/vault",
      syncFolder: "/inbox/",
    };

    const filePath = resolveSyncPath(options);
    expect(filePath).toBe("/vault/inbox/knowledge-triage-state-sync.md");
  });

  it("should have correct default filename constant", () => {
    expect(DEFAULT_SYNC_FILENAME).toBe("knowledge-triage-state-sync.md");
  });
});

// ============================================================================
// EMPTY-STATE TESTS
// ============================================================================

describe("Empty-State Behavior", () => {
  it("should detect empty sync", () => {
    const sync: TriageStateSync = {
      entries: [],
      totalItems: 0,
      statusCounts: { ready: 0, inProgress: 0, blocked: 0, done: 0 },
      totalSourceInboxes: 0,
      totalSourceRefs: 0,
      truncated: false,
      sync_version: TRIAGE_STATE_SYNC_VERSION,
      generated_at: "2026-03-03T10:00:00.000Z",
    };

    expect(isSyncEmpty(sync)).toBe(true);
  });

  it("should not detect non-empty sync as empty", () => {
    const input: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox.md",
      inboxTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input]);

    expect(isSyncEmpty(sync)).toBe(false);
    expect(sync.entries).toHaveLength(1);
  });

  it("should render empty sync with explicit metadata", () => {
    const markdown = renderEmptySync("2026-03-03T10:00:00.000Z");

    expect(markdown).toContain("---");
    expect(markdown).toContain("sync_version: 1.0.0");
    expect(markdown).toContain("items_count: 0");
    expect(markdown).toContain("status_counts_ready: 0");
    expect(markdown).toContain("status_counts_in_progress: 0");
    expect(markdown).toContain("status_counts_blocked: 0");
    expect(markdown).toContain("status_counts_done: 0");
    expect(markdown).toContain("source_inboxes_processed: 0");
    expect(markdown).toContain("total_source_refs: 0");
    expect(markdown).toContain("sync_truncated: false");
    expect(markdown).toContain("generated_at: 2026-03-03T10:00:00.000Z");
    expect(markdown).toContain("# Knowledge Triage State Sync");
    expect(markdown).toContain("> No triage items found.");
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
    const sync: TriageStateSync = {
      entries: [],
      totalItems: 0,
      statusCounts: { ready: 0, inProgress: 0, blocked: 0, done: 0 },
      totalSourceInboxes: 0,
      totalSourceRefs: 0,
      truncated: false,
      sync_version: TRIAGE_STATE_SYNC_VERSION,
      generated_at: "2026-03-03T10:00:00.000Z",
    };

    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics).toEqual({
      itemsWithConflictingSources: 0,
      itemsWithInferredStatus: 0,
      itemsWithManualStatus: 0,
      itemsWithTruncatedSources: 0,
      itemsWithTruncatedDescriptions: 0,
      totalItemsWithMarkers: 0,
    });
  });

  it("should detect conflicting source statuses", () => {
    const input: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox1.md",
      inboxTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: TriageItemInput = {
      description: "Test item", // Same description = same item
      sourceInbox: SourceInboxType.OPEN_QUESTIONS,
      inboxPath: "/inbox2.md",
      inboxTitle: "Inbox 2",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.BLOCKED, // Different status!
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input, input2]);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics.itemsWithConflictingSources).toBe(1);
    expect(diagnostics.totalItemsWithMarkers).toBe(1);
  });

  it("should detect inferred status", () => {
    const input: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox.md",
      inboxTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.DONE,
      statusSource: StatusSource.INFERRED,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input]);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics.itemsWithInferredStatus).toBe(1);
    expect(diagnostics.totalItemsWithMarkers).toBe(1);
  });

  it("should detect manual status", () => {
    const input: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox.md",
      inboxTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.DONE,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input]);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics.itemsWithManualStatus).toBe(1);
    expect(diagnostics.totalItemsWithMarkers).toBe(1);
  });

  it("should detect truncated descriptions", () => {
    const longDescription = "A".repeat(MAX_DESCRIPTION_LENGTH + 100);
    const input: TriageItemInput = {
      description: longDescription,
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox.md",
      inboxTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input]);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics.itemsWithTruncatedDescriptions).toBe(1);
    expect(diagnostics.totalItemsWithMarkers).toBe(1);
  });

  it("should aggregate multiple conflict markers", () => {
    const input1: TriageItemInput = {
      description: "Item 1",
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox1.md",
      inboxTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.DONE,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: TriageItemInput = {
      description: "Item 2",
      sourceInbox: SourceInboxType.OPEN_QUESTIONS,
      inboxPath: "/inbox2.md",
      inboxTitle: "Inbox 2",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.INFERRED,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input1, input2]);
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
      itemsWithTruncatedSources: 1,
      itemsWithTruncatedDescriptions: 0,
      totalItemsWithMarkers: 5,
    };

    const formatted = formatConflictDiagnostics(diagnostics);

    expect(formatted).toContain("5 item(s) with conflict/ambiguity markers");
    expect(formatted).toContain("2 item(s) have conflicting source statuses");
    expect(formatted).toContain("1 item(s) have inferred status");
    expect(formatted).toContain("3 item(s) have manual status overrides");
  });

  it("should format zero diagnostics correctly", () => {
    const diagnostics: ConflictDiagnostics = {
      itemsWithConflictingSources: 0,
      itemsWithInferredStatus: 0,
      itemsWithManualStatus: 0,
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
      itemsWithTruncatedSources: 0,
      itemsWithTruncatedDescriptions: 0,
      totalItemsWithMarkers: 0,
    };

    const low: ConflictDiagnostics = {
      itemsWithConflictingSources: 0,
      itemsWithInferredStatus: 0,
      itemsWithManualStatus: 2,
      itemsWithTruncatedSources: 0,
      itemsWithTruncatedDescriptions: 0,
      totalItemsWithMarkers: 2,
    };

    const medium: ConflictDiagnostics = {
      itemsWithConflictingSources: 1,
      itemsWithInferredStatus: 0,
      itemsWithManualStatus: 0,
      itemsWithTruncatedSources: 0,
      itemsWithTruncatedDescriptions: 0,
      totalItemsWithMarkers: 1,
    };

    const high: ConflictDiagnostics = {
      itemsWithConflictingSources: 6,
      itemsWithInferredStatus: 0,
      itemsWithManualStatus: 0,
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
// EXPORT PATH TESTS
// ============================================================================

describe("Export Path", () => {
  it("should export sync to file", async () => {
    const input: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox.md",
      inboxTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input]);
    const options: ExportSyncOptions = { vaultPath: tempDir };

    const result = await exportTriageStateSync(sync, options);

    expect(result.created).toBe(true);
    expect(result.isEmpty).toBe(false);
    expect(result.filePath).toContain("knowledge-triage-state-sync.md");
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
    expect(result.warnings).toContain("Sync is empty (no triage items)");

    // Verify file exists and has correct content
    const exists = await syncFileExists(options);
    expect(exists).toBe(true);

    const content = await readSyncFile(options);
    expect(content).toContain("items_count: 0");
    expect(content).toContain("> No triage items found.");
  });

  it("should update existing file instead of creating new one", async () => {
    const input: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox.md",
      inboxTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input]);
    const options: ExportSyncOptions = { vaultPath: tempDir };

    // First export - should create
    const result1 = await exportTriageStateSync(sync, options);
    expect(result1.created).toBe(true);

    // Second export - should update
    const result2 = await exportTriageStateSync(sync, options);
    expect(result2.created).toBe(false);
  });

  it("should add truncation warning when sync is truncated", async () => {
    // Create more items than MAX_TRIAGE_ITEMS
    const inputs: TriageItemInput[] = [];
    for (let i = 0; i < MAX_TRIAGE_ITEMS + 10; i++) {
      inputs.push({
        description: `Item ${i}`,
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: "/inbox.md",
        inboxTitle: "Inbox",
        entryId: `entry${i}`,
        firstSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        lastSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
      });
    }

    const sync = buildTriageStateSync(inputs);
    const options: ExportSyncOptions = { vaultPath: tempDir };

    const result = await exportTriageStateSync(sync, options);

    expect(result.metadata.sync_truncated).toBe(true);
    expect(result.metadata.items_count).toBe(MAX_TRIAGE_ITEMS);
    expect(result.warnings.some(w => w.includes("truncated"))).toBe(true);
  });

  it("should add conflict warning when conflicts exist", async () => {
    const input1: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox1.md",
      inboxTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: TriageItemInput = {
      description: "Test item", // Same description = same item
      sourceInbox: SourceInboxType.OPEN_QUESTIONS,
      inboxPath: "/inbox2.md",
      inboxTitle: "Inbox 2",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.BLOCKED, // Different status!
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input1, input2]);
    const options: ExportSyncOptions = { vaultPath: tempDir };

    const result = await exportTriageStateSync(sync, options);

    expect(result.conflictDiagnostics.itemsWithConflictingSources).toBe(1);
    expect(result.warnings.some(w => w.includes("conflicting source statuses"))).toBe(true);
  });

  it("should create parent folder if it doesn't exist", async () => {
    const sync: TriageStateSync = {
      entries: [],
      totalItems: 0,
      statusCounts: { ready: 0, inProgress: 0, blocked: 0, done: 0 },
      totalSourceInboxes: 0,
      totalSourceRefs: 0,
      truncated: false,
      sync_version: TRIAGE_STATE_SYNC_VERSION,
      generated_at: "2026-03-03T10:00:00.000Z",
    };

    const options: ExportSyncOptions = {
      vaultPath: tempDir,
      syncFolder: "some/nested/folder",
      createFolder: true,
    };

    const result = await exportTriageStateSync(sync, options);

    expect(result.created).toBe(true);
    expect(result.filePath).toContain("some/nested/folder");

    // Verify file exists
    const exists = await syncFileExists(options);
    expect(exists).toBe(true);
  });

  it("should write file atomically (check temp file cleanup)", async () => {
    const sync: TriageStateSync = {
      entries: [],
      totalItems: 0,
      statusCounts: { ready: 0, inProgress: 0, blocked: 0, done: 0 },
      totalSourceInboxes: 0,
      totalSourceRefs: 0,
      truncated: false,
      sync_version: TRIAGE_STATE_SYNC_VERSION,
      generated_at: "2026-03-03T10:00:00.000Z",
    };

    const options: ExportSyncOptions = { vaultPath: tempDir };

    await exportTriageStateSync(sync, options);

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
    expect(content).toContain("# Knowledge Triage State Sync");
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
// DETERMINISM TESTS
// ============================================================================

describe("Determinism", () => {
  it("should produce identical output for identical inputs", async () => {
    const input: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox.md",
      inboxTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input]);

    // Export twice to different files
    const options1: ExportSyncOptions = { vaultPath: tempDir, syncFilename: "sync1.md" };
    const options2: ExportSyncOptions = { vaultPath: tempDir, syncFilename: "sync2.md" };

    await exportTriageStateSync(sync, options1);
    await exportTriageStateSync(sync, options2);

    const content1 = await readSyncFile(options1);
    const content2 = await readSyncFile(options2);

    expect(content1).toBe(content2);
  });

  it("should produce identical output for empty sync across calls", async () => {
    const options1: ExportSyncOptions = { vaultPath: tempDir, syncFilename: "empty1.md" };
    const options2: ExportSyncOptions = { vaultPath: tempDir, syncFilename: "empty2.md" };

    await exportEmptySync(options1, "2026-03-03T10:00:00.000Z");
    await exportEmptySync(options2, "2026-03-03T10:00:00.000Z");

    const content1 = await readSyncFile(options1);
    const content2 = await readSyncFile(options2);

    expect(content1).toBe(content2);
  });
});
