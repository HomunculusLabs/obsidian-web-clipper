#!/usr/bin/env bun

/**
 * TASKPAD MarkItDown Priority Brief Refresh Contract Parity Checker
 *
 * Validates that planned markitdown-conversion-priority-brief artifacts are fully wired through
 * save-flow runtime surfaces (popup/messages/router/handlers) before release.
 *
 * This tool implements TP002: parser/resolver that discovers planned priority-brief
 * artifacts and verifies save-flow wiring parity across required surfaces.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// =============================================================================
// Rule IDs (Deterministic)
// =============================================================================

export const RuleIds = {
  MCPB001_MISSING_MESSAGE_TYPE: "MCPB001_MISSING_MESSAGE_TYPE",
  MCPB002_MISSING_ROUTER_CASE: "MCPB002_MISSING_ROUTER_CASE",
  MCPB003_MISSING_HANDLER_FILE: "MCPB003_MISSING_HANDLER_FILE",
  MCPB004_MISSING_HANDLER_EXPORT: "MCPB004_MISSING_HANDLER_EXPORT",
  MCPB005_MISSING_SAVE_TRIGGER: "MCPB005_MISSING_SAVE_TRIGGER",
  MCPB006_HANDLER_IMPORT_MISSING: "MCPB006_HANDLER_IMPORT_MISSING",
  MCPB007_MESSAGE_TYPE_MISMATCH: "MCPB007_MESSAGE_TYPE_MISMATCH",
  MCPB008_RESPONSE_TYPE_INCOMPLETE: "MCPB008_RESPONSE_TYPE_INCOMPLETE",
  MCPB009_HANDLER_SIGNATURE_MISMATCH: "MCPB009_HANDLER_SIGNATURE_MISMATCH",
  MCPB010_NO_ARTIFACT_TARGETS: "MCPB010_NO_ARTIFACT_TARGETS",
} as const;

export type RuleId = (typeof RuleIds)[keyof typeof RuleIds];

/**
 * Canonical order for violation rule IDs in diagnostics output.
 * Ensures deterministic, stable ordering across runs for machine-readable output.
 */
const CANONICAL_VIOLATION_ORDER: RuleId[] = [
  RuleIds.MCPB001_MISSING_MESSAGE_TYPE,
  RuleIds.MCPB007_MESSAGE_TYPE_MISMATCH,
  RuleIds.MCPB008_RESPONSE_TYPE_INCOMPLETE,
  RuleIds.MCPB002_MISSING_ROUTER_CASE,
  RuleIds.MCPB006_HANDLER_IMPORT_MISSING,
  RuleIds.MCPB003_MISSING_HANDLER_FILE,
  RuleIds.MCPB004_MISSING_HANDLER_EXPORT,
  RuleIds.MCPB009_HANDLER_SIGNATURE_MISMATCH,
  RuleIds.MCPB005_MISSING_SAVE_TRIGGER,
  RuleIds.MCPB010_NO_ARTIFACT_TARGETS,
];

// =============================================================================
// Type Definitions
// =============================================================================

export type OutputFormat = "json" | "human";

/**
 * Markitdown priority brief artifact target supported by this gate
 */
export type PriorityBriefArtifact = "markitdown-conversion-priority-brief";

/**
 * Wiring surface types
 */
export type WiringSurface = "messageType" | "router" | "handler" | "saveTrigger";

/**
 * Wiring status for a single surface
 */
export interface SurfaceWiring {
  present: boolean;
}

/**
 * Detailed message type wiring
 */
export interface MessageTypeWiring extends SurfaceWiring {
  requestDefined: boolean;
  responseDefined: boolean;
  requestType?: string;
  responseType?: string;
}

/**
 * Detailed router wiring
 */
export interface RouterWiring extends SurfaceWiring {
  caseExists: boolean;
  handlerImported: boolean;
  actionName?: string;
}

/**
 * Detailed handler wiring
 */
export interface HandlerWiring extends SurfaceWiring {
  fileExists: boolean;
  handlerExported: boolean;
  filePath?: string;
  handlerName?: string;
}

/**
 * Detailed save trigger wiring
 */
export interface SaveTriggerWiring extends SurfaceWiring {
  refreshFunctionExists: boolean;
  invokedInSaveFlow: boolean;
  functionName?: string;
}

/**
 * Complete wiring status for an artifact
 */
export interface ArtifactWiring {
  messageType: MessageTypeWiring;
  router: RouterWiring;
  handler: HandlerWiring;
  saveTrigger: SaveTriggerWiring;
}

/**
 * Artifact entry with wiring status
 */
export interface ArtifactEntry {
  artifactName: PriorityBriefArtifact;
  plannedInSlice: boolean;
  wiring: ArtifactWiring;
}

/**
 * Violation entry for output
 */
export interface Violation {
  ruleId: RuleId;
  severity: "error" | "warning";
  artifactName: PriorityBriefArtifact;
  surface: WiringSurface;
  details: {
    expectedActionName?: string;
    expectedRequestType?: string;
    expectedResponseType?: string;
    filePath?: string;
    lineNumber?: number;
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
  totalArtifacts: number;
  fullyWiredArtifacts: number;
  partiallyWiredArtifacts: number;
  missingWiringArtifacts: number;
}

/**
 * Full output envelope
 */
export interface PriorityBriefParityResult {
  status: "pass" | "fail";
  inputs: {
    taskpadPath: string;
    planPath: string;
    projectRoot: string;
  };
  artifacts: ArtifactEntry[];
  summary: Summary;
  violations: Violation[];
  timestamp: string;
}

// =============================================================================
// Artifact Configuration
// =============================================================================

/**
 * Artifact-to-handler mapping configuration
 */
const ARTIFACT_CONFIG: Record<
  PriorityBriefArtifact,
  {
    handlerFile: string;
    handlerName: string;
    actionName: string;
    requestType: string;
    responseType: string;
    refreshFunctionName: string;
  }
> = {
  "markitdown-conversion-priority-brief": {
    handlerFile: "src/background/handlers/refreshMarkitdownConversionPriorityBrief.ts",
    handlerName: "handleRefreshMarkitdownConversionPriorityBrief",
    actionName: "refreshMarkitdownConversionPriorityBrief",
    requestType: "RefreshMarkitdownConversionPriorityBriefRequest",
    responseType: "RefreshMarkitdownConversionPriorityBriefResponse",
    refreshFunctionName: "refreshMarkitdownConversionPriorityBrief",
  },
};

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface CliArgs {
  taskpadPath?: string;
  planPath?: string;
  projectRoot?: string;
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
TASKPAD MarkItDown Priority Brief Refresh Contract Parity Checker

Validates that planned markitdown-conversion-priority-brief artifacts are fully wired through
save-flow runtime surfaces (popup/messages/router/handlers) before release.

USAGE:
  bun run taskpad:markitdown-priority-brief-refresh-contract-parity -- --taskpad <path> --plan <path> --project-root <path> [--format <format>]

OPTIONS:
  --taskpad <path>      Path to TASKPAD markdown file (required)
  --plan <path>         Path to IMPLEMENTATION_PLAN markdown file (required)
  --project-root <path> Project root directory for resolving file paths (required)
  --format <format>     Output format: json or human (default: json)
  --help, -h            Show this help message

EXIT CODES:
  0  All priority-brief artifacts have complete wiring
  1  One or more artifacts are missing required wiring
  2  Input validation failure (invalid arguments, unreadable files)

EXAMPLES:
  # Check wiring parity with JSON output
  bun run taskpad:markitdown