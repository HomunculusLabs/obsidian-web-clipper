// ============================================================================
// TASKPAD Verification Pack History - Schema Types and Utilities
// ============================================================================
//
// Purpose: Canonical type definitions and helper functions for the
//          taskpad:verification-pack-history NDJSON telemetry contract.
//
// Contract: docs/quality/taskpad-verification-pack-history.md
//
// ============================================================================

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

// ============================================================================
// Schema Version
// ============================================================================

export const HISTORY_SCHEMA_VERSION = 1;

// ============================================================================
// Rule IDs (from contract docs/quality/taskpad-verification-pack-history.md)
// ============================================================================

export const RULE_IDS = {
  // Pack validation failures
  SLICE_ID_MISMATCH: "VPH001_SLICE_ID_MISMATCH",
  FINGERPRINT_MISMATCH: "VPH002_FINGERPRINT_MISMATCH",
  PACK_HASH_MISMATCH: "VPH003_PACK_HASH_MISMATCH",
  PACK_NOT_FOUND: "VPH004_PACK_NOT_FOUND",
  PACK_PARSE_ERROR: "VPH005_PACK_PARSE_ERROR",
  MISSING_REQUIRED_FIELD: "VPH006_MISSING_REQUIRED_FIELD",
  COMMAND_NOT_EXECUTABLE: "VPH007_COMMAND_NOT_EXECUTABLE",

  // History operation failures
  HISTORY_APPEND_FAILED: "VPH008_HISTORY_APPEND_FAILED",
  HISTORY_READ_FAILED: "VPH009_HISTORY_READ_FAILED",

  // Idempotency/info
  DUPLICATE_EVENT_SUPPRESSED: "VPH010_DUPLICATE_EVENT_SUPPRESSED",
} as const;

export type RuleId = (typeof RULE_IDS)[keyof typeof RULE_IDS];

/**
 * Canonical order for rule IDs in diagnostics output.
 * Ensures deterministic, stable ordering across runs.
 */
export const CANONICAL_RULE_ORDER: RuleId[] = [
  RULE_IDS.SLICE_ID_MISMATCH,
  RULE_IDS.FINGERPRINT_MISMATCH,
  RULE_IDS.PACK_HASH_MISMATCH,
  RULE_IDS.PACK_NOT_FOUND,
  RULE_IDS.PACK_PARSE_ERROR,
  RULE_IDS.MISSING_REQUIRED_FIELD,
  RULE_IDS.COMMAND_NOT_EXECUTABLE,
  RULE_IDS.HISTORY_APPEND_FAILED,
  RULE_IDS.HISTORY_READ_FAILED,
  RULE_IDS.DUPLICATE_EVENT_SUPPRESSED,
];

// ============================================================================
// Event Types
// ============================================================================

export type EventType = "pack-generated" | "contract-evaluated" | "duplicate-suppressed";

export type SourceCommand = "taskpad:verification-pack" | "taskpad:verification-pack-contract";

export type DedupeMode = "skip" | "append" | "noop";

// ============================================================================
// Core Interfaces
// ============================================================================

/**
 * Metadata for history events (optional fields).
 */
export interface HistoryEventMetadata {
  /** Number of unchecked TP tasks in the slice */
  uncheckedCount?: number;

  /** Number of planned Work Queue items */
  plannedCount?: number;

  /** Number of verification commands in the slice */
  commandCount?: number;

  /** SHA-256 of combined inputs (taskpad + plan content) */
  inputHash?: string;

  /** Reference to original event ID when in append dedupe mode */
  duplicateOf?: string;

  /** Duration of command execution in milliseconds */
  durationMs?: number;
}

/**
 * Canonical history event schema.
 * Each NDJSON line in the history file is one of these.
 */
export interface VerificationPackHistoryEvent {
  /** Schema version (must be 1) */
  version: number;

  /** Event type discriminator */
  eventType: EventType;

  /** Unique identifier for the intake slice */
  sliceId: string;

  /** SHA-256 hash of canonical work queue state */
  workQueueFingerprint: string;

  /** SHA-256 hash of the verification pack JSON content */
  packHash: string;

  /** ISO 8601 timestamp in UTC */
  generatedAt: string;

  /** Command that generated this event */
  sourceCommand: SourceCommand;

  /** Rule ID if contract evaluation failed, otherwise null */
  driftRuleId: RuleId | null;

  /** Unique event identifier */
  eventId: string;

  /** Absolute path to IMPLEMENTATION_PLAN.md (optional) */
  planPath?: string;

  /** Absolute path to TASKPAD.md (optional) */
  taskpadPath?: string;

  /** Command execution duration in milliseconds (optional) */
  durationMs?: number;

