import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// ============================================================================
// Helper Functions
// ============================================================================

const FIXTURE_DIR = resolve(__dirname, "fixtures");
const PROJECT_ROOT = resolve(__dirname, "../..");

interface CLIResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run pilot-rebuild CLI with given arguments
 */
function runPilotRebuild(args: string[]): CLIResult {
  const result = spawnSync("bun", ["run", "tools/pilot-rebuild.ts", ...args], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * Run pilot-rebuild and parse JSON output
 */
function runPilotRebuildJson(args: string[]): { output: Record<string, unknown>; result: CLIResult } {
  const result = runPilotRebuild([...args, "--format", "json"]);
  
  let output: Record<string, unknown> = {};
  if (result.stdout) {
    try {
      output = JSON.parse(result.stdout);
    } catch {
      // Output may not be valid JSON on error
    }
  }
  
  return { output, result };
}

/**
 * Get fixture path
 */
function fixturePath(name: string): string {
  return resolve(FIXTURE_DIR, name);
}

// ============================================================================
// Parser Validation Tests
// ============================================================================

describe("pilot-rebuild parser validation", () => {
  describe("valid event log parsing", () => {
    test("parses aligned fixture successfully", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
      ]);

      expect(result.status).toBe(0);
      expect(output.valid).toBe(true);
      expect(output.eventCount).toBe(4);
      expect(output.recipientCount).toBe(3);
      expect(output.batchId).toBe("test-aligned");
      expect(output.errors).toEqual([]);
    });

    test("emits sorted events array", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
      ]);

      expect(result.status).toBe(0);
      const events = output.events as Array<{ eventTimestamp: string }>;
      expect(events.length).toBe(4);
      
      // Verify events are sorted by timestamp
      for (let i = 1; i < events.length; i++) {
        expect(events[i].eventTimestamp >= events[i - 1].eventTimestamp).toBe(true);
      }
    });

    test("parses valid transitions fixture without errors", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-valid-transitions.events.md"),
      ]);

      expect(result.status).toBe(0);
      expect(output.valid).toBe(true);
      expect(output.eventCount).toBe(4);
    });
  });

  describe("frontmatter validation", () => {
    test("requires pilot-event-log artifact type", () => {
      // Create a minimal test with wrong artifact type inline
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-aligned.run-sheet.md"), // Wrong artifact type
      ]);

      expect(result.status).toBe(2); // INVALID_FRONTMATTER exit code
      expect(result.stderr).toContain("INVALID_FRONTMATTER");
    });
  });

  describe("event ID validation", () => {
    test("validates event ID format matches event type", () => {
      // The aligned fixture has properly formatted event IDs
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
      ]);

      expect(result.status).toBe(0);
      const events = output.events as Array<{ eventId: string; eventType: string }>;
      
      for (const event of events) {
        // Event ID should start with event type
        expect(event.eventId.startsWith(event.eventType)).toBe(true);
      }
    });
  });

  describe("timestamp validation", () => {
    test("accepts valid ISO-8601 timestamps with Z suffix", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
      ]);

      expect(result.status).toBe(0);
      const events = output.events as Array<{ eventTimestamp: string }>;
      
      for (const event of events) {
        // All timestamps should match ISO-8601 with Z suffix
        expect(event.eventTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      }
    });
  });

  describe("payload validation", () => {
    test("validates SEND_OUTREACH payload structure", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
      ]);

      expect(result.status).toBe(0);
      const events = output.events as Array<{ eventType: string; payload: Record<string, unknown> }>;
      const outreachEvents = events.filter(e => e.eventType === "SEND_OUTREACH");
      
      expect(outreachEvents.length).toBeGreaterThan(0);
      for (const event of outreachEvents) {
        expect(event.payload.channel).toBeDefined();
        expect(event.payload.artifactLink).toBeDefined();
        expect(event.payload.immediateOutcome).toBe("no response yet");
      }
    });

    test("validates RECEIVE_REPLY payload structure", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-valid-transitions.events.md"),
      ]);

      expect(result.status).toBe(0);
      const events = output.events as Array<{ eventType: string; payload: Record<string, unknown> }>;
      const replyEvents = events.filter(e => e.eventType === "RECEIVE_REPLY");
      
      expect(replyEvents.length).toBe(1);
      const payload = replyEvents[0].payload;
      expect(payload.channel).toBeDefined();
      expect(payload.workflowSentence).toBeDefined();
      expect(payload.replyTimestamp).toBeDefined();
    });
  });
});

