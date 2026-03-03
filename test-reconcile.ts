#!/usr/bin/env bun

import { reconcileTaskpad, type QueueReconcileResult } from "./tools/lib/taskpad-queue-reconcile";
import { resolve } from "node:path";

function main(): void {
  const taskpadPath = resolve(
    "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md",
  );

  console.log("Running reconcile on TASKPAD.md:");
  console.log(`- Path: ${taskpadPath}`);
  console.log("");

  const result = reconcileTaskpad({ taskpadPath });

  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
  main();
}
