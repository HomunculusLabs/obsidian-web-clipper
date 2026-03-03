#!/usr/bin/env bun

import { readFileSync, existsSync, statSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// =============================================================================
// Error Codes (Deterministic)
// =============================================================================

export const ErrorCodes = {
  ERR_ARTIFACT_PARSE: "ERR_ARTIFACT_PARSE",
  ERR_ARTIFACT_SCHEMA: "ERR_ARTIFACT_SCHEMA",
  ERR_ARTIFACT_VERSION_UNSUPPORTED: "ERR_ARTIFACT_VERSION_UNSUPPORTED",
  ERR_TASKPAD_PATH_MISMATCH: "ERR_TASKPAD_PATH_MISMATCH",
  ERR_TASKPAD_NOT_FOUND: "ERR_TASKPAD_NOT_FOUND",
  ERR_TASKPAD_HASH_MISMATCH: "ERR_TASKPAD_HASH_MISMATCH",
  ERR_PATCH_FORMAT_INVALID: "ERR_PATCH_FORMAT_INVALID",
  ERR_PATCH_APPLY_FAILED: "ERR_PATCH_APPLY_FAILED",
  ERR_WRITE_FAILED: "ERR_WRITE_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// =============================================================================
// Validation Result Types
// =============================================================================

export interface ValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ValidationFailure {
  success: false;
  code: ErrorCode;
  message: string;
  field?: string;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

// =============================================================================
// Artifact Contract Types
// =============================================================================

export const SUPPORTED_ARTIFACT_VERSION = 1;
export const SUPPORTED_ARTIFACT_KINDS = [
  "taskpad-auto-ideation-fallback-patch",
  "taskpad-plan-seed-fallback-patch",
] as const;
export const REQUIRED_PATCH_FORMAT = "unified-diff";

export type SupportedArtifactKind = (typeof SUPPORTED_ARTIFACT_KINDS)[number];

// Base artifact fields shared across all kinds
interface BaseArtifactFields {
  version: number;
  taskpadPath: string;
  taskpadSha256: string;
  applyHint: string;
}

// Auto-ideation artifact: single-file patch for TASKPAD
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

// Plan-seed artifact: dual-file patch for TASKPAD + IMPLEMENTATION_PLAN
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

// Discriminated union for all supported artifact kinds
export type FallbackPatchArtifact = AutoIdeationArtifact | PlanSeedArtifact;

// =============================================================================
// CLI Result Types
// =============================================================================

export type ApplyStatus = "applied" | "noop" | "rejected";

export interface ApplyFallbackResult {
  status: ApplyStatus;
  taskpadPath: string;
  artifactPath: string;
  reasonCode: ErrorCode | null;
  message: string;
  remediationHint: string | null;
}

// =============================================================================
// Artifact Parser / Validator Utilities
// =============================================================================

/**
 * Parse artifact JSON file and return raw parsed object or parse error.
 */
export function parseArtifactJson(artifactPath: string): ValidationResult<unknown> {
  try {
    if (!existsSync(artifactPath)) {
      return {
        success: false,
        code: ErrorCodes.ERR_ARTIFACT_PARSE,
        message: `Artifact file not found: ${artifactPath}`,
      };
    }

    const stats = statSync(artifactPath);
    if (!stats.isFile()) {
      return {
        success: false,
        code: ErrorCodes.ERR_ARTIFACT_PARSE,
        message: `Artifact path is not a file: ${artifactPath}`,
      };
    }

    const content = readFileSync(artifactPath, "utf8");
    if (content.trim().length === 0) {
      return {
        success: false,
        code: ErrorCodes.ERR_ARTIFACT_PARSE,
        message: `Artifact file is empty: ${artifactPath}`,
      };
    }

    const parsed = JSON.parse(content);
    return { success: true, data: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_PARSE,
      message: `Failed to parse artifact JSON: ${message}`,
    };
  }
}

/**
 * Validate that value is a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate that value is a positive integer (>= 1).
 */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * Validate SHA-256 hash format (64 lowercase hex characters).
 */
function isValidSha256Hash(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^[a-f0-9]{64}$/.test(value);
}

/**
 * Validate artifact version field.
 */
function validateArtifactVersion(version: unknown): ValidationResult<number> {
  if (typeof version !== "number") {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `Artifact version must be a number, received: ${typeof version}`,
      field: "version",
    };
  }

  if (version !== SUPPORTED_ARTIFACT_VERSION) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_VERSION_UNSUPPORTED,
      message: `Unsupported artifact version: ${version}. Supported: ${SUPPORTED_ARTIFACT_VERSION}`,
      field: "version",
    };
  }

  return { success: true, data: version };
}

/**
 * Validate artifact kind field.
 */
function validateArtifactKind(kind: unknown): ValidationResult<SupportedArtifactKind> {
  if (!isNonEmptyString(kind)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `Artifact kind must be a non-empty string, received: ${typeof kind}`,
      field: "kind",
    };
  }

  if (!SUPPORTED_ARTIFACT_KINDS.includes(kind as SupportedArtifactKind)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `Invalid artifact kind: "${kind}". Supported: [${SUPPORTED_ARTIFACT_KINDS.join(", ")}]`,
      field: "kind",
    };
  }

  return { success: true, data: kind as SupportedArtifactKind };
}

/**
 * Validate taskpadSha256 field (64-char lowercase hex).
 */
function validateTaskpadSha256(sha256: unknown): ValidationResult<string> {
  if (!isNonEmptyString(sha256)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `taskpadSha256 must be a non-empty string, received: ${typeof sha256}`,
      field: "taskpadSha256",
    };
  }

  if (!isValidSha256Hash(sha256)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `taskpadSha256 must be 64 lowercase hex characters, received: "${sha256.substring(0, 20)}${sha256.length > 20 ? "..." : ""}"`,
      field: "taskpadSha256",
    };
  }

  return { success: true, data: sha256 };
}

/**
 * Validate selectedOutcome.action field.
 */
function validateOutcomeAction(action: unknown): ValidationResult<string> {
  if (!isNonEmptyString(action)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `selectedOutcome.action must be a non-empty string, received: ${typeof action}`,
      field: "selectedOutcome.action",
    };
  }

  if (action !== REQUIRED_OUTCOME_ACTION) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `selectedOutcome.action must be "${REQUIRED_OUTCOME_ACTION}", received: "${action}"`,
      field: "selectedOutcome.action",
    };
  }

  return { success: true, data: action };
}

/**
 * Validate selectedOutcome.insertedLine field.
 */
function validateInsertedLine(line: unknown): ValidationResult<number> {
  if (!isPositiveInteger(line)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `selectedOutcome.insertedLine must be a positive integer (>= 1), received: ${typeof line === "number" ? line : typeof line}`,
      field: "selectedOutcome.insertedLine",
    };
  }

  return { success: true, data: line };
}

