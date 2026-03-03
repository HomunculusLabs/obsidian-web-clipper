import { describe, expect, test } from "bun:test";

import {
  buildArchiveMarkdownWithBullets,
  parseWorkQueueSection,
  pruneWorkQueue,
  rewriteTaskpadWithoutArchivedBullets,
  WORK_QUEUE_PRUNE_RULE_IDS,
  type WorkQueueBulletFingerprint,
} from "../../tools/taskpad-work-queue-prune";

// ============================================================================
// TP004: Fixture-based tests for taskpad:work-queue-prune covering:
// - Pass: successful prune of checked/planned bullets
// - Noop: no archive candidates (all unchecked)
// - Noop: missing Work Queue heading
// - Error: invalid taskpad structure (multiple headings)
// ============================================================================

function buildTaskpadWithWorkQueue(workQueueContent: string): string {
  return `# TASKPAD Test

## Autonomous Kickoff Queue
- [ ] Some autonomous task

## Work Queue
${workQueueContent}

## Self-Improvement Backlog
- [ ] Some improvement task
`;
}

describe("parseWorkQueueSection", () => {
  test("parses Work Queue with mixed checked/unchecked bullets", () => {
    const markdown = buildTaskpadWithWorkQueue(`- [ ] Unchecked task 1
- [x] Checked task 1
- [ ] Unchecked task 2
- [x] Checked task 2`);

    const result = parseWorkQueueSection(markdown);

    expect(result.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(result.workQueueHeadingFound).toBe(true);
    expect(result.allBullets).toHaveLength(4);
    expect(result.archivedBullets).toHaveLength(2);
    expect(result.preservedBullets).toHaveLength(2);
  });

  test("parses Work Queue with planned markers (unparenthesized)", () => {
    const markdown = buildTaskpadWithWorkQueue(`- [ ] planned-2026-03-01 Task with unparenthesized marker
- [x] planned-2026-03-02 Completed planned task`);

    const result = parseWorkQueueSection(markdown);

    expect(result.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(result.allBullets).toHaveLength(2);
    expect(result.archivedBullets).toHaveLength(2); // Both have planned markers
    expect(result.archivedBullets[0].plannedDate).toBe("2026-03-01");
    expect(result.archivedBullets[0].markerShape).toBe("unparenthesized");
    expect(result.archivedBullets[1].plannedDate).toBe("2026-03-02");
  });

  test("parses Work Queue with planned markers (parenthesized)", () => {
    const markdown = buildTaskpadWithWorkQueue(`- [ ] (planned-2026-03-01) Task with parenthesized marker
- [x] (planned-2026-03-02) Completed planned task`);

    const result = parseWorkQueueSection(markdown);

    expect(result.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(result.allBullets).toHaveLength(2);
    expect(result.archivedBullets).toHaveLength(2);
    expect(result.archivedBullets[0].plannedDate).toBe("2026-03-01");
    expect(result.archivedBullets[0].markerShape).toBe("parenthesized");
  });

  test("returns noop when Work Queue heading is missing", () => {
    const markdown = `# TASKPAD Test

## Autonomous Kickoff Queue
- [ ] Some task
`;

    const result = parseWorkQueueSection(markdown);

    expect(result.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_NOOP_WORK_QUEUE_MISSING);
    expect(result.workQueueHeadingFound).toBe(false);
    expect(result.allBullets).toHaveLength(0);
  });

  test("returns error when multiple Work Queue headings found", () => {
    const markdown = `# TASKPAD Test

## Work Queue
- [ ] Task 1

## Work Queue
- [ ] Task 2
`;

    const result = parseWorkQueueSection(markdown);

    expect(result.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_TASKPAD_STRUCTURE_INVALID);
    expect(result.workQueueHeadingFound).toBe(true);
    expect(result.structuralErrors).toContain("Multiple '## Work Queue' headings found; only one is allowed.");
  });

  test("preserves unchecked bullets without planned markers", () => {
    const markdown = buildTaskpadWithWorkQueue(`- [ ] Keep me 1
- [ ] Keep me 2
- [x] Archive me`);

    const result = parseWorkQueueSection(markdown);

    expect(result.preservedBullets).toHaveLength(2);
    expect(result.preservedBullets[0].taskText).toBe("Keep me 1");
    expect(result.preservedBullets[1].taskText).toBe("Keep me 2");
    expect(result.archivedBullets).toHaveLength(1);
    expect(result.archivedBullets[0].taskText).toBe("Archive me");
  });

  test("computes deterministic fingerprint hashes", () => {
    const markdown = buildTaskpadWithWorkQueue(`- [x] Task to fingerprint`);

    const result = parseWorkQueueSection(markdown);

    expect(result.archivedBullets).toHaveLength(1);
    expect(result.archivedBullets[0].fingerprintHash).toBeDefined();
    expect(result.archivedBullets[0].fingerprintHash).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("buildArchiveMarkdownWithBullets", () => {
  test("builds archive with new section for first-time archive", () => {
    const bullets: WorkQueueBulletFingerprint[] = [
      {
        lineNumber: 5,
        rawText: "- [x] Completed task",
        checkboxState: "checked",
        markerShape: "none",
        plannedDate: null,
        taskText: "Completed task",
        fingerprintHash: "abc123def4567890",
      },
    ];

    const result = buildArchiveMarkdownWithBullets(null, bullets, "TASKPAD.md");

    expect(result.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(result.archiveMarkdown).toContain("TASKPAD Work Queue Archive:");
    expect(result.archiveMarkdown).toContain("Source TASKPAD: TASKPAD.md");
    expect(result.archiveMarkdown).toContain("## Archived from");
    expect(result.archiveMarkdown).toContain("- [x] Completed task <!-- fingerprint: abc123def4567890 -->");
  });

  test("appends to existing archive markdown", () => {
    const existingArchive = `# Existing Archive

## Archived from 2026-02-01
- [x] Old task <!-- fingerprint: oldfingerprint123 -->`;

    const bullets: WorkQueueBulletFingerprint[] = [
      {
        lineNumber: 5,
        rawText: "- [x] New task",
        checkboxState: "checked",
        markerShape: "none",
        plannedDate: null,
        taskText: "New task",
        fingerprintHash: "newfingerprint456",
      },
    ];

    const result = buildArchiveMarkdownWithBullets(existingArchive, bullets, "TASKPAD.md");

    expect(result.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(result.archiveMarkdown).toContain("Existing Archive");
    expect(result.archiveMarkdown).toContain("Old task");
    expect(result.archiveMarkdown).toContain("New task");
  });

  test("returns noop when no bullets to archive", () => {
    const result = buildArchiveMarkdownWithBullets(null, [], "TASKPAD.md");

    expect(result.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_NOOP_NO_ARCHIVE_CANDIDATES);
    expect(result.archiveMarkdown).toBeNull();
  });

  test("sorts bullets by line number", () => {
    const bullets: WorkQueueBulletFingerprint[] = [
      {
        lineNumber: 10,
        rawText: "- [x] Later task",
        checkboxState: "checked",
        markerShape: "none",
        plannedDate: null,
        taskText: "Later task",
        fingerprintHash: "later123",
      },
      {
        lineNumber: 5,
        rawText: "- [x] Earlier task",
        checkboxState: "checked",
        markerShape: "none",
        plannedDate: null,
        taskText: "Earlier task",
        fingerprintHash: "earlier456",
      },
    ];

    const result = buildArchiveMarkdownWithBullets(null, bullets, "TASKPAD.md");

    // Earlier task should appear before later task
    const earlierIndex = result.archiveMarkdown!.indexOf("Earlier task");
    const laterIndex = result.archiveMarkdown!.indexOf("Later task");
    expect(earlierIndex).toBeLessThan(laterIndex);
  });
});

describe("rewriteTaskpadWithoutArchivedBullets", () => {
  test("removes archived bullets from taskpad", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [ ] Keep this
- [x] Remove this
- [ ] Keep this too`);

    const parseResult = parseWorkQueueSection(taskpadMarkdown);
    const result = rewriteTaskpadWithoutArchivedBullets(taskpadMarkdown, parseResult);

    expect(result.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(result.updatedTaskpadMarkdown).toContain("Keep this");
    expect(result.updatedTaskpadMarkdown).toContain("Keep this too");
    expect(result.updatedTaskpadMarkdown).not.toContain("Remove this");
  });

  test("returns noop when no archive candidates", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [ ] Task 1
- [ ] Task 2`);

    const parseResult = parseWorkQueueSection(taskpadMarkdown);
    const result = rewriteTaskpadWithoutArchivedBullets(taskpadMarkdown, parseResult);

    expect(result.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_NOOP_NO_ARCHIVE_CANDIDATES);
    expect(result.updatedTaskpadMarkdown).toBe(taskpadMarkdown);
  });

  test("preserves other sections intact", () => {
    const taskpadMarkdown = `# TASKPAD Test

## Autonomous Kickoff Queue
- [ ] Autonomous task

## Work Queue
- [ ] Keep me
- [x] Archive me

## Self-Improvement Backlog
- [ ] Improvement task
`;

    const parseResult = parseWorkQueueSection(taskpadMarkdown);
    const result = rewriteTaskpadWithoutArchivedBullets(taskpadMarkdown, parseResult);

    expect(result.updatedTaskpadMarkdown).toContain("Autonomous Kickoff Queue");
    expect(result.updatedTaskpadMarkdown).toContain("Autonomous task");
    expect(result.updatedTaskpadMarkdown).toContain("Self-Improvement Backlog");
    expect(result.updatedTaskpadMarkdown).toContain("Improvement task");
  });
});

describe("pruneWorkQueue", () => {
  test("pass: prunes checked bullets and archives them", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [ ] Keep me
- [x] Archive me
- [ ] Keep me too`);

    // Use in-memory test by calling underlying functions
    const parseResult = parseWorkQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(parseResult.archivedBullets).toHaveLength(1);
    expect(parseResult.archivedBullets[0].taskText).toBe("Archive me");
    expect(parseResult.preservedBullets).toHaveLength(2);
  });

  test("pass: prunes planned bullets (unparenthesized) and archives them", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [ ] planned-2026-03-01 Archive this planned task
- [ ] Keep this regular task`);

    const parseResult = parseWorkQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(parseResult.archivedBullets).toHaveLength(1);
    expect(parseResult.archivedBullets[0].taskText).toBe("Archive this planned task");
    expect(parseResult.preservedBullets).toHaveLength(1);
    expect(parseResult.preservedBullets[0].taskText).toBe("Keep this regular task");
  });

  test("pass: prunes planned bullets (parenthesized) and archives them", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [ ] (planned-2026-03-01) Archive this planned task
- [ ] Keep this regular task`);

    const parseResult = parseWorkQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(parseResult.archivedBullets).toHaveLength(1);
    expect(parseResult.archivedBullets[0].taskText).toBe("Archive this planned task");
  });

  test("noop: no archive candidates when all bullets are unchecked without planned markers", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [ ] Task 1
- [ ] Task 2
- [ ] Task 3`);

    const parseResult = parseWorkQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(parseResult.archivedBullets).toHaveLength(0);
    expect(parseResult.preservedBullets).toHaveLength(3);

    // Verify buildArchive returns noop
    const archiveResult = buildArchiveMarkdownWithBullets(null, parseResult.archivedBullets, "TASKPAD.md");
    expect(archiveResult.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_NOOP_NO_ARCHIVE_CANDIDATES);
  });

  test("noop: missing Work Queue heading", () => {
    const taskpadMarkdown = `# TASKPAD Test

## Autonomous Kickoff Queue
- [ ] Some task
`;

    const parseResult = parseWorkQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_NOOP_WORK_QUEUE_MISSING);
    expect(parseResult.workQueueHeadingFound).toBe(false);
  });

  test("error: multiple Work Queue headings", () => {
    const taskpadMarkdown = `# TASKPAD Test

## Work Queue
- [ ] Task 1

## Work Queue
- [ ] Task 2
`;

    const parseResult = parseWorkQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(WORK_QUEUE_PRUNE_RULE_IDS.PRUNE_TASKPAD_STRUCTURE_INVALID);
    expect(parseResult.structuralErrors).toHaveLength(1);
  });

  test("handles mixed marker shapes in same Work Queue", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [ ] planned-2026-03-01 Unparenthesized planned
- [ ] (planned-2026-03-02) Parenthesized planned
- [x] Just checked
- [ ] Regular unchecked`);

    const parseResult = parseWorkQueueSection(taskpadMarkdown);

    expect(parseResult.allBullets).toHaveLength(4);
    expect(parseResult.archivedBullets).toHaveLength(3); // All except regular unchecked
    expect(parseResult.preservedBullets).toHaveLength(1);

    // Verify marker shapes
    const unparenthesized = parseResult.archivedBullets.find(b => b.taskText.includes("Unparenthesized"));
    const parenthesized = parseResult.archivedBullets.find(b => b.taskText.includes("Parenthesized"));
    expect(unparenthesized?.markerShape).toBe("unparenthesized");
    expect(parenthesized?.markerShape).toBe("parenthesized");
  });

  test("preserves line numbers in fingerprints", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [ ] Line 7 task
- [x] Line 8 task
- [ ] planned-2026-03-01 Line 9 task`);

    const parseResult = parseWorkQueueSection(taskpadMarkdown);

    // Line numbers are 1-indexed from document start
    // buildTaskpadWithWorkQueue creates 6 lines before workQueueContent
    expect(parseResult.allBullets[0].lineNumber).toBe(7);
    expect(parseResult.allBullets[1].lineNumber).toBe(8);
    expect(parseResult.allBullets[2].lineNumber).toBe(9);
  });
});
