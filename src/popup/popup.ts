import type { ClipResult, PageType } from "../shared/types";
import type { PageInfo, RuntimeRequest, TabRequest, TabResponse } from "../shared/messages";
import { DEFAULT_SETTINGS, SETTINGS_KEYS, type Settings } from "../shared/settings";
import {
  runtimeSendMessage,
  scriptingExecuteScript,
  storageGet,
  tabsQuery,
  tabsSendMessage
} from "../shared/chromeAsync";
import { buildClipMarkdown, type FrontmatterInput } from "../shared/markdown";
import { sanitizeFilename } from "../shared/sanitize";

type StatusType = "success" | "error" | "loading";

let currentTab: chrome.tabs.Tab | null = null;
let pageType: PageType = "web";
let clipperContent: ClipResult | null = null;
let settings: Settings = { ...DEFAULT_SETTINGS };

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

type PageTypeConfig = {
  type: PageType;
  pattern: RegExp;
  icon: string;
  label: string;
};

const PAGE_TYPES: readonly PageTypeConfig[] = [
  {
    type: "youtube",
    pattern:
      /^https?:\/\/(www\.)?youtube\.com\/(watch|shorts)(\b|\/|\?|#)/,
    icon: "▶️",
    label: "YouTube Video"
  },
  {
    type: "pdf",
    pattern: /^https?:\/\/.*\.pdf(\?|$)/i,
    icon: "📄",
    label: "PDF Document"
  },
  {
    type: "web",
    pattern: /^https?:\/\//,
    icon: "🌐",
    label: "Web Page"
  }
];

function getEl<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTags(raw: string): string[] {
  const cleaned = (raw || "")
    .split(/\s*,\s*/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of cleaned) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function showStatus(type: StatusType, message: string): void {
  const status = getEl<HTMLDivElement>("status");
  if (!status) return;
  status.className = `status ${type}`;
  status.textContent = message;
}

function detectPageType(url: string | undefined): PageType {
  if (!url) return "web";
  for (const config of PAGE_TYPES) {
    if (config.pattern.test(url)) return config.type;
  }
  return "web";
}

function getPageTypeConfig(type: PageType): PageTypeConfig {
  return PAGE_TYPES.find((c) => c.type === type) || PAGE_TYPES[PAGE_TYPES.length - 1];
}

function setPageType(type: PageType): void {
  pageType = type;

  const config = getPageTypeConfig(type);
  const iconEl = getEl<HTMLSpanElement>("pageIcon");
  const labelEl = getEl<HTMLSpanElement>("pageLabel");

  if (iconEl) iconEl.textContent = config.icon;
  if (labelEl) labelEl.textContent = config.label;
}

function isLikelySPA(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    return SPA_DOMAINS.some(
      (domain) =>
        urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

async function waitForDynamicContent(): Promise<void> {
  const waitTime = isLikelySPA(currentTab?.url) ? 1000 : 300;
  await sleep(waitTime);
}

function populateFolderSelect(select: HTMLSelectElement, nextSettings: Settings): void {
  const candidates = [
    ...(Array.isArray(nextSettings.savedFolders) ? nextSettings.savedFolders : []),
    nextSettings.defaultFolder
  ]
    .map((s) => (s || "").trim())
    .filter((s) => s.length > 0);

  const seen = new Set<string>();
  const folders = candidates.filter((folder) => {
    const key = folder.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  select.innerHTML = "";
  for (const folder of folders) {
    const opt = document.createElement("option");
    opt.value = folder;
    opt.textContent = folder;
    select.appendChild(opt);
  }

  const desired = (nextSettings.defaultFolder || "").trim();
  if (desired && folders.some((f) => f === desired)) {
    select.value = desired;
  } else if (folders.length > 0) {
    select.value = folders[0];
  } else {
    const fallback = DEFAULT_SETTINGS.defaultFolder;
    const opt = document.createElement("option");
    opt.value = fallback;
    opt.textContent = fallback;
    select.appendChild(opt);
    select.value = fallback;
  }
}

async function loadSettings(): Promise<void> {
  const stored = await storageGet<Settings>(SETTINGS_KEYS);
  settings = { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };

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

function updateUI(): void {
  if (!currentTab) return;

  setPageType(detectPageType(currentTab.url));

  const titleInput = getEl<HTMLInputElement>("titleInput");
  if (titleInput) {
    titleInput.value = currentTab.title || "Untitled";
  }
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
    settingsBtn.addEventListener("click", openSettings);
  }

  const titleInput = getEl<HTMLInputElement>("titleInput");
  if (titleInput) {
    titleInput.addEventListener("input", () => {
      if (!clipperContent) return;
      clipperContent = { ...clipperContent, title: titleInput.value };
    });
  }
}

function openSettings(): void {
  chrome.runtime.openOptionsPage();
}

function isTabResponse(value: unknown): value is TabResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as { ok?: unknown };
  return typeof v.ok === "boolean";
}

function isClipResult(value: unknown): value is ClipResult {
  if (!value || typeof value !== "object") return false;
  const v = value as any;
  return (
    typeof v.markdown === "string" &&
    typeof v.title === "string" &&
    typeof v.metadata === "object" &&
    v.metadata !== null
  );
}

function normalizeTabResponse(raw: unknown): TabResponse {
  if (isTabResponse(raw)) return raw;

  if (isClipResult(raw)) {
    return { ok: true, result: raw };
  }

  return { ok: false, error: "Unexpected response from content script" };
}

async function ensureContentScriptLoaded(tabId: number): Promise<void> {
  try {
    await tabsSendMessage<TabRequest, PageInfo>(tabId, { action: "getPageInfo" });
    return;
  } catch {
    // Not injected yet; inject only the bundled content script.
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

async function saveToObsidian(result: ClipResult): Promise<void> {
  const titleInput = getEl<HTMLInputElement>("titleInput");
  const folderInput = getEl<HTMLSelectElement>("folderInput");
  const tagsInput = getEl<HTMLInputElement>("tagsInput");

  const overrideTitle = (titleInput?.value || "").trim();
  const finalTitle = sanitizeFilename(overrideTitle || result.title || "Untitled");

  const folder = (folderInput?.value || settings.defaultFolder || DEFAULT_SETTINGS.defaultFolder).trim();

  const rawTags =
    (tagsInput?.value || "").trim() ||
    (settings.defaultTags || DEFAULT_SETTINGS.defaultTags || "").trim();

  const tags = parseTags(rawTags);

  // Auto-add tags based on detected page type
  if (pageType === "youtube" && !tags.some((t) => t.toLowerCase() === "youtube")) {
    tags.push("youtube");
  }
  if (pageType === "pdf" && !tags.some((t) => t.toLowerCase() === "pdf")) {
    tags.push("pdf");
  }
  if (!tags.length) {
    tags.push("web-clip");
  }

  const filePath = folder ? `${folder}/${finalTitle}` : finalTitle;

  const frontmatter: FrontmatterInput = {
    source: result.metadata?.url || result.url || (currentTab?.url || ""),
    title: finalTitle,
    type: result.metadata?.type || "article",
    dateClippedISO: new Date().toISOString(),
    tags,
    author: result.metadata?.author,
    channel: result.metadata?.channel,
    duration: result.metadata?.duration,
    videoType: result.metadata?.videoType,
    extra: {
      published_date: result.metadata?.publishedDate || undefined,
      description: result.metadata?.description || undefined,
      paywalled: result.metadata?.paywalled,
      password_protected: result.metadata?.passwordProtected,
      scanned_pdf: result.metadata?.scannedPDF,
      truncated: result.metadata?.truncated,
      page_type: pageType
    }
  };

  const markdown = buildClipMarkdown(frontmatter, result.markdown || "");
  const encodedContent = encodeURIComponent(markdown);

  const vault = (settings.vaultName || DEFAULT_SETTINGS.vaultName).trim() || "Main Vault";
  const obsidianUri = `obsidian://new?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(
    filePath
  )}&content=${encodedContent}`;

  type OpenUriResponse = { success: boolean; error?: string };

  const response = await runtimeSendMessage<RuntimeRequest, OpenUriResponse>({
    action: "openObsidianUri",
    uri: obsidianUri
  });

  if (!response?.success) {
    throw new Error(response?.error || "Failed to open Obsidian URI");
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
    if (!currentTab.id) {
      throw new Error("Active tab has no id (cannot clip)");
    }
    if (!currentTab.url || !/^https?:\/\//.test(currentTab.url)) {
      throw new Error("This page cannot be clipped (unsupported URL)");
    }

    await ensureContentScriptLoaded(currentTab.id);
    await waitForDynamicContent();

    const request: TabRequest = {
      action: "clip",
      pageType,
      isSPA: isLikelySPA(currentTab.url),
      includeTimestamps: settings.includeTimestamps
    };

    const rawResponse = await tabsSendMessage<TabRequest, unknown>(currentTab.id, request);
    const response = normalizeTabResponse(rawResponse);

    // Discriminated union access pattern: check ok before result.
    if (!response.ok) {
      showStatus("error", response.error || "Failed to extract content");
      return;
    }

    clipperContent = response.result;

    await saveToObsidian(response.result);
    showStatus("success", "Sent to Obsidian");
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Failed to clip page";
    console.error("Clip error:", err);
    showStatus("error", message);
  } finally {
    if (clipBtn) clipBtn.disabled = false;
  }
}

async function init(): Promise<void> {
  await loadSettings();
  currentTab = await getCurrentTab();
  pageType = detectPageType(currentTab.url);
  updateUI();
  setupEventListeners();
}

document.addEventListener("DOMContentLoaded", () => {
  void init().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Popup init error:", err);
    showStatus("error", message || "Failed to initialize popup");
  });
});