/**
 * Validate patch.format field.
 */
function validatePatchFormat(format: unknown): ValidationResult<string> {
  if (!isNonEmptyString(format)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `patch.format must be a non-empty string, received: ${typeof format}`,
      field: "patch.format",
    };
  }

  if (format !== REQUIRED_PATCH_FORMAT) {
    return {
      success: false,
      code: ErrorCodes.ERR_PATCH_FORMAT_INVALID,
      message: `patch.format must be "${REQUIRED_PATCH_FORMAT}", received: "${format}"`,
      field: "patch.format",
    };
  }

  return { success: true, data: format };
}

/**
 * Validate patch.content field (non-empty unified diff).
 */
function validatePatchContent(content: unknown): ValidationResult<string> {
  if (!isNonEmptyString(content)) {
    return {
      success: false,
      code: ErrorCodes.ERR_PATCH_FORMAT_INVALID,
      message: `patch.content must be a non-empty string, received: ${typeof content}`,
      field: "patch.content",
    };
  }

  // Basic unified diff validation: must contain @@ hunk headers
  if (!content.includes("@@")) {
    return {
      success: false,
      code: ErrorCodes.ERR_PATCH_FORMAT_INVALID,
      message: `patch.content does not appear to be a valid unified diff (missing @@ hunk headers)`,
      field: "patch.content",
    };
  }

  return { success: true, data: content };
}

/**
 * Validate selectedOutcome.action field (for auto-ideation artifacts).
 */
function validateOutcomeAction(action: unknown): ValidationResult<"would-insert"> {
  if (!isNonEmptyString(action)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `selectedOutcome.action must be a non-empty string, received: ${typeof action}`,
      field: "selectedOutcome.action",
    };
  }

  if (action !== "would-insert") {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `selectedOutcome.action must be "would-insert", received: "${action}"`,
      field: "selectedOutcome.action",
    };
  }

  return { success: true, data: "would-insert" };
}

/**
 * Validate selectedOutcome.insertedLine field (for auto-ideation artifacts).
 */
function validateInsertedLine(line: unknown): ValidationResult<number> {
  if (!isPositiveInteger(line)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `selectedOutcome.insertedLine must be a positive integer (>= 1), received: ${typeof line === "number" ? line : typeof line}`,
      field: "selectedOutcome.insertedLine",
    };
  }

  return { success: true, data: line };
}

/**
 * Validate the complete artifact structure.
 * Returns validated artifact or first validation error encountered.
 */
export function validateArtifactShape(parsed: unknown): ValidationResult<FallbackPatchArtifact> {
  if (parsed === null || typeof parsed !== "object") {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `Artifact must be a JSON object, received: ${parsed === null ? "null" : typeof parsed}`,
    };
  }

  const obj = parsed as Record<string, unknown>;

  // Validate version
  const versionResult = validateArtifactVersion(obj.version);
  if (!versionResult.success) return versionResult;

  // Validate kind first to determine which type we're validating
  const kindResult = validateArtifactKind(obj.kind);
  if (!kindResult.success) return kindResult;

  // Common base field validations
  if (!isNonEmptyString(obj.taskpadPath)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `taskpadPath must be a non-empty string, received: ${typeof obj.taskpadPath}`,
      field: "taskpadPath",
    };
  }

  const shaResult = validateTaskpadSha256(obj.taskpadSha256);
  if (!shaResult.success) return shaResult;

  if (!isNonEmptyString(obj.applyHint)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `applyHint must be a non-empty string`,
      field: "applyHint",
    };
  }

  // Kind-specific validation
  if (kindResult.data === "taskpad-auto-ideation-fallback-patch") {
    return validateAutoIdeationArtifact(obj, versionResult.data, shaResult.data);
  }

  if (kindResult.data === "taskpad-plan-seed-fallback-patch") {
    return validatePlanSeedArtifact(obj, versionResult.data, shaResult.data);
  }

  // This should never happen due to kind validation above
  return {
    success: false,
    code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
    message: `Unhandled artifact kind: ${kindResult.data}`,
  };
}

/**
 * Validate auto-ideation artifact specific fields.
 */
function validateAutoIdeationArtifact(
  obj: Record<string, unknown>,
  version: number,
  taskpadSha256: string,
): ValidationResult<AutoIdeationArtifact> {
  // Validate selectedCandidateId
  if (!isNonEmptyString(obj.selectedCandidateId)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `selectedCandidateId must be a non-empty string, received: ${typeof obj.selectedCandidateId}`,
      field: "selectedCandidateId",
    };
  }

  // Validate selectedOutcome
  if (obj.selectedOutcome === null || typeof obj.selectedOutcome !== "object") {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `selectedOutcome must be an object, received: ${obj.selectedOutcome === null ? "null" : typeof obj.selectedOutcome}`,
      field: "selectedOutcome",
    };
  }

  const outcome = obj.selectedOutcome as Record<string, unknown>;

  const actionResult = validateOutcomeAction(outcome.action);
  if (!actionResult.success) return actionResult;

  if (!isNonEmptyString(outcome.canonicalBullet)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `selectedOutcome.canonicalBullet must be a non-empty string`,
      field: "selectedOutcome.canonicalBullet",
    };
  }

  const lineResult = validateInsertedLine(outcome.insertedLine);
  if (!lineResult.success) return lineResult;

  // Validate patch
  if (obj.patch === null || typeof obj.patch !== "object") {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `patch must be an object, received: ${obj.patch === null ? "null" : typeof obj.patch}`,
      field: "patch",
    };
  }

  const patch = obj.patch as Record<string, unknown>;

  const formatResult = validatePatchFormat(patch.format);
  if (!formatResult.success) return formatResult;

  if (!isNonEmptyString(patch.targetPath)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `patch.targetPath must be a non-empty string`,
      field: "patch.targetPath",
    };
  }

  const contentResult = validatePatchContent(patch.content);
  if (!contentResult.success) return contentResult;

  // All validations passed - construct validated artifact
  const validatedArtifact: AutoIdeationArtifact = {
    version,
    kind: "taskpad-auto-ideation-fallback-patch",
    taskpadPath: obj.taskpadPath,
    taskpadSha256,
    selectedCandidateId: obj.selectedCandidateId,
    selectedOutcome: {
      action: actionResult.data,
      canonicalBullet: outcome.canonicalBullet,
      insertedLine: lineResult.data,
    },
    patch: {
      format: formatResult.data,
      targetPath: patch.targetPath,
      content: contentResult.data,
    },
    applyHint: obj.applyHint,
  };

  return { success: true, data: validatedArtifact };
}

