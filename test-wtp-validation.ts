#!/usr/bin/env bun

/**
 * Quick test script for WTP validation (TP004)
 */

import { validateWTPValue, parseOfferBriefWTPRange } from "./tools/pilot-price-signal.ts";

// Test 1: Valid WTP values within range
console.log("Test 1: Valid WTP values within range ($8-$19)");
const validTests = [
  { value: 8, expected: 8 },
  { value: 12, expected: 12 },
  { value: 19, expected: 19 },
  { value: "$12", expected: 12 },
  { value: "15.50", expected: 15.5 },
];

const wtpRange = { min: 8, max: 19, source: "test" };

for (const test of validTests) {
  const result = validateWTPValue(test.value, wtpRange);
  if (result.valid && result.numericValue === test.expected) {
    console.log(`  ✅ ${test.value} → ${result.numericValue}`);
  } else {
    console.log(`  ❌ ${test.value} → ${JSON.stringify(result)}`);
  }
}

// Test 2: MISSING_WTP_VALUE errors
console.log("\nTest 2: MISSING_WTP_VALUE errors");
const missingTests = [
  "",
  "no response yet",
  "N/A",
  undefined,
  null,
];

for (const test of missingTests) {
  const result = validateWTPValue(test as any, wtpRange);
  if (!result.valid && result.ruleId === "MISSING_WTP_VALUE") {
    console.log(`  ✅ ${test ?? "undefined/null"} → ${result.ruleId}`);
  } else {
    console.log(`  ❌ ${test ?? "undefined/null"} → ${JSON.stringify(result)}`);
  }
}

// Test 3: INVALID_WTP_VALUE errors
console.log("\nTest 3: INVALID_WTP_VALUE errors");
const invalidTests = [
  "not a number",
  "maybe",
  "???",
];

for (const test of invalidTests) {
  const result = validateWTPValue(test, wtpRange);
  if (!result.valid && result.ruleId === "INVALID_WTP_VALUE") {
    console.log(`  ✅ "${test}" → ${result.ruleId}`);
  } else {
    console.log(`  ❌ "${test}" → ${JSON.stringify(result)}`);
  }
}

// Test 4: WTP_OUT_OF_RANGE errors
console.log("\nTest 4: WTP_OUT_OF_RANGE errors");
const outOfRangeTests = [
  { value: 5, expected: "below min" },
  { value: 7.99, expected: "below min" },
  { value: 20, expected: "above max" },
  { value: 25, expected: "above max" },
  { value: 100, expected: "above max" },
];

for (const test of outOfRangeTests) {
  const result = validateWTPValue(test.value, wtpRange);
  if (!result.valid && result.ruleId === "WTP_OUT_OF_RANGE") {
    console.log(`  ✅ ${test.value} (${test.expected}) → ${result.ruleId}`);
  } else {
    console.log(`  ❌ ${test.value} (${test.expected}) → ${JSON.stringify(result)}`);
  }
}

// Test 5: OFFER_BRIEF.md parsing
console.log("\nTest 5: OFFER_BRIEF.md parsing");
const briefContent = `
# Pricing Hypothesis

Acceptable test range: **$8-$19/mo** during pilot interviews.
`;

const parsedRange = parseOfferBriefWTPRange(briefContent, "OFFER_BRIEF.md");
if (parsedRange.min === 8 && parsedRange.max === 19) {
  console.log(`  ✅ Parsed range: $${parsedRange.min}-$${parsedRange.max}`);
} else {
  console.log(`  ❌ Parsed range: ${JSON.stringify(parsedRange)}`);
}

console.log("\nAll tests completed!");
