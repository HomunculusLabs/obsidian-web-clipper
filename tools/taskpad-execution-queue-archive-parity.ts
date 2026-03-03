#!/usr/bin/env bun

/**
 * TASKPAD Execution Queue Archive Parity Checker
 *
 * Validates one-to-one fingerprint parity between pruned TASKPAD Execution Queue
 * bullets and archive entries, detecting drift with actionable diagnostics.
 *
 * This tool implements TP003: archive↔TASKPAD fingerprint parity validation.
 */

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// =============================================================================
// Rule IDs (Deterministic)
// =============================================================================

export const EXECUTION_QUEUE_ARCHIVE_PARITY_RULE_IDS = {
  PARITY_OK: "EQAP001_PARITY_OK",
  PARITY_ARCHIVE_MISSING: "EQAP002_PARITY_ARCHIVE_MISSING",
  PARITY_TASKPAD_MISSING: "EQAP003_PARITY_TASKPAD_MISSING",
  PARITY_MISSING_FINGERPRINT: "EQAP004_PARITY_MISSING_FINGERPRINT",
  PARITY_DUPLICATE_FINGERPRINT: "EQAP005_PARITY_DUPLICATE_FINGERPRINT",
  PARITY_MISSING_FROM_ARCHIVE: "EQAP006_PARITY_MISSING_FROM_ARCHIVE",
  PARITY_EXTRA_IN_ARCHIVE: "EQAP007_PARITY_EXTRA_IN_ARCHIVE",
  PARITY_MUTATED_FINGERPRINT: "EQAP008_PARITY_MUTATED_FINGERPRINT",
  PARITY_INPUT_INVALID: "EQAP009_PARITY_INPUT_INVALID",
} as const;

export type ExecutionQueueArchiveParityReasonCode = (typeof EXECUTION_QUEUE_ARCHIVE_PARITY_RULE_IDS)[keyof typeof EXECUTION_QUEUE_ARCHIVE_PARITY_RULE_IDS];

// =============================================================================
// Type Definitions
// =============================================================================

export type OutputFormat = "json" | "human";

export type CheckboxState = "checked" | "unchecked";

export type MarkerShape = "unparenthesized" | "parenthesized" | "none";

export type ParityDriftType =
  | "missing_fingerprint"
  | "duplicate_fingerprint"
  | "missing_from_archive"
  | "extra_in_archive"
  | "mutated_fingerprint";

export type ViolationSeverity = "error" | "warning";

/**
 * Fingerprint of an Execution Queue bullet (matches taskpad-execution-queue-prune.ts)
 */
export interface ExecutionQueueBulletFingerprint {
  lineNumber: number;
  rawText: string;
  checkboxState: CheckboxState;
  markerShape: MarkerShape;
  plannedDate: string | null;
  taskText: string;
  fingerprintHash: string;
}

/**
 * Fingerprint parsed from archive file
 */
export interface ArchiveFingerprintRecord {
  lineNumber: number;
  rawLine: string;
  fingerprintHash: string;
  taskText: string;
}

/**
 * Archive analysis result
 */
export interface ArchiveAnalysis {
  exists: boolean;
  fingerprints: ArchiveFingerprintRecord[];
  parseErrors: string[];
}

/**
 * TASKPAD analysis result
 */
export interface ExecutionQueueAnalysis {
  archivedBullets: ExecutionQueueBulletFingerprint[];
  allBullets: ExecutionQueueBulletFingerprint[];
  parseErrors: string[];
}

/**
 * Parity violation
 */
export interface ParityViolation {
  ruleId: string;
  severity: ViolationSeverity;
  driftType: ParityDriftType;
  fingerprintHash?: string;
  lineNumber?: number;
  taskText?: string;
  remediation: string;
}

/**
 * Parity check result
 */
