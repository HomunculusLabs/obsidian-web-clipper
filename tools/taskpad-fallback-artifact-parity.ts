#!/usr/bin/env bun

/**
 * TASKPAD Fallback Artifact Parity Checker
 *
 * Validates that mutator fallback artifacts are in a resolved state
 * (applied, noop, or rejected) before allowing autonomous Builder handoff.
 *
 * This tool implements TP002: parser/resolver that discovers newest mutator
 * fallback artifacts and correlates them with apply outcomes.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, basename, dirname } from "node:path";

// =============================================================================
// Error Codes (Deterministic)
// =============================================================================

export const ErrorCodes = {
  FAP001_PENDING_ARTIFACT: "FAP001_PENDING_ARTIFACT",
  FAP002_MISSING_APPLY_EVIDENCE: "FAP002_MISSING_APPLY_EVIDENCE",
  FAP003_SHA_PATH_MISMATCH: "FAP003_SHA_PATH_MISMATCH",
  FAP004_STALE_ARTIFACT: "FAP004_STALE_ARTIFACT",
  FAP005_ARTIFACT_NOT_FOUND: "FAP005_ARTIFACT_NOT_FOUND",
  FAP006_ARTIFACT_PARSE_ERROR: "FAP006_ARTIFACT_PARSE_ERROR",
  FAP007_ARTIFACT_SCHEMA_INVALID: "FAP007_ARTIFACT_SCHEMA_INVALID",
  FAP008_ARTIFACT_VERSION_UNSUPPORTED: "FAP008_ARTIFACT_VERSION_UNSUPPORTED",
  FAP009_ARTIFACT_KIND_UNKNOWN: "FAP009_ARTIFACT_KIND_UNKNOWN",
  FAP010_REJECTED_ARTIFACT: "FAP010_REJECTED_ARTIFACT",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// =============================================================================
// Type Definitions
// =============================================================================

export type LifecycleState = "generated" | "pending" | "applied" | "noop" | "rejected" | "stale";

export type OutputFormat = "json" | "human";

export type ApplyStatus = "applied" | "noop" | "rejected";

/**
 * Supported artifact kinds from mutators
 */
export type MutatorArtifactKind =
  | "taskpad-auto-ideation-fallback-patch"
  | "taskpad-plan-seed-fallback-patch"
  | "taskpad-intake-autoplan-fallback-patch"
  | "taskpad-queue-reconcile-fallback-patch";

/**
 * Mutator source identifiers
 */
export type MutatorSource =
  | "taskpad:auto-ideation"
  | "taskpad:plan-seed"
  | "taskpad:intake:autoplan"
  | "queue-reconcile";

/**
 * Base artifact fields shared across all kinds
 */
interface BaseArtifactFields {
  version: number;
  taskpadPath: string;
  taskpadSha256: string;
  applyHint: string;
}

/**
 * Auto-ideation artifact: single-file patch for TASKPAD
 */
export interface AutoIdeationArtifact extends BaseArtifactFields {
  kind: "taskpad-auto-ideation-fallback-patch";
  selectedCandidateId: string;
  selectedOutcome: {
    action: "would-insert";
    canonicalBullet: string;
    insertedLine: number;
  };
  patch: {
    format: "unified-diff";
    targetPath: string;
    content: string;
  };
}

/**
 * Plan-seed artifact: dual-file patch for TASKPAD + IMPLEMENTATION_PLAN
 */
export interface PlanSeedArtifact extends BaseArtifactFields {
  kind: "taskpad-plan-seed-fallback-patch";
  planPath: string;
  planSha256: string;
  mutationId: string;
  mutationOutcome: {
    action: "would-insert-taskpad" | "would-insert-plan";
    taskpadUpdatedLine: string | null;
    planInsertHeading: string | null;
    selectedBacklogLine: number;
  };
  patch: {
    format: "unified-diff";
    taskpadTargetPath: string;
    planTargetPath: string;
    taskpadPatchContent: string | null;
    planPatchContent: string | null;
  };
}

/**
 * Discriminated union for all supported artifact kinds
 */
export type FallbackArtifact = AutoIdeationArtifact | PlanSeedArtifact;

/**
 * Apply evidence from taskpad:apply-fallback output
 */
export interface ApplyEvidence {
  status: ApplyStatus;
  taskpadPath: string;
  artifactPath: string;
  reasonCode: string | null;
  message: string;
  appliedAt: string | null;
}

