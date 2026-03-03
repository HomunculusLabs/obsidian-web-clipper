/**
 * Knowledge Triage State Sync Contract
 *
 * This module defines the contract for the Knowledge Triage State Sync artifact.
 * It specifies how triage status edits across multiple inbox artifacts are
 * reconciled and persisted, ensuring resolved items do not resurface on subsequent
 * refreshes.
 *
 * Core Goals:
 * - Deterministic: Same inputs always produce same outputs
 * - Stable: Triage item IDs and status mappings remain consistent across runs
 * - Observable: All behavior is covered by metadata fields
 * - Bounded: Sync entries are always truncated to a known maximum
 * - Precedence-aware: Source inbox status follows clear conflict resolution rules
 */

/**
 * Version of the Knowledge Triage State Sync algorithm.
 * Increment this when the fingerprinting logic, status reconciliation rules,
 * writeback policy, or truncation policy changes.
 */
export const TRIAGE_STATE_SYNC_VERSION = "1.0.0" as const;

/**
 * Maximum number of triage items to include in the state sync.
 * This ensures the sync note doesn't grow unbounded even for large vaults.
 */
export const MAX_TRIAGE_ITEMS = 500 as const;

/**
 * Maximum number of source inbox refs per triage item.
 * Prevents source ref lists from growing excessively.
 */
export const MAX_SOURCE_REFS = 20 as const;

/**
 * Maximum length for a triage item description.
 * Truncates long descriptions to keep the sync file manageable.
 */
export const MAX_DESCRIPTION_LENGTH = 500 as const;

/**
 * Triage status enum.
 *
 * Status lifecycle:
 * - ready: Item is ready to be addressed (default state for inbox entries)
 * - in-progress: Item is currently being worked on
 * - blocked: Item cannot be progressed due to dependency/wait condition
 * - done: Item has been completed (filtered out of active inbox views)
 */
export enum TriageStatus {
  /** Item is ready to be addressed (default for active inbox entries) */
  READY = "ready",
  /** Item is currently being worked on */
  IN_PROGRESS = "in-progress",
  /** Item cannot be progressed (waiting for something) */
  BLOCKED = "blocked",
  /** Item has been completed (excluded from inbox rendering) */
  DONE = "done",
}

/**
 * Source inbox type.
 *
 * Different inbox artifacts can contain triageable items.
 */
export enum SourceInboxType {
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
}

/**
 * Status source - where a triage status change originated.
 */
export enum StatusSource {
  /** Status was derived from source inbox (implicit status) */
  INBOX = "inbox",
  /** Status was set manually in the Knowledge Triage Inbox */
  MANUAL = "manual",
  /** Status was inferred from pattern heuristics (e.g., auto-done based on completion) */
  INFERRED = "inferred",
  /** Status was set by automated workflow/script */
  AUTOMATED = "automated",
}

/**
 * Input for a single triage item from a source inbox.
 *
 * This represents one item that can be triaged, extracted from an inbox.
 */
export interface TriageItemInput {
  /**
   * The item description (insight, question, task, etc.).
   * Normalized to lowercase, trimmed whitespace.
   */
  description: string;

  /**
   * The source inbox type this item came from.
   */
  sourceInbox: SourceInboxType;

  /**
   * Path to the source inbox note.
   * Used for linkback rendering and writeback.
   */
  inboxPath: string;

  /**
   * Title of the source inbox note.
   * Used for display in linkbacks.
   */
  inboxTitle: string;

  /**
   * Entry ID within the source inbox (e.g., insight_id, question_id).
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
   * Timestamp when the item was last updated in the source inbox.
   * Used for precedence and freshness checks.
   */
  lastSeenAt: string; // ISO 8601 format

  /**
   * Current status from the source inbox (if available).
   * Default is READY (all items start as ready).
   */
  status: TriageStatus;

  /**
   * Where this status came from (default is INBOX).
   */
  statusSource: StatusSource;

  /**
   * Timestamp when this status was last changed.
   */
  statusChangedAt: string; // ISO 8601 format
}

