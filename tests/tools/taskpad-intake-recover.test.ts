import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { runIntakeRecoverComposition } from "../../tools/taskpad-intake-recover";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const TOOL_PATH = join(PROJECT_ROOT, "tools", "taskpad-intake-recover.ts");
const FIXTURES_ROOT = join(PROJECT_ROOT, "tests", "tools", "fixtures");
const tempDirs: string[] = [];

function readFixtureFile(fileName: string): string {
  return readFileSync(join(FIXTURES_ROOT, fileName), "utf8");
}

interface ScenarioStep {
  script: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ScenarioFixture {
  name: string;
  steps: ScenarioStep[];
}

interface IntakeRecoverCliResult {
  status: "pass" | "fail";
  verdict: "ready" | "hold" | "blocked";
  reasonCode: string;
  routingMode: "noop" | "recovery";
  routingChoiceReason: string;
  artifacts: {
    autoIdeationArtifactPath: string | null;
  };
  steps: Array<{
    id: string;
    status: "pass" | "fail" | "skipped";
    reasonCode: string | null;
  }>;
}

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function readScenarioFixture(fileName: string): ScenarioFixture {
  return JSON.parse(readFileSync(join(FIXTURES_ROOT, fileName), "utf8")) as ScenarioFixture;
}

function parseIntakeRecoverJson(stdout: string): IntakeRecoverCliResult {
  const startMarker = "INTAKE_RECOVER_JSON_START";
  const endMarker = "INTAKE_RECOVER_JSON_END";
  const start = stdout.indexOf(startMarker);
  const end = stdout.indexOf(endMarker);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`taskpad:intake:recover JSON block not found:\n${stdout}`);
  }

  const json = stdout.slice(start + startMarker.length, end).trim();
  return JSON.parse(json) as IntakeRecoverCliResult;
}

