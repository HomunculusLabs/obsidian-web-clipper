/**
 * Key Takeaways Inbox Builder
 *
 * This module provides utilities for extracting Key Takeaways from Clip Brief
 * sections across multiple clips and building the inbox. It includes:
 *
 * - Parsing Clip Brief sections from markdown notes
 * - Extracting Key Takeaways with source metadata
 * - Normalizing insight text for deduplication
 * - Building the inbox using the contract utilities
 *
 * Core Goals:
 * - Extract insights deterministically from markdown
 * - Preserve source clip metadata for linkbacks
 * - Handle malformed sections gracefully
 * - Support bounded scanning (time window, file limits)
 */

import { promises as fs } from "fs";
import * as path from "path";

import type {
  KeyTakeawayInput,
  InsightStatus,
  KeyTakeawaysInbox
} from "./keyTakeawaysInboxContract";
import {
  buildKeyTakeawaysInbox,
  InsightStatus as ContractInsightStatus
} from "./keyTakeawaysInboxContract";

/**
 * Options for scanning vault notes for Key Takeaways
 */
export interface ScanVaultOptions {
  /** Vault root directory path */
  vaultPath: string;

  /** Maximum depth to recurse when indexing (0 = unlimited) */
  maxDepth?: number;

  /** Include hidden files/folders (starting with .) */
  includeHidden?: boolean;

  /** Only process files modified after this ISO date (time window filter) */
  minDate?: string;

  /** Maximum files to process (for debugging/testing) */
  maxFiles?: number;

  /** Only process files with these tags */
  requiredTags?: string[];

  /** File extensions to process (default: .md) */
  extensions?: string[];
}

/**
 * Result of scanning vault for Key Takeaways
 */
export interface ScanVaultResult {
  /** Extracted key takeaways from all clips */
  insights: KeyTakeawayInput[];

  /** Total markdown files scanned */
  filesScanned: number;

  /** Files with Clip Brief sections */
  filesWithClipBrief: number;

  /** Files with Key Takeaways */
  filesWithKeyTakeaways: number;

  /** Files skipped (no frontmatter, parse errors, or out of scope) */
  filesSkipped: number;

  /** Errors encountered during scanning */
  errors: ScanError[];

  /** Scan options used */
  options: ScanVaultOptions;
}

/**
 * Error encountered during vault scanning
 */
export interface ScanError {
  /** File path where error occurred */
  filePath: string;

  /** Error message */
  error: string;

  /** Error type */
  errorType: "read_error" | "parse_error" | "frontmatter_error" | "clip_brief_error";
}

/**
 * Parsed Clip Brief section from a note
 */
export interface ParsedClipBrief {
  /** Title of the note (from frontmatter or filename) */
  noteTitle: string;

  /** Source URL of the clip (from frontmatter) */
  sourceUrl: string;

  /** Clip timestamp (from frontmatter) */
  timestamp: string;

  /** Key takeaways extracted from the section */
  keyTakeaways: ExtractedInsight[];
}

/**
 * Single insight extracted from a Clip Brief section
 */
export interface ExtractedInsight {
  /** The insight/takeaway text */
  insight: string;

  /** Status of the insight (inferred from formatting) */
  status: InsightStatus;

  /** Line number where the insight appears */
  lineNumber: number;
}

/**
 * Parse frontmatter from markdown content
 *
 * Extracts the YAML frontmatter block between the first two --- delimiters.
 *
 * @param content - Markdown content
 * @returns Parsed frontmatter object, or null if no frontmatter found
 */
export function parseFrontmatter(content: string): Record<string, unknown> | null {
  // Check for frontmatter delimiters
  const firstDelimiter = content.indexOf("---");
  if (firstDelimiter !== 0) {
    return null; // No frontmatter at start
  }

  const secondDelimiter = content.indexOf("\n---\n", firstDelimiter + 3);
  if (secondDelimiter === -1) {
    return null; // No closing delimiter
  }

  // Extract frontmatter YAML
  const yamlText = content.slice(4, secondDelimiter + 1).trim();

  // Parse simple YAML (same approach as vaultIndex.ts)
  return parseSimpleYaml(yamlText);
}

