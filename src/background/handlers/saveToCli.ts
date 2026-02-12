/**
 * Handler for saving content via Obsidian CLI.
 *
 * NOTE: Manifest V3 service workers cannot spawn local processes directly.
 * This handler returns an error indicating the bridge is required.
 * Full CLI integration requires a Native Messaging host (Task E2).
 *
 * For CLI tools (Bun/Node environment), use saveViaCli from obsidianCliSave.ts directly.
 */

import type { SaveToCliResponse } from "../../shared/messages";

interface SaveToCliRequest {
  action: "saveToCli";
  filePath: string;
  content: string;
  vault: string;
  cliPath: string;
}

/**
 * Attempt to save via CLI.
 *
 * In MV3 extension context, this always fails because service workers cannot spawn processes.
 * A Native Messaging host or local companion service is required for actual CLI saves.
 *
 * @returns SaveToCliResponse indicating failure and that a bridge is required
 */
export async function handleSaveToCli(request: SaveToCliRequest): Promise<SaveToCliResponse> {
  const { cliPath, vault, filePath } = request;

  // Validate inputs
  if (!cliPath || cliPath.trim() === "") {
    return { success: false, error: "CLI path is not configured", requiresBridge: true };
  }

  if (!vault || vault.trim() === "") {
    return { success: false, error: "Vault name is not configured", requiresBridge: true };
  }

  if (!filePath || filePath.trim() === "") {
    return { success: false, error: "File path is required" };
  }

  // MV3 limitation: service workers cannot spawn local processes
  // A Native Messaging host is required for actual CLI execution
  return {
    success: false,
    error: "CLI save requires a Native Messaging host. This feature is not yet available in the extension. Use URI or clipboard method instead.",
    requiresBridge: true
  };
}
