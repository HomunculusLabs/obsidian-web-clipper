#!/usr/bin/env bun

/**
 * Pilot Sample Gap Planner
 *
 * Compares live pilot artifacts against brief thresholds and emits deterministic
 * next-action planning fields: remainingSent, requiredBatches, channelMix, latestSendBy.
 *
 * Usage:
 *   bun run pilot:sample-gap-planner -- \
 *     --brief OFFER_BRIEF.md \
 *     --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
 *     --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
 *     --batch-size 3 \
 *     --format json
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ============================================================================
// Error Codes
// ============================================================================

const ERROR_CODES = {
  INVALID_BRIEF: { code: "INVALID_BRIEF", exit: 1 },
  INVALID_RUN_SHEET: { code: "INVALID_RUN_SHEET", exit: 2 },
  INVALID_RESPONSE_LOG: { code: "INVALID_RESPONSE_LOG", exit: 3 },
  AMBIGUOUS_THRESHOLD: { code: "AMBIGUOUS_THRESHOLD", exit: 4 },
  INVALID_BATCH_SIZE: { code: "INVALID_BATCH_SIZE", exit: 5 },
  RECIPIENT_MISMATCH: { code: "RECIPIENT_MISMATCH", exit: 6 },
  DUPLICATE_RECIPIENT: { code: "DUPLICATE_RECIPIENT", exit: 7 },
  CALCULATION_ERROR: { code: "CALCULATION_ERROR", exit: 8 },
} as const;

function exitWithError(
  errorKey: keyof typeof ERROR_CODES,
  message: string
): never {
  const error = ERROR_CODES[errorKey];
  console.error(`Error [${error.code}]: ${message}`);
  process.exit(error.exit);
}

// ============================================================================
// Types
// ============================================================================

interface ParsedFrontmatter {
  artifact?: string;
  batch?: string;
  [key: string]: string | number | boolean | string[] | undefined;
}

interface RunSheetRow {
  recipientHandle: string;
  channel: string;
  sendStatus: "not sent" | "sent" | "failed" | "blocked";
  sentTimestamp: string;
  artifactLink: string;
  cta?: string;
}

interface ResponseLogRow {
  recipient: string;
  sourceChannel: string;
  workflowSentence: string;
  objectionType: string;
  wtp: string | number;
  nextStepDecision: string;
  decisionRationale: string;
  responseState: string;
}

interface RunSheetData {
  frontmatter: ParsedFrontmatter;
  rows: RunSheetRow[];
}

interface ResponseLogData {
  frontmatter: ParsedFrontmatter;
  rows: ResponseLogRow[];
}

interface ThresholdData {
  minSent: number;
  minReplies: number;
  source: string;
}

interface ChannelStats {
  sent: number;
  replied: number;
}

interface CurrentState {
  totalSent: number;
  totalReplied: number;
  pending: number;
  coldAged: number;
  byChannel: Record<string, ChannelStats>;
}

interface ChannelMixEntry {
  channel: string;
  count: number;
}

interface GapOutput {
  remainingSent: number;
  requiredBatches: number;
  channelMix: ChannelMixEntry[];
  latestSendBy: string | null;
}

interface PlannerOutput {
  status: "ok" | "error";
  threshold: {
    minSent: number;
    minReplies: number;
    source: string;
  };
  currentState: CurrentState;
  gap: GapOutput;
  thresholdMet: boolean;
  recommendation: "SEND_MORE" | "THRESHOLD_MET" | "HOLD";
  timestamp: string;
  error?: {
    code: string;
    message: string;
  };
}

interface CliArgs {
  briefPath?: string;
  runSheetPath?: string;
  responsesPath?: string;
  batchSize: number;
  format?: "json" | "human";
  now?: string;
  help: boolean;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function printHelp(): void {
  console.log(`
Pilot Sample Gap Planner

Compares live pilot artifacts against brief thresholds and emits deterministic
next-action planning fields.

USAGE:
  bun run pilot:sample-gap-planner -- \\
    --brief OFFER_BRIEF.md \\
    --run-sheet <path> \\
    --responses <path> \\
    --batch-size 3 \\
    --format json

OPTIONS:
  --brief <path>       Path to OFFER_BRIEF.md file (required)
  --run-sheet <path>   Path to pilot-run-sheet.md file (required)
  --responses <path>   Path to pilot-response-log.md file (required)
  --batch-size <n>     Number of sends per batch (default: 3)
  --format <format>    Output format: "json" or "human" (default: json)
  --now <timestamp>    ISO-8601 timestamp for deterministic testing (default: current time)
  --help, -h           Show this help message

OUTPUT:
  Deterministic JSON with planning fields:
  - threshold: Extracted minSent/minReplies from OFFER_BRIEF.md
  - currentState: Live pilot state from run-sheet/response-log
  - gap: remainingSent, requiredBatches, channelMix, latestSendBy
  - thresholdMet: Boolean indicating if thresholds are met
  - recommendation: "SEND_MORE" | "THRESHOLD_MET" | "HOLD"

ERROR CODES:
  1  INVALID_BRIEF       - OFFER_BRIEF.md file not found or malformed
  2  INVALID_RUN_SHEET   - Run sheet file not found or malformed
  3  INVALID_RESPONSE_LOG - Response log file not found or malformed
  4  AMBIGUOUS_THRESHOLD - Threshold patterns not found in OFFER_BRIEF.md
  5  INVALID_BATCH_SIZE  - Batch size is not a positive integer
  6  RECIPIENT_MISMATCH  - Response log contains unknown recipient
  7  DUPLICATE_RECIPIENT - Run sheet contains duplicate recipients
  8  CALCULATION_ERROR   - Internal calculation error

EXAMPLES:
  bun run pilot:sample-gap-planner -- \\
    --brief OFFER_BRIEF.md \\
    --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \\
    --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \\
    --batch-size 3 \\
    --format json

  # Deterministic testing with fixed timestamp
  bun run pilot:sample-gap-planner -- \\
    --brief OFFER_BRIEF.md \\
    --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \\
    --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \\
    --batch-size 3 \\
    --now 2026-03-01T12:00:00Z \\
    --format json
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    batchSize: 3, // Default batch size
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--brief") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --brief");
        process.exit(1);
      }
      args.briefPath = value;
      continue;
    }

    if (arg === "--run-sheet") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --run-sheet");
        process.exit(1);
      }
      args.runSheetPath = value;
      continue;
    }

    if (arg === "--responses") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --responses");
        process.exit(1);
      }
      args.responsesPath = value;
      continue;
    }

    if (arg === "--batch-size") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --batch-size");
        process.exit(1);
      }
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed <= 0) {
        exitWithError(
          "INVALID_BATCH_SIZE",
          `Batch size must be a positive integer, got: ${value}`
        );
      }
      args.batchSize = parsed;
      continue;
    }

    if (arg === "--format") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --format");
        process.exit(1);
      }
      if (value !== "json" && value !== "human") {
        console.error(`Invalid format: ${value}. Must be "json" or "human"`);
        process.exit(1);
      }
      args.format = value;
      continue;
    }

    if (arg === "--now") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --now");
        process.exit(1);
      }
      // Validate ISO-8601 format
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
        console.error(
          `Invalid --now timestamp format. Expected ISO-8601 with Z suffix (e.g., 2026-03-01T12:00:00Z), got: ${value}`
        );
        process.exit(1);
      }
      args.now = value;
      continue;
    }

    // Unknown argument
    if (arg.startsWith("-")) {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  return args;
}

// ============================================================================
// Frontmatter Parsing
// ============================================================================

function parseFrontmatter(content: string): {
  frontmatter: ParsedFrontmatter;
  body: string;
} {
  const lines = content.split("\n");

  // Check if file starts with frontmatter
  if (lines[0] !== "---") {
    return { frontmatter: {}, body: content };
  }

  // Find the closing ---
  let endLine = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      endLine = i;
      break;
    }
  }

  if (endLine === -1) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterLines = lines.slice(1, endLine);
  const body = lines.slice(endLine + 1).join("\n");

  const frontmatter: ParsedFrontmatter = {};

  for (const line of frontmatterLines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: string | number | boolean | string[] = line
      .slice(colonIndex + 1)
      .trim();

    // Handle arrays
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      if (inner === "") {
        frontmatter[key] = [];
        continue;
      }
      // Simple array parsing (comma-separated, quoted strings)
      const items = inner
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
      frontmatter[key] = items;
      continue;
    }

    // Handle booleans
    if (value === "true") {
      frontmatter[key] = true;
      continue;
    }
    if (value === "false") {
      frontmatter[key] = false;
      continue;
    }

    // Handle numbers
    const num = Number(value);
    if (!isNaN(num) && value !== "") {
      frontmatter[key] = num;
      continue;
    }

    // Handle quoted strings
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

// ============================================================================
// Markdown Table Parsing
// ============================================================================

function parseMarkdownTable(body: string): string[][] {
  const lines = body.split("\n");
  const rows: string[][] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Skip header separator (e.g., | --- | --- |)
    if (trimmed.match(/^\|[\s\-:|]+\|$/)) continue;

    // Check if line looks like a table row
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      // Split by | and remove first/last empty elements
      const allParts = trimmed.split("|");
      // Remove first and last elements (empty strings before first | and after last |)
      const cells = allParts
        .slice(1, -1)
        .map((cell) => {
          // Trim whitespace
          let value = cell.trim();
          // Strip backticks if present (markdown code formatting)
          if (value.startsWith("`") && value.endsWith("`")) {
            value = value.slice(1, -1);
          }
          return value;
        });

      // Only add if we have cells
      if (cells.length > 0) {
        rows.push(cells);
      }
    }
  }

  return rows;
}

// ============================================================================
// File Loading Utilities
// ============================================================================

function loadFile(path: string, errorKey: keyof typeof ERROR_CODES, description: string): string {
  const resolvedPath = resolve(path);

  if (!existsSync(resolvedPath)) {
    exitWithError(errorKey, `${description} file not found: ${resolvedPath}`);
  }

  try {
    return readFileSync(resolvedPath, "utf-8");
  } catch (err) {
    exitWithError(
      errorKey,
      `Failed to read ${description} file: ${resolvedPath}. ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ============================================================================
// OFFER_BRIEF Parsing (TP003 - Stub Implementation)
// ============================================================================

/**
 * Parse OFFER_BRIEF.md to extract decision-grade thresholds.
 *
 * Extracts:
 * - minSent: Minimum sends required (e.g., 10 for "first 10 qualified")
 * - minReplies: Minimum replies required (e.g., 3 for ">=3 correctly formatted PILOT YES replies")
 *
 * Pattern matching:
 * - Pilot CTA → Success signal: "First outreach batch ((\d+) qualified.*) yields >=(\d+).*replies"
 * - Pricing Hypothesis → Validation signal: "In first (\d+) qualified.*>= (\d+).*commitments"
 */