function createScenarioHarness(scenarioFixtureFile: string): {
  dir: string;
  taskpadPath: string;
  planPath: string;
} {
  const dir = makeTempDir("taskpad-intake-recover-");
  const scenarioPath = join(dir, "scenario.json");
  const statePath = join(dir, "state.json");
  const runnerPath = join(dir, "fake-runner.js");
  const packageJsonPath = join(dir, "package.json");
  const taskpadPath = join(dir, "TASKPAD.md");
  const planPath = join(dir, "IMPLEMENTATION_PLAN.md");

  const scenario = readScenarioFixture(scenarioFixtureFile);

  writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2), "utf8");
  writeFileSync(statePath, JSON.stringify({ index: 0, calls: [] }, null, 2), "utf8");
  writeFileSync(taskpadPath, "# TASKPAD\n", "utf8");
  writeFileSync(planPath, "# IMPLEMENTATION_PLAN\n", "utf8");

  writeFileSync(
    runnerPath,
    `const fs = require("node:fs");
const path = require("node:path");

const scriptName = process.argv[2];
const scenarioPath = path.join(process.cwd(), "scenario.json");
const statePath = path.join(process.cwd(), "state.json");

const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));

const expected = scenario.steps[state.index];
if (expected === undefined || expected === null) {
  process.stderr.write("No scenario step remaining.\\n");
  process.exit(94);
}

if (expected.script === scriptName) {
  // script matches expected scenario step
} else {
  process.stderr.write("Unexpected script. expected=" + expected.script + " actual=" + scriptName + "\\n");
  process.exit(93);
}

state.calls.push({ script: scriptName });
state.index += 1;
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

if (expected.stdout) process.stdout.write(expected.stdout);
if (expected.stderr) process.stderr.write(expected.stderr);
process.exit(expected.exitCode ?? 0);
`,
    "utf8",
  );

  writeFileSync(
    packageJsonPath,
    JSON.stringify(
      {
        name: "intake-recover-scenario-harness",
        private: true,
        version: "0.0.0",
        scripts: {
          "taskpad:queue-health": "node fake-runner.js taskpad:queue-health",
          "taskpad:auto-ideation": "node fake-runner.js taskpad:auto-ideation",
          "taskpad:apply-fallback": "node fake-runner.js taskpad:apply-fallback",
          "plan:integrity": "node fake-runner.js plan:integrity",
          "verify:taskpad:intake:full": "node fake-runner.js verify:taskpad:intake:full",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  return { dir, taskpadPath, planPath };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("taskpad:intake:recover focused flows", () => {
  test("no-op ready path: queue already healthy skips recovery branch and returns ready", () => {
    const harness = createScenarioHarness("taskpad-intake-recover-noop-ready.scenario.json");

    const originalCwd = process.cwd();
    process.chdir(harness.dir);

    try {
      const result = runIntakeRecoverComposition(harness.taskpadPath, harness.planPath);

      expect(result.verdict).toBe("ready");
      expect(result.reasonCode).toBe("RECOVER_READY");
      expect(result.routingMode).toBe("noop");
      expect(result.routingChoiceReason).toBe("Initial queue health passed; skipping recovery branch");
      expect(result.steps.find((step) => step.id === "auto-ideation")?.status).toBe("skipped");
      expect(result.steps.find((step) => step.id === "apply-fallback")?.reasonCode).toBe("SKIP_AUTO_IDEATION_NOT_RUN");
      expect(result.steps.find((step) => step.id === "queue-health-recheck")?.reasonCode).toBe("SKIP_AUTO_IDEATION_NOT_RUN");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("direct-write path: empty queue runs auto-ideation and reaches ready without fallback apply", () => {
    const harness = createScenarioHarness("taskpad-intake-recover-direct-write-ready.scenario.json");

    const originalCwd = process.cwd();
    process.chdir(harness.dir);

    try {
      const result = runIntakeRecoverComposition(harness.taskpadPath, harness.planPath);

      expect(result.verdict).toBe("ready");
      expect(result.reasonCode).toBe("RECOVER_READY");
      expect(result.routingMode).toBe("recovery");
      expect(result.routingChoiceReason).toBe(
        "Initial queue health reported empty; entering recovery branch with --target-queue work",
      );
      expect(result.steps.find((step) => step.id === "auto-ideation")?.status).toBe("pass");
      expect(result.steps.find((step) => step.id === "apply-fallback")?.status).toBe("skipped");
      expect(result.steps.find((step) => step.id === "apply-fallback")?.reasonCode).toBe("SKIP_NO_FALLBACK_ARTIFACT");
      expect(result.steps.find((step) => step.id === "queue-health-recheck")?.status).toBe("pass");
      expect(result.artifacts.autoIdeationArtifactPath).toBeNull();
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("fallback-apply path: empty queue fallback artifact is applied and returns ready", () => {
    const harness = createScenarioHarness("taskpad-intake-recover-fallback-apply-ready.scenario.json");

    const originalCwd = process.cwd();
    process.chdir(harness.dir);

    try {
      const result = runIntakeRecoverComposition(harness.taskpadPath, harness.planPath);

      expect(result.verdict).toBe("ready");
      expect(result.reasonCode).toBe("RECOVER_READY");
      expect(result.routingMode).toBe("recovery");
      expect(result.routingChoiceReason).toBe(
        "Initial queue health reported empty; entering recovery branch with --target-queue work",
      );
      expect(result.steps.find((step) => step.id === "auto-ideation")?.status).toBe("pass");
      expect(result.steps.find((step) => step.id === "apply-fallback")?.status).toBe("pass");
      expect(result.steps.find((step) => step.id === "queue-health-recheck")?.status).toBe("pass");
      expect(result.artifacts.autoIdeationArtifactPath).toBe("/tmp/taskpad.auto-ideation.patch.json");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("deterministic hold flow: queue still empty after recovery returns hold verdict", () => {
    const harness = createScenarioHarness("taskpad-intake-recover-hold-queue-empty.scenario.json");

    const originalCwd = process.cwd();
    process.chdir(harness.dir);

    try {
      const result = runIntakeRecoverComposition(harness.taskpadPath, harness.planPath);

      expect(result.status).toBe("fail");
      expect(result.verdict).toBe("hold");
      expect(result.reasonCode).toBe("RECOVER_HOLD_QUEUE_EMPTY");
      expect(result.steps.find((step) => step.id === "queue-health-recheck")?.reasonCode).toBe(
        "QUEUE_STILL_EMPTY_AFTER_RECOVERY",
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("deterministic fail flow: invalid auto-ideation contract yields blocked + skipped terminal gates", () => {
    const harness = createScenarioHarness("taskpad-intake-recover-blocked-contract.scenario.json");

    const originalCwd = process.cwd();
    process.chdir(harness.dir);

    try {
      const result = runIntakeRecoverComposition(harness.taskpadPath, harness.planPath);

      expect(result.status).toBe("fail");
      expect(result.verdict).toBe("blocked");
      expect(result.reasonCode).toBe("RECOVER_BLOCKED_CONTRACT");
      expect(result.steps.find((step) => step.id === "auto-ideation")?.reasonCode).toBe(
        "AUTO_IDEATION_JSON_MISSING_OR_INVALID",
      );
      expect(result.steps.find((step) => step.id === "plan-integrity")?.status).toBe("skipped");
      expect(result.steps.find((step) => step.id === "verify-intake-full")?.status).toBe("skipped");
      expect(result.steps.find((step) => step.id === "plan-integrity")?.reasonCode).toBe("SKIP_PRIOR_HARD_BLOCK");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("CLI exit semantics are deterministic: ready exits 0, hold/blocked exit 1", () => {
    const scenarios = [
      {
        file: "taskpad-intake-recover-noop-ready.scenario.json",
        expectedExit: 0,
        expectedVerdict: "ready",
      },
      {
        file: "taskpad-intake-recover-hold-queue-empty.scenario.json",
        expectedExit: 1,
        expectedVerdict: "hold",
      },
      {
        file: "taskpad-intake-recover-blocked-contract.scenario.json",
        expectedExit: 1,
        expectedVerdict: "blocked",
      },
    ] as const;

    for (const scenarioCase of scenarios) {
      const harness = createScenarioHarness(scenarioCase.file);

      const run = Bun.spawnSync(
        [process.execPath, "run", TOOL_PATH, "--taskpad", harness.taskpadPath, "--plan", harness.planPath],
        {
          cwd: harness.dir,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      const stdout = new TextDecoder().decode(run.stdout);
      const stderr = new TextDecoder().decode(run.stderr);
      const parsed = parseIntakeRecoverJson(stdout);

      expect(stderr).toBe("");
      expect(run.exitCode).toBe(scenarioCase.expectedExit);
      expect(parsed.verdict).toBe(scenarioCase.expectedVerdict);
    }
  });

  test("routing mode choice is machine-observable and deterministic in JSON output", () => {
    const scenarios = [
      {
        file: "taskpad-intake-recover-noop-ready.scenario.json",
        expectedRoutingMode: "noop" as const,
        expectedRoutingReason: "Initial queue health passed; skipping recovery branch",
      },
      {
        file: "taskpad-intake-recover-direct-write-ready.scenario.json",
        expectedRoutingMode: "recovery" as const,
        expectedRoutingReason: "Initial queue health reported empty; entering recovery branch with --target-queue work",
      },
      {
        file: "taskpad-intake-recover-fallback-apply-ready.scenario.json",
        expectedRoutingMode: "recovery" as const,
        expectedRoutingReason: "Initial queue health reported empty; entering recovery branch with --target-queue work",
      },
    ] as const;

    for (const scenarioCase of scenarios) {
      const harness = createScenarioHarness(scenarioCase.file);

      const run = Bun.spawnSync(
        [process.execPath, "run", TOOL_PATH, "--taskpad", harness.taskpadPath, "--plan", harness.planPath],
        {
          cwd: harness.dir,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      const stdout = new TextDecoder().decode(run.stdout);
      const parsed = parseIntakeRecoverJson(stdout);

      // Verify routing mode is present and deterministic
      expect(parsed.routingMode).toBeDefined();
      expect(typeof parsed.routingMode).toBe("string");
      expect(parsed.routingMode).toBe(scenarioCase.expectedRoutingMode);

      // Verify routing reason is present and deterministic
      expect(parsed.routingChoiceReason).toBeDefined();
      expect(typeof parsed.routingChoiceReason).toBe("string");
      expect(parsed.routingChoiceReason).toBe(scenarioCase.expectedRoutingReason);

      // Verify routingMode is one of the allowed values
      expect(["noop", "recovery"]).toContain(parsed.routingMode);
    }
  });
});

describe("verify:taskpad:intake:auto fixture documentation", () => {
  // Note: verify:taskpad:intake:auto is a package.json shell script that:
  // 1. Checks queue-health
  // 2. If empty: runs auto-ideation --target-queue work, then verify:taskpad:intake:full
  // 3. If not empty: runs verify:taskpad:intake:full directly
  //
  // These tests document the fixture states that exercise these branches.
  // Actual tool execution is tested via the scenario harness in tests above.

  test("empty-queue fixture state is correctly defined", () => {
    const emptyTaskpad = readFixtureFile("taskpad-queue-health-empty.md");

    // Verify empty queue fixture has no unchecked items
    expect(emptyTaskpad).toContain("## Autonomous Kickoff Queue");
    expect(emptyTaskpad).toContain("## Self-Improvement Backlog");
    expect(emptyTaskpad).not.toMatch(/\n- \[ \]/); // No unchecked bullets
    expect(emptyTaskpad).toMatch(/- \[x\]/); // Only checked bullets
  });

  test("non-empty queue fixture state is correctly defined", () => {
    const nonEmptyTaskpad = readFixtureFile("taskpad-queue-health-pass.md");

    // Verify non-empty queue fixture has unchecked items
    expect(nonEmptyTaskpad).toContain("## Autonomous Kickoff Queue");
    expect(nonEmptyTaskpad).toContain("## Self-Improvement Backlog");
    expect(nonEmptyTaskpad).toMatch(/\n- \[ \]/); // Has unchecked bullets
  });

  test("scenario fixtures cover all three branches", () => {
    // These scenario fixtures are used by tests above to verify
    // the three branches of verify:taskpad:intake:auto behavior:

    // 1. Non-empty no-op branch: taskpad-intake-recover-noop-ready.scenario.json
    const noopFixture = readScenarioFixture("taskpad-intake-recover-noop-ready.scenario.json");
    expect(noopFixture.name).toBe("noop-ready");
    expect(noopFixture.steps[0].script).toBe("taskpad:queue-health");
    expect(noopFixture.steps[0].exitCode).toBe(0); // Queue healthy

    // 2. Empty-queue enforced Work Queue seeding (direct-write): taskpad-intake-recover-direct-write-ready.scenario.json
    const directWriteFixture = readScenarioFixture("taskpad-intake-recover-direct-write-ready.scenario.json");
    expect(directWriteFixture.name).toBe("direct-write-ready");
    expect(directWriteFixture.steps[0].script).toBe("taskpad:queue-health");
    expect(directWriteFixture.steps[0].exitCode).toBe(1); // Queue empty
    expect(directWriteFixture.steps[1].script).toBe("taskpad:auto-ideation");
    expect(directWriteFixture.steps[1].exitCode).toBe(0); // Auto-ideation succeeds

    // 3. Fallback-artifact branch parity: taskpad-intake-recover-fallback-apply-ready.scenario.json
    const fallbackFixture = readScenarioFixture("taskpad-intake-recover-fallback-apply-ready.scenario.json");
    expect(fallbackFixture.name).toBe("fallback-apply-ready");
    expect(fallbackFixture.steps[0].script).toBe("taskpad:queue-health");
    expect(fallbackFixture.steps[0].exitCode).toBe(1); // Queue empty
    expect(fallbackFixture.steps[1].script).toBe("taskpad:auto-ideation");
    expect(fallbackFixture.steps[1].stdout).toContain("fallback"); // Auto-ideation returns fallback
    expect(fallbackFixture.steps[2].script).toBe("taskpad:apply-fallback");
  });

  test("fallback artifact fixtures contain deterministic parity metadata", () => {
    // Verify fallback-artifact fixtures have required metadata structure
    const fixtures = [
      "fallback-artifact-parity/pass-applied.artifact.json",
      "fallback-artifact-parity/pass-noop.artifact.json",
      "fallback-artifact-parity/fail-pending.artifact.json",
    ];

    for (const fixturePath of fixtures) {
      const fixtureContent = readFixtureFile(fixturePath);
      const artifact = JSON.parse(fixtureContent);

      // Verify required fields
      expect(artifact).toHaveProperty("version");
      expect(artifact).toHaveProperty("kind");
      expect(artifact).toHaveProperty("taskpadPath");
      expect(artifact).toHaveProperty("patch");
      expect(artifact).toHaveProperty("taskpadSha256");

      // Verify deterministic structure
      expect(typeof artifact.version).toBe("number");
      expect(typeof artifact.kind).toBe("string");
      expect(typeof artifact.taskpadSha256).toBe("string");
      expect(artifact.taskpadSha256.length).toBeGreaterThan(0);
    }
  });
});

  describe("non-empty no-op branch", () => {
    test("non-empty queue causes auto-ideation to be a no-op (does not modify TASKPAD)", () => {
      const dir = makeTempDir("verify-intake-auto-");
      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(PROJECT_ROOT, "IMPLEMENTATION_PLAN.md");

      // Non-empty queue fixture - has unchecked items
      const nonEmptyTaskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [ ] planned-2026-02-27 active work item

## Self-Improvement Backlog
- [x] completed improvement
`;

      writeFileSync(taskpadPath, nonEmptyTaskpad, "utf8");

      const originalCwd = process.cwd();
      process.chdir(dir);

      try {
        // When queue is not empty, verify:taskpad:intake:auto would skip auto-ideation
        // Test this by running queue-health first to verify it passes
        const queueHealthRun = Bun.spawnSync(
          [process.execPath, "run", "tools/taskpad-queue-health.ts", "--taskpad", taskpadPath],
          {
            cwd: PROJECT_ROOT,
            stdout: "pipe",
            stderr: "pipe",
          },
        );

        expect(queueHealthRun.exitCode).toBe(0);

        const queueHealthOutput = new TextDecoder().decode(queueHealthRun.stdout);
        expect(queueHealthOutput).toContain("PASS");
        expect(queueHealthOutput).toContain("totalUnchecked: 1");

        // Run auto-ideation anyway to verify it's a no-op on non-empty queue
        const autoIdeationRun = Bun.spawnSync(
          [process.execPath, "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath, "--target-queue", "work"],
          {
            cwd: PROJECT_ROOT,
            stdout: "pipe",
            stderr: "pipe",
          },
        );

        const autoOutput = new TextDecoder().decode(autoIdeationRun.stdout);
        expect(autoIdeationRun.exitCode).toBe(0);

        // Verify auto-ideation was a no-op
        const jsonStart = autoOutput.indexOf("AUTO_IDEATION_JSON_START");
        const jsonEnd = autoOutput.indexOf("AUTO_IDEATION_JSON_END");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          const jsonText = autoOutput.slice(jsonStart + 22, jsonEnd).trim();
          const result = JSON.parse(jsonText);
          expect(result.status).toBe("noop");
          expect(result.triggered).toBe(false);
        }

        // Verify TASKPAD was NOT modified (no new items added)
        const updatedTaskpad = readFileSync(taskpadPath, "utf8");
        expect(updatedTaskpad).toBe(nonEmptyTaskpad);
      } finally {
        process.chdir(originalCwd);
      }
    });

    test("non-empty queue with multiple unchecked items causes auto-ideation to be a no-op", () => {
      const dir = makeTempDir("verify-intake-auto-");
      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(PROJECT_ROOT, "IMPLEMENTATION_PLAN.md");

      const multiItemTaskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [ ] planned-2026-02-27 first item
- [ ] planned-2026-02-28 second item

## Self-Improvement Backlog
- [ ] planned-2026-02-26 improvement item
`;

      writeFileSync(taskpadPath, multiItemTaskpad, "utf8");

      const originalCwd = process.cwd();
      process.chdir(dir);

      try {
        const queueHealthRun = Bun.spawnSync(
          [process.execPath, "run", "tools/taskpad-queue-health.ts", "--taskpad", taskpadPath],
          {
            cwd: PROJECT_ROOT,
            stdout: "pipe",
            stderr: "pipe",
          },
        );

        expect(queueHealthRun.exitCode).toBe(0);

        const autoIdeationRun = Bun.spawnSync(
          [process.execPath, "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath, "--target-queue", "work"],
          {
            cwd: PROJECT_ROOT,
            stdout: "pipe",
            stderr: "pipe",
          },
        );

        const autoOutput = new TextDecoder().decode(autoIdeationRun.stdout);
        expect(autoIdeationRun.exitCode).toBe(0);

        const jsonStart = autoOutput.indexOf("AUTO_IDEATION_JSON_START");
        const jsonEnd = autoOutput.indexOf("AUTO_IDEATION_JSON_END");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          const jsonText = autoOutput.slice(jsonStart + 22, jsonEnd).trim();
          const result = JSON.parse(jsonText);
          expect(result.status).toBe("noop");
        }

        const updatedTaskpad = readFileSync(taskpadPath, "utf8");
        expect(updatedTaskpad).toBe(multiItemTaskpad);
      } finally {
        process.chdir(originalCwd);
      }
    });

    test("queue health correctly counts unchecked items in non-empty queue", () => {
      const dir = makeTempDir("verify-intake-auto-");
      const taskpadPath = join(dir, "TASKPAD.md");

      const passingTaskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [ ] planned-2026-02-27 work item

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, passingTaskpad, "utf8");

      const originalCwd = process.cwd();
      process.chdir(dir);

      try {
        const run = Bun.spawnSync(
          [process.execPath, "run", "tools/taskpad-queue-health.ts", "--taskpad", taskpadPath],
          {
            cwd: PROJECT_ROOT,
            stdout: "pipe",
            stderr: "pipe",
          },
        );

        const stdout = new TextDecoder().decode(run.stdout);
        const stderr = new TextDecoder().decode(run.stderr);

        expect(run.exitCode).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toContain("PASS");
        expect(stdout).toContain("totalUnchecked: 1");
        expect(stdout).toContain("autonomousUncheckedCount: 1");
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("fallback-artifact branch parity", () => {
    test("read-only TASKPAD path triggers fallback artifact generation in auto-ideation", () => {
      const dir = makeTempDir("verify-intake-auto-");
      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(PROJECT_ROOT, "IMPLEMENTATION_PLAN.md");

      const emptyTaskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, emptyTaskpad, "utf8");

      // Make TASKPAD read-only to trigger fallback artifact
      chmodSync(taskpadPath, 0o444);

      const originalCwd = process.cwd();
      process.chdir(dir);

      try {
        const run = Bun.spawnSync(
          [process.execPath, "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath, "--target-queue", "work"],
          {
            cwd: PROJECT_ROOT,
            stdout: "pipe",
            stderr: "pipe",
          },
        );

        const stdout = new TextDecoder().decode(run.stdout);
        const stderr = new TextDecoder().decode(run.stderr);

        // Should succeed even with read-only file (fallback path)
        expect(run.exitCode).toBe(0);
        expect(stderr).toBe("");

        // Verify fallback status is reported
        const jsonStart = stdout.indexOf("AUTO_IDEATION_JSON_START");
        const jsonEnd = stdout.indexOf("AUTO_IDEATION_JSON_END");
        expect(jsonStart).toBeGreaterThan(-1);
        expect(jsonEnd).toBeGreaterThan(jsonStart);

        const jsonText = stdout.slice(jsonStart + 22, jsonEnd).trim();
        const result = JSON.parse(jsonText);

        expect(result.status).toBe("fallback");
        expect(result.artifactPath).not.toBeNull();
        expect(result.artifactPath).not.toBe("");

        // Verify TASKPAD was NOT modified (read-only)
        const taskpadContent = readFileSync(taskpadPath, "utf8");
        expect(taskpadContent).toBe(emptyTaskpad);
      } finally {
        // Restore permissions before cleanup
        chmodSync(taskpadPath, 0o644);
        process.chdir(originalCwd);
      }
    });

    test("fallback artifact contains deterministic metadata for parity checks", () => {
      const dir = makeTempDir("verify-intake-auto-");
      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(PROJECT_ROOT, "IMPLEMENTATION_PLAN.md");

      const emptyTaskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, emptyTaskpad, "utf8");

      chmodSync(taskpadPath, 0o444);

      const originalCwd = process.cwd();
      process.chdir(dir);

      try {
        const run = Bun.spawnSync(
          [process.execPath, "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath, "--target-queue", "work"],
          {
            cwd: PROJECT_ROOT,
            stdout: "pipe",
            stderr: "pipe",
          },
          { timeout: 30000 },
        );

        const stdout = new TextDecoder().decode(run.stdout);

        expect(run.exitCode).toBe(0);

        // Extract artifact path from JSON output
        const jsonStart = stdout.indexOf("AUTO_IDEATION_JSON_START");
        const jsonEnd = stdout.indexOf("AUTO_IDEATION_JSON_END");
        expect(jsonStart).toBeGreaterThan(-1);
        expect(jsonEnd).toBeGreaterThan(jsonStart);

        const jsonText = stdout.slice(jsonStart + 22, jsonEnd).trim();
        const result = JSON.parse(jsonText);

        expect(result.artifactPath).toBeTruthy();
        expect(typeof result.artifactPath).toBe("string");

        // Verify artifact file exists and has valid structure
        const artifactPath = result.artifactPath!;
        const artifactContent = readFileSync(artifactPath, "utf8");
        const artifact = JSON.parse(artifactContent);

        // Verify artifact structure
        expect(artifact).toHaveProperty("version");
        expect(artifact).toHaveProperty("kind");
        expect(artifact).toHaveProperty("taskpadPath");
        expect(artifact).toHaveProperty("selectedCandidateId");
        expect(artifact).toHaveProperty("patch");
        expect(artifact).toHaveProperty("taskpadSha256");

        // Verify required metadata fields
        expect(artifact.version).toBe(1);
        expect(artifact.kind).toBe("taskpad-auto-ideation-fallback-patch");
        expect(typeof artifact.taskpadSha256).toBe("string");
        expect(artifact.taskpadSha256.length).toBeGreaterThan(0);
        expect(artifact.patch).toHaveProperty("format");
        expect(artifact.patch).toHaveProperty("content");
      } finally {
        chmodSync(taskpadPath, 0o644);
        process.chdir(originalCwd);
      }
    });

    test("fallback artifact output is deterministic across multiple runs", () => {
      const dir = makeTempDir("verify-intake-auto-");
      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(PROJECT_ROOT, "IMPLEMENTATION_PLAN.md");

      const emptyTaskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, emptyTaskpad, "utf8");

      chmodSync(taskpadPath, 0o444);

      const originalCwd = process.cwd();
      process.chdir(dir);

      try {
        // First run
        const run1 = Bun.spawnSync(
          [process.execPath, "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath, "--target-queue", "work"],
          {
            cwd: PROJECT_ROOT,
            stdout: "pipe",
            stderr: "pipe",
          },
          { timeout: 30000 },
        );

        const stdout1 = new TextDecoder().decode(run1.stdout);
        expect(run1.exitCode).toBe(0);

        // Second run
        const run2 = Bun.spawnSync(
          [process.execPath, "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath, "--target-queue", "work"],
          {
            cwd: PROJECT_ROOT,
            stdout: "pipe",
            stderr: "pipe",
          },
          { timeout: 30000 },
        );

        const stdout2 = new TextDecoder().decode(run2.stdout);
        expect(run2.exitCode).toBe(0);

        // Both runs should produce consistent fallback behavior
        expect(stdout1).toContain("fallback");
        expect(stdout2).toContain("fallback");

        // Extract results from both runs
        const jsonStart1 = stdout1.indexOf("AUTO_IDEATION_JSON_START");
        const jsonEnd1 = stdout1.indexOf("AUTO_IDEATION_JSON_END");
        const result1 = JSON.parse(stdout1.slice(jsonStart1 + 22, jsonEnd1).trim());

        const jsonStart2 = stdout2.indexOf("AUTO_IDEATION_JSON_START");
        const jsonEnd2 = stdout2.indexOf("AUTO_IDEATION_JSON_END");
        const result2 = JSON.parse(stdout2.slice(jsonStart2 + 22, jsonEnd2).trim());

        // Both should have fallback status and same candidate selection
        expect(result1.status).toBe("fallback");
        expect(result2.status).toBe("fallback");
        expect(result1.selectedCandidateId).toBe(result2.selectedCandidateId);

        // Verify artifact structure consistency
        expect(result1.artifactPath).not.toBeNull();
        expect(result2.artifactPath).not.toBeNull();
      } finally {
        chmodSync(taskpadPath, 0o644);
        process.chdir(originalCwd);
      }
    });
  });

  describe("enforced routing determinism", () => {
    test("empty queue auto-ideation with --target-queue work produces deterministic routing metadata", () => {
      const dir = makeTempDir("verify-intake-auto-");
      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(PROJECT_ROOT, "IMPLEMENTATION_PLAN.md");

      const emptyTaskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      writeFileSync(taskpadPath, emptyTaskpad, "utf8");

      const originalCwd = process.cwd();
      process.chdir(dir);

      try {
        const run = Bun.spawnSync(
          [process.execPath, "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath, "--target-queue", "work"],
          {
            cwd: PROJECT_ROOT,
            stdout: "pipe",
            stderr: "pipe",
          },
        );

        const stdout = new TextDecoder().decode(run.stdout);
        expect(run.exitCode).toBe(0);

        // Verify deterministic routing metadata
        const jsonStart = stdout.indexOf("AUTO_IDEATION_JSON_START");
        const jsonEnd = stdout.indexOf("AUTO_IDEATION_JSON_END");
        const result = JSON.parse(stdout.slice(jsonStart + 22, jsonEnd).trim());

        expect(result.targetQueueRouting).not.toBeNull();
        expect(result.targetQueueRouting.targetQueue).toBe("work");
        expect(result.targetQueueRouting.ruleId).toBe("TQR004_WORK_QUEUE_PATH");
        expect(result.targetQueueRouting.insertionSection).toBe("## Work Queue");

        // Verify queue parity status reflects Work Queue targeting
        expect(result.queueParityStatus).not.toBeNull();
        expect(result.queueParityStatus.hasExecutableItems).toBe(true);
        expect(result.queueParityStatus.parityStatus).toBe("parity-pass");
      } finally {
        process.chdir(originalCwd);
      }
    });

    test("multiple empty-queue runs produce consistent routing metadata", () => {
      const dir = makeTempDir("verify-intake-auto-");
      const taskpadPath = join(dir, "TASKPAD.md");
      const planPath = join(PROJECT_ROOT, "IMPLEMENTATION_PLAN.md");

      const emptyTaskpad = `# TASKPAD

## Autonomous Kickoff Queue
- [x] done

## Self-Improvement Backlog
- [x] done
`;

      const originalCwd = process.cwd();
      process.chdir(dir);

      try {
        const results: unknown[] = [];

        // Run multiple times to verify determinism
        for (let i = 0; i < 3; i++) {
          writeFileSync(taskpadPath, emptyTaskpad, "utf8");

          const run = Bun.spawnSync(
            [process.execPath, "run", "tools/taskpad-auto-ideation.ts", "--taskpad", taskpadPath, "--plan", planPath, "--target-queue", "work"],
            {
              cwd: PROJECT_ROOT,
              stdout: "pipe",
              stderr: "pipe",
            },
          );

          const stdout = new TextDecoder().decode(run.stdout);
          expect(run.exitCode).toBe(0);

          const jsonStart = stdout.indexOf("AUTO_IDEATION_JSON_START");
          const jsonEnd = stdout.indexOf("AUTO_IDEATION_JSON_END");
          const result = JSON.parse(stdout.slice(jsonStart + 22, jsonEnd).trim());
          results.push(result);
        }

        // All runs should have consistent routing behavior
        for (const result of results as Array<any>) {
          expect(result.targetQueueRouting.targetQueue).toBe("work");
          expect(result.targetQueueRouting.ruleId).toBe("TQR004_WORK_QUEUE_PATH");
          expect(result.status).toBe("seeded");
        }

        // Candidate selection should be deterministic
        const candidateIds = (results as Array<any>).map((r) => r.selectedCandidateId);
        expect(new Set(candidateIds).size).toBe(1);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
