#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ============================================================================
// Rule IDs (from contract docs/quality/taskpad-planned-command-parity.md)
// ============================================================================

export const RULE_IDS = {
  MISSING_SCRIPT: "PARITY001_MISSING_SCRIPT",
  MISSING_TOOL_PATH: "PARITY002_MISSING_TOOL_PATH",
  NON_EXECUTABLE_PATH: "PARITY003_NON_EXECUTABLE_PATH",
  STALE_REFERENCE: "PARITY004_STALE_REFERENCE",
  NO_COMMAND_REFERENCE: "PARITY005_NO_COMMAND_REFERENCE",
  AMBIGUOUS_MAPPING: "PARITY006_AMBIGUOUS_MAPPING",
  PARSE_FAILURE: "PARITY007_PARSE_FAILURE",
  MULTIPLE_MARKERS: "PARITY008_MULTIPLE_MARKERS",
  UNBALANCED_PARENS: "PARITY009_UNBALANCED_PARENS",
  WHITESPACE_IN_MARKER: "PARITY010_WHITESPACE_IN_MARKER",
  MARKER_POSITION: "PARITY011_MARKER_POSITION",
  INVALID_DATE_FORMAT: "PARITY012_INVALID_DATE_FORMAT",
  MARKER_AMBIGUOUS: "PARITY013_MARKER_AMBIGUOUS",
} as const;

type RuleId = (typeof RULE_IDS)[keyof typeof RULE_IDS];

/**
 * Canonical order for violation rule IDs in diagnostics output.
 * Ensures deterministic, stable ordering across runs for machine-readable output.
 */
const CANONICAL_VIOLATION_ORDER: RuleId[] = [
  RULE_IDS.MULTIPLE_MARKERS,
  RULE_IDS.UNBALANCED_PARENS,
  RULE_IDS.WHITESPACE_IN_MARKER,
  RULE_IDS.MARKER_POSITION,
  RULE_IDS.INVALID_DATE_FORMAT,
  RULE_IDS.MARKER_AMBIGUOUS,
  RULE_IDS.MISSING_SCRIPT,
  RULE_IDS.MISSING_TOOL_PATH,
  RULE_IDS.NON_EXECUTABLE_PATH,
  RULE_IDS.STALE_REFERENCE,
  RULE_IDS.NO_COMMAND_REFERENCE,
  RULE_IDS.AMBIGUOUS_MAPPING,
  RULE_IDS.PARSE_FAILURE,
];

// ============================================================================
// Types
// ============================================================================

export interface PlannedItem {
  lineNumber: number;
  rawText: string;
  plannedDate: string;
  markerShape: "unparenthesized" | "parenthesized";
  sourceText: string;
  verifyCommands: string[];
}

/**
 * Marker shape statistics for detected planned items.
 * Provides metadata for observability and migration analysis.
 */
export interface MarkerShapeStats {
  /** Total number of planned items with unparenthesized markers */
  unparenthesizedCount: number;
  /** Total number of planned items with parenthesized markers */
  parenthesizedCount: number;
  /** Total count of all marker shapes (should equal plannedCount) */
  totalCount: number;
  /** Percentage of items using parenthesized style (0-100) */
  parenthesizedPercentage: number;
  /** Percentage of items using unparenthesized style (0-100) */
  unparenthesizedPercentage: number;
  /** Whether the queue has mixed marker styles (both shapes present) */
  hasMixedStyles: boolean;
}

export interface TaskpadAnalysis {
  plannedItems: PlannedItem[];
  plannedCount: number;
  /** TP003: Marker shape statistics for observability and migration analysis */
  markerShapeStats: MarkerShapeStats;
}

export interface ActiveSlice {
  heading: string;
  line: number;
  date: string | null;
}

export interface VerificationCommand {
  command: string;
  lineNumber: number;
}

export interface PlanAnalysis {
  activeSlice: ActiveSlice | null;
  verificationCommands: VerificationCommand[];
  verificationCommandCount: number;
}

export interface PackageScripts {
  [key: string]: string;
}

export interface CommandSurface {
  packageScripts: PackageScripts;
  toolPaths: string[];
}

export interface PlannedCommand {
  source: "work-queue" | "verification-block";
  sourceLine: number;
  sourceItem: string;
  command: string;
  rawCommand: string;
  mappedTo: "package-script" | "tool-path" | "none";
  executable: boolean;
  validationStatus: "VALID" | "MISSING_MAPPING" | "MISSING_SCRIPT" | "NON_EXECUTABLE_PATH" | "STALE_REFERENCE";
}

export interface ParityCheckSummary {
  totalPlannedCommands: number;
  validCommands: number;
  invalidCommands: number;
  invalidCommandCount: number;
}

export interface ParityCheck {
  plannedCommands: PlannedCommand[];
  summary: ParityCheckSummary;
}

export interface ViolationDetails {
  scriptKey?: string;
  scriptExists?: boolean;
  toolPath?: string | null;
  toolExists?: boolean;
}

