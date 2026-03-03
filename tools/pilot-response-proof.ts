#!/usr/bin/env bun

/**
 * Pilot Response Proof Validator
 *
 * Validates that non-pending response-log rows have corresponding immutable
 * proof records in the pilot-reply-proof-index.ndjson file.
 *
 * Usage:
 *   bun run pilot:response-proof -- --responses <path> --evidence <path> --format json
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ============================================================================
// Error Codes
// ============================================================================

const ERROR_CODES = {
  MISSING_RESPONSES: { code: "MISSING_RESPONSES", exit: 1 },
  MISSING_EVIDENCE: { code: "MISSING_EVIDENCE", exit: 2 },
  INVALID_RESPONSES_PATH: { code: "INVALID_RESPONSES_PATH", exit: 3 },
  INVALID_EVIDENCE_PATH: { code: "INVALID_EVIDENCE_PATH", exit: 4 },
  INVALID_FORMAT: { code: "INVALID_FORMAT", exit: 5 },
  PARSE_ERROR: { code: "PARSE_ERROR", exit: 6 },
  VALIDATION_ERRORS: { code: "VALIDATION_ERRORS", exit: 7 },
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

/**
 * Rule ID for deterministic error classification
 */
type RuleId =
  | "MISSING_REPLY_PROOF"
  | "RECIPIENT_MISMATCH"
  | "RESPONSE_TIMESTAMP_DRIFT"
  | "DUPLICATE_MESSAGE_ID_IN_PROOF_INDEX"
  | "INVALID_SOURCE_EXPORT_HASH"
  | "INVALID_RESPONSE_TIMESTAMP"
  | "INVALID_CHANNEL"
  | "MALFORMED_PROOF_RECORD"
  | "MALFORMED_RESPONSE_LOG";

/**
 * Deterministic error entry for validation failures
 */
interface ValidationError {
  ruleId: RuleId;
  recipient?: string;
  messageId?: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Proof index record schema (from pilot-reply-proof-index.ndjson)
 */
interface ProofRecord {
  recipientKey: string;
  messageId: string;
  sourceExportHash: string;
  responseTimestamp: string;
  channel: "X DM" | "Discord DM" | "Email";
  provenance?: {
    sourceFile?: string;
    exportTimestamp?: string;
    exportTool?: string;
    rawMessageHash?: string;
  };
}

/**
 * Response log row schema (parsed from pilot-response-log.md)
 */
interface ResponseLogRow {
  recipient: string;
  sourceChannel: string;
  workflowSentence: string;
  objectionType: string;
  wtp: string | number;
  nextStepDecision: "advance" | "nurture" | "disqualify" | "pending";
  decisionRationale: string;
  responseState: string;
  responseTimestamp?: string;
}

/**
 * Deterministic command output envelope
 */
interface ProofOutput {
  status: "pass" | "fail";
  /** Total rows in response log */
  totalRows: number;
  /** Rows with non-pending decision state (eligible for proof validation) */
  eligibleDecisions: number;
  /** Rows with pending decision state (ignored, non-blocking) */
  ignoredPending: number;
  /** Recipients of pending rows for traceability */
  pendingRecipients: string[];
  /** Number of rows that passed validation */
  validated: number;
  errors: ValidationError[];
  responsesPath: string;
  evidencePath: string;
  timestamp: string;
}

/**
 * CLI argument structure
 */
interface CliArgs {
  responsesPath?: string;
  evidencePath?: string;
  format?: "json" | "human";
  help: boolean;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function printHelp(): void {
  console.log(`
Pilot Response Proof Validator

Validates that non-pending response-log rows have corresponding immutable
proof records in the pilot-reply-proof-index.ndjson file.

USAGE:
  bun run pilot:response-proof -- --responses <path> --evidence <path> --format json
  bun run tools/pilot-response-proof.ts --responses <path> --evidence <path> --format json

OPTIONS:
  --responses <path>   Path to pilot-response-log markdown file (required)
  --evidence <path>    Path to pilot-reply-proof-index.ndjson file (required)
  --format <format>    Output format: "json" or "human" (default: json)
  --help, -h           Show this help message

OUTPUT:
  Deterministic command output envelope with:
  - status: "pass" | "fail"
  - eligibleDecisions: Number of non-pending decision rows
  - validated: Number of validated rows
  - errors: Array of deterministic error entries with rule IDs

ERROR RULE IDs:
  MISSING_REPLY_PROOF              - Non-pending response-log row has no matching proof record
  RECIPIENT_MISMATCH               - Proof record recipientKey does not match response-log Recipient
  RESPONSE_TIMESTAMP_DRIFT         - Proof record timestamp differs from response-log timestamp
  DUPLICATE_MESSAGE_ID_IN_PROOF_INDEX - Same messageId appears multiple times in proof index
  INVALID_SOURCE_EXPORT_HASH       - sourceExportHash is not valid SHA-256 hex
  INVALID_RESPONSE_TIMESTAMP       - responseTimestamp is not valid ISO-8601 with Z suffix
  INVALID_CHANNEL                  - channel is not in valid enum set
  MALFORMED_PROOF_RECORD           - Proof record is missing required fields or has invalid types
  MALFORMED_RESPONSE_LOG           - Response log table row is malformed

EXAMPLES:
  # Validate response log against proof index with JSON output
  bun run pilot:response-proof -- \\
    --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \\
    --evidence docs/distribution/first-pilot-2026-02/pilot-reply-proof-index.ndjson \\
    --format json

  # Validate with human-readable output
  bun run pilot:response-proof -- \\
    --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \\
    --evidence docs/distribution/first-pilot-2026-02/pilot-reply-proof-index.ndjson \\
    --format human
`);
}

/**
 * Parse command-line arguments into a structured CliArgs object.
 * Validates that required arguments are present and paths exist.
 */
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

