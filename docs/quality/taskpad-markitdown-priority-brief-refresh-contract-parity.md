# TASKPAD MarkItDown Priority Brief Refresh Contract Parity

## Purpose

Define a deterministic contract that validates planned `markitdown-conversion-priority-brief` artifacts are fully wired through save-flow runtime surfaces (`popup/save.ts`, `messages.ts`, `router.ts`, and background handlers) before release.

## Problem Statement

The `markitdown-conversion-priority-brief.md` artifact is planned as a high-impact session-start artifact for prioritizing MarkItDown conversion work, but there is no dedicated parity gate proving it is wired across save-flow runtime surfaces. Existing refresh-parity gates focus on other artifact types (evidence-gap, knowledge-revalidation) and do not explicitly guard priority-brief handler/message/router/save-trigger drift.

Without deterministic wiring validation, priority-brief refresh can silently break (missing handlers, unregistered message types, omitted router cases, absent save triggers) while intake verification still appears green. We need a focused contract gate that blocks wiring regressions before release.

## Priority Brief Artifact Target

The gate MUST validate refresh wiring parity for this planned artifact:

| Artifact | Description | Required Handler Pattern |
|----------|-------------|--------------------------|
| `markitdown-conversion-priority-brief` | Prioritizes MarkItDown conversion candidates by impact/risk | `refreshMarkitdownConversionPriorityBrief.ts` |

## Required Wiring Surfaces

For the priority-brief artifact, the gate MUST validate presence of wiring across these runtime surfaces:

### 1. Message Type Definition (`src/shared/messages.ts`)

**Required:**
- Request type with `action: "refreshMarkitdownConversionPriorityBrief"`
- Response type with success/error variants
- Proper TypeScript export

**Message Request Pattern:**
```typescript
{
  action: "refreshMarkitdownConversionPriorityBrief";
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
  priorityItemsCount: number;
  sourceArtifactsProcessed: number;
  highPriorityItems: number;
  mediumPriorityItems: number;
  lowPriorityItems: number;
  truncated: boolean;
}
| {
  success: false;
  error: string;
}
```

### 2. Router Dispatch (`src/background/router.ts`)

**Required:**
- Import statement for the handler function
- Switch case in `dispatch()` function
- Type-safe routing to handler

**Router Pattern:**
```typescript
import { handleRefreshMarkitdownConversionPriorityBrief } from "./handlers/refreshMarkitdownConversionPriorityBrief";

// In dispatch():
case "refreshMarkitdownConversionPriorityBrief":
  return handleRefreshMarkitdownConversionPriorityBrief(request);
```

### 3. Background Handler (`src/background/handlers/refreshMarkitdownConversionPriorityBrief.ts`)

**Required:**
- Handler file at `src/background/handlers/refreshMarkitdownConversionPriorityBrief.ts`
- Async handler function matching TypeScript signature
- Error handling with deterministic fallback

**Handler Pattern:**
```typescript
import type { RefreshMarkitdownConversionPriorityBriefResponse } from "../../shared/messages";

export async function handleRefreshMarkitdownConversionPriorityBrief(
  request: RefreshMarkitdownConversionPriorityBriefRequest
): Promise<RefreshMarkitdownConversionPriorityBriefResponse> {
  // Validate inputs
  // Scan vault for MarkItDown conversion candidates
  // Build priority brief from scanned artifacts
  // Save brief via CLI
  // Return metadata or error
}
```

### 4. Popup Save Trigger (`src/popup/save.ts`)

**Required:**
- Async refresh function with settings and vault parameters
- Non-blocking fire-and-forget invocation in save flow
- Proper error handling (does not block primary save)

**Refresh Function Pattern:**
```typescript
async function refreshMarkitdownConversionPriorityBrief(
  settings: Settings,
  vault: string
): Promise<void> {
  // Get vault path from settings
  // Send message to background
  // Log errors, do not block
}

// In save flow (after primary save completes):
void refreshMarkitdownConversionPriorityBrief(settings, prepared.vault);
```

## Deterministic Rule ID Taxonomy

All validation rule IDs follow the pattern `MCPBXXX_DESCRIPTION` for stable machine-readable diagnostics.

