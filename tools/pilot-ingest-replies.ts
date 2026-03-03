#!/usr/bin/env bun

/**
 * Pilot Reply Ingestion Tool
 *
 * Reads NDJSON input rows from raw inbox/channel exports, normalizes fields,
 * and builds deterministic upsert plans for response-log + event-log.
 *
 * Usage:
 *   bun run pilot:ingest-replies -- --input <path> --responses <path> --events <path> --format json
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";

// ============================================================================
// Error Codes
// ============================================================================

const ERROR_CODES = {
  MISSING_INPUT: { code: "MISSING_INPUT", exit: 1 },
  MISSING_RESPONSES: { code: "MISSING_RESPONSES", exit: 2 },
  MISSING_EVENTS: { code: "MISSING_EVENTS", exit: 3 },
  INVALID_INPUT_PATH: { code: "INVALID_INPUT_PATH", exit: 4 },
  INVALID_RESPONSES_PATH: { code: "INVALID_RESPONSES_PATH", exit: 5 },
  INVALID_EVENTS_PATH: { code: "INVALID_EVENTS_PATH", exit: 6 },
  INVALID_FORMAT: { code: "INVALID_FORMAT", exit: 7 },
  PARSE_ERROR: { code: "PARSE_ERROR", exit: 8 },
  VALIDATION_ERRORS: { code: "VALIDATION_ERRORS", exit: 9 },
  UNKNOWN_RECIPIENT: { code: "UNKNOWN_RECIPIENT", exit: 10 },
  DUPLICATE_MESSAGE_ID: { code: "DUPLICATE_MESSAGE_ID", exit: 11 },
  INVALID_DECISION_STATE: { code: "INVALID_DECISION_STATE", exit: 12 },
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

type Channel = "X DM" | "Discord DM" | "Email";
type ObjectionType = "trust" | "price" | "workflow-fit" | "missing-feature" | "timing" | "other";
type DecisionState = "advance" | "nurture" | "disqualify" | "pending";
type WtpSource = "explicit" | "inferred" | "demo-response";

/**
 * Raw NDJSON input row schema (from inbox/channel exports)
 */
interface RawInputRow {
  messageId: string;
  recipientHandle: string;
  timestamp: string;
  channel: string;
  workflowSentence: string;
  decision?: DecisionState;
  objection?: ObjectionType;
  wtp?: number | null;
  wtpSource?: WtpSource;
  rationale?: string;
}

/**
 * Normalized input row after validation
 */
interface NormalizedInputRow extends RawInputRow {
  rowIndex: number;
  channel: Channel;
}

/**
 * Rule ID for deterministic error classification
 */
type RuleId = 
  | "UNKNOWN_RECIPIENT"
  | "DUPLICATE_MESSAGE_ID"
  | "INVALID_DECISION_STATE"
  | "INVALID_CHANNEL"
  | "INVALID_TIMESTAMP"
  | "INVALID_OBJECTION"
  | "MISSING_MESSAGE_ID"
  | "MISSING_RECIPIENT"
  | "MISSING_TIMESTAMP"
  | "MISSING_WORKFLOW_SENTENCE"
  | "MALFORMED_ROW";

/**
 * Deterministic error entry for malformed/invalid rows
 */
