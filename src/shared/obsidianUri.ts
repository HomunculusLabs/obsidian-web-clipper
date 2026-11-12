import { ClipboardError, toErrorMessage } from "./errors";

export const MAX_OBSIDIAN_URI_CONTENT_CHARS = 180_000;

function encodeValue(value: string): string {
  return encodeURIComponent(value);
}

export function buildObsidianBaseUri(vault: string, filePath: string): string {
  return `obsidian://new?vault=${encodeValue(vault)}&file=${encodeValue(filePath)}`;
}

export function buildObsidianContentUri(
  vault: string,
  filePath: string,
  content: string
): string {
  return `${buildObsidianBaseUri(vault, filePath)}&content=${encodeValue(content)}`;
}

export function buildObsidianClipboardUri(vault: string, filePath: string): string {
  return `${buildObsidianBaseUri(vault, filePath)}&clipboard`;
}

export function isContentTooLargeForObsidianUri(content: string): boolean {
  return encodeValue(content).length > MAX_OBSIDIAN_URI_CONTENT_CHARS;
}

export type OpenObsidianUriResult = {
  success: boolean;
  error?: string;
};

export type ClipboardObsidianHandoffResult =
  | {
      success: true;
      openedObsidian: boolean;
      error?: string;
    }
  | {
      success: false;
      error: string;
    };

export async function handoffClipboardToObsidian(options: {
  content: string;
  vault: string;
  filePath: string;
  clipboard?: Pick<Clipboard, "writeText">;
  openObsidianUri?: (uri: string) => Promise<OpenObsidianUriResult>;
}): Promise<ClipboardObsidianHandoffResult> {
  const clipboard =
    options.clipboard ??
    ((typeof navigator !== "undefined" ? navigator.clipboard : undefined) as
      | Pick<Clipboard, "writeText">
      | undefined);

  if (!clipboard?.writeText) {
    return {
      success: false,
      error: new ClipboardError(
        "Clipboard API unavailable in this context",
        "CLIPBOARD_UNAVAILABLE"
      ).message
    };
  }

  try {
    await clipboard.writeText(options.content);
  } catch (err) {
    return {
      success: false,
      error: toErrorMessage(
        err,
        new ClipboardError("Clipboard write failed", "CLIPBOARD_WRITE_FAILED").message
      )
    };
  }

  if (!options.openObsidianUri) {
    return { success: true, openedObsidian: false };
  }

  try {
    const uri = buildObsidianClipboardUri(options.vault, options.filePath);
    const openResult = await options.openObsidianUri(uri);
    if (!openResult.success) {
      return {
        success: true,
        openedObsidian: false,
        error: openResult.error || "Failed to open Obsidian URI"
      };
    }

    return { success: true, openedObsidian: true };
  } catch (err) {
    return {
      success: true,
      openedObsidian: false,
      error: toErrorMessage(err, "Failed to open Obsidian URI")
    };
  }
}
