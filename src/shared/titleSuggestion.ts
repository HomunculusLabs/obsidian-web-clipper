/**
 * Title suggestion engine for generating smart note titles.
 *
 * Task 62: Smart title generation
 * - Clean up extracted titles (remove site names, decode entities)
 * - Generate 2-3 title options from various sources
 * - Handle edge cases (missing titles, very long titles, etc.)
 */

import type { ClipMetadata } from "./types";

/**
 * Title suggestion result with confidence score
 */
export interface TitleSuggestion {
  title: string;
  confidence: number; // 0-1, higher = more confident
  source: "original" | "headline" | "og" | "twitter" | "cleaned" | "generated";
}

/**
 * Options for title suggestion.
 */
export interface TitleSuggestionOptions {
  /** Maximum title length before truncation (default: 100) */
  maxLength?: number;
  /** Whether to prefer title case for generated titles (default: true) */
  preferTitleCase?: boolean;
  /** Custom patterns to remove from titles (e.g., site names) */
  removePatterns?: string[];
  /** Whether to include cleaned variants (default: true) */
  includeCleanedVariants?: boolean;
}

/**
 * Common site name suffixes to strip from titles.
 * These are patterns like " - Medium", " | Hacker News", etc.
 */
const SITE_SUFFIX_PATTERNS = [
  // Common separators with site names
  /\s*[-|–—•]\s*Medium$/i,
  /\s*[-|–—•]\s*YouTube$/i,
  /\s*[-|–—•]\s*GitHub$/i,
  /\s*[-|–—•]\s*Reddit$/i,
  /\s*[-|–—•]\s*Twitter$/i,
  /\s*[-|–—•]\s*X$/i,
  /\s*[-|–—•]\s*Stack Overflow$/i,
  /\s*[-|–—•]\s*Stack Exchange$/i,
  /\s*[-|–—•]\s*Hacker News$/i,
  /\s*[-|–—•]\s*YouTube$/i,
  /\s*[-|–—•]\s*Wikipedia$/i,
  /\s*[-|–—•]\s*Substack$/i,
  /\s*[-|–—•]\s*LinkedIn$/i,
  /\s*[-|–—•]\s*Facebook$/i,
  /\s*\|\s*[A-Z][a-zA-Z\s]+$/i,  // Generic " | SiteName" pattern
  /\s*[-–—]\s*[A-Z][a-zA-Z\s]+$/i,  // Generic " - SiteName" pattern
  // Common prefixes
  /^\s*Breaking:\s*/i,
  /^\s*News:\s*/i,
  /^\s*Update:\s*/i,
  // Trailing punctuation
  /\s*\.\.\.$/,
  /\s*…$/,
];

/**
 * Common site name prefixes to strip from titles.
 */
const SITE_PREFIX_PATTERNS = [
  /^\s*GitHub\s*[-|–—•:]\s*/i,
  /^\s*Reddit\s*[-|–—•:]\s*/i,
  /^\s*YouTube\s*[-|–—•:]\s*/i,
  /^\s*Twitter\s*[-|–—•:]\s*/i,
  /^\s*Hacker News\s*[-|–—•:]\s*/i,
  /^\s*Stack Overflow\s*[-|–—•:]\s*/i,
];

/**
 * Generates 2-3 title suggestions based on page metadata and content.
 *
 * This is the main entry point for title suggestion. It combines multiple
 * strategies (headline extraction, title cleaning, OG titles) to generate
 * relevant title options.
 *
 * @param metadata - Clip metadata containing URL, title, keywords, etc.
 * @param content - The markdown content of the clipped page (optional)
 * @param options - Optional configuration for title suggestion
 * @returns Array of suggested titles (deduplicated, sorted by confidence)
 */
