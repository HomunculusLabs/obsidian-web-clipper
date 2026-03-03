import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const H2_HEADING_REGEX = /^##\s+/;
const H3_HEADING_REGEX = /^###\s+/;
const PLAN_SLICE_HEADING_REGEX = /^##\s+TASKPAD Intake Slice\b/;
const TASK_GRAPH_HEADING = "### Task Graph";
const UNCHECKED_TP_LINE_REGEX = /^\s*-\s*\[\s*\]\s+\*\*TP\d{3}\*\*:\s+.+$/;
const PLAN_PRUNE_TMP_FILE_TAG = ".taskpad-plan-prune.tmp";

export type PlanPruneParserReasonCode =
  | "PLAN_PRUNE_OK"
  | "PLAN_PRUNE_NOOP_WITHIN_KEEP_WINDOW"
  | "PLAN_PRUNE_INPUT_INVALID"
  | "PLAN_PRUNE_PLAN_READ_FAILED"
  | "PLAN_PRUNE_PLAN_STRUCTURE_INVALID"
  | "PLAN_PRUNE_ARCHIVE_WRITE_FAILED"
  | "PLAN_PRUNE_PLAN_WRITE_FAILED"
  | "PLAN_PRUNE_ATOMIC_COMMIT_ABORTED";

export type TaskpadIntakeSliceStatus = "completed" | "active";

export interface TaskpadIntakeSlice {
  heading: string;
  startLine: number;
  endLine: number;
  markdown: string;
  taskGraphHeadingLine: number;
  uncheckedTaskLines: string[];
  status: TaskpadIntakeSliceStatus;
}

export interface TaskpadSliceParseResult {
  reasonCode: PlanPruneParserReasonCode;
  slices: TaskpadIntakeSlice[];
  structuralErrors: string[];
}

export interface PlanPruneSet {
  reasonCode: PlanPruneParserReasonCode;
  keepWindow: number;
  slices: TaskpadIntakeSlice[];
  completedSlices: TaskpadIntakeSlice[];
  activeSlices: TaskpadIntakeSlice[];
  keptCompletedSlices: TaskpadIntakeSlice[];
  prunedCompletedSlices: TaskpadIntakeSlice[];
  structuralErrors: string[];
}

export interface PlanPruneRewriteResult {
  reasonCode: PlanPruneParserReasonCode;
  updatedPlanMarkdown: string | null;
  structuralErrors: string[];
}

export interface PlanPruneArchiveBuildResult {
  reasonCode: PlanPruneParserReasonCode;
  archiveMarkdown: string | null;
  structuralErrors: string[];
}

export interface PlanPruneAtomicWriteOptions {
  planPath: string;
  archivePath: string;
  updatedPlanMarkdown: string;
  updatedArchiveMarkdown: string;
}

export interface PlanPruneAtomicWriteResult {
  reasonCode: PlanPruneParserReasonCode;
  committed: boolean;
}

function getLines(markdown: string): string[] {
  return markdown.split(/\r?\n/);
}

function getDetectedNewline(markdown: string): "\n" | "\r\n" {
  return markdown.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeTrailingNewline(markdown: string, newline: "\n" | "\r\n"): string {
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\n+$/g, "");
  return normalized.length === 0 ? "" : `${normalized}${newline}`;
}

function isolateTaskGraphLines(
  sliceLines: string[],
): { headingIndex: number; uncheckedTaskLines: string[]; structuralErrors: string[] } {
  const taskGraphHeadingIndexes = sliceLines.reduce<number[]>((indexes, line, index) => {
    if (line.trim() === TASK_GRAPH_HEADING) {
      indexes.push(index);
    }

    return indexes;
  }, []);

  if (taskGraphHeadingIndexes.length === 0) {
    return {
      headingIndex: -1,
      uncheckedTaskLines: [],
      structuralErrors: ["Missing '### Task Graph' heading in intake slice."],
    };
  }

  if (taskGraphHeadingIndexes.length > 1) {
    return {
      headingIndex: taskGraphHeadingIndexes[0],
      uncheckedTaskLines: [],
      structuralErrors: ["Duplicate '### Task Graph' headings in intake slice."],
    };
  }

  const headingIndex = taskGraphHeadingIndexes[0];
  const sectionLines: string[] = [];

  for (let i = headingIndex + 1; i < sliceLines.length; i++) {
    const trimmed = sliceLines[i].trim();
    if (H3_HEADING_REGEX.test(trimmed)) {
      break;
    }

    sectionLines.push(sliceLines[i]);
  }

  const uncheckedTaskLines = sectionLines
    .map((line) => line.trim())
    .filter((line) => UNCHECKED_TP_LINE_REGEX.test(line));

  return {
    headingIndex,
    uncheckedTaskLines,
    structuralErrors: [],
  };
}

