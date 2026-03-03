import { describe, expect, test } from "bun:test";

import {
  buildArchiveMarkdownWithPrunedSlices,
  calculatePlanPruneSet,
  rewritePlanWithoutPrunedSlices,
} from "../../tools/taskpad-plan-prune";

function buildSlice(date: string, title: string, taskLines: string): string {
  return `## TASKPAD Intake Slice (${date}): ${title}

### Distilled Scope
- scope

### RepoPrompt Builder Context
- context

### Task Graph
${taskLines}

### Acceptance Criteria
- criteria

### Verification Commands
\`\`\`bash
bun run typecheck
\`\`\`
`;
}

function buildPlan(slices: string[]): string {
  return `# Obsidian Web Clipper - Implementation Plan

${slices.join("\n")}`;
}

describe("taskpad:plan-prune focused flows", () => {
  test("no-op: completed slices already within keep window", () => {
    const planMarkdown = buildPlan([
      buildSlice("2026-02-28", "Active slice", "- [ ] **TP001**: Open task"),
      buildSlice("2026-02-27", "Completed recent", "- [x] **TP001**: Done task"),
    ]);

    const pruneSet = calculatePlanPruneSet(planMarkdown, 1);
    const rewritten = rewritePlanWithoutPrunedSlices(planMarkdown, pruneSet);
    const archive = buildArchiveMarkdownWithPrunedSlices(null, pruneSet);

    expect(pruneSet.reasonCode).toBe("PLAN_PRUNE_OK");
    expect(pruneSet.completedSlices).toHaveLength(1);
    expect(pruneSet.prunedCompletedSlices).toHaveLength(0);

    expect(rewritten.reasonCode).toBe("PLAN_PRUNE_NOOP_WITHIN_KEEP_WINDOW");
    expect(rewritten.updatedPlanMarkdown).toBe(planMarkdown);

    expect(archive.reasonCode).toBe("PLAN_PRUNE_NOOP_WITHIN_KEEP_WINDOW");
    expect(archive.archiveMarkdown).toBeNull();
  });

  test("prune success: prunes older completed slices and builds archive appendix", () => {
    const activeHeading = "## TASKPAD Intake Slice (2026-02-28): Active slice";
    const keepHeading = "## TASKPAD Intake Slice (2026-02-27): Keep me";
    const pruneHeading = "## TASKPAD Intake Slice (2026-02-26): Archive me";

    const planMarkdown = buildPlan([
      buildSlice("2026-02-28", "Active slice", "- [ ] **TP001**: In progress"),
      buildSlice("2026-02-27", "Keep me", "- [x] **TP001**: Complete"),
      buildSlice("2026-02-26", "Archive me", "- [x] **TP001**: Complete"),
    ]);

    const pruneSet = calculatePlanPruneSet(planMarkdown, 1);
    const rewritten = rewritePlanWithoutPrunedSlices(planMarkdown, pruneSet);
    const archive = buildArchiveMarkdownWithPrunedSlices("# Existing Archive\n", pruneSet);

    expect(pruneSet.reasonCode).toBe("PLAN_PRUNE_OK");
    expect(pruneSet.completedSlices).toHaveLength(2);
    expect(pruneSet.keptCompletedSlices.map((slice) => slice.heading)).toEqual([keepHeading]);
    expect(pruneSet.prunedCompletedSlices.map((slice) => slice.heading)).toEqual([pruneHeading]);

    expect(rewritten.reasonCode).toBe("PLAN_PRUNE_OK");
    expect(rewritten.updatedPlanMarkdown).toContain(activeHeading);
    expect(rewritten.updatedPlanMarkdown).toContain(keepHeading);
    expect(rewritten.updatedPlanMarkdown).not.toContain(pruneHeading);

    expect(archive.reasonCode).toBe("PLAN_PRUNE_OK");
    expect(archive.archiveMarkdown).toContain("# Existing Archive");
    expect(archive.archiveMarkdown).toContain(pruneHeading);
    expect(archive.archiveMarkdown).toContain("### Task Graph");
  });

  test("missing-heading rejection: rejects intake slices without Task Graph heading", () => {
    const invalidPlan = `# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-02-28): Missing Task Graph

### Distilled Scope
- scope

### RepoPrompt Builder Context
- context

### Acceptance Criteria
- criteria

### Verification Commands
\`\`\`bash
bun run typecheck
\`\`\`
`;

    const pruneSet = calculatePlanPruneSet(invalidPlan, 5);
    const rewritten = rewritePlanWithoutPrunedSlices(invalidPlan, pruneSet);

    expect(pruneSet.reasonCode).toBe("PLAN_PRUNE_PLAN_STRUCTURE_INVALID");
    expect(pruneSet.structuralErrors.some((error) => error.includes("Missing '### Task Graph' heading"))).toBe(true);

    expect(rewritten.reasonCode).toBe("PLAN_PRUNE_PLAN_STRUCTURE_INVALID");
    expect(rewritten.updatedPlanMarkdown).toBeNull();
  });
});
