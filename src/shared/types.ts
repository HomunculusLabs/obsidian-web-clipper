export type PageType = "web" | "youtube" | "pdf" | "twitter";

export type ClipContentType = "article" | "video" | "document" | "tweet";

export type YouTubeVideoType =
  | "normal"
  | "shorts"
  | "live"
  | "age-restricted"
  | "unavailable";

// Table conversion modes for markdown output
export type TableHandlingMode = "gfm" | "html" | "remove";

// Code block language detection modes
export type CodeBlockLanguageMode = "off" | "class-only" | "class-heuristic";

// Image handling modes
export type ImageHandlingMode = "keep" | "remove" | "data-uri" | "download-api";

// Open Graph metadata
export interface OGMetadata {
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogImages?: string[];
  ogUrl?: string;
  ogType?: string;
  ogSiteName?: string;
  ogLocale?: string;
}

// Twitter Card metadata
export interface TwitterMetadata {
  twitterCard?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  twitterSite?: string;
  twitterCreator?: string;
}

// JSON-LD structured data (simplified)
export interface JsonLdMetadata {
  schemaType?: string;
  name?: string;
  headline?: string;
  description?: string;
  author?: string | string[];
  datePublished?: string;
  dateModified?: string;
  publisher?: string;
  keywords?: string[];
  articleSection?: string;
  wordCount?: number;
  image?: string | string[];
}

// Reading statistics
export interface ReadingStats {
  wordCount?: number;
  charCount?: number;
  estimatedReadingTimeMinutes?: number;
}

export interface SeedFinderPotencyValue {
  /** Raw potency value as seen on page (e.g., "<1%", "18-22%") */
  raw?: string;
  minPercent?: number;
  maxPercent?: number;
  comparator?: "<" | "<=" | ">" | ">=" | "~";
}

export interface SeedFinderPotencyProfile {
  thc?: SeedFinderPotencyValue;
  cbd?: SeedFinderPotencyValue;
}

export interface SeedFinderFloweringProfile {
  /** Raw flowering value as seen on page (e.g., "63-70 days", "9-10 weeks") */
  raw?: string;
  minDays?: number;
  maxDays?: number;
  minWeeks?: number;
  maxWeeks?: number;
  harvestWindow?: string;
}

export interface SeedFinderStrainProfileRawSourceValues {
  lineage?: string;
  lineageParents?: string | string[];
  thc?: string;
  cbd?: string;
  flowering?: string;
  breeder?: string;
  aroma?: string | string[];
  effects?: string | string[];
}

export interface SeedFinderStrainProfile {
  lineage?: string;
  lineageParents?: string[];
  potency?: SeedFinderPotencyProfile;
  flowering?: SeedFinderFloweringProfile;
  breeder?: string;
  aroma?: string[];
  effects?: string[];
  rawSourceValues?: SeedFinderStrainProfileRawSourceValues;
}

export interface ClipMetadata {
  url: string;
  title: string;
  type: ClipContentType;

  author?: string;
  publishedDate?: string;
  description?: string;

  channel?: string;
  duration?: string;
  videoType?: YouTubeVideoType;

  paywalled?: boolean;

  pdfPageCount?: number;
  pdfHasTextLayer?: boolean;

  passwordProtected?: boolean;
  scannedPDF?: boolean;
  truncated?: boolean;

  // --- New fields for Better Markdown Indexing ---

  // Canonical URL (prefer over page URL)
  canonicalUrl?: string;

  // Open Graph metadata
  og?: OGMetadata;

  // Twitter Card metadata
  twitter?: TwitterMetadata;

  // JSON-LD structured data
  jsonLd?: JsonLdMetadata;

  // Keywords/article tags from meta tags
  keywords?: string[];

  // Reading statistics
  readingStats?: ReadingStats;

  // Site-specific metadata
  siteName?: string;
  language?: string;

  // --- Selection clipping context ---

  /** Clip mode: "selection" when clipping only user-selected text */
  clipMode?: "full" | "selection";

  /** Surrounding context for selection (e.g., parent paragraph or heading) */
  selectionContext?: string;

  /** Number of selection ranges (for multi-selection, >1 means Ctrl+click) */
  selectionCount?: number;

  // --- Template extraction ---

  /** Name of the site template used for extraction (if any) */
  templateUsed?: string;

  // --- SeedFinder strain profile metadata ---

  /** Full normalized SeedFinder strain profile */
  seedFinderProfile?: SeedFinderStrainProfile;

  // Legacy compatibility fields (kept while full profile rollout lands)

  /** Normalized lineage string (e.g., "Blueberry x Haze") */
  lineage?: string;

  /** Optional parent list derived from normalized lineage */
  lineageParents?: string[];

  // --- Twitter/X specific metadata (Task 51) ---

  /** Twitter author handle (without @) */
  twitterAuthorHandle?: string;

  /** Number of tweets in thread (if this is a thread) */
  twitterThreadLength?: number;

  /** Twitter engagement stats */
  twitterEngagement?: {
    replies: number;
    retweets: number;
    likes: number;
    views?: number;
    bookmarks?: number;
  };
}

export interface ClipResult {
  url: string;
  title: string;
  markdown: string;
  metadata: ClipMetadata;
  error?: string;
}