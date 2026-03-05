/**
 * Knowledge Trust Kickoff Brief Exporter
 *
 * This module provides the deterministic export path for the Knowledge Trust Kickoff Brief.
 * It handles:
 * - Resolving the brief file path within the vault
 * - Writing the brief markdown to a file
 * - Explicit empty-state behavior (always creates file with explicit metadata)
 * - Bounded metadata behavior (truncation tracking, risk band counts)
 * - Error handling and fallback behavior
 *
 * Core Goals:
 * - Deterministic file path resolution
 * - Atomic file writes (write to temp, then rename)
 * - Explicit empty-state handling (always create file with metadata)
 * - Bounded metadata (truncation, counts, version fields always present)
 * - Graceful error handling without corrupting existing brief
 */

import { promises as fs } from "fs";
import * as path from "path";

import type { KnowledgeTrustKickoffBrief, BriefMetadata } from "./knowledgeTrustKickoffBriefContract";
import {
  renderKnowledgeTrustKickoffBrief,
  extractBriefMetadata,
  DEFAULT_EMPTY_BRIEF_METADATA,
  KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
  MAX_BRIEF_ITEMS,
  MAX_SOURCE_REFS,
  MAX_DESCRIPTION_LENGTH,
  RiskBand,
  BriefItemStatus,
} from "./knowledgeTrustKickoffBriefContract";

/**
 * Default filename for the Knowledge Trust Kickoff Brief note.
 */
export const DEFAULT_BRIEF_FILENAME = "knowledge-trust-kickoff-brief.md" as const;

/**
 * Options for exporting the Knowledge Trust Kickoff Brief.
 */
export interface ExportBriefOptions {
  /** Vault root directory path */
  vaultPath: string;

  /** Folder within vault to save the brief (default: vault root) */
  briefFolder?: string;

  /** Custom filename for the brief (default: knowledge-trust-kickoff-brief.md) */
  briefFilename?: string;

  /** Whether to create the folder if it doesn't exist (default: true) */
  createFolder?: boolean;
}

/**
 * Result of exporting the Knowledge Trust Kickoff Brief.
 */
export interface ExportBriefResult {
  /** Full path to the exported brief file */
  filePath: string;

  /** Whether the file was created (false if only updated) */
  created: boolean;

  /** Metadata extracted from the brief */
  metadata: BriefMetadata;

  /** Whether the brief was empty (no active/in-progress items) */
  isEmpty: boolean;

  /** Export options used */
  options: ExportBriefOptions;

  /** Bounded metadata diagnostics */
  boundedMetadata: BoundedMetadataDiagnostics;

  /** Any warnings encountered during export */
  warnings: string[];
}

/**
 * Bounded metadata diagnostics for the brief.
 *
 * Tracks truncation and boundary conditions to ensure
 * the brief remains within defined limits.
 */
export interface BoundedMetadataDiagnostics {
  /** Whether the brief entries were truncated to MAX_BRIEF_ITEMS */
  entriesTruncated: boolean;

  /** Number of entries included (after truncation) */
  entriesIncluded: number;

  /** Number of entries excluded (due to truncation) */
  entriesExcluded: number;

  /** Number of resolved items (filtered out) */
  resolvedItems: number;

  /** Number of dismissed items (filtered out) */
  dismissedItems: number;

  /** Items with description truncation */
  itemsWithTruncatedDescriptions: number;

  /** Items with source ref truncation */
  itemsWithTruncatedSourceRefs: number;

  /** Maximum entries allowed */
  maxEntries: number;

  /** Maximum source refs per item */
  maxSourceRefs: number;

  /** Maximum description length */
  maxDescriptionLength: number;
}

/**
 * Error during brief export.
 */
export interface ExportBriefError {
  /** Error message */
  message: string;

  /** Error type */
  errorType: "write_error" | "folder_error" | "path_error" | "render_error";

  /** Original error (if any) */
  cause?: Error;
}

/**
 * Resolve the file path for the Knowledge Trust Kickoff Brief.
 *
 * The path is resolved deterministically as:
 * `{vaultPath}/{briefFolder}/{briefFilename}`
 *
 * Default: `{vaultPath}/knowledge-trust-kickoff-brief.md`
 *
 * @param options - Export options
 * @returns Resolved file path
 */
