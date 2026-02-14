import type { ClipResult, PageType } from "../shared/types";
import type { PageInfo, SelectionInfo, TabRequest, TemplateInfo } from "../shared/messages";
import { DEFAULT_SETTINGS, type Settings } from "../shared/settings";
import { loadSettings as loadSettingsFromStorage } from "../shared/settingsService";
import { tabsCreate, tabsQuery, tabsSendMessage } from "../shared/chromeAsync";
import { detectPageType } from "../shared/pageType";
import { toErrorMessage, TabError } from "../shared/errors";
import { suggestTagsWithHistory, type TagSuggestion } from "../shared/tagSuggestion";
import { suggestTitles } from "../shared/titleSuggestion";
import { markdownToHtml } from "../shared/markdownToHtml";
import {
  addClipHistoryEntry,
  filterClipHistory,
  getClipHistory,
  type ClipHistoryEntry,
  type ClipHistoryFilters
} from "../shared/clipHistory";
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
let currentTitleSuggestions: string[] = []; // Current title suggestions
let clipHistoryEntries: ClipHistoryEntry[] = [];
let historyFilters: ClipHistoryFilters = {};
let batchClipInProgress = false;

const PREVIEW_IDLE_TEXT = "Open Preview to generate a cleaned markdown preview";
const PREVIEW_IDLE_HINT = "Content is extracted without saving to Obsidian.";
const PREVIEW_LOADING_TEXT = "Generating preview...";
const PREVIEW_LOADING_HINT = "Extracting cleaned markdown from the current page.";

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

/** Display title suggestions as radio options */
function displayTitleSuggestions(suggestions: string[], currentTitle: string): void {
  const container = getEl<HTMLDivElement>("titleSuggestions");
  const optionsContainer = getEl<HTMLDivElement>("titleOptions");
  
  if (!container || !optionsContainer) return;
  
  // Filter to unique suggestions (excluding the current title)
  const uniqueSuggestions = suggestions.filter(s => 
    s.toLowerCase() !== currentTitle.toLowerCase()
  );
  
  if (uniqueSuggestions.length === 0) {
    container.style.display = "none";
    return;
  }
  
  // Store suggestions for reference
  currentTitleSuggestions = uniqueSuggestions;
  
  // Clear existing options
  optionsContainer.innerHTML = "";
  
  // Create radio options
  uniqueSuggestions.slice(0, 3).forEach((suggestion, index) => {
    const option = document.createElement("label");
    option.className = "title-option";
    
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "titleSuggestion";
    radio.value = suggestion;
    
    const textSpan = document.createElement("span");
    textSpan.className = "title-option-text";
    textSpan.textContent = suggestion;
    
    // Selecting a suggestion updates the title input
    radio.addEventListener("change", () => {
      const titleInput = getEl<HTMLInputElement>("titleInput");
      if (titleInput) {
        titleInput.value = suggestion;
        if (clipperContent) {
          clipperContent = { ...clipperContent, title: suggestion };
        }
      }
      
      // Update selected state visually
      optionsContainer.querySelectorAll(".title-option").forEach(opt => {
        opt.classList.remove("selected");
      });
      option.classList.add("selected");
    });
    
    option.appendChild(radio);
    option.appendChild(textSpan);
    optionsContainer.appendChild(option);
  });
  
  container.style.display = "flex";
}

/** Hide title suggestions */
function hideTitleSuggestions(): void {
  const container = getEl<HTMLDivElement>("titleSuggestions");
  if (container) {
    container.style.display = "none";
  }
  currentTitleSuggestions = [];
}

function formatHistoryDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function readHistoryFiltersFromInputs(): ClipHistoryFilters {
  const searchInput = getEl<HTMLInputElement>("historySearch");
  const fromInput = getEl<HTMLInputElement>("historyDateFrom");
  const toInput = getEl<HTMLInputElement>("historyDateTo");

  return {
    query: (searchInput?.value || "").trim(),
    startDate: (fromInput?.value || "").trim(),
    endDate: (toInput?.value || "").trim()
  };
}

function applyHistoryFilters(): void {
  historyFilters = readHistoryFiltersFromInputs();
  renderHistoryView();
}

function clearHistoryFilters(): void {
  const searchInput = getEl<HTMLInputElement>("historySearch");
  const fromInput = getEl<HTMLInputElement>("historyDateFrom");
  const toInput = getEl<HTMLInputElement>("historyDateTo");

  if (searchInput) searchInput.value = "";
  if (fromInput) fromInput.value = "";
  if (toInput) toInput.value = "";

  historyFilters = {};
  renderHistoryView();
}

