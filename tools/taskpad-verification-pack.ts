#!/usr/bin/env bun

/**
 * TASKPAD Verification Pack Generator
 *
 * Generates deterministic Builder handoff state from TASKPAD and IMPLEMENTATION_PLAN.
 * Emits history events for tracking pack generation across autonomous intake loops.
 *
 * Contract: docs/quality/taskpad-verification-pack-history.md
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

import {
  computeHash,
  computeWorkQueueFingerprint,
  createHistoryEvent,
  appendToHistory,
  getDefaultHistoryPath,
  getDefaultDedupeMode,
  type VerificationPackHistoryEvent,
  type DedupeMode,
  RULE_IDS,
} from "./lib/taskpad-verification-pack-history";

import {
  isolateNewestTaskpadIntakeSlice,
  validateVerificationCommandsBlock,
} from "./implementation-plan-integrity";

import {
  parseTaskpadPlannedItems,
  type TaskpadAnalysis,
} from "./taskpad-planned-command-parity";

// ============================================================================
// Constants
// ============================================================================

const WORK_QUEUE_HEADING = "## Work Queue";
const H2_HEADING_REGEX = /^##\s+/;
const UNCHECKED_BULLET_REGEX = /^\s*[-*+]\s+\[\s*\]\s+(.+)$/;
const TP_TASK_LINE_REGEX = /^- \[[ xX]\] \*\*TP(\d{3})\*\*:\s+.+/;
const TP_UNCHECKED_TASK_LINE_REGEX = /^- \[\s*\] \*\*TP(\d{3})\*\*:\s+.+/;
const CHECKBOX_PREFIX_REGEX = /^(\s*[-*+]\s+\[[ xX]\]\s+)/;

// ============================================================================
// Types
// ============================================================================

interface VerificationPack {
  /** Schema version (must be 1) */
  version: number;

  /** Unique identifier for the intake slice (from plan heading) */
  sliceId: string;

  /** SHA-256 hash of the verification pack JSON content */
  packHash: string;

  /** SHA-256 hash of canonical work queue state */
  workQueueFingerprint: string;

  /** Work queue items for the current slice */
  workQueueItems: WorkQueueItem[];

  /** Verification commands from the active slice */
  verificationCommands: string[];

  /** Metadata about the pack */
  metadata: VerificationPackMetadata;

  /** Generation timestamp (ISO 8601 UTC) */
  generatedAt: string;

  /** Command that generated this pack */
  sourceCommand: "taskpad:verification-pack";

  /** Absolute paths to input files */
  inputs: {
    taskpadPath: string;
    planPath: string;
  };
}

interface WorkQueueItem {
  /** The full bullet line */
  text: string;

  /** The planned marker (e.g., "planned-2026-03-02" or "(planned-2026-03-02)") */
  marker?: string;

  /** The marker shape */
  markerShape?: "unparenthesized" | "parenthesized" | null;

  /** The planned date if present */
  plannedDate?: string;

  /** Whether this item has a Verify: clause */
  hasVerifyClause: boolean;

  /** The verification command if present */
  verifyCommand?: string;
}

interface VerificationPackMetadata {
  /** Number of unchecked TP tasks in the slice */
  uncheckedCount: number;

  /** Number of planned Work Queue items */
  plannedCount: number;

  /** Number of verification commands in the slice */
  commandCount: number;

  /** SHA-256 of combined inputs (taskpad + plan content) */
  inputHash: string;
}

interface CliOptions {
  taskpadPath?: string;
  planPath?: string;
  outputPath?: string;
  historyPath?: string;
  historyDedupe?: DedupeMode;
  format: "json" | "human";
}

interface HistoryEmissionResult {
  /** Whether history emission succeeded */
  success: boolean;

  /** The event that was emitted (or would have been) */
  event: VerificationPackHistoryEvent | null;

  /** Whether the event was suppressed as a duplicate */
  suppressed: boolean;

  /** Error message if emission failed */
  error?: string;

