#!/usr/bin/env bun

/**
 * TASKPAD Knowledge-Revalidation Refresh Contract Parity Checker
 *
 * Validates that planned knowledge-revalidation artifacts are fully wired through
 * save-flow runtime surfaces (popup/messages/router/handlers) before release.
 *
 * This tool implements TP002: parser/resolver that discovers planned knowledge-revalidation
 * artifacts and verifies save-flow wiring parity across required surfaces.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// =============================================================================
// Rule IDs (Deterministic)
// =============================================================================

export const RuleIds = {
  KRRP001_MISSING_MESSAGE_TYPE: "KRRP001_MISSING_MESSAGE_TYPE",
  KRRP002_MISSING_ROUTER_CASE: "KRRP002_MISSING_ROUTER_CASE",
  KRRP003_MISSING_HANDLER_FILE: "KRRP003_MISSING_HANDLER_FILE",
  KRRP004_MISSING_HANDLER_EXPORT: "KRRP004_MISSING_HANDLER_EXPORT",
  KRRP005_MISSING_SAVE_TRIGGER: "KRRP005_MISSING_SAVE_TRIGGER",
  KRRP006_HANDLER_IMPORT_MISSING: "KRRP006_HANDLER_IMPORT_MISSING",
  KRRP007_MESSAGE_TYPE_MISMATCH: "KRRP007_MESSAGE_TYPE_MISMATCH",
  KRRP008_RESPONSE_TYPE_INCOMPLETE: "KRRP008_RESPONSE_TYPE_INCOMPLETE",
  KRRP009_HANDLER_SIGNATURE_MISMATCH: "KRRP009_HANDLER_SIGNATURE_MISMATCH",
  KRRP010_NO_ARTIFACT_TARGETS: "KRRP010_NO_ARTIFACT_TARGETS",
} as const;

export type RuleId = (typeof RuleIds)[keyof typeof RuleIds];

/**
 * Canonical order for violation rule IDs in diagnostics output.
 * Ensures deterministic, stable ordering across runs for machine-readable output.
 */
const CANONICAL_VIOLATION_ORDER: RuleId[] = [
  RuleIds.KRRP001_MISSING_MESSAGE_TYPE,
  RuleIds.KRRP007_MESSAGE_TYPE_MISMATCH,
  RuleIds.KRRP008_RESPONSE_TYPE_INCOMPLETE,
  RuleIds.KRRP002_MISSING_ROUTER_CASE,
  RuleIds.KRRP006_HANDLER_IMPORT_MISSING,
  RuleIds.KRRP003_MISSING_HANDLER_FILE,
  RuleIds.KRRP004_MISSING_HANDLER_EXPORT,
  RuleIds.KRRP009_HANDLER_SIGNATURE_MISMATCH,
  RuleIds.KRRP005_MISSING_SAVE_TRIGGER,
  RuleIds.KRRP010_NO_ARTIFACT_TARGETS,
];

// =============================================================================
// Type Definitions
// =============================================================================

export type OutputFormat = "json" | "human";

/**
 * Knowledge-revalidation artifact targets supported by this gate
 */
export type KnowledgeRevalidationArtifact = "knowledge-revalidation-inbox" | "knowledge-revalidation-state-sync";

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
  artifactName: KnowledgeRevalidationArtifact;
  plannedInSlice: boolean;
  wiring: ArtifactWiring;
}

/**
 * Violation entry for output
 */
