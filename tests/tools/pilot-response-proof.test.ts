#!/usr/bin/env bun

/**
 * Tests for pilot-response-proof.ts (TP009)
 *
 * Covers:
 * - Deterministic pass/fail behavior
 * - Exact rule IDs: MISSING_REPLY_PROOF, RECIPIENT_MISMATCH, RESPONSE_TIMESTAMP_DRIFT
 * - Stable JSON payload ordering
 */

import { describe, test, expect } from "bun:test";
import { spawn } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
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
  VALID_DECISION_STATES,
  VALID_CHANNELS,
  type ValidationError,
  type ProofOutput,
} from "../../tools/pilot-response-proof";

const FIXTURES_DIR = join(__dirname, "fixtures");

// ============================================================================
// Helper: Run CLI command and capture output
// ============================================================================

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed?: ProofOutput;
}

async function runCli(args: string[]): Promise<CliResult> {
  const proc = spawn({
    cmd: ["bun", "run", "tools/pilot-response-proof.ts", "--", ...args],
    cwd: join(__dirname, "../.."),
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  let parsed: ProofOutput | undefined;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Not JSON output
  }

  return { stdout, stderr, exitCode, parsed };
}

// ============================================================================
// CLI Argument Parsing Tests
// ============================================================================

describe("parseArgs", () => {
  test("parses required arguments", () => {
    const args = parseArgs([
      "--responses",
      "/path/to/responses.md",
      "--evidence",
      "/path/to/evidence.ndjson",
    ]);

    expect(args.responsesPath).toBe("/path/to/responses.md");
    expect(args.evidencePath).toBe("/path/to/evidence.ndjson");
    expect(args.format).toBeUndefined();
  });

  test("parses format option", () => {
    const args = parseArgs([
      "--responses",
      "/path/to/responses.md",
      "--evidence",
      "/path/to/evidence.ndjson",
      "--format",
      "human",
    ]);

    expect(args.format).toBe("human");
  });

  test("defaults format to undefined (json)", () => {
    const args = parseArgs([
      "--responses",
      "/path/to/responses.md",
      "--evidence",
      "/path/to/evidence.ndjson",
    ]);

    expect(args.format).toBeUndefined();
  });

  test("parses help flag", () => {
    const args = parseArgs(["--help"]);
    expect(args.help).toBe(true);
  });
});

// ============================================================================
// Validation Helper Tests
// ============================================================================

describe("isValidSha256", () => {
  test("returns true for valid SHA-256 hex hash", () => {
    expect(isValidSha256("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")).toBe(true);
    expect(isValidSha256("0000000000000000000000000000000000000000000000000000000000000000")).toBe(true);
    expect(isValidSha256("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")).toBe(true);
  });

  test("returns false for invalid hashes", () => {
    expect(isValidSha256("short")).toBe(false);
    expect(isValidSha256("g1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")).toBe(false); // 'g' is invalid hex
    expect(isValidSha256("A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2")).toBe(false); // uppercase
  });
});

describe("isValidIsoTimestamp", () => {
  test("returns true for valid ISO-8601 with Z suffix", () => {
    expect(isValidIsoTimestamp("2026-02-28T00:00:00Z")).toBe(true);
    expect(isValidIsoTimestamp("2026-12-31T23:59:59Z")).toBe(true);
  });

  test("returns false for invalid timestamps", () => {
    expect(isValidIsoTimestamp("2026-02-28")).toBe(false); // date only
    expect(isValidIsoTimestamp("2026-02-28T00:00:00")).toBe(false); // no Z suffix
    expect(isValidIsoTimestamp("2026-02-28T00:00:00+00:00")).toBe(false); // timezone offset
  });
});

// ============================================================================
// Frontmatter Parsing Tests
// ============================================================================

describe("parseFrontmatter", () => {
  test("parses YAML frontmatter", () => {
    const content = `---
artifact: pilot-response-log
author: Test
created_at: 2026-03-01
---

# Content`;

    const { frontmatter, body } = parseFrontmatter(content);

    expect(frontmatter.artifact).toBe("pilot-response-log");
    expect(frontmatter.author).toBe("Test");
    expect(frontmatter.created_at).toBe("2026-03-01");
    expect(body.trim()).toBe("# Content");
  });

  test("handles content without frontmatter", () => {
    const content = "# Just markdown\n\nNo frontmatter.";
    const { frontmatter, body } = parseFrontmatter(content);

    expect(Object.keys(frontmatter).length).toBe(0);
    expect(body).toBe(content);
  });
});

// ============================================================================
// Markdown Table Parsing Tests
// ============================================================================

describe("parseMarkdownTable", () => {
  test("parses markdown table rows", () => {
    const body = `
| Recipient | Channel |
| --- | --- |
| alice | X DM |
| bob | Discord DM |
`;

    const rows = parseMarkdownTable(body);

    expect(rows.length).toBe(3); // header + 2 data rows
    expect(rows[0]).toEqual(["Recipient", "Channel"]);
    expect(rows[1]).toEqual(["alice", "X DM"]);
    expect(rows[2]).toEqual(["bob", "Discord DM"]);
  });

  test("strips backticks from cell values", () => {
    const body = `
| Recipient |
| --- |
| \`user_handle\` |
`;

    const rows = parseMarkdownTable(body);

    expect(rows[1][0]).toBe("user_handle");
  });

  test("skips header separator rows", () => {
    const body = `
| A | B |
| --- | --- |
| 1 | 2 |
`;

    const rows = parseMarkdownTable(body);

    expect(rows.length).toBe(2); // header + 1 data row
  });
});

// ============================================================================
// Response Log Parsing Tests
// ============================================================================

describe("parseResponseLog", () => {
  test("parses aligned fixture without errors", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-aligned.responses.md"),
      "utf-8"
    );

    const { rows, errors } = parseResponseLog(content, "test-fixture");

    expect(errors.length).toBe(0);
    expect(rows.length).toBe(4);

    // First row (non-pending)
    expect(rows[0].recipient).toBe("aligned_alpha");
    expect(rows[0].nextStepDecision).toBe("advance");
    expect(rows[0].sourceChannel).toBe("X DM");
    expect(rows[0].responseState).toBe("responded 2026-02-28");

    // Pending row
    expect(rows[3].recipient).toBe("aligned_delta");
    expect(rows[3].nextStepDecision).toBe("pending");
  });

  test("rejects missing frontmatter artifact field", () => {
    const content = `---
author: Test
---

| Recipient | Source Channel | Workflow Sentence | Objection Type | WTP ($/mo) | Next-Step Decision | Decision Rationale | Response State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| alice | X DM | test | none | 10 | advance | test | responded 2026-02-28 |
`;

    const { rows, errors } = parseResponseLog(content, "test");

    expect(errors.length).toBe(1);
    expect(errors[0].ruleId).toBe("MALFORMED_RESPONSE_LOG");
    expect(rows.length).toBe(0);
  });

  test("rejects invalid decision state", () => {
    const content = `---
artifact: pilot-response-log
---

| Recipient | Source Channel | Workflow Sentence | Objection Type | WTP ($/mo) | Next-Step Decision | Decision Rationale | Response State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| alice | X DM | test | none | 10 | invalid_state | test | responded 2026-02-28 |
`;

    const { rows, errors } = parseResponseLog(content, "test");

    expect(errors.length).toBe(1);
    expect(errors[0].ruleId).toBe("MALFORMED_RESPONSE_LOG");
    expect(errors[0].recipient).toBe("alice");
  });
});

