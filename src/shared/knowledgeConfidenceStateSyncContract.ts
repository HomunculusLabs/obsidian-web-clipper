/**
 * Knowledge Confidence State Sync Contract
 *
 * This module defines the contract for the Knowledge Confidence State Sync artifact.
 * It specifies how confidence status edits from the confidence inbox are reconciled
 * and persisted to source references, ensuring previously triaged low-confidence items
 * do not resurface on subsequent refreshes.
 *
 * Core Goals:
 * - Deterministic: Same inputs always produce same outputs
 * - Stable: Confidence item IDs and status mappings remain consistent across runs
 * - Observable: All behavior is covered by metadata fields
 * - Bounded: Sync entries are always truncated to a known maximum
 * - Precedence-aware: Source ref status follows clear conflict resolution rules
 */

/**
 * Version of the Knowledge Confidence State Sync algorithm.
 * Increment this when the fingerprinting logic, status reconciliation rules,
 * writeback policy, or truncation policy changes.
 */
export const CONFIDENCE_STATE_SYNC_VERSION = "1.0.0" as const;

/**
 * Maximum number of confidence items to include in the state sync.
 * This ensures the sync note doesn't grow unbounded even for large vaults.
 */
export const MAX_CONFIDENCE_ITEMS = 500 as const;

/**
 * Maximum number of source refs per confidence item.
 * Prevents source ref lists from growing excessively.
 */
export const MAX_SOURCE_REFS = 20 as const;

/**
 * Maximum length for a confidence item description.
 * Truncates long descriptions to keep the sync file manageable.
 */
export const MAX_DESCRIPTION_LENGTH = 500 as const;

/**
 * Confidence status enum.
 *
 * Status lifecycle for confidence triage:
 * - unverified: Item has not been verified (default for new low-confidence items)
 * - verified: Item has been verified as accurate
 * - rejected: Item has been rejected as inaccurate (filtered out of confidence views)
 * - deferred: Item is deferred for later verification
 */
export enum ConfidenceStatus {
  /** Item has not been verified (default for low-confidence items) */
  UNVERIFIED = "unverified",
  /** Item has been verified as accurate */
  VERIFIED = "verified",
  /** Item has been rejected as inaccurate (excluded from confidence views) */
  REJECTED = "rejected",
  /** Item is deferred for later verification */
  DEFERRED = "deferred",
}

/**
 * Source type for confidence items.
 *
 * Different artifact types can contain confidence-triageable items.
 */
export enum SourceType {
  /** Key Takeaways Inbox - actionable insights */
  KEY_TAKEAWAYS = "key-takeaways",
  /** Open Questions Inbox - unresolved research questions */
  OPEN_QUESTIONS = "open-questions",
  /** Execution Backlog Inbox - actionable tasks */
  EXECUTION_BACKLOG = "execution-backlog",
  /** Clip Recovery Inbox - rescued items from failed clips */
  CLIP_RECOVERY = "clip-recovery",
  /** Knowledge Triage Inbox - manually triaged items */
  KNOWLEDGE_TRIAGE = "knowledge-triage",
  /** Contradiction Inbox - conflicting claims */
  CONTRADICTION = "contradiction",
  /** Evidence Gap Inbox - missing information gaps */
  EVIDENCE_GAP = "evidence-gap",
  /** Direct from clip notes */
  CLIP = "clip",
}

/**
 * Status source - where a confidence status change originated.
 */
export enum StatusSource {
  /** Status was derived from source artifact (implicit status) */
  ARTIFACT = "artifact",
  /** Status was set manually in the Knowledge Confidence Inbox */
  MANUAL = "manual",
  /** Status was inferred from pattern heuristics (e.g., auto-verified based on frequency) */
  INFERRED = "inferred",
  /** Status was set by automated workflow/script */
  AUTOMATED = "automated",
}

/**
 * Input for a single confidence item from a source artifact.
 *
 * This represents one item that can have its confidence triaged.
 */
export interface ConfidenceItemInput {
  /**
   * The item description (insight, question, task, claim, etc.).
   * Normalized to lowercase, trimmed whitespace.
   */
  description: string;

  /**
   * The source type this item came from.
   */
  sourceType: SourceType;

  /**
   * Path to the source artifact note.
   * Used for linkback rendering and writeback.
   */
  artifactPath: string;

  /**
   * Title of the source artifact note.
   * Used for display in linkbacks.
   */
  artifactTitle: string;

  /**
   * Entry ID within the source artifact (e.g., insight_id, question_id, claim_id).
   * Used for stable reference to the specific item.
   */
  entryId: string;

  /**
   * Source URL or context for the item (optional).
   * Used for additional linkback context.
   */
  sourceUrl?: string;

  /**
   * Timestamp when the item was first seen.
   * Used for sorting and tie-breaking.
   */
  firstSeenAt: string; // ISO 8601 format

