import type { ClipResult, PageType } from "../shared/types";
import type { PageInfo, TabRequest, TabResponse } from "../shared/messages";
import type { Settings } from "../shared/settings";
import { tabsSendMessage, scriptingExecuteScript } from "../shared/chromeAsync";
import { isClipResult, isTabResponse } from "../shared/guards";
import { TabError, ExtractionError } from "../shared/errors";
import { sleep } from "./ui";

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

export function isLikelySPA(url: string | undefined): boolean {
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

export async function waitForDynamicContent(tab: chrome.tabs.Tab | null): Promise<void> {
  const waitTime = isLikelySPA(tab?.url) ? 1000 : 300;
  await sleep(waitTime);
}

export async function ensureContentScriptLoaded(tabId: number): Promise<void> {
  try {
    await tabsSendMessage<TabRequest, PageInfo>(tabId, { action: "getPageInfo" });
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
  await tabsSendMessage<TabRequest, PageInfo>(tabId, { action: "getPageInfo" });
}

function normalizeTabResponse(raw: unknown): TabResponse {
  if (isTabResponse(raw)) return raw;

  if (isClipResult(raw)) {
    return { ok: true, result: raw };
  }

  return { ok: false, error: "Unexpected response from content script" };
}

export type ClipOptions = {
  tab: chrome.tabs.Tab;
  pageType: PageType;
  settings: Settings;
  /** Whether to clip only the selected text */
  selectionOnly?: boolean;
  /** Whether to disable template matching for this clip */
  disableTemplate?: boolean;
};

export async function performClip(options: ClipOptions): Promise<ClipResult> {
  const { tab, pageType, settings, selectionOnly, disableTemplate } = options;

  if (!tab.id) {
    throw new TabError("Active tab has no id (cannot clip)", "TAB_NO_ID");
  }
  if (!tab.url || !/^https?:\/\//.test(tab.url)) {
    throw new TabError("This page cannot be clipped (unsupported URL)", "URL_UNSUPPORTED");
  }

  await ensureContentScriptLoaded(tab.id);
  await waitForDynamicContent(tab);

  const request: TabRequest = {
    action: "clip",
    pageType,
    isSPA: isLikelySPA(tab.url),
    selectionOnly,
    includeTimestamps: settings.includeTimestamps,
    disableTemplate,
    settings
  };

  console.log("[Popup] Sending clip request:", request);
  console.log("[Popup] Tab URL:", tab.url);

  const rawResponse = await tabsSendMessage<TabRequest, unknown>(tab.id, request);
  console.log("[Popup] Got response:", rawResponse);
  const response = normalizeTabResponse(rawResponse);

  if (!response.ok) {
    throw new ExtractionError(response.error || "Failed to extract content", "EXTRACTION_FAILED");
  }

  return response.result;
}