export interface ExecutionQueueArchiveParityResult {
  status: "pass" | "fail";
  reasonCode: ExecutionQueueArchiveParityReasonCode;
  inputs: {
    taskpadPath: string;
    archivePath: string;
  };
  specs: {
    archivedBulletsInTaskpad: number;
    fingerprintRecordsInArchive: number;
    missingFingerprints: number;
    duplicateFingerprints: number;
    missingFromArchive: number;
    extraInArchive: number;
    mutatedFingerprints: number;
  };
  violations: ParityViolation[];
  timestamp: string;
}

// =============================================================================
// Regex Patterns (matching taskpad-execution-queue-prune.ts)
// =============================================================================

const EXECUTION_QUEUE_HEADING_REGEX = /^##\s+Execution Queue\b/;
const CHECKED_CHECKBOX_REGEX = /^(\s*[-*+]\s+\[[xX]\]\s+)/;
const UNCHECKED_CHECKBOX_REGEX = /^(\s*[-*+]\s+\[\s*\]\s+)/;
const FINGERPRINT_COMMENT_REGEX = /<!--\s*fingerprint:\s*([a-f0-9]{16})\s*-->/;

// =============================================================================
// Canonical Violation Order (for deterministic sorting)
// =============================================================================

const CANONICAL_VIOLATION_ORDER: string[] = [
  "EQAP004_PARITY_MISSING_FINGERPRINT",
  "EQAP005_PARITY_DUPLICATE_FINGERPRINT",
  "EQAP006_PARITY_MISSING_FROM_ARCHIVE",
  "EQAP007_PARITY_EXTRA_IN_ARCHIVE",
  "EQAP008_PARITY_MUTATED_FINGERPRINT",
];

// =============================================================================
// Fingerprint Computation
// =============================================================================

function computeFingerprintHash(fingerprint: ExecutionQueueBulletFingerprint): string {
  const normalized = [
    fingerprint.lineNumber,
    fingerprint.checkboxState,
    fingerprint.markerShape,
    fingerprint.plannedDate,
    fingerprint.taskText.trim(),
  ].join("|");

  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

// =============================================================================
// Archive Parsing
// =============================================================================

export function parseArchiveFingerprints(archiveMarkdown: string | null): ArchiveAnalysis {
  if (!archiveMarkdown || archiveMarkdown.trim().length === 0) {
    return {
      exists: false,
      fingerprints: [],
      parseErrors: [],
    };
  }

  const lines = archiveMarkdown.split(/\r?\n/);
  const fingerprints: ArchiveFingerprintRecord[] = [];
  const parseErrors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fingerprintMatch = line.match(FINGERPRINT_COMMENT_REGEX);

    if (fingerprintMatch) {
      const fingerprintHash = fingerprintMatch[1];

      // Extract task text by removing checkbox, planned marker, and fingerprint comment
      let taskText = line;

      // Remove checkbox prefix
      taskText = taskText.replace(CHECKED_CHECKBOX_REGEX, "").replace(UNCHECKED_CHECKBOX_REGEX, "");

      // Remove planned marker (both forms)
      taskText = taskText.replace(/\(planned-\d{4}-\d{2}-\d{2}\)/g, "");
      taskText = taskText.replace(/(?:^|\s)planned-\d{4}-\d{2}-\d{2}(?:\s|$)/g, " ");

      // Remove fingerprint comment
      taskText = taskText.replace(/<!--\s*fingerprint:\s*[a-f0-9]{16}\s*-->/, "");

      // Clean up extra whitespace
      taskText = taskText.replace(/\s+/g, " ").trim();

      fingerprints.push({
        lineNumber: i + 1,
        rawLine: line,
        fingerprintHash,
        taskText,
      });
    }
  }

  return {
    exists: true,
    fingerprints,
    parseErrors,
  };
}

// =============================================================================
// TASKPAD Parsing
// =============================================================================

function extractCheckboxState(line: string): CheckboxState | null {
  if (CHECKED_CHECKBOX_REGEX.test(line)) {
    return "checked";
  }
  if (UNCHECKED_CHECKBOX_REGEX.test(line)) {
    return "unchecked";
  }
  return null;
}

