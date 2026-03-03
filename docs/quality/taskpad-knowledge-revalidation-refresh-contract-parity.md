# TASKPAD Knowledge-Revalidation Refresh Contract Parity

## Purpose

Define a deterministic contract that validates planned knowledge-revalidation artifacts are fully wired through save-flow runtime surfaces (`popup/save.ts`, `messages.ts`, `router.ts`, and background handlers) before release.

## Problem Statement

Knowledge-revalidation artifacts (`knowledge-revalidation-inbox.md`, `knowledge-revalidation-state-sync.md`) are now planned to suppress stale assumptions, but there is no dedicated parity gate proving these artifacts are fully wired through save-flow runtime surfaces. Without deterministic wiring checks, revalidation surfaces can silently drift (message/router/handler/save-trigger gaps) while intake automation still appears green.

We need a focused contract gate that blocks revalidation refresh drift before release by validating required wiring presence for all planned knowledge-revalidation artifacts.

## Knowledge-Revalidation Artifact Targets

The gate MUST validate refresh wiring parity for these planned knowledge-revalidation artifacts:

| Artifact | Description | Required Handler Pattern |
|----------|-------------|--------------------------|
| `knowledge-revalidation-inbox.md` | Aggregates stale assumptions requiring revalidation from knowledge artifacts | `refreshKnowledgeRevalidationInbox.ts` |
| `knowledge-revalidation-state-sync.md` | Reconciles revalidation status edits to source knowledge artifacts | `refreshKnowledgeRevalidationStateSync.ts` |

## Required Wiring Surfaces

For each knowledge-revalidation artifact, the gate MUST validate presence of wiring across these runtime surfaces:

### 1. Message Type Definition (`src/shared/messages.ts`)

**Required for each artifact:**
- Request type with `action: "refresh<ArtifactName>"` (e.g., `"refreshKnowledgeRevalidationInbox"`)
- Response type with success/error variants
- Proper TypeScript export

**Message Request Pattern:**
```typescript
{
  action: "refreshKnowledgeRevalidationInbox";
  vaultPath: string;
  cliPath: string;
  vault: string;
  inboxFolder?: string;
  maxFiles?: number;
}
```

**Message Response Pattern:**
```typescript
{
  success: true;
  assumptionsCount: number;
  staleAssumptions: number;
  revalidatedAssumptions: number;
  sourceArtifactsProcessed: number;
  truncated: boolean;
}
| {
  success: false;
  error: string;
}
```

### 2. Router Dispatch (`src/background/router.ts`)

**Required for each artifact:**
- Import statement for the handler function
- Switch case in `dispatch()` function
- Type-safe routing to handler

**Router Pattern:**
```typescript
import { handleRefreshKnowledgeRevalidationInbox } from "./handlers/refreshKnowledgeRevalidationInbox";

// In dispatch():
case "refreshKnowledgeRevalidationInbox":
  return handleRefreshKnowledgeRevalidationInbox(request);
```

### 3. Background Handler (`src/background/handlers/refreshKnowledgeRevalidation*.ts`)

**Required for each artifact:**
- Handler file at `src/background/handlers/refreshKnowledgeRevalidation<ArtifactKind>.ts`
- Async handler function matching TypeScript signature
- Error handling with deterministic fallback

**Handler Pattern:**
```typescript
import type { RefreshKnowledgeRevalidationInboxResponse } from "../../shared/messages";

export async function handleRefreshKnowledgeRevalidationInbox(
  request: RefreshKnowledgeRevalidationInboxRequest
): Promise<RefreshKnowledgeRevalidationInboxResponse> {
  // Validate inputs
  // Scan vault for stale assumptions
  // Build inbox from scanned assumptions
  // Save inbox via CLI
  // Return metadata or error
}
```

### 4. Popup Save Trigger (`src/popup/save.ts`)

**Required for each artifact:**
- Async refresh function with settings and vault parameters
- Non-blocking fire-and-forget invocation in save flow
- Proper error handling (does not block primary save)

**Refresh Function Pattern:**
```typescript
async function refreshKnowledgeRevalidationInbox(
  settings: Settings,
  vault: string
): Promise<void> {
  // Get vault path from settings
  // Send message to background
  // Log errors, do not block
}

// In save flow (after primary save completes):
void refreshKnowledgeRevalidationInbox(settings, prepared.vault);
```

## Deterministic Rule ID Taxonomy

