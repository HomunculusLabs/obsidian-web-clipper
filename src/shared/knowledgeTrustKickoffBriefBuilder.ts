/**
 * Knowledge Trust Kickoff Brief Builder
 *
 * This module provides utilities for extracting trust items from:
 * - knowledge-trust-dashboard.md
 * - knowledge-trust-dashboard-state-sync.md
 * - knowledge-trust-dashboard-history.ndjson
 *
 * It merges unresolved entries with state-sync/history context and emits
 * stable `recommended_next_action` output for the kickoff brief.
 *
 * Core Goals:
 * - Extract trust items deterministically from source artifacts
 * - Merge dashboard, state-sync, and history contexts
 * - Preserve source metadata for linkbacks
 * - Handle malformed sections gracefully
 * - Support bounded scanning (time window, file limits)
 */

import { promises as fs } from "fs";
import * as path from "path";

import type {
  TrustItemInput,
  TrustSourceType,
} from "./knowledgeTrustKickoffBriefContract";
import {
  RiskBand,
  TrustItemType,
  BriefItemStatus,
  TrustSourceType as ContractTrustSourceType,
  buildKnowledgeTrustKickoffBrief,
  KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
} from "./knowledgeTrustKickoffBriefContract";

/**
 * Options for scanning vault for trust items
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

  /** File extensions to process (default: .md, .ndjson) */
  extensions?: string[];

  /** Specific trust sources to scan (default: all sources) */
  trustSources?: TrustSourceType[];
}

/**
 * Result of scanning vault for trust items
 */
export interface ScanVaultResult {
  /** Extracted trust items from all sources */
  trustItems: TrustItemInput[];

  /** Total files scanned */
  filesScanned: number;

  /** Files with trust content */
  filesWithTrust: number;

  /** Files skipped (no content, parse errors, or out of scope) */
  filesSkipped: number;

  /** Errors encountered during scanning */
  errors: ScanError[];

  /** Per-source statistics */
  sourceStats: Map<TrustSourceType, SourceStats>;

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
  errorType: "read_error" | "parse_error" | "frontmatter_error" | "trust_error";

  /** Trust source being processed when error occurred (if applicable) */
  trustSource?: TrustSourceType;
}

/**
 * Statistics for a single trust source
 */
export interface SourceStats {
  /** Number of files with this source type */
  filesWithSource: number;

  /** Number of trust items extracted from this source */
  itemsExtracted: number;

  /** Number of items per risk band */
  riskBandCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };

  /** Number of items per status */
  statusCounts: {
    active: number;
    inProgress: number;
    resolved: number;
    dismissed: number;
  };
}

/**
 * Parsed trust dashboard section from a note
 */
export interface ParsedTrustDashboard {
  /** Path to the dashboard note */
  dashboardPath: string;

  /** Title of the dashboard note */
  dashboardTitle: string;

  /** Trust items extracted from the dashboard */
  items: ExtractedTrustItem[];
}

/**
 * Single trust item extracted from a source
 */
export interface ExtractedTrustItem {
  /** The item identifier */
  dashboard_item_id: string;

  /** Type of trust item */
  item_type: TrustItemType;

  /** Human-readable description */
  description: string;

  /** Risk band for prioritization */
  risk_band: RiskBand;

  /** Current status */
  status: BriefItemStatus;

  /** Timestamp when first detected */
  first_detected_at: string;

  /** Timestamp when last updated */
  last_updated_at: string;

  /** Optional: Related clip paths */
  related_clip_paths?: string[];

  /** Optional: Additional context */
  context?: Record<string, unknown>;
}

/**
 * History entry from ndjson file
 */
export interface HistoryEntry {
  /** Entry ID */
  history_item_id: string;

  /** Reference to dashboard item */
  dashboard_item_id: string;

  /** Type of trust item */
  item_type: TrustItemType;

  /** Risk band */
  risk_band: RiskBand;

