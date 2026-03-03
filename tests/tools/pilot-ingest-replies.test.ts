#!/usr/bin/env bun

/**
 * Tests for pilot-ingest-replies.ts
 *
 * Covers:
 * - NDJSON parsing and validation
 * - Recipient resolution (TP004)
 * - Deterministic error rule IDs
 */

import { describe, test, expect } from "bun:test";
import {
  parseResponseLogRecipients,
  parseEventLogRecipients,
  loadKnownRecipients,
  resolveRecipient,
  parseNDJSON,
  validateRow,
  parseExistingMessageIds,
  loadExistingMessageIds,
  suppressDuplicates,
  sortRowsDeterministically,
  VALID_CHANNELS,
  VALID_DECISION_STATES,
  VALID_OBJECTION_TYPES,
} from "../../tools/pilot-ingest-replies";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = join(__dirname, "fixtures");

// ============================================================================
// Recipient Parsing Tests
// ============================================================================

describe("parseResponseLogRecipients", () => {
  test("extracts recipients from pilot-response-log markdown table", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "pilot-ingest-replies-base.responses.md"),
      "utf-8"
    );
    const recipients = parseResponseLogRecipients(content);

    expect(recipients.has("pilot_alpha")).toBe(true);
    expect(recipients.has("pilot_bravo")).toBe(true);
    expect(recipients.has("pilot_charlie")).toBe(true);
    expect(recipients.size).toBe(3);
  });

  test("returns empty set for content without valid table", () => {
    const content = "# No table here\n\nJust some text.";
    const recipients = parseResponseLogRecipients(content);
    expect(recipients.size).toBe(0);
  });

  test("handles backtick-formatted handles", () => {
    const content = `
| Recipient | Channel |
| --- | --- |
| \`test_user\` | X DM |
`;
    const recipients = parseResponseLogRecipients(content);
    expect(recipients.has("test_user")).toBe(true);
  });

  test("excludes 'no response yet' placeholder values", () => {
    const content = `
| Recipient | Channel |
| --- | --- |
| real_user | X DM |
| no response yet | Email |
`;
    const recipients = parseResponseLogRecipients(content);
    expect(recipients.has("real_user")).toBe(true);
    expect(recipients.has("no response yet")).toBe(false);
  });
});

describe("parseEventLogRecipients", () => {
  test("extracts recipients from pilot-event-log markdown table", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md"),
      "utf-8"
    );
    const recipients = parseEventLogRecipients(content);

    expect(recipients.has("pilot_alpha")).toBe(true);
    expect(recipients.has("pilot_bravo")).toBe(true);
    expect(recipients.has("pilot_charlie")).toBe(true);
    expect(recipients.size).toBe(3);
  });

  test("returns empty set for content without valid table", () => {
    const content = "# No events\n\nNothing here.";
    const recipients = parseEventLogRecipients(content);
    expect(recipients.size).toBe(0);
  });
});

describe("loadKnownRecipients", () => {
  test("combines recipients from both response and event logs", () => {
    const recipients = loadKnownRecipients(
      join(FIXTURES_DIR, "pilot-ingest-replies-base.responses.md"),
      join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md")
    );

    expect(recipients.has("pilot_alpha")).toBe(true);
    expect(recipients.has("pilot_bravo")).toBe(true);
    expect(recipients.has("pilot_charlie")).toBe(true);
  });
});

describe("resolveRecipient", () => {
  const knownRecipients = new Set(["pilot_alpha", "pilot_bravo", "pilot_charlie"]);

  test("returns true for exact match", () => {
    expect(resolveRecipient("pilot_alpha", knownRecipients)).toBe(true);
    expect(resolveRecipient("pilot_bravo", knownRecipients)).toBe(true);
  });

  test("returns true for @-prefixed handle when base handle exists", () => {
    expect(resolveRecipient("@pilot_alpha", knownRecipients)).toBe(true);
    expect(resolveRecipient("@pilot_bravo", knownRecipients)).toBe(true);
  });

  test("returns false for unknown recipient", () => {
    expect(resolveRecipient("unknown_user", knownRecipients)).toBe(false);
    expect(resolveRecipient("@unknown_user", knownRecipients)).toBe(false);
    expect(resolveRecipient("random_person", knownRecipients)).toBe(false);
  });
});

// ============================================================================
// NDJSON Parsing Tests
// ============================================================================

describe("parseNDJSON", () => {
  test("parses valid NDJSON with multiple rows", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "pilot-replies.ndjson"),
      "utf-8"
    );
    const { rows, errors } = parseNDJSON(content);

    expect(rows.length).toBe(3);
    expect(errors.length).toBe(0);

    expect(rows[0].messageId).toBe("msg-001");
    expect(rows[0].recipientHandle).toBe("pilot_alpha");
    expect(rows[1].recipientHandle).toBe("pilot_bravo");
    expect(rows[2].recipientHandle).toBe("pilot_charlie");
  });

  test("returns errors for malformed JSON rows", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "pilot-replies-errors.ndjson"),
      "utf-8"
    );
    const { rows, errors } = parseNDJSON(content);

    // Should have at least one malformed row error
    expect(errors.some((e) => e.ruleId === "MALFORMED_ROW")).toBe(true);
  });
});

// ============================================================================
// Row Validation Tests (TP003 + TP004)
// ============================================================================

