#!/usr/bin/env bun

/**
 * TASKPAD Verification Pack Execution Gate
 *
 * Evaluates verification-pack command sets against current repo state before Builder handoff.
 * Provides runtime-proof that commands in the newest verification pack can execute successfully.
 *
 * Contract: docs/quality/taskpad-verification-pack-execution-gate.md
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  isolateNewestTaskpadIntakeSlice,
  validateVerificationCommandsBlock,
} from "./implementation-plan-integrity";

import {
  computeHash,
  computeWorkQueueFingerprint,
  readHistoryFile,
} from "./lib/taskpad-verification-pack-history";

// ============================================================================
// Rule IDs (from contract docs/quality/taskpad-verification-pack-execution-gate.md)
// ============================================================================

export const RULE_IDS = {
  // Resolution failures
  COMMAND_NOT_RESOLVED: "EG001_COMMAND_NOT_RESOLVED",
  SCRIPT_NOT_FOUND: "EG002_SCRIPT_NOT_FOUND",
  TOOL_NOT_FOUND: "EG003_TOOL_NOT_FOUND",
  TEST_FILE_NOT_FOUND: "EG004_TEST_FILE_NOT_FOUND",
  COMMAND_CLASS_DISALLOWED: "EG005_COMMAND_CLASS_DISALLOWED",

  // Execution failures
  COMMAND_TIMEOUT: "EG101_COMMAND_TIMEOUT",
  NON_ZERO_EXIT: "EG102_NON_ZERO_EXIT",
  EXECUTION_ERROR: "EG103_EXECUTION_ERROR",
  OUTPUT_TRUNCATED: "EG104_OUTPUT_TRUNCATED",

  // Stale pack failures
  STALE_PACK_HASH: "EG201_STALE_PACK_HASH",
  STALE_SLICE_ID: "EG202_STALE_SLICE_ID",
  STALE_FINGERPRINT: "EG203_STALE_FINGERPRINT",
} as const;

export type RuleId = (typeof RULE_IDS)[keyof typeof RULE_IDS];

/**
 * Canonical order for rule IDs in diagnostics output.
 * Ensures deterministic, stable ordering across runs.
 */
export const CANONICAL_RULE_ORDER: RuleId[] = [
  RULE_IDS.COMMAND_NOT_RESOLVED,
  RULE_IDS.SCRIPT_NOT_FOUND,
  RULE_IDS.TOOL_NOT_FOUND,
  RULE_IDS.TEST_FILE_NOT_FOUND,
  RULE_IDS.COMMAND_CLASS_DISALLOWED,
  RULE_IDS.COMMAND_TIMEOUT,
  RULE_IDS.NON_ZERO_EXIT,
  RULE_IDS.EXECUTION_ERROR,
  RULE_IDS.OUTPUT_TRUNCATED,
  RULE_IDS.STALE_PACK_HASH,
  RULE_IDS.STALE_SLICE_ID,
  RULE_IDS.STALE_FINGERPRINT,
];

// ============================================================================
// Constants
// ============================================================================

const WORK_QUEUE_HEADING = "## Work Queue";
const H2_HEADING_REGEX = /^##\s+/;
const CHECKBOX_PREFIX_REGEX = /^(\s*[-*+]\s+\[[ xX]\]\s+)/;
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB

// ============================================================================
// Types
// ============================================================================

/**
 * Verification pack interface (reusing from taskpad-verification-pack.ts)
 */
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

/**
 * Package.json scripts interface
 */
interface PackageScripts {
  [key: string]: string;
}

/**
 * Resolved command type
 */
export type CommandType =
  | "package-script"
  | "test-runner"
  | "tool-entry"
  | "verification-command"
  | "unknown";

/**
 * Command resolution result (TP002 - execution target resolution only)
 */
export interface CommandResolution {
  /** The command string from the verification pack */
  command: string;

  /** Resolved command type */
  commandType: CommandType;

  /** Whether the command resolved successfully */
  resolved: boolean;

  /** Rule ID indicating failure reason (null on success) */
  ruleId: RuleId | null;

  /** Human-readable explanation */
  message: string;

  /** Resolved package.json script key (if applicable) */
  scriptKey?: string;

  /** Resolved tool file path (if applicable) */
  toolPath?: string;

  /** Resolved test file pattern (if applicable) */
  testPattern?: string;
}

/**
 * Command execution result (TP003 - actual execution)
 * Placeholder for now - will be implemented in TP003
 */
export interface CommandExecutionResult {
  /** The command string from the verification pack */
  command: string;

  /** Resolved command type */
  commandType: CommandType;

