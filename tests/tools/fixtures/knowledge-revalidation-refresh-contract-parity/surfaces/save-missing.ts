// Missing state: No knowledge-revalidation save triggers

import type { Settings } from "../shared/settings";

async function refreshContradictionInbox(
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
  
  // Only existing refresh calls - no knowledge-revalidation triggers
  void refreshContradictionInbox(settings, vault);
  
  return { usedClipboardFallback: false, usedMethod: "cli" };
}
