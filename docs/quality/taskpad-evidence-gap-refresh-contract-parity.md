# TASKPAD Evidence-Gap Refresh Contract Parity

## Purpose

Define a deterministic contract that validates planned evidence-gap artifacts are fully wired through save-flow runtime surfaces (`popup/save.ts`, `messages.ts`, `router.ts`, and background handlers) before release.

## Problem Statement

Evidence-gap artifacts (`evidence-gap-inbox.md`, `evidence-gap-state-sync.md`) are central to knowledge-quality triage, but there is no deterministic gate proving each planned artifact is fully wired through save-flow runtime surfaces. Missing refresh wiring across popup/messages/router/handlers can silently ship stale or never-updated evidence-gap notes while intake verification still appears green.

We need a focused contract gate that blocks drift before release by validating required wiring presence for all planned evidence-gap artifacts.

## Evidence-Gap Artifact Targets

The gate MUST validate refresh wiring parity for these planned evidence-gap artifacts:

| Artifact | Description | Required Handler Pattern |
|----------|-------------|--------------------------|
| `evidence-gap-inbox.md` | Aggregates unresolved knowledge gaps from clips | `refreshEvidenceGapInbox.ts` |
| `evidence-gap-state-sync.md` | Reconciles gap status edits to source clips | `refreshEvidenceGapStateSync.ts` |

## Required Wiring Surfaces

For each evidence-gap artifact, the gate MUST validate presence of wiring across these runtime surfaces:

### 1. Message Type Definition (`src/shared/messages.ts`)

**Required for each artifact:**
- Request type with `action: "refresh<ArtifactName>"` (e.g., `"refreshEvidenceGapInbox"`)
- Response type with success/error variants
- Proper TypeScript export

**Message Request Pattern:**
```typescript
{
  action: "refreshEvidenceGapInbox";
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
  gapsCount: number;
  sourceClipsProcessed: number;
  openGaps: number;
  resolvedGaps: number;
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
import { handleRefreshEvidenceGapInbox } from "./handlers/refreshEvidenceGapInbox";

// In dispatch():
case "refreshEvidenceGapInbox":
  return handleRefreshEvidenceGapInbox(request);
```

### 3. Background Handler (`src/background/handlers/refreshEvidenceGap*.ts`)

**Required for each artifact:**
- Handler file at `src/background/handlers/refreshEvidenceGap<ArtifactKind>.ts`
- Async handler function matching TypeScript signature
- Error handling with deterministic fallback

**Handler Pattern:**
```typescript
import type { RefreshEvidenceGapInboxResponse } from "../../shared/messages";

export async function handleRefreshEvidenceGapInbox(
  request: RefreshEvidenceGapInboxRequest
): Promise<RefreshEvidenceGapInboxResponse> {
  // Validate inputs
  // Scan vault for evidence gaps
  // Build inbox from scanned gaps
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
async function refreshEvidenceGapInbox(
  settings: Settings,
  vault: string
): Promise<void> {
  // Get vault path from settings
  // Send message to background
  // Log errors, do not block
}

// In save flow (after primary save completes):
void refreshEvidenceGapInbox(settings, prepared.vault);
```

## Deterministic Rule ID Taxonomy

All validation rule IDs follow the pattern `EGCPXXX_DESCRIPTION` for stable machine-readable diagnostics.

