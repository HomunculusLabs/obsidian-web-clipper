import TurndownService from "turndown";
import { Readability } from "@mozilla/readability";

import type { ClipResult, PageType, YouTubeVideoType } from "../shared/types";
import type { PageInfo, TabRequest, TabResponse } from "../shared/messages";

type ClipRequest = Extract<TabRequest, { action: "clip" }>;

interface YouTubeVideoInfo {
  title: string;
  channel: string;
  duration: string;
}

interface TranscriptSegment {
  utf8: string;
}

export interface TranscriptEvent {
  tStartMs: number;
  segs?: TranscriptSegment[];
}

interface YouTubeVideoTypeCheck {
  type: YouTubeVideoType;
  supported: boolean;
  message?: string;
}

// Initialize Turndown service at module load (bundled)
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_"
});

// Add custom rules for better markdown conversion
turndownService.addRule("strikethrough", {
  filter: (node: HTMLElement) => ["DEL", "S", "STRIKE"].includes(node.tagName),
  replacement: (content: string) => `~~${content}~~`
});

// Handle images with alt text
turndownService.addRule("images", {
  filter: "img",
  replacement: (_content: string, node: HTMLElement) => {
    const img = node as HTMLImageElement;
    const alt = img.alt || "";
    const src = img.src || "";
    const title = img.title || "";
    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  }
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || "Unknown error";
  if (typeof err === "string") return err;
  return "Unknown error";
}

function isTabRequest(value: unknown): value is TabRequest {
  if (!isObject(value)) return false;
  const action = value.action;
  return action === "clip" || action === "getPageInfo";
}

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener(
  (request: unknown, _sender: chrome.runtime.MessageSender, sendResponse) => {
    if (!isTabRequest(request)) return false;

    if (request.action === "clip") {
      void handleClip(request).then(sendResponse);
      return true;
    }

    if (request.action === "getPageInfo") {
      sendResponse(getPageInfo());
      return true;
    }

    return false;
  }
);

async function handleClip(request: ClipRequest): Promise<TabResponse> {
  const url = window.location.href;
  const detectedType = detectPageType(url);
  const pageType: PageType = request.pageType ?? detectedType;

  const title = document.title || "Untitled";

  const baseResult: ClipResult = {
    url,
    title,
    markdown: "",
    metadata: {
      url,
      title,
      type: "article"
    }
  };

  try {
    let result: ClipResult;

    switch (pageType) {
      case "youtube":
        result = await extractYouTubeContent(
          baseResult,
          request.includeTimestamps !== false
        );
        break;
      case "pdf":
        result = extractPDFContent(baseResult);
        break;
      case "web":
      default:
        result = extractWebPageContent(baseResult);
        break;
    }

    return { ok: true, result };
  } catch (error) {
    console.error("Clip error:", error);
    return { ok: false, error: getErrorMessage(error) };
  }
}

function detectPageType(url: string): PageType {
  // YouTube
  if (
    /^https?:\/\/(www\.)?youtube\.com\/watch/.test(url) ||
    /^https?:\/\/(www\.)?youtube\.com\/shorts/.test(url)
  ) {
    return "youtube";
  }

  // PDF
  if (
    /^https?:\/\/.*\.pdf(\?|$)/i.test(url) ||
    document.contentType === "application/pdf"
  ) {
    return "pdf";
  }

  // Default to web page
  return "web";
}

// Check YouTube video type and restrictions
function getYouTubeVideoType(): YouTubeVideoTypeCheck {
  const url = window.location.href;

  // Check for Shorts
  if (/^https?:\/\/(www\.)?youtube\.com\/shorts/.test(url)) {
    return { type: "shorts", supported: true };
  }

  // Check for live stream
  const isLive =
    document.querySelector(".ytp-live-badge") !== null ||
    document.querySelector("[data-live=\"true\"]") !== null ||
    (document.body.textContent || "").includes("Watching live");

  if (isLive) {
    return {
      type: "live",
      supported: false,
      message: "Live streams do not have transcripts available."
    };
  }

  // Check for age-restricted
  const isAgeRestricted =
    (document.body.textContent || "").includes("sign in to confirm your age") ||
    document.querySelector(".ytp-age-gate") !== null ||
    (document.querySelector("#account-container")?.textContent || "").includes(
      "age"
    );

  if (isAgeRestricted) {
    return {
      type: "age-restricted",
      supported: false,
      message:
        "This video is age-restricted and the transcript cannot be accessed."
    };
  }

  // Check for unavailable video
  const isUnavailable =
    (document.body.textContent || "").includes("This video is unavailable") ||
    (document.querySelector(".yt-alert-message")?.textContent || "").includes(
      "unavailable"
    );

  if (isUnavailable) {
    return {
      type: "unavailable",
      supported: false,
      message: "This video is unavailable or private."
    };
  }

  return { type: "normal", supported: true };
}

type ReadabilityArticleLike =
  | {
      title?: string;
      content?: string;
      textContent?: string;
      excerpt?: string;
      byline?: string;
      publishedTime?: string | null;
    }
  | null;

// Check if content appears to be paywalled
function isPaywalled(article: ReadabilityArticleLike, documentClone: Document): boolean {
  if (!article || !article.content) {
    return true;
  }

  // Check content length - very short content may indicate paywall
  const textContent = article.textContent || "";
  const textLength = textContent.trim().length;

  // Check for common paywall indicators
  const bodyText = documentClone.body?.textContent || "";
  const paywallIndicators = [
    "subscribe",
    "subscription",
    "premium",
    "paywall",
    "limited access",
    "create an account",
    "sign in to continue",
    "free trial",
    "upgrade to read",
    "member exclusive",
    "premium content"
  ];

  // Check if page has many paywall indicators
  let paywallSignCount = 0;
  const lowerBodyText = bodyText.toLowerCase();
  for (const indicator of paywallIndicators) {
    if (lowerBodyText.includes(indicator)) {
      paywallSignCount++;
    }
  }

  // Short content with paywall indicators
  if (textLength < 500 && paywallSignCount >= 2) {
    return true;
  }

  // Content significantly shorter than total page text
  if (bodyText.length > 2000 && textLength < bodyText.length * 0.1) {
    return true;
  }

  return false;
}

// Extract visible content as fallback for paywalled pages
function extractVisibleContent(): string {
  // Get main content areas
  const selectors = [
    "main",
    "article",
    "[role=\"main\"]",
    ".content",
    ".article-content",
    ".post-content",
    ".entry-content",
    "#content",
    "main p"
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const paragraphs = element.querySelectorAll(
        "p, h1, h2, h3, h4, h5, h6"
      );
      if (paragraphs.length > 2) {
        const content = Array.from(paragraphs)
          .map((p) => (p.textContent || "").trim())
          .filter((text) => text.length > 0)
          .join("\n\n");
        if (content.length > 200) {
          return content;
        }
      }
    }
  }

  // Last resort: get visible paragraphs from body
  const allParagraphs = document.querySelectorAll("body p");
  const visibleContent = Array.from(allParagraphs)
    .map((p) => (p.textContent || "").trim())
    .filter((text) => text.length > 50)
    .slice(0, 20) // Limit to first 20 paragraphs
    .join("\n\n");

  return visibleContent || "No extractable content found.";
}

