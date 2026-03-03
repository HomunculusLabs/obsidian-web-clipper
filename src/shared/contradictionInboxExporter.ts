/**
 * Contradiction Inbox Exporter
 *
 * This module provides the deterministic export path for the Contradiction Inbox.
 * It handles:
 * - Resolving the inbox file path within the vault
 * - Writing the inbox markdown to a file
 * - Explicit empty-state behavior (always creates file with metadata)
 * - Bounded conflict-status metadata tracking
 * - Error handling and fallback behavior
 *
 * Core Goals:
 * - Deterministic file path resolution
 * - Atomic file writes (write to temp, then rename)
 * - Explicit empty-state handling (always create the file, even when empty)
 * - Bounded conflict-status metadata (tracks resolved/false-positive states)
 * - Graceful error handling without corrupting existing inbox
 */

import { promises as fs } from "fs";
import * as path from "path";

import type { ContradictionInbox, InboxMetadata, ConflictEntry, ConflictStatus } from "./contradictionInboxContract";
import {
  renderContradictionInbox,
  extractInboxMetadata,
  DEFAULT_EMPTY_INBOX_METADATA,
  CONTRADICTION_INBOX_VERSION,
  ConflictStatus as ContractConflictStatus,
  MAX_CONFLICTS,
  MAX_CLAIMS_PER_CONFLICT,
  MAX_SOURCE_CLIP_REFS,
} from "./contradictionInboxContract";

/**
 * Default filename for the Contradiction Inbox note.
 */
export const DEFAULT_INBOX_FILENAME = "contradiction-inbox.md" as const;

/**
 * Options for exporting the Contradiction Inbox.
 */
export interface ExportInboxOptions {
  /** Vault root directory path */
  vaultPath: string;

  /** Folder within vault to save the inbox (default: vault root) */
  inboxFolder?: string;

  /** Custom filename for the inbox (default: contradiction-inbox.md) */
  inboxFilename?: string;

  /** Whether to create the folder if it doesn't exist (default: true) */
  createFolder?: boolean;
}

/**
 * Result of exporting the Contradiction Inbox.
 */
export interface ExportInboxResult {
  /** Full path to the exported inbox file */
  filePath: string;

  /** Whether the file was created (false if only updated) */
  created: boolean;

  /** Metadata extracted from the inbox */
  metadata: InboxMetadata;

  /** Whether the inbox was empty (no open conflicts) */
  isEmpty: boolean;

  /** Export options used */
  options: ExportInboxOptions;

  /** Conflict-status metadata - bounded tracking of conflict states */
  conflictStatusMeta: ConflictStatusMetadata;

  /** Any warnings encountered during export */
  warnings: string[];
}

/**
 * Bounded conflict-status metadata.
 *
 * Tracks the distribution of conflict statuses and provides
 * observability into resolution/false-positive rates.
 */
export interface ConflictStatusMetadata {
  /** Number of open conflicts */
  openCount: number;

  /** Number of resolved conflicts */
  resolvedCount: number;

  /** Number of false positive conflicts */
  falsePositiveCount: number;

  /** Percentage of conflicts that are open */
  openPercentage: number;

  /** Percentage of conflicts that are resolved */
  resolvedPercentage: number;

  /** Percentage of conflicts that are false positives */
  falsePositivePercentage: number;

  /** Total conflicts before filtering */
  totalBeforeFilter: number;

  /** Whether any conflicts were filtered out */
  hasFilteredConflicts: boolean;
}

/**
 * Error during inbox export.
 */
export interface ExportInboxError {
  /** Error message */
  message: string;

  /** Error type */
  errorType: "write_error" | "folder_error" | "path_error" | "render_error";

  /** Original error (if any) */
  cause?: Error;
}

/**
 * Resolve the file path for the Contradiction Inbox.
 *
 * The path is resolved deterministically as:
 * `{vaultPath}/{inboxFolder}/{inboxFilename}`
 *
 * Default: `{vaultPath}/contradiction-inbox.md`
 *
 * @param options - Export options
 * @returns Resolved file path
 */
export function resolveInboxPath(options: ExportInboxOptions): string {
  const { vaultPath, inboxFolder, inboxFilename } = options;

  // Normalize vault path
  const normalizedVaultPath = path.resolve(vaultPath);

  // Use default filename if not specified
  const filename = inboxFilename || DEFAULT_INBOX_FILENAME;

  // If no folder specified, save to vault root
  if (!inboxFolder) {
    return path.join(normalizedVaultPath, filename);
  }

  // Normalize folder path (remove leading/trailing slashes)
  const normalizedFolder = inboxFolder
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");

  return path.join(normalizedVaultPath, normalizedFolder, filename);
}

