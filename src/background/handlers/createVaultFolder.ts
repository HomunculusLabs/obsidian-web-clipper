import type { CreateVaultFolderResponse } from "../../shared/messages";

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

  return {
    success: false,
    error:
      "Creating folders via CLI requires a Native Messaging bridge. Add the folder in Obsidian or settings for now.",
    requiresBridge: true
  };
}
