# MarkItDown Priority Brief Refresh Contract Parity Gate

> Contract specification for `taskpad:markitdown-priority-brief-refresh-contract-parity` deterministic parity gate.
> 
> **Version**: 1.0.0  
> **Artifact Target**: `markitdown-conversion-priority-brief.md`  
> **TP Reference**: TP001 (Specify parity gate contract)

---

## 1. Purpose

This gate validates that the `markitdown-conversion-priority-brief.md` artifact is fully wired through all required save-flow runtime surfaces before release. It detects wiring drift (missing message types, router cases, handlers, or save triggers) and emits deterministic violations with machine-readable remediation payloads.

---

## 2. Artifact Target

### 2.1 Primary Artifact

| Field | Value |
|-------|-------|
| `artifactName` | `markitdown-conversion-priority-brief` |
| `artifactFilename` | `markitdown-conversion-priority-brief.md` |
| `plannedInSlice` | Detected from TASKPAD Work Queue |

### 2.2 Detection Pattern

The artifact is considered "planned" when the TASKPAD Work Queue contains unchecked items referencing:
- `markitdown-conversion-priority-brief.md`
- `markitdown-priority-brief`

---

## 3. Required Wiring Surfaces

### 3.1 Surface Overview

| Surface | File Path | Purpose |
|---------|-----------|---------|
| `messageType` | `src/shared/messages.ts` | Runtime request/response type definitions |
| `router` | `src/background/router.ts` | Action dispatch routing |
| `handler` | `src/background/handlers/refreshMarkitdownConversionPriorityBrief.ts` | Refresh implementation |
| `saveTrigger` | `src/popup/save.ts` | Fire-and-forget refresh invocation |

### 3.2 Surface Specifications

#### Message Type Surface

```typescript
// Required in src/shared/messages.ts

// Request type (inline in RuntimeRequest union)
{
  action: "refreshMarkitdownConversionPriorityBrief";
  vaultPath: string;
  cliPath: string;
  vault: string;
  inboxFolder?: string;
  maxFiles?: number;
}

// Response type export
export type RefreshMarkitdownConversionPriorityBriefResponse =
  | { 
      success: true; 
      priorityCount: number; 
      sourceArtifactsProcessed: number; 
      highPriorityItems: number; 
      mediumPriorityItems: number; 
      lowPriorityItems: number;
      truncated: boolean; 
    }
  | { success: false; error: string };
```

#### Router Surface

```typescript
// Required in src/background/router.ts

// Import
import { handleRefreshMarkitdownConversionPriorityBrief } from "./handlers/refreshMarkitdownConversionPriorityBrief";

// Switch case
switch (request.action) {
  // ... other cases ...
  case "refreshMarkitdownConversionPriorityBrief":
    return handleRefreshMarkitdownConversionPriorityBrief(request);
  // ...
}
```

#### Handler Surface

```typescript
// Required in src/background/handlers/refreshMarkitdownConversionPriorityBrief.ts

import type { RefreshMarkitdownConversionPriorityBriefResponse } from "../../shared/messages";

interface RefreshMarkitdownConversionPriorityBriefRequest {
  action: "refreshMarkitdownConversionPriorityBrief";
  vaultPath: string;
  cliPath: string;
  vault: string;
  inboxFolder?: string;
  maxFiles?: number;
}

export async function handleRefreshMarkitdownConversionPriorityBrief(
  request: RefreshMarkitdownConversionPriorityBriefRequest
): Promise<RefreshMarkitdownConversionPriorityBriefResponse>;
```

#### Save Trigger Surface

```typescript
// Required in src/popup/save.ts

// Function definition
async function refreshMarkitdownConversionPriorityBrief(
  settings: Settings,
  vault: string
): Promise<void> {
  // Skip if CLI not configured
  // Extract vault path from settings
  // Send runtime message with action "refreshMarkitdownConversionPriorityBrief"
  // Non-blocking error handling
}

// Fire-and-forget invocation in save flow
void refreshMarkitdownConversionPriorityBrief(settings, prepared.vault);
```

---

## 4. Deterministic Rule IDs

### 4.1 Rule ID Schema

All rule IDs follow the pattern: `MCPB###_<DESCRIPTION>`

| Rule ID | Severity | Description |
|---------|----------|-------------|
| `MCPB001_MISSING_MESSAGE_TYPE` | error | Request or response type not defined in messages.ts |
| `MCPB002_MISSING_ROUTER_CASE` | error | Switch case for action not found in router.ts |
| `MCPB003_MISSING_HANDLER_FILE` | error | Handler file does not exist |
| `MCPB004_MISSING_HANDLER_EXPORT` | error | Handler function not exported from handler file |
| `MCPB005_MISSING_SAVE_TRIGGER` | error | Refresh function or invocation missing in save.ts |
| `MCPB006_HANDLER_IMPORT_MISSING` | error | Handler import missing in router.ts |
| `MCPB007_MESSAGE_TYPE_MISMATCH` | error | Request action defined but response type missing |
| `MCPB008_RESPONSE_TYPE_INCOMPLETE` | error | Response type missing required fields |
| `MCPB009_HANDLER_SIGNATURE_MISMATCH` | error | Handler signature does not match expected contract |
| `MCPB010_NO_ARTIFACT_TARGETS` | warning | No markitdown-priority-brief artifacts planned in TASKPAD |

