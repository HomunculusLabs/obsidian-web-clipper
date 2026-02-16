import type { ClipResult, PageType } from "../shared/types";
import type {
  RuntimeRequest,
  SaveAttachmentToCliResponse,
  SaveToCliResponse
} from "../shared/messages";
import type { Settings } from "../shared/settings";
import { DEFAULT_SETTINGS } from "../shared/settings";
import type { SaveMethod } from "../shared/obsidianCli";
import { runtimeSendMessage } from "../shared/chromeAsync";
import { buildClipMarkdown } from "../shared/markdown";
import { injectWikiLinks } from "../content/web/wikiLinks";
import { buildFrontmatterFromClip } from "../shared/buildFrontmatter";
import { sanitizeFilename } from "../shared/sanitize";
import { recordTagUsage } from "../shared/tagHistory";
import { SaveError } from "../shared/errors";
import { showClipSavedNotification } from "../shared/notifications";
import { incrementBadgeCounter } from "../shared/badgeCounter";
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
  usedMethod: SaveMethod;
};

type OpenUriResponse = { success: boolean; error?: string };

/**
 * Prepared data for saving
 */
interface PreparedSave {
  markdown: string;
  encodedContent: string;
  filePath: string;
  vault: string;
  baseObsidianUri: string;
  contentTooLargeForUri: boolean;
  tags: string[];
}

type MarkdownImageMatch = {
  start: number;
  end: number;
  altText: string;
  url: string;
  title?: string;
};

type ImageDownloadStats = {
  total: number;
  downloaded: number;
  failed: number;
};

const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)/g;

function findMarkdownImages(markdown: string): MarkdownImageMatch[] {
  const matches: MarkdownImageMatch[] = [];

  for (const match of markdown.matchAll(MARKDOWN_IMAGE_REGEX)) {
    const full = match[0];
    const altText = match[1] || "";
    const rawUrl = match[2] || "";
    const title = match[3] || undefined;
    const start = match.index ?? -1;

    if (!full || start < 0) continue;

    const url = rawUrl.replace(/^<|>$/g, "");

    matches.push({
      start,
      end: start + full.length,
      altText,
      url,
      title
    });
  }

  return matches;
}

function getImageExtension(contentType: string | null, url: string): string {
  const normalizedType = (contentType || "").toLowerCase().split(";")[0]?.trim();
  const extFromType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/avif": "avif"
  };

  if (normalizedType && extFromType[normalizedType]) {
    return extFromType[normalizedType];
  }

  try {
    const parsed = new URL(url);
    const path = parsed.pathname || "";
    const extMatch = path.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (extMatch?.[1]) {
      return extMatch[1].toLowerCase();
    }
  } catch {
    // ignore URL parse errors; use fallback extension
  }

  return "img";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function rewriteImagesForDownloadApi(
  markdown: string,
  settings: Settings,
  vault: string
): Promise<{ markdown: string; stats: ImageDownloadStats }> {
  const images = findMarkdownImages(markdown);

  if (images.length === 0) {
    return {
      markdown,
      stats: { total: 0, downloaded: 0, failed: 0 }
    };
  }

  const cliPath = (settings.obsidianCli?.cliPath || "").trim();
  if (!settings.obsidianCli?.enabled || !cliPath) {
    return {
      markdown,
      stats: { total: images.length, downloaded: 0, failed: images.length }
    };
  }

  const attachmentsFolder = (settings.imageAttachmentsFolder || "attachments")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");

  const replacements = new Map<MarkdownImageMatch, string>();
  const urlCache = new Map<string, string>();

  let downloaded = 0;
  let failed = 0;

  for (let i = 0; i < images.length; i += 1) {
    const image = images[i]!;
    const isHttpImage = /^https?:\/\//i.test(image.url);

    if (!isHttpImage) {
      failed += 1;
      continue;
    }

    if (urlCache.has(image.url)) {
      replacements.set(image, urlCache.get(image.url)!);
      downloaded += 1;
      continue;
    }

    try {
      const response = await fetch(image.url);
      if (!response.ok) {
        failed += 1;
        continue;
      }

      const contentType = response.headers.get("content-type");
      const imageBytes = new Uint8Array(await response.arrayBuffer());
      if (imageBytes.length === 0) {
        failed += 1;
        continue;
      }

      const extension = getImageExtension(contentType, image.url);
      const baseName = sanitizeFilename(`image-${i + 1}`, 80).replace(/\.[^.]+$/, "");
      const fileName = `${baseName}.${extension}`;
      const attachmentPath = attachmentsFolder
        ? `${attachmentsFolder}/${fileName}`
        : fileName;

      const saveResult = await runtimeSendMessage<RuntimeRequest, SaveAttachmentToCliResponse>({
        action: "saveAttachmentToCli",
        filePath: attachmentPath,
        base64Data: toBase64(imageBytes),
        vault,
        cliPath,
        mimeType: contentType || undefined
      });

      if (!saveResult?.success) {
        failed += 1;
        continue;
      }

      replacements.set(image, attachmentPath);
      urlCache.set(image.url, attachmentPath);
      downloaded += 1;
    } catch {
      failed += 1;
    }
  }

  if (replacements.size === 0) {
    return {
      markdown,
      stats: { total: images.length, downloaded, failed }
    };
  }

  const rewritten = images
    .slice()
    .reverse()
    .reduce((acc, image) => {
      const replacementUrl = replacements.get(image);
      if (!replacementUrl) return acc;

      const rebuilt = image.title
        ? `![${image.altText}](${replacementUrl} "${image.title}")`
        : `![${image.altText}](${replacementUrl})`;

      return `${acc.slice(0, image.start)}${rebuilt}${acc.slice(image.end)}`;
    }, markdown);

  return {
    markdown: rewritten,
    stats: { total: images.length, downloaded, failed }
  };
}

