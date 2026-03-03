#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ACTIVE_SLICE_HEADING_REGEX = /^##\s+TASKPAD Intake Slice\b/;
const H2_HEADING_REGEX = /^##\s+/;
const H3_HEADING_REGEX = /^###\s+/;
const TASK_GRAPH_HEADING = "### Task Graph";
const VERIFICATION_COMMANDS_HEADING = "### Verification Commands";
const TASK_CHECKBOX_LINE_REGEX = /^- \[[ xX]\] /;
const TP_TASK_LINE_REGEX = /^- \[[ xX]\] \*\*TP(\d{3})\*\*:\s+.+/;

export const RULE_IDS = {
  ACTIVE_SLICE_MISSING: "PLI001_ACTIVE_SLICE_MISSING",
  REQUIRED_HEADING_MISSING: "PLI002_REQUIRED_HEADING_MISSING",
  REQUIRED_HEADING_DUPLICATE: "PLI003_REQUIRED_HEADING_DUPLICATE",
  TP_FORMAT_INVALID: "PLI004_TP_FORMAT_INVALID",
  TP_ORDER_INVALID: "PLI005_TP_ORDER_INVALID",
  TP_DUPLICATE_ID: "PLI006_TP_DUPLICATE_ID",
  VERIFICATION_BLOCK_MISSING: "PLI007_VERIFICATION_BLOCK_MISSING",
  VERIFICATION_BLOCK_EMPTY: "PLI008_VERIFICATION_BLOCK_EMPTY",
  NO_UNCHECKED_TP_TASKS: "PLI009_NO_UNCHECKED_TP_TASKS",
  AMBIGUOUS_ACTIVE_SLICE: "PLI010_AMBIGUOUS_ACTIVE_SLICE",
} as const;

/**
 * Canonical order for violation rule IDs in diagnostics output.
 * Ensures deterministic, stable ordering across runs for machine-readable output.
 */
const CANONICAL_VIOLATION_ORDER = [
  RULE_IDS.AMBIGUOUS_ACTIVE_SLICE,
  RULE_IDS.ACTIVE_SLICE_MISSING,
  RULE_IDS.REQUIRED_HEADING_MISSING,
  RULE_IDS.REQUIRED_HEADING_DUPLICATE,
  RULE_IDS.TP_FORMAT_INVALID,
  RULE_IDS.TP_ORDER_INVALID,
  RULE_IDS.TP_DUPLICATE_ID,
  RULE_IDS.VERIFICATION_BLOCK_MISSING,
  RULE_IDS.VERIFICATION_BLOCK_EMPTY,
  RULE_IDS.NO_UNCHECKED_TP_TASKS,
] as const;

export const REQUIRED_SECTION_HEADINGS = [
  "### Distilled Scope",
  "### RepoPrompt Builder Context",
  "### Task Graph",
  "### Acceptance Criteria",
  "### Verification Commands",
] as const;

export interface ActiveTaskpadSlice {
  heading: string;
  startLine: number;
  endLine: number;
  markdown: string;
}

export interface RequiredSectionValidationResult {
  missingHeadings: string[];
  duplicateHeadings: string[];
  foundHeadings: string[];
  passes: boolean;
}

export interface TaskGraphValidationResult {
  invalidTaskLines: string[];
  duplicateTaskIds: string[];
  outOfOrderPairs: Array<{ previous: string; current: string }>;
  parsedTaskIds: string[];
  passes: boolean;
}

export interface VerificationBlockValidationResult {
  passes: boolean;
  hasBashFence: boolean;
  hasClosingFence: boolean;
  runnableCommandLines: string[];
}

interface IntegrityFailure {
  ruleId: string;
  summary: string;
  remediation: string;
  details?: string[];
  detailsRecord?: Record<string, unknown>;
}

interface CliOptions {
  planPath?: string;
  strictActiveSlice: boolean;
  format: "human" | "json";
}

interface IntegrityReport {
  status: "pass" | "fail";
  mode: "base" | "strict";
  activeSlice?: {
    heading: string;
    line: number;
    hasUncheckedTasks?: boolean;
    totalTpTasks?: number;
    uncheckedTpTasks?: number;
    checkedTpTasks?: number;
  };
  violations: IntegrityFailure[];
  baseViolations: IntegrityFailure[];
  validatedRules: string[];
}