export interface Violation {
  ruleId: RuleId;
  severity: "error" | "warning";
  source: "work-queue" | "verification-block";
  sourceLine: number;
  sourceItem: string;
  command: string;
  details: ViolationDetails;
  remediation: string;
}

export interface ParityReport {
  status: "pass" | "fail";
  inputs: {
    taskpadPath: string;
    planPath: string;
    packagePath: string;
  };
  taskpadAnalysis: TaskpadAnalysis;
  planAnalysis: PlanAnalysis;
  commandSurface: CommandSurface;
  parityCheck: ParityCheck;
  violations: Violation[];
  timestamp: string;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliOptions {
  taskpadPath?: string;
  planPath?: string;
  packagePath?: string;
  format: "json" | "human";
}

function printHelp(): void {
  console.log(`
TASKPAD Planned Command Parity Checker

Validates that every planned Work Queue item has an executable command reference
in package.json scripts or tool paths.

USAGE:
  bun run tools/taskpad-planned-command-parity.ts --taskpad <path> --plan <path> --package <path>
  bun run tools/taskpad-planned-command-parity.ts <taskpad-path> <plan-path> <package-path>

OPTIONS:
  --taskpad <path>   Path to TASKPAD markdown file (required)
  --plan <path>      Path to IMPLEMENTATION_PLAN markdown file (required)
  --package <path>   Path to package.json file (required)
  --format <format>  Output format: json or human (default: json)
  --help, -h         Show this help message

EXIT CODES:
  0  All commands pass parity validation
  1  One or more commands fail parity validation (missing, unmapped, or non-executable)
  2  Input validation failure (invalid arguments, unreadable files)
`);
}

function parseArgs(argv: string[]): CliOptions {
  let taskpadPath: string | undefined;
  let planPath: string | undefined;
  let packagePath: string | undefined;
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
        console.error("Missing value for --taskpad");
        process.exit(2);
      }
      taskpadPath = value;
      continue;
    }

    if (arg === "--plan") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --plan");
        process.exit(2);
      }
      planPath = value;
      continue;
    }

    if (arg === "--package") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --package");
        process.exit(2);
      }
      packagePath = value;
      continue;
    }

    if (arg === "--format") {
      i++;
      const value = argv[i];
      if (!value || (value !== "human" && value !== "json")) {
        console.error("Invalid value for --format. Must be 'human' or 'json'.");
        process.exit(2);
      }
      format = value;
      continue;
    }

    // Positional arguments
    if (!arg.startsWith("-")) {
      if (!taskpadPath) {
        taskpadPath = arg;
      } else if (!planPath) {
        planPath = arg;
      } else if (!packagePath) {
        packagePath = arg;
      }
      continue;
    }

    console.error(`Unknown argument: ${arg}`);
    printHelp();
    process.exit(2);
  }

  return { taskpadPath, planPath, packagePath, format };
}

// ============================================================================
// Work Queue Parser - TP002 Implementation
// ============================================================================

const WORK_QUEUE_HEADING = "## Work Queue";
const H2_HEADING_REGEX = /^##\s+/;

/**
 * Pattern for unchecked checkbox prefix.
 * Matches bullets (-*+) followed by unchecked checkbox [ ]
 */
const CHECKBOX_PREFIX_REGEX = /^(\s*[-*+]\s+\[\s*\]\s+)/;

/**
 * Pattern for unparenthesized planned marker: planned-YYYY-MM-DD
 * Anchored to start of line to avoid matching inside parenthesized markers
 */
const UNPARENTHESIZED_MARKER_REGEX = /^(planned-(\d{4}-\d{2}-\d{2}))/;

/**
 * Pattern for parenthesized planned marker: (planned-YYYY-MM-DD)
 * Anchored to start of line
 */
const PARENTHESIZED_MARKER_REGEX = /^\((planned-(\d{4}-\d{2}-\d{2}))\)/;

/**
 * Pattern to detect any marker (for multiple marker detection)
 */
const ANY_MARKER_REGEX = /(?:\(planned-|planned-)\d{4}-\d{2}-\d{2}(?:\)|)?/g;

/**
 * ISO 8601 date validation regex.
 * Validates YYYY-MM-DD format with basic date range checks.
 */
const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Case-insensitive Verify: clause pattern.
 * Matches "Verify:" or "verify:" followed by command text.
 */
const VERIFY_CLAUSE_REGEX = /\bVerify:\s*(.+)$/i;

/**
 * Calculates marker shape statistics from planned items.
 * Provides metadata for observability and migration analysis.
 *
 * @param plannedItems - Array of planned items with marker shapes
 * @returns MarkerShapeStats with counts and percentages
 */