  /**
   * Timestamp when the item was last updated in the source artifact.
   * Used for precedence and freshness checks.
   */
  lastSeenAt: string; // ISO 8601 format

  /**
   * Current status from the source artifact (if available).
   * Default is UNVERIFIED (all items start as unverified).
   */
  status: ConfidenceStatus;

  /**
   * Where this status came from (default is ARTIFACT).
   */
  statusSource: StatusSource;

  /**
   * Timestamp when this status was last changed.
   */
  statusChangedAt: string; // ISO 8601 format

  /**
   * Original confidence score (0-1) from source, if available.
   * Used for confidence-band filtering and triage prioritization.
   */
  confidenceScore?: number;
}

/**
 * Deterministic fingerprint for a confidence item.
 *
 * Items are considered the same if their normalized descriptions match,
 * regardless of which source artifact they came from. This enables
 * cross-artifact confidence triage - marking an item as verified in one
 * source marks it verified everywhere.
 */
export interface ConfidenceItemFingerprint {
  /**
   * Normalized description (lowercase, trimmed, extra whitespace collapsed).
   */
  normalizedDescription: string;

  /**
   * Hash of the normalized description.
   * Provides stable, fast equality checks.
   */
  hash: string;
}

/**
 * Source artifact reference for a confidence item.
 *
 * Tracks which artifacts contain this item and its status in each.
 */
export interface SourceArtifactRef {
  /**
   * The source artifact type.
   */
  sourceType: SourceType;

  /**
   * Path to the artifact note.
   */
  artifactPath: string;

  /**
   * Title of the artifact note.
   */
  artifactTitle: string;

  /**
   * Entry ID within the artifact.
   */
  entryId: string;

  /**
   * Source URL or context for the item (optional).
   */
  sourceUrl?: string;

  /**
   * Timestamp when this item was first seen in this artifact.
   */
  firstSeenAt: string;

  /**
   * Timestamp when this item was last updated in this artifact.
   */
  lastSeenAt: string;

  /**
   * Current status from this artifact.
   */
  status: ConfidenceStatus;

  /**
   * Where this status came from.
   */
  statusSource: StatusSource;

  /**
   * Timestamp when this status was last changed.
   */
  statusChangedAt: string;

  /**
   * Original confidence score from this artifact (0-1), if available.
   */
  confidenceScore?: number;
}

/**
 * A single confidence state sync entry with all information needed for reconciliation.
 */
export interface ConfidenceStateEntry {
  /**
   * Unique identifier for this confidence item.
   * Computed as hash of normalized description.
   */
  confidence_item_id: string;

  /**
   * The item description (normalized and truncated if needed).
   */
  description: string;

  /**
   * Whether the description was truncated.
   */
  description_truncated: boolean;

  /**
   * Current confidence status (the authoritative status after reconciliation).
   */
  status: ConfidenceStatus;

  /**
   * Where the current status came from.
   */
  status_source: StatusSource;

  /**
   * Timestamp when the status was last changed.
   */
  status_changed_at: string;

  /**
   * List of source artifact references for this item.
   * Sorted by lastSeenAt (most recent first).
   * Truncated to MAX_SOURCE_REFS.
   */
  source_refs: SourceArtifactRef[];

  /**
   * Total number of source artifacts containing this item (before truncation).
   */
  source_artifact_count: number;

  /**
   * Whether the source refs list was truncated.
   */
  source_refs_truncated: boolean;

  /**
   * Timestamp when this item was first seen (oldest source ref).
   */
  first_seen_at: string;

  /**
   * Timestamp when this item was last updated (newest source ref).
   */
  last_seen_at: string;

  /**
   * Number of times this item has appeared in artifacts.
   */
  occurrence_count: number;

  /**
   * Original confidence score from source (0-1), if available.
   * Represents the initial confidence level before manual triage.
   */
  confidence_score?: number;
}

/**
 * Complete Knowledge Confidence State Sync.
 * Contains all entries with truncation already applied.
 */
export interface ConfidenceStateSync {
  /**
   * The confidence state entries, sorted by status_changed_at (descending - most recent changes first).
   * Already truncated to MAX_CONFIDENCE_ITEMS.
   */
  entries: ConfidenceStateEntry[];

  /**
   * Total number of unique confidence items found (before filtering).
   */
  totalItems: number;

  /**
   * Number of items per status.
   */
  statusCounts: {
    unverified: number;
    verified: number;
    rejected: number;
    deferred: number;
  };

  /**
   * Total number of source artifacts processed.
   */
  totalSourceArtifacts: number;

  /**
   * Total number of source refs across all items.
   */
  totalSourceRefs: number;

  /**
   * Whether the entries list was truncated.
   */
  truncated: boolean;

  /**
   * Version of the sync algorithm used.
   */
  sync_version: string;

  /**
   * Timestamp when the sync was generated.
   */
  generated_at: string;
}

