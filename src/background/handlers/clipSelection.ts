/**
 * Handler for the clip-selection keyboard shortcut.
 *
 * Performs a selection clip without opening the popup:
 * 1. Gets the active tab
 * 2. Loads settings
 * 3. Ensures content script is loaded
 * 4. Clips only the selected text
 * 5. Saves to Obsidian using the configured method
 */

import { tabsQuery, tabsSendMessage, scriptingExecuteScript } from "../../shared/chromeAsync";
import { loadSettings } from "../../shared/settingsService";
import { DEFAULT_SETTINGS } from "../../shared/settings";
import type { Settings } from "../../shared/settings";
import { detectPageType } from "../../shared/pageType";
import { buildClipMarkdown, type FrontmatterInput } from "../../shared/markdown";
import { sanitizeFilename } from "../../shared/sanitize";
import { parseTags, addAutoTags } from "../../shared/tags";
import { injectWikiLinks } from "../../content/web/wikiLinks";
import { debug } from "../../shared/debug";
import { toErrorMessage } from "../../shared/errors";
import { showClipSavedNotification } from "../../shared/notifications";
import type { TabRequest, TabResponse } from "../../shared/messages";
import type { PageType, ClipResult } from "../../shared/types";

const SPA_DOMAINS = [
  "react.dev",
  "vuejs.org",
  "nextjs.org",
  "docs.github.com",
  "developer.mozilla.org",
  "stackoverflow.com",
  "reddit.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "notion.so",
  "atlassian.net",
  "figma.com",
  "linear.app",
  "discord.com"
] as const;