  /** Rule ID if emission failed */
  ruleId?: string;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function printHelp(): void {
  console.log(`
TASKPAD Verification Pack Generator

Generates a deterministic Builder handoff pack from TASKPAD and IMPLEMENTATION_PLAN.
Optionally emits a history event for tracking across autonomous intake loops.

USAGE:
  bun run taskpad:verification-pack -- --taskpad <path> --plan <path> [--out <path>] [--history <path>]

OPTIONS:
  --taskpad <path>            Path to TASKPAD markdown file (required)
  --plan <path>               Path to IMPLEMENTATION_PLAN markdown file (required)
  --out <path>                Path to write verification pack JSON (default: stdout)
  --history <path>            Path to history NDJSON file (default: docs/quality/taskpad-verification-pack-history.ndjson)
  --history-dedupe <mode>     Dedupe mode: skip (default), append, noop
  --format <json|human>        Output format (default: json)
  --help, -h                   Show this help message

ENVIRONMENT VARIABLES:
  VPH_HISTORY_PATH             Default history file path override
  VPH_DEDUPE_MODE             Default dedupe mode override

EXIT CODES:
  0  Pack generated successfully
  1  Pack generation failed
  2  Input validation failure

EXAMPLES:
  # Generate pack to stdout
  bun run taskpad:verification-pack -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md

  # Generate pack to file with history tracking
  bun run taskpad:verification-pack -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md \\
    --out docs/quality/taskpad-verification-pack.json \\
    --history docs/quality/taskpad-verification-pack-history.ndjson

  # Generate with JSON format
  bun run taskpad:verification-pack -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md \\
    --format json
`);
}

function parseArgs(argv: string[]): CliOptions {
  let taskpadPath: string | undefined;
  let planPath: string | undefined;
  let outputPath: string | undefined;
  let historyPath: string | undefined;
  let historyDedupe: DedupeMode | undefined;
  let format: "json" | "human" = "json";

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
        throw new Error("Missing value for --taskpad");
      }
      taskpadPath = value;
      continue;
    }

    if (arg === "--plan") {
      i++;
      const value = argv[i];
      if (!value) {
        throw new Error("Missing value for --plan");
      }
      planPath = value;
      continue;
    }

    if (arg === "--out") {
      i++;
      const value = argv[i];
      if (!value) {
        throw new Error("Missing value for --out");
      }
      outputPath = value;
      continue;
    }

    if (arg === "--history") {
      i++;
      const value = argv[i];
      if (!value) {
        throw new Error("Missing value for --history");
      }
      historyPath = value;
      continue;
    }

    if (arg === "--history-dedupe") {
      i++;
      const value = argv[i];
      if (!value || (value !== "skip" && value !== "append" && value !== "noop")) {
        throw new Error("Invalid value for --history-dedupe. Must be 'skip', 'append', or 'noop'.");
      }
      historyDedupe = value as DedupeMode;
      continue;
    }

    if (arg === "--format") {
      i++;
      const value = argv[i];
      if (!value || (value !== "json" && value !== "human")) {
        throw new Error("Invalid value for --format. Must be 'json' or 'human'.");
      }
      format = value as "json" | "human";
      continue;
    }

    console.error(`Unknown argument: ${arg}`);
    printHelp();
    process.exit(2);
  }

  return {
    taskpadPath,
    planPath,
    outputPath,
    historyPath,
    historyDedupe,
    format,
  };
}

// ============================================================================
// Work Queue Parsing
// ============================================================================

function parseWorkQueueItems(taskpadMarkdown: string): WorkQueueItem[] {
  const lines = taskpadMarkdown.split(/\r?\n/);
  const items: WorkQueueItem[] = [];
  let inWorkQueue = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for Work Queue heading
    if (trimmed === WORK_QUEUE_HEADING) {
      inWorkQueue = true;
      continue;
    }

    // Check for any other H2 heading
    if (H2_HEADING_REGEX.test(trimmed)) {
      if (inWorkQueue && trimmed !== WORK_QUEUE_HEADING) {
        inWorkQueue = false;
      }
      continue;
    }

    // Only process items in Work Queue section
    if (!inWorkQueue) {
      continue;
    }

    // Check for any checkbox bullet (checked or unchecked)
    const checkboxMatch = line.match(CHECKBOX_PREFIX_REGEX);
    if (!checkboxMatch) {
      continue;
    }

    const prefix = checkboxMatch[1];
    const restOfLine = line.slice(prefix.length);
    const text = restOfLine.trim();

    // Extract marker info
    const unparenthesizedMatch = restOfLine.match(/^(planned-(\d{4}-\d{2}-\d{2}))/i);
    const parenthesizedMatch = restOfLine.match(/^\((planned-(\d{4}-\d{2}-\d{2}))\)/i);

    let marker: string | undefined;
    let markerShape: "unparenthesized" | "parenthesized" | null = null;
    let plannedDate: string | undefined;

    if (parenthesizedMatch) {
      marker = parenthesizedMatch[0];
      markerShape = "parenthesized";
      plannedDate = parenthesizedMatch[2];
    } else if (unparenthesizedMatch) {
      marker = unparenthesizedMatch[1];
      markerShape = "unparenthesized";
      plannedDate = unparenthesizedMatch[2];
    }

    // Extract Verify: clause
    const verifyClauseMatch = text.match(/Verify:\s*(.+?)(?:\s*$|\n)/i);
    const hasVerifyClause = verifyClauseMatch !== null;
    const verifyCommand = verifyClauseMatch ? verifyClauseMatch[1].trim() : undefined;

    items.push({
      text: line.trimEnd(),
      marker,
      markerShape,
      plannedDate,
      hasVerifyClause,
      verifyCommand,
    });
  }

  return items;
}

