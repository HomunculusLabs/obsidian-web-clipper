#!/usr/bin/env bun

/**
 * Quick test for TP005 telemetry calculation
 */

import { calculateTelemetry, assignPriceBucket } from "./tools/pilot-price-signal.ts";

// Test price bucket assignment
console.log("Testing price bucket assignment:");

const testWTPs = [8, 10, 11.4, 11.5, 12, 12.4, 12.5, 15, 15.4, 15.5, 18, 20];

for (const wtp of testWTPs) {
  const bucket = assignPriceBucket(wtp);
  console.log(`  WTP ${wtp}: ${bucket}`);
}

// Test telemetry calculation
console.log("\nTesting telemetry calculation:");

const testRows = [
  {
    recipient: "alpha_test",
    sourceChannel: "X DM",
    workflowSentence: "I need a web clipper",
    objectionType: "workflow-fit",
    wtp: 12,
    nextStepDecision: "advance",
    decisionRationale: "Good fit",
    responseState: "PILOT YES",
  },
  {
    recipient: "bravo_test",
    sourceChannel: "Discord DM",
    workflowSentence: "Want to clip blog posts",
    objectionType: "price",
    wtp: 8,
    nextStepDecision: "nurture",
    decisionRationale: "Budget constrained",
    responseState: "PILOT NO",
  },
  {
    recipient: "charlie_test",
    sourceChannel: "Email",
    workflowSentence: "Need to clip screenshots",
    objectionType: "trust",
    wtp: 15,
    nextStepDecision: "advance",
    decisionRationale: "High WTP",
    responseState: "PILOT YES",
  },
  {
    recipient: "delta_test",
    sourceChannel: "X DM",
    workflowSentence: "Browser extension needed",
    objectionType: "workflow-fit",
    wtp: 10,
    nextStepDecision: "nurture",
    decisionRationale: "Price too high",
    responseState: "PILOT NO",
  },
  {
    recipient: "echo_test",
    sourceChannel: "Discord DM",
    workflowSentence: "Clip YouTube videos",
    objectionType: "missing-feature",
    wtp: 18,
    nextStepDecision: "advance",
    decisionRationale: "Needs video feature",
    responseState: "PILOT YES",
  },
];

const telemetry = calculateTelemetry(testRows);

console.log("\nPrice Bucket Counts:");
for (const [bucket, count] of Object.entries(telemetry.priceBucketCounts)) {
  console.log(`  ${bucket}: ${count}`);
}

console.log("\nPILOT YES Rate by Bucket:");
for (const [bucket, data] of Object.entries(telemetry.pilotYesRateByBucket)) {
  const rate = (data.rate * 100).toFixed(1);
  console.log(`  ${bucket}: ${data.yes}/${data.total} (${rate}%)`);
}

console.log(`\nMedian WTP: $${telemetry.medianWTP}/mo`);

console.log("\nObjection Mix:");
for (const [objection, count] of Object.entries(telemetry.objectionMix)) {
  console.log(`  ${objection}: ${count}`);
}