// Extract web page content using Readability
function extractWebPageContent(result: ClipResult): ClipResult {
  const documentClone = document.cloneNode(true) as Document;

  const article = new Readability(documentClone, {
    charThreshold: 100
  }).parse() as ReadabilityArticleLike;

  // Check for paywall
  if (isPaywalled(article, documentClone)) {
    result.metadata.paywalled = true;

    // Try to get visible content as fallback
    const visibleContent = extractVisibleContent();

    result.markdown =
      `# ${result.title}\n\n` +
      `> ⚠️ **This page may be paywalled or have limited access.**\n` +
      `> The content below is extracted from the visible page text and may be incomplete.\n\n` +
      `---\n\n${visibleContent}`;

    return result;
  }

  if (!article || !article.content) {
    throw new Error("Could not extract article content");
  }

  // Add metadata
  result.metadata.author = (article.byline || "").trim();
  result.metadata.publishedDate = article.publishedTime || "";
  result.metadata.description = (article.excerpt || "").trim();

  // Convert HTML to markdown
  const markdown = turndownService.turndown(article.content);

  // Build final markdown with title and content
  const finalTitle = (article.title || result.title || "Untitled").trim();
  const excerpt = (article.excerpt || "").trim();

  result.markdown = `# ${finalTitle}\n\n${excerpt ? `> ${excerpt}\n\n` : ""}${markdown}`;

  return result;
}

