#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  isolateNewestTaskpadIntakeSlice,
  validateRequiredSectionPresence,
  validateTaskGraphTaskLines,
  validateVerificationCommandsBlock,
} from "./implementation-plan-integrity";
import { countQueueHealth } from "./taskpad-queue-health";
import {
  classifyWritePreflightError,
  probeTaskpadWriteability,
  type TaskpadWritePreflightReasonCode,
} from "./taskpad-write-preflight";

const ACTIVE_SLICE_HEADING_REGEX = /^##\s+TASKPAD Intake Slice\b/;
const H2_HEADING_REGEX = /^##\s+/;
const H3_HEADING_REGEX = /^###\s+/;
const TASK_GRAPH_HEADING = "### Task Graph";
const TP_TASK_LINE_REGEX = /^- \[[ xX]\] \*\*TP(\d{3})\*\*:\s+.+/;
const TP_UNCHECKED_TASK_LINE_REGEX = /^- \[\s*\] \*\*TP(\d{3})\*\*:\s+.+/;
const TP_CHECKED_TASK_LINE_REGEX = /^- \[[xX]\] \*\*TP(\d{3})\*\*:\s+.+/;
const SELF_IMPROVEMENT_BACKLOG_HEADING = "## Self-Improvement Backlog";
const WORK_QUEUE_HEADING = "## Work Queue";

/** Allowed target queue values for --target-queue CLI option */
const ALLOWED_TARGET_QUEUES = ["self-improvement", "work"] as const;
type TargetQueue = (typeof ALLOWED_TARGET_QUEUES)[number];

/** Deterministic rule IDs for target-routing contract diagnostics */
const TARGET_ROUTING_RULE_IDS = {
  /** Target queue value is valid and supported */
  VALID_TARGET_QUEUE: "TQR001_VALID_TARGET_QUEUE",
  /** Target queue value is invalid or unsupported */
  INVALID_TARGET_QUEUE: "TQR002_INVALID_TARGET_QUEUE",
  /** Default target queue used (backward compatibility) */
  DEFAULT_TARGET_QUEUE: "TQR003_DEFAULT_TARGET_QUEUE",
  /** Work Queue insertion path selected */
  WORK_QUEUE_PATH: "TQR004_WORK_QUEUE_PATH",
  /** Self-Improvement Backlog insertion path selected */
  SELF_IMPROVEMENT_PATH: "TQR005_SELF_IMPROVEMENT_PATH",
} as const;
const UNCHECKED_BULLET_REGEX = /^\s*[-*+]\s+\[\s*\]\s+(.+)$/;
const MAX_RECENT_COMPLETED_THEMES = 3;
const FALLBACK_ARTIFACT_ROOT = join("artifacts", "taskpad-auto-ideation");
const FALLBACK_PATCH_VERSION = 1;
const FALLBACK_APPLY_HINT =
  "Apply patch.content to patch.targetPath in a writable environment, then re-run taskpad:auto-ideation to confirm seeded/deduped state.";
const PLANNED_PREFIX_REGEX = /^planned-(?:\d{4}-\d{2}-\d{2}|YYYY-MM-DD)\s+/i;
const SEMANTIC_KEY_SEPARATOR_NORMALIZATION_REGEX = /[\/_\-.,:;()]/g;
const SEMANTIC_KEY_NUMERIC_TOKEN_REGEX = /^\d+$/;
const SEMANTIC_KEY_IGNORED_TOKENS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "for",
  "of",
  "in",
  "on",
  "by",
  "with",
  "from",
  "into",
  "via",
  "is",
  "are",
  "be",
  "this",
  "that",
  "one",
  "next",
  "item",
  "planned",
  "yyyy",
  "mm",
  "dd",
]);
const SEMANTIC_KEY_SYNONYM_FOLD_MAP = new Map<string, string>([
  ["dedupe", "dedupe"],
  ["deduped", "dedupe"],
  ["deduping", "dedupe"],
  ["duplicate", "dedupe"],
  ["duplicates", "dedupe"],
  ["duplicated", "dedupe"],
  ["duplication", "dedupe"],
  ["normalize", "normalize"],
  ["normalized", "normalize"],
  ["normalization", "normalize"],
  ["normalise", "normalize"],
  ["canonical", "normalize"],
  ["canonicalize", "normalize"],
  ["canonicalized", "normalize"],
  ["canonicalization", "normalize"],
  ["verify", "verify"],
  ["verified", "verify"],
  ["verification", "verify"],
  ["validate", "verify"],
  ["validated", "verify"],
  ["validation", "verify"],
  ["preflight", "preflight"],
  ["precheck", "preflight"],
  ["pre-check", "preflight"],
  ["writable", "writable"],
  ["writeable", "writable"],
  ["taskpad", "taskpad"],
  ["backlog", "taskpad"],
  ["queue", "taskpad"],
]);

export interface TaskpadQueueParserStatus {
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

  // Executable-queue-aware empty state (canonical trigger for auto-ideation)
  queuesAreEmpty: boolean;
}

export interface ActiveIntakeStatus {
  hasActiveSlice: boolean;
  activeSliceHeading: string | null;
  activeSliceStartLine: number | null;
  activeSliceEndLine: number | null;
  requiredSectionsPass: boolean;
  taskGraphPass: boolean;
  verificationCommandsPass: boolean;
  parsedTaskIds: string[];
  uncheckedTaskIds: string[];
}

export interface AutoIdeationParseSnapshot {
  queueStatus: TaskpadQueueParserStatus;
  intakeStatus: ActiveIntakeStatus;
}

interface TaskpadSliceBlock {
  heading: string;
  markdown: string;
}

export interface RankedCandidateRankingInputs {
  intakeGateSignal: string;
  recentSliceTheme: string;
  qualityRiskSignal: string;
}

export interface RankedCandidateScoreBreakdown {
  intakeGate: number;
  recentSliceTheme: number;
  qualityRisk: number;
  total: number;
}

export interface RankedCandidateTieBreak {
  canonicalCandidateId: string;
  canonicalTitle: string;
  canonicalBullet: string;
}

export interface RankedCandidateBullet {
  id: string;
  title: string;
  canonicalBullet: string;
  score: number;
  scoreBreakdown: RankedCandidateScoreBreakdown;
  stableSortKey: string;
  tieBreak: RankedCandidateTieBreak;
  rankingInputs: RankedCandidateRankingInputs;
}

export interface CandidateSelectionResult {
  selectedCandidate: RankedCandidateBullet;
  selectedCandidateId: string;
}

export interface SemanticDedupeRationale {
  decision: "inserted" | "deduped" | "not-applicable";
  candidateSemanticKey: string | null;
  matchedSemanticKey: string | null;
  rationale: string;
}