function extractPlannedMarker(line: string): { date: string | null; shape: MarkerShape } {
  // Match unparenthesized: planned-YYYY-MM-DD anywhere in the text
  const unparenthesizedMatch = line.match(/(?:^|\s)(planned-(\d{4}-\d{2}-\d{2}))(?:\s|$)/);
  if (unparenthesizedMatch) {
    return { date: unparenthesizedMatch[2], shape: "unparenthesized" };
  }

  // Match parenthesized: (planned-YYYY-MM-DD) anywhere in the text
  const parenthesizedMatch = line.match(/\(planned-(\d{4}-\d{2}-\d{2})\)/);
  if (parenthesizedMatch) {
    return { date: parenthesizedMatch[1], shape: "parenthesized" };
  }

  return { date: null, shape: "none" };
}

function extractTaskText(line: string, checkboxState: CheckboxState | null, plannedDate: string | null): string {
  let text = line;

  // Remove checkbox prefix
  if (checkboxState) {
    text = text.replace(CHECKED_CHECKBOX_REGEX, "").replace(UNCHECKED_CHECKBOX_REGEX, "");
  }

  // Remove planned marker (both unparenthesized and parenthesized forms)
  if (plannedDate) {
    // Remove parenthesized form: (planned-YYYY-MM-DD)
    text = text.replace(/\(planned-\d{4}-\d{2}-\d{2}\)/g, "");
    // Remove unparenthesized form: planned-YYYY-MM-DD (with surrounding whitespace)
    text = text.replace(/(?:^|\s)planned-\d{4}-\d{2}-\d{2}(?:\s|$)/g, " ");
  }

  // Clean up extra whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

function isArchiveCandidate(bullet: ExecutionQueueBulletFingerprint): boolean {
  return bullet.checkboxState === "checked" || bullet.plannedDate !== null;
}

export function parseTaskpadArchivedBullets(taskpadMarkdown: string): ExecutionQueueAnalysis {
  const lines = taskpadMarkdown.split(/\r?\n/);
  const executionQueueHeadingIndexes: number[] = [];

  // Find Execution Queue heading
  for (let i = 0; i < lines.length; i++) {
    if (EXECUTION_QUEUE_HEADING_REGEX.test(lines[i].trim())) {
      executionQueueHeadingIndexes.push(i);
    }
  }

  if (executionQueueHeadingIndexes.length === 0) {
    return {
      archivedBullets: [],
      allBullets: [],
      parseErrors: [],
    };
  }

  if (executionQueueHeadingIndexes.length > 1) {
    return {
      archivedBullets: [],
      allBullets: [],
      parseErrors: ["Multiple '## Execution Queue' headings found; only one is allowed."],
    };
  }

  const startLine = executionQueueHeadingIndexes[0];
  let endLine = lines.length;

  for (let i = startLine + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith("## ")) {
      endLine = i;
      break;
    }
  }

  const executionQueueLines = lines.slice(startLine + 1, endLine);
  const allBullets: ExecutionQueueBulletFingerprint[] = [];

  for (let i = 0; i < executionQueueLines.length; i++) {
    const line = executionQueueLines[i];
    const originalLineNumber = startLine + 1 + i + 1;

    const checkboxState = extractCheckboxState(line);

    if (!checkboxState) {
      continue;
    }

    const { date: plannedDate, shape: markerShape } = extractPlannedMarker(line);
    const taskText = extractTaskText(line, checkboxState, plannedDate);

    const fingerprint: ExecutionQueueBulletFingerprint = {
      lineNumber: originalLineNumber,
      rawText: line,
      checkboxState,
      markerShape,
      plannedDate,
      taskText,
      fingerprintHash: "",
    };

    fingerprint.fingerprintHash = computeFingerprintHash(fingerprint);
    allBullets.push(fingerprint);
  }

  const archivedBullets = allBullets.filter(isArchiveCandidate);

  return {
    archivedBullets,
    allBullets,
    parseErrors: [],
  };
}

