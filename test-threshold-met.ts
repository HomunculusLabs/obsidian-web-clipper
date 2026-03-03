import { calculateGap } from './tools/pilot-sample-gap-planner';

const threshold = {
  minSent: 10,
  minReplies: 3,
  source: "test-brief.md",
};

// Test case 1: Threshold met (both sent AND replies satisfied)
const stateMet = {
  totalSent: 15,
  totalReplied: 5,
  pending: 0,
  coldAged: 0,
  byChannel: { "X DM": { sent: 15, replied: 5 } },
};

const gapMet = calculateGap(threshold, stateMet, 3, "2026-03-01T12:00:00Z");

console.log("Test 1: Threshold met (sent=15 >= 10, replied=5 >= 3)");
console.log("Expected: remainingSent=0, requiredBatches=0, channelMix=[], latestSendBy=null");
console.log("Actual:", JSON.stringify(gapMet, null, 2));
const pass1 = gapMet.remainingSent === 0 && gapMet.requiredBatches === 0 && gapMet.channelMix.length === 0 && gapMet.latestSendBy === null;
console.log("Pass:", pass1);
console.log("");

// Test case 2: Sent met but replies not met (should NOT short-circuit based on replies alone)
const statePartialMet = {
  totalSent: 15,
  totalReplied: 1,
  pending: 0,
  coldAged: 0,
  byChannel: { "X DM": { sent: 15, replied: 1 } },
};

const gapPartialMet = calculateGap(threshold, statePartialMet, 3, "2026-03-01T12:00:00Z");

console.log("Test 2: Sent met but replies not met (sent=15 >= 10, replied=1 < 3)");
console.log("Expected: remainingSent=0 (no more sends needed), requiredBatches=0");
console.log("Actual:", JSON.stringify(gapPartialMet, null, 2));
const pass2 = gapPartialMet.remainingSent === 0 && gapPartialMet.requiredBatches === 0;
console.log("Pass:", pass2);
console.log("");

// Test case 3: Neither met (normal gap calculation)
const stateNotMet = {
  totalSent: 3,
  totalReplied: 0,
  pending: 3,
  coldAged: 0,
  byChannel: { "X DM": { sent: 3, replied: 0 } },
};

const gapNotMet = calculateGap(threshold, stateNotMet, 3, "2026-03-01T12:00:00Z");

console.log("Test 3: Neither threshold met (sent=3 < 10, replied=0 < 3)");
console.log("Expected: remainingSent=7, requiredBatches=3, channelMix with 3 sends, latestSendBy set");
console.log("Actual:", JSON.stringify(gapNotMet, null, 2));
const pass3 = gapNotMet.remainingSent === 7 && gapNotMet.requiredBatches === 3 && gapNotMet.channelMix.length > 0 && gapNotMet.latestSendBy !== null;
console.log("Pass:", pass3);

if (pass1 && pass2 && pass3) {
  console.log("\nAll tests passed!");
  process.exit(0);
} else {
  console.log("\nSome tests failed!");
  process.exit(1);
}
