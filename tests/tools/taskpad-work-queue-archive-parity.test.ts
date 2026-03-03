import { describe, expect, test } from "bun:test";

import {
  checkArchiveParity,
  parseArchiveFingerprints,
  parseTaskpadArchivedBullets,
  validateArchiveParity,
  WORK_QUEUE_ARCHIVE_PARITY_RULE_IDS,
  type WorkQueueArchiveParityResult,
} from "../../tools/taskpad-work-queue-archive-parity";

// ============================================================================
// TP004: Fixture-based tests for taskpad:work-queue-archive-parity covering:
// - Pass: perfect fingerprint parity between TASKPAD and archive
// - Fail: missing fingerprints in archive (TASKPAD bullets not archived)
// - Fail: extra entries in archive (archive has bullets not in TASKPAD)
// - Fail: duplicate fingerprints in archive
// - Noop: empty archive with no TASKPAD archived bullets
// ============================================================================

function buildTaskpadWithWorkQueue(workQueueContent: string): string {
  return `# TASKPAD Test

## Autonomous Kickoff Queue
- [ ] Some autonomous task

## Work Queue
${workQueueContent}

## Self-Improvement Backlog
- [ ] Some improvement task
`;
}

function buildArchiveWithFingerprints(bullets: Array<{ rawLine: string; fingerprintHash: string }>): string {
  const bulletLines = bullets.map(b => `${b.rawLine} <!-- fingerprint: ${b.fingerprintHash} -->`).join("\n");
  return `<!--
TASKPAD Work Queue Archive: 2026-03-01
Generated: 2026-03-01T00:00:00.000Z
Source TASKPAD: TASKPAD.md
-->

---

## Archived from 2026-03-01

${bulletLines}`;
}

describe("parseArchiveFingerprints", () => {
  test("parses fingerprints from archive markdown", () => {
    const archiveMarkdown = buildArchiveWithFingerprints([
      { rawLine: "- [x] Completed task", fingerprintHash: "abc123def4567890" },
      { rawLine: "- [x] Another task", fingerprintHash: "def789abc0123456" },
    ]);

    const result = parseArchiveFingerprints(archiveMarkdown);

    expect(result.exists).toBe(true);
    expect(result.fingerprints).toHaveLength(2);
    expect(result.fingerprints[0].fingerprintHash).toBe("abc123def4567890");
    expect(result.fingerprints[0].taskText).toBe("Completed task");
    expect(result.fingerprints[1].fingerprintHash).toBe("def789abc0123456");
  });

  test("returns empty when archive markdown is null", () => {
    const result = parseArchiveFingerprints(null);

    expect(result.exists).toBe(false);
    expect(result.fingerprints).toHaveLength(0);
  });

  test("returns empty when archive markdown is empty", () => {
    const result = parseArchiveFingerprints("");

    expect(result.exists).toBe(false);
    expect(result.fingerprints).toHaveLength(0);
  });

  test("extracts task text without checkboxes and planned markers", () => {
    const archiveMarkdown = buildArchiveWithFingerprints([
      { rawLine: "- [x] (planned-2026-03-01) Task with marker", fingerprintHash: "abcd1234ef567890" },
    ]);

    const result = parseArchiveFingerprints(archiveMarkdown);

    expect(result.fingerprints[0].taskText).toBe("Task with marker");
  });
});

