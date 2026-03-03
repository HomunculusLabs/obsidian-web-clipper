/**
 * Retrieval Query Pack Contract
 *
 * This module defines the contract for generating deterministic retrieval queries from
 * clip artifacts. It specifies how existing clip metadata (entities, keywords,
 * taxonomy, context pack) are transformed into bounded, searchable query outputs
 * for immediate vault search pivots.
 *
 * Core Goals:
 * - Deterministic: Same inputs always produce same outputs
 * - Stable: Query ordering and truncation remain consistent across runs
 * - Observable: All behavior is covered by frontmatter diagnostics
 * - Bounded: Query output is always truncated to a known maximum
 * - Zero LLM dependency: Queries are derived from existing artifacts only
 */

/**
 * Version of the query pack generation algorithm.
 * Increment this when the derivation logic, ranking formula, or truncation rules change.
 */
export const QUERY_PACK_VERSION = "1.0.0" as const;

/**
 * Maximum number of exact phrase queries to include in the query pack.
 * Exact phrases are multi-word strings that should be searched as literal matches.
 */
export const MAX_EXACT_PHRASE_QUERIES = 10 as const;

/**
 * Maximum number of keyword boolean queries to include in the query pack.
 * Keyword queries are boolean combinations (AND/OR) of single terms for flexible search.
 */
export const MAX_KEYWORD_BOOLEAN_QUERIES = 10 as const;

/**
 * Maximum number of entity query seeds to include in the query pack.
 * Entity seeds are single entities (concepts, topics, named entities) for broad matching.
 */
export const MAX_ENTITY_QUERY_SEEDS = 10 as const;

/**
 * Combined maximum across all query types.
 * Ensures the entire Retrieval Query Pack section stays bounded.
 */
export const MAX_TOTAL_QUERIES =
  MAX_EXACT_PHRASE_QUERIES +
  MAX_KEYWORD_BOOLEAN_QUERIES +
  MAX_ENTITY_QUERY_SEEDS;

/**
 * Input data for building a retrieval query pack.
 * This is derived from existing clip artifacts without external LLM calls.
 */
export interface RetrievalQueryPackInput {
  /**
   * Title of the clipped content.
   * Used to derive key exact phrases.
   */
  title: string;

  /**
   * Description from metadata.
   * Used to extract additional exact phrases and keywords.
   */
  description?: string;

  /**
   * Concept taxonomy from clip artifacts.
   * Hierarchical classification providing domain-specific context.
   * Example: ["Technology", "Programming", "TypeScript", "API Design"]
   */
  conceptTaxonomy?: string[];

  /**
   * Knowledge entities from clip artifacts.
   * Extracted named entities, topics, and key concepts.
   * Example: ["interface", "generics", "type inference", "type safety"]
   */
  knowledgeEntities?: string[];

  /**
   * Keywords from meta tags and JSON-LD.
   * Author-provided keywords describing the content.
   * Example: ["typescript", "api", "rest", "typescript-interface"]
   */
  keywords?: string[];

  /**
   * Source URL for domain-based query context.
   * Used to derive domain-specific queries.
   */
  sourceUrl?: string;

  /**
   * Content type (article, video, document, tweet).
   * Influences query ranking and phrase extraction strategy.
   */
  contentType: string;

  /**
   * Author or channel name.
   * Can be used for author-focused queries.
   */
  author?: string;

  /**
   * Published date (ISO 8601 format).
   * Used for time-bounded query ranking (recent = higher priority).
   */
  publishedDate?: string;
}

/**
 * A single exact phrase query.
 * These are multi-word strings that should be searched as literal matches
 * in quotes for precise retrieval.
 */
export interface ExactPhraseQuery {
  /**
   * The exact phrase string.
   * Should be searched in quotes for literal matching.
   */
  phrase: string;

  /**
   * Source artifact where this phrase was derived from.
   * Traceability for debugging.
   */
  source: "title" | "description" | "taxonomy" | "entities";

  /**
   * Relevance score (0-100).
   * Higher scores indicate more discriminative, useful phrases.
   */
  score: number;
}

/**
 * A keyword boolean query.
 * These are flexible combinations of single terms using AND/OR logic.
 * Format: "term1 AND term2" or "term1 OR term2"
 */