// ============================================================================
// Slice ID Extraction
// ============================================================================

function extractSliceId(planMarkdown: string): string {
  const slice = isolateNewestTaskpadIntakeSlice(planMarkdown);
  if (!slice) {
    throw new Error("No active TASKPAD intake slice found in IMPLEMENTATION_PLAN");
  }

  // Extract slice ID from heading (e.g., "## TASKPAD Intake Slice (2026-03-02: Verification-pack history telemetry...)")
  const heading = slice.heading;

  // Try to extract date first (YYYY-MM-DD format)
  const dateMatch = heading.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    const date = dateMatch[1];
    // Try to extract a slug after the date
    const slugMatch = heading.slice(date.index! + date[0].length).match(/^:\s*([^.]+?)(?:\.|$)/);
    const slug = slugMatch ? slugMatch[1].trim().toLowerCase().replace(/\s+/g, "-") : "slice";
    return `${date}-${slug}`;
  }

  // Fallback: hash the heading
  return `slice-${computeHash(heading).slice(0, 12)}`;
}

// ============================================================================
// TP Task Counting
// ============================================================================

function countUncheckedTasks(sliceMarkdown: string): number {
  const lines = sliceMarkdown.split(/\r?\n/);
  let count = 0;

  for (const line of lines) {
    if (TP_UNCHECKED_TASK_LINE_REGEX.test(line.trim())) {
      count++;
    }
  }

  return count;
}

// ============================================================================
// Pack Generation
// ============================================================================

function generateVerificationPack(options: {
  taskpadPath: string;
  planPath: string;
  taskpadMarkdown: string;
  planMarkdown: string;
}): VerificationPack {
  const { taskpadPath, planPath, taskpadMarkdown, planMarkdown } = options;

  // Extract active slice
  const slice = isolateNewestTaskpadIntakeSlice(planMarkdown);
  if (!slice) {
    throw new Error("No active TASKPAD intake slice found in IMPLEMENTATION_PLAN");
  }

  // Extract slice ID
  const sliceId = extractSliceId(planMarkdown);

  // Parse work queue items
  const workQueueItems = parseWorkQueueItems(taskpadMarkdown);

  // Compute work queue fingerprint
  const workQueueBulletTexts = workQueueItems.map((item) => item.text);
  const workQueueFingerprint = computeWorkQueueFingerprint(workQueueBulletTexts);

  // Extract verification commands from slice
  const verificationBlock = validateVerificationCommandsBlock(slice.markdown);
  const verificationCommands = verificationBlock.runnableCommandLines;

  // Count metadata
  const uncheckedCount = countUncheckedTasks(slice.markdown);
  const plannedCount = workQueueItems.filter((item) => item.marker).length;
  const commandCount = verificationCommands.length;

  // Compute input hash
  const inputContent = taskpadMarkdown + planMarkdown;
  const inputHash = computeHash(inputContent);

  // Create metadata
  const metadata: VerificationPackMetadata = {
    uncheckedCount,
    plannedCount,
    commandCount,
    inputHash,
  };

  // Create pack object (without packHash and generatedAt for hash computation)
  const packForHash: Omit<VerificationPack, "packHash" | "generatedAt"> = {
    version: 1,
    sliceId,
    workQueueFingerprint,
    workQueueItems,
    verificationCommands,
    metadata,
    sourceCommand: "taskpad:verification-pack",
    inputs: {
      taskpadPath: resolve(taskpadPath),
      planPath: resolve(planPath),
    },
  };

  // Compute pack hash (hash of the JSON representation without timestamp)
  const packJsonForHash = JSON.stringify(packForHash, null, 2);
  const packHash = computeHash(packJsonForHash);

  // Return complete pack with timestamp added after hash computation
  const pack: VerificationPack = {
    ...packForHash,
    packHash,
    generatedAt: new Date().toISOString(),
  };

  return pack;
}

// ============================================================================
// History Emission
// ============================================================================