function printHelp(): void {
  console.log(`
IMPLEMENTATION_PLAN Integrity Checker

USAGE:
  bun run tools/implementation-plan-integrity.ts --plan <path>
  bun run tools/implementation-plan-integrity.ts <path>

OPTIONS:
  --plan <path>                Path to IMPLEMENTATION_PLAN markdown file (required unless positional path is provided)
  --strict-active-slice        Enable strict mode that fails when newest slice has zero unchecked TP tasks or ambiguous activeness
  --format <human|json>        Output format (default: human)
  --help, -h                   Show this help message
`);
}

function parseArgs(argv: string[]): CliOptions {
  let planPath: string | undefined;
  let strictActiveSlice = false;
  let format: "human" | "json" = "human";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--plan") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --plan");
        process.exit(1);
      }
      planPath = value;
      continue;
    }

    if (arg === "--strict-active-slice") {
      strictActiveSlice = true;
      continue;
    }

    if (arg === "--format") {
      i++;
      const value = argv[i];
      if (!value || (value !== "human" && value !== "json")) {
        console.error("Invalid value for --format. Must be 'human' or 'json'.");
        process.exit(1);
      }
      format = value;
      continue;
    }

    if (!arg.startsWith("-") && !planPath) {
      planPath = arg;
      continue;
    }

    console.error(`Unknown argument: ${arg}`);
    printHelp();
    process.exit(1);
  }

  return { planPath, strictActiveSlice, format };
}

export function isolateNewestTaskpadIntakeSlice(planMarkdown: string): ActiveTaskpadSlice | null {
  const lines = planMarkdown.split(/\r?\n/);

  const startIndex = lines.findIndex((line) => ACTIVE_SLICE_HEADING_REGEX.test(line.trim()));
  if (startIndex === -1) {
    return null;
  }

  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (H2_HEADING_REGEX.test(lines[i].trim())) {
      endIndex = i;
      break;
    }
  }

  return {
    heading: lines[startIndex].trim(),
    startLine: startIndex + 1,
    endLine: endIndex,
    markdown: lines.slice(startIndex, endIndex).join("\n"),
  };
}

export function validateRequiredSectionPresence(sliceMarkdown: string): RequiredSectionValidationResult {
  const lines = sliceMarkdown.split(/\r?\n/);

  const foundHeadings = lines
    .map((line) => line.trim())
    .filter((line) => H3_HEADING_REGEX.test(line));

  const headingCounts = new Map<string, number>();
  for (const heading of foundHeadings) {
    headingCounts.set(heading, (headingCounts.get(heading) ?? 0) + 1);
  }

  const missingHeadings = REQUIRED_SECTION_HEADINGS.filter(
    (requiredHeading) => !foundHeadings.includes(requiredHeading),
  );

  const duplicateHeadings = REQUIRED_SECTION_HEADINGS.filter(
    (requiredHeading) => (headingCounts.get(requiredHeading) ?? 0) > 1,
  );

  return {
    missingHeadings,
    duplicateHeadings,
    foundHeadings,
    passes: missingHeadings.length === 0 && duplicateHeadings.length === 0,
  };
}

function extractSectionLines(sliceMarkdown: string, heading: string): string[] {
  const lines = sliceMarkdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);

  if (headingIndex === -1) {
    return [];
  }

  const sectionLines: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("### ")) {
      break;
    }
    sectionLines.push(lines[i]);
  }

  return sectionLines;
}

function extractTaskGraphLines(sliceMarkdown: string): string[] {
  return extractSectionLines(sliceMarkdown, TASK_GRAPH_HEADING);
}

export function validateTaskGraphTaskLines(sliceMarkdown: string): TaskGraphValidationResult {
  const taskGraphLines = extractTaskGraphLines(sliceMarkdown);

  const invalidTaskLines: string[] = [];
  const parsedTaskIds: string[] = [];

  for (const rawLine of taskGraphLines) {
    const line = rawLine.trim();

    if (!TASK_CHECKBOX_LINE_REGEX.test(line)) {
      continue;
    }

    const match = line.match(TP_TASK_LINE_REGEX);
    if (!match) {
      invalidTaskLines.push(line);
      continue;
    }

    parsedTaskIds.push(`TP${match[1]}`);
  }

  const duplicateTaskIds: string[] = [];
  const seenIds = new Set<string>();
  for (const taskId of parsedTaskIds) {
    if (seenIds.has(taskId)) {
      duplicateTaskIds.push(taskId);
      continue;
    }
    seenIds.add(taskId);
  }

  const outOfOrderPairs: Array<{ previous: string; current: string }> = [];
  for (let i = 1; i < parsedTaskIds.length; i++) {
    const previous = Number.parseInt(parsedTaskIds[i - 1].slice(2), 10);
    const current = Number.parseInt(parsedTaskIds[i].slice(2), 10);

    if (current <= previous) {
      outOfOrderPairs.push({
        previous: parsedTaskIds[i - 1],
        current: parsedTaskIds[i],
      });
    }
  }

  return {
    invalidTaskLines,
    duplicateTaskIds,
    outOfOrderPairs,
    parsedTaskIds,
    passes: invalidTaskLines.length === 0 && duplicateTaskIds.length === 0 && outOfOrderPairs.length === 0,
  };
}