// Extract YouTube transcript
async function extractYouTubeContent(
  result: ClipResult,
  includeTimestamps: boolean
): Promise<ClipResult> {
  result.metadata.type = "video";

  // Check video type and restrictions first
  const videoType = getYouTubeVideoType();

  // Get video info first
  const videoInfo = getYouTubeVideoInfo();

  result.metadata.channel = videoInfo.channel || "";
  result.metadata.duration = videoInfo.duration || "";
  result.metadata.title = videoInfo.title || result.title;
  result.metadata.videoType = videoType.type;

  // Handle unsupported video types
  if (!videoType.supported) {
    result.markdown =
      `# ${videoInfo.title || result.title}\n\n` +
      `**Channel:** ${videoInfo.channel || "Unknown"}\n` +
      `**Duration:** ${videoInfo.duration || "Unknown"}\n` +
      `**Type:** ${videoType.type}\n\n` +
      `> ⚠️ **Note:** ${videoType.message}\n\n` +
      `You can still save the video metadata for reference.`;
    return result;
  }

  const transcript = await getYouTubeTranscript();

  if (transcript) {
    result.markdown = formatTranscript(transcript, videoInfo, includeTimestamps);
  } else {
    result.markdown =
      `# ${videoInfo.title || result.title}\n\n` +
      `**Channel:** ${videoInfo.channel || "Unknown"}\n` +
      `**Duration:** ${videoInfo.duration || "Unknown"}\n\n` +
      `> ⚠️ **Transcript not available.** This video may not have captions enabled, or they may be disabled by the uploader.\n\n` +
      `You can still save the video metadata for reference.`;
  }

  return result;
}

// Get YouTube transcript from page data
async function getYouTubeTranscript(): Promise<TranscriptEvent[] | null> {
  try {
    // Method 1: Try yt-initial-player-response (most common location)
    const playerResponseText =
      document.querySelector("script#yt-initial-player-response")?.textContent ||
      null;

    if (playerResponseText) {
      const parsed = safeJsonParse(playerResponseText);
      if (parsed) {
        const result = await parseTranscriptFromConfig(parsed);
        if (result) return result;
      }
    }

    // Method 2: Try from ytInitialData (newer YouTube structure)
    const allScripts = Array.from(document.querySelectorAll("script"));
    const ytDataScript = allScripts.find((s) =>
      (s.textContent || "").includes("ytInitialData")
    );

    if (ytDataScript && ytDataScript.textContent) {
      const match = ytDataScript.textContent.match(
        /ytInitialData\s*=\s*([\s\S]+?);\s*(?:var|\/\*|window\.|const|let)/m
      );

      if (match) {
        const ytData = safeJsonParse(match[1]);
        if (ytData) {
          const captions =
            ytData?.playerOverlays?.playerOverlayRenderer
              ?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer?.playerBar
              ?.multiMarkersPlayerBarRenderer?.markersMap;

          if (captions) {
            const result = await parseTranscriptFromNewStructure(ytData);
            if (result) return result;
          }
        }
      }
    }

    // Method 3: Find ytInitialPlayerResponse in any script
    for (const script of allScripts) {
      const text = script.textContent || "";
      if (!text.includes("ytInitialPlayerResponse")) continue;

      const match = text.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]+?});/m);
      if (match) {
        const parsed = safeJsonParse(match[1]);
        if (parsed) {
          const result = await parseTranscriptFromConfig(parsed);
          if (result) return result;
        }
      }
    }

    // Method 4: Try to get from yt player config
    const ytConfigText =
      document.querySelector("div#player")?.getAttribute("data-config") || null;

    if (ytConfigText) {
      const parsed = safeJsonParse(ytConfigText);
      if (parsed) {
        const result = await parseTranscriptFromConfig(parsed);
        if (result) return result;
      }
    }

    return null;
  } catch (error) {
    console.error("Transcript extraction error:", error);
    return null;
  }
}

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Parse transcript from YouTube player config
async function parseTranscriptFromConfig(config: any): Promise<TranscriptEvent[] | null> {
  try {
    let tracks =
      config?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    // Newer structure path
    if (!tracks) {
      tracks =
        config?.playerResponse?.captions?.playerCaptionsTracklistRenderer
          ?.captionTracks;
    }

    // Another path for embed player
    if (!tracks) {
      tracks =
        config?.frameworkUpdates?.entityBatchUpdate?.mutations?.[0]?.payload
          ?.playerCaptionsTracklistRenderer?.captionTracks;
    }

    if (!Array.isArray(tracks) || tracks.length === 0) {
      return null;
    }

    // Prefer manual captions over auto-generated (better quality)
    const preferred =
      tracks.find((t: any) => t && t.kind !== "asr") || tracks[0];

    const baseUrl: string | undefined = preferred?.baseUrl;
    if (!baseUrl) return null;

    const response = await fetch(`${baseUrl}&fmt=json3`);
    const data = (await response.json()) as { events?: TranscriptEvent[] };

    const events = Array.isArray(data.events)
      ? data.events.filter((e) => Array.isArray(e.segs))
      : [];

    return events.length > 0 ? events : null;
  } catch (error) {
    console.error("Transcript parsing error:", error);
    return null;
  }
}

