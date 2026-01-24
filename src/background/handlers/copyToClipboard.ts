import { toErrorMessage } from "../../shared/errors";
import type { RuntimeRequest } from "../../shared/messages";

export type CopyToClipboardResponse = { success: boolean; error?: string };

type CopyRequest = Extract<RuntimeRequest, { action: "copyToClipboard" }>;

async function bestEffortClipboardWrite(text: string): Promise<void> {
  const clipboard = (typeof navigator !== "undefined" ? navigator.clipboard : undefined) as Clipboard | undefined;
  if (!clipboard) {
    throw new Error("Clipboard API is unavailable in this service worker context");
  }
  await clipboard.writeText(text);
}

export async function handleCopyToClipboard(request: CopyRequest): Promise<CopyToClipboardResponse> {
  try {
    await bestEffortClipboardWrite(request.data);
    return { success: true };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Clipboard write failed") };
  }
}