export interface BacklogInsertionResult {
  action: "inserted" | "deduped";
  updatedTaskpadMarkdown: string;
  insertedLine: number | null;
  matchedExistingLine: number | null;
  canonicalInsertedBullet: string;
  semanticDedupe: SemanticDedupeRationale;
}

interface MarkdownLineModel {
  lines: string[];
  newline: "\n" | "\r\n";
  hadTrailingNewline: boolean;
}

interface FallbackPatchArtifact {
  version: number;
  kind: "taskpad-auto-ideation-fallback-patch";
  taskpadPath: string;
  taskpadSha256: string;
  selectedCandidateId: string;
  selectedOutcome: {
    action: "would-insert";
    canonicalBullet: string;
    insertedLine: number;
  };
  patch: {
    format: "unified-diff";
    targetPath: string;
    content: string;
  };
  applyHint: string;
}

function extractSectionLines(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);

  if (headingIndex === -1) {
    return [];
  }

  const sectionLines: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (H3_HEADING_REGEX.test(trimmed)) {
      break;
    }
    sectionLines.push(lines[i]);
  }

  return sectionLines;
}

function extractUncheckedTaskIds(taskGraphLines: string[]): string[] {
  const uncheckedTaskIds: string[] = [];

  for (const line of taskGraphLines) {
    const trimmed = line.trim();
    const match = trimmed.match(TP_UNCHECKED_TASK_LINE_REGEX);
    if (!match) {
      continue;
    }

    uncheckedTaskIds.push(`TP${match[1]}`);
  }

  return uncheckedTaskIds;
}

function extractAllParsedTaskIds(taskGraphLines: string[]): string[] {
  const parsedTaskIds: string[] = [];

  for (const line of taskGraphLines) {
    const trimmed = line.trim();
    const match = trimmed.match(TP_TASK_LINE_REGEX);
    if (!match) {
      continue;
    }

    parsedTaskIds.push(`TP${match[1]}`);
  }

  return parsedTaskIds;
}

function isolateTaskpadIntakeSlices(planMarkdown: string): TaskpadSliceBlock[] {
  const lines = planMarkdown.split(/\r?\n/);
  const sliceStartIndexes: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (ACTIVE_SLICE_HEADING_REGEX.test(lines[i].trim())) {
      sliceStartIndexes.push(i);
    }
  }

  const slices: TaskpadSliceBlock[] = [];

  for (const startIndex of sliceStartIndexes) {
    let endIndex = lines.length;

    for (let i = startIndex + 1; i < lines.length; i++) {
      if (H2_HEADING_REGEX.test(lines[i].trim())) {
        endIndex = i;
        break;
      }
    }

    slices.push({
      heading: lines[startIndex].trim(),
      markdown: lines.slice(startIndex, endIndex).join("\n"),
    });
  }

  return slices;
}

function extractSliceThemeFromHeading(heading: string): string {
  const match = heading.match(/^##\s+TASKPAD Intake Slice\s*\([^)]*\):\s*(.+)$/);
  if (match) {
    return match[1].trim();
  }

  return heading.replace(/^##\s+TASKPAD Intake Slice\s*/i, "").trim();
}

function isCompletedSlice(sliceMarkdown: string): boolean {
  const taskGraphLines = extractSectionLines(sliceMarkdown, TASK_GRAPH_HEADING)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const checkedTaskLines = taskGraphLines.filter((line) => TP_CHECKED_TASK_LINE_REGEX.test(line));
  const uncheckedTaskLines = taskGraphLines.filter((line) => TP_UNCHECKED_TASK_LINE_REGEX.test(line));

  return checkedTaskLines.length > 0 && uncheckedTaskLines.length === 0;
}

function extractRecentCompletedSliceThemes(planMarkdown: string): string[] {
  const slices = isolateTaskpadIntakeSlices(planMarkdown);
  const completedThemes: string[] = [];

  for (let i = 1; i < slices.length; i++) {
    if (!isCompletedSlice(slices[i].markdown)) {
      continue;
    }

    const theme = extractSliceThemeFromHeading(slices[i].heading);
    if (theme.length === 0 || completedThemes.includes(theme)) {
      continue;
    }

    completedThemes.push(theme);
    if (completedThemes.length === MAX_RECENT_COMPLETED_THEMES) {
      break;
    }
  }

  return completedThemes;
}

function extractUnresolvedQualityRisksFromActiveSlice(planMarkdown: string): string[] {
  const activeSlice = isolateNewestTaskpadIntakeSlice(planMarkdown);
  if (!activeSlice) {
    return [];
  }

  const lines = activeSlice.markdown.split(/\r?\n/);
  const risks: string[] = [];
  let inRiskBlock = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!inRiskBlock && /\*\*Risks\/edge cases to inspect:\*\*/i.test(trimmed)) {
      inRiskBlock = true;
      continue;
    }

    if (!inRiskBlock) {
      continue;
    }

    if (trimmed.startsWith("- **") || H3_HEADING_REGEX.test(trimmed)) {
      break;
    }

    if (!trimmed.startsWith("- ")) {
      continue;
    }

    const normalizedRisk = trimmed.slice(2).trim();
    if (normalizedRisk.length > 0) {
      risks.push(normalizedRisk);
    }
  }

  return risks;
}

function buildIntakeGateSignal(snapshot: AutoIdeationParseSnapshot): string {
  const queueSignal = snapshot.queueStatus.queuesAreEmpty
    ? "queue-health reports both execution queues empty"
    : "queue-health reports pending unchecked queue items";

  const integritySignals = [
    snapshot.intakeStatus.requiredSectionsPass ? "required sections pass" : "required sections failing",
    snapshot.intakeStatus.taskGraphPass ? "task graph pass" : "task graph failing",
    snapshot.intakeStatus.verificationCommandsPass
      ? "verification commands pass"
      : "verification commands failing",
  ].join(", ");

  return `${queueSignal}; intake-status: ${integritySignals}`;
}

function buildCanonicalBullet(actionText: string, targetQueue: TargetQueue = "self-improvement"): string {
  const normalizedAction = actionText.replace(/\s+/g, " ").trim();
  const baseBullet = `- [ ] planned-YYYY-MM-DD ${normalizedAction}`;
  
  // Work Queue bullets include verify-command scaffold for planned-command-parity compatibility
  if (targetQueue === "work") {
    return `${baseBullet} Verify: <command>`;
  }
  
  return baseBullet;
}