export function suggestTitles(
  metadata: ClipMetadata,
  content?: string,
  options?: TitleSuggestionOptions
): string[] {
  const suggestions: Map<string, TitleSuggestion> = new Map();
  const maxLength = options?.maxLength ?? 100;
  const includeCleaned = options?.includeCleanedVariants ?? true;

  // Strategy 1: Original title (highest priority, always included)
  if (metadata.title) {
    const cleaned = cleanTitle(metadata.title, options);
    addSuggestion(suggestions, {
      title: truncateTitle(cleaned, maxLength),
      confidence: 0.9,
      source: "original"
    });
  }

  // Strategy 2: JSON-LD headline (often cleaner than page title)
  if (metadata.jsonLd?.headline && metadata.jsonLd.headline !== metadata.title) {
    const cleaned = cleanTitle(metadata.jsonLd.headline, options);
    addSuggestion(suggestions, {
      title: truncateTitle(cleaned, maxLength),
      confidence: 0.85,
      source: "headline"
    });
  }

  // Strategy 3: JSON-LD name (alternative to headline)
  if (metadata.jsonLd?.name && 
      metadata.jsonLd.name !== metadata.title && 
      metadata.jsonLd.name !== metadata.jsonLd?.headline) {
    const cleaned = cleanTitle(metadata.jsonLd.name, options);
    addSuggestion(suggestions, {
      title: truncateTitle(cleaned, maxLength),
      confidence: 0.8,
      source: "headline"
    });
  }

  // Strategy 4: Open Graph title (often better formatted)
  if (metadata.og?.ogTitle && metadata.og.ogTitle !== metadata.title) {
    const cleaned = cleanTitle(metadata.og.ogTitle, options);
    addSuggestion(suggestions, {
      title: truncateTitle(cleaned, maxLength),
      confidence: 0.75,
      source: "og"
    });
  }

  // Strategy 5: Twitter card title
  if (metadata.twitter?.twitterTitle && 
      metadata.twitter.twitterTitle !== metadata.title &&
      metadata.twitter.twitterTitle !== metadata.og?.ogTitle) {
    const cleaned = cleanTitle(metadata.twitter.twitterTitle, options);
    addSuggestion(suggestions, {
      title: truncateTitle(cleaned, maxLength),
      confidence: 0.7,
      source: "twitter"
    });
  }

  // Strategy 6: Generate cleaned variants if requested
  if (includeCleaned && metadata.title) {
    const deepCleaned = deepCleanTitle(metadata.title, options);
    if (deepCleaned !== metadata.title) {
      addSuggestion(suggestions, {
        title: truncateTitle(deepCleaned, maxLength),
        confidence: 0.65,
        source: "cleaned"
      });
    }
  }

  // Strategy 7: Generate title from first heading in content
  if (content) {
    const firstHeading = extractFirstHeading(content);
    if (firstHeading && firstHeading !== metadata.title) {
      const cleaned = cleanTitle(firstHeading, options);
      addSuggestion(suggestions, {
        title: truncateTitle(cleaned, maxLength),
        confidence: 0.5,
        source: "generated"
      });
    }
  }

  // Sort by confidence and return just the titles
  const sorted = Array.from(suggestions.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3) // Limit to 3 suggestions
    .map(s => s.title);

  // Ensure we have at least one title
  if (sorted.length === 0) {
    sorted.push("Untitled");
  }

  return sorted;
}

/**
 * Adds a suggestion to the map, avoiding duplicates and keeping the best confidence.
 */
function addSuggestion(
  suggestions: Map<string, TitleSuggestion>,
  suggestion: TitleSuggestion
): void {
  const key = normalizeTitle(suggestion.title);
  const existing = suggestions.get(key);

  if (!existing || existing.confidence < suggestion.confidence) {
    suggestions.set(key, suggestion);
  }
}

/**
 * Normalizes a title for comparison (lowercase, trimmed, collapsed whitespace).
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Options for title cleanup.
 * Used by cleanTitle and deepCleanTitle functions.
 */
export interface TitleCleanupOptions {
  /** Whether to apply title case (default: true) */
  preferTitleCase?: boolean;
  /** Custom patterns to remove from titles (regex strings) */
  removePatterns?: string[];
  /** Maximum title length before truncation (default: no truncation in cleanTitle) */
  maxLength?: number;
}

