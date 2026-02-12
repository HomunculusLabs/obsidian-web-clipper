import type { ClipResult, PageType } from "../shared/types";
import type { RuntimeRequest, SaveToCliResponse } from "../shared/messages";
import type { Settings } from "../shared/settings";
import { DEFAULT_SETTINGS } from "../shared/settings";
import type { SaveMethod } from "../shared/obsidianCli";
import { runtimeSendMessage } from "../shared/chromeAsync";
import { buildClipMarkdown, type FrontmatterInput } from "../shared/markdown";
import { injectWikiLinks } from "../content/web/wikiLinks";
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
}

/**
 * Build the frontmatter and markdown content for the clip
 */
function prepareSave(options: SaveOptions): PreparedSave {
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

  // Use canonical URL as source when available and enabled
  const source =
    settings.preferCanonicalUrl && result.metadata?.canonicalUrl
      ? result.metadata.canonicalUrl
      : result.metadata?.url || result.url || currentTabUrl;

  // Build extra frontmatter fields
  const extra: FrontmatterInput["extra"] = {
    published_date: result.metadata?.publishedDate || undefined,
    description: result.metadata?.description || undefined,
    paywalled: result.metadata?.paywalled,
    password_protected: result.metadata?.passwordProtected,
    scanned_pdf: result.metadata?.scannedPDF,
    truncated: result.metadata?.truncated,
    page_type: pageType
  };

  // Always include lightweight metadata if present
  if (result.metadata?.siteName) {
    extra.site_name = result.metadata.siteName;
  }
  if (result.metadata?.language) {
    extra.language = result.metadata.language;
  }

  // Include canonical URL separately for reference (when different from source)
  if (settings.preferCanonicalUrl && result.metadata?.canonicalUrl) {
    extra.canonical_url = result.metadata.canonicalUrl;
  }

  // Open Graph metadata (gated by settings)
  if (settings.includeOGFields && result.metadata?.og) {
    const og = result.metadata.og;
    extra.og_title = og.ogTitle;
    extra.og_description = og.ogDescription;
    extra.og_image = og.ogImage;
    extra.og_images = og.ogImages;
    extra.og_url = og.ogUrl;
    extra.og_type = og.ogType;
    extra.og_site_name = og.ogSiteName;
    extra.og_locale = og.ogLocale;
  }

  // Twitter Card metadata (gated by settings)
  if (settings.includeTwitterFields && result.metadata?.twitter) {
    const tw = result.metadata.twitter;
    extra.twitter_card = tw.twitterCard;
    extra.twitter_title = tw.twitterTitle;
    extra.twitter_description = tw.twitterDescription;
    extra.twitter_image = tw.twitterImage;
    extra.twitter_site = tw.twitterSite;
    extra.twitter_creator = tw.twitterCreator;
  }

  // JSON-LD structured data (gated by settings)
  if (settings.parseJsonLd && result.metadata?.jsonLd) {
    const jld = result.metadata.jsonLd;
    extra.jsonld_schema_type = jld.schemaType;
    extra.jsonld_headline = jld.headline;
    extra.jsonld_description = jld.description;
    extra.jsonld_author = jld.author; // string | string[]
    extra.jsonld_publisher = jld.publisher;
    extra.jsonld_keywords = jld.keywords; // string[]
    extra.jsonld_section = jld.articleSection;
    extra.jsonld_date_published = jld.datePublished;
    extra.jsonld_date_modified = jld.dateModified;
    extra.jsonld_word_count = jld.wordCount;
    extra.jsonld_image = jld.image; // string | string[]
  }

  // Keywords from meta tags (gated by settings)
  if (settings.includeKeywords && result.metadata?.keywords?.length) {
    extra.keywords = result.metadata.keywords;
  }

  // Reading statistics (gated by settings)
  if (settings.computeReadingStats && result.metadata?.readingStats) {
    const rs = result.metadata.readingStats;
    extra.reading_word_count = rs.wordCount;
    extra.reading_char_count = rs.charCount;
    extra.reading_time_minutes = rs.estimatedReadingTimeMinutes;
  }

  const frontmatter: FrontmatterInput = {
    source,
    title: finalTitle,
    type: result.metadata?.type || "article",
    dateClippedISO: new Date().toISOString(),
    tags,
    author: result.metadata?.author,
    channel: result.metadata?.channel,
    duration: result.metadata?.duration,
    videoType: result.metadata?.videoType,
    extra
  };

  // Build markdown and apply wiki-link injection if enabled
  const rawMarkdown = buildClipMarkdown(frontmatter, result.markdown || "");
  const markdown = injectWikiLinks(rawMarkdown, settings);
  const encodedContent = encodeURIComponent(markdown);

  const vault = (settings.vaultName || DEFAULT_SETTINGS.vaultName).trim() || "Main Vault";
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
    contentTooLargeForUri
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
  const prepared = prepareSave(options);
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

        return { usedClipboardFallback, usedMethod: method };
      }

      lastError = result.error;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // All methods failed
  throw new Error(lastError || "Failed to save to Obsidian");
}
