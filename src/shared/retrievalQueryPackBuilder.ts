/**
 * Retrieval Query Pack Builder
 *
 * This module implements the deterministic query generation logic for retrieval
 * query packs. It derives exact-phrase, boolean keyword, and entity-seed queries
 * from existing clip artifacts with stable output ordering.
 *
 * All query generation is deterministic: given the same inputs, the same
 * queries are produced with the same scores and ordering.
 *
 * Vault Index Integration:
 * When vault candidates are provided, the builder can enhance query generation
 * by considering term frequency across the vault for discriminative scoring.
 * This ensures related/query generation shares one indexed corpus per save flow.
 */

import type {
  ExactPhraseQuery,
  KeywordBooleanQuery,
  EntityQuerySeed,
  RetrievalQueryPack,
  RetrievalQueryPackInput,
  QueryPackDiagnostics,
  DEFAULT_NO_QUERY_DIAGNOSTICS,
} from "./retrievalQueryPackContract";
import {
  QUERY_PACK_VERSION,
  MAX_EXACT_PHRASE_QUERIES,
  MAX_KEYWORD_BOOLEAN_QUERIES,
  MAX_ENTITY_QUERY_SEEDS,
  MAX_TOTAL_QUERIES,
  extractQueryPackDiagnostics,
  isRecentContent,
  normalizeQueryString,
} from "./retrievalQueryPackContract";
import type { CandidateNote } from "./relatedClipsContract";

/**
 * Common words to filter out from queries.
 * These are stopwords that add little discriminatory power.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "what",
  "which",
  "who",
  "whom",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "also",
  "now",
  "here",
  "there",
  "then",
  "once",
  "about",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "under",
  "again",
  "further",
  "while",
]);

/**
 * Source priority scores for exact phrase queries.
 * Higher priority = higher base score.
 */
const EXACT_PHRASE_SOURCE_PRIORITY: Record<
  "title" | "description" | "taxonomy" | "entities",
  number
> = {
  title: 30,
  description: 20,
  taxonomy: 15,
  entities: 10,
};

/**
 * Source priority scores for keyword boolean queries.
 */
const KEYWORD_BOOLEAN_SOURCE_PRIORITY: Record<
  "keywords" | "taxonomy" | "entities" | "title",
  number
> = {
  keywords: 30,
  taxonomy: 20,
  entities: 15,
  title: 10,
};

/**
 * Source priority scores for entity query seeds.
 */
const ENTITY_QUERY_SEED_SOURCE_PRIORITY: Record<
  "knowledge_entities" | "taxonomy" | "keywords",
  number
> = {
  knowledge_entities: 30,
  taxonomy: 20,
  keywords: 10,
};

/**
 * Vault index context for enhanced query generation.
 * Passed from related clips matcher to enable sharing one indexed corpus per save flow.
 */
export interface VaultIndexContext {
  /** Indexed candidate notes from the vault */
  candidates: CandidateNote[];

  /** Cache diagnostics (optional, for observability) */
  cacheDiagnostics?: {
    cacheHit: boolean;
    cacheAgeMs: number;
    cacheRebuilt: boolean;
  };
}

/**
 * Compute term frequency across vault candidates.
 *
 * Used to identify discriminative terms that appear in few notes
 * (high value for search) vs common terms (low discriminative power).
 *
 * @param candidates - Vault candidate notes
 * @returns Map of lowercase term to frequency count
 */
function computeVaultTermFrequency(
  candidates: CandidateNote[]
): Map<string, number> {
  const frequency = new Map<string, number>();

  for (const candidate of candidates) {
    // Count entities
    for (const entity of candidate.entities) {
      const normalized = entity.toLowerCase();
      frequency.set(normalized, (frequency.get(normalized) || 0) + 1);
    }

    // Count tags
    for (const tag of candidate.tags) {
      const normalized = tag.toLowerCase();
      frequency.set(normalized, (frequency.get(normalized) || 0) + 1);
    }
  }

  return frequency;
}

/**
 * Calculate discriminative score bonus based on vault term frequency.
 *
 * Terms that appear in fewer vault notes are more discriminative
 * and get higher scores for search queries.
 *
 * @param term - Term to score
 * @param vaultFrequency - Term frequency map from vault
 * @param totalCandidates - Total number of candidates in vault
 * @returns Discriminative bonus score (0-20)
 */
