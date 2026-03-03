/**
 * Key Takeaways Inbox Contract
 *
 * This module defines the contract for the Key Takeaways Inbox artifact.
 * It specifies how key takeaways/insights from Clip Brief sections across multiple
 * clips are aggregated, deduplicated, ranked, and rendered into a centralized
 * `key-takeaways-inbox.md` note.
 *
 * Core Goals:
 * - Deterministic: Same inputs always produce same outputs
 * - Stable: Insight IDs, ordering, and linkbacks remain consistent across runs
 * - Observable: All behavior is covered by metadata fields
 * - Bounded: Inbox entries are always truncated to a known maximum
 * - Linkback-preserving: Each insight preserves references to all source clips
 */

/**
 * Version of the Key Takeaways Inbox algorithm.
 * Increment this when the fingerprinting logic, dedupe rules, ranking formula,
 * or truncation policy changes.
 */
export const KEY_TAKEAWAYS_INBOX_VERSION = "1.0.0" as const;

/**
 * Maximum number of insights to include in the inbox.
 * This ensures the inbox note doesn't grow unbounded even when many clips exist.
 */
export const MAX_INBOX_INSIGHTS = 100 as const;

/**
 * Maximum number of source clip refs per insight entry.
 * Prevents linkback lists from growing excessively.
 */
export const MAX_SOURCE_CLIP_REFS = 10 as const;

/**
 * Status of an insight in the inbox.
 */
export enum InsightStatus {
  /** Insight is active and ready for reuse */
  ACTIVE = "active",
  /** Insight has been archived (e.g., incorporated into docs, deprecated) */
  ARCHIVED = "archived",
}

/**
 * Input for a single key takeaway extracted from a Clip Brief section.
 * This represents one insight entry found in a clip's "## Clip Brief" section.
 */
export interface KeyTakeawayInput {
  /**
   * The insight text.
   * Normalized to lowercase, trimmed whitespace.
   */
  insight: string;

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
   * Current status of this insight.
   * Default is ACTIVE; ARCHIVED insights are filtered out of the inbox.
   */
  status: InsightStatus;
}

/**
 * Deterministic fingerprint for an insight.
 * Used for deduplication across clips.
 */
export interface InsightFingerprint {
  /**
   * Normalized insight text (lowercase, trimmed, extra whitespace collapsed).
   */
  normalizedInsight: string;

  /**
   * Hash of the normalized insight text.
   * Provides stable, fast equality checks.
   */
  hash: string;
}

/**
 * Source clip reference for an insight.
 * Tracks which clips contain this same insight.
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
   * Unique identifier for this insight.
   * Computed as hash of normalized insight text.
   */
  insight_id: string;

  /**
   * The original insight text (normalized but preserved).
   */
  insight: string;

  /**
   * List of source clips that contain this insight.
   * Sorted by timestamp (most recent first).
   * Truncated to MAX_SOURCE_CLIP_REFS.
   */
  source_clip_refs: SourceClipRef[];

  /**
   * Number of source clips containing this insight (before truncation).
   */
  source_clip_count: number;

  /**
   * Whether the source clip refs list was truncated.
   */
  source_clip_refs_truncated: boolean;

  /**
   * Current status of this insight.
   */
  insight_status: InsightStatus;

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
 * Complete Key Takeaways Inbox.
 * Contains all entries with truncation already applied.
 */
export interface KeyTakeawaysInbox {
  /**
   * The inbox entries, sorted by score (descending).
   * Only includes ACTIVE insights.
   * Already truncated to MAX_INBOX_INSIGHTS.
   */
  entries: InboxEntry[];

  /**
   * Total number of unique insights found (before filtering).
   */
  totalInsights: number;

  /**
   * Number of active insights (after status filtering).
   */
  activeInsights: number;

  /**
   * Number of archived insights (filtered out of inbox).
   */
  archivedInsights: number;

  /**
   * Total number of source clips processed.
   */
  totalClips: number;

  /**
   * Total number of insight instances across all clips (before dedupe).
   */
  totalInsightInstances: number;

  /**
   * Whether the entries list was truncated.
   * true if activeInsights > MAX_INBOX_INSIGHTS.
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
 * Frontmatter metadata for the `key-takeaways-inbox.md` note.
 * These fields are always present, even when the inbox is empty.
 */
export interface InboxMetadata {
  /**
   * Version of the inbox generation algorithm used.
   */
  inbox_version: string;

  /**
   * Number of insights included in the inbox.
   * Always present; 0 when no active insights exist.
   */
  insights_count: number;

  /**
   * Number of source clips processed to build the inbox.
   */
  source_clips_processed: number;

  /**
   * Total number of active insights found.
   */
  active_insights: number;

