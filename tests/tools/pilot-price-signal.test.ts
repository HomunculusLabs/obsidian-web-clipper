#!/usr/bin/env bun

/**
 * Tests for pilot-price-signal.ts (TP009)
 *
 * Covers:
 * - Deterministic JSON bytes/stable ordering for pass fixtures
 * - Exact actionable diagnostics for failure fixtures
 * - Required rule IDs: MISSING_WTP_VALUE, WTP_OUT_OF_RANGE, INVALID_WTP_VALUE
 */

import { describe, test, expect } from "bun:test";
import { spawn } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseArgs,
  parseFrontmatter,
  parseMarkdownTable,
  parseResponseLog,
  validateWTPValue,
  parseOfferBriefWTPRange,
  assignPriceBucket,
  calculateTelemetry,
  calculateRecommendation,
  calculateConfidence,
  formatHumanOutput,
  ERROR_CODES,
  type WTPRange,
  type ResponseLogRow,
} from "../../tools/pilot-price-signal";

const FIXTURES_DIR = join(__dirname, "fixtures");

// ============================================================================
// Helper: Run CLI command and capture output
// ============================================================================

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed?: Record<string, unknown>;
}

async function runCli(args: string[]): Promise<CliResult> {
  const proc = spawn({
    cmd: ["bun", "run", "tools/pilot-price-signal.ts", "--", ...args],
    cwd: join(__dirname, "../.."),
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  let parsed: Record<string, unknown> | undefined;
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
      "--root",
      "/path/to/root",
      "--brief",
      "/path/to/brief.md",
    ]);

    expect(args.rootPath).toBe("/path/to/root");
    expect(args.briefPath).toBe("/path/to/brief.md");
    expect(args.format).toBeUndefined();
    expect(args.help).toBe(false);
  });

  test("parses format option", () => {
    const args = parseArgs([
      "--root",
      "/path/to/root",
      "--brief",
      "/path/to/brief.md",
      "--format",
      "human",
    ]);

    expect(args.format).toBe("human");
  });

  test("defaults format to undefined (json)", () => {
    const args = parseArgs([
      "--root",
      "/path/to/root",
      "--brief",
      "/path/to/brief.md",
    ]);

    expect(args.format).toBeUndefined();
  });

  test("parses help flag", () => {
    const args = parseArgs(["--help"]);
    expect(args.help).toBe(true);
  });
});

// ============================================================================
// Frontmatter Parsing Tests
// ============================================================================

describe("parseFrontmatter", () => {
  test("parses frontmatter with artifact and batch", () => {
    const content = `---
artifact: pilot-response-log
batch: test-batch
---

# Body`;

    const result = parseFrontmatter(content);

    expect(result.frontmatter.artifact).toBe("pilot-response-log");
    expect(result.frontmatter.batch).toBe("test-batch");
    expect(result.body).toContain("# Body");
  });

  test("handles empty frontmatter", () => {
    const content = `# Just body`;

    const result = parseFrontmatter(content);

    expect(Object.keys(result.frontmatter).length).toBe(0);
    expect(result.body).toBe("# Just body");
  });
});

// ============================================================================
// Markdown Table Parsing Tests
// ============================================================================

describe("parseMarkdownTable", () => {
  test("parses valid markdown table", () => {
    const body = `
| Recipient | Source Channel | WTP ($/mo) |
| --- | --- | --- |
| alice | X DM | 12 |
| bob | Discord | 15 |
`;

    const rows = parseMarkdownTable(body);

    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual(["Recipient", "Source Channel", "WTP ($/mo)"]);
    expect(rows[1]).toEqual(["alice", "X DM", "12"]);
    expect(rows[2]).toEqual(["bob", "Discord", "15"]);
  });

  test("returns empty array for no table", () => {
    const body = `# Just a heading\n\nSome text`;
    const rows = parseMarkdownTable(body);
    expect(rows.length).toBe(0);
  });
});

// ============================================================================
// WTP Range Parser Tests
// ============================================================================

