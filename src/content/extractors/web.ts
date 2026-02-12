import { Readability } from "@mozilla/readability";

import { createTurndownService } from "../web/turndown";
import { extractWebMetadata } from "../web/metadata";
import {
  extractVisibleContent,
  isPaywalled,
  type ReadabilityArticleLike
} from "../web/paywall";
import { getSelection, type SelectionResult } from "../selection";
import { getTemplateForUrl } from "../templates/registry";

import type { ClipResult } from "../../shared/types";
import type { Settings } from "../../shared/settings";

export interface ExtractWebPageArgs {
  result: ClipResult;
  settings: Settings;
  pageUrl?: string; // optional override
  selectionOnly?: boolean; // extract only user-selected content
}

// Extract web page content using Readability
export function extractWebPageContent(args: ExtractWebPageArgs): ClipResult {
  const { result, settings, selectionOnly } = args;
  const pageUrl = args.pageUrl || result.url || window.location.href;

  // Handle selection-only mode
  if (selectionOnly) {
    return extractSelectionContent(result, settings, pageUrl);
  }

  // Standard full-page extraction
  return extractFullPageContent(result, settings, pageUrl);
}

/**
 * Extract only the user-selected content.
 * Falls back to full-page extraction if no selection exists.
 */
function extractSelectionContent(
  result: ClipResult,
  settings: Settings,
  pageUrl: string
): ClipResult {
  const selection = getSelection();

  // No selection - fall back to full page extraction
  if (!selection.hasSelection) {
    console.log("[Web Extractor] No selection found, falling back to full page");
    return extractFullPageContent(result, settings, pageUrl);
  }

  console.log("[Web Extractor] Extracting selection:", {
    rangeCount: selection.rangeCount,
    isMultiSelection: selection.isMultiSelection,
    textLength: selection.text.length
  });

  // Set clip mode metadata
  result.metadata.clipMode = "selection";

  // Track selection count (for multi-selection)
  if (selection.isMultiSelection) {
    result.metadata.selectionCount = selection.rangeCount;
  }

  // Extract surrounding context for the selection
  const selectionContext = getSelectionContext();
  if (selectionContext) {
    result.metadata.selectionContext = selectionContext;
  }

  // Extract metadata from the page (but not full content)
  const documentClone = document.cloneNode(true) as Document;
  const metadataPatch = extractWebMetadata({
    doc: documentClone,
    pageUrl,
    settings,
    articleText: selection.text
  });
  Object.assign(result.metadata, metadataPatch);

  // Convert selection HTML to markdown
  const turndownService = createTurndownService(settings);
  const markdown = turndownService.turndown(selection.html);

  // Build final markdown with title and selection
  result.markdown = `# ${result.title}\n\n${markdown}`;

  return result;
}

/**
 * Get surrounding context for the current selection.
 * Returns the text content of the nearest ancestor element that provides
 * meaningful context (e.g., a paragraph, heading, or list item).
 * For multi-selection, returns context for the first range only.
 */
