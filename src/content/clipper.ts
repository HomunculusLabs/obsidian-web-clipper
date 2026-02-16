import { detectPageType } from "../shared/pageType";
import { toErrorMessage, RouterError } from "../shared/errors";
import { getTemplateForUrl, isTwitterTemplate } from "./templates";
import { debug } from "../shared/debug";

// Import web extractor statically (always needed as fallback)
import { extractWebPageContent } from "./extractors/web";

// Lazy-load heavy extractors for code splitting
// These will be loaded only when needed, reducing initial bundle size

// Cache for loaded extractors
let _extractYouTubeContent: ((result: ClipResult, includeTimestamps: boolean) => Promise<ClipResult>) | null = null;
let _extractTwitterContent: ((result: ClipResult) => Promise<ClipResult>) | null = null;
let _extractPDFContent: ((result: ClipResult) => Promise<ClipResult>) | null = null;

/**
 * Lazy-load the YouTube extractor.
 * This reduces initial bundle size by ~15KB (minified).
 */
async function getYouTubeExtractor(): Promise<(result: ClipResult, includeTimestamps: boolean) => Promise<ClipResult>> {
  if (!_extractYouTubeContent) {
    const module = await import("./extractors/youtube");
    _extractYouTubeContent = module.extractYouTubeContent;
  }
  return _extractYouTubeContent;
}

/**
 * Lazy-load the Twitter extractor.
 * This reduces initial bundle size by ~60KB (minified) - the largest extractor.
 */
async function getTwitterExtractor(): Promise<(result: ClipResult) => Promise<ClipResult>> {
  if (!_extractTwitterContent) {
    const module = await import("./extractors/twitter");
    _extractTwitterContent = module.extractTwitterContent;
  }
  return _extractTwitterContent;
}

/**
 * Lazy-load the PDF extractor.
 * This reduces initial bundle size slightly.
 */
async function getPDFExtractor(): Promise<(result: ClipResult) => Promise<ClipResult>> {
  if (!_extractPDFContent) {
    const module = await import("./extractors/pdf");
    _extractPDFContent = module.extractPDFContent;
  }
  return _extractPDFContent;
}

import type { ClipResult, PageType } from "../shared/types";
import type { PageInfo, TabRequest, TabResponse, TemplateInfo } from "../shared/messages";

type ClipRequest = Extract<TabRequest, { action: "clip" }>;

/**
 * Check if a Twitter template is enabled for the given URL.
 * Returns false if the template is disabled or if no template matches.
 */
function isTwitterTemplateEnabled(url: string, settings: ClipRequest["settings"]): boolean {
  // If templates are disabled globally, use the dedicated extractor
  if (settings.templatesEnabled === false) {
    return true;
  }

  const template = getTemplateForUrl(url, {
    customTemplates: settings.customTemplates,
    disabledBuiltIns: settings.disabledBuiltIns,
    includeBuiltIns: true
  });

  // If no template matches, default to using the dedicated extractor
  if (!template) {
    return true;
  }

  // Check if this is a Twitter template
  if (isTwitterTemplate(template)) {
    // Template is matched and enabled, use dedicated extractor
    return true;
  }

  // Non-Twitter template matched (shouldn't happen on Twitter URLs, but handle it)
  return false;
}

export async function clipPage(request: ClipRequest): Promise<TabResponse> {
  const url = window.location.href;
  const detectedType = detectPageType(url, document.contentType);
  const pageType: PageType = request.pageType ?? detectedType;
  const settings = request.settings;

  debug("Clip", "handleClip called");
  debug("Clip", "URL:", url);
  debug("Clip", "detectedType:", detectedType);
  debug("Clip", "request.pageType:", request.pageType);
  debug("Clip", "final pageType:", pageType);
  debug("Clip", "document.contentType:", document.contentType);

  const title = document.title || "Untitled";

  const baseResult: ClipResult = {
    url,
    title,
    markdown: "",
    metadata: {
      url,
      title,
      type: "article"
    }
  };

  try {
    let result: ClipResult;

    switch (pageType) {
      case "youtube": {
        // Lazy-load YouTube extractor (~15KB)
        const extractYouTube = await getYouTubeExtractor();
        result = await extractYouTube(
          baseResult,
          request.includeTimestamps !== false
        );
        break;
      }
      case "twitter": {
        // Check if Twitter template is enabled
        // If disabled via template settings, fall back to web extractor
        if (isTwitterTemplateEnabled(url, settings)) {
          // Lazy-load Twitter extractor (~60KB - largest extractor)
          const extractTwitter = await getTwitterExtractor();
          result = await extractTwitter(baseResult);
        } else {
          debug("Clip", "Twitter template disabled, falling back to web extractor");
          result = extractWebPageContent({
            result: baseResult,
            settings,
            selectionOnly: request.selectionOnly,
            disableTemplate: true
          });
        }
        break;
      }
      case "pdf": {
        // Lazy-load PDF extractor
        const extractPDF = await getPDFExtractor();
        result = await extractPDF(baseResult);
        break;
      }
      case "web":
        result = extractWebPageContent({
          result: baseResult,
          settings,
          selectionOnly: request.selectionOnly,
          disableTemplate: request.disableTemplate
        });
        break;
      default: {
        // Exhaustive check: this will fail to compile if any PageType case is missing
        const _exhaustive: never = pageType;
        throw new RouterError(`Unknown page type: ${_exhaustive}`, "UNKNOWN_PAGE_TYPE");
      }
    }

    return { ok: true, result };
  } catch (error) {
    console.error("Clip error:", error);
    return { ok: false, error: toErrorMessage(error) };
  }
}

