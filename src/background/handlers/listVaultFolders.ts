import type { ListVaultFoldersResponse } from "../../shared/messages";
import { sendNativeBridgeMessage } from "../nativeMessaging";

type ListVaultFoldersRequest = {
  action: "listVaultFolders";
  vault: string;
  cliPath: string;
};

type ListVaultFoldersBridgeData = {
  folders?: unknown;
};

function normalizeFolders(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const folders = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return folders;
}

export async function handleListVaultFolders(
  request: ListVaultFoldersRequest
): Promise<ListVaultFoldersResponse> {
  const cliPath = request.cliPath?.trim();
  const vault = request.vault?.trim();

  if (!cliPath) {
    return { success: false, error: "CLI path is not configured", requiresBridge: true };
  }

  if (!vault) {
    return { success: false, error: "Vault name is not configured", requiresBridge: true };
  }

  const bridgeResponse = await sendNativeBridgeMessage<ListVaultFoldersBridgeData>({
    action: "listVaultFolders",
    payload: {
      cliPath,
      vault
    }
  });

  if (!bridgeResponse.success) {
    return {
      success: false,
      error: bridgeResponse.error,
      requiresBridge: true
    };
  }

  const folders = normalizeFolders(bridgeResponse.data?.folders);
  if (!folders) {
    return {
      success: false,
      error: "Native bridge returned an invalid folder list",
      requiresBridge: true
    };
  }

  return {
    success: true,
    folders
  };
}
