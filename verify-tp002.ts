#!/usr/bin/env bun

import { reconcileTaskpad, type QueueReconcileResult, type ReconcileStatus } from "./tools/lib/taskpad-queue-reconcile";

function verifyResult(result: QueueReconcileResult): void {
  // Verify result structure
  const status: ReconcileStatus = result.status;
  if (!["canonical", "healed", "error"].includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  // Verify sections present
  if (
    typeof result.sectionsPresent.workQueue !== "boolean" ||
    typeof result.sectionsPresent.executionQueue !== "boolean" ||
    typeof result.sectionsPresent.autonomousKickoffQueue !== "boolean" ||
    typeof result.sectionsPresent.selfImprovementBacklog !== "boolean"
  ) {
    throw new Error("sectionsPresent has invalid structure");
  }

  // Verify healed sections is array
  if (!Array.isArray(result.healedSections)) {
    throw new Error("healedSections should be an array");
  }

  // Verify reason codes is array
  if (!Array.isArray(result.reasonCodes)) {
    throw new Error("reasonCodes should be an array");
  }

  // Verify ordering structure
  if (!Array.isArray(result.ordering.currentOrder)) {
    throw new Error("ordering.currentOrder should be an array");
  }
  if (!Array.isArray(result.ordering.expectedOrder)) {
    throw new Error("ordering.expectedOrder should be an array");
  }
  if (typeof result.ordering.isCanonicalOrder !== "boolean") {
    throw new Error("ordering.isCanonicalOrder should be boolean");
  }

  // Verify taskpad metadata
  if (typeof result.taskpad.path !== "string") {
    throw new Error("taskpad.path should be string");
  }
  if (typeof result.taskpad.lineCount !== "number") {
    throw new Error("taskpad.lineCount should be number");
  }
  if (typeof result.taskpad.sectionCount !== "number") {
    throw new Error("taskpad.sectionCount should be number");
  }

  console.log("✅ Result structure validation passed");
}

function testCanonical(): void {
  console.log("\n=== Testing Canonical TASKPAD ===");
  const result = reconcileTaskpad({
    taskpadPath: "/Users/t3rpz/projects/obsidian-web-clipper/tests/tools/fixtures/canonical-taskpad.md",
  });

  verifyResult(result);

  if (result.status !== "canonical") {
    throw new Error(`Expected canonical status, got: ${result.status}`);
  }
  if (!result.ordering.isCanonicalOrder) {
    throw new Error("Expected canonical order");
  }
  if (result.reasonCodes[0] !== "RECONCILE_CANONICAL") {
    throw new Error(`Expected RECONCILE_CANONICAL, got: ${result.reasonCodes[0]}`);
  }
  if (result.healedSections.length > 0) {
    throw new Error("Expected no healed sections");
  }

  console.log("✅ Canonical test passed");
}

function testMissingExecutionQueue(): void {
  console.log("\n=== Testing Missing Execution Queue ===");
  const result = reconcileTaskpad({
    taskpadPath: "/Users/t3rpz/projects/obsidian-web-clipper/tests/tools/fixtures/taskpad-missing-execution-queue.md",
  });

  verifyResult(result);

  if (result.status !== "healed") {
    throw new Error(`Expected healed status, got: ${result.status}`);
  }
  if (result.sectionsPresent.executionQueue !== false) {
    throw new Error("Expected Execution Queue to be missing");
  }
  if (!result.healedSections.includes("## Execution Queue")) {
    throw new Error("Expected ## Execution Queue in healedSections");
  }
  if (!result.reasonCodes.includes("RECONCILE_MISSING_SECTION")) {
    throw new Error("Expected RECONCILE_MISSING_SECTION reason code");
  }

  console.log("✅ Missing Execution Queue test passed");
}

function testOutOfOrder(): void {
  console.log("\n=== Testing Out-of-Order Sections ===");
  const result = reconcileTaskpad({
    taskpadPath: "/Users/t3rpz/projects/obsidian-web-clipper/tests/tools/fixtures/taskpad-out-of-order.md",
  });

  verifyResult(result);

  if (result.status !== "healed") {
    throw new Error(`Expected healed status, got: ${result.status}`);
  }
  if (result.ordering.isCanonicalOrder) {
    throw new Error("Expected non-canonical order");
  }
  if (!result.reasonCodes.includes("RECONCILE_OUT_OF_ORDER")) {
    throw new Error("Expected RECONCILE_OUT_OF_ORDER reason code");
  }

  console.log("✅ Out-of-order test passed");
}

function testDuplicateHeadings(): void {
  console.log("\n=== Testing Duplicate Headings ===");
  const result = reconcileTaskpad({
    taskpadPath: "/Users/t3rpz/projects/obsidian-web-clipper/tests/tools/fixtures/taskpad-duplicate-headings.md",
  });

  verifyResult(result);

  if (result.status !== "healed") {
    throw new Error(`Expected healed status, got: ${result.status}`);
  }
  if (!result.reasonCodes.includes("RECONCILE_DUPLICATE_HEADING")) {
    throw new Error("Expected RECONCILE_DUPLICATE_HEADING reason code");
  }

  console.log("✅ Duplicate headings test passed");
}

function testNonExistentFile(): void {
  console.log("\n=== Testing Non-Existent File ===");
  const result = reconcileTaskpad({
    taskpadPath: "/nonexistent/taskpad.md",
  });

  if (result.status !== "error") {
    throw new Error(`Expected error status, got: ${result.status}`);
  }
  if (!result.reasonCodes.includes("RECONCILE_TASKPAD_NOT_FOUND")) {
    throw new Error("Expected RECONCILE_TASKPAD_NOT_FOUND reason code");
  }
  if (!result.error) {
    throw new Error("Expected error details");
  }
  if (result.error.code !== "RECONCILE_TASKPAD_NOT_FOUND") {
    throw new Error(`Expected error code RECONCILE_TASKPAD_NOT_FOUND, got: ${result.error.code}`);
  }

  console.log("✅ Non-existent file test passed");
}

function main(): void {
  console.log("=== TP002 Verification Tests ===");

  try {
    testCanonical();
    testMissingExecutionQueue();
    testOutOfOrder();
    testDuplicateHeadings();
    testNonExistentFile();

    console.log("\n" + "=".repeat(50));
    console.log("✅ ALL VERIFICATION TESTS PASSED");
    console.log("=".repeat(50));
  } catch (error) {
    console.error("\n" + "=".repeat(50));
    console.error("❌ VERIFICATION FAILED");
    console.error("=".repeat(50));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
