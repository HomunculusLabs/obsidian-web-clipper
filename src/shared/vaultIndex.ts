/**
 * Vault Index Utilities for Related Clips Matching
 *
 * This module provides utilities for indexing vault notes and extracting
 * metadata needed for related clips matching. It scans markdown files,
 * parses frontmatter, and builds CandidateNote objects for use with
 * the related clips matching algorithm.
 */

import { promises as fs } from "fs";
import * as path from "path";

import type { CandidateNote } from "./relatedClipsContract";

/**
 * Simple YAML parser for frontmatter
 *
 * Parses a subset of YAML syntax needed for Obsidian frontmatter:
 * - key: value (strings, numbers, booleans)
 * - key: [item1, item2, item3] (arrays)
 * - key:
 *   - item1
 *   - item2 (multiline arrays)
 *
 * This is intentionally limited to the simple formats used in frontmatter.
 * Complex YAML features (anchors, aliases, custom types) are not supported.
 */
function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");

  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Check for array continuation (indented list item)
    if (currentArray !== null && /^\s*-\s+/.test(line)) {
      const match = line.match(/^\s*-\s+(.+)$/);
      if (match) {
        currentArray.push(match[1].trim());
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
        currentArray.push(match[1].trim());
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

    const key = colonMatch[1].trim();
    const value = colonMatch[2].trim();

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
 * Result of indexing vault notes
 */
export interface VaultIndexResult {
  /** Candidate notes extracted from the vault */
  candidates: CandidateNote[];
  /** Total markdown files scanned */
  filesScanned: number;
  /** Files with valid frontmatter */
  filesWithFrontmatter: number;
  /** Files skipped (no frontmatter or parse errors) */
  filesSkipped: number;
  /** Errors encountered during indexing */
  errors: IndexError[];
}

/**
 * Error encountered during vault indexing
 */
export interface IndexError {
  /** File path where error occurred */
  filePath: string;
  /** Error message */
  error: string;
  /** Error type */
  errorType: "read_error" | "parse_error" | "frontmatter_error" | "invalid_metadata";
}

/**
 * Options for vault indexing
 */
export interface VaultIndexOptions {
  /** Vault root directory path */
  vaultPath: string;
  /** Maximum depth to recurse (0 = unlimited) */
  maxDepth?: number;
  /** Include hidden files/folders (starting with .) */
  includeHidden?: boolean;
  /** Only process files with these tags (if specified, files without these tags are skipped) */
  requiredTags?: string[];
  /** Minimum age filter (only index files modified after this ISO date) */
  minDate?: string;
  /** Maximum files to process (for debugging/testing) */
  maxFiles?: number;
}

/**
 * Parsed frontmatter from a markdown note
 */
export interface ParsedFrontmatter {
  /** Source URL */
  source?: string;
  /** Note title */
  title?: string;
  /** Content type (article, video, etc.) */
  type?: string;
  /** Tags array */
  tags?: string[];
  /** Keywords/entities */
  keywords?: string[];
  /** Date clipped (ISO 8601) */
  date_clipped?: string;
  /** Published date (ISO 8601) */
  published_date?: string;
  /** Author */
  author?: string;
  /** Channel */
  channel?: string;
  /** Original capture URL (legacy field) */
  url?: string;
  /** Page type */
  page_type?: string;
}

/**
 * Recursively find all markdown files in a directory
 */
async function findMarkdownFiles(
  dir: string,
  options: Pick<VaultIndexOptions, "includeHidden" | "maxDepth"> & { currentDepth?: number }
): Promise<string[]> {
  const { includeHidden = false, maxDepth = 0, currentDepth = 0 } = options;

  // Check depth limit (stop before recursing beyond maxDepth)
  if (maxDepth > 0 && currentDepth > maxDepth) {
    return [];
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      // Skip hidden files/folders unless included
      if (!includeHidden && entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively search subdirectories
        const subFiles = await findMarkdownFiles(fullPath, {
          includeHidden,
          maxDepth,
          currentDepth: currentDepth + 1
        });
        files.push(...subFiles);
      } else if (entry.isFile()) {
        // Include markdown files (.md, .markdown)
        if (
          entry.name.endsWith(".md") ||
          entry.name.endsWith(".markdown")
        ) {
          files.push(fullPath);
        }
      }
    }

    return files;
  } catch (error) {
    console.warn(`[VaultIndex] Failed to read directory ${dir}:`, error);
    return [];
  }
}

/**
 * Extract frontmatter from markdown content
 *
 * Supports:
 * - YAML frontmatter delimited by --- (standard)
 * - YAML frontmatter delimited by +++ (alternative)
 *
 * @param content - Markdown file content
 * @returns Parsed frontmatter object, or null if no frontmatter found or malformed
 */
export function extractFrontmatter(content: string): ParsedFrontmatter | null {
  const lines = content.split("\n");

  // Try standard YAML delimiter (---)
  let startIdx = -1;
  let endIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Look for opening delimiter (must be at start of file)
    if (startIdx === -1 && i === 0 && (line === "---" || line === "+++")) {
      startIdx = i;
      continue;
    }

    // Look for closing delimiter
    if (startIdx !== -1 && (line === "---" || line === "+++")) {
      endIdx = i;
      break;
    }
  }

  // No valid frontmatter found
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx + 1) {
    return null;
  }

  // Extract frontmatter content
  const frontmatterLines = lines.slice(startIdx + 1, endIdx);
  const frontmatterText = frontmatterLines.join("\n");

  // Check for obviously malformed YAML (unbalanced brackets, etc.)
  const bracketCount = (frontmatterText.match(/\[/g) || []).length -
                       (frontmatterText.match(/\]/g) || []).length;
  if (bracketCount !== 0) {
    console.warn("[VaultIndex] Unbalanced brackets in frontmatter");
    return null;
  }

  try {
    const parsed = parseSimpleYaml(frontmatterText);
    return parsed as ParsedFrontmatter;
  } catch (error) {
    console.warn("[VaultIndex] Failed to parse YAML frontmatter:", error);
    return null;
  }
}

