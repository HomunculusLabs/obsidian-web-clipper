/**
 * Handler for refreshing the Contradiction Inbox.
 *
 * This handler scans the vault for claims from Key Takeaways and other
 * knowledge surfaces, detects contradictions, builds the inbox, and saves
 * it to a file using the CLI.
 *
 * Designed for deterministic behavior with explicit fallback on errors.
 */

import type { RefreshContradictionInboxResponse } from "../../shared/messages";
import { handleSaveToCli } from "./saveToCli";
import {
  scanVaultForClaims,
  buildContradictionInbox,
  type ScanVaultOptions,
} from "../../shared/contradictionInboxBuilder";
import {
  renderContradictionInbox,
  extractInboxMetadata,
  DEFAULT_EMPTY_INBOX_METADATA,
  CONTRADICTION_INBOX_VERSION,
  type ContradictionInbox,
} from "../../shared/contradictionInboxContract";

interface RefreshContradictionInboxRequest {
  action: "refreshContradictionInbox";
  vaultPath: string;
  cliPath: string;
  vault: string;
  inboxFolder?: string;
  maxFiles?: number;
}

/**
 * Handle refreshContradictionInbox requests.
 *
 * Scans the vault for claims from Key Takeaways and other knowledge surfaces,
 * detects contradictions, builds the inbox, and saves it to the vault via CLI.
 *
 * On any error, returns a failure response without corrupting the inbox.
 * This ensures deterministic fallback behavior.
 */
export async function handleRefreshContradictionInbox(
  request: RefreshContradictionInboxRequest
): Promise<RefreshContradictionInboxResponse> {
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

    // Scan vault for claims
    const scanResult = await scanVaultForClaims(scanOptions);

    // Build inbox from scanned claims
    const inbox = buildContradictionInbox(scanResult.claims);

    // Render inbox to markdown
    const markdown = renderContradictionInbox(inbox);

    // Determine inbox file path
    const inboxFilename = "contradiction-inbox.md";
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
      conflictsCount: metadata.conflicts_count,
      sourceClipsProcessed: metadata.source_clips_processed,
      openConflicts: metadata.open_conflicts,
      resolvedConflicts: metadata.resolved_conflicts,
      falsePositiveConflicts: metadata.false_positive_conflicts,
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
