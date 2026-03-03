// Missing state: No knowledge-revalidation message types

export type RuntimeRequest =
  | { action: "getSettings" }
  | { action: "refreshContradictionInbox"; vaultPath: string; cliPath: string; vault: string }
  | { action: "testNativeHost" };

export type RefreshContradictionInboxResponse =
  | { success: true; conflictsCount: number; sourceClipsProcessed: number; truncated: boolean }
  | { success: false; error: string };
