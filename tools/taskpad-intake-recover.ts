#!/usr/bin/env bun

import { resolve } from "node:path";

type RecoverStepId =
  | "queue-health-initial"
  | "auto-ideation"
  | "apply-fallback"
  | "queue-health-recheck"
  | "plan-integrity"
  | "verify-intake-full";

type RecoverStepStatus = "pass" | "fail" | "skipped";
type RecoverVerdict = "ready" | "hold" | "blocked";

interface RecoverStepResult {
  id: RecoverStepId;
  command: string;
  status: RecoverStepStatus;
  exitCode: number | null;
  reasonCode: string | null;
  summary: string;
  stdout: string;
  stderr: string;
}

interface IntakeRecoverCompositionResult {
  status: "pass" | "fail";
  verdict: RecoverVerdict;
  reasonCode: string;
  taskpadPath: string;
  planPath: string;
  routingMode: "noop" | "recovery";
  routingChoiceReason: string;
  steps: RecoverStepResult[];
  artifacts: {
    autoIdeationArtifactPath: string | null;
  };
  nextActions: string[];
}

interface CliArgs {
  taskpadPath?: string;
  planPath?: string;
}

interface CommandRunResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface QueueHealthInterpretation {
  isQueueEmptyFailure: boolean;
}

interface AutoIdeationInterpretation {
  status: "seeded" | "deduped" | "noop" | "fallback" | null;
  artifactPath: string | null;
}

interface VerifyFullInterpretation {
  isQueueEmptyGateFailure: boolean;
  isPlanIntegrityGateFailure: boolean;
}

const SKIP_QUEUE_NOT_EMPTY = "SKIP_QUEUE_NOT_EMPTY";
const SKIP_NO_FALLBACK_ARTIFACT = "SKIP_NO_FALLBACK_ARTIFACT";
const SKIP_AUTO_IDEATION_NOT_RUN = "SKIP_AUTO_IDEATION_NOT_RUN";
const SKIP_INITIAL_QUEUE_HEALTH_RUNTIME_FAILURE = "SKIP_INITIAL_QUEUE_HEALTH_RUNTIME_FAILURE";
const SKIP_PRIOR_HARD_BLOCK = "SKIP_PRIOR_HARD_BLOCK";

const RECOVER_READY = "RECOVER_READY";
const RECOVER_HOLD_QUEUE_EMPTY = "RECOVER_HOLD_QUEUE_EMPTY";
const RECOVER_HOLD_PLAN_INTEGRITY = "RECOVER_HOLD_PLAN_INTEGRITY";
const RECOVER_BLOCKED_CONTRACT = "RECOVER_BLOCKED_CONTRACT";
const RECOVER_BLOCKED_RUNTIME = "RECOVER_BLOCKED_RUNTIME";

function printHelp(): void {
  console.log(`
TASKPAD Intake Recover

USAGE:
  bun run tools/taskpad-intake-recover.ts --taskpad <path> --plan <path>

OPTIONS:
  --taskpad <path>   Path to TASKPAD markdown file
  --plan <path>      Path to IMPLEMENTATION_PLAN markdown file
  --help, -h         Show this help message
`);
}

function parseArgs(argv: string[]): CliArgs {
  let taskpadPath: string | undefined;
  let planPath: string | undefined;

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

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!taskpadPath) {
    throw new Error("Missing required --taskpad <path>");
  }

  if (!planPath) {
    throw new Error("Missing required --plan <path>");
  }

  return { taskpadPath, planPath };
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : JSON.stringify(value);
}

function buildCommand(script: string, args: string[]): string {
  return `bun run ${script} -- ${args.map((arg) => shellQuote(arg)).join(" ")}`;
}

