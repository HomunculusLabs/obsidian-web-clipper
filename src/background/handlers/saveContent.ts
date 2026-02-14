/**
 * Handler for saving content via the save pipeline (URI → clipboard fallback).
 *
 * This handler is used by content scripts (like the ChatGPT injector) to save
 * content to Obsidian using the same fallback chain as the popup.
 */

import { tabsCreate } from "../../shared/chromeAsync";
import { toErrorMessage } from "../../shared/errors";
import { loadSettings } from "../../shared/settingsService";
import { showClipSavedNotification } from "../../shared/notifications";
import { incrementBadgeCounter } from "../../shared/badgeCounter";
import type { RuntimeRequest, SaveContentResponse } from "../../shared/messages";

type SaveContentRequest = Extract<RuntimeRequest, { action: "saveContent" }>;

const MAX_URI_CONTENT_CHARS = 180_000;

function getNoteTitleFromFilePath(filePath: string): string {
  const segments = filePath.split("/").filter(Boolean);
  const value = segments[segments.length - 1] || "Untitled";
  return value.trim() || "Untitled";
}

/**
 * Save content via Obsidian URI scheme
 */
async function saveViaUri(
  vault: string,
  filePath: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  const encodedContent = encodeURIComponent(content);

  if (encodedContent.length > MAX_URI_CONTENT_CHARS) {
    return { success: false, error: "Content too large for URI" };
  }

  const uri = `obsidian://new?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(filePath)}&content=${encodedContent}`;

  try {
    const tab = await tabsCreate({ url: uri });
    return { success: Boolean(tab) };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to open Obsidian URI") };
  }
}

/**
 * Copy content to clipboard
 */
async function saveViaClipboard(content: string): Promise<{ success: boolean; error?: string }> {
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (!clipboard) {
    return { success: false, error: "Clipboard API unavailable" };
  }

  try {
    await clipboard.writeText(content);
    return { success: true };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Clipboard write failed") };
  }
}

/**
 * Handle saveContent requests.
 *
 * Tries URI first, then falls back to clipboard if enabled.
 */
export async function handleSaveContent(request: SaveContentRequest): Promise<SaveContentResponse> {
  const { markdown, filePath, vault, fallbackToClipboard = true } = request;

  // Validate inputs
  if (!markdown || markdown.trim() === "") {
    return { success: false, error: "Content is required" };
  }

  if (!filePath || filePath.trim() === "") {
    return { success: false, error: "File path is required" };
  }

  if (!vault || vault.trim() === "") {
    return { success: false, error: "Vault name is required" };
  }

  // Try URI first
  const uriResult = await saveViaUri(vault, filePath, markdown);
  if (uriResult.success) {
    const settings = await loadSettings();
    void showClipSavedNotification(settings, getNoteTitleFromFilePath(filePath), vault);
    void incrementBadgeCounter(settings);
    return { success: true, usedMethod: "uri" };
  }

  // If URI failed and clipboard fallback is enabled, try clipboard
  if (fallbackToClipboard) {
    const clipboardResult = await saveViaClipboard(markdown);
    if (clipboardResult.success) {
      const settings = await loadSettings();
      void showClipSavedNotification(settings, getNoteTitleFromFilePath(filePath), vault);
      void incrementBadgeCounter(settings);
      return { success: true, usedMethod: "clipboard" };
    }

    // Both failed - return clipboard error
    return { success: false, error: clipboardResult.error || "Both URI and clipboard save failed" };
  }

  // URI failed and no clipboard fallback
  return { success: false, error: uriResult.error || "URI save failed" };
}
