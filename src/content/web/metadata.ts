// src/content/web/metadata.ts
import type {
  OGMetadata,
  TwitterMetadata,
  ReadingStats,
  ClipMetadata
} from "../../shared/types";
import type { Settings } from "../../shared/settings";
import { extractJsonLdMetadata } from "./jsonLd";

export type WebMetadataPatch = Pick<
  ClipMetadata,
  | "canonicalUrl"
  | "og"
  | "twitter"
  | "jsonLd"
  | "keywords"
  | "readingStats"
  | "siteName"
  | "language"
>;

export function extractWebMetadata(args: {
  doc: Document;
  pageUrl: string;
  settings: Settings;
  articleText?: string; // pass Readability's textContent if available
}): WebMetadataPatch {
  const { doc, pageUrl, settings, articleText } = args;

  const canonicalUrl = extractCanonicalUrl(doc, pageUrl);
  const patch: WebMetadataPatch = {};

  // Always extract siteName and language (lightweight)
  const siteName = extractSiteName(doc);
  if (siteName) patch.siteName = siteName;

  const language = extractLanguage(doc);
  if (language) patch.language = language;

  if (settings.preferCanonicalUrl && canonicalUrl) {
    patch.canonicalUrl = canonicalUrl;
  }

  if (settings.includeOGFields) {
    const og = extractOpenGraphMetadata(doc, pageUrl);
    if (og) patch.og = og;
    // Fallback: if preferCanonicalUrl and no <link rel=canonical>, use og.ogUrl
    if (settings.preferCanonicalUrl && !patch.canonicalUrl && og?.ogUrl) {
      patch.canonicalUrl = og.ogUrl;
    }
    // Extract siteName from OG if not already set
    if (!patch.siteName && og?.ogSiteName) {
      patch.siteName = og.ogSiteName;
    }
  }

  if (settings.includeTwitterFields) {
    const twitter = extractTwitterMetadata(doc, pageUrl);
    if (twitter) patch.twitter = twitter;
  }

  if (settings.includeKeywords) {
    const keywords = extractKeywords(doc);
    if (keywords?.length) patch.keywords = keywords;
  }

  if (settings.computeReadingStats && articleText) {
    const readingStats = computeReadingStatsFromText(articleText);
    if (readingStats) patch.readingStats = readingStats;
  }

  if (settings.parseJsonLd) {
    const jsonLd = extractJsonLdMetadata(doc);
    if (jsonLd) patch.jsonLd = jsonLd;
  }

  return patch;
}

export function extractCanonicalUrl(
  doc: Document,
  pageUrl: string
): string | undefined {
  const href =
    doc.querySelector<HTMLLinkElement>('link[rel="canonical"][href]')?.href ||
    doc.querySelector<HTMLLinkElement>(
      'link[rel="alternate"][href][hreflang="x-default"]'
    )?.href;

  const resolved = resolveHttpUrl(href, pageUrl);
  return resolved || undefined;
}

export function extractOpenGraphMetadata(
  doc: Document,
  pageUrl: string
): OGMetadata | undefined {
  const ogTitle = firstMeta(doc, 'meta[property="og:title"]');
  const ogDescription = firstMeta(doc, 'meta[property="og:description"]');
  const ogType = firstMeta(doc, 'meta[property="og:type"]');
  const ogSiteName = firstMeta(doc, 'meta[property="og:site_name"]');
  const ogLocale = firstMeta(doc, 'meta[property="og:locale"]');

  const ogUrlRaw = firstMeta(doc, 'meta[property="og:url"]');
  const ogUrl = resolveHttpUrl(ogUrlRaw, pageUrl);

  const ogImagesRaw = allMeta(doc, 'meta[property="og:image"]');
  const ogImages = dedupe(
    ogImagesRaw
      .map((u) => resolveHttpUrl(u, pageUrl))
      .filter(Boolean) as string[]
  );

  const og: OGMetadata = {
    ogTitle,
    ogDescription,
    ogType,
    ogSiteName,
    ogLocale,
    ogUrl,
    ogImages: ogImages.length ? ogImages : undefined,
    ogImage: ogImages[0]
  };

  return hasAnyValue(og) ? og : undefined;
}

