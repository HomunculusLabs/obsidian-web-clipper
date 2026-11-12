/**
 * Handler for saving content via the save pipeline.
 *
 * This handler is used by content scripts (like the ChatGPT injector) to save
 * content using the configured save method order with optional clipboard fallback.
 */

import { tabsCreate } from "../../shared/chromeAsync";
import { toErrorMessage } from "../../shared/errors";
import type { SaveMethod } from "../../shared/obsidianCli";
import { loadSettings } from "../../shared/settingsService";
import { showClipSavedNotification } from "../../shared/notifications";
import { incrementBadgeCounter } from "../../shared/badgeCounter";
import type { RuntimeRequest, SaveContentResponse } from "../../shared/messages";
import {
  MAX_OBSIDIAN_URI_CONTENT_CHARS,
  buildObsidianContentUri
} from "../../shared/obsidianUri";
import { handleSaveToCli } from "./saveToCli";

type SaveContentRequest = Extract<RuntimeRequest, { action: "saveContent" }>;

type SaveAttemptResult = {
  success: boolean;
  error?: string;
  vault?: string;
};

function getNoteTitleFromFilePath(filePath: string): string {
  const segments = filePath.split("/").filter(Boolean);
  const value = segments[segments.length - 1] || "Untitled";
  return value.trim() || "Untitled";
}

function resolveMethodOrder(
  saveMethod: SaveMethod,
  fallbackToClipboard: boolean
): SaveMethod[] {
  const order: SaveMethod[] =
    saveMethod === "cli"
      ? ["cli", "uri", "clipboard"]
      : saveMethod === "clipboard"
        ? ["clipboard"]
        : ["uri", "clipboard"];

  if (!fallbackToClipboard && saveMethod !== "clipboard") {
    return order.filter((method) => method !== "clipboard");
  }

  return order;
}

/**
 * Save content via Obsidian URI scheme
 */
async function saveViaUri(
  vault: string,
  filePath: string,
  content: string
): Promise<SaveAttemptResult> {
  const encodedContent = encodeURIComponent(content);

  if (encodedContent.length > MAX_OBSIDIAN_URI_CONTENT_CHARS) {
    return { success: false, error: "Content too large for URI" };
  }

  const uri = buildObsidianContentUri(vault, filePath, content);

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
async function saveViaClipboard(content: string): Promise<SaveAttemptResult> {
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
 * Save content via Obsidian CLI using the Native Messaging bridge handler.
 */
async function saveViaCli(
  settings: Awaited<ReturnType<typeof loadSettings>>,
  fallbackVault: string,
  filePath: string,
  content: string
): Promise<SaveAttemptResult> {
  const cliEnabled = settings.obsidianCli?.enabled === true;
  const cliPath = (settings.obsidianCli?.cliPath || "").trim();
  const cliVault = (settings.obsidianCli?.vault || fallbackVault).trim() || fallbackVault;

  if (!cliEnabled) {
    return { success: false, error: "CLI integration is not enabled" };
  }

  if (!cliPath) {
    return { success: false, error: "CLI path is not configured" };
  }

  const response = await handleSaveToCli({
    action: "saveToCli",
    filePath,
    content,
    vault: cliVault,
    cliPath
  });

  if (!response.success) {
    return { success: false, error: response.error || "CLI save failed" };
  }

  return { success: true, vault: cliVault };
}

/**
 * Handle saveContent requests.
 *
 * Uses settings.saveMethod to resolve save order while honoring fallbackToClipboard.
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

  const settings = await loadSettings();
  const methodOrder = resolveMethodOrder(settings.saveMethod || "uri", fallbackToClipboard);

  let lastError: string | undefined;

  for (const method of methodOrder) {
    let targetVault = vault;
    const result =
      method === "cli"
        ? await saveViaCli(settings, vault, filePath, markdown)
        : method === "uri"
          ? await saveViaUri(vault, filePath, markdown)
          : await saveViaClipboard(markdown);

    if (method === "cli" && result.success) {
      targetVault = result.vault || vault;
    }

    if (result.success) {
      void showClipSavedNotification(settings, getNoteTitleFromFilePath(filePath), targetVault);
      void incrementBadgeCounter(settings);
      return { success: true, usedMethod: method };
    }

    lastError = result.error || lastError;
  }

  return { success: false, error: lastError || "Failed to save content" };
}
