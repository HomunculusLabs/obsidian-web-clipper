/**
 * TASKPAD Mutator Write-Mode Contract
 *
 * This module defines the shared write-mode contract for all TASKPAD mutators.
 * It provides deterministic behavior for handling non-writable TASKPAD targets
 * and ensures consistent artifact schema across all mutator types.
 *
 * Mutators that produce content edits MUST use this contract:
 * - taskpad:plan-seed
 * - taskpad:intake:autoplan
 * - taskpad:auto-ideation
 * - queue-reconcile write paths
 * - Any other TASKPAD mutation command
 */

// =============================================================================
// Write Modes
// =============================================================================

/**
 * Mutator write modes determine how a mutator responds to writeability checks.
 *
 * - `direct-write`: Mutator proceeds with direct file writes (target is writable).
 * - `fallback-artifact`: Mutator emits a deterministic fallback artifact instead of mutating.
 * - `error`: Mutator fails with non-zero exit; no writes or artifacts generated.
 */
export type MutatorWriteMode = "direct-write" | "fallback-artifact" | "error";

// =============================================================================
// Deterministic Reason Codes
// =============================================================================

/**
 * Mutator preflight reason codes.
 *
 * These reason codes are deterministic and map directly to write modes and permission classes.
 * Identical system state and paths MUST produce identical reason codes.
 */
export type MutatorPreflightReasonCode =
  // Success codes
  | "MUTATOR_PREFLIGHT_OK"
  // Permission-denied codes (fallback-artifact mode)
  | "MUTATOR_PERMISSION_EPERM"
  | "MUTATOR_PERMISSION_EACCES"
  | "MUTATOR_PERMISSION_EROFS"
  | "MUTATOR_PERMISSION_DENIED_GENERIC"
  // Non-permission error codes (error mode)
  | "MUTATOR_TARGET_NOT_FOUND"
  | "MUTATOR_TARGET_PATH_INVALID"
  | "MUTATOR_TARGET_NOT_WRITABLE_FILE"
  | "MUTATOR_PARENT_DIR_NOT_FOUND"
  | "MUTATOR_IO_UNEXPECTED";

/**
 * Mutator execution reason codes.
 *
 * These reason codes describe the outcome of a mutator's write attempt
 * after preflight checks pass.
 */
export type MutatorExecutionReasonCode =
  // Success codes
  | "MUTATOR_EXECUTION_OK"
  | "MUTATOR_EXECUTION_NOOP"
  // Fallback artifact codes
  | "MUTATOR_FALLBACK_ARTIFACT_GENERATED"
  // Failure codes
  | "MUTATOR_WRITE_FAILED"
  | "MUTATOR_ATOMIC_COMMIT_FAILED"
  | "MUTATOR_VALIDATION_FAILED"
  | "MUTATOR_CONTRACT_VIOLATION";

// =============================================================================
// Permission Classes
// =============================================================================

/**
 * Permission class categorizes the type of write failure.
 *
 * - `none`: No permission issue (write succeeded or no write attempted).
 * - `permission-denied`: OS-level permission denied (EPERM, EACCES, EROFS).
 * - `non-permission`: Other non-permission errors (missing file, invalid path, I/O error).
 */
export type MutatorPermissionClass = "none" | "permission-denied" | "non-permission";

// =============================================================================
// Deterministic Write-Mode Mapping
// =============================================================================

/**
 * Map a preflight reason code to its corresponding write mode.
 *
 * Deterministic rules:
 * - `MUTATOR_PREFLIGHT_OK` → `direct-write`
 * - Permission-denied codes → `fallback-artifact`
 * - All other codes → `error`
 */
export function getWriteModeFromReasonCode(reasonCode: MutatorPreflightReasonCode): MutatorWriteMode {
  switch (reasonCode) {
    case "MUTATOR_PREFLIGHT_OK":
      return "direct-write";
    case "MUTATOR_PERMISSION_EPERM":
    case "MUTATOR_PERMISSION_EACCES":
    case "MUTATOR_PERMISSION_EROFS":
    case "MUTATOR_PERMISSION_DENIED_GENERIC":
      return "fallback-artifact";
    default:
      return "error";
  }
}

/**
 * Map a preflight reason code to its corresponding permission class.
 *
 * Deterministic rules:
 * - `MUTATOR_PREFLIGHT_OK` → `none`
 * - Permission-denied codes → `permission-denied`
 * - All other codes → `non-permission`
 */