/**
 * Artifact entry with lifecycle state and evidence
 */
export interface ArtifactEntry {
  artifactPath: string;
  artifactKind: MutatorArtifactKind;
  taskpadPath: string;
  mutatorSource: MutatorSource;
  lifecycleState: LifecycleState;
  evidence: {
    artifactExists: boolean;
    artifactSha256: string | null;
    taskpadSha256: string | null;
    hashMatches: boolean;
    applyEvidence: {
      status: ApplyStatus | null;
      reasonCode: string | null;
      appliedAt: string | null;
      artifactPath: string | null;
    };
  };
}

/**
 * Violation entry for output
 */
export interface Violation {
  ruleId: ErrorCode;
  severity: "error" | "warning";
  artifactPath: string;
  artifactKind: MutatorArtifactKind;
  taskpadPath: string;
  mutatorSource: MutatorSource;
  details: {
    lifecycleState: LifecycleState;
    artifactExists: boolean;
    taskpadSha256: string | null;
    artifactSha256: string | null;
    hashMatches: boolean;
  };
  remediation: string;
}

/**
 * Summary statistics
 */
export interface Summary {
  totalArtifacts: number;
  resolvedArtifacts: number;
  pendingArtifacts: number;
  rejectedArtifacts: number;
  staleArtifacts: number;
}

/**
 * Full output envelope
 */
export interface FallbackParityResult {
  status: "pass" | "fail";
  inputs: {
    taskpadPath: string;
    planPath: string;
  };
  artifacts: ArtifactEntry[];
  summary: Summary;
  violations: Violation[];
  timestamp: string;
}

// =============================================================================
// Artifact Discovery
// =============================================================================

/**
 * Canonical artifact directories for each mutator
 */
const ARTIFACT_DIRECTORIES: ReadonlyArray<{ dir: string; mutatorSource: MutatorSource }> = [
  { dir: "artifacts/taskpad-auto-ideation", mutatorSource: "taskpad:auto-ideation" },
  { dir: "artifacts/taskpad-plan-seed", mutatorSource: "taskpad:plan-seed" },
  { dir: "artifacts/taskpad-intake-autoplan", mutatorSource: "taskpad:intake:autoplan" },
  { dir: "artifacts/taskpad-queue-reconcile", mutatorSource: "queue-reconcile" },
];

/**
 * Artifact file pattern matching
 */
const ARTIFACT_FILE_PATTERN = /\.patch\.json$/;

/**
 * Discovered artifact file with metadata
 */
interface DiscoveredArtifactFile {
  path: string;
  mutatorSource: MutatorSource;
  mtimeMs: number;
}

/**
 * Discover all fallback artifact files from canonical directories
 */
export function discoverArtifactFiles(cwd: string = "."): DiscoveredArtifactFile[] {
  const discovered: DiscoveredArtifactFile[] = [];

  for (const { dir, mutatorSource } of ARTIFACT_DIRECTORIES) {
    const dirPath = resolve(cwd, dir);

    if (!existsSync(dirPath)) {
      continue;
    }

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile() || !ARTIFACT_FILE_PATTERN.test(entry.name)) {
          continue;
        }

        const filePath = resolve(dirPath, entry.name);
        const stats = statSync(filePath);

        discovered.push({
          path: filePath,
          mutatorSource,
          mtimeMs: stats.mtimeMs,
        });
      }
    } catch (error) {
      // Skip directories we can't read
      continue;
    }
  }

  return discovered;
}

/**
 * Select newest artifact for each taskpadPath
 * Returns all artifacts sorted by modification time (newest first)
 */
export function selectNewestArtifacts(artifacts: DiscoveredArtifactFile[]): DiscoveredArtifactFile[] {
  // Sort all artifacts by modification time (newest first)
  const sorted = [...artifacts].sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Group by taskpadPath (we need to parse artifacts first to get taskpadPath)
  // This will be done after parsing
  return sorted;
}

// =============================================================================
// Artifact Parsing
// =============================================================================

/**
 * Parse and validate a single artifact file
 */
export function parseArtifactFile(artifactPath: string): FallbackArtifact | null {
  try {
    if (!existsSync(artifactPath)) {
      return null;
    }

    const content = readFileSync(artifactPath, "utf8");
    const parsed = JSON.parse(content) as unknown;

    return validateArtifactSchema(parsed);
  } catch (error) {
    return null;
  }
}