function parseOfferBrief(content: string, filePath: string): ThresholdData {
  // Pattern 1: Pilot CTA Success signal
  // Example: "First outreach batch (10 qualified ICP contacts) yields **>=3 correctly formatted `PILOT YES` replies**"
  // Note: Markdown may include bold (**) and code (`) formatting
  // Use [\s\S]*? to match any characters (including newlines) non-greedily up to the target
  const ctaPattern = /First outreach batch \((\d+)\s+qualified[^)]*\)\s+yields\s+\**>=(\d+)[\s\S]*?(replies|PILOT)/i;
  const ctaMatch = content.match(ctaPattern);

  if (ctaMatch) {
    const minSent = parseInt(ctaMatch[1], 10);
    const minReplies = parseInt(ctaMatch[2], 10);

    if (!isNaN(minSent) && !isNaN(minReplies)) {
      return {
        minSent,
        minReplies,
        source: `${filePath}#pilot-cta`,
      };
    }
  }

  // Pattern 2: Pricing Hypothesis validation signal
  // Example: "In first 10 qualified pilot conversations, **>=3 explicit "yes" commitments**"
  const pricingPattern = /In first (\d+)\s+qualified[^,]*,?\s+\**>=(\d+)[\s\S]*?(commitments|explicit)/i;
  const pricingMatch = content.match(pricingPattern);

  if (pricingMatch) {
    const minSent = parseInt(pricingMatch[1], 10);
    const minReplies = parseInt(pricingMatch[2], 10);

    if (!isNaN(minSent) && !isNaN(minReplies)) {
      return {
        minSent,
        minReplies,
        source: `${filePath}#pricing-hypothesis`,
      };
    }
  }

  // No valid threshold pattern found
  exitWithError(
    "AMBIGUOUS_THRESHOLD",
    `Could not extract decision-grade thresholds from OFFER_BRIEF.md. ` +
      `Expected pattern like "First outreach batch (N qualified...) yields >=M ... replies". ` +
      `File: ${filePath}`
  );
}