function getNoteTitleFromFilePath(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  const lastPart = parts[parts.length - 1] || "Untitled";
  return lastPart.trim() || "Untitled";
}

/**
 * Build the frontmatter and markdown content for the clip
 */
async function prepareSave(options: SaveOptions): Promise<PreparedSave> {
  const { result, settings } = options;

  // Build frontmatter using the extracted module
  const { frontmatter, filePath, tags } = buildFrontmatterFromClip(options);

  const vault = (settings.vaultName || DEFAULT_SETTINGS.vaultName).trim() || "Main Vault";

  // Build markdown and apply wiki-link injection if enabled
  const rawMarkdown = buildClipMarkdown(frontmatter, result.markdown || "");
  const wikiLinkedMarkdown = injectWikiLinks(rawMarkdown, settings);

  const imageProcessed =
    settings.imageHandling === "download-api"
      ? await rewriteImagesForDownloadApi(wikiLinkedMarkdown, settings, vault)
      : { markdown: wikiLinkedMarkdown, stats: { total: 0, downloaded: 0, failed: 0 } };

  if (settings.imageHandling === "download-api" && imageProcessed.stats.total > 0) {
    if (imageProcessed.stats.downloaded > 0 && imageProcessed.stats.failed === 0) {
      showStatus(
        "loading",
        `Downloaded ${imageProcessed.stats.downloaded} image${imageProcessed.stats.downloaded === 1 ? "" : "s"} to attachments`
      );
    } else if (imageProcessed.stats.downloaded > 0 && imageProcessed.stats.failed > 0) {
      showStatus(
        "loading",
        `Downloaded ${imageProcessed.stats.downloaded}/${imageProcessed.stats.total} images to attachments`
      );
    }
  }

  const markdown = imageProcessed.markdown;
  const encodedContent = encodeURIComponent(markdown);

  const baseObsidianUri = `obsidian://new?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(
    filePath
  )}`;

  const contentTooLargeForUri = encodedContent.length > MAX_URI_CONTENT_CHARS;

  return {
    markdown,
    encodedContent,
    filePath,
    vault,
    baseObsidianUri,
    contentTooLargeForUri,
    tags
  };
}

/**
 * Save via Obsidian CLI (requires Native Messaging bridge)
 */
async function saveViaCli(
  prepared: PreparedSave,
  settings: Settings
): Promise<{ success: boolean; error?: string }> {
  const cliConfig = settings.obsidianCli;

  // Check if CLI is configured and enabled
  if (!cliConfig?.enabled) {
    return { success: false, error: "CLI integration is not enabled" };
  }

  if (!cliConfig.cliPath) {
    return { success: false, error: "CLI path is not configured" };
  }

  const vault = cliConfig.vault || prepared.vault;

  const response = await runtimeSendMessage<RuntimeRequest, SaveToCliResponse>({
    action: "saveToCli",
    filePath: prepared.filePath,
    content: prepared.markdown,
    vault,
    cliPath: cliConfig.cliPath
  });

  if (!response?.success) {
    return { success: false, error: response?.error || "CLI save failed" };
  }

  return { success: true };
}

