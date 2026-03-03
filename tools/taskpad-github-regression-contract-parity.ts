#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ============================================================================
// Rule IDs
// ============================================================================

/**
 * Rule IDs for GitHub regression contract parity violations.
 * These are deterministic identifiers used for machine-readable diagnostics.
 */
export const RULE_IDS = {
  /** Contract doc references a non-existent test file */
  MISSING_TEST_FILE: "GH_PARITY001_MISSING_TEST_FILE",

  /** Contract doc references a non-existent verification command */
  MISSING_VERIFICATION_COMMAND: "GH_PARITY002_MISSING_VERIFICATION_COMMAND",

  /** Contract doc references a script in package.json that doesn't exist */
  MISSING_PACKAGE_SCRIPT: "GH_PARITY003_MISSING_PACKAGE_SCRIPT",

  /** Contract doc references a tool path that doesn't exist */
  MISSING_TOOL_PATH: "GH_PARITY004_MISSING_TOOL_PATH",

  /** Contract doc has a stale reference to a deprecated test entrypoint */
  STALE_TEST_REFERENCE: "GH_PARITY005_STALE_TEST_REFERENCE",

  /** Contract doc references a command in an unsupported format */
  UNSUPPORTED_COMMAND_FORMAT: "GH_PARITY006_UNSUPPORTED_COMMAND_FORMAT",

  /** Contract doc references a test file that exists but has no corresponding verification command */
  MISSING_COMMAND_MAPPING: "GH_PARITY007_MISSING_COMMAND_MAPPING",

  /** Contract doc has a malformed reference that cannot be parsed */
  MALFORMED_REFERENCE: "GH_PARITY008_MALFORMED_REFERENCE",

  /** Contract doc has no verification references at all */
  NO_VERIFICATION_REFERENCES: "GH_PARITY009_NO_VERIFICATION_REFERENCES",

  /** Contract doc references a canonical command that doesn't match expected pattern */
  CANONICAL_COMMAND_MISMATCH: "GH_PARITY010_CANONICAL_COMMAND_MISMATCH",

} as const;

type RuleId = (typeof RULE_IDS)[keyof typeof RULE_IDS];

/**
 * Canonical order for violation rule IDs in diagnostics output.
 * Ensures deterministic, stable ordering across runs for machine-readable output.
 */
const CANONICAL_VIOLATION_ORDER: RuleId[] = [
  RULE_IDS.NO_VERIFICATION_REFERENCES,
  RULE_IDS.MALFORMED_REFERENCE,
  RULE_IDS.UNSUPPORTED_COMMAND_FORMAT,
  RULE_IDS.CANONICAL_COMMAND_MISMATCH,
  RULE_IDS.MISSING_TEST_FILE,
  RULE_IDS.MISSING_VERIFICATION_COMMAND,
  RULE_IDS.MISSING_PACKAGE_SCRIPT,
  RULE_IDS.MISSING_TOOL_PATH,
  RULE_IDS.STALE_TEST_REFERENCE,
  RULE_IDS.MISSING_COMMAND_MAPPING,
];

// ============================================================================
// Types
// ============================================================================

/**
 * Reference types that can appear in GitHub regression contract docs.
 */
export type ReferenceType = "test-file" | "verification-command" | "package-script" | "tool-path";

/**
 * A reference extracted from contract documentation.
 */
export interface ContractReference {
  /** Line number in the source doc where reference appears */
  lineNumber: number;
  /** The raw reference text as it appears in the doc */
  rawReference: string;
  /** Normalized reference string for comparison */
  normalizedReference: string;
  /** Type of reference (test file, command, script, etc.) */
  referenceType: ReferenceType;
  /** Source context (code block, inline text, etc.) */
  sourceContext: "code-block" | "inline-text" | "shell-prompt" | "list-item";
}

/**
 * Analysis of GitHub regression contract documentation.
 */
export interface ContractDocAnalysis {
  /** Path to the contract document being analyzed */
  docPath: string;
  /** All references found in the doc */
  references: ContractReference[];
  /** Count of references by type */
  referenceCounts: {
    testFiles: number;
    verificationCommands: number;
    packageScripts: number;
    toolPaths: number;
  };
  /** Total number of references found */
  totalReferences: number;
}