/**
 * Validate artifact schema and return typed artifact or null
 */
export function validateArtifactSchema(obj: unknown): FallbackArtifact | null {
  if (typeof obj !== "object" || obj === null) {
    return null;
  }

  const artifact = obj as Record<string, unknown>;

  // Check version
  if (typeof artifact.version !== "number" || artifact.version !== 1) {
    return null;
  }

  // Check kind
  if (typeof artifact.kind !== "string") {
    return null;
  }

  const kind = artifact.kind as MutatorArtifactKind;

  // Validate based on kind
  if (kind === "taskpad-auto-ideation-fallback-patch") {
    return validateAutoIdeationArtifact(artifact);
  }

  if (kind === "taskpad-plan-seed-fallback-patch") {
    return validatePlanSeedArtifact(artifact);
  }

  // Other kinds are not yet fully implemented but we can accept them
  if (
    kind === "taskpad-intake-autoplan-fallback-patch" ||
    kind === "taskpad-queue-reconcile-fallback-patch"
  ) {
    return artifact as FallbackArtifact;
  }

  return null;
}

/**
 * Validate auto-ideation artifact structure
 */
function validateAutoIdeationArtifact(obj: Record<string, unknown>): AutoIdeationArtifact | null {
  const required = [
    "version",
    "kind",
    "taskpadPath",
    "taskpadSha256",
    "applyHint",
    "selectedCandidateId",
    "selectedOutcome",
    "patch",
  ];

  for (const field of required) {
    if (!(field in obj)) {
      return null;
    }
  }

  if (typeof obj.taskpadPath !== "string" || typeof obj.taskpadSha256 !== "string") {
    return null;
  }

  if (typeof obj.selectedCandidateId !== "string") {
    return null;
  }

  const outcome = obj.selectedOutcome as Record<string, unknown>;
  if (
    !outcome ||
    typeof outcome.action !== "string" ||
    outcome.action !== "would-insert" ||
    typeof outcome.canonicalBullet !== "string" ||
    typeof outcome.insertedLine !== "number"
  ) {
    return null;
  }

  const patch = obj.patch as Record<string, unknown>;
  if (!patch || typeof patch.format !== "string" || patch.format !== "unified-diff") {
    return null;
  }

  return obj as AutoIdeationArtifact;
}

/**
 * Validate plan-seed artifact structure
 */
function validatePlanSeedArtifact(obj: Record<string, unknown>): PlanSeedArtifact | null {
  const required = [
    "version",
    "kind",
    "taskpadPath",
    "taskpadSha256",
    "applyHint",
    "planPath",
    "planSha256",
    "mutationId",
    "mutationOutcome",
    "patch",
  ];

  for (const field of required) {
    if (!(field in obj)) {
      return null;
    }
  }

  if (typeof obj.taskpadPath !== "string" || typeof obj.taskpadSha256 !== "string") {
    return null;
  }

  if (typeof obj.planPath !== "string" || typeof obj.planSha256 !== "string") {
    return null;
  }

  if (typeof obj.mutationId !== "string") {
    return null;
  }

  const outcome = obj.mutationOutcome as Record<string, unknown>;
  if (!outcome || typeof outcome.action !== "string") {
    return null;
  }

  if (
    outcome.action !== "would-insert-taskpad" &&
    outcome.action !== "would-insert-plan"
  ) {
    return null;
  }

  const patch = obj.patch as Record<string, unknown>;
  if (!patch || typeof patch.format !== "string" || patch.format !== "unified-diff") {
    return null;
  }

  return obj as PlanSeedArtifact;
}

// =============================================================================
// Hash Computation
// =============================================================================

/**
 * Compute SHA-256 hash of file content
 */
export function computeFileSha256(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf8");
    return createHash("sha256").update(content, "utf8").digest("hex");
  } catch {
    return "";
  }
}

/**
 * Compute SHA-256 hash of string content
 */
export function computeContentSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// =============================================================================
// Apply Evidence Discovery
// =============================================================================

/**
 * Apply evidence storage directory
 */
const APPLY_EVIDENCE_DIR = "artifacts/taskpad-apply-fallback";

/**
 * Apply evidence file pattern
 */
