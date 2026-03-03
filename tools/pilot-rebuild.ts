#!/usr/bin/env bun

/**
 * Pilot Rebuild Tool
 *
 * Parses and validates the pilot-event-log artifact, providing deterministic
 * ordering and structural validation diagnostics.
 *
 * Usage:
 *   bun run pilot:rebuild -- --events <path>
 *   bun run tools/pilot-rebuild.ts --events <path>
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ============================================================================
// Error Codes
// ============================================================================

const ERROR_CODES = {
  INVALID_EVENT_LOG: { code: "INVALID_EVENT_LOG", exit: 1 },
  INVALID_FRONTMATTER: { code: "INVALID_FRONTMATTER", exit: 2 },
  INVALID_EVENT_TABLE: { code: "INVALID_EVENT_TABLE", exit: 3 },
  INVALID_EVENT_ID: { code: "INVALID_EVENT_ID", exit: 4 },
  INVALID_EVENT_TYPE: { code: "INVALID_EVENT_TYPE", exit: 5 },
  INVALID_TIMESTAMP: { code: "INVALID_TIMESTAMP", exit: 6 },
  INVALID_PAYLOAD: { code: "INVALID_PAYLOAD", exit: 7 },
  VALIDATION_ERRORS: { code: "VALIDATION_ERRORS", exit: 8 },
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

type EventType =
  | "SEND_OUTREACH"
  | "SEND_FOLLOWUP"
  | "RECEIVE_REPLY"
  | "UPDATE_DECISION"
  | "UPDATE_WTP"
  | "UPDATE_OBJECTION"
  | "MARK_FAILED"
  | "MARK_BLOCKED";

type Channel = "X DM" | "Discord DM" | "Email";

type ObjectionType = "trust" | "price" | "workflow-fit" | "missing-feature" | "timing" | "other";

type DecisionState = "advance" | "nurture" | "disqualify" | "pending";

type WtpSource = "explicit" | "inferred" | "demo-response";

interface SendOutreachPayload {
  channel: Channel;
  artifactLink: string;
  ctaVariant?: string;
  immediateOutcome: "no response yet";
}

interface SendFollowupPayload {
  channel: Channel;
  artifactLink: string;
  ctaVariant?: string;
  immediateOutcome: "no response yet";
}

interface ReceiveReplyPayload {
  channel: Channel;
  workflowSentence: string;
  replyTimestamp: string;
}

interface UpdateDecisionPayload {
  decision: DecisionState;
  rationale: string;
}

interface UpdateWtpPayload {
  wtp: number | null;
  source: WtpSource;
}

interface UpdateObjectionPayload {
  objectionType: ObjectionType;
  notes?: string;
}

interface MarkFailedPayload {
  channel: Channel;
  reason: string;
}

interface MarkBlockedPayload {
  channel: Channel;
  reason: string;
}

type EventPayload =
  | SendOutreachPayload
  | SendFollowupPayload
  | ReceiveReplyPayload
  | UpdateDecisionPayload
  | UpdateWtpPayload
  | UpdateObjectionPayload
  | MarkFailedPayload
  | MarkBlockedPayload;

interface PilotEvent {
  eventId: string;
  eventType: EventType;
  recipientHandle: string;
  eventTimestamp: string;
  payload: EventPayload;
}

interface ParsedFrontmatter {
  artifact?: string;
  author?: string;
  created_at?: string;
  batch?: string;
  depends_on?: string[];
  scope?: string[];
  [key: string]: string | number | boolean | string[] | undefined;
}

interface EventLogData {
  frontmatter: ParsedFrontmatter;
  events: PilotEvent[];
}

interface ValidationError {
  ruleId: string;
  severity: "error" | "warning";
  eventId?: string;
  message: string;
  details?: Record<string, unknown>;
}

interface ValidationOutput {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  eventCount: number;
  recipientCount: number;
  batchId: string;
}

// ============================================================================
// Constants
// ============================================================================

const VALID_EVENT_TYPES: EventType[] = [
  "SEND_OUTREACH",
  "SEND_FOLLOWUP",
  "RECEIVE_REPLY",
  "UPDATE_DECISION",
  "UPDATE_WTP",
  "UPDATE_OBJECTION",
  "MARK_FAILED",
  "MARK_BLOCKED",
];

// ============================================================================
// Lifecycle State Machine
// ============================================================================

/**
 * Lifecycle states for a recipient in the pilot outreach flow.
 * These represent the current state of a recipient based on events.
 */
type LifecycleState =
  | "NO_CONTACT"           // No events yet
  | "OUTREACH_SENT"        // SEND_OUTREACH happened
  | "FOLLOWUP_SENT"        // SEND_FOLLOWUP happened (after outreach)
  | "REPLIED"              // RECEIVE_REPLY happened
  | "FAILED"               // MARK_FAILED happened (terminal)
  | "BLOCKED";             // MARK_BLOCKED happened (terminal)

/**
 * Transition matrix defining valid state transitions for each event type.
 * Key: current state
 * Value: map of event type -> valid next state
 * 
 * If an event type is not in the map for a given state, it's an INVALID_TRANSITION.
 */
const TRANSITION_MATRIX: Record<LifecycleState, Partial<Record<EventType, LifecycleState>>> = {
  NO_CONTACT: {
    SEND_OUTREACH: "OUTREACH_SENT",
    // Cannot send followup, receive reply, update, or mark without outreach
  },
  OUTREACH_SENT: {
    SEND_FOLLOWUP: "FOLLOWUP_SENT",
    RECEIVE_REPLY: "REPLIED",
    UPDATE_DECISION: "OUTREACH_SENT",   // Can update decision without reply
    UPDATE_WTP: "OUTREACH_SENT",         // Can update WTP without reply
    UPDATE_OBJECTION: "OUTREACH_SENT",   // Can update objection without reply
    MARK_FAILED: "FAILED",
    MARK_BLOCKED: "BLOCKED",
  },
  FOLLOWUP_SENT: {
    RECEIVE_REPLY: "REPLIED",
    UPDATE_DECISION: "FOLLOWUP_SENT",    // Can update decision without reply
    UPDATE_WTP: "FOLLOWUP_SENT",         // Can update WTP without reply
    UPDATE_OBJECTION: "FOLLOWUP_SENT",   // Can update objection without reply
    MARK_FAILED: "FAILED",
    MARK_BLOCKED: "BLOCKED",
  },
  REPLIED: {
    UPDATE_DECISION: "REPLIED",          // Update decision after reply
    UPDATE_WTP: "REPLIED",               // Update WTP after reply
    UPDATE_OBJECTION: "REPLIED",         // Update objection after reply
    MARK_FAILED: "FAILED",
    MARK_BLOCKED: "BLOCKED",
    // Cannot send outreach or followup after reply
  },
  FAILED: {
    // Terminal state - no events allowed
  },
  BLOCKED: {
    // Terminal state - no events allowed
  },
};

/**
 * Human-readable descriptions for invalid transitions
 */
const INVALID_TRANSITION_REASONS: Record<string, string> = {
  "NO_CONTACT:SEND_FOLLOWUP": "Cannot send follow-up before initial outreach",
  "NO_CONTACT:RECEIVE_REPLY": "Cannot receive reply before sending outreach",
  "NO_CONTACT:UPDATE_DECISION": "Cannot update decision before sending outreach",
  "NO_CONTACT:UPDATE_WTP": "Cannot update WTP before sending outreach",
  "NO_CONTACT:UPDATE_OBJECTION": "Cannot update objection before sending outreach",
  "NO_CONTACT:MARK_FAILED": "Cannot mark failed before sending outreach",
  "NO_CONTACT:MARK_BLOCKED": "Cannot mark blocked before sending outreach",
  "REPLIED:SEND_OUTREACH": "Cannot send outreach after reply received",
  "REPLIED:SEND_FOLLOWUP": "Cannot send follow-up after reply received",
  "FAILED:SEND_OUTREACH": "Cannot send outreach after recipient marked as failed",
  "FAILED:SEND_FOLLOWUP": "Cannot send follow-up after recipient marked as failed",
  "FAILED:RECEIVE_REPLY": "Cannot receive reply after recipient marked as failed",
  "FAILED:UPDATE_DECISION": "Cannot update decision after recipient marked as failed",
  "FAILED:UPDATE_WTP": "Cannot update WTP after recipient marked as failed",
  "FAILED:UPDATE_OBJECTION": "Cannot update objection after recipient marked as failed",
  "BLOCKED:SEND_OUTREACH": "Cannot send outreach after recipient marked as blocked",
  "BLOCKED:SEND_FOLLOWUP": "Cannot send follow-up after recipient marked as blocked",
  "BLOCKED:RECEIVE_REPLY": "Cannot receive reply after recipient marked as blocked",
  "BLOCKED:UPDATE_DECISION": "Cannot update decision after recipient marked as blocked",
  "BLOCKED:UPDATE_WTP": "Cannot update WTP after recipient marked as blocked",
  "BLOCKED:UPDATE_OBJECTION": "Cannot update objection after recipient marked as blocked",
};

// ============================================================================
// Transition Validation
// ============================================================================

interface TransitionError {
  ruleId: "INVALID_TRANSITION";
  severity: "error";
  eventId: string;
  recipientHandle: string;
  currentState: LifecycleState;
  eventType: EventType;
  message: string;
  details: {
    currentState: LifecycleState;
    attemptedEventType: EventType;
    validTransitions: EventType[];
  };
}

/**
 * Validates lifecycle transitions for a recipient's event sequence.
 * 
 * This function processes events in chronological order and validates that
 * each event represents a valid state transition according to the TRANSITION_MATRIX.
 * 
 * @param events - Array of events for a single recipient, must be sorted by timestamp
 * @returns Array of transition errors (empty if all transitions are valid)
 */
function validateTransitionsForRecipient(
  events: PilotEvent[]
): TransitionError[] {
  const errors: TransitionError[] = [];
  let currentState: LifecycleState = "NO_CONTACT";
  
  for (const event of events) {
    const transitionKey = `${currentState}:${event.eventType}` as keyof typeof INVALID_TRANSITION_REASONS;
    
    // Check if this transition is allowed
    const allowedTransitions = TRANSITION_MATRIX[currentState];
    const nextState = allowedTransitions[event.eventType];
    
    if (!nextState) {
      // Invalid transition - emit error
      const reason = INVALID_TRANSITION_REASONS[transitionKey] || 
        `Invalid transition: cannot apply ${event.eventType} in state ${currentState}`;
      
      errors.push({
        ruleId: "INVALID_TRANSITION",
        severity: "error",
        eventId: event.eventId,
        recipientHandle: event.recipientHandle,
        currentState,
        eventType: event.eventType,
        message: reason,
        details: {
          currentState,
          attemptedEventType: event.eventType,
          validTransitions: Object.keys(allowedTransitions) as EventType[],
        },
      });
      
      // Don't update state - continue validating from current state
      // This allows us to catch multiple transition errors
    } else {
      // Valid transition - update state
      currentState = nextState;
    }
  }
  
  return errors;
}

/**
 * Validates lifecycle transitions for all recipients in the event log.
 * 
 * This is the main entry point for transition validation. It groups events
 * by recipient, sorts them chronologically, and validates transitions for each.
 * 
 * @param events - Array of all events (will be grouped by recipient)
 * @returns Array of all transition errors across all recipients
 */