/**
 * Cleans a title by removing common site suffixes/prefixes and normalizing whitespace.
 *
 * This function:
 * - Removes site name suffixes like " - Medium", " | Hacker News"
 * - Removes site name prefixes like "GitHub - ", "Reddit: "
 * - Decodes HTML entities (&amp;, &quot;, &#39;, etc.)
 * - Normalizes whitespace (collapses multiple spaces, trims)
 * - Optionally applies title case
 *
 * @param title - The title to clean
 * @param options - Optional configuration for cleanup behavior
 * @returns The cleaned title
 *
 * @example
 * ```ts
 * cleanTitle("My Article - Medium")
 * // "My Article"
 *
 * cleanTitle("GitHub - User/Repo: Description")
 * // "User/Repo: Description"
 *
 * cleanTitle("Hello&nbsp;World &amp; Friends")
 * // "Hello World & Friends"
 * ```
 */
export function cleanTitle(
  title: string,
  options?: TitleCleanupOptions
): string {
  let cleaned = title;

  // Apply custom remove patterns first
  if (options?.removePatterns) {
    for (const pattern of options.removePatterns) {
      try {
        cleaned = cleaned.replace(new RegExp(pattern, "gi"), "");
      } catch {
        // Invalid regex, skip
      }
    }
  }

  // Apply built-in patterns
  for (const pattern of SITE_SUFFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  for (const pattern of SITE_PREFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  // Decode common HTML entities
  cleaned = decodeHtmlEntities(cleaned);

  // Normalize whitespace
  cleaned = cleaned
    .replace(/\s+/g, " ")
    .trim();

  // Remove leading/trailing punctuation
  cleaned = cleaned.replace(/^[-|–—•:\s]+/, "").replace(/[-|–—•:\s]+$/, "");

  // Apply title case if requested
  if (options?.preferTitleCase !== false) {
    cleaned = toTitleCase(cleaned);
  }

  return cleaned;
}

/**
 * Performs aggressive cleaning for a "deep cleaned" variant.
 * This removes more patterns and normalizes more aggressively.
 *
 * In addition to standard cleanup, this also removes:
 * - Parenthetical site references like "(on GitHub)", "[YouTube]"
 * - Year/date patterns like " - 2024", " | Jan 2024"
 * - Trailing numbers like "Article #123"
 *
 * @param title - The title to clean
 * @param options - Optional configuration for cleanup behavior
 * @returns The deeply cleaned title
 */
export function deepCleanTitle(
  title: string,
  options?: TitleCleanupOptions
): string {
  let cleaned = cleanTitle(title, { ...options, preferTitleCase: false });

  // Remove parenthetical site references like "(on GitHub)", "[YouTube]", etc.
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/g, "");
  cleaned = cleaned.replace(/\s*\[[^\]]*\]\s*$/g, "");

  // Remove year/date patterns at the end like " - 2024", " | Jan 2024"
  cleaned = cleaned.replace(/\s*[-|–—]\s*\d{4}\s*$/g, "");
  cleaned = cleaned.replace(/\s*[-|–—]\s*[A-Z][a-z]+\s+\d{4}\s*$/g, "");

  // Remove trailing numbers (like "Article #123")
  cleaned = cleaned.replace(/\s*#\d+\s*$/g, "");

  // Normalize again
  cleaned = cleaned.trim();

  // Apply title case
  if (options?.preferTitleCase !== false) {
    cleaned = toTitleCase(cleaned);
  }

  return cleaned;
}

/**
 * Decodes common HTML entities in a string.
 *
 * Handles:
 * - Named entities: &amp;, &lt;, &gt;, &quot;, &apos;, &nbsp;, &mdash;, etc.
 * - Decimal numeric entities: &#39;, &#123;
 * - Hexadecimal numeric entities: &#x27;, &#x7B;
 *
 * @param text - The text containing HTML entities
 * @returns The text with entities decoded
 *
 * @example
 * ```ts
 * decodeHtmlEntities("Hello &amp; World")
 * // "Hello & World"
 *
 * decodeHtmlEntities("Price: &#36;99")
 * // "Price: $99"
 * ```
 */
export function decodeHtmlEntities(text: string): string {
  // Named entities
  const namedEntities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
    "&mdash;": "—",
    "&ndash;": "–",
    "&hellip;": "…",
    "&rsquo;": "'",
    "&lsquo;": "'",
    "&rdquo;": '"',
    "&ldquo;": '"',
  };

  let result = text;

  // Replace named entities
  for (const [entity, replacement] of Object.entries(namedEntities)) {
    result = result.split(entity).join(replacement);
  }

  // Replace numeric entities (decimal)
  result = result.replace(/&#(\d+);/g, (_, num: string) => {
    try {
      return String.fromCharCode(parseInt(num, 10));
    } catch {
      return "";
    }
  });

  // Replace numeric entities (hex)
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return "";
    }
  });

  return result;
}

