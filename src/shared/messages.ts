import type { ClipResult, PageType } from "./types";
import type { Settings } from "./settings";

/**
 * Messages sent to the background service worker via chrome.runtime.sendMessage().
 */
export type RuntimeRequest =
  | { action: "getSettings" }
  | { action: "copyToClipboard"; data: string }
  | { action: "openObsidianUri"; uri: string }
  | { action: "extractPdf"; url: string; maxPages?: number; maxChars?: number }
  | { action: "testCliConnection"; cliPath: string; vault: string }
  | { action: "saveToCli"; filePath: string; content: string; vault: string; cliPath: string }
  | {
      action: "saveContent";
      /** Full markdown content with frontmatter */
      markdown: string;
      /** Target file path (without .md extension) */
      filePath: string;
      /** Vault name */
      vault: string;
      /** Whether to fall back to clipboard if URI fails (default: true) */
      fallbackToClipboard?: boolean;
    };

export type SaveContentResponse =
  | { success: true; usedMethod: "uri" | "clipboard" }
  | { success: false; error: string };

export type SaveToCliResponse =
  | { success: true }
  | { success: false; error: string; requiresBridge?: boolean };

export type TestCliConnectionResponse =
  | { success: true; version?: string }
  | { success: false; error: string };

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
      settings: Settings; // Pass settings to content script for extraction
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