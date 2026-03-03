#!/usr/bin/env bun

/**
 * Pilot Price Signal Analyzer
 *
 * Analyzes pilot response artifacts to compute deterministic price-bucket telemetry
 * and recommend the next anchor price point for testing.
 *
 * Usage:
 *   bun run pilot:price-signal -- \
 *     --root docs/distribution \
 *     --brief OFFER_BRIEF.md \
 *     --format json
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

// ============================================================================
// Error Codes
// ============================================================================

const ERROR_CODES = {
  INVALID_ROOT: { code: "INVALID_ROOT", exit: 1 },
  INVALID_BRIEF: { code: "INVALID_BRIEF", exit: 2 },
  NO_BATCHES_FOUND: { code: "NO_BATCHES_FOUND", exit: 3 },
  WTP_OUT_OF_RANGE: { code: "WTP_OUT_OF_RANGE", exit: 4 },
  MISSING_WTP_VALUE: { code: "MISSING_WTP_VALUE", exit: 5 },
  INVALID_WTP_VALUE: { code: "INVALID_WTP_VALUE", exit: 6 },
  PARSE_ERROR: { code: "PARSE_ERROR", exit: 7 },
} as const;

function exitWithError(
  errorKey: keyof typeof ERROR_CODES,
  message: string
): never {
  const error = ERROR_CODES[errorKey];
  console.error(`Error [${error.code}]: ${message}`);
  process.exit(error.exit);
}

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed frontmatter from markdown files
 */
interface ParsedFrontmatter {
  artifact?: string;
  batch?: string;
  [key: string]: string | number | boolean | string[] | undefined;
}

/**
 * Response log row schema (parsed from pilot-response-log.md)
 */
interface ResponseLogRow {
  recipient: string;
  sourceChannel: string;
  workflowSentence: string;
  objectionType: string;
  wtp: string | number;
  nextStepDecision: string;
  decisionRationale: string;
  responseState: string;
}

/**
 * Price bucket enumeration
 */
type PriceBucket = "$8-$11" | "$12" | "$13-$15" | "$16-$19";

/**
 * Pilot YES rate by bucket
 */
interface PilotYesRate {
  yes: number;
  total: number;
  rate: number;
}

/**
 * Telemetry payload
 */
interface TelemetryPayload {
  priceBucketCounts: Record<PriceBucket, number>;
  pilotYesRateByBucket: Record<PriceBucket, PilotYesRate>;
  medianWTP: number;
  objectionMix: Record<string, number>;
}

/**
 * Recommendation payload
 */
interface RecommendationPayload {
  recommendedNextAnchor: number;
  anchorContext: "baseline" | "lower" | "higher";
  rationale: string;
  precedenceChain: string[];
}

/**
 * Confidence band payload
 */
interface ConfidencePayload {
  band: "low" | "medium" | "high";
  level: number;
  minimumSampleMet: boolean;
  sampleSize: number;
  reasoning: string;
}

/**
 * Deterministic command output envelope
 */
interface PriceSignalOutput {
  status: "ok" | "error";
  inputs: {
    rootPath: string;
    briefPath: string;
    batchesAnalyzed: string[];
    totalResponses: number;
  };
  telemetry: TelemetryPayload;
  recommendation: RecommendationPayload;
  confidence: ConfidencePayload;
  diagnostics: Array<{
    ruleId: string;
    batch?: string;
    recipient?: string;
    message: string;
  }>;
  timestamp: string;
}

/**
 * CLI argument structure
 */
interface CliArgs {
  rootPath?: string;
  briefPath?: string;
  format?: "json" | "human";
  help: boolean;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function printHelp(): void {
  console.log(`
Pilot Price Signal Analyzer

Analyzes pilot response artifacts to compute deterministic price-bucket telemetry
and recommend the next anchor price point for testing.

USAGE:
  bun run pilot:price-signal -- \\
    --root docs/distribution \\
    --brief OFFER_BRIEF.md \\
    --format json

OPTIONS:
  --root <path>       Path to distribution root containing pilot batch directories (required)
  --brief <path>      Path to OFFER_BRIEF.md file containing pricing constraints (required)
  --format <format>   Output format: "json" or "human" (default: json)
  --help, -h          Show this help message

OUTPUT:
  Deterministic JSON with telemetry, recommendation, and confidence fields:
  - inputs: Root path, brief path, batches analyzed, total responses
  - telemetry: Price bucket counts, PILOT YES rates, median WTP, objection mix
  - recommendation: Recommended next anchor, anchor context, rationale, precedence chain
  - confidence: Confidence band, level, minimum sample status, reasoning
  - diagnostics: Validation errors/warnings (empty if all WTP values valid)

ERROR CODES:
  1  INVALID_ROOT        - Root path not found or not a directory
  2  INVALID_BRIEF       - OFFER_BRIEF.md file not found
  3  NO_BATCHES_FOUND    - No pilot batch directories found under root
  4  WTP_OUT_OF_RANGE    - WTP value outside allowed range ($8-$19)
  5  MISSING_WTP_VALUE    - Response row missing WTP value
  6  INVALID_WTP_VALUE    - WTP value is not a valid number
  7  PARSE_ERROR          - Error parsing pilot artifacts

EXAMPLES:
  # Analyze price signals with JSON output
  bun run pilot:price-signal -- \\
    --root docs/distribution \\
    --brief OFFER_BRIEF.md \\
    --format json

  # Human-readable output
  bun run pilot:price-signal -- \\
    --root docs/distribution \\
    --brief OFFER_BRIEF.md \\
    --format human

DETERMINISTIC BUCKET POLICY:
  Price buckets partition OFFER_BRIEF.md test range ($8-$19/mo):
  - $8-$11:  8 ≤ WTP < 12 (below anchor)
  - $12:     11.5 ≤ WTP < 12.5 (anchor price point)
  - $13-$15: 12.5 ≤ WTP < 15.5 (above anchor, mid-high)
  - $16-$19: 15.5 ≤ WTP ≤ 20 (above anchor, high)

  Tie-break ordering (highest to lowest priority):
  1. Sample size (prefer bucket with higher total responses)
  2. Anchor familiarity (prefer $12 anchor bucket)
  3. Proximity to anchor (prefer bucket closer to $12)
  4. Alphabetical bucket label

  Confidence bands:
  - low: n < 5 (preliminary signal)
  - medium: n >= 5 with >=2 buckets represented
  - high: n >= 10 with all buckets or dominant bucket n >= 5

  See README.md for complete bucket policy and confidence semantics.
`);
}

/**
 * Parse command-line arguments into a structured CliArgs object.
 * Validates that required arguments are present and paths exist.
 */
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--root") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --root");
        process.exit(1);
      }
      args.rootPath = value;
      continue;
    }

    if (arg === "--brief") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --brief");
        process.exit(1);
      }
      args.briefPath = value;
      continue;
    }

    if (arg === "--format") {
      i++;
      const value = argv[i];
      if (!value) {
        console.error("Missing value for --format");
        process.exit(1);
      }
      if (value !== "json" && value !== "human") {
        console.error(`Invalid format: ${value}. Must be "json" or "human"`);
        process.exit(1);
      }
      args.format = value;
      continue;
    }

    // Unknown argument
    if (arg.startsWith("--")) {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  return args;
}

