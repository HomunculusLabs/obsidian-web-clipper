#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type QueueSection = "autonomous" | "selfImprovement";

interface QueueHealthCounts {
  autonomousUncheckedCount: number;
  selfImprovementUncheckedCount: number;
  totalUnchecked: number;
}

const AUTONOMOUS_HEADING = "## Autonomous Kickoff Queue";
const SELF_IMPROVEMENT_HEADING = "## Self-Improvement Backlog";

function printHelp(): void {
  console.log(`
TASKPAD Queue Health Checker

USAGE:
  bun run tools/taskpad-queue-health.ts --taskpad <path>
  bun run tools/taskpad-queue-health.ts <path>

OPTIONS:
  --taskpad <path>   Path to TASKPAD markdown file (required unless positional path is provided)
  --help, -h         Show this help message
`);
}

function parseArgs(argv: string[]): { taskpadPath?: string } {
  let taskpadPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--taskpad") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --taskpad");
        process.exit(1);
      }
      taskpadPath = value;
      continue;
    }

    if (!arg.startsWith("-") && !taskpadPath) {
      taskpadPath = arg;
      continue;
    }

    console.error(`Unknown argument: ${arg}`);
    printHelp();
    process.exit(1);
  }

  return { taskpadPath };
}

function getSectionHeading(line: string): QueueSection | null {
  const trimmed = line.trim();

  if (trimmed === AUTONOMOUS_HEADING) {
    return "autonomous";
  }

  if (trimmed === SELF_IMPROVEMENT_HEADING) {
    return "selfImprovement";
  }

  return null;
}

function isAnyH2(line: string): boolean {
  return /^##\s+/.test(line.trim());
}

function isUncheckedTaskBullet(line: string): boolean {
  return /^\s*[-*+]\s+\[\s*\](?:\s+.*)?$/.test(line);
}

export function countQueueHealth(taskpadMarkdown: string): QueueHealthCounts {
  let autonomousUncheckedCount = 0;
  let selfImprovementUncheckedCount = 0;
  let activeSection: QueueSection | null = null;

  const lines = taskpadMarkdown.split(/\r?\n/);

  for (const line of lines) {
    const heading = getSectionHeading(line);
    if (heading) {
      activeSection = heading;
      continue;
    }

    if (isAnyH2(line)) {
      activeSection = null;
      continue;
    }

    if (!activeSection || !isUncheckedTaskBullet(line)) {
      continue;
    }

    if (activeSection === "autonomous") {
      autonomousUncheckedCount++;
    } else {
      selfImprovementUncheckedCount++;
    }
  }

  return {
    autonomousUncheckedCount,
    selfImprovementUncheckedCount,
    totalUnchecked: autonomousUncheckedCount + selfImprovementUncheckedCount,
  };
}

function main(): void {
  const { taskpadPath } = parseArgs(process.argv.slice(2));

  if (!taskpadPath) {
    console.error("Missing TASKPAD path. Provide --taskpad <path> or a positional path.");
    printHelp();
    process.exit(1);
  }

  const resolvedPath = resolve(taskpadPath);

  let markdown: string;
  try {
    markdown = readFileSync(resolvedPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to read TASKPAD file at ${resolvedPath}: ${message}`);
    process.exit(1);
  }

  const counts = countQueueHealth(markdown);

  if (counts.totalUnchecked === 0) {
    console.error("TASKPAD queue health: FAIL");
    console.error(`- autonomousUncheckedCount: ${counts.autonomousUncheckedCount}`);
    console.error(`- selfImprovementUncheckedCount: ${counts.selfImprovementUncheckedCount}`);
    console.error("Intake blocked: both execution queues are empty.");
    console.error("Seed at least one unchecked item in either queue using this canonical bullet template:");
    console.error("- [ ] planned-YYYY-MM-DD <actionable next step>");
    console.error(
      "`planned-YYYY-MM-DD` lifecycle: keep this prefix while queued/planned, then progress the same item to active execution and finally [x] done.",
    );
    process.exit(1);
  }

  console.log("TASKPAD queue health: PASS");
  console.log(`- autonomousUncheckedCount: ${counts.autonomousUncheckedCount}`);
  console.log(`- selfImprovementUncheckedCount: ${counts.selfImprovementUncheckedCount}`);
  console.log(`- totalUnchecked: ${counts.totalUnchecked}`);
}

if (import.meta.main) {
  main();
}