function runScript(script: string, args: string[]): CommandRunResult {
  const command = buildCommand(script, args);
  const run = Bun.spawnSync(["bun", "run", script, "--", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = new TextDecoder().decode(run.stdout).trim();
  const stderr = new TextDecoder().decode(run.stderr).trim();

  return {
    command,
    exitCode: run.exitCode,
    stdout,
    stderr,
  };
}

function makeStepFromRun(
  id: RecoverStepId,
  run: CommandRunResult,
  overrides?: { status?: RecoverStepStatus; reasonCode?: string | null; summary?: string },
): RecoverStepResult {
  const status = overrides?.status ?? (run.exitCode === 0 ? "pass" : "fail");
  const reasonCode =
    overrides?.reasonCode ??
    (status === "pass" ? null : run.exitCode === 0 ? "STEP_CONTRACT_VIOLATION" : "STEP_EXIT_NON_ZERO");
  const summary =
    overrides?.summary ??
    (status === "pass" ? "Command completed successfully." : "Command failed or violated contract.");

  return {
    id,
    command: run.command,
    status,
    exitCode: run.exitCode,
    reasonCode,
    summary,
    stdout: run.stdout,
    stderr: run.stderr,
  };
}

function makeSkippedStep(id: RecoverStepId, command: string, reasonCode: string, summary: string): RecoverStepResult {
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

function outputContainsQueueEmptySignal(output: string): boolean {
  return /Intake blocked:\s*both execution queues are empty\./i.test(output);
}

function outputContainsPlanIntegrityFailSignal(output: string): boolean {
  return /IMPLEMENTATION_PLAN integrity:\s*FAIL/i.test(output);
}

function interpretQueueHealth(run: CommandRunResult): QueueHealthInterpretation {
  const combined = `${run.stdout}\n${run.stderr}`;
  const hasEmptyQueueSignal = outputContainsQueueEmptySignal(combined);

  return {
    isQueueEmptyFailure: run.exitCode !== 0 && hasEmptyQueueSignal,
  };
}

function interpretVerifyFull(run: CommandRunResult): VerifyFullInterpretation {
  const combined = `${run.stdout}\n${run.stderr}`;
  return {
    isQueueEmptyGateFailure: run.exitCode !== 0 && outputContainsQueueEmptySignal(combined),
    isPlanIntegrityGateFailure: run.exitCode !== 0 && outputContainsPlanIntegrityFailSignal(combined),
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

function interpretAutoIdeation(run: CommandRunResult): AutoIdeationInterpretation {
  const payload = extractJsonBlock(run.stdout, "AUTO_IDEATION_JSON_START", "AUTO_IDEATION_JSON_END");

  if (!payload || typeof payload !== "object") {
    return { status: null, artifactPath: null };
  }

  const obj = payload as Record<string, unknown>;
  const status =
    obj.status === "seeded" || obj.status === "deduped" || obj.status === "noop" || obj.status === "fallback"
      ? obj.status
      : null;

  const artifactPath = typeof obj.artifactPath === "string" && obj.artifactPath.trim().length > 0 ? obj.artifactPath : null;

  return {
    status,
    artifactPath,
  };
}

function isContractBlock(step: RecoverStepResult): boolean {
  return (
    step.reasonCode === "AUTO_IDEATION_JSON_MISSING_OR_INVALID" ||
    step.reasonCode === "AUTO_IDEATION_NOOP_ON_EMPTY_QUEUE" ||
    step.reasonCode === "AUTO_IDEATION_FALLBACK_ARTIFACT_MISSING"
  );
}

function isRuntimeBlock(step: RecoverStepResult): boolean {
  if (step.status !== "fail") {
    return false;
  }

  if (step.reasonCode === "QUEUE_STILL_EMPTY_AFTER_RECOVERY") {
    return false;
  }

  if (step.id === "queue-health-initial" && step.reasonCode === "QUEUE_EMPTY") {
    return false;
  }

  if (step.id === "plan-integrity" || step.id === "verify-intake-full") {
    return false;
  }

  if (isContractBlock(step)) {
    return false;
  }

  return true;
}

function buildVerdict(result: {
  steps: RecoverStepResult[];
  hadContractBlock: boolean;
  hadRuntimeBlock: boolean;
}): { verdict: RecoverVerdict; reasonCode: string; nextActions: string[] } {
  const queueRecheckStep = result.steps.find((step) => step.id === "queue-health-recheck");
  const planIntegrityStep = result.steps.find((step) => step.id === "plan-integrity");
  const verifyFullStep = result.steps.find((step) => step.id === "verify-intake-full");

  if (
    queueRecheckStep?.status === "fail" &&
    (queueRecheckStep.reasonCode === "QUEUE_STILL_EMPTY_AFTER_RECOVERY" ||
      outputContainsQueueEmptySignal(`${queueRecheckStep.stdout}\n${queueRecheckStep.stderr}`))
  ) {
    return {
      verdict: "hold",
      reasonCode: RECOVER_HOLD_QUEUE_EMPTY,
      nextActions: [
        "Seed at least one unchecked canonical bullet in TASKPAD and rerun taskpad:intake:recover.",
        "If fallback artifact exists, apply it or investigate why auto-ideation did not repopulate queues.",
      ],
    };
  }

  if (planIntegrityStep?.status === "fail") {
    return {
      verdict: "hold",
      reasonCode: RECOVER_HOLD_PLAN_INTEGRITY,
      nextActions: [
        "Fix active intake slice integrity violations in IMPLEMENTATION_PLAN.md.",
        "Rerun plan:integrity, then rerun taskpad:intake:recover.",
      ],
    };
  }

  if (verifyFullStep?.status === "fail") {
    const verifyCombined = `${verifyFullStep.stdout}\n${verifyFullStep.stderr}`;

    if (outputContainsQueueEmptySignal(verifyCombined)) {
      return {
        verdict: "hold",
        reasonCode: RECOVER_HOLD_QUEUE_EMPTY,
        nextActions: [
          "Seed at least one unchecked canonical bullet in TASKPAD and rerun taskpad:intake:recover.",
          "Run verify:taskpad:intake:full directly after queue recovery to confirm deterministic pass.",
        ],
      };
    }

    if (outputContainsPlanIntegrityFailSignal(verifyCombined)) {
      return {
        verdict: "hold",
        reasonCode: RECOVER_HOLD_PLAN_INTEGRITY,
        nextActions: [
          "Repair IMPLEMENTATION_PLAN active slice integrity and rerun verify:taskpad:intake:full.",
          "After gate passes, rerun taskpad:intake:recover.",
        ],
      };
    }
  }

  if (result.hadContractBlock) {
    return {
      verdict: "blocked",
      reasonCode: RECOVER_BLOCKED_CONTRACT,
      nextActions: [
        "Investigate orchestrator contract violation in step outputs.",
        "Fix the failing command output contract and rerun taskpad:intake:recover.",
      ],
    };
  }

  if (result.hadRuntimeBlock || verifyFullStep?.status === "fail") {
    return {
      verdict: "blocked",
      reasonCode: RECOVER_BLOCKED_RUNTIME,
      nextActions: [
        "Inspect failed command stderr/stdout and remediate runtime failure.",
        "Rerun taskpad:intake:recover after environment/tooling issues are resolved.",
      ],
    };
  }

  return {
    verdict: "ready",
    reasonCode: RECOVER_READY,
    nextActions: ["Proceed with normal Builder dispatch; intake gates passed."],
  };
}

export function runIntakeRecoverComposition(taskpadPath: string, planPath: string): IntakeRecoverCompositionResult {
  const steps: RecoverStepResult[] = [];

  const queueInitialRun = runScript("taskpad:queue-health", ["--taskpad", taskpadPath]);
  const queueInitialInterpretation = interpretQueueHealth(queueInitialRun);
  const queueInitialStep = makeStepFromRun(
    "queue-health-initial",
    queueInitialRun,
    queueInitialInterpretation.isQueueEmptyFailure
      ? {
          reasonCode: "QUEUE_EMPTY",
          summary: "Both execution queues are empty; running recovery branch.",
        }
      : undefined,
  );
  steps.push(queueInitialStep);

  // Determine routing mode for machine-observable output
  const routingMode: "noop" | "recovery" = queueInitialInterpretation.isQueueEmptyFailure ? "recovery" : "noop";
  const routingChoiceReason = queueInitialInterpretation.isQueueEmptyFailure
    ? "Initial queue health reported empty; entering recovery branch with --target-queue work"
    : "Initial queue health passed; skipping recovery branch";

  let autoIdeationStep: RecoverStepResult;
  let applyFallbackStep: RecoverStepResult;
  let queueRecheckStep: RecoverStepResult;
  let autoIdeationArtifactPath: string | null = null;

  const autoIdeationCommand = buildCommand("taskpad:auto-ideation", ["--taskpad", taskpadPath, "--plan", planPath, "--target-queue", "work"]);
  const applyFallbackTemplateCommand =
    "bun run taskpad:apply-fallback -- --taskpad <path> --artifact <artifact-path-from-auto-ideation>";
  const queueRecheckCommand = buildCommand("taskpad:queue-health", ["--taskpad", taskpadPath]);

  if (queueInitialStep.status === "pass") {
    autoIdeationStep = makeSkippedStep(
      "auto-ideation",
      autoIdeationCommand,
      SKIP_QUEUE_NOT_EMPTY,
      "Initial queue health passed; auto-ideation is not required.",
    );
    applyFallbackStep = makeSkippedStep(
      "apply-fallback",
      applyFallbackTemplateCommand,
      SKIP_AUTO_IDEATION_NOT_RUN,
      "Auto-ideation did not run; no fallback artifact can be applied.",
    );
    queueRecheckStep = makeSkippedStep(
      "queue-health-recheck",
      queueRecheckCommand,
      SKIP_AUTO_IDEATION_NOT_RUN,
      "Queue re-check is only required after an auto-ideation attempt.",
    );
  } else if (queueInitialInterpretation.isQueueEmptyFailure) {
    const autoRun = runScript("taskpad:auto-ideation", ["--taskpad", taskpadPath, "--plan", planPath, "--target-queue", "work"]);
    const auto = interpretAutoIdeation(autoRun);

    if (auto.status === null) {
      autoIdeationStep = makeStepFromRun("auto-ideation", autoRun, {
        status: "fail",
        reasonCode: "AUTO_IDEATION_JSON_MISSING_OR_INVALID",
        summary: "Auto-ideation did not emit a parseable machine-readable payload.",
      });
    } else if (auto.status === "noop") {
      autoIdeationStep = makeStepFromRun("auto-ideation", autoRun, {
        status: "fail",
        reasonCode: "AUTO_IDEATION_NOOP_ON_EMPTY_QUEUE",
        summary: "Contract violation: auto-ideation returned noop after empty-queue trigger.",
      });
    } else {
      autoIdeationStep = makeStepFromRun("auto-ideation", autoRun);
    }

    autoIdeationArtifactPath = auto.artifactPath;

    if (auto.status === "fallback") {
      if (!auto.artifactPath) {
        applyFallbackStep = {
          id: "apply-fallback",
          command: applyFallbackTemplateCommand,
          status: "fail",
          exitCode: null,
          reasonCode: "AUTO_IDEATION_FALLBACK_ARTIFACT_MISSING",
          summary: "Auto-ideation reported fallback but did not provide artifactPath.",
          stdout: "",
          stderr: "",
        };
      } else {
        const applyRun = runScript("taskpad:apply-fallback", ["--taskpad", taskpadPath, "--artifact", auto.artifactPath]);
        applyFallbackStep = makeStepFromRun("apply-fallback", applyRun);
      }
    } else {
      applyFallbackStep = makeSkippedStep(
        "apply-fallback",
        applyFallbackTemplateCommand,
        SKIP_NO_FALLBACK_ARTIFACT,
        "Auto-ideation did not return fallback; no artifact apply is required.",
      );
    }

    const queueRecheckRun = runScript("taskpad:queue-health", ["--taskpad", taskpadPath]);
    const queueRecheckInterpretation = interpretQueueHealth(queueRecheckRun);
    queueRecheckStep = makeStepFromRun(
      "queue-health-recheck",
      queueRecheckRun,
      queueRecheckInterpretation.isQueueEmptyFailure
        ? {
            reasonCode: "QUEUE_STILL_EMPTY_AFTER_RECOVERY",
            summary: "Queue remained empty after deterministic recovery branch.",
          }
        : undefined,
    );
  } else {
    autoIdeationStep = makeSkippedStep(
      "auto-ideation",
      autoIdeationCommand,
      SKIP_INITIAL_QUEUE_HEALTH_RUNTIME_FAILURE,
      "Initial queue-health failed for non-empty-queue/runtime reasons; recovery branch not attempted.",
    );
    applyFallbackStep = makeSkippedStep(
      "apply-fallback",
      applyFallbackTemplateCommand,
      SKIP_AUTO_IDEATION_NOT_RUN,
      "Auto-ideation did not run; no fallback artifact can be applied.",
    );
    queueRecheckStep = makeSkippedStep(
      "queue-health-recheck",
      queueRecheckCommand,
      SKIP_AUTO_IDEATION_NOT_RUN,
      "Queue re-check requires a prior auto-ideation attempt.",
    );
  }

  steps.push(autoIdeationStep, applyFallbackStep, queueRecheckStep);

  const preTerminalSteps = steps.filter((step) => step.id !== "plan-integrity" && step.id !== "verify-intake-full");
  const hadContractBlock = preTerminalSteps.some(isContractBlock);
  const hadRuntimeBlock = preTerminalSteps.some(isRuntimeBlock);
  const shouldSkipTerminalGates = hadContractBlock || hadRuntimeBlock;

  if (shouldSkipTerminalGates) {
    const planCommand = buildCommand("plan:integrity", ["--plan", planPath]);
    const verifyCommand = buildCommand("verify:taskpad:intake:full", ["--taskpad", taskpadPath, "--plan", planPath]);

    steps.push(
      makeSkippedStep(
        "plan-integrity",
        planCommand,
        SKIP_PRIOR_HARD_BLOCK,
        "Skipped terminal gate because a prior orchestration hard-block occurred.",
      ),
      makeSkippedStep(
        "verify-intake-full",
        verifyCommand,
        SKIP_PRIOR_HARD_BLOCK,
        "Skipped terminal gate because a prior orchestration hard-block occurred.",
      ),
    );
  } else {
    const planIntegrityRun = runScript("plan:integrity", ["--plan", planPath]);
    const planIntegrityCombined = `${planIntegrityRun.stdout}\n${planIntegrityRun.stderr}`;
    const planIntegrityStep = makeStepFromRun(
      "plan-integrity",
      planIntegrityRun,
      planIntegrityRun.exitCode !== 0 && outputContainsPlanIntegrityFailSignal(planIntegrityCombined)
        ? {
            reasonCode: "PLAN_INTEGRITY_GATE_FAILED",
            summary: "Plan integrity gate failed for active intake slice.",
          }
        : undefined,
    );
    steps.push(planIntegrityStep);

    const verifyFullRun = runScript("verify:taskpad:intake:full", ["--taskpad", taskpadPath, "--plan", planPath]);
    const verifyInterpretation = interpretVerifyFull(verifyFullRun);
    const verifyStep = makeStepFromRun(
      "verify-intake-full",
      verifyFullRun,
      verifyInterpretation.isQueueEmptyGateFailure
        ? {
            reasonCode: "VERIFY_FULL_QUEUE_EMPTY",
            summary: "Full intake verify failed because both queues are empty.",
          }
        : verifyInterpretation.isPlanIntegrityGateFailure
          ? {
              reasonCode: "VERIFY_FULL_PLAN_INTEGRITY_FAILED",
              summary: "Full intake verify failed because plan integrity gate did not pass.",
            }
          : undefined,
    );
    steps.push(verifyStep);
  }

  const verdict = buildVerdict({
    steps,
    hadContractBlock,
    hadRuntimeBlock,
  });

  return {
    status: verdict.verdict === "ready" ? "pass" : "fail",
    verdict: verdict.verdict,
    reasonCode: verdict.reasonCode,
    taskpadPath,
    planPath,
    routingMode,
    routingChoiceReason,
    steps,
    artifacts: {
      autoIdeationArtifactPath,
    },
    nextActions: verdict.nextActions,
  };
}

function printHumanSummary(result: IntakeRecoverCompositionResult): void {
  console.log(`TASKPAD intake-recover composition: ${result.status.toUpperCase()} (${result.verdict.toUpperCase()})`);
  console.log(`- reasonCode: ${result.reasonCode}`);
  console.log(`- routingMode: ${result.routingMode}`);
  console.log(`- routingChoiceReason: ${result.routingChoiceReason}`);
  console.log(`- taskpadPath: ${result.taskpadPath}`);
  console.log(`- planPath: ${result.planPath}`);

  for (const step of result.steps) {
    console.log(`- [${step.id}] ${step.status.toUpperCase()} (${step.reasonCode ?? "none"})`);
  }

  if (result.nextActions.length > 0) {
    console.log("- nextActions:");
    for (const action of result.nextActions) {
      console.log(`  - ${action}`);
    }
  }
}

function printMachineReadableBlock(result: IntakeRecoverCompositionResult): void {
  console.log("INTAKE_RECOVER_JSON_START");
  console.log(JSON.stringify(result, null, 2));
  console.log("INTAKE_RECOVER_JSON_END");
}

function main(): void {
  let args: CliArgs;

  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`TASKPAD intake-recover: FAIL`);
    console.error(`- ${message}`);
    printHelp();
    process.exit(1);
  }

  const taskpadPath = resolve(args.taskpadPath!);
  const planPath = resolve(args.planPath!);

  const result = runIntakeRecoverComposition(taskpadPath, planPath);
  printHumanSummary(result);
  printMachineReadableBlock(result);

  process.exit(result.verdict === "ready" ? 0 : 1);
}

if (import.meta.main) {
  main();
}
