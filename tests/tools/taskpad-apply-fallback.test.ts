import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ErrorCodes, type ApplyFallbackResult } from "../../tools/taskpad-apply-fallback";

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
  const dir = mkdtempSync(join(tmpdir(), "taskpad-apply-fallback-"));
  tempDirs.push(dir);
  return dir;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
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

function writeFallbackArtifact(args: {
  artifactPath: string;
  taskpadPath: string;
  taskpadContent: string;
  nextContent: string;
  canonicalBullet: string;
  insertedLine: number;
  mutate?: (raw: Record<string, unknown>) => Record<string, unknown>;
}): void {
  const raw: Record<string, unknown> = {
    version: 1,
    kind: "taskpad-auto-ideation-fallback-patch",
    taskpadPath: resolve(args.taskpadPath),
    taskpadSha256: sha256(args.taskpadContent),
    selectedCandidateId: "AIC001",
    selectedOutcome: {
      action: "would-insert",
      canonicalBullet: args.canonicalBullet,
      insertedLine: args.insertedLine,
    },
    patch: {
      format: "unified-diff",
      targetPath: resolve(args.taskpadPath),
      content: buildSingleInsertionDiff(args.taskpadPath, args.taskpadContent, args.nextContent),
    },
    applyHint: "Apply patch.content to patch.targetPath in a writable environment.",
  };

  const artifact = args.mutate ? args.mutate(raw) : raw;
  writeFileSync(args.artifactPath, JSON.stringify(artifact, null, 2), "utf8");
}

function parseApplyFallbackJson(stdout: string): ApplyFallbackResult {
  const startMarker = "APPLY_FALLBACK_JSON_START";
  const endMarker = "APPLY_FALLBACK_JSON_END";
  const start = stdout.indexOf(startMarker);
  const end = stdout.indexOf(endMarker);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`taskpad:apply-fallback JSON block not found:\n${stdout}`);
  }

  const json = stdout.slice(start + startMarker.length, end).trim();
  return JSON.parse(json) as ApplyFallbackResult;
}

interface AutoIdeationJsonResult {
  status: "seeded" | "deduped" | "noop" | "fallback";
  preflight: {
    mode: "direct-write" | "fallback-artifact" | "error";
    writable: boolean;
    reasonCode: string;
  } | null;
  artifactPath: string | null;
}

function parseAutoIdeationJson(stdout: string): AutoIdeationJsonResult {
  const startMarker = "AUTO_IDEATION_JSON_START";
  const endMarker = "AUTO_IDEATION_JSON_END";
  const start = stdout.indexOf(startMarker);
  const end = stdout.indexOf(endMarker);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`taskpad:auto-ideation JSON block not found:\n${stdout}`);
  }

  const json = stdout.slice(start + startMarker.length, end).trim();
  return JSON.parse(json) as AutoIdeationJsonResult;
}

