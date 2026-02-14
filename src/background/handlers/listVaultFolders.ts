import type { ListVaultFoldersResponse } from "../../shared/messages";

type ListVaultFoldersRequest = {
  action: "listVaultFolders";
  vault: string;
  cliPath: string;
};

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

  return {
    success: false,
    error:
      "Listing vault folders requires a Native Messaging bridge. Configure folders manually in settings for now.",
    requiresBridge: true
  };
}