function emitHistoryEvent(options: {
  historyPath: string;
  pack: VerificationPack;
  dedupeMode: DedupeMode;
}): HistoryEmissionResult {
  const { historyPath, pack, dedupeMode } = options;

  // Create history event
  const event = createHistoryEvent({
    eventType: "pack-generated",
    sliceId: pack.sliceId,
    workQueueFingerprint: pack.workQueueFingerprint,
    packHash: pack.packHash,
    sourceCommand: "taskpad:verification-pack",
    driftRuleId: null,
    planPath: pack.inputs.planPath,
    taskpadPath: pack.inputs.taskpadPath,
    metadata: {
      uncheckedCount: pack.metadata.uncheckedCount,
      plannedCount: pack.metadata.plannedCount,
      commandCount: pack.metadata.commandCount,
      inputHash: pack.metadata.inputHash,
    },
  });

  // Append to history
  const result = appendToHistory(historyPath, event, dedupeMode);

  return {
    success: result.success,
    event: result.event,
    suppressed: result.suppressed,
    error: result.error,
    ruleId: result.ruleId,
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

function outputHuman(pack: VerificationPack): void {
  console.log("TASKPAD Verification Pack");
  console.log("========================");
  console.log("");
  console.log(`Slice ID: ${pack.sliceId}`);
  console.log(`Pack Hash: ${pack.packHash}`);
  console.log(`Work Queue Fingerprint: ${pack.workQueueFingerprint}`);
  console.log(`Generated At: ${pack.generatedAt}`);
  console.log("");
  console.log("Metadata:");
  console.log(`  Unchecked TP Tasks: ${pack.metadata.uncheckedCount}`);
  console.log(`  Planned Work Queue Items: ${pack.metadata.plannedCount}`);
  console.log(`  Verification Commands: ${pack.metadata.commandCount}`);
  console.log(`  Input Hash: ${pack.metadata.inputHash}`);
  console.log("");
  console.log("Work Queue Items:");
  if (pack.workQueueItems.length === 0) {
    console.log("  (none)");
  } else {
    for (const item of pack.workQueueItems) {
      console.log(`  - ${item.text.substring(0, 80)}${item.text.length > 80 ? "..." : ""}`);
      if (item.hasVerifyClause) {
        console.log(`    Verify: ${item.verifyCommand}`);
      }
    }
  }
  console.log("");
  console.log("Verification Commands:");
  if (pack.verificationCommands.length === 0) {
    console.log("  (none)");
  } else {
    for (const cmd of pack.verificationCommands) {
      console.log(`  - ${cmd}`);
    }
  }
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // Validate required arguments
  if (!args.taskpadPath || !args.planPath) {
    console.error("TASKPAD verification pack: FAIL");
    console.error("- Missing required paths. Provide both --taskpad <path> and --plan <path>.");
    printHelp();
    process.exit(2);
  }

  const resolvedTaskpadPath = resolve(args.taskpadPath);
  const resolvedPlanPath = resolve(args.planPath);

  // Read input files
  let taskpadMarkdown: string;
  let planMarkdown: string;

  try {
    taskpadMarkdown = readFileSync(resolvedTaskpadPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD verification pack: FAIL");
    console.error(`- Failed to read TASKPAD file at ${resolvedTaskpadPath}: ${message}`);
    process.exit(2);
  }

  try {
    planMarkdown = readFileSync(resolvedPlanPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD verification pack: FAIL");
    console.error(`- Failed to read IMPLEMENTATION_PLAN file at ${resolvedPlanPath}: ${message}`);
    process.exit(2);
  }

  // Generate verification pack
  let pack: VerificationPack;
  try {
    pack = generateVerificationPack({
      taskpadPath: resolvedTaskpadPath,
      planPath: resolvedPlanPath,
      taskpadMarkdown,
      planMarkdown,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD verification pack: FAIL");
    console.error(`- Failed to generate verification pack: ${message}`);
    process.exit(1);
  }

  // Write output
  try {
    if (args.outputPath) {
      const resolvedOutputPath = resolve(args.outputPath);
      const outputDir = dirname(resolvedOutputPath);
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(resolvedOutputPath, JSON.stringify(pack, null, 2), "utf8");
      console.log(`TASKPAD verification pack: PASS`);
      console.log(`- Pack written to ${resolvedOutputPath}`);
    } else {
      // Output to stdout
      if (args.format === "json") {
        console.log(JSON.stringify(pack, null, 2));
      } else {
        outputHuman(pack);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD verification pack: FAIL");
    console.error(`- Failed to write output: ${message}`);
    process.exit(1);
  }

  // Emit history event if --history is provided
  if (args.historyPath !== undefined) {
    const resolvedHistoryPath = resolve(args.historyPath);
    const dedupeMode = args.historyDedupe ?? getDefaultDedupeMode();

    const historyResult = emitHistoryEvent({
      historyPath: resolvedHistoryPath,
      pack,
      dedupeMode,
    });

    if (historyResult.success) {
      if (historyResult.suppressed) {
        console.log(`- History: duplicate event suppressed (${RULE_IDS.DUPLICATE_EVENT_SUPPRESSED})`);
      } else {
        console.log(`- History: event appended to ${resolvedHistoryPath}`);
      }
    } else {
      console.error(`- History: FAILED - ${historyResult.error}`);
      if (historyResult.ruleId) {
        console.error(`  Rule ID: ${historyResult.ruleId}`);
      }
    }
  }

  // Exit with success
  process.exit(0);
}

if (import.meta.main) {
  main();
}