| Rule ID | Description | Severity | Condition |
|---------|-------------|----------|-----------|
| `EGCP001_MISSING_MESSAGE_TYPE` | Evidence-gap refresh message type not defined in `messages.ts` | `error` | No request/response type found for `refresh<ArtifactName>` action |
| `EGCP002_MISSING_ROUTER_CASE` | Evidence-gap refresh handler not routed in `router.ts` | `error` | Router switch case missing for `refresh<ArtifactName>` action |
| `EGCP003_MISSING_HANDLER_FILE` | Evidence-gap refresh handler file does not exist | `error` | Handler file `src/background/handlers/refreshEvidenceGap*.ts` not found |
| `EGCP004_MISSING_HANDLER_EXPORT` | Evidence-gap refresh handler not exported from file | `error` | Handler file exists but `handleRefreshEvidenceGap*` export not found |
| `EGCP005_MISSING_SAVE_TRIGGER` | Evidence-gap refresh not invoked in popup save flow | `error` | No async refresh function or invocation found in `src/popup/save.ts` |
| `EGCP006_HANDLER_IMPORT_MISSING` | Handler not imported in router | `error` | Router case exists but handler import statement missing |
| `EGCP007_MESSAGE_TYPE_MISMATCH` | Message type definition does not match expected pattern | `error` | Message action name does not match handler name pattern |
| `EGCP008_RESPONSE_TYPE_INCOMPLETE` | Message response type missing required fields | `warning` | Success response missing metadata fields |
| `EGCP009_HANDLER_SIGNATURE_MISMATCH` | Handler function signature does not match message type | `error` | Handler parameters do not align with request type |
| `EGCP010_NO_ARTIFACT_TARGETS` | No evidence-gap artifacts defined in plan | `warning` | Plan contains no planned evidence-gap artifacts to validate |

## CLI Contract

### Command Inputs

| Argument | Required | Description |
|-----------|-----------|-------------|
| `--taskpad <path>` | ✅ | Path to TASKPAD markdown file (for parsing planned evidence-gap items) |
| `--plan <path>` | ✅ | Path to IMPLEMENTATION_PLAN markdown file |
| `--project-root <path>` | ✅ | Project root directory (for resolving relative file paths) |
| `--format <format>` | ❌ | Output format: `json` or `human` (default: json) |
| `--help, -h` | ❌ | Show help message and exit |

### Exit Codes

| Exit Code | Condition |
|-----------|-----------|
| `0` | All evidence-gap artifacts have complete wiring across all required surfaces |
| `1` | One or more evidence-gap artifacts are missing required wiring |
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
      "artifactName": "evidence-gap-inbox|evidence-gap-state-sync",
      "plannedInSlice": true,
      "wiring": {
        "messageType": {
          "present": true,
          "requestDefined": true,
          "responseDefined": true,
          "requestType": "RefreshEvidenceGapInboxRequest",
          "responseType": "RefreshEvidenceGapInboxResponse"
        },
        "router": {
          "present": true,
          "caseExists": true,
          "handlerImported": true,
          "actionName": "refreshEvidenceGapInbox"
        },
        "handler": {
          "present": true,
          "fileExists": true,
          "handlerExported": true,
          "filePath": "src/background/handlers/refreshEvidenceGapInbox.ts",
          "handlerName": "handleRefreshEvidenceGapInbox"
        },
        "saveTrigger": {
          "present": true,
          "refreshFunctionExists": true,
          "invokedInSaveFlow": true,
          "functionName": "refreshEvidenceGapInbox"
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
      "ruleId": "EGCP001_MISSING_MESSAGE_TYPE",
      "severity": "error|warning",
      "artifactName": "evidence-gap-inbox",
      "surface": "messageType|router|handler|saveTrigger",
      "details": {
        "expectedActionName": "refreshEvidenceGapInbox",
        "expectedRequestType": "RefreshEvidenceGapInboxRequest",
        "expectedResponseType": "RefreshEvidenceGapInboxResponse",
        "filePath": "src/shared/messages.ts",
        "lineNumber": 42
      },
      "remediation": {
        "description": "Add refreshEvidenceGapInbox message type to src/shared/messages.ts",
        "scaffoldCommand": "cat > src/shared/messages.ts.patch << 'EOF'\ndiff --git a/src/shared/messages.ts b/src/shared/messages.ts\nindex 1234567..abcdefg 100644\n--- a/src/shared/messages.ts\n+++ b/src/shared/messages.ts\n@@ -10,6 +10,25 @@ import type { Settings } from \"./types\";\n \n /**\n  * Messages sent to the background service worker via chrome.runtime.sendMessage().\n  */\n export type RuntimeRequest =\n   | { action: \"getSettings\" }\n+  | {\n+      action: \"refreshEvidenceGapInbox\";\n+      vaultPath: string;\n+      cliPath: string;\n+      vault: string;\n+      inboxFolder?: string;\n+      maxFiles?: number;\n+    }\n   | { action: \"saveContent\" /* ... */ };\n\n export type RefreshEvidenceGapInboxResponse =\n   | {\n+      success: true;\n+      gapsCount: number;\n+      sourceClipsProcessed: number;\n+      openGaps: number;\n+      resolvedGaps: number;\n+      truncated: boolean;\n+    }\n   | { success: false; error: string };\nEOF\n"
      }
    }
  ],
  "timestamp": "2026-03-03T14:33:18.000Z"
}
```

### Human Format

When `--format human` is specified or default, the command MUST emit:

```
TASKPAD Evidence-Gap Refresh Contract Parity: PASS
──────────────────────────────────────────────────
Inputs:
  - taskpad: /path/to/TASKPAD.md
  - plan: IMPLEMENTATION_PLAN.md
  - project-root: .

