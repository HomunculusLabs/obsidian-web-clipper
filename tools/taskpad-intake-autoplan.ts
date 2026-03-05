#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QueueReconcileResult } from "./lib/taskpad-queue-reconcile";
import type { TaskpadWritePreflightResult, TaskpadWritePreflightReasonCode } from "./taskpad-write-preflight";

type AutoplanStepId = "intake-recover" | "plan-seed" | "plan-contract" | "evidence-gap-parity" | "knowledge-revalidation-parity" | "markitdown-priority-brief-parity" | "priority-brief-freshness";
type AutoplanStepStatus = "pass" | "fail" | "skipped";
type AutoplanVerdict = "ready" | "hold" | "blocked";

type IntakeRecoverVerdict = "ready" | "hold" | "blocked";
type IntakeRecoverStatus = "pass" | "fail";
type PlanSeedStatus = "seeded" | "noop" | "failed" | "fallback";

interface AutoplanStepResult {
  id: AutoplanStepId;
  command: string;
  status: AutoplanStepStatus;
  exitCode: number | null;
  reasonCode: string | null;
  summary: string;
  stdout: string;
  stderr: string;
}

interface PlanSeedArtifactMetadata {
  artifactPath: string | null;
  preflightResult: TaskpadWritePreflightResult | null;
  preflightReasonCode: TaskpadWritePreflightReasonCode | null;
}

interface EvidenceGapParityPayload {
  status: "pass" | "fail";
  violations: EvidenceGapParityViolation[];
  summary: {
    totalArtifacts: number;
    fullyWiredArtifacts: number;
    missingWiringArtifacts: number;
  };
}

interface KnowledgeRevalidationParityPayload {
  status: "pass" | "fail";
  violations: KnowledgeRevalidationParityViolation[];
  summary: {
    totalArtifacts: number;
    fullyWiredArtifacts: number;
    partiallyWiredArtifacts: number;
    missingWiringArtifacts: number;
  };
}

interface MarkitdownPriorityBriefParityPayload {
  status: "pass" | "fail";
  violations: MarkitdownPriorityBriefParityViolation[];
  summary: {
    totalArtifacts: number;
    fullyWiredArtifacts: number;
    partiallyWiredArtifacts: number;
    missingWiringArtifacts: number;
  };
}

interface PriorityBriefFreshnessPayload {
  status: "pass" | "fail";
  inputs: {
    taskpadPath: string;
    planPath: string;
    projectRoot: string;
    vaultPath?: string;
  };
  briefs: {
    briefName: string;
    briefPath: string;
    exists: boolean;
    isStale: boolean;
    generatedAt?: string;
    hasFingerprints: boolean;
    sourceChecks: {
      sourceName: string;
      sourcePath: string;
      exists: boolean;
      isStale: boolean;
      stalenessReason?: string;
      briefFingerprint?: string;
      currentFingerprint?: string;
      briefMtime?: string;
      sourceMtime?: string;
    }[];
  }[];
  summary: {
    totalBriefs: number;
    freshBriefs: number;
    staleBriefs: number;
    missingBriefs: number;
  };
  violations: FreshnessViolation[];
  timestamp: string;
}

interface FreshnessViolation {
  ruleId: string;
  severity: "error" | "warning";
  briefName: string;
  briefPath: string;
  sourceName?: string;
  sourcePath?: string;
  details: {
    briefFingerprint?: string;
    currentFingerprint?: string;
    briefGeneratedAt?: string;
    sourceModifiedAt?: string;
    stalenessDuration?: string;
  };
  remediation: {
    description: string;
    scaffoldCommand: string;
  };
}

interface EvidenceGapParityViolation {
  ruleId: string;
  severity: "error" | "warning";
  artifactName: string;
  surface: string;
  remediation: {
    description: string;
    scaffoldCommand: string;
  };
}

interface KnowledgeRevalidationParityViolation {
  ruleId: string;
  severity: "error" | "warning";
  artifactName: string;
  surface: string;
  remediation: {
    description: string;
    scaffoldCommand: string;
  };
}

interface MarkitdownPriorityBriefParityViolation {
  ruleId: string;
  severity: "error" | "warning";
  artifactName: string;
  surface: string;
  remediation: {
    description: string;
    scaffoldCommand: string;
  };
}

interface TaskpadIntakeAutoplanResult {
  status: "pass" | "fail";
  verdict: AutoplanVerdict;
  reasonCode: string;
  taskpadPath: string;
  planPath: string;
  selectedBacklogLine: number | null;
  plannedMarker: string | null;
  newSliceHeading: string | null;
  steps: [AutoplanStepResult, AutoplanStepResult, AutoplanStepResult, AutoplanStepResult, AutoplanStepResult, AutoplanStepResult, AutoplanStepResult];
  queueReconcile: QueueReconcileResult | null;
  artifact: PlanSeedArtifactMetadata;
  evidenceGapParity: EvidenceGapParityPayload | null;
  knowledgeRevalidationParity: KnowledgeRevalidationParityPayload | null;
  markitdownPriorityBriefParity: MarkitdownPriorityBriefParityPayload | null;
  priorityBriefFreshness: PriorityBriefFreshnessPayload | null;
  nextActions: string[];
}

interface CliArgs {
  taskpadPath?: string;
  planPath?: string;
  date?: string;
}

interface CommandRunResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface IntakeRecoverPayload {
  status: IntakeRecoverStatus;
  verdict: IntakeRecoverVerdict;
  reasonCode: string;
}

interface PlanSeedPayload {
  status: PlanSeedStatus;
  selectedBacklogLine: number | null;
  newSliceHeading: string | null;
  reasonCode: string;
  queueReconcile: QueueReconcileResult | null;
  artifact: PlanSeedArtifactMetadata;
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
  violations: IntegrityViolation[];
  baseViolations: IntegrityViolation[];
  validatedRules: string[];
}

interface IntegrityViolation {
  ruleId: string;
  summary: string;
  remediation: string;
  details?: string[];
  detailsRecord?: Record<string, unknown>;
}

const SKIP_RECOVER_NOT_READY = "SKIP_RECOVER_NOT_READY";
const SKIP_PLAN_SEED_FAILED = "SKIP_PLAN_SEED_FAILED";
const SKIP_PLAN_CONTRACT_FAILED = "SKIP_PLAN_CONTRACT_FAILED";

const AUTOPLAN_READY_PLANNED = "AUTOPLAN_READY_PLANNED";
const AUTOPLAN_READY_NOOP_ALREADY_PLANNED = "AUTOPLAN_READY_NOOP_ALREADY_PLANNED";
const AUTOPLAN_HOLD_RECOVERY = "AUTOPLAN_HOLD_RECOVERY";
const AUTOPLAN_HOLD_PLAN_CONTRACT = "AUTOPLAN_HOLD_PLAN_CONTRACT";
const AUTOPLAN_HOLD_STRICT_ACTIVE_SLICE = "AUTOPLAN_HOLD_STRICT_ACTIVE_SLICE";
const AUTOPLAN_HOLD_EVIDENCE_GAP_PARITY = "AUTOPLAN_HOLD_EVIDENCE_GAP_PARITY";
const AUTOPLAN_HOLD_KNOWLEDGE_REVALIDATION_PARITY = "AUTOPLAN_HOLD_KNOWLEDGE_REVALIDATION_PARITY";
const AUTOPLAN_HOLD_MARKITDOWN_PRIORITY_BRIEF_PARITY = "AUTOPLAN_HOLD_MARKITDOWN_PRIORITY_BRIEF_PARITY";
const AUTOPLAN_HOLD_PRIORITY_BRIEF_FRESHNESS = "AUTOPLAN_HOLD_PRIORITY_BRIEF_FRESHNESS";
const AUTOPLAN_BLOCKED_RUNTIME = "AUTOPLAN_BLOCKED_RUNTIME";

const STRICT_MODE_RULE_NO_UNCHECKED = "PLI009_NO_UNCHECKED_TP_TASKS";
const STRICT_MODE_RULE_AMBIGUOUS_SLICE = "PLI010_AMBIGUOUS_ACTIVE_SLICE";

function printHelp(): void {
  console.log(`
TASKPAD Intake Autoplan

USAGE:
  bun run tools/taskpad-intake-autoplan.ts --taskpad <path> --plan <path> [--date YYYY-MM-DD]

OPTIONS:
  --taskpad <path>   Path to TASKPAD markdown file
  --plan <path>      Path to IMPLEMENTATION_PLAN markdown file
  --date <date>      Date passthrough for taskpad:plan-seed (UTC, YYYY-MM-DD)
  --help, -h         Show this help message
`);
}

function parseArgs(argv: string[]): CliArgs {
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

  if (!taskpadPath) {
    throw new Error("Missing required --taskpad <path>");
  }

  if (!planPath) {
    throw new Error("Missing required --plan <path>");
  }

  return { taskpadPath, planPath, date };
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatUtcDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : JSON.stringify(value);
}

function buildCommand(script: string, args: string[]): string {
  return `bun run ${script} ${args.map((arg) => shellQuote(arg)).join(" ")}`;
}

