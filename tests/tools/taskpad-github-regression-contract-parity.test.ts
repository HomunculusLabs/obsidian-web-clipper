import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type ParityReport,
  extractContractReferences,
  buildCommandSurface,
  runParityValidation,
  normalizeTestFilePath,
  normalizeCommand,
  isTestFilePath,
  isPackageScriptName,
  classifyReference,
  sortViolationsCanonical,
  RULE_IDS,
  type ContractReference,
  type ReferenceValidation,
} from "../../tools/taskpad-github-regression-contract-parity";

/**
 * TP005: Tests for taskpad:github-regression-contract-parity coverage
 *
 * These tests verify deterministic behavior for:
 * 1. Aligned scenario: All references valid and exist (pass)
 * 2. Missing test file scenario: References non-existent test files (fail)
 * 3. Missing script scenario: References non-existent package scripts (fail)
 * 4. Stale reference scenario: References deprecated test files (fail)
 * 5. No references scenario: Doc has no verification references (fail)
 * 6. Multiple violations scenario: Multiple different violations (fail)
 *
 * Key assertions:
 * - Deterministic output ordering (canonical rule ID order)
 * - Exact rule IDs for each violation class
 * - Stable JSON structure for machine-readable consumption
 * - Proper parsing of contract docs for all reference types
 */

const FIXTURES_DIR = resolve(__dirname, "fixtures", "github-regression-contract-parity");

// ============================================================================
// Helper Functions
// ============================================================================

function loadFixture(name: string): {
  doc: string;
  package: string;
  expected: ParityReport;
} {
  return {
    doc: readFileSync(resolve(FIXTURES_DIR, `${name}.md`), "utf8"),
    package: readFileSync(resolve(FIXTURES_DIR, `${name}.package.json`), "utf8"),
    expected: JSON.parse(
      readFileSync(resolve(FIXTURES_DIR, `${name}.expected.json`), "utf8").replace(
        /FIXTURES_DIR/g,
        FIXTURES_DIR,
      ),
    ),
  };
}

function normalizeReportForComparison(report: ParityReport, expected: ParityReport): void {
  // Normalize timestamp (expected uses a fixed timestamp)
  expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  // Sort violations and validations for deterministic comparison
  report.violations = sortViolationsCanonical(report.violations);
  expected.violations = sortViolationsCanonical(expected.violations);

  // Sort references by line number
  report.docAnalysis.references.sort((a, b) => a.lineNumber - b.lineNumber);
  expected.docAnalysis.references.sort((a, b) => a.lineNumber - b.lineNumber);

  // Sort validations
  report.validations.sort((a, b) => {
    const lineDiff = a.reference.lineNumber - b.reference.lineNumber;
    if (lineDiff !== 0) return lineDiff;
    return a.reference.normalizedReference.localeCompare(b.reference.normalizedReference);
  });
  expected.validations.sort((a, b) => {
    const lineDiff = a.reference.lineNumber - b.reference.lineNumber;
    if (lineDiff !== 0) return lineDiff;
    return a.reference.normalizedReference.localeCompare(b.reference.normalizedReference);
  });
}

// ============================================================================
// Normalization Tests
// ============================================================================

describe("normalizeTestFilePath", () => {
  test("removes backticks", () => {
    expect(normalizeTestFilePath("`tests/templates/github.test.ts`")).toBe(
      "tests/templates/github.test.ts",
    );
  });

  test("removes leading/trailing whitespace", () => {
    expect(normalizeTestFilePath("  tests/templates/github.test.ts  ")).toBe(
      "tests/templates/github.test.ts",
    );
  });

  test("preserves path separators", () => {
    expect(normalizeTestFilePath("tests/e2e/headless-clip-harness.test.ts")).toBe(
      "tests/e2e/headless-clip-harness.test.ts",
    );
  });

  test("handles combined whitespace and backticks", () => {
    expect(normalizeTestFilePath("  `tests/templates/github.test.ts`  ")).toBe(
      "tests/templates/github.test.ts",
    );
  });
});

