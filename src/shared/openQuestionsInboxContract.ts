/**
 * Open Questions Inbox Contract
 *
 * This module defines the contract for the Open Questions Inbox artifact.
 * It specifies how unresolved questions from Clip Brief sections across multiple
 * clips are aggregated, deduplicated, ranked, and rendered into a centralized
 * `open-questions-inbox.md` note.
 *
 * Core Goals:
 * - Deterministic: Same inputs always produce same outputs
 * - Stable: Question IDs, ordering, and linkbacks remain consistent across runs
 * - Observable: All behavior is covered by metadata fields
 * - Bounded: Inbox entries are always truncated to a known maximum
 * - Linkback-preserving: Each question preserves references to all source clips
 */

/**
 * Version of the Open Questions Inbox algorithm.
 * Increment this when the fingerprinting logic, dedupe rules, ranking formula,
 * or truncation policy changes.
 */
export const OPEN_QUESTIONS_INBOX_VERSION = "1.0.0" as const;

/**
 * Maximum number of questions to include in the inbox.
 * This ensures the inbox note doesn't grow unbounded even when many clips exist.
 */
export const MAX_INBOX_QUESTIONS = 100 as const;

/**
 * Maximum number of source clip refs per question entry.
 * Prevents linkback lists from growing excessively.
 */
export const MAX_SOURCE_CLIP_REFS = 10 as const;

/**
 * Status of a question in the inbox.
 */
export enum QuestionStatus {
  /** Question is unresolved and active */
  UNRESOLVED = "unresolved",
  /** Question has been resolved (e.g., marked complete) */
  RESOLVED = "resolved",
}

/**
 * Input for a single open question extracted from a Clip Brief section.
 * This represents one question entry found in a clip's "## Clip Brief" section.
 */
export interface OpenQuestionInput {
  /**
   * The question text.
   * Normalized to lowercase, trimmed whitespace.
   */
  question: string;

  /**
   * Path to the source clip note.
   * Used for linkback rendering.
   */
  clipPath: string;

  /**
   * Title of the source clip note.
   * Used for display in linkbacks.
   */
  clipTitle: string;

  /**
   * Source URL of the clip (from frontmatter).
   * Used for additional linkback context.
   */
  clipUrl: string;

  /**
   * Timestamp when the clip was created.
   * Used for ranking and tie-breaking (more recent = higher priority).
   */
  clipTimestamp: string; // ISO 8601 format

  /**
   * Unique identifier for the source clip.
   * Should be the clip's file path or a stable hash.
   */
  clipId: string;

  /**
   * Current status of this question.
   * Default is UNRESOLVED; RESOLVED questions are filtered out of the inbox.
   */
  status: QuestionStatus;
}

/**
 * Deterministic fingerprint for a question.
 * Used for deduplication across clips.
 */
export interface QuestionFingerprint {
  /**
   * Normalized question text (lowercase, trimmed, extra whitespace collapsed).
   */
  normalizedQuestion: string;

  /**
   * Hash of the normalized question text.
   * Provides stable, fast equality checks.
   */
  hash: string;
}

/**
 * Source clip reference for a question.
 * Tracks which clips contain this same question.
 */
export interface SourceClipRef {
  /**
   * Path to the source clip note.
   */
  path: string;

  /**
   * Title of the source clip note.
   */
  title: string;

  /**
   * Source URL of the clip.
   */
  url: string;

  /**
   * Timestamp when the clip was created.
   */
  timestamp: string;

  /**
   * Unique ID of the source clip.
   */
  id: string;
}

/**
 * A single inbox entry with all information needed to render it.
 */
export interface InboxEntry {
  /**
   * Unique identifier for this question.
   * Computed as hash of normalized question text.
   */
  question_id: string;

  /**
   * The original question text (normalized but preserved).
   */
  question: string;

  /**
   * List of source clips that contain this question.
   * Sorted by timestamp (most recent first).
   * Truncated to MAX_SOURCE_CLIP_REFS.
   */
  source_clip_refs: SourceClipRef[];