/**
 * Deterministic fingerprint for a triage item.
 *
 * Items are considered the same if their normalized descriptions match,
 * regardless of which inbox they came from. This enables cross-inbox
 * triage - marking an item as done in one inbox marks it done everywhere.
 */
export interface TriageItemFingerprint {
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
 * Source inbox reference for a triage item.
 *
 * Tracks which inboxes contain this item and its status in each.
 */
export interface SourceInboxRef {
  /**
   * The source inbox type.
   */
  inboxType: SourceInboxType;

  /**
   * Path to the inbox note.
   */
  inboxPath: string;

  /**
   * Title of the inbox note.
   */
  inboxTitle: string;

  /**
   * Entry ID within the inbox.
   */
  entryId: string;

  /**
   * Source URL or context for the item (optional).
   */
  sourceUrl?: string;

  /**
   * Timestamp when this item was first seen in this inbox.
   */
  firstSeenAt: string;

  /**
   * Timestamp when this item was last updated in this inbox.
   */
  lastSeenAt: string;

  /**
   * Current status from this inbox.
   */
  status: TriageStatus;

  /**
   * Where this status came from.
   */
  statusSource: StatusSource;

  /**
   * Timestamp when this status was last changed.
   */
  statusChangedAt: string;
}

/**
 * A single triage state sync entry with all information needed for reconciliation.
 */
export interface TriageStateEntry {
  /**
   * Unique identifier for this triage item.
   * Computed as hash of normalized description.
   */
  triage_item_id: string;

  /**
   * The item description (normalized and truncated if needed).
   */
  description: string;

  /**
   * Whether the description was truncated.
   */
  description_truncated: boolean;

  /**
   * Current triage status (the authoritative status after reconciliation).
   */
  status: TriageStatus;

  /**
   * Where the current status came from.
   */
  status_source: StatusSource;

  /**
   * Timestamp when the status was last changed.
   */
  status_changed_at: string;

  /**
   * List of source inbox references for this item.
   * Sorted by lastSeenAt (most recent first).
   * Truncated to MAX_SOURCE_REFS.
   */
  source_inbox_refs: SourceInboxRef[];

  /**
   * Total number of source inboxes containing this item (before truncation).
   */
  source_inbox_count: number;

  /**
   * Whether the source inbox refs list was truncated.
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
   * Number of times this item has appeared in inboxes.
   */
  occurrence_count: number;
}

/**
 * Complete Knowledge Triage State Sync.
 * Contains all entries with truncation already applied.
 */
export interface TriageStateSync {
  /**
   * The triage state entries, sorted by status_changed_at (descending - most recent changes first).
   * Already truncated to MAX_TRIAGE_ITEMS.
   */
  entries: TriageStateEntry[];

  /**
   * Total number of unique triage items found (before filtering).
   */
  totalItems: number;

  /**
   * Number of items per status.
   */
  statusCounts: {
    ready: number;
    inProgress: number;
    blocked: number;
    done: number;
  };

  /**
   * Total number of source inboxes processed.
   */
  totalSourceInboxes: number;

  /**
   * Total number of source inbox refs across all items.
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
 * Frontmatter metadata for the `knowledge-triage-state-sync.md` note.
 * These fields are always present, even when the sync is empty.
 */
export interface TriageStateMetadata {
  /**
   * Version of the sync algorithm used.
   */
  sync_version: string;

  /**
   * Number of triage items included in the sync.
   */
  items_count: number;

  /**
   * Number of items per status.
   */
  status_counts_ready: number;
  status_counts_in_progress: number;
  status_counts_blocked: number;
  status_counts_done: number;

  /**
   * Number of source inboxes processed.
   */
  source_inboxes_processed: number;