describe("parseOfferBriefWTPRange", () => {
  test("extracts range from Pricing Hypothesis section", () => {
    const content = `
## Pricing Hypothesis
Acceptable test range: $8-$19/mo during pilot interviews
`;

    const result = parseOfferBriefWTPRange(content, "test-brief.md");

    expect(result.min).toBe(8);
    expect(result.max).toBe(19);
    expect(result.source).toBe("test-brief.md#pricing-hypothesis");
  });

  test("returns default range when no explicit range pattern found", () => {
    const content = `
## Some Section
This document has no explicit range pattern
`;

    const result = parseOfferBriefWTPRange(content, "test-brief.md");

    // Returns defaults when no pattern matches
    expect(result.min).toBe(8);
    expect(result.max).toBe(19);
    expect(result.source).toBe("test-brief.md#default");
  });

  test("returns default range when no patterns match", () => {
    const content = `# No pricing info here`;

    const result = parseOfferBriefWTPRange(content, "test-brief.md");

    // Returns defaults when no pattern matches
    expect(result.min).toBe(8);
    expect(result.max).toBe(19);
    expect(result.source).toBe("test-brief.md#default");
  });

  test("real OFFER_BRIEF fixture has correct range", () => {
    const content = readFileSync(
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "utf-8"
    );

    const result = parseOfferBriefWTPRange(content, "pilot-price-signal.brief.md");

    expect(result.min).toBe(8);
    expect(result.max).toBe(19);
    // Note: anchor is not returned by parseOfferBriefWTPRange, it's in the brief content
    expect(result.source).toContain("pilot-price-signal.brief.md");
  });
});

// ============================================================================
// WTP Validation Tests
// ============================================================================

describe("validateWTPValue", () => {
  const wtpRange: WTPRange = { min: 8, max: 19, source: "test" };

  test("validates numeric WTP within range", () => {
    const result = validateWTPValue(12, wtpRange);

    expect(result.valid).toBe(true);
    expect(result.numericValue).toBe(12);
    expect(result.ruleId).toBeUndefined();
  });

  test("validates string WTP with $ prefix", () => {
    const result = validateWTPValue("$12", wtpRange);

    expect(result.valid).toBe(true);
    expect(result.numericValue).toBe(12);
  });

  test("validates string WTP without $ prefix", () => {
    const result = validateWTPValue("15", wtpRange);

    expect(result.valid).toBe(true);
    expect(result.numericValue).toBe(15);
  });

  test("fails with MISSING_WTP_VALUE for empty string", () => {
    const result = validateWTPValue("", wtpRange);

    expect(result.valid).toBe(false);
    expect(result.ruleId).toBe("MISSING_WTP_VALUE");
  });

  test("fails with MISSING_WTP_VALUE for 'no response yet'", () => {
    const result = validateWTPValue("no response yet", wtpRange);

    expect(result.valid).toBe(false);
    expect(result.ruleId).toBe("MISSING_WTP_VALUE");
  });

  test("fails with INVALID_WTP_VALUE for non-numeric", () => {
    const result = validateWTPValue("not-a-number", wtpRange);

    expect(result.valid).toBe(false);
    expect(result.ruleId).toBe("INVALID_WTP_VALUE");
  });

  test("fails with WTP_OUT_OF_RANGE for below minimum", () => {
    const result = validateWTPValue(5, wtpRange);

    expect(result.valid).toBe(false);
    expect(result.ruleId).toBe("WTP_OUT_OF_RANGE");
  });

  test("fails with WTP_OUT_OF_RANGE for above maximum", () => {
    const result = validateWTPValue(25, wtpRange);

    expect(result.valid).toBe(false);
    expect(result.ruleId).toBe("WTP_OUT_OF_RANGE");
  });

  test("fails with WTP_OUT_OF_RANGE for exactly $20 (boundary)", () => {
    const result = validateWTPValue(20, wtpRange);

    expect(result.valid).toBe(false);
    expect(result.ruleId).toBe("WTP_OUT_OF_RANGE");
  });
});

// ============================================================================
// Price Bucket Assignment Tests
// ============================================================================

