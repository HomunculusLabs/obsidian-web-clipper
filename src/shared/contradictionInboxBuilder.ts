/**
 * Contradiction Inbox Builder
 *
 * This module provides utilities for detecting contradictions between claims
 * extracted from Key Takeaways, Open Questions, and other knowledge surfaces.
 * It ingests existing takeaway + triage artifacts and emits stable conflict
 * entries with provenance linkbacks.
 *
 * Core Goals:
 * - Extract claims deterministically from knowledge surfaces
 * - Detect contradictions using deterministic pattern matching
 * - Build conflict entries with stable IDs and provenance
 * - Preserve source clip metadata for linkbacks
 * - Support bounded scanning and deterministic output
 */

import { promises as fs } from "fs";
import * as path from "path";

import type {
  ClaimInput,
  ConflictEntry,
  ContradictionInbox,
  ConflictClaim,
  ClaimFingerprint,
  SourceClipRef,
  ConflictStatus,
  ContradictionType,
} from "./contradictionInboxContract";
import {
  CONTRADICTION_INBOX_VERSION,
  MAX_CONFLICTS,
  MAX_CLAIMS_PER_CONFLICT,
  MAX_SOURCE_CLIP_REFS,
  MAX_CLAIM_LENGTH,
  MAX_CONFLICT_DESCRIPTION_LENGTH,
  ConflictStatus as ContractConflictStatus,
  ContradictionType as ContractContradictionType,
  ClaimSource as ContractClaimSource,
  computeClaimFingerprint,
  detectContradictionType,
  sortEntriesDeterministically,
  computeConflictScore,
  buildConflictClaim,
  generateConflictDescription,
  truncateClaim,
  truncateDescription,
  buildSourceClipRefs,
} from "./contradictionInboxContract";

/**
 * Options for scanning vault notes for claims
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

  /** Specific claim sources to scan (default: all sources) */
  claimSources?: ContractClaimSource[];
}

/**
 * Result of scanning vault for claims
 */
export interface ScanVaultResult {
  /** Extracted claims from all sources */
  claims: ClaimInput[];

  /** Total markdown files scanned */
  filesScanned: number;

  /** Files with claim content */
  filesWithClaims: number;

  /** Files skipped (no content, parse errors, or out of scope) */
  filesSkipped: number;

  /** Errors encountered during scanning */
  errors: ScanError[];

  /** Per-source statistics */
  sourceStats: Map<ContractClaimSource, SourceStats>;

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
  errorType: "read_error" | "parse_error" | "frontmatter_error" | "claim_error";

  /** Claim source being processed when error occurred (if applicable) */
  claimSource?: ContractClaimSource;
}

/**
 * Statistics for a single claim source
 */
export interface SourceStats {
  /** Number of files with this source type */
  filesWithSource: number;

  /** Number of claims extracted from this source */
  claimsExtracted: number;
}

/**
 * Parsed claim section from a note
 */
export interface ParsedClaimSection {
  /** Type of source this section represents */
  source: ContractClaimSource;

  /** Path to the source note */
  sourcePath: string;

  /** Title of the source note */
  sourceTitle: string;

  /** Source URL of the note (if available) */
  sourceUrl?: string;

  /** Claims extracted from the section */
  claims: ExtractedClaim[];
}

/**
 * Single claim extracted from a source
 */
export interface ExtractedClaim {
  /** The claim text */
  claim: string;

  /** Entry ID within the source (if available) */
  entryId?: string;

  /** Line number where the claim appears */
  lineNumber: number;