/**
 * Validate plan-seed artifact specific fields.
 */
function validatePlanSeedArtifact(
  obj: Record<string, unknown>,
  version: number,
  taskpadSha256: string,
): ValidationResult<PlanSeedArtifact> {
  // Validate planPath
  if (!isNonEmptyString(obj.planPath)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `planPath must be a non-empty string, received: ${typeof obj.planPath}`,
      field: "planPath",
    };
  }

  // Validate planSha256
  const planShaResult = validateTaskpadSha256(obj.planSha256);
  if (!planShaResult.success) return planShaResult;

  // Validate mutationId
  if (!isNonEmptyString(obj.mutationId)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `mutationId must be a non-empty string, received: ${typeof obj.mutationId}`,
      field: "mutationId",
    };
  }

  // Validate mutationOutcome
  if (obj.mutationOutcome === null || typeof obj.mutationOutcome !== "object") {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `mutationOutcome must be an object, received: ${obj.mutationOutcome === null ? "null" : typeof obj.mutationOutcome}`,
      field: "mutationOutcome",
    };
  }

  const mutationOutcome = obj.mutationOutcome as Record<string, unknown>;

  const action = mutationOutcome.action;
  if (action !== "would-insert-taskpad" && action !== "would-insert-plan") {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `mutationOutcome.action must be "would-insert-taskpad" or "would-insert-plan", received: ${action}`,
      field: "mutationOutcome.action",
    };
  }

  if (mutationOutcome.taskpadUpdatedLine !== null && !isNonEmptyString(mutationOutcome.taskpadUpdatedLine)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `mutationOutcome.taskpadUpdatedLine must be a non-empty string or null, received: ${typeof mutationOutcome.taskpadUpdatedLine}`,
      field: "mutationOutcome.taskpadUpdatedLine",
    };
  }

  if (mutationOutcome.planInsertHeading !== null && !isNonEmptyString(mutationOutcome.planInsertHeading)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `mutationOutcome.planInsertHeading must be a non-empty string or null, received: ${typeof mutationOutcome.planInsertHeading}`,
      field: "mutationOutcome.planInsertHeading",
    };
  }

  const selectedBacklogLine = mutationOutcome.selectedBacklogLine;
  if (!isPositiveInteger(selectedBacklogLine)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `mutationOutcome.selectedBacklogLine must be a positive integer (>= 1), received: ${typeof selectedBacklogLine === "number" ? selectedBacklogLine : typeof selectedBacklogLine}`,
      field: "mutationOutcome.selectedBacklogLine",
    };
  }

  // Validate patch
  if (obj.patch === null || typeof obj.patch !== "object") {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `patch must be an object, received: ${obj.patch === null ? "null" : typeof obj.patch}`,
      field: "patch",
    };
  }

  const patch = obj.patch as Record<string, unknown>;

  const formatResult = validatePatchFormat(patch.format);
  if (!formatResult.success) return formatResult;

  if (!isNonEmptyString(patch.taskpadTargetPath)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `patch.taskpadTargetPath must be a non-empty string`,
      field: "patch.taskpadTargetPath",
    };
  }

  if (!isNonEmptyString(patch.planTargetPath)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `patch.planTargetPath must be a non-empty string`,
      field: "patch.planTargetPath",
    };
  }

  // At least one patch content must be present
  const taskpadPatchContent = patch.taskpadPatchContent;
  const planPatchContent = patch.planPatchContent;

  if (taskpadPatchContent !== null && !isNonEmptyString(taskpadPatchContent)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `patch.taskpadPatchContent must be a non-empty string or null`,
      field: "patch.taskpadPatchContent",
    };
  }

  if (planPatchContent !== null && !isNonEmptyString(planPatchContent)) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `patch.planPatchContent must be a non-empty string or null`,
      field: "patch.planPatchContent",
    };
  }

  if (!taskpadPatchContent && !planPatchContent) {
    return {
      success: false,
      code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
      message: `At least one of patch.taskpadPatchContent or patch.planPatchContent must be present`,
      field: "patch",
    };
  }

  // Validate unified diff format for any non-null patch content
  if (taskpadPatchContent) {
    const contentResult = validatePatchContent(taskpadPatchContent);
    if (!contentResult.success) {
      return {
        ...contentResult,
        field: "patch.taskpadPatchContent",
      };
    }
  }

  if (planPatchContent) {
    const contentResult = validatePatchContent(planPatchContent);
    if (!contentResult.success) {
      return {
        ...contentResult,
        field: "patch.planPatchContent",
      };
    }
  }

  // All validations passed - construct validated artifact
  const validatedArtifact: PlanSeedArtifact = {
    version,
    kind: "taskpad-plan-seed-fallback-patch",
    taskpadPath: obj.taskpadPath,
    taskpadSha256,
    planPath: obj.planPath,
    planSha256: planShaResult.data,
    mutationId: obj.mutationId,
    mutationOutcome: {
      action: action as "would-insert-taskpad" | "would-insert-plan",
      taskpadUpdatedLine: mutationOutcome.taskpadUpdatedLine,
      planInsertHeading: mutationOutcome.planInsertHeading,
      selectedBacklogLine,
    },
    patch: {
      format: formatResult.data,
      taskpadTargetPath: patch.taskpadTargetPath,
      planTargetPath: patch.planTargetPath,
      taskpadPatchContent,
      planPatchContent,
    },
    applyHint: obj.applyHint,
  };

  return { success: true, data: validatedArtifact };
}

// =============================================================================
// Path Alignment Validation
// =============================================================================

export interface PathAlignmentResult {
  taskpadPath: string;
  planPath?: string;
}

/**
 * Validate that CLI paths match artifact paths.
 * For auto-ideation artifacts: validates --taskpad matches artifact.taskpadPath and patch.targetPath.
 * For plan-seed artifacts: validates --taskpad matches artifact.taskpadPath/patch.taskpadTargetPath,
 * and optionally validates --plan matches artifact.planPath/patch.planTargetPath if provided.
 */