/**
 * Available command surface from package.json scripts and tool paths.
 */
export interface CommandSurface {
  /** Path to package.json */
  packagePath: string;
  /** All scripts defined in package.json */
  packageScripts: Record<string, string>;
  /** Discovered tool file paths */
  toolPaths: string[];
}

/**
 * Validation result for a single reference.
 */
export interface ReferenceValidation {
  /** The reference being validated */
  reference: ContractReference;
  /** Whether the reference is valid (exists and is accessible) */
  valid: boolean;
  /** Rule ID if reference is invalid */
  ruleId?: RuleId;
  /** Human-readable validation message */
  message: string;
  /** Remediation hint for invalid references */
  remediation?: string;
  /** Canonical command mapping suggestion if applicable */
  canonicalCommand?: string;
}

/**
 * Summary statistics for parity validation.
 */
export interface ParityValidationSummary {
  /** Total number of references validated */
  totalReferences: number;
  /** Number of valid references */
  validReferences: number;
  /** Number of invalid references */
  invalidReferences: number;
  /** Count of violations by rule ID */
  violationCounts: Partial<Record<RuleId, number>>;
  /** Overall pass/fail status */
  status: "pass" | "fail";
}

/**
 * Violation with full diagnostic details.
 */
export interface ParityViolation {
  /** Rule ID for this violation */
  ruleId: RuleId;
  /** Severity level */
  severity: "error" | "warning";
  /** Source document path */
  docPath: string;
  /** Line number in source doc */
  lineNumber: number;
  /** Raw reference text */
  rawReference: string;
  /** Reference type */
  referenceType: ReferenceType;
  /** Human-readable message */
  message: string;
  /** Suggested remediation */
  remediation: string;
  /** Canonical command mapping (if applicable) */
  canonicalCommand?: string;
}

/**
 * Full parity validation report.
 */
export interface ParityReport {
  /** Overall status */
  status: "pass" | "fail";
  /** Input paths */
  inputs: {
    fixturesDocPath: string;
    packagePath: string;
    projectRoot: string;
  };
  /** Analysis of contract documentation */
  docAnalysis: ContractDocAnalysis;
  /** Command surface analysis */
  commandSurface: CommandSurface;
  /** Validation results for each reference */
  validations: ReferenceValidation[];
  /** Summary statistics */
  summary: ParityValidationSummary;
  /** List of violations (empty if pass) */
  violations: ParityViolation[];
  /** ISO timestamp of when validation was run */
  timestamp: string;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliOptions {
  fixturesDocPath?: string;
  packagePath?: string;
  projectRoot?: string;
  format: "json" | "human";
}

/**
 * Print help message for CLI.
 */
function printHelp(): void {
  console.log(`
GitHub Regression Contract Parity Checker

Validates that GitHub regression contract documentation references only
live, accessible test files, verification commands, and script paths.

USAGE:
  bun run tools/taskpad-github-regression-contract-parity.ts --fixtures-doc <path> --package <path> [--project-root <path>]
  bun run tools/taskpad-github-regression-contract-parity.ts <fixtures-doc-path> <package-path>

OPTIONS:
  --fixtures-doc <path>   Path to GitHub regression fixtures doc (required)
  --package <path>        Path to package.json file (required)
  --project-root <path>   Project root directory (default: parent of package.json)
  --format <format>       Output format: json or human (default: json)
  --help, -h              Show this help message

EXIT CODES:
  0  All references pass parity validation
  1  One or more references fail parity validation (missing, stale, or malformed)

EXAMPLES:
  # Validate with defaults
  bun run tools/taskpad-github-regression-contract-parity.ts \\
    --fixtures-doc tests/fixtures/github-regression-fixtures.md \\
    --package package.json

  # Validate with explicit project root
  bun run tools/taskpad-github-regression-contract-parity.ts \\
    --fixtures-doc tests/fixtures/github-regression-fixtures.md \\
    --package package.json \\
    --project-root .

  # Human-readable output
  bun run tools/taskpad-github-regression-contract-parity.ts \\
    --fixtures-doc tests/fixtures/github-regression-fixtures.md \\
    --package package.json \\
    --format human

ALLOWED REFERENCE SURFACES:
  - Test files: tests/templates/github.test.ts, tests/e2e/headless-clip-harness.test.ts
  - Package scripts: Any script in package.json "scripts" section
  - Tool paths: Direct paths to .ts/.js files in tools/ or src/
  - Canonical commands: test:github:reported-failures

CANONICAL COMMAND MAPPINGS:
  - tests/templates/github-regression.test.ts → tests/templates/github.test.ts
  - tests/e2e/headless-clip-harness-regression.test.ts → tests/e2e/headless-clip-harness.test.ts
  - test:github:reported-failures → [keep as-is]

SEVERITY LEVELS:
  - error: Missing or inaccessible references that cause verification failures
  - warning: Stale references that still work but should be updated to canonical form
`);
}

/**
 * Parse CLI arguments.
 */
function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    format: "json",
  };

  const positionalArgs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--format") {
      options.format = argv[++i] as "json" | "human";
      if (options.format !== "json" && options.format !== "human") {
        console.error("Error: --format must be 'json' or 'human'");
        process.exit(1);
      }
      continue;
    }

    if (arg === "--fixtures-doc") {
      options.fixturesDocPath = argv[++i];
      continue;
    }

    if (arg === "--package") {
      options.packagePath = argv[++i];
      continue;
    }

    if (arg === "--project-root") {
      options.projectRoot = argv[++i];
      continue;
    }

    // Positional arguments
    if (!arg.startsWith("--")) {
      positionalArgs.push(arg);
    }
  }

  // Map positional arguments to options
  if (positionalArgs.length >= 1 && !options.fixturesDocPath) {
    options.fixturesDocPath = positionalArgs[0];
  }
  if (positionalArgs.length >= 2 && !options.packagePath) {
    options.packagePath = positionalArgs[1];
  }

  return options;
}