function calculateMarkerShapeStats(plannedItems: PlannedItem[]): MarkerShapeStats {
  const unparenthesizedCount = plannedItems.filter(
    (item) => item.markerShape === "unparenthesized"
  ).length;
  const parenthesizedCount = plannedItems.filter(
    (item) => item.markerShape === "parenthesized"
  ).length;
  const totalCount = plannedItems.length;

  // Calculate percentages (avoid division by zero)
  const parenthesizedPercentage = totalCount > 0
    ? Math.round((parenthesizedCount / totalCount) * 100)
    : 0;
  const unparenthesizedPercentage = totalCount > 0
    ? Math.round((unparenthesizedCount / totalCount) * 100)
    : 0;

  const hasMixedStyles = unparenthesizedCount > 0 && parenthesizedCount > 0;

  return {
    unparenthesizedCount,
    parenthesizedCount,
    totalCount,
    parenthesizedPercentage,
    unparenthesizedPercentage,
    hasMixedStyles,
  };
}

/**
 * Validates ISO 8601 date format.
 * Returns true if date is valid YYYY-MM-DD format within reasonable range.
 */
function isValidISODate(dateStr: string): boolean {
  const match = dateStr.match(ISO_DATE_REGEX);
  if (!match) {
    return false;
  }

  const [, year, month, day] = match;

  // Basic range validation
  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10);
  const dayNum = parseInt(day, 10);

  // Year: reasonable range (1900-2100)
  if (yearNum < 1900 || yearNum > 2100) {
    return false;
  }

  // Month: 01-12
  if (monthNum < 1 || monthNum > 12) {
    return false;
  }

  // Day: 01-31 (simplified - doesn't account for month-specific day counts)
  if (dayNum < 1 || dayNum > 31) {
    return false;
  }

  return true;
}

/**
 * Validates marker format and returns validation errors.
 * Checks for unbalanced parens, whitespace, date format, etc.
 */
function validateMarker(
  markerText: string,
  isParenthesized: boolean,
): { valid: boolean; ruleId?: RuleId; remediation?: string } {
  // Check for internal whitespace in marker
  if (/\s/.test(markerText)) {
    return {
      valid: false,
      ruleId: RULE_IDS.WHITESPACE_IN_MARKER,
      remediation: "Remove spaces within the planned marker. Use format 'planned-YYYY-MM-DD' or '(planned-YYYY-MM-DD)'.",
    };
  }

  // Extract the planned-YYYY-MM-DD portion (without parentheses for validation)
  const innerMarker = isParenthesized ? markerText.slice(1, -1) : markerText;

  // Validate date format
  const dateMatch = innerMarker.match(/^planned-(\d{4}-\d{2}-\d{2})$/);
  if (!dateMatch) {
    return {
      valid: false,
      ruleId: RULE_IDS.INVALID_DATE_FORMAT,
      remediation: "Fix the date portion to valid ISO 8601 format (YYYY-MM-DD).",
    };
  }

  const dateStr = dateMatch[1];
  if (!isValidISODate(dateStr)) {
    return {
      valid: false,
      ruleId: RULE_IDS.INVALID_DATE_FORMAT,
      remediation: "Fix the date portion to valid ISO 8601 format (YYYY-MM-DD).",
    };
  }

  return { valid: true };
}

/**
 * Parses commands from a Verify: clause.
 * Handles comma-separated and "and"-separated commands.
 */
export function extractVerifyCommands(verifyText: string): string[] {
  // Normalize the text
  const normalized = verifyText.trim();

  if (!normalized) {
    return [];
  }

  // Split by comma or " and " (case-insensitive)
  // First normalize "and" to comma for consistent parsing
  const withCommas = normalized.replace(/\s+and\s+/gi, ", ");

  // Split by comma
  const parts = withCommas.split(",");

  // Extract and normalize each command
  const commands: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) {
      commands.push(trimmed);
    }
  }

  return commands;
}

/**
 * Normalizes a command reference by:
 * 1. Stripping execution prefixes (bun run, npm run, node, bunx, npx, bun test)
 * 2. Extracting the script name (first token before arguments)
 * 3. Trimming whitespace
 * 4. Collapsing multiple spaces
 */
export function normalizeCommand(command: string): string {
  let normalized = command.trim();

  // Strip common execution prefixes
  const prefixes = [
    /^bun\s+run\s+/i,
    /^bun\s+test\s+/i,
    /^bun\s+/i,
    /^npm\s+run\s+/i,
    /^npm\s+test\s+/i,
    /^yarn\s+test\s+/i,
    /^yarn\s+/i,
    /^pnpm\s+run\s+/i,
    /^pnpm\s+test\s+/i,
    /^node\s+/i,
    /^bunx\s+/i,
    /^npx\s+/i,
  ];

  for (const prefix of prefixes) {
    normalized = normalized.replace(prefix, "");
  }

  // Collapse multiple spaces to single space
  normalized = normalized.replace(/\s+/g, " ").trim();

  // For commands with arguments, extract just the script name
  // E.g., "taskpad:planned-command-parity -- --taskpad foo" -> "taskpad:planned-command-parity"
  // But keep file paths like "tests/tools/example.test.ts"
  if (!isToolPath(normalized) && !isTestPath(normalized)) {
    const spaceIndex = normalized.indexOf(" ");
    if (spaceIndex > 0) {
      // Check if the first token is a script name pattern
      const firstToken = normalized.slice(0, spaceIndex);
      if (/^(taskpad:|plan:|pilot:|test:|verify:|ci:|clip:|build|dev|typecheck|lint|format|test|mcp|pipeline|native:)/.test(firstToken)) {
        normalized = firstToken;
      }
    }
  }

  return normalized;
}