    if (arg === "--evidence") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --evidence");
        process.exit(1);
      }
      args.evidencePath = value;
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
    if (arg.startsWith("--")) {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  return args;
}

/**
 * Validate that required file paths exist and are readable.
 */
function validatePaths(args: CliArgs): void {
  if (!args.responsesPath) {
    console.error("Error: --responses is required");
    printHelp();
    process.exit(ERROR_CODES.MISSING_RESPONSES.exit);
  }

  if (!args.evidencePath) {
    console.error("Error: --evidence is required");
    printHelp();
    process.exit(ERROR_CODES.MISSING_EVIDENCE.exit);
  }

  if (!existsSync(args.responsesPath)) {
    console.error(`Error: Responses file does not exist: ${args.responsesPath}`);
    process.exit(ERROR_CODES.INVALID_RESPONSES_PATH.exit);
  }

  if (!existsSync(args.evidencePath)) {
    console.error(`Error: Evidence file does not exist: ${args.evidencePath}`);
    process.exit(ERROR_CODES.INVALID_EVIDENCE_PATH.exit);
  }
}

// ============================================================================
// Response Log Parsing
// ============================================================================

const VALID_DECISION_STATES = ["advance", "nurture", "disqualify", "pending"] as const;
const VALID_CHANNELS = ["X DM", "Discord DM", "Email"] as const;

/**
 * Parse frontmatter from markdown content.
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, string | string[]>;
  body: string;
} {
  const lines = content.split("\n");

  if (lines[0] !== "---") {
    return { frontmatter: {}, body: content };
  }

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

  const frontmatter: Record<string, string | string[]> = {};

  for (const line of frontmatterLines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: string | string[] = line.slice(colonIndex + 1).trim();

    // Handle arrays
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      if (inner === "") {
        frontmatter[key] = [];
        continue;
      }
      const items = inner
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
      frontmatter[key] = items;
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

/**
 * Parse markdown table from body content.
 */
function parseMarkdownTable(body: string): string[][] {
  const lines = body.split("\n");
  const rows: string[][] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Skip header separator (e.g., | --- | --- |)
    if (trimmed.match(/^\|[\s\-:|]+\|$/)) continue;

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed
        .split("|")
        .slice(1, -1)
        .map((cell) => {
          let value = cell.trim();
          // Strip backticks if present
          if (value.startsWith("`") && value.endsWith("`")) {
            value = value.slice(1, -1);
          }
          return value;
        });

      if (cells.length > 0) {
        rows.push(cells);
      }
    }
  }

  return rows;
}