/**
 * Simple YAML parser for frontmatter
 *
 * Handles:
 * - key: value (strings, numbers, booleans)
 * - key: [item1, item2] (arrays)
 * - key:\n  - item1\n  - item2 (multiline arrays)
 */
function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");

  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimEnd();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Check for array continuation (indented list item)
    if (currentArray !== null && /^\s*-\s+/.test(line)) {
      const match = line.match(/^\s*-\s+(.+)$/);
      if (match) {
        currentArray.push(match[1]!.trim());
      }
      continue;
    }

    // Check for array item at start of line (end of previous array)
    if (currentKey !== null && /^\s*-\s+/.test(line)) {
      if (currentArray === null) {
        currentArray = [];
      }
      const match = line.match(/^\s*-\s+(.+)$/);
      if (match) {
        currentArray.push(match[1]!.trim());
      }
      continue;
    }

    // Flush previous array if exists
    if (currentArray !== null && currentKey !== null) {
      result[currentKey] = currentArray;
      currentArray = null;
      currentKey = null;
    }

    // Parse key: value line
    const colonMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!colonMatch) {
      continue;
    }

    const key = colonMatch[1]!.trim();
    const value = colonMatch[2]!.trim();

    // Handle empty value (start of array)
    if (!value) {
      currentKey = key;
      currentArray = [];
      continue;
    }

    // Handle quoted strings
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      result[key] = value.slice(1, -1);
      continue;
    }

    // Handle boolean
    if (value === "true") {
      result[key] = true;
      continue;
    }
    if (value === "false") {
      result[key] = false;
      continue;
    }

    // Handle null
    if (value === "null" || value === "~") {
      result[key] = null;
      continue;
    }

    // Handle numbers
    const num = Number(value);
    if (!isNaN(num) && value !== "") {
      result[key] = num;
      continue;
    }

    // Handle arrays in [item1, item2] format
    if (value.startsWith("[") && value.endsWith("]")) {
      const arrayStr = value.slice(1, -1);
      if (!arrayStr.trim()) {
        result[key] = [];
      } else {
        const items = arrayStr.split(",").map(item => item.trim().replace(/^['"]|['"]$/g, ""));
        result[key] = items;
      }
      continue;
    }

    // Default to string value
    result[key] = value;
  }

  // Flush final array if exists
  if (currentArray !== null && currentKey !== null) {
    result[currentKey] = currentArray;
  }

  return result;
}

/**
 * Parse Clip Brief section from markdown content
 *
 * The Clip Brief section is expected to be formatted as:
 *
 * ```markdown
 * ## Clip Brief
 *
 * ### Key Takeaways
 *
 * - React Server Components use RSC payload for hydration
 * - Streaming SSR requires Suspense boundaries
 * - ~~Deprecated approach using getServerSideProps~~
 * ```
 *
 * Insights marked with strikethrough (~~text~~) are considered ARCHIVED.
 * All other insights are ACTIVE.
 *
 * @param content - Full markdown content of the note
 * @param notePath - Path to the note file
 * @returns Parsed Clip Brief, or null if not found
 */
export function parseClipBriefSection(
  content: string,
  notePath: string
): ParsedClipBrief | null {
  const lines = content.split("\n");

  // Find "## Clip Brief" section
  let clipBriefStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Clip\s+Brief$/i.test(lines[i]!.trim())) {
      clipBriefStart = i;
      break;
    }
  }

  if (clipBriefStart === -1) {
    return null; // No Clip Brief section
  }

  // Find the end of the Clip Brief section (next ## heading or EOF)
  let clipBriefEnd = lines.length;
  for (let i = clipBriefStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim()) && !/^##\s+(Clip\s+Brief|Key\s+Takeaways|Open\s+Questions|Action\s+Items|Knowledge\s+Bundle)/i.test(lines[i]!.trim())) {
      clipBriefEnd = i;
      break;
    }
  }

  // Extract Clip Brief content
  const clipBriefLines = lines.slice(clipBriefStart, clipBriefEnd);

  // Find "### Key Takeaways" subsection
  // Also accept "### Takeaways" or "### Insights" as aliases
  let keyTakeawaysStart = -1;
  for (let i = 0; i < clipBriefLines.length; i++) {
    const line = clipBriefLines[i]!.trim();
    if (/^###\s+(Key\s+Takeaways|Takeaways|Insights)$/i.test(line)) {
      keyTakeawaysStart = i;
      break;
    }
  }

  if (keyTakeawaysStart === -1) {
    // No Key Takeaways subsection - return empty ParsedClipBrief
    return extractClipBriefMetadata(content, notePath, []);
  }

  // Extract Key Takeaways content (until next ### or EOF)
  let keyTakeawaysEnd = clipBriefLines.length;
  for (let i = keyTakeawaysStart + 1; i < clipBriefLines.length; i++) {
    if (/^###\s+/.test(clipBriefLines[i]!.trim())) {
      keyTakeawaysEnd = i;
      break;
    }
  }

  // Parse insights from list items
  const insightLines = clipBriefLines.slice(keyTakeawaysStart + 1, keyTakeawaysEnd);
  const insights: ExtractedInsight[] = [];

  for (let i = 0; i < insightLines.length; i++) {
    const line = insightLines[i]!;
    const trimmed = line.trim();

    // Skip empty lines and non-list items
    if (!trimmed || !trimmed.startsWith("-")) {
      continue;
    }

    // Extract insight text (remove bullet point and whitespace)
    let insightText = trimmed.slice(1).trim();

    // Skip empty insights
    if (!insightText) {
      continue;
    }

    // Check if archived (marked with strikethrough)
    const isArchived = /^~~.*~~$/.test(insightText);
    const cleanInsight = isArchived
      ? insightText.slice(2, -2).trim()
      : insightText;

    // Skip empty after stripping
    if (!cleanInsight) {
      continue;
    }

    // Normalize the insight: remove leading bullet markers, checkboxes
    insightText = cleanInsight
      .replace(/^[-*]\s*/, "") // Remove leading bullet markers
      .replace(/^\[[ x]\]\s*/, "") // Remove checkbox markers
      .trim();

    if (!insightText) {
      continue;
    }

    insights.push({
      insight: insightText,
      status: isArchived ? ContractInsightStatus.ARCHIVED : ContractInsightStatus.ACTIVE,
      lineNumber: clipBriefStart + keyTakeawaysStart + 1 + i
    });
  }

  return extractClipBriefMetadata(content, notePath, insights);
}

