import { isRuntimeRequest } from "../shared/guards";
import type { RuntimeRequest } from "../shared/messages";
import { RouterError } from "../shared/errors";

import { handleGetSettings } from "./handlers/getSettings";
import { handleCopyToClipboard } from "./handlers/copyToClipboard";
import { handleOpenObsidianUri } from "./handlers/openObsidianUri";
import { handleExtractPdf } from "./handlers/extractPdf";
import { handleTestCliConnection } from "./handlers/testCliConnection";
import { handleDetectCli } from "./handlers/detectCli";
import { handleSaveToCli } from "./handlers/saveToCli";
import { handleListVaultFolders } from "./handlers/listVaultFolders";
import { handleCreateVaultFolder } from "./handlers/createVaultFolder";
import { handleSaveContent } from "./handlers/saveContent";

export async function dispatch(request: RuntimeRequest): Promise<unknown> {
  switch (request.action) {
    case "getSettings":
      return handleGetSettings();
    case "copyToClipboard":
      return handleCopyToClipboard(request);
    case "openObsidianUri":
      return handleOpenObsidianUri(request);
    case "extractPdf":
      return handleExtractPdf(request);
    case "testCliConnection":
      return handleTestCliConnection(request);
    case "detectCli":
      return handleDetectCli(request);
    case "saveToCli":
      return handleSaveToCli(request);
    case "listVaultFolders":
      return handleListVaultFolders(request);
    case "createVaultFolder":
      return handleCreateVaultFolder(request);
    case "saveContent":
      return handleSaveContent(request);
    default: {
      // Exhaustive check: this will fail to compile if any case is missing
      const _exhaustive: never = request;
      throw new RouterError(`Unknown action: ${(_exhaustive as { action: string }).action}`, "UNKNOWN_ACTION");
    }
  }
}

export function handleRuntimeMessage(
  request: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): boolean {
  if (!isRuntimeRequest(request)) {
    return false;
  }

  void dispatch(request)
    .then(sendResponse)
    .catch((err: unknown) => {
      console.error("runtime.onMessage handler failed:", err);
      try {
        sendResponse({ success: false, error: "Unhandled background error" });
      } catch {
        // ignore
      }
    });

  return true; // Keep channel open for async
}