function runScript(script: string, args: string[]): CommandRunResult {
  const command = buildCommand(script, args);
  const run = Bun.spawnSync(["bun", "run", script, "--", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    command,
    exitCode: run.exitCode,
    stdout: new TextDecoder().decode(run.stdout).trim(),
    stderr: new TextDecoder().decode(run.stderr).trim(),
  };
}

function extractJsonBlock(output: string, startMarker: string, endMarker: string): unknown {
  const start = output.indexOf(startMarker);
  const end = output.indexOf(endMarker);

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  const jsonText = output.slice(start + startMarker.length, end).trim();
  if (!jsonText) {
    return null;
  }

  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function parseIntakeRecoverPayload(run: CommandRunResult): IntakeRecoverPayload | null {
  const payload = extractJsonBlock(run.stdout, "INTAKE_RECOVER_JSON_START", "INTAKE_RECOVER_JSON_END");
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const obj = payload as Record<string, unknown>;
  const status = obj.status;
  const verdict = obj.verdict;
  const reasonCode = obj.reasonCode;

  if ((status !== "pass" && status !== "fail") || (verdict !== "ready" && verdict !== "hold" && verdict !== "blocked")) {
    return null;
  }

  if (typeof reasonCode !== "string" || reasonCode.trim().length === 0) {
    return null;
  }

  return {
    status,
    verdict,
    reasonCode,
  };
}

function parsePlanSeedPayload(run: CommandRunResult): PlanSeedPayload | null {
  const payload = extractJsonBlock(run.stdout, "PLAN_SEED_JSON_START", "PLAN_SEED_JSON_END");
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const obj = payload as Record<string, unknown>;
  const status = obj.status;
  const selectedBacklogLine = obj.selectedBacklogLine;
  const newSliceHeading = obj.newSliceHeading;
  const reasonCode = obj.reasonCode;
  const queueReconcile = obj.queueReconcile;
  const artifact = obj.artifact;

  const selectedBacklogLineValid = typeof selectedBacklogLine === "number" || selectedBacklogLine === null;
  const newSliceHeadingValid = typeof newSliceHeading === "string" || newSliceHeading === null;
  const queueReconcileValid = queueReconcile === null || (typeof queueReconcile === "object" && queueReconcile !== null);

  // Validate artifact metadata if present
  let parsedArtifact: PlanSeedArtifactMetadata = {
    artifactPath: null,
    preflightResult: null,
    preflightReasonCode: null,
  };

  if (artifact && typeof artifact === "object" && artifact !== null) {
    const artifactObj = artifact as Record<string, unknown>;
    const artifactPath = artifactObj.artifactPath;
    const preflightResult = artifactObj.preflightResult;
    const preflightReasonCode = artifactObj.preflightReasonCode;

    if (artifactPath !== null && typeof artifactPath !== "string") {
      return null;
    }

    if (preflightResult !== null && typeof preflightResult !== "object") {
      return null;
    }

    if (preflightReasonCode !== null && typeof preflightReasonCode !== "string") {
      return null;
    }

    parsedArtifact = {
      artifactPath: artifactPath as string | null,
      preflightResult: preflightResult as TaskpadWritePreflightResult | null,
      preflightReasonCode: preflightReasonCode as TaskpadWritePreflightReasonCode | null,
    };
  }

  if (
    (status !== "seeded" && status !== "noop" && status !== "failed" && status !== "fallback") ||
    !selectedBacklogLineValid ||
    !newSliceHeadingValid ||
    typeof reasonCode !== "string" ||
    !queueReconcileValid
  ) {
    return null;
  }

  return {
    status,
    selectedBacklogLine,
    newSliceHeading,
    reasonCode,
    queueReconcile: queueReconcile as QueueReconcileResult | null,
    artifact: parsedArtifact,
  };
}

function parseIntegrityReportJson(stdout: string): IntegrityReport | null {
  // The integrity checker outputs raw JSON when --format json is used
  // We parse it directly from stdout
  const trimmed = stdout.trim();
  if (!trimmed || trimmed.startsWith("IMPLEMENTATION_PLAN integrity:")) {
    // This is human-readable output, not JSON
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const report = parsed as Record<string, unknown>;

    // Validate required fields
    if (report.status !== "pass" && report.status !== "fail") {
      return null;
    }

    if (report.mode !== "base" && report.mode !== "strict") {
      return null;
    }

    if (!Array.isArray(report.violations)) {
      return null;
    }

    return {
      status: report.status,
      mode: report.mode,
      activeSlice: report.activeSlice as IntegrityReport["activeSlice"],
      violations: report.violations as IntegrityViolation[],
      baseViolations: report.baseViolations as IntegrityViolation[] || [],
      validatedRules: report.validatedRules as string[] || [],
    };
  } catch {
    return null;
  }
}

function parseEvidenceGapParityPayload(stdout: string): EvidenceGapParityPayload | null {
  // The evidence-gap parity gate outputs raw JSON when --format json is used
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const report = parsed as Record<string, unknown>;

    // Validate required fields
    if (report.status !== "pass" && report.status !== "fail") {
      return null;
    }

    if (!Array.isArray(report.violations)) {
      return null;
    }

    if (typeof report.summary !== "object" || report.summary === null) {
      return null;
    }

    const summary = report.summary as Record<string, unknown>;
    if (typeof summary.totalArtifacts !== "number" ||
        typeof summary.fullyWiredArtifacts !== "number" ||
        typeof summary.missingWiringArtifacts !== "number") {
      return null;
    }

    return {
      status: report.status,
      violations: report.violations as EvidenceGapParityViolation[],
      summary: {
        totalArtifacts: summary.totalArtifacts,
        fullyWiredArtifacts: summary.fullyWiredArtifacts,
        missingWiringArtifacts: summary.missingWiringArtifacts,
      },
    };
  } catch {
    return null;
  }
}

function parseKnowledgeRevalidationParityPayload(stdout: string): KnowledgeRevalidationParityPayload | null {
  // The knowledge-revalidation parity gate outputs raw JSON when --format json is used
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const report = parsed as Record<string, unknown>;

    // Validate required fields
    if (report.status !== "pass" && report.status !== "fail") {
      return null;
    }

    if (!Array.isArray(report.violations)) {
      return null;
    }

    if (typeof report.summary !== "object" || report.summary === null) {
      return null;
    }

    const summary = report.summary as Record<string, unknown>;
    if (typeof summary.totalArtifacts !== "number" ||
        typeof summary.fullyWiredArtifacts !== "number" ||
        typeof summary.partiallyWiredArtifacts !== "number" ||
        typeof summary.missingWiringArtifacts !== "number") {
      return null;
    }

    return {
      status: report.status,
      violations: report.violations as KnowledgeRevalidationParityViolation[],
      summary: {
        totalArtifacts: summary.totalArtifacts,
        fullyWiredArtifacts: summary.fullyWiredArtifacts,
        partiallyWiredArtifacts: summary.partiallyWiredArtifacts,
        missingWiringArtifacts: summary.missingWiringArtifacts,
      },
    };
  } catch {
    return null;
  }
}

function parseMarkitdownPriorityBriefParityPayload(stdout: string): MarkitdownPriorityBriefParityPayload | null {
  // The markitdown-priority-brief parity gate outputs raw JSON when --format json is used
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const report = parsed as Record<string, unknown>;

    // Validate required fields
    if (report.status !== "pass" && report.status !== "fail") {
      return null;
    }

    if (!Array.isArray(report.violations)) {
      return null;
    }

    if (typeof report.summary !== "object" || report.summary === null) {
      return null;
    }

    const summary = report.summary as Record<string, unknown>;
    if (typeof summary.totalArtifacts !== "number" ||
        typeof summary.fullyWiredArtifacts !== "number" ||
        typeof summary.partiallyWiredArtifacts !== "number" ||
        typeof summary.missingWiringArtifacts !== "number") {
      return null;
    }

    return {
      status: report.status,
      violations: report.violations as MarkitdownPriorityBriefParityViolation[],
      summary: {
        totalArtifacts: summary.totalArtifacts,
        fullyWiredArtifacts: summary.fullyWiredArtifacts,
        partiallyWiredArtifacts: summary.partiallyWiredArtifacts,
        missingWiringArtifacts: summary.missingWiringArtifacts,
      },
    };
  } catch {
    return null;
  }
}

function parsePriorityBriefFreshnessPayload(stdout: string): PriorityBriefFreshnessPayload | null {
  // The priority-brief-freshness-gate outputs raw JSON when --format json is used
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const report = parsed as Record<string, unknown>;

    // Validate required fields
    if (report.status !== "pass" && report.status !== "fail") {
      return null;
    }

    if (typeof report.inputs !== "object" || report.inputs === null) {
      return null;
    }

    if (!Array.isArray(report.briefs)) {
      return null;
    }

    if (typeof report.summary !== "object" || report.summary === null) {
      return null;
    }

    if (!Array.isArray(report.violations)) {
      return null;
    }

    const summary = report.summary as Record<string, unknown>;
    if (typeof summary.totalBriefs !== "number" ||
        typeof summary.freshBriefs !== "number" ||
        typeof summary.staleBriefs !== "number" ||
        typeof summary.missingBriefs !== "number") {
      return null;
    }

    return {
      status: report.status,
      inputs: report.inputs as PriorityBriefFreshnessPayload["inputs"],
      briefs: report.briefs as PriorityBriefFreshnessPayload["briefs"],
      summary: {
        totalBriefs: summary.totalBriefs,
        freshBriefs: summary.freshBriefs,
        staleBriefs: summary.staleBriefs,
        missingBriefs: summary.missingBriefs,
      },
      violations: report.violations as FreshnessViolation[],
      timestamp: report.timestamp as string,
    };
  } catch {
    return null;
  }
}