/**
 * Extract metadata from the note and build ParsedClipBrief
 *
 * @param content - Full markdown content
 * @param notePath - Path to the note file
 * @param keyTakeaways - Extracted Key Takeaways
 * @returns ParsedClipBrief with metadata
 */
function extractClipBriefMetadata(
  content: string,
  notePath: string,
  keyTakeaways: ExtractedInsight[]
): ParsedClipBrief {
  // Parse frontmatter
  const frontmatter = parseFrontmatter(content);

  // Extract title (from frontmatter, or filename)
  const noteTitle = extractNoteTitle(frontmatter, notePath);

  // Extract source URL (from frontmatter "source" field)
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : "";

  // Extract timestamp (from frontmatter "date_clipped" or current time)
  const timestamp = typeof frontmatter?.date_clipped === "string"
    ? frontmatter.date_clipped
    : new Date().toISOString();

  return {
    noteTitle,
    sourceUrl,
    timestamp,
    keyTakeaways
  };
}

/**
 * Extract note title from frontmatter or filename
 *
 * @param frontmatter - Parsed frontmatter object
 * @param notePath - Path to the note file
 * @returns Note title
 */
function extractNoteTitle(
  frontmatter: Record<string, unknown> | null,
  notePath: string
): string {
  // Try frontmatter title first
  if (frontmatter && typeof frontmatter.title === "string") {
    return frontmatter.title.trim();
  }

  // Fall back to filename without extension
  const filename = path.basename(notePath);
  const title = filename.replace(/\.md$/i, "");
  return title;
}