// ============================================================================
// Contract Doc Reference Extraction
// ============================================================================

/**
 * Regex patterns for extracting references from contract documentation.
 * Patterns are designed to be precise and avoid false positives.
 */
const REFERENCE_PATTERNS = {
  /**
   * Test file references in backticks: \`tests/templates/github.test.ts\`
   * Must match tests/ or test/ directory and .test.ts or .spec.ts extension
   */
  testFileInBackticks: /`tests?\/[\w\-./]+\.(?:test|spec)\.(?:ts|js)`/g,

  /**
   * Test file references in command lines: bun test tests/templates/github.test.ts
   * Captures the test file path after "bun test" or "bun run test"
   */
  testFileInCommand: /(?:^|\s)(?:bun|npm|yarn|pnpm)(?:\s+(?:run|test))\s+(tests?\/[\w\-./]+\.(?:test|spec)\.(?:ts|js))(?:\s|$)/gm,

  /**
   * Package script names in commands: bun run typecheck, bun run test:github:reported-failures
   * Captures script names after "bun run", "npm run", etc.
   * Matches patterns like: script-name, test:something, verify:something, etc.
   */
  packageScriptInCommand: /(?:^|\s)(?:bun|npm|yarn|pnpm)\s+run\s+([\w\-:]+)(?:\s|$)/gm,

  /**
   * Tool path references in backticks: \`tools/taskpad-planned-command-parity.ts\`
   * Must match tools/ or src/ directory and .ts or .js extension
   */
  toolPathInBackticks: /`(?:tools|src)\/[\w\-./]+\.(?:ts|js)`/g,

  /**
   * Deprecated/stale test file references that should map to canonical paths
   */
  deprecatedTestFile: /tests\/templates\/github-regression\.test\.ts|tests\/e2e\/headless-clip-harness-regression\.test\.ts/g,

  /**
   * Full command lines in bash code blocks
   * Used to extract test file and script references from shell commands
   */
  bashCommand: /^\s*(?:#.*\n)?\s*(bun|npm|yarn|pnpm)\s+(?:run\s+)?[\w\s\-:./]+/gm,
} as const;

/**
 * Track context while parsing to avoid duplicate extractions.
 */
interface ParseContext {
  /** Current line being parsed */
  lineNumber: number;
  /** Whether we're inside a bash code fence */
  inBashFence: boolean;
  /** Whether the current line is a shell prompt (starts with $) */
  isShellPrompt: boolean;
  /** References already extracted on this line (to avoid duplicates) */
  extractedOnLine: Set<string>;
}

/**
 * Normalizes a test file path by:
 * 1. Removing backticks
 * 2. Removing leading/trailing whitespace
 * 3. Normalizing path separators (forward slashes)
 * 4. No case conversion (preserves original case)
 */
export function normalizeTestFilePath(path: string): string {
  let normalized = path.trim();
  normalized = normalized.replace(/^`|`$/g, "");
  normalized = normalized.replace(/\s+/g, "");
  return normalized;
}

/**
 * Normalizes a command by:
 * 1. Stripping execution prefixes (bun run, npm run, bun test, etc.)
 * 2. Extracting the script name or test file
 * 3. Collapsing multiple spaces
 * 4. Trimming whitespace
 *
 * Examples:
 * - "bun run typecheck" -> "typecheck"
 * - "bun test tests/templates/github.test.ts" -> "tests/templates/github.test.ts"
 * - "npm run test:github:reported-failures" -> "test:github:reported-failures"
 */
export function normalizeCommand(command: string): string {
  let normalized = command.trim();

  // Strip execution prefixes
  const prefixes = [
    /^bun\s+run\s+/i,
    /^bun\s+test\s+/i,
    /^npm\s+run\s+/i,
    /^npm\s+test\s+/i,
    /^yarn\s+test\s+/i,
    /^yarn\s+/i,
    /^pnpm\s+run\s+/i,
    /^pnpm\s+test\s+/i,
  ];

  for (const prefix of prefixes) {
    normalized = normalized.replace(prefix, "");
  }

  // Collapse multiple spaces and trim
  normalized = normalized.replace(/\s+/g, " ").trim();

  return normalized;
}

/**
 * Determines if a normalized string looks like a test file path.
 * Test files are in tests/ or test/ directories and have .test.ts or .spec.ts extension.
 */
export function isTestFilePath(normalized: string): boolean {
  return /^(tests?\/[\w\-./]+\.(?:test|spec)\.(?:ts|js))$/.test(normalized);
}

/**
 * Determines if a normalized string looks like a package script name.
 * Package scripts follow naming conventions like: script-name, test:*, verify:*, etc.
 */
export function isPackageScriptName(normalized: string): boolean {
  // Script names don't contain slashes (not file paths)
  if (normalized.includes("/")) {
    return false;
  }

  // Match common script naming patterns
  return /^[\w\-:]+$/.test(normalized) &&
         !/\.(test|spec)\.(ts|js)$/.test(normalized) && // Not a test file
         !/^(tests?|tools|src|\.?\.?\/)/.test(normalized); // Not a directory path
}

/**
 * Classifies a normalized reference as test-file, package-script, or tool-path.
 */
export function classifyReference(normalized: string): ReferenceType {
  if (isTestFilePath(normalized)) {
    return "test-file";
  }
  if (isPackageScriptName(normalized)) {
    return "package-script";
  }
  if (/^(?:tools|src)\//.test(normalized)) {
    return "tool-path";
  }
  // Default to package-script for unknown script-like strings
  if (/^[\w\-:]+$/.test(normalized)) {
    return "package-script";
  }
  return "test-file"; // Default fallback
}

/**
 * Extract all references from GitHub regression contract documentation.
 * Uses precise regex patterns and contextual analysis to avoid false positives.
 *
 * @param docPath - Path to the contract document
 * @param docContent - Full content of the contract document
 * @returns ContractDocAnalysis with extracted references and metadata
 */
export function extractContractReferences(
  docPath: string,
  docContent: string
): ContractDocAnalysis {
  const references: ContractReference[] = [];
  const lines = docContent.split("\n");

  const context: ParseContext = {
    lineNumber: 0,
    inBashFence: false,
    isShellPrompt: false,
    extractedOnLine: new Set(),
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    context.lineNumber = i + 1;
    context.isShellPrompt = line.trim().startsWith("$");
    context.extractedOnLine.clear();

    // Track code block boundaries
    const trimmedLine = line.trim();
    if (trimmedLine === "```bash") {
      context.inBashFence = true;
      continue;
    }
    if (trimmedLine === "```") {
      context.inBashFence = false;
      continue;
    }

    // Skip comment lines in bash blocks
    if (context.inBashFence && trimmedLine.startsWith("#")) {
      continue;
    }

    // Helper to add a reference if not already extracted on this line
    const addReference = (
      rawRef: string,
      normalizedRef: string,
      refType: ReferenceType,
      sourceContext: ContractReference["sourceContext"]
    ) => {
      const dedupeKey = `${normalizedRef}:${refType}`;
      if (context.extractedOnLine.has(dedupeKey)) {
        return; // Skip duplicate
      }
      context.extractedOnLine.add(dedupeKey);

      references.push({
        lineNumber: context.lineNumber,
        rawReference: rawRef,
        normalizedReference: normalizedRef,
        referenceType: refType,
        sourceContext,
      });
    };

    // Extract test file references in backticks
    const testFileBacktickPattern = new RegExp(REFERENCE_PATTERNS.testFileInBackticks);
    let match: RegExpExecArray | null;
    while ((match = testFileBacktickPattern.exec(line)) !== null) {
      const rawRef = match[0];
      const normalizedRef = normalizeTestFilePath(rawRef);
      addReference(
        rawRef,
        normalizedRef,
        "test-file",
        context.inBashFence ? "code-block" : "inline-text"
      );
    }

    // Extract test file references from commands (inside or outside bash blocks)
    const testFileCommandPattern = new RegExp(REFERENCE_PATTERNS.testFileInCommand);
    while ((match = testFileCommandPattern.exec(line)) !== null) {
      const fullMatch = match[0];
      const testFilePath = match[1];
      const normalizedRef = normalizeTestFilePath(testFilePath);
      addReference(
        fullMatch,
        normalizedRef,
        "test-file",
        context.inBashFence ? "code-block" : context.isShellPrompt ? "shell-prompt" : "inline-text"
      );
    }

    // Extract package script references from commands
    const scriptPattern = new RegExp(REFERENCE_PATTERNS.packageScriptInCommand);
    while ((match = scriptPattern.exec(line)) !== null) {
      const fullMatch = match[0];
      const scriptName = match[1];
      const normalizedRef = normalizeCommand(scriptName);
      addReference(
        fullMatch,
        normalizedRef,
        "package-script",
        context.inBashFence ? "code-block" : context.isShellPrompt ? "shell-prompt" : "inline-text"
      );
    }

    // Extract tool path references in backticks
    const toolPathPattern = new RegExp(REFERENCE_PATTERNS.toolPathInBackticks);
    while ((match = toolPathPattern.exec(line)) !== null) {
      const rawRef = match[0];
      const normalizedRef = rawRef.replace(/`/g, "").trim();
      addReference(
        rawRef,
        normalizedRef,
        "tool-path",
        context.inBashFence ? "code-block" : "inline-text"
      );
    }

    // Check for deprecated test references (will be validated later)
    const deprecatedPattern = new RegExp(REFERENCE_PATTERNS.deprecatedTestFile);
    while ((match = deprecatedPattern.exec(line)) !== null) {
      const rawRef = match[0];
      const normalizedRef = rawRef;
      // Add as test-file reference for validation
      addReference(
        rawRef,
        normalizedRef,
        "test-file",
        context.inBashFence ? "code-block" : "inline-text"
      );
    }
  }

  // Sort references by line number for deterministic output
  references.sort((a, b) => a.lineNumber - b.lineNumber);

  // Count references by type
  const referenceCounts = {
    testFiles: references.filter(r => r.referenceType === "test-file").length,
    verificationCommands: references.filter(r => r.referenceType === "package-script").length,
    packageScripts: references.filter(r => r.referenceType === "package-script").length,
    toolPaths: references.filter(r => r.referenceType === "tool-path").length,
  };

  return {
    docPath,
    references,
    referenceCounts,
    totalReferences: references.length,
  };
}

// ============================================================================
// Command Surface Analysis
// ============================================================================

/**
 * Parse package.json to extract script definitions.
 */
export function parsePackageScripts(packageJsonContent: string): Record<string, string> {
  try {
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.scripts || {};
  } catch (error) {
    console.error("Error parsing package.json:", error);
    return {};
  }
}

/**
 * Discover tool paths in the project.
 */
export function discoverToolPaths(projectRoot: string): string[] {
  const toolPaths: string[] = [];

  // Check for tools/ directory
  const toolsPath = resolve(projectRoot, "tools");
  if (existsSync(toolsPath)) {
    // This is a simplified discovery - in a real implementation we'd recursively scan
    const knownTools = [
      "taskpad-planned-command-parity.ts",
      "taskpad-auto-ideation.ts",
      "taskpad-plan-seed.ts",
      "taskpad-verification-pack.ts",
    ];
    knownTools.forEach(tool => {
      const toolPath = resolve(toolsPath, tool);
      if (existsSync(toolPath)) {
        toolPaths.push(`tools/${tool}`);
      }
    });
  }

  return toolPaths;
}

/**
 * Build command surface from package.json and tool paths.
 */
export function buildCommandSurface(
  packagePath: string,
  projectRoot: string
): CommandSurface {
  const packageContent = readFileSync(packagePath, "utf-8");
  const packageScripts = parsePackageScripts(packageContent);
  const toolPaths = discoverToolPaths(projectRoot);

  return {
    packagePath,
    packageScripts,
    toolPaths,
  };
}

// ============================================================================
// Reference Validation
// ============================================================================

/**
 * Canonical command mappings for deprecated/stale references.
 */
const CANONICAL_COMMAND_MAPPINGS: Record<string, string> = {
  "tests/templates/github-regression.test.ts": "tests/templates/github.test.ts",
  "tests/e2e/headless-clip-harness-regression.test.ts": "tests/e2e/headless-clip-harness.test.ts",
};

/**
 * Validate a single reference against the command surface.
 */
export function validateReference(
  reference: ContractReference,
  commandSurface: CommandSurface,
  projectRoot: string
): ReferenceValidation {
  const { normalizedReference, referenceType } = reference;

  switch (referenceType) {
    case "test-file":
      return validateTestFile(reference, projectRoot);

    case "package-script":
      return validatePackageScript(reference, commandSurface);

    case "tool-path":
      return validateToolPath(reference, projectRoot);

    default:
      return {
        reference,
        valid: false,
        message: `Unsupported reference type: ${referenceType}`,
        remediation: "Use only test-file, package-script, or tool-path reference types",
      };
  }
}

/**
 * Validate a test file reference.
 */
function validateTestFile(
  reference: ContractReference,
  projectRoot: string
): ReferenceValidation {
  const filePath = resolve(projectRoot, reference.normalizedReference);

  // Check if this is a deprecated/stale reference
  if (CANONICAL_COMMAND_MAPPINGS[reference.normalizedReference]) {
    const canonical = CANONICAL_COMMAND_MAPPINGS[reference.normalizedReference];
    const canonicalPath = resolve(projectRoot, canonical);

    return {
      reference,
      valid: false,
      ruleId: RULE_IDS.STALE_TEST_REFERENCE,
      message: `Test file reference is deprecated`,
      remediation: `Update to canonical test file: ${canonical}`,
      canonicalCommand: canonical,
    };
  }

  // Check if file exists
  if (!existsSync(filePath)) {
    return {
      reference,
      valid: false,
      ruleId: RULE_IDS.MISSING_TEST_FILE,
      message: `Test file does not exist: ${reference.normalizedReference}`,
      remediation: `Create the test file or update the reference to an existing file`,
    };
  }

  return {
    reference,
    valid: true,
    message: `Test file exists and is accessible`,
  };
}

/**
 * Validate a package script reference.
 */
function validatePackageScript(
  reference: ContractReference,
  commandSurface: CommandSurface
): ReferenceValidation {
  const { normalizedReference } = reference;

  // Check if script exists in package.json
  if (!(normalizedReference in commandSurface.packageScripts)) {
    return {
      reference,
      valid: false,
      ruleId: RULE_IDS.MISSING_PACKAGE_SCRIPT,
      message: `Package script does not exist: ${normalizedReference}`,
      remediation: `Add the script to package.json "scripts" section or update the reference`,
    };
  }

  return {
    reference,
    valid: true,
    message: `Package script exists and is defined`,
  };
}

/**
 * Validate a tool path reference.
 */
function validateToolPath(
  reference: ContractReference,
  projectRoot: string
): ReferenceValidation {
  const filePath = resolve(projectRoot, reference.normalizedReference);

  if (!existsSync(filePath)) {
    return {
      reference,
      valid: false,
      ruleId: RULE_IDS.MISSING_TOOL_PATH,
      message: `Tool path does not exist: ${reference.normalizedReference}`,
      remediation: `Create the tool file or update the reference to an existing file`,
    };
  }

  return {
    reference,
    valid: true,
    message: `Tool path exists and is accessible`,
  };
}

// ============================================================================
// Parity Validation
// ============================================================================

/**
 * Run full parity validation on contract documentation.
 */
export function runParityValidation(
  docAnalysis: ContractDocAnalysis,
  commandSurface: CommandSurface,
  projectRoot: string
): {
  validations: ReferenceValidation[];
  violations: ParityViolation[];
  summary: ParityValidationSummary;
} {
  const validations: ReferenceValidation[] = [];
  const violations: ParityViolation[] = [];
  const violationCounts: Partial<Record<RuleId, number>> = {};

  // Validate each reference
  docAnalysis.references.forEach(ref => {
    const validation = validateReference(ref, commandSurface, projectRoot);
    validations.push(validation);

    if (!validation.valid && validation.ruleId) {
      const violation: ParityViolation = {
        ruleId: validation.ruleId,
        severity: getSeverityForRule(validation.ruleId),
        docPath: docAnalysis.docPath,
        lineNumber: ref.lineNumber,
        rawReference: ref.rawReference,
        referenceType: ref.referenceType,
        message: validation.message,
        remediation: validation.remediation || "No remediation available",
        canonicalCommand: validation.canonicalCommand,
      };

      violations.push(violation);

      // Count violations by rule ID
      violationCounts[validation.ruleId] = (violationCounts[validation.ruleId] || 0) + 1;
    }
  });

  // Build summary
  const validReferences = validations.filter(v => v.valid).length;
  const invalidReferences = validations.filter(v => !v.valid).length;

  const summary: ParityValidationSummary = {
    totalReferences: validations.length,
    validReferences,
    invalidReferences,
    violationCounts,
    status: invalidReferences === 0 ? "pass" : "fail",
  };

  // Check for no references at all
  if (validations.length === 0) {
    summary.status = "fail";
    const noRefViolation: ParityViolation = {
      ruleId: RULE_IDS.NO_VERIFICATION_REFERENCES,
      severity: "error",
      docPath: docAnalysis.docPath,
      lineNumber: 1,
      rawReference: "",
      referenceType: "test-file",
      message: "No verification references found in contract documentation",
      remediation: "Add test file, package script, or tool path references to the contract doc",
    };
    violations.push(noRefViolation);
    violationCounts[RULE_IDS.NO_VERIFICATION_REFERENCES] = 1;
  }

  return { validations, violations, summary };
}

/**
 * Get severity level for a rule ID.
 */
function getSeverityForRule(ruleId: RuleId): "error" | "warning" {
  const errorRules = [
    RULE_IDS.MISSING_TEST_FILE,
    RULE_IDS.MISSING_VERIFICATION_COMMAND,
    RULE_IDS.MISSING_PACKAGE_SCRIPT,
    RULE_IDS.MISSING_TOOL_PATH,
    RULE_IDS.NO_VERIFICATION_REFERENCES,
    RULE_IDS.UNSUPPORTED_COMMAND_FORMAT,
    RULE_IDS.MALFORMED_REFERENCE,
  ];

  const warningRules = [
    RULE_IDS.STALE_TEST_REFERENCE,
    RULE_IDS.MISSING_COMMAND_MAPPING,
    RULE_IDS.CANONICAL_COMMAND_MISMATCH,
  ];

  if (errorRules.includes(ruleId)) {
    return "error";
  }
  if (warningRules.includes(ruleId)) {
    return "warning";
  }

  return "error"; // Default to error for unknown rules
}

/**
 * Sort violations in canonical order.
 */
export function sortViolationsCanonical(violations: ParityViolation[]): ParityViolation[] {
  return [...violations].sort((a, b) => {
    const aIndex = CANONICAL_VIOLATION_ORDER.indexOf(a.ruleId);
    const bIndex = CANONICAL_VIOLATION_ORDER.indexOf(b.ruleId);

    // Both in canonical order
    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }

    // One in canonical order
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    // Neither in canonical order - sort by rule ID string
    return a.ruleId.localeCompare(b.ruleId);
  });
}

// ============================================================================
// Report Formatting
// ============================================================================

/**
 * Format parity report as human-readable text.
 */
function formatHumanReport(report: ParityReport): string {
  const lines: string[] = [];

  lines.push("GitHub Regression Contract Parity Report");
  lines.push("=" .repeat(60));
  lines.push("");

  lines.push(`Status: ${report.status.toUpperCase()}`);
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push("");

  lines.push("Inputs:");
  lines.push(`  Fixtures Doc: ${report.inputs.fixturesDocPath}`);
  lines.push(`  Package: ${report.inputs.packagePath}`);
  lines.push(`  Project Root: ${report.inputs.projectRoot}`);
  lines.push("");

  lines.push("Summary:");
  lines.push(`  Total References: ${report.summary.totalReferences}`);
  lines.push(`  Valid References: ${report.summary.validReferences}`);
  lines.push(`  Invalid References: ${report.summary.invalidReferences}`);
  lines.push("");

  if (report.summary.invalidReferences > 0) {
    lines.push("Violations:");
    lines.push("");

    const sortedViolations = sortViolationsCanonical(report.violations);
    sortedViolations.forEach((violation, index) => {
      lines.push(`${index + 1}. ${violation.ruleId} [${violation.severity.toUpperCase()}]`);
      lines.push(`   Location: ${violation.docPath}:${violation.lineNumber}`);
      lines.push(`   Reference: ${violation.rawReference}`);
      lines.push(`   Type: ${violation.referenceType}`);
      lines.push(`   Message: ${violation.message}`);
      lines.push(`   Remediation: ${violation.remediation}`);
      if (violation.canonicalCommand) {
        lines.push(`   Canonical: ${violation.canonicalCommand}`);
      }
      lines.push("");
    });
  }

  if (report.status === "pass") {
    lines.push("✅ All references pass parity validation");
  } else {
    lines.push("❌ Parity validation failed");
  }

  return lines.join("\n");
}

/**
 * Format parity report as JSON.
 */
function formatJsonReport(report: ParityReport): string {
  return JSON.stringify(report, null, 2);
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main function for CLI execution.
 */
function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // Validate required arguments
  if (!args.fixturesDocPath || !args.packagePath) {
    console.error("Error: --fixtures-doc and --package are required");
    console.error("Run with --help for usage information");
    process.exit(1);
  }

  // Resolve paths
  const fixturesDocPath = resolve(args.fixturesDocPath);
  const packagePath = resolve(args.packagePath);
  const projectRoot = args.projectRoot ? resolve(args.projectRoot) : resolve(packagePath, "..");

  // Validate files exist
  if (!existsSync(fixturesDocPath)) {
    console.error(`Error: Fixtures doc does not exist: ${fixturesDocPath}`);
    process.exit(1);
  }

  if (!existsSync(packagePath)) {
    console.error(`Error: package.json does not exist: ${packagePath}`);
    process.exit(1);
  }

  // Extract contract doc references
  const docContent = readFileSync(fixturesDocPath, "utf-8");
  const docAnalysis = extractContractReferences(fixturesDocPath, docContent);

  // Build command surface
  const commandSurface = buildCommandSurface(packagePath, projectRoot);

  // Run parity validation
  const { validations, violations, summary } = runParityValidation(
    docAnalysis,
    commandSurface,
    projectRoot
  );

  // Build report
  const report: ParityReport = {
    status: summary.status,
    inputs: {
      fixturesDocPath,
      packagePath,
      projectRoot,
    },
    docAnalysis,
    commandSurface,
    validations,
    summary,
    violations: sortViolationsCanonical(violations),
    timestamp: new Date().toISOString(),
  };

  // Format and output report
  if (args.format === "human") {
    console.log(formatHumanReport(report));
  } else {
    console.log(formatJsonReport(report));
  }

  // Exit with appropriate code
  process.exit(summary.status === "pass" ? 0 : 1);
}

// Run main if this is the entry point
if (import.meta.main) {
  main();
}