/**
 * Extract title from markdown content
 *
 * Falls back to:
 * 1. First H1 heading (# Title)
 * 2. Filename if no heading found
 *
 * @param content - Markdown file content
 * @param filename - Filename (without extension) as fallback
 * @returns Extracted title
 */
export function extractTitle(content: string, filename: string): string {
  // Look for first H1 heading
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.slice(2).trim();
    }
  }

  // Use filename as fallback
  return filename;
}

/**
 * Extract timestamp from frontmatter
 *
 * Priority:
 * 1. date_clipped (when the note was clipped)
 * 2. published_date (when the source was published)
 * 3. Current time (fallback)
 *
 * @param frontmatter - Parsed frontmatter
 * @returns ISO 8601 timestamp string
 */
export function extractTimestamp(frontmatter: ParsedFrontmatter): string {
  return (
    frontmatter.date_clipped ||
    frontmatter.published_date ||
    new Date().toISOString()
  );
}

/**
 * Extract domain from URL
 *
 * @param url - URL to parse
 * @returns Domain, or empty string if parsing fails
 */
export function extractDomain(url: string | undefined): string {
  if (!url) return "";

  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return "";
  }
}

/**
 * Extract entities/keywords from frontmatter
 *
 * Maps to the `keywords` field in ClipMetadata.
 *
 * @param frontmatter - Parsed frontmatter
 * @returns Array of entities/keywords
 */
export function extractEntities(frontmatter: ParsedFrontmatter): string[] {
  const keywords = frontmatter.keywords || [];

  // Ensure array format
  if (Array.isArray(keywords)) {
    const result: string[] = [];
    for (const k of keywords) {
      // Skip null and undefined values
      if (k === null || k === undefined) {
        continue;
      }
      const trimmed = String(k).trim();
      if (trimmed.length > 0) {
        result.push(trimmed);
      }
    }
    return result;
  }

  // Handle comma-separated string format (type cast to avoid never error)
  if (typeof keywords === "string") {
    return (keywords as string)
      .split(",")
      .map((k: string) => k.trim())
      .filter((k) => k.length > 0);
  }

  return [];
}

/**
 * Extract tags from frontmatter
 *
 * @param frontmatter - Parsed frontmatter
 * @returns Array of tags
 */
export function extractTags(frontmatter: ParsedFrontmatter): string[] {
  const tags = frontmatter.tags || [];

  // Ensure array format
  if (Array.isArray(tags)) {
    const unique = new Set<string>();
    for (const t of tags) {
      const trimmed = String(t).trim();
      if (trimmed.length > 0) {
        unique.add(trimmed);
      }
    }
    return [...unique];
  }

  // Handle comma-separated string format (type cast to avoid never error)
  if (typeof tags === "string") {
    const unique = new Set<string>();
    const items = (tags as string).split(",");
    for (const t of items) {
      const trimmed = t.trim();
      if (trimmed.length > 0) {
        unique.add(trimmed);
      }
    }
    return [...unique];
  }

  return [];
}

/**
 * Build a CandidateNote object from a parsed file
 *
 * @param filePath - Path to the markdown file
 * @param frontmatter - Parsed frontmatter
 * @param title - Extracted title
 * @returns CandidateNote object
 */
export function buildCandidateNote(
  filePath: string,
  frontmatter: ParsedFrontmatter,
  title: string
): CandidateNote {
  const sourceUrl = frontmatter.source || frontmatter.url;
  const domain = extractDomain(sourceUrl);

  // Use type or fall back to page_type or default to "article"
  const contentType =
    frontmatter.type || frontmatter.page_type || "article";

  const entities = extractEntities(frontmatter);
  const tags = extractTags(frontmatter);
  const timestamp = extractTimestamp(frontmatter);

  // Build unique ID (use file path as ID)
  const id = filePath;

  return {
    path: filePath,
    title,
    sourceUrl,
    domain: domain || undefined,
    contentType,
    entities,
    tags,
    timestamp,
    id
  };
}

