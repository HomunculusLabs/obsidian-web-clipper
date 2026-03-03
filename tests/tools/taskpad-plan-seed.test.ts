import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { runTaskpadPlanSeed } from "../../tools/taskpad-plan-seed";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function buildValidPlanSlice(): string {
  return `# Obsidian Web Clipper - Implementation Plan

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
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("taskpad:plan-seed focused flows", () => {
  test("success: seeds new top slice and marks first unchecked self-improvement item planned", () => {
    const dir = makeTempDir("taskpad-plan-seed-");
    const taskpadPath = join(dir, "TASKPAD.md");
    const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

    const taskpadMarkdown = `# TASKPAD

## Autonomous Kickoff Queue
- [x] planned-2026-02-27 done

## Self-Improvement Backlog
- [x] planned-2026-02-27 already planned
- [ ] tighten intake handoff

## Other
- [ ] ignore me
`;

    writeFileSync(taskpadPath, taskpadMarkdown, "utf8");
    writeFileSync(planPath, buildValidPlanSlice(), "utf8");

    const result = runTaskpadPlanSeed(taskpadPath, planPath, "2026-02-28");

    expect(result.summary.status).toBe("seeded");
    expect(result.summary.reasonCode).toBe("PLAN_SEED_OK");
    expect(result.summary.selectedBacklogLine).toBe(8);
    expect(result.summary.newSliceHeading).toBe(
      "## TASKPAD Intake Slice (2026-02-28): tighten intake handoff (`taskpad:plan-seed`)",
    );

    const updatedTaskpad = readFileSync(taskpadPath, "utf8");
    expect(updatedTaskpad).toContain("- [ ] planned-2026-02-28 tighten intake handoff");

    const updatedPlan = readFileSync(planPath, "utf8");
    expect(updatedPlan.startsWith("# Obsidian Web Clipper - Implementation Plan\n\n## TASKPAD Intake Slice (2026-02-28): tighten intake handoff (`taskpad:plan-seed`)\n")).toBe(true);
    expect(updatedPlan).toContain("### Distilled Scope");
    expect(updatedPlan).toContain("## TASKPAD Intake Slice (2026-02-28): Existing seeded slice");
  });

  test("no-unchecked-item: returns noop and leaves files unchanged", () => {
    const dir = makeTempDir("taskpad-plan-seed-");
    const taskpadPath = join(dir, "TASKPAD.md");
    const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

    const taskpadMarkdown = `# TASKPAD

## Self-Improvement Backlog
- [x] planned-2026-02-27 complete one
- [x] planned-2026-02-28 complete two
`;

    const planMarkdown = buildValidPlanSlice();

    writeFileSync(taskpadPath, taskpadMarkdown, "utf8");
    writeFileSync(planPath, planMarkdown, "utf8");

    const result = runTaskpadPlanSeed(taskpadPath, planPath, "2026-02-28");

    expect(result.summary.status).toBe("noop");
    expect(result.summary.reasonCode).toBe("PLAN_SEED_NO_UNCHECKED_SELF_IMPROVEMENT");
    expect(result.summary.selectedBacklogLine).toBeNull();
    expect(result.summary.newSliceHeading).toBeNull();

    expect(readFileSync(taskpadPath, "utf8")).toBe(taskpadMarkdown);
    expect(readFileSync(planPath, "utf8")).toBe(planMarkdown);
  });

  test("missing-heading rejection: fails deterministically when active plan slice is structurally incomplete", () => {
    const dir = makeTempDir("taskpad-plan-seed-");
    const taskpadPath = join(dir, "TASKPAD.md");
    const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

    const taskpadMarkdown = `# TASKPAD

## Self-Improvement Backlog
- [ ] improve deterministic planning
`;

    const invalidPlanMarkdown = `# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-02-28): Missing required heading

### Distilled Scope
- existing

### RepoPrompt Builder Context
- existing

### Task Graph
- [ ] **TP001**: Existing task

### Acceptance Criteria
- existing
`;

    writeFileSync(taskpadPath, taskpadMarkdown, "utf8");
    writeFileSync(planPath, invalidPlanMarkdown, "utf8");

    const result = runTaskpadPlanSeed(taskpadPath, planPath, "2026-02-28");

    expect(result.summary.status).toBe("failed");
    expect(result.summary.reasonCode).toBe("PLAN_SEED_PLAN_REQUIRED_HEADING_MISSING");
    expect(result.summary.selectedBacklogLine).toBe(4);
    expect(result.summary.newSliceHeading).toBeNull();

    expect(readFileSync(taskpadPath, "utf8")).toBe(taskpadMarkdown);
    expect(readFileSync(planPath, "utf8")).toBe(invalidPlanMarkdown);
  });
});
