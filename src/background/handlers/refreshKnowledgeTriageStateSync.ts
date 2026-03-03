/**
 * Handler for refreshing the Knowledge Triage State Sync.
 *
 * This handler scans the vault for triage items from multiple inboxes,
 * builds the state sync, and saves it to a file using the CLI.
 *
 * Designed for deterministic behavior with explicit fallback on errors.
 */

import type { RefreshKnowledgeTriageStateSyncResponse } from "../../shared/messages";
import { handleSaveToCli } from "./saveToCli";
import {
  buildStateSyncFromVault,
  type ScanVaultOptions,
} from "../../shared/knowledgeTriageStateSyncBuilder";
import {
  extractSyncMetadata,
  type TriageStateSync,
} from "../../shared/knowledgeTriageStateSyncContract";
import {
  resolveSyncPath,
  type ExportSyncOptions,
  exportTriageStateSync,
} from "../../shared/knowledgeTriageStateSyncExporter";

interface RefreshKnowledgeTriageStateSyncRequest {
  action: "refreshKnowledgeTriageStateSync";
  vaultPath: string;
  cliPath: string;
  vault: string;
  syncFolder?: string;
  maxFiles?: number;
  maxDepth?: number;
}

/**
 * Handle refreshKnowledgeTriageStateSync requests.
 *
 * Scans the vault for triage items from multiple inboxes,
 * builds the state sync, and saves it to the vault via CLI.
 *
 * On any error, returns a failure response without corrupting the sync.
 * This ensures deterministic fallback behavior.
 */
export async function handleRefreshKnowledgeTriageStateSync(
  request: RefreshKnowledgeTriageStateSyncRequest
): Promise<RefreshKnowledgeTriageStateSyncResponse> {
  const { vaultPath, cliPath, vault, syncFolder, maxFiles, maxDepth } = request;

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
      maxDepth: maxDepth ?? 3,
      includeHidden: false,
      maxFiles: maxFiles || 100,
      extensions: [".md"],
    };

    // Build state sync from vault scan
    const sync: TriageStateSync = await buildStateSyncFromVault(scanOptions);

    // Export sync to file
    const exportOptions: ExportSyncOptions = {
      vaultPath,
      syncFolder: syncFolder || undefined,
      createFolder: true,
    };

    const exportResult = await exportTriageStateSync(sync, exportOptions);

    // Extract metadata for response
    const metadata = extractSyncMetadata(sync);

    return {
      success: true,
      itemsCount: metadata.items_count,
      sourceInboxesProcessed: metadata.source_inboxes_processed,
      statusCountsReady: metadata.status_counts_ready,
      statusCountsInProgress: metadata.status_counts_in_progress,
      statusCountsBlocked: metadata.status_counts_blocked,
      statusCountsDone: metadata.status_counts_done,
      truncated: metadata.sync_truncated,
    };
  } catch (error) {
    // Deterministic fallback: return error without corrupting existing sync
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `State sync refresh failed: ${errorMsg}`,
    };
  }
}
