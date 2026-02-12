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
 * A single tweet within a thread (Task 46)
 */
interface TwitterThreadTweet {
  /** Tweet text content */
  text: string;
  /** Tweet timestamp (ISO string) */
  timestamp: string;
  /** Position in thread (1-indexed) */
  position: number;
  /** Media attachments for this tweet */
  media: TwitterMedia[];
  /** Engagement stats for this tweet */
  engagement: TwitterEngagement;
  /** Quoted tweet (if any) */
  quotedTweet?: {
    authorHandle: string;
    text: string;
  };
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
  /** All tweets in the thread (if isThread is true) */
  threadTweets?: TwitterThreadTweet[];
  /** Media attachments */
  media: TwitterMedia[];
  /** Engagement statistics */
  engagement: TwitterEngagement;
  /** Quoted tweet (if any) */
  quotedTweet?: {
    authorHandle: string;
    text: string;
  };
  /** Whether there's a "Show more" indicator suggesting hidden thread content */
  hasMoreInThread?: boolean;
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
 * Extract engagement stats from the tweet (global document scan)
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
 * Extract engagement stats from a specific tweet article element
 */
function getEngagementStatsFromArticle(article: Element): TwitterEngagement {
  const engagement: TwitterEngagement = {
    replies: 0,
    retweets: 0,
    likes: 0
  };

  const buttons = article.querySelectorAll('button[aria-label]');
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
 * Extract author handle from a tweet article element
 * Returns empty string if not found
 */
function getAuthorHandleFromArticle(article: Element): string {
  // Look for links that match the pattern /username
  const authorLinks = article.querySelectorAll('a[role="link"]');
  for (const link of authorLinks) {
    const href = link.getAttribute("href") || "";
    // Match links like /username (without /status/)
    if (href.startsWith("/") && !href.includes("/status/") && !href.includes("/photo/") && !href.includes("/video/")) {
      return href.slice(1);
    }
  }
  return "";
}

/**
 * Extract tweet text from a tweet article element
 */
function getTextFromArticle(article: Element): string {
  const tweetTextEl = article.querySelector('div[data-testid="tweetText"]');
  return tweetTextEl?.textContent?.trim() || "";
}

/**
 * Extract timestamp from a tweet article element
 */
function getTimestampFromArticle(article: Element): string {
  const timeEl = article.querySelector("time");
  return timeEl?.getAttribute("datetime") || timeEl?.textContent?.trim() || "";
}

/**
 * Extract media attachments from a specific tweet article element
 */
function getMediaFromArticle(article: Element): TwitterMedia[] {
  const media: TwitterMedia[] = [];

  // Extract images
  const images = article.querySelectorAll('div[data-testid="tweetPhoto"] img');
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
  const videos = article.querySelectorAll('video');
  for (const video of videos) {
    const poster = video.getAttribute("poster");
    const src = video.querySelector("source")?.getAttribute("src") || poster;
    if (src) {
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
 * Extract quoted tweet from a tweet article element
 */
function getQuotedTweetFromArticle(article: Element): TwitterThreadTweet["quotedTweet"] {
  // Look for quoted tweet container - it has nested tweet structure
  const quoteContainer = article.querySelector('div[data-testid="tweet"] > div[role="link"]');
  if (!quoteContainer) return undefined;

  // Try to find quoted tweet text
  const quoteText = quoteContainer.querySelector('div[data-testid="tweetText"]')?.textContent?.trim();
  if (!quoteText) return undefined;

  // Extract quoted author handle
  const quoteHandleMatch = quoteContainer.textContent?.match(/@(\w+)/);
  if (!quoteHandleMatch) return undefined;

  return {
    authorHandle: quoteHandleMatch[1],
    text: quoteText
  };
}

/**
 * Detect and extract a thread of tweets from the page.
 *
 * Thread detection rules (Task 46):
 * 1. Find the main tweet (the one from the URL)
 * 2. Look for subsequent tweets by the SAME author
 * 3. Stop when we hit a tweet by a different author (that's a reply)
 * 4. Thread tweets are connected by vertical lines in Twitter's UI
 *
 * @param mainTweetHandle - The handle of the main tweet author
 * @returns Array of thread tweets (empty if not a thread)
 */
function detectAndExtractThread(mainTweetHandle: string): TwitterThreadTweet[] {
  const threadTweets: TwitterThreadTweet[] = [];

  // Find all tweet articles on the page
  const allArticles = document.querySelectorAll('article[data-testid="tweet"]');
  if (allArticles.length <= 1) {
    return threadTweets; // Not a thread, just a single tweet
  }

  // Process each article
  let position = 0;
  let foundMainTweet = false;
  let threadEnded = false;

  for (const article of allArticles) {
    const handle = getAuthorHandleFromArticle(article);

    // Skip until we find the main tweet (the one from the URL)
    if (!foundMainTweet) {
      if (handle === mainTweetHandle) {
        foundMainTweet = true;
        position = 1;
        // Add the main tweet as first in thread
        threadTweets.push({
          text: getTextFromArticle(article),
          timestamp: getTimestampFromArticle(article),
          position: 1,
          media: getMediaFromArticle(article),
          engagement: getEngagementStatsFromArticle(article),
          quotedTweet: getQuotedTweetFromArticle(article)
        });
      }
      continue;
    }

    // After finding main tweet, check if subsequent tweets are part of thread
    if (threadEnded) break;

    if (handle === mainTweetHandle) {
      // Same author - this is part of the thread
      position++;
      threadTweets.push({
        text: getTextFromArticle(article),
        timestamp: getTimestampFromArticle(article),
        position,
        media: getMediaFromArticle(article),
        engagement: getEngagementStatsFromArticle(article),
        quotedTweet: getQuotedTweetFromArticle(article)
      });
    } else {
      // Different author - this is a reply, thread has ended
      threadEnded = true;
    }
  }

  // Only return as thread if we found more than one tweet
  return threadTweets.length > 1 ? threadTweets : [];
}

/**
 * Check if there's a "Show more" or thread continuation indicator
 * that suggests the thread extends beyond what's visible.
 */
function hasThreadContinuation(): boolean {
  // Look for "Show this thread" or "Show more" buttons
  const showMoreButtons = document.querySelectorAll(
    'div[role="button"], span'
  );
  for (const btn of showMoreButtons) {
    const text = btn.textContent?.toLowerCase() || "";
    if (
      text.includes("show this thread") ||
      text.includes("show more replies") ||
      text.includes("show additional replies")
    ) {
      return true;
    }
  }
  return false;
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

  // Extract media and engagement from the first tweet
  const media = getMediaAttachments();
  const engagement = getEngagementStats();

  // Detect thread (Task 46) - find all tweets by same author in sequence
  const threadTweets = detectAndExtractThread(authorHandle);
  const isThread = threadTweets.length > 0;
  const threadLength = isThread ? threadTweets.length : undefined;
  const hasMoreInThread = isThread && hasThreadContinuation();

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
    threadTweets: isThread ? threadTweets : undefined,
    media,
    engagement,
    quotedTweet,
    hasMoreInThread
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
 * Implements single tweet extraction (Task 45) and thread detection (Task 46).
 * Full thread markdown formatting is implemented in Tasks 47-50.
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

  // Thread indicator with count
  if (tweetInfo.isThread) {
    markdown += `> 🧵 **Thread** (${tweetInfo.threadLength} tweets`;
    if (tweetInfo.hasMoreInThread) {
      markdown += ` + more`;
    }
    markdown += `)\n\n`;
  }

  markdown += `---\n\n`;

  // If we have thread tweets, output each one
  if (tweetInfo.isThread && tweetInfo.threadTweets && tweetInfo.threadTweets.length > 0) {
    for (let i = 0; i < tweetInfo.threadTweets.length; i++) {
      const tweet = tweetInfo.threadTweets[i];

      // Tweet header with position
      markdown += `### Tweet ${tweet.position}\n\n`;

      // Timestamp for this tweet
      if (tweet.timestamp) {
        const date = new Date(tweet.timestamp);
        const dateStr = date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
        markdown += `> 📅 ${dateStr}\n\n`;
      }

      // Tweet text
      if (tweet.text) {
        markdown += `${tweet.text}\n`;
      }

      // Media attachments for this tweet
      if (tweet.media.length > 0) {
        markdown += `\n\n**Media:**\n`;
        for (const media of tweet.media) {
          if (media.type === "image") {
            const alt = media.altText ? ` "${media.altText}"` : "";
            markdown += `\n![${media.type}](${media.url}${alt})`;
          } else if (media.type === "video" || media.type === "gif") {
            const emoji = media.type === "gif" ? "🎬" : "🎥";
            markdown += `\n${emoji} [${media.type === "gif" ? "GIF" : "Video"}](${media.url})`;
          }
        }
      }

      // Quoted tweet for this thread tweet
      if (tweet.quotedTweet) {
        markdown += `\n\n> **Quoted:** @${tweet.quotedTweet.authorHandle}: ${tweet.quotedTweet.text}\n`;
      }

      // Engagement for this tweet
      const tweetStats: string[] = [];
      if (tweet.engagement.replies > 0) tweetStats.push(`💬 ${formatNumber(tweet.engagement.replies)}`);
      if (tweet.engagement.retweets > 0) tweetStats.push(`🔄 ${formatNumber(tweet.engagement.retweets)}`);
      if (tweet.engagement.likes > 0) tweetStats.push(`❤️ ${formatNumber(tweet.engagement.likes)}`);
      if (tweet.engagement.views && tweet.engagement.views > 0) {
        tweetStats.push(`👁️ ${formatNumber(tweet.engagement.views)}`);
      }
      if (tweetStats.length > 0) {
        markdown += `\n\n<small>${tweetStats.join(" • ")}</small>`;
      }

      // Separator between tweets (except after last one)
      if (i < tweetInfo.threadTweets!.length - 1) {
        markdown += `\n\n---\n\n`;
      }
    }

    // Note if there's more content
    if (tweetInfo.hasMoreInThread) {
      markdown += `\n\n---\n\n`;
      markdown += `> ⚠️ **Note:** This thread has additional tweets not visible on the current page. `;
      markdown += `[View full thread on X/Twitter](${result.url})\n`;
    }
  } else {
    // Single tweet (not a thread or thread detection failed)
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
  }

  // Engagement stats (total from main tweet)
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
