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
import { DEFAULT_NO_QUERY_DIAGNOSTICS } from "./retrievalQueryPackContract";

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
    extra,
    queryPackDiagnostics: DEFAULT_NO_QUERY_DIAGNOSTICS
  };

  return {
    frontmatter,
    finalTitle,
    filePath,
    tags,
    source
  };
}

function addTrimmedExtraField(
  extra: NonNullable<FrontmatterInput["extra"]>,
  key: string,
  value: string | null | undefined
): void {
  const cleaned = value?.trim();
  if (!cleaned) {
    return;
  }

  extra[key] = cleaned;
}

function addNumericExtraField(
  extra: NonNullable<FrontmatterInput["extra"]>,
  key: string,
  value: number | null | undefined
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }

  extra[key] = value;
}

function normalizeStringArray(values: string[] | string | null | undefined): string[] {
  const valueList = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? [values]
      : [];

  const unique = new Set<string>();
  for (const value of valueList) {
    const cleaned = value.trim();
    if (!cleaned) {
      continue;
    }
    if (!unique.has(cleaned)) {
      unique.add(cleaned);
    }
  }

  return [...unique];
}

function addStringArrayExtraField(
  extra: NonNullable<FrontmatterInput["extra"]>,
  key: string,
  values: string[] | string | null | undefined
): void {
  const cleanedValues = normalizeStringArray(values);
  if (cleanedValues.length === 0) {
    return;
  }

  extra[key] = cleanedValues;
}

/**
 * Build the extra fields for frontmatter based on clip result and settings.
 */
function buildExtraFields(
  result: ClipResult,
  settings: Settings,
  _pageType: PageType
): FrontmatterInput["extra"] {
  const extra: NonNullable<FrontmatterInput["extra"]> = {
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

  // SeedFinder full profile metadata (normalized + raw source values)
  const seedFinderProfile = result.metadata?.seedFinderProfile;

  if (seedFinderProfile) {
    addTrimmedExtraField(extra, "seedfinder_lineage", seedFinderProfile.lineage);
    addStringArrayExtraField(extra, "seedfinder_lineage_parents", seedFinderProfile.lineageParents);

    const thc = seedFinderProfile.potency?.thc;
    if (thc) {
      addTrimmedExtraField(extra, "seedfinder_thc_raw", thc.raw);
      addNumericExtraField(extra, "seedfinder_thc_min_percent", thc.minPercent);
      addNumericExtraField(extra, "seedfinder_thc_max_percent", thc.maxPercent);
      addTrimmedExtraField(extra, "seedfinder_thc_comparator", thc.comparator);
    }

    const cbd = seedFinderProfile.potency?.cbd;
    if (cbd) {
      addTrimmedExtraField(extra, "seedfinder_cbd_raw", cbd.raw);
      addNumericExtraField(extra, "seedfinder_cbd_min_percent", cbd.minPercent);
      addNumericExtraField(extra, "seedfinder_cbd_max_percent", cbd.maxPercent);
      addTrimmedExtraField(extra, "seedfinder_cbd_comparator", cbd.comparator);
    }

    const flowering = seedFinderProfile.flowering;
    if (flowering) {
      addTrimmedExtraField(extra, "seedfinder_flowering_raw", flowering.raw);
      addNumericExtraField(extra, "seedfinder_flowering_min_days", flowering.minDays);
      addNumericExtraField(extra, "seedfinder_flowering_max_days", flowering.maxDays);
      addNumericExtraField(extra, "seedfinder_flowering_min_weeks", flowering.minWeeks);
      addNumericExtraField(extra, "seedfinder_flowering_max_weeks", flowering.maxWeeks);
      addTrimmedExtraField(
        extra,
        "seedfinder_flowering_harvest_window",
        flowering.harvestWindow
      );
    }

    addTrimmedExtraField(extra, "seedfinder_breeder", seedFinderProfile.breeder);
    addStringArrayExtraField(extra, "seedfinder_aroma", seedFinderProfile.aroma);
    addStringArrayExtraField(extra, "seedfinder_effects", seedFinderProfile.effects);

    const rawSourceValues = seedFinderProfile.rawSourceValues;
    if (rawSourceValues) {
      addTrimmedExtraField(extra, "seedfinder_raw_lineage", rawSourceValues.lineage);
      addStringArrayExtraField(
        extra,
        "seedfinder_raw_lineage_parents",
        rawSourceValues.lineageParents
      );
      addTrimmedExtraField(extra, "seedfinder_raw_thc", rawSourceValues.thc);
      addTrimmedExtraField(extra, "seedfinder_raw_cbd", rawSourceValues.cbd);
      addTrimmedExtraField(extra, "seedfinder_raw_flowering", rawSourceValues.flowering);
      addTrimmedExtraField(extra, "seedfinder_raw_breeder", rawSourceValues.breeder);
      addStringArrayExtraField(extra, "seedfinder_raw_aroma", rawSourceValues.aroma);
      addStringArrayExtraField(extra, "seedfinder_raw_effects", rawSourceValues.effects);
    }
  }

  // SeedFinder legacy compatibility keys
  addTrimmedExtraField(extra, "lineage", seedFinderProfile?.lineage ?? result.metadata?.lineage);
  addStringArrayExtraField(
    extra,
    "lineage_parents",
    seedFinderProfile?.lineageParents ?? result.metadata?.lineageParents
  );

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
