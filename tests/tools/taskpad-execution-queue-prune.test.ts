import { describe, expect, test } from "bun:test";

import {
  buildArchiveMarkdownWithBullets,
  parseExecutionQueueSection,
  pruneExecutionQueue,
  rewriteTaskpadWithoutArchivedBullets,
  EXECUTION_QUEUE_PRUNE_RULE_IDS,
  type ExecutionQueueBulletFingerprint,
} from "../../tools/taskpad-execution-queue-prune";

// ============================================================================
// TP004: Fixture-based tests for taskpad:execution-queue-prune covering:
// - Pass: successful prune of checked/planned bullets
// - Noop: no archive candidates (all unchecked)
// - Noop: missing Execution Queue heading
// - Error: invalid taskpad structure (multiple headings)
// ============================================================================

function buildTaskpadWithExecutionQueue(executionQueueContent: string): string {
  return `# TASKPAD Test

## Work Queue
- [ ] Some work queue task

## Execution Queue
${executionQueueContent}

## Self-Improvement Backlog
- [ ] Some improvement task
`;
}

describe("parseExecutionQueueSection", () => {
  test("parses Execution Queue with mixed checked/unchecked bullets", () => {
    const markdown = buildTaskpadWithExecutionQueue(`- [ ] Unchecked task 1
- [x] Checked task 1
- [ ] Unchecked task 2
- [x] Checked task 2`);

    const result = parseExecutionQueueSection(markdown);

    expect(result.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(result.executionQueueHeadingFound).toBe(true);
    expect(result.allBullets).toHaveLength(4);
    expect(result.archivedBullets).toHaveLength(2);
    expect(result.preservedBullets).toHaveLength(2);
  });

  test("parses Execution Queue with planned markers (unparenthesized)", () => {
    const markdown = buildTaskpadWithExecutionQueue(`- [ ] planned-2026-03-01 Task with unparenthesized marker
- [x] planned-2026-03-02 Completed planned task`);

    const result = parseExecutionQueueSection(markdown);

    expect(result.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(result.allBullets).toHaveLength(2);
    expect(result.archivedBullets).toHaveLength(2); // Both have planned markers
    expect(result.archivedBullets[0].plannedDate).toBe("2026-03-01");
    expect(result.archivedBullets[0].markerShape).toBe("unparenthesized");
    expect(result.archivedBullets[1].plannedDate).toBe("2026-03-02");
  });

  test("parses Execution Queue with planned markers (parenthesized)", () => {
    const markdown = buildTaskpadWithExecutionQueue(`- [ ] (planned-2026-03-01) Task with parenthesized marker
- [x] (planned-2026-03-02) Completed planned task`);

    const result = parseExecutionQueueSection(markdown);

    expect(result.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(result.allBullets).toHaveLength(2);
    expect(result.archivedBullets).toHaveLength(2);
    expect(result.archivedBullets[0].plannedDate).toBe("2026-03-01");
    expect(result.archivedBullets[0].markerShape).toBe("parenthesized");
  });

  test("returns noop when Execution Queue heading is missing", () => {
    const markdown = `# TASKPAD Test

## Work Queue
- [ ] Some task
`;

    const result = parseExecutionQueueSection(markdown);

    expect(result.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_NOOP_EXECUTION_QUEUE_MISSING);
    expect(result.executionQueueHeadingFound).toBe(false);
    expect(result.allBullets).toHaveLength(0);
  });

  test("returns error when multiple Execution Queue headings found", () => {
    const markdown = `# TASKPAD Test

## Execution Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2
`;

    const result = parseExecutionQueueSection(markdown);

    expect(result.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_TASKPAD_STRUCTURE_INVALID);
    expect(result.executionQueueHeadingFound).toBe(true);
    expect(result.structuralErrors).toContain("Multiple '## Execution Queue' headings found; only one is allowed.");
  });

  test("preserves unchecked bullets without planned markers", () => {
    const markdown = buildTaskpadWithExecutionQueue(`- [ ] Keep me 1
- [ ] Keep me 2
- [x] Archive me`);

    const result = parseExecutionQueueSection(markdown);

    expect(result.preservedBullets).toHaveLength(2);
    expect(result.preservedBullets[0].taskText).toBe("Keep me 1");
    expect(result.preservedBullets[1].taskText).toBe("Keep me 2");
    expect(result.archivedBullets).toHaveLength(1);
    expect(result.archivedBullets[0].taskText).toBe("Archive me");
  });

  test("computes deterministic fingerprint hashes", () => {
    const markdown = buildTaskpadWithExecutionQueue(`- [x] Task to fingerprint`);

    const result = parseExecutionQueueSection(markdown);

    expect(result.archivedBullets).toHaveLength(1);
    expect(result.archivedBullets[0].fingerprintHash).toBeDefined();
    expect(result.archivedBullets[0].fingerprintHash).toMatch(/^[a-f0-9]{16}$/);
  });

  test("identifies checked bullets as archive candidates", () => {
    const markdown = buildTaskpadWithExecutionQueue(`- [x] Completed task 1
- [x] Completed task 2
- [ ] Unchecked task`);

    const result = parseExecutionQueueSection(markdown);

    expect(result.archivedBullets).toHaveLength(2);
    expect(result.archivedBullets[0].checkboxState).toBe("checked");
    expect(result.archivedBullets[1].checkboxState).toBe("checked");
    expect(result.preservedBullets).toHaveLength(1);
    expect(result.preservedBullets[0].checkboxState).toBe("unchecked");
  });

  test("identifies unchecked planned bullets as archive candidates", () => {
    const markdown = buildTaskpadWithExecutionQueue(`- [ ] planned-2026-03-01 Planned but unchecked
- [ ] (planned-2026-03-02) Parenthesized planned
- [ ] Regular unchecked task`);

    const result = parseExecutionQueueSection(markdown);

    expect(result.archivedBullets).toHaveLength(2);
    expect(result.archivedBullets[0].checkboxState).toBe("unchecked");
    expect(result.archivedBullets[0].plannedDate).toBe("2026-03-01");
    expect(result.archivedBullets[1].plannedDate).toBe("2026-03-02");
    expect(result.preservedBullets).toHaveLength(1);
    expect(result.preservedBullets[0].plannedDate).toBeNull();
  });

  test("extracts checkbox state correctly", () => {
    const markdown = buildTaskpadWithExecutionQueue(`- [x] Uppercase X
- [ ] Unchecked
- [x] Lowercase x`);

    const result = parseExecutionQueueSection(markdown);

    expect(result.allBullets).toHaveLength(3);
    expect(result.allBullets[0].checkboxState).toBe("checked");
    expect(result.allBullets[1].checkboxState).toBe("unchecked");
    expect(result.allBullets[2].checkboxState).toBe("checked");
  });

  test("handles mixed bullet list markers (-, *, +)", () => {
    const markdown = buildTaskpadWithExecutionQueue(`- [ ] Dash bullet
* [x] Asterisk bullet
+ [ ] Plus bullet`);

    const result = parseExecutionQueueSection(markdown);

    expect(result.allBullets).toHaveLength(3);
    expect(result.archivedBullets).toHaveLength(1);
    expect(result.archivedBullets[0].checkboxState).toBe("checked");
    expect(result.preservedBullets).toHaveLength(2);
  });

  test("extracts task text without markers", () => {
    const markdown = buildTaskpadWithExecutionQueue(`- [x] (planned-2026-03-01) Task text with marker
- [ ] planned-2026-03-02 Another task text`);

    const result = parseExecutionQueueSection(markdown);

    expect(result.archivedBullets[0].taskText).toBe("Task text with marker");
    expect(result.archivedBullets[1].taskText).toBe("Another task text");
  });
});

describe("buildArchiveMarkdownWithBullets", () => {
  test("builds archive with new section for first-time archive", () => {
    const bullets: ExecutionQueueBulletFingerprint[] = [
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

    expect(result.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(result.archiveMarkdown).toContain("TASKPAD Execution Queue Archive:");
    expect(result.archiveMarkdown).toContain("Source TASKPAD: TASKPAD.md");
    expect(result.archiveMarkdown).toContain("## Archived from");
    expect(result.archiveMarkdown).toContain("- [x] Completed task <!-- fingerprint: abc123def4567890 -->");
  });

  test("appends to existing archive markdown", () => {
    const existingArchive = `# Existing Archive

## Archived from 2026-02-01
- [x] Old task <!-- fingerprint: oldfingerprint123 -->`;

    const bullets: ExecutionQueueBulletFingerprint[] = [
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

    expect(result.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(result.archiveMarkdown).toContain("Existing Archive");
    expect(result.archiveMarkdown).toContain("Old task");
    expect(result.archiveMarkdown).toContain("New task");
  });

  test("returns noop when no bullets to archive", () => {
    const result = buildArchiveMarkdownWithBullets(null, [], "TASKPAD.md");

    expect(result.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_NOOP_NO_ARCHIVE_CANDIDATES);
    expect(result.archiveMarkdown).toBeNull();
  });

  test("sorts bullets by line number", () => {
    const bullets: ExecutionQueueBulletFingerprint[] = [
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

  test("includes planned date in task text for bullets with planned markers", () => {
    const bullets: ExecutionQueueBulletFingerprint[] = [
      {
        lineNumber: 5,
        rawText: "- [ ] planned-2026-03-01 Planned task",
        checkboxState: "unchecked",
        markerShape: "unparenthesized",
        plannedDate: "2026-03-01",
        taskText: "Planned task",
        fingerprintHash: "planned123",
      },
    ];

    const result = buildArchiveMarkdownWithBullets(null, bullets, "TASKPAD.md");

    expect(result.archiveMarkdown).toContain("- [ ] planned-2026-03-01 Planned task");
  });

  test("handles bullets with parenthesized planned markers", () => {
    const bullets: ExecutionQueueBulletFingerprint[] = [
      {
        lineNumber: 5,
        rawText: "- [ ] (planned-2026-03-01) Planned task",
        checkboxState: "unchecked",
        markerShape: "parenthesized",
        plannedDate: "2026-03-01",
        taskText: "Planned task",
        fingerprintHash: "planned123",
      },
    ];

    const result = buildArchiveMarkdownWithBullets(null, bullets, "TASKPAD.md");

    expect(result.archiveMarkdown).toContain("- [ ] (planned-2026-03-01) Planned task");
  });

  test("preserves trailing newline", () => {
    const bullets: ExecutionQueueBulletFingerprint[] = [
      {
        lineNumber: 5,
        rawText: "- [x] Task",
        checkboxState: "checked",
        markerShape: "none",
        plannedDate: null,
        taskText: "Task",
        fingerprintHash: "abc123",
      },
    ];

    const result = buildArchiveMarkdownWithBullets(null, bullets, "TASKPAD.md");

    expect(result.archiveMarkdown).toMatch(/\n$/);
  });
});

describe("rewriteTaskpadWithoutArchivedBullets", () => {
  test("removes archived bullets from taskpad", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [ ] Keep this
- [x] Remove this
- [ ] Keep this too`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);
    const result = rewriteTaskpadWithoutArchivedBullets(taskpadMarkdown, parseResult);

    expect(result.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(result.updatedTaskpadMarkdown).toContain("Keep this");
    expect(result.updatedTaskpadMarkdown).toContain("Keep this too");
    expect(result.updatedTaskpadMarkdown).not.toContain("Remove this");
  });

  test("returns noop when no archive candidates", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [ ] Task 1
- [ ] Task 2`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);
    const result = rewriteTaskpadWithoutArchivedBullets(taskpadMarkdown, parseResult);

    expect(result.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_NOOP_NO_ARCHIVE_CANDIDATES);
    expect(result.updatedTaskpadMarkdown).toBe(taskpadMarkdown);
  });

  test("preserves other sections intact", () => {
    const taskpadMarkdown = `# TASKPAD Test

## Work Queue
- [ ] Work task

## Execution Queue
- [ ] Keep me
- [x] Archive me

## Self-Improvement Backlog
- [ ] Improvement task
`;

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);
    const result = rewriteTaskpadWithoutArchivedBullets(taskpadMarkdown, parseResult);

    expect(result.updatedTaskpadMarkdown).toContain("Work Queue");
    expect(result.updatedTaskpadMarkdown).toContain("Work task");
    expect(result.updatedTaskpadMarkdown).toContain("Self-Improvement Backlog");
    expect(result.updatedTaskpadMarkdown).toContain("Improvement task");
  });

  test("preserves heading when all bullets are archived", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [x] Archive me 1
- [x] Archive me 2`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);
    const result = rewriteTaskpadWithoutArchivedBullets(taskpadMarkdown, parseResult);

    expect(result.updatedTaskpadMarkdown).toContain("## Execution Queue");
    expect(result.updatedTaskpadMarkdown).not.toContain("Archive me 1");
    expect(result.updatedTaskpadMarkdown).not.toContain("Archive me 2");
  });

  test("removes planned unchecked bullets", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [ ] planned-2026-03-01 Remove this planned task
- [ ] Keep this regular task`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);
    const result = rewriteTaskpadWithoutArchivedBullets(taskpadMarkdown, parseResult);

    expect(result.updatedTaskpadMarkdown).not.toContain("Remove this planned task");
    expect(result.updatedTaskpadMarkdown).toContain("Keep this regular task");
  });

  test("removes parenthesized planned bullets", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [ ] (planned-2026-03-01) Remove this planned task
- [ ] Keep this regular task`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);
    const result = rewriteTaskpadWithoutArchivedBullets(taskpadMarkdown, parseResult);

    expect(result.updatedTaskpadMarkdown).not.toContain("Remove this planned task");
    expect(result.updatedTaskpadMarkdown).toContain("Keep this regular task");
  });

  test("handles non-bullet lines within Execution Queue", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`Some descriptive text
- [x] Archive this
- [ ] Keep this
Another descriptive line`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);
    const result = rewriteTaskpadWithoutArchivedBullets(taskpadMarkdown, parseResult);

    expect(result.updatedTaskpadMarkdown).toContain("Some descriptive text");
    expect(result.updatedTaskpadMarkdown).not.toContain("Archive this");
    expect(result.updatedTaskpadMarkdown).toContain("Keep this");
    expect(result.updatedTaskpadMarkdown).toContain("Another descriptive line");
  });
});

describe("pruneExecutionQueue", () => {
  test("error: nonexistent taskpad file", () => {
    const result = pruneExecutionQueue("/nonexistent/TASKPAD.md", "/tmp/ARCHIVE.md");

    expect(result.status).toBe("error");
    expect(result.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_TASKPAD_READ_FAILED);
    expect(result.stats.totalExecutionQueueLines).toBe(0);
  });

  test("pass: prunes checked bullets and archives them", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [ ] Keep me
- [x] Archive me
- [ ] Keep me too`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(parseResult.archivedBullets).toHaveLength(1);
    expect(parseResult.archivedBullets[0].taskText).toBe("Archive me");
    expect(parseResult.preservedBullets).toHaveLength(2);
  });

  test("pass: prunes planned bullets (unparenthesized) and archives them", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [ ] planned-2026-03-01 Archive this planned task
- [ ] Keep this regular task`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(parseResult.archivedBullets).toHaveLength(1);
    expect(parseResult.archivedBullets[0].taskText).toBe("Archive this planned task");
    expect(parseResult.preservedBullets).toHaveLength(1);
    expect(parseResult.preservedBullets[0].taskText).toBe("Keep this regular task");
  });

  test("pass: prunes planned bullets (parenthesized) and archives them", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [ ] (planned-2026-03-01) Archive this planned task
- [ ] Keep this regular task`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(parseResult.archivedBullets).toHaveLength(1);
    expect(parseResult.archivedBullets[0].taskText).toBe("Archive this planned task");
  });

  test("pass: prunes both checked and planned bullets", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [x] Completed task
- [ ] planned-2026-03-01 Planned task
- [ ] planned-2026-03-02 Another planned
- [x] Another completed
- [ ] Regular unchecked`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(parseResult.archivedBullets).toHaveLength(4);
    expect(parseResult.preservedBullets).toHaveLength(1);
    expect(parseResult.preservedBullets[0].taskText).toBe("Regular unchecked");
  });

  test("noop: no archive candidates when all bullets are unchecked without planned markers", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [ ] Task 1
- [ ] Task 2
- [ ] Task 3`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(parseResult.archivedBullets).toHaveLength(0);
    expect(parseResult.preservedBullets).toHaveLength(3);

    // Verify buildArchive returns noop
    const archiveResult = buildArchiveMarkdownWithBullets(null, parseResult.archivedBullets, "TASKPAD.md");
    expect(archiveResult.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_NOOP_NO_ARCHIVE_CANDIDATES);
  });

  test("noop: missing Execution Queue heading", () => {
    const taskpadMarkdown = `# TASKPAD Test

## Work Queue
- [ ] Some task
`;

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_NOOP_EXECUTION_QUEUE_MISSING);
    expect(parseResult.executionQueueHeadingFound).toBe(false);
  });

  test("error: multiple Execution Queue headings", () => {
    const taskpadMarkdown = `# TASKPAD Test

## Execution Queue
- [ ] Task 1

## Execution Queue
- [ ] Task 2
`;

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_TASKPAD_STRUCTURE_INVALID);
    expect(parseResult.structuralErrors).toHaveLength(1);
  });

  test("handles mixed marker shapes in same Execution Queue", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [ ] planned-2026-03-01 Unparenthesized planned
- [ ] (planned-2026-03-02) Parenthesized planned
- [x] Just checked
- [ ] Regular unchecked`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);

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
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [ ] Line 7 task
- [x] Line 8 task
- [ ] planned-2026-03-01 Line 9 task`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);

    // Line numbers are 1-indexed from document start
    // buildTaskpadWithExecutionQueue creates 6 lines before executionQueueContent
    expect(parseResult.allBullets[0].lineNumber).toBe(7);
    expect(parseResult.allBullets[1].lineNumber).toBe(8);
    expect(parseResult.allBullets[2].lineNumber).toBe(9);
  });

  test("handles empty Execution Queue section", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(``);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);

    expect(parseResult.reasonCode).toBe(EXECUTION_QUEUE_PRUNE_RULE_IDS.PRUNE_OK);
    expect(parseResult.allBullets).toHaveLength(0);
    expect(parseResult.archivedBullets).toHaveLength(0);
    expect(parseResult.preservedBullets).toHaveLength(0);
  });

  test("preserves indented bullets", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [ ] Regular bullet
  - [x] Indented completed bullet
    - [ ] planned-2026-03-01 Indented planned bullet`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);

    expect(parseResult.allBullets).toHaveLength(3);
    expect(parseResult.archivedBullets).toHaveLength(2);
    expect(parseResult.archivedBullets[0].rawText).toContain("  - [x]");
    expect(parseResult.archivedBullets[1].rawText).toContain("    - [ ] planned-2026-03-01");
  });

  test("deterministic fingerprint generation", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [x] Same task`);

    const parseResult1 = parseExecutionQueueSection(taskpadMarkdown);
    const parseResult2 = parseExecutionQueueSection(taskpadMarkdown);

    expect(parseResult1.allBullets[0].fingerprintHash).toBe(parseResult2.allBullets[0].fingerprintHash);
  });

  test("distinguishes same text with different planned dates", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [ ] planned-2026-03-01 Task
- [ ] planned-2026-03-02 Task`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);

    expect(parseResult.allBullets).toHaveLength(2);
    expect(parseResult.allBullets[0].fingerprintHash).not.toBe(parseResult.allBullets[1].fingerprintHash);
  });

  test("distinguishes same text with different checkbox states", () => {
    const taskpadMarkdown = buildTaskpadWithExecutionQueue(`- [x] Task
- [ ] Task`);

    const parseResult = parseExecutionQueueSection(taskpadMarkdown);

    expect(parseResult.allBullets).toHaveLength(2);
    expect(parseResult.allBullets[0].fingerprintHash).not.toBe(parseResult.allBullets[1].fingerprintHash);
  });
});

describe("fingerprint hash determinism", () => {
  test("fingerprint includes checkbox state", () => {
    const markdown1 = buildTaskpadWithExecutionQueue(`- [x] Task text`);
    const markdown2 = buildTaskpadWithExecutionQueue(`- [ ] Task text`);

    const result1 = parseExecutionQueueSection(markdown1);
    const result2 = parseExecutionQueueSection(markdown2);

    expect(result1.archivedBullets[0].fingerprintHash).not.toBe(result2.preservedBullets[0].fingerprintHash);
  });

  test("fingerprint includes planned date", () => {
    const markdown1 = buildTaskpadWithExecutionQueue(`- [ ] planned-2026-03-01 Task`);
    const markdown2 = buildTaskpadWithExecutionQueue(`- [ ] planned-2026-03-02 Task`);

    const result1 = parseExecutionQueueSection(markdown1);
    const result2 = parseExecutionQueueSection(markdown2);

    expect(result1.archivedBullets[0].fingerprintHash).not.toBe(result2.archivedBullets[0].fingerprintHash);
  });

  test("fingerprint includes marker shape", () => {
    const markdown1 = buildTaskpadWithExecutionQueue(`- [ ] planned-2026-03-01 Task`);
    const markdown2 = buildTaskpadWithExecutionQueue(`- [ ] (planned-2026-03-01) Task`);

    const result1 = parseExecutionQueueSection(markdown1);
    const result2 = parseExecutionQueueSection(markdown2);

    expect(result1.archivedBullets[0].fingerprintHash).not.toBe(result2.archivedBullets[0].fingerprintHash);
  });

  test("fingerprint includes task text", () => {
    const markdown1 = buildTaskpadWithExecutionQueue(`- [x] Task one`);
    const markdown2 = buildTaskpadWithExecutionQueue(`- [x] Task two`);

    const result1 = parseExecutionQueueSection(markdown1);
    const result2 = parseExecutionQueueSection(markdown2);

    expect(result1.archivedBullets[0].fingerprintHash).not.toBe(result2.archivedBullets[0].fingerprintHash);
  });

  test("fingerprint includes line number", () => {
    const markdown = buildTaskpadWithExecutionQueue(`- [x] Task 1
- [x] Task 2`);

    const result = parseExecutionQueueSection(markdown);

    expect(result.allBullets[0].lineNumber).toBe(7);
    expect(result.allBullets[1].lineNumber).toBe(8);
    expect(result.allBullets[0].fingerprintHash).not.toBe(result.allBullets[1].fingerprintHash);
  });
});
