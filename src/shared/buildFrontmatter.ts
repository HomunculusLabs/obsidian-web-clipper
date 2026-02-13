/**
 * Frontmatter building utilities extracted from save pipeline.
 * Maps ClipResult metadata to FrontmatterInput based on settings.
 */

import type { ClipResult, PageType } from "./types";
import type { Settings } from "./settings";
import { DEFAULT_SETTINGS } from "./settings";
import type { FrontmatterInput } from "./markdown";
import { sanitizeFilename } from "./sanitize";
import { parseTags, addAutoTags } from "./tags";
import { cleanTitle } from "./titleSuggestion";
import { applyTitleTemplate } from "./titleTemplate";

/**
 * Options for building frontmatter
 */
export interface BuildFrontmatterOptions {
  result: ClipResult;
  settings: Settings;
  pageType: PageType;
  currentTabUrl: string;
  overrideTitle?: string;
  overrideFolder?: string;
  overrideTags?: string;
}

/**
 * Result of building frontmatter
 */
export interface BuildFrontmatterResult {
  frontmatter: FrontmatterInput;
  /** Final sanitized filename (without extension) */
  finalTitle: string;
  /** Resolved file path (folder/title) */
  filePath: string;
  /** Final tags (parsed + auto-added) */
  tags: string[];
  /** Source URL (canonical or original) */
  source: string;
}

/**
 * Build the frontmatter input and related computed values from clip result and settings.
 *
 * This function handles:
 * - Title cleanup and templating
 * - Folder and tag resolution
 * - Source URL selection (canonical vs original)
 * - Mapping all metadata fields to frontmatter extras based on settings
 */
export function buildFrontmatterFromClip(options: BuildFrontmatterOptions): BuildFrontmatterResult {
  const { result, settings, pageType, currentTabUrl, overrideTitle, overrideFolder, overrideTags } =
    options;

  // Get the raw title (from override or result)
  let rawTitle = (overrideTitle || "").trim() || result.title || "Untitled";

  // Apply title cleanup if enabled
  if (settings.cleanTitles) {
    rawTitle = cleanTitle(rawTitle, { preferTitleCase: settings.preferTitleCase });
  }

  // Apply title template if enabled
  const templateResult = applyTitleTemplate(
    rawTitle,
    {
      metadata: result.metadata,
      pageType,
      folder: overrideFolder || settings.defaultFolder,
      tags: parseTags(overrideTags || settings.defaultTags || "")
    },
    settings.titleTemplates || { enabled: false, selectedTemplate: "default", customTemplates: [] }
  );

  const finalTitle = sanitizeFilename(templateResult);

  const folder = (
    overrideFolder || settings.defaultFolder || DEFAULT_SETTINGS.defaultFolder
  ).trim();

  const rawTags =
    (overrideTags || "").trim() ||
    (settings.defaultTags || DEFAULT_SETTINGS.defaultTags || "").trim();

  const tags = addAutoTags(parseTags(rawTags), pageType);

  const filePath = folder ? `${folder}/${finalTitle}` : finalTitle;

  // Use canonical URL as source when available and enabled
  const source =
    settings.preferCanonicalUrl && result.metadata?.canonicalUrl
      ? result.metadata.canonicalUrl
      : result.metadata?.url || result.url || currentTabUrl;

  // Build extra frontmatter fields
  const extra: FrontmatterInput["extra"] = buildExtraFields(result, settings, pageType);

  const frontmatter: FrontmatterInput = {
    source,
    title: finalTitle,
    type: result.metadata?.type || "article",
    dateClippedISO: new Date().toISOString(),
    tags,
    author: result.metadata?.author,
    channel: result.metadata?.channel,
    duration: result.metadata?.duration,
    videoType: result.metadata?.videoType,
    extra
  };

  return {
    frontmatter,
    finalTitle,
    filePath,
    tags,
    source
  };
}

/**
 * Build the extra fields for frontmatter based on clip result and settings.
 */
