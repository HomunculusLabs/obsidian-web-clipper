import type { PageType } from "../shared/types";
import type { Settings } from "../shared/settings";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { getFolderCandidates } from "../shared/folders";
import { cleanTitle } from "../shared/titleSuggestion";

export type StatusType = "success" | "error" | "loading";

type PageTypeConfig = {
  type: PageType;
  pattern: RegExp;
  icon: string;
  label: string;
};

const PAGE_TYPES: readonly PageTypeConfig[] = [
  {
    type: "youtube",
    pattern: /^https?:\/\/(www\.)?youtube\.com\/(watch|shorts)(\b|\/|\?|#)/,
    icon: "▶️",
    label: "YouTube Video"
  },
  {
    type: "twitter",
    pattern: /^https?:\/\/(www\.|mobile\.)?(twitter|x)\.com\//,
    icon: "🐦",
    label: "Tweet"
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

export function getEl<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function showStatus(type: StatusType, message: string): void {
  const status = getEl<HTMLDivElement>("status");
  if (!status) return;
  status.className = `status ${type}`;
  status.textContent = message;
}

function getPageTypeConfig(type: PageType): PageTypeConfig {
  return PAGE_TYPES.find((c) => c.type === type) || PAGE_TYPES[PAGE_TYPES.length - 1];
}

export function setPageTypeDisplay(type: PageType, threadLength?: number): void {
  const config = getPageTypeConfig(type);
  const iconEl = getEl<HTMLSpanElement>("pageIcon");
  const labelEl = getEl<HTMLSpanElement>("pageLabel");

  if (iconEl) iconEl.textContent = config.icon;
  
  // For Twitter, show "Thread" label if thread is detected
  if (labelEl) {
    if (type === "twitter" && threadLength && threadLength > 1) {
      labelEl.textContent = `Thread (${threadLength} tweets)`;
    } else {
      labelEl.textContent = config.label;
    }
  }
}

function toFolderTreeLabel(folder: string): string {
  const segments = folder.split("/").filter(Boolean);
  const depth = Math.max(0, segments.length - 1);
  const leaf = segments[segments.length - 1] || folder;
  const indent = depth > 0 ? `${"\u00A0\u00A0".repeat(depth)}↳ ` : "";
  return `${indent}${leaf}`;
}

export function populateFolderSelect(
  select: HTMLSelectElement,
  settings: Settings,
  foldersOverride?: string[]
): void {
  const folders = (foldersOverride && foldersOverride.length > 0 ? foldersOverride : getFolderCandidates(settings))
    .slice()
    .sort((a, b) => a.localeCompare(b));

  select.innerHTML = "";
  for (const folder of folders) {
    const opt = document.createElement("option");
    opt.value = folder;
    opt.textContent = toFolderTreeLabel(folder);
    opt.title = folder;
    select.appendChild(opt);
  }

  const desired = (settings.defaultFolder || "").trim();
  if (desired && folders.some((f) => f === desired)) {
    select.value = desired;
  } else if (folders.length > 0) {
    select.value = folders[0];
  } else {
    const fallback = DEFAULT_SETTINGS.defaultFolder;
    const opt = document.createElement("option");
    opt.value = fallback;
    opt.textContent = toFolderTreeLabel(fallback);
    opt.title = fallback;
    select.appendChild(opt);
    select.value = fallback;
  }
}

export function updateUI(tab: chrome.tabs.Tab | null, pageType: PageType, settings?: Settings): void {
  if (!tab) return;

  setPageTypeDisplay(pageType);

  const titleInput = getEl<HTMLInputElement>("titleInput");
  if (titleInput) {
    let title = tab.title || "Untitled";
    
    // Apply title cleanup if enabled
    if (settings?.cleanTitles) {
      title = cleanTitle(title, { preferTitleCase: settings.preferTitleCase });
    }
    
    titleInput.value = title;
  }
}
