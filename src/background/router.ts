import { isRuntimeRequest } from "../shared/guards";
import type { RuntimeRequest } from "../shared/messages";

import { handleGetSettings } from "./handlers/getSettings";
import { handleCopyToClipboard } from "./handlers/copyToClipboard";
import { handleOpenObsidianUri } from "./handlers/openObsidianUri";
import { handleExtractPdf } from "./handlers/extractPdf";
import { handleTestCliConnection } from "./handlers/testCliConnection";

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
    default:
      throw new Error(`Unknown action: ${(request as any).action}`);
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