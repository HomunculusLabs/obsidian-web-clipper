#!/usr/bin/env node

/**
 * Quick test to verify TP005 implementation
 */

import { calculateTelemetry } from "./tools/pilot-price-signal.ts";

// Test data with various WTP values and response states
const testRows = [
  {
    recipient: "alice",
    sourceChannel: "X DM",
    workflowSentence: "I clip research articles manually",
    objectionType: "price",
    wtp: 10,
    nextStepDecision: "advance",
    decisionRationale: "Fits ICP",
    responseState: "PILOT YES",
  },
  {
    recipient: "bob",
    sourceChannel: "Email",
    workflowSentence: "Browser extension workflow",
    objectionType: "trust",
    wtp: 12,
    nextStepDecision: "nurture",
    decisionRationale: "Needs more info",
    responseState: "PILOT NO - too expensive",
  },
  {
    recipient: "charlie",
    sourceChannel: "X DM",
    workflowSentence: "Manual copy paste",
    objectionType: "workflow-fit",
    wtp: 15,
    nextStepDecision: "advance",
    decisionRationale: "Strong fit",
    responseState: "PILOT YES",
  },
  {
    recipient: "diana",
    sourceChannel: "Email",
    workflowSentence: "Bookmarking workflow",
    objectionType: "",
    wtp: 8,
    nextStepDecision: "disqualify",
    decisionRationale: "No clipping pain",
    responseState: "PILOT NO - no use case",
  },
  {
    recipient: "eve",
    sourceChannel: "Discord DM",
    workflowSentence: "Obsidian daily user",
    objectionType: "missing-feature",
    wtp: 18,
    nextStepDecision: "advance",
    decisionRationale: "High WTP, feature gap addressed",
    responseState: "PILOT YES",
  },
];

// Expected bucket assignments:
// - alice (10) -> $8-$11
// - bob (12) -> $12
// - charlie (15) -> $13-$15
// - diana (8) -> $8-$11
// - eve (18) -> $16-$19

console.log("Testing TP005: Per-price-bucket reducers\n");

// Import and run calculateTelemetry
const telemetry = calculateTelemetry(testRows);

console.log("=== priceBucketCounts ===");
console.log(JSON.stringify(telemetry.priceBucketCounts, null, 2));

console.log("\n=== pilotYesRateByBucket ===");
for (const [bucket, data] of Object.entries(telemetry.pilotYesRateByBucket)) {
  const rate = (data.rate * 100).toFixed(1);
  console.log(`  ${bucket}: ${data.yes}/${data.total} (${rate}%)`);
}

console.log(`\n=== medianWTP ===`);
console.log(`  $${telemetry.medianWTP}/mo`);

console.log(`\n=== objectionMix ===`);
console.log(JSON.stringify(telemetry.objectionMix, null, 2));

// Verify expectations
console.log("\n=== Verification ===");

const expectedBucketCounts = {
  "$8-$11": 2,  // alice (10), diana (8)
  "$12": 1,     // bob (12)
  "$13-$15": 1, // charlie (15)
  "$16-$19": 1, // eve (18)
};

let allPass = true;

for (const [bucket, expected] of Object.entries(expectedBucketCounts)) {
  const actual = telemetry.priceBucketCounts[bucket];
  const pass = actual === expected;
  allPass = allPass && pass;
  console.log(`  ${bucket}: ${actual} (expected ${expected}) ${pass ? "✓" : "✗"}`);
}

// Expected PILOT YES rates
console.log("\nPILOT YES rate verification:");
const expectedYesRates = {
  "$8-$11": { yes: 1, total: 2 }, // alice YES, diana NO
  "$12": { yes: 0, total: 1 },    // bob NO
  "$13-$15": { yes: 1, total: 1 }, // charlie YES
  "$16-$19": { yes: 1, total: 1 }, // eve YES
};

for (const [bucket, expected] of Object.entries(expectedYesRates)) {
  const actual = telemetry.pilotYesRateByBucket[bucket];
  const pass = actual.yes === expected.yes && actual.total === expected.total;
  allPass = allPass && pass;
  console.log(`  ${bucket}: ${actual.yes}/${actual.total} (expected ${expected.yes}/${expected.total}) ${pass ? "✓" : "✗"}`);
}

// Expected median: [8, 10, 12, 15, 18] -> 12
console.log(`\nmedianWTP: ${telemetry.medianWTP} (expected 12) ${telemetry.medianWTP === 12 ? "✓" : "✗"}`);

// Expected objection mix
console.log(`\nobjectionMix verification:`);
const expectedObjections = {
  price: 1,
  trust: 1,
  "workflow-fit": 1,
  "missing-feature": 1,
};

for (const [objection, expected] of Object.entries(expectedObjections)) {
  const actual = telemetry.objectionMix[objection] || 0;
  const pass = actual === expected;
  allPass = allPass && pass;
  console.log(`  ${objection}: ${actual} (expected ${expected}) ${pass ? "✓" : "✗"}`);
}

// Check stable key ordering
console.log("\n=== Stable Key Ordering ===");
const bucketKeys = Object.keys(telemetry.priceBucketCounts);
const expectedBucketOrder = ["$8-$11", "$12", "$13-$15", "$16-$19"];
const orderMatches = JSON.stringify(bucketKeys) === JSON.stringify(expectedBucketOrder);
console.log(`  Bucket order: ${JSON.stringify(bucketKeys)} ${orderMatches ? "✓" : "✗"}`);
allPass = allPass && orderMatches;

const objectionKeys = Object.keys(telemetry.objectionMix);
const expectedObjectionOrder = ["missing-feature", "price", "trust", "workflow-fit"];
const objectionOrderMatches = JSON.stringify(objectionKeys) === JSON.stringify(expectedObjectionOrder);
console.log(`  Objection order: ${JSON.stringify(objectionKeys)} ${objectionOrderMatches ? "✓" : "✗"}`);
allPass = allPass && objectionOrderMatches;

console.log(`\n${allPass ? "✅ All tests passed" : "❌ Some tests failed"}`);
process.exit(allPass ? 0 : 1);