function buildExtraFields(
  result: ClipResult,
  settings: Settings,
  _pageType: PageType
): FrontmatterInput["extra"] {
  const extra: FrontmatterInput["extra"] = {
    published_date: result.metadata?.publishedDate || undefined,
    description: result.metadata?.description || undefined,
    paywalled: result.metadata?.paywalled,
    password_protected: result.metadata?.passwordProtected,
    scanned_pdf: result.metadata?.scannedPDF,
    truncated: result.metadata?.truncated,
    page_type: _pageType
  };

  // Always include lightweight metadata if present
  if (result.metadata?.siteName) {
    extra.site_name = result.metadata.siteName;
  }
  if (result.metadata?.language) {
    extra.language = result.metadata.language;
  }

  // Include canonical URL separately for reference (when different from source)
  if (settings.preferCanonicalUrl && result.metadata?.canonicalUrl) {
    extra.canonical_url = result.metadata.canonicalUrl;
  }

  // Open Graph metadata (gated by settings)
  if (settings.includeOGFields && result.metadata?.og) {
    const og = result.metadata.og;
    extra.og_title = og.ogTitle;
    extra.og_description = og.ogDescription;
    extra.og_image = og.ogImage;
    extra.og_images = og.ogImages;
    extra.og_url = og.ogUrl;
    extra.og_type = og.ogType;
    extra.og_site_name = og.ogSiteName;
    extra.og_locale = og.ogLocale;
  }

  // Twitter Card metadata (gated by settings)
  if (settings.includeTwitterFields && result.metadata?.twitter) {
    const tw = result.metadata.twitter;
    extra.twitter_card = tw.twitterCard;
    extra.twitter_title = tw.twitterTitle;
    extra.twitter_description = tw.twitterDescription;
    extra.twitter_image = tw.twitterImage;
    extra.twitter_site = tw.twitterSite;
    extra.twitter_creator = tw.twitterCreator;
  }

  // JSON-LD structured data (gated by settings)
  if (settings.parseJsonLd && result.metadata?.jsonLd) {
    const jld = result.metadata.jsonLd;
    extra.jsonld_schema_type = jld.schemaType;
    extra.jsonld_headline = jld.headline;
    extra.jsonld_description = jld.description;
    extra.jsonld_author = jld.author; // string | string[]
    extra.jsonld_publisher = jld.publisher;
    extra.jsonld_keywords = jld.keywords; // string[]
    extra.jsonld_section = jld.articleSection;
    extra.jsonld_date_published = jld.datePublished;
    extra.jsonld_date_modified = jld.dateModified;
    extra.jsonld_word_count = jld.wordCount;
    extra.jsonld_image = jld.image; // string | string[]
  }

  // Keywords from meta tags (gated by settings)
  if (settings.includeKeywords && result.metadata?.keywords?.length) {
    extra.keywords = result.metadata.keywords;
  }

  // Reading statistics (gated by settings)
  if (settings.computeReadingStats && result.metadata?.readingStats) {
    const rs = result.metadata.readingStats;
    extra.reading_word_count = rs.wordCount;
    extra.reading_char_count = rs.charCount;
    extra.reading_time_minutes = rs.estimatedReadingTimeMinutes;
  }

  // Selection clipping metadata
  if (result.metadata?.clipMode) {
    extra.clip_mode = result.metadata.clipMode;
  }
  if (result.metadata?.selectionContext) {
    extra.selection_context = result.metadata.selectionContext;
  }
  if (result.metadata?.selectionCount && result.metadata.selectionCount > 1) {
    extra.selection_count = result.metadata.selectionCount;
  }

  // Twitter/X specific metadata (Task 51)
  if (result.metadata?.twitterAuthorHandle) {
    extra.twitter_author_handle = result.metadata.twitterAuthorHandle;
  }
  if (result.metadata?.twitterThreadLength && result.metadata.twitterThreadLength > 1) {
    extra.twitter_thread_length = result.metadata.twitterThreadLength;
  }
  if (result.metadata?.twitterEngagement) {
    const eng = result.metadata.twitterEngagement;
    extra.twitter_replies = eng.replies;
    extra.twitter_retweets = eng.retweets;
    extra.twitter_likes = eng.likes;
    if (eng.views !== undefined) {
      extra.twitter_views = eng.views;
    }
    if (eng.bookmarks !== undefined) {
      extra.twitter_bookmarks = eng.bookmarks;
    }
  }

  return extra;
}
