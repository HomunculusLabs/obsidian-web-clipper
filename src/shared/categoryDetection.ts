/**
 * Content category detection for tag suggestions.
 *
 * Implements Task 60 - Simple content classifier that detects
 * if content is code/tutorial, news, research, opinion, product, or recipe.
 *
 * Uses pattern-based heuristics including:
 * - URL domain patterns
 * - Title/header keywords
 * - Content structure indicators
 * - JSON-LD schema types
 * - Meta tag information
 */

import type { ClipMetadata } from "./types";

/**
 * Supported content categories for classification.
 */
export type ContentCategory =
  | "code"
  | "news"
  | "research"
  | "opinion"
  | "product"
  | "recipe";

/**
 * Category detection result with confidence score.
 */
export interface CategoryResult {
  category: ContentCategory;
  confidence: number; // 0-1, higher = more confident
  source: "category";
}

/**
 * Pattern matchers for category detection.
 * Each category has URL patterns, title patterns, and content patterns.
 */
interface CategoryPatterns {
  urlPatterns: RegExp[];
  titlePatterns: RegExp[];
  contentPatterns: RegExp[];
  jsonLdTypes: string[];
  metaIndicators: string[];
}

/**
 * Category patterns configuration.
 * Ordered by specificity - more specific patterns should come first.
 */