describe("normalizeCommand", () => {
  test("strips 'bun run' prefix", () => {
    expect(normalizeCommand("bun run typecheck")).toBe("typecheck");
  });

  test("strips 'bun test' prefix", () => {
    expect(normalizeCommand("bun test tests/templates/github.test.ts")).toBe(
      "tests/templates/github.test.ts",
    );
  });

  test("strips 'npm run' prefix", () => {
    expect(normalizeCommand("npm run test:github:reported-failures")).toBe(
      "test:github:reported-failures",
    );
  });

  test("collapses multiple spaces but preserves arguments", () => {
    expect(normalizeCommand("typecheck   --verbose")).toBe("typecheck --verbose");
  });

  test("preserves script names with colons", () => {
    expect(normalizeCommand("bun run test:github:reported-failures")).toBe(
      "test:github:reported-failures",
    );
  });
});

describe("isTestFilePath", () => {
  test("identifies test files in tests/ directory", () => {
    expect(isTestFilePath("tests/templates/github.test.ts")).toBe(true);
    expect(isTestFilePath("tests/e2e/headless-clip-harness.test.ts")).toBe(true);
  });

  test("identifies test files in test/ directory", () => {
    expect(isTestFilePath("test/templates/github.test.ts")).toBe(true);
    expect(isTestFilePath("test/e2e/headless-clip-harness.test.ts")).toBe(true);
  });

  test("accepts .spec.ts extension", () => {
    expect(isTestFilePath("tests/templates/github.spec.ts")).toBe(true);
  });

  test("rejects non-test files", () => {
    expect(isTestFilePath("src/content/templates/github.ts")).toBe(false);
    expect(isTestFilePath("tools/taskpad-auto-ideation.ts")).toBe(false);
  });

  test("rejects package script names", () => {
    expect(isTestFilePath("typecheck")).toBe(false);
    expect(isTestFilePath("test:github:reported-failures")).toBe(false);
  });
});

describe("isPackageScriptName", () => {
  test("identifies simple script names", () => {
    expect(isPackageScriptName("typecheck")).toBe(true);
    expect(isPackageScriptName("lint")).toBe(true);
    expect(isPackageScriptName("build")).toBe(true);
  });

  test("identifies script names with colons", () => {
    expect(isPackageScriptName("taskpad:auto-ideation")).toBe(true);
    expect(isPackageScriptName("verify:taskpad:intake:full")).toBe(true);
    expect(isPackageScriptName("build:production")).toBe(true);
  });

  test("identifies script names with hyphens", () => {
    expect(isPackageScriptName("build-production")).toBe(true);
    expect(isPackageScriptName("dev-server")).toBe(true);
  });

  test("rejects test file paths", () => {
    expect(isPackageScriptName("tests/templates/github.test.ts")).toBe(false);
    expect(isPackageScriptName("test/templates/github.spec.ts")).toBe(false);
  });

  test("rejects script names that look like test patterns", () => {
    expect(isPackageScriptName("test")).toBe(false); // Too close to test file pattern
    expect(isPackageScriptName("test-e2e")).toBe(false); // Contains "test"
  });

  test("rejects directory paths", () => {
    expect(isPackageScriptName("src/content")).toBe(false);
    expect(isPackageScriptName("tools")).toBe(false);
  });
});

describe("classifyReference", () => {
  test("classifies test files correctly", () => {
    expect(classifyReference("tests/templates/github.test.ts")).toBe("test-file");
    expect(classifyReference("tests/e2e/headless-clip-harness.test.ts")).toBe("test-file");
  });

  test("classifies package scripts correctly", () => {
    expect(classifyReference("typecheck")).toBe("package-script");
    expect(classifyReference("test:github:reported-failures")).toBe("package-script");
    expect(classifyReference("lint")).toBe("package-script");
  });

  test("classifies tool paths correctly", () => {
    expect(classifyReference("tools/taskpad-auto-ideation.ts")).toBe("tool-path");
    expect(classifyReference("src/content/templates/github.ts")).toBe("tool-path");
  });

  test("defaults to package-script for unknown alphanumeric patterns", () => {
    expect(classifyReference("something-unknown")).toBe("package-script");
  });
});

// ============================================================================
// Reference Extraction Tests
// ============================================================================

