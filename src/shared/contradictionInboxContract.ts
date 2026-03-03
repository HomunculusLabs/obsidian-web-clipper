/**
 * Contradiction Inbox Contract
 *
 * This module defines the contract for the Contradiction Inbox artifact.
 * It specifies how conflicting claims from Key Takeaways and other knowledge
 * surfaces are detected, paired into contradictions, and rendered into a
 * centralized `contradiction-inbox.md` note for triage.
 *
 * Core Goals:
 * - Deterministic: Same inputs always produce same outputs
 * - Stable: Conflict IDs, pairing, and ordering remain consistent across runs
 * - Observable: All behavior is covered by metadata fields
 * - Bounded: Conflict entries are always truncated to a known maximum
 * - Provenance-preserving: Each conflict tracks all source claims with linkbacks
 */

/**
 * Version of the Contradiction Inbox algorithm.
 * Increment this when the fingerprinting logic, contradiction match rules,
 * ranking formula, or truncation policy changes.
 */
export const CONTRADICTION_INBOX_VERSION = "1.0.0" as const;

/**
 * Maximum number of conflicts to include in the inbox.
 * This ensures the inbox note doesn't grow unbounded even when many
 * contradictory claims exist.
 */
export const MAX_CONFLICTS = 50 as const;

/**
 * Maximum number of claims in a single conflict cluster.
 * Contradictions can involve more than two claims (e.g., "X is Y", "X is Z", "X is W").
 */
export const MAX_CLAIMS_PER_CONFLICT = 10 as const;

/**
 * Maximum number of source clip refs per claim entry.
 * Prevents linkback lists from growing excessively.
 */
export const MAX_SOURCE_CLIP_REFS = 5 as const;

/**
 * Maximum length for a claim text.
 * Truncates long claims to keep the inbox file manageable.
 */
export const MAX_CLAIM_LENGTH = 300 as const;

/**
 * Maximum length for conflict description.
 */
export const MAX_CONFLICT_DESCRIPTION_LENGTH = 200 as const;

/**
 * Status of a contradiction in the inbox.
 */
export enum ConflictStatus {
  /** Conflict is open and needs resolution */
  OPEN = "open",
  /** Conflict has been resolved (e.g., one claim marked as authoritative) */
  RESOLVED = "resolved",
  /** Conflict was reviewed and determined to be a false positive (not actually contradictory) */
  FALSE_POSITIVE = "false-positive",
}

/**
 * Contradiction type - how claims conflict.
 */
export enum ContradictionType {
  /** Direct negation (e.g., "X is true" vs "X is false") */
  DIRECT_NEGATION = "direct-negation",
  /** Mutually exclusive attributes (e.g., "X is red" vs "X is blue") */
  MUTUALLY_EXCLUSIVE = "mutually-exclusive",
  /** Temporal contradiction (e.g., "X happened before Y" vs "X happened after Y") */
  TEMPORAL = "temporal",
  /** Quantitative mismatch (e.g., "X has 3 parts" vs "X has 5 parts") */
  QUANTITATIVE = "quantitative",
  /** Unknown/other contradiction pattern */
  UNKNOWN = "unknown",
}

/**
 * Source of a claim (which inbox/surface it came from).
 */
export enum ClaimSource {
  /** From Key Takeaways Inbox */
  KEY_TAKEAWAYS = "key-takeaways",
  /** From Open Questions Inbox */
  OPEN_QUESTIONS = "open-questions",
  /** From clip notes directly */
  CLIP_NOTE = "clip-note",
  /** From manual entry (e.g., added via Knowledge Triage Inbox) */
  MANUAL = "manual",
}

/**
 * Input for a single claim extracted from knowledge surfaces.
 *
 * Claims are the atomic units that can contradict each other.
 * They come from Key Takeaways, Open Questions, or direct clip parsing.
 */
export interface ClaimInput {
  /**
   * The claim text.
   * Should be a declarative statement that can be evaluated for truth.
   */
  claim: string;

  /**
   * The source of this claim.
   */
  source: ClaimSource;

  /**
   * Path to the source note or inbox.
   * Used for linkback rendering.
   */
  sourcePath: string;

  /**
   * Title of the source note or inbox.
   * Used for display in linkbacks.
   */
  sourceTitle: string;

  /**
   * Entry ID within the source (e.g., insight_id, question_id).
   * Used for stable reference to the specific claim.
   */
  entryId: string;

  /**
   * Source URL of the claim (from frontmatter, if available).
   * Used for additional linkback context.
   */
  sourceUrl?: string;

  /**
   * Timestamp when the claim was first captured.
   * Used for ranking and tie-breaking.
   */
  timestamp: string; // ISO 8601 format

  /**
   * Unique identifier for the claim's source.
   * Should be the file path or a stable hash.
   */
  sourceId: string;
}

/**
 * Deterministic fingerprint for a claim.
 *
 * Used for:
 * - Deduplication (same claim from multiple sources)
 * - Contradiction pairing (identifying contradictory claims)
 * - Stable IDs across runs
 */