export function parseTaskpadIntakeSlices(planMarkdown: string): TaskpadSliceParseResult {
  const lines = getLines(planMarkdown);

  const sliceStartIndexes = lines.reduce<number[]>((indexes, line, index) => {
    if (PLAN_SLICE_HEADING_REGEX.test(line.trim())) {
      indexes.push(index);
    }

    return indexes;
  }, []);

  if (sliceStartIndexes.length === 0) {
    return {
      reasonCode: "PLAN_PRUNE_PLAN_STRUCTURE_INVALID",
      slices: [],
      structuralErrors: ["No '## TASKPAD Intake Slice ...' headings found."],
    };
  }

  const slices: TaskpadIntakeSlice[] = [];
  const structuralErrors: string[] = [];

  for (let i = 0; i < sliceStartIndexes.length; i++) {
    const startIndex = sliceStartIndexes[i];

    let endIndex = lines.length;
    for (let j = startIndex + 1; j < lines.length; j++) {
      if (H2_HEADING_REGEX.test(lines[j].trim())) {
        endIndex = j;
        break;
      }
    }

    const sliceLines = lines.slice(startIndex, endIndex);
    const heading = lines[startIndex].trim();

    if (!PLAN_SLICE_HEADING_REGEX.test(heading)) {
      structuralErrors.push(`Line ${startIndex + 1}: malformed intake slice heading.`);
      continue;
    }

    const taskGraph = isolateTaskGraphLines(sliceLines);

    if (taskGraph.structuralErrors.length > 0) {
      for (const error of taskGraph.structuralErrors) {
        structuralErrors.push(`${heading}: ${error}`);
      }
      continue;
    }

    const uncheckedTaskLines = taskGraph.uncheckedTaskLines;
    slices.push({
      heading,
      startLine: startIndex + 1,
      endLine: endIndex,
      markdown: sliceLines.join("\n"),
      taskGraphHeadingLine: startIndex + taskGraph.headingIndex + 1,
      uncheckedTaskLines,
      status: uncheckedTaskLines.length === 0 ? "completed" : "active",
    });
  }

  if (structuralErrors.length > 0) {
    return {
      reasonCode: "PLAN_PRUNE_PLAN_STRUCTURE_INVALID",
      slices,
      structuralErrors,
    };
  }

  return {
    reasonCode: "PLAN_PRUNE_OK",
    slices,
    structuralErrors: [],
  };
}

export function calculatePlanPruneSet(planMarkdown: string, keepWindow = 5): PlanPruneSet {
  if (!Number.isInteger(keepWindow) || keepWindow < 0) {
    return {
      reasonCode: "PLAN_PRUNE_INPUT_INVALID",
      keepWindow,
      slices: [],
      completedSlices: [],
      activeSlices: [],
      keptCompletedSlices: [],
      prunedCompletedSlices: [],
      structuralErrors: ["keepWindow must be an integer >= 0."],
    };
  }

  const parsed = parseTaskpadIntakeSlices(planMarkdown);

  if (parsed.reasonCode !== "PLAN_PRUNE_OK") {
    return {
      reasonCode: parsed.reasonCode,
      keepWindow,
      slices: parsed.slices,
      completedSlices: [],
      activeSlices: [],
      keptCompletedSlices: [],
      prunedCompletedSlices: [],
      structuralErrors: parsed.structuralErrors,
    };
  }

  const completedSlices = parsed.slices.filter((slice) => slice.status === "completed");
  const activeSlices = parsed.slices.filter((slice) => slice.status === "active");
  const keptCompletedSlices = completedSlices.slice(0, keepWindow);
  const prunedCompletedSlices = completedSlices.slice(keepWindow);

  return {
    reasonCode: "PLAN_PRUNE_OK",
    keepWindow,
    slices: parsed.slices,
    completedSlices,
    activeSlices,
    keptCompletedSlices,
    prunedCompletedSlices,
    structuralErrors: [],
  };
}

