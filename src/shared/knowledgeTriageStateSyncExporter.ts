/**
 * Knowledge Triage State Sync Exporter
 *
 * This module provides the deterministic export path for the Knowledge Triage State Sync.
 * It handles:
 * - Resolving the sync file path within the vault
 * - Writing the sync markdown to a file
 * - Bounded empty-state behavior (always creates file with explicit metadata)
 * - Conflict diagnostics (status_source, multiple sources, truncation warnings)
 * - Error handling and fallback behavior
 *
 * Core Goals:
 * - Deterministic file path resolution
 * - Atomic file writes (write to temp, then rename)
 * - Explicit empty-state handling (always create file with metadata)
 * - Graceful error handling without corrupting existing sync
 * - Conflict diagnostics observability (warnings for ambiguous states)
 */

import { promises as fs } from "fs";
import * as path from "path";

import type { TriageStateSync, TriageStateMetadata } from "./knowledgeTriageStateSyncContract";
import {
  renderTriageStateSync,
  extractSyncMetadata,
  DEFAULT_EMPTY_SYNC_METADATA,
  TRIAGE_STATE_SYNC_VERSION,
  TriageStatus,
  MAX_TRIAGE_ITEMS,
  MAX_SOURCE_REFS,
  MAX_DESCRIPTION_LENGTH,
} from "./knowledgeTriageStateSyncContract";

/**
 * Default filename for the Knowledge Triage State Sync note.
 */
export const DEFAULT_SYNC_FILENAME = "knowledge-triage-state-sync.md" as const;

/**
 * Options for exporting the Knowledge Triage State Sync.
 */
export interface ExportSyncOptions {
  /** Vault root directory path */
  vaultPath: string;

  /** Folder within vault to save the sync (default: vault root) */
  syncFolder?: string;

  /** Custom filename for the sync (default: knowledge-triage-state-sync.md) */
  syncFilename?: string;

  /** Whether to create the folder if it doesn't exist (default: true) */
  createFolder?: boolean;
}

/**
 * Result of exporting the Knowledge Triage State Sync.
 */
export interface ExportSyncResult {
  /** Full path to the exported sync file */
  filePath: string;

  /** Whether the file was created (false if only updated) */
  created: boolean;

  /** Metadata extracted from the sync */
  metadata: TriageStateMetadata;

  /** Whether the sync was empty (no triage items) */
  isEmpty: boolean;

  /** Export options used */
  options: ExportSyncOptions;

  /** Conflict diagnostics - items with ambiguous status sources */
  conflictDiagnostics: ConflictDiagnostics;

  /** Any warnings encountered during export */
  warnings: string[];
}

/**
 * Conflict diagnostics for ambiguous triage states.
 *
 * Tracks items where status resolution may be non-obvious or where
 * multiple source inboxes disagree on status.
 */
export interface ConflictDiagnostics {
  /** Items with multiple source refs having different statuses */
  itemsWithConflictingSources: number;

  /** Items where status_source is INFERRED (lower confidence) */
  itemsWithInferredStatus: number;

  /** Items where status_source is MANUAL (high precedence override) */
  itemsWithManualStatus: number;

  /** Items with source refs truncated (may have hidden conflicts) */
  itemsWithTruncatedSources: number;

  /** Items with description truncated (may lose context) */
  itemsWithTruncatedDescriptions: number;

  /** Total number of items with any conflict or ambiguity marker */
  totalItemsWithMarkers: number;
}

/**
 * Error during sync export.
 */
export interface ExportSyncError {
  /** Error message */
  message: string;

  /** Error type */
  errorType: "write_error" | "folder_error" | "path_error" | "render_error";

  /** Original error (if any) */
  cause?: Error;
}

/**
 * Resolve the file path for the Knowledge Triage State Sync.
 *
 * The path is resolved deterministically as:
 * `{vaultPath}/{syncFolder}/{syncFilename}`
 *
 * Default: `{vaultPath}/knowledge-triage-state-sync.md`
 *
 * @param options - Export options
 * @returns Resolved file path
 */
export function resolveSyncPath(options: ExportSyncOptions): string {
  const { vaultPath, syncFolder, syncFilename } = options;

  // Normalize vault path
  const normalizedVaultPath = path.resolve(vaultPath);

  // Use default filename if not specified
  const filename = syncFilename || DEFAULT_SYNC_FILENAME;

  // If no folder specified, save to vault root
  if (!syncFolder) {
    return path.join(normalizedVaultPath, filename);
  }

  // Normalize folder path (remove leading/trailing slashes)
  const normalizedFolder = syncFolder
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");

  return path.join(normalizedVaultPath, normalizedFolder, filename);
}

