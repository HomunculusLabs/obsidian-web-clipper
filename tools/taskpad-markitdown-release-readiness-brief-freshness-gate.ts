#!/usr/bin/env bun

/**
 * TASKPAD MarkItDown Release Readiness Brief Freshness Gate
 *
 * Validates that the generated release-readiness brief is fresh versus its
 * composite MarkItDown source artifacts by comparing artifact fingerprints
 * (content hash or mtime) and emitting deterministic violations with
 * machine-readable remediation.
 *
 * This tool implements TP002: freshness evaluation for markitdown-release-readiness-brief
 * against composite inputs + canonical upstream surfaces.
 *
 * Contract: docs/contracts/markitdown-release-readiness-brief-freshness-gate.md
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

// =============================================================================
// Rule IDs (Deterministic)
// =============================================================================

export const RuleIds = {
  RRFG001_BRIEF_NOT_FOUND: "RRFG001_BRIEF_NOT_FOUND",
  RRFG002_PRIORITY_BRIEF_STALE: "RRFG002_PRIORITY_BRIEF_STALE",
  RRFG003_REGRESSION_HOTSPOTS_STALE: "RRFG003_REGRESSION_HOTSPOTS_STALE",
  RRFG004_REMEDIATION_PLAYBOOK_STALE: "RRFG004_REMEDIATION_PLAYBOOK_STALE",
  RRFG005_STATE_SYNC_STALE: "RRFG005_STATE_SYNC_STALE",
  RRFG006_REVIEW_INBOX_STALE: "RRFG006_REVIEW_INBOX_STALE",
  RRFG007_HISTORY_STALE: "RRFG007_HISTORY_STALE",
  RRFG008_MISSING_FINGERPRINT: "RRFG008_MISSING_FINGERPRINT",
  RRFG009_SOURCE_MISSING: "RRFG009_SOURCE_MISSING",
  RRFG010_NO_SOURCES_FOUND: "RRFG010_NO_SOURCES_FOUND",
  RRFG011_FINGERPRINT_PARSE_ERROR: "RRFG011_FINGERPRINT_PARSE_ERROR",
  RRFG012_AGGREGATE_STALE: "RRFG012_AGGREGATE_STALE",
} as const;

export type RuleId = (typeof RuleIds)[keyof typeof RuleIds];

/**
 * Canonical order for violation rule IDs in diagnostics output.
 * Ensures deterministic, stable ordering across runs for machine-readable output.
 */
const CANONICAL_VIOLATION_ORDER: RuleId[] = [
  RuleIds.RRFG001_BRIEF_NOT_FOUND,
  RuleIds.RRFG002_PRIORITY_BRIEF_STALE,
  RuleIds.RRFG003_REGRESSION_HOTSPOTS_STALE,
  RuleIds.RRFG004_REMEDIATION_PLAYBOOK_STALE,
  RuleIds.RRFG005_STATE_SYNC_STALE,
  RuleIds.RRFG006_REVIEW_INBOX_STALE,
  RuleIds.RRFG007_HISTORY_STALE,
  RuleIds.RRFG008_MISSING_FINGERPRINT,
  RuleIds.RRFG009_SOURCE_MISSING,
  RuleIds.RRFG010_NO_SOURCES_FOUND,
  RuleIds.RRFG011_FINGERPRINT_PARSE_ERROR,
  RuleIds.RRFG012_AGGREGATE_STALE,
];

// =============================================================================
// Type Definitions
// =============================================================================

export type OutputFormat = "json" | "human";

/**
 * Staleness reason
 */
export type StalenessReason =
  | "source-newer"
  | "missing-fingerprint"
  | "source-missing";

/**
 * Source artifact configuration
 */
export interface SourceArtifactConfig {
  sourceName: string;
  filename: string;
  fingerprintField: string;
  precedence: number;
  isRequired: boolean;
  ruleId: RuleId;
}

/**
 * Brief configuration
 */
export interface BriefConfig {
  briefName: string;
  briefFilename: string;
  briefHandler: string;
  requiredCompositeInputs: SourceArtifactConfig[];
  upstreamSurfaces: SourceArtifactConfig[];
}

/**
 * Source freshness check result
 */
