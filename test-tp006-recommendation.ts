#!/usr/bin/env bun

/**
 * Test script for TP006: Deterministic recommendation engine
 */

import { calculateTelemetry, calculateRecommendation } from "./tools/pilot-price-signal.ts";

// Test case 1: Anchor meets threshold (>=60% YES rate, n>=3)
console.log("=== Test 1: Anchor meets acceptance threshold ===");
const test1Rows = [
  {
    recipient: "user1",
    sourceChannel: "X DM",
    workflowSentence: "test",
    objectionType: "none",
    wtp: 12,
    nextStepDecision: "advance",
    decisionRationale: "test",
    responseState: "PILOT YES",
  },
  {
    recipient: "user2",
    sourceChannel: "X DM",
    workflowSentence: "test",
    objectionType: "none",
    wtp: 12,
    nextStepDecision: "advance",
    decisionRationale: "test",
    responseState: "PILOT YES",
  },
  {
    recipient: "user3",
    sourceChannel: "X DM",
    workflowSentence: "test",
    objectionType: "none",
    wtp: 12,
    nextStepDecision: "advance",
    decisionRationale: "test",
    responseState: "PILOT YES",
  },
];
const telemetry1 = calculateTelemetry(test1Rows);
const recommendation1 = calculateRecommendation(telemetry1);
console.log("Recommended anchor:", recommendation1.recommendedNextAnchor);
console.log("Anchor context:", recommendation1.anchorContext);
console.log("Rationale:", recommendation1.rationale);
console.log("Precedence chain:", recommendation1.precedenceChain);
console.log("");

// Test case 2: Higher bucket has best rate
console.log("=== Test 2: Higher bucket ($13-$15) has best rate ===");
const test2Rows = [
  {
    recipient: "user1",
    sourceChannel: "X DM",
    workflowSentence: "test",
    objectionType: "none",
    wtp: 14,
    nextStepDecision: "advance",
    decisionRationale: "test",
    responseState: "PILOT YES",
  },
  {
    recipient: "user2",
    sourceChannel: "X DM",
    workflowSentence: "test",
    objectionType: "none",
    wtp: 14,
    nextStepDecision: "advance",
    decisionRationale: "test",
    responseState: "PILOT YES",
  },
  {
    recipient: "user3",
    sourceChannel: "X DM",
    workflowSentence: "test",
    objectionType: "none",
    wtp: 12,
    nextStepDecision: "nurture",
    decisionRationale: "test",
    responseState: "PILOT NO",
  },
];
const telemetry2 = calculateTelemetry(test2Rows);
const recommendation2 = calculateRecommendation(telemetry2);
console.log("Recommended anchor:", recommendation2.recommendedNextAnchor);
console.log("Anchor context:", recommendation2.anchorContext);
console.log("Rationale:", recommendation2.rationale);
console.log("Precedence chain:", recommendation2.precedenceChain);
console.log("");

// Test case 3: Lower bucket has best rate
console.log("=== Test 3: Lower bucket ($8-$11) has best rate ===");
const test3Rows = [
  {
    recipient: "user1",
    sourceChannel: "X DM",
    workflowSentence: "test",
    objectionType: "none",
    wtp: 10,
    nextStepDecision: "advance",
    decisionRationale: "test",
    responseState: "PILOT YES",
  },
  {
    recipient: "user2",
    sourceChannel: "X DM",
    workflowSentence: "test",
    objectionType: "none",
    wtp: 10,
    nextStepDecision: "advance",
    decisionRationale: "test",
    responseState: "PILOT YES",
  },
  {
    recipient: "user3",
    sourceChannel: "X DM",
    workflowSentence: "test",
    objectionType: "none",
    wtp: 12,
    nextStepDecision: "nurture",
    decisionRationale: "test",
    responseState: "PILOT NO",
  },
];
const telemetry3 = calculateTelemetry(test3Rows);
const recommendation3 = calculateRecommendation(telemetry3);
console.log("Recommended anchor:", recommendation3.recommendedNextAnchor);
console.log("Anchor context:", recommendation3.anchorContext);
console.log("Rationale:", recommendation3.rationale);
console.log("Precedence chain:", recommendation3.precedenceChain);
console.log("");