/**
 * Validate that required file/directory paths exist.
 */
function validatePaths(args: CliArgs): void {
  if (!args.rootPath) {
    console.error("Error: --root is required");
    printHelp();
    process.exit(ERROR_CODES.INVALID_ROOT.exit);
  }

  if (!args.briefPath) {
    console.error("Error: --brief is required");
    printHelp();
    process.exit(ERROR_CODES.INVALID_BRIEF.exit);
  }

  const resolvedRootPath = resolve(args.rootPath);
  if (!existsSync(resolvedRootPath)) {
    console.error(`Error: Root path does not exist: ${resolvedRootPath}`);
    process.exit(ERROR_CODES.INVALID_ROOT.exit);
  }

  const rootStats = statSync(resolvedRootPath);
  if (!rootStats.isDirectory()) {
    console.error(`Error: Root path is not a directory: ${resolvedRootPath}`);
    process.exit(ERROR_CODES.INVALID_ROOT.exit);
  }

  const resolvedBriefPath = resolve(args.briefPath);
  if (!existsSync(resolvedBriefPath)) {
    console.error(`Error: Brief file does not exist: ${resolvedBriefPath}`);
    process.exit(ERROR_CODES.INVALID_BRIEF.exit);
  }
}

// ============================================================================
// Frontmatter Parsing
// ============================================================================

/**
 * Parse frontmatter from markdown content.
 */
function parseFrontmatter(content: string): {
  frontmatter: ParsedFrontmatter;
  body: string;
} {
  const lines = content.split("\n");

  // Check if file starts with frontmatter
  if (lines[0] !== "---") {
    return { frontmatter: {}, body: content };
  }

  // Find the closing ---
  let endLine = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      endLine = i;
      break;
    }
  }

  if (endLine === -1) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterLines = lines.slice(1, endLine);
  const body = lines.slice(endLine + 1).join("\n");

  const frontmatter: ParsedFrontmatter = {};

  for (const line of frontmatterLines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: string | number | boolean | string[] = line
      .slice(colonIndex + 1)
      .trim();

    // Handle arrays
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      if (inner === "") {
        frontmatter[key] = [];
        continue;
      }
      // Simple array parsing (comma-separated, quoted strings)
      const items = inner
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
      frontmatter[key] = items;
      continue;
    }

    // Handle booleans
    if (value === "true") {
      frontmatter[key] = true;
      continue;
    }
    if (value === "false") {
      frontmatter[key] = false;
      continue;
    }

    // Handle numbers
    const num = Number(value);
    if (!isNaN(num) && value !== "") {
      frontmatter[key] = num;
      continue;
    }

    // Handle quoted strings
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

// ============================================================================
// Markdown Table Parsing
// ============================================================================

/**
 * Parse markdown table from body content.
 */
function parseMarkdownTable(body: string): string[][] {
  const lines = body.split("\n");
  const rows: string[][] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Skip header separator (e.g., | --- | --- |)
    if (trimmed.match(/^\|[\s\-:|]+\|$/)) continue;

    // Check if line looks like a table row
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      // Split by | and remove first/last empty elements
      const allParts = trimmed.split("|");
      // Remove first and last elements (empty strings before first | and after last |)
      const cells = allParts
        .slice(1, -1)
        .map((cell) => {
          // Trim whitespace
          let value = cell.trim();
          // Strip backticks if present (markdown code formatting)
          if (value.startsWith("`") && value.endsWith("`")) {
            value = value.slice(1, -1);
          }
          return value;
        });

      // Only add if we have cells
      if (cells.length > 0) {
        rows.push(cells);
      }
    }
  }

  return rows;
}

// ============================================================================
// Artifact Discovery (TP003)
// ============================================================================

/**
 * Discover pilot batch directories under the distribution root.
 *
 * Batch directories are expected to be named like "first-pilot-2026-02"
 * and contain pilot-response-log.md files.
 *
 * Discovery rules:
 * - Only directories are considered
 * - Must contain pilot-response-log.md in the directory
 * - Hidden directories (starting with .) are ignored
 * - Results are sorted alphabetically for determinism
 *
 * @param rootPath - Path to distribution root directory
 * @returns Array of batch directory names (sorted alphabetically for determinism)
 */
function discoverBatches(rootPath: string): string[] {
  const entries = readdirSync(rootPath, { withFileTypes: true });
  const batches: string[] = [];

  for (const entry of entries) {
    // Skip hidden directories
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory()) continue;

    // Check if directory contains pilot-response-log.md
    const responseLogPath = join(rootPath, entry.name, "pilot-response-log.md");
    if (existsSync(responseLogPath)) {
      batches.push(entry.name);
    }
  }

  // Sort alphabetically for deterministic ordering
  return batches.sort((a, b) => a.localeCompare(b));
}

// ============================================================================
// Artifact Loader (TP003)
// ============================================================================

/**
 * Load all pilot response log artifacts from discovered batches.
 *
 * For each discovered batch, this function:
 * 1. Reads the pilot-response-log.md file
 * 2. Parses the markdown table into structured rows with WTP validation
 * 3. Collects parsing errors with batch context
 * 4. Returns all rows and errors aggregated across batches
 *
 * @param rootPath - Path to distribution root directory
 * @param batches - Array of batch directory names (from discoverBatches)
 * @param wtpRange - Allowed WTP range from OFFER_BRIEF.md for validation
 * @returns Object containing all rows and any parsing errors
 */