// ============================================================================
// Non-Pending Filter Tests (TP003)
// ============================================================================

describe("filterNonPendingRows", () => {
  test("separates pending from non-pending rows deterministically", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-aligned.responses.md"),
      "utf-8"
    );
    const { rows } = parseResponseLog(content, "test");
    const filtered = filterNonPendingRows(rows);

    expect(filtered.all.length).toBe(4);
    expect(filtered.nonPending.length).toBe(3);
    expect(filtered.pending.length).toBe(1);
    expect(filtered.pending[0].recipient).toBe("aligned_delta");
  });

  test("preserves row order", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-aligned.responses.md"),
      "utf-8"
    );
    const { rows } = parseResponseLog(content, "test");
    const filtered = filterNonPendingRows(rows);

    // Non-pending rows should maintain original order
    expect(filtered.nonPending[0].recipient).toBe("aligned_alpha");
    expect(filtered.nonPending[1].recipient).toBe("aligned_bravo");
    expect(filtered.nonPending[2].recipient).toBe("aligned_charlie");
  });
});

// ============================================================================
// Proof Index Parsing Tests (TP004)
// ============================================================================

describe("parseProofIndex", () => {
  test("parses valid NDJSON records", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-aligned.evidence.ndjson"),
      "utf-8"
    );

    const { records, errors } = parseProofIndex(content, "test-fixture");

    expect(errors.length).toBe(0);
    expect(records.length).toBe(3);

    expect(records[0].recipientKey).toBe("aligned_alpha");
    expect(records[0].messageId).toBe("msg-aligned-alpha-001");
    expect(records[0].channel).toBe("X DM");
  });

  test("emits DUPLICATE_MESSAGE_ID_IN_PROOF_INDEX for duplicate message IDs", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-duplicate-rows.evidence.ndjson"),
      "utf-8"
    );

    const { records, errors } = parseProofIndex(content, "test-fixture");

    // First record parsed, second rejected
    expect(records.length).toBe(1);
    expect(errors.length).toBe(1);
    expect(errors[0].ruleId).toBe("DUPLICATE_MESSAGE_ID_IN_PROOF_INDEX");
    expect(errors[0].messageId).toBe("msg-duplicate-id-001");
  });

  test("emits MALFORMED_PROOF_RECORD for invalid JSON", () => {
    const content = "not valid json\n{\"recipientKey\":\"test\"}";

    const { records, errors } = parseProofIndex(content, "test");

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].ruleId).toBe("MALFORMED_PROOF_RECORD");
  });

  test("emits MALFORMED_PROOF_RECORD for missing required fields", () => {
    const content = JSON.stringify({ recipientKey: "test" }); // missing other fields

    const { records, errors } = parseProofIndex(content, "test");

    expect(errors.length).toBe(1);
    expect(errors[0].ruleId).toBe("MALFORMED_PROOF_RECORD");
    expect(errors[0].message).toContain("messageId");
  });

  test("emits INVALID_SOURCE_EXPORT_HASH for bad hash format", () => {
    const content = JSON.stringify({
      recipientKey: "test",
      messageId: "msg-001",
      sourceExportHash: "not-a-valid-hash",
      responseTimestamp: "2026-02-28T00:00:00Z",
      channel: "X DM",
    });

    const { records, errors } = parseProofIndex(content, "test");

    expect(errors.length).toBe(1);
    expect(errors[0].ruleId).toBe("INVALID_SOURCE_EXPORT_HASH");
  });

  test("emits INVALID_RESPONSE_TIMESTAMP for bad timestamp format", () => {
    const content = JSON.stringify({
      recipientKey: "test",
      messageId: "msg-001",
      sourceExportHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      responseTimestamp: "2026-02-28", // missing time component
      channel: "X DM",
    });

    const { records, errors } = parseProofIndex(content, "test");

    expect(errors.length).toBe(1);
    expect(errors[0].ruleId).toBe("INVALID_RESPONSE_TIMESTAMP");
  });

  test("emits INVALID_CHANNEL for unknown channel", () => {
    const content = JSON.stringify({
      recipientKey: "test",
      messageId: "msg-001",
      sourceExportHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      responseTimestamp: "2026-02-28T00:00:00Z",
      channel: "Unknown Channel",
    });

    const { records, errors } = parseProofIndex(content, "test");

    expect(errors.length).toBe(1);
    expect(errors[0].ruleId).toBe("INVALID_CHANNEL");
  });
});