export interface ClaimFingerprint {
  /**
   * Normalized claim text (lowercase, trimmed, extra whitespace collapsed).
   */
  normalizedClaim: string;

  /**
   * Hash of the normalized claim text.
   * Provides stable, fast equality checks.
   */
  hash: string;

  /**
   * Extracted key terms for contradiction matching.
   * These are normalized nouns/verbs that identify the claim's subject/predicate.
   */
  keyTerms: string[];
}

/**
 * Source clip reference for a claim.
 *
 * Tracks which clips/notes contain this claim.
 */
export interface SourceClipRef {
  /**
   * Path to the source note.
   */
  path: string;

  /**
   * Title of the source note.
   */
  title: string;

  /**
   * Source URL of the note (if available).
   */
  url?: string;

  /**
   * Timestamp when the claim was captured in this source.
   */
  timestamp: string;

  /**
   * Unique ID of the source note.
   */
  id: string;
}

/**
 * A single claim within a conflict entry.
 */
export interface ConflictClaim {
  /**
   * Unique identifier for this claim.
   * Computed as hash of normalized claim text.
   */
  claim_id: string;

  /**
   * The claim text (normalized and truncated if needed).
   */
  claim: string;

  /**
   * Whether the claim text was truncated.
   */
  claim_truncated: boolean;

  /**
   * List of source clips that contain this claim.
   * Sorted by timestamp (most recent first).
   * Truncated to MAX_SOURCE_CLIP_REFS.
   */
  source_clip_refs: SourceClipRef[];

  /**
   * Number of source clips containing this claim (before truncation).
   */
  source_clip_count: number;

  /**
   * Whether the source clip refs list was truncated.
   */
  source_clip_refs_truncated: boolean;

  /**
   * Timestamp of the most recent source clip.
   * Used for conflict ranking.
   */
  timestamp: string;

  /**
   * Where this claim came from.
   */
  source: ClaimSource;
}

/**
 * A single contradiction entry with all information needed for triage.
 */
export interface ConflictEntry {
  /**
   * Unique identifier for this conflict.
   * Computed as hash of sorted claim IDs in the conflict.
   */
  conflict_id: string;

  /**
   * Human-readable description of the conflict.
   * Truncated to MAX_CONFLICT_DESCRIPTION_LENGTH.
   */
  description: string;

  /**
   * Whether the description was truncated.
   */
  description_truncated: boolean;

  /**
   * Type of contradiction detected.
   */
  contradiction_type: ContradictionType;

  /**
   * Claims involved in this conflict.
   * Sorted by timestamp (most recent first).
   * Truncated to MAX_CLAIMS_PER_CONFLICT.
   */
  claims: ConflictClaim[];

  /**
   * Total number of claims in this conflict (before truncation).
   */
  total_claims: number;

  /**
   * Whether the claims list was truncated.
   */
  claims_truncated: boolean;

  /**
   * Current status of this conflict.
   */
  status: ConflictStatus;

  /**
   * Ranking score (higher = more severe/recent conflict).
   * Computed from claim recency, claim frequency, and contradiction type.
   */
  score: number;

  /**
   * Timestamp of the most recent claim in this conflict.
   * Used for sorting.
   */
  timestamp: string;

  /**
   * Timestamp when this conflict was first detected.
   */
  first_detected_at: string;

  /**
   * Timestamp when this conflict's status was last changed.
   */
  status_changed_at: string;
}

/**
 * Complete Contradiction Inbox.
 * Contains all conflicts with truncation already applied.
 */
export interface ContradictionInbox {
  /**
   * The conflict entries, sorted by score (descending).
   * Only includes OPEN and FALSE_POSITIVE conflicts (RESOLVED filtered out).
   * Already truncated to MAX_CONFLICTS.
   */
  entries: ConflictEntry[];

  /**
   * Total number of unique claims found (before deduplication).
   */
  totalClaims: number;

  /**
   * Total number of unique conflicts found (before filtering).
   */
  totalConflicts: number;

  /**
   * Number of open conflicts (after status filtering).
   */
  openConflicts: number;

  /**
   * Number of resolved conflicts (filtered out of inbox).
   */
  resolvedConflicts: number;

  /**
   * Number of false positive conflicts (kept for visibility).
   */
  falsePositiveConflicts: number;

  /**
   * Total number of source clips processed.
   */
  totalClips: number;

  /**
   * Whether the entries list was truncated.
   */
  truncated: boolean;

  /**
   * Version of the inbox generation algorithm used.
   */
  inbox_version: string;

  /**
   * Timestamp when the inbox was generated.
   */
  generated_at: string;
}

/**
 * Frontmatter metadata for the `contradiction-inbox.md` note.
 * These fields are always present, even when the inbox is empty.
 */
export interface InboxMetadata {
  /**
   * Version of the inbox generation algorithm used.
   */
  inbox_version: string;

  /**
   * Number of conflicts included in the inbox.
   */
  conflicts_count: number;

  /**
   * Number of source clips processed to build the inbox.
   */
  source_clips_processed: number;