/**
 * Save via Obsidian URI scheme
 */
async function saveViaUri(prepared: PreparedSave): Promise<{ success: boolean; error?: string }> {
  // If content is too large, we can't use URI
  if (prepared.contentTooLargeForUri) {
    return { success: false, error: "Content too large for URI" };
  }

  const obsidianUri = `${prepared.baseObsidianUri}&content=${prepared.encodedContent}`;

  const response = await runtimeSendMessage<RuntimeRequest, OpenUriResponse>({
    action: "openObsidianUri",
    uri: obsidianUri
  });

  if (!response?.success) {
    return { success: false, error: response?.error || "Failed to open Obsidian URI" };
  }

  return { success: true };
}

/**
 * Copy content to clipboard and optionally open Obsidian
 */
async function saveViaClipboard(
  prepared: PreparedSave,
  openObsidian: boolean = true
): Promise<{ success: boolean; error?: string }> {
  await runtimeSendMessage<RuntimeRequest, unknown>({
    action: "copyToClipboard",
    data: prepared.markdown
  });

  if (openObsidian) {
    // Best-effort: open Obsidian without content so the user can paste
    try {
      await runtimeSendMessage<RuntimeRequest, OpenUriResponse>({
        action: "openObsidianUri",
        uri: prepared.baseObsidianUri
      });
    } catch {
      // Ignore; clipboard copy already succeeded
    }
  }

  return { success: true };
}

/**
 * Main save function with method routing and fallback chain.
 *
 * Fallback chain: CLI → URI → clipboard
 *
 * The save method is determined by settings.saveMethod:
 * - "cli": Try CLI first, fall back to URI, then clipboard
 * - "uri": Try URI first, fall back to clipboard
 * - "clipboard": Copy directly to clipboard
 */
export async function saveToObsidian(options: SaveOptions): Promise<SaveResult> {
  const { settings } = options;
  const prepared = await prepareSave(options);
  const saveMethod = settings.saveMethod || DEFAULT_SETTINGS.saveMethod || "uri";

  // Determine the order of methods to try based on configured saveMethod
  const methodOrder: SaveMethod[] = [];
  if (saveMethod === "cli") {
    methodOrder.push("cli", "uri", "clipboard");
  } else if (saveMethod === "uri") {
    methodOrder.push("uri", "clipboard");
  } else {
    methodOrder.push("clipboard");
  }

  let lastError: string | undefined;

  for (const method of methodOrder) {
    let result: { success: boolean; error?: string };

    try {
      if (method === "cli") {
        // Only try CLI if it's configured
        if (!settings.obsidianCli?.enabled) {
          continue;
        }
        result = await saveViaCli(prepared, settings);
      } else if (method === "uri") {
        result = await saveViaUri(prepared);
      } else {
        result = await saveViaClipboard(prepared, true);
      }

      if (result.success) {
        const usedClipboardFallback = method === "clipboard" && saveMethod !== "clipboard";
        
        if (method === "clipboard") {
          if (prepared.contentTooLargeForUri) {
            showStatus(
              "success",
              "Content copied to clipboard (too large for Obsidian URI). Paste into a new note."
            );
          } else if (saveMethod !== "clipboard") {
            showStatus(
              "success",
              "Content copied to clipboard (fallback). Paste into a new note."
            );
          } else {
            showStatus(
              "success",
              "Content copied to clipboard. Paste into a new note."
            );
          }
        } else if (method === "cli") {
          showStatus("success", "Saved to Obsidian via CLI.");
        } else {
          showStatus("success", "Saved to Obsidian.");
        }

        // Record tag usage in history (fire-and-forget)
        if (prepared.tags.length > 0) {
          void recordTagUsage(prepared.tags);
        }

        void showClipSavedNotification(
          settings,
          getNoteTitleFromFilePath(prepared.filePath),
          prepared.vault
        );
        void incrementBadgeCounter(settings);

        return { usedClipboardFallback, usedMethod: method };
      }

      lastError = result.error;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // All methods failed
  throw new SaveError(lastError || "Failed to save to Obsidian", "SAVE_ALL_METHODS_FAILED");
}