  /** Timestamp when the claim was captured */
  timestamp: string;
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
 * Parse Key Takeaways Inbox for claims
 *
 * Extracts claims from the Key Takeaways Inbox note.
 * Each key takeaway is treated as a claim.
 *
 * @param content - Full markdown content of the inbox note
 * @param inboxPath - Path to the inbox note file
 * @returns Parsed claim section, or null if not found
 */
export function parseKeyTakeawaysInboxForClaims(
  content: string,
  inboxPath: string
): ParsedClaimSection | null {
  const lines = content.split("\n");

  // Find "## Key Takeaways" or "## Key Takeaways Inbox" section
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (/^##\s+Key\s+Takeaways/i.test(line)) {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart === -1) {
    return null;
  }

  // Extract metadata from frontmatter
  const frontmatter = parseFrontmatter(content);
  const inboxTitle = extractNoteTitle(frontmatter, inboxPath);
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : undefined;
  const generatedAt = typeof frontmatter?.generated_at === "string" ? frontmatter.generated_at : new Date().toISOString();

  // Find the end of the section (next ## heading or EOF)
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      sectionEnd = i;
      break;
    }
  }

  // Extract section content
  const sectionLines = lines.slice(sectionStart, sectionEnd);

  // Parse claims from the section
  const claims = parseClaimsFromInboxSection(sectionLines, sectionStart, generatedAt);

  if (claims.length === 0) {
    return null;
  }

  return {
    source: ContractClaimSource.KEY_TAKEAWAYS,
    sourcePath: inboxPath,
    sourceTitle: inboxTitle,
    sourceUrl,
    claims,
  };
}

/**
 * Parse Open Questions Inbox for claims
 *
 * Extracts claims from the Open Questions Inbox note.
 * Questions are converted to claims (e.g., "What is X?" -> "X is unknown").
 *
 * @param content - Full markdown content of the inbox note
 * @param inboxPath - Path to the inbox note file
 * @returns Parsed claim section, or null if not found
 */
export function parseOpenQuestionsInboxForClaims(
  content: string,
  inboxPath: string
): ParsedClaimSection | null {
  const lines = content.split("\n");

  // Find "## Open Questions" or "## Open Questions Inbox" section
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (/^##\s+Open\s+Questions/i.test(line)) {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart === -1) {
    return null;
  }

  // Extract metadata from frontmatter
  const frontmatter = parseFrontmatter(content);
  const inboxTitle = extractNoteTitle(frontmatter, inboxPath);
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : undefined;
  const generatedAt = typeof frontmatter?.generated_at === "string" ? frontmatter.generated_at : new Date().toISOString();

  // Find the end of the section
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      sectionEnd = i;
      break;
    }
  }

  // Extract section content
  const sectionLines = lines.slice(sectionStart, sectionEnd);

  // Parse claims from the section
  const claims = parseClaimsFromInboxSection(sectionLines, sectionStart, generatedAt);

  if (claims.length === 0) {
    return null;
  }

  return {
    source: ContractClaimSource.OPEN_QUESTIONS,
    sourcePath: inboxPath,
    sourceTitle: inboxTitle,
    sourceUrl,
    claims,
  };
}

/**
 * Parse Clip Brief section from a note for claims
 *
 * Extracts claims from the "## Clip Brief" section's Key Takeaways.
 *
 * @param content - Full markdown content of the note
 * @param notePath - Path to the note file
 * @returns Parsed claim section, or null if not found
 */