describe("validateRow", () => {
  const knownRecipients = new Set(["pilot_alpha", "pilot_bravo", "pilot_charlie"]);

  test("validates and normalizes a valid row", () => {
    const row = {
      messageId: "msg-001",
      recipientHandle: "pilot_alpha",
      timestamp: "2026-02-15T10:30:00Z",
      channel: "X DM",
      workflowSentence: "Interested in the product",
    };

    const result = validateRow(row, 1, knownRecipients);

    expect(result.row).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.row?.rowIndex).toBe(1);
    expect(result.row?.channel).toBe("X DM");
  });

  test("validates row with optional decision field", () => {
    const row = {
      messageId: "msg-002",
      recipientHandle: "pilot_bravo",
      timestamp: "2026-02-16T14:20:00Z",
      channel: "Discord DM",
      workflowSentence: "Asked about pricing",
      decision: "advance",
    };

    const result = validateRow(row, 2, knownRecipients);

    expect(result.row).toBeDefined();
    expect(result.row?.decision).toBe("advance");
  });

  test("returns MISSING_MESSAGE_ID error for missing messageId", () => {
    const row = {
      recipientHandle: "pilot_alpha",
      timestamp: "2026-02-15T10:30:00Z",
      channel: "X DM",
      workflowSentence: "Test",
    };

    const result = validateRow(row, 1, knownRecipients);

    expect(result.error).toBeDefined();
    expect(result.error?.ruleId).toBe("MISSING_MESSAGE_ID");
  });

  test("returns MISSING_RECIPIENT error for missing recipientHandle", () => {
    const row = {
      messageId: "msg-001",
      timestamp: "2026-02-15T10:30:00Z",
      channel: "X DM",
      workflowSentence: "Test",
    };

    const result = validateRow(row, 1, knownRecipients);

    expect(result.error).toBeDefined();
    expect(result.error?.ruleId).toBe("MISSING_RECIPIENT");
  });

  test("returns MISSING_TIMESTAMP error for missing timestamp", () => {
    const row = {
      messageId: "msg-001",
      recipientHandle: "pilot_alpha",
      channel: "X DM",
      workflowSentence: "Test",
    };

    const result = validateRow(row, 1, knownRecipients);

    expect(result.error).toBeDefined();
    expect(result.error?.ruleId).toBe("MISSING_TIMESTAMP");
  });

  test("returns MISSING_WORKFLOW_SENTENCE error for missing workflowSentence", () => {
    const row = {
      messageId: "msg-001",
      recipientHandle: "pilot_alpha",
      timestamp: "2026-02-15T10:30:00Z",
      channel: "X DM",
    };

    const result = validateRow(row, 1, knownRecipients);

    expect(result.error).toBeDefined();
    expect(result.error?.ruleId).toBe("MISSING_WORKFLOW_SENTENCE");
  });

  test("returns INVALID_CHANNEL error for invalid channel", () => {
    const row = {
      messageId: "msg-001",
      recipientHandle: "pilot_alpha",
      timestamp: "2026-02-15T10:30:00Z",
      channel: "Invalid Channel",
      workflowSentence: "Test",
    };

    const result = validateRow(row, 1, knownRecipients);

    expect(result.error).toBeDefined();
    expect(result.error?.ruleId).toBe("INVALID_CHANNEL");
  });

  test("returns INVALID_DECISION_STATE error for invalid decision", () => {
    const row = {
      messageId: "msg-001",
      recipientHandle: "pilot_alpha",
      timestamp: "2026-02-15T10:30:00Z",
      channel: "X DM",
      workflowSentence: "Test",
      decision: "invalid-state",
    };

    const result = validateRow(row, 1, knownRecipients);

    expect(result.error).toBeDefined();
    expect(result.error?.ruleId).toBe("INVALID_DECISION_STATE");
  });

  test("returns INVALID_TIMESTAMP error for invalid timestamp", () => {
    const row = {
      messageId: "msg-001",
      recipientHandle: "pilot_alpha",
      timestamp: "not-a-timestamp",
      channel: "X DM",
      workflowSentence: "Test",
    };

    const result = validateRow(row, 1, knownRecipients);

    expect(result.error).toBeDefined();
    expect(result.error?.ruleId).toBe("INVALID_TIMESTAMP");
  });

  // TP004: UNKNOWN_RECIPIENT tests
  test("returns UNKNOWN_RECIPIENT error for unknown recipient handle", () => {
    const row = {
      messageId: "msg-001",
      recipientHandle: "unknown_user",
      timestamp: "2026-02-15T10:30:00Z",
      channel: "X DM",
      workflowSentence: "Test",
    };

    const result = validateRow(row, 1, knownRecipients);

    expect(result.error).toBeDefined();
    expect(result.error?.ruleId).toBe("UNKNOWN_RECIPIENT");
    expect(result.error?.recipientHandle).toBe("unknown_user");
    expect(result.error?.message).toContain("unknown_user");
  });

  test("returns UNKNOWN_RECIPIENT error for @-prefixed unknown recipient", () => {
    const row = {
      messageId: "msg-001",
      recipientHandle: "@unknown_user",
      timestamp: "2026-02-15T10:30:00Z",
      channel: "X DM",
      workflowSentence: "Test",
    };

    const result = validateRow(row, 1, knownRecipients);

    expect(result.error).toBeDefined();
    expect(result.error?.ruleId).toBe("UNKNOWN_RECIPIENT");
  });

  test("accepts @-prefixed handle when base handle is known", () => {
    const row = {
      messageId: "msg-001",
      recipientHandle: "@pilot_alpha",
      timestamp: "2026-02-15T10:30:00Z",
      channel: "X DM",
      workflowSentence: "Test",
    };

    const result = validateRow(row, 1, knownRecipients);

    expect(result.row).toBeDefined();
    expect(result.error).toBeUndefined();
  });
});

