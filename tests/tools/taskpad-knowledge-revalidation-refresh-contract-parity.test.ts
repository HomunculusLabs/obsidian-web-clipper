#!/usr/bin/env bun

/**
 * TP003: Knowledge-Revalidation Refresh Contract Parity Tests
 *
 * These tests verify the `taskpad:knowledge-revalidation-refresh-contract-parity` gate
 * works correctly for all drift states:
 * - Pass: All wiring surfaces present
 * - Missing handler: Handler file or export missing
 * - Missing router: Router case or import missing
 * - Missing message: Message type definition missing
 * - Missing save trigger: Save trigger function or invocation missing
 * - No artifacts: No knowledge-revalidation artifacts in TASKPAD
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  analyzeKnowledgeRevalidationParity,
  RuleIds,
  parseKnowledgeRevalidationArtifacts,
  validateMessageTypeWiring,
  validateRouterWiring,
  validateHandlerWiring,
  validateSaveTriggerWiring,
  generateViolations,
  sortViolationsCanonical,
  type KnowledgeRevalidationArtifact,
  type KnowledgeRevalidationParityResult,
  type Violation,
} from "../../tools/taskpad-knowledge-revalidation-refresh-contract-parity";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_ROOT = join(PROJECT_ROOT, "tests", "tools", "fixtures", "knowledge-revalidation-refresh-contract-parity");
const SURFACES_ROOT = join(FIXTURES_ROOT, "surfaces");

function readFixtureFile(fileName: string): string {
  return readFileSync(join(FIXTURES_ROOT, fileName), "utf8");
}

function readSurfaceFile(fileName: string): string {
  return readFileSync(join(SURFACES_ROOT, fileName), "utf8");
}

// =============================================================================
// Unit Tests: Individual Surface Validation
// =============================================================================

describe("TP003: Surface validation functions", () => {
  describe("parseKnowledgeRevalidationArtifacts", () => {
    test("parses knowledge-revalidation-inbox from Work Queue", () => {
      const markdown = `# TASKPAD
## Work Queue
- [ ] planned-2026-03-03 Implement knowledge-revalidation-inbox refresh wiring
`;
      const artifacts = parseKnowledgeRevalidationArtifacts(markdown);
      expect(artifacts).toContain("knowledge-revalidation-inbox");
      expect(artifacts).toHaveLength(1);
    });

    test("parses knowledge-revalidation-state-sync from Work Queue", () => {
      const markdown = `# TASKPAD
## Work Queue
- [ ] planned-2026-03-03 Add knowledge-revalidation-state-sync handler
`;
      const artifacts = parseKnowledgeRevalidationArtifacts(markdown);
      expect(artifacts).toContain("knowledge-revalidation-state-sync");
      expect(artifacts).toHaveLength(1);
    });

    test("parses both artifacts from Work Queue", () => {
      const markdown = `# TASKPAD
## Work Queue
- [ ] planned-2026-03-03 Implement knowledge-revalidation-inbox refresh wiring
- [ ] planned-2026-03-03 Add knowledge-revalidation-state-sync handler
`;
      const artifacts = parseKnowledgeRevalidationArtifacts(markdown);
      expect(artifacts).toContain("knowledge-revalidation-inbox");
      expect(artifacts).toContain("knowledge-revalidation-state-sync");
      expect(artifacts).toHaveLength(2);
    });

    test("ignores checked items", () => {
      const markdown = `# TASKPAD
## Work Queue
- [x] planned-2026-03-03 Completed knowledge-revalidation-inbox wiring
- [ ] planned-2026-03-03 Add knowledge-revalidation-state-sync handler
`;
      const artifacts = parseKnowledgeRevalidationArtifacts(markdown);
      expect(artifacts).not.toContain("knowledge-revalidation-inbox");
      expect(artifacts).toContain("knowledge-revalidation-state-sync");
      expect(artifacts).toHaveLength(1);
    });

    test("ignores items outside Work Queue section", () => {
      const markdown = `# TASKPAD
## Other Section
- [ ] planned-2026-03-03 Implement knowledge-revalidation-inbox refresh wiring

## Work Queue
- [ ] planned-2026-03-03 Add knowledge-revalidation-state-sync handler
`;
      const artifacts = parseKnowledgeRevalidationArtifacts(markdown);
      expect(artifacts).not.toContain("knowledge-revalidation-inbox");
      expect(artifacts).toContain("knowledge-revalidation-state-sync");
      expect(artifacts).toHaveLength(1);
    });

    test("returns empty array when no knowledge-revalidation artifacts", () => {
      const markdown = `# TASKPAD
## Work Queue
- [ ] planned-2026-03-03 Some other task
`;
      const artifacts = parseKnowledgeRevalidationArtifacts(markdown);
      expect(artifacts).toHaveLength(0);
    });
  });

  describe("validateMessageTypeWiring", () => {
    const artifact: KnowledgeRevalidationArtifact = "knowledge-revalidation-inbox";
    const config = {
      handlerFile: "src/background/handlers/refreshKnowledgeRevalidationInbox.ts",
      handlerName: "handleRefreshKnowledgeRevalidationInbox",
      actionName: "refreshKnowledgeRevalidationInbox",
      requestType: "RefreshKnowledgeRevalidationInboxRequest",
      responseType: "RefreshKnowledgeRevalidationInboxResponse",
      refreshFunctionName: "refreshKnowledgeRevalidationInbox",
    };

    test("detects present message type wiring", () => {
      const content = readSurfaceFile("messages-pass.ts");
      const wiring = validateMessageTypeWiring(content, artifact, config);
      expect(wiring.present).toBe(true);
      expect(wiring.requestDefined).toBe(true);
      expect(wiring.responseDefined).toBe(true);
    });

    test("detects missing message type wiring", () => {
      const content = readSurfaceFile("messages-missing.ts");
      const wiring = validateMessageTypeWiring(content, artifact, config);
      expect(wiring.present).toBe(false);
      expect(wiring.requestDefined).toBe(false);
      expect(wiring.responseDefined).toBe(false);
    });
  });

  describe("validateRouterWiring", () => {
    const artifact: KnowledgeRevalidationArtifact = "knowledge-revalidation-inbox";
    const config = {
      handlerFile: "src/background/handlers/refreshKnowledgeRevalidationInbox.ts",
      handlerName: "handleRefreshKnowledgeRevalidationInbox",
      actionName: "refreshKnowledgeRevalidationInbox",
      requestType: "RefreshKnowledgeRevalidationInboxRequest",
      responseType: "RefreshKnowledgeRevalidationInboxResponse",
      refreshFunctionName: "refreshKnowledgeRevalidationInbox",
    };

    test("detects present router wiring", () => {
      const content = readSurfaceFile("router-pass.ts");
      const wiring = validateRouterWiring(content, artifact, config);
      expect(wiring.present).toBe(true);
      expect(wiring.caseExists).toBe(true);
      expect(wiring.handlerImported).toBe(true);
    });

    test("detects missing router wiring", () => {
      const content = readSurfaceFile("router-missing.ts");
      const wiring = validateRouterWiring(content, artifact, config);
      expect(wiring.present).toBe(false);
      expect(wiring.caseExists).toBe(false);
      expect(wiring.handlerImported).toBe(false);
    });
  });

  describe("validateHandlerWiring", () => {
    const artifact: KnowledgeRevalidationArtifact = "knowledge-revalidation-inbox";
    const config = {
      handlerFile: "src/background/handlers/refreshKnowledgeRevalidationInbox.ts",
      handlerName: "handleRefreshKnowledgeRevalidationInbox",
      actionName: "refreshKnowledgeRevalidationInbox",
      requestType: "RefreshKnowledgeRevalidationInboxRequest",
      responseType: "RefreshKnowledgeRevalidationInboxResponse",
      refreshFunctionName: "refreshKnowledgeRevalidationInbox",
    };

    test("detects present handler wiring", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "krcp-handler-pass-"));
      const handlerDir = join(tempDir, "src", "background", "handlers");
      mkdirSync(handlerDir, { recursive: true });
      writeFileSync(join(handlerDir, "refreshKnowledgeRevalidationInbox.ts"), readSurfaceFile("handler-pass.ts"));

      try {
        const wiring = validateHandlerWiring(tempDir, artifact, config);
        expect(wiring.present).toBe(true);
        expect(wiring.fileExists).toBe(true);
        expect(wiring.handlerExported).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("detects missing handler file", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "krcp-handler-missing-file-"));

      try {
        const wiring = validateHandlerWiring(tempDir, artifact, config);
        expect(wiring.present).toBe(false);
        expect(wiring.fileExists).toBe(false);
        expect(wiring.handlerExported).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("detects missing handler export", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "krcp-handler-missing-export-"));
      const handlerDir = join(tempDir, "src", "background", "handlers");
      mkdirSync(handlerDir, { recursive: true });
      writeFileSync(join(handlerDir, "refreshKnowledgeRevalidationInbox.ts"), readSurfaceFile("handler-missing-export.ts"));

      try {
        const wiring = validateHandlerWiring(tempDir, artifact, config);
        expect(wiring.present).toBe(false);
        expect(wiring.fileExists).toBe(true);
        expect(wiring.handlerExported).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("validateSaveTriggerWiring", () => {
    const artifact: KnowledgeRevalidationArtifact = "knowledge-revalidation-inbox";
    const config = {
      handlerFile: "src/background/handlers/refreshKnowledgeRevalidationInbox.ts",
      handlerName: "handleRefreshKnowledgeRevalidationInbox",
      actionName: "refreshKnowledgeRevalidationInbox",
      requestType: "RefreshKnowledgeRevalidationInboxRequest",
      responseType: "RefreshKnowledgeRevalidationInboxResponse",
      refreshFunctionName: "refreshKnowledgeRevalidationInbox",
    };

    test("detects present save trigger wiring", () => {
      const content = readSurfaceFile("save-pass.ts");
      const wiring = validateSaveTriggerWiring(content, artifact, config);
      expect(wiring.present).toBe(true);
      expect(wiring.refreshFunctionExists).toBe(true);
      expect(wiring.invokedInSaveFlow).toBe(true);
    });

    test("detects missing save trigger wiring", () => {
      const content = readSurfaceFile("save-missing.ts");
      const wiring = validateSaveTriggerWiring(content, artifact, config);
      expect(wiring.present).toBe(false);
      expect(wiring.refreshFunctionExists).toBe(false);
      expect(wiring.invokedInSaveFlow).toBe(false);
    });
  });
});

// =============================================================================
// Unit Tests: Violation Generation
// =============================================================================

describe("TP003: Violation generation", () => {
  const artifact: KnowledgeRevalidationArtifact = "knowledge-revalidation-inbox";

  test("generates violations for all missing surfaces", () => {
    const wiring = {
      messageType: { present: false, requestDefined: false, responseDefined: false, requestType: "RefreshKnowledgeRevalidationInboxRequest", responseType: "RefreshKnowledgeRevalidationInboxResponse" },
      router: { present: false, caseExists: false, handlerImported: false, actionName: "refreshKnowledgeRevalidationInbox" },
      handler: { present: false, fileExists: false, handlerExported: false, filePath: "src/background/handlers/refreshKnowledgeRevalidationInbox.ts", handlerName: "handleRefreshKnowledgeRevalidationInbox" },
      saveTrigger: { present: false, refreshFunctionExists: false, invokedInSaveFlow: false, functionName: "refreshKnowledgeRevalidationInbox" },
    };

    const violations = generateViolations(artifact, wiring);
    expect(violations.length).toBeGreaterThan(0);

    // Should include KRCP001 for missing message type
    const messageViolation = violations.find(v => v.ruleId === RuleIds.KRCP001_MISSING_MESSAGE_TYPE);
    expect(messageViolation).toBeDefined();
    expect(messageViolation?.artifactName).toBe(artifact);
    expect(messageViolation?.surface).toBe("messageType");
    expect(messageViolation?.severity).toBe("error");

    // Should include KRCP002 for missing router case
    const routerViolation = violations.find(v => v.ruleId === RuleIds.KRCP002_MISSING_ROUTER_CASE);
    expect(routerViolation).toBeDefined();
    expect(routerViolation?.artifactName).toBe(artifact);
    expect(routerViolation?.surface).toBe("router");

    // Should include KRCP003 for missing handler file
    const handlerViolation = violations.find(v => v.ruleId === RuleIds.KRCP003_MISSING_HANDLER_FILE);
    expect(handlerViolation).toBeDefined();
    expect(handlerViolation?.artifactName).toBe(artifact);
    expect(handlerViolation?.surface).toBe("handler");

    // Should include KRCP005 for missing save trigger
    const saveTriggerViolation = violations.find(v => v.ruleId === RuleIds.KRCP005_MISSING_SAVE_TRIGGER);
    expect(saveTriggerViolation).toBeDefined();
    expect(saveTriggerViolation?.artifactName).toBe(artifact);
    expect(saveTriggerViolation?.surface).toBe("saveTrigger");
  });

  test("generates no violations when all wiring present", () => {
    const wiring = {
      messageType: { present: true, requestDefined: true, responseDefined: true, requestType: "RefreshKnowledgeRevalidationInboxRequest", responseType: "RefreshKnowledgeRevalidationInboxResponse" },
      router: { present: true, caseExists: true, handlerImported: true, actionName: "refreshKnowledgeRevalidationInbox" },
      handler: { present: true, fileExists: true, handlerExported: true, filePath: "src/background/handlers/refreshKnowledgeRevalidationInbox.ts", handlerName: "handleRefreshKnowledgeRevalidationInbox" },
      saveTrigger: { present: true, refreshFunctionExists: true, invokedInSaveFlow: true, functionName: "refreshKnowledgeRevalidationInbox" },
    };

    const violations = generateViolations(artifact, wiring);
    expect(violations).toHaveLength(0);
  });

  test("violations include remediation with scaffold command", () => {
    const wiring = {
      messageType: { present: false, requestDefined: false, responseDefined: false, requestType: "RefreshKnowledgeRevalidationInboxRequest", responseType: "RefreshKnowledgeRevalidationInboxResponse" },
      router: { present: true, caseExists: true, handlerImported: true, actionName: "refreshKnowledgeRevalidationInbox" },
      handler: { present: true, fileExists: true, handlerExported: true, filePath: "src/background/handlers/refreshKnowledgeRevalidationInbox.ts", handlerName: "handleRefreshKnowledgeRevalidationInbox" },
      saveTrigger: { present: true, refreshFunctionExists: true, invokedInSaveFlow: true, functionName: "refreshKnowledgeRevalidationInbox" },
    };

    const violations = generateViolations(artifact, wiring);
    expect(violations.length).toBe(1);

    const violation = violations[0];
    expect(violation.remediation).toBeDefined();
    expect(violation.remediation.description).toBeTruthy();
    expect(violation.remediation.scaffoldCommand).toBeTruthy();
    expect(violation.remediation.scaffoldCommand).toContain("cat >");
  });
});

// =============================================================================
// Unit Tests: Violation Ordering
// =============================================================================

describe("TP003: Violation ordering", () => {
  test("sorts violations in canonical order by rule ID", () => {
    const violations: Violation[] = [
      {
        ruleId: RuleIds.KRCP003_MISSING_HANDLER_FILE,
        severity: "error",
        artifactName: "knowledge-revalidation-inbox",
        surface: "handler",
        details: {},
        remediation: { description: "Create handler file", scaffoldCommand: "" },
      },
      {
        ruleId: RuleIds.KRCP001_MISSING_MESSAGE_TYPE,
        severity: "error",
        artifactName: "knowledge-revalidation-inbox",
        surface: "messageType",
        details: {},
        remediation: { description: "Add message type", scaffoldCommand: "" },
      },
      {
        ruleId: RuleIds.KRCP005_MISSING_SAVE_TRIGGER,
        severity: "error",
        artifactName: "knowledge-revalidation-inbox",
        surface: "saveTrigger",
        details: {},
        remediation: { description: "Add save trigger", scaffoldCommand: "" },
      },
    ];

    const sorted = sortViolationsCanonical(violations);

    // KRCP001 should come before KRCP003
    expect(sorted[0].ruleId).toBe(RuleIds.KRCP001_MISSING_MESSAGE_TYPE);
    // KRCP003 should come before KRCP005
    expect(sorted[1].ruleId).toBe(RuleIds.KRCP003_MISSING_HANDLER_FILE);
    expect(sorted[2].ruleId).toBe(RuleIds.KRCP005_MISSING_SAVE_TRIGGER);
  });

  test("breaks ties by artifact name", () => {
    const violations: Violation[] = [
      {
        ruleId: RuleIds.KRCP003_MISSING_HANDLER_FILE,
        severity: "error",
        artifactName: "knowledge-revalidation-state-sync",
        surface: "handler",
        details: {},
        remediation: { description: "", scaffoldCommand: "" },
      },
      {
        ruleId: RuleIds.KRCP003_MISSING_HANDLER_FILE,
        severity: "error",
        artifactName: "knowledge-revalidation-inbox",
        surface: "handler",
        details: {},
        remediation: { description: "", scaffoldCommand: "" },
      },
    ];

    const sorted = sortViolationsCanonical(violations);

    // knowledge-revalidation-inbox should come before knowledge-revalidation-state-sync alphabetically
    expect(sorted[0].artifactName).toBe("knowledge-revalidation-inbox");
    expect(sorted[1].artifactName).toBe("knowledge-revalidation-state-sync");
  });

  test("breaks ties by surface order", () => {
    const violations: Violation[] = [
      {
        ruleId: RuleIds.KRCP001_MISSING_MESSAGE_TYPE,
        severity: "error",
        artifactName: "knowledge-revalidation-inbox",
        surface: "saveTrigger",
        details: {},
        remediation: { description: "", scaffoldCommand: "" },
      },
      {
        ruleId: RuleIds.KRCP001_MISSING_MESSAGE_TYPE,
        severity: "error",
        artifactName: "knowledge-revalidation-inbox",
        surface: "messageType",
        details: {},
        remediation: { description: "", scaffoldCommand: "" },
      },
    ];

    const sorted = sortViolationsCanonical(violations);

    // messageType should come before saveTrigger
    expect(sorted[0].surface).toBe("messageType");
    expect(sorted[1].surface).toBe("saveTrigger");
  });
});

// =============================================================================
// Integration Tests: Full Gate Execution
// =============================================================================

describe("TP003: Knowledge-Revalidation Parity Gate - Drift State Tests", () => {
  describe("pass state - all wiring present", () => {
    test("gate passes when all surfaces wired correctly", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "krcp-pass-"));
      const taskpadPath = join(tempDir, "TASKPAD.md");
      const planPath = join(tempDir, "PLAN.md");
      const srcDir = join(tempDir, "src");
      const sharedDir = join(srcDir, "shared");
      const backgroundDir = join(srcDir, "background");
      const handlersDir = join(backgroundDir, "handlers");
      const popupDir = join(srcDir, "popup");

      mkdirSync(sharedDir, { recursive: true });
      mkdirSync(handlersDir, { recursive: true });
      mkdirSync(popupDir, { recursive: true });

      writeFileSync(taskpadPath, readFixtureFile("taskpad/pass.taskpad.md"));
      writeFileSync(planPath, readFixtureFile("plan/pass.plan.md"));
      writeFileSync(join(sharedDir, "messages.ts"), readSurfaceFile("messages-pass.ts"));
      writeFileSync(join(backgroundDir, "router.ts"), readSurfaceFile("router-pass.ts"));
      writeFileSync(join(popupDir, "save.ts"), readSurfaceFile("save-pass.ts"));
      writeFileSync(join(handlersDir, "refreshKnowledgeRevalidationInbox.ts"), readSurfaceFile("handler-pass.ts"));
      writeFileSync(join(handlersDir, "refreshKnowledgeRevalidationStateSync.ts"), readSurfaceFile("handler-state-sync-pass.ts"));

      try {
        const result = analyzeKnowledgeRevalidationParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("pass");
        expect(result.violations).toHaveLength(0);
        expect(result.summary.totalArtifacts).toBe(2);
        expect(result.summary.fullyWiredArtifacts).toBe(2);
        expect(result.summary.missingWiringArtifacts).toBe(0);

        // Verify artifacts are correctly identified
        const inboxArtifact = result.artifacts.find(a => a.artifactName === "knowledge-revalidation-inbox");
        expect(inboxArtifact?.plannedInSlice).toBe(true);
        expect(inboxArtifact?.wiring.messageType.present).toBe(true);
        expect(inboxArtifact?.wiring.router.present).toBe(true);
        expect(inboxArtifact?.wiring.handler.present).toBe(true);
        expect(inboxArtifact?.wiring.saveTrigger.present).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("missing-handler drift state", () => {
    test("gate fails when handler file is missing", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "krcp-missing-handler-"));
      const taskpadPath = join(tempDir, "TASKPAD.md");
      const planPath = join(tempDir, "PLAN.md");
      const srcDir = join(tempDir, "src");
      const sharedDir = join(srcDir, "shared");
      const backgroundDir = join(srcDir, "background");
      const popupDir = join(srcDir, "popup");

      mkdirSync(sharedDir, { recursive: true });
      mkdirSync(backgroundDir, { recursive: true });
      mkdirSync(popupDir, { recursive: true });

      writeFileSync(taskpadPath, readFixtureFile("taskpad/missing-handler.taskpad.md"));
      writeFileSync(planPath, readFixtureFile("plan/missing-handler.plan.md"));
      writeFileSync(join(sharedDir, "messages.ts"), readSurfaceFile("messages-pass.ts"));
      writeFileSync(join(backgroundDir, "router.ts"), readSurfaceFile("router-pass.ts"));
      writeFileSync(join(popupDir, "save.ts"), readSurfaceFile("save-pass.ts"));
      // Intentionally NOT creating handler files

      try {
        const result = analyzeKnowledgeRevalidationParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("fail");
        expect(result.violations.length).toBeGreaterThan(0);

        // Should have handler file violations for both artifacts
        const handlerViolations = result.violations.filter(
          v => v.ruleId === RuleIds.KRCP003_MISSING_HANDLER_FILE
        );
        expect(handlerViolations.length).toBe(2); // One for each artifact

        // Verify violations have correct structure
        for (const violation of handlerViolations) {
          expect(violation.severity).toBe("error");
          expect(violation.surface).toBe("handler");
          expect(violation.remediation.scaffoldCommand).toContain("cat >");
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("gate fails when handler export is missing", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "krcp-missing-export-"));
      const taskpadPath = join(tempDir, "TASKPAD.md");
      const planPath = join(tempDir, "PLAN.md");
      const srcDir = join(tempDir, "src");
      const sharedDir = join(srcDir, "shared");
      const backgroundDir = join(srcDir, "background");
      const handlersDir = join(backgroundDir, "handlers");
      const popupDir = join(srcDir, "popup");

      mkdirSync(sharedDir, { recursive: true });
      mkdirSync(handlersDir, { recursive: true });
      mkdirSync(popupDir, { recursive: true });

      writeFileSync(taskpadPath, readFixtureFile("taskpad/missing-handler.taskpad.md"));
      writeFileSync(planPath, readFixtureFile("plan/missing-handler.plan.md"));
      writeFileSync(join(sharedDir, "messages.ts"), readSurfaceFile("messages-pass.ts"));
      writeFileSync(join(backgroundDir, "router.ts"), readSurfaceFile("router-pass.ts"));
      writeFileSync(join(popupDir, "save.ts"), readSurfaceFile("save-pass.ts"));
      // Create handler files but without export
      writeFileSync(join(handlersDir, "refreshKnowledgeRevalidationInbox.ts"), readSurfaceFile("handler-missing-export.ts"));
      writeFileSync(join(handlersDir, "refreshKnowledgeRevalidationStateSync.ts"), readSurfaceFile("handler-missing-export.ts"));

      try {
        const result = analyzeKnowledgeRevalidationParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("fail");

        // Should have handler export violations
        const exportViolations = result.violations.filter(
          v => v.ruleId === RuleIds.KRCP004_MISSING_HANDLER_EXPORT
        );
        expect(exportViolations.length).toBe(2);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("missing-router drift state", () => {
    test("gate fails when router case is missing", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "krcp-missing-router-"));
      const taskpadPath = join(tempDir, "TASKPAD.md");
      const planPath = join(tempDir, "PLAN.md");
      const srcDir = join(tempDir, "src");
      const sharedDir = join(srcDir, "shared");
      const backgroundDir = join(srcDir, "background");
      const handlersDir = join(backgroundDir, "handlers");
      const popupDir = join(srcDir, "popup");

      mkdirSync(sharedDir, { recursive: true });
      mkdirSync(handlersDir, { recursive: true });
      mkdirSync(popupDir, { recursive: true });

      writeFileSync(taskpadPath, readFixtureFile("taskpad/missing-router.taskpad.md"));
      writeFileSync(planPath, readFixtureFile("plan/missing-router.plan.md"));
      writeFileSync(join(sharedDir, "messages.ts"), readSurfaceFile("messages-pass.ts"));
      writeFileSync(join(backgroundDir, "router.ts"), readSurfaceFile("router-missing.ts"));
      writeFileSync(join(popupDir, "save.ts"), readSurfaceFile("save-pass.ts"));
      writeFileSync(join(handlersDir, "refreshKnowledgeRevalidationInbox.ts"), readSurfaceFile("handler-pass.ts"));
      writeFileSync(join(handlersDir, "refreshKnowledgeRevalidationStateSync.ts"), readSurfaceFile("handler-pass.ts"));

      try {
        const result = analyzeKnowledgeRevalidationParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("fail");

        // Should have router case violations
        const routerViolations = result.violations.filter(
          v => v.ruleId === RuleIds.KRCP002_MISSING_ROUTER_CASE
        );
        expect(routerViolations.length).toBe(2);

        for (const violation of routerViolations) {
          expect(violation.surface).toBe("router");
          expect(violation.remediation.description).toContain("switch case");
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("missing-message drift state", () => {
    test("gate fails when message type is missing", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "krcp-missing-message-"));
      const taskpadPath = join(tempDir, "TASKPAD.md");
      const planPath = join(tempDir, "PLAN.md");
      const srcDir = join(tempDir, "src");
      const sharedDir = join(srcDir, "shared");
      const backgroundDir = join(srcDir, "background");
      const handlersDir = join(backgroundDir, "handlers");
      const popupDir = join(srcDir, "popup");

      mkdirSync(sharedDir, { recursive: true });
      mkdirSync(handlersDir, { recursive: true });
      mkdirSync(popupDir, { recursive: true });

      writeFileSync(taskpadPath, readFixtureFile("taskpad/missing-message.taskpad.md"));
      writeFileSync(planPath, readFixtureFile("plan/missing-message.plan.md"));
      writeFileSync(join(sharedDir, "messages.ts"), readSurfaceFile("messages-missing.ts"));
      writeFileSync(join(backgroundDir, "router.ts"), readSurfaceFile("router-pass.ts"));
      writeFileSync(join(popupDir, "save.ts"), readSurfaceFile("save-pass.ts"));
      writeFileSync(join(handlersDir, "refreshKnowledgeRevalidationInbox.ts"), readSurfaceFile("handler-pass.ts"));
      writeFileSync(join(handlersDir, "refreshKnowledgeRevalidationStateSync.ts"), readSurfaceFile("handler-pass.ts"));

      try {
        const result = analyzeKnowledgeRevalidationParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("fail");

        // Should have message type violations
        const messageViolations = result.violations.filter(
          v => v.ruleId === RuleIds.KRCP001_MISSING_MESSAGE_TYPE
        );
        expect(messageViolations.length).toBe(2);

        for (const violation of messageViolations) {
          expect(violation.surface).toBe("messageType");
          expect(violation.remediation.description).toContain("messages.ts");
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("missing-save-trigger drift state", () => {
    test("gate fails when save trigger is missing", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "krcp-missing-save-"));
      const taskpadPath = join(tempDir, "TASKPAD.md");
      const planPath = join(tempDir, "PLAN.md");
      const srcDir = join(tempDir, "src");
      const sharedDir = join(srcDir, "shared");
      const backgroundDir = join(srcDir, "background");
      const handlersDir = join(backgroundDir, "handlers");
      const popupDir = join(srcDir, "popup");

      mkdirSync(sharedDir, { recursive: true });
      mkdirSync(handlersDir, { recursive: true });
      mkdirSync(popupDir, { recursive: true });

      writeFileSync(taskpadPath, readFixtureFile("taskpad/missing-save-trigger.taskpad.md"));
      writeFileSync(planPath, readFixtureFile("plan/missing-save-trigger.plan.md"));
      writeFileSync(join(sharedDir, "messages.ts"), readSurfaceFile("messages-pass.ts"));
      writeFileSync(join(backgroundDir, "router.ts"), readSurfaceFile("router-pass.ts"));
      writeFileSync(join(popupDir, "save.ts"), readSurfaceFile("save-missing.ts"));
      writeFileSync(join(handlersDir, "refreshKnowledgeRevalidationInbox.ts"), readSurfaceFile("handler-pass.ts"));
      writeFileSync(join(handlersDir, "refreshKnowledgeRevalidationStateSync.ts"), readSurfaceFile("handler-pass.ts"));

      try {
        const result = analyzeKnowledgeRevalidationParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("fail");

        // Should have save trigger violations
        const saveViolations = result.violations.filter(
          v => v.ruleId === RuleIds.KRCP005_MISSING_SAVE_TRIGGER
        );
        expect(saveViolations.length).toBe(2);

        for (const violation of saveViolations) {
          expect(violation.surface).toBe("saveTrigger");
          expect(violation.remediation.description).toContain("save.ts");
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("no-artifacts state", () => {
    test("gate passes when no knowledge-revalidation artifacts in TASKPAD", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "krcp-no-artifacts-"));
      const taskpadPath = join(tempDir, "TASKPAD.md");
      const planPath = join(tempDir, "PLAN.md");

      writeFileSync(taskpadPath, readFixtureFile("taskpad/no-artifacts.taskpad.md"));
      writeFileSync(planPath, readFixtureFile("plan/no-artifacts.plan.md"));

      try {
        const result = analyzeKnowledgeRevalidationParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("pass");
        expect(result.violations).toHaveLength(0);
        expect(result.summary.totalArtifacts).toBe(0);
        expect(result.summary.fullyWiredArtifacts).toBe(0);

        // Both artifacts should be present but not planned
        const inboxArtifact = result.artifacts.find(a => a.artifactName === "knowledge-revalidation-inbox");
        expect(inboxArtifact?.plannedInSlice).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("multiple violations - deterministic ordering", () => {
    test("violations are sorted in canonical order", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "krcp-multi-violations-"));
      const taskpadPath = join(tempDir, "TASKPAD.md");
      const planPath = join(tempDir, "PLAN.md");
      const srcDir = join(tempDir, "src");
      const sharedDir = join(srcDir, "shared");
      const backgroundDir = join(srcDir, "background");
      const popupDir = join(srcDir, "popup");

      mkdirSync(sharedDir, { recursive: true });
      mkdirSync(backgroundDir, { recursive: true });
      mkdirSync(popupDir, { recursive: true });

      writeFileSync(taskpadPath, readFixtureFile("taskpad/pass.taskpad.md"));
      writeFileSync(planPath, readFixtureFile("plan/pass.plan.md"));
      // All surfaces missing - use minimal/missing surface files
      writeFileSync(join(sharedDir, "messages.ts"), readSurfaceFile("messages-missing.ts"));
      writeFileSync(join(backgroundDir, "router.ts"), readSurfaceFile("router-missing.ts"));
      writeFileSync(join(popupDir, "save.ts"), readSurfaceFile("save-missing.ts"));
      // No handler files

      try {
        const result = analyzeKnowledgeRevalidationParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("fail");
        expect(result.violations.length).toBeGreaterThan(3);

        // Violations should be in canonical order
        const ruleIds = result.violations.map(v => v.ruleId);

        // KRCP001 should come before KRCP002, etc.
        const krcp001Index = ruleIds.findIndex(id => id === RuleIds.KRCP001_MISSING_MESSAGE_TYPE);
        const krcp002Index = ruleIds.findIndex(id => id === RuleIds.KRCP002_MISSING_ROUTER_CASE);
        const krcp003Index = ruleIds.findIndex(id => id === RuleIds.KRCP003_MISSING_HANDLER_FILE);
        const krcp005Index = ruleIds.findIndex(id => id === RuleIds.KRCP005_MISSING_SAVE_TRIGGER);

        expect(krcp001Index).toBeLessThan(krcp002Index);
        expect(krcp002Index).toBeLessThan(krcp003Index);
        expect(krcp003Index).toBeLessThan(krcp005Index);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

// =============================================================================
// Integration Tests: Output Format and Determinism
// =============================================================================

describe("TP003: Output format and determinism", () => {
  test("produces valid JSON output", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "krcp-json-"));
    const taskpadPath = join(tempDir, "TASKPAD.md");
    const planPath = join(tempDir, "PLAN.md");

    writeFileSync(taskpadPath, readFixtureFile("taskpad/no-artifacts.taskpad.md"));
    writeFileSync(planPath, readFixtureFile("plan/no-artifacts.plan.md"));

    try {
      const result = analyzeKnowledgeRevalidationParity(taskpadPath, planPath, tempDir);

      // Should be serializable to JSON
      const json = JSON.stringify(result, null, 2);
      const parsed = JSON.parse(json) as KnowledgeRevalidationParityResult;

      expect(parsed.status).toBe(result.status);
      expect(parsed.artifacts).toEqual(result.artifacts);
      expect(parsed.violations).toEqual(result.violations);
      expect(parsed.summary).toEqual(result.summary);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("produces deterministic output across multiple runs", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "krcp-determinism-"));
    const taskpadPath = join(tempDir, "TASKPAD.md");
    const planPath = join(tempDir, "PLAN.md");
    const srcDir = join(tempDir, "src");
    const sharedDir = join(srcDir, "shared");
    const backgroundDir = join(srcDir, "background");
    const popupDir = join(srcDir, "popup");

    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(backgroundDir, { recursive: true });
    mkdirSync(popupDir, { recursive: true });

    writeFileSync(taskpadPath, readFixtureFile("taskpad/pass.taskpad.md"));
    writeFileSync(planPath, readFixtureFile("plan/pass.plan.md"));
    writeFileSync(join(sharedDir, "messages.ts"), readSurfaceFile("messages-missing.ts"));
    writeFileSync(join(backgroundDir, "router.ts"), readSurfaceFile("router-missing.ts"));
    writeFileSync(join(popupDir, "save.ts"), readSurfaceFile("save-missing.ts"));

    try {
      const result1 = analyzeKnowledgeRevalidationParity(taskpadPath, planPath, tempDir);
      const result2 = analyzeKnowledgeRevalidationParity(taskpadPath, planPath, tempDir);

      // Status should match
      expect(result1.status).toBe(result2.status);

      // Violation counts should match
      expect(result1.violations.length).toBe(result2.violations.length);

      // Violation ordering should match (same rule IDs in same order)
      const ruleIds1 = result1.violations.map(v => v.ruleId);
      const ruleIds2 = result2.violations.map(v => v.ruleId);
      expect(ruleIds1).toEqual(ruleIds2);

      // Summary should match
      expect(result1.summary).toEqual(result2.summary);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("output includes all required fields", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "krcp-fields-"));
    const taskpadPath = join(tempDir, "TASKPAD.md");
    const planPath = join(tempDir, "PLAN.md");

    writeFileSync(taskpadPath, readFixtureFile("taskpad/no-artifacts.taskpad.md"));
    writeFileSync(planPath, readFixtureFile("plan/no-artifacts.plan.md"));

    try {
      const result = analyzeKnowledgeRevalidationParity(taskpadPath, planPath, tempDir);

      // Required top-level fields
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("inputs");
      expect(result).toHaveProperty("artifacts");
      expect(result).toHaveProperty("summary");
      expect(result).toHaveProperty("violations");
      expect(result).toHaveProperty("timestamp");

      // Required inputs fields
      expect(result.inputs).toHaveProperty("taskpadPath");
      expect(result.inputs).toHaveProperty("planPath");
      expect(result.inputs).toHaveProperty("projectRoot");

      // Required summary fields
      expect(result.summary).toHaveProperty("totalArtifacts");
      expect(result.summary).toHaveProperty("fullyWiredArtifacts");
      expect(result.summary).toHaveProperty("partiallyWiredArtifacts");
      expect(result.summary).toHaveProperty("missingWiringArtifacts");

      // Required artifact fields
      for (const artifact of result.artifacts) {
        expect(artifact).toHaveProperty("artifactName");
        expect(artifact).toHaveProperty("plannedInSlice");
        expect(artifact).toHaveProperty("wiring");
        expect(artifact.wiring).toHaveProperty("messageType");
        expect(artifact.wiring).toHaveProperty("router");
        expect(artifact.wiring).toHaveProperty("handler");
        expect(artifact.wiring).toHaveProperty("saveTrigger");
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Rule IDs Contract Tests
// =============================================================================

describe("TP003: Rule IDs contract", () => {
  test("all rule IDs follow KRCP### pattern", () => {
    const ruleIds = Object.values(RuleIds);
    for (const ruleId of ruleIds) {
      expect(ruleId).toMatch(/^KRCP\d+_/);
    }
  });

  test("rule IDs are unique", () => {
    const ruleIds = Object.values(RuleIds);
    const uniqueIds = new Set(ruleIds);
    expect(uniqueIds.size).toBe(ruleIds.length);
  });

  test("includes all expected rule IDs", () => {
    expect(RuleIds.KRCP001_MISSING_MESSAGE_TYPE).toBe("KRCP001_MISSING_MESSAGE_TYPE");
    expect(RuleIds.KRCP002_MISSING_ROUTER_CASE).toBe("KRCP002_MISSING_ROUTER_CASE");
    expect(RuleIds.KRCP003_MISSING_HANDLER_FILE).toBe("KRCP003_MISSING_HANDLER_FILE");
    expect(RuleIds.KRCP004_MISSING_HANDLER_EXPORT).toBe("KRCP004_MISSING_HANDLER_EXPORT");
    expect(RuleIds.KRCP005_MISSING_SAVE_TRIGGER).toBe("KRCP005_MISSING_SAVE_TRIGGER");
    expect(RuleIds.KRCP006_HANDLER_IMPORT_MISSING).toBe("KRCP006_HANDLER_IMPORT_MISSING");
    expect(RuleIds.KRCP007_MESSAGE_TYPE_MISMATCH).toBe("KRCP007_MESSAGE_TYPE_MISMATCH");
    expect(RuleIds.KRCP008_RESPONSE_TYPE_INCOMPLETE).toBe("KRCP008_RESPONSE_TYPE_INCOMPLETE");
    expect(RuleIds.KRCP009_HANDLER_SIGNATURE_MISMATCH).toBe("KRCP009_HANDLER_SIGNATURE_MISMATCH");
    expect(RuleIds.KRCP010_NO_ARTIFACT_TARGETS).toBe("KRCP010_NO_ARTIFACT_TARGETS");
  });
});