function buildPrunedLineSet(pruned: TaskpadIntakeSlice[]): Set<number> {
  const lineNumbers = new Set<number>();

  for (const slice of pruned) {
    for (let line = slice.startLine; line <= slice.endLine; line++) {
      lineNumbers.add(line);
    }
  }

  return lineNumbers;
}

function validatePruneRewriteGuardrails(
  originalPlanMarkdown: string,
  rewrittenPlanMarkdown: string,
  pruneSet: PlanPruneSet,
): string[] {
  const errors: string[] = [];

  const rewrittenParse = parseTaskpadIntakeSlices(rewrittenPlanMarkdown);
  if (rewrittenParse.reasonCode !== "PLAN_PRUNE_OK") {
    errors.push(...rewrittenParse.structuralErrors.map((error) => `Rewritten plan: ${error}`));
    return errors;
  }

  const expectedHeadings = pruneSet.slices
    .filter((slice) => !pruneSet.prunedCompletedSlices.some((pruned) => pruned.heading === slice.heading && pruned.startLine === slice.startLine))
    .map((slice) => slice.heading);

  const actualHeadings = rewrittenParse.slices.map((slice) => slice.heading);

  if (expectedHeadings.length !== actualHeadings.length) {
    errors.push(
      `Slice heading count mismatch after rewrite (expected ${expectedHeadings.length}, got ${actualHeadings.length}).`,
    );
    return errors;
  }

  for (let i = 0; i < expectedHeadings.length; i++) {
    if (expectedHeadings[i] !== actualHeadings[i]) {
      errors.push(
        `Slice heading order mismatch at index ${i}: expected '${expectedHeadings[i]}', got '${actualHeadings[i]}'.`,
      );
      return errors;
    }
  }

  const originalParse = parseTaskpadIntakeSlices(originalPlanMarkdown);
  if (originalParse.reasonCode !== "PLAN_PRUNE_OK") {
    errors.push(...originalParse.structuralErrors.map((error) => `Original plan: ${error}`));
  }

  return errors;
}

export function rewritePlanWithoutPrunedSlices(
  planMarkdown: string,
  pruneSet: PlanPruneSet,
): PlanPruneRewriteResult {
  if (pruneSet.reasonCode !== "PLAN_PRUNE_OK") {
    return {
      reasonCode: pruneSet.reasonCode,
      updatedPlanMarkdown: null,
      structuralErrors: pruneSet.structuralErrors,
    };
  }

  if (pruneSet.prunedCompletedSlices.length === 0) {
    return {
      reasonCode: "PLAN_PRUNE_NOOP_WITHIN_KEEP_WINDOW",
      updatedPlanMarkdown: planMarkdown,
      structuralErrors: [],
    };
  }

  const lines = getLines(planMarkdown);
  const prunedLineSet = buildPrunedLineSet(pruneSet.prunedCompletedSlices);
  const rewrittenLines = lines.filter((_, index) => !prunedLineSet.has(index + 1));
  const rewritten = rewrittenLines.join("\n");

  const guardrailErrors = validatePruneRewriteGuardrails(planMarkdown, rewritten, pruneSet);
  if (guardrailErrors.length > 0) {
    return {
      reasonCode: "PLAN_PRUNE_PLAN_STRUCTURE_INVALID",
      updatedPlanMarkdown: null,
      structuralErrors: guardrailErrors,
    };
  }

  return {
    reasonCode: "PLAN_PRUNE_OK",
    updatedPlanMarkdown: rewritten,
    structuralErrors: [],
  };
}

export function buildPlanPruneArchivePath(planPath: string, date: string): string {
  const planDir = dirname(resolve(planPath));
  return resolve(planDir, "docs", "archive", `IMPLEMENTATION_PLAN_ARCHIVE_${date}.md`);
}

function buildArchiveAppendix(prunedSlices: TaskpadIntakeSlice[], newline: "\n" | "\r\n"): string {
  const separator = `${newline}---${newline}${newline}`;
  return prunedSlices.map((slice) => slice.markdown).join(separator);
}

