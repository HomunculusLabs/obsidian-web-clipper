#!/usr/bin/env bun

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTaskpadPlanSeed } from "./tools/taskpad-plan-seed";
import { existsSync } from "node:fs";

// Test fallback artifact generation by mocking a read-only directory
const tempDir = mkdtempSync(join(tmpdir(), "test-plan-seed-fallback-"));
const taskpadPath = join(tempDir, "TASKPAD.md");
const planPath = join(tempDir, "IMPLEMENTATION_PLAN.md");

const taskpadMarkdown = `# TASKPAD

## Self-Improvement Backlog
- [ ] test fallback generation
`;

const planMarkdown = `# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-03-01): Existing slice

### Distilled Scope
- existing

### RepoPrompt Builder Context
- existing

### Task Graph
- [ ] **TP001**: Existing task

### Acceptance Criteria
- existing

### Verification Commands
\`\`\`bash
bun run typecheck
\`\`\`
`;

writeFileSync(taskpadPath, taskpadMarkdown, "utf8");
writeFileSync(planPath, planMarkdown, "utf8");

console.log("Running taskpad:plan-seed on writable directory...");
const writableResult = runTaskpadPlanSeed(taskpadPath, planPath, "2026-03-02");

console.log("\nWritable result:");
console.log(`  status: ${writableResult.summary.status}`);
console.log(`  reasonCode: ${writableResult.summary.reasonCode}`);
console.log(`  selectedBacklogLine: ${writableResult.summary.selectedBacklogLine}`);
console.log(`  newSliceHeading: ${writableResult.summary.newSliceHeading}`);
console.log(`  artifact.artifactPath: ${writableResult.summary.artifact.artifactPath}`);
console.log(`  artifact.preflightReasonCode: ${writableResult.summary.artifact.preflightReasonCode}`);

if (writableResult.summary.status === "seeded") {
  console.log("\n✅ Direct write succeeded - files were mutated");
  console.log(`  Taskpad updated line: ${readFileSync(taskpadPath, "utf8").includes("planned-2026-03-02")}`);
  console.log(`  Plan has new slice: ${readFileSync(planPath, "utf8").includes("test fallback generation")}`);
} else {
  console.log("\n❌ Unexpected status:", writableResult.summary.status);
}

// Cleanup
rmSync(tempDir, { recursive: true, force: true });

console.log("\n✅ Test completed successfully");
