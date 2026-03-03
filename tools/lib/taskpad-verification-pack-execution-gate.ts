// ============================================================================
// TASKPAD Verification Pack Execution Gate - Schema Types and Utilities
// ============================================================================
//
// Purpose: Canonical type definitions and helper functions for the
//          taskpad:verification-pack-execution-gate contract.
//
// Contract: docs/quality/taskpad-verification-pack-execution-gate.md
//
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// ============================================================================
// Schema Version
// ============================================================================

export const EXECUTION_GATE_SCHEMA_VERSION = 1;

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
  // Resolution failures first
  RULE_IDS.COMMAND_NOT_RESOLVED,
  RULE_IDS.SCRIPT_NOT_FOUND,
  RULE_IDS.TOOL_NOT_FOUND,
  RULE_IDS.TEST_FILE_NOT_FOUND,
  RULE_IDS.COMMAND_CLASS_DISALLOWED,

  // Execution failures
  RULE_IDS.COMMAND_TIMEOUT,
  RULE_IDS.NON_ZERO_EXIT,
  RULE_IDS.EXECUTION_ERROR,
  RULE_IDS.OUTPUT_TRUNCATED,

  // Stale pack failures
  RULE_IDS.STALE_PACK_HASH,
  RULE_IDS.STALE_SLICE_ID,
  RULE_IDS.STALE_FINGERPRINT,
];

// ============================================================================
// Command Classes
// ============================================================================

export type CommandType =
  | "package-script"
  | "test-runner"
  | "tool-entry"
  | "verification-command"
  | "unknown";

export type GateStatus = "pass" | "fail" | "noop";

// ============================================================================
// Core Interfaces
// ============================================================================

/**
 * Result of executing a single verification command.
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

  /** Captured stdout (truncated to 100KB) */
  stdout?: string;

  /** Captured stderr (truncated to 100KB) */
  stderr?: string;
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
 * Lineage information linking execution gate result to verification-pack history (TP004).
 */
export interface ExecutionGateLineage {
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
 * Full execution gate result.
 */
export interface ExecutionGateResult {
  /** Schema version (must be 1) */
  version: number;

  /** Overall verdict: "pass" or "fail" */
  status: GateStatus;

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

  /** Linkage to verification-pack history lineage */
  lineage: ExecutionGateLineage;

  /** Diagnostics explaining the result */
  diagnostics: string[];

  /** ISO 8601 timestamp of gate evaluation */
  evaluatedAt: string;
}

/**
 * Reusing the VerificationPack interface from taskpad-verification-pack.ts.
 */
export interface VerificationPack {
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

/**
 * Work queue item from verification pack.
 */
export interface WorkQueueItem {
  text: string;
  marker?: string;
  markerShape?: "unparenthesized" | "parenthesized" | null;
  plannedDate?: string;
  hasVerifyClause: boolean;
  verifyCommand?: string;
}

/**
 * Metadata from verification pack.
 */
export interface VerificationPackMetadata {
  uncheckedCount: number;
  plannedCount: number;
  commandCount: number;
  inputHash: string;
}

/**
 * Package.json scripts interface.
 */
export interface PackageScripts {
  [scriptName: string]: string;
}

/**
 * Loaded package.json.
 */
export interface PackageJson {
  name: string;
  version: string;
  scripts?: PackageScripts;
}

// ============================================================================
// Resolution Interfaces
// ============================================================================

/**
 * Result of resolving a command to its executable form.
 */
export interface CommandResolution {
  /** The original command string */
  originalCommand: string;

  /** Resolved command type */
  commandType: CommandType;

  /** Whether resolution succeeded */
  resolved: boolean;

  /** Resolved executable command (e.g., script name or file path) */
  executable: string | null;

  /** Rule ID if resolution failed */
  ruleId: RuleId | null;

  /** Human-readable explanation */
  message: string;
}

/**
 * Execution configuration options.
 */
export interface ExecutionOptions {
  /** Per-command timeout in milliseconds */
  timeoutMs: number;

  /** Maximum output size per command in bytes */
  maxOutputBytes: number;

  /** Working directory for command execution */
  cwd: string;

  /** Environment variables to pass to commands (sanitized) */
  env: Record<string, string>;

  /** Whether to capture stdout */
  captureStdout: boolean;

  /** Whether to capture stderr */
  captureStderr: boolean;
}

/**
 * Result of stale pack linkage validation.
 */
export interface StalePackValidationResult {
  /** Whether the pack is considered stale */
  isStale: boolean;