export function validateVerificationCommandsBlock(sliceMarkdown: string): VerificationBlockValidationResult {
  const verificationLines = extractSectionLines(sliceMarkdown, VERIFICATION_COMMANDS_HEADING);

  const fenceStartIndex = verificationLines.findIndex((line) => line.trim() === "```bash");

  if (fenceStartIndex === -1) {
    return {
      passes: false,
      hasBashFence: false,
      hasClosingFence: false,
      runnableCommandLines: [],
    };
  }

  const closingFenceIndex = verificationLines.findIndex(
    (line, index) => index > fenceStartIndex && line.trim() === "```",
  );

  if (closingFenceIndex === -1) {
    return {
      passes: false,
      hasBashFence: true,
      hasClosingFence: false,
      runnableCommandLines: [],
    };
  }

  const fencedLines = verificationLines.slice(fenceStartIndex + 1, closingFenceIndex);
  const runnableCommandLines = fencedLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  return {
    passes: runnableCommandLines.length > 0,
    hasBashFence: true,
    hasClosingFence: true,
    runnableCommandLines,
  };
}

export interface UncheckedTpTasksValidationResult {
  totalTpTasks: number;
  uncheckedTpTasks: number;
  checkedTpTasks: number;
  passes: boolean;
}

/**
 * Sorts violations in canonical order for deterministic output.
 * Maintains parity between JSON and human-readable formats.
 */
export function sortViolationsCanonical(violations: IntegrityFailure[]): IntegrityFailure[] {
  const ruleOrder = new Map<string, number>();
  for (let i = 0; i < CANONICAL_VIOLATION_ORDER.length; i++) {
    ruleOrder.set(CANONICAL_VIOLATION_ORDER[i], i);
  }

  return [...violations].sort((a, b) => {
    const orderA = ruleOrder.get(a.ruleId) ?? Number.MAX_SAFE_INTEGER;
    const orderB = ruleOrder.get(b.ruleId) ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB;
  });
}

export function validateUncheckedTpTasks(sliceMarkdown: string): UncheckedTpTasksValidationResult {
  const taskGraphLines = extractTaskGraphLines(sliceMarkdown);

  let totalTpTasks = 0;
  let uncheckedTpTasks = 0;

  for (const rawLine of taskGraphLines) {
    const line = rawLine.trim();

    if (!TASK_CHECKBOX_LINE_REGEX.test(line)) {
      continue;
    }

    const match = line.match(TP_TASK_LINE_REGEX);
    if (match) {
      totalTpTasks++;
      // Check if the task is unchecked: [ ]
      if (line.startsWith("- [ ]")) {
        uncheckedTpTasks++;
      }
    }
  }

  const checkedTpTasks = totalTpTasks - uncheckedTpTasks;

  return {
    totalTpTasks,
    uncheckedTpTasks,
    checkedTpTasks,
    passes: uncheckedTpTasks > 0,
  };
}

export interface ActiveSliceAmbiguityResult {
  candidateSlices: Array<{ heading: string; line: number; hasDate: boolean }>;
  firstCandidateMissingDate: boolean;
  passes: boolean;
}

export function validateActiveSliceAmbiguity(planMarkdown: string): ActiveSliceAmbiguityResult {
  const lines = planMarkdown.split(/\r?\n/);

  const candidateSlices: Array<{ heading: string; line: number; hasDate: boolean }> = [];
  const dateRegex = /\(\d{4}-\d{2}-\d{2}\)/;

  // Find the first H2 heading - this is the newest/active slice
  // We validate that this first slice is deterministically identifiable
  let foundFirstH2 = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();

    // Check if this is an H2 heading
    if (H2_HEADING_REGEX.test(trimmedLine)) {
      if (!foundFirstH2) {
        // This is the first H2 heading
        if (ACTIVE_SLICE_HEADING_REGEX.test(trimmedLine)) {
          const hasDate = dateRegex.test(trimmedLine);
          candidateSlices.push({
            heading: trimmedLine,
            line: i + 1,
            hasDate,
          });
          foundFirstH2 = true;
        } else {
          // First H2 is not a TASKPAD Intake Slice - this is ambiguous
          // We can't determine which slice is "active"
          break;
        }
      } else {
        // We've already found the first H2, stop
        break;
      }
    }
  }

  // Pass conditions:
  // 1. The first H2 is a TASKPAD Intake Slice (foundFirstH2 === true)
  // 2. The first slice has a valid date
  const passes = candidateSlices.length === 1 && candidateSlices[0].hasDate;

  return {
    candidateSlices,
    firstCandidateMissingDate: candidateSlices.length > 0 && !candidateSlices[0].hasDate,
    passes,
  };
}