/**
 * Convert ParsedClipBrief to KeyTakeawayInput array
 *
 * @param clipBrief - Parsed Clip Brief
 * @param clipPath - Path to the clip note
 * @returns Array of KeyTakeawayInput
 */
export function clipBriefToInputs(
  clipBrief: ParsedClipBrief,
  clipPath: string
): KeyTakeawayInput[] {
  return clipBrief.keyTakeaways.map((insight) => ({
    insight: insight.insight,
    clipPath,
    clipTitle: clipBrief.noteTitle,
    clipUrl: clipBrief.sourceUrl,
    clipTimestamp: clipBrief.timestamp,
    clipId: clipPath, // Use path as ID for simplicity
    status: insight.status
  }));
}

/**
 * Check if a file should be scanned based on filters
 *
 * @param filePath - Full path to the file
 * @param stat - File stats
 * @param options - Scan options
 * @returns true if file should be scanned
 */
function shouldScanFile(
  filePath: string,
  stat: { mtime: Date },
  options: ScanVaultOptions
): boolean {
  // Check file extension
  const ext = path.extname(filePath).toLowerCase();
  const extensions = options.extensions || [".md"];
  if (!extensions.includes(ext)) {
    return false;
  }

  // Check minDate filter
  if (options.minDate) {
    const minDate = new Date(options.minDate);
    if (stat.mtime < minDate) {
      return false;
    }
  }

  // Check hidden files
  if (!options.includeHidden) {
    const basename = path.basename(filePath);
    if (basename.startsWith(".")) {
      return false;
    }
  }

  return true;
}

/**
 * Recursively scan vault directory for markdown files
 *
 * @param dirPath - Directory to scan
 * @param options - Scan options
 * @param currentDepth - Current recursion depth (0 = vault root)
 * @param results - Accumulated results
 * @returns Promise that resolves when scan is complete
 */
async function scanDirectory(
  dirPath: string,
  options: ScanVaultOptions,
  currentDepth: number,
  results: string[]
): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // Sort deterministically for stable results
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // Skip hidden directories/files if not including hidden
      if (!options.includeHidden && entry.name.startsWith(".")) {
        continue;
      }

      if (entry.isDirectory()) {
        // Check max depth before recursing (maxDepth=1 allows root + 1 level of subdirs)
        if (options.maxDepth && options.maxDepth > 0 && currentDepth + 1 > options.maxDepth) {
          continue;
        }
        // Recurse into subdirectory
        await scanDirectory(fullPath, options, currentDepth + 1, results);
      } else if (entry.isFile()) {
        // Get file stats for date filtering
        try {
          const stat = await fs.stat(fullPath);
          if (shouldScanFile(fullPath, stat, options)) {
            results.push(fullPath);
          }
        } catch {
          // Skip files that can't be stat'd
        }
      }
    }
  } catch (error) {
    // Log error but continue scanning
    console.error(`Error scanning directory ${dirPath}:`, error);
  }
}

/**
 * Scan vault for Key Takeaways across all clips
 *
 * This is the main entry point for extracting insights from vault notes.
 *
 * @param options - Scan options
 * @returns Scan result with extracted insights
 */