  /** Additional metadata (optional) */
  metadata?: HistoryEventMetadata;
}

/**
 * Duplicate detection key fields.
 * Events with matching values for all these fields are considered duplicates.
 */
export interface DuplicateKey {
  sliceId: string;
  workQueueFingerprint: string;
  packHash: string;
  sourceCommand: SourceCommand;
  driftRuleId: RuleId | null;
}

/**
 * Result of a history append operation.
 */
export interface HistoryAppendResult {
  /** Whether the append was successful */
  success: boolean;

  /** The event that was appended (or would have been appended) */
  event: VerificationPackHistoryEvent;

  /** Whether this was a duplicate that was suppressed */
  suppressed: boolean;

  /** Original event ID if this was a duplicate in append mode */
  originalEventId?: string;

  /** Error message if append failed */
  error?: string;

  /** Rule ID if operation failed */
  ruleId?: RuleId;
}

/**
 * Result of reading history file.
 */
export interface HistoryReadResult {
  /** Whether the read was successful */
  success: boolean;

  /** Parsed events (empty array if file doesn't exist) */
  events: VerificationPackHistoryEvent[];

  /** Error message if read failed */
  error?: string;

  /** Rule ID if operation failed */
  ruleId?: RuleId;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a deterministic event ID.
 * Uses crypto.randomUUID if available, falls back to timestamp + random.
 */
export function generateEventId(): string {
  try {
    // Use Bun's crypto implementation
    const { randomUUID } = require("node:crypto");
    return `evt-${randomUUID()}`;
  } catch {
    // Fallback for environments without randomUUID
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `evt-${timestamp}-${random}`;
  }
}

/**
 * Get current ISO 8601 timestamp in UTC.
 */
export function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Compute SHA-256 hash of content.
 */
export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Compute work queue fingerprint from canonical bullet texts.
 * Sorts bullets for determinism.
 */
export function computeWorkQueueFingerprint(bulletTexts: string[]): string {
  const canonicalContent = bulletTexts
    .map((t) => t.trim())
    .sort()
    .join("\n");
  return computeHash(canonicalContent);
}

/**
 * Extract duplicate detection key from an event.
 */
export function getDuplicateKey(event: VerificationPackHistoryEvent): DuplicateKey {
  return {
    sliceId: event.sliceId,
    workQueueFingerprint: event.workQueueFingerprint,
    packHash: event.packHash,
    sourceCommand: event.sourceCommand,
    driftRuleId: event.driftRuleId,
  };
}

/**
 * Check if two events are duplicates based on the duplicate detection key.
 */
export function isDuplicate(
  eventA: VerificationPackHistoryEvent,
  eventB: VerificationPackHistoryEvent,
): boolean {
  const keyA = getDuplicateKey(eventA);
  const keyB = getDuplicateKey(eventB);
  return (
    keyA.sliceId === keyB.sliceId &&
    keyA.workQueueFingerprint === keyB.workQueueFingerprint &&
    keyA.packHash === keyB.packHash &&
    keyA.sourceCommand === keyB.sourceCommand &&
    keyA.driftRuleId === keyB.driftRuleId
  );
}

/**
 * Serialize an event to NDJSON line.
 */
export function serializeEvent(event: VerificationPackHistoryEvent): string {
  return JSON.stringify(event) + "\n";
}

/**
 * Parse an NDJSON line into an event.
 * Returns null if parsing fails.
 */
export function parseEventLine(line: string): VerificationPackHistoryEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);

    // Basic validation
    if (parsed.version !== HISTORY_SCHEMA_VERSION) {
      return null;
    }
    if (!parsed.eventType || !parsed.sliceId || !parsed.packHash) {
      return null;
    }

    return parsed as VerificationPackHistoryEvent;
  } catch {
    return null;
  }
}

/**
 * Read all events from history file.
 */
export function readHistoryFile(historyPath: string): HistoryReadResult {
  try {
    if (!existsSync(historyPath)) {
      return { success: true, events: [] };
    }

    const content = readFileSync(historyPath, "utf-8");
    const lines = content.split("\n");

    const events: VerificationPackHistoryEvent[] = [];
    for (const line of lines) {
      const event = parseEventLine(line);
      if (event) {
        events.push(event);
      }
    }

    return { success: true, events };
  } catch (error) {
    return {
      success: false,
      events: [],
      error: error instanceof Error ? error.message : String(error),
      ruleId: RULE_IDS.HISTORY_READ_FAILED,
    };
  }
}

/**
 * Find duplicate event in existing history.
 * Returns the original event ID if found, null otherwise.
 */