  /** Description */
  description: string;

  /** Status at time of history entry */
  status: BriefItemStatus;

  /** Event type (created, updated, resolved, etc.) */
  event_type: string;

  /** Timestamp */
  timestamp: string;

  /** Optional: Related clip paths */
  related_clip_paths?: string[];

  /** Optional: Context */
  context?: Record<string, unknown>;
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
 * Parse knowledge-trust-dashboard.md for trust items
 *
 * Expected format:
 * ```markdown
 * ---
 * dashboard_version: 1.0.0
 * generated_at: 2026-03-04T10:00:00.000Z
 * ---
 *
 * # Knowledge Trust Dashboard
 *
 * ## Active Items
 *
 * ### [CRITICAL] Item ID
 *
 * **Type:** contradiction
 * **Description:** Description text
 * **Status:** active
 * **First detected:** 2026-03-01
 * **Last updated:** 2026-03-04
 *
 * ---
 * ```
 *
 * @param content - Full markdown content of the dashboard note
 * @param dashboardPath - Path to the dashboard note file
 * @returns Parsed dashboard, or null if not found
 */
export function parseKnowledgeTrustDashboard(
  content: string,
  dashboardPath: string
): ParsedTrustDashboard | null {
  const lines = content.split("\n");

  // Find "# Knowledge Trust Dashboard" or similar heading
  let dashboardStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (/^#\s+Knowledge\s+Trust\s+Dashboard/i.test(line) ||
        /^##\s+Trust\s+Dashboard/i.test(line)) {
      dashboardStart = i;
      break;
    }
  }

  if (dashboardStart === -1) {
    // Try to find any trust dashboard section (must be a heading)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (/^##?\s+.*trust.*dashboard/i.test(line)) {
        dashboardStart = i;
        break;
      }
    }
  }

  if (dashboardStart === -1) {
    return null;
  }

  // Extract metadata from frontmatter
  const frontmatter = parseFrontmatter(content);
  const dashboardTitle = extractNoteTitle(frontmatter, dashboardPath);

  // Find the end of the dashboard section (next # heading or EOF)
  let dashboardEnd = lines.length;
  for (let i = dashboardStart + 1; i < lines.length; i++) {
    if (/^#\s+/.test(lines[i]!.trim())) {
      dashboardEnd = i;
      break;
    }
  }

  // Extract dashboard content
  const dashboardLines = lines.slice(dashboardStart, dashboardEnd);

  // Parse items from the dashboard
  const items = parseTrustItemsFromDashboard(dashboardLines, dashboardStart);

  if (items.length === 0) {
    // Return empty dashboard if no items found (still valid)
    return {
      dashboardPath,
      dashboardTitle,
      items: [],
    };
  }

  return {
    dashboardPath,
    dashboardTitle,
    items,
  };
}

/**
 * Parse knowledge-trust-dashboard-state-sync.md for trust items
 *
 * Similar format to dashboard but with sync-specific metadata.
 *
 * @param content - Full markdown content of the state sync note
 * @param syncPath - Path to the state sync note file
 * @returns Parsed dashboard (using same structure), or null if not found
 */
export function parseKnowledgeTrustStateSync(
  content: string,
  syncPath: string
): ParsedTrustDashboard | null {
  const lines = content.split("\n");

  // Find state sync section (must be a heading, not inside frontmatter)
  let syncStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    // Only match actual markdown headings (# or ##), not random text containing the words
    if (/^#\s+Knowledge\s+Trust.*State\s+Sync/i.test(line) ||
        /^##\s+State\s+Sync/i.test(line) ||
        /^##?\s+.*Trust.*State.*Sync/i.test(line)) {
      syncStart = i;
      break;
    }
  }

  if (syncStart === -1) {
    return null;
  }

  // Extract metadata from frontmatter
  const frontmatter = parseFrontmatter(content);
  const syncTitle = extractNoteTitle(frontmatter, syncPath);

  // Find the end of the section
  let syncEnd = lines.length;
  for (let i = syncStart + 1; i < lines.length; i++) {
    if (/^#\s+/.test(lines[i]!.trim())) {
      syncEnd = i;
      break;
    }
  }

  // Extract content
  const syncLines = lines.slice(syncStart, syncEnd);

  // Parse items (same format as dashboard)
  const items = parseTrustItemsFromDashboard(syncLines, syncStart);

  return {
    dashboardPath: syncPath,
    dashboardTitle: syncTitle,
    items,
  };
}

