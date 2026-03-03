// Pass state: All message types present

export type RuntimeRequest =
  | { action: "getSettings" }
  | { action: "refreshContradictionInbox"; vaultPath: string; cliPath: string; vault: string }
  | {
      action: "refreshKnowledgeRevalidationInbox";
      vaultPath: string;
      cliPath: string;
      vault: string;
      inboxFolder?: string;
      maxFiles?: number;
    }
  | {
      action: "refreshKnowledgeRevalidationStateSync";
      vaultPath: string;
      cliPath: string;
      vault: string;
      syncFolder?: string;
      maxFiles?: number;
    }
  | { action: "testNativeHost" };

export type RefreshContradictionInboxResponse =
  | { success: true; conflictsCount: number; sourceClipsProcessed: number; truncated: boolean }
  | { success: false; error: string };

export type RefreshKnowledgeRevalidationInboxResponse =
  | { success: true; itemsCount: number; sourceArtifactsProcessed: number; unresolvedItems: number; resolvedItems: number; truncated: boolean }
  | { success: false; error: string };

export type RefreshKnowledgeRevalidationStateSyncResponse =
  | { success: true; syncCount: number; sourceArtifactsProcessed: number; truncated: boolean }
  | { success: false; error: string };
