import type { ClipMetadata } from "./types";
import type { DomainTagRule } from "./domainTags";
import { DEFAULT_DOMAIN_TAG_RULES, extractDomainTagsFromRules } from "./domainTags";
import {
  shouldExcludeWord,
  MIN_KEYWORD_FREQUENCY,
  MAX_KEYWORDS,
  isGenericTechTerm,
} from "./stoplist";
import { detectCategories as detectCategoriesImpl, categoryToTag } from "./categoryDetection";
import { getFrequentTags, type TagHistoryEntry } from "./tagHistory";

/**
 * Tag suggestion result with confidence score
 */
export interface TagSuggestion {
  tag: string;
  confidence: number; // 0-1, higher = more confident
  source: "metadata" | "content" | "domain" | "category" | "history";
}

/**
 * Options for tag suggestion.
 */
export interface TagSuggestionOptions {
  /** Custom domain tag rules (combined with defaults if useDefaultDomainTags is true) */
  domainTagRules?: DomainTagRule[];
  /** Whether to include default domain tag rules */
  useDefaultDomainTags?: boolean;
}

/**
 * Suggests tags based on page metadata and content.
 *
 * This is the main entry point for tag suggestion. It combines multiple
 * strategies (metadata extraction, content analysis, domain-based rules)
 * to generate relevant tag suggestions.
 *
 * @param metadata - Clip metadata containing URL, title, keywords, etc.
 * @param content - The markdown content of the clipped page
 * @param options - Optional configuration for tag suggestion
 * @returns Array of suggested tags (deduplicated, sorted by confidence)
 */
export function suggestTags(
  metadata: ClipMetadata,
  content: string,
  options?: TagSuggestionOptions
): string[] {
  const suggestions: Map<string, TagSuggestion> = new Map();

  // Build the combined domain tag rules
  const domainRules = buildDomainRules(options);

  // Strategy 1: Extract from metadata (keywords, JSON-LD, etc.)
  const metadataTags = extractMetadataTags(metadata);
  for (const suggestion of metadataTags) {
    const key = suggestion.tag.toLowerCase();
    if (!suggestions.has(key) || suggestions.get(key)!.confidence < suggestion.confidence) {
      suggestions.set(key, suggestion);
    }
  }

  // Strategy 2: Domain-based tags (configurable via options)
  const domainTags = extractDomainTags(metadata.url, domainRules);
  for (const suggestion of domainTags) {
    const key = suggestion.tag.toLowerCase();
    if (!suggestions.has(key)) {
      suggestions.set(key, suggestion);
    }
  }

  // Strategy 3: Content keyword extraction (placeholder for Task 58)
  const contentTags = extractContentKeywords(content);
  for (const suggestion of contentTags) {
    const key = suggestion.tag.toLowerCase();
    if (!suggestions.has(key)) {
      suggestions.set(key, suggestion);
    }
  }

  // Strategy 4: Category detection (placeholder for Task 60)
  const categoryTags = detectCategories(metadata, content);
  for (const suggestion of categoryTags) {
    const key = suggestion.tag.toLowerCase();
    if (!suggestions.has(key)) {
      suggestions.set(key, suggestion);
    }
  }

  // Sort by confidence and return just the tag names
  const sorted = Array.from(suggestions.values())
    .sort((a, b) => b.confidence - a.confidence)
    .map(s => s.tag);

  return sorted;
}

/**
 * Async version of suggestTags that includes history-based suggestions.
 * Part of Task 65 - Tag history/frequency.
 *
 * @param metadata - Clip metadata containing URL, title, keywords, etc.
 * @param content - The markdown content of the clipped page
 * @param options - Optional configuration for tag suggestion
 * @returns Array of tag suggestions with source and confidence info
 */