// Test case 4: No data
console.log("=== Test 4: No response data ===");
const telemetry4 = calculateTelemetry([]);
const recommendation4 = calculateRecommendation(telemetry4);
console.log("Recommended anchor:", recommendation4.recommendedNextAnchor);
console.log("Anchor context:", recommendation4.anchorContext);
console.log("Rationale:", recommendation4.rationale);
console.log("Precedence chain:", recommendation4.precedenceChain);
console.log("");

// Test case 5: Tie-break by sample size
console.log("=== Test 5: Tie-break by sample size ===");
const test5Rows = [
  {
    recipient: "user1",
    sourceChannel: "X DM",
    workflowSentence: "test",
    objectionType: "none",
    wtp: 12,
    nextStepDecision: "advance",
    decisionRationale: "test",
    responseState: "PILOT YES",
  },
  {
    recipient: "user2",
    sourceChannel: "X DM",
    workflowSentence: "test",
    objectionType: "none",
    wtp: 12,
    nextStepDecision: "advance",
    decisionRationale: "test",
    responseState: "PILOT YES",
  },
  {
    recipient: "user3",
    sourceChannel: "X DM",
    workflowSentence: "test",
    objectionType: "none",
    wtp: 14,
    nextStepDecision: "advance",
    decisionRationale: "test",
    responseState: "PILOT YES",
  },
];
const telemetry5 = calculateTelemetry(test5Rows);
const recommendation5 = calculateRecommendation(telemetry5);
console.log("Recommended anchor:", recommendation5.recommendedNextAnchor);
console.log("Anchor context:", recommendation5.anchorContext);
console.log("Rationale:", recommendation5.rationale);
console.log("Precedence chain:", recommendation5.precedenceChain);
console.log("");

// Test case 6: Test with happy fixture data
console.log("=== Test 6: Happy fixture data ===");
const happyFixtureRows = [
  {
    recipient: "alpha_test",
    sourceChannel: "X DM",
    workflowSentence: "I need a web clipper for Obsidian to save tweets and articles",
    objectionType: "workflow-fit",
    wtp: 12,
    nextStepDecision: "advance",
    decisionRationale: "User clearly needs the feature, WTP matches anchor price",
    responseState: "PILOT YES",
  },
  {
    recipient: "bravo_test",
    sourceChannel: "Discord DM",
    workflowSentence: "I want to clip blog posts and organize them in my vault",
    objectionType: "price",
    wtp: 8,
    nextStepDecision: "nurture",
    decisionRationale: "Interested but budget constrained, lower price point preferred",
    responseState: "PILOT NO",
  },
  {
    recipient: "charlie_test",
    sourceChannel: "Email",
    workflowSentence: "Need to clip screenshots from Twitter threads",
    objectionType: "trust",
    wtp: 15,
    nextStepDecision: "advance",
    decisionRationale: "High WTP, interested in advanced screenshot features",
    responseState: "PILOT YES",
  },
  {
    recipient: "delta_test",
    sourceChannel: "X DM",
    workflowSentence: "Looking for a browser extension for quick clipping",
    objectionType: "workflow-fit",
    wtp: 10,
    nextStepDecision: "nurture",
    decisionRationale: "Feature fit but price too high for current needs",
    responseState: "PILOT NO",
  },
  {
    recipient: "echo_test",
    sourceChannel: "Discord DM",
    workflowSentence: "Want to clip YouTube videos and save transcripts",
    objectionType: "missing-feature",
    wtp: 18,
    nextStepDecision: "advance",
    decisionRationale: "WTP is high, needs video transcript feature",
    responseState: "PILOT YES",
  },
];
const telemetry6 = calculateTelemetry(happyFixtureRows);
console.log("Price bucket counts:", telemetry6.priceBucketCounts);
console.log("PILOT YES rate by bucket:", telemetry6.pilotYesRateByBucket);
const recommendation6 = calculateRecommendation(telemetry6);
console.log("Recommended anchor:", recommendation6.recommendedNextAnchor);
console.log("Anchor context:", recommendation6.anchorContext);
console.log("Rationale:", recommendation6.rationale);
console.log("Precedence chain:", recommendation6.precedenceChain);
