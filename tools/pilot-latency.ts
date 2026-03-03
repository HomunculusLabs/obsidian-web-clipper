#!/usr/bin/env bun

/**
 * Pilot Latency Analyzer
 *
 * Analyzes pilot outreach response timing by channel/CTA variant and emits
 * per-batch/per-channel latency metrics in JSON format.
 *
 * Usage:
 *   bun run pilot:latency -- --run-sheet <path> --responses <path> --format json
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ============================================================================
// Error Codes
// ============================================================================

const ERROR_CODES = {
  INVALID_RUN_SHEET: { code: "INVALID_RUN_SHEET", exit: 1 },
  INVALID_RESPONSE_LOG: { code: "INVALID_RESPONSE_LOG", exit: 2 },
  INVALID_TIMESTAMP: { code: "INVALID_TIMESTAMP", exit: 3 },
  RECIPIENT_MISMATCH: { code: "RECIPIENT_MISMATCH", exit: 4 },
  DUPLICATE_RECIPIENT: { code: "DUPLICATE_RECIPIENT", exit: 5 },
  NO_SENT_ROWS: { code: "NO_SENT_ROWS", exit: 6 },
  CHANNEL_MISMATCH: { code: "CHANNEL_MISMATCH", exit: 7 },
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
  cta?: string; // Optional CTA variant identifier
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

interface LoadedArtifacts {
  runSheet: RunSheetData;
  responseLog: ResponseLogData;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliArgs {
  runSheetPath?: string;
  responsesPath?: string;
  format?: "json" | "human";
  help: boolean;
}

function printHelp(): void {
  console.log(`
Pilot Latency Analyzer

Analyzes pilot outreach response timing by channel/CTA variant.

USAGE:
  bun run pilot:latency -- --run-sheet <path> --responses <path> --format json
  bun run tools/pilot-latency.ts --run-sheet <path> --responses <path> --format json

OPTIONS:
  --run-sheet <path>   Path to pilot run sheet markdown file (required)
  --responses <path>   Path to pilot response log markdown file (required)
  --format <format>    Output format: "json" or "human" (default: json)
  --help, -h           Show this help message

OUTPUT:
  Deterministic JSON with latency metrics including:
  - medianHoursToFirstReply
  - p90HoursToFirstReply
  - followupConversionRate
  - coldAgedCount
  - Per-channel breakdowns
  - Per-CTA variant breakdowns (when CTA data is available)

RUN SHEET FORMAT:
  The run sheet must be a markdown file with a table containing:
  - Recipient Handle (string)
  - Channel (string, e.g., "X DM", "Discord DM", "Email")
  - Send Status (one of: "not sent", "sent", "failed", "blocked")
  - Sent Timestamp (ISO-8601 with Z suffix, e.g., "2026-02-27T18:51:34Z")
  - Artifact Link (string)
  - CTA Variant (optional string, for CTA comparison experiments)

EXAMPLES:
  bun run pilot:latency -- \\
    --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \\
    --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \\
    --format json
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
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
// Run Sheet Parsing
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

  // Check if we have an optional CTA column (6th column)
  const hasCTAColumn = normalizedHeader.length === 6 && normalizedHeader[5] === "CTA Variant";

  // Validate required columns
  for (let i = 0; i < normalizedExpected.length; i++) {
    if (normalizedHeader[i] !== normalizedExpected[i]) {
      exitWithError(
        "INVALID_RUN_SHEET",
        `File "${filePath}" has invalid table header. Expected column ${i + 1} to be "${normalizedExpected[i]}", got "${normalizedHeader[i] || "missing"}"`
      );
    }
  }

  // Validate column count
  const expectedColumnCount = hasCTAColumn ? 6 : 5;
  if (normalizedHeader.length !== expectedColumnCount) {
    exitWithError(
      "INVALID_RUN_SHEET",
      `File "${filePath}" has ${normalizedHeader.length} columns, expected ${expectedColumnCount}`
    );
  }

  // Parse data rows
  const rows: RunSheetRow[] = [];
  const recipients = new Set<string>();

  for (let i = 1; i < tableRows.length; i++) {
    const row = tableRows[i];

    const expectedColumnCount = hasCTAColumn ? 6 : 5;
    if (row.length !== expectedColumnCount) {
      exitWithError(
        "INVALID_RUN_SHEET",
        `File "${filePath}" row ${i + 1} has ${row.length} columns, expected ${expectedColumnCount}`
      );
    }

    const [recipientHandle, channel, sendStatus, sentTimestamp, artifactLink, cta] =
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

    // Validate timestamp format (ISO-8601 with Z suffix) for "sent" rows
    if (sendStatus === "sent") {
      const timestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
      if (!timestampRegex.test(sentTimestamp)) {
        exitWithError(
          "INVALID_TIMESTAMP",
          `File "${filePath}" row ${i + 1} has invalid timestamp "${sentTimestamp}". Expected ISO-8601 format with Z suffix (e.g., 2026-02-27T18:51:34Z)`
        );
      }
    }

    const rowObj: RunSheetRow = {
      recipientHandle,
      channel,
      sendStatus: sendStatus as RunSheetRow["sendStatus"],
      sentTimestamp,
      artifactLink,
    };

    // Add CTA if column exists
    if (hasCTAColumn && cta) {
      rowObj.cta = cta;
    }

    rows.push(rowObj);
  }

  // Check for at least one "sent" row
  const sentRows = rows.filter((r) => r.sendStatus === "sent");
  if (sentRows.length === 0) {
    exitWithError(
      "NO_SENT_ROWS",
      `File "${filePath}" has no rows with Send Status "sent"`
    );
  }

  return { frontmatter, rows };
}

// ============================================================================
// Response Log Parsing
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

    // Validate channel match
    const expectedChannel = runSheetRecipients.get(recipient);
    if (sourceChannel !== expectedChannel) {
      exitWithError(
        "CHANNEL_MISMATCH",
        `File "${filePath}" row ${i + 1} has channel mismatch for recipient "${recipient}". Expected "${expectedChannel}", got "${sourceChannel}"`
      );
    }

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
// Artifact Loading
// ============================================================================

function loadArtifacts(
  runSheetPath: string,
  responsesPath: string
): LoadedArtifacts {
  // Resolve paths
  const resolvedRunSheetPath = resolve(runSheetPath);
  const resolvedResponsesPath = resolve(responsesPath);

  // Check if run sheet exists
  if (!existsSync(resolvedRunSheetPath)) {
    exitWithError(
      "INVALID_RUN_SHEET",
      `Run sheet file not found: ${resolvedRunSheetPath}`
    );
  }

  // Check if response log exists
  if (!existsSync(resolvedResponsesPath)) {
    exitWithError(
      "INVALID_RESPONSE_LOG",
      `Response log file not found: ${resolvedResponsesPath}`
    );
  }

  // Load and parse run sheet
  let runSheetContent: string;
  try {
    runSheetContent = readFileSync(resolvedRunSheetPath, "utf-8");
  } catch (err) {
    exitWithError(
      "INVALID_RUN_SHEET",
      `Failed to read run sheet file: ${resolvedRunSheetPath}. ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const runSheet = parseRunSheet(runSheetContent, resolvedRunSheetPath);

  // Load and parse response log
  let responseLogContent: string;
  try {
    responseLogContent = readFileSync(resolvedResponsesPath, "utf-8");
  } catch (err) {
    exitWithError(
      "INVALID_RESPONSE_LOG",
      `Failed to read response log file: ${resolvedResponsesPath}. ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const responseLog = parseResponseLog(
    responseLogContent,
    resolvedResponsesPath,
    runSheet
  );

  return { runSheet, responseLog };
}

// ============================================================================
// Metric Calculation Types
// ============================================================================

interface MetricOutput {
  batchId: string;
  analysisTimestamp: string;
  summary: {
    totalSent: number;
    totalReplied: number;
    totalNoReply: number;
    totalColdAged: number;
    replyRate: number;
  };
  latency: {
    hoursToFirstReply: number[];
    medianHoursToFirstReply: number | null;
    p90HoursToFirstReply: number | null;
    meanHoursToFirstReply: number | null;
  };
  conversion: {
    followupConversionRate: number;
    followupConvertedCount: number;
    followupAttemptedCount: number;
  };
  byChannel: Record<
    string,
    {
      sent: number;
      replied: number;
      replyRate: number;
      medianHoursToFirstReply: number | null;
      coldAgedCount: number;
    }
  >;
  byCTA?: Record<
    string,
    {
      sent: number;
      replied: number;
      replyRate: number;
      medianHoursToFirstReply: number | null;
      coldAgedCount: number;
    }
  >;
}

// ============================================================================
// Metric Calculation Utilities
// ============================================================================

/**
 * Round to 2 decimal places using "half away from zero" rounding
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calculate median of an array of numbers
 */
function calculateMedian(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  if (n % 2 === 1) {
    // Odd length: return middle value
    return round2(sorted[Math.floor(n / 2)]);
  } else {
    // Even length: return average of two middle values
    const mid1 = sorted[n / 2 - 1];
    const mid2 = sorted[n / 2];
    return round2((mid1 + mid2) / 2);
  }
}

/**
 * Calculate 90th percentile using linear interpolation
 */
function calculateP90(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  // For small arrays, use nearest-rank method
  if (n < 10) {
    const rank = Math.ceil(0.9 * n) - 1;
    return round2(sorted[Math.min(rank, n - 1)]);
  }

  // Linear interpolation method
  const r = 0.9 * (n - 1);
  const i_lower = Math.floor(r);
  const i_upper = Math.ceil(r);
  const f = r - i_lower;

  if (i_lower === i_upper) {
    return round2(sorted[i_lower]);
  }

  const p90 = sorted[i_lower] * (1 - f) + sorted[i_upper] * f;
  return round2(p90);
}

/**
 * Calculate mean (average) of an array of numbers
 */
function calculateMean(values: number[]): number | null {
  if (values.length === 0) return null;

  const sum = values.reduce((acc, val) => acc + val, 0);
  return round2(sum / values.length);
}

/**
 * Parse ISO-8601 timestamp to Unix epoch milliseconds
 */
function parseTimestamp(isoString: string): number {
  return new Date(isoString).getTime();
}

/**
 * Detect if a recipient received a follow-up by parsing send outcome log
 */
function detectFollowUpSent(runSheetContent: string, recipient: string): boolean {
  const lines = runSheetContent.split("\n");

  // Count occurrences of recipient in send outcome log
  let sendCount = 0;
  let inSendOutcomeLog = false;

  for (const line of lines) {
    // Detect start of send outcome log section
    if (line.includes("## Send Outcome Log") || line.includes("## Send outcome log")) {
      inSendOutcomeLog = true;
      continue;
    }

    // Detect end of send outcome log section (next heading)
    if (inSendOutcomeLog && line.startsWith("## ")) {
      break;
    }

    // Count sends for this recipient
    if (inSendOutcomeLog && line.includes(recipient) && line.includes("sent")) {
      sendCount++;
    }
  }

  return sendCount > 1;
}

/**
 * Detect if a recipient converted after follow-up
 */
function detectFollowUpConversion(
  response: ResponseLogRow,
  followUpSent: boolean
): boolean {
  if (!followUpSent) return false;

  // Conversion = follow-up was sent AND next-step decision is "advance"
  return response.nextStepDecision === "advance";
}

/**
 * Calculate hours between two timestamps
 */
function calculateHoursBetween(startMs: number, endMs: number): number {
  return (endMs - startMs) / (1000 * 60 * 60);
}

// ============================================================================
// Metric Engine
// ============================================================================

function calculateMetrics(
  runSheet: RunSheetData,
  responseLog: ResponseLogData,
  runSheetContent: string
): MetricOutput {
  const analysisTimestamp = new Date().toISOString();
  const batchId = runSheet.frontmatter.batch || "unknown";

  // Filter to only "sent" rows
  const sentRows = runSheet.rows.filter((r) => r.sendStatus === "sent");

  // Build response map for quick lookup
  const responseMap = new Map<string, ResponseLogRow>();
  for (const row of responseLog.rows) {
    responseMap.set(row.recipient, row);
  }

  // Calculate per-recipient metrics
  const recipientMetrics: Array<{
    recipient: string;
    channel: string;
    cta?: string;
    hasReplied: boolean;
    hoursToFirstReply: number | null;
    isColdAged: boolean;
    followUpSent: boolean;
    followUpConverted: boolean;
  }> = [];

  for (const sentRow of sentRows) {
    const response = responseMap.get(sentRow.recipientHandle);
    if (!response) continue; // Should not happen due to validation

    const hasReplied = response.responseState !== "no response yet";

    // Calculate hours to first reply
    let hoursToFirstReply: number | null = null;
    if (hasReplied) {
      // Since response log doesn't have first reply timestamp yet,
      // we need to check if there's a timestamp in the response
      // For now, we'll skip calculating this for replied recipients
      // unless we have explicit timestamp data

      // FUTURE: Parse response.responseState or other fields for timestamp
      // For TP003, we'll mark replied but won't have precise hours
      // This matches the contract: "exclude from hoursToFirstReply calculations but count in reply totals"
    }

    // Calculate cold-aged status (72 hours threshold)
    const sentTimestamp = parseTimestamp(sentRow.sentTimestamp);
    const hoursSinceSend = calculateHoursBetween(sentTimestamp, Date.now());
    const isColdAged = !hasReplied && hoursSinceSend > 72;

    // Detect follow-up
    const followUpSent = detectFollowUpSent(runSheetContent, sentRow.recipientHandle);
    const followUpConverted = detectFollowUpConversion(response, followUpSent);

    const metric: typeof recipientMetrics[number] = {
      recipient: sentRow.recipientHandle,
      channel: sentRow.channel,
      hasReplied,
      hoursToFirstReply,
      isColdAged,
      followUpSent,
      followUpConverted,
    };

    // Add CTA if present
    if (sentRow.cta) {
      metric.cta = sentRow.cta;
    }

    recipientMetrics.push(metric);
  }

  // Calculate summary metrics
  const totalSent = sentRows.length;
  const totalReplied = recipientMetrics.filter((r) => r.hasReplied).length;
  const totalNoReply = totalSent - totalReplied;
  const totalColdAged = recipientMetrics.filter((r) => r.isColdAged).length;
  const replyRate = totalSent > 0 ? round2(totalReplied / totalSent) : 0.0;

  // Calculate latency metrics
  const hoursToFirstReplyArray = recipientMetrics
    .filter((r) => r.hoursToFirstReply !== null)
    .map((r) => r.hoursToFirstReply as number)
    .sort((a, b) => a - b);

  const medianHoursToFirstReply = calculateMedian(hoursToFirstReplyArray);
  const p90HoursToFirstReply = calculateP90(hoursToFirstReplyArray);
  const meanHoursToFirstReply = calculateMean(hoursToFirstReplyArray);

  // Calculate follow-up conversion metrics
  const followupAttemptedCount = recipientMetrics.filter((r) => r.followUpSent).length;
  const followupConvertedCount = recipientMetrics.filter((r) => r.followUpConverted).length;
  const followupConversionRate =
    followupAttemptedCount > 0
      ? round2(followupConvertedCount / followupAttemptedCount)
      : 0.0;

  // Calculate per-channel metrics
  const channelMap = new Map<
    string,
    {
      sent: number;
      replied: number;
      hoursToFirstReply: number[];
      coldAged: number;
    }
  >();

  for (const metric of recipientMetrics) {
    if (!channelMap.has(metric.channel)) {
      channelMap.set(metric.channel, {
        sent: 0,
        replied: 0,
        hoursToFirstReply: [],
        coldAged: 0,
      });
    }

    const channelData = channelMap.get(metric.channel)!;
    channelData.sent++;
    if (metric.hasReplied) channelData.replied++;
    if (metric.hoursToFirstReply !== null) {
      channelData.hoursToFirstReply.push(metric.hoursToFirstReply);
    }
    if (metric.isColdAged) channelData.coldAged++;
  }

  // Build byChannel output with sorted keys
  const byChannel: MetricOutput["byChannel"] = {};
  const sortedChannels = Array.from(channelMap.keys()).sort();

  for (const channel of sortedChannels) {
    const data = channelMap.get(channel)!;
    byChannel[channel] = {
      sent: data.sent,
      replied: data.replied,
      replyRate: data.sent > 0 ? round2(data.replied / data.sent) : 0.0,
      medianHoursToFirstReply: calculateMedian(data.hoursToFirstReply),
      coldAgedCount: data.coldAged,
    };
  }

  // Calculate per-CTA metrics (if CTA data is available)
  let byCTA: MetricOutput["byCTA"] | undefined;
  const hasCTAData = recipientMetrics.some((r) => r.cta !== undefined);

  if (hasCTAData) {
    const ctaMap = new Map<
      string,
      {
        sent: number;
        replied: number;
        hoursToFirstReply: number[];
        coldAged: number;
      }
    >();

    for (const metric of recipientMetrics) {
      if (!metric.cta) continue; // Skip recipients without CTA

      if (!ctaMap.has(metric.cta)) {
        ctaMap.set(metric.cta, {
          sent: 0,
          replied: 0,
          hoursToFirstReply: [],
          coldAged: 0,
        });
      }

      const ctaData = ctaMap.get(metric.cta)!;
      ctaData.sent++;
      if (metric.hasReplied) ctaData.replied++;
      if (metric.hoursToFirstReply !== null) {
        ctaData.hoursToFirstReply.push(metric.hoursToFirstReply);
      }
      if (metric.isColdAged) ctaData.coldAged++;
    }

    // Build byCTA output with sorted keys
    byCTA = {};
    const sortedCTAs = Array.from(ctaMap.keys()).sort();

    for (const cta of sortedCTAs) {
      const data = ctaMap.get(cta)!;
      byCTA[cta] = {
        sent: data.sent,
        replied: data.replied,
        replyRate: data.sent > 0 ? round2(data.replied / data.sent) : 0.0,
        medianHoursToFirstReply: calculateMedian(data.hoursToFirstReply),
        coldAgedCount: data.coldAged,
      };
    }
  }

  const output: MetricOutput = {
    batchId,
    analysisTimestamp,
    summary: {
      totalSent,
      totalReplied,
      totalNoReply,
      totalColdAged,
      replyRate,
    },
    latency: {
      hoursToFirstReply: hoursToFirstReplyArray.map(round2),
      medianHoursToFirstReply,
      p90HoursToFirstReply,
      meanHoursToFirstReply,
    },
    conversion: {
      followupConversionRate,
      followupConvertedCount,
      followupAttemptedCount,
    },
    byChannel,
  };

  // Add byCTA if available
  if (byCTA) {
    output.byCTA = byCTA;
  }

  return output;
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

  // Load artifacts (this validates and parses both files)
  const artifacts = loadArtifacts(args.runSheetPath, args.responsesPath);

  // Read raw run sheet content for follow-up detection
  const runSheetContent = readFileSync(resolve(args.runSheetPath), "utf-8");

  // Calculate metrics
  const metrics = calculateMetrics(
    artifacts.runSheet,
    artifacts.responseLog,
    runSheetContent
  );

  // Output results
  if (format === "json") {
    console.log(JSON.stringify(metrics, null, 2));
  } else {
    console.log("Pilot Latency Analysis");
    console.log("======================");
    console.log(`Batch: ${metrics.batchId}`);
    console.log(`Analysis Time: ${metrics.analysisTimestamp}`);
    console.log("");
    console.log("Summary:");
    console.log(`  Total Sent: ${metrics.summary.totalSent}`);
    console.log(`  Total Replied: ${metrics.summary.totalReplied}`);
    console.log(`  Total No Reply: ${metrics.summary.totalNoReply}`);
    console.log(`  Total Cold-Aged (>72h): ${metrics.summary.totalColdAged}`);
    console.log(`  Reply Rate: ${(metrics.summary.replyRate * 100).toFixed(1)}%`);
    console.log("");
    console.log("Latency Metrics:");
    if (metrics.latency.medianHoursToFirstReply !== null) {
      console.log(`  Median Hours to First Reply: ${metrics.latency.medianHoursToFirstReply}`);
      console.log(`  P90 Hours to First Reply: ${metrics.latency.p90HoursToFirstReply}`);
      console.log(`  Mean Hours to First Reply: ${metrics.latency.meanHoursToFirstReply}`);
    } else {
      console.log("  No replies received yet");
    }
    console.log("");
    console.log("Follow-up Conversion:");
    console.log(`  Follow-ups Attempted: ${metrics.conversion.followupAttemptedCount}`);
    console.log(`  Follow-ups Converted: ${metrics.conversion.followupConvertedCount}`);
    console.log(`  Conversion Rate: ${(metrics.conversion.followupConversionRate * 100).toFixed(1)}%`);
    console.log("");
    console.log("By Channel:");
    for (const [channel, data] of Object.entries(metrics.byChannel)) {
      console.log(`  ${channel}:`);
      console.log(`    Sent: ${data.sent}`);
      console.log(`    Replied: ${data.replied}`);
      console.log(`    Reply Rate: ${(data.replyRate * 100).toFixed(1)}%`);
      if (data.medianHoursToFirstReply !== null) {
        console.log(`    Median Hours to First Reply: ${data.medianHoursToFirstReply}`);
      }
      console.log(`    Cold-Aged: ${data.coldAgedCount}`);
    }

    // Display byCTA if available
    if (metrics.byCTA && Object.keys(metrics.byCTA).length > 0) {
      console.log("");
      console.log("By CTA Variant:");
      for (const [cta, data] of Object.entries(metrics.byCTA)) {
        console.log(`  ${cta}:`);
        console.log(`    Sent: ${data.sent}`);
        console.log(`    Replied: ${data.replied}`);
        console.log(`    Reply Rate: ${(data.replyRate * 100).toFixed(1)}%`);
        if (data.medianHoursToFirstReply !== null) {
          console.log(`    Median Hours to First Reply: ${data.medianHoursToFirstReply}`);
        }
        console.log(`    Cold-Aged: ${data.coldAgedCount}`);
      }
    }
  }
}

main();
