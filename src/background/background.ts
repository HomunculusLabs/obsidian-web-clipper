import { handleRuntimeMessage } from "./router";
import { ensureDefaultsOnInstall } from "./install";
import { createContextMenu, handleContextMenuClick } from "./contextMenus";

// Keyboard shortcut handler
chrome.commands.onCommand.addListener((command: string) => {
  if (command !== "clip-page") return;

  try {
    const maybePromise = chrome.action.openPopup();
    void Promise.resolve(maybePromise);
  } catch (err) {
    console.error("Failed to open popup:", err);
  }
});

// Extension install handler
chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
  void (async () => {
    await ensureDefaultsOnInstall(details);
    await createContextMenu();
  })().catch((err: unknown) => {
    console.error("onInstalled handler failed:", err);
  });
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener(handleContextMenuClick);

// Message router for popup/content script requests
chrome.runtime.onMessage.addListener(handleRuntimeMessage);