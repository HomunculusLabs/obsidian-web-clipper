#!/usr/bin/env bun

/**
 * TASKPAD Priority Brief Freshness Gate
 *
 * Validates that the newest generated kickoff/priority briefs are fresh versus
 * their required source artifacts by comparing artifact fingerprints (content hash
 * or mtime) and emitting deterministic violations with machine-readable remediation.
 *
 * This tool implements TP002: freshness evaluation for trust + MarkItDown briefing
 * artifacts using deterministic source evidence ordering.
 *
 * Contract: docs/contracts/priority-brief-freshness-gate.md
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

// =============================================================================
// Rule IDs (Deterministic)
// =============================================================================

export const RuleIds = {
  PBFG001_BRIEF_NOT_FOUND: "PBFG001_BRIEF_NOT_FOUND",
  PBFG002_SOURCE_STALE_DASHBOARD: "PBFG002_SOURCE_STALE_DASHBOARD",
  PBFG003_SOURCE_STALE_STATE_SYNC: "PBFG003_SOURCE_STALE_STATE_SYNC",
  PBFG004_SOURCE_STALE_HISTORY: "PBFG004_SOURCE_STALE_HISTORY",
  PBFG005_MISSING_FINGERPRINT: "PBFG005_MISSING_FINGERPRINT",
  PBFG006_SOURCE_MISSING: "PBFG006_SOURCE_MISSING",
  PBFG007_NO_SOURCES_FOUND: "PBFG007_NO_SOURCES_FOUND",
  PBFG008_FINGERPRINT_PARSE_ERROR: "PBFG008_FINGERPRINT_PARSE_ERROR",
  PBFG009_TRUST_FAMILY_STALE: "PBFG009_TRUST_FAMILY_STALE",
  PBFG010_MARKITDOWN_FAMILY_STALE: "PBFG010_MARKITDOWN_FAMILY_STALE",
} as const;

export type RuleId = (typeof RuleIds)[keyof typeof RuleIds];

/**
 * Canonical order for violation rule IDs in diagnostics output.
 * Ensures deterministic, stable ordering across runs for machine-readable output.
 */
const CANONICAL_VIOLATION_ORDER: RuleId[] = [
  RuleIds.PBFG001_BRIEF_NOT_FOUND,
  RuleIds.PBFG002_SOURCE_STALE_DASHBOARD,
  RuleIds.PBFG003_SOURCE_STALE_STATE_SYNC,
  RuleIds.PBFG004_SOURCE_STALE_HISTORY,
  RuleIds.PBFG005_MISSING_FINGERPRINT,
  RuleIds.PBFG006_SOURCE_MISSING,
  RuleIds.PBFG007_NO_SOURCES_FOUND,
  RuleIds.PBFG008_FINGERPRINT_PARSE_ERROR,
  RuleIds.PBFG009_TRUST_FAMILY_STALE,
  RuleIds.PBFG010_MARKITDOWN_FAMILY_STALE,
];

// =============================================================================
// Type Definitions
// =============================================================================

export type OutputFormat = "json" | "human";

/**
 * Brief family types
 */
export type BriefFamily = "trust" | "markitdown";

/**
 * Source artifact configuration
 */
export interface SourceArtifactConfig {
  sourceName: string;
  filename: string;
  fingerprintField: string;
  precedence: number; // Lower = higher precedence
  ruleId: RuleId;
}

/**
 * Brief family configuration
 */
export interface BriefFamilyConfig {
  briefName: string;
  briefFilename: string;
  briefHandler: string;
  family: BriefFamily;
  familyStaleRuleId: RuleId;
  sources: SourceArtifactConfig[];
}

/**
 * Staleness reason
 */
export type StalenessReason =
  | "source-newer"
  | "missing-fingerprint"
  | "source-missing";

/**
 * Source freshness check result
 */
export interface SourceFreshnessCheck {
  sourceName: string;
  sourcePath: string;
  exists: boolean;
  isStale: boolean;
  stalenessReason?: StalenessReason;
  briefFingerprint?: string;
  currentFingerprint?: string;
  briefMtime?: string;
  sourceMtime?: string;
}

/**
 * Brief freshness check result
 */