All validation rule IDs follow the pattern `KRRPXXX_DESCRIPTION` for stable machine-readable diagnostics.

| Rule ID | Description | Severity | Condition |
|---------|-------------|----------|-----------|
| `KRRP001_MISSING_MESSAGE_TYPE` | Knowledge-revalidation refresh message type not defined in `messages.ts` | `error` | No request/response type found for `refresh<ArtifactName>` action |
| `KRRP002_MISSING_ROUTER_CASE` | Knowledge-revalidation refresh handler not routed in `router.ts` | `error` | Router switch case missing for `refresh<ArtifactName>` action |
| `KRRP003_MISSING_HANDLER_FILE` | Knowledge-revalidation refresh handler file does not exist | `error` | Handler file `src/background/handlers/refreshKnowledgeRevalidation*.ts` not found |
| `KRRP004_MISSING_HANDLER_EXPORT` | Knowledge-revalidation refresh handler not exported from file | `error` | Handler file exists but `handleRefreshKnowledgeRevalidation*` export not found |
| `KRRP005_MISSING_SAVE_TRIGGER` | Knowledge-revalidation refresh not invoked in popup save flow | `error` | No async refresh function or invocation found in `src/popup/save.ts` |
| `KRRP006_HANDLER_IMPORT_MISSING` | Handler not imported in router | `error` | Router case exists but handler import statement missing |
| `KRRP007_MESSAGE_TYPE_MISMATCH` | Message type definition does not match expected pattern | `error` | Message action name does not match handler name pattern |
| `KRRP008_RESPONSE_TYPE_INCOMPLETE` | Message response type missing required fields | `warning` | Success response missing metadata fields |
| `KRRP009_HANDLER_SIGNATURE_MISMATCH` | Handler function signature does not match message type | `error` | Handler parameters do not align with request type |
| `KRRP010_NO_ARTIFACT_TARGETS` | No knowledge-revalidation artifacts defined in plan | `warning` | Plan contains no planned knowledge-revalidation artifacts to validate |

## CLI Contract

### Command Inputs

| Argument | Required | Description |
|-----------|-----------|-------------|
| `--taskpad <path>` | ✅ | Path to TASKPAD markdown file (for parsing planned knowledge-revalidation items) |
| `--plan <path>` | ✅ | Path to IMPLEMENTATION_PLAN markdown file |
| `--project-root <path>` | ✅ | Project root directory (for resolving relative file paths) |
| `--format <format>` | ❌ | Output format: `json` or `human` (default: json) |
| `--help, -h` | ❌ | Show help message and exit |

### Exit Codes

| Exit Code | Condition |
|-----------|-----------|
| `0` | All knowledge-revalidation artifacts have complete wiring across all required surfaces |
| `1` | One or more knowledge-revalidation artifacts are missing required wiring |
| `2` | Input validation failure (invalid arguments, unreadable files) |

## Deterministic Output Schema

### JSON Format

When `--format json` is specified, the command MUST emit exactly one JSON object:

```json
{
  "status": "pass|fail",
  "inputs": {
    "taskpadPath": "string",
    "planPath": "string",
    "projectRoot": "string"
  },
  "artifacts": [
    {
      "artifactName": "knowledge-revalidation-inbox|knowledge-revalidation-state-sync",
      "plannedInSlice": true,
      "wiring": {
        "messageType": {
          "present": true,
          "requestDefined": true,
          "responseDefined": true,
          "requestType": "RefreshKnowledgeRevalidationInboxRequest",
          "responseType": "RefreshKnowledgeRevalidationInboxResponse"
        },
        "router": {
          "present": true,
          "caseExists": true,
          "handlerImported": true,
          "actionName": "refreshKnowledgeRevalidationInbox"
        },
        "handler": {
          "present": true,
          "fileExists": true,
          "handlerExported": true,
          "filePath": "src/background/handlers/refreshKnowledgeRevalidationInbox.ts",
          "handlerName": "handleRefreshKnowledgeRevalidationInbox"
        },
        "saveTrigger": {
          "present": true,
          "refreshFunctionExists": true,
          "invokedInSaveFlow": true,
          "functionName": "refreshKnowledgeRevalidationInbox"
        }
      }
    }
  ],
  "summary": {
    "totalArtifacts": 2,
    "fullyWiredArtifacts": 2,
    "partiallyWiredArtifacts": 0,
    "missingWiringArtifacts": 0
  },
  "violations": [
    {
      "ruleId": "KRRP001_MISSING_MESSAGE_TYPE",
      "severity": "error|warning",
      "artifactName": "knowledge-revalidation-inbox",
      "surface": "messageType|router|handler|saveTrigger",
      "details": {
        "expectedActionName": "refreshKnowledgeRevalidationInbox",
        "expectedRequestType": "RefreshKnowledgeRevalidationInboxRequest",
        "expectedResponseType": "RefreshKnowledgeRevalidationInboxResponse",
        "filePath": "src/shared/messages.ts",
        "lineNumber": 42
      },
      "remediation": {
        "description": "Add refreshKnowledgeRevalidationInbox message type to src/shared/messages.ts",
        "scaffoldCommand": "cat > src/shared/messages.ts.patch << 'EOF'\ndiff --git a/src/shared/messages.ts b/src/shared/messages.ts\nindex 1234567..abcdefg 100644\n--- a/src/shared/messages.ts\n+++ b/src/shared/messages.ts\n@@ -10,6 +10,25 @@ import type { Settings } from \"./types\";\n \n /**\n  * Messages sent to the background service worker via chrome.runtime.sendMessage().\n  */\n export type RuntimeRequest =\n   | { action: \"getSettings\" }\n+  | {\n+      action: \"refreshKnowledgeRevalidationInbox\";\n+      vaultPath: string;\n+      cliPath: string;\n+      vault: string;\n+      inboxFolder?: string;\n+      maxFiles?: number;\n+    }\n   | { action: \"saveContent\" /* ... */ };\n\n export type RefreshKnowledgeRevalidationInboxResponse =\n   | {\n+      success: true;\n+      assumptionsCount: number;\n+      staleAssumptions: number;\n+      revalidatedAssumptions: number;\n+      sourceArtifactsProcessed: number;\n+      truncated: boolean;\n+    }\n   | { success: false; error: string };\nEOF\n"
      }
    }
  ],
  "timestamp": "2026-03-03T14:33:18.000Z"
}
```

### Human Format

When `--format human` is specified or default, the command MUST emit:

```
TASKPAD Knowledge-Revalidation Refresh Contract Parity: PASS
──────────────────────────────────────────────────────────
Inputs:
  - taskpad: /path/to/TASKPAD.md
  - plan: IMPLEMENTATION_PLAN.md
  - project-root: .

Artifacts: 2
  1. knowledge-revalidation-inbox
     - Planned in slice: yes
     - MessageType: ✓ present
     - Router: ✓ present
     - Handler: ✓ present (src/background/handlers/refreshKnowledgeRevalidationInbox.ts)
     - SaveTrigger: ✓ present

  2. knowledge-revalidation-state-sync
     - Planned in slice: yes
     - MessageType: ✓ present
     - Router: ✓ present
     - Handler: ✓ present (src/background/handlers/refreshKnowledgeRevalidationStateSync.ts)
     - SaveTrigger: ✓ present

Summary:
  - Total artifacts: 2
  - Fully wired: 2
  - Partially wired: 0
  - Missing wiring: 0

All knowledge-revalidation artifacts are fully wired through save-flow surfaces.
```

For failures:

```
TASKPAD Knowledge-Revalidation Refresh Contract Parity: FAIL
──────────────────────────────────────────────────────────
Inputs:
  - taskpad: /path/to/TASKPAD.md
  - plan: IMPLEMENTATION_PLAN.md
  - project-root: .

Artifacts: 2
  1. knowledge-revalidation-inbox
     - Planned in slice: yes
     - MessageType: ✗ missing
       [KRRP001_MISSING_MESSAGE_TYPE] Request/Response type not defined in src/shared/messages.ts
     - Router: ✗ missing
       [KRRP002_MISSING_ROUTER_CASE] No switch case for refreshKnowledgeRevalidationInbox action
     - Handler: ✗ missing
       [KRRP003_MISSING_HANDLER_FILE] File src/background/handlers/refreshKnowledgeRevalidationInbox.ts does not exist
     - SaveTrigger: ✗ missing
       [KRRP005_MISSING_SAVE_TRIGGER] No refresh function or invocation in src/popup/save.ts

  2. knowledge-revalidation-state-sync
     - Planned in slice: yes
     - MessageType: ✓ present
     - Router: ✓ present
     - Handler: ✓ present (src/background/handlers/refreshKnowledgeRevalidationStateSync.ts)
     - SaveTrigger: ✗ missing
       [KRRP005_MISSING_SAVE_TRIGGER] No refresh function or invocation in src/popup/save.ts

Summary:
  - Total artifacts: 2
  - Fully wired: 0
  - Partially wired: 1
  - Missing wiring: 1

Violations: 4
  1. [KRRP001_MISSING_MESSAGE_TYPE] knowledge-revalidation-inbox (messageType)
     Expected: refreshKnowledgeRevalidationInbox request/response types in src/shared/messages.ts
     Remediation: Add message type definition
     Scaffold: cat > src/shared/messages.ts.patch << 'EOF'\ndiff --git a/src/shared/messages.ts b/src/shared/messages.ts\n...

  2. [KRRP002_MISSING_ROUTER_CASE] knowledge-revalidation-inbox (router)
     Expected: switch case for "refreshKnowledgeRevalidationInbox" in src/background/router.ts
     Remediation: Add router dispatch case

  3. [KRRP003_MISSING_HANDLER_FILE] knowledge-revalidation-inbox (handler)
     Expected: handler file at src/background/handlers/refreshKnowledgeRevalidationInbox.ts
     Remediation: Create handler file with handleRefreshKnowledgeRevalidationInbox export

  4. [KRRP005_MISSING_SAVE_TRIGGER] knowledge-revalidation-inbox (saveTrigger)
     Expected: refreshKnowledgeRevalidationInbox function and invocation in src/popup/save.ts
     Remediation: Add refresh function and fire-and-forget invocation in save flow
```

## Artifact Discovery Rules

### Planned Artifact Extraction from Work Queue

The gate MUST parse the TASKPAD Work Queue section to discover planned knowledge-revalidation artifacts:

**Work Queue Item Pattern:**
```markdown
- [ ] Add knowledge-revalidation-inbox.md export with stale assumption detection
- [ ] Wire knowledge-revalidation-state-sync.md refresh for status reconciliation
```

**Extraction Logic:**
1. Scan `## Work Queue` section in TASKPAD
2. Match items containing `knowledge-revalidation-inbox` or `knowledge-revalidation-state-sync` keywords
3. Extract artifact name from item text
4. Mark artifact as `plannedInSlice: true` when found in active slice
5. Consider artifacts not in active slice as `plannedInSlice: false` but still validate wiring

### Artifact-to-Handler Mapping

The gate MUST map knowledge-revalidation artifacts to their expected handler files using this mapping:

| Artifact Name | Expected Handler File | Expected Handler Function |
|---------------|------------------------|---------------------------|
| `knowledge-revalidation-inbox` | `src/background/handlers/refreshKnowledgeRevalidationInbox.ts` | `handleRefreshKnowledgeRevalidationInbox` |
| `knowledge-revalidation-state-sync` | `src/background/handlers/refreshKnowledgeRevalidationStateSync.ts` | `handleRefreshKnowledgeRevalidationStateSync` |

## Validation Rules Per Surface

### MessageType Surface Validation

**Check 1: Request Type Definition**
- Search `src/shared/messages.ts` for `RuntimeRequest` union type
- Verify action member exists with pattern `action: "refresh<ArtifactName>"`
- Verify required fields: `vaultPath`, `cliPath`, `vault`, optional `inboxFolder`, `maxFiles`

**Check 2: Response Type Definition**
- Search `src/shared/messages.ts` for `Refresh<ArtifactName>Response` type
- Verify success variant with metadata fields
- Verify error variant with `error: string`

**Check 3: Export Validation**
- Verify both request (via RuntimeRequest) and response types are exported

**Expected Pattern:**
```typescript
export type RuntimeRequest =
  | { action: "getSettings" }
  | { action: "refreshKnowledgeRevalidationInbox"; vaultPath: string; cliPath: string; vault: string; inboxFolder?: string; maxFiles?: number; }
  | { /* ... */ };

export type RefreshKnowledgeRevalidationInboxResponse =
  | { success: true; assumptionsCount: number; staleAssumptions: number; revalidatedAssumptions: number; sourceArtifactsProcessed: number; truncated: boolean; }
  | { success: false; error: string };
```

### Router Surface Validation

**Check 1: Handler Import**
- Search `src/background/router.ts` for import statement
- Pattern: `import { handleRefreshKnowledgeRevalidationInbox } from "./handlers/refreshKnowledgeRevalidationInbox"`

