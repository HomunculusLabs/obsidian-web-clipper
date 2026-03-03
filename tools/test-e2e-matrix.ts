#!/usr/bin/env bun
/**
 * Headless scenario matrix runner for deterministic E2E validation gate.
 *
 * This tool loads a scenario manifest, validates required coverage, and executes
 * scenario assertions with deterministic machine-readable output.
 */

import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

// CLI argument parsing
const args = process.argv.slice(2);
const manifestPathArg = args.find((a) => a === "--manifest") || args.find((a) => a.startsWith("--manifest="));
const formatArg = args.find((a) => a === "--format") || args.find((a) => a.startsWith("--format="));
const scenarioArg = args.find((a) => a === "--scenario") || args.find((a) => a.startsWith("--scenario="));

let manifestPath = "tests/e2e/fixtures/clip-scenario-manifest.json";
if (manifestPathArg) {
  const parts = manifestPathArg.split("=");
  manifestPath = parts.length > 1 ? parts[1] : args[args.indexOf(manifestPathArg) + 1];
}

let format = "human";
if (formatArg) {
  const parts = formatArg.split("=");
  format = parts.length > 1 ? parts[1] : args[args.indexOf(formatArg) + 1];
}

let scenarioFilter: string | undefined;
if (scenarioArg) {
  const parts = scenarioArg.split("=");
  scenarioFilter = parts.length > 1 ? parts[1] : args[args.indexOf(scenarioArg) + 1];
}

if (!["json", "human"].includes(format)) {
  console.error("Error: --format must be 'json' or 'human'");
  process.exit(1);
}

// Resolve the manifest path and set working directory to repo root
const resolvedManifestPath = realpathSync(manifestPath);
// The repo root is the parent of the 'tests' directory (manifest is in tests/e2e/fixtures/)
// If the manifest path doesn't contain '/tests/', assume current directory is repo root
const repoRoot = resolvedManifestPath.includes("/tests/")
  ? resolvedManifestPath.split("/tests/")[0]
  : process.cwd();

// Change to repo root so fixture paths resolve correctly
process.chdir(repoRoot);

// Type definitions
interface ClipScenarioManifest {
  manifestVersion: string;
  description: string;
  scenarios: Scenario[];
}

interface Scenario {
  id: string;
  name: string;
  required: boolean;
  entryPoint: "url" | "stdin" | "cli-save" | "template";
  executor: {
    tool?: string;
    testFile?: string;
    testCase?: string;
  };
  fixture: {
    path: string;
    simulatedUrl?: string;
    pageType?: "web" | "youtube" | "pdf" | "article" | "video" | "document";
  };
  expectations: {
    frontmatterKeys: string[];
    requiredTags?: string[];
    contentSignals?: string[];
    contentSignalsExcluded?: string[];
    customAssertions?: Record<string, unknown>;
  };
}

interface MatrixResult {
  status: "OK" | "ERROR" | "FAIL";
  manifestPath: string;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  missingRequired: string[];
  scenarios: ScenarioResult[];
  errors: MatrixError[];
}

interface ScenarioResult {
  id: string;
  passed: boolean;
  required: boolean;
  durationMs: number;
  failures: AssertionFailure[];
}

interface AssertionFailure {
  code: string;
  message: string;
  context?: Record<string, unknown>;
  expected?: unknown;
  actual?: unknown;
}

