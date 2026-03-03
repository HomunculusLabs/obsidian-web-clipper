#!/usr/bin/env bun

/**
 * TASKPAD Verification Pack Contract Evaluator
 *
 * Evaluates a verification pack against current TASKPAD and IMPLEMENTATION_PLAN state.
 * Emits history events linking contract verdicts to pack hash/fingerprint.
 *
 * Contract: docs/quality/taskpad-verification-pack-history.md
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

import { readFileSync as readJsonFileSync } from "node:fs";

// ============================================================================
// Constants
// ============================================================================

const WORK_QUEUE_HEADING = "## Work Queue";
const H2_HEADING_REGEX = /^##\s+/;
const CHECKBOX_PREFIX_REGEX = /^(\s*[-*+]\s+\[[ xX]\]\s+)/;

// ============================================================================
// Types
// ============================================================================

/** Reusing the VerificationPack interface from taskpad-verification-pack.ts */
interface VerificationPack {
  version: number;
  sliceId: string;
  packHash: string;
  workQueueFingerprint: string;
  workQueueItems: WorkQueueItem[];
  verificationCommands: string[];
  metadata: VerificationPackMetadata;
  generatedAt: string;
  sourceCommand: "taskpad:verification-pack";
  inputs: {
    taskpadPath: string;
    planPath: string;
  };
}

interface WorkQueueItem {
  text: string;
  marker?: string;
  markerShape?: "unparenthesized" | "parenthesized" | null;
  plannedDate?: string;
  hasVerifyClause: boolean;
  verifyCommand?: string;
}

interface VerificationPackMetadata {
  uncheckedCount: number;
  plannedCount: number;
  commandCount: number;
  inputHash: string;
}

interface ContractEvaluationResult {
  /** Whether the contract evaluation passed */
  passed: boolean;

  /** Rule ID if evaluation failed, null if passed */
  driftRuleId: typeof RULE_IDS[keyof typeof RULE_IDS] | null;

  /** Slice ID from the pack */
  packSliceId: string;

  /** Slice ID from current plan */
  currentSliceId: string;

  /** Work queue fingerprint from the pack */
  packFingerprint: string;

  /** Work queue fingerprint from current state */
  currentFingerprint: string;

  /** Pack hash from the pack file */
  packHash: string;

  /** Recomputed pack hash */
  recomputedPackHash: string | null;

  /** Diagnostics explaining the result */
  diagnostics: string[];
}

interface CliOptions {
  taskpadPath?: string;
  planPath?: string;
  packPath?: string;
  packagePath?: string;
  historyPath?: string;
  historyDedupe?: DedupeMode;
  format: "json" | "human";
}

interface HistoryEmissionResult {
  success: boolean;
  event: VerificationPackHistoryEvent | null;
  suppressed: boolean;
  error?: string;
  ruleId?: string;
}

interface ContractOutput {
  /** Status of the contract evaluation */
  status: "pass" | "fail";

  /** Pack hash being evaluated */
  packHash: string;

  /** Work queue fingerprint */
  workQueueFingerprint: string;

  /** Slice ID */
  sliceId: string;

  /** Drift rule ID if failed */
  driftRuleId: string | null;

  /** Diagnostic messages */
  diagnostics: string[];