  /**
   * Total number of unique claims found.
   */
  total_claims: number;

  /**
   * Number of open conflicts.
   */
  open_conflicts: number;

  /**
   * Number of resolved conflicts (filtered out).
   */
  resolved_conflicts: number;

  /**
   * Number of false positive conflicts.
   */
  false_positive_conflicts: number;

  /**
   * Whether the inbox was truncated.
   */
  inbox_truncated: boolean;

  /**
   * Timestamp when the inbox was generated.
   */
  generated_at: string;
}

/**
 * Default metadata for when the inbox is empty.
 */
export const DEFAULT_EMPTY_INBOX_METADATA: InboxMetadata = {
  inbox_version: CONTRADICTION_INBOX_VERSION,
  conflicts_count: 0,
  source_clips_processed: 0,
  total_claims: 0,
  open_conflicts: 0,
  resolved_conflicts: 0,
  false_positive_conflicts: 0,
  inbox_truncated: false,
  generated_at: "",
} as const;

/**
 * Compute a deterministic fingerprint for a claim.
 *
 * Normalization rules:
 * 1. Convert to lowercase
 * 2. Trim leading/trailing whitespace
 * 3. Collapse multiple whitespace characters to single space
 * 4. Remove trailing punctuation (., !, ?, ;, :) unless part of the meaning
 * 5. Remove bullet/checkbox markers (-, *, [ ], [x])
 * 6. Strip markdown links but keep link text (e.g., [[link|path]] -> link)
 * 7. Remove emphasis markers (*, _, **, __) but keep the text
 *
 * Key term extraction:
 * - Extract nouns/verbs (simplified heuristic: words longer than 3 chars)
 * - Filter out common stop words (the, a, an, is, are, was, were, be, been, being, have, has, had, do, does, did, will, would, could, should, may, might, must, shall, can)
 * - Return sorted array of unique key terms
 *
 * The hash is a 64-character hex string using a deterministic FNV-1a variant.
 *
 * @param claim - The original claim text
 * @returns The deterministic fingerprint with key terms
 */
export function computeClaimFingerprint(claim: string): ClaimFingerprint {
  // Common stop words to filter out from key terms
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "to", "from", "in",
    "on", "at", "by", "for", "with", "about", "against", "between", "into",
    "through", "during", "before", "after", "above", "below", "from", "up",
    "down", "in", "out", "on", "off", "over", "under", "again", "further",
    "then", "once", "here", "there", "when", "where", "why", "how", "all",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "and", "but", "if", "or", "because", "as", "until", "while", "of",
  ]);

  // Normalize the claim text
  const normalizedClaim = claim
    .toLowerCase()
    .trim()
    .replace(/^[-*]\s*/, "") // Remove leading bullet markers
    .replace(/^\[[ x]\]\s*/, "") // Remove checkbox markers
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1") // Strip markdown links, keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Strip markdown links with URL
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1") // Remove emphasis markers
    .replace(/\s+/g, " ") // Collapse multiple whitespace
    .replace(/[.,!?;:]+$/, ""); // Remove trailing punctuation

  // Extract key terms (words longer than 3 chars, excluding stop words)
  const words = normalizedClaim.split(/\s+/);
  const keyTermsSet = new Set<string>();
  for (const word of words) {
    const cleanWord = word.replace(/[^a-z0-9]/g, "");
    if (cleanWord.length > 3 && !stopWords.has(cleanWord)) {
      keyTermsSet.add(cleanWord);
    }
  }
  const keyTerms = Array.from(keyTermsSet).sort();

  // Compute deterministic hash (FNV-1a 64-bit variant extended to 256-bit equivalent)
  const hash = computeDeterministicHash(normalizedClaim);

  return {
    normalizedClaim,
    hash,
    keyTerms,
  };
}

/**
 * Compute a deterministic 64-character hex hash from a string.
 *
 * Uses a FNV-1a variant with a 256-bit state to produce a stable hash
 * without requiring async Web Crypto API.
 *
 * @param str - The string to hash
 * @returns 64-character hex string
 */
function computeDeterministicHash(str: string): string {
  // Use four 64-bit FNV-1a hashes in parallel to get 256 bits
  const primes = [0x100000001b3n, 0xcbf29ce484222325n, 0x100000001b3n, 0xcbf29ce484222325n];
  const offsets = [0x811c9dc5n, 0xcbf29ce484222325n, 0x811c9dc5n, 0xcbf29ce484222625n];
  const masks = [0xffffffffffffffffn, 0xffffffffffffffffn, 0xffffffffffffffffn, 0xffffffffffffffffn];

  const chunks: string[] = [];

  for (let i = 0; i < 4; i++) {
    let hash = offsets[i];
    const prime = primes[i];
    const mask = masks[i];

    for (let j = 0; j < str.length; j++) {
      const code = BigInt(str.charCodeAt(j));
      hash = (hash ^ code) & mask;
      hash = (hash * prime) & mask;
    }

    // Convert to 16-char hex string (64-bit -> 16 hex chars)
    const hex = hash.toString(16).padStart(16, "0").slice(-16);
    chunks.push(hex);
  }

  return chunks.join("");
}