/**
 * Quick Twitter thread detection for popup UI.
 * Returns the number of tweets in the thread (1 if not a thread).
 * This is a lightweight check - full extraction happens in extractTwitterContent.
 */
function detectTwitterThreadLength(): number | undefined {
  // Only run on Twitter/X pages
  const url = window.location.href;
  if (!url.match(/^https?:\/\/(www\.|mobile\.)?(twitter|x)\.com\//)) {
    return undefined;
  }

  // Must be a tweet page (has /status/ in URL)
  if (!url.includes("/status/")) {
    return undefined;
  }

  // Find all tweet articles on the page
  const allArticles = document.querySelectorAll('article[data-testid="tweet"]');
  if (allArticles.length <= 1) {
    return 1; // Single tweet
  }

  // Get the author handle from the first tweet
  const firstArticle = allArticles[0];
  let mainHandle = "";
  const authorLinks = firstArticle?.querySelectorAll('a[role="link"]');
  if (authorLinks) {
    for (const link of authorLinks) {
      const href = link.getAttribute("href") || "";
      if (href.startsWith("/") && !href.includes("/status/") && !href.includes("/photo/") && !href.includes("/video/")) {
        mainHandle = href.slice(1);
        break;
      }
    }
  }

  if (!mainHandle) {
    return 1;
  }

  // Count consecutive tweets by the same author
  let count = 0;
  let foundMainTweet = false;
  let threadEnded = false;

  for (const article of allArticles) {
    let handle = "";
    const links = article.querySelectorAll('a[role="link"]');
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      if (href.startsWith("/") && !href.includes("/status/") && !href.includes("/photo/") && !href.includes("/video/")) {
        handle = href.slice(1);
        break;
      }
    }

    if (!foundMainTweet) {
      if (handle === mainHandle) {
        foundMainTweet = true;
        count = 1;
      }
      continue;
    }

    if (threadEnded) break;

    if (handle === mainHandle) {
      count++;
    } else {
      // Different author - check if this is a retweet by the main author
      const socialContext = article.querySelector('[data-testid="socialContext"]');
      if (socialContext) {
        const text = socialContext.textContent?.toLowerCase() || "";
        if ((text.includes("reposted") || text.includes("retweeted")) &&
            (text.toLowerCase().includes(mainHandle.toLowerCase()) || text.includes("@" + mainHandle))) {
          count++;
          continue;
        }
      }
      threadEnded = true;
    }
  }

  return count > 1 ? count : 1;
}

export function getPageInfo(): PageInfo {
  const url = window.location.href;
  const pageType = detectPageType(url, document.contentType);
  
  return {
    url,
    title: document.title || "Untitled",
    type: pageType,
    contentType: document.contentType || "",
    // Add Twitter thread length if this is a Twitter page
    twitterThreadLength: pageType === "twitter" ? detectTwitterThreadLength() : undefined
  };
}

/**
 * Get template info for the current URL.
 * Returns information about which template (if any) matches this page.
 */
export function getTemplateInfo(settings: ClipRequest["settings"]): TemplateInfo {
  const url = window.location.href;

  if (settings.templatesEnabled === false) {
    return { hasTemplate: false };
  }

  const template = getTemplateForUrl(url, {
    customTemplates: settings.customTemplates,
    disabledBuiltIns: settings.disabledBuiltIns,
    includeBuiltIns: true
  });

  if (!template) {
    return { hasTemplate: false };
  }

  // Determine if this is a built-in or custom template
  const isBuiltIn = !settings.customTemplates?.some(
    (t) => t.domain === template.domain && t.name === template.name
  );

  return {
    hasTemplate: true,
    templateName: template.name,
    templateDomain: template.domain,
    templateSource: isBuiltIn ? "built-in" : "custom"
  };
}