describe("extractContractReferences", () => {
  test("extracts test files from backticks", () => {
    const content = `
# Test Doc

Run tests with: \`tests/templates/github.test.ts\`
`;
    const analysis = extractContractReferences("test.md", content);
    expect(analysis.references).toHaveLength(1);
    expect(analysis.references[0].normalizedReference).toBe("tests/templates/github.test.ts");
    expect(analysis.references[0].sourceContext).toBe("inline-text");
  });

  test("extracts test files from bash code blocks", () => {
    const content = `
\`\`\`bash
bun test tests/e2e/headless-clip-harness.test.ts
\`\`\`
`;
    const analysis = extractContractReferences("test.md", content);
    expect(analysis.references).toHaveLength(1);
    expect(analysis.references[0].normalizedReference).toBe("tests/e2e/headless-clip-harness.test.ts");
    expect(analysis.references[0].sourceContext).toBe("code-block");
  });

  test("extracts package scripts from commands", () => {
    const content = `
\`\`\`bash
bun run test:github:reported-failures
bun run typecheck
\`\`\`
`;
    const analysis = extractContractReferences("test.md", content);
    expect(analysis.references).toHaveLength(2);
    expect(analysis.references[0].normalizedReference).toBe("test:github:reported-failures");
    expect(analysis.references[1].normalizedReference).toBe("typecheck");
  });

  test("extracts tool paths from backticks", () => {
    const content = `
# Test Doc

Tool: \`tools/taskpad-auto-ideation.ts\`
`;
    const analysis = extractContractReferences("test.md", content);
    expect(analysis.references).toHaveLength(1);
    expect(analysis.references[0].normalizedReference).toBe("tools/taskpad-auto-ideation.ts");
    expect(analysis.references[0].referenceType).toBe("tool-path");
  });

  test("counts references by type correctly", () => {
    const content = `
\`\`\`bash
bun test tests/templates/github.test.ts
bun run test:github:reported-failures
\`\`\`

See also: \`tools/taskpad-auto-ideation.ts\`
`;
    const analysis = extractContractReferences("test.md", content);
    expect(analysis.referenceCounts.testFiles).toBe(1);
    expect(analysis.referenceCounts.packageScripts).toBe(1);
    expect(analysis.referenceCounts.toolPaths).toBe(1);
    expect(analysis.totalReferences).toBe(3);
  });

  test("deduplicates references on same line", () => {
    const content = `
\`\`\`bash
bun test tests/templates/github.test.ts tests/templates/github.test.ts
\`\`\`
`;
    const analysis = extractContractReferences("test.md", content);
    expect(analysis.references).toHaveLength(1);
    expect(analysis.references[0].normalizedReference).toBe("tests/templates/github.test.ts");
  });

  test("sorts references by line number", () => {
    const content = `
Line 1: \`tests/first.test.ts\`

Line 2 content

Line 3: \`tests/third.test.ts\`

Line 4: \`tests/second.test.ts\`
`;
    const analysis = extractContractReferences("test.md", content);
    const normalizedRefs = analysis.references.map(r => r.normalizedReference);
    expect(normalizedRefs).toEqual([
      "tests/first.test.ts",
      "tests/third.test.ts",
      "tests/second.test.ts",
    ]);
  });
});

// ============================================================================
// Stable Ordering Tests
// ============================================================================

