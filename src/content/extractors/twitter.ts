import type { ClipResult } from "../../shared/types";

/**
 * Media item from a tweet
 */
interface TwitterMedia {
  type: "image" | "video" | "gif";
  url: string;
  altText?: string;
}

/**
 * Engagement stats for a tweet
 */
interface TwitterEngagement {
  replies: number;
  retweets: number;
  likes: number;
  views?: number;
  bookmarks?: number;
}

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
  /** Author profile URL */
  authorAvatar?: string;
  /** Author is verified */
  isVerified?: boolean;
  /** Tweet timestamp (ISO string) */
  timestamp: string;
  /** Tweet ID from URL */
  tweetId: string;
  /** Whether this appears to be a thread */
  isThread: boolean;
  /** Number of tweets in thread (if detected) */
  threadLength?: number;
  /** Media attachments */
  media: TwitterMedia[];
  /** Engagement statistics */
  engagement: TwitterEngagement;
  /** Quoted tweet (if any) */
  quotedTweet?: {
    authorHandle: string;
    text: string;
  };
}

/**
 * Extract engagement stat count from aria-label
 * Format: "123 replies", "1,234 Likes", etc.
 */
function parseEngagementCount(ariaLabel: string): number {
  if (!ariaLabel) return 0;

  // Extract number from strings like "123 replies", "1.2K Likes", "1,234 Reposts"
  const match = ariaLabel.match(/[\d,.]+[KkMmBb]?/);
  if (!match) return 0;

  let numStr = match[0].replace(/,/g, "");

  // Handle K, M, B suffixes
  if (numStr.endsWith("K") || numStr.endsWith("k")) {
    return Math.round(parseFloat(numStr) * 1000);
  } else if (numStr.endsWith("M") || numStr.endsWith("m")) {
    return Math.round(parseFloat(numStr) * 1000000);
  } else if (numStr.endsWith("B") || numStr.endsWith("b")) {
    return Math.round(parseFloat(numStr) * 1000000000);
  }

  return parseInt(numStr, 10) || 0;
}

/**
 * Extract engagement stats from the tweet
 */
function getEngagementStats(): TwitterEngagement {
  const engagement: TwitterEngagement = {
    replies: 0,
    retweets: 0,
    likes: 0
  };

  // Twitter uses button elements with aria-label for engagement
  // Format: "123 replies", "456 Reposts", "789 Likes", "1.2K views"

  // Find all buttons in the tweet actions area
  const buttons = document.querySelectorAll('button[aria-label]');

  for (const button of buttons) {
    const label = button.getAttribute("aria-label")?.toLowerCase() || "";

    if (label.includes("repl")) {
      engagement.replies = parseEngagementCount(button.getAttribute("aria-label") || "");
    } else if (label.includes("repost") || label.includes("retweet")) {
      engagement.retweets = parseEngagementCount(button.getAttribute("aria-label") || "");
    } else if (label.includes("like")) {
      engagement.likes = parseEngagementCount(button.getAttribute("aria-label") || "");
    } else if (label.includes("view")) {
      engagement.views = parseEngagementCount(button.getAttribute("aria-label") || "");
    } else if (label.includes("bookmark")) {
      engagement.bookmarks = parseEngagementCount(button.getAttribute("aria-label") || "");
    }
  }

  return engagement;
}

/**
 * Extract media attachments from the tweet
 */
function getMediaAttachments(): TwitterMedia[] {
  const media: TwitterMedia[] = [];

  // Find tweet media container
  const tweetArticle = document.querySelector('article[data-testid="tweet"]');
  if (!tweetArticle) return media;

  // Extract images
  const images = tweetArticle.querySelectorAll('div[data-testid="tweetPhoto"] img');
  for (const img of images) {
    const src = img.getAttribute("src");
    if (src && !src.includes("profile_images")) {
      media.push({
        type: "image",
        url: src,
        altText: img.getAttribute("alt") || undefined
      });
    }
  }

  // Extract videos
  const videos = tweetArticle.querySelectorAll('video');
  for (const video of videos) {
    const poster = video.getAttribute("poster");
    // Twitter videos are typically MP4
    const src = video.querySelector("source")?.getAttribute("src") || poster;
    if (src) {
      // Check if it's a GIF (Twitter converts GIFs to video)
      const isGif = src.includes("tweet_video_gif") || video.hasAttribute("loop");
      media.push({
        type: isGif ? "gif" : "video",
        url: poster || src
      });
    }
  }

  return media;
}