Artifacts: 2
  1. evidence-gap-inbox
     - Planned in slice: yes
     - MessageType: ✓ present
     - Router: ✓ present
     - Handler: ✓ present (src/background/handlers/refreshEvidenceGapInbox.ts)
     - SaveTrigger: ✓ present

  2. evidence-gap-state-sync
     - Planned in slice: yes
     - MessageType: ✓ present
     - Router: ✓ present
     - Handler: ✓ present (src/background/handlers/refreshEvidenceGapStateSync.ts)
     - SaveTrigger: ✓ present

Summary:
  - Total artifacts: 2
  - Fully wired: 2
  - Partially wired: 0
  - Missing wiring: 0

All evidence-gap artifacts are fully wired through save-flow surfaces.
```

For failures:

```
TASKPAD Evidence-Gap Refresh Contract Parity: FAIL
──────────────────────────────────────────────────
Inputs:
  - taskpad: /path/to/TASKPAD.md
  - plan: IMPLEMENTATION_PLAN.md
  - project-root: .

Artifacts: 2
  1. evidence-gap-inbox
     - Planned in slice: yes
     - MessageType: ✗ missing
       [EGCP001_MISSING_MESSAGE_TYPE] Request/Response type not defined in src/shared/messages.ts
     - Router: ✗ missing
       [EGCP002_MISSING_ROUTER_CASE] No switch case for refreshEvidenceGapInbox action
     - Handler: ✗ missing
       [EGCP003_MISSING_HANDLER_FILE] File src/background/handlers/refreshEvidenceGapInbox.ts does not exist
     - SaveTrigger: ✗ missing
       [EGCP005_MISSING_SAVE_TRIGGER] No refresh function or invocation in src/popup/save.ts

  2. evidence-gap-state-sync
     - Planned in slice: yes
     - MessageType: ✓ present
     - Router: ✓ present
     - Handler: ✓ present (src/background/handlers/refreshEvidenceGapStateSync.ts)
     - SaveTrigger: ✗ missing
       [EGCP005_MISSING_SAVE_TRIGGER] No refresh function or invocation in src/popup/save.ts

Summary:
  - Total artifacts: 2
  - Fully wired: 0
  - Partially wired: 1
  - Missing wiring: 1

Violations: 4
  1. [EGCP001_MISSING_MESSAGE_TYPE] evidence-gap-inbox (messageType)
     Expected: refreshEvidenceGapInbox request/response types in src/shared/messages.ts
     Remediation: Add message type definition
     Scaffold: cat > src/shared/messages.ts.patch << 'EOF'\ndiff --git a/src/shared/messages.ts b/src/shared/messages.ts\n...

  2. [EGCP002_MISSING_ROUTER_CASE] evidence-gap-inbox (router)
     Expected: switch case for "refreshEvidenceGapInbox" in src/background/router.ts
     Remediation: Add router dispatch case

  3. [EGCP003_MISSING_HANDLER_FILE] evidence-gap-inbox (handler)
     Expected: handler file at src/background/handlers/refreshEvidenceGapInbox.ts
     Remediation: Create handler file with handleRefreshEvidenceGapInbox export

  4. [EGCP005_MISSING_SAVE_TRIGGER] evidence-gap-inbox (saveTrigger)
     Expected: refreshEvidenceGapInbox function and invocation in src/popup/save.ts
     Remediation: Add refresh function and fire-and-forget invocation in save flow
