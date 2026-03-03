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
});