  /** Whether the command resolved successfully */
  resolved: boolean;

  /** Whether the command executed successfully */
  passed: boolean;

  /** Exit code from command execution (or null if not executed) */
  exitCode: number | null;

  /** Execution duration in milliseconds (or null if not executed) */
  durationMs: number | null;

  /** Rule ID indicating failure reason (null on success) */
  ruleId: RuleId | null;

  /** Human-readable explanation */
  message: string;

  /** Captured stdout (truncated) */
  stdout?: string;

  /** Captured stderr (truncated) */
  stderr?: string;
}

/**
 * History event linkage for verification-pack lineage (TP004)
 */
interface HistoryLinkage {
  /** Event type from history */
  eventType: "pack-generated" | "contract-evaluated" | "execution-gate-evaluated";
  /** Timestamp when pack was generated (from history) */
  generatedAt: string;
  /** Source command that generated the pack */
  sourceCommand: string;
}

/**
 * Stale-pack validation result
 */
interface StalePackValidation {
  /** Whether the pack is considered stale */
  isStale: boolean;

  /** Rule ID indicating which staleness check failed (null if fresh) */
  ruleId: RuleId | null;

  /** Human-readable explanation */
  message: string;

  /** Timestamp of pack generation (from history) */
  packGeneratedAt?: string;

  /** Age of pack in hours (if found in history) */
  packAgeHours?: number;

  /** History linkage for verification-pack lineage (TP004) */
  historyLinkage?: HistoryLinkage | null;
}

/**
 * Lineage information linking to verification-pack history (TP004)
 */
interface Lineage {
  /** Slice ID matching pack history */
  sliceId: string;

  /** Work queue fingerprint matching pack history */
  workQueueFingerprint: string;

  /** Pack hash matching the evaluated pack */
  packHash: string;

  /** Timestamp of pack generation (from pack file) */
  packGeneratedAt: string;

  /** Whether pack passed stale-pack validation */
  isStale: boolean;

  /** History event linkage - links to verification-pack-history.ndjson entry (TP004) */
  historyLinkage?: {
    /** Event type from history */
    eventType: "pack-generated" | "contract-evaluated" | "execution-gate-evaluated";
    /** Timestamp when pack was generated (from history) */
    generatedAt: string;
    /** Source command that generated the pack */
    sourceCommand: string;
  } | null;
}

/**
 * History event linkage for verification-pack lineage (TP004)
 */
export interface HistoryLinkage {
  /** Event type from history */
  eventType: "pack-generated" | "contract-evaluated" | "execution-gate-evaluated";
  /** Timestamp when pack was generated (from history) */
  generatedAt: string;
  /** Source command that generated the pack */
  sourceCommand: string;
}

/**
 * Lineage information linking to verification-pack history (TP004)
 */
export interface Lineage {
  /** Slice ID matching pack history */
  sliceId: string;

  /** Work queue fingerprint matching pack history */
  workQueueFingerprint: string;

  /** Pack hash matching the evaluated pack */
  packHash: string;

  /** Timestamp of pack generation (from pack file) */
  packGeneratedAt: string;

  /** Whether pack passed stale-pack validation */
  isStale: boolean;

  /** History event linkage - links to verification-pack-history.ndjson entry (TP004) */
  historyLinkage: HistoryLinkage | null;
}

/**
 * Execution gate result
 */
export interface ExecutionGateResult {
  /** Schema version (must be 1) */
  version: number;

  /** Overall verdict: "pass" or "fail" */
  status: "pass" | "fail";

  /** Verification pack hash being evaluated */
  packHash: string;

  /** Work queue fingerprint from the pack */
  workQueueFingerprint: string;

  /** Slice ID from the pack */
  sliceId: string;

  /** Number of commands evaluated */
  commandCount: number;

  /** Number of commands that passed */
  passedCount: number;

  /** Number of commands that failed */
  failedCount: number;

  /** Per-command execution results (deterministic ordering) */
  commandResults: CommandExecutionResult[];

  /** Linkage to verification-pack history lineage (TP004) */
  lineage: Lineage;

  /** Diagnostics explaining the result (deterministically sorted per TP004) */
  diagnostics: string[];

  /** ISO 8601 timestamp of gate evaluation */
  evaluatedAt: string;
}

/**
 * CLI options
 */