  /**
   * Total number of source inbox refs.
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
export const DEFAULT_EMPTY_SYNC_METADATA: TriageStateMetadata = {
  sync_version: TRIAGE_STATE_SYNC_VERSION,
  items_count: 0,
  status_counts_ready: 0,
  status_counts_in_progress: 0,
  status_counts_blocked: 0,
  status_counts_done: 0,
  source_inboxes_processed: 0,
  total_source_refs: 0,
  sync_truncated: false,
  generated_at: "",
} as const;

/**
 * Compute a deterministic fingerprint for a triage item.
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
export function computeTriageItemFingerprint(description: string): TriageItemFingerprint {
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
 * Check if two triage items are semantically equivalent based on fingerprinting.
 *
 * Items are considered the same if:
 * - Their normalized descriptions match exactly, OR
 * - Their hashes match (for pre-computed fingerprints)
 *
 * This enables cross-inbox triage - the same item from different inboxes
 * is recognized as the same triage target.
 *
 * @param a - First item fingerprint or description
 * @param b - Second item fingerprint or description
 * @returns true if the items are equivalent
 */
export function triageItemsAreEquivalent(
  a: TriageItemFingerprint | string,
  b: TriageItemFingerprint | string
): boolean {
  const fingerprintA = typeof a === "string" ? computeTriageItemFingerprint(a) : a;
  const fingerprintB = typeof b === "string" ? computeTriageItemFingerprint(b) : b;

  return fingerprintA.hash === fingerprintB.hash;
}

/**
 * Status reconciliation precedence rules.
 *
 * When the same item appears in multiple inboxes with different statuses:
 *
 * 1. MANUAL status (set in Knowledge Triage Inbox) always takes precedence
 * 2. AUTOMATED status (set by workflow/script) takes precedence over INBOX
 * 3. INBOX status (derived from source inboxes) is the default
 * 4. INFERRED status (from pattern heuristics) is lowest precedence
 *
 * For same status_source levels:
 * - Most recent status_changed_at wins
 * - DONE > BLOCKED > IN_PROGRESS > READY (status value precedence)
 * - If still tied, use most recent last_seen_at
 *
 * Writeback policy:
 * - MANUAL status is written back to all source inboxes
 * - AUTOMATED status is written back to all source inboxes
 * - INBOX status is NOT written back (preserves source inbox state)
 * - INFERRED status is written back only if it upgrades the status (e.g., READY -> DONE)
 *
 * Status transitions (valid):
 * - READY -> IN_PROGRESS, BLOCKED, DONE
 * - IN_PROGRESS -> BLOCKED, DONE, READY (if reverting)
 * - BLOCKED -> READY, IN_PROGRESS, DONE
 * - DONE -> READY, BLOCKED, IN_PROGRESS (reopening)
 *
 * All transitions are allowed - no hard state machine restrictions.
 * This supports flexible workflows where users can reopen done items.
 *
 * Timestamp/writeback policy:
 * - status_changed_at is always updated when status changes
 * - Writeback updates source inbox entries' status_source and status_changed_at
 * - If writeback fails for any source inbox, log error but continue (non-blocking)
 */

/**
 * Reconcile status from multiple source refs.
 *
 * Applies the precedence rules to determine the authoritative status.
 *
 * @param sourceRefs - All source inbox refs for the item
 * @returns The reconciled status with source
 */
export function reconcileStatus(sourceRefs: SourceInboxRef[]): {
  status: TriageStatus;
  statusSource: StatusSource;
  statusChangedAt: string;
} {
  if (sourceRefs.length === 0) {
    return {
      status: TriageStatus.READY,
      statusSource: StatusSource.INBOX,
      statusChangedAt: new Date().toISOString(),
    };
  }

  // Sort refs by precedence
  const sortedRefs = [...sourceRefs].sort((a, b) => {
    // Primary: status_source precedence (MANUAL > AUTOMATED > INBOX > INFERRED)
    const sourcePrecedence = {
      [StatusSource.MANUAL]: 4,
      [StatusSource.AUTOMATED]: 3,
      [StatusSource.INBOX]: 2,
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

    // Tertiary: status value precedence (DONE > BLOCKED > IN_PROGRESS > READY)
    const statusPrecedence = {
      [TriageStatus.DONE]: 4,
      [TriageStatus.BLOCKED]: 3,
      [TriageStatus.IN_PROGRESS]: 2,
      [TriageStatus.READY]: 1,
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
  };
}

/**
 * Determine if status should be written back to source inboxes.
 *
 * Writeback rules:
 * - MANUAL status: always write back to all source inboxes
 * - AUTOMATED status: always write back to all source inboxes
 * - INBOX status: never write back (source inbox is the source of truth)
 * - INFERRED status: write back only if it upgrades the status
 *
 * @param status - The status to potentially write back
 * @param statusSource - The source of the status
 * @param currentSourceRefs - Current source inbox refs
 * @returns true if writeback should happen
 */
export function shouldWriteBackStatus(
  status: TriageStatus,
  statusSource: StatusSource,
  currentSourceRefs: SourceInboxRef[]
): boolean {
  // MANUAL and AUTOMATED always write back
  if (statusSource === StatusSource.MANUAL || statusSource === StatusSource.AUTOMATED) {
    return true;
  }

  // INBOX never writes back
  if (statusSource === StatusSource.INBOX) {
    return false;
  }

  // INFERRED writes back only if it upgrades any source inbox status
  if (statusSource === StatusSource.INFERRED) {
    const statusPrecedence = {
      [TriageStatus.DONE]: 4,
      [TriageStatus.BLOCKED]: 3,
      [TriageStatus.IN_PROGRESS]: 2,
      [TriageStatus.READY]: 1,
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
 * Build source inbox refs with truncation.
 *
 * Sorts refs by lastSeenAt (most recent first) and truncates to MAX_SOURCE_REFS.
 *
 * @param refs - Source inbox refs to build
 * @returns Truncated refs list with metadata
 */
export function buildSourceInboxRefs(
  refs: SourceInboxRef[]
): {
  refs: SourceInboxRef[];
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
 * Build a triage state entry from item inputs.
 *
 * Merges equivalent items across inboxes, reconciles status, and builds source refs.
 *
 * @param itemInputs - All inputs for the same item (duplicates merged)
 * @param normalizedDescription - The normalized description
 * @returns The triage state entry
 */
export function buildTriageStateEntry(
  itemInputs: TriageItemInput[],
  normalizedDescription: string
): TriageStateEntry {
  // Compute triage item ID (hash of normalized description)
  const triage_item_id = computeTriageItemFingerprint(normalizedDescription).hash;

  // Truncate description if needed
  const { truncated: description, wasTruncated: descriptionTruncated } = truncateDescription(normalizedDescription);

  // Build source inbox refs
  const sourceInboxRefs: SourceInboxRef[] = itemInputs.map((input) => ({
    inboxType: input.sourceInbox,
    inboxPath: input.inboxPath,
    inboxTitle: input.inboxTitle,
    entryId: input.entryId,
    sourceUrl: input.sourceUrl,
    firstSeenAt: input.firstSeenAt,
    lastSeenAt: input.lastSeenAt,
    status: input.status,
    statusSource: input.statusSource,
    statusChangedAt: input.statusChangedAt,
  }));

  const { refs: trimmedRefs, truncated: refsTruncated } = buildSourceInboxRefs(sourceInboxRefs);

  // Reconcile status
  const { status, statusSource, statusChangedAt } = reconcileStatus(sourceInboxRefs);

  // Compute first_seen_at (oldest) and last_seen_at (newest)
  const sortedBySeenAt = [...itemInputs].sort((a, b) =>
    a.firstSeenAt.localeCompare(b.firstSeenAt)
  );
  const first_seen_at = sortedBySeenAt[0]!.firstSeenAt;
  const last_seen_at = sortedBySeenAt[sortedBySeenAt.length - 1]!.lastSeenAt;

  // Build entry
  const entry: TriageStateEntry = {
    triage_item_id,
    description,
    description_truncated: descriptionTruncated,
    status,
    status_source: statusSource,
    status_changed_at: statusChangedAt,
    source_inbox_refs: trimmedRefs,
    source_inbox_count: sourceInboxRefs.length,
    source_refs_truncated: refsTruncated,
    first_seen_at,
    last_seen_at,
    occurrence_count: itemInputs.length,
  };

  return entry;
}

/**
 * Deterministic sorting rules for triage state entries.
 *
 * Primary sort: status_changed_at (descending - most recent status changes first)
 * Secondary sort: status (descending by precedence: DONE > BLOCKED > IN_PROGRESS > READY)
 * Tertiary sort: triage_item_id (ascending - deterministic fallback)
 * Quaternary sort: last_seen_at (descending - most recently seen)
 *
 * This ensures that identical inputs produce identical output order and that
 * the most recently changed items appear at the top of the sync file.
 *
 * @param entries - Array of triage state entries to sort
 * @returns Sorted array (does not mutate input)
 */
export function sortEntriesDeterministically(
  entries: TriageStateEntry[]
): TriageStateEntry[] {
  const statusPrecedence = {
    [TriageStatus.DONE]: 4,
    [TriageStatus.BLOCKED]: 3,
    [TriageStatus.IN_PROGRESS]: 2,
    [TriageStatus.READY]: 1,
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

    // Tertiary: triage_item_id (ascending for determinism)
    if (a.triage_item_id !== b.triage_item_id) {
      return a.triage_item_id.localeCompare(b.triage_item_id);
    }

    // Quaternary: last_seen_at (most recent first)
    return b.last_seen_at.localeCompare(a.last_seen_at);
  });
}

/**
 * Build the complete Knowledge Triage State Sync.
 *
 * This is the main entry point for sync generation.
 *
 * @param itemInputs - All triage items extracted from inboxes
 * @returns The complete sync with metadata
 */
export function buildTriageStateSync(itemInputs: TriageItemInput[]): TriageStateSync {
  const now = new Date().toISOString();

  // Group items by fingerprint (cross-inbox deduplication)
  const itemGroups = new Map<string, TriageItemInput[]>();

  for (const input of itemInputs) {
    const fingerprint = computeTriageItemFingerprint(input.description);
    const key = fingerprint.hash;

    if (!itemGroups.has(key)) {
      itemGroups.set(key, []);
    }

    itemGroups.get(key)!.push(input);
  }

  // Build sync entries from groups
  let entries: TriageStateEntry[] = [];
  for (const [hash, inputs] of itemGroups) {
    const entry = buildTriageStateEntry(inputs, inputs[0]!.description);
    entries.push(entry);
  }

  // Compute status counts
  const statusCounts = {
    ready: entries.filter((e) => e.status === TriageStatus.READY).length,
    inProgress: entries.filter((e) => e.status === TriageStatus.IN_PROGRESS).length,
    blocked: entries.filter((e) => e.status === TriageStatus.BLOCKED).length,
    done: entries.filter((e) => e.status === TriageStatus.DONE).length,
  };

  // Sort entries deterministically
  const sortedEntries = sortEntriesDeterministically(entries);

  // Truncate to max items
  const truncated = sortedEntries.length > MAX_TRIAGE_ITEMS;
  const trimmedEntries = sortedEntries.slice(0, MAX_TRIAGE_ITEMS);

  // Compute unique source inboxes
  const uniqueSourceInboxes = new Set(
    itemInputs.map((i) => `${i.sourceInbox}:${i.inboxPath}`)
  );

  // Build result
  const sync: TriageStateSync = {
    entries: trimmedEntries,
    totalItems: entries.length,
    statusCounts,
    totalSourceInboxes: uniqueSourceInboxes.size,
    totalSourceRefs: itemInputs.length,
    truncated,
    sync_version: TRIAGE_STATE_SYNC_VERSION,
    generated_at: now,
  };

  return sync;
}

/**
 * Extract metadata from a TriageStateSync.
 *
 * @param sync - The triage state sync
 * @returns Metadata object for frontmatter
 */
export function extractSyncMetadata(sync: TriageStateSync): TriageStateMetadata {
  return {
    sync_version: sync.sync_version,
    items_count: sync.entries.length,
    status_counts_ready: sync.statusCounts.ready,
    status_counts_in_progress: sync.statusCounts.inProgress,
    status_counts_blocked: sync.statusCounts.blocked,
    status_counts_done: sync.statusCounts.done,
    source_inboxes_processed: sync.totalSourceInboxes,
    total_source_refs: sync.totalSourceRefs,
    sync_truncated: sync.truncated,
    generated_at: sync.generated_at,
  };
}

/**
 * Render the `knowledge-triage-state-sync.md` note.
 *
 * Format:
 * ```markdown
 * ---
 * sync_version: 1.0.0
 * items_count: 15
 * status_counts_ready: 5
 * status_counts_in_progress: 3
 * status_counts_blocked: 2
 * status_counts_done: 5
 * source_inboxes_processed: 4
 * total_source_refs: 20
 * sync_truncated: false
 * generated_at: 2026-03-03T10:00:00.000Z
 * ---
 *
 * # Knowledge Triage State Sync
 *
 * ## Summary
 * **Total items:** 15 | **Source inboxes:** 4
 *
 * ## Status Distribution
 * - Ready: 5
 * - In Progress: 3
 * - Blocked: 2
 * - Done: 5
 *
 * ## Triage Items
 *
 * ### [READY] React Server Components use RSC payload
 *
 * **Description:** React Server Components use RSC payload for hydration
 * **Status:** Ready (from: inbox)
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
export function renderTriageStateSync(sync: TriageStateSync): string {
  const metadata = extractSyncMetadata(sync);

  // Build frontmatter
  const frontmatterLines = ["---"];
  frontmatterLines.push(`sync_version: ${metadata.sync_version}`);
  frontmatterLines.push(`items_count: ${metadata.items_count}`);
  frontmatterLines.push(`status_counts_ready: ${metadata.status_counts_ready}`);
  frontmatterLines.push(`status_counts_in_progress: ${metadata.status_counts_in_progress}`);
  frontmatterLines.push(`status_counts_blocked: ${metadata.status_counts_blocked}`);
  frontmatterLines.push(`status_counts_done: ${metadata.status_counts_done}`);
  frontmatterLines.push(`source_inboxes_processed: ${metadata.source_inboxes_processed}`);
  frontmatterLines.push(`total_source_refs: ${metadata.total_source_refs}`);
  frontmatterLines.push(`sync_truncated: ${metadata.sync_truncated}`);
  frontmatterLines.push(`generated_at: ${metadata.generated_at}`);
  frontmatterLines.push("---");
  frontmatterLines.push("");

  // Build body
  const bodyLines: string[] = [];
  bodyLines.push("# Knowledge Triage State Sync");
  bodyLines.push("");

  // Summary section
  bodyLines.push("## Summary");
  bodyLines.push("");
  bodyLines.push(`**Total items:** ${metadata.items_count}`);
  bodyLines.push(`**Source inboxes:** ${metadata.source_inboxes_processed}`);
  if (metadata.sync_truncated) {
    bodyLines.push(`> ⚠️ Sync truncated to ${MAX_TRIAGE_ITEMS} items`);
  }
  bodyLines.push("");

  // Status distribution section
  bodyLines.push("## Status Distribution");
  bodyLines.push("");
  bodyLines.push(`- Ready: ${metadata.status_counts_ready}`);
  bodyLines.push(`- In Progress: ${metadata.status_counts_in_progress}`);
  bodyLines.push(`- Blocked: ${metadata.status_counts_blocked}`);
  bodyLines.push(`- Done: ${metadata.status_counts_done}`);
  bodyLines.push("");

  // Triage items section
  bodyLines.push("## Triage Items");
  bodyLines.push("");

  if (sync.entries.length === 0) {
    bodyLines.push("> No triage items found.");
    bodyLines.push("");
  } else {
    for (const entry of sync.entries) {
      const statusLabels = {
        [TriageStatus.READY]: "READY",
        [TriageStatus.IN_PROGRESS]: "IN PROGRESS",
        [TriageStatus.BLOCKED]: "BLOCKED",
        [TriageStatus.DONE]: "DONE",
      };
      const statusIcon = {
        [TriageStatus.READY]: "📋",
        [TriageStatus.IN_PROGRESS]: "🔄",
        [TriageStatus.BLOCKED]: "🚧",
        [TriageStatus.DONE]: "✅",
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
      bodyLines.push(`**Item ID:** \`${entry.triage_item_id}\``);
      bodyLines.push(`**Status:** ${statusLabel} (from: ${entry.status_source})`);
      const changedDate = entry.status_changed_at.split("T")[0]!;
      bodyLines.push(`**Changed:** ${changedDate}`);
      bodyLines.push(`**First seen:** ${entry.first_seen_at.split("T")[0]!}`);
      bodyLines.push(`**Last seen:** ${entry.last_seen_at.split("T")[0]!}`);
      bodyLines.push("");

      // Sources
      bodyLines.push("**Sources:**");
      for (const ref of entry.source_inbox_refs) {
        const inboxTypeLabels = {
          [SourceInboxType.KEY_TAKEAWAYS]: "Key Takeaways",
          [SourceInboxType.OPEN_QUESTIONS]: "Open Questions",
          [SourceInboxType.EXECUTION_BACKLOG]: "Execution Backlog",
          [SourceInboxType.CLIP_RECOVERY]: "Clip Recovery",
          [SourceInboxType.KNOWLEDGE_TRIAGE]: "Knowledge Triage",
        };
        const inboxTypeLabel = inboxTypeLabels[ref.inboxType];
        bodyLines.push(
          `- ${inboxTypeLabel}: [[${ref.inboxTitle}|${ref.inboxPath}]] (entry_id: ${ref.entryId}, status: ${ref.status})`
        );
      }
      if (entry.source_refs_truncated) {
        bodyLines.push(
          `- ... and ${entry.source_inbox_count - MAX_SOURCE_REFS} more source refs`
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
 * 1. Item-level truncation: MAX_TRIAGE_ITEMS (500)
 *    - Only the 500 most recently changed items are included
 *    - Older items are dropped based on status_changed_at
 *    - sync_truncated = true when truncation occurs
 *
 * 2. Source ref truncation: MAX_SOURCE_REFS (20)
 *    - Only the 20 most recent source refs are listed per item
 *    - source_refs_truncated = true when truncation occurs
 *    - source_inbox_count preserves the actual count
 *
 * 3. Description truncation: MAX_DESCRIPTION_LENGTH (500)
 *    - Descriptions longer than 500 chars are truncated with "..." suffix
 *    - description_truncated = true when truncation occurs
 *
 * This prevents the sync file from growing unbounded even for large vaults
 * with many triage items.
 */

/**
 * Empty state behavior.
 *
 * When no triage items exist:
 * - The sync note is still created with frontmatter
 * - items_count = 0, all status_counts = 0
 * - sync_truncated = false (nothing to truncate)
 * - Body shows "No triage items found."
 *
 * When no source inboxes exist:
 * - source_inboxes_processed = 0, total_source_refs = 0
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
 * - `items_count`: Number of triage items included in sync
 * - `status_counts_ready`: Number of items with READY status
 * - `status_counts_in_progress`: Number of items with IN_PROGRESS status
 * - `status_counts_blocked`: Number of items with BLOCKED status
 * - `status_counts_done`: Number of items with DONE status
 * - `source_inboxes_processed`: Number of source inboxes scanned
 * - `total_source_refs`: Total source inbox refs across all items
 * - `sync_truncated`: Boolean indicating item-level truncation
 * - `generated_at`: ISO 8601 timestamp when sync was generated
 *
 * Versioning contract:
 * - Increment `TRIAGE_STATE_SYNC_VERSION` when:
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
 * The sync should be regenerated after each clip save or triage edit:
 * 1. Scan all source inboxes (key-takeaways, open-questions, etc.)
 * 2. Extract all triageable items with their current status
 * 3. Build sync using buildTriageStateSync()
 * 4. Render markdown using renderTriageStateSync()
 * 5. Save/overwrite `knowledge-triage-state-sync.md` in the vault
 * 6. If writeback is needed, update source inbox files with reconciled status
 *
 * On failure (e.g., read/parse error):
 * - Log the error
 * - Do not corrupt the existing sync
 * - Continue with clip save (sync refresh is non-critical)
 *
 * On writeback failure:
 * - Log the error with details about which inbox failed
 * - Mark the sync as having partial writeback
 * - Continue (sync is still valid, just some source inboxes out of date)
 *
 * For deterministic behavior, the sync generation should use:
 * - Alphabetical sorting for source inbox file enumeration
 * - Deterministic parsing of inbox entries
 * - Stable fingerprinting for cross-inbox item matching
 */