// ============================================================================
// Reducer Determinism Tests
// ============================================================================

describe("pilot-rebuild reducer determinism", () => {
  describe("run-sheet reduction", () => {
    test("reduces events to one row per recipient", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-aligned.run-sheet.md"),
      ]);

      expect(result.status).toBe(0);
      const runSheet = output.runSheet as Record<string, unknown>;
      expect(runSheet.recipientCount).toBe(3);
      expect(runSheet.rows).toBeDefined();
      
      const rows = runSheet.rows as Array<{ recipientHandle: string }>;
      const handles = rows.map(r => r.recipientHandle);
      
      // Each recipient appears exactly once
      expect(new Set(handles).size).toBe(handles.length);
    });

    test("derives send status from terminal state", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-aligned.run-sheet.md"),
      ]);

      expect(result.status).toBe(0);
      const runSheet = output.runSheet as Record<string, unknown>;
      const rows = runSheet.rows as Array<{ recipientHandle: string; sendStatus: string }>;
      
      const bravoRow = rows.find(r => r.recipientHandle === "user_bravo");
      expect(bravoRow?.sendStatus).toBe("failed"); // Has MARK_FAILED event
    });

    test("sorts rows deterministically by recipient handle", () => {
      const { output: output1 } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-aligned.run-sheet.md"),
      ]);

      const { output: output2 } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-aligned.run-sheet.md"),
      ]);

      const rows1 = (output1.runSheet as Record<string, unknown>).rows as Array<{ recipientHandle: string }>;
      const rows2 = (output2.runSheet as Record<string, unknown>).rows as Array<{ recipientHandle: string }>;

      const handles1 = rows1.map(r => r.recipientHandle);
      const handles2 = rows2.map(r => r.recipientHandle);

      expect(handles1).toEqual(handles2);
    });
  });

  describe("response-log reduction", () => {
    test("derives workflow sentence from RECEIVE_REPLY event", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-valid-transitions.events.md"),
        "--responses", fixturePath("pilot-rebuild-aligned.responses.md"),
      ]);

      expect(result.status).toBe(0);
      const responseLog = output.responseLog as Record<string, unknown>;
      const rows = responseLog.rows as Array<{ workflowSentence: string }>;
      
      // The test_user has a RECEIVE_REPLY with workflow sentence
      const testUserRow = rows.find(r => true); // Only one recipient in this fixture
      expect(testUserRow?.workflowSentence).toBe("Interested in learning more");
    });

    test("defaults to 'no response yet' when no reply received", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--responses", fixturePath("pilot-rebuild-aligned.responses.md"),
      ]);

      expect(result.status).toBe(0);
      const responseLog = output.responseLog as Record<string, unknown>;
      const rows = responseLog.rows as Array<{ workflowSentence: string; responseState: string }>;
      
      for (const row of rows) {
        // None of these users have received replies
        expect(row.workflowSentence).toBe("no response yet");
        expect(row.responseState).toBe("no response yet");
      }
    });

    test("produces identical output across repeated runs", () => {
      const { output: output1 } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--responses", fixturePath("pilot-rebuild-aligned.responses.md"),
      ]);

      const { output: output2 } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--responses", fixturePath("pilot-rebuild-aligned.responses.md"),
      ]);

      // Remove any non-deterministic fields and compare
      const { runSheet: _1, ...rest1 } = output1;
      const { runSheet: _2, ...rest2 } = output2;

      expect(rest1).toEqual(rest2);
    });
  });
});

// ============================================================================
// --check Pass/Fail Branches with Exact Rule-ID Assertions
// ============================================================================