/**
 * Parse trust items from dashboard content
 *
 * @param dashboardLines - Lines of the dashboard section
 * @param sectionOffset - Offset of the section in the original content
 * @returns Array of extracted trust items
 */
function parseTrustItemsFromDashboard(
  dashboardLines: string[],
  sectionOffset: number
): ExtractedTrustItem[] {
  const items: ExtractedTrustItem[] = [];
  const lines = dashboardLines;

  let currentItem: Partial<ExtractedTrustItem> | null = null;
  let inItemSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Look for item headers: ### [RISK_BAND] Item ID or similar
    const itemHeaderMatch = trimmed.match(/^###\s*\[?(CRITICAL|HIGH|MEDIUM|LOW)\]?\s*(.+)$/i);
    if (itemHeaderMatch) {
      // Save previous item if exists
      if (currentItem && currentItem.dashboard_item_id) {
        items.push(finalizeTrustItem(currentItem));
      }

      // Start new item
      const riskBand = parseRiskBand(itemHeaderMatch[1]!);
      const itemId = extractItemId(itemHeaderMatch[2]!);

      currentItem = {
        dashboard_item_id: itemId,
        risk_band: riskBand,
        item_type: TrustItemType.STATE_CHANGE, // Default
        status: BriefItemStatus.ACTIVE, // Default
        description: "",
        first_detected_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      };
      inItemSection = true;
      continue;
    }

    // Alternative format: ### Item Title (ID: xxx)
    const altHeaderMatch = trimmed.match(/^###\s*(.+?)\s*\(ID:\s*([^)]+)\)/i);
    if (altHeaderMatch && !itemHeaderMatch) {
      if (currentItem && currentItem.dashboard_item_id) {
        items.push(finalizeTrustItem(currentItem));
      }

      currentItem = {
        dashboard_item_id: altHeaderMatch[2]!.trim(),
        description: altHeaderMatch[1]!.trim(),
        risk_band: RiskBand.MEDIUM, // Default
        item_type: TrustItemType.STATE_CHANGE,
        status: BriefItemStatus.ACTIVE,
        first_detected_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      };
      inItemSection = true;
      continue;
    }

    if (!inItemSection || !currentItem) {
      continue;
    }

    // Parse item fields
    const typeMatch = trimmed.match(/\*\*Type:\*\*\s*(\w+)/i);
    if (typeMatch) {
      currentItem.item_type = parseTrustItemType(typeMatch[1]!);
      continue;
    }

    const descMatch = trimmed.match(/\*\*Description:\*\*\s*(.+)/i);
    if (descMatch) {
      currentItem.description = descMatch[1]!.trim();
      continue;
    }

    const statusMatch = trimmed.match(/\*\*Status:\*\*\s*(\w+)/i);
    if (statusMatch) {
      currentItem.status = parseBriefItemStatus(statusMatch[1]!);
      continue;
    }

    const firstDetectedMatch = trimmed.match(/\*\*First\s+detected:\*\*\s*(\d{4}-\d{2}-\d{2})/i);
    if (firstDetectedMatch) {
      currentItem.first_detected_at = new Date(firstDetectedMatch[1]!).toISOString();
      continue;
    }

    const lastUpdatedMatch = trimmed.match(/\*\*Last\s+updated:\*\*\s*(\d{4}-\d{2}-\d{2})/i);
    if (lastUpdatedMatch) {
      currentItem.last_updated_at = new Date(lastUpdatedMatch[1]!).toISOString();
      continue;
    }

    // Check for separator (---) which ends the item
    if (trimmed === "---") {
      if (currentItem && currentItem.dashboard_item_id) {
        items.push(finalizeTrustItem(currentItem));
        currentItem = null;
        inItemSection = false;
      }
    }
  }

  // Don't forget the last item
  if (currentItem && currentItem.dashboard_item_id) {
    items.push(finalizeTrustItem(currentItem));
  }

  return items;
}

/**
 * Finalize a partial trust item with defaults
 */
function finalizeTrustItem(partial: Partial<ExtractedTrustItem>): ExtractedTrustItem {
  const now = new Date().toISOString();

  return {
    dashboard_item_id: partial.dashboard_item_id || `item-${Date.now()}`,
    item_type: partial.item_type || TrustItemType.STATE_CHANGE,
    description: partial.description || "No description provided",
    risk_band: partial.risk_band || RiskBand.MEDIUM,
    status: partial.status || BriefItemStatus.ACTIVE,
    first_detected_at: partial.first_detected_at || now,
    last_updated_at: partial.last_updated_at || now,
    related_clip_paths: partial.related_clip_paths,
    context: partial.context,
  };
}

/**
 * Parse risk band from string
 */
function parseRiskBand(str: string): RiskBand {
  const normalized = str.toLowerCase();
  switch (normalized) {
    case "critical":
      return RiskBand.CRITICAL;
    case "high":
      return RiskBand.HIGH;
    case "medium":
      return RiskBand.MEDIUM;
    case "low":
      return RiskBand.LOW;
    default:
      return RiskBand.MEDIUM;
  }
}

/**
 * Parse trust item type from string
 */
function parseTrustItemType(str: string): TrustItemType {
  const normalized = str.toLowerCase().replace(/[_-]/g, "-");
  switch (normalized) {
    case "contradiction":
      return TrustItemType.CONTRADICTION;
    case "evidence-gap":
    case "evidence_gap":
    case "evidencegap":
      return TrustItemType.EVIDENCE_GAP;
    case "low-confidence":
    case "low_confidence":
    case "lowconfidence":
      return TrustItemType.LOW_CONFIDENCE;
    case "stale-assumption":
    case "stale_assumption":
    case "staleassumption":
      return TrustItemType.STALE_ASSUMPTION;
    case "state-change":
    case "state_change":
    case "statechange":
      return TrustItemType.STATE_CHANGE;
    case "historical-pattern":
    case "historical_pattern":
    case "historicalpattern":
      return TrustItemType.HISTORICAL_PATTERN;
    default:
      return TrustItemType.STATE_CHANGE;
  }
}

/**
 * Parse brief item status from string
 */
function parseBriefItemStatus(str: string): BriefItemStatus {
  const normalized = str.toLowerCase().replace(/[_-]/g, "-");
  switch (normalized) {
    case "active":
      return BriefItemStatus.ACTIVE;
    case "in-progress":
    case "in_progress":
    case "inprogress":
      return BriefItemStatus.IN_PROGRESS;
    case "resolved":
      return BriefItemStatus.RESOLVED;
    case "dismissed":
      return BriefItemStatus.DISMISSED;
    default:
      return BriefItemStatus.ACTIVE;
  }
}

/**
 * Extract item ID from header text
 */
function extractItemId(headerText: string): string {
  // Try to find ID in parentheses: (ID: xxx)
  const idMatch = headerText.match(/\(ID:\s*([^)]+)\)/i);
  if (idMatch) {
    return idMatch[1]!.trim();
  }

  // Try to find ID after colon: Item: xxx
  const colonMatch = headerText.match(/:\s*(.+)$/);
  if (colonMatch) {
    return colonMatch[1]!.trim();
  }

  // Use the whole text, normalized
  return headerText
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 50);
}

