// Missing export state: Handler file exists but export is missing for markitdown priority brief

import type { RefreshMarkitdownConversionPriorityBriefResponse } from "../../shared/messages";

interface RefreshMarkitdownConversionPriorityBriefRequest {
  action: "refreshMarkitdownConversionPriorityBrief";
  vaultPath: string;
  cliPath: string;
  vault: string;
  briefFolder?: string;
  maxFiles?: number;
}

// Missing export keyword
async function handleRefreshMarkitdownConversionPriorityBrief(
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