function printFailures(activeSliceHeading: string, failures: IntegrityFailure[]): never {
  console.error("IMPLEMENTATION_PLAN integrity: FAIL");
  console.error(`- Active slice: ${activeSliceHeading}`);
  console.error("- Failing rules:");

  for (const failure of failures) {
    console.error(`  - [${failure.ruleId}] ${failure.summary}`);
    if (failure.details && failure.details.length > 0) {
      for (const detail of failure.details) {
        console.error(`    - ${detail}`);
      }
    }
    console.error(`    Remediation: ${failure.remediation}`);
  }

  process.exit(1);
}

function printFailures(activeSliceHeading: string, failures: IntegrityFailure[]): never {
  console.error("IMPLEMENTATION_PLAN integrity: FAIL");
  console.error(`- Active slice: ${activeSliceHeading}`);
  console.error("- Failing rules:");

  for (const failure of failures) {
    console.error(`  - [${failure.ruleId}] ${failure.summary}`);
    if (failure.details && failure.details.length > 0) {
      for (const detail of failure.details) {
        console.error(`    - ${detail}`);
      }
    }
    if (failure.detailsRecord) {
      for (const [key, value] of Object.entries(failure.detailsRecord)) {
        console.error(`    - ${key}: ${value}`);
      }
    }
    console.error(`    Remediation: ${failure.remediation}`);
  }

  process.exit(1);
}

function printJsonReport(report: IntegrityReport): never {
  // Sort violations in canonical order for deterministic machine-readable output
  const sortedReport: IntegrityReport = {
    ...report,
    violations: sortViolationsCanonical(report.violations),
    baseViolations: sortViolationsCanonical(report.baseViolations),
  };

  // Use JSON.stringify with a replacer to ensure key ordering is stable
  // Note: Node.js >= 12 preserves insertion order for object keys
  console.log(JSON.stringify(sortedReport, null, 2));
  process.exit(report.status === "pass" ? 0 : 1);
}

function printHumanReport(
  status: "pass" | "fail",
  mode: "base" | "strict",
  activeSlice: ActiveTaskpadSlice | null,
  failures: IntegrityFailure[],
  taskGraphValidation: TaskGraphValidationResult,
  verificationBlockValidation: VerificationBlockValidationResult,
  uncheckedTasksValidation?: UncheckedTpTasksValidationResult,
): never {
  if (status === "fail") {
    const sliceHeading = activeSlice?.heading || "(not found)";
    const sortedFailures = sortViolationsCanonical(failures);

    console.error("IMPLEMENTATION_PLAN integrity: FAIL");
    console.error(`- Mode: ${mode}`);
    console.error(`- Active slice: ${sliceHeading}`);
    console.error("- Failing rules:");

    for (const failure of sortedFailures) {
      console.error(`  - [${failure.ruleId}] ${failure.summary}`);
      if (failure.details && failure.details.length > 0) {
        for (const detail of failure.details) {
          console.error(`    - ${detail}`);
        }
      }
      if (failure.detailsRecord) {
        for (const [key, value] of Object.entries(failure.detailsRecord)) {
          console.error(`    - ${key}: ${value}`);
        }
      }
      console.error(`    Remediation: ${failure.remediation}`);
    }
    process.exit(1);
  }

  console.log("IMPLEMENTATION_PLAN integrity: PASS");
  console.log(`- Mode: ${mode}`);
  console.log(`- Active slice: ${activeSlice!.heading}`);
  console.log(`- Validated rules: ${Object.values(RULE_IDS).join(", ")}`);
  console.log("- Required sections present exactly once:");
  for (const heading of REQUIRED_SECTION_HEADINGS) {
    console.log(`  - ${heading}`);
  }
  console.log(`- TP task IDs (ascending, unique): ${taskGraphValidation.parsedTaskIds.join(", ") || "none found"}`);
  console.log(`- Verification commands in fenced bash block: ${verificationBlockValidation.runnableCommandLines.length}`);

  if (mode === "strict" && uncheckedTasksValidation) {
    console.log("- Strict mode checks:");
    console.log(`  - Total TP tasks: ${uncheckedTasksValidation.totalTpTasks}`);
    console.log(`  - Unchecked TP tasks: ${uncheckedTasksValidation.uncheckedTpTasks}`);
    console.log(`  - Checked TP tasks: ${uncheckedTasksValidation.checkedTpTasks}`);
  }

  process.exit(0);
}

