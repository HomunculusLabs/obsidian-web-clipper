/**
 * Knowledge Triage State Sync Builder
 *
 * This module provides utilities for extracting triage items from multiple source
 * inboxes and building the Knowledge Triage State Sync. It includes:
 *
 * - Parsing triage entries from various inbox artifacts
 * - Extracting status and metadata from inbox entries
 * - Normalizing items across different inbox formats
 * - Merging items using the contract utilities for state reconciliation
 *
 * Core Goals:
 * - Extract triage items deterministically from markdown inboxes
 * - Preserve source inbox metadata for linkbacks and writeback
 * - Handle malformed inbox sections gracefully
 * - Support bounded scanning (time window, file limits)
 */

import { promises as fs } from "fs";
import * as path from "path";

import type {
  TriageItemInput,
  TriageStatus,
  SourceInboxType,
  StatusSource,
  TriageStateSync,
} from "./knowledgeTriageStateSyncContract";
import {
  TriageStatus as ContractTriageStatus,
  SourceInboxType as ContractSourceInboxType,
  StatusSource as ContractStatusSource,
  buildTriageStateSync,
  MAX_TRIAGE_ITEMS,
  TRIAGE_STATE_SYNC_VERSION,
} from "./knowledgeTriageStateSyncContract";

/**
 * Options for scanning vault notes for triage items
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

  /** Specific inboxes to scan (default: all inboxes) */
  inboxTypes?: SourceInboxType[];
}

/**
 * Result of scanning vault for triage items
 */
export interface ScanVaultResult {
  /** Extracted triage items from all inboxes */
  triageItems: TriageItemInput[];

  /** Total markdown files scanned */
  filesScanned: number;

  /** Files with triage content */
  filesWithTriage: number;

  /** Files skipped (no triage content, parse errors, or out of scope) */
  filesSkipped: number;

  /** Errors encountered during scanning */
  errors: ScanError[];

  /** Per-inbox statistics */
  inboxStats: Map<SourceInboxType, InboxStats>;

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
  errorType: "read_error" | "parse_error" | "frontmatter_error" | "inbox_error";

  /** Inbox type being processed when error occurred (if applicable) */
  inboxType?: SourceInboxType;
}

/**
 * Statistics for a single inbox type
 */
export interface InboxStats {
  /** Number of files with this inbox type */
  filesWithInbox: number;

  /** Number of triage items extracted from this inbox */
  itemsExtracted: number;

  /** Number of items per status */
  statusCounts: {
    ready: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
}

/**
 * Parsed inbox section from a note
 */
export interface ParsedInboxSection {
  /** Type of inbox this section represents */
  inboxType: SourceInboxType;

  /** Path to the inbox note */
  inboxPath: string;

  /** Title of the inbox note */
  inboxTitle: string;

  /** Triage items extracted from the section */
  items: ExtractedTriageItem[];
}

/**
 * Single triage item extracted from an inbox section
 */
export interface ExtractedTriageItem {
  /** The item description (insight, question, task, etc.) */
  description: string;

  /** Status of the item (inferred from formatting) */
  status: TriageStatus;

  /** Entry ID within the inbox (if available) */
  entryId?: string;

  /** Line number where the item appears */
  lineNumber: number;

  /** Source URL or context for the item (optional) */
  sourceUrl?: string;
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

  // Parse simple YAML
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
 * Parse Key Takeaways Inbox section from markdown content
 *
 * The Key Takeaways Inbox is expected to be formatted as:
 *
 * ```markdown
 * ## Key Takeaways Inbox
 *
 * ### Ready
 *
 * - React Server Components use RSC payload for hydration
 *
 * ### In Progress
 *
 * - ~~Deprecated insight~~ (archived)
 * ```
 *
 * Items in the "Done" section are considered DONE.
 * Items marked with strikethrough (~~text~~) are considered ARCHIVED (DONE).
 * All other items are READY.
 *
 * @param content - Full markdown content of the inbox note
 * @param inboxPath - Path to the inbox note file
 * @returns Parsed inbox section, or null if not found
 */
export function parseKeyTakeawaysInbox(
  content: string,
  inboxPath: string
): ParsedInboxSection | null {
  const lines = content.split("\n");

  // Find "## Key Takeaways Inbox" section
  let inboxStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Key\s+Takeaways\s+Inbox$/i.test(lines[i]!.trim())) {
      inboxStart = i;
      break;
    }
  }