export interface KeywordBooleanQuery {
  /**
   * The boolean query string.
   * Can use AND/OR operators for flexible matching.
   */
  query: string;

  /**
   * Operator type (AND or OR).
   * AND for narrowing (both terms required), OR for broadening (either term matches).
   */
  operator: "AND" | "OR";

  /**
   * Individual terms in this query.
   */
  terms: string[];

  /**
   * Source artifact where terms were derived from.
   */
  source: "keywords" | "taxonomy" | "entities" | "title";

  /**
   * Relevance score (0-100).
   * Higher scores indicate more useful boolean combinations.
   */
  score: number;
}

/**
 * An entity query seed.
 * These are single entities for broad, entity-based matching.
 */
export interface EntityQuerySeed {
  /**
   * The entity term.
   */
  entity: string;

  /**
   * Source artifact where this entity was derived.
   */
  source: "knowledge_entities" | "taxonomy" | "keywords";

  /**
   * Relevance score (0-100).
   * Higher scores indicate more central, discriminative entities.
   */
  score: number;
}

/**
 * Complete retrieval query pack.
 * Contains all query types with truncation already applied.
 */
export interface RetrievalQueryPack {
  /**
   * Exact phrase queries, sorted by score (descending).
   * Truncated to MAX_EXACT_PHRASE_QUERIES.
   */
  exactPhrases: ExactPhraseQuery[];

  /**
   * Keyword boolean queries, sorted by score (descending).
   * Truncated to MAX_KEYWORD_BOOLEAN_QUERIES.
   */
  keywordBooleans: KeywordBooleanQuery[];

  /**
   * Entity query seeds, sorted by score (descending).
   * Truncated to MAX_ENTITY_QUERY_SEEDS.
   */
  entitySeeds: EntityQuerySeed[];

  /**
   * Total number of queries generated (before truncation).
   */
  totalGenerated: number;

  /**
   * Total number of queries included (after truncation).
   */
  totalIncluded: number;

  /**
   * Whether any query type was truncated.
   */
  truncated: boolean;

  /**
   * Version of the query pack generation algorithm used.
   */
  version: string;
}

/**
 * Frontmatter diagnostics emitted for every saved clip.
 * These fields are always present, even when no queries are generated.
 */
export interface QueryPackDiagnostics {
  /**
   * Number of exact phrase queries included.
   * Always present; 0 when no queries generated.
   */
  query_pack_exact_phrases: number;

  /**
   * Number of keyword boolean queries included.
   * Always present; 0 when no queries generated.
   */
  query_pack_keyword_booleans: number;

  /**
   * Number of entity query seeds included.
   * Always present; 0 when no queries generated.
   */
  query_pack_entity_seeds: number;

  /**
   * Total number of queries included in the pack.
   */
  query_pack_total_queries: number;

  /**
   * Whether the query pack was truncated.
   * false when no truncation needed or no queries generated.
   */
  query_pack_truncated: boolean;

  /**
   * Version of the query pack generation algorithm used.
   */
  query_pack_version: string;
}

/**
 * Default diagnostics for when no queries are generated.
 */
export const DEFAULT_NO_QUERY_DIAGNOSTICS: QueryPackDiagnostics = {
  query_pack_exact_phrases: 0,
  query_pack_keyword_booleans: 0,
  query_pack_entity_seeds: 0,
  query_pack_total_queries: 0,
  query_pack_truncated: false,
  query_pack_version: QUERY_PACK_VERSION,
} as const;

/**
 * Extract diagnostics from a RetrievalQueryPack.
 *
 * @param pack - The retrieval query pack
 * @returns Diagnostics object for frontmatter
 */
export function extractQueryPackDiagnostics(
  pack: RetrievalQueryPack
): QueryPackDiagnostics {
  return {
    query_pack_exact_phrases: pack.exactPhrases.length,
    query_pack_keyword_booleans: pack.keywordBooleans.length,
    query_pack_entity_seeds: pack.entitySeeds.length,
    query_pack_total_queries: pack.totalIncluded,
    query_pack_truncated: pack.truncated,
    query_pack_version: pack.version,
  };
}

