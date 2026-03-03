#!/usr/bin/env bun

/**
 * Quick verification script for TP003 implementation
 */

import {
  discoverBatches,
  loadResponseLogArtifacts,
  normalizeResponseRowsForPricingAnalysis,
  normalizeWTPValue,
} from "./tools/pilot-price-signal.ts";

console.log("=== TP003 Verification ===\n");

// Test 1: discoverBatches
console.log("Test 1: discoverBatches");
try {
  const batches = discoverBatches("docs/distribution");
  console.log("  ✓ Discovered batches:", batches);
  console.log("  ✓ Sorted deterministically:", batches.join(", "));
} catch (error) {
  console.error("  ✗ Failed:", error);
}

// Test 2: loadResponseLogArtifacts
console.log("\nTest 2: loadResponseLogArtifacts");
try {
  const { rows, errors } = loadResponseLogArtifacts(
    "docs/distribution",
    discoverBatches("docs/distribution")
  );
  console.log("  ✓ Loaded rows:", rows.length);
  console.log("  ✓ Parse errors:", errors.length);
  if (errors.length > 0) {
    console.log("  Errors:", errors.map((e) => e.ruleId).join(", "));
  }
} catch (error) {
  console.error("  ✗ Failed:", error);
}

// Test 3: normalizeResponseRowsForPricingAnalysis
console.log("\nTest 3: normalizeResponseRowsForPricingAnalysis");
try {
  const { rows: allRows } = loadResponseLogArtifacts(
    "docs/distribution",
    discoverBatches("docs/distribution")
  );
  const { candidates, excluded } = normalizeResponseRowsForPricingAnalysis(allRows);
  console.log("  ✓ Candidate rows:", candidates.length);
  console.log("  ✓ Excluded rows:", excluded.length);
  console.log("  ✓ Exclusion reasons:", [...new Set(excluded.map((e) => e.reason))].join(", "));

  // Verify deterministic sorting
  const recipients = candidates.map((r) => r.recipient);
  const sorted = [...recipients].sort();
  console.log("  ✓ Sorted deterministically:", JSON.stringify(recipients) === JSON.stringify(sorted));
} catch (error) {
  console.error("  ✗ Failed:", error);
}

// Test 4: normalizeWTPValue
console.log("\nTest 4: normalizeWTPValue");
const testCases = [
  { input: 12, expected: 12, description: "numeric input" },
  { input: "12", expected: 12, description: "numeric string" },
  { input: "$12", expected: 12, description: "string with dollar sign" },
  { input: "12.50", expected: 12.5, description: "decimal string" },
  { input: "$12,345", expected: 12345, description: "string with comma" },
  { input: "no response yet", expected: NaN, description: "no response yet" },
  { input: "", expected: NaN, description: "empty string" },
  { input: "N/A", expected: NaN, description: "N/A" },
];

for (const testCase of testCases) {
  const result = normalizeWTPValue(testCase.input);
  const passed = isNaN(result) && isNaN(testCase.expected) ? true : result === testCase.expected;
  console.log(`  ${passed ? "✓" : "✗"} ${testCase.description}: ${JSON.stringify(testCase.input)} → ${result}`);
}

console.log("\n=== All TP003 tests completed ===");