function validateAllTransitions(
  events: PilotEvent[]
): TransitionError[] {
  const allErrors: TransitionError[] = [];
  
  // Group events by recipient
  const eventsByRecipient = new Map<string, PilotEvent[]>();
  for (const event of events) {
    const existing = eventsByRecipient.get(event.recipientHandle) || [];
    existing.push(event);
    eventsByRecipient.set(event.recipientHandle, existing);
  }
  
  // Validate transitions for each recipient
  for (const [recipientHandle, recipientEvents] of eventsByRecipient) {
    // Sort events by timestamp (deterministic)
    const sortedEvents = [...recipientEvents].sort((a, b) => {
      const timestampCompare = a.eventTimestamp.localeCompare(b.eventTimestamp);
      if (timestampCompare !== 0) return timestampCompare;
      // Tie-breaker: event type priority
      const priorityA = EVENT_TYPE_PRIORITY[a.eventType];
      const priorityB = EVENT_TYPE_PRIORITY[b.eventType];
      if (priorityA !== priorityB) return priorityA - priorityB;
      // Final tie-breaker: event ID
      return a.eventId.localeCompare(b.eventId);
    });
    
    const errors = validateTransitionsForRecipient(sortedEvents);
    allErrors.push(...errors);
  }
  
  return allErrors;
}

const VALID_CHANNELS: Channel[] = ["X DM", "Discord DM", "Email"];

const VALID_OBJECTION_TYPES: ObjectionType[] = [
  "trust",
  "price",
  "workflow-fit",
  "missing-feature",
  "timing",
  "other",
];

const VALID_DECISION_STATES: DecisionState[] = [
  "advance",
  "nurture",
  "disqualify",
  "pending",
];

const VALID_WTP_SOURCES: WtpSource[] = ["explicit", "inferred", "demo-response"];

/**
 * Event type priority for deterministic tie-breaking (lower = higher priority)
 */
