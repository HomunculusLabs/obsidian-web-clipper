import type { ClipResult, PageType } from "../shared/types";
import type { RuntimeRequest, SaveToCliResponse } from "../shared/messages";
import type { Settings } from "../shared/settings";
import { DEFAULT_SETTINGS } from "../shared/settings";
import type { SaveMethod } from "../shared/obsidianCli";
import { runtimeSendMessage } from "../shared/chromeAsync";
import { buildClipMarkdown } from "../shared/markdown";
import { injectWikiLinks } from "../content/web/wikiLinks";
import { buildFrontmatterFromClip } from "../shared/buildFrontmatter";
import { recordTagUsage } from "../shared/tagHistory";
import { SaveError } from "../shared/errors";
import { showClipSavedNotification } from "../shared/notifications";
import { showStatus } from "./ui";

const MAX_URI_CONTENT_CHARS = 180000;

export type SaveOptions = {
  result: ClipResult;
  settings: Settings;
  pageType: PageType;
  currentTabUrl: string;
  overrideTitle?: string;
  overrideFolder?: string;
  overrideTags?: string;
};

export type SaveResult = {
  usedClipboardFallback: boolean;
  usedMethod: SaveMethod;
};

type OpenUriResponse = { success: boolean; error?: string };

/**
 * Prepared data for saving
 */
interface PreparedSave {
  markdown: string;
  encodedContent: string;
  filePath: string;
  vault: string;
  baseObsidianUri: string;
  contentTooLargeForUri: boolean;
  tags: string[];
}

function getNoteTitleFromFilePath(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  const lastPart = parts[parts.length - 1] || "Untitled";
  return lastPart.trim() || "Untitled";
}

/**
 * Build the frontmatter and markdown content for the clip
 */
function prepareSave(options: SaveOptions): PreparedSave {
  const { result, settings } = options;

  // Build frontmatter using the extracted module
  const { frontmatter, filePath, tags } = buildFrontmatterFromClip(options);

  // Build markdown and apply wiki-link injection if enabled
  const rawMarkdown = buildClipMarkdown(frontmatter, result.markdown || "");
  const markdown = injectWikiLinks(rawMarkdown, settings);
  const encodedContent = encodeURIComponent(markdown);

  const vault = (settings.vaultName || DEFAULT_SETTINGS.vaultName).trim() || "Main Vault";
  const baseObsidianUri = `obsidian://new?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(
    filePath
  )}`;

  const contentTooLargeForUri = encodedContent.length > MAX_URI_CONTENT_CHARS;

  return {
    markdown,
    encodedContent,
    filePath,
    vault,
    baseObsidianUri,
    contentTooLargeForUri,
    tags
  };
}

/**
 * Save via Obsidian CLI (requires Native Messaging bridge)
 */
async function saveViaCli(
  prepared: PreparedSave,
  settings: Settings
): Promise<{ success: boolean; error?: string }> {
  const cliConfig = settings.obsidianCli;

  // Check if CLI is configured and enabled
  if (!cliConfig?.enabled) {
    return { success: false, error: "CLI integration is not enabled" };
  }

  if (!cliConfig.cliPath) {
    return { success: false, error: "CLI path is not configured" };
  }

  const vault = cliConfig.vault || prepared.vault;

  const response = await runtimeSendMessage<RuntimeRequest, SaveToCliResponse>({
    action: "saveToCli",
    filePath: prepared.filePath,
    content: prepared.markdown,
    vault,
    cliPath: cliConfig.cliPath
  });

  if (!response?.success) {
    return { success: false, error: response?.error || "CLI save failed" };
  }

  return { success: true };
}

/**
 * Save via Obsidian URI scheme
 */
async function saveViaUri(prepared: PreparedSave): Promise<{ success: boolean; error?: string }> {
  // If content is too large, we can't use URI
  if (prepared.contentTooLargeForUri) {
    return { success: false, error: "Content too large for URI" };
  }

  const obsidianUri = `${prepared.baseObsidianUri}&content=${prepared.encodedContent}`;

  const response = await runtimeSendMessage<RuntimeRequest, OpenUriResponse>({
    action: "openObsidianUri",
    uri: obsidianUri
  });

  if (!response?.success) {
    return { success: false, error: response?.error || "Failed to open Obsidian URI" };
  }

  return { success: true };
}

/**
 * Copy content to clipboard and optionally open Obsidian
 */
async function saveViaClipboard(
  prepared: PreparedSave,
  openObsidian: boolean = true
): Promise<{ success: boolean; error?: string }> {
  await runtimeSendMessage<RuntimeRequest, unknown>({
    action: "copyToClipboard",
    data: prepared.markdown
  });

  if (openObsidian) {
    // Best-effort: open Obsidian without content so the user can paste
    try {
      await runtimeSendMessage<RuntimeRequest, OpenUriResponse>({
        action: "openObsidianUri",
        uri: prepared.baseObsidianUri
      });
    } catch {
      // Ignore; clipboard copy already succeeded
    }
  }

  return { success: true };
}

/**
 * Main save function with method routing and fallback chain.
 *
 * Fallback chain: CLI → URI → clipboard
 *
 * The save method is determined by settings.saveMethod:
 * - "cli": Try CLI first, fall back to URI, then clipboard
 * - "uri": Try URI first, fall back to clipboard
 * - "clipboard": Copy directly to clipboard
 */
export async function saveToObsidian(options: SaveOptions): Promise<SaveResult> {
  const { settings } = options;
  const prepared = prepareSave(options);
  const saveMethod = settings.saveMethod || DEFAULT_SETTINGS.saveMethod || "uri";

  // Determine the order of methods to try based on configured saveMethod
  const methodOrder: SaveMethod[] = [];
  if (saveMethod === "cli") {
    methodOrder.push("cli", "uri", "clipboard");
  } else if (saveMethod === "uri") {
    methodOrder.push("uri", "clipboard");
  } else {
    methodOrder.push("clipboard");
  }

  let lastError: string | undefined;

  for (const method of methodOrder) {
    let result: { success: boolean; error?: string };

    try {
      if (method === "cli") {
        // Only try CLI if it's configured
        if (!settings.obsidianCli?.enabled) {
          continue;
        }
        result = await saveViaCli(prepared, settings);
      } else if (method === "uri") {
        result = await saveViaUri(prepared);
      } else {
        result = await saveViaClipboard(prepared, true);
      }

      if (result.success) {
        const usedClipboardFallback = method === "clipboard" && saveMethod !== "clipboard";
        
        if (method === "clipboard") {
          if (prepared.contentTooLargeForUri) {
            showStatus(
              "success",
              "Content copied to clipboard (too large for Obsidian URI). Paste into a new note."
            );
          } else if (saveMethod !== "clipboard") {
            showStatus(
              "success",
              "Content copied to clipboard (fallback). Paste into a new note."
            );
          } else {
            showStatus(
              "success",
              "Content copied to clipboard. Paste into a new note."
            );
          }
        } else if (method === "cli") {
          showStatus("success", "Saved to Obsidian via CLI.");
        } else {
          showStatus("success", "Saved to Obsidian.");
        }

        // Record tag usage in history (fire-and-forget)
        if (prepared.tags.length > 0) {
          void recordTagUsage(prepared.tags);
        }

        void showClipSavedNotification(
          settings,
          getNoteTitleFromFilePath(prepared.filePath),
          prepared.vault
        );

        return { usedClipboardFallback, usedMethod: method };
      }

      lastError = result.error;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // All methods failed
  throw new SaveError(lastError || "Failed to save to Obsidian", "SAVE_ALL_METHODS_FAILED");
}
