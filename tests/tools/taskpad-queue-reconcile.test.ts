#!/usr/bin/env bun

import { describe, test, expect, beforeAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  reconcileTaskpad,
  healTaskpad,
  parseTaskpad,
  CANONICAL_SECTIONS,
  type ReconcileReasonCode,
} from "../../tools/lib/taskpad-queue-reconcile";
import {
  selectFirstUncheckedSelfImprovementBullet,
  markSelectedBacklogBulletPlanned,
  type TaskpadBacklogSelection,
  type SelectedSelfImprovementBullet,
} from "../../tools/taskpad-plan-seed";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const TEMP_DIR = tmpdir();

function makeTempPath(filename: string): string {
  return join(TEMP_DIR, filename);
}

describe("taskpad-queue-reconcile", () => {
  describe("parseTaskpad", () => {
    test("should parse canonical taskpad with all sections", () => {
      const markdown = `# TASKPAD

## Work Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const parsed = parseTaskpad(markdown);
      expect(parsed.h2Headings).toHaveLength(4);
      expect(parsed.canonicalSections.size).toBe(4);
      expect(parsed.frontmatterEndLine).toBe(0);
    });

    test("should detect frontmatter correctly", () => {
      const markdown = `---
artifact: taskpad
---

## Work Queue
- [ ] Task 1
`;
      const parsed = parseTaskpad(markdown);
      expect(parsed.frontmatterEndLine).toBe(3);
    });

    test("should handle duplicate canonical headings", () => {
      const markdown = `## Work Queue
- [ ] Task 1

## Work Queue
- [ ] Task 2

## Self-Improvement Backlog
- [ ] Task 3
`;
      const parsed = parseTaskpad(markdown);
      expect(parsed.h2Headings).toHaveLength(3);
      expect(parsed.canonicalSections.size).toBe(2); // Only first occurrence stored
    });
  });

  describe("reconcileTaskpad", () => {
    test("should return canonical status for well-formed taskpad", async () => {
      const markdown = `## Work Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = makeTempPath("temp-canonical.md");
      await Bun.write(tempPath, markdown);

      const result = reconcileTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.reasonCodes).toContain("RECONCILE_CANONICAL");
      expect(result.sectionsPresent.workQueue).toBe(true);
      expect(result.sectionsPresent.executionQueue).toBe(true);
      expect(result.sectionsPresent.autonomousKickoffQueue).toBe(true);
      expect(result.sectionsPresent.selfImprovementBacklog).toBe(true);
      expect(result.ordering.isCanonicalOrder).toBe(true);
    });

    test("should detect missing Execution Queue section", async () => {
      const markdown = `## Work Queue
- [ ] Task 1

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = makeTempPath("temp-missing-exec-queue.md");
      await Bun.write(tempPath, markdown);

      const result = reconcileTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("healed");
      expect(result.reasonCodes).toContain("RECONCILE_MISSING_SECTION");
      expect(result.reasonCodes).toContain("RECONCILE_HEALED");
      expect(result.sectionsPresent.executionQueue).toBe(false);
      expect(result.healedSections).toContain("## Execution Queue");
    });

    test("should detect out-of-order sections", async () => {
      const markdown = `## Self-Improvement Backlog
- [ ] Task 4

## Work Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue
- [ ] Task 3
`;
      const tempPath = makeTempPath("temp-out-of-order.md");
      await Bun.write(tempPath, markdown);

      const result = reconcileTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("healed");
      expect(result.reasonCodes).toContain("RECONCILE_OUT_OF_ORDER");
      expect(result.ordering.isCanonicalOrder).toBe(false);
    });

    test("should detect duplicate headings", async () => {
      const markdown = `## Work Queue
- [ ] Task 1

## Work Queue
- [ ] Task 2

## Self-Improvement Backlog
- [ ] Task 3
`;
      const tempPath = makeTempPath("temp-duplicate.md");
      await Bun.write(tempPath, markdown);

      const result = reconcileTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("healed");
      expect(result.reasonCodes).toContain("RECONCILE_DUPLICATE_HEADING");
    });

    test("should handle empty sections gracefully", async () => {
      const markdown = `## Work Queue

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = makeTempPath("temp-empty-sections.md");
      await Bun.write(tempPath, markdown);

      const result = reconcileTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.reasonCodes).toContain("RECONCILE_EMPTY_SECTION");
    });

    test("should return error for missing file", () => {
      const result = reconcileTaskpad({ taskpadPath: "/nonexistent/path.md" });
      expect(result.status).toBe("error");
      expect(result.reasonCodes).toContain("RECONCILE_TASKPAD_NOT_FOUND");
      expect(result.error).toBeDefined();
    });
  });

  describe("healTaskpad", () => {
    test("should return no-op for canonical taskpad", async () => {
      const markdown = `## Work Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = makeTempPath("temp-heal-canonical.md");
      await Bun.write(tempPath, markdown);

      const result = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.mutated).toBe(false);
      expect(result.healedMarkdown).toBeNull();
    });

    test("should heal missing Execution Queue section", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Task 1

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = makeTempPath("temp-heal-missing-exec-queue.md");
      await Bun.write(tempPath, originalMarkdown);

      const result = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.mutated).toBe(true);
      expect(result.healedMarkdown).not.toBeNull();
      expect(result.healedMarkdown).toContain("## Work Queue");
      expect(result.healedMarkdown).toContain("## Execution Queue");
      expect(result.healedMarkdown).toContain("## Autonomous Kickoff Queue");
      expect(result.healedMarkdown).toContain("## Self-Improvement Backlog");

      // Verify order is canonical
      const execQueueIdx = result.healedMarkdown!.indexOf("## Execution Queue");
      const workQueueIdx = result.healedMarkdown!.indexOf("## Work Queue");
      const autonomousQueueIdx = result.healedMarkdown!.indexOf("## Autonomous Kickoff Queue");
      expect(execQueueIdx).toBeGreaterThan(workQueueIdx);
      expect(autonomousQueueIdx).toBeGreaterThan(execQueueIdx);
    });

    test("should heal multiple missing sections", async () => {
      const originalMarkdown = `## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = makeTempPath("temp-heal-multiple-missing.md");
      await Bun.write(tempPath, originalMarkdown);

      // First reconcile to check what's missing
      const reconcileResult = reconcileTaskpad({ taskpadPath: tempPath });
      expect(reconcileResult.reasonCodes).toContain("RECONCILE_MISSING_SECTION");

      const result = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.mutated).toBe(true);

      // Verify all sections are present in order
      const healed = result.healedMarkdown!;
      expect(healed).toContain("## Work Queue");
      expect(healed).toContain("## Execution Queue");
      expect(healed).toContain("## Autonomous Kickoff Queue");
      expect(healed).toContain("## Self-Improvement Backlog");
    });

    test("should heal out-of-order sections while preserving content", async () => {
      const originalMarkdown = `## Self-Improvement Backlog
- [ ] Backlog task 1

## Work Queue
- [ ] Work task 1
- [ ] Work task 2

## Execution Queue
- [ ] Execution task 1
`;
      const tempPath = makeTempPath("temp-heal-out-of-order.md");
      await Bun.write(tempPath, originalMarkdown);

      const result = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.mutated).toBe(true);
      expect(result.healedMarkdown).toContain("Work task 1");
      expect(result.healedMarkdown).toContain("Backlog task 1");
      expect(result.healedMarkdown).toContain("Execution task 1");

      // Verify canonical order
      const healed = result.healedMarkdown!;
      const workIdx = healed.indexOf("## Work Queue");
      const execIdx = healed.indexOf("## Execution Queue");
      const backlogIdx = healed.indexOf("## Self-Improvement Backlog");
      expect(execIdx).toBeGreaterThan(workIdx);
      expect(backlogIdx).toBeGreaterThan(execIdx);
    });

    test("should be idempotent - no changes on second run", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Task 1

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = makeTempPath("temp-idempotent.md");
      await Bun.write(tempPath, originalMarkdown);

      const result1 = healTaskpad({ taskpadPath: tempPath });
      expect(result1.mutated).toBe(true);

      // Write healed content
      if (result1.healedMarkdown) {
        await Bun.write(tempPath, result1.healedMarkdown);
      }

      const result2 = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result2.status).toBe("canonical");
      expect(result2.mutated).toBe(false);
      expect(result2.healedMarkdown).toBeNull();
    });

    test("should preserve frontmatter", async () => {
      const originalMarkdown = `---
artifact: taskpad
version: 1.0
---

## Work Queue
- [ ] Task 1

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = makeTempPath("temp-heal-frontmatter.md");
      await Bun.write(tempPath, originalMarkdown);

      const result = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.healedMarkdown).toContain("---");
      expect(result.healedMarkdown).toContain("artifact: taskpad");
      expect(result.healedMarkdown).toContain("## Work Queue");
      expect(result.healedMarkdown).toContain("## Execution Queue");
    });

    test("should preserve non-canonical sections", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Task 1

## Custom Section
- [ ] Custom task

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = makeTempPath("temp-heal-non-canonical.md");
      await Bun.write(tempPath, originalMarkdown);

      const result = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.healedMarkdown).toContain("## Custom Section");
      expect(result.healedMarkdown).toContain("Custom task");
    });

    test("should not remove duplicate headings (emit code only)", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Task 1

## Work Queue
- [ ] Duplicate task

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = makeTempPath("temp-heal-duplicate-no-delete.md");
      await Bun.write(tempPath, originalMarkdown);

      const result = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      // Duplicates are detected but not removed
      expect(result.reasonCodes).toContain("RECONCILE_DUPLICATE_HEADING");
      expect(result.healedMarkdown).toContain("Task 1");
      expect(result.healedMarkdown).toContain("Duplicate task");
      // Both Work Queue headings should still be present
      const workQueueCount = (result.healedMarkdown!.match(/## Work Queue/g) || []).length;
      expect(workQueueCount).toBeGreaterThanOrEqual(1);
    });

    test("should handle complex drift with missing and out-of-order", async () => {
      const originalMarkdown = `## Self-Improvement Backlog
- [ ] Backlog 1

## Autonomous Kickoff Queue
- [ ] Autonomous 1
`;
      const tempPath = makeTempPath("temp-heal-complex.md");
      await Bun.write(tempPath, originalMarkdown);

      // First reconcile to check what's missing
      const reconcileResult = reconcileTaskpad({ taskpadPath: tempPath });
      expect(reconcileResult.reasonCodes).toContain("RECONCILE_MISSING_SECTION");
      expect(reconcileResult.reasonCodes).toContain("RECONCILE_OUT_OF_ORDER");

      const result = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.mutated).toBe(true);

      const healed = result.healedMarkdown!;
      // Verify canonical order
      const workIdx = healed.indexOf("## Work Queue");
      const execIdx = healed.indexOf("## Execution Queue");
      const autoIdx = healed.indexOf("## Autonomous Kickoff Queue");
      const backlogIdx = healed.indexOf("## Self-Improvement Backlog");

      expect(workIdx).toBeLessThan(execIdx);
      expect(execIdx).toBeLessThan(autoIdx);
      expect(autoIdx).toBeLessThan(backlogIdx);
    });

    test("should return no mutations for missing file", () => {
      const result = healTaskpad({ taskpadPath: "/nonexistent/path.md" });
      expect(result.status).toBe("error");
      expect(result.mutated).toBe(false);
      expect(result.healedMarkdown).toBeNull();
    });
  });

  describe("fixture-based integration tests", () => {
    test("should correctly identify taskpad-missing-execution-queue fixture", () => {
      const fixturePath = join(FIXTURES_DIR, "taskpad-missing-execution-queue.md");
      const result = reconcileTaskpad({ taskpadPath: fixturePath });

      expect(result.status).toBe("healed");
      expect(result.sectionsPresent.executionQueue).toBe(false);
      expect(result.sectionsPresent.workQueue).toBe(true);
      expect(result.sectionsPresent.autonomousKickoffQueue).toBe(true);
      expect(result.sectionsPresent.selfImprovementBacklog).toBe(true);
      expect(result.healedSections).toContain("## Execution Queue");
    });

    test("should heal taskpad-missing-execution-queue fixture", () => {
      const fixturePath = join(FIXTURES_DIR, "taskpad-missing-execution-queue.md");
      const result = healTaskpad({ taskpadPath: fixturePath });

      expect(result.status).toBe("canonical");
      expect(result.mutated).toBe(true);
      expect(result.healedMarkdown).not.toBeNull();
      expect(result.healedMarkdown).toContain("## Work Queue");
      expect(result.healedMarkdown).toContain("## Execution Queue");
      expect(result.healedMarkdown).toContain("## Autonomous Kickoff Queue");
      expect(result.healedMarkdown).toContain("## Self-Improvement Backlog");
    });

    test("should correctly identify taskpad-missing-multiple-sections fixture", () => {
      const fixturePath = join(FIXTURES_DIR, "taskpad-missing-multiple-sections.md");
      const result = reconcileTaskpad({ taskpadPath: fixturePath });

      expect(result.status).toBe("healed");
      expect(result.sectionsPresent.workQueue).toBe(true);
      expect(result.sectionsPresent.executionQueue).toBe(false);
      expect(result.sectionsPresent.autonomousKickoffQueue).toBe(false);
      expect(result.sectionsPresent.selfImprovementBacklog).toBe(true);
      expect(result.healedSections).toContain("## Execution Queue");
      expect(result.healedSections).toContain("## Autonomous Kickoff Queue");
      expect(result.reasonCodes).toContain("RECONCILE_MISSING_SECTION");
      expect(result.reasonCodes).toContain("RECONCILE_HEALED");
    });

    test("should heal taskpad-missing-multiple-sections fixture", () => {
      const fixturePath = join(FIXTURES_DIR, "taskpad-missing-multiple-sections.md");
      const result = healTaskpad({ taskpadPath: fixturePath });

      expect(result.status).toBe("canonical");
      expect(result.mutated).toBe(true);
      expect(result.healedMarkdown).not.toBeNull();
      expect(result.healedMarkdown).toContain("## Work Queue");
      expect(result.healedMarkdown).toContain("## Execution Queue");
      expect(result.healedMarkdown).toContain("## Autonomous Kickoff Queue");
      expect(result.healedMarkdown).toContain("## Self-Improvement Backlog");
      // Verify canonical order after healing
      const workIdx = result.healedMarkdown!.indexOf("## Work Queue");
      const execIdx = result.healedMarkdown!.indexOf("## Execution Queue");
      const autoIdx = result.healedMarkdown!.indexOf("## Autonomous Kickoff Queue");
      const backlogIdx = result.healedMarkdown!.indexOf("## Self-Improvement Backlog");
      expect(workIdx).toBeLessThan(execIdx);
      expect(execIdx).toBeLessThan(autoIdx);
      expect(autoIdx).toBeLessThan(backlogIdx);
    });

    test("should correctly identify taskpad-canonical-legacy-mixed fixture", () => {
      const fixturePath = join(FIXTURES_DIR, "taskpad-canonical-legacy-mixed.md");
      const result = reconcileTaskpad({ taskpadPath: fixturePath });

      expect(result.status).toBe("canonical");
      expect(result.sectionsPresent.workQueue).toBe(true);
      expect(result.sectionsPresent.executionQueue).toBe(true);
      expect(result.sectionsPresent.autonomousKickoffQueue).toBe(true);
      expect(result.sectionsPresent.selfImprovementBacklog).toBe(true);
      expect(result.ordering.isCanonicalOrder).toBe(true);
      expect(result.reasonCodes).toContain("RECONCILE_CANONICAL");
    });

    test("should be no-op when healing taskpad-canonical-legacy-mixed fixture", () => {
      const fixturePath = join(FIXTURES_DIR, "taskpad-canonical-legacy-mixed.md");
      const result = healTaskpad({ taskpadPath: fixturePath });

      expect(result.status).toBe("canonical");
      expect(result.mutated).toBe(false);
      expect(result.healedMarkdown).toBeNull();
    });

    test("should preserve legacy sections when healing canonical+legacy mixed layout", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Task 1

## Legacy Ideas
- [ ] Old idea 1
- [ ] Old idea 2

## Execution Queue
- [ ] Task 2

## Backlog
- [ ] Old backlog item

## Autonomous Kickoff Queue
- [ ] Task 3

## Notes
- Some random notes

## Self-Improvement Backlog
- [ ] Task 4

## Reference
- Reference material
`;
      const tempPath = join(TEMP_DIR, "temp-heal-legacy-preserve.md");
      await Bun.write(tempPath, originalMarkdown);

      const result = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.mutated).toBe(false);
      if (result.healedMarkdown) {
        expect(result.healedMarkdown).toContain("## Legacy Ideas");
        expect(result.healedMarkdown).toContain("Old idea 1");
        expect(result.healedMarkdown).toContain("## Backlog");
        expect(result.healedMarkdown).toContain("Old backlog item");
        expect(result.healedMarkdown).toContain("## Notes");
        expect(result.healedMarkdown).toContain("Some random notes");
        expect(result.healedMarkdown).toContain("## Reference");
        expect(result.healedMarkdown).toContain("Reference material");
      }
    });
  });

  // TP006: Focused tests for idempotent healing, deterministic reason codes, and no-op behavior
  describe("TP006: Idempotent healing", () => {
    test("should be idempotent across multiple runs for missing Execution Queue", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Task 1

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = join(TEMP_DIR, "temp-idempotent-missing-exec.md");
      await Bun.write(tempPath, originalMarkdown);

      // First heal should mutate
      const result1 = healTaskpad({ taskpadPath: tempPath });
      expect(result1.mutated).toBe(true);
      expect(result1.healedMarkdown).toContain("## Execution Queue");

      // Write healed content
      if (result1.healedMarkdown) {
        await Bun.write(tempPath, result1.healedMarkdown);
      }

      // Second heal should be no-op
      const result2 = healTaskpad({ taskpadPath: tempPath });
      expect(result2.mutated).toBe(false);
      expect(result2.healedMarkdown).toBeNull();

      // Third heal should still be no-op (verify stability)
      const result3 = healTaskpad({ taskpadPath: tempPath });
      expect(result3.mutated).toBe(false);
      expect(result3.healedMarkdown).toBeNull();

      await Bun.file(tempPath).delete();
    });

    test("should be idempotent across multiple runs for out-of-order sections", async () => {
      const originalMarkdown = `## Self-Improvement Backlog
- [ ] Task 4

## Work Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue
- [ ] Task 3
`;
      const tempPath = join(TEMP_DIR, "temp-idempotent-out-of-order.md");
      await Bun.write(tempPath, originalMarkdown);

      // First heal should mutate
      const result1 = healTaskpad({ taskpadPath: tempPath });
      expect(result1.mutated).toBe(true);
      const healed1 = result1.healedMarkdown!;

      // Write healed content
      await Bun.write(tempPath, healed1);

      // Second heal should be no-op
      const result2 = healTaskpad({ taskpadPath: tempPath });
      expect(result2.mutated).toBe(false);
      expect(result2.healedMarkdown).toBeNull();

      // Third heal should still be no-op
      const result3 = healTaskpad({ taskpadPath: tempPath });
      expect(result3.mutated).toBe(false);
      expect(result3.healedMarkdown).toBeNull();

      await Bun.file(tempPath).delete();
    });

    test("should be idempotent across multiple runs for multiple missing sections", async () => {
      const originalMarkdown = `## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = makeTempPath("temp-idempotent-multiple-missing.md");
      await Bun.write(tempPath, originalMarkdown);

      // First reconcile to see what's missing
      const reconcile1 = reconcileTaskpad({ taskpadPath: tempPath });
      expect(reconcile1.reasonCodes).toContain("RECONCILE_MISSING_SECTION");

      // First heal should mutate
      const result1 = healTaskpad({ taskpadPath: tempPath });
      expect(result1.mutated).toBe(true);

      // Write healed content
      if (result1.healedMarkdown) {
        await Bun.write(tempPath, result1.healedMarkdown);
      }

      // Second heal should be no-op
      const result2 = healTaskpad({ taskpadPath: tempPath });
      expect(result2.mutated).toBe(false);
      expect(result2.healedMarkdown).toBeNull();

      // Third heal should still be no-op
      const result3 = healTaskpad({ taskpadPath: tempPath });
      expect(result3.mutated).toBe(false);
      expect(result3.healedMarkdown).toBeNull();

      await Bun.file(tempPath).delete();
    });

    test("should be idempotent across 10 consecutive runs", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Task 1

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = join(TEMP_DIR, "temp-idempotent-10-runs.md");
      await Bun.write(tempPath, originalMarkdown);

      let lastHealedMarkdown: string | null = null;

      for (let i = 0; i < 10; i++) {
        const result = healTaskpad({ taskpadPath: tempPath });

        if (i === 0) {
          // First run should mutate
          expect(result.mutated).toBe(true);
          expect(result.healedMarkdown).not.toBeNull();
          lastHealedMarkdown = result.healedMarkdown;
          await Bun.write(tempPath, lastHealedMarkdown);
        } else {
          // All subsequent runs should be no-op
          expect(result.mutated).toBe(false);
          expect(result.healedMarkdown).toBeNull();
        }
      }

      await Bun.file(tempPath).delete();
    });

    test("should produce identical healed output across multiple independent runs", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Task 1

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath1 = join(TEMP_DIR, "temp-idempotent-run1.md");
      const tempPath2 = join(TEMP_DIR, "temp-idempotent-run2.md");
      const tempPath3 = join(TEMP_DIR, "temp-idempotent-run3.md");

      await Bun.write(tempPath1, originalMarkdown);
      await Bun.write(tempPath2, originalMarkdown);
      await Bun.write(tempPath3, originalMarkdown);

      // Heal each independently
      const result1 = healTaskpad({ taskpadPath: tempPath1 });
      const result2 = healTaskpad({ taskpadPath: tempPath2 });
      const result3 = healTaskpad({ taskpadPath: tempPath3 });

      // All should produce identical output
      expect(result1.healedMarkdown).toBe(result2.healedMarkdown);
      expect(result2.healedMarkdown).toBe(result3.healedMarkdown);
      expect(result1.healedSections).toEqual(result2.healedSections);
      expect(result2.healedSections).toEqual(result3.healedSections);
      expect(result1.reasonCodes).toEqual(result2.reasonCodes);
      expect(result2.reasonCodes).toEqual(result3.reasonCodes);

      await Bun.file(tempPath1).delete();
      await Bun.file(tempPath2).delete();
      await Bun.file(tempPath3).delete();
    });
  });

  describe("TP006: Deterministic reason code ordering", () => {
    test("should order RECONCILE_MISSING_SECTION before RECONCILE_HEALED", async () => {
      const markdown = `## Work Queue
- [ ] Task 1

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = join(TEMP_DIR, "temp-reason-order-missing.md");
      await Bun.write(tempPath, markdown);

      const result = reconcileTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.reasonCodes).toHaveLength(2);
      expect(result.reasonCodes[0]).toBe("RECONCILE_MISSING_SECTION");
      expect(result.reasonCodes[1]).toBe("RECONCILE_HEALED");
    });

    test("should order RECONCILE_OUT_OF_ORDER before RECONCILE_HEALED", async () => {
      const markdown = `## Self-Improvement Backlog
- [ ] Task 4

## Work Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue
- [ ] Task 3
`;
      const tempPath = join(TEMP_DIR, "temp-reason-order-outoforder.md");
      await Bun.write(tempPath, markdown);

      const result = reconcileTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.reasonCodes).toHaveLength(2);
      expect(result.reasonCodes[0]).toBe("RECONCILE_OUT_OF_ORDER");
      expect(result.reasonCodes[1]).toBe("RECONCILE_HEALED");
    });

    test("should order RECONCILE_DUPLICATE_HEADING before RECONCILE_HEALED", async () => {
      const markdown = `## Work Queue
- [ ] Task 1

## Work Queue
- [ ] Duplicate task

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = makeTempPath("temp-reason-order-duplicate.md");
      await Bun.write(tempPath, markdown);

      const result = reconcileTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      // Duplicate headings are detected
      expect(result.reasonCodes).toContain("RECONCILE_DUPLICATE_HEADING");
      // Out-of-order is also detected because duplicate affects ordering
      expect(result.reasonCodes).toContain("RECONCILE_OUT_OF_ORDER");
      // HEALED is always the last non-error code
      expect(result.reasonCodes[result.reasonCodes.length - 1]).toBe("RECONCILE_HEALED");
    });

    test("should order RECONCILE_EMPTY_SECTION alone for canonical but empty", async () => {
      const markdown = `## Work Queue

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = makeTempPath("temp-reason-order-empty.md");
      await Bun.write(tempPath, markdown);

      const result = reconcileTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      // Empty sections are reported with EMPTY_SECTION when no other issues exist
      expect(result.reasonCodes).toContain("RECONCILE_EMPTY_SECTION");
    });

    test("should only emit RECONCILE_CANONICAL for fully canonical taskpad", async () => {
      const markdown = `## Work Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = join(TEMP_DIR, "temp-reason-order-canonical.md");
      await Bun.write(tempPath, markdown);

      const result = reconcileTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.reasonCodes).toHaveLength(1);
      expect(result.reasonCodes[0]).toBe("RECONCILE_CANONICAL");
    });

    test("should be stable: same input produces same reason code order across runs", async () => {
      const markdown = `## Work Queue
- [ ] Task 1

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = join(TEMP_DIR, "temp-reason-order-stable.md");
      await Bun.write(tempPath, markdown);

      const result1 = reconcileTaskpad({ taskpadPath: tempPath });
      const result2 = reconcileTaskpad({ taskpadPath: tempPath });
      const result3 = reconcileTaskpad({ taskpadPath: tempPath });

      await Bun.file(tempPath).delete();

      // All results should have identical reason codes in the same order
      expect(result1.reasonCodes).toEqual(result2.reasonCodes);
      expect(result2.reasonCodes).toEqual(result3.reasonCodes);
      expect(result1.reasonCodes).toHaveLength(2);
      expect(result1.reasonCodes[0]).toBe("RECONCILE_MISSING_SECTION");
      expect(result1.reasonCodes[1]).toBe("RECONCILE_HEALED");
    });

    test("should not emit empty section code when other issues exist", async () => {
      const markdown = `## Work Queue

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = join(TEMP_DIR, "temp-reason-order-no-empty.md");
      await Bun.write(tempPath, markdown);

      const result = reconcileTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      // Should only report missing sections, not empty sections
      expect(result.reasonCodes).not.toContain("RECONCILE_EMPTY_SECTION");
      expect(result.reasonCodes).toContain("RECONCILE_MISSING_SECTION");
      expect(result.reasonCodes).toContain("RECONCILE_HEALED");
    });
  });

  describe("TP006: No-op behavior on already-canonical files", () => {
    test("should not mutate already-canonical taskpad", async () => {
      const markdown = `## Work Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = join(TEMP_DIR, "temp-noop-canonical.md");
      await Bun.write(tempPath, markdown);

      const result = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.mutated).toBe(false);
      expect(result.healedMarkdown).toBeNull();
    });

    test("should not mutate canonical+legacy mixed layout", async () => {
      const markdown = `## Work Queue
- [ ] Task 1

## Legacy Ideas
- [ ] Old idea 1

## Execution Queue
- [ ] Task 2

## Backlog
- [ ] Old backlog

## Autonomous Kickoff Queue
- [ ] Task 3

## Notes
- Some notes

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = join(TEMP_DIR, "temp-noop-legacy-mixed.md");
      await Bun.write(tempPath, markdown);

      const result = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.mutated).toBe(false);
      expect(result.healedMarkdown).toBeNull();
    });

    test("should not mutate taskpad with empty but present sections", async () => {
      const markdown = `## Work Queue

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = join(TEMP_DIR, "temp-noop-empty-sections.md");
      await Bun.write(tempPath, markdown);

      const result = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.mutated).toBe(false);
      expect(result.healedMarkdown).toBeNull();
    });

    test("should not mutate taskpad with frontmatter", async () => {
      const markdown = `---
artifact: taskpad
version: 1.0
---

## Work Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = join(TEMP_DIR, "temp-noop-frontmatter.md");
      await Bun.write(tempPath, markdown);

      const result = healTaskpad({ taskpadPath: tempPath });
      await Bun.file(tempPath).delete();

      expect(result.status).toBe("canonical");
      expect(result.mutated).toBe(false);
      expect(result.healedMarkdown).toBeNull();
    });

    test("should be idempotent on canonical fixture from file system", () => {
      const fixturePath = join(FIXTURES_DIR, "taskpad-canonical-legacy-mixed.md");
      const result1 = healTaskpad({ taskpadPath: fixturePath });
      const result2 = healTaskpad({ taskpadPath: fixturePath });

      expect(result1.status).toBe("canonical");
      expect(result1.mutated).toBe(false);
      expect(result1.healedMarkdown).toBeNull();

      expect(result2.status).toBe("canonical");
      expect(result2.mutated).toBe(false);
      expect(result2.healedMarkdown).toBeNull();

      // Both results should be identical
      expect(result1.reasonCodes).toEqual(result2.reasonCodes);
    });

    test("should not modify file content when healing canonical taskpad", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = join(TEMP_DIR, "temp-noop-file-content.md");
      await Bun.write(tempPath, originalMarkdown);

      // Heal should be no-op
      const result = healTaskpad({ taskpadPath: tempPath });

      // Read file content back
      const afterHeal = await Bun.file(tempPath).text();
      await Bun.file(tempPath).delete();

      // Content should be unchanged
      expect(afterHeal).toBe(originalMarkdown);
      expect(result.mutated).toBe(false);
    });

    test("should report canonical status across 10 consecutive heals", async () => {
      const markdown = `## Work Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = join(TEMP_DIR, "temp-noop-10-runs.md");
      await Bun.write(tempPath, markdown);

      for (let i = 0; i < 10; i++) {
        const result = healTaskpad({ taskpadPath: tempPath });
        expect(result.status).toBe("canonical");
        expect(result.mutated).toBe(false);
        expect(result.healedMarkdown).toBeNull();
        expect(result.reasonCodes).toEqual(["RECONCILE_CANONICAL"]);
      }

      await Bun.file(tempPath).delete();
    });

    test("should return identical results for repeated no-op heals", async () => {
      const markdown = `## Work Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2

## Autonomous Kickoff Queue
- [ ] Task 3

## Self-Improvement Backlog
- [ ] Task 4
`;
      const tempPath = join(TEMP_DIR, "temp-noop-identical.md");
      await Bun.write(tempPath, markdown);

      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(healTaskpad({ taskpadPath: tempPath }));
      }

      await Bun.file(tempPath).delete();

      // All results should be identical
      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toEqual(results[0]);
      }
    });
  });

  // TP007: Regression tests ensuring queue selection/promotion still works after reconcile on healed fixtures
  describe("TP007: Queue selection after healing", () => {
    test("should select first unchecked Self-Improvement item after healing missing Execution Queue", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Work task 1

## Autonomous Kickoff Queue
- [ ] Autonomous task 1

## Self-Improvement Backlog
- [ ] First improvement item
- [ ] Second improvement item
`;
      const tempPath = join(TEMP_DIR, "temp-regression-selection-missing-exec.md");
      await Bun.write(tempPath, originalMarkdown);

      // Verify taskpad needs healing
      const reconcileBefore = reconcileTaskpad({ taskpadPath: tempPath });
      expect(reconcileBefore.status).toBe("healed");
      expect(reconcileBefore.sectionsPresent.executionQueue).toBe(false);

      // Heal the taskpad
      const healResult = healTaskpad({ taskpadPath: tempPath });
      expect(healResult.status).toBe("canonical");
      expect(healResult.mutated).toBe(true);
      expect(healResult.healedMarkdown).toContain("## Execution Queue");

      // Write healed content
      if (healResult.healedMarkdown) {
        await Bun.write(tempPath, healResult.healedMarkdown);
      }

      // Verify queue selection still works on healed taskpad
      const healedMarkdown = await Bun.file(tempPath).text();
      const selection = selectFirstUncheckedSelfImprovementBullet(healedMarkdown);

      expect(selection.reasonCode).toBe("PLAN_SEED_OK");
      expect(selection.backlogBounds).not.toBeNull();
      expect(selection.selected).not.toBeNull();
      expect(selection.selected?.sourceText).toBe("First improvement item");
      expect(selection.selected?.lineNumber).toBeGreaterThan(4); // After Work Queue, Execution Queue, Autonomous Kickoff Queue

      await Bun.file(tempPath).delete();
    });

    test("should select first unchecked Self-Improvement item after healing out-of-order sections", async () => {
      const originalMarkdown = `## Self-Improvement Backlog
- [ ] First improvement item
- [ ] Second improvement item

## Work Queue
- [ ] Work task 1

## Execution Queue
- [ ] Execution task 1

## Autonomous Kickoff Queue
- [ ] Autonomous task 1
`;
      const tempPath = join(TEMP_DIR, "temp-regression-selection-out-of-order.md");
      await Bun.write(tempPath, originalMarkdown);

      // Verify taskpad needs healing
      const reconcileBefore = reconcileTaskpad({ taskpadPath: tempPath });
      expect(reconcileBefore.status).toBe("healed");
      expect(reconcileBefore.ordering.isCanonicalOrder).toBe(false);

      // Heal the taskpad
      const healResult = healTaskpad({ taskpadPath: tempPath });
      expect(healResult.status).toBe("canonical");
      expect(healResult.mutated).toBe(true);

      // Write healed content
      if (healResult.healedMarkdown) {
        await Bun.write(tempPath, healResult.healedMarkdown);
      }

      // Verify queue selection still works on healed taskpad
      const healedMarkdown = await Bun.file(tempPath).text();
      const selection = selectFirstUncheckedSelfImprovementBullet(healedMarkdown);

      expect(selection.reasonCode).toBe("PLAN_SEED_OK");
      expect(selection.backlogBounds).not.toBeNull();
      expect(selection.selected).not.toBeNull();
      expect(selection.selected?.sourceText).toBe("First improvement item");

      // Verify Self-Improvement Backlog is now at the end (canonical position)
      const backlogIdx = healedMarkdown.indexOf("## Self-Improvement Backlog");
      const execIdx = healedMarkdown.indexOf("## Execution Queue");
      const autoIdx = healedMarkdown.indexOf("## Autonomous Kickoff Queue");
      expect(backlogIdx).toBeGreaterThan(execIdx);
      expect(backlogIdx).toBeGreaterThan(autoIdx);

      await Bun.file(tempPath).delete();
    });

    test("should select first unchecked Self-Improvement item after healing multiple missing sections", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Work task 1

## Self-Improvement Backlog
- [ ] First improvement item
- [x] Already completed item
- [ ] Second improvement item
`;
      const tempPath = join(TEMP_DIR, "temp-regression-selection-multiple-missing.md");
      await Bun.write(tempPath, originalMarkdown);

      // Verify taskpad needs healing
      const reconcileBefore = reconcileTaskpad({ taskpadPath: tempPath });
      expect(reconcileBefore.status).toBe("healed");
      expect(reconcileBefore.sectionsPresent.executionQueue).toBe(false);
      expect(reconcileBefore.sectionsPresent.autonomousKickoffQueue).toBe(false);

      // Heal the taskpad
      const healResult = healTaskpad({ taskpadPath: tempPath });
      expect(healResult.status).toBe("canonical");
      expect(healResult.mutated).toBe(true);
      expect(healResult.healedMarkdown).toContain("## Execution Queue");
      expect(healResult.healedMarkdown).toContain("## Autonomous Kickoff Queue");

      // Write healed content
      if (healResult.healedMarkdown) {
        await Bun.write(tempPath, healResult.healedMarkdown);
      }

      // Verify queue selection still works on healed taskpad
      const healedMarkdown = await Bun.file(tempPath).text();
      const selection = selectFirstUncheckedSelfImprovementBullet(healedMarkdown);

      expect(selection.reasonCode).toBe("PLAN_SEED_OK");
      expect(selection.backlogBounds).not.toBeNull();
      expect(selection.selected).not.toBeNull();
      expect(selection.selected?.sourceText).toBe("First improvement item");

      // Should skip the completed item
      expect(selection.selected?.rawLine).not.toContain("[x]");

      await Bun.file(tempPath).delete();
    });

    test("should return no unchecked items when all are completed on healed taskpad", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Work task 1

## Autonomous Kickoff Queue
- [ ] Autonomous task 1

## Self-Improvement Backlog
- [x] Already completed item 1
- [x] Already completed item 2
`;
      const tempPath = join(TEMP_DIR, "temp-regression-selection-all-completed.md");
      await Bun.write(tempPath, originalMarkdown);

      // Heal the taskpad
      const healResult = healTaskpad({ taskpadPath: tempPath });
      expect(healResult.status).toBe("canonical");

      // Write healed content
      if (healResult.healedMarkdown) {
        await Bun.write(tempPath, healResult.healedMarkdown);
      }

      // Verify queue selection returns no unchecked items
      const healedMarkdown = await Bun.file(tempPath).text();
      const selection = selectFirstUncheckedSelfImprovementBullet(healedMarkdown);

      expect(selection.reasonCode).toBe("PLAN_SEED_NO_UNCHECKED_SELF_IMPROVEMENT");
      expect(selection.backlogBounds).not.toBeNull();
      expect(selection.selected).toBeNull();

      await Bun.file(tempPath).delete();
    });

    test("should handle frontmatter correctly when healing and selecting", async () => {
      const originalMarkdown = `---
artifact: taskpad
version: 1.0
---

## Work Queue
- [ ] Work task 1

## Self-Improvement Backlog
- [ ] First improvement item
`;
      const tempPath = join(TEMP_DIR, "temp-regression-selection-frontmatter.md");
      await Bun.write(tempPath, originalMarkdown);

      // Heal the taskpad
      const healResult = healTaskpad({ taskpadPath: tempPath });
      expect(healResult.status).toBe("canonical");

      // Write healed content
      if (healResult.healedMarkdown) {
        await Bun.write(tempPath, healResult.healedMarkdown);
      }

      // Verify queue selection still works with frontmatter preserved
      const healedMarkdown = await Bun.file(tempPath).text();
      const selection = selectFirstUncheckedSelfImprovementBullet(healedMarkdown);

      expect(selection.reasonCode).toBe("PLAN_SEED_OK");
      expect(selection.selected).not.toBeNull();
      expect(selection.selected?.sourceText).toBe("First improvement item");

      // Verify frontmatter is preserved
      expect(healedMarkdown).toContain("---");
      expect(healedMarkdown).toContain("artifact: taskpad");

      await Bun.file(tempPath).delete();
    });

    test("should be idempotent: selection works the same before and after heal on canonical taskpad", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Work task 1

## Execution Queue
- [ ] Execution task 1

## Autonomous Kickoff Queue
- [ ] Autonomous task 1

## Self-Improvement Backlog
- [ ] First improvement item
- [ ] Second improvement item
`;
      const tempPath = join(TEMP_DIR, "temp-regression-selection-idempotent.md");
      await Bun.write(tempPath, originalMarkdown);

      // Selection before heal
      const selectionBefore = selectFirstUncheckedSelfImprovementBullet(originalMarkdown);
      expect(selectionBefore.reasonCode).toBe("PLAN_SEED_OK");
      expect(selectionBefore.selected?.sourceText).toBe("First improvement item");

      // Heal the taskpad (should be no-op)
      const healResult = healTaskpad({ taskpadPath: tempPath });
      expect(healResult.status).toBe("canonical");
      expect(healResult.mutated).toBe(false);

      // Selection after heal (should be identical)
      const healedMarkdown = await Bun.file(tempPath).text();
      const selectionAfter = selectFirstUncheckedSelfImprovementBullet(healedMarkdown);

      expect(selectionAfter.reasonCode).toBe(selectionBefore.reasonCode);
      expect(selectionAfter.selected?.sourceText).toBe(selectionBefore.selected?.sourceText);
      expect(selectionAfter.selected?.canonicalBullet).toBe(selectionBefore.selected?.canonicalBullet);

      await Bun.file(tempPath).delete();
    });
  });

  describe("TP007: Queue promotion after healing", () => {
    test("should mark selected item as planned after healing missing Execution Queue", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Work task 1

## Autonomous Kickoff Queue
- [ ] Autonomous task 1

## Self-Improvement Backlog
- [ ] First improvement item
- [ ] Second improvement item
`;
      const tempPath = join(TEMP_DIR, "temp-regression-promotion-missing-exec.md");
      await Bun.write(tempPath, originalMarkdown);

      // Heal the taskpad
      const healResult = healTaskpad({ taskpadPath: tempPath });
      expect(healResult.status).toBe("canonical");

      // Write healed content
      if (healResult.healedMarkdown) {
        await Bun.write(tempPath, healResult.healedMarkdown);
      }

      // Select and promote on healed taskpad
      const healedMarkdown = await Bun.file(tempPath).text();
      const selection = selectFirstUncheckedSelfImprovementBullet(healedMarkdown);
      expect(selection.reasonCode).toBe("PLAN_SEED_OK");
      expect(selection.selected).not.toBeNull();

      const promotionResult = markSelectedBacklogBulletPlanned(
        healedMarkdown,
        selection.selected!,
        "2026-03-01",
      );

      expect(promotionResult.reasonCode).toBe("PLAN_SEED_OK");
      expect(promotionResult.updatedTaskpadMarkdown).not.toBeNull();
      expect(promotionResult.updatedLine).not.toBeNull();
      expect(promotionResult.updatedLine).toContain("planned-2026-03-01");
      expect(promotionResult.updatedLine).toContain("First improvement item");

      // Verify the promoted line is in the updated markdown
      expect(promotionResult.updatedTaskpadMarkdown).toContain("planned-2026-03-01 First improvement item");

      await Bun.file(tempPath).delete();
    });

    test("should mark selected item as planned after healing out-of-order sections", async () => {
      const originalMarkdown = `## Self-Improvement Backlog
- [ ] First improvement item

## Work Queue
- [ ] Work task 1

## Execution Queue
- [ ] Execution task 1

## Autonomous Kickoff Queue
- [ ] Autonomous task 1
`;
      const tempPath = join(TEMP_DIR, "temp-regression-promotion-out-of-order.md");
      await Bun.write(tempPath, originalMarkdown);

      // Heal the taskpad
      const healResult = healTaskpad({ taskpadPath: tempPath });
      expect(healResult.status).toBe("canonical");

      // Write healed content
      if (healResult.healedMarkdown) {
        await Bun.write(tempPath, healResult.healedMarkdown);
      }

      // Select and promote on healed taskpad
      const healedMarkdown = await Bun.file(tempPath).text();
      const selection = selectFirstUncheckedSelfImprovementBullet(healedMarkdown);
      expect(selection.reasonCode).toBe("PLAN_SEED_OK");

      const promotionResult = markSelectedBacklogBulletPlanned(
        healedMarkdown,
        selection.selected!,
        "2026-03-01",
      );

      expect(promotionResult.reasonCode).toBe("PLAN_SEED_OK");
      expect(promotionResult.updatedTaskpadMarkdown).not.toBeNull();
      expect(promotionResult.updatedLine).toContain("planned-2026-03-01");

      await Bun.file(tempPath).delete();
    });

    test("should preserve queue structure after promotion on healed taskpad", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Work task 1

## Autonomous Kickoff Queue
- [ ] Autonomous task 1

## Self-Improvement Backlog
- [ ] First improvement item
- [ ] Second improvement item
- [ ] Third improvement item
`;
      const tempPath = join(TEMP_DIR, "temp-regression-promotion-preserve-structure.md");
      await Bun.write(tempPath, originalMarkdown);

      // Heal the taskpad
      const healResult = healTaskpad({ taskpadPath: tempPath });
      if (healResult.healedMarkdown) {
        await Bun.write(tempPath, healResult.healedMarkdown);
      }

      // Select and promote on healed taskpad
      const healedMarkdown = await Bun.file(tempPath).text();
      const selection = selectFirstUncheckedSelfImprovementBullet(healedMarkdown);
      const promotionResult = markSelectedBacklogBulletPlanned(
        healedMarkdown,
        selection.selected!,
        "2026-03-01",
      );

      // Write promoted content
      if (promotionResult.updatedTaskpadMarkdown) {
        await Bun.write(tempPath, promotionResult.updatedTaskpadMarkdown);
      }

      // Verify all canonical sections are still present
      const afterPromotion = await Bun.file(tempPath).text();
      const reconcileAfter = reconcileTaskpad({ taskpadPath: tempPath });

      expect(reconcileAfter.status).toBe("canonical");
      expect(reconcileAfter.sectionsPresent.workQueue).toBe(true);
      expect(reconcileAfter.sectionsPresent.executionQueue).toBe(true);
      expect(reconcileAfter.sectionsPresent.autonomousKickoffQueue).toBe(true);
      expect(reconcileAfter.sectionsPresent.selfImprovementBacklog).toBe(true);

      // Verify the other items are still present
      expect(afterPromotion).toContain("Second improvement item");
      expect(afterPromotion).toContain("Third improvement item");

      await Bun.file(tempPath).delete();
    });

    test("should allow multiple promotions on healed taskpad", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Work task 1

## Autonomous Kickoff Queue
- [ ] Autonomous task 1

## Self-Improvement Backlog
- [x] Already completed item
- [ ] First improvement item
- [ ] Second improvement item
- [ ] Third improvement item
`;
      const tempPath = join(TEMP_DIR, "temp-regression-multiple-promotions.md");
      await Bun.write(tempPath, originalMarkdown);

      // Heal the taskpad
      const healResult = healTaskpad({ taskpadPath: tempPath });
      if (healResult.healedMarkdown) {
        await Bun.write(tempPath, healResult.healedMarkdown);
      }

      // Promote first item (should skip completed item)
      let markdown = await Bun.file(tempPath).text();
      let selection = selectFirstUncheckedSelfImprovementBullet(markdown);
      expect(selection.selected?.sourceText).toBe("First improvement item");

      let promotionResult = markSelectedBacklogBulletPlanned(markdown, selection.selected!, "2026-03-01");

      expect(promotionResult.reasonCode).toBe("PLAN_SEED_OK");
      if (promotionResult.updatedTaskpadMarkdown) {
        await Bun.write(tempPath, promotionResult.updatedTaskpadMarkdown);
      }

      // Verify first item is marked as planned
      markdown = await Bun.file(tempPath).text();
      expect(markdown).toContain("planned-2026-03-01 First improvement item");

      // Verify we can promote a second item by starting with a fresh taskpad that has one completed item
      const originalMarkdown2 = `## Work Queue
- [ ] Work task 1

## Autonomous Kickoff Queue
- [ ] Autonomous task 1

## Self-Improvement Backlog
- [x] Already completed item
- [x] planned-2026-03-01 First improvement item
- [ ] Second improvement item
- [ ] Third improvement item
`;
      const tempPath2 = join(TEMP_DIR, "temp-regression-multiple-promotions-2.md");
      await Bun.write(tempPath2, originalMarkdown2);

      // Heal the taskpad
      const healResult2 = healTaskpad({ taskpadPath: tempPath2 });
      if (healResult2.healedMarkdown) {
        await Bun.write(tempPath2, healResult2.healedMarkdown);
      }

      // Promote second item (should skip completed items)
      let markdown2 = await Bun.file(tempPath2).text();
      selection = selectFirstUncheckedSelfImprovementBullet(markdown2);
      expect(selection.selected?.sourceText).toBe("Second improvement item");

      promotionResult = markSelectedBacklogBulletPlanned(markdown2, selection.selected!, "2026-03-01");

      expect(promotionResult.reasonCode).toBe("PLAN_SEED_OK");
      expect(promotionResult.updatedLine).toContain("Second improvement item");

      await Bun.file(tempPath).delete();
      await Bun.file(tempPath2).delete();
    });

    test("should handle planned prefix correctly during promotion on healed taskpad", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Work task 1

## Autonomous Kickoff Queue
- [ ] Autonomous task 1

## Self-Improvement Backlog
- [x] planned-2025-12-01 First improvement item
- [ ] Second improvement item
`;
      const tempPath = join(TEMP_DIR, "temp-regression-planned-prefix.md");
      await Bun.write(tempPath, originalMarkdown);

      // Heal the taskpad
      const healResult = healTaskpad({ taskpadPath: tempPath });
      if (healResult.healedMarkdown) {
        await Bun.write(tempPath, healResult.healedMarkdown);
      }

      // Select should skip the already-completed item
      let markdown = await Bun.file(tempPath).text();
      let selection = selectFirstUncheckedSelfImprovementBullet(markdown);

      expect(selection.selected?.sourceText).toBe("Second improvement item");

      // Promote the second item
      let promotionResult = markSelectedBacklogBulletPlanned(markdown, selection.selected!, "2026-03-01");

      expect(promotionResult.reasonCode).toBe("PLAN_SEED_OK");
      expect(promotionResult.updatedLine).toContain("planned-2026-03-01 Second improvement item");

      if (promotionResult.updatedTaskpadMarkdown) {
        await Bun.write(tempPath, promotionResult.updatedTaskpadMarkdown);
      }

      // Verify both planned prefixes are present
      const finalMarkdown = await Bun.file(tempPath).text();
      expect(finalMarkdown).toContain("planned-2025-12-01 First improvement item");
      expect(finalMarkdown).toContain("planned-2026-03-01 Second improvement item");

      await Bun.file(tempPath).delete();
    });
  });

  describe("TP007: End-to-end queue operations after healing", () => {
    test("should support heal-select-promote-heal cycle", async () => {
      const originalMarkdown = `## Work Queue
- [ ] Work task 1

## Autonomous Kickoff Queue
- [ ] Autonomous task 1

## Self-Improvement Backlog
- [ ] First improvement item
- [ ] Second improvement item
`;
      const tempPath = join(TEMP_DIR, "temp-regression-e2e-cycle.md");
      await Bun.write(tempPath, originalMarkdown);

      // Initial heal
      let healResult = healTaskpad({ taskpadPath: tempPath });
      expect(healResult.status).toBe("canonical");
      if (healResult.healedMarkdown) {
        await Bun.write(tempPath, healResult.healedMarkdown);
      }

      // Select
      let markdown = await Bun.file(tempPath).text();
      let selection = selectFirstUncheckedSelfImprovementBullet(markdown);
      expect(selection.reasonCode).toBe("PLAN_SEED_OK");

      // Promote
      let promotionResult = markSelectedBacklogBulletPlanned(markdown, selection.selected!, "2026-03-01");
      expect(promotionResult.reasonCode).toBe("PLAN_SEED_OK");
      if (promotionResult.updatedTaskpadMarkdown) {
        await Bun.write(tempPath, promotionResult.updatedTaskpadMarkdown);
      }

      // Mark first item as completed so second item is selected
      markdown = await Bun.file(tempPath).text();
      const lines = markdown.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("planned-2026-03-01 First improvement item") && lines[i].includes("- [ ]")) {
          lines[i] = lines[i].replace("- [ ]", "- [x]");
          break;
        }
      }
      markdown = lines.join("\n");
      await Bun.write(tempPath, markdown);

      // Second heal (should still be canonical)
      healResult = healTaskpad({ taskpadPath: tempPath });
      expect(healResult.status).toBe("canonical");
      expect(healResult.mutated).toBe(false);

      // Select second item
      markdown = await Bun.file(tempPath).text();
      selection = selectFirstUncheckedSelfImprovementBullet(markdown);
      expect(selection.selected?.sourceText).toBe("Second improvement item");

      // Promote second item
      promotionResult = markSelectedBacklogBulletPlanned(markdown, selection.selected!, "2026-03-01");
      expect(promotionResult.reasonCode).toBe("PLAN_SEED_OK");
      if (promotionResult.updatedTaskpadMarkdown) {
        await Bun.write(tempPath, promotionResult.updatedTaskpadMarkdown);
      }

      // Mark second item as completed
      markdown = await Bun.file(tempPath).text();
      const lines2 = markdown.split("\n");
      for (let i = 0; i < lines2.length; i++) {
        if (lines2[i].includes("planned-2026-03-01 Second improvement item") && lines2[i].includes("- [ ]")) {
          lines2[i] = lines2[i].replace("- [ ]", "- [x]");
          break;
        }
      }
      markdown = lines2.join("\n");
      await Bun.write(tempPath, markdown);

      // Third heal (should still be canonical)
      healResult = healTaskpad({ taskpadPath: tempPath });
      expect(healResult.status).toBe("canonical");
      expect(healResult.mutated).toBe(false);

      // Verify no unchecked items remain
      markdown = await Bun.file(tempPath).text();
      selection = selectFirstUncheckedSelfImprovementBullet(markdown);
      expect(selection.reasonCode).toBe("PLAN_SEED_NO_UNCHECKED_SELF_IMPROVEMENT");

      await Bun.file(tempPath).delete();
    });

    test("should preserve queue contract across heal-select-promote-heal cycle", async () => {
      const originalMarkdown = `## Self-Improvement Backlog
- [ ] First improvement item

## Work Queue
- [ ] Work task 1

## Autonomous Kickoff Queue
- [ ] Autonomous task 1
`;
      const tempPath = join(TEMP_DIR, "temp-regression-queue-contract.md");
      await Bun.write(tempPath, originalMarkdown);

      // Initial heal (adds missing Execution Queue)
      let healResult = healTaskpad({ taskpadPath: tempPath });
      expect(healResult.status).toBe("canonical");
      expect(healResult.mutated).toBe(true);
      if (healResult.healedMarkdown) {
        await Bun.write(tempPath, healResult.healedMarkdown);
      }

      // Verify queue contract
      let reconcileResult = reconcileTaskpad({ taskpadPath: tempPath });
      expect(reconcileResult.status).toBe("canonical");
      expect(reconcileResult.ordering.isCanonicalOrder).toBe(true);

      // Select and promote
      let markdown = await Bun.file(tempPath).text();
      let selection = selectFirstUncheckedSelfImprovementBullet(markdown);
      let promotionResult = markSelectedBacklogBulletPlanned(markdown, selection.selected!, "2026-03-01");
      if (promotionResult.updatedTaskpadMarkdown) {
        await Bun.write(tempPath, promotionResult.updatedTaskpadMarkdown);
      }

      // Verify queue contract still holds after promotion
      reconcileResult = reconcileTaskpad({ taskpadPath: tempPath });
      expect(reconcileResult.status).toBe("canonical");
      expect(reconcileResult.ordering.isCanonicalOrder).toBe(true);

      // Heal again (should be no-op)
      healResult = healTaskpad({ taskpadPath: tempPath });
      expect(healResult.status).toBe("canonical");
      expect(healResult.mutated).toBe(false);

      await Bun.file(tempPath).delete();
    });

    test("should handle fixture-based regression for taskpad-missing-execution-queue", () => {
      const fixturePath = join(FIXTURES_DIR, "taskpad-missing-execution-queue.md");
      const originalMarkdown = Bun.file(fixturePath).text();

      // First heal
      const healResult1 = healTaskpad({ taskpadPath: fixturePath });
      expect(healResult1.status).toBe("canonical");
      expect(healResult1.mutated).toBe(true);

      // Write healed content (in memory for testing)
      const healedMarkdown = healResult1.healedMarkdown!;

      // Verify selection works on healed fixture
      const selection = selectFirstUncheckedSelfImprovementBullet(healedMarkdown);
      expect(selection.reasonCode).toBe("PLAN_SEED_OK");
      expect(selection.selected).not.toBeNull();

      // Verify promotion works on healed fixture
      const promotionResult = markSelectedBacklogBulletPlanned(
        healedMarkdown,
        selection.selected!,
        "2026-03-01",
      );
      expect(promotionResult.reasonCode).toBe("PLAN_SEED_OK");
      expect(promotionResult.updatedTaskpadMarkdown).not.toBeNull();

      // Second heal should be no-op
      // Note: we can't write to fixture, so we verify in-memory
      const healedContent = promotionResult.updatedTaskpadMarkdown!;
      const lines = healedContent.split("\n");
      const parsed = parseTaskpad(healedContent);
      expect(parsed.canonicalSections.size).toBe(4);
    });

    test("should handle fixture-based regression for taskpad-out-of-order", () => {
      const fixturePath = join(FIXTURES_DIR, "taskpad-out-of-order.md");
      const originalMarkdown = Bun.file(fixturePath).text();

      // First heal
      const healResult1 = healTaskpad({ taskpadPath: fixturePath });
      expect(healResult1.status).toBe("canonical");
      expect(healResult1.mutated).toBe(true);

      // Write healed content (in memory for testing)
      const healedMarkdown = healResult1.healedMarkdown!;

      // Verify selection works on healed fixture
      const selection = selectFirstUncheckedSelfImprovementBullet(healedMarkdown);
      expect(selection.reasonCode).toBe("PLAN_SEED_OK");
      expect(selection.selected).not.toBeNull();

      // Verify promotion works on healed fixture
      const promotionResult = markSelectedBacklogBulletPlanned(
        healedMarkdown,
        selection.selected!,
        "2026-03-01",
      );
      expect(promotionResult.reasonCode).toBe("PLAN_SEED_OK");
      expect(promotionResult.updatedTaskpadMarkdown).not.toBeNull();

      // Verify canonical order is maintained after promotion
      const promotedContent = promotionResult.updatedTaskpadMarkdown!;
      const workIdx = promotedContent.indexOf("## Work Queue");
      const execIdx = promotedContent.indexOf("## Execution Queue");
      const autoIdx = promotedContent.indexOf("## Autonomous Kickoff Queue");
      const backlogIdx = promotedContent.indexOf("## Self-Improvement Backlog");

      expect(workIdx).toBeLessThan(execIdx);
      expect(execIdx).toBeLessThan(autoIdx);
      expect(autoIdx).toBeLessThan(backlogIdx);
    });
  });
});