/**
 * Parse knowledge-trust-dashboard-history.ndjson for trust items
 *
 * Each line is a JSON object representing a history event.
 * We extract the most recent state for each dashboard_item_id.
 *
 * @param content - Full ndjson content
 * @param historyPath - Path to the history file
 * @returns Array of history entries
 */
export function parseKnowledgeTrustHistory(
  content: string,
  historyPath: string
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const lines = content.split("\n").filter(line => line.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    try {
      const entry = JSON.parse(line) as HistoryEntry;

      // Validate required fields
      if (!entry.dashboard_item_id || !entry.timestamp) {
        continue;
      }

      // Set defaults for optional fields
      entry.history_item_id = entry.history_item_id || `hist-${i}`;
      entry.item_type = entry.item_type || TrustItemType.STATE_CHANGE;
      entry.risk_band = entry.risk_band || RiskBand.MEDIUM;
      entry.description = entry.description || "No description";
      entry.status = entry.status || BriefItemStatus.ACTIVE;
      entry.event_type = entry.event_type || "updated";

      entries.push(entry);
    } catch {
      // Skip invalid JSON lines
      continue;
    }
  }

  return entries;
}

/**
 * Convert history entries to trust item inputs
 *
 * Groups by dashboard_item_id and takes the most recent entry for each.
 *
 * @param historyEntries - Array of history entries
 * @param historyPath - Path to the history file
 * @returns Array of trust item inputs
 */
