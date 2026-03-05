/**
 * Knowledge Trust Kickoff Brief Contract
 *
 * This module defines the contract for the Knowledge Trust Kickoff Brief artifact.
 * It specifies how trust-risk signals from the knowledge-trust-dashboard,
 * knowledge-trust-dashboard-state-sync, and knowledge-trust-dashboard-history
 * are aggregated, ranked, and rendered into a single actionable
 * `knowledge-trust-kickoff-brief.md` note for session kickoff.
 *
 * Core Goals:
 * - Deterministic: Same inputs always produce same outputs
 * - Stable: Brief item IDs, ordering, and linkbacks remain consistent across runs
 * - Observable: All behavior is covered by metadata fields
 * - Bounded: Brief entries are always truncated to a known maximum
 * - Actionable: Each item includes a recommended next action for triage
 * - High-signal: Surfaces highest-risk unresolved items first
 */

/**
 * Version of the Knowledge Trust Kickoff Brief algorithm.
 * Increment this when the ranking logic, tie-break rules, dedupe rules,
 * or truncation policy changes.
 */
export const KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION = "1.0.0" as const;

/**
 * Maximum number of items to include in the kickoff brief.
 * This ensures the brief is focused on highest-risk items and
 * doesn't overwhelm session kickoff.
 */
export const MAX_BRIEF_ITEMS = 20 as const;

/**
 * Maximum number of source refs per brief item.
 * Prevents linkback lists from growing excessively.
 */
export const MAX_SOURCE_REFS = 5 as const;

/**
 * Risk bands for prioritizing trust items.
 * Higher severity = higher priority in the brief.
 */
export enum RiskBand {
  /** Critical: Immediate action required - unresolved contradictions, stale high-confidence claims */
  CRITICAL = "critical",
  /** High: Should be addressed in current session - evidence gaps, confidence overrides */
  HIGH = "high",
  /** Medium: Monitor and triage - recent state changes, emerging patterns */
  MEDIUM = "medium",
  /** Low: Background awareness - historical context, resolved items */
  LOW = "low",
}

/**
 * Source artifact types that feed into the kickoff brief.
 */
export enum TrustSourceType {
  /** From knowledge-trust-dashboard.md */
  DASHBOARD = "dashboard",
  /** From knowledge-trust-dashboard-state-sync.md */
  STATE_SYNC = "state-sync",
  /** From knowledge-trust-dashboard-history.ndjson */
  HISTORY = "history",
}

/**
 * Item types within the trust ecosystem.
 */
export enum TrustItemType {
  /** Unresolved contradiction between claims */
  CONTRADICTION = "contradiction",
  /** Evidence gap - missing information */
  EVIDENCE_GAP = "evidence-gap",
  /** Low confidence item requiring review */
  LOW_CONFIDENCE = "low-confidence",
  /** Stale assumption that may need revalidation */
  STALE_ASSUMPTION = "stale-assumption",
  /** State change requiring attention */
  STATE_CHANGE = "state-change",
  /** Historical pattern or trend */
  HISTORICAL_PATTERN = "historical-pattern",
}

/**
 * Recommended next actions for brief items.
 */
export enum RecommendedAction {
  /** Review and resolve immediately */
  REVIEW_NOW = "review-now",
  /** Triage and assign priority */
  TRIAGE = "triage",
  /** Revalidate against source */
  REVALIDATE = "revalidate",
  /** Update confidence status */
  UPDATE_CONFIDENCE = "update-confidence",
  /** Cross-reference with related clips */
  CROSS_REFERENCE = "cross-reference",
  /** Monitor for changes */
  MONITOR = "monitor",
  /** Archive as resolved */
  ARCHIVE = "archive",
}

/**
 * Status of a brief item.
 */
export enum BriefItemStatus {
  /** Item is active and unresolved */
  ACTIVE = "active",
  /** Item is being worked on */
  IN_PROGRESS = "in-progress",
  /** Item has been resolved */
  RESOLVED = "resolved",
  /** Item was reviewed and dismissed */
  DISMISSED = "dismissed",
}

/**
 * Input for a single trust item from source artifacts.
 */
export interface TrustItemInput {
  /**
   * The item identifier from the source artifact.
   */
  dashboard_item_id: string;

  /**
   * Type of trust item.
   */
  item_type: TrustItemType;

  /**
   * Human-readable description of the trust issue.
   */
  description: string;

  /**
   * Risk band for prioritization.
   */
  risk_band: RiskBand;

  /**
   * Source artifact type.
   */
  source_type: TrustSourceType;

  /**
   * Path to the source artifact.
   */
  source_path: string;

  /**
   * Timestamp when the item was first detected.
   */
  first_detected_at: string; // ISO 8601 format