const APPLY_EVIDENCE_PATTERN = /^apply-fallback-(.+)\.json$/;

/**
 * Discovered apply evidence file
 */
interface DiscoveredApplyEvidence {
  artifactPath: string;
  evidencePath: string;
  evidence: ApplyEvidence;
}

/**
 * Discover all apply-fallback evidence files
 */
export function discoverApplyEvidence(cwd: string = "."): DiscoveredApplyEvidence[] {
  const discovered: DiscoveredApplyEvidence[] = [];
  const dirPath = resolve(cwd, APPLY_EVIDENCE_DIR);

  if (!existsSync(dirPath)) {
    return discovered;
  }

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const match = entry.name.match(APPLY_EVIDENCE_PATTERN);
      if (!match) {
        continue;
      }

      const evidencePath = resolve(dirPath, entry.name);

      try {
        const content = readFileSync(evidencePath, "utf8");
        const evidence = JSON.parse(content) as ApplyEvidence;

        // Validate evidence structure
        if (
          typeof evidence.status === "string" &&
          typeof evidence.taskpadPath === "string" &&
          typeof evidence.artifactPath === "string" &&
          (evidence.status === "applied" || evidence.status === "noop" || evidence.status === "rejected")
        ) {
          discovered.push({
            artifactPath: evidence.artifactPath,
            evidencePath,
            evidence,
          });
        }
      } catch {
        // Skip invalid evidence files
        continue;
      }
    }
  } catch {
    // Skip directory if we can't read it
  }

  return discovered;
}

/**
 * Build evidence index by artifact path
 */
export function buildApplyEvidenceIndex(evidence: DiscoveredApplyEvidence[]): Map<string, ApplyEvidence> {
  const index = new Map<string, ApplyEvidence>();

  for (const e of evidence) {
    // Store the most recent evidence for each artifact path
    // (currently we just take whatever we find; could sort by timestamp if needed)
    index.set(e.artifactPath, e.evidence);
  }

  return index;
}

// =============================================================================
// Lifecycle State Determination
// =============================================================================

/**
 * Determine lifecycle state for an artifact
 */
export function determineLifecycleState(
  artifact: FallbackArtifact,
  currentTaskpadSha256: string,
  applyEvidenceIndex: Map<string, ApplyEvidence>,
  artifactPath: string,
): LifecycleState {
  // Check if we have apply evidence for this artifact
  const evidence = applyEvidenceIndex.get(artifactPath);

  if (evidence) {
    // Apply evidence exists - use status to determine state
    if (evidence.status === "applied") {
      return "applied";
    }
    if (evidence.status === "noop") {
      return "noop";
    }
    if (evidence.status === "rejected") {
      return "rejected";
    }
  }

  // No apply evidence - check if hash matches
  if (artifact.taskpadSha256 === currentTaskpadSha256) {
    // Hash matches - artifact is pending (exists but not applied)
    return "pending";
  }

  // Hash doesn't match and no evidence
  // This could mean the file was modified after artifact generation
  // For now, we treat it as pending (would fail apply due to hash mismatch)
  return "pending";
}

/**
 * Mark stale artifacts (superseded by newer artifacts for same taskpadPath)
 */
export function markStaleArtifacts(artifacts: ArtifactEntry[]): ArtifactEntry[] {
  const newestByTaskpadPath = new Map<string, number>();

  // Find newest artifact for each taskpadPath
  artifacts.forEach((artifact, index) => {
    const existing = newestByTaskpadPath.get(artifact.taskpadPath);
    if (existing === undefined || index < existing) {
      newestByTaskpadPath.set(artifact.taskpadPath, index);
    }
  });

  // Mark non-newest artifacts as stale
  return artifacts.map((artifact, index) => {
    const newestIndex = newestByTaskpadPath.get(artifact.taskpadPath);
    if (newestIndex !== undefined && index !== newestIndex) {
      return { ...artifact, lifecycleState: "stale" as LifecycleState };
    }
    return artifact;
  });
}

// =============================================================================
// Violation Generation
// =============================================================================

/**
 * Generate violations for artifacts with unresolved states
 */
