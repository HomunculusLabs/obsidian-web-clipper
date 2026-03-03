/**
 * Knowledge Confidence State Sync Builder
 *
 * This module provides utilities for extracting confidence items from multiple source
 * artifacts and building the Knowledge Confidence State Sync. It includes:
 *
 * - Parsing confidence entries from various artifact types
 * - Extracting status and metadata from artifact entries
 * - Normalizing items across different artifact formats
 * - Merging items using the contract utilities for state reconciliation
 *
 * Core Goals:
 * - Extract confidence items deterministically from markdown artifacts
 * - Preserve source artifact metadata for linkbacks and writeback
 * - Handle malformed artifact sections gracefully
 * - Support bounded scanning (time window, file limits)
 */

import { promises as fs } from "fs";
import * as path from "path";

import type {
  ConfidenceItemInput,
  ConfidenceStatus,
  SourceType,
  StatusSource,
  ConfidenceStateSync,
} from "./knowledgeConfidenceStateSyncContract";
import {
  ConfidenceStatus as ContractConfidenceStatus,
  SourceType as ContractSourceType,
  StatusSource as ContractStatusSource,
  buildConfidenceStateSync,
  MAX_CONFIDENCE_ITEMS,
  CONFIDENCE_STATE_SYNC_VERSION,
} from "./knowledgeConfidenceStateSyncContract";

/**
 * Options for scanning vault notes for confidence items
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

  /** Specific artifact types to scan (default: all artifacts) */
  artifactTypes?: SourceType[];
}

/**
 * Result of scanning vault for confidence items
 */
export interface ScanVaultResult {
  /** Extracted confidence items from all artifacts */
  confidenceItems: ConfidenceItemInput[];

  /** Total markdown files scanned */
  filesScanned: number;

  /** Files with confidence content */
  filesWithConfidence: number;

  /** Files skipped (no confidence content, parse errors, or out of scope) */
  filesSkipped: number;

  /** Errors encountered during scanning */
  errors: ScanError[];

  /** Per-artifact type statistics */
  artifactStats: Map<SourceType, ArtifactStats>;

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
  errorType: "read_error" | "parse_error" | "frontmatter_error" | "artifact_error";

  /** Artifact type being processed when error occurred (if applicable) */
  artifactType?: SourceType;
}

/**
 * Statistics for a single artifact type
 */
export interface ArtifactStats {
  /** Number of files with this artifact type */
  filesWithArtifact: number;

  /** Number of confidence items extracted from this artifact */
  itemsExtracted: number;

  /** Number of items per status */
  statusCounts: {
    unverified: number;
    verified: number;
    rejected: number;
    deferred: number;
  };
}

/**
 * Parsed artifact section from a note
 */
export interface ParsedArtifactSection {
  /** Type of artifact this section represents */
  artifactType: SourceType;

  /** Path to the artifact note */
  artifactPath: string;

  /** Title of the artifact note */
  artifactTitle: string;

  /** Confidence items extracted from the section */
  items: ExtractedConfidenceItem[];
}

/**
 * Single confidence item extracted from an artifact section
 */
export interface ExtractedConfidenceItem {
  /** The item description (insight, question, task, claim, etc.) */
  description: string;

  /** Status of the item (inferred from formatting) */
  status: ConfidenceStatus;

  /** Entry ID within the artifact (if available) */
  entryId?: string;

  /** Line number where the item appears */
  lineNumber: number;

  /** Source URL or context for the item (optional) */
  sourceUrl?: string;