/**
 * Check if the sync is empty (no triage items).
 *
 * @param sync - The sync to check
 * @returns true if the sync has no triage items
 */
export function isSyncEmpty(sync: TriageStateSync): boolean {
  return sync.entries.length === 0;
}

/**
 * Compute conflict diagnostics for a sync.
 *
 * Analyzes the sync entries for ambiguous states and potential conflicts.
 *
 * @param sync - The sync to analyze
 * @returns Conflict diagnostics
 */
export function computeConflictDiagnostics(sync: TriageStateSync): ConflictDiagnostics {
  const diagnostics: ConflictDiagnostics = {
    itemsWithConflictingSources: 0,
    itemsWithInferredStatus: 0,
    itemsWithManualStatus: 0,
    itemsWithTruncatedSources: 0,
    itemsWithTruncatedDescriptions: 0,
    totalItemsWithMarkers: 0,
  };

  for (const entry of sync.entries) {
    let hasMarker = false;

    // Check for conflicting source statuses
    if (entry.source_inbox_refs.length > 1) {
      const uniqueStatuses = new Set(entry.source_inbox_refs.map((ref) => ref.status));
      if (uniqueStatuses.size > 1) {
        diagnostics.itemsWithConflictingSources++;
        hasMarker = true;
      }
    }

    // Check for inferred status
    if (entry.status_source === "inferred") {
      diagnostics.itemsWithInferredStatus++;
      hasMarker = true;
    }

    // Check for manual status
    if (entry.status_source === "manual") {
      diagnostics.itemsWithManualStatus++;
      hasMarker = true;
    }

    // Check for truncated sources
    if (entry.source_refs_truncated) {
      diagnostics.itemsWithTruncatedSources++;
      hasMarker = true;
    }

    // Check for truncated descriptions
    if (entry.description_truncated) {
      diagnostics.itemsWithTruncatedDescriptions++;
      hasMarker = true;
    }

    if (hasMarker) {
      diagnostics.totalItemsWithMarkers++;
    }
  }

  return diagnostics;
}

/**
 * Render the empty-state sync.
 *
 * This produces a valid sync note even when there are no triage items.
 * The frontmatter is always populated with explicit zero/empty values.
 *
 * Conflict diagnostics will be all zeros for empty syncs.
 *
 * @param generatedAt - Timestamp for the sync (optional, defaults to now)
 * @returns Rendered markdown for empty sync
 */
export function renderEmptySync(generatedAt?: string): string {
  const timestamp = generatedAt || new Date().toISOString();

  // Create an empty sync with explicit metadata
  const emptySync: TriageStateSync = {
    entries: [],
    totalItems: 0,
    statusCounts: {
      ready: 0,
      inProgress: 0,
      blocked: 0,
      done: 0,
    },
    totalSourceInboxes: 0,
    totalSourceRefs: 0,
    truncated: false,
    sync_version: TRIAGE_STATE_SYNC_VERSION,
    generated_at: timestamp,
  };

  return renderTriageStateSync(emptySync);
}

/**
 * Ensure the parent directory exists for the sync file.
 *
 * @param filePath - Full path to the sync file
 * @param createIfMissing - Whether to create the directory if it doesn't exist
 * @returns Promise that resolves when done
 */
async function ensureParentDirectory(
  filePath: string,
  createIfMissing: boolean
): Promise<void> {
  const parentDir = path.dirname(filePath);

  try {
    await fs.access(parentDir);
  } catch {
    if (createIfMissing) {
      await fs.mkdir(parentDir, { recursive: true });
    } else {
      throw new Error(`Parent directory does not exist: ${parentDir}`);
    }
  }
}