function loadResponseLogArtifacts(
  rootPath: string,
  batches: string[],
  wtpRange: WTPRange
): {
  rows: ResponseLogRow[];
  errors: Array<{
    ruleId: string;
    batch: string;
    message: string;
    recipient?: string;
  }>;
} {
  const allRows: ResponseLogRow[] = [];
  const allErrors: Array<{
    ruleId: string;
    batch: string;
    message: string;
    recipient?: string;
  }> = [];

  for (const batch of batches) {
    const responseLogPath = join(rootPath, batch, "pilot-response-log.md");

    if (!existsSync(responseLogPath)) {
      allErrors.push({
        ruleId: "MISSING_RESPONSE_LOG",
        batch,
        message: `Response log file not found: ${responseLogPath}`,
      });
      continue;
    }

    let responseLogContent: string;
    try {
      responseLogContent = readFileSync(responseLogPath, "utf-8");
    } catch (err) {
      allErrors.push({
        ruleId: "READ_ERROR",
        batch,
        message: `Failed to read response log: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
      continue;
    }

    const { rows, errors } = parseResponseLog(responseLogContent, responseLogPath, wtpRange);

    // Add batch context to each row
    const rowsWithBatch = rows.map((row) => ({
      ...row,
      _batch: batch, // Add batch metadata for traceability
    }));

    allRows.push(...rowsWithBatch);

    // Add batch context to errors
    for (const error of errors) {
      allErrors.push({
        ...error,
        batch,
      });
    }
  }

  return { rows: allRows, errors: allErrors };
}

// ============================================================================
// Response Row Normalization (TP003)
// ============================================================================

/**
 * Normalize response log rows for pricing analysis.
 *
 * Normalization rules (deterministic):
 * 1. Filter to only candidate rows (those with actual WTP values, not "no response yet")
 * 2. Trim whitespace from all string fields
 * 3. Normalize channel names (e.g., "X DM" → "X DM" as-is)
 * 4. Normalize WTP values:
 *    - Numeric strings are converted to numbers
 *    - "no response yet" is excluded from candidates
 *    - Missing/empty values are excluded
 * 5. Normalize decision state (lowercase, trim)
 * 6. Sort rows deterministically:
 *    - Primary: Alphabetical by recipient
 *    - Secondary: Alphabetical by batch name
 *
 * Candidate rows for pricing analysis must meet ALL of:
 * - WTP is a number (not "no response yet", not empty)
 * - WTP is within valid range (will be validated in TP004)
 * - Response state is not "no response yet"
 *
 * @param rows - Array of parsed response log rows
 * @returns Normalized candidate rows suitable for pricing analysis
 */
function normalizeResponseRowsForPricingAnalysis(
  rows: ResponseLogRow[]
): {
  candidates: ResponseLogRow[];
  excluded: Array<{
    row: ResponseLogRow;
    reason: string;
  }>;
} {
  const candidates: ResponseLogRow[] = [];
  const excluded: Array<{
    row: ResponseLogRow;
    reason: string;
  }> = [];

  for (const row of rows) {
    // Extract batch metadata if present
    const batch = (row as any)._batch;

    // Check if row is a candidate for pricing analysis
    let isCandidate = true;
    let excludeReason = "";

    // Rule 1: WTP must be a number (not "no response yet")
    if (typeof row.wtp !== "number") {
      if (row.wtp === "no response yet" || row.wtp === "" || row.wtp === "N/A") {
        isCandidate = false;
        excludeReason = "WTP_NOT_NUMERIC";
      } else {
        // Try to parse as number
        const parsed = parseFloat(row.wtp as string);
        if (isNaN(parsed)) {
          isCandidate = false;
          excludeReason = "WTP_INVALID";
        } else {
          // Replace with parsed number
          row.wtp = parsed;
        }
      }
    }

    // Rule 2: Response state should not be "no response yet"
    if (row.responseState === "no response yet") {
      isCandidate = false;
      excludeReason = "NO_RESPONSE";
    }

    // Normalize string fields for candidates
    if (isCandidate) {
      candidates.push({
        recipient: row.recipient.trim(),
        sourceChannel: row.sourceChannel.trim(),
        workflowSentence: row.workflowSentence.trim(),
        objectionType: row.objectionType.trim(),
        wtp: row.wtp,
        nextStepDecision: row.nextStepDecision.trim().toLowerCase(),
        decisionRationale: row.decisionRationale.trim(),
        responseState: row.responseState.trim().toLowerCase(),
      });
    } else {
      excluded.push({
        row,
        reason: excludeReason,
      });
    }
  }

  // Sort candidates deterministically
  // Primary: Alphabetical by recipient
  // Secondary: Alphabetical by batch name (if available)
  candidates.sort((a, b) => {
    const recipientCompare = a.recipient.localeCompare(b.recipient);
    if (recipientCompare !== 0) {
      return recipientCompare;
    }

    // Secondary sort by batch
    const batchA = (a as any)._batch || "";
    const batchB = (b as any)._batch || "";
    return batchA.localeCompare(batchB);
  });

  return { candidates, excluded };
}

/**
 * Normalize WTP values from response log rows.
 *
 * This function handles various WTP formats and converts them to numeric values:
 * - Numeric strings: "12" → 12
 * - Strings with currency: "$12" → 12
 * - Strings with decimals: "12.50" → 12.50
 *
 * Invalid WTP values return NaN and should be filtered out.
 *
 * @param wtpValue - WTP value from response log (string or number)
 * @returns Normalized numeric WTP value, or NaN if invalid
 */
function normalizeWTPValue(wtpValue: string | number): number {
  if (typeof wtpValue === "number") {
    return isNaN(wtpValue) ? NaN : wtpValue;
  }

  // Trim whitespace
  const trimmed = wtpValue.trim();

  // Handle special values
  if (trimmed === "" || trimmed === "no response yet" || trimmed === "N/A") {
    return NaN;
  }

  // Remove currency symbols and commas
  const cleaned = trimmed.replace(/[$,]/g, "");

  // Parse as number
  const parsed = parseFloat(cleaned);

  return isNaN(parsed) ? NaN : parsed;
}

// ============================================================================
// OFFER_BRIEF Parsing (TP004)
// ============================================================================

/**
 * WTP range extracted from OFFER_BRIEF.md
 */
interface WTPRange {
  min: number;
  max: number;
  source: string;
}

/**
 * Parse OFFER_BRIEF.md to extract WTP allowed range.
 *
 * Extracts:
 * - min: Minimum WTP value (e.g., 8 from "$8-$19")
 * - max: Maximum WTP value (e.g., 19 from "$8-$19")
 * - source: Source reference for traceability
 *
 * Pattern matching:
 * - Pricing Hypothesis section: "Acceptable test range: **$8-$19/mo**"
 * - Pilot CTA section: "price you'd pay in $/mo from $8-$19"
 */
function parseOfferBriefWTPRange(content: string, filePath: string): WTPRange {
  // Pattern 1: Pricing Hypothesis - Acceptable test range
  // Example: "Acceptable test range: **$8-$19/mo**"
  const pricingPattern = /Acceptable test range:\s*\*?\$(\d+)\s*-\s*\$(\d+)\//i;
  const pricingMatch = content.match(pricingPattern);

  if (pricingMatch) {
    const min = parseInt(pricingMatch[1], 10);
    const max = parseInt(pricingMatch[2], 10);

    if (!isNaN(min) && !isNaN(max)) {
      return {
        min,
        max,
        source: `${filePath}#pricing-hypothesis`,
      };
    }
  }

  // Pattern 2: Pilot CTA - WTP range
  // Example: "price you'd pay in $/mo from $8-$19"
  const ctaPattern = /\$(\d+)\s*-\s*\$(\d+)\)/i;
  const ctaMatch = content.match(ctaPattern);

  if (ctaMatch) {
    const min = parseInt(ctaMatch[1], 10);
    const max = parseInt(ctaMatch[2], 10);

    if (!isNaN(min) && !isNaN(max)) {
      return {
        min,
        max,
        source: `${filePath}#pilot-cta`,
      };
    }
  }

  // Default fallback to pilot range if patterns fail
  return {
    min: 8,
    max: 19,
    source: `${filePath}#default`,
  };
}

