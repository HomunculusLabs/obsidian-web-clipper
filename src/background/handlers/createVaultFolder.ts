import type { CreateVaultFolderResponse } from "../../shared/messages";
import { sendNativeBridgeMessage } from "../nativeMessaging";

type CreateVaultFolderRequest = {
  action: "createVaultFolder";
  vault: string;
  cliPath: string;
  folderPath: string;
};

export async function handleCreateVaultFolder(
  request: CreateVaultFolderRequest
): Promise<CreateVaultFolderResponse> {
  const cliPath = request.cliPath?.trim();
  const vault = request.vault?.trim();
  const folderPath = request.folderPath?.trim();

  if (!cliPath) {
    return { success: false, error: "CLI path is not configured", requiresBridge: true };
  }

  if (!vault) {
    return { success: false, error: "Vault name is not configured", requiresBridge: true };
  }

  if (!folderPath) {
    return { success: false, error: "Folder path is required" };
  }

  const bridgeResponse = await sendNativeBridgeMessage<unknown>({
    action: "createVaultFolder",
    payload: {
      cliPath,
      vault,
      folderPath
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
    success: true
  };
}