// ============================================================================
// Run Sheet Parsing (TP004 - Stub Implementation)
// ============================================================================

function parseRunSheet(content: string, filePath: string): RunSheetData {
  const { frontmatter, body } = parseFrontmatter(content);

  // Validate frontmatter
  if (frontmatter.artifact !== "pilot-run-sheet") {
    exitWithError(
      "INVALID_RUN_SHEET",
      `File "${filePath}" missing or invalid frontmatter artifact field. Expected "pilot-run-sheet", got "${frontmatter.artifact || "missing"}"`
    );
  }

  const tableRows = parseMarkdownTable(body);

  if (tableRows.length === 0) {
    exitWithError(
      "INVALID_RUN_SHEET",
      `File "${filePath}" contains no valid markdown table rows`
    );
  }

  // First row is header
  const header = tableRows[0];
  const expectedColumns = [
    "Recipient Handle",
    "Channel",
    "Send Status",
    "Sent Timestamp (ISO-8601)",
    "Artifact Link",
  ];

  // Validate header (normalize whitespace)
  const normalizedHeader = header.map((h) => h.replace(/\s+/g, " ").trim());
  const normalizedExpected = expectedColumns.map((h) => h.trim());

  // Check if we have an optional 6th column (CTA Variant or Follow-Up Timestamp)
  const hasSixthColumn = normalizedHeader.length === 6;
  const sixthColumnName = hasSixthColumn ? normalizedHeader[5] : null;
  const isCTAColumn = sixthColumnName === "CTA Variant";

  // Validate required columns
  for (let i = 0; i < normalizedExpected.length; i++) {
    if (normalizedHeader[i] !== normalizedExpected[i]) {
      exitWithError(
        "INVALID_RUN_SHEET",
        `File "${filePath}" has invalid table header. Expected column ${i + 1} to be "${normalizedExpected[i]}", got "${normalizedHeader[i] || "missing"}"`
      );
    }
  }

  // Parse data rows
  const rows: RunSheetRow[] = [];
  const recipients = new Set<string>();

  for (let i = 1; i < tableRows.length; i++) {
    const row = tableRows[i];

    // Allow 5 or 6 columns
    if (row.length < 5 || row.length > 6) {
      exitWithError(
        "INVALID_RUN_SHEET",
        `File "${filePath}" row ${i + 1} has ${row.length} columns, expected 5 or 6`
      );
    }

    const [recipientHandle, channel, sendStatus, sentTimestamp, artifactLink, sixthColumn] =
      row;

    // Check for duplicates
    if (recipients.has(recipientHandle)) {
      exitWithError(
        "DUPLICATE_RECIPIENT",
        `File "${filePath}" contains duplicate recipient handle "${recipientHandle}" at row ${i + 1}`
      );
    }
    recipients.add(recipientHandle);

    // Validate send status
    const validStatuses = ["not sent", "sent", "failed", "blocked"];
    if (!validStatuses.includes(sendStatus)) {
      exitWithError(
        "INVALID_RUN_SHEET",
        `File "${filePath}" row ${i + 1} has invalid send status "${sendStatus}". Expected one of: ${validStatuses.join(", ")}`
      );
    }

    const rowObj: RunSheetRow = {
      recipientHandle,
      channel,
      sendStatus: sendStatus as RunSheetRow["sendStatus"],
      sentTimestamp,
      artifactLink,
    };

    // Add CTA if column exists and is CTA type
    if (isCTAColumn && sixthColumn) {
      rowObj.cta = sixthColumn;
    }

    rows.push(rowObj);
  }

  return { frontmatter, rows };
}

