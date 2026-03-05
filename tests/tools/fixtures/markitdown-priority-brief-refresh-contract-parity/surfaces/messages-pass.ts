// Pass state: All message types present for markitdown priority brief

export type RuntimeRequest =
  | { action: "getSettings" }
  | { action: "refreshContradictionInbox"; vaultPath: string; cliPath: string; vault: string }
  | {
      action: "refreshMarkitdownConversionPriorityBrief";
      vaultPath: string;
      cliPath: string;
      vault: string;
      briefFolder?: string;
      maxFiles?: number;
    }
  | { action: "testNativeHost" };

export type RefreshContradictionInboxResponse =
  | { success: true; conflictsCount: number; sourceClipsProcessed: number; truncated: boolean }
  | { success: false; error: string };

export type RefreshMarkitdownConversionPriorityBriefResponse =
  | {
      success: true;
      priorityItemsCount: number;
      sourceArtifactsProcessed: number;
      highPriorityItems: number;
      mediumPriorityItems: number;
      lowPriorityItems: number;
      truncated: boolean;
    }
  | { success: false; error: string };