  /** Timestamp of evaluation */
  evaluatedAt: string;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function printHelp(): void {
  console.log(`
TASKPAD Verification Pack Contract Evaluator

Evaluates a verification pack against current TASKPAD and IMPLEMENTATION_PLAN state.
Optionally emits a history event for tracking across autonomous intake loops.

USAGE:
  bun run taskpad:verification-pack-contract -- --taskpad <path> --plan <path> --pack <path> [--history <path>]

OPTIONS:
  --taskpad <path>            Path to TASKPAD markdown file (required)
  --plan <path>               Path to IMPLEMENTATION_PLAN markdown file (required)
  --pack <path>               Path to verification pack JSON file (required)
  --package <path>            Path to package.json for command validation (optional)
  --history <path>            Path to history NDJSON file (default: docs/quality/taskpad-verification-pack-history.ndjson)
  --history-dedupe <mode>     Dedupe mode: skip (default), append, noop
  --format <json|human>        Output format (default: json)
  --help, -h                   Show this help message

ENVIRONMENT VARIABLES:
  VPH_HISTORY_PATH             Default history file path override
  VPH_DEDUPE_MODE             Default dedupe mode override

EXIT CODES:
  0  Contract passed
  1  Contract failed
  2  Input validation failure

EXAMPLES:
  # Evaluate pack with history tracking
  bun run taskpad:verification-pack-contract -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md \\
    --pack docs/quality/taskpad-verification-pack.json \\
    --history docs/quality/taskpad-verification-pack-history.ndjson

  # Evaluate with package.json validation
  bun run taskpad:verification-pack-contract -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md \\
    --pack docs/quality/taskpad-verification-pack.json \\
    --package package.json \\
    --format json
`);
}

function parseArgs(argv: string[]): CliOptions {
  let taskpadPath: string | undefined;
  let planPath: string | undefined;
  let packPath: string | undefined;
  let packagePath: string | undefined;
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

    if (arg === "--pack") {
      i++;
      const value = argv[i];
      if (!value) {
        throw new Error("Missing value for --pack");
      }
      packPath = value;
      continue;
    }

    if (arg === "--package") {
      i++;
      const value = argv[i];
      if (!value) {
        throw new Error("Missing value for --package");
      }
      packagePath = value;
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
    packPath,
    packagePath,
    historyPath,
    historyDedupe,
    format,
  };
}

// ============================================================================
// Verification Pack Loading
// ============================================================================

function loadVerificationPack(packPath: string): VerificationPack {
  try {
    const content = readFileSync(packPath, "utf8");
    const pack = JSON.parse(content) as VerificationPack;

    // Validate required fields
    if (pack.version !== 1) {
      throw new Error("Invalid pack version: must be 1");
    }
    if (!pack.sliceId) {
      throw new Error("Missing required field: sliceId");
    }
    if (!pack.packHash) {
      throw new Error("Missing required field: packHash");
    }
    if (!pack.workQueueFingerprint) {
      throw new Error("Missing required field: workQueueFingerprint");
    }
    if (!Array.isArray(pack.workQueueItems)) {
      throw new Error("Missing or invalid field: workQueueItems");
    }
    if (!Array.isArray(pack.verificationCommands)) {
      throw new Error("Missing or invalid field: verificationCommands");
    }

    return pack;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load verification pack: ${message}`);
  }
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

  // Extract slice ID from heading
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
// Contract Evaluation
// ============================================================================

function evaluateContract(options: {
  pack: VerificationPack;
  taskpadMarkdown: string;
  planMarkdown: string;
}): ContractEvaluationResult {
  const { pack, taskpadMarkdown, planMarkdown } = options;

  const diagnostics: string[] = [];
  let driftRuleId: typeof RULE_IDS[keyof typeof RULE_IDS] | null = null;

  // Extract current slice ID
  const currentSliceId = extractSliceId(planMarkdown);

  // Check slice ID match
  if (pack.sliceId !== currentSliceId) {
    diagnostics.push(
      `Slice ID mismatch: pack has "${pack.sliceId}", current is "${currentSliceId}"`,
    );
    driftRuleId = RULE_IDS.SLICE_ID_MISMATCH;
  }

  // Parse current work queue
  const currentWorkQueueItems = parseWorkQueueItems(taskpadMarkdown);
  const currentBulletTexts = currentWorkQueueItems.map((item) => item.text);
  const currentFingerprint = computeWorkQueueFingerprint(currentBulletTexts);

  // Check work queue fingerprint match
  if (pack.workQueueFingerprint !== currentFingerprint) {
    diagnostics.push(
      `Work queue fingerprint mismatch: pack has "${pack.workQueueFingerprint}", current is "${currentFingerprint}"`,
    );
    driftRuleId = RULE_IDS.FINGERPRINT_MISMATCH;
  }

  // Recompute pack hash (optional - strict mode)
  const packJsonForHash = JSON.stringify(
    {
      version: pack.version,
      sliceId: pack.sliceId,
      workQueueFingerprint: pack.workQueueFingerprint,
      workQueueItems: pack.workQueueItems,
      verificationCommands: pack.verificationCommands,
      metadata: pack.metadata,
      sourceCommand: pack.sourceCommand,
      inputs: pack.inputs,
    },
    null,
    2,
  );
  const recomputedPackHash = computeHash(packJsonForHash);

  // Check pack hash match (warn if different but don't fail - this can happen with timestamp differences)
  if (pack.packHash !== recomputedPackHash) {
    diagnostics.push(
      `Pack content hash differs from recomputed: pack has "${pack.packHash}", recomputed is "${recomputedPackHash}"`,
    );
    // Only treat this as a failure if there's no other drift
    if (driftRuleId === null) {
      driftRuleId = RULE_IDS.PACK_HASH_MISMATCH;
    }
  }

  const passed = driftRuleId === null;

  if (passed) {
    diagnostics.push("Contract evaluation passed: all checks matched");
  }

  return {
    passed,
    driftRuleId,
    packSliceId: pack.sliceId,
    currentSliceId,
    packFingerprint: pack.workQueueFingerprint,
    currentFingerprint,
    packHash: pack.packHash,
    recomputedPackHash,
    diagnostics,
  };
}

// ============================================================================
// History Emission
// ============================================================================

function emitHistoryEvent(options: {
  historyPath: string;
  pack: VerificationPack;
  evaluationResult: ContractEvaluationResult;
  durationMs: number;
  dedupeMode: DedupeMode;
}): HistoryEmissionResult {
  const { historyPath, pack, evaluationResult, durationMs, dedupeMode } = options;

  // Create history event
  const event = createHistoryEvent({
    eventType: "contract-evaluated",
    sliceId: pack.sliceId,
    workQueueFingerprint: pack.workQueueFingerprint,
    packHash: pack.packHash,
    sourceCommand: "taskpad:verification-pack-contract",
    driftRuleId: evaluationResult.driftRuleId,
    planPath: pack.inputs.planPath,
    taskpadPath: pack.inputs.taskpadPath,
    durationMs,
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

function outputHuman(output: ContractOutput): void {
  console.log("TASKPAD Verification Pack Contract Evaluation");
  console.log("=============================================");
  console.log("");
  console.log(`Status: ${output.status.toUpperCase()}`);
  console.log(`Pack Hash: ${output.packHash}`);
  console.log(`Work Queue Fingerprint: ${output.workQueueFingerprint}`);
  console.log(`Slice ID: ${output.sliceId}`);
  console.log(`Evaluated At: ${output.evaluatedAt}`);
  console.log("");

  if (output.driftRuleId) {
    console.log(`Drift Rule ID: ${output.driftRuleId}`);
  }

  console.log("");
  console.log("Diagnostics:");
  for (const diag of output.diagnostics) {
    console.log(`  - ${diag}`);
  }
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // Validate required arguments
  if (!args.taskpadPath || !args.planPath || !args.packPath) {
    console.error("TASKPAD verification pack contract: FAIL");
    console.error("- Missing required paths. Provide --taskpad, --plan, and --pack.");
    printHelp();
    process.exit(2);
  }

  const resolvedTaskpadPath = resolve(args.taskpadPath);
  const resolvedPlanPath = resolve(args.planPath);
  const resolvedPackPath = resolve(args.packPath);
  const resolvedPackagePath = args.packagePath ? resolve(args.packagePath) : undefined;

  // Start timing
  const startTime = Date.now();

  // Read input files
  let pack: VerificationPack;
  let taskpadMarkdown: string;
  let planMarkdown: string;

  try {
    pack = loadVerificationPack(resolvedPackPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD verification pack contract: FAIL");
    console.error(`- Failed to load pack at ${resolvedPackPath}: ${message}`);
    process.exit(2);
  }

  try {
    taskpadMarkdown = readFileSync(resolvedTaskpadPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD verification pack contract: FAIL");
    console.error(`- Failed to read TASKPAD file at ${resolvedTaskpadPath}: ${message}`);
    process.exit(2);
  }

  try {
    planMarkdown = readFileSync(resolvedPlanPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD verification pack contract: FAIL");
    console.error(`- Failed to read IMPLEMENTATION_PLAN file at ${resolvedPlanPath}: ${message}`);
    process.exit(2);
  }

  // Evaluate contract
  let evaluationResult: ContractEvaluationResult;
  try {
    evaluationResult = evaluateContract({
      pack,
      taskpadMarkdown,
      planMarkdown,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD verification pack contract: FAIL");
    console.error(`- Contract evaluation failed: ${message}`);
    process.exit(1);
  }

  // Calculate duration
  const durationMs = Date.now() - startTime;

  // Create output
  const output: ContractOutput = {
    status: evaluationResult.passed ? "pass" : "fail",
    packHash: pack.packHash,
    workQueueFingerprint: pack.workQueueFingerprint,
    sliceId: pack.sliceId,
    driftRuleId: evaluationResult.driftRuleId,
    diagnostics: evaluationResult.diagnostics,
    evaluatedAt: new Date().toISOString(),
  };

  // Write output
  if (args.format === "json") {
    console.log(JSON.stringify(output, null, 2));
  } else {
    outputHuman(output);
  }

  // Emit history event if --history is provided
  if (args.historyPath !== undefined) {
    const resolvedHistoryPath = resolve(args.historyPath);
    const dedupeMode = args.historyDedupe ?? getDefaultDedupeMode();

    const historyResult = emitHistoryEvent({
      historyPath: resolvedHistoryPath,
      pack,
      evaluationResult,
      durationMs,
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

  // Exit with appropriate code
  process.exit(evaluationResult.passed ? 0 : 1);
}

if (import.meta.main) {
  main();
}