/**
 * Frontmatter metadata for the `knowledge-confidence-state-sync.md` note.
 * These fields are always present, even when the sync is empty.
 */
export interface ConfidenceStateMetadata {
  /**
   * Version of the sync algorithm used.
   */
  sync_version: string;

  /**
   * Number of confidence items included in the sync.
   */
  items_count: number;

  /**
   * Number of items per status.
   */
  status_counts_unverified: number;
  status_counts_verified: number;
  status_counts_rejected: number;
  status_counts_deferred: number;

  /**
   * Number of source artifacts processed.
   */
  source_artifacts_processed: number;

  /**
   * Total number of source refs.
   */
  total_source_refs: number;

  /**
   * Whether the sync was truncated.
   */
  sync_truncated: boolean;

  /**
   * Timestamp when the sync was generated.
   */
  generated_at: string;
}

/**
 * Default metadata for when the sync is empty.
 */
export const DEFAULT_EMPTY_SYNC_METADATA: ConfidenceStateMetadata = {
  sync_version: CONFIDENCE_STATE_SYNC_VERSION,
  items_count: 0,
  status_counts_unverified: 0,
  status_counts_verified: 0,
  status_counts_rejected: 0,
  status_counts_deferred: 0,
  source_artifacts_processed: 0,
  total_source_refs: 0,
  sync_truncated: false,
  generated_at: "",
} as const;

/**
 * Compute a deterministic fingerprint for a confidence item.
 *
 * Normalization rules:
 * 1. Convert to lowercase
 * 2. Trim leading/trailing whitespace
 * 3. Collapse multiple whitespace characters to single space
 * 4. Remove trailing punctuation (., !, ?, ;, :) unless part of the meaning
 * 5. Remove bullet/checkbox markers (-, *, [ ], [x])
 * 6. Strip markdown links but keep link text (e.g., [[link|path]] -> link)
 *
 * The hash is a 64-character hex string using a deterministic FNV-1a variant.
 *
 * @param description - The original item description
 * @returns The deterministic fingerprint
 */