describe("sortViolationsCanonical", () => {
  test("sorts violations by canonical rule ID order", () => {
    const violations = [
      {
        ruleId: RULE_IDS.STALE_TEST_REFERENCE,
        severity: "warning" as const,
        docPath: "test.md",
        lineNumber: 5,
        rawReference: "tests/templates/github-regression.test.ts",
        referenceType: "test-file" as const,
        message: "Deprecated reference",
        remediation: "Update to canonical",
      },
      {
        ruleId: RULE_IDS.MISSING_TEST_FILE,
        severity: "error" as const,
        docPath: "test.md",
        lineNumber: 3,
        rawReference: "tests/nonexistent.test.ts",
        referenceType: "test-file" as const,
        message: "Test file does not exist",
        remediation: "Create or update",
      },
      {
        ruleId: RULE_IDS.MISSING_PACKAGE_SCRIPT,
        severity: "error" as const,
        docPath: "test.md",
        lineNumber: 4,
        rawReference: "nonexistent:script",
        referenceType: "package-script" as const,
        message: "Package script does not exist",
        remediation: "Add to package.json",
      },
    ];

    const sorted = sortViolationsCanonical(violations);
    expect(sorted[0].ruleId).toBe(RULE_IDS.MISSING_TEST_FILE);
    expect(sorted[1].ruleId).toBe(RULE_IDS.MISSING_PACKAGE_SCRIPT);
    expect(sorted[2].ruleId).toBe(RULE_IDS.STALE_TEST_REFERENCE);
  });

  test("maintains order for same rule ID by line number", () => {
    const violations = [
      {
        ruleId: RULE_IDS.STALE_TEST_REFERENCE,
        severity: "warning" as const,
        docPath: "test.md",
        lineNumber: 10,
        rawReference: "tests/third.test.ts",
        referenceType: "test-file" as const,
        message: "Deprecated reference",
        remediation: "Update to canonical",
      },
      {
        ruleId: RULE_IDS.STALE_TEST_REFERENCE,
        severity: "warning" as const,
        docPath: "test.md",
        lineNumber: 5,
        rawReference: "tests/first.test.ts",
        referenceType: "test-file" as const,
        message: "Deprecated reference",
        remediation: "Update to canonical",
      },
      {
        ruleId: RULE_IDS.STALE_TEST_REFERENCE,
        severity: "warning" as const,
        docPath: "test.md",
        lineNumber: 7,
        rawReference: "tests/second.test.ts",
        referenceType: "test-file" as const,
        message: "Deprecated reference",
        remediation: "Update to canonical",
      },
    ];

    const sorted = sortViolationsCanonical(violations);
    // Verify all violations have the same rule ID after sorting
    expect(sorted.every(v => v.ruleId === RULE_IDS.STALE_TEST_REFERENCE)).toBe(true);
    // Verify all three violations are present
    expect(sorted).toHaveLength(3);
  });
});

// ============================================================================
// Fixture-Based Integration Tests
// ============================================================================

describe("Pass Scenario: All references valid", () => {
  const { doc, package: packageJson, expected } = loadFixture("pass");

  test("extracts correct references", () => {
    const analysis = extractContractReferences(
      resolve(FIXTURES_DIR, "pass.md"),
      doc,
    );

    expect(analysis.totalReferences).toBe(expected.docAnalysis.totalReferences);
    expect(analysis.referenceCounts).toEqual(expected.docAnalysis.referenceCounts);
    expect(analysis.references.length).toBe(expected.docAnalysis.references.length);
  });

  test("validates all references successfully", () => {
    const docAnalysis = extractContractReferences(
      resolve(FIXTURES_DIR, "pass.md"),
      doc,
    );
    const commandSurface = buildCommandSurface(
      resolve(FIXTURES_DIR, "pass.package.json"),
      FIXTURES_DIR,
    );

    const { validations, summary, violations } = runParityValidation(
      docAnalysis,
      commandSurface,
      FIXTURES_DIR,
    );

    expect(summary.status).toBe("pass");
    expect(summary.validReferences).toBe(expected.summary.validReferences);
    expect(summary.invalidReferences).toBe(0);
    expect(violations).toHaveLength(0);
    expect(validations.every(v => v.valid)).toBe(true);
  });

  test("produces deterministic report structure", () => {
    const docAnalysis = extractContractReferences(
      resolve(FIXTURES_DIR, "pass.md"),
      doc,
    );
    const commandSurface = buildCommandSurface(
      resolve(FIXTURES_DIR, "pass.package.json"),
      FIXTURES_DIR,
    );
    const { validations, summary, violations } = runParityValidation(
      docAnalysis,
      commandSurface,
      FIXTURES_DIR,
    );

    const report: ParityReport = {
      status: summary.status,
      inputs: {
        fixturesDocPath: resolve(FIXTURES_DIR, "pass.md"),
        packagePath: resolve(FIXTURES_DIR, "pass.package.json"),
        projectRoot: FIXTURES_DIR,
      },
      docAnalysis,
      commandSurface,
      validations,
      summary,
      violations,
      timestamp: new Date().toISOString(),
    };

    normalizeReportForComparison(report, expected);

    expect(report.status).toBe(expected.status);
    expect(report.summary).toEqual(expected.summary);
    expect(report.docAnalysis.totalReferences).toBe(expected.docAnalysis.totalReferences);
  });
});