export function validatePathAlignment(
  cliTaskpadPath: string,
  artifact: FallbackPatchArtifact,
  cliPlanPath?: string,
): ValidationResult<PathAlignmentResult> {
  const resolvedCliTaskpad = resolve(cliTaskpadPath);
  const resolvedArtifactTaskpad = resolve(artifact.taskpadPath);

  // Common validation: CLI taskpad must match artifact taskpad
  if (resolvedCliTaskpad !== resolvedArtifactTaskpad) {
    return {
      success: false,
      code: ErrorCodes.ERR_TASKPAD_PATH_MISMATCH,
      message: `Path mismatch: CLI --taskpad (${resolvedCliTaskpad}) does not match artifact.taskpadPath (${resolvedArtifactTaskpad})`,
    };
  }

  // Kind-specific validation
  if (artifact.kind === "taskpad-auto-ideation-fallback-patch") {
    const resolvedPatchTarget = resolve(artifact.patch.targetPath);

    if (resolvedCliTaskpad !== resolvedPatchTarget) {
      return {
        success: false,
        code: ErrorCodes.ERR_TASKPAD_PATH_MISMATCH,
        message: `Path mismatch: CLI --taskpad (${resolvedCliTaskpad}) does not match patch.targetPath (${resolvedPatchTarget})`,
      };
    }

    return { success: true, data: { taskpadPath: resolvedCliTaskpad } };
  }

  if (artifact.kind === "taskpad-plan-seed-fallback-patch") {
    const resolvedTaskpadPatchTarget = resolve(artifact.patch.taskpadTargetPath);

    if (resolvedCliTaskpad !== resolvedTaskpadPatchTarget) {
      return {
        success: false,
        code: ErrorCodes.ERR_TASKPAD_PATH_MISMATCH,
        message: `Path mismatch: CLI --taskpad (${resolvedCliTaskpad}) does not match patch.taskpadTargetPath (${resolvedTaskpadPatchTarget})`,
      };
    }

    // Optional plan path validation
    if (cliPlanPath) {
      const resolvedCliPlan = resolve(cliPlanPath);
      const resolvedArtifactPlan = resolve(artifact.planPath);
      const resolvedPlanPatchTarget = resolve(artifact.patch.planTargetPath);

      if (resolvedCliPlan !== resolvedArtifactPlan) {
        return {
          success: false,
          code: ErrorCodes.ERR_TASKPAD_PATH_MISMATCH,
          message: `Path mismatch: CLI --plan (${resolvedCliPlan}) does not match artifact.planPath (${resolvedArtifactPlan})`,
        };
      }

      if (resolvedCliPlan !== resolvedPlanPatchTarget) {
        return {
          success: false,
          code: ErrorCodes.ERR_TASKPAD_PATH_MISMATCH,
          message: `Path mismatch: CLI --plan (${resolvedCliPlan}) does not match patch.planTargetPath (${resolvedPlanPatchTarget})`,
        };
      }

      return { success: true, data: { taskpadPath: resolvedCliTaskpad, planPath: resolvedCliPlan } };
    }

    // Plan path not provided by CLI - skip plan validation but still validate taskpad
    return { success: true, data: { taskpadPath: resolvedCliTaskpad } };
  }

  return {
    success: false,
    code: ErrorCodes.ERR_ARTIFACT_SCHEMA,
    message: `Unhandled artifact kind in path alignment: ${artifact.kind}`,
  };
}

// =============================================================================
// Target File Validation
// =============================================================================

/**
 * Validate that target TASKPAD exists and is readable.
 */
export function validateTargetExists(taskpadPath: string): ValidationResult<string> {
  if (!existsSync(taskpadPath)) {
    return {
      success: false,
      code: ErrorCodes.ERR_TASKPAD_NOT_FOUND,
      message: `Target TASKPAD not found: ${taskpadPath}`,
    };
  }

  const stats = statSync(taskpadPath);
  if (!stats.isFile()) {
    return {
      success: false,
      code: ErrorCodes.ERR_TASKPAD_NOT_FOUND,
      message: `Target TASKPAD path is not a file: ${taskpadPath}`,
    };
  }

  return { success: true, data: taskpadPath };
}

/**
 * Read TASKPAD content for hash/apply evaluation.
 */
export function readTargetContent(taskpadPath: string): ValidationResult<string> {
  try {
    return { success: true, data: readFileSync(taskpadPath, "utf8") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      code: ErrorCodes.ERR_TASKPAD_NOT_FOUND,
      message: `Failed to read TASKPAD for validation/apply: ${message}`,
    };
  }
}

/**
 * Compute SHA-256 hash for UTF-8 content.
 */
export function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Validate that current TASKPAD SHA-256 matches artifact.taskpadSha256.
 */
export function validateTargetHash(
  taskpadPath: string,
  expectedSha256: string,
): ValidationResult<string> {
  const contentResult = readTargetContent(taskpadPath);
  if (!contentResult.success) return contentResult;

  return validateTargetHashFromContent(contentResult.data, expectedSha256);
}

/**
 * Validate SHA-256 hash from already-loaded TASKPAD content.
 */
export function validateTargetHashFromContent(
  currentContent: string,
  expectedSha256: string,
): ValidationResult<string> {
  const actualHash = computeSha256(currentContent);

  if (actualHash !== expectedSha256) {
    return {
      success: false,
      code: ErrorCodes.ERR_TASKPAD_HASH_MISMATCH,
      message: `TASKPAD hash mismatch: expected ${expectedSha256.substring(0, 16)}..., got ${actualHash.substring(0, 16)}...`,
    };
  }

  return { success: true, data: actualHash };
}

// =============================================================================
// Combined Artifact Load + Validate
// =============================================================================

export interface LoadedArtifact {
  artifact: FallbackPatchArtifact;
  resolvedTaskpadPath: string;
  resolvedPlanPath?: string;
}

/**
 * Parse and validate artifact from file path.
 * Returns validated artifact or validation error.
 */
export function loadAndValidateArtifact(artifactPath: string, cliPlanPath?: string): ValidationResult<LoadedArtifact> {
  // Step 1: Parse JSON
  const parseResult = parseArtifactJson(artifactPath);
  if (!parseResult.success) return parseResult;

  // Step 2: Validate shape
  const shapeResult = validateArtifactShape(parseResult.data);
  if (!shapeResult.success) return shapeResult;

  const resolvedTaskpadPath = resolve(shapeResult.data.taskpadPath);
  const resolvedPlanPath = cliPlanPath ? resolve(cliPlanPath) : undefined;

  return {
    success: true,
    data: {
      artifact: shapeResult.data,
      resolvedTaskpadPath,
      resolvedPlanPath,
    },
  };
}

// =============================================================================
// CLI Interface
// =============================================================================

interface CliArgs {
  taskpadPath?: string;
  planPath?: string;
  artifactPath?: string;
}

function printHelp(): void {
  console.log(`
TASKPAD Apply Fallback

USAGE:
  bun run tools/taskpad-apply-fallback.ts --taskpad <path> --artifact <path> [--plan <path>]

OPTIONS:
  --taskpad <path>   Path to TASKPAD markdown file to update
  --plan <path>      Path to IMPLEMENTATION_PLAN markdown file (required for plan-seed artifacts)
  --artifact <path>   Path to fallback patch artifact JSON file
  --help, -h          Show this help message

EXAMPLES:
  # Auto-ideation artifact (single-file patch)
  bun run taskpad:apply-fallback -- --taskpad TASKPAD.md --artifact artifacts/TASKPAD.md.auto-ideation.patch.json

  # Plan-seed artifact (dual-file patch)
  bun run taskpad:apply-fallback -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --artifact artifacts/TASKPAD.md.plan-seed.patch.json
`);
}

