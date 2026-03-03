/**
 * Related Clips Matcher
 *
 * This module provides the main entry point for matching related clips.
 * It integrates vault indexing with the related clips contract to resolve
 * candidate notes and compute related clips for newly clipped content.
 */

import type { ClipResult, ClipMetadata } from "./types";
import type {
  RelatedClipsInput,
  RelatedClipsResult,
  CandidateNote,
  RelatedClipsDiagnostics
} from "./relatedClipsContract";
import {
  computeRelatedClips,
  extractDiagnostics,
  DEFAULT_NO_MATCH_DIAGNOSTICS,
  extractDomain
} from "./relatedClipsContract";
import type {
  VaultIndexOptions,
  VaultIndexResult
} from "./vaultIndex";
import { indexVaultWithCache } from "./vaultIndex";

/**
 * Options for related clips matching
 */
export interface RelatedClipsMatcherOptions {
  /** Vault root directory path */
  vaultPath: string;

  /** Maximum depth to recurse when indexing (0 = unlimited) */
  maxDepth?: number;

  /** Include hidden files/folders (starting with .) */
  includeHidden?: boolean;

  /** Only process files with these tags */
  requiredTags?: string[];

  /** Minimum age filter (only index files modified after this ISO date) */
  minDate?: string;

  /** Maximum files to process (for debugging/testing) */
  maxFiles?: number;

  /** Maximum related clips to return (default: from contract) */
  maxRelatedClips?: number;

  /** Exclude the current note from matching (by path) */
  excludePath?: string;
}

/**
 * Result of related clips matching
 */
export interface RelatedClipsMatcherResult {
  /** Related clips result with diagnostics */
  result: RelatedClipsResult;

  /** Vault index metadata */
  index: {
    candidatesEvaluated: number;
    filesScanned: number;
    filesWithFrontmatter: number;
    filesSkipped: number;
    errors: Array<{ filePath: string; error: string; errorType: string }>;
  };

  /** Matching metadata */
  matching: {
    /** Input metadata used for matching */
    input: {
      sourceUrl: string;
      domain: string;
      contentType: string;
      entitiesCount: number;
      tagsCount: number;
      timestamp: string;
    };
    /** Number of candidates with non-zero score */
    positiveMatches: number;
    /** Whether results were truncated */
    truncated: boolean;
  };
}

/**
 * Convert ClipResult metadata to RelatedClipsInput
 *
 * @param clip - Clip result from content extraction
 * @returns RelatedClipsInput for matching algorithm
 */
export function clipResultToInput(clip: ClipResult): RelatedClipsInput {
  const metadata = clip.metadata || {};

  // Use canonical URL if available, otherwise fall back to URL
  const sourceUrl = metadata.canonicalUrl || metadata.url || clip.url || "";

  // Extract domain
  const domain = extractDomain(sourceUrl);

  // Content type
  const contentType = metadata.type || "article";

  // Entities/keywords (map from metadata.keywords)
  const entities = Array.isArray(metadata.keywords)
    ? metadata.keywords
    : (typeof metadata.keywords === "string"
      ? (metadata.keywords as string).split(",").map((k: string) => k.trim()).filter(Boolean)
      : []);

  // Tags (extract from tags array if available in metadata)
  // Note: tags are typically set during save, not in metadata
  const tags: string[] = [];

  // Timestamp (use current time as clip timestamp)
  const timestamp = new Date().toISOString();

  return {
    sourceUrl,
    domain,
    contentType,
    entities,
    tags,
    timestamp
  };
}

/**
 * Convert ClipMetadata to RelatedClipsInput
 *
 * Useful when you only have metadata without the full ClipResult.
 *
 * @param metadata - Clip metadata
 * @param url - Source URL (fallback if not in metadata)
 * @returns RelatedClipsInput for matching algorithm
 */
