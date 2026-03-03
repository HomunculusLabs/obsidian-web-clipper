#!/usr/bin/env bun
/**
 * Quick validation test for TP002 scaffold - Command Target Resolution
 */

import {
  resolveCommandTarget,
  type CommandResolution,
  type CommandExecutionResult,
} from "./tools/taskpad-verification-pack-execution-gate";

const packageScripts = {
  typecheck: "tsc --noEmit",
  test: "bun test",
  "taskpad:verification-pack": "bun run tools/taskpad-verification-pack.ts",
  "taskpad:verification-pack-contract": "bun run tools/taskpad-verification-pack-contract.ts",
  "taskpad:verification-pack-execution-gate": "bun run tools/taskpad-verification-pack-execution-gate.ts",
};

const testCases = [
  {
    command: "typecheck",
    expectedType: "package-script",
    expectedResolved: true,
  },
  {
    command: "bun run typecheck",
    expectedType: "package-script",
    expectedResolved: true,
  },
  {
    command: "bun test tests/tools/*.test.ts",
    expectedType: "test-runner",
    expectedResolved: true,
  },
  {
    command: "tools/taskpad-queue-health.ts",
    expectedType: "tool-entry",
    expectedResolved: true,
  },
  {
    command: "bun run taskpad:verification-pack",
    expectedType: "verification-command",
    expectedResolved: true,
  },
  {
    command: "bun run taskpad:nonexistent-command",
    expectedType: "package-script",
    expectedResolved: false,
  },
  {
    command: "unknown-command",
    expectedType: "unknown",
    expectedResolved: false,
  },
];

console.log("Testing TP002 scaffold - Command Target Resolution");
console.log("=================================================\n");

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const resolution = resolveCommandTarget(testCase.command, packageScripts);

  const typeMatch = resolution.commandType === testCase.expectedType;
  const resolvedMatch = resolution.resolved === testCase.expectedResolved;

  const allPassed = typeMatch && resolvedMatch;

  if (allPassed) {
    passed++;
    console.log(`✓ PASS: ${testCase.command}`);
    console.log(`  Type: ${resolution.commandType}, Resolved: ${resolution.resolved}`);
    console.log(`  Message: ${resolution.message}`);
  } else {
    failed++;
    console.log(`✗ FAIL: ${testCase.command}`);
    console.log(`  Expected: type=${testCase.expectedType}, resolved=${testCase.expectedResolved}`);
    console.log(`  Got: type=${resolution.commandType}, resolved=${resolution.resolved}`);
    if (resolution.ruleId) {
      console.log(`  Rule ID: ${resolution.ruleId}`);
    }
    console.log(`  Message: ${resolution.message}`);
  }
  console.log("");
}

console.log("=================================================");
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log("✓ All tests passed!");
  process.exit(0);
} else {
  console.log("✗ Some tests failed!");
  process.exit(1);
}
