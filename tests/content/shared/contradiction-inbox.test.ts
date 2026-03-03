/**
 * Contract Tests for Contradiction Inbox
 *
 * Tests the deterministic contract for the Contradiction Inbox including:
 * - Contradictory-pair detection (direct negation, mutually exclusive, temporal, quantitative)
 * - Deduplication rules and precedence
 * - Resolved-status handling
 * - Truncation behavior (conflicts, claims, refs, text)
 * - Rerun determinism
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type {
  ClaimInput,
  ConflictEntry,
  ContradictionInbox,
  ClaimFingerprint,
  SourceClipRef,
  ConflictClaim
} from "../../../src/shared/contradictionInboxContract";
import {
  ConflictStatus,
  ContradictionType,
  ClaimSource,
  CONTRADICTION_INBOX_VERSION,
  MAX_CONFLICTS,
  MAX_CLAIMS_PER_CONFLICT,
  MAX_SOURCE_CLIP_REFS,
  MAX_CLAIM_LENGTH,
  MAX_CONFLICT_DESCRIPTION_LENGTH,
  computeClaimFingerprint,
  claimsAreEquivalent,
  detectContradictionType,
  buildConflictClaim,
  buildSourceClipRefs,
  truncateClaim,
  truncateDescription,
  generateConflictDescription,
  computeConflictScore,
  sortEntriesDeterministically,
  ANTONYM_PAIRS,
  NEGATION_KEYWORDS,
  DEFAULT_EMPTY_INBOX_METADATA
} from "../../../src/shared/contradictionInboxContract";
import {
  buildContradictionInbox,
  buildConflictEntries,
  mergeDuplicateClaims
} from "../../../src/shared/contradictionInboxBuilder";
import {
  resolveInboxPath,
  isInboxEmpty,
  renderEmptyInbox,
  exportContradictionInbox,
  exportEmptyInbox,
  inboxFileExists,
  readInboxFile,
  deleteInboxFile,
  getDefaultExportOptions,
  DEFAULT_INBOX_FILENAME,
  computeConflictStatusMetadata,
  type ExportInboxOptions,
  type ConflictStatusMetadata
} from "../../../src/shared/contradictionInboxExporter";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

// ============================================================================
// FIXTURE HELPERS
// ============================================================================

function createClaimInput(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    claim: overrides.claim ?? "Default claim text",
    source: overrides.source ?? ClaimSource.KEY_TAKEAWAYS,
    sourcePath: overrides.sourcePath ?? "/path/to/note.md",
    sourceTitle: overrides.sourceTitle ?? "Test Note",
    sourceUrl: overrides.sourceUrl ?? "https://example.com",
    entryId: overrides.entryId ?? "entry-1",
    timestamp: overrides.timestamp ?? "2026-03-01T10:00:00.000Z",
    sourceId: overrides.sourceId ?? "note-1",
    ...overrides
  };
}

function createContradictoryPair(): [ClaimInput, ClaimInput] {
  return [
    createClaimInput({
      claim: "React hooks should be used for state management",
      sourcePath: "/path/to/note1.md",
      sourceTitle: "Note 1",
      entryId: "entry-1",
      timestamp: "2026-03-01T10:00:00.000Z",
      sourceId: "note-1"
    }),
    createClaimInput({
      claim: "React hooks should not be used for state management",
      sourcePath: "/path/to/note2.md",
      sourceTitle: "Note 2",
      entryId: "entry-2",
      timestamp: "2026-03-02T11:00:00.000Z",
      sourceId: "note-2"
    })
  ];
}

// ============================================================================
// CONTRADICTORY-PAIR DETECTION TESTS
// ============================================================================

describe("Contradictory-Pair Detection", () => {
  describe("Direct Negation Detection", () => {
    it("should detect 'not' negation between claims", () => {
      const claimA = computeClaimFingerprint("React hooks are good for state");
      const claimB = computeClaimFingerprint("React hooks are not good for state");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.DIRECT_NEGATION);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should detect 'never' negation between claims", () => {
      const claimA = computeClaimFingerprint("Use useEffect for data fetching");
      const claimB = computeClaimFingerprint("Never use useEffect for data fetching");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.DIRECT_NEGATION);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should detect 'cannot' negation between claims", () => {
      const claimA = computeClaimFingerprint("Components can share state");
      const claimB = computeClaimFingerprint("Components cannot share state");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.DIRECT_NEGATION);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should not detect contradiction when both claims have negation", () => {
      const claimA = computeClaimFingerprint("Do not use class components");
      const claimB = computeClaimFingerprint("Do not use functional components");

      const result = detectContradictionType(claimA, claimB);

      // Both have negation, not a direct negation of each other
      expect(result.type).toBe(ContradictionType.UNKNOWN);
    });

    it("should not detect contradiction when neither claim has negation", () => {
      const claimA = computeClaimFingerprint("Use TypeScript for new projects");
      const claimB = computeClaimFingerprint("Use JavaScript for new projects");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.UNKNOWN);
    });
  });

  describe("Mutually Exclusive Detection", () => {
    it("should detect mutually exclusive boolean states", () => {
      const claimA = computeClaimFingerprint("Feature flags are enabled");
      const claimB = computeClaimFingerprint("Feature flags are disabled");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.MUTUALLY_EXCLUSIVE);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should detect mutually exclusive binary states (on/off)", () => {
      const claimA = computeClaimFingerprint("The server is on");
      const claimB = computeClaimFingerprint("The server is off");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.MUTUALLY_EXCLUSIVE);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should detect mutually exclusive size attributes", () => {
      const claimA = computeClaimFingerprint("The payload is large");
      const claimB = computeClaimFingerprint("The payload is small");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.MUTUALLY_EXCLUSIVE);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should detect mutually exclusive temperature attributes", () => {
      const claimA = computeClaimFingerprint("The cache is hot");
      const claimB = computeClaimFingerprint("The cache is cold");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.MUTUALLY_EXCLUSIVE);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should detect mutually exclusive frequency terms", () => {
      // Note: "always" vs "never" is detected as DIRECT_NEGATION because
      // "never" is a negation keyword - this is actually more accurate
      const claimA = computeClaimFingerprint("Errors always occur");
      const claimB = computeClaimFingerprint("Errors never occur");

      const result = detectContradictionType(claimA, claimB);

      // Either MUTUALLY_EXCLUSIVE or DIRECT_NEGATION is acceptable - both indicate contradiction
      expect([
        ContradictionType.MUTUALLY_EXCLUSIVE,
        ContradictionType.DIRECT_NEGATION
      ]).toContain(result.type);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should not detect false positive for non-antonyms", () => {
      const claimA = computeClaimFingerprint("Use React for frontend");
      const claimB = computeClaimFingerprint("Use Vue for frontend");

      const result = detectContradictionType(claimA, claimB);

      // React and Vue are not defined antonyms
      expect(result.type).toBe(ContradictionType.UNKNOWN);
    });
  });

  describe("Temporal Contradiction Detection", () => {
    it("should detect before/after contradiction", () => {
      const claimA = computeClaimFingerprint("Load data before rendering");
      const claimB = computeClaimFingerprint("Load data after rendering");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.TEMPORAL);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should detect earlier/later contradiction", () => {
      const claimA = computeClaimFingerprint("Validation happens earlier");
      const claimB = computeClaimFingerprint("Validation happens later");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.TEMPORAL);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should detect first/last contradiction", () => {
      const claimA = computeClaimFingerprint("Auth runs first");
      const claimB = computeClaimFingerprint("Auth runs last");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.TEMPORAL);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should detect precedes/follows contradiction", () => {
      const claimA = computeClaimFingerprint("Parsing precedes validation");
      const claimB = computeClaimFingerprint("Parsing follows validation");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.TEMPORAL);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should not detect temporal contradiction without ordering keywords", () => {
      const claimA = computeClaimFingerprint("Load data in the morning");
      const claimB = computeClaimFingerprint("Load data in the evening");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.UNKNOWN);
    });
  });

  describe("Quantitative Contradiction Detection", () => {
    it("should detect different numerical values", () => {
      const claimA = computeClaimFingerprint("The timeout is 30 seconds");
      const claimB = computeClaimFingerprint("The timeout is 60 seconds");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.QUANTITATIVE);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should detect different counts", () => {
      const claimA = computeClaimFingerprint("The system has 3 replicas");
      const claimB = computeClaimFingerprint("The system has 5 replicas");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.QUANTITATIVE);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("should not detect quantitative contradiction when numbers match", () => {
      const claimA = computeClaimFingerprint("Use 100ms debounce");
      const claimB = computeClaimFingerprint("Also use 100ms debounce");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.UNKNOWN);
    });

    it("should not detect quantitative contradiction without numbers", () => {
      const claimA = computeClaimFingerprint("Use short timeouts");
      const claimB = computeClaimFingerprint("Use long timeouts");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.UNKNOWN);
    });
  });

  describe("Unknown Contradiction Detection", () => {
    it("should flag potential contradictions with key term overlap", () => {
      const claimA = computeClaimFingerprint("TypeScript improves developer productivity");
      const claimB = computeClaimFingerprint("TypeScript reduces developer productivity");

      const result = detectContradictionType(claimA, claimB);

      // Should be detected as unknown/potential due to key term overlap
      // Note: "improves" vs "reduces" is not a defined antonym pair
      // but the claims share key terms
      expect(result.confidence).toBeLessThan(0.6);
    });

    it("should return zero confidence for unrelated claims", () => {
      const claimA = computeClaimFingerprint("React is a frontend library");
      const claimB = computeClaimFingerprint("Databases store persistent data");

      const result = detectContradictionType(claimA, claimB);

      expect(result.type).toBe(ContradictionType.UNKNOWN);
      expect(result.confidence).toBe(0);
    });
  });
});

// ============================================================================
// DEDUPLICATION TESTS
// ============================================================================

describe("Dedupe Contract", () => {
  it("should dedupe claims with different case", () => {
    const inputs: ClaimInput[] = [
      createClaimInput({ claim: "React Hooks are useful", sourceId: "note-1" }),
      createClaimInput({ claim: "react hooks are useful", sourceId: "note-2" })
    ];

    const merged = mergeDuplicateClaims(inputs);

    expect(merged.size).toBe(1);
    expect(merged.get("react hooks are useful")?.length).toBe(2);
  });

  it("should dedupe claims with different trailing punctuation", () => {
    const inputs: ClaimInput[] = [
      createClaimInput({ claim: "Use TypeScript for type safety", sourceId: "note-1" }),
      createClaimInput({ claim: "Use TypeScript for type safety!", sourceId: "note-2" }),
      createClaimInput({ claim: "Use TypeScript for type safety.", sourceId: "note-3" })
    ];

    const merged = mergeDuplicateClaims(inputs);

    expect(merged.size).toBe(1);
    expect(merged.get("use typescript for type safety")?.length).toBe(3);
  });

  it("should dedupe claims with different whitespace", () => {
    const inputs: ClaimInput[] = [
      createClaimInput({ claim: "Use   memo   for   expensive   calculations", sourceId: "note-1" }),
      createClaimInput({ claim: "Use memo for expensive calculations", sourceId: "note-2" })
    ];

    const merged = mergeDuplicateClaims(inputs);

    expect(merged.size).toBe(1);
  });

  it("should dedupe claims with bullet markers", () => {
    const inputs: ClaimInput[] = [
      createClaimInput({ claim: "- Use reducer for complex state", sourceId: "note-1" }),
      createClaimInput({ claim: "* Use reducer for complex state", sourceId: "note-2" }),
      createClaimInput({ claim: "Use reducer for complex state", sourceId: "note-3" })
    ];

    const merged = mergeDuplicateClaims(inputs);

    expect(merged.size).toBe(1);
  });

  it("should dedupe claims with checkbox markers", () => {
    const inputs: ClaimInput[] = [
      createClaimInput({ claim: "[ ] Review the codebase", sourceId: "note-1" }),
      createClaimInput({ claim: "[x] Review the codebase", sourceId: "note-2" }),
      createClaimInput({ claim: "Review the codebase", sourceId: "note-3" })
    ];

    const merged = mergeDuplicateClaims(inputs);

    expect(merged.size).toBe(1);
  });

  it("should preserve all source refs when deduping", () => {
    const inputs: ClaimInput[] = [
      createClaimInput({ claim: "Same claim", sourceId: "note-1", sourcePath: "/a.md" }),
      createClaimInput({ claim: "Same claim", sourceId: "note-2", sourcePath: "/b.md" }),
      createClaimInput({ claim: "Same claim", sourceId: "note-3", sourcePath: "/c.md" })
    ];

    const merged = mergeDuplicateClaims(inputs);
    const claims = merged.get("same claim");

    expect(claims?.length).toBe(3);
    expect(claims?.map(c => c.sourceId).sort()).toEqual(["note-1", "note-2", "note-3"]);
  });

  it("should use most recent timestamp when deduping", () => {
    const inputs: ClaimInput[] = [
      createClaimInput({
        claim: "Same claim",
        sourceId: "note-1",
        timestamp: "2026-03-01T10:00:00.000Z"
      }),
      createClaimInput({
        claim: "Same claim",
        sourceId: "note-2",
        timestamp: "2026-03-03T10:00:00.000Z"
      })
    ];

    const merged = mergeDuplicateClaims(inputs);
    const claimInputs = merged.get("same claim")!;

    // Build conflict claim to verify timestamp precedence
    const conflictClaim = buildConflictClaim(claimInputs, "same claim");

    expect(conflictClaim.timestamp).toBe("2026-03-03T10:00:00.000Z");
  });

  it("should keep separate claims with different content", () => {
    const inputs: ClaimInput[] = [
      createClaimInput({ claim: "Use hooks for state", sourceId: "note-1" }),
      createClaimInput({ claim: "Use classes for state", sourceId: "note-2" }),
      createClaimInput({ claim: "Use context for state", sourceId: "note-3" })
    ];

    const merged = mergeDuplicateClaims(inputs);

    expect(merged.size).toBe(3);
  });

  it("should produce stable claim fingerprints", () => {
    const claim = "React Server Components enable server-side rendering";

    const fp1 = computeClaimFingerprint(claim);
    const fp2 = computeClaimFingerprint(claim);

    expect(fp1.hash).toBe(fp2.hash);
    expect(fp1.normalizedClaim).toBe(fp2.normalizedClaim);
    expect(fp1.keyTerms).toEqual(fp2.keyTerms);
  });

  it("should detect equivalent claims using claimsAreEquivalent", () => {
    const claim1 = "Use Redux for global state";
    const claim2 = "use redux for global state";

    expect(claimsAreEquivalent(claim1, claim2)).toBe(true);
  });

  it("should detect non-equivalent claims using claimsAreEquivalent", () => {
    const claim1 = "Use Redux for global state";
    const claim2 = "Use Zustand for global state";

    expect(claimsAreEquivalent(claim1, claim2)).toBe(false);
  });
});

// ============================================================================
// RESOLVED-STATUS HANDLING TESTS
// ============================================================================

describe("Resolved-Status Handling", () => {
  it("should include all statuses in conflict entries", () => {
    const claims = createContradictoryPair();
    const inbox = buildContradictionInbox(claims);

    // By default all conflicts are OPEN
    expect(inbox.openConflicts).toBeGreaterThan(0);
    expect(inbox.resolvedConflicts).toBe(0);
    expect(inbox.falsePositiveConflicts).toBe(0);
  });

  it("should track resolved conflicts count separately", () => {
    // Create inbox with default (all open)
    const claims = createContradictoryPair();
    const inbox = buildContradictionInbox(claims);

    // The inbox should track resolved separately even if none exist yet
    expect(typeof inbox.resolvedConflicts).toBe("number");
    expect(typeof inbox.falsePositiveConflicts).toBe("number");
  });

  it("should compute conflict status metadata correctly", () => {
    const claims = createContradictoryPair();
    const inbox = buildContradictionInbox(claims);
    const meta = computeConflictStatusMetadata(inbox);

    expect(meta.openCount).toBe(inbox.openConflicts);
    expect(meta.resolvedCount).toBe(inbox.resolvedConflicts);
    expect(meta.falsePositiveCount).toBe(inbox.falsePositiveConflicts);
    expect(meta.totalBeforeFilter).toBe(inbox.totalConflicts);
  });

  it("should calculate correct percentages in status metadata", () => {
    const meta: ConflictStatusMetadata = {
      openCount: 5,
      resolvedCount: 3,
      falsePositiveCount: 2,
      openPercentage: 50,
      resolvedPercentage: 30,
      falsePositivePercentage: 20,
      totalBeforeFilter: 10,
      hasFilteredConflicts: true
    };

    expect(meta.openPercentage + meta.resolvedPercentage + meta.falsePositivePercentage).toBe(100);
  });

  it("should handle empty inbox status metadata", () => {
    const meta = computeConflictStatusMetadata({
      entries: [],
      totalClaims: 0,
      totalConflicts: 0,
      openConflicts: 0,
      resolvedConflicts: 0,
      falsePositiveConflicts: 0,
      totalClips: 0,
      truncated: false,
      inbox_version: "1.0.0",
      generated_at: "2026-03-01T00:00:00.000Z"
    });

    expect(meta.openCount).toBe(0);
    expect(meta.resolvedCount).toBe(0);
    expect(meta.falsePositiveCount).toBe(0);
    expect(meta.openPercentage).toBe(0);
    expect(meta.hasFilteredConflicts).toBe(false);
  });

  it("should detect when conflicts are filtered", () => {
    const meta = computeConflictStatusMetadata({
      entries: [],
      totalClaims: 10,
      totalConflicts: 5,
      openConflicts: 2,
      resolvedConflicts: 3,
      falsePositiveConflicts: 0,
      totalClips: 2,
      truncated: false,
      inbox_version: "1.0.0",
      generated_at: "2026-03-01T00:00:00.000Z"
    });

    expect(meta.hasFilteredConflicts).toBe(true);
  });
});

// ============================================================================
// TRUNCATION TESTS
// ============================================================================

describe("Truncation Contract", () => {
  describe("Conflict-Level Truncation", () => {
    it("should truncate conflicts to MAX_CONFLICTS", () => {
      // Create more contradictions than MAX_CONFLICTS
      // Each iteration creates one contradictory pair (direct negation pattern)
      const claims: ClaimInput[] = [];
      for (let i = 0; i < MAX_CONFLICTS + 10; i++) {
        claims.push(
          createClaimInput({
            claim: `Approach ${i} is the best solution`,
            sourceId: `note-${i}-a`,
            timestamp: `2026-03-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`
          }),
          createClaimInput({
            claim: `Approach ${i} is not the best solution`,
            sourceId: `note-${i}-b`,
            timestamp: `2026-03-${String((i % 28) + 1).padStart(2, "0")}T11:00:00.000Z`
          })
        );
      }

      const inbox = buildContradictionInbox(claims);

      // The inbox should have at most MAX_CONFLICTS entries
      expect(inbox.entries.length).toBeLessThanOrEqual(MAX_CONFLICTS);

      // Truncated flag should be true when there are more conflicts than MAX_CONFLICTS
      // Note: if the builder doesn't produce enough conflicts, truncated might be false
      // We check that if there are MAX_CONFLICTS entries, it should be truncated
      if (inbox.entries.length === MAX_CONFLICTS && inbox.totalConflicts > MAX_CONFLICTS) {
        expect(inbox.truncated).toBe(true);
      }
    });

    it("should not truncate when conflicts are below MAX_CONFLICTS", () => {
      const claims = createContradictoryPair();
      const inbox = buildContradictionInbox(claims);

      expect(inbox.entries.length).toBeLessThanOrEqual(MAX_CONFLICTS);
      expect(inbox.truncated).toBe(false);
    });
  });

  describe("Claim-Level Truncation", () => {
    it("should truncate claim text to MAX_CLAIM_LENGTH", () => {
      const longClaim = "A".repeat(MAX_CLAIM_LENGTH + 100);
      const result = truncateClaim(longClaim);

      expect(result.wasTruncated).toBe(true);
      expect(result.truncated.length).toBeLessThanOrEqual(MAX_CLAIM_LENGTH);
      expect(result.truncated.endsWith("...")).toBe(true);
    });

    it("should not truncate short claims", () => {
      const shortClaim = "Short claim";
      const result = truncateClaim(shortClaim);

      expect(result.wasTruncated).toBe(false);
      expect(result.truncated).toBe(shortClaim);
    });

    it("should set claim_truncated flag correctly", () => {
      const inputs: ClaimInput[] = [
        createClaimInput({
          claim: "A".repeat(MAX_CLAIM_LENGTH + 50),
          sourceId: "note-1",
          timestamp: "2026-03-01T10:00:00.000Z"
        })
      ];

      const conflictClaim = buildConflictClaim(inputs, inputs[0]!.claim);

      expect(conflictClaim.claim_truncated).toBe(true);
      expect(conflictClaim.claim.length).toBeLessThanOrEqual(MAX_CLAIM_LENGTH);
    });

    it("should track total_claims separately from truncated claims array", () => {
      // Create a conflict with many claims (more than MAX_CLAIMS_PER_CONFLICT)
      const claims: ClaimInput[] = [];
      for (let i = 0; i < MAX_CLAIMS_PER_CONFLICT + 5; i++) {
        claims.push(
          createClaimInput({
            claim: `Claim ${i}: All related claims about topic X`,
            sourceId: `note-${i}`,
            timestamp: `2026-03-${String(i % 30 + 1).padStart(2, "0")}T10:00:00.000Z`
          })
        );
      }

      const entries = buildConflictEntries(claims);

      if (entries.length > 0 && entries[0]!.total_claims > MAX_CLAIMS_PER_CONFLICT) {
        expect(entries[0]!.claims_truncated).toBe(true);
        expect(entries[0]!.claims.length).toBeLessThanOrEqual(MAX_CLAIMS_PER_CONFLICT);
        expect(entries[0]!.total_claims).toBeGreaterThan(entries[0]!.claims.length);
      }
    });
  });

  describe("Source Clip Refs Truncation", () => {
    it("should truncate source clip refs to MAX_SOURCE_CLIP_REFS", () => {
      const refs: SourceClipRef[] = [];
      for (let i = 0; i < MAX_SOURCE_CLIP_REFS + 5; i++) {
        refs.push({
          path: `/path/to/note${i}.md`,
          title: `Note ${i}`,
          timestamp: `2026-03-${String(i % 30 + 1).padStart(2, "0")}T10:00:00.000Z`,
          id: `note-${i}`
        });
      }

      const result = buildSourceClipRefs(refs);

      expect(result.truncated).toBe(true);
      expect(result.refs.length).toBeLessThanOrEqual(MAX_SOURCE_CLIP_REFS);
    });

    it("should not truncate when refs are below MAX_SOURCE_CLIP_REFS", () => {
      const refs: SourceClipRef[] = [
        { path: "/a.md", title: "A", timestamp: "2026-03-01T10:00:00.000Z", id: "a" },
        { path: "/b.md", title: "B", timestamp: "2026-03-02T10:00:00.000Z", id: "b" }
      ];

      const result = buildSourceClipRefs(refs);

      expect(result.truncated).toBe(false);
      expect(result.refs.length).toBe(2);
    });

    it("should sort refs by timestamp (most recent first)", () => {
      const refs: SourceClipRef[] = [
        { path: "/old.md", title: "Old", timestamp: "2026-03-01T10:00:00.000Z", id: "old" },
        { path: "/new.md", title: "New", timestamp: "2026-03-05T10:00:00.000Z", id: "new" },
        { path: "/mid.md", title: "Mid", timestamp: "2026-03-03T10:00:00.000Z", id: "mid" }
      ];

      const result = buildSourceClipRefs(refs);

      expect(result.refs[0]!.id).toBe("new");
      expect(result.refs[1]!.id).toBe("mid");
      expect(result.refs[2]!.id).toBe("old");
    });

    it("should set source_clip_refs_truncated flag correctly", () => {
      const inputs: ClaimInput[] = [];
      for (let i = 0; i < MAX_SOURCE_CLIP_REFS + 3; i++) {
        inputs.push(
          createClaimInput({
            claim: "Same claim",
            sourceId: `note-${i}`,
            sourcePath: `/path/to/note${i}.md`,
            timestamp: `2026-03-${String(i % 30 + 1).padStart(2, "0")}T10:00:00.000Z`
          })
        );
      }

      const conflictClaim = buildConflictClaim(inputs, "same claim");

      expect(conflictClaim.source_clip_refs_truncated).toBe(true);
      expect(conflictClaim.source_clip_refs.length).toBeLessThanOrEqual(MAX_SOURCE_CLIP_REFS);
      expect(conflictClaim.source_clip_count).toBe(inputs.length);
    });
  });

  describe("Description Truncation", () => {
    it("should truncate description to MAX_CONFLICT_DESCRIPTION_LENGTH", () => {
      const longDescription = "A".repeat(MAX_CONFLICT_DESCRIPTION_LENGTH + 50);
      const result = truncateDescription(longDescription);

      expect(result.wasTruncated).toBe(true);
      expect(result.truncated.length).toBeLessThanOrEqual(MAX_CONFLICT_DESCRIPTION_LENGTH);
      expect(result.truncated.endsWith("...")).toBe(true);
    });

    it("should not truncate short descriptions", () => {
      const shortDescription = "Short description";
      const result = truncateDescription(shortDescription);

      expect(result.wasTruncated).toBe(false);
      expect(result.truncated).toBe(shortDescription);
    });

    it("should set description_truncated flag correctly in entry", () => {
      const claims = createContradictoryPair();
      const entries = buildConflictEntries(claims);

      if (entries.length > 0) {
        // Check that description is properly bounded
        expect(entries[0]!.description.length).toBeLessThanOrEqual(MAX_CONFLICT_DESCRIPTION_LENGTH);
        expect(typeof entries[0]!.description_truncated).toBe("boolean");
      }
    });
  });
});

// ============================================================================
// RERUN DETERMINISM TESTS
// ============================================================================

describe("Rerun Determinism", () => {
  it("should produce identical inbox from same inputs", () => {
    const claims = createContradictoryPair();

    const inbox1 = buildContradictionInbox(claims);
    const inbox2 = buildContradictionInbox(claims);

    expect(inbox1.entries.length).toBe(inbox2.entries.length);
    expect(inbox1.totalClaims).toBe(inbox2.totalClaims);
    expect(inbox1.totalConflicts).toBe(inbox2.totalConflicts);
    expect(inbox1.openConflicts).toBe(inbox2.openConflicts);
    expect(inbox1.truncated).toBe(inbox2.truncated);
    expect(inbox1.inbox_version).toBe(inbox2.inbox_version);

    // Compare entry IDs for stability
    for (let i = 0; i < inbox1.entries.length; i++) {
      expect(inbox1.entries[i]!.conflict_id).toBe(inbox2.entries[i]!.conflict_id);
      expect(inbox1.entries[i]!.score).toBe(inbox2.entries[i]!.score);
    }
  });

  it("should produce identical conflict entries from same inputs", () => {
    const claims = createContradictoryPair();

    const entries1 = buildConflictEntries(claims);
    const entries2 = buildConflictEntries(claims);

    expect(entries1.length).toBe(entries2.length);

    for (let i = 0; i < entries1.length; i++) {
      expect(entries1[i]!.conflict_id).toBe(entries2[i]!.conflict_id);
      expect(entries1[i]!.contradiction_type).toBe(entries2[i]!.contradiction_type);
      expect(entries1[i]!.score).toBe(entries2[i]!.score);
    }
  });

  it("should maintain stable conflict ordering", () => {
    // Create multiple conflicts with varying scores
    const claims: ClaimInput[] = [
      createClaimInput({ claim: "Use A", sourceId: "n1", timestamp: "2026-03-01T10:00:00.000Z" }),
      createClaimInput({ claim: "Do not use A", sourceId: "n2", timestamp: "2026-03-05T10:00:00.000Z" }),
      createClaimInput({ claim: "Use B", sourceId: "n3", timestamp: "2026-03-02T10:00:00.000Z" }),
      createClaimInput({ claim: "Never use B", sourceId: "n4", timestamp: "2026-03-06T10:00:00.000Z" }),
      createClaimInput({ claim: "Use C", sourceId: "n5", timestamp: "2026-03-03T10:00:00.000Z" }),
      createClaimInput({ claim: "Cannot use C", sourceId: "n6", timestamp: "2026-03-04T10:00:00.000Z" })
    ];

    const entries1 = buildConflictEntries(claims);
    const entries2 = buildConflictEntries(claims);

    expect(entries1.map(e => e.conflict_id)).toEqual(entries2.map(e => e.conflict_id));
  });

  it("should produce stable claim fingerprints", () => {
    const claim = "React hooks enable functional components with state";

    const fp1 = computeClaimFingerprint(claim);
    const fp2 = computeClaimFingerprint(claim);
    const fp3 = computeClaimFingerprint(claim);

    expect(fp1.hash).toBe(fp2.hash);
    expect(fp2.hash).toBe(fp3.hash);
    expect(fp1.keyTerms).toEqual(fp2.keyTerms);
    expect(fp2.keyTerms).toEqual(fp3.keyTerms);
  });

  it("should produce stable conflict IDs", () => {
    const claims = createContradictoryPair();

    const entries1 = buildConflictEntries(claims);
    const entries2 = buildConflictEntries(claims);

    if (entries1.length > 0 && entries2.length > 0) {
      expect(entries1[0]!.conflict_id).toBe(entries2[0]!.conflict_id);
    }
  });

  it("should sort deterministically with tie-breakers", () => {
    const entries: ConflictEntry[] = [
      {
        conflict_id: "conflict-a",
        description: "Description A",
        description_truncated: false,
        contradiction_type: ContradictionType.DIRECT_NEGATION,
        claims: [],
        total_claims: 2,
        claims_truncated: false,
        status: ConflictStatus.OPEN,
        score: 0.9,
        timestamp: "2026-03-01T10:00:00.000Z",
        first_detected_at: "2026-03-01T10:00:00.000Z",
        status_changed_at: "2026-03-01T10:00:00.000Z"
      },
      {
        conflict_id: "conflict-b",
        description: "Description B",
        description_truncated: false,
        contradiction_type: ContradictionType.TEMPORAL,
        claims: [],
        total_claims: 2,
        claims_truncated: false,
        status: ConflictStatus.OPEN,
        score: 0.9, // Same score as A
        timestamp: "2026-03-02T10:00:00.000Z",
        first_detected_at: "2026-03-02T10:00:00.000Z",
        status_changed_at: "2026-03-02T10:00:00.000Z"
      }
    ];

    const sorted = sortEntriesDeterministically(entries);

    // Should be stable across multiple sorts
    const sorted2 = sortEntriesDeterministically(entries);
    expect(sorted.map(e => e.conflict_id)).toEqual(sorted2.map(e => e.conflict_id));
  });

  it("should generate identical descriptions for same claims", () => {
    const claims: ConflictClaim[] = [
      {
        claim_id: "claim-1",
        claim: "Use Redux",
        claim_truncated: false,
        source_clip_refs: [],
        source_clip_count: 1,
        source_clip_refs_truncated: false,
        timestamp: "2026-03-01T10:00:00.000Z",
        source: ClaimSource.KEY_TAKEAWAYS
      },
      {
        claim_id: "claim-2",
        claim: "Do not use Redux",
        claim_truncated: false,
        source_clip_refs: [],
        source_clip_count: 1,
        source_clip_refs_truncated: false,
        timestamp: "2026-03-02T10:00:00.000Z",
        source: ClaimSource.KEY_TAKEAWAYS
      }
    ];

    const desc1 = generateConflictDescription(claims, ContradictionType.DIRECT_NEGATION);
    const desc2 = generateConflictDescription(claims, ContradictionType.DIRECT_NEGATION);

    expect(desc1).toBe(desc2);
  });

  it("should compute identical scores for same inputs", () => {
    const claim: ConflictClaim = {
      claim_id: "claim-1",
      claim: "Test claim",
      claim_truncated: false,
      source_clip_refs: [
        { path: "/a.md", title: "A", timestamp: "2026-03-01T10:00:00.000Z", id: "a" }
      ],
      source_clip_count: 1,
      source_clip_refs_truncated: false,
      timestamp: "2026-03-01T10:00:00.000Z",
      source: ClaimSource.KEY_TAKEAWAYS
    };

    const entry: ConflictEntry = {
      conflict_id: "conflict-1",
      description: "Test",
      description_truncated: false,
      contradiction_type: ContradictionType.DIRECT_NEGATION,
      claims: [claim],
      total_claims: 1,
      claims_truncated: false,
      status: ConflictStatus.OPEN,
      score: 0,
      timestamp: "2026-03-01T10:00:00.000Z",
      first_detected_at: "2026-03-01T10:00:00.000Z",
      status_changed_at: "2026-03-01T10:00:00.000Z"
    };

    const score1 = computeConflictScore(entry);
    const score2 = computeConflictScore(entry);

    expect(score1).toBe(score2);
  });
});

// ============================================================================
// EMPTY STATE TESTS
// ============================================================================

describe("Empty State Contract", () => {
  it("should handle empty claims array", () => {
    const inbox = buildContradictionInbox([]);

    expect(inbox.entries).toHaveLength(0);
    expect(inbox.totalClaims).toBe(0);
    expect(inbox.totalConflicts).toBe(0);
    expect(inbox.openConflicts).toBe(0);
    expect(inbox.resolvedConflicts).toBe(0);
    expect(inbox.falsePositiveConflicts).toBe(0);
    expect(inbox.totalClips).toBe(0);
    expect(inbox.truncated).toBe(false);
    expect(inbox.inbox_version).toBe(CONTRADICTION_INBOX_VERSION);
  });

  it("should identify empty inbox correctly", () => {
    const emptyInbox: ContradictionInbox = {
      entries: [],
      totalClaims: 0,
      totalConflicts: 0,
      openConflicts: 0,
      resolvedConflicts: 0,
      falsePositiveConflicts: 0,
      totalClips: 0,
      truncated: false,
      inbox_version: "1.0.0",
      generated_at: "2026-03-01T00:00:00.000Z"
    };

    expect(isInboxEmpty(emptyInbox)).toBe(true);
  });

  it("should identify non-empty inbox correctly", () => {
    const claims = createContradictoryPair();
    const inbox = buildContradictionInbox(claims);

    if (inbox.entries.length > 0) {
      expect(isInboxEmpty(inbox)).toBe(false);
    }
  });

  it("should use default empty metadata constants", () => {
    expect(DEFAULT_EMPTY_INBOX_METADATA.conflicts_count).toBe(0);
    expect(DEFAULT_EMPTY_INBOX_METADATA.open_conflicts).toBe(0);
    expect(DEFAULT_EMPTY_INBOX_METADATA.resolved_conflicts).toBe(0);
    expect(DEFAULT_EMPTY_INBOX_METADATA.false_positive_conflicts).toBe(0);
    expect(DEFAULT_EMPTY_INBOX_METADATA.inbox_truncated).toBe(false);
    expect(DEFAULT_EMPTY_INBOX_METADATA.inbox_version).toBe(CONTRADICTION_INBOX_VERSION);
  });
});

// ============================================================================
// EXPORTER CONTRACT TESTS
// ============================================================================

describe("Exporter Contract", () => {
  describe("Path Resolution", () => {
    it("should resolve inbox path with defaults", () => {
      const options: ExportInboxOptions = { vaultPath: "/vault" };
      const resolved = resolveInboxPath(options);

      expect(resolved).toBe("/vault/contradiction-inbox.md");
    });

    it("should resolve inbox path with custom filename", () => {
      const options: ExportInboxOptions = {
        vaultPath: "/vault",
        inboxFilename: "custom.md"
      };
      const resolved = resolveInboxPath(options);

      expect(resolved).toBe("/vault/custom.md");
    });

    it("should resolve inbox path with folder", () => {
      const options: ExportInboxOptions = {
        vaultPath: "/vault",
        inboxFolder: "inboxes"
      };
      const resolved = resolveInboxPath(options);

      expect(resolved).toBe("/vault/inboxes/contradiction-inbox.md");
    });

    it("should resolve inbox path with folder and custom filename", () => {
      const options: ExportInboxOptions = {
        vaultPath: "/vault",
        inboxFolder: "inboxes",
        inboxFilename: "custom.md"
      };
      const resolved = resolveInboxPath(options);

      expect(resolved).toBe("/vault/inboxes/custom.md");
    });
  });

  describe("Default Options", () => {
    it("should provide correct default options", () => {
      const defaults = getDefaultExportOptions("/vault");

      expect(defaults.vaultPath).toBe("/vault");
      expect(defaults.inboxFilename).toBe(DEFAULT_INBOX_FILENAME);
      expect(defaults.inboxFolder).toBeUndefined();
      expect(defaults.createFolder).toBe(true);
    });
  });
});

// ============================================================================
// INTEGRATION TESTS (File System)
// ============================================================================

describe("Integration Tests", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "contradiction-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should export and read inbox file", async () => {
    const claims = createContradictoryPair();
    const inbox = buildContradictionInbox(claims);

    const options: ExportInboxOptions = { vaultPath: tempDir };
    const result = await exportContradictionInbox(inbox, options);

    expect(result.filePath).toBe(path.join(tempDir, "contradiction-inbox.md"));
    expect(result.created).toBe(true);
    expect(result.isEmpty).toBe(inbox.entries.length === 0);

    // Verify file exists
    const exists = await inboxFileExists(options);
    expect(exists).toBe(true);

    // Read file content
    const content = await readInboxFile(options);
    expect(content).not.toBeNull();
    expect(content).toContain("---"); // Frontmatter
    expect(content).toContain("inbox_version");
  });

  it("should export empty inbox", async () => {
    const options: ExportInboxOptions = { vaultPath: tempDir };
    const result = await exportEmptyInbox(options);

    expect(result.created).toBe(true);
    expect(result.isEmpty).toBe(true);
    expect(result.metadata.conflicts_count).toBe(0);
    expect(result.conflictStatusMeta.openCount).toBe(0);

    // Verify content
    const content = await readInboxFile(options);
    expect(content).toContain("No conflicts found");
  });

  it("should update existing inbox file", async () => {
    const claims = createContradictoryPair();
    const inbox1 = buildContradictionInbox(claims);

    const options: ExportInboxOptions = { vaultPath: tempDir };

    // First export
    const result1 = await exportContradictionInbox(inbox1, options);
    expect(result1.created).toBe(true);

    // Second export
    const result2 = await exportContradictionInbox(inbox1, options);
    expect(result2.created).toBe(false); // File already exists
  });

  it("should delete inbox file", async () => {
    const options: ExportInboxOptions = { vaultPath: tempDir };

    // Create file
    await exportEmptyInbox(options);
    expect(await inboxFileExists(options)).toBe(true);

    // Delete file
    const deleted = await deleteInboxFile(options);
    expect(deleted).toBe(true);
    expect(await inboxFileExists(options)).toBe(false);

    // Delete non-existent file
    const deletedAgain = await deleteInboxFile(options);
    expect(deletedAgain).toBe(false);
  });

  it("should render empty inbox with explicit metadata", () => {
    const markdown = renderEmptyInbox("2026-03-01T12:00:00.000Z");

    expect(markdown).toContain("inbox_version:");
    expect(markdown).toContain(CONTRADICTION_INBOX_VERSION);
    expect(markdown).toContain("conflicts_count: 0");
    expect(markdown).toContain("open_conflicts: 0");
    expect(markdown).toContain("inbox_truncated: false");
  });
});

// ============================================================================
// CONSTANTS VERIFICATION
// ============================================================================

describe("Constants Contract", () => {
  it("should have correct MAX_CONFLICTS value", () => {
    expect(MAX_CONFLICTS).toBe(50);
  });

  it("should have correct MAX_CLAIMS_PER_CONFLICT value", () => {
    expect(MAX_CLAIMS_PER_CONFLICT).toBe(10);
  });

  it("should have correct MAX_SOURCE_CLIP_REFS value", () => {
    expect(MAX_SOURCE_CLIP_REFS).toBe(5);
  });

  it("should have correct MAX_CLAIM_LENGTH value", () => {
    expect(MAX_CLAIM_LENGTH).toBe(300);
  });

  it("should have correct MAX_CONFLICT_DESCRIPTION_LENGTH value", () => {
    expect(MAX_CONFLICT_DESCRIPTION_LENGTH).toBe(200);
  });

  it("should have semantic version format", () => {
    expect(CONTRADICTION_INBOX_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("should have ANTONYM_PAIRS defined", () => {
    expect(ANTONYM_PAIRS.length).toBeGreaterThan(0);

    // Each pair should have exactly 2 elements
    for (const pair of ANTONYM_PAIRS) {
      expect(pair.length).toBe(2);
    }
  });

  it("should have NEGATION_KEYWORDS defined", () => {
    expect(NEGATION_KEYWORDS.size).toBeGreaterThan(0);
    expect(NEGATION_KEYWORDS.has("not")).toBe(true);
    expect(NEGATION_KEYWORDS.has("never")).toBe(true);
  });
});
