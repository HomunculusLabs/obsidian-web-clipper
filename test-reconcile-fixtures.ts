#!/usr/bin/env bun

import { reconcileTaskpad } from "./tools/lib/taskpad-queue-reconcile";
import { resolve } from "node:path";

const fixtures = [
  { name: "canonical", path: "tests/tools/fixtures/canonical-taskpad.md" },
  { name: "missing-execution-queue", path: "tests/tools/fixtures/taskpad-missing-execution-queue.md" },
  { name: "out-of-order", path: "tests/tools/fixtures/taskpad-out-of-order.md" },
  { name: "duplicate-headings", path: "tests/tools/fixtures/taskpad-duplicate-headings.md" },
];

function main(): void {
  console.log("Testing reconcile on fixtures:\n");

  for (const fixture of fixtures) {
    const fixturePath = resolve(fixture.path);

    console.log(`=== ${fixture.name} ===`);
    console.log(`Path: ${fixturePath}`);

    const result = reconcileTaskpad({ taskpadPath: fixturePath });

    console.log(`Status: ${result.status}`);
    console.log(`Canonical order: ${result.ordering.isCanonicalOrder}`);
    console.log(`Reason codes: ${result.reasonCodes.join(", ")}`);
    console.log(`Healed sections: ${result.healedSections.join(", ") || "none"}`);
    console.log(`Sections present:`);
    console.log(`  - Work Queue: ${result.sectionsPresent.workQueue}`);
    console.log(`  - Execution Queue: ${result.sectionsPresent.executionQueue}`);
    console.log(`  - Autonomous Kickoff Queue: ${result.sectionsPresent.autonomousKickoffQueue}`);
    console.log(`  - Self-Improvement Backlog: ${result.sectionsPresent.selfImprovementBacklog}`);
    console.log();
  }
}

if (import.meta.main) {
  main();
}