| Rule ID | Description | Severity | Condition |
|---------|-------------|----------|-----------|
| `MCPB001_MISSING_MESSAGE_TYPE` | Priority-brief refresh message type not defined in `messages.ts` | `error` | No request/response type found for `refreshMarkitdownConversionPriorityBrief` action |
| `MCPB002_MISSING_ROUTER_CASE` | Priority-brief refresh handler not routed in `router.ts` | `error` | Router switch case missing for `refreshMarkitdownConversionPriorityBrief` action |
| `MCPB003_MISSING_HANDLER_FILE` | Priority-brief refresh handler file does not exist | `error` | Handler file `src/background/handlers/refreshMarkitdownConversionPriorityBrief.ts` not found |
| `MCPB004_MISSING_HANDLER_EXPORT` | Priority-brief refresh handler not exported from file | `error` | Handler file exists but `handleRefreshMarkitdownConversionPriorityBrief` export not found |
| `MCPB005_MISSING_SAVE_TRIGGER` | Priority-brief refresh not invoked in popup save flow | `error` | No async refresh function or invocation found in `src/popup/save.ts` |
| `MCPB006_HANDLER_IMPORT_MISSING` | Handler not imported in router | `error` | Router case exists but handler import statement missing |
| `MCPB007_MESSAGE_TYPE_MISMATCH` | Message type definition does not match expected pattern | `error` | Message action name does not match handler name pattern |
| `MCPB008_RESPONSE_TYPE_INCOMPLETE` | Message response type missing required fields | `warning` | Success response missing metadata fields |
| `MCPB009_HANDLER_SIGNATURE_MISMATCH` | Handler function signature does not match message type | `error` | Handler parameters do not align with request type |
| `MCPB010_NO_ARTIFACT_TARGETS` | No priority-brief artifacts defined in plan | `warning` | Plan contains no planned priority-brief artifacts to validate |

## CLI Contract

### Command Inputs

| Argument | Required | Description |
|-----------|-----------|-------------|
| `--taskpad <path>` | ✅ | Path to TASKPAD markdown file (for parsing planned priority-brief items) |
| `--plan <path>` | ✅ | Path to IMPLEMENTATION_PLAN markdown file |
| `--project-root <path>` | ✅ | Project root directory (for resolving relative file paths) |
| `--format <format>` | ❌ | Output format: `json` or `human` (default: json) |
| `--help, -h` | ❌ | Show help message and exit |

### Exit Codes

| Exit Code | Condition |
|-----------|-----------|
| `0` | Priority-brief artifact has complete wiring across all required surfaces |
| `1` | Priority-brief artifact is missing required wiring |
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
      "artifactName": "markitdown-conversion-priority-brief",
      "plannedInSlice": true,
      "wiring": {
        "messageType": {
          "present": true,
          "requestDefined": true,
          "responseDefined": true,
          "requestType": "RefreshMarkitdownConversionPriorityBriefRequest",
          "responseType": "RefreshMarkitdownConversionPriorityBriefResponse"
        },
        "router": {
          "present": true,
          "caseExists": true,
          "handlerImported": true,
          "actionName": "refreshMarkitdownConversionPriorityBrief"
        },
        "handler": {
          "present": true,
          "fileExists": true,
          "handlerExported": true,
          "filePath": "src/background/handlers/refreshMarkitdownConversionPriorityBrief.ts",
          "handlerName": "handleRefreshMarkitdownConversionPriorityBrief"
        },
        "saveTrigger": {
          "present": true,
          "refreshFunctionExists": true,
          "invokedInSaveFlow": true,
          "functionName": "refreshMarkitdownConversionPriorityBrief"
        }
      }
    }
  ],
  "summary": {
    "totalArtifacts": 1,
    "fullyWiredArtifacts": 1,
    "partiallyWiredArtifacts": 0,
    "missingWiringArtifacts": 0
  },
  "violations": [
    {
      "ruleId": "MCPB001_MISSING_MESSAGE_TYPE",
      "severity": "error|warning",
      "artifactName": "markitdown-conversion-priority-brief",
      "surface": "messageType|router|handler|saveTrigger",
      "details": {
        "expectedActionName": "refreshMarkitdownConversionPriorityBrief",
        "expectedRequestType": "RefreshMarkitdownConversionPriorityBriefRequest",
        "expectedResponseType": "RefreshMarkitdownConversionPriorityBriefResponse",
        "filePath": "src/shared/messages.ts",
        "lineNumber": 42
      },
      "remediation": {
        "description": "Add refreshMarkitdownConversionPriorityBrief message type to src/shared/messages.ts",
        "scaffoldCommand": "cat > src/shared/messages.ts.patch << 'EOF'\ndiff --git a/src/shared/messages.ts b/src/shared/messages.ts\nindex 1234567..abcdefg 100644\n--- a/src/shared/messages.ts\n+++ b/src/shared/messages.ts\n@@ -10,6 +10,25 @@ import type { Settings } from \"./types\";\n \n /**\n  * Messages sent to the background service worker via chrome.runtime.sendMessage().\n  */\n export type RuntimeRequest =\n   | { action: \"getSettings\" }\n+  | {\n+      action: \"refreshMarkitdownConversionPriorityBrief\";\n+      vaultPath: string;\n+      cliPath: string;\n+      vault: string;\n+      inboxFolder?: string;\n+      maxFiles?: number;\n+    }\n   | { action: \"saveContent\" /* ... */ };\n\n export type RefreshMarkitdownConversionPriorityBriefResponse =\n   | {\n+      success: true;\n+      priorityItemsCount: number;\n+      sourceArtifactsProcessed: number;\n+      highPriorityItems: number;\n+      mediumPriorityItems: number;\n+      lowPriorityItems: number;\n+      truncated: boolean;\n+    }\n   | { success: false; error: string };\nEOF\n"
      }
    }
  ],
  "timestamp": "2026-03-04T14:33:18.000Z"
}
```

### Human Format

When `--format human` is specified or default, the command MUST emit:

```
TASKPAD MarkItDown Priority Brief Refresh Contract Parity: PASS
──────────────────────────────────────────────────
Inputs:
  - taskpad: /path/to/TASKPAD.md
  - plan: IMPLEMENTATION_PLAN.md
  - project-root: .