/**
 * Render the "## Retrieval Query Pack" section markdown.
 *
 * Format:
 * ```markdown
 * ## Retrieval Query Pack
 *
 * ### Exact Phrase Queries
 * - "exact phrase one"
 * - "another exact phrase"
 *
 * ### Keyword Boolean Queries
 * - term1 AND term2
 * - term3 OR term4
 *
 * ### Entity Query Seeds
 * - entity1
 * - entity2
 * ```
 *
 * @param pack - The retrieval query pack
 * @returns Markdown string, or empty string if no queries
 */
export function renderRetrievalQueryPackSection(
  pack: RetrievalQueryPack
): string {
  const hasExactPhrases = pack.exactPhrases.length > 0;
  const hasKeywordBooleans = pack.keywordBooleans.length > 0;
  const hasEntitySeeds = pack.entitySeeds.length > 0;

  // Render nothing if no queries at all
  if (!hasExactPhrases && !hasKeywordBooleans && !hasEntitySeeds) {
    return "";
  }

  const lines: string[] = ["## Retrieval Query Pack", ""];

  // Exact Phrase Queries
  if (hasExactPhrases) {
    lines.push("### Exact Phrase Queries", "");
    for (const phrase of pack.exactPhrases) {
      lines.push(`- "${phrase.phrase}"`);
    }
    lines.push("");
  }

  // Keyword Boolean Queries
  if (hasKeywordBooleans) {
    lines.push("### Keyword Boolean Queries", "");
    for (const bool of pack.keywordBooleans) {
      lines.push(`- ${bool.query}`);
    }
    lines.push("");
  }

  // Entity Query Seeds
  if (hasEntitySeeds) {
    lines.push("### Entity Query Seeds", "");
    for (const seed of pack.entitySeeds) {
      lines.push(`- ${seed.entity}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/**
 * Exact Phrase Query Scoring Rules
 *
 * Exact phrases are multi-word strings (3+ words) that should be searched
 * as literal matches. They are ranked by discriminative power.
 *
 * Score factors:
 * - Phrase length: Longer phrases (more words) score higher (up to 40 pts)
 * - Word count: 3-4 words = 20 pts, 5+ words = 40 pts
 * - Uniqueness: Phrases with rare words score higher (up to 30 pts)
 * - Source priority: title (30 pts) > description (20 pts) > taxonomy (15 pts) > entities (10 pts)
 * - Publication recency: Recent content (last 6 months) gets +10 pts
 *
 * Maximum possible score: 100
 */

/**
 * Keyword Boolean Query Scoring Rules
 *
 * Keyword boolean queries combine single terms using AND/OR logic.
 * They are ranked by specificity and coverage.
 *
 * Score factors:
 * - Term count: 2-term combinations = 20 pts, 3+ terms = 40 pts
 * - Operator specificity: AND = +20 pts (narrower), OR = +0 pts (broader)
 * - Source priority: keywords (30 pts) > taxonomy (20 pts) > entities (15 pts) > title (10 pts)
 * - Term uniqueness: Rare terms score higher (up to 20 pts)
 * - Publication recency: Recent content (last 6 months) gets +10 pts
 *
 * Maximum possible score: 100
 */

/**
 * Entity Query Seed Scoring Rules
 *
 * Entity seeds are single entities for broad matching.
 * They are ranked by centrality and discriminative power.
 *
 * Score factors:
 * - Entity type: Specific entities (40 pts) > general concepts (20 pts) > common words (10 pts)
 * - Source priority: knowledge_entities (30 pts) > taxonomy (20 pts) > keywords (10 pts)
 * - Frequency: Entities appearing in multiple sources get +15 pts
 * - Length: Longer entities (2+ words) get +10 pts
 * - Publication recency: Recent content (last 6 months) gets +15 pts
 *
 * Maximum possible score: 100
 */

/**
 * Deterministic Ranking & Tie-Break Rules
 *
 * All query types are sorted by score (descending). When scores are equal,
 * deterministic tie-breaks ensure stable output across runs.
 *
 * Tie-break order (primary to tertiary):
 * 1. Published date (descending): More recent content gets priority
 * 2. Source (priority order):
 *    - For exact phrases: title > description > taxonomy > entities
 *    - For keyword booleans: keywords > taxonomy > entities > title
 *    - For entity seeds: knowledge_entities > taxonomy > keywords
 * 3. Lexicographic order: Alphabetical by query string/phrase/entity name
 *
 * This ensures that identical inputs produce identical output order.
 */

/**
 * Truncation Rules
 *
 * Query packs are bounded to prevent unbounded growth:
 * - Exact phrase queries: Truncated to MAX_EXACT_PHRASE_QUERIES (10)
 * - Keyword boolean queries: Truncated to MAX_KEYWORD_BOOLEAN_QUERIES (10)
 * - Entity query seeds: Truncated to MAX_ENTITY_QUERY_SEEDS (10)
 * - Total across all types: Implicitly bounded to MAX_TOTAL_QUERIES (30)
 *
 * When truncation occurs:
 * - Lower-scoring queries are dropped first
 * - Diagnostics field `query_pack_truncated` is set to `true`
 * - Frontmatter shows counts of included queries (not original counts)
 *
 * If no queries can be generated (e.g., minimal content):
 * - The "## Retrieval Query Pack" section is not rendered at all
 * - All diagnostic fields remain present with zero values
 * - `query_pack_truncated` is `false` (nothing to truncate)
 */

/**
 * Section Schema (Markdown)
 *
 * The "## Retrieval Query Pack" section has three optional subsections.
 * Each subsection only appears if it has non-empty content.
 *
 * Schema:
 * ```markdown
 * ## Retrieval Query Pack
 *
 * ### Exact Phrase Queries
 * - "phrase one"
 * - "phrase two"
 *
 * ### Keyword Boolean Queries
 * - term1 AND term2
 * - term3 OR term4
 *
 * ### Entity Query Seeds
 * - entity1
 * - entity2
 * ```
 *
 * Section ordering: Exact Phrase → Keyword Boolean → Entity Query
 * (this order is fixed and deterministic)
 *
 * Each query type is rendered as a bulleted list.
 * Exact phrases are enclosed in double quotes for literal search.
 */

/**
 * Diagnostics Fields & Versioning
 *
 * All frontmatter diagnostics are always present, even when no queries are generated.
 *
 * Required fields:
 * - `query_pack_version`: Algorithm version (e.g., "1.0.0")
 * - `query_pack_exact_phrases`: Count of exact phrase queries included
 * - `query_pack_keyword_booleans`: Count of keyword boolean queries included
 * - `query_pack_entity_seeds`: Count of entity query seeds included
 * - `query_pack_total_queries`: Sum of all query counts
 * - `query_pack_truncated`: Boolean indicating truncation occurred
 *
 * Versioning contract:
 * - Increment `QUERY_PACK_VERSION` when:
 *   - Scoring formulas change
 *   - Truncation bounds change
 *   - Query type derivation logic changes
 *   - Tie-break rules change
 * - Keep version as semantic string "MAJOR.MINOR.PATCH"
 * - MAJOR: Breaking changes to query structure/diagnostics
 * - MINOR: Scoring/tie-break formula updates
 * - PATCH: Bug fixes with same outputs
 */

/**
 * Domain extraction utility.
 *
 * Extracts the hostname from a URL for domain-specific query context.
 *
 * @param url - The URL to parse
 * @returns Domain string, or empty string if parsing fails
 */
export function extractQueryDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return "";
  }
}

/**
 * Normalize a query string.
 *
 * Removes extra whitespace, normalizes quotes, and trims.
 *
 * @param query - The query to normalize
 * @returns Normalized query string
 */
export function normalizeQueryString(query: string): string {
  return query
    .trim()
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .replace(/[""]/g, '"') // Normalize quotes
    .replace(/['']/g, "'"); // Normalize apostrophes
}

/**
 * Check if a date string represents recent content (last 6 months).
 *
 * Used for recency-based scoring bonuses.
 *
 * @param publishedDate - ISO 8601 date string
 * @returns true if date is within last 6 months, false otherwise
 */
export function isRecentContent(publishedDate?: string): boolean {
  if (!publishedDate) {
    return false;
  }

  try {
    const published = new Date(publishedDate);
    const now = new Date();
    const sixMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 6,
      now.getDate()
    );

    return published >= sixMonthsAgo && published <= now;
  } catch {
    return false;
  }
}