/**
 * Parse pilot-response-log markdown file into structured rows.
 */
function parseResponseLog(
  content: string,
  filePath: string
): { rows: ResponseLogRow[]; errors: ValidationError[] } {
  const { frontmatter, body } = parseFrontmatter(content);
  const errors: ValidationError[] = [];

  // Validate frontmatter
  if (frontmatter.artifact !== "pilot-response-log") {
    errors.push({
      ruleId: "MALFORMED_RESPONSE_LOG",
      message: `Missing or invalid frontmatter artifact field. Expected "pilot-response-log", got "${frontmatter.artifact || "missing"}"`,
      details: { filePath },
    });
    return { rows: [], errors };
  }

  const tableRows = parseMarkdownTable(body);

  if (tableRows.length === 0) {
    return { rows: [], errors };
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
      errors.push({
        ruleId: "MALFORMED_RESPONSE_LOG",
        message: `Invalid table header. Expected column ${i + 1} to be "${normalizedExpected[i]}", got "${normalizedHeader[i] || "missing"}"`,
        details: { filePath },
      });
      return { rows: [], errors };
    }
  }

  // Parse data rows
  const rows: ResponseLogRow[] = [];

  for (let i = 1; i < tableRows.length; i++) {
    const row = tableRows[i];

    if (row.length !== 8) {
      errors.push({
        ruleId: "MALFORMED_RESPONSE_LOG",
        message: `Row ${i + 1} has ${row.length} columns, expected 8`,
        details: { filePath, rowIndex: i + 1 },
      });
      continue;
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

    // Validate decision state
    if (!VALID_DECISION_STATES.includes(nextStepDecision as typeof VALID_DECISION_STATES[number])) {
      errors.push({
        ruleId: "MALFORMED_RESPONSE_LOG",
        recipient,
        message: `Invalid decision state "${nextStepDecision}" for recipient "${recipient}"`,
        details: { rowIndex: i + 1, validStates: VALID_DECISION_STATES },
      });
      continue;
    }

    rows.push({
      recipient,
      sourceChannel,
      workflowSentence,
      objectionType,
      wtp: wtp === "no response yet" ? wtp : parseFloat(wtp) || wtp,
      nextStepDecision: nextStepDecision as ResponseLogRow["nextStepDecision"],
      decisionRationale,
      responseState,
    });
  }

  return { rows, errors };
}

// ============================================================================
// Non-Pending Filtering (TP003)
// ============================================================================

/**
 * Result of filtering response log rows to non-pending candidates only.
 */
interface FilteredRows {
  /** All parsed rows (for total count) */
  all: ResponseLogRow[];
  /** Rows with non-pending decision state (eligible for proof validation) */
  nonPending: ResponseLogRow[];
  /** Rows with pending decision state (ignored, non-blocking) */
  pending: ResponseLogRow[];
}

/**
 * Deterministically filter response-log rows to non-pending candidates only.
 *
 * This function separates rows into:
 * - nonPending: rows where nextStepDecision is NOT "pending" (eligible for proof validation)
 * - pending: rows where nextStepDecision IS "pending" (ignored, non-blocking)
 *
 * The function preserves the original order of rows (deterministic).
 * Pending rows are not errors - they are simply not yet ready for proof validation.
 *
 * @param rows - All parsed response log rows
 * @returns FilteredRows with all, nonPending, and pending arrays
 */