export interface SourceFreshnessCheck {
  sourceName: string;
  sourcePath: string;
  precedenceLevel: number;
  isRequired: boolean;
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
  parseError?: string;
  requiredCompositeInputs: SourceFreshnessCheck[];
  upstreamSurfaces: SourceFreshnessCheck[];
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
    precedenceLevel?: number;
    isRequired?: boolean;
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
  totalSources: number;
  freshSources: number;
  staleSources: number;
  missingSources: number;
  requiredStale: number;
  upstreamStale: number;
}

/**
 * Full output envelope
 */
export interface ReleaseReadinessFreshnessResult {
  status: "pass" | "fail";
  inputs: {
    taskpadPath: string;
    planPath: string;
    projectRoot: string;
    vaultPath?: string;
  };
  brief: {
    briefName: string;
    briefPath: string;
    exists: boolean;
    isStale: boolean;
    generatedAt?: string;
  };
  sources: {
    requiredCompositeInputs: SourceFreshnessCheck[];
    upstreamSurfaces: SourceFreshnessCheck[];
  };
  summary: Summary;
  violations: FreshnessViolation[];
  timestamp: string;
}

// =============================================================================
// Brief Configuration
// =============================================================================

/**
 * Brief configuration with source artifact mappings
 */
export const BRIEF_CONFIG: BriefConfig = {
  briefName: "markitdown-release-readiness-brief",
  briefFilename: "markitdown-release-readiness-brief.md",
  briefHandler: "refreshMarkitdownReleaseReadinessBrief",
  requiredCompositeInputs: [
    {
      sourceName: "markitdown-conversion-priority-brief",
      filename: "markitdown-conversion-priority-brief.md",
      fingerprintField: "priority_brief_fingerprint",
      precedence: 1,
      isRequired: true,
      ruleId: RuleIds.RRFG002_PRIORITY_BRIEF_STALE,
    },
    {
      sourceName: "markitdown-conversion-regression-hotspots",
      filename: "markitdown-conversion-regression-hotspots.md",
      fingerprintField: "regression_hotspots_fingerprint",
      precedence: 2,
      isRequired: true,
      ruleId: RuleIds.RRFG003_REGRESSION_HOTSPOTS_STALE,
    },
    {
      sourceName: "markitdown-conversion-remediation-playbook",
      filename: "markitdown-conversion-remediation-playbook.md",
      fingerprintField: "remediation_playbook_fingerprint",
      precedence: 3,
      isRequired: true,
      ruleId: RuleIds.RRFG004_REMEDIATION_PLAYBOOK_STALE,
    },
    {
      sourceName: "markitdown-conversion-state-sync",
      filename: "markitdown-conversion-state-sync.md",
      fingerprintField: "state_sync_fingerprint",
      precedence: 4,
      isRequired: true,
      ruleId: RuleIds.RRFG005_STATE_SYNC_STALE,
    },
  ],
  upstreamSurfaces: [
    {
      sourceName: "markitdown-conversion-review-inbox",
      filename: "markitdown-conversion-review-inbox.md",
      fingerprintField: "review_inbox_fingerprint",
      precedence: 5,
      isRequired: false,
      ruleId: RuleIds.RRFG006_REVIEW_INBOX_STALE,
    },
    {
      sourceName: "markitdown-conversion-history",
      filename: "markitdown-conversion-history.ndjson",
      fingerprintField: "history_fingerprint",
      precedence: 6,
      isRequired: false,
      ruleId: RuleIds.RRFG007_HISTORY_STALE,
    },
  ],
};

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
TASKPAD MarkItDown Release Readiness Brief Freshness Gate

Validates that the generated release-readiness brief is fresh versus its
composite MarkItDown source artifacts by comparing artifact fingerprints
(content hash or mtime) and emitting deterministic violations with
machine-readable remediation.

USAGE:
  bun run taskpad:markitdown-release-readiness-brief-freshness-gate -- --taskpad <path> --plan <path> --project-root <path> [--vault-path <path>] [--format <format>]

OPTIONS:
  --taskpad <path>      Path to TASKPAD markdown file (required)
  --plan <path>         Path to IMPLEMENTATION_PLAN markdown file (required)
  --project-root <path> Project root directory for resolving file paths (required)
  --vault-path <path>   Path to Obsidian vault for artifact resolution (optional)
  --format <format>     Output format: json or human (default: json)
  --help, -h            Show this help message