export interface BriefFreshnessCheck {
  briefName: string;
  briefPath: string;
  exists: boolean;
  isStale: boolean;
  generatedAt?: string;
  hasFingerprints: boolean;
  sourceChecks: SourceFreshnessCheck[];
}

/**
 * Violation entry for output
 */
export interface FreshnessViolation {
  ruleId: RuleId;
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

/**
 * Summary statistics
 */
export interface Summary {
  totalBriefs: number;
  freshBriefs: number;
  staleBriefs: number;
  missingBriefs: number;
}

/**
 * Full output envelope
 */
export interface PriorityBriefFreshnessResult {
  status: "pass" | "fail";
  inputs: {
    taskpadPath: string;
    planPath: string;
    projectRoot: string;
    vaultPath?: string;
  };
  briefs: BriefFreshnessCheck[];
  summary: Summary;
  violations: FreshnessViolation[];
  timestamp: string;
}

// =============================================================================
// Brief Family Configuration
// =============================================================================

/**
 * Brief family configurations with source artifact mappings
 */
export const BRIEF_FAMILY_CONFIGS: BriefFamilyConfig[] = [
  {
    briefName: "knowledge-trust-kickoff-brief",
    briefFilename: "knowledge-trust-kickoff-brief.md",
    briefHandler: "refreshKnowledgeTrustKickoffBrief",
    family: "trust",
    familyStaleRuleId: RuleIds.PBFG009_TRUST_FAMILY_STALE,
    sources: [
      {
        sourceName: "knowledge-trust-dashboard",
        filename: "knowledge-trust-dashboard.md",
        fingerprintField: "dashboard_fingerprint",
        precedence: 1,
        ruleId: RuleIds.PBFG002_SOURCE_STALE_DASHBOARD,
      },
      {
        sourceName: "knowledge-trust-dashboard-state-sync",
        filename: "knowledge-trust-dashboard-state-sync.md",
        fingerprintField: "state_sync_fingerprint",
        precedence: 2,
        ruleId: RuleIds.PBFG003_SOURCE_STALE_STATE_SYNC,
      },
      {
        sourceName: "knowledge-trust-dashboard-history",
        filename: "knowledge-trust-dashboard-history.ndjson",
        fingerprintField: "history_fingerprint",
        precedence: 3,
        ruleId: RuleIds.PBFG004_SOURCE_STALE_HISTORY,
      },
    ],
  },
  {
    briefName: "markitdown-conversion-priority-brief",
    briefFilename: "markitdown-conversion-priority-brief.md",
    briefHandler: "refreshMarkitdownConversionPriorityBrief",
    family: "markitdown",
    familyStaleRuleId: RuleIds.PBFG010_MARKITDOWN_FAMILY_STALE,
    sources: [
      {
        sourceName: "markitdown-conversion-review-inbox",
        filename: "markitdown-conversion-review-inbox.md",
        fingerprintField: "review_inbox_fingerprint",
        precedence: 1,
        ruleId: RuleIds.PBFG002_SOURCE_STALE_DASHBOARD,
      },
      {
        sourceName: "markitdown-conversion-state-sync",
        filename: "markitdown-conversion-state-sync.md",
        fingerprintField: "state_sync_fingerprint",
        precedence: 2,
        ruleId: RuleIds.PBFG003_SOURCE_STALE_STATE_SYNC,
      },
      {
        sourceName: "markitdown-conversion-history",
        filename: "markitdown-conversion-history.ndjson",
        fingerprintField: "history_fingerprint",
        precedence: 3,
        ruleId: RuleIds.PBFG004_SOURCE_STALE_HISTORY,
      },
    ],
  },
];

// =============================================================================
// Constants
// =============================================================================

/**
 * Mtime tolerance in milliseconds to avoid false positives from filesystem jitter
 */
const MTIME_TOLERANCE_MS = 1000;

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface CliArgs {
  taskpadPath?: string;
  planPath?: string;
  projectRoot?: string;
  vaultPath?: string;
  format?: OutputFormat;
  help?: boolean;
}

function parseCliArgs(args: string[]): CliArgs {
  const parsed: CliArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--taskpad" || arg === "-t") {
      parsed.taskpadPath = args[++i];
    } else if (arg === "--plan" || arg === "-p") {
      parsed.planPath = args[++i];
    } else if (arg === "--project-root" || arg === "-r") {
      parsed.projectRoot = args[++i];
    } else if (arg === "--vault-path" || arg === "-v") {
      parsed.vaultPath = args[++i];
    } else if (arg === "--format" || arg === "-f") {
      parsed.format = args[++i] as OutputFormat;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    }
  }

  return parsed;
}