/**
 * Checks if a normalized command looks like a file path.
 */
export function isToolPath(command: string): boolean {
  // Matches paths like tools/*.ts, *.ts, ./path, tests/*, etc.
  return (
    /^(\.\/|tools\/|tests\/|\.?[a-zA-Z0-9_-]+\/.*\.(ts|js|mjs|cjs))/.test(command) ||
    /\.(ts|js|mjs|cjs)$/.test(command)
  );
}

/**
 * Checks if a path is a valid test file path.
 */
export function isTestPath(command: string): boolean {
  return /^tests\/.*\.(test|spec)\.(ts|js|mjs|cjs)$/.test(command) || /\.(test|spec)\.(ts|js|mjs|cjs)$/.test(command);
}

/**
 * Parses a TASKPAD file and extracts planned Work Queue items with their Verify: clauses.
 * This is the core parser for TP002 - supports both canonical and parenthesized marker shapes.
 *
 * Returns a TaskpadAnalysis with planned items sorted by line number.
 */
export function parseTaskpadPlannedItems(taskpadMarkdown: string): TaskpadAnalysis {
  const lines = taskpadMarkdown.split(/\r?\n/);
  const plannedItems: PlannedItem[] = [];

  let inWorkQueue = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    const trimmedLine = line.trim();

    // Check for Work Queue heading
    if (trimmedLine === WORK_QUEUE_HEADING) {
      inWorkQueue = true;
      continue;
    }

    // Check for any other H2 heading (exits Work Queue section)
    if (H2_HEADING_REGEX.test(trimmedLine)) {
      if (inWorkQueue && trimmedLine !== WORK_QUEUE_HEADING) {
        inWorkQueue = false;
      }
      continue;
    }

    // Only process items in Work Queue section
    if (!inWorkQueue) {
      continue;
    }

    // Check for unchecked checkbox prefix
    const checkboxMatch = line.match(CHECKBOX_PREFIX_REGEX);
    if (!checkboxMatch) {
      continue;
    }

    const prefix = checkboxMatch[1]; // The bullet + checkbox + space
    const restOfLine = line.slice(prefix.length); // Everything after checkbox

    // Try parenthesized marker first (more specific) to avoid false positives
    // when unparenthesized pattern would match inside parentheses
    let parenthesizedMatch = restOfLine.match(PARENTHESIZED_MARKER_REGEX);
    let unparenthesizedMatch = restOfLine.match(UNPARENTHESIZED_MARKER_REGEX);

    // Determine which marker shape was found
    let plannedDate: string | null = null;
    let markerShape: "unparenthesized" | "parenthesized" | null = null;
    let markerText: string | null = null;

    if (parenthesizedMatch) {
      markerShape = "parenthesized";
      markerText = parenthesizedMatch[0]; // Full marker including parens
      plannedDate = parenthesizedMatch[2]; // Just the date part (YYYY-MM-DD)
    } else if (unparenthesizedMatch) {
      markerShape = "unparenthesized";
      markerText = unparenthesizedMatch[1]; // Full marker including "planned-"
      plannedDate = unparenthesizedMatch[2]; // Just the date part
    } else {
      // No valid marker - not a planned item
      continue;
    }

    // Validate marker format
    if (markerText && markerShape) {
      const validation = validateMarker(markerText, markerShape === "parenthesized");
      if (!validation.valid) {
        // Skip this item - marker validation would emit a violation in a full implementation
        // For TP002, we focus on detecting both shapes without false positives
        continue;
      }
    }

    if (!plannedDate) {
      continue;
    }

    // Check for multiple markers (PARITY008 warning)
    // Count how many markers appear after the checkbox prefix
    const restAfterMarker = restOfLine.slice((markerText?.length || 0));
    const additionalMarkers = restAfterMarker.match(ANY_MARKER_REGEX);
    if (additionalMarkers && additionalMarkers.length > 0) {
      // Multiple markers detected - for now, just use the first one
      // In a full implementation, we'd emit PARITY008 warning here
    }

    // Extract task description and Verify: clause
    // Remove the marker from the rest of the line
    let taskDescription = restOfLine.slice(markerText?.length || 0).trim();

    // Check for Verify: clause
    const verifyMatch = taskDescription.match(VERIFY_CLAUSE_REGEX);
    const verifyCommands: string[] = [];

    let sourceText: string;
    if (verifyMatch) {
      // Extract the task text (before Verify:)
      sourceText = taskDescription.slice(0, taskDescription.length - verifyMatch[0].length).trim();
      // Extract and parse commands
      const verifyText = verifyMatch[1];
      const rawCommands = extractVerifyCommands(verifyText);
      for (const cmd of rawCommands) {
        verifyCommands.push(normalizeCommand(cmd));
      }
    } else {
      sourceText = taskDescription.trim();
    }

    plannedItems.push({
      lineNumber,
      rawText: line.trim(),
      plannedDate,
      markerShape: markerShape as "unparenthesized" | "parenthesized",
      sourceText,
      verifyCommands,
    });
  }

  // Sort by line number for deterministic output
  plannedItems.sort((a, b) => a.lineNumber - b.lineNumber);

  // TP003: Calculate marker shape statistics for observability and migration analysis
  const markerShapeStats = calculateMarkerShapeStats(plannedItems);

  return {
    plannedItems,
    plannedCount: plannedItems.length,
    markerShapeStats,
  };
}

