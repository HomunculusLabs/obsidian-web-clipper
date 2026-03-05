// Pass state: All save trigger wiring present for markitdown priority brief

import type {
  RuntimeRequest,
  RefreshMarkitdownConversionPriorityBriefResponse,
} from "../shared/messages";
import type { Settings } from "../shared/settings";
import { runtimeSendMessage } from "../shared/chromeAsync";

async function refreshMarkitdownConversionPriorityBrief(
  settings: Settings,
  vault: string
): Promise<void> {
  if (!settings.obsidianCli?.enabled || !settings.obsidianCli.cliPath) {
    return;
  }
  try {
    await runtimeSendMessage<RuntimeRequest, RefreshMarkitdownConversionPriorityBriefResponse>({
      action: "refreshMarkitdownConversionPriorityBrief",
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

  // Fire-and-forget invocation
  void refreshMarkitdownConversionPriorityBrief(settings, vault);

  return;
}
