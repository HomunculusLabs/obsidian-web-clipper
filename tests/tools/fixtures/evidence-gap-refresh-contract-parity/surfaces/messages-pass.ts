// Pass state: All message types present

export type RuntimeRequest =
  | { action: "getSettings" }
  | { action: "refreshContradictionInbox"; vaultPath: string; cliPath: string; vault: string }
  | {
      action: "refreshEvidenceGapInbox";
      vaultPath: string;
      cliPath: string;
      vault: string;
      inboxFolder?: string;
      maxFiles?: number;
    }
  | {
      action: "refreshEvidenceGapStateSync";
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

export type RefreshEvidenceGapInboxResponse =
  | { success: true; gapsCount: number; sourceClipsProcessed: number; openGaps: number; resolvedGaps: number; truncated: boolean }
  | { success: false; error: string };

export type RefreshEvidenceGapStateSyncResponse =
  | { success: true; syncCount: number; sourceClipsProcessed: number; truncated: boolean }
  | { success: false; error: string };