function getSelectionContext(): string | null {
  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
    return null;
  }

  // For multi-selection, we get context from the first range only
  // (Getting context for all ranges would be too verbose)
  const range = domSelection.getRangeAt(0);
  let container: Node | null = range.commonAncestorContainer;

  // Walk up the DOM tree to find a meaningful context element
  // Stop at article, main, body, or when we find a good context element
  const contextTags = new Set(["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "TD", "TH", "DD", "DT"]);
  const stopTags = new Set(["ARTICLE", "MAIN", "BODY"]);

  let contextText: string | null = null;
  const maxContextLength = 200;

  while (container && container !== document.body) {
    if (container.nodeType === Node.ELEMENT_NODE) {
      const element = container as Element;
      const tagName = element.tagName;

      // Stop at these container elements
      if (stopTags.has(tagName)) {
        break;
      }

      // Check if this is a good context element
      if (contextTags.has(tagName)) {
        const text = element.textContent?.trim() || "";
        if (text.length > 0 && text.length <= maxContextLength * 2) {
          // Truncate if too long, preserving the beginning
          contextText = text.length > maxContextLength
            ? text.substring(0, maxContextLength) + "…"
            : text;
          break;
        }
      }
    }

    container = container.parentNode;
  }

  return contextText;
}

/**
 * Extract full page content using Readability.
 */
function extractFullPageContent(
  result: ClipResult,
  settings: Settings,
  pageUrl: string
): ClipResult {
  const documentClone = document.cloneNode(true) as Document;

  // Check for a matching template first
  if (settings.templatesEnabled !== false) {
    const template = getTemplateForUrl(pageUrl, {
      customTemplates: settings.customTemplates,
      disabledBuiltIns: settings.disabledBuiltIns,
      includeBuiltIns: true
    });

    if (template?.selectors.content) {
      console.log("[Web Extractor] Using template:", template.name, "for", pageUrl);
      try {
        const templateResult = extractWithTemplate(documentClone, template, settings, pageUrl);
        if (templateResult) {
          // Merge metadata into result
          Object.assign(result.metadata, templateResult.metadata);
          result.markdown = templateResult.markdown;
          result.title = templateResult.title || result.title;
          result.metadata.templateUsed = template.name;
          return result;
        }
      } catch (error) {
        console.warn("[Web Extractor] Template extraction failed, falling back to Readability:", error);
      }
    }
  }

  // Standard Readability extraction
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

/**
 * Extract content using a site-specific template.
 * Returns null if extraction fails or produces no content.
 */
function extractWithTemplate(
  doc: Document,
  template: import("../../shared/templates").SiteTemplate,
  settings: Settings,
  pageUrl: string
): { markdown: string; title: string; metadata: ClipResult["metadata"] } | null {
  const { selectors, removeSelectors } = template;

  // Remove unwanted elements first
  if (removeSelectors && removeSelectors.length > 0) {
    for (const selector of removeSelectors) {
      try {
        const elements = doc.querySelectorAll(selector);
        elements.forEach((el) => el.remove());
      } catch (e) {
        console.warn("[Web Extractor] Invalid removeSelector:", selector);
      }
    }
  }

  // Extract content using the template's content selector
  // Note: selectors.content is guaranteed to be defined because the caller checks it
  const contentEl = doc.querySelector(selectors.content!);
  if (!contentEl) {
    console.warn("[Web Extractor] Template content selector not found:", selectors.content);
    return null;
  }

  // Extract title
  let title = "";
  if (selectors.title) {
    const titleEl = doc.querySelector(selectors.title);
    title = titleEl?.textContent?.trim() || "";
  }

  // Extract author
  let author = "";
  if (selectors.author) {
    const authorEl = doc.querySelector(selectors.author);
    author = authorEl?.textContent?.trim() || "";
  }

  // Extract date
  let date = "";
  if (selectors.date) {
    const dateEl = doc.querySelector(selectors.date);
    // Try to get datetime attribute first, then text content
    date = dateEl?.getAttribute("datetime") || dateEl?.textContent?.trim() || "";
  }

  // Extract tags
  let tags: string[] = [];
  if (selectors.tags) {
    const tagEls = doc.querySelectorAll(selectors.tags);
    tags = Array.from(tagEls)
      .map((el) => el.textContent?.trim())
      .filter((t): t is string => !!t && t.length > 0);
  }

  // Extract description
  let description = "";
  if (selectors.description) {
    const descEl = doc.querySelector(selectors.description);
    description = descEl?.textContent?.trim() || "";
  }

  // Convert content HTML to markdown
  const turndownService = createTurndownService(settings);
  const markdown = turndownService.turndown(contentEl.innerHTML);

  // Build metadata
  const metadata: ClipResult["metadata"] = {
    url: pageUrl,
    title: title || document.title || "Untitled",
    type: "article"
  };

  if (author) metadata.author = author;
  if (date) metadata.publishedDate = date;
  if (description) metadata.description = description;
  if (tags.length > 0) metadata.keywords = tags;

  // Add any frontmatter extras from the template
  if (template.frontmatterExtras) {
    Object.assign(metadata, template.frontmatterExtras);
  }

  // Build final markdown
  const finalTitle = title || document.title || "Untitled";
  const excerpt = description ? `> ${description}\n\n` : "";

  return {
    markdown: `# ${finalTitle}\n\n${excerpt}${markdown}`,
    title: finalTitle,
    metadata
  };
}