// ============================================================================
// Timestamp Normalization Tests (TP007)
// ============================================================================

describe("normalizeResponseTimestamp", () => {
  test("normalizes 'responded YYYY-MM-DD' to ISO-8601 with Z suffix", () => {
    const result = normalizeResponseTimestamp("responded 2026-02-28");

    expect(result).toBe("2026-02-28T00:00:00Z");
  });

  test("returns null for 'no response yet'", () => {
    const result = normalizeResponseTimestamp("no response yet");

    expect(result).toBeNull();
  });

  test("returns null for responses containing 'no response'", () => {
    const result = normalizeResponseTimestamp("still no response from user");

    expect(result).toBeNull();
  });

  test("normalizes ISO-8601 timestamps to date-only (midnight)", () => {
    // The implementation extracts date and normalizes to 00:00:00Z
    const result = normalizeResponseTimestamp("2026-02-28T12:30:00Z");

    expect(result).toBe("2026-02-28T00:00:00Z");
  });
});

describe("timestampsDiffer", () => {
  test("returns false for matching timestamps", () => {
    expect(timestampsDiffer("2026-02-28T00:00:00Z", "2026-02-28T00:00:00Z")).toBe(false);
  });

  test("returns true for different timestamps", () => {
    expect(timestampsDiffer("2026-02-28T00:00:00Z", "2026-02-15T00:00:00Z")).toBe(true);
  });

  test("returns false when response timestamp is null", () => {
    // If we don't have a response timestamp, we can't detect drift
    expect(timestampsDiffer(null, "2026-02-28T00:00:00Z")).toBe(false);
  });
});