// ============================================================================
// WTP Extraction/Validation (TP004)
// ============================================================================

/**
 * Result of WTP extraction and validation
 */
interface WTPValidationResult {
  valid: boolean;
  numericValue?: number;
  ruleId?: "MISSING_WTP_VALUE" | "INVALID_WTP_VALUE" | "WTP_OUT_OF_RANGE";
  message?: string;
}

/**
 * Extract and validate WTP value from response log row.
 *
 * Validation rules (in order):
 * 1. MISSING_WTP_VALUE: WTP is missing, empty, or is "no response yet"
 * 2. INVALID_WTP_VALUE: WTP is present but not parseable as a number
 * 3. WTP_OUT_OF_RANGE: WTP is numeric but outside the allowed range
 *
 * @param wtpValue - WTP value from response log (string or number)
 * @param wtpRange - Allowed WTP range from OFFER_BRIEF.md
 * @returns Validation result with numeric value if valid, or error rule ID
 */
function validateWTPValue(
  wtpValue: string | number,
  wtpRange: WTPRange
): WTPValidationResult {
  // Rule 1: Check for missing WTP value
  if (wtpValue === undefined || wtpValue === null) {
    return {
      valid: false,
      ruleId: "MISSING_WTP_VALUE",
      message: "WTP value is missing from response row",
    };
  }

  // Convert to string for consistent handling
  const wtpStr = String(wtpValue).trim();

  // Check for "no response yet" or empty values
  if (
    wtpStr === "" ||
    wtpStr.toLowerCase() === "no response yet" ||
    wtpStr === "N/A"
  ) {
    return {
      valid: false,
      ruleId: "MISSING_WTP_VALUE",
      message: `WTP value indicates no response: "${wtpStr}"`,
    };
  }

  // Remove currency symbols and commas
  const cleaned = wtpStr.replace(/[$,]/g, "");

  // Rule 2: Parse as number
  const numericValue = parseFloat(cleaned);

  if (isNaN(numericValue)) {
    return {
      valid: false,
      ruleId: "INVALID_WTP_VALUE",
      message: `WTP value is not a valid number: "${wtpStr}"`,
    };
  }

  // Rule 3: Check range
  if (numericValue < wtpRange.min || numericValue > wtpRange.max) {
    return {
      valid: false,
      ruleId: "WTP_OUT_OF_RANGE",
      message: `WTP value $${numericValue} is outside allowed range ($${wtpRange.min}-$${wtpRange.max})`,
    };
  }

  return {
    valid: true,
    numericValue,
  };
}

// ============================================================================
// Response Log Parsing (TP004)
// ============================================================================

/**
 * Parse pilot-response-log markdown file into structured rows with WTP validation.
 *
 * This function parses the response log table and validates WTP values against
 * the allowed range from OFFER_BRIEF.md. WTP validation errors are emitted
 * as diagnostics with actionable rule IDs and row pointers.
 *
 * @param content - Response log markdown content
 * @param filePath - Path to response log file (for error context)
 * @param wtpRange - Allowed WTP range from OFFER_BRIEF.md
 * @returns Parsed rows and validation errors with rule IDs
 */
function parseResponseLog(
  content: string,
  filePath: string,
  wtpRange: WTPRange
): {
  rows: ResponseLogRow[];
  errors: Array<{ ruleId: string; message: string; recipient?: string; batch?: string }>;
} {
  const { frontmatter, body } = parseFrontmatter(content);
  const errors: Array<{ ruleId: string; message: string; recipient?: string; batch?: string }> = [];

  // Validate frontmatter
  if (frontmatter.artifact !== "pilot-response-log") {
    errors.push({
      ruleId: "INVALID_ARTIFACT",
      message: `Missing or invalid frontmatter artifact field. Expected "pilot-response-log", got "${frontmatter.artifact || "missing"}"`,
    });
    return { rows: [], errors };
  }

  const tableRows = parseMarkdownTable(body);

  if (tableRows.length === 0) {
    return { rows: [], errors };
  }

  // First row is header
  const header = tableRows[0];
  const expectedColumns = [
    "Recipient",
    "Source Channel",
    "Workflow Sentence",
    "Objection Type",
    "WTP ($/mo)",
    "Next-Step Decision",
    "Decision Rationale",
    "Response State",
  ];

  // Validate header
  const normalizedHeader = header.map((h) => h.replace(/\s+/g, " ").trim());
  const normalizedExpected = expectedColumns.map((h) => h.trim());

  for (let i = 0; i < normalizedExpected.length; i++) {
    if (normalizedHeader[i] !== normalizedExpected[i]) {
      errors.push({
        ruleId: "INVALID_HEADER",
        message: `Invalid table header. Expected column ${i + 1} to be "${normalizedExpected[i]}", got "${normalizedHeader[i] || "missing"}"`,
      });
      return { rows: [], errors };
    }
  }

  // Parse data rows with WTP validation
  const rows: ResponseLogRow[] = [];

  for (let i = 1; i < tableRows.length; i++) {
    const row = tableRows[i];

    if (row.length !== 8) {
      errors.push({
        ruleId: "INVALID_ROW",
        message: `Row ${i + 1} has ${row.length} columns, expected 8`,
      });
      continue;
    }

    const [
      recipient,
      sourceChannel,
      workflowSentence,
      objectionType,
      wtp,
      nextStepDecision,
      decisionRationale,
      responseState,
    ] = row;

    // Validate WTP value (TP004)
    const wtpValidation = validateWTPValue(wtp, wtpRange);

    if (!wtpValidation.valid) {
      // Emit WTP validation error with actionable rule ID and row pointer
      errors.push({
        ruleId: wtpValidation.ruleId!,
        message: wtpValidation.message!,
        recipient,
      });
    }

    rows.push({
      recipient,
      sourceChannel,
      workflowSentence,
      objectionType,
      wtp: wtpValidation.valid ? wtpValidation.numericValue! : wtp,
      nextStepDecision,
      decisionRationale,
      responseState,
    });
  }

  return { rows, errors };
}

// ============================================================================
// Price Bucket Assignment (TP005)
// ============================================================================