/**
 * Check if two claims are semantically equivalent based on fingerprinting.
 *
 * Claims are considered duplicates if:
 * - Their normalized claim texts match exactly, OR
 * - Their hashes match (for pre-computed fingerprints)
 *
 * @param a - First claim fingerprint or text
 * @param b - Second claim fingerprint or text
 * @returns true if the claims are equivalent
 */
export function claimsAreEquivalent(
  a: ClaimFingerprint | string,
  b: ClaimFingerprint | string
): boolean {
  const fingerprintA = typeof a === "string" ? computeClaimFingerprint(a) : a;
  const fingerprintB = typeof b === "string" ? computeClaimFingerprint(b) : b;

  return fingerprintA.hash === fingerprintB.hash;
}

/**
 * Contradiction match rules.
 *
 * Contradictions are detected using deterministic pattern matching without
 * requiring LLM-based semantic analysis. The following rules are applied:
 *
 * 1. DIRECT_NEGATION: Claims that directly negate each other
 *    - Pattern: "X is Y" vs "X is not Y" or "X is not-Y"
 *    - Pattern: "X does Y" vs "X does not Y" or "X never Y"
 *    - Pattern: "X can Y" vs "X cannot Y"
 *    - Keywords: not, never, no, cannot, can't, won't, don't, doesn't, didn't
 *
 * 2. MUTUALLY_EXCLUSIVE: Claims that attribute mutually exclusive values
 *    - Pattern: "X is Y" vs "X is Z" where Y and Z are antonyms
 *    - Color terms: red, blue, green, yellow, black, white, etc.
 *    - Size terms: big, small, large, tiny, huge, microscopic
 *    - Temperature terms: hot, cold, warm, cool, freezing, boiling
 *    - Time terms: always, never, sometimes, often, rarely
 *    - Binary states: enabled, disabled; on, off; true, false; yes, no
 *
 * 3. TEMPORAL: Claims with conflicting temporal ordering
 *    - Pattern: "X before Y" vs "X after Y"
 *    - Pattern: "X precedes Y" vs "X follows Y"
 *    - Keywords: before, after, earlier, later, first, last, prior, subsequent
 *
 * 4. QUANTITATIVE: Claims with conflicting numerical values
 *    - Pattern: "X has N Ys" vs "X has M Ys" where N ≠ M
 *    - Pattern: "X is N units" vs "X is M units" where N ≠ M
 *    - Extracted numbers must be explicitly stated and differ
 *
 * 5. UNKNOWN: Contradictions detected by key term overlap without clear type
 *    - Claims share key terms but have low textual similarity
 *    - Reserved for manual review to determine actual contradiction
 *
 * Contradiction confidence scoring:
 * - DIRECT_NEGATION: 0.9 (high confidence)
 * - MUTUALLY_EXCLUSIVE: 0.8 (high confidence for known antonyms, 0.6 for others)
 * - TEMPORAL: 0.85 (when clear ordering keywords are present)
 * - QUANTITATIVE: 0.9 (when explicit numbers differ)
 * - UNKNOWN: 0.4 (low confidence, requires manual review)
 *
 * Only contradictions with confidence >= 0.6 are included in the inbox.
 */

/**
 * Antonym pairs for mutually exclusive contradiction detection.
 *
 * Used to identify claims that attribute contradictory values to the same subject.
 */
export const ANTONYM_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // Size
  ["big", "small"],
  ["large", "tiny"],
  ["huge", "microscopic"],
  ["large", "small"],
  ["big", "tiny"],

  // Temperature
  ["hot", "cold"],
  ["warm", "cool"],
  ["freezing", "boiling"],

  // Binary states
  ["enabled", "disabled"],
  ["on", "off"],
  ["true", "false"],
  ["yes", "no"],
  ["active", "inactive"],

  // Temporal frequency
  ["always", "never"],
  ["often", "rarely"],
  ["frequently", "seldom"],

  // Directional
  ["up", "down"],
  ["above", "below"],
  ["higher", "lower"],

  // Quality
  ["good", "bad"],
  ["better", "worse"],
  ["best", "worst"],
  ["strong", "weak"],

  // Speed
  ["fast", "slow"],
  ["quick", "slow"],

  // Presence
  ["present", "absent"],
  ["exists", "does not exist"],
  ["available", "unavailable"],

  // Knowledge
  ["known", "unknown"],
  ["certain", "uncertain"],

  // Importance
  ["important", "unimportant"],
  ["critical", "trivial"],

  // Complexity
  ["simple", "complex"],
  ["easy", "difficult"],
] as const;

/**
 * Negation keywords for direct negation detection.
 *
 * Claims containing these keywords after the subject are flagged as negations.
 */
export const NEGATION_KEYWORDS: ReadonlySet<string> = new Set([
  "not",
  "never",
  "no",
  "cannot",
  "can't",
  "won't",
  "don't",
  "doesn't",
  "didn't",
  "cannot",
  "couldn't",
  "shouldn't",
  "wouldn't",
  "might not",
  "may not",
  "must not",
  "shall not",
]);

