/**
 * Related Clips Contract
 *
 * This module defines the contract for cross-clip graph linking in the Obsidian Web Clipper.
 * It specifies how newly clipped content is matched against existing vault notes to produce
 * deterministic "Related Clips" backlinks.
 *
 * Core Goals:
 * - Deterministic: Same inputs always produce same outputs
 * - Stable: Ordering and scores remain consistent across runs
 * - Observable: All behavior is covered by frontmatter diagnostics
 * - Bounded: Results are always truncated to a known maximum
 */

/**
 * Version of the related clips matching algorithm.
 * Increment this when the matching logic, scoring formula, or tie-break rules change.
 */
export const RELATED_CLIPS_GRAPH_VERSION = "1.0.0" as const;

/**
 * Maximum number of related clips to include in the "## Related Clips" section.
 * This ensures notes don't grow unbounded even when many matches exist.
 */
export const MAX_RELATED_CLIPS = 5 as const;

/**
 * Match signal types used to compute relatedness scores.
 * Each signal type has a weight contribution to the final score.
 */
export enum MatchSignalType {
  /** Exact source URL match (highest weight) */
  EXACT_URL = "exact_url",
  /** Same domain match */
  SAME_DOMAIN = "same_domain",
  /** Shared entities (keywords, topics, etc.) */
  SHARED_ENTITIES = "shared_entities",
  /** Shared tags from frontmatter */
  SHARED_TAGS = "shared_tags",
  /** Same content type (article, video, etc.) */
  SAME_CONTENT_TYPE = "same_content_type",
}

/**
 * Score weights for each match signal type.
 * Higher values = stronger signal contribution.
 * Weights must be positive integers.
 */
export const MATCH_SIGNAL_WEIGHTS: Readonly<Record<MatchSignalType, number>> = {
  [MatchSignalType.EXACT_URL]: 100,
  [MatchSignalType.SAME_DOMAIN]: 50,
  [MatchSignalType.SHARED_ENTITIES]: 10,
  [MatchSignalType.SHARED_TAGS]: 5,
  [MatchSignalType.SAME_CONTENT_TYPE]: 1,
} as const;

/**
 * Input data for computing related clips.
 * This is what the matcher receives when processing a new clip.
 */
export interface RelatedClipsInput {
  /**
   * Source URL of the newly clipped content.
   * Used for exact URL and same-domain matching.
   */
  sourceUrl: string;

  /**
   * Domain extracted from source URL.
   * Pre-computed to avoid repeated parsing.
   */
  domain: string;

  /**
   * Content type of the clip (article, video, tweet, etc.).
   * Used for same-content-type matching.
   */
  contentType: string;

  /**
   * Entities extracted from the clip content.
   * These are keywords, topics, or named entities that can be shared across clips.
   * Examples: ["typescript", "api", "testing"], ["react", "hooks", "state"]
   */
  entities: string[];

  /**
   * Tags assigned to the clip.
   * Used for shared-tags matching.
   */
  tags: string[];

  /**
   * Timestamp when the clip was created.
   * Used for tie-breaking (more recent = higher priority).
   */
  timestamp: string; // ISO 8601 format
}

/**
 * Candidate note from the vault that may be related to a new clip.
 * This represents an existing note that we're evaluating for relatedness.
 */
export interface CandidateNote {
  /**
   * Path to the note within the vault.
   * Used to construct the markdown link in the related clips section.
   */
  path: string;

  /**
   * Title of the note.
   * Used for display in the related clips section.
   */
  title: string;

  /**
   * Source URL of the note (from frontmatter).
   * May be undefined if the note was manually created.
   */
  sourceUrl?: string;

  /**
   * Domain of the note's source URL.
   * May be undefined if sourceUrl is undefined.
   */
  domain?: string;

  /**
   * Content type of the note (from frontmatter).
   */
  contentType: string;

  /**
   * Entities extracted from the note.
   * May be empty if the note has no entity metadata.
   */
  entities: string[];

  /**
   * Tags of the note (from frontmatter).
   */
  tags: string[];

  /**
   * Timestamp when the note was created.
   * Used for tie-breaking.
   */
  timestamp: string; // ISO 8601 format