  if (inboxStart === -1) {
    return null;
  }

  // Extract title from frontmatter or filename
  const frontmatter = parseFrontmatter(content);
  const inboxTitle = extractNoteTitle(frontmatter, inboxPath);

  // Extract source URL from frontmatter
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : undefined;

  // Find the end of the inbox section (next ## heading or EOF)
  let inboxEnd = lines.length;
  for (let i = inboxStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      inboxEnd = i;
      break;
    }
  }

  // Extract inbox content
  const inboxLines = lines.slice(inboxStart, inboxEnd);

  // Parse items from the inbox
  const items = parseTriageItemsFromInbox(inboxLines, inboxStart, ContractSourceInboxType.KEY_TAKEAWAYS, sourceUrl);

  if (items.length === 0) {
    return null;
  }

  return {
    inboxType: ContractSourceInboxType.KEY_TAKEAWAYS,
    inboxPath,
    inboxTitle,
    items,
  };
}

/**
 * Parse Open Questions Inbox section from markdown content
 *
 * The Open Questions Inbox is expected to be formatted similarly to Key Takeaways.
 *
 * @param content - Full markdown content of the inbox note
 * @param inboxPath - Path to the inbox note file
 * @returns Parsed inbox section, or null if not found
 */
export function parseOpenQuestionsInbox(
  content: string,
  inboxPath: string
): ParsedInboxSection | null {
  const lines = content.split("\n");

  // Find "## Open Questions Inbox" section
  let inboxStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Open\s+Questions\s+Inbox$/i.test(lines[i]!.trim())) {
      inboxStart = i;
      break;
    }
  }

  if (inboxStart === -1) {
    return null;
  }

  // Extract title from frontmatter or filename
  const frontmatter = parseFrontmatter(content);
  const inboxTitle = extractNoteTitle(frontmatter, inboxPath);

  // Extract source URL from frontmatter
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : undefined;

  // Find the end of the inbox section
  let inboxEnd = lines.length;
  for (let i = inboxStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      inboxEnd = i;
      break;
    }
  }

  // Extract inbox content
  const inboxLines = lines.slice(inboxStart, inboxEnd);

  // Parse items from the inbox
  const items = parseTriageItemsFromInbox(inboxLines, inboxStart, ContractSourceInboxType.OPEN_QUESTIONS, sourceUrl);

  if (items.length === 0) {
    return null;
  }

  return {
    inboxType: ContractSourceInboxType.OPEN_QUESTIONS,
    inboxPath,
    inboxTitle,
    items,
  };
}

/**
 * Parse Execution Backlog Inbox section from markdown content
 *
 * @param content - Full markdown content of the inbox note
 * @param inboxPath - Path to the inbox note file
 * @returns Parsed inbox section, or null if not found
 */
export function parseExecutionBacklogInbox(
  content: string,
  inboxPath: string
): ParsedInboxSection | null {
  const lines = content.split("\n");

  // Find "## Execution Backlog Inbox" section
  let inboxStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Execution\s+Backlog\s+Inbox$/i.test(lines[i]!.trim())) {
      inboxStart = i;
      break;
    }
  }

  if (inboxStart === -1) {
    return null;
  }

  // Extract title from frontmatter or filename
  const frontmatter = parseFrontmatter(content);
  const inboxTitle = extractNoteTitle(frontmatter, inboxPath);

  // Extract source URL from frontmatter
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : undefined;

  // Find the end of the inbox section
  let inboxEnd = lines.length;
  for (let i = inboxStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      inboxEnd = i;
      break;
    }
  }

  // Extract inbox content
  const inboxLines = lines.slice(inboxStart, inboxEnd);

  // Parse items from the inbox
  const items = parseTriageItemsFromInbox(inboxLines, inboxStart, ContractSourceInboxType.EXECUTION_BACKLOG, sourceUrl);

  if (items.length === 0) {
    return null;
  }

  return {
    inboxType: ContractSourceInboxType.EXECUTION_BACKLOG,
    inboxPath,
    inboxTitle,
    items,
  };
}

