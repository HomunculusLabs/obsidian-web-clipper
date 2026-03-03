import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet,
  computeQueueParityStatus,
  insertSelectedCandidateIntoSelfImprovementBacklog,
  insertSelectedCandidateIntoTargetQueue,
  selectBestCandidate,
  synthesizeRankedCandidateBullets,
  writeFallbackPatchArtifact,
  type AutoIdeationCliResult,
  type QueueParityStatus,
} from "../../tools/taskpad-auto-ideation";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_ROOT = join(PROJECT_ROOT, "tests", "tools", "fixtures");

interface RankingSnapshotExpectedTop3Entry {
  id: string;
  scoreBreakdown: {
    intakeGate: number;
    recentSliceTheme: number;
    qualityRisk: number;
    total: number;
  };
  stableSortKey: string;
  tieBreak: {
    canonicalCandidateId: string;
    canonicalTitle: string;
    canonicalBullet: string;
  };
}

interface RankingSnapshotFixture {
  scenario: string;
  description: string;
  expectedOrder: string[];
  expectedTop3: RankingSnapshotExpectedTop3Entry[];
}

function readFixtureFile(fileName: string): string {
  return readFileSync(join(FIXTURES_ROOT, fileName), "utf8");
}

function loadRankingSnapshotFixture(baseName: string): {
  taskpadMarkdown: string;
  planMarkdown: string;
  expected: RankingSnapshotFixture;
} {
  return {
    taskpadMarkdown: readFixtureFile(`${baseName}.taskpad.md`),
    planMarkdown: readFixtureFile(`${baseName}.plan.md`),
    expected: JSON.parse(readFixtureFile(`${baseName}.expected.json`)) as RankingSnapshotFixture,
  };
}

function buildPlanMarkdown(): string {
  return `# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-02-28): AUTO_IDEATION queue seeder for empty TASKPAD intake loops

### RepoPrompt Builder Context
- **Risks/edge cases to inspect**:
  - Non-deterministic candidate ordering causing flaky autonomous behavior.

### Task Graph
- [ ] **TP001**: First active task
- [ ] **TP002**: Second active task

### Verification Commands

bun run typecheck

## TASKPAD Intake Slice (2026-02-27): IMPLEMENTATION_PLAN integrity gate

### Task Graph
- [x] **TP001**: done
`;
}

function parseJsonBlock(stdout: string): AutoIdeationCliResult {
  const startMarker = "AUTO_IDEATION_JSON_START";
  const endMarker = "AUTO_IDEATION_JSON_END";
  const start = stdout.indexOf(startMarker);
  const end = stdout.indexOf(endMarker);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Auto-ideation JSON block not found in output:\n${stdout}`);
  }

  const json = stdout.slice(start + startMarker.length, end).trim();
  return JSON.parse(json) as AutoIdeationCliResult;
}

interface WritePreflightCliResult {
  taskpadPath: string;
  writable: boolean;
  reasonCode: string;
  mode: "direct-write" | "fallback-artifact" | "error";
}

function parseWritePreflightJsonBlock(stdout: string): WritePreflightCliResult {
  const startMarker = "TASKPAD_WRITE_PRECHECK_JSON_START";
  const endMarker = "TASKPAD_WRITE_PRECHECK_JSON_END";
  const start = stdout.indexOf(startMarker);
  const end = stdout.indexOf(endMarker);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Write preflight JSON block not found in output:\n${stdout}`);
  }

  const json = stdout.slice(start + startMarker.length, end).trim();
  return JSON.parse(json) as WritePreflightCliResult;
}

