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
  | { action: "detectCli" }
  | { action: "saveToCli"; filePath: string; content: string; vault: string; cliPath: string }
  | {
      action: "saveAttachmentToCli";
      filePath: string;
      base64Data: string;
      vault: string;
      cliPath: string;
      mimeType?: string;
    }
  | { action: "listVaultFolders"; vault: string; cliPath: string }
  | { action: "createVaultFolder"; vault: string; cliPath: string; folderPath: string }
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
    }
  | {
      action: "refreshOpenQuestionsInbox";
      /** Vault path on filesystem */
      vaultPath: string;
      /** CLI path for saving the inbox */
      cliPath: string;
      /** Vault name */
      vault: string;
      /** Folder to save the inbox (optional, defaults to vault root) */
      inboxFolder?: string;
      /** Maximum files to scan (optional) */
      maxFiles?: number;
    }
  | {
      action: "refreshKeyTakeawaysInbox";
      /** Vault path on filesystem */
      vaultPath: string;
      /** CLI path for saving the inbox */
      cliPath: string;
      /** Vault name */
      vault: string;
      /** Folder to save the inbox (optional, defaults to vault root) */
      inboxFolder?: string;
      /** Maximum files to scan (optional) */
      maxFiles?: number;
    }
  | {
      action: "refreshKnowledgeTriageStateSync";
      /** Vault path on filesystem */
      vaultPath: string;
      /** CLI path for saving the sync */
      cliPath: string;
      /** Vault name */
      vault: string;
      /** Folder to save the sync (optional, defaults to vault root) */
      syncFolder?: string;
      /** Maximum files to scan (optional) */
      maxFiles?: number;
      /** Maximum depth to recurse when scanning (optional) */
      maxDepth?: number;
    }
  | {
      action: "refreshContradictionInbox";
      /** Vault path on filesystem */
      vaultPath: string;
      /** CLI path for saving the inbox */
      cliPath: string;
      /** Vault name */
      vault: string;
      /** Folder to save the inbox (optional, defaults to vault root) */
      inboxFolder?: string;
      /** Maximum files to scan (optional) */
      maxFiles?: number;
    }
  | { action: "testNativeHost" };

export type SaveContentResponse =
  | { success: true; usedMethod: "cli" | "uri" | "clipboard" }
  | { success: false; error: string };

export type SaveToCliResponse =
  | { success: true }
  | { success: false; error: string; requiresBridge?: boolean };

export type SaveAttachmentToCliResponse =
  | { success: true; filePath: string }
  | { success: false; error: string; requiresBridge?: boolean };

export type TestCliConnectionResponse =
  | { success: true; version?: string }
  | { success: false; error: string };

export type DetectCliResponse = {
  /** Whether detection was attempted */
  attempted: boolean;
  /** The detected or guessed path (may be empty) */
  cliPath: string;
  /** The platform that was detected */
  platform: string;
  /** List of alternative paths to try */
  alternatives: string[];
  /** Note about detection limitations */
  note: string;
};

export type ListVaultFoldersResponse =
  | { success: true; folders: string[] }
  | { success: false; error: string; requiresBridge?: boolean };

export type CreateVaultFolderResponse =
  | { success: true }
  | { success: false; error: string; requiresBridge?: boolean };

export type ExtractPdfResponse =
  | { success: true; text: string; pageCount: number; truncated: boolean; hasTextLayer: boolean }
  | { success: false; error: string };

export type RefreshOpenQuestionsInboxResponse =
  | {
      success: true;
      questionsCount: number;
      sourceClipsProcessed: number;
      unresolvedQuestions: number;
      resolvedQuestions: number;
      truncated: boolean;
    }
  | { success: false; error: string };

export type RefreshKeyTakeawaysInboxResponse =
  | {
      success: true;
      insightsCount: number;
      sourceClipsProcessed: number;
      activeInsights: number;
      archivedInsights: number;
      truncated: boolean;
    }
  | { success: false; error: string };

export type RefreshKnowledgeTriageStateSyncResponse =
  | {
      success: true;
      itemsCount: number;
      sourceInboxesProcessed: number;
      statusCountsReady: number;
      statusCountsInProgress: number;
      statusCountsBlocked: number;
      statusCountsDone: number;
      truncated: boolean;
    }
  | { success: false; error: string };

export type RefreshContradictionInboxResponse =
  | {
      success: true;
      conflictsCount: number;
      sourceClipsProcessed: number;
      openConflicts: number;
      resolvedConflicts: number;
      falsePositiveConflicts: number;
      truncated: boolean;
    }
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
      disableTemplate?: boolean; // Override template matching for this clip
      settings: Settings; // Pass settings to content script for extraction
    }
  | { action: "getPageInfo" }
  | { action: "getSelectionInfo" }
  | { action: "getTemplateInfo"; settings: Settings };

/** Selection info returned from content script */
export type SelectionInfo = {
  /** Whether user has text selected */
  hasSelection: boolean;
  /** Preview of selected text (truncated) */
  preview: string;
};

export type TabResponse =
  | { ok: true; result: ClipResult }
  | { ok: false; error: string };

export type PageInfo = {
  url: string;
  title: string;
  type: PageType;
  contentType?: string;
  /** Twitter/X thread length (if this is a thread) */
  twitterThreadLength?: number;
};

/** Template info returned from content script */
export type TemplateInfo = {
  /** Whether a template matches the current URL */
  hasTemplate: boolean;
  /** Name of the matching template (if any) */
  templateName?: string;
  /** Domain of the matching template */
  templateDomain?: string;
  /** Whether the template is built-in or custom */
  templateSource?: "built-in" | "custom";
};