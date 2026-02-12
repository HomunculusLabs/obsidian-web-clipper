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

export function getPageInfo(): PageInfo {
  const url = window.location.href;
  return {
    url,
    title: document.title || "Untitled",
    type: detectPageType(url, document.contentType),
    contentType: document.contentType || ""
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