function parseArgs(argv: string[]): CliArgs {
  let taskpadPath: string | undefined;
  let planPath: string | undefined;
  let artifactPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--taskpad") {
      i++;
      const value = argv[i];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --taskpad");
      }
      taskpadPath = value;
      continue;
    }

    if (arg === "--plan") {
      i++;
      const value = argv[i];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --plan");
      }
      planPath = value;
      continue;
    }

    if (arg === "--artifact") {
      i++;
      const value = argv[i];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --artifact");
      }
      artifactPath = value;
      continue;
    }

    if (!arg.startsWith("-")) {
      // Positional arguments not supported
      throw new Error(`Unexpected argument: ${arg}`);
    }

    throw new Error(`Unknown flag: ${arg}`);
  }

  return { taskpadPath, planPath, artifactPath };
}

function getRemediationHint(reasonCode: ErrorCode | null): string | null {
  if (!reasonCode) {
    return null;
  }

  if (reasonCode === ErrorCodes.ERR_TASKPAD_PATH_MISMATCH) {
    return "Use the same canonical file for --taskpad, artifact.taskpadPath, and patch.targetPath. Regenerate the fallback artifact if the file moved.";
  }

  if (reasonCode === ErrorCodes.ERR_TASKPAD_HASH_MISMATCH) {
    return "The TASKPAD changed after artifact generation. Re-run taskpad:auto-ideation for the current TASKPAD and apply the new artifact.";
  }

  if (
    reasonCode === ErrorCodes.ERR_ARTIFACT_PARSE ||
    reasonCode === ErrorCodes.ERR_ARTIFACT_SCHEMA ||
    reasonCode === ErrorCodes.ERR_ARTIFACT_VERSION_UNSUPPORTED ||
    reasonCode === ErrorCodes.ERR_PATCH_FORMAT_INVALID
  ) {
    return "Artifact is malformed or unsupported. Regenerate it via taskpad:auto-ideation; do not hand-edit fallback artifact JSON/diff content.";
  }

  if (reasonCode === ErrorCodes.ERR_PATCH_APPLY_FAILED) {
    return "Current TASKPAD no longer matches artifact pre-image. Re-run taskpad:auto-ideation to produce a fresh artifact.";
  }

  if (reasonCode === ErrorCodes.ERR_TASKPAD_NOT_FOUND) {
    return "Confirm --taskpad points to an existing file and rerun the command.";
  }

  if (reasonCode === ErrorCodes.ERR_WRITE_FAILED) {
    return "Fix filesystem permissions for TASKPAD path and retry with the same validated artifact.";
  }

  return "Review reasonCode/message and rerun once inputs and permissions are corrected.";
}

function buildResult(
  status: ApplyStatus,
  taskpadPath: string,
  artifactPath: string,
  reasonCode: ErrorCode | null,
  message: string,
): ApplyFallbackResult {
  return {
    status,
    taskpadPath,
    artifactPath,
    reasonCode,
    message,
    remediationHint: getRemediationHint(reasonCode),
  };
}

function printHumanSummary(result: ApplyFallbackResult): void {
  const statusLabel = result.status.toUpperCase();
  console.log(`TASKPAD apply-fallback: ${statusLabel}`);
  console.log(`- taskpadPath: ${result.taskpadPath}`);
  console.log(`- artifactPath: ${result.artifactPath}`);
  console.log(`- reasonCode: ${result.reasonCode ?? "none"}`);
  console.log(`- message: ${result.message}`);
  console.log(`- remediation: ${result.remediationHint ?? "none"}`);
}

function printMachineReadableJsonBlock(result: ApplyFallbackResult): void {
  console.log("APPLY_FALLBACK_JSON_START");
  console.log(JSON.stringify(result, null, 2));
  console.log("APPLY_FALLBACK_JSON_END");
}

// =============================================================================
// Unified Diff Apply Logic (TP004)
// =============================================================================

interface ParsedUnifiedDiff {
  oldPath: string;
  newPath: string;
  oldCount: number;
  newCount: number;
  oldLines: string[];
  newLines: string[];
}

interface MarkdownLineModel {
  lines: string[];
  newline: "\n" | "\r\n";
  hadTrailingNewline: boolean;
}

function toPortablePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function parseMarkdownWithNewlineStyle(markdown: string): MarkdownLineModel {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const newline: "\n" | "\r\n" = markdown.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = normalizedMarkdown.endsWith("\n");
  const lines = normalizedMarkdown.split("\n");

  if (hadTrailingNewline && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return {
    lines,
    newline,
    hadTrailingNewline,
  };
}

function stringifyMarkdownWithNewlineStyle(model: MarkdownLineModel): string {
  const joined = model.lines.join(model.newline);
  return model.hadTrailingNewline ? `${joined}${model.newline}` : joined;
}

function parseUnifiedDiffContent(content: string): ValidationResult<ParsedUnifiedDiff> {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  if (lines.length < 4) {
    return {
      success: false,
      code: ErrorCodes.ERR_PATCH_FORMAT_INVALID,
      message: "Unified diff must include headers and one hunk",
      field: "patch.content",
    };
  }

  const oldHeader = lines[0];
  const newHeader = lines[1];
  const hunkHeader = lines[2];

  if (!oldHeader.startsWith("--- ") || !newHeader.startsWith("+++ ")) {
    return {
      success: false,
      code: ErrorCodes.ERR_PATCH_FORMAT_INVALID,
      message: "Unified diff must start with ---/+++ headers",
      field: "patch.content",
    };
  }

  const hunkMatch = hunkHeader.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/);
  if (!hunkMatch) {
    return {
      success: false,
      code: ErrorCodes.ERR_PATCH_FORMAT_INVALID,
      message: `Invalid unified diff hunk header: ${hunkHeader}`,
      field: "patch.content",
    };
  }

  const oldStart = Number(hunkMatch[1]);
  const oldCount = Number(hunkMatch[2]);
  const newStart = Number(hunkMatch[3]);
  const newCount = Number(hunkMatch[4]);

  if (oldStart !== 1 || newStart !== 1) {
    return {
      success: false,
      code: ErrorCodes.ERR_PATCH_FORMAT_INVALID,
      message: "Unified diff hunk must start at line 1 for deterministic full-file apply",
      field: "patch.content",
    };
  }

  const body = lines.slice(3);
  const oldLines: string[] = [];
  const newLines: string[] = [];

  for (const line of body) {
    if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
      continue;
    }

    if (line.startsWith("+")) {
      newLines.push(line.slice(1));
      continue;
    }

    return {
      success: false,
      code: ErrorCodes.ERR_PATCH_FORMAT_INVALID,
      message: `Unsupported unified diff body line: ${line}`,
      field: "patch.content",
    };
  }

  if (oldLines.length !== oldCount || newLines.length !== newCount) {
    return {
      success: false,
      code: ErrorCodes.ERR_PATCH_FORMAT_INVALID,
      message: `Unified diff hunk counts do not match body (old=${oldLines.length}/${oldCount}, new=${newLines.length}/${newCount})`,
      field: "patch.content",
    };
  }

  return {
    success: true,
    data: {
      oldPath: oldHeader.slice(4),
      newPath: newHeader.slice(4),
      oldCount,
      newCount,
      oldLines,
      newLines,
    },
  };
}