// ============================================================================
// Constants Validation Tests
// ============================================================================

describe("Constants", () => {
  test("VALID_CHANNELS contains expected values", () => {
    expect(VALID_CHANNELS).toContain("X DM");
    expect(VALID_CHANNELS).toContain("Discord DM");
    expect(VALID_CHANNELS).toContain("Email");
    expect(VALID_CHANNELS.length).toBe(3);
  });

  test("VALID_DECISION_STATES contains expected values", () => {
    expect(VALID_DECISION_STATES).toContain("advance");
    expect(VALID_DECISION_STATES).toContain("nurture");
    expect(VALID_DECISION_STATES).toContain("disqualify");
    expect(VALID_DECISION_STATES).toContain("pending");
    expect(VALID_DECISION_STATES.length).toBe(4);
  });

  test("VALID_OBJECTION_TYPES contains expected values", () => {
    expect(VALID_OBJECTION_TYPES).toContain("trust");
    expect(VALID_OBJECTION_TYPES).toContain("price");
    expect(VALID_OBJECTION_TYPES).toContain("workflow-fit");
    expect(VALID_OBJECTION_TYPES).toContain("missing-feature");
    expect(VALID_OBJECTION_TYPES).toContain("timing");
    expect(VALID_OBJECTION_TYPES).toContain("other");
    expect(VALID_OBJECTION_TYPES.length).toBe(6);
  });
});

// ============================================================================
// Duplicate Detection Tests (TP005)
// ============================================================================

describe("parseExistingMessageIds", () => {
  test("extracts messageIds from RECEIVE_REPLY events in event log", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "pilot-replies-existing-events.events.md"),
      "utf-8"
    );
    const messageIds = parseExistingMessageIds(content);

    expect(messageIds.has("existing-msg-001")).toBe(true);
    expect(messageIds.has("existing-msg-002")).toBe(true);
    expect(messageIds.size).toBe(2);
  });

  test("returns empty set for event log without RECEIVE_REPLY events", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md"),
      "utf-8"
    );
    const messageIds = parseExistingMessageIds(content);
    expect(messageIds.size).toBe(0);
  });

  test("returns empty set for content without valid table", () => {
    const content = "# No events\n\nNothing here.";
    const messageIds = parseExistingMessageIds(content);
    expect(messageIds.size).toBe(0);
  });

  test("handles malformed JSON payloads gracefully", () => {
    const content = `
| Event ID | Event Type | Recipient Handle | Event Timestamp | Payload |
| --- | --- | --- | --- | --- |
| test-001 | RECEIVE_REPLY | test_user | 2026-02-20T10:00:00Z | {malformed json} |
| test-002 | RECEIVE_REPLY | test_user | 2026-02-20T11:00:00Z | {"messageId":"valid-msg"} |
`;
    const messageIds = parseExistingMessageIds(content);
    expect(messageIds.has("valid-msg")).toBe(true);
    expect(messageIds.size).toBe(1);
  });
});

describe("loadExistingMessageIds", () => {
  test("loads messageIds from event log file", () => {
    const messageIds = loadExistingMessageIds(
      join(FIXTURES_DIR, "pilot-replies-existing-events.events.md")
    );

    expect(messageIds.has("existing-msg-001")).toBe(true);
    expect(messageIds.has("existing-msg-002")).toBe(true);
  });

  test("returns empty set for non-existent file", () => {
    const messageIds = loadExistingMessageIds(
      join(FIXTURES_DIR, "non-existent-file.md")
    );
    expect(messageIds.size).toBe(0);
  });
});

describe("suppressDuplicates", () => {
  test("suppresses duplicate messageIds within input batch", () => {
    const rows = [
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "First",
        rowIndex: 1,
      },
      {
        messageId: "msg-002",
        recipientHandle: "pilot_bravo",
        timestamp: "2026-02-15T11:00:00Z",
        channel: "Discord DM" as const,
        workflowSentence: "Second",
        rowIndex: 2,
      },
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T12:00:00Z",
        channel: "X DM" as const,
        workflowSentence: "Duplicate",
        rowIndex: 3,
      },
    ];

    const existingMessageIds = new Set<string>();
    const { uniqueRows, suppressed } = suppressDuplicates(rows, existingMessageIds);

    expect(uniqueRows.length).toBe(2);
    expect(suppressed.length).toBe(1);
    expect(suppressed[0].messageId).toBe("msg-001");
    expect(suppressed[0].rowIndex).toBe(3);
    expect(suppressed[0].reason).toBe("DUPLICATE_MESSAGE_ID");
  });

  test("suppresses messageIds that already exist in event log", () => {
    const rows = [
      {
        messageId: "existing-msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-21T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "Duplicate in event log",
        rowIndex: 1,
      },
      {
        messageId: "new-msg-001",
        recipientHandle: "pilot_bravo",
        timestamp: "2026-02-21T11:00:00Z",
        channel: "Discord DM" as const,
        workflowSentence: "New unique message",
        rowIndex: 2,
      },
    ];

    const existingMessageIds = new Set(["existing-msg-001", "existing-msg-002"]);
    const { uniqueRows, suppressed } = suppressDuplicates(rows, existingMessageIds);

    expect(uniqueRows.length).toBe(1);
    expect(uniqueRows[0].messageId).toBe("new-msg-001");
    expect(suppressed.length).toBe(1);
    expect(suppressed[0].messageId).toBe("existing-msg-001");
    expect(suppressed[0].reason).toBe("DUPLICATE_MESSAGE_ID");
  });

  test("suppresses both batch and existing duplicates", () => {
    const rows = [
      {
        messageId: "existing-msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-21T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "Existing duplicate",
        rowIndex: 1,
      },
      {
        messageId: "msg-001",
        recipientHandle: "pilot_bravo",
        timestamp: "2026-02-21T11:00:00Z",
        channel: "Discord DM" as const,
        workflowSentence: "First in batch",
        rowIndex: 2,
      },
      {
        messageId: "msg-001",
        recipientHandle: "pilot_bravo",
        timestamp: "2026-02-21T12:00:00Z",
        channel: "Discord DM" as const,
        workflowSentence: "Batch duplicate",
        rowIndex: 3,
      },
    ];

    const existingMessageIds = new Set(["existing-msg-001"]);
    const { uniqueRows, suppressed } = suppressDuplicates(rows, existingMessageIds);

    expect(uniqueRows.length).toBe(1);
    expect(uniqueRows[0].messageId).toBe("msg-001");
    expect(uniqueRows[0].rowIndex).toBe(2);
    expect(suppressed.length).toBe(2);
    expect(suppressed.map((s) => s.rowIndex)).toEqual([1, 3]);
  });

  test("returns all rows when no duplicates", () => {
    const rows = [
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "First",
        rowIndex: 1,
      },
      {
        messageId: "msg-002",
        recipientHandle: "pilot_bravo",
        timestamp: "2026-02-15T11:00:00Z",
        channel: "Discord DM" as const,
        workflowSentence: "Second",
        rowIndex: 2,
      },
    ];

    const existingMessageIds = new Set<string>();
    const { uniqueRows, suppressed } = suppressDuplicates(rows, existingMessageIds);

    expect(uniqueRows.length).toBe(2);
    expect(suppressed.length).toBe(0);
  });
});

