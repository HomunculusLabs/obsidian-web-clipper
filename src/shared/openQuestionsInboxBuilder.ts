/**
 * Open Questions Inbox Builder
 *
 * This module provides utilities for extracting Open Questions from Clip Brief
 * sections across multiple clips and building the inbox. It includes:
 *
 * - Parsing Clip Brief sections from markdown notes
 * - Extracting Open Questions with source metadata
 * - Normalizing question text for deduplication
 * - Building the inbox using the contract utilities
 *
 * Core Goals:
 * - Extract questions deterministically from markdown
 * - Preserve source clip metadata for linkbacks
 * - Handle malformed sections gracefully
 * - Support bounded scanning (time window, file limits)
 */

import { promises as fs } from "fs";
import * as path from "path";

import type {
  OpenQuestionInput,
  QuestionStatus,
  OpenQuestionsInbox
} from "./openQuestionsInboxContract";
import {
  buildOpenQuestionsInbox,
  QuestionStatus as ContractQuestionStatus
} from "./openQuestionsInboxContract";

/**
 * Options for scanning vault notes for Open Questions
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
 * Result of scanning vault for Open Questions
 */
export interface ScanVaultResult {
  /** Extracted open questions from all clips */
  questions: OpenQuestionInput[];

  /** Total markdown files scanned */
  filesScanned: number;

  /** Files with Clip Brief sections */
  filesWithClipBrief: number;

  /** Files with Open Questions */
  filesWithOpenQuestions: number;

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

  /** Open questions extracted from the section */
  openQuestions: ExtractedQuestion[];
}

/**
 * Single question extracted from a Clip Brief section
 */
export interface ExtractedQuestion {
  /** The question text */
  question: string;

  /** Status of the question (inferred from formatting) */
  status: QuestionStatus;

  /** Line number where the question appears */
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
 * ### Open Questions
 *
 * - Question 1?
 * - Question 2?
 * - ~~Resolved question 3?~~
 * ```
 *
 * Questions marked with strikethrough (~~text~~) are considered RESOLVED.
 * All other questions are UNRESOLVED.
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
    if (/^##\s+/.test(lines[i]!.trim()) && !/^##\s+(Clip\s+Brief|Open\s+Questions|Action\s+Items|Knowledge\s+Bundle)/i.test(lines[i]!.trim())) {
      clipBriefEnd = i;
      break;
    }
  }

  // Extract Clip Brief content
  const clipBriefLines = lines.slice(clipBriefStart, clipBriefEnd);

  // Find "### Open Questions" subsection
  let openQuestionsStart = -1;
  for (let i = 0; i < clipBriefLines.length; i++) {
    if (/^###\s+Open\s+Questions$/i.test(clipBriefLines[i]!.trim())) {
      openQuestionsStart = i;
      break;
    }
  }

  if (openQuestionsStart === -1) {
    // No Open Questions subsection - return empty ParsedClipBrief
    return extractClipBriefMetadata(content, notePath, []);
  }

  // Extract Open Questions content (until next ### or EOF)
  let openQuestionsEnd = clipBriefLines.length;
  for (let i = openQuestionsStart + 1; i < clipBriefLines.length; i++) {
    if (/^###\s+/.test(clipBriefLines[i]!.trim())) {
      openQuestionsEnd = i;
      break;
    }
  }

  // Parse questions from list items
  const questionLines = clipBriefLines.slice(openQuestionsStart + 1, openQuestionsEnd);
  const questions: ExtractedQuestion[] = [];

  for (let i = 0; i < questionLines.length; i++) {
    const line = questionLines[i]!;
    const trimmed = line.trim();

    // Skip empty lines and non-list items
    if (!trimmed || !trimmed.startsWith("-")) {
      continue;
    }

    // Extract question text (remove bullet point and whitespace)
    const questionText = trimmed.slice(1).trim();

    // Skip empty questions
    if (!questionText) {
      continue;
    }

    // Check if resolved (marked with strikethrough)
    const isResolved = /^~~.*~~$/.test(questionText);
    const cleanQuestion = isResolved
      ? questionText.slice(2, -2).trim()
      : questionText;

    // Skip empty after stripping
    if (!cleanQuestion) {
      continue;
    }

    questions.push({
      question: cleanQuestion,
      status: isResolved ? ContractQuestionStatus.RESOLVED : ContractQuestionStatus.UNRESOLVED,
      lineNumber: clipBriefStart + openQuestionsStart + 1 + i
    });
  }

  return extractClipBriefMetadata(content, notePath, questions);
}

/**
 * Extract metadata from the note and build ParsedClipBrief
 *
 * @param content - Full markdown content
 * @param notePath - Path to the note file
 * @param openQuestions - Extracted Open Questions
 * @returns ParsedClipBrief with metadata
 */
function extractClipBriefMetadata(
  content: string,
  notePath: string,
  openQuestions: ExtractedQuestion[]
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
    openQuestions
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
 * Convert ParsedClipBrief to OpenQuestionInput array
 *
 * @param clipBrief - Parsed Clip Brief
 * @param clipPath - Path to the clip note
 * @returns Array of OpenQuestionInput
 */
export function clipBriefToInputs(
  clipBrief: ParsedClipBrief,
  clipPath: string
): OpenQuestionInput[] {
  return clipBrief.openQuestions.map((q) => ({
    question: q.question,
    clipPath,
    clipTitle: clipBrief.noteTitle,
    clipUrl: clipBrief.sourceUrl,
    clipTimestamp: clipBrief.timestamp,
    clipId: clipPath, // Use path as ID for simplicity
    status: q.status
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
 * Scan vault for Open Questions across all clips
 *
 * This is the main entry point for extracting questions from vault notes.
 *
 * @param options - Scan options
 * @returns Scan result with extracted questions
 */
export async function scanVaultForOpenQuestions(
  options: ScanVaultOptions
): Promise<ScanVaultResult> {
  const result: ScanVaultResult = {
    questions: [],
    filesScanned: 0,
    filesWithClipBrief: 0,
    filesWithOpenQuestions: 0,
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

      if (clipBrief.openQuestions.length === 0) {
        result.filesSkipped++;
        continue;
      }

      result.filesWithOpenQuestions++;

      // Convert to OpenQuestionInput
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

      // Add questions to result
      result.questions.push(...inputs);

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

  // Sort questions deterministically (by path, then by question text)
  result.questions.sort((a, b) => {
    if (a.clipPath !== b.clipPath) {
      return a.clipPath.localeCompare(b.clipPath);
    }
    return a.question.localeCompare(b.question);
  });

  return result;
}

/**
 * Build Open Questions Inbox from vault scan
 *
 * This is a convenience function that combines scanning and building.
 *
 * @param options - Scan options
 * @returns Open Questions Inbox
 */
export async function buildInboxFromVault(
  options: ScanVaultOptions
): Promise<OpenQuestionsInbox> {
  // Scan vault for questions
  const scanResult = await scanVaultForOpenQuestions(options);

  // Build inbox using contract utility
  const inbox = buildOpenQuestionsInbox(scanResult.questions);

  return inbox;
}

/**
 * Extract Open Questions from a single note
 *
 * Convenience function for processing individual notes.
 *
 * @param content - Markdown content
 * @param notePath - Path to the note
 * @returns Array of OpenQuestionInput
 */
export function extractOpenQuestionsFromNote(
  content: string,
  notePath: string
): OpenQuestionInput[] {
  const clipBrief = parseClipBriefSection(content, notePath);
  if (!clipBrief) {
    return [];
  }

  return clipBriefToInputs(clipBrief, notePath);
}