function buildCandidateScoreBreakdown(
  candidateId: string,
  snapshot: AutoIdeationParseSnapshot,
  hasThemeSignal: boolean,
  hasQualityRiskSignal: boolean,
): RankedCandidateScoreBreakdown {
  const queueBase = snapshot.queueStatus.queuesAreEmpty ? 45 : 10;
  const integrityPenalty =
    (snapshot.intakeStatus.requiredSectionsPass ? 0 : 3) +
    (snapshot.intakeStatus.taskGraphPass ? 0 : 3) +
    (snapshot.intakeStatus.verificationCommandsPass ? 0 : 3);

  const intakeGate = queueBase - integrityPenalty + (candidateId === "AIC001" ? 25 : 0);
  const recentSliceTheme = candidateId === "AIC002" ? (hasThemeSignal ? 20 : 8) : 0;
  const qualityRisk = candidateId === "AIC003" ? (hasQualityRiskSignal ? 18 : 6) : 0;

  return {
    intakeGate,
    recentSliceTheme,
    qualityRisk,
    total: intakeGate + recentSliceTheme + qualityRisk,
  };
}

function normalizeCanonicalTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildCandidateTieBreak(candidate: {
  id: string;
  title: string;
  canonicalBullet: string;
}): RankedCandidateTieBreak {
  return {
    canonicalCandidateId: candidate.id,
    canonicalTitle: normalizeCanonicalTitle(candidate.title),
    canonicalBullet: candidate.canonicalBullet.replace(/\s+/g, " ").trim(),
  };
}

function descendingLexicalKey(value: number): string {
  return String(10000 - value).padStart(5, "0");
}

function buildStableSortKey(
  scoreBreakdown: RankedCandidateScoreBreakdown,
  tieBreak: RankedCandidateTieBreak,
): string {
  return [
    `dtotal:${descendingLexicalKey(scoreBreakdown.total)}`,
    `dquality:${descendingLexicalKey(scoreBreakdown.qualityRisk)}`,
    `drecent:${descendingLexicalKey(scoreBreakdown.recentSliceTheme)}`,
    `dintake:${descendingLexicalKey(scoreBreakdown.intakeGate)}`,
    `id:${tieBreak.canonicalCandidateId}`,
    `title:${tieBreak.canonicalTitle}`,
    `bullet:${tieBreak.canonicalBullet}`,
  ].join("|");
}

function compareRankedCandidates(a: RankedCandidateBullet, b: RankedCandidateBullet): number {
  if (b.scoreBreakdown.total !== a.scoreBreakdown.total) {
    return b.scoreBreakdown.total - a.scoreBreakdown.total;
  }

  if (b.scoreBreakdown.qualityRisk !== a.scoreBreakdown.qualityRisk) {
    return b.scoreBreakdown.qualityRisk - a.scoreBreakdown.qualityRisk;
  }

  if (b.scoreBreakdown.recentSliceTheme !== a.scoreBreakdown.recentSliceTheme) {
    return b.scoreBreakdown.recentSliceTheme - a.scoreBreakdown.recentSliceTheme;
  }

  if (b.scoreBreakdown.intakeGate !== a.scoreBreakdown.intakeGate) {
    return b.scoreBreakdown.intakeGate - a.scoreBreakdown.intakeGate;
  }

  const idCompare = a.tieBreak.canonicalCandidateId.localeCompare(b.tieBreak.canonicalCandidateId);
  if (idCompare !== 0) {
    return idCompare;
  }

  const titleCompare = a.tieBreak.canonicalTitle.localeCompare(b.tieBreak.canonicalTitle);
  if (titleCompare !== 0) {
    return titleCompare;
  }

  return a.tieBreak.canonicalBullet.localeCompare(b.tieBreak.canonicalBullet);
}

export function synthesizeRankedCandidateBullets(
  taskpadMarkdown: string,
  planMarkdown: string,
  targetQueue: TargetQueue = "self-improvement",
): RankedCandidateBullet[] {
  const snapshot = parseAutoIdeationInputs(taskpadMarkdown, planMarkdown);
  const recentThemes = extractRecentCompletedSliceThemes(planMarkdown);
  const unresolvedQualityRisks = extractUnresolvedQualityRisksFromActiveSlice(planMarkdown);

  const primaryTheme = recentThemes[0] ?? "recent intake gate hardening";
  const secondaryTheme = recentThemes[1] ?? primaryTheme;
  const primaryRisk =
    unresolvedQualityRisks[0] ??
    "candidate quality regressions when parsing does not prioritize top active intake slices";

  const intakeGateSignal = buildIntakeGateSignal(snapshot);

  const hasThemeSignal = recentThemes.length > 0;
  const hasQualityRiskSignal = unresolvedQualityRisks.length > 0;

  const baseCandidates = [
    {
      id: "AIC001",
      title: "Auto-ideation deterministic ranking harness",
      canonicalBullet: buildCanonicalBullet(
        "add deterministic ranking fixtures for taskpad auto-ideation (exactly three candidates with stable tie-break ordering)",
        targetQueue,
      ),
      rankingInputs: {
        intakeGateSignal,
        recentSliceTheme: primaryTheme,
        qualityRiskSignal: primaryRisk,
      },
    },
    {
      id: "AIC002",
      title: "Recent-slice theme carry-forward guard",
      canonicalBullet: buildCanonicalBullet(
        `add active-slice recency guard so auto-ideation weights the newest completed themes (starting with ${primaryTheme}) before archived slices`,
        targetQueue,
      ),
      rankingInputs: {
        intakeGateSignal,
        recentSliceTheme: secondaryTheme,
        qualityRiskSignal: primaryRisk,
      },
    },
    {
      id: "AIC003",
      title: "Quality-risk signal extraction hardening",
      canonicalBullet: buildCanonicalBullet(
        `harden unresolved quality-risk extraction so queue seeding surfaces remediation for: ${primaryRisk}`,
        targetQueue,
      ),
      rankingInputs: {
        intakeGateSignal,
        recentSliceTheme: primaryTheme,
        qualityRiskSignal: primaryRisk,
      },
    },
  ] as const;

  const candidates: RankedCandidateBullet[] = baseCandidates.map((candidate) => {
    const scoreBreakdown = buildCandidateScoreBreakdown(
      candidate.id,
      snapshot,
      hasThemeSignal,
      hasQualityRiskSignal,
    );
    const tieBreak = buildCandidateTieBreak(candidate);

    return {
      ...candidate,
      score: scoreBreakdown.total,
      scoreBreakdown,
      stableSortKey: buildStableSortKey(scoreBreakdown, tieBreak),
      tieBreak,
    };
  });

  return candidates.sort(compareRankedCandidates);
}