function calculateDiscriminativeBonus(
  term: string,
  vaultFrequency: Map<string, number>,
  totalCandidates: number
): number {
  if (totalCandidates === 0) return 0;

  const normalized = term.toLowerCase();
  const freq = vaultFrequency.get(normalized) || 0;

  // No occurrence in vault = unknown, neutral score
  if (freq === 0) return 10;

  // Calculate rarity ratio (0 = very rare, 1 = very common)
  const rarityRatio = freq / totalCandidates;

  // Rare terms (appear in <5% of notes) get high bonus
  if (rarityRatio < 0.05) return 20;
  // Uncommon terms (appear in <10% of notes) get medium bonus
  if (rarityRatio < 0.10) return 15;
  // Moderate terms (appear in <20% of notes) get small bonus
  if (rarityRatio < 0.20) return 10;
  // Common terms (appear in <50% of notes) get minimal bonus
  if (rarityRatio < 0.50) return 5;
  // Very common terms get no bonus
  return 0;
}

/**
 * Tokenize text into words, removing punctuation and normalizing case.
 *
 * @param text - Text to tokenize
 * @returns Array of normalized words
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Extract n-gram phrases from text.
 *
 * @param text - Text to extract phrases from
 * @param minLength - Minimum phrase length in words
 * @returns Array of phrase strings
 */
function extractNGramPhrases(
  text: string,
  minLength: number
): string[] {
  const words = tokenize(text);
  const phrases: string[] = [];

  for (let i = 0; i <= words.length - minLength; i++) {
    for (let len = minLength; len <= 5 && i + len <= words.length; len++) {
      const phrase = words.slice(i, i + len).join(" ");
      phrases.push(phrase);
    }
  }

  return phrases;
}

/**
 * Filter out phrases that are too short or contain only stopwords.
 *
 * @param phrase - Phrase to validate
 * @returns true if phrase is valid
 */
function isValidPhrase(phrase: string): boolean {
  const words = tokenize(phrase);
  if (words.length < 3) return false;

  const meaningfulWords = words.filter((w) => !STOPWORDS.has(w));
  return meaningfulWords.length >= 2;
}

/**
 * Calculate word uniqueness score for a phrase.
 *
 * @param phrase - Phrase to score
 * @param allPhrases - All phrases being scored (for frequency comparison)
 * @returns Uniqueness score (0-30)
 */
function calculateUniquenessScore(
  phrase: string,
  allPhrases: string[]
): number {
  const phraseLower = phrase.toLowerCase();
  const frequency = allPhrases.filter(
    (p) => p.toLowerCase() === phraseLower
  ).length;

  if (frequency === 1) return 30;
  if (frequency === 2) return 20;
  if (frequency <= 4) return 10;
  return 0;
}

/**
 * Generate exact phrase queries from input artifacts.
 *
 * @param input - Retrieval query pack input
 * @returns Array of exact phrase queries with scores
 */