  /**
   * Number of source clips containing this question (before truncation).
   */
  source_clip_count: number;

  /**
   * Whether the source clip refs list was truncated.
   */
  source_clip_refs_truncated: boolean;

  /**
   * Current status of this question.
   */
  question_status: QuestionStatus;

  /**
   * Ranking score (higher = higher priority).
   * Computed from clip recency and frequency.
   */
  score: number;

  /**
   * Timestamp of the most recent source clip.
   * Used for sorting.
   */
  timestamp: string;
}

/**
 * Complete Open Questions Inbox.
 * Contains all entries with truncation already applied.
 */
export interface OpenQuestionsInbox {
  /**
   * The inbox entries, sorted by score (descending).
   * Only includes UNRESOLVED questions.
   * Already truncated to MAX_INBOX_QUESTIONS.
   */
  entries: InboxEntry[];

  /**
   * Total number of unique questions found (before filtering).
   */
  totalQuestions: number;

  /**
   * Number of unresolved questions (after status filtering).
   */
  unresolvedQuestions: number;

  /**
   * Number of resolved questions (filtered out of inbox).
   */
  resolvedQuestions: number;

  /**
   * Total number of source clips processed.
   */
  totalClips: number;

  /**
   * Total number of question instances across all clips (before dedupe).
   */
  totalQuestionInstances: number;

  /**
   * Whether the entries list was truncated.
   * true if unresolvedQuestions > MAX_INBOX_QUESTIONS.
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
 * Frontmatter metadata for the `open-questions-inbox.md` note.
 * These fields are always present, even when the inbox is empty.
 */
export interface InboxMetadata {
  /**
   * Version of the inbox generation algorithm used.
   */
  inbox_version: string;

  /**
   * Number of questions included in the inbox.
   * Always present; 0 when no unresolved questions exist.
   */
  questions_count: number;

  /**
   * Number of source clips processed to build the inbox.
   */
  source_clips_processed: number;

  /**
   * Total number of unresolved questions found.
   */
  unresolved_questions: number;

  /**
   * Total number of resolved questions found (filtered out).
   */
  resolved_questions: number;