export function buildArchiveMarkdownWithPrunedSlices(
  existingArchiveMarkdown: string | null,
  pruneSet: PlanPruneSet,
): PlanPruneArchiveBuildResult {
  if (pruneSet.reasonCode !== "PLAN_PRUNE_OK") {
    return {
      reasonCode: pruneSet.reasonCode,
      archiveMarkdown: null,
      structuralErrors: pruneSet.structuralErrors,
    };
  }

  if (pruneSet.prunedCompletedSlices.length === 0) {
    return {
      reasonCode: "PLAN_PRUNE_NOOP_WITHIN_KEEP_WINDOW",
      archiveMarkdown: existingArchiveMarkdown,
      structuralErrors: [],
    };
  }

  const newline = getDetectedNewline(existingArchiveMarkdown ?? pruneSet.slices[0]?.markdown ?? "");
  const appendix = buildArchiveAppendix(pruneSet.prunedCompletedSlices, newline);

  if (!existingArchiveMarkdown || existingArchiveMarkdown.trim().length === 0) {
    return {
      reasonCode: "PLAN_PRUNE_OK",
      archiveMarkdown: normalizeTrailingNewline(appendix, newline),
      structuralErrors: [],
    };
  }

  const normalizedExisting = normalizeTrailingNewline(existingArchiveMarkdown, newline);
  const combined = `${normalizedExisting}---${newline}${newline}${appendix}`;

  return {
    reasonCode: "PLAN_PRUNE_OK",
    archiveMarkdown: normalizeTrailingNewline(combined, newline),
    structuralErrors: [],
  };
}

function buildAtomicTempPath(targetPath: string): string {
  return `${targetPath}${PLAN_PRUNE_TMP_FILE_TAG}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanupTempFile(path: string): void {
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // Best-effort cleanup only.
  }
}

export function writePlanPruneFilesAtomically(options: PlanPruneAtomicWriteOptions): PlanPruneAtomicWriteResult {
  const archiveTempPath = buildAtomicTempPath(options.archivePath);
  const planTempPath = buildAtomicTempPath(options.planPath);

  let originalArchive: string | null = null;
  let originalPlan: string;

  try {
    originalPlan = readFileSync(options.planPath, "utf8");
  } catch {
    return {
      reasonCode: "PLAN_PRUNE_PLAN_READ_FAILED",
      committed: false,
    };
  }

  try {
    if (existsSync(options.archivePath)) {
      originalArchive = readFileSync(options.archivePath, "utf8");
    }
  } catch {
    return {
      reasonCode: "PLAN_PRUNE_ARCHIVE_WRITE_FAILED",
      committed: false,
    };
  }

  try {
    mkdirSync(dirname(options.archivePath), { recursive: true });
  } catch {
    return {
      reasonCode: "PLAN_PRUNE_ARCHIVE_WRITE_FAILED",
      committed: false,
    };
  }

  let archiveCommitted = false;
  let planCommitted = false;

  try {
    try {
      writeFileSync(archiveTempPath, options.updatedArchiveMarkdown, "utf8");
    } catch {
      return {
        reasonCode: "PLAN_PRUNE_ARCHIVE_WRITE_FAILED",
        committed: false,
      };
    }

    try {
      writeFileSync(planTempPath, options.updatedPlanMarkdown, "utf8");
    } catch {
      return {
        reasonCode: "PLAN_PRUNE_PLAN_WRITE_FAILED",
        committed: false,
      };
    }

    renameSync(archiveTempPath, options.archivePath);
    archiveCommitted = true;

    renameSync(planTempPath, options.planPath);
    planCommitted = true;

    return {
      reasonCode: "PLAN_PRUNE_OK",
      committed: true,
    };
  } catch {
    try {
      if (archiveCommitted) {
        if (originalArchive === null) {
          unlinkSync(options.archivePath);
        } else {
          writeFileSync(options.archivePath, originalArchive, "utf8");
        }
      }

      if (planCommitted) {
        writeFileSync(options.planPath, originalPlan, "utf8");
      }
    } catch {
      // Best-effort rollback only.
    }

    return {
      reasonCode: "PLAN_PRUNE_ATOMIC_COMMIT_ABORTED",
      committed: false,
    };
  } finally {
    cleanupTempFile(archiveTempPath);
    cleanupTempFile(planTempPath);
  }
}
