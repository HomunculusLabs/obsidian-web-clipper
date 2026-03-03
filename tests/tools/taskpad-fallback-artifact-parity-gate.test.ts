#!/usr/bin/env bun

/**
 * TP005: Fallback Artifact Parity Gate Tests
 *
 * These tests verify the `taskpad:fallback-artifact-parity` gate works correctly:
 * 1. End-to-end gate execution against fixture corpus
 * 2. Integration with intake orchestration verification
 * 3. Deterministic output and idempotency
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  analyzeFallbackArtifactParity,
  ErrorCodes,
  type FallbackParityResult,
  type LifecycleState,
} from "../../tools/taskpad-fallback-artifact-parity";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_DIR = join(PROJECT_ROOT, "tests/tools/fixtures/fallback-artifact-parity");

describe("TP005: Fallback Artifact Parity Gate - End-to-End Execution", () => {
  describe("gate execution edge cases", () => {
    test("handles empty fixtures gracefully", () => {
      // Create temporary directory with minimal fixtures
      const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require("node:fs");
      const { join } = require("node:path");

      const tempDir = mkdtempSync(join(require("node:os").tmpdir(), "tp005-empty-"));
      mkdirSync(join(tempDir, "artifacts"), { recursive: true });
      writeFileSync(join(tempDir, "TASKPAD.md"), "# TASKPAD\n");
      writeFileSync(join(tempDir, "PLAN.md"), "# PLAN\n");

      try {
        const result = analyzeFallbackArtifactParity("TASKPAD.md", "PLAN.md", tempDir);

        // Should pass with no artifacts
        expect(result.status).toBe("pass");
        expect(result.artifacts).toHaveLength(0);
        expect(result.violations).toHaveLength(0);
        expect(result.summary.totalArtifacts).toBe(0);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("gracefully handles missing artifact directories", () => {
      const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
      const { join } = require("node:path");

      const tempDir = mkdtempSync(join(require("node:os").tmpdir(), "tp005-no-artifacts-"));
      writeFileSync(join(tempDir, "TASKPAD.md"), "# TASKPAD\n");
      writeFileSync(join(tempDir, "PLAN.md"), "# PLAN\n");

      try {
        const result = analyzeFallbackArtifactParity("TASKPAD.md", "PLAN.md", tempDir);

        // Should not crash, return empty artifacts
        expect(result).toBeDefined();
        expect(result).toHaveProperty("status");
        expect(result.artifacts).toHaveLength(0);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("output determinism and idempotency", () => {
    test("gate produces deterministic output across runs", () => {
      const result1 = analyzeFallbackArtifactParity(
        "taskpad/pass-applied.taskpad.md",
        "plan/pass-applied.plan.md",
        FIXTURES_DIR
      );

      const result2 = analyzeFallbackArtifactParity(
        "taskpad/pass-applied.taskpad.md",
        "plan/pass-applied.plan.md",
        FIXTURES_DIR
      );

      // Status and structure should be identical
      expect(result1.status).toBe(result2.status);
      expect(result1.artifacts.length).toBe(result2.artifacts.length);
      expect(result1.violations.length).toBe(result2.violations.length);

      // Artifact details should be identical
      for (let i = 0; i < result1.artifacts.length; i++) {
        expect(result1.artifacts[i].artifactPath).toBe(result2.artifacts[i].artifactPath);
        expect(result1.artifacts[i].lifecycleState).toBe(result2.artifacts[i].lifecycleState);
        expect(result1.artifacts[i].evidence.hashMatches).toBe(result2.artifacts[i].evidence.hashMatches);
      }

      // Summary should be identical
      expect(result1.summary).toEqual(result2.summary);
    });

    test("timestamp field is only non-deterministic element", async () => {
      const result1 = analyzeFallbackArtifactParity(
        "taskpad/pass-applied.taskpad.md",
        "plan/pass-applied.plan.md",
        FIXTURES_DIR
      );

      // Small delay to ensure timestamp would differ
      await new Promise(resolve => setTimeout(resolve, 10));

      const result2 = analyzeFallbackArtifactParity(
        "taskpad/pass-applied.taskpad.md",
        "plan/pass-applied.plan.md",
        FIXTURES_DIR
      );

      // Timestamps will differ
      expect(result1.timestamp).not.toBe(result2.timestamp);

      // But everything else should be identical
      const { timestamp: _, ...rest1 } = result1;
      const { timestamp: __, ...rest2 } = result2;
      expect(rest1).toEqual(rest2);
    });

    test("json output can be parsed and validated", () => {
      const result = analyzeFallbackArtifactParity(
        "taskpad/pass-applied.taskpad.md",
        "plan/pass-applied.plan.md",
        FIXTURES_DIR
      );

      const json = JSON.stringify(result, null, 2);
      const parsed = JSON.parse(json) as FallbackParityResult;

      // Parsed result should match original
      expect(parsed.status).toBe(result.status);
      expect(parsed.artifacts).toEqual(result.artifacts);
      expect(parsed.summary).toEqual(result.summary);
      expect(parsed.violations).toEqual(result.violations);
    });
  });

  describe("violation taxonomy structure", () => {
    test("error codes follow deterministic FAP### pattern", () => {
      // Verify all error codes follow the pattern
      const errorCodes = Object.values(ErrorCodes);
      for (const errorCode of errorCodes) {
        expect(errorCode).toMatch(/^FAP\d+_/);
      }
    });

    test("error codes are stable and enumerable", () => {
      const errorCodes = Object.values(ErrorCodes);

      // Should have the expected set of error codes
      expect(errorCodes).toContain(ErrorCodes.FAP001_PENDING_ARTIFACT);
      expect(errorCodes).toContain(ErrorCodes.FAP002_MISSING_APPLY_EVIDENCE);
      expect(errorCodes).toContain(ErrorCodes.FAP003_SHA_PATH_MISMATCH);
      expect(errorCodes).toContain(ErrorCodes.FAP004_STALE_ARTIFACT);
      expect(errorCodes).toContain(ErrorCodes.FAP010_REJECTED_ARTIFACT);

      // Error codes should be unique
      const uniqueCodes = new Set(errorCodes);
      expect(uniqueCodes.size).toBe(errorCodes.length);
    });
  });

  describe("evidence metadata structure", () => {
    test("artifact evidence has required fields", () => {
      const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require("node:fs");
      const { join } = require("node:path");

      const tempDir = mkdtempSync(join(require("node:os").tmpdir(), "tp005-evidence-"));
      mkdirSync(join(tempDir, "artifacts/taskpad-auto-ideation"), { recursive: true });
      mkdirSync(join(tempDir, "artifacts/taskpad-apply-fallback"), { recursive: true });

      // Create TASKPAD and plan
      writeFileSync(join(tempDir, "TASKPAD.md"), "# TASKPAD\n## Execution Queue\n- [x] Test\n");
      writeFileSync(join(tempDir, "PLAN.md"), "# PLAN\n");

      // Create artifact with correct .patch.json extension
      const artifact = {
        version: 1,
        kind: "taskpad-auto-ideation-fallback-patch",
        taskpadPath: join(tempDir, "TASKPAD.md"),
        taskpadSha256: "abc123",  // Simplified for test
        selectedCandidateId: "TEST001",
        selectedOutcome: {
          action: "would-insert",
          canonicalBullet: "- [x] Test",
          insertedLine: 4
        },
        patch: {
          format: "unified-diff",
          targetPath: join(tempDir, "TASKPAD.md"),
          content: "--- a/TASKPAD.md\n+++ b/TASKPAD.md\n@@ -2,6 +2,7 @@\n ## Execution Queue\n+- [x] Test\n"
        },
        applyHint: "Apply patch."
      };

      const artifactPath = join(tempDir, "artifacts/taskpad-auto-ideation/test.patch.json");
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));

      // Create apply evidence
      const evidence = {
        status: "applied",
        taskpadPath: join(tempDir, "TASKPAD.md"),
        artifactPath: artifactPath,
        reasonCode: null,
        message: "Applied",
        remediationHint: null,
        appliedAt: "2026-03-02T01:00:00.000Z"
      };

      const evidencePath = join(tempDir, "artifacts/taskpad-apply-fallback/apply-fallback-test.evidence.json");
      writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));

      try {
        const result = analyzeFallbackArtifactParity("TASKPAD.md", "PLAN.md", tempDir);

        expect(result.artifacts).toHaveLength(1);
        const artifactResult = result.artifacts[0];

        // Should have all evidence fields
        expect(artifactResult.evidence).toBeDefined();
        expect(artifactResult.evidence.artifactExists).toBe(true);
        expect(artifactResult.evidence.artifactSha256).toBeTruthy();
        expect(artifactResult.evidence.taskpadSha256).toBeTruthy();
        expect(artifactResult.evidence.hashMatches).toBe(false); // SHA mismatch due to simplified hash

        // Apply evidence should be present
        expect(artifactResult.evidence.applyEvidence).toBeDefined();
        expect(artifactResult.evidence.applyEvidence.status).toBe("applied");
        expect(artifactResult.evidence.applyEvidence.artifactPath).toBe(artifactPath);
        expect(artifactResult.evidence.applyEvidence.appliedAt).toBe("2026-03-02T01:00:00.000Z");
        expect(artifactResult.evidence.applyEvidence.reasonCode).toBeNull();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

describe("TP005: Intake Orchestration Verification - Integration Tests", () => {
  describe("gate behavior in intake verification context", () => {
    test("gate passes when no artifacts exist (no blockers)", () => {
      const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
      const { join } = require("node:path");

      const tempDir = mkdtempSync(join(require("node:os").tmpdir(), "tp005-no-blockers-"));
      writeFileSync(join(tempDir, "TASKPAD.md"), "# TASKPAD\n");
      writeFileSync(join(tempDir, "PLAN.md"), "# PLAN\n");

      try {
        const result = analyzeFallbackArtifactParity("TASKPAD.md", "PLAN.md", tempDir);

        // Gate should pass (no artifacts = no blockers)
        expect(result.status).toBe("pass");
        expect(result.summary.resolvedArtifacts).toBe(0);
        expect(result.summary.totalArtifacts).toBe(0);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("gate provides actionable violation details", () => {
      const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require("node:fs");
      const { join } = require("node:path");

      const tempDir = mkdtempSync(join(require("node:os").tmpdir(), "tp005-violation-"));
      mkdirSync(join(tempDir, "artifacts/taskpad-auto-ideation"), { recursive: true });

      // Create TASKPAD with pending artifact
      const taskpadPath = join(tempDir, "TASKPAD.md");
      writeFileSync(taskpadPath, "# TASKPAD\n");

      const artifact = {
        version: 1,
        kind: "taskpad-auto-ideation-fallback-patch",
        taskpadPath: taskpadPath,
        taskpadSha256: "abc123",  // Intentionally wrong to trigger pending
        selectedCandidateId: "TEST001",
        selectedOutcome: {
          action: "would-insert",
          canonicalBullet: "- [ ] Test",
          insertedLine: 3
        },
        patch: {
          format: "unified-diff",
          targetPath: taskpadPath,
          content: "--- a/TASKPAD.md\n+++ b/TASKPAD.md\n@@ -1,3 +1,4 @@\n # TASKPAD\n+- [ ] Test\n"
        },
        applyHint: "Apply patch."
      };

      writeFileSync(
        join(tempDir, "artifacts/taskpad-auto-ideation/test.patch.json"),
        JSON.stringify(artifact, null, 2)
      );
      writeFileSync(join(tempDir, "PLAN.md"), "# PLAN\n");

      try {
        const result = analyzeFallbackArtifactParity("TASKPAD.md", "PLAN.md", tempDir);

        // Gate should fail (pending artifact)
        expect(result.status).toBe("fail");

        // Should have actionable violation
        expect(result.violations.length).toBeGreaterThan(0);
        const violation = result.violations[0];

        // Violation should have all required fields for orchestration
        expect(violation.ruleId).toMatch(/^FAP\d+_/);
        expect(violation.severity).toBe("error" || "warning");
        expect(violation.artifactPath).toBeTruthy();
        expect(violation.artifactKind).toBeTruthy();
        expect(violation.taskpadPath).toBeTruthy();
        expect(violation.mutatorSource).toBeTruthy();
        expect(violation.remediation).toBeTruthy();
        expect(violation.remediation.length).toBeGreaterThan(0);
        expect(violation.details).toBeDefined();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("multi-gate orchestration scenarios", () => {
    test("gate can be composed with other intake verification gates", () => {
      // This test verifies the gate's output structure is suitable for composition
      const result = analyzeFallbackArtifactParity(
        "taskpad/pass-applied.taskpad.md",
        "plan/pass-applied.plan.md",
        FIXTURES_DIR
      );

      // Output should have standard fields for orchestration
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("inputs");
      expect(result).toHaveProperty("summary");
      expect(result).toHaveProperty("violations");
      expect(result).toHaveProperty("timestamp");

      // Status should be enum-like for easy composition
      expect(["pass", "fail"]).toContain(result.status);

      // Summary should provide telemetry for orchestration
      expect(result.summary).toHaveProperty("totalArtifacts");
      expect(result.summary).toHaveProperty("resolvedArtifacts");
      expect(result.summary).toHaveProperty("pendingArtifacts");
      expect(result.summary).toHaveProperty("rejectedArtifacts");
      expect(result.summary).toHaveProperty("staleArtifacts");
    });

    test("summary statistics support orchestration decision making", () => {
      const result = analyzeFallbackArtifactParity(
        "taskpad/multi-artifact.taskpad.md",
        "plan/multi-artifact.plan.md",
        FIXTURES_DIR
      );

      // Summary should provide complete picture for orchestration
      const { summary } = result;

      // Total should equal sum of individual states
      expect(summary.totalArtifacts).toBe(
        summary.resolvedArtifacts +
        summary.pendingArtifacts +
        summary.rejectedArtifacts +
        summary.staleArtifacts
      );

      // Violation count should match error count in summary
      const errorViolations = result.violations.filter(v => v.severity === "error");
      const warningViolations = result.violations.filter(v => v.severity === "warning");
      expect(errorViolations.length).toBe(summary.pendingArtifacts + summary.rejectedArtifacts);
      expect(warningViolations.length).toBe(summary.staleArtifacts);
    });
  });

  describe("gate as pre-dispatch contract", () => {
    test("gate provides deterministic contract for Builder dispatch", () => {
      const result = analyzeFallbackArtifactParity(
        "taskpad/pass-applied.taskpad.md",
        "plan/pass-applied.plan.md",
        FIXTURES_DIR
      );

      // Output should be parseable and contractually stable
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json) as FallbackParityResult;

      // Required contract fields should exist
      expect(parsed).toHaveProperty("status");
      expect(parsed).toHaveProperty("artifacts");
      expect(parsed).toHaveProperty("summary");
      expect(parsed).toHaveProperty("violations");

      // All artifacts should have required fields
      for (const artifact of parsed.artifacts) {
        expect(artifact).toHaveProperty("artifactPath");
        expect(artifact).toHaveProperty("artifactKind");
        expect(artifact).toHaveProperty("taskpadPath");
        expect(artifact).toHaveProperty("mutatorSource");
        expect(artifact).toHaveProperty("lifecycleState");
        expect(artifact).toHaveProperty("evidence");
      }

      // All violations should have required fields
      for (const violation of parsed.violations) {
        expect(violation).toHaveProperty("ruleId");
        expect(violation).toHaveProperty("severity");
        expect(violation).toHaveProperty("artifactPath");
        expect(violation).toHaveProperty("remediation");
        expect(violation).toHaveProperty("details");
      }
    });

    test("gate output supports programmatic consumption", () => {
      const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require("node:fs");
      const { join } = require("node:path");

      const tempDir = mkdtempSync(join(require("node:os").tmpdir(), "tp005-programmatic-"));
      mkdirSync(join(tempDir, "artifacts/taskpad-auto-ideation"), { recursive: true });

      // Create TASKPAD with pending artifact
      const taskpadPath = join(tempDir, "TASKPAD.md");
      writeFileSync(taskpadPath, "# TASKPAD\n");

      const artifact = {
        version: 1,
        kind: "taskpad-auto-ideation-fallback-patch",
        taskpadPath: taskpadPath,
        taskpadSha256: "abc123",  // Wrong SHA to trigger pending
        selectedCandidateId: "TEST001",
        selectedOutcome: {
          action: "would-insert",
          canonicalBullet: "- [ ] Test",
          insertedLine: 3
        },
        patch: {
          format: "unified-diff",
          targetPath: taskpadPath,
          content: "--- a/TASKPAD.md\n+++ b/TASKPAD.md\n@@ -1,3 +1,4 @@\n # TASKPAD\n+- [ ] Test\n"
        },
        applyHint: "Apply patch."
      };

      writeFileSync(
        join(tempDir, "artifacts/taskpad-auto-ideation/test.patch.json"),
        JSON.stringify(artifact, null, 2)
      );
      writeFileSync(join(tempDir, "PLAN.md"), "# PLAN\n");

      try {
        const result = analyzeFallbackArtifactParity("TASKPAD.md", "PLAN.md", tempDir);

        // Test programmatic consumption patterns
        const hasBlockingViolations = result.violations.some(v => v.severity === "error");
        expect(hasBlockingViolations).toBe(true);

        const pendingArtifacts = result.artifacts.filter(a => a.lifecycleState === "pending");
        expect(pendingArtifacts.length).toBe(1);

        const actionableViolations = result.violations.filter(v => v.severity === "error");
        for (const violation of actionableViolations) {
          // Remediation should be actionable
          expect(violation.remediation.toLowerCase()).toMatch(
            /apply|fix|remove|reject|resolve/
          );
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("error handling and edge cases", () => {
    test("gracefully handles missing artifact directories", () => {
      const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
      const { join } = require("node:path");

      const tempDir = mkdtempSync(join(require("node:os").tmpdir(), "tp005-no-artifacts-"));
      writeFileSync(join(tempDir, "TASKPAD.md"), "# TASKPAD\n");
      writeFileSync(join(tempDir, "PLAN.md"), "# PLAN\n");

      try {
        const result = analyzeFallbackArtifactParity("TASKPAD.md", "PLAN.md", tempDir);

        // Should handle gracefully (no artifacts directory)
        expect(result).toBeDefined();
        expect(result).toHaveProperty("status");
        expect(result.artifacts).toHaveLength(0);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("handles empty artifacts array gracefully", () => {
      const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
      const { join } = require("node:path");

      const tempDir = mkdtempSync(join(require("node:os").tmpdir(), "tp005-empty-"));
      writeFileSync(join(tempDir, "TASKPAD.md"), "# TASKPAD\n");
      writeFileSync(join(tempDir, "PLAN.md"), "# PLAN\n");

      try {
        const result = analyzeFallbackArtifactParity("TASKPAD.md", "PLAN.md", tempDir);

        // Should handle gracefully (no artifacts to process)
        expect(result).toBeDefined();
        expect(result).toHaveProperty("status");
        expect(result.artifacts).toHaveLength(0);
        expect(result.violations).toHaveLength(0);
        expect(result.summary.totalArtifacts).toBe(0);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

// NOTE: Fixture-based comparison tests require a test vault with full fixture corpus.
// These can be added in TP006 when wiring the gate into verify:taskpad:intake:full.
// The core gate execution, integration, and determinism tests above provide coverage
// for the gate's functionality without requiring the full fixture set.
//
// To add fixture comparison tests in the future:
// 1. Create fixture files in test:vault (not Obsidian Vault due to write restrictions)
// 2. Run gate against each fixture scenario
// 3. Capture output to *.expected.json files
// 4. Add tests comparing gate output against expected files (similar to tp005-fallback-parity.test.ts)
//
// Example fixture scenarios to cover:
// - pass-applied: Artifact successfully applied
// - pass-noop: Idempotent artifact (already applied)
// - fail-pending: Artifact exists but not applied
// - fail-mismatched-sha: SHA mismatch after drift
// - fail-stale: Artifact superseded by newer one
// - multi-artifact: Multiple artifacts with deterministic ordering