export async function scanVaultForKeyTakeaways(
  options: ScanVaultOptions
): Promise<ScanVaultResult> {
  const result: ScanVaultResult = {
    insights: [],
    filesScanned: 0,
    filesWithClipBrief: 0,
    filesWithKeyTakeaways: 0,
    filesSkipped: 0,
    errors: [],
    options
  };

  // Collect all markdown files
  const files: string[] = [];
  await scanDirectory(options.vaultPath, options, 0, files);

  // Apply maxFiles limit
  const filesToScan = options.maxFiles
    ? files.slice(0, options.maxFiles)
    : files;

  result.filesScanned = filesToScan.length;

  // Scan each file
  for (const filePath of filesToScan) {
    try {
      // Read file content
      const content = await fs.readFile(filePath, "utf-8");

      // Parse Clip Brief section
      const clipBrief = parseClipBriefSection(content, filePath);

      if (!clipBrief) {
        result.filesSkipped++;
        continue;
      }

      result.filesWithClipBrief++;

      if (clipBrief.keyTakeaways.length === 0) {
        result.filesSkipped++;
        continue;
      }

      result.filesWithKeyTakeaways++;

      // Convert to KeyTakeawayInput
      const inputs = clipBriefToInputs(clipBrief, filePath);

      // Check required tags filter
      if (options.requiredTags && options.requiredTags.length > 0) {
        const frontmatter = parseFrontmatter(content);
        const tags = Array.isArray(frontmatter?.tags)
          ? frontmatter.tags as string[]
          : [];

        const hasRequiredTag = options.requiredTags.some(reqTag =>
          tags.some(tag => tag.toLowerCase() === reqTag.toLowerCase())
        );

        if (!hasRequiredTag) {
          result.filesSkipped++;
          continue;
        }
      }

      // Add insights to result
      result.insights.push(...inputs);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push({
        filePath,
        error: errorMsg,
        errorType: "read_error"
      });
      result.filesSkipped++;
    }
  }

  // Sort insights deterministically (by path, then by insight text)
  result.insights.sort((a, b) => {
    if (a.clipPath !== b.clipPath) {
      return a.clipPath.localeCompare(b.clipPath);
    }
    return a.insight.localeCompare(b.insight);
  });

  return result;
}

/**
 * Build Key Takeaways Inbox from vault scan
 *
 * This is a convenience function that combines scanning and building.
 *
 * @param options - Scan options
 * @returns Key Takeaways Inbox
 */
export async function buildInboxFromVault(
  options: ScanVaultOptions
): Promise<KeyTakeawaysInbox> {
  // Scan vault for insights
  const scanResult = await scanVaultForKeyTakeaways(options);

  // Build inbox using contract utility
  const inbox = buildKeyTakeawaysInbox(scanResult.insights);

  return inbox;
}

/**
 * Extract Key Takeaways from a single note
 *
 * Convenience function for processing individual notes.
 *
 * @param content - Markdown content
 * @param notePath - Path to the note
 * @returns Array of KeyTakeawayInput
 */
export function extractKeyTakeawaysFromNote(
  content: string,
  notePath: string
): KeyTakeawayInput[] {
  const clipBrief = parseClipBriefSection(content, notePath);
  if (!clipBrief) {
    return [];
  }

  return clipBriefToInputs(clipBrief, notePath);
}

/**
 * Normalize an insight assertion for comparison.
 *
 * This is a convenience wrapper around computeInsightFingerprint
 * for cases where you only need the normalized text.
 *
 * @param insight - The insight text to normalize
 * @returns Normalized insight text
 */
export function normalizeInsight(insight: string): string {
  return insight
    .toLowerCase()
    .trim()
    .replace(/^[-*]\s*/, "") // Remove leading bullet markers
    .replace(/^\[[ x]\]\s*/, "") // Remove checkbox markers
    .replace(/\s+/g, " ") // Collapse multiple whitespace
    .replace(/[.,!?;:]+$/, ""); // Remove trailing punctuation
}

/**
 * Merge duplicate insights from multiple sources.
 *
 * Takes an array of KeyTakeawayInput and merges duplicates based on
 * normalized insight text, preserving all source clip references.
 *
 * @param inputs - Array of insights from various clips
 * @returns Merged insights with combined source references
 */
export function mergeDuplicateInsights(
  inputs: KeyTakeawayInput[]
): Map<string, KeyTakeawayInput[]> {
  const merged = new Map<string, KeyTakeawayInput[]>();

  for (const input of inputs) {
    // Compute fingerprint for deduplication
    const normalizedInsight = normalizeInsight(input.insight);
    const key = normalizedInsight;

    if (!merged.has(key)) {
      merged.set(key, []);
    }

    merged.get(key)!.push(input);
  }

  return merged;
}