export function historyEntriesToInputs(
  historyEntries: HistoryEntry[],
  historyPath: string
): TrustItemInput[] {
  // Group by dashboard_item_id
  const groups = new Map<string, HistoryEntry[]>();

  for (const entry of historyEntries) {
    if (!groups.has(entry.dashboard_item_id)) {
      groups.set(entry.dashboard_item_id, []);
    }
    groups.get(entry.dashboard_item_id)!.push(entry);
  }

  // Take most recent entry for each item
  const inputs: TrustItemInput[] = [];

  for (const [_, entries] of groups) {
    // Sort by timestamp descending
    const sorted = entries.sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
    const mostRecent = sorted[0]!;

    inputs.push({
      dashboard_item_id: mostRecent.dashboard_item_id,
      item_type: mostRecent.item_type,
      description: mostRecent.description,
      risk_band: mostRecent.risk_band,
      source_type: ContractTrustSourceType.HISTORY,
      source_path: historyPath,
      first_detected_at: sorted[sorted.length - 1]?.timestamp || mostRecent.timestamp,
      last_updated_at: mostRecent.timestamp,
      status: mostRecent.status,
      related_clip_paths: mostRecent.related_clip_paths,
      context: mostRecent.context,
    });
  }

  return inputs;
}

/**
 * Convert parsed dashboard to trust item inputs
 *
 * @param dashboard - Parsed trust dashboard
 * @param sourceType - Type of source (DASHBOARD or STATE_SYNC)
 * @returns Array of trust item inputs
 */