export function resolveBriefPath(options: ExportBriefOptions): string {
  const { vaultPath, briefFolder, briefFilename } = options;

  // Normalize vault path
  const normalizedVaultPath = path.resolve(vaultPath);

  // Use default filename if not specified
  const filename = briefFilename || DEFAULT_BRIEF_FILENAME;

  // If no folder specified, save to vault root
  if (!briefFolder) {
    return path.join(normalizedVaultPath, filename);
  }

  // Normalize folder path (remove leading/trailing slashes)
  const normalizedFolder = briefFolder
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");

  return path.join(normalizedVaultPath, normalizedFolder, filename);
}

/**
 * Check if the brief is empty (no active/in-progress items).
 *
 * @param brief - The brief to check
 * @returns true if the brief has no entries
 */
export function isBriefEmpty(brief: KnowledgeTrustKickoffBrief): boolean {
  return brief.entries.length === 0;
}

/**
 * Compute bounded metadata diagnostics for a brief.
 *
 * Analyzes the brief for truncation and boundary conditions.
 *
 * @param brief - The brief to analyze
 * @returns Bounded metadata diagnostics
 */
export function computeBoundedMetadataDiagnostics(
  brief: KnowledgeTrustKickoffBrief
): BoundedMetadataDiagnostics {
  let itemsWithTruncatedDescriptions = 0;
  let itemsWithTruncatedSourceRefs = 0;

  for (const entry of brief.entries) {
    if (entry.description_truncated) {
      itemsWithTruncatedDescriptions++;
    }
    if (entry.source_refs_truncated) {
      itemsWithTruncatedSourceRefs++;
    }
  }

  const totalActiveItems = brief.active_items + brief.in_progress_items;
  const entriesExcluded = totalActiveItems - brief.entries.length;

  return {
    entriesTruncated: brief.truncated,
    entriesIncluded: brief.entries.length,
    entriesExcluded: Math.max(0, entriesExcluded),
    resolvedItems: brief.resolved_items,
    dismissedItems: brief.dismissed_items,
    itemsWithTruncatedDescriptions,
    itemsWithTruncatedSourceRefs,
    maxEntries: MAX_BRIEF_ITEMS,
    maxSourceRefs: MAX_SOURCE_REFS,
    maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
  };
}

/**
 * Render the empty-state brief.
 *
 * This produces a valid brief note even when there are no active/in-progress items.
 * The frontmatter is always populated with explicit zero/empty values.
 *
 * Bounded metadata behavior:
 * - All metadata fields are present with explicit values
 * - Zero counts for all risk bands
 * - brief_truncated: false (nothing to truncate)
 * - brief_version: current version
 *
 * @param generatedAt - Timestamp for the brief (optional, defaults to now)
 * @returns Rendered markdown for empty brief
 */
export function renderEmptyBrief(generatedAt?: string): string {
  const timestamp = generatedAt || new Date().toISOString();

  // Create an empty brief with explicit bounded metadata
  const emptyBrief: KnowledgeTrustKickoffBrief = {
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
    generated_at: timestamp,
  };

  return renderKnowledgeTrustKickoffBrief(emptyBrief);
}

/**
 * Ensure the parent directory exists for the brief file.
 *
 * @param filePath - Full path to the brief file
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
 * Export the Knowledge Trust Kickoff Brief to a file.
 *
 * This is the main entry point for the export path.
 *
 * Behavior:
 * - Resolves the file path deterministically
 * - Creates the parent folder if needed
 * - Renders the brief to markdown with bounded metadata
 * - Computes bounded metadata diagnostics for observability
 * - Writes atomically to prevent corruption
 * - Always creates a file, even when empty
 * - Returns metadata and diagnostics for observability
 *
 * Bounded empty-state behavior:
 * - Empty briefs always create a file with explicit zero metadata
 * - No "file not found" states after first export
 * - Frontmatter always contains all required fields
 * - Risk band counts are always present (all zeros when empty)
 *
 * Bounded metadata behavior:
 * - All metadata fields are always present
 * - Truncation flags are explicit (true/false)
 * - Version is always included
 * - Generated timestamp is always present
 *
 * @param brief - The brief to export
 * @param options - Export options
 * @returns Export result with metadata and diagnostics
 * @throws ExportBriefError on failure
 */