/**
 * Extract basic tweet information from the DOM.
 */
function getTweetInfo(): TwitterTweetInfo {
  const url = window.location.href;
  const tweetIdMatch = url.match(/status\/(\d+)/);
  const tweetId = tweetIdMatch?.[1] || "";

  // Try to extract from the main tweet article first
  const tweetArticle = document.querySelector('article[data-testid="tweet"]');

  let text = "";
  let authorName = "";
  let authorHandle = "";
  let authorAvatar: string | undefined;
  let isVerified = false;
  let timestamp = "";

  if (tweetArticle) {
    // Extract tweet text from data-testid="tweetText"
    const tweetTextEl = tweetArticle.querySelector('div[data-testid="tweetText"]');
    if (tweetTextEl) {
      text = tweetTextEl.textContent?.trim() || "";
    }

    // Extract author info from the tweet header
    // Twitter structure: User name in a span, handle in another
    const userLink = tweetArticle.querySelector('a[href*="/status/"]')?.closest('div');
    if (userLink) {
      // Try to get name and handle from the link structure
      const nameSpan = userLink.querySelector('span[lang]');
      if (nameSpan) {
        authorName = nameSpan.textContent?.trim() || "";
      }
    }

    // Alternative: Extract from any link in the tweet header
    const authorLinks = tweetArticle.querySelectorAll('a[role="link"]');
    for (const link of authorLinks) {
      const href = link.getAttribute("href") || "";
      if (href.startsWith("/") && !href.includes("/status/")) {
        // This is likely the author handle
        authorHandle = href.slice(1);
        const nameEl = link.querySelector('span[lang]');
        if (nameEl) {
          authorName = nameEl.textContent?.trim() || "";
        }
        break;
      }
    }

    // Check for verified badge
    isVerified = tweetArticle.querySelector('[data-testid="icon-verified"]') !== null;

    // Extract timestamp
    const timeEl = tweetArticle.querySelector("time");
    if (timeEl) {
      timestamp = timeEl.getAttribute("datetime") || timeEl.textContent?.trim() || "";
    }

    // Extract avatar
    const avatarImg = tweetArticle.querySelector('img[src*="profile_images"]');
    if (avatarImg) {
      authorAvatar = avatarImg.getAttribute("src") || undefined;
    }
  }

  // Fallback to meta tags if DOM extraction failed
  if (!text) {
    text =
      document.querySelector('meta[name="description"]')?.getAttribute("content") ||
      document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
      "";

    // Clean up Twitter's meta description format
    const metaMatch = text.match(/^[""](.+?)[""]\s*[—-]\s*@/);
    if (metaMatch) {
      text = metaMatch[1];
    }
  }

  // Fallback for author from og:title
  if (!authorName || !authorHandle) {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";

    const titleMatch = ogTitle.match(/^(.+?)\s+(?:on\s+(?:X|Twitter)|\(@(.+?)\))/);
    if (titleMatch) {
      if (!authorName) authorName = titleMatch[1].trim();
      if (!authorHandle) authorHandle = titleMatch[2] || "";
    }
  }

  // Fallback: try to get handle from URL path
  if (!authorHandle) {
    const handleMatch = url.match(/(?:twitter|x)\.com\/([^/]+)(?:\/status)?/);
    if (handleMatch && handleMatch[1] !== "status" && handleMatch[1] !== "i") {
      authorHandle = handleMatch[1];
    }
  }

  // Check for quoted tweet
  let quotedTweet: TwitterTweetInfo["quotedTweet"];
  const quoteDiv = tweetArticle?.querySelector('div[data-testid="tweet"] div[role="link"]');
  if (quoteDiv) {
    // Extract quoted tweet info
    const quoteText = quoteDiv.querySelector('div[data-testid="tweetText"]')?.textContent?.trim();
    const quoteHandleMatch = quoteDiv.innerHTML.match(/@(\w+)/);
    if (quoteText && quoteHandleMatch) {
      quotedTweet = {
        authorHandle: quoteHandleMatch[1],
        text: quoteText
      };
    }
  }

  // Check for thread indicators (scaffolding - full detection in Task 46)
  const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
  const isThread = tweetArticles.length > 1;
  const threadLength = isThread ? tweetArticles.length : undefined;

  // Extract media and engagement
  const media = getMediaAttachments();
  const engagement = getEngagementStats();

  return {
    text: text.trim(),
    authorName,
    authorHandle,
    authorAvatar,
    isVerified,
    timestamp,
    tweetId,
    isThread,
    threadLength,
    media,
    engagement,
    quotedTweet
  };
}

