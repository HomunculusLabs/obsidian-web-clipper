/**
 * Open Questions Inbox Exporter
 *
 * This module provides the deterministic export path for the Open Questions Inbox.
 * It handles:
 * - Resolving the inbox file path within the vault
 * - Writing the inbox markdown to a file
 * - Explicit empty-state behavior
 * - Error handling and fallback behavior
 *
 * Core Goals:
 * - Deterministic file path resolution
 * - Atomic file writes (write to temp, then rename)
 * - Explicit empty-state handling (always create the file, even when empty)
 * - Graceful error handling without corrupting existing inbox
 */

import { promises as fs } from "fs";
import * as path from "path";

import type { OpenQuestionsInbox, InboxMetadata } from "./openQuestionsInboxContract";
import {
  renderOpenQuestionsInbox,
  extractInboxMetadata,
  DEFAULT_EMPTY_INBOX_METADATA,
  OPEN_QUESTIONS_INBOX_VERSION,
} from "./openQuestionsInboxContract";

/**
 * Default filename for the Open Questions Inbox note.
 */
export const DEFAULT_INBOX_FILENAME = "open-questions-inbox.md" as const;

/**
 * Options for exporting the Open Questions Inbox.
 */
export interface ExportInboxOptions {
  /** Vault root directory path */
  vaultPath: string;

  /** Folder within vault to save the inbox (default: vault root) */
  inboxFolder?: string;

  /** Custom filename for the inbox (default: open-questions-inbox.md) */
  inboxFilename?: string;

  /** Whether to create the folder if it doesn't exist (default: true) */
  createFolder?: boolean;
}

/**
 * Result of exporting the Open Questions Inbox.
 */
export interface ExportInboxResult {
  /** Full path to the exported inbox file */
  filePath: string;

  /** Whether the file was created (false if only updated) */
  created: boolean;

  /** Metadata extracted from the inbox */
  metadata: InboxMetadata;

  /** Whether the inbox was empty (no unresolved questions) */
  isEmpty: boolean;

  /** Export options used */
  options: ExportInboxOptions;

  /** Any warnings encountered during export */
  warnings: string[];
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
 * Resolve the file path for the Open Questions Inbox.
 *
 * The path is resolved deterministically as:
 * `{vaultPath}/{inboxFolder}/{inboxFilename}`
 *
 * Default: `{vaultPath}/open-questions-inbox.md`
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
 * Check if the inbox is empty (no unresolved questions).
 *
 * @param inbox - The inbox to check
 * @returns true if the inbox has no unresolved questions
 */
export function isInboxEmpty(inbox: OpenQuestionsInbox): boolean {
  return inbox.entries.length === 0 && inbox.unresolvedQuestions === 0;
}

/**
 * Render the empty-state inbox.
 *
 * This produces a valid inbox note even when there are no questions.
 * The frontmatter is always populated with explicit zero/empty values.
 *
 * @param generatedAt - Timestamp for the inbox (optional, defaults to now)
 * @returns Rendered markdown for empty inbox
 */
export function renderEmptyInbox(generatedAt?: string): string {
  const timestamp = generatedAt || new Date().toISOString();

  // Create an empty inbox with explicit metadata
  const emptyInbox: OpenQuestionsInbox = {
    entries: [],
    totalQuestions: 0,
    unresolvedQuestions: 0,
    resolvedQuestions: 0,
    totalClips: 0,
    totalQuestionInstances: 0,
    truncated: false,
    inbox_version: OPEN_QUESTIONS_INBOX_VERSION,
    generated_at: timestamp,
  };

  return renderOpenQuestionsInbox(emptyInbox);
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
 * Export the Open Questions Inbox to a file.
 *
 * This is the main entry point for the export path.
 *
 * Behavior:
 * - Resolves the file path deterministically
 * - Creates the parent folder if needed
 * - Renders the inbox to markdown
 * - Writes atomically to prevent corruption
 * - Always creates a file, even when empty
 * - Returns metadata for observability
 *
 * @param inbox - The inbox to export
 * @param options - Export options
 * @returns Export result with metadata
 * @throws ExportInboxError on failure
 */
export async function exportOpenQuestionsInbox(
  inbox: OpenQuestionsInbox,
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
    markdown = renderOpenQuestionsInbox(inbox);
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

  // Check if empty
  const isEmpty = isInboxEmpty(inbox);
  if (isEmpty) {
    warnings.push("Inbox is empty (no unresolved questions)");
  }

  // Add truncation warning if applicable
  if (metadata.inbox_truncated) {
    warnings.push(`Inbox was truncated to ${inbox.entries.length} questions`);
  }

  return {
    filePath,
    created,
    metadata,
    isEmpty,
    options,
    warnings,
  };
}

/**
 * Export an empty inbox to a file.
 *
 * This is a convenience function for creating an empty placeholder inbox.
 *
 * @param options - Export options
 * @param generatedAt - Timestamp for the inbox (optional)
 * @returns Export result with metadata
 * @throws ExportInboxError on failure
 */
export async function exportEmptyInbox(
  options: ExportInboxOptions,
  generatedAt?: string
): Promise<ExportInboxResult> {
  const timestamp = generatedAt || new Date().toISOString();

  // Create empty inbox
  const emptyInbox: OpenQuestionsInbox = {
    entries: [],
    totalQuestions: 0,
    unresolvedQuestions: 0,
    resolvedQuestions: 0,
    totalClips: 0,
    totalQuestionInstances: 0,
    truncated: false,
    inbox_version: OPEN_QUESTIONS_INBOX_VERSION,
    generated_at: timestamp,
  };

  return exportOpenQuestionsInbox(emptyInbox, options);
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