// Parse transcript from newer YouTube data structure
async function parseTranscriptFromNewStructure(ytData: any): Promise<TranscriptEvent[] | null> {
  try {
    const captions =
      ytData?.frameworkUpdates?.entityBatchUpdate?.mutations?.[0]?.payload
        ?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!Array.isArray(captions) || captions.length === 0) {
      return null;
    }

    const track = captions[0];
    const baseUrl: string | undefined = track?.baseUrl;
    if (!baseUrl) return null;

    const response = await fetch(`${baseUrl}&fmt=json3`);
    const data = (await response.json()) as { events?: TranscriptEvent[] };

    const events = Array.isArray(data.events)
      ? data.events.filter((e) => Array.isArray(e.segs))
      : [];

    return events.length > 0 ? events : null;
  } catch {
    return null;
  }
}

// Get YouTube video info
function getYouTubeVideoInfo(): YouTubeVideoInfo {
  const title = (document.title || "").replace(" - YouTube", "").trim();

  const channel =
    document.querySelector<HTMLAnchorElement>("#channel-name a")?.textContent?.trim() ||
    "";

  const duration =
    document.querySelector<HTMLSpanElement>("span.ytp-time-duration")?.textContent ||
    getDurationFromMeta() ||
    "";

  return {
    title: title || "",
    channel,
    duration
  };
}

// Get duration from meta tags
function getDurationFromMeta(): string {
  const metaTags = document.querySelectorAll("meta");
  for (const tag of metaTags) {
    if (tag.getAttribute("itemprop") === "duration") {
      return tag.getAttribute("content") || "";
    }
  }
  return "";
}

// Format transcript as markdown
function formatTranscript(
  transcript: TranscriptEvent[],
  videoInfo: YouTubeVideoInfo,
  includeTimestamps: boolean
): string {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return `# ${videoInfo.title}\n\nTranscript not available.`;
  }

  let markdown = `# ${videoInfo.title}\n\n`;
  markdown += `**Channel:** ${videoInfo.channel}\n`;
  markdown += `**Duration:** ${videoInfo.duration}\n\n`;
  markdown += `---\n\n## Transcript\n\n`;

  const segments: string[] = [];

  for (const event of transcript) {
    if (!event || !Array.isArray(event.segs)) continue;

    const text = event.segs.map((seg) => seg.utf8).join("").trim();
    if (!text) continue;

    if (includeTimestamps && typeof event.tStartMs === "number") {
      const startTime = formatTimestamp(event.tStartMs / 1000);
      segments.push(`**[${startTime}]** ${text}`);
    } else {
      segments.push(text);
    }
  }

  markdown += segments.join("\n\n");
  return markdown;
}

