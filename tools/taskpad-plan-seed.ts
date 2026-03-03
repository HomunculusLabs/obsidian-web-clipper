#!/usr/bin/env bun

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, basename } from "node:path";
import {
  REQUIRED_SECTION_HEADINGS,
  isolateNewestTaskpadIntakeSlice,
  validateRequiredSectionPresence,
} from "./implementation-plan-integrity";
import { healTaskpad, reconcileTaskpad, type QueueReconcileResult } from "./lib/taskpad-queue-reconcile";
import {
  probeTaskpadWriteability,
  type TaskpadWritePreflightResult,
  type TaskpadWritePreflightReasonCode,
} from "./taskpad-write-preflight";

const H2_HEADING_REGEX = /^##\s+/;
const PLAN_SLICE_HEADING_REGEX = /^##\s+TASKPAD Intake Slice\b/;
const SELF_IMPROVEMENT_BACKLOG_HEADING = "## Self-Improvement Backlog";
const UNCHECKED_BULLET_REGEX = /^- \[ \] (.+)$/;
const TASKPAD_UNCHECKED_LINE_CAPTURE_REGEX = /^(\s*[-*+]\s+\[\s*\]\s+)(.+)$/;
const PLANNED_PREFIX_REGEX = /^planned-(\d{4}-\d{2}-\d{2}|YYYY-MM-DD)\s+/i;
const NORMALIZE_WHITESPACE_REGEX = /\s+/g;
const DEFAULT_PLACEHOLDER_TASK_COUNT = 2;
const PLAN_SEED_TMP_FILE_TAG = ".taskpad-plan-seed.tmp";
const PLAN_SEED_ARTIFACT_KIND = "taskpad-plan-seed-fallback-patch";
const ARTIFACTS_DIR = "artifacts/taskpad-plan-seed";

const PLAN_SEED_SLICE_HEADINGS = {
  DISTILLED_SCOPE: "### Distilled Scope",
  REPOPROMPT_CONTEXT: "### RepoPrompt Builder Context",
  TASK_GRAPH: "### Task Graph",
  ACCEPTANCE_CRITERIA: "### Acceptance Criteria",
  VERIFICATION_COMMANDS: "### Verification Commands",
} as const;

// =============================================================================
// Fallback Artifact Types
// =============================================================================

export interface PlanSeedFallbackArtifact {
  version: number;
  kind: "taskpad-plan-seed-fallback-patch";
  taskpadPath: string;
  planPath: string;
  taskpadSha256: string;
  planSha256: string;
  mutationId: string;
  mutationOutcome: {
    action: "would-insert-taskpad" | "would-insert-plan";
    taskpadUpdatedLine: string | null;
    planInsertHeading: string | null;
    selectedBacklogLine: number;
  };
  patch: {
    format: "unified-diff";
    taskpadTargetPath: string;
    planTargetPath: string;
    taskpadPatchContent: string | null;
    planPatchContent: string | null;
  };
  applyHint: string;
}

interface PlanSeedArtifactMetadata {
  artifactPath: string | null;
  preflightResult: TaskpadWritePreflightResult | null;
  preflightReasonCode: TaskpadWritePreflightReasonCode | null;
}

// =============================================================================
// Parser Reason Codes
// =============================================================================

export type PlanSeedParserReasonCode =
  | "PLAN_SEED_OK"
  | "PLAN_SEED_NO_UNCHECKED_SELF_IMPROVEMENT"
  | "PLAN_SEED_TASKPAD_SECTION_MISSING"
  | "PLAN_SEED_PLAN_INSERT_ANCHOR_MISSING"
  | "PLAN_SEED_PLAN_REQUIRED_HEADING_MISSING"
  | "PLAN_SEED_TASKPAD_WRITE_FAILED"
  | "PLAN_SEED_PLAN_WRITE_FAILED"
  | "PLAN_SEED_ATOMIC_COMMIT_ABORTED"
  | "PLAN_SEED_INPUT_INVALID"
  | "PLAN_SEED_FALLBACK_ARTIFACT_GENERATED"
  | "PLAN_SEED_PREFLIGHT_ERROR";

export interface TaskpadBacklogBounds {
  headingLine: number;
  sectionStartLine: number;
  sectionEndLineExclusive: number;
}

export interface SelectedSelfImprovementBullet {
  lineNumber: number;
  rawLine: string;
  canonicalBullet: string;
  sourceText: string;
  promotedTheme: string;
  plannedPrefix: string | null;
}

export interface TaskpadBacklogSelection {
  reasonCode: PlanSeedParserReasonCode;
  backlogBounds: TaskpadBacklogBounds | null;
  selected: SelectedSelfImprovementBullet | null;
}