function makeSkippedStep(id: AutoplanStepId, command: string, reasonCode: string, summary: string): AutoplanStepResult {
  return {
    id,
    command,
    status: "skipped",
    exitCode: null,
    reasonCode,
    summary,
    stdout: "",
    stderr: "",
  };
}

function resolvePlanContractScript(planPath: string): { script: string; args: string[] } {
  // Always use plan:integrity with strict-active-slice and JSON format
  // This ensures deterministic strict-mode enforcement surfaces as a single actionable blocker
  return {
    script: "plan:integrity",
    args: ["--plan", planPath, "--strict-active-slice", "--format", "json"],
  };
}

function isMissingScriptFailure(step: AutoplanStepResult): boolean {
  if (step.status !== "fail") {
    return false;
  }

  const combined = `${step.stdout}\n${step.stderr}`;
  return /script not found|missing script/i.test(combined);
}

export function runTaskpadIntakeAutoplan(taskpadPath: string, planPath: string, date?: string): TaskpadIntakeAutoplanResult {
  const recoverRun = runScript("taskpad:intake:recover", ["--taskpad", taskpadPath, "--plan", planPath]);
  const recoverPayload = parseIntakeRecoverPayload(recoverRun);

  let recoverStep: AutoplanStepResult;
  let seedStep: AutoplanStepResult;
  let contractStep: AutoplanStepResult;
  let parityStep: AutoplanStepResult;
  let knowledgeRevalidationParityStep: AutoplanStepResult;
  let markitdownPriorityBriefParityStep: AutoplanStepResult;
  let freshnessStep: AutoplanStepResult;

  if (!recoverPayload) {
    recoverStep = {
      id: "intake-recover",
      command: recoverRun.command,
      status: "fail",
      exitCode: recoverRun.exitCode,
      reasonCode: "INTAKE_RECOVER_JSON_MISSING_OR_INVALID",
      summary: "Recover step did not emit a parseable machine-readable payload.",
      stdout: recoverRun.stdout,
      stderr: recoverRun.stderr,
    };

    seedStep = makeSkippedStep(
      "plan-seed",
      buildCommand("taskpad:plan-seed", ["--taskpad", taskpadPath, "--plan", planPath]),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover did not return a ready verdict.",
    );

    const planContract = resolvePlanContractScript(planPath);
    contractStep = makeSkippedStep(
      "plan-contract",
      buildCommand(planContract.script, planContract.args),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover did not return a ready verdict.",
    );

    parityStep = makeSkippedStep(
      "evidence-gap-parity",
      buildCommand("taskpad:evidence-gap-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover did not return a ready verdict.",
    );

    knowledgeRevalidationParityStep = makeSkippedStep(
      "knowledge-revalidation-parity",
      buildCommand("taskpad:knowledge-revalidation-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover did not return a ready verdict.",
    );

    markitdownPriorityBriefParityStep = makeSkippedStep(
      "markitdown-priority-brief-parity",
      buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover did not return a ready verdict.",
    );

    freshnessStep = makeSkippedStep(
      "priority-brief-freshness",
      buildCommand("taskpad:priority-brief-freshness-gate", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover did not return a ready verdict.",
    );

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: null,
      plannedMarker: null,
      newSliceHeading: null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep, freshnessStep],
      queueReconcile: null,
      artifact: {
        artifactPath: null,
        preflightResult: null,
        preflightReasonCode: null,
      },
      evidenceGapParity: null,
      knowledgeRevalidationParity: null,
      markitdownPriorityBriefParity: null,
      priorityBriefFreshness: null,
      nextActions: [
        "Inspect taskpad:intake:recover output contract markers and rerun taskpad:intake:autoplan.",
        "Resolve runtime/contract issues before retrying orchestration.",
      ],
    };
  }

  const recoverContractValid =
    (recoverPayload.verdict === "ready" && recoverPayload.status === "pass" && recoverRun.exitCode === 0) ||
    (recoverPayload.verdict !== "ready" && recoverPayload.status === "fail" && recoverRun.exitCode !== 0);

  if (!recoverContractValid) {
    recoverStep = {
      id: "intake-recover",
      command: recoverRun.command,
      status: "fail",
      exitCode: recoverRun.exitCode,
      reasonCode: "INTAKE_RECOVER_EXIT_SEMANTICS_INVALID",
      summary: "Recover output violated deterministic status/verdict/exit semantics.",
      stdout: recoverRun.stdout,
      stderr: recoverRun.stderr,
    };

    seedStep = makeSkippedStep(
      "plan-seed",
      buildCommand("taskpad:plan-seed", ["--taskpad", taskpadPath, "--plan", planPath]),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover did not return a valid ready verdict.",
    );

    const planContract = resolvePlanContractScript(planPath);
    contractStep = makeSkippedStep(
      "plan-contract",
      buildCommand(planContract.script, planContract.args),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover did not return a valid ready verdict.",
    );

    parityStep = makeSkippedStep(
      "evidence-gap-parity",
      buildCommand("taskpad:evidence-gap-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover did not return a valid ready verdict.",
    );

    knowledgeRevalidationParityStep = makeSkippedStep(
      "knowledge-revalidation-parity",
      buildCommand("taskpad:knowledge-revalidation-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover did not return a valid ready verdict.",
    );

    markitdownPriorityBriefParityStep = makeSkippedStep(
      "markitdown-priority-brief-parity",
      buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover did not return a valid ready verdict.",
    );

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: null,
      plannedMarker: null,
      newSliceHeading: null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
      queueReconcile: null,
      artifact: {
        artifactPath: null,
        preflightResult: null,
        preflightReasonCode: null,
      },
      evidenceGapParity: null,
      knowledgeRevalidationParity: null,
      markitdownPriorityBriefParity: null,
      priorityBriefFreshness: null,
      nextActions: [
        "Fix intake-recover exit semantics so ready maps to exit 0 and non-ready maps to non-zero.",
        "Rerun taskpad:intake:autoplan after contract semantics are restored.",
      ],
    };
  }

  recoverStep = {
    id: "intake-recover",
    command: recoverRun.command,
    status: recoverPayload.status,
    exitCode: recoverRun.exitCode,
    reasonCode: recoverPayload.reasonCode,
    summary:
      recoverPayload.verdict === "ready"
        ? "Recover gate passed; proceeding to deterministic planning branch."
        : "Recover gate returned non-ready verdict; downstream planning steps are skipped.",
    stdout: recoverRun.stdout,
    stderr: recoverRun.stderr,
  };

  if (recoverPayload.verdict !== "ready") {
    seedStep = makeSkippedStep(
      "plan-seed",
      buildCommand("taskpad:plan-seed", ["--taskpad", taskpadPath, "--plan", planPath]),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover verdict was not ready.",
    );

    const planContract = resolvePlanContractScript(planPath);
    contractStep = makeSkippedStep(
      "plan-contract",
      buildCommand(planContract.script, planContract.args),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover verdict was not ready.",
    );

    parityStep = makeSkippedStep(
      "evidence-gap-parity",
      buildCommand("taskpad:evidence-gap-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover verdict was not ready.",
    );

    knowledgeRevalidationParityStep = makeSkippedStep(
      "knowledge-revalidation-parity",
      buildCommand("taskpad:knowledge-revalidation-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover verdict was not ready.",
    );

    markitdownPriorityBriefParityStep = makeSkippedStep(
      "markitdown-priority-brief-parity",
      buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_RECOVER_NOT_READY,
      "Skipped because intake-recover verdict was not ready.",
    );

    if (recoverPayload.verdict === "hold") {
      return {
        status: "fail",
        verdict: "hold",
        reasonCode: AUTOPLAN_HOLD_RECOVERY,
        taskpadPath,
        planPath,
        selectedBacklogLine: null,
        plannedMarker: null,
        newSliceHeading: null,
        steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep, freshnessStep],
        queueReconcile: null,
        artifact: {
          artifactPath: null,
          preflightResult: null,
          preflightReasonCode: null,
        },
        evidenceGapParity: null,
        knowledgeRevalidationParity: null,
        markitdownPriorityBriefParity: null,
        priorityBriefFreshness: null,
        nextActions: [
          "Follow intake-recover next actions and rerun taskpad:intake:autoplan once intake is ready.",
          "Keep plan-seed and plan-contract skipped until recovery reaches ready.",
        ],
      };
    }

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: null,
      plannedMarker: null,
      newSliceHeading: null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
      queueReconcile: null,
      artifact: {
        artifactPath: null,
        preflightResult: null,
        preflightReasonCode: null,
      },
      evidenceGapParity: null,
      knowledgeRevalidationParity: null,
      markitdownPriorityBriefParity: null,
      nextActions: [
        "Inspect intake-recover failure output and remediate runtime or contract issues.",
        "Rerun taskpad:intake:autoplan after recover stops returning blocked.",
      ],
    };
  }

  const resolvedSeedDate = date ?? formatUtcDate();
  const plannedMarker = `planned-${resolvedSeedDate}`;
  const planSeedArgs = ["--taskpad", taskpadPath, "--plan", planPath, "--date", resolvedSeedDate];

  const seedRun = runScript("taskpad:plan-seed", planSeedArgs);
  const seedPayload = parsePlanSeedPayload(seedRun);

  if (!seedPayload) {
    seedStep = {
      id: "plan-seed",
      command: seedRun.command,
      status: "fail",
      exitCode: seedRun.exitCode,
      reasonCode: "PLAN_SEED_JSON_MISSING_OR_INVALID",
      summary: "Plan-seed step did not emit a parseable machine-readable payload.",
      stdout: seedRun.stdout,
      stderr: seedRun.stderr,
    };

    const planContract = resolvePlanContractScript(planPath);
    contractStep = makeSkippedStep(
      "plan-contract",
      buildCommand(planContract.script, planContract.args),
      SKIP_PLAN_SEED_FAILED,
      "Skipped because plan-seed did not produce a valid payload.",
    );

    parityStep = makeSkippedStep(
      "evidence-gap-parity",
      buildCommand("taskpad:evidence-gap-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_SEED_FAILED,
      "Skipped because plan-seed did not produce a valid payload.",
    );

    knowledgeRevalidationParityStep = makeSkippedStep(
      "knowledge-revalidation-parity",
      buildCommand("taskpad:knowledge-revalidation-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_SEED_FAILED,
      "Skipped because plan-seed did not produce a valid payload.",
    );

    markitdownPriorityBriefParityStep = makeSkippedStep(
      "markitdown-priority-brief-parity",
      buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_SEED_FAILED,
      "Skipped because plan-seed did not produce a valid payload.",
    );

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: null,
      plannedMarker: null,
      newSliceHeading: null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
      queueReconcile: null,
      artifact: {
        artifactPath: null,
        preflightResult: null,
        preflightReasonCode: null,
      },
      evidenceGapParity: null,
      knowledgeRevalidationParity: null,
      markitdownPriorityBriefParity: null,
      nextActions: [
        "Fix taskpad:plan-seed output contract markers and rerun taskpad:intake:autoplan.",
        "Ensure plan-seed returns deterministic status/reasonCode fields.",
      ],
    };
  }

  const seedContractValid =
    ((seedPayload.status === "seeded" || seedPayload.status === "noop" || seedPayload.status === "fallback") && seedRun.exitCode === 0) ||
    (seedPayload.status === "failed" && seedRun.exitCode !== 0);

  if (!seedContractValid) {
    seedStep = {
      id: "plan-seed",
      command: seedRun.command,
      status: "fail",
      exitCode: seedRun.exitCode,
      reasonCode: "PLAN_SEED_EXIT_SEMANTICS_INVALID",
      summary: "Plan-seed output violated deterministic status/exit semantics.",
      stdout: seedRun.stdout,
      stderr: seedRun.stderr,
    };

    const planContract = resolvePlanContractScript(planPath);
    contractStep = makeSkippedStep(
      "plan-contract",
      buildCommand(planContract.script, planContract.args),
      SKIP_PLAN_SEED_FAILED,
      "Skipped because plan-seed failed deterministic contract semantics.",
    );

    parityStep = makeSkippedStep(
      "evidence-gap-parity",
      buildCommand("taskpad:evidence-gap-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_SEED_FAILED,
      "Skipped because plan-seed failed deterministic contract semantics.",
    );

    knowledgeRevalidationParityStep = makeSkippedStep(
      "knowledge-revalidation-parity",
      buildCommand("taskpad:knowledge-revalidation-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_SEED_FAILED,
      "Skipped because plan-seed failed deterministic contract semantics.",
    );

    markitdownPriorityBriefParityStep = makeSkippedStep(
      "markitdown-priority-brief-parity",
      buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_SEED_FAILED,
      "Skipped because plan-seed failed deterministic contract semantics.",
    );

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: null,
      plannedMarker: null,
      newSliceHeading: null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
      queueReconcile: null,
      artifact: {
        artifactPath: null,
        preflightResult: null,
        preflightReasonCode: null,
      },
      evidenceGapParity: null,
      knowledgeRevalidationParity: null,
      markitdownPriorityBriefParity: null,
      nextActions: [
        "Repair plan-seed exit semantics so seeded/noop/fallback exit 0 and failed exits non-zero.",
        "Rerun taskpad:intake:autoplan after plan-seed contract is restored.",
      ],
    };
  }

  seedStep = {
    id: "plan-seed",
    command: seedRun.command,
    status: seedPayload.status === "failed" ? "fail" : "pass",
    exitCode: seedRun.exitCode,
    reasonCode: seedPayload.reasonCode,
    summary:
      seedPayload.status === "seeded"
        ? "Plan seed succeeded and promoted one backlog bullet to planned state."
        : seedPayload.status === "noop"
          ? "Plan seed reported deterministic no-op; plan contract still required."
          : seedPayload.status === "fallback"
            ? "Plan seed emitted fallback artifact; plan contract still required."
            : "Plan seed failed and blocked downstream plan contract.",
    stdout: seedRun.stdout,
    stderr: seedRun.stderr,
  };

  if (seedPayload.status === "failed") {
    const planContract = resolvePlanContractScript(planPath);
    contractStep = makeSkippedStep(
      "plan-contract",
      buildCommand(planContract.script, planContract.args),
      SKIP_PLAN_SEED_FAILED,
      "Skipped because plan-seed returned failed status.",
    );

    parityStep = makeSkippedStep(
      "evidence-gap-parity",
      buildCommand("taskpad:evidence-gap-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_SEED_FAILED,
      "Skipped because plan-seed returned failed status.",
    );

    knowledgeRevalidationParityStep = makeSkippedStep(
      "knowledge-revalidation-parity",
      buildCommand("taskpad:knowledge-revalidation-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_SEED_FAILED,
      "Skipped because plan-seed returned failed status.",
    );

    markitdownPriorityBriefParityStep = makeSkippedStep(
      "markitdown-priority-brief-parity",
      buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_SEED_FAILED,
      "Skipped because plan-seed returned failed status.",
    );

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: null,
      plannedMarker: null,
      newSliceHeading: null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
      queueReconcile: seedPayload.queueReconcile,
      artifact: seedPayload.artifact,
      evidenceGapParity: null,
      knowledgeRevalidationParity: null,
      markitdownPriorityBriefParity: null,
      nextActions: [
        "Resolve taskpad:plan-seed failure reason and rerun taskpad:intake:autoplan.",
        "Do not run plan-contract until plan-seed succeeds or returns deterministic noop/fallback.",
      ],
    };
  }

  const planContract = resolvePlanContractScript(planPath);
  const planContractRun = runScript(planContract.script, planContract.args);

  // Parse integrity report JSON output if available
  const integrityReport = parseIntegrityReportJson(planContractRun.stdout);

  // Determine the status and reason code for the contract step
  let contractStatus: AutoplanStepStatus;
  let contractReasonCode: string | null;
  let contractSummary: string;

  if (planContractRun.exitCode === 0) {
    contractStatus = "pass";
    contractReasonCode = null;
    contractSummary = "Plan contract gate passed for current plan state.";
  } else if (integrityReport) {
    // We have a JSON integrity report - check for strict-mode failures
    const hasStrictModeFailure = integrityReport.violations.some(
      (v) => v.ruleId === STRICT_MODE_RULE_NO_UNCHECKED || v.ruleId === STRICT_MODE_RULE_AMBIGUOUS_SLICE,
    );

    if (hasStrictModeFailure) {
      // Surface strict-mode failure as a single actionable blocker
      contractStatus = "fail";
      contractReasonCode = AUTOPLAN_HOLD_STRICT_ACTIVE_SLICE;

      // Build a summary that captures the actionable blocker without duplicate slice churn
      const noUncheckedTasks = integrityReport.violations.some(
        (v) => v.ruleId === STRICT_MODE_RULE_NO_UNCHECKED,
      );
      const ambiguousSlice = integrityReport.violations.some(
        (v) => v.ruleId === STRICT_MODE_RULE_AMBIGUOUS_SLICE,
      );

      if (noUncheckedTasks) {
        contractSummary = "Strict mode: newest intake slice has no unchecked TP tasks. Archive the completed slice or add new unchecked TP tasks.";
      } else if (ambiguousSlice) {
        contractSummary = "Strict mode: cannot deterministically identify the active TASKPAD intake slice. Ensure the first H2 heading is a valid TASKPAD Intake Slice with a date.";
      } else {
        contractSummary = "Strict mode: active slice contract violation detected.";
      }
    } else {
      // Other integrity failures - treat as generic plan-contract failure
      contractStatus = "fail";
      contractReasonCode = AUTOPLAN_HOLD_PLAN_CONTRACT;
      contractSummary = "Plan contract gate failed; autoplan returns hold.";
    }
  } else {
    // No JSON output - generic failure
    contractStatus = "fail";
    contractReasonCode = "PLAN_CONTRACT_FAILED";
    contractSummary = "Plan contract gate failed; autoplan returns hold.";
  }

  contractStep = {
    id: "plan-contract",
    command: planContractRun.command,
    status: contractStatus,
    exitCode: planContractRun.exitCode,
    reasonCode: contractReasonCode,
    summary: contractSummary,
    stdout: planContractRun.stdout,
    stderr: planContractRun.stderr,
  };

  if (contractStep.status === "fail") {
    if (isMissingScriptFailure(contractStep)) {
      parityStep = makeSkippedStep(
        "evidence-gap-parity",
        buildCommand("taskpad:evidence-gap-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
        SKIP_PLAN_CONTRACT_FAILED,
        "Skipped because plan-contract step failed with missing script.",
      );

      knowledgeRevalidationParityStep = makeSkippedStep(
        "knowledge-revalidation-parity",
        buildCommand("taskpad:knowledge-revalidation-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
        SKIP_PLAN_CONTRACT_FAILED,
        "Skipped because plan-contract step failed with missing script.",
      );

      markitdownPriorityBriefParityStep = makeSkippedStep(
        "markitdown-priority-brief-parity",
        buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
        SKIP_PLAN_CONTRACT_FAILED,
        "Skipped because plan-contract step failed with missing script.",
      );

      return {
        status: "fail",
        verdict: "blocked",
        reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
        taskpadPath,
        planPath,
        selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
        plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
        newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
        steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
        queueReconcile: seedPayload.queueReconcile,
        artifact: seedPayload.artifact,
        evidenceGapParity: null,
        knowledgeRevalidationParity: null,
        markitdownPriorityBriefParity: null,
        nextActions: [
          "Wire taskpad:plan-contract script or keep plan:integrity available for fallback.",
          "Rerun taskpad:intake:autoplan once the contract command is executable.",
        ],
      };
    }

    if (contractReasonCode === AUTOPLAN_HOLD_STRICT_ACTIVE_SLICE) {
      // Strict-mode failure - surface as a single actionable blocker
      // Use seed state only if plan-seed returned seeded or fallback (not noop)
      const wasSeeded = seedPayload.status === "seeded";
      const wasFallback = seedPayload.status === "fallback";
      const hasMutation = wasSeeded || wasFallback;
      const nextActions: string[] = [];

      if (integrityReport) {
        const noUncheckedTasks = integrityReport.violations.some(
          (v) => v.ruleId === STRICT_MODE_RULE_NO_UNCHECKED,
        );
        const ambiguousSlice = integrityReport.violations.some(
          (v) => v.ruleId === STRICT_MODE_RULE_AMBIGUOUS_SLICE,
        );

        if (noUncheckedTasks) {
          // Do not create duplicate slices when strict mode fails due to no unchecked tasks
          // If fallback artifact exists, add action to apply it as the first (primary) action
          if (seedPayload.artifact.artifactPath) {
            nextActions.push(
              `Apply fallback artifact: bun run taskpad:apply-fallback -- --taskpad "${taskpadPath}" --plan "${planPath}" --artifact "${seedPayload.artifact.artifactPath}"`,
            );
          }
          nextActions.push(
            "Run taskpad:plan-prune to archive the completed slice.",
            "OR add new unchecked TP tasks to the active slice.",
            "Do not create duplicate/empty top slices - strict mode prevents slice churn.",
          );
        } else if (ambiguousSlice) {
          nextActions.push(
            "Fix the first H2 heading to match '## TASKPAD Intake Slice (YYYY-MM-DD): ...' with a valid ISO date.",
            "Ensure the active slice is deterministically identifiable.",
          );
        } else {
          // Other strict-mode violations
          for (const violation of integrityReport.violations) {
            nextActions.push(`[${violation.ruleId}] ${violation.remediation}`);
          }
        }
      } else {
        nextActions.push("Fix strict-active-slice violations reported by plan:integrity.");
      }

      parityStep = makeSkippedStep(
        "evidence-gap-parity",
        buildCommand("taskpad:evidence-gap-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
        SKIP_PLAN_CONTRACT_FAILED,
        "Skipped because plan-contract step failed with strict-active-slice violation.",
      );

      knowledgeRevalidationParityStep = makeSkippedStep(
        "knowledge-revalidation-parity",
        buildCommand("taskpad:knowledge-revalidation-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
        SKIP_PLAN_CONTRACT_FAILED,
        "Skipped because plan-contract step failed with strict-active-slice violation.",
      );

      markitdownPriorityBriefParityStep = makeSkippedStep(
        "markitdown-priority-brief-parity",
        buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
        SKIP_PLAN_CONTRACT_FAILED,
        "Skipped because plan-contract step failed with strict-active-slice violation.",
      );

      return {
        status: "fail",
        verdict: "hold",
        reasonCode: AUTOPLAN_HOLD_STRICT_ACTIVE_SLICE,
        taskpadPath,
        planPath,
        // Do not report slice creation details when strict mode fails - prevents duplicate slice churn
        selectedBacklogLine: hasMutation ? seedPayload.selectedBacklogLine : null,
        plannedMarker: hasMutation ? plannedMarker : null,
        newSliceHeading: hasMutation ? seedPayload.newSliceHeading : null,
        steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
        queueReconcile: seedPayload.queueReconcile,
        artifact: seedPayload.artifact,
        evidenceGapParity: null,
        knowledgeRevalidationParity: null,
        markitdownPriorityBriefParity: null,
        nextActions,
      };
    }

    parityStep = makeSkippedStep(
      "evidence-gap-parity",
      buildCommand("taskpad:evidence-gap-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_CONTRACT_FAILED,
      "Skipped because plan-contract step failed.",
    );

    knowledgeRevalidationParityStep = makeSkippedStep(
      "knowledge-revalidation-parity",
      buildCommand("taskpad:knowledge-revalidation-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_CONTRACT_FAILED,
      "Skipped because plan-contract step failed.",
    );

    markitdownPriorityBriefParityStep = makeSkippedStep(
      "markitdown-priority-brief-parity",
      buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_CONTRACT_FAILED,
      "Skipped because plan-contract step failed.",
    );

    return {
      status: "fail",
      verdict: "hold",
      reasonCode: AUTOPLAN_HOLD_PLAN_CONTRACT,
      taskpadPath,
      planPath,
      selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
      plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
      newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
      queueReconcile: seedPayload.queueReconcile,
      artifact: seedPayload.artifact,
      evidenceGapParity: null,
      knowledgeRevalidationParity: null,
      markitdownPriorityBriefParity: null,
      nextActions: [
        "Fix plan contract/integrity failures in IMPLEMENTATION_PLAN.md.",
        "Rerun taskpad:intake:autoplan after contract gate passes.",
      ],
    };
  }

  // Evidence-gap parity check runs after plan-contract passes
  const evidenceGapParityRun = runScript("taskpad:evidence-gap-refresh-contract-parity", [
    "--taskpad", taskpadPath,
    "--plan", planPath,
    "--project-root", ".",
    "--format", "json",
  ]);
  const evidenceGapPayload = parseEvidenceGapParityPayload(evidenceGapParityRun.stdout);

  if (!evidenceGapPayload) {
    parityStep = {
      id: "evidence-gap-parity",
      command: evidenceGapParityRun.command,
      status: "fail",
      exitCode: evidenceGapParityRun.exitCode,
      reasonCode: "EVIDENCE_GAP_PARITY_JSON_MISSING_OR_INVALID",
      summary: "Evidence-gap parity step did not emit a parseable machine-readable payload.",
      stdout: evidenceGapParityRun.stdout,
      stderr: evidenceGapParityRun.stderr,
    };

    knowledgeRevalidationParityStep = makeSkippedStep(
      "knowledge-revalidation-parity",
      buildCommand("taskpad:knowledge-revalidation-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_CONTRACT_FAILED,
      "Skipped because evidence-gap parity step failed.",
    );

    markitdownPriorityBriefParityStep = makeSkippedStep(
      "markitdown-priority-brief-parity",
      buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_CONTRACT_FAILED,
      "Skipped because evidence-gap parity step failed.",
    );

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
      plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
      newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
      queueReconcile: seedPayload.queueReconcile,
      artifact: seedPayload.artifact,
      evidenceGapParity: null,
      knowledgeRevalidationParity: null,
      markitdownPriorityBriefParity: null,
      nextActions: [
        "Fix taskpad:evidence-gap-refresh-contract-parity output contract markers.",
        "Ensure the gate returns valid JSON with status, violations, and summary fields.",
      ],
    };
  }

  const parityContractValid =
    (evidenceGapPayload.status === "pass" && evidenceGapParityRun.exitCode === 0) ||
    (evidenceGapPayload.status === "fail" && evidenceGapParityRun.exitCode !== 0);

  if (!parityContractValid) {
    parityStep = {
      id: "evidence-gap-parity",
      command: evidenceGapParityRun.command,
      status: "fail",
      exitCode: evidenceGapParityRun.exitCode,
      reasonCode: "EVIDENCE_GAP_PARITY_EXIT_SEMANTICS_INVALID",
      summary: "Evidence-gap parity output violated deterministic status/exit semantics.",
      stdout: evidenceGapParityRun.stdout,
      stderr: evidenceGapParityRun.stderr,
    };

    knowledgeRevalidationParityStep = makeSkippedStep(
      "knowledge-revalidation-parity",
      buildCommand("taskpad:knowledge-revalidation-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_CONTRACT_FAILED,
      "Skipped because evidence-gap parity step failed.",
    );

    markitdownPriorityBriefParityStep = makeSkippedStep(
      "markitdown-priority-brief-parity",
      buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_CONTRACT_FAILED,
      "Skipped because evidence-gap parity step failed.",
    );

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
      plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
      newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
      queueReconcile: seedPayload.queueReconcile,
      artifact: seedPayload.artifact,
      evidenceGapParity: evidenceGapPayload,
      knowledgeRevalidationParity: null,
      markitdownPriorityBriefParity: null,
      nextActions: [
        "Repair evidence-gap parity exit semantics so pass exits 0 and fail exits non-zero.",
        "Rerun taskpad:intake:autoplan after parity contract is restored.",
      ],
    };
  }

  // Check if evidence-gap parity failed with violations
  if (evidenceGapPayload.status === "fail" && evidenceGapPayload.violations.length > 0) {
    const errorViolations = evidenceGapPayload.violations.filter(v => v.severity === "error");
    const hasPlannedArtifactsWithMissingWiring = evidenceGapPayload.summary.totalArtifacts > 0 &&
      evidenceGapPayload.summary.missingWiringArtifacts > 0;

    if (errorViolations.length > 0 || hasPlannedArtifactsWithMissingWiring) {
      parityStep = {
        id: "evidence-gap-parity",
        command: evidenceGapParityRun.command,
        status: "fail",
        exitCode: evidenceGapParityRun.exitCode,
        reasonCode: AUTOPLAN_HOLD_EVIDENCE_GAP_PARITY,
        summary: `Evidence-gap parity gate failed with ${errorViolations.length} error violations and ${evidenceGapPayload.summary.missingWiringArtifacts} artifacts with missing wiring.`,
        stdout: evidenceGapParityRun.stdout,
        stderr: evidenceGapParityRun.stderr,
      };

      const nextActions: string[] = [
        `Fix ${evidenceGapPayload.summary.missingWiringArtifacts} evidence-gap artifact(s) with missing save-flow wiring.`,
      ];

      // Add specific remediation actions for each violation
      for (const violation of errorViolations.slice(0, 3)) {
        nextActions.push(`[${violation.ruleId}] ${violation.artifactName}: ${violation.remediation.description}`);
        if (violation.remediation.scaffoldCommand) {
          nextActions.push(`  Scaffold: ${violation.remediation.scaffoldCommand}`);
        }
      }

      if (errorViolations.length > 3) {
        nextActions.push(`... and ${errorViolations.length - 3} more violations.`);
      }

      nextActions.push("Rerun taskpad:intake:autoplan after evidence-gap wiring is complete.");

      knowledgeRevalidationParityStep = makeSkippedStep(
        "knowledge-revalidation-parity",
        buildCommand("taskpad:knowledge-revalidation-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
        SKIP_PLAN_CONTRACT_FAILED,
        "Skipped because evidence-gap parity step failed.",
      );

      markitdownPriorityBriefParityStep = makeSkippedStep(
        "markitdown-priority-brief-parity",
        buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
        SKIP_PLAN_CONTRACT_FAILED,
        "Skipped because evidence-gap parity step failed.",
      );

      return {
        status: "fail",
        verdict: "hold",
        reasonCode: AUTOPLAN_HOLD_EVIDENCE_GAP_PARITY,
        taskpadPath,
        planPath,
        selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
        plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
        newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
        steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
        queueReconcile: seedPayload.queueReconcile,
        artifact: seedPayload.artifact,
        evidenceGapParity: evidenceGapPayload,
        knowledgeRevalidationParity: null,
        markitdownPriorityBriefParity: null,
        nextActions,
      };
    }
  }

  // Evidence-gap parity passed (or has no planned artifacts)
  parityStep = {
    id: "evidence-gap-parity",
    command: evidenceGapParityRun.command,
    status: "pass",
    exitCode: evidenceGapParityRun.exitCode,
    reasonCode: null,
    summary: evidenceGapPayload.summary.totalArtifacts === 0
      ? "Evidence-gap parity gate passed (no planned evidence-gap artifacts)."
      : `Evidence-gap parity gate passed (${evidenceGapPayload.summary.fullyWiredArtifacts}/${evidenceGapPayload.summary.totalArtifacts} artifacts fully wired).`,
    stdout: evidenceGapParityRun.stdout,
    stderr: evidenceGapParityRun.stderr,
  };

  // Knowledge-revalidation parity check runs after evidence-gap parity passes
  const knowledgeRevalidationParityRun = runScript("taskpad:knowledge-revalidation-refresh-contract-parity", [
    "--taskpad", taskpadPath,
    "--plan", planPath,
    "--project-root", ".",
    "--format", "json",
  ]);
  const knowledgeRevalidationPayload = parseKnowledgeRevalidationParityPayload(knowledgeRevalidationParityRun.stdout);

  if (!knowledgeRevalidationPayload) {
    knowledgeRevalidationParityStep = {
      id: "knowledge-revalidation-parity",
      command: knowledgeRevalidationParityRun.command,
      status: "fail",
      exitCode: knowledgeRevalidationParityRun.exitCode,
      reasonCode: "KNOWLEDGE_REVALIDATION_PARITY_JSON_MISSING_OR_INVALID",
      summary: "Knowledge-revalidation parity step did not emit a parseable machine-readable payload.",
      stdout: knowledgeRevalidationParityRun.stdout,
      stderr: knowledgeRevalidationParityRun.stderr,
    };

    markitdownPriorityBriefParityStep = makeSkippedStep(
      "markitdown-priority-brief-parity",
      buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_CONTRACT_FAILED,
      "Skipped because knowledge-revalidation parity step failed.",
    );

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
      plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
      newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
      queueReconcile: seedPayload.queueReconcile,
      artifact: seedPayload.artifact,
      evidenceGapParity: evidenceGapPayload,
      knowledgeRevalidationParity: null,
      markitdownPriorityBriefParity: null,
      nextActions: [
        "Fix taskpad:knowledge-revalidation-refresh-contract-parity output contract markers.",
        "Ensure the gate returns valid JSON with status, violations, and summary fields.",
      ],
    };
  }

  const knowledgeRevalidationParityContractValid =
    (knowledgeRevalidationPayload.status === "pass" && knowledgeRevalidationParityRun.exitCode === 0) ||
    (knowledgeRevalidationPayload.status === "fail" && knowledgeRevalidationParityRun.exitCode !== 0);

  if (!knowledgeRevalidationParityContractValid) {
    knowledgeRevalidationParityStep = {
      id: "knowledge-revalidation-parity",
      command: knowledgeRevalidationParityRun.command,
      status: "fail",
      exitCode: knowledgeRevalidationParityRun.exitCode,
      reasonCode: "KNOWLEDGE_REVALIDATION_PARITY_EXIT_SEMANTICS_INVALID",
      summary: "Knowledge-revalidation parity output violated deterministic status/exit semantics.",
      stdout: knowledgeRevalidationParityRun.stdout,
      stderr: knowledgeRevalidationParityRun.stderr,
    };

    markitdownPriorityBriefParityStep = makeSkippedStep(
      "markitdown-priority-brief-parity",
      buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
      SKIP_PLAN_CONTRACT_FAILED,
      "Skipped because knowledge-revalidation parity step failed.",
    );

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
      plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
      newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
      queueReconcile: seedPayload.queueReconcile,
      artifact: seedPayload.artifact,
      evidenceGapParity: evidenceGapPayload,
      knowledgeRevalidationParity: knowledgeRevalidationPayload,
      markitdownPriorityBriefParity: null,
      nextActions: [
        "Repair knowledge-revalidation parity exit semantics so pass exits 0 and fail exits non-zero.",
        "Rerun taskpad:intake:autoplan after parity contract is restored.",
      ],
    };
  }

  // Check if knowledge-revalidation parity failed with violations
  if (knowledgeRevalidationPayload.status === "fail" && knowledgeRevalidationPayload.violations.length > 0) {
    const errorViolations = knowledgeRevalidationPayload.violations.filter(v => v.severity === "error");
    const hasPlannedArtifactsWithMissingWiring = knowledgeRevalidationPayload.summary.totalArtifacts > 0 &&
      (knowledgeRevalidationPayload.summary.missingWiringArtifacts > 0 ||
       knowledgeRevalidationPayload.summary.partiallyWiredArtifacts > 0);

    if (errorViolations.length > 0 || hasPlannedArtifactsWithMissingWiring) {
      knowledgeRevalidationParityStep = {
        id: "knowledge-revalidation-parity",
        command: knowledgeRevalidationParityRun.command,
        status: "fail",
        exitCode: knowledgeRevalidationParityRun.exitCode,
        reasonCode: AUTOPLAN_HOLD_KNOWLEDGE_REVALIDATION_PARITY,
        summary: `Knowledge-revalidation parity gate failed with ${errorViolations.length} error violations and ${knowledgeRevalidationPayload.summary.missingWiringArtifacts} artifacts with missing wiring.`,
        stdout: knowledgeRevalidationParityRun.stdout,
        stderr: knowledgeRevalidationParityRun.stderr,
      };

      const nextActions: string[] = [
        `Fix ${knowledgeRevalidationPayload.summary.missingWiringArtifacts + knowledgeRevalidationPayload.summary.partiallyWiredArtifacts} knowledge-revalidation artifact(s) with missing save-flow wiring.`,
      ];

      // Add specific remediation actions for each violation
      for (const violation of errorViolations.slice(0, 3)) {
        nextActions.push(`[${violation.ruleId}] ${violation.artifactName}: ${violation.remediation.description}`);
        if (violation.remediation.scaffoldCommand) {
          nextActions.push(`  Scaffold: ${violation.remediation.scaffoldCommand}`);
        }
      }

      if (errorViolations.length > 3) {
        nextActions.push(`... and ${errorViolations.length - 3} more violations.`);
      }

      nextActions.push("Rerun taskpad:intake:autoplan after knowledge-revalidation wiring is complete.");

      markitdownPriorityBriefParityStep = makeSkippedStep(
        "markitdown-priority-brief-parity",
        buildCommand("taskpad:markitdown-priority-brief-refresh-contract-parity", ["--taskpad", taskpadPath, "--plan", planPath, "--project-root", ".", "--format", "json"]),
        SKIP_PLAN_CONTRACT_FAILED,
        "Skipped because knowledge-revalidation parity step failed.",
      );

      return {
        status: "fail",
        verdict: "hold",
        reasonCode: AUTOPLAN_HOLD_KNOWLEDGE_REVALIDATION_PARITY,
        taskpadPath,
        planPath,
        selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
        plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
        newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
        steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
        queueReconcile: seedPayload.queueReconcile,
        artifact: seedPayload.artifact,
        evidenceGapParity: evidenceGapPayload,
        knowledgeRevalidationParity: knowledgeRevalidationPayload,
        markitdownPriorityBriefParity: null,
        nextActions,
      };
    }
  }

  // Knowledge-revalidation parity passed (or has no planned artifacts)
  knowledgeRevalidationParityStep = {
    id: "knowledge-revalidation-parity",
    command: knowledgeRevalidationParityRun.command,
    status: "pass",
    exitCode: knowledgeRevalidationParityRun.exitCode,
    reasonCode: null,
    summary: knowledgeRevalidationPayload.summary.totalArtifacts === 0
      ? "Knowledge-revalidation parity gate passed (no planned knowledge-revalidation artifacts)."
      : `Knowledge-revalidation parity gate passed (${knowledgeRevalidationPayload.summary.fullyWiredArtifacts}/${knowledgeRevalidationPayload.summary.totalArtifacts} artifacts fully wired).`,
    stdout: knowledgeRevalidationParityRun.stdout,
    stderr: knowledgeRevalidationParityRun.stderr,
  };

  // Markitdown priority brief parity check runs after knowledge-revalidation parity passes
  const markitdownParityRun = runScript("taskpad:markitdown-priority-brief-refresh-contract-parity", [
    "--taskpad", taskpadPath,
    "--plan", planPath,
    "--project-root", ".",
    "--format", "json",
  ]);
  const markitdownPayload = parseMarkitdownPriorityBriefParityPayload(markitdownParityRun.stdout);

  if (!markitdownPayload) {
    markitdownPriorityBriefParityStep = {
      id: "markitdown-priority-brief-parity",
      command: markitdownParityRun.command,
      status: "fail",
      exitCode: markitdownParityRun.exitCode,
      reasonCode: "MARKITDOWN_PRIORITY_BRIEF_PARITY_JSON_MISSING_OR_INVALID",
      summary: "Markitdown priority brief parity step did not emit a parseable machine-readable payload.",
      stdout: markitdownParityRun.stdout,
      stderr: markitdownParityRun.stderr,
    };

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
      plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
      newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
      queueReconcile: seedPayload.queueReconcile,
      artifact: seedPayload.artifact,
      evidenceGapParity: evidenceGapPayload,
      knowledgeRevalidationParity: knowledgeRevalidationPayload,
      markitdownPriorityBriefParity: null,
      nextActions: [
        "Fix taskpad:markitdown-priority-brief-refresh-contract-parity output contract markers.",
        "Ensure the gate returns valid JSON with status, violations, and summary fields.",
      ],
    };
  }

  const markitdownParityContractValid =
    (markitdownPayload.status === "pass" && markitdownParityRun.exitCode === 0) ||
    (markitdownPayload.status === "fail" && markitdownParityRun.exitCode !== 0);

  if (!markitdownParityContractValid) {
    markitdownPriorityBriefParityStep = {
      id: "markitdown-priority-brief-parity",
      command: markitdownParityRun.command,
      status: "fail",
      exitCode: markitdownParityRun.exitCode,
      reasonCode: "MARKITDOWN_PRIORITY_BRIEF_PARITY_EXIT_SEMANTICS_INVALID",
      summary: "Markitdown priority brief parity output violated deterministic status/exit semantics.",
      stdout: markitdownParityRun.stdout,
      stderr: markitdownParityRun.stderr,
    };

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
      plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
      newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
      queueReconcile: seedPayload.queueReconcile,
      artifact: seedPayload.artifact,
      evidenceGapParity: evidenceGapPayload,
      knowledgeRevalidationParity: knowledgeRevalidationPayload,
      markitdownPriorityBriefParity: markitdownPayload,
      nextActions: [
        "Repair markitdown priority brief parity exit semantics so pass exits 0 and fail exits non-zero.",
        "Rerun taskpad:intake:autoplan after parity contract is restored.",
      ],
    };
  }

  // Check if markitdown priority brief parity failed with violations
  if (markitdownPayload.status === "fail" && markitdownPayload.violations.length > 0) {
    const errorViolations = markitdownPayload.violations.filter(v => v.severity === "error");
    const hasPlannedArtifactsWithMissingWiring = markitdownPayload.summary.totalArtifacts > 0 &&
      (markitdownPayload.summary.missingWiringArtifacts > 0 ||
       markitdownPayload.summary.partiallyWiredArtifacts > 0);

    if (errorViolations.length > 0 || hasPlannedArtifactsWithMissingWiring) {
      markitdownPriorityBriefParityStep = {
        id: "markitdown-priority-brief-parity",
        command: markitdownParityRun.command,
        status: "fail",
        exitCode: markitdownParityRun.exitCode,
        reasonCode: AUTOPLAN_HOLD_MARKITDOWN_PRIORITY_BRIEF_PARITY,
        summary: `Markitdown priority brief parity gate failed with ${errorViolations.length} error violations and ${markitdownPayload.summary.missingWiringArtifacts} artifacts with missing wiring.`,
        stdout: markitdownParityRun.stdout,
        stderr: markitdownParityRun.stderr,
      };

      const nextActions: string[] = [
        `Fix ${markitdownPayload.summary.missingWiringArtifacts + markitdownPayload.summary.partiallyWiredArtifacts} markitdown priority brief artifact(s) with missing save-flow wiring.`,
      ];

      // Add specific remediation actions for each violation
      for (const violation of errorViolations.slice(0, 3)) {
        nextActions.push(`[${violation.ruleId}] ${violation.artifactName}: ${violation.remediation.description}`);
        if (violation.remediation.scaffoldCommand) {
          nextActions.push(`  Scaffold: ${violation.remediation.scaffoldCommand}`);
        }
      }

      if (errorViolations.length > 3) {
        nextActions.push(`... and ${errorViolations.length - 3} more violations.`);
      }

      nextActions.push("Rerun taskpad:intake:autoplan after markitdown priority brief wiring is complete.");

      return {
        status: "fail",
        verdict: "hold",
        reasonCode: AUTOPLAN_HOLD_MARKITDOWN_PRIORITY_BRIEF_PARITY,
        taskpadPath,
        planPath,
        selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
        plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
        newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
        steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep],
        queueReconcile: seedPayload.queueReconcile,
        artifact: seedPayload.artifact,
        evidenceGapParity: evidenceGapPayload,
        knowledgeRevalidationParity: knowledgeRevalidationPayload,
        markitdownPriorityBriefParity: markitdownPayload,
        nextActions,
      };
    }
  }

  // Markitdown priority brief parity passed (or has no planned artifacts)
  markitdownPriorityBriefParityStep = {
    id: "markitdown-priority-brief-parity",
    command: markitdownParityRun.command,
    status: "pass",
    exitCode: markitdownParityRun.exitCode,
    reasonCode: null,
    summary: markitdownPayload.summary.totalArtifacts === 0
      ? "Markitdown priority brief parity gate passed (no planned markitdown-priority-brief artifacts)."
      : `Markitdown priority brief parity gate passed (${markitdownPayload.summary.fullyWiredArtifacts}/${markitdownPayload.summary.totalArtifacts} artifacts fully wired).`,
    stdout: markitdownParityRun.stdout,
    stderr: markitdownParityRun.stderr,
  };

  // Priority-brief freshness gate runs after markitdown-priority-brief parity passes
  const freshnessRun = runScript("taskpad:priority-brief-freshness-gate", [
    "--taskpad", taskpadPath,
    "--plan", planPath,
    "--project-root", ".",
    "--format", "json",
  ]);
  const freshnessPayload = parsePriorityBriefFreshnessPayload(freshnessRun.stdout);

  if (!freshnessPayload) {
    freshnessStep = {
      id: "priority-brief-freshness",
      command: freshnessRun.command,
      status: "fail",
      exitCode: freshnessRun.exitCode,
      reasonCode: "PRIORITY_BRIEF_FRESHNESS_JSON_MISSING_OR_INVALID",
      summary: "Priority-brief freshness gate did not emit a parseable machine-readable payload.",
      stdout: freshnessRun.stdout,
      stderr: freshnessRun.stderr,
    };

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
      plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
      newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep, freshnessStep],
      queueReconcile: seedPayload.queueReconcile,
      artifact: seedPayload.artifact,
      evidenceGapParity: evidenceGapPayload,
      knowledgeRevalidationParity: knowledgeRevalidationPayload,
      markitdownPriorityBriefParity: markitdownPayload,
      priorityBriefFreshness: null,
      nextActions: [
        "Fix taskpad:priority-brief-freshness-gate output contract markers.",
        "Ensure the gate returns valid JSON with status, briefs, violations, and summary fields.",
      ],
    };
  }

  const freshnessContractValid =
    (freshnessPayload.status === "pass" && freshnessRun.exitCode === 0) ||
    (freshnessPayload.status === "fail" && freshnessRun.exitCode !== 0);

  if (!freshnessContractValid) {
    freshnessStep = {
      id: "priority-brief-freshness",
      command: freshnessRun.command,
      status: "fail",
      exitCode: freshnessRun.exitCode,
      reasonCode: "PRIORITY_BRIEF_FRESHNESS_EXIT_SEMANTICS_INVALID",
      summary: "Priority-brief freshness output violated deterministic status/exit semantics.",
      stdout: freshnessRun.stdout,
      stderr: freshnessRun.stderr,
    };

    return {
      status: "fail",
      verdict: "blocked",
      reasonCode: AUTOPLAN_BLOCKED_RUNTIME,
      taskpadPath,
      planPath,
      selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
      plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
      newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
      steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep, freshnessStep],
      queueReconcile: seedPayload.queueReconcile,
      artifact: seedPayload.artifact,
      evidenceGapParity: evidenceGapPayload,
      knowledgeRevalidationParity: knowledgeRevalidationPayload,
      markitdownPriorityBriefParity: markitdownPayload,
      priorityBriefFreshness: freshnessPayload,
      nextActions: [
        "Repair priority-brief freshness exit semantics so pass exits 0 and fail exits non-zero.",
        "Rerun taskpad:intake:autoplan after freshness contract is restored.",
      ],
    };
  }

  // Check if freshness gate failed with violations
  if (freshnessPayload.status === "fail" && freshnessPayload.violations.length > 0) {
    const errorViolations = freshnessPayload.violations.filter(v => v.severity === "error");
    const hasStaleBriefs = freshnessPayload.summary.staleBriefs > 0;

    if (errorViolations.length > 0 || hasStaleBriefs) {
      freshnessStep = {
        id: "priority-brief-freshness",
        command: freshnessRun.command,
        status: "fail",
        exitCode: freshnessRun.exitCode,
        reasonCode: AUTOPLAN_HOLD_PRIORITY_BRIEF_FRESHNESS,
        summary: `Priority-brief freshness gate failed with ${errorViolations.length} error violations and ${freshnessPayload.summary.staleBriefs} stale brief(s).`,
        stdout: freshnessRun.stdout,
        stderr: freshnessRun.stderr,
      };

      const nextActions: string[] = [
        `Refresh ${freshnessPayload.summary.staleBriefs} stale priority-brief artifact(s).`,
      ];

      // Add specific remediation actions for each error violation
      for (const violation of errorViolations.slice(0, 3)) {
        nextActions.push(`[${violation.ruleId}] ${violation.briefName}: ${violation.remediation.description}`);
        if (violation.remediation.scaffoldCommand) {
          nextActions.push(`  Scaffold: ${violation.remediation.scaffoldCommand}`);
        }
      }

      if (errorViolations.length > 3) {
        nextActions.push(`... and ${errorViolations.length - 3} more violations.`);
      }

      nextActions.push("Rerun taskpad:intake:autoplan after priority-brief freshness is restored.");

      return {
        status: "fail",
        verdict: "hold",
        reasonCode: AUTOPLAN_HOLD_PRIORITY_BRIEF_FRESHNESS,
        taskpadPath,
        planPath,
        selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
        plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
        newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
        steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep, freshnessStep],
        queueReconcile: seedPayload.queueReconcile,
        artifact: seedPayload.artifact,
        evidenceGapParity: evidenceGapPayload,
        knowledgeRevalidationParity: knowledgeRevalidationPayload,
        markitdownPriorityBriefParity: markitdownPayload,
        priorityBriefFreshness: freshnessPayload,
        nextActions,
      };
    }
  }

  // Priority-brief freshness passed (or has no stale briefs)
  freshnessStep = {
    id: "priority-brief-freshness",
    command: freshnessRun.command,
    status: "pass",
    exitCode: freshnessRun.exitCode,
    reasonCode: null,
    summary: freshnessPayload.summary.totalBriefs === 0
      ? "Priority-brief freshness gate passed (no priority-brief artifacts to check)."
      : `Priority-brief freshness gate passed (${freshnessPayload.summary.freshBriefs}/${freshnessPayload.summary.totalBriefs} briefs fresh, ${freshnessPayload.summary.staleBriefs} stale, ${freshnessPayload.summary.missingBriefs} missing).`,
    stdout: freshnessRun.stdout,
    stderr: freshnessRun.stderr,
  };

  return {
    status: "pass",
    verdict: "ready",
    reasonCode: seedPayload.status === "seeded" ? AUTOPLAN_READY_PLANNED : seedPayload.status === "fallback" ? "AUTOPLAN_READY_FALLBACK_ARTIFACT" : AUTOPLAN_READY_NOOP_ALREADY_PLANNED,
    taskpadPath,
    planPath,
    selectedBacklogLine: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.selectedBacklogLine : null,
    plannedMarker: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? plannedMarker : null,
    newSliceHeading: (seedPayload.status === "seeded" || seedPayload.status === "fallback") ? seedPayload.newSliceHeading : null,
    steps: [recoverStep, seedStep, contractStep, parityStep, knowledgeRevalidationParityStep, markitdownPriorityBriefParityStep, freshnessStep],
    queueReconcile: seedPayload.queueReconcile,
    artifact: seedPayload.artifact,
    evidenceGapParity: evidenceGapPayload,
    knowledgeRevalidationParity: knowledgeRevalidationPayload,
    markitdownPriorityBriefParity: markitdownPayload,
    priorityBriefFreshness: freshnessPayload,
    nextActions: ["Proceed with Builder dispatch using the newest active plan slice."],
  };
}

function printHumanSummary(result: TaskpadIntakeAutoplanResult): void {
  console.log(`TASKPAD intake-autoplan: ${result.status.toUpperCase()} (${result.verdict.toUpperCase()})`);
  console.log(`- reasonCode: ${result.reasonCode}`);
  console.log(`- taskpadPath: ${result.taskpadPath}`);
  console.log(`- planPath: ${result.planPath}`);
  console.log(`- selectedBacklogLine: ${result.selectedBacklogLine ?? "n/a"}`);
  console.log(`- plannedMarker: ${result.plannedMarker ?? "n/a"}`);
  console.log(`- newSliceHeading: ${result.newSliceHeading ?? "n/a"}`);

  for (const step of result.steps) {
    console.log(`- [${step.id}] ${step.status.toUpperCase()} (${step.reasonCode ?? "none"})`);
  }

  if (result.artifact.artifactPath) {
    console.log(`- artifact.artifactPath: ${result.artifact.artifactPath}`);
  }

  if (result.artifact.preflightResult) {
    const pf = result.artifact.preflightResult;
    console.log(`- artifact.preflight.writable: ${pf.writable}`);
    console.log(`- artifact.preflight.reasonCode: ${result.artifact.preflightReasonCode ?? "n/a"}`);
    console.log(`- artifact.preflight.permissionClass: ${result.artifact.preflightReasonCode?.startsWith("PRECHECK_PERMISSION_") ? "permission-denied" : "non-permission"}`);
  }

  if (result.queueReconcile) {
    const qr = result.queueReconcile;
    console.log(`- queueReconcile.status: ${qr.status}`);
    console.log(`- queueReconcile.reasonCodes: ${qr.reasonCodes.join(", ")}`);
    console.log(`- queueReconcile.sectionsPresent.workQueue: ${qr.sectionsPresent.workQueue}`);
    console.log(`- queueReconcile.sectionsPresent.executionQueue: ${qr.sectionsPresent.executionQueue}`);
    console.log(`- queueReconcile.sectionsPresent.autonomousKickoffQueue: ${qr.sectionsPresent.autonomousKickoffQueue}`);
    console.log(`- queueReconcile.sectionsPresent.selfImprovementBacklog: ${qr.sectionsPresent.selfImprovementBacklog}`);
    console.log(`- queueReconcile.healedSections: ${qr.healedSections.length > 0 ? qr.healedSections.join(", ") : "none"}`);
  }

  if (result.evidenceGapParity) {
    const eg = result.evidenceGapParity;
    console.log(`- evidenceGapParity.status: ${eg.status}`);
    console.log(`- evidenceGapParity.totalArtifacts: ${eg.summary.totalArtifacts}`);
    console.log(`- evidenceGapParity.fullyWiredArtifacts: ${eg.summary.fullyWiredArtifacts}`);
    console.log(`- evidenceGapParity.missingWiringArtifacts: ${eg.summary.missingWiringArtifacts}`);
  }

  if (result.knowledgeRevalidationParity) {
    const kr = result.knowledgeRevalidationParity;
    console.log(`- knowledgeRevalidationParity.status: ${kr.status}`);
    console.log(`- knowledgeRevalidationParity.totalArtifacts: ${kr.summary.totalArtifacts}`);
    console.log(`- knowledgeRevalidationParity.fully