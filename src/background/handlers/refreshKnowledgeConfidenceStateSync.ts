/**
 * Handler for refreshing the Knowledge Confidence State Sync.
 *
 * This handler scans the vault for confidence items from multiple source artifacts,
 * builds the state sync, and saves it to a file using the CLI.
 *
 * Designed for deterministic behavior with explicit fallback on errors.
 */

import type { RefreshKnowledgeConfidenceStateSyncResponse } from "../../shared/messages";
import { handleSaveToCli } from "./saveToCli";
import {
  buildStateSyncFromVault,
  type ScanVaultOptions,
} from "../../shared/knowledgeConfidenceStateSyncBuilder";
import {
  extractSyncMetadata,
  type ConfidenceStateSync,
} from "../../shared/knowledgeConfidenceStateSyncContract";
import {
  resolveSyncPath,
  type ExportSyncOptions,
  exportConfidenceStateSync,
} from "../../shared/knowledgeConfidenceStateSyncExporter";

interface RefreshKnowledgeConfidenceStateSyncRequest {
  action: "refreshKnowledgeConfidenceStateSync";
  vaultPath: string;
  cliPath: string;
  vault: string;
  syncFolder?: string;
  maxFiles?: number;
  maxDepth?: number;
}

/**
 * Handle refreshKnowledgeConfidenceStateSync requests.
 *
 * Scans the vault for confidence items from multiple source artifacts,
 * builds the state sync, and saves it to the vault via CLI.
 *
 * On any error, returns a failure response without corrupting the sync.
 * This ensures deterministic fallback behavior.
 */
export async function handleRefreshKnowledgeConfidenceStateSync(
  request: RefreshKnowledgeConfidenceStateSyncRequest
): Promise<RefreshKnowledgeConfidenceStateSyncResponse> {
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
    const sync: ConfidenceStateSync = await buildStateSyncFromVault(scanOptions);

    // Export sync to file
    const exportOptions: ExportSyncOptions = {
      vaultPath,
      syncFolder: syncFolder || undefined,
      createFolder: true,
    };

    const exportResult = await exportConfidenceStateSync(sync, exportOptions);

    // Extract metadata for response
    const metadata = extractSyncMetadata(sync);

    return {
      success: true,
      itemsCount: metadata.items_count,
      sourceArtifactsProcessed: metadata.source_artifacts_processed,
      statusCountsUnverified: metadata.status_counts_unverified,
      statusCountsVerified: metadata.status_counts_verified,
      statusCountsRejected: metadata.status_counts_rejected,
      statusCountsDeferred: metadata.status_counts_deferred,
      totalSourceRefs: metadata.total_source_refs,
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