export function getPermissionClassFromReasonCode(reasonCode: MutatorPreflightReasonCode): MutatorPermissionClass {
  switch (reasonCode) {
    case "MUTATOR_PREFLIGHT_OK":
      return "none";
    case "MUTATOR_PERMISSION_EPERM":
    case "MUTATOR_PERMISSION_EACCES":
    case "MUTATOR_PERMISSION_EROFS":
    case "MUTATOR_PERMISSION_DENIED_GENERIC":
      return "permission-denied";
    default:
      return "non-permission";
  }
}

/**
 * Check if a reason code indicates permission was denied.
 */
export function isPermissionDeniedReason(reasonCode: MutatorPreflightReasonCode): boolean {
  return (
    reasonCode === "MUTATOR_PERMISSION_EPERM" ||
    reasonCode === "MUTATOR_PERMISSION_EACCES" ||
    reasonCode === "MUTATOR_PERMISSION_EROFS" ||
    reasonCode === "MUTATOR_PERMISSION_DENIED_GENERIC"
  );
}

/**
 * Get human-readable detail message for a reason code.
 */
export function getDetailFromReasonCode(reasonCode: MutatorPreflightReasonCode): string {
  switch (reasonCode) {
    case "MUTATOR_PREFLIGHT_OK":
      return "Probe file created and removed successfully; TASKPAD is writable.";
    case "MUTATOR_PERMISSION_EPERM":
      return "Operation not permitted (EPERM) when attempting to write probe file.";
    case "MUTATOR_PERMISSION_EACCES":
      return "Permission denied (EACCES) when attempting to write probe file.";
    case "MUTATOR_PERMISSION_EROFS":
      return "Read-only file system (EROFS) when attempting to write probe file.";
    case "MUTATOR_PERMISSION_DENIED_GENERIC":
      return "Generic permission denied error when attempting to write probe file.";
    case "MUTATOR_TARGET_NOT_FOUND":
      return "TASKPAD file does not exist.";
    case "MUTATOR_TARGET_PATH_INVALID":
      return "TASKPAD path is invalid or not a file.";
    case "MUTATOR_TARGET_NOT_WRITABLE_FILE":
      return "TASKPAD path exists but is not a writable regular file.";
    case "MUTATOR_PARENT_DIR_NOT_FOUND":
      return "Parent directory does not exist or is not a directory.";
    case "MUTATOR_IO_UNEXPECTED":
      return "Unexpected I/O error during writeability probe.";
    default:
      return "Unknown reason code.";
  }
}

// =============================================================================
// Artifact Schema (Shared Across Mutators)
// =============================================================================

/**
 * Mutator fallback artifact kinds.
 *
 * Each mutator type produces its own artifact kind, but all follow
 * the same base schema defined in MutatorFallbackArtifact.
 */
export type MutatorArtifactKind =
  | "taskpad-auto-ideation-fallback-patch"
  | "taskpad-plan-seed-fallback-patch"
  | "taskpad-intake-autoplan-fallback-patch"
  | "taskpad-queue-reconcile-fallback-patch"
  | "taskpad-generic-fallback-patch";

/**
 * Mutator fallback action types.
 *
 * Describes what action the artifact would perform if applied.
 */
export type MutatorArtifactAction =
  | "would-insert"
  | "would-update"
  | "would-delete"
  | "would-reorder";

/**
 * Mutator fallback patch format.
 *
 * Currently only unified-diff is supported.
 */
export type MutatorPatchFormat = "unified-diff";

/**
 * Shared fallback artifact schema.
 *
 * All mutator fallback artifacts MUST follow this schema to ensure
 * consistent validation and application across all mutator types.
 */
export interface MutatorFallbackArtifact {
  /**
   * Artifact version for schema evolution.
   * All artifacts MUST use version 1 until a new schema is ratified.
   */
  version: number;

  /**
   * Artifact kind identifies which mutator produced this artifact.
   * Consumers MUST validate kind matches expected type before applying.
   */
  kind: MutatorArtifactKind;

  /**
   * Canonical absolute path to the target TASKPAD file.
   * All path comparisons MUST use resolve() to normalize.
   */
  taskpadPath: string;

  /**
   * SHA-256 hash of the target TASKPAD file content at artifact generation time.
   * Consumers MUST validate this hash matches current file content before applying.
   */
  taskpadSha256: string;