export async function exportKnowledgeTrustKickoffBrief(
  brief: KnowledgeTrustKickoffBrief,
  options: ExportBriefOptions
): Promise<ExportBriefResult> {
  const warnings: string[] = [];
  const createFolder = options.createFolder !== false;

  // Resolve file path
  const filePath = resolveBriefPath(options);

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
    } satisfies ExportBriefError;
  }

  // Render brief to markdown
  let markdown: string;
  try {
    markdown = renderKnowledgeTrustKickoffBrief(brief);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw {
      message: `Failed to render brief: ${err.message}`,
      errorType: "render_error" as const,
      cause: err,
    } satisfies ExportBriefError;
  }

  // Write atomically
  try {
    await writeFileAtomic(filePath, markdown);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw {
      message: `Failed to write brief file: ${err.message}`,
      errorType: "write_error" as const,
      cause: err,
    } satisfies ExportBriefError;
  }

  // Extract metadata
  const metadata = extractBriefMetadata(brief);

  // Compute bounded metadata diagnostics
  const boundedMetadata = computeBoundedMetadataDiagnostics(brief);

  // Check if empty
  const isEmpty = isBriefEmpty(brief);
  if (isEmpty) {
    warnings.push("Brief is empty (no active or in-progress trust items)");
  }

  // Add truncation warnings
  if (boundedMetadata.entriesTruncated) {
    warnings.push(
      `Brief was truncated to ${MAX_BRIEF_ITEMS} items (${boundedMetadata.entriesExcluded} items excluded)`
    );
  }

  if (boundedMetadata.itemsWithTruncatedDescriptions > 0) {
    warnings.push(
      `${boundedMetadata.itemsWithTruncatedDescriptions} items have truncated descriptions (max: ${MAX_DESCRIPTION_LENGTH} chars)`
    );
  }

  if (boundedMetadata.itemsWithTruncatedSourceRefs > 0) {
    warnings.push(
      `${boundedMetadata.itemsWithTruncatedSourceRefs} items have truncated source refs (max: ${MAX_SOURCE_REFS})`
    );
  }

  // Add resolved/dismissed count info
  if (boundedMetadata.resolvedItems > 0) {
    warnings.push(`${boundedMetadata.resolvedItems} resolved items filtered out`);
  }

  if (boundedMetadata.dismissedItems > 0) {
    warnings.push(`${boundedMetadata.dismissedItems} dismissed items filtered out`);
  }

  return {
    filePath,
    created,
    metadata,
    isEmpty,
    options,
    boundedMetadata,
    warnings,
  };
}

/**
 * Export an empty brief to a file.
 *
 * This is a convenience function for creating an empty placeholder brief.
 * All bounded metadata diagnostics will reflect empty state.
 *
 * @param options - Export options
 * @param generatedAt - Timestamp for the brief (optional)
 * @returns Export result with metadata and diagnostics
 * @throws ExportBriefError on failure
 */
export async function exportEmptyBrief(
  options: ExportBriefOptions,
  generatedAt?: string
): Promise<ExportBriefResult> {
  const timestamp = generatedAt || new Date().toISOString();

  // Create empty brief with explicit bounded metadata
  const emptyBrief: KnowledgeTrustKickoffBrief = {
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
    generated_at: timestamp,
  };

  return exportKnowledgeTrustKickoffBrief(emptyBrief, options);
}

/**
 * Check if a brief file exists at the expected path.
 *
 * @param options - Export options
 * @returns Promise resolving to true if file exists
 */
export async function briefFileExists(options: ExportBriefOptions): Promise<boolean> {
  const filePath = resolveBriefPath(options);

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read an existing brief file.
 *
 * @param options - Export options
 * @returns File content, or null if file doesn't exist
 */
export async function readBriefFile(options: ExportBriefOptions): Promise<string | null> {
  const filePath = resolveBriefPath(options);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content;
  } catch {
    return null;
  }
}

/**
 * Delete an existing brief file.
 *
 * @param options - Export options
 * @returns true if file was deleted, false if it didn't exist
 */
