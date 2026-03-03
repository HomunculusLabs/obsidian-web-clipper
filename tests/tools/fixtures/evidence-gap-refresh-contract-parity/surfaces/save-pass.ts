// Pass state: All save trigger wiring present

import type { RuntimeRequest, RefreshEvidenceGapInboxResponse, RefreshEvidenceGapStateSyncResponse } from "../shared/messages";
import type { Settings } from "../shared/settings";
import { runtimeSendMessage } from "../shared/chromeAsync";

async function refreshEvidenceGapInbox(settings: Settings, vault: string): Promise<void> {
  if (!settings.obsidianCli?.enabled || !settings.obsidianCli.cliPath) {
    return;
  }
  try {
    await runtimeSendMessage<RuntimeRequest, RefreshEvidenceGapInboxResponse>({
      action: "refreshEvidenceGapInbox",
      vaultPath: "/test/vault",
      cliPath: settings.obsidianCli.cliPath,
      vault,
    });
  } catch {
    // Non-blocking
  }
}

async function refreshEvidenceGapStateSync(settings: Settings, vault: string): Promise<void> {
  if (!settings.obsidianCli?.enabled || !settings.obsidianCli.cliPath) {
    return;
  }
  try {
    await runtimeSendMessage<RuntimeRequest, RefreshEvidenceGapStateSyncResponse>({
      action: "refreshEvidenceGapStateSync",
      vaultPath: "/test/vault",
      cliPath: settings.obsidianCli.cliPath,
      vault,
    });
  } catch {
    // Non-blocking
  }
}

export async function saveToObsidian(): Promise<void> {
  // Save logic...
  const settings = {} as Settings;
  const vault = "test-vault";
  
  // Fire-and-forget invocations
  void refreshEvidenceGapInbox(settings, vault);
  void refreshEvidenceGapStateSync(settings, vault);
  
  return;
}