export function clipMetadataToInput(
  metadata: ClipMetadata,
  url?: string
): RelatedClipsInput {
  const sourceUrl = metadata.canonicalUrl || metadata.url || url || "";
  const domain = extractDomain(sourceUrl);
  const contentType = metadata.type || "article";

  const entities = Array.isArray(metadata.keywords)
    ? metadata.keywords
    : (typeof metadata.keywords === "string"
      ? (metadata.keywords as string).split(",").map((k: string) => k.trim()).filter(Boolean)
      : []);

  const tags: string[] = [];
  const timestamp = new Date().toISOString();

  return {
    sourceUrl,
    domain,
    contentType,
    entities,
    tags,
    timestamp
  };
}

/**
 * Build RelatedClipsInput from raw values
 *
 * Useful for testing or when you have all the raw data already.
 *
 * @param sourceUrl - Source URL of the clip
 * @param contentType - Content type (article, video, etc.)
 * @param entities - Entities/keywords extracted from content
 * @param tags - Tags assigned to the clip
 * @param timestamp - ISO 8601 timestamp (defaults to now)
 * @returns RelatedClipsInput for matching algorithm
 */
export function buildMatcherInput(
  sourceUrl: string,
  contentType: string,
  entities: string[] = [],
  tags: string[] = [],
  timestamp?: string
): RelatedClipsInput {
  const domain = extractDomain(sourceUrl);

  return {
    sourceUrl,
    domain,
    contentType,
    entities,
    tags,
    timestamp: timestamp || new Date().toISOString()
  };
}

/**
 * Filter out excluded path from candidates
 *
 * @param candidates - Candidate notes
 * @param excludePath - Path to exclude (current note path)
 * @returns Filtered candidates
 */
export function excludeCurrentNote(
  candidates: CandidateNote[],
  excludePath?: string
): CandidateNote[] {
  if (!excludePath) {
    return candidates;
  }

  return candidates.filter((c) => c.path !== excludePath);
}

/**
 * Match related clips for a new clip
 *
 * This is the main entry point for related clips matching. It:
 * 1. Indexes the vault to find candidate notes
 * 2. Converts clip metadata to matching input
 * 3. Computes relatedness scores
 * 4. Returns sorted, truncated results with diagnostics
 *
 * @param clip - Clip result from content extraction
 * @param options - Matcher options (vault path, filters, etc.)
 * @returns RelatedClipsMatcherResult with full details
 *
 * @example
 * ```ts
 * const matcherResult = await matchRelatedClips(clipResult, {
 *   vaultPath: "/Users/t3rpz/Documents/Obsidian Vault",
 *   requiredTags: ["clip"],
 *   maxRelatedClips: 5
 * });
 *
 * console.log(`Found ${matcherResult.result.relatedClips.length} related clips`);
 * console.log(`Top score: ${matcherResult.result.topScore}`);
 * ```
 */
export async function matchRelatedClips(
  clip: ClipResult,
  options: RelatedClipsMatcherOptions
): Promise<RelatedClipsMatcherResult> {
  const {
    maxDepth,
    includeHidden,
    requiredTags,
    minDate,
    maxFiles,
    maxRelatedClips,
    excludePath
  } = options;

  // Convert clip to matching input
  const input = clipResultToInput(clip);

  // Index vault with cache support
  const indexResult: VaultIndexResult = await indexVaultWithCache({
    vaultPath: options.vaultPath,
    maxDepth,
    includeHidden,
    requiredTags,
    minDate,
    maxFiles
  });

  // Filter out excluded path
  const candidates = excludeCurrentNote(
    indexResult.candidates,
    excludePath
  );

  // Compute related clips
  const result: RelatedClipsResult = computeRelatedClips(
    input,
    candidates,
    maxRelatedClips
  );

  // Count positive matches
  const positiveMatches = candidates.filter((c) => {
    const score = computeRelatednessScore(input, c);
    return score.score > 0;
  }).length;

  return {
    result,
    index: {
      candidatesEvaluated: candidates.length,
      filesScanned: indexResult.filesScanned,
      filesWithFrontmatter: indexResult.filesWithFrontmatter,
      filesSkipped: indexResult.filesSkipped,
      errors: indexResult.errors
    },
    matching: {
      input: {
        sourceUrl: input.sourceUrl,
        domain: input.domain,
        contentType: input.contentType,
        entitiesCount: input.entities.length,
        tagsCount: input.tags.length,
        timestamp: input.timestamp
      },
      positiveMatches,
      truncated: result.truncated
    }
  };
}