function isLikelySPA(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    return SPA_DOMAINS.some(
      (domain) => urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureContentScriptLoaded(tabId: number): Promise<void> {
  try {
    await tabsSendMessage<TabRequest, unknown>(tabId, { action: "getPageInfo" });
    return;
  } catch {
    // Not injected yet; inject the bundled content script.
  }

  await scriptingExecuteScript({
    target: { tabId },
    files: ["content/content.js"]
  });

  // Give the injected script a moment to initialize its onMessage listener.
  await sleep(150);

  // Verify listener is live.
  await tabsSendMessage<TabRequest, unknown>(tabId, { action: "getPageInfo" });
}

interface ClipSelectionResult {
  success: boolean;
  error?: string;
}

const MAX_URI_CONTENT_CHARS = 180_000;

/**
 * Build the markdown content for the clip result
 */
function buildMarkdown(
  result: ClipResult,
  settings: Settings,
  pageType: PageType,
  currentTabUrl: string
): string {
  const finalTitle = sanitizeFilename(result.title || "Untitled");

  const folder = (settings.defaultFolder || DEFAULT_SETTINGS.defaultFolder || "").trim();
  const rawTags = (settings.defaultTags || DEFAULT_SETTINGS.defaultTags || "").trim();
  const tags = addAutoTags(parseTags(rawTags), pageType);

  // Use canonical URL as source when available and enabled
  const source =
    settings.preferCanonicalUrl && result.metadata?.canonicalUrl
      ? result.metadata.canonicalUrl
      : result.metadata?.url || result.url || currentTabUrl;

  // Build extra frontmatter fields (only include defined values)
  const extra: FrontmatterInput["extra"] = {
    page_type: pageType
  };

  // Add optional metadata fields
  if (result.metadata?.publishedDate) extra.published_date = result.metadata.publishedDate;
  if (result.metadata?.description) extra.description = result.metadata.description;
  if (result.metadata?.paywalled !== undefined) extra.paywalled = result.metadata.paywalled;
  if (result.metadata?.passwordProtected !== undefined) extra.password_protected = result.metadata.passwordProtected;
  if (result.metadata?.scannedPDF !== undefined) extra.scanned_pdf = result.metadata.scannedPDF;
  if (result.metadata?.truncated !== undefined) extra.truncated = result.metadata.truncated;
  if (result.metadata?.siteName) extra.site_name = result.metadata.siteName;
  if (result.metadata?.language) extra.language = result.metadata.language;
  if (result.metadata?.clipMode) extra.clip_mode = result.metadata.clipMode;
  if (result.metadata?.selectionContext) extra.selection_context = result.metadata.selectionContext;
  if (result.metadata?.selectionCount && result.metadata.selectionCount > 1) {
    extra.selection_count = result.metadata.selectionCount;
  }

  const frontmatter: FrontmatterInput = {
    source,
    title: finalTitle,
    type: result.metadata?.type || "article",
    dateClippedISO: new Date().toISOString(),
    tags,
    author: result.metadata?.author,
    extra
  };

  const rawMarkdown = buildClipMarkdown(frontmatter, result.markdown || "");
  return injectWikiLinks(rawMarkdown, settings);
}

/**
 * Save via Obsidian URI scheme
 */
async function saveViaUri(
  vault: string,
  filePath: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  const encodedContent = encodeURIComponent(content);

  if (encodedContent.length > MAX_URI_CONTENT_CHARS) {
    return { success: false, error: "Content too large for URI" };
  }

  const uri = `obsidian://new?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(filePath)}&content=${encodedContent}`;

  try {
    // Use chrome.tabs.create to open the URI
    await chrome.tabs.create({ url: uri, active: false });
    return { success: true };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to open Obsidian URI") };
  }
}

/**
 * Copy content to clipboard
 */
async function saveViaClipboard(content: string): Promise<{ success: boolean; error?: string }> {
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (!clipboard) {
    return { success: false, error: "Clipboard API unavailable" };
  }

  try {
    await clipboard.writeText(content);
    return { success: true };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Clipboard write failed") };
  }
}

/**
 * Handle the clip-selection keyboard shortcut.
 *
 * This performs a selection clip without opening the popup.
 */
export async function handleClipSelection(): Promise<ClipSelectionResult> {
  // Get the active tab
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const tab = tabs[0];

  if (!tab?.id) {
    return { success: false, error: "No active tab found" };
  }

  if (!tab.url || !/^https?:\/\//.test(tab.url)) {
    return { success: false, error: "This page cannot be clipped (unsupported URL)" };
  }

  try {
    // Load settings
    const settings = await loadSettings();

    // Ensure content script is loaded
    await ensureContentScriptLoaded(tab.id);
    await sleep(isLikelySPA(tab.url) ? 1000 : 300);

    // Detect page type
    const pageType: PageType = detectPageType(tab.url);

    // Send clip request with selectionOnly: true
    const request: TabRequest = {
      action: "clip",
      pageType,
      isSPA: isLikelySPA(tab.url),
      selectionOnly: true,
      includeTimestamps: settings.includeTimestamps,
      settings
    };

    const response = await tabsSendMessage<TabRequest, TabResponse>(tab.id, request);

    if (!response?.ok) {
      return { success: false, error: response?.error || "Failed to extract content" };
    }

    const result = response.result;

    // Build markdown content
    const markdown = buildMarkdown(result, settings, pageType, tab.url);

    // Prepare save parameters
    const finalTitle = sanitizeFilename(result.title || "Untitled");
    const folder = (settings.defaultFolder || DEFAULT_SETTINGS.defaultFolder || "").trim();
    const filePath = folder ? `${folder}/${finalTitle}` : finalTitle;
    const noteTitle = finalTitle.trim() || "Untitled";
    const vault = (settings.vaultName || DEFAULT_SETTINGS.vaultName || "Main Vault").trim();

    // Try to save using the configured method with fallback
    const saveMethod = settings.saveMethod || DEFAULT_SETTINGS.saveMethod || "uri";

    // Try URI first (if CLI not enabled or as fallback)
    if (saveMethod === "uri" || saveMethod === "cli") {
      const uriResult = await saveViaUri(vault, filePath, markdown);
      if (uriResult.success) {
        void showClipSavedNotification(settings, noteTitle, vault);
        return { success: true };
      }

      // If URI failed and we're using CLI, CLI would need Native Messaging bridge
      // For now, fall back to clipboard
      if (saveMethod === "cli") {
        debug("ClipSelection", "CLI save not available in service worker, falling back to clipboard");
      }
    }

    // Clipboard fallback
    if (saveMethod === "clipboard" || saveMethod === "uri" || saveMethod === "cli") {
      const clipboardResult = await saveViaClipboard(markdown);
      if (clipboardResult.success) {
        debug("ClipSelection", "Selection clip saved to clipboard (paste into Obsidian)");
        void showClipSavedNotification(settings, noteTitle, vault);
        return { success: true };
      }
      return { success: false, error: clipboardResult.error || "Failed to save to clipboard" };
    }

    return { success: false, error: "Unknown save method" };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to clip selection") };
  }
}