export function findDuplicate(
  newEvent: VerificationPackHistoryEvent,
  existingEvents: VerificationPackHistoryEvent[],
): string | null {
  for (const existing of existingEvents) {
    if (isDuplicate(newEvent, existing)) {
      return existing.eventId;
    }
  }
  return null;
}

/**
 * Create a new history event with all required fields populated.
 */
export function createHistoryEvent(params: {
  eventType: EventType;
  sliceId: string;
  workQueueFingerprint: string;
  packHash: string;
  sourceCommand: SourceCommand;
  driftRuleId?: RuleId | null;
  planPath?: string;
  taskpadPath?: string;
  durationMs?: number;
  metadata?: HistoryEventMetadata;
}): VerificationPackHistoryEvent {
  return {
    version: HISTORY_SCHEMA_VERSION,
    eventType: params.eventType,
    sliceId: params.sliceId,
    workQueueFingerprint: params.workQueueFingerprint,
    packHash: params.packHash,
    generatedAt: getTimestamp(),
    sourceCommand: params.sourceCommand,
    driftRuleId: params.driftRuleId ?? null,
    eventId: generateEventId(),
    planPath: params.planPath,
    taskpadPath: params.taskpadPath,
    durationMs: params.durationMs,
    metadata: params.metadata,
  };
}

/**
 * Append event to history file with deduplication logic.
 */
export function appendToHistory(
  historyPath: string,
  event: VerificationPackHistoryEvent,
  dedupeMode: DedupeMode = "skip",
): HistoryAppendResult {
  // Read existing history
  const readResult = readHistoryFile(historyPath);
  if (!readResult.success) {
    return {
      success: false,
      event,
      suppressed: false,
      error: readResult.error,
      ruleId: readResult.ruleId,
    };
  }

  // Check for duplicates
  const originalEventId = findDuplicate(event, readResult.events);

  if (originalEventId) {
    switch (dedupeMode) {
      case "skip": {
        // Return suppressed result without appending
        return {
          success: true,
          event: {
            ...event,
            eventType: "duplicate-suppressed",
            driftRuleId: RULE_IDS.DUPLICATE_EVENT_SUPPRESSED,
          },
          suppressed: true,
          originalEventId,
        };
      }

      case "noop": {
        // Append a minimal noop event
        const noopEvent: VerificationPackHistoryEvent = {
          ...event,
          eventType: "duplicate-suppressed",
          driftRuleId: RULE_IDS.DUPLICATE_EVENT_SUPPRESSED,
          metadata: {
            ...event.metadata,
            duplicateOf: originalEventId,
          },
        };

        try {
          appendFileSync(historyPath, serializeEvent(noopEvent));
          return {
            success: true,
            event: noopEvent,
            suppressed: true,
            originalEventId,
          };
        } catch (error) {
          return {
            success: false,
            event: noopEvent,
            suppressed: false,
            error: error instanceof Error ? error.message : String(error),
            ruleId: RULE_IDS.HISTORY_APPEND_FAILED,
          };
        }
      }

      case "append": {
        // Append anyway with duplicateOf reference
        const dupeEvent: VerificationPackHistoryEvent = {
          ...event,
          metadata: {
            ...event.metadata,
            duplicateOf: originalEventId,
          },
        };

        try {
          appendFileSync(historyPath, serializeEvent(dupeEvent));
          return {
            success: true,
            event: dupeEvent,
            suppressed: false,
            originalEventId,
          };
        } catch (error) {
          return {
            success: false,
            event: dupeEvent,
            suppressed: false,
            error: error instanceof Error ? error.message : String(error),
            ruleId: RULE_IDS.HISTORY_APPEND_FAILED,
          };
        }
      }
    }
  }

  // Not a duplicate - append normally
  try {
    appendFileSync(historyPath, serializeEvent(event));
    return {
      success: true,
      event,
      suppressed: false,
    };
  } catch (error) {
    return {
      success: false,
      event,
      suppressed: false,
      error: error instanceof Error ? error.message : String(error),
      ruleId: RULE_IDS.HISTORY_APPEND_FAILED,
    };
  }
}

// ============================================================================
// Default Paths
// ============================================================================

/**
 * Get default history file path.
 */
export function getDefaultHistoryPath(): string {
  return (
    process.env.VPH_HISTORY_PATH ||
    "docs/quality/taskpad-verification-pack-history.ndjson"
  );
}

/**
 * Get default dedupe mode from environment.
 */
export function getDefaultDedupeMode(): DedupeMode {
  const envMode = process.env.VPH_DEDUPE_MODE;
  if (envMode === "append" || envMode === "noop") {
    return envMode;
  }
  return "skip";
}