function filterNonPendingRows(rows: ResponseLogRow[]): FilteredRows {
  const nonPending: ResponseLogRow[] = [];
  const pending: ResponseLogRow[] = [];

  for (const row of rows) {
    if (row.nextStepDecision === "pending") {
      pending.push(row);
    } else {
      nonPending.push(row);
    }
  }

  return {
    all: rows,
    nonPending,
    pending,
  };
}

// ============================================================================
// Proof Index Parsing
// ============================================================================

/**
 * Validate SHA-256 hex hash format.
 */
function isValidSha256(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash);
}

/**
 * Validate ISO-8601 timestamp with Z suffix.
 */
function isValidIsoTimestamp(timestamp: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp);
}

/**
 * Parse pilot-reply-proof-index.ndjson file into structured records.
 */
function parseProofIndex(
  content: string,
  filePath: string
): { records: ProofRecord[]; errors: ValidationError[] } {
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  const records: ProofRecord[] = [];
  const errors: ValidationError[] = [];
  const seenMessageIds = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rowIndex = i + 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      errors.push({
        ruleId: "MALFORMED_PROOF_RECORD",
        message: `Failed to parse row as JSON: ${e instanceof Error ? e.message : "Unknown error"}`,
        details: { rowIndex, line: line.substring(0, 100) },
      });
      continue;
    }

    // Validate required fields
    const record = parsed as Record<string, unknown>;

    if (!record.recipientKey || typeof record.recipientKey !== "string") {
      errors.push({
        ruleId: "MALFORMED_PROOF_RECORD",
        message: "Missing or invalid required field 'recipientKey'",
        details: { rowIndex },
      });
      continue;
    }

    if (!record.messageId || typeof record.messageId !== "string") {
      errors.push({
        ruleId: "MALFORMED_PROOF_RECORD",
        message: "Missing or invalid required field 'messageId'",
        details: { rowIndex, recipientKey: record.recipientKey },
      });
      continue;
    }

    if (!record.sourceExportHash || typeof record.sourceExportHash !== "string") {
      errors.push({
        ruleId: "MALFORMED_PROOF_RECORD",
        message: "Missing or invalid required field 'sourceExportHash'",
        details: { rowIndex, recipientKey: record.recipientKey, messageId: record.messageId },
      });
      continue;
    }

    if (!record.responseTimestamp || typeof record.responseTimestamp !== "string") {
      errors.push({
        ruleId: "MALFORMED_PROOF_RECORD",
        message: "Missing or invalid required field 'responseTimestamp'",
        details: { rowIndex, recipientKey: record.recipientKey, messageId: record.messageId },
      });
      continue;
    }

    if (!record.channel || typeof record.channel !== "string") {
      errors.push({
        ruleId: "MALFORMED_PROOF_RECORD",
        message: "Missing or invalid required field 'channel'",
        details: { rowIndex, recipientKey: record.recipientKey, messageId: record.messageId },
      });
      continue;
    }

    // Validate sourceExportHash format
    if (!isValidSha256(record.sourceExportHash)) {
      errors.push({
        ruleId: "INVALID_SOURCE_EXPORT_HASH",
        messageId: record.messageId,
        recipient: record.recipientKey,
        message: `Invalid SHA-256 hash format: ${record.sourceExportHash}`,
        details: { rowIndex },
      });
      continue;
    }

    // Validate responseTimestamp format
    if (!isValidIsoTimestamp(record.responseTimestamp)) {
      errors.push({
        ruleId: "INVALID_RESPONSE_TIMESTAMP",
        messageId: record.messageId,
        recipient: record.recipientKey,
        message: `Invalid ISO-8601 timestamp format: ${record.responseTimestamp}`,
        details: { rowIndex },
      });
      continue;
    }

    // Validate channel
    if (!VALID_CHANNELS.includes(record.channel as typeof VALID_CHANNELS[number])) {
      errors.push({
        ruleId: "INVALID_CHANNEL",
        messageId: record.messageId,
        recipient: record.recipientKey,
        message: `Invalid channel: ${record.channel}. Must be one of: ${VALID_CHANNELS.join(", ")}`,
        details: { rowIndex, validChannels: VALID_CHANNELS },
      });
      continue;
    }

    // Check for duplicate messageId
    if (seenMessageIds.has(record.messageId)) {
      errors.push({
        ruleId: "DUPLICATE_MESSAGE_ID_IN_PROOF_INDEX",
        messageId: record.messageId,
        recipient: record.recipientKey,
        message: `Duplicate messageId in proof index: ${record.messageId}`,
        details: { rowIndex },
      });
      continue;
    }
    seenMessageIds.add(record.messageId);

    // Build provenance if present
    let provenance: ProofRecord["provenance"] | undefined;
    if (record.provenance && typeof record.provenance === "object") {
      const prov = record.provenance as Record<string, unknown>;
      provenance = {
        sourceFile: prov.sourceFile as string | undefined,
        exportTimestamp: prov.exportTimestamp as string | undefined,
        exportTool: prov.exportTool as string | undefined,
        rawMessageHash: prov.rawMessageHash as string | undefined,
      };
    }

    records.push({
      recipientKey: record.recipientKey,
      messageId: record.messageId,
      sourceExportHash: record.sourceExportHash,
      responseTimestamp: record.responseTimestamp,
      channel: record.channel as ProofRecord["channel"],
      provenance,
    });
  }

  return { records, errors };
}