describe("sortRowsDeterministically", () => {
  test("sorts rows by timestamp first", () => {
    const rows = [
      {
        messageId: "msg-003",
        recipientHandle: "pilot_charlie",
        timestamp: "2026-02-15T15:00:00Z",
        channel: "Email" as const,
        workflowSentence: "Third",
        rowIndex: 3,
      },
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "First",
        rowIndex: 1,
      },
      {
        messageId: "msg-002",
        recipientHandle: "pilot_bravo",
        timestamp: "2026-02-15T11:00:00Z",
        channel: "Discord DM" as const,
        workflowSentence: "Second",
        rowIndex: 2,
      },
    ];

    const sorted = sortRowsDeterministically(rows);

    expect(sorted[0].messageId).toBe("msg-001");
    expect(sorted[1].messageId).toBe("msg-002");
    expect(sorted[2].messageId).toBe("msg-003");
  });

  test("sorts by messageId when timestamps are equal", () => {
    const rows = [
      {
        messageId: "msg-003",
        recipientHandle: "pilot_charlie",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "Email" as const,
        workflowSentence: "Third",
        rowIndex: 3,
      },
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "First",
        rowIndex: 1,
      },
      {
        messageId: "msg-002",
        recipientHandle: "pilot_bravo",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "Discord DM" as const,
        workflowSentence: "Second",
        rowIndex: 2,
      },
    ];

    const sorted = sortRowsDeterministically(rows);

    expect(sorted[0].messageId).toBe("msg-001");
    expect(sorted[1].messageId).toBe("msg-002");
    expect(sorted[2].messageId).toBe("msg-003");
  });

  test("maintains stable order across multiple sorts", () => {
    const rows = [
      {
        messageId: "msg-003",
        recipientHandle: "pilot_charlie",
        timestamp: "2026-02-15T15:00:00Z",
        channel: "Email" as const,
        workflowSentence: "Third",
        rowIndex: 3,
      },
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "First",
        rowIndex: 1,
      },
    ];

    // Sort multiple times and verify stability
    const sorted1 = sortRowsDeterministically(rows);
    const sorted2 = sortRowsDeterministically(rows);
    const sorted3 = sortRowsDeterministically(rows);

    expect(sorted1.map((r) => r.messageId)).toEqual(["msg-001", "msg-003"]);
    expect(sorted2.map((r) => r.messageId)).toEqual(["msg-001", "msg-003"]);
    expect(sorted3.map((r) => r.messageId)).toEqual(["msg-001", "msg-003"]);
  });
});

// ============================================================================
// Upsert Planner Tests (TP006)
// ============================================================================

import {
  getNextSequenceForRecipient,
  generateEventId,
  normalizeTimestamp,
  planEventLogUpserts,
  planResponseLogUpserts,
  buildUpsertPlan,
} from "../../tools/pilot-ingest-replies";

describe("getNextSequenceForRecipient", () => {
  test("returns highest sequence number for recipient in event log", () => {
    const eventsPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md");
    const sequence = getNextSequenceForRecipient("pilot_alpha", eventsPath);
    // Event log has SEND_OUTREACH-pilot_alpha-0001, so next sequence should be 1
    expect(sequence).toBe(1);
  });

  test("returns 0 for recipient with no events", () => {
    const eventsPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md");
    const sequence = getNextSequenceForRecipient("unknown_recipient", eventsPath);
    expect(sequence).toBe(0);
  });

  test("returns 0 for non-existent file", () => {
    const sequence = getNextSequenceForRecipient("pilot_alpha", "/nonexistent/path.md");
    expect(sequence).toBe(0);
  });
});