const EVENT_TYPE_PRIORITY: Record<EventType, number> = {
  MARK_FAILED: 1,
  MARK_BLOCKED: 2,
  SEND_OUTREACH: 3,
  SEND_FOLLOWUP: 4,
  RECEIVE_REPLY: 5,
  UPDATE_OBJECTION: 6,
  UPDATE_WTP: 7,
  UPDATE_DECISION: 8,
};

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliArgs {
  eventsPath?: string;
  runSheetPath?: string;
  responsesPath?: string;
  format?: "json" | "human";
  check: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Pilot Event Log Parser/Validator & Artifact Reducer

Parses and validates the pilot-event-log artifact with deterministic ordering
and structural validation diagnostics. Can also reduce events to canonical
run-sheet and response-log rows.

USAGE:
  bun run pilot:rebuild -- --events <path>
  bun run tools/pilot-rebuild.ts --events <path> --run-sheet <path> --responses <path>
  bun run tools/pilot-rebuild.ts --events <path> --run-sheet <path> --responses <path> --check

OPTIONS:
  --events <path>       Path to pilot-event-log markdown file (required)
  --run-sheet <path>    Path to pilot-run-sheet markdown file (for --check or reduction)
  --responses <path>    Path to pilot-response-log markdown file (for --check or reduction)
  --check               Compare reconstructed rows against provided artifacts
                        Emits ROW_TIMESTAMP_DRIFT, MISSING_EVENT, FIELD_MISMATCH codes
  --format <format>     Output format: "json" or "human" (default: json)
  --help, -h            Show this help message

OUTPUT:
  Deterministic validation report with:
  - Event count and unique recipient count
  - Validation errors (structural issues)
  - Validation warnings (non-fatal issues)
  - Events sorted by (timestamp, type priority, event ID)
  
  When --run-sheet is provided:
  - Reduced run-sheet rows (one per recipient)
  - Send/follow-up timestamps derived from events
  - Duplicate/conflict detection

  When --responses is provided:
  - Reduced response-log rows (one per recipient)
  - Workflow sentence, objection type, WTP derived from events
  - Decision state and rationale derived from events
  - Response timestamp invariants validated

  When --check is provided (requires --run-sheet and/or --responses):
  - Compares reconstructed rows against provided artifacts
  - Emits deterministic mismatch codes:
    - ROW_TIMESTAMP_DRIFT: Timestamps don't match between reconstructed and provided
    - MISSING_EVENT: Provided row has no corresponding events
    - EXTRA_ROW: Reconstructed row not in provided artifact
    - FIELD_MISMATCH: Non-timestamp fields don't match
  - Includes offending recipient/field pointers

EVENT LOG FORMAT:
  The event log must be a markdown file with:
  - Frontmatter with artifact: pilot-event-log
  - Table with columns: Event ID, Event Type, Recipient Handle, Event Timestamp, Payload

EVENT ID FORMAT:
  <eventType>-<recipientHandle>-<sequence>
  Example: SEND_OUTREACH-pilot_alpha-0001

RUN-SHEET REDUCTION RULES:
  - One row per unique recipient handle
  - Send status: failed/blocked/sent/not sent (derived from terminal state)
  - Sent timestamp: earliest SEND_OUTREACH event
  - Follow-up timestamp: latest SEND_FOLLOWUP event
  - Duplicate/conflict detection with deterministic error codes:
    - DUPLICATE_OUTREACH: Multiple SEND_OUTREACH for same recipient
    - MARK_WITHOUT_SEND: MARK event without prior SEND_OUTREACH
    - DUPLICATE_MARK: Multiple MARK events for same recipient
    - FOLLOWUP_WITHOUT_OUTREACH: SEND_FOLLOWUP without SEND_OUTREACH

LIFECYCLE TRANSITION VALIDATION:
  Events are validated against a lifecycle state machine to ensure valid transitions:
  
  States:
    NO_CONTACT → OUTREACH_SENT → FOLLOWUP_SENT → REPLIED
                                        ↓           ↓
                                     FAILED     FAILED
                                        ↓           ↓
                                    BLOCKED     BLOCKED
  
  Valid Transitions:
    - NO_CONTACT → OUTREACH_SENT (via SEND_OUTREACH)
    - OUTREACH_SENT → FOLLOWUP_SENT (via SEND_FOLLOWUP)
    - OUTREACH_SENT → REPLIED (via RECEIVE_REPLY)
    - OUTREACH_SENT → FAILED (via MARK_FAILED)
    - OUTREACH_SENT → BLOCKED (via MARK_BLOCKED)
    - FOLLOWUP_SENT → REPLIED (via RECEIVE_REPLY)
    - FOLLOWUP_SENT → FAILED (via MARK_FAILED)
    - FOLLOWUP_SENT → BLOCKED (via MARK_BLOCKED)
    - REPLIED → FAILED (via MARK_FAILED)
    - REPLIED → BLOCKED (via MARK_BLOCKED)
    - UPDATE events (DECISION/WTP/OBJECTION) allowed after OUTREACH_SENT
  
  Invalid transitions emit INVALID_TRANSITION error with:
    - Current lifecycle state
    - Attempted event type
    - List of valid transitions from current state

RESPONSE-LOG REDUCTION RULES:
  - One row per unique recipient handle
  - Source channel: from first SEND_OUTREACH event
  - Workflow sentence: from RECEIVE_REPLY payload, or "no response yet"
  - Objection type: from UPDATE_OBJECTION payload, or "no response yet"
  - WTP: from UPDATE_WTP payload, or "no response yet"
  - Next-step decision: from UPDATE_DECISION payload, or "pending"
  - Decision rationale: from UPDATE_DECISION payload, or default message
  - Response state: "replied" if RECEIVE_REPLY exists, else "no response yet"
  - Timestamp invariant: REPLY_BEFORE_SEND error if reply precedes send

EXAMPLES:
  # Validate event log only
  bun run pilot:rebuild -- \\
    --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \\
    --format json

  # Reduce events to run-sheet and response-log
  bun run pilot:rebuild -- \\
    --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \\
    --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \\
    --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \\
    --format json

  # Check reconstructed rows against provided artifacts
  bun run pilot:rebuild -- \\
    --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \\
    --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \\
    --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \\
    --check \\
    --format json
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    check: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--check") {
      args.check = true;
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
// Event ID Validation
// ============================================================================

interface EventIdComponents {
  eventType: string;
  recipientHandle: string;
  sequence: string;
}

function parseEventId(eventId: string): EventIdComponents | null {
  // Format: <eventType>-<recipientHandle>-<sequence>
  // Example: SEND_OUTREACH-pilot_alpha-0001
  const parts = eventId.split("-");
  
  if (parts.length < 3) {
    return null;
  }

  // Event type is the first part
  const eventType = parts[0];
  
  // Sequence is the last part (4-digit zero-padded number)
  const sequence = parts[parts.length - 1];
  
  // Recipient handle is everything in between (joined with -)
  const recipientHandle = parts.slice(1, -1).join("-");

  // Validate sequence is a 4-digit number
  if (!/^\d{4}$/.test(sequence)) {
    return null;
  }

  return { eventType, recipientHandle, sequence };
}

function validateEventId(
  eventId: string,
  expectedEventType: EventType,
  expectedRecipient: string,
  errors: ValidationError[]
): boolean {
  const parsed = parseEventId(eventId);
  
  if (!parsed) {
    errors.push({
      ruleId: "MALFORMED_EVENT_ID",
      severity: "error",
      eventId,
      message: `Event ID "${eventId}" does not match expected format: <eventType>-<recipientHandle>-<sequence>`,
      details: { eventId },
    });
    return false;
  }

  // Validate event type matches
  if (parsed.eventType !== expectedEventType) {
    errors.push({
      ruleId: "EVENT_ID_TYPE_MISMATCH",
      severity: "error",
      eventId,
      message: `Event ID "${eventId}" has event type "${parsed.eventType}" but row shows "${expectedEventType}"`,
      details: { eventId, expected: expectedEventType, actual: parsed.eventType },
    });
    return false;
  }

  // Validate recipient handle matches
  if (parsed.recipientHandle !== expectedRecipient) {
    errors.push({
      ruleId: "EVENT_ID_RECIPIENT_MISMATCH",
      severity: "error",
      eventId,
      message: `Event ID "${eventId}" has recipient "${parsed.recipientHandle}" but row shows "${expectedRecipient}"`,
      details: { eventId, expected: expectedRecipient, actual: parsed.recipientHandle },
    });
    return false;
  }

  return true;
}

// ============================================================================
// Timestamp Validation
// ============================================================================

function validateTimestamp(
  timestamp: string,
  eventId: string,
  errors: ValidationError[]
): boolean {
  // Must be ISO-8601 with Z suffix
  const timestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  
  if (!timestampRegex.test(timestamp)) {
    errors.push({
      ruleId: "INVALID_TIMESTAMP_FORMAT",
      severity: "error",
      eventId,
      message: `Timestamp "${timestamp}" is not valid ISO-8601 with Z suffix (e.g., 2026-02-27T18:51:34Z)`,
      details: { timestamp, eventId },
    });
    return false;
  }

  // Check if it parses as a valid date
  const parsed = new Date(timestamp);
  if (isNaN(parsed.getTime())) {
    errors.push({
      ruleId: "INVALID_TIMESTAMP_VALUE",
      severity: "error",
      eventId,
      message: `Timestamp "${timestamp}" is not a valid date`,
      details: { timestamp, eventId },
    });
    return false;
  }

  // Check for future timestamps
  if (parsed.getTime() > Date.now()) {
    errors.push({
      ruleId: "FUTURE_TIMESTAMP",
      severity: "warning",
      eventId,
      message: `Timestamp "${timestamp}" is in the future`,
      details: { timestamp, eventId },
    });
    // Don't fail on future timestamps (just warn)
  }

  return true;
}

// ============================================================================
// Payload Validation
// ============================================================================

function validatePayload(
  payloadString: string,
  eventType: EventType,
  eventId: string,
  errors: ValidationError[]
): EventPayload | null {
  // Try to parse JSON
  let payload: unknown;
  try {
    payload = JSON.parse(payloadString);
  } catch (err) {
    errors.push({
      ruleId: "INVALID_PAYLOAD_JSON",
      severity: "error",
      eventId,
      message: `Payload is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      details: { eventId, payloadPreview: payloadString.substring(0, 100) },
    });
    return null;
  }

  // Validate based on event type
  switch (eventType) {
    case "SEND_OUTREACH":
      return validateSendOutreachPayload(payload, eventId, errors);
    case "SEND_FOLLOWUP":
      return validateSendFollowupPayload(payload, eventId, errors);
    case "RECEIVE_REPLY":
      return validateReceiveReplyPayload(payload, eventId, errors);
    case "UPDATE_DECISION":
      return validateUpdateDecisionPayload(payload, eventId, errors);
    case "UPDATE_WTP":
      return validateUpdateWtpPayload(payload, eventId, errors);
    case "UPDATE_OBJECTION":
      return validateUpdateObjectionPayload(payload, eventId, errors);
    case "MARK_FAILED":
      return validateMarkFailedPayload(payload, eventId, errors);
    case "MARK_BLOCKED":
      return validateMarkBlockedPayload(payload, eventId, errors);
    default:
      errors.push({
        ruleId: "UNKNOWN_EVENT_TYPE",
        severity: "error",
        eventId,
        message: `Unknown event type: ${eventType}`,
        details: { eventType, eventId },
      });
      return null;
  }
}

function validateSendOutreachPayload(
  payload: unknown,
  eventId: string,
  errors: ValidationError[]
): SendOutreachPayload | null {
  if (typeof payload !== "object" || payload === null) {
    errors.push({
      ruleId: "INVALID_PAYLOAD_STRUCTURE",
      severity: "error",
      eventId,
      message: "SEND_OUTREACH payload must be an object",
    });
    return null;
  }

  const p = payload as Record<string, unknown>;

  // Validate channel
  if (!VALID_CHANNELS.includes(p.channel as Channel)) {
    errors.push({
      ruleId: "INVALID_CHANNEL",
      severity: "error",
      eventId,
      message: `Invalid channel "${p.channel}". Must be one of: ${VALID_CHANNELS.join(", ")}`,
    });
    return null;
  }

  // Validate artifactLink
  if (typeof p.artifactLink !== "string" || !p.artifactLink) {
    errors.push({
      ruleId: "MISSING_REQUIRED_FIELD",
      severity: "error",
      eventId,
      message: "SEND_OUTREACH payload missing required field: artifactLink",
    });
    return null;
  }

  // Validate immediateOutcome
  if (p.immediateOutcome !== "no response yet") {
    errors.push({
      ruleId: "INVALID_IMMEDIATE_OUTCOME",
      severity: "error",
      eventId,
      message: `Invalid immediateOutcome "${p.immediateOutcome}". Must be "no response yet"`,
    });
    return null;
  }

  return {
    channel: p.channel as Channel,
    artifactLink: p.artifactLink,
    ctaVariant: p.ctaVariant as string | undefined,
    immediateOutcome: "no response yet",
  };
}

function validateSendFollowupPayload(
  payload: unknown,
  eventId: string,
  errors: ValidationError[]
): SendFollowupPayload | null {
  if (typeof payload !== "object" || payload === null) {
    errors.push({
      ruleId: "INVALID_PAYLOAD_STRUCTURE",
      severity: "error",
      eventId,
      message: "SEND_FOLLOWUP payload must be an object",
    });
    return null;
  }

  const p = payload as Record<string, unknown>;

  // Validate channel
  if (!VALID_CHANNELS.includes(p.channel as Channel)) {
    errors.push({
      ruleId: "INVALID_CHANNEL",
      severity: "error",
      eventId,
      message: `Invalid channel "${p.channel}". Must be one of: ${VALID_CHANNELS.join(", ")}`,
    });
    return null;
  }

  // Validate artifactLink
  if (typeof p.artifactLink !== "string" || !p.artifactLink) {
    errors.push({
      ruleId: "MISSING_REQUIRED_FIELD",
      severity: "error",
      eventId,
      message: "SEND_FOLLOWUP payload missing required field: artifactLink",
    });
    return null;
  }

  // Validate immediateOutcome
  if (p.immediateOutcome !== "no response yet") {
    errors.push({
      ruleId: "INVALID_IMMEDIATE_OUTCOME",
      severity: "error",
      eventId,
      message: `Invalid immediateOutcome "${p.immediateOutcome}". Must be "no response yet"`,
    });
    return null;
  }

  return {
    channel: p.channel as Channel,
    artifactLink: p.artifactLink,
    ctaVariant: p.ctaVariant as string | undefined,
    immediateOutcome: "no response yet",
  };
}

function validateReceiveReplyPayload(
  payload: unknown,
  eventId: string,
  errors: ValidationError[]
): ReceiveReplyPayload | null {
  if (typeof payload !== "object" || payload === null) {
    errors.push({
      ruleId: "INVALID_PAYLOAD_STRUCTURE",
      severity: "error",
      eventId,
      message: "RECEIVE_REPLY payload must be an object",
    });
    return null;
  }

  const p = payload as Record<string, unknown>;

  // Validate channel
  if (!VALID_CHANNELS.includes(p.channel as Channel)) {
    errors.push({
      ruleId: "INVALID_CHANNEL",
      severity: "error",
      eventId,
      message: `Invalid channel "${p.channel}". Must be one of: ${VALID_CHANNELS.join(", ")}`,
    });
    return null;
  }

  // Validate workflowSentence
  if (typeof p.workflowSentence !== "string" || !p.workflowSentence) {
    errors.push({
      ruleId: "MISSING_REQUIRED_FIELD",
      severity: "error",
      eventId,
      message: "RECEIVE_REPLY payload missing required field: workflowSentence",
    });
    return null;
  }

  // Validate replyTimestamp
  if (typeof p.replyTimestamp !== "string" || !p.replyTimestamp) {
    errors.push({
      ruleId: "MISSING_REQUIRED_FIELD",
      severity: "error",
      eventId,
      message: "RECEIVE_REPLY payload missing required field: replyTimestamp",
    });
    return null;
  }

  // Validate replyTimestamp format
  const timestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  if (!timestampRegex.test(p.replyTimestamp)) {
    errors.push({
      ruleId: "INVALID_REPLY_TIMESTAMP",
      severity: "error",
      eventId,
      message: `replyTimestamp "${p.replyTimestamp}" is not valid ISO-8601 with Z suffix`,
    });
    return null;
  }

  return {
    channel: p.channel as Channel,
    workflowSentence: p.workflowSentence,
    replyTimestamp: p.replyTimestamp,
  };
}

function validateUpdateDecisionPayload(
  payload: unknown,
  eventId: string,
  errors: ValidationError[]
): UpdateDecisionPayload | null {
  if (typeof payload !== "object" || payload === null) {
    errors.push({
      ruleId: "INVALID_PAYLOAD_STRUCTURE",
      severity: "error",
      eventId,
      message: "UPDATE_DECISION payload must be an object",
    });
    return null;
  }

  const p = payload as Record<string, unknown>;

  // Validate decision
  if (!VALID_DECISION_STATES.includes(p.decision as DecisionState)) {
    errors.push({
      ruleId: "INVALID_DECISION_STATE",
      severity: "error",
      eventId,
      message: `Invalid decision "${p.decision}". Must be one of: ${VALID_DECISION_STATES.join(", ")}`,
    });
    return null;
  }

  // Validate rationale
  if (typeof p.rationale !== "string" || !p.rationale) {
    errors.push({
      ruleId: "MISSING_REQUIRED_FIELD",
      severity: "error",
      eventId,
      message: "UPDATE_DECISION payload missing required field: rationale",
    });
    return null;
  }

  return {
    decision: p.decision as DecisionState,
    rationale: p.rationale,
  };
}

function validateUpdateWtpPayload(
  payload: unknown,
  eventId: string,
  errors: ValidationError[]
): UpdateWtpPayload | null {
  if (typeof payload !== "object" || payload === null) {
    errors.push({
      ruleId: "INVALID_PAYLOAD_STRUCTURE",
      severity: "error",
      eventId,
      message: "UPDATE_WTP payload must be an object",
    });
    return null;
  }

  const p = payload as Record<string, unknown>;

  // Validate wtp (can be number or null)
  if (p.wtp !== null && typeof p.wtp !== "number") {
    errors.push({
      ruleId: "INVALID_WTP_VALUE",
      severity: "error",
      eventId,
      message: `Invalid wtp "${p.wtp}". Must be a number or null`,
    });
    return null;
  }

  // Validate source
  if (!VALID_WTP_SOURCES.includes(p.source as WtpSource)) {
    errors.push({
      ruleId: "INVALID_WTP_SOURCE",
      severity: "error",
      eventId,
      message: `Invalid source "${p.source}". Must be one of: ${VALID_WTP_SOURCES.join(", ")}`,
    });
    return null;
  }

  return {
    wtp: p.wtp as number | null,
    source: p.source as WtpSource,
  };
}

function validateUpdateObjectionPayload(
  payload: unknown,
  eventId: string,
  errors: ValidationError[]
): UpdateObjectionPayload | null {
  if (typeof payload !== "object" || payload === null) {
    errors.push({
      ruleId: "INVALID_PAYLOAD_STRUCTURE",
      severity: "error",
      eventId,
      message: "UPDATE_OBJECTION payload must be an object",
    });
    return null;
  }

  const p = payload as Record<string, unknown>;

  // Validate objectionType
  if (!VALID_OBJECTION_TYPES.includes(p.objectionType as ObjectionType)) {
    errors.push({
      ruleId: "INVALID_OBJECTION_TYPE",
      severity: "error",
      eventId,
      message: `Invalid objectionType "${p.objectionType}". Must be one of: ${VALID_OBJECTION_TYPES.join(", ")}`,
    });
    return null;
  }

  return {
    objectionType: p.objectionType as ObjectionType,
    notes: p.notes as string | undefined,
  };
}

function validateMarkFailedPayload(
  payload: unknown,
  eventId: string,
  errors: ValidationError[]
): MarkFailedPayload | null {
  if (typeof payload !== "object" || payload === null) {
    errors.push({
      ruleId: "INVALID_PAYLOAD_STRUCTURE",
      severity: "error",
      eventId,
      message: "MARK_FAILED payload must be an object",
    });
    return null;
  }

  const p = payload as Record<string, unknown>;

  // Validate channel
  if (!VALID_CHANNELS.includes(p.channel as Channel)) {
    errors.push({
      ruleId: "INVALID_CHANNEL",
      severity: "error",
      eventId,
      message: `Invalid channel "${p.channel}". Must be one of: ${VALID_CHANNELS.join(", ")}`,
    });
    return null;
  }

  // Validate reason
  if (typeof p.reason !== "string" || !p.reason) {
    errors.push({
      ruleId: "MISSING_REQUIRED_FIELD",
      severity: "error",
      eventId,
      message: "MARK_FAILED payload missing required field: reason",
    });
    return null;
  }

  return {
    channel: p.channel as Channel,
    reason: p.reason,
  };
}

function validateMarkBlockedPayload(
  payload: unknown,
  eventId: string,
  errors: ValidationError[]
): MarkBlockedPayload | null {
  if (typeof payload !== "object" || payload === null) {
    errors.push({
      ruleId: "INVALID_PAYLOAD_STRUCTURE",
      severity: "error",
      eventId,
      message: "MARK_BLOCKED payload must be an object",
    });
    return null;
  }

  const p = payload as Record<string, unknown>;

  // Validate channel
  if (!VALID_CHANNELS.includes(p.channel as Channel)) {
    errors.push({
      ruleId: "INVALID_CHANNEL",
      severity: "error",
      eventId,
      message: `Invalid channel "${p.channel}". Must be one of: ${VALID_CHANNELS.join(", ")}`,
    });
    return null;
  }

  // Validate reason
  if (typeof p.reason !== "string" || !p.reason) {
    errors.push({
      ruleId: "MISSING_REQUIRED_FIELD",
      severity: "error",
      eventId,
      message: "MARK_BLOCKED payload missing required field: reason",
    });
    return null;
  }

  return {
    channel: p.channel as Channel,
    reason: p.reason,
  };
}

// ============================================================================
// Event Log Parsing
// ============================================================================

function parseEventLog(content: string, filePath: string): EventLogData {
  const { frontmatter, body } = parseFrontmatter(content);

  // Validate frontmatter
  if (frontmatter.artifact !== "pilot-event-log") {
    exitWithError(
      "INVALID_FRONTMATTER",
      `File "${filePath}" missing or invalid frontmatter artifact field. Expected "pilot-event-log", got "${frontmatter.artifact || "missing"}"`
    );
  }

  const tableRows = parseMarkdownTable(body);

  if (tableRows.length === 0) {
    exitWithError(
      "INVALID_EVENT_TABLE",
      `File "${filePath}" contains no valid markdown table rows`
    );
  }

  // First row is header
  const header = tableRows[0];
  const expectedColumns = [
    "Event ID",
    "Event Type",
    "Recipient Handle",
    "Event Timestamp",
    "Payload",
  ];

  // Validate header
  const normalizedHeader = header.map((h) => h.replace(/\s+/g, " ").trim());
  const normalizedExpected = expectedColumns.map((h) => h.trim());

  for (let i = 0; i < normalizedExpected.length; i++) {
    if (normalizedHeader[i] !== normalizedExpected[i]) {
      exitWithError(
        "INVALID_EVENT_TABLE",
        `File "${filePath}" has invalid table header. Expected column ${i + 1} to be "${normalizedExpected[i]}", got "${normalizedHeader[i] || "missing"}"`
      );
    }
  }

  // Parse and validate events
  const events: PilotEvent[] = [];
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (let i = 1; i < tableRows.length; i++) {
    const row = tableRows[i];

    if (row.length !== 5) {
      errors.push({
        ruleId: "INVALID_ROW_COLUMN_COUNT",
        severity: "error",
        message: `Row ${i + 1} has ${row.length} columns, expected 5`,
        details: { row: i + 1, expected: 5, actual: row.length },
      });
      continue;
    }

    const [eventId, eventType, recipientHandle, eventTimestamp, payloadString] =
      row;

    // Validate event type
    if (!VALID_EVENT_TYPES.includes(eventType as EventType)) {
      errors.push({
        ruleId: "INVALID_EVENT_TYPE",
        severity: "error",
        eventId,
        message: `Invalid event type "${eventType}". Must be one of: ${VALID_EVENT_TYPES.join(", ")}`,
        details: { eventType },
      });
      continue;
    }

    // Validate event ID
    const eventIdValid = validateEventId(
      eventId,
      eventType as EventType,
      recipientHandle,
      errors
    );
    if (!eventIdValid) {
      continue;
    }

    // Validate timestamp
    const timestampValid = validateTimestamp(eventTimestamp, eventId, errors);
    if (!timestampValid) {
      continue;
    }

    // Validate payload
    const payload = validatePayload(
      payloadString,
      eventType as EventType,
      eventId,
      errors
    );
    if (!payload) {
      continue;
    }

    events.push({
      eventId,
      eventType: eventType as EventType,
      recipientHandle,
      eventTimestamp,
      payload,
    });
  }

  // If there are errors, report them
  if (errors.length > 0) {
    console.error(`Validation failed with ${errors.length} error(s):\n`);
    for (const error of errors) {
      console.error(`  [${error.ruleId}] ${error.message}`);
      if (error.eventId) {
        console.error(`    Event ID: ${error.eventId}`);
      }
    }
    exitWithError("VALIDATION_ERRORS", `Found ${errors.length} validation error(s)`);
  }

  return { frontmatter, events };
}

// ============================================================================
// Deterministic Ordering
// ============================================================================

function sortEventsDeterministically(events: PilotEvent[]): PilotEvent[] {
  return [...events].sort((a, b) => {
    // Primary sort: eventTimestamp ascending
    const timestampCompare = a.eventTimestamp.localeCompare(b.eventTimestamp);
    if (timestampCompare !== 0) {
      return timestampCompare;
    }

    // Secondary sort: event type priority (lower number = higher priority)
    const priorityA = EVENT_TYPE_PRIORITY[a.eventType];
    const priorityB = EVENT_TYPE_PRIORITY[b.eventType];
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    // Tertiary sort: eventId lexicographically ascending
    return a.eventId.localeCompare(b.eventId);
  });
}

// ============================================================================
// Validation Output
// ============================================================================

function createValidationOutput(
  eventLog: EventLogData,
  warnings: ValidationError[]
): ValidationOutput {
  const recipients = new Set(eventLog.events.map((e) => e.recipientHandle));
  const batchId = eventLog.frontmatter.batch || "unknown";

  return {
    valid: true,
    errors: [],
    warnings,
    eventCount: eventLog.events.length,
    recipientCount: recipients.size,
    batchId,
  };
}

// ============================================================================
// Run-Sheet Reducer Types
// ============================================================================

interface RunSheetRow {
  recipientHandle: string;
  channel: Channel;
  sendStatus: "not sent" | "sent" | "failed" | "blocked";
  sentTimestamp: string; // ISO-8601
  artifactLink: string;
  followUpTimestamp?: string; // ISO-8601, optional
}

interface RunSheetReduceError {
  ruleId: string;
  severity: "error" | "warning";
  recipientHandle?: string;
  message: string;
  details?: Record<string, unknown>;
}

interface RunSheetReduceOutput {
  valid: boolean;
  errors: RunSheetReduceError[];
  warnings: RunSheetReduceError[];
  rows: RunSheetRow[];
  recipientCount: number;
}

// ============================================================================
// Response-Log Reducer Types
// ============================================================================

interface ResponseLogRow {
  recipientHandle: string;
  sourceChannel: Channel;
  workflowSentence: string;
  objectionType: ObjectionType | "no response yet";
  wtp: number | "no response yet";
  wtpSource?: WtpSource;
  nextStepDecision: DecisionState;
  decisionRationale: string;
  responseState: string;
  replyTimestamp?: string; // ISO-8601 from RECEIVE_REPLY
}

interface ResponseLogReduceError {
  ruleId: string;
  severity: "error" | "warning";
  recipientHandle?: string;
  message: string;
  details?: Record<string, unknown>;
}

interface ResponseLogReduceOutput {
  valid: boolean;
  errors: ResponseLogReduceError[];
  warnings: ResponseLogReduceError[];
  rows: ResponseLogRow[];
  recipientCount: number;
}

// ============================================================================
// Check Mode Types (TP006)
// ============================================================================

type CheckMismatchCode = 
  | "ROW_TIMESTAMP_DRIFT"
  | "MISSING_EVENT"
  | "EXTRA_ROW"
  | "FIELD_MISMATCH";

interface CheckMismatch {
  ruleId: CheckMismatchCode;
  severity: "error" | "warning";
  recipientHandle: string;
  field?: string;
  expected?: unknown;
  actual?: unknown;
  message: string;
  details?: Record<string, unknown>;
}

interface RunSheetCheckOutput {
  passed: boolean;
  mismatches: CheckMismatch[];
  providedRowCount: number;
  reconstructedRowCount: number;
  matchingRowCount: number;
}

interface ResponseLogCheckOutput {
  passed: boolean;
  mismatches: CheckMismatch[];
  providedRowCount: number;
  reconstructedRowCount: number;
  matchingRowCount: number;
}

interface CheckOutput {
  passed: boolean;
  runSheet?: RunSheetCheckOutput;
  responseLog?: ResponseLogCheckOutput;
}

// ============================================================================
// Run-Sheet Reducer
// ============================================================================

/**
 * Reduces events to canonical run-sheet rows (one row per recipient).
 * 
 * Rules:
 * - One row per unique recipient handle
 * - Send status derived from terminal state:
 *   - MARK_FAILED → "failed"
 *   - MARK_BLOCKED → "blocked"
 *   - Any SEND_OUTREACH/SEND_FOLLOWUP → "sent"
 *   - No send events → "not sent"
 * - Sent timestamp is the earliest SEND_OUTREACH timestamp
 * - Follow-up timestamp is the latest SEND_FOLLOWUP timestamp
 * - Channel is from the first SEND_OUTREACH event
 * - Artifact link is from the first SEND_OUTREACH event
 * - Duplicate/conflict handling:
 *   - Multiple SEND_OUTREACH for same recipient: error (DUPLICATE_OUTREACH)
 *   - MARK_FAILED/MARK_BLOCKED without prior send: error (MARK_WITHOUT_SEND)
 *   - Multiple MARK events: error (DUPLICATE_MARK)
 *   - SEND_FOLLOWUP without SEND_OUTREACH: error (FOLLOWUP_WITHOUT_OUTREACH)
 */
function reduceEventsToRunSheet(
  events: PilotEvent[]
): RunSheetReduceOutput {
  const errors: RunSheetReduceError[] = [];
  const warnings: RunSheetReduceError[] = [];
  
  // Group events by recipient
  const eventsByRecipient = new Map<string, PilotEvent[]>();
  for (const event of events) {
    const existing = eventsByRecipient.get(event.recipientHandle) || [];
    existing.push(event);
    eventsByRecipient.set(event.recipientHandle, existing);
  }
  
  const rows: RunSheetRow[] = [];
  
  for (const [recipientHandle, recipientEvents] of eventsByRecipient) {
    // Sort events by timestamp for this recipient
    const sortedEvents = [...recipientEvents].sort((a, b) => 
      a.eventTimestamp.localeCompare(b.eventTimestamp)
    );
    
    // Collect events by type
    const outreachEvents = sortedEvents.filter(e => e.eventType === "SEND_OUTREACH");
    const followupEvents = sortedEvents.filter(e => e.eventType === "SEND_FOLLOWUP");
    const markFailedEvents = sortedEvents.filter(e => e.eventType === "MARK_FAILED");
    const markBlockedEvents = sortedEvents.filter(e => e.eventType === "MARK_BLOCKED");
    
    // Validation: Check for duplicate outreach
    if (outreachEvents.length > 1) {
      errors.push({
        ruleId: "DUPLICATE_OUTREACH",
        severity: "error",
        recipientHandle,
        message: `Recipient "${recipientHandle}" has ${outreachEvents.length} SEND_OUTREACH events. Only one allowed.`,
        details: {
          eventIds: outreachEvents.map(e => e.eventId),
          timestamps: outreachEvents.map(e => e.eventTimestamp),
        },
      });
      continue;
    }
    
    // Validation: Check for duplicate marks
    const allMarkEvents = [...markFailedEvents, ...markBlockedEvents];
    if (allMarkEvents.length > 1) {
      errors.push({
        ruleId: "DUPLICATE_MARK",
        severity: "error",
        recipientHandle,
        message: `Recipient "${recipientHandle}" has ${allMarkEvents.length} MARK events. Only one allowed.`,
        details: {
          eventIds: allMarkEvents.map(e => e.eventId),
          eventTypes: allMarkEvents.map(e => e.eventType),
        },
      });
      continue;
    }
    
    // Validation: Check for mark without send
    if (allMarkEvents.length > 0 && outreachEvents.length === 0) {
      errors.push({
        ruleId: "MARK_WITHOUT_SEND",
        severity: "error",
        recipientHandle,
        message: `Recipient "${recipientHandle}" has MARK event without SEND_OUTREACH.`,
        details: {
          markEventId: allMarkEvents[0].eventId,
          markEventType: allMarkEvents[0].eventType,
        },
      });
      continue;
    }
    
    // Validation: Check for follow-up without outreach
    if (followupEvents.length > 0 && outreachEvents.length === 0) {
      errors.push({
        ruleId: "FOLLOWUP_WITHOUT_OUTREACH",
        severity: "error",
        recipientHandle,
        message: `Recipient "${recipientHandle}" has SEND_FOLLOWUP without SEND_OUTREACH.`,
        details: {
          followupEventIds: followupEvents.map(e => e.eventId),
        },
      });
      continue;
    }
    
    // Derive row state
    let sendStatus: RunSheetRow["sendStatus"] = "not sent";
    let sentTimestamp = "";
    let channel: Channel = "X DM"; // default
    let artifactLink = "";
    let followUpTimestamp: string | undefined;
    
    // Check for terminal states first
    if (markFailedEvents.length > 0) {
      sendStatus = "failed";
    } else if (markBlockedEvents.length > 0) {
      sendStatus = "blocked";
    } else if (outreachEvents.length > 0) {
      sendStatus = "sent";
    }
    
    // Extract send details from first outreach
    if (outreachEvents.length > 0) {
      const firstOutreach = outreachEvents[0];
      const payload = firstOutreach.payload as SendOutreachPayload;
      sentTimestamp = firstOutreach.eventTimestamp;
      channel = payload.channel;
      artifactLink = payload.artifactLink;
    }
    
    // Extract follow-up timestamp (latest)
    if (followupEvents.length > 0) {
      // Sort by timestamp and take the latest
      const sortedFollowups = [...followupEvents].sort((a, b) => 
        b.eventTimestamp.localeCompare(a.eventTimestamp)
      );
      followUpTimestamp = sortedFollowups[0].eventTimestamp;
      
      // Check for channel consistency
      for (const followup of followupEvents) {
        const payload = followup.payload as SendFollowupPayload;
        if (payload.channel !== channel) {
          warnings.push({
            ruleId: "CHANNEL_MISMATCH",
            severity: "warning",
            recipientHandle,
            message: `Recipient "${recipientHandle}" has follow-up on different channel than outreach.`,
            details: {
              outreachChannel: channel,
              followupChannel: payload.channel,
              followupEventId: followup.eventId,
            },
          });
        }
      }
    }
    
    rows.push({
      recipientHandle,
      channel,
      sendStatus,
      sentTimestamp,
      artifactLink,
      followUpTimestamp,
    });
  }
  
  // Sort rows deterministically by recipient handle
  rows.sort((a, b) => a.recipientHandle.localeCompare(b.recipientHandle));
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    rows,
    recipientCount: rows.length,
  };
}

// ============================================================================
// Response-Log Reducer
// ============================================================================

/**
 * Reduces events to canonical response-log rows (one row per recipient).
 * 
 * Response-log fields are derived as follows:
 * - Recipient Handle: unique recipient identifier
 * - Source Channel: from SEND_OUTREACH event (or SEND_FOLLOWUP if no outreach)
 * - Workflow Sentence: from RECEIVE_REPLY payload, or "no response yet"
 * - Objection Type: from UPDATE_OBJECTION payload, or "no response yet"
 * - WTP ($/mo): from UPDATE_WTP payload, or "no response yet"
 * - Next-Step Decision: from UPDATE_DECISION payload, or "pending"
 * - Decision Rationale: from UPDATE_DECISION payload, or default message based on send state
 * - Response State: from RECEIVE_REPLY (indicates reply received), or "no response yet"
 * 
 * Timestamp invariants:
 * - replyTimestamp must come AFTER sentTimestamp for the same recipient
 * - UPDATE events after RECEIVE_REPLY are valid (updating decision state based on reply)
 */
function reduceEventsToResponseLog(
  events: PilotEvent[],
  runSheetRows: RunSheetRow[]
): ResponseLogReduceOutput {
  const errors: ResponseLogReduceError[] = [];
  const warnings: ResponseLogReduceError[] = [];
  
  // Create a lookup map from run-sheet rows for channel/send info
  const runSheetByRecipient = new Map<string, RunSheetRow>();
  for (const row of runSheetRows) {
    runSheetByRecipient.set(row.recipientHandle, row);
  }
  
  // Group events by recipient
  const eventsByRecipient = new Map<string, PilotEvent[]>();
  for (const event of events) {
    const existing = eventsByRecipient.get(event.recipientHandle) || [];
    existing.push(event);
    eventsByRecipient.set(event.recipientHandle, existing);
  }
  
  const rows: ResponseLogRow[] = [];
  
  for (const [recipientHandle, recipientEvents] of eventsByRecipient) {
    // Sort events by timestamp for this recipient
    const sortedEvents = [...recipientEvents].sort((a, b) => 
      a.eventTimestamp.localeCompare(b.eventTimestamp)
    );
    
    // Collect events by type
    const outreachEvents = sortedEvents.filter(e => e.eventType === "SEND_OUTREACH");
    const followupEvents = sortedEvents.filter(e => e.eventType === "SEND_FOLLOWUP");
    const replyEvents = sortedEvents.filter(e => e.eventType === "RECEIVE_REPLY");
    const decisionEvents = sortedEvents.filter(e => e.eventType === "UPDATE_DECISION");
    const wtpEvents = sortedEvents.filter(e => e.eventType === "UPDATE_WTP");
    const objectionEvents = sortedEvents.filter(e => e.eventType === "UPDATE_OBJECTION");
    
    // Get run-sheet info for this recipient
    const runSheetRow = runSheetByRecipient.get(recipientHandle);
    
    // Derive source channel from first outreach (or follow-up if no outreach)
    let sourceChannel: Channel = "X DM"; // default
    if (outreachEvents.length > 0) {
      const payload = outreachEvents[0].payload as SendOutreachPayload;
      sourceChannel = payload.channel;
    } else if (followupEvents.length > 0) {
      const payload = followupEvents[0].payload as SendFollowupPayload;
      sourceChannel = payload.channel;
    }
    
    // Derive workflow sentence from latest RECEIVE_REPLY
    let workflowSentence = "no response yet";
    let replyTimestamp: string | undefined;
    if (replyEvents.length > 0) {
      // Take the latest reply
      const latestReply = replyEvents[replyEvents.length - 1];
      const payload = latestReply.payload as ReceiveReplyPayload;
      workflowSentence = payload.workflowSentence;
      replyTimestamp = payload.replyTimestamp;
      
      // Validate reply timestamp invariant: must be after send timestamp
      if (runSheetRow?.sentTimestamp) {
        if (payload.replyTimestamp < runSheetRow.sentTimestamp) {
          errors.push({
            ruleId: "REPLY_BEFORE_SEND",
            severity: "error",
            recipientHandle,
            message: `Reply timestamp "${payload.replyTimestamp}" is before send timestamp "${runSheetRow.sentTimestamp}"`,
            details: {
              replyTimestamp: payload.replyTimestamp,
              sentTimestamp: runSheetRow.sentTimestamp,
              replyEventId: latestReply.eventId,
            },
          });
        }
      }
    }
    
    // Derive objection type from latest UPDATE_OBJECTION
    let objectionType: ObjectionType | "no response yet" = "no response yet";
    if (objectionEvents.length > 0) {
      const latestObjection = objectionEvents[objectionEvents.length - 1];
      const payload = latestObjection.payload as UpdateObjectionPayload;
      objectionType = payload.objectionType;
    }
    
    // Derive WTP from latest UPDATE_WTP
    let wtp: number | "no response yet" = "no response yet";
    let wtpSource: WtpSource | undefined;
    if (wtpEvents.length > 0) {
      const latestWtp = wtpEvents[wtpEvents.length - 1];
      const payload = latestWtp.payload as UpdateWtpPayload;
      if (payload.wtp !== null) {
        wtp = payload.wtp;
        wtpSource = payload.source;
      }
    }
    
    // Derive decision from latest UPDATE_DECISION
    let nextStepDecision: DecisionState = "pending";
    let decisionRationale = "";
    if (decisionEvents.length > 0) {
      const latestDecision = decisionEvents[decisionEvents.length - 1];
      const payload = latestDecision.payload as UpdateDecisionPayload;
      nextStepDecision = payload.decision;
      decisionRationale = payload.rationale;
    }
    
    // Generate default rationale if no decision event
    if (!decisionRationale) {
      if (replyEvents.length > 0) {
        decisionRationale = `Reply received at ${replyTimestamp}; awaiting decision.`;
      } else if (outreachEvents.length > 0) {
        // Use follow-up timestamp if available, otherwise sent timestamp
        const latestTimestamp = followupEvents.length > 0
          ? followupEvents[followupEvents.length - 1].eventTimestamp
          : outreachEvents[0].eventTimestamp;
        decisionRationale = `Outreach sent/followed up ${latestTimestamp}; awaiting first reply in CTA format.`;
      } else if (runSheetRow) {
        const latestSend = runSheetRow.followUpTimestamp || runSheetRow.sentTimestamp;
        decisionRationale = `Outreach sent/followed up ${latestSend}; awaiting first reply in CTA format.`;
      } else {
        decisionRationale = `No outreach events found; awaiting send.`;
      }
    }
    
    // Derive response state
    let responseState = "no response yet";
    if (replyEvents.length > 0) {
      responseState = "replied";
    }
    
    rows.push({
      recipientHandle,
      sourceChannel,
      workflowSentence,
      objectionType,
      wtp,
      wtpSource,
      nextStepDecision,
      decisionRationale,
      responseState,
      replyTimestamp,
    });
  }
  
  // Sort rows deterministically by recipient handle
  rows.sort((a, b) => a.recipientHandle.localeCompare(b.recipientHandle));
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    rows,
    recipientCount: rows.length,
  };
}

// ============================================================================
// Check Mode: Parse Existing Artifacts (TP006)
// ============================================================================

/**
 * Parses an existing pilot-run-sheet.md file to extract rows.
 * 
 * Expected table columns:
 * - Recipient Handle
 * - Channel
 * - Send Status
 * - Sent Timestamp (ISO-8601)
 * - Artifact Link
 * - Follow-Up Timestamp (optional)
 */
function parseExistingRunSheet(content: string): RunSheetRow[] {
  const rows: RunSheetRow[] = [];
  const tableRows = parseMarkdownTable(content);
  
  if (tableRows.length === 0) {
    return rows;
  }
  
  // First row is header - find column indices
  const header = tableRows[0].map(h => h.toLowerCase().trim());
  
  const colMap = {
    recipientHandle: header.findIndex(h => h.includes("recipient")),
    channel: header.findIndex(h => h.includes("channel")),
    sendStatus: header.findIndex(h => h.includes("status") || h.includes("send")),
    // Sent timestamp: match "sent timestamp" but exclude "follow-up"
    sentTimestamp: header.findIndex(h => 
      (h.includes("timestamp") || h.includes("sent")) && 
      !h.includes("follow")
    ),
    artifactLink: header.findIndex(h => h.includes("artifact") || h.includes("link")),
    // Follow-up timestamp: match "follow-up timestamp" or "followup"
    followUpTimestamp: header.findIndex(h => 
      h.includes("follow") && h.includes("timestamp")
    ),
  };
  
  // Parse data rows
  for (let i = 1; i < tableRows.length; i++) {
    const row = tableRows[i];
    
    // Skip if row doesn't have enough columns
    if (row.length < 3) continue;
    
    const recipientHandle = colMap.recipientHandle >= 0 
      ? row[colMap.recipientHandle]?.replace(/`/g, "").trim() 
      : "";
    const channel = colMap.channel >= 0 
      ? row[colMap.channel]?.trim() as Channel 
      : "X DM";
    const sendStatus = colMap.sendStatus >= 0 
      ? row[colMap.sendStatus]?.trim() as RunSheetRow["sendStatus"]
      : "not sent";
    const sentTimestamp = colMap.sentTimestamp >= 0 
      ? row[colMap.sentTimestamp]?.trim() 
      : "";
    const artifactLink = colMap.artifactLink >= 0 
      ? row[colMap.artifactLink]?.replace(/\[([^\]]+)\]\([^)]+\)/, "$1").trim()
      : "";
    const followUpTimestamp = colMap.followUpTimestamp >= 0 
      ? row[colMap.followUpTimestamp]?.trim() || undefined
      : undefined;
    
    if (recipientHandle) {
      rows.push({
        recipientHandle,
        channel: VALID_CHANNELS.includes(channel) ? channel : "X DM",
        sendStatus: ["not sent", "sent", "failed", "blocked"].includes(sendStatus) 
          ? sendStatus 
          : "not sent",
        sentTimestamp,
        artifactLink,
        followUpTimestamp,
      });
    }
  }
  
  // Sort deterministically
  rows.sort((a, b) => a.recipientHandle.localeCompare(b.recipientHandle));
  
  return rows;
}