export function computeConfidenceItemFingerprint(description: string): ConfidenceItemFingerprint {
  // Normalize the description
  const normalizedDescription = description
    .toLowerCase()
    .trim()
    .replace(/^[-*]\s*/, "") // Remove leading bullet markers
    .replace(/^\[[ x]\]\s*/, "") // Remove checkbox markers
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1") // Strip markdown links, keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Strip markdown links with URL
    .replace(/\s+/g, " ") // Collapse multiple whitespace
    .replace(/[.,!?;:]+$/, ""); // Remove trailing punctuation

  // Compute deterministic hash (FNV-1a 64-bit variant extended to 256-bit equivalent)
  const hash = computeDeterministicHash(normalizedDescription);

  return {
    normalizedDescription,
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
 * Check if two confidence items are semantically equivalent based on fingerprinting.
 *
 * Items are considered the same if:
 * - Their normalized descriptions match exactly, OR
 * - Their hashes match (for pre-computed fingerprints)
 *
 * This enables cross-artifact confidence triage - the same item from different
 * artifacts is recognized as the same confidence target.
 *
 * @param a - First item fingerprint or description
 * @param b - Second item fingerprint or description
 * @returns true if the items are equivalent
 */
export function confidenceItemsAreEquivalent(
  a: ConfidenceItemFingerprint | string,
  b: ConfidenceItemFingerprint | string
): boolean {
  const fingerprintA = typeof a === "string" ? computeConfidenceItemFingerprint(a) : a;
  const fingerprintB = typeof b === "string" ? computeConfidenceItemFingerprint(b) : b;

  return fingerprintA.hash === fingerprintB.hash;
}

/**
 * Status reconciliation precedence rules.
 *
 * When the same item appears in multiple artifacts with different statuses:
 *
 * 1. MANUAL status (set in Knowledge Confidence Inbox) always takes precedence
 * 2. AUTOMATED status (set by workflow/script) takes precedence over ARTIFACT
 * 3. ARTIFACT status (derived from source artifacts) is the default
 * 4. INFERRED status (from pattern heuristics) is lowest precedence
 *
 * For same status_source levels:
 * - Most recent status_changed_at wins
 * - REJECTED > VERIFIED > DEFERRED > UNVERIFIED (status value precedence)
 * - If still tied, use most recent last_seen_at
 *
 * Writeback policy:
 * - MANUAL status is written back to all source artifacts
 * - AUTOMATED status is written back to all source artifacts
 * - ARTIFACT status is NOT written back (preserves source artifact state)
 * - INFERRED status is written back only if it upgrades the status (e.g., UNVERIFIED -> VERIFIED)
 *
 * Status transitions (valid):
 * - UNVERIFIED -> VERIFIED, REJECTED, DEFERRED
 * - VERIFIED -> REJECTED, DEFERRED, UNVERIFIED (if reverting)
 * - REJECTED -> VERIFIED, DEFERRED, UNVERIFIED (reopening)
 * - DEFERRED -> UNVERIFIED, VERIFIED, REJECTED
 *
 * All transitions are allowed - no hard state machine restrictions.
 * This supports flexible workflows where users can reopen rejected items.
 *
 * Timestamp/writeback policy:
 * - status_changed_at is always updated when status changes
 * - Writeback updates source artifact entries' status_source and status_changed_at
 * - If writeback fails for any source artifact, log error but continue (non-blocking)
 */

/**
 * Reconcile status from multiple source refs.
 *
 * Applies the precedence rules to determine the authoritative status.
 *
 * @param sourceRefs - All source artifact refs for the item
 * @returns The reconciled status with source
 */
export function reconcileStatus(sourceRefs: SourceArtifactRef[]): {
  status: ConfidenceStatus;
  statusSource: StatusSource;
  statusChangedAt: string;
  confidenceScore?: number;
} {
  if (sourceRefs.length === 0) {
    return {
      status: ConfidenceStatus.UNVERIFIED,
      statusSource: StatusSource.ARTIFACT,
      statusChangedAt: new Date().toISOString(),
    };
  }

  // Sort refs by precedence
  const sortedRefs = [...sourceRefs].sort((a, b) => {
    // Primary: status_source precedence (MANUAL > AUTOMATED > ARTIFACT > INFERRED)
    const sourcePrecedence = {
      [StatusSource.MANUAL]: 4,
      [StatusSource.AUTOMATED]: 3,
      [StatusSource.ARTIFACT]: 2,
      [StatusSource.INFERRED]: 1,
    };
    const sourceDiff = sourcePrecedence[b.statusSource] - sourcePrecedence[a.statusSource];
    if (sourceDiff !== 0) {
      return sourceDiff;
    }

    // Secondary: most recent status_changed_at
    const timeDiff = b.statusChangedAt.localeCompare(a.statusChangedAt);
    if (timeDiff !== 0) {
      return timeDiff;
    }

    // Tertiary: status value precedence (REJECTED > VERIFIED > DEFERRED > UNVERIFIED)
    const statusPrecedence = {
      [ConfidenceStatus.REJECTED]: 4,
      [ConfidenceStatus.VERIFIED]: 3,
      [ConfidenceStatus.DEFERRED]: 2,
      [ConfidenceStatus.UNVERIFIED]: 1,
    };
    const statusDiff = statusPrecedence[b.status] - statusPrecedence[a.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }

    // Quaternary: most recent last_seen_at
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });

  const winningRef = sortedRefs[0]!;
  return {
    status: winningRef.status,
    statusSource: winningRef.statusSource,
    statusChangedAt: winningRef.statusChangedAt,
    confidenceScore: winningRef.confidenceScore,
  };
}

/**
 * Determine if status should be written back to source artifacts.
 *
 * Writeback rules:
 * - MANUAL status: always write back to all source artifacts
 * - AUTOMATED status: always write back to all source artifacts
 * - ARTIFACT status: never write back (source artifact is the source of truth)
 * - INFERRED status: write back only if it upgrades the status
 *
 * @param status - The status to potentially write back
 * @param statusSource - The source of the status
 * @param currentSourceRefs - Current source artifact refs
 * @returns true if writeback should happen
 */
export function shouldWriteBackStatus(
  status: ConfidenceStatus,
  statusSource: StatusSource,
  currentSourceRefs: SourceArtifactRef[]
): boolean {
  // MANUAL and AUTOMATED always write back
  if (statusSource === StatusSource.MANUAL || statusSource === StatusSource.AUTOMATED) {
    return true;
  }

  // ARTIFACT never writes back
  if (statusSource === StatusSource.ARTIFACT) {
    return false;
  }

  // INFERRED writes back only if it upgrades any source artifact status
  if (statusSource === StatusSource.INFERRED) {
    const statusPrecedence = {
      [ConfidenceStatus.REJECTED]: 4,
      [ConfidenceStatus.VERIFIED]: 3,
      [ConfidenceStatus.DEFERRED]: 2,
      [ConfidenceStatus.UNVERIFIED]: 1,
    };

    for (const ref of currentSourceRefs) {
      const currentPrecedence = statusPrecedence[ref.status];
      const newPrecedence = statusPrecedence[status];
      if (newPrecedence > currentPrecedence) {
        return true;
      }
    }
    return false;
  }

  return false;
}

/**
 * Truncate a description to MAX_DESCRIPTION_LENGTH.
 *
 * @param description - The description to truncate
 * @returns Truncated description with truncation flag
 */
export function truncateDescription(description: string): {
  truncated: string;
  wasTruncated: boolean;
} {
  if (description.length <= MAX_DESCRIPTION_LENGTH) {
    return { truncated: description, wasTruncated: false };
  }

  const truncated = description.slice(0, MAX_DESCRIPTION_LENGTH - 3) + "...";
  return { truncated, wasTruncated: true };
}

/**
 * Build source refs with truncation.
 *
 * Sorts refs by lastSeenAt (most recent first) and truncates to MAX_SOURCE_REFS.
 *
 * @param refs - Source artifact refs to build
 * @returns Truncated refs list with metadata
 */
export function buildSourceArtifactRefs(
  refs: SourceArtifactRef[]
): {
  refs: SourceArtifactRef[];
  truncated: boolean;
} {
  // Sort by lastSeenAt (most recent first)
  const sortedRefs = [...refs].sort((a, b) =>
    b.lastSeenAt.localeCompare(a.lastSeenAt)
  );

  // Truncate to max refs
  const truncated = sortedRefs.length > MAX_SOURCE_REFS;
  const trimmedRefs = sortedRefs.slice(0, MAX_SOURCE_REFS);

  return {
    refs: trimmedRefs,
    truncated,
  };
}

/**
 * Build a confidence state entry from item inputs.
 *
 * Merges equivalent items across artifacts, reconciles status, and builds source refs.
 *
 * @param itemInputs - All inputs for the same item (duplicates merged)
 * @param normalizedDescription - The normalized description
 * @returns The confidence state entry
 */
export function buildConfidenceStateEntry(
  itemInputs: ConfidenceItemInput[],
  normalizedDescription: string
): ConfidenceStateEntry {
  // Compute confidence item ID (hash of normalized description)
  const confidence_item_id = computeConfidenceItemFingerprint(normalizedDescription).hash;

  // Truncate description if needed
  const { truncated: description, wasTruncated: descriptionTruncated } = truncateDescription(normalizedDescription);

  // Build source artifact refs
  const sourceArtifactRefs: SourceArtifactRef[] = itemInputs.map((input) => ({
    sourceType: input.sourceType,
    artifactPath: input.artifactPath,
    artifactTitle: input.artifactTitle,
    entryId: input.entryId,
    sourceUrl: input.sourceUrl,
    firstSeenAt: input.firstSeenAt,
    lastSeenAt: input.lastSeenAt,
    status: input.status,
    statusSource: input.statusSource,
    statusChangedAt: input.statusChangedAt,
    confidenceScore: input.confidenceScore,
  }));

  const { refs: trimmedRefs, truncated: refsTruncated } = buildSourceArtifactRefs(sourceArtifactRefs);

  // Reconcile status
  const { status, statusSource, statusChangedAt, confidenceScore } = reconcileStatus(sourceArtifactRefs);

  // Compute first_seen_at (oldest) and last_seen_at (newest)
  const sortedBySeenAt = [...itemInputs].sort((a, b) =>
    a.firstSeenAt.localeCompare(b.firstSeenAt)
  );
  const first_seen_at = sortedBySeenAt[0]!.firstSeenAt;
  const last_seen_at = sortedBySeenAt[sortedBySeenAt.length - 1]!.lastSeenAt;

  // Build entry
  const entry: ConfidenceStateEntry = {
    confidence_item_id,
    description,
    description_truncated: descriptionTruncated,
    status,
    status_source: statusSource,
    status_changed_at: statusChangedAt,
    source_refs: trimmedRefs,
    source_artifact_count: sourceArtifactRefs.length,
    source_refs_truncated: refsTruncated,
    first_seen_at,
    last_seen_at,
    occurrence_count: itemInputs.length,
    confidence_score: confidenceScore,
  };

  return entry;
}

/**
 * Deterministic sorting rules for confidence state entries.
 *
 * Primary sort: status_changed_at (descending - most recent status changes first)
 * Secondary sort: status (descending by precedence: REJECTED > VERIFIED > DEFERRED > UNVERIFIED)
 * Tertiary sort: confidence_item_id (ascending - deterministic fallback)
 * Quaternary sort: last_seen_at (descending - most recently seen)
 *
 * This ensures that identical inputs produce identical output order and that
 * the most recently changed items appear at the top of the sync file.
 *
 * @param entries - Array of confidence state entries to sort
 * @returns Sorted array (does not mutate input)
 */
export function sortEntriesDeterministically(
  entries: ConfidenceStateEntry[]
): ConfidenceStateEntry[] {
  const statusPrecedence = {
    [ConfidenceStatus.REJECTED]: 4,
    [ConfidenceStatus.VERIFIED]: 3,
    [ConfidenceStatus.DEFERRED]: 2,
    [ConfidenceStatus.UNVERIFIED]: 1,
  };

  return [...entries].sort((a, b) => {
    // Primary: status_changed_at (most recent status changes first)
    if (a.status_changed_at !== b.status_changed_at) {
      return b.status_changed_at.localeCompare(a.status_changed_at);
    }

    // Secondary: status precedence (higher precedence first)
    const statusDiff = statusPrecedence[b.status] - statusPrecedence[a.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }

    // Tertiary: confidence_item_id (ascending for determinism)
    if (a.confidence_item_id !== b.confidence_item_id) {
      return a.confidence_item_id.localeCompare(b.confidence_item_id);
    }

    // Quaternary: last_seen_at (most recent first)
    return b.last_seen_at.localeCompare(a.last_seen_at);
  });
}

/**
 * Build the complete Knowledge Confidence State Sync.
 *
 * This is the main entry point for sync generation.
 *
 * @param itemInputs - All confidence items extracted from artifacts
 * @returns The complete sync with metadata
 */
export function buildConfidenceStateSync(itemInputs: ConfidenceItemInput[]): ConfidenceStateSync {
  const now = new Date().toISOString();

  // Group items by fingerprint (cross-artifact deduplication)
  const itemGroups = new Map<string, ConfidenceItemInput[]>();

  for (const input of itemInputs) {
    const fingerprint = computeConfidenceItemFingerprint(input.description);
    const key = fingerprint.hash;

    if (!itemGroups.has(key)) {
      itemGroups.set(key, []);
    }

    itemGroups.get(key)!.push(input);
  }

  // Build sync entries from groups
  let entries: ConfidenceStateEntry[] = [];
  for (const [hash, inputs] of itemGroups) {
    const entry = buildConfidenceStateEntry(inputs, inputs[0]!.description);
    entries.push(entry);
  }

  // Compute status counts
  const statusCounts = {
    unverified: entries.filter((e) => e.status === ConfidenceStatus.UNVERIFIED).length,
    verified: entries.filter((e) => e.status === ConfidenceStatus.VERIFIED).length,
    rejected: entries.filter((e) => e.status === ConfidenceStatus.REJECTED).length,
    deferred: entries.filter((e) => e.status === ConfidenceStatus.DEFERRED).length,
  };

  // Sort entries deterministically
  const sortedEntries = sortEntriesDeterministically(entries);

  // Truncate to max items
  const truncated = sortedEntries.length > MAX_CONFIDENCE_ITEMS;
  const trimmedEntries = sortedEntries.slice(0, MAX_CONFIDENCE_ITEMS);

  // Compute unique source artifacts
  const uniqueSourceArtifacts = new Set(
    itemInputs.map((i) => `${i.sourceType}:${i.artifactPath}`)
  );

  // Build result
  const sync: ConfidenceStateSync = {
    entries: trimmedEntries,
    totalItems: entries.length,
    statusCounts,
    totalSourceArtifacts: uniqueSourceArtifacts.size,
    totalSourceRefs: itemInputs.length,
    truncated,
    sync_version: CONFIDENCE_STATE_SYNC_VERSION,
    generated_at: now,
  };

  return sync;
}

/**
 * Extract metadata from a ConfidenceStateSync.
 *
 * @param sync - The confidence state sync
 * @returns Metadata object for frontmatter
 */
export function extractSyncMetadata(sync: ConfidenceStateSync): ConfidenceStateMetadata {
  return {
    sync_version: sync.sync_version,
    items_count: sync.entries.length,
    status_counts_unverified: sync.statusCounts.unverified,
    status_counts_verified: sync.statusCounts.verified,
    status_counts_rejected: sync.statusCounts.rejected,
    status_counts_deferred: sync.statusCounts.deferred,
    source_artifacts_processed: sync.totalSourceArtifacts,
    total_source_refs: sync.totalSourceRefs,
    sync_truncated: sync.truncated,
    generated_at: sync.generated_at,
  };
}

/**
 * Render the `knowledge-confidence-state-sync.md` note.
 *
 * Format:
 * ```markdown
 * ---
 * sync_version: 1.0.0
 * items_count: 15
 * status_counts_unverified: 5
 * status_counts_verified: 3
 * status_counts_rejected: 2
 * status_counts_deferred: 5
 * source_artifacts_processed: 4
 * total_source_refs: 20
 * sync_truncated: false
 * generated_at: 2026-03-03T10:00:00.000Z
 * ---
 *
 * # Knowledge Confidence State Sync
 *
 * ## Summary
 * **Total items:** 15 | **Source artifacts:** 4
 *
 * ## Status Distribution
 * - Unverified: 5
 * - Verified: 3
 * - Rejected: 2
 * - Deferred: 5
 *
 * ## Confidence Items
 *
 * ### [UNVERIFIED] React Server Components use RSC payload
 *
 * **Description:** React Server Components use RSC payload for hydration
 * **Status:** Unverified (from: artifact)
 * **Changed:** 2026-03-01T10:00:00.000Z
 *
 * **Sources:**
 * - Key Takeaways: [[Key Takeaways Inbox|path/to/key-takeaways-inbox.md]] (entry_id: abc123)
 * - Open Questions: [[Open Questions Inbox|path/to/open-questions-inbox.md]] (entry_id: def456)
 *
 * ---
 * *Generated by Obsidian Web Clipper v1.0.0 on ...*
 * ```
 *
 * @param sync - The sync to render
 * @returns Complete markdown note content
 */
export function renderConfidenceStateSync(sync: ConfidenceStateSync): string {
  const metadata = extractSyncMetadata(sync);

  // Build frontmatter
  const frontmatterLines = ["---"];
  frontmatterLines.push(`sync_version: ${metadata.sync_version}`);
  frontmatterLines.push(`items_count: ${metadata.items_count}`);
  frontmatterLines.push(`status_counts_unverified: ${metadata.status_counts_unverified}`);
  frontmatterLines.push(`status_counts_verified: ${metadata.status_counts_verified}`);
  frontmatterLines.push(`status_counts_rejected: ${metadata.status_counts_rejected}`);
  frontmatterLines.push(`status_counts_deferred: ${metadata.status_counts_deferred}`);
  frontmatterLines.push(`source_artifacts_processed: ${metadata.source_artifacts_processed}`);
  frontmatterLines.push(`total_source_refs: ${metadata.total_source_refs}`);
  frontmatterLines.push(`sync_truncated: ${metadata.sync_truncated}`);
  frontmatterLines.push(`generated_at: ${metadata.generated_at}`);
  frontmatterLines.push("---");
  frontmatterLines.push("");

  // Build body
  const bodyLines: string[] = [];
  bodyLines.push("# Knowledge Confidence State Sync");
  bodyLines.push("");

  // Summary section
  bodyLines.push("## Summary");
  bodyLines.push("");
  bodyLines.push(`**Total items:** ${metadata.items_count}`);
  bodyLines.push(`**Source artifacts:** ${metadata.source_artifacts_processed}`);
  if (metadata.sync_truncated) {
    bodyLines.push(`> ⚠️ Sync truncated to ${MAX_CONFIDENCE_ITEMS} items`);
  }
  bodyLines.push("");

  // Status distribution section
  bodyLines.push("## Status Distribution");
  bodyLines.push("");
  bodyLines.push(`- Unverified: ${metadata.status_counts_unverified}`);
  bodyLines.push(`- Verified: ${metadata.status_counts_verified}`);
  bodyLines.push(`- Rejected: ${metadata.status_counts_rejected}`);
  bodyLines.push(`- Deferred: ${metadata.status_counts_deferred}`);
  bodyLines.push("");

  // Confidence items section
  bodyLines.push("## Confidence Items");
  bodyLines.push("");

  if (sync.entries.length === 0) {
    bodyLines.push("> No confidence items found.");
    bodyLines.push("");
  } else {
    for (const entry of sync.entries) {
      const statusLabels = {
        [ConfidenceStatus.UNVERIFIED]: "UNVERIFIED",
        [ConfidenceStatus.VERIFIED]: "VERIFIED",
        [ConfidenceStatus.REJECTED]: "REJECTED",
        [ConfidenceStatus.DEFERRED]: "DEFERRED",
      };
      const statusIcon = {
        [ConfidenceStatus.UNVERIFIED]: "❓",
        [ConfidenceStatus.VERIFIED]: "✅",
        [ConfidenceStatus.REJECTED]: "❌",
        [ConfidenceStatus.DEFERRED]: "⏸️",
      };

      const statusLabel = statusLabels[entry.status];
      const icon = statusIcon[entry.status];

      bodyLines.push(`### [${icon} ${statusLabel}] ${entry.description}`);
      bodyLines.push("");

      if (entry.description_truncated) {
        bodyLines.push(`> ⚠️ Description truncated to ${MAX_DESCRIPTION_LENGTH} characters`);
        bodyLines.push("");
      }

      // Metadata
      bodyLines.push(`**Item ID:** \`${entry.confidence_item_id}\``);
      bodyLines.push(`**Status:** ${statusLabel} (from: ${entry.status_source})`);
      const changedDate = entry.status_changed_at.split("T")[0]!;
      bodyLines.push(`**Changed:** ${changedDate}`);
      bodyLines.push(`**First seen:** ${entry.first_seen_at.split("T")[0]!}`);
      bodyLines.push(`**Last seen:** ${entry.last_seen_at.split("T")[0]!}`);
      if (entry.confidence_score !== undefined) {
        bodyLines.push(`**Confidence score:** ${(entry.confidence_score * 100).toFixed(0)}%`);
      }
      bodyLines.push("");

      // Sources
      bodyLines.push("**Sources:**");
      for (const ref of entry.source_refs) {
        const sourceTypeLabels = {
          [SourceType.KEY_TAKEAWAYS]: "Key Takeaways",
          [SourceType.OPEN_QUESTIONS]: "Open Questions",
          [SourceType.EXECUTION_BACKLOG]: "Execution Backlog",
          [SourceType.CLIP_RECOVERY]: "Clip Recovery",
          [SourceType.KNOWLEDGE_TRIAGE]: "Knowledge Triage",
          [SourceType.CONTRADICTION]: "Contradiction",
          [SourceType.EVIDENCE_GAP]: "Evidence Gap",
          [SourceType.CLIP]: "Clip",
        };
        const sourceTypeLabel = sourceTypeLabels[ref.sourceType];
        bodyLines.push(
          `- ${sourceTypeLabel}: [[${ref.artifactTitle}|${ref.artifactPath}]] (entry_id: ${ref.entryId}, status: ${ref.status})`
        );
      }
      if (entry.source_refs_truncated) {
        bodyLines.push(
          `- ... and ${entry.source_artifact_count - MAX_SOURCE_REFS} more source refs`
        );
      }
      bodyLines.push("");
    }
  }

  // Generated footer
  bodyLines.push("---");
  bodyLines.push("");
  bodyLines.push(
    `*Generated by Obsidian Web Clipper v${metadata.sync_version} on ${new Date(metadata.generated_at).toLocaleString()}*`
  );
  bodyLines.push("");

  return [...frontmatterLines, ...bodyLines].join("\n");
}

/**
 * Truncation policy summary.
 *
 * The sync is bounded at two levels:
 *
 * 1. Item-level truncation: MAX_CONFIDENCE_ITEMS (500)
 *    - Only the 500 most recently changed items are included
 *    - Older items are dropped based on status_changed_at
 *    - sync_truncated = true when truncation occurs
 *
 * 2. Source ref truncation: MAX_SOURCE_REFS (20)
 *    - Only the 20 most recent source refs are listed per item
 *    - source_refs_truncated = true when truncation occurs
 *    - source_artifact_count preserves the actual count
 *
 * 3. Description truncation: MAX_DESCRIPTION_LENGTH (500)
 *    - Descriptions longer than 500 chars are truncated with "..." suffix
 *    - description_truncated = true when truncation occurs
 *
 * This prevents the sync file from growing unbounded even for large vaults
 * with many confidence items.
 */

/**
 * Empty state behavior.
 *
 * When no confidence items exist:
 * - The sync note is still created with frontmatter
 * - items_count = 0, all status_counts = 0
 * - sync_truncated = false (nothing to truncate)
 * - Body shows "No confidence items found."
 *
 * When no source artifacts exist:
 * - source_artifacts_processed = 0, total_source_refs = 0
 * - All other fields are zero/empty
 * - Note is still created (acts as a placeholder)
 */

/**
 * Diagnostics fields & versioning.
 *
 * All frontmatter metadata fields are always present, even when empty.
 *
 * Required fields:
 * - `sync_version`: Algorithm version (e.g., "1.0.0")
 * - `items_count`: Number of confidence items included in sync
 * - `status_counts_unverified`: Number of items with UNVERIFIED status
 * - `status_counts_verified`: Number of items with VERIFIED status
 * - `status_counts_rejected`: Number of items with REJECTED status
 * - `status_counts_deferred`: Number of items with DEFERRED status
 * - `source_artifacts_processed`: Number of source artifacts scanned
 * - `total_source_refs`: Total source refs across all items
 * - `sync_truncated`: Boolean indicating item-level truncation
 * - `generated_at`: ISO 8601 timestamp when sync was generated
 *
 * Versioning contract:
 * - Increment `CONFIDENCE_STATE_SYNC_VERSION` when:
 *   - Fingerprinting normalization rules change
 *   - Status precedence/reconciliation rules change
 *   - Writeback policy changes
 *   - Sorting/tie-break rules change
 *   - Truncation bounds change
 * - Keep version as semantic string "MAJOR.MINOR.PATCH"
 * - MAJOR: Breaking changes to entry structure/metadata
 * - MINOR: Status reconciliation/writeback formula updates
 * - PATCH: Bug fixes with same outputs
 */

/**
 * Integration with save pipeline.
 *
 * The sync should be regenerated after each clip save or confidence edit:
 * 1. Scan all source artifacts (key-takeaways, open-questions, contradictions, etc.)
 * 2. Extract all confidence-triageable items with their current status
 * 3. Build sync using buildConfidenceStateSync()
 * 4. Render markdown using renderConfidenceStateSync()
 * 5. Save/overwrite `knowledge-confidence-state-sync.md` in the vault
 * 6. If writeback is needed, update source artifact files with reconciled status
 *
 * On failure (e.g., read/parse error):
 * - Log the error
 * - Do not corrupt the existing sync
 * - Continue with clip save (sync refresh is non-critical)
 *
 * On writeback failure:
 * - Log the error with details about which artifact failed
 * - Mark the sync as having partial writeback
 * - Continue (sync is still valid, just some source artifacts out of date)
 *
 * For deterministic behavior, the sync generation should use:
 * - Alphabetical sorting for source artifact file enumeration
 * - Deterministic parsing of artifact entries
 * - Stable fingerprinting for cross-artifact item matching
 */