async function waitForTabComplete(tabId: number, timeoutMs = 30000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };

    const onUpdated = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo): void => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        cleanup();
        resolve();
      }
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for re-clip tab to load"));
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs.get(tabId, (tab) => {
      const lastError = chrome.runtime?.lastError;
      if (lastError) {
        cleanup();
        reject(new Error(lastError.message || "Failed to inspect re-clip tab"));
        return;
      }

      if (tab?.status === "complete") {
        cleanup();
        resolve();
      }
    });
  });
}

async function closeTabQuietly(tabId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.tabs.remove(tabId, () => {
      resolve();
    });
  });
}

function renderHistoryView(): void {
  const list = getEl<HTMLDivElement>("historyList");
  const empty = getEl<HTMLDivElement>("historyEmpty");
  const noResults = getEl<HTMLDivElement>("historyNoResults");
  if (!list || !empty || !noResults) return;

  list.innerHTML = "";

  if (clipHistoryEntries.length === 0) {
    empty.style.display = "block";
    noResults.style.display = "none";
    list.style.display = "none";
    return;
  }

  const filteredEntries = filterClipHistory(clipHistoryEntries, historyFilters);
  if (filteredEntries.length === 0) {
    empty.style.display = "none";
    noResults.style.display = "block";
    list.style.display = "none";
    return;
  }

  empty.style.display = "none";
  noResults.style.display = "none";
  list.style.display = "flex";

  for (const entry of filteredEntries) {
    const item = document.createElement("div");
    item.className = `history-item ${entry.success ? "success" : "error"}`;

    const title = document.createElement("div");
    title.className = "history-item-title";
    title.textContent = entry.title || "Untitled";

    const url = document.createElement("a");
    url.className = "history-item-url";
    url.href = entry.url;
    url.textContent = entry.url;
    url.target = "_blank";
    url.rel = "noreferrer";

    const meta = document.createElement("div");
    meta.className = "history-item-meta";
    meta.textContent = `${formatHistoryDate(entry.date)} • ${entry.folder || "(no folder)"}`;

    const status = document.createElement("span");
    status.className = `history-item-status ${entry.success ? "success" : "error"}`;
    status.textContent = entry.success ? "Saved" : "Failed";
    meta.appendChild(status);

    const actions = document.createElement("div");
    actions.className = "history-item-actions";

    const reclipButton = document.createElement("button");
    reclipButton.type = "button";
    reclipButton.className = "history-reclip-btn";
    reclipButton.textContent = "Re-clip";
    reclipButton.addEventListener("click", () => {
      void handleReclip(entry, reclipButton);
    });

    actions.appendChild(reclipButton);

    item.appendChild(title);
    item.appendChild(url);
    item.appendChild(meta);
    item.appendChild(actions);

    if (entry.tags.length > 0) {
      const tags = document.createElement("div");
      tags.className = "history-item-tags";
      for (const tag of entry.tags) {
        const chip = document.createElement("span");
        chip.className = "history-tag";
        chip.textContent = `#${tag}`;
        tags.appendChild(chip);
      }
      item.appendChild(tags);
    }

    list.appendChild(item);
  }
}

async function refreshHistoryView(): Promise<void> {
  clipHistoryEntries = await getClipHistory();
  renderHistoryView();
}

async function recordHistoryEntry(entry: ClipHistoryEntry): Promise<void> {
  await addClipHistoryEntry(entry);
  await refreshHistoryView();
}

function buildHistoryEntry(
  success: boolean,
  overrides?: Partial<Pick<ClipHistoryEntry, "title" | "url" | "tags" | "folder">>
): ClipHistoryEntry {
  const titleInput = getEl<HTMLInputElement>("titleInput");
  const folderInput = getEl<HTMLSelectElement>("folderInput");
  const tagsInput = getEl<HTMLInputElement>("tagsInput");

  const tags = (tagsInput?.value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  return {
    title:
      (overrides?.title || titleInput?.value || clipperContent?.title || currentTab?.title || "Untitled").trim() ||
      "Untitled",
    url: (overrides?.url || currentTab?.url || "").trim(),
    date: new Date().toISOString(),
    tags: overrides?.tags || tags,
    folder: (overrides?.folder || folderInput?.value || settings.defaultFolder || "").trim(),
    success
  };
}

function activateTab(targetTab: "clip" | "preview" | "history"): void {
  const tabBtns = document.querySelectorAll<HTMLButtonElement>(".tab-btn");
  const tabContents = document.querySelectorAll<HTMLElement>(".tab-content");

  tabBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === targetTab);
  });

  tabContents.forEach((content) => {
    const isActive = content.id === `tab${targetTab.charAt(0).toUpperCase() + targetTab.slice(1)}`;
    content.classList.toggle("active", isActive);
  });

  if (targetTab === "preview") {
    void updatePreview();
  }

  if (targetTab === "history") {
    void refreshHistoryView();
  }
}

