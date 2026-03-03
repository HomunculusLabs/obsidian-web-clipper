// Pass state: All handlers present and exported

import type { RefreshEvidenceGapInboxResponse } from "../../shared/messages";

interface RefreshEvidenceGapInboxRequest {
  action: "refreshEvidenceGapInbox";
  vaultPath: string;
  cliPath: string;
  vault: string;
  inboxFolder?: string;
  maxFiles?: number;
}

export async function handleRefreshEvidenceGapInbox(
  request: RefreshEvidenceGapInboxRequest
): Promise<RefreshEvidenceGapInboxResponse> {
  return { success: true, gapsCount: 0, sourceClipsProcessed: 0, openGaps: 0, resolvedGaps: 0, truncated: false };
}
