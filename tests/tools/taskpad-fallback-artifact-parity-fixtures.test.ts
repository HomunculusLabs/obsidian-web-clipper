import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ErrorCodes,
  type FallbackParityResult,
  type LifecycleState,
  type ApplyStatus,
} from "../../tools/taskpad-fallback-artifact-parity";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_DIR = join(PROJECT_ROOT, "tests/tools/fixtures/fallback-artifact-parity");

describe("taskpad:fallback-artifact-parity fixture corpus", () => {
  describe("fixture file structure", () => {
    test("all required fixture files exist", () => {
      const requiredFiles = [
        // TASKPAD files
        "taskpad/pass-applied.taskpad.md",
        "taskpad/pass-noop.taskpad.md",
        "taskpad/fail-pending.taskpad.md",
        "taskpad/fail-mismatched-sha.taskpad.md",
        "taskpad/fail-mismatched-path.taskpad.md",
        "taskpad/fail-stale.taskpad.md",
        "taskpad/multi-artifact.taskpad.md",
        
        // Plan files
        "plan/pass-applied.plan.md",
        "plan/pass-noop.plan.md",
        "plan/multi-artifact.plan.md",
        
        // Auto-ideation artifacts
        "artifacts/taskpad-auto-ideation/pass-applied.artifact.json",
        "artifacts/taskpad-auto-ideation/pass-noop.artifact.json",
        "artifacts/taskpad-auto-ideation/fail-pending.artifact.json",
        "artifacts/taskpad-auto-ideation/fail-mismatched-sha.artifact.json",
        "artifacts/taskpad-auto-ideation/fail-mismatched-path.artifact.json",
        "artifacts/taskpad-auto-ideation/fail-stale.artifact.json",
        "artifacts/taskpad-auto-ideation/multi-artifact-newest.artifact.json",
        "artifacts/taskpad-auto-ideation/multi-artifact-older.artifact.json",
        
        // Plan-seed artifacts
        "artifacts/taskpad-plan-seed/multi-artifact-newest.artifact.json",
        
        // Apply evidence files
        "artifacts/taskpad-apply-fallback/apply-fallback-pass-applied.evidence.json",
        "artifacts/taskpad-apply-fallback/apply-fallback-pass-noop.evidence.json",
        "artifacts/taskpad-apply-fallback/apply-fallback-multi-artifact-1.evidence.json",
        "artifacts/taskpad-apply-fallback/apply-fallback-multi-artifact-2.evidence.json",
        "artifacts/taskpad-apply-fallback/apply-fallback-rejected.evidence.json",
        
        // Expected output files
        "pass-applied.expected.json",
        "pass-noop.expected.json",
        "fail-pending.expected.json",
        "fail-mismatched-sha.expected.json",
        "fail-stale.expected.json",
        "multi-artifact.expected.json",
        
        // Documentation
        "FIXTURES.md",
      ];

      for (const file of requiredFiles) {
        const path = join(FIXTURES_DIR, file);
        expect(() => readFileSync(path, "utf8")).not.toThrow();
      }
    });
  });

  describe("expected output validation", () => {
    test("all expected.json files are valid", () => {
      const expectedFiles = [
        "pass-applied.expected.json",
        "pass-noop.expected.json",
        "fail-pending.expected.json",
        "fail-mismatched-sha.expected.json",
        "fail-stale.expected.json",
        "multi-artifact.expected.json",
      ];

      for (const filename of expectedFiles) {
        const path = join(FIXTURES_DIR, filename);
        const content = readFileSync(path, "utf8");
        expect(() => JSON.parse(content)).not.toThrow();
        
        const parsed = JSON.parse(content) as FallbackParityResult;
        expect(parsed).toHaveProperty("status");
        expect(["pass", "fail"]).toContain(parsed.status);
        expect(parsed).toHaveProperty("inputs");
        expect(parsed).toHaveProperty("artifacts");
        expect(parsed).toHaveProperty("summary");
        expect(parsed).toHaveProperty("violations");
        expect(parsed).toHaveProperty("timestamp");
      }
    });

    test("pass-applied scenario has correct structure", () => {
      const content = readFileSync(join(FIXTURES_DIR, "pass-applied.expected.json"), "utf8");
      const parsed = JSON.parse(content) as FallbackParityResult;
      
      expect(parsed.status).toBe("pass");
      expect(parsed.artifacts).toHaveLength(1);
      expect(parsed.artifacts[0].lifecycleState).toBe("applied");
      expect(parsed.violations).toHaveLength(0);
      expect(parsed.summary.totalArtifacts).toBe(1);
      expect(parsed.summary.resolvedArtifacts).toBe(1);
      expect(parsed.summary.pendingArtifacts).toBe(0);
      expect(parsed.summary.rejectedArtifacts).toBe(0);
    });

    test("pass-noop scenario has correct structure", () => {
      const content = readFileSync(join(FIXTURES_DIR, "pass-noop.expected.json"), "utf8");
      const parsed = JSON.parse(content) as FallbackParityResult;
      
      expect(parsed.status).toBe("pass");
      expect(parsed.artifacts).toHaveLength(1);
      expect(parsed.artifacts[0].lifecycleState).toBe("noop");
      expect(parsed.violations).toHaveLength(0);
      expect(parsed.summary.resolvedArtifacts).toBe(1);
    });

    test("fail-pending scenario has correct structure", () => {
      const content = readFileSync(join(FIXTURES_DIR, "fail-pending.expected.json"), "utf8");
      const parsed = JSON.parse(content) as FallbackParityResult;
      
      expect(parsed.status).toBe("fail");
      expect(parsed.artifacts).toHaveLength(1);
      expect(parsed.artifacts[0].lifecycleState).toBe("pending");
      expect(parsed.violations).toHaveLength(1);
      expect(parsed.violations[0].ruleId).toBe(ErrorCodes.FAP001_PENDING_ARTIFACT);
      expect(parsed.violations[0].severity).toBe("error");
      expect(parsed.summary.pendingArtifacts).toBe(1);
    });

    test("fail-mismatched-sha scenario has correct structure", () => {
      const content = readFileSync(join(FIXTURES_DIR, "fail-mismatched-sha.expected.json"), "utf8");
      const parsed = JSON.parse(content) as FallbackParityResult;
      
      expect(parsed.status).toBe("fail");
      expect(parsed.artifacts).toHaveLength(1);
      expect(parsed.artifacts[0].lifecycleState).toBe("rejected");
      expect(parsed.violations).toHaveLength(1);
      expect(parsed.violations[0].ruleId).toBe(ErrorCodes.FAP010_REJECTED_ARTIFACT);
      expect(parsed.violations[0].severity).toBe("error");
      expect(parsed.summary.rejectedArtifacts).toBe(1);
    });

    test("fail-stale scenario has correct structure", () => {
      const content = readFileSync(join(FIXTURES_DIR, "fail-stale.expected.json"), "utf8");
      const parsed = JSON.parse(content) as FallbackParityResult;
      
      // Stale is a warning, not blocking - should pass
      expect(parsed.status).toBe("pass");
      expect(parsed.artifacts).toHaveLength(1);
      expect(parsed.artifacts[0].lifecycleState).toBe("stale");
      expect(parsed.violations).toHaveLength(1);
      expect(parsed.violations[0].ruleId).toBe(ErrorCodes.FAP004_STALE_ARTIFACT);
      expect(parsed.violations[0].severity).toBe("warning");
      expect(parsed.summary.staleArtifacts).toBe(1);
    });

    test("multi-artifact scenario has correct structure", () => {
      const content = readFileSync(join(FIXTURES_DIR, "multi-artifact.expected.json"), "utf8");
      const parsed = JSON.parse(content) as FallbackParityResult;
      
      expect(parsed.status).toBe("pass");
      expect(parsed.artifacts).toHaveLength(3);
      
      // First two should be applied (newest)
      expect(parsed.artifacts[0].lifecycleState).toBe("applied");
      expect(parsed.artifacts[1].lifecycleState).toBe("applied");
      
      // Third should be stale (older)
      expect(parsed.artifacts[2].lifecycleState).toBe("stale");
      
      // One warning for stale artifact
      expect(parsed.violations).toHaveLength(1);
      expect(parsed.violations[0].ruleId).toBe(ErrorCodes.FAP004_STALE_ARTIFACT);
      expect(parsed.violations[0].severity).toBe("warning");
      
      expect(parsed.summary.totalArtifacts).toBe(3);
      expect(parsed.summary.resolvedArtifacts).toBe(2);
      expect(parsed.summary.staleArtifacts).toBe(1);
    });
  });

  describe("artifact JSON schema validation", () => {
    test("all artifact JSON files have valid schema", () => {
      const artifactFiles = [
        "artifacts/taskpad-auto-ideation/pass-applied.artifact.json",
        "artifacts/taskpad-auto-ideation/pass-noop.artifact.json",
        "artifacts/taskpad-auto-ideation/fail-pending.artifact.json",
        "artifacts/taskpad-auto-ideation/fail-mismatched-sha.artifact.json",
        "artifacts/taskpad-auto-ideation/fail-mismatched-path.artifact.json",
        "artifacts/taskpad-auto-ideation/fail-stale.artifact.json",
        "artifacts/taskpad-auto-ideation/multi-artifact-newest.artifact.json",
        "artifacts/taskpad-auto-ideation/multi-artifact-older.artifact.json",
        "artifacts/taskpad-plan-seed/multi-artifact-newest.artifact.json",
      ];

      const validKinds = [
        "taskpad-auto-ideation-fallback-patch",
        "taskpad-plan-seed-fallback-patch",
      ];

      for (const relativePath of artifactFiles) {
        const path = join(FIXTURES_DIR, relativePath);
        const content = readFileSync(path, "utf8");
        const parsed = JSON.parse(content);
        
        expect(parsed).toHaveProperty("version");
        expect(parsed.version).toBe(1);
        
        expect(parsed).toHaveProperty("kind");
        expect(validKinds).toContain(parsed.kind);
        
        expect(parsed).toHaveProperty("taskpadPath");
        expect(typeof parsed.taskpadPath).toBe("string");
        expect(parsed.taskpadPath.length).toBeGreaterThan(0);
        
        expect(parsed).toHaveProperty("taskpadSha256");
        expect(typeof parsed.taskpadSha256).toBe("string");
        expect(parsed.taskpadSha256).toMatch(/^[a-f0-9]{64}$/);
        
        expect(parsed).toHaveProperty("applyHint");
        expect(typeof parsed.applyHint).toBe("string");
        
        expect(parsed).toHaveProperty("patch");
        expect(parsed.patch).toHaveProperty("format");
        expect(parsed.patch.format).toBe("unified-diff");
      }
    });
  });

  describe("apply evidence JSON schema validation", () => {
    test("all apply evidence JSON files have valid schema", () => {
      const evidenceFiles = [
        "artifacts/taskpad-apply-fallback/apply-fallback-pass-applied.evidence.json",
        "artifacts/taskpad-apply-fallback/apply-fallback-pass-noop.evidence.json",
        "artifacts/taskpad-apply-fallback/apply-fallback-multi-artifact-1.evidence.json",
        "artifacts/taskpad-apply-fallback/apply-fallback-multi-artifact-2.evidence.json",
        "artifacts/taskpad-apply-fallback/apply-fallback-rejected.evidence.json",
      ];

      for (const relativePath of evidenceFiles) {
        const path = join(FIXTURES_DIR, relativePath);
        const content = readFileSync(path, "utf8");
        const parsed = JSON.parse(content);
        
        expect(parsed).toHaveProperty("status");
        expect(["applied", "noop", "rejected"]).toContain(parsed.status);
        
        expect(parsed).toHaveProperty("taskpadPath");
        expect(typeof parsed.taskpadPath).toBe("string");
        
        expect(parsed).toHaveProperty("artifactPath");
        expect(typeof parsed.artifactPath).toBe("string");
        
        expect(parsed).toHaveProperty("reasonCode");
        expect(parsed.reasonCode === null || typeof parsed.reasonCode === "string").toBe(true);
        
        expect(parsed).toHaveProperty("message");
        expect(typeof parsed.message).toBe("string");
        
        expect(parsed).toHaveProperty("remediationHint");
      }
    });

    test("apply evidence statuses are correct for each scenario", () => {
      const statusChecks: [string, ApplyStatus][] = [
        ["artifacts/taskpad-apply-fallback/apply-fallback-pass-applied.evidence.json", "applied"],
        ["artifacts/taskpad-apply-fallback/apply-fallback-pass-noop.evidence.json", "noop"],
        ["artifacts/taskpad-apply-fallback/apply-fallback-rejected.evidence.json", "rejected"],
      ];

      for (const [path, expectedStatus] of statusChecks) {
        const fullPath = join(FIXTURES_DIR, path);
        const content = readFileSync(fullPath, "utf8");
        const parsed = JSON.parse(content);
        expect(parsed.status).toBe(expectedStatus);
      }
    });
  });

  describe("lifecycle state coverage", () => {
    test("all lifecycle states are represented in fixtures", () => {
      const expectedOutputFiles = [
        "pass-applied.expected.json",    // state: applied
        "pass-noop.expected.json",        // state: noop
        "fail-pending.expected.json",      // state: pending
        "fail-mismatched-sha.expected.json", // state: rejected
        "fail-stale.expected.json",       // state: stale
      ];

      const statesRepresented = new Set<LifecycleState>();

      for (const filename of expectedOutputFiles) {
        const path = join(FIXTURES_DIR, filename);
        const content = readFileSync(path, "utf8");
        const parsed = JSON.parse(content) as FallbackParityResult;
        
        for (const artifact of parsed.artifacts) {
          statesRepresented.add(artifact.lifecycleState);
        }
      }

      const expectedStates: LifecycleState[] = [
        "generated",
        "pending",
        "applied",
        "noop",
        "rejected",
        "stale",
      ];

      // At minimum, pending, applied, noop, rejected, and stale should be covered
      expect(statesRepresented.has("pending")).toBe(true);
      expect(statesRepresented.has("applied")).toBe(true);
      expect(statesRepresented.has("noop")).toBe(true);
      expect(statesRepresented.has("rejected")).toBe(true);
      expect(statesRepresented.has("stale")).toBe(true);
    });
  });

  describe("deterministic ordering scenarios", () => {
    test("multi-artifact fixture demonstrates deterministic ordering", () => {
      const content = readFileSync(join(FIXTURES_DIR, "multi-artifact.expected.json"), "utf8");
      const parsed = JSON.parse(content) as FallbackParityResult;
      
      expect(parsed.artifacts).toHaveLength(3);
      
      // Verify ordering: newest (applied) artifacts first
      const appliedArtifacts = parsed.artifacts.filter(a => a.lifecycleState === "applied");
      const staleArtifacts = parsed.artifacts.filter(a => a.lifecycleState === "stale");
      
      expect(appliedArtifacts).toHaveLength(2);
      expect(staleArtifacts).toHaveLength(1);
      
      // Applied artifacts should come before stale artifacts
      const firstStaleIndex = parsed.artifacts.findIndex(a => a.lifecycleState === "stale");
      const lastAppliedIndex = parsed.artifacts.map(a => a.lifecycleState).lastIndexOf("applied");
      expect(firstStaleIndex).toBeGreaterThan(lastAppliedIndex);
    });
  });

  describe("error code coverage", () => {
    test("fixtures cover key error codes", () => {
      const errorCodesCovered = new Set<string>();
      const expectedFiles = [
        "pass-applied.expected.json",
        "pass-noop.expected.json",
        "fail-pending.expected.json",
        "fail-mismatched-sha.expected.json",
        "fail-stale.expected.json",
        "multi-artifact.expected.json",
      ];

      for (const filename of expectedFiles) {
        const path = join(FIXTURES_DIR, filename);
        const content = readFileSync(path, "utf8");
        const parsed = JSON.parse(content) as FallbackParityResult;
        
        for (const violation of parsed.violations) {
          errorCodesCovered.add(violation.ruleId);
        }
      }

      // Verify we have coverage for the key error codes
      expect(errorCodesCovered.has(ErrorCodes.FAP001_PENDING_ARTIFACT)).toBe(true);
      expect(errorCodesCovered.has(ErrorCodes.FAP004_STALE_ARTIFACT)).toBe(true);
      expect(errorCodesCovered.has(ErrorCodes.FAP010_REJECTED_ARTIFACT)).toBe(true);
    });
  });
});