/**
 * Temporal ordering keywords for temporal contradiction detection.
 */
export const TEMPORAL_ORDERING_KEYWORDS: ReadonlySet<string> = new Set([
  "before",
  "after",
  "earlier",
  "later",
  "preceded",
  "followed",
  "prior",
  "subsequent",
  "first",
  "last",
  "precedes",
  "follows",
]);

/**
 * Detect the type of contradiction between two claims.
 *
 * Returns the contradiction type and confidence score.
 * Returns { type: ContradictionType.UNKNOWN, confidence: 0 } if no contradiction detected.
 *
 * @param claimA - First claim fingerprint
 * @param claimB - Second claim fingerprint
 * @returns Contradiction type and confidence (0-1)
 */
export function detectContradictionType(
  claimA: ClaimFingerprint,
  claimB: ClaimFingerprint
): { type: ContradictionType; confidence: number } {
  const textA = claimA.normalizedClaim;
  const textB = claimB.normalizedClaim;

  // Check for direct negation
  const negationResult = checkDirectNegation(textA, textB);
  if (negationResult.confidence >= 0.6) {
    return negationResult;
  }

  // Check for mutually exclusive attributes
  const mutuallyExclusiveResult = checkMutuallyExclusive(textA, textB);
  if (mutuallyExclusiveResult.confidence >= 0.6) {
    return mutuallyExclusiveResult;
  }

  // Check for temporal contradictions
  const temporalResult = checkTemporalContradiction(textA, textB);
  if (temporalResult.confidence >= 0.6) {
    return temporalResult;
  }

  // Check for quantitative contradictions
  const quantitativeResult = checkQuantitativeContradiction(textA, textB);
  if (quantitativeResult.confidence >= 0.6) {
    return quantitativeResult;
  }

  // Check for unknown contradictions based on key term overlap
  const unknownResult = checkUnknownContradiction(claimA, claimB);
  return unknownResult;
}

/**
 * Check for direct negation between two claims.
 */
function checkDirectNegation(textA: string, textB: string): { type: ContradictionType; confidence: number } {
  // Split into words
  const wordsA = textA.split(/\s+/);
  const wordsB = textB.split(/\s+/);

  // Check if one claim is a negation of the other
  // Simple heuristic: check for negation keywords and similar structure
  const hasNegationA = wordsA.some((w) => NEGATION_KEYWORDS.has(w));
  const hasNegationB = wordsB.some((w) => NEGATION_KEYWORDS.has(w));

  // If both or neither have negation, not a direct negation
  if (hasNegationA === hasNegationB) {
    return { type: ContradictionType.UNKNOWN, confidence: 0 };
  }

  // Compute word overlap (excluding negation keywords)
  const stopWords = new Set(NEGATION_KEYWORDS);
  const wordsANoStop = wordsA.filter((w) => !stopWords.has(w));
  const wordsBNoStop = wordsB.filter((w) => !stopWords.has(w));

  // Count shared non-stop words
  const sharedWords = new Set([...wordsANoStop, ...wordsBNoStop]);
  const intersection = new Set(wordsANoStop.filter((w) => wordsBNoStop.includes(w)));

  // High overlap with negation suggests direct negation
  const overlap = intersection.size / sharedWords.size;
  if (overlap >= 0.5) {
    return { type: ContradictionType.DIRECT_NEGATION, confidence: 0.9 };
  }

  return { type: ContradictionType.UNKNOWN, confidence: 0 };
}

/**
 * Check for mutually exclusive attributes between two claims.
 */
function checkMutuallyExclusive(textA: string, textB: string): { type: ContradictionType; confidence: number } {
  const wordsA = new Set(textA.split(/\s+/).map((w) => w.replace(/[^a-z]/g, "")));
  const wordsB = new Set(textB.split(/\s+/).map((w) => w.replace(/[^a-z]/g, "")));

  // Check if one claim contains one member of an antonym pair
  // and the other contains the other member
  for (const [antonymA, antonymB] of ANTONYM_PAIRS) {
    const hasAInA = wordsA.has(antonymA);
    const hasBInA = wordsA.has(antonymB);
    const hasAInB = wordsB.has(antonymA);
    const hasBInB = wordsB.has(antonymB);

    // Cross presence indicates mutually exclusive
    if ((hasAInA && hasBInB) || (hasBInA && hasAInB)) {
      // High confidence for well-defined antonyms
      return { type: ContradictionType.MUTUALLY_EXCLUSIVE, confidence: 0.8 };
    }
  }

  // Check for general structure "X is Y" vs "X is Z" with low similarity
  // This is lower confidence without known antonyms
  return { type: ContradictionType.UNKNOWN, confidence: 0 };
}

/**
 * Check for temporal contradictions between two claims.
 */
