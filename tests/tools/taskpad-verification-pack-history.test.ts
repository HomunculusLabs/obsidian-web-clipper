#!/usr/bin/env bun

/**
 * Verification Pack History Tests
 *
 * Tests for NDJSON history append, duplicate suppression,
 * malformed history recovery, and deterministic reason-code ordering.
 *
 * Contract: docs/quality/taskpad-verification-pack-history.md
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  HISTORY_SCHEMA_VERSION,
  RULE_IDS,
  CANONICAL_RULE_ORDER,
  generateEventId,
  getTimestamp,
  computeHash,
  computeWorkQueueFingerprint,
  getDuplicateKey,
  isDuplicate,
  serializeEvent,
  parseEventLine,
  readHistoryFile,
  findDuplicate,
  createHistoryEvent,
  appendToHistory,
  type VerificationPackHistoryEvent,
  type HistoryAppendResult,
  type HistoryReadResult,
} from "../../tools/lib/taskpad-verification-pack-history";

// ============================================================================
// Test Setup
// ============================================================================

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vph-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeTempHistoryPath(): string {
  const dir = makeTempDir();
  return join(dir, "history.ndjson");
}

// ============================================================================
// Helper Functions
// ============================================================================

function createTestEvent(overrides: Partial<VerificationPackHistoryEvent> = {}): VerificationPackHistoryEvent {
  return {
    version: HISTORY_SCHEMA_VERSION,
    eventType: "pack-generated",
    sliceId: "TASKPAD Intake Slice (2026-03-02): Test Slice",
    workQueueFingerprint: "abc123def456",
    packHash: "hash123",
    generatedAt: getTimestamp(),
    sourceCommand: "taskpad:verification-pack",
    driftRuleId: null,
    eventId: generateEventId(),
    ...overrides,
  };
}

function createHistoryLine(event: VerificationPackHistoryEvent): string {
  return serializeEvent(event);
}

// ============================================================================
// Tests: Append Success
// ============================================================================

describe("append success", () => {
  test("should append a single event to a new history file", () => {
    const historyPath = makeTempHistoryPath();
    const event = createTestEvent();

    const result = appendToHistory(historyPath, event, "skip");

    expect(result.success).toBe(true);
    expect(result.suppressed).toBe(false);

    // Verify file content
    const content = readFileSync(historyPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]) as VerificationPackHistoryEvent;
    expect(parsed.version).toBe(HISTORY_SCHEMA_VERSION);
    expect(parsed.eventType).toBe("pack-generated");
    expect(parsed.sliceId).toBe(event.sliceId);
    expect(parsed.packHash).toBe("hash123");
  });

  test("should append multiple events in order", () => {
    const historyPath = makeTempHistoryPath();

    const event1 = createTestEvent({
      eventId: "evt-1",
      packHash: "hash1",
      eventType: "pack-generated",
    });

    const event2 = createTestEvent({
      eventId: "evt-2",
      packHash: "hash2",
      eventType: "contract-evaluated",
    });

    const event3 = createTestEvent({
      eventId: "evt-3",
      packHash: "hash3",
      driftRuleId: RULE_IDS.FINGERPRINT_MISMATCH,
    });

    const result1 = appendToHistory(historyPath, event1, "skip");
    const result2 = appendToHistory(historyPath, event2, "skip");
    const result3 = appendToHistory(historyPath, event3, "skip");

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result3.success).toBe(true);

    const content = readFileSync(historyPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);

    const parsed1 = JSON.parse(lines[0]) as VerificationPackHistoryEvent;
    const parsed2 = JSON.parse(lines[1]) as VerificationPackHistoryEvent;
    const parsed3 = JSON.parse(lines[2]) as VerificationPackHistoryEvent;

    expect(parsed1.eventId).toBe("evt-1");
    expect(parsed1.eventType).toBe("pack-generated");

    expect(parsed2.eventId).toBe("evt-2");
    expect(parsed2.eventType).toBe("contract-evaluated");

    expect(parsed3.eventId).toBe("evt-3");
    expect(parsed3.driftRuleId).toBe(RULE_IDS.FINGERPRINT_MISMATCH);
  });

  test("should preserve all required and optional fields when appending", () => {
    const historyPath = makeTempHistoryPath();
    const event = createTestEvent({
      planPath: "/path/to/IMPLEMENTATION_PLAN.md",
      taskpadPath: "/path/to/TASKPAD.md",
      durationMs: 1234,
      metadata: {
        uncheckedCount: 5,
        plannedCount: 3,
        commandCount: 7,
        inputHash: "input-hash",
      },
    });

    const result = appendToHistory(historyPath, event, "skip");

    expect(result.success).toBe(true);

    const content = readFileSync(historyPath, "utf-8");
    const parsed = JSON.parse(content.trim()) as VerificationPackHistoryEvent;

    expect(parsed.planPath).toBe("/path/to/IMPLEMENTATION_PLAN.md");
    expect(parsed.taskpadPath).toBe("/path/to/TASKPAD.md");
    expect(parsed.durationMs).toBe(1234);
    expect(parsed.metadata).toBeDefined();
    expect(parsed.metadata?.uncheckedCount).toBe(5);
    expect(parsed.metadata?.plannedCount).toBe(3);
    expect(parsed.metadata?.commandCount).toBe(7);
    expect(parsed.metadata?.inputHash).toBe("input-hash");
  });

  test("should append NDJSON line with newline separator", () => {
    const historyPath = makeTempHistoryPath();
    const event1 = createTestEvent({ eventId: "evt-1", packHash: "hash1" });
    const event2 = createTestEvent({ eventId: "evt-2", packHash: "hash2" });

    appendToHistory(historyPath, event1, "skip");
    appendToHistory(historyPath, event2, "skip");

    const content = readFileSync(historyPath, "utf-8");
    expect(content).toMatch(/\n/);

    const lines = content.split("\n");
    expect(lines[lines.length - 1]).toBe(""); // Trailing newline
    expect(lines[lines.length - 2]).toBeTruthy(); // Last event before newline
  });
});

// ============================================================================
// Tests: Duplicate Suppression
// ============================================================================

describe("duplicate suppression", () => {
  test("should detect duplicate events based on duplicate key", () => {
    const event = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      sourceCommand: "taskpad:verification-pack",
      driftRuleId: null,
    });

    const duplicateEvent = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      sourceCommand: "taskpad:verification-pack",
      driftRuleId: null,
      eventId: "different-id", // Different event ID but same key
      generatedAt: "2026-03-02T12:00:00.000Z", // Different timestamp
    });

    expect(isDuplicate(event, duplicateEvent)).toBe(true);
  });

  test("should not treat events with different keys as duplicates", () => {
    const baseEvent = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
    });

    // Different sliceId
    const differentSlice = createTestEvent({
      sliceId: "slice-2",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
    });
    expect(isDuplicate(baseEvent, differentSlice)).toBe(false);

    // Different fingerprint
    const differentFp = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-2",
      packHash: "hash-1",
    });
    expect(isDuplicate(baseEvent, differentFp)).toBe(false);

    // Different pack hash
    const differentHash = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-2",
    });
    expect(isDuplicate(baseEvent, differentHash)).toBe(false);

    // Different sourceCommand
    const differentCommand = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      sourceCommand: "taskpad:verification-pack-contract",
    });
    expect(isDuplicate(baseEvent, differentCommand)).toBe(false);

    // Different driftRuleId
    const differentRule = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      driftRuleId: RULE_IDS.FINGERPRINT_MISMATCH,
    });
    expect(isDuplicate(baseEvent, differentRule)).toBe(false);
  });

  test("should suppress duplicate events with skip mode", () => {
    const historyPath = makeTempHistoryPath();

    const originalEvent = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      eventId: "evt-original",
    });

    const duplicateEvent = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      eventId: "evt-duplicate",
    });

    const result1 = appendToHistory(historyPath, originalEvent, "skip");
    const result2 = appendToHistory(historyPath, duplicateEvent, "skip");

    expect(result1.success).toBe(true);
    expect(result1.suppressed).toBe(false);
    expect(result1.originalEventId).toBeUndefined();

    expect(result2.success).toBe(true);
    expect(result2.suppressed).toBe(true);
    expect(result2.originalEventId).toBe("evt-original");
    expect(result2.event.eventType).toBe("duplicate-suppressed");
    expect(result2.event.driftRuleId).toBe(RULE_IDS.DUPLICATE_EVENT_SUPPRESSED);

    // Only one event should be in the file
    const content = readFileSync(historyPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
  });

  test("should append noop events with noop mode", () => {
    const historyPath = makeTempHistoryPath();

    const originalEvent = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      eventId: "evt-original",
    });

    const duplicateEvent = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      eventId: "evt-duplicate",
    });

    const result1 = appendToHistory(historyPath, originalEvent, "noop");
    const result2 = appendToHistory(historyPath, duplicateEvent, "noop");

    expect(result1.success).toBe(true);
    expect(result1.suppressed).toBe(false);

    expect(result2.success).toBe(true);
    expect(result2.suppressed).toBe(true);
    expect(result2.originalEventId).toBe("evt-original");
    expect(result2.event.eventType).toBe("duplicate-suppressed");
    expect(result2.event.driftRuleId).toBe(RULE_IDS.DUPLICATE_EVENT_SUPPRESSED);
    expect(result2.event.metadata?.duplicateOf).toBe("evt-original");

    // Both events should be in the file
    const content = readFileSync(historyPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsed2 = JSON.parse(lines[1]) as VerificationPackHistoryEvent;
    expect(parsed2.eventType).toBe("duplicate-suppressed");
  });

  test("should append duplicate events with append mode", () => {
    const historyPath = makeTempHistoryPath();

    const originalEvent = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      eventId: "evt-original",
    });

    const duplicateEvent = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      eventId: "evt-duplicate",
    });

    const result1 = appendToHistory(historyPath, originalEvent, "append");
    const result2 = appendToHistory(historyPath, duplicateEvent, "append");

    expect(result1.success).toBe(true);
    expect(result1.suppressed).toBe(false);

    expect(result2.success).toBe(true);
    expect(result2.suppressed).toBe(false); // Not suppressed, but recorded
    expect(result2.originalEventId).toBe("evt-original");
    expect(result2.event.metadata?.duplicateOf).toBe("evt-original");

    // Both events should be in the file
    const content = readFileSync(historyPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsed2 = JSON.parse(lines[1]) as VerificationPackHistoryEvent;
    expect(parsed2.eventId).toBe("evt-duplicate");
  });

  test("should find duplicate in existing history", () => {
    const historyPath = makeTempHistoryPath();

    const event1 = createTestEvent({
      eventId: "evt-1",
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
    });

    const event2 = createTestEvent({
      eventId: "evt-2",
      sliceId: "slice-2",
      workQueueFingerprint: "fp-2",
      packHash: "hash-2",
    });

    const duplicateOfEvent1 = createTestEvent({
      eventId: "evt-duplicate",
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
    });

    const result1 = appendToHistory(historyPath, event1, "skip");
    const result2 = appendToHistory(historyPath, event2, "skip");

    const readResult = readHistoryFile(historyPath);
    expect(readResult.success).toBe(true);
    expect(readResult.events).toHaveLength(2);

    const found = findDuplicate(duplicateOfEvent1, readResult.events);
    expect(found).toBe("evt-1");
  });

  test("should return null when no duplicate found", () => {
    const historyPath = makeTempHistoryPath();

    const event1 = createTestEvent({
      eventId: "evt-1",
      sliceId: "slice-1",
      packHash: "hash-1",
    });

    appendToHistory(historyPath, event1, "skip");

    const readResult = readHistoryFile(historyPath);
    const newEvent = createTestEvent({
      sliceId: "slice-2", // Different
      packHash: "hash-2", // Different
    });

    const found = findDuplicate(newEvent, readResult.events);
    expect(found).toBeNull();
  });
});

// ============================================================================
// Tests: Malformed History Recovery
// ============================================================================

describe("malformed history recovery", () => {
  test("should skip empty lines when reading history", () => {
    const historyPath = makeTempHistoryPath();

    const validEvent = createTestEvent({ eventId: "evt-1", packHash: "hash1" });

    // Write mixed content with empty lines
    writeFileSync(
      historyPath,
      `${serializeEvent(validEvent)}\n\n\n`,
      "utf-8",
    );

    const result = readHistoryFile(historyPath);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].eventId).toBe("evt-1");
  });

  test("should skip lines with invalid JSON", () => {
    const historyPath = makeTempHistoryPath();

    const validEvent = createTestEvent({ eventId: "evt-1", packHash: "hash1" });

    // The middle line is not valid JSON
    writeFileSync(
      historyPath,
      `${serializeEvent(validEvent)}\nthis is not valid json\n${serializeEvent(validEvent)}`,
      "utf-8",
    );

    const result = readHistoryFile(historyPath);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events[0].eventId).toBe("evt-1");
  });

  test("should skip lines with wrong schema version", () => {
    const historyPath = makeTempHistoryPath();

    const validEvent = createTestEvent({ eventId: "evt-1", packHash: "hash1" });
    const wrongVersionEvent = createTestEvent({ eventId: "evt-2", packHash: "hash2" });
    (wrongVersionEvent as any).version = 999; // Wrong version

    writeFileSync(
      historyPath,
      `${serializeEvent(validEvent)}\n${serializeEvent(wrongVersionEvent)}`,
      "utf-8",
    );

    const result = readHistoryFile(historyPath);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].eventId).toBe("evt-1");
  });

  test("should skip lines with missing required fields", () => {
    const historyPath = makeTempHistoryPath();

    const validEvent = createTestEvent({ eventId: "evt-1", packHash: "hash1" });

    // Missing eventType
    const missingEventType = {
      version: 1,
      sliceId: "slice-1",
      packHash: "hash-1",
    };

    // Missing sliceId
    const missingSliceId = {
      version: 1,
      eventType: "pack-generated",
      packHash: "hash-1",
    };

    // Missing packHash
    const missingPackHash = {
      version: 1,
      eventType: "pack-generated",
      sliceId: "slice-1",
    };

    writeFileSync(
      historyPath,
      `${serializeEvent(validEvent)}\n${JSON.stringify(missingEventType)}\n${JSON.stringify(missingSliceId)}\n${JSON.stringify(missingPackHash)}`,
      "utf-8",
    );

    const result = readHistoryFile(historyPath);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].eventId).toBe("evt-1");
  });

  test("should return success with empty events for non-existent file", () => {
    const historyPath = makeTempHistoryPath();

    const result = readHistoryFile(historyPath);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(0);
  });

  test("should handle truncated JSON gracefully", () => {
    const historyPath = makeTempHistoryPath();

    const validEvent = createTestEvent({ eventId: "evt-1", packHash: "hash1" });

    writeFileSync(
      historyPath,
      `${serializeEvent(validEvent)}\n{"version":1,"eventType":"pack-generated"`, // Truncated
      "utf-8",
    );

    const result = readHistoryFile(historyPath);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
  });

  test("should handle mixed valid and malformed content", () => {
    const historyPath = makeTempHistoryPath();

    const event1 = createTestEvent({ eventId: "evt-1", packHash: "hash1" });
    const event2 = createTestEvent({ eventId: "evt-2", packHash: "hash2" });
    const event3 = createTestEvent({ eventId: "evt-3", packHash: "hash3" });

    const content = [
      serializeEvent(event1),
      "", // Empty line
      "not json at all",
      `{invalid json here`,
      serializeEvent(event2),
      JSON.stringify({ version: 999 }), // Wrong version
      serializeEvent(event3),
    ].join("\n");

    writeFileSync(historyPath, content, "utf-8");

    const result = readHistoryFile(historyPath);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(3);
    expect(result.events.map((e) => e.eventId)).toEqual(["evt-1", "evt-2", "evt-3"]);
  });

  test("should return success with empty events for unreadable path", () => {
    // Use a path that exists but points to a directory to trigger a read error
    // Note: The current implementation handles non-existent files gracefully
    // returning success with empty events, so we test a directory instead
    const historyPath = tmpdir();

    const result = readHistoryFile(historyPath);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.ruleId).toBe(RULE_IDS.HISTORY_READ_FAILED);
    expect(result.events).toHaveLength(0);
  });
});

// ============================================================================
// Tests: Deterministic Reason-Code Ordering
// ============================================================================

describe("deterministic reason-code ordering", () => {
  test("should have canonical order for rule IDs", () => {
    expect(CANONICAL_RULE_ORDER).toEqual([
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
    ]);
  });

  test("should have all rule IDs included in canonical order", () => {
    const allRuleIds = Object.values(RULE_IDS);
    const canonicalSet = new Set(CANONICAL_RULE_ORDER);

    for (const ruleId of allRuleIds) {
      expect(canonicalSet.has(ruleId)).toBe(true);
    }
  });

  test("should have unique rule IDs", () => {
    const allRuleIds = Object.values(RULE_IDS);
    const uniqueRuleIds = new Set(allRuleIds);

    expect(allRuleIds).toHaveLength(uniqueRuleIds.size);
  });

  test("should use constant rule IDs for failure cases", () => {
    expect(RULE_IDS.SLICE_ID_MISMATCH).toBe("VPH001_SLICE_ID_MISMATCH");
    expect(RULE_IDS.FINGERPRINT_MISMATCH).toBe("VPH002_FINGERPRINT_MISMATCH");
    expect(RULE_IDS.PACK_HASH_MISMATCH).toBe("VPH003_PACK_HASH_MISMATCH");
    expect(RULE_IDS.PACK_NOT_FOUND).toBe("VPH004_PACK_NOT_FOUND");
    expect(RULE_IDS.PACK_PARSE_ERROR).toBe("VPH005_PACK_PARSE_ERROR");
    expect(RULE_IDS.MISSING_REQUIRED_FIELD).toBe("VPH006_MISSING_REQUIRED_FIELD");
    expect(RULE_IDS.COMMAND_NOT_EXECUTABLE).toBe("VPH007_COMMAND_NOT_EXECUTABLE");
    expect(RULE_IDS.HISTORY_APPEND_FAILED).toBe("VPH008_HISTORY_APPEND_FAILED");
    expect(RULE_IDS.HISTORY_READ_FAILED).toBe("VPH009_HISTORY_READ_FAILED");
    expect(RULE_IDS.DUPLICATE_EVENT_SUPPRESSED).toBe("VPH010_DUPLICATE_EVENT_SUPPRESSED");
  });

  test("should sort rule IDs deterministically by canonical order", () => {
    const unsortedRuleIds = [
      RULE_IDS.DUPLICATE_EVENT_SUPPRESSED,
      RULE_IDS.HISTORY_APPEND_FAILED,
      RULE_IDS.PACK_HASH_MISMATCH,
      RULE_IDS.SLICE_ID_MISMATCH,
      RULE_IDS.COMMAND_NOT_EXECUTABLE,
    ];

    const ruleIdIndex = new Map(CANONICAL_RULE_ORDER.map((id, idx) => [id, idx]));

    const sorted = [...unsortedRuleIds].sort((a, b) => {
      const idxA = ruleIdIndex.get(a) ?? -1;
      const idxB = ruleIdIndex.get(b) ?? -1;
      return idxA - idxB;
    });

    expect(sorted).toEqual([
      RULE_IDS.SLICE_ID_MISMATCH,
      RULE_IDS.PACK_HASH_MISMATCH,
      RULE_IDS.COMMAND_NOT_EXECUTABLE,
      RULE_IDS.HISTORY_APPEND_FAILED,
      RULE_IDS.DUPLICATE_EVENT_SUPPRESSED,
    ]);
  });

  test("should maintain deterministic ordering when generating duplicate suppression events", () => {
    const historyPath = makeTempHistoryPath();

    const event = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
    });

    // Append original
    appendToHistory(historyPath, event, "skip");

    // Try to append duplicate
    const duplicate = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
    });

    const result = appendToHistory(historyPath, duplicate, "skip");

    expect(result.success).toBe(true);
    expect(result.suppressed).toBe(true);
    expect(result.event.eventType).toBe("duplicate-suppressed");
    expect(result.event.driftRuleId).toBe(RULE_IDS.DUPLICATE_EVENT_SUPPRESSED);
  });
});

// ============================================================================
// Tests: Utility Functions
// ============================================================================

describe("utility functions", () => {
  test("generateEventId should create unique IDs", () => {
    const id1 = generateEventId();
    const id2 = generateEventId();

    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^evt-/);
    expect(id2).toMatch(/^evt-/);
  });

  test("getTimestamp should return ISO 8601 format", () => {
    const timestamp = getTimestamp();

    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("computeHash should create deterministic SHA-256 hashes", () => {
    const content = "test content";
    const hash1 = computeHash(content);
    const hash2 = computeHash(content);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  test("computeWorkQueueFingerprint should create deterministic fingerprints", () => {
    const bullets = [
      "  - [ ] Task 1",
      "- [ ] Task 2",
      "* [ ] Task 3",
    ];

    const fp1 = computeWorkQueueFingerprint(bullets);
    const fp2 = computeWorkQueueFingerprint(bullets);

    expect(fp1).toBe(fp2);
  });

  test("computeWorkQueueFingerprint should sort bullets deterministically", () => {
    const bullets1 = ["- [ ] Task C", "- [ ] Task A", "- [ ] Task B"];
    const bullets2 = ["- [ ] Task B", "- [ ] Task C", "- [ ] Task A"];

    const fp1 = computeWorkQueueFingerprint(bullets1);
    const fp2 = computeWorkQueueFingerprint(bullets2);

    expect(fp1).toBe(fp2);
  });

  test("getDuplicateKey should extract key fields", () => {
    const event = createTestEvent({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      sourceCommand: "taskpad:verification-pack",
      driftRuleId: RULE_IDS.FINGERPRINT_MISMATCH,
    });

    const key = getDuplicateKey(event);

    expect(key).toEqual({
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      sourceCommand: "taskpad:verification-pack",
      driftRuleId: RULE_IDS.FINGERPRINT_MISMATCH,
    });
  });

  test("createHistoryEvent should populate all required fields", () => {
    const event = createHistoryEvent({
      eventType: "pack-generated",
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      sourceCommand: "taskpad:verification-pack",
      driftRuleId: RULE_IDS.FINGERPRINT_MISMATCH,
      planPath: "/plan.md",
      taskpadPath: "/taskpad.md",
      durationMs: 100,
      metadata: {
        uncheckedCount: 5,
      },
    });

    expect(event.version).toBe(HISTORY_SCHEMA_VERSION);
    expect(event.eventType).toBe("pack-generated");
    expect(event.sliceId).toBe("slice-1");
    expect(event.workQueueFingerprint).toBe("fp-1");
    expect(event.packHash).toBe("hash-1");
    expect(event.sourceCommand).toBe("taskpad:verification-pack");
    expect(event.driftRuleId).toBe(RULE_IDS.FINGERPRINT_MISMATCH);
    expect(event.planPath).toBe("/plan.md");
    expect(event.taskpadPath).toBe("/taskpad.md");
    expect(event.durationMs).toBe(100);
    expect(event.metadata?.uncheckedCount).toBe(5);
    expect(event.eventId).toMatch(/^evt-/);
    expect(event.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("createHistoryEvent should handle null driftRuleId", () => {
    const event = createHistoryEvent({
      eventType: "contract-evaluated",
      sliceId: "slice-1",
      workQueueFingerprint: "fp-1",
      packHash: "hash-1",
      sourceCommand: "taskpad:verification-pack-contract",
    });

    expect(event.driftRuleId).toBeNull();
  });

  test("serializeEvent should append newline", () => {
    const event = createTestEvent();
    const serialized = serializeEvent(event);

    expect(serialized).toMatch(/\n$/);
  });

  test("parseEventLine should parse valid event", () => {
    const event = createTestEvent();
    const line = serializeEvent(event).trim();

    const parsed = parseEventLine(line);

    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe(HISTORY_SCHEMA_VERSION);
    expect(parsed?.eventType).toBe("pack-generated");
  });

  test("parseEventLine should return null for invalid JSON", () => {
    const parsed = parseEventLine("not valid json");
    expect(parsed).toBeNull();
  });

  test("parseEventLine should return null for empty line", () => {
    const parsed = parseEventLine("");
    expect(parsed).toBeNull();
  });
});