export function dashboardToInputs(
  dashboard: ParsedTrustDashboard,
  sourceType: TrustSourceType
): TrustItemInput[] {
  return dashboard.items.map((item) => ({
    dashboard_item_id: item.dashboard_item_id,
    item_type: item.item_type,
    description: item.description,
    risk_band: item.risk_band,
    source_type: sourceType,
    source_path: dashboard.dashboardPath,
    first_detected_at: item.first_detected_at,
    last_updated_at: item.last_updated_at,
    status: item.status,
    related_clip_paths: item.related_clip_paths,
    context: item.context,
  }));
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
  const extensions = options.extensions || [".md", ".ndjson"];
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
 * Recursively scan vault directory for trust source files
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
 * Get trust parser for a given trust source type
 *
 * @param sourceType - Type of trust source
 * @returns Parser function for the source type
 */
function getTrustParser(sourceType: TrustSourceType): (
  content: string,
  filePath: string
) => ParsedTrustDashboard | HistoryEntry[] | null {
  switch (sourceType) {
    case ContractTrustSourceType.DASHBOARD:
      return parseKnowledgeTrustDashboard;
    case ContractTrustSourceType.STATE_SYNC:
      return parseKnowledgeTrustStateSync;
    case ContractTrustSourceType.HISTORY:
      return parseKnowledgeTrustHistory;
    default:
      return () => null;
  }
}

/**
 * Scan vault for trust items across all sources
 *
 * This is the main entry point for extracting trust items from vault notes.
 *
 * @param options - Scan options
 * @returns Scan result with extracted trust items
 */
export async function scanVaultForTrustItems(
  options: ScanVaultOptions
): Promise<ScanVaultResult> {
  const result: ScanVaultResult = {
    trustItems: [],
    filesScanned: 0,
    filesWithTrust: 0,
    filesSkipped: 0,
    errors: [],
    sourceStats: new Map(),
    options,
  };

  // Initialize stats for all trust sources
  const sourcesToScan = options.trustSources || [
    ContractTrustSourceType.DASHBOARD,
    ContractTrustSourceType.STATE_SYNC,
    ContractTrustSourceType.HISTORY,
  ];

  for (const source of sourcesToScan) {
    result.sourceStats.set(source, {
      filesWithSource: 0,
      itemsExtracted: 0,
      riskBandCounts: { critical: 0, high: 0, medium: 0, low: 0 },
      statusCounts: { active: 0, inProgress: 0, resolved: 0, dismissed: 0 },
    });
  }

  // Collect all files
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

      // Try to parse each trust source
      for (const source of sourcesToScan) {
        try {
          const parser = getTrustParser(source);
          const parseResult = parser(content, filePath);

          if (!parseResult) {
            continue;
          }

          let inputs: TrustItemInput[] = [];

          if (source === ContractTrustSourceType.HISTORY && Array.isArray(parseResult)) {
            // History returns HistoryEntry[]
            inputs = historyEntriesToInputs(parseResult as HistoryEntry[], filePath);
          } else if (parseResult) {
            // Dashboard and state sync return ParsedTrustDashboard
            inputs = dashboardToInputs(parseResult as ParsedTrustDashboard, source);
          }

          if (inputs.length > 0) {
            result.filesWithTrust++;

            // Update stats
            const stats = result.sourceStats.get(source)!;
            stats.filesWithSource++;
            stats.itemsExtracted += inputs.length;

            for (const input of inputs) {
              // Update risk band counts
              const riskKey = input.risk_band as keyof typeof stats.riskBandCounts;
              if (stats.riskBandCounts[riskKey] !== undefined) {
                stats.riskBandCounts[riskKey]++;
              }

              // Update status counts
              switch (input.status) {
                case BriefItemStatus.ACTIVE:
                  stats.statusCounts.active++;
                  break;
                case BriefItemStatus.IN_PROGRESS:
                  stats.statusCounts.inProgress++;
                  break;
                case BriefItemStatus.RESOLVED:
                  stats.statusCounts.resolved++;
                  break;
                case BriefItemStatus.DISMISSED:
                  stats.statusCounts.dismissed++;
                  break;
              }
            }

            // Add items to result
            result.trustItems.push(...inputs);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({
            filePath,
            error: errorMsg,
            errorType: "trust_error",
            trustSource: source,
          });
        }
      }

      if (result.trustItems.length === 0) {
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

  // Sort items deterministically (by source type, then path, then item ID)
  result.trustItems.sort((a, b) => {
    if (a.source_type !== b.source_type) {
      return a.source_type.localeCompare(b.source_type);
    }
    if (a.source_path !== b.source_path) {
      return a.source_path.localeCompare(b.source_path);
    }
    return a.dashboard_item_id.localeCompare(b.dashboard_item_id);
  });

  return result;
}

/**
 * Build Knowledge Trust Kickoff Brief from vault scan
 *
 * This is a convenience function that combines scanning and building.
 *
 * @param options - Scan options
 * @returns Knowledge Trust Kickoff Brief
 */
export async function buildBriefFromVault(
  options: ScanVaultOptions
): Promise<ReturnType<typeof buildKnowledgeTrustKickoffBrief>> {
  // Scan vault for trust items
  const scanResult = await scanVaultForTrustItems(options);

  // Build brief using contract utility
  const brief = buildKnowledgeTrustKickoffBrief(scanResult.trustItems);

  return brief;
}

/**
 * Extract trust items from a single note
 *
 * Convenience function for processing individual notes.
 *
 * @param content - Markdown content
 * @param notePath - Path to the note
 * @param trustSources - Trust sources to extract from (default: all)
 * @returns Array of TrustItemInput
 */
export function extractTrustItemsFromNote(
  content: string,
  notePath: string,
  trustSources?: TrustSourceType[]
): TrustItemInput[] {
  const allItems: TrustItemInput[] = [];

  const sourcesToScan = trustSources || [
    ContractTrustSourceType.DASHBOARD,
    ContractTrustSourceType.STATE_SYNC,
    ContractTrustSourceType.HISTORY,
  ];

  for (const source of sourcesToScan) {
    try {
      if (source === ContractTrustSourceType.HISTORY && notePath.endsWith(".ndjson")) {
        const historyEntries = parseKnowledgeTrustHistory(content, notePath);
        const inputs = historyEntriesToInputs(historyEntries, notePath);
        allItems.push(...inputs);
      } else {
        const parser = source === ContractTrustSourceType.STATE_SYNC
          ? parseKnowledgeTrustStateSync
          : parseKnowledgeTrustDashboard;
        const dashboard = parser(content, notePath);

        if (dashboard) {
          const inputs = dashboardToInputs(dashboard, source);
          allItems.push(...inputs);
        }
      }
    } catch (error) {
      // Skip errors for single-note extraction
      console.error(`Error parsing ${source} from ${notePath}:`, error);
    }
  }

  return allItems;
}

/**
 * Merge trust items from multiple sources
 *
 * Takes an array of TrustItemInput from dashboard, state-sync, and history,
 * and merges them using the contract's dedupe logic.
 *
 * @param inputs - Array of trust items from various sources
 * @returns Merged items with reconciled state
 */
export function mergeTrustItems(
  inputs: TrustItemInput[]
): TrustItemInput[] {
  // Use the contract's dedupe function
  const { dedupeTrustItemInputs } = require("./knowledgeTrustKickoffBriefContract");
  return dedupeTrustItemInputs(inputs);
}

/**
 * Compute recommended next actions for trust items
 *
 * This is a convenience wrapper that applies the contract's action
 * determination logic to a set of trust items.
 *
 * @param items - Trust items to compute actions for
 * @returns Items with computed recommended_next_action (implicit in the brief entry)
 */
export function computeRecommendedActions(
  items: TrustItemInput[]
): Array<{ item: TrustItemInput; action: string; reason: string }> {
  const {
    determineRecommendedAction,
    computePriorityReason,
    buildBriefEntry,
  } = require("./knowledgeTrustKickoffBriefContract");

  return items.map((item) => {
    const entry = buildBriefEntry(item);
    return {
      item,
      action: entry.recommended_next_action,
      reason: entry.priority_reason,
    };
  });
}

// Re-export contract types and functions for convenience
export {
  KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
  RiskBand,
  TrustItemType,
  TrustSourceType,
  BriefItemStatus,
  RecommendedAction,
  buildKnowledgeTrustKickoffBrief,
} from "./knowledgeTrustKickoffBriefContract";

export type {
  TrustItemInput,
  BriefEntry,
  KnowledgeTrustKickoffBrief,
  BriefMetadata,
} from "./knowledgeTrustKickoffBriefContract";