function checkTemporalContradiction(textA: string, textB: string): { type: ContradictionType; confidence: number } {
  const wordsA = textA.split(/\s+/);
  const wordsB = textB.split(/\s+/);

  // Find temporal ordering keywords in each claim
  const temporalA = wordsA.filter((w) => TEMPORAL_ORDERING_KEYWORDS.has(w));
  const temporalB = wordsB.filter((w) => TEMPORAL_ORDERING_KEYWORDS.has(w));

  if (temporalA.length === 0 || temporalB.length === 0) {
    return { type: ContradictionType.UNKNOWN, confidence: 0 };
  }

  // Check for contradictory ordering
  const contradictoryPairs: Array<[string, string]> = [
    ["before", "after"],
    ["after", "before"],
    ["earlier", "later"],
    ["later", "earlier"],
    ["preceded", "followed"],
    ["followed", "preceded"],
    ["precedes", "follows"],
    ["follows", "precedes"],
    ["first", "last"],
    ["last", "first"],
  ];

  for (const [t1, t2] of contradictoryPairs) {
    if (temporalA.includes(t1) && temporalB.includes(t2)) {
      // High confidence when clear temporal keywords are present
      return { type: ContradictionType.TEMPORAL, confidence: 0.85 };
    }
  }

  return { type: ContradictionType.UNKNOWN, confidence: 0 };
}

/**
 * Check for quantitative contradictions between two claims.
 */
function checkQuantitativeContradiction(textA: string, textB: string): { type: ContradictionType; confidence: number } {
  // Extract numbers from claims
  const extractNumbers = (text: string): RegExpMatchArray | null => {
    return text.match(/\b\d+\b/g);
  };

  const numbersA = extractNumbers(textA);
  const numbersB = extractNumbers(textB);

  if (!numbersA || !numbersB || numbersA.length === 0 || numbersB.length === 0) {
    return { type: ContradictionType.UNKNOWN, confidence: 0 };
  }

  // Check if claims have the same subject (key term overlap)
  const keyTermsA = new Set(textA.split(/\s+/).filter((w) => w.length > 3));
  const keyTermsB = new Set(textB.split(/\s+/).filter((w) => w.length > 3));
  const overlap = [...keyTermsA].filter((t) => keyTermsB.has(t)).length;
  const minTerms = Math.min(keyTermsA.size, keyTermsB.size);

  // Need some subject overlap to be about the same thing
  if (overlap < minTerms * 0.3) {
    return { type: ContradictionType.UNKNOWN, confidence: 0 };
  }

  // Compare numbers (simple: first number in each claim)
  const numA = parseInt(numbersA[0]!, 10);
  const numB = parseInt(numbersB[0]!, 10);

  // If numbers differ and claims are about the same subject, likely contradiction
  if (numA !== numB) {
    return { type: ContradictionType.QUANTITATIVE, confidence: 0.9 };
  }

  return { type: ContradictionType.UNKNOWN, confidence: 0 };
}

/**
 * Check for unknown contradictions based on key term overlap.
 */
function checkUnknownContradiction(
  claimA: ClaimFingerprint,
  claimB: ClaimFingerprint
): { type: ContradictionType; confidence: number } {
  // Calculate key term overlap
  const termsA = new Set(claimA.keyTerms);
  const termsB = new Set(claimB.keyTerms);

  const intersection = new Set([...termsA].filter((t) => termsB.has(t)));
  const union = new Set([...termsA, ...termsB]);

  const overlap = intersection.size / union.size;

  // High key term overlap but low textual similarity suggests potential contradiction
  if (overlap >= 0.3 && overlap <= 0.7) {
    // Low confidence - requires manual review
    return { type: ContradictionType.UNKNOWN, confidence: 0.4 };
  }

  return { type: ContradictionType.UNKNOWN, confidence: 0 };
}

/**
 * Compute the ranking score for a conflict entry.
 *
 * Score formula:
 * score = (recencyScore × 40) + (frequencyScore × 30) + (confidenceScore × 20) + (claimCountScore × 10)
 *
 * Where:
 * - recencyScore (0-100): Higher for more recent conflicts
 * - frequencyScore (0-100): Higher for conflicts involving more claims/clip refs
 * - confidenceScore (0-100): Higher for higher-confidence contradiction types
 * - claimCountScore (0-100): Higher for conflicts with more claims
 *
 * Maximum possible score: 100
 *
 * @param entry - The conflict entry to score
 * @returns The ranking score (0-100)
 */
