import { detectPageType } from "../shared/pageType";
import { toErrorMessage } from "../shared/errors";

import { extractWebPageContent } from "./extractors/web";
import { extractPDFContent } from "./extractors/pdf";
import { extractYouTubeContent } from "./extractors/youtube";

import type { ClipResult, PageType } from "../shared/types";
import type { PageInfo, TabRequest, TabResponse } from "../shared/messages";

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
      case "pdf":
        result = await extractPDFContent(baseResult);
        break;
      case "web":
      default:
        result = extractWebPageContent({ result: baseResult, settings });
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