function showHelp(): void {
  console.log(`
TASKPAD Priority Brief Freshness Gate

Validates that the newest generated kickoff/priority briefs are fresh versus
their required source artifacts by comparing artifact fingerprints (content hash
or mtime) and emitting deterministic violations with machine-readable remediation.

USAGE:
  bun run taskpad:priority-brief-freshness-gate -- --taskpad <path> --plan <path> --project-root <path> [--vault-path <path>] [--format <format>]

OPTIONS:
  --taskpad <path>      Path to TASKPAD markdown file (required)
  --plan <path>         Path to IMPLEMENTATION_PLAN markdown file (required)
  --project-root <path> Project root directory for resolving file paths (required)
  --vault-path <path>   Path to Obsidian vault for artifact resolution (optional)
  --format <format>     Output format: json or human (default: json)
  --help, -h            Show this help message

EXIT CODES:
  0  All briefs are fresh (pass)
  1  One or more briefs are stale (fail)
  2  Input validation failure (invalid arguments, unreadable files)

EXAMPLES:
  # Check freshness with JSON output
  bun run taskpad:priority-brief-freshness-gate -- \\
    --taskpad "TASKPAD.md" \\
    --plan IMPLEMENTATION_PLAN.md \\
    --project-root . \\
    --format json

  # Check with vault path for artifact resolution
  bun run taskpad:priority-brief-freshness-gate -- \\
    --taskpad "TASKPAD.md" \\
    --plan IMPLEMENTATION_PLAN.md \\
    --project-root . \\
    --vault-path "/path/to/vault" \\
    --format human
`);
}

// =============================================================================
// Fingerprint Utilities
// =============================================================================

/**
 * Calculate SHA-256 content hash
 */
function calculateContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Format mtime as ISO 8601 fingerprint
 */
function formatMtimeFingerprint(mtime: Date): string {
  return mtime.toISOString();
}

/**
 * Get file mtime as Date or null if file doesn't exist
 */
function getFileMtime(filePath: string): Date | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const stats = statSync(filePath);
    return stats.mtime;
  } catch {
    return null;
  }
}

/**
 * Get file content hash or null if file doesn't exist
 */
function getFileContentHash(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, "utf8");
    return calculateContentHash(content);
  } catch {
    return null;
  }
}

/**
 * Check if source is newer than brief by mtime with tolerance
 */
function isStaleByMtime(briefMtime: Date, sourceMtime: Date): boolean {
  return sourceMtime.getTime() - briefMtime.getTime() > MTIME_TOLERANCE_MS;
}

/**
 * Parse frontmatter from markdown content
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const frontmatterText = frontmatterMatch[1];
  const result: Record<string, unknown> = {};

  // Simple YAML-like parsing for basic frontmatter
  const lines = frontmatterText.split("\n");
  let currentKey: string | null = null;
  let inNestedObject = false;
  let nestedContent: string[] = [];

  for (const line of lines) {
    // Check for nested object start (e.g., "source_fingerprints:")
    const nestedMatch = line.match(/^(\w+):\s*$/);
    if (nestedMatch) {
      if (inNestedObject && currentKey && nestedContent.length > 0) {
        // Save previous nested object
        result[currentKey] = parseNestedObject(nestedContent);
      }
      currentKey = nestedMatch[1];
      inNestedObject = true;
      nestedContent = [];
      continue;
    }

    // Check for nested property (e.g., "  knowledge-trust-dashboard: ...")
    if (inNestedObject && line.startsWith("  ")) {
      nestedContent.push(line);
      continue;
    }

    // End of nested object
    if (inNestedObject && !line.startsWith("  ") && line.trim()) {
      if (currentKey && nestedContent.length > 0) {
        result[currentKey] = parseNestedObject(nestedContent);
      }
      inNestedObject = false;
      currentKey = null;
      nestedContent = [];
    }

    // Simple key-value pair
    const simpleMatch = line.match(/^(\w+):\s*(.*)$/);
    if (simpleMatch && !inNestedObject) {
      const key = simpleMatch[1];
      let value: unknown = simpleMatch[2].trim();

      // Remove quotes if present
      if (typeof value === "string") {
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        // Parse booleans
        if (value === "true") value = true;
        else if (value === "false") value = false;
        // Parse numbers
        else if (/^\d+$/.test(value as string)) {
          value = parseInt(value as string, 10);
        }
      }

      result[key] = value;
    }
  }

  // Handle any remaining nested object
  if (inNestedObject && currentKey && nestedContent.length > 0) {
    result[currentKey] = parseNestedObject(nestedContent);
  }

  return result;
}

/**
 * Parse nested object lines into a record
 */