export interface PlanDestinationValidation {
  reasonCode: PlanSeedParserReasonCode;
  insertAnchorLine: number | null;
  insertAnchorHeading: string | null;
  requiredHeadingsPass: boolean;
  missingHeadings: string[];
  duplicateHeadings: string[];
  requiredHeadings: readonly string[];
}

export interface PlanSeedParserSnapshot {
  reasonCode: PlanSeedParserReasonCode;
  backlog: TaskpadBacklogSelection;
  plan: PlanDestinationValidation;
}

export interface PlanSeedScaffoldOptions {
  date: string;
  promotedTheme: string;
  placeholderTaskCount?: number;
}

export interface PlanSeedScaffoldDocument {
  heading: string;
  markdown: string;
  placeholderTaskIds: string[];
}

export interface PlanSeedScaffoldInsertionResult {
  reasonCode: PlanSeedParserReasonCode;
  heading: string | null;
  scaffoldMarkdown: string | null;
  updatedPlanMarkdown: string | null;
  insertAnchorLine: number | null;
}

export interface TaskpadPlannedMutationResult {
  reasonCode: PlanSeedParserReasonCode;
  selectedLine: number;
  updatedTaskpadMarkdown: string | null;
  updatedLine: string | null;
}

export interface PlanSeedAtomicWriteOptions {
  taskpadPath: string;
  planPath: string;
  updatedTaskpadMarkdown: string;
  updatedPlanMarkdown: string;
}

export interface PlanSeedAtomicWriteResult {
  reasonCode: PlanSeedParserReasonCode;
  committed: boolean;
}

function getLines(markdown: string): string[] {
  return markdown.split(/\r?\n/);
}

function trimPlannedPrefix(rawText: string): { text: string; plannedPrefix: string | null } {
  const match = rawText.match(PLANNED_PREFIX_REGEX);
  if (!match) {
    return {
      text: rawText.trim(),
      plannedPrefix: null,
    };
  }

  const normalized = rawText.slice(match[0].length).trim();
  return {
    text: normalized,
    plannedPrefix: `planned-${match[1]}`,
  };
}

export function findSelfImprovementBacklogBounds(taskpadMarkdown: string): TaskpadBacklogBounds | null {
  const lines = getLines(taskpadMarkdown);
  const headingIndex = lines.findIndex((line) => line.trim() === SELF_IMPROVEMENT_BACKLOG_HEADING);

  if (headingIndex === -1) {
    return null;
  }

  let sectionEndIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (H2_HEADING_REGEX.test(lines[i].trim())) {
      sectionEndIndex = i;
      break;
    }
  }

  return {
    headingLine: headingIndex + 1,
    sectionStartLine: headingIndex + 2,
    sectionEndLineExclusive: sectionEndIndex + 1,
  };
}

export function selectFirstUncheckedSelfImprovementBullet(taskpadMarkdown: string): TaskpadBacklogSelection {
  const bounds = findSelfImprovementBacklogBounds(taskpadMarkdown);

  if (!bounds) {
    return {
      reasonCode: "PLAN_SEED_TASKPAD_SECTION_MISSING",
      backlogBounds: null,
      selected: null,
    };
  }

  const lines = getLines(taskpadMarkdown);

  for (let i = bounds.sectionStartLine - 1; i < bounds.sectionEndLineExclusive - 1; i++) {
    const rawLine = lines[i];
    const match = rawLine.trim().match(UNCHECKED_BULLET_REGEX);
    if (!match) {
      continue;
    }

    const sourceText = match[1].trim();
    if (sourceText.length === 0) {
      continue;
    }

    const normalized = trimPlannedPrefix(sourceText);
    const canonicalBullet = `- [ ] ${sourceText}`;

    return {
      reasonCode: "PLAN_SEED_OK",
      backlogBounds: bounds,
      selected: {
        lineNumber: i + 1,
        rawLine,
        canonicalBullet,
        sourceText,
        promotedTheme: normalized.text,
        plannedPrefix: normalized.plannedPrefix,
      },
    };
  }

  return {
    reasonCode: "PLAN_SEED_NO_UNCHECKED_SELF_IMPROVEMENT",
    backlogBounds: bounds,
    selected: null,
  };
}

