import { detectPageType } from "../shared/pageType";
import { toErrorMessage } from "../shared/errors";
import { getTemplateForUrl } from "./templates";

import { extractWebPageContent } from "./extractors/web";
import { extractPDFContent } from "./extractors/pdf";
import { extractYouTubeContent } from "./extractors/youtube";
import { extractTwitterContent } from "./extractors/twitter";

import type { ClipResult, PageType } from "../shared/types";
import type { PageInfo, TabRequest, TabResponse, TemplateInfo } from "../shared/messages";

type ClipRequest = Extract<TabRequest, { action: "clip" }>;

export async function clipPage(request: ClipRequest): Promise<TabResponse> {
  const url = window.location.href;
  const detectedType = detectPageType(url, document.contentType);
  const pageType: PageType = request.pageType ?? detectedType;
  const settings = request.settings;

  console.log("[Clip] handleClip called");
  console.log("[Clip] URL:", url);
  console.log("[Clip] detectedType:", detectedType);
  console.log("[Clip] request.pageType:", request.pageType);
  console.log("[Clip] final pageType:", pageType);
  console.log("[Clip] document.contentType:", document.contentType);

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
      case "youtube":
        result = await extractYouTubeContent(
          baseResult,
          request.includeTimestamps !== false
        );
        break;
      case "twitter":
        result = await extractTwitterContent(baseResult);
        break;
      case "pdf":
        result = await extractPDFContent(baseResult);
        break;
      case "web":
      default:
        result = extractWebPageContent({
          result: baseResult,
          settings,
          selectionOnly: request.selectionOnly,
          disableTemplate: request.disableTemplate
        });
        break;
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