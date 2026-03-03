import { describe, expect, test } from "bun:test";
import { parseTaskpadPlannedItems } from "../../tools/taskpad-planned-command-parity";

/**
 * TP003: Unit tests for marker-shape metadata and deterministic ordering
 *
 * These tests verify:
 * 1. MarkerShapeStats are calculated correctly for various marker configurations
 * 2. Mixed marker styles are detected and reported
 * 3. Percentages are accurate
 * 4. Deterministic ordering is maintained regardless of marker shape
 */

describe("TP003 - Marker Shape Statistics", () => {
  test("calculates stats for unparenthesized-only items", () => {
    const markdown = `# Test TASKPAD

## Work Queue
- [ ] planned-2026-03-01 Task one Verify: typecheck
- [ ] planned-2026-03-02 Task two Verify: test
- [ ] planned-2026-03-03 Task three Verify: lint

## Execution Queue
- [ ] Active task
`;

    const analysis = parseTaskpadPlannedItems(markdown);

    expect(analysis.plannedCount).toBe(3);
    expect(analysis.markerShapeStats.unparenthesizedCount).toBe(3);
    expect(analysis.markerShapeStats.parenthesizedCount).toBe(0);
    expect(analysis.markerShapeStats.totalCount).toBe(3);
    expect(analysis.markerShapeStats.unparenthesizedPercentage).toBe(100);
    expect(analysis.markerShapeStats.parenthesizedPercentage).toBe(0);
    expect(analysis.markerShapeStats.hasMixedStyles).toBe(false);
  });

  test("calculates stats for parenthesized-only items", () => {
    const markdown = `# Test TASKPAD

## Work Queue
- [ ] (planned-2026-03-01) Task one Verify: typecheck
- [ ] (planned-2026-03-02) Task two Verify: test

## Execution Queue
- [ ] Active task
`;

    const analysis = parseTaskpadPlannedItems(markdown);

    expect(analysis.plannedCount).toBe(2);
    expect(analysis.markerShapeStats.unparenthesizedCount).toBe(0);
    expect(analysis.markerShapeStats.parenthesizedCount).toBe(2);
    expect(analysis.markerShapeStats.totalCount).toBe(2);
    expect(analysis.markerShapeStats.unparenthesizedPercentage).toBe(0);
    expect(analysis.markerShapeStats.parenthesizedPercentage).toBe(100);
    expect(analysis.markerShapeStats.hasMixedStyles).toBe(false);
  });

  test("calculates stats for mixed marker styles", () => {
    const markdown = `# Test TASKPAD

## Work Queue
- [ ] (planned-2026-03-01) Parenthesized task Verify: typecheck
- [ ] planned-2026-03-02 Unparenthesized task Verify: test
- [ ] (planned-2026-03-03) Another parenthesized Verify: lint
- [ ] planned-2026-03-04 Another unparenthesized Verify: format

## Execution Queue
- [ ] Active task
`;

    const analysis = parseTaskpadPlannedItems(markdown);

    expect(analysis.plannedCount).toBe(4);
    expect(analysis.markerShapeStats.unparenthesizedCount).toBe(2);
    expect(analysis.markerShapeStats.parenthesizedCount).toBe(2);
    expect(analysis.markerShapeStats.totalCount).toBe(4);
    expect(analysis.markerShapeStats.unparenthesizedPercentage).toBe(50);
    expect(analysis.markerShapeStats.parenthesizedPercentage).toBe(50);
    expect(analysis.markerShapeStats.hasMixedStyles).toBe(true);
  });

  test("calculates correct percentages for uneven distribution", () => {
    const markdown = `# Test TASKPAD

## Work Queue
- [ ] planned-2026-03-01 Task one Verify: typecheck
- [ ] planned-2026-03-02 Task two Verify: test
- [ ] planned-2026-03-03 Task three Verify: lint
- [ ] (planned-2026-03-04) Parenthesized task Verify: format

## Execution Queue
- [ ] Active task
`;

    const analysis = parseTaskpadPlannedItems(markdown);

    expect(analysis.plannedCount).toBe(4);
    expect(analysis.markerShapeStats.unparenthesizedCount).toBe(3);
    expect(analysis.markerShapeStats.parenthesizedCount).toBe(1);
    expect(analysis.markerShapeStats.totalCount).toBe(4);
    expect(analysis.markerShapeStats.unparenthesizedPercentage).toBe(75);
    expect(analysis.markerShapeStats.parenthesizedPercentage).toBe(25);
    expect(analysis.markerShapeStats.hasMixedStyles).toBe(true);
  });

  test("handles empty planned items list", () => {
    const markdown = `# Test TASKPAD

## Work Queue
- [ ] Regular task without marker

## Execution Queue
- [ ] Active task
`;

    const analysis = parseTaskpadPlannedItems(markdown);

    expect(analysis.plannedCount).toBe(0);
    expect(analysis.markerShapeStats.unparenthesizedCount).toBe(0);
    expect(analysis.markerShapeStats.parenthesizedCount).toBe(0);
    expect(analysis.markerShapeStats.totalCount).toBe(0);
    expect(analysis.markerShapeStats.unparenthesizedPercentage).toBe(0);
    expect(analysis.markerShapeStats.parenthesizedPercentage).toBe(0);
    expect(analysis.markerShapeStats.hasMixedStyles).toBe(false);
  });
});

