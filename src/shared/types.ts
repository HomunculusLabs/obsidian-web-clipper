export type PageType = "web" | "youtube" | "pdf" | "twitter";

export type ClipContentType = "article" | "video" | "document";

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
}

export interface ClipResult {
  url: string;
  title: string;
  markdown: string;
  metadata: ClipMetadata;
  error?: string;
}