### 4.2 Canonical Rule ID Ordering

Violations are sorted by rule ID in this canonical order:

```
MCPB001_MISSING_MESSAGE_TYPE
MCPB007_MESSAGE_TYPE_MISMATCH
MCPB008_RESPONSE_TYPE_INCOMPLETE
MCPB002_MISSING_ROUTER_CASE
MCPB006_HANDLER_IMPORT_MISSING
MCPB003_MISSING_HANDLER_FILE
MCPB004_MISSING_HANDLER_EXPORT
MCPB009_HANDLER_SIGNATURE_MISMATCH
MCPB005_MISSING_SAVE_TRIGGER
MCPB010_NO_ARTIFACT_TARGETS
```

---

## 5. Remediation Payload Schema

### 5.1 Violation Structure

```typescript
interface Violation {
  ruleId: string;           // Deterministic rule ID
  severity: "error" | "warning";
  artifactName: string;     // "markitdown-conversion-priority-brief"
  surface: "messageType" | "router" | "handler" | "saveTrigger";
  details: {
    expectedActionName?: string;
    expectedRequestType?: string;
    expectedResponseType?: string;
    filePath?: string;
    lineNumber?: number;
  };
  remediation: {
    description: string;           // Human-readable fix description
    scaffoldCommand: string;       // Shell command to generate scaffold
  };
}
```

### 5.2 Scaffold Commands

Each violation includes a scaffold command that generates a patch or file:

#### MCPB001: Message Type Scaffold

```bash
cat > src/shared/messages.ts.patch << 'EOF'
--- a/src/shared/messages.ts
+++ b/src/shared/messages.ts
@@ -XX,XX +XX,XX @@ export type RuntimeRequest =
       action: "refreshKnowledgeTrustKickoffBrief";
       // ...
     }
+  | {
+      action: "refreshMarkitdownConversionPriorityBrief";
+      vaultPath: string;
+      cliPath: string;
+      vault: string;
+      inboxFolder?: string;
+      maxFiles?: number;
+    }
   | { action: "testNativeHost" };
+
+export type RefreshMarkitdownConversionPriorityBriefResponse =
+  | { success: true; priorityCount: number; sourceArtifactsProcessed: number; highPriorityItems: number; mediumPriorityItems: number; lowPriorityItems: number; truncated: boolean; }
+  | { success: false; error: string };
EOF
patch -p1 < src/shared/messages.ts.patch
```

#### MCPB002: Router Scaffold

```bash
cat > src/background/router.ts.patch << 'EOF'
--- a/src/background/router.ts
+++ b/src/background/router.ts
@@ -XX,XX +XX,XX @@ import { handleRefreshKnowledgeTrustKickoffBrief } from "./handlers/refreshKnowl
+import { handleRefreshMarkitdownConversionPriorityBrief } from "./handlers/refreshMarkitdownConversionPriorityBrief";
 
 export async function dispatch(request: RuntimeRequest): Promise<unknown> {
   switch (request.action) {
     // ... other cases ...
     case "refreshKnowledgeTrustKickoffBrief":
       return handleRefreshKnowledgeTrustKickoffBrief(request);
+    case "refreshMarkitdownConversionPriorityBrief":
+      return handleRefreshMarkitdownConversionPriorityBrief(request);
     case "testNativeHost":
       return handleTestNativeHost(request);
EOF
patch -p1 < src/background/router.ts.patch
```

#### MCPB003: Handler Scaffold

