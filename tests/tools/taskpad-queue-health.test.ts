import { describe, expect, test } from "bun:test";

import { countQueueHealth } from "../../tools/taskpad-queue-health";

describe("countQueueHealth", () => {
  test("passes when at least one unchecked item exists in either queue", () => {
    const markdown = `# TASKPAD

## Self-Improvement Backlog
- [ ] planned-2026-02-27 Improve queue gate docs

## Autonomous Kickoff Queue
- [x] planned-2026-02-26 done
`;

    const counts = countQueueHealth(markdown);

    expect(counts.selfImprovementUncheckedCount).toBe(1);
    expect(counts.autonomousUncheckedCount).toBe(0);
    expect(counts.totalUnchecked).toBe(1);
  });

  test("fails when both queues are empty of unchecked items", () => {
    const markdown = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

    const counts = countQueueHealth(markdown);

    expect(counts.autonomousUncheckedCount).toBe(0);
    expect(counts.selfImprovementUncheckedCount).toBe(0);
    expect(counts.totalUnchecked).toBe(0);
  });

  test("handles queue sections regardless of order", () => {
    const markdown = `# TASKPAD

## Self-Improvement Backlog
- [x] done

## Some Other Section
- [ ] not a queue item

## Autonomous Kickoff Queue
- [ ] planned-2026-02-27 Ship queue-health tests
`;

    const counts = countQueueHealth(markdown);

    expect(counts.autonomousUncheckedCount).toBe(1);
    expect(counts.selfImprovementUncheckedCount).toBe(0);
    expect(counts.totalUnchecked).toBe(1);
  });

  test("tolerates heading and bullet whitespace variations", () => {
    const markdown = `# TASKPAD

   ## Autonomous Kickoff Queue   
\t- [ ] planned-2026-02-27 Build queue monitor
+   [ ] planned-2026-02-28 Follow-up item

## Self-Improvement Backlog    
* [ ] planned-2026-03-01 Improve review loop
`;

    const counts = countQueueHealth(markdown);

    expect(counts.autonomousUncheckedCount).toBe(2);
    expect(counts.selfImprovementUncheckedCount).toBe(1);
    expect(counts.totalUnchecked).toBe(3);
  });

  test("does not count unchecked bullets outside target queue sections", () => {
    const markdown = `# TASKPAD

## Random Notes
- [ ] planned-2026-02-27 This should not count

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

    const counts = countQueueHealth(markdown);

    expect(counts.autonomousUncheckedCount).toBe(0);
    expect(counts.selfImprovementUncheckedCount).toBe(0);
    expect(counts.totalUnchecked).toBe(0);
  });

  // Tests for executable queues (Work Queue and Execution Queue)
  test("counts unchecked items in Work Queue", () => {
    const markdown = `# TASKPAD

## Work Queue
- [ ] planned-2026-03-02 Implement queue-health parser updates Verify: bun test:queue-health
- [ ] planned-2026-03-03 Add test fixtures

## Execution Queue
(empty)

## Autonomous Kickoff Queue
(empty)

## Self-Improvement Backlog
(empty)
`;

    const counts = countQueueHealth(markdown);

    expect(counts.workQueueUncheckedCount).toBe(2);
    expect(counts.executionQueueUncheckedCount).toBe(0);
    expect(counts.executableQueueTotal).toBe(2);
    expect(counts.intakeQueueTotal).toBe(0);
    expect(counts.totalUnchecked).toBe(2);
  });

  test("counts unchecked items in Execution Queue", () => {
    const markdown = `# TASKPAD

## Work Queue
(empty)

## Execution Queue
- [ ] planned-2026-03-02 Fix production hotfix Verify: bun run deploy:hotfix

## Autonomous Kickoff Queue
(empty)

## Self-Improvement Backlog
(empty)
`;

    const counts = countQueueHealth(markdown);

    expect(counts.workQueueUncheckedCount).toBe(0);
    expect(counts.executionQueueUncheckedCount).toBe(1);
    expect(counts.executableQueueTotal).toBe(1);
    expect(counts.intakeQueueTotal).toBe(0);
    expect(counts.totalUnchecked).toBe(1);
  });

  test("counts unchecked items across all four queues", () => {
    const markdown = `# TASKPAD

## Work Queue
- [ ] planned-2026-03-02 Task 1
- [ ] planned-2026-03-02 Task 2

## Execution Queue
- [ ] planned-2026-03-02 Task 3

## Autonomous Kickoff Queue
- [ ] planned-2026-03-02 Task 4
- [ ] planned-2026-03-02 Task 5
- [ ] planned-2026-03-02 Task 6

## Self-Improvement Backlog
- [ ] planned-2026-03-02 Task 7
`;

    const counts = countQueueHealth(markdown);

    expect(counts.workQueueUncheckedCount).toBe(2);
    expect(counts.executionQueueUncheckedCount).toBe(1);
    expect(counts.autonomousUncheckedCount).toBe(3);
    expect(counts.selfImprovementUncheckedCount).toBe(1);
    expect(counts.executableQueueTotal).toBe(3);
    expect(counts.intakeQueueTotal).toBe(4);
    expect(counts.totalUnchecked).toBe(7);
  });

  test("calculates correct aggregates for mixed queue states", () => {
    const markdown = `# TASKPAD

## Work Queue
(empty)

## Execution Queue
- [ ] planned-2026-03-02 Fix hotfix

## Autonomous Kickoff Queue
- [ ] Add tests
- [ ] Update docs

## Self-Improvement Backlog
- [ ] Refactor parser
`;

    const counts = countQueueHealth(markdown);

    expect(counts.workQueueUncheckedCount).toBe(0);
    expect(counts.executionQueueUncheckedCount).toBe(1);
    expect(counts.autonomousUncheckedCount).toBe(2);
    expect(counts.selfImprovementUncheckedCount).toBe(1);
    expect(counts.executableQueueTotal).toBe(1);
    expect(counts.intakeQueueTotal).toBe(3);
    expect(counts.totalUnchecked).toBe(4);
  });

  test("ignores checked items in all queue sections", () => {
    const markdown = `# TASKPAD

## Work Queue
- [x] planned-2026-03-02 Completed task
- [ ] planned-2026-03-02 Unchecked task

## Execution Queue
- [x] Another completed

## Autonomous Kickoff Queue
- [x] Done

## Self-Improvement Backlog
- [x] Also done
`;

    const counts = countQueueHealth(markdown);

    expect(counts.workQueueUncheckedCount).toBe(1);
    expect(counts.executionQueueUncheckedCount).toBe(0);
    expect(counts.autonomousUncheckedCount).toBe(0);
    expect(counts.selfImprovementUncheckedCount).toBe(0);
    expect(counts.executableQueueTotal).toBe(1);
    expect(counts.intakeQueueTotal).toBe(0);
    expect(counts.totalUnchecked).toBe(1);
  });

  test("tracks heading presence for Work Queue and Execution Queue", () => {
    const markdown = `# TASKPAD

## Work Queue
- [ ] Task 1

## Autonomous Kickoff Queue
- [ ] Task 2

## Self-Improvement Backlog
- [ ] Task 3
`;

    const counts = countQueueHealth(markdown);

    expect(counts.workQueueHeadingFound).toBe(true);
    expect(counts.executionQueueHeadingFound).toBe(false);
  });
});