describe("generateEventId", () => {
  test("generates canonical event ID with zero-padded sequence", () => {
    const eventId = generateEventId("pilot_alpha", 1);
    expect(eventId).toBe("RECEIVE_REPLY-pilot_alpha-0001");
  });

  test("pads sequence to 4 digits", () => {
    const eventId = generateEventId("pilot_alpha", 42);
    expect(eventId).toBe("RECEIVE_REPLY-pilot_alpha-0042");
  });

  test("strips @ prefix from handle", () => {
    const eventId = generateEventId("@pilot_alpha", 1);
    expect(eventId).toBe("RECEIVE_REPLY-pilot_alpha-0001");
  });
});

describe("normalizeTimestamp", () => {
  test("normalizes ISO 8601 timestamp to Z suffix format", () => {
    const normalized = normalizeTimestamp("2026-02-15T10:30:00Z");
    expect(normalized).toBe("2026-02-15T10:30:00.000Z");
  });

  test("handles timestamps without Z suffix", () => {
    const normalized = normalizeTimestamp("2026-02-15T10:30:00");
    expect(normalized).toMatch(/^2026-02-15T\d{2}:30:00\.\d{3}Z$/);
  });

  test("throws for invalid timestamp", () => {
    expect(() => normalizeTimestamp("invalid")).toThrow();
  });
});

describe("planEventLogUpserts", () => {
  test("generates canonical RECEIVE_REPLY events", () => {
    const rows = [
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "Test reply",
        rowIndex: 1,
      },
    ];
    const eventsPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md");

    const upserts = planEventLogUpserts(rows, eventsPath);

    expect(upserts.length).toBe(1);
    expect(upserts[0].eventType).toBe("RECEIVE_REPLY");
    expect(upserts[0].eventId).toBe("RECEIVE_REPLY-pilot_alpha-0002");
    expect(upserts[0].recipientHandle).toBe("pilot_alpha");
    expect(upserts[0].payload.messageId).toBe("msg-001");
    expect(upserts[0].payload.channel).toBe("X DM");
    expect(upserts[0].payload.workflowSentence).toBe("Test reply");
  });

  test("includes optional fields in payload", () => {
    const rows = [
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "Test reply",
        decision: "advance" as const,
        objection: "price" as const,
        wtp: 20,
        wtpSource: "explicit" as const,
        rationale: "Good fit",
        rowIndex: 1,
      },
    ];
    const eventsPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md");

    const upserts = planEventLogUpserts(rows, eventsPath);

    expect(upserts[0].payload.decision).toBe("advance");
    expect(upserts[0].payload.objection).toBe("price");
    expect(upserts[0].payload.wtp).toBe(20);
    expect(upserts[0].payload.wtpSource).toBe("explicit");
    expect(upserts[0].payload.rationale).toBe("Good fit");
  });

  test("sorts events deterministically by timestamp", () => {
    const rows = [
      {
        messageId: "msg-002",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T15:00:00Z",
        channel: "X DM" as const,
        workflowSentence: "Later",
        rowIndex: 2,
      },
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "Earlier",
        rowIndex: 1,
      },
    ];
    const eventsPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md");

    const upserts = planEventLogUpserts(rows, eventsPath);

    expect(upserts[0].payload.messageId).toBe("msg-001");
    expect(upserts[1].payload.messageId).toBe("msg-002");
    // Sequences should be assigned in timestamp order
    expect(upserts[0].eventId).toBe("RECEIVE_REPLY-pilot_alpha-0002");
    expect(upserts[1].eventId).toBe("RECEIVE_REPLY-pilot_alpha-0003");
  });

  test("increments sequence per recipient", () => {
    const rows = [
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "Alpha reply",
        rowIndex: 1,
      },
      {
        messageId: "msg-002",
        recipientHandle: "pilot_bravo",
        timestamp: "2026-02-15T11:00:00Z",
        channel: "Discord DM" as const,
        workflowSentence: "Bravo reply",
        rowIndex: 2,
      },
    ];
    const eventsPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md");

    const upserts = planEventLogUpserts(rows, eventsPath);

    // Both should have sequence 0002 (after SEND_OUTREACH-0001 in fixture)
    expect(upserts[0].eventId).toBe("RECEIVE_REPLY-pilot_alpha-0002");
    expect(upserts[1].eventId).toBe("RECEIVE_REPLY-pilot_bravo-0002");
  });
});