  /**
   * Unique identifier for the note.
   * Used to avoid matching a note against itself.
   * This should be the note's path or a stable hash.
   */
  id: string;
}

/**
 * Match signals detected between a new clip and a candidate note.
 * Each signal type contributes to the overall relatedness score.
 */
export interface MatchSignals {
  [MatchSignalType.EXACT_URL]: boolean;
  [MatchSignalType.SAME_DOMAIN]: boolean;
  [MatchSignalType.SHARED_ENTITIES]: number; // Count of shared entities
  [MatchSignalType.SHARED_TAGS]: number; // Count of shared tags
  [MatchSignalType.SAME_CONTENT_TYPE]: boolean;
}

/**
 * Computed relatedness score for a candidate note.
 */
export interface RelatednessScore {
  /**
   * The candidate note this score applies to.
   */
  candidate: CandidateNote;

  /**
   * Overall score (higher = more related).
   * Computed as sum of (signalWeight * signalValue) for all signal types.
   */
  score: number;

  /**
   * Detailed breakdown of match signals.
   */
  signals: MatchSignals;

  /**
   * Timestamp of the candidate note.
   * Used for tie-breaking when scores are equal.
   */
  timestamp: string;

  /**
   * Unique ID of the candidate note.
   */
  id: string;
}

/**
 * Result of computing related clips for a new clip.
 */
export interface RelatedClipsResult {
  /**
   * The related clips, sorted by score (descending).
   * Already truncated to MAX_RELATED_CLIPS.
   */
  relatedClips: RelatedClip[];

  /**
   * Total number of candidate notes evaluated.
   */
  candidatesEvaluated: number;

  /**
   * Total number of matches found (before truncation).
   */
  matchesFound: number;

  /**
   * Whether the results were truncated.
   * true if matchesFound > MAX_RELATED_CLIPS.
   */
  truncated: boolean;

  /**
   * Highest score among all related clips.
   * May be 0 if no matches found.
   */
  topScore: number;

  /**
   * Version of the matching algorithm used.
   */
  graphVersion: string;
}

/**
 * A related clip with all information needed to render it.
 */
export interface RelatedClip {
  /**
   * Path to the related note.
   */
  path: string;

  /**
   * Title of the related note.
   */
  title: string;

  /**
   * Relatedness score (0-100+).
   */
  score: number;

  /**
   * Timestamp of the related note.
   */
  timestamp: string;

  /**
   * Unique ID of the related note.
   */
  id: string;
}

/**
 * Frontmatter diagnostics emitted for every saved clip.
 * These fields are always present, even when no related clips are found.
 */
export interface RelatedClipsDiagnostics {
  /**
   * Number of related clips included in the note.
   * Always present; 0 when no matches found.
   */
  related_clips_count: number;

  /**
   * Highest score among related clips.
   * 0 when no matches found.
   */
  related_clips_top_score: number;

  /**
   * Version of the graph matching algorithm used.
   */
  related_graph_version: string;

  /**
   * Whether the related clips list was truncated.
   * false when no matches found or no truncation needed.
   */
  related_clips_truncated: boolean;
}

/**
 * Default diagnostics for when no related clips are found.
 */
export const DEFAULT_NO_MATCH_DIAGNOSTICS: RelatedClipsDiagnostics = {
  related_clips_count: 0,
  related_clips_top_score: 0,
  related_graph_version: RELATED_CLIPS_GRAPH_VERSION,
  related_clips_truncated: false,
} as const;

/**
 * Compute the relatedness score between a new clip and a candidate note.
 *
 * Score formula:
 * score = Σ (signalWeight × signalValue)
 *
 * Where:
 * - signalWeight is from MATCH_SIGNAL_WEIGHTS
 * - signalValue is 1 for boolean signals, or count for numeric signals
 *
 * @param input - The new clip's input data
 * @param candidate - The candidate note to evaluate
 * @returns The relatedness score with signal breakdown
 */