export function extractTwitterMetadata(
  doc: Document,
  pageUrl: string
): TwitterMetadata | undefined {
  const twitterCard = firstMeta(doc, 'meta[name="twitter:card"]');
  const twitterTitle = firstMeta(doc, 'meta[name="twitter:title"]');
  const twitterDescription = firstMeta(doc, 'meta[name="twitter:description"]');
  const twitterSite = firstMeta(doc, 'meta[name="twitter:site"]');
  const twitterCreator = firstMeta(doc, 'meta[name="twitter:creator"]');

  const twitterImageRaw =
    firstMeta(doc, 'meta[name="twitter:image"]') ||
    firstMeta(doc, 'meta[name="twitter:image:src"]');

  const twitterImage = resolveHttpUrl(twitterImageRaw, pageUrl);

  const twitter: TwitterMetadata = {
    twitterCard,
    twitterTitle,
    twitterDescription,
    twitterImage,
    twitterSite,
    twitterCreator
  };

  return hasAnyValue(twitter) ? twitter : undefined;
}

export function extractKeywords(doc: Document): string[] | undefined {
  const keywordsRaw = allMeta(doc, 'meta[name="keywords"]')
    .flatMap((v) => v.split(","))
    .map(clean)
    .filter(Boolean);

  const articleTags = allMeta(doc, 'meta[property="article:tag"]')
    .map(clean)
    .filter(Boolean);

  const newsKeywords = allMeta(doc, 'meta[name="news_keywords"]')
    .flatMap((v) => v.split(","))
    .map(clean)
    .filter(Boolean);

  const merged = dedupe([...keywordsRaw, ...articleTags, ...newsKeywords]);
  return merged.length ? merged : undefined;
}

export function computeReadingStatsFromText(
  text: string
): ReadingStats | undefined {
  const cleaned = clean(text);
  if (!cleaned) return undefined;

  const wordCount = (cleaned.match(/\S+/g) || []).length;
  const charCount = cleaned.length;
  const WPM = 220;
  const estimatedReadingTimeMinutes = Math.max(1, Math.ceil(wordCount / WPM));

  return { wordCount, charCount, estimatedReadingTimeMinutes };
}

export function extractSiteName(doc: Document): string | undefined {
  // Try multiple sources for site name
  const ogSiteName = firstMeta(doc, 'meta[property="og:site_name"]');
  if (ogSiteName) return ogSiteName;

  const applicationName = firstMeta(doc, 'meta[name="application-name"]');
  if (applicationName) return applicationName;

  const twitterSite = firstMeta(doc, 'meta[name="twitter:site"]');
  if (twitterSite) return twitterSite.replace(/^@/, "");

  return undefined;
}

export function extractLanguage(doc: Document): string | undefined {
  // Try html lang attribute first
  const htmlLang = doc.documentElement.lang;
  if (htmlLang) return clean(htmlLang) || undefined;

  // Try og:locale
  const ogLocale = firstMeta(doc, 'meta[property="og:locale"]');
  if (ogLocale) return ogLocale;

  // Try Content-Language meta
  const contentLang = firstMeta(doc, 'meta[http-equiv="Content-Language"]');
  if (contentLang) return contentLang;

  return undefined;
}

// ---- helpers ----

function firstMeta(doc: Document, selector: string): string | undefined {
  const v = doc.querySelector<HTMLMetaElement>(selector)?.content;
  const cleaned = clean(v);
  return cleaned || undefined;
}

function allMeta(doc: Document, selector: string): string[] {
  return Array.from(doc.querySelectorAll<HTMLMetaElement>(selector))
    .map((m) => clean(m.content))
    .filter(Boolean) as string[];
}

function clean(v?: string | null): string {
  return (v || "").replace(/\s+/g, " ").trim();
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function resolveHttpUrl(
  raw: string | undefined,
  base: string
): string | undefined {
  const v = clean(raw);
  if (!v) return undefined;
  try {
    const u = new URL(v, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

function hasAnyValue<T extends object>(obj: T): boolean {
  return Object.values(obj).some((v) => {
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== "";
  });
}