// ============================================================================
// Implementation Plan Parser - Verification Commands Block
// ============================================================================

const ACTIVE_SLICE_HEADING_REGEX = /^##\s+TASKPAD Intake Slice\b/;
const VERIFICATION_COMMANDS_HEADING = "### Verification Commands";
const H3_HEADING_REGEX = /^###\s+/;

/**
 * Extracts the date from a slice heading.
 * Looks for pattern like (2026-03-01)
 */
function extractSliceDate(heading: string): string | null {
  const dateMatch = heading.match(/\((\d{4}-\d{2}-\d{2})\)/);
  return dateMatch ? dateMatch[1] : null;
}

/**
 * Parses the IMPLEMENTATION_PLAN and extracts the active slice's verification commands.
 */
export function parsePlanVerificationCommands(planMarkdown: string): PlanAnalysis {
  const lines = planMarkdown.split(/\r?\n/);

  // Find the active slice (first TASKPAD Intake Slice heading)
  let activeSlice: ActiveSlice | null = null;
  let activeSliceStartLine = -1;
  let activeSliceEndLine = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();

    if (ACTIVE_SLICE_HEADING_REGEX.test(trimmedLine)) {
      activeSlice = {
        heading: trimmedLine,
        line: i + 1,
        date: extractSliceDate(trimmedLine),
      };
      activeSliceStartLine = i;
      break;
    }
  }

  if (!activeSlice) {
    return {
      activeSlice: null,
      verificationCommands: [],
      verificationCommandCount: 0,
    };
  }

  // Find the end of the active slice (next H2 heading)
  for (let i = activeSliceStartLine + 1; i < lines.length; i++) {
    if (H2_HEADING_REGEX.test(lines[i].trim())) {
      activeSliceEndLine = i;
      break;
    }
  }

  // Find the Verification Commands section within the active slice
  const verificationCommands: VerificationCommand[] = [];
  let inVerificationSection = false;
  let inBashFence = false;

  for (let i = activeSliceStartLine; i < activeSliceEndLine; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Check for Verification Commands heading
    if (trimmedLine === VERIFICATION_COMMANDS_HEADING) {
      inVerificationSection = true;
      continue;
    }

    // Check for H3 heading (exits Verification Commands section)
    if (H3_HEADING_REGEX.test(trimmedLine)) {
      if (inVerificationSection && trimmedLine !== VERIFICATION_COMMANDS_HEADING) {
        inVerificationSection = false;
        inBashFence = false;
      }
      continue;
    }

    if (!inVerificationSection) {
      continue;
    }

    // Check for bash fence
    if (trimmedLine === "```bash") {
      inBashFence = true;
      continue;
    }

    if (trimmedLine === "```" && inBashFence) {
      inBashFence = false;
      continue;
    }

    // Extract commands from bash fence
    if (inBashFence) {
      // Skip empty lines and comments
      if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
        continue;
      }

      verificationCommands.push({
        command: normalizeCommand(trimmedLine),
        lineNumber: i + 1,
      });
    }
  }

  return {
    activeSlice,
    verificationCommands,
    verificationCommandCount: verificationCommands.length,
  };
}

// ============================================================================
// Command Surface Resolver - Validates commands against package.json and tool paths
// ============================================================================

/**
 * Parses package.json and extracts the scripts object.
 */
export function parsePackageScripts(packageJsonContent: string): PackageScripts {
  try {
    const parsed = JSON.parse(packageJsonContent);
    return parsed.scripts || {};
  } catch {
    return {};
  }
}

/**
 * Discovers tool paths in the tools directory.
 * For now, returns known tool paths from the project.
 */