export function validatePlanSeedDestinationHeadings(planMarkdown: string): PlanDestinationValidation {
  const activeSlice = isolateNewestTaskpadIntakeSlice(planMarkdown);

  if (!activeSlice || !PLAN_SLICE_HEADING_REGEX.test(activeSlice.heading)) {
    return {
      reasonCode: "PLAN_SEED_PLAN_INSERT_ANCHOR_MISSING",
      insertAnchorLine: null,
      insertAnchorHeading: null,
      requiredHeadingsPass: false,
      missingHeadings: [],
      duplicateHeadings: [],
      requiredHeadings: REQUIRED_SECTION_HEADINGS,
    };
  }

  const requiredSections = validateRequiredSectionPresence(activeSlice.markdown);

  if (!requiredSections.passes) {
    return {
      reasonCode: "PLAN_SEED_PLAN_REQUIRED_HEADING_MISSING",
      insertAnchorLine: activeSlice.startLine,
      insertAnchorHeading: activeSlice.heading,
      requiredHeadingsPass: false,
      missingHeadings: requiredSections.missingHeadings,
      duplicateHeadings: requiredSections.duplicateHeadings,
      requiredHeadings: REQUIRED_SECTION_HEADINGS,
    };
  }

  return {
    reasonCode: "PLAN_SEED_OK",
    insertAnchorLine: activeSlice.startLine,
    insertAnchorHeading: activeSlice.heading,
    requiredHeadingsPass: true,
    missingHeadings: [],
    duplicateHeadings: [],
    requiredHeadings: REQUIRED_SECTION_HEADINGS,
  };
}

function normalizePromotedTheme(theme: string): string {
  return theme.trim().replace(NORMALIZE_WHITESPACE_REGEX, " ");
}

function buildPlaceholderTaskIds(count: number): string[] {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : DEFAULT_PLACEHOLDER_TASK_COUNT;

  return Array.from({ length: safeCount }, (_, index) => {
    const id = index + 1;
    return `TP${id.toString().padStart(3, "0")}`;
  });
}

export function buildPlanSeedScaffold(options: PlanSeedScaffoldOptions): PlanSeedScaffoldDocument {
  const normalizedTheme = normalizePromotedTheme(options.promotedTheme);
  const placeholderTaskIds = buildPlaceholderTaskIds(options.placeholderTaskCount ?? DEFAULT_PLACEHOLDER_TASK_COUNT);

  const heading = `## TASKPAD Intake Slice (${options.date}): ${normalizedTheme} (\`taskpad:plan-seed\`)`;

  const placeholderTaskLines = placeholderTaskIds.map((taskId) => `- [ ] **${taskId}**: TODO`);

  const markdown = [
    heading,
    "",
    PLAN_SEED_SLICE_HEADINGS.DISTILLED_SCOPE,
    "**Problem**",
    "- TODO",
    "",
    "**In scope**",
    "- TODO",
    "",
    "**Out of scope**",
    "- TODO",
    "",
    PLAN_SEED_SLICE_HEADINGS.REPOPROMPT_CONTEXT,
    "- **Entry files (paths):**",
    "  - TODO",
    "- **Search queries/patterns:**",
    "  - TODO",
    "- **Suggested `rp_exec` sequence:**",
    "  - `tree`",
    "  - `search \"...\"`",
    "  - `select set ...`",
    "  - `context --files --tree`",
    "",
    PLAN_SEED_SLICE_HEADINGS.TASK_GRAPH,
    ...placeholderTaskLines,
    "",
    PLAN_SEED_SLICE_HEADINGS.ACCEPTANCE_CRITERIA,
    "- TODO",
    "",
    PLAN_SEED_SLICE_HEADINGS.VERIFICATION_COMMANDS,
    "```bash",
    "bun run typecheck",
    "```",
  ].join("\n");

  return {
    heading,
    markdown,
    placeholderTaskIds,
  };
}

export function insertPlanSeedScaffoldAtTop(
  planMarkdown: string,
  scaffold: PlanSeedScaffoldDocument,
): PlanSeedScaffoldInsertionResult {
  const destination = validatePlanSeedDestinationHeadings(planMarkdown);

  if (destination.reasonCode !== "PLAN_SEED_OK" || destination.insertAnchorLine === null) {
    return {
      reasonCode: destination.reasonCode,
      heading: null,
      scaffoldMarkdown: null,
      updatedPlanMarkdown: null,
      insertAnchorLine: destination.insertAnchorLine,
    };
  }

  const lines = getLines(planMarkdown);
  const anchorIndex = destination.insertAnchorLine - 1;
  const beforeAnchor = lines.slice(0, anchorIndex);
  const fromAnchor = lines.slice(anchorIndex);

  const updatedLines = [...beforeAnchor, scaffold.markdown, "", "---", "", ...fromAnchor];

  return {
    reasonCode: "PLAN_SEED_OK",
    heading: scaffold.heading,
    scaffoldMarkdown: scaffold.markdown,
    updatedPlanMarkdown: updatedLines.join("\n"),
    insertAnchorLine: destination.insertAnchorLine,
  };
}