/**
 * Check if the inbox is empty (no open conflicts).
 *
 * @param inbox - The inbox to check
 * @returns true if the inbox has no open conflicts
 */
export function isInboxEmpty(inbox: ContradictionInbox): boolean {
  return inbox.entries.length === 0 && inbox.openConflicts === 0;
}

/**
 * Compute conflict-status metadata for bounded tracking.
 *
 * Calculates the distribution of conflict statuses and provides
 * percentages for observability into resolution patterns.
 *
 * @param inbox - The inbox to analyze
 * @returns Conflict-status metadata
 */
export function computeConflictStatusMetadata(inbox: ContradictionInbox): ConflictStatusMetadata {
  const total = inbox.totalConflicts;

  if (total === 0) {
    return {
      openCount: 0,
      resolvedCount: 0,
      falsePositiveCount: 0,
      openPercentage: 0,
      resolvedPercentage: 0,
      falsePositivePercentage: 0,
      totalBeforeFilter: 0,
      hasFilteredConflicts: false,
    };
  }

  const openCount = inbox.openConflicts;
  const resolvedCount = inbox.resolvedConflicts;
  const falsePositiveCount = inbox.falsePositiveConflicts;

  return {
    openCount,
    resolvedCount,
    falsePositiveCount,
    openPercentage: Math.round((openCount / total) * 100 * 100) / 100,
    resolvedPercentage: Math.round((resolvedCount / total) * 100 * 100) / 100,
    falsePositivePercentage: Math.round((falsePositiveCount / total) * 100 * 100) / 100,
    totalBeforeFilter: total,
    hasFilteredConflicts: resolvedCount > 0 || (openCount + falsePositiveCount) < total,
  };
}

/**
 * Render the empty-state inbox.
 *
 * This produces a valid inbox note even when there are no conflicts.
 * The frontmatter is always populated with explicit zero/empty values.
 *
 * @param generatedAt - Timestamp for the inbox (optional, defaults to now)
 * @returns Rendered markdown for empty inbox
 */
export function renderEmptyInbox(generatedAt?: string): string {
  const timestamp = generatedAt || new Date().toISOString();

  // Create an empty inbox with explicit metadata
  const emptyInbox: ContradictionInbox = {
    entries: [],
    totalClaims: 0,
    totalConflicts: 0,
    openConflicts: 0,
    resolvedConflicts: 0,
    falsePositiveConflicts: 0,
    totalClips: 0,
    truncated: false,
    inbox_version: CONTRADICTION_INBOX_VERSION,
    generated_at: timestamp,
  };

  return renderContradictionInbox(emptyInbox);
}

/**
 * Ensure the parent directory exists for the inbox file.
 *
 * @param filePath - Full path to the inbox file
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
 * Export the Contradiction Inbox to a file.
 *
 * This is the main entry point for the export path.
 *
 * Behavior:
 * - Resolves the file path deterministically
 * - Creates the parent folder if needed
 * - Renders the inbox to markdown with explicit empty-state handling
 * - Computes bounded conflict-status metadata
 * - Writes atomically to prevent corruption
 * - Always creates a file, even when empty
 * - Returns metadata and conflict-status metadata for observability
 *
 * Explicit empty-state behavior:
 * - Empty inboxes always create a file with explicit zero metadata
 * - No "file not found" states after first export
 * - Frontmatter always contains all required fields
 * - Conflict-status metadata is computed (all zeros for empty)
 *
 * Bounded conflict-status metadata:
 * - Tracks open/resolved/false-positive counts
 * - Provides percentages for resolution rate observability
 * - Indicates whether conflicts were filtered from output
 *
 * @param inbox - The inbox to export
 * @param options - Export options
 * @returns Export result with metadata and conflict-status metadata
 * @throws ExportInboxError on failure
 */