/**
 * Assign a WTP value to its price bucket based on deterministic bucket policy.
 *
 * Bucket boundaries from CLI help text:
 * - $8-$11:  8 ≤ WTP < 12 (below anchor)
 * - $12:     11.5 ≤ WTP < 12.5 (anchor price point)
 * - $13-$15: 12.5 ≤ WTP < 15.5 (above anchor, mid-high)
 * - $16-$19: 15.5 ≤ WTP ≤ 20 (above anchor, high)
 *
 * Tie-break boundaries:
 * - 11.5-11.99... → $8-$11 bucket (below anchor)
 * - 12.0-12.49... → $12 bucket (anchor)
 * - 12.5-15.49... → $13-$15 bucket
 * - 15.5-20.0 → $16-$19 bucket
 *
 * @param wtp - Willingness to pay value (numeric)
 * @returns Price bucket key, or null if WTP is invalid/out of range
 */
function assignPriceBucket(wtp: number): PriceBucket | null {
  // Validate WTP is finite and in reasonable range
  if (!isFinite(wtp)) {
    return null;
  }

  // $12 bucket: 11.5 ≤ WTP < 12.5 (anchor price point)
  if (wtp >= 11.5 && wtp < 12.5) {
    return "$12";
  }

  // $8-$11 bucket: 8 ≤ WTP < 11.5 (below anchor)
  if (wtp >= 8 && wtp < 11.5) {
    return "$8-$11";
  }

  // $13-$15 bucket: 12.5 ≤ WTP < 15.5 (above anchor, mid-high)
  if (wtp >= 12.5 && wtp < 15.5) {
    return "$13-$15";
  }

  // $16-$19 bucket: 15.5 ≤ WTP ≤ 20 (above anchor, high)
  if (wtp >= 15.5 && wtp <= 20) {
    return "$16-$19";
  }

  // Out of valid range
  return null;
}

// ============================================================================
// Telemetry Calculation (TP005)
// ============================================================================

/**
 * Calculate telemetry from response log rows.
 *
 * Computes:
 * - priceBucketCounts: Count of responses in each price bucket
 * - pilotYesRateByBucket: PILOT YES rate (yes/total) per bucket
 * - medianWTP: Median WTP value across all valid responses
 * - objectionMix: Objection type distribution (counts per type)
 *
 * All outputs use deterministic key ordering for JSON stability.
 *
 * @param rows - Normalized response log rows (candidates for pricing analysis)
 * @returns Telemetry payload with all computed metrics
 */
function calculateTelemetry(
  rows: ResponseLogRow[]
): TelemetryPayload {
  // Initialize bucket counters (deterministic key order)
  const priceBucketCounts: Record<PriceBucket, number> = {
    "$8-$11": 0,
    "$12": 0,
    "$13-$15": 0,
    "$16-$19": 0,
  };

  // Initialize PILOT YES counters per bucket
  const pilotYesCount: Record<PriceBucket, number> = {
    "$8-$11": 0,
    "$12": 0,
    "$13-$15": 0,
    "$16-$19": 0,
  };

  const pilotTotalCount: Record<PriceBucket, number> = {
    "$8-$11": 0,
    "$12": 0,
    "$13-$15": 0,
    "$16-$19": 0,
  };

  // Objection mix counter
  const objectionMix: Record<string, number> = {};

  // Collect valid WTP values for median calculation
  const validWTPValues: number[] = [];

  // Process each row
  for (const row of rows) {
    // Only consider rows with numeric WTP values
    if (typeof row.wtp !== "number") {
      continue;
    }

    const wtp = row.wtp;
    const bucket = assignPriceBucket(wtp);

    // Skip if WTP is out of valid range or invalid
    if (!bucket) {
      continue;
    }

    // Add to bucket counts
    priceBucketCounts[bucket]++;
    pilotTotalCount[bucket]++;

    // Check for PILOT YES (response state starts with "PILOT YES")
    const isPilotYes = row.responseState.toUpperCase().startsWith("PILOT YES");
    if (isPilotYes) {
      pilotYesCount[bucket]++;
    }

    // Collect WTP for median calculation
    validWTPValues.push(wtp);

    // Track objection types (if not "no response yet")
    if (
      row.objectionType &&
      row.objectionType !== "no response yet" &&
      row.objectionType !== ""
    ) {
      const objection = row.objectionType.trim();
      objectionMix[objection] = (objectionMix[objection] || 0) + 1;
    }
  }

  // Calculate PILOT YES rates per bucket
  const pilotYesRateByBucket: Record<PriceBucket, PilotYesRate> = {
    "$8-$11": {
      yes: pilotYesCount["$8-$11"],
      total: pilotTotalCount["$8-$11"],
      rate:
        pilotTotalCount["$8-$11"] > 0
          ? pilotYesCount["$8-$11"] / pilotTotalCount["$8-$11"]
          : 0.0,
    },
    "$12": {
      yes: pilotYesCount["$12"],
      total: pilotTotalCount["$12"],
      rate:
        pilotTotalCount["$12"] > 0
          ? pilotYesCount["$12"] / pilotTotalCount["$12"]
          : 0.0,
    },
    "$13-$15": {
      yes: pilotYesCount["$13-$15"],
      total: pilotTotalCount["$13-$15"],
      rate:
        pilotTotalCount["$13-$15"] > 0
          ? pilotYesCount["$13-$15"] / pilotTotalCount["$13-$15"]
          : 0.0,
    },
    "$16-$19": {
      yes: pilotYesCount["$16-$19"],
      total: pilotTotalCount["$16-$19"],
      rate:
        pilotTotalCount["$16-$19"] > 0
          ? pilotYesCount["$16-$19"] / pilotTotalCount["$16-$19"]
          : 0.0,
    },
  };

  // Calculate median WTP
  let medianWTP = 0;
  if (validWTPValues.length > 0) {
    // Sort values for median calculation
    validWTPValues.sort((a, b) => a - b);

    const mid = Math.floor(validWTPValues.length / 2);

    if (validWTPValues.length % 2 === 0) {
      // Even number of values: average the two middle values
      medianWTP = (validWTPValues[mid - 1] + validWTPValues[mid]) / 2;
    } else {
      // Odd number of values: take the middle value
      medianWTP = validWTPValues[mid];
    }

    // Round to 2 decimal places for deterministic output
    medianWTP = Math.round(medianWTP * 100) / 100;
  }

  // Sort objection mix keys alphabetically for deterministic output
  const sortedObjectionMix: Record<string, number> = {};
  const sortedObjectionKeys = Object.keys(objectionMix).sort((a, b) =>
    a.localeCompare(b)
  );
  for (const key of sortedObjectionKeys) {
    sortedObjectionMix[key] = objectionMix[key];
  }

  return {
    priceBucketCounts,
    pilotYesRateByBucket,
    medianWTP,
    objectionMix: sortedObjectionMix,
  };
}