**Check 2: Switch Case**
- Search `dispatch()` function switch statement
- Verify case exists: `case "refreshKnowledgeRevalidationInbox":`
- Verify handler invocation: `return handleRefreshKnowledgeRevalidationInbox(request);`

**Check 3: Type Safety**
- Verify TypeScript compiles without errors (request type matches handler signature)

**Expected Pattern:**
```typescript
import { handleRefreshKnowledgeRevalidationInbox } from "./handlers/refreshKnowledgeRevalidationInbox";

export async function dispatch(request: RuntimeRequest): Promise<unknown> {
  switch (request.action) {
    case "getSettings":
      return handleGetSettings();
    case "refreshKnowledgeRevalidationInbox":
      return handleRefreshKnowledgeRevalidationInbox(request);
    /* ... */
  }
}
```

### Handler Surface Validation

**Check 1: File Existence**
- Verify handler file exists at expected path
- File must be TypeScript (`.ts` extension)

**Check 2: Handler Export**
- Parse handler file content
- Verify export statement: `export async function handleRefreshKnowledgeRevalidationInbox`
- Verify function is async

**Check 3: Import Validation**
- Verify imports include response type from `messages.ts`
- Pattern: `import type { RefreshKnowledgeRevalidationInboxResponse } from "../../shared/messages"`

**Expected Pattern:**
```typescript
import type { RefreshKnowledgeRevalidationInboxResponse } from "../../shared/messages";

export async function handleRefreshKnowledgeRevalidationInbox(
  request: RefreshKnowledgeRevalidationInboxRequest
): Promise<RefreshKnowledgeRevalidationInboxResponse> {
  // Validate inputs
  // Build knowledge revalidation inbox
  // Save via CLI
  // Return response
}
```

### SaveTrigger Surface Validation

**Check 1: Refresh Function Existence**
- Search `src/popup/save.ts` for async refresh function
- Pattern: `async function refreshKnowledgeRevalidationInbox(settings: Settings, vault: string): Promise<void>`

**Check 2: Message Invocation**
- Verify function sends message to background with correct action
- Pattern: `chrome.runtime.sendMessage<RuntimeRequest, RefreshKnowledgeRevalidationInboxResponse>({ action: "refreshKnowledgeRevalidationInbox", ... })`

**Check 3: Save Flow Invocation**
- Search for fire-and-forget invocation after primary save completes
- Pattern: `void refreshKnowledgeRevalidationInbox(settings, prepared.vault);`
- Verify invocation uses `void` prefix for non-blocking behavior

**Expected Pattern:**
```typescript
async function refreshKnowledgeRevalidationInbox(
  settings: Settings,
  vault: string
): Promise<void> {
  const vaultPath = /* ... */;
  const cliPath = settings.obsidianCli.cliPath;

  try {
    const response = await chrome.runtime.sendMessage<
      RuntimeRequest,
      RefreshKnowledgeRevalidationInboxResponse
    >({
      action: "refreshKnowledgeRevalidationInbox",
      vaultPath,
      cliPath,
      vault,
    });

    if (!response.success) {
      console.error("Failed to refresh knowledge revalidation inbox:", response.error);
    }
  } catch (error) {
    console.error("Error refreshing knowledge revalidation inbox:", error);
  }
}

// In save flow:
void refreshKnowledgeRevalidationInbox(settings, prepared.vault);
```

## Deterministic Validation Order

The gate MUST validate artifacts in this exact order for deterministic output:

1. **Parse CLI arguments** - Validate `--taskpad`, `--plan`, `--project-root` inputs
2. **Parse TASKPAD Work Queue** - Discover planned knowledge-revalidation artifacts
3. **Parse IMPLEMENTATION_PLAN** - Extract active slice context (for artifact planning)
4. **Validate MessageType surface** - Check each artifact's message types in `messages.ts`
5. **Validate Router surface** - Check each artifact's routing in `router.ts`
6. **Validate Handler surface** - Check each artifact's handler file and exports
7. **Validate SaveTrigger surface** - Check each artifact's save flow trigger in `save.ts`
8. **Aggregate wiring status** - Determine complete/partial/missing wiring per artifact
9. **Generate violations** - Emit rule violations for missing wiring
10. **Compute summary** - Aggregate counts for all artifacts

## Canonical Violation Ordering

Violations MUST be sorted in this canonical order for deterministic output:

1. **KRRP001_MISSING_MESSAGE_TYPE** - Missing message type definitions
2. **KRRP007_MESSAGE_TYPE_MISMATCH** - Message type name mismatches
3. **KRRP008_RESPONSE_TYPE_INCOMPLETE** - Incomplete response types
4. **KRRP002_MISSING_ROUTER_CASE** - Missing router cases
5. **KRRP006_HANDLER_IMPORT_MISSING** - Missing handler imports
6. **KRRP003_MISSING_HANDLER_FILE** - Missing handler files
7. **KRRP004_MISSING_HANDLER_EXPORT** - Missing handler exports
8. **KRRP009_HANDLER_SIGNATURE_MISMATCH** - Handler signature mismatches
9. **KRRP005_MISSING_SAVE_TRIGGER** - Missing save triggers
10. **KRRP010_NO_ARTIFACT_TARGETS** - No artifact targets found

Within the same rule ID, violations MUST be ordered by:
1. Artifact name (alphabetical)
2. Surface type (messageType → router → handler → saveTrigger)

## Pass/Fail Conditions

### PASS Conditions

The gate MUST return `status="pass"` (exit `0`) when ALL of these are true:

- All planned knowledge-revalidation artifacts have `wiring.messageType.present: true`
- All planned knowledge-revalidation artifacts have `wiring.router.present: true`
- All planned knowledge-revalidation artifacts have `wiring.handler.present: true`
- All planned knowledge-revalidation artifacts have `wiring.saveTrigger.present: true`
- No error-level violations (warnings are allowed but do not fail the gate)

### FAIL Conditions

The gate MUST return `status="fail"` (exit `1`) when ANY of these are true:

- At least one knowledge-revalidation artifact is missing MessageType wiring
- At least one knowledge-revalidation artifact is missing Router wiring
- At least one knowledge-revalidation artifact is missing Handler wiring
- At least one knowledge-revalidation artifact is missing SaveTrigger wiring
- At least one error-level violation exists

### Input Validation Failures

The gate MUST return exit code `2` when:

- CLI arguments are invalid (missing required flags, invalid file paths)
- Input files (`--taskpad`, `--plan`) are not readable
- Project root directory does not exist

## Remediation Payload Schema

### Scaffold Command Format

Each violation MUST include a `remediation.scaffoldCommand` field containing a shell command that generates a unified diff patch to add missing wiring.

**Scaffold Command Requirements:**
- Use POSIX-compliant shell syntax
- Output must be valid unified diff format
- Patch must apply cleanly with `patch -p1 < patchfile`
- Include context lines for accurate application
- Use placeholder values where artifact-specific data is unknown

**Example Scaffold Command (MessageType):**
```bash
cat > src/shared/messages.ts.patch << 'EOF'
diff --git a/src/shared/messages.ts b/src/shared/messages.ts
index 1234567..abcdefg 100644
--- a/src/shared/messages.ts
+++ b/src/shared/messages.ts
@@ -10,6 +10,25 @@ import type { Settings } from "./types";

 /**
  * Messages sent to the background service worker via chrome.runtime.sendMessage().
  */
 export type RuntimeRequest =
   | { action: "getSettings" }
+  | {
+      action: "refreshKnowledgeRevalidationInbox";
+      vaultPath: string;
+      cliPath: string;
+      vault: string;
+      inboxFolder?: string;
+      maxFiles?: number;
+    }
   | { action: "saveContent" /* ... */ };

 export type RefreshKnowledgeRevalidationInboxResponse =
   | {
+      success: true;
+      assumptionsCount: number;
+      staleAssumptions: number;
+      revalidatedAssumptions: number;
+      sourceArtifactsProcessed: number;
+      truncated: boolean;
+    }
   | { success: false; error: string };
EOF
patch -p1 < src/shared/messages.ts.patch
```