describe("planResponseLogUpserts", () => {
  test("generates response-log upserts with required fields", () => {
    const rows = [
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "Test reply",
        rowIndex: 1,
      },
    ];

    const upserts = planResponseLogUpserts(rows);

    expect(upserts.length).toBe(1);
    expect(upserts[0].recipientHandle).toBe("pilot_alpha");
    expect(upserts[0].fields.workflowSentence).toBe("Test reply");
    expect(upserts[0].fields.responseState).toBe("replied");
    expect(upserts[0].fields.responseTimestamp).toBe("2026-02-15T10:30:00.000Z");
  });

  test("includes optional fields when present", () => {
    const rows = [
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "Test reply",
        decision: "advance" as const,
        objection: "price" as const,
        wtp: 25,
        wtpSource: "inferred" as const,
        rationale: "Strong signal",
        rowIndex: 1,
      },
    ];

    const upserts = planResponseLogUpserts(rows);

    expect(upserts[0].fields.decisionState).toBe("advance");
    expect(upserts[0].fields.objectionType).toBe("price");
    expect(upserts[0].fields.wtp).toBe(25);
    expect(upserts[0].fields.wtpSource).toBe("inferred");
    expect(upserts[0].fields.decisionRationale).toBe("Strong signal");
  });

  test("keeps latest values for multiple replies from same recipient", () => {
    const rows = [
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "First reply",
        rowIndex: 1,
      },
      {
        messageId: "msg-002",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T15:00:00Z",
        channel: "X DM" as const,
        workflowSentence: "Second reply",
        decision: "advance" as const,
        rowIndex: 2,
      },
    ];

    const upserts = planResponseLogUpserts(rows);

    // Should only have one upsert per recipient
    expect(upserts.length).toBe(1);
    // Should use latest values
    expect(upserts[0].fields.workflowSentence).toBe("Second reply");
    expect(upserts[0].fields.decisionState).toBe("advance");
    expect(upserts[0].fields.responseTimestamp).toBe("2026-02-15T15:00:00.000Z");
  });

  test("sorts upserts by recipient handle", () => {
    const rows = [
      {
        messageId: "msg-002",
        recipientHandle: "pilot_bravo",
        timestamp: "2026-02-15T10:00:00Z",
        channel: "Discord DM" as const,
        workflowSentence: "Bravo",
        rowIndex: 2,
      },
      {
        messageId: "msg-003",
        recipientHandle: "pilot_charlie",
        timestamp: "2026-02-15T11:00:00Z",
        channel: "Email" as const,
        workflowSentence: "Charlie",
        rowIndex: 3,
      },
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T09:00:00Z",
        channel: "X DM" as const,
        workflowSentence: "Alpha",
        rowIndex: 1,
      },
    ];

    const upserts = planResponseLogUpserts(rows);

    expect(upserts[0].recipientHandle).toBe("pilot_alpha");
    expect(upserts[1].recipientHandle).toBe("pilot_bravo");
    expect(upserts[2].recipientHandle).toBe("pilot_charlie");
  });
});

describe("buildUpsertPlan", () => {
  test("generates both event-log and response-log upserts", () => {
    const rows = [
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "Test reply",
        decision: "advance" as const,
        rowIndex: 1,
      },
    ];
    const eventsPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md");

    const plan = buildUpsertPlan(rows, eventsPath);

    expect(plan.eventLogUpserts.length).toBe(1);
    expect(plan.responseLogUpserts.length).toBe(1);

    // Event log should have canonical RECEIVE_REPLY
    expect(plan.eventLogUpserts[0].eventType).toBe("RECEIVE_REPLY");
    expect(plan.eventLogUpserts[0].payload.decision).toBe("advance");

    // Response log should have updated fields
    expect(plan.responseLogUpserts[0].fields.decisionState).toBe("advance");
    expect(plan.responseLogUpserts[0].fields.responseState).toBe("replied");
  });

  test("maintains deterministic output across multiple runs", () => {
    const rows = [
      {
        messageId: "msg-001",
        recipientHandle: "pilot_alpha",
        timestamp: "2026-02-15T10:30:00Z",
        channel: "X DM" as const,
        workflowSentence: "Test",
        rowIndex: 1,
      },
      {
        messageId: "msg-002",
        recipientHandle: "pilot_bravo",
        timestamp: "2026-02-15T11:00:00Z",
        channel: "Discord DM" as const,
        workflowSentence: "Test",
        rowIndex: 2,
      },
    ];
    const eventsPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md");

    // Run plan multiple times
    const plan1 = buildUpsertPlan(rows, eventsPath);
    const plan2 = buildUpsertPlan(rows, eventsPath);
    const plan3 = buildUpsertPlan(rows, eventsPath);

    // Verify identical output
    expect(plan1.eventLogUpserts).toEqual(plan2.eventLogUpserts);
    expect(plan1.eventLogUpserts).toEqual(plan3.eventLogUpserts);
    expect(plan1.responseLogUpserts).toEqual(plan2.responseLogUpserts);
    expect(plan1.responseLogUpserts).toEqual(plan3.responseLogUpserts);
  });
});

// ============================================================================
// TP008: Deterministic Upsert Summary Tests (End-to-End Fixture Verification)
// ============================================================================

import type {
  IngestOutput,
  NormalizedInputRow,
} from "../../tools/pilot-ingest-replies";

/**
 * Run the full ingestion pipeline on a fixture and return the output.
 * This simulates the CLI command flow for deterministic verification.
 */
function runIngestionPipeline(
  inputPath: string,
  responsesPath: string,
  eventsPath: string
): IngestOutput {
  // Load known recipients
  const knownRecipients = loadKnownRecipients(responsesPath, eventsPath);

  // Parse NDJSON input
  const inputContent = readFileSync(inputPath, "utf-8");
  const { rows: rawRows, errors: parseErrors } = parseNDJSON(inputContent);

  // Validate each row
  const normalizedRows: NormalizedInputRow[] = [];
  const validationErrors = [...parseErrors];

  for (let i = 0; i < rawRows.length; i++) {
    const result = validateRow(rawRows[i], i + 1, knownRecipients);
    if (result.row) {
      normalizedRows.push(result.row);
    } else if (result.error) {
      validationErrors.push(result.error);
    }
  }

  // Load existing message IDs and suppress duplicates
  const existingMessageIds = loadExistingMessageIds(eventsPath);
  const { uniqueRows, suppressed: suppressedEntries } = suppressDuplicates(
    normalizedRows,
    existingMessageIds
  );

  // Sort and build upsert plan
  const sortedRows = sortRowsDeterministically(uniqueRows);
  const { eventLogUpserts, responseLogUpserts } = buildUpsertPlan(
    sortedRows,
    eventsPath
  );

  // Build output envelope
  const hasErrors = validationErrors.length > 0;
  const hasSuppressed = suppressedEntries.length > 0;
  const status: "success" | "partial" | "failed" = hasErrors
    ? "failed"
    : hasSuppressed
    ? "partial"
    : "success";

  return {
    status,
    processed: rawRows.length,
    upserts: {
      responseLog: responseLogUpserts.length,
      eventLog: eventLogUpserts.length,
    },
    suppressed: suppressedEntries.length,
    errors: validationErrors,
    responseLogUpserts,
    eventLogUpserts,
    suppressedEntries,
    inputPath,
    responsesPath,
    eventsPath,
  };
}