export function parseClipBriefForClaims(
  content: string,
  notePath: string
): ParsedClaimSection | null {
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
    return null;
  }

  // Extract metadata
  const frontmatter = parseFrontmatter(content);
  const noteTitle = extractNoteTitle(frontmatter, notePath);
  const sourceUrl = typeof frontmatter?.source === "string" ? frontmatter.source : undefined;
  const timestamp = typeof frontmatter?.date_clipped === "string"
    ? frontmatter.date_clipped
    : new Date().toISOString();

  // Find the end of the Clip Brief section
  let clipBriefEnd = lines.length;
  for (let i = clipBriefStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      clipBriefEnd = i;
      break;
    }
  }

  // Extract Clip Brief content
  const clipBriefLines = lines.slice(clipBriefStart, clipBriefEnd);

  // Find "### Key Takeaways" subsection
  let keyTakeawaysStart = -1;
  for (let i = 0; i < clipBriefLines.length; i++) {
    if (/^###\s+Key\s+Takeaways$/i.test(clipBriefLines[i]!.trim())) {
      keyTakeawaysStart = i;
      break;
    }
  }

  if (keyTakeawaysStart === -1) {
    return null;
  }

  // Extract Key Takeaways content
  let keyTakeawaysEnd = clipBriefLines.length;
  for (let i = keyTakeawaysStart + 1; i < clipBriefLines.length; i++) {
    if (/^###\s+/.test(clipBriefLines[i]!.trim())) {
      keyTakeawaysEnd = i;
      break;
    }
  }

  // Parse claims from list items
  const insightLines = clipBriefLines.slice(keyTakeawaysStart + 1, keyTakeawaysEnd);
  const claims: ExtractedClaim[] = [];

  for (let i = 0; i < insightLines.length; i++) {
    const line = insightLines[i]!;
    const trimmed = line.trim();

    // Skip empty lines and non-list items
    if (!trimmed || !trimmed.startsWith("-")) {
      continue;
    }

    // Extract claim text
    let claimText = trimmed.slice(1).trim();

    // Skip empty claims
    if (!claimText) {
      continue;
    }

    // Check if archived (marked with strikethrough) - skip archived claims
    if (/^~~.*~~$/.test(claimText)) {
      continue;
    }

    // Clean the claim text
    claimText = claimText
      .replace(/^[-*]\s*/, "")
      .replace(/^\[[ x]\]\s*/, "")
      .trim();

    if (!claimText) {
      continue;
    }

    claims.push({
      claim: claimText,
      lineNumber: clipBriefStart + keyTakeawaysStart + 1 + i,
      timestamp,
    });
  }

  if (claims.length === 0) {
    return null;
  }

  return {
    source: ContractClaimSource.CLIP_NOTE,
    sourcePath: notePath,
    sourceTitle: noteTitle,
    sourceUrl,
    claims,
  };
}

/**
 * Parse claims from an inbox section
 *
 * @param sectionLines - Lines of the inbox section
 * @param sectionOffset - Offset of the section in the original content
 * @param defaultTimestamp - Default timestamp for claims
 * @returns Array of extracted claims
 */
function parseClaimsFromInboxSection(
  sectionLines: string[],
  sectionOffset: number,
  defaultTimestamp: string
): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];

  for (let i = 0; i < sectionLines.length; i++) {
    const line = sectionLines[i]!;
    const trimmed = line.trim();

    // Skip empty lines and non-list items
    if (!trimmed || !trimmed.startsWith("-")) {
      continue;
    }

    // Skip section headings
    if (/^###/.test(trimmed)) {
      continue;
    }

    // Extract claim text
    let claimText = trimmed.slice(1).trim();

    // Skip empty claims
    if (!claimText) {
      continue;
    }

    // Skip archived/strikethrough items
    if (/^~~.*~~$/.test(claimText)) {
      continue;
    }

    // Clean the claim text
    claimText = claimText
      .replace(/^\[[ x]\]\s*/, "")
      .trim();

    // Extract entry ID from inline metadata if present
    // Format: Claim text <!-- entry_id: abc123 -->
    const entryIdMatch = claimText.match(/^(.+?)\s*<!--\s*entry_id:\s*([a-zA-Z0-9_-]+)\s*-->$/);
    let entryId: string | undefined;
    if (entryIdMatch) {
      entryId = entryIdMatch[2];
      claimText = entryIdMatch[1]!.trim();
    }

    if (!claimText) {
      continue;
    }

    claims.push({
      claim: claimText,
      entryId,
      lineNumber: sectionOffset + i,
      timestamp: defaultTimestamp,
    });
  }

  return claims;
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
 * Convert ParsedClaimSection to ClaimInput array
 *
 * @param section - Parsed claim section
 * @returns Array of ClaimInput
 */