  /**
   * Timestamp when the item was last updated.
   */
  last_updated_at: string; // ISO 8601 format

  /**
   * Current status of the item.
   */
  status: BriefItemStatus;

  /**
   * Optional: Related clip paths for linkbacks.
   */
  related_clip_paths?: string[];

  /**
   * Optional: Additional context/metadata from source.
   */
  context?: Record<string, unknown>;
}

/**
 * Source reference for a brief item.
 */
export interface SourceRef {
  /**
   * Source artifact type.
   */
  source_type: TrustSourceType;

  /**
   * Path to the source artifact.
   */
  source_path: string;

  /**
   * Item ID within the source.
   */
  dashboard_item_id: string;

  /**
   * Timestamp of the source entry.
   */
  timestamp: string;
}

/**
 * A single brief entry with all information needed for kickoff.
 */
export interface BriefEntry {
  /**
   * Unique identifier for this brief item.
   * Computed as hash of dashboard_item_id + source_type.
   */
  brief_item_id: string;

  /**
   * Original dashboard item ID from source artifact.
   */
  dashboard_item_id: string;

  /**
   * Type of trust item.
   */
  item_type: TrustItemType;

  /**
   * Human-readable description (truncated if needed).
   */
  description: string;

  /**
   * Whether the description was truncated.
   */
  description_truncated: boolean;

  /**
   * Risk band for prioritization.
   */
  risk_band: RiskBand;

  /**
   * Reason for the assigned risk band.
   */
  priority_reason: string;

  /**
   * Recommended next action.
   */
  recommended_next_action: RecommendedAction;

  /**
   * Current status.
   */
  status: BriefItemStatus;

  /**
   * Source references for this item.
   * Truncated to MAX_SOURCE_REFS.
   */
  source_refs: SourceRef[];

  /**
   * Total number of source refs (before truncation).
   */
  source_ref_count: number;

  /**
   * Whether source refs were truncated.
   */
  source_refs_truncated: boolean;

  /**
   * Ranking score (higher = higher priority).
   */
  score: number;

  /**
   * Timestamp of most recent update.
   */
  last_updated_at: string;

  /**
   * Timestamp when first detected.
   */
  first_detected_at: string;
}

/**
 * Complete Knowledge Trust Kickoff Brief.
 */
export interface KnowledgeTrustKickoffBrief {
  /**
   * The brief entries, sorted by score (descending).
   * Only includes ACTIVE and IN_PROGRESS items.
   * Already truncated to MAX_BRIEF_ITEMS.
   */
  entries: BriefEntry[];

  /**
   * Total number of items found (before filtering).
   */
  total_items: number;

  /**
   * Number of active items (after status filtering).
   */
  active_items: number;

  /**
   * Number of in-progress items.
   */
  in_progress_items: number;

  /**
   * Number of resolved items (filtered out).
   */
  resolved_items: number;

  /**
   * Number of dismissed items (filtered out).
   */
  dismissed_items: number;

  /**
   * Count by risk band.
   */
  risk_band_counts: Record<RiskBand, number>;

  /**
   * Whether the entries list was truncated.
   */
  truncated: boolean;

  /**
   * Version of the brief generation algorithm.
   */
  brief_version: string;

  /**
   * Timestamp when the brief was generated.
   */
  generated_at: string;
}

/**
 * Frontmatter metadata for the `knowledge-trust-kickoff-brief.md` note.
 */
export interface BriefMetadata {
  /**
   * Version of the brief generation algorithm.
   */
  brief_version: string;

  /**
   * Number of items included in the brief.
   */
  items_count: number;

  /**
   * Total active items found.
   */
  active_items: number;

  /**
   * Total in-progress items found.
   */
  in_progress_items: number;

  /**
   * Total resolved items found (filtered out).
   */
  resolved_items: number;

  /**
   * Total dismissed items found (filtered out).
   */
  dismissed_items: number;

  /**
   * Count by risk band.
   */
  risk_band_counts: Record<RiskBand, number>;

  /**
   * Whether the brief was truncated.
   */
  brief_truncated: boolean;

  /**
   * Timestamp when the brief was generated.
   */
  generated_at: string;
}

/**
 * Default metadata for when the brief is empty.
 */
export const DEFAULT_EMPTY_BRIEF_METADATA: BriefMetadata = {
  brief_version: KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
  items_count: 0,
  active_items: 0,
  in_progress_items: 0,
  resolved_items: 0,
  dismissed_items: 0,
  risk_band_counts: {
    [RiskBand.CRITICAL]: 0,
    [RiskBand.HIGH]: 0,
    [RiskBand.MEDIUM]: 0,
    [RiskBand.LOW]: 0,
  },
  brief_truncated: false,
  generated_at: "",
} as const;