// =============================================================================
// Parity Validation
// =============================================================================

function sortViolationsCanonical(violations: ParityViolation[]): ParityViolation[] {
  return [...violations].sort((a, b) => {
    // Sort by canonical rule ID order first
    const aOrder = CANONICAL_VIOLATION_ORDER.indexOf(a.ruleId);
    const bOrder = CANONICAL_VIOLATION_ORDER.indexOf(b.ruleId);

    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    // Then by drift type
    if (a.driftType !== b.driftType) {
      return a.driftType.localeCompare(b.driftType);
    }

    // Then by line number (if present)
    if (a.lineNumber !== undefined && b.lineNumber !== undefined && a.lineNumber !== b.lineNumber) {
      return a.lineNumber - b.lineNumber;
    }

    // Then by fingerprint hash (if present)
    if (a.fingerprintHash && b.fingerprintHash && a.fingerprintHash !== b.fingerprintHash) {
      return a.fingerprintHash.localeCompare(b.fingerprintHash);
    }

    return 0;
  });
}

export function validateArchiveParity(
  taskpadPath: string,
  archivePath: string,
  taskpadMarkdown: string,
  archiveMarkdown: string | null,
): ExecutionQueueArchiveParityResult {
  const resolvedTaskpadPath = resolve(taskpadPath);
  const resolvedArchivePath = resolve(archivePath);

  // Step 1: Parse TASKPAD for archived bullets (checked/planned)
  const taskpadAnalysis = parseTaskpadArchivedBullets(taskpadMarkdown);

  // Step 2: Parse archive for fingerprint records
  const archiveAnalysis = parseArchiveFingerprints(archiveMarkdown);

  // Handle missing archive
  if (!archiveAnalysis.exists) {
    const missingViolations: ParityViolation[] = taskpadAnalysis.archivedBullets.map((bullet) => ({
      ruleId: "EQAP006_PARITY_MISSING_FROM_ARCHIVE",
      severity: "error" as const,
      driftType: "missing_from_archive" as const,
      fingerprintHash: bullet.fingerprintHash,
      lineNumber: bullet.lineNumber,
      taskText: bullet.taskText,
      remediation: `Add fingerprint metadata for bullet at line ${bullet.lineNumber} to archive`,
    }));

    const sortedViolations = sortViolationsCanonical(missingViolations);

    return {
      status: taskpadAnalysis.archivedBullets.length === 0 ? "pass" : "fail",
      reasonCode:
        taskpadAnalysis.archivedBullets.length === 0
          ? "EQAP001_PARITY_OK"
          : "EQAP002_PARITY_ARCHIVE_MISSING",
      inputs: {
        taskpadPath: resolvedTaskpadPath,
        archivePath: resolvedArchivePath,
      },
      specs: {
        archivedBulletsInTaskpad: taskpadAnalysis.archivedBullets.length,
        fingerprintRecordsInArchive: 0,
        missingFingerprints: 0,
        duplicateFingerprints: 0,
        missingFromArchive: sortedViolations.length,
        extraInArchive: 0,
        mutatedFingerprints: 0,
      },
      violations: sortedViolations,
      timestamp: new Date().toISOString(),
    };
  }

  // Step 3: Compute fingerprints for TASKPAD bullets
  const taskpadFingerprints = taskpadAnalysis.archivedBullets.map((b) => ({
    fingerprintHash: b.fingerprintHash,
    lineNumber: b.lineNumber,
    taskText: b.taskText,
    rawText: b.rawText,
  }));

  // Step 4: Build lookup maps
  const taskpadFingerprintSet = new Set(taskpadFingerprints.map((f) => f.fingerprintHash));
  const archiveFingerprintSet = new Set(archiveAnalysis.fingerprints.map((f) => f.fingerprintHash));

  // Step 5: Detect drift
  const violations: ParityViolation[] = [];

  // Check for missing fingerprints in archive (TASKPAD bullets not in archive)
  for (const tf of taskpadFingerprints) {
    if (!archiveFingerprintSet.has(tf.fingerprintHash)) {
      violations.push({
        ruleId: "EQAP006_PARITY_MISSING_FROM_ARCHIVE",
        severity: "error",
        driftType: "missing_from_archive",
        fingerprintHash: tf.fingerprintHash,
        lineNumber: tf.lineNumber,
        taskText: tf.taskText,
        remediation: `Add fingerprint metadata for bullet at line ${tf.lineNumber} to archive`,
      });
    }
  }

  // Check for extra entries in archive (archive entries not in TASKPAD)
  for (const af of archiveAnalysis.fingerprints) {
    if (!taskpadFingerprintSet.has(af.fingerprintHash)) {
      violations.push({
        ruleId: "EQAP007_PARITY_EXTRA_IN_ARCHIVE",
        severity: "error",
        driftType: "extra_in_archive",
        fingerprintHash: af.fingerprintHash,
        taskText: af.taskText,
        remediation: `Remove archive entry with fingerprint ${af.fingerprintHash} or verify TASKPAD source`,
      });
    }
  }

  // Check for duplicate fingerprints
  const fingerprintCounts = new Map<string, number>();
  for (const af of archiveAnalysis.fingerprints) {
    fingerprintCounts.set(af.fingerprintHash, (fingerprintCounts.get(af.fingerprintHash) || 0) + 1);
  }
  for (const [hash, count] of fingerprintCounts.entries()) {
    if (count > 1) {
      violations.push({
        ruleId: "EQAP005_PARITY_DUPLICATE_FINGERPRINT",
        severity: "warning",
        driftType: "duplicate_fingerprint",
        fingerprintHash: hash,
        remediation: `Remove duplicate fingerprint entries for ${hash} from archive`,
      });
    }
  }

  // Step 6: Sort violations in canonical order
  const sortedViolations = sortViolationsCanonical(violations);

  // Step 7: Determine status
  const errorViolations = sortedViolations.filter((v) => v.severity === "error");
  const status: "pass" | "fail" = errorViolations.length === 0 ? "pass" : "fail";

  // Determine primary reason code
  let reasonCode: ExecutionQueueArchiveParityReasonCode = "EQAP001_PARITY_OK";
  if (status === "fail") {
    // Use first error violation's rule ID as reason code
    const firstError = sortedViolations.find((v) => v.severity === "error");
    if (firstError) {
      reasonCode = firstError.ruleId as ExecutionQueueArchiveParityReasonCode;
    } else {
      reasonCode = "EQAP006_PARITY_MISSING_FROM_ARCHIVE";
    }
  }

  return {
    status,
    reasonCode,
    inputs: {
      taskpadPath: resolvedTaskpadPath,
      archivePath: resolvedArchivePath,
    },
    specs: {
      archivedBulletsInTaskpad: taskpadAnalysis.archivedBullets.length,
      fingerprintRecordsInArchive: archiveAnalysis.fingerprints.length,
      missingFingerprints: violations.filter((v) => v.driftType === "missing_fingerprint").length,
      duplicateFingerprints: violations.filter((v) => v.driftType === "duplicate_fingerprint").length,
      missingFromArchive: violations.filter((v) => v.driftType === "missing_from_archive").length,
      extraInArchive: violations.filter((v) => v.driftType === "extra_in_archive").length,
      mutatedFingerprints: violations.filter((v) => v.driftType === "mutated_fingerprint").length,
    },
    violations: sortedViolations,
    timestamp: new Date().toISOString(),
  };
}