interface CliOptions {
  taskpadPath?: string;
  planPath?: string;
  packPath?: string;
  packagePath?: string;
  format: "json" | "human";
  timeoutSeconds: number;
  historyPath?: string;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function printHelp(): void {
  console.log(`
TASKPAD Verification Pack Execution Gate

Evaluates verification-pack command sets against current repo state before Builder handoff.
Provides runtime-proof that commands in the newest verification pack can execute successfully.

USAGE:
  bun run taskpad:verification-pack-execution-gate -- \\
    --taskpad <path> \\
    --plan <path> \\
    --pack <path> \\
    --package <path>

OPTIONS:
  --taskpad <path>            Path to TASKPAD.md markdown file (required)
  --plan <path>               Path to IMPLEMENTATION_PLAN.md markdown file (required)
  --pack <path>               Path to verification pack JSON file (required)
  --package <path>            Path to package.json for command resolution (required)
  --format <json|human>        Output format (default: json)
  --timeout <seconds>          Per-command timeout in seconds (default: 30)
  --history <path>            Path to history NDJSON file for stale-pack validation
  --help, -h                   Show this help message

EXIT CODES:
  0  Execution gate passed (all commands executed successfully)
  1  Execution gate failed (at least one command failed or pack is stale)
  2  Input validation error (missing or invalid inputs)

EXAMPLES:
  # Run execution gate with JSON format
  bun run taskpad:verification-pack-execution-gate -- \\
    --taskpad TASKPAD.md \\
    --plan IMPLEMENTATION_PLAN.md \\
    --pack docs/quality/taskpad-verification-pack.json \\
    --package package.json \\
    --format json

  # Run with custom timeout
  bun run taskpad:verification-pack-execution-gate -- \\
    --taskpad TASKPAD.md \\
    --plan IMPLEMENTATION_PLAN.md \\
    --pack docs/quality/taskpad-verification-pack.json \\
    --package package.json \\
    --timeout 60
`);
}

function parseArgs(argv: string[]): CliOptions {
  let taskpadPath: string | undefined;
  let planPath: string | undefined;
  let packPath: string | undefined;
  let packagePath: string | undefined;
  let format: "json" | "human" = "json";
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;
  let historyPath: string | undefined;

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

    if (arg === "--format") {
      i++;
      const value = argv[i];
      if (!value || (value !== "json" && value !== "human")) {
        throw new Error("Invalid value for --format. Must be 'json' or 'human'.");
      }
      format = value as "json" | "human";
      continue;
    }

    if (arg === "--timeout") {
      i++;
      const value = argv[i];
      if (!value) {
        throw new Error("Missing value for --timeout");
      }
      const timeout = parseInt(value, 10);
      if (isNaN(timeout) || timeout <= 0) {
        throw new Error("Invalid value for --timeout. Must be a positive integer.");
      }
      timeoutSeconds = timeout;
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

    console.error(`Unknown argument: ${arg}`);
    printHelp();
    process.exit(2);
  }

  return {
    taskpadPath,
    planPath,
    packPath,
    packagePath,
    format,
    timeoutSeconds,
    historyPath,
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
    if (!Array.isArray(pack.verificationCommands)) {
      throw new Error("Missing or invalid field: verificationCommands");
    }

    return pack;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load verification pack: ${message}`);
  }
}

function loadPackageScripts(packagePath: string): PackageScripts {
  try {
    const content = readFileSync(packagePath, "utf8");
    const pkg = JSON.parse(content) as { scripts?: Record<string, string> };
    return pkg.scripts || {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load package.json: ${message}`);
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
// Subprocess Execution with Timeout
// ============================================================================

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Execute a resolved command with bounded timeout and output capture.
 * Implements guarded invocation per execution gate contract.
 *
 * @param resolution - The command resolution from TP002
 * @param cwd - Working directory for execution
 * @param timeoutMs - Timeout in milliseconds
 * @param maxOutputBytes - Maximum output bytes to capture
 * @returns Command execution result with deterministic reason-code mapping
 */
async function executeCommand(
  resolution: CommandResolution,
  cwd: string,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<CommandExecutionResult> {
  // If resolution failed, return early with resolution failure
  if (!resolution.resolved) {
    return {
      command: resolution.command,
      commandType: resolution.commandType,
      resolved: false,
      passed: false,
      exitCode: null,
      durationMs: null,
      ruleId: resolution.ruleId,
      message: resolution.message,
    };
  }

  const startTime = Date.now();
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    // Build executable args based on command type
    const { executable, args } = buildExecutableArgs(resolution);

    // Validate executable exists for tool-entry commands
    if (resolution.commandType === "tool-entry" && resolution.toolPath) {
      if (!existsSync(resolution.toolPath)) {
        clearTimeout(timeoutId);
        return {
          command: resolution.command,
          commandType: resolution.commandType,
          resolved: true,
          passed: false,
          exitCode: null,
          durationMs: Date.now() - startTime,
          ruleId: RULE_IDS.TOOL_NOT_FOUND,
          message: `Tool file not found: ${resolution.toolPath}`,
        };
      }
    }

    // Execute the command
    const result = await runSubprocess(executable, args, cwd, abortController.signal, maxOutputBytes);
    clearTimeout(timeoutId);

    const durationMs = Date.now() - startTime;

    // Check for timeout (abort signal triggered)
    if (result.timedOut) {
      return {
        command: resolution.command,
        commandType: resolution.commandType,
        resolved: true,
        passed: false,
        exitCode: null,
        durationMs,
        ruleId: RULE_IDS.COMMAND_TIMEOUT,
        message: `Command execution exceeded timeout of ${timeoutMs}ms`,
        stdout: truncateOutput(result.stdout, maxOutputBytes),
        stderr: truncateOutput(result.stderr, maxOutputBytes),
      };
    }

    // Check for spawn/execution error
    if (result.error) {
      return {
        command: resolution.command,
        commandType: resolution.commandType,
        resolved: true,
        passed: false,
        exitCode: null,
        durationMs,
        ruleId: RULE_IDS.EXECUTION_ERROR,
        message: `Command failed to execute: ${result.error}`,
        stdout: truncateOutput(result.stdout, maxOutputBytes),
        stderr: truncateOutput(result.stderr, maxOutputBytes),
      };
    }

    // Check for non-zero exit
    if (result.exitCode !== 0) {
      return {
        command: resolution.command,
        commandType: resolution.commandType,
        resolved: true,
        passed: false,
        exitCode: result.exitCode,
        durationMs,
        ruleId: RULE_IDS.NON_ZERO_EXIT,
        message: `Command exited with non-zero status code ${result.exitCode}`,
        stdout: truncateOutput(result.stdout, maxOutputBytes),
        stderr: truncateOutput(result.stderr, maxOutputBytes),
      };
    }

    // Success case
    return {
      command: resolution.command,
      commandType: resolution.commandType,
      resolved: true,
      passed: true,
      exitCode: 0,
      durationMs,
      ruleId: null,
      message: "Command executed successfully",
      stdout: truncateOutput(result.stdout, maxOutputBytes),
      stderr: truncateOutput(result.stderr, maxOutputBytes),
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;

    // Handle abort/timeout
    if (error instanceof Error && error.name === "AbortError") {
      return {
        command: resolution.command,
        commandType: resolution.commandType,
        resolved: true,
        passed: false,
        exitCode: null,
        durationMs,
        ruleId: RULE_IDS.COMMAND_TIMEOUT,
        message: `Command execution exceeded timeout of ${timeoutMs}ms`,
      };
    }

    // Generic execution error
    return {
      command: resolution.command,
      commandType: resolution.commandType,
      resolved: true,
      passed: false,
      exitCode: null,
      durationMs,
      ruleId: RULE_IDS.EXECUTION_ERROR,
      message: `Command execution error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Build executable and args from resolution.
 */
function buildExecutableArgs(resolution: CommandResolution): { executable: string; args: string[] } {
  switch (resolution.commandType) {
    case "package-script":
    case "verification-command": {
      // bun run <script>
      return { executable: "bun", args: ["run", resolution.scriptKey!] };
    }
    case "test-runner": {
      // bun test <pattern>
      return { executable: "bun", args: ["test", resolution.testPattern!] };
    }
    case "tool-entry": {
      // bun run <tool-path>
      return { executable: "bun", args: ["run", resolution.toolPath!] };
    }
    default: {
      // Fallback: parse as shell command (should not reach here for resolved commands)
      const parts = resolution.command.split(/\s+/);
      return { executable: parts[0]!, args: parts.slice(1) };
    }
  }
}

/**
 * Run a subprocess with signal-based timeout and output capture.
 */
interface SubprocessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

function runSubprocess(
  executable: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  maxOutputBytes: number,
): Promise<SubprocessResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let totalBytes = 0;
    const outputLimit = maxOutputBytes * 2; // Combined limit

    try {
      const child = spawn(executable, args, {
        cwd,
        signal,
        env: {
          // Sanitized environment per contract G005
          PATH: process.env.PATH || "",
          HOME: process.env.HOME || "",
          NODE_ENV: process.env.NODE_ENV || "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString("utf-8");
        totalBytes += chunk.length;
        if (totalBytes <= outputLimit) {
          stdout += chunk;
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString("utf-8");
        totalBytes += chunk.length;
        if (totalBytes <= outputLimit) {
          stderr += chunk;
        }
      });

      child.on("error", (err: Error) => {
        if (err.name === "AbortError") {
          timedOut = true;
          resolve({ exitCode: null, stdout, stderr, timedOut: true });
        } else {
          resolve({ exitCode: null, stdout, stderr, timedOut: false, error: err.message });
        }
      });

      child.on("close", (code: number | null) => {
        resolve({ exitCode: code, stdout, stderr, timedOut: false });
      });
    } catch (err) {
      resolve({
        exitCode: null,
        stdout,
        stderr,
        timedOut: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/**
 * Truncate output to max bytes with indicator.
 */
function truncateOutput(output: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(output);

  if (bytes.length <= maxBytes) {
    return output;
  }

  // Truncate and add indicator
  const truncated = output.slice(0, Math.floor(maxBytes * 0.9));
  return `${truncated}\n... [output truncated: ${bytes.length} bytes total, showing ${Math.floor(maxBytes * 0.9)} bytes]`;
}

/**
 * Execute all resolved commands with bounded invocation.
 * Returns deterministic execution results in pack order.
 */
async function executeAllCommands(
  resolutions: CommandResolution[],
  cwd: string,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<CommandExecutionResult[]> {
  const results: CommandExecutionResult[] = [];

  // Execute commands sequentially for deterministic ordering
  for (const resolution of resolutions) {
    const result = await executeCommand(resolution, cwd, timeoutMs, maxOutputBytes);
    results.push(result);
  }

  return results;
}

// ============================================================================
// Command Resolution (TP002 - Execution Target Resolution)
// ============================================================================

/**
 * Determine if a string looks like a tool path
 */
function isToolPath(command: string): boolean {
  return command.startsWith("tools/") && command.endsWith(".ts");
}

/**
 * Determine if a command is a verification command
 */
function isVerificationCommand(command: string): boolean {
  // Check for known verification command patterns
  const knownVerificationCommands = [
    "taskpad:verification-pack",
    "taskpad:verification-pack-contract",
    "taskpad:verification-pack-execution-gate",
  ];

  // Check direct match (after bun run prefix if present)
  const cleanCommand = command.replace(/^bun run\s+/, "");
  return knownVerificationCommands.includes(cleanCommand);
}

/**
 * Parse a bun run pattern to extract script name
 */
function parseBunRunPattern(command: string): string | null {
  // Match: bun run <script>
  const match = command.match(/^bun run\s+(\S+)/);
  return match ? match[1] : null;
}

/**
 * Parse a bun test pattern to extract test file pattern
 */
function parseBunTestPattern(command: string): string | null {
  // Match: bun test <pattern>
  const match = command.match(/^bun test\s+(.+)/);
  return match ? match[1].trim() : null;
}

/**
 * Resolve a command to its execution target.
 * This is the TP002 scaffold - resolves target without executing.
 */
export function resolveCommandTarget(
  command: string,
  packageScripts: PackageScripts,
): CommandResolution {
  // Check for bun run <script> pattern first (highest priority)
  const scriptName = parseBunRunPattern(command);
  if (scriptName) {
    // Check if it's a tool path (tools/<tool>.ts) - resolve as tool-entry
    if (isToolPath(scriptName)) {
      return {
        command,
        commandType: "tool-entry",
        resolved: true,
        ruleId: null,
        message: "Resolved to tool entry point via bun run",
        toolPath: scriptName,
      };
    }

    // Check if it's a verification command
    if (isVerificationCommand(scriptName)) {
      if (packageScripts[scriptName]) {
        return {
          command,
          commandType: "verification-command",
          resolved: true,
          ruleId: null,
          message: "Resolved to verification command",
          scriptKey: scriptName,
        };
      }

      return {
        command,
        commandType: "verification-command",
        resolved: false,
        ruleId: RULE_IDS.SCRIPT_NOT_FOUND,
        message: `Verification command '${scriptName}' not found in package.json`,
        scriptKey: scriptName,
      };
    }

    // Regular package script
    if (packageScripts[scriptName]) {
      return {
        command,
        commandType: "package-script",
        resolved: true,
        ruleId: null,
        message: "Resolved to package.json script via bun run",
        scriptKey: scriptName,
      };
    }

    // Pattern recognized but script doesn't exist
    return {
      command,
      commandType: "package-script",
      resolved: false,
      ruleId: RULE_IDS.SCRIPT_NOT_FOUND,
      message: `Script '${scriptName}' not found in package.json`,
      scriptKey: scriptName,
    };
  }

  // Check for direct package.json script reference
  if (packageScripts[command]) {
    return {
      command,
      commandType: "package-script",
      resolved: true,
      ruleId: null,
      message: "Resolved to package.json script",
      scriptKey: command,
    };
  }

  // Check for bun test <pattern> pattern
  const testPattern = parseBunTestPattern(command);
  if (testPattern) {
    return {
      command,
      commandType: "test-runner",
      resolved: true,
      ruleId: null,
      message: "Resolved to test runner pattern",
      testPattern,
    };
  }

  // Check for tool entry point
  if (isToolPath(command)) {
    return {
      command,
      commandType: "tool-entry",
      resolved: true,
      ruleId: null,
      message: "Resolved to tool entry point",
      toolPath: command,
    };
  }

  // Unknown command
  return {
    command,
    commandType: "unknown",
    resolved: false,
    ruleId: RULE_IDS.COMMAND_NOT_RESOLVED,
    message: "Command could not be resolved to any known command class",
  };
}

/**
 * Resolve all commands from the verification pack.
 * Returns deterministic resolution results in pack order.
 */
function resolveAllCommandTargets(
  commands: string[],
  packageScripts: PackageScripts,
): CommandResolution[] {
  return commands.map((command) => resolveCommandTarget(command, packageScripts));
}

// ============================================================================
// Stale-Pack Validation
// ============================================================================

/**
 * Validate that the pack is not stale by checking against history.
 */
function validatePackNotStale(
  pack: VerificationPack,
  taskpadMarkdown: string,
  planMarkdown: string,
  historyPath?: string,
): StalePackValidation {
  // Check current slice ID
  const currentSliceId = extractSliceId(planMarkdown);
  if (pack.sliceId !== currentSliceId) {
    return {
      isStale: true,
      ruleId: RULE_IDS.STALE_SLICE_ID,
      message: `Slice ID mismatch: pack has '${pack.sliceId}', current is '${currentSliceId}'`,
    };
  }

  // Check current work queue fingerprint
  const currentWorkQueueItems = parseWorkQueueItems(taskpadMarkdown);
  const currentBulletTexts = currentWorkQueueItems.map((item) => item.text);
  const currentFingerprint = computeWorkQueueFingerprint(currentBulletTexts);

  if (pack.workQueueFingerprint !== currentFingerprint) {
    return {
      isStale: true,
      ruleId: RULE_IDS.STALE_FINGERPRINT,
      message: `Work queue fingerprint mismatch: pack has '${pack.workQueueFingerprint}', current is '${currentFingerprint}'`,
    };
  }

  // If history path provided, check pack generation age
  if (historyPath) {
    const historyResult = readHistoryFile(resolve(historyPath));
    if (historyResult.success) {
      // Find the most recent pack-generated event with matching hash
      const matchingEvent = historyResult.events
        .filter((e) => e.eventType === "pack-generated" && e.packHash === pack.packHash)
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];

      if (matchingEvent) {
        const packGeneratedAt = new Date(matchingEvent.generatedAt);
        const now = new Date();
        const ageHours = (now.getTime() - packGeneratedAt.getTime()) / (1000 * 60 * 60);

        // Default staleness threshold: 24 hours
        const MAX_AGE_HOURS = 24;

        // Build history linkage (TP004)
        const historyLinkage: HistoryLinkage = {
          eventType: matchingEvent.eventType as "pack-generated" | "contract-evaluated" | "execution-gate-evaluated",
          generatedAt: matchingEvent.generatedAt,
          sourceCommand: matchingEvent.sourceCommand || "taskpad:verification-pack",
        };

        if (ageHours > MAX_AGE_HOURS) {
          return {
            isStale: true,
            ruleId: RULE_IDS.STALE_PACK_HASH,
            message: `Pack is stale: generated ${ageHours.toFixed(1)} hours ago (max ${MAX_AGE_HOURS}h)`,
            packGeneratedAt: matchingEvent.generatedAt,
            packAgeHours: ageHours,
            historyLinkage,
          };
        }

        return {
          isStale: false,
          ruleId: null,
          message: "Pack is fresh (within age threshold)",
          packGeneratedAt: matchingEvent.generatedAt,
          packAgeHours: ageHours,
          historyLinkage,
        };
      }

      return {
        isStale: true,
        ruleId: RULE_IDS.STALE_PACK_HASH,
        message: `No pack-generated history event found for pack hash '${pack.packHash}'`,
      };
    }
  }

  return {
    isStale: false,
    ruleId: null,
    message: "Pack validation passed",
  };
}

// ============================================================================
// Deterministic Diagnostics Sorting
// ============================================================================

/**
 * Sort diagnostics deterministically by rule ID order.
 * Ensures stable output across runs per TP004 contract.
 */
function sortDiagnosticsByRuleId(diagnostics: string[]): string[] {
  return diagnostics.slice().sort((a, b) => {
    // Extract rule IDs from diagnostic strings
    const ruleIdA = extractRuleIdFromDiagnostic(a);
    const ruleIdB = extractRuleIdFromDiagnostic(b);

    // Get index in canonical order (lower index = higher priority)
    const indexA = ruleIdA ? CANONICAL_RULE_ORDER.indexOf(ruleIdA) : -1;
    const indexB = ruleIdB ? CANONICAL_RULE_ORDER.indexOf(ruleIdB) : -1;

    // Both have rule IDs - sort by canonical order
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }

    // Only A has rule ID - comes first
    if (indexA !== -1) return -1;

    // Only B has rule ID - comes first
    if (indexB !== -1) return 1;

    // Neither has rule ID - maintain stable alphabetical order
    return a.localeCompare(b);
  });
}

/**
 * Extract rule ID from a diagnostic string.
 * Looks for patterns like "Rule ID: EG001_COMMAND_NOT_RESOLVED"
 */
function extractRuleIdFromDiagnostic(diagnostic: string): RuleId | null {
  const match = diagnostic.match(/Rule ID:\s*(EG\d{3}_[A-Z_]+)/);
  return match ? (match[1] as RuleId) : null;
}

// ============================================================================
// Output Formatting
// ============================================================================

function outputHuman(result: ExecutionGateResult): void {
  console.log("TASKPAD Verification Pack Execution Gate");
  console.log("=========================================");
  console.log("");
  console.log(`Status: ${result.status.toUpperCase()}`);
  console.log(`Pack Hash: ${result.packHash}`);
  console.log(`Work Queue Fingerprint: ${result.workQueueFingerprint}`);
  console.log(`Slice ID: ${result.sliceId}`);
  console.log(`Evaluated At: ${result.evaluatedAt}`);
  console.log("");
  console.log(`Commands: ${result.commandCount} total, ${result.passedCount} passed, ${result.failedCount} failed`);
  console.log("");
  console.log("Lineage:");
  console.log(`  Slice ID: ${result.lineage.sliceId}`);
  console.log(`  Pack Generated At: ${result.lineage.packGeneratedAt}`);
  console.log(`  Is Stale: ${result.lineage.isStale ? "YES" : "NO"}`);
  if (result.lineage.historyLinkage) {
    console.log(`  History Linkage:`);
    console.log(`    Event Type: ${result.lineage.historyLinkage.eventType}`);
    console.log(`    Generated At: ${result.lineage.historyLinkage.generatedAt}`);
    console.log(`    Source Command: ${result.lineage.historyLinkage.sourceCommand}`);
  }
  console.log("");
  console.log("Command Results:");
  if (result.commandResults.length === 0) {
    console.log("  (none)");
  } else {
    for (const cmdResult of result.commandResults) {
      const status = cmdResult.passed ? "✓ PASS" : "✗ FAIL";
      console.log(`  ${status} [${cmdResult.commandType}] ${cmdResult.command}`);
      if (cmdResult.ruleId) {
        console.log(`    Rule ID: ${cmdResult.ruleId}`);
        console.log(`    Message: ${cmdResult.message}`);
      }
    }
  }
  console.log("");
  console.log("Diagnostics:");
  for (const diag of result.diagnostics) {
    console.log(`  - ${diag}`);
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Validate required arguments
  if (!args.taskpadPath || !args.planPath || !args.packPath || !args.packagePath) {
    console.error("TASKPAD verification pack execution gate: FAIL");
    console.error("- Missing required paths. Provide --taskpad, --plan, --pack, and --package.");
    printHelp();
    process.exit(2);
  }

  const resolvedTaskpadPath = resolve(args.taskpadPath);
  const resolvedPlanPath = resolve(args.planPath);
  const resolvedPackPath = resolve(args.packPath);
  const resolvedPackagePath = resolve(args.packagePath);
  const resolvedHistoryPath = args.historyPath ? resolve(args.historyPath) : undefined;

  // Read input files
  let pack: VerificationPack;
  let taskpadMarkdown: string;
  let planMarkdown: string;
  let packageScripts: PackageScripts;

  try {
    pack = loadVerificationPack(resolvedPackPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD verification pack execution gate: FAIL");
    console.error(`- Failed to load pack at ${resolvedPackPath}: ${message}`);
    process.exit(2);
  }

  try {
    taskpadMarkdown = readFileSync(resolvedTaskpadPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD verification pack execution gate: FAIL");
    console.error(`- Failed to read TASKPAD file at ${resolvedTaskpadPath}: ${message}`);
    process.exit(2);
  }

  try {
    planMarkdown = readFileSync(resolvedPlanPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD verification pack execution gate: FAIL");
    console.error(`- Failed to read IMPLEMENTATION_PLAN file at ${resolvedPlanPath}: ${message}`);
    process.exit(2);
  }

  try {
    packageScripts = loadPackageScripts(resolvedPackagePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD verification pack execution gate: FAIL");
    console.error(`- Failed to load package.json at ${resolvedPackagePath}: ${message}`);
    process.exit(2);
  }

  // Validate pack is not stale
  const staleValidation = validatePackNotStale(
    pack,
    taskpadMarkdown,
    planMarkdown,
    resolvedHistoryPath,
  );

  const diagnostics: string[] = [];
  let overallStatus: "pass" | "fail" = "pass";
  let passedCount = 0;
  let failedCount = 0;

  const commandResults: CommandExecutionResult[] = [];

  // If pack is stale, fail immediately with no command execution
  if (staleValidation.isStale) {
    overallStatus = "fail";
    diagnostics.push(`Stale pack detected: ${staleValidation.message}`);
    if (staleValidation.ruleId) {
      diagnostics.push(`Rule ID: ${staleValidation.ruleId}`);
    }
    diagnostics.push("Suggestion: Run 'bun run taskpad:verification-pack -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md' to generate a fresh pack");

    // Create empty command results (no execution attempted)
    // All commands marked as not executed due to stale pack
    for (const command of pack.verificationCommands) {
      const resolution = resolveCommandTarget(command, packageScripts);
      commandResults.push({
        command: resolution.command,
        commandType: resolution.commandType,
        resolved: resolution.resolved,
        passed: false,
        exitCode: null,
        durationMs: null,
        ruleId: staleValidation.ruleId,
        message: `Skipped: ${staleValidation.message}`,
      });
    }

    passedCount = 0;
    failedCount = pack.verificationCommands.length;
  } else {
    // Resolve all command targets (TP002)
    const resolutions = resolveAllCommandTargets(pack.verificationCommands, packageScripts);

    // Execute all resolved commands (TP003 - guarded command evaluator)
    const executionResults = await executeAllCommands(
      resolutions,
      process.cwd(),
      args.timeoutSeconds * 1000,
      MAX_OUTPUT_BYTES,
    );

    commandResults.push(...executionResults);

    // Calculate pass/fail counts
    for (const result of executionResults) {
      if (!result.resolved || !result.passed) {
        overallStatus = "fail";
        failedCount++;
        if (!result.resolved) {
          diagnostics.push(`Failed to resolve command: ${result.command}`);
        } else {
          diagnostics.push(`Failed to execute command: ${result.command}`);
        }
        if (result.ruleId) {
          diagnostics.push(`  Rule ID: ${result.ruleId}`);
        }
        diagnostics.push(`  Message: ${result.message}`);
      } else {
        passedCount++;
      }
    }

    if (overallStatus === "pass") {
      diagnostics.push(`Execution gate passed: all ${passedCount} commands executed successfully`);
    } else {
      diagnostics.push(`Execution gate failed: ${failedCount} of ${pack.verificationCommands.length} commands failed`);
    }
  }

  // Build lineage with verification-pack contract/readiness linkage (TP004)
  const lineage: Lineage = {
    sliceId: pack.sliceId,
    workQueueFingerprint: pack.workQueueFingerprint,
    packHash: pack.packHash,
    packGeneratedAt: pack.generatedAt,
    isStale: staleValidation.isStale,
    // Include history linkage from stale-pack validation (TP004)
    historyLinkage: staleValidation.historyLinkage || null,
  };

  // Sort diagnostics deterministically by rule ID (TP004)
  const sortedDiagnostics = sortDiagnosticsByRuleId(diagnostics);

  // Build result with deterministic ordering and full lineage (TP004)
  const result: ExecutionGateResult = {
    version: 1,
    status: overallStatus,
    packHash: pack.packHash,
    workQueueFingerprint: pack.workQueueFingerprint,
    sliceId: pack.sliceId,
    commandCount: pack.verificationCommands.length,
    passedCount,
    failedCount,
    // Command results are already in pack order (deterministic per contract)
    commandResults,
    // Lineage links to verification-pack contract/readiness (TP004)
    lineage,
    // Deterministically sorted diagnostics (TP004)
    diagnostics: sortedDiagnostics,
    evaluatedAt: new Date().toISOString(),
  };

  // Write output
  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    outputHuman(result);
  }

  // Exit with appropriate code
  process.exit(overallStatus === "pass" ? 0 : 1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(2);
  });
}