/**
 * Risk band priority weights for ranking.
 * Higher weight = higher base score.
 */
const RISK_BAND_WEIGHTS: Record<RiskBand, number> = {
  [RiskBand.CRITICAL]: 100,
  [RiskBand.HIGH]: 75,
  [RiskBand.MEDIUM]: 50,
  [RiskBand.LOW]: 25,
};

/**
 * Item type severity weights for ranking.
 * Higher weight = contributes more to score.
 */
const ITEM_TYPE_WEIGHTS: Record<TrustItemType, number> = {
  [TrustItemType.CONTRADICTION]: 1.0,
  [TrustItemType.EVIDENCE_GAP]: 0.9,
  [TrustItemType.LOW_CONFIDENCE]: 0.8,
  [TrustItemType.STALE_ASSUMPTION]: 0.7,
  [TrustItemType.STATE_CHANGE]: 0.6,
  [TrustItemType.HISTORICAL_PATTERN]: 0.4,
};

/**
 * Recommended action mapping based on risk band and item type.
 */
export function determineRecommendedAction(
  riskBand: RiskBand,
  itemType: TrustItemType,
  status: BriefItemStatus
): RecommendedAction {
  // Resolved/dismissed items don't need actions
  if (status === BriefItemStatus.RESOLVED) {
    return RecommendedAction.ARCHIVE;
  }
  if (status === BriefItemStatus.DISMISSED) {
    return RecommendedAction.MONITOR;
  }

  // Critical items need immediate review
  if (riskBand === RiskBand.CRITICAL) {
    return RecommendedAction.REVIEW_NOW;
  }

  // High items need triage
  if (riskBand === RiskBand.HIGH) {
    if (itemType === TrustItemType.CONTRADICTION) {
      return RecommendedAction.REVIEW_NOW;
    }
    if (itemType === TrustItemType.LOW_CONFIDENCE) {
      return RecommendedAction.UPDATE_CONFIDENCE;
    }
    return RecommendedAction.TRIAGE;
  }

  // Medium items based on type
  if (riskBand === RiskBand.MEDIUM) {
    if (itemType === TrustItemType.STALE_ASSUMPTION) {
      return RecommendedAction.REVALIDATE;
    }
    if (itemType === TrustItemType.EVIDENCE_GAP) {
      return RecommendedAction.CROSS_REFERENCE;
    }
    return RecommendedAction.MONITOR;
  }

  // Low items
  return RecommendedAction.MONITOR;
}

/**
 * Compute priority reason based on risk band and item type.
 */
export function computePriorityReason(
  riskBand: RiskBand,
  itemType: TrustItemType
): string {
  const reasons: Record<RiskBand, Record<TrustItemType, string>> = {
    [RiskBand.CRITICAL]: {
      [TrustItemType.CONTRADICTION]: "Unresolved contradiction blocks reliable inference",
      [TrustItemType.EVIDENCE_GAP]: "Critical information missing for high-stakes decision",
      [TrustItemType.LOW_CONFIDENCE]: "High-confidence claim lacks sufficient evidence",
      [TrustItemType.STALE_ASSUMPTION]: "Core assumption may be outdated",
      [TrustItemType.STATE_CHANGE]: "Recent state change requires immediate attention",
      [TrustItemType.HISTORICAL_PATTERN]: "Pattern indicates systemic issue",
    },
    [RiskBand.HIGH]: {
      [TrustItemType.CONTRADICTION]: "Contradiction affects multiple inferences",
      [TrustItemType.EVIDENCE_GAP]: "Missing evidence limits confidence",
      [TrustItemType.LOW_CONFIDENCE]: "Confidence override may be needed",
      [TrustItemType.STALE_ASSUMPTION]: "Assumption may affect downstream work",
      [TrustItemType.STATE_CHANGE]: "State change impacts current work",
      [TrustItemType.HISTORICAL_PATTERN]: "Pattern suggests attention needed",
    },
    [RiskBand.MEDIUM]: {
      [TrustItemType.CONTRADICTION]: "Minor contradiction detected",
      [TrustItemType.EVIDENCE_GAP]: "Evidence gap noted",
      [TrustItemType.LOW_CONFIDENCE]: "Confidence level below threshold",
      [TrustItemType.STALE_ASSUMPTION]: "Assumption aging - consider revalidation",
      [TrustItemType.STATE_CHANGE]: "State change recorded",
      [TrustItemType.HISTORICAL_PATTERN]: "Pattern observed",
    },
    [RiskBand.LOW]: {
      [TrustItemType.CONTRADICTION]: "Low-impact contradiction",
      [TrustItemType.EVIDENCE_GAP]: "Minor evidence gap",
      [TrustItemType.LOW_CONFIDENCE]: "Low confidence item",
      [TrustItemType.STALE_ASSUMPTION]: "Aging assumption",
      [TrustItemType.STATE_CHANGE]: "Historical state change",
      [TrustItemType.HISTORICAL_PATTERN]: "Background pattern",
    },
  };

  return reasons[riskBand]?.[itemType] || "Standard priority";
}

