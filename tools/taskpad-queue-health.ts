#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type QueueSection =
  | "workQueue"
  | "executionQueue"
  | "autonomous"
  | "selfImprovement";

export interface QueueHealthCounts {
  // Executable queues (Builder-ready)
  workQueueUncheckedCount: number;
  executionQueueUncheckedCount: number;

  // Intake/planning queues (require promotion/seeding)
  autonomousUncheckedCount: number;
  selfImprovementUncheckedCount: number;

  // Aggregates (for backward compatibility and quick checks)
  executableQueueTotal: number;
  intakeQueueTotal: number;
  totalUnchecked: number;
}

export interface QueueHealthResult {
  status: "pass" | "fail";
  reasonCode: string;
  queueHealth: QueueHealthCounts;
}

const WORK_QUEUE_HEADING = "## Work Queue";
const EXECUTION_QUEUE_HEADING = "## Execution Queue";
const AUTONOMOUS_HEADING = "## Autonomous Kickoff Queue";
const SELF_IMPROVEMENT_HEADING = "## Self-Improvement Backlog";

const REASON_CODES = {
  EXECUTABLE_QUEUES_EMPTY: "QH001_EXECUTABLE_QUEUES_EMPTY",
  QUEUE_READY: "QH002_QUEUE_READY",
  WORK_QUEUE_MISSING: "QH003_WORK_QUEUE_MISSING",
  EXECUTION_QUEUE_MISSING: "QH004_EXECUTION_QUEUE_MISSING",
} as const;

function printHelp(): void {
  console.log(`
TASKPAD Queue Health Checker

USAGE:
  bun run tools/taskpad-queue-health.ts --taskpad <path>
  bun run tools/taskpad-queue-health.ts <path>

OPTIONS:
  --taskpad <path>   Path to TASKPAD markdown file (required unless positional path is provided)
  --format <format>  Output format: 'human' (default) or 'json'
  --help, -h         Show this help message
`);
}

function parseArgs(argv: string[]): {
  taskpadPath?: string;
  format: "human" | "json";
} {
  let taskpadPath: string | undefined;
  let format: "human" | "json" = "human";

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

    if (arg === "--format") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --format");
        process.exit(1);
      }
      if (value !== "human" && value !== "json") {
        console.error("Invalid format: must be 'human' or 'json'");
        process.exit(1);
      }
      format = value;
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

  return { taskpadPath, format };
}