/**
 * Parses an existing pilot-response-log.md file to extract rows.
 * 
 * Expected table columns:
 * - Recipient
 * - Source Channel
 * - Workflow Sentence
 * - Objection Type
 * - WTP ($/mo)
 * - Next-Step Decision
 * - Decision Rationale
 * - Response State
 */
function parseExistingResponseLog(content: string): ResponseLogRow[] {
  const rows: ResponseLogRow[] = [];
  const tableRows = parseMarkdownTable(content);
  
  if (tableRows.length === 0) {
    return rows;
  }
  
  // First row is header - find column indices
  const header = tableRows[0].map(h => h.toLowerCase().trim());
  
  const colMap = {
    recipient: header.findIndex(h => h.includes("recipient")),
    sourceChannel: header.findIndex(h => h.includes("source") || h.includes("channel")),
    workflowSentence: header.findIndex(h => h.includes("workflow")),
    objectionType: header.findIndex(h => h.includes("objection")),
    wtp: header.findIndex(h => h.includes("wtp") || h.includes("willingness")),
    nextStepDecision: header.findIndex(h => h.includes("decision") && !h.includes("rationale")),
    decisionRationale: header.findIndex(h => h.includes("rationale")),
    responseState: header.findIndex(h => h.includes("response") && h.includes("state")),
  };
  
  // Parse data rows
  for (let i = 1; i < tableRows.length; i++) {
    const row = tableRows[i];
    
    // Skip if row doesn't have enough columns
    if (row.length < 3) continue;
    
    const recipientHandle = colMap.recipient >= 0 
      ? row[colMap.recipient]?.replace(/`/g, "").trim() 
      : "";
    const sourceChannel = colMap.sourceChannel >= 0 
      ? row[colMap.sourceChannel]?.trim() as Channel 
      : "X DM";
    const workflowSentence = colMap.workflowSentence >= 0 
      ? row[colMap.workflowSentence]?.replace(/`/g, "").trim() 
      : "no response yet";
    const objectionTypeRaw = colMap.objectionType >= 0 
      ? row[colMap.objectionType]?.replace(/`/g, "").trim() 
      : "no response yet";
    const wtpRaw = colMap.wtp >= 0 
      ? row[colMap.wtp]?.replace(/`/g, "").trim() 
      : "no response yet";
    const nextStepDecision = colMap.nextStepDecision >= 0 
      ? row[colMap.nextStepDecision]?.trim() as DecisionState 
      : "pending";
    const decisionRationale = colMap.decisionRationale >= 0 
      ? row[colMap.decisionRationale]?.trim() 
      : "";
    const responseState = colMap.responseState >= 0 
      ? row[colMap.responseState]?.replace(/`/g, "").trim() 
      : "no response yet";
    
    // Parse WTP (could be "no response yet", "$X/mo", or just a number)
    let wtp: number | "no response yet" = "no response yet";
    if (wtpRaw && wtpRaw !== "no response yet") {
      const numMatch = wtpRaw.match(/\d+/);
      if (numMatch) {
        wtp = parseInt(numMatch[0], 10);
      }
    }
    
    // Validate objection type
    const objectionType: ObjectionType | "no response yet" = 
      VALID_OBJECTION_TYPES.includes(objectionTypeRaw as ObjectionType) 
        ? objectionTypeRaw as ObjectionType 
        : "no response yet";
    
    if (recipientHandle) {
      rows.push({
        recipientHandle,
        sourceChannel: VALID_CHANNELS.includes(sourceChannel) ? sourceChannel : "X DM",
        workflowSentence,
        objectionType,
        wtp,
        nextStepDecision: VALID_DECISION_STATES.includes(nextStepDecision) 
          ? nextStepDecision 
          : "pending",
        decisionRationale,
        responseState,
      });
    }
  }
  
  // Sort deterministically
  rows.sort((a, b) => a.recipientHandle.localeCompare(b.recipientHandle));
  
  return rows;
}

// ============================================================================
// Check Mode: Comparison Logic (TP006)
// ============================================================================

/**
 * Compares reconstructed run-sheet rows against provided rows.
 * 
 * Emits mismatch codes:
 * - ROW_TIMESTAMP_DRIFT: When timestamps don't match
 * - MISSING_EVENT: When a provided row has no corresponding events
 * - EXTRA_ROW: When a reconstructed row has no corresponding provided row
 * - FIELD_MISMATCH: When non-timestamp fields don't match
 */
function checkRunSheet(
  reconstructed: RunSheetRow[],
  provided: RunSheetRow[],
  events: PilotEvent[]
): RunSheetCheckOutput {
  const mismatches: CheckMismatch[] = [];
  
  // Create lookup maps
  const reconstructedByRecipient = new Map<string, RunSheetRow>();
  for (const row of reconstructed) {
    reconstructedByRecipient.set(row.recipientHandle, row);
  }
  
  const providedByRecipient = new Map<string, RunSheetRow>();
  for (const row of provided) {
    providedByRecipient.set(row.recipientHandle, row);
  }
  
  // Get recipients that have events
  const recipientsWithEvents = new Set(events.map(e => e.recipientHandle));
  
  let matchingRowCount = 0;
  
  // Check all provided rows
  for (const providedRow of provided) {
    const reconstructedRow = reconstructedByRecipient.get(providedRow.recipientHandle);
    
    // Check if this recipient has any events
    if (!recipientsWithEvents.has(providedRow.recipientHandle)) {
      mismatches.push({
        ruleId: "MISSING_EVENT",
        severity: "error",
        recipientHandle: providedRow.recipientHandle,
        message: `Recipient "${providedRow.recipientHandle}" exists in provided run-sheet but has no events in event log`,
        details: {
          providedRow,
        },
      });
      continue;
    }
    
    // Check if we have a reconstructed row for this recipient
    if (!reconstructedRow) {
      mismatches.push({
        ruleId: "MISSING_EVENT",
        severity: "error",
        recipientHandle: providedRow.recipientHandle,
        message: `Recipient "${providedRow.recipientHandle}" exists in provided run-sheet but could not be reconstructed from events`,
        details: {
          providedRow,
        },
      });
      continue;
    }
    
    // Compare fields
    let rowMatches = true;
    
    // Check sent timestamp
    if (providedRow.sentTimestamp && reconstructedRow.sentTimestamp) {
      if (providedRow.sentTimestamp !== reconstructedRow.sentTimestamp) {
        mismatches.push({
          ruleId: "ROW_TIMESTAMP_DRIFT",
          severity: "error",
          recipientHandle: providedRow.recipientHandle,
          field: "sentTimestamp",
          expected: reconstructedRow.sentTimestamp,
          actual: providedRow.sentTimestamp,
          message: `Sent timestamp drift for "${providedRow.recipientHandle}": expected "${reconstructedRow.sentTimestamp}" from events, got "${providedRow.sentTimestamp}" in provided run-sheet`,
          details: {
            field: "sentTimestamp",
            expected: reconstructedRow.sentTimestamp,
            actual: providedRow.sentTimestamp,
          },
        });
        rowMatches = false;
      }
    }
    
    // Check follow-up timestamp
    if (providedRow.followUpTimestamp || reconstructedRow.followUpTimestamp) {
      if (providedRow.followUpTimestamp !== reconstructedRow.followUpTimestamp) {
        mismatches.push({
          ruleId: "ROW_TIMESTAMP_DRIFT",
          severity: "error",
          recipientHandle: providedRow.recipientHandle,
          field: "followUpTimestamp",
          expected: reconstructedRow.followUpTimestamp || "none",
          actual: providedRow.followUpTimestamp || "none",
          message: `Follow-up timestamp drift for "${providedRow.recipientHandle}": expected "${reconstructedRow.followUpTimestamp || "none"}" from events, got "${providedRow.followUpTimestamp || "none"}" in provided run-sheet`,
          details: {
            field: "followUpTimestamp",
            expected: reconstructedRow.followUpTimestamp,
            actual: providedRow.followUpTimestamp,
          },
        });
        rowMatches = false;
      }
    }
    
    // Check channel
    if (providedRow.channel !== reconstructedRow.channel) {
      mismatches.push({
        ruleId: "FIELD_MISMATCH",
        severity: "warning",
        recipientHandle: providedRow.recipientHandle,
        field: "channel",
        expected: reconstructedRow.channel,
        actual: providedRow.channel,
        message: `Channel mismatch for "${providedRow.recipientHandle}": expected "${reconstructedRow.channel}" from events, got "${providedRow.channel}" in provided run-sheet`,
        details: {
          field: "channel",
          expected: reconstructedRow.channel,
          actual: providedRow.channel,
        },
      });
      rowMatches = false;
    }
    
    // Check send status
    if (providedRow.sendStatus !== reconstructedRow.sendStatus) {
      mismatches.push({
        ruleId: "FIELD_MISMATCH",
        severity: "warning",
        recipientHandle: providedRow.recipientHandle,
        field: "sendStatus",
        expected: reconstructedRow.sendStatus,
        actual: providedRow.sendStatus,
        message: `Send status mismatch for "${providedRow.recipientHandle}": expected "${reconstructedRow.sendStatus}" from events, got "${providedRow.sendStatus}" in provided run-sheet`,
        details: {
          field: "sendStatus",
          expected: reconstructedRow.sendStatus,
          actual: providedRow.sendStatus,
        },
      });
      rowMatches = false;
    }
    
    if (rowMatches) {
      matchingRowCount++;
    }
  }
  
  // Check for extra rows in reconstructed that aren't in provided
  for (const reconstructedRow of reconstructed) {
    if (!providedByRecipient.has(reconstructedRow.recipientHandle)) {
      mismatches.push({
        ruleId: "EXTRA_ROW",
        severity: "warning",
        recipientHandle: reconstructedRow.recipientHandle,
        message: `Recipient "${reconstructedRow.recipientHandle}" exists in events but not in provided run-sheet`,
        details: {
          reconstructedRow,
        },
      });
    }
  }
  
  return {
    passed: mismatches.filter(m => m.severity === "error").length === 0,
    mismatches,
    providedRowCount: provided.length,
    reconstructedRowCount: reconstructed.length,
    matchingRowCount,
  };
}

/**
 * Compares reconstructed response-log rows against provided rows.
 * 
 * Emits mismatch codes:
 * - ROW_TIMESTAMP_DRIFT: When reply timestamps don't match
 * - MISSING_EVENT: When a provided row has no corresponding events
 * - EXTRA_ROW: When a reconstructed row has no corresponding provided row
 * - FIELD_MISMATCH: When non-timestamp fields don't match
 */
function checkResponseLog(
  reconstructed: ResponseLogRow[],
  provided: ResponseLogRow[],
  events: PilotEvent[]
): ResponseLogCheckOutput {
  const mismatches: CheckMismatch[] = [];
  
  // Create lookup maps
  const reconstructedByRecipient = new Map<string, ResponseLogRow>();
  for (const row of reconstructed) {
    reconstructedByRecipient.set(row.recipientHandle, row);
  }
  
  const providedByRecipient = new Map<string, ResponseLogRow>();
  for (const row of provided) {
    providedByRecipient.set(row.recipientHandle, row);
  }
  
  // Get recipients that have events
  const recipientsWithEvents = new Set(events.map(e => e.recipientHandle));
  
  let matchingRowCount = 0;
  
  // Check all provided rows
  for (const providedRow of provided) {
    const reconstructedRow = reconstructedByRecipient.get(providedRow.recipientHandle);
    
    // Check if this recipient has any events
    if (!recipientsWithEvents.has(providedRow.recipientHandle)) {
      mismatches.push({
        ruleId: "MISSING_EVENT",
        severity: "error",
        recipientHandle: providedRow.recipientHandle,
        message: `Recipient "${providedRow.recipientHandle}" exists in provided response-log but has no events in event log`,
        details: {
          providedRow,
        },
      });
      continue;
    }
    
    // Check if we have a reconstructed row for this recipient
    if (!reconstructedRow) {
      mismatches.push({
        ruleId: "MISSING_EVENT",
        severity: "error",
        recipientHandle: providedRow.recipientHandle,
        message: `Recipient "${providedRow.recipientHandle}" exists in provided response-log but could not be reconstructed from events`,
        details: {
          providedRow,
        },
      });
      continue;
    }
    
    // Compare fields
    let rowMatches = true;
    
    // Check reply timestamp (from reconstructed row)
    if (providedRow.replyTimestamp || reconstructedRow.replyTimestamp) {
      if (providedRow.replyTimestamp !== reconstructedRow.replyTimestamp) {
        mismatches.push({
          ruleId: "ROW_TIMESTAMP_DRIFT",
          severity: "error",
          recipientHandle: providedRow.recipientHandle,
          field: "replyTimestamp",
          expected: reconstructedRow.replyTimestamp || "none",
          actual: providedRow.replyTimestamp || "none",
          message: `Reply timestamp drift for "${providedRow.recipientHandle}": expected "${reconstructedRow.replyTimestamp || "none"}" from events, got "${providedRow.replyTimestamp || "none"}" in provided response-log`,
          details: {
            field: "replyTimestamp",
            expected: reconstructedRow.replyTimestamp,
            actual: providedRow.replyTimestamp,
          },
        });
        rowMatches = false;
      }
    }
    
    // Check workflow sentence
    if (providedRow.workflowSentence !== reconstructedRow.workflowSentence) {
      mismatches.push({
        ruleId: "FIELD_MISMATCH",
        severity: "warning",
        recipientHandle: providedRow.recipientHandle,
        field: "workflowSentence",
        expected: reconstructedRow.workflowSentence,
        actual: providedRow.workflowSentence,
        message: `Workflow sentence mismatch for "${providedRow.recipientHandle}": expected "${reconstructedRow.workflowSentence}" from events, got "${providedRow.workflowSentence}" in provided response-log`,
        details: {
          field: "workflowSentence",
          expected: reconstructedRow.workflowSentence,
          actual: providedRow.workflowSentence,
        },
      });
      rowMatches = false;
    }
    
    // Check objection type
    if (providedRow.objectionType !== reconstructedRow.objectionType) {
      mismatches.push({
        ruleId: "FIELD_MISMATCH",
        severity: "warning",
        recipientHandle: providedRow.recipientHandle,
        field: "objectionType",
        expected: reconstructedRow.objectionType,
        actual: providedRow.objectionType,
        message: `Objection type mismatch for "${providedRow.recipientHandle}": expected "${reconstructedRow.objectionType}" from events, got "${providedRow.objectionType}" in provided response-log`,
        details: {
          field: "objectionType",
          expected: reconstructedRow.objectionType,
          actual: providedRow.objectionType,
        },
      });
      rowMatches = false;
    }
    
    // Check WTP
    if (providedRow.wtp !== reconstructedRow.wtp) {
      mismatches.push({
        ruleId: "FIELD_MISMATCH",
        severity: "warning",
        recipientHandle: providedRow.recipientHandle,
        field: "wtp",
        expected: reconstructedRow.wtp,
        actual: providedRow.wtp,
        message: `WTP mismatch for "${providedRow.recipientHandle}": expected "${reconstructedRow.wtp}" from events, got "${providedRow.wtp}" in provided response-log`,
        details: {
          field: "wtp",
          expected: reconstructedRow.wtp,
          actual: providedRow.wtp,
        },
      });
      rowMatches = false;
    }
    
    // Check decision
    if (providedRow.nextStepDecision !== reconstructedRow.nextStepDecision) {
      mismatches.push({
        ruleId: "FIELD_MISMATCH",
        severity: "warning",
        recipientHandle: providedRow.recipientHandle,
        field: "nextStepDecision",
        expected: reconstructedRow.nextStepDecision,
        actual: providedRow.nextStepDecision,
        message: `Decision mismatch for "${providedRow.recipientHandle}": expected "${reconstructedRow.nextStepDecision}" from events, got "${providedRow.nextStepDecision}" in provided response-log`,
        details: {
          field: "nextStepDecision",
          expected: reconstructedRow.nextStepDecision,
          actual: providedRow.nextStepDecision,
        },
      });
      rowMatches = false;
    }
    
    // Check response state
    if (providedRow.responseState !== reconstructedRow.responseState) {
      mismatches.push({
        ruleId: "FIELD_MISMATCH",
        severity: "warning",
        recipientHandle: providedRow.recipientHandle,
        field: "responseState",
        expected: reconstructedRow.responseState,
        actual: providedRow.responseState,
        message: `Response state mismatch for "${providedRow.recipientHandle}": expected "${reconstructedRow.responseState}" from events, got "${providedRow.responseState}" in provided response-log`,
        details: {
          field: "responseState",
          expected: reconstructedRow.responseState,
          actual: providedRow.responseState,
        },
      });
      rowMatches = false;
    }
    
    if (rowMatches) {
      matchingRowCount++;
    }
  }
  
  // Check for extra rows in reconstructed that aren't in provided
  for (const reconstructedRow of reconstructed) {
    if (!providedByRecipient.has(reconstructedRow.recipientHandle)) {
      mismatches.push({
        ruleId: "EXTRA_ROW",
        severity: "warning",
        recipientHandle: reconstructedRow.recipientHandle,
        message: `Recipient "${reconstructedRow.recipientHandle}" exists in events but not in provided response-log`,
        details: {
          reconstructedRow,
        },
      });
    }
  }
  
  return {
    passed: mismatches.filter(m => m.severity === "error").length === 0,
    mismatches,
    providedRowCount: provided.length,
    reconstructedRowCount: reconstructed.length,
    matchingRowCount,
  };
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
  if (!args.eventsPath) {
    console.error("Error: --events is required");
    printHelp();
    process.exit(1);
  }

  // Set default format
  const format = args.format || "json";

  // Resolve and check file existence
  const resolvedEventsPath = resolve(args.eventsPath);
  if (!existsSync(resolvedEventsPath)) {
    exitWithError(
      "INVALID_EVENT_LOG",
      `Event log file not found: ${resolvedEventsPath}`
    );
  }

  // Load and parse event log
  let eventLogContent: string;
  try {
    eventLogContent = readFileSync(resolvedEventsPath, "utf-8");
  } catch (err) {
    exitWithError(
      "INVALID_EVENT_LOG",
      `Failed to read event log file: ${resolvedEventsPath}. ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Parse and validate (exits on error)
  const eventLog = parseEventLog(eventLogContent, resolvedEventsPath);

  // Sort events deterministically
  const sortedEvents = sortEventsDeterministically(eventLog.events);

  // Collect any warnings (e.g., future timestamps)
  const warnings: ValidationError[] = [];
  for (const event of sortedEvents) {
    const parsed = new Date(event.eventTimestamp);
    if (parsed.getTime() > Date.now()) {
      warnings.push({
        ruleId: "FUTURE_TIMESTAMP",
        severity: "warning",
        eventId: event.eventId,
        message: `Timestamp "${event.eventTimestamp}" is in the future`,
        details: { timestamp: event.eventTimestamp, eventId: event.eventId },
      });
    }
  }

  // Validate lifecycle transitions (TP005: emits INVALID_TRANSITION errors)
  const transitionErrors = validateAllTransitions(sortedEvents);
  
  // If there are transition errors, report them and exit
  if (transitionErrors.length > 0) {
    console.error(`Lifecycle transition validation failed with ${transitionErrors.length} error(s):\n`);
    for (const error of transitionErrors) {
      console.error(`  [${error.ruleId}] ${error.message}`);
      console.error(`    Event ID: ${error.eventId}`);
      console.error(`    Recipient: ${error.recipientHandle}`);
      console.error(`    Current State: ${error.currentState}`);
      console.error(`    Attempted: ${error.eventType}`);
      console.error(`    Valid Transitions: ${error.details.validTransitions.join(", ") || "none (terminal state)"}`);
    }
    process.exit(1);
  }

  // Create validation output
  const output = createValidationOutput(eventLog, warnings);

  // If run-sheet reduction requested, perform reduction
  let runSheetOutput: RunSheetReduceOutput | null = null;
  if (args.runSheetPath) {
    runSheetOutput = reduceEventsToRunSheet(sortedEvents);
    
    // If reduction has errors, report them
    if (!runSheetOutput.valid) {
      console.error(`Run-sheet reduction failed with ${runSheetOutput.errors.length} error(s):\n`);
      for (const error of runSheetOutput.errors) {
        console.error(`  [${error.ruleId}] ${error.message}`);
        if (error.recipientHandle) {
          console.error(`    Recipient: ${error.recipientHandle}`);
        }
        if (error.details) {
          console.error(`    Details: ${JSON.stringify(error.details)}`);
        }
      }
      process.exit(1);
    }
  }

  // If response-log reduction requested, perform reduction
  let responseLogOutput: ResponseLogReduceOutput | null = null;
  if (args.responsesPath) {
    // Response-log needs run-sheet rows for timestamp invariant checking
    const runSheetRows = runSheetOutput?.rows || [];
    responseLogOutput = reduceEventsToResponseLog(sortedEvents, runSheetRows);
    
    // If reduction has errors, report them
    if (!responseLogOutput.valid) {
      console.error(`Response-log reduction failed with ${responseLogOutput.errors.length} error(s):\n`);
      for (const error of responseLogOutput.errors) {
        console.error(`  [${error.ruleId}] ${error.message}`);
        if (error.recipientHandle) {
          console.error(`    Recipient: ${error.recipientHandle}`);
        }
        if (error.details) {
          console.error(`    Details: ${JSON.stringify(error.details)}`);
        }
      }
      process.exit(1);
    }
  }

  // Check mode: Compare reconstructed rows against provided artifacts (TP006)
  let checkOutput: CheckOutput | null = null;
  if (args.check) {
    // Validate that at least one artifact path is provided
    if (!args.runSheetPath && !args.responsesPath) {
      console.error("Error: --check requires at least one of --run-sheet or --responses");
      printHelp();
      process.exit(1);
    }
    
    checkOutput = { passed: true };
    
    // Check run-sheet if provided
    if (args.runSheetPath && runSheetOutput) {
      const resolvedRunSheetPath = resolve(args.runSheetPath);
      if (!existsSync(resolvedRunSheetPath)) {
        exitWithError(
          "INVALID_EVENT_LOG",
          `Run-sheet file not found: ${resolvedRunSheetPath}`
        );
      }
      
      let runSheetContent: string;
      try {
        runSheetContent = readFileSync(resolvedRunSheetPath, "utf-8");
      } catch (err) {
        exitWithError(
          "INVALID_EVENT_LOG",
          `Failed to read run-sheet file: ${resolvedRunSheetPath}. ${err instanceof Error ? err.message : String(err)}`
        );
      }
      
      const providedRunSheetRows = parseExistingRunSheet(runSheetContent);
      const runSheetCheck = checkRunSheet(
        runSheetOutput.rows,
        providedRunSheetRows,
        sortedEvents
      );
      
      checkOutput.runSheet = runSheetCheck;
      if (!runSheetCheck.passed) {
        checkOutput.passed = false;
      }
    }
    
    // Check response-log if provided
    if (args.responsesPath && responseLogOutput) {
      const resolvedResponsesPath = resolve(args.responsesPath);
      if (!existsSync(resolvedResponsesPath)) {
        exitWithError(
          "INVALID_EVENT_LOG",
          `Response-log file not found: ${resolvedResponsesPath}`
        );
      }
      
      let responseLogContent: string;
      try {
        responseLogContent = readFileSync(resolvedResponsesPath, "utf-8");
      } catch (err) {
        exitWithError(
          "INVALID_EVENT_LOG",
          `Failed to read response-log file: ${resolvedResponsesPath}. ${err instanceof Error ? err.message : String(err)}`
        );
      }
      
      const providedResponseLogRows = parseExistingResponseLog(responseLogContent);
      const responseLogCheck = checkResponseLog(
        responseLogOutput.rows,
        providedResponseLogRows,
        sortedEvents
      );
      
      checkOutput.responseLog = responseLogCheck;
      if (!responseLogCheck.passed) {
        checkOutput.passed = false;
      }
    }
    
    // If check failed, report mismatches and exit
    if (!checkOutput.passed) {
      if (format === "json") {
        const result: Record<string, unknown> = {
          ...output,
          check: checkOutput,
        };
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log("Pilot Rebuild Check");
        console.log("===================");
        console.log(`Status: ❌ FAILED`);
        console.log("");
        
        if (checkOutput.runSheet) {
          console.log("Run-Sheet Check");
          console.log("---------------");
          console.log(`Provided Rows: ${checkOutput.runSheet.providedRowCount}`);
          console.log(`Reconstructed Rows: ${checkOutput.runSheet.reconstructedRowCount}`);
          console.log(`Matching Rows: ${checkOutput.runSheet.matchingRowCount}`);
          console.log(`Mismatches: ${checkOutput.runSheet.mismatches.length}`);
          console.log("");
          
          for (const mismatch of checkOutput.runSheet.mismatches) {
            console.log(`  [${mismatch.ruleId}] ${mismatch.message}`);
            console.log(`    Recipient: ${mismatch.recipientHandle}`);
            if (mismatch.field) {
              console.log(`    Field: ${mismatch.field}`);
            }
            if (mismatch.expected !== undefined) {
              console.log(`    Expected: ${mismatch.expected}`);
            }
            if (mismatch.actual !== undefined) {
              console.log(`    Actual: ${mismatch.actual}`);
            }
          }
          console.log("");
        }
        
        if (checkOutput.responseLog) {
          console.log("Response-Log Check");
          console.log("------------------");
          console.log(`Provided Rows: ${checkOutput.responseLog.providedRowCount}`);
          console.log(`Reconstructed Rows: ${checkOutput.responseLog.reconstructedRowCount}`);
          console.log(`Matching Rows: ${checkOutput.responseLog.matchingRowCount}`);
          console.log(`Mismatches: ${checkOutput.responseLog.mismatches.length}`);
          console.log("");
          
          for (const mismatch of checkOutput.responseLog.mismatches) {
            console.log(`  [${mismatch.ruleId}] ${mismatch.message}`);
            console.log(`    Recipient: ${mismatch.recipientHandle}`);
            if (mismatch.field) {
              console.log(`    Field: ${mismatch.field}`);
            }
            if (mismatch.expected !== undefined) {
              console.log(`    Expected: ${mismatch.expected}`);
            }
            if (mismatch.actual !== undefined) {
              console.log(`    Actual: ${mismatch.actual}`);
            }
          }
          console.log("");
        }
      }
      
      process.exit(1);
    }
  }

  // Output results
  if (format === "json") {
    const result: Record<string, unknown> = {
      ...output,
      events: sortedEvents,
    };
    
    if (runSheetOutput) {
      result.runSheet = runSheetOutput;
    }
    
    if (responseLogOutput) {
      result.responseLog = responseLogOutput;
    }
    
    if (checkOutput) {
      result.check = checkOutput;
    }
    
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("Pilot Event Log Validation");
    console.log("==========================");
    console.log(`Batch: ${output.batchId}`);
    console.log(`Status: ${output.valid ? "✅ Valid" : "❌ Invalid"}`);
    console.log(`Event Count: ${output.eventCount}`);
    console.log(`Recipient Count: ${output.recipientCount}`);
    console.log("");

    if (warnings.length > 0) {
      console.log("Warnings:");
      for (const warning of warnings) {
        console.log(`  ⚠️  [${warning.ruleId}] ${warning.message}`);
        if (warning.eventId) {
          console.log(`      Event ID: ${warning.eventId}`);
        }
      }
      console.log("");
    }

    // Check mode output
    if (checkOutput) {
      console.log("Pilot Rebuild Check");
      console.log("===================");
      console.log(`Status: ${checkOutput.passed ? "✅ PASSED" : "❌ FAILED"}`);
      console.log("");
      
      if (checkOutput.runSheet) {
        console.log("Run-Sheet Check");
        console.log("---------------");
        console.log(`Provided Rows: ${checkOutput.runSheet.providedRowCount}`);
        console.log(`Reconstructed Rows: ${checkOutput.runSheet.reconstructedRowCount}`);
        console.log(`Matching Rows: ${checkOutput.runSheet.matchingRowCount}`);
        if (checkOutput.runSheet.mismatches.length > 0) {
          console.log(`Mismatches: ${checkOutput.runSheet.mismatches.length}`);
          for (const mismatch of checkOutput.runSheet.mismatches) {
            console.log(`  [${mismatch.ruleId}] (${mismatch.severity}) ${mismatch.message}`);
            if (mismatch.field) {
              console.log(`    Field: ${mismatch.field}`);
            }
          }
        }
        console.log("");
      }
      
      if (checkOutput.responseLog) {
        console.log("Response-Log Check");
        console.log("------------------");
        console.log(`Provided Rows: ${checkOutput.responseLog.providedRowCount}`);
        console.log(`Reconstructed Rows: ${checkOutput.responseLog.reconstructedRowCount}`);
        console.log(`Matching Rows: ${checkOutput.responseLog.matchingRowCount}`);
        if (checkOutput.responseLog.mismatches.length > 0) {
          console.log(`Mismatches: ${checkOutput.responseLog.mismatches.length}`);
          for (const mismatch of checkOutput.responseLog.mismatches) {
            console.log(`  [${mismatch.ruleId}] (${mismatch.severity}) ${mismatch.message}`);
            if (mismatch.field) {
              console.log(`    Field: ${mismatch.field}`);
            }
          }
        }
        console.log("");
      }
    }

    if (runSheetOutput && !checkOutput) {
      console.log("Run-Sheet Reduction");
      console.log("===================");
      console.log(`Status: ${runSheetOutput.valid ? "✅ Valid" : "❌ Invalid"}`);
      console.log(`Recipient Count: ${runSheetOutput.recipientCount}`);
      console.log("");

      if (runSheetOutput.warnings.length > 0) {
        console.log("Warnings:");
        for (const warning of runSheetOutput.warnings) {
          console.log(`  ⚠️  [${warning.ruleId}] ${warning.message}`);
          if (warning.recipientHandle) {
            console.log(`      Recipient: ${warning.recipientHandle}`);
          }
        }
        console.log("");
      }

      console.log("Run-Sheet Rows:");
      for (const row of runSheetOutput.rows) {
        console.log(`  ${row.recipientHandle}`);
        console.log(`    Channel: ${row.channel}`);
        console.log(`    Status: ${row.sendStatus}`);
        console.log(`    Sent: ${row.sentTimestamp || "N/A"}`);
        if (row.followUpTimestamp) {
          console.log(`    Follow-up: ${row.followUpTimestamp}`);
        }
        console.log(`    Artifact: ${row.artifactLink}`);
      }
      console.log("");
    }

    if (responseLogOutput && !checkOutput) {
      console.log("Response-Log Reduction");
      console.log("======================");
      console.log(`Status: ${responseLogOutput.valid ? "✅ Valid" : "❌ Invalid"}`);
      console.log(`Recipient Count: ${responseLogOutput.recipientCount}`);
      console.log("");

      if (responseLogOutput.warnings.length > 0) {
        console.log("Warnings:");
        for (const warning of responseLogOutput.warnings) {
          console.log(`  ⚠️  [${warning.ruleId}] ${warning.message}`);
          if (warning.recipientHandle) {
            console.log(`      Recipient: ${warning.recipientHandle}`);
          }
        }
        console.log("");
      }

      console.log("Response-Log Rows:");
      for (const row of responseLogOutput.rows) {
        console.log(`  ${row.recipientHandle}`);
        console.log(`    Channel: ${row.sourceChannel}`);
        console.log(`    Workflow Sentence: ${row.workflowSentence}`);
        console.log(`    Objection Type: ${row.objectionType}`);
        console.log(`    WTP: ${row.wtp === "no response yet" ? "no response yet" : `$${row.wtp}/mo`}`);
        console.log(`    Decision: ${row.nextStepDecision}`);
        console.log(`    Rationale: ${row.decisionRationale}`);
        console.log(`    Response State: ${row.responseState}`);
        if (row.replyTimestamp) {
          console.log(`    Reply Timestamp: ${row.replyTimestamp}`);
        }
      }
      console.log("");
    }

    // Only show events if not in check mode (check mode is concise)
    if (!checkOutput) {
      console.log("Events (sorted deterministically):");
      for (const event of sortedEvents) {
        console.log(`  ${event.eventId}`);
        console.log(`    Type: ${event.eventType}`);
        console.log(`    Recipient: ${event.recipientHandle}`);
        console.log(`    Timestamp: ${event.eventTimestamp}`);
        console.log(`    Payload: ${JSON.stringify(event.payload)}`);
      }
    }
  }
}

main();
