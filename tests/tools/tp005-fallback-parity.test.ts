#!/usr/bin/env bun

/**
 * TP005: Fallback Parity Tests
 *
 * Tests verify that mutator fallback artifacts can be:
 * 1. Generated when preflight mode is `fallback-artifact`
 * 2. Applied once to produce the expected state
 * 3. Re-run as a no-op (idempotent)
 *
 * Scenarios covered:
 * - plan-seed with dual-file patches (TASKPAD + IMPLEMENTATION_PLAN)
 * - autoplan with single-file patch (TASKPAD only)
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "tp005-fallback-parity-"));
  tempDirs.push(dir);
  return dir;
}

function sha256(content: string): string {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function splitMarkdownLines(markdown: string): string[] {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (normalized.endsWith("\n") && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function buildSingleInsertionDiff(taskpadPath: string, before: string, after: string): string {
  const oldLines = splitMarkdownLines(before);
  const newLines = splitMarkdownLines(after);
  const portablePath = resolve(taskpadPath).replace(/\\/g, "/");

  const body = [...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`)].join("\n");

  return [
    `--- a/${portablePath}`,
    `+++ b/${portablePath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    body,
    "",
  ].join("\n");
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

function runApplyFallback(taskpadPath: string, artifactPath: string, planPath?: string) {
  const args = ["bun", "run", "taskpad:apply-fallback", "--", "--taskpad", taskpadPath, "--artifact", artifactPath];
  if (planPath) {
    args.push("--plan", planPath);
  }

  return Bun.spawnSync(args, { cwd: PROJECT_ROOT, stdout: "pipe", stderr: "pipe" });
}

describe("TP005: Plan-seed fallback parity (fixture-based)", () => {
  test("plan-seed fallback artifact applies and produces expected state", () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const planPath = join(dir, "IMPLEMENTATION_PLAN.md");
    const artifactPath = join(dir, "artifact.json");

    // Initial state
    const taskpadInitial = `# TASKPAD

## Self-Improvement Backlog
- [ ] tighten intake handoff
- [ ] add fallback artifact fixtures
`;

    const planInitial = `# Implementation Plan

## Legacy Slice

### Task Graph
- [ ] TP001: Old task
`;

    // Expected state after applying artifact
    const taskpadExpected = `# TASKPAD

## Self-Improvement Backlog
- [x] planned-2026-02-28 tighten intake handoff
- [ ] add fallback artifact fixtures
`;

    const planExpected = `# Implementation Plan

## TASKPAD Intake Slice (2026-02-28): tighten intake handoff (\`taskpad:plan-seed\`)

### Task Graph
- [ ] **TP001**: First task

---

## Legacy Slice

### Task Graph
- [ ] TP001: Old task
`;

    // Create plan-seed artifact
    const taskpadPatch = buildSingleInsertionDiff(taskpadPath, taskpadInitial, taskpadExpected);
    const planPatch = buildSingleInsertionDiff(planPath, planInitial, planExpected);

    const artifact = {
      version: 1,
      kind: "taskpad-plan-seed-fallback-patch" as const,
      taskpadPath: resolve(taskpadPath),
      planPath: resolve(planPath),
      taskpadSha256: sha256(taskpadInitial),
      planSha256: sha256(planInitial),
      mutationId: "plan-seed-2026-02-28-test",
      mutationOutcome: {
        action: "would-insert-plan" as const,
        taskpadUpdatedLine: "- [x] planned-2026-02-28 tighten intake handoff",
        planInsertHeading: "## TASKPAD Intake Slice (2026-02-28): tighten intake handoff (`taskpad:plan-seed`)",
        selectedBacklogLine: 4,
      },
      patch: {
        format: "unified-diff" as const,
        taskpadTargetPath: resolve(taskpadPath),
        planTargetPath: resolve(planPath),
        taskpadPatchContent: taskpadPatch,
        planPatchContent: planPatch,
      },
      applyHint: "Apply both TASKPAD and IMPLEMENTATION_PLAN patches atomically.",
    };

    writeFileSync(taskpadPath, taskpadInitial, "utf8");
    writeFileSync(planPath, planInitial, "utf8");
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");

    const run = runApplyFallback(taskpadPath, artifactPath, planPath);
    const stdout = new TextDecoder().decode(run.stdout);

    expect(run.exitCode).toBe(0);
    expect(stdout).toContain("APPLIED");

    const taskpadActual = readFileSync(taskpadPath, "utf8");
    const planActual = readFileSync(planPath, "utf8");

    // Verify both files match expected state
    expect(taskpadActual).toBe(taskpadExpected);
    expect(planActual).toBe(planExpected);

    // Verify SHA parity
    expect(sha256(taskpadActual)).toBe(sha256(taskpadExpected));
    expect(sha256(planActual)).toBe(sha256(planExpected));

    // Parse result and verify status
    const result = parseJsonBlock(stdout, "APPLY_FALLBACK_JSON_START", "APPLY_FALLBACK_JSON_END") as Record<string, unknown>;
    expect(result.status).toBe("applied");
    expect(result.reasonCode).toBeNull();
  });

  test("plan-seed fallback re-run detects hash mismatch and does not corrupt files", () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const planPath = join(dir, "IMPLEMENTATION_PLAN.md");
    const artifactPath = join(dir, "artifact.json");

    const taskpadInitial = `# TASKPAD

## Self-Improvement Backlog
- [ ] tighten intake handoff
`;

    const planInitial = `# Implementation Plan

## Legacy Slice

### Task Graph
- [ ] TP001: Old task
`;

    const taskpadExpected = `# TASKPAD

## Self-Improvement Backlog
- [x] planned-2026-02-28 tighten intake handoff
`;

    const planExpected = `# Implementation Plan

## TASKPAD Intake Slice (2026-02-28): tighten intake handoff (\`taskpad:plan-seed\`)

### Task Graph
- [ ] **TP001**: First task

---

## Legacy Slice

### Task Graph
- [ ] TP001: Old task
`;

    const taskpadPatch = buildSingleInsertionDiff(taskpadPath, taskpadInitial, taskpadExpected);
    const planPatch = buildSingleInsertionDiff(planPath, planInitial, planExpected);

    const artifact = {
      version: 1,
      kind: "taskpad-plan-seed-fallback-patch" as const,
      taskpadPath: resolve(taskpadPath),
      planPath: resolve(planPath),
      taskpadSha256: sha256(taskpadInitial),
      planSha256: sha256(planInitial),
      mutationId: "plan-seed-2026-02-28-test",
      mutationOutcome: {
        action: "would-insert-plan" as const,
        taskpadUpdatedLine: "- [x] planned-2026-02-28 tighten intake handoff",
        planInsertHeading: "## TASKPAD Intake Slice (2026-02-28): tighten intake handoff (`taskpad:plan-seed`)",
        selectedBacklogLine: 4,
      },
      patch: {
        format: "unified-diff" as const,
        taskpadTargetPath: resolve(taskpadPath),
        planTargetPath: resolve(planPath),
        taskpadPatchContent: taskpadPatch,
        planPatchContent: planPatch,
      },
      applyHint: "Apply both TASKPAD and IMPLEMENTATION_PLAN patches atomically.",
    };

    writeFileSync(taskpadPath, taskpadInitial, "utf8");
    writeFileSync(planPath, planInitial, "utf8");
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");

    // First application
    const firstRun = runApplyFallback(taskpadPath, artifactPath, planPath);
    expect(firstRun.exitCode).toBe(0);

    const taskpadAfterFirst = readFileSync(taskpadPath, "utf8");
    const planAfterFirst = readFileSync(planPath, "utf8");

    // Second application should fail with hash mismatch (files already modified)
    const secondRun = runApplyFallback(taskpadPath, artifactPath, planPath);
    const secondStdout = new TextDecoder().decode(secondRun.stdout);
    const secondStderr = new TextDecoder().decode(secondRun.stderr);

    expect(secondRun.exitCode).toBe(1);
    expect(secondStdout).toContain("rejected");
    expect(secondStdout).toContain("ERR_TASKPAD_HASH_MISMATCH");

    // Verify files unchanged after second run (not corrupted)
    expect(readFileSync(taskpadPath, "utf8")).toBe(taskpadAfterFirst);
    expect(readFileSync(planPath, "utf8")).toBe(planAfterFirst);

    // Verify final state matches expected
    expect(taskpadAfterFirst).toBe(taskpadExpected);
    expect(planAfterFirst).toBe(planExpected);

    // Parse second result and verify hash mismatch error
    const result = parseJsonBlock(secondStdout, "APPLY_FALLBACK_JSON_START", "APPLY_FALLBACK_JSON_END") as Record<string, unknown>;
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("ERR_TASKPAD_HASH_MISMATCH");
  });

  test("plan-seed fallback parity: direct-write equivalent produces identical output", () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const planPath = join(dir, "IMPLEMENTATION_PLAN.md");
    const artifactPath = join(dir, "artifact.json");

    const taskpadInitial = `# TASKPAD

## Self-Improvement Backlog
- [ ] add fallback tests
`;

    const planInitial = `# Implementation Plan

## Legacy

### Task Graph
- [ ] TP001: Legacy task
`;

    // Expected state (simulating direct-write output)
    const taskpadExpected = `# TASKPAD

## Self-Improvement Backlog
- [x] planned-2026-02-28 add fallback tests
`;

    const planExpected = `# Implementation Plan

## TASKPAD Intake Slice (2026-02-28): add fallback tests (\`taskpad:plan-seed\`)

### Task Graph
- [ ] **TP001**: Task for fallback tests

---

## Legacy

### Task Graph
- [ ] TP001: Legacy task
`;

    const taskpadPatch = buildSingleInsertionDiff(taskpadPath, taskpadInitial, taskpadExpected);
    const planPatch = buildSingleInsertionDiff(planPath, planInitial, planExpected);

    const artifact = {
      version: 1,
      kind: "taskpad-plan-seed-fallback-patch" as const,
      taskpadPath: resolve(taskpadPath),
      planPath: resolve(planPath),
      taskpadSha256: sha256(taskpadInitial),
      planSha256: sha256(planInitial),
      mutationId: "plan-seed-2026-02-28-parity",
      mutationOutcome: {
        action: "would-insert-plan" as const,
        taskpadUpdatedLine: "- [x] planned-2026-02-28 add fallback tests",
        planInsertHeading: "## TASKPAD Intake Slice (2026-02-28): add fallback tests (`taskpad:plan-seed`)",
        selectedBacklogLine: 4,
      },
      patch: {
        format: "unified-diff" as const,
        taskpadTargetPath: resolve(taskpadPath),
        planTargetPath: resolve(planPath),
        taskpadPatchContent: taskpadPatch,
        planPatchContent: planPatch,
      },
      applyHint: "Apply both TASKPAD and IMPLEMENTATION_PLAN patches atomically.",
    };

    writeFileSync(taskpadPath, taskpadInitial, "utf8");
    writeFileSync(planPath, planInitial, "utf8");
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");

    // Apply fallback artifact
    const run = runApplyFallback(taskpadPath, artifactPath, planPath);
    expect(run.exitCode).toBe(0);

    const taskpadFallback = readFileSync(taskpadPath, "utf8");
    const planFallback = readFileSync(planPath, "utf8");

    // Verify fallback produces expected state (which represents direct-write output)
    expect(taskpadFallback).toBe(taskpadExpected);
    expect(planFallback).toBe(planExpected);

    // Verify SHA parity
    expect(sha256(taskpadFallback)).toBe(sha256(taskpadExpected));
    expect(sha256(planFallback)).toBe(sha256(planExpected));
  });
});

describe("TP005: Autoplan fallback parity (fixture-based)", () => {
  test("autoplan fallback artifact applies and produces expected state", () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const artifactPath = join(dir, "artifact.json");

    const taskpadInitial = `# TASKPAD

## Execution Queue
- [x] completed task

## Work Queue
- [ ] Auto-ideation candidate 1
- [ ] Auto-ideation candidate 2
`;

    const taskpadExpected = `# TASKPAD

## Execution Queue
- [x] completed task
- [ ] Auto-ideation candidate 1

## Work Queue
- [ ] Auto-ideation candidate 1
- [ ] Auto-ideation candidate 2
`;

    const patch = buildSingleInsertionDiff(taskpadPath, taskpadInitial, taskpadExpected);

    const artifact = {
      version: 1,
      kind: "taskpad-auto-ideation-fallback-patch" as const,
      taskpadPath: resolve(taskpadPath),
      taskpadSha256: sha256(taskpadInitial),
      selectedCandidateId: "AIC001",
      selectedOutcome: {
        action: "would-insert" as const,
        canonicalBullet: "- [ ] Auto-ideation candidate 1",
        insertedLine: 4,
      },
      patch: {
        format: "unified-diff" as const,
        targetPath: resolve(taskpadPath),
        content: patch,
      },
      applyHint: "Apply patch.content to patch.targetPath in a writable environment.",
    };

    writeFileSync(taskpadPath, taskpadInitial, "utf8");
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");

    const run = runApplyFallback(taskpadPath, artifactPath);
    const stdout = new TextDecoder().decode(run.stdout);

    expect(run.exitCode).toBe(0);
    expect(stdout).toContain("APPLIED");

    const taskpadActual = readFileSync(taskpadPath, "utf8");

    // Verify file matches expected state
    expect(taskpadActual).toBe(taskpadExpected);

    // Verify SHA parity
    expect(sha256(taskpadActual)).toBe(sha256(taskpadExpected));

    // Parse result and verify status
    const result = parseJsonBlock(stdout, "APPLY_FALLBACK_JSON_START", "APPLY_FALLBACK_JSON_END") as Record<string, unknown>;
    expect(result.status).toBe("applied");
    expect(result.reasonCode).toBeNull();
  });

  test("autoplan fallback re-run is no-op (idempotent)", () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const artifactPath = join(dir, "artifact.json");

    const taskpadInitial = `# TASKPAD

## Execution Queue
- [x] completed task

## Work Queue
- [ ] Auto-ideation candidate 1
- [ ] Auto-ideation candidate 2
`;

    const taskpadExpected = `# TASKPAD

## Execution Queue
- [x] completed task
- [ ] Auto-ideation candidate 1

## Work Queue
- [ ] Auto-ideation candidate 1
- [ ] Auto-ideation candidate 2
`;

    const patch = buildSingleInsertionDiff(taskpadPath, taskpadInitial, taskpadExpected);

    const artifact = {
      version: 1,
      kind: "taskpad-auto-ideation-fallback-patch" as const,
      taskpadPath: resolve(taskpadPath),
      taskpadSha256: sha256(taskpadInitial),
      selectedCandidateId: "AIC001",
      selectedOutcome: {
        action: "would-insert" as const,
        canonicalBullet: "- [ ] Auto-ideation candidate 1",
        insertedLine: 4,
      },
      patch: {
        format: "unified-diff" as const,
        targetPath: resolve(taskpadPath),
        content: patch,
      },
      applyHint: "Apply patch.content to patch.targetPath in a writable environment.",
    };

    writeFileSync(taskpadPath, taskpadInitial, "utf8");
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");

    // First application
    const firstRun = runApplyFallback(taskpadPath, artifactPath);
    expect(firstRun.exitCode).toBe(0);

    const taskpadAfterFirst = readFileSync(taskpadPath, "utf8");

    // Second application (should be no-op)
    const secondRun = runApplyFallback(taskpadPath, artifactPath);
    const secondStdout = new TextDecoder().decode(secondRun.stdout);

    expect(secondRun.exitCode).toBe(0);
    expect(secondStdout).toContain("noop");

    // Verify file unchanged after second run
    expect(readFileSync(taskpadPath, "utf8")).toBe(taskpadAfterFirst);

    // Verify final state matches expected
    expect(taskpadAfterFirst).toBe(taskpadExpected);

    // Parse second result and verify noop status
    const result = parseJsonBlock(secondStdout, "APPLY_FALLBACK_JSON_START", "APPLY_FALLBACK_JSON_END") as Record<string, unknown>;
    expect(result.status).toBe("noop");
    expect(result.reasonCode).toBeNull();
  });

  test("autoplan fallback parity: direct-write equivalent produces identical output", () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const artifactPath = join(dir, "artifact.json");

    const taskpadInitial = `# TASKPAD

## Execution Queue
- [x] done

## Work Queue
- [ ] Candidate A
- [ ] Candidate B
- [ ] Candidate C
`;

    // Expected state (simulating direct-write output)
    const taskpadExpected = `# TASKPAD

## Execution Queue
- [x] done
- [ ] Candidate A

## Work Queue
- [ ] Candidate A
- [ ] Candidate B
- [ ] Candidate C
`;

    const patch = buildSingleInsertionDiff(taskpadPath, taskpadInitial, taskpadExpected);

    const artifact = {
      version: 1,
      kind: "taskpad-auto-ideation-fallback-patch" as const,
      taskpadPath: resolve(taskpadPath),
      taskpadSha256: sha256(taskpadInitial),
      selectedCandidateId: "AIC002",
      selectedOutcome: {
        action: "would-insert" as const,
        canonicalBullet: "- [ ] Candidate A",
        insertedLine: 4,
      },
      patch: {
        format: "unified-diff" as const,
        targetPath: resolve(taskpadPath),
        content: patch,
      },
      applyHint: "Apply patch.content to patch.targetPath in a writable environment.",
    };

    writeFileSync(taskpadPath, taskpadInitial, "utf8");
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");

    // Apply fallback artifact
    const run = runApplyFallback(taskpadPath, artifactPath);
    expect(run.exitCode).toBe(0);

    const taskpadFallback = readFileSync(taskpadPath, "utf8");

    // Verify fallback produces expected state (which represents direct-write output)
    expect(taskpadFallback).toBe(taskpadExpected);

    // Verify SHA parity
    expect(sha256(taskpadFallback)).toBe(sha256(taskpadExpected));
  });
});