export function computeRelatednessScore(
  input: RelatedClipsInput,
  candidate: CandidateNote
): RelatednessScore {
  const signals: MatchSignals = {
    [MatchSignalType.EXACT_URL]: candidate.sourceUrl === input.sourceUrl,
    [MatchSignalType.SAME_DOMAIN]: candidate.domain === input.domain,
    [MatchSignalType.SHARED_ENTITIES]: countSharedEntities(
      input.entities,
      candidate.entities
    ),
    [MatchSignalType.SHARED_TAGS]: countSharedTags(input.tags, candidate.tags),
    [MatchSignalType.SAME_CONTENT_TYPE]:
      candidate.contentType === input.contentType,
  };

  const score = computeScoreFromSignals(signals);

  return {
    candidate,
    score,
    signals,
    timestamp: candidate.timestamp,
    id: candidate.id,
  };
}

/**
 * Compute the numeric score from match signals.
 *
 * Formula:
 * score = (exactUrl ? 100 : 0)
 *       + (sameDomain ? 50 : 0)
 *       + (sharedEntities × 10)
 *       + (sharedTags × 5)
 *       + (sameContentType ? 1 : 0)
 *
 * @param signals - Match signals to score
 * @returns The numeric score (non-negative integer)
 */
export function computeScoreFromSignals(signals: MatchSignals): number {
  let score = 0;

  score += signals[MatchSignalType.EXACT_URL]
    ? MATCH_SIGNAL_WEIGHTS[MatchSignalType.EXACT_URL]
    : 0;
  score += signals[MatchSignalType.SAME_DOMAIN]
    ? MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_DOMAIN]
    : 0;
  score +=
    signals[MatchSignalType.SHARED_ENTITIES] *
    MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_ENTITIES];
  score +=
    signals[MatchSignalType.SHARED_TAGS] *
    MATCH_SIGNAL_WEIGHTS[MatchSignalType.SHARED_TAGS];
  score += signals[MatchSignalType.SAME_CONTENT_TYPE]
    ? MATCH_SIGNAL_WEIGHTS[MatchSignalType.SAME_CONTENT_TYPE]
    : 0;

  return score;
}

/**
 * Count the number of shared entities between two sets.
 *
 * @param entitiesA - First set of entities
 * @param entitiesB - Second set of entities
 * @returns Count of shared entities (case-insensitive, deduplicated)
 */
export function countSharedEntities(
  entitiesA: string[],
  entitiesB: string[]
): number {
  const setA = new Set(entitiesA.map((e) => e.toLowerCase().trim()));
  const setB = new Set(entitiesB.map((e) => e.toLowerCase().trim()));

  let sharedCount = 0;
  for (const entity of setA) {
    if (setB.has(entity)) {
      sharedCount++;
    }
  }

  return sharedCount;
}

/**
 * Count the number of shared tags between two sets.
 *
 * @param tagsA - First set of tags
 * @param tagsB - Second set of tags
 * @returns Count of shared tags (case-insensitive, deduplicated)
 */
export function countSharedTags(tagsA: string[], tagsB: string[]): number {
  const setA = new Set(tagsA.map((t) => t.toLowerCase().trim()));
  const setB = new Set(tagsB.map((t) => t.toLowerCase().trim()));

  let sharedCount = 0;
  for (const tag of setA) {
    if (setB.has(tag)) {
      sharedCount++;
    }
  }

  return sharedCount;
}

/**
 * Sort relatedness scores deterministically.
 *
 * Primary sort: score (descending - higher scores first)
 * Secondary sort: timestamp (descending - more recent first)
 * Tertiary sort: id (ascending - deterministic fallback)
 *
 * @param scores - Array of relatedness scores to sort
 * @returns Sorted array (does not mutate input)
 */
export function sortScoresDeterministically(
  scores: RelatednessScore[]
): RelatednessScore[] {
  return [...scores].sort((a, b) => {
    // Primary: score (higher = better)
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    // Secondary: timestamp (more recent = better)
    if (a.timestamp !== b.timestamp) {
      return b.timestamp.localeCompare(a.timestamp);
    }

    // Tertiary: ID (ascending for determinism)
    return a.id.localeCompare(b.id);
  });
}

/**
 * Build related clips from sorted scores, with truncation.
 *
 * @param scores - Sorted array of relatedness scores
 * @param maxClips - Maximum number of clips to include (default: MAX_RELATED_CLIPS)
 * @returns RelatedClipsResult with diagnostics
 */