  /**
   * Mutator-specific identifier for the mutation (e.g., candidate ID, TP ID, etc.).
   * This helps operators correlate artifacts with source mutations.
   */
  mutationId: string;

  /**
   * Mutator-specific metadata about what would be applied.
   * All artifacts MUST include action and canonical form.
   * Additional fields are mutator-specific.
   */
  mutationOutcome: {
    /**
     * Action type this artifact would perform.
     */
    action: MutatorArtifactAction;

    /**
     * Canonical form of the mutation.
     * - For inserts: the canonical bullet/line to insert.
     * - For updates: the canonical new content.
     * - For deletes: the canonical content to delete.
     * - For reorders: the canonical new order representation.
     */
    canonicalContent: string;

    /**
     * Target line number (1-indexed) for insertions/updates/deletes.
     * Null for reorders or bulk operations.
     */
    targetLine: number | null;
  };

  /**
   * Patch data for deterministic apply.
   */
  patch: {
    /**
     * Patch format (currently only unified-diff is supported).
     */
    format: MutatorPatchFormat;

    /**
     * Target path for the patch (MUST match taskpadPath).
     */
    targetPath: string;

    /**
     * Unified diff content to apply.
     * MUST be valid unified-diff format with @@ hunk headers.
     */
    content: string;
  };

  /**
   * Human-readable hint for applying this artifact.
   * MUST tell operators exactly which command to run.
   */
  applyHint: string;
}

/**
 * Artifact schema version.
 *
 * All artifacts MUST use this version.
 */
export const SUPPORTED_ARTIFACT_VERSION = 1;

// =============================================================================
// Preflight Result Types
// =============================================================================

/**
 * Mutator preflight result.
 *
 * Returned by writeability probe before any mutation attempt.
 */
export interface MutatorPreflightResult {
  /**
   * Whether the target is writable.
   */
  writable: boolean;

  /**
   * Deterministic reason code for the preflight check.
   */
  reasonCode: MutatorPreflightReasonCode;

  /**
   * Permission class categorization of the reason code.
   */
  permissionClass: MutatorPermissionClass;

  /**
   * Computed write mode based on reason code.
   */
  mode: MutatorWriteMode;

  /**
   * Human-readable detail message.
   */
  detail: string;
}

/**
 * Mutator preflight input context.
 *
 * Provides full context for preflight validation.
 */
export interface MutatorPreflightContext {
  /**
   * Target TASKPAD path (absolute or relative).
   */
  taskpadPath: string;

  /**
   * Whether to check if target exists (optional, defaults to true).
   */
  checkExists?: boolean;

  /**
   * Whether to check if target is a file (optional, defaults to true).
   */
  checkIsFile?: boolean;
}

// =============================================================================
// Fallback Artifact Result Types
// =============================================================================

/**
 * Mutator fallback artifact generation result.
 *
 * Returned when mode=direct-write but actual write fails or when
 * mode=fallback-artifact and the mutator chooses to emit an artifact.
 */
export interface MutatorFallbackArtifactResult {
  /**
   * Generated fallback artifact.
   */
  artifact: MutatorFallbackArtifact;

  /**
   * Absolute path where artifact was written.
   */
  artifactPath: string;

  /**
   * Reason code for artifact generation.
   */
  reasonCode: MutatorExecutionReasonCode;

  /**
   * Human-readable message.
   */
  message: string;
}

/**
 * Mutator execution result.
 *
 * Returned after mutation attempt (direct write or fallback artifact).
 */
export interface MutatorExecutionResult {
  /**
   * Execution status.
   */
  status: "success" | "noop" | "failed" | "fallback";

  /**
   * Reason code for the execution outcome.
   */
  reasonCode: MutatorExecutionReasonCode | null;

  /**
   * Human-readable message.
   */
  message: string;

  /**
   * Fallback artifact result (populated when status=fallback).
   */
  fallbackArtifact?: MutatorFallbackArtifactResult;

  /**
   * Whether the TASKPAD was mutated.
   */
  mutated: boolean;
}

// =============================================================================
// Exit Semantics
// =============================================================================

/**
 * Determine process exit code based on write mode.
 *
 * - mode=direct-write → exit 0
 * - mode=fallback-artifact → exit 0
 * - mode=error → exit 1
 *
 * Non-zero exits MUST still emit full machine-readable output.
 */
export function getExitCodeFromMode(mode: MutatorWriteMode): number {
  return mode === "error" ? 1 : 0;
}