/**
 * Calculate recommendation from telemetry (TP006).
 *
 * Implements deterministic recommendation engine producing `recommendedNextAnchor`
 * from bucket performance + anchor context ($12 baseline) with explicit tie-breaks.
 *
 * Recommendation precedence (evaluated in order):
 * 1. **Anchor baseline threshold**: Prefer $12 anchor if it meets acceptance threshold
 *    - Threshold: PILOT YES rate >= 60% AND sample size >= 3
 * 2. **Highest PILOT YES rate**: Select bucket with highest acceptance rate
 * 3. **Sample size threshold**: Require bucket with n >= 3 responses
 * 4. **Anchor context mapping**: Map selected bucket to context
 *
 * Tie-break ordering (highest to lowest priority):
 * 1. Sample size (prefer bucket with higher total responses)
 * 2. Anchor familiarity (prefer $12 anchor bucket)
 * 3. Proximity to anchor (prefer bucket closer to $12)
 * 4. Alphabetical bucket label
 *
 * @param telemetry - Telemetry payload containing bucket performance data
 * @returns Recommendation payload with anchor, context, rationale, and precedence chain
 */
function calculateRecommendation(
  telemetry: TelemetryPayload
): RecommendationPayload {
  const precedenceChain: string[] = [];

  // Anchor baseline threshold constants
  const ANCHOR_PRICE = 12;
  const ANCHOR_YES_RATE_THRESHOLD = 0.60; // 60%
  const MIN_SAMPLE_SIZE = 3;

  // Extract bucket data
  const buckets: Array<{
    name: PriceBucket;
    yes: number;
    total: number;
    rate: number;
    midpoint: number; // Midpoint of bucket range for proximity calculation
  }> = [];

  for (const [bucketName, data] of Object.entries(telemetry.pilotYesRateByBucket)) {
    // Calculate midpoint for proximity to anchor
    let midpoint: number;
    switch (bucketName) {
      case "$8-$11":
        midpoint = 9.5;
        break;
      case "$12":
        midpoint = 12.0;
        break;
      case "$13-$15":
        midpoint = 14.0;
        break;
      case "$16-$19":
        midpoint = 17.5;
        break;
      default:
        midpoint = 0;
    }

    buckets.push({
      name: bucketName as PriceBucket,
      yes: data.yes,
      total: data.total,
      rate: data.rate,
      midpoint,
    });
  }

  // Filter to buckets with at least one response
  const bucketsWithData = buckets.filter((b) => b.total > 0);

  // Edge case: no data at all - return baseline anchor
  if (bucketsWithData.length === 0) {
    return {
      recommendedNextAnchor: ANCHOR_PRICE,
      anchorContext: "baseline",
      rationale: "No response data available; defaulting to $12 baseline anchor",
      precedenceChain: ["baseline_threshold"],
    };
  }

  // Step 1: Check anchor baseline threshold
  precedenceChain.push("baseline_threshold");
  const anchorBucket = bucketsWithData.find((b) => b.name === "$12");

  const anchorMeetsThreshold =
    anchorBucket &&
    anchorBucket.total >= MIN_SAMPLE_SIZE &&
    anchorBucket.rate >= ANCHOR_YES_RATE_THRESHOLD;

  if (anchorMeetsThreshold) {
    // Anchor meets threshold - select it directly
    const ratePercent = (anchorBucket.rate * 100).toFixed(0);
    return {
      recommendedNextAnchor: ANCHOR_PRICE,
      anchorContext: "baseline",
      rationale: `$12 anchor meets acceptance threshold (${ratePercent}% PILOT YES rate, n=${anchorBucket.total})`,
      precedenceChain: ["baseline_threshold"],
    };
  }

  // Step 2: Select bucket with highest PILOT YES rate (with tie-breaks)
  precedenceChain.push("highest_yes_rate");

  // Sort buckets by PILOT YES rate (descending), then apply tie-break rules
  const sortedBuckets = [...bucketsWithData].sort((a, b) => {
    // Primary sort: PILOT YES rate (descending)
    if (b.rate !== a.rate) {
      return b.rate - a.rate;
    }

    // Tie-break 1: Sample size (descending - prefer higher total)
    if (b.total !== a.total) {
      return b.total - a.total;
    }

    // Tie-break 2: Anchor familiarity (prefer $12)
    if (a.name === "$12" && b.name !== "$12") {
      return -1;
    }
    if (b.name === "$12" && a.name !== "$12") {
      return 1;
    }

    // Tie-break 3: Proximity to anchor (prefer closer to $12)
    const distanceA = Math.abs(a.midpoint - ANCHOR_PRICE);
    const distanceB = Math.abs(b.midpoint - ANCHOR_PRICE);
    if (distanceA !== distanceB) {
      return distanceA - distanceB;
    }

    // Tie-break 4: Alphabetical bucket label
    return a.name.localeCompare(b.name);
  });

  const selectedBucket = sortedBuckets[0];
  const topBucket = selectedBucket;

  // Step 3: Check sample size threshold
  precedenceChain.push("sample_size");

  // Record which tie-break rules were applied (for traceability)
  const bucketsWithSameRate = bucketsWithData.filter((b) => b.rate === topBucket.rate);
  if (bucketsWithSameRate.length > 1) {
    // Rate tie - check if sample size tie-break was needed
    const bucketsWithSameRateAndSize = bucketsWithSameRate.filter(
      (b) => b.total === topBucket.total
    );
    if (bucketsWithSameRateAndSize.length > 1) {
      // Size tie - check if anchor familiarity was needed
      const hasAnchorInTie = bucketsWithSameRateAndSize.some((b) => b.name === "$12");
      if (hasAnchorInTie && topBucket.name !== "$12") {
        precedenceChain.push("anchor_familiarity");
      } else if (!hasAnchorInTie) {
        precedenceChain.push("anchor_familiarity");
        // Check if proximity tie-break was needed
        const bucketsWithSameDistance = bucketsWithSameRateAndSize.filter(
          (b) => Math.abs(b.midpoint - ANCHOR_PRICE) === Math.abs(topBucket.midpoint - ANCHOR_PRICE)
        );
        if (bucketsWithSameDistance.length > 1) {
          precedenceChain.push("proximity_to_anchor");
          // Check if alphabetical was needed
          if (bucketsWithSameDistance.length > 1) {
            precedenceChain.push("alphabetical_label");
          }
        }
      } else {
        // Anchor familiarity selected $12
        precedenceChain.push("anchor_familiarity");
      }
    } else {
      precedenceChain.push("sample_size");
    }
  }

  // Step 4: Map selected bucket to recommended anchor price
  let recommendedAnchor: number;
  switch (selectedBucket.name) {
    case "$8-$11":
      recommendedAnchor = 10;
      break;
    case "$12":
      recommendedAnchor = 12;
      break;
    case "$13-$15":
      recommendedAnchor = 14;
      break;
    case "$16-$19":
      recommendedAnchor = 17;
      break;
    default:
      recommendedAnchor = ANCHOR_PRICE;
  }

  // Step 5: Map selected bucket to anchor context
  let anchorContext: "baseline" | "lower" | "higher";
  switch (selectedBucket.name) {
    case "$12":
      anchorContext = "baseline";
      break;
    case "$8-$11":
      anchorContext = "lower";
      break;
    case "$13-$15":
    case "$16-$19":
      anchorContext = "higher";
      break;
  }

  // Build rationale
  const bucketData = telemetry.pilotYesRateByBucket[selectedBucket.name];
  const ratePercent = (bucketData.rate * 100).toFixed(0);
  let rationale = "";

  if (selectedBucket.name === "$12") {
    rationale = `$12 bucket selected with ${ratePercent}% PILOT YES rate (n=${bucketData.total})`;
  } else {
    rationale = `${selectedBucket.name} bucket selected with ${ratePercent}% PILOT YES rate (n=${bucketData.total})`;

    if (topBucket.total >= MIN_SAMPLE_SIZE) {
      rationale += "; meets sample threshold";
    } else {
      rationale += "; below sample threshold - highest available";
    }

    if (anchorContext === "lower") {
      rationale += "; testing lower price point";
    } else {
      rationale += "; testing higher price point";
    }
  }

  return {
    recommendedNextAnchor: recommendedAnchor,
    anchorContext,
    rationale,
    precedenceChain,
  };
}

