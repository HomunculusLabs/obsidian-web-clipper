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
// STATUS TRANSITION TESTS
// ============================================================================

describe("Status Transitions", () => {
  it("should handle READY -> IN_PROGRESS transition", () => {
    const input1: TriageItemInput = {
      description: "Task to work on",
      sourceInbox: SourceInboxType.EXECUTION_BACKLOG,
      inboxPath: "/backlog.md",
      inboxTitle: "Backlog",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: TriageItemInput = {
      description: "Task to work on",
      sourceInbox: SourceInboxType.KNOWLEDGE_TRIAGE,
      inboxPath: "/triage.md",
      inboxTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: TriageStatus.IN_PROGRESS,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input1, input2]);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.status).toBe(TriageStatus.IN_PROGRESS);
    expect(sync.entries[0]!.status_source).toBe(StatusSource.MANUAL);
  });

  it("should handle READY -> BLOCKED transition", () => {
    const input1: TriageItemInput = {
      description: "Blocked task",
      sourceInbox: SourceInboxType.EXECUTION_BACKLOG,
      inboxPath: "/backlog.md",
      inboxTitle: "Backlog",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: TriageItemInput = {
      description: "Blocked task",
      sourceInbox: SourceInboxType.OPEN_QUESTIONS,
      inboxPath: "/questions.md",
      inboxTitle: "Questions",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: TriageStatus.BLOCKED,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input1, input2]);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.status).toBe(TriageStatus.BLOCKED);
    expect(sync.statusCounts.blocked).toBe(1);
    expect(sync.statusCounts.ready).toBe(0);
  });

  it("should handle IN_PROGRESS -> DONE transition", () => {
    const input1: TriageItemInput = {
      description: "Completed task",
      sourceInbox: SourceInboxType.EXECUTION_BACKLOG,
      inboxPath: "/backlog.md",
      inboxTitle: "Backlog",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: TriageStatus.IN_PROGRESS,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: TriageItemInput = {
      description: "Completed task",
      sourceInbox: SourceInboxType.KNOWLEDGE_TRIAGE,
      inboxPath: "/triage.md",
      inboxTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: TriageStatus.DONE,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input1, input2]);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.status).toBe(TriageStatus.DONE);
    expect(sync.entries[0]!.status_source).toBe(StatusSource.MANUAL);
  });

  it("should handle DONE -> READY reopen transition", () => {
    const input1: TriageItemInput = {
      description: "Reopened task",
      sourceInbox: SourceInboxType.EXECUTION_BACKLOG,
      inboxPath: "/backlog.md",
      inboxTitle: "Backlog",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: TriageStatus.DONE,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: TriageItemInput = {
      description: "Reopened task",
      sourceInbox: SourceInboxType.KNOWLEDGE_TRIAGE,
      inboxPath: "/triage.md",
      inboxTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input1, input2]);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.status).toBe(TriageStatus.READY);
    expect(sync.entries[0]!.status_source).toBe(StatusSource.MANUAL);
  });

  it("should handle BLOCKED -> IN_PROGRESS transition", () => {
    const input1: TriageItemInput = {
      description: "Unblocked task",
      sourceInbox: SourceInboxType.EXECUTION_BACKLOG,
      inboxPath: "/backlog.md",
      inboxTitle: "Backlog",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: TriageStatus.BLOCKED,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: TriageItemInput = {
      description: "Unblocked task",
      sourceInbox: SourceInboxType.KNOWLEDGE_TRIAGE,
      inboxPath: "/triage.md",
      inboxTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: TriageStatus.IN_PROGRESS,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input1, input2]);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.status).toBe(TriageStatus.IN_PROGRESS);
  });

  it("should track status counts correctly across mixed statuses", () => {
    const inputs: TriageItemInput[] = [
      {
        description: "Ready item 1",
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: "/inbox1.md",
        inboxTitle: "Inbox 1",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "In progress item",
        sourceInbox: SourceInboxType.EXECUTION_BACKLOG,
        inboxPath: "/inbox2.md",
        inboxTitle: "Inbox 2",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.IN_PROGRESS,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Blocked item",
        sourceInbox: SourceInboxType.OPEN_QUESTIONS,
        inboxPath: "/inbox3.md",
        inboxTitle: "Inbox 3",
        entryId: "entry3",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.BLOCKED,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Done item",
        sourceInbox: SourceInboxType.CLIP_RECOVERY,
        inboxPath: "/inbox4.md",
        inboxTitle: "Inbox 4",
        entryId: "entry4",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.DONE,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    const sync = buildTriageStateSync(inputs);

    expect(sync.statusCounts.ready).toBe(1);
    expect(sync.statusCounts.inProgress).toBe(1);
    expect(sync.statusCounts.blocked).toBe(1);
    expect(sync.statusCounts.done).toBe(1);
  });
});