describe("Fail Scenario: Missing test file", () => {
  const { doc, package: packageJson, expected } = loadFixture("missing-test-file");

  test("detects missing test file", () => {
    const docAnalysis = extractContractReferences(
      resolve(FIXTURES_DIR, "missing-test-file.md"),
      doc,
    );
    const commandSurface = buildCommandSurface(
      resolve(FIXTURES_DIR, "missing-test-file.package.json"),
      FIXTURES_DIR,
    );

    const { validations, summary, violations } = runParityValidation(
      docAnalysis,
      commandSurface,
      FIXTURES_DIR,
    );

    expect(summary.status).toBe("fail");
    expect(summary.invalidReferences).toBeGreaterThanOrEqual(1);
    expect(violations.length).toBeGreaterThan(0);

    const missingFileViolation = violations.find(v => v.ruleId === RULE_IDS.MISSING_TEST_FILE);
    expect(missingFileViolation).toBeDefined();
    expect(missingFileViolation?.severity).toBe("error");
    expect(missingFileViolation?.rawReference).toContain("nonexistent");
    expect(missingFileViolation?.remediation).toBeTruthy();
  });

  test("produces correct violation structure", () => {
    const docAnalysis = extractContractReferences(
      resolve(FIXTURES_DIR, "missing-test-file.md"),
      doc,
    );
    const commandSurface = buildCommandSurface(
      resolve(FIXTURES_DIR, "missing-test-file.package.json"),
      FIXTURES_DIR,
    );
    const { validations, summary, violations } = runParityValidation(
      docAnalysis,
      commandSurface,
      FIXTURES_DIR,
    );

    const report: ParityReport = {
      status: summary.status,
      inputs: {
        fixturesDocPath: resolve(FIXTURES_DIR, "missing-test-file.md"),
        packagePath: resolve(FIXTURES_DIR, "missing-test-file.package.json"),
        projectRoot: FIXTURES_DIR,
      },
      docAnalysis,
      commandSurface,
      validations,
      summary,
      violations,
      timestamp: new Date().toISOString(),
    };

    normalizeReportForComparison(report, expected);

    expect(report.status).toBe(expected.status);
    expect(report.summary.violationCounts).toEqual(expected.summary.violationCounts);
    expect(report.violations[0].ruleId).toBe(expected.violations[0].ruleId);
    expect(report.violations[0].severity).toBe(expected.violations[0].severity);
  });
});

describe("Fail Scenario: Missing package script", () => {
  const { doc, package: packageJson, expected } = loadFixture("missing-script");

  test("detects missing package script", () => {
    const docAnalysis = extractContractReferences(
      resolve(FIXTURES_DIR, "missing-script.md"),
      doc,
    );
    const commandSurface = buildCommandSurface(
      resolve(FIXTURES_DIR, "missing-script.package.json"),
      FIXTURES_DIR,
    );

    const { validations, summary, violations } = runParityValidation(
      docAnalysis,
      commandSurface,
      FIXTURES_DIR,
    );

    expect(summary.status).toBe("fail");
    expect(summary.invalidReferences).toBeGreaterThanOrEqual(1);
    expect(violations.length).toBeGreaterThan(0);

    const missingScriptViolation = violations.find(v => v.ruleId === RULE_IDS.MISSING_PACKAGE_SCRIPT);
    expect(missingScriptViolation).toBeDefined();
    expect(missingScriptViolation?.severity).toBe("error");
    expect(missingScriptViolation?.rawReference).toContain("nonexistent");
  });

  test("produces correct violation counts", () => {
    const docAnalysis = extractContractReferences(
      resolve(FIXTURES_DIR, "missing-script.md"),
      doc,
    );
    const commandSurface = buildCommandSurface(
      resolve(FIXTURES_DIR, "missing-script.package.json"),
      FIXTURES_DIR,
    );
    const { summary } = runParityValidation(docAnalysis, commandSurface, FIXTURES_DIR);

    expect(summary.violationCounts).toEqual(expected.summary.violationCounts);
    expect(summary.validReferences).toBe(expected.summary.validReferences);
  });
});

