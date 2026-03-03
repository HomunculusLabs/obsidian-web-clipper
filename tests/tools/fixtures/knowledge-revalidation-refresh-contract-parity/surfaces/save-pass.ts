// Pass state: All save triggers present

import type { Settings } from "../shared/settings";

async function refreshKnowledgeRevalidationInbox(
  settings: Settings,
  vault: string
): Promise<void> {
  if (!settings.obsidianCli?.enabled || !settings.obsidianCli.cliPath) {
    return;
  }
  // Implementation...
}

async function refreshKnowledgeRevalidationStateSync(
  settings: Settings,
  vault: string
): Promise<void> {
  if (!settings.obsidianCli?.enabled || !settings.obsidianCli.cliPath) {
    return;
  }
  // Implementation...
}

export async function saveToObsidian(options: SaveOptions): Promise<SaveResult> {
  // ... existing save logic ...
  
  // Fire-and-forget refresh calls
  void refreshKnowledgeRevalidationInbox(settings, vault);
  void refreshKnowledgeRevalidationStateSync(settings, vault);
  
  return { usedClipboardFallback: false, usedMethod: "cli" };
}
