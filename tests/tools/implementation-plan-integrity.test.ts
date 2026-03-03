import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  isolateNewestTaskpadIntakeSlice,
  validateRequiredSectionPresence,
  validateTaskGraphTaskLines,
  validateVerificationCommandsBlock,
  validateUncheckedTpTasks,
  validateActiveSliceAmbiguity,
  sortViolationsCanonical,
  RULE_IDS,
} from "../../tools/implementation-plan-integrity";

function loadFixture(name: string): string {
  const fixturePath = join(import.meta.dir, "fixtures", name);
  return readFileSync(fixturePath, "utf8");
}

describe("implementation-plan-integrity", () => {
  test("passes for a valid active TASKPAD slice", () => {
    const markdown = loadFixture("implementation-plan-integrity-pass.md");
    const activeSlice = isolateNewestTaskpadIntakeSlice(markdown);

    expect(activeSlice).not.toBeNull();
    expect(activeSlice?.heading).toContain("TASKPAD Intake Slice");

    const requiredSections = validateRequiredSectionPresence(activeSlice!.markdown);
    expect(requiredSections.passes).toBe(true);

    const taskGraph = validateTaskGraphTaskLines(activeSlice!.markdown);
    expect(taskGraph.passes).toBe(true);
    expect(taskGraph.parsedTaskIds).toEqual(["TP001", "TP002", "TP003"]);

    const verification = validateVerificationCommandsBlock(activeSlice!.markdown);
    expect(verification.passes).toBe(true);
    expect(verification.runnableCommandLines).toEqual([
      "bun run typecheck",
      "bun test tests/tools/implementation-plan-integrity.test.ts",
    ]);
  });

  test("fails when a required section is missing", () => {
    const markdown = loadFixture("implementation-plan-integrity-missing-section.md");
    const activeSlice = isolateNewestTaskpadIntakeSlice(markdown);

    expect(activeSlice).not.toBeNull();

    const requiredSections = validateRequiredSectionPresence(activeSlice!.markdown);
    expect(requiredSections.passes).toBe(false);
    expect(requiredSections.missingHeadings).toContain("### Acceptance Criteria");
  });

  test("fails when TP IDs are out of order", () => {
    const markdown = loadFixture("implementation-plan-integrity-tp-order-fail.md");
    const activeSlice = isolateNewestTaskpadIntakeSlice(markdown);

    expect(activeSlice).not.toBeNull();

    const taskGraph = validateTaskGraphTaskLines(activeSlice!.markdown);
    expect(taskGraph.passes).toBe(false);
    expect(taskGraph.outOfOrderPairs).toEqual([{ previous: "TP002", current: "TP001" }]);
  });

  test("fails when verification commands block is empty", () => {
    const markdown = loadFixture("implementation-plan-integrity-empty-verification.md");
    const activeSlice = isolateNewestTaskpadIntakeSlice(markdown);

    expect(activeSlice).not.toBeNull();

    const verification = validateVerificationCommandsBlock(activeSlice!.markdown);
    expect(verification.hasBashFence).toBe(true);
    expect(verification.hasClosingFence).toBe(true);
    expect(verification.passes).toBe(false);
    expect(verification.runnableCommandLines).toEqual([]);
  });

  test("sorts violations in canonical order for deterministic output", () => {
    const violations = [
      { ruleId: RULE_IDS.TP_DUPLICATE_ID, summary: "Duplicate", remediation: "Fix" },
      { ruleId: RULE_IDS.TP_FORMAT_INVALID, summary: "Invalid", remediation: "Fix" },
      { ruleId: RULE_IDS.VERIFICATION_BLOCK_EMPTY, summary: "Empty", remediation: "Fix" },
      { ruleId: RULE_IDS.NO_UNCHECKED_TP_TASKS, summary: "No tasks", remediation: "Fix" },
    ];

    const sorted = sortViolationsCanonical(violations);

    expect(sorted).toHaveLength(4);
    expect(sorted[0].ruleId).toBe(RULE_IDS.TP_FORMAT_INVALID); // PLI004 comes before PLI006
    expect(sorted[1].ruleId).toBe(RULE_IDS.TP_DUPLICATE_ID); // PLI006 comes before PLI008
    expect(sorted[2].ruleId).toBe(RULE_IDS.VERIFICATION_BLOCK_EMPTY); // PLI008 comes before PLI009
    expect(sorted[3].ruleId).toBe(RULE_IDS.NO_UNCHECKED_TP_TASKS); // PLI009
  });

  test("emits violations in stable order for machine-readable JSON output", () => {
    const markdown = loadFixture("implementation-plan-integrity-multiple-violations.md");
    const activeSlice = isolateNewestTaskpadIntakeSlice(markdown);

    expect(activeSlice).not.toBeNull();

    const taskGraph = validateTaskGraphTaskLines(activeSlice!.markdown);
    expect(taskGraph.passes).toBe(false);
    expect(taskGraph.invalidTaskLines.length).toBeGreaterThan(0);
    expect(taskGraph.outOfOrderPairs.length).toBeGreaterThan(0);
    expect(taskGraph.duplicateTaskIds.length).toBeGreaterThan(0);

    const verification = validateVerificationCommandsBlock(activeSlice!.markdown);
    expect(verification.passes).toBe(false);

    // When multiple violations exist, they should sort in canonical order
    const violations = [];

    if (taskGraph.invalidTaskLines.length > 0) {
      violations.push({ ruleId: RULE_IDS.TP_FORMAT_INVALID });
    }
    if (taskGraph.outOfOrderPairs.length > 0) {
      violations.push({ ruleId: RULE_IDS.TP_ORDER_INVALID });
    }
    if (taskGraph.duplicateTaskIds.length > 0) {
      violations.push({ ruleId: RULE_IDS.TP_DUPLICATE_ID });
    }
    if (!verification.passes) {
      violations.push({ ruleId: RULE_IDS.VERIFICATION_BLOCK_EMPTY });
    }

    const sorted = sortViolationsCanonical(violations);

    // Verify canonical order: TP_FORMAT_INVALID (PLI004) < TP_ORDER_INVALID (PLI005) < TP_DUPLICATE_ID (PLI006) < VERIFICATION_BLOCK_EMPTY (PLI008)
    expect(sorted[0].ruleId).toBe(RULE_IDS.TP_FORMAT_INVALID);
    expect(sorted[1].ruleId).toBe(RULE_IDS.TP_ORDER_INVALID);
    expect(sorted[2].ruleId).toBe(RULE_IDS.TP_DUPLICATE_ID);
    expect(sorted[3].ruleId).toBe(RULE_IDS.VERIFICATION_BLOCK_EMPTY);
  });

  // Strict mode - validateUncheckedTpTasks tests
  test("validates unchecked TP tasks correctly for slice with unchecked tasks", () => {
    const markdown = loadFixture("implementation-plan-integrity-strict-pass.md");
    const activeSlice = isolateNewestTaskpadIntakeSlice(markdown);

    expect(activeSlice).not.toBeNull();

    const uncheckedValidation = validateUncheckedTpTasks(activeSlice!.markdown);

    expect(uncheckedValidation.totalTpTasks).toBe(3);
    expect(uncheckedValidation.uncheckedTpTasks).toBe(2);
    expect(uncheckedValidation.checkedTpTasks).toBe(1);
    expect(uncheckedValidation.passes).toBe(true);
  });

  test("validates unchecked TP tasks correctly for fully complete slice", () => {
    const markdown = loadFixture("implementation-plan-integrity-fully-complete-slice.md");
    const activeSlice = isolateNewestTaskpadIntakeSlice(markdown);

    expect(activeSlice).not.toBeNull();

    const uncheckedValidation = validateUncheckedTpTasks(activeSlice!.markdown);

    expect(uncheckedValidation.totalTpTasks).toBe(3);
    expect(uncheckedValidation.uncheckedTpTasks).toBe(0);
    expect(uncheckedValidation.checkedTpTasks).toBe(3);
    expect(uncheckedValidation.passes).toBe(false);
  });

  test("validates unchecked TP tasks correctly for slice with only unchecked tasks", () => {
    const markdown = loadFixture("implementation-plan-integrity-pass.md");
    const activeSlice = isolateNewestTaskpadIntakeSlice(markdown);

    expect(activeSlice).not.toBeNull();

    const uncheckedValidation = validateUncheckedTpTasks(activeSlice!.markdown);

    expect(uncheckedValidation.totalTpTasks).toBe(3);
    expect(uncheckedValidation.uncheckedTpTasks).toBe(3);
    expect(uncheckedValidation.checkedTpTasks).toBe(0);
    expect(uncheckedValidation.passes).toBe(true);
  });

  // Strict mode - validateActiveSliceAmbiguity tests
  test("validates active slice ambiguity for valid slice with date", () => {
    const markdown = loadFixture("implementation-plan-integrity-strict-pass.md");

    const ambiguityValidation = validateActiveSliceAmbiguity(markdown);

    expect(ambiguityValidation.candidateSlices).toHaveLength(1);
    expect(ambiguityValidation.candidateSlices[0].heading).toContain("TASKPAD Intake Slice (2026-03-01)");
    expect(ambiguityValidation.candidateSlices[0].hasDate).toBe(true);
    expect(ambiguityValidation.firstCandidateMissingDate).toBe(false);
    expect(ambiguityValidation.passes).toBe(true);
  });

  test("validates active slice ambiguity for slice without date", () => {
    const markdown = loadFixture("implementation-plan-integrity-ambiguous-missing-date.md");

    const ambiguityValidation = validateActiveSliceAmbiguity(markdown);

    expect(ambiguityValidation.candidateSlices).toHaveLength(1);
    expect(ambiguityValidation.candidateSlices[0].heading).toContain("TASKPAD Intake Slice:");
    expect(ambiguityValidation.candidateSlices[0].hasDate).toBe(false);
    expect(ambiguityValidation.firstCandidateMissingDate).toBe(true);
    expect(ambiguityValidation.passes).toBe(false);
  });

  test("validates active slice ambiguity when first H2 is not TASKPAD Intake Slice", () => {
    const markdown = loadFixture("implementation-plan-integrity-ambiguous-active-slice.md");

    const ambiguityValidation = validateActiveSliceAmbiguity(markdown);

    expect(ambiguityValidation.candidateSlices).toHaveLength(0);
    expect(ambiguityValidation.firstCandidateMissingDate).toBe(false);
    expect(ambiguityValidation.passes).toBe(false);
  });

  // End-to-end strict mode tests
  test("strict mode passes when top slice has unchecked tasks", () => {
    const markdown = loadFixture("implementation-plan-integrity-strict-pass.md");
    const activeSlice = isolateNewestTaskpadIntakeSlice(markdown);

    expect(activeSlice).not.toBeNull();

    // All base validations should pass
    const requiredSections = validateRequiredSectionPresence(activeSlice!.markdown);
    expect(requiredSections.passes).toBe(true);

    const taskGraph = validateTaskGraphTaskLines(activeSlice!.markdown);
    expect(taskGraph.passes).toBe(true);

    const verification = validateVerificationCommandsBlock(activeSlice!.markdown);
    expect(verification.passes).toBe(true);

    // Strict mode validation should pass
    const uncheckedValidation = validateUncheckedTpTasks(activeSlice!.markdown);
    expect(uncheckedValidation.passes).toBe(true);
    expect(uncheckedValidation.uncheckedTpTasks).toBeGreaterThan(0);

    const ambiguityValidation = validateActiveSliceAmbiguity(markdown);
    expect(ambiguityValidation.passes).toBe(true);
  });

  test("strict mode fails when top slice is fully complete (no unchecked tasks)", () => {
    const markdown = loadFixture("implementation-plan-integrity-fully-complete-slice.md");
    const activeSlice = isolateNewestTaskpadIntakeSlice(markdown);

    expect(activeSlice).not.toBeNull();

    // Base validations should pass
    const requiredSections = validateRequiredSectionPresence(activeSlice!.markdown);
    expect(requiredSections.passes).toBe(true);

    const taskGraph = validateTaskGraphTaskLines(activeSlice!.markdown);
    expect(taskGraph.passes).toBe(true);

    const verification = validateVerificationCommandsBlock(activeSlice!.markdown);
    expect(verification.passes).toBe(true);

    // Strict mode validation should fail - no unchecked tasks
    const uncheckedValidation = validateUncheckedTpTasks(activeSlice!.markdown);
    expect(uncheckedValidation.passes).toBe(false);
    expect(uncheckedValidation.totalTpTasks).toBe(3);
    expect(uncheckedValidation.uncheckedTpTasks).toBe(0);
    expect(uncheckedValidation.checkedTpTasks).toBe(3);
  });

  test("strict mode fails with NO_UNCHECKED_TP_TASKS rule for fully complete slice", () => {
    const markdown = loadFixture("implementation-plan-integrity-fully-complete-slice.md");
    const activeSlice = isolateNewestTaskpadIntakeSlice(markdown);

    expect(activeSlice).not.toBeNull();

    const uncheckedValidation = validateUncheckedTpTasks(activeSlice!.markdown);

    expect(uncheckedValidation.passes).toBe(false);
    expect(uncheckedValidation.totalTpTasks).toBe(3);
    expect(uncheckedValidation.uncheckedTpTasks).toBe(0);

    // The failure corresponds to RULE_IDS.NO_UNCHECKED_TP_TASKS
    const expectedRuleId = RULE_IDS.NO_UNCHECKED_TP_TASKS;
    expect(expectedRuleId).toBe("PLI009_NO_UNCHECKED_TP_TASKS");
  });

  test("strict mode fails when active slice is ambiguous (first H2 is not TASKPAD Intake Slice)", () => {
    const markdown = loadFixture("implementation-plan-integrity-ambiguous-active-slice.md");

    const ambiguityValidation = validateActiveSliceAmbiguity(markdown);

    expect(ambiguityValidation.passes).toBe(false);
    expect(ambiguityValidation.candidateSlices).toHaveLength(0);

    // The failure corresponds to RULE_IDS.AMBIGUOUS_ACTIVE_SLICE
    const expectedRuleId = RULE_IDS.AMBIGUOUS_ACTIVE_SLICE;
    expect(expectedRuleId).toBe("PLI010_AMBIGUOUS_ACTIVE_SLICE");
  });

  test("strict mode fails when TASKPAD Intake Slice heading is missing date", () => {
    const markdown = loadFixture("implementation-plan-integrity-ambiguous-missing-date.md");

    const ambiguityValidation = validateActiveSliceAmbiguity(markdown);

    expect(ambiguityValidation.passes).toBe(false);
    expect(ambiguityValidation.candidateSlices).toHaveLength(1);
    expect(ambiguityValidation.candidateSlices[0].hasDate).toBe(false);
    expect(ambiguityValidation.firstCandidateMissingDate).toBe(true);

    // The failure corresponds to RULE_IDS.AMBIGUOUS_ACTIVE_SLICE
    const expectedRuleId = RULE_IDS.AMBIGUOUS_ACTIVE_SLICE;
    expect(expectedRuleId).toBe("PLI010_AMBIGUOUS_ACTIVE_SLICE");
  });

  test("strict mode violations include NO_UNCHECKED_TP_TASKS in canonical order", () => {
    const violations = [
      { ruleId: RULE_IDS.NO_UNCHECKED_TP_TASKS, summary: "No tasks", remediation: "Fix" },
      { ruleId: RULE_IDS.VERIFICATION_BLOCK_EMPTY, summary: "Empty", remediation: "Fix" },
      { ruleId: RULE_IDS.TP_DUPLICATE_ID, summary: "Duplicate", remediation: "Fix" },
    ];

    const sorted = sortViolationsCanonical(violations);

    expect(sorted).toHaveLength(3);
    // NO_UNCHECKED_TP_TASKS (PLI009) should come after TP_DUPLICATE_ID (PLI006) and VERIFICATION_BLOCK_EMPTY (PLI008)
    expect(sorted[0].ruleId).toBe(RULE_IDS.TP_DUPLICATE_ID); // PLI006
    expect(sorted[1].ruleId).toBe(RULE_IDS.VERIFICATION_BLOCK_EMPTY); // PLI008
    expect(sorted[2].ruleId).toBe(RULE_IDS.NO_UNCHECKED_TP_TASKS); // PLI009
  });

  test("strict mode violations include AMBIGUOUS_ACTIVE_SLICE first in canonical order", () => {
    const violations = [
      { ruleId: RULE_IDS.NO_UNCHECKED_TP_TASKS, summary: "No tasks", remediation: "Fix" },
      { ruleId: RULE_IDS.AMBIGUOUS_ACTIVE_SLICE, summary: "Ambiguous", remediation: "Fix" },
      { ruleId: RULE_IDS.ACTIVE_SLICE_MISSING, summary: "Missing", remediation: "Fix" },
    ];

    const sorted = sortViolationsCanonical(violations);

    expect(sorted).toHaveLength(3);
    // AMBIGUOUS_ACTIVE_SLICE (PLI010) should come first in canonical order
    expect(sorted[0].ruleId).toBe(RULE_IDS.AMBIGUOUS_ACTIVE_SLICE); // PLI010
    expect(sorted[1].ruleId).toBe(RULE_IDS.ACTIVE_SLICE_MISSING); // PLI001
    expect(sorted[2].ruleId).toBe(RULE_IDS.NO_UNCHECKED_TP_TASKS); // PLI009
  });
});