EXIT CODES:
  0  Brief is fresh (all required composite inputs fresh)
  1  Brief is stale (one or more required composite inputs stale)
  2  Input validation failure (invalid arguments, unreadable files)

EXAMPLES:
  # Check freshness with JSON output
  bun run taskpad:markitdown-release-readiness-brief-freshness-gate -- \\
    --taskpad "TASKPAD.md" \\
    --plan IMPLEMENTATION_PLAN.md \\
    --project-root . \\
    --format json

  # Check with vault path for artifact resolution
  bun run taskpad:markitdown-release-readiness-brief-freshness-gate -- \\
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
 * Check freshness for a single source artifact
 */
function checkSourceFreshness(
  sourceConfig: SourceArtifactConfig,
  vaultPath: string | undefined,
  briefMtime: Date | null,
  sourceFingerprints: Record<string, string>
): SourceFreshnessCheck {
  const sourcePath = vaultPath
    ? join(vaultPath, sourceConfig.filename)
    : sourceConfig.filename;

  const sourceCheck: SourceFreshnessCheck = {
    sourceName: sourceConfig.sourceName,
    sourcePath,
    precedenceLevel: sourceConfig.precedence,
    isRequired: sourceConfig.isRequired,
    exists: existsSync(sourcePath),
    isStale: false,
  };

  if (!sourceCheck.exists) {
    sourceCheck.stalenessReason = "source-missing";
    return sourceCheck;
  }

  const sourceMtime = getFileMtime(sourcePath);

  if (briefMtime && sourceMtime) {
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
        }
      }
    } else {
      // Fall back to mtime comparison
      if (isStaleByMtime(briefMtime, sourceMtime)) {
        sourceCheck.isStale = true;
        sourceCheck.stalenessReason = "missing-fingerprint";
      }
    }
  }

  return sourceCheck;
}

/**
 * Check freshness for the release-readiness brief
 */
export function checkBriefFreshness(
  config: BriefConfig,
  vaultPath: string | undefined
): BriefFreshnessCheck {
  const briefPath = vaultPath
    ? join(vaultPath, config.briefFilename)
    : config.briefFilename;

  const exists = existsSync(briefPath);
  const requiredCompositeInputs: SourceFreshnessCheck[] = [];
  const upstreamSurfaces: SourceFreshnessCheck[] = [];
  let isStale = false;
  let generatedAt: string | undefined;
  let hasFingerprints = false;
  let parseError: string | undefined;
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
    } catch (err) {
      parseError = err instanceof Error ? err.message : "Unknown parse error";
    }
  }

  // Check required composite inputs
  for (const sourceConfig of config.requiredCompositeInputs) {
    const sourceCheck = checkSourceFreshness(
      sourceConfig,
      vaultPath,
      briefMtime,
      sourceFingerprints
    );
    requiredCompositeInputs.push(sourceCheck);

    if (sourceCheck.isStale && sourceConfig.isRequired) {
      isStale = true;
    }
  }

  // Check upstream surfaces
  for (const sourceConfig of config.upstreamSurfaces) {
    const sourceCheck = checkSourceFreshness(
      sourceConfig,
      vaultPath,
      briefMtime,
      sourceFingerprints
    );
    upstreamSurfaces.push(sourceCheck);
    // Upstream staleness doesn't cause gate failure, just warnings
  }

  return {
    briefName: config.briefName,
    briefPath,
    exists,
    isStale: isStale || !exists,
    generatedAt,
    hasFingerprints,
    parseError,
    requiredCompositeInputs,
    upstreamSurfaces,
  };
}

/**
 * Generate scaffold command for brief regeneration
 */