export function generateViolations(artifacts: ArtifactEntry[]): Violation[] {
  const violations: Violation[] = [];

  for (const artifact of artifacts) {
    // Skip stale artifacts (warning only, not error)
    if (artifact.lifecycleState === "stale") {
      violations.push({
        ruleId: ErrorCodes.FAP004_STALE_ARTIFACT,
        severity: "warning",
        artifactPath: artifact.artifactPath,
        artifactKind: artifact.artifactKind,
        taskpadPath: artifact.taskpadPath,
        mutatorSource: artifact.mutatorSource,
        details: {
          lifecycleState: artifact.lifecycleState,
          artifactExists: artifact.evidence.artifactExists,
          taskpadSha256: artifact.evidence.taskpadSha256,
          artifactSha256: artifact.evidence.artifactSha256,
          hashMatches: artifact.evidence.hashMatches,
        },
        remediation: "This artifact has been superseded by a newer artifact for the same TASKPAD. The newer artifact should be applied instead.",
      });
      continue;
    }

    // Generate error violations for pending/rejected artifacts
    if (artifact.lifecycleState === "pending") {
      violations.push({
        ruleId: ErrorCodes.FAP001_PENDING_ARTIFACT,
        severity: "error",
        artifactPath: artifact.artifactPath,
        artifactKind: artifact.artifactKind,
        taskpadPath: artifact.taskpadPath,
        mutatorSource: artifact.mutatorSource,
        details: {
          lifecycleState: artifact.lifecycleState,
          artifactExists: artifact.evidence.artifactExists,
          taskpadSha256: artifact.evidence.taskpadSha256,
          artifactSha256: artifact.evidence.artifactSha256,
          hashMatches: artifact.evidence.hashMatches,
        },
        remediation: "Apply the fallback artifact using taskpad:apply-fallback or explicitly reject it.",
      });
    }

    if (artifact.lifecycleState === "rejected") {
      violations.push({
        ruleId: ErrorCodes.FAP010_REJECTED_ARTIFACT,
        severity: "error",
        artifactPath: artifact.artifactPath,
        artifactKind: artifact.artifactKind,
        taskpadPath: artifact.taskpadPath,
        mutatorSource: artifact.mutatorSource,
        details: {
          lifecycleState: artifact.lifecycleState,
          artifactExists: artifact.evidence.artifactExists,
          taskpadSha256: artifact.evidence.taskpadSha256,
          artifactSha256: artifact.evidence.artifactSha256,
          hashMatches: artifact.evidence.hashMatches,
        },
        remediation: `Artifact was rejected by apply-fallback. Review the rejection reason and either fix the underlying issue or remove the artifact.`,
      });
    }

    // Check for missing apply evidence on generated artifacts
    if (
      artifact.lifecycleState === "generated" &&
      artifact.evidence.applyEvidence.status === null
    ) {
      violations.push({
        ruleId: ErrorCodes.FAP002_MISSING_APPLY_EVIDENCE,
        severity: "error",
        artifactPath: artifact.artifactPath,
        artifactKind: artifact.artifactKind,
        taskpadPath: artifact.taskpadPath,
        mutatorSource: artifact.mutatorSource,
        details: {
          lifecycleState: artifact.lifecycleState,
          artifactExists: artifact.evidence.artifactExists,
          taskpadSha256: artifact.evidence.taskpadSha256,
          artifactSha256: artifact.evidence.artifactSha256,
          hashMatches: artifact.evidence.hashMatches,
        },
        remediation: "Run taskpad:apply-fallback to apply this artifact, or explicitly reject it if it's no longer needed.",
      });
    }

    // Check for SHA/path mismatch
    if (
      artifact.artifactKind === "taskpad-plan-seed-fallback-patch" ||
      artifact.artifactKind === "taskpad-auto-ideation-fallback-patch"
    ) {
      const parsedArtifact = parseArtifactFile(artifact.artifactPath);
      if (parsedArtifact && parsedArtifact.taskpadPath !== artifact.taskpadPath) {
        violations.push({
          ruleId: ErrorCodes.FAP003_SHA_PATH_MISMATCH,
          severity: "error",
          artifactPath: artifact.artifactPath,
          artifactKind: artifact.artifactKind,
          taskpadPath: artifact.taskpadPath,
          mutatorSource: artifact.mutatorSource,
          details: {
            lifecycleState: artifact.lifecycleState,
            artifactExists: artifact.evidence.artifactExists,
            taskpadSha256: artifact.evidence.taskpadSha256,
            artifactSha256: artifact.evidence.artifactSha256,
            hashMatches: artifact.evidence.hashMatches,
          },
          remediation: "The artifact's taskpadPath does not match the input TASKPAD path. Verify the correct TASKPAD file is being validated.",
        });
      }
    }
  }

  return violations;
}