function runAutoIdeation(taskpadPath: string, planPath: string) {
  return Bun.spawnSync(["bun", "run", "taskpad:auto-ideation", "--", "--taskpad", taskpadPath, "--plan", planPath], {
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function runApplyFallback(taskpadPath: string, artifactPath: string) {
  return Bun.spawnSync(
    [
      "bun",
      "run",
      "taskpad:apply-fallback",
      "--",
      "--taskpad",
      taskpadPath,
      "--artifact",
      artifactPath,
    ],
    {
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

function buildPlanMarkdown(): string {
  return `# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-02-28): Writable-path preflight gate for deterministic TASKPAD mutation routing

### Distilled Scope
- Add deterministic writable-path preflight probe and route intake mutation mode from preflight state.

### Task Graph
- [ ] **TP001**: First active task

### Verification Commands

bun run typecheck
`;
}

describe("taskpad:apply-fallback focused behavior", () => {
  test("apply success: applies valid fallback artifact exactly once", () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const artifactPath = join(dir, "artifact.json");

    const before = "# TASKPAD\n\n## Self-Improvement Backlog\n";
    const bullet = "- [ ] planned-2026-02-28 add deterministic ranking fixtures";
    const after = `${before}${bullet}\n`;

    writeFileSync(taskpadPath, before, "utf8");
    writeFallbackArtifact({
      artifactPath,
      taskpadPath,
      taskpadContent: before,
      nextContent: after,
      canonicalBullet: bullet,
      insertedLine: 4,
    });

    const run = runApplyFallback(taskpadPath, artifactPath);
    const stdout = new TextDecoder().decode(run.stdout);
    const result = parseApplyFallbackJson(stdout);

    expect(run.exitCode).toBe(0);
    expect(result.status).toBe("applied");
    expect(result.reasonCode).toBeNull();
    expect(readFileSync(taskpadPath, "utf8")).toBe(after);
  });

  test("read-only recovery smoke path: auto-ideation fallback artifact applies cleanly and re-run exits noop", () => {
    const dir = makeTempDir();
    const lockedParentDir = join(dir, "locked-parent");
    const taskpadPath = join(lockedParentDir, "TASKPAD.md");
    const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

    mkdirSync(lockedParentDir, { recursive: true });

    const before = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

    writeFileSync(taskpadPath, before, "utf8");
    writeFileSync(planPath, buildPlanMarkdown(), "utf8");

    chmodSync(lockedParentDir, 0o555);
    const autoIdeationRun = runAutoIdeation(taskpadPath, planPath);
    chmodSync(lockedParentDir, 0o755);

    expect(autoIdeationRun.exitCode).toBe(0);

    const autoIdeationResult = parseAutoIdeationJson(new TextDecoder().decode(autoIdeationRun.stdout));
    expect(autoIdeationResult.status).toBe("fallback");
    expect(autoIdeationResult.preflight).not.toBeNull();
    expect(autoIdeationResult.preflight?.mode).toBe("fallback-artifact");
    expect(autoIdeationResult.preflight?.writable).toBe(false);
    expect(autoIdeationResult.preflight?.reasonCode).toMatch(/^PRECHECK_PERMISSION_/);
    expect(autoIdeationResult.artifactPath).not.toBeNull();
    expect(readFileSync(taskpadPath, "utf8")).toBe(before);

    const applyRun = runApplyFallback(taskpadPath, autoIdeationResult.artifactPath!);
    const applyResult = parseApplyFallbackJson(new TextDecoder().decode(applyRun.stdout));

    expect(applyRun.exitCode).toBe(0);
    expect(applyResult.status).toBe("applied");
    expect(applyResult.reasonCode).toBeNull();

    const updated = readFileSync(taskpadPath, "utf8");
    expect(updated).not.toBe(before);
    expect(updated).toMatch(/- \[ \] planned-\d{4}-\d{2}-\d{2} add deterministic ranking fixtures/);

    const applyRerun = runApplyFallback(taskpadPath, autoIdeationResult.artifactPath!);
    const applyRerunResult = parseApplyFallbackJson(new TextDecoder().decode(applyRerun.stdout));

    expect(applyRerun.exitCode).toBe(0);
    expect(applyRerunResult.status).toBe("noop");
    expect(applyRerunResult.reasonCode).toBeNull();
    expect(readFileSync(taskpadPath, "utf8")).toBe(updated);
  });

  test("mismatch rejection: rejects stale artifact when TASKPAD hash changed", () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const artifactPath = join(dir, "artifact.json");

    const before = "# TASKPAD\n\n## Self-Improvement Backlog\n";
    const bullet = "- [ ] planned-2026-02-28 add deterministic ranking fixtures";
    const after = `${before}${bullet}\n`;

    writeFileSync(taskpadPath, before, "utf8");
    writeFallbackArtifact({
      artifactPath,
      taskpadPath,
      taskpadContent: before,
      nextContent: after,
      canonicalBullet: bullet,
      insertedLine: 4,
    });

    // Simulate drift after artifact generation.
    writeFileSync(taskpadPath, `${before}- [ ] manually added drift item\n`, "utf8");

    const run = runApplyFallback(taskpadPath, artifactPath);
    const stdout = new TextDecoder().decode(run.stdout);
    const result = parseApplyFallbackJson(stdout);

    expect(run.exitCode).toBe(1);
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe(ErrorCodes.ERR_TASKPAD_HASH_MISMATCH);
  });

  test("path mismatch rejection: rejects artifact when patch target path diverges from --taskpad", () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const artifactPath = join(dir, "artifact.json");
    const otherTaskpadPath = join(dir, "OTHER-TASKPAD.md");

    const before = "# TASKPAD\n\n## Self-Improvement Backlog\n";
    const bullet = "- [ ] planned-2026-02-28 add deterministic ranking fixtures";
    const after = `${before}${bullet}\n`;

    writeFileSync(taskpadPath, before, "utf8");
    writeFallbackArtifact({
      artifactPath,
      taskpadPath,
      taskpadContent: before,
      nextContent: after,
      canonicalBullet: bullet,
      insertedLine: 4,
      mutate: (raw) => ({
        ...raw,
        patch: {
          ...(raw.patch as Record<string, unknown>),
          targetPath: resolve(otherTaskpadPath),
        },
      }),
    });

    const run = runApplyFallback(taskpadPath, artifactPath);
    const stdout = new TextDecoder().decode(run.stdout);
    const result = parseApplyFallbackJson(stdout);

    expect(run.exitCode).toBe(1);
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe(ErrorCodes.ERR_TASKPAD_PATH_MISMATCH);
    expect(readFileSync(taskpadPath, "utf8")).toBe(before);
  });

  test("malformed artifact rejection: rejects invalid artifact schema", () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const artifactPath = join(dir, "artifact.json");

    const before = "# TASKPAD\n\n## Self-Improvement Backlog\n";
    const bullet = "- [ ] planned-2026-02-28 add deterministic ranking fixtures";
    const after = `${before}${bullet}\n`;

    writeFileSync(taskpadPath, before, "utf8");
    writeFallbackArtifact({
      artifactPath,
      taskpadPath,
      taskpadContent: before,
      nextContent: after,
      canonicalBullet: bullet,
      insertedLine: 4,
      mutate: (raw) => ({
        ...raw,
        selectedOutcome: {
          action: "would-insert",
          insertedLine: 4,
          // missing canonicalBullet on purpose
        },
      }),
    });

    const run = runApplyFallback(taskpadPath, artifactPath);
    const stdout = new TextDecoder().decode(run.stdout);
    const result = parseApplyFallbackJson(stdout);

    expect(run.exitCode).toBe(1);
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe(ErrorCodes.ERR_ARTIFACT_SCHEMA);
  });

  test("idempotent re-run: second run returns noop without mutating content", () => {
    const dir = makeTempDir();
    const taskpadPath = join(dir, "TASKPAD.md");
    const artifactPath = join(dir, "artifact.json");

    const before = "# TASKPAD\n\n## Self-Improvement Backlog\n";
    const bullet = "- [ ] planned-2026-02-28 add deterministic ranking fixtures";
    const after = `${before}${bullet}\n`;

    writeFileSync(taskpadPath, before, "utf8");
    writeFallbackArtifact({
      artifactPath,
      taskpadPath,
      taskpadContent: before,
      nextContent: after,
      canonicalBullet: bullet,
      insertedLine: 4,
    });

    const firstRun = runApplyFallback(taskpadPath, artifactPath);
    const firstResult = parseApplyFallbackJson(new TextDecoder().decode(firstRun.stdout));
    expect(firstRun.exitCode).toBe(0);
    expect(firstResult.status).toBe("applied");

    const contentAfterFirstRun = readFileSync(taskpadPath, "utf8");

    const secondRun = runApplyFallback(taskpadPath, artifactPath);
    const secondResult = parseApplyFallbackJson(new TextDecoder().decode(secondRun.stdout));

    expect(secondRun.exitCode).toBe(0);
    expect(secondResult.status).toBe("noop");
    expect(secondResult.reasonCode).toBeNull();
    expect(readFileSync(taskpadPath, "utf8")).toBe(contentAfterFirstRun);
  });

  describe("plan-seed artifact (dual-file patches)", () => {
    function runApplyFallbackWithPlan(taskpadPath: string, planPath: string, artifactPath: string) {
      return Bun.spawnSync(
        [
          "bun",
          "run",
          "taskpad:apply-fallback",
          "--",
          "--taskpad",
          taskpadPath,
          "--plan",
          planPath,
          "--artifact",
          artifactPath,
        ],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
    }

    function buildUnifiedDiff(original: string, updated: string, targetPath: string): string {
      const oldLines = splitMarkdownLines(original);
      const newLines = splitMarkdownLines(updated);
      const portablePath = resolve(targetPath).replace(/\\/g, "/");

      const body = [...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`)].join("\n");

      return [
        `--- a/${portablePath}`,
        `+++ b/${portablePath}`,
        `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
        body,
        "",
      ].join("\n");
    }

    function writePlanSeedFallbackArtifact(args: {
      artifactPath: string;
      taskpadPath: string;
      planPath: string;
      taskpadOriginal: string;
      planOriginal: string;
      taskpadUpdated: string;
      planUpdated: string;
    }): void {
      const raw: Record<string, unknown> = {
        version: 1,
        kind: "taskpad-plan-seed-fallback-patch",
        taskpadPath: resolve(args.taskpadPath),
        planPath: resolve(args.planPath),
        taskpadSha256: sha256(args.taskpadOriginal),
        planSha256: sha256(args.planOriginal),
        mutationId: "plan-seed-test-2026-03-01",
        mutationOutcome: {
          action: "would-insert-plan",
          taskpadUpdatedLine: "- [x] planned-2026-03-01 test task",
          planInsertHeading: "## TASKPAD Intake Slice (2026-03-01): Test Theme (taskpad:plan-seed)",
          selectedBacklogLine: 3,
        },
        patch: {
          format: "unified-diff",
          taskpadTargetPath: resolve(args.taskpadPath),
          planTargetPath: resolve(args.planPath),
          taskpadPatchContent: args.taskpadOriginal !== args.taskpadUpdated
            ? buildUnifiedDiff(args.taskpadOriginal, args.taskpadUpdated, args.taskpadPath)
            : null,
          planPatchContent: args.planOriginal !== args.planUpdated
            ? buildUnifiedDiff(args.planOriginal, args.planUpdated, args.planPath)
            : null,
        },
        applyHint: "Apply both TASKPAD and IMPLEMENTATION_PLAN patches atomically.",
      };

      writeFileSync(args.artifactPath, JSON.stringify(raw, null, 2), "utf8");
    }

    test("applies plan-seed artifact with both taskpad and plan patches", () => {
      const dir = makeTempDir();
      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");
      const artifactPath = join(dir, "artifact.json");

      const taskpadOriginal = "# TASKPAD\n\n## Self-Improvement Backlog\n- [ ] test task\n";
      const taskpadUpdated = "# TASKPAD\n\n## Self-Improvement Backlog\n- [x] planned-2026-03-01 test task\n";

      const planOriginal = "# Implementation Plan\n\n## Legacy Slices\n- [ ] old task\n";
      const planUpdated = "# Implementation Plan\n\n## TASKPAD Intake Slice (2026-03-01): Test Theme (taskpad:plan-seed)\n\n### Distilled Scope\nTest scope.\n\n### Task Graph\n- [ ] TP001: First task\n\n---\n\n## Legacy Slices\n- [ ] old task\n";

      writeFileSync(taskpadPath, taskpadOriginal, "utf8");
      writeFileSync(planPath, planOriginal, "utf8");

      writePlanSeedFallbackArtifact({
        artifactPath,
        taskpadPath,
        planPath,
        taskpadOriginal,
        planOriginal,
        taskpadUpdated,
        planUpdated,
      });

      const run = runApplyFallbackWithPlan(taskpadPath, planPath, artifactPath);
      const stdout = new TextDecoder().decode(run.stdout);
      const result = parseApplyFallbackJson(stdout);

      expect(run.exitCode).toBe(0);
      expect(result.status).toBe("applied");
      expect(result.reasonCode).toBeNull();
      expect(readFileSync(taskpadPath, "utf8")).toBe(taskpadUpdated);
      expect(readFileSync(planPath, "utf8")).toBe(planUpdated);
      expect(result.message).toContain("TASKPAD");
      expect(result.message).toContain("IMPLEMENTATION_PLAN");
    });

    test("idempotent re-run: re-applying same artifact doesn't corrupt files", () => {
      const dir = makeTempDir();
      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");
      const artifactPath = join(dir, "artifact.json");

      const taskpadOriginal = "# TASKPAD\n\n## Self-Improvement Backlog\n- [ ] test task\n";
      const taskpadUpdated = "# TASKPAD\n\n## Self-Improvement Backlog\n- [x] planned-2026-03-01 test task\n";

      const planOriginal = "# Implementation Plan\n\n## Legacy Slices\n- [ ] old task\n";
      const planUpdated = "# Implementation Plan\n\n## TASKPAD Intake Slice (2026-03-01): Test Theme (taskpad:plan-seed)\n\n### Distilled Scope\nTest scope.\n\n### Task Graph\n- [ ] TP001: First task\n\n---\n\n## Legacy Slices\n- [ ] old task\n";

      writeFileSync(taskpadPath, taskpadOriginal, "utf8");
      writeFileSync(planPath, planOriginal, "utf8");

      writePlanSeedFallbackArtifact({
        artifactPath,
        taskpadPath,
        planPath,
        taskpadOriginal,
        planOriginal,
        taskpadUpdated,
        planUpdated,
      });

      const firstRun = runApplyFallbackWithPlan(taskpadPath, planPath, artifactPath);
      const firstResult = parseApplyFallbackJson(new TextDecoder().decode(firstRun.stdout));
      expect(firstRun.exitCode).toBe(0);
      expect(firstResult.status).toBe("applied");

      const taskpadAfterFirstRun = readFileSync(taskpadPath, "utf8");
      const planAfterFirstRun = readFileSync(planPath, "utf8");

      // Re-running the same artifact after files are modified will fail with hash mismatch
      // but should NOT corrupt the files
      const secondRun = runApplyFallbackWithPlan(taskpadPath, planPath, artifactPath);
      const secondResult = parseApplyFallbackJson(new TextDecoder().decode(secondRun.stdout));

      // Second run should fail (hash mismatch) but files should remain unchanged
      expect(secondRun.exitCode).toBe(1);
      expect(secondResult.status).toBe("rejected");
      expect(readFileSync(taskpadPath, "utf8")).toBe(taskpadAfterFirstRun);
      expect(readFileSync(planPath, "utf8")).toBe(planAfterFirstRun);
    });

    test("rejects plan-seed artifact when plan hash mismatch", () => {
      const dir = makeTempDir();
      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");
      const artifactPath = join(dir, "artifact.json");

      const taskpadOriginal = "# TASKPAD\n\n## Self-Improvement Backlog\n- [ ] test task\n";
      const taskpadUpdated = "# TASKPAD\n\n## Self-Improvement Backlog\n- [x] planned-2026-03-01 test task\n";

      const planOriginal = "# Implementation Plan\n\n## Legacy Slices\n- [ ] old task\n";
      const planUpdated = "# Implementation Plan\n\n## TASKPAD Intake Slice (2026-03-01): Test Theme (taskpad:plan-seed)\n\n### Distilled Scope\nTest scope.\n\n### Task Graph\n- [ ] TP001: First task\n\n---\n\n## Legacy Slices\n- [ ] old task\n";

      writeFileSync(taskpadPath, taskpadOriginal, "utf8");
      writeFileSync(planPath, planOriginal, "utf8");

      writePlanSeedFallbackArtifact({
        artifactPath,
        taskpadPath,
        planPath,
        taskpadOriginal,
        planOriginal,
        taskpadUpdated,
        planUpdated,
      });

      // Simulate drift in plan after artifact generation
      writeFileSync(planPath, "# Implementation Plan\n\n## Legacy Slices\n- [ ] drifted task\n", "utf8");

      const run = runApplyFallbackWithPlan(taskpadPath, planPath, artifactPath);
      const stdout = new TextDecoder().decode(run.stdout);
      const result = parseApplyFallbackJson(stdout);

      expect(run.exitCode).toBe(1);
      expect(result.status).toBe("rejected");
      expect(result.reasonCode).toBe(ErrorCodes.ERR_TASKPAD_HASH_MISMATCH);
      // Taskpad should not be modified when plan hash mismatches
      expect(readFileSync(taskpadPath, "utf8")).toBe(taskpadOriginal);
    });

    test("rejects plan-seed artifact when --plan argument missing but plan patch exists", () => {
      const dir = makeTempDir();
      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");
      const artifactPath = join(dir, "artifact.json");

      const taskpadOriginal = "# TASKPAD\n\n## Self-Improvement Backlog\n- [ ] test task\n";
      const taskpadUpdated = "# TASKPAD\n\n## Self-Improvement Backlog\n- [x] planned-2026-03-01 test task\n";

      const planOriginal = "# Implementation Plan\n\n## Legacy Slices\n- [ ] old task\n";
      const planUpdated = "# Implementation Plan\n\n## TASKPAD Intake Slice (2026-03-01): Test Theme (taskpad:plan-seed)\n\n### Distilled Scope\nTest scope.\n\n### Task Graph\n- [ ] TP001: First task\n\n---\n\n## Legacy Slices\n- [ ] old task\n";

      writeFileSync(taskpadPath, taskpadOriginal, "utf8");
      writeFileSync(planPath, planOriginal, "utf8");

      writePlanSeedFallbackArtifact({
        artifactPath,
        taskpadPath,
        planPath,
        taskpadOriginal,
        planOriginal,
        taskpadUpdated,
        planUpdated,
      });

      // Run without --plan argument
      const run = runApplyFallback(taskpadPath, artifactPath);
      const stdout = new TextDecoder().decode(run.stdout);
      const result = parseApplyFallbackJson(stdout);

      expect(run.exitCode).toBe(1);
      expect(result.status).toBe("rejected");
      expect(result.reasonCode).toBe(ErrorCodes.ERR_TASKPAD_PATH_MISMATCH);
      expect(result.message).toContain("--plan");
    });
  });
});