export function parsePlanSeedInputs(taskpadMarkdown: string, planMarkdown: string): PlanSeedParserSnapshot {
  const backlog = selectFirstUncheckedSelfImprovementBullet(taskpadMarkdown);
  const plan = validatePlanSeedDestinationHeadings(planMarkdown);

  if (backlog.reasonCode !== "PLAN_SEED_OK") {
    return {
      reasonCode: backlog.reasonCode,
      backlog,
      plan,
    };
  }

  if (plan.reasonCode !== "PLAN_SEED_OK") {
    return {
      reasonCode: plan.reasonCode,
      backlog,
      plan,
    };
  }

  return {
    reasonCode: "PLAN_SEED_OK",
    backlog,
    plan,
  };
}

function buildPlannedBacklogLine(prefix: string, sourceText: string, date: string): string {
  const normalized = trimPlannedPrefix(sourceText).text;
  return `${prefix}planned-${date} ${normalized}`;
}

export function markSelectedBacklogBulletPlanned(
  taskpadMarkdown: string,
  selected: SelectedSelfImprovementBullet,
  date: string,
): TaskpadPlannedMutationResult {
  const lines = getLines(taskpadMarkdown);
  const newline = taskpadMarkdown.includes("\r\n") ? "\r\n" : "\n";
  const selectedIndex = selected.lineNumber - 1;

  if (selectedIndex < 0 || selectedIndex >= lines.length) {
    return {
      reasonCode: "PLAN_SEED_TASKPAD_SECTION_MISSING",
      selectedLine: selected.lineNumber,
      updatedTaskpadMarkdown: null,
      updatedLine: null,
    };
  }

  const line = lines[selectedIndex];
  const match = line.match(TASKPAD_UNCHECKED_LINE_CAPTURE_REGEX);
  if (!match) {
    return {
      reasonCode: "PLAN_SEED_TASKPAD_SECTION_MISSING",
      selectedLine: selected.lineNumber,
      updatedTaskpadMarkdown: null,
      updatedLine: null,
    };
  }

  const [, bulletPrefix, bulletText] = match;
  const updatedLine = buildPlannedBacklogLine(bulletPrefix, bulletText, date);
  lines[selectedIndex] = updatedLine;

  return {
    reasonCode: "PLAN_SEED_OK",
    selectedLine: selected.lineNumber,
    updatedTaskpadMarkdown: lines.join(newline),
    updatedLine,
  };
}

function buildAtomicTempPath(targetPath: string): string {
  return `${targetPath}${PLAN_SEED_TMP_FILE_TAG}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// Fallback Artifact Helpers
// =============================================================================

function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function generateUnifiedDiff(
  originalContent: string,
  updatedContent: string,
  targetPath: string,
): string {
  const originalLines = originalContent.split("\n");
  const updatedLines = updatedContent.split("\n");

  const originalPath = `a/${targetPath.replace(/\\/g, "/")}`;
  const updatedPath = `b/${targetPath.replace(/\\/g, "/")}`;

  let output = `--- ${originalPath}\n`;
  output += `+++ ${updatedPath}\n`;

  // For plan-seed, we're always adding content, so compute the diff
  // Find the first different line
  let commonPrefix = 0;
  while (
    commonPrefix < originalLines.length &&
    commonPrefix < updatedLines.length &&
    originalLines[commonPrefix] === updatedLines[commonPrefix]
  ) {
    commonPrefix++;
  }

  const oldCount = originalLines.length - commonPrefix;
  const newCount = updatedLines.length - commonPrefix;

  // Build the hunk header
  output += `@@ -${commonPrefix === 0 ? 1 : commonPrefix},${oldCount} +${commonPrefix === 0 ? 1 : commonPrefix},${newCount} @@\n`;

  // Output the removed lines (from original)
  for (let i = commonPrefix; i < originalLines.length; i++) {
    output += `-${originalLines[i]}\n`;
  }

  // Output the added lines (from updated)
  for (let i = commonPrefix; i < updatedLines.length; i++) {
    output += `+${updatedLines[i]}\n`;
  }

  return output;
}

function ensureArtifactsDirectory(): void {
  try {
    if (!existsSync(ARTIFACTS_DIR)) {
      // Create parent directories recursively
      const parts = ARTIFACTS_DIR.split("/").filter(Boolean);
      let current = ".";
      for (const part of parts) {
        current = resolve(current, part);
        if (!existsSync(current)) {
          writeFileSync(current, "", { flag: "wx" });
        }
      }
    }
  } catch {
    // Best-effort directory creation; will fail at write time if needed
  }
}

function generatePlanSeedFallbackArtifact(
  taskpadPath: string,
  planPath: string,
  taskpadOriginal: string,
  planOriginal: string,
  taskpadUpdated: string,
  planUpdated: string,
  selected: SelectedSelfImprovementBullet,
  scaffold: PlanSeedScaffoldDocument,
  selectedLine: number,
): PlanSeedFallbackArtifact {
  const taskpadSha256 = computeSha256(taskpadOriginal);
  const planSha256 = computeSha256(planOriginal);

  const mutationId = `plan-seed-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const taskpadPatch = taskpadOriginal !== taskpadUpdated
    ? generateUnifiedDiff(taskpadOriginal, taskpadUpdated, taskpadPath)
    : null;

  const planPatch = planOriginal !== planUpdated
    ? generateUnifiedDiff(planOriginal, planUpdated, planPath)
    : null;

  return {
    version: 1,
    kind: PLAN_SEED_ARTIFACT_KIND,
    taskpadPath: resolve(taskpadPath),
    planPath: resolve(planPath),
    taskpadSha256,
    planSha256,
    mutationId,
    mutationOutcome: {
      action: taskpadPatch && planPatch ? "would-insert-plan" : "would-insert-taskpad",
      taskpadUpdatedLine: taskpadPatch ? null : null,
      planInsertHeading: planPatch ? scaffold.heading : null,
      selectedBacklogLine: selectedLine,
    },
    patch: {
      format: "unified-diff",
      taskpadTargetPath: resolve(taskpadPath),
      planTargetPath: resolve(planPath),
      taskpadPatchContent: taskpadPatch,
      planPatchContent: planPatch,
    },
    applyHint: `Run: bun run taskpad:apply-fallback -- --taskpad "${taskpadPath}" --plan "${planPath}" --artifact <artifact-path>\n\nThis will apply both TASKPAD and IMPLEMENTATION_PLAN mutations atomically.`,
  };
}