/**
 * Write content to a file atomically.
 *
 * Writes to a temporary file first, then renames to the target path.
 * This prevents partial writes and corruption.
 *
 * @param filePath - Target file path
 * @param content - Content to write
 * @returns Promise that resolves when done
 */
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp`;

  try {
    // Write to temp file
    await fs.writeFile(tempPath, content, "utf-8");

    // Rename to final path (atomic on most filesystems)
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }

    throw error;
  }
}

/**
 * Export the Knowledge Triage State Sync to a file.
 *
 * This is the main entry point for the export path.
 *
 * Behavior:
 * - Resolves the file path deterministically
 * - Creates the parent folder if needed
 * - Renders the sync to markdown with bounded empty-state handling
 * - Computes conflict diagnostics for observability
 * - Writes atomically to prevent corruption
 * - Always creates a file, even when empty
 * - Returns metadata and conflict diagnostics for observability
 *
 * Bounded empty-state behavior:
 * - Empty syncs always create a file with explicit zero metadata
 * - No "file not found" states after first export
 * - Frontmatter always contains all required fields
 * - Conflict diagnostics are computed (all zeros for empty)
 *
 * Conflict diagnostics behavior:
 * - Items with conflicting source statuses are tracked
 * - Items with inferred/manual status are counted
 * - Truncation markers are flagged
 * - Warnings are generated for significant ambiguity
 *
 * @param sync - The sync to export
 * @param options - Export options
 * @returns Export result with metadata and conflict diagnostics
 * @throws ExportSyncError on failure
 */
export async function exportTriageStateSync(
  sync: TriageStateSync,
  options: ExportSyncOptions
): Promise<ExportSyncResult> {
  const warnings: string[] = [];
  const createFolder = options.createFolder !== false;

  // Resolve file path
  const filePath = resolveSyncPath(options);

  // Check if file already exists
  let created = false;
  try {
    await fs.access(filePath);
  } catch {
    created = true;
  }

  // Ensure parent directory exists
  try {
    await ensureParentDirectory(filePath, createFolder);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw {
      message: `Failed to ensure parent directory: ${err.message}`,
      errorType: "folder_error" as const,
      cause: err,
    } satisfies ExportSyncError;
  }

  // Render sync to markdown
  let markdown: string;
  try {
    markdown = renderTriageStateSync(sync);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw {
      message: `Failed to render sync: ${err.message}`,
      errorType: "render_error" as const,
      cause: err,
    } satisfies ExportSyncError;
  }

  // Write atomically
  try {
    await writeFileAtomic(filePath, markdown);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw {
      message: `Failed to write sync file: ${err.message}`,
      errorType: "write_error" as const,
      cause: err,
    } satisfies ExportSyncError;
  }

  // Extract metadata
  const metadata = extractSyncMetadata(sync);

  // Compute conflict diagnostics
  const conflictDiagnostics = computeConflictDiagnostics(sync);

  // Check if empty
  const isEmpty = isSyncEmpty(sync);
  if (isEmpty) {
    warnings.push("Sync is empty (no triage items)");
  }

  // Add truncation warning if applicable
  if (sync.truncated) {
    warnings.push(
      `Sync was truncated to ${MAX_TRIAGE_ITEMS} items (out of ${sync.totalItems} total)`
    );
  }

  // Add conflict warnings
  if (conflictDiagnostics.itemsWithConflictingSources > 0) {
    warnings.push(
      `${conflictDiagnostics.itemsWithConflictingSources} items have conflicting source statuses`
    );
  }

  if (conflictDiagnostics.itemsWithInferredStatus > 0) {
    warnings.push(
      `${conflictDiagnostics.itemsWithInferredStatus} items have inferred status (lower confidence)`
    );
  }

  if (conflictDiagnostics.itemsWithTruncatedSources > 0) {
    warnings.push(
      `${conflictDiagnostics.itemsWithTruncatedSources} items have truncated source refs (may hide conflicts)`
    );
  }

  return {
    filePath,
    created,
    metadata,
    isEmpty,
    options,
    conflictDiagnostics,
    warnings,
  };
}

/**
 * Export an empty sync to a file.
 *
 * This is a convenience function for creating an empty placeholder sync.
 * All conflict diagnostics will be zero.
 *
 * @param options - Export options
 * @param generatedAt - Timestamp for the sync (optional)
 * @returns Export result with metadata and conflict diagnostics
 * @throws ExportSyncError on failure
 */
export async function exportEmptySync(
  options: ExportSyncOptions,
  generatedAt?: string
): Promise<ExportSyncResult> {
  const timestamp = generatedAt || new Date().toISOString();

  // Create empty sync
  const emptySync: TriageStateSync = {
    entries: [],
    totalItems: 0,
    statusCounts: {
      ready: 0,
      inProgress: 0,
      blocked: 0,
      done: 0,
    },
    totalSourceInboxes: 0,
    totalSourceRefs: 0,
    truncated: false,
    sync_version: TRIAGE_STATE_SYNC_VERSION,
    generated_at: timestamp,
  };

  return exportTriageStateSync(emptySync, options);
}

/**
 * Check if a sync file exists at the expected path.
 *
 * @param options - Export options
 * @returns Promise resolving to true if file exists
 */
export async function syncFileExists(options: ExportSyncOptions): Promise<boolean> {
  const filePath = resolveSyncPath(options);

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read an existing sync file.
 *
 * @param options - Export options
 * @returns File content, or null if file doesn't exist
 */
export async function readSyncFile(options: ExportSyncOptions): Promise<string | null> {
  const filePath = resolveSyncPath(options);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content;
  } catch {
    return null;
  }
}

/**
 * Delete an existing sync file.
 *
 * @param options - Export options
 * @returns true if file was deleted, false if it didn't exist
 */
export async function deleteSyncFile(options: ExportSyncOptions): Promise<boolean> {
  const filePath = resolveSyncPath(options);

  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the default export options for a vault.
 *
 * @param vaultPath - Path to the vault root
 * @returns Default export options
 */
export function getDefaultExportOptions(vaultPath: string): ExportSyncOptions {
  return {
    vaultPath,
    syncFolder: undefined,
    syncFilename: DEFAULT_SYNC_FILENAME,
    createFolder: true,
  };
}

/**
 * Conflict diagnostic messages for human-readable output.
 *
 * These messages explain what each conflict marker means and
 * suggest actions if applicable.
 */

/**
 * Format conflict diagnostics as a human-readable summary.
 *
 * @param diagnostics - Conflict diagnostics to format
 * @returns Formatted summary string
 */
export function formatConflictDiagnostics(diagnostics: ConflictDiagnostics): string {
  const lines: string[] = [];

  if (diagnostics.totalItemsWithMarkers === 0) {
    lines.push("✅ No conflicts or ambiguities detected.");
    return lines.join("\n");
  }

  lines.push(`⚠️ ${diagnostics.totalItemsWithMarkers} item(s) with conflict/ambiguity markers:\n`);

  if (diagnostics.itemsWithConflictingSources > 0) {
    lines.push(
      `  - ${diagnostics.itemsWithConflictingSources} item(s) have conflicting source statuses (different inboxes report different status)`
    );
  }

  if (diagnostics.itemsWithInferredStatus > 0) {
    lines.push(
      `  - ${diagnostics.itemsWithInferredStatus} item(s) have inferred status (automatically assigned, lower confidence)`
    );
  }

  if (diagnostics.itemsWithManualStatus > 0) {
    lines.push(
      `  - ${diagnostics.itemsWithManualStatus} item(s) have manual status overrides (set in Knowledge Triage Inbox)`
    );
  }

  if (diagnostics.itemsWithTruncatedSources > 0) {
    lines.push(
      `  - ${diagnostics.itemsWithTruncatedSources} item(s) have truncated source refs (may hide additional conflicts, max: ${MAX_SOURCE_REFS})`
    );
  }

  if (diagnostics.itemsWithTruncatedDescriptions > 0) {
    lines.push(
      `  - ${diagnostics.itemsWithTruncatedDescriptions} item(s) have truncated descriptions (max: ${MAX_DESCRIPTION_LENGTH} chars)`
    );
  }

  return lines.join("\n");
}

/**
 * Get severity level for conflict diagnostics.
 *
 * @param diagnostics - Conflict diagnostics to assess
 * @returns Severity level: "none", "low", "medium", "high"
 */
export function getConflictSeverity(diagnostics: ConflictDiagnostics): "none" | "low" | "medium" | "high" {
  if (diagnostics.totalItemsWithMarkers === 0) {
    return "none";
  }

  // High severity: many conflicts or inferred statuses
  if (
    diagnostics.itemsWithConflictingSources > 5 ||
    diagnostics.itemsWithInferredStatus > 10 ||
    diagnostics.totalItemsWithMarkers > 20
  ) {
    return "high";
  }

  // Medium severity: some conflicts or inferred statuses
  if (
    diagnostics.itemsWithConflictingSources > 0 ||
    diagnostics.itemsWithInferredStatus > 5 ||
    diagnostics.itemsWithTruncatedSources > 3
  ) {
    return "medium";
  }

  // Low severity: manual overrides or truncation
  if (
    diagnostics.itemsWithManualStatus > 0 ||
    diagnostics.itemsWithTruncatedDescriptions > 0
  ) {
    return "low";
  }

  return "low";
}
