import { handleRuntimeMessage } from "./router";
import { ensureDefaultsOnInstall } from "./install";
import { createContextMenu, handleContextMenuClick } from "./contextMenus";
import { handleClipSelection } from "./handlers/clipSelection";

// Keyboard shortcut handler
chrome.commands.onCommand.addListener((command: string) => {
  if (command === "clip-page") {
    try {
      const maybePromise = chrome.action.openPopup();
      void Promise.resolve(maybePromise);
    } catch (err) {
      console.error("Failed to open popup:", err);
    }
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