```bash
cat > src/background/handlers/refreshMarkitdownConversionPriorityBrief.ts << 'EOF'
/**
 * Handler for refreshing the markitdown-conversion-priority-brief.md artifact.
 */

import type { RefreshMarkitdownConversionPriorityBriefResponse } from "../../shared/messages";
import { handleSaveToCli } from "./saveToCli";

interface RefreshMarkitdownConversionPriorityBriefRequest {
  action: "refreshMarkitdownConversionPriorityBrief";
  vaultPath: string;
  cliPath: string;
  vault: string;
  inboxFolder?: string;
  maxFiles?: number;
}

/**
 * Handle refreshMarkitdownConversionPriorityBrief requests.
 */
export async function handleRefreshMarkitdownConversionPriorityBrief(
  request: RefreshMarkitdownConversionPriorityBriefRequest
): Promise<RefreshMarkitdownConversionPriorityBriefResponse> {
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
    // TODO: Implement vault scanning and priority brief building logic
    // This is a placeholder implementation
    
    const inboxFilename = "markitdown-conversion-priority-brief.md";
    const inboxPath = inboxFolder
      ? `${inboxFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ")}/${inboxFilename}`
      : inboxFilename;

    // Save via CLI
    const saveResult = await handleSaveToCli({
      action: "saveToCli",
      filePath: inboxPath,
      content: "# ${inboxFilename}\n\nTODO: Implement content generation",
      vault,
      cliPath,
    });

    if (!saveResult.success) {
      return { success: false, error: saveResult.error || "Failed to save via CLI" };
    }

    return {
      success: true,
      priorityCount: 0,
      sourceArtifactsProcessed: 0,
      highPriorityItems: 0,
      mediumPriorityItems: 0,
      lowPriorityItems: 0,
      truncated: false,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Refresh failed: ${errorMsg}` };
  }
}
EOF
```

#### MCPB005: Save Trigger Scaffold

```bash
cat > src/popup/save.ts.patch << 'EOF'
--- a/src/popup/save.ts
+++ b/src/popup/save.ts
@@ -XX,XX +XX,XX @@ async function refreshKnowledgeTrustKickoffBrief(
+/**
+ * Refresh the markitdown-conversion-priority-brief after a successful save.
+ */
+async function refreshMarkitdownConversionPriorityBrief(
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
+    await runtimeSendMessage<RuntimeRequest, RefreshMarkitdownConversionPriorityBriefResponse>({
+      action: "refreshMarkitdownConversionPriorityBrief",
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
@@ -XX,XX +XX,XX @@ export async function saveToObsidian(options: SaveOptions): Promise<SaveResult> {
         void refreshKeyTakeawaysInbox(settings, prepared.vault);
         void refreshKnowledgeTriageStateSync(settings, prepared.vault);
         void refreshContradictionInbox(settings, prepared.vault);
         void refreshKnowledgeConfidenceStateSync(settings, prepared.vault);
         void refreshKnowledgeTrustKickoffBrief(settings, prepared.vault);
+        void refreshMarkitdownConversionPriorityBrief(settings, prepared.vault);
 
         return { usedClipboardFallback, usedMethod: method };
       }
EOF
patch -p1 < src/popup/save.ts.patch
```

---

## 6. Violation Ordering

### 6.1 Sorting Hierarchy

Violations are sorted deterministically using this hierarchy:

1. **Rule ID** (canonical order from §4.2)
2. **Artifact Name** (alphabetical, though typically single artifact)
3. **Surface** (messageType → router → handler → saveTrigger)

### 6.2 Surface Order

```typescript
const SURFACE_ORDER: WiringSurface[] = [
  "messageType",
  "router", 
  "handler",
  "saveTrigger"
];
```

---

## 7. Output Format

### 7.1 JSON Output Schema

```typescript
interface MarkitdownPriorityBriefParityResult {
  status: "pass" | "fail";
  inputs: {
    taskpadPath: string;
    planPath: string;
    projectRoot: string;
  };
  artifacts: ArtifactEntry[];
  summary: {
    totalArtifacts: number;
    fullyWiredArtifacts: number;
    partiallyWiredArtifacts: number;
    missingWiringArtifacts: number;
  };
  violations: Violation[];
  timestamp: string;  // ISO 8601
}
```

### 7.2 Human Output Format

```
TASKPAD MarkItDown Priority Brief Refresh Contract Parity: {PASS|FAIL}
───────────────────────────────────────────────────

Inputs:
  - taskpad: {path}
  - plan: {path}
  - project-root: {path}

Artifacts: {count}
  1. markitdown-conversion-priority-brief
     - Planned in slice: {yes|no}
     - MessageType: {✓ present|✗ missing} ({typeName})
     - Router: {✓ present|✗ missing} ({actionName})
     - Handler: {✓ present|✗ missing} ({filePath})
     - SaveTrigger: {✓ present|✗ missing} ({functionName})

Summary:
  - Total planned artifacts: {n}
  - Fully wired: {n}
  - Partially wired: {n}
  - Missing wiring: {n}

Violations: {count}
  - [{ruleId}] {artifactName} ({surface})
    Remediation: {description}
```

---

## 8. Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All artifacts fully wired (pass) |
| 1 | One or more artifacts missing required wiring (fail) |
| 2 | Input validation failure (invalid arguments, unreadable files) |

---

## 9. Integration Points

### 9.1 Package.json Script

```json
{
  "scripts": {
    "taskpad:markitdown-priority-brief-refresh-contract-parity": "bun run tools/taskpad-markitdown-priority-brief-refresh-contract-parity.ts"
  }
}
```

### 9.2 Intake Auto Verification

The gate is invoked as part of `verify:taskpad:intake:auto`:

```bash
bun run taskpad:markitdown-priority-brief-refresh-contract-parity \
  -- --taskpad "$taskpad" \
  --plan "$plan" \
  --project-root . \
  --format json
```

### 9.3 Test Integration

Tests verify:
- Pass state when all surfaces wired
- Fail state for each missing surface
- No-artifact state when not planned
- Deterministic output ordering
- Scaffold command generation

---

## 10. Related Contracts

| Contract | Purpose |
|----------|---------|
| `evidence-gap-refresh-contract-parity` | Evidence-gap artifact wiring validation |
| `knowledge-revalidation-refresh-contract-parity` | Knowledge-revalidation artifact wiring validation |
| `taskpad-intake-autoplan` | Intake orchestration that consumes parity results |

---

## 11. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-04 | Initial contract specification for TP001 |