describe("parseTaskpadArchivedBullets", () => {
  test("extracts checked bullets as archived candidates", () => {
    const markdown = buildTaskpadWithWorkQueue(`- [x] Checked task 1
- [x] Checked task 2
- [ ] Unchecked task`);

    const result = parseTaskpadArchivedBullets(markdown);

    expect(result.archivedBullets).toHaveLength(2);
    expect(result.archivedBullets[0].taskText).toBe("Checked task 1");
    expect(result.archivedBullets[1].taskText).toBe("Checked task 2");
  });

  test("extracts planned bullets as archived candidates", () => {
    const markdown = buildTaskpadWithWorkQueue(`- [ ] planned-2026-03-01 Planned task
- [ ] (planned-2026-03-02) Parenthesized planned task
- [ ] Regular unchecked task`);

    const result = parseTaskpadArchivedBullets(markdown);

    expect(result.archivedBullets).toHaveLength(2);
    expect(result.archivedBullets.some(b => b.taskText === "Planned task")).toBe(true);
    expect(result.archivedBullets.some(b => b.taskText === "Parenthesized planned task")).toBe(true);
  });

  test("returns empty when Work Queue heading is missing", () => {
    const markdown = `# TASKPAD Test

## Autonomous Kickoff Queue
- [ ] Some task
`;

    const result = parseTaskpadArchivedBullets(markdown);

    expect(result.archivedBullets).toHaveLength(0);
    expect(result.allBullets).toHaveLength(0);
  });

  test("reports error for multiple Work Queue headings", () => {
    const markdown = `# TASKPAD Test

## Work Queue
- [ ] Task 1

## Work Queue
- [ ] Task 2
`;

    const result = parseTaskpadArchivedBullets(markdown);

    expect(result.parseErrors).toContain("Multiple '## Work Queue' headings found; only one is allowed.");
  });

  test("computes deterministic fingerprints", () => {
    const markdown = buildTaskpadWithWorkQueue(`- [x] Task to fingerprint`);

    const result = parseTaskpadArchivedBullets(markdown);

    expect(result.archivedBullets).toHaveLength(1);
    expect(result.archivedBullets[0].fingerprintHash).toBeDefined();
    expect(result.archivedBullets[0].fingerprintHash).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("validateArchiveParity - pass conditions", () => {
  test("pass: perfect parity between TASKPAD and archive", () => {
    // First get the actual fingerprint that would be computed
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [x] Completed task to archive`);
    const taskpadAnalysis = parseTaskpadArchivedBullets(taskpadMarkdown);
    const actualFingerprint = taskpadAnalysis.archivedBullets[0].fingerprintHash;

    // Build archive with the actual fingerprint
    const archiveMarkdown = buildArchiveWithFingerprints([
      { rawLine: "- [x] Completed task to archive", fingerprintHash: actualFingerprint },
    ]);

    const result = validateArchiveParity("TASKPAD.md", "ARCHIVE.md", taskpadMarkdown, archiveMarkdown);

    expect(result.status).toBe("pass");
    expect(result.reasonCode).toBe(WORK_QUEUE_ARCHIVE_PARITY_RULE_IDS.PARITY_OK);
    expect(result.stats.archivedBulletsInTaskpad).toBe(1);
    expect(result.stats.fingerprintRecordsInArchive).toBe(1);
    expect(result.violations).toHaveLength(0);
  });

  test("pass: empty TASKPAD with empty archive", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [ ] Unchecked task only`);

    const result = validateArchiveParity("TASKPAD.md", "ARCHIVE.md", taskpadMarkdown, null);

    expect(result.status).toBe("pass");
    expect(result.reasonCode).toBe(WORK_QUEUE_ARCHIVE_PARITY_RULE_IDS.PARITY_OK);
    expect(result.stats.archivedBulletsInTaskpad).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  test("pass: multiple bullets with perfect parity", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [x] Task 1
- [x] Task 2
- [ ] planned-2026-03-01 Task 3`);

    const taskpadAnalysis = parseTaskpadArchivedBullets(taskpadMarkdown);
    const fingerprints = taskpadAnalysis.archivedBullets.map(b => ({
      rawLine: b.rawText,
      fingerprintHash: b.fingerprintHash,
    }));

    const archiveMarkdown = buildArchiveWithFingerprints(fingerprints);

    const result = validateArchiveParity("TASKPAD.md", "ARCHIVE.md", taskpadMarkdown, archiveMarkdown);

    expect(result.status).toBe("pass");
    expect(result.reasonCode).toBe(WORK_QUEUE_ARCHIVE_PARITY_RULE_IDS.PARITY_OK);
    expect(result.stats.archivedBulletsInTaskpad).toBe(3);
    expect(result.stats.fingerprintRecordsInArchive).toBe(3);
  });
});

describe("validateArchiveParity - fail conditions", () => {
  test("fail: TASKPAD has archived bullets but archive is missing", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [x] Completed task not archived`);

    const result = validateArchiveParity("TASKPAD.md", "ARCHIVE.md", taskpadMarkdown, null);

    expect(result.status).toBe("fail");
    expect(result.reasonCode).toBe(WORK_QUEUE_ARCHIVE_PARITY_RULE_IDS.PARITY_ARCHIVE_MISSING);
    expect(result.stats.archivedBulletsInTaskpad).toBe(1);
    expect(result.stats.missingFromTaskpad).toBe(1);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].driftType).toBe("missing_from_taskpad");
  });

  test("fail: TASKPAD bullet missing from archive", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [x] Task in TASKPAD
- [x] Another task in TASKPAD`);

    const taskpadAnalysis = parseTaskpadArchivedBullets(taskpadMarkdown);
    // Only archive the first bullet
    const archiveMarkdown = buildArchiveWithFingerprints([
      { rawLine: taskpadAnalysis.archivedBullets[0].rawText, fingerprintHash: taskpadAnalysis.archivedBullets[0].fingerprintHash },
    ]);

    const result = validateArchiveParity("TASKPAD.md", "ARCHIVE.md", taskpadMarkdown, archiveMarkdown);

    expect(result.status).toBe("fail");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].driftType).toBe("missing_from_taskpad");
    expect(result.stats.missingFromTaskpad).toBe(1);
  });

  test("fail: extra entry in archive not in TASKPAD", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [x] Task in TASKPAD`);

    const taskpadAnalysis = parseTaskpadArchivedBullets(taskpadMarkdown);
    const archiveMarkdown = buildArchiveWithFingerprints([
      { rawLine: taskpadAnalysis.archivedBullets[0].rawText, fingerprintHash: taskpadAnalysis.archivedBullets[0].fingerprintHash },
      { rawLine: "- [x] Orphaned task not in TASKPAD", fingerprintHash: "deadbeef12345678" },
    ]);

    const result = validateArchiveParity("TASKPAD.md", "ARCHIVE.md", taskpadMarkdown, archiveMarkdown);

    expect(result.status).toBe("fail");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].driftType).toBe("extra_in_archive");
    expect(result.stats.extraInArchive).toBe(1);
  });

  test("fail: duplicate fingerprints in archive", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [x] Task in TASKPAD`);

    const taskpadAnalysis = parseTaskpadArchivedBullets(taskpadMarkdown);
    const fingerprint = taskpadAnalysis.archivedBullets[0].fingerprintHash;

    // Archive same fingerprint twice
    const archiveMarkdown = buildArchiveWithFingerprints([
      { rawLine: taskpadAnalysis.archivedBullets[0].rawText, fingerprintHash: fingerprint },
      { rawLine: taskpadAnalysis.archivedBullets[0].rawText, fingerprintHash: fingerprint },
    ]);

    const result = validateArchiveParity("TASKPAD.md", "ARCHIVE.md", taskpadMarkdown, archiveMarkdown);

    // Should have duplicate violation (warning severity)
    const duplicateViolation = result.violations.find(v => v.driftType === "duplicate_fingerprint");
    expect(duplicateViolation).toBeDefined();
    expect(duplicateViolation?.severity).toBe("warning");
    expect(result.stats.duplicateFingerprints).toBe(1);
  });

  test("fail: multiple drift types in same check", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [x] Task 1 in TASKPAD
- [x] Task 2 in TASKPAD`);

    const taskpadAnalysis = parseTaskpadArchivedBullets(taskpadMarkdown);
    // Archive only first task + add extra orphaned entry
    const archiveMarkdown = buildArchiveWithFingerprints([
      { rawLine: taskpadAnalysis.archivedBullets[0].rawText, fingerprintHash: taskpadAnalysis.archivedBullets[0].fingerprintHash },
      { rawLine: "- [x] Orphaned task", fingerprintHash: "cafebabe12345678" },
    ]);

    const result = validateArchiveParity("TASKPAD.md", "ARCHIVE.md", taskpadMarkdown, archiveMarkdown);

    expect(result.status).toBe("fail");
    expect(result.violations).toHaveLength(2);
    expect(result.stats.missingFromTaskpad).toBe(1);
    expect(result.stats.extraInArchive).toBe(1);
  });
});

