#!/usr/bin/env bun

/**
 * TP003: Evidence-Gap Refresh Contract Parity Tests
 *
 * These tests verify the `taskpad:evidence-gap-refresh-contract-parity` gate
 * works correctly for all drift states:
 * - Pass: All wiring surfaces present
 * - Missing handler: Handler file or export missing
 * - Missing router: Router case or import missing
 * - Missing message: Message type definition missing
 * - Missing save trigger: Save trigger function or invocation missing
 * - No artifacts: No evidence-gap artifacts in TASKPAD
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  analyzeEvidenceGapParity,
  RuleIds,
  parseEvidenceGapArtifacts,
  validateMessageTypeWiring,
  validateRouterWiring,
  validateHandlerWiring,
  validateSaveTriggerWiring,
  generateViolations,
  sortViolationsCanonical,
  type EvidenceGapArtifact,
  type EvidenceGapParityResult,
  type Violation,
} from "../../tools/taskpad-evidence-gap-refresh-contract-parity";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_ROOT = join(PROJECT_ROOT, "tests", "tools", "fixtures", "evidence-gap-refresh-contract-parity");
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
  describe("parseEvidenceGapArtifacts", () => {
    test("parses evidence-gap-inbox from Work Queue", () => {
      const markdown = `# TASKPAD
## Work Queue
- [ ] planned-2026-03-03 Implement evidence-gap-inbox refresh wiring
`;
      const artifacts = parseEvidenceGapArtifacts(markdown);
      expect(artifacts).toContain("evidence-gap-inbox");
      expect(artifacts).toHaveLength(1);
    });

    test("parses evidence-gap-state-sync from Work Queue", () => {
      const markdown = `# TASKPAD
## Work Queue
- [ ] planned-2026-03-03 Add evidence-gap-state-sync handler
`;
      const artifacts = parseEvidenceGapArtifacts(markdown);
      expect(artifacts).toContain("evidence-gap-state-sync");
      expect(artifacts).toHaveLength(1);
    });

    test("parses both artifacts from Work Queue", () => {
      const markdown = `# TASKPAD
## Work Queue
- [ ] planned-2026-03-03 Implement evidence-gap-inbox refresh wiring
- [ ] planned-2026-03-03 Add evidence-gap-state-sync handler
`;
      const artifacts = parseEvidenceGapArtifacts(markdown);
      expect(artifacts).toContain("evidence-gap-inbox");
      expect(artifacts).toContain("evidence-gap-state-sync");
      expect(artifacts).toHaveLength(2);
    });

    test("ignores checked items", () => {
      const markdown = `# TASKPAD
## Work Queue
- [x] planned-2026-03-03 Completed evidence-gap-inbox wiring
- [ ] planned-2026-03-03 Add evidence-gap-state-sync handler
`;
      const artifacts = parseEvidenceGapArtifacts(markdown);
      expect(artifacts).not.toContain("evidence-gap-inbox");
      expect(artifacts).toContain("evidence-gap-state-sync");
      expect(artifacts).toHaveLength(1);
    });

    test("ignores items outside Work Queue section", () => {
      const markdown = `# TASKPAD
## Other Section
- [ ] planned-2026-03-03 Implement evidence-gap-inbox refresh wiring

## Work Queue
- [ ] planned-2026-03-03 Add evidence-gap-state-sync handler
`;
      const artifacts = parseEvidenceGapArtifacts(markdown);
      expect(artifacts).not.toContain("evidence-gap-inbox");
      expect(artifacts).toContain("evidence-gap-state-sync");
      expect(artifacts).toHaveLength(1);
    });

    test("returns empty array when no evidence-gap artifacts", () => {
      const markdown = `# TASKPAD
## Work Queue
- [ ] planned-2026-03-03 Some other task
`;
      const artifacts = parseEvidenceGapArtifacts(markdown);
      expect(artifacts).toHaveLength(0);
    });
  });

  describe("validateMessageTypeWiring", () => {
    const artifact: EvidenceGapArtifact = "evidence-gap-inbox";
    const config = {
      handlerFile: "src/background/handlers/refreshEvidenceGapInbox.ts",
      handlerName: "handleRefreshEvidenceGapInbox",
      actionName: "refreshEvidenceGapInbox",
      requestType: "RefreshEvidenceGapInboxRequest",
      responseType: "RefreshEvidenceGapInboxResponse",
      refreshFunctionName: "refreshEvidenceGapInbox",
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
    const artifact: EvidenceGapArtifact = "evidence-gap-inbox";
    const config = {
      handlerFile: "src/background/handlers/refreshEvidenceGapInbox.ts",
      handlerName: "handleRefreshEvidenceGapInbox",
      actionName: "refreshEvidenceGapInbox",
      requestType: "RefreshEvidenceGapInboxRequest",
      responseType: "RefreshEvidenceGapInboxResponse",
      refreshFunctionName: "refreshEvidenceGapInbox",
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
    const artifact: EvidenceGapArtifact = "evidence-gap-inbox";
    const config = {
      handlerFile: "src/background/handlers/refreshEvidenceGapInbox.ts",
      handlerName: "handleRefreshEvidenceGapInbox",
      actionName: "refreshEvidenceGapInbox",
      requestType: "RefreshEvidenceGapInboxRequest",
      responseType: "RefreshEvidenceGapInboxResponse",
      refreshFunctionName: "refreshEvidenceGapInbox",
    };

    test("detects present handler wiring", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "egcp-handler-pass-"));
      const handlerDir = join(tempDir, "src", "background", "handlers");
      mkdirSync(handlerDir, { recursive: true });
      writeFileSync(join(handlerDir, "refreshEvidenceGapInbox.ts"), readSurfaceFile("handler-pass.ts"));

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
      const tempDir = mkdtempSync(join(tmpdir(), "egcp-handler-missing-file-"));

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
      const tempDir = mkdtempSync(join(tmpdir(), "egcp-handler-missing-export-"));
      const handlerDir = join(tempDir, "src", "background", "handlers");
      mkdirSync(handlerDir, { recursive: true });
      writeFileSync(join(handlerDir, "refreshEvidenceGapInbox.ts"), readSurfaceFile("handler-missing-export.ts"));

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
    const artifact: EvidenceGapArtifact = "evidence-gap-inbox";
    const config = {
      handlerFile: "src/background/handlers/refreshEvidenceGapInbox.ts",
      handlerName: "handleRefreshEvidenceGapInbox",
      actionName: "refreshEvidenceGapInbox",
      requestType: "RefreshEvidenceGapInboxRequest",
      responseType: "RefreshEvidenceGapInboxResponse",
      refreshFunctionName: "refreshEvidenceGapInbox",
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
  const artifact: EvidenceGapArtifact = "evidence-gap-inbox";

  test("generates violations for all missing surfaces", () => {
    const wiring = {
      messageType: { present: false, requestDefined: false, responseDefined: false },
      router: { present: false, caseExists: false, handlerImported: false },
      handler: { present: false, fileExists: false, handlerExported: false },
      saveTrigger: { present: false, refreshFunctionExists: false, invokedInSaveFlow: false },
    };

    const violations = generateViolations(artifact, wiring);
    expect(violations.length).toBeGreaterThan(0);

    // Should include EGCP001 for missing message type
    const messageViolation = violations.find(v => v.ruleId === RuleIds.EGCP001_MISSING_MESSAGE_TYPE);
    expect(messageViolation).toBeDefined();
    expect(messageViolation?.artifactName).toBe(artifact);
    expect(messageViolation?.surface).toBe("messageType");
    expect(messageViolation?.severity).toBe("error");

    // Should include EGCP002 for missing router case
    const routerViolation = violations.find(v => v.ruleId === RuleIds.EGCP002_MISSING_ROUTER_CASE);
    expect(routerViolation).toBeDefined();
    expect(routerViolation?.artifactName).toBe(artifact);
    expect(routerViolation?.surface).toBe("router");

    // Should include EGCP003 for missing handler file
    const handlerViolation = violations.find(v => v.ruleId === RuleIds.EGCP003_MISSING_HANDLER_FILE);
    expect(handlerViolation).toBeDefined();
    expect(handlerViolation?.artifactName).toBe(artifact);
    expect(handlerViolation?.surface).toBe("handler");

    // Should include EGCP005 for missing save trigger
    const saveTriggerViolation = violations.find(v => v.ruleId === RuleIds.EGCP005_MISSING_SAVE_TRIGGER);
    expect(saveTriggerViolation).toBeDefined();
    expect(saveTriggerViolation?.artifactName).toBe(artifact);
    expect(saveTriggerViolation?.surface).toBe("saveTrigger");
  });

  test("generates no violations when all wiring present", () => {
    const wiring = {
      messageType: { present: true, requestDefined: true, responseDefined: true },
      router: { present: true, caseExists: true, handlerImported: true },
      handler: { present: true, fileExists: true, handlerExported: true },
      saveTrigger: { present: true, refreshFunctionExists: true, invokedInSaveFlow: true },
    };

    const violations = generateViolations(artifact, wiring);
    expect(violations).toHaveLength(0);
  });

  test("violations include remediation with scaffold command", () => {
    const wiring = {
      messageType: { present: false, requestDefined: false, responseDefined: false },
      router: { present: true, caseExists: true, handlerImported: true },
      handler: { present: true, fileExists: true, handlerExported: true },
      saveTrigger: { present: true, refreshFunctionExists: true, invokedInSaveFlow: true },
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
        ruleId: RuleIds.EGCP003_MISSING_HANDLER_FILE,
        severity: "error",
        artifactName: "evidence-gap-inbox",
        surface: "handler",
        details: {},
        remediation: { description: "Create handler file", scaffoldCommand: "" },
      },
      {
        ruleId: RuleIds.EGCP001_MISSING_MESSAGE_TYPE,
        severity: "error",
        artifactName: "evidence-gap-inbox",
        surface: "messageType",
        details: {},
        remediation: { description: "Add message type", scaffoldCommand: "" },
      },
      {
        ruleId: RuleIds.EGCP005_MISSING_SAVE_TRIGGER,
        severity: "error",
        artifactName: "evidence-gap-inbox",
        surface: "saveTrigger",
        details: {},
        remediation: { description: "Add save trigger", scaffoldCommand: "" },
      },
    ];

    const sorted = sortViolationsCanonical(violations);

    // EGCP001 should come before EGCP003
    expect(sorted[0].ruleId).toBe(RuleIds.EGCP001_MISSING_MESSAGE_TYPE);
    // EGCP003 should come before EGCP005
    expect(sorted[1].ruleId).toBe(RuleIds.EGCP003_MISSING_HANDLER_FILE);
    expect(sorted[2].ruleId).toBe(RuleIds.EGCP005_MISSING_SAVE_TRIGGER);
  });

  test("breaks ties by artifact name", () => {
    const violations: Violation[] = [
      {
        ruleId: RuleIds.EGCP003_MISSING_HANDLER_FILE,
        severity: "error",
        artifactName: "evidence-gap-state-sync",
        surface: "handler",
        details: {},
        remediation: { description: "", scaffoldCommand: "" },
      },
      {
        ruleId: RuleIds.EGCP003_MISSING_HANDLER_FILE,
        severity: "error",
        artifactName: "evidence-gap-inbox",
        surface: "handler",
        details: {},
        remediation: { description: "", scaffoldCommand: "" },
      },
    ];

    const sorted = sortViolationsCanonical(violations);

    // evidence-gap-inbox should come before evidence-gap-state-sync alphabetically
    expect(sorted[0].artifactName).toBe("evidence-gap-inbox");
    expect(sorted[1].artifactName).toBe("evidence-gap-state-sync");
  });

  test("breaks ties by surface order", () => {
    const violations: Violation[] = [
      {
        ruleId: RuleIds.EGCP001_MISSING_MESSAGE_TYPE,
        severity: "error",
        artifactName: "evidence-gap-inbox",
        surface: "saveTrigger",
        details: {},
        remediation: { description: "", scaffoldCommand: "" },
      },
      {
        ruleId: RuleIds.EGCP001_MISSING_MESSAGE_TYPE,
        severity: "error",
        artifactName: "evidence-gap-inbox",
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

describe("TP003: Evidence-Gap Parity Gate - Drift State Tests", () => {
  describe("pass state - all wiring present", () => {
    test("gate passes when all surfaces wired correctly", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "egcp-pass-"));
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
      writeFileSync(join(handlersDir, "refreshEvidenceGapInbox.ts"), readSurfaceFile("handler-pass.ts"));
      writeFileSync(join(handlersDir, "refreshEvidenceGapStateSync.ts"), readSurfaceFile("handler-state-sync-pass.ts"));

      try {
        const result = analyzeEvidenceGapParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("pass");
        expect(result.violations).toHaveLength(0);
        expect(result.summary.totalArtifacts).toBe(2);
        expect(result.summary.fullyWiredArtifacts).toBe(2);
        expect(result.summary.missingWiringArtifacts).toBe(0);

        // Verify artifacts are correctly identified
        const inboxArtifact = result.artifacts.find(a => a.artifactName === "evidence-gap-inbox");
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
      const tempDir = mkdtempSync(join(tmpdir(), "egcp-missing-handler-"));
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
        const result = analyzeEvidenceGapParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("fail");
        expect(result.violations.length).toBeGreaterThan(0);

        // Should have handler file violations for both artifacts
        const handlerViolations = result.violations.filter(
          v => v.ruleId === RuleIds.EGCP003_MISSING_HANDLER_FILE
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
      const tempDir = mkdtempSync(join(tmpdir(), "egcp-missing-export-"));
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
      writeFileSync(join(handlersDir, "refreshEvidenceGapInbox.ts"), readSurfaceFile("handler-missing-export.ts"));
      writeFileSync(join(handlersDir, "refreshEvidenceGapStateSync.ts"), readSurfaceFile("handler-missing-export.ts"));

      try {
        const result = analyzeEvidenceGapParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("fail");

        // Should have handler export violations
        const exportViolations = result.violations.filter(
          v => v.ruleId === RuleIds.EGCP004_MISSING_HANDLER_EXPORT
        );
        expect(exportViolations.length).toBe(2);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("missing-router drift state", () => {
    test("gate fails when router case is missing", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "egcp-missing-router-"));
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
      writeFileSync(join(handlersDir, "refreshEvidenceGapInbox.ts"), readSurfaceFile("handler-pass.ts"));
      writeFileSync(join(handlersDir, "refreshEvidenceGapStateSync.ts"), readSurfaceFile("handler-pass.ts"));

      try {
        const result = analyzeEvidenceGapParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("fail");

        // Should have router case violations
        const routerViolations = result.violations.filter(
          v => v.ruleId === RuleIds.EGCP002_MISSING_ROUTER_CASE
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
      const tempDir = mkdtempSync(join(tmpdir(), "egcp-missing-message-"));
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
      writeFileSync(join(handlersDir, "refreshEvidenceGapInbox.ts"), readSurfaceFile("handler-pass.ts"));
      writeFileSync(join(handlersDir, "refreshEvidenceGapStateSync.ts"), readSurfaceFile("handler-pass.ts"));

      try {
        const result = analyzeEvidenceGapParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("fail");

        // Should have message type violations
        const messageViolations = result.violations.filter(
          v => v.ruleId === RuleIds.EGCP001_MISSING_MESSAGE_TYPE
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
      const tempDir = mkdtempSync(join(tmpdir(), "egcp-missing-save-"));
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
      writeFileSync(join(handlersDir, "refreshEvidenceGapInbox.ts"), readSurfaceFile("handler-pass.ts"));
      writeFileSync(join(handlersDir, "refreshEvidenceGapStateSync.ts"), readSurfaceFile("handler-pass.ts"));

      try {
        const result = analyzeEvidenceGapParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("fail");

        // Should have save trigger violations
        const saveViolations = result.violations.filter(
          v => v.ruleId === RuleIds.EGCP005_MISSING_SAVE_TRIGGER
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
    test("gate passes when no evidence-gap artifacts in TASKPAD", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "egcp-no-artifacts-"));
      const taskpadPath = join(tempDir, "TASKPAD.md");
      const planPath = join(tempDir, "PLAN.md");

      writeFileSync(taskpadPath, readFixtureFile("taskpad/no-artifacts.taskpad.md"));
      writeFileSync(planPath, readFixtureFile("plan/no-artifacts.plan.md"));

      try {
        const result = analyzeEvidenceGapParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("pass");
        expect(result.violations).toHaveLength(0);
        expect(result.summary.totalArtifacts).toBe(0);
        expect(result.summary.fullyWiredArtifacts).toBe(0);

        // Both artifacts should be present but not planned
        const inboxArtifact = result.artifacts.find(a => a.artifactName === "evidence-gap-inbox");
        expect(inboxArtifact?.plannedInSlice).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("multiple violations - deterministic ordering", () => {
    test("violations are sorted in canonical order", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "egcp-multi-violations-"));
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
        const result = analyzeEvidenceGapParity(taskpadPath, planPath, tempDir);

        expect(result.status).toBe("fail");
        expect(result.violations.length).toBeGreaterThan(3);

        // Violations should be in canonical order
        const ruleIds = result.violations.map(v => v.ruleId);
        const sortedRuleIds = [...ruleIds].sort();

        // EGCP001 should come before EGCP002, etc.
        const egcp001Index = ruleIds.findIndex(id => id === RuleIds.EGCP001_MISSING_MESSAGE_TYPE);
        const egcp002Index = ruleIds.findIndex(id => id === RuleIds.EGCP002_MISSING_ROUTER_CASE);
        const egcp003Index = ruleIds.findIndex(id => id === RuleIds.EGCP003_MISSING_HANDLER_FILE);
        const egcp005Index = ruleIds.findIndex(id => id === RuleIds.EGCP005_MISSING_SAVE_TRIGGER);

        expect(egcp001Index).toBeLessThan(egcp002Index);
        expect(egcp002Index).toBeLessThan(egcp003Index);
        expect(egcp003Index).toBeLessThan(egcp005Index);
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
    const tempDir = mkdtempSync(join(tmpdir(), "egcp-json-"));
    const taskpadPath = join(tempDir, "TASKPAD.md");
    const planPath = join(tempDir, "PLAN.md");

    writeFileSync(taskpadPath, readFixtureFile("taskpad/no-artifacts.taskpad.md"));
    writeFileSync(planPath, readFixtureFile("plan/no-artifacts.plan.md"));

    try {
      const result = analyzeEvidenceGapParity(taskpadPath, planPath, tempDir);

      // Should be serializable to JSON
      const json = JSON.stringify(result, null, 2);
      const parsed = JSON.parse(json) as EvidenceGapParityResult;

      expect(parsed.status).toBe(result.status);
      expect(parsed.artifacts).toEqual(result.artifacts);
      expect(parsed.violations).toEqual(result.violations);
      expect(parsed.summary).toEqual(result.summary);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("produces deterministic output across multiple runs", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "egcp-determinism-"));
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
      const result1 = analyzeEvidenceGapParity(taskpadPath, planPath, tempDir);
      const result2 = analyzeEvidenceGapParity(taskpadPath, planPath, tempDir);

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
    const tempDir = mkdtempSync(join(tmpdir(), "egcp-fields-"));
    const taskpadPath = join(tempDir, "TASKPAD.md");
    const planPath = join(tempDir, "PLAN.md");

    writeFileSync(taskpadPath, readFixtureFile("taskpad/no-artifacts.taskpad.md"));
    writeFileSync(planPath, readFixtureFile("plan/no-artifacts.plan.md"));

    try {
      const result = analyzeEvidenceGapParity(taskpadPath, planPath, tempDir);

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
  test("all rule IDs follow EGCP### pattern", () => {
    const ruleIds = Object.values(RuleIds);
    for (const ruleId of ruleIds) {
      expect(ruleId).toMatch(/^EGCP\d+_/);
    }
  });

  test("rule IDs are unique", () => {
    const ruleIds = Object.values(RuleIds);
    const uniqueIds = new Set(ruleIds);
    expect(uniqueIds.size).toBe(ruleIds.length);
  });

  test("includes all expected rule IDs", () => {
    expect(RuleIds.EGCP001_MISSING_MESSAGE_TYPE).toBe("EGCP001_MISSING_MESSAGE_TYPE");
    expect(RuleIds.EGCP002_MISSING_ROUTER_CASE).toBe("EGCP002_MISSING_ROUTER_CASE");
    expect(RuleIds.EGCP003_MISSING_HANDLER_FILE).toBe("EGCP003_MISSING_HANDLER_FILE");
    expect(RuleIds.EGCP004_MISSING_HANDLER_EXPORT).toBe("EGCP004_MISSING_HANDLER_EXPORT");
    expect(RuleIds.EGCP005_MISSING_SAVE_TRIGGER).toBe("EGCP005_MISSING_SAVE_TRIGGER");
    expect(RuleIds.EGCP006_HANDLER_IMPORT_MISSING).toBe("EGCP006_HANDLER_IMPORT_MISSING");
    expect(RuleIds.EGCP007_MESSAGE_TYPE_MISMATCH).toBe("EGCP007_MESSAGE_TYPE_MISMATCH");
    expect(RuleIds.EGCP008_RESPONSE_TYPE_INCOMPLETE).toBe("EGCP008_RESPONSE_TYPE_INCOMPLETE");
    expect(RuleIds.EGCP009_HANDLER_SIGNATURE_MISMATCH).toBe("EGCP009_HANDLER_SIGNATURE_MISMATCH");
    expect(RuleIds.EGCP010_NO_ARTIFACT_TARGETS).toBe("EGCP010_NO_ARTIFACT_TARGETS");
  });
});