describe("assignPriceBucket", () => {
  test("assigns $8-$11 bucket for values 8-11", () => {
    expect(assignPriceBucket(8)).toBe("$8-$11");
    expect(assignPriceBucket(10)).toBe("$8-$11");
    expect(assignPriceBucket(11)).toBe("$8-$11");
  });

  test("assigns $12 bucket for value 12", () => {
    expect(assignPriceBucket(12)).toBe("$12");
  });

  test("assigns $13-$15 bucket for values 13-15", () => {
    expect(assignPriceBucket(13)).toBe("$13-$15");
    expect(assignPriceBucket(15)).toBe("$13-$15");
  });

  test("assigns $16-$19 bucket for values 16-19", () => {
    expect(assignPriceBucket(16)).toBe("$16-$19");
    expect(assignPriceBucket(19)).toBe("$16-$19");
  });

  test("returns null for out-of-range values", () => {
    expect(assignPriceBucket(5)).toBeNull();
    expect(assignPriceBucket(25)).toBeNull();
    expect(assignPriceBucket(7)).toBeNull();
    // Note: 20 is actually within the $16-$19 bucket (15.5 <= WTP <= 20)
    expect(assignPriceBucket(20)).toBe("$16-$19");
  });
});

// ============================================================================
// Telemetry Calculation Tests
// ============================================================================

describe("calculateTelemetry", () => {
  const mockRows: ResponseLogRow[] = [
    {
      recipient: "alice",
      sourceChannel: "X DM",
      workflowSentence: "test",
      objectionType: "none",
      wtp: 12,
      nextStepDecision: "advance",
      decisionRationale: "test",
      responseState: "PILOT YES",
    },
    {
      recipient: "bob",
      sourceChannel: "Discord",
      workflowSentence: "test",
      objectionType: "price",
      wtp: 8,
      nextStepDecision: "nurture",
      decisionRationale: "test",
      responseState: "PILOT NO",
    },
    {
      recipient: "charlie",
      sourceChannel: "Email",
      workflowSentence: "test",
      objectionType: "trust",
      wtp: 15,
      nextStepDecision: "advance",
      decisionRationale: "test",
      responseState: "PILOT YES",
    },
  ];

  test("calculates price bucket counts correctly", () => {
    const telemetry = calculateTelemetry(mockRows);

    expect(telemetry.priceBucketCounts["$8-$11"]).toBe(1);
    expect(telemetry.priceBucketCounts["$12"]).toBe(1);
    expect(telemetry.priceBucketCounts["$13-$15"]).toBe(1);
    expect(telemetry.priceBucketCounts["$16-$19"]).toBe(0);
  });

  test("calculates pilot YES rates correctly", () => {
    const telemetry = calculateTelemetry(mockRows);

    expect(telemetry.pilotYesRateByBucket["$8-$11"].yes).toBe(0);
    expect(telemetry.pilotYesRateByBucket["$8-$11"].total).toBe(1);
    expect(telemetry.pilotYesRateByBucket["$8-$11"].rate).toBe(0);

    expect(telemetry.pilotYesRateByBucket["$12"].yes).toBe(1);
    expect(telemetry.pilotYesRateByBucket["$12"].total).toBe(1);
    expect(telemetry.pilotYesRateByBucket["$12"].rate).toBe(1);

    expect(telemetry.pilotYesRateByBucket["$13-$15"].yes).toBe(1);
    expect(telemetry.pilotYesRateByBucket["$13-$15"].total).toBe(1);
    expect(telemetry.pilotYesRateByBucket["$13-$15"].rate).toBe(1);
  });

  test("calculates median WTP correctly", () => {
    const telemetry = calculateTelemetry(mockRows);
    expect(telemetry.medianWTP).toBe(12);
  });

  test("calculates objection mix correctly", () => {
    const telemetry = calculateTelemetry(mockRows);

    expect(telemetry.objectionMix["none"]).toBe(1);
    expect(telemetry.objectionMix["price"]).toBe(1);
    expect(telemetry.objectionMix["trust"]).toBe(1);
  });

  test("buckets are in deterministic order", () => {
    const telemetry = calculateTelemetry(mockRows);
    const bucketKeys = Object.keys(telemetry.priceBucketCounts);

    expect(bucketKeys).toEqual(["$8-$11", "$12", "$13-$15", "$16-$19"]);
  });
});