function validateArtifactDiffTarget(
  parsedDiff: ParsedUnifiedDiff,
  targetPath: string,
): ValidationResult<true> {
  const portableTargetPath = toPortablePath(resolve(targetPath));
  const expectedOldHeaderPath = `a/${portableTargetPath}`;
  const expectedNewHeaderPath = `b/${portableTargetPath}`;

  if (parsedDiff.oldPath !== expectedOldHeaderPath || parsedDiff.newPath !== expectedNewHeaderPath) {
    return {
      success: false,
      code: ErrorCodes.ERR_PATCH_FORMAT_INVALID,
      message: `Unified diff target mismatch: expected ${expectedOldHeaderPath} / ${expectedNewHeaderPath}, got ${parsedDiff.oldPath} / ${parsedDiff.newPath}`,
      field: "patch.content",
    };
  }

  return { success: true, data: true };
}

interface PatchApplyOutcome {
  status: "applied" | "noop";
  updatedTaskpadContent: string | null;
  updatedPlanContent: string | null;
  message: string;
}

/**
 * Apply a single unified diff patch to content.
 * Returns the updated content or validation error.
 */
function applySingleUnifiedDiff(
  currentContent: string,
  patchContent: string,
  targetPath: string,
): ValidationResult<string> {
  const parsedDiffResult = parseUnifiedDiffContent(patchContent);
  if (!parsedDiffResult.success) {
    return {
      success: false,
      code: parsedDiffResult.code,
      message: parsedDiffResult.message,
      field: parsedDiffResult.field,
    };
  }

  // Validate diff target path matches expected path
  const targetResult = validateArtifactDiffTarget(parsedDiffResult.data, targetPath);
  if (!targetResult.success) {
    return {
      success: false,
      code: targetResult.code,
      message: targetResult.message,
      field: "patch.content",
    };
  }

  const currentModel = parseMarkdownWithNewlineStyle(currentContent);

  const currentMatchesOriginal =
    currentModel.lines.length === parsedDiffResult.data.oldLines.length &&
    currentModel.lines.every((line, index) => line === parsedDiffResult.data.oldLines[index]);

  if (!currentMatchesOriginal) {
    const alreadyApplied =
      currentModel.lines.length === parsedDiffResult.data.newLines.length &&
      currentModel.lines.every((line, index) => line === parsedDiffResult.data.newLines[index]);

    if (alreadyApplied) {
      // Idempotent: patch already applied
      return { success: true, data: currentContent };
    }

    return {
      success: false,
      code: ErrorCodes.ERR_PATCH_APPLY_FAILED,
      message: "Current content does not match patch pre-image for deterministic apply",
      field: "patch.content",
    };
  }

  const updatedContent = stringifyMarkdownWithNewlineStyle({
    lines: parsedDiffResult.data.newLines,
    newline: currentModel.newline,
    hadTrailingNewline: currentModel.hadTrailingNewline,
  });

  return { success: true, data: updatedContent };
}

export function applyFallbackPatch(
  currentTaskpadContent: string,
  artifact: FallbackPatchArtifact,
  currentPlanContent?: string,
): ValidationResult<PatchApplyOutcome> {
  let updatedTaskpadContent: string | null = null;
  let updatedPlanContent: string | null = null;
  let anyPatchApplied = false;
  let allPatchesNoop = true;

  if (artifact.kind === "taskpad-auto-ideation-fallback-patch") {
    // Auto-ideation: single-file patch
    const taskpadResult = applySingleUnifiedDiff(
      currentTaskpadContent,
      artifact.patch.content,
      artifact.patch.targetPath,
    );

    if (!taskpadResult.success) return taskpadResult;

    if (taskpadResult.data !== currentTaskpadContent) {
      anyPatchApplied = true;
      allPatchesNoop = false;
      updatedTaskpadContent = taskpadResult.data;
    } else {
      updatedTaskpadContent = currentTaskpadContent; // No change, already applied
    }
  } else if (artifact.kind === "taskpad-plan-seed-fallback-patch") {
    // Plan-seed: dual-file patch
    const { taskpadPatchContent, planPatchContent } = artifact.patch;

    // Apply taskpad patch if present
    if (taskpadPatchContent) {
      const taskpadResult = applySingleUnifiedDiff(
        currentTaskpadContent,
        taskpadPatchContent,
        artifact.patch.taskpadTargetPath,
      );

      if (!taskpadResult.success) return taskpadResult;

      if (taskpadResult.data !== currentTaskpadContent) {
        anyPatchApplied = true;
        allPatchesNoop = false;
        updatedTaskpadContent = taskpadResult.data;
      } else {
        updatedTaskpadContent = currentTaskpadContent;
      }
    } else {
      updatedTaskpadContent = currentTaskpadContent; // No taskpad patch
    }

    // Apply plan patch if present
    if (planPatchContent && currentPlanContent !== undefined) {
      const planResult = applySingleUnifiedDiff(
        currentPlanContent,
        planPatchContent,
        artifact.patch.planTargetPath,
      );

      if (!planResult.success) return planResult;

      if (planResult.data !== currentPlanContent) {
        anyPatchApplied = true;
        allPatchesNoop = false;
        updatedPlanContent = planResult.data;
      } else {
        updatedPlanContent = currentPlanContent;
      }
    } else if (planPatchContent) {
      // Plan patch present but no current plan content provided
      return {
        success: false,
        code: ErrorCodes.ERR_PATCH_APPLY_FAILED,
        message: "Plan patch content exists but currentPlanContent not provided",
        field: "patch.planPatchContent",
      };
    }
  }

  // Determine status based on patch application results
  if (allPatchesNoop) {
    return {
      success: true,
      data: {
        status: "noop",
        updatedTaskpadContent: null,
        updatedPlanContent: null,
        message: "Fallback artifact already applied; files unchanged.",
      },
    };
  }

  // Build message based on which files were updated
  const updatedFiles: string[] = [];
  if (updatedTaskpadContent && updatedTaskpadContent !== currentTaskpadContent) {
    updatedFiles.push("TASKPAD");
  }
  if (updatedPlanContent && currentPlanContent && updatedPlanContent !== currentPlanContent) {
    updatedFiles.push("IMPLEMENTATION_PLAN");
  }

  const message = `Fallback patch applied successfully to: ${updatedFiles.join(", ")}.`;

  return {
    success: true,
    data: {
      status: "applied",
      updatedTaskpadContent,
      updatedPlanContent,
      message,
    },
  };
}

