import { loadSettings } from "../shared/settingsService";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { ensureContentScriptLoaded, isLikelySPA } from "../popup/clipFlow";
import { sleep } from "../popup/ui";
import { tabsCreate, tabsSendMessage } from "../shared/chromeAsync";
import { detectPageType } from "../shared/pageType";
import { buildFrontmatterFromClip } from "../shared/buildFrontmatter";
import { buildClipMarkdown } from "../shared/markdown";
import { injectWikiLinks } from "../content/web/wikiLinks";
import { handleSaveContent } from "./handlers/saveContent";
import type { TabRequest, TabResponse } from "../shared/messages";

const CLIP_PAGE_MENU_ID = "clipToObsidian";
const CLIP_LINK_MENU_ID = "clipLinkToObsidian";

function isClipMenuItem(id: unknown): id is string {
  return id === CLIP_PAGE_MENU_ID || id === CLIP_LINK_MENU_ID;
}

function isHttpUrl(url: string | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//.test(url);
}

async function waitForTabComplete(tabId: number, timeoutMs: number = 20000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for linked page to load"));
    }, timeoutMs);

    const onUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab
    ) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status !== "complete") return;
      if (!isHttpUrl(tab.url)) return;
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };

    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs.get(tabId, (tab) => {
      const lastError = chrome.runtime?.lastError;
      if (lastError) {
        cleanup();
        reject(new Error(lastError.message || "Failed to inspect linked page tab"));
        return;
      }

      if (tab?.status === "complete" && isHttpUrl(tab.url)) {
        cleanup();
        resolve();
      }
    });
  });
}

async function closeTab(tabId: number | undefined): Promise<void> {
  if (!tabId) return;

  await new Promise<void>((resolve) => {
    chrome.tabs.remove(tabId, () => {
      // Ignore failures (tab may already be closed)
      resolve();
    });
  });
}

async function clipLinkedPage(linkUrl: string): Promise<void> {
  if (!isHttpUrl(linkUrl)) {
    console.error("Clip Link: unsupported URL", linkUrl);
    return;
  }

  let backgroundTabId: number | undefined;

  try {
    const tab = await tabsCreate({ url: linkUrl, active: false });
    backgroundTabId = tab.id;

    if (!backgroundTabId) {
      throw new Error("Background tab could not be created for linked page");
    }

    await waitForTabComplete(backgroundTabId);

    const settings = await loadSettings();
    const pageType = detectPageType(linkUrl);

    await ensureContentScriptLoaded(backgroundTabId);
    await sleep(isLikelySPA(linkUrl) ? 1000 : 300);

    const request: TabRequest = {
      action: "clip",
      pageType,
      isSPA: isLikelySPA(linkUrl),
      includeTimestamps: settings.includeTimestamps,
      settings
    };

    const response = await tabsSendMessage<TabRequest, TabResponse>(backgroundTabId, request);

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to extract linked page content");
    }

    const { frontmatter, filePath } = buildFrontmatterFromClip({
      result: response.result,
      settings,
      pageType,
      currentTabUrl: linkUrl
    });

    const rawMarkdown = buildClipMarkdown(frontmatter, response.result.markdown || "");
    const markdown = injectWikiLinks(rawMarkdown, settings);
    const vault = (settings.vaultName || DEFAULT_SETTINGS.vaultName || "Main Vault").trim();

    const saveResult = await handleSaveContent({
      action: "saveContent",
      markdown,
      filePath,
      vault,
      fallbackToClipboard: true
    });

    if (!saveResult.success) {
      throw new Error(saveResult.error || "Failed to save linked page content");
    }
  } catch (err) {
    console.error("Failed to clip linked page:", err);
  } finally {
    await closeTab(backgroundTabId);
  }
}

export async function createContextMenu(): Promise<void> {
  if (!chrome.contextMenus) return;

  await new Promise<void>((resolve) => {
    try {
      chrome.contextMenus.removeAll(() => resolve());
    } catch {
      resolve();
    }
  });

  try {
    chrome.contextMenus.create({
      id: CLIP_PAGE_MENU_ID,
      title: "Clip to Obsidian",
      contexts: ["page", "selection"]
    });

    chrome.contextMenus.create({
      id: CLIP_LINK_MENU_ID,
      title: "Clip Link to Obsidian",
      contexts: ["link"]
    });
  } catch (err) {
    console.error("Failed to create context menu:", err);
  }
}

export function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined
): void {
  if (!isClipMenuItem(info.menuItemId)) return;

  if (info.menuItemId === CLIP_LINK_MENU_ID) {
    if (!isHttpUrl(info.linkUrl)) {
      console.error("Clip Link: missing or invalid link URL");
      return;
    }

    void clipLinkedPage(info.linkUrl);
    return;
  }

  if (!tab?.id) return;

  const selectionOnly = typeof info.selectionText === "string" && info.selectionText.length > 0;

  // Fire and forget - handle the async work internally
  void (async () => {
    try {
      // Load settings from storage
      const settings = await loadSettings();

      // Ensure content script is loaded (same as popup does)
      await ensureContentScriptLoaded(tab.id!);
      await sleep(isLikelySPA(tab?.url) ? 1000 : 300);

      // Send clip request with settings
      const request: TabRequest = {
        action: "clip",
        selectionOnly,
        settings
      };

      await tabsSendMessage(tab.id!, request);
    } catch (err) {
      console.error("Failed to send clip message to tab:", err);
    }
  })();
}