/**
 * Calculate confidence band from telemetry (TP007).
 *
 * Confidence bands quantify reliability of recommendation based on sample size
 * and bucket distribution using a deterministic algorithm.
 *
 * **Confidence bands:**
 * - `low` (0.0-0.49): Preliminary signal, insufficient evidence
 * - `medium` (0.5-0.74): Moderate confidence, some evidence
 * - `high` (0.75-1.0): High confidence, strong evidence
 *
 * **Minimum-sample behavior for low-data scenarios:**
 * - When `totalResponses < 5`, `band` is always `"low"`
 * - `level` is calculated as `totalResponses / 10` (capped at 0.49)
 * - `minimumSampleMet` is `false`
 * - Recommendation is still emitted but flagged as preliminary
 *
 * **Deterministic method:**
 * 1. **Rule 1: Minimum sample gate** - Check if `totalResponses >= 5`
 * 2. **Rule 2: Bucket distribution factor** - `+0.2` if >=2 buckets have responses
 * 3. **Rule 3: Dominant bucket factor** - `+0.15` if max bucket count >= 5
 * 4. **Rule 4: Total sample factor** - `+0.01 * min(totalResponses, 15)` (capped at 0.15)
 * 5. Base level starts at 0.5 for medium band, then apply factors
 * 6. Cap level at 1.0, round to 2 decimal places
 * 7. Determine band based on final level
 *
 * **Deterministic guarantees:**
 * - Same input always produces same confidence band and level
 * - `minimumSampleMet` is deterministic based on `totalResponses >= 5` threshold
 * - Rounding to 2 decimal places ensures byte-stable JSON output
 *
 * @param telemetry - Telemetry payload containing bucket performance data
 * @param totalResponses - Total number of valid responses used for analysis
 * @returns Confidence payload with band, level, sample status, and reasoning
 */