  /** Rule ID indicating why pack is stale (null if fresh) */
  ruleId: RuleId | null;

  /** Human-readable explanation */
  message: string;

  /** Pack generation timestamp from history (or null if not found) */
  packGeneratedAt: string | null;

  /** Time elapsed since pack generation in milliseconds (or null if not found) */
  ageMs: number | null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get current ISO 8601 timestamp in UTC.
 */
export function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Compute SHA-256 hash of content.
 */
export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Load and parse a JSON file.
 */
export function loadJsonFile<T>(path: string): T {
  if (!existsSync(path)) {
    throw new Error(`File does not exist: ${path}`);
  }

  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON file at ${path}: ${message}`);
  }
}

/**
 * Load verification pack from file path.
 */
export function loadVerificationPack(packPath: string): VerificationPack {
  const pack = loadJsonFile<VerificationPack>(packPath);

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
  if (!Array.isArray(pack.verificationCommands)) {
    throw new Error("Missing or invalid field: verificationCommands");
  }

  return pack;
}

/**
 * Load package.json from file path.
 */
export function loadPackageJson(packagePath: string): PackageJson {
  return loadJsonFile<PackageJson>(packagePath);
}

/**
 * Check if a command is a package.json script.
 */
export function isPackageScriptCommand(command: string): boolean {
  // Matches patterns like: "typecheck", "bun run typecheck", "npm run typecheck"
  const patterns = [
    /^[\w-]+$/, // Simple script name
    /^bun run\s+[\w-]+$/,
    /^npm run\s+[\w-]+$/,
  ];

  return patterns.some((pattern) => pattern.test(command.trim()));
}

/**
 * Extract script name from command.
 */
export function extractScriptName(command: string): string | null {
  const trimmed = command.trim();

  // Handle "bun run <script>" or "npm run <script>"
  const bunRunMatch = trimmed.match(/^bun run\s+([\w-]+)$/);
  if (bunRunMatch) {
    return bunRunMatch[1];
  }

  const npmRunMatch = trimmed.match(/^npm run\s+([\w-]+)$/);
  if (npmRunMatch) {
    return npmRunMatch[1];
  }

  // Handle direct script name
  if (/^[\w-]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Check if a command is a test runner command.
 */
export function isTestRunnerCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed.startsWith("bun test") || trimmed.startsWith("bun run test");
}

/**
 * Extract test pattern from command.
 */
export function extractTestPattern(command: string): string | null {
  const trimmed = command.trim();

  // Match "bun test <pattern>" or "bun run test <pattern>"
  const match = trimmed.match(/^(?:bun run\s+)?test\s+(.+)$/);
  if (match) {
    return match[1].trim();
  }

  return null;
}

/**
 * Check if a command is a tool entry command.
 */
export function isToolEntryCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed.startsWith("bun run tools/") && trimmed.endsWith(".ts");
}

/**
 * Extract tool path from command.
 */
export function extractToolPath(command: string): string | null {
  const trimmed = command.trim();

  // Match "bun run tools/<tool>.ts"
  const match = trimmed.match(/^bun run\s+(tools\/[\w-]+\.ts)$/);
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * Check if a command is a known verification command.
 */
export function isVerificationCommand(command: string): boolean {
  const knownCommands = [
    "taskpad:verification-pack",
    "taskpad:verification-pack-contract",
    "taskpad:verification-pack-execution-gate",
    "taskpad:queue-health",
    "taskpad:planned-command-parity",
    "taskpad:fallback-artifact-parity",
    "plan:integrity",
    "test:typecheck",
    "test:full",
  ];

  const trimmed = command.trim();

  // Check for "bun run <command>"
  if (trimmed.startsWith("bun run ")) {
    const scriptName = trimmed.slice(8);
    return knownCommands.includes(scriptName);
  }

  return false;
}

/**
 * Determine command type from command string.
 */
export function determineCommandType(command: string): CommandType {
  if (isVerificationCommand(command)) {
    return "verification-command";
  }

  if (isTestRunnerCommand(command)) {
    return "test-runner";
  }

  if (isToolEntryCommand(command)) {
    return "tool-entry";
  }

  if (isPackageScriptCommand(command)) {
    return "package-script";
  }

  return "unknown";
}

/**
 * Create a failed command result.
 */
export function createFailedCommandResult(params: {
  command: string;
  commandType: CommandType;
  ruleId: RuleId;
  message: string;
}): CommandExecutionResult {
  return {
    command: params.command,
    commandType: params.commandType,
    resolved: false,
    passed: false,
    exitCode: null,
    durationMs: null,
    ruleId: params.ruleId,
    message: params.message,
  };
}

/**
 * Sort diagnostics deterministically.
 */
export function sortDiagnostics(diagnostics: string[]): string[] {
  // Diagnostics are already in canonical order when generated
  // This function ensures stable sorting if needed
  return [...diagnostics].sort();
}

/**
 * Create execution gate result.
 */
export function createExecutionGateResult(params: {
  packHash: string;
  workQueueFingerprint: string;
  sliceId: string;
  commandResults: CommandExecutionResult[];
  lineage: ExecutionGateLineage;
  diagnostics: string[];
}): ExecutionGateResult {
  const commandCount = params.commandResults.length;
  const passedCount = params.commandResults.filter((r) => r.passed).length;
  const failedCount = params.commandResults.filter((r) => !r.passed).length;

  // Determine status
  let status: GateStatus;
  if (commandCount === 0) {
    status = "noop";
  } else if (failedCount === 0) {
    status = "pass";
  } else {
    status = "fail";
  }

  return {
    version: EXECUTION_GATE_SCHEMA_VERSION,
    status,
    packHash: params.packHash,
    workQueueFingerprint: params.workQueueFingerprint,
    sliceId: params.sliceId,
    commandCount,
    passedCount,
    failedCount,
    commandResults: params.commandResults,
    lineage: params.lineage,
    diagnostics: params.diagnostics,
    evaluatedAt: getTimestamp(),
  };
}

/**
 * Get default execution options.
 */
export function getDefaultExecutionOptions(cwd: string): ExecutionOptions {
  return {
    timeoutMs: 30000, // 30 seconds
    maxOutputBytes: 1024 * 1024, // 1MB
    cwd,
    env: {
      // Allow only safe environment variables
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
      NODE_ENV: process.env.NODE_ENV || "production",
    },
    captureStdout: true,
    captureStderr: true,
  };
}

/**
 * Validate stale pack linkage.
 *
 * @param pack - The verification pack being evaluated
 * @param currentSliceId - Current active slice ID from IMPLEMENTATION_PLAN
 * @param currentFingerprint - Current work queue fingerprint from TASKPAD
 * @param historyPath - Path to verification-pack-history.ndjson
 * @param maxAgeMs - Maximum allowed pack age in milliseconds (default: 24 hours)
 */
export function validateStalePackLinkage(
  pack: VerificationPack,
  currentSliceId: string,
  currentFingerprint: string,
  historyPath: string,
  maxAgeMs: number = 24 * 60 * 60 * 1000, // 24 hours
): StalePackValidationResult {
  // Check slice ID match
  if (pack.sliceId !== currentSliceId) {
    return {
      isStale: true,
      ruleId: RULE_IDS.STALE_SLICE_ID,
      message: `Stale pack detected: slice ID '${pack.sliceId}' does not match current active slice '${currentSliceId}'`,
      packGeneratedAt: pack.generatedAt,
      ageMs: null,
    };
  }

  // Check fingerprint match
  if (pack.workQueueFingerprint !== currentFingerprint) {
    return {
      isStale: true,
      ruleId: RULE_IDS.STALE_FINGERPRINT,
      message: `Stale pack detected: work queue fingerprint '${pack.workQueueFingerprint}' does not match current state '${currentFingerprint}'`,
      packGeneratedAt: pack.generatedAt,
      ageMs: null,
    };
  }

  // Check pack age
  const packGeneratedAt = new Date(pack.generatedAt).getTime();
  const now = Date.now();
  const ageMs = now - packGeneratedAt;

  if (ageMs > maxAgeMs) {
    const ageHours = (ageMs / (60 * 60 * 1000)).toFixed(1);
    return {
      isStale: true,
      ruleId: RULE_IDS.STALE_PACK_HASH,
      message: `Stale pack detected: pack was generated ${ageHours} hours ago (max age: ${maxAgeMs / (60 * 60 * 1000)} hours)`,
      packGeneratedAt: pack.generatedAt,
      ageMs,
    };
  }

  // Pack is fresh
  return {
    isStale: false,
    ruleId: null,
    message: "Pack linkage validated: pack is fresh and matches current state",
    packGeneratedAt: pack.generatedAt,
    ageMs,
  };
}