Artifacts: 1
  1. markitdown-conversion-priority-brief
     - Planned in slice: yes
     - MessageType: ✓ present
     - Router: ✓ present
     - Handler: ✓ present (src/background/handlers/refreshMarkitdownConversionPriorityBrief.ts)
     - SaveTrigger: ✓ present

Summary:
  - Total artifacts: 1
  - Fully wired: 1
  - Partially wired: 0
  - Missing wiring: 0

All priority-brief artifacts are fully wired through save-flow surfaces.
```

For failures:

```
TASKPAD MarkItDown Priority Brief Refresh Contract Parity: FAIL
──────────────────────────────────────────────────
Inputs:
  - taskpad: /path/to/TASKPAD.md
  - plan: IMPLEMENTATION_PLAN.md
  - project-root: .

Artifacts: 1
  1. markitdown-conversion-priority-brief
     - Planned in slice: yes
     - MessageType: ✗ missing
       [MCPB001_MISSING_MESSAGE_TYPE] Request/Response type not defined in src/shared/messages.ts
     - Router: ✗ missing
       [MCPB002_MISSING_ROUTER_CASE] No switch case for refreshMarkitdownConversionPriorityBrief action
     - Handler: ✗ missing
       [MCPB003_MISSING_HANDLER_FILE] File src/background/handlers/refreshMarkitdownConversionPriorityBrief.ts does not exist
     - SaveTrigger: ✗ missing
       [MCPB005_MISSING_SAVE_TRIGGER] No refresh function or invocation in src/popup/save.ts

Summary:
  - Total artifacts: 1
  - Fully wired: 0
  - Partially wired: 0
  - Missing wiring: 1

Violations: 4
  1. [MCPB001_MISSING_MESSAGE_TYPE] markitdown-conversion-priority-brief (messageType)
     Expected: refreshMarkitdownConversionPriorityBrief request/response types in src/shared/messages.ts
     Remediation: Add message type definition
     Scaffold: cat > src/shared/messages.ts.patch << 'EOF'...

  2. [MCPB002_MISSING_ROUTER_CASE] markitdown-conversion-priority-brief (router)
     Expected: switch case for "refreshMarkitdownConversionPriorityBrief" in src/background/router.ts
     Remediation: Add router dispatch case

  3. [MCPB003_MISSING_HANDLER_FILE] markitdown-conversion-priority-brief (handler)
     Expected: handler file at src/background/handlers/refreshMarkitdownConversionPriorityBrief.ts
     Remediation: Create handler file with handleRefreshMarkitdownConversionPriorityBrief export

  4. [MCPB005_MISSING_SAVE_TRIGGER] markitdown-conversion-priority-brief (saveTrigger)
     Expected: refreshMarkitdownConversionPriorityBrief function and invocation in src/popup/save.ts
     Remediation: Add refresh function and fire-and-forget invocation in save flow
