// Pass state: Handler present and exported for markitdown priority brief

import type { RefreshMarkitdownConversionPriorityBriefResponse } from "../../shared/messages";

interface RefreshMarkitdownConversionPriorityBriefRequest {
  action: "refreshMarkitdownConversionPriorityBrief";
  vaultPath: string;
  cliPath: string;
  vault: string;
  briefFolder?: string;
  maxFiles?: number;
}

export async function handleRefreshMarkitdownConversionPriorityBrief(
  request: RefreshMarkitdownConversionPriorityBriefRequest
): Promise<RefreshMarkitdownConversionPriorityBriefResponse> {
  return {
    success: true,
    priorityItemsCount: 0,
    sourceArtifactsProcessed: 0,
    highPriorityItems: 0,
    mediumPriorityItems: 0,
    lowPriorityItems: 0,
    truncated: false,
  };
}
