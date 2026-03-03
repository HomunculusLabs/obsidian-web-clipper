#!/usr/bin/env bun

import { calculateChannelMix } from '../../tools/pilot-sample-gap-planner';

// Test case 1: All channels tied (0% reply rate)
console.log("Test 1: All channels tied (0% rate)");
const state1 = {
  totalSent: 6,
  totalReplied: 0,
  pending: 6,
  coldAged: 0,
  byChannel: {
    "X DM": { sent: 2, replied: 0 },
    "Discord DM": { sent: 2, replied: 0 },
    "Email": { sent: 2, replied: 0 },
  },
};
console.log(JSON.stringify(calculateChannelMix(state1, 3), null, 2));

// Test case 2: Different reply rates
console.log("\nTest 2: Different reply rates");
const state2 = {
  totalSent: 10,
  totalReplied: 5,
  pending: 5,
  coldAged: 0,
  byChannel: {
    "X DM": { sent: 5, replied: 5 },  // 100% rate
    "Discord DM": { sent: 5, replied: 0 }, // 0% rate
  },
};
console.log(JSON.stringify(calculateChannelMix(state2, 3), null, 2));

// Test case 3: More channels than target count
console.log("\nTest 3: More channels than target count");
const state3 = {
  totalSent: 4,
  totalReplied: 0,
  pending: 4,
  coldAged: 0,
  byChannel: {
    "Channel A": { sent: 1, replied: 0 },
    "Channel B": { sent: 1, replied: 0 },
    "Channel C": { sent: 1, replied: 0 },
    "Channel D": { sent: 1, replied: 0 },
  },
};
console.log(JSON.stringify(calculateChannelMix(state3, 2), null, 2));

// Test case 4: Large batch size with few channels
console.log("\nTest 4: Large batch size (10) with 2 channels");
const state4 = {
  totalSent: 10,
  totalReplied: 3,
  pending: 7,
  coldAged: 0,
  byChannel: {
    "X DM": { sent: 5, replied: 3 },  // 60% rate
    "Discord DM": { sent: 5, replied: 0 }, // 0% rate
  },
};
console.log(JSON.stringify(calculateChannelMix(state4, 10), null, 2));

// Test case 5: Verify determinism - run twice
console.log("\nTest 5: Determinism check");
const state5 = {
  totalSent: 3,
  totalReplied: 0,
  pending: 3,
  coldAged: 0,
  byChannel: {
    "X DM": { sent: 1, replied: 0 },
    "Discord DM": { sent: 1, replied: 0 },
    "Email": { sent: 1, replied: 0 },
  },
};
const run1 = JSON.stringify(calculateChannelMix(state5, 5));
const run2 = JSON.stringify(calculateChannelMix(state5, 5));
console.log("Run 1:", run1);
console.log("Run 2:", run2);
console.log("Deterministic:", run1 === run2);

// Test case 6: Tie-breaking with alphabetical order
console.log("\nTest 6: Tie-breaking verification (all 0% rates)");
const state6 = {
  totalSent: 3,
  totalReplied: 0,
  pending: 3,
  coldAged: 0,
  byChannel: {
    "Zulu": { sent: 1, replied: 0 },
    "Alpha": { sent: 1, replied: 0 },
    "Beta": { sent: 1, replied: 0 },
  },
};
const mix6 = calculateChannelMix(state6, 3);
console.log("Output:", JSON.stringify(mix6));
const channels6 = mix6.map(m => m.channel);
console.log("Channels in order:", channels6);
console.log("Sorted alphabetically:", JSON.stringify(channels6.slice().sort()));
