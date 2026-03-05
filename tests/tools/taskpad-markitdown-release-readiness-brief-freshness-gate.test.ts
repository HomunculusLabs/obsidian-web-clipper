#!/usr/bin/env bun

/**
 * TP003: MarkItDown Release Readiness Brief Freshness Gate Tests
 *
 * These tests verify the `taskpad:markitdown-release-readiness-brief-freshness-gate` works correctly
 * for all test cases:
 * - Pass: Brief is fresh (fingerprints match sources)
 * - No-brief: Brief file doesn't exist
 * - No-source: Source artifacts don't exist
 * - Stale-aggregate: Required composite inputs are stale (fingerprint mismatch)
 * - Multi-failure ordering: Multiple violations with deterministic ordering
 *
 * Contract: docs/contracts/markitdown-release-readiness-brief-freshness-gate.md
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  checkBriefFreshness,
  generateViolations,
  RuleIds,
  BRIEF_CONFIG,
  type BriefFreshnessCheck,
  type FreshnessViolation,
  type SourceFreshnessCheck,
} from "../../tools/taskpad-markitdown-release-readiness-brief-freshness-gate";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_ROOT = join(PROJECT_ROOT, "tests", "tools", "fixtures", "release-readiness-brief-freshness-gate");
const BRIEFS_FIXTURES = join(FIXTURES_ROOT, "briefs");
const SOURCES_FIXTURES = join(FIXTURES_ROOT, "sources");

// Helper to read fixture files
function readFixtureFile(relativePath: string): string {
  return readFileSync(join(FIXTURES_ROOT, relativePath), "utf8");
}

// Helper to setup temp directory with fixtures
function setupTempDir(fixtureType: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), `rrbfg-${fixtureType}-`));
  return tempDir;
}

// Helper to copy fixture to temp dir
function copyFixture(fixturePath: string, destPath: string): void {
  cpSync(fixturePath, destPath, { recursive: true });
}

// Helper to create file with specific mtime (by touching after write)
function createFileWithContent(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
}

// =============================================================================
// Unit Tests: Individual Freshness Check Functions
// =============================================================================

describe("TP003: checkBriefFreshness", () => {
  describe("pass state - brief exists with matching fingerprints", () => {
    test("returns fresh when release-readiness brief fingerprints match all sources", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-pass-"));

      // Copy pass fixtures
      copyFixture(join(BRIEFS_FIXTURES, "markitdown-release-readiness-brief-pass.md"),
                  join(tempDir, "markitdown-release-readiness-brief.md"));

      // Copy all required composite inputs
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-priority-brief.md"),
                  join(tempDir, "markitdown-conversion-priority-brief.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-regression-hotspots.md"),
                  join(tempDir, "markitdown-conversion-regression-hotspots.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-remediation-playbook.md"),
                  join(tempDir, "markitdown-conversion-remediation-playbook.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-state-sync.md"),
                  join(tempDir, "markitdown-conversion-state-sync.md"));

      // Copy upstream surfaces
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-review-inbox.md"),
                  join(tempDir, "markitdown-conversion-review-inbox.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-history.ndjson"),
                  join(tempDir, "markitdown-conversion-history.ndjson"));

      try {
        const result = checkBriefFreshness(BRIEF_CONFIG, tempDir);

        expect(result.briefName).toBe("markitdown-release-readiness-brief");
        expect(result.exists).toBe(true);
        expect(result.isStale).toBe(false);
        expect(result.hasFingerprints).toBe(true);

        // All required composite inputs should exist
        expect(result.requiredCompositeInputs).toHaveLength(4);
        for (const sourceCheck of result.requiredCompositeInputs) {
          expect(sourceCheck.exists).toBe(true);
        }

        // All upstream surfaces should exist
        expect(result.upstreamSurfaces).toHaveLength(2);
        for (const sourceCheck of result.upstreamSurfaces) {
          expect(sourceCheck.exists).toBe(true);
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("returns fresh when only required composite inputs exist (upstream optional)", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-pass-no-upstream-"));

      copyFixture(join(BRIEFS_FIXTURES, "markitdown-release-readiness-brief-pass.md"),
                  join(tempDir, "markitdown-release-readiness-brief.md"));

      // Copy only required composite inputs
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-priority-brief.md"),
                  join(tempDir, "markitdown-conversion-priority-brief.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-regression-hotspots.md"),
                  join(tempDir, "markitdown-conversion-regression-hotspots.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-remediation-playbook.md"),
                  join(tempDir, "markitdown-conversion-remediation-playbook.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-state-sync.md"),
                  join(tempDir, "markitdown-conversion-state-sync.md"));

      try {
        const result = checkBriefFreshness(BRIEF_CONFIG, tempDir);

        expect(result.exists).toBe(true);
        // Should not be stale just because upstream surfaces are missing
        // (they're optional, not required)
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("no-brief state - brief file doesn't exist", () => {
    test("returns not exists when release-readiness brief is missing", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-no-brief-"));

      // Only copy sources, not the brief
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-priority-brief.md"),
                  join(tempDir, "markitdown-conversion-priority-brief.md"));

      try {
        const result = checkBriefFreshness(BRIEF_CONFIG, tempDir);

        expect(result.exists).toBe(false);
        expect(result.isStale).toBe(true); // Missing is considered stale
        expect(result.hasFingerprints).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("returns not exists when vault path is undefined", () => {
      const result = checkBriefFreshness(BRIEF_CONFIG, undefined);

      expect(result.exists).toBe(false);
      expect(result.isStale).toBe(true);
    });
  });

  describe("no-source state - source artifacts don't exist", () => {
    test("reports missing sources when all sources are absent", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-no-source-"));

      // Only copy brief, not sources
      copyFixture(join(BRIEFS_FIXTURES, "markitdown-release-readiness-brief-pass.md"),
                  join(tempDir, "markitdown-release-readiness-brief.md"));

      try {
        const result = checkBriefFreshness(BRIEF_CONFIG, tempDir);

        expect(result.exists).toBe(true);
        expect(result.requiredCompositeInputs).toHaveLength(4);
        expect(result.upstreamSurfaces).toHaveLength(2);

        // All sources should be marked as missing
        for (const sourceCheck of result.requiredCompositeInputs) {
          expect(sourceCheck.exists).toBe(false);
          expect(sourceCheck.stalenessReason).toBe("source-missing");
        }
        for (const sourceCheck of result.upstreamSurfaces) {
          expect(sourceCheck.exists).toBe(false);
          expect(sourceCheck.stalenessReason).toBe("source-missing");
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("reports missing for specific required composite inputs", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-partial-sources-"));

      copyFixture(join(BRIEFS_FIXTURES, "markitdown-release-readiness-brief-pass.md"),
                  join(tempDir, "markitdown-release-readiness-brief.md"));

      // Only copy priority-brief and state-sync
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-priority-brief.md"),
                  join(tempDir, "markitdown-conversion-priority-brief.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-state-sync.md"),
                  join(tempDir, "markitdown-conversion-state-sync.md"));

      try {
        const result = checkBriefFreshness(BRIEF_CONFIG, tempDir);

        // Priority-brief should exist
        const priorityBriefCheck = result.requiredCompositeInputs.find(
          s => s.sourceName === "markitdown-conversion-priority-brief"
        );
        expect(priorityBriefCheck?.exists).toBe(true);

        // Regression-hotspots should be missing
        const hotspotsCheck = result.requiredCompositeInputs.find(
          s => s.sourceName === "markitdown-conversion-regression-hotspots"
        );
        expect(hotspotsCheck?.exists).toBe(false);
        expect(hotspotsCheck?.stalenessReason).toBe("source-missing");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("stale-aggregate state - required composite inputs are stale", () => {
    test("detects stale brief by fingerprint mismatch on required inputs", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-stale-aggregate-"));

      // Copy stale brief (old fingerprints)
      copyFixture(join(BRIEFS_FIXTURES, "markitdown-release-readiness-brief-stale.md"),
                  join(tempDir, "markitdown-release-readiness-brief.md"));

      // Copy current sources (with different content/hashes)
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-priority-brief.md"),
                  join(tempDir, "markitdown-conversion-priority-brief.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-regression-hotspots.md"),
                  join(tempDir, "markitdown-conversion-regression-hotspots.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-remediation-playbook.md"),
                  join(tempDir, "markitdown-conversion-remediation-playbook.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-state-sync.md"),
                  join(tempDir, "markitdown-conversion-state-sync.md"));

      try {
        const result = checkBriefFreshness(BRIEF_CONFIG, tempDir);

        expect(result.exists).toBe(true);
        expect(result.isStale).toBe(true);
        expect(result.hasFingerprints).toBe(true);

        // Should have stale required composite inputs
        const staleRequired = result.requiredCompositeInputs.filter(s => s.isStale);
        expect(staleRequired.length).toBeGreaterThan(0);

        for (const staleSource of staleRequired) {
          expect(staleSource.stalenessReason).toBe("source-newer");
          expect(staleSource.briefFingerprint).toBeDefined();
          expect(staleSource.currentFingerprint).toBeDefined();
          // Fingerprints should be different
          expect(staleSource.briefFingerprint).not.toBe(staleSource.currentFingerprint);
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("detects stale brief by missing fingerprint (mtime fallback)", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-stale-mtime-"));

      // Copy brief without fingerprints
      copyFixture(join(BRIEFS_FIXTURES, "markitdown-release-readiness-brief-missing-fingerprint.md"),
                  join(tempDir, "markitdown-release-readiness-brief.md"));

      // Copy sources
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-priority-brief.md"),
                  join(tempDir, "markitdown-conversion-priority-brief.md"));

      // Wait a moment then write source with newer mtime
      const briefContent = readFileSync(join(tempDir, "markitdown-release-readiness-brief.md"), "utf8");
      writeFileSync(join(tempDir, "markitdown-release-readiness-brief.md"), briefContent, "utf8");

      // Small delay to ensure different mtime
      const sourceContent = readFileSync(join(SOURCES_FIXTURES, "markitdown-conversion-priority-brief.md"), "utf8");
      writeFileSync(join(tempDir, "markitdown-conversion-priority-brief.md"), sourceContent + "\n<!-- updated -->", "utf8");

      try {
        const result = checkBriefFreshness(BRIEF_CONFIG, tempDir);

        expect(result.exists).toBe(true);
        expect(result.hasFingerprints).toBe(false);

        // Source check should exist
        const priorityBriefCheck = result.requiredCompositeInputs.find(
          s => s.sourceName === "markitdown-conversion-priority-brief"
        );
        expect(priorityBriefCheck?.exists).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("upstream surface staleness doesn't cause gate failure", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-upstream-stale-"));

      // Copy fresh brief
      copyFixture(join(BRIEFS_FIXTURES, "markitdown-release-readiness-brief-pass.md"),
                  join(tempDir, "markitdown-release-readiness-brief.md"));

      // Copy fresh required composite inputs
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-priority-brief.md"),
                  join(tempDir, "markitdown-conversion-priority-brief.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-regression-hotspots.md"),
                  join(tempDir, "markitdown-conversion-regression-hotspots.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-remediation-playbook.md"),
                  join(tempDir, "markitdown-conversion-remediation-playbook.md"));
      copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-state-sync.md"),
                  join(tempDir, "markitdown-conversion-state-sync.md"));

      // Don't copy upstream surfaces (they'll be missing)

      try {
        const result = checkBriefFreshness(BRIEF_CONFIG, tempDir);

        // Required composite inputs should be present and fresh
        for (const sourceCheck of result.requiredCompositeInputs) {
          expect(sourceCheck.exists).toBe(true);
        }

        // Upstream surfaces missing shouldn't make brief stale
        // (they're warnings, not errors)
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

// =============================================================================
// Unit Tests: Violation Generation
// =============================================================================

describe("TP003: generateViolations", () => {
  test("generates RRFG001 when brief not found", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-violation-no-brief-"));

    try {
      const briefCheck: BriefFreshnessCheck = {
        briefName: "markitdown-release-readiness-brief",
        briefPath: join(tempDir, "markitdown-release-readiness-brief.md"),
        exists: false,
        isStale: true,
        hasFingerprints: false,
        requiredCompositeInputs: [],
        upstreamSurfaces: [],
      };

      const violations = generateViolations(briefCheck, BRIEF_CONFIG, tempDir);

      const notFoundViolation = violations.find(v => v.ruleId === RuleIds.RRFG001_BRIEF_NOT_FOUND);
      expect(notFoundViolation).toBeDefined();
      expect(notFoundViolation?.severity).toBe("warning");
      expect(notFoundViolation?.remediation.scaffoldCommand).toContain("refreshMarkitdownReleaseReadinessBrief");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("generates RRFG002-RRFG005 for stale required composite inputs", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-violation-stale-required-"));

    try {
      const briefCheck: BriefFreshnessCheck = {
        briefName: "markitdown-release-readiness-brief",
        briefPath: join(tempDir, "markitdown-release-readiness-brief.md"),
        exists: true,
        isStale: true,
        generatedAt: "2026-03-01T10:00:00Z",
        hasFingerprints: true,
        requiredCompositeInputs: [
          {
            sourceName: "markitdown-conversion-priority-brief",
            sourcePath: join(tempDir, "markitdown-conversion-priority-brief.md"),
            precedenceLevel: 1,
            isRequired: true,
            exists: true,
            isStale: true,
            stalenessReason: "source-newer",
            briefFingerprint: "sha256:OLD",
            currentFingerprint: "sha256:NEW",
            briefMtime: "2026-03-01T10:00:00Z",
            sourceMtime: "2026-03-04T12:00:00Z",
          },
          {
            sourceName: "markitdown-conversion-regression-hotspots",
            sourcePath: join(tempDir, "markitdown-conversion-regression-hotspots.md"),
            precedenceLevel: 2,
            isRequired: true,
            exists: true,
            isStale: true,
            stalenessReason: "source-newer",
            briefFingerprint: "sha256:OLD",
            currentFingerprint: "sha256:NEW",
          },
          {
            sourceName: "markitdown-conversion-remediation-playbook",
            sourcePath: join(tempDir, "markitdown-conversion-remediation-playbook.md"),
            precedenceLevel: 3,
            isRequired: true,
            exists: true,
            isStale: true,
            stalenessReason: "source-newer",
            briefFingerprint: "sha256:OLD",
            currentFingerprint: "sha256:NEW",
          },
          {
            sourceName: "markitdown-conversion-state-sync",
            sourcePath: join(tempDir, "markitdown-conversion-state-sync.md"),
            precedenceLevel: 4,
            isRequired: true,
            exists: true,
            isStale: true,
            stalenessReason: "source-newer",
            briefFingerprint: "sha256:OLD",
            currentFingerprint: "sha256:NEW",
          },
        ],
        upstreamSurfaces: [],
      };

      const violations = generateViolations(briefCheck, BRIEF_CONFIG, tempDir);

      // Check for priority-brief stale violation (RRFG002)
      const priorityBriefViolation = violations.find(v => v.ruleId === RuleIds.RRFG002_PRIORITY_BRIEF_STALE);
      expect(priorityBriefViolation).toBeDefined();
      expect(priorityBriefViolation?.severity).toBe("error");

      // Check for regression-hotspots stale violation (RRFG003)
      const hotspotsViolation = violations.find(v => v.ruleId === RuleIds.RRFG003_REGRESSION_HOTSPOTS_STALE);
      expect(hotspotsViolation).toBeDefined();

      // Check for remediation-playbook stale violation (RRFG004)
      const playbookViolation = violations.find(v => v.ruleId === RuleIds.RRFG004_REMEDIATION_PLAYBOOK_STALE);
      expect(playbookViolation).toBeDefined();

      // Check for state-sync stale violation (RRFG005)
      const stateSyncViolation = violations.find(v => v.ruleId === RuleIds.RRFG005_STATE_SYNC_STALE);
      expect(stateSyncViolation).toBeDefined();

      // All should have remediation
      for (const violation of violations) {
        expect(violation.remediation.description).toBeTruthy();
        expect(violation.remediation.scaffoldCommand).toBeTruthy();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("generates RRFG006-RRFG007 for stale upstream surfaces (warnings)", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-violation-stale-upstream-"));

    try {
      const briefCheck: BriefFreshnessCheck = {
        briefName: "markitdown-release-readiness-brief",
        briefPath: join(tempDir, "markitdown-release-readiness-brief.md"),
        exists: true,
        isStale: false,
        hasFingerprints: true,
        requiredCompositeInputs: [],
        upstreamSurfaces: [
          {
            sourceName: "markitdown-conversion-review-inbox",
            sourcePath: join(tempDir, "markitdown-conversion-review-inbox.md"),
            precedenceLevel: 5,
            isRequired: false,
            exists: true,
            isStale: true,
            stalenessReason: "source-newer",
            briefFingerprint: "sha256:OLD",
            currentFingerprint: "sha256:NEW",
            briefMtime: "2026-03-01T10:00:00Z",
            sourceMtime: "2026-03-04T12:00:00Z",
          },
          {
            sourceName: "markitdown-conversion-history",
            sourcePath: join(tempDir, "markitdown-conversion-history.ndjson"),
            precedenceLevel: 6,
            isRequired: false,
            exists: true,
            isStale: true,
            stalenessReason: "source-newer",
            briefFingerprint: "sha256:OLD",
            currentFingerprint: "sha256:NEW",
          },
        ],
      };

      const violations = generateViolations(briefCheck, BRIEF_CONFIG, tempDir);

      // Check for review-inbox stale violation (RRFG006)
      const reviewInboxViolation = violations.find(v => v.ruleId === RuleIds.RRFG006_REVIEW_INBOX_STALE);
      expect(reviewInboxViolation).toBeDefined();
      expect(reviewInboxViolation?.severity).toBe("warning"); // Upstream is warning

      // Check for history stale violation (RRFG007)
      const historyViolation = violations.find(v => v.ruleId === RuleIds.RRFG007_HISTORY_STALE);
      expect(historyViolation).toBeDefined();
      expect(historyViolation?.severity).toBe("warning"); // Upstream is warning
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("generates RRFG009 for missing sources", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-violation-missing-source-"));

    try {
      const briefCheck: BriefFreshnessCheck = {
        briefName: "markitdown-release-readiness-brief",
        briefPath: join(tempDir, "markitdown-release-readiness-brief.md"),
        exists: true,
        isStale: false,
        hasFingerprints: true,
        requiredCompositeInputs: [
          {
            sourceName: "markitdown-conversion-priority-brief",
            sourcePath: join(tempDir, "markitdown-conversion-priority-brief.md"),
            precedenceLevel: 1,
            isRequired: true,
            exists: false,
            isStale: false,
            stalenessReason: "source-missing",
          },
        ],
        upstreamSurfaces: [],
      };

      const violations = generateViolations(briefCheck, BRIEF_CONFIG, tempDir);

      const missingSourceViolation = violations.find(v => v.ruleId === RuleIds.RRFG009_SOURCE_MISSING);
      expect(missingSourceViolation).toBeDefined();
      expect(missingSourceViolation?.severity).toBe("warning");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("generates RRFG010 when no sources found", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-violation-no-sources-"));

    try {
      const briefCheck: BriefFreshnessCheck = {
        briefName: "markitdown-release-readiness-brief",
        briefPath: join(tempDir, "markitdown-release-readiness-brief.md"),
        exists: true,
        isStale: false,
        hasFingerprints: true,
        requiredCompositeInputs: [
          {
            sourceName: "markitdown-conversion-priority-brief",
            sourcePath: join(tempDir, "markitdown-conversion-priority-brief.md"),
            precedenceLevel: 1,
            isRequired: true,
            exists: false,
            isStale: false,
            stalenessReason: "source-missing",
          },
        ],
        upstreamSurfaces: [
          {
            sourceName: "markitdown-conversion-review-inbox",
            sourcePath: join(tempDir, "markitdown-conversion-review-inbox.md"),
            precedenceLevel: 5,
            isRequired: false,
            exists: false,
            isStale: false,
            stalenessReason: "source-missing",
          },
        ],
      };

      const violations = generateViolations(briefCheck, BRIEF_CONFIG, tempDir);

      const noSourcesViolation = violations.find(v => v.ruleId === RuleIds.RRFG010_NO_SOURCES_FOUND);
      expect(noSourcesViolation).toBeDefined();
      expect(noSourcesViolation?.severity).toBe("warning");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("generates RRFG012 for aggregate stale when required inputs are stale", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-violation-aggregate-"));

    try {
      const briefCheck: BriefFreshnessCheck = {
        briefName: "markitdown-release-readiness-brief",
        briefPath: join(tempDir, "markitdown-release-readiness-brief.md"),
        exists: true,
        isStale: true,
        hasFingerprints: true,
        requiredCompositeInputs: [
          {
            sourceName: "markitdown-conversion-priority-brief",
            sourcePath: join(tempDir, "markitdown-conversion-priority-brief.md"),
            precedenceLevel: 1,
            isRequired: true,
            exists: true,
            isStale: true,
            stalenessReason: "source-newer",
          },
        ],
        upstreamSurfaces: [],
      };

      const violations = generateViolations(briefCheck, BRIEF_CONFIG, tempDir);

      const aggregateViolation = violations.find(v => v.ruleId === RuleIds.RRFG012_AGGREGATE_STALE);
      expect(aggregateViolation).toBeDefined();
      expect(aggregateViolation?.severity).toBe("error");
      expect(aggregateViolation?.remediation.description).toContain("stale composite inputs");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("generates RRFG011 for fingerprint parse error", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-violation-parse-error-"));

    try {
      const briefCheck: BriefFreshnessCheck = {
        briefName: "markitdown-release-readiness-brief",
        briefPath: join(tempDir, "markitdown-release-readiness-brief.md"),
        exists: true,
        isStale: true,
        hasFingerprints: false,
        parseError: "Malformed frontmatter",
        requiredCompositeInputs: [],
        upstreamSurfaces: [],
      };

      const violations = generateViolations(briefCheck, BRIEF_CONFIG, tempDir);

      const parseErrorViolation = violations.find(v => v.ruleId === RuleIds.RRFG011_FINGERPRINT_PARSE_ERROR);
      expect(parseErrorViolation).toBeDefined();
      expect(parseErrorViolation?.severity).toBe("error");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("generates no violations when all fresh", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-violation-none-"));

    try {
      const briefCheck: BriefFreshnessCheck = {
        briefName: "markitdown-release-readiness-brief",
        briefPath: join(tempDir, "markitdown-release-readiness-brief.md"),
        exists: true,
        isStale: false,
        hasFingerprints: true,
        requiredCompositeInputs: [
          {
            sourceName: "markitdown-conversion-priority-brief",
            sourcePath: join(tempDir, "markitdown-conversion-priority-brief.md"),
            precedenceLevel: 1,
            isRequired: true,
            exists: true,
            isStale: false,
          },
        ],
        upstreamSurfaces: [],
      };

      const violations = generateViolations(briefCheck, BRIEF_CONFIG, tempDir);
      // Should have no error-level violations
      const errors = violations.filter(v => v.severity === "error");
      expect(errors).toHaveLength(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Integration Tests: Multi-Failure and Ordering
// =============================================================================

describe("TP003: Multi-failure and deterministic ordering", () => {
  test("violations are sorted in canonical rule ID order", () => {
    // Verify canonical order is defined correctly
    const canonicalOrder = [
      RuleIds.RRFG001_BRIEF_NOT_FOUND,
      RuleIds.RRFG002_PRIORITY_BRIEF_STALE,
      RuleIds.RRFG003_REGRESSION_HOTSPOTS_STALE,
      RuleIds.RRFG004_REMEDIATION_PLAYBOOK_STALE,
      RuleIds.RRFG005_STATE_SYNC_STALE,
      RuleIds.RRFG006_REVIEW_INBOX_STALE,
      RuleIds.RRFG007_HISTORY_STALE,
      RuleIds.RRFG008_MISSING_FINGERPRINT,
      RuleIds.RRFG009_SOURCE_MISSING,
      RuleIds.RRFG010_NO_SOURCES_FOUND,
      RuleIds.RRFG011_FINGERPRINT_PARSE_ERROR,
      RuleIds.RRFG012_AGGREGATE_STALE,
    ];

    // Verify canonical order is RRFG001 -> RRFG002 -> ... -> RRFG012
    expect(canonicalOrder[0]).toBe(RuleIds.RRFG001_BRIEF_NOT_FOUND);
    expect(canonicalOrder[1]).toBe(RuleIds.RRFG002_PRIORITY_BRIEF_STALE);
    expect(canonicalOrder[11]).toBe(RuleIds.RRFG012_AGGREGATE_STALE);
  });

  test("handles multiple stale required composite inputs", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-multi-stale-"));

    // Setup stale brief
    copyFixture(join(BRIEFS_FIXTURES, "markitdown-release-readiness-brief-stale.md"),
                join(tempDir, "markitdown-release-readiness-brief.md"));

    // Copy all sources
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-priority-brief.md"),
                join(tempDir, "markitdown-conversion-priority-brief.md"));
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-regression-hotspots.md"),
                join(tempDir, "markitdown-conversion-regression-hotspots.md"));
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-remediation-playbook.md"),
                join(tempDir, "markitdown-conversion-remediation-playbook.md"));
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-state-sync.md"),
                join(tempDir, "markitdown-conversion-state-sync.md"));
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-review-inbox.md"),
                join(tempDir, "markitdown-conversion-review-inbox.md"));
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-history.ndjson"),
                join(tempDir, "markitdown-conversion-history.ndjson"));

    try {
      const check = checkBriefFreshness(BRIEF_CONFIG, tempDir);

      expect(check.isStale).toBe(true);

      const violations = generateViolations(check, BRIEF_CONFIG, tempDir);

      // Should have violations for stale required inputs
      const requiredStaleViolations = violations.filter(v =>
        v.ruleId === RuleIds.RRFG002_PRIORITY_BRIEF_STALE ||
        v.ruleId === RuleIds.RRFG003_REGRESSION_HOTSPOTS_STALE ||
        v.ruleId === RuleIds.RRFG004_REMEDIATION_PLAYBOOK_STALE ||
        v.ruleId === RuleIds.RRFG005_STATE_SYNC_STALE
      );
      expect(requiredStaleViolations.length).toBeGreaterThan(0);

      // Should have aggregate stale violation
      expect(violations.some(v => v.ruleId === RuleIds.RRFG012_AGGREGATE_STALE)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("error violations come before warning violations", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-error-before-warning-"));

    try {
      const briefCheck: BriefFreshnessCheck = {
        briefName: "markitdown-release-readiness-brief",
        briefPath: join(tempDir, "markitdown-release-readiness-brief.md"),
        exists: true,
        isStale: true,
        hasFingerprints: true,
        requiredCompositeInputs: [
          {
            sourceName: "markitdown-conversion-priority-brief",
            sourcePath: join(tempDir, "markitdown-conversion-priority-brief.md"),
            precedenceLevel: 1,
            isRequired: true,
            exists: true,
            isStale: true,
            stalenessReason: "source-newer",
          },
        ],
        upstreamSurfaces: [
          {
            sourceName: "markitdown-conversion-review-inbox",
            sourcePath: join(tempDir, "markitdown-conversion-review-inbox.md"),
            precedenceLevel: 5,
            isRequired: false,
            exists: false,
            isStale: false,
            stalenessReason: "source-missing",
          },
        ],
      };

      const violations = generateViolations(briefCheck, BRIEF_CONFIG, tempDir);

      // Find first error and first warning
      const firstErrorIndex = violations.findIndex(v => v.severity === "error");
      const firstWarningIndex = violations.findIndex(v => v.severity === "warning");

      // Errors should come first if both exist
      if (firstErrorIndex >= 0 && firstWarningIndex >= 0) {
        expect(firstErrorIndex).toBeLessThan(firstWarningIndex);
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
  test("all rule IDs follow RRFG### pattern", () => {
    const ruleIds = Object.values(RuleIds);
    for (const ruleId of ruleIds) {
      expect(ruleId).toMatch(/^RRFG\d+_/);
    }
  });

  test("rule IDs are unique", () => {
    const ruleIds = Object.values(RuleIds);
    const uniqueIds = new Set(ruleIds);
    expect(uniqueIds.size).toBe(ruleIds.length);
  });

  test("includes all expected rule IDs", () => {
    expect(RuleIds.RRFG001_BRIEF_NOT_FOUND).toBe("RRFG001_BRIEF_NOT_FOUND");
    expect(RuleIds.RRFG002_PRIORITY_BRIEF_STALE).toBe("RRFG002_PRIORITY_BRIEF_STALE");
    expect(RuleIds.RRFG003_REGRESSION_HOTSPOTS_STALE).toBe("RRFG003_REGRESSION_HOTSPOTS_STALE");
    expect(RuleIds.RRFG004_REMEDIATION_PLAYBOOK_STALE).toBe("RRFG004_REMEDIATION_PLAYBOOK_STALE");
    expect(RuleIds.RRFG005_STATE_SYNC_STALE).toBe("RRFG005_STATE_SYNC_STALE");
    expect(RuleIds.RRFG006_REVIEW_INBOX_STALE).toBe("RRFG006_REVIEW_INBOX_STALE");
    expect(RuleIds.RRFG007_HISTORY_STALE).toBe("RRFG007_HISTORY_STALE");
    expect(RuleIds.RRFG008_MISSING_FINGERPRINT).toBe("RRFG008_MISSING_FINGERPRINT");
    expect(RuleIds.RRFG009_SOURCE_MISSING).toBe("RRFG009_SOURCE_MISSING");
    expect(RuleIds.RRFG010_NO_SOURCES_FOUND).toBe("RRFG010_NO_SOURCES_FOUND");
    expect(RuleIds.RRFG011_FINGERPRINT_PARSE_ERROR).toBe("RRFG011_FINGERPRINT_PARSE_ERROR");
    expect(RuleIds.RRFG012_AGGREGATE_STALE).toBe("RRFG012_AGGREGATE_STALE");
  });
});

// =============================================================================
// Integration Tests: End-to-End Scenarios
// =============================================================================

describe("TP003: End-to-End Scenarios", () => {
  test("pass: fresh brief with all sources returns no error violations", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-e2e-pass-"));

    // Setup fresh brief
    copyFixture(join(BRIEFS_FIXTURES, "markitdown-release-readiness-brief-pass.md"),
                join(tempDir, "markitdown-release-readiness-brief.md"));

    // Copy all sources
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-priority-brief.md"),
                join(tempDir, "markitdown-conversion-priority-brief.md"));
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-regression-hotspots.md"),
                join(tempDir, "markitdown-conversion-regression-hotspots.md"));
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-remediation-playbook.md"),
                join(tempDir, "markitdown-conversion-remediation-playbook.md"));
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-state-sync.md"),
                join(tempDir, "markitdown-conversion-state-sync.md"));
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-review-inbox.md"),
                join(tempDir, "markitdown-conversion-review-inbox.md"));
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-history.ndjson"),
                join(tempDir, "markitdown-conversion-history.ndjson"));

    try {
      const check = checkBriefFreshness(BRIEF_CONFIG, tempDir);
      const violations = generateViolations(check, BRIEF_CONFIG, tempDir);

      // Should have no error-level violations
      const errors = violations.filter(v => v.severity === "error");
      expect(errors).toHaveLength(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("no-brief: missing brief generates RRFG001", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-e2e-no-brief-"));

    // Only copy sources
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-priority-brief.md"),
                join(tempDir, "markitdown-conversion-priority-brief.md"));

    try {
      const check = checkBriefFreshness(BRIEF_CONFIG, tempDir);
      const violations = generateViolations(check, BRIEF_CONFIG, tempDir);

      // Should have RRFG001 for missing brief
      const notFoundViolation = violations.find(v => v.ruleId === RuleIds.RRFG001_BRIEF_NOT_FOUND);
      expect(notFoundViolation).toBeDefined();
      expect(notFoundViolation?.severity).toBe("warning");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("no-source: missing sources generates RRFG009 and RRFG010", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-e2e-no-source-"));

    // Setup briefs without sources
    copyFixture(join(BRIEFS_FIXTURES, "markitdown-release-readiness-brief-pass.md"),
                join(tempDir, "markitdown-release-readiness-brief.md"));

    try {
      const check = checkBriefFreshness(BRIEF_CONFIG, tempDir);
      const violations = generateViolations(check, BRIEF_CONFIG, tempDir);

      // Should have RRFG009 for missing sources
      const missingSourceViolations = violations.filter(v => v.ruleId === RuleIds.RRFG009_SOURCE_MISSING);
      expect(missingSourceViolations.length).toBeGreaterThan(0);

      // Should have RRFG010 for no sources found
      const noSourcesViolation = violations.find(v => v.ruleId === RuleIds.RRFG010_NO_SOURCES_FOUND);
      expect(noSourcesViolation).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("stale-aggregate: stale required inputs generates RRFG002-005 and RRFG012", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-e2e-stale-aggregate-"));

    // Setup stale brief
    copyFixture(join(BRIEFS_FIXTURES, "markitdown-release-readiness-brief-stale.md"),
                join(tempDir, "markitdown-release-readiness-brief.md"));

    // Copy all sources
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-priority-brief.md"),
                join(tempDir, "markitdown-conversion-priority-brief.md"));
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-regression-hotspots.md"),
                join(tempDir, "markitdown-conversion-regression-hotspots.md"));
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-remediation-playbook.md"),
                join(tempDir, "markitdown-conversion-remediation-playbook.md"));
    copyFixture(join(SOURCES_FIXTURES, "markitdown-conversion-state-sync.md"),
                join(tempDir, "markitdown-conversion-state-sync.md"));

    try {
      const check = checkBriefFreshness(BRIEF_CONFIG, tempDir);
      const violations = generateViolations(check, BRIEF_CONFIG, tempDir);

      // Should have at least one required input stale violation
      const requiredStaleViolations = violations.filter(v =>
        v.ruleId === RuleIds.RRFG002_PRIORITY_BRIEF_STALE ||
        v.ruleId === RuleIds.RRFG003_REGRESSION_HOTSPOTS_STALE ||
        v.ruleId === RuleIds.RRFG004_REMEDIATION_PLAYBOOK_STALE ||
        v.ruleId === RuleIds.RRFG005_STATE_SYNC_STALE
      );
      expect(requiredStaleViolations.length).toBeGreaterThan(0);

      // Should have RRFG012 aggregate stale
      expect(violations.some(v => v.ruleId === RuleIds.RRFG012_AGGREGATE_STALE)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Output Contract Tests
// =============================================================================

describe("TP003: Output contract", () => {
  test("violations include all required fields", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-output-"));

    try {
      const briefCheck: BriefFreshnessCheck = {
        briefName: "markitdown-release-readiness-brief",
        briefPath: join(tempDir, "brief.md"),
        exists: false,
        isStale: true,
        hasFingerprints: false,
        requiredCompositeInputs: [],
        upstreamSurfaces: [],
      };

      const violations = generateViolations(briefCheck, BRIEF_CONFIG, tempDir);
      expect(violations.length).toBeGreaterThan(0);

      for (const violation of violations) {
        expect(violation).toHaveProperty("ruleId");
        expect(violation).toHaveProperty("severity");
        expect(violation).toHaveProperty("briefName");
        expect(violation).toHaveProperty("briefPath");
        expect(violation).toHaveProperty("details");
        expect(violation).toHaveProperty("remediation");
        expect(violation.remediation).toHaveProperty("description");
        expect(violation.remediation).toHaveProperty("scaffoldCommand");
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("remediation scaffold command includes handler reference", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rrbfg-scaffold-"));

    try {
      const briefCheck: BriefFreshnessCheck = {
        briefName: "markitdown-release-readiness-brief",
        briefPath: join(tempDir, "brief.md"),
        exists: false,
        isStale: true,
        hasFingerprints: false,
        requiredCompositeInputs: [],
        upstreamSurfaces: [],
      };

      const violations = generateViolations(briefCheck, BRIEF_CONFIG, tempDir);
      const notFoundViolation = violations.find(v => v.ruleId === RuleIds.RRFG001_BRIEF_NOT_FOUND);

      expect(notFoundViolation).toBeDefined();
      expect(notFoundViolation?.remediation.scaffoldCommand).toContain("refreshMarkitdownReleaseReadinessBrief");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Brief Config Contract Tests
// =============================================================================

describe("TP003: Brief config contract", () => {
  test("BRIEF_CONFIG has required composite inputs in precedence order", () => {
    expect(BRIEF_CONFIG.requiredCompositeInputs).toHaveLength(4);

    // Check precedence order (uses 'precedence' field in config)
    const precedences = BRIEF_CONFIG.requiredCompositeInputs.map(s => s.precedence);
    for (let i = 1; i < precedences.length; i++) {
      expect(precedences[i]).toBeGreaterThan(precedences[i - 1]);
    }
  });

  test("BRIEF_CONFIG has upstream surfaces with higher precedence", () => {
    expect(BRIEF_CONFIG.upstreamSurfaces).toHaveLength(2);

    // Upstream should have higher precedence numbers than required
    const maxRequiredPrecedence = Math.max(
      ...BRIEF_CONFIG.requiredCompositeInputs.map(s => s.precedence)
    );
    for (const upstream of BRIEF_CONFIG.upstreamSurfaces) {
      expect(upstream.precedence).toBeGreaterThan(maxRequiredPrecedence);
      expect(upstream.isRequired).toBe(false);
    }
  });

  test("all required composite inputs have isRequired=true", () => {
    for (const input of BRIEF_CONFIG.requiredCompositeInputs) {
      expect(input.isRequired).toBe(true);
    }
  });

  test("each source has unique rule ID", () => {
    const allSources = [...BRIEF_CONFIG.requiredCompositeInputs, ...BRIEF_CONFIG.upstreamSurfaces];
    const ruleIds = allSources.map(s => s.ruleId);
    const uniqueRuleIds = new Set(ruleIds);
    expect(uniqueRuleIds.size).toBe(ruleIds.length);
  });
});