describe("TP003 - Deterministic Ordering with Mixed Marker Styles", () => {
  test("maintains line number order regardless of marker shape", () => {
    const markdown = `# Test TASKPAD

## Work Queue
- [ ] (planned-2026-03-03) Third task Verify: lint
- [ ] planned-2026-03-01 First task Verify: typecheck
- [ ] (planned-2026-03-02) Second task Verify: test

## Execution Queue
- [ ] Active task
`;

    const analysis = parseTaskpadPlannedItems(markdown);

    expect(analysis.plannedCount).toBe(3);

    // Items should be sorted by line number, not by marker shape
    expect(analysis.plannedItems[0].lineNumber).toBeLessThan(analysis.plannedItems[1].lineNumber);
    expect(analysis.plannedItems[1].lineNumber).toBeLessThan(analysis.plannedItems[2].lineNumber);

    // Verify marker shapes are preserved
    expect(analysis.plannedItems[0].markerShape).toBe("parenthesized");
    expect(analysis.plannedItems[1].markerShape).toBe("unparenthesized");
    expect(analysis.plannedItems[2].markerShape).toBe("parenthesized");
  });

  test("deterministic output across multiple parsing runs", () => {
    const markdown = `# Test TASKPAD

## Work Queue
- [ ] (planned-2026-03-01) Parenthesized task Verify: typecheck
- [ ] planned-2026-03-02 Unparenthesized task Verify: test
- [ ] (planned-2026-03-03) Another parenthesized Verify: lint

## Execution Queue
- [ ] Active task
`;

    // Parse multiple times
    const result1 = parseTaskpadPlannedItems(markdown);
    const result2 = parseTaskpadPlannedItems(markdown);
    const result3 = parseTaskpadPlannedItems(markdown);

    // All results should be identical
    expect(result1.plannedItems).toEqual(result2.plannedItems);
    expect(result2.plannedItems).toEqual(result3.plannedItems);

    expect(result1.markerShapeStats).toEqual(result2.markerShapeStats);
    expect(result2.markerShapeStats).toEqual(result3.markerShapeStats);
  });

  test("markerShapeStats total equals plannedCount", () => {
    const markdown = `# Test TASKPAD

## Work Queue
- [ ] (planned-2026-03-01) Task one Verify: typecheck
- [ ] planned-2026-03-02 Task two Verify: test
- [ ] (planned-2026-03-03) Task three Verify: lint

## Execution Queue
- [ ] Active task
`;

    const analysis = parseTaskpadPlannedItems(markdown);

    expect(analysis.markerShapeStats.totalCount).toBe(analysis.plannedCount);
    expect(analysis.markerShapeStats.unparenthesizedCount + analysis.markerShapeStats.parenthesizedCount)
      .toBe(analysis.plannedCount);
  });

  test("percentages sum to 100 for mixed styles", () => {
    const markdown = `# Test TASKPAD

## Work Queue
- [ ] (planned-2026-03-01) Task one Verify: typecheck
- [ ] planned-2026-03-02 Task two Verify: test
- [ ] (planned-2026-03-03) Task three Verify: lint
- [ ] planned-2026-03-04 Task four Verify: format
- [ ] (planned-2026-03-05) Task five Verify: lint

## Execution Queue
- [ ] Active task
`;

    const analysis = parseTaskpadPlannedItems(markdown);

    // Percentages should sum to 100 (or close due to rounding)
    const sumPercentage = analysis.markerShapeStats.unparenthesizedPercentage + analysis.markerShapeStats.parenthesizedPercentage;
    expect(sumPercentage).toBeGreaterThanOrEqual(99);
    expect(sumPercentage).toBeLessThanOrEqual(101);
  });
});

describe("TP003 - Marker Shape Metadata in Planned Items", () => {
  test("each planned item preserves its marker shape", () => {
    const markdown = `# Test TASKPAD

## Work Queue
- [ ] (planned-2026-03-01) Parenthesized task Verify: typecheck
- [ ] planned-2026-03-02 Unparenthesized task Verify: test

## Execution Queue
- [ ] Active task
`;

    const analysis = parseTaskpadPlannedItems(markdown);

    expect(analysis.plannedItems[0].markerShape).toBe("parenthesized");
    expect(analysis.plannedItems[1].markerShape).toBe("unparenthesized");

    // Verify the plannedDate is canonicalized (without parens)
    expect(analysis.plannedItems[0].plannedDate).toBe("2026-03-01");
    expect(analysis.plannedItems[1].plannedDate).toBe("2026-03-02");
  });

  test("marker shape is independent of planned date", () => {
    const markdown = `# Test TASKPAD

## Work Queue
- [ ] (planned-2026-03-01) Early date, parenthesized Verify: typecheck
- [ ] planned-2026-03-05 Later date, unparenthesized Verify: test
- [ ] (planned-2026-03-03) Middle date, parenthesized Verify: lint

## Execution Queue
- [ ] Active task
`;

    const analysis = parseTaskpadPlannedItems(markdown);

    // Check that all planned dates are canonicalized correctly
    expect(analysis.plannedItems[0].plannedDate).toBe("2026-03-01");
    expect(analysis.plannedItems[1].plannedDate).toBe("2026-03-05");
    expect(analysis.plannedItems[2].plannedDate).toBe("2026-03-03");

    // Check that marker shapes are preserved correctly
    expect(analysis.plannedItems[0].markerShape).toBe("parenthesized");
    expect(analysis.plannedItems[1].markerShape).toBe("unparenthesized");
    expect(analysis.plannedItems[2].markerShape).toBe("parenthesized");
  });
});