/**
 * Parse Clip Recovery Inbox section from markdown content
 *
 * @param content - Full markdown content of the inbox note
 * @param inboxPath - Path to the inbox note file
 * @returns Parsed inbox section, or null if not found
 */
export function parseClipRecoveryInbox(
  content: string,
  inboxPath: string
): ParsedInboxSection | null {
  const lines = content.split("\n");

  // Find "## Clip Recovery Inbox" section
  let inboxStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Clip\s+Recovery\s+Inbox$/i.test(lines[i]!.trim())) {
      inboxStart = i;
      break;
    }
  }

  if (inboxStart === -1) {
    return null;
  }

  // Extract title from frontmatter or filename
  const frontmatter = parseFrontmatter(content);
  const inboxTitle = extractNoteTitle(frontmatter, inboxPath);

  // Extract source URL from frontmatter
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : undefined;

  // Find the end of the inbox section
  let inboxEnd = lines.length;
  for (let i = inboxStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      inboxEnd = i;
      break;
    }
  }

  // Extract inbox content
  const inboxLines = lines.slice(inboxStart, inboxEnd);

  // Parse items from the inbox
  const items = parseTriageItemsFromInbox(inboxLines, inboxStart, ContractSourceInboxType.CLIP_RECOVERY, sourceUrl);

  if (items.length === 0) {
    return null;
  }

  return {
    inboxType: ContractSourceInboxType.CLIP_RECOVERY,
    inboxPath,
    inboxTitle,
    items,
  };
}

/**
 * Parse Knowledge Triage Inbox section from markdown content
 *
 * This inbox may have manually set statuses via frontmatter metadata.
 *
 * @param content - Full markdown content of the inbox note
 * @param inboxPath - Path to the inbox note file
 * @returns Parsed inbox section, or null if not found
 */
export function parseKnowledgeTriageInbox(
  content: string,
  inboxPath: string
): ParsedInboxSection | null {
  const lines = content.split("\n");

  // Find "## Knowledge Triage Inbox" section
  let inboxStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Knowledge\s+Triage\s+Inbox$/i.test(lines[i]!.trim())) {
      inboxStart = i;
      break;
    }
  }

  if (inboxStart === -1) {
    return null;
  }

  // Extract title from frontmatter or filename
  const frontmatter = parseFrontmatter(content);
  const inboxTitle = extractNoteTitle(frontmatter, inboxPath);

  // Extract source URL from frontmatter
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : undefined;

  // Knowledge Triage items have MANUAL status source
  const statusSource = ContractStatusSource.MANUAL;

  // Find the end of the inbox section
  let inboxEnd = lines.length;
  for (let i = inboxStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      inboxEnd = i;
      break;
    }
  }

  // Extract inbox content
  const inboxLines = lines.slice(inboxStart, inboxEnd);

  // Parse items from the inbox with manual status source
  const items = parseTriageItemsFromInbox(inboxLines, inboxStart, ContractSourceInboxType.KNOWLEDGE_TRIAGE, sourceUrl, statusSource);

  if (items.length === 0) {
    return null;
  }

  return {
    inboxType: ContractSourceInboxType.KNOWLEDGE_TRIAGE,
    inboxPath,
    inboxTitle,
    items,
  };
}

/**
 * Parse triage items from inbox section content
 *
 * Handles multiple status subsections (Ready, In Progress, Blocked, Done).
 *
 * @param inboxLines - Lines of the inbox section
 * @param sectionOffset - Offset of the section in the original content
 * @param inboxType - Type of inbox being parsed
 * @param sourceUrl - Optional source URL
 * @param statusSource - Source of status values (default: INBOX)
 * @returns Array of extracted triage items
 */