// ============================================================================
// Response Log Parsing (TP004 - Stub Implementation)
// ============================================================================

function parseResponseLog(
  content: string,
  filePath: string,
  runSheet: RunSheetData
): ResponseLogData {
  const { frontmatter, body } = parseFrontmatter(content);

  // Validate frontmatter
  if (frontmatter.artifact !== "pilot-response-log") {
    exitWithError(
      "INVALID_RESPONSE_LOG",
      `File "${filePath}" missing or invalid frontmatter artifact field. Expected "pilot-response-log", got "${frontmatter.artifact || "missing"}"`
    );
  }

  const tableRows = parseMarkdownTable(body);

  if (tableRows.length === 0) {
    exitWithError(
      "INVALID_RESPONSE_LOG",
      `File "${filePath}" contains no valid markdown table rows`
    );
  }

  // First row is header
  const header = tableRows[0];
  const expectedColumns = [
    "Recipient",
    "Source Channel",
    "Workflow Sentence",
    "Objection Type",
    "WTP ($/mo)",
    "Next-Step Decision",
    "Decision Rationale",
    "Response State",
  ];

  // Validate header
  const normalizedHeader = header.map((h) => h.replace(/\s+/g, " ").trim());
  const normalizedExpected = expectedColumns.map((h) => h.trim());

  for (let i = 0; i < normalizedExpected.length; i++) {
    if (normalizedHeader[i] !== normalizedExpected[i]) {
      exitWithError(
        "INVALID_RESPONSE_LOG",
        `File "${filePath}" has invalid table header. Expected column ${i + 1} to be "${normalizedExpected[i]}", got "${normalizedHeader[i] || "missing"}"`
      );
    }
  }

  // Build a map of recipients from run sheet for validation
  const runSheetRecipients = new Map<string, string>();
  for (const row of runSheet.rows) {
    runSheetRecipients.set(row.recipientHandle, row.channel);
  }

  // Parse data rows
  const rows: ResponseLogRow[] = [];
  const seenRecipients = new Set<string>();

  for (let i = 1; i < tableRows.length; i++) {
    const row = tableRows[i];

    if (row.length !== 8) {
      exitWithError(
        "INVALID_RESPONSE_LOG",
        `File "${filePath}" row ${i + 1} has ${row.length} columns, expected 8`
      );
    }

    const [
      recipient,
      sourceChannel,
      workflowSentence,
      objectionType,
      wtp,
      nextStepDecision,
      decisionRationale,
      responseState,
    ] = row;

    // Check if recipient exists in run sheet
    if (!runSheetRecipients.has(recipient)) {
      exitWithError(
        "RECIPIENT_MISMATCH",
        `File "${filePath}" row ${i + 1} contains recipient "${recipient}" not present in run sheet`
      );
    }

    // Check for duplicate recipients in response log
    if (seenRecipients.has(recipient)) {
      exitWithError(
        "INVALID_RESPONSE_LOG",
        `File "${filePath}" contains duplicate recipient "${recipient}" at row ${i + 1}`
      );
    }
    seenRecipients.add(recipient);

    rows.push({
      recipient,
      sourceChannel,
      workflowSentence,
      objectionType,
      wtp: wtp === "no response yet" ? wtp : parseFloat(wtp) || wtp,
      nextStepDecision,
      decisionRationale,
      responseState,
    });
  }

  return { frontmatter, rows };
}

