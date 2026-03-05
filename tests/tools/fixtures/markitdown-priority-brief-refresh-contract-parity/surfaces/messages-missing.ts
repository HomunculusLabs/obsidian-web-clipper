// Missing message state: markitdown priority brief message types are NOT present

export type RuntimeRequest =
  | { action: "getSettings" }
  | { action: "refreshContradictionInbox"; vaultPath: string; cliPath: string; vault: string }
  // Missing: refreshMarkitdownConversionPriorityBrief
  | { action: "testNativeHost" };

export type RefreshContradictionInboxResponse =
  | { success: true; conflictsCount: number; sourceClipsProcessed: number; truncated: boolean }
  | { success: false; error: string };

// Missing: RefreshMarkitdownConversionPriorityBriefResponse