function generateExactPhraseQueries(
  input: RetrievalQueryPackInput
): ExactPhraseQuery[] {
  const queries: ExactPhraseQuery[] = [];
  const isRecent = isRecentContent(input.publishedDate);

  // Extract phrases from title
  if (input.title) {
    const phrases = extractNGramPhrases(input.title, 3);
    for (const phrase of phrases) {
      if (isValidPhrase(phrase)) {
        queries.push({
          phrase: normalizeQueryString(phrase),
          source: "title",
          score: 0, // Will be calculated
        });
      }
    }
  }

  // Extract phrases from description
  if (input.description) {
    const phrases = extractNGramPhrases(input.description, 3);
    for (const phrase of phrases) {
      if (isValidPhrase(phrase)) {
        queries.push({
          phrase: normalizeQueryString(phrase),
          source: "description",
          score: 0,
        });
      }
    }
  }

  // Extract phrases from concept taxonomy
  if (input.conceptTaxonomy && input.conceptTaxonomy.length > 0) {
    for (const taxonomyItem of input.conceptTaxonomy) {
      const phrases = extractNGramPhrases(taxonomyItem, 2);
      for (const phrase of phrases) {
        if (phrase.split(" ").length >= 2) {
          queries.push({
            phrase: normalizeQueryString(phrase),
            source: "taxonomy",
            score: 0,
          });
        }
      }
    }
  }

  // Extract phrases from knowledge entities
  if (input.knowledgeEntities && input.knowledgeEntities.length > 0) {
    for (const entity of input.knowledgeEntities) {
      const phrases = extractNGramPhrases(entity, 2);
      for (const phrase of phrases) {
        if (phrase.split(" ").length >= 2) {
          queries.push({
            phrase: normalizeQueryString(phrase),
            source: "entities",
            score: 0,
          });
        }
      }
    }
  }

  // Deduplicate queries
  const seen = new Set<string>();
  const uniqueQueries: ExactPhraseQuery[] = [];
  for (const query of queries) {
    const key = `${query.phrase.toLowerCase()}-${query.source}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueQueries.push(query);
    }
  }

  // Calculate scores for all queries
  const allPhrases = uniqueQueries.map((q) => q.phrase);
  for (const query of uniqueQueries) {
    const wordCount = query.phrase.split(" ").length;
    const lengthScore = wordCount >= 5 ? 40 : 20;
    const uniquenessScore = calculateUniquenessScore(
      query.phrase,
      allPhrases
    );
    const sourceScore = EXACT_PHRASE_SOURCE_PRIORITY[query.source];
    const recencyScore = isRecent ? 10 : 0;

    query.score = Math.min(100, lengthScore + uniquenessScore + sourceScore + recencyScore);
  }

  return uniqueQueries;
}

/**
 * Generate keyword boolean queries from input artifacts.
 *
 * @param input - Retrieval query pack input
 * @returns Array of keyword boolean queries with scores
 */
function generateKeywordBooleanQueries(
  input: RetrievalQueryPackInput
): KeywordBooleanQuery[] {
  const queries: KeywordBooleanQuery[] = [];
  const isRecent = isRecentContent(input.publishedDate);

  // Collect all terms from different sources
  const termSources: Array<{ term: string; source: "keywords" | "taxonomy" | "entities" | "title" }> =
    [];

  // Keywords source
  if (input.keywords && input.keywords.length > 0) {
    for (const keyword of input.keywords) {
      const terms = tokenize(keyword);
      for (const term of terms) {
        if (!STOPWORDS.has(term) && term.length >= 2) {
          termSources.push({ term, source: "keywords" });
        }
      }
    }
  }

  // Taxonomy source
  if (input.conceptTaxonomy && input.conceptTaxonomy.length > 0) {
    for (const taxonomyItem of input.conceptTaxonomy) {
      const terms = tokenize(taxonomyItem);
      for (const term of terms) {
        if (!STOPWORDS.has(term) && term.length >= 2) {
          termSources.push({ term, source: "taxonomy" });
        }
      }
    }
  }

  // Knowledge entities source
  if (input.knowledgeEntities && input.knowledgeEntities.length > 0) {
    for (const entity of input.knowledgeEntities) {
      const terms = tokenize(entity);
      for (const term of terms) {
        if (!STOPWORDS.has(term) && term.length >= 2) {
          termSources.push({ term, source: "entities" });
        }
      }
    }
  }

  // Title source
  if (input.title) {
    const terms = tokenize(input.title);
    for (const term of terms) {
      if (!STOPWORDS.has(term) && term.length >= 2) {
        termSources.push({ term, source: "title" });
      }
    }
  }

  // Deduplicate terms
  const termMap = new Map<
    string,
    { source: "keywords" | "taxonomy" | "entities" | "title"; frequency: number }
  >();

  for (const { term, source } of termSources) {
    const existing = termMap.get(term);
    if (existing) {
      existing.frequency++;
      // Upgrade source priority
      const priorities = ["title", "entities", "taxonomy", "keywords"];
      const existingIdx = priorities.indexOf(existing.source);
      const newIdx = priorities.indexOf(source);
      if (newIdx > existingIdx) {
        existing.source = source;
      }
    } else {
      termMap.set(term, { source, frequency: 1 });
    }
  }

  // Convert to array
  const uniqueTerms = Array.from(termMap.entries()).map(
    ([term, data]) => ({ term, ...data })
  );

  // Generate boolean queries (2-term and 3-term combinations)
  const termCount = uniqueTerms.length;
  const maxCombinations = Math.min(50, termCount * (termCount - 1) / 2); // Cap combinations

  let combinationIndex = 0;

  // Generate 2-term combinations
  for (let i = 0; i < termCount && combinationIndex < maxCombinations; i++) {
    for (let j = i + 1; j < termCount && combinationIndex < maxCombinations; j++) {
      const term1 = uniqueTerms[i];
      const term2 = uniqueTerms[j];

      // Use AND for same-source terms (narrowing), OR for different sources (broadening)
      const operator = term1.source === term2.source ? "AND" : "OR";
      const queryStr = `${term1.term} ${operator} ${term2.term}`;

      // Use highest source priority
      const source =
        KEYWORD_BOOLEAN_SOURCE_PRIORITY[term1.source] >=
        KEYWORD_BOOLEAN_SOURCE_PRIORITY[term2.source]
          ? term1.source
          : term2.source;

      queries.push({
        query: queryStr,
        operator,
        terms: [term1.term, term2.term],
        source,
        score: 0, // Will be calculated
      });

      combinationIndex++;
    }
  }

  // Generate 3-term combinations (for smaller term sets)
  if (termCount <= 10) {
    for (let i = 0; i < termCount - 2 && combinationIndex < maxCombinations; i++) {
      for (let j = i + 1; j < termCount - 1 && combinationIndex < maxCombinations; j++) {
        for (let k = j + 1; k < termCount && combinationIndex < maxCombinations; k++) {
          const term1 = uniqueTerms[i];
          const term2 = uniqueTerms[j];
          const term3 = uniqueTerms[k];

          // Use AND for all terms from same source
          const allSameSource = term1.source === term2.source && term2.source === term3.source;
          const operator = allSameSource ? "AND" : "OR";
          const queryStr = `${term1.term} ${operator} ${term2.term} ${operator} ${term3.term}`;

          const source =
            KEYWORD_BOOLEAN_SOURCE_PRIORITY[term1.source] >=
            KEYWORD_BOOLEAN_SOURCE_PRIORITY[term2.source] &&
            KEYWORD_BOOLEAN_SOURCE_PRIORITY[term1.source] >=
            KEYWORD_BOOLEAN_SOURCE_PRIORITY[term3.source]
              ? term1.source
              : KEYWORD_BOOLEAN_SOURCE_PRIORITY[term2.source] >=
                  KEYWORD_BOOLEAN_SOURCE_PRIORITY[term3.source]
                ? term2.source
                : term3.source;

          queries.push({
            query: queryStr,
            operator,
            terms: [term1.term, term2.term, term3.term],
            source,
            score: 0,
          });

          combinationIndex++;
        }
      }
    }
  }

  // Calculate scores
  const termFrequencyMap = new Map(uniqueTerms.map((t) => [t.term, t.frequency]));

  for (const query of queries) {
    const termCount = query.terms.length;
    const countScore = termCount >= 3 ? 40 : 20;
    const operatorScore = query.operator === "AND" ? 20 : 0;
    const sourceScore = KEYWORD_BOOLEAN_SOURCE_PRIORITY[query.source];

    // Calculate term uniqueness (lower frequency = higher score)
    const avgFrequency =
      query.terms.reduce((sum, term) => sum + (termFrequencyMap.get(term) || 1), 0) /
      query.terms.length;
    const uniquenessScore = avgFrequency === 1 ? 20 : avgFrequency <= 2 ? 10 : 0;

    const recencyScore = isRecent ? 10 : 0;

    query.score = Math.min(
      100,
      countScore + operatorScore + sourceScore + uniquenessScore + recencyScore
    );
  }

  return queries;
}

/**
 * Generate entity query seeds from input artifacts.
 *
 * When vault context is provided, uses vault term frequency for
 * discriminative scoring to prioritize terms that are rare across
 * the vault (more useful for targeted searches).
 *
 * @param input - Retrieval query pack input
 * @param vaultContext - Optional vault index context for enhanced scoring
 * @returns Array of entity query seeds with scores
 */
function generateEntityQuerySeeds(
  input: RetrievalQueryPackInput,
  vaultContext?: VaultIndexContext
): EntityQuerySeed[] {
  const seeds: EntityQuerySeed[] = [];
  const isRecent = isRecentContent(input.publishedDate);

  // Compute vault term frequency if context available
  const vaultFrequency = vaultContext?.candidates
    ? computeVaultTermFrequency(vaultContext.candidates)
    : new Map<string, number>();
  const totalCandidates = vaultContext?.candidates?.length || 0;

  // Track frequency across sources
  const entityMap = new Map<
    string,
    {
      sources: Set<"knowledge_entities" | "taxonomy" | "keywords">;
      wordCount: number;
    }
  >();

  // Collect from knowledge entities
  if (input.knowledgeEntities && input.knowledgeEntities.length > 0) {
    for (const entity of input.knowledgeEntities) {
      const normalized = normalizeQueryString(entity);
      const words = tokenize(entity);
      entityMap.set(normalized, {
        sources: new Set(["knowledge_entities"]),
        wordCount: words.length,
      });
    }
  }

  // Collect from concept taxonomy
  if (input.conceptTaxonomy && input.conceptTaxonomy.length > 0) {
    for (const taxonomyItem of input.conceptTaxonomy) {
      const normalized = normalizeQueryString(taxonomyItem);
      const words = tokenize(taxonomyItem);
      const existing = entityMap.get(normalized);
      if (existing) {
        existing.sources.add("taxonomy");
      } else {
        entityMap.set(normalized, {
          sources: new Set(["taxonomy"]),
          wordCount: words.length,
        });
      }
    }
  }

  // Collect from keywords
  if (input.keywords && input.keywords.length > 0) {
    for (const keyword of input.keywords) {
      const normalized = normalizeQueryString(keyword);
      const words = tokenize(keyword);
      const existing = entityMap.get(normalized);
      if (existing) {
        existing.sources.add("keywords");
      } else {
        entityMap.set(normalized, {
          sources: new Set(["keywords"]),
          wordCount: words.length,
        });
      }
    }
  }

  // Convert to entity seeds
  for (const [entity, data] of entityMap.entries()) {
    // Determine primary source (highest priority)
    let primarySource: "knowledge_entities" | "taxonomy" | "keywords" = "keywords";
    if (data.sources.has("knowledge_entities")) {
      primarySource = "knowledge_entities";
    } else if (data.sources.has("taxonomy")) {
      primarySource = "taxonomy";
    }

    // Calculate entity type score
    const isMultiWord = data.wordCount >= 2;
    const isSpecific = isMultiWord && data.wordCount >= 3;
    let typeScore: number;
    if (isSpecific) {
      typeScore = 40; // Specific entity
    } else if (isMultiWord) {
      typeScore = 20; // General concept
    } else {
      typeScore = 10; // Common word
    }

    // Calculate source score
    const sourceScore = ENTITY_QUERY_SEED_SOURCE_PRIORITY[primarySource];

    // Calculate frequency bonus (appears in multiple sources)
    const frequencyBonus = data.sources.size >= 2 ? 15 : 0;

    // Calculate length bonus
    const lengthBonus = isMultiWord ? 10 : 0;

    // Calculate recency bonus
    const recencyScore = isRecent ? 15 : 0;

    // Calculate discriminative bonus from vault context
    const discriminativeBonus = calculateDiscriminativeBonus(
      entity,
      vaultFrequency,
      totalCandidates
    );

    seeds.push({
      entity,
      source: primarySource,
      score: Math.min(
        100,
        typeScore + sourceScore + frequencyBonus + lengthBonus + recencyScore + discriminativeBonus
      ),
    });
  }

  return seeds;
}

/**
 * Sort exact phrase queries by score (descending) with deterministic tie-breaks.
 *
 * @param queries - Queries to sort
 * @param publishedDate - Publication date for tie-breaking
 * @returns Sorted queries
 */
function sortExactPhraseQueries(
  queries: ExactPhraseQuery[],
  publishedDate?: string
): ExactPhraseQuery[] {
  return queries.sort((a, b) => {
    // Primary: score (descending)
    if (a.score !== b.score) return b.score - a.score;

    // Secondary: source priority
    const sourceOrder = ["title", "description", "taxonomy", "entities"];
    const aSourceIdx = sourceOrder.indexOf(a.source);
    const bSourceIdx = sourceOrder.indexOf(b.source);
    if (aSourceIdx !== bSourceIdx) return aSourceIdx - bSourceIdx;

    // Tertiary: lexicographic by phrase
    return a.phrase.localeCompare(b.phrase);
  });
}

/**
 * Sort keyword boolean queries by score (descending) with deterministic tie-breaks.
 *
 * @param queries - Queries to sort
 * @param publishedDate - Publication date for tie-breaking
 * @returns Sorted queries
 */
function sortKeywordBooleanQueries(
  queries: KeywordBooleanQuery[],
  publishedDate?: string
): KeywordBooleanQuery[] {
  return queries.sort((a, b) => {
    // Primary: score (descending)
    if (a.score !== b.score) return b.score - a.score;

    // Secondary: source priority
    const sourceOrder = ["keywords", "taxonomy", "entities", "title"];
    const aSourceIdx = sourceOrder.indexOf(a.source);
    const bSourceIdx = sourceOrder.indexOf(b.source);
    if (aSourceIdx !== bSourceIdx) return aSourceIdx - bSourceIdx;

    // Tertiary: lexicographic by query
    return a.query.localeCompare(b.query);
  });
}

/**
 * Sort entity query seeds by score (descending) with deterministic tie-breaks.
 *
 * @param seeds - Seeds to sort
 * @param publishedDate - Publication date for tie-breaking
 * @returns Sorted seeds
 */
function sortEntityQuerySeeds(
  seeds: EntityQuerySeed[],
  publishedDate?: string
): EntityQuerySeed[] {
  return seeds.sort((a, b) => {
    // Primary: score (descending)
    if (a.score !== b.score) return b.score - a.score;

    // Secondary: source priority
    const sourceOrder = ["knowledge_entities", "taxonomy", "keywords"];
    const aSourceIdx = sourceOrder.indexOf(a.source);
    const bSourceIdx = sourceOrder.indexOf(b.source);
    if (aSourceIdx !== bSourceIdx) return aSourceIdx - bSourceIdx;

    // Tertiary: lexicographic by entity
    return a.entity.localeCompare(b.entity);
  });
}

/**
 * Build a retrieval query pack from input artifacts.
 *
 * This is the main entry point for generating query packs.
 *
 * When vault context is provided, entity query seeds are enhanced with
 * discriminative scoring based on vault term frequency. This ensures
 * related/query generation shares one indexed corpus per save flow.
 *
 * @param input - Retrieval query pack input
 * @param vaultContext - Optional vault index context for enhanced scoring
 * @returns Complete retrieval query pack
 */
export function buildRetrievalQueryPack(
  input: RetrievalQueryPackInput,
  vaultContext?: VaultIndexContext
): RetrievalQueryPack {
  // Generate all query types
  const exactPhrasesUnsorted = generateExactPhraseQueries(input);
  const keywordBooleansUnsorted = generateKeywordBooleanQueries(input);
  // Pass vault context for enhanced entity seed scoring
  const entitySeedsUnsorted = generateEntityQuerySeeds(input, vaultContext);

  // Sort with deterministic tie-breaks
  const exactPhrases = sortExactPhraseQueries(
    exactPhrasesUnsorted,
    input.publishedDate
  );
  const keywordBooleans = sortKeywordBooleanQueries(
    keywordBooleansUnsorted,
    input.publishedDate
  );
  const entitySeeds = sortEntityQuerySeeds(entitySeedsUnsorted, input.publishedDate);

  // Truncate to bounds
  const truncatedExactPhrases = exactPhrases.slice(0, MAX_EXACT_PHRASE_QUERIES);
  const truncatedKeywordBooleans = keywordBooleans.slice(0, MAX_KEYWORD_BOOLEAN_QUERIES);
  const truncatedEntitySeeds = entitySeeds.slice(0, MAX_ENTITY_QUERY_SEEDS);

  const totalGenerated =
    exactPhrases.length + keywordBooleans.length + entitySeeds.length;
  const totalIncluded =
    truncatedExactPhrases.length +
    truncatedKeywordBooleans.length +
    truncatedEntitySeeds.length;

  const truncated = totalIncluded < totalGenerated;

  return {
    exactPhrases: truncatedExactPhrases,
    keywordBooleans: truncatedKeywordBooleans,
    entitySeeds: truncatedEntitySeeds,
    totalGenerated,
    totalIncluded,
    truncated,
    version: QUERY_PACK_VERSION,
  };
}

/**
 * Get diagnostics for an empty query pack.
 *
 * Use this when no queries are generated.
 *
 * @returns Default no-query diagnostics
 */
export function getNoQueryDiagnostics(): QueryPackDiagnostics {
  return {
    query_pack_exact_phrases: 0,
    query_pack_keyword_booleans: 0,
    query_pack_entity_seeds: 0,
    query_pack_total_queries: 0,
    query_pack_truncated: false,
    query_pack_version: QUERY_PACK_VERSION,
  };
}

/**
 * Build query pack and extract diagnostics in one call.
 *
 * Convenience function for the common case of building a pack
 * and immediately extracting diagnostics.
 *
 * @param input - Retrieval query pack input
 * @param vaultContext - Optional vault index context for enhanced scoring
 * @returns Tuple of [query pack, diagnostics]
 */
export function buildQueryPackWithDiagnostics(
  input: RetrievalQueryPackInput,
  vaultContext?: VaultIndexContext
): [RetrievalQueryPack, QueryPackDiagnostics] {
  const pack = buildRetrievalQueryPack(input, vaultContext);
  const diagnostics = extractQueryPackDiagnostics(pack);
  return [pack, diagnostics];
}

/**
 * Check if a query pack is empty (no queries).
 *
 * @param pack - Retrieval query pack
 * @returns true if pack has no queries
 */
export function isEmptyQueryPack(pack: RetrievalQueryPack): boolean {
  return (
    pack.exactPhrases.length === 0 &&
    pack.keywordBooleans.length === 0 &&
    pack.entitySeeds.length === 0
  );
}

/**
 * Merge multiple query pack inputs and build a single pack.
 *
 * Useful when combining artifacts from multiple sources.
 *
 * @param inputs - Array of query pack inputs to merge
 * @returns Merged retrieval query pack
 */
export function mergeAndBuildQueryPacks(
  inputs: RetrievalQueryPackInput[]
): RetrievalQueryPack {
  if (inputs.length === 0) {
    return {
      exactPhrases: [],
      keywordBooleans: [],
      entitySeeds: [],
      totalGenerated: 0,
      totalIncluded: 0,
      truncated: false,
      version: QUERY_PACK_VERSION,
    };
  }

  // Merge all fields
  const mergedInput: RetrievalQueryPackInput = {
    title: inputs.map((i) => i.title).join(" "),
    description: inputs.map((i) => i.description).filter(Boolean).join(" "),
    conceptTaxonomy: [
      ...new Set(inputs.flatMap((i) => i.conceptTaxonomy || [])),
    ],
    knowledgeEntities: [
      ...new Set(inputs.flatMap((i) => i.knowledgeEntities || [])),
    ],
    keywords: [...new Set(inputs.flatMap((i) => i.keywords || []))],
    sourceUrl: inputs.find((i) => i.sourceUrl)?.sourceUrl,
    contentType: inputs[0].contentType,
    author: inputs.find((i) => i.author)?.author,
    publishedDate: inputs.reduce((newest, i) => {
      if (!i.publishedDate) return newest;
      if (!newest) return i.publishedDate;
      return i.publishedDate > newest ? i.publishedDate : newest;
    }, inputs[0].publishedDate),
  };

  return buildRetrievalQueryPack(mergedInput);
}

/**
 * Validate a query pack against the contract.
 *
 * Checks that the pack adheres to expected bounds and structure.
 *
 * @param pack - Retrieval query pack to validate
 * @returns true if pack is valid
 */
export function validateQueryPack(pack: RetrievalQueryPack): boolean {
  // Check bounds
  if (pack.exactPhrases.length > MAX_EXACT_PHRASE_QUERIES) return false;
  if (pack.keywordBooleans.length > MAX_KEYWORD_BOOLEAN_QUERIES) return false;
  if (pack.entitySeeds.length > MAX_ENTITY_QUERY_SEEDS) return false;
  if (pack.totalIncluded > MAX_TOTAL_QUERIES) return false;

  // Check score bounds
  for (const phrase of pack.exactPhrases) {
    if (phrase.score < 0 || phrase.score > 100) return false;
  }
  for (const bool of pack.keywordBooleans) {
    if (bool.score < 0 || bool.score > 100) return false;
  }
  for (const seed of pack.entitySeeds) {
    if (seed.score < 0 || seed.score > 100) return false;
  }

  // Check truncated flag matches actual truncation
  const expectedTruncated =
    pack.exactPhrases.length !== MAX_EXACT_PHRASE_QUERIES ||
    pack.keywordBooleans.length !== MAX_KEYWORD_BOOLEAN_QUERIES ||
    pack.entitySeeds.length !== MAX_ENTITY_QUERY_SEEDS;
  if (pack.totalGenerated > pack.totalIncluded && !pack.truncated) {
    return false;
  }

  // Check version
  if (pack.version !== QUERY_PACK_VERSION) {
    return false;
  }

  return true;
}