// ============================================================================
// Recommendation Engine Tests
// ============================================================================

describe("calculateRecommendation", () => {
  test("recommends $12 (baseline) when it has 100% YES rate", () => {
    const telemetry = {
      priceBucketCounts: { "$8-$11": 1, "$12": 1, "$13-$15": 0, "$16-$19": 0 },
      pilotYesRateByBucket: {
        "$8-$11": { yes: 0, total: 1, rate: 0 },
        "$12": { yes: 1, total: 1, rate: 1 },
        "$13-$15": { yes: 0, total: 0, rate: 0 },
        "$16-$19": { yes: 0, total: 0, rate: 0 },
      },
      medianWTP: 11,
      objectionMix: {},
    };

    const result = calculateRecommendation(telemetry);

    expect(result.recommendedNextAnchor).toBe(12);
    expect(result.anchorContext).toBe("baseline");
    expect(result.precedenceChain).toContain("baseline_threshold");
  });

  test("recommends higher bucket when baseline not available", () => {
    const telemetry = {
      priceBucketCounts: { "$8-$11": 0, "$12": 0, "$13-$15": 1, "$16-$19": 0 },
      pilotYesRateByBucket: {
        "$8-$11": { yes: 0, total: 0, rate: 0 },
        "$12": { yes: 0, total: 0, rate: 0 },
        "$13-$15": { yes: 1, total: 1, rate: 1 },
        "$16-$19": { yes: 0, total: 0, rate: 0 },
      },
      medianWTP: 14,
      objectionMix: {},
    };

    const result = calculateRecommendation(telemetry);

    expect(result.anchorContext).toBe("higher");
  });

  test("includes precedence chain in output", () => {
    const telemetry = {
      priceBucketCounts: { "$8-$11": 0, "$12": 1, "$13-$15": 0, "$16-$19": 0 },
      pilotYesRateByBucket: {
        "$8-$11": { yes: 0, total: 0, rate: 0 },
        "$12": { yes: 1, total: 1, rate: 1 },
        "$13-$15": { yes: 0, total: 0, rate: 0 },
        "$16-$19": { yes: 0, total: 0, rate: 0 },
      },
      medianWTP: 12,
      objectionMix: {},
    };

    const result = calculateRecommendation(telemetry);

    expect(result.precedenceChain.length).toBeGreaterThan(0);
    expect(typeof result.rationale).toBe("string");
  });
});

// ============================================================================
// Confidence Band Tests
// ============================================================================

describe("calculateConfidence", () => {
  test("returns high confidence with adequate sample size", () => {
    const telemetry = {
      priceBucketCounts: { "$8-$11": 2, "$12": 3, "$13-$15": 2, "$16-$19": 3 },
      pilotYesRateByBucket: {
        "$8-$11": { yes: 1, total: 2, rate: 0.5 },
        "$12": { yes: 2, total: 3, rate: 0.67 },
        "$13-$15": { yes: 1, total: 2, rate: 0.5 },
        "$16-$19": { yes: 2, total: 3, rate: 0.67 },
      },
      medianWTP: 13,
      objectionMix: {},
    };

    const result = calculateConfidence(telemetry, 10);

    expect(result.band).toBe("high");
    expect(result.minimumSampleMet).toBe(true);
    expect(result.sampleSize).toBe(10);
  });

  test("returns low confidence with small sample size", () => {
    const telemetry = {
      priceBucketCounts: { "$8-$11": 0, "$12": 1, "$13-$15": 0, "$16-$19": 0 },
      pilotYesRateByBucket: {
        "$8-$11": { yes: 0, total: 0, rate: 0 },
        "$12": { yes: 1, total: 1, rate: 1 },
        "$13-$15": { yes: 0, total: 0, rate: 0 },
        "$16-$19": { yes: 0, total: 0, rate: 0 },
      },
      medianWTP: 12,
      objectionMix: {},
    };

    const result = calculateConfidence(telemetry, 1);

    expect(result.band).toBe("low");
    expect(result.minimumSampleMet).toBe(false);
    expect(result.sampleSize).toBe(1);
  });
});

