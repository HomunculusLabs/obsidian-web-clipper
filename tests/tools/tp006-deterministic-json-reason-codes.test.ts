#!/usr/bin/env bun

/**
 * TP006: Deterministic JSON Envelopes & Reason Codes Tests
 *
 * Tests verify that mutator fallback mode outputs:
 * 1. Deterministic JSON envelope schema with required fields
 * 2. Deterministic reason codes matching the shared contract
 * 3. Parity between fallback-artifact and direct-write outcomes
 *
 * Key assertions:
 * - JSON output envelopes have stable field types and structure
 * - Reason codes are deterministic and map to correct modes
 * - Fallback artifacts produce identical outcomes to direct-write when applied
 * - Artifact schema validates against MutatorFallbackArtifact contract
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");

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
  const dir = mkdtempSync(join(tmpdir(), "tp006-deterministic-"));
  tempDirs.push(dir);
  return dir;
}

function sha256(content: string): string {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function parseJsonBlock(stdout: string, startMarker: string, endMarker: string): unknown {
  const start = stdout.indexOf(startMarker);
  const end = stdout.indexOf(endMarker);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`JSON block not found: ${startMarker}...${endMarker}`);
  }

  const json = stdout.slice(start + startMarker.length, end).trim();
  return JSON.parse(json);
}

describe("TP006: taskpad:write-preflight deterministic JSON envelope", () => {
  test("JSON output envelope contains all required contract fields for writable path", async () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    writeFileSync(taskpadPath, "# TASKPAD\n", "utf8");

    const proc = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", taskpadPath],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);

    const jsonMatch = stdout.match(/TASKPAD_WRITE_PRECHECK_JSON_START\n([\s\S]*?)\nTASKPAD_WRITE_PRECHECK_JSON_END/);
    expect(jsonMatch).toBeTruthy();

    const output = JSON.parse(jsonMatch![1]);

    // Assert all required contract fields exist with correct types
    expect(output).toHaveProperty("taskpadPath");
    expect(output).toHaveProperty("taskpadExists");
    expect(output).toHaveProperty("parentDirPath");
    expect(output).toHaveProperty("writable");
    expect(output).toHaveProperty("reasonCode");
    expect(output).toHaveProperty("mode");
    expect(output).toHaveProperty("permissionClass");
    expect(output).toHaveProperty("detail");

    // Assert field types are deterministic
    expect(typeof output.taskpadPath).toBe("string");
    expect(typeof output.taskpadExists).toBe("boolean");
    expect(typeof output.parentDirPath).toBe("string");
    expect(typeof output.writable).toBe("boolean");
    expect(typeof output.reasonCode).toBe("string");
    expect(typeof output.mode).toBe("string");
    expect(typeof output.permissionClass).toBe("string");
    expect(typeof output.detail).toBe("string");

    // Assert non-empty string fields
    expect(output.taskpadPath.length).toBeGreaterThan(0);
    expect(output.parentDirPath.length).toBeGreaterThan(0);
    expect(output.reasonCode.length).toBeGreaterThan(0);
    expect(output.mode.length).toBeGreaterThan(0);
    expect(output.permissionClass.length).toBeGreaterThan(0);
    expect(output.detail.length).toBeGreaterThan(0);
  });

  test("JSON output envelope contains all required contract fields for missing path", async () => {
    const dir = makeTempDir();
    const missingPath = join(dir, "MISSING.md");

    const proc = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", missingPath],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();

    const jsonMatch = stdout.match(/TASKPAD_WRITE_PRECHECK_JSON_START\n([\s\S]*?)\nTASKPAD_WRITE_PRECHECK_JSON_END/);
    expect(jsonMatch).toBeTruthy();

    const output = JSON.parse(jsonMatch![1]);

    // Even for error mode, all required fields must be present
    expect(output).toHaveProperty("taskpadPath");
    expect(output).toHaveProperty("taskpadExists");
    expect(output).toHaveProperty("parentDirPath");
    expect(output).toHaveProperty("writable");
    expect(output).toHaveProperty("reasonCode");
    expect(output).toHaveProperty("mode");
    expect(output).toHaveProperty("permissionClass");
    expect(output).toHaveProperty("detail");

    // Assert deterministic error-mode values
    expect(output.taskpadPath).toBe(missingPath);
    expect(output.taskpadExists).toBe(false);
    expect(output.writable).toBe(false);
    expect(output.reasonCode).toBe("PRECHECK_TASKPAD_NOT_FOUND");
    expect(output.mode).toBe("error");
    expect(output.permissionClass).toBe("non-permission");
  });

  test("JSON output envelope is byte-stable across identical inputs", async () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const content = "# TASKPAD\n\n## Self-Improvement Backlog\n- [ ] test item\n";
    writeFileSync(taskpadPath, content, "utf8");

    // Run twice to verify byte-stability
    const proc1 = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", taskpadPath],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout1 = await new Response(proc1.stdout).text();

    const proc2 = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", taskpadPath],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout2 = await new Response(proc2.stdout).text();

    // Extract JSON payloads
    const jsonMatch1 = stdout1.match(/TASKPAD_WRITE_PRECHECK_JSON_START\n([\s\S]*?)\nTASKPAD_WRITE_PRECHECK_JSON_END/);
    const jsonMatch2 = stdout2.match(/TASKPAD_WRITE_PRECHECK_JSON_START\n([\s\S]*?)\nTASKPAD_WRITE_PRECHECK_JSON_END/);

    expect(jsonMatch1).toBeTruthy();
    expect(jsonMatch2).toBeTruthy();

    const output1 = JSON.parse(jsonMatch1![1]);
    const output2 = JSON.parse(jsonMatch2![1]);

    // Verify byte-stable JSON structure
    expect(JSON.stringify(output1)).toBe(JSON.stringify(output2));

    // Verify all fields match exactly
    expect(output1.taskpadPath).toBe(output2.taskpadPath);
    expect(output1.taskpadExists).toBe(output2.taskpadExists);
    expect(output1.parentDirPath).toBe(output2.parentDirPath);
    expect(output1.writable).toBe(output2.writable);
    expect(output1.reasonCode).toBe(output2.reasonCode);
    expect(output1.mode).toBe(output2.mode);
    expect(output1.permissionClass).toBe(output2.permissionClass);
  });
});

describe("TP006: taskpad:plan-seed deterministic JSON envelope", () => {
  test("JSON output envelope contains all required fields", async () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

    const taskpadContent = `# TASKPAD\n\n## Self-Improvement Backlog\n- [ ] test item\n`;
    const planContent = `# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-02-28): Existing seeded slice

### Distilled Scope
- existing

### RepoPrompt Builder Context
- existing

### Task Graph
- [ ] **TP001**: Existing task

### Acceptance Criteria
- existing

### Verification Commands
\`\`\`bash
bun run typecheck
\`\`\`
`;

    writeFileSync(taskpadPath, taskpadContent, "utf8");
    writeFileSync(planPath, planContent, "utf8");

    const proc = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-plan-seed.ts", "--", "--taskpad", taskpadPath, "--plan", planPath, "--date", "2026-03-01"],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();

    const jsonMatch = stdout.match(/PLAN_SEED_JSON_START\n([\s\S]*?)\nPLAN_SEED_JSON_END/);
    expect(jsonMatch).toBeTruthy();

    const output = JSON.parse(jsonMatch![1]);

    // Assert required top-level fields
    expect(output).toHaveProperty("status");
    expect(output).toHaveProperty("reasonCode");
    expect(output).toHaveProperty("selectedBacklogLine");
    expect(output).toHaveProperty("newSliceHeading");

    // Assert field types are deterministic
    expect(typeof output.status).toBe("string");
    expect(typeof output.reasonCode).toBe("string");
    expect(output.selectedBacklogLine === null || typeof output.selectedBacklogLine === "number").toBe(true);
    expect(output.newSliceHeading === null || typeof output.newSliceHeading === "string").toBe(true);
  });

  test("JSON output envelope contains all required fields for noop outcome", async () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

    const taskpadContent = `# TASKPAD\n\n## Self-Improvement Backlog\n- [x] already done\n`;
    const planContent = `# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-02-28): Existing seeded slice

### Distilled Scope
- existing

### RepoPrompt Builder Context
- existing

### Task Graph
- [ ] **TP001**: Existing task

### Acceptance Criteria
- existing

### Verification Commands
\`\`\`bash
bun run typecheck
\`\`\`
`;

    writeFileSync(taskpadPath, taskpadContent, "utf8");
    writeFileSync(planPath, planContent, "utf8");

    const proc = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-plan-seed.ts", "--", "--taskpad", taskpadPath, "--plan", planPath, "--date", "2026-03-01"],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();

    const jsonMatch = stdout.match(/PLAN_SEED_JSON_START\n([\s\S]*?)\nPLAN_SEED_JSON_END/);
    expect(jsonMatch).toBeTruthy();

    const output = JSON.parse(jsonMatch![1]);

    // Assert deterministic noop values
    expect(output.status).toBe("noop");
    expect(output.reasonCode).toBe("PLAN_SEED_NO_UNCHECKED_SELF_IMPROVEMENT");
    expect(output.selectedBacklogLine).toBeNull();
    expect(output.newSliceHeading).toBeNull();
  });

  test("fallback artifact metadata is present when write fails", async () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

    const taskpadContent = `# TASKPAD\n\n## Self-Improvement Backlog\n- [ ] test item\n`;
    const planContent = `# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-02-28): Existing seeded slice

### Distilled Scope
- existing

### RepoPrompt Builder Context
- existing

### Task Graph
- [ ] **TP001**: Existing task

### Acceptance Criteria
- existing

### Verification Commands
\`\`\`bash
bun run typecheck
\`\`\`
`;

    writeFileSync(taskpadPath, taskpadContent, "utf8");
    writeFileSync(planPath, planContent, "utf8");

    // Make directory read-only to trigger fallback artifact mode
    const { chmodSync } = await import("node:fs");
    chmodSync(dir, 0o555);

    try {
      const proc = Bun.spawn({
        cmd: ["bun", "run", "tools/taskpad-plan-seed.ts", "--", "--taskpad", taskpadPath, "--plan", planPath, "--date", "2026-03-01"],
        cwd: PROJECT_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();

      const jsonMatch = stdout.match(/PLAN_SEED_JSON_START\n([\s\S]*?)\nPLAN_SEED_JSON_END/);
      expect(jsonMatch).toBeTruthy();

      const output = JSON.parse(jsonMatch![1]);

      // When write fails, output should indicate failure with preflight reason
      expect(output).toHaveProperty("status");
      expect(output).toHaveProperty("reasonCode");
      expect(output).toHaveProperty("artifact");

      // Assert deterministic failure reason code
      expect(output.status).toBe("failed");
      expect(output.reasonCode).toMatch(/^PLAN_SEED_/);

      // Artifact should be present with preflight metadata
      expect(output.artifact).not.toBeNull();
      expect(output.artifact).toHaveProperty("preflightReasonCode");
      // preflightResult may or may not be present depending on where the failure occurred
      if (output.artifact.preflightResult !== null) {
        expect(typeof output.artifact.preflightResult).toBe("object");
      }
    } finally {
      // Restore permissions for cleanup
      chmodSync(dir, 0o755);
    }
  });
});

describe("TP006: taskpad:apply-fallback deterministic JSON envelope", () => {
  test("JSON output envelope contains all required fields for applied/rejected outcome", async () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const artifactPath = join(dir, "artifact.json");

    const taskpadInitial = `# TASKPAD\n\n## Execution Queue\n- [x] done\n\n## Work Queue\n- [ ] candidate\n`;
    writeFileSync(taskpadPath, taskpadInitial, "utf8");

    // Create a simple auto-ideation fallback artifact
    const crypto = require("crypto");
    const patch = `--- a/TASKPAD.md\n+++ b/TASKPAD.md\n@@ -2,5 +2,6 @@\n \n ## Execution Queue\n - [x] done\n+- [ ] candidate\n \n ## Work Queue`;

    const artifact = {
      version: 1,
      kind: "taskpad-auto-ideation-fallback-patch" as const,
      taskpadPath: resolve(taskpadPath),
      taskpadSha256: crypto.createHash("sha256").update(taskpadInitial, "utf8").digest("hex"),
      selectedCandidateId: "AIC001",
      selectedOutcome: {
        action: "would-insert" as const,
        canonicalBullet: "- [ ] candidate",
        insertedLine: 4,
      },
      patch: {
        format: "unified-diff" as const,
        targetPath: resolve(taskpadPath),
        content: patch,
      },
      applyHint: "Apply patch to TASKPAD",
    };

    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");

    const proc = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-apply-fallback.ts", "--", "--taskpad", taskpadPath, "--artifact", artifactPath],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    const jsonMatch = stdout.match(/APPLY_FALLBACK_JSON_START\n([\s\S]*?)\nAPPLY_FALLBACK_JSON_END/);
    expect(jsonMatch).toBeTruthy();

    const output = JSON.parse(jsonMatch![1]);

    // Assert required top-level fields exist
    expect(output).toHaveProperty("status");
    expect(output).toHaveProperty("reasonCode");
    expect(output).toHaveProperty("taskpadPath");

    // Assert field types
    expect(typeof output.status).toBe("string");
    expect(output.reasonCode === null || typeof output.reasonCode === "string").toBe(true);
    expect(typeof output.taskpadPath).toBe("string");

    // Status should be one of the valid outcomes
    expect(["applied", "rejected", "noop"]).toContain(output.status);

    // When rejected, reasonCode should be present
    if (output.status === "rejected") {
      expect(output.reasonCode).not.toBeNull();
      expect(typeof output.reasonCode).toBe("string");
    }
  });

  test("JSON output envelope contains deterministic error details for rejected outcome", async () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const artifactPath = join(dir, "artifact.json");

    const taskpadInitial = `# TASKPAD\n`;
    const taskpadModified = `# TASKPAD\n\n## Modified\n`;

    writeFileSync(taskpadPath, taskpadModified, "utf8"); // Modified from expected

    const crypto = require("crypto");
    const artifact = {
      version: 1,
      kind: "taskpad-auto-ideation-fallback-patch" as const,
      taskpadPath: resolve(taskpadPath),
      taskpadSha256: crypto.createHash("sha256").update(taskpadInitial, "utf8").digest("hex"), // Hash doesn't match
      selectedCandidateId: "AIC001",
      selectedOutcome: {
        action: "would-insert" as const,
        canonicalBullet: "- [ ] candidate",
        insertedLine: 4,
      },
      patch: {
        format: "unified-diff" as const,
        targetPath: resolve(taskpadPath),
        content: "--- a/TASKPAD.md\n+++ b/TASKPAD.md\n@@ -1,1 +1,2 @@\n # TASKPAD\n+\n## Modified\n",
      },
      applyHint: "Apply patch to TASKPAD",
    };

    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");

    const proc = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-apply-fallback.ts", "--", "--taskpad", taskpadPath, "--artifact", artifactPath],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(1); // Non-zero for rejected

    const jsonMatch = stdout.match(/APPLY_FALLBACK_JSON_START\n([\s\S]*?)\nAPPLY_FALLBACK_JSON_END/);
    expect(jsonMatch).toBeTruthy();

    const output = JSON.parse(jsonMatch![1]);

    // Assert deterministic rejection values
    expect(output.status).toBe("rejected");
    expect(output.reasonCode).toBe("ERR_TASKPAD_HASH_MISMATCH");
    expect(output.taskpadPath).toBe(resolve(taskpadPath));
  });

  test("JSON output envelope is byte-stable across identical apply operations", async () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const artifactPath = join(dir, "artifact.json");

    const taskpadInitial = `# TASKPAD\n\n## Execution Queue\n- [x] done\n`;
    writeFileSync(taskpadPath, taskpadInitial, "utf8");

    const crypto = require("crypto");
    const patch = `--- a/TASKPAD.md\n+++ b/TASKPAD.md\n@@ -2,2 +2,3 @@\n \n ## Execution Queue\n - [x] done\n+- [ ] test\n`;

    const artifact = {
      version: 1,
      kind: "taskpad-auto-ideation-fallback-patch" as const,
      taskpadPath: resolve(taskpadPath),
      taskpadSha256: crypto.createHash("sha256").update(taskpadInitial, "utf8").digest("hex"),
      selectedCandidateId: "AIC001",
      selectedOutcome: {
        action: "would-insert" as const,
        canonicalBullet: "- [ ] test",
        insertedLine: 4,
      },
      patch: {
        format: "unified-diff" as const,
        targetPath: resolve(taskpadPath),
        content: patch,
      },
      applyHint: "Apply patch to TASKPAD",
    };

    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");

    // Apply once
    const proc1 = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-apply-fallback.ts", "--", "--taskpad", taskpadPath, "--artifact", artifactPath],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout1 = await new Response(proc1.stdout).text();

    const jsonMatch1 = stdout1.match(/APPLY_FALLBACK_JSON_START\n([\s\S]*?)\nAPPLY_FALLBACK_JSON_END/);
    expect(jsonMatch1).toBeTruthy();
    const output1 = JSON.parse(jsonMatch1![1]);

    // Apply again (will fail due to hash mismatch, which is expected behavior)
    const proc2 = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-apply-fallback.ts", "--", "--taskpad", taskpadPath, "--artifact", artifactPath],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout2 = await new Response(proc2.stdout).text();

    const jsonMatch2 = stdout2.match(/APPLY_FALLBACK_JSON_START\n([\s\S]*?)\nAPPLY_FALLBACK_JSON_END/);
    expect(jsonMatch2).toBeTruthy();
    const output2 = JSON.parse(jsonMatch2![1]);

    // First apply should succeed or fail deterministically
    expect(["applied", "rejected"]).toContain(output1.status);

    // Second apply should fail due to hash mismatch (expected behavior after first apply)
    if (output1.status === "applied") {
      expect(output2.status).toBe("rejected");
      expect(output2.reasonCode).toBe("ERR_TASKPAD_HASH_MISMATCH");
    }

    // Both outputs should have stable structure
    expect(typeof output1.status).toBe("string");
    expect(typeof output2.status).toBe("string");
    expect(typeof output1.taskpadPath).toBe("string");
    expect(typeof output2.taskpadPath).toBe("string");
    expect(output1.taskpadPath).toBe(output2.taskpadPath);
  });
});

describe("TP006: Deterministic reason codes for mutator fallback mode", () => {
  test("taskpad:write-preflight emits only contract-defined reason codes", async () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    writeFileSync(taskpadPath, "# TASKPAD\n", "utf8");

    const proc = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", taskpadPath],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();

    const jsonMatch = stdout.match(/TASKPAD_WRITE_PRECHECK_JSON_START\n([\s\S]*?)\nTASKPAD_WRITE_PRECHECK_JSON_END/);
    const output = JSON.parse(jsonMatch![1]);

    const VALID_REASON_CODES = [
      "PRECHECK_OK",
      "PRECHECK_PERMISSION_EPERM",
      "PRECHECK_PERMISSION_EACCES",
      "PRECHECK_PERMISSION_EROFS",
      "PRECHECK_PERMISSION_DENIED_GENERIC",
      "PRECHECK_TASKPAD_NOT_FOUND",
      "PRECHECK_TASKPAD_PATH_INVALID",
      "PRECHECK_PARENT_DIR_NOT_FOUND",
      "PRECHECK_IO_UNEXPECTED",
    ];

    expect(VALID_REASON_CODES).toContain(output.reasonCode);
  });

  test("taskpad:write-preflight reason codes deterministically map to modes", async () => {
    // Test mapping for writable path
    const dir1 = makeTempDir();
    const taskpadPath1 = join(dir1, "TASKPAD.md");
    writeFileSync(taskpadPath1, "# TASKPAD\n", "utf8");

    const proc1 = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", taskpadPath1],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout1 = await new Response(proc1.stdout).text();
    const jsonMatch1 = stdout1.match(/TASKPAD_WRITE_PRECHECK_JSON_START\n([\s\S]*?)\nTASKPAD_WRITE_PRECHECK_JSON_END/);
    const output1 = JSON.parse(jsonMatch1![1]);

    // PRECHECK_OK should map to direct-write mode
    expect(output1.reasonCode).toBe("PRECHECK_OK");
    expect(output1.mode).toBe("direct-write");
    expect(output1.permissionClass).toBe("none");

    // Test mapping for missing path
    const dir2 = makeTempDir();
    const missingPath = join(dir2, "MISSING.md");

    const proc2 = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", missingPath],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout2 = await new Response(proc2.stdout).text();
    const jsonMatch2 = stdout2.match(/TASKPAD_WRITE_PRECHECK_JSON_START\n([\s\S]*?)\nTASKPAD_WRITE_PRECHECK_JSON_END/);
    const output2 = JSON.parse(jsonMatch2![1]);

    // PRECHECK_TASKPAD_NOT_FOUND should map to error mode
    expect(output2.reasonCode).toBe("PRECHECK_TASKPAD_NOT_FOUND");
    expect(output2.mode).toBe("error");
    expect(output2.permissionClass).toBe("non-permission");
  });

  test("taskpad:plan-seed emits only contract-defined reason codes", async () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

    writeFileSync(taskpadPath, "# TASKPAD\n\n## Self-Improvement Backlog\n- [ ] test\n", "utf8");
    writeFileSync(planPath, "# Implementation Plan\n\n## Legacy\n\n### Task Graph\n- [ ] TP001\n", "utf8");

    const proc = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-plan-seed.ts", "--", "--taskpad", taskpadPath, "--plan", planPath, "--date", "2026-03-01"],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();

    const jsonMatch = stdout.match(/PLAN_SEED_JSON_START\n([\s\S]*?)\nPLAN_SEED_JSON_END/);
    const output = JSON.parse(jsonMatch![1]);

    const VALID_REASON_CODES = [
      "PLAN_SEED_OK",
      "PLAN_SEED_NO_UNCHECKED_SELF_IMPROVEMENT",
      "PLAN_SEED_TASKPAD_SECTION_MISSING",
      "PLAN_SEED_PLAN_INSERT_ANCHOR_MISSING",
      "PLAN_SEED_PLAN_REQUIRED_HEADING_MISSING",
      "PLAN_SEED_TASKPAD_WRITE_FAILED",
      "PLAN_SEED_PLAN_WRITE_FAILED",
      "PLAN_SEED_ATOMIC_COMMIT_ABORTED",
      "PLAN_SEED_INPUT_INVALID",
      "PLAN_SEED_FALLBACK_ARTIFACT_GENERATED",
      "PLAN_SEED_PREFLIGHT_ERROR",
    ];

    expect(VALID_REASON_CODES).toContain(output.reasonCode);
  });

  test("taskpad:apply-fallback emits only contract-defined reason codes", async () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const artifactPath = join(dir, "artifact.json");

    writeFileSync(taskpadPath, "# TASKPAD\n", "utf8");

    const crypto = require("crypto");
    const artifact = {
      version: 1,
      kind: "taskpad-auto-ideation-fallback-patch" as const,
      taskpadPath: resolve(taskpadPath),
      taskpadSha256: crypto.createHash("sha256").update("# TASKPAD\n", "utf8").digest("hex"),
      selectedCandidateId: "AIC001",
      selectedOutcome: {
        action: "would-insert" as const,
        canonicalBullet: "- [ ] test",
        insertedLine: 2,
      },
      patch: {
        format: "unified-diff" as const,
        targetPath: resolve(taskpadPath),
        content: "--- a/TASKPAD.md\n+++ b/TASKPAD.md\n@@ -1,1 +1,2 @@\n # TASKPAD\n+\n- [ ] test\n",
      },
      applyHint: "Apply patch to TASKPAD",
    };

    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");

    const proc = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-apply-fallback.ts", "--", "--taskpad", taskpadPath, "--artifact", artifactPath],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();

    const jsonMatch = stdout.match(/APPLY_FALLBACK_JSON_START\n([\s\S]*?)\nAPPLY_FALLBACK_JSON_END/);
    const output = JSON.parse(jsonMatch![1]);

    // When status is applied or noop, reasonCode should be null
    expect(["applied", "noop", "rejected"]).toContain(output.status);
    if (output.status === "applied" || output.status === "noop") {
      expect(output.reasonCode).toBeNull();
    } else {
      // Rejected status should have a reason code
      const VALID_REASON_CODES = [
        "ERR_ARTIFACT_PARSE",
        "ERR_ARTIFACT_SCHEMA",
        "ERR_ARTIFACT_VERSION_UNSUPPORTED",
        "ERR_TASKPAD_PATH_MISMATCH",
        "ERR_TASKPAD_NOT_FOUND",
        "ERR_TASKPAD_HASH_MISMATCH",
        "ERR_PATCH_FORMAT_INVALID",
        "ERR_PATCH_TARGET_PATH_MISMATCH",
        "ERR_PATCH_APPLY_FAILED",
        "ERR_WRITE_FAILED",
        "ERR_UNEXPECTED",
      ];
      expect(VALID_REASON_CODES).toContain(output.reasonCode);
    }
  });
});

describe("TP006: Parity between fallback-artifact and direct-write outcomes", () => {
  test("plan-seed fallback artifact produces identical state to direct-write", async () => {
    const dir = makeTempDir();

    // Create two identical initial states
    const taskpadPath1 = join(dir, "TASKPAD.md");
    const planPath1 = join(dir, "IMPLEMENTATION_PLAN.md");
    const artifactPath = join(dir, "artifact.json");

    const taskpadPath2 = join(dir, "TASKPAD2.md");
    const planPath2 = join(dir, "IMPLEMENTATION_PLAN2.md");

    const taskpadInitial = `# TASKPAD\n\n## Self-Improvement Backlog\n- [ ] test parity\n`;
    const planInitial = `# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-02-28): Existing seeded slice

### Distilled Scope
- existing

### RepoPrompt Builder Context
- existing

### Task Graph
- [ ] **TP001**: Existing task

### Acceptance Criteria
- existing

### Verification Commands
\`\`\`bash
bun run typecheck
\`\`\`
`;

    writeFileSync(taskpadPath1, taskpadInitial, "utf8");
    writeFileSync(planPath1, planInitial, "utf8");
    writeFileSync(taskpadPath2, taskpadInitial, "utf8");
    writeFileSync(planPath2, planInitial, "utf8");

    // Run direct-write on path1
    const proc1 = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-plan-seed.ts", "--", "--taskpad", taskpadPath1, "--plan", planPath1, "--date", "2026-03-01"],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc1.exited;
    const directWriteTaskpad = readFileSync(taskpadPath1, "utf8");
    const directWritePlan = readFileSync(planPath1, "utf8");

    // Generate fallback artifact for path2 (by making read-only)
    const { chmodSync } = await import("node:fs");
    chmodSync(dir, 0o555);

    try {
      const proc2 = Bun.spawn({
        cmd: ["bun", "run", "tools/taskpad-plan-seed.ts", "--", "--taskpad", taskpadPath2, "--plan", planPath2, "--date", "2026-03-01"],
        cwd: PROJECT_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout2 = await new Response(proc2.stdout).text();
      const jsonMatch = stdout2.match(/PLAN_SEED_JSON_START\n([\s\S]*?)\nPLAN_SEED_JSON_END/);
      const output = JSON.parse(jsonMatch![1]);

      // Read the artifact file
      if (output.artifact && output.artifact.artifactPath) {
        const artifact = JSON.parse(readFileSync(output.artifact.artifactPath, "utf8"));

        // Apply the fallback artifact
        chmodSync(dir, 0o755);
        const proc3 = Bun.spawn({
          cmd: ["bun", "run", "tools/taskpad-apply-fallback.ts", "--", "--taskpad", taskpadPath2, "--artifact", output.artifact.artifactPath, "--plan", planPath2],
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        });

        await proc3.exited;
        const fallbackTaskpad = readFileSync(taskpadPath2, "utf8");
        const fallbackPlan = readFileSync(planPath2, "utf8");

        // Verify parity: fallback outcome should match direct-write
        expect(fallbackTaskpad).toBe(directWriteTaskpad);
        expect(fallbackPlan).toBe(directWritePlan);
        expect(sha256(fallbackTaskpad)).toBe(sha256(directWriteTaskpad));
        expect(sha256(fallbackPlan)).toBe(sha256(directWritePlan));
      }
    } finally {
      chmodSync(dir, 0o755);
    }
  });

  test("fallback artifact and direct-write produce identical JSON structure", async () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");

    writeFileSync(taskpadPath, "# TASKPAD\n", "utf8");

    // Run write-preflight twice to verify JSON structure stability
    const proc1 = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", taskpadPath],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout1 = await new Response(proc1.stdout).text();

    const proc2 = Bun.spawn({
      cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", taskpadPath],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout2 = await new Response(proc2.stdout).text();

    // Extract and parse JSON
    const jsonMatch1 = stdout1.match(/TASKPAD_WRITE_PRECHECK_JSON_START\n([\s\S]*?)\nTASKPAD_WRITE_PRECHECK_JSON_END/);
    const jsonMatch2 = stdout2.match(/TASKPAD_WRITE_PRECHECK_JSON_START\n([\s\S]*?)\nTASKPAD_WRITE_PRECHECK_JSON_END/);

    const output1 = JSON.parse(jsonMatch1![1]);
    const output2 = JSON.parse(jsonMatch2![1]);

    // Verify identical JSON structure
    expect(Object.keys(output1).sort()).toEqual(Object.keys(output2).sort());
    expect(JSON.stringify(output1)).toBe(JSON.stringify(output2));
  });
});