describe("TP008: Deterministic upsert summary fixtures", () => {
  test("happy path produces expected upsert summary", () => {
    const expected: IngestOutput = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "pilot-replies.expected.json"), "utf-8")
    );

    const output = runIngestionPipeline(
      join(FIXTURES_DIR, "pilot-replies.ndjson"),
      join(FIXTURES_DIR, "pilot-ingest-replies-base.responses.md"),
      join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md")
    );

    // Assert top-level summary fields
    expect(output.status).toBe(expected.status);
    expect(output.processed).toBe(expected.processed);
    expect(output.upserts.responseLog).toBe(expected.upserts.responseLog);
    expect(output.upserts.eventLog).toBe(expected.upserts.eventLog);
    expect(output.suppressed).toBe(expected.suppressed);
    expect(output.errors.length).toBe(expected.errors.length);

    // Assert deterministic upsert content
    expect(output.responseLogUpserts).toEqual(expected.responseLogUpserts);
    expect(output.eventLogUpserts).toEqual(expected.eventLogUpserts);
  });

  test("upsert summary is deterministic across multiple runs", () => {
    const inputPath = join(FIXTURES_DIR, "pilot-replies.ndjson");
    const responsesPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.responses.md");
    const eventsPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md");

    // Run pipeline multiple times
    const output1 = runIngestionPipeline(inputPath, responsesPath, eventsPath);
    const output2 = runIngestionPipeline(inputPath, responsesPath, eventsPath);
    const output3 = runIngestionPipeline(inputPath, responsesPath, eventsPath);

    // Verify identical output across all runs
    expect(output1.status).toBe(output2.status);
    expect(output1.status).toBe(output3.status);
    expect(output1.responseLogUpserts).toEqual(output2.responseLogUpserts);
    expect(output1.responseLogUpserts).toEqual(output3.responseLogUpserts);
    expect(output1.eventLogUpserts).toEqual(output2.eventLogUpserts);
    expect(output1.eventLogUpserts).toEqual(output3.eventLogUpserts);
  });
});

describe("TP008: Duplicate suppression behavior", () => {
  test("batch duplicates are suppressed with DUPLICATE_MESSAGE_ID rule", () => {
    const expected: IngestOutput = JSON.parse(
      readFileSync(
        join(FIXTURES_DIR, "pilot-replies-duplicates.expected.json"),
        "utf-8"
      )
    );

    const output = runIngestionPipeline(
      join(FIXTURES_DIR, "pilot-replies-duplicates.ndjson"),
      join(FIXTURES_DIR, "pilot-ingest-replies-base.responses.md"),
      join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md")
    );

    // Assert status is partial (has suppressed entries)
    expect(output.status).toBe("partial");
    expect(output.suppressed).toBe(2);

    // Assert exact suppressed entries
    expect(output.suppressedEntries?.length).toBe(2);
    expect(output.suppressedEntries).toEqual(expected.suppressedEntries);

    // Verify each suppressed entry has exact rule ID
    for (const entry of output.suppressedEntries ?? []) {
      expect(entry.reason).toBe("DUPLICATE_MESSAGE_ID");
    }

    // Verify upserts only contain unique messages
    expect(output.upserts.responseLog).toBe(3);
    expect(output.upserts.eventLog).toBe(3);
    expect(output.responseLogUpserts).toEqual(expected.responseLogUpserts);
    expect(output.eventLogUpserts).toEqual(expected.eventLogUpserts);
  });

  test("existing event log duplicates are suppressed with DUPLICATE_MESSAGE_ID rule", () => {
    const expected: IngestOutput = JSON.parse(
      readFileSync(
        join(FIXTURES_DIR, "pilot-replies-duplicate-existing.expected.json"),
        "utf-8"
      )
    );

    const output = runIngestionPipeline(
      join(FIXTURES_DIR, "pilot-replies-duplicate-existing.ndjson"),
      join(FIXTURES_DIR, "pilot-ingest-replies-base.responses.md"),
      join(FIXTURES_DIR, "pilot-replies-existing-events.events.md")
    );

    // Assert status is partial (has suppressed entries)
    expect(output.status).toBe("partial");
    expect(output.suppressed).toBe(2);

    // Assert exact suppressed entries match expected
    expect(output.suppressedEntries).toEqual(expected.suppressedEntries);

    // Verify each suppressed entry has exact rule ID
    for (const entry of output.suppressedEntries ?? []) {
      expect(entry.reason).toBe("DUPLICATE_MESSAGE_ID");
    }

    // Verify upserts only contain unique messages
    expect(output.upserts.responseLog).toBe(1);
    expect(output.upserts.eventLog).toBe(1);
    expect(output.responseLogUpserts).toEqual(expected.responseLogUpserts);
    expect(output.eventLogUpserts).toEqual(expected.eventLogUpserts);
  });

  test("duplicate suppression is deterministic across runs", () => {
    const inputPath = join(FIXTURES_DIR, "pilot-replies-duplicates.ndjson");
    const responsesPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.responses.md");
    const eventsPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md");

    const output1 = runIngestionPipeline(inputPath, responsesPath, eventsPath);
    const output2 = runIngestionPipeline(inputPath, responsesPath, eventsPath);

    expect(output1.suppressedEntries).toEqual(output2.suppressedEntries);
    expect(output1.responseLogUpserts).toEqual(output2.responseLogUpserts);
    expect(output1.eventLogUpserts).toEqual(output2.eventLogUpserts);
  });
});