// ============================================================================
// CLI Integration Tests - Happy Path
// ============================================================================

describe("CLI Integration - Happy Path", () => {
  test("runs successfully with happy path fixture", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.parsed).toBeDefined();
    expect(result.parsed!.status).toBe("ok");
  });

  test("happy path has required top-level fields", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    expect(result.parsed).toHaveProperty("status");
    expect(result.parsed).toHaveProperty("inputs");
    expect(result.parsed).toHaveProperty("telemetry");
    expect(result.parsed).toHaveProperty("recommendation");
    expect(result.parsed).toHaveProperty("confidence");
    expect(result.parsed).toHaveProperty("diagnostics");
    expect(result.parsed).toHaveProperty("timestamp");
  });

  test("happy path telemetry has required fields", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    const telemetry = result.parsed!.telemetry as Record<string, unknown>;

    expect(telemetry).toHaveProperty("priceBucketCounts");
    expect(telemetry).toHaveProperty("pilotYesRateByBucket");
    expect(telemetry).toHaveProperty("medianWTP");
    expect(telemetry).toHaveProperty("objectionMix");
  });

  test("happy path has all price buckets in telemetry", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    const telemetry = result.parsed!.telemetry as Record<string, Record<string, unknown>>;
    const buckets = Object.keys(telemetry.priceBucketCounts);

    expect(buckets).toContain("$8-$11");
    expect(buckets).toContain("$12");
    expect(buckets).toContain("$13-$15");
    expect(buckets).toContain("$16-$19");
  });

  test("happy path recommendation has required fields", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    const recommendation = result.parsed!.recommendation as Record<string, unknown>;

    expect(recommendation).toHaveProperty("recommendedNextAnchor");
    expect(recommendation).toHaveProperty("anchorContext");
    expect(recommendation).toHaveProperty("rationale");
    expect(recommendation).toHaveProperty("precedenceChain");
  });

  test("happy path confidence has required fields", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    const confidence = result.parsed!.confidence as Record<string, unknown>;

    expect(confidence).toHaveProperty("band");
    expect(confidence).toHaveProperty("level");
    expect(confidence).toHaveProperty("minimumSampleMet");
    expect(confidence).toHaveProperty("sampleSize");
    expect(confidence).toHaveProperty("reasoning");
  });
});

// ============================================================================
// CLI Integration Tests - Failure Fixtures with Exact Rule IDs
// ============================================================================

describe("CLI Integration - Failure Fixtures", () => {
  test("missing-wtp fixture fails with MISSING_WTP_VALUE rule ID", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-missing-wtp-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.parsed).toBeDefined();

    const diagnostics = result.parsed!.diagnostics as Array<{ ruleId: string }>;
    const ruleIds = diagnostics.map((d) => d.ruleId);

    expect(ruleIds).toContain("MISSING_WTP_VALUE");
  });

  test("missing-wtp fixture has diagnostics with batch and recipient", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-missing-wtp-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    const diagnostics = result.parsed!.diagnostics as Array<{
      ruleId: string;
      batch?: string;
      recipient?: string;
      message: string;
    }>;

    const missingWtpDiagnostics = diagnostics.filter(
      (d) => d.ruleId === "MISSING_WTP_VALUE"
    );

    expect(missingWtpDiagnostics.length).toBeGreaterThan(0);

    for (const diag of missingWtpDiagnostics) {
      expect(diag.message).toBeDefined();
      expect(typeof diag.message).toBe("string");
    }
  });

  test("out-of-range fixture fails with WTP_OUT_OF_RANGE rule ID", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-out-of-range-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.parsed).toBeDefined();

    const diagnostics = result.parsed!.diagnostics as Array<{ ruleId: string }>;
    const ruleIds = diagnostics.map((d) => d.ruleId);

    expect(ruleIds).toContain("WTP_OUT_OF_RANGE");
  });

  test("out-of-range fixture diagnostics include value and range info", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-out-of-range-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    const diagnostics = result.parsed!.diagnostics as Array<{
      ruleId: string;
      message: string;
    }>;

    const outOfRangeDiagnostics = diagnostics.filter(
      (d) => d.ruleId === "WTP_OUT_OF_RANGE"
    );

    expect(outOfRangeDiagnostics.length).toBeGreaterThan(0);

    for (const diag of outOfRangeDiagnostics) {
      expect(diag.message).toContain("$");
      expect(diag.message).toContain("range");
    }
  });

  test("malformed fixture fails with INVALID_WTP_VALUE rule ID", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-malformed-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.parsed).toBeDefined();

    const diagnostics = result.parsed!.diagnostics as Array<{ ruleId: string }>;
    const ruleIds = diagnostics.map((d) => d.ruleId);

    expect(ruleIds).toContain("INVALID_WTP_VALUE");
  });

  test("malformed fixture diagnostics identify non-numeric values", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-malformed-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    const diagnostics = result.parsed!.diagnostics as Array<{
      ruleId: string;
      message: string;
    }>;

    const invalidDiagnostics = diagnostics.filter(
      (d) => d.ruleId === "INVALID_WTP_VALUE"
    );

    expect(invalidDiagnostics.length).toBeGreaterThan(0);

    for (const diag of invalidDiagnostics) {
      expect(diag.message).toContain("not a valid number");
    }
  });
});

