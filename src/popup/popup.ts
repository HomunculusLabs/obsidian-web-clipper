import type { ClipResult, PageType } from "../shared/types";
import type { PageInfo, SelectionInfo, TabRequest, TemplateInfo } from "../shared/messages";
import { DEFAULT_SETTINGS, type Settings } from "../shared/settings";
import { loadSettings as loadSettingsFromStorage } from "../shared/settingsService";
import { tabsQuery, tabsSendMessage } from "../shared/chromeAsync";
import { detectPageType } from "../shared/pageType";
import { toErrorMessage } from "../shared/errors";
import { suggestTags, type TagSuggestion } from "../shared/tagSuggestion";
import { getEl, showStatus, populateFolderSelect, updateUI, setPageTypeDisplay } from "./ui";
import { ensureContentScriptLoaded, performClip } from "./clipFlow";
import { saveToObsidian } from "./save";

let currentTab: chrome.tabs.Tab | null = null;
let pageType: PageType = "web";
let clipperContent: ClipResult | null = null;
let settings: Settings = { ...DEFAULT_SETTINGS };
let hasSelection = false;
let clipSelectionMode = true; // Default to selection mode when selection exists
let hasTemplate = false;
let useTemplate = true; // Default to using template when available
let dismissedTagSuggestions: string[] = []; // Dismissed tag suggestions (lowercase)
let currentTagSuggestions: TagSuggestion[] = []; // Current tag suggestions with source info

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

  // Load dismissed tag suggestions
  await loadDismissedTagSuggestions();
}

/** Storage key for dismissed tag suggestions */
const DISMISSED_TAGS_KEY = "dismissedTagSuggestions";

/** Load dismissed tag suggestions from storage */
async function loadDismissedTagSuggestions(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(DISMISSED_TAGS_KEY);
    dismissedTagSuggestions = result[DISMISSED_TAGS_KEY] || [];
  } catch {
    dismissedTagSuggestions = [];
  }
}

/** Save dismissed tag suggestions to storage */
async function saveDismissedTagSuggestions(): Promise<void> {
  try {
    await chrome.storage.local.set({ [DISMISSED_TAGS_KEY]: dismissedTagSuggestions });
  } catch (err) {
    console.error("Failed to save dismissed tag suggestions:", err);
  }
}

/** Display tag suggestions as clickable chips */
function displayTagSuggestions(suggestions: TagSuggestion[]): void {
  const container = getEl<HTMLDivElement>("tagSuggestions");
  const chipsContainer = getEl<HTMLDivElement>("tagChips");
  
  if (!container || !chipsContainer) return;
  
  // Filter out dismissed suggestions and already-added tags
  const tagsInput = getEl<HTMLInputElement>("tagsInput");
  const currentTags = (tagsInput?.value || "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
  
  const filteredSuggestions = suggestions.filter(s => {
    const lower = s.tag.toLowerCase();
    return !dismissedTagSuggestions.includes(lower) && !currentTags.includes(lower);
  });
  
  if (filteredSuggestions.length === 0) {
    container.style.display = "none";
    return;
  }
  
  // Store for reference
  currentTagSuggestions = filteredSuggestions;
  
  // Clear existing chips
  chipsContainer.innerHTML = "";
  
  // Create chips
  for (const suggestion of filteredSuggestions.slice(0, 6)) { // Limit to 6 suggestions
    const chip = document.createElement("span");
    chip.className = `tag-chip source-${suggestion.source}`;
    chip.title = `Source: ${suggestion.source} (${Math.round(suggestion.confidence * 100)}% confidence)`;
    
    const textSpan = document.createElement("span");
    textSpan.className = "tag-chip-text";
    textSpan.textContent = suggestion.tag;
    
    const dismissBtn = document.createElement("span");
    dismissBtn.className = "tag-chip-dismiss";
    dismissBtn.textContent = "×";
    dismissBtn.title = "Dismiss suggestion";
    
    // Click to add tag
    chip.addEventListener("click", (e) => {
      // Only add if not clicking dismiss button
      if ((e.target as HTMLElement)?.classList.contains("tag-chip-dismiss")) return;
      addTagToInput(suggestion.tag);
      chip.remove();
      
      // Hide container if no more chips
      if (chipsContainer.children.length === 0) {
        container.style.display = "none";
      }
    });
    
    // Click dismiss button to dismiss
    dismissBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissTagSuggestion(suggestion.tag);
      chip.remove();
      
      // Hide container if no more chips
      if (chipsContainer.children.length === 0) {
        container.style.display = "none";
      }
    });
    
    chip.appendChild(textSpan);
    chip.appendChild(dismissBtn);
    chipsContainer.appendChild(chip);
  }
  
  container.style.display = "flex";
}