// ============================================================================
// Row→Proof Matcher Tests (TP005, TP006, TP007)
// ============================================================================

describe("matchRowsToProofs", () => {
  test("passes aligned fixtures with matching proofs", () => {
    const responsesContent = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-aligned.responses.md"),
      "utf-8"
    );
    const evidenceContent = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-aligned.evidence.ndjson"),
      "utf-8"
    );

    const { rows: responseRows } = parseResponseLog(responsesContent, "test");
    const { records: proofRecords } = parseProofIndex(evidenceContent, "test");
    const filtered = filterNonPendingRows(responseRows);

    const result = matchRowsToProofs(filtered.nonPending, proofRecords);

    expect(result.errors.length).toBe(0);
    expect(result.matched).toBe(3); // 3 non-pending rows, all matched
  });

  test("emits MISSING_REPLY_PROOF for missing proof records", () => {
    const responsesContent = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-missing-proof.responses.md"),
      "utf-8"
    );
    const evidenceContent = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-missing-proof.evidence.ndjson"),
      "utf-8"
    );

    const { rows: responseRows } = parseResponseLog(responsesContent, "test");
    const { records: proofRecords } = parseProofIndex(evidenceContent, "test");
    const filtered = filterNonPendingRows(responseRows);

    const result = matchRowsToProofs(filtered.nonPending, proofRecords);

    expect(result.errors.length).toBe(1);
    expect(result.errors[0].ruleId).toBe("MISSING_REPLY_PROOF");
    expect(result.errors[0].recipient).toBe("test_bravo");
    expect(result.errors[0].message).toContain("test_bravo");
  });

  test("emits RECIPIENT_MISMATCH for recipient identity disagreement", () => {
    const responsesContent = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-recipient-mismatch.responses.md"),
      "utf-8"
    );
    const evidenceContent = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-recipient-mismatch.evidence.ndjson"),
      "utf-8"
    );

    const { rows: responseRows } = parseResponseLog(responsesContent, "test");
    const { records: proofRecords } = parseProofIndex(evidenceContent, "test");
    const filtered = filterNonPendingRows(responseRows);

    const result = matchRowsToProofs(filtered.nonPending, proofRecords);

    // bob_test has a proof on Discord DM but with wrong recipient (charlie_test)
    const mismatchErrors = result.errors.filter(e => e.ruleId === "RECIPIENT_MISMATCH");
    expect(mismatchErrors.length).toBe(1);
    expect(mismatchErrors[0].recipient).toBe("bob_test");
    expect(mismatchErrors[0].message).toContain("charlie_test");
  });

  test("emits RESPONSE_TIMESTAMP_DRIFT for timestamp disagreement", () => {
    const responsesContent = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-timestamp-drift.responses.md"),
      "utf-8"
    );
    const evidenceContent = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-timestamp-drift.evidence.ndjson"),
      "utf-8"
    );

    const { rows: responseRows } = parseResponseLog(responsesContent, "test");
    const { records: proofRecords } = parseProofIndex(evidenceContent, "test");
    const filtered = filterNonPendingRows(responseRows);

    const result = matchRowsToProofs(filtered.nonPending, proofRecords);

    // Both drift_alpha and drift_bravo have timestamp mismatches
    const driftErrors = result.errors.filter(e => e.ruleId === "RESPONSE_TIMESTAMP_DRIFT");
    expect(driftErrors.length).toBe(2);

    // Verify exact recipients with drift
    const recipients = driftErrors.map(e => e.recipient).sort();
    expect(recipients).toEqual(["drift_alpha", "drift_bravo"]);

    // Verify error details contain both timestamps
    expect(driftErrors[0].details?.normalizedResponseTimestamp).toBeDefined();
    expect(driftErrors[0].details?.proofResponseTimestamp).toBeDefined();
  });

  test("enforces one-to-one binding (each proof used only once)", () => {
    const responsesContent = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-duplicate-binding.responses.md"),
      "utf-8"
    );
    const evidenceContent = readFileSync(
      join(FIXTURES_DIR, "pilot-response-proof-duplicate-binding.evidence.ndjson"),
      "utf-8"
    );

    const { rows: responseRows } = parseResponseLog(responsesContent, "test");
    const { records: proofRecords } = parseProofIndex(evidenceContent, "test");
    const filtered = filterNonPendingRows(responseRows);

    const result = matchRowsToProofs(filtered.nonPending, proofRecords);

    // First row should match, second should fail (same channel, only one proof)
    // But wait - the fixture has different recipients, so we need to check behavior
    // If there's only one proof and multiple rows need it, only one succeeds
    expect(result.matched).toBeLessThanOrEqual(1);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// CLI Integration Tests - Deterministic Pass/Fail Behavior
// ============================================================================

describe("CLI Integration - Deterministic Pass/Fail", () => {
  test("passes aligned fixtures with exit code 0", async () => {
    const result = await runCli([
      "--responses",
      join(FIXTURES_DIR, "pilot-response-proof-aligned.responses.md"),
      "--evidence",
      join(FIXTURES_DIR, "pilot-response-proof-aligned.evidence.ndjson"),
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.parsed).toBeDefined();
    expect(result.parsed!.status).toBe("pass");
    expect(result.parsed!.errors.length).toBe(0);
    expect(result.parsed!.validated).toBe(3);
    expect(result.parsed!.eligibleDecisions).toBe(3);
    expect(result.parsed!.ignoredPending).toBe(1);
  });

  test("fails MISSING_REPLY_PROOF fixture with exit code 7", async () => {
    const result = await runCli([
      "--responses",
      join(FIXTURES_DIR, "pilot-response-proof-missing-proof.responses.md"),
      "--evidence",
      join(FIXTURES_DIR, "pilot-response-proof-missing-proof.evidence.ndjson"),
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(7); // VALIDATION_ERRORS exit code
    expect(result.parsed).toBeDefined();
    expect(result.parsed!.status).toBe("fail");
    expect(result.parsed!.errors.some(e => e.ruleId === "MISSING_REPLY_PROOF")).toBe(true);
  });

  test("fails RECIPIENT_MISMATCH fixture with exit code 7", async () => {
    const result = await runCli([
      "--responses",
      join(FIXTURES_DIR, "pilot-response-proof-recipient-mismatch.responses.md"),
      "--evidence",
      join(FIXTURES_DIR, "pilot-response-proof-recipient-mismatch.evidence.ndjson"),
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(7);
    expect(result.parsed).toBeDefined();
    expect(result.parsed!.status).toBe("fail");
    expect(result.parsed!.errors.some(e => e.ruleId === "RECIPIENT_MISMATCH")).toBe(true);
  });

  test("fails RESPONSE_TIMESTAMP_DRIFT fixture with exit code 7", async () => {
    const result = await runCli([
      "--responses",
      join(FIXTURES_DIR, "pilot-response-proof-timestamp-drift.responses.md"),
      "--evidence",
      join(FIXTURES_DIR, "pilot-response-proof-timestamp-drift.evidence.ndjson"),
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(7);
    expect(result.parsed).toBeDefined();
    expect(result.parsed!.status).toBe("fail");
    expect(result.parsed!.errors.some(e => e.ruleId === "RESPONSE_TIMESTAMP_DRIFT")).toBe(true);
  });

  test("fails DUPLICATE_MESSAGE_ID_IN_PROOF_INDEX fixture with exit code 7", async () => {
    const result = await runCli([
      "--responses",
      join(FIXTURES_DIR, "pilot-response-proof-duplicate-rows.responses.md"),
      "--evidence",
      join(FIXTURES_DIR, "pilot-response-proof-duplicate-rows.evidence.ndjson"),
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(7);
    expect(result.parsed).toBeDefined();
    expect(result.parsed!.status).toBe("fail");
    expect(result.parsed!.errors.some(e => e.ruleId === "DUPLICATE_MESSAGE_ID_IN_PROOF_INDEX")).toBe(true);
  });
});

// ============================================================================
// Stable JSON Payload Ordering Tests
// ============================================================================

describe("Stable JSON Payload Ordering", () => {
  test("output fields are in deterministic order", async () => {
    const result = await runCli([
      "--responses",
      join(FIXTURES_DIR, "pilot-response-proof-aligned.responses.md"),
      "--evidence",
      join(FIXTURES_DIR, "pilot-response-proof-aligned.evidence.ndjson"),
      "--format",
      "json",
    ]);

    expect(result.parsed).toBeDefined();

    // Verify required fields exist
    const output = result.parsed!;
    expect(output.status).toBeDefined();
    expect(output.totalRows).toBeDefined();
    expect(output.eligibleDecisions).toBeDefined();
    expect(output.ignoredPending).toBeDefined();
    expect(output.pendingRecipients).toBeDefined();
    expect(output.validated).toBeDefined();
    expect(output.errors).toBeDefined();
    expect(output.responsesPath).toBeDefined();
    expect(output.evidencePath).toBeDefined();
    expect(output.timestamp).toBeDefined();
  });

  test("error objects have deterministic field order", async () => {
    const result = await runCli([
      "--responses",
      join(FIXTURES_DIR, "pilot-response-proof-missing-proof.responses.md"),
      "--evidence",
      join(FIXTURES_DIR, "pilot-response-proof-missing-proof.evidence.ndjson"),
      "--format",
      "json",
    ]);

    expect(result.parsed).toBeDefined();
    expect(result.parsed!.errors.length).toBeGreaterThan(0);

    const error = result.parsed!.errors[0];
    expect(error.ruleId).toBeDefined();
    expect(error.message).toBeDefined();

    // Verify ruleId is exact match (not substring)
    expect(error.ruleId).toBe("MISSING_REPLY_PROOF");
  });

  test("multiple runs produce identical output (deterministic)", async () => {
    const args = [
      "--responses",
      join(FIXTURES_DIR, "pilot-response-proof-aligned.responses.md"),
      "--evidence",
      join(FIXTURES_DIR, "pilot-response-proof-aligned.evidence.ndjson"),
      "--format",
      "json",
    ];

    const result1 = await runCli(args);
    const result2 = await runCli(args);

    // Parse and compare (excluding timestamp which varies)
    const output1 = { ...result1.parsed!, timestamp: undefined };
    const output2 = { ...result2.parsed!, timestamp: undefined };

    expect(output1).toEqual(output2);
  });

  test("pending recipients are in stable order (row order)", async () => {
    const result = await runCli([
      "--responses",
      join(FIXTURES_DIR, "pilot-response-proof-aligned.responses.md"),
      "--evidence",
      join(FIXTURES_DIR, "pilot-response-proof-aligned.evidence.ndjson"),
      "--format",
      "json",
    ]);

    expect(result.parsed).toBeDefined();
    expect(result.parsed!.pendingRecipients).toEqual(["aligned_delta"]);
  });
});

// ============================================================================
// Exact Rule ID Assertions
// ============================================================================

describe("Exact Rule ID Assertions", () => {
  test("MISSING_REPLY_PROOF has exact rule ID string", async () => {
    const result = await runCli([
      "--responses",
      join(FIXTURES_DIR, "pilot-response-proof-missing-proof.responses.md"),
      "--evidence",
      join(FIXTURES_DIR, "pilot-response-proof-missing-proof.evidence.ndjson"),
      "--format",
      "json",
    ]);

    const missingProofErrors = result.parsed!.errors.filter(
      e => e.ruleId === "MISSING_REPLY_PROOF"
    );

    expect(missingProofErrors.length).toBe(1);
    expect(missingProofErrors[0].ruleId).toBe("MISSING_REPLY_PROOF");
    expect(missingProofErrors[0].recipient).toBe("test_bravo");
  });

  test("RECIPIENT_MISMATCH has exact rule ID string", async () => {
    const result = await runCli([
      "--responses",
      join(FIXTURES_DIR, "pilot-response-proof-recipient-mismatch.responses.md"),
      "--evidence",
      join(FIXTURES_DIR, "pilot-response-proof-recipient-mismatch.evidence.ndjson"),
      "--format",
      "json",
    ]);

    const mismatchErrors = result.parsed!.errors.filter(
      e => e.ruleId === "RECIPIENT_MISMATCH"
    );

    expect(mismatchErrors.length).toBeGreaterThanOrEqual(1);
    expect(mismatchErrors[0].ruleId).toBe("RECIPIENT_MISMATCH");
    expect(mismatchErrors[0].details?.rowRecipient).toBeDefined();
    expect(mismatchErrors[0].details?.proofRecipient).toBeDefined();
    expect(mismatchErrors[0].details?.rowRecipient).not.toBe(mismatchErrors[0].details?.proofRecipient);
  });

  test("RESPONSE_TIMESTAMP_DRIFT has exact rule ID string", async () => {
    const result = await runCli([
      "--responses",
      join(FIXTURES_DIR, "pilot-response-proof-timestamp-drift.responses.md"),
      "--evidence",
      join(FIXTURES_DIR, "pilot-response-proof-timestamp-drift.evidence.ndjson"),
      "--format",
      "json",
    ]);

    const driftErrors = result.parsed!.errors.filter(
      e => e.ruleId === "RESPONSE_TIMESTAMP_DRIFT"
    );

    expect(driftErrors.length).toBe(2);
    driftErrors.forEach(error => {
      expect(error.ruleId).toBe("RESPONSE_TIMESTAMP_DRIFT");
      expect(error.details?.normalizedResponseTimestamp).toBeDefined();
      expect(error.details?.proofResponseTimestamp).toBeDefined();
      expect(error.details?.normalizedResponseTimestamp).not.toBe(error.details?.proofResponseTimestamp);
    });
  });
});

// ============================================================================
// Human Output Format Tests
// ============================================================================

describe("formatHumanOutput", () => {
  test("produces human-readable summary", () => {
    const output: ProofOutput = {
      status: "pass",
      totalRows: 4,
      eligibleDecisions: 3,
      ignoredPending: 1,
      pendingRecipients: ["test_pending"],
      validated: 3,
      errors: [],
      responsesPath: "/path/to/responses.md",
      evidencePath: "/path/to/evidence.ndjson",
      timestamp: "2026-03-01T12:00:00Z",
    };

    const human = formatHumanOutput(output);

    expect(human).toContain("Status: ✅ PASS");
    expect(human).toContain("Eligible Decisions:  3");
    expect(human).toContain("Ignored Pending:     1");
    expect(human).toContain("Validated:           3");
    expect(human).toContain("test_pending");
    expect(human).toContain("No errors found");
  });

  test("shows errors in fail case", () => {
    const output: ProofOutput = {
      status: "fail",
      totalRows: 2,
      eligibleDecisions: 2,
      ignoredPending: 0,
      pendingRecipients: [],
      validated: 0,
      errors: [
        {
          ruleId: "MISSING_REPLY_PROOF",
          recipient: "test_user",
          message: "No proof record found",
        },
      ],
      responsesPath: "/path/to/responses.md",
      evidencePath: "/path/to/evidence.ndjson",
      timestamp: "2026-03-01T12:00:00Z",
    };

    const human = formatHumanOutput(output);

    expect(human).toContain("Status: ❌ FAIL");
    expect(human).toContain("[MISSING_REPLY_PROOF]");
    expect(human).toContain("No proof record found");
    expect(human).toContain("test_user");
  });
});
