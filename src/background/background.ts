import { handleRuntimeMessage } from "./router";
import { ensureDefaultsOnInstall } from "./install";
import { createContextMenu, handleContextMenuClick } from "./contextMenus";
import { handleClipSelection } from "./handlers/clipSelection";
import { loadSettings } from "../shared/settingsService";
import { refreshBadgeCounter } from "../shared/badgeCounter";

const SIDE_PANEL_PATH = "popup/popup.html?view=sidepanel";

async function openClipperInSidePanel(): Promise<boolean> {
  if (!chrome.sidePanel?.open) {
    return false;
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    if (!activeTab?.windowId) {
      return false;
    }

    if (activeTab.id !== undefined) {
      await chrome.sidePanel.setOptions({
        tabId: activeTab.id,
        path: SIDE_PANEL_PATH,
        enabled: true
      });
    }

    await chrome.sidePanel.open({ windowId: activeTab.windowId });
    return true;
  } catch (err) {
    console.warn("Unable to open side panel:", err);
    return false;
  }
}

async function openClipperSurface(): Promise<void> {
  const openedInSidePanel = await openClipperInSidePanel();
  if (openedInSidePanel) return;

  try {
    const maybePromise = chrome.action.openPopup();
    await Promise.resolve(maybePromise);
  } catch (err) {
    console.error("Failed to open clipper surface:", err);
  }
}

async function configureSidePanelBehavior(): Promise<void> {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    console.warn("Failed to enable side panel action behavior:", err);
  }
}

async function syncBadgeCounter(): Promise<void> {
  try {
    const settings = await loadSettings();
    await refreshBadgeCounter(settings);
  } catch (err) {
    console.error("Failed to sync badge counter:", err);
  }
}

void syncBadgeCounter();
void configureSidePanelBehavior();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (
    "badgeCounterEnabled" in changes ||
    "badgeCounterResetInterval" in changes
  ) {
    void syncBadgeCounter();
  }
});

// Keyboard shortcut handler
chrome.commands.onCommand.addListener((command: string) => {
  if (command === "clip-page") {
    void openClipperSurface();
  } else if (command === "clip-selection") {
    void (async () => {
      try {
        const result = await handleClipSelection();
        if (!result.success) {
          console.error("Failed to clip selection:", result.error);
        }
      } catch (err) {
        console.error("Failed to clip selection:", err);
      }
    })();
  }
});

chrome.action.onClicked.addListener(() => {
  void openClipperSurface();
});

// Extension install handler
chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
  void (async () => {
    await ensureDefaultsOnInstall(details);
    await configureSidePanelBehavior();
    await createContextMenu();
    await syncBadgeCounter();
  })().catch((err: unknown) => {
    console.error("onInstalled handler failed:", err);
  });
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener(handleContextMenuClick);

// Message router for popup/content script requests
chrome.runtime.onMessage.addListener(handleRuntimeMessage);