/**
 * Match related clips from metadata
 *
 * Useful when you only have metadata without the full ClipResult.
 *
 * @param metadata - Clip metadata
 * @param url - Source URL (fallback if not in metadata)
 * @param options - Matcher options
 * @returns RelatedClipsMatcherResult with full details
 */
export async function matchRelatedClipsFromMetadata(
  metadata: ClipMetadata,
  url: string,
  options: RelatedClipsMatcherOptions
): Promise<RelatedClipsMatcherResult> {
  // Build mock clip result from metadata
  const mockClip: ClipResult = {
    url,
    title: metadata.title || "Untitled",
    markdown: "",
    metadata
  };

  return matchRelatedClips(mockClip, options);
}

/**
 * Match related clips from pre-indexed candidates
 *
 * Useful when you've already indexed the vault and want to
 * run matching multiple times with different inputs.
 *
 * @param input - Related clips input
 * @param candidates - Pre-indexed candidate notes
 * @param maxRelatedClips - Maximum related clips to return
 * @param excludePath - Optional path to exclude (current note)
 * @returns RelatedClipsMatcherResult with full details
 */
export async function matchRelatedClipsFromCandidates(
  input: RelatedClipsInput,
  candidates: CandidateNote[],
  maxRelatedClips?: number,
  excludePath?: string
): Promise<RelatedClipsMatcherResult> {
  // Filter out excluded path
  const filteredCandidates = excludeCurrentNote(candidates, excludePath);

  // Compute related clips
  const result: RelatedClipsResult = computeRelatedClips(
    input,
    filteredCandidates,
    maxRelatedClips
  );

  // Count positive matches
  const positiveMatches = filteredCandidates.filter((c) => {
    const score = computeRelatednessScore(input, c);
    return score.score > 0;
  }).length;

  return {
    result,
    index: {
      candidatesEvaluated: filteredCandidates.length,
      filesScanned: 0,
      filesWithFrontmatter: filteredCandidates.length,
      filesSkipped: 0,
      errors: []
    },
    matching: {
      input: {
        sourceUrl: input.sourceUrl,
        domain: input.domain,
        contentType: input.contentType,
        entitiesCount: input.entities.length,
        tagsCount: input.tags.length,
        timestamp: input.timestamp
      },
      positiveMatches,
      truncated: result.truncated
    }
  };
}

/**
 * Get diagnostics from a matcher result
 *
 * Returns the same diagnostics that should be written to frontmatter.
 *
 * @param matcherResult - Result from matchRelatedClips
 * @returns Diagnostics object for frontmatter
 */
export function getMatcherDiagnostics(
  matcherResult: RelatedClipsMatcherResult
): RelatedClipsDiagnostics {
  return extractDiagnostics(matcherResult.result);
}

/**
 * Get diagnostics for no-match case
 *
 * Returns DEFAULT_NO_MATCH_DIAGNOSTICS from the contract.
 *
 * @returns Diagnostics object for frontmatter (no-match)
 */
export function getNoMatchDiagnostics(): RelatedClipsDiagnostics {
  return DEFAULT_NO_MATCH_DIAGNOSTICS;
}

// Import computeRelatednessScore from contract for internal use
function computeRelatednessScore(
  input: RelatedClipsInput,
  candidate: CandidateNote
): { score: number } {
  // Inline scoring logic (same as contract)
  const exactUrl = candidate.sourceUrl === input.sourceUrl ? 100 : 0;
  const sameDomain = candidate.domain === input.domain ? 50 : 0;

  const sharedEntities = input.entities.filter((e) =>
    candidate.entities.map((ce) => ce.toLowerCase()).includes(e.toLowerCase())
  ).length;

  const sharedTags = input.tags.filter((t) =>
    candidate.tags.map((ct) => ct.toLowerCase()).includes(t.toLowerCase())
  ).length;

  const sameContentType = candidate.contentType === input.contentType ? 1 : 0;

  const score = exactUrl + sameDomain + (sharedEntities * 10) + (sharedTags * 5) + sameContentType;

  return { score };
}