describe("TP008: Exact rule-ID failures", () => {
  test("INVALID_DECISION_STATE errors have exact rule IDs and details", () => {
    const expected: IngestOutput = JSON.parse(
      readFileSync(
        join(FIXTURES_DIR, "pilot-replies-invalid-decision.expected.json"),
        "utf-8"
      )
    );

    const output = runIngestionPipeline(
      join(FIXTURES_DIR, "pilot-replies-invalid-decision.ndjson"),
      join(FIXTURES_DIR, "pilot-ingest-replies-base.responses.md"),
      join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md")
    );

    // Assert status is failed (has errors)
    expect(output.status).toBe("failed");

    // Assert exact error count
    expect(output.errors.length).toBe(2);

    // Verify each error has exact INVALID_DECISION_STATE rule ID
    for (const error of output.errors) {
      expect(error.ruleId).toBe("INVALID_DECISION_STATE");
      expect(error.details?.valid).toEqual(["advance", "nurture", "disqualify", "pending"]);
    }

    // Assert errors match expected exactly
    expect(output.errors).toEqual(expected.errors);

    // Verify valid rows still produce upserts
    expect(output.upserts.responseLog).toBe(2);
    expect(output.upserts.eventLog).toBe(2);
    expect(output.responseLogUpserts).toEqual(expected.responseLogUpserts);
    expect(output.eventLogUpserts).toEqual(expected.eventLogUpserts);
  });

  test("UNKNOWN_RECIPIENT errors have exact rule IDs and details", () => {
    const expected: IngestOutput = JSON.parse(
      readFileSync(
        join(FIXTURES_DIR, "pilot-replies-unknown-recipient.expected.json"),
        "utf-8"
      )
    );

    const output = runIngestionPipeline(
      join(FIXTURES_DIR, "pilot-replies-unknown-recipient.ndjson"),
      join(FIXTURES_DIR, "pilot-ingest-replies-base.responses.md"),
      join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md")
    );

    // Assert status is failed (has errors)
    expect(output.status).toBe("failed");

    // Assert exact error count
    expect(output.errors.length).toBe(2);

    // Verify each error has exact UNKNOWN_RECIPIENT rule ID
    for (const error of output.errors) {
      expect(error.ruleId).toBe("UNKNOWN_RECIPIENT");
      expect(error.details?.knownRecipients).toEqual([
        "pilot_alpha",
        "pilot_bravo",
        "pilot_charlie",
      ]);
    }

    // Assert errors match expected exactly
    expect(output.errors).toEqual(expected.errors);

    // Verify valid rows still produce upserts
    expect(output.upserts.responseLog).toBe(2);
    expect(output.upserts.eventLog).toBe(2);
    expect(output.responseLogUpserts).toEqual(expected.responseLogUpserts);
    expect(output.eventLogUpserts).toEqual(expected.eventLogUpserts);
  });

  test("mixed error types have correct rule IDs in single batch", () => {
    const expected: IngestOutput = JSON.parse(
      readFileSync(
        join(FIXTURES_DIR, "pilot-replies-errors.expected.json"),
        "utf-8"
      )
    );

    const output = runIngestionPipeline(
      join(FIXTURES_DIR, "pilot-replies-errors.ndjson"),
      join(FIXTURES_DIR, "pilot-ingest-replies-base.responses.md"),
      join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md")
    );

    // Assert status is failed
    expect(output.status).toBe("failed");

    // Extract rule IDs from errors
    const ruleIds = output.errors.map((e) => e.ruleId);

    // Assert all expected rule IDs are present
    expect(ruleIds).toContain("MALFORMED_ROW");
    expect(ruleIds).toContain("UNKNOWN_RECIPIENT");
    expect(ruleIds).toContain("INVALID_CHANNEL");
    expect(ruleIds).toContain("INVALID_DECISION_STATE");
    expect(ruleIds).toContain("MISSING_MESSAGE_ID");

    // Assert exact error count
    expect(output.errors.length).toBe(6);

    // Verify no upserts (all rows invalid)
    expect(output.upserts.responseLog).toBe(0);
    expect(output.upserts.eventLog).toBe(0);

    // Assert errors match expected exactly
    expect(output.errors).toEqual(expected.errors);
  });

  test("error order is deterministic across runs", () => {
    const inputPath = join(FIXTURES_DIR, "pilot-replies-errors.ndjson");
    const responsesPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.responses.md");
    const eventsPath = join(FIXTURES_DIR, "pilot-ingest-replies-base.events.md");

    const output1 = runIngestionPipeline(inputPath, responsesPath, eventsPath);
    const output2 = runIngestionPipeline(inputPath, responsesPath, eventsPath);
    const output3 = runIngestionPipeline(inputPath, responsesPath, eventsPath);

    // Verify identical error ordering across runs
    const ruleIds1 = output1.errors.map((e) => e.ruleId);
    const ruleIds2 = output2.errors.map((e) => e.ruleId);
    const ruleIds3 = output3.errors.map((e) => e.ruleId);

    expect(ruleIds1).toEqual(ruleIds2);
    expect(ruleIds1).toEqual(ruleIds3);
  });
});
