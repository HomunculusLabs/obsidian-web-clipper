/**
 * Handler for refreshing the Knowledge Trust Kickoff Brief.
 *
 * This handler scans the vault for trust items from:
 * - knowledge-trust-dashboard.md
 * - knowledge-trust-dashboard-state-sync.md
 * - knowledge-trust-dashboard-history.ndjson
 *
 * It builds the kickoff brief deterministically and saves it via CLI.
 *
 * Designed for deterministic behavior with explicit fallback on errors.
 */

import type { RefreshKnowledgeTrustKickoffBriefResponse } from "../../shared/messages";
import { handleSaveToCli } from "./saveToCli";
import {
  scanVaultForTrustItems,
  type ScanVaultOptions,
} from "../../shared/knowledgeTrustKickoffBriefBuilder";
import {
  buildKnowledgeTrustKickoffBrief,
  renderKnowledgeTrustKickoffBrief,
  extractBriefMetadata,
  RiskBand,
} from "../../shared/knowledgeTrustKickoffBriefContract";

interface RefreshKnowledgeTrustKickoffBriefRequest {
  action: "refreshKnowledgeTrustKickoffBrief";
  vaultPath: string;
  cliPath: string;
  vault: string;
  briefFolder?: string;
  maxFiles?: number;
  maxDepth?: number;
}

/**
 * Handle refreshKnowledgeTrustKickoffBrief requests.
 *
 * Scans the vault for trust items from dashboard, state-sync, and history artifacts,
 * builds the kickoff brief, and saves it to the vault via CLI.
 *
 * On any error, returns a failure response without corrupting the brief.
 * This ensures deterministic fallback behavior.
 */
export async function handleRefreshKnowledgeTrustKickoffBrief(
  request: RefreshKnowledgeTrustKickoffBriefRequest
): Promise<RefreshKnowledgeTrustKickoffBriefResponse> {
  const { vaultPath, cliPath, vault, briefFolder, maxFiles, maxDepth } = request;

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
      extensions: [".md", ".ndjson"],
    };

    // Scan vault for trust items
    const scanResult = await scanVaultForTrustItems(scanOptions);

    // Build brief from scanned trust items
    const brief = buildKnowledgeTrustKickoffBrief(scanResult.trustItems);

    // Render brief to markdown
    const markdown = renderKnowledgeTrustKickoffBrief(brief);

    // Determine brief file path
    const briefFilename = "knowledge-trust-kickoff-brief.md";
    const briefPath = briefFolder
      ? `${briefFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}/${briefFilename}`
      : briefFilename;

    // Save brief via CLI
    const saveResult = await handleSaveToCli({
      action: "saveToCli",
      filePath: briefPath,
      content: markdown,
      vault,
      cliPath,
    });

    if (!saveResult.success) {
      return {
        success: false,
        error: saveResult.error || "Failed to save brief via CLI",
      };
    }

    // Extract metadata for response
    const metadata = extractBriefMetadata(brief);

    return {
      success: true,
      entriesCount: metadata.items_count,
      sourceArtifactsProcessed: scanResult.filesWithTrust,
      activeItems: metadata.active_items,
      inProgressItems: metadata.in_progress_items,
      resolvedItems: metadata.resolved_items,
      dismissedItems: metadata.dismissed_items,
      criticalRiskCount: metadata.risk_band_counts[RiskBand.CRITICAL],
      highRiskCount: metadata.risk_band_counts[RiskBand.HIGH],
      truncated: metadata.brief_truncated,
    };
  } catch (error) {
    // Deterministic fallback: return error without corrupting existing brief
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Brief refresh failed: ${errorMsg}`,
    };
  }
}