function parseNestedObject(lines: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of lines) {
    const match = line.match(/^\s+(\S+):\s*(.*)$/);
    if (match) {
      let value = match[2].trim();
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[match[1]] = value;
    }
  }

  return result;
}

// =============================================================================
// Freshness Validation Functions
// =============================================================================

/**
 * Check freshness for a single brief family
 */
export function checkBriefFreshness(
  config: BriefFamilyConfig,
  vaultPath: string | undefined
): BriefFreshnessCheck {
  const briefPath = vaultPath
    ? join(vaultPath, config.briefFilename)
    : config.briefFilename;

  const exists = existsSync(briefPath);
  const sourceChecks: SourceFreshnessCheck[] = [];
  let isStale = false;
  let generatedAt: string | undefined;
  let hasFingerprints = false;
  let briefMtime: Date | null = null;
  let sourceFingerprints: Record<string, string> = {};

  if (exists) {
    try {
      const content = readFileSync(briefPath, "utf8");
      const frontmatter = parseFrontmatter(content);

      if (frontmatter) {
        generatedAt = frontmatter.generated_at as string | undefined;

        // Check for source_fingerprints in frontmatter
        if (frontmatter.source_fingerprints && typeof frontmatter.source_fingerprints === "object") {
          sourceFingerprints = frontmatter.source_fingerprints as Record<string, string>;
          hasFingerprints = Object.keys(sourceFingerprints).length > 0;
        }
      }

      briefMtime = getFileMtime(briefPath);
    } catch {
      // If we can't read the brief, treat as potentially stale
      isStale = true;
    }
  }

  // Check each source artifact
  let sourcesFound = 0;
  for (const sourceConfig of config.sources) {
    const sourcePath = vaultPath
      ? join(vaultPath, sourceConfig.filename)
      : sourceConfig.filename;

    const sourceCheck: SourceFreshnessCheck = {
      sourceName: sourceConfig.sourceName,
      sourcePath,
      exists: existsSync(sourcePath),
      isStale: false,
    };

    if (sourceCheck.exists) {
      sourcesFound++;
      const sourceMtime = getFileMtime(sourcePath);

      if (exists && briefMtime && sourceMtime) {
        sourceCheck.briefMtime = formatMtimeFingerprint(briefMtime);
        sourceCheck.sourceMtime = formatMtimeFingerprint(sourceMtime);

        // Check fingerprint if available
        const briefFingerprint = sourceFingerprints[sourceConfig.sourceName];
        if (briefFingerprint) {
          sourceCheck.briefFingerprint = briefFingerprint;

          // Get current source fingerprint
          const currentHash = getFileContentHash(sourcePath);
          if (currentHash) {
            sourceCheck.currentFingerprint = `sha256:${currentHash.slice(0, 16)}`;

            // Compare fingerprints
            if (briefFingerprint !== sourceCheck.currentFingerprint) {
              sourceCheck.isStale = true;
              sourceCheck.stalenessReason = "source-newer";
              isStale = true;
            }
          }
        } else {
          // Fall back to mtime comparison
          if (isStaleByMtime(briefMtime, sourceMtime)) {
            sourceCheck.isStale = true;
            sourceCheck.stalenessReason = "missing-fingerprint";
            isStale = true;
          }
        }
      }
    } else {
      sourceCheck.stalenessReason = "source-missing";
    }

    sourceChecks.push(sourceCheck);
  }

  // If no sources were found and brief exists, mark as potentially orphaned
  if (sourcesFound === 0 && exists) {
    // This is a warning, not an error
  }

  return {
    briefName: config.briefName,
    briefPath,
    exists,
    isStale: isStale || !exists,
    generatedAt,
    hasFingerprints,
    sourceChecks,
  };
}