function getSectionHeading(line: string): QueueSection | null {
  const trimmed = line.trim();

  if (trimmed === WORK_QUEUE_HEADING) {
    return "workQueue";
  }

  if (trimmed === EXECUTION_QUEUE_HEADING) {
    return "executionQueue";
  }

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

export function countQueueHealth(
  taskpadMarkdown: string,
): QueueHealthCounts & { workQueueHeadingFound: boolean; executionQueueHeadingFound: boolean } {
  let workQueueUncheckedCount = 0;
  let executionQueueUncheckedCount = 0;
  let autonomousUncheckedCount = 0;
  let selfImprovementUncheckedCount = 0;
  let activeSection: QueueSection | null = null;
  let workQueueHeadingFound = false;
  let executionQueueHeadingFound = false;

  const lines = taskpadMarkdown.split(/\r?\n/);

  for (const line of lines) {
    const heading = getSectionHeading(line);
    if (heading) {
      activeSection = heading;
      if (heading === "workQueue") {
        workQueueHeadingFound = true;
      }
      if (heading === "executionQueue") {
        executionQueueHeadingFound = true;
      }
      continue;
    }

    if (isAnyH2(line)) {
      activeSection = null;
      continue;
    }

    if (!activeSection || !isUncheckedTaskBullet(line)) {
      continue;
    }

    switch (activeSection) {
      case "workQueue":
        workQueueUncheckedCount++;
        break;
      case "executionQueue":
        executionQueueUncheckedCount++;
        break;
      case "autonomous":
        autonomousUncheckedCount++;
        break;
      case "selfImprovement":
        selfImprovementUncheckedCount++;
        break;
    }
  }

  const executableQueueTotal = workQueueUncheckedCount + executionQueueUncheckedCount;
  const intakeQueueTotal = autonomousUncheckedCount + selfImprovementUncheckedCount;
  const totalUnchecked = executableQueueTotal + intakeQueueTotal;

  return {
    workQueueUncheckedCount,
    executionQueueUncheckedCount,
    autonomousUncheckedCount,
    selfImprovementUncheckedCount,
    executableQueueTotal,
    intakeQueueTotal,
    totalUnchecked,
    workQueueHeadingFound,
    executionQueueHeadingFound,
  };
}

function formatHumanOutput(result: QueueHealthResult): string {
  const { status, reasonCode, queueHealth } = result;

  const lines = [
    `TASKPAD queue health: ${status.toUpperCase()}`,
    `- reasonCode: "${reasonCode}"`,
    `- workQueueUncheckedCount: ${queueHealth.workQueueUncheckedCount}`,
    `- executionQueueUncheckedCount: ${queueHealth.executionQueueUncheckedCount}`,
    `- autonomousUncheckedCount: ${queueHealth.autonomousUncheckedCount}`,
    `- selfImprovementUncheckedCount: ${queueHealth.selfImprovementUncheckedCount}`,
    `- executableQueueTotal: ${queueHealth.executableQueueTotal}`,
    `- intakeQueueTotal: ${queueHealth.intakeQueueTotal}`,
    `- totalUnchecked: ${queueHealth.totalUnchecked}`,
  ];

  if (status === "fail" && reasonCode === REASON_CODES.EXECUTABLE_QUEUES_EMPTY) {
    lines.push("");
    lines.push("Intake blocked: both executable queues are empty.");
    lines.push(
      "Seed at least one unchecked item in Work Queue using this canonical bullet template:",
    );
    lines.push("- [ ] planned-YYYY-MM-DD <actionable next step> Verify: <command>");
    lines.push("");
    lines.push("Or run auto-ideation with Work Queue routing:");
    lines.push(
      `bun run taskpad:auto-ideation -- --taskpad <path> --plan <plan> --target-queue work`,
    );
  }

  return lines.join("\n");
}

function formatJsonOutput(result: QueueHealthResult): string {
  // Sort keys alphabetically for deterministic output
  const sortedQueueHealth = Object.fromEntries(
    Object.entries(result.queueHealth)
      .filter(([key]) => key !== "workQueueHeadingFound" && key !== "executionQueueHeadingFound")
      .sort(([a], [b]) => a.localeCompare(b)),
  );

  const jsonOutput = JSON.stringify(
    {
      queueHealth: sortedQueueHealth,
      reasonCode: result.reasonCode,
      status: result.status,
    },
    null,
    2,
  );

  return `QUEUE_HEALTH_JSON_START\n${jsonOutput}\nQUEUE_HEALTH_JSON_END`;
}

function main(): void {
  const { taskpadPath, format } = parseArgs(process.argv.slice(2));

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
  const { workQueueHeadingFound, executionQueueHeadingFound, ...queueHealth } = counts;

  let status: "pass" | "fail";
  let reasonCode: string;

  // Determine reason code and status based on executable queue state
  if (!workQueueHeadingFound) {
    status = "fail";
    reasonCode = REASON_CODES.WORK_QUEUE_MISSING;
  } else if (!executionQueueHeadingFound) {
    status = "fail";
    reasonCode = REASON_CODES.EXECUTION_QUEUE_MISSING;
  } else if (queueHealth.executableQueueTotal === 0) {
    status = "fail";
    reasonCode = REASON_CODES.EXECUTABLE_QUEUES_EMPTY;
  } else {
    status = "pass";
    reasonCode = REASON_CODES.QUEUE_READY;
  }

  const result: QueueHealthResult = {
    status,
    reasonCode,
    queueHealth,
  };

  if (format === "json") {
    console.log(formatJsonOutput(result));
  } else {
    console.log(formatHumanOutput(result));
  }

  process.exit(status === "pass" ? 0 : 1);
}

if (import.meta.main) {
  main();
}