/**
 * Compute a deterministic hash from a string.
 */
function computeDeterministicHash(str: string): string {
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

    const hex = hash.toString(16).padStart(16, "0").slice(-16);
    chunks.push(hex);
  }

  return chunks.join("");
}

/**
 * Compute brief item ID from dashboard item ID and source type.
 */
export function computeBriefItemId(
  dashboardItemId: string,
  sourceType: TrustSourceType
): string {
  return computeDeterministicHash(`${dashboardItemId}:${sourceType}`);
}

/**
 * Compute the ranking score for a brief entry.
 *
 * Score formula:
 * score = (riskBandWeight × 50) + (itemTypeWeight × 30) + (recencyScore × 20)
 *
 * Where:
 * - riskBandWeight (0-100): Base weight from risk band
 * - itemTypeWeight (0-100): Weighted by item type severity
 * - recencyScore (0-100): Higher for more recently updated items
 *
 * Maximum possible score: 100
 */
export function computeEntryScore(
  riskBand: RiskBand,
  itemType: TrustItemType,
  lastUpdatedAt: string
): number {
  // Risk band base score (50% weight)
  const riskBandWeight = RISK_BAND_WEIGHTS[riskBand];

  // Item type weight (30% weight, scaled to 0-100)
  const itemTypeWeight = ITEM_TYPE_WEIGHTS[itemType] * 100;

  // Recency score (20% weight)
  const now = new Date();
  const lastUpdated = new Date(lastUpdatedAt);
  const daysSinceUpdate = Math.max(
    0,
    (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24)
  );
  // Decays over 30 days
  const recencyScore = Math.max(0, 100 - (daysSinceUpdate / 30) * 100);

  // Weighted sum
  const score =
    riskBandWeight * 0.5 +
    itemTypeWeight * 0.3 +
    recencyScore * 0.2;

  return Math.round(score * 100) / 100;
}

/**
 * Deterministic sorting and tie-break rules for brief entries.
 *
 * Primary sort: score (descending - higher scores first)
 * Secondary sort: risk_band (CRITICAL > HIGH > MEDIUM > LOW)
 * Tertiary sort: last_updated_at (descending - more recent first)
 * Quaternary sort: brief_item_id (ascending - deterministic fallback)
 *
 * This ensures that identical inputs produce identical output order.
 */
export function sortEntriesDeterministically(
  entries: BriefEntry[]
): BriefEntry[] {
  const riskBandOrder: Record<RiskBand, number> = {
    [RiskBand.CRITICAL]: 4,
    [RiskBand.HIGH]: 3,
    [RiskBand.MEDIUM]: 2,
    [RiskBand.LOW]: 1,
  };

  return [...entries].sort((a, b) => {
    // Primary: score (higher = better)
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    // Secondary: risk band (higher = more critical)
    const riskDiff = riskBandOrder[b.risk_band] - riskBandOrder[a.risk_band];
    if (riskDiff !== 0) {
      return riskDiff;
    }

    // Tertiary: last_updated_at (more recent = higher priority)
    if (a.last_updated_at !== b.last_updated_at) {
      return b.last_updated_at.localeCompare(a.last_updated_at);
    }

    // Quaternary: brief_item_id (ascending for determinism)
    return a.brief_item_id.localeCompare(b.brief_item_id);
  });
}

/**
 * Deduplication rules.
 *
 * When the same dashboard_item_id appears in multiple sources:
 * 1. Prefer DASHBOARD source over STATE_SYNC over HISTORY
 * 2. Use the most recent last_updated_at
 * 3. Merge source refs from all occurrences
 * 4. Use the highest risk_band (CRITICAL > HIGH > MEDIUM > LOW)
 *
 * Source precedence:
 * - DASHBOARD: Most authoritative, reflects current state
 * - STATE_SYNC: Secondary, reflects sync status
 * - HISTORY: Least authoritative, historical record
 */
const SOURCE_PRECEDENCE: Record<TrustSourceType, number> = {
  [TrustSourceType.DASHBOARD]: 3,
  [TrustSourceType.STATE_SYNC]: 2,
  [TrustSourceType.HISTORY]: 1,
};

const RISK_BAND_ORDER: Record<RiskBand, number> = {
  [RiskBand.CRITICAL]: 4,
  [RiskBand.HIGH]: 3,
  [RiskBand.MEDIUM]: 2,
  [RiskBand.LOW]: 1,
};

