import type { ClipMetadata } from "./types";
import type { DomainTagRule } from "./domainTags";
import { DEFAULT_DOMAIN_TAG_RULES, extractDomainTagsFromRules } from "./domainTags";

/**
 * Tag suggestion result with confidence score
 */
export interface TagSuggestion {
  tag: string;
  confidence: number; // 0-1, higher = more confident
  source: "metadata" | "content" | "domain" | "category";
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
 * Extracts keywords from content using simple frequency analysis.
 * Placeholder for Task 58 - Content keyword extraction.
 */
function extractContentKeywords(content: string): TagSuggestion[] {
  const tags: TagSuggestion[] = [];

  // Simple implementation: extract frequent words
  // This will be enhanced in Task 58 with TF-IDF and stoplist

  // Common English stoplist (basic version)
  const stoplist = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
    "be", "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "this", "that", "these",
    "those", "i", "you", "he", "she", "it", "we", "they", "what", "which",
    "who", "when", "where", "why", "how", "all", "each", "every", "both",
    "few", "more", "most", "other", "some", "such", "no", "not", "only",
    "own", "same", "so", "than", "too", "very", "just", "also", "now"
  ]);

  // Extract words from content (remove markdown syntax)
  const text = content
    .replace(/```[\s\S]*?```/g, " ") // Remove code blocks
    .replace(/`[^`]+`/g, " ") // Remove inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Extract link text
    .replace(/[#*_~>|]/g, " ") // Remove markdown symbols
    .toLowerCase();

  // Split into words and count frequency
  const words = text.match(/\b[a-z]{3,}\b/g) || [];
  const wordFreq: Map<string, number> = new Map();

  for (const word of words) {
    if (!stoplist.has(word)) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  }

  // Get top frequent words (appearing at least 3 times)
  const sorted = Array.from(wordFreq.entries())
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5); // Top 5 keywords

  for (const [word, count] of sorted) {
    tags.push({
      tag: word,
      confidence: Math.min(0.5, count / 20), // Scale confidence by frequency
      source: "content"
    });
  }

  return tags;
}

/**
 * Detects content category based on patterns.
 * Placeholder for Task 60 - Category detection.
 */
function detectCategories(metadata: ClipMetadata, content: string): TagSuggestion[] {
  const tags: TagSuggestion[] = [];

  // Simple pattern-based category detection
  // This will be enhanced in Task 60

  const lowerContent = content.toLowerCase();
  const title = metadata.title.toLowerCase();

  // Code/tutorial detection
  if (
    lowerContent.includes("```") ||
    lowerContent.includes("npm install") ||
    lowerContent.includes("git clone") ||
    title.includes("tutorial") ||
    title.includes("how to")
  ) {
    tags.push({
      tag: "code",
      confidence: 0.7,
      source: "category"
    });
  }

  // Research paper detection
  if (
    metadata.url.includes("arxiv.org") ||
    lowerContent.includes("abstract") ||
    lowerContent.includes("bibliography") ||
    metadata.jsonLd?.schemaType === "ScholarlyArticle"
  ) {
    tags.push({
      tag: "research",
      confidence: 0.75,
      source: "category"
    });
  }

  // Recipe detection
  if (
    lowerContent.includes("ingredients") &&
    (lowerContent.includes("instructions") || lowerContent.includes("directions"))
  ) {
    tags.push({
      tag: "recipe",
      confidence: 0.8,
      source: "category"
    });
  }

  // News detection
  if (
    metadata.publishedDate &&
    (title.includes("breaking") || title.includes("news"))
  ) {
    tags.push({
      tag: "news",
      confidence: 0.6,
      source: "category"
    });
  }

  return tags;
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