// =============================================================================
// Main Analysis Function
// =============================================================================

/**
 * Analyze fallback artifacts and determine parity state
 */
export function analyzeFallbackArtifactParity(
  taskpadPath: string,
  planPath: string,
  cwd: string = ".",
): FallbackParityResult {
  const resolvedTaskpadPath = resolve(cwd, taskpadPath);

  // Compute current TASKPAD SHA-256
  const currentTaskpadSha256 = computeFileSha256(resolvedTaskpadPath);

  // Discover artifacts
  const discoveredFiles = discoverArtifactFiles(cwd);
  const sortedFiles = selectNewestArtifacts(discoveredFiles);

  // Discover apply evidence
  const evidenceFiles = discoverApplyEvidence(cwd);
  const evidenceIndex = buildApplyEvidenceIndex(evidenceFiles);

  // Parse and categorize artifacts
  const artifactEntries: ArtifactEntry[] = [];

  for (const file of sortedFiles) {
    const artifact = parseArtifactFile(file.path);

    if (!artifact) {
      // Invalid artifact - skip
      continue;
    }

    const currentSha256 = artifact.taskpadSha256;
    const hashMatches = currentSha256 === currentTaskpadSha256;

    // Determine lifecycle state
    const lifecycleState = determineLifecycleState(
      artifact,
      currentTaskpadSha256,
      evidenceIndex,
      file.path,
    );

    // Map artifact kind to mutator source
    const mutatorSource = file.mutatorSource;
    const artifactKind = artifact.kind;

    // Get apply evidence if exists
    const applyEvidence = evidenceIndex.get(file.path);

    artifactEntries.push({
      artifactPath: file.path,
      artifactKind,
      taskpadPath: artifact.taskpadPath,
      mutatorSource,
      lifecycleState,
      evidence: {
        artifactExists: true,
        artifactSha256: currentSha256,
        taskpadSha256: currentTaskpadSha256,
        hashMatches,
        applyEvidence: applyEvidence
          ? {
              status: applyEvidence.status,
              reasonCode: applyEvidence.reasonCode,
              appliedAt: applyEvidence.appliedAt,
              artifactPath: applyEvidence.artifactPath,
            }
          : {
              status: null,
              reasonCode: null,
              appliedAt: null,
              artifactPath: null,
            },
      },
    });
  }

  // Mark stale artifacts
  const finalArtifacts = markStaleArtifacts(artifactEntries);

  // Generate violations
  const violations = generateViolations(finalArtifacts);

  // Compute summary
  const summary: Summary = {
    totalArtifacts: finalArtifacts.length,
    resolvedArtifacts: finalArtifacts.filter((a) => a.lifecycleState === "applied" || a.lifecycleState === "noop").length,
    pendingArtifacts: finalArtifacts.filter((a) => a.lifecycleState === "pending").length,
    rejectedArtifacts: finalArtifacts.filter((a) => a.lifecycleState === "rejected").length,
    staleArtifacts: finalArtifacts.filter((a) => a.lifecycleState === "stale").length,
  };

  // Determine pass/fail status
  const hasErrorViolations = violations.some((v) => v.severity === "error");
  const status: "pass" | "fail" = hasErrorViolations ? "fail" : "pass";

  return {
    status,
    inputs: {
      taskpadPath: resolvedTaskpadPath,
      planPath: resolve(cwd, planPath),
    },
    artifacts: finalArtifacts,
    summary,
    violations,
    timestamp: new Date().toISOString(),
  };
}

// =============================================================================
// Output Formatting
// =============================================================================

/**
 * Format result as JSON
 */
