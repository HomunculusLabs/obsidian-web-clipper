import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "bun";

import type {
  ClipScenarioManifest,
  MatrixResult,
  Scenario,
} from "../../tools/test-e2e-matrix";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_ROOT = join(PROJECT_ROOT, "tests", "tools", "fixtures");

// Test helper to run the matrix tool and capture output
async function runMatrixTool(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string; parsed?: MatrixResult }> {
  const proc = spawn({
    cmd: ["bun", "tools/test-e2e-matrix.ts", ...args],
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  let parsed: MatrixResult | undefined;
  // Try parsing stdout first, then stderr if stdout is empty or doesn't contain JSON
  const outputToParse = stdout.trim() || stderr.trim();
  try {
    parsed = JSON.parse(outputToParse) as MatrixResult;
  } catch {
    // Not JSON output - may be human format or error message
  }

  return { exitCode, stdout, stderr, parsed };
}

describe("TP006: Scenario Matrix Tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "matrix-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("manifest validation failures", () => {
    test("should fail with error code for invalid JSON", async () => {
      const manifestPath = join(tempDir, "invalid-json.json");
      writeFileSync(manifestPath, "{ invalid json }");

      const { exitCode, parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(exitCode).toBe(1);
      expect(parsed).toBeDefined();
      expect(parsed?.status).toBe("ERROR");
      expect(parsed?.errors).toHaveLength(1);
      expect(parsed?.errors[0].code).toBe("MATRIX_MANIFEST_PARSE_ERROR");
      expect(parsed?.errors[0].message).toMatch(/JSON Parse error|Unexpected token/);
    });

    test("should fail with error code for missing manifestVersion", async () => {
      const manifest: Partial<ClipScenarioManifest> = {
        description: "Test manifest without version",
        scenarios: [],
      };
      const manifestPath = join(tempDir, "no-version.json");
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const { exitCode, parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(exitCode).toBe(1);
      expect(parsed).toBeDefined();
      expect(parsed?.status).toBe("ERROR");
      expect(parsed?.errors).toHaveLength(1);
      expect(parsed?.errors[0].code).toBe("MATRIX_MANIFEST_SCHEMA_INVALID");
      expect(parsed?.errors[0].message).toContain("manifestVersion");
    });

    test("should fail with error code for missing scenarios array", async () => {
      const manifest: Partial<ClipScenarioManifest> = {
        manifestVersion: "1.0.0",
        description: "Test manifest without scenarios",
      };
      const manifestPath = join(tempDir, "no-scenarios.json");
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const { exitCode, parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(exitCode).toBe(1);
      expect(parsed).toBeDefined();
      expect(parsed?.status).toBe("ERROR");
      expect(parsed?.errors).toHaveLength(1);
      expect(parsed?.errors[0].code).toBe("MATRIX_MANIFEST_SCHEMA_INVALID");
      expect(parsed?.errors[0].message).toContain("scenarios");
    });

    test("should fail with error code for non-array scenarios", async () => {
      const manifest = {
        manifestVersion: "1.0.0",
        description: "Test manifest with invalid scenarios",
        scenarios: "not an array",
      };
      const manifestPath = join(tempDir, "invalid-scenarios.json");
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const { exitCode, parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(exitCode).toBe(1);
      expect(parsed).toBeDefined();
      expect(parsed?.status).toBe("ERROR");
      expect(parsed?.errors).toHaveLength(1);
      expect(parsed?.errors[0].code).toBe("MATRIX_MANIFEST_SCHEMA_INVALID");
      expect(parsed?.errors[0].message).toContain("scenarios");
    });

    test("should handle missing manifest file gracefully", async () => {
      const manifestPath = join(tempDir, "nonexistent.json");

      const { exitCode, stdout, stderr, parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(exitCode).toBe(1);
      // The tool may crash or output to stderr, so just verify it fails
      expect(stdout.length + stderr.length).toBeGreaterThan(0);
    });
  });

  describe("missing-required-scenario diagnostics", () => {
    test("should detect missing required scenario: generic-web-clip", async () => {
      const manifest: ClipScenarioManifest = {
        manifestVersion: "1.0.0",
        description: "Test manifest missing generic-web-clip",
        scenarios: [
          {
            id: "seedfinder-strain-profile",
            name: "SeedFinder test",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "cli-save-contract",
            name: "CLI save test",
            required: true,
            entryPoint: "cli-save",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
        ],
      };
      const manifestPath = join(tempDir, "missing-generic.json");
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const { exitCode, parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(exitCode).toBe(1);
      expect(parsed).toBeDefined();
      expect(parsed?.status).toBe("ERROR");
      expect(parsed?.missingRequired).toContain("generic-web-clip");
      expect(parsed?.errors.some((e) => e.code === "MATRIX_REQUIRED_SCENARIO_MISSING")).toBe(true);
      expect(parsed?.errors[0].message).toContain("generic-web-clip");
    });

    test("should detect missing required scenario: seedfinder-strain-profile", async () => {
      const manifest: ClipScenarioManifest = {
        manifestVersion: "1.0.0",
        description: "Test manifest missing seedfinder",
        scenarios: [
          {
            id: "generic-web-clip",
            name: "Generic web test",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "cli-save-contract",
            name: "CLI save test",
            required: true,
            entryPoint: "cli-save",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
        ],
      };
      const manifestPath = join(tempDir, "missing-seedfinder.json");
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const { exitCode, parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(exitCode).toBe(1);
      expect(parsed).toBeDefined();
      expect(parsed?.status).toBe("ERROR");
      expect(parsed?.missingRequired).toContain("seedfinder-strain-profile");
      expect(parsed?.errors.some((e) => e.code === "MATRIX_REQUIRED_SCENARIO_MISSING")).toBe(true);
    });

    test("should detect missing required scenario: cli-save-contract", async () => {
      const manifest: ClipScenarioManifest = {
        manifestVersion: "1.0.0",
        description: "Test manifest missing cli-save",
        scenarios: [
          {
            id: "generic-web-clip",
            name: "Generic web test",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "seedfinder-strain-profile",
            name: "SeedFinder test",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
        ],
      };
      const manifestPath = join(tempDir, "missing-cli-save.json");
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const { exitCode, parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(exitCode).toBe(1);
      expect(parsed).toBeDefined();
      expect(parsed?.status).toBe("ERROR");
      expect(parsed?.missingRequired).toContain("cli-save-contract");
      expect(parsed?.errors.some((e) => e.code === "MATRIX_REQUIRED_SCENARIO_MISSING")).toBe(true);
    });

    test("should detect all three missing required scenarios", async () => {
      const manifest: ClipScenarioManifest = {
        manifestVersion: "1.0.0",
        description: "Test manifest missing all required",
        scenarios: [
          {
            id: "optional-scenario",
            name: "Optional test",
            required: false,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
        ],
      };
      const manifestPath = join(tempDir, "missing-all-required.json");
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const { exitCode, parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(exitCode).toBe(1);
      expect(parsed).toBeDefined();
      expect(parsed?.status).toBe("ERROR");
      expect(parsed?.missingRequired).toHaveLength(3);
      expect(parsed?.missingRequired).toContain("generic-web-clip");
      expect(parsed?.missingRequired).toContain("seedfinder-strain-profile");
      expect(parsed?.missingRequired).toContain("cli-save-contract");
      expect(parsed?.missingRequired).toEqual(["cli-save-contract", "generic-web-clip", "seedfinder-strain-profile"]);
    });

    test("should report missing required scenarios sorted alphabetically", async () => {
      const manifest: ClipScenarioManifest = {
        manifestVersion: "1.0.0",
        description: "Test manifest missing multiple required",
        scenarios: [],
      };
      const manifestPath = join(tempDir, "missing-sorted.json");
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const { exitCode, parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(exitCode).toBe(1);
      expect(parsed?.missingRequired).toEqual(["cli-save-contract", "generic-web-clip", "seedfinder-strain-profile"]);
    });
  });

  describe("deterministic ordering", () => {
    test("should sort scenarios deterministically by required status then id", async () => {
      const manifest: ClipScenarioManifest = {
        manifestVersion: "1.0.0",
        description: "Test manifest for ordering",
        scenarios: [
          {
            id: "zebra-scenario",
            name: "Zebra test",
            required: false,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "cli-save-contract",
            name: "CLI save test",
            required: true,
            entryPoint: "cli-save",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "alpha-scenario",
            name: "Alpha test",
            required: false,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "generic-web-clip",
            name: "Generic web test",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "seedfinder-strain-profile",
            name: "SeedFinder test",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "middle-scenario",
            name: "Middle test",
            required: false,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
        ],
      };
      const manifestPath = join(tempDir, "ordering-test.json");
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const { exitCode, parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(parsed).toBeDefined();
      expect(parsed?.scenarios).toHaveLength(6);

      // Required scenarios should come first, sorted by id
      expect(parsed?.scenarios[0].id).toBe("cli-save-contract");
      expect(parsed?.scenarios[0].required).toBe(true);

      expect(parsed?.scenarios[1].id).toBe("generic-web-clip");
      expect(parsed?.scenarios[1].required).toBe(true);

      expect(parsed?.scenarios[2].id).toBe("seedfinder-strain-profile");
      expect(parsed?.scenarios[2].required).toBe(true);

      // Optional scenarios come after, sorted by id
      expect(parsed?.scenarios[3].id).toBe("alpha-scenario");
      expect(parsed?.scenarios[3].required).toBe(false);

      expect(parsed?.scenarios[4].id).toBe("middle-scenario");
      expect(parsed?.scenarios[4].required).toBe(false);

      expect(parsed?.scenarios[5].id).toBe("zebra-scenario");
      expect(parsed?.scenarios[5].required).toBe(false);
    });

    test("should produce deterministic JSON output across multiple runs", async () => {
      const manifest: ClipScenarioManifest = {
        manifestVersion: "1.0.0",
        description: "Test manifest for determinism",
        scenarios: [
          {
            id: "cli-save-contract",
            name: "CLI save test",
            required: true,
            entryPoint: "cli-save",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "generic-web-clip",
            name: "Generic web test",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "seedfinder-strain-profile",
            name: "SeedFinder test",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
        ],
      };
      const manifestPath = join(tempDir, "determinism-test.json");
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const { exitCode: exit1, parsed: parsed1 } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);
      const { exitCode: exit2, parsed: parsed2 } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(exit1).toBe(0);
      expect(exit2).toBe(0);

      // Check that deterministic fields match across runs
      expect(parsed1?.status).toBe(parsed2?.status);
      expect(parsed1?.total).toBe(parsed2?.total);
      expect(parsed1?.passed).toBe(parsed2?.passed);
      expect(parsed1?.failed).toBe(parsed2?.failed);
      expect(parsed1?.missingRequired).toEqual(parsed2?.missingRequired);
      expect(parsed1?.scenarios.map((s) => ({ id: s.id, passed: s.passed, required: s.required })))
        .toEqual(parsed2?.scenarios.map((s) => ({ id: s.id, passed: s.passed, required: s.required })));
      expect(parsed1?.scenarios.map((s) => s.id)).toEqual(parsed2?.scenarios.map((s) => s.id));
    });

    test("should maintain stable ordering with mixed required/optional scenarios", async () => {
      const manifest: ClipScenarioManifest = {
        manifestVersion: "1.0.0",
        description: "Test manifest with mixed scenarios",
        scenarios: [
          {
            id: "optional-1",
            name: "Optional 1",
            required: false,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "required-1",
            name: "Required 1",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "required-2",
            name: "Required 2",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "optional-2",
            name: "Optional 2",
            required: false,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
        ],
      };
      const manifestPath = join(tempDir, "mixed-scenarios.json");
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const { parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(parsed?.scenarios[0].id).toBe("required-1");
      expect(parsed?.scenarios[1].id).toBe("required-2");
      expect(parsed?.scenarios[2].id).toBe("optional-1");
      expect(parsed?.scenarios[3].id).toBe("optional-2");
    });
  });

  describe("error codes and diagnostics", () => {
    test("should include machine-readable error codes for all failure modes", async () => {
      // Test manifest parse error
      const invalidPath = join(tempDir, "invalid.json");
      writeFileSync(invalidPath, "{ bad }");

      const { parsed } = await runMatrixTool(["--manifest", invalidPath, "--format", "json"]);

      expect(parsed).toBeDefined();
      expect(parsed?.errors).toBeDefined();
      expect(parsed?.errors.length).toBeGreaterThan(0);

      for (const error of parsed!.errors) {
        expect(error.code).toMatch(/^MATRIX_/);
        expect(error.code).toBeDefined();
        expect(typeof error.code).toBe("string");
      }
    });

    test("should include context information in error diagnostics", async () => {
      const manifestPath = join(tempDir, "missing-scenarios.json");
      writeFileSync(manifestPath, JSON.stringify({
        manifestVersion: "1.0.0",
        description: "Test",
        scenarios: [],
      }, null, 2));

      const { parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(parsed).toBeDefined();
      const missingError = parsed?.errors.find((e) => e.code === "MATRIX_REQUIRED_SCENARIO_MISSING");
      expect(missingError).toBeDefined();
      expect(missingError?.context).toBeDefined();
      expect(missingError?.context?.missingRequired).toEqual([
        "cli-save-contract",
        "generic-web-clip",
        "seedfinder-strain-profile",
      ]);
    });

    test("should include failure codes in scenario results", async () => {
      // Create a failure fixture manifest
      const failureManifest: ClipScenarioManifest = {
        manifestVersion: "1.0.0",
        description: "Test manifest with failure scenarios",
        scenarios: [
          {
            id: "generic-web-clip",
            name: "Generic web clip",
            required: true,
            entryPoint: "url",
            executor: {
              testFile: "tests/e2e/headless-clip-harness.test.ts",
              testCase: "scenario #1: generic web clip assertions",
            },
            fixture: {
              path: "tests/extractors/fixtures/article.html",
              simulatedUrl: "https://example.com/article",
              pageType: "web",
            },
            expectations: {
              frontmatterKeys: ["source", "title", "date_clipped", "tags", "type"],
              requiredTags: ["web-clip", "headless-harness"],
              contentSignals: ["Test Article Title", "This is the first paragraph"],
              customAssertions: {
                expectedSourceUrl: "https://example.com/article",
                expectedType: "article",
              },
            },
          },
          {
            id: "seedfinder-strain-profile",
            name: "SeedFinder profile",
            required: true,
            entryPoint: "url",
            executor: {
              testFile: "tests/e2e/headless-clip-harness.test.ts",
              testCase: "scenario #2: SeedFinder integrity assertions",
            },
            fixture: {
              path: "tests/templates/fixtures/seedfinder-strain.html",
              simulatedUrl: "https://en.seedfinder.eu/strain-info/Blue_Dream/",
              pageType: "article",
            },
            expectations: {
              frontmatterKeys: ["source", "title", "date_clipped", "tags", "type"],
              requiredTags: ["web-clip", "headless-harness"],
              contentSignals: ["## Strain Profile", "Lineage"],
              customAssertions: {
                templateUsed: "SeedFinder",
                seedFinderProfile: {
                  lineage: "Blueberry x Haze",
                  lineageParents: ["Blueberry", "Haze"],
                },
              },
            },
          },
          {
            id: "cli-save-contract",
            name: "CLI save contract",
            required: true,
            entryPoint: "cli-save",
            executor: {
              testFile: "tests/e2e/headless-clip-harness.test.ts",
              testCase: "scenario #3: CLI save contract assertions",
            },
            fixture: {
              path: "tests/extractors/fixtures/article.html",
              simulatedUrl: "https://example.com/article",
              pageType: "web",
            },
            expectations: {
              frontmatterKeys: ["source", "title", "date_clipped", "tags", "type"],
              requiredTags: ["web-clip", "headless-harness"],
              contentSignals: ["Test Article Title"],
            },
          },
        ],
      };

      const manifestPath = join(tempDir, "failure-manifest.json");
      writeFileSync(manifestPath, JSON.stringify(failureManifest, null, 2));

      const { parsed } = await runMatrixTool(["--manifest", manifestPath, "--format", "json"]);

      expect(parsed).toBeDefined();
      // Check that scenario results include failure codes when applicable
      for (const scenario of parsed!.scenarios) {
        if (!scenario.passed && scenario.failures.length > 0) {
          for (const failure of scenario.failures) {
            expect(failure.code).toBeDefined();
            expect(typeof failure.code).toBe("string");
            expect(failure.code).toMatch(/^MATRIX_/);
            expect(failure.message).toBeDefined();
          }
        }
      }
    });
  });

  describe("human format output", () => {
    test("should output human-readable format with --format human", async () => {
      const manifestPath = join(tempDir, "human-format-test.json");
      writeFileSync(manifestPath, JSON.stringify({
        manifestVersion: "1.0.0",
        description: "Test manifest",
        scenarios: [
          {
            id: "generic-web-clip",
            name: "Generic web clip",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "seedfinder-strain-profile",
            name: "SeedFinder profile",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "cli-save-contract",
            name: "CLI save contract",
            required: true,
            entryPoint: "cli-save",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
        ],
      }, null, 2));

      const { exitCode, stdout } = await runMatrixTool(["--manifest", manifestPath, "--format", "human"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Headless Scenario Matrix");
      expect(stdout).toContain("Summary:");
      expect(stdout).toContain("3/3 passed");
      expect(stdout).toContain("Status: OK");
    });

    test("should show missing required scenarios in human format", async () => {
      const manifestPath = join(tempDir, "human-missing-test.json");
      writeFileSync(manifestPath, JSON.stringify({
        manifestVersion: "1.0.0",
        description: "Test manifest",
        scenarios: [
          {
            id: "generic-web-clip",
            name: "Generic web clip",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
        ],
      }, null, 2));

      const { exitCode, stdout } = await runMatrixTool(["--manifest", manifestPath, "--format", "human"]);

      expect(exitCode).toBe(1);
      expect(stdout).toContain("Status: ERROR");
      expect(stdout).toContain("missing required");
    });
  });

  describe("scenario filtering", () => {
    test("should filter to single scenario with --scenario flag", async () => {
      const manifestPath = join(tempDir, "filter-test.json");
      writeFileSync(manifestPath, JSON.stringify({
        manifestVersion: "1.0.0",
        description: "Test manifest",
        scenarios: [
          {
            id: "generic-web-clip",
            name: "Generic web clip",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
          {
            id: "seedfinder-strain-profile",
            name: "SeedFinder profile",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
        ],
      }, null, 2));

      const { parsed } = await runMatrixTool([
        "--manifest",
        manifestPath,
        "--scenario",
        "generic-web-clip",
        "--format",
        "json",
      ]);

      expect(parsed).toBeDefined();
      expect(parsed?.total).toBe(1);
      expect(parsed?.scenarios).toHaveLength(1);
      expect(parsed?.scenarios[0].id).toBe("generic-web-clip");
    });

    test("should handle missing --scenario filter gracefully", async () => {
      const manifestPath = join(tempDir, "filter-missing-test.json");
      writeFileSync(manifestPath, JSON.stringify({
        manifestVersion: "1.0.0",
        description: "Test manifest",
        scenarios: [
          {
            id: "generic-web-clip",
            name: "Generic web clip",
            required: true,
            entryPoint: "url",
            executor: { testCase: "test" },
            fixture: { path: "tests/extractors/fixtures/article.html" },
            expectations: { frontmatterKeys: [] },
          },
        ],
      }, null, 2));

      const { parsed } = await runMatrixTool([
        "--manifest",
        manifestPath,
        "--scenario",
        "nonexistent-scenario",
        "--format",
        "json",
      ]);

      expect(parsed).toBeDefined();
      expect(parsed?.total).toBe(0);
      expect(parsed?.scenarios).toHaveLength(0);
    });
  });
});
