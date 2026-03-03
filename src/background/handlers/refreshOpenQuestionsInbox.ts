/**
 * Handler for refreshing the Open Questions Inbox.
 *
 * This handler scans the vault for Clip Brief Open Questions,
 * builds the inbox, and saves it to a file using the CLI.
 *
 * Designed for deterministic behavior with explicit fallback on errors.
 */

import type { RefreshOpenQuestionsInboxResponse } from "../../shared/messages";
import { handleSaveToCli } from "./saveToCli";
import {
  scanVaultForOpenQuestions,
  type ScanVaultOptions,
} from "../../shared/openQuestionsInboxBuilder";
import {
  buildOpenQuestionsInbox,
  renderOpenQuestionsInbox,
  extractInboxMetadata,
  DEFAULT_EMPTY_INBOX_METADATA,
  OPEN_QUESTIONS_INBOX_VERSION,
  type OpenQuestionsInbox,
} from "../../shared/openQuestionsInboxContract";

interface RefreshOpenQuestionsInboxRequest {
  action: "refreshOpenQuestionsInbox";
  vaultPath: string;
  cliPath: string;
  vault: string;
  inboxFolder?: string;
  maxFiles?: number;
}

/**
 * Handle refreshOpenQuestionsInbox requests.
 *
 * Scans the vault for Open Questions from Clip Brief sections,
 * builds the inbox, and saves it to the vault via CLI.
 *
 * On any error, returns a failure response without corrupting the inbox.
 * This ensures deterministic fallback behavior.
 */
export async function handleRefreshOpenQuestionsInbox(
  request: RefreshOpenQuestionsInboxRequest
): Promise<RefreshOpenQuestionsInboxResponse> {
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

    // Scan vault for Open Questions
    const scanResult = await scanVaultForOpenQuestions(scanOptions);

    // Build inbox from scanned questions
    const inbox = buildOpenQuestionsInbox(scanResult.questions);

    // Render inbox to markdown
    const markdown = renderOpenQuestionsInbox(inbox);

    // Determine inbox file path
    const inboxFilename = "open-questions-inbox.md";
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
      questionsCount: metadata.questions_count,
      sourceClipsProcessed: metadata.source_clips_processed,
      unresolvedQuestions: metadata.unresolved_questions,
      resolvedQuestions: metadata.resolved_questions,
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