export async function exportContradictionInbox(
  inbox: ContradictionInbox,
  options: ExportInboxOptions
): Promise<ExportInboxResult> {
  const warnings: string[] = [];
  const createFolder = options.createFolder !== false;

  // Resolve file path
  const filePath = resolveInboxPath(options);

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
    } satisfies ExportInboxError;
  }

  // Render inbox to markdown
  let markdown: string;
  try {
    markdown = renderContradictionInbox(inbox);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw {
      message: `Failed to render inbox: ${err.message}`,
      errorType: "render_error" as const,
      cause: err,
    } satisfies ExportInboxError;
  }

  // Write atomically
  try {
    await writeFileAtomic(filePath, markdown);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw {
      message: `Failed to write inbox file: ${err.message}`,
      errorType: "write_error" as const,
      cause: err,
    } satisfies ExportInboxError;
  }

  // Extract metadata
  const metadata = extractInboxMetadata(inbox);

  // Compute conflict-status metadata
  const conflictStatusMeta = computeConflictStatusMetadata(inbox);

  // Check if empty
  const isEmpty = isInboxEmpty(inbox);
  if (isEmpty) {
    warnings.push("Inbox is empty (no open conflicts)");
  }

  // Add truncation warning if applicable
  if (metadata.inbox_truncated) {
    warnings.push(`Inbox was truncated to ${inbox.entries.length} conflicts (out of ${inbox.totalConflicts} total)`);
  }

  // Add conflict filtering warning if applicable
  if (conflictStatusMeta.hasFilteredConflicts) {
    warnings.push(`${conflictStatusMeta.resolvedCount} resolved conflicts filtered from output`);
  }

  return {
    filePath,
    created,
    metadata,
    isEmpty,
    options,
    conflictStatusMeta,
    warnings,
  };
}

/**
 * Export an empty inbox to a file.
 *
 * This is a convenience function for creating an empty placeholder inbox.
 * All conflict-status metadata will be zero.
 *
 * @param options - Export options
 * @param generatedAt - Timestamp for the inbox (optional)
 * @returns Export result with metadata and conflict-status metadata
 * @throws ExportInboxError on failure
 */
export async function exportEmptyInbox(
  options: ExportInboxOptions,
  generatedAt?: string
): Promise<ExportInboxResult> {
  const timestamp = generatedAt || new Date().toISOString();

  // Create empty inbox
  const emptyInbox: ContradictionInbox = {
    entries: [],
    totalClaims: 0,
    totalConflicts: 0,
    openConflicts: 0,
    resolvedConflicts: 0,
    falsePositiveConflicts: 0,
    totalClips: 0,
    truncated: false,
    inbox_version: CONTRADICTION_INBOX_VERSION,
    generated_at: timestamp,
  };

  return exportContradictionInbox(emptyInbox, options);
}

/**
 * Check if an inbox file exists at the expected path.
 *
 * @param options - Export options
 * @returns Promise resolving to true if file exists
 */
export async function inboxFileExists(options: ExportInboxOptions): Promise<boolean> {
  const filePath = resolveInboxPath(options);

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read an existing inbox file.
 *
 * @param options - Export options
 * @returns File content, or null if file doesn't exist
 */
export async function readInboxFile(options: ExportInboxOptions): Promise<string | null> {
  const filePath = resolveInboxPath(options);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content;
  } catch {
    return null;
  }
}

/**
 * Delete an existing inbox file.
 *
 * @param options - Export options
 * @returns true if file was deleted, false if it didn't exist
 */
export async function deleteInboxFile(options: ExportInboxOptions): Promise<boolean> {
  const filePath = resolveInboxPath(options);

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
export function getDefaultExportOptions(vaultPath: string): ExportInboxOptions {
  return {
    vaultPath,
    inboxFolder: undefined,
    inboxFilename: DEFAULT_INBOX_FILENAME,
    createFolder: true,
  };
}

/**
 * Format conflict-status metadata as a human-readable summary.
 *
 * @param meta - Conflict-status metadata to format
 * @returns Formatted summary string
 */
export function formatConflictStatusMeta(meta: ConflictStatusMetadata): string {
  const lines: string[] = [];

  lines.push(`Conflict Status Summary:`);
  lines.push(`  Open: ${meta.openCount} (${meta.openPercentage}%)`);
  lines.push(`  Resolved: ${meta.resolvedCount} (${meta.resolvedPercentage}%)`);
  lines.push(`  False Positive: ${meta.falsePositiveCount} (${meta.falsePositivePercentage}%)`);

  if (meta.hasFilteredConflicts) {
    lines.push(`  Note: ${meta.totalBeforeFilter - meta.openCount - meta.falsePositiveCount} resolved conflicts filtered from output`);
  }

  return lines.join("\n");
}

/**
 * Get severity level based on conflict distribution.
 *
 * @param meta - Conflict-status metadata to assess
 * @returns Severity level: "none", "low", "medium", "high"
 */
export function getConflictSeverity(meta: ConflictStatusMetadata): "none" | "low" | "medium" | "high" {
  if (meta.openCount === 0) {
    return "none";
  }

  // High severity: many open conflicts
  if (meta.openCount > 20) {
    return "high";
  }

  // Medium severity: moderate open conflicts
  if (meta.openCount > 5) {
    return "medium";
  }

  // Low severity: few open conflicts
  return "low";
}