/**
 * Format a number for display (e.g., 1234 -> "1.2K")
 */
function formatNumber(num: number): string {
  if (num >= 1000000000) {
    return `${(num / 1000000000).toFixed(1)}B`;
  } else if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

/**
 * Extract Twitter/X content from the current page.
 *
 * Implements single tweet extraction (Task 45).
 * Full thread extraction is implemented in Tasks 46-50.
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
    ? `Tweet by @${tweetInfo.authorHandle}`
    : result.title;
  result.metadata.publishedDate = tweetInfo.timestamp;

  // Build markdown
  let markdown = `# ${tweetInfo.authorName || "Unknown Author"}`;
  if (tweetInfo.authorHandle) {
    markdown += ` (@${tweetInfo.authorHandle})`;
  }
  if (tweetInfo.isVerified) {
    markdown += ` ✓`;
  }
  markdown += "\n\n";

  if (tweetInfo.timestamp) {
    const date = new Date(tweetInfo.timestamp);
    const dateStr = date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    markdown += `> 📅 ${dateStr}\n\n`;
  }

  // Thread indicator
  if (tweetInfo.isThread) {
    markdown += `> 🧵 **Thread** (${tweetInfo.threadLength} tweets detected)\n\n`;
    markdown += `> ⚠️ **Note:** Full thread extraction requires viewing the thread directly. `;
    markdown += `This clip captures the visible content only.\n\n`;
  }

  markdown += `---\n\n`;

  // Tweet text
  if (tweetInfo.text) {
    markdown += `${tweetInfo.text}\n`;
  } else {
    markdown += `> ⚠️ **Could not extract tweet content.** `;
    markdown += `The page may require JavaScript rendering or the content may be protected.\n`;
  }

  // Media attachments
  if (tweetInfo.media.length > 0) {
    markdown += `\n\n**Media:**\n`;
    for (const media of tweetInfo.media) {
      if (media.type === "image") {
        const alt = media.altText ? ` "${media.altText}"` : "";
        markdown += `\n![${media.type}](${media.url}${alt})`;
      } else if (media.type === "video" || media.type === "gif") {
        const emoji = media.type === "gif" ? "🎬" : "🎥";
        markdown += `\n${emoji} [${media.type === "gif" ? "GIF" : "Video"}](${media.url})`;
      }
    }
  }

  // Quoted tweet
  if (tweetInfo.quotedTweet) {
    markdown += `\n\n---\n\n`;
    markdown += `**Quoted Tweet from @${tweetInfo.quotedTweet.authorHandle}:**\n\n`;
    markdown += `> ${tweetInfo.quotedTweet.text}\n`;
  }

  // Engagement stats
  const { engagement } = tweetInfo;
  markdown += `\n\n---\n\n`;
  markdown += `**Engagement:** `;
  const stats: string[] = [];
  if (engagement.replies > 0) stats.push(`💬 ${formatNumber(engagement.replies)} replies`);
  if (engagement.retweets > 0) stats.push(`🔄 ${formatNumber(engagement.retweets)} reposts`);
  if (engagement.likes > 0) stats.push(`❤️ ${formatNumber(engagement.likes)} likes`);
  if (engagement.bookmarks && engagement.bookmarks > 0) {
    stats.push(`🔖 ${formatNumber(engagement.bookmarks)} bookmarks`);
  }
  if (engagement.views && engagement.views > 0) {
    stats.push(`👁️ ${formatNumber(engagement.views)} views`);
  }
  markdown += stats.join(" • ");
  markdown += `\n`;

  markdown += `\n---\n\n`;
  markdown += `[View on X/Twitter](${result.url})\n`;

  result.markdown = markdown;

  return result;
}