export function computeConflictScore(entry: ConflictEntry): number {
  const now = new Date();
  const mostRecentClaim = new Date(entry.timestamp);
  const daysSinceMostRecent = Math.max(
    0,
    (now.getTime() - mostRecentClaim.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Recency score: decays over 60 days
  const recencyScore = Math.max(0, 100 - (daysSinceMostRecent / 60) * 100);

  // Frequency score: based on total claim and source clip counts
  const totalClipRefs = entry.claims.reduce((sum, c) => sum + c.source_clip_count, 0);
  const frequencyScore = Math.min(100, Math.log1p(totalClipRefs) * 25);

  // Confidence score: based on contradiction type
  const typeConfidence: Record<ContradictionType, number> = {
    [ContradictionType.DIRECT_NEGATION]: 0.9,
    [ContradictionType.MUTUALLY_EXCLUSIVE]: 0.8,
    [ContradictionType.TEMPORAL]: 0.85,
    [ContradictionType.QUANTITATIVE]: 0.9,
    [ContradictionType.UNKNOWN]: 0.4,
  };
  // Map the contradiction type to confidence
  const confidenceScore = typeConfidence[entry.contradiction_type] * 100;

  // Claim count score: more claims = more severe conflict
  const claimCountScore = Math.min(100, (entry.total_claims / 3) * 100);

  // Weighted sum
  const score =
    recencyScore * 0.4 +
    frequencyScore * 0.3 +
    confidenceScore * 0.2 +
    claimCountScore * 0.1;

  return Math.round(score * 100) / 100;
}

/**
 * Deterministic sorting and tie-break rules for conflict entries.
 *
 * Primary sort: score (descending - higher scores first)
 * Secondary sort: timestamp (descending - more recent conflicts first)
 * Tertiary sort: conflict_id (ascending - deterministic fallback)
 * Quaternary sort: total_claims (descending - conflicts with more claims first)
 *
 * This ensures that identical inputs produce identical output order.
 *
 * @param entries - Array of conflict entries to sort
 * @returns Sorted array (does not mutate input)
 */
export function sortEntriesDeterministically(
  entries: ConflictEntry[]
): ConflictEntry[] {
  return [...entries].sort((a, b) => {
    // Primary: score (higher = more severe)
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    // Secondary: timestamp (more recent = higher priority)
    if (a.timestamp !== b.timestamp) {
      return b.timestamp.localeCompare(a.timestamp);
    }

    // Tertiary: conflict_id (ascending for determinism)
    if (a.conflict_id !== b.conflict_id) {
      return a.conflict_id.localeCompare(b.conflict_id);
    }

    // Quaternary: total_claims (more claims = higher priority)
    return b.total_claims - a.total_claims;
  });
}

/**
 * Truncate a claim text to MAX_CLAIM_LENGTH.
 */
export function truncateClaim(claim: string): {
  truncated: string;
  wasTruncated: boolean;
} {
  if (claim.length <= MAX_CLAIM_LENGTH) {
    return { truncated: claim, wasTruncated: false };
  }

  const truncated = claim.slice(0, MAX_CLAIM_LENGTH - 3) + "...";
  return { truncated, wasTruncated: true };
}

/**
 * Truncate a conflict description to MAX_CONFLICT_DESCRIPTION_LENGTH.
 */
export function truncateDescription(description: string): {
  truncated: string;
  wasTruncated: boolean;
} {
  if (description.length <= MAX_CONFLICT_DESCRIPTION_LENGTH) {
    return { truncated: description, wasTruncated: false };
  }

  const truncated = description.slice(0, MAX_CONFLICT_DESCRIPTION_LENGTH - 3) + "...";
  return { truncated, wasTruncated: true };
}

/**
 * Build source clip refs with truncation.
 */
export function buildSourceClipRefs(
  refs: SourceClipRef[]
): {
  refs: SourceClipRef[];
  truncated: boolean;
} {
  const sortedRefs = [...refs].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
  );

  const truncated = sortedRefs.length > MAX_SOURCE_CLIP_REFS;
  const trimmedRefs = sortedRefs.slice(0, MAX_SOURCE_CLIP_REFS);

  return {
    refs: trimmedRefs,
    truncated,
  };
}

/**
 * Build a conflict claim from claim inputs.
 */
export function buildConflictClaim(
  claimInputs: ClaimInput[],
  normalizedClaim: string
): ConflictClaim {
  const claim_id = computeClaimFingerprint(normalizedClaim).hash;

  const { truncated: claimText, wasTruncated: claimTruncated } =
    truncateClaim(normalizedClaim);

  const sourceClipRefs: SourceClipRef[] = claimInputs.map((input) => ({
    path: input.sourcePath,
    title: input.sourceTitle,
    url: input.sourceUrl,
    timestamp: input.timestamp,
    id: input.sourceId,
  }));

  const { refs: trimmedRefs, truncated: refsTruncated } =
    buildSourceClipRefs(sourceClipRefs);

  const mostRecentInput = [...claimInputs].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
  )[0]!;

  return {
    claim_id,
    claim: claimText,
    claim_truncated: claimTruncated,
    source_clip_refs: trimmedRefs,
    source_clip_count: sourceClipRefs.length,
    source_clip_refs_truncated: refsTruncated,
    timestamp: mostRecentInput.timestamp,
    source: mostRecentInput.source,
  };
}

/**
 * Generate a conflict description from claims.
 */
