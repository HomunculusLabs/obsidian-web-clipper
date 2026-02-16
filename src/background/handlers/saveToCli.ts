/**
 * Handler for saving content via Obsidian CLI.
 *
 * MV3 service workers cannot spawn local processes, so this uses a Native
 * Messaging bridge host that executes the CLI call on the local machine.
 */

import type { SaveToCliResponse } from "../../shared/messages";
import { sendNativeBridgeMessage } from "../nativeMessaging";

interface SaveToCliRequest {
  action: "saveToCli";
  filePath: string;
  content: string;
  vault: string;
  cliPath: string;
}

export async function handleSaveToCli(request: SaveToCliRequest): Promise<SaveToCliResponse> {
  const { cliPath, vault, filePath, content } = request;

  if (!cliPath || cliPath.trim() === "") {
    return { success: false, error: "CLI path is not configured", requiresBridge: true };
  }

  if (!vault || vault.trim() === "") {
    return { success: false, error: "Vault name is not configured", requiresBridge: true };
  }

  if (!filePath || filePath.trim() === "") {
    return { success: false, error: "File path is required" };
  }

  if (!content || content.trim() === "") {
    return { success: false, error: "Content is required" };
  }

  const bridgeResponse = await sendNativeBridgeMessage<unknown>({
    action: "saveToCli",
    payload: {
      cliPath,
      vault,
      filePath,
      content
    }
  });

  if (!bridgeResponse.success) {
    return {
      success: false,
      error: bridgeResponse.error,
      requiresBridge: true
    };
  }

  return { success: true };
}