export async function deleteBriefFile(options: ExportBriefOptions): Promise<boolean> {
  const filePath = resolveBriefPath(options);

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
export function getDefaultExportOptions(vaultPath: string): ExportBriefOptions {
  return {
    vaultPath,
    briefFolder: undefined,
    briefFilename: DEFAULT_BRIEF_FILENAME,
    createFolder: true,
  };
}

/**
 * Format bounded metadata diagnostics as a human-readable summary.
 *
 * @param diagnostics - Bounded metadata diagnostics to format
 * @returns Formatted summary string
 */
export function formatBoundedMetadataDiagnostics(
  diagnostics: BoundedMetadataDiagnostics
): string {
  const lines: string[] = [];

  lines.push("Brief Bounded Metadata Diagnostics:");
  lines.push("");

  // Entry counts
  lines.push(`Entries: ${diagnostics.entriesIncluded} included`);
  if (diagnostics.entriesExcluded > 0) {
    lines.push(`         ${diagnostics.entriesExcluded} excluded (truncated to ${diagnostics.maxEntries})`);
  }
  lines.push("");

  // Filtered items
  if (diagnostics.resolvedItems > 0 || diagnostics.dismissedItems > 0) {
    lines.push("Filtered items:");
    if (diagnostics.resolvedItems > 0) {
      lines.push(`  - ${diagnostics.resolvedItems} resolved`);
    }
    if (diagnostics.dismissedItems > 0) {
      lines.push(`  - ${diagnostics.dismissedItems} dismissed`);
    }
    lines.push("");
  }

  // Truncation markers
  const hasTruncation =
    diagnostics.itemsWithTruncatedDescriptions > 0 ||
    diagnostics.itemsWithTruncatedSourceRefs > 0;

  if (hasTruncation) {
    lines.push("Truncation markers:");
    if (diagnostics.itemsWithTruncatedDescriptions > 0) {
      lines.push(
        `  - ${diagnostics.itemsWithTruncatedDescriptions} items with truncated descriptions (max: ${diagnostics.maxDescriptionLength})`
      );
    }
    if (diagnostics.itemsWithTruncatedSourceRefs > 0) {
      lines.push(
        `  - ${diagnostics.itemsWithTruncatedSourceRefs} items with truncated source refs (max: ${diagnostics.maxSourceRefs})`
      );
    }
    lines.push("");
  }

  // Limits
  lines.push("Configured limits:");
  lines.push(`  - Max entries: ${diagnostics.maxEntries}`);
  lines.push(`  - Max source refs per item: ${diagnostics.maxSourceRefs}`);
  lines.push(`  - Max description length: ${diagnostics.maxDescriptionLength}`);

  return lines.join("\n");
}

/**
 * Get severity level for bounded metadata diagnostics.
 *
 * @param diagnostics - Bounded metadata diagnostics to assess
 * @returns Severity level: "none", "low", "medium", "high"
 */
export function getBoundedMetadataSeverity(
  diagnostics: BoundedMetadataDiagnostics
): "none" | "low" | "medium" | "high" {
  // No issues
  if (
    !diagnostics.entriesTruncated &&
    diagnostics.itemsWithTruncatedDescriptions === 0 &&
    diagnostics.itemsWithTruncatedSourceRefs === 0
  ) {
    return "none";
  }

  // High severity: significant truncation
  if (
    diagnostics.entriesExcluded > 10 ||
    diagnostics.itemsWithTruncatedDescriptions > 10 ||
    diagnostics.itemsWithTruncatedSourceRefs > 10
  ) {
    return "high";
  }

  // Medium severity: moderate truncation
  if (
    diagnostics.entriesExcluded > 5 ||
    diagnostics.itemsWithTruncatedDescriptions > 5 ||
    diagnostics.itemsWithTruncatedSourceRefs > 5
  ) {
    return "medium";
  }

  // Low severity: minor truncation
  return "low";
}

/**
 * Validate that a brief has complete bounded metadata.
 *
 * Checks that all required metadata fields are present and valid.
 *
 * @param brief - The brief to validate
 * @returns Validation result with any issues found
 */
export function validateBoundedMetadata(
  brief: KnowledgeTrustKickoffBrief
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check version
  if (!brief.brief_version) {
    issues.push("Missing brief_version");
  }

  // Check generated_at
  if (!brief.generated_at) {
    issues.push("Missing generated_at");
  }

  // Check risk_band_counts
  if (!brief.risk_band_counts) {
    issues.push("Missing risk_band_counts");
  } else {
    const requiredBands = [RiskBand.CRITICAL, RiskBand.HIGH, RiskBand.MEDIUM, RiskBand.LOW];
    for (const band of requiredBands) {
      if (typeof brief.risk_band_counts[band] !== "number") {
        issues.push(`Missing or invalid count for risk band: ${band}`);
      }
    }
  }

  // Check counts match
  const totalFromBands =
    brief.risk_band_counts[RiskBand.CRITICAL] +
    brief.risk_band_counts[RiskBand.HIGH] +
    brief.risk_band_counts[RiskBand.MEDIUM] +
    brief.risk_band_counts[RiskBand.LOW];

  if (totalFromBands !== brief.total_items) {
    issues.push(
      `Risk band counts sum (${totalFromBands}) does not match total_items (${brief.total_items})`
    );
  }

  // Check truncated flag
  if (typeof brief.truncated !== "boolean") {
    issues.push("Missing or invalid truncated flag");
  }

  // Check entries array
  if (!Array.isArray(brief.entries)) {
    issues.push("Missing or invalid entries array");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