  /** Original confidence score from source (0-1), if available */
  confidenceScore?: number;
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
 * ### Unverified
 *
 * - React Server Components use RSC payload for hydration
 *
 * ### Verified
 *
 * - ~~Deprecated insight~~ (archived)
 * ```
 *
 * Items in the "Verified" section are considered VERIFIED.
 * Items marked with strikethrough (~~text~~) are considered ARCHIVED (REJECTED).
 * All other items are UNVERIFIED.
 *
 * @param content - Full markdown content of the artifact note
 * @param artifactPath - Path to the artifact note file
 * @returns Parsed artifact section, or null if not found
 */
export function parseKeyTakeawaysInbox(
  content: string,
  artifactPath: string
): ParsedArtifactSection | null {
  const lines = content.split("\n");

  // Find "## Key Takeaways Inbox" section
  let artifactStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Key\s+Takeaways\s+Inbox$/i.test(lines[i]!.trim())) {
      artifactStart = i;
      break;
    }
  }

  if (artifactStart === -1) {
    return null;
  }

  // Extract title from frontmatter or filename
  const frontmatter = parseFrontmatter(content);
  const artifactTitle = extractNoteTitle(frontmatter, artifactPath);

  // Extract source URL from frontmatter
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : undefined;

  // Find the end of the artifact section (next ## heading or EOF)
  let artifactEnd = lines.length;
  for (let i = artifactStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      artifactEnd = i;
      break;
    }
  }

  // Extract artifact content
  const artifactLines = lines.slice(artifactStart, artifactEnd);

  // Parse items from the artifact
  const items = parseConfidenceItemsFromArtifact(
    artifactLines,
    artifactStart,
    ContractSourceType.KEY_TAKEAWAYS,
    sourceUrl,
    ContractStatusSource.ARTIFACT
  );

  if (items.length === 0) {
    return null;
  }

  return {
    artifactType: ContractSourceType.KEY_TAKEAWAYS,
    artifactPath,
    artifactTitle,
    items,
  };
}

/**
 * Parse Open Questions Inbox section from markdown content
 *
 * The Open Questions Inbox is expected to be formatted similarly to Key Takeaways.
 *
 * @param content - Full markdown content of the artifact note
 * @param artifactPath - Path to the artifact note file
 * @returns Parsed artifact section, or null if not found
 */
export function parseOpenQuestionsInbox(
  content: string,
  artifactPath: string
): ParsedArtifactSection | null {
  const lines = content.split("\n");

  // Find "## Open Questions Inbox" section
  let artifactStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Open\s+Questions\s+Inbox$/i.test(lines[i]!.trim())) {
      artifactStart = i;
      break;
    }
  }

  if (artifactStart === -1) {
    return null;
  }

  // Extract title from frontmatter or filename
  const frontmatter = parseFrontmatter(content);
  const artifactTitle = extractNoteTitle(frontmatter, artifactPath);

  // Extract source URL from frontmatter
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : undefined;

  // Find the end of the artifact section
  let artifactEnd = lines.length;
  for (let i = artifactStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      artifactEnd = i;
      break;
    }
  }

  // Extract artifact content
  const artifactLines = lines.slice(artifactStart, artifactEnd);

  // Parse items from the artifact
  const items = parseConfidenceItemsFromArtifact(
    artifactLines,
    artifactStart,
    ContractSourceType.OPEN_QUESTIONS,
    sourceUrl,
    ContractStatusSource.ARTIFACT
  );

  if (items.length === 0) {
    return null;
  }

  return {
    artifactType: ContractSourceType.OPEN_QUESTIONS,
    artifactPath,
    artifactTitle,
    items,
  };
}

/**
 * Parse Contradiction Inbox section from markdown content
 *
 * @param content - Full markdown content of the artifact note
 * @param artifactPath - Path to the artifact note file
 * @returns Parsed artifact section, or null if not found
 */
export function parseContradictionInbox(
  content: string,
  artifactPath: string
): ParsedArtifactSection | null {
  const lines = content.split("\n");

  // Find "## Contradiction Inbox" section
  let artifactStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Contradiction\s+Inbox$/i.test(lines[i]!.trim())) {
      artifactStart = i;
      break;
    }
  }

  if (artifactStart === -1) {
    return null;
  }

  // Extract title from frontmatter or filename
  const frontmatter = parseFrontmatter(content);
  const artifactTitle = extractNoteTitle(frontmatter, artifactPath);

  // Extract source URL from frontmatter
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : undefined;

  // Find the end of the artifact section
  let artifactEnd = lines.length;
  for (let i = artifactStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      artifactEnd = i;
      break;
    }
  }

  // Extract artifact content
  const artifactLines = lines.slice(artifactStart, artifactEnd);

  // Parse items from the artifact
  const items = parseConfidenceItemsFromArtifact(
    artifactLines,
    artifactStart,
    ContractSourceType.CONTRADICTION,
    sourceUrl,
    ContractStatusSource.ARTIFACT
  );

  if (items.length === 0) {
    return null;
  }

  return {
    artifactType: ContractSourceType.CONTRADICTION,
    artifactPath,
    artifactTitle,
    items,
  };
}

/**
 * Parse Evidence Gap Inbox section from markdown content
 *
 * @param content - Full markdown content of the artifact note
 * @param artifactPath - Path to the artifact note file
 * @returns Parsed artifact section, or null if not found
 */
export function parseEvidenceGapInbox(
  content: string,
  artifactPath: string
): ParsedArtifactSection | null {
  const lines = content.split("\n");

  // Find "## Evidence Gap Inbox" section
  let artifactStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Evidence\s+Gap\s+Inbox$/i.test(lines[i]!.trim())) {
      artifactStart = i;
      break;
    }
  }

  if (artifactStart === -1) {
    return null;
  }

  // Extract title from frontmatter or filename
  const frontmatter = parseFrontmatter(content);
  const artifactTitle = extractNoteTitle(frontmatter, artifactPath);

  // Extract source URL from frontmatter
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : undefined;

  // Find the end of the artifact section
  let artifactEnd = lines.length;
  for (let i = artifactStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      artifactEnd = i;
      break;
    }
  }

  // Extract artifact content
  const artifactLines = lines.slice(artifactStart, artifactEnd);

  // Parse items from the artifact
  const items = parseConfidenceItemsFromArtifact(
    artifactLines,
    artifactStart,
    ContractSourceType.EVIDENCE_GAP,
    sourceUrl,
    ContractStatusSource.ARTIFACT
  );

  if (items.length === 0) {
    return null;
  }

  return {
    artifactType: ContractSourceType.EVIDENCE_GAP,
    artifactPath,
    artifactTitle,
    items,
  };
}

/**
 * Parse Knowledge Confidence Inbox section from markdown content
 *
 * This inbox may have manually set statuses via frontmatter metadata.
 *
 * @param content - Full markdown content of the artifact note
 * @param artifactPath - Path to the artifact note file
 * @returns Parsed artifact section, or null if not found
 */
export function parseKnowledgeConfidenceInbox(
  content: string,
  artifactPath: string
): ParsedArtifactSection | null {
  const lines = content.split("\n");

  // Find "## Knowledge Confidence Inbox" section
  let artifactStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Knowledge\s+Confidence\s+Inbox$/i.test(lines[i]!.trim())) {
      artifactStart = i;
      break;
    }
  }

  if (artifactStart === -1) {
    return null;
  }

  // Extract title from frontmatter or filename
  const frontmatter = parseFrontmatter(content);
  const artifactTitle = extractNoteTitle(frontmatter, artifactPath);

  // Extract source URL from frontmatter
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : undefined;

  // Knowledge Confidence items have MANUAL status source
  const statusSource = ContractStatusSource.MANUAL;

  // Find the end of the artifact section
  let artifactEnd = lines.length;
  for (let i = artifactStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      artifactEnd = i;
      break;
    }
  }

  // Extract artifact content
  const artifactLines = lines.slice(artifactStart, artifactEnd);

  // Parse items from the artifact with manual status source
  const items = parseConfidenceItemsFromArtifact(
    artifactLines,
    artifactStart,
    ContractSourceType.KNOWLEDGE_TRIAGE,
    sourceUrl,
    statusSource
  );

  if (items.length === 0) {
    return null;
  }

  return {
    artifactType: ContractSourceType.KNOWLEDGE_TRIAGE,
    artifactPath,
    artifactTitle,
    items,
  };
}

/**
 * Parse confidence items from artifact section content
 *
 * Handles multiple status subsections (Unverified, Verified, Rejected, Deferred).
 *
 * @param artifactLines - Lines of the artifact section
 * @param sectionOffset - Offset of the section in the original content
 * @param artifactType - Type of artifact being parsed
 * @param sourceUrl - Optional source URL
 * @param statusSource - Source of status values (default: ARTIFACT)
 * @returns Array of extracted confidence items
 */
function parseConfidenceItemsFromArtifact(
  artifactLines: string[],
  sectionOffset: number,
  artifactType: SourceType,
  sourceUrl: string | undefined,
  statusSource: StatusSource = ContractStatusSource.ARTIFACT
): ExtractedConfidenceItem[] {
  const items: ExtractedConfidenceItem[] = [];

  // Find status subsections
  const statusMappings: { [heading: string]: ConfidenceStatus } = {
    "Unverified": ContractConfidenceStatus.UNVERIFIED,
    "Verified": ContractConfidenceStatus.VERIFIED,
    "Rejected": ContractConfidenceStatus.REJECTED,
    "Deferred": ContractConfidenceStatus.DEFERRED,
  };

  let currentStatus: ConfidenceStatus | null = null;
  let currentSubsectionStart = -1;

  for (let i = 0; i < artifactLines.length; i++) {
    const line = artifactLines[i]!;
    const trimmed = line.trim();

    // Check for status subsection heading
    const statusMatch = trimmed.match(/^###\s+(Unverified|Verified|Rejected|Deferred)$/i);
    if (statusMatch) {
      // Flush previous subsection
      if (currentSubsectionStart >= 0 && currentStatus) {
        const subsectionLines = artifactLines.slice(currentSubsectionStart + 1, i);
        const subsectionItems = parseConfidenceItemsFromList(
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
    const subsectionLines = artifactLines.slice(currentSubsectionStart + 1);
    const subsectionItems = parseConfidenceItemsFromList(
      subsectionLines,
      sectionOffset + currentSubsectionStart + 1,
      currentStatus,
      statusSource,
      sourceUrl
    );
    items.push(...subsectionItems);
  }

  // If no status subsections found, treat all items as UNVERIFIED (default artifact format)
  if (currentStatus === null) {
    const defaultItems = parseConfidenceItemsFromList(
      artifactLines,
      sectionOffset,
      ContractConfidenceStatus.UNVERIFIED,
      statusSource,
      sourceUrl
    );
    items.push(...defaultItems);
  }

  return items;
}

/**
 * Parse confidence items from a list section
 *
 * @param lines - Lines of the list section
 * @param offset - Line number offset in original content
 * @param defaultStatus - Default status for items
 * @param statusSource - Source of status values
 * @param sourceUrl - Optional source URL
 * @returns Array of extracted confidence items
 */
function parseConfidenceItemsFromList(
  lines: string[],
  offset: number,
  defaultStatus: ConfidenceStatus,
  statusSource: StatusSource,
  sourceUrl: string | undefined
): ExtractedConfidenceItem[] {
  const items: ExtractedConfidenceItem[] = [];

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
        // Checked items are VERIFIED
        continue; // Skip verified items from confidence sync (they're already trusted)
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

    // Normalize: remove leading bullet markers, checkboxes
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

    // Extract confidence score from inline metadata if present
    // Format: Description <!-- confidence_score: 0.85 -->
    let confidenceScore: number | undefined;
    const scoreMatch = description.match(/^(.+?)\s*<!--\s*confidence_score:\s*([0-9.]+)\s*-->$/);
    if (scoreMatch) {
      confidenceScore = parseFloat(scoreMatch[2]!);
      if (!isNaN(confidenceScore)) {
        description = scoreMatch[1]!.trim();
      }
    }

    items.push({
      description,
      status: isArchived ? ContractConfidenceStatus.REJECTED : defaultStatus,
      entryId,
      lineNumber: offset + i,
      sourceUrl,
      confidenceScore,
    });
  }

  return items;
}

/**
 * Extract note title from frontmatter or filename
 *
 * @param frontmatter - Parsed frontmatter object
 * @param notePath - Path to note file
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
 * Convert ParsedArtifactSection to ConfidenceItemInput array
 *
 * @param artifactSection - Parsed artifact section
 * @returns Array of ConfidenceItemInput
 */
export function artifactSectionToInputs(artifactSection: ParsedArtifactSection): ConfidenceItemInput[] {
  const now = new Date().toISOString();

  return artifactSection.items.map((item) => ({
    description: item.description,
    sourceType: artifactSection.artifactType,
    artifactPath: artifactSection.artifactPath,
    artifactTitle: artifactSection.artifactTitle,
    entryId: item.entryId || generateEntryId(item.description, artifactSection.artifactType, item.lineNumber),
    sourceUrl: item.sourceUrl,
    firstSeenAt: now,
    lastSeenAt: now,
    status: item.status,
    statusSource: ContractStatusSource.ARTIFACT,
    statusChangedAt: now,
    confidenceScore: item.confidenceScore,
  }));
}

/**
 * Generate a stable entry ID for a confidence item
 *
 * @param description - Item description
 * @param artifactType - Type of artifact
 * @param lineNumber - Line number in artifact file
 * @returns Stable entry ID
 */
function generateEntryId(description: string, artifactType: SourceType, lineNumber: number): string {
  const normalized = description
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 50);

  return `${artifactType}-${normalized}-${lineNumber}`;
}

/**
 * Check if a file should be scanned based on filters
 *
 * @param filePath - Full path to file
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
 * Get artifact parser for a given artifact type
 *
 * @param artifactType - Type of artifact
 * @returns Parser function for the artifact type
 */
function getArtifactParser(artifactType: SourceType): (
  content: string,
  artifactPath: string
) => ParsedArtifactSection | null {
  switch (artifactType) {
    case ContractSourceType.KEY_TAKEAWAYS:
      return parseKeyTakeawaysInbox;
    case ContractSourceType.OPEN_QUESTIONS:
      return parseOpenQuestionsInbox;
    case ContractSourceType.CONTRADICTION:
      return parseContradictionInbox;
    case ContractSourceType.EVIDENCE_GAP:
      return parseEvidenceGapInbox;
    case ContractSourceType.KNOWLEDGE_TRIAGE:
      return parseKnowledgeConfidenceInbox;
    default:
      return () => null;
  }
}

/**
 * Scan vault for confidence items across all source artifacts
 *
 * This is the main entry point for extracting confidence items from vault notes.
 *
 * @param options - Scan options
 * @returns Scan result with extracted confidence items
 */
export async function scanVaultForConfidenceItems(
  options: ScanVaultOptions
): Promise<ScanVaultResult> {
  const result: ScanVaultResult = {
    confidenceItems: [],
    filesScanned: 0,
    filesWithConfidence: 0,
    filesSkipped: 0,
    errors: [],
    artifactStats: new Map(),
    options,
  };

  // Initialize stats for all artifact types
  const artifactTypesToScan = options.artifactTypes || [
    ContractSourceType.KEY_TAKEAWAYS,
    ContractSourceType.OPEN_QUESTIONS,
    ContractSourceType.CONTRADICTION,
    ContractSourceType.EVIDENCE_GAP,
    ContractSourceType.KNOWLEDGE_TRIAGE,
  ];

  for (const artifactType of artifactTypesToScan) {
    result.artifactStats.set(artifactType, {
      filesWithArtifact: 0,
      itemsExtracted: 0,
      statusCounts: {
        unverified: 0,
        verified: 0,
        rejected: 0,
        deferred: 0,
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

      // Try to parse each artifact type
      for (const artifactType of artifactTypesToScan) {
        try {
          const parser = getArtifactParser(artifactType);
          const artifactSection = parser(content, filePath);

          if (artifactSection) {
            result.filesWithConfidence++;

            // Convert to ConfidenceItemInput
            const inputs = artifactSectionToInputs(artifactSection);

            // Update stats
            const stats = result.artifactStats.get(artifactType)!;
            stats.filesWithArtifact++;
            stats.itemsExtracted += inputs.length;

            for (const input of inputs) {
              // Map enum values to property names
              const statusKey = input.status as keyof typeof stats.statusCounts;
              stats.statusCounts[statusKey]++;
            }

            // Add items to result
            result.confidenceItems.push(...inputs);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({
            filePath,
            error: errorMsg,
            errorType: "artifact_error",
            artifactType,
          });
        }
      }

      if (result.confidenceItems.length === 0) {
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

  // Sort items deterministically (by artifact type, then path, then description)
  result.confidenceItems.sort((a, b) => {
    if (a.sourceType !== b.sourceType) {
      return a.sourceType.localeCompare(b.sourceType);
    }
    if (a.artifactPath !== b.artifactPath) {
      return a.artifactPath.localeCompare(b.artifactPath);
    }
    return a.description.localeCompare(b.description);
  });

  return result;
}

/**
 * Build Confidence State Sync from vault scan
 *
 * This is a convenience function that combines scanning and building.
 *
 * @param options - Scan options
 * @returns Confidence State Sync
 */
export async function buildStateSyncFromVault(
  options: ScanVaultOptions
): Promise<ConfidenceStateSync> {
  // Scan vault for confidence items
  const scanResult = await scanVaultForConfidenceItems(options);

  // Build sync using contract utility
  const sync = buildConfidenceStateSync(scanResult.confidenceItems);

  return sync;
}

/**
 * Extract confidence items from a single note
 *
 * Convenience function for processing individual notes.
 *
 * @param content - Markdown content
 * @param notePath - Path to note
 * @param artifactTypes - Artifact types to extract from (default: all)
 * @returns Array of ConfidenceItemInput
 */
export function extractConfidenceItemsFromNote(
  content: string,
  notePath: string,
  artifactTypes?: SourceType[]
): ConfidenceItemInput[] {
  const allItems: ConfidenceItemInput[] = [];

  const typesToScan = artifactTypes || [
    ContractSourceType.KEY_TAKEAWAYS,
    ContractSourceType.OPEN_QUESTIONS,
    ContractSourceType.CONTRADICTION,
    ContractSourceType.EVIDENCE_GAP,
    ContractSourceType.KNOWLEDGE_TRIAGE,
  ];

  for (const artifactType of typesToScan) {
    try {
      const parser = getArtifactParser(artifactType);
      const artifactSection = parser(content, notePath);

      if (artifactSection) {
        const inputs = artifactSectionToInputs(artifactSection);
        allItems.push(...inputs);
      }
    } catch (error) {
      // Skip errors for single-note extraction
      console.error(`Error parsing ${artifactType} from ${notePath}:`, error);
    }
  }

  return allItems;
}

/**
 * Merge confidence items from multiple sources
 *
 * Takes an array of ConfidenceItemInput and uses the contract's
 * buildConfidenceStateSync function to merge duplicates and reconcile status.
 *
 * @param inputs - Array of confidence items from various artifacts
 * @returns Complete Confidence State Sync
 */
export function mergeConfidenceItems(inputs: ConfidenceItemInput[]): ConfidenceStateSync {
  return buildConfidenceStateSync(inputs);
}

/**
 * Normalize a confidence item description for comparison
 *
 * This is a convenience wrapper for cases where you only need
 * normalized text without a full fingerprint.
 *
 * @param description - The description to normalize
 * @returns Normalized description text
 */
export function normalizeConfidenceDescription(description: string): string {
  return description
    .toLowerCase()
    .trim()
    .replace(/^[-*]\s*/, "") // Remove leading bullet markers
    .replace(/^\[[ x]\]\s*/, "") // Remove checkbox markers
    .replace(/\s+/g, " ") // Collapse multiple whitespace
    .replace(/[.,!?;:]+$/, ""); // Remove trailing punctuation
}
