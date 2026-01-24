import type { PageType } from "../shared/types";
import type { Settings } from "../shared/settings";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { getFolderCandidates } from "../shared/folders";

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

export function setPageTypeDisplay(type: PageType): void {
  const config = getPageTypeConfig(type);
  const iconEl = getEl<HTMLSpanElement>("pageIcon");
  const labelEl = getEl<HTMLSpanElement>("pageLabel");

  if (iconEl) iconEl.textContent = config.icon;
  if (labelEl) labelEl.textContent = config.label;
}

export function populateFolderSelect(select: HTMLSelectElement, settings: Settings): void {
  const folders = getFolderCandidates(settings);

  select.innerHTML = "";
  for (const folder of folders) {
    const opt = document.createElement("option");
    opt.value = folder;
    opt.textContent = folder;
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
    opt.textContent = fallback;
    select.appendChild(opt);
    select.value = fallback;
  }
}

export function updateUI(tab: chrome.tabs.Tab | null, pageType: PageType): void {
  if (!tab) return;

  setPageTypeDisplay(pageType);

  const titleInput = getEl<HTMLInputElement>("titleInput");
  if (titleInput) {
    titleInput.value = tab.title || "Untitled";
  }
}