interface IngestError {
  ruleId: RuleId;
  rowIndex: number;
  messageId?: string;
  recipientHandle?: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Upsert plan for response-log entry
 */
interface ResponseLogUpsert {
  recipientHandle: string;
  fields: Partial<{
    workflowSentence: string;
    objectionType: ObjectionType;
    wtp: number | null;
    wtpSource: WtpSource;
    decisionState: DecisionState;
    decisionRationale: string;
    responseState: string;
    responseTimestamp: string;
  }>;
}

/**
 * Upsert plan for event-log entry
 */
interface EventLogUpsert {
  eventId: string;
  eventType: "RECEIVE_REPLY" | "UPDATE_DECISION" | "UPDATE_WTP" | "UPDATE_OBJECTION";
  recipientHandle: string;
  eventTimestamp: string;
  payload: Record<string, unknown>;
}

/**
 * Suppressed entry (duplicate message IDs)
 */
interface SuppressedEntry {
  messageId: string;
  rowIndex: number;
  recipientHandle: string;
  reason: RuleId;
}

/**
 * Deterministic command output envelope
 */
interface IngestOutput {
  status: "success" | "partial" | "failed";
  processed: number;
  upserts: {
    responseLog: number;
    eventLog: number;
  };
  suppressed: number;
  errors: IngestError[];
  responseLogUpserts?: ResponseLogUpsert[];
  eventLogUpserts?: EventLogUpsert[];
  suppressedEntries?: SuppressedEntry[];
  inputPath: string;
  responsesPath: string;
  eventsPath: string;
}

/**
 * CLI argument structure
 */
interface CliArgs {
  inputPath?: string;
  responsesPath?: string;
  eventsPath?: string;
  format?: "json" | "human";
  help: boolean;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function printHelp(): void {
  console.log(`
Pilot Reply Ingestion Tool

Reads NDJSON input rows from raw inbox/channel exports, normalizes fields,
and builds deterministic upsert plans for response-log + event-log.

USAGE:
  bun run pilot:ingest-replies -- --input <path> --responses <path> --events <path>
  bun run tools/pilot-ingest-replies.ts --input <path> --responses <path> --events <path> --format json

OPTIONS:
  --input <path>       Path to NDJSON input file containing raw reply exports (required)
  --responses <path>   Path to pilot-response-log markdown file (required)
  --events <path>      Path to pilot-event-log markdown file (required)
  --format <format>    Output format: "json" or "human" (default: json)
  --help, -h           Show this help message

OUTPUT:
  Deterministic command output envelope with:
  - status: "success" | "partial" | "failed"
  - processed: Number of rows processed
  - upserts: Count of response-log and event-log upserts
  - suppressed: Count of duplicate message IDs suppressed
  - errors: Array of deterministic error entries with rule IDs

ERROR RULE IDs:
  UNKNOWN_RECIPIENT     - Recipient handle not found in existing pilot artifacts
  DUPLICATE_MESSAGE_ID  - Message ID already exists in event history
  INVALID_DECISION_STATE- Decision value is not a valid DecisionState
  INVALID_CHANNEL       - Channel value is not a valid Channel
  INVALID_TIMESTAMP     - Timestamp cannot be parsed
  INVALID_OBJECTION     - Objection value is not a valid ObjectionType
  MISSING_MESSAGE_ID    - Required messageId field is missing
  MISSING_RECIPIENT     - Required recipientHandle field is missing
  MISSING_TIMESTAMP     - Required timestamp field is missing
  MISSING_WORKFLOW_SENTENCE - Required workflowSentence field is missing
  MALFORMED_ROW         - Row cannot be parsed as valid JSON

EXAMPLES:
  # Ingest replies with JSON output
  bun run pilot:ingest-replies -- \\
    --input tests/tools/fixtures/pilot-replies.ndjson \\
    --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \\
    --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \\
    --format json

  # Ingest replies with human-readable output
  bun run pilot:ingest-replies -- \\
    --input tests/tools/fixtures/pilot-replies.ndjson \\
    --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \\
    --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \\
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

    if (arg === "--input") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --input");
        process.exit(1);
      }
      args.inputPath = value;
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

    if (arg === "--events") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --events");
        process.exit(1);
      }
      args.eventsPath = value;
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
  if (!args.inputPath) {
    console.error("Error: --input is required");
    printHelp();
    process.exit(ERROR_CODES.MISSING_INPUT.exit);
  }

  if (!args.responsesPath) {
    console.error("Error: --responses is required");
    printHelp();
    process.exit(ERROR_CODES.MISSING_RESPONSES.exit);
  }

  if (!args.eventsPath) {
    console.error("Error: --events is required");
    printHelp();
    process.exit(ERROR_CODES.MISSING_EVENTS.exit);
  }

  if (!existsSync(args.inputPath)) {
    console.error(`Error: Input file does not exist: ${args.inputPath}`);
    process.exit(ERROR_CODES.INVALID_INPUT_PATH.exit);
  }

  if (!existsSync(args.responsesPath)) {
    console.error(`Error: Responses file does not exist: ${args.responsesPath}`);
    process.exit(ERROR_CODES.INVALID_RESPONSES_PATH.exit);
  }

  if (!existsSync(args.eventsPath)) {
    console.error(`Error: Events file does not exist: ${args.eventsPath}`);
    process.exit(ERROR_CODES.INVALID_EVENTS_PATH.exit);
  }
}

// ============================================================================
// Recipient Resolution (TP004)
// ============================================================================

/**
 * Parse pilot-response-log markdown to extract valid recipient handles.
 * Reads the recipient column from the markdown table.
 */
function parseResponseLogRecipients(content: string): Set<string> {
  const recipients = new Set<string>();
  const lines = content.split("\n");

  let foundHeader = false;
  let recipientColumnIndex = -1;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Check if line looks like a table row
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());

      // Skip header separator (e.g., | --- | --- |)
      if (cells.every((c) => c.match(/^-+$/))) continue;

      // First table row is header - find "Recipient" column
      if (!foundHeader) {
        foundHeader = true;
        recipientColumnIndex = cells.findIndex(
          (c) => c.toLowerCase() === "recipient"
        );
        continue;
      }

      // Extract recipient handle from the Recipient column
      if (recipientColumnIndex >= 0 && cells[recipientColumnIndex]) {
        let handle = cells[recipientColumnIndex];
        // Strip backticks if present (markdown code formatting)
        if (handle.startsWith("`") && handle.endsWith("`")) {
          handle = handle.slice(1, -1);
        }
        if (handle && handle !== "no response yet") {
          recipients.add(handle);
        }
      }
    }
  }

  return recipients;
}

/**
 * Parse pilot-event-log markdown to extract valid recipient handles.
 * Reads the Recipient Handle column from the Events table.
 */
function parseEventLogRecipients(content: string): Set<string> {
  const recipients = new Set<string>();
  const lines = content.split("\n");

  let foundHeader = false;
  let recipientColumnIndex = -1;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Check if line looks like a table row
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());

      // Skip header separator (e.g., | --- | --- |)
      if (cells.every((c) => c.match(/^-+$/))) continue;

      // First table row is header - find "Recipient Handle" column
      if (!foundHeader) {
        foundHeader = true;
        recipientColumnIndex = cells.findIndex(
          (c) => c.toLowerCase().includes("recipient")
        );
        continue;
      }

      // Extract recipient handle from the Recipient Handle column
      if (recipientColumnIndex >= 0 && cells[recipientColumnIndex]) {
        const handle = cells[recipientColumnIndex];
        if (handle) {
          recipients.add(handle);
        }
      }
    }
  }

  return recipients;
}

/**
 * Load and parse both pilot artifacts to build the known recipient set.
 * Combines recipients from both response-log and event-log for comprehensive coverage.
 */
function loadKnownRecipients(
  responsesPath: string,
  eventsPath: string
): Set<string> {
  let recipients = new Set<string>();

  // Parse response log
  try {
    const responsesContent = readFileSync(responsesPath, "utf-8");
    const responseRecipients = parseResponseLogRecipients(responsesContent);
    for (const r of responseRecipients) {
      recipients.add(r);
    }
  } catch (e) {
    // If file doesn't exist or can't be read, continue with empty set
    console.error(
      `Warning: Could not parse response log for recipients: ${e instanceof Error ? e.message : "Unknown error"}`
    );
  }

  // Parse event log
  try {
    const eventsContent = readFileSync(eventsPath, "utf-8");
    const eventRecipients = parseEventLogRecipients(eventsContent);
    for (const r of eventRecipients) {
      recipients.add(r);
    }
  } catch (e) {
    // If file doesn't exist or can't be read, continue
    console.error(
      `Warning: Could not parse event log for recipients: ${e instanceof Error ? e.message : "Unknown error"}`
    );
  }

  return recipients;
}

/**
 * Resolve recipient handle against known recipients.
 * Returns true if valid, false if unknown.
 */
function resolveRecipient(
  recipientHandle: string,
  knownRecipients: Set<string>
): boolean {
  // Direct match
  if (knownRecipients.has(recipientHandle)) {
    return true;
  }

  // Try without leading @ (handles both @user and user formats)
  const normalizedHandle = recipientHandle.replace(/^@/, "");
  if (knownRecipients.has(normalizedHandle)) {
    return true;
  }

  // Try with leading @ (if source has @ but artifact doesn't)
  const withAt = recipientHandle.startsWith("@")
    ? recipientHandle
    : `@${recipientHandle}`;
  if (knownRecipients.has(withAt)) {
    return true;
  }

  return false;
}

// ============================================================================
// Duplicate Detection (TP005)
// ============================================================================

/**
 * Parse pilot-event-log markdown to extract existing message IDs from RECEIVE_REPLY events.
 * Reads the Payload column from RECEIVE_REPLY rows and extracts messageId field.
 */
function parseExistingMessageIds(content: string): Set<string> {
  const messageIds = new Set<string>();
  const lines = content.split("\n");

  let foundHeader = false;
  let eventTypeColumnIndex = -1;
  let payloadColumnIndex = -1;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Check if line looks like a table row
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());

      // Skip header separator (e.g., | --- | --- |)
      if (cells.every((c) => c.match(/^-+$/))) continue;

      // First table row is header - find column indices
      if (!foundHeader) {
        foundHeader = true;
        eventTypeColumnIndex = cells.findIndex(
          (c) => c.toLowerCase().includes("event type") || c.toLowerCase() === "type"
        );
        payloadColumnIndex = cells.findIndex(
          (c) => c.toLowerCase().includes("payload")
        );
        continue;
      }

      // Extract messageId from RECEIVE_REPLY events
      if (eventTypeColumnIndex >= 0 && payloadColumnIndex >= 0) {
        const eventType = cells[eventTypeColumnIndex];
        if (eventType === "RECEIVE_REPLY") {
          const payloadStr = cells[payloadColumnIndex];
          try {
            const payload = JSON.parse(payloadStr);
            if (payload.messageId && typeof payload.messageId === "string") {
              messageIds.add(payload.messageId);
            }
          } catch (e) {
            // If payload can't be parsed, skip this row
            // This is expected for malformed payloads
          }
        }
      }
    }
  }

  return messageIds;
}

/**
 * Load existing message IDs from pilot-event-log to enable duplicate detection.
 */
function loadExistingMessageIds(eventsPath: string): Set<string> {
  try {
    const eventsContent = readFileSync(eventsPath, "utf-8");
    return parseExistingMessageIds(eventsContent);
  } catch (e) {
    // If file doesn't exist or can't be read, return empty set
    console.error(
      `Warning: Could not parse event log for existing message IDs: ${e instanceof Error ? e.message : "Unknown error"}`
    );
    return new Set<string>();
  }
}

/**
 * Detect and suppress duplicate message IDs across input batch and existing events.
 * Returns arrays of unique rows and suppressed entries.
 * Ensures deterministic behavior by processing rows in order and tracking seen IDs.
 */
function suppressDuplicates(
  rows: NormalizedInputRow[],
  existingMessageIds: Set<string>
): {
  uniqueRows: NormalizedInputRow[];
  suppressed: SuppressedEntry[];
} {
  const uniqueRows: NormalizedInputRow[] = [];
  const suppressed: SuppressedEntry[] = [];
  const seenInBatch = new Set<string>();

  for (const row of rows) {
    // Check if messageId already exists in event history
    if (existingMessageIds.has(row.messageId)) {
      suppressed.push({
        messageId: row.messageId,
        rowIndex: row.rowIndex,
        recipientHandle: row.recipientHandle,
        reason: "DUPLICATE_MESSAGE_ID",
      });
      continue;
    }

    // Check if messageId already seen in current batch
    if (seenInBatch.has(row.messageId)) {
      suppressed.push({
        messageId: row.messageId,
        rowIndex: row.rowIndex,
        recipientHandle: row.recipientHandle,
        reason: "DUPLICATE_MESSAGE_ID",
      });
      continue;
    }

    // This is a unique messageId - add to results and track it
    seenInBatch.add(row.messageId);
    uniqueRows.push(row);
  }

  return { uniqueRows, suppressed };
}

/**
 * Sort rows deterministically by timestamp, then by messageId.
 * Ensures stable ordering across runs.
 */
function sortRowsDeterministically(rows: NormalizedInputRow[]): NormalizedInputRow[] {
  return [...rows].sort((a, b) => {
    // First sort by timestamp
    const timestampA = new Date(a.timestamp).getTime();
    const timestampB = new Date(b.timestamp).getTime();
    if (timestampA !== timestampB) {
      return timestampA - timestampB;
    }
    // Then sort by messageId for stable ordering
    return a.messageId.localeCompare(b.messageId);
  });
}

// ============================================================================
// Deterministic Upsert Planner (TP006)
// ============================================================================

/**
 * Parse pilot-event-log to get the next sequence number for a recipient.
 * Returns the highest sequence number found for the given recipient.
 */
function getNextSequenceForRecipient(
  recipientHandle: string,
  eventsPath: string
): number {
  try {
    const eventsContent = readFileSync(eventsPath, "utf-8");
    const lines = eventsContent.split("\n");
    
    let foundHeader = false;
    let eventIdColumnIndex = -1;
    let recipientColumnIndex = -1;
    
    let maxSequence = 0;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        const cells = trimmed
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim());
        
        // Skip header separator
        if (cells.every((c) => c.match(/^-+$/))) continue;
        
        // First table row is header
        if (!foundHeader) {
          foundHeader = true;
          eventIdColumnIndex = cells.findIndex(
            (c) => c.toLowerCase().includes("event id")
          );
          recipientColumnIndex = cells.findIndex(
            (c) => c.toLowerCase().includes("recipient")
          );
          continue;
        }
        
        // Extract sequence from matching recipient rows
        if (eventIdColumnIndex >= 0 && recipientColumnIndex >= 0) {
          const rowRecipient = cells[recipientColumnIndex];
          // Normalize recipient handle for comparison
          const normalizedRow = rowRecipient.replace(/^@/, "");
          const normalizedTarget = recipientHandle.replace(/^@/, "");
          
          if (normalizedRow === normalizedTarget) {
            const eventId = cells[eventIdColumnIndex];
            // Parse sequence from event ID (format: EVENT_TYPE-recipient-NNNN)
            const parts = eventId.split("-");
            if (parts.length >= 3) {
              const sequence = parseInt(parts[parts.length - 1], 10);
              if (!isNaN(sequence) && sequence > maxSequence) {
                maxSequence = sequence;
              }
            }
          }
        }
      }
    }
    
    return maxSequence;
  } catch (e) {
    // If file can't be read, start from 0
    return 0;
  }
}

/**
 * Generate a canonical event ID for a RECEIVE_REPLY event.
 * Format: RECEIVE_REPLY-<recipientHandle>-<sequence>
 * Sequence is zero-padded to 4 digits for stable sorting.
 */
function generateEventId(
  recipientHandle: string,
  sequence: number
): string {
  const normalizedHandle = recipientHandle.replace(/^@/, "");
  const paddedSequence = String(sequence).padStart(4, "0");
  return `RECEIVE_REPLY-${normalizedHandle}-${paddedSequence}`;
}

/**
 * Normalize timestamp to ISO 8601 with Z suffix.
 * Ensures stable timestamp handling across runs.
 */
function normalizeTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${timestamp}`);
  }
  // Return as ISO 8601 with Z suffix
  return date.toISOString();
}

/**
 * Plan event-log upserts for a set of normalized input rows.
 * Creates canonical RECEIVE_REPLY events with stable ordering.
 * 
 * Each event includes:
 * - Event ID: RECEIVE_REPLY-<recipient>-<sequence>
 * - Event Type: RECEIVE_REPLY
 * - Recipient Handle: from input
 * - Event Timestamp: normalized ISO 8601 from input
 * - Payload: { channel, workflowSentence, replyTimestamp, messageId }
 */
function planEventLogUpserts(
  rows: NormalizedInputRow[],
  eventsPath: string
): EventLogUpsert[] {
  const upserts: EventLogUpsert[] = [];
  
  // Track sequence numbers per recipient
  const sequenceByRecipient = new Map<string, number>();
  
  // Sort rows deterministically first
  const sortedRows = sortRowsDeterministically(rows);
  
  for (const row of sortedRows) {
    const normalizedHandle = row.recipientHandle.replace(/^@/, "");
    
    // Get or initialize sequence for this recipient
    let sequence = sequenceByRecipient.get(normalizedHandle);
    if (sequence === undefined) {
      // First occurrence - get max from existing events
      sequence = getNextSequenceForRecipient(normalizedHandle, eventsPath);
    }
    
    // Increment sequence for this event
    sequence++;
    sequenceByRecipient.set(normalizedHandle, sequence);
    
    // Generate canonical event ID
    const eventId = generateEventId(normalizedHandle, sequence);
    
    // Normalize timestamp
    const normalizedTimestamp = normalizeTimestamp(row.timestamp);
    
    // Build payload for RECEIVE_REPLY event
    const payload: Record<string, unknown> = {
      channel: row.channel,
      workflowSentence: row.workflowSentence,
      replyTimestamp: normalizedTimestamp,
      messageId: row.messageId,
    };
    
    // Include optional fields if present
    if (row.decision !== undefined) {
      payload.decision = row.decision;
    }
    if (row.objection !== undefined) {
      payload.objection = row.objection;
    }
    if (row.wtp !== undefined) {
      payload.wtp = row.wtp;
    }
    if (row.wtpSource !== undefined) {
      payload.wtpSource = row.wtpSource;
    }
    if (row.rationale !== undefined) {
      payload.rationale = row.rationale;
    }
    
    upserts.push({
      eventId,
      eventType: "RECEIVE_REPLY",
      recipientHandle: normalizedHandle,
      eventTimestamp: normalizedTimestamp,
      payload,
    });
  }
  
  return upserts;
}

/**
 * Plan response-log upserts for a set of normalized input rows.
 * Creates canonical response-log updates with stable ordering.
 * 
 * Each upsert targets a recipient and includes:
 * - workflowSentence: from input
 * - responseState: "replied"
 * - responseTimestamp: normalized ISO 8601 from input
 * - Optional: decisionState, objectionType, wtp, wtpSource, decisionRationale
 */
function planResponseLogUpserts(
  rows: NormalizedInputRow[]
): ResponseLogUpsert[] {
  const upserts: ResponseLogUpsert[] = [];
  
  // Sort rows deterministically
  const sortedRows = sortRowsDeterministically(rows);
  
  // Group by recipient to handle multiple replies from same recipient
  // (keep the latest values for each field)
  const recipientFields = new Map<string, NormalizedInputRow>();
  
  for (const row of sortedRows) {
    const normalizedHandle = row.recipientHandle.replace(/^@/, "");
    // Later rows (by timestamp) overwrite earlier ones
    recipientFields.set(normalizedHandle, row);
  }
  
  // Build upserts from the final state per recipient
  for (const [recipientHandle, row] of recipientFields) {
    const normalizedTimestamp = normalizeTimestamp(row.timestamp);
    
    const fields: ResponseLogUpsert["fields"] = {
      workflowSentence: row.workflowSentence,
      responseState: "replied",
      responseTimestamp: normalizedTimestamp,
    };
    
    // Add optional fields if present
    if (row.decision !== undefined) {
      fields.decisionState = row.decision;
    }
    if (row.objection !== undefined) {
      fields.objectionType = row.objection;
    }
    if (row.wtp !== undefined) {
      fields.wtp = row.wtp;
    }
    if (row.wtpSource !== undefined) {
      fields.wtpSource = row.wtpSource;
    }
    if (row.rationale !== undefined) {
      fields.decisionRationale = row.rationale;
    }
    
    upserts.push({
      recipientHandle,
      fields,
    });
  }
  
  // Sort upserts by recipient handle for stable output
  upserts.sort((a, b) => a.recipientHandle.localeCompare(b.recipientHandle));
  
  return upserts;
}

/**
 * Build a complete deterministic upsert plan for both event-log and response-log.
 * Returns plans with stable ordering and normalized timestamps.
 */
function buildUpsertPlan(
  rows: NormalizedInputRow[],
  eventsPath: string
): {
  eventLogUpserts: EventLogUpsert[];
  responseLogUpserts: ResponseLogUpsert[];
} {
  // Plan event-log upserts (RECEIVE_REPLY events)
  const eventLogUpserts = planEventLogUpserts(rows, eventsPath);
  
  // Plan response-log upserts
  const responseLogUpserts = planResponseLogUpserts(rows);
  
  return {
    eventLogUpserts,
    responseLogUpserts,
  };
}

// ============================================================================
// NDJSON Parsing and Validation (TP003)
// ============================================================================

const VALID_CHANNELS: Channel[] = ["X DM", "Discord DM", "Email"];
const VALID_DECISION_STATES: DecisionState[] = ["advance", "nurture", "disqualify", "pending"];
const VALID_OBJECTION_TYPES: ObjectionType[] = ["trust", "price", "workflow-fit", "missing-feature", "timing", "other"];

/**
 * Parse NDJSON file into an array of raw input rows.
 * Each line should be a valid JSON object.
 * Returns both parsed rows and any parse errors.
 */
function parseNDJSON(
  content: string
): { rows: RawInputRow[]; errors: IngestError[] } {
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  const rows: RawInputRow[] = [];
  const errors: IngestError[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rowIndex = i + 1; // 1-indexed for human readability

    try {
      const parsed = JSON.parse(line) as RawInputRow;
      rows.push(parsed);
    } catch (e) {
      errors.push({
        ruleId: "MALFORMED_ROW",
        rowIndex,
        message: `Failed to parse row as JSON: ${e instanceof Error ? e.message : "Unknown error"}`,
        details: { line: line.substring(0, 100) },
      });
    }
  }

  return { rows, errors };
}

/**
 * Validate a single raw input row.
 * Returns normalized row on success, or error entry on failure.
 */
function validateRow(
  row: RawInputRow,
  rowIndex: number,
  knownRecipients: Set<string>
): { row?: NormalizedInputRow; error?: IngestError } {
  // Check required fields
  if (!row.messageId || typeof row.messageId !== "string") {
    return {
      error: {
        ruleId: "MISSING_MESSAGE_ID",
        rowIndex,
        recipientHandle: row.recipientHandle,
        message: "Required field 'messageId' is missing or invalid",
      },
    };
  }

  if (!row.recipientHandle || typeof row.recipientHandle !== "string") {
    return {
      error: {
        ruleId: "MISSING_RECIPIENT",
        rowIndex,
        messageId: row.messageId,
        message: "Required field 'recipientHandle' is missing or invalid",
      },
    };
  }

  if (!row.timestamp || typeof row.timestamp !== "string") {
    return {
      error: {
        ruleId: "MISSING_TIMESTAMP",
        rowIndex,
        messageId: row.messageId,
        recipientHandle: row.recipientHandle,
        message: "Required field 'timestamp' is missing or invalid",
      },
    };
  }

  if (!row.workflowSentence || typeof row.workflowSentence !== "string") {
    return {
      error: {
        ruleId: "MISSING_WORKFLOW_SENTENCE",
        rowIndex,
        messageId: row.messageId,
        recipientHandle: row.recipientHandle,
        message: "Required field 'workflowSentence' is missing or invalid",
      },
    };
  }

  // Validate channel
  const channel = row.channel as Channel;
  if (!VALID_CHANNELS.includes(channel)) {
    return {
      error: {
        ruleId: "INVALID_CHANNEL",
        rowIndex,
        messageId: row.messageId,
        recipientHandle: row.recipientHandle,
        message: `Invalid channel '${row.channel}'. Must be one of: ${VALID_CHANNELS.join(", ")}`,
        details: { provided: row.channel, valid: VALID_CHANNELS },
      },
    };
  }

  // Validate decision state if provided
  if (row.decision !== undefined && !VALID_DECISION_STATES.includes(row.decision)) {
    return {
      error: {
        ruleId: "INVALID_DECISION_STATE",
        rowIndex,
        messageId: row.messageId,
        recipientHandle: row.recipientHandle,
        message: `Invalid decision state '${row.decision}'. Must be one of: ${VALID_DECISION_STATES.join(", ")}`,
        details: { provided: row.decision, valid: VALID_DECISION_STATES },
      },
    };
  }

  // Validate objection type if provided
  if (row.objection !== undefined && !VALID_OBJECTION_TYPES.includes(row.objection)) {
    return {
      error: {
        ruleId: "INVALID_OBJECTION",
        rowIndex,
        messageId: row.messageId,
        recipientHandle: row.recipientHandle,
        message: `Invalid objection type '${row.objection}'. Must be one of: ${VALID_OBJECTION_TYPES.join(", ")}`,
        details: { provided: row.objection, valid: VALID_OBJECTION_TYPES },
      },
    };
  }

  // Validate timestamp format (ISO 8601)
  const timestamp = new Date(row.timestamp);
  if (isNaN(timestamp.getTime())) {
    return {
      error: {
        ruleId: "INVALID_TIMESTAMP",
        rowIndex,
        messageId: row.messageId,
        recipientHandle: row.recipientHandle,
        message: `Invalid timestamp format '${row.timestamp}'. Expected ISO 8601 format`,
        details: { provided: row.timestamp },
      },
    };
  }

  // Validate recipient handle against known recipients (TP004)
  if (!resolveRecipient(row.recipientHandle, knownRecipients)) {
    return {
      error: {
        ruleId: "UNKNOWN_RECIPIENT",
        rowIndex,
        messageId: row.messageId,
        recipientHandle: row.recipientHandle,
        message: `Unknown recipient handle '${row.recipientHandle}'. Not found in pilot-response-log or pilot-event-log.`,
        details: {
          provided: row.recipientHandle,
          knownRecipients: Array.from(knownRecipients),
        },
      },
    };
  }

  return {
    row: {
      ...row,
      rowIndex,
      channel,
    },
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Format the output envelope in human-readable format.
 */
function formatHumanOutput(output: IngestOutput): string {
  const lines: string[] = [];

  lines.push("Pilot Reply Ingestion");
  lines.push("=====================");
  lines.push("");

  // Status summary
  const statusEmoji = output.status === "success" ? "✅" : output.status === "partial" ? "⚠️" : "❌";
  lines.push(`Status: ${statusEmoji} ${output.status.toUpperCase()}`);
  lines.push("");

  // Processing summary
  lines.push("Processing Summary");
  lines.push("------------------");
  lines.push(`Input:         ${output.inputPath}`);
  lines.push(`Responses:     ${output.responsesPath}`);
  lines.push(`Events:        ${output.eventsPath}`);
  lines.push(`Processed:     ${output.processed} rows`);
  lines.push("");

  // Upsert summary
  lines.push("Upserts");
  lines.push("-------");
  lines.push(`Response Log:  ${output.upserts.responseLog} entries`);
  lines.push(`Event Log:     ${output.upserts.eventLog} entries`);
  lines.push(`Suppressed:    ${output.suppressed} duplicates`);
  lines.push("");

  // Errors
  if (output.errors.length > 0) {
    lines.push("Errors");
    lines.push("------");
    for (const error of output.errors) {
      lines.push(`  [${error.ruleId}] Row ${error.rowIndex}: ${error.message}`);
      if (error.messageId) {
        lines.push(`    Message ID: ${error.messageId}`);
      }
      if (error.recipientHandle) {
        lines.push(`    Recipient: ${error.recipientHandle}`);
      }
    }
    lines.push("");
  }

  // Suppressed entries
  if (output.suppressedEntries && output.suppressedEntries.length > 0) {
    lines.push("Suppressed (Duplicates)");
    lines.push("----------------------");
    for (const entry of output.suppressedEntries) {
      lines.push(`  [${entry.reason}] ${entry.messageId} (Row ${entry.rowIndex})`);
    }
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

  // Read input file
  let inputContent: string;
  try {
    inputContent = readFileSync(args.inputPath!, "utf-8");
  } catch (e) {
    console.error(`Error reading input file: ${e instanceof Error ? e.message : "Unknown error"}`);
    process.exit(ERROR_CODES.INVALID_INPUT_PATH.exit);
  }

  // Load known recipients from pilot artifacts (TP004)
  const knownRecipients = loadKnownRecipients(args.responsesPath!, args.eventsPath!);

  // Parse NDJSON
  const { rows: rawRows, errors: parseErrors } = parseNDJSON(inputContent);

  // Validate each row
  const normalizedRows: NormalizedInputRow[] = [];
  const validationErrors: IngestError[] = [...parseErrors];

  for (let i = 0; i < rawRows.length; i++) {
    const result = validateRow(rawRows[i], i + 1, knownRecipients);
    if (result.row) {
      normalizedRows.push(result.row);
    } else if (result.error) {
      validationErrors.push(result.error);
    }
  }

  // Load existing message IDs from event log for duplicate detection (TP005)
  const existingMessageIds = loadExistingMessageIds(args.eventsPath!);

  // Suppress duplicate message IDs (TP005)
  const { uniqueRows, suppressed: suppressedEntries } = suppressDuplicates(
    normalizedRows,
    existingMessageIds
  );

  // Sort unique rows deterministically by timestamp, then messageId (TP005)
  const sortedRows = sortRowsDeterministically(uniqueRows);

  // Build deterministic upsert plan (TP006)
  const { eventLogUpserts, responseLogUpserts } = buildUpsertPlan(
    sortedRows,
    args.eventsPath!
  );

  // Build output envelope
  const hasErrors = validationErrors.length > 0;
  const hasSuppressed = suppressedEntries.length > 0;
  const status: "success" | "partial" | "failed" = hasErrors
    ? "failed"
    : hasSuppressed
    ? "partial"
    : "success";

  const output: IngestOutput = {
    status,
    processed: rawRows.length,
    upserts: {
      responseLog: responseLogUpserts.length,
      eventLog: eventLogUpserts.length,
    },
    suppressed: suppressedEntries.length,
    errors: validationErrors,
    inputPath: resolve(args.inputPath!),
    responsesPath: resolve(args.responsesPath!),
    eventsPath: resolve(args.eventsPath!),
  };

  // Add detailed upsert lists if JSON format (for debugging/verification)
  if (format === "json") {
    output.responseLogUpserts = responseLogUpserts;
    output.eventLogUpserts = eventLogUpserts;
    output.suppressedEntries = suppressedEntries;
  }

  // Output result
  if (format === "json") {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatHumanOutput(output));
  }

  // Exit with appropriate code
  if (output.status === "failed") {
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
  parseNDJSON,
  validateRow,
  formatHumanOutput,
  parseResponseLogRecipients,
  parseEventLogRecipients,
  loadKnownRecipients,
  resolveRecipient,
  parseExistingMessageIds,
  loadExistingMessageIds,
  suppressDuplicates,
  sortRowsDeterministically,
  getNextSequenceForRecipient,
  generateEventId,
  normalizeTimestamp,
  planEventLogUpserts,
  planResponseLogUpserts,
  buildUpsertPlan,
  ERROR_CODES,
  VALID_CHANNELS,
  VALID_DECISION_STATES,
  VALID_OBJECTION_TYPES,
};

export type {
  CliArgs,
  RawInputRow,
  NormalizedInputRow,
  RuleId,
  IngestError,
  ResponseLogUpsert,
  EventLogUpsert,
  SuppressedEntry,
  IngestOutput,
};