export function claimSectionToInputs(section: ParsedClaimSection): ClaimInput[] {
  return section.claims.map((claim) => ({
    claim: claim.claim,
    source: section.source,
    sourcePath: section.sourcePath,
    sourceTitle: section.sourceTitle,
    entryId: claim.entryId || generateEntryId(claim.claim, section.source, claim.lineNumber),
    sourceUrl: section.sourceUrl,
    timestamp: claim.timestamp,
    sourceId: section.sourcePath,
  }));
}

/**
 * Generate a stable entry ID for a claim
 *
 * @param claim - Claim text
 * @param source - Claim source
 * @param lineNumber - Line number in the source file
 * @returns Stable entry ID
 */
function generateEntryId(claim: string, source: ContractClaimSource, lineNumber: number): string {
  const normalized = claim
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);

  return `${source}-${normalized}-${lineNumber}`;
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
 * Get claim parser for a given claim source
 *
 * @param source - Type of claim source
 * @returns Parser function for the source type
 */
function getClaimParser(source: ContractClaimSource): (
  content: string,
  filePath: string
) => ParsedClaimSection | null {
  switch (source) {
    case ContractClaimSource.KEY_TAKEAWAYS:
      return parseKeyTakeawaysInboxForClaims;
    case ContractClaimSource.OPEN_QUESTIONS:
      return parseOpenQuestionsInboxForClaims;
    case ContractClaimSource.CLIP_NOTE:
      return parseClipBriefForClaims;
    case ContractClaimSource.MANUAL:
      // Manual claims are not parsed from files
      return () => null;
    default:
      return () => null;
  }
}

/**
 * Scan vault for claims across all sources
 *
 * This is the main entry point for extracting claims from vault notes.
 *
 * @param options - Scan options
 * @returns Scan result with extracted claims
 */
