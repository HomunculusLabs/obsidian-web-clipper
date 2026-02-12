import { loadSettings } from "../shared/settingsService";
import { ensureContentScriptLoaded } from "../popup/clipFlow";
import { tabsSendMessage } from "../shared/chromeAsync";
import { isLikelySPA } from "../popup/clipFlow";
import { sleep } from "../popup/ui";
import type { TabRequest } from "../shared/messages";

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
      id: "clipToObsidian",
      title: "Clip to Obsidian",
      contexts: ["page", "selection"]
    });
  } catch (err) {
    console.error("Failed to create context menu:", err);
  }
}

export function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined
): void {
  if (info.menuItemId !== "clipToObsidian") return;
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