export function checkArchiveParity(
  taskpadPath: string,
  archivePath: string,
): ExecutionQueueArchiveParityResult {
  const resolvedTaskpadPath = resolve(taskpadPath);
  const resolvedArchivePath = resolve(archivePath);

  // Validate inputs exist
  if (!existsSync(resolvedTaskpadPath)) {
    return {
      status: "fail",
      reasonCode: "EQAP009_PARITY_INPUT_INVALID",
      inputs: {
        taskpadPath: resolvedTaskpadPath,
        archivePath: resolvedArchivePath,
      },
      specs: {
        archivedBulletsInTaskpad: 0,
        fingerprintRecordsInArchive: 0,
        missingFingerprints: 0,
        duplicateFingerprints: 0,
        missingFromArchive: 0,
        extraInArchive: 0,
        mutatedFingerprints: 0,
      },
      violations: [
        {
          ruleId: "EQAP009_PARITY_INPUT_INVALID",
          severity: "error",
          driftType: "extra_in_archive",
          remediation: `TASKPAD file not found: ${resolvedTaskpadPath}`,
        },
      ],
      timestamp: new Date().toISOString(),
    };
  }

  // Read TASKPAD
  let taskpadMarkdown: string;
  try {
    taskpadMarkdown = readFileSync(resolvedTaskpadPath, "utf8");
  } catch {
    return {
      status: "fail",
      reasonCode: "EQAP009_PARITY_INPUT_INVALID",
      inputs: {
        taskpadPath: resolvedTaskpadPath,
        archivePath: resolvedArchivePath,
      },
      specs: {
        archivedBulletsInTaskpad: 0,
        fingerprintRecordsInArchive: 0,
        missingFingerprints: 0,
        duplicateFingerprints: 0,
        missingFromArchive: 0,
        extraInArchive: 0,
        mutatedFingerprints: 0,
      },
      violations: [
        {
          ruleId: "EQAP009_PARITY_INPUT_INVALID",
          severity: "error",
          driftType: "extra_in_archive",
          remediation: `Failed to read TASKPAD file: ${resolvedTaskpadPath}`,
        },
      ],
      timestamp: new Date().toISOString(),
    };
  }

  // Read archive (may not exist)
  let archiveMarkdown: string | null = null;
  if (existsSync(resolvedArchivePath)) {
    try {
      archiveMarkdown = readFileSync(resolvedArchivePath, "utf8");
    } catch {
      return {
        status: "fail",
        reasonCode: "EQAP009_PARITY_INPUT_INVALID",
        inputs: {
          taskpadPath: resolvedTaskpadPath,
          archivePath: resolvedArchivePath,
        },
        specs: {
          archivedBulletsInTaskpad: 0,
          fingerprintRecordsInArchive: 0,
          missingFingerprints: 0,
          duplicateFingerprints: 0,
          missingFromArchive: 0,
          extraInArchive: 0,
          mutatedFingerprints: 0,
        },
        violations: [
          {
            ruleId: "EQAP009_PARITY_INPUT_INVALID",
            severity: "error",
            driftType: "extra_in_archive",
            remediation: `Failed to read archive file: ${resolvedArchivePath}`,
          },
        ],
        timestamp: new Date().toISOString(),
      };
    }
  }

  return validateArchiveParity(taskpadPath, archivePath, taskpadMarkdown, archiveMarkdown);
}