export function formatJsonOutput(result: FallbackParityResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format result as human-readable text
 */
export function formatHumanOutput(result: FallbackParityResult): string {
  const lines: string[] = [];

  lines.push(`TASKPAD Fallback Artifact Parity: ${result.status.toUpperCase()}`);
  lines.push("─".repeat(50));
  lines.push("");
  lines.push("Inputs:");
  lines.push(`  - taskpad: ${result.inputs.taskpadPath}`);
  lines.push(`  - plan: ${result.inputs.planPath}`);
  lines.push("");
  lines.push(`Artifacts: ${result.artifacts.length}`);

  for (const artifact of result.artifacts) {
    lines.push(`  1. ${artifact.artifactPath}`);
    lines.push(`     - kind: ${artifact.artifactKind}`);
    lines.push(`     - source: ${artifact.mutatorSource}`);
    lines.push(`     - state: ${artifact.lifecycleState}`);
    lines.push(`     - Hash matches: ${artifact.evidence.hashMatches}`);

    if (artifact.evidence.applyEvidence.appliedAt) {
      lines.push(`     - Applied at: ${artifact.evidence.applyEvidence.appliedAt}`);
    }
  }

  lines.push("");
  lines.push("Summary:");
  lines.push(`  - Total artifacts: ${result.summary.totalArtifacts}`);
  lines.push(`  - Resolved: ${result.summary.resolvedArtifacts}`);
  lines.push(`  - Pending: ${result.summary.pendingArtifacts}`);
  lines.push(`  - Rejected: ${result.summary.rejectedArtifacts}`);
  lines.push(`  - Stale: ${result.summary.staleArtifacts}`);
  lines.push("");

  if (result.violations.length > 0) {
    lines.push(`Violations: ${result.violations.length}`);
    for (const v of result.violations) {
      lines.push(
        `  - [${v.ruleId}] ${v.artifactPath} (${v.mutatorSource}) is ${v.details.lifecycleState}`,
      );
      lines.push(`    Remediation: ${v.remediation}`);
    }
  } else {
    lines.push("All fallback artifacts are in resolved state.");
  }

  return lines.join("\n");
}

// =============================================================================
// CLI Entry Point
// =============================================================================

interface CliArgs {
  taskpadPath?: string;
  planPath?: string;
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
TASKPAD Fallback Artifact Parity Checker

Validates that mutator fallback artifacts are in a resolved state
(applied, noop, or rejected) before allowing autonomous Builder handoff.

USAGE:
  bun run taskpad:fallback-artifact-parity -- --taskpad <path> --plan <path> [--format <format>]

OPTIONS:
  --taskpad <path>   Path to TASKPAD markdown file (required)
  --plan <path>      Path to IMPLEMENTATION_PLAN markdown file (required)
  --format <format>  Output format: json or human (default: json)
  --help, -h         Show this help message

EXIT CODES:
  0  All fallback artifacts are in resolved state
  1  One or more fallback artifacts are unresolved
  2  Input validation failure (invalid arguments, unreadable files)

EXAMPLES:
  # Check fallback artifacts with JSON output
  bun run taskpad:fallback-artifact-parity -- \\
    --taskpad "/path/to/TASKPAD.md" \\
    --plan IMPLEMENTATION_PLAN.md \\
    --format json

  # Check with human-readable output
  bun run taskpad:fallback-artifact-parity -- \\
    --taskpad TASKPAD.md \\
    --plan IMPLEMENTATION_PLAN.md \\
    --format human
`);
}

/**
 * Main CLI entry point
 */
export function main(args: string[]): void {
  const parsed = parseCliArgs(args);

  if (parsed.help) {
    showHelp();
    process.exit(0);
  }

  // Validate required arguments
  if (!parsed.taskpadPath || !parsed.planPath) {
    console.error("Error: --taskpad and --plan are required");
    console.error("Use --help for usage information");
    process.exit(2);
  }

  // Validate file paths
  if (!existsSync(parsed.taskpadPath)) {
    console.error(`Error: TASKPAD file not found: ${parsed.taskpadPath}`);
    process.exit(2);
  }

  if (!existsSync(parsed.planPath)) {
    console.error(`Error: IMPLEMENTATION_PLAN file not found: ${parsed.planPath}`);
    process.exit(2);
  }

  // Run analysis
  const result = analyzeFallbackArtifactParity(
    parsed.taskpadPath!,
    parsed.planPath!,
    ".",
  );

  // Format output
  const format = parsed.format ?? "json";
  const output =
    format === "human" ? formatHumanOutput(result) : formatJsonOutput(result);

  console.log(output);

  // Set exit code
  process.exit(result.status === "fail" ? 1 : 0);
}

// Run CLI if executed directly
if (import.meta.main) {
  main(process.argv.slice(2));
}