// Format timestamp as HH:MM:SS
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Extract PDF content (basic implementation)
function extractPDFContent(result: ClipResult): ClipResult {
  result.metadata.type = "document";

  const bodyText = document.body?.textContent || "";

  // Check for password-protected PDF
  const isPasswordProtected =
    bodyText.includes("password") ||
    document.querySelector("#passwordText") !== null ||
    document.querySelector(".passwordPrompt") !== null;

  if (isPasswordProtected) {
    result.metadata.passwordProtected = true;
    result.markdown =
      `# ${result.title}\n\n` +
      `> ⚠️ **This PDF is password-protected.**\n\n` +
      `Text extraction is not available for password-protected PDFs viewed in the browser.\n\n` +
      `**Source:** ${result.url}`;
    return result;
  }

  // Check for scanned/image-based PDF (no text layer)
  const hasTextLayer =
    document.querySelector(".textLayer") !== null ||
    document.querySelector("canvas + span") !== null;

  if (!hasTextLayer) {
    const hasCanvas = document.querySelectorAll("canvas").length > 0;
    const trimmedBodyText = (document.body?.textContent || "").trim();

    if (hasCanvas && trimmedBodyText.length < 100) {
      result.metadata.scannedPDF = true;
      result.markdown =
        `# ${result.title}\n\n` +
        `> ⚠️ **This appears to be a scanned/image-based PDF.**\n\n` +
        `Text extraction is not available for image-based PDFs. You may need to use OCR software to extract the text.\n\n` +
        `**Source:** ${result.url}`;
      return result;
    }
  }

  const textContent = extractPDFText();

  if (textContent && textContent.length > 100) {
    if (textContent.length > 50000) {
      result.metadata.truncated = true;
      result.markdown =
        `# ${result.title}\n\n` +
        `> ⚠️ **This is a large PDF.** The extracted content below may be truncated.\n\n` +
        `---\n\n${textContent.substring(0, 50000)}\n\n... *[content truncated]*`;
    } else {
      result.markdown = `# ${result.title}\n\n${textContent}`;
    }
  } else if (textContent) {
    result.markdown = `# ${result.title}\n\n${textContent}`;
  } else {
    result.markdown =
      `# ${result.title}\n\n` +
      `> ⚠️ **PDF text extraction not available in this viewer.**\n\n` +
      `Possible reasons:\n` +
      `- The PDF contains only images (scanned document)\n` +
      `- The browser's PDF viewer doesn't expose text content\n\n` +
      `**Source:** ${result.url}\n\n` +
      `Consider downloading the file and using a dedicated PDF extraction tool.`;
  }

  return result;
}

// Extract text from PDF viewer (basic)
function extractPDFText(): string {
  const textLayer = document.querySelector<HTMLElement>(".textLayer");

  if (textLayer) {
    const spans = textLayer.querySelectorAll<HTMLSpanElement>("span");
    const lines: string[] = [];

    let currentLine = "";
    let lastY: number | null = null;

    spans.forEach((span) => {
      const transform = span.style.transform || "";
      const match = transform.match(/translate\(([^,]+),\s*([^\)]+)\)/);

      if (match) {
        const y = parseFloat(match[2]);

        if (lastY !== null && Number.isFinite(y) && Math.abs(y - lastY) > 12) {
          if (currentLine.trim()) {
            lines.push(currentLine.trim());
          }
          currentLine = "";
        }

        if (Number.isFinite(y)) {
          lastY = y;
        }

        currentLine += (span.textContent || "") + " ";
      }
    });

    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    return lines.join("\n\n");
  }

  const bodyText = document.body?.textContent || "";
  if (bodyText.length > 200) {
    return bodyText
      .replace(/\s+/g, " ")
      .replace(/(\w)(\d+)/g, "$1 $2")
      .trim();
  }

  return bodyText;
}

// Get basic page info without full extraction
function getPageInfo(): PageInfo {
  const url = window.location.href;
  return {
    url,
    title: document.title || "Untitled",
    type: detectPageType(url)
  };
}