async function getCurrentTab(): Promise<chrome.tabs.Tab> {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) {
    throw new TabError("No active tab found", "TAB_NOT_FOUND");
  }
  if (!tab.id) {
    throw new TabError("Active tab has no id (cannot message/inject)", "TAB_NO_ID");
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

  const clipFromPreviewBtn = getEl<HTMLButtonElement>("clipFromPreviewBtn");
  if (clipFromPreviewBtn) {
    clipFromPreviewBtn.addEventListener("click", () => {
      void handleClipFromPreview();
    });
  }

  const clipAllTabsBtn = getEl<HTMLButtonElement>("clipAllTabsBtn");
  if (clipAllTabsBtn) {
    clipAllTabsBtn.addEventListener("click", () => {
      void handleClipAllTabs();
    });
  }

  const settingsBtn = getEl<HTMLButtonElement>("settingsBtn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
  }

  const historyBtn = getEl<HTMLButtonElement>("historyBtn");
  if (historyBtn) {
    historyBtn.addEventListener("click", () => {
      activateTab("history");
    });
  }

  const historySearch = getEl<HTMLInputElement>("historySearch");
  if (historySearch) {
    historySearch.addEventListener("input", applyHistoryFilters);
  }

  const historyDateFrom = getEl<HTMLInputElement>("historyDateFrom");
  if (historyDateFrom) {
    historyDateFrom.addEventListener("change", applyHistoryFilters);
  }

  const historyDateTo = getEl<HTMLInputElement>("historyDateTo");
  if (historyDateTo) {
    historyDateTo.addEventListener("change", applyHistoryFilters);
  }

  const historyClearFilters = getEl<HTMLButtonElement>("historyClearFilters");
  if (historyClearFilters) {
    historyClearFilters.addEventListener("click", clearHistoryFilters);
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
      invalidatePreviewContent();
    });
  }

  const templateToggle = getEl<HTMLInputElement>("templateToggle");
  if (templateToggle) {
    templateToggle.addEventListener("change", () => {
      useTemplate = templateToggle.checked;
      invalidatePreviewContent();
    });
  }

  // Tab switching
  setupTabSwitching();
}

/** Reset cached preview state so the next preview reflects current clip options. */
function invalidatePreviewContent(): void {
  clipperContent = null;

  const previewContent = getEl<HTMLDivElement>("previewContent");
  if (previewContent) {
    previewContent.innerHTML = "";
  }

  setPreviewLoadingState(PREVIEW_IDLE_TEXT, PREVIEW_IDLE_HINT, true);
}

function setPreviewLoadingState(text: string, hint: string, visible: boolean): void {
  const previewLoading = getEl<HTMLDivElement>("previewLoading");
  if (!previewLoading) return;

  previewLoading.style.display = visible ? "flex" : "none";

  const loadingText = previewLoading.querySelector(".preview-loading-text");
  if (loadingText) {
    loadingText.textContent = text;
  }

  const loadingHint = previewLoading.querySelector(".preview-loading-hint");
  if (loadingHint) {
    loadingHint.textContent = hint;
  }
}

function showPreviewNotice(message: string, type: "success" | "error"): HTMLDivElement | null {
  const previewContent = getEl<HTMLDivElement>("previewContent");
  if (!previewContent) return null;

  const notice = document.createElement("div");
  notice.className = `preview-notice preview-notice-${type}`;
  notice.textContent = message;
  previewContent.insertBefore(notice, previewContent.firstChild);

  return notice;
}

function renderPreviewContent(): void {
  const previewLoading = getEl<HTMLDivElement>("previewLoading");
  const previewContent = getEl<HTMLDivElement>("previewContent");

  if (!previewLoading || !previewContent || !clipperContent) return;

  previewContent.innerHTML = markdownToHtml(clipperContent.markdown);
  previewLoading.style.display = "none";
}

/** Setup tab switching functionality */
function setupTabSwitching(): void {
  const tabBtns = document.querySelectorAll<HTMLButtonElement>(".tab-btn");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      if (targetTab === "clip" || targetTab === "preview" || targetTab === "history") {
        activateTab(targetTab);
      }
    });
  });
}

