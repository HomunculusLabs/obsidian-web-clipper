import type { SaveAttachmentToCliResponse } from "../../shared/messages";
import { sendNativeBridgeMessage } from "../nativeMessaging";

type SaveAttachmentToCliRequest = {
  action: "saveAttachmentToCli";
  filePath: string;
  base64Data: string;
  vault: string;
  cliPath: string;
  mimeType?: string;
};

type SaveAttachmentBridgeData = {
  filePath?: unknown;
  savedPath?: unknown;
};

function getReturnedFilePath(data: SaveAttachmentBridgeData | undefined, fallback: string): string {
  const fromFilePath = typeof data?.filePath === "string" ? data.filePath.trim() : "";
  if (fromFilePath) return fromFilePath;

  const fromSavedPath = typeof data?.savedPath === "string" ? data.savedPath.trim() : "";
  if (fromSavedPath) return fromSavedPath;

  return fallback;
}

export async function handleSaveAttachmentToCli(
  request: SaveAttachmentToCliRequest
): Promise<SaveAttachmentToCliResponse> {
  const cliPath = request.cliPath?.trim();
  const vault = request.vault?.trim();
  const filePath = request.filePath?.trim();
  const base64Data = request.base64Data?.trim();

  if (!cliPath) {
    return { success: false, error: "CLI path is not configured", requiresBridge: true };
  }

  if (!vault) {
    return { success: false, error: "Vault name is not configured", requiresBridge: true };
  }

  if (!filePath) {
    return { success: false, error: "Attachment file path is required" };
  }

  if (!base64Data) {
    return { success: false, error: "Attachment data is empty" };
  }

  const bridgeResponse = await sendNativeBridgeMessage<SaveAttachmentBridgeData>({
    action: "saveAttachmentToCli",
    payload: {
      cliPath,
      vault,
      filePath,
      base64Data,
      mimeType: request.mimeType?.trim() || undefined
    }
  });

  if (!bridgeResponse.success) {
    return {
      success: false,
      error: bridgeResponse.error,
      requiresBridge: true
    };
  }

  return {
    success: true,
    filePath: getReturnedFilePath(bridgeResponse.data, filePath)
  };
}