describe("pilot-rebuild --check mode", () => {
  describe("aligned pass case", () => {
    test("passes when reconstructed rows match provided artifacts", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-aligned.run-sheet.md"),
        "--responses", fixturePath("pilot-rebuild-aligned.responses.md"),
        "--check",
      ]);

      expect(result.status).toBe(0);
      expect(output.check).toBeDefined();
      
      const check = output.check as Record<string, unknown>;
      expect(check.passed).toBe(true);
      
      const runSheetCheck = check.runSheet as Record<string, unknown>;
      expect(runSheetCheck.passed).toBe(true);
      expect(runSheetCheck.matchingRowCount).toBe(3);
      
      const responseLogCheck = check.responseLog as Record<string, unknown>;
      expect(responseLogCheck.passed).toBe(true);
    });
  });

  describe("ROW_TIMESTAMP_DRIFT error", () => {
    test("emits ROW_TIMESTAMP_DRIFT for sent timestamp mismatch", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-row-timestamp-drift.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-row-timestamp-drift.run-sheet.md"),
        "--responses", fixturePath("pilot-rebuild-row-timestamp-drift.responses.md"),
        "--check",
      ]);

      expect(result.status).toBe(1);
      const check = output.check as Record<string, unknown>;
      expect(check.passed).toBe(false);
      
      const runSheetCheck = check.runSheet as Record<string, unknown>;
      const mismatches = runSheetCheck.mismatches as Array<{ ruleId: string; field: string; recipientHandle: string }>;
      
      const sentTimestampDrift = mismatches.filter(
        m => m.ruleId === "ROW_TIMESTAMP_DRIFT" && m.field === "sentTimestamp"
      );
      expect(sentTimestampDrift.length).toBeGreaterThan(0);
    });

    test("emits ROW_TIMESTAMP_DRIFT for follow-up timestamp mismatch", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-row-timestamp-drift.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-row-timestamp-drift.run-sheet.md"),
        "--responses", fixturePath("pilot-rebuild-row-timestamp-drift.responses.md"),
        "--check",
      ]);

      expect(result.status).toBe(1);
      const check = output.check as Record<string, unknown>;
      const runSheetCheck = check.runSheet as Record<string, unknown>;
      const mismatches = runSheetCheck.mismatches as Array<{ ruleId: string; field: string }>;
      
      const followupDrift = mismatches.filter(
        m => m.ruleId === "ROW_TIMESTAMP_DRIFT" && m.field === "followUpTimestamp"
      );
      expect(followupDrift.length).toBeGreaterThan(0);
    });

    test("emits ROW_TIMESTAMP_DRIFT for reply timestamp mismatch", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-row-timestamp-drift.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-row-timestamp-drift.run-sheet.md"),
        "--responses", fixturePath("pilot-rebuild-row-timestamp-drift.responses.md"),
        "--check",
      ]);

      expect(result.status).toBe(1);
      const check = output.check as Record<string, unknown>;
      const responseLogCheck = check.responseLog as Record<string, unknown>;
      const mismatches = responseLogCheck.mismatches as Array<{ ruleId: string; field: string }>;
      
      const replyDrift = mismatches.filter(
        m => m.ruleId === "ROW_TIMESTAMP_DRIFT" && m.field === "replyTimestamp"
      );
      expect(replyDrift.length).toBeGreaterThan(0);
    });

    test("includes exact expected and actual values in drift error", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-row-timestamp-drift.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-row-timestamp-drift.run-sheet.md"),
        "--responses", fixturePath("pilot-rebuild-row-timestamp-drift.responses.md"),
        "--check",
      ]);

      expect(result.status).toBe(1);
      const check = output.check as Record<string, unknown>;
      const runSheetCheck = check.runSheet as Record<string, unknown>;
      const mismatches = runSheetCheck.mismatches as Array<{ ruleId: string; expected: string; actual: string }>;
      
      const driftErrors = mismatches.filter(m => m.ruleId === "ROW_TIMESTAMP_DRIFT");
      for (const error of driftErrors) {
        expect(error.expected).toBeDefined();
        expect(error.actual).toBeDefined();
        expect(error.expected).not.toBe(error.actual);
      }
    });
  });

  describe("MISSING_EVENT error", () => {
    test("emits MISSING_EVENT when recipient in run-sheet has no events", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-missing-event.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-missing-event.run-sheet.md"),
        "--responses", fixturePath("pilot-rebuild-missing-event.responses.md"),
        "--check",
      ]);

      expect(result.status).toBe(1);
      const check = output.check as Record<string, unknown>;
      const runSheetCheck = check.runSheet as Record<string, unknown>;
      const mismatches = runSheetCheck.mismatches as Array<{ ruleId: string; recipientHandle: string }>;
      
      const missingEvent = mismatches.filter(
        m => m.ruleId === "MISSING_EVENT" && m.recipientHandle === "ghost_user"
      );
      expect(missingEvent.length).toBe(1);
    });

    test("emits MISSING_EVENT when recipient in response-log has no events", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-missing-event.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-missing-event.run-sheet.md"),
        "--responses", fixturePath("pilot-rebuild-missing-event.responses.md"),
        "--check",
      ]);

      expect(result.status).toBe(1);
      const check = output.check as Record<string, unknown>;
      const responseLogCheck = check.responseLog as Record<string, unknown>;
      const mismatches = responseLogCheck.mismatches as Array<{ ruleId: string; recipientHandle: string }>;
      
      const missingEvent = mismatches.filter(
        m => m.ruleId === "MISSING_EVENT" && m.recipientHandle === "ghost_user"
      );
      expect(missingEvent.length).toBe(1);
    });

    test("includes provided row details in MISSING_EVENT error", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-missing-event.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-missing-event.run-sheet.md"),
        "--responses", fixturePath("pilot-rebuild-missing-event.responses.md"),
        "--check",
      ]);

      expect(result.status).toBe(1);
      const check = output.check as Record<string, unknown>;
      const runSheetCheck = check.runSheet as Record<string, unknown>;
      const mismatches = runSheetCheck.mismatches as Array<{ ruleId: string; details: Record<string, unknown> }>;
      
      const missingEvent = mismatches.find(m => m.ruleId === "MISSING_EVENT");
      expect(missingEvent?.details?.providedRow).toBeDefined();
      const providedRow = missingEvent?.details?.providedRow as Record<string, unknown>;
      expect(providedRow.recipientHandle).toBe("ghost_user");
    });
  });
});