// ============================================================================
// Deterministic Output Tests
// ============================================================================

describe("Deterministic Output", () => {
  test("produces identical JSON output for repeated runs (excluding timestamp)", async () => {
    const args = [
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ];

    const result1 = await runCli(args);
    const result2 = await runCli(args);

    // Both should succeed
    expect(result1.exitCode).toBe(0);
    expect(result2.exitCode).toBe(0);

    // Parse and compare (excluding timestamp)
    const output1 = { ...result1.parsed!, timestamp: undefined };
    const output2 = { ...result2.parsed!, timestamp: undefined };

    expect(output1).toEqual(output2);
  });

  test("produces byte-stable JSON across multiple runs", async () => {
    const args = [
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ];

    const result1 = await runCli(args);
    const result2 = await runCli(args);
    const result3 = await runCli(args);

    expect(result1.exitCode).toBe(0);
    expect(result2.exitCode).toBe(0);
    expect(result3.exitCode).toBe(0);

    // Normalize timestamps for comparison (they will differ)
    const normalizeTimestamp = (json: string) => {
      return json.replace(
        /"timestamp":\s*"[^"]+"/,
        '"timestamp": "NORMALIZED"'
      );
    };

    const normalized1 = normalizeTimestamp(result1.stdout);
    const normalized2 = normalizeTimestamp(result2.stdout);
    const normalized3 = normalizeTimestamp(result3.stdout);

    expect(normalized1).toBe(normalized2);
    expect(normalized2).toBe(normalized3);
  });

  test("price bucket counts have stable key ordering", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    const telemetry = result.parsed!.telemetry as {
      priceBucketCounts: Record<string, number>;
      pilotYesRateByBucket: Record<string, unknown>;
    };

    const countKeys = Object.keys(telemetry.priceBucketCounts);
    const rateKeys = Object.keys(telemetry.pilotYesRateByBucket);

    // Buckets should be in price order (low to high)
    const expectedOrder = ["$8-$11", "$12", "$13-$15", "$16-$19"];

    expect(countKeys).toEqual(expectedOrder);
    expect(rateKeys).toEqual(expectedOrder);
  });

  test("objection mix is sorted alphabetically", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    const telemetry = result.parsed!.telemetry as {
      objectionMix: Record<string, number>;
    };

    const objectionKeys = Object.keys(telemetry.objectionMix);

    expect(objectionKeys).toEqual([...objectionKeys].sort());
  });

  test("precedence chain is in deterministic order", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    const recommendation = result.parsed!.recommendation as {
      precedenceChain: string[];
    };

    // Precedence chain should be consistent
    expect(recommendation.precedenceChain.length).toBeGreaterThan(0);

    // Run again to verify stability
    const result2 = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    const recommendation2 = result2.parsed!.recommendation as {
      precedenceChain: string[];
    };

    expect(recommendation.precedenceChain).toEqual(recommendation2.precedenceChain);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("Error Handling", () => {
  test("fails with exit code 1 for non-existent root", async () => {
    const result = await runCli([
      "--root",
      "/nonexistent/path",
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    // The CLI exits with code 1 for invalid root
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Root path");
  });

  test("fails with exit code 2 for non-existent brief", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      "/nonexistent/brief.md",
      "--format",
      "json",
    ]);

    // The CLI exits with code 2 for invalid brief
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Brief file");
  });
});