export function buildRelatedClips(
  scores: RelatednessScore[],
  maxClips: number = MAX_RELATED_CLIPS
): RelatedClipsResult {
  const matchesFound = scores.length;
  const truncated = matchesFound > maxClips;
  const topScore = matchesFound > 0 ? scores[0].score : 0;

  const relatedClips: RelatedClip[] = scores
    .slice(0, maxClips)
    .map(({ candidate, score, timestamp, id }) => ({
      path: candidate.path,
      title: candidate.title,
      score,
      timestamp,
      id,
    }));

  return {
    relatedClips,
    candidatesEvaluated: 0, // Set by caller
    matchesFound,
    truncated,
    topScore,
    graphVersion: RELATED_CLIPS_GRAPH_VERSION,
  };
}

/**
 * Extract diagnostics from a RelatedClipsResult.
 *
 * @param result - The related clips result
 * @returns Diagnostics object for frontmatter
 */
export function extractDiagnostics(
  result: RelatedClipsResult
): RelatedClipsDiagnostics {
  return {
    related_clips_count: result.relatedClips.length,
    related_clips_top_score: result.topScore,
    related_graph_version: result.graphVersion,
    related_clips_truncated: result.truncated,
  };
}

/**
 * Render the "## Related Clips" section markdown.
 *
 * Format:
 * ```markdown
 * ## Related Clips
 *
 * - [[Note Title|Path]] (score: 42)
 * - [[Another Note|Path]] (score: 35)
 * ```
 *
 * @param result - The related clips result
 * @returns Markdown string, or empty string if no related clips
 */
export function renderRelatedClipsSection(result: RelatedClipsResult): string {
  if (result.relatedClips.length === 0) {
    return "";
  }

  const lines: string[] = ["## Related Clips", ""];

  for (const clip of result.relatedClips) {
    // Obsidian wiki-link format: [[Note Title|Path]]
    // This displays "Note Title" but links to "Path"
    lines.push(`- [[${clip.title}|${clip.path}]] (score: ${clip.score})`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Domain parsing utilities.
 */

/**
 * Extract domain from a URL.
 *
 * Examples:
 * - "https://github.com/user/repo" -> "github.com"
 * - "https://docs.example.com/path" -> "docs.example.com"
 * - "https://example.com" -> "example.com"
 *
 * @param url - The URL to parse
 * @returns Domain, or empty string if parsing fails
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return "";
  }
}

/**
 * Normalize a URL for comparison.
 *
 * Removes trailing slashes, fragments, and normalizes protocol.
 * Used for exact URL matching.
 *
 * @param url - The URL to normalize
 * @returns Normalized URL string
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    urlObj.hash = ""; // Remove fragment
    urlObj.search = ""; // Remove query string
    let normalized = urlObj.href;
    // Remove trailing slash
    normalized = normalized.replace(/\/$/, "");
    return normalized;
  } catch {
    return url.trim();
  }
}

/**
 * Compute related clips for a new clip against a set of candidate notes.
 *
 * This is the main entry point for the related clips matching algorithm.
 *
 * @param input - Input data for the new clip
 * @param candidates - Candidate notes from the vault
 * @param maxClips - Maximum clips to include (default: MAX_RELATED_CLIPS)
 * @returns RelatedClipsResult with diagnostics
 */
export function computeRelatedClips(
  input: RelatedClipsInput,
  candidates: CandidateNote[],
  maxClips: number = MAX_RELATED_CLIPS
): RelatedClipsResult {
  // Filter out self-matches (candidate with same ID as input would cause issues)
  // Note: input doesn't have an ID, so we skip this step
  // The caller should ensure candidates don't include the new clip itself

  // Compute scores for all candidates
  const scores: RelatednessScore[] = candidates.map((candidate) =>
    computeRelatednessScore(input, candidate)
  );

  // Filter out zero-score candidates (no meaningful relation)
  const positiveScores = scores.filter((s) => s.score > 0);

  // Sort deterministically
  const sortedScores = sortScoresDeterministically(positiveScores);

  // Build result with truncation
  const result = buildRelatedClips(sortedScores, maxClips);
  result.candidatesEvaluated = candidates.length;

  return result;
}