/**
 * Check if a note has required tags
 *
 * @param frontmatter - Parsed frontmatter
 * @param requiredTags - Tags that must be present
 * @returns True if all required tags are present
 */
export function hasRequiredTags(
  frontmatter: ParsedFrontmatter,
  requiredTags: string[]
): boolean {
  if (requiredTags.length === 0) {
    return true;
  }

  const tags = extractTags(frontmatter);
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));

  return requiredTags.every((reqTag) =>
    tagSet.has(reqTag.toLowerCase())
  );
}

/**
 * Check if a note meets minimum date filter
 *
 * @param frontmatter - Parsed frontmatter
 * @param minDate - Minimum date (ISO 8601)
 * @returns True if note date is >= minDate (includes note on invalid dates)
 */
export function meetsMinDateFilter(
  frontmatter: ParsedFrontmatter,
  minDate: string
): boolean {
  const timestamp = extractTimestamp(frontmatter);

  try {
    const noteDate = new Date(timestamp);
    const filterDate = new Date(minDate);

    // Check if dates are valid
    if (isNaN(noteDate.getTime()) || isNaN(filterDate.getTime())) {
      // Invalid date - include note
      return true;
    }

    return noteDate >= filterDate;
  } catch {
    // If date parsing fails, include the note
    return true;
  }
}

/**
 * Index a vault to build candidate notes for related clips matching
 *
 * This is the main entry point for vault indexing. It scans all markdown files,
 * parses their frontmatter, and builds CandidateNote objects.
 *
 * @param options - Indexing options
 * @returns VaultIndexResult with candidates and metadata
 *
 * @example
 * ```ts
 * const result = await indexVault({
 *   vaultPath: "/Users/t3rpz/Documents/Obsidian Vault",
 *   includeHidden: false,
 *   requiredTags: ["clip"]
 * });
 *
 * console.log(`Found ${result.candidates.length} candidate notes`);
 * ```
 */
export async function indexVault(
  options: VaultIndexOptions
): Promise<VaultIndexResult> {
  const {
    vaultPath,
    includeHidden = false,
    maxDepth = 0,
    requiredTags = [],
    minDate,
    maxFiles
  } = options;

  const result: VaultIndexResult = {
    candidates: [],
    filesScanned: 0,
    filesWithFrontmatter: 0,
    filesSkipped: 0,
    errors: []
  };

  // Find all markdown files
  const markdownFiles = await findMarkdownFiles(vaultPath, {
    includeHidden,
    maxDepth
  });

  result.filesScanned = markdownFiles.length;

  // Process each file
  for (const filePath of markdownFiles) {
    // Check max files limit
    if (maxFiles !== undefined && result.candidates.length >= maxFiles) {
      break;
    }

    try {
      // Read file content
      const content = await fs.readFile(filePath, "utf-8");

      // Extract frontmatter
      const frontmatter = extractFrontmatter(content);

      if (!frontmatter) {
        result.filesSkipped++;
        continue;
      }

      // Apply filters
      if (requiredTags.length > 0 && !hasRequiredTags(frontmatter, requiredTags)) {
        result.filesSkipped++;
        continue;
      }

      if (minDate && !meetsMinDateFilter(frontmatter, minDate)) {
        result.filesSkipped++;
        continue;
      }

      // Extract title
      const filename = path.basename(filePath, path.extname(filePath));
      const title = frontmatter.title || extractTitle(content, filename);

      // Build candidate note
      const candidate = buildCandidateNote(filePath, frontmatter, title);

      // Filter out notes without source URL (they can't be matched)
      if (!candidate.sourceUrl) {
        result.filesSkipped++;
        continue;
      }

      result.candidates.push(candidate);
      result.filesWithFrontmatter++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({
        filePath,
        error: errorMessage,
        errorType: "read_error"
      });
      result.filesSkipped++;
    }
  }

  return result;
}

/**
 * Index a single note file
 *
 * Useful for incremental indexing or testing.
 *
 * @param filePath - Path to the markdown file
 * @returns CandidateNote or null if frontmatter is invalid
 */
export async function indexSingleNote(
  filePath: string
): Promise<CandidateNote | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const frontmatter = extractFrontmatter(content);

    if (!frontmatter) {
      return null;
    }

    const filename = path.basename(filePath, path.extname(filePath));
    const title = frontmatter.title || extractTitle(content, filename);
    const candidate = buildCandidateNote(filePath, frontmatter, title);

    // Require source URL for matching
    if (!candidate.sourceUrl) {
      return null;
    }

    return candidate;
  } catch (error) {
    console.warn(`[VaultIndex] Failed to index note ${filePath}:`, error);
    return null;
  }
}