export async function scanVaultForClaims(
  options: ScanVaultOptions
): Promise<ScanVaultResult> {
  const result: ScanVaultResult = {
    claims: [],
    filesScanned: 0,
    filesWithClaims: 0,
    filesSkipped: 0,
    errors: [],
    sourceStats: new Map(),
    options,
  };

  // Initialize stats for all claim sources
  const sourcesToScan = options.claimSources || [
    ContractClaimSource.KEY_TAKEAWAYS,
    ContractClaimSource.OPEN_QUESTIONS,
    ContractClaimSource.CLIP_NOTE,
  ];

  for (const source of sourcesToScan) {
    result.sourceStats.set(source, {
      filesWithSource: 0,
      claimsExtracted: 0,
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

      // Try to parse each claim source
      for (const source of sourcesToScan) {
        try {
          const parser = getClaimParser(source);
          const section = parser(content, filePath);

          if (section) {
            result.filesWithClaims++;

            // Convert to ClaimInput
            const inputs = claimSectionToInputs(section);

            // Update stats
            const stats = result.sourceStats.get(source)!;
            stats.filesWithSource++;
            stats.claimsExtracted += inputs.length;

            // Add claims to result
            result.claims.push(...inputs);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({
            filePath,
            error: errorMsg,
            errorType: "claim_error",
            claimSource: source,
          });
        }
      }

      if (result.claims.length === 0) {
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

  // Sort claims deterministically (by source, then path, then claim text)
  result.claims.sort((a, b) => {
    if (a.source !== b.source) {
      return a.source.localeCompare(b.source);
    }
    if (a.sourcePath !== b.sourcePath) {
      return a.sourcePath.localeCompare(b.sourcePath);
    }
    return a.claim.localeCompare(b.claim);
  });

  return result;
}

/**
 * Build conflict entries from claims
 *
 * Detects contradictions between all claim pairs and groups them into
 * conflict clusters.
 *
 * @param claims - All claims to analyze
 * @returns Array of conflict entries
 */
export function buildConflictEntries(claims: ClaimInput[]): ConflictEntry[] {
  // Deduplicate claims by fingerprint
  const claimGroups = new Map<string, ClaimInput[]>();
  const claimFingerprints = new Map<string, ClaimFingerprint>();

  for (const claim of claims) {
    const fingerprint = computeClaimFingerprint(claim.claim);
    const key = fingerprint.hash;

    claimFingerprints.set(key, fingerprint);

    if (!claimGroups.has(key)) {
      claimGroups.set(key, []);
    }
    claimGroups.get(key)!.push(claim);
  }

  // Get unique claim hashes
  const uniqueClaimHashes = Array.from(claimGroups.keys()).sort();

  // Detect contradictions between all pairs
  const contradictions: Array<{
    hashA: string;
    hashB: string;
    type: ContradictionType;
    confidence: number;
  }> = [];

  for (let i = 0; i < uniqueClaimHashes.length; i++) {
    for (let j = i + 1; j < uniqueClaimHashes.length; j++) {
      const hashA = uniqueClaimHashes[i]!;
      const hashB = uniqueClaimHashes[j]!;

      const fpA = claimFingerprints.get(hashA)!;
      const fpB = claimFingerprints.get(hashB)!;

      const result = detectContradictionType(fpA, fpB);

      if (result.confidence >= 0.6) {
        contradictions.push({
          hashA,
          hashB,
          type: result.type,
          confidence: result.confidence,
        });
      }
    }
  }

  // Group contradictions into conflict clusters
  const conflictClusters = groupContradictionsIntoClusters(contradictions);

  // Build conflict entries from clusters
  const entries: ConflictEntry[] = [];
  const now = new Date().toISOString();

  for (const cluster of conflictClusters) {
    // Build conflict claims from cluster hashes
    const conflictClaims: ConflictClaim[] = [];

    for (const hash of cluster.claimHashes) {
      const claimInputs = claimGroups.get(hash)!;
      const fingerprint = claimFingerprints.get(hash)!;

      // Use the normalized claim text from the first input
      const normalizedClaim = fingerprint.normalizedClaim;

      const conflictClaim = buildConflictClaim(claimInputs, normalizedClaim);
      conflictClaims.push(conflictClaim);
    }

    // Sort claims by timestamp (most recent first)
    conflictClaims.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Truncate claims if needed
    const totalClaims = conflictClaims.length;
    const claimsTruncated = totalClaims > MAX_CLAIMS_PER_CONFLICT;
    const trimmedClaims = conflictClaims.slice(0, MAX_CLAIMS_PER_CONFLICT);

    // Compute conflict ID from sorted claim IDs
    const sortedClaimIds = trimmedClaims.map(c => c.claim_id).sort();
    const conflict_id = computeDeterministicHash(sortedClaimIds.join("|"));

    // Determine the primary contradiction type (use the most confident)
    const primaryContradiction = cluster.contradictions.sort((a, b) => b.confidence - a.confidence)[0]!;

    // Generate description
    const description = generateConflictDescription(trimmedClaims, primaryContradiction.type);
    const { truncated: descTruncated, wasTruncated: descWasTruncated } = truncateDescription(description);

    // Get most recent timestamp
    const mostRecentTimestamp = trimmedClaims[0]?.timestamp || now;

    // Build entry
    const entry: ConflictEntry = {
      conflict_id,
      description: descTruncated,
      description_truncated: descWasTruncated,
      contradiction_type: primaryContradiction.type,
      claims: trimmedClaims,
      total_claims: totalClaims,
      claims_truncated: claimsTruncated,
      status: ContractConflictStatus.OPEN,
      score: 0, // Computed later
      timestamp: mostRecentTimestamp,
      first_detected_at: now,
      status_changed_at: now,
    };

    // Compute score
    entry.score = computeConflictScore(entry);

    entries.push(entry);
  }

  return entries;
}

/**
 * Compute a deterministic hash from a string
 *
 * @param str - The string to hash
 * @returns 64-character hex string
 */
function computeDeterministicHash(str: string): string {
  // Use four 64-bit FNV-1a hashes in parallel to get 256 bits
  const primes = [0x100000001b3n, 0xcbf29ce484222325n, 0x100000001b3n, 0xcbf29ce484222325n];
  const offsets = [0x811c9dc5n, 0xcbf29ce484222325n, 0x811c9dc5n, 0xcbf29ce484222625n];
  const masks = [0xffffffffffffffffn, 0xffffffffffffffffn, 0xffffffffffffffffn, 0xffffffffffffffffn];

  const chunks: string[] = [];

  for (let i = 0; i < 4; i++) {
    let hash = offsets[i];
    const prime = primes[i];
    const mask = masks[i];

    for (let j = 0; j < str.length; j++) {
      const code = BigInt(str.charCodeAt(j));
      hash = (hash ^ code) & mask;
      hash = (hash * prime) & mask;
    }

    // Convert to 16-char hex string (64-bit -> 16 hex chars)
    const hex = hash.toString(16).padStart(16, "0").slice(-16);
    chunks.push(hex);
  }

  return chunks.join("");
}

/**
 * Group contradictions into conflict clusters
 *
 * A conflict cluster is a group of claims where each claim contradicts
 * at least one other claim in the cluster.
 *
 * @param contradictions - Array of detected contradictions
 * @returns Array of conflict clusters
 */
function groupContradictionsIntoClusters(
  contradictions: Array<{
    hashA: string;
    hashB: string;
    type: ContradictionType;
    confidence: number;
  }>
): Array<{
  claimHashes: string[];
  contradictions: Array<{ type: ContradictionType; confidence: number }>;
}> {
  if (contradictions.length === 0) {
    return [];
  }

  // Build adjacency list
  const adjacency = new Map<string, Set<string>>();
  const contradictionMap = new Map<string, Array<{ type: ContradictionType; confidence: number }>>();

  for (const { hashA, hashB, type, confidence } of contradictions) {
    if (!adjacency.has(hashA)) {
      adjacency.set(hashA, new Set());
      contradictionMap.set(hashA, []);
    }
    if (!adjacency.has(hashB)) {
      adjacency.set(hashB, new Set());
      contradictionMap.set(hashB, []);
    }

    adjacency.get(hashA)!.add(hashB);
    adjacency.get(hashB)!.add(hashA);

    const key = hashA < hashB ? `${hashA}|${hashB}` : `${hashB}|${hashA}`;
    if (!contradictionMap.has(key)) {
      contradictionMap.set(key, []);
    }
    contradictionMap.get(key)!.push({ type, confidence });
  }

  // Find connected components using BFS
  const visited = new Set<string>();
  const clusters: Array<{
    claimHashes: string[];
    contradictions: Array<{ type: ContradictionType; confidence: number }>;
  }> = [];

  for (const startNode of adjacency.keys()) {
    if (visited.has(startNode)) {
      continue;
    }

    // BFS to find all connected nodes
    const component: string[] = [];
    const queue = [startNode];
    visited.add(startNode);

    while (queue.length > 0) {
      const node = queue.shift()!;
      component.push(node);

      for (const neighbor of adjacency.get(node)!) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    // Collect all contradictions in this component
    const componentContradictions: Array<{ type: ContradictionType; confidence: number }> = [];
    const processedPairs = new Set<string>();

    for (let i = 0; i < component.length; i++) {
      for (let j = i + 1; j < component.length; j++) {
        const hashA = component[i]!;
        const hashB = component[j]!;
        const key = hashA < hashB ? `${hashA}|${hashB}` : `${hashB}|${hashA}`;

        if (processedPairs.has(key)) {
          continue;
        }
        processedPairs.add(key);

        const contradictionsForPair = contradictionMap.get(key);
        if (contradictionsForPair) {
          componentContradictions.push(...contradictionsForPair);
        }
      }
    }

    // Sort component hashes deterministically
    component.sort();

    clusters.push({
      claimHashes: component,
      contradictions: componentContradictions,
    });
  }

  return clusters;
}

/**
 * Build the complete Contradiction Inbox
 *
 * This is the main entry point for inbox generation.
 *
 * @param claims - All claims extracted from knowledge surfaces
 * @returns The complete inbox with metadata
 */
export function buildContradictionInbox(claims: ClaimInput[]): ContradictionInbox {
  const now = new Date().toISOString();

  // Build conflict entries
  let entries = buildConflictEntries(claims);

  // Count conflicts by status (all are OPEN at this stage)
  const openConflicts = entries.length;
  const resolvedConflicts = 0;
  const falsePositiveConflicts = 0;

  // Sort entries deterministically by score
  entries = sortEntriesDeterministically(entries);

  // Truncate to max conflicts
  const truncated = entries.length > MAX_CONFLICTS;
  const trimmedEntries = entries.slice(0, MAX_CONFLICTS);

  // Compute unique clips count
  const uniqueClips = new Set(claims.map((c) => c.sourceId));

  // Compute unique claims count
  const uniqueClaims = new Set(claims.map((c) => computeClaimFingerprint(c.claim).hash));

  // Build result
  const inbox: ContradictionInbox = {
    entries: trimmedEntries,
    totalClaims: uniqueClaims.size,
    totalConflicts: entries.length,
    openConflicts,
    resolvedConflicts,
    falsePositiveConflicts,
    totalClips: uniqueClips.size,
    truncated,
    inbox_version: CONTRADICTION_INBOX_VERSION,
    generated_at: now,
  };

  return inbox;
}

/**
 * Build Contradiction Inbox from vault scan
 *
 * This is a convenience function that combines scanning and building.
 *
 * @param options - Scan options
 * @returns Contradiction Inbox
 */
export async function buildInboxFromVault(
  options: ScanVaultOptions
): Promise<ContradictionInbox> {
  // Scan vault for claims
  const scanResult = await scanVaultForClaims(options);

  // Build inbox using contract utility
  const inbox = buildContradictionInbox(scanResult.claims);

  return inbox;
}

/**
 * Extract claims from a single note
 *
 * Convenience function for processing individual notes.
 *
 * @param content - Markdown content
 * @param notePath - Path to the note
 * @param claimSources - Claim sources to extract from (default: all)
 * @returns Array of ClaimInput
 */
export function extractClaimsFromNote(
  content: string,
  notePath: string,
  claimSources?: ContractClaimSource[]
): ClaimInput[] {
  const allClaims: ClaimInput[] = [];

  const sourcesToScan = claimSources || [
    ContractClaimSource.KEY_TAKEAWAYS,
    ContractClaimSource.OPEN_QUESTIONS,
    ContractClaimSource.CLIP_NOTE,
  ];

  for (const source of sourcesToScan) {
    try {
      const parser = getClaimParser(source);
      const section = parser(content, notePath);

      if (section) {
        const inputs = claimSectionToInputs(section);
        allClaims.push(...inputs);
      }
    } catch (error) {
      // Skip errors for single-note extraction
      console.error(`Error parsing ${source} from ${notePath}:`, error);
    }
  }

  return allClaims;
}

/**
 * Normalize a claim for comparison
 *
 * This is a convenience wrapper around computeClaimFingerprint
 * for cases where you only need the normalized text.
 *
 * @param claim - The claim text to normalize
 * @returns Normalized claim text
 */
export function normalizeClaim(claim: string): string {
  return computeClaimFingerprint(claim).normalizedClaim;
}

/**
 * Merge duplicate claims from multiple sources
 *
 * Takes an array of ClaimInput and merges duplicates based on
 * normalized claim text, preserving all source clip references.
 *
 * @param inputs - Array of claims from various sources
 * @returns Map of normalized claim to ClaimInput array
 */
export function mergeDuplicateClaims(
  inputs: ClaimInput[]
): Map<string, ClaimInput[]> {
  const merged = new Map<string, ClaimInput[]>();

  for (const input of inputs) {
    // Compute fingerprint for deduplication
    const normalizedClaim = normalizeClaim(input.claim);
    const key = normalizedClaim;

    if (!merged.has(key)) {
      merged.set(key, []);
    }

    merged.get(key)!.push(input);
  }

  return merged;
}