```

## Artifact Discovery Rules

### Planned Artifact Extraction from Work Queue

The gate MUST parse the TASKPAD Work Queue section to discover planned priority-brief artifacts:

**Work Queue Item Pattern:**
```markdown
- [ ] Implement markitdown-conversion-priority-brief refresh wiring
- [ ] Add markitdown-conversion-priority-brief export with priority ranking
```

**Extraction Logic:**
1. Scan `## Work Queue` section in TASKPAD
2. Match items containing `markitdown-conversion-priority-brief` keyword
3. Extract artifact name from item text
4. Mark artifact as `plannedInSlice: true` when found in active slice
5. Consider artifacts not in active slice as `plannedInSlice: false` but still validate wiring

### Artifact-to-Handler Mapping

The gate MUST map priority-brief artifacts to their expected handler files using this mapping:

| Artifact Name | Expected Handler File | Expected Handler Function |
|---------------|------------------------|---------------------------|
| `markitdown-conversion-priority-brief` | `src/background/handlers/refreshMarkitdownConversionPriorityBrief.ts` | `handleRefreshMarkitdownConversionPriorityBrief` |

## Validation Rules Per Surface

### MessageType Surface Validation

**Check 1: Request Type Definition**
- Search `src/shared/messages.ts` for `RuntimeRequest` union type
- Verify action member exists with pattern `action: "refreshMarkitdownConversionPriorityBrief"`
- Verify required fields: `vaultPath`, `cliPath`, `vault`, optional `inboxFolder`, `maxFiles`

**Check 2: Response Type Definition**
- Search `src/shared/messages.ts` for `RefreshMarkitdownConversionPriorityBriefResponse` type
- Verify success variant with metadata fields: `priorityItemsCount`, `sourceArtifactsProcessed`, `highPriorityItems`, `mediumPriorityItems`, `lowPriorityItems`, `truncated`
- Verify error variant with `error: string`

**Check 3: Export Validation**
- Verify both request (via RuntimeRequest) and response types are exported

**Expected Pattern:**
```typescript
export type RuntimeRequest =
  | { action: "getSettings" }
  | { action: "refreshMarkitdownConversionPriorityBrief"; vaultPath: string; cliPath: string; vault: string; inboxFolder?: string; maxFiles?: number; }
  | { /* ... */ };

export type RefreshMarkitdownConversionPriorityBriefResponse =
  | { success: true; priorityItemsCount: number; sourceArtifactsProcessed: number; highPriorityItems: number; mediumPriorityItems: number; lowPriorityItems: number; truncated: boolean; }
  | { success: false; error: string };
```

### Router Surface Validation

**Check 1: Handler Import**
- Search `src/background/router.ts` for import statement
- Pattern: `import { handleRefreshMarkitdownConversionPriorityBrief } from "./handlers/refreshMarkitdownConversionPriorityBrief"`

**Check 2: Switch Case**
- Search `dispatch()` function switch statement
- Verify case exists: `case "refreshMarkitdownConversionPriorityBrief":`
- Verify handler invocation: `return handleRefreshMarkitdownConversionPriorityBrief(request);`

**Check 3: Type Safety**
- Verify TypeScript compiles without errors (request type matches handler signature)

**Expected Pattern:**
```typescript
import { handleRefreshMarkitdownConversionPriorityBrief } from "./handlers/refreshMarkitdownConversionPriorityBrief";

export async function dispatch(request: RuntimeRequest): Promise<unknown> {
  switch (request.action) {
    case "getSettings":
      return handleGetSettings();
    case "refreshMarkitdownConversionPriorityBrief":
      return handleRefreshMarkitdownConversionPriorityBrief(request);
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
- Verify export statement: `export async function handleRefreshMarkitdownConversionPriorityBrief`
- Verify function is async

**Check 3: Import Validation**
- Verify imports include response type from `messages.ts`
- Pattern: `import type { RefreshMarkitdownConversionPriorityBriefResponse } from "../../shared/messages"`

**Expected Pattern:**
```typescript
import type { RefreshMarkitdownConversionPriorityBriefResponse } from "../../shared/messages";