// ============================================================================
// Timestamp Normalization (TP007)
// ============================================================================

/**
 * Extract and normalize timestamp from responseState field.
 *
 * Response state can be:
 * - "responded YYYY-MM-DD" - extract the date and normalize to ISO-8601
 * - "no response yet" - return null (no timestamp available)
 * - Other formats - attempt to extract date
 *
 * Normalization converts date-only format (YYYY-MM-DD) to ISO-8601 with Z suffix (YYYY-MM-DDT00:00:00Z)
 *
 * @param responseState - The response state string from the response log
 * @returns Normalized ISO-8601 timestamp with Z suffix, or null if not available
 */
function normalizeResponseTimestamp(responseState: string): string | null {
  // Handle "no response yet" case
  if (responseState === "no response yet" || responseState.includes("no response")) {
    return null;
  }

  // Extract date from "responded YYYY-MM-DD" format
  const dateMatch = responseState.match(/\d{4}-\d{2}-\d{2}/);
  if (dateMatch) {
    // Normalize to ISO-8601 with Z suffix (start of day)
    return `${dateMatch[0]}T00:00:00Z`;
  }

  // If already in ISO-8601 format, return as-is
  if (isValidIsoTimestamp(responseState)) {
    return responseState;
  }

  // Unable to extract timestamp
  return null;
}

/**
 * Compare two ISO-8601 timestamps for drift detection.
 *
 * This function compares normalized timestamps and returns true if they differ.
 * Both timestamps must be in ISO-8601 format with Z suffix.
 *
 * @param timestamp1 - First timestamp (from response log, normalized)
 * @param timestamp2 - Second timestamp (from proof record)
 * @returns true if timestamps differ, false if they match
 */
function timestampsDiffer(timestamp1: string | null, timestamp2: string): boolean {
  // If response log has no timestamp, we can't detect drift
  if (timestamp1 === null) {
    return false;
  }

  // Direct string comparison (both are normalized ISO-8601 with Z suffix)
  return timestamp1 !== timestamp2;
}

// ============================================================================
// Row→Proof Matcher (TP005)
// ============================================================================

/**
 * Result of matching response log rows to proof records.
 */
interface MatchResult {
  /** Number of rows that were successfully matched to proof records */
  matched: number;
  /** Errors from the matching process */
  errors: ValidationError[];
  /** Proof records that were used (by messageId) */
  usedProofMessageIds: Set<string>;
}