export async function suggestTagsWithHistory(
  metadata: ClipMetadata,
  content: string,
  options?: TagSuggestionOptions
): Promise<TagSuggestion[]> {
  const suggestions: Map<string, TagSuggestion> = new Map();

  // Build the combined domain tag rules
  const domainRules = buildDomainRules(options);

  // Strategy 1: Extract from metadata (keywords, JSON-LD, etc.)
  const metadataTags = extractMetadataTags(metadata);
  for (const suggestion of metadataTags) {
    const key = suggestion.tag.toLowerCase();
    if (!suggestions.has(key) || suggestions.get(key)!.confidence < suggestion.confidence) {
      suggestions.set(key, suggestion);
    }
  }

  // Strategy 2: Domain-based tags (configurable via options)
  const domainTags = extractDomainTags(metadata.url, domainRules);
  for (const suggestion of domainTags) {
    const key = suggestion.tag.toLowerCase();
    if (!suggestions.has(key)) {
      suggestions.set(key, suggestion);
    }
  }

  // Strategy 3: Content keyword extraction
  const contentTags = extractContentKeywords(content);
  for (const suggestion of contentTags) {
    const key = suggestion.tag.toLowerCase();
    if (!suggestions.has(key)) {
      suggestions.set(key, suggestion);
    }
  }

  // Strategy 4: Category detection
  const categoryTags = detectCategories(metadata, content);
  for (const suggestion of categoryTags) {
    const key = suggestion.tag.toLowerCase();
    if (!suggestions.has(key)) {
      suggestions.set(key, suggestion);
    }
  }

  // Strategy 5: Tag history (Task 65)
  const historyTags = await getHistoryTagSuggestions();
  for (const suggestion of historyTags) {
    const key = suggestion.tag.toLowerCase();
    // Only add if not already suggested from other sources
    // (other sources have higher confidence)
    if (!suggestions.has(key)) {
      suggestions.set(key, suggestion);
    }
  }

  // Sort by confidence and return
  const sorted = Array.from(suggestions.values())
    .sort((a, b) => b.confidence - a.confidence);

  return sorted;
}

/**
 * Gets tag suggestions from history.
 * Maps frequency counts to confidence scores.
 */
async function getHistoryTagSuggestions(): Promise<TagSuggestion[]> {
  try {
    const historyTags = await getFrequentTags(10);
    
    // Map frequency to confidence
    // Most frequent tag gets 0.4, decreasing from there
    return historyTags.map((entry, index) => ({
      tag: entry.tag,
      // Scale confidence based on rank and count
      confidence: Math.max(0.2, 0.4 - (index * 0.02)),
      source: "history" as const
    }));
  } catch {
    // If history is unavailable, return empty
    return [];
  }
}

/**
 * Builds the combined domain tag rules from options.
 */
function buildDomainRules(options?: TagSuggestionOptions): DomainTagRule[] {
  const customRules = options?.domainTagRules ?? [];
  const useDefaults = options?.useDefaultDomainTags ?? true;

  if (useDefaults) {
    // Combine defaults with custom rules (custom rules can override defaults)
    const customDomains = new Set(customRules.map(r => r.domain));
    const filteredDefaults = DEFAULT_DOMAIN_TAG_RULES.filter(r => !customDomains.has(r.domain));
    return [...filteredDefaults, ...customRules];
  }

  return customRules;
}

/**
 * Extracts tags from metadata fields (keywords, JSON-LD, etc.)
 * Part of Task 59 implementation.
 */
function extractMetadataTags(metadata: ClipMetadata): TagSuggestion[] {
  const tags: TagSuggestion[] = [];

  // Extract from keywords field
  if (metadata.keywords && metadata.keywords.length > 0) {
    for (const keyword of metadata.keywords) {
      const cleaned = cleanTag(keyword);
      if (cleaned) {
        tags.push({
          tag: cleaned,
          confidence: 0.9, // High confidence - explicit metadata
          source: "metadata"
        });
      }
    }
  }

  // Extract from JSON-LD keywords
  if (metadata.jsonLd?.keywords && metadata.jsonLd.keywords.length > 0) {
    for (const keyword of metadata.jsonLd.keywords) {
      const cleaned = cleanTag(keyword);
      if (cleaned) {
        tags.push({
          tag: cleaned,
          confidence: 0.85, // High confidence - structured data
          source: "metadata"
        });
      }
    }
  }

  // Extract from Open Graph type
  if (metadata.og?.ogType) {
    const ogType = metadata.og.ogType;
    // Common OG types that make good tags
    if (["article", "video", "music", "book", "profile"].includes(ogType)) {
      tags.push({
        tag: ogType,
        confidence: 0.7,
        source: "metadata"
      });
    }
  }

  return tags;
}