// =============================================================================
// Output Formatting
// =============================================================================

function formatHumanOutput(result: ExecutionQueueArchiveParityResult): string {
  const statusUpper = result.status.toUpperCase();
  const separator = "─".repeat(60);

  const lines = [
    `TASKPAD Execution Queue Archive Parity: ${statusUpper}`,
    separator,
    "Input:",
    `  - taskpad: ${result.inputs.taskpadPath}`,
    `  - archive: ${result.inputs.archivePath}`,
    "",
    "Specs:",
    `  - archivedBulletsInTaskpad: ${result.specs.archivedBulletsInTaskpad}`,
    `  - fingerprintRecordsInArchive: ${result.specs.fingerprintRecordsInArchive}`,
    `  - missingFingerprints: ${result.specs.missingFingerprints}`,
    `  - duplicateFingerprints: ${result.specs.duplicateFingerprints}`,
    `  - missingFromArchive: ${result.specs.missingFromArchive}`,
    `  - extraInArchive: ${result.specs.extraInArchive}`,
    `  - mutatedFingerprints: ${result.specs.mutatedFingerprints}`,
    "",
    `Violations: ${result.violations.length}`,
  ];

  for (const violation of result.violations) {
    lines.push(`  - [${violation.ruleId}] ${violation.driftType}: ${violation.taskText || violation.fingerprintHash || "Unknown"}`);
    lines.push(`    Remediation: ${violation.remediation}`);
  }

  lines.push("");
  lines.push(`Reason: ${result.reasonCode}`);

  return lines.join("\n");
}