```

## Artifact Discovery Rules

### Planned Artifact Extraction from Work Queue

The gate MUST parse the TASKPAD Work Queue section to discover planned evidence-gap artifacts:

**Work Queue Item Pattern:**
```markdown
- [ ] Add evidence-gap-inbox.md export with gap detection and linkbacks
- [ ] Wire evidence-gap-state-sync.md refresh for status reconciliation
```

**Extraction Logic:**
1. Scan `## Work Queue` section in TASKPAD
2. Match items containing `evidence-gap-inbox` or `evidence-gap-state-sync` keywords
3. Extract artifact name from item text
4. Mark artifact as `plannedInSlice: true` when found in active slice
5. Consider artifacts not in active slice as `plannedInSlice: false` but still validate wiring

### Artifact-to-Handler Mapping

The gate MUST map evidence-gap artifacts to their expected handler files using this mapping:

| Artifact Name | Expected Handler File | Expected Handler Function |
|---------------|------------------------|---------------------------|
| `evidence-gap-inbox` | `src/background/handlers/refreshEvidenceGapInbox.ts` | `handleRefreshEvidenceGapInbox` |
| `evidence-gap-state-sync` | `src/background/handlers/refreshEvidenceGapStateSync.ts` | `handleRefreshEvidenceGapStateSync` |

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
  | { action: "refreshEvidenceGapInbox"; vaultPath: string; cliPath: string; vault: string; inboxFolder?: string; maxFiles?: number; }
  | { /* ... */ };

export type RefreshEvidenceGapInboxResponse =
  | { success: true; gapsCount: number; sourceClipsProcessed: number; openGaps: number; resolvedGaps: number; truncated: boolean; }
  | { success: false; error: string };
```

### Router Surface Validation

**Check 1: Handler Import**
- Search `src/background/router.ts` for import statement
- Pattern: `import { handleRefreshEvidenceGapInbox } from "./handlers/refreshEvidenceGapInbox"`

**Check 2: Switch Case**
- Search `dispatch()` function switch statement
- Verify case exists: `case "refreshEvidenceGapInbox":`
- Verify handler invocation: `return handleRefreshEvidenceGapInbox(request);`

**Check 3: Type Safety**
- Verify TypeScript compiles without errors (request type matches handler signature)

**Expected Pattern:**
```typescript
import { handleRefreshEvidenceGapInbox } from "./handlers/refreshEvidenceGapInbox";

