/**
 * Handler for refreshing the Key Takeaways Inbox.
 *
 * This handler scans the vault for Clip Brief Key Takeaways,
 * builds the inbox, and saves it to a file using the CLI.
 *
 * Designed for deterministic behavior with explicit fallback on errors.
 */

import type { RefreshKeyTakeawaysInboxResponse } from "../../shared/messages";
import { handleSaveToCli } from "./saveToCli";
import {
  scanVaultForKeyTakeaways,
  type ScanVaultOptions,
} from "../../shared/keyTakeawaysInboxBuilder";
import {
  buildKeyTakeawaysInbox,
  renderKeyTakeawaysInbox,
  extractInboxMetadata,
  DEFAULT_EMPTY_INBOX_METADATA,
  KEY_TAKEAWAYS_INBOX_VERSION,
  type KeyTakeawaysInbox,
} from "../../shared/keyTakeawaysInboxContract";

interface RefreshKeyTakeawaysInboxRequest {
  action: "refreshKeyTakeawaysInbox";
  vaultPath: string;
  cliPath: string;
  vault: string;
  inboxFolder?: string;
  maxFiles?: number;
}

/**
 * Handle refreshKeyTakeawaysInbox requests.
 *
 * Scans the vault for Key Takeaways from Clip Brief sections,
 * builds the inbox, and saves it to the vault via CLI.
 *
 * On any error, returns a failure response without corrupting the inbox.
 * This ensures deterministic fallback behavior.
 */
export async function handleRefreshKeyTakeawaysInbox(
  request: RefreshKeyTakeawaysInboxRequest
): Promise<RefreshKeyTakeawaysInboxResponse> {
  const { vaultPath, cliPath, vault, inboxFolder, maxFiles } = request;

  // Validate inputs
  if (!vaultPath || vaultPath.trim() === "") {
    return { success: false, error: "Vault path is required" };
  }

  if (!cliPath || cliPath.trim() === "") {
    return { success: false, error: "CLI path is required" };
  }

  if (!vault || vault.trim() === "") {
    return { success: false, error: "Vault name is required" };
  }

  try {
    // Build scan options
    const scanOptions: ScanVaultOptions = {
      vaultPath,
      maxDepth: 3,
      includeHidden: false,
      maxFiles: maxFiles || 100,
      extensions: [".md"],
    };

    // Scan vault for Key Takeaways
    const scanResult = await scanVaultForKeyTakeaways(scanOptions);

    // Build inbox from scanned insights
    const inbox = buildKeyTakeawaysInbox(scanResult.insights);

    // Render inbox to markdown
    const markdown = renderKeyTakeawaysInbox(inbox);

    // Determine inbox file path
    const inboxFilename = "key-takeaways-inbox.md";
    const inboxPath = inboxFolder
      ? `${inboxFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}/${inboxFilename}`
      : inboxFilename;

    // Save inbox via CLI
    const saveResult = await handleSaveToCli({
      action: "saveToCli",
      filePath: inboxPath,
      content: markdown,
      vault,
      cliPath,
    });

    if (!saveResult.success) {
      return {
        success: false,
        error: saveResult.error || "Failed to save inbox via CLI",
      };
    }

    // Extract metadata for response
    const metadata = extractInboxMetadata(inbox);

    return {
      success: true,
      insightsCount: metadata.insights_count,
      sourceClipsProcessed: metadata.source_clips_processed,
      activeInsights: metadata.active_insights,
      archivedInsights: metadata.archived_insights,
      truncated: metadata.inbox_truncated,
    };
  } catch (error) {
    // Deterministic fallback: return error without corrupting existing inbox
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Inbox refresh failed: ${errorMsg}`,
    };
  }
}