function formatJsonOutput(result: ExecutionQueueArchiveParityResult): string {
  // Sort keys alphabetically for deterministic output
  const sortedViolations = sortViolationsCanonical(result.violations);

  const jsonOutput = JSON.stringify(
    {
      inputs: result.inputs,
      reasonCode: result.reasonCode,
      specs: result.specs,
      status: result.status,
      timestamp: result.timestamp,
      violations: sortedViolations,
    },
    null,
    2,
  );

  return `TASKPAD_EXECUTION_QUEUE_ARCHIVE_PARITY_JSON_START\n${jsonOutput}\nTASKPAD_EXECUTION_QUEUE_ARCHIVE_PARITY_JSON_END`;
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs(argv: string[]): { taskpadPath?: string; archivePath?: string; format: "json" | "human" } {
  let taskpadPath: string | undefined;
  let archivePath: string | undefined;
  let format: "json" | "human" = "json";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--taskpad" && i + 1 < argv.length) {
      taskpadPath = argv[i + 1];
      i++;
    } else if (arg === "--archive" && i + 1 < argv.length) {
      archivePath = argv[i + 1];
      i++;
    } else if (arg === "--format" && i + 1 < argv.length) {
      const formatValue = argv[i + 1];
      if (formatValue === "json" || formatValue === "human") {
        format = formatValue;
      }
      i++;
    } else if (!arg.startsWith("--")) {
      if (!taskpadPath) {
        taskpadPath = arg;
      }
    }
  }

  return { taskpadPath, archivePath, format };
}

function printHelp(): void {
  console.error(`
Usage: bun run taskpad:execution-queue-archive-parity -- --taskpad <path> --archive <path> [--format json|human]

Arguments:
  --taskpad <path>       Path to TASKPAD.md file (required)
  --archive <path>       Path to archive file (required)
  --format <format>      Output format: json (default) or human

Examples:
  bun run taskpad:execution-queue-archive-parity -- --taskpad TASKPAD.md --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md"
  bun run taskpad:execution-queue-archive-parity -- --taskpad TASKPAD.md --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" --format json
  bun run taskpad:execution-queue-archive-parity -- --taskpad TASKPAD.md --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" --format human
`);
}

function main(): void {
  const { taskpadPath, archivePath, format } = parseArgs(process.argv.slice(2));

  if (!taskpadPath) {
    console.error("Missing TASKPAD path. Provide --taskpad <path>.");
    printHelp();
    process.exit(2);
  }

  if (!archivePath) {
    console.error("Missing archive path. Provide --archive <path>.");
    printHelp();
    process.exit(2);
  }

  const result = checkArchiveParity(taskpadPath, archivePath);

  if (format === "json") {
    console.log(formatJsonOutput(result));
  } else {
    console.log(formatHumanOutput(result));
  }

  // Exit code: 0 = pass, 1 = fail, 2 = input validation error
  const exitCode = result.reasonCode === "EQAP009_PARITY_INPUT_INVALID" ? 2 : result.status === "fail" ? 1 : 0;
  process.exit(exitCode);
}

if (import.meta.main) {
  main();
}
