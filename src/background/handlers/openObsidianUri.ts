import { tabsCreate } from "../../shared/chromeAsync";
import { toErrorMessage } from "../../shared/errors";
import type { RuntimeRequest } from "../../shared/messages";

export type OpenObsidianUriResponse = { success: boolean; error?: string };

type OpenUriRequest = Extract<RuntimeRequest, { action: "openObsidianUri" }>;

export async function handleOpenObsidianUri(request: OpenUriRequest): Promise<OpenObsidianUriResponse> {
  try {
    const tab = await tabsCreate({ url: request.uri });
    return { success: Boolean(tab) };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to open Obsidian URI") };
  }
}