/**
 * Generate violations from freshness check results
 */
export function generateViolations(
  briefCheck: BriefFreshnessCheck,
  config: BriefFamilyConfig,
  vaultPath: string | undefined
): FreshnessViolation[] {
  const violations: FreshnessViolation[] = [];

  // PBFG001: Brief not found
  if (!briefCheck.exists) {
    violations.push({
      ruleId: RuleIds.PBFG001_BRIEF_NOT_FOUND,
      severity: "warning",
      briefName: config.briefName,
      briefPath: briefCheck.briefPath,
      details: {},
      remediation: {
        description: `Brief \`${config.briefName}\` does not exist. Run the scaffold command to generate it.`,
        scaffoldCommand: generateScaffoldCommand(config, vaultPath),
      },
    });
    return violations;
  }

  // Check each source for staleness
  let hasStaleSource = false;
  for (const sourceCheck of briefCheck.sourceChecks) {
    // PBFG006: Source missing
    if (!sourceCheck.exists) {
      violations.push({
        ruleId: RuleIds.PBFG006_SOURCE_MISSING,
        severity: "warning",
        briefName: config.briefName,
        briefPath: briefCheck.briefPath,
        sourceName: sourceCheck.sourceName,
        sourcePath: sourceCheck.sourcePath,
        details: {},
        remediation: {
          description: `Source \`${sourceCheck.sourceName}\` does not exist. Brief may be orphaned. Consider removing or regenerating.`,
          scaffoldCommand: generateScaffoldCommand(config, vaultPath),
        },
      });
      continue;
    }

    if (sourceCheck.isStale) {
      hasStaleSource = true;

      // Determine appropriate rule ID based on source type
      // Check more specific patterns first to avoid false matches
      let ruleId: RuleId;
      if (sourceCheck.sourceName.includes("state-sync")) {
        ruleId = RuleIds.PBFG003_SOURCE_STALE_STATE_SYNC;
      } else if (sourceCheck.sourceName.includes("history")) {
        ruleId = RuleIds.PBFG004_SOURCE_STALE_HISTORY;
      } else if (sourceCheck.sourceName.includes("dashboard") || sourceCheck.sourceName.includes("review-inbox")) {
        ruleId = RuleIds.PBFG002_SOURCE_STALE_DASHBOARD;
      } else {
        ruleId = RuleIds.PBFG005_MISSING_FINGERPRINT;
      }

      // PBFG005: Missing fingerprint
      if (sourceCheck.stalenessReason === "missing-fingerprint") {
        violations.push({
          ruleId: RuleIds.PBFG005_MISSING_FINGERPRINT,
          severity: "error",
          briefName: config.briefName,
          briefPath: briefCheck.briefPath,
          sourceName: sourceCheck.sourceName,
          sourcePath: sourceCheck.sourcePath,
          details: {
            briefFingerprint: sourceCheck.briefFingerprint,
            currentFingerprint: sourceCheck.currentFingerprint,
          },
          remediation: {
            description: `Brief lacks fingerprint for source \`${sourceCheck.sourceName}\`. Run the scaffold command to regenerate with proper fingerprints.`,
            scaffoldCommand: generateScaffoldCommand(config, vaultPath),
          },
        });
      } else {
        // PBFG002-004: Source is newer
        violations.push({
          ruleId,
          severity: "error",
          briefName: config.briefName,
          briefPath: briefCheck.briefPath,
          sourceName: sourceCheck.sourceName,
          sourcePath: sourceCheck.sourcePath,
          details: {
            briefGeneratedAt: sourceCheck.briefMtime,
            sourceModifiedAt: sourceCheck.sourceMtime,
            stalenessDuration: calculateStalenessDuration(
              sourceCheck.briefMtime,
              sourceCheck.sourceMtime
            ),
          },
          remediation: {
            description: `Source \`${sourceCheck.sourceName}\` is newer than brief. Brief was generated at ${sourceCheck.briefMtime} but source was modified at ${sourceCheck.sourceMtime}. Run the scaffold command to refresh.`,
            scaffoldCommand: generateScaffoldCommand(config, vaultPath),
          },
        });
      }
    }
  }

  // PBFG007: No sources found
  const existingSources = briefCheck.sourceChecks.filter((s) => s.exists);
  if (briefCheck.exists && existingSources.length === 0) {
    violations.push({
      ruleId: RuleIds.PBFG007_NO_SOURCES_FOUND,
      severity: "warning",
      briefName: config.briefName,
      briefPath: briefCheck.briefPath,
      details: {},
      remediation: {
        description: `No source artifacts found for brief family. Brief may be orphaned or sources need to be generated first.`,
        scaffoldCommand: generateScaffoldCommand(config, vaultPath),
      },
    });
  }

  // Family-level aggregated violations
  if (hasStaleSource) {
    violations.push({
      ruleId: config.familyStaleRuleId,
      severity: "error",
      briefName: config.briefName,
      briefPath: briefCheck.briefPath,
      details: {},
      remediation: {
        description: `${config.family === "trust" ? "Trust" : "MarkItDown"} brief family has stale sources. Run the scaffold command to refresh all ${config.family} briefs.`,
        scaffoldCommand: generateScaffoldCommand(config, vaultPath),
      },
    });
  }

  return violations;
}