export function discoverToolPaths(projectRoot: string): string[] {
  const toolPaths: string[] = [];

  // Common tool files to check
  const commonTools = [
    "tools/taskpad-queue-health.ts",
    "tools/taskpad-auto-ideation.ts",
    "tools/taskpad-apply-fallback.ts",
    "tools/taskpad-intake-recover.ts",
    "tools/taskpad-intake-autoplan.ts",
    "tools/taskpad-plan-seed.ts",
    "tools/taskpad-plan-prune.ts",
    "tools/taskpad-write-preflight.ts",
    "tools/taskpad-planned-command-parity.ts",
    "tools/implementation-plan-integrity.ts",
    "tools/pilot-ingest-replies.ts",
    "tools/pilot-latency.ts",
    "tools/pilot-price-signal.ts",
    "tools/pilot-rebuild.ts",
    "tools/pilot-response-proof.ts",
    "tools/pilot-sample-gap-planner.ts",
    "tools/test-e2e-matrix.ts",
    "tools/clip-url.ts",
    "tools/clip-stdin.ts",
    "tools/mcp-server.ts",
    // Common test files
    "tests/tools/taskpad-queue-health.test.ts",
    "tests/tools/taskpad-auto-ideation.test.ts",
    "tests/tools/taskpad-apply-fallback.test.ts",
    "tests/tools/taskpad-intake-autoplan.test.ts",
    "tests/tools/taskpad-plan-seed.test.ts",
    "tests/tools/implementation-plan-integrity.test.ts",
    "tests/tools/pilot-ingest-replies.test.ts",
    "tests/tools/pilot-latency.test.ts",
    "tests/tools/pilot-price-signal.test.ts",
    "tests/tools/pilot-rebuild.test.ts",
    "tests/tools/pilot-response-proof.test.ts",
    "tests/tools/pilot-sample-gap-planner.test.ts",
    "tests/e2e/headless-clip-harness.test.ts",
  ];

  for (const toolPath of commonTools) {
    const fullPath = resolve(projectRoot, toolPath);
    if (existsSync(fullPath)) {
      toolPaths.push(toolPath);
    }
  }

  return toolPaths.sort();
}

/**
 * Resolves a command to determine if it's executable.
 * Returns information about how the command maps and its validation status.
 */
export function resolveCommand(
  command: string,
  packageScripts: PackageScripts,
  toolPaths: string[],
): {
  mappedTo: "package-script" | "tool-path" | "none";
  executable: boolean;
  validationStatus: "VALID" | "MISSING_MAPPING" | "MISSING_SCRIPT" | "NON_EXECUTABLE_PATH" | "STALE_REFERENCE";
  scriptKey?: string;
  toolPath?: string;
} {
  // Check if command is a package.json script
  if (packageScripts[command]) {
    return {
      mappedTo: "package-script",
      executable: true,
      validationStatus: "VALID",
      scriptKey: command,
    };
  }

  // Check if command looks like a tool path
  if (isToolPath(command)) {
    const matchingPath = toolPaths.find((p) => p === command || p.endsWith(command));

    if (matchingPath) {
      return {
        mappedTo: "tool-path",
        executable: true,
        validationStatus: "VALID",
        toolPath: matchingPath,
      };
    }

    // Tool path reference but file doesn't exist
    return {
      mappedTo: "tool-path",
      executable: false,
      validationStatus: "NON_EXECUTABLE_PATH",
      toolPath: command,
    };
  }

  // Check for script patterns that might be missing
  // Patterns like taskpad:*, plan:*, pilot:*, test:*, verify:* suggest package.json scripts
  if (/^(taskpad:|plan:|pilot:|test:|verify:)/.test(command)) {
    return {
      mappedTo: "package-script",
      executable: false,
      validationStatus: "MISSING_SCRIPT",
      scriptKey: command,
    };
  }

  // Unknown command - no mapping
  return {
    mappedTo: "none",
    executable: false,
    validationStatus: "MISSING_MAPPING",
  };
}

// ============================================================================
// Parity Check Engine
// ============================================================================

/**
 * Sorts violations in canonical order for deterministic output.
 */
export function sortViolationsCanonical(violations: Violation[]): Violation[] {
  const ruleOrder = new Map<RuleId, number>();
  for (let i = 0; i < CANONICAL_VIOLATION_ORDER.length; i++) {
    ruleOrder.set(CANONICAL_VIOLATION_ORDER[i], i);
  }

  return [...violations].sort((a, b) => {
    // First by rule ID (canonical order)
    const orderA = ruleOrder.get(a.ruleId) ?? Number.MAX_SAFE_INTEGER;
    const orderB = ruleOrder.get(b.ruleId) ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }

    // Then by source (work-queue before verification-block)
    if (a.source !== b.source) {
      return a.source === "work-queue" ? -1 : 1;
    }

    // Finally by line number
    return a.sourceLine - b.sourceLine;
  });
}

/**
 * Runs the full parity check and generates the report.
 */