/** Update preview content; extracts markdown first if needed (without saving). */
async function updatePreview(forceRefresh = false): Promise<void> {
  const previewLoading = getEl<HTMLDivElement>("previewLoading");
  const previewContent = getEl<HTMLDivElement>("previewContent");

  if (!previewLoading || !previewContent) return;

  if (clipperContent && !forceRefresh) {
    renderPreviewContent();
    return;
  }

  setPreviewLoadingState(PREVIEW_LOADING_TEXT, PREVIEW_LOADING_HINT, true);
  previewContent.innerHTML = "";

  try {
    if (!currentTab) {
      currentTab = await getCurrentTab();
    }

    clipperContent = await performClip({
      tab: currentTab,
      pageType,
      settings,
      selectionOnly: hasSelection && clipSelectionMode,
      disableTemplate: hasTemplate && !useTemplate
    });

    renderPreviewContent();
  } catch (err) {
    clipperContent = null;
    previewLoading.style.display = "none";
    previewContent.innerHTML = "";
    const message = toErrorMessage(err, "Failed to load preview");
    showPreviewNotice(message, "error");
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

function isClippableUrl(url: string | undefined): boolean {
  return Boolean(url && /^https?:\/\//i.test(url));
}

function setBatchClipUiState(isBusy: boolean): void {
  const clipBtn = getEl<HTMLButtonElement>("clipBtn");
  const clipFromPreviewBtn = getEl<HTMLButtonElement>("clipFromPreviewBtn");
  const clipAllTabsBtn = getEl<HTMLButtonElement>("clipAllTabsBtn");

  if (clipBtn) clipBtn.disabled = isBusy;
  if (clipFromPreviewBtn) clipFromPreviewBtn.disabled = isBusy;
  if (clipAllTabsBtn) {
    clipAllTabsBtn.disabled = isBusy;
    clipAllTabsBtn.textContent = isBusy ? "Clipping Tabs..." : "Clip All Tabs";
  }
}

async function handleClipAllTabs(): Promise<void> {
  if (batchClipInProgress) return;

  const clipAllTabsBtn = getEl<HTMLButtonElement>("clipAllTabsBtn");
  const folderInput = getEl<HTMLSelectElement>("folderInput");
  const tagsInput = getEl<HTMLInputElement>("tagsInput");

  try {
    batchClipInProgress = true;
    setBatchClipUiState(true);

    const allTabs = await tabsQuery({ currentWindow: true });
    const tabsToClip = allTabs.filter((tab) => tab.id && isClippableUrl(tab.url));

    if (tabsToClip.length === 0) {
      showStatus("error", "No clippable tabs in this window");
      return;
    }

    let successCount = 0;
    let failureCount = 0;

    for (let index = 0; index < tabsToClip.length; index += 1) {
      const tab = tabsToClip[index]!;
      const progress = `Clipping ${index + 1}/${tabsToClip.length}...`;
      showStatus("loading", progress);

      try {
        const tabPageType = detectPageType(tab.url || "");
        const result = await performClip({
          tab,
          pageType: tabPageType,
          settings,
          selectionOnly: false,
          disableTemplate: false
        });

        await saveToObsidian({
          result,
          settings,
          pageType: tabPageType,
          currentTabUrl: tab.url || "",
          overrideFolder: folderInput?.value,
          overrideTags: tagsInput?.value
        });

        await recordHistoryEntry(
          buildHistoryEntry(true, {
            title: result.title,
            url: tab.url || "",
            folder: folderInput?.value,
            tags: (tagsInput?.value || "")
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          })
        );

        successCount += 1;
      } catch {
        failureCount += 1;
        await recordHistoryEntry(
          buildHistoryEntry(false, {
            title: tab.title || "Untitled",
            url: tab.url || ""
          })
        );
      }
    }

    if (failureCount === 0) {
      showStatus("success", `Clipped ${successCount}/${tabsToClip.length} tabs`);
    } else {
      showStatus("error", `Clipped ${successCount}/${tabsToClip.length} tabs (${failureCount} failed)`);
    }
  } catch (err) {
    showStatus("error", toErrorMessage(err, "Batch tab clipping failed"));
  } finally {
    batchClipInProgress = false;
    setBatchClipUiState(false);
    if (clipAllTabsBtn) {
      clipAllTabsBtn.blur();
    }
  }
}

async function handleReclip(entry: ClipHistoryEntry, button: HTMLButtonElement): Promise<void> {
  const url = (entry.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    showStatus("error", "Cannot re-clip non-web URLs");
    return;
  }

  let tempTabId: number | null = null;

  try {
    button.disabled = true;
    button.textContent = "Re-clipping...";
    showStatus("loading", "Re-clipping saved URL...");

    const tempTab = await tabsCreate({ url, active: false });
    if (!tempTab.id) {
      throw new Error("Failed to create a tab for re-clipping");
    }

    tempTabId = tempTab.id;
    await waitForTabComplete(tempTabId);

    const reclipPageType = detectPageType(url);
    const result = await performClip({
      tab: { ...tempTab, url },
      pageType: reclipPageType,
      settings,
      selectionOnly: false,
      disableTemplate: false
    });

    await saveToObsidian({
      result,
      settings,
      pageType: reclipPageType,
      currentTabUrl: url
    });

    await recordHistoryEntry(
      buildHistoryEntry(true, {
        title: result.title,
        url
      })
    );

    showStatus("success", "Re-clipped and sent to Obsidian");
  } catch (err) {
    await recordHistoryEntry(
      buildHistoryEntry(false, {
        title: entry.title,
        url
      })
    );

    const message = toErrorMessage(err, "Failed to re-clip URL");
    showStatus("error", message);
  } finally {
    if (tempTabId !== null) {
      await closeTabQuietly(tempTabId);
    }

    button.disabled = false;
    button.textContent = "Re-clip";
  }
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
    void updatePreview();

    // Generate and display tag suggestions based on clipped content
    // Uses suggestTagsWithHistory to include frequently used tags from history (Task 65)
    const tagSuggestions = await suggestTagsWithHistory(
      result.metadata,
      result.markdown,
      {
        domainTagRules: settings.domainTagRules,
        useDefaultDomainTags: settings.useDefaultDomainTags,
        tagRules: settings.tagRules,
        useDefaultTagRules: settings.useDefaultTagRules
      }
    );
    
    displayTagSuggestions(tagSuggestions);

    // Generate and display title suggestions (Task 67)
    const titleSuggestions = suggestTitles(
      result.metadata,
      result.markdown,
      {
        preferTitleCase: settings.preferTitleCase,
        maxLength: 100
      }
    );
    
    const titleInput = getEl<HTMLInputElement>("titleInput");
    displayTitleSuggestions(titleSuggestions, titleInput?.value || result.title);

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

    await recordHistoryEntry(buildHistoryEntry(true));

    if (!saveResult.usedClipboardFallback) {
      showStatus("success", "Sent to Obsidian");
    }
  } catch (err) {
    const message = toErrorMessage(err, "Failed to clip page");
    console.error("Clip error:", err);
    await recordHistoryEntry(buildHistoryEntry(false));
    showStatus("error", message);
  } finally {
    if (clipBtn) clipBtn.disabled = false;
  }
}

/** Handle clip from preview tab - saves cached preview content (or loads preview first). */
async function handleClipFromPreview(): Promise<void> {
  const clipBtn = getEl<HTMLButtonElement>("clipFromPreviewBtn");

  try {
    if (clipBtn) clipBtn.disabled = true;

    if (!clipperContent) {
      await updatePreview();
    }
    if (!clipperContent) {
      throw new Error("Preview content is unavailable.");
    }

    if (!currentTab) {
      currentTab = await getCurrentTab();
    }

    const titleInput = getEl<HTMLInputElement>("titleInput");
    const folderInput = getEl<HTMLSelectElement>("folderInput");
    const tagsInput = getEl<HTMLInputElement>("tagsInput");

    const saveResult = await saveToObsidian({
      result: clipperContent,
      settings,
      pageType,
      currentTabUrl: currentTab.url || "",
      overrideTitle: titleInput?.value,
      overrideFolder: folderInput?.value,
      overrideTags: tagsInput?.value
    });

    await recordHistoryEntry(buildHistoryEntry(true));

    if (!saveResult.usedClipboardFallback) {
      const successNotice = showPreviewNotice("✓ Sent to Obsidian", "success");
      if (successNotice) {
        setTimeout(() => successNotice.remove(), 3000);
      }
    }
  } catch (err) {
    const message = toErrorMessage(err, "Failed to clip page");
    console.error("Clip from preview error:", err);
    await recordHistoryEntry(buildHistoryEntry(false));
    const errorNotice = showPreviewNotice(message, "error");
    if (errorNotice) {
      setTimeout(() => errorNotice.remove(), 5000);
    }
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
  await refreshHistoryView();
}

document.addEventListener("DOMContentLoaded", () => {
  void init().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Popup init error:", err);
    showStatus("error", message || "Failed to initialize popup");
  });
});