/**
 * Generate scaffold command for brief regeneration
 */
function generateScaffoldCommand(config: BriefFamilyConfig, vaultPath: string | undefined): string {
  const vaultArg = vaultPath ? ` --vault-path "${vaultPath}"` : "";
  return `bun run refresh:${config.briefHandler}${vaultArg}`;
}

/**
 * Calculate human-readable staleness duration
 */
function calculateStalenessDuration(briefMtime?: string, sourceMtime?: string): string {
  if (!briefMtime || !sourceMtime) {
    return "unknown";
  }

  try {
    const briefTime = new Date(briefMtime).getTime();
    const sourceTime = new Date(sourceMtime).getTime();
    const diffMs = sourceTime - briefTime;

    if (diffMs < 0) {
      return "brief is newer";
    }

    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) {
      return `${diffDay} day${diffDay > 1 ? "s" : ""}`;
    } else if (diffHour > 0) {
      return `${diffHour} hour${diffHour > 1 ? "s" : ""}`;
    } else if (diffMin > 0) {
      return `${diffMin} minute${diffMin > 1 ? "s" : ""}`;
    } else {
      return `${diffSec} second${diffSec > 1 ? "s" : ""}`;
    }
  } catch {
    return "unknown";
  }
}

/**
 * Sort violations by canonical rule ID order
 */
function sortViolationsByCanonicalOrder(violations: FreshnessViolation[]): FreshnessViolation[] {
  const orderMap = new Map(CANONICAL_VIOLATION_ORDER.map((id, index) => [id, index]));

  return violations.sort((a, b) => {
    const orderA = orderMap.get(a.ruleId) ?? Number.MAX_SAFE_INTEGER;
    const orderB = orderMap.get(b.ruleId) ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB;
  });
}

// =============================================================================
// Output Formatting
// =============================================================================

/**
 * Format result as JSON
 */
function formatJson(result: PriorityBriefFreshnessResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format result as human-readable text
 */
function formatHuman(result: PriorityBriefFreshnessResult): string {
  const lines: string[] = [];
  const statusUpper = result.status.toUpperCase();

  lines.push(`TASKPAD Priority Brief Freshness Gate: ${statusUpper}`);
  lines.push("──────────────────────────────────────────────────");
  lines.push("");

  // Inputs section
  lines.push("Inputs:");
  lines.push(`  - taskpad: ${result.inputs.taskpadPath}`);
  lines.push(`  - plan: ${result.inputs.planPath}`);
  lines.push(`  - project-root: ${result.inputs.projectRoot}`);
  if (result.inputs.vaultPath) {
    lines.push(`  - vault-path: ${result.inputs.vaultPath}`);
  }
  lines.push("");

  // Briefs section
  lines.push(`Briefs: ${result.briefs.length}`);
  for (const brief of result.briefs) {
    lines.push(`  ${result.briefs.indexOf(brief) + 1}. ${brief.briefName}`);
    lines.push(`     - Exists: ${brief.exists ? "yes" : "no"}`);
    lines.push(`     - Fresh: ${brief.isStale ? "no" : "yes"}`);
    if (brief.generatedAt) {
      lines.push(`     - Generated: ${brief.generatedAt}`);
    }
    lines.push(`     - Sources:`);
    for (const source of brief.sourceChecks) {
      const status = !source.exists ? "⚠ missing"
        : source.isStale ? "✗ stale"
        : "✓ fresh";
      lines.push(`       - ${source.sourceName}: ${status}`);
    }
  }
  lines.push("");

  // Summary section
  lines.push("Summary:");
  lines.push(`  - Total briefs: ${result.summary.totalBriefs}`);
  lines.push(`  - Fresh: ${result.summary.freshBriefs}`);
  lines.push(`  - Stale: ${result.summary.staleBriefs}`);
  lines.push(`  - Missing: ${result.summary.missingBriefs}`);
  lines.push("");

  // Violations section
  lines.push(`Violations: ${result.violations.length}`);
  for (const violation of result.violations) {
    lines.push(`  - [${violation.ruleId}] ${violation.briefName}: ${violation.remediation.description}`);
    lines.push(`    Remediation: ${violation.remediation.scaffoldCommand}`);
  }

  return lines.join("\n");
}

// =============================================================================
// Main Execution
// =============================================================================

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const cliArgs = parseCliArgs(args);

  if (cliArgs.help) {
    showHelp();
    return 0;
  }

  // Validate required arguments
  if (!cliArgs.taskpadPath || !cliArgs.planPath || !cliArgs.projectRoot) {
    console.error("Error: --taskpad, --plan, and --project-root are required");
    showHelp();
    return 2;
  }

  const format = cliArgs.format || "json";
  const timestamp = new Date().toISOString();

  // Check freshness for each brief family
  const briefs: BriefFreshnessCheck[] = [];
  const allViolations: FreshnessViolation[] = [];

  for (const config of BRIEF_FAMILY_CONFIGS) {
    const briefCheck = checkBriefFreshness(config, cliArgs.vaultPath);
    briefs.push(briefCheck);

    const violations = generateViolations(briefCheck, config, cliArgs.vaultPath);
    allViolations.push(...violations);
  }

  // Sort violations by canonical order
  const sortedViolations = sortViolationsByCanonicalOrder(allViolations);

  // Calculate summary
  const summary: Summary = {
    totalBriefs: briefs.length,
    freshBriefs: briefs.filter((b) => b.exists && !b.isStale).length,
    staleBriefs: briefs.filter((b) => b.exists && b.isStale).length,
    missingBriefs: briefs.filter((b) => !b.exists).length,
  };

  // Determine overall status
  // Status is "fail" if there are any error-level violations
  const hasErrors = sortedViolations.some((v) => v.severity === "error");
  const status: "pass" | "fail" = hasErrors ? "fail" : "pass";

  const result: PriorityBriefFreshnessResult = {
    status,
    inputs: {
      taskpadPath: cliArgs.taskpadPath,
      planPath: cliArgs.planPath,
      projectRoot: cliArgs.projectRoot,
      vaultPath: cliArgs.vaultPath,
    },
    briefs,
    summary,
    violations: sortedViolations,
    timestamp,
  };

  // Output result
  const output = format === "json" ? formatJson(result) : formatHuman(result);
  console.log(output);

  // Return exit code
  return status === "pass" ? 0 : 1;
}

// Run main only when executed directly
if (import.meta.main) {
  main().then((exitCode) => {
    process.exit(exitCode);
  }).catch((error) => {
    console.error("Fatal error:", error);
    process.exit(2);
  });
}