  /**
   * Whether the inbox was truncated.
   * false when no truncation needed or no questions exist.
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
  inbox_version: OPEN_QUESTIONS_INBOX_VERSION,
  questions_count: 0,
  source_clips_processed: 0,
  unresolved_questions: 0,
  resolved_questions: 0,
  inbox_truncated: false,
  generated_at: "",
} as const;

/**
 * Compute a deterministic fingerprint for a question.
 *
 * Normalization rules:
 * 1. Convert to lowercase
 * 2. Trim leading/trailing whitespace
 * 3. Collapse multiple whitespace characters to single space
 * 4. Remove trailing punctuation (., !, ?, ;, :) unless part of the meaning
 *
 * The hash is a 64-character hex string using a deterministic FNV-1a variant.
 *
 * @param question - The original question text
 * @returns The deterministic fingerprint
 */
export function computeQuestionFingerprint(question: string): QuestionFingerprint {
  // Normalize the question text
  const normalizedQuestion = question
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ") // Collapse multiple whitespace
    .replace(/[.,!?;:]+$/, ""); // Remove trailing punctuation

  // Compute deterministic hash (FNV-1a 64-bit variant extended to 256-bit equivalent)
  const hash = computeDeterministicHash(normalizedQuestion);

  return {
    normalizedQuestion,
    hash,
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
 * Check if two questions are semantically equivalent based on fingerprinting.
 *
 * Questions are considered duplicates if:
 * - Their normalized question texts match exactly, OR
 * - Their hashes match (for pre-computed fingerprints)
 *
 * @param a - First question fingerprint or text
 * @param b - Second question fingerprint or text
 * @returns true if the questions are equivalent
 */
export function questionsAreEquivalent(
  a: QuestionFingerprint | string,
  b: QuestionFingerprint | string
): boolean {
  const fingerprintA = typeof a === "string" ? computeQuestionFingerprint(a) : a;
  const fingerprintB = typeof b === "string" ? computeQuestionFingerprint(b) : b;

  return fingerprintA.hash === fingerprintB.hash;
}

/**
 * Deduplication precedence rules.
 *
 * When the same question appears in multiple clips:
 * 1. Merge all source clip refs into one inbox entry
 * 2. Use the most recent clip's timestamp as the entry's timestamp
 * 3. Use the most recent clip's URL as the primary linkback context
 * 4. Preserve the original question text from the most recent clip
 * 5. Resolve status follows most recent clip's status (UNRESOLVED takes precedence)
 *
 * Dedupe happens BEFORE status filtering, so a question marked RESOLVED
 * in any clip will cause all instances to be considered RESOLVED.
 *
 * This means:
 * - If a question is RESOLVED in one clip and UNRESOLVED in another,
 *   the most recent clip's status wins
 * - If all instances are RESOLVED, the question is filtered out of the inbox
 * - If at least one instance is UNRESOLVED, the question appears in the inbox
 */

/**
 * Compute the ranking score for an inbox entry.
 *
 * Score formula:
 * score = (clipRecencyScore × 50) + (clipFrequencyScore × 30) + (questionLengthScore × 20)
 *
 * Where:
 * - clipRecencyScore (0-100): Higher for more recent clips
 * - clipFrequencyScore (0-100): Higher for questions appearing in more clips
 * - questionLengthScore (0-100): Higher for longer, more specific questions
 *
 * Maximum possible score: 100
 *
 * @param entry - The inbox entry to score
 * @returns The ranking score (0-100)
 */
export function computeEntryScore(entry: InboxEntry): number {
  const now = new Date();
  const mostRecentClip = new Date(entry.timestamp);
  const daysSinceMostRecent = Math.max(
    0,
    (now.getTime() - mostRecentClip.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Recency score: decays over 90 days
  const clipRecencyScore = Math.max(
    0,
    100 - (daysSinceMostRecent / 90) * 100
  );

  // Frequency score: log scale for questions appearing in many clips
  const clipFrequencyScore = Math.min(
    100,
    Math.log1p(entry.source_clip_count) * 30
  );

  // Length score: longer questions are typically more specific
  const questionLengthScore = Math.min(
    100,
    (entry.question.length / 200) * 100
  );

  // Weighted sum
  const score =
    clipRecencyScore * 0.5 +
    clipFrequencyScore * 0.3 +
    questionLengthScore * 0.2;

  return Math.round(score * 100) / 100;
}

/**
 * Deterministic sorting and tie-break rules for inbox entries.
 *
 * Primary sort: score (descending - higher scores first)
 * Secondary sort: timestamp (descending - more recent first)
 * Tertiary sort: question_id (ascending - deterministic fallback)
 * Quaternary sort: source_clip_count (descending - more frequent first)
 *
 * This ensures that identical inputs produce identical output order.
 *
 * @param entries - Array of inbox entries to sort
 * @returns Sorted array (does not mutate input)
 */
export function sortEntriesDeterministically(
  entries: InboxEntry[]
): InboxEntry[] {
  return [...entries].sort((a, b) => {
    // Primary: score (higher = better)
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    // Secondary: timestamp (more recent = better)
    if (a.timestamp !== b.timestamp) {
      return b.timestamp.localeCompare(a.timestamp);
    }

    // Tertiary: question_id (ascending for determinism)
    if (a.question_id !== b.question_id) {
      return a.question_id.localeCompare(b.question_id);
    }

    // Quaternary: source_clip_count (more clips = better)
    return b.source_clip_count - a.source_clip_count;
  });
}

/**
 * Build source clip refs with truncation.
 *
 * Sorts refs by timestamp (most recent first) and truncates to MAX_SOURCE_CLIP_REFS.
 *
 * @param refs - Source clip refs to build
 * @returns Truncated refs list with metadata
 */
export function buildSourceClipRefs(
  refs: SourceClipRef[]
): {
  refs: SourceClipRef[];
  truncated: boolean;
} {
  // Sort by timestamp (most recent first)
  const sortedRefs = [...refs].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
  );

  // Truncate to max refs
  const truncated = sortedRefs.length > MAX_SOURCE_CLIP_REFS;
  const trimmedRefs = sortedRefs.slice(0, MAX_SOURCE_CLIP_REFS);

  return {
    refs: trimmedRefs,
    truncated,
  };
}

/**
 * Build an inbox entry from question inputs.
 *
 * Merges duplicate questions, computes score, and builds source clip refs.
 *
 * @param questionInputs - All inputs for the same question (duplicates merged)
 * @param normalizedQuestion - The normalized question text
 * @returns The inbox entry
 */
export function buildInboxEntry(
  questionInputs: OpenQuestionInput[],
  normalizedQuestion: string
): InboxEntry {
  // Compute question ID (hash of normalized question)
  const question_id = computeQuestionFingerprint(normalizedQuestion).hash;

  // Build source clip refs
  const sourceClipRefs: SourceClipRef[] = questionInputs.map((input) => ({
    path: input.clipPath,
    title: input.clipTitle,
    url: input.clipUrl,
    timestamp: input.clipTimestamp,
    id: input.clipId,
  }));

  const { refs: trimmedRefs, truncated: refsTruncated } =
    buildSourceClipRefs(sourceClipRefs);

  // Use the most recent clip's question text (normalized but preserved)
  const mostRecentInput = [...questionInputs].sort((a, b) =>
    b.clipTimestamp.localeCompare(a.clipTimestamp)
  )[0]!;

  // Determine question status (most recent clip's status takes precedence)
  const questionStatus = mostRecentInput.status;

  // Use the most recent clip's timestamp
  const timestamp = mostRecentInput.clipTimestamp;

  // Build entry
  const entry: InboxEntry = {
    question_id,
    question: normalizedQuestion,
    source_clip_refs: trimmedRefs,
    source_clip_count: sourceClipRefs.length,
    source_clip_refs_truncated: refsTruncated,
    question_status: questionStatus,
    score: 0, // Computed later
    timestamp,
  };

  // Compute score
  entry.score = computeEntryScore(entry);

  return entry;
}

/**
 * Build the complete Open Questions Inbox.
 *
 * This is the main entry point for inbox generation.
 *
 * @param questionInputs - All open questions extracted from clips
 * @returns The complete inbox with metadata
 */
export function buildOpenQuestionsInbox(
  questionInputs: OpenQuestionInput[]
): OpenQuestionsInbox {
  const now = new Date().toISOString();

  // Group questions by fingerprint (deduplication)
  const questionGroups = new Map<string, OpenQuestionInput[]>();

  for (const input of questionInputs) {
    const fingerprint = computeQuestionFingerprint(input.question);
    const key = fingerprint.hash;

    if (!questionGroups.has(key)) {
      questionGroups.set(key, []);
    }

    questionGroups.get(key)!.push(input);
  }

  // Build inbox entries from groups
  let entries: InboxEntry[] = [];
  for (const [hash, inputs] of questionGroups) {
    const entry = buildInboxEntry(inputs, inputs[0]!.question);
    entries.push(entry);
  }

  // Filter out resolved questions
  const unresolvedEntries = entries.filter(
    (e) => e.question_status === QuestionStatus.UNRESOLVED
  );
  const resolvedEntries = entries.filter(
    (e) => e.question_status === QuestionStatus.RESOLVED
  );

  // Sort unresolved entries deterministically
  const sortedEntries = sortEntriesDeterministically(unresolvedEntries);

  // Truncate to max questions
  const truncated = sortedEntries.length > MAX_INBOX_QUESTIONS;
  const trimmedEntries = sortedEntries.slice(0, MAX_INBOX_QUESTIONS);

  // Compute unique clips count
  const uniqueClips = new Set(questionInputs.map((q) => q.clipId));

  // Build result
  const inbox: OpenQuestionsInbox = {
    entries: trimmedEntries,
    totalQuestions: entries.length,
    unresolvedQuestions: unresolvedEntries.length,
    resolvedQuestions: resolvedEntries.length,
    totalClips: uniqueClips.size,
    totalQuestionInstances: questionInputs.length,
    truncated,
    inbox_version: OPEN_QUESTIONS_INBOX_VERSION,
    generated_at: now,
  };

  return inbox;
}

/**
 * Extract metadata from an OpenQuestionsInbox.
 *
 * @param inbox - The inbox
 * @returns Metadata object for frontmatter
 */
export function extractInboxMetadata(inbox: OpenQuestionsInbox): InboxMetadata {
  return {
    inbox_version: inbox.inbox_version,
    questions_count: inbox.entries.length,
    source_clips_processed: inbox.totalClips,
    unresolved_questions: inbox.unresolvedQuestions,
    resolved_questions: inbox.resolvedQuestions,
    inbox_truncated: inbox.truncated,
    generated_at: inbox.generated_at,
  };
}

/**
 * Render the `open-questions-inbox.md` note.
 *
 * Format:
 * ```markdown
 * ---
 * inbox_version: 1.0.0
 * questions_count: 5
 * source_clips_processed: 10
 * unresolved_questions: 5
 * resolved_questions: 3
 * inbox_truncated: false
 * generated_at: 2026-03-03T10:00:00.000Z
 * ---
 *
 * # Open Questions Inbox
 *
 * <!-- Metadata summary -->
 * **Total questions:** 5 | **Source clips:** 10 | **Resolved:** 3
 *
 * <!-- Questions list -->
 * ## Questions
 *
 * ### [1] What is the best approach for...? (score: 85)
 *
 * - **Sources:**
 *   - [[Clip Title|Path/to/clip.md]] (2026-03-01)
 *   - [[Another Clip|Path/to/another.md]] (2026-02-28)
 *
 * - **Status:** Unresolved
 * - **Appears in:** 2 clips
 *
 * ### [2] How should I implement...? (score: 72)
 * ...
 * ```
 *
 * @param inbox - The inbox to render
 * @returns Complete markdown note content
 */
export function renderOpenQuestionsInbox(inbox: OpenQuestionsInbox): string {
  const metadata = extractInboxMetadata(inbox);

  // Build frontmatter
  const frontmatterLines = ["---"];
  frontmatterLines.push(`inbox_version: ${metadata.inbox_version}`);
  frontmatterLines.push(`questions_count: ${metadata.questions_count}`);
  frontmatterLines.push(
    `source_clips_processed: ${metadata.source_clips_processed}`
  );
  frontmatterLines.push(
    `unresolved_questions: ${metadata.unresolved_questions}`
  );
  frontmatterLines.push(
    `resolved_questions: ${metadata.resolved_questions}`
  );
  frontmatterLines.push(`inbox_truncated: ${metadata.inbox_truncated}`);
  frontmatterLines.push(`generated_at: ${metadata.generated_at}`);
  frontmatterLines.push("---");
  frontmatterLines.push("");

  // Build body
  const bodyLines: string[] = [];
  bodyLines.push("# Open Questions Inbox");
  bodyLines.push("");

  // Summary section
  bodyLines.push("## Summary");
  bodyLines.push("");
  bodyLines.push(`**Total questions:** ${metadata.questions_count}`);
  bodyLines.push(`**Source clips:** ${metadata.source_clips_processed}`);
  bodyLines.push(`**Resolved:** ${metadata.resolved_questions}`);
  if (metadata.inbox_truncated) {
    bodyLines.push(`> ⚠️ Inbox truncated to ${MAX_INBOX_QUESTIONS} questions`);
  }
  bodyLines.push("");

  // Questions section
  bodyLines.push("## Questions");
  bodyLines.push("");

  if (inbox.entries.length === 0) {
    bodyLines.push("> No unresolved questions found.");
    bodyLines.push("");
  } else {
    for (let i = 0; i < inbox.entries.length; i++) {
      const entry = inbox.entries[i]!;
      const rank = i + 1;

      bodyLines.push(
        `### [${rank}] ${entry.question} (score: ${entry.score})`
      );
      bodyLines.push("");

      // Source clips
      bodyLines.push("- **Sources:**");
      for (const ref of entry.source_clip_refs) {
        const dateStr = ref.timestamp.split("T")[0]!;
        bodyLines.push(
          `  - [[${ref.title}|${ref.path}]] (${dateStr}) - ${ref.url}`
        );
      }
      if (entry.source_clip_refs_truncated) {
        bodyLines.push(
          `  - ... and ${entry.source_clip_count - MAX_SOURCE_CLIP_REFS} more clips`
        );
      }
      bodyLines.push("");

      // Status
      const statusLabel =
        entry.question_status === QuestionStatus.UNRESOLVED
          ? "Unresolved"
          : "Resolved";
      bodyLines.push(`- **Status:** ${statusLabel}`);
      bodyLines.push(`- **Appears in:** ${entry.source_clip_count} clip(s)`);
      bodyLines.push("");
    }
  }

  // Generated footer
  bodyLines.push("---");
  bodyLines.push("");
  bodyLines.push(
    `*Generated by Obsidian Web Clipper v${metadata.inbox_version} on ${new Date(metadata.generated_at).toLocaleString()}*`
  );
  bodyLines.push("");

  return [...frontmatterLines, ...bodyLines].join("\n");
}

/**
 * Truncation policy summary.
 *
 * The inbox is bounded at two levels:
 *
 * 1. Question-level truncation: MAX_INBOX_QUESTIONS (100)
 *    - Only the top 100 ranked questions are included
 *    - Lower-scoring questions are dropped
 *    - inbox_truncated = true when truncation occurs
 *
 * 2. Source clip ref truncation: MAX_SOURCE_CLIP_REFS (10)
 *    - Only the 10 most recent source clips are listed per question
 *    - source_clip_refs_truncated = true when truncation occurs
 *    - source_clip_count preserves the actual count
 *
 * This prevents the inbox note from growing unbounded even for large vaults.
 */

/**
 * Empty state behavior.
 *
 * When no unresolved questions exist:
 * - The inbox note is still created with frontmatter
 * - questions_count = 0, unresolved_questions = 0
 * - inbox_truncated = false (nothing to truncate)
 * - Body shows "No unresolved questions found."
 *
 * When no clips exist:
 * - source_clips_processed = 0
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
 * - `questions_count`: Number of questions included in inbox
 * - `source_clips_processed`: Number of clips scanned for questions
 * - `unresolved_questions`: Total unresolved questions found
 * - `resolved_questions`: Total resolved questions found
 * - `inbox_truncated`: Boolean indicating question-level truncation
 * - `generated_at`: ISO 8601 timestamp when inbox was generated
 *
 * Versioning contract:
 * - Increment `OPEN_QUESTIONS_INBOX_VERSION` when:
 *   - Fingerprinting normalization rules change
 *   - Dedupe precedence rules change
 *   - Scoring formulas change
 *   - Sorting/tie-break rules change
 *   - Truncation bounds change
 * - Keep version as semantic string "MAJOR.MINOR.PATCH"
 * - MAJOR: Breaking changes to entry structure/metadata
 * - MINOR: Scoring/tie-break/dedupe formula updates
 * - PATCH: Bug fixes with same outputs
 */

/**
 * Integration with save pipeline.
 *
 * The inbox should be regenerated after each clip save:
 * 1. Scan recent clips (configurable time window, e.g., last 30 days)
 * 2. Extract all `Open Questions` from `## Clip Brief` sections
 * 3. Build inbox using buildOpenQuestionsInbox()
 * 4. Render markdown using renderOpenQuestionsInbox()
 * 5. Save/overwrite `open-questions-inbox.md` in the vault
 *
 * On failure (e.g., read/parse error):
 * - Log the error
 * - Do not corrupt the existing inbox
 * - Continue with clip save (inbox refresh is non-critical)
 *
 * For deterministic behavior, the inbox generation should use:
 * - Stable time window for scanning (e.g., fixed days count)
 * - Alphabetical sorting for clip file enumeration
 * - Deterministic parsing of Clip Brief sections
 */