export async function handleRefreshMarkitdownConversionPriorityBrief(
  request: RefreshMarkitdownConversionPriorityBriefRequest
): Promise<RefreshMarkitdownConversionPriorityBriefResponse> {
  // Validate inputs
  // Build priority brief
  // Save via CLI
  // Return response
}
```

### SaveTrigger Surface Validation

**Check 1: Refresh Function Existence**
- Search `src/popup/save.ts` for async refresh function
- Pattern: `async function refreshMarkitdownConversionPriorityBrief(settings: Settings, vault: string): Promise<void>`

**Check 2: Message Invocation**
- Verify function sends message to background with correct action
- Pattern: `chrome.runtime.sendMessage<RuntimeRequest, RefreshMarkitdownConversionPriorityBriefResponse>({ action: "refreshMarkitdownConversionPriorityBrief", ... })`

**Check 3: Save Flow Invocation**
- Search for fire-and-forget invocation after primary save completes
- Pattern: `void refreshMarkitdownConversionPriorityBrief(settings, prepared.vault);`
- Verify invocation uses `void` prefix for non-blocking behavior

**Expected Pattern:**
```typescript
async function refreshMarkitdownConversionPriorityBrief(
  settings: Settings,
  vault: string
): Promise<void> {
  const vaultPath = /* ... */;
  const cliPath = settings.obsidianCli.cliPath;

  try {
    const response = await chrome.runtime.sendMessage<
      RuntimeRequest,
      RefreshMarkitdownConversionPriorityBriefResponse
    >({
      action: "refreshMarkitdownConversionPriorityBrief",
      vaultPath,
      cliPath,
      vault,
    });

    if (!response.success) {
      console.error("Failed to refresh priority brief:", response.error);
    }
  } catch (error) {
    console.error("Error refreshing priority brief:", error);
  }
}

// In save flow:
void refreshMarkitdownConversionPriorityBrief(settings, prepared.vault);
```

## Deterministic Validation Order

The gate MUST validate artifacts in this exact order for deterministic output:

1. **Parse CLI arguments** - Validate `--taskpad`, `--plan`, `--project-root` inputs
2. **Parse TASKPAD Work Queue** - Discover planned priority-brief artifacts
3. **Parse IMPLEMENTATION_PLAN** - Extract active slice context (for artifact planning)
4. **Validate MessageType surface** - Check message types in `messages.ts`
5. **Validate Router surface** - Check routing in `router.ts`
6. **Validate Handler surface** - Check handler file and exports
7. **Validate SaveTrigger surface** - Check save flow trigger in `save.ts`
8. **Aggregate wiring status** - Determine complete/partial/missing wiring per artifact
9. **Generate violations** - Emit rule violations for missing wiring
10. **Compute summary** - Aggregate counts for all artifacts

## Pass/Fail Conditions

### PASS Conditions

The gate MUST return `status="pass"` (exit `0`) when ALL of these are true:

- Planned priority-brief artifact has `wiring.messageType.present: true`
- Planned priority-brief artifact has `wiring.router.present: true`
- Planned priority-brief artifact has `wiring.handler.present: true`
- Planned priority-brief artifact has `wiring.saveTrigger.present: true`
- No error-level violations (warnings are allowed but do not fail the gate)

### FAIL Conditions

The gate MUST return `status="fail"` (exit `1`) when ANY of these are true:

- Priority-brief artifact is missing MessageType wiring
- Priority-brief artifact is missing Router wiring
- Priority-brief artifact is missing Handler wiring
- Priority-brief artifact is missing SaveTrigger wiring
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

**Example Scaffold Command:**
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
+      action: "refreshMarkitdownConversionPriorityBrief";
+      vaultPath: string;
+      cliPath: string;
+      vault: string;
+      inboxFolder?: string;
+      maxFiles?: number;
+    }
   | { action: "saveContent" /* ... */ };

 export type RefreshMarkitdownConversionPriorityBriefResponse =
   | {
+      success: true;
+      priorityItemsCount: number;
+      sourceArtifactsProcessed: number;
+      highPriorityItems: number;
+      mediumPriorityItems: number;
+      lowPriorityItems: number;
+      truncated: boolean;
+    }
   | { success: false; error: string };
EOF
patch -p1 < src/shared/messages.ts.patch
```

### Remediation Description

Each violation MUST include a human-readable `remediation.description` field explaining what needs to be done.

**Example:**
```
"Add refreshMarkitdownConversionPriorityBrief message type to src/shared/messages.ts with request and response type definitions following the existing inbox refresh pattern."
```

## Idempotency Guarantees

The gate MUST be idempotent for repeated runs with identical inputs:

- TASKPAD Work Queue parsing returns the same set of planned artifacts
- File path resolution produces the same absolute paths
- String matching for type definitions is deterministic
- Output JSON has stable field ordering across runs

## Assumptions

### Assumption 1: Taskpad Work Queue Contains Planned Priority-Brief Artifacts

TASKPAD Work Queue MUST contain items describing planned priority-brief artifacts for validation.

**Rationale**: Without planned artifact metadata, the gate cannot determine which artifacts require wiring validation.

### Assumption 2: Handler File Naming Follows Convention

Priority-brief refresh handlers MUST be named `refreshMarkitdownConversionPriorityBrief.ts` and export `handleRefreshMarkitdownConversionPriorityBrief`.

**Rationale**: Naming conventions enable deterministic file path inference without complex configuration.

### Assumption 3: Message Types Follow Existing Inbox Pattern

Priority-brief refresh message types MUST follow the pattern used by existing inbox/state-sync artifacts (open-questions, key-takeaways, knowledge-triage-state-sync, contradiction-inbox, evidence-gap).

**Rationale**: Consistency reduces validation complexity and ensures TypeScript type safety.

### Assumption 4: Save Flow Uses Fire-and-Forget Pattern

Priority-brief refresh invocations in save flow MUST use `void` prefix for non-blocking behavior after primary save completes.

**Rationale**: Priority-brief refresh should not block primary clip note save on failures.

### Assumption 5: TypeScript Compilation Validates Type Safety

TypeScript compilation errors in `router.ts` or handler files indicate wiring failures even if structural checks pass.

**Rationale**: Type mismatches between message types and handler signatures can cause runtime failures.

## Integration with verify:taskpad:intake:auto

The `verify:taskpad:intake:auto` command MUST compose `taskpad:markitdown-priority-brief-refresh-contract-parity` with other intake gates.

**Expected order:**
1. `taskpad:queue-health` (validate queues have unchecked work)
2. `taskpad:auto-ideation` (generate work items if queues empty)
3. `taskpad:work-queue-prune` and `taskpad:work-queue-archive-parity` (prune and validate work queue)
4. `taskpad:execution-queue-prune` and `taskpad:execution-queue-archive-parity` (prune and validate execution queue)
5. `taskpad:evidence-gap-refresh-contract-parity` (validate evidence-gap refresh wiring)
6. `taskpad:knowledge-revalidation-refresh-contract-parity` (validate knowledge-revalidation refresh wiring)
7. `taskpad:markitdown-priority-brief-refresh-contract-parity` (validate priority-brief refresh wiring)
8. `verify:taskpad:intake:full` (run full intake verification suite)

**Integration behavior:**
- Priority-brief refresh parity check runs after knowledge-revalidation parity check
- Gate failures MUST fail fast before Builder dispatch
- Missing priority-brief wiring MUST be surfaced as actionable blockers with scaffold commands

## Non-Goals

- **Implementing priority-brief artifact generation** - This gate validates wiring; artifact content generation is out of scope
- **Validating save-flow behavior** - This gate validates wiring presence, not refresh correctness
- **Validating non-priority-brief artifacts** - Only markitdown-conversion-priority-brief is in scope
- **Validating content of artifact files** - Only wiring surface presence is validated
- **Refactoring existing inbox refresh patterns** - This gate follows existing patterns, does not redesign them

## Documentation Requirements

When implementing or using this gate, maintain:

1. **Quality contract** - This document (`docs/quality/taskpad-markitdown-priority-brief-refresh-contract-parity.md`)
2. **README integration** - Usage examples and verification flow documentation in `README.md`
3. **Fixture evidence** - Test fixtures demonstrating pass/missing-handler/missing-router/missing-message/missing-save-trigger states
4. **Rule ID mapping** - Stable rule ID taxonomy in violation output

## Verification Commands

```bash
# Run markitdown priority brief refresh contract parity gate on live project
bun run taskpad:markitdown-priority-brief-refresh-contract-parity -- \
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

- [`taskpad-evidence-gap-refresh-contract-parity.md`](./taskpad-evidence-gap-refresh-contract-parity.md) - Example gate contract pattern
- [`src/shared/messages.ts`](../src/shared/messages.ts) - Message type definitions
- [`src/background/router.ts`](../src/background/router.ts) - Message routing
- [`src/popup/save.ts`](../src/popup/save.ts) - Save flow orchestration
- [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) - Active slice containing priority-brief artifact planning