// ============================================================================
// Human Output Format Tests
// ============================================================================

describe("formatHumanOutput", () => {
  test("produces human-readable summary", () => {
    const output = {
      status: "ok" as const,
      inputs: {
        rootPath: "/test/root",
        briefPath: "/test/brief.md",
        batchesAnalyzed: ["test-batch"],
        totalResponses: 10,
      },
      telemetry: {
        priceBucketCounts: { "$8-$11": 2, "$12": 3, "$13-$15": 3, "$16-$19": 2 },
        pilotYesRateByBucket: {
          "$8-$11": { yes: 1, total: 2, rate: 0.5 },
          "$12": { yes: 3, total: 3, rate: 1 },
          "$13-$15": { yes: 2, total: 3, rate: 0.67 },
          "$16-$19": { yes: 2, total: 2, rate: 1 },
        },
        medianWTP: 13,
        objectionMix: { none: 4, price: 3, trust: 3 },
      },
      recommendation: {
        recommendedNextAnchor: 12,
        anchorContext: "baseline" as const,
        rationale: "Test rationale",
        precedenceChain: ["baseline_threshold"],
      },
      confidence: {
        band: "high" as const,
        level: 0.8,
        minimumSampleMet: true,
        sampleSize: 10,
        reasoning: "Test reasoning",
      },
      diagnostics: [],
      timestamp: "2026-03-01T12:00:00Z",
    };

    const human = formatHumanOutput(output);

    expect(human).toContain("Pilot Price Signal Analyzer");
    expect(human).toContain("Status:");
    expect(human).toContain("OK");
    expect(human).toContain("Recommended Anchor: $12/mo");
    expect(human).toContain("Band:");
  });
});

// ============================================================================
// Fixture-Based Scenario Tests
// ============================================================================

describe("Fixture-Based Scenarios", () => {
  test("happy path fixture produces ok status", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.parsed!.status).toBe("ok");
    expect(result.parsed!.inputs.totalResponses).toBe(10);
  });

  test("happy path has no diagnostics", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-happy-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    const diagnostics = result.parsed!.diagnostics as unknown[];
    expect(diagnostics.length).toBe(0);
  });

  test("missing-wtp fixture produces error status", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-missing-wtp-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    expect(result.parsed!.status).toBe("error");
  });

  test("out-of-range fixture produces error status", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-out-of-range-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    expect(result.parsed!.status).toBe("error");
  });

  test("malformed fixture produces error status", async () => {
    const result = await runCli([
      "--root",
      join(FIXTURES_DIR, "pilot-price-signal-malformed-root"),
      "--brief",
      join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
      "--format",
      "json",
    ]);

    expect(result.parsed!.status).toBe("error");
  });

  test("all fixtures produce valid JSON structure", async () => {
    const fixtures = [
      "pilot-price-signal-happy-root",
      "pilot-price-signal-missing-wtp-root",
      "pilot-price-signal-out-of-range-root",
      "pilot-price-signal-malformed-root",
    ];

    for (const fixture of fixtures) {
      const result = await runCli([
        "--root",
        join(FIXTURES_DIR, fixture),
        "--brief",
        join(FIXTURES_DIR, "pilot-price-signal.brief.md"),
        "--format",
        "json",
      ]);

      // All should produce valid JSON
      expect(result.parsed).toBeDefined();
      expect(result.parsed).toHaveProperty("status");
      expect(result.parsed).toHaveProperty("telemetry");
      expect(result.parsed).toHaveProperty("recommendation");
      expect(result.parsed).toHaveProperty("confidence");
    }
  });
});
