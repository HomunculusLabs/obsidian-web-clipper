import type { SaveAttachmentToCliResponse } from "../../shared/messages";

type SaveAttachmentToCliRequest = {
  action: "saveAttachmentToCli";
  filePath: string;
  base64Data: string;
  vault: string;
  cliPath: string;
  mimeType?: string;
};

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

  return {
    success: false,
    error:
      "Saving image attachments via CLI requires a Native Messaging bridge with binary payload support.",
    requiresBridge: true
  };
}