/** Add a tag to the tags input */
function addTagToInput(tag: string): void {
  const tagsInput = getEl<HTMLInputElement>("tagsInput");
  if (!tagsInput) return;
  
  const currentTags = tagsInput.value.split(",").map(t => t.trim()).filter(Boolean);
  
  // Don't add if already present
  if (currentTags.some(t => t.toLowerCase() === tag.toLowerCase())) return;
  
  currentTags.push(tag);
  tagsInput.value = currentTags.join(", ");
}

/** Dismiss a tag suggestion and remember it */
function dismissTagSuggestion(tag: string): void {
  const lower = tag.toLowerCase();
  if (!dismissedTagSuggestions.includes(lower)) {
    dismissedTagSuggestions.push(lower);
    // Save asynchronously
    void saveDismissedTagSuggestions();
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

  const templateToggle = getEl<HTMLInputElement>("templateToggle");
  if (templateToggle) {
    templateToggle.addEventListener("change", () => {
      useTemplate = templateToggle.checked;
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

/** Show the template indicator with template name */
function showTemplateIndicator(name: string, source: "built-in" | "custom"): void {
  const indicator = getEl<HTMLDivElement>("templateIndicator");
  const nameEl = getEl<HTMLSpanElement>("templateName");

  if (indicator) {
    indicator.style.display = "block";
  }
  if (nameEl) {
    const prefix = source === "built-in" ? "" : "✨ ";
    nameEl.textContent = prefix + name;
  }

  // Ensure toggle is checked by default
  const templateToggle = getEl<HTMLInputElement>("templateToggle");
  if (templateToggle) {
    templateToggle.checked = true;
    useTemplate = true;
  }

  hasTemplate = true;
}

/** Hide the template indicator */
function hideTemplateIndicator(): void {
  const indicator = getEl<HTMLDivElement>("templateIndicator");
  if (indicator) {
    indicator.style.display = "none";
  }
  hasTemplate = false;
  useTemplate = true;
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
      selectionOnly: hasSelection && clipSelectionMode,
      disableTemplate: hasTemplate && !useTemplate
    });

    clipperContent = result;

    // Generate and display tag suggestions based on clipped content
    const suggestions = suggestTags(
      result.metadata,
      result.markdown,
      {
        domainTagRules: settings.domainTagRules,
        useDefaultDomainTags: settings.useDefaultDomainTags
      }
    );
    
    // Convert to TagSuggestion format (we only get strings back, so we'll assign generic source)
    const tagSuggestions: TagSuggestion[] = suggestions.map(tag => ({
      tag,
      confidence: 0.5,
      source: "content" as const
    }));
    
    displayTagSuggestions(tagSuggestions);

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
  let twitterThreadLength: number | undefined;

  const tabId = currentTab.id;
  if (tabId) {
    try {
      await ensureContentScriptLoaded(tabId);
      const pageInfo = await tabsSendMessage<TabRequest, PageInfo>(tabId, { action: "getPageInfo" });
      pageType = pageInfo.type || pageType;
      twitterThreadLength = pageInfo.twitterThreadLength;

      // Query selection state
      const selectionInfo = await tabsSendMessage<TabRequest, SelectionInfo>(tabId, { action: "getSelectionInfo" });
      if (selectionInfo.hasSelection) {
        hasSelection = true;
        showSelectionIndicator(selectionInfo.preview);
      } else {
        hideSelectionIndicator();
      }

      // Query template info
      const templateInfo = await tabsSendMessage<TabRequest, TemplateInfo>(tabId, {
        action: "getTemplateInfo",
        settings
      });
      if (templateInfo.hasTemplate && templateInfo.templateName) {
        showTemplateIndicator(templateInfo.templateName, templateInfo.templateSource || "built-in");
      } else {
        hideTemplateIndicator();
      }
    } catch {
      // Keep URL-based fallback.
      hideSelectionIndicator();
      hideTemplateIndicator();
    }
  }

  setPageTypeDisplay(pageType, twitterThreadLength);
  updateUI(currentTab, pageType, settings);
  setupEventListeners();
}

document.addEventListener("DOMContentLoaded", () => {
  void init().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Popup init error:", err);
    showStatus("error", message || "Failed to initialize popup");
  });
});