/**
 * Converts a string to title case.
 * Handles common edge cases like small words in the middle of titles.
 *
 * Small words (a, an, the, and, but, or, etc.) remain lowercase
 * unless they appear at the start or end of the title.
 *
 * @param text - The text to convert to title case
 * @returns The title-cased text
 *
 * @example
 * ```ts
 * toTitleCase("hello world")
 * // "Hello World"
 *
 * toTitleCase("the lord of the rings")
 * // "The Lord of the Rings"
 *
 * toTitleCase("ALL CAPS TITLE")
 * // "All Caps Title"
 * ```
 */
export function toTitleCase(text: string): string {
  // Words that should remain lowercase unless at the start
  const smallWords = new Set([
    "a", "an", "the", "and", "but", "or", "nor", "for", "yet", "so",
    "at", "by", "in", "of", "on", "to", "up", "via", "with", "from",
    "as", "is", "it", "de", "la", "le", "du", "da", "di", "van", "von",
  ]);

  // Handle all-caps text (convert to title case instead of leaving uppercase)
  const isAllCaps = text === text.toUpperCase() && /[A-Z]/.test(text);

  // Split on word boundaries, preserving original spacing
  const words = text.split(/(\s+)/);

  return words.map((word, index) => {
    // Preserve whitespace
    if (/^\s+$/.test(word)) return word;

    // Preserve punctuation and special chars at start/end
    const leadingMatch = word.match(/^([^a-zA-Z0-9]*)/);
    const trailingMatch = word.match(/([^a-zA-Z0-9]*)$/);
    const leading = leadingMatch ? leadingMatch[1] : "";
    const trailing = trailingMatch ? trailingMatch[1] : "";
    const core = word.slice(leading.length, trailingMatch ? -trailing.length : undefined);

    if (!core) return word;

    // Check if this is a small word (not first or last word)
    const lower = core.toLowerCase();
    if (index > 0 && !isAllCaps && smallWords.has(lower)) {
      return leading + lower + trailing;
    }

    // Capitalize first letter, lowercase rest
    return leading + core.charAt(0).toUpperCase() + core.slice(1).toLowerCase() + trailing;
  }).join("");
}

/**
 * Truncates a title to a maximum length, preserving word boundaries.
 */
function truncateTitle(title: string, maxLength: number): string {
  if (title.length <= maxLength) return title;

  // Try to truncate at a word boundary
  let truncated = title.slice(0, maxLength);

  // Find the last space within the limit
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.6) {
    truncated = truncated.slice(0, lastSpace);
  }

  // Add ellipsis if we truncated
  return truncated.trim() + "…";
}

/**
 * Extracts the first heading from markdown content.
 */
function extractFirstHeading(content: string): string | null {
  // Match ATX-style headings (# Heading)
  const match = content.match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/m);
  if (match) {
    return match[1].trim();
  }

  // Try to extract from the first line if it looks like a title
  const firstLine = content.split("\n")[0]?.trim();
  if (firstLine && firstLine.length > 5 && firstLine.length < 150) {
    // Clean up any markdown syntax
    return firstLine
      .replace(/^#+\s*/, "")
      .replace(/[*_`~]/g, "")
      .trim();
  }

  return null;
}