// ============================================================================
// Current State Derivation (TP004 - Stub Implementation)
// ============================================================================

/**
 * Extract the latest send timestamp from the run sheet.
 *
 * This is used for deterministic latestSendBy calculation (TP007).
 * Considers both initial send timestamps and follow-up timestamps.
 *
 * @param runSheet - Parsed run sheet data
 * @returns ISO-8601 timestamp of the most recent send, or undefined if no sends
 */
function extractLatestSentTimestamp(runSheet: RunSheetData): string | undefined {
  let latestTimestamp: string | undefined;

  for (const row of runSheet.rows) {
    if (row.sendStatus !== "sent") continue;

    // Check initial send timestamp
    if (row.sentTimestamp) {
      if (!latestTimestamp || row.sentTimestamp > latestTimestamp) {
        latestTimestamp = row.sentTimestamp;
      }
    }

    // Note: Follow-up timestamps are in a 6th column which we don't currently parse
    // If needed, the RunSheetRow type can be extended to include followUpTimestamp
  }

  return latestTimestamp;
}

/**
 * Derive current pilot state from run sheet and response log.
 *
 * Calculates:
 * - totalSent: Count of rows with Send Status = "sent"
 * - totalReplied: Count of rows with Response State ≠ "no response yet"
 * - pending: Recipients awaiting first reply
 * - coldAged: Pending recipients >72 hours since send
 * - byChannel: Per-channel breakdown (sorted alphabetically)
 */
function deriveCurrentState(
  runSheet: RunSheetData,
  responseLog: ResponseLogData,
  nowTimestamp: string
): CurrentState {
  const nowMs = new Date(nowTimestamp).getTime();
  const coldThresholdMs = 72 * 60 * 60 * 1000; // 72 hours in milliseconds

  // Build response map for quick lookup
  const responseMap = new Map<string, ResponseLogRow>();
  for (const row of responseLog.rows) {
    responseMap.set(row.recipient, row);
  }

  // Initialize state
  let totalSent = 0;
  let totalReplied = 0;
  let pending = 0;
  let coldAged = 0;
  const byChannel: Record<string, ChannelStats> = {};

  // Process run sheet rows
  for (const runSheetRow of runSheet.rows) {
    if (runSheetRow.sendStatus !== "sent") {
      continue; // Only count "sent" rows
    }

    totalSent++;

    const response = responseMap.get(runSheetRow.recipientHandle);
    const hasReplied = response && response.responseState !== "no response yet";

    if (hasReplied) {
      totalReplied++;
    } else {
      pending++;
    }

    // Track per-channel stats
    const channel = runSheetRow.channel;
    if (!byChannel[channel]) {
      byChannel[channel] = { sent: 0, replied: 0 };
    }
    byChannel[channel].sent++;
    if (hasReplied) {
      byChannel[channel].replied++;
    }

    // Check cold-aged status
    if (!hasReplied && runSheetRow.sentTimestamp) {
      const sentMs = new Date(runSheetRow.sentTimestamp).getTime();
      const hoursSinceSend = (nowMs - sentMs) / (60 * 60 * 1000);
      if (hoursSinceSend > 72) {
        coldAged++;
      }
    }
  }

  // Sort byChannel keys alphabetically for deterministic output
  const sortedByChannel: Record<string, ChannelStats> = {};
  const sortedChannels = Object.keys(byChannel).sort((a, b) => a.localeCompare(b));
  for (const channel of sortedChannels) {
    sortedByChannel[channel] = byChannel[channel];
  }

  return {
    totalSent,
    totalReplied,
    pending,
    coldAged,
    byChannel: sortedByChannel,
  };
}

