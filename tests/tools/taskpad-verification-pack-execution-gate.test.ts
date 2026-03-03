#!/usr/bin/env bun

/**
 * TP005: Verification Pack Execution Gate Tests
 *
 * Tests for pass/fail/noop cases and stable diagnostics.
 *
 * Contract: docs/quality/taskpad-verification-pack-execution-gate.md
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  RULE_IDS,
  CANONICAL_RULE_ORDER,
  type RuleId,
  type CommandType,
  type CommandExecutionResult,
  type ExecutionGateResult,
  type ExecutionGateLineage,
  loadVerificationPack,
  loadPackageJson,
  determineCommandType,
  createExecutionGateResult,
  createFailedCommandResult,
  validateStalePackLinkage,
  sortDiagnostics,
} from "../../tools/lib/taskpad-verification-pack-execution-gate";

// ============================================================================
// Test Setup
// ============================================================================

const FIXTURES_DIR = join(__dirname, "fixtures");

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
  const dir = mkdtempSync(join(tmpdir(), "vpeg-test-"));
  tempDirs.push(dir);
  return dir;
}

function loadFixture(name: string): {
  packPath: string;
  pack: ReturnType<typeof loadVerificationPack>;
} {
  const packPath = join(FIXTURES_DIR, `execution-gate-${name}.json`);
  const pack = loadVerificationPack(packPath);
  return { packPath, pack };
}

function loadPackageFixture(name: string): ReturnType<typeof loadPackageJson> {
  const packagePath = join(FIXTURES_DIR, `${name}.package.json`);
  return loadPackageJson(packagePath);
}

function loadTextFixture(name: string): string {
  const filePath = join(FIXTURES_DIR, `execution-gate.${name}.md`);
  return readFileSync(filePath, "utf8");
}

// ============================================================================
// Tests: Rule ID Constants and Canonical Order
// ============================================================================

describe("rule IDs and canonical order", () => {
  test("should have all expected rule IDs defined", () => {
    expect(RULE_IDS.COMMAND_NOT_RESOLVED).toBe("EG001_COMMAND_NOT_RESOLVED");
    expect(RULE_IDS.SCRIPT_NOT_FOUND).toBe("EG002_SCRIPT_NOT_FOUND");
    expect(RULE_IDS.TOOL_NOT_FOUND).toBe("EG003_TOOL_NOT_FOUND");
    expect(RULE_IDS.TEST_FILE_NOT_FOUND).toBe("EG004_TEST_FILE_NOT_FOUND");
    expect(RULE_IDS.COMMAND_CLASS_DISALLOWED).toBe("EG005_COMMAND_CLASS_DISALLOWED");
    expect(RULE_IDS.COMMAND_TIMEOUT).toBe("EG101_COMMAND_TIMEOUT");
    expect(RULE_IDS.NON_ZERO_EXIT).toBe("EG102_NON_ZERO_EXIT");
    expect(RULE_IDS.EXECUTION_ERROR).toBe("EG103_EXECUTION_ERROR");
    expect(RULE_IDS.OUTPUT_TRUNCATED).toBe("EG104_OUTPUT_TRUNCATED");
    expect(RULE_IDS.STALE_PACK_HASH).toBe("EG201_STALE_PACK_HASH");
    expect(RULE_IDS.STALE_SLICE_ID).toBe("EG202_STALE_SLICE_ID");
    expect(RULE_IDS.STALE_FINGERPRINT).toBe("EG203_STALE_FINGERPRINT");
  });

  test("should have canonical order with resolution failures first", () => {
    const expectedOrder: RuleId[] = [
      // Resolution failures
      RULE_IDS.COMMAND_NOT_RESOLVED,
      RULE_IDS.SCRIPT_NOT_FOUND,
      RULE_IDS.TOOL_NOT_FOUND,
      RULE_IDS.TEST_FILE_NOT_FOUND,
      RULE_IDS.COMMAND_CLASS_DISALLOWED,
      // Execution failures
      RULE_IDS.COMMAND_TIMEOUT,
      RULE_IDS.NON_ZERO_EXIT,
      RULE_IDS.EXECUTION_ERROR,
      RULE_IDS.OUTPUT_TRUNCATED,
      // Stale pack failures
      RULE_IDS.STALE_PACK_HASH,
      RULE_IDS.STALE_SLICE_ID,
      RULE_IDS.STALE_FINGERPRINT,
    ];
    expect(CANONICAL_RULE_ORDER).toEqual(expectedOrder);
  });

  test("should have unique rule IDs", () => {
    const allRuleIds = Object.values(RULE_IDS);
    const uniqueRuleIds = new Set(allRuleIds);
    expect(allRuleIds).toHaveLength(uniqueRuleIds.size);
  });

  test("should have all rule IDs in canonical order", () => {
    const canonicalSet = new Set(CANONICAL_RULE_ORDER);
    const allRuleIds = Object.values(RULE_IDS) as RuleId[];
    for (const ruleId of allRuleIds) {
      expect(canonicalSet.has(ruleId)).toBe(true);
    }
  });
});

// ============================================================================
// Tests: Command Type Determination
// ============================================================================

describe("determineCommandType", () => {
  test("should identify package script commands", () => {
    expect(determineCommandType("typecheck")).toBe("package-script");
    expect(determineCommandType("bun run typecheck")).toBe("package-script");
    expect(determineCommandType("npm run build")).toBe("package-script");
  });

  test("should identify test runner commands", () => {
    expect(determineCommandType("bun test tests/example.test.ts")).toBe("test-runner");
    expect(determineCommandType("bun run test tests/example.test.ts")).toBe("test-runner");
  });

  test("should identify tool entry commands", () => {
    expect(determineCommandType("bun run tools/example.ts")).toBe("tool-entry");
  });

  test("should identify verification commands", () => {
    expect(determineCommandType("bun run taskpad:verification-pack")).toBe("verification-command");
    expect(determineCommandType("bun run taskpad:verification-pack-contract")).toBe("verification-command");
    expect(determineCommandType("bun run taskpad:verification-pack-execution-gate")).toBe("verification-command");
  });

  test("should identify unknown commands", () => {
    expect(determineCommandType("random unknown command")).toBe("unknown");
    expect(determineCommandType("")).toBe("unknown");
  });
});

// ============================================================================
// Tests: Load Verification Pack
// ============================================================================

describe("loadVerificationPack", () => {
  test("should load valid pass fixture", () => {
    const { pack } = loadFixture("pass");
    expect(pack.version).toBe(1);
    expect(pack.packHash).toBe("pass123hash456");
    expect(pack.verificationCommands).toHaveLength(1);
    expect(pack.verificationCommands[0]).toBe("bun run typecheck");
  });

  test("should load noop fixture with empty commands", () => {
    const { pack } = loadFixture("noop");
    expect(pack.verificationCommands).toHaveLength(0);
    expect(pack.metadata.commandCount).toBe(0);
  });

  test("should load fail fixtures with expected structure", () => {
    const { pack: scriptNotFoundPack } = loadFixture("fail-script-not-found");
    expect(scriptNotFoundPack.verificationCommands[0]).toContain("non-existent-script");

    const { pack: toolNotFoundPack } = loadFixture("fail-tool-not-found");
    expect(toolNotFoundPack.verificationCommands[0]).toContain("non-existent-tool");

    const { pack: staleSlicePack } = loadFixture("fail-stale-slice");
    expect(staleSlicePack.sliceId).toContain("old-slice");
  });

  test("should throw on non-existent file", () => {
    expect(() => {
      loadVerificationPack(join(FIXTURES_DIR, "non-existent.json"));
    }).toThrow();
  });
});

// ============================================================================
// Tests: Stale Pack Validation
// ============================================================================

describe("validateStalePackLinkage", () => {
  const currentSliceId = "2026-03-02-verification-pack-execution-gate";
  const currentFingerprint = "passfingerprint789";

  test("should pass for fresh pack with matching slice ID and fingerprint", () => {
    const { pack } = loadFixture("pass");
    const result = validateStalePackLinkage(
      pack,
      currentSliceId,
      currentFingerprint,
      join(makeTempDir(), "history.ndjson"),
      24 * 60 * 60 * 1000, // 24 hours
    );

    expect(result.isStale).toBe(false);
    expect(result.ruleId).toBeNull();
    expect(result.packGeneratedAt).toBe("2026-03-02T21:00:00.000Z");
  });

  test("should fail for stale slice ID", () => {
    const { pack } = loadFixture("fail-stale-slice");
    const result = validateStalePackLinkage(
      pack,
      currentSliceId, // Different from pack's sliceId
      currentFingerprint,
      join(makeTempDir(), "history.ndjson"),
    );

    expect(result.isStale).toBe(true);
    expect(result.ruleId).toBe(RULE_IDS.STALE_SLICE_ID);
    expect(result.message).toContain("slice ID");
  });

  test("should fail for stale fingerprint", () => {
    const { pack } = loadFixture("fail-fingerprint");
    const result = validateStalePackLinkage(
      pack,
      pack.sliceId, // Same slice ID
      currentFingerprint, // Different fingerprint
      join(makeTempDir(), "history.ndjson"),
    );

    expect(result.isStale).toBe(true);
    expect(result.ruleId).toBe(RULE_IDS.STALE_FINGERPRINT);
    expect(result.message).toContain("fingerprint");
  });

  test("should fail for old pack age", () => {
    const { pack } = loadFixture("pass");
    // Create a very old pack by modifying the generatedAt
    const oldPack = { ...pack, generatedAt: "2020-01-01T00:00:00.000Z" };
    
    const result = validateStalePackLinkage(
      oldPack,
      currentSliceId,
      currentFingerprint,
      join(makeTempDir(), "history.ndjson"),
      24 * 60 * 60 * 1000, // 24 hours
    );

    expect(result.isStale).toBe(true);
    expect(result.ruleId).toBe(RULE_IDS.STALE_PACK_HASH);
    expect(result.ageMs).toBeGreaterThan(24 * 60 * 60 * 1000);
  });
});

// ============================================================================
// Tests: Result Creation
// ============================================================================

describe("createExecutionGateResult", () => {
  const baseLineage: ExecutionGateLineage = {
    sliceId: "2026-03-02-test",
    workQueueFingerprint: "fp123",
    packHash: "hash123",
    packGeneratedAt: "2026-03-02T21:00:00.000Z",
    isStale: false,
    historyLinkage: null,
  };

  test("should create pass result when all commands pass", () => {
    const commandResults: CommandExecutionResult[] = [
      {
        command: "bun run typecheck",
        commandType: "package-script",
        resolved: true,
        passed: true,
        exitCode: 0,
        durationMs: 1000,
        ruleId: null,
        message: "Success",
      },
    ];

    const result = createExecutionGateResult({
      packHash: "hash123",
      workQueueFingerprint: "fp123",
      sliceId: "2026-03-02-test",
      commandResults,
      lineage: baseLineage,
      diagnostics: ["All commands passed"],
    });

    expect(result.status).toBe("pass");
    expect(result.commandCount).toBe(1);
    expect(result.passedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  test("should create fail result when any command fails", () => {
    const commandResults: CommandExecutionResult[] = [
      {
        command: "bun run typecheck",
        commandType: "package-script",
        resolved: true,
        passed: true,
        exitCode: 0,
        durationMs: 1000,
        ruleId: null,
        message: "Success",
      },
      {
        command: "bun run missing",
        commandType: "package-script",
        resolved: false,
        passed: false,
        exitCode: null,
        durationMs: null,
        ruleId: RULE_IDS.SCRIPT_NOT_FOUND,
        message: "Script not found",
      },
    ];

    const result = createExecutionGateResult({
      packHash: "hash123",
      workQueueFingerprint: "fp123",
      sliceId: "2026-03-02-test",
      commandResults,
      lineage: baseLineage,
      diagnostics: ["One command failed"],
    });

    expect(result.status).toBe("fail");
    expect(result.commandCount).toBe(2);
    expect(result.passedCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });

  test("should create noop result when no commands", () => {
    const result = createExecutionGateResult({
      packHash: "hash123",
      workQueueFingerprint: "fp123",
      sliceId: "2026-03-02-test",
      commandResults: [],
      lineage: baseLineage,
      diagnostics: ["No commands to run"],
    });

    expect(result.status).toBe("noop");
    expect(result.commandCount).toBe(0);
    expect(result.passedCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });

  test("should include all required fields", () => {
    const result = createExecutionGateResult({
      packHash: "hash123",
      workQueueFingerprint: "fp123",
      sliceId: "2026-03-02-test",
      commandResults: [],
      lineage: baseLineage,
      diagnostics: ["Test"],
    });

    expect(result.version).toBe(1);
    expect(result.packHash).toBe("hash123");
    expect(result.workQueueFingerprint).toBe("fp123");
    expect(result.sliceId).toBe("2026-03-02-test");
    expect(result.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.lineage).toEqual(baseLineage);
  });
});

describe("createFailedCommandResult", () => {
  test("should create failed result with correct structure", () => {
    const result = createFailedCommandResult({
      command: "bun run missing",
      commandType: "package-script",
      ruleId: RULE_IDS.SCRIPT_NOT_FOUND,
      message: "Script not found in package.json",
    });

    expect(result.command).toBe("bun run missing");
    expect(result.commandType).toBe("package-script");
    expect(result.resolved).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeNull();
    expect(result.ruleId).toBe(RULE_IDS.SCRIPT_NOT_FOUND);
    expect(result.message).toBe("Script not found in package.json");
  });
});

// ============================================================================
// Tests: Deterministic Diagnostics
// ============================================================================

describe("sortDiagnostics", () => {
  test("should maintain stable ordering", () => {
    const diagnostics = [
      "Error 3",
      "Error 1",
      "Error 2",
    ];

    const sorted = sortDiagnostics(diagnostics);
    expect(sorted).toEqual(["Error 1", "Error 2", "Error 3"]);
  });

  test("should handle empty diagnostics", () => {
    const sorted = sortDiagnostics([]);
    expect(sorted).toEqual([]);
  });

  test("should not mutate original array", () => {
    const original = ["c", "a", "b"];
    const sorted = sortDiagnostics(original);
    expect(original).toEqual(["c", "a", "b"]);
    expect(sorted).toEqual(["a", "b", "c"]);
  });
});

// ============================================================================
// Tests: Fixture-Based Integration
// ============================================================================

describe("fixture-based tests", () => {
  test("pass fixture should have valid structure", () => {
    const { pack } = loadFixture("pass");
    expect(pack.version).toBe(1);
    expect(pack.sliceId).toBe("2026-03-02-verification-pack-execution-gate");
    expect(pack.verificationCommands).toContain("bun run typecheck");
  });

  test("noop fixture should have empty commands", () => {
    const { pack } = loadFixture("noop");
    expect(pack.verificationCommands).toHaveLength(0);
  });

  test("fail-script-not-found fixture should reference non-existent script", () => {
    const { pack } = loadFixture("fail-script-not-found");
    expect(pack.verificationCommands[0]).toMatch(/non-existent-script-xyz123/);
  });

  test("fail-tool-not-found fixture should reference non-existent tool", () => {
    const { pack } = loadFixture("fail-tool-not-found");
    expect(pack.verificationCommands[0]).toMatch(/non-existent-tool-xyz123/);
  });

  test("fail-stale-slice fixture should have different slice ID", () => {
    const { pack } = loadFixture("fail-stale-slice");
    expect(pack.sliceId).toContain("old-slice");
    expect(pack.sliceId).not.toBe("2026-03-02-verification-pack-execution-gate");
  });

  test("fail-fingerprint fixture should have mismatched fingerprint", () => {
    const { pack } = loadFixture("fail-fingerprint");
    expect(pack.workQueueFingerprint).toContain("stale-fingerprint");
  });

  test("fail-multiple fixture should have multiple commands", () => {
    const { pack } = loadFixture("fail-multiple");
    expect(pack.verificationCommands).toHaveLength(3);
    expect(pack.metadata.commandCount).toBe(3);
  });

  test("pass-test-runner fixture should reference valid test file", () => {
    const { pack } = loadFixture("pass-test-runner");
    expect(pack.verificationCommands[0]).toContain("bun test");
    expect(pack.verificationCommands[0]).toContain(".test.ts");
  });

  test("pass-tool-entry fixture should reference valid tool", () => {
    const { pack } = loadFixture("pass-tool-entry");
    expect(pack.verificationCommands[0]).toContain("tools/");
    expect(pack.verificationCommands[0]).toContain(".ts");
  });
});

// ============================================================================
// Tests: Result Shape Stability
// ============================================================================

describe("result shape stability", () => {
  test("ExecutionGateResult should have stable required fields", () => {
    const result = createExecutionGateResult({
      packHash: "test-hash",
      workQueueFingerprint: "test-fp",
      sliceId: "test-slice",
      commandResults: [],
      lineage: {
        sliceId: "test-slice",
        workQueueFingerprint: "test-fp",
        packHash: "test-hash",
        packGeneratedAt: "2026-03-02T21:00:00.000Z",
        isStale: false,
        historyLinkage: null,
      },
      diagnostics: [],
    });

    // Verify all required top-level fields
    expect(result).toHaveProperty("version");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("packHash");
    expect(result).toHaveProperty("workQueueFingerprint");
    expect(result).toHaveProperty("sliceId");
    expect(result).toHaveProperty("commandCount");
    expect(result).toHaveProperty("passedCount");
    expect(result).toHaveProperty("failedCount");
    expect(result).toHaveProperty("commandResults");
    expect(result).toHaveProperty("lineage");
    expect(result).toHaveProperty("diagnostics");
    expect(result).toHaveProperty("evaluatedAt");

    // Verify lineage fields
    expect(result.lineage).toHaveProperty("sliceId");
    expect(result.lineage).toHaveProperty("workQueueFingerprint");
    expect(result.lineage).toHaveProperty("packHash");
    expect(result.lineage).toHaveProperty("packGeneratedAt");
    expect(result.lineage).toHaveProperty("isStale");
    expect(result.lineage).toHaveProperty("historyLinkage");
  });

  test("CommandExecutionResult should have stable required fields", () => {
    const result: CommandExecutionResult = {
      command: "test",
      commandType: "package-script",
      resolved: true,
      passed: true,
      exitCode: 0,
      durationMs: 100,
      ruleId: null,
      message: "Success",
    };

    expect(result).toHaveProperty("command");
    expect(result).toHaveProperty("commandType");
    expect(result).toHaveProperty("resolved");
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("exitCode");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("ruleId");
    expect(result).toHaveProperty("message");
  });
});

// ============================================================================
// Tests: Package.json Loading
// ============================================================================

describe("loadPackageJson", () => {
  test("should load package fixture with scripts", () => {
    const pkg = loadPackageFixture("execution-gate");
    expect(pkg.name).toBe("obsidian-web-clipper-test");
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts?.typecheck).toBe("tsc --noEmit");
    expect(pkg.scripts?.["taskpad:verification-pack"]).toBeDefined();
  });

  test("should throw on non-existent file", () => {
    expect(() => {
      loadPackageJson(join(FIXTURES_DIR, "non-existent.json"));
    }).toThrow();
  });
});