function calculateConfidence(
  telemetry: TelemetryPayload,
  totalResponses: number
): ConfidencePayload {
  // Rule 1: Minimum sample gate
  const minimumSampleMet = totalResponses >= 5;

  if (!minimumSampleMet) {
    // Low-data behavior: low confidence with level based on sample size
    const level = Math.min(0.49, totalResponses / 10);
    const roundedLevel = Math.round(level * 100) / 100;

    return {
      band: "low",
      level: roundedLevel,
      minimumSampleMet: false,
      sampleSize: totalResponses,
      reasoning: `Below minimum sample threshold (n=${totalResponses} < 5); recommendation is preliminary`,
    };
  }

  // Rule 2: Bucket distribution factor
  // Count non-empty buckets (those with at least one response)
  const bucketKeys = Object.keys(telemetry.priceBucketCounts) as PriceBucket[];
  const nonEmptyBuckets = bucketKeys.filter((k) => telemetry.priceBucketCounts[k] > 0);
  const distributionFactor = nonEmptyBuckets.length >= 2 ? 0.2 : 0.0;

  // Rule 3: Dominant bucket factor
  // Check if any bucket has >= 5 responses (dominant signal)
  const maxCount = Math.max(...Object.values(telemetry.priceBucketCounts));
  const dominantFactor = maxCount >= 5 ? 0.15 : 0.0;

  // Rule 4: Total sample factor
  // Incremental confidence based on total sample size (capped at 0.15)
  const sampleFactor = 0.01 * Math.min(totalResponses, 15);

  // Base level starts at 0.5 for medium band
  let level = 0.5 + distributionFactor + dominantFactor + sampleFactor;

  // Cap at 1.0 for high band
  level = Math.min(1.0, level);

  // Round to 2 decimal places for deterministic output
  level = Math.round(level * 100) / 100;

  // Determine band based on level
  let band: "low" | "medium" | "high";
  if (level < 0.5) {
    band = "low";
  } else if (level < 0.75) {
    band = "medium";
  } else {
    band = "high";
  }

  // Build reasoning message
  const reasoningParts = [
    `${totalResponses} responses`,
    `${nonEmptyBuckets.length} non-empty bucket${nonEmptyBuckets.length !== 1 ? "s" : ""}`,
  ];

  if (dominantFactor > 0) {
    reasoningParts.push("dominant bucket present (n≥5)");
  }

  const reasoning = reasoningParts.join("; ");

  return {
    band,
    level,
    minimumSampleMet: true,
    sampleSize: totalResponses,
    reasoning,
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Format the output envelope in human-readable format.
 */
function formatHumanOutput(output: PriceSignalOutput): string {
  const lines: string[] = [];

  lines.push("Pilot Price Signal Analyzer");
  lines.push("===========================");
  lines.push("");

  // Status
  const statusEmoji = output.status === "ok" ? "✅" : "❌";
  lines.push(`Status: ${statusEmoji} ${output.status.toUpperCase()}`);
  lines.push("");

  // Inputs
  lines.push("Inputs");
  lines.push("------");
  lines.push(`  Root Path:          ${output.inputs.rootPath}`);
  lines.push(`  Brief Path:         ${output.inputs.briefPath}`);
  lines.push(`  Batches Analyzed:   ${output.inputs.batchesAnalyzed.join(", ") || "none"}`);
  lines.push(`  Total Responses:    ${output.inputs.totalResponses}`);
  lines.push("");

  // Telemetry
  lines.push("Telemetry");
  lines.push("---------");
  lines.push(`  Price Bucket Counts:`);
  for (const [bucket, count] of Object.entries(output.telemetry.priceBucketCounts)) {
    lines.push(`    ${bucket}: ${count}`);
  }
  lines.push("");
  lines.push(`  PILOT YES Rate by Bucket:`);
  for (const [bucket, data] of Object.entries(output.telemetry.pilotYesRateByBucket)) {
    const rate = (data.rate * 100).toFixed(1);
    lines.push(`    ${bucket}: ${data.yes}/${data.total} (${rate}%)`);
  }
  lines.push("");
  lines.push(`  Median WTP:         $${output.telemetry.medianWTP}/mo`);
  lines.push("");

  // Recommendation
  lines.push("Recommendation");
  lines.push("-------------");
  lines.push(`  Recommended Anchor: $${output.recommendation.recommendedNextAnchor}/mo`);
  lines.push(`  Anchor Context:     ${output.recommendation.anchorContext}`);
  lines.push(`  Rationale:          ${output.recommendation.rationale}`);
  lines.push(`  Precedence Chain:   ${output.recommendation.precedenceChain.join(" > ") || "none"}`);
  lines.push("");

  // Confidence
  lines.push("Confidence");
  lines.push("----------");
  lines.push(`  Band:               ${output.confidence.band.toUpperCase()}`);
  lines.push(`  Level:              ${(output.confidence.level * 100).toFixed(0)}%`);
  lines.push(`  Minimum Sample Met: ${output.confidence.minimumSampleMet ? "Yes" : "No"}`);
  lines.push(`  Sample Size:        ${output.confidence.sampleSize}`);
  lines.push(`  Reasoning:          ${output.confidence.reasoning}`);
  lines.push("");

  // Diagnostics
  if (output.diagnostics.length > 0) {
    lines.push("Diagnostics");
    lines.push("-----------");
    for (const diag of output.diagnostics) {
      lines.push(`  [${diag.ruleId}] ${diag.message}`);
      if (diag.recipient) {
        lines.push(`    Recipient: ${diag.recipient}`);
      }
      if (diag.batch) {
        lines.push(`    Batch: ${diag.batch}`);
      }
    }
    lines.push("");
  }

  // Timestamp
  lines.push(`Timestamp: ${output.timestamp}`);

  return lines.join("\n");
}

// ============================================================================
// Main Entry Point
// ============================================================================

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate required arguments and paths
  validatePaths(args);

  // Set default format
  const format = args.format || "json";

  // Resolve paths
  const resolvedRootPath = resolve(args.rootPath!);
  const resolvedBriefPath = resolve(args.briefPath!);

  // Discover batches (TP003)
  const batches = discoverBatches(resolvedRootPath);

  if (batches.length === 0) {
    exitWithError(
      "NO_BATCHES_FOUND",
      `No pilot batch directories found under root: ${resolvedRootPath}`
    );
  }

  // Load and parse OFFER_BRIEF.md for WTP allowed range (TP004)
  let briefContent: string;
  try {
    briefContent = readFileSync(resolvedBriefPath, "utf-8");
  } catch (err) {
    exitWithError(
      "INVALID_BRIEF",
      `Failed to read OFFER_BRIEF.md: ${err instanceof Error ? err.message : "Unknown error"}`
    );
  }

  const wtpRange = parseOfferBriefWTPRange(briefContent, resolvedBriefPath);

  // Load all response log artifacts from discovered batches (TP003, TP004)
  const { rows: allRows, errors: loadErrors } = loadResponseLogArtifacts(
    resolvedRootPath,
    batches,
    wtpRange  // Pass WTP range for validation
  );

  // Normalize response rows for pricing analysis (TP003)
  const { candidates: normalizedRows, excluded } = normalizeResponseRowsForPricingAnalysis(allRows);

  // Aggregate all errors (load errors + normalization warnings)
  const allErrors: Array<{
    ruleId: string;
    message: string;
    recipient?: string;
    batch?: string;
  }> = [...loadErrors];

  // Add excluded rows as warnings for traceability
  for (const exclusion of excluded) {
    const batch = (exclusion.row as any)._batch;
    allErrors.push({
      ruleId: exclusion.reason,
      batch,
      recipient: exclusion.row.recipient,
      message: `Row excluded from pricing analysis: ${exclusion.reason}`,
    });
  }

  // Calculate telemetry (TP005, TP006)
  const telemetry = calculateTelemetry(normalizedRows);

  // Calculate recommendation (TP006)
  const recommendation = calculateRecommendation(telemetry);

  // Calculate confidence (TP007)
  const confidence = calculateConfidence(telemetry, normalizedRows.length);

  // Build output envelope
  const output: PriceSignalOutput = {
    status: allErrors.length === 0 ? "ok" : "error",
    inputs: {
      rootPath: resolvedRootPath,
      briefPath: resolvedBriefPath,
      batchesAnalyzed: batches,
      totalResponses: normalizedRows.length,
    },
    telemetry,
    recommendation,
    confidence,
    diagnostics: allErrors,
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };

  // Output result
  if (format === "json") {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatHumanOutput(output));
  }

  // Exit with error code if there were WTP validation errors
  const hasWTPValidationErrors = allErrors.some(
    (e) => e.ruleId === "MISSING_WTP_VALUE" || e.ruleId === "INVALID_WTP_VALUE" || e.ruleId === "WTP_OUT_OF_RANGE"
  );

  if (hasWTPValidationErrors) {
    process.exit(ERROR_CODES.WTP_OUT_OF_RANGE.exit);
  }

  if (output.status === "error") {
    process.exit(ERROR_CODES.PARSE_ERROR.exit);
  }
}

// Run main if executed directly
if (import.meta.main) {
  main();
}

export {
  parseArgs,
  validatePaths,
  parseFrontmatter,
  parseMarkdownTable,
  discoverBatches,
  loadResponseLogArtifacts,
  normalizeResponseRowsForPricingAnalysis,
  normalizeWTPValue,
  parseOfferBriefWTPRange,
  validateWTPValue,
  parseResponseLog,
  assignPriceBucket,
  calculateTelemetry,
  calculateRecommendation,
  calculateConfidence,
  formatHumanOutput,
  ERROR_CODES,
};

export type {
  CliArgs,
  ParsedFrontmatter,
  ResponseLogRow,
  PriceBucket,
  PilotYesRate,
  TelemetryPayload,
  RecommendationPayload,
  ConfidencePayload,
  PriceSignalOutput,
  WTPRange,
  WTPValidationResult,
};
