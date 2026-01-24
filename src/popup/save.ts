import type { ClipResult, PageType } from "../shared/types";
import type { RuntimeRequest } from "../shared/messages";
import type { Settings } from "../shared/settings";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { runtimeSendMessage } from "../shared/chromeAsync";
import { buildClipMarkdown, type FrontmatterInput } from "../shared/markdown";
import { sanitizeFilename } from "../shared/sanitize";
import { parseTags, addAutoTags } from "../shared/tags";
import { showStatus } from "./ui";

const MAX_URI_CONTENT_CHARS = 180000;

export type SaveOptions = {
  result: ClipResult;
  settings: Settings;
  pageType: PageType;
  currentTabUrl: string;
  overrideTitle?: string;
  overrideFolder?: string;
  overrideTags?: string;
};

export type SaveResult = {
  usedClipboardFallback: boolean;
};

type OpenUriResponse = { success: boolean; error?: string };

export async function saveToObsidian(options: SaveOptions): Promise<SaveResult> {
  const { result, settings, pageType, currentTabUrl, overrideTitle, overrideFolder, overrideTags } = options;

  const finalTitle = sanitizeFilename(
    (overrideTitle || "").trim() || result.title || "Untitled"
  );

  const folder = (
    overrideFolder || settings.defaultFolder || DEFAULT_SETTINGS.defaultFolder
  ).trim();

  const rawTags =
    (overrideTags || "").trim() ||
    (settings.defaultTags || DEFAULT_SETTINGS.defaultTags || "").trim();

  const tags = addAutoTags(parseTags(rawTags), pageType);

  const filePath = folder ? `${folder}/${finalTitle}` : finalTitle;

  const frontmatter: FrontmatterInput = {
    source: result.metadata?.url || result.url || currentTabUrl,
    title: finalTitle,
    type: result.metadata?.type || "article",
    dateClippedISO: new Date().toISOString(),
    tags,
    author: result.metadata?.author,
    channel: result.metadata?.channel,
    duration: result.metadata?.duration,
    videoType: result.metadata?.videoType,
    extra: {
      published_date: result.metadata?.publishedDate || undefined,
      description: result.metadata?.description || undefined,
      paywalled: result.metadata?.paywalled,
      password_protected: result.metadata?.passwordProtected,
      scanned_pdf: result.metadata?.scannedPDF,
      truncated: result.metadata?.truncated,
      page_type: pageType
    }
  };

  const markdown = buildClipMarkdown(frontmatter, result.markdown || "");
  const encodedContent = encodeURIComponent(markdown);

  const vault = (settings.vaultName || DEFAULT_SETTINGS.vaultName).trim() || "Main Vault";
  const baseObsidianUri = `obsidian://new?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(
    filePath
  )}`;

  if (encodedContent.length > MAX_URI_CONTENT_CHARS) {
    await runtimeSendMessage<RuntimeRequest, unknown>({
      action: "copyToClipboard",
      data: markdown
    });

    showStatus(
      "success",
      "Content copied to clipboard (too large for Obsidian URI). Paste into a new note."
    );

    // Best-effort: open Obsidian without content so the user can paste.
    try {
      await runtimeSendMessage<RuntimeRequest, OpenUriResponse>({
        action: "openObsidianUri",
        uri: baseObsidianUri
      });
    } catch {
      // Ignore; clipboard copy already succeeded.
    }

    return { usedClipboardFallback: true };
  }

  const obsidianUri = `${baseObsidianUri}&content=${encodedContent}`;

  const response = await runtimeSendMessage<RuntimeRequest, OpenUriResponse>({
    action: "openObsidianUri",
    uri: obsidianUri
  });

  if (!response?.success) {
    throw new Error(response?.error || "Failed to open Obsidian URI");
  }

  return { usedClipboardFallback: false };
}