export function generateConflictDescription(
  claims: ConflictClaim[],
  contradictionType: ContradictionType
): string {
  const typeLabels: Record<ContradictionType, string> = {
    [ContradictionType.DIRECT_NEGATION]: "Direct negation",
    [ContradictionType.MUTUALLY_EXCLUSIVE]: "Mutually exclusive",
    [ContradictionType.TEMPORAL]: "Temporal contradiction",
    [ContradictionType.QUANTITATIVE]: "Quantitative mismatch",
    [ContradictionType.UNKNOWN]: "Potential contradiction",
  };

  const claimTexts = claims.map((c) => c.claim).slice(0, 2); // Use first 2 claims for description

  return `${typeLabels[contradictionType]}: "${claimTexts[0]}" vs "${claimTexts[1]}"`;
}

/**
 * Deduplication precedence rules.
 *
 * When the same claim appears in multiple clips/sources:
 * 1. Merge all source clip refs into one conflict claim
 * 2. Use the most recent source's timestamp as the claim's timestamp
 * 3. Use the most recent source's URL as the primary linkback context
 * 4. Preserve the original claim text from the most recent source
 * 5. Source type follows most recent clip's source
 *
 * Dedupe happens BEFORE contradiction detection, so duplicate claims
 * across clips are treated as a single claim.
 */

/**
 * Truncation policy summary.
 *
 * The inbox is bounded at multiple levels:
 *
 * 1. Conflict-level truncation: MAX_CONFLICTS (50)
 *    - Only the top 50 ranked conflicts are included
 *    - Lower-scoring conflicts are dropped
 *    - inbox_truncated = true when truncation occurs
 *
 * 2. Claim-level truncation: MAX_CLAIMS_PER_CONFLICT (10)
 *    - Only the 10 most recent claims are listed per conflict
 *    - claims_truncated = true when truncation occurs
 *    - total_claims preserves the actual count
 *
 * 3. Source clip ref truncation: MAX_SOURCE_CLIP_REFS (5)
 *    - Only the 5 most recent source clips are listed per claim
 *    - source_clip_refs_truncated = true when truncation occurs
 *    - source_clip_count preserves the actual count
 *
 * 4. Claim text truncation: MAX_CLAIM_LENGTH (300)
 *    - Claim text longer than 300 chars is truncated with "..." suffix
 *    - claim_truncated = true when truncation occurs
 *
 * 5. Description truncation: MAX_CONFLICT_DESCRIPTION_LENGTH (200)
 *    - Conflict description longer than 200 chars is truncated
 *    - description_truncated = true when truncation occurs
 *
 * This prevents the inbox note from growing unbounded even for large vaults.
 */

/**
 * Empty state behavior.
 *
 * When no conflicts exist:
 * - The inbox note is still created with frontmatter
 * - conflicts_count = 0, open_conflicts = 0
 * - inbox_truncated = false (nothing to truncate)
 * - Body shows "No conflicts found."
 *
 * When no claims exist:
 * - source_clips_processed = 0, total_claims = 0
 * - All other fields are zero/empty
 * - Note is still created (acts as a placeholder)
 */

/**
 * Diagnostics fields & versioning.
 *
 * All frontmatter metadata fields are always present, even when empty.
 *
 * Required fields:
 * - `inbox_version`: Algorithm version (e.g., "1.0.0")
 * - `conflicts_count`: Number of conflicts included in inbox
 * - `source_clips_processed`: Number of clips scanned for claims
 * - `total_claims`: Total number of unique claims found
 * - `open_conflicts`: Total open conflicts found
 * - `resolved_conflicts`: Total resolved conflicts found (filtered out)
 * - `false_positive_conflicts`: Total false positive conflicts
 * - `inbox_truncated`: Boolean indicating conflict-level truncation
 * - `generated_at`: ISO 8601 timestamp when inbox was generated
 *
 * Versioning contract:
 * - Increment `CONTRADICTION_INBOX_VERSION` when:
 *   - Fingerprinting normalization rules change
 *   - Contradiction match rules change
 *   - Antonym/keyword lists change
 *   - Scoring formulas change
 *   - Sorting/tie-break rules change
 *   - Truncation bounds change
 * - Keep version as semantic string "MAJOR.MINOR.PATCH"
 * - MAJOR: Breaking changes to entry structure/metadata
 * - MINOR: Match rules/scoring/tie-break formula updates
 * - PATCH: Bug fixes with same outputs
 */

/**
 * Integration with save pipeline.
 *
 * The inbox should be regenerated after each clip save:
 * 1. Scan Key Takeaways Inbox for claims/insights
 * 2. Scan Open Questions Inbox for claims/questions
 * 3. Parse clips directly if needed for additional claims
 * 4. Deduplicate claims across sources using fingerprinting
 * 5. Detect contradictions between all claim pairs using match rules
 * 6. Group contradictory claims into conflict clusters
 * 7. Build inbox entries with scores and descriptions
 * 8. Render markdown and save to `contradiction-inbox.md`
 *
 * On failure (e.g., read/parse error):
 * - Log the error
 * - Do not corrupt the existing inbox
 * - Continue with clip save (inbox refresh is non-critical)
 *
 * For deterministic behavior, the inbox generation should use:
 * - Stable fingerprinting for claim deduplication
 * - Stable contradiction detection (no random sampling)
 * - Alphabetical sorting for source file enumeration
 * - Deterministic sorting of conflicts and claims
 */