describe("validateArchiveParity - violation ordering", () => {
  test("violations are sorted in canonical order", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [x] Task 1
- [x] Task 2`);

    const taskpadAnalysis = parseTaskpadArchivedBullets(taskpadMarkdown);
    // Create archive with duplicate + missing + extra
    const archiveMarkdown = buildArchiveWithFingerprints([
      { rawLine: taskpadAnalysis.archivedBullets[0].rawText, fingerprintHash: taskpadAnalysis.archivedBullets[0].fingerprintHash },
      { rawLine: taskpadAnalysis.archivedBullets[0].rawText, fingerprintHash: taskpadAnalysis.archivedBullets[0].fingerprintHash }, // duplicate
      { rawLine: "- [x] Orphaned", fingerprintHash: "cafebabe87654321" }, // extra
    ]);

    const result = validateArchiveParity("TASKPAD.md", "ARCHIVE.md", taskpadMarkdown, archiveMarkdown);

    // Check canonical ordering: duplicate should come before extra
    const duplicateIndex = result.violations.findIndex(v => v.driftType === "duplicate_fingerprint");
    const extraIndex = result.violations.findIndex(v => v.driftType === "extra_in_archive");
    const missingIndex = result.violations.findIndex(v => v.driftType === "missing_from_taskpad");

    expect(duplicateIndex).toBeLessThan(extraIndex);
    expect(duplicateIndex).toBeLessThan(missingIndex);
  });
});

describe("checkArchiveParity - input validation", () => {
  test("fail: missing TASKPAD file", () => {
    const result = checkArchiveParity("/nonexistent/TASKPAD.md", "ARCHIVE.md");

    expect(result.status).toBe("fail");
    expect(result.reasonCode).toBe(WORK_QUEUE_ARCHIVE_PARITY_RULE_IDS.PARITY_INPUT_INVALID);
    expect(result.violations[0].ruleId).toBe(WORK_QUEUE_ARCHIVE_PARITY_RULE_IDS.PARITY_INPUT_INVALID);
  });
});

describe("validateArchiveParity - stats accuracy", () => {
  test("stats reflect accurate counts for complex scenarios", () => {
    const taskpadMarkdown = buildTaskpadWithWorkQueue(`- [x] Task 1
- [x] Task 2
- [x] Task 3`);

    const taskpadAnalysis = parseTaskpadArchivedBullets(taskpadMarkdown);
    // Archive task 1 and task 2, but duplicate task 1
    const archiveMarkdown = buildArchiveWithFingerprints([
      { rawLine: taskpadAnalysis.archivedBullets[0].rawText, fingerprintHash: taskpadAnalysis.archivedBullets[0].fingerprintHash },
      { rawLine: taskpadAnalysis.archivedBullets[0].rawText, fingerprintHash: taskpadAnalysis.archivedBullets[0].fingerprintHash }, // duplicate
      { rawLine: taskpadAnalysis.archivedBullets[1].rawText, fingerprintHash: taskpadAnalysis.archivedBullets[1].fingerprintHash },
    ]);

    const result = validateArchiveParity("TASKPAD.md", "ARCHIVE.md", taskpadMarkdown, archiveMarkdown);

    expect(result.stats.archivedBulletsInTaskpad).toBe(3);
    expect(result.stats.fingerprintRecordsInArchive).toBe(3);
    expect(result.stats.duplicateFingerprints).toBe(1);
    expect(result.stats.extraInArchive).toBe(0);
  });
});