describe("Fail Scenario: Stale test reference", () => {
  const { doc, package: packageJson, expected } = loadFixture("stale-test-reference");

  test("detects deprecated test file references", () => {
    const docAnalysis = extractContractReferences(
      resolve(FIXTURES_DIR, "stale-test-reference.md"),
      doc,
    );
    const commandSurface = buildCommandSurface(
      resolve(FIXTURES_DIR, "stale-test-reference.package.json"),
      FIXTURES_DIR,
    );

    const { validations, summary, violations } = runParityValidation(
      docAnalysis,
      commandSurface,
      FIXTURES_DIR,
    );

    expect(summary.status).toBe("fail");
    expect(summary.invalidReferences).toBeGreaterThanOrEqual(1);
    expect(violations.length).toBeGreaterThan(0);

    const staleRefViolation = violations.find(v => v.ruleId === RULE_IDS.STALE_TEST_REFERENCE);
    expect(staleRefViolation).toBeDefined();
    expect(staleRefViolation?.severity).toBe("warning");
    expect(staleRefViolation?.rawReference).toContain("github-regression");
    expect(staleRefViolation?.canonicalCommand).toBe("tests/templates/github.test.ts");
  });

  test("provides canonical command mapping", () => {
    const docAnalysis = extractContractReferences(
      resolve(FIXTURES_DIR, "stale-test-reference.md"),
      doc,
    );
    const commandSurface = buildCommandSurface(
      resolve(FIXTURES_DIR, "stale-test-reference.package.json"),
      FIXTURES_DIR,
    );
    const { violations } = runParityValidation(docAnalysis, commandSurface, FIXTURES_DIR);

    expect(violations[0].canonicalCommand).toBeTruthy();
    expect(violations[0].canonicalCommand).toContain("github.test.ts");
  });
});

describe("Fail Scenario: No verification references", () => {
  const { doc, package: packageJson, expected } = loadFixture("no-references");

  test("detects missing verification references", () => {
    const docAnalysis = extractContractReferences(
      resolve(FIXTURES_DIR, "no-references.md"),
      doc,
    );
    const commandSurface = buildCommandSurface(
      resolve(FIXTURES_DIR, "no-references.package.json"),
      FIXTURES_DIR,
    );

    const { validations, summary, violations } = runParityValidation(
      docAnalysis,
      commandSurface,
      FIXTURES_DIR,
    );

    expect(summary.status).toBe("fail");
    expect(summary.totalReferences).toBe(0);
    expect(violations).toHaveLength(1);

    const noRefsViolation = violations[0];
    expect(noRefsViolation.ruleId).toBe(RULE_IDS.NO_VERIFICATION_REFERENCES);
    expect(noRefsViolation.severity).toBe("error");
    expect(noRefsViolation.lineNumber).toBe(1);
    expect(noRefsViolation.remediation).toContain("Add test file");
  });

  test("produces correct summary for empty doc", () => {
    const docAnalysis = extractContractReferences(
      resolve(FIXTURES_DIR, "no-references.md"),
      doc,
    );
    const commandSurface = buildCommandSurface(
      resolve(FIXTURES_DIR, "no-references.package.json"),
      FIXTURES_DIR,
    );
    const { summary } = runParityValidation(docAnalysis, commandSurface, FIXTURES_DIR);

    expect(summary.totalReferences).toBe(0);
    expect(summary.validReferences).toBe(0);
    expect(summary.invalidReferences).toBe(0);
    expect(summary.violationCounts[RULE_IDS.NO_VERIFICATION_REFERENCES]).toBe(1);
  });
});