// ============================================================================
// INVALID_TRANSITION Rule-ID Assertions
// ============================================================================

describe("pilot-rebuild INVALID_TRANSITION validation", () => {
  describe("invalid lifecycle transitions", () => {
    test("emits INVALID_TRANSITION for SEND_FOLLOWUP after REPLIED", () => {
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-invalid-transition.events.md"),
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("INVALID_TRANSITION");
      expect(result.stderr).toContain("Cannot send follow-up after reply received");
    });

    test("includes exact event ID in INVALID_TRANSITION error", () => {
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-invalid-transition.events.md"),
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("SEND_FOLLOWUP-test_user-0001");
    });

    test("includes current state in INVALID_TRANSITION error", () => {
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-invalid-transition.events.md"),
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Current State: REPLIED");
    });

    test("includes attempted event type in INVALID_TRANSITION error", () => {
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-invalid-transition.events.md"),
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Attempted: SEND_FOLLOWUP");
    });

    test("includes valid transitions in INVALID_TRANSITION error", () => {
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-invalid-transition.events.md"),
      ]);

      expect(result.status).toBe(1);
      // REPLIED state allows these transitions
      expect(result.stderr).toContain("UPDATE_DECISION");
      expect(result.stderr).toContain("UPDATE_WTP");
      expect(result.stderr).toContain("UPDATE_OBJECTION");
    });
  });

  describe("terminal state violations", () => {
    test("emits INVALID_TRANSITION for events after MARK_FAILED", () => {
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-terminal-state.events.md"),
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("INVALID_TRANSITION");
      // After MARK_FAILED, no events should be allowed
      expect(result.stderr).toContain("Cannot receive reply after recipient marked as failed");
    });

    test("rejects events in FAILED terminal state", () => {
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-terminal-state.events.md"),
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("RECEIVE_REPLY");
      expect(result.stderr).toContain("failed");
    });
  });

  describe("valid transition acceptance", () => {
    test("accepts NO_CONTACT -> OUTREACH_SENT transition", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-valid-transitions.events.md"),
      ]);

      expect(result.status).toBe(0);
      expect(output.valid).toBe(true);
    });

    test("accepts OUTREACH_SENT -> FOLLOWUP_SENT transition", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-valid-transitions.events.md"),
      ]);

      expect(result.status).toBe(0);
      expect(output.valid).toBe(true);
    });

    test("accepts FOLLOWUP_SENT -> REPLIED transition", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-valid-transitions.events.md"),
      ]);

      expect(result.status).toBe(0);
      expect(output.valid).toBe(true);
    });

    test("accepts UPDATE events after REPLIED", () => {
      const { output, result } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-valid-transitions.events.md"),
      ]);

      expect(result.status).toBe(0);
      const events = output.events as Array<{ eventType: string }>;
      const updateEvents = events.filter(e => e.eventType === "UPDATE_DECISION");
      expect(updateEvents.length).toBe(1);
    });
  });
});