/**
 * Extracts tags based on domain patterns.
 * Uses configurable domain tag rules (Task 57 - Domain-based tags).
 */
function extractDomainTags(
  url: string,
  rules: DomainTagRule[]
): TagSuggestion[] {
  return extractDomainTagsFromRules(url, rules).map(({ tag, confidence }) => ({
    tag,
    confidence,
    source: "domain" as const
  }));
}

/**
 * Extracts keywords from content using TF-IDF-like scoring.
 *
 * Implements Task 58 - Content keyword extraction:
 * - Word frequency analysis with comprehensive English stoplist
 * - Term length bonus (longer words often more specific/meaningful)
 * - Capitalization bonus (proper nouns often important)
 * - Technical term detection and appropriate scoring
 * - Phrase detection for common two-word combinations
 *
 * @param content - The markdown content to analyze
 * @returns Array of tag suggestions with confidence scores
 */
function extractContentKeywords(content: string): TagSuggestion[] {
  const tags: TagSuggestion[] = [];

  // Pre-process content: remove markdown syntax and extract clean text
  const text = preprocessContent(content);

  // Extract individual words with their original casing info
  const { words, wordPositions } = extractWords(text);

  // Count word frequencies
  const wordFreq: Map<string, number> = new Map();
  const capitalizedWords: Set<string> = new Set();

  for (const word of words) {
    const lower = word.toLowerCase();
    if (!shouldExcludeWord(lower)) {
      wordFreq.set(lower, (wordFreq.get(lower) || 0) + 1);
      // Track if word appears capitalized (potential proper noun)
      if (word[0] && word[0] === word[0].toUpperCase() && word.length > 1) {
        capitalizedWords.add(lower);
      }
    }
  }

  // Extract common bigrams (two-word phrases)
  const bigramFreq: Map<string, number> = new Map();
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i].toLowerCase();
    const w2 = words[i + 1].toLowerCase();

    // Only consider bigrams where both words are meaningful
    if (!shouldExcludeWord(w1) && !shouldExcludeWord(w2)) {
      const bigram = `${w1}-${w2}`;
      bigramFreq.set(bigram, (bigramFreq.get(bigram) || 0) + 1);
    }
  }

  // Calculate TF-IDF-like scores for each word
  const totalWords = words.length;
  const scoredWords: Array<{ word: string; score: number; freq: number }> = [];

  for (const [word, freq] of wordFreq) {
    if (freq >= MIN_KEYWORD_FREQUENCY) {
      const score = calculateKeywordScore(word, freq, totalWords, capitalizedWords.has(word));
      scoredWords.push({ word, score, freq });
    }
  }

  // Sort by score and take top keywords
  scoredWords.sort((a, b) => b.score - a.score);
  const topKeywords = scoredWords.slice(0, MAX_KEYWORDS);

  // Add bigrams that are more frequent than their individual parts
  const topBigrams: Array<{ bigram: string; score: number }> = [];
  for (const [bigram, freq] of bigramFreq) {
    if (freq >= MIN_KEYWORD_FREQUENCY + 1) {
      const [w1, w2] = bigram.split("-");
      const w1Freq = wordFreq.get(w1) || 0;
      const w2Freq = wordFreq.get(w2) || 0;

      // Bigram is interesting if it's relatively frequent compared to components
      if (freq * 2 >= Math.min(w1Freq, w2Freq)) {
        const score = calculateKeywordScore(bigram, freq, totalWords, false) * 0.9;
        topBigrams.push({ bigram, score });
      }
    }
  }
  topBigrams.sort((a, b) => b.score - a.score);

  // Combine results: prefer bigrams if they're strong, otherwise use single words
  const usedWords = new Set<string>();

  // First, add top bigrams (up to 2)
  for (const { bigram, score } of topBigrams.slice(0, 2)) {
    const [w1, w2] = bigram.split("-");
    usedWords.add(w1);
    usedWords.add(w2);
    tags.push({
      tag: bigram,
      confidence: Math.min(0.6, score),
      source: "content",
    });
  }

  // Then add top single words that aren't part of bigrams
  for (const { word, score, freq } of topKeywords) {
    if (!usedWords.has(word)) {
      tags.push({
        tag: word,
        confidence: Math.min(0.55, score),
        source: "content",
      });
    }
  }

  return tags;
}