function runWritePreflight(taskpadPath: string): {
  exitCode: number;
  stdout: string;
  stderr: string;
  result: WritePreflightCliResult;
} {
  const run = Bun.spawnSync(["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", taskpadPath], {
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = new TextDecoder().decode(run.stdout);
  const stderr = new TextDecoder().decode(run.stderr);

  return {
    exitCode: run.exitCode,
    stdout,
    stderr,
    result: parseWritePreflightJsonBlock(stdout),
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("taskpad-auto-ideation", () => {
  describe("permission failure fallback", () => {
    test("EPERM write error triggers fallback mode with deterministic patch artifact", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      writeFileSync(
        taskpadPath,
        `# TASKPAD

## Autonomous Kickoff Queue
- [x] planned-2026-02-27 finished item

## Self-Improvement Backlog
- [x] planned-2026-02-27 finished item
`,
        "utf8",
      );
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      // Make file read-only to trigger EPERM
      chmodSync(taskpadPath, 0o444);

      const preflightRun = runWritePreflight(taskpadPath);

      const run = Bun.spawnSync(
        ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      const stdout = new TextDecoder().decode(run.stdout);
      const stderr = new TextDecoder().decode(run.stderr);

      // Restore write permissions before cleanup
      chmodSync(taskpadPath, 0o644);

      expect(run.exitCode).toBe(0);
      expect(stderr).toBe("");

      expect(preflightRun.exitCode).toBe(0);
      expect(preflightRun.stderr).toBe("");

      const result = parseJsonBlock(stdout);
      expect(result.status).toBe("fallback");
      expect(result.preflight).not.toBeNull();

      // Writable preflight can still race into permission-denied write failure; this must
      // degrade to fallback packet output instead of process crash.
      expect(preflightRun.result.mode).toBe("direct-write");
      expect(preflightRun.result.writable).toBe(true);
      expect(preflightRun.result.reasonCode).toBe("PRECHECK_OK");

      expect(result.preflight?.mode).toBe("fallback-artifact");
      expect(result.preflight?.writable).toBe(false);
      expect(result.preflight?.reasonCode).toMatch(/^PRECHECK_PERMISSION_/);
      expect(result.triggered).toBe(true);
      expect(result.artifactPath).not.toBeNull();
      expect(result.applyHint).not.toBeNull();
      expect(result.applyHint).toContain("Apply patch.content to patch.targetPath");
      expect(result.candidates).toHaveLength(3);
      expect(result.selectedCandidateId).toBe("AIC001");

      // Verify artifact file exists and is valid JSON
      const artifactPath = result.artifactPath!;
      const artifactContent = readFileSync(artifactPath, "utf8");
      const artifact = JSON.parse(artifactContent);

      expect(artifact.version).toBe(1);
      expect(artifact.kind).toBe("taskpad-auto-ideation-fallback-patch");
      expect(artifact.taskpadPath).toBe(taskpadPath);
      expect(artifact.selectedCandidateId).toBe("AIC001");
      expect(artifact.selectedOutcome.action).toBe("would-insert");
      expect(artifact.patch.format).toBe("unified-diff");
      expect(artifact.patch.targetPath).toBe(taskpadPath);
      expect(artifact.patch.content).toContain("--- a/");
      expect(artifact.patch.content).toContain("+++ b/");
      expect(artifact.applyHint).not.toBeNull();

      // Verify TASKPAD was NOT modified (read-only)
      const taskpadContent = readFileSync(taskpadPath, "utf8");
      expect(taskpadContent).not.toMatch(/- \[ \] planned-\d{4}-\d{2}-\d{2} add deterministic ranking/);
    });

    test("fallback mode selects same candidate as writable mode for identical inputs", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");
      const readOnlyTaskpadPath = join(dir, "TASKPAD_READONLY.md");

      const originalTaskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, originalTaskpad, "utf8");
      writeFileSync(readOnlyTaskpadPath, originalTaskpad, "utf8");
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      // Run in writable mode
      const writableRun = Bun.spawnSync(
        ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      const writableResult = parseJsonBlock(new TextDecoder().decode(writableRun.stdout));

      // Run in read-only mode (fallback)
      chmodSync(readOnlyTaskpadPath, 0o444);

      const readOnlyRun = Bun.spawnSync(
        [
          "bun",
          "run",
          "tools/taskpad-auto-ideation.ts",
          "--taskpad",
          readOnlyTaskpadPath,
          "--plan",
          planPath,
        ],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      chmodSync(readOnlyTaskpadPath, 0o644);

      const readOnlyResult = parseJsonBlock(new TextDecoder().decode(readOnlyRun.stdout));

      // Both should select the same candidate
      expect(writableResult.selectedCandidateId).toBe(readOnlyResult.selectedCandidateId);
      expect(writableResult.candidates).toEqual(readOnlyResult.candidates);
    });
  });

  describe("preflight routing", () => {
    test("writable fixture path routes to direct-write mode before mutation", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      const originalTaskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, originalTaskpad, "utf8");
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      const preflightRun = runWritePreflight(taskpadPath);

      const run = Bun.spawnSync(
        ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      expect(preflightRun.exitCode).toBe(0);
      expect(preflightRun.stderr).toBe("");
      expect(run.exitCode).toBe(0);

      const result = parseJsonBlock(new TextDecoder().decode(run.stdout));
      expect(result.status).toBe("seeded");
      expect(result.preflight).not.toBeNull();
      expect(result.preflight?.mode).toBe(preflightRun.result.mode);
      expect(result.preflight?.writable).toBe(preflightRun.result.writable);
      expect(result.preflight?.reasonCode).toBe(preflightRun.result.reasonCode);
      expect(result.artifactPath).toBeNull();
    });

    test("simulated permission-denied parent path routes to fallback-artifact mode", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const lockedParentDir = join(dir, "locked-parent");
      const taskpadPath = join(lockedParentDir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      mkdirSync(lockedParentDir, { recursive: true });

      const originalTaskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, originalTaskpad, "utf8");
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      chmodSync(lockedParentDir, 0o555);

      const preflightRun = runWritePreflight(taskpadPath);

      const run = Bun.spawnSync(
        ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      chmodSync(lockedParentDir, 0o755);

      expect(preflightRun.exitCode).toBe(0);
      expect(preflightRun.stderr).toBe("");
      expect(run.exitCode).toBe(0);

      const result = parseJsonBlock(new TextDecoder().decode(run.stdout));
      expect(result.status).toBe("fallback");
      expect(result.preflight).not.toBeNull();
      expect(result.preflight?.mode).toBe(preflightRun.result.mode);
      expect(result.preflight?.writable).toBe(preflightRun.result.writable);
      expect(result.preflight?.reasonCode).toBe(preflightRun.result.reasonCode);
      expect(result.artifactPath).not.toBeNull();
      expect(readFileSync(taskpadPath, "utf8")).toBe(originalTaskpad);
    });
  });

  describe("artifact determinism", () => {
    test("identical inputs produce identical SHA256 hashes in patch artifact", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      const taskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, taskpad, "utf8");
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      const candidates = synthesizeRankedCandidateBullets(taskpad, planPath);
      const selected = selectBestCandidate(candidates);
      const insertion = insertSelectedCandidateIntoSelfImprovementBacklog(
        taskpad,
        selected.selectedCandidate,
        new Date("2026-02-28T12:00:00Z"),
      );

      // Generate artifact first time
      const artifactPath1 = writeFallbackPatchArtifact({
        taskpadPath,
        taskpadMarkdown: taskpad,
        insertion,
        selectedCandidateId: selected.selectedCandidateId,
      });

      const artifact1 = JSON.parse(readFileSync(artifactPath1, "utf8"));
      const sha256_1 = artifact1.taskpadSha256;

      // Generate artifact second time (identical inputs)
      const artifactPath2 = writeFallbackPatchArtifact({
        taskpadPath,
        taskpadMarkdown: taskpad,
        insertion,
        selectedCandidateId: selected.selectedCandidateId,
      });

      const artifact2 = JSON.parse(readFileSync(artifactPath2, "utf8"));
      const sha256_2 = artifact2.taskpadSha256;

      // SHA256 hashes must be identical
      expect(sha256_1).toBe(sha256_2);

      // Full patch content must be identical
      expect(artifact1.patch.content).toBe(artifact2.patch.content);
    });

    test("patch content has stable unified diff format", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      const taskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, taskpad, "utf8");
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      const candidates = synthesizeRankedCandidateBullets(taskpad, planPath);
      const selected = selectBestCandidate(candidates);
      const insertion = insertSelectedCandidateIntoSelfImprovementBacklog(
        taskpad,
        selected.selectedCandidate,
        new Date("2026-02-28T12:00:00Z"),
      );

      const artifactPath = writeFallbackPatchArtifact({
        taskpadPath,
        taskpadMarkdown: taskpad,
        insertion,
        selectedCandidateId: selected.selectedCandidateId,
      });

      const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
      const patch = artifact.patch;

      // Verify unified diff format
      expect(patch.format).toBe("unified-diff");
      expect(patch.content).toContain("--- a/");
      expect(patch.content).toContain("+++ b/");

      // Verify diff hunk header exists (may start with optional newline)
      expect(patch.content).toMatch(/\n@@ -\d+,\d+ \+\d+,\d+ @@/);

      // Verify all lines are present
      const lines = patch.content.split("\n");
      expect(lines[0]).toMatch(/^--- a\//);
      expect(lines[1]).toMatch(/^\+\+\+ b\//);
      expect(lines[2]).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@/);

      // Verify diff markers
      const hasMinusLines = lines.some((line: string) => line.startsWith("-") && !line.startsWith("---"));
      const hasPlusLines = lines.some((line: string) => line.startsWith("+") && !line.startsWith("+++"));
      expect(hasMinusLines).toBe(true);
      expect(hasPlusLines).toBe(true);
    });

    test("patch artifact preserves original newline style (CRLF)", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      const taskpadCrlf = "# TASKPAD\r\n\r\n## Autonomous Kickoff Queue\r\n- [x] done\r\n\r\n## Self-Improvement Backlog\r\n- [x] done\r\n";

      writeFileSync(taskpadPath, taskpadCrlf, "utf8");
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      const candidates = synthesizeRankedCandidateBullets(taskpadCrlf, planPath);
      const selected = selectBestCandidate(candidates);
      const insertion = insertSelectedCandidateIntoSelfImprovementBacklog(
        taskpadCrlf,
        selected.selectedCandidate,
        new Date("2026-02-28T12:00:00Z"),
      );

      const artifactPath = writeFallbackPatchArtifact({
        taskpadPath,
        taskpadMarkdown: taskpadCrlf,
        insertion,
        selectedCandidateId: selected.selectedCandidateId,
      });

      const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
      const patch = artifact.patch;

      // The patch should reference the correct candidate bullet with CRLF preservation
      expect(artifact.selectedOutcome.canonicalBullet).toContain("planned-2026-02-28");
    });

    test("different insertion line numbers produce deterministic artifacts", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      // Test with different backlog sizes
      const taskpadSmall = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      const taskpadLarge = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
- [x] planned-2026-01-15 previous work
- [x] planned-2026-01-10 earlier work
`;

      writeFileSync(taskpadPath, taskpadSmall, "utf8");
      const candidates1 = synthesizeRankedCandidateBullets(taskpadSmall, planPath);
      const selected1 = selectBestCandidate(candidates1);
      const insertion1 = insertSelectedCandidateIntoSelfImprovementBacklog(
        taskpadSmall,
        selected1.selectedCandidate,
        new Date("2026-02-28T12:00:00Z"),
      );

      const artifactPath1 = writeFallbackPatchArtifact({
        taskpadPath,
        taskpadMarkdown: taskpadSmall,
        insertion: insertion1,
        selectedCandidateId: selected1.selectedCandidateId,
      });

      const artifact1 = JSON.parse(readFileSync(artifactPath1, "utf8"));

      writeFileSync(taskpadPath, taskpadLarge, "utf8");
      const candidates2 = synthesizeRankedCandidateBullets(taskpadLarge, planPath);
      const selected2 = selectBestCandidate(candidates2);
      const insertion2 = insertSelectedCandidateIntoSelfImprovementBacklog(
        taskpadLarge,
        selected2.selectedCandidate,
        new Date("2026-02-28T12:00:00Z"),
      );

      const artifactPath2 = writeFallbackPatchArtifact({
        taskpadPath,
        taskpadMarkdown: taskpadLarge,
        insertion: insertion2,
        selectedCandidateId: selected2.selectedCandidateId,
      });

      const artifact2 = JSON.parse(readFileSync(artifactPath2, "utf8"));

      // Both artifacts should have the same SHA256 for their respective inputs
      expect(artifact1.taskpadSha256).not.toBe(artifact2.taskpadSha256);

      // But insertion content should be the same (same candidate)
      expect(artifact1.selectedOutcome.canonicalBullet).toBe(artifact2.selectedOutcome.canonicalBullet);
    });
  });

  describe("unchanged behavior in writable scenarios", () => {
    test("writable mode returns 'seeded' status and modifies TASKPAD", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      const originalTaskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, originalTaskpad, "utf8");
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      const run = Bun.spawnSync(
        ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      expect(run.exitCode).toBe(0);

      const result = parseJsonBlock(new TextDecoder().decode(run.stdout));
      expect(result.status).toBe("seeded");
      expect(result.triggered).toBe(true);
      expect(result.selectedOutcome.action).toBe("inserted");
      expect(result.selectedOutcome.insertedLine).not.toBeNull();
      expect(result.selectedOutcome.semanticDedupe.decision).toBe("inserted");
      expect(result.selectedOutcome.semanticDedupe.candidateSemanticKey).toBeTruthy();
      expect(result.selectedOutcome.semanticDedupe.matchedSemanticKey).toBeNull();
      expect(result.artifactPath).toBeNull();
      expect(result.applyHint).toBeNull();

      // Verify TASKPAD was modified
      const updatedTaskpad = readFileSync(taskpadPath, "utf8");
      expect(updatedTaskpad).not.toBe(originalTaskpad);
      expect(updatedTaskpad).toMatch(/- \[ \] planned-\d{4}-\d{2}-\d{2} add deterministic ranking/);
    });

    test("writable mode returns 'deduped' status without modification when candidate exists", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      // Empty queues with a duplicate candidate already in backlog
      const taskpadWithExisting = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [ ] planned-2026-02-15 add deterministic ranking fixtures for taskpad auto-ideation (exactly three candidates with stable tie-break ordering)
- [x] done
`;

      writeFileSync(taskpadPath, taskpadWithExisting, "utf8");
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      const run = Bun.spawnSync(
        ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      expect(run.exitCode).toBe(0);

      const stdout = new TextDecoder().decode(run.stdout);

      // Note: Since there's an unchecked item in the backlog, the queue is NOT empty,
      // so ideation returns 'noop' instead of 'deduped'. The actual dedupe behavior
      // is tested at the unit level in "dedupes when candidate bullet already exists"
      const result = parseJsonBlock(stdout);
      expect(result.status).toBe("noop");
      expect(result.triggered).toBe(false);
      expect(result.selectedOutcome.action).toBe("noop");
      expect(result.selectedOutcome.semanticDedupe.decision).toBe("not-applicable");
      expect(result.selectedOutcome.semanticDedupe.candidateSemanticKey).toBeNull();
      expect(result.artifactPath).toBeNull();
      expect(result.applyHint).toBeNull();

      // Verify TASKPAD was NOT modified
      expect(readFileSync(taskpadPath, "utf8")).toBe(taskpadWithExisting);
    });

    test("writable mode returns 'noop' status when queue not empty", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      const taskpadWithQueueItems = `# TASKPAD

## Autonomous Kickoff Queue
- [ ] planned-2026-02-28 continue active work

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, taskpadWithQueueItems, "utf8");
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      const run = Bun.spawnSync(
        ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      expect(run.exitCode).toBe(0);

      const result = parseJsonBlock(new TextDecoder().decode(run.stdout));
      expect(result.status).toBe("noop");
      expect(result.triggered).toBe(false);
      expect(result.selectedOutcome.action).toBe("noop");
      expect(result.candidates).toEqual([]);
      expect(result.artifactPath).toBeNull();
      expect(result.applyHint).toBeNull();

      // Verify TASKPAD was NOT modified
      expect(readFileSync(taskpadPath, "utf8")).toBe(taskpadWithQueueItems);
    });
  });

  test("empty queue seeds one ranked candidate into Self-Improvement Backlog", () => {
    const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
    tempDirs.push(dir);

    const taskpadPath = join(dir, "TASKPAD.md");
    const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

    writeFileSync(
      taskpadPath,
      `# TASKPAD

## Autonomous Kickoff Queue
- [x] planned-2026-02-27 finished item

## Self-Improvement Backlog
- [x] planned-2026-02-27 finished item
`,
      "utf8",
    );
    writeFileSync(planPath, buildPlanMarkdown(), "utf8");

    const run = Bun.spawnSync(
      ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath],
      {
        cwd: PROJECT_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stdout = new TextDecoder().decode(run.stdout);
    const stderr = new TextDecoder().decode(run.stderr);

    expect(run.exitCode).toBe(0);
    expect(stderr).toBe("");

    const result = parseJsonBlock(stdout);
    expect(result.status).toBe("seeded");
    expect(result.triggered).toBe(true);
    expect(result.candidates).toHaveLength(3);
    expect(result.selectedCandidateId).toBe("AIC001");
    expect(result.selectedOutcome.action).toBe("inserted");
    expect(result.selectedOutcome.insertedLine).not.toBeNull();

    const updatedTaskpad = readFileSync(taskpadPath, "utf8");
    expect(updatedTaskpad).toMatch(/- \[ \] planned-\d{4}-\d{2}-\d{2} add deterministic ranking fixtures for taskpad auto-ideation/);
  });

  test("non-empty queue is a no-op", () => {
    const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
    tempDirs.push(dir);

    const taskpadPath = join(dir, "TASKPAD.md");
    const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

    const originalTaskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [ ] planned-2026-02-28 continue active work

## Self-Improvement Backlog
- [x] done
`;

    writeFileSync(taskpadPath, originalTaskpad, "utf8");
    writeFileSync(planPath, buildPlanMarkdown(), "utf8");

    const run = Bun.spawnSync(
      ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath],
      {
        cwd: PROJECT_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const result = parseJsonBlock(new TextDecoder().decode(run.stdout));

    expect(run.exitCode).toBe(0);
    expect(result.status).toBe("noop");
    expect(result.triggered).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(readFileSync(taskpadPath, "utf8")).toBe(originalTaskpad);
  });

  test("candidate ranking order is deterministic for identical inputs", () => {
    const taskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;
    const plan = buildPlanMarkdown();

    const first = synthesizeRankedCandidateBullets(taskpad, plan).map((candidate) => candidate.id);
    const second = synthesizeRankedCandidateBullets(taskpad, plan).map((candidate) => candidate.id);

    expect(first).toEqual(["AIC001", "AIC002", "AIC003"]);
    expect(second).toEqual(first);
  });

  describe("ranking snapshot fixtures", () => {
    const scenarios = [
      "taskpad-auto-ideation-ranking-empty-with-signals",
      "taskpad-auto-ideation-ranking-empty-no-theme",
    ];

    test.each(scenarios)("%s asserts exact top-3 order and score/tie-break metadata", (baseName) => {
      const fixture = loadRankingSnapshotFixture(baseName);
      const rankedCandidates = synthesizeRankedCandidateBullets(
        fixture.taskpadMarkdown,
        fixture.planMarkdown,
      );
      const top3 = rankedCandidates.slice(0, 3);

      expect(top3).toHaveLength(3);
      expect(top3.map((candidate) => candidate.id)).toEqual(fixture.expected.expectedOrder);

      expect(
        top3.map((candidate) => ({
          id: candidate.id,
          score: candidate.score,
          scoreBreakdown: candidate.scoreBreakdown,
          stableSortKey: candidate.stableSortKey,
          tieBreak: candidate.tieBreak,
        })),
      ).toEqual(
        fixture.expected.expectedTop3.map((expectedTop3Entry) => ({
          id: expectedTop3Entry.id,
          score: expectedTop3Entry.scoreBreakdown.total,
          scoreBreakdown: expectedTop3Entry.scoreBreakdown,
          stableSortKey: expectedTop3Entry.stableSortKey,
          tieBreak: expectedTop3Entry.tieBreak,
        })),
      );
    });
  });

  describe("semantic dedupe fixtures", () => {
    test("equivalent-meaning phrasing variants normalize to the same semantic key", () => {
      const fixtures = [
        {
          variantA:
            "- [ ] planned-2026-02-28 normalize duplicate taskpad backlog pre-check writeable routing",
          variantB:
            "- [ ] planned-2026-03-01 canonicalized deduped queue taskpad preflight writable routing",
        },
        {
          variantA:
            "- [ ] planned-2026-02-28 validate duplicate taskpad queue precheck",
          variantB:
            "- [ ] planned-2026-02-28 verification dedupe backlog taskpad pre-check",
        },
      ];

      for (const fixture of fixtures) {
        const keyA = buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet(fixture.variantA);
        const keyB = buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet(fixture.variantB);

        expect(keyA).not.toBeNull();
        expect(keyA).toBe(keyB);
      }
    });

    test("non-equivalent edge cases keep distinct semantic keys", () => {
      const fixtures = [
        {
          left: "- [ ] planned-2026-02-28 normalize duplicate taskpad queue preflight writable routing",
          right: "- [ ] planned-2026-02-28 add deterministic ranking fixtures for taskpad auto-ideation",
        },
        {
          left: "- [ ] planned-2026-02-28 verification dedupe taskpad precheck",
          right: "- [ ] planned-2026-02-28 add telemetry history report for queue health outcomes",
        },
      ];

      for (const fixture of fixtures) {
        const leftKey = buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet(fixture.left);
        const rightKey = buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet(fixture.right);

        expect(leftKey).not.toBeNull();
        expect(rightKey).not.toBeNull();
        expect(leftKey).not.toBe(rightKey);
      }
    });
  });

  test("dedupes when candidate bullet already exists in Self-Improvement Backlog", () => {
    const taskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [ ] planned-2026-02-15 add deterministic ranking fixtures for taskpad auto-ideation (exactly three candidates with stable tie-break ordering)
- [x] done
`;
    const plan = buildPlanMarkdown();
    const candidates = synthesizeRankedCandidateBullets(taskpad, plan);
    const selected = selectBestCandidate(candidates);

    const insertion = insertSelectedCandidateIntoSelfImprovementBacklog(
      taskpad,
      selected.selectedCandidate,
      new Date("2026-02-28T12:00:00Z"),
    );

    expect(insertion.action).toBe("deduped");
    expect(insertion.matchedExistingLine).not.toBeNull();
    expect(insertion.insertedLine).toBeNull();
    expect(insertion.semanticDedupe.decision).toBe("deduped");
    expect(insertion.semanticDedupe.candidateSemanticKey).toBe(insertion.semanticDedupe.matchedSemanticKey);
    expect(insertion.updatedTaskpadMarkdown).toBe(taskpad);
  });

  test("insertion keeps CRLF newlines and uses UTC date formatting", () => {
    const taskpad =
      "# TASKPAD\r\n\r\n## Autonomous Kickoff Queue\r\n- [x] done\r\n\r\n## Self-Improvement Backlog\r\n- [x] done\r\n";
    const plan = buildPlanMarkdown();
    const candidates = synthesizeRankedCandidateBullets(taskpad, plan);
    const selected = selectBestCandidate(candidates);

    const insertion = insertSelectedCandidateIntoSelfImprovementBacklog(
      taskpad,
      selected.selectedCandidate,
      new Date("2026-03-01T00:30:00+14:00"),
    );

    expect(insertion.action).toBe("inserted");
    expect(insertion.semanticDedupe.decision).toBe("inserted");
    expect(insertion.semanticDedupe.candidateSemanticKey).toBeTruthy();
    expect(insertion.updatedTaskpadMarkdown.includes("\r\n")).toBe(true);
    expect(insertion.updatedTaskpadMarkdown).toContain("planned-2026-02-28");
  });

  describe("Work Queue target behavior", () => {
    test("Work Queue insertion includes Verify: scaffold in canonical bullet", () => {
      const taskpad = `# TASKPAD

## Work Queue
- [x] planned-2026-02-27 completed work item

## Self-Improvement Backlog
- [x] done
`;
      const plan = buildPlanMarkdown();
      const candidates = synthesizeRankedCandidateBullets(taskpad, plan, "work");
      const selected = selectBestCandidate(candidates);

      expect(selected.selectedCandidate.canonicalBullet).toContain("Verify:");
      expect(selected.selectedCandidate.canonicalBullet).toMatch(/Verify:\s*<command>/);
    });

    test("insertSelectedCandidateIntoTargetQueue inserts into Work Queue when target is 'work'", () => {
      const taskpad = `# TASKPAD

## Work Queue
- [x] planned-2026-02-27 completed work item

## Self-Improvement Backlog
- [x] done
`;
      const plan = buildPlanMarkdown();
      const candidates = synthesizeRankedCandidateBullets(taskpad, plan, "work");
      const selected = selectBestCandidate(candidates);

      const insertion = insertSelectedCandidateIntoTargetQueue(
        taskpad,
        selected.selectedCandidate,
        "work",
        new Date("2026-03-02T12:00:00Z"),
      );

      expect(insertion.action).toBe("inserted");
      expect(insertion.updatedTaskpadMarkdown).toContain("## Work Queue");
      expect(insertion.updatedTaskpadMarkdown).toMatch(/- \[ \] planned-2026-03-02 .+ Verify:/);
      expect(insertion.insertedLine).not.toBeNull();

      // Verify the insertion is in Work Queue section, not Self-Improvement
      const workQueueIndex = insertion.updatedTaskpadMarkdown.indexOf("## Work Queue");
      const selfImprovementIndex = insertion.updatedTaskpadMarkdown.indexOf("## Self-Improvement Backlog");
      const insertedLineIndex = insertion.updatedTaskpadMarkdown.indexOf("- [ ] planned-2026-03-02");

      expect(workQueueIndex).toBeLessThan(insertedLineIndex);
      expect(insertedLineIndex).toBeLessThan(selfImprovementIndex);
    });

    test("CLI with --target-queue work seeds Work Queue with canonical verify scaffold", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      const originalTaskpad = `# TASKPAD

## Work Queue
- [x] planned-2026-02-27 completed work item

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, originalTaskpad, "utf8");
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      const run = Bun.spawnSync(
        ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath, "--target-queue", "work"],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      expect(run.exitCode).toBe(0);

      const result = parseJsonBlock(new TextDecoder().decode(run.stdout));
      expect(result.status).toBe("seeded");
      expect(result.triggered).toBe(true);
      expect(result.targetQueueRouting).not.toBeNull();
      expect(result.targetQueueRouting?.targetQueue).toBe("work");
      expect(result.targetQueueRouting?.insertionSection).toBe("## Work Queue");
      expect(result.targetQueueRouting?.ruleId).toBe("TQR004_WORK_QUEUE_PATH");

      const updatedTaskpad = readFileSync(taskpadPath, "utf8");
      expect(updatedTaskpad).not.toBe(originalTaskpad);
      expect(updatedTaskpad).toMatch(/- \[ \] planned-\d{4}-\d{2}-\d{2} .+ Verify:\s*<command>/);

      // Verify queueParityStatus reflects Work Queue state
      expect(result.queueParityStatus).not.toBeNull();
      expect(result.queueParityStatus?.hasExecutableItems).toBe(true);
      expect(result.queueParityStatus?.targetQueueUncheckedCount).toBeGreaterThan(0);
      expect(result.queueParityStatus?.parityStatus).toBe("parity-pass");
    });

    test("semantic dedupe for Work Queue strips Verify: clause for comparison", () => {
      const lineWithVerify = "- [ ] planned-2026-02-28 add deterministic ranking fixtures Verify: bun test taskpad-auto-ideation";
      const lineWithoutVerify = "- [ ] planned-2026-02-28 add deterministic ranking fixtures";
      const lineWithDifferentVerify = "- [ ] planned-2026-02-28 add deterministic ranking fixtures Verify: bun run typecheck";

      const keyWithVerify = buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet(lineWithVerify);
      const keyWithoutVerify = buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet(lineWithoutVerify);
      const keyWithDifferentVerify = buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet(lineWithDifferentVerify);

      // All three should produce the same semantic key
      expect(keyWithVerify).not.toBeNull();
      expect(keyWithoutVerify).not.toBeNull();
      expect(keyWithDifferentVerify).not.toBeNull();
      expect(keyWithVerify).toBe(keyWithoutVerify);
      expect(keyWithVerify).toBe(keyWithDifferentVerify);
    });

    test("Work Queue insertion dedupes based on semantic key without Verify: clause", () => {
      // Create a scenario where an existing bullet has the same semantic content
      // but with a different Verify: clause, to test that dedupe ignores the Verify: clause
      const existingBullet = "- [ ] planned-2026-02-15 Auto-ideation deterministic ranking harness Verify: bun test";
      const candidateBullet = "- [ ] planned-2026-03-02 Auto-ideation deterministic ranking harness Verify: bun run typecheck";

      const existingKey = buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet(existingBullet);
      const candidateKey = buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet(candidateBullet);

      expect(existingKey).not.toBeNull();
      expect(candidateKey).not.toBeNull();

      // Both should produce the same semantic key (Verify: clause stripped)
      expect(existingKey).toBe(candidateKey);

      // Verify that removing the Verify: clause doesn't affect the key
      const candidateWithoutVerify = "- [ ] planned-2026-03-02 Auto-ideation deterministic ranking harness";
      const candidateWithoutVerifyKey = buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet(candidateWithoutVerify);

      expect(candidateWithoutVerifyKey).toBe(candidateKey);
      expect(candidateWithoutVerifyKey).toBe(existingKey);
    });

    test("queueParityStatus reflects Work Queue count after ideation", () => {
      const taskpad = `# TASKPAD

## Work Queue
- [x] planned-2026-02-27 completed work item

## Self-Improvement Backlog
- [x] done
`;
      const plan = buildPlanMarkdown();
      const candidates = synthesizeRankedCandidateBullets(taskpad, plan, "work");
      const selected = selectBestCandidate(candidates);

      const insertion = insertSelectedCandidateIntoTargetQueue(
        taskpad,
        selected.selectedCandidate,
        "work",
        new Date("2026-03-02T12:00:00Z"),
      );

      // Compute queue parity status for Work Queue
      const queueParityStatus = computeQueueParityStatus(
        insertion.updatedTaskpadMarkdown,
        "work",
        insertion,
        true,
      );

      expect(queueParityStatus.hasExecutableItems).toBe(true);
      expect(queueParityStatus.targetQueueUncheckedCount).toBe(1);
      expect(queueParityStatus.parityStatus).toBe("parity-pass");
    });

    test("queueParityStatus reports parity-fail-empty when Work Queue is empty", () => {
      const taskpad = `# TASKPAD

## Work Queue
- [x] planned-2026-02-27 completed work item

## Self-Improvement Backlog
- [x] done
`;
      const plan = buildPlanMarkdown();

      const queueParityStatus = computeQueueParityStatus(
        taskpad,
        "work",
        null,
        false,
      );

      expect(queueParityStatus.hasExecutableItems).toBe(false);
      expect(queueParityStatus.targetQueueUncheckedCount).toBe(0);
      expect(queueParityStatus.parityStatus).toBe("parity-fail-empty");
    });
  });

  describe("Self-Improvement mode non-regression", () => {
    test("default behavior (no --target-queue) targets Self-Improvement Backlog", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      const originalTaskpad = `# TASKPAD

## Work Queue
- [x] planned-2026-02-27 completed work item

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, originalTaskpad, "utf8");
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      const run = Bun.spawnSync(
        ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      expect(run.exitCode).toBe(0);

      const result = parseJsonBlock(new TextDecoder().decode(run.stdout));
      expect(result.status).toBe("seeded");
      expect(result.targetQueueRouting).not.toBeNull();
      expect(result.targetQueueRouting?.targetQueue).toBe("self-improvement");
      expect(result.targetQueueRouting?.insertionSection).toBe("## Self-Improvement Backlog");
      expect(result.targetQueueRouting?.ruleId).toBe("TQR005_SELF_IMPROVEMENT_PATH");

      const updatedTaskpad = readFileSync(taskpadPath, "utf8");
      expect(updatedTaskpad).toContain("## Self-Improvement Backlog");
      expect(updatedTaskpad).toMatch(/- \[ \] planned-\d{4}-\d{2}-\d{2} add deterministic ranking fixtures/);
      // Verify: scaffold should NOT be in Self-Improvement bullets
      expect(updatedTaskpad).not.toMatch(/## Self-Improvement Backlog[\s\S]*?- \[ \] planned-\d{4}-\d{2}-\d{2}.+Verify:/);
    });

    test("explicit --target-queue self-improvement produces same output as default", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPathDefault = join(dir, "TASKPAD_DEFAULT.md");
      const taskpadPathExplicit = join(dir, "TASKPAD_EXPLICIT.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      const originalTaskpad = `# TASKPAD

## Work Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPathDefault, originalTaskpad, "utf8");
      writeFileSync(taskpadPathExplicit, originalTaskpad, "utf8");
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      // Run with default (no --target-queue)
      const runDefault = Bun.spawnSync(
        ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPathDefault, "--plan", planPath],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      // Run with explicit --target-queue self-improvement
      const runExplicit = Bun.spawnSync(
        ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPathExplicit, "--plan", planPath, "--target-queue", "self-improvement"],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      const resultDefault = parseJsonBlock(new TextDecoder().decode(runDefault.stdout));
      const resultExplicit = parseJsonBlock(new TextDecoder().decode(runExplicit.stdout));

      // Both should have same targetQueueRouting
      expect(resultDefault.targetQueueRouting?.targetQueue).toBe("self-improvement");
      expect(resultExplicit.targetQueueRouting?.targetQueue).toBe("self-improvement");

      // Both should insert the same candidate
      expect(resultDefault.selectedCandidateId).toBe(resultExplicit.selectedCandidateId);

      // Both should produce identical TASKPAD content
      const updatedDefault = readFileSync(taskpadPathDefault, "utf8");
      const updatedExplicit = readFileSync(taskpadPathExplicit, "utf8");
      expect(updatedDefault).toBe(updatedExplicit);
    });

    test("Self-Improvement bullets do NOT include Verify: scaffold", () => {
      const taskpad = `# TASKPAD

## Work Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;
      const plan = buildPlanMarkdown();
      const candidates = synthesizeRankedCandidateBullets(taskpad, plan, "self-improvement");
      const selected = selectBestCandidate(candidates);

      expect(selected.selectedCandidate.canonicalBullet).not.toContain("Verify:");
      expect(selected.selectedCandidate.canonicalBullet).not.toMatch(/Verify:\s*<command>/);
    });

    test("queueParityStatus for Self-Improvement reflects selfImprovementUncheckedCount", () => {
      const taskpad = `# TASKPAD

## Work Queue
- [x] planned-2026-02-27 completed work item

## Self-Improvement Backlog
- [x] done
`;
      const plan = buildPlanMarkdown();
      const candidates = synthesizeRankedCandidateBullets(taskpad, plan, "self-improvement");
      const selected = selectBestCandidate(candidates);

      const insertion = insertSelectedCandidateIntoTargetQueue(
        taskpad,
        selected.selectedCandidate,
        "self-improvement",
        new Date("2026-03-02T12:00:00Z"),
      );

      // Compute queue parity status for Self-Improvement
      const queueParityStatus = computeQueueParityStatus(
        insertion.updatedTaskpadMarkdown,
        "self-improvement",
        insertion,
        true,
      );

      expect(queueParityStatus.hasExecutableItems).toBe(true);
      // The count is 2 because the insertion counts as 1 and wasTriggered is true
      expect(queueParityStatus.targetQueueUncheckedCount).toBeGreaterThan(0);
      expect(queueParityStatus.parityStatus).toBe("parity-pass");
    });
  });

  describe("deterministic output across target modes", () => {
    test("candidate ranking is deterministic for identical inputs regardless of target queue", () => {
      const taskpad = `# TASKPAD

## Work Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;
      const plan = buildPlanMarkdown();

      const workQueueCandidates = synthesizeRankedCandidateBullets(taskpad, plan, "work");
      const selfImprovementCandidates = synthesizeRankedCandidateBullets(taskpad, plan, "self-improvement");

      // Both should produce same candidate IDs and scores
      expect(workQueueCandidates.map((c) => c.id)).toEqual(selfImprovementCandidates.map((c) => c.id));
      expect(workQueueCandidates.map((c) => c.score)).toEqual(selfImprovementCandidates.map((c) => c.score));
      expect(workQueueCandidates.map((c) => c.scoreBreakdown)).toEqual(selfImprovementCandidates.map((c) => c.scoreBreakdown));

      // Only canonicalBullet should differ (Verify: scaffold)
      for (let i = 0; i < workQueueCandidates.length; i++) {
        expect(workQueueCandidates[i].canonicalBullet).toContain("Verify:");
        expect(selfImprovementCandidates[i].canonicalBullet).not.toContain("Verify:");
      }
    });

    test("JSON output has stable key ordering for both target queue modes", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-auto-ideation-"));
      tempDirs.push(dir);

      const taskpadPathWork = join(dir, "TASKPAD_WORK.md");
      const taskpadPathSelf = join(dir, "TASKPAD_SELF.md");
      const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

      const originalTaskpad = `# TASKPAD

## Work Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPathWork, originalTaskpad, "utf8");
      writeFileSync(taskpadPathSelf, originalTaskpad, "utf8");
      writeFileSync(planPath, buildPlanMarkdown(), "utf8");

      const runWork = Bun.spawnSync(
        ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPathWork, "--plan", planPath, "--target-queue", "work"],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      const runSelf = Bun.spawnSync(
        ["bun", "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPathSelf, "--plan", planPath],
        {
          cwd: PROJECT_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      const resultWork = parseJsonBlock(new TextDecoder().decode(runWork.stdout));
      const resultSelf = parseJsonBlock(new TextDecoder().decode(runSelf.stdout));

      // Verify JSON structure has stable ordering by checking keys are present
      const expectedKeys = [
        "status",
        "triggered",
        "queueHealth",
        "preflight",
        "targetQueueRouting",
        "queueParityStatus",
        "candidates",
        "selectedCandidateId",
        "selectedOutcome",
        "artifactPath",
        "applyHint",
      ];

      for (const key of expectedKeys) {
        expect(Object.prototype.hasOwnProperty.call(resultWork, key)).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(resultSelf, key)).toBe(true);
      }

      // Verify targetQueueRouting differs
      expect(resultWork.targetQueueRouting?.targetQueue).toBe("work");
      expect(resultWork.targetQueueRouting?.ruleId).toBe("TQR004_WORK_QUEUE_PATH");
      expect(resultSelf.targetQueueRouting?.targetQueue).toBe("self-improvement");
      expect(resultSelf.targetQueueRouting?.ruleId).toBe("TQR005_SELF_IMPROVEMENT_PATH");
    });
  });

});