function parseTriageItemsFromInbox(
  inboxLines: string[],
  sectionOffset: number,
  inboxType: SourceInboxType,
  sourceUrl: string | undefined,
  statusSource: StatusSource = ContractStatusSource.INBOX
): ExtractedTriageItem[] {
  const items: ExtractedTriageItem[] = [];

  // Find status subsections
  const statusMappings: { [heading: string]: TriageStatus } = {
    "Ready": ContractTriageStatus.READY,
    "In Progress": ContractTriageStatus.IN_PROGRESS,
    "Blocked": ContractTriageStatus.BLOCKED,
    "Done": ContractTriageStatus.DONE,
  };

  let currentStatus: TriageStatus | null = null;
  let currentSubsectionStart = -1;

  for (let i = 0; i < inboxLines.length; i++) {
    const line = inboxLines[i]!;
    const trimmed = line.trim();

    // Check for status subsection heading
    const statusMatch = trimmed.match(/^###\s+(Ready|In\s+Progress|Blocked|Done)$/i);
    if (statusMatch) {
      // Flush previous subsection
      if (currentSubsectionStart >= 0 && currentStatus) {
        const subsectionLines = inboxLines.slice(currentSubsectionStart + 1, i);
        const subsectionItems = parseTriageItemsFromList(
          subsectionLines,
          sectionOffset + currentSubsectionStart + 1,
          currentStatus,
          statusSource,
          sourceUrl
        );
        items.push(...subsectionItems);
      }

      currentStatus = statusMappings[statusMatch[1]!.trim()]!;
      currentSubsectionStart = i;
      continue;
    }
  }

  // Flush final subsection
  if (currentSubsectionStart >= 0 && currentStatus) {
    const subsectionLines = inboxLines.slice(currentSubsectionStart + 1);
    const subsectionItems = parseTriageItemsFromList(
      subsectionLines,
      sectionOffset + currentSubsectionStart + 1,
      currentStatus,
      statusSource,
      sourceUrl
    );
    items.push(...subsectionItems);
  }

  // If no status subsections found, treat all items as READY (default inbox format)
  if (currentStatus === null) {
    const defaultItems = parseTriageItemsFromList(
      inboxLines,
      sectionOffset,
      ContractTriageStatus.READY,
      statusSource,
      sourceUrl
    );
    items.push(...defaultItems);
  }

  return items;
}

/**
 * Parse triage items from a list section
 *
 * @param lines - Lines of the list section
 * @param offset - Line number offset in original content
 * @param defaultStatus - Default status for items
 * @param statusSource - Source of status values
 * @param sourceUrl - Optional source URL
 * @returns Array of extracted triage items
 */
function parseTriageItemsFromList(
  lines: string[],
  offset: number,
  defaultStatus: TriageStatus,
  statusSource: StatusSource,
  sourceUrl: string | undefined
): ExtractedTriageItem[] {
  const items: ExtractedTriageItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Skip empty lines and non-list items
    if (!trimmed || !trimmed.startsWith("-")) {
      continue;
    }

    // Extract description text (remove bullet point and whitespace)
    let description = trimmed.slice(1).trim();

    // Skip empty descriptions
    if (!description) {
      continue;
    }

    // Check for checkbox format
    const checkboxMatch = description.match(/^\[([ x])\]\s*(.*)$/i);
    if (checkboxMatch) {
      const isChecked = checkboxMatch[1]!.toLowerCase() === "x";
      description = checkboxMatch[2]!.trim();

      // Checkbox overrides default status
      if (isChecked) {
        // Checked items are DONE
        continue; // Skip done items from triage (they're resolved)
      }
    }

    // Check if archived (marked with strikethrough)
    const isArchived = /^~~.*~~$/.test(description);
    const cleanDescription = isArchived
      ? description.slice(2, -2).trim()
      : description;

    // Skip empty after stripping
    if (!cleanDescription) {
      continue;
    }

    // Normalize the description: remove leading bullet markers, checkboxes
    description = cleanDescription
      .replace(/^[-*]\s*/, "") // Remove leading bullet markers
      .replace(/^\[[ x]\]\s*/, "") // Remove checkbox markers
      .trim();

    if (!description) {
      continue;
    }

    // Extract entry ID from inline metadata if present
    // Format: Description <!-- entry_id: abc123 -->
    const entryIdMatch = description.match(/^(.+?)\s*<!--\s*entry_id:\s*([a-zA-Z0-9_-]+)\s*-->$/);
    let entryId: string | undefined;
    if (entryIdMatch) {
      entryId = entryIdMatch[2]!;
      description = entryIdMatch[1]!.trim();
    }

    items.push({
      description,
      status: isArchived ? ContractTriageStatus.DONE : defaultStatus,
      entryId,
      lineNumber: offset + i,
      sourceUrl,
    });
  }

  return items;
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
 * Convert ParsedInboxSection to TriageItemInput array
 *
 * @param inboxSection - Parsed inbox section
 * @returns Array of TriageItemInput
 */
export function inboxSectionToInputs(inboxSection: ParsedInboxSection): TriageItemInput[] {
  const now = new Date().toISOString();

  return inboxSection.items.map((item) => ({
    description: item.description,
    sourceInbox: inboxSection.inboxType,
    inboxPath: inboxSection.inboxPath,
    inboxTitle: inboxSection.inboxTitle,
    entryId: item.entryId || generateEntryId(item.description, inboxSection.inboxType, item.lineNumber),
    sourceUrl: item.sourceUrl,
    firstSeenAt: now,
    lastSeenAt: now,
    status: item.status,
    statusSource: ContractStatusSource.INBOX,
    statusChangedAt: now,
  }));
}

/**
 * Generate a stable entry ID for a triage item
 *
 * @param description - Item description
 * @param inboxType - Type of inbox
 * @param lineNumber - Line number in the inbox file
 * @returns Stable entry ID
 */
function generateEntryId(description: string, inboxType: SourceInboxType, lineNumber: number): string {
  const normalized = description
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 50);

  return `${inboxType}-${normalized}-${lineNumber}`;
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
        // Check max depth before recursing
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
 * Get inbox parser for a given inbox type
 *
 * @param inboxType - Type of inbox
 * @returns Parser function for the inbox type
 */
function getInboxParser(inboxType: SourceInboxType): (
  content: string,
  inboxPath: string
) => ParsedInboxSection | null {
  switch (inboxType) {
    case ContractSourceInboxType.KEY_TAKEAWAYS:
      return parseKeyTakeawaysInbox;
    case ContractSourceInboxType.OPEN_QUESTIONS:
      return parseOpenQuestionsInbox;
    case ContractSourceInboxType.EXECUTION_BACKLOG:
      return parseExecutionBacklogInbox;
    case ContractSourceInboxType.CLIP_RECOVERY:
      return parseClipRecoveryInbox;
    case ContractSourceInboxType.KNOWLEDGE_TRIAGE:
      return parseKnowledgeTriageInbox;
    default:
      return () => null;
  }
}

/**
 * Scan vault for triage items across all source inboxes
 *
 * This is the main entry point for extracting triage items from vault notes.
 *
 * @param options - Scan options
 * @returns Scan result with extracted triage items
 */
export async function scanVaultForTriageItems(
  options: ScanVaultOptions
): Promise<ScanVaultResult> {
  const result: ScanVaultResult = {
    triageItems: [],
    filesScanned: 0,
    filesWithTriage: 0,
    filesSkipped: 0,
    errors: [],
    inboxStats: new Map(),
    options,
  };

  // Initialize stats for all inbox types
  const inboxTypesToScan = options.inboxTypes || [
    ContractSourceInboxType.KEY_TAKEAWAYS,
    ContractSourceInboxType.OPEN_QUESTIONS,
    ContractSourceInboxType.EXECUTION_BACKLOG,
    ContractSourceInboxType.CLIP_RECOVERY,
    ContractSourceInboxType.KNOWLEDGE_TRIAGE,
  ];

  for (const inboxType of inboxTypesToScan) {
    result.inboxStats.set(inboxType, {
      filesWithInbox: 0,
      itemsExtracted: 0,
      statusCounts: {
        ready: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
      },
    });
  }

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

      // Try to parse each inbox type
      for (const inboxType of inboxTypesToScan) {
        try {
          const parser = getInboxParser(inboxType);
          const inboxSection = parser(content, filePath);

          if (inboxSection) {
            result.filesWithTriage++;

            // Convert to TriageItemInput
            const inputs = inboxSectionToInputs(inboxSection);

            // Update stats
            const stats = result.inboxStats.get(inboxType)!;
            stats.filesWithInbox++;
            stats.itemsExtracted += inputs.length;

            for (const input of inputs) {
              // Map kebab-case enum values to camelCase property names
              const statusKey = input.status === "in-progress" ? "inProgress" : input.status as keyof typeof stats.statusCounts;
              stats.statusCounts[statusKey]++;
            }

            // Add items to result
            result.triageItems.push(...inputs);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({
            filePath,
            error: errorMsg,
            errorType: "inbox_error",
            inboxType,
          });
        }
      }

      if (result.triageItems.length === 0) {
        result.filesSkipped++;
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push({
        filePath,
        error: errorMsg,
        errorType: "read_error",
      });
      result.filesSkipped++;
    }
  }

  // Sort items deterministically (by inbox type, then path, then description)
  result.triageItems.sort((a, b) => {
    if (a.sourceInbox !== b.sourceInbox) {
      return a.sourceInbox.localeCompare(b.sourceInbox);
    }
    if (a.inboxPath !== b.inboxPath) {
      return a.inboxPath.localeCompare(b.inboxPath);
    }
    return a.description.localeCompare(b.description);
  });

  return result;
}

/**
 * Build Triage State Sync from vault scan
 *
 * This is a convenience function that combines scanning and building.
 *
 * @param options - Scan options
 * @returns Triage State Sync
 */
export async function buildStateSyncFromVault(
  options: ScanVaultOptions
): Promise<TriageStateSync> {
  // Scan vault for triage items
  const scanResult = await scanVaultForTriageItems(options);

  // Build sync using contract utility
  const sync = buildTriageStateSync(scanResult.triageItems);

  return sync;
}

/**
 * Extract triage items from a single note
 *
 * Convenience function for processing individual notes.
 *
 * @param content - Markdown content
 * @param notePath - Path to the note
 * @param inboxTypes - Inbox types to extract from (default: all)
 * @returns Array of TriageItemInput
 */
export function extractTriageItemsFromNote(
  content: string,
  notePath: string,
  inboxTypes?: SourceInboxType[]
): TriageItemInput[] {
  const allItems: TriageItemInput[] = [];

  const typesToScan = inboxTypes || [
    ContractSourceInboxType.KEY_TAKEAWAYS,
    ContractSourceInboxType.OPEN_QUESTIONS,
    ContractSourceInboxType.EXECUTION_BACKLOG,
    ContractSourceInboxType.CLIP_RECOVERY,
    ContractSourceInboxType.KNOWLEDGE_TRIAGE,
  ];

  for (const inboxType of typesToScan) {
    try {
      const parser = getInboxParser(inboxType);
      const inboxSection = parser(content, notePath);

      if (inboxSection) {
        const inputs = inboxSectionToInputs(inboxSection);
        allItems.push(...inputs);
      }
    } catch (error) {
      // Skip errors for single-note extraction
      console.error(`Error parsing ${inboxType} from ${notePath}:`, error);
    }
  }

  return allItems;
}

/**
 * Merge triage items from multiple sources
 *
 * Takes an array of TriageItemInput and uses the contract's
 * buildTriageStateSync function to merge duplicates and reconcile status.
 *
 * @param inputs - Array of triage items from various inboxes
 * @returns Complete Triage State Sync
 */
export function mergeTriageItems(inputs: TriageItemInput[]): TriageStateSync {
  return buildTriageStateSync(inputs);
}

/**
 * Normalize a triage item description for comparison
 *
 * This is a convenience wrapper for cases where you only need
 * the normalized text without the full fingerprint.
 *
 * @param description - The description to normalize
 * @returns Normalized description text
 */
export function normalizeTriageDescription(description: string): string {
  return description
    .toLowerCase()
    .trim()
    .replace(/^[-*]\s*/, "") // Remove leading bullet markers
    .replace(/^\[[ x]\]\s*/, "") // Remove checkbox markers
    .replace(/\s+/g, " ") // Collapse multiple whitespace
    .replace(/[.,!?;:]+$/, ""); // Remove trailing punctuation
}