/**
 * Dedupe trust item inputs by dashboard_item_id.
 *
 * @param inputs - All trust item inputs
 * @returns Deduplicated inputs with merged source refs and highest risk band
 */
export function dedupeTrustItemInputs(
  inputs: TrustItemInput[]
): TrustItemInput[] {
  const groups = new Map<string, TrustItemInput[]>();

  // Group by dashboard_item_id
  for (const input of inputs) {
    const existing = groups.get(input.dashboard_item_id) || [];
    existing.push(input);
    groups.set(input.dashboard_item_id, existing);
  }

  // Merge each group
  const deduped: TrustItemInput[] = [];
  for (const [_, group] of groups) {
    if (group.length === 1) {
      deduped.push(group[0]!);
      continue;
    }

    // Sort by source precedence (highest first), then by last_updated_at (most recent first)
    const sorted = [...group].sort((a, b) => {
      const sourceDiff = SOURCE_PRECEDENCE[b.source_type] - SOURCE_PRECEDENCE[a.source_type];
      if (sourceDiff !== 0) return sourceDiff;
      return b.last_updated_at.localeCompare(a.last_updated_at);
    });

    const primary = sorted[0]!;

    // Find highest risk band
    const highestRisk = group.reduce((highest, item) => {
      return RISK_BAND_ORDER[item.risk_band] > RISK_BAND_ORDER[highest] ? item.risk_band : highest;
    }, group[0]!.risk_band);

    // Merge related clip paths
    const allClipPaths = new Set<string>();
    for (const item of group) {
      if (item.related_clip_paths) {
        for (const path of item.related_clip_paths) {
          allClipPaths.add(path);
        }
      }
    }

    // Merge context
    const mergedContext: Record<string, unknown> = {};
    for (const item of group) {
      if (item.context) {
        Object.assign(mergedContext, item.context);
      }
    }

    deduped.push({
      ...primary,
      risk_band: highestRisk,
      related_clip_paths: Array.from(allClipPaths),
      context: Object.keys(mergedContext).length > 0 ? mergedContext : undefined,
    });
  }

  return deduped;
}

/**
 * Build source refs with truncation.
 */