interface MatrixError {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

// Required scenario IDs (from contract)
const REQUIRED_SCENARIO_IDS = new Set([
  "generic-web-clip",
  "seedfinder-strain-profile",
  "cli-save-contract",
]);

// Error codes
const ERROR_CODES = {
  MANIFEST_PARSE_ERROR: "MATRIX_MANIFEST_PARSE_ERROR",
  MANIFEST_SCHEMA_INVALID: "MATRIX_MANIFEST_SCHEMA_INVALID",
  REQUIRED_SCENARIO_MISSING: "MATRIX_REQUIRED_SCENARIO_MISSING",
  SCENARIO_EXECUTION_ERROR: "MATRIX_SCENARIO_EXECUTION_ERROR",
} as const;

// Failure codes
const FAILURE_CODES = {
  FRONTMATTER_KEY_MISSING: "MATRIX_FRONTMATTER_KEY_MISSING",
  TAG_MISSING: "MATRIX_TAG_MISSING",
  CONTENT_SIGNAL_MISSING: "MATRIX_CONTENT_SIGNAL_MISSING",
  CONTENT_SIGNAL_FOUND: "MATRIX_CONTENT_SIGNAL_FOUND",
  CUSTOM_ASSERTION_FAILED: "MATRIX_CUSTOM_ASSERTION_FAILED",
  EXTRACTION_ERROR: "MATRIX_EXTRACTION_ERROR",
  SAVE_ERROR: "MATRIX_SAVE_ERROR",
} as const;

/**
 * Load and parse the manifest file.
 */
function loadManifest(manifestPath: string): { manifest: ClipScenarioManifest | null; errors: MatrixError[] } {
  const errors: MatrixError[] = [];

  try {
    const resolvedPath = realpathSync(manifestPath);
    const content = readFileSync(resolvedPath, "utf-8");
    const manifest = JSON.parse(content) as ClipScenarioManifest;

    // Basic schema validation
    if (!manifest.manifestVersion || typeof manifest.manifestVersion !== "string") {
      errors.push({
        code: ERROR_CODES.MANIFEST_SCHEMA_INVALID,
        message: "Missing or invalid 'manifestVersion' field",
      });
      return { manifest: null, errors };
    }

    if (!Array.isArray(manifest.scenarios)) {
      errors.push({
        code: ERROR_CODES.MANIFEST_SCHEMA_INVALID,
        message: "Missing or invalid 'scenarios' array",
      });
      return { manifest: null, errors };
    }

    return { manifest, errors };
  } catch (error) {
    errors.push({
      code: ERROR_CODES.MANIFEST_PARSE_ERROR,
      message: error instanceof Error ? error.message : "Unknown error parsing manifest",
      context: { path: manifestPath },
    });
    return { manifest: null, errors };
  }
}

/**
 * Validate that all required scenarios are present in the manifest.
 */
function checkRequiredScenarios(manifest: ClipScenarioManifest): string[] {
  const manifestIds = new Set(manifest.scenarios.map((s) => s.id));
  const missing: string[] = [];

  for (const requiredId of REQUIRED_SCENARIO_IDS) {
    if (!manifestIds.has(requiredId)) {
      missing.push(requiredId);
    }
  }

  return missing.sort();
}

/**
 * Execute a single scenario and return its result.
 */
async function executeScenario(
  scenario: Scenario,
  manifestPath: string,
): Promise<ScenarioResult> {
  const startTime = performance.now();
  const failures: AssertionFailure[] = [];

  try {
    // Import the scenario validator module
    const { validateScenario } = await import("./lib/matrix-scenario-validator");

    const result = await validateScenario(scenario, manifestPath);

    const endTime = performance.now();

    return {
      id: scenario.id,
      passed: result.passed,
      required: scenario.required,
      durationMs: Math.round(endTime - startTime),
      failures: result.failures,
    };
  } catch (error) {
    const endTime = performance.now();

    failures.push({
      code: ERROR_CODES.SCENARIO_EXECUTION_ERROR,
      message: error instanceof Error ? error.message : "Unknown error during scenario execution",
      context: { scenarioId: scenario.id },
    });

    return {
      id: scenario.id,
      passed: false,
      required: scenario.required,
      durationMs: Math.round(endTime - startTime),
      failures,
    };
  }
}

/**
 * Format result as JSON.
 */
function formatJson(result: MatrixResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format result as human-readable text.
 */
function formatHuman(result: MatrixResult): string {
  const lines: string[] = [];

  lines.push("Headless Scenario Matrix");
  lines.push("─────────────────────────");
  lines.push(`Manifest: ${result.manifestPath}`);
  lines.push(`Status: ${result.status}`);
  lines.push(`Time: ${(performance.now() / 1000).toFixed(3)}s`);
  lines.push("");

  const summary = [
    `${result.passed}/${result.total} passed`,
    result.failed > 0 ? `${result.failed} failed` : undefined,
    result.missingRequired.length > 0 ? `${result.missingRequired.length} missing required` : undefined,
  ]
    .filter(Boolean)
    .join(", ");

  lines.push(`Summary: ${summary}`);
  lines.push("");

  // Scenario results
  for (const scenario of result.scenarios) {
    const icon = scenario.passed ? "✅" : "❌";
    const required = scenario.required ? "(required)" : "(optional)";
    lines.push(`${icon} ${scenario.id} ${required} - ${scenario.durationMs}ms`);

    if (!scenario.passed && scenario.failures.length > 0) {
      for (const failure of scenario.failures) {
        lines.push(`   ${failure.code}: ${failure.message}`);
        if (failure.expected !== undefined) {
          lines.push(`   Expected: ${JSON.stringify(failure.expected)}`);
        }
        if (failure.actual !== undefined) {
          lines.push(`   Actual: ${JSON.stringify(failure.actual)}`);
        }
      }
    }
  }

  lines.push("");
  lines.push(`Failed assertions: ${result.scenarios.reduce((sum, s) => sum + s.failures.length, 0)}`);
  lines.push(`Errors: ${result.errors.length}`);

  return lines.join("\n");
}

/**
 * Main execution flow.
 */
async function main() {
  const startTime = performance.now();

  // Load manifest
  const { manifest, errors: parseErrors } = loadManifest(manifestPath);

  const errors: MatrixError[] = [...parseErrors];

  // If manifest failed to load, return error result
  if (!manifest) {
    const result: MatrixResult = {
      status: "ERROR",
      manifestPath,
      timestamp: new Date().toISOString(),
      total: 0,
      passed: 0,
      failed: 0,
      missingRequired: [],
      scenarios: [],
      errors,
    };

    const output = format === "json" ? formatJson(result) : formatHuman(result);
    console.log(output);
    process.exit(1);
  }

  // Check for required scenarios
  const missingRequired = checkRequiredScenarios(manifest);

  if (missingRequired.length > 0) {
    errors.push({
      code: ERROR_CODES.REQUIRED_SCENARIO_MISSING,
      message: `Required scenarios missing from manifest: ${missingRequired.join(", ")}`,
      context: { missingRequired },
    });
  }

  // Filter scenarios if --scenario flag provided
  const scenariosToRun = scenarioFilter
    ? manifest.scenarios.filter((s) => s.id === scenarioFilter)
    : manifest.scenarios;

  // Execute scenarios
  const scenarioResults: ScenarioResult[] = [];
  for (const scenario of scenariosToRun) {
    const result = await executeScenario(scenario, manifestPath);
    scenarioResults.push(result);
  }

  // Sort results deterministically: by required status (required first), then by id
  scenarioResults.sort((a, b) => {
    if (a.required !== b.required) {
      return a.required ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });

  // Calculate overall status
  let status: "OK" | "ERROR" | "FAIL" = "OK";
  if (errors.length > 0) {
    status = "ERROR";
  } else if (scenarioResults.some((r) => !r.passed && r.required)) {
    status = "FAIL";
  } else if (scenarioResults.some((r) => !r.passed)) {
    status = "FAIL";
  }

  // Build result
  const result: MatrixResult = {
    status,
    manifestPath,
    timestamp: new Date().toISOString(),
    total: scenarioResults.length,
    passed: scenarioResults.filter((r) => r.passed).length,
    failed: scenarioResults.filter((r) => !r.passed).length,
    missingRequired,
    scenarios: scenarioResults,
    errors,
  };

  // Output result
  const output = format === "json" ? formatJson(result) : formatHuman(result);
  console.log(output);

  // Exit with appropriate code
  process.exit(status === "OK" ? 0 : 1);
}

// Run main
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