function generateScaffoldCommand(vaultPath: string | undefined): string {
  const vaultArg = vaultPath ? ` --vault-path "${vaultPath}"` : "";
  return `bun run refresh:refreshMarkitdownReleaseReadinessBrief${vaultArg}`;
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
 * Generate violations from freshness check results
 */
export function generateViolations(
  briefCheck: BriefFreshnessCheck,
  config: BriefConfig,
  vaultPath: string | undefined
): FreshnessViolation[] {
  const violations: FreshnessViolation[] = [];
  const scaffoldCommand = generateScaffoldCommand(vaultPath);

  // RRFG001: Brief not found
  if (!briefCheck.exists) {
    violations.push({
      ruleId: RuleIds.RRFG001_BRIEF_NOT_FOUND,
      severity: "warning",
      briefName: config.briefName,
      briefPath: briefCheck.briefPath,
      details: {},
      remediation: {
        description: `Release-readiness brief does not exist. Run the scaffold command to generate it.`,
        scaffoldCommand,
      },
    });
    return violations;
  }

  // RRFG011: Fingerprint parse error
  if (briefCheck.parseError) {
    violations.push({
      ruleId: RuleIds.RRFG011_FINGERPRINT_PARSE_ERROR,
      severity: "error",
      briefName: config.briefName,
      briefPath: briefCheck.briefPath,
      details: {},
      remediation: {
        description: `Brief frontmatter has malformed fingerprint data. Run the scaffold command to regenerate with valid fingerprints.`,
        scaffoldCommand,
      },
    });
    return violations;
  }

  // Check required composite inputs
  let hasRequiredStale = false;
  const allSources = [...briefCheck.requiredCompositeInputs, ...briefCheck.upstreamSurfaces];
  const existingSources = allSources.filter((s) => s.exists);

  // RRFG010: No sources found
  if (existingSources.length === 0) {
    violations.push({
      ruleId: RuleIds.RRFG010_NO_SOURCES_FOUND,
      severity: "warning",
      briefName: config.briefName,
      briefPath: briefCheck.briefPath,
      details: {},
      remediation: {
        description: `No source artifacts found. Brief may be orphaned or sources need to be generated first.`,
        scaffoldCommand,
      },
    });
  }

  // Process required composite inputs
  for (const sourceCheck of briefCheck.requiredCompositeInputs) {
    // RRFG009: Source missing
    if (!sourceCheck.exists) {
      violations.push({
        ruleId: RuleIds.RRFG009_SOURCE_MISSING,
        severity: "warning",
        briefName: config.briefName,
        briefPath: briefCheck.briefPath,
        sourceName: sourceCheck.sourceName,
        sourcePath: sourceCheck.sourcePath,
        details: {
          precedenceLevel: sourceCheck.precedenceLevel,
          isRequired: sourceCheck.isRequired,
        },
        remediation: {
          description: `Source \`${sourceCheck.sourceName}\` does not exist. Brief may be orphaned. Consider generating source first or removing brief.`,
          scaffoldCommand,
        },
      });
      continue;
    }

    if (sourceCheck.isStale) {
      hasRequiredStale = true;

      // RRFG008: Missing fingerprint
      if (sourceCheck.stalenessReason === "missing-fingerprint") {
        violations.push({
          ruleId: RuleIds.RRFG008_MISSING_FINGERPRINT,
          severity: "error",
          briefName: config.briefName,
          briefPath: briefCheck.briefPath,
          sourceName: sourceCheck.sourceName,
          sourcePath: sourceCheck.sourcePath,
          details: {
            briefFingerprint: sourceCheck.briefFingerprint,
            currentFingerprint: sourceCheck.currentFingerprint,
            precedenceLevel: sourceCheck.precedenceLevel,
            isRequired: sourceCheck.isRequired,
          },
          remediation: {
            description: `Brief lacks fingerprint for source \`${sourceCheck.sourceName}\`. Run the scaffold command to regenerate with proper fingerprints.`,
            scaffoldCommand,
          },
        });
      } else {
        // RRFG002-005: Source is newer (required composite)
        const sourceConfig = config.requiredCompositeInputs.find(
          (s) => s.sourceName === sourceCheck.sourceName
        );
        const ruleId = sourceConfig?.ruleId || RuleIds.RRFG008_MISSING_FINGERPRINT;

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
            precedenceLevel: sourceCheck.precedenceLevel,
            isRequired: sourceCheck.isRequired,
          },
          remediation: {
            description: `${getSourceDescription(sourceCheck.sourceName)} source is newer than release-readiness brief. Brief generated at ${sourceCheck.briefMtime} but source modified at ${sourceCheck.sourceMtime}. Run the scaffold command to refresh.`,
            scaffoldCommand,
          },
        });
      }
    }
  }

  // Process upstream surfaces
  for (const sourceCheck of briefCheck.upstreamSurfaces) {
    // RRFG009: Source missing (upstream)
    if (!sourceCheck.exists) {
      violations.push({
        ruleId: RuleIds.RRFG009_SOURCE_MISSING,
        severity: "warning",
        briefName: config.briefName,
        briefPath: briefCheck.briefPath,
        sourceName: sourceCheck.sourceName,
        sourcePath: sourceCheck.sourcePath,
        details: {
          precedenceLevel: sourceCheck.precedenceLevel,
          isRequired: sourceCheck.isRequired,
        },
        remediation: {
          description: `Source \`${sourceCheck.sourceName}\` does not exist. Brief may be orphaned. Consider generating source first.`,
          scaffoldCommand,
        },
      });
      continue;
    }

    if (sourceCheck.isStale) {
      // RRFG006-007: Upstream surface is newer (warning, not error)
      const sourceConfig = config.upstreamSurfaces.find(
        (s) => s.sourceName === sourceCheck.sourceName
      );
      const ruleId = sourceConfig?.ruleId || RuleIds.RRFG006_REVIEW_INBOX_STALE;

      violations.push({
        ruleId,
        severity: "warning",
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
          precedenceLevel: sourceCheck.precedenceLevel,
          isRequired: sourceCheck.isRequired,
        },
        remediation: {
          description: `${getSourceDescription(sourceCheck.sourceName)} upstream surface is newer than release-readiness brief. Consider refreshing for latest context. Run the scaffold command.`,
          scaffoldCommand,
        },
      });
    }
  }

  // RRFG012: Aggregate stale (when any required composite input is stale)
  if (hasRequiredStale) {
    violations.push({
      ruleId: RuleIds.RRFG012_AGGREGATE_STALE,
      severity: "error",
      briefName: config.briefName,
      briefPath: briefCheck.briefPath,
      details: {},
      remediation: {
        description: `Release-readiness brief has stale composite inputs. Run the scaffold command to refresh with latest source data.`,
        scaffoldCommand,
      },
    });
  }

  return violations;
}