**Example Scaffold Command (Router):**
```bash
cat > src/background/router.ts.patch << 'EOF'
diff --git a/src/background/router.ts b/src/background/router.ts
index 1234567..abcdefg 100644
--- a/src/background/router.ts
+++ b/src/background/router.ts
@@ -10,6 +10,7 @@ import { handleRefreshOpenQuestionsInbox } from "./handlers/refreshOpenQuestionsInbox";
 import { handleRefreshKeyTakeawaysInbox } from "./handlers/refreshKeyTakeawaysInbox";
 import { handleRefreshKnowledgeTriageStateSync } from "./handlers/refreshKnowledgeTriageStateSync";
 import { handleRefreshContradictionInbox } from "./handlers/refreshContradictionInbox";
+import { handleRefreshKnowledgeRevalidationInbox } from "./handlers/refreshKnowledgeRevalidationInbox";

 export async function dispatch(request: RuntimeRequest): Promise<unknown> {
   switch (request.action) {
@@ -30,6 +31,8 @@ export async function dispatch(request: RuntimeRequest): Promise<unknown> {
       return handleRefreshKnowledgeTriageStateSync(request);
     case "refreshContradictionInbox":
       return handleRefreshContradictionInbox(request);
+    case "refreshKnowledgeRevalidationInbox":
+      return handleRefreshKnowledgeRevalidationInbox(request);
     case "testNativeHost":
       return handleTestNativeHost(request);
     default: {
EOF
patch -p1 < src/background/router.ts.patch
```

**Example Scaffold Command (Handler):**
```bash
cat > src/background/handlers/refreshKnowledgeRevalidationInbox.ts << 'EOF'
/**
 * Handler for refreshing the knowledge-revalidation-inbox.md.
 */

import type { RefreshKnowledgeRevalidationInboxResponse } from "../../shared/messages";
import { handleSaveToCli } from "./saveToCli";

interface RefreshKnowledgeRevalidationInboxRequest {
  action: "refreshKnowledgeRevalidationInbox";
  vaultPath: string;
  cliPath: string;
  vault: string;
  inboxFolder?: string;
  maxFiles?: number;
}

/**
 * Handle refreshKnowledgeRevalidationInbox requests.
 */
export async function handleRefreshKnowledgeRevalidationInbox(
  request: RefreshKnowledgeRevalidationInboxRequest
): Promise<RefreshKnowledgeRevalidationInboxResponse> {
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
    
    const inboxFilename = "knowledge-revalidation-inbox.md";
    const inboxPath = inboxFolder
      ? \`\${inboxFolder.replace(/\\\\/g, "/").replace(/^\\/+|\\/+$/g, "")}/\${inboxFilename}\`
      : inboxFilename;

    // Save via CLI
    const saveResult = await handleSaveToCli({
      action: "saveToCli",
      filePath: inboxPath,
      content: "# \\\${inboxFilename}\\n\\nTODO: Implement content generation",
      vault,
      cliPath,
    });

    if (!saveResult.success) {
      return { success: false, error: saveResult.error || "Failed to save via CLI" };
    }

    return {
      success: true,
      assumptionsCount: 0,
      staleAssumptions: 0,
      revalidatedAssumptions: 0,
      sourceArtifactsProcessed: 0,
      truncated: false,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: \`Refresh failed: \${errorMsg}\` };
  }
}
EOF
```

**Example Scaffold Command (SaveTrigger):**
```bash
cat > src/popup/save.ts.patch << 'EOF'
diff --git a/src/popup/save.ts b/src/popup/save.ts
index 1234567..abcdefg 100644
--- a/src/popup/save.ts
+++ b/src/popup/save.ts
@@ -500,6 +500,35 @@ async function refreshContradictionInbox(
   }
 }
 
+/**
+ * Refresh the knowledge-revalidation-inbox.md after a successful save.
+ */
+async function refreshKnowledgeRevalidationInbox(
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
+    await runtimeSendMessage<RuntimeRequest, RefreshKnowledgeRevalidationInboxResponse>({
+      action: "refreshKnowledgeRevalidationInbox",
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
+        void refreshKnowledgeRevalidationInbox(settings, prepared.vault);
 
         return { usedClipboardFallback, usedMethod: method };
       }
EOF
patch -p1 < src/popup/save.ts.patch
```

### Remediation Description

Each violation MUST include a human-readable `remediation.description` field explaining what needs to be done.

**Example:**
```
"Add refreshKnowledgeRevalidationInbox message type to src/shared/messages.ts with request and response type definitions following the existing inbox refresh pattern."
```

## Idempotency Guarantees

The gate MUST be idempotent for repeated runs with identical inputs:

- TASKPAD Work Queue parsing returns the same set of planned artifacts
- File path resolution produces the same absolute paths
- String matching for type definitions is deterministic
- Output JSON has stable field ordering across runs

## Assumptions

### Assumption 1: Taskpad Work Queue Contains Planned Knowledge-Revalidation Artifacts