export function runParityCheck(
  taskpadAnalysis: TaskpadAnalysis,
  planAnalysis: PlanAnalysis,
  commandSurface: CommandSurface,
): { parityCheck: ParityCheck; violations: Violation[] } {
  const plannedCommands: PlannedCommand[] = [];
  const violations: Violation[] = [];

  // Process Work Queue planned items
  for (const item of taskpadAnalysis.plannedItems) {
    if (item.verifyCommands.length === 0) {
      // No Verify: clause - emit warning
      violations.push({
        ruleId: RULE_IDS.NO_COMMAND_REFERENCE,
        severity: "warning",
        source: "work-queue",
        sourceLine: item.lineNumber,
        sourceItem: item.rawText,
        command: "",
        details: {},
        remediation: `Add a Verify: clause to the planned item with a valid command reference, or ensure the active slice's Verification Commands block covers this item.`,
      });
      continue;
    }

    for (const command of item.verifyCommands) {
      const resolution = resolveCommand(command, commandSurface.packageScripts, commandSurface.toolPaths);

      const plannedCommand: PlannedCommand = {
        source: "work-queue",
        sourceLine: item.lineNumber,
        sourceItem: item.rawText,
        command,
        rawCommand: command,
        mappedTo: resolution.mappedTo,
        executable: resolution.executable,
        validationStatus: resolution.validationStatus,
      };

      plannedCommands.push(plannedCommand);

      // Generate violation if not executable
      if (!resolution.executable) {
        let ruleId: RuleId;
        let severity: "error" | "warning" = "error";
        let remediation: string;

        switch (resolution.validationStatus) {
          case "MISSING_SCRIPT":
            ruleId = RULE_IDS.MISSING_SCRIPT;
            remediation = `Add the missing script '${command}' to package.json or update the taskpad item to reference an existing command.`;
            break;
          case "NON_EXECUTABLE_PATH":
            ruleId = RULE_IDS.MISSING_TOOL_PATH;
            remediation = `Create the tool file '${command}' or update the taskpad item to reference an existing tool path.`;
            break;
          case "MISSING_MAPPING":
            ruleId = RULE_IDS.MISSING_SCRIPT;
            severity = "error";
            remediation = `The command '${command}' is not recognized as a package.json script or tool path. Add it to package.json scripts or use a direct tool path.`;
            break;
          default:
            ruleId = RULE_IDS.MISSING_SCRIPT;
            remediation = `Command '${command}' is not executable.`;
        }

        violations.push({
          ruleId,
          severity,
          source: "work-queue",
          sourceLine: item.lineNumber,
          sourceItem: item.rawText,
          command,
          details: {
            scriptKey: resolution.scriptKey,
            scriptExists: resolution.mappedTo === "package-script" && resolution.executable,
            toolPath: resolution.toolPath ?? null,
            toolExists: resolution.mappedTo === "tool-path" && resolution.executable,
          },
          remediation,
        });
      }
    }
  }

  // Process Verification Commands block
  for (const vc of planAnalysis.verificationCommands) {
    const resolution = resolveCommand(vc.command, commandSurface.packageScripts, commandSurface.toolPaths);

    const plannedCommand: PlannedCommand = {
      source: "verification-block",
      sourceLine: vc.lineNumber,
      sourceItem: `Verification: ${vc.command}`,
      command: vc.command,
      rawCommand: vc.command,
      mappedTo: resolution.mappedTo,
      executable: resolution.executable,
      validationStatus: resolution.validationStatus,
    };

    plannedCommands.push(plannedCommand);

    // Generate violation if not executable
    if (!resolution.executable) {
      let ruleId: RuleId;
      let severity: "error" | "warning" = "error";
      let remediation: string;

      switch (resolution.validationStatus) {
        case "MISSING_SCRIPT":
          ruleId = RULE_IDS.MISSING_SCRIPT;
          remediation = `Add the missing script '${vc.command}' to package.json.`;
          break;
        case "NON_EXECUTABLE_PATH":
          ruleId = RULE_IDS.MISSING_TOOL_PATH;
          remediation = `Create the tool file '${vc.command}' or reference an existing tool path.`;
          break;
        case "MISSING_MAPPING":
          ruleId = RULE_IDS.MISSING_SCRIPT;
          remediation = `The command '${vc.command}' is not recognized. Add it to package.json scripts.`;
          break;
        default:
          ruleId = RULE_IDS.MISSING_SCRIPT;
          remediation = `Command '${vc.command}' is not executable.`;
      }

      violations.push({
        ruleId,
        severity,
        source: "verification-block",
        sourceLine: vc.lineNumber,
        sourceItem: `Verification: ${vc.command}`,
        command: vc.command,
        details: {
          scriptKey: resolution.scriptKey,
          scriptExists: resolution.mappedTo === "package-script" && resolution.executable,
          toolPath: resolution.toolPath ?? null,
          toolExists: resolution.mappedTo === "tool-path" && resolution.executable,
        },
        remediation,
      });
    }
  }

  // Sort planned commands for deterministic output
  plannedCommands.sort((a, b) => {
    // First by source (work-queue before verification-block)
    if (a.source !== b.source) {
      return a.source === "work-queue" ? -1 : 1;
    }
    // Then by line number
    return a.sourceLine - b.sourceLine;
  });

  // Calculate summary
  const validCommands = plannedCommands.filter((pc) => pc.executable).length;
  const invalidCommands = plannedCommands.filter((pc) => !pc.executable).length;

  const parityCheck: ParityCheck = {
    plannedCommands,
    summary: {
      totalPlannedCommands: plannedCommands.length,
      validCommands,
      invalidCommands,
      invalidCommandCount: invalidCommands,
    },
  };

  // Sort violations in canonical order
  const sortedViolations = sortViolationsCanonical(violations);

  return { parityCheck, violations: sortedViolations };
}

// ============================================================================
// Output Formatting
// ============================================================================