/**
 * Get human-readable source description
 */
function getSourceDescription(sourceName: string): string {
  const descriptions: Record<string, string> = {
    "markitdown-conversion-priority-brief": "Priority-brief",
    "markitdown-conversion-regression-hotspots": "Regression-hotspots",
    "markitdown-conversion-remediation-playbook": "Remediation-playbook",
    "markitdown-conversion-state-sync": "State-sync",
    "markitdown-conversion-review-inbox": "Review-inbox",
    "markitdown-conversion-history": "History",
  };
  return descriptions[sourceName] || sourceName;
}

/**
 * Sort violations by canonical rule ID order and precedence
 */
function sortViolationsByCanonicalOrder(violations: FreshnessViolation[]): FreshnessViolation[] {
  const orderMap = new Map(CANONICAL_VIOLATION_ORDER.map((id, index) => [id, index]));

  return violations.sort((a, b) => {
    // 1. Severity: error < warning
    const severityOrder = { error: 0, warning: 1 };
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;

    // 2. Rule ID (canonical order)
    const orderA = orderMap.get(a.ruleId) ?? Number.MAX_SAFE_INTEGER;
    const orderB = orderMap.get(b.ruleId) ?? Number.MAX_SAFE_INTEGER;
    const ruleDiff = orderA - orderB;
    if (ruleDiff !== 0) return ruleDiff;

    // 3. Precedence level (lower = higher priority)
    const precDiff = (a.details.precedenceLevel ?? 99) - (b.details.precedenceLevel ?? 99);
    if (precDiff !== 0) return precDiff;

    // 4. Source name (alphabetical)
    return (a.sourceName ?? "").localeCompare(b.sourceName ?? "");
  });
}

// =============================================================================
// Output Formatting
// =============================================================================

/**
 * Format result as JSON
 */
function formatJson(result: ReleaseReadinessFreshnessResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format result as human-readable text
 */
function formatHuman(result: ReleaseReadinessFreshnessResult): string {
  const lines: string[] = [];
  const statusUpper = result.status.toUpperCase();

  lines.push(`TASKPAD MarkItDown Release Readiness Brief Freshness Gate: ${statusUpper}`);
  lines.push("────────────────────────────────────────────────────────────────────");
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

  // Brief section
  lines.push(`Brief: ${result.brief.briefName}`);
  lines.push(`  - Exists: ${result.brief.exists ? "yes" : "no"}`);
  lines.push(`  - Fresh: ${result.brief.isStale ? "no" : "yes"}`);
  if (result.brief.generatedAt) {
    lines.push(`  - Generated: ${result.brief.generatedAt}`);
  }
  lines.push("");

  // Required Composite Inputs section
  lines.push("Required Composite Inputs:");
  for (let i = 0; i < result.sources.requiredCompositeInputs.length; i++) {
    const source = result.sources.requiredCompositeInputs[i];
    const status = !source.exists ? "⚠ missing"
      : source.isStale ? "✗ stale"
      : "✓ fresh";
    lines.push(`  ${i + 1}. ${source.sourceName}`);
    lines.push(`     - Precedence: ${source.precedenceLevel}`);
    lines.push(`     - Exists: ${source.exists ? "yes" : "no"}`);
    lines.push(`     - Fresh: ${status}`);
  }
  lines.push("");

  // Upstream Surfaces section
  lines.push("Upstream Surfaces:");
  for (let i = 0; i < result.sources.upstreamSurfaces.length; i++) {
    const source = result.sources.upstreamSurfaces[i];
    const status = !source.exists ? "⚠ missing"
      : source.isStale ? "✗ stale"
      : "✓ fresh";
    lines.push(`  ${result.sources.requiredCompositeInputs.length + i + 1}. ${source.sourceName}`);
    lines.push(`     - Precedence: ${source.precedenceLevel}`);
    lines.push(`     - Exists: ${source.exists ? "yes" : "no"}`);
    lines.push(`     - Fresh: ${status}`);
  }
  lines.push("");

  // Summary section
  lines.push("Summary:");
  lines.push(`  - Total sources: ${result.summary.totalSources}`);
  lines.push(`  - Fresh: ${result.summary.freshSources}`);
  lines.push(`  - Stale: ${result.summary.staleSources}`);
  lines.push(`  - Missing: ${result.summary.missingSources}`);
  lines.push(`  - Required stale: ${result.summary.requiredStale}`);
  lines.push(`  - Upstream stale: ${result.summary.upstreamStale}`);
  lines.push("");

  // Violations section
  lines.push(`Violations: ${result.violations.length}`);
  for (const violation of result.violations) {
    lines.push(`  - [${violation.ruleId}] ${violation.severity}: ${violation.remediation.description}`);
    if (violation.sourceName) {
      lines.push(`    Source: ${violation.sourceName}`);
    }
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

  // Check freshness for the release-readiness brief
  const briefCheck = checkBriefFreshness(BRIEF_CONFIG, cliArgs.vaultPath);

  // Generate violations
  const violations = generateViolations(briefCheck, BRIEF_CONFIG, cliArgs.vaultPath);

  // Sort violations by canonical order
  const sortedViolations = sortViolationsByCanonicalOrder(violations);

  // Calculate summary
  const allSources = [...briefCheck.requiredCompositeInputs, ...briefCheck.upstreamSurfaces];
  const summary: Summary = {
    totalSources: allSources.length,
    freshSources: allSources.filter((s) => s.exists && !s.isStale).length,
    staleSources: allSources.filter((s) => s.exists && s.isStale).length,
    missingSources: allSources.filter((s) => !s.exists).length,
    requiredStale: briefCheck.requiredCompositeInputs.filter((s) => s.exists && s.isStale).length,
    upstreamStale: briefCheck.upstreamSurfaces.filter((s) => s.exists && s.isStale).length,
  };

  // Determine overall status
  // Status is "fail" if there are any error-level violations (required composite inputs stale)
  const hasErrors = sortedViolations.some((v) => v.severity === "error");
  const status: "pass" | "fail" = hasErrors ? "fail" : "pass";

  const result: ReleaseReadinessFreshnessResult = {
    status,
    inputs: {
      taskpadPath: cliArgs.taskpadPath,
      planPath: cliArgs.planPath,
      projectRoot: cliArgs.projectRoot,
      vaultPath: cliArgs.vaultPath,
    },
    brief: {
      briefName: briefCheck.briefName,
      briefPath: briefCheck.briefPath,
      exists: briefCheck.exists,
      isStale: briefCheck.isStale,
      generatedAt: briefCheck.generatedAt,
    },
    sources: {
      requiredCompositeInputs: briefCheck.requiredCompositeInputs,
      upstreamSurfaces: briefCheck.upstreamSurfaces,
    },
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