TASKPAD Work Queue MUST contain items describing planned knowledge-revalidation artifacts for validation.

**Rationale**: Without planned artifact metadata, the gate cannot determine which artifacts require wiring validation.

### Assumption 2: Handler File Naming Follows Convention

Knowledge-revalidation refresh handlers MUST be named `refreshKnowledgeRevalidation<ArtifactKind>.ts` and export `handleRefreshKnowledgeRevalidation<ArtifactKind>`.

**Rationale**: Naming conventions enable deterministic file path inference without complex configuration.

### Assumption 3: Message Types Follow Existing Inbox Pattern

Knowledge-revalidation refresh message types MUST follow the pattern used by existing inbox/state-sync artifacts (open-questions, key-takeaways, knowledge-triage-state-sync, contradiction-inbox, knowledge-confidence-state-sync).

**Rationale**: Consistency reduces validation complexity and ensures TypeScript type safety.

### Assumption 4: Save Flow Uses Fire-and-Forget Pattern

Knowledge-revalidation refresh invocations in save flow MUST use `void` prefix for non-blocking behavior after primary save completes.

**Rationale**: Knowledge-revalidation refresh should not block primary clip note save on failures.

### Assumption 5: TypeScript Compilation Validates Type Safety

TypeScript compilation errors in `router.ts` or handler files indicate wiring failures even if structural checks pass.

**Rationale**: Type mismatches between message types and handler signatures can cause runtime failures.

## Integration with verify:taskpad:intake:auto

The `verify:taskpad:intake:auto` command MUST compose `taskpad:knowledge-revalidation-refresh-contract-parity` with other intake gates.

**Expected order:**
1. `taskpad:queue-health` (validate queues have unchecked work)
2. `taskpad:planned-command-parity` (validate planned items reference executable commands)
3. `taskpad:fallback-artifact-parity` (validate fallback artifacts are resolved)
4. `taskpad:evidence-gap-refresh-contract-parity` (validate evidence-gap refresh wiring)
5. `taskpad:knowledge-revalidation-refresh-contract-parity` (validate knowledge-revalidation refresh wiring)
6. `plan:integrity` (validate IMPLEMENTATION_PLAN structure)

**Integration behavior:**
- Knowledge-revalidation refresh parity check runs after evidence-gap refresh parity check
- Gate failures MUST fail fast before Builder dispatch
- Missing knowledge-revalidation wiring MUST be surfaced as actionable blockers with scaffold commands

## Non-Goals

- **Implementing knowledge-revalidation artifact generation** - This gate validates wiring; artifact content generation is out of scope
- **Validating save-flow behavior** - This gate validates wiring presence, not refresh correctness
- **Validating non-revalidation artifacts** - Only knowledge-revalidation artifacts are in scope
- **Validating content of artifact files** - Only wiring surface presence is validated
- **Refactoring existing inbox refresh patterns** - This gate follows existing patterns, does not redesign them

## Documentation Requirements

When implementing or using this gate, maintain:

1. **Quality contract** - This document (`docs/quality/taskpad-knowledge-revalidation-refresh-contract-parity.md`)
2. **README integration** - Usage examples and verification flow documentation in `README.md`
3. **Fixture evidence** - Test fixtures demonstrating pass/missing-handler/missing-router/missing-message/missing-save-trigger states
4. **Rule ID mapping** - Stable rule ID taxonomy in violation output

## Verification Commands

```bash
# Run knowledge-revalidation refresh contract parity gate on live project
bun run taskpad:knowledge-revalidation-refresh-contract-parity -- \
  --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --project-root . \
  --format json

# Run as part of full intake verification
bun run verify:taskpad:intake:auto -- \
  --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --format json
```

## References

- [`taskpad-evidence-gap-refresh-contract-parity.md`](./taskpad-evidence-gap-refresh-contract-parity.md) - Similar gate contract pattern for evidence-gap artifacts
- [`src/shared/messages.ts`](../src/shared/messages.ts) - Message type definitions
- [`src/background/router.ts`](../src/background/router.ts) - Message routing
- [`src/popup/save.ts`](../src/popup/save.ts) - Save flow orchestration
- [`src/background/handlers/refreshContradictionInbox.ts`](../src/background/handlers/refreshContradictionInbox.ts) - Example inbox refresh handler
- [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) - Active slice containing knowledge-revalidation artifact planning