const CATEGORY_PATTERNS: Record<ContentCategory, CategoryPatterns> = {
  recipe: {
    urlPatterns: [
      /\/recipe\//i,
      /\/recipes\//i,
      /\/cooking\//i,
      /allrecipes\.com/i,
      /foodnetwork\.com/i,
      /seriouseats\.com/i,
      /bonappetit\.com/i,
      /tasty\.co/i,
      /recipetineats\.com/i,
    ],
    titlePatterns: [
      /\brecipe\b/i,
      /\bhow to (make|cook|bake|prepare)\b/i,
      /\bhomemade\b.*\b(make|recipe)\b/i,
    ],
    contentPatterns: [
      /\b(?:ingredients|you'll need|what you need)\s*[:\n]/i,
      /\b(?:instructions|directions|method|preparation|steps)\s*[:\n]/i,
      /\b(?:prep|cook|total)\s*(?:time)?\s*[:\n]/i,
      /\b(?:servings|yields|serves)\s*[:\n]/i,
      /\d+\s*(?:cups?|tbsp|tsp|oz|grams?|ml|lb)/i,
    ],
    jsonLdTypes: ["Recipe"],
    metaIndicators: ["recipe"],
  },

  product: {
    urlPatterns: [
      /amazon\.[a-z.]+\/.*\/dp\//i,
      /amazon\.[a-z.]+\/.*\/gp\/product\//i,
      /amzn\./i,
      /ebay\.[a-z.]+\/itm\//i,
      /etsy\.[a-z.]+\/listing\//i,
      /shopify\./i,
      /\/products?\//i,
      /\/shop\//i,
      /\/buy\//i,
      /store\./i,
      /product\.hunt/i,
    ],
    titlePatterns: [
      /\bbuy\s+(?:now|online)\b/i,
      /\bshop\s+(?:now|online)\b/i,
      /\bprice\b.*\breview\b/i,
      /\bproduct\s+review\b/i,
      /\bbest\s+\w+\s+(?:under|for|review)\b/i,
    ],
    contentPatterns: [
      /\b(?:price|our price|sale price)\s*[:\$]/i,
      /\b(?:add to cart|buy now|shop now|add to bag)\b/i,
      /\b(?:customer reviews|ratings|out of \d+ stars)\b/i,
      /\b(?:shipping|delivery|in stock|out of stock)\b/i,
      /\b(?:sku|model|item number)\s*[:\n]/i,
      /\b(?:features|specifications|specs)\s*[:\n]/i,
      /\$\d+(?:\.\d{2})?(?:\s*(?:USD|CAD|EUR))?/i,
    ],
    jsonLdTypes: ["Product", "Offer", "AggregateOffer"],
    metaIndicators: ["product", "store", "shop"],
  },

  research: {
    urlPatterns: [
      /arxiv\.org/i,
      /scholar\.google\./i,
      /dl\.acm\.org/i,
      /ieeexplore\.ieee\.org/i,
      /springer\.[a-z.]+\/(chapter|article)/i,
      /nature\.com\/articles\//i,
      /science\.org\/doi\//i,
      /sciencedirect\.com\/science\/article\//i,
      /researchgate\.net\/publication\//i,
      /semanticscholar\.org\//i,
      /doi\.org\//i,
      /\/doi\//i,
      /\/paper\//i,
      /\/publication\//i,
      /academia\.edu/i,
    ],
    titlePatterns: [
      /\babstract\b/i,
      /\bwhite\s*paper\b/i,
      /\bpreprint\b/i,
      /\barXiv\b/i,
      /\bresearch\s+(?:paper|article|study)\b/i,
      /\bpeer-reviewed\b/i,
    ],
    contentPatterns: [
      /\babstract\s*[:\n]/i,
      /\b(?:keywords|key\s*words)\s*[:\n]/i,
      /\b(?:bibliography|references|cited|citations)\b/i,
      /\b(?:doi|arxiv|isbn)\s*[:\n]/i,
      /\b(?:university|institute|laboratory|lab)\b.*\b(?:department|faculty)\b/i,
      /\b(?:published|accepted|submitted)\s+\d{4}/i,
      /\b(?:volume|issue|pages?)\s*[:\n]/i,
    ],
    jsonLdTypes: [
      "ScholarlyArticle",
      "Article",
      "PublicationIssue",
      "Thesis",
    ],
    metaIndicators: ["scholarly", "academic", "research", "citation"],
  },

  code: {
    urlPatterns: [
      /github\.com/i,
      /gitlab\.com/i,
      /bitbucket\.org/i,
      /stackoverflow\.com/i,
      /stackexchange\.com/i,
      /npmjs\.com/i,
      /pypi\.org/i,
      /crates\.io/i,
      /docs\.\w+\.(io|com|dev|org)/i,
      /developer\.\w+\.(io|com|dev|org)/i,
      /\/(docs|documentation|api|reference)\//i,
      /\/(tutorial|tutorials|guide|guides)\//i,
    ],
    titlePatterns: [
      /\b(?:how\s*to|getting\s*started|quick\s*start)\b/i,
      /\b(?:tutorial|walkthrough|guide)\b/i,
      /\b(?:api|sdk|library)\s+(?:reference|docs|documentation)\b/i,
      /\b(?:install|setup|configuration)\s+(?:guide|instructions)\b/i,
      /\b(?:hello\s*world|example|demo)\b/i,
    ],
    contentPatterns: [
      /```[\s\S]*?```/,  // Fenced code blocks
      /``[^`]+``/,       // Inline code with double backticks
      /\b(?:npm\s+(?:install|run)|yarn\s+(?:add|run)|pip\s+install)\b/i,
      /\b(?:git\s+(?:clone|pull|push)|git\s+checkout)\b/i,
      /\b(?:import|require|from)\s+['"]\w+/i,
      /\b(?:function|class|def|fn|func|const|let|var)\s+\w+\s*[\(:=]/i,
      /\b(?:cargo\s+(?:run|build)|go\s+(?:run|build|get))\b/i,
      /\b(?:docker\s+(?:run|build|compose))\b/i,
      /\b(?:kubectl|terraform)\s+\w+/i,
      /<code>[\s\S]*?<\/code>/i,
    ],
    jsonLdTypes: ["TechArticle", "APIReference"],
    metaIndicators: ["documentation", "api", "tutorial", "code", "developer"],
  },

  news: {
    urlPatterns: [
      /news\.[a-z.]+/i,
      /cnn\.com/i,
      /bbc\.[a-z.]+\/news/i,
      /nytimes\.com/i,
      /washingtonpost\.com/i,
      /theguardian\.com/i,
      /reuters\.com/i,
      /apnews\.com/i,
      /bloomberg\.com/i,
      /wsj\.com/i,
      /usatoday\.com/i,
      /nbcnews\.com/i,
      /abcnews\.go\.com/i,
      /cbc\.ca\/news/i,
      /\/news\//i,
      /\/article\//i,
      /\/breaking\//i,
    ],
    titlePatterns: [
      /\bbreaking(?:\s+news)?\b/i,
      /\bexclusive\b/i,
      /\breport\b.*\b(allegedly|sources?|according)\b/i,
      /\b(?:confirmed|unconfirmed)\s+(?:reports?|sources?)\b/i,
      /\b(?:according\s+to|sources?\s+say)\b/i,
    ],
    contentPatterns: [
      /\b(?:breaking|developing|just\s+in|update)\s*[:\n]/i,
      /\b(?:reported|reports?|correspondent|journalist)\b/i,
      /\b(?:according\s+to|sources?\s+(?:say|told|close\s+to))\b/i,
      /\b(?:published|updated|modified)\s+(?:\d{1,2}\/\d{1,2}|\w+\s+\d{1,2},?\s+\d{4})/i,
      /\b(?:staff\s+writer|contributor|editor)\b/i,
    ],
    jsonLdTypes: ["NewsArticle", "Report", "LiveBlogPosting"],
    metaIndicators: ["news", "article", "breaking"],
  },

  opinion: {
    urlPatterns: [
      /\/opinion\//i,
      /\/op-ed\//i,
      /\/editorial\//i,
      /\/column\//i,
      /\/commentary\//i,
      /\/blog\//i,
      /\/personal\//i,
      /medium\.com\/@/i,
      /substack\.com/i,
      /thehill\.com\/opinion/i,
    ],
    titlePatterns: [
      /\bopinion\s*:|^opinion\b/i,
      /\bop-ed\b/i,
      /\bwhy\s+i\s+(?:think|believe|support|oppose)\b/i,
      /\b(my|our)\s+(?:take|view|thoughts|perspective)\b/i,
      /\b(?:the\s+)?case\s+(?:for|against)\b/i,
      /\b(?:(?:in\s+)?my\s+opinion|imo|imho)\b/i,
      /\bwhy\s+\w+\s+(?:matters?|is\s+(?:wrong|right|important))\b/i,
      /\b(?:it's\s+time\s+to|we\s+need\s+to|we\s+should)\b/i,
    ],
    contentPatterns: [
      /\b(?:in\s+my\s+(?:opinion|view)|imo|imho|personally)\b/i,
      /\b(?:i\s+(?:think|believe|feel|argue|contend|maintain))\b/i,
      /\b(?:i\s+am\s+(?:convinced|of\s+the\s+opinion|persuaded))\b/i,
      /\b(?:from\s+my\s+(?:perspective|point\s+of\s+view|experience))\b/i,
      /\b(?:this\s+is\s+(?:why|because)|let\s+me\s+explain)\b/i,
      /\b(?:the\s+problem\s+(?:is|with)|the\s+solution\s+is)\b/i,
      /\b(?:opinion|editorial|commentary|columnist)\b/i,
    ],
    jsonLdTypes: ["OpinionNewsArticle", "BlogPosting", "Commentary"],
    metaIndicators: ["opinion", "op-ed", "editorial", "commentary"],
  },
};

/**
 * Category priority for tie-breaking.
 * More specific categories should have higher priority.
 */
const CATEGORY_PRIORITY: ContentCategory[] = [
  "recipe",
  "product",
  "research",
  "code",
  "opinion",
  "news", // News is most general, lowest priority
];

/**
 * Detects content categories based on metadata and content patterns.
 *
 * @param metadata - Clip metadata containing URL, title, JSON-LD, etc.
 * @param content - The markdown content of the clipped page
 * @returns Array of category suggestions with confidence scores
 */
export function detectCategories(
  metadata: ClipMetadata,
  content: string
): CategoryResult[] {
  const scores: Map<ContentCategory, number> = new Map();

  // Initialize all categories with 0 score
  for (const category of CATEGORY_PRIORITY) {
    scores.set(category, 0);
  }

  const lowerContent = content.toLowerCase();
  const lowerTitle = metadata.title.toLowerCase();
  const url = metadata.url.toLowerCase();

  // Score each category
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    let categoryScore = 0;

    // Check URL patterns (high confidence)
    for (const pattern of patterns.urlPatterns) {
      if (pattern.test(url)) {
        categoryScore += 0.4;
        break; // Only count first match
      }
    }

    // Check title patterns (medium-high confidence)
    for (const pattern of patterns.titlePatterns) {
      if (pattern.test(lowerTitle)) {
        categoryScore += 0.3;
        break;
      }
    }

    // Check content patterns (medium confidence)
    let contentMatches = 0;
    for (const pattern of patterns.contentPatterns) {
      if (pattern.test(lowerContent)) {
        contentMatches++;
      }
    }
    // Score based on number of content patterns matched
    if (contentMatches > 0) {
      categoryScore += Math.min(0.4, contentMatches * 0.1);
    }

    // Check JSON-LD type (very high confidence)
    if (metadata.jsonLd?.schemaType) {
      const schemaType = metadata.jsonLd.schemaType;
      for (const jsonLdType of patterns.jsonLdTypes) {
        if (
          schemaType === jsonLdType ||
          schemaType.includes(jsonLdType) ||
          jsonLdType.includes(schemaType)
        ) {
          categoryScore += 0.5;
          break;
        }
      }
    }

    // Check keywords for indicators (lower confidence)
    if (metadata.keywords) {
      for (const keyword of metadata.keywords) {
        const lowerKeyword = keyword.toLowerCase();
        if (patterns.metaIndicators.some((i) => lowerKeyword.includes(i))) {
          categoryScore += 0.1;
          break;
        }
      }
    }

    // Normalize score to 0-1 range
    scores.set(category as ContentCategory, Math.min(1, categoryScore));
  }

  // Filter and sort results
  const results: CategoryResult[] = [];

  // Find the highest scoring category
  let maxScore = 0;
  let bestCategory: ContentCategory | null = null;

  for (const category of CATEGORY_PRIORITY) {
    const score = scores.get(category) || 0;
    if (score > maxScore) {
      maxScore = score;
      bestCategory = category;
    }
  }

  // Only return a category if we have sufficient confidence
  const MIN_CONFIDENCE = 0.3;
  if (bestCategory && maxScore >= MIN_CONFIDENCE) {
    // Apply some confidence scaling
    // High confidence (>0.7) stays high
    // Medium confidence (0.3-0.7) gets boosted slightly
    const scaledConfidence = maxScore >= 0.7 ? maxScore : maxScore * 1.1;

    results.push({
      category: bestCategory,
      confidence: Math.min(0.95, scaledConfidence),
      source: "category",
    });

    // If we have a high-confidence match, also check for secondary categories
    // (e.g., code tutorial that's also an opinion piece)
    if (maxScore >= 0.6) {
      for (const category of CATEGORY_PRIORITY) {
        if (category === bestCategory) continue;

        const secondaryScore = scores.get(category) || 0;
        // Only add secondary category if it's also reasonably confident
        // and not too similar to the primary (prevents category overlap)
        if (secondaryScore >= 0.5 && secondaryScore < maxScore * 0.8) {
          results.push({
            category,
            confidence: Math.min(0.6, secondaryScore * 0.8),
            source: "category",
          });
          // Only add one secondary category
          break;
        }
      }
    }
  }

  return results;
}

/**
 * Maps a content category to a tag string.
 *
 * @param category - The detected category
 * @returns A tag-friendly string representation
 */
export function categoryToTag(category: ContentCategory): string {
  // Categories map directly to tags in most cases
  return category;
}

/**
 * Gets the display label for a category.
 *
 * @param category - The detected category
 * @returns A human-readable label
 */
export function getCategoryLabel(category: ContentCategory): string {
  const labels: Record<ContentCategory, string> = {
    code: "Code/Tutorial",
    news: "News",
    research: "Research",
    opinion: "Opinion",
    product: "Product",
    recipe: "Recipe",
  };
  return labels[category];
}