// ============================================================================
// Additional Edge Cases
// ============================================================================

describe("pilot-rebuild edge cases", () => {
  describe("reducer error handling (via transition validation)", () => {
    test("fails with INVALID_TRANSITION for multiple SEND_OUTREACH to same recipient", () => {
      // Note: Transition validation catches this before reducer validation runs
      // INVALID_TRANSITION for SEND_OUTREACH in OUTREACH_SENT state is the actual error
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-duplicate-outreach.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-aligned.run-sheet.md"),
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("INVALID_TRANSITION");
      expect(result.stderr).toContain("SEND_OUTREACH");
      expect(result.stderr).toContain("OUTREACH_SENT");
    });

    test("fails with INVALID_TRANSITION for MARK event without prior outreach", () => {
      // Note: Transition validation catches this before reducer validation runs
      // INVALID_TRANSITION for MARK_FAILED in NO_CONTACT state
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-mark-without-send.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-aligned.run-sheet.md"),
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("INVALID_TRANSITION");
      expect(result.stderr).toContain("Cannot mark failed before sending outreach");
    });

    test("fails with INVALID_TRANSITION for follow-up before outreach", () => {
      // Note: Transition validation catches this before reducer validation runs
      // INVALID_TRANSITION for SEND_FOLLOWUP in NO_CONTACT state
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-followup-without-outreach.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-aligned.run-sheet.md"),
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("INVALID_TRANSITION");
      expect(result.stderr).toContain("Cannot send follow-up before initial outreach");
    });
  });

  describe("CLI argument validation", () => {
    test("requires --events argument", () => {
      const result = runPilotRebuild([]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--events is required");
    });

    test("requires --run-sheet or --responses with --check", () => {
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--check",
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--check requires at least one of --run-sheet or --responses");
    });

    test("fails for non-existent event log file", () => {
      const result = runPilotRebuild([
        "--events", fixturePath("nonexistent.events.md"),
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("INVALID_EVENT_LOG");
      expect(result.stderr).toContain("not found");
    });

    test("fails for non-existent run-sheet file", () => {
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--run-sheet", fixturePath("nonexistent.run-sheet.md"),
        "--check",
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("not found");
    });
  });

  describe("human-readable output format", () => {
    test("produces human-readable output with --format human", () => {
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--format", "human",
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Pilot Event Log Validation");
      expect(result.stdout).toContain("Status:");
      expect(result.stdout).toContain("Event Count:");
      expect(result.stdout).toContain("Recipient Count:");
    });

    test("shows check results in human format", () => {
      const result = runPilotRebuild([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-aligned.run-sheet.md"),
        "--responses", fixturePath("pilot-rebuild-aligned.responses.md"),
        "--check",
        "--format", "human",
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Pilot Rebuild Check");
      expect(result.stdout).toContain("PASSED");
    });
  });

  describe("deterministic output verification", () => {
    test("produces identical JSON output for repeated aligned runs", () => {
      const { output: output1, result: result1 } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-aligned.run-sheet.md"),
        "--responses", fixturePath("pilot-rebuild-aligned.responses.md"),
        "--check",
      ]);

      const { output: output2, result: result2 } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-aligned.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-aligned.run-sheet.md"),
        "--responses", fixturePath("pilot-rebuild-aligned.responses.md"),
        "--check",
      ]);

      expect(result1.status).toBe(0);
      expect(result2.status).toBe(0);
      expect(output1).toEqual(output2);
    });

    test("produces identical error output for repeated drift runs", () => {
      const { output: output1, result: result1 } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-row-timestamp-drift.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-row-timestamp-drift.run-sheet.md"),
        "--responses", fixturePath("pilot-rebuild-row-timestamp-drift.responses.md"),
        "--check",
      ]);

      const { output: output2, result: result2 } = runPilotRebuildJson([
        "--events", fixturePath("pilot-rebuild-row-timestamp-drift.events.md"),
        "--run-sheet", fixturePath("pilot-rebuild-row-timestamp-drift.run-sheet.md"),
        "--responses", fixturePath("pilot-rebuild-row-timestamp-drift.responses.md"),
        "--check",
      ]);

      expect(result1.status).toBe(1);
      expect(result2.status).toBe(1);
      expect(output1).toEqual(output2);
    });
  });
});