// ============================================================================
// Gap Math Engine (TP005 - Stub Implementation)
// ============================================================================

/**
 * Default batch cadence in hours.
 *
 * This is the assumed time between consecutive outreach batches.
 * Operators should send the next batch within this window to maintain
 * decision-grade evidence accumulation pace.
 *
 * Default: 24 hours (daily batch cadence)
 */
const DEFAULT_BATCH_CADENCE_HOURS = 24;

/**
 * Calculate deterministic gap metrics.
 *
 * Formulas:
 * - remainingSent = max(0, minSent - currentSent)
 * - requiredBatches = ceil(remainingSent / batchSize) (0 if threshold met)
 * - latestSendBy = max(now, latestSentTimestamp) + batchCadence (null if threshold met)
 *
 * Threshold-met short-circuit:
 * When both sent AND reply thresholds are met, return all zeros immediately
 * to signal that decision-grade evidence has been achieved.
 *
 * Batch cadence assumptions (TP007):
 * - Default cadence: 24 hours between batches
 * - latestSendBy is calculated from the most recent send timestamp in the run sheet
 * - If no sends yet, uses `now` as the baseline
 * - The deadline ensures operators send the next batch within one cadence window
 */
function calculateGap(
  threshold: ThresholdData,
  currentState: CurrentState,
  batchSize: number,
  nowTimestamp: string,
  latestSentTimestamp?: string
): GapOutput {
  // Threshold-met short-circuit: if both requirements are satisfied, no more sends needed
  const thresholdMet =
    currentState.totalSent >= threshold.minSent &&
    currentState.totalReplied >= threshold.minReplies;

  if (thresholdMet) {
    return {
      remainingSent: 0,
      requiredBatches: 0,
      channelMix: [],
      latestSendBy: null,
    };
  }

  // Calculate gap metrics when threshold not yet met
  const remainingSent = Math.max(0, threshold.minSent - currentState.totalSent);
  const requiredBatches = remainingSent > 0 ? Math.ceil(remainingSent / batchSize) : 0;

  // Calculate latestSendBy based on batch cadence and artifact timestamps (TP007)
  // Formula: max(now, latestSentTimestamp) + batchCadence
  // This ensures the deadline is anchored to actual send activity, not just current time
  let latestSendBy: string | null = null;

  if (remainingSent > 0) {
    const nowMs = new Date(nowTimestamp).getTime();
    const latestSentMs = latestSentTimestamp
      ? new Date(latestSentTimestamp).getTime()
      : 0;

    // Use the later of: current time OR latest send timestamp
    // This prevents unrealistic deadlines if the last send was in the past
    const baselineMs = Math.max(nowMs, latestSentMs);
    const deadlineMs = baselineMs + DEFAULT_BATCH_CADENCE_HOURS * 60 * 60 * 1000;

    // Format as ISO-8601 with Z suffix, stripping milliseconds
    latestSendBy = new Date(deadlineMs).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  // Calculate channel mix recommendation
  const channelMix = calculateChannelMix(currentState, Math.min(remainingSent, batchSize));

  return {
    remainingSent,
    requiredBatches,
    channelMix,
    latestSendBy,
  };
}

// ============================================================================
// Channel Mix Algorithm (TP006 - Deterministic Implementation)
// ============================================================================

/**
 * Deterministic tie-break rules for channel mix calculation.
 *
 * These rules ensure stable output across reruns and threshold states:
 *
 * 1. **Rate-based priority**: Channels with lower reply rates get higher priority
 *    (they need more evidence to reach statistical significance).
 *
 * 2. **Alphabetical tie-break**: When channels have identical reply rates,
 *    they are sorted alphabetically by channel name (using localeCompare).
 *
 * 3. **Round-robin distribution**: Sends are distributed across channels
 *    in priority order, giving 1 to each channel until target is reached.
 *
 * 4. **Even distribution of extras**: Any remaining sends after round-robin
 *    are distributed evenly across channels, starting with lowest-rate channels.
 *
 * 5. **Alphabetical output ordering**: Final output is sorted alphabetically
 *    by channel name for stable JSON serialization.
 *
 * These rules guarantee that:
 * - Same input always produces same output (determinism)
 * - Output is stable regardless of when the planner is run
 * - Threshold-met state always returns empty channelMix
 */

/**
 * Calculate deterministic channel mix recommendation.
 *
 * @param currentState - Current pilot state with per-channel statistics
 * @param targetCount - Number of sends to distribute (typically batchSize)
 * @returns Array of {channel, count} entries sorted alphabetically
 *
 * Algorithm:
 * 1. Calculate per-channel reply rates (replied/sent)
 * 2. Sort by: lowest rate first, then alphabetically for ties
 * 3. Round-robin: give 1 to each channel until target is met
 * 4. Distribute remaining sends evenly across all channels
 * 5. Sort output alphabetically for deterministic JSON
 */
function calculateChannelMix(
  currentState: CurrentState,
  targetCount: number
): ChannelMixEntry[] {
  // Edge case: no sends needed
  if (targetCount <= 0) {
    return [];
  }

  // Edge case: no channels in current state
  const channelEntries = Object.entries(currentState.byChannel);
  if (channelEntries.length === 0) {
    return [];
  }

  // Step 1: Calculate reply rates per channel
  // Rate = replied / sent (0 if no sends yet)
  // Channels with 0% reply rate need more evidence
  const channelRates: Array<{ channel: string; rate: number; sent: number; replied: number }> = [];

  for (const [channel, stats] of channelEntries) {
    const rate = stats.sent > 0 ? stats.replied / stats.sent : 0;
    channelRates.push({
      channel,
      rate,
      sent: stats.sent,
      replied: stats.replied
    });
  }

  // Step 2: Sort by deterministic tie-break rules
  // - Primary: lowest reply rate first (ascending)
  // - Secondary: alphabetical channel name (for ties)
  channelRates.sort((a, b) => {
    // Use precise comparison for rates to avoid floating-point issues
    const rateDiff = a.rate - b.rate;
    if (Math.abs(rateDiff) > 1e-10) {
      return rateDiff; // Lower rate = higher priority
    }
    // Tie-break: alphabetical order (deterministic)
    return a.channel.localeCompare(b.channel);
  });

  // Step 3: Round-robin distribution
  // Give 1 send to each channel in priority order until target is met
  const channelMix: ChannelMixEntry[] = [];
  let remaining = targetCount;

  for (const { channel } of channelRates) {
    if (remaining <= 0) break;
    channelMix.push({ channel, count: 1 });
    remaining--;
  }

  // Step 4: Distribute remaining sends evenly
  // Continue round-robin through all channels in priority order
  while (remaining > 0 && channelMix.length > 0) {
    for (const entry of channelMix) {
      if (remaining <= 0) break;
      entry.count++;
      remaining--;
    }
  }

  // Step 5: Sort output alphabetically for deterministic JSON serialization
  // This ensures stable output regardless of rate-based ordering
  channelMix.sort((a, b) => a.channel.localeCompare(b.channel));

  return channelMix;
}

// ============================================================================
// Output Formatting
// ============================================================================

function formatHumanOutput(output: PlannerOutput): string {
  const lines: string[] = [];

  lines.push("Pilot Sample Gap Planner");
  lines.push("========================");
  lines.push("");

  // Status
  const statusEmoji = output.status === "ok" ? "✅" : "❌";
  lines.push(`Status: ${statusEmoji} ${output.status.toUpperCase()}`);
  lines.push("");

  // Threshold
  lines.push("Threshold (from OFFER_BRIEF.md)");
  lines.push("--------------------------------");
  lines.push(`  Min Sent:    ${output.threshold.minSent}`);
  lines.push(`  Min Replies: ${output.threshold.minReplies}`);
  lines.push(`  Source:      ${output.threshold.source}`);
  lines.push("");

  // Current State
  lines.push("Current State");
  lines.push("-------------");
  lines.push(`  Total Sent:    ${output.currentState.totalSent}`);
  lines.push(`  Total Replied: ${output.currentState.totalReplied}`);
  lines.push(`  Pending:       ${output.currentState.pending}`);
  lines.push(`  Cold-Aged:     ${output.currentState.coldAged}`);
  lines.push("");

  // By Channel
  lines.push("  By Channel:");
  for (const [channel, stats] of Object.entries(output.currentState.byChannel)) {
    const rate = stats.sent > 0 ? ((stats.replied / stats.sent) * 100).toFixed(1) : "0.0";
    lines.push(`    ${channel}: ${stats.sent} sent, ${stats.replied} replied (${rate}%)`);
  }
  lines.push("");

  // Gap Analysis
  lines.push("Gap Analysis");
  lines.push("------------");
  lines.push(`  Remaining Sends:   ${output.gap.remainingSent}`);
  lines.push(`  Required Batches:  ${output.gap.requiredBatches}`);
  lines.push(`  Latest Send By:    ${output.gap.latestSendBy || "N/A (threshold met)"}`);
  lines.push("");

  // Channel Mix
  if (output.gap.channelMix.length > 0) {
    lines.push("  Recommended Channel Mix:");
    for (const entry of output.gap.channelMix) {
      lines.push(`    ${entry.channel}: ${entry.count}`);
    }
  } else {
    lines.push("  Channel Mix: [] (threshold met)");
  }
  lines.push("");

  // Recommendation
  lines.push("Recommendation");
  lines.push("--------------");
  lines.push(`  ${output.recommendation}`);
  lines.push(`  Threshold Met: ${output.thresholdMet}`);
  lines.push("");

  // Timestamp
  lines.push(`Timestamp: ${output.timestamp}`);

  return lines.join("\n");
}

// ============================================================================
// Main Entry Point
// ============================================================================

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate required arguments
  if (!args.briefPath) {
    console.error("Error: --brief is required");
    printHelp();
    process.exit(1);
  }

  if (!args.runSheetPath) {
    console.error("Error: --run-sheet is required");
    printHelp();
    process.exit(1);
  }

  if (!args.responsesPath) {
    console.error("Error: --responses is required");
    printHelp();
    process.exit(1);
  }

  // Set default format
  const format = args.format || "json";

  // Determine timestamp
  const timestamp = args.now || new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // Load files
  const briefContent = loadFile(args.briefPath, "INVALID_BRIEF", "OFFER_BRIEF");
  const runSheetContent = loadFile(args.runSheetPath, "INVALID_RUN_SHEET", "Run sheet");
  const responsesContent = loadFile(args.responsesPath, "INVALID_RESPONSE_LOG", "Response log");

  // Parse OFFER_BRIEF.md for thresholds (TP003)
  const threshold = parseOfferBrief(briefContent, resolve(args.briefPath));

  // Parse run sheet (TP004)
  const runSheet = parseRunSheet(runSheetContent, resolve(args.runSheetPath));

  // Parse response log (TP004)
  const responseLog = parseResponseLog(
    responsesContent,
    resolve(args.responsesPath),
    runSheet
  );

  // Derive current state (TP004)
  const currentState = deriveCurrentState(runSheet, responseLog, timestamp);

  // Extract latest send timestamp for latestSendBy calculation (TP007)
  const latestSentTimestamp = extractLatestSentTimestamp(runSheet);

  // Calculate gap metrics (TP005, TP007)
  const gap = calculateGap(threshold, currentState, args.batchSize, timestamp, latestSentTimestamp);

  // Determine threshold met status
  const thresholdMet =
    currentState.totalSent >= threshold.minSent &&
    currentState.totalReplied >= threshold.minReplies;

  // Determine recommendation
  let recommendation: PlannerOutput["recommendation"];
  if (thresholdMet) {
    recommendation = "THRESHOLD_MET";
  } else if (currentState.pending > 0 && gap.remainingSent === 0) {
    recommendation = "HOLD";
  } else {
    recommendation = "SEND_MORE";
  }

  // Build output envelope
  const output: PlannerOutput = {
    status: "ok",
    threshold,
    currentState,
    gap,
    thresholdMet,
    recommendation,
    timestamp,
  };

  // Output result
  if (format === "json") {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatHumanOutput(output));
  }
}

// Run main if executed directly
if (import.meta.main) {
  main();
}

export {
  parseArgs,
  parseFrontmatter,
  parseMarkdownTable,
  loadFile,
  parseOfferBrief,
  parseRunSheet,
  parseResponseLog,
  deriveCurrentState,
  extractLatestSentTimestamp,
  calculateGap,
  calculateChannelMix,
  formatHumanOutput,
  DEFAULT_BATCH_CADENCE_HOURS,
  ERROR_CODES,
};

export type {
  CliArgs,
  ParsedFrontmatter,
  RunSheetRow,
  ResponseLogRow,
  RunSheetData,
  ResponseLogData,
  ThresholdData,
  ChannelStats,
  CurrentState,
  ChannelMixEntry,
  GapOutput,
  PlannerOutput,
};