function writeFallbackArtifact(
  taskpadPath: string,
  artifact: PlanSeedFallbackArtifact,
): string {
  ensureArtifactsDirectory();

  const taskpadBasename = basename(taskpadPath, ".md");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactFileName = `${taskpadBasename}.plan-seed.${timestamp}.patch.json`;
  const artifactPath = resolve(ARTIFACTS_DIR, artifactFileName);

  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");

  return artifactPath;
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

export function writePlanSeedFilesAtomically(options: PlanSeedAtomicWriteOptions): PlanSeedAtomicWriteResult {
  const taskpadTempPath = buildAtomicTempPath(options.taskpadPath);
  const planTempPath = buildAtomicTempPath(options.planPath);

  let originalTaskpad: string;
  let originalPlan: string;

  try {
    originalTaskpad = readFileSync(options.taskpadPath, "utf8");
  } catch {
    return {
      reasonCode: "PLAN_SEED_TASKPAD_WRITE_FAILED",
      committed: false,
    };
  }

  try {
    originalPlan = readFileSync(options.planPath, "utf8");
  } catch {
    return {
      reasonCode: "PLAN_SEED_PLAN_WRITE_FAILED",
      committed: false,
    };
  }

  let taskpadCommitted = false;
  let planCommitted = false;

  try {
    try {
      writeFileSync(taskpadTempPath, options.updatedTaskpadMarkdown, "utf8");
    } catch {
      return {
        reasonCode: "PLAN_SEED_TASKPAD_WRITE_FAILED",
        committed: false,
      };
    }

    try {
      writeFileSync(planTempPath, options.updatedPlanMarkdown, "utf8");
    } catch {
      return {
        reasonCode: "PLAN_SEED_PLAN_WRITE_FAILED",
        committed: false,
      };
    }

    renameSync(taskpadTempPath, options.taskpadPath);
    taskpadCommitted = true;

    renameSync(planTempPath, options.planPath);
    planCommitted = true;

    return {
      reasonCode: "PLAN_SEED_OK",
      committed: true,
    };
  } catch {
    try {
      if (taskpadCommitted && !planCommitted) {
        writeFileSync(options.taskpadPath, originalTaskpad, "utf8");
      }
      if (planCommitted) {
        writeFileSync(options.planPath, originalPlan, "utf8");
      }
    } catch {
      // Best-effort rollback; caller still gets aborted code.
    }

    return {
      reasonCode: "PLAN_SEED_ATOMIC_COMMIT_ABORTED",
      committed: false,
    };
  } finally {
    cleanupTempFile(taskpadTempPath);
    cleanupTempFile(planTempPath);
  }
}

interface PlanSeedCliArgs {
  taskpadPath?: string;
  planPath?: string;
  date?: string;
}

export interface PlanSeedCliSummary {
  status: "seeded" | "noop" | "failed" | "fallback";
  selectedBacklogLine: number | null;
  newSliceHeading: string | null;
  reasonCode: PlanSeedParserReasonCode;
  queueReconcile: QueueReconcileResult | null;
  artifact: PlanSeedArtifactMetadata;
}

export interface PlanSeedRunResult {
  summary: PlanSeedCliSummary;
  taskpadPath: string;
  planPath: string;
}

function printHelp(): void {
  console.log(`
TASKPAD Plan Seed

USAGE:
  bun run tools/taskpad-plan-seed.ts --taskpad <path> --plan <path> [--date YYYY-MM-DD]

OPTIONS:
  --taskpad <path>   Path to TASKPAD markdown file
  --plan <path>      Path to IMPLEMENTATION_PLAN markdown file
  --date <date>      Date stamp for planned prefix / slice heading (UTC, YYYY-MM-DD)
  --help, -h         Show this help message
`);
}

function parseArgs(argv: string[]): PlanSeedCliArgs {
  let taskpadPath: string | undefined;
  let planPath: string | undefined;
  let date: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--taskpad") {
      i += 1;
      taskpadPath = argv[i];
      continue;
    }

    if (arg === "--plan") {
      i += 1;
      planPath = argv[i];
      continue;
    }

    if (arg === "--date") {
      i += 1;
      date = argv[i];
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { taskpadPath, planPath, date };
}

function formatUtcDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function runTaskpadPlanSeed(taskpadPath: string, planPath: string, date: string): PlanSeedRunResult {
  const taskpadMarkdown = readFileSync(taskpadPath, "utf8");
  const planMarkdown = readFileSync(planPath, "utf8");

  // Run shared preflight to determine write mode
  const preflightResult = probeTaskpadWriteability(taskpadPath);
  const preflightMode = getPreflightModeFromReasonCode(preflightResult.reasonCode);

  const snapshot = parsePlanSeedInputs(taskpadMarkdown, planMarkdown);
  const selectedLine = snapshot.backlog.selected?.lineNumber ?? null;

  if (snapshot.reasonCode === "PLAN_SEED_NO_UNCHECKED_SELF_IMPROVEMENT") {
    // No mutation, but still run reconcile to check queue health
    const reconcileResult = reconcileTaskpad({ taskpadPath });
    return {
      taskpadPath,
      planPath,
      summary: {
        status: "noop",
        selectedBacklogLine: null,
        newSliceHeading: null,
        reasonCode: snapshot.reasonCode,
        queueReconcile: reconcileResult,
        artifact: {
          artifactPath: null,
          preflightResult: preflightMode === "error" ? preflightResult : null,
          preflightReasonCode: preflightMode === "error" ? preflightResult.reasonCode : null,
        },
      },
    };
  }

  if (snapshot.reasonCode !== "PLAN_SEED_OK" || !snapshot.backlog.selected) {
    return {
      taskpadPath,
      planPath,
      summary: {
        status: "failed",
        selectedBacklogLine: selectedLine,
        newSliceHeading: null,
        reasonCode: snapshot.reasonCode,
        queueReconcile: null,
        artifact: {
          artifactPath: null,
          preflightResult: preflightMode === "error" ? preflightResult : null,
          preflightReasonCode: preflightMode === "error" ? preflightResult.reasonCode : null,
        },
      },
    };
  }

  const scaffold = buildPlanSeedScaffold({
    date,
    promotedTheme: snapshot.backlog.selected.promotedTheme,
  });

  const planInsertion = insertPlanSeedScaffoldAtTop(planMarkdown, scaffold);
  if (planInsertion.reasonCode !== "PLAN_SEED_OK" || !planInsertion.updatedPlanMarkdown || !planInsertion.heading) {
    return {
      taskpadPath,
      planPath,
      summary: {
        status: "failed",
        selectedBacklogLine: selectedLine,
        newSliceHeading: null,
        reasonCode: planInsertion.reasonCode,
        queueReconcile: null,
        artifact: {
          artifactPath: null,
          preflightResult: preflightMode === "error" ? preflightResult : null,
          preflightReasonCode: preflightMode === "error" ? preflightResult.reasonCode : null,
        },
      },
    };
  }

  const taskpadMutation = markSelectedBacklogBulletPlanned(taskpadMarkdown, snapshot.backlog.selected, date);
  if (taskpadMutation.reasonCode !== "PLAN_SEED_OK" || !taskpadMutation.updatedTaskpadMarkdown) {
    return {
      taskpadPath,
      planPath,
      summary: {
        status: "failed",
        selectedBacklogLine: selectedLine,
        newSliceHeading: null,
        reasonCode: taskpadMutation.reasonCode,
        queueReconcile: null,
        artifact: {
          artifactPath: null,
          preflightResult: preflightMode === "error" ? preflightResult : null,
          preflightReasonCode: preflightMode === "error" ? preflightResult.reasonCode : null,
        },
      },
    };
  }

  // Fallback artifact path: emit artifact instead of mutating
  if (preflightMode === "fallback-artifact") {
    const fallbackArtifact = generatePlanSeedFallbackArtifact(
      taskpadPath,
      planPath,
      taskpadMarkdown,
      planMarkdown,
      taskpadMutation.updatedTaskpadMarkdown!,
      planInsertion.updatedPlanMarkdown!,
      snapshot.backlog.selected,
      scaffold,
      selectedLine!,
    );

    const artifactPath = writeFallbackArtifact(taskpadPath, fallbackArtifact);

    return {
      taskpadPath,
      planPath,
      summary: {
        status: "fallback",
        selectedBacklogLine: selectedLine,
        newSliceHeading: planInsertion.heading,
        reasonCode: "PLAN_SEED_FALLBACK_ARTIFACT_GENERATED",
        queueReconcile: null,
        artifact: {
          artifactPath,
          preflightResult,
          preflightReasonCode: preflightResult.reasonCode,
        },
      },
    };
  }

  // Error path: preflight indicates non-writable but not permission-denied
  if (preflightMode === "error") {
    return {
      taskpadPath,
      planPath,
      summary: {
        status: "failed",
        selectedBacklogLine: selectedLine,
        newSliceHeading: null,
        reasonCode: "PLAN_SEED_PREFLIGHT_ERROR",
        queueReconcile: null,
        artifact: {
          artifactPath: null,
          preflightResult,
          preflightReasonCode: preflightResult.reasonCode,
        },
      },
    };
  }

  // Direct write path: proceed with atomic writes
  const writeResult = writePlanSeedFilesAtomically({
    taskpadPath,
    planPath,
    updatedTaskpadMarkdown: taskpadMutation.updatedTaskpadMarkdown!,
    updatedPlanMarkdown: planInsertion.updatedPlanMarkdown!,
  });

  if (!writeResult.committed || writeResult.reasonCode !== "PLAN_SEED_OK") {
    return {
      taskpadPath,
      planPath,
      summary: {
        status: "failed",
        selectedBacklogLine: selectedLine,
        newSliceHeading: planInsertion.heading,
        reasonCode: writeResult.reasonCode,
        queueReconcile: null,
        artifact: {
          artifactPath: null,
          preflightResult: null,
          preflightReasonCode: null,
        },
      },
    };
  }

  // Post-mutation: run queue reconcile and auto-heal if needed
  const reconcileResult = healTaskpad({ taskpadPath });
  if (reconcileResult.mutated && reconcileResult.healedMarkdown) {
    // Write healed taskpad content
    try {
      writeFileSync(taskpadPath, reconcileResult.healedMarkdown, "utf8");
    } catch {
      // Heal write failure is non-blocking; report reconcile result but don't fail
    }
  }

  return {
    taskpadPath,
    planPath,
    summary: {
      status: "seeded",
      selectedBacklogLine: selectedLine,
      newSliceHeading: planInsertion.heading,
      reasonCode: "PLAN_SEED_OK",
      queueReconcile: reconcileResult,
      artifact: {
        artifactPath: null,
        preflightResult: null,
        preflightReasonCode: null,
      },
    },
  };
}

function getPreflightModeFromReasonCode(reasonCode: TaskpadWritePreflightReasonCode): "direct-write" | "fallback-artifact" | "error" {
  if (reasonCode === "PRECHECK_OK") {
    return "direct-write";
  }
  if (
    reasonCode === "PRECHECK_PERMISSION_EPERM" ||
    reasonCode === "PRECHECK_PERMISSION_EACCES" ||
    reasonCode === "PRECHECK_PERMISSION_EROFS" ||
    reasonCode === "PRECHECK_PERMISSION_DENIED_GENERIC"
  ) {
    return "fallback-artifact";
  }
  return "error";
}

function printHumanSummary(result: PlanSeedRunResult): void {
  console.log(`TASKPAD plan-seed: ${result.summary.status.toUpperCase()}`);
  console.log(`- reasonCode: ${result.summary.reasonCode}`);
  console.log(`- taskpadPath: ${result.taskpadPath}`);
  console.log(`- planPath: ${result.planPath}`);
  console.log(`- selectedBacklogLine: ${result.summary.selectedBacklogLine ?? "n/a"}`);
  console.log(`- newSliceHeading: ${result.summary.newSliceHeading ?? "n/a"}`);

  if (result.summary.artifact.artifactPath) {
    console.log(`- artifactPath: ${result.summary.artifact.artifactPath}`);
  }

  if (result.summary.artifact.preflightResult) {
    const pf = result.summary.artifact.preflightResult;
    console.log(`- preflight.writable: ${pf.writable}`);
    console.log(`- preflight.reasonCode: ${result.summary.artifact.preflightReasonCode ?? "n/a"}`);
    console.log(`- preflight.permissionClass: ${pf.reasonCode.startsWith("PRECHECK_PERMISSION_") ? "permission-denied" : "non-permission"}`);
  }

  if (result.summary.queueReconcile) {
    const qr = result.summary.queueReconcile;
    console.log(`- queueReconcile.status: ${qr.status}`);
    console.log(`- queueReconcile.reasonCodes: ${qr.reasonCodes.join(", ")}`);
    console.log(`- queueReconcile.sectionsPresent.workQueue: ${qr.sectionsPresent.workQueue}`);
    console.log(`- queueReconcile.sectionsPresent.executionQueue: ${qr.sectionsPresent.executionQueue}`);
    console.log(`- queueReconcile.sectionsPresent.autonomousKickoffQueue: ${qr.sectionsPresent.autonomousKickoffQueue}`);
    console.log(`- queueReconcile.sectionsPresent.selfImprovementBacklog: ${qr.sectionsPresent.selfImprovementBacklog}`);
    console.log(`- queueReconcile.healedSections: ${qr.healedSections.length > 0 ? qr.healedSections.join(", ") : "none"}`);
    console.log(`- queueReconcile.mutated: ${"mutated" in qr ? (qr as QueueReconcileResult & { mutated?: boolean }).mutated ?? "n/a" : "n/a"}`);
  }
}

function printMachineReadableSummary(summary: PlanSeedCliSummary): void {
  console.log("PLAN_SEED_JSON_START");
  console.log(JSON.stringify(summary, null, 2));
  console.log("PLAN_SEED_JSON_END");
}

function main(): void {
  let args: PlanSeedCliArgs;

  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const summary: PlanSeedCliSummary = {
      status: "failed",
      selectedBacklogLine: null,
      newSliceHeading: null,
      reasonCode: "PLAN_SEED_INPUT_INVALID",
      queueReconcile: null,
      artifact: {
        artifactPath: null,
        preflightResult: null,
        preflightReasonCode: null,
      },
    };

    console.error("TASKPAD plan-seed: FAIL");
    console.error(`- ${message}`);
    printHelp();
    printMachineReadableSummary(summary);
    process.exit(1);
  }

  if (!args.taskpadPath || !args.planPath) {
    const summary: PlanSeedCliSummary = {
      status: "failed",
      selectedBacklogLine: null,
      newSliceHeading: null,
      reasonCode: "PLAN_SEED_INPUT_INVALID",
      queueReconcile: null,
      artifact: {
        artifactPath: null,
        preflightResult: null,
        preflightReasonCode: null,
      },
    };

    console.error("TASKPAD plan-seed: FAIL");
    console.error("- Missing required --taskpad <path> and/or --plan <path>.");
    printHelp();
    printMachineReadableSummary(summary);
    process.exit(1);
  }

  const resolvedTaskpadPath = resolve(args.taskpadPath);
  const resolvedPlanPath = resolve(args.planPath);
  const runDate = args.date ?? formatUtcDate();

  if (!isValidIsoDate(runDate)) {
    const summary: PlanSeedCliSummary = {
      status: "failed",
      selectedBacklogLine: null,
      newSliceHeading: null,
      reasonCode: "PLAN_SEED_INPUT_INVALID",
      queueReconcile: null,
      artifact: {
        artifactPath: null,
        preflightResult: null,
        preflightReasonCode: null,
      },
    };

    console.error("TASKPAD plan-seed: FAIL");
    console.error(`- Invalid --date value: ${runDate}. Expected YYYY-MM-DD.`);
    printMachineReadableSummary(summary);
    process.exit(1);
  }

  let result: PlanSeedRunResult;

  try {
    result = runTaskpadPlanSeed(resolvedTaskpadPath, resolvedPlanPath, runDate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const summary: PlanSeedCliSummary = {
      status: "failed",
      selectedBacklogLine: null,
      newSliceHeading: null,
      reasonCode: "PLAN_SEED_INPUT_INVALID",
      queueReconcile: null,
      artifact: {
        artifactPath: null,
        preflightResult: null,
        preflightReasonCode: null,
      },
    };

    console.error("TASKPAD plan-seed: FAIL");
    console.error(`- ${message}`);
    printMachineReadableSummary(summary);
    process.exit(1);
  }

  printHumanSummary(result);
  printMachineReadableSummary(result.summary);

  // Exit 0 for seeded/noop/fallback (direct-write or fallback-artifact), non-zero for failed (error)
  process.exit(result.summary.status === "failed" ? 1 : 0);
}

if (import.meta.main) {
  main();
}
