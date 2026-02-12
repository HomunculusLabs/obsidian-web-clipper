import type { ClipResult } from "../../shared/types";

/**
 * Twitter/X tweet information extracted from the DOM.
 */
interface TwitterTweetInfo {
  /** Tweet text content */
  text: string;
  /** Author display name */
  authorName: string;
  /** Author handle (e.g., "username" without @) */
  authorHandle: string;
  /** Tweet timestamp */
  timestamp: string;
  /** Tweet ID from URL */
  tweetId: string;
  /** Whether this appears to be a thread */
  isThread: boolean;
  /** Number of tweets in thread (if detected) */
  threadLength?: number;
}

/**
 * Extract basic tweet information from the DOM.
 * This is a scaffolding implementation - full thread extraction comes in later tasks.
 */
function getTweetInfo(): TwitterTweetInfo {
  const url = window.location.href;
  const tweetIdMatch = url.match(/status\/(\d+)/);
  const tweetId = tweetIdMatch?.[1] || "";

  // Try to extract tweet text from meta tags (most reliable)
  let text =
    document.querySelector('meta[name="description"]')?.getAttribute("content") ||
    document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
    "";

  // Clean up Twitter's meta description format
  // Often includes "“text” — @username" format
  const metaMatch = text.match(/^[""](.+?)[""]\s*[—-]\s*@/);
  if (metaMatch) {
    text = metaMatch[1];
  }

  // Extract author from og:title or meta tags
  // Format: "Username on X" or "Username (@handle) on Twitter"
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
  let authorName = "";
  let authorHandle = "";

  // Try to extract from og:title
  const titleMatch = ogTitle.match(/^(.+?)\s+(?:on\s+(?:X|Twitter)|\(@(.+?)\))/);
  if (titleMatch) {
    authorName = titleMatch[1].trim();
    authorHandle = titleMatch[2] || "";
  }

  // Fallback: try to get from URL path
  if (!authorHandle) {
    const handleMatch = url.match(/(?:twitter|x)\.com\/([^/]+)(?:\/status)?/);
    if (handleMatch && handleMatch[1] !== "status" && handleMatch[1] !== "i") {
      authorHandle = handleMatch[1];
    }
  }

  // Extract timestamp from the page if available
  let timestamp = "";
  const timeEl = document.querySelector("time");
  if (timeEl) {
    timestamp = timeEl.getAttribute("datetime") || timeEl.textContent?.trim() || "";
  }

  // Check for thread indicators (scaffolding - full detection in Task 46)
  // For now, just check if there are multiple tweet articles
  const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
  const isThread = tweetArticles.length > 1;
  const threadLength = isThread ? tweetArticles.length : undefined;

  return {
    text: text.trim(),
    authorName,
    authorHandle,
    timestamp,
    tweetId,
    isThread,
    threadLength
  };
}

/**
 * Extract Twitter/X content from the current page.
 *
 * This is the scaffolding implementation (Task 44).
 * Full thread extraction is implemented in Tasks 45-50.
 *
 * @param result - The base clip result to populate
 * @returns Promise<ClipResult> with Twitter content
 */
export async function extractTwitterContent(
  result: ClipResult
): Promise<ClipResult> {
  result.metadata.type = "article";

  const tweetInfo = getTweetInfo();

  // Set metadata
  result.metadata.author = tweetInfo.authorName || tweetInfo.authorHandle;
  result.title = tweetInfo.authorHandle
    ? `@${tweetInfo.authorHandle}`
    : result.title;
  result.metadata.publishedDate = tweetInfo.timestamp;

  // Build markdown
  let markdown = `# @${tweetInfo.authorHandle || "unknown"}\n\n`;

  if (tweetInfo.authorName) {
    markdown += `**${tweetInfo.authorName}**`;
    if (tweetInfo.authorHandle) {
      markdown += ` (@${tweetInfo.authorHandle})`;
    }
    markdown += "\n\n";
  }

  if (tweetInfo.timestamp) {
    markdown += `> ${tweetInfo.timestamp}\n\n`;
  }

  if (tweetInfo.isThread) {
    markdown += `> 🧵 **Thread** (${tweetInfo.threadLength} tweets detected)\n\n`;
    markdown += `> ⚠️ **Note:** Full thread extraction requires viewing the thread directly. `;
    markdown += `This clip captures the visible content only.\n\n`;
  }

  markdown += `---\n\n`;

  if (tweetInfo.text) {
    markdown += `${tweetInfo.text}\n`;
  } else {
    markdown += `> ⚠️ **Could not extract tweet content.** `;
    markdown += `The page may require JavaScript rendering or the content may be protected.\n`;
  }

  markdown += `\n---\n\n`;
  markdown += `[View on X/Twitter](${result.url})\n`;

  result.markdown = markdown;

  return result;
}