export function writeTaskpadAtomically(taskpadPath: string, updatedContent: string): ValidationResult<true> {
  const tempPath = `${taskpadPath}.taskpad-apply-fallback.tmp-${process.pid}-${Date.now()}`;

  try {
    writeFileSync(tempPath, updatedContent, "utf8");
    renameSync(tempPath, taskpadPath);
    return { success: true, data: true };
  } catch (error) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // Best-effort cleanup only.
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      code: ErrorCodes.ERR_WRITE_FAILED,
      message: `Atomic TASKPAD write failed: ${message}`,
    };
  }
}

/**
 * Atomically write both taskpad and plan files for dual-file artifacts.
 * If either write fails, rolls back both changes.
 */
export function writeTaskpadAndPlanAtomically(
  taskpadPath: string,
  updatedTaskpadContent: string,
  planPath: string,
  updatedPlanContent: string,
): ValidationResult<true> {
  const taskpadTempPath = `${taskpadPath}.taskpad-apply-fallback.tmp-${process.pid}-${Date.now()}-taskpad`;
  const planTempPath = `${planPath}.taskpad-apply-fallback.tmp-${process.pid}-${Date.now()}-plan`;

  let taskpadTempWritten = false;
  let planTempWritten = false;

  try {
    // Write temp files
    writeFileSync(taskpadTempPath, updatedTaskpadContent, "utf8");
    taskpadTempWritten = true;

    writeFileSync(planTempPath, updatedPlanContent, "utf8");
    planTempWritten = true;

    // Atomic rename
    renameSync(taskpadTempPath, taskpadPath);
    renameSync(planTempPath, planPath);

    return { success: true, data: true };
  } catch (error) {
    // Cleanup temp files
    try {
      if (taskpadTempWritten && existsSync(taskpadTempPath)) {
        unlinkSync(taskpadTempPath);
      }
      if (planTempWritten && existsSync(planTempPath)) {
        unlinkSync(planTempPath);
      }
    } catch {
      // Best-effort cleanup only.
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      code: ErrorCodes.ERR_WRITE_FAILED,
      message: `Atomic dual-file write failed: ${message}`,
    };
  }
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Validate that target plan exists and is readable (for dual-file artifacts).
 */
export function validatePlanExists(planPath: string): ValidationResult<string> {
  if (!existsSync(planPath)) {
    return {
      success: false,
      code: ErrorCodes.ERR_TASKPAD_NOT_FOUND,
      message: `Target IMPLEMENTATION_PLAN not found: ${planPath}`,
    };
  }

  const stats = statSync(planPath);
  if (!stats.isFile()) {
    return {
      success: false,
      code: ErrorCodes.ERR_TASKPAD_NOT_FOUND,
      message: `Target IMPLEMENTATION_PLAN path is not a file: ${planPath}`,
    };
  }

  return { success: true, data: planPath };
}

/**
 * Main validation orchestrator.
 * Performs all pre-apply validation checks in order.
 */
export function validatePreApply(
  cliTaskpadPath: string,
  cliArtifactPath: string,
  cliPlanPath?: string,
): ValidationResult<LoadedArtifact> {
  // Step 1: Load and validate artifact
  const loadResult = loadAndValidateArtifact(cliArtifactPath, cliPlanPath);
  if (!loadResult.success) return loadResult;

  // Step 2: Validate path alignment
  const pathResult = validatePathAlignment(cliTaskpadPath, loadResult.data.artifact, cliPlanPath);
  if (!pathResult.success) return pathResult;

  // Step 3: Validate taskpad target exists
  const existsResult = validateTargetExists(pathResult.data.taskpadPath);
  if (!existsResult.success) return existsResult;

  // Step 4: Validate taskpad hash match
  const hashResult = validateTargetHash(
    pathResult.data.taskpadPath,
    loadResult.data.artifact.taskpadSha256,
  );
  if (!hashResult.success) return hashResult;

  // Step 5: For plan-seed artifacts with plan patch, validate plan exists and hash
  if (loadResult.data.artifact.kind === "taskpad-plan-seed-fallback-patch") {
    const artifact = loadResult.data.artifact as PlanSeedArtifact;

    if (artifact.patch.planPatchContent) {
      // Plan patch exists - validate plan path and hash
      const resolvedPlanPath = pathResult.data.planPath || resolve(artifact.planPath);

      const planExistsResult = validatePlanExists(resolvedPlanPath);
      if (!planExistsResult.success) {
        return {
          success: false,
          code: planExistsResult.code,
          message: planExistsResult.message,
        };
      }

      const planContentResult = readTargetContent(resolvedPlanPath);
      if (!planContentResult.success) return planContentResult;

      const planHashResult = validateTargetHashFromContent(
        planContentResult.data,
        artifact.planSha256,
      );
      if (!planHashResult.success) return planHashResult;

      // Update loaded artifact with resolved plan path
      return {
        success: true,
        data: {
          ...loadResult.data,
          resolvedPlanPath: resolvedPlanPath,
        },
      };
    }
  }

  return { success: true, data: loadResult.data };
}

function main(): void {
  // Parse CLI arguments
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERROR: ${message}`);
    printHelp();
    process.exit(1);
  }

  // Validate required arguments
  if (!args.taskpadPath) {
    console.error("ERROR: Missing required --taskpad argument");
    printHelp();
    process.exit(1);
  }

  if (!args.artifactPath) {
    console.error("ERROR: Missing required --artifact argument");
    printHelp();
    process.exit(1);
  }

  const resolvedTaskpad = resolve(args.taskpadPath);
  const resolvedPlan = args.planPath ? resolve(args.planPath) : undefined;
  const resolvedArtifact = resolve(args.artifactPath);

  // Run deterministic pre-mutation validation chain (shape/path/existence/hash)
  const loadResult = loadAndValidateArtifact(resolvedArtifact, resolvedPlan);
  if (!loadResult.success) {
    const result = buildResult(
      "rejected",
      resolvedTaskpad,
      resolvedArtifact,
      loadResult.code,
      loadResult.message,
    );
    printHumanSummary(result);
    printMachineReadableJsonBlock(result);
    process.exit(1);
  }

  const pathResult = validatePathAlignment(resolvedTaskpad, loadResult.data.artifact, resolvedPlan);
  if (!pathResult.success) {
    const result = buildResult(
      "rejected",
      resolvedTaskpad,
      resolvedArtifact,
      pathResult.code,
      pathResult.message,
    );
    printHumanSummary(result);
    printMachineReadableJsonBlock(result);
    process.exit(1);
  }

  const existsResult = validateTargetExists(pathResult.data.taskpadPath);
  if (!existsResult.success) {
    const result = buildResult(
      "rejected",
      resolvedTaskpad,
      resolvedArtifact,
      existsResult.code,
      existsResult.message,
    );
    printHumanSummary(result);
    printMachineReadableJsonBlock(result);
    process.exit(1);
  }

  const contentResult = readTargetContent(pathResult.data.taskpadPath);
  if (!contentResult.success) {
    const result = buildResult(
      "rejected",
      resolvedTaskpad,
      resolvedArtifact,
      contentResult.code,
      contentResult.message,
    );
    printHumanSummary(result);
    printMachineReadableJsonBlock(result);
    process.exit(1);
  }

  const currentTaskpadContent = contentResult.data;
  let currentPlanContent: string | undefined;

  // For plan-seed artifacts with plan patch, read and validate plan content
  if (loadResult.data.artifact.kind === "taskpad-plan-seed-fallback-patch") {
    const artifact = loadResult.data.artifact as PlanSeedArtifact;
    if (artifact.patch.planPatchContent) {
      // Check if --plan was provided
      if (!resolvedPlan) {
        const result = buildResult(
          "rejected",
          resolvedTaskpad,
          resolvedArtifact,
          ErrorCodes.ERR_TASKPAD_PATH_MISMATCH,
          "Plan patch exists but --plan argument not provided. Use: --plan <path> to specify IMPLEMENTATION_PLAN path.",
        );
        printHumanSummary(result);
        printMachineReadableJsonBlock(result);
        process.exit(1);
      }

      const planContentResult = readTargetContent(resolvedPlan);
      if (!planContentResult.success) {
        const result = buildResult(
          "rejected",
          resolvedTaskpad,
          resolvedArtifact,
          planContentResult.code,
          planContentResult.message,
        );
        printHumanSummary(result);
        printMachineReadableJsonBlock(result);
        process.exit(1);
      }

      currentPlanContent = planContentResult.data;

      // Validate plan hash
      const planHashResult = validateTargetHashFromContent(currentPlanContent, artifact.planSha256);
      if (!planHashResult.success) {
        const result = buildResult(
          "rejected",
          resolvedTaskpad,
          resolvedArtifact,
          planHashResult.code,
          planHashResult.message,
        );
        printHumanSummary(result);
        printMachineReadableJsonBlock(result);
        process.exit(1);
      }
    }
  }

  const hashResult = validateTargetHashFromContent(currentTaskpadContent, loadResult.data.artifact.taskpadSha256);

  // Hash mismatch can still deterministically resolve to noop when artifact is already applied.
  if (!hashResult.success) {
    // Check if artifact is already applied for both taskpad and plan
    const noopCheck = applyFallbackPatch(currentTaskpadContent, loadResult.data.artifact, currentPlanContent);
    if (noopCheck.success && noopCheck.data.status === "noop") {
      const result = buildResult(
        "noop",
        resolvedTaskpad,
        resolvedArtifact,
        null,
        noopCheck.data.message,
      );
      printHumanSummary(result);
      printMachineReadableJsonBlock(result);
      process.exit(0);
    }

    const result = buildResult(
      "rejected",
      resolvedTaskpad,
      resolvedArtifact,
      hashResult.code,
      hashResult.message,
    );
    printHumanSummary(result);
    printMachineReadableJsonBlock(result);
    process.exit(1);
  }

  // Parse/apply deterministic unified diff(s) in-memory.
  const applyResult = applyFallbackPatch(currentTaskpadContent, loadResult.data.artifact, currentPlanContent);

  if (!applyResult.success) {
    const result = buildResult(
      "rejected",
      resolvedTaskpad,
      resolvedArtifact,
      applyResult.code,
      applyResult.message,
    );
    printHumanSummary(result);
    printMachineReadableJsonBlock(result);
    process.exit(1);
  }

  if (applyResult.data.status === "noop") {
    const result = buildResult(
      "noop",
      resolvedTaskpad,
      resolvedArtifact,
      null,
      applyResult.data.message,
    );
    printHumanSummary(result);
    printMachineReadableJsonBlock(result);
    process.exit(0);
  }

  // Apply mutation atomically (single-file or dual-file based on artifact kind)
  const artifact = loadResult.data.artifact;

  if (artifact.kind === "taskpad-auto-ideation-fallback-patch") {
    // Single-file patch
    const writeResult = writeTaskpadAtomically(
      resolvedTaskpad,
      applyResult.data.updatedTaskpadContent ?? currentTaskpadContent,
    );
    if (!writeResult.success) {
      const result = buildResult(
        "rejected",
        resolvedTaskpad,
        resolvedArtifact,
        writeResult.code,
        writeResult.message,
      );
      printHumanSummary(result);
      printMachineReadableJsonBlock(result);
      process.exit(1);
    }
  } else if (artifact.kind === "taskpad-plan-seed-fallback-patch") {
    // Dual-file patch
    const planSeedArtifact = artifact as PlanSeedArtifact;

    if (!applyResult.data.updatedPlanContent || !pathResult.data.planPath) {
      const result = buildResult(
        "rejected",
        resolvedTaskpad,
        resolvedArtifact,
        ErrorCodes.ERR_PATCH_APPLY_FAILED,
        "Plan-seed artifact requires both taskpad and plan updates",
      );
      printHumanSummary(result);
      printMachineReadableJsonBlock(result);
      process.exit(1);
    }

    const writeResult = writeTaskpadAndPlanAtomically(
      resolvedTaskpad,
      applyResult.data.updatedTaskpadContent ?? currentTaskpadContent,
      pathResult.data.planPath,
      applyResult.data.updatedPlanContent,
    );
    if (!writeResult.success) {
      const result = buildResult(
        "rejected",
        resolvedTaskpad,
        resolvedArtifact,
        writeResult.code,
        writeResult.message,
      );
      printHumanSummary(result);
      printMachineReadableJsonBlock(result);
      process.exit(1);
    }
  }

  const result = buildResult(
    "applied",
    resolvedTaskpad,
    resolvedArtifact,
    null,
    applyResult.data.message,
  );
  printHumanSummary(result);
  printMachineReadableJsonBlock(result);
  process.exit(0);
}

if (import.meta.main) {
  main();
}