// ============================================================================
// PRECEDENCE CONFLICT TESTS
// ============================================================================

describe("Precedence Conflicts", () => {
  it("should prioritize MANUAL over INBOX status (same timestamp)", () => {
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
      description: "Test item",
      sourceInbox: SourceInboxType.KNOWLEDGE_TRIAGE,
      inboxPath: "/triage.md",
      inboxTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.DONE,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input1, input2]);

    expect(sync.entries[0]!.status).toBe(TriageStatus.DONE);
    expect(sync.entries[0]!.status_source).toBe(StatusSource.MANUAL);
  });

  it("should prioritize MANUAL over AUTOMATED status", () => {
    const input1: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox1.md",
      inboxTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.BLOCKED,
      statusSource: StatusSource.AUTOMATED,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.KNOWLEDGE_TRIAGE,
      inboxPath: "/triage.md",
      inboxTitle: "Triage",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.MANUAL,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input1, input2]);

    expect(sync.entries[0]!.status_source).toBe(StatusSource.MANUAL);
  });

  it("should prioritize AUTOMATED over INBOX status", () => {
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
      description: "Test item",
      sourceInbox: SourceInboxType.EXECUTION_BACKLOG,
      inboxPath: "/backlog.md",
      inboxTitle: "Backlog",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.DONE,
      statusSource: StatusSource.AUTOMATED,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input1, input2]);

    expect(sync.entries[0]!.status_source).toBe(StatusSource.AUTOMATED);
    expect(sync.entries[0]!.status).toBe(TriageStatus.DONE);
  });

  it("should prioritize INBOX over INFERRED status", () => {
    const input1: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox1.md",
      inboxTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.IN_PROGRESS,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const input2: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.OPEN_QUESTIONS,
      inboxPath: "/questions.md",
      inboxTitle: "Questions",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.DONE,
      statusSource: StatusSource.INFERRED,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input1, input2]);

    expect(sync.entries[0]!.status_source).toBe(StatusSource.INBOX);
    expect(sync.entries[0]!.status).toBe(TriageStatus.IN_PROGRESS);
  });

  it("should use most recent status_changed_at when same precedence", () => {
    const input1: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox1.md",
      inboxTitle: "Inbox 1",
      entryId: "entry1",
      firstSeenAt: "2026-03-01T10:00:00.000Z",
      lastSeenAt: "2026-03-01T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-01T10:00:00.000Z",
    };

    const input2: TriageItemInput = {
      description: "Test item",
      sourceInbox: SourceInboxType.OPEN_QUESTIONS,
      inboxPath: "/questions.md",
      inboxTitle: "Questions",
      entryId: "entry2",
      firstSeenAt: "2026-03-02T10:00:00.000Z",
      lastSeenAt: "2026-03-02T10:00:00.000Z",
      status: TriageStatus.DONE,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-02T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input1, input2]);

    expect(sync.entries[0]!.status).toBe(TriageStatus.DONE);
  });

  it("should use status value precedence when same precedence and timestamp (DONE > BLOCKED > IN_PROGRESS > READY)", () => {
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
      description: "Test item",
      sourceInbox: SourceInboxType.OPEN_QUESTIONS,
      inboxPath: "/questions.md",
      inboxTitle: "Questions",
      entryId: "entry2",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.BLOCKED,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    };

    const sync = buildTriageStateSync([input1, input2]);

    expect(sync.entries[0]!.status).toBe(TriageStatus.BLOCKED);
  });

  it("should detect conflicting source statuses across three inboxes", () => {
    const inputs: TriageItemInput[] = [
      {
        description: "Conflicting item",
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: "/inbox1.md",
        inboxTitle: "Inbox 1",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Conflicting item",
        sourceInbox: SourceInboxType.OPEN_QUESTIONS,
        inboxPath: "/questions.md",
        inboxTitle: "Questions",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.IN_PROGRESS,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Conflicting item",
        sourceInbox: SourceInboxType.EXECUTION_BACKLOG,
        inboxPath: "/backlog.md",
        inboxTitle: "Backlog",
        entryId: "entry3",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.BLOCKED,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    const sync = buildTriageStateSync(inputs);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(sync.entries).toHaveLength(1);
    expect(diagnostics.itemsWithConflictingSources).toBe(1);
    expect(sync.entries[0]!.source_inbox_count).toBe(3);
  });

  it("should handle four-way status source precedence correctly", () => {
    const inputs: TriageItemInput[] = [
      {
        description: "Precedence test",
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: "/inbox1.md",
        inboxTitle: "Inbox 1",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.DONE,
        statusSource: StatusSource.INFERRED,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Precedence test",
        sourceInbox: SourceInboxType.OPEN_QUESTIONS,
        inboxPath: "/questions.md",
        inboxTitle: "Questions",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.BLOCKED,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Precedence test",
        sourceInbox: SourceInboxType.EXECUTION_BACKLOG,
        inboxPath: "/backlog.md",
        inboxTitle: "Backlog",
        entryId: "entry3",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.IN_PROGRESS,
        statusSource: StatusSource.AUTOMATED,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Precedence test",
        sourceInbox: SourceInboxType.KNOWLEDGE_TRIAGE,
        inboxPath: "/triage.md",
        inboxTitle: "Triage",
        entryId: "entry4",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.READY,
        statusSource: StatusSource.MANUAL,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    const sync = buildTriageStateSync(inputs);

    // MANUAL should win despite READY being lowest status value
    expect(sync.entries[0]!.status_source).toBe(StatusSource.MANUAL);
    expect(sync.entries[0]!.status).toBe(TriageStatus.READY);
  });
});

// ============================================================================
// TRUNCATION TESTS
// ============================================================================

describe("Truncation", () => {
  it("should truncate items to MAX_TRIAGE_ITEMS (500)", () => {
    const inputs: TriageItemInput[] = [];
    for (let i = 0; i < MAX_TRIAGE_ITEMS + 50; i++) {
      inputs.push({
        description: `Item ${i}`,
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: "/inbox.md",
        inboxTitle: "Inbox",
        entryId: `entry${i}`,
        firstSeenAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
        lastSeenAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
      });
    }

    const sync = buildTriageStateSync(inputs);

    expect(sync.entries.length).toBe(MAX_TRIAGE_ITEMS);
    expect(sync.totalItems).toBe(MAX_TRIAGE_ITEMS + 50);
    expect(sync.truncated).toBe(true);
  });

  it("should keep most recently changed items when truncating", () => {
    const inputs: TriageItemInput[] = [];
    for (let i = 0; i < MAX_TRIAGE_ITEMS + 10; i++) {
      inputs.push({
        description: `Item ${i}`,
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: "/inbox.md",
        inboxTitle: "Inbox",
        entryId: `entry${i}`,
        firstSeenAt: "2026-03-01T10:00:00.000Z",
        lastSeenAt: "2026-03-01T10:00:00.000Z",
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`, // Each item has different timestamp
      });
    }

    const sync = buildTriageStateSync(inputs);

    // Most recent items should be kept (higher index = more recent)
    const keptDescriptions = sync.entries.map(e => e.description);
    expect(keptDescriptions).toContain("Item 509"); // Most recent
    expect(keptDescriptions).toContain(`Item ${MAX_TRIAGE_ITEMS + 9}`); // Most recent
    expect(keptDescriptions).not.toContain("Item 0"); // Oldest, should be truncated
  });

  it("should truncate source refs to MAX_SOURCE_REFS (20)", () => {
    const inputs: TriageItemInput[] = [];
    // Create 25 refs for the same item across different inboxes
    for (let i = 0; i < 25; i++) {
      inputs.push({
        description: "Multi-source item",
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: `/inbox${i}.md`,
        inboxTitle: `Inbox ${i}`,
        entryId: `entry${i}`,
        firstSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        lastSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
      });
    }

    const sync = buildTriageStateSync(inputs);

    expect(sync.entries).toHaveLength(1);
    expect(sync.entries[0]!.source_inbox_refs.length).toBe(MAX_SOURCE_REFS);
    expect(sync.entries[0]!.source_inbox_count).toBe(25);
    expect(sync.entries[0]!.source_refs_truncated).toBe(true);
  });

  it("should keep most recent source refs when truncating", () => {
    const inputs: TriageItemInput[] = [];
    for (let i = 0; i < 25; i++) {
      inputs.push({
        description: "Multi-source item",
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: `/inbox${i}.md`,
        inboxTitle: `Inbox ${i}`,
        entryId: `entry${i}`,
        firstSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        lastSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
      });
    }

    const sync = buildTriageStateSync(inputs);

    // Most recent refs should be kept (higher index = more recent timestamp)
    const keptPaths = sync.entries[0]!.source_inbox_refs.map(r => r.inboxPath);
    expect(keptPaths).toContain("/inbox24.md"); // Most recent
    expect(keptPaths).toContain("/inbox5.md"); // 20th most recent
    expect(keptPaths).not.toContain("/inbox4.md"); // 21st most recent, should be truncated
  });

  it("should truncate descriptions to MAX_DESCRIPTION_LENGTH (500)", () => {
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

    expect(sync.entries[0]!.description.length).toBe(MAX_DESCRIPTION_LENGTH);
    expect(sync.entries[0]!.description.endsWith("...")).toBe(true);
    expect(sync.entries[0]!.description_truncated).toBe(true);
  });

  it("should not truncate descriptions at or below MAX_DESCRIPTION_LENGTH", () => {
    const exactLengthDescription = "A".repeat(MAX_DESCRIPTION_LENGTH);
    const input: TriageItemInput = {
      description: exactLengthDescription,
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

    expect(sync.entries[0]!.description.length).toBe(MAX_DESCRIPTION_LENGTH);
    expect(sync.entries[0]!.description_truncated).toBe(false);
  });

  it("should compute truncation diagnostics correctly", () => {
    const inputs: TriageItemInput[] = [];
    
    // Add an item with truncated description
    inputs.push({
      description: "A".repeat(MAX_DESCRIPTION_LENGTH + 50),
      sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
      inboxPath: "/inbox.md",
      inboxTitle: "Inbox",
      entryId: "entry1",
      firstSeenAt: "2026-03-03T10:00:00.000Z",
      lastSeenAt: "2026-03-03T10:00:00.000Z",
      status: TriageStatus.READY,
      statusSource: StatusSource.INBOX,
      statusChangedAt: "2026-03-03T10:00:00.000Z",
    });

    // Add items that cause source ref truncation
    for (let i = 0; i < 25; i++) {
      inputs.push({
        description: "Multi-source item",
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: `/inbox${i}.md`,
        inboxTitle: `Inbox ${i}`,
        entryId: `entry${i}`,
        firstSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        lastSeenAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: `2026-03-03T10:${String(i).padStart(2, "0")}:00.000Z`,
      });
    }

    const sync = buildTriageStateSync(inputs);
    const diagnostics = computeConflictDiagnostics(sync);

    expect(diagnostics.itemsWithTruncatedDescriptions).toBe(1);
    expect(diagnostics.itemsWithTruncatedSources).toBe(1);
  });

  it("should handle triple truncation (items, refs, descriptions)", async () => {
    const inputs: TriageItemInput[] = [];
    
    // Create more items than MAX_TRIAGE_ITEMS, each with long descriptions
    for (let i = 0; i < MAX_TRIAGE_ITEMS + 10; i++) {
      inputs.push({
        description: `Item ${i}: ${"A".repeat(MAX_DESCRIPTION_LENGTH + 50)}`,
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: "/inbox.md",
        inboxTitle: "Inbox",
        entryId: `entry${i}`,
        firstSeenAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
        lastSeenAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: `2026-03-03T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
      });
    }

    const sync = buildTriageStateSync(inputs);
    const result = await exportTriageStateSync(sync, { vaultPath: tempDir });

    expect(sync.entries.length).toBe(MAX_TRIAGE_ITEMS);
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

  it("should produce identical sync across multiple builds with same inputs", () => {
    const inputs: TriageItemInput[] = [
      {
        description: "First item",
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: "/inbox1.md",
        inboxTitle: "Inbox 1",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Second item",
        sourceInbox: SourceInboxType.OPEN_QUESTIONS,
        inboxPath: "/inbox2.md",
        inboxTitle: "Inbox 2",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.DONE,
        statusSource: StatusSource.MANUAL,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Third item",
        sourceInbox: SourceInboxType.EXECUTION_BACKLOG,
        inboxPath: "/inbox3.md",
        inboxTitle: "Inbox 3",
        entryId: "entry3",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.IN_PROGRESS,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    // Build sync 5 times with same inputs
    const syncs = [];
    for (let i = 0; i < 5; i++) {
      syncs.push(buildTriageStateSync(inputs));
    }

    // Compare entries, status counts, and other deterministic fields (excluding generated_at)
    for (let i = 1; i < 5; i++) {
      expect(syncs[i]!.entries).toEqual(syncs[0]!.entries);
      expect(syncs[i]!.totalItems).toEqual(syncs[0]!.totalItems);
      expect(syncs[i]!.statusCounts).toEqual(syncs[0]!.statusCounts);
      expect(syncs[i]!.totalSourceInboxes).toEqual(syncs[0]!.totalSourceInboxes);
      expect(syncs[i]!.totalSourceRefs).toEqual(syncs[0]!.totalSourceRefs);
      expect(syncs[i]!.truncated).toEqual(syncs[0]!.truncated);
      expect(syncs[i]!.sync_version).toEqual(syncs[0]!.sync_version);
    }
  });

  it("should produce identical ordering across reruns with shuffled inputs", () => {
    const inputs: TriageItemInput[] = [
      {
        description: "Alpha item",
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: "/inbox1.md",
        inboxTitle: "Inbox 1",
        entryId: "entry1",
        firstSeenAt: "2026-03-01T10:00:00.000Z",
        lastSeenAt: "2026-03-01T10:00:00.000Z",
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-01T10:00:00.000Z",
      },
      {
        description: "Beta item",
        sourceInbox: SourceInboxType.OPEN_QUESTIONS,
        inboxPath: "/inbox2.md",
        inboxTitle: "Inbox 2",
        entryId: "entry2",
        firstSeenAt: "2026-03-02T10:00:00.000Z",
        lastSeenAt: "2026-03-02T10:00:00.000Z",
        status: TriageStatus.DONE,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-02T10:00:00.000Z",
      },
      {
        description: "Gamma item",
        sourceInbox: SourceInboxType.EXECUTION_BACKLOG,
        inboxPath: "/inbox3.md",
        inboxTitle: "Inbox 3",
        entryId: "entry3",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.IN_PROGRESS,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    // Build with original order
    const sync1 = buildTriageStateSync(inputs);

    // Build with shuffled order
    const shuffled = [...inputs].reverse();
    const sync2 = buildTriageStateSync(shuffled);

    // Entries should be in same deterministic order
    expect(sync1.entries.map(e => e.description)).toEqual(sync2.entries.map(e => e.description));
    expect(sync1.entries.map(e => e.status)).toEqual(sync2.entries.map(e => e.status));
  });

  it("should produce identical results across reruns with conflict scenarios", () => {
    // Create inputs with conflicting statuses
    const inputs: TriageItemInput[] = [
      {
        description: "Conflict item",
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: "/inbox1.md",
        inboxTitle: "Inbox 1",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Conflict item",
        sourceInbox: SourceInboxType.OPEN_QUESTIONS,
        inboxPath: "/inbox2.md",
        inboxTitle: "Inbox 2",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.BLOCKED,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    // Build multiple times
    const syncs = [];
    for (let i = 0; i < 3; i++) {
      syncs.push(buildTriageStateSync(inputs));
    }

    // All should resolve conflict the same way
    for (let i = 1; i < 3; i++) {
      expect(syncs[i]!.entries[0]!.status).toBe(syncs[0]!.entries[0]!.status);
      expect(syncs[i]!.entries[0]!.status_source).toBe(syncs[0]!.entries[0]!.status_source);
    }
  });

  it("should produce deterministic sorting with tie-breakers", () => {
    // Items with same status_changed_at should be sorted by status precedence
    const inputs: TriageItemInput[] = [
      {
        description: "Ready item",
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: "/inbox1.md",
        inboxTitle: "Inbox 1",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z", // Same timestamp
      },
      {
        description: "Done item",
        sourceInbox: SourceInboxType.EXECUTION_BACKLOG,
        inboxPath: "/inbox2.md",
        inboxTitle: "Inbox 2",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.DONE,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z", // Same timestamp
      },
      {
        description: "Blocked item",
        sourceInbox: SourceInboxType.OPEN_QUESTIONS,
        inboxPath: "/inbox3.md",
        inboxTitle: "Inbox 3",
        entryId: "entry3",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.BLOCKED,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z", // Same timestamp
      },
    ];

    // Build multiple times
    const orders = [];
    for (let i = 0; i < 5; i++) {
      const sync = buildTriageStateSync(inputs);
      orders.push(sync.entries.map(e => e.status));
    }

    // All orders should be identical (DONE > BLOCKED > READY)
    for (let i = 1; i < 5; i++) {
      expect(orders[i]).toEqual(orders[0]);
    }

    // Verify expected order: DONE first, then BLOCKED, then READY
    expect(orders[0]![0]).toBe(TriageStatus.DONE);
    expect(orders[0]![1]).toBe(TriageStatus.BLOCKED);
    expect(orders[0]![2]).toBe(TriageStatus.READY);
  });

  it("should produce identical exports with identical timestamps", async () => {
    const inputs: TriageItemInput[] = [
      {
        description: "Test item 1",
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: "/inbox1.md",
        inboxTitle: "Inbox 1",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        description: "Test item 2",
        sourceInbox: SourceInboxType.OPEN_QUESTIONS,
        inboxPath: "/inbox2.md",
        inboxTitle: "Inbox 2",
        entryId: "entry2",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.DONE,
        statusSource: StatusSource.MANUAL,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    const sync = buildTriageStateSync(inputs);

    // Export 3 times with same timestamp
    const options: ExportSyncOptions[] = [
      { vaultPath: tempDir, syncFilename: "det1.md" },
      { vaultPath: tempDir, syncFilename: "det2.md" },
      { vaultPath: tempDir, syncFilename: "det3.md" },
    ];

    for (const opt of options) {
      await exportTriageStateSync(sync, opt);
    }

    const contents = await Promise.all(options.map(opt => readSyncFile(opt)));

    // All should be identical
    expect(contents[1]).toBe(contents[0]);
    expect(contents[2]).toBe(contents[0]);
  });

  it("should maintain stable triage_item_id across reruns", () => {
    const inputs: TriageItemInput[] = [
      {
        description: "Stable ID item",
        sourceInbox: SourceInboxType.KEY_TAKEAWAYS,
        inboxPath: "/inbox1.md",
        inboxTitle: "Inbox 1",
        entryId: "entry1",
        firstSeenAt: "2026-03-03T10:00:00.000Z",
        lastSeenAt: "2026-03-03T10:00:00.000Z",
        status: TriageStatus.READY,
        statusSource: StatusSource.INBOX,
        statusChangedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const sync = buildTriageStateSync(inputs);
      ids.push(sync.entries[0]!.triage_item_id);
    }

    // All IDs should be identical
    expect(new Set(ids).size).toBe(1);

    // ID should be 64-character hex string
    expect(ids[0]).toMatch(/^[a-f0-9]{64}$/);
  });
});