export function buildSourceRefs(
  refs: SourceRef[]
): {
  refs: SourceRef[];
  truncated: boolean;
} {
  // Sort by timestamp (most recent first)
  const sortedRefs = [...refs].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
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
 * Maximum length for description text.
 */
export const MAX_DESCRIPTION_LENGTH = 300 as const;

/**
 * Truncate description text.
 */
export function truncateDescription(
  description: string
): { truncated: string; wasTruncated: boolean } {
  if (description.length <= MAX_DESCRIPTION_LENGTH) {
    return { truncated: description, wasTruncated: false };
  }

  const truncated = description.slice(0, MAX_DESCRIPTION_LENGTH - 3) + "...";
  return { truncated, wasTruncated: true };
}

/**
 * Build a brief entry from trust item input.
 */
export function buildBriefEntry(
  input: TrustItemInput
): BriefEntry {
  const brief_item_id = computeBriefItemId(
    input.dashboard_item_id,
    input.source_type
  );

  const { truncated: description, wasTruncated: descriptionTruncated } =
    truncateDescription(input.description);

  const score = computeEntryScore(
    input.risk_band,
    input.item_type,
    input.last_updated_at
  );

  const recommendedAction = determineRecommendedAction(
    input.risk_band,
    input.item_type,
    input.status
  );

  const priorityReason = computePriorityReason(input.risk_band, input.item_type);

  // Build source refs (single source for this item)
  const sourceRef: SourceRef = {
    source_type: input.source_type,
    source_path: input.source_path,
    dashboard_item_id: input.dashboard_item_id,
    timestamp: input.last_updated_at,
  };

  const { refs: trimmedRefs, truncated: refsTruncated } = buildSourceRefs([sourceRef]);

  return {
    brief_item_id,
    dashboard_item_id: input.dashboard_item_id,
    item_type: input.item_type,
    description,
    description_truncated: descriptionTruncated,
    risk_band: input.risk_band,
    priority_reason: priorityReason,
    recommended_next_action: recommendedAction,
    status: input.status,
    source_refs: trimmedRefs,
    source_ref_count: 1,
    source_refs_truncated: refsTruncated,
    score,
    last_updated_at: input.last_updated_at,
    first_detected_at: input.first_detected_at,
  };
}

/**
 * Build the complete Knowledge Trust Kickoff Brief.
 *
 * This is the main entry point for brief generation.
 *
 * @param trustItemInputs - All trust items from dashboard/state-sync/history
 * @returns The complete brief with metadata
 */
export function buildKnowledgeTrustKickoffBrief(
  trustItemInputs: TrustItemInput[]
): KnowledgeTrustKickoffBrief {
  const now = new Date().toISOString();

  // Deduplicate inputs
  const dedupedInputs = dedupeTrustItemInputs(trustItemInputs);

  // Build entries
  const entries = dedupedInputs.map((input) => buildBriefEntry(input));

  // Filter out resolved/dismissed items
  const activeEntries = entries.filter(
    (e) => e.status === BriefItemStatus.ACTIVE
  );
  const inProgressEntries = entries.filter(
    (e) => e.status === BriefItemStatus.IN_PROGRESS
  );
  const resolvedEntries = entries.filter(
    (e) => e.status === BriefItemStatus.RESOLVED
  );
  const dismissedEntries = entries.filter(
    (e) => e.status === BriefItemStatus.DISMISSED
  );

  // Combine active and in-progress for the brief
  const eligibleEntries = [...activeEntries, ...inProgressEntries];

  // Sort deterministically
  const sortedEntries = sortEntriesDeterministically(eligibleEntries);

  // Truncate to max items
  const truncated = sortedEntries.length > MAX_BRIEF_ITEMS;
  const trimmedEntries = sortedEntries.slice(0, MAX_BRIEF_ITEMS);

  // Count by risk band
  const riskBandCounts: Record<RiskBand, number> = {
    [RiskBand.CRITICAL]: 0,
    [RiskBand.HIGH]: 0,
    [RiskBand.MEDIUM]: 0,
    [RiskBand.LOW]: 0,
  };
  for (const entry of entries) {
    riskBandCounts[entry.risk_band]++;
  }

  // Build result
  const brief: KnowledgeTrustKickoffBrief = {
    entries: trimmedEntries,
    total_items: entries.length,
    active_items: activeEntries.length,
    in_progress_items: inProgressEntries.length,
    resolved_items: resolvedEntries.length,
    dismissed_items: dismissedEntries.length,
    risk_band_counts: riskBandCounts,
    truncated,
    brief_version: KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION,
    generated_at: now,
  };

  return brief;
}

/**
 * Extract metadata from a KnowledgeTrustKickoffBrief.
 */
export function extractBriefMetadata(
  brief: KnowledgeTrustKickoffBrief
): BriefMetadata {
  return {
    brief_version: brief.brief_version,
    items_count: brief.entries.length,
    active_items: brief.active_items,
    in_progress_items: brief.in_progress_items,
    resolved_items: brief.resolved_items,
    dismissed_items: brief.dismissed_items,
    risk_band_counts: brief.risk_band_counts,
    brief_truncated: brief.truncated,
    generated_at: brief.generated_at,
  };
}

/**
 * Render the `knowledge-trust-kickoff-brief.md` note.
 *
 * Format:
 * ```markdown
 * ---
 * brief_version: 1.0.0
 * items_count: 5
 * active_items: 5
 * in_progress_items: 2
 * resolved_items: 3
 * dismissed_items: 1
 * risk_band_counts:
 *   critical: 1
 *   high: 2
 *   medium: 1
 *   low: 1
 * brief_truncated: false
 * generated_at: 2026-03-04T10:00:00.000Z
 * ---
 *
 * # Knowledge Trust Kickoff Brief
 *
 * ## Summary
 *
 * **Active items:** 5 | **In Progress:** 2 | **Resolved:** 3 | **Dismissed:** 1
 *
 * **Risk Distribution:**
 * - 🔴 Critical: 1
 * - 🟠 High: 2
 * - 🟡 Medium: 1
 * - 🟢 Low: 1
 *
 * ## High-Priority Items
 *
 * ### [1] [CRITICAL] Unresolved contradiction blocks reliable inference
 *
 * **Type:** contradiction | **Score:** 92.5
 * **Action:** review-now
 *
 * Description of the contradiction issue...
 *
 * **Sources:**
 * - dashboard: [[knowledge-trust-dashboard.md]]
 *
 * ---
 *
 * ### [2] [HIGH] Contradiction affects multiple inferences
 *
 * ...
 * ```
 */
export function renderKnowledgeTrustKickoffBrief(
  brief: KnowledgeTrustKickoffBrief
): string {
  const metadata = extractBriefMetadata(brief);

  // Build frontmatter
  const frontmatterLines = ["---"];
  frontmatterLines.push(`brief_version: ${metadata.brief_version}`);
  frontmatterLines.push(`items_count: ${metadata.items_count}`);
  frontmatterLines.push(`active_items: ${metadata.active_items}`);
  frontmatterLines.push(`in_progress_items: ${metadata.in_progress_items}`);
  frontmatterLines.push(`resolved_items: ${metadata.resolved_items}`);
  frontmatterLines.push(`dismissed_items: ${metadata.dismissed_items}`);
  frontmatterLines.push(`risk_band_counts:`);
  frontmatterLines.push(`  critical: ${metadata.risk_band_counts[RiskBand.CRITICAL]}`);
  frontmatterLines.push(`  high: ${metadata.risk_band_counts[RiskBand.HIGH]}`);
  frontmatterLines.push(`  medium: ${metadata.risk_band_counts[RiskBand.MEDIUM]}`);
  frontmatterLines.push(`  low: ${metadata.risk_band_counts[RiskBand.LOW]}`);
  frontmatterLines.push(`brief_truncated: ${metadata.brief_truncated}`);
  frontmatterLines.push(`generated_at: ${metadata.generated_at}`);
  frontmatterLines.push("---");
  frontmatterLines.push("");

  // Build body
  const bodyLines: string[] = [];
  bodyLines.push("# Knowledge Trust Kickoff Brief");
  bodyLines.push("");

  // Summary section
  bodyLines.push("## Summary");
  bodyLines.push("");
  bodyLines.push(`**Active items:** ${metadata.active_items} | **In Progress:** ${metadata.in_progress_items} | **Resolved:** ${metadata.resolved_items} | **Dismissed:** ${metadata.dismissed_items}`);
  bodyLines.push("");
  bodyLines.push("**Risk Distribution:**");
  bodyLines.push(`- 🔴 Critical: ${metadata.risk_band_counts[RiskBand.CRITICAL]}`);
  bodyLines.push(`- 🟠 High: ${metadata.risk_band_counts[RiskBand.HIGH]}`);
  bodyLines.push(`- 🟡 Medium: ${metadata.risk_band_counts[RiskBand.MEDIUM]}`);
  bodyLines.push(`- 🟢 Low: ${metadata.risk_band_counts[RiskBand.LOW]}`);
  if (metadata.brief_truncated) {
    bodyLines.push("");
    bodyLines.push(`> ⚠️ Brief truncated to ${MAX_BRIEF_ITEMS} highest-priority items`);
  }
  bodyLines.push("");

  // High-priority items section
  bodyLines.push("## High-Priority Items");
  bodyLines.push("");

  if (brief.entries.length === 0) {
    bodyLines.push("> ✅ No active trust issues. Ready to proceed with confidence.");
    bodyLines.push("");
  } else {
    for (let i = 0; i < brief.entries.length; i++) {
      const entry = brief.entries[i]!;
      const rank = i + 1;

      const riskEmoji = {
        [RiskBand.CRITICAL]: "🔴",
        [RiskBand.HIGH]: "🟠",
        [RiskBand.MEDIUM]: "🟡",
        [RiskBand.LOW]: "🟢",
      }[entry.risk_band];

      bodyLines.push(`### [${rank}] [${entry.risk_band.toUpperCase()}] ${entry.priority_reason}`);
      bodyLines.push("");
      bodyLines.push(`**Type:** ${entry.item_type} | **Score:** ${entry.score}`);
      bodyLines.push(`**Action:** ${entry.recommended_next_action}`);
      bodyLines.push(`**Status:** ${entry.status}`);
      bodyLines.push("");
      bodyLines.push(entry.description);
      if (entry.description_truncated) {
        bodyLines.push("> ⚠️ Description truncated");
      }
      bodyLines.push("");

      // Sources
      bodyLines.push("**Sources:**");
      for (const ref of entry.source_refs) {
        bodyLines.push(`- ${ref.source_type}: [[${ref.source_path}]] (item: ${ref.dashboard_item_id})`);
      }
      if (entry.source_refs_truncated) {
        bodyLines.push(`- ... and ${entry.source_ref_count - MAX_SOURCE_REFS} more sources`);
      }
      bodyLines.push("");
      bodyLines.push("---");
      bodyLines.push("");
    }
  }

  // Generated footer
  bodyLines.push("");
  bodyLines.push(`*Generated by Obsidian Web Clipper v${metadata.brief_version} on ${new Date(metadata.generated_at).toLocaleString()}*`);
  bodyLines.push("");

  return [...frontmatterLines, ...bodyLines].join("\n");
}

/**
 * Truncation policy summary.
 *
 * The brief is bounded at two levels:
 *
 * 1. Entry-level truncation: MAX_BRIEF_ITEMS (20)
 *    - Only the top 20 highest-scoring items are included
 *    - Lower-scoring items are dropped
 *    - brief_truncated = true when truncation occurs
 *
 * 2. Source ref truncation: MAX_SOURCE_REFS (5)
 *    - Only the 5 most recent source refs are listed per item
 *    - source_refs_truncated = true when truncation occurs
 *    - source_ref_count preserves the actual count
 *
 * 3. Description truncation: MAX_DESCRIPTION_LENGTH (300)
 *    - Description text longer than 300 chars is truncated with "..." suffix
 *    - description_truncated = true when truncation occurs
 *
 * This prevents the brief from growing unbounded even for large vaults.
 */

/**
 * Empty state behavior.
 *
 * When no active/in-progress items exist:
 * - The brief note is still created with frontmatter
 * - items_count = 0, active_items = 0, in_progress_items = 0
 * - brief_truncated = false (nothing to truncate)
 * - Body shows "✅ No active trust issues. Ready to proceed with confidence."
 *
 * When no source artifacts exist:
 * - All counts are zero
 * - Note is still created (acts as a placeholder)
 */

/**
 * Diagnostics fields & versioning.
 *
 * All frontmatter metadata fields are always present, even when empty.
 *
 * Required fields:
 * - `brief_version`: Algorithm version (e.g., "1.0.0")
 * - `items_count`: Number of items included in brief
 * - `active_items`: Total active items found
 * - `in_progress_items`: Total in-progress items found
 * - `resolved_items`: Total resolved items found (filtered out)
 * - `dismissed_items`: Total dismissed items found (filtered out)
 * - `risk_band_counts`: Object with counts per risk band
 * - `brief_truncated`: Boolean indicating entry-level truncation
 * - `generated_at`: ISO 8601 timestamp when brief was generated
 *
 * Versioning contract:
 * - Increment `KNOWLEDGE_TRUST_KICKOFF_BRIEF_VERSION` when:
 *   - Ranking/scoring formula changes
 *   - Tie-break rules change
 *   - Dedupe precedence rules change
 *   - Truncation bounds change
 * - Keep version as semantic string "MAJOR.MINOR.PATCH"
 * - MAJOR: Breaking changes to entry structure/metadata
 * - MINOR: Scoring/tie-break/dedupe formula updates
 * - PATCH: Bug fixes with same outputs
 */

/**
 * Integration with save pipeline.
 *
 * The brief should be regenerated after each clip save:
 * 1. Read knowledge-trust-dashboard.md for current trust state
 * 2. Read knowledge-trust-dashboard-state-sync.md for sync status
 * 3. Read knowledge-trust-dashboard-history.ndjson for historical context
 * 4. Parse all items into TrustItemInput format
 * 5. Build brief using buildKnowledgeTrustKickoffBrief()
 * 6. Render markdown using renderKnowledgeTrustKickoffBrief()
 * 7. Save/overwrite `knowledge-trust-kickoff-brief.md` in the vault
 *
 * On failure (e.g., read/parse error):
 * - Log the error
 * - Do not corrupt the existing brief
 * - Continue with clip save (brief refresh is non-critical)
 *
 * For deterministic behavior, the brief generation should use:
 * - Stable time window for scanning
 * - Alphabetical sorting for file enumeration
 * - Deterministic parsing of source artifacts
 */

/**
 * Deterministic ranking and tie-break rules.
 *
 * Ranking formula:
 * score = (riskBandWeight × 0.5) + (itemTypeWeight × 0.3) + (recencyScore × 0.2)
 *
 * Risk band weights:
 * - CRITICAL: 100
 * - HIGH: 75
 * - MEDIUM: 50
 * - LOW: 25
 *
 * Item type weights (multiplied by 100):
 * - CONTRADICTION: 1.0
 * - EVIDENCE_GAP: 0.9
 * - LOW_CONFIDENCE: 0.8
 * - STALE_ASSUMPTION: 0.7
 * - STATE_CHANGE: 0.6
 * - HISTORICAL_PATTERN: 0.4
 *
 * Recency score:
 * - Decays linearly over 30 days
 * - score = max(0, 100 - (daysSinceUpdate / 30) × 100)
 *
 * Tie-break order (when scores are equal):
 * 1. Risk band (CRITICAL > HIGH > MEDIUM > LOW)
 * 2. Last updated timestamp (more recent first)
 * 3. Brief item ID (ascending lexicographic)
 */

/**
 * Dedupe rules.
 *
 * When the same dashboard_item_id appears in multiple sources:
 *
 * 1. Source precedence (higher wins):
 *    - DASHBOARD (3) > STATE_SYNC (2) > HISTORY (1)
 *
 * 2. Risk band escalation:
 *    - Use the highest risk band across all occurrences
 *    - CRITICAL > HIGH > MEDIUM > LOW
 *
 * 3. Timestamp selection:
 *    - Use last_updated_at from the highest-precedence source
 *    - Falls back to most recent if same precedence
 *
 * 4. Source ref merging:
 *    - Merge all related_clip_paths from all occurrences
 *    - Merge all context fields (later sources override earlier)
 *
 * This ensures the brief reflects the most current and severe state
 * for each trust item.
 */