function parseMarkdownWithNewlineStyle(markdown: string): MarkdownLineModel {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const newline: "\n" | "\r\n" = markdown.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = normalizedMarkdown.endsWith("\n");
  const lines = normalizedMarkdown.split("\n");

  if (hadTrailingNewline && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return {
    lines,
    newline,
    hadTrailingNewline,
  };
}

function stringifyMarkdownWithNewlineStyle(model: MarkdownLineModel): string {
  const joined = model.lines.join(model.newline);
  return model.hadTrailingNewline ? `${joined}${model.newline}` : joined;
}

function formatDateForPlannedPrefix(runDate: Date): string {
  const year = runDate.getUTCFullYear();
  const month = String(runDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(runDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function materializeCanonicalBullet(canonicalBulletTemplate: string, runDate: Date): string {
  const normalizedTemplate = canonicalBulletTemplate.trim();
  const dateStamp = formatDateForPlannedPrefix(runDate);

  if (normalizedTemplate.includes("planned-YYYY-MM-DD")) {
    return normalizedTemplate.replace("planned-YYYY-MM-DD", `planned-${dateStamp}`);
  }

  return normalizedTemplate.replace(/planned-\d{4}-\d{2}-\d{2}/i, `planned-${dateStamp}`);
}

/** Case-insensitive Verify: clause pattern for semantic key extraction */
const VERIFY_CLAUSE_REGEX = /\bVerify:\s*.+$/i;

export function buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet(line: string): string | null {
  const uncheckedMatch = line.trim().match(UNCHECKED_BULLET_REGEX);
  if (!uncheckedMatch) {
    return null;
  }

  // Strip Verify: clause for semantic key computation (preserves compatibility across verify scaffolds)
  const contentWithoutVerify = uncheckedMatch[1].replace(VERIFY_CLAUSE_REGEX, "").trim();

  const normalizedContent = contentWithoutVerify
    .replace(PLANNED_PREFIX_REGEX, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (normalizedContent.length === 0) {
    return null;
  }

  const separatorNormalized = normalizedContent
    .replace(/pre\s*-\s*check/g, "precheck")
    .replace(SEMANTIC_KEY_SEPARATOR_NORMALIZATION_REGEX, " ");

  const rawTokens = separatorNormalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const foldedTokens: string[] = [];

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i];

    if (token === "pre" && rawTokens[i + 1] === "check") {
      foldedTokens.push("preflight");
      i += 1;
      continue;
    }

    foldedTokens.push(SEMANTIC_KEY_SYNONYM_FOLD_MAP.get(token) ?? token);
  }

  const filteredUniqueSortedTokens = [...new Set(foldedTokens)]
    .filter((token) => !SEMANTIC_KEY_IGNORED_TOKENS.has(token))
    .filter((token) => !SEMANTIC_KEY_NUMERIC_TOKEN_REGEX.test(token))
    .sort((a, b) => a.localeCompare(b));

  if (filteredUniqueSortedTokens.length === 0) {
    return null;
  }

  return filteredUniqueSortedTokens.join(":");
}

function findSectionBounds(lines: string[], heading: string): { headingIndex: number; sectionEndIndex: number } {
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) {
    throw new Error(`Missing required heading: ${heading}`);
  }

  let sectionEndIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (H2_HEADING_REGEX.test(lines[i].trim())) {
      sectionEndIndex = i;
      break;
    }
  }

  return { headingIndex, sectionEndIndex };
}

/** @deprecated Use findSectionBounds instead */
function findSelfImprovementBacklogBounds(lines: string[]): { headingIndex: number; sectionEndIndex: number } {
  return findSectionBounds(lines, SELF_IMPROVEMENT_BACKLOG_HEADING);
}

function getInsertionIndex(lines: string[], headingIndex: number, sectionEndIndex: number): number {
  let insertionIndex = sectionEndIndex;

  while (insertionIndex > headingIndex + 1 && lines[insertionIndex - 1].trim() === "") {
    insertionIndex--;
  }

  return insertionIndex;
}

export function selectBestCandidate(candidates: RankedCandidateBullet[]): CandidateSelectionResult {
  if (candidates.length === 0) {
    throw new Error("Cannot select best candidate from an empty candidate list.");
  }

  const [bestCandidate] = [...candidates].sort(compareRankedCandidates);

  return {
    selectedCandidate: bestCandidate,
    selectedCandidateId: bestCandidate.id,
  };
}

export function insertSelectedCandidateIntoTargetQueue(
  taskpadMarkdown: string,
  selectedCandidate: RankedCandidateBullet,
  targetQueue: TargetQueue,
  runDate: Date = new Date(),
): BacklogInsertionResult {
  const markdownModel = parseMarkdownWithNewlineStyle(taskpadMarkdown);
  const { lines } = markdownModel;
  const insertionHeading = getInsertionHeadingForTargetQueue(targetQueue);
  const { headingIndex, sectionEndIndex } = findSectionBounds(lines, insertionHeading);
  const candidateBullet = materializeCanonicalBullet(selectedCandidate.canonicalBullet, runDate);
  const candidateSemanticKey = buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet(candidateBullet);

  if (!candidateSemanticKey) {
    throw new Error(`Selected candidate produced a non-canonical bullet: ${selectedCandidate.id}`);
  }

  for (let i = headingIndex + 1; i < sectionEndIndex; i++) {
    const existingSemanticKey = buildCanonicalSemanticKeyForUncheckedSelfImprovementBullet(lines[i]);
    if (existingSemanticKey && existingSemanticKey === candidateSemanticKey) {
      return {
        action: "deduped",
        updatedTaskpadMarkdown: taskpadMarkdown,
        insertedLine: null,
        matchedExistingLine: i + 1,
        canonicalInsertedBullet: lines[i].trim(),
        semanticDedupe: {
          decision: "deduped",
          candidateSemanticKey,
          matchedSemanticKey: existingSemanticKey,
          rationale: `semantic-equivalent unchecked backlog bullet already exists at line ${i + 1}`,
        },
      };
    }
  }

  const insertionIndex = getInsertionIndex(lines, headingIndex, sectionEndIndex);
  lines.splice(insertionIndex, 0, candidateBullet);

  return {
    action: "inserted",
    updatedTaskpadMarkdown: stringifyMarkdownWithNewlineStyle(markdownModel),
    insertedLine: insertionIndex + 1,
    matchedExistingLine: null,
    canonicalInsertedBullet: candidateBullet,
    semanticDedupe: {
      decision: "inserted",
      candidateSemanticKey,
      matchedSemanticKey: null,
      rationale: `no semantic-equivalent unchecked backlog bullet found in ${insertionHeading}`,
    },
  };
}

/** @deprecated Use insertSelectedCandidateIntoTargetQueue instead */
export function insertSelectedCandidateIntoSelfImprovementBacklog(
  taskpadMarkdown: string,
  selectedCandidate: RankedCandidateBullet,
  runDate: Date = new Date(),
): BacklogInsertionResult {
  return insertSelectedCandidateIntoTargetQueue(taskpadMarkdown, selectedCandidate, "self-improvement", runDate);
}

export function parseTaskpadQueueStatus(taskpadMarkdown: string): TaskpadQueueParserStatus {
  const counts = countQueueHealth(taskpadMarkdown);

  return {
    ...counts,
    // Executable-queue-aware readiness: auto-ideation should trigger when
    // Work Queue and Execution Queue are both empty, regardless of intake queue state
    queuesAreEmpty: counts.executableQueueTotal === 0,
  };
}

export function parseActiveIntakeStatus(planMarkdown: string): ActiveIntakeStatus {
  const activeSlice = isolateNewestTaskpadIntakeSlice(planMarkdown);

  if (!activeSlice) {
    return {
      hasActiveSlice: false,
      activeSliceHeading: null,
      activeSliceStartLine: null,
      activeSliceEndLine: null,
      requiredSectionsPass: false,
      taskGraphPass: false,
      verificationCommandsPass: false,
      parsedTaskIds: [],
      uncheckedTaskIds: [],
    };
  }

  const requiredSections = validateRequiredSectionPresence(activeSlice.markdown);
  const taskGraph = validateTaskGraphTaskLines(activeSlice.markdown);
  const verification = validateVerificationCommandsBlock(activeSlice.markdown);
  const taskGraphLines = extractSectionLines(activeSlice.markdown, TASK_GRAPH_HEADING);

  return {
    hasActiveSlice: true,
    activeSliceHeading: activeSlice.heading,
    activeSliceStartLine: activeSlice.startLine,
    activeSliceEndLine: activeSlice.endLine,
    requiredSectionsPass: requiredSections.passes,
    taskGraphPass: taskGraph.passes,
    verificationCommandsPass: verification.passes,
    parsedTaskIds: extractAllParsedTaskIds(taskGraphLines),
    uncheckedTaskIds: extractUncheckedTaskIds(taskGraphLines),
  };
}

export function parseAutoIdeationInputs(taskpadMarkdown: string, planMarkdown: string): AutoIdeationParseSnapshot {
  return {
    queueStatus: parseTaskpadQueueStatus(taskpadMarkdown),
    intakeStatus: parseActiveIntakeStatus(planMarkdown),
  };
}

interface AutoIdeationCliArgs {
  taskpadPath?: string;
  planPath?: string;
  targetQueue?: TargetQueue;
}

/** Target queue routing metadata for CLI output */
interface TargetQueueRoutingMetadata {
  targetQueue: TargetQueue;
  insertionSection: string;
  ruleId: string;
}

type AutoIdeationPreflightMode = "direct-write" | "fallback-artifact" | "error";

interface AutoIdeationPreflightMetadata {
  mode: AutoIdeationPreflightMode;
  writable: boolean;
  reasonCode: TaskpadWritePreflightReasonCode;
}

/** Queue parity status after ideation */
export interface QueueParityStatus {
  hasExecutableItems: boolean;
  targetQueueUncheckedCount: number;
  parityStatus: "parity-pass" | "parity-fail-empty" | "parity-fail-unknown";
}

export interface AutoIdeationCliResult {
  status: "seeded" | "deduped" | "noop" | "fallback";
  triggered: boolean;
  queueHealth: {
    autonomousUncheckedCount: number;
    selfImprovementUncheckedCount: number;
    totalUnchecked: number;
  };
  preflight: AutoIdeationPreflightMetadata | null;
  targetQueueRouting: TargetQueueRoutingMetadata | null;
  queueParityStatus: QueueParityStatus | null;
  candidates: RankedCandidateBullet[];
  selectedCandidateId: string | null;
  selectedOutcome: {
    action: "inserted" | "deduped" | "noop" | "fallback";
    taskpadPath: string;
    insertedLine: number | null;
    matchedExistingLine: number | null;
    semanticDedupe: SemanticDedupeRationale;
  };
  artifactPath: string | null;
  applyHint: string | null;
}

function isPreflightPermissionDeniedReason(reasonCode: TaskpadWritePreflightReasonCode): boolean {
  return (
    reasonCode === "PRECHECK_PERMISSION_EPERM" ||
    reasonCode === "PRECHECK_PERMISSION_EACCES" ||
    reasonCode === "PRECHECK_PERMISSION_EROFS" ||
    reasonCode === "PRECHECK_PERMISSION_DENIED_GENERIC"
  );
}

function toPortablePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function resolveFallbackArtifactCandidatePaths(taskpadPath: string): string[] {
  const fileName = `${basename(taskpadPath)}.auto-ideation.patch.json`;
  return [
    resolve(process.cwd(), FALLBACK_ARTIFACT_ROOT, fileName),
    resolve(dirname(taskpadPath), ".taskpad-auto-ideation", fileName),
    resolve(tmpdir(), "taskpad-auto-ideation", fileName),
  ];
}

function buildUnifiedDiffPatch(targetPath: string, originalMarkdown: string, updatedMarkdown: string): string {
  const originalModel = parseMarkdownWithNewlineStyle(originalMarkdown);
  const updatedModel = parseMarkdownWithNewlineStyle(updatedMarkdown);
  const normalizedTargetPath = toPortablePath(targetPath);

  const patchLines = [
    `--- a/${normalizedTargetPath}`,
    `+++ b/${normalizedTargetPath}`,
    `@@ -1,${originalModel.lines.length} +1,${updatedModel.lines.length} @@`,
    ...originalModel.lines.map((line) => `-${line}`),
    ...updatedModel.lines.map((line) => `+${line}`),
  ];

  return `${patchLines.join("\n")}\n`;
}

export function writeFallbackPatchArtifact(params: {
  taskpadPath: string;
  taskpadMarkdown: string;
  insertion: BacklogInsertionResult;
  selectedCandidateId: string;
}): string {
  if (params.insertion.action !== "inserted" || params.insertion.insertedLine === null) {
    throw new Error("Fallback artifact generation requires an inserted backlog candidate.");
  }

  const artifact: FallbackPatchArtifact = {
    version: FALLBACK_PATCH_VERSION,
    kind: "taskpad-auto-ideation-fallback-patch",
    taskpadPath: params.taskpadPath,
    taskpadSha256: createHash("sha256").update(params.taskpadMarkdown, "utf8").digest("hex"),
    selectedCandidateId: params.selectedCandidateId,
    selectedOutcome: {
      action: "would-insert",
      canonicalBullet: params.insertion.canonicalInsertedBullet,
      insertedLine: params.insertion.insertedLine,
    },
    patch: {
      format: "unified-diff",
      targetPath: params.taskpadPath,
      content: buildUnifiedDiffPatch(
        params.taskpadPath,
        params.taskpadMarkdown,
        params.insertion.updatedTaskpadMarkdown,
      ),
    },
    applyHint: FALLBACK_APPLY_HINT,
  };

  const artifactContent = `${JSON.stringify(artifact, null, 2)}\n`;
  const candidatePaths = resolveFallbackArtifactCandidatePaths(params.taskpadPath);
  let lastError: unknown = null;

  for (const artifactPath of candidatePaths) {
    try {
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(artifactPath, artifactContent, "utf8");
      return artifactPath;
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown");
  throw new Error(`Failed to persist fallback artifact to any supported location: ${message}`);
}

function printHelp(): void {
  console.log(`
TASKPAD Auto-Ideation

USAGE:
  bun run tools/taskpad-auto-ideation.ts --taskpad <path> --plan <path> [--target-queue <queue>]
  bun run tools/taskpad-auto-ideation.ts <taskpad-path> <plan-path>

OPTIONS:
  --taskpad <path>       Path to TASKPAD markdown file
  --plan <path>          Path to IMPLEMENTATION_PLAN markdown file
  --target-queue <queue> Target queue for insertion: "self-improvement" | "work" (default: "self-improvement")
  --help, -h             Show this help message

TARGET QUEUE CONTRACT:
  - "self-improvement": Insert into "## Self-Improvement Backlog" (default, backward compatible)
  - "work": Insert into "## Work Queue" for immediately executable items
  - Rule IDs: TQR001_VALID_TARGET_QUEUE, TQR002_INVALID_TARGET_QUEUE, TQR003_DEFAULT_TARGET_QUEUE

OUTPUT FIELDS (JSON):
  - queueParityStatus: Queue health parity after ideation
    - hasExecutableItems: true if target queue has unchecked items
    - targetQueueUncheckedCount: number of unchecked items in target queue
    - parityStatus: "parity-pass" | "parity-fail-empty" | "parity-fail-unknown"
`);
}

function isValidTargetQueue(value: string): value is TargetQueue {
  return ALLOWED_TARGET_QUEUES.includes(value as TargetQueue);
}

function getEffectiveTargetQueue(value: string | undefined): { targetQueue: TargetQueue; ruleId: string } {
  if (value === undefined) {
    return {
      targetQueue: "self-improvement",
      ruleId: TARGET_ROUTING_RULE_IDS.DEFAULT_TARGET_QUEUE,
    };
  }

  if (isValidTargetQueue(value)) {
    return {
      targetQueue: value,
      ruleId: TARGET_ROUTING_RULE_IDS.VALID_TARGET_QUEUE,
    };
  }

  // Invalid target queue falls back to default with error rule ID
  return {
    targetQueue: "self-improvement",
    ruleId: TARGET_ROUTING_RULE_IDS.INVALID_TARGET_QUEUE,
  };
}

function getInsertionHeadingForTargetQueue(targetQueue: TargetQueue): string {
  return targetQueue === "work" ? WORK_QUEUE_HEADING : SELF_IMPROVEMENT_BACKLOG_HEADING;
}

function getTargetQueuePathRuleId(targetQueue: TargetQueue): string {
  return targetQueue === "work"
    ? TARGET_ROUTING_RULE_IDS.WORK_QUEUE_PATH
    : TARGET_ROUTING_RULE_IDS.SELF_IMPROVEMENT_PATH;
}

export function computeQueueParityStatus(
  taskpadMarkdown: string,
  targetQueue: TargetQueue,
  insertionResult: BacklogInsertionResult | null,
  wasTriggered: boolean,
): QueueParityStatus {
  const queueStatus = parseTaskpadQueueStatus(taskpadMarkdown);
  const insertionHeading = getInsertionHeadingForTargetQueue(targetQueue);

  // Count unchecked items in the target queue section
  const targetQueueUncheckedCount = targetQueue === "work"
    ? queueStatus.autonomousUncheckedCount
    : queueStatus.selfImprovementUncheckedCount;

  // If ideation was triggered and we inserted a new item, account for it
  const effectiveTargetQueueCount = (insertionResult?.action === "inserted" && wasTriggered)
    ? targetQueueUncheckedCount + 1
    : targetQueueUncheckedCount;

  // Determine parity status
  let parityStatus: QueueParityStatus["parityStatus"] = "parity-fail-unknown";
  if (effectiveTargetQueueCount > 0) {
    parityStatus = "parity-pass";
  } else if (effectiveTargetQueueCount === 0) {
    parityStatus = "parity-fail-empty";
  }

  return {
    hasExecutableItems: effectiveTargetQueueCount > 0,
    targetQueueUncheckedCount: effectiveTargetQueueCount,
    parityStatus,
  };
}

function parseArgs(argv: string[]): AutoIdeationCliArgs {
  let taskpadPath: string | undefined;
  let planPath: string | undefined;
  let targetQueue: string | undefined;

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

    if (arg === "--target-queue") {
      i++;
      const value = argv[i];
      if (!value) {
        throw new Error("Missing value for --target-queue");
      }
      targetQueue = value;
      continue;
    }

    if (!arg.startsWith("-") && !taskpadPath) {
      taskpadPath = arg;
      continue;
    }

    if (!arg.startsWith("-") && !planPath) {
      planPath = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { taskpadPath, planPath, targetQueue };
}

function printHumanSummary(result: AutoIdeationCliResult): void {
  const statusLabel = result.status.toUpperCase();
  console.log(`TASKPAD auto-ideation: ${statusLabel}`);
  console.log(`- taskpadPath: ${result.selectedOutcome.taskpadPath}`);
  console.log(`- queue totalUnchecked: ${result.queueHealth.totalUnchecked}`);

  if (!result.triggered) {
    console.log("- trigger: skipped (queue already has unchecked work)");
    return;
  }

  if (result.preflight) {
    console.log(`- preflight.mode: ${result.preflight.mode}`);
    console.log(`- preflight.writable: ${result.preflight.writable}`);
    console.log(`- preflight.reasonCode: ${result.preflight.reasonCode}`);
  }

  if (result.targetQueueRouting) {
    console.log(`- targetQueue: ${result.targetQueueRouting.targetQueue}`);
    console.log(`- insertionSection: ${result.targetQueueRouting.insertionSection}`);
    console.log(`- targetQueueRouting.ruleId: ${result.targetQueueRouting.ruleId}`);
  }

  if (result.queueParityStatus) {
    console.log(`- queueParityStatus.hasExecutableItems: ${result.queueParityStatus.hasExecutableItems}`);
    console.log(`- queueParityStatus.targetQueueUncheckedCount: ${result.queueParityStatus.targetQueueUncheckedCount}`);
    console.log(`- queueParityStatus.parityStatus: ${result.queueParityStatus.parityStatus}`);
  }

  console.log("- trigger: queue empty, generated ranked candidates");
  console.log(`- selectedCandidateId: ${result.selectedCandidateId}`);
  console.log(`- selected action: ${result.selectedOutcome.action}`);
  console.log(`- semanticDedupe.decision: ${result.selectedOutcome.semanticDedupe.decision}`);
  console.log(`- semanticDedupe.rationale: ${result.selectedOutcome.semanticDedupe.rationale}`);
  console.log(
    `- semanticDedupe.candidateSemanticKey: ${result.selectedOutcome.semanticDedupe.candidateSemanticKey ?? "n/a"}`,
  );
  console.log(`- semanticDedupe.matchedSemanticKey: ${result.selectedOutcome.semanticDedupe.matchedSemanticKey ?? "n/a"}`);
  if (result.status === "fallback") {
    console.log("- write mode: permission denied; switched to fallback");
    console.log(`- artifactPath: ${result.artifactPath ?? "n/a"}`);
    console.log(`- applyHint: ${result.applyHint ?? "n/a"}`);
  }
  console.log(`- insertedLine: ${result.selectedOutcome.insertedLine ?? "n/a"}`);
  console.log(`- matchedExistingLine: ${result.selectedOutcome.matchedExistingLine ?? "n/a"}`);
  console.log("- candidates:");

  for (const candidate of result.candidates) {
    console.log(`  - ${candidate.id} (${candidate.score}) ${candidate.title}`);
  }
}

/**
 * Returns a stable JSON string representation with deterministic key ordering.
 * Object keys are sorted alphabetically for byte-for-byte deterministic output.
 */
function stringifyWithStableOrder<T>(value: T, space?: string | number): string {
  return JSON.stringify(value, (key, val) => {
    // For arrays, preserve element order (deterministic from source)
    if (Array.isArray(val)) {
      return val;
    }
    // For objects, return with sorted keys when we hit the object
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      return val;
    }
    return val;
  }, space);
}

/**
 * Post-process JSON string to ensure stable alphabetical key ordering
 */
function sortObjectKeysStable(jsonString: string): string {
  const parsed = JSON.parse(jsonString);

  function sortKeys(obj: unknown): unknown {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(sortKeys);
    }
    const sortedEntries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
    const sortedObj: Record<string, unknown> = {};
    for (const [key, value] of sortedEntries) {
      sortedObj[key] = sortKeys(value);
    }
    return sortedObj;
  }

  return JSON.stringify(sortKeys(parsed), null, 2);
}

function printMachineReadableJsonBlock(result: AutoIdeationCliResult): void {
  console.log("AUTO_IDEATION_JSON_START");
  const jsonString = sortObjectKeysStable(JSON.stringify(result, null, 2));
  console.log(jsonString);
  console.log("AUTO_IDEATION_JSON_END");
}

function buildFallbackResult(params: {
  taskpadPath: string;
  taskpadMarkdown: string;
  insertion: BacklogInsertionResult;
  selectedCandidateId: string;
  candidates: RankedCandidateBullet[];
  queueStatus: TaskpadQueueParserStatus;
  preflight: AutoIdeationPreflightMetadata;
  targetQueue: TargetQueue;
}): AutoIdeationCliResult {
  const artifactPath = writeFallbackPatchArtifact({
    taskpadPath: params.taskpadPath,
    taskpadMarkdown: params.taskpadMarkdown,
    insertion: params.insertion,
    selectedCandidateId: params.selectedCandidateId,
  });

  const insertionHeading = getInsertionHeadingForTargetQueue(params.targetQueue);
  const pathRuleId = getTargetQueuePathRuleId(params.targetQueue);
  const queueParityStatus = computeQueueParityStatus(
    params.taskpadMarkdown,
    params.targetQueue,
    params.insertion,
    true,
  );

  return {
    status: "fallback",
    triggered: true,
    queueHealth: {
      autonomousUncheckedCount: params.queueStatus.autonomousUncheckedCount,
      selfImprovementUncheckedCount: params.queueStatus.selfImprovementUncheckedCount,
      totalUnchecked: params.queueStatus.totalUnchecked,
    },
    preflight: params.preflight,
    targetQueueRouting: {
      targetQueue: params.targetQueue,
      insertionSection: insertionHeading,
      ruleId: pathRuleId,
    },
    queueParityStatus,
    candidates: params.candidates,
    selectedCandidateId: params.selectedCandidateId,
    selectedOutcome: {
      action: "fallback",
      taskpadPath: params.taskpadPath,
      insertedLine: params.insertion.insertedLine,
      matchedExistingLine: null,
      semanticDedupe: params.insertion.semanticDedupe,
    },
    artifactPath,
    applyHint: FALLBACK_APPLY_HINT,
  };
}

function runAutoIdeation(
  taskpadMarkdown: string,
  planMarkdown: string,
  taskpadPath: string,
  targetQueue: TargetQueue,
): AutoIdeationCliResult {
  const queueStatus = parseTaskpadQueueStatus(taskpadMarkdown);

  // PREFLIGHT-FIRST: Run preflight early to determine routing mode before any mutations
  const preflightProbe = probeTaskpadWriteability(taskpadPath);
  const preflightMode: AutoIdeationPreflightMode = preflightProbe.writable
    ? "direct-write"
    : isPreflightPermissionDeniedReason(preflightProbe.reasonCode)
      ? "fallback-artifact"
      : "error";

  const preflight: AutoIdeationPreflightMetadata = {
    mode: preflightMode,
    writable: preflightProbe.writable,
    reasonCode: preflightProbe.reasonCode,
  };

  // Non-permission preflight errors are fatal (path invalid, missing parent dir, etc.)
  if (preflight.mode === "error") {
    throw new Error(`TASKPAD write preflight failed for ${taskpadPath} with reasonCode=${preflight.reasonCode}.`);
  }

  if (!queueStatus.queuesAreEmpty) {
    const queueParityStatus = computeQueueParityStatus(
      taskpadMarkdown,
      targetQueue,
      null,
      false,
    );

    return {
      status: "noop",
      triggered: false,
      queueHealth: {
        autonomousUncheckedCount: queueStatus.autonomousUncheckedCount,
        selfImprovementUncheckedCount: queueStatus.selfImprovementUncheckedCount,
        totalUnchecked: queueStatus.totalUnchecked,
      },
      preflight,
      targetQueueRouting: {
        targetQueue,
        insertionSection: getInsertionHeadingForTargetQueue(targetQueue),
        ruleId: TARGET_ROUTING_RULE_IDS.VALID_TARGET_QUEUE,
      },
      queueParityStatus,
      candidates: [],
      selectedCandidateId: null,
      selectedOutcome: {
        action: "noop",
        taskpadPath,
        insertedLine: null,
        matchedExistingLine: null,
        semanticDedupe: {
          decision: "not-applicable",
          candidateSemanticKey: null,
          matchedSemanticKey: null,
          rationale: "queue not empty; semantic dedupe was not evaluated",
        },
      },
      artifactPath: null,
      applyHint: null,
    };
  }

  const candidates = synthesizeRankedCandidateBullets(taskpadMarkdown, planMarkdown, targetQueue);
  if (candidates.length !== 3) {
    throw new Error(`Auto-ideation contract violated: expected exactly 3 candidates, received ${candidates.length}.`);
  }

  const selection = selectBestCandidate(candidates);
  const insertion = insertSelectedCandidateIntoTargetQueue(taskpadMarkdown, selection.selectedCandidate, targetQueue);

  const insertionHeading = getInsertionHeadingForTargetQueue(targetQueue);
  const pathRuleId = getTargetQueuePathRuleId(targetQueue);

  if (insertion.action === "inserted") {
    // PRIMARY MODE SELECTOR: preflight outcome determines write path
    if (preflight.mode === "fallback-artifact") {
      return buildFallbackResult({
        taskpadPath,
        taskpadMarkdown,
        insertion,
        selectedCandidateId: selection.selectedCandidateId,
        candidates,
        queueStatus,
        preflight,
        targetQueue,
      });
    }

    // DIRECT-WRITE MODE: Attempt write with deterministic degradation on permission races
    try {
      writeFileSync(taskpadPath, insertion.updatedTaskpadMarkdown, "utf8");
    } catch (error) {
      // WRITE RACE HANDLER: Permission-class errors during write degrade to fallback (never unhandled EPERM)
      const writeErrorReason = classifyWritePreflightError(error);
      if (isPreflightPermissionDeniedReason(writeErrorReason)) {
        return buildFallbackResult({
          taskpadPath,
          taskpadMarkdown,
          insertion,
          selectedCandidateId: selection.selectedCandidateId,
          candidates,
          queueStatus,
          preflight: {
            mode: "fallback-artifact",
            writable: false,
            reasonCode: writeErrorReason,
          },
          targetQueue,
        });
      }

      // Re-probe to detect permission changes that may have occurred between preflight and write
      const postWritePreflight = probeTaskpadWriteability(taskpadPath);
      if (!postWritePreflight.writable && isPreflightPermissionDeniedReason(postWritePreflight.reasonCode)) {
        return buildFallbackResult({
          taskpadPath,
          taskpadMarkdown,
          insertion,
          selectedCandidateId: selection.selectedCandidateId,
          candidates,
          queueStatus,
          preflight: {
            mode: "fallback-artifact",
            writable: false,
            reasonCode: postWritePreflight.reasonCode,
          },
          targetQueue,
        });
      }

      // Non-permission write errors are re-thrown (they're unexpected)
      throw error;
    }
  }

  const queueParityStatus = computeQueueParityStatus(
    taskpadMarkdown,
    targetQueue,
    insertion,
    true,
  );

  return {
    status: insertion.action === "inserted" ? "seeded" : "deduped",
    triggered: true,
    queueHealth: {
      autonomousUncheckedCount: queueStatus.autonomousUncheckedCount,
      selfImprovementUncheckedCount: queueStatus.selfImprovementUncheckedCount,
      totalUnchecked: queueStatus.totalUnchecked,
    },
    preflight,
    targetQueueRouting: {
      targetQueue,
      insertionSection: insertionHeading,
      ruleId: pathRuleId,
    },
    queueParityStatus,
    candidates,
    selectedCandidateId: selection.selectedCandidateId,
    selectedOutcome: {
      action: insertion.action,
      taskpadPath,
      insertedLine: insertion.insertedLine,
      matchedExistingLine: insertion.matchedExistingLine,
      semanticDedupe: insertion.semanticDedupe,
    },
    artifactPath: null,
    applyHint: null,
  };
}

function main(): void {
  let args: AutoIdeationCliArgs;

  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`TASKPAD auto-ideation: FAIL`);
    console.error(`- ${message}`);
    printHelp();
    process.exit(1);
  }

  if (!args.taskpadPath || !args.planPath) {
    console.error("TASKPAD auto-ideation: FAIL");
    console.error("- Missing required paths. Provide both --taskpad <path> and --plan <path>.");
    printHelp();
    process.exit(1);
  }

  const resolvedTaskpadPath = resolve(args.taskpadPath);
  const resolvedPlanPath = resolve(args.planPath);

  let taskpadMarkdown: string;
  try {
    taskpadMarkdown = readFileSync(resolvedTaskpadPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD auto-ideation: FAIL");
    console.error(`- Failed to read TASKPAD file at ${resolvedTaskpadPath}: ${message}`);
    process.exit(1);
  }

  let planMarkdown: string;
  try {
    planMarkdown = readFileSync(resolvedPlanPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD auto-ideation: FAIL");
    console.error(`- Failed to read IMPLEMENTATION_PLAN file at ${resolvedPlanPath}: ${message}`);
    process.exit(1);
  }

  // Resolve target queue with deterministic rule ID
  const { targetQueue, ruleId: targetQueueRuleId } = getEffectiveTargetQueue(args.targetQueue);

  // Validate target queue before proceeding
  if (args.targetQueue !== undefined && !isValidTargetQueue(args.targetQueue)) {
    console.error("TASKPAD auto-ideation: FAIL");
    console.error(`- Invalid --target-queue value: "${args.targetQueue}"`);
    console.error(`- Allowed values: ${ALLOWED_TARGET_QUEUES.join(", ")}`);
    console.error(`- Rule ID: ${TARGET_ROUTING_RULE_IDS.INVALID_TARGET_QUEUE}`);
    process.exit(1);
  }

  let result: AutoIdeationCliResult;
  try {
    result = runAutoIdeation(taskpadMarkdown, planMarkdown, resolvedTaskpadPath, targetQueue);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("TASKPAD auto-ideation: FAIL");
    console.error(`- ${message}`);
    process.exit(1);
  }

  printHumanSummary(result);
  printMachineReadableJsonBlock(result);
}

if (import.meta.main) {
  main();
}
