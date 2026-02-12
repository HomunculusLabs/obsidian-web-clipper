import type { ClipResult, PageType } from "../shared/types";
import type { PageInfo, SelectionInfo, TabRequest } from "../shared/messages";
import { DEFAULT_SETTINGS, type Settings } from "../shared/settings";
import { loadSettings as loadSettingsFromStorage } from "../shared/settingsService";
import { tabsQuery, tabsSendMessage } from "../shared/chromeAsync";
import { detectPageType } from "../shared/pageType";
import { toErrorMessage } from "../shared/errors";
import { getEl, showStatus, populateFolderSelect, updateUI, setPageTypeDisplay } from "./ui";
import { ensureContentScriptLoaded, performClip } from "./clipFlow";
import { saveToObsidian } from "./save";

let currentTab: chrome.tabs.Tab | null = null;
let pageType: PageType = "web";
let clipperContent: ClipResult | null = null;
let settings: Settings = { ...DEFAULT_SETTINGS };
let hasSelection = false;
let clipSelectionMode = true; // Default to selection mode when selection exists

async function loadSettings(): Promise<void> {
  settings = await loadSettingsFromStorage();

  const folderInput = getEl<HTMLSelectElement>("folderInput");
  if (folderInput) {
    populateFolderSelect(folderInput, settings);
  }

  const tagsInput = getEl<HTMLInputElement>("tagsInput");
  if (tagsInput) {
    tagsInput.value = (settings.defaultTags || DEFAULT_SETTINGS.defaultTags || "").trim();
  }
}

async function getCurrentTab(): Promise<chrome.tabs.Tab> {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) {
    throw new Error("No active tab found");
  }
  if (!tab.id) {
    throw new Error("Active tab has no id (cannot message/inject)");
  }
  return tab;
}

function setupEventListeners(): void {
  const clipBtn = getEl<HTMLButtonElement>("clipBtn");
  if (clipBtn) {
    clipBtn.addEventListener("click", () => {
      void handleClip();
    });
  }

  const settingsBtn = getEl<HTMLButtonElement>("settingsBtn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
  }

  const titleInput = getEl<HTMLInputElement>("titleInput");
  if (titleInput) {
    titleInput.addEventListener("input", () => {
      if (!clipperContent) return;
      clipperContent = { ...clipperContent, title: titleInput.value };
    });
  }

  const selectionToggle = getEl<HTMLInputElement>("selectionToggle");
  if (selectionToggle) {
    selectionToggle.addEventListener("change", () => {
      clipSelectionMode = selectionToggle.checked;
      updateClipButtonText();
    });
  }
}

/** Update the clip button text based on selection mode */
function updateClipButtonText(): void {
  const clipBtn = getEl<HTMLButtonElement>("clipBtn");
  const btnText = clipBtn?.querySelector(".btn-text");
  if (btnText) {
    if (hasSelection && clipSelectionMode) {
      btnText.textContent = "Clip Selection to Obsidian";
    } else {
      btnText.textContent = "Clip to Obsidian";
    }
  }
}

/** Show the selection indicator with preview */
function showSelectionIndicator(preview: string): void {
  const indicator = getEl<HTMLDivElement>("selectionIndicator");
  const previewEl = getEl<HTMLDivElement>("selectionPreview");

  if (indicator) {
    indicator.style.display = "block";
  }
  if (previewEl && preview) {
    previewEl.textContent = `"${preview}"`;
  }

  // Update clip button text
  updateClipButtonText();
}

/** Hide the selection indicator */
function hideSelectionIndicator(): void {
  const indicator = getEl<HTMLDivElement>("selectionIndicator");
  if (indicator) {
    indicator.style.display = "none";
  }
  hasSelection = false;
  updateClipButtonText();
}

async function handleClip(): Promise<void> {
  const clipBtn = getEl<HTMLButtonElement>("clipBtn");

  try {
    showStatus("loading", "Clipping page...");
    if (clipBtn) clipBtn.disabled = true;

    if (!currentTab) {
      currentTab = await getCurrentTab();
    }

    const result = await performClip({
      tab: currentTab,
      pageType,
      settings,
      selectionOnly: hasSelection && clipSelectionMode
    });

    clipperContent = result;

    const titleInput = getEl<HTMLInputElement>("titleInput");
    const folderInput = getEl<HTMLSelectElement>("folderInput");
    const tagsInput = getEl<HTMLInputElement>("tagsInput");

    const saveResult = await saveToObsidian({
      result,
      settings,
      pageType,
      currentTabUrl: currentTab.url || "",
      overrideTitle: titleInput?.value,
      overrideFolder: folderInput?.value,
      overrideTags: tagsInput?.value
    });

    if (!saveResult.usedClipboardFallback) {
      showStatus("success", "Sent to Obsidian");
    }
  } catch (err) {
    const message = toErrorMessage(err, "Failed to clip page");
    console.error("Clip error:", err);
    showStatus("error", message);
  } finally {
    if (clipBtn) clipBtn.disabled = false;
  }
}

async function init(): Promise<void> {
  await loadSettings();
  currentTab = await getCurrentTab();

  // Fallback for restricted pages where content scripts cannot be injected/messaged.
  pageType = currentTab.url ? detectPageType(currentTab.url) : "web";

  const tabId = currentTab.id;
  if (tabId) {
    try {
      await ensureContentScriptLoaded(tabId);
      const pageInfo = await tabsSendMessage<TabRequest, PageInfo>(tabId, { action: "getPageInfo" });
      pageType = pageInfo.type || pageType;

      // Query selection state
      const selectionInfo = await tabsSendMessage<TabRequest, SelectionInfo>(tabId, { action: "getSelectionInfo" });
      if (selectionInfo.hasSelection) {
        hasSelection = true;
        showSelectionIndicator(selectionInfo.preview);
      } else {
        hideSelectionIndicator();
      }
    } catch {
      // Keep URL-based fallback.
      hideSelectionIndicator();
    }
  }

  setPageTypeDisplay(pageType);
  updateUI(currentTab, pageType);
  setupEventListeners();
}

document.addEventListener("DOMContentLoaded", () => {
  void init().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Popup init error:", err);
    showStatus("error", message || "Failed to initialize popup");
  });
});