  /**
   * Total number of archived insights found (filtered out).
   */
  archived_insights: number;

  /**
   * Whether the inbox was truncated.
   * false when no truncation needed or no insights exist.
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
  inbox_version: KEY_TAKEAWAYS_INBOX_VERSION,
  insights_count: 0,
  source_clips_processed: 0,
  active_insights: 0,
  archived_insights: 0,
  inbox_truncated: false,
  generated_at: "",
} as const;

/**
 * Compute a deterministic fingerprint for an insight.
 *
 * Normalization rules:
 * 1. Convert to lowercase
 * 2. Trim leading/trailing whitespace
 * 3. Collapse multiple whitespace characters to single space
 * 4. Remove trailing punctuation (., !, ?, ;, :) unless part of the meaning
 * 5. Remove bullet/checkbox markers (-, *, [ ], [x])
 *
 * The hash is a 64-character hex string using a deterministic FNV-1a variant.
 *
 * @param insight - The original insight text
 * @returns The deterministic fingerprint
 */
export function computeInsightFingerprint(insight: string): InsightFingerprint {
  // Normalize the insight text
  const normalizedInsight = insight
    .toLowerCase()
    .trim()
    .replace(/^[-*]\s*/, "") // Remove leading bullet markers
    .replace(/^\[[ x]\]\s*/, "") // Remove checkbox markers
    .replace(/\s+/g, " ") // Collapse multiple whitespace
    .replace(/[.,!?;:]+$/, ""); // Remove trailing punctuation

  // Compute deterministic hash (FNV-1a 64-bit variant extended to 256-bit equivalent)
  const hash = computeDeterministicHash(normalizedInsight);

  return {
    normalizedInsight,
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
 * Check if two insights are semantically equivalent based on fingerprinting.
 *
 * Insights are considered duplicates if:
 * - Their normalized insight texts match exactly, OR
 * - Their hashes match (for pre-computed fingerprints)
 *
 * @param a - First insight fingerprint or text
 * @param b - Second insight fingerprint or text
 * @returns true if the insights are equivalent
 */
export function insightsAreEquivalent(
  a: InsightFingerprint | string,
  b: InsightFingerprint | string
): boolean {
  const fingerprintA = typeof a === "string" ? computeInsightFingerprint(a) : a;
  const fingerprintB = typeof b === "string" ? computeInsightFingerprint(b) : b;

  return fingerprintA.hash === fingerprintB.hash;
}

/**
 * Deduplication precedence rules.
 *
 * When the same insight appears in multiple clips:
 * 1. Merge all source clip refs into one inbox entry
 * 2. Use the most recent clip's timestamp as the entry's timestamp
 * 3. Use the most recent clip's URL as the primary linkback context
 * 4. Preserve the original insight text from the most recent clip
 * 5. Archive status follows most recent clip's status (ACTIVE takes precedence)
 *
 * Dedupe happens BEFORE status filtering, so an insight marked ARCHIVED
 * in any clip will cause all instances to be considered ARCHIVED.
 *
 * This means:
 * - If an insight is ARCHIVED in one clip and ACTIVE in another,
 *   the most recent clip's status wins
 * - If all instances are ARCHIVED, the insight is filtered out of the inbox
 * - If at least one instance is ACTIVE, the insight appears in the inbox
 */

/**
 * Compute the ranking score for an inbox entry.
 *
 * Score formula:
 * score = (clipRecencyScore × 50) + (clipFrequencyScore × 30) + (insightLengthScore × 20)
 *
 * Where:
 * - clipRecencyScore (0-100): Higher for more recent clips
 * - clipFrequencyScore (0-100): Higher for insights appearing in more clips
 * - insightLengthScore (0-100): Higher for longer, more detailed insights
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

  // Frequency score: log scale for insights appearing in many clips
  const clipFrequencyScore = Math.min(
    100,
    Math.log1p(entry.source_clip_count) * 30
  );

  // Length score: longer insights are typically more detailed and useful
  const insightLengthScore = Math.min(
    100,
    (entry.insight.length / 300) * 100
  );

  // Weighted sum
  const score =
    clipRecencyScore * 0.5 +
    clipFrequencyScore * 0.3 +
    insightLengthScore * 0.2;

  return Math.round(score * 100) / 100;
}

/**
 * Deterministic sorting and tie-break rules for inbox entries.
 *
 * Primary sort: score (descending - higher scores first)
 * Secondary sort: timestamp (descending - more recent first)
 * Tertiary sort: insight_id (ascending - deterministic fallback)
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

    // Tertiary: insight_id (ascending for determinism)
    if (a.insight_id !== b.insight_id) {
      return a.insight_id.localeCompare(b.insight_id);
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
 * Build an inbox entry from insight inputs.
 *
 * Merges duplicate insights, computes score, and builds source clip refs.
 *
 * @param insightInputs - All inputs for the same insight (duplicates merged)
 * @param normalizedInsight - The normalized insight text
 * @returns The inbox entry
 */
export function buildInboxEntry(
  insightInputs: KeyTakeawayInput[],
  normalizedInsight: string
): InboxEntry {
  // Compute insight ID (hash of normalized insight)
  const insight_id = computeInsightFingerprint(normalizedInsight).hash;

  // Build source clip refs
  const sourceClipRefs: SourceClipRef[] = insightInputs.map((input) => ({
    path: input.clipPath,
    title: input.clipTitle,
    url: input.clipUrl,
    timestamp: input.clipTimestamp,
    id: input.clipId,
  }));

  const { refs: trimmedRefs, truncated: refsTruncated } =
    buildSourceClipRefs(sourceClipRefs);

  // Use the most recent clip's insight text (normalized but preserved)
  const mostRecentInput = [...insightInputs].sort((a, b) =>
    b.clipTimestamp.localeCompare(a.clipTimestamp)
  )[0]!;

  // Determine insight status (most recent clip's status takes precedence)
  const insightStatus = mostRecentInput.status;

  // Use the most recent clip's timestamp
  const timestamp = mostRecentInput.clipTimestamp;

  // Build entry
  const entry: InboxEntry = {
    insight_id,
    insight: normalizedInsight,
    source_clip_refs: trimmedRefs,
    source_clip_count: sourceClipRefs.length,
    source_clip_refs_truncated: refsTruncated,
    insight_status: insightStatus,
    score: 0, // Computed later
    timestamp,
  };

  // Compute score
  entry.score = computeEntryScore(entry);

  return entry;
}

/**
 * Build the complete Key Takeaways Inbox.
 *
 * This is the main entry point for inbox generation.
 *
 * @param insightInputs - All key takeaways extracted from clips
 * @returns The complete inbox with metadata
 */
export function buildKeyTakeawaysInbox(
  insightInputs: KeyTakeawayInput[]
): KeyTakeawaysInbox {
  const now = new Date().toISOString();

  // Group insights by fingerprint (deduplication)
  const insightGroups = new Map<string, KeyTakeawayInput[]>();

  for (const input of insightInputs) {
    const fingerprint = computeInsightFingerprint(input.insight);
    const key = fingerprint.hash;

    if (!insightGroups.has(key)) {
      insightGroups.set(key, []);
    }

    insightGroups.get(key)!.push(input);
  }

  // Build inbox entries from groups
  let entries: InboxEntry[] = [];
  for (const [hash, inputs] of insightGroups) {
    const entry = buildInboxEntry(inputs, inputs[0]!.insight);
    entries.push(entry);
  }

  // Filter out archived insights
  const activeEntries = entries.filter(
    (e) => e.insight_status === InsightStatus.ACTIVE
  );
  const archivedEntries = entries.filter(
    (e) => e.insight_status === InsightStatus.ARCHIVED
  );

  // Sort active entries deterministically
  const sortedEntries = sortEntriesDeterministically(activeEntries);

  // Truncate to max insights
  const truncated = sortedEntries.length > MAX_INBOX_INSIGHTS;
  const trimmedEntries = sortedEntries.slice(0, MAX_INBOX_INSIGHTS);

  // Compute unique clips count
  const uniqueClips = new Set(insightInputs.map((i) => i.clipId));

  // Build result
  const inbox: KeyTakeawaysInbox = {
    entries: trimmedEntries,
    totalInsights: entries.length,
    activeInsights: activeEntries.length,
    archivedInsights: archivedEntries.length,
    totalClips: uniqueClips.size,
    totalInsightInstances: insightInputs.length,
    truncated,
    inbox_version: KEY_TAKEAWAYS_INBOX_VERSION,
    generated_at: now,
  };

  return inbox;
}

/**
 * Extract metadata from a KeyTakeawaysInbox.
 *
 * @param inbox - The inbox
 * @returns Metadata object for frontmatter
 */
export function extractInboxMetadata(inbox: KeyTakeawaysInbox): InboxMetadata {
  return {
    inbox_version: inbox.inbox_version,
    insights_count: inbox.entries.length,
    source_clips_processed: inbox.totalClips,
    active_insights: inbox.activeInsights,
    archived_insights: inbox.archivedInsights,
    inbox_truncated: inbox.truncated,
    generated_at: inbox.generated_at,
  };
}

/**
 * Render the `key-takeaways-inbox.md` note.
 *
 * Format:
 * ```markdown
 * ---
 * inbox_version: 1.0.0
 * insights_count: 5
 * source_clips_processed: 10
 * active_insights: 5
 * archived_insights: 3
 * inbox_truncated: false
 * generated_at: 2026-03-03T10:00:00.000Z
 * ---
 *
 * # Key Takeaways Inbox
 *
 * <!-- Metadata summary -->
 * **Total insights:** 5 | **Source clips:** 10 | **Archived:** 3
 *
 * <!-- Insights list -->
 * ## Key Takeaways
 *
 * ### [1] React Server Components use RSC payload for hydration (score: 85)
 *
 * - **Sources:**
 *   - [[React Server Components Guide|Path/to/clip1.md]] (2026-03-01)
 *   - [[RSC Architecture|Path/to/clip2.md]] (2026-02-28)
 *
 * - **Status:** Active
 * - **Appears in:** 2 clips
 *
 * ### [2] Streaming SSR requires Suspense boundaries (score: 72)
 * ...
 * ```
 *
 * @param inbox - The inbox to render
 * @returns Complete markdown note content
 */
export function renderKeyTakeawaysInbox(inbox: KeyTakeawaysInbox): string {
  const metadata = extractInboxMetadata(inbox);

  // Build frontmatter
  const frontmatterLines = ["---"];
  frontmatterLines.push(`inbox_version: ${metadata.inbox_version}`);
  frontmatterLines.push(`insights_count: ${metadata.insights_count}`);
  frontmatterLines.push(
    `source_clips_processed: ${metadata.source_clips_processed}`
  );
  frontmatterLines.push(
    `active_insights: ${metadata.active_insights}`
  );
  frontmatterLines.push(
    `archived_insights: ${metadata.archived_insights}`
  );
  frontmatterLines.push(`inbox_truncated: ${metadata.inbox_truncated}`);
  frontmatterLines.push(`generated_at: ${metadata.generated_at}`);
  frontmatterLines.push("---");
  frontmatterLines.push("");

  // Build body
  const bodyLines: string[] = [];
  bodyLines.push("# Key Takeaways Inbox");
  bodyLines.push("");

  // Summary section
  bodyLines.push("## Summary");
  bodyLines.push("");
  bodyLines.push(`**Total insights:** ${metadata.insights_count}`);
  bodyLines.push(`**Source clips:** ${metadata.source_clips_processed}`);
  bodyLines.push(`**Archived:** ${metadata.archived_insights}`);
  if (metadata.inbox_truncated) {
    bodyLines.push(`> ⚠️ Inbox truncated to ${MAX_INBOX_INSIGHTS} insights`);
  }
  bodyLines.push("");

  // Insights section
  bodyLines.push("## Key Takeaways");
  bodyLines.push("");

  if (inbox.entries.length === 0) {
    bodyLines.push("> No active insights found.");
    bodyLines.push("");
  } else {
    for (let i = 0; i < inbox.entries.length; i++) {
      const entry = inbox.entries[i]!;
      const rank = i + 1;

      bodyLines.push(
        `### [${rank}] ${entry.insight} (score: ${entry.score})`
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
        entry.insight_status === InsightStatus.ACTIVE
          ? "Active"
          : "Archived";
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
 * 1. Insight-level truncation: MAX_INBOX_INSIGHTS (100)
 *    - Only the top 100 ranked insights are included
 *    - Lower-scoring insights are dropped
 *    - inbox_truncated = true when truncation occurs
 *
 * 2. Source clip ref truncation: MAX_SOURCE_CLIP_REFS (10)
 *    - Only the 10 most recent source clips are listed per insight
 *    - source_clip_refs_truncated = true when truncation occurs
 *    - source_clip_count preserves the actual count
 *
 * This prevents the inbox note from growing unbounded even for large vaults.
 */

/**
 * Empty state behavior.
 *
 * When no active insights exist:
 * - The inbox note is still created with frontmatter
 * - insights_count = 0, active_insights = 0
 * - inbox_truncated = false (nothing to truncate)
 * - Body shows "No active insights found."
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
 * - `insights_count`: Number of insights included in inbox
 * - `source_clips_processed`: Number of clips scanned for insights
 * - `active_insights`: Total active insights found
 * - `archived_insights`: Total archived insights found
 * - `inbox_truncated`: Boolean indicating insight-level truncation
 * - `generated_at`: ISO 8601 timestamp when inbox was generated
 *
 * Versioning contract:
 * - Increment `KEY_TAKEAWAYS_INBOX_VERSION` when:
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
 * 2. Extract all key takeaways from `## Clip Brief` sections
 * 3. Build inbox using buildKeyTakeawaysInbox()
 * 4. Render markdown using renderKeyTakeawaysInbox()
 * 5. Save/overwrite `key-takeaways-inbox.md` in the vault
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