export async function dispatch(request: RuntimeRequest): Promise<unknown> {
  switch (request.action) {
    case "getSettings":
      return handleGetSettings();
    case "refreshEvidenceGapInbox":
      return handleRefreshEvidenceGapInbox(request);
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
- Verify export statement: `export async function handleRefreshEvidenceGapInbox`
- Verify function is async

**Check 3: Import Validation**
- Verify imports include response type from `messages.ts`
- Pattern: `import type { RefreshEvidenceGapInboxResponse } from "../../shared/messages"`

**Expected Pattern:**
```typescript
import type { RefreshEvidenceGapInboxResponse } from "../../shared/messages";

export async function handleRefreshEvidenceGapInbox(
  request: RefreshEvidenceGapInboxRequest
): Promise<RefreshEvidenceGapInboxResponse> {
  // Validate inputs
  // Build evidence gap inbox
  // Save via CLI
  // Return response
}
```

### SaveTrigger Surface Validation

**Check 1: Refresh Function Existence**
- Search `src/popup/save.ts` for async refresh function
- Pattern: `async function refreshEvidenceGapInbox(settings: Settings, vault: string): Promise<void>`

**Check 2: Message Invocation**
- Verify function sends message to background with correct action
- Pattern: `chrome.runtime.sendMessage<RuntimeRequest, RefreshEvidenceGapInboxResponse>({ action: "refreshEvidenceGapInbox", ... })`

**Check 3: Save Flow Invocation**
- Search for fire-and-forget invocation after primary save completes
- Pattern: `void refreshEvidenceGapInbox(settings, prepared.vault);`
- Verify invocation uses `void` prefix for non-blocking behavior

**Expected Pattern:**
```typescript
async function refreshEvidenceGapInbox(
  settings: Settings,
  vault: string
): Promise<void> {
  const vaultPath = /* ... */;
  const cliPath = settings.obsidianCli.cliPath;

  try {
    const response = await chrome.runtime.sendMessage<
      RuntimeRequest,
      RefreshEvidenceGapInboxResponse
    >({
      action: "refreshEvidenceGapInbox",
      vaultPath,
      cliPath,
      vault,
    });

    if (!response.success) {
      console.error("Failed to refresh evidence gap inbox:", response.error);
    }
  } catch (error) {
    console.error("Error refreshing evidence gap inbox:", error);
  }
}

// In save flow:
void refreshEvidenceGapInbox(settings, prepared.vault);
```

## Deterministic Validation Order

The gate MUST validate artifacts in this exact order for deterministic output:

1. **Parse CLI arguments** - Validate `--taskpad`, `--plan`, `--project-root` inputs
2. **Parse TASKPAD Work Queue** - Discover planned evidence-gap artifacts
3. **Parse IMPLEMENTATION_PLAN** - Extract active slice context (for artifact planning)
4. **Validate MessageType surface** - Check each artifact's message types in `messages.ts`
5. **Validate Router surface** - Check each artifact's routing in `router.ts`
6. **Validate Handler surface** - Check each artifact's handler file and exports
7. **Validate SaveTrigger surface** - Check each artifact's save flow trigger in `save.ts`
8. **Aggregate wiring status** - Determine complete/partial/missing wiring per artifact
9. **Generate violations** - Emit rule violations for missing wiring
10. **Compute summary** - Aggregate counts for all artifacts

## Pass/Fail Conditions

### PASS Conditions

The gate MUST return `status="pass"` (exit `0`) when ALL of these are true:

- All planned evidence-gap artifacts have `wiring.messageType.present: true`
- All planned evidence-gap artifacts have `wiring.router.present: true`
- All planned evidence-gap artifacts have `wiring.handler.present: true`
- All planned evidence-gap artifacts have `wiring.saveTrigger.present: true`
- No error-level violations (warnings are allowed but do not fail the gate)

### FAIL Conditions

The gate MUST return `status="fail"` (exit `1`) when ANY of these are true:

- At least one evidence-gap artifact is missing MessageType wiring
- At least one evidence-gap artifact is missing Router wiring
- At least one evidence-gap artifact is missing Handler wiring
- At least one evidence-gap artifact is missing SaveTrigger wiring
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
+      action: "refreshEvidenceGapInbox";
+      vaultPath: string;
+      cliPath: string;
+      vault: string;
+      inboxFolder?: string;
+      maxFiles?: number;
+    }
   | { action: "saveContent" /* ... */ };

 export type RefreshEvidenceGapInboxResponse =
   | {
+      success: true;
+      gapsCount: number;
+      sourceClipsProcessed: number;
+      openGaps: number;
+      resolvedGaps: number;
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
"Add refreshEvidenceGapInbox message type to src/shared/messages.ts with request and response type definitions following the existing inbox refresh pattern."
```

## Idempotency Guarantees

The gate MUST be idempotent for repeated runs with identical inputs:

- TASKPAD Work Queue parsing returns the same set of planned artifacts
- File path resolution produces the same absolute paths
- String matching for type definitions is deterministic
- Output JSON has stable field ordering across runs

## Assumptions

### Assumption 1: Taskpad Work Queue Contains Planned Evidence-Gap Artifacts

TASKPAD Work Queue MUST contain items describing planned evidence-gap artifacts for validation.

**Rationale**: Without planned artifact metadata, the gate cannot determine which artifacts require wiring validation.

### Assumption 2: Handler File Naming Follows Convention

Evidence-gap refresh handlers MUST be named `refreshEvidenceGap<ArtifactKind>.ts` and export `handleRefreshEvidenceGap<ArtifactKind>`.

**Rationale**: Naming conventions enable deterministic file path inference without complex configuration.

### Assumption 3: Message Types Follow Existing Inbox Pattern

Evidence-gap refresh message types MUST follow the pattern used by existing inbox/state-sync artifacts (open-questions, key-takeaways, knowledge-triage-state-sync, contradiction-inbox).

**Rationale**: Consistency reduces validation complexity and ensures TypeScript type safety.

### Assumption 4: Save Flow Uses Fire-and-Forget Pattern

Evidence-gap refresh invocations in save flow MUST use `void` prefix for non-blocking behavior after primary save completes.

**Rationale**: Evidence-gap refresh should not block primary clip note save on failures.

### Assumption 5: TypeScript Compilation Validates Type Safety

TypeScript compilation errors in `router.ts` or handler files indicate wiring failures even if structural checks pass.

**Rationale**: Type mismatches between message types and handler signatures can cause runtime failures.

## Integration with verify:taskpad:intake:auto

The `verify:taskpad:intake:auto` command MUST compose `taskpad:evidence-gap-refresh-contract-parity` with other intake gates.

**Expected order:**
1. `taskpad:queue-health` (validate queues have unchecked work)
2. `taskpad:planned-command-parity` (validate planned items reference executable commands)
3. `taskpad:fallback-artifact-parity` (validate fallback artifacts are resolved)
4. `taskpad:evidence-gap-refresh-contract-parity` (validate evidence-gap refresh wiring)
5. `plan:integrity` (validate IMPLEMENTATION_PLAN structure)

**Integration behavior:**
- Evidence-gap refresh parity check runs after fallback artifact parity check
- Gate failures MUST fail fast before Builder dispatch
- Missing evidence-gap wiring MUST be surfaced as actionable blockers with scaffold commands

## Non-Goals

- **Implementing evidence-gap artifact generation** - This gate validates wiring; artifact content generation is out of scope
- **Validating save-flow behavior** - This gate validates wiring presence, not refresh correctness
- **Validating non-evidence-gap artifacts** - Only evidence-gap artifacts are in scope
- **Validating content of artifact files** - Only wiring surface presence is validated
- **Refactoring existing inbox refresh patterns** - This gate follows existing patterns, does not redesign them

## Documentation Requirements

When implementing or using this gate, maintain:

1. **Quality contract** - This document (`docs/quality/taskpad-evidence-gap-refresh-contract-parity.md`)
2. **README integration** - Usage examples and verification flow documentation in `README.md`
3. **Fixture evidence** - Test fixtures demonstrating pass/missing-handler/missing-router/missing-message/missing-save-trigger states
4. **Rule ID mapping** - Stable rule ID taxonomy in violation output

## Verification Commands

```bash
# Run evidence-gap refresh contract parity gate on live project
bun run taskpad:evidence-gap-refresh-contract-parity -- \
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

- [`taskpad-fallback-artifact-parity.md`](./taskpad-fallback-artifact-parity.md) - Example gate contract pattern
- [`src/shared/messages.ts`](../src/shared/messages.ts) - Message type definitions
- [`src/background/router.ts`](../src/background/router.ts) - Message routing
- [`src/popup/save.ts`](../src/popup/save.ts) - Save flow orchestration
- [`src/background/handlers/refreshContradictionInbox.ts`](../src/background/handlers/refreshContradictionInbox.ts) - Example inbox refresh handler
- [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) - Active slice containing evidence-gap artifact planning
