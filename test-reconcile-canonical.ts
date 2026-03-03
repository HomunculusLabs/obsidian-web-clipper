#!/usr/bin/env bun

import { reconcileTaskpad } from "./tools/lib/taskpad-queue-reconcile";

function main(): void {
  const testPath = "/Users/t3rpz/projects/obsidian-web-clipper/tests/tools/fixtures/canonical-taskpad.md";

  console.log("Testing canonical TASKPAD:");
  console.log(`- Path: ${testPath}`);
  console.log("");

  const result = reconcileTaskpad({ taskpadPath: testPath });

  console.log(JSON.stringify(result, null, 2));
  console.log("");
  console.log("Status:", result.status);
  console.log("Is canonical order?", result.ordering.isCanonicalOrder);
  console.log("Reason codes:", result.reasonCodes);
}

if (import.meta.main) {
  main();
}