function formatHumanReport(report: ParityReport): string {
  const lines: string[] = [];

  lines.push(`TASKPAD Planned Command Parity: ${report.status.toUpperCase()}`);
  lines.push("─────────────────────────────────────────");
  lines.push("Inputs:");
  lines.push(`  - taskpad: ${report.inputs.taskpadPath}`);
  lines.push(`  - plan: ${report.inputs.planPath}`);
  lines.push(`  - package: ${report.inputs.packagePath}`);
  lines.push("");
  lines.push(`Planned Items (TASKPAD):`);
  lines.push(`  - ${report.taskpadAnalysis.plannedCount} planned items found`);
  lines.push(`  - Unparenthesized markers: ${report.taskpadAnalysis.markerShapeStats.unparenthesizedCount} (${report.taskpadAnalysis.markerShapeStats.unparenthesizedPercentage}%)`);
  lines.push(`  - Parenthesized markers: ${report.taskpadAnalysis.markerShapeStats.parenthesizedCount} (${report.taskpadAnalysis.markerShapeStats.parenthesizedPercentage}%)`);
  lines.push(`  - Mixed styles: ${report.taskpadAnalysis.markerShapeStats.hasMixedStyles ? 'Yes' : 'No'}`);
  lines.push("");

  if (report.planAnalysis.activeSlice) {
    lines.push(`Active Slice (IMPLEMENTATION_PLAN):`);
    lines.push(`  - ${report.planAnalysis.activeSlice.heading}`);
    lines.push(`  - ${report.planAnalysis.verificationCommandCount} verification commands`);
    lines.push("");
  }

  lines.push(`Parity Check:`);
  lines.push(`  - Total planned commands: ${report.parityCheck.summary.totalPlannedCommands}`);
  lines.push(`  - Valid commands: ${report.parityCheck.summary.validCommands}`);
  lines.push(`  - Invalid commands: ${report.parityCheck.summary.invalidCommands}`);
  lines.push("");

  if (report.violations.length === 0) {
    lines.push(`Violations: 0`);
    lines.push("");
    lines.push(`All planned commands are executable from queue → slice → command surface.`);
  } else {
    lines.push(`Violations: ${report.violations.length}`);
    for (const v of report.violations) {
      lines.push(`  - [${v.ruleId}] ${v.source}:${v.sourceLine}: ${v.sourceItem} references '${v.command}' which does not exist in package.json`);
      lines.push(`    Remediation: ${v.remediation}`);
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Main Entry Point
// ============================================================================

function main(): void {
  const { taskpadPath, planPath, packagePath, format } = parseArgs(process.argv.slice(2));

  // Validate required arguments
  if (!taskpadPath) {
    console.error("Missing required --taskpad <path>");
    printHelp();
    process.exit(2);
  }

  if (!planPath) {
    console.error("Missing required --plan <path>");
    printHelp();
    process.exit(2);
  }

  if (!packagePath) {
    console.error("Missing required --package <path>");
    printHelp();
    process.exit(2);
  }

  // Resolve paths
  const resolvedTaskpadPath = resolve(taskpadPath);
  const resolvedPlanPath = resolve(planPath);
  const resolvedPackagePath = resolve(packagePath);

  // Read input files
  let taskpadMarkdown: string;
  let planMarkdown: string;
  let packageJsonContent: string;

  try {
    taskpadMarkdown = readFileSync(resolvedTaskpadPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to read TASKPAD file at ${resolvedTaskpadPath}: ${message}`);
    process.exit(2);
  }

  try {
    planMarkdown = readFileSync(resolvedPlanPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to read IMPLEMENTATION_PLAN file at ${resolvedPlanPath}: ${message}`);
    process.exit(2);
  }

  try {
    packageJsonContent = readFileSync(resolvedPackagePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to read package.json file at ${resolvedPackagePath}: ${message}`);
    process.exit(2);
  }

  // Parse inputs
  const taskpadAnalysis = parseTaskpadPlannedItems(taskpadMarkdown);
  const planAnalysis = parsePlanVerificationCommands(planMarkdown);
  const packageScripts = parsePackageScripts(packageJsonContent);
  const toolPaths = discoverToolPaths(resolve(resolvedPackagePath, ".."));

  const commandSurface: CommandSurface = {
    packageScripts,
    toolPaths,
  };

  // Run parity check
  const { parityCheck, violations } = runParityCheck(taskpadAnalysis, planAnalysis, commandSurface);

  // Determine status
  const errorViolations = violations.filter((v) => v.severity === "error");
  const status: "pass" | "fail" = errorViolations.length === 0 ? "pass" : "fail";

  // Build report
  const report: ParityReport = {
    status,
    inputs: {
      taskpadPath: resolvedTaskpadPath,
      planPath: resolvedPlanPath,
      packagePath: resolvedPackagePath,
    },
    taskpadAnalysis,
    planAnalysis,
    commandSurface,
    parityCheck,
    violations,
    timestamp: new Date().toISOString(),
  };

  // Output
  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHumanReport(report));
  }

  // Exit code
  if (status === "fail") {
    process.exit(1);
  }

  process.exit(0);
}

if (import.meta.main) {
  main();
}