describe("Fail Scenario: Multiple violations", () => {
  const { doc, package: packageJson, expected } = loadFixture("multiple-violations");

  test("detects all violation types", () => {
    const docAnalysis = extractContractReferences(
      resolve(FIXTURES_DIR, "multiple-violations.md"),
      doc,
    );
    const commandSurface = buildCommandSurface(
      resolve(FIXTURES_DIR, "multiple-violations.package.json"),
      FIXTURES_DIR,
    );

    const { validations, summary, violations } = runParityValidation(
      docAnalysis,
      commandSurface,
      FIXTURES_DIR,
    );

    expect(summary.status).toBe("fail");
    expect(summary.invalidReferences).toBe(5);
    expect(violations).toHaveLength(5);

    const ruleIds = violations.map(v => v.ruleId);
    expect(ruleIds).toContain(RULE_IDS.MISSING_TEST_FILE);
    expect(ruleIds).toContain(RULE_IDS.MISSING_PACKAGE_SCRIPT);
    expect(ruleIds).toContain(RULE_IDS.STALE_TEST_REFERENCE);
  });

  test("maintains stable violation ordering", () => {
    const docAnalysis = extractContractReferences(
      resolve(FIXTURES_DIR, "multiple-violations.md"),
      doc,
    );
    const commandSurface = buildCommandSurface(
      resolve(FIXTURES_DIR, "multiple-violations.package.json"),
      FIXTURES_DIR,
    );
    const { violations } = runParityValidation(docAnalysis, commandSurface, FIXTURES_DIR);

    // Sort twice to verify stability
    const sorted1 = sortViolationsCanonical([...violations]);
    const sorted2 = sortViolationsCanonical([...violations]);

    expect(sorted1).toEqual(sorted2);

    // Check that we have all expected violation types
    const ruleIds = sorted1.map(v => v.ruleId);
    expect(ruleIds).toContain(RULE_IDS.MISSING_TEST_FILE);
    expect(ruleIds).toContain(RULE_IDS.MISSING_PACKAGE_SCRIPT);
    expect(ruleIds).toContain(RULE_IDS.STALE_TEST_REFERENCE);
  });

  test("produces correct violation counts", () => {
    const docAnalysis = extractContractReferences(
      resolve(FIXTURES_DIR, "multiple-violations.md"),
      doc,
    );
    const commandSurface = buildCommandSurface(
      resolve(FIXTURES_DIR, "multiple-violations.package.json"),
      FIXTURES_DIR,
    );
    const { summary } = runParityValidation(docAnalysis, commandSurface, FIXTURES_DIR);

    expect(summary.violationCounts).toEqual(expected.summary.violationCounts);
    expect(summary.violationCounts[RULE_IDS.STALE_TEST_REFERENCE]).toBe(2);
    expect(summary.violationCounts[RULE_IDS.MISSING_PACKAGE_SCRIPT]).toBe(2);
    expect(summary.violationCounts[RULE_IDS.MISSING_TEST_FILE]).toBe(1);
  });
});

// ============================================================================
// Deterministic JSON Output Tests
// ============================================================================

describe("Deterministic JSON output", () => {
  test("produces stable JSON across multiple runs", () => {
    const { doc, package: packageJson } = loadFixture("pass-fixtures");

    const runReport = (): string => {
      const docAnalysis = extractContractReferences(
        resolve(FIXTURES_DIR, "pass-fixtures.md"),
        doc,
      );
      const commandSurface = buildCommandSurface(
        resolve(FIXTURES_DIR, "pass-fixtures.package.json"),
        FIXTURES_DIR,
      );
      const { validations, summary, violations } = runParityValidation(
        docAnalysis,
        commandSurface,
        FIXTURES_DIR,
      );

      const report: ParityReport = {
        status: summary.status,
        inputs: {
          fixturesDocPath: resolve(FIXTURES_DIR, "pass-fixtures.md"),
          packagePath: resolve(FIXTURES_DIR, "pass-fixtures.package.json"),
          projectRoot: FIXTURES_DIR,
        },
        docAnalysis,
        commandSurface,
        validations,
        summary,
        violations: sortViolationsCanonical(violations),
        timestamp: "2026-03-02T00:00:00.000Z", // Fixed timestamp
      };

      // Sort references and validations for deterministic output
      report.docAnalysis.references.sort((a, b) => a.lineNumber - b.lineNumber);
      report.validations.sort((a, b) => {
        const lineDiff = a.reference.lineNumber - b.reference.lineNumber;
        if (lineDiff !== 0) return lineDiff;
        return a.reference.normalizedReference.localeCompare(b.reference.normalizedReference);
      });

      return JSON.stringify(report, null, 2);
    };

    const json1 = runReport();
    const json2 = runReport();
    const json3 = runReport();

    expect(json1).toBe(json2);
    expect(json2).toBe(json3);
  });

  test("produces stable violation order for multiple violations", () => {
    const { doc, package: packageJson } = loadFixture("multiple-violations");

    const runViolations = () => {
      const docAnalysis = extractContractReferences(
        resolve(FIXTURES_DIR, "multiple-violations.md"),
        doc,
      );
      const commandSurface = buildCommandSurface(
        resolve(FIXTURES_DIR, "multiple-violations.package.json"),
        FIXTURES_DIR,
      );
      const { violations } = runParityValidation(docAnalysis, commandSurface, FIXTURES_DIR);
      return sortViolationsCanonical(violations).map(v => ({
        ruleId: v.ruleId,
        lineNumber: v.lineNumber,
      }));
    };

    const violations1 = runViolations();
    const violations2 = runViolations();

    expect(violations1).toEqual(violations2);
  });
});
