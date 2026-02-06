import { Readability } from "@mozilla/readability";

import { createTurndownService } from "../web/turndown";
import { extractWebMetadata } from "../web/metadata";
import {
  extractVisibleContent,
  isPaywalled,
  type ReadabilityArticleLike
} from "../web/paywall";

import type { ClipResult } from "../../shared/types";
import type { Settings } from "../../shared/settings";

export interface ExtractWebPageArgs {
  result: ClipResult;
  settings: Settings;
  pageUrl?: string; // optional override
}

// Extract web page content using Readability
export function extractWebPageContent(args: ExtractWebPageArgs): ClipResult {
  const { result, settings } = args;
  const pageUrl = args.pageUrl || result.url || window.location.href;

  const documentClone = document.cloneNode(true) as Document;

  const article = new Readability(documentClone, {
    charThreshold: 100
  }).parse() as ReadabilityArticleLike;

  // Check for paywall
  if (isPaywalled(article, documentClone)) {
    result.metadata.paywalled = true;

    // Try to get visible content as fallback
    const visibleContent = extractVisibleContent();

    result.markdown =
      `# ${result.title}\n\n` +
      `> ⚠️ **This page may be paywalled or have limited access.**\n` +
      `> The content below is extracted from the visible page text and may be incomplete.\n\n` +
      `---\n\n${visibleContent}`;

    return result;
  }

  if (!article || !article.content) {
    throw new Error("Could not extract article content");
  }

  // Add core metadata from Readability
  result.metadata.author = (article.byline || "").trim();
  result.metadata.publishedDate = article.publishedTime || "";
  result.metadata.description = (article.excerpt || "").trim();

  // Extract rich metadata (OG, Twitter, JSON-LD, keywords, reading stats)
  const metadataPatch = extractWebMetadata({
    doc: documentClone,
    pageUrl,
    settings,
    articleText: article.textContent
  });
  Object.assign(result.metadata, metadataPatch);

  // Convert HTML to markdown with settings-based configuration
  const turndownService = createTurndownService(settings);
  const markdown = turndownService.turndown(article.content);

  // Build final markdown with title and content
  const finalTitle = (article.title || result.title || "Untitled").trim();
  const excerpt = (article.excerpt || "").trim();

  result.markdown = `# ${finalTitle}\n\n${excerpt ? `> ${excerpt}\n\n` : ""}${markdown}`;

  return result;
}