export interface Violation {
  ruleId: RuleId;
  severity: "error" | "warning";
  artifactName: KnowledgeRevalidationArtifact;
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
export interface KnowledgeRevalidationParityResult {
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
  KnowledgeRevalidationArtifact,
  {
    handlerFile: string;
    handlerName: string;
    actionName: string;
    requestType: string;
    responseType: string;
    refreshFunctionName: string;
  }
> = {
  "knowledge-revalidation-inbox": {
    handlerFile: "src/background/handlers/refreshKnowledgeRevalidationInbox.ts",
    handlerName: "handleRefreshKnowledgeRevalidationInbox",
    actionName: "refreshKnowledgeRevalidationInbox",
    requestType: "RefreshKnowledgeRevalidationInboxRequest",
    responseType: "RefreshKnowledgeRevalidationInboxResponse",
    refreshFunctionName: "refreshKnowledgeRevalidationInbox",
  },
  "knowledge-revalidation-state-sync": {
    handlerFile: "src/background/handlers/refreshKnowledgeRevalidationStateSync.ts",
    handlerName: "handleRefreshKnowledgeRevalidationStateSync",
    actionName: "refreshKnowledgeRevalidationStateSync",
    requestType: "RefreshKnowledgeRevalidationStateSyncRequest",
    responseType: "RefreshKnowledgeRevalidationStateSyncResponse",
    refreshFunctionName: "refreshKnowledgeRevalidationStateSync",
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
TASKPAD Knowledge-Revalidation Refresh Contract Parity Checker

Validates that planned knowledge-revalidation artifacts are fully wired through
save-flow runtime surfaces (popup/messages/router/handlers) before release.

USAGE:
  bun run taskpad:knowledge-revalidation-refresh-contract-parity -- --taskpad <path> --plan <path> --project-root <path> [--format <format>]

OPTIONS:
  --taskpad <path>      Path to TASKPAD markdown file (required)
  --plan <path>         Path to IMPLEMENTATION_PLAN markdown file (required)
  --project-root <path> Project root directory for resolving file paths (required)
  --format <format>     Output format: json or human (default: json)
  --help, -h            Show this help message

EXIT CODES:
  0  All knowledge-revalidation artifacts have complete wiring
  1  One or more artifacts are missing required wiring
  2  Input validation failure (invalid arguments, unreadable files)

EXAMPLES:
  # Check wiring parity with JSON output
  bun run taskpad:knowledge-revalidation-refresh-contract-parity -- \\
    --taskpad "TASKPAD.md" \\
    --plan IMPLEMENTATION_PLAN.md \\
    --project-root . \\
    --format json

  # Check with human-readable output
  bun run taskpad:knowledge-revalidation-refresh-contract-parity -- \\
    --taskpad TASKPAD.md \\
    --plan IMPLEMENTATION_PLAN.md \\
    --project-root . \\
    --format human
`);
}

// =============================================================================
// TASKPAD Parser - Extract planned knowledge-revalidation artifacts
// =============================================================================

const WORK_QUEUE_HEADING = "## Work Queue";
const H2_HEADING_REGEX = /^##\s+/;
const CHECKBOX_PREFIX_REGEX = /^(\s*[-*+]\s+\[\s*\]\s+)/;

/**
 * Parse TASKPAD Work Queue section for knowledge-revalidation artifact items
 */
export function parseKnowledgeRevalidationArtifacts(taskpadMarkdown: string): KnowledgeRevalidationArtifact[] {
  const lines = taskpadMarkdown.split(/\r?\n/);
  const artifacts: Set<KnowledgeRevalidationArtifact> = new Set();

  let inWorkQueue = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Check for Work Queue heading
    if (trimmedLine === WORK_QUEUE_HEADING) {
      inWorkQueue = true;
      continue;
    }

    // Check for any other H2 heading (exits Work Queue section)
    if (H2_HEADING_REGEX.test(trimmedLine)) {
      if (inWorkQueue && trimmedLine !== WORK_QUEUE_HEADING) {
        inWorkQueue = false;
      }
      continue;
    }

    // Only process items in Work Queue section
    if (!inWorkQueue) {
      continue;
    }

    // Check for checkbox prefix (unchecked items only)
    if (!CHECKBOX_PREFIX_REGEX.test(line)) {
      continue;
    }

    // Check for knowledge-revalidation artifact keywords
    if (line.includes("knowledge-revalidation-inbox")) {
      artifacts.add("knowledge-revalidation-inbox");
    }
    if (line.includes("knowledge-revalidation-state-sync")) {
      artifacts.add("knowledge-revalidation-state-sync");
    }
  }

  return Array.from(artifacts);
}

// =============================================================================
// Surface Validation Functions
// =============================================================================

/**
 * Validate message type wiring in src/shared/messages.ts
 */
export function validateMessageTypeWiring(
  messagesContent: string,
  artifact: KnowledgeRevalidationArtifact,
  config: (typeof ARTIFACT_CONFIG)[KnowledgeRevalidationArtifact]
): MessageTypeWiring {
  const wiring: MessageTypeWiring = {
    present: false,
    requestDefined: false,
    responseDefined: false,
    requestType: config.requestType,
    responseType: config.responseType,
  };

  // Check for request type in RuntimeRequest union
  const actionPattern = new RegExp(`action\\s*:\\s*["\']${config.actionName}["\']`);
  wiring.requestDefined = actionPattern.test(messagesContent);

  // Check for response type export
  const responsePattern = new RegExp(`export\\s+type\\s+${config.responseType}\\s*=`);
  wiring.responseDefined = responsePattern.test(messagesContent);

  // Wiring is present if both request and response are defined
  wiring.present = wiring.requestDefined && wiring.responseDefined;

  return wiring;
}

/**
 * Validate router wiring in src/background/router.ts
 */
export function validateRouterWiring(
  routerContent: string,
  artifact: KnowledgeRevalidationArtifact,
  config: (typeof ARTIFACT_CONFIG)[KnowledgeRevalidationArtifact]
): RouterWiring {
  const wiring: RouterWiring = {
    present: false,
    caseExists: false,
    handlerImported: false,
    actionName: config.actionName,
  };

  // Check for handler import
  const importPattern = new RegExp(
    `import\\s+{[^}]*${config.handlerName}[^}]*}\\s+from\\s+["\']\\.?/handlers/${config.handlerName.replace("handle", "").toLowerCase()}["\']`,
    "i"
  );
  // Also try simpler pattern
  const simpleImportPattern = new RegExp(
    `import\\s+.*${config.handlerName}.*from`,
    "i"
  );
  wiring.handlerImported = importPattern.test(routerContent) || simpleImportPattern.test(routerContent);

  // Check for switch case
  const casePattern = new RegExp(`case\\s*["\']${config.actionName}["\']\\s*:`);
  wiring.caseExists = casePattern.test(routerContent);

  // Check for handler invocation
  const invokePattern = new RegExp(`return\\s+${config.handlerName}\\s*\\(`);
  const hasInvocation = invokePattern.test(routerContent);

  // Wiring is present if case exists and either import exists or invocation exists
  wiring.present = wiring.caseExists && (wiring.handlerImported || hasInvocation);

  return wiring;
}

/**
 * Validate handler wiring in src/background/handlers/refreshKnowledgeRevalidation*.ts
 */
export function validateHandlerWiring(
  projectRoot: string,
  artifact: KnowledgeRevalidationArtifact,
  config: (typeof ARTIFACT_CONFIG)[KnowledgeRevalidationArtifact]
): HandlerWiring {
  const wiring: HandlerWiring = {
    present: false,
    fileExists: false,
    handlerExported: false,
    filePath: config.handlerFile,
    handlerName: config.handlerName,
  };

  const handlerPath = resolve(projectRoot, config.handlerFile);

  // Check if file exists
  wiring.fileExists = existsSync(handlerPath);

  if (!wiring.fileExists) {
    return wiring;
  }

  try {
    const content = readFileSync(handlerPath, "utf8");

    // Check for handler export
    const exportPattern = new RegExp(
      `export\\s+(?:async\\s+)?function\\s+${config.handlerName}`
    );
    wiring.handlerExported = exportPattern.test(content);

    // Wiring is present if file exists and handler is exported
    wiring.present = wiring.fileExists && wiring.handlerExported;
  } catch {
    // File read error - treat as not present
    wiring.fileExists = false;
  }

  return wiring;
}

/**
 * Validate save trigger wiring in src/popup/save.ts
 */
export function validateSaveTriggerWiring(
  saveContent: string,
  artifact: KnowledgeRevalidationArtifact,
  config: (typeof ARTIFACT_CONFIG)[KnowledgeRevalidationArtifact]
): SaveTriggerWiring {
  const wiring: SaveTriggerWiring = {
    present: false,
    refreshFunctionExists: false,
    invokedInSaveFlow: false,
    functionName: config.refreshFunctionName,
  };

  // Check for refresh function definition
  const functionPattern = new RegExp(
    `(?:async\\s+)?function\\s+${config.refreshFunctionName}\\s*\\(`
  );
  const constFunctionPattern = new RegExp(
    `const\\s+${config.refreshFunctionName}\\s*=\\s*(?:async\\s*)?\\(`
  );
  wiring.refreshFunctionExists =
    functionPattern.test(saveContent) || constFunctionPattern.test(saveContent);

  // Check for invocation in save flow (void prefix for fire-and-forget)
  const voidInvocationPattern = new RegExp(
    `void\\s+${config.refreshFunctionName}\\s*\\(`
  );
  const directInvocationPattern = new RegExp(
    `${config.refreshFunctionName}\\s*\\(`,
    "g"
  );
  const awaitInvocationPattern = new RegExp(
    `await\\s+${config.refreshFunctionName}\\s*\\(`
  );

  // Count direct invocations (should be function definition + at least one call)
  const directMatches = saveContent.match(directInvocationPattern);
  const voidMatches = voidInvocationPattern.test(saveContent);
  const awaitMatches = awaitInvocationPattern.test(saveContent);

  // Invoked if there's a void prefix call, await call, or more than 1 match (definition + call)
  wiring.invokedInSaveFlow = voidMatches || awaitMatches || (directMatches ? directMatches.length > 1 : false);

  // Wiring is present if function exists and is invoked
  wiring.present = wiring.refreshFunctionExists && wiring.invokedInSaveFlow;

  return wiring;
}

// =============================================================================
// Violation Generation
// =============================================================================

/**
 * Generate scaffold command for missing message type
 */
function generateMessageTypeScaffold(
  artifact: KnowledgeRevalidationArtifact,
  config: (typeof ARTIFACT_CONFIG)[KnowledgeRevalidationArtifact]
): string {
  return `cat > src/shared/messages.ts.patch << 'EOF'
diff --git a/src/shared/messages.ts b/src/shared/messages.ts
index 1234567..abcdefg 100644
--- a/src/shared/messages.ts
+++ b/src/shared/messages.ts
@@ -100,6 +100,18 @@ export type RuntimeRequest =
       action: "refreshContradictionInbox";
       // ...
     }
+  | {
+      action: "${config.actionName}";
+      vaultPath: string;
+      cliPath: string;
+      vault: string;
+      inboxFolder?: string;
+      maxFiles?: number;
+    }
   | { action: "testNativeHost" };
+
+export type ${config.responseType} =
+  | { success: true; itemsCount: number; sourceArtifactsProcessed: number; unresolvedItems: number; resolvedItems: number; truncated: boolean; }
+  | { success: false; error: string };
EOF
patch -p1 < src/shared/messages.ts.patch`;
}

/**
 * Generate scaffold command for missing router case
 */
function generateRouterScaffold(
  artifact: KnowledgeRevalidationArtifact,
  config: (typeof ARTIFACT_CONFIG)[KnowledgeRevalidationArtifact]
): string {
  return `cat > src/background/router.ts.patch << 'EOF'
diff --git a/src/background/router.ts b/src/background/router.ts
index 1234567..abcdefg 100644
--- a/src/background/router.ts
+++ b/src/background/router.ts
@@ -10,6 +10,7 @@ import { handleRefreshOpenQuestionsInbox } from "./handlers/refreshOpenQuestions
 import { handleRefreshKeyTakeawaysInbox } from "./handlers/refreshKeyTakeawaysInbox";
 import { handleRefreshKnowledgeTriageStateSync } from "./handlers/refreshKnowledgeTriageStateSync";
 import { handleRefreshContradictionInbox } from "./handlers/refreshContradictionInbox";
+import { ${config.handlerName} } from "./handlers/${config.handlerName.replace("handle", "").toLowerCase()}";
 
 export async function dispatch(request: RuntimeRequest): Promise<unknown> {
   switch (request.action) {
@@ -30,6 +31,8 @@ export async function dispatch(request: RuntimeRequest): Promise<unknown> {
       return handleRefreshKnowledgeTriageStateSync(request);
     case "refreshContradictionInbox":
       return handleRefreshContradictionInbox(request);
+    case "${config.actionName}":
+      return ${config.handlerName}(request);
     case "testNativeHost":
       return handleTestNativeHost(request);
     default: {
EOF
patch -p1 < src/background/router.ts.patch`;
}

/**
 * Generate scaffold command for missing handler file
 */
function generateHandlerScaffold(
  artifact: KnowledgeRevalidationArtifact,
  config: (typeof ARTIFACT_CONFIG)[KnowledgeRevalidationArtifact]
): string {
  return `cat > ${config.handlerFile} << 'EOF'
/**
 * Handler for refreshing the ${artifact}.
 */

import type { ${config.responseType} } from "../../shared/messages";
import { handleSaveToCli } from "./saveToCli";

interface ${config.requestType} {
  action: "${config.actionName}";
  vaultPath: string;
  cliPath: string;
  vault: string;
  inboxFolder?: string;
  maxFiles?: number;
}

/**
 * Handle ${config.actionName} requests.
 */
export async function ${config.handlerName}(
  request: ${config.requestType}
): Promise<${config.responseType}> {
  const { vaultPath, cliPath, vault, inboxFolder, maxFiles } = request;

  // Validate inputs
  if (!vaultPath?.trim()) {
    return { success: false, error: "Vault path is required" };
  }
  if (!cliPath?.trim()) {
    return { success: false, error: "CLI path is required" };
  }
  if (!vault?.trim()) {
    return { success: false, error: "Vault name is required" };
  }

  try {
    // TODO: Implement vault scanning and inbox building logic
    // This is a placeholder implementation
    
    const inboxFilename = "${artifact}.md";
    const inboxPath = inboxFolder
      ? \`\${inboxFolder.replace(/\\\\/g, "/").replace(/^\\/+|\\/+$/g, "")}/\${inboxFilename}\`
      : inboxFilename;

    // Save via CLI
    const saveResult = await handleSaveToCli({
      action: "saveToCli",
      filePath: inboxPath,
      content: "# \${inboxFilename}\\n\\nTODO: Implement content generation",
      vault,
      cliPath,
    });

    if (!saveResult.success) {
      return { success: false, error: saveResult.error || "Failed to save via CLI" };
    }

    return {
      success: true,
      itemsCount: 0,
      sourceArtifactsProcessed: 0,
      unresolvedItems: 0,
      resolvedItems: 0,
      truncated: false,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: \`Refresh failed: \${errorMsg}\` };
  }
}
EOF`;
}

/**
 * Generate scaffold command for missing save trigger
 */
function generateSaveTriggerScaffold(
  artifact: KnowledgeRevalidationArtifact,
  config: (typeof ARTIFACT_CONFIG)[KnowledgeRevalidationArtifact]
): string {
  return `cat > src/popup/save.ts.patch << 'EOF'
diff --git a/src/popup/save.ts b/src/popup/save.ts
index 1234567..abcdefg 100644
--- a/src/popup/save.ts
+++ b/src/popup/save.ts
@@ -500,6 +500,35 @@ async function refreshContradictionInbox(
   }
 }
 
+/**
+ * Refresh the ${artifact} after a successful save.
+ */
+async function ${config.refreshFunctionName}(
+  settings: Settings,
+  vault: string
+): Promise<void> {
+  // Skip if CLI is not configured
+  if (!settings.obsidianCli?.enabled || !settings.obsidianCli.cliPath) {
+    return;
+  }
+
+  const vaultPath = getVaultPathFromSettings(settings);
+  if (!vaultPath) {
+    return;
+  }
+
+  try {
+    await runtimeSendMessage<RuntimeRequest, ${config.responseType}>({
+      action: "${config.actionName}",
+      vaultPath,
+      cliPath: settings.obsidianCli.cliPath,
+      vault,
+    });
+  } catch (err) {
+    // Non-blocking: log and continue
+  }
+}
+
 export async function saveToObsidian(options: SaveOptions): Promise<SaveResult> {
   // ... existing save logic ...
@@ -650,6 +679,7 @@ export async function saveToObsidian(options: SaveOptions): Promise<SaveResult> {
         void refreshKeyTakeawaysInbox(settings, prepared.vault);
         void refreshKnowledgeTriageStateSync(settings, prepared.vault);
         void refreshContradictionInbox(settings, prepared.vault);
+        void ${config.refreshFunctionName}(settings, prepared.vault);
 
         return { usedClipboardFallback, usedMethod: method };
       }
EOF
patch -p1 < src/popup/save.ts.patch`;
}

/**
 * Generate violations for an artifact based on wiring status
 */
export function generateViolations(
  artifact: KnowledgeRevalidationArtifact,
  wiring: ArtifactWiring
): Violation[] {
  const violations: Violation[] = [];
  const config = ARTIFACT_CONFIG[artifact];

  // Check message type wiring
  if (!wiring.messageType.present) {
    let ruleId: RuleId = RuleIds.KRRP001_MISSING_MESSAGE_TYPE;
    let description = `Add ${config.actionName} message type to src/shared/messages.ts with ${config.requestType} and ${config.responseType} type definitions.`;

    if (wiring.messageType.requestDefined && !wiring.messageType.responseDefined) {
      description = `Add ${config.responseType} response type to src/shared/messages.ts.`;
    } else if (!wiring.messageType.requestDefined && wiring.messageType.responseDefined) {
      ruleId = RuleIds.KRRP007_MESSAGE_TYPE_MISMATCH;
      description = `Add ${config.actionName} request type to src/shared/messages.ts RuntimeRequest union.`;
    }

    violations.push({
      ruleId,
      severity: "error",
      artifactName: artifact,
      surface: "messageType",
      details: {
        expectedActionName: config.actionName,
        expectedRequestType: config.requestType,
        expectedResponseType: config.responseType,
        filePath: "src/shared/messages.ts",
      },
      remediation: {
        description,
        scaffoldCommand: generateMessageTypeScaffold(artifact, config),
      },
    });
  }

  // Check router wiring
  if (!wiring.router.present) {
    let ruleId: RuleId = RuleIds.KRRP002_MISSING_ROUTER_CASE;
    let description = `Add switch case for "${config.actionName}" in src/background/router.ts dispatch function.`;

    if (!wiring.router.caseExists && wiring.router.handlerImported) {
      description = `Add switch case for "${config.actionName}" and wire it to ${config.handlerName}.`;
    } else if (wiring.router.caseExists && !wiring.router.handlerImported) {
      ruleId = RuleIds.KRRP006_HANDLER_IMPORT_MISSING;
      description = `Add import for ${config.handlerName} in src/background/router.ts.`;
    }

    violations.push({
      ruleId,
      severity: "error",
      artifactName: artifact,
      surface: "router",
      details: {
        expectedActionName: config.actionName,
        filePath: "src/background/router.ts",
      },
      remediation: {
        description,
        scaffoldCommand: generateRouterScaffold(artifact, config),
      },
    });
  }

  // Check handler wiring
  if (!wiring.handler.present) {
    let ruleId: RuleId = RuleIds.KRRP003_MISSING_HANDLER_FILE;
    let description = `Create handler file at ${config.handlerFile} with ${config.handlerName} export.`;

    if (wiring.handler.fileExists && !wiring.handler.handlerExported) {
      ruleId = RuleIds.KRRP004_MISSING_HANDLER_EXPORT;
      description = `Add export for ${config.handlerName} function in ${config.handlerFile}.`;
    }

    violations.push({
      ruleId,
      severity: "error",
      artifactName: artifact,
      surface: "handler",
      details: {
        filePath: config.handlerFile,
        handlerName: config.handlerName,
      },
      remediation: {
        description,
        scaffoldCommand: generateHandlerScaffold(artifact, config),
      },
    });
  }

  // Check save trigger wiring
  if (!wiring.saveTrigger.present) {
    let ruleId: RuleId = RuleIds.KRRP005_MISSING_SAVE_TRIGGER;
    let description = `Add ${config.refreshFunctionName} function and fire-and-forget invocation in src/popup/save.ts.`;

    if (wiring.saveTrigger.refreshFunctionExists && !wiring.saveTrigger.invokedInSaveFlow) {
      description = `Add void ${config.refreshFunctionName}(settings, prepared.vault) invocation in save flow after primary save completes.`;
    } else if (!wiring.saveTrigger.refreshFunctionExists && wiring.saveTrigger.invokedInSaveFlow) {
      description = `Create ${config.refreshFunctionName} async function in src/popup/save.ts.`;
    }

    violations.push({
      ruleId,
      severity: "error",
      artifactName: artifact,
      surface: "saveTrigger",
      details: {
        functionName: config.refreshFunctionName,
        filePath: "src/popup/save.ts",
      },
      remediation: {
        description,
        scaffoldCommand: generateSaveTriggerScaffold(artifact, config),
      },
    });
  }

  return violations;
}

// =============================================================================
// Violation Sorting
// =============================================================================

/**
 * Sort violations in canonical order for deterministic output
 */
export function sortViolationsCanonical(violations: Violation[]): Violation[] {
  const ruleOrder = new Map<RuleId, number>();
  for (let i = 0; i < CANONICAL_VIOLATION_ORDER.length; i++) {
    ruleOrder.set(CANONICAL_VIOLATION_ORDER[i], i);
  }

  return [...violations].sort((a, b) => {
    // First by rule ID (canonical order)
    const orderA = ruleOrder.get(a.ruleId) ?? Number.MAX_SAFE_INTEGER;
    const orderB = ruleOrder.get(b.ruleId) ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }

    // Then by artifact name
    if (a.artifactName !== b.artifactName) {
      return a.artifactName.localeCompare(b.artifactName);
    }

    // Finally by surface
    const surfaceOrder: WiringSurface[] = ["messageType", "router", "handler", "saveTrigger"];
    const surfaceA = surfaceOrder.indexOf(a.surface);
    const surfaceB = surfaceOrder.indexOf(b.surface);
    return surfaceA - surfaceB;
  });
}

// =============================================================================
// Main Analysis Function
// =============================================================================

/**
 * Analyze knowledge-revalidation refresh contract parity
 */
export function analyzeKnowledgeRevalidationParity(
  taskpadPath: string,
  planPath: string,
  projectRoot: string
): KnowledgeRevalidationParityResult {
  const resolvedTaskpadPath = resolve(projectRoot, taskpadPath);
  const resolvedPlanPath = resolve(projectRoot, planPath);

  // Parse TASKPAD for planned knowledge-revalidation artifacts
  let taskpadContent: string;
  try {
    taskpadContent = readFileSync(resolvedTaskpadPath, "utf8");
  } catch (error) {
    throw new Error(`Failed to read TASKPAD file: ${error}`);
  }

  const plannedArtifacts = parseKnowledgeRevalidationArtifacts(taskpadContent);

  // Read surface files
  const messagesPath = resolve(projectRoot, "src/shared/messages.ts");
  const routerPath = resolve(projectRoot, "src/background/router.ts");
  const savePath = resolve(projectRoot, "src/popup/save.ts");

  let messagesContent = "";
  let routerContent = "";
  let saveContent = "";

  try {
    messagesContent = readFileSync(messagesPath, "utf8");
  } catch {
    // File not found - will be caught by validation
  }

  try {
    routerContent = readFileSync(routerPath, "utf8");
  } catch {
    // File not found - will be caught by validation
  }

  try {
    saveContent = readFileSync(savePath, "utf8");
  } catch {
    // File not found - will be caught by validation
  }

  // Validate all configured artifacts (even if not planned, for completeness)
  const allArtifacts: KnowledgeRevalidationArtifact[] = [
    "knowledge-revalidation-inbox",
    "knowledge-revalidation-state-sync",
  ];

  const artifactEntries: ArtifactEntry[] = [];
  const allViolations: Violation[] = [];

  for (const artifact of allArtifacts) {
    const config = ARTIFACT_CONFIG[artifact];
    const isPlanned = plannedArtifacts.includes(artifact);

    // Validate each surface
    const messageTypeWiring = validateMessageTypeWiring(messagesContent, artifact, config);
    const routerWiring = validateRouterWiring(routerContent, artifact, config);
    const handlerWiring = validateHandlerWiring(projectRoot, artifact, config);
    const saveTriggerWiring = validateSaveTriggerWiring(saveContent, artifact, config);

    const wiring: ArtifactWiring = {
      messageType: messageTypeWiring,
      router: routerWiring,
      handler: handlerWiring,
      saveTrigger: saveTriggerWiring,
    };

    // Only generate violations for planned artifacts
    if (isPlanned) {
      const violations = generateViolations(artifact, wiring);
      allViolations.push(...violations);
    }

    artifactEntries.push({
      artifactName: artifact,
      plannedInSlice: isPlanned,
      wiring,
    });
  }

  // Sort violations canonically
  const sortedViolations = sortViolationsCanonical(allViolations);

  // Compute summary
  const fullyWired = artifactEntries.filter(
    (a) =>
      a.plannedInSlice &&
      a.wiring.messageType.present &&
      a.wiring.router.present &&
      a.wiring.handler.present &&
      a.wiring.saveTrigger.present
  ).length;

  const partiallyWired = artifactEntries.filter(
    (a) =>
      a.plannedInSlice &&
      ((a.wiring.messageType.present ? 1 : 0) +
        (a.wiring.router.present ? 1 : 0) +
        (a.wiring.handler.present ? 1 : 0) +
        (a.wiring.saveTrigger.present ? 1 : 0) >=
        1) &&
      !(
        a.wiring.messageType.present &&
        a.wiring.router.present &&
        a.wiring.handler.present &&
        a.wiring.saveTrigger.present
      )
  ).length;

  const missingWiring = artifactEntries.filter(
    (a) =>
      a.plannedInSlice &&
      !a.wiring.messageType.present &&
      !a.wiring.router.present &&
      !a.wiring.handler.present &&
      !a.wiring.saveTrigger.present
  ).length;

  const summary: Summary = {
    totalArtifacts: plannedArtifacts.length,
    fullyWiredArtifacts: fullyWired,
    partiallyWiredArtifacts: partiallyWired,
    missingWiringArtifacts: missingWiring,
  };

  // Determine status
  const hasErrorViolations = sortedViolations.some((v) => v.severity === "error");
  const status: "pass" | "fail" = hasErrorViolations ? "fail" : "pass";

  return {
    status,
    inputs: {
      taskpadPath: resolvedTaskpadPath,
      planPath: resolvedPlanPath,
      projectRoot,
    },
    artifacts: artifactEntries,
    summary,
    violations: sortedViolations,
    timestamp: new Date().toISOString(),
  };
}

// =============================================================================
// Output Formatting
// =============================================================================

/**
 * Format result as JSON
 */
export function formatJsonOutput(result: KnowledgeRevalidationParityResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format result as human-readable text
 */
export function formatHumanOutput(result: KnowledgeRevalidationParityResult): string {
  const lines: string[] = [];

  lines.push(`TASKPAD Knowledge-Revalidation Refresh Contract Parity: ${result.status.toUpperCase()}`);
  lines.push("─".repeat(50));
  lines.push("");
  lines.push("Inputs:");
  lines.push(`  - taskpad: ${result.inputs.taskpadPath}`);
  lines.push(`  - plan: ${result.inputs.planPath}`);
  lines.push(`  - project-root: ${result.inputs.projectRoot}`);
  lines.push("");
  lines.push(`Artifacts: ${result.artifacts.length}`);

  for (const artifact of result.artifacts) {
    lines.push(`  1. ${artifact.artifactName}`);
    lines.push(`     - Planned in slice: ${artifact.plannedInSlice ? "yes" : "no"}`);

    const mt = artifact.wiring.messageType;
    lines.push(
      `     - MessageType: ${mt.present ? "✓ present" : "✗ missing"}${mt.requestType ? ` (${mt.requestType})` : ""}`
    );

    const rt = artifact.wiring.router;
    lines.push(
      `     - Router: ${rt.present ? "✓ present" : "✗ missing"}${rt.actionName ? ` (${rt.actionName})` : ""}`
    );

    const hd = artifact.wiring.handler;
    lines.push(
      `     - Handler: ${hd.present ? "✓ present" : "✗ missing"}${hd.filePath ? ` (${hd.filePath})` : ""}`
    );

    const st = artifact.wiring.saveTrigger;
    lines.push(
      `     - SaveTrigger: ${st.present ? "✓ present" : "✗ missing"}${st.functionName ? ` (${st.functionName})` : ""}`
    );
  }

  lines.push("");
  lines.push("Summary:");
  lines.push(`  - Total planned artifacts: ${result.summary.totalArtifacts}`);
  lines.push(`  - Fully wired: ${result.summary.fullyWiredArtifacts}`);
  lines.push(`  - Partially wired: ${result.summary.partiallyWiredArtifacts}`);
  lines.push(`  - Missing wiring: ${result.summary.missingWiringArtifacts}`);
  lines.push("");

  if (result.violations.length > 0) {
    lines.push(`Violations: ${result.violations.length}`);
    for (const v of result.violations) {
      lines.push(
        `  - [${v.ruleId}] ${v.artifactName} (${v.surface})`
      );
      lines.push(`    Remediation: ${v.remediation.description}`);
    }
  } else {
    lines.push("All knowledge-revalidation artifacts are fully wired through save-flow surfaces.");
  }

  return lines.join("\n");
}

// =============================================================================
// CLI Entry Point
// =============================================================================

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
  if (!parsed.taskpadPath || !parsed.planPath || !parsed.projectRoot) {
    console.error("Error: --taskpad, --plan, and --project-root are required");
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

  if (!existsSync(parsed.projectRoot)) {
    console.error(`Error: Project root directory not found: ${parsed.projectRoot}`);
    process.exit(2);
  }

  // Run analysis
  try {
    const result = analyzeKnowledgeRevalidationParity(
      parsed.taskpadPath,
      parsed.planPath,
      parsed.projectRoot
    );

    // Format output
    const format = parsed.format ?? "json";
    const output =
      format === "human" ? formatHumanOutput(result) : formatJsonOutput(result);

    console.log(output);

    // Set exit code
    process.exit(result.status === "fail" ? 1 : 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(2);
  }
}

// Run CLI if executed directly
if (import.meta.main) {
  main(process.argv.slice(2));
}
