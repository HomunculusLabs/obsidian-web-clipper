import type { ClipResult, PageType } from "./types";

/**
 * Messages sent to the background service worker via chrome.runtime.sendMessage().
 */
export type RuntimeRequest =
  | { action: "getSettings" }
  | { action: "copyToClipboard"; data: string }
  | { action: "openObsidianUri"; uri: string }
  | { action: "extractPdf"; url: string; maxPages?: number; maxChars?: number };

export type ExtractPdfResponse =
  | { success: true; text: string; pageCount: number; truncated: boolean; hasTextLayer: boolean }
  | { success: false; error: string };

/**
 * Messages sent to a tab's content script via chrome.tabs.sendMessage().
 */
export type TabRequest =
  | {
      action: "clip";
      pageType?: PageType;
      isSPA?: boolean;
      selectionOnly?: boolean;
      includeTimestamps?: boolean;
    }
  | { action: "getPageInfo" };

export type TabResponse =
  | { ok: true; result: ClipResult }
  | { ok: false; error: string };

export type PageInfo = {
  url: string;
  title: string;
  type: PageType;
  contentType?: string;
};