/**
 * Match non-pending response log rows to proof records.
 *
 * This function implements the row→proof matching logic with:
 * - Channel-based candidate search (find proofs by matching channel)
 * - Exact recipient alignment validation (case-sensitive match between row.recipient and proofRecord.recipientKey)
 * - One-to-one binding (each proof record can only be used once)
 * - MISSING_REPLY_PROOF emission when no matching proof record exists
 * - RECIPIENT_MISMATCH emission when proof recipient identity disagrees with row identity
 *
 * @param nonPendingRows - Response log rows with non-pending decision state
 * @param proofRecords - Valid proof records from the evidence file
 * @returns MatchResult with matched count, errors, and used proof message IDs
 */
function matchRowsToProofs(
  nonPendingRows: ResponseLogRow[],
  proofRecords: ProofRecord[]
): MatchResult {
  const errors: ValidationError[] = [];
  const usedProofMessageIds = new Set<string>();
  let matched = 0;

  // Build a map of proof records by channel for candidate search
  // This allows us to find proofs by channel first, then validate recipient
  const proofByChannel = new Map<string, ProofRecord[]>();
  for (const proof of proofRecords) {
    const existing = proofByChannel.get(proof.channel) || [];
    existing.push(proof);
    proofByChannel.set(proof.channel, existing);
  }

  // Process each non-pending row
  for (const row of nonPendingRows) {
    // Find candidate proofs by channel match
    const candidateProofs = proofByChannel.get(row.sourceChannel) || [];

    // If no proofs exist for this channel, emit MISSING_REPLY_PROOF
    if (candidateProofs.length === 0) {
      errors.push({
        ruleId: "MISSING_REPLY_PROOF",
        recipient: row.recipient,
        message: `No proof record found for non-pending recipient "${row.recipient}" with decision state "${row.nextStepDecision}" on channel "${row.sourceChannel}"`,
        details: {
          recipient: row.recipient,
          decisionState: row.nextStepDecision,
          channel: row.sourceChannel,
          workflowSentence: row.workflowSentence,
        },
      });
      continue;
    }

    // Find an unused proof record that matches the recipient
    // TP006: We search through channel-matched proofs and validate recipient identity
    let matchedProof: ProofRecord | undefined;
    let foundMismatchedRecipient = false;

    for (const proof of candidateProofs) {
      if (usedProofMessageIds.has(proof.messageId)) {
        continue; // Skip already-used proofs
      }

      // TP006: Recipient integrity check - verify proof recipient matches row recipient
      if (proof.recipientKey !== row.recipient) {
        // Found a proof for this channel but wrong recipient - track this for error reporting
        foundMismatchedRecipient = true;
        continue; // Keep looking for a matching recipient
      }

      // Found a proof with matching channel and recipient
      matchedProof = proof;
      break;
    }

    // If we found proofs for this channel but none with matching recipient, emit RECIPIENT_MISMATCH
    if (!matchedProof && foundMismatchedRecipient) {
      // Find an example of mismatched proof for error reporting
      const mismatchedProof = candidateProofs.find(p =>
        !usedProofMessageIds.has(p.messageId) && p.recipientKey !== row.recipient
      );

      if (mismatchedProof) {
        errors.push({
          ruleId: "RECIPIENT_MISMATCH",
          recipient: row.recipient,
          messageId: mismatchedProof.messageId,
          message: `Proof record recipient identity "${mismatchedProof.recipientKey}" does not match response-log row recipient "${row.recipient}"`,
          details: {
            rowRecipient: row.recipient,
            proofRecipient: mismatchedProof.recipientKey,
            messageId: mismatchedProof.messageId,
            channel: row.sourceChannel,
            decisionState: row.nextStepDecision,
          },
        });
      }
      continue;
    }

    // If no usable proof was found (all used or no channel match), emit MISSING_REPLY_PROOF
    if (!matchedProof) {
      errors.push({
        ruleId: "MISSING_REPLY_PROOF",
        recipient: row.recipient,
        message: `All proof records for channel "${row.sourceChannel}" are already bound to other rows, or no proof exists for recipient "${row.recipient}". One-to-one binding requires a unique proof per non-pending row.`,
        details: {
          recipient: row.recipient,
          decisionState: row.nextStepDecision,
          channel: row.sourceChannel,
          candidateCount: candidateProofs.length,
          allUsed: candidateProofs.every(p => usedProofMessageIds.has(p.messageId)),
        },
      });
      continue;
    }

    // TP007: Timestamp integrity check - verify proof timestamp matches response log timestamp
    const normalizedResponseTimestamp = normalizeResponseTimestamp(row.responseState);
    if (timestampsDiffer(normalizedResponseTimestamp, matchedProof.responseTimestamp)) {
      errors.push({
        ruleId: "RESPONSE_TIMESTAMP_DRIFT",
        recipient: row.recipient,
        messageId: matchedProof.messageId,
        message: `Response timestamp drift detected. Normalized response-log timestamp "${normalizedResponseTimestamp || "none"}" differs from immutable proof timestamp "${matchedProof.responseTimestamp}"`,
        details: {
          rowResponseState: row.responseState,
          normalizedResponseTimestamp: normalizedResponseTimestamp || "none",
          proofResponseTimestamp: matchedProof.responseTimestamp,
          messageId: matchedProof.messageId,
          channel: row.sourceChannel,
          decisionState: row.nextStepDecision,
        },
      });
      // Do not mark as matched - timestamp drift is a validation failure
      continue;
    }

    // Mark this proof as used (one-to-one binding)
    usedProofMessageIds.add(matchedProof.messageId);
    matched++;
  }

  return {
    matched,
    errors,
    usedProofMessageIds,
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Format the output envelope in human-readable format.
 */
function formatHumanOutput(output: ProofOutput): string {
  const lines: string[] = [];

  lines.push("Pilot Response Proof Validation");
  lines.push("================================");
  lines.push("");

  // Status summary
  const statusEmoji = output.status === "pass" ? "✅" : "❌";
  lines.push(`Status: ${statusEmoji} ${output.status.toUpperCase()}`);
  lines.push("");

  // Processing summary
  lines.push("Validation Summary");
  lines.push("------------------");
  lines.push(`Responses:     ${output.responsesPath}`);
  lines.push(`Evidence:      ${output.evidencePath}`);
  lines.push(`Timestamp:     ${output.timestamp}`);
  lines.push("");

  // Eligibility summary
  lines.push("Eligibility");
  lines.push("-----------");
  lines.push(`Total Rows:          ${output.totalRows}`);
  lines.push(`Eligible Decisions:  ${output.eligibleDecisions} (non-pending rows)`);
  lines.push(`Ignored Pending:     ${output.ignoredPending} (not yet ready for validation)`);
  lines.push(`Validated:           ${output.validated}`);
  lines.push("");

  // Pending recipients (if any)
  if (output.pendingRecipients.length > 0) {
    lines.push("Pending Recipients (Ignored)");
    lines.push("----------------------------");
    for (const recipient of output.pendingRecipients) {
      lines.push(`  - ${recipient}`);
    }
    lines.push("");
  }

  // Errors
  if (output.errors.length > 0) {
    lines.push("Errors");
    lines.push("------");
    for (const error of output.errors) {
      lines.push(`  [${error.ruleId}] ${error.message}`);
      if (error.recipient) {
        lines.push(`    Recipient: ${error.recipient}`);
      }
      if (error.messageId) {
        lines.push(`    Message ID: ${error.messageId}`);
      }
    }
    lines.push("");
  } else {
    lines.push("No errors found.");
    lines.push("");
  }

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

  // Validate required arguments and paths
  validatePaths(args);

  // Set default format
  const format = args.format || "json";

  // Read response log file
  let responsesContent: string;
  try {
    responsesContent = readFileSync(args.responsesPath!, "utf-8");
  } catch (e) {
    console.error(`Error reading responses file: ${e instanceof Error ? e.message : "Unknown error"}`);
    process.exit(ERROR_CODES.INVALID_RESPONSES_PATH.exit);
  }

  // Read evidence file
  let evidenceContent: string;
  try {
    evidenceContent = readFileSync(args.evidencePath!, "utf-8");
  } catch (e) {
    console.error(`Error reading evidence file: ${e instanceof Error ? e.message : "Unknown error"}`);
    process.exit(ERROR_CODES.INVALID_EVIDENCE_PATH.exit);
  }

  // Parse response log
  const { rows: responseRows, errors: responseErrors } = parseResponseLog(
    responsesContent,
    args.responsesPath!
  );

  // Parse proof index
  const { records: proofRecords, errors: proofErrors } = parseProofIndex(
    evidenceContent,
    args.evidencePath!
  );

  // Combine structural errors (from parsing)
  const structuralErrors: ValidationError[] = [...responseErrors, ...proofErrors];

  // If there are structural errors, we cannot proceed with matching
  if (structuralErrors.length > 0) {
    const output: ProofOutput = {
      status: "fail",
      totalRows: responseRows.length,
      eligibleDecisions: 0,
      ignoredPending: 0,
      pendingRecipients: [],
      validated: 0,
      errors: structuralErrors,
      responsesPath: resolve(args.responsesPath!),
      evidencePath: resolve(args.evidencePath!),
      timestamp: new Date().toISOString(),
    };

    if (format === "json") {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(formatHumanOutput(output));
    }

    process.exit(ERROR_CODES.VALIDATION_ERRORS.exit);
  }

  // TP003: Deterministically filter to non-pending candidates only
  const filtered = filterNonPendingRows(responseRows);
  const eligibleDecisions = filtered.nonPending.length;
  const ignoredPending = filtered.pending.length;
  const pendingRecipients = filtered.pending.map((row) => row.recipient);

  // TP005: Match non-pending rows to proof records
  // This implements row→proof matching with exact recipient alignment,
  // one-to-one binding, and MISSING_REPLY_PROOF emission
  const matchResult = matchRowsToProofs(filtered.nonPending, proofRecords);
  const validated = matchResult.matched;

  // Combine all errors: structural + matching
  const allErrors: ValidationError[] = [...structuralErrors, ...matchResult.errors];

  // Build output envelope
  const status: "pass" | "fail" = allErrors.length === 0 && validated === eligibleDecisions ? "pass" : "fail";

  const output: ProofOutput = {
    status,
    totalRows: filtered.all.length,
    eligibleDecisions,
    ignoredPending,
    pendingRecipients,
    validated,
    errors: allErrors,
    responsesPath: resolve(args.responsesPath!),
    evidencePath: resolve(args.evidencePath!),
    timestamp: new Date().toISOString(),
  };

  // Output result
  if (format === "json") {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatHumanOutput(output));
  }

  // Exit with appropriate code
  if (output.status === "fail") {
    process.exit(ERROR_CODES.VALIDATION_ERRORS.exit);
  }
}

// Run main if executed directly
if (import.meta.main) {
  main();
}

export {
  parseArgs,
  validatePaths,
  parseFrontmatter,
  parseMarkdownTable,
  parseResponseLog,
  filterNonPendingRows,
  parseProofIndex,
  matchRowsToProofs,
  normalizeResponseTimestamp,
  timestampsDiffer,
  formatHumanOutput,
  isValidSha256,
  isValidIsoTimestamp,
  ERROR_CODES,
  VALID_DECISION_STATES,
  VALID_CHANNELS,
};

export type {
  CliArgs,
  RuleId,
  ValidationError,
  ProofRecord,
  ResponseLogRow,
  FilteredRows,
  MatchResult,
  ProofOutput,
};
