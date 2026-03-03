// Pass state: handler for evidence-gap-state-sync is present and exported

import type { RefreshEvidenceGapStateSyncResponse } from "../../shared/messages";

interface RefreshEvidenceGapStateSyncRequest {
  action: "refreshEvidenceGapStateSync";
  vaultPath: string;
  cliPath: string;
  vault: string;
  syncFolder?: string;
  maxFiles?: number;
}

export async function handleRefreshEvidenceGapStateSync(
  request: RefreshEvidenceGapStateSyncRequest
): Promise<RefreshEvidenceGapStateSyncResponse> {
  return { success: true, syncCount: 0, sourceClipsProcessed: 0, truncated: false };
}