/**
 * Pre-processes content to remove markdown syntax and extract clean text.
 */
function preprocessContent(content: string): string {
  return content
    // Remove code blocks (fenced)
    .replace(/```[\s\S]*?```/g, " ")
    // Remove inline code
    .replace(/`[^`]+`/g, " ")
    // Extract link text (keep the text, discard URL)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove image references
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, " ")
    // Remove HTML tags
    .replace(/<[^>]+>/g, " ")
    // Remove markdown heading/hash symbols
    .replace(/^#{1,6}\s+/gm, " ")
    // Remove emphasis markers
    .replace(/[*_~>|]/g, " ")
    // Remove horizontal rules
    .replace(/^[-*_]{3,}$/gm, " ")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts words from preprocessed text, preserving position info.
 */
function extractWords(text: string): { words: string[]; wordPositions: Map<string, number[]> } {
  const words: string[] = [];
  const wordPositions: Map<string, number[]> = new Map();

  // Match word-like patterns (letters, may include hyphens/numbers)
  const wordPattern = /\b[A-Za-z][A-Za-z0-9-]*\b/g;
  let match;

  while ((match = wordPattern.exec(text)) !== null) {
    const word = match[0];
    words.push(word);

    const lower = word.toLowerCase();
    const positions = wordPositions.get(lower) || [];
    positions.push(match.index);
    wordPositions.set(lower, positions);
  }

  return { words, wordPositions };
}

/**
 * Calculates a TF-IDF-like score for a keyword.
 *
 * Factors considered:
 * - Term frequency (TF): More frequent = higher score (logarithmic scaling)
 * - Word length: Longer words often more specific/meaningful
 * - Capitalization: Proper nouns (capitalized) often important
 * - Generic tech term penalty: Common programming terms get lower scores
 *
 * @param word - The word to score
 * @param freq - How many times the word appears
 * @param totalWords - Total word count in document
 * @param isCapitalized - Whether the word appears capitalized (proper noun)
 * @returns Score between 0 and 1
 */
function calculateKeywordScore(
  word: string,
  freq: number,
  totalWords: number,
  isCapitalized: boolean
): number {
  // Base score from term frequency (logarithmic scaling)
  // This prevents very frequent words from dominating
  const tfScore = Math.log(freq + 1) / Math.log(10); // log10(freq+1)

  // Length bonus: longer words often more specific
  // Capped at 12 characters (diminishing returns)
  const lengthBonus = Math.min(word.length / 12, 1) * 0.15;

  // Proper noun bonus (capitalized words often names/important terms)
  const capitalBonus = isCapitalized ? 0.1 : 0;

  // Penalize generic tech terms slightly
  const genericPenalty = isGenericTechTerm(word) ? -0.1 : 0;

  // Document length normalization
  // Longer documents naturally have higher frequencies
  const lengthNorm = Math.min(1, 500 / totalWords);

  // Combine scores
  const rawScore = (tfScore * 0.5 + lengthBonus + capitalBonus + genericPenalty) * lengthNorm;

  // Normalize to 0-1 range
  return Math.max(0, Math.min(1, rawScore + 0.2)); // +0.2 to boost base score slightly
}

/**
 * Detects content categories using the category detection module.
 * Implements Task 60 - Category detection.
 */
function detectCategories(metadata: ClipMetadata, content: string): TagSuggestion[] {
  const results = detectCategoriesImpl(metadata, content);

  return results.map((result) => ({
    tag: categoryToTag(result.category),
    confidence: result.confidence,
    source: result.source,
  }));
}

/**
 * Cleans and normalizes a tag string.
 */
function cleanTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-") // Replace non-alphanumeric with dash
    .replace(/-+/g, "-") // Collapse multiple dashes
    .replace(/^-|-$/g, "") // Remove leading/trailing dashes
    .substring(0, 50); // Limit length
}