function main(): void {
  const { planPath, strictActiveSlice, format } = parseArgs(process.argv.slice(2));

  if (!planPath) {
    console.error("Missing IMPLEMENTATION_PLAN path. Provide --plan <path> or a positional path.");
    printHelp();
    process.exit(1);
  }

  const resolvedPath = resolve(planPath);

  let markdown: string;
  try {
    markdown = readFileSync(resolvedPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to read IMPLEMENTATION_PLAN at ${resolvedPath}: ${message}`);
    process.exit(1);
  }

  const mode: "base" | "strict" = strictActiveSlice ? "strict" : "base";
  const violations: IntegrityFailure[] = [];
  const baseViolations: IntegrityFailure[] = [];
  const validatedRules = Object.values(RULE_IDS);

  // Check for active slice ambiguity first (strict mode only)
  if (strictActiveSlice) {
    const ambiguityValidation = validateActiveSliceAmbiguity(markdown);
    if (!ambiguityValidation.passes) {
      const failure: IntegrityFailure = {
        ruleId: RULE_IDS.AMBIGUOUS_ACTIVE_SLICE,
        summary: "Cannot deterministically identify the active TASKPAD intake slice.",
        remediation:
          "Ensure exactly one top-most H2 heading matches '## TASKPAD Intake Slice (<date>)' with a valid ISO date.",
        detailsRecord: {
          candidatesFound: ambiguityValidation.candidateSlices.length,
          sliceHeadings: ambiguityValidation.candidateSlices.map((s) => s.heading),
          firstHeadingLacksDate: ambiguityValidation.firstCandidateMissingDate,
        },
      };
      violations.push(failure);
      baseViolations.push(failure);
    }
  }

  const activeSlice = isolateNewestTaskpadIntakeSlice(markdown);
  if (!activeSlice) {
    const failure: IntegrityFailure = {
      ruleId: RULE_IDS.ACTIVE_SLICE_MISSING,
      summary: "No active TASKPAD intake slice heading was found.",
      remediation:
        "Add a top-most heading matching '## TASKPAD Intake Slice ...' and place current intake content under it.",
    };
    violations.push(failure);
    baseViolations.push(failure);

    const report: IntegrityReport = {
      status: "fail",
      mode,
      violations,
      baseViolations,
      validatedRules,
    };

    if (format === "json") {
      printJsonReport(report);
    }
    printFailures("(not found)", violations);
  }

  const requiredSectionValidation = validateRequiredSectionPresence(activeSlice!.markdown);
  if (requiredSectionValidation.missingHeadings.length > 0) {
    const failure: IntegrityFailure = {
      ruleId: RULE_IDS.REQUIRED_HEADING_MISSING,
      summary: "One or more required headings are missing from the active slice.",
      details: requiredSectionValidation.missingHeadings,
      remediation:
        "Add each missing heading exactly as specified in the integrity contract under docs/quality/implementation-plan-integrity.md.",
    };
    violations.push(failure);
    baseViolations.push(failure);
  }

  if (requiredSectionValidation.duplicateHeadings.length > 0) {
    const failure: IntegrityFailure = {
      ruleId: RULE_IDS.REQUIRED_HEADING_DUPLICATE,
      summary: "One or more required headings appear more than once in the active slice.",
      details: requiredSectionValidation.duplicateHeadings,
      remediation:
        "Keep exactly one instance of each required heading and move extra content under the canonical section.",
    };
    violations.push(failure);
    baseViolations.push(failure);
  }

  const taskGraphValidation = validateTaskGraphTaskLines(activeSlice!.markdown);
  if (taskGraphValidation.invalidTaskLines.length > 0) {
    const failure: IntegrityFailure = {
      ruleId: RULE_IDS.TP_FORMAT_INVALID,
      summary: "Task Graph contains malformed TP task lines.",
      details: taskGraphValidation.invalidTaskLines,
      remediation: "Rewrite each task line to match '- [ ] **TP###**: <task description>'.",
    };
    violations.push(failure);
    baseViolations.push(failure);
  }

  if (taskGraphValidation.outOfOrderPairs.length > 0) {
    const failure: IntegrityFailure = {
      ruleId: RULE_IDS.TP_ORDER_INVALID,
      summary: "TP IDs are not strictly ascending within Task Graph.",
      details: taskGraphValidation.outOfOrderPairs.map((pair) => `${pair.previous} -> ${pair.current}`),
      remediation: "Renumber or reorder task lines so TP IDs increase strictly (e.g., TP001, TP002, TP003).",
    };
    violations.push(failure);
    baseViolations.push(failure);
  }

  if (taskGraphValidation.duplicateTaskIds.length > 0) {
    const failure: IntegrityFailure = {
      ruleId: RULE_IDS.TP_DUPLICATE_ID,
      summary: "Duplicate TP IDs were detected in Task Graph.",
      details: taskGraphValidation.duplicateTaskIds,
      remediation: "Assign unique TP IDs so each task appears once.",
    };
    violations.push(failure);
    baseViolations.push(failure);
  }

  const verificationBlockValidation = validateVerificationCommandsBlock(activeSlice!.markdown);
  if (!verificationBlockValidation.hasBashFence || !verificationBlockValidation.hasClosingFence) {
    const details: string[] = [];
    if (!verificationBlockValidation.hasBashFence) {
      details.push("Missing opening bash fence: ```bash");
    }
    if (!verificationBlockValidation.hasClosingFence) {
      details.push("Missing closing code fence: ```");
    }

    const failure: IntegrityFailure = {
      ruleId: RULE_IDS.VERIFICATION_BLOCK_MISSING,
      summary: "Verification Commands section is missing a valid fenced bash block.",
      details,
      remediation: "Add one fenced bash block under '### Verification Commands' using ```bash ... ```.",
    };
    violations.push(failure);
    baseViolations.push(failure);
  } else if (!verificationBlockValidation.passes) {
    const failure: IntegrityFailure = {
      ruleId: RULE_IDS.VERIFICATION_BLOCK_EMPTY,
      summary: "Verification Commands bash block has no runnable command lines.",
      remediation: "Add at least one non-empty, non-comment command line (for example: bun run typecheck).",
    };
    violations.push(failure);
    baseViolations.push(failure);
  }

  let uncheckedTasksValidation: UncheckedTpTasksValidationResult | undefined;
  if (strictActiveSlice && violations.length === 0) {
    // Only check unchecked tasks if no other violations exist
    uncheckedTasksValidation = validateUncheckedTpTasks(activeSlice!.markdown);
    if (!uncheckedTasksValidation.passes) {
      const failure: IntegrityFailure = {
        ruleId: RULE_IDS.NO_UNCHECKED_TP_TASKS,
        summary: "Newest intake slice has no unchecked TP tasks.",
        remediation: "Archive the completed slice (via taskpad:plan-prune) or add new unchecked TP tasks to the active slice.",
        detailsRecord: {
          totalTpTasks: uncheckedTasksValidation.totalTpTasks,
          uncheckedTpTasks: uncheckedTasksValidation.uncheckedTpTasks,
          checkedTpTasks: uncheckedTasksValidation.checkedTpTasks,
        },
      };
      violations.push(failure);
    }
  }

  const status: "pass" | "fail" = violations.length > 0 ? "fail" : "pass";

  // Sort violations in canonical order for deterministic output
  const sortedViolations = sortViolationsCanonical(violations);

  const report: IntegrityReport = {
    status,
    mode,
    activeSlice: {
      heading: activeSlice!.heading,
      line: activeSlice!.startLine,
      hasUncheckedTasks: uncheckedTasksValidation?.passes,
      totalTpTasks: uncheckedTasksValidation?.totalTpTasks,
      uncheckedTpTasks: uncheckedTasksValidation?.uncheckedTpTasks,
      checkedTpTasks: uncheckedTasksValidation?.checkedTpTasks,
    },
    violations: sortedViolations,
    baseViolations: sortViolationsCanonical(baseViolations),
    validatedRules,
  };

  if (format === "json") {
    printJsonReport(report);
  }

  printHumanReport(
    status,
    mode,
    activeSlice,
    sortedViolations,
    taskGraphValidation,
    verificationBlockValidation,
    uncheckedTasksValidation,
  );
}

if (import.meta.main) {
  main();
}
