import type { ClipResult } from "../../shared/types";

// ============================================================================
// Task 54: Twitter API Fallback System
// ============================================================================

/**
 * List of nitter instances to try as fallback.
 * These are privacy-focused Twitter frontends that don't require auth.
 */
const NITTER_INSTANCES = [
  "nitter.net",
  "nitter.poast.org",
  "nitter.privacydev.net",
  "nitter.1d4.us",
  "nitter.kavin.rocks"
];

/**
 * Result from fallback extraction methods.
 */
interface FallbackResult {
  text: string;
  authorName?: string;
  authorHandle?: string;
  html?: string;
  source: "oembed" | "nitter";
}

/**
 * Detect if the page is showing an auth wall / login requirement.
 * Twitter/X shows different UI when the user is not logged in.
 */
function detectAuthWall(): boolean {
  // Check for login/signup prompts
  const loginPrompt = document.querySelector('[data-testid="login"]');
  const signupPrompt = document.querySelector('[data-testid="signup"]');
  const loginDialog = document.querySelector('div[data-testid="sheet"] [data-testid="LoginFormControl"]');

  // Check for "Log in to view" text
  const bodyText = document.body.textContent?.toLowerCase() || "";
  const hasLoginRequiredText =
    bodyText.includes("log in to view") ||
    bodyText.includes("sign in to view") ||
    bodyText.includes("log in to x") ||
    bodyText.includes("sign up to view");

  // Check if tweet article is missing or empty
  const tweetArticle = document.querySelector('article[data-testid="tweet"]');
  const hasNoTweetContent = !tweetArticle || !tweetArticle.querySelector('div[data-testid="tweetText"]');

  return !!(loginPrompt || signupPrompt || loginDialog || (hasLoginRequiredText && hasNoTweetContent));
}

/**
 * Detect if DOM extraction produced meaningful content.
 * Returns true if extraction failed or content is insufficient.
 */
function isExtractionEmpty(tweetInfo: { text: string; authorHandle: string }): boolean {
  // No text content at all
  if (!tweetInfo.text || tweetInfo.text.trim().length < 5) {
    return true;
  }

  // No author handle (critical metadata missing)
  if (!tweetInfo.authorHandle) {
    return true;
  }

  return false;
}

/**
 * Fetch tweet data via Twitter's public oEmbed API.
 * This works without authentication and returns HTML.
 */
async function fetchFromOEmbed(tweetUrl: string): Promise<FallbackResult | null> {
  try {
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true`;

    const response = await fetch(oembedUrl, {
      method: "GET",
      credentials: "omit" // Don't send cookies
    });

    if (!response.ok) {
      console.warn(`[Twitter] oEmbed API returned ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (!data.html) {
      return null;
    }

    // Extract author info from oEmbed response
    const authorName = data.author_name || undefined;
    const authorHandle = data.author_url?.split("/").pop() || undefined;

    // Extract text from HTML (oEmbed returns blockquote HTML)
    const text = extractTextFromOEmbedHtml(data.html);

    return {
      text,
      authorName,
      authorHandle,
      html: data.html,
      source: "oembed"
    };
  } catch (error) {
    console.warn("[Twitter] oEmbed fetch failed:", error);
    return null;
  }
}

/**
 * Extract plain text from oEmbed HTML (blockquote format).
 */
function extractTextFromOEmbedHtml(html: string): string {
  // oEmbed returns: <blockquote class="twitter-tweet">...<p>text</p>...</blockquote>
  const pMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (pMatch) {
    // Remove HTML tags and decode entities
    let text = pMatch[1]
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<a[^>]*>([^<]*)<\/a>/gi, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    return text;
  }
  return "";
}

/**
 * Fetch tweet data from a nitter instance.
 * Nitter is a privacy-focused Twitter frontend.
 */
async function fetchFromNitter(tweetUrl: string): Promise<FallbackResult | null> {
  // Extract tweet ID from URL
  const tweetIdMatch = tweetUrl.match(/status\/(\d+)/);
  if (!tweetIdMatch) {
    return null;
  }

  // Extract author handle from URL
  const handleMatch = tweetUrl.match(/(?:twitter|x)\.com\/([^/]+)\/status/);
  const authorHandle = handleMatch?.[1];

  // Try each nitter instance
  for (const instance of NITTER_INSTANCES) {
    try {
      const nitterUrl = `https://${instance}/${authorHandle}/status/${tweetIdMatch[1]}`;

      const response = await fetch(nitterUrl, {
        method: "GET",
        credentials: "omit",
        headers: {
          "Accept": "text/html"
        }
      });

      if (!response.ok) {
        continue; // Try next instance
      }

      const html = await response.text();
      const result = parseNitterHtml(html, authorHandle);

      if (result && result.text) {
        return result;
      }
    } catch (error) {
      // Instance might be down, try next one
      console.debug(`[Twitter] Nitter instance ${instance} failed:`, error);
      continue;
    }
  }

  return null;
}

/**
 * Parse nitter HTML to extract tweet content.
 */
function parseNitterHtml(html: string, authorHandle?: string): FallbackResult | null {
  // Nitter uses simple HTML structure:
  // <div class="tweet-content">...</div>
  // <a class="fullname">...</a>
  // <a class="username">...</a>

  // Extract tweet text
  const contentMatch = html.match(/<div[^>]*class="[^"]*tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (!contentMatch) {
    return null;
  }

  let text = contentMatch[1]
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a[^>]*>([^<]*)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

  // Extract author name
  const nameMatch = html.match(/<a[^>]*class="[^"]*fullname[^"]*"[^>]*>([^<]*)<\/a>/i);
  const authorName = nameMatch?.[1]?.trim();

  // Extract username if not provided
  let handle = authorHandle;
  if (!handle) {
    const usernameMatch = html.match(/<a[^>]*class="[^"]*username[^"]*"[^>]*>@?([^<]*)<\/a>/i);
    handle = usernameMatch?.[1]?.trim()?.replace("@", "");
  }

  return {
    text,
    authorName,
    authorHandle: handle,
    source: "nitter"
  };
}

/**
 * Try all fallback methods to get tweet content.
 * Order: oEmbed API -> Nitter instances
 */
async function tryFallbacks(tweetUrl: string): Promise<FallbackResult | null> {
  // Try oEmbed first (most reliable, official API)
  let result = await fetchFromOEmbed(tweetUrl);
  if (result && result.text) {
    console.log("[Twitter] Successfully used oEmbed fallback");
    return result;
  }

  // Try nitter instances
  result = await fetchFromNitter(tweetUrl);
  if (result && result.text) {
    console.log("[Twitter] Successfully used nitter fallback");
    return result;
  }

  return null;
}

// ============================================================================
// Original Twitter Extractor Code
// ============================================================================

/**
 * Media item from a tweet
 */
interface TwitterMedia {
  type: "image" | "video" | "gif" | "poll" | "card";
  url: string;
  altText?: string;
}

/**
 * Poll option from a Twitter poll (Task 48)
 */
interface TwitterPollOption {
  label: string;
  votes?: number;
  percentage?: number;
  isWinner?: boolean;
}

/**
 * Poll data from a tweet (Task 48)
 */
interface TwitterPoll {
  options: TwitterPollOption[];
  totalVotes?: number;
  endTime?: string;
  hasEnded?: boolean;
}

/**
 * Link card (preview of external URL) from a tweet (Task 48)
 */
interface TwitterLinkCard {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  domain?: string;
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
  /** Whether this is a retweet by the thread author (Task 47) */
  isRetweet?: boolean;
  /** Original tweet author if this is a retweet */
  retweetAuthorHandle?: string;
  /** Original tweet author name if this is a retweet */
  retweetAuthorName?: string;
  /** Poll data (Task 48) */
  poll?: TwitterPoll;
  /** Link card (Task 48) */
  linkCard?: TwitterLinkCard;
}

/**
 * Author profile information (Task 49)
 */
interface TwitterAuthorInfo {
  /** Author display name */
  name: string;
  /** Author handle (e.g., "username" without @) */
  handle: string;
  /** Author bio/description */
  bio?: string;
  /** Author profile avatar URL */
  avatar?: string;
  /** Author is verified */
  isVerified?: boolean;
  /** Follower count */
  followersCount?: number;
  /** Following count */
  followingCount?: number;
  /** Location */
  location?: string;
  /** Website URL */
  website?: string;
  /** Account creation date */
  joinedDate?: string;
}

/**
 * Aggregated thread statistics (Task 49)
 */
interface TwitterThreadStats {
  /** Total replies across all thread tweets */
  totalReplies: number;
  /** Total retweets/reposts across all thread tweets */
  totalRetweets: number;
  /** Total likes across all thread tweets */
  totalLikes: number;
  /** Total views across all thread tweets (if available) */
  totalViews?: number;
  /** Total bookmarks across all thread tweets (if available) */
  totalBookmarks?: number;
  /** Number of tweets in the thread */
  tweetCount: number;
  /** Average engagement per tweet */
  avgEngagement: {
    replies: number;
    retweets: number;
    likes: number;
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
  /** Poll data (Task 48) */
  poll?: TwitterPoll;
  /** Link card (Task 48) */
  linkCard?: TwitterLinkCard;
  /** Author profile info with bio (Task 49) */
  authorInfo?: TwitterAuthorInfo;
  /** Aggregated thread statistics (Task 49) */
  threadStats?: TwitterThreadStats;
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
 * Extract poll data from a tweet article element (Task 48)
 *
 * Twitter poll DOM structure:
 * - Container with data-testid="poll"
 * - Options in nested divs with radio-button-like structure
 * - Vote counts and percentages shown in result view
 */
function getPollFromArticle(article: Element): TwitterPoll | undefined {
  // Find poll container - Twitter uses data-testid="poll" or nested poll structure
  const pollContainer = article.querySelector('div[data-testid="poll"]') ||
                        article.querySelector('[data-testid="Poll"]');

  if (!pollContainer) return undefined;

  const options: TwitterPollOption[] = [];
  let totalVotes = 0;
  let endTime: string | undefined;
  let hasEnded = false;

  // Extract poll options
  // Twitter shows options as clickable elements or result bars
  const optionElements = pollContainer.querySelectorAll('div[role="radiogroup"] > div, div[role="group"] > div');

  for (const optionEl of optionElements) {
    // Try to extract label and votes
    const text = optionEl.textContent?.trim() || "";
    if (!text) continue;

    // Parse format like "Option text · 45% · 123 votes" or just "Option text"
    const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
    const votesMatch = text.match(/([\d,]+)\s*(?:votes?|people)/i);
    const winnerIndicator = optionEl.querySelector('[data-testid="poll-winner"]') !== null ||
                            optionEl.classList.contains("winner");

    // Find just the option label (before the percentage/vote info)
    let label = text;
    if (percentMatch) {
      label = text.split(percentMatch[0])[0].trim();
    } else if (votesMatch) {
      label = text.split(votesMatch[0])[0].trim();
    }
    // Clean up label - remove common separators
    label = label.replace(/[·|]\s*$/,"").trim();

    if (label) {
      const option: TwitterPollOption = {
        label,
        isWinner: winnerIndicator
      };

      if (percentMatch) {
        option.percentage = parseFloat(percentMatch[1]);
      }

      if (votesMatch) {
        option.votes = parseInt(votesMatch[1].replace(/,/g, ""), 10);
        totalVotes += option.votes;
      }

      options.push(option);
    }
  }

  // Alternative extraction if the above didn't work
  // Try extracting from aria-label or data attributes
  if (options.length === 0) {
    const allText = pollContainer.textContent?.trim() || "";
    // Check for poll options in the format often shown
    const optionMatches = allText.match(/(.+?)\s+(\d+(?:\.\d+)?%)/g);
    if (optionMatches) {
      for (const match of optionMatches) {
        const parts = match.split(/\s+(?=\d)/);
        if (parts.length >= 2) {
          const label = parts[0].trim();
          const percent = parseFloat(parts[1]);
          if (label && !isNaN(percent)) {
            options.push({ label, percentage: percent });
          }
        }
      }
    }
  }

  // Check for "ends at" or "final results" text
  const timeElements = pollContainer.querySelectorAll("time");
  for (const timeEl of timeElements) {
    const datetime = timeEl.getAttribute("datetime");
    if (datetime) {
      endTime = datetime;
      // Check if poll has ended
      const endDate = new Date(datetime);
      hasEnded = endDate < new Date();
    }
  }

  // Look for "final results" or "ended" text
  const pollText = pollContainer.textContent?.toLowerCase() || "";
  if (pollText.includes("final results") || pollText.includes("ended")) {
    hasEnded = true;
  }

  // Extract total votes from summary text
  if (totalVotes === 0) {
    const totalMatch = pollText.match(/([\d,]+)\s*(?:votes?|people\s+ voted)/i);
    if (totalMatch) {
      totalVotes = parseInt(totalMatch[1].replace(/,/g, ""), 10);
    }
  }

  // Only return if we found at least 2 options
  if (options.length < 2) return undefined;

  return {
    options,
    totalVotes: totalVotes > 0 ? totalVotes : undefined,
    endTime,
    hasEnded
  };
}

/**
 * Extract link card (URL preview) from a tweet article element (Task 48)
 *
 * Twitter link card DOM structure:
 * - Container with data-testid="card.wrapper"
 * - Contains title, description, image, and domain
 * - Links to external URL
 */
function getLinkCardFromArticle(article: Element): TwitterLinkCard | undefined {
  // Find card wrapper - Twitter uses data-testid="card.wrapper"
  const cardWrapper = article.querySelector('div[data-testid="card.wrapper"]') ||
                       article.querySelector('[data-testid="card"]') ||
                       article.querySelector('div[data-testid="previewCard"]');

  if (!cardWrapper) return undefined;

  // Extract the link URL
  const linkEl = cardWrapper.closest('a[href]') ||
                  cardWrapper.querySelector('a[href]') ||
                  cardWrapper.querySelector('[role="link"]');
  const url = linkEl?.getAttribute("href") || "";

  // Extract title
  const titleEl = cardWrapper.querySelector('h2, [data-testid="card-title"], span[dir="auto"]');
  const title = titleEl?.textContent?.trim() || "";

  // Extract description
  const descEl = cardWrapper.querySelector('[data-testid="card-description"], p, span[dir="auto"]');
  // Get description from second text span if available
  let description = "";
  const textSpans = cardWrapper.querySelectorAll('span[dir="auto"]');
  if (textSpans.length > 1) {
    description = textSpans[1]?.textContent?.trim() || "";
  }
  if (!description) {
    description = descEl?.textContent?.trim() || "";
  }

  // Extract image
  const imgEl = cardWrapper.querySelector('img[src]');
  const image = imgEl?.getAttribute("src") || "";

  // Extract domain - often shown at bottom of card
  const domainEl = cardWrapper.querySelector('[data-testid="card-domain"], [data-testid="card-domain-display"]');
  let domain = domainEl?.textContent?.trim() || "";

  // Fallback: extract domain from URL
  if (!domain && url) {
    try {
      const urlObj = new URL(url);
      domain = urlObj.hostname;
    } catch {
      // URL parsing failed, use empty domain
    }
  }

  // Only return if we have at least a URL or title
  if (!url && !title) return undefined;

  return {
    url,
    title: title || undefined,
    description: description || undefined,
    image: image || undefined,
    domain: domain || undefined
  };
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
 * Detect if a tweet article is a retweet by checking for "Reposted" indicator.
 * Returns the retweeter's handle if this is a retweet, or null if not.
 *
 * Twitter DOM structure for retweets:
 * - Has a "Reposted" text or social context indicator at the top
 * - The main author shown is the original tweeter, not the retweeter
 */
function getRetweetInfo(article: Element): { retweeterHandle: string; retweeterName: string } | null {
  // Look for "Reposted" indicator - Twitter shows this above the tweet
  // Format: "Username Reposted" in a div with smaller text
  const socialContext = article.querySelector('[data-testid="socialContext"]');
  if (socialContext) {
    const text = socialContext.textContent?.toLowerCase() || "";
    if (text.includes("reposted") || text.includes("retweeted")) {
      // Extract retweeter name/handle from the social context
      // Format: "Display Name Reposted" or "@handle Reposted"
      const match = socialContext.textContent?.match(/^(.+?)\s+Reposted/i);
      if (match) {
        let retweeterName = match[1].trim();
        // Clean up handle format if present
        if (retweeterName.startsWith("@")) {
          return { retweeterHandle: retweeterName.slice(1), retweeterName: retweeterName.slice(1) };
        }
        return { retweeterHandle: "", retweeterName };
      }
    }
  }

  // Alternative: Check for "Reposted" text anywhere in the article header
  const headerText = article.querySelector('div[data-testid="tweet"] > div:first-child')?.textContent?.toLowerCase() || "";
  if (headerText.includes("reposted") || headerText.includes("retweeted")) {
    // Try to extract the retweeter info
    const allLinks = article.querySelectorAll('a[role="link"]');
    for (const link of allLinks) {
      const href = link.getAttribute("href") || "";
      // Look for links in the header area (before the main tweet content)
      const parent = link.closest('div[data-testid="tweet"] > div');
      if (parent && href.startsWith("/") && !href.includes("/status/")) {
        // This might be the retweeter's profile link in the social context
        const handle = href.slice(1);
        const nameEl = link.querySelector('span');
        const name = nameEl?.textContent?.trim() || handle;
        return { retweeterHandle: handle, retweeterName: name };
      }
    }
  }

  return null;
}

/**
 * Get the original tweet author's name from a retweet article.
 * Used when extracting retweet content within a thread.
 */
function getOriginalAuthorFromArticle(article: Element): { handle: string; name: string } {
  let handle = "";
  let name = "";

  // In a retweet, the main author links point to the original tweeter
  const authorLinks = article.querySelectorAll('a[role="link"]');
  for (const link of authorLinks) {
    const href = link.getAttribute("href") || "";
    // Skip social context links, look for main tweet author
    if (href.startsWith("/") && !href.includes("/status/") && !href.includes("/photo/") && !href.includes("/video/")) {
      // Check if this is in the main tweet body (not the social context)
      const inMainTweet = link.closest('div[data-testid="tweetText"]') === null &&
                          link.closest('[data-testid="socialContext"]') === null;
      if (inMainTweet || !handle) {
        handle = href.slice(1);
        const nameEl = link.querySelector('span[lang]') || link.querySelector('span');
        if (nameEl) {
          name = nameEl.textContent?.trim() || handle;
        }
      }
    }
  }

  return { handle, name: name || handle };
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
 * Task 47: Retweets by the thread author are included in the thread.
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
          quotedTweet: getQuotedTweetFromArticle(article),
          poll: getPollFromArticle(article),
          linkCard: getLinkCardFromArticle(article)
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
        quotedTweet: getQuotedTweetFromArticle(article),
        poll: getPollFromArticle(article),
        linkCard: getLinkCardFromArticle(article)
      });
    } else {
      // Different author - check if this is a retweet by the main author (Task 47)
      const retweetInfo = getRetweetInfo(article);
      if (retweetInfo && (
        retweetInfo.retweeterHandle.toLowerCase() === mainTweetHandle.toLowerCase() ||
        retweetInfo.retweeterName.toLowerCase() === mainTweetHandle.toLowerCase()
      )) {
        // This is a retweet by the thread author - include it in the thread
        const originalAuthor = getOriginalAuthorFromArticle(article);
        position++;
        threadTweets.push({
          text: getTextFromArticle(article),
          timestamp: getTimestampFromArticle(article),
          position,
          media: getMediaFromArticle(article),
          engagement: getEngagementStatsFromArticle(article),
          quotedTweet: getQuotedTweetFromArticle(article),
          isRetweet: true,
          retweetAuthorHandle: originalAuthor.handle || handle,
          retweetAuthorName: originalAuthor.name,
          poll: getPollFromArticle(article),
          linkCard: getLinkCardFromArticle(article)
        });
      } else {
        // Different author and not a retweet by main author - this is a reply, thread has ended
        threadEnded = true;
      }
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
 * Extract author profile information including bio (Task 49)
 *
 * Tries multiple extraction methods:
 * 1. From hover cards/popovers (if user has hovered over profile)
 * 2. From profile link metadata
 * 3. From meta tags
 *
 * @param tweetArticle - The tweet article element
 * @param authorHandle - The author's handle
 */
function getAuthorInfo(tweetArticle: Element | null, authorHandle: string): TwitterAuthorInfo | undefined {
  if (!authorHandle) return undefined;

  const authorInfo: TwitterAuthorInfo = {
    name: "",
    handle: authorHandle
  };

  // Method 1: Try to extract from hover card/popover (if visible)
  // Twitter shows hover cards when user hovers over profile links
  const hoverCards = document.querySelectorAll('[data-testid="HoverCard"], [data-testid="popover"]');
  for (const card of hoverCards) {
    const cardHandle = card.querySelector('a[href="/' + authorHandle + '"]');
    if (cardHandle) {
      // Found a hover card for this author
      const nameEl = card.querySelector('span[lang]');
      if (nameEl) {
        authorInfo.name = nameEl.textContent?.trim() || "";
      }

      // Extract bio from the hover card
      const bioEl = card.querySelector('div[data-testid="UserDescription"]');
      if (bioEl) {
        authorInfo.bio = bioEl.textContent?.trim();
      }

      // Extract follower/following counts
      const statsContainer = card.querySelector('div[data-testid="UserProfileHeader_Items"]');
      if (statsContainer) {
        const statLinks = statsContainer.querySelectorAll('a[href*="/followers"], a[href*="/following"]');
        for (const link of statLinks) {
          const href = link.getAttribute("href") || "";
          const countText = link.textContent?.trim() || "";
          const count = parseEngagementCount(countText);
          if (href.includes("/followers")) {
            authorInfo.followersCount = count;
          } else if (href.includes("/following")) {
            authorInfo.followingCount = count;
          }
        }
      }

      // Extract avatar
      const avatarEl = card.querySelector('img[src*="profile_images"]');
      if (avatarEl) {
        authorInfo.avatar = avatarEl.getAttribute("src") || undefined;
      }

      // Extract location and website
      const locationEl = card.querySelector('span[data-testid="UserLocation"]');
      if (locationEl) {
        authorInfo.location = locationEl.textContent?.trim();
      }

      const websiteLink = card.querySelector('a[data-testid="UserUrl"]');
      if (websiteLink) {
        authorInfo.website = websiteLink.getAttribute("href") || websiteLink.textContent?.trim();
      }

      // Check for verified badge
      authorInfo.isVerified = card.querySelector('[data-testid="icon-verified"]') !== null;

      if (authorInfo.name || authorInfo.bio) {
        return authorInfo;
      }
    }
  }

  // Method 2: Extract from tweet article if available
  if (tweetArticle) {
    // Get name from the tweet
    const authorLinks = tweetArticle.querySelectorAll('a[role="link"]');
    for (const link of authorLinks) {
      const href = link.getAttribute("href") || "";
      if (href === "/" + authorHandle || href === "/" + authorHandle + "/") {
        const nameEl = link.querySelector('span[lang]');
        if (nameEl) {
          authorInfo.name = nameEl.textContent?.trim() || "";
        }
        break;
      }
    }

    // Get avatar from tweet
    const avatarEl = tweetArticle.querySelector('img[src*="profile_images"]');
    if (avatarEl) {
      authorInfo.avatar = avatarEl.getAttribute("src") || undefined;
    }

    // Check for verified badge
    authorInfo.isVerified = tweetArticle.querySelector('[data-testid="icon-verified"]') !== null;
  }

  // Method 3: Try meta tags for basic info
  if (!authorInfo.name) {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
    const titleMatch = ogTitle.match(/^(.+?)\s+on\s+(?:X|Twitter)/);
    if (titleMatch) {
      authorInfo.name = titleMatch[1].trim();
    }
  }

  // Method 4: Try to extract bio from page description meta tag
  if (!authorInfo.bio) {
    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
    // Format: ""Tweet text" — Author Name (@handle)"
    // The bio isn't typically in the meta description, but let's try to extract any context
    if (metaDesc && !metaDesc.includes("Tweet")) {
      authorInfo.bio = metaDesc;
    }
  }

  // Only return if we have at least a name
  return authorInfo.name ? authorInfo : undefined;
}

/**
 * Calculate aggregated thread statistics (Task 49)
 *
 * Sums up engagement metrics from all tweets in the thread
 * and calculates average engagement per tweet.
 *
 * @param threadTweets - Array of thread tweets
 * @returns Aggregated thread statistics
 */
function calculateThreadStats(threadTweets: TwitterThreadTweet[]): TwitterThreadStats {
  const stats: TwitterThreadStats = {
    totalReplies: 0,
    totalRetweets: 0,
    totalLikes: 0,
    tweetCount: threadTweets.length,
    avgEngagement: {
      replies: 0,
      retweets: 0,
      likes: 0
    }
  };

  let hasViews = false;
  let hasBookmarks = false;

  for (const tweet of threadTweets) {
    stats.totalReplies += tweet.engagement.replies;
    stats.totalRetweets += tweet.engagement.retweets;
    stats.totalLikes += tweet.engagement.likes;

    if (tweet.engagement.views !== undefined) {
      stats.totalViews = (stats.totalViews || 0) + tweet.engagement.views;
      hasViews = true;
    }

    if (tweet.engagement.bookmarks !== undefined) {
      stats.totalBookmarks = (stats.totalBookmarks || 0) + tweet.engagement.bookmarks;
      hasBookmarks = true;
    }
  }

  // Clean up undefined values if none of the tweets had them
  if (!hasViews) {
    stats.totalViews = undefined;
  }
  if (!hasBookmarks) {
    stats.totalBookmarks = undefined;
  }

  // Calculate averages
  const count = threadTweets.length || 1;
  stats.avgEngagement.replies = Math.round(stats.totalReplies / count);
  stats.avgEngagement.retweets = Math.round(stats.totalRetweets / count);
  stats.avgEngagement.likes = Math.round(stats.totalLikes / count);

  return stats;
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

  // Extract poll and link card from main tweet (Task 48)
  // Note: tweetArticle is already defined at the top of this function
  const poll = tweetArticle ? getPollFromArticle(tweetArticle) : undefined;
  const linkCard = tweetArticle ? getLinkCardFromArticle(tweetArticle) : undefined;

  // Extract author info including bio (Task 49)
  const authorInfo = getAuthorInfo(tweetArticle, authorHandle);

  // Calculate thread stats if this is a thread (Task 49)
  const threadStats = isThread && threadTweets.length > 0
    ? calculateThreadStats(threadTweets)
    : undefined;

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
    hasMoreInThread,
    poll,
    linkCard,
    authorInfo,
    threadStats
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
 * Format poll as markdown (Task 48)
 */
function formatPollAsMarkdown(poll: TwitterPoll): string {
  let md = `\n\n**📊 Poll**`;
  if (poll.hasEnded) {
    md += ` (ended)`;
  }
  md += `\n\n`;

  // Sort options by percentage (winners first)
  const sortedOptions = [...poll.options].sort((a, b) => {
    const aPct = a.percentage ?? 0;
    const bPct = b.percentage ?? 0;
    return bPct - aPct;
  });

  for (const option of sortedOptions) {
    let line = `- ${option.label}`;
    if (option.percentage !== undefined) {
      line += ` — **${option.percentage}%**`;
    }
    if (option.votes !== undefined) {
      line += ` (${formatNumber(option.votes)} votes)`;
    }
    if (option.isWinner) {
      line += ` ✓`;
    }
    md += `${line}\n`;
  }

  if (poll.totalVotes) {
    md += `\n*${formatNumber(poll.totalVotes)} total votes*`;
  }
  if (poll.endTime && !poll.hasEnded) {
    const endDate = new Date(poll.endTime);
    md += `\n*Ends: ${endDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })}*`;
  }

  return md;
}

/**
 * Format link card as markdown (Task 48)
 */
function formatLinkCardAsMarkdown(card: TwitterLinkCard): string {
  let md = `\n\n**🔗 Link Card**\n\n`;

  if (card.image) {
    md += `![${card.title || "Card image"}](${card.image})\n\n`;
  }

  if (card.title) {
    md += `**${card.title}**\n\n`;
  }

  if (card.description) {
    md += `${card.description}\n\n`;
  }

  if (card.domain) {
    md += `🌐 ${card.domain}`;
    if (card.url) {
      md += ` — [Open link](${card.url})`;
    }
  } else if (card.url) {
    md += `🔗 [${card.url}](${card.url})`;
  }

  return md;
}

/**
 * Build markdown for a fallback result (Task 54).
 * Used when DOM extraction fails and we got content from oEmbed/Nitter.
 */
function buildFallbackMarkdown(
  result: ClipResult,
  fallback: FallbackResult,
  tweetInfo: Partial<TwitterTweetInfo>
): string {
  let markdown = `# ${fallback.authorName || "Unknown Author"}`;
  if (fallback.authorHandle) {
    markdown += ` (@${fallback.authorHandle})`;
  }
  markdown += "\n\n";

  // Timestamp if available
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

  markdown += `---\n\n`;
  markdown += `${fallback.text}\n`;

  // Add source attribution
  markdown += `\n\n---\n\n`;
  markdown += `> ℹ️ **Note:** Content extracted via ${fallback.source === "oembed" ? "Twitter oEmbed API" : "Nitter"} fallback `;
  markdown += `(DOM extraction unavailable).\n`;

  markdown += `\n---\n\n`;
  markdown += `[View on X/Twitter](${result.url})\n`;

  return markdown;
}

/**
 * Extract Twitter/X content from the current page.
 *
 * Implements single tweet extraction (Task 45) and thread detection (Task 46).
 * Full thread markdown formatting is implemented in Tasks 47-50.
 * Task 54: Added fallback to oEmbed API and Nitter for auth-wall scenarios.
 *
 * @param result - The base clip result to populate
 * @returns Promise<ClipResult> with Twitter content
 */
export async function extractTwitterContent(
  result: ClipResult
): Promise<ClipResult> {
  // Task 51: Use "tweet" type for Twitter content
  result.metadata.type = "tweet";

  // Task 54: Check for auth wall before attempting DOM extraction
  const hasAuthWall = detectAuthWall();

  const tweetInfo = getTweetInfo();

  // Task 54: If DOM extraction failed or auth wall detected, try fallbacks
  let fallbackResult: FallbackResult | null = null;
  const extractionFailed = isExtractionEmpty(tweetInfo);

  if (hasAuthWall || extractionFailed) {
    console.log("[Twitter] DOM extraction issue detected, trying fallbacks...");
    console.log(`[Twitter] Auth wall: ${hasAuthWall}, Extraction empty: ${extractionFailed}`);

    // Try fallback methods
    fallbackResult = await tryFallbacks(result.url);

    if (fallbackResult) {
      // Use fallback data to fill in missing info
      if (!tweetInfo.text && fallbackResult.text) {
        tweetInfo.text = fallbackResult.text;
      }
      if (!tweetInfo.authorHandle && fallbackResult.authorHandle) {
        tweetInfo.authorHandle = fallbackResult.authorHandle;
      }
      if (!tweetInfo.authorName && fallbackResult.authorName) {
        tweetInfo.authorName = fallbackResult.authorName;
      }
      // Mark that we used fallback for the source
      tweetInfo.text = fallbackResult.text;
      tweetInfo.authorHandle = fallbackResult.authorHandle || tweetInfo.authorHandle;
      tweetInfo.authorName = fallbackResult.authorName || tweetInfo.authorName;
    }
  }

  // Set metadata
  result.metadata.author = tweetInfo.authorName || tweetInfo.authorHandle;
  // Task 50: Use "Thread by @handle" for threads, "Tweet by @handle" for single tweets
  result.title = tweetInfo.authorHandle
    ? tweetInfo.isThread
      ? `Thread by @${tweetInfo.authorHandle}`
      : `Tweet by @${tweetInfo.authorHandle}`
    : result.title;
  result.metadata.publishedDate = tweetInfo.timestamp;

  // Task 51: Twitter-specific frontmatter fields
  result.metadata.twitterAuthorHandle = tweetInfo.authorHandle || undefined;
  result.metadata.twitterThreadLength = tweetInfo.isThread ? tweetInfo.threadLength : undefined;

  // Set engagement - use thread stats for threads, single tweet engagement otherwise
  if (tweetInfo.isThread && tweetInfo.threadStats) {
    result.metadata.twitterEngagement = {
      replies: tweetInfo.threadStats.totalReplies,
      retweets: tweetInfo.threadStats.totalRetweets,
      likes: tweetInfo.threadStats.totalLikes,
      views: tweetInfo.threadStats.totalViews,
      bookmarks: tweetInfo.threadStats.totalBookmarks
    };
  } else if (tweetInfo.engagement) {
    result.metadata.twitterEngagement = {
      replies: tweetInfo.engagement.replies,
      retweets: tweetInfo.engagement.retweets,
      likes: tweetInfo.engagement.likes,
      views: tweetInfo.engagement.views,
      bookmarks: tweetInfo.engagement.bookmarks
    };
  }

  // Build markdown - Task 50: Clean thread formatting with "# Thread by @handle"
  if (tweetInfo.isThread) {
    let markdown = `# Thread by @${tweetInfo.authorHandle || "Unknown"}`;
    if (tweetInfo.authorName) {
      markdown += ` (${tweetInfo.authorName})`;
    }
    markdown += "\n\n";
    result.markdown = markdown;
  } else {
    let markdown = `# ${tweetInfo.authorName || "Unknown Author"}`;
    if (tweetInfo.authorHandle) {
      markdown += ` (@${tweetInfo.authorHandle})`;
    }
    if (tweetInfo.isVerified) {
      markdown += ` ✓`;
    }
    markdown += "\n\n";
    result.markdown = markdown;
  }
  let markdown = result.markdown;

  // Author bio (Task 49)
  if (tweetInfo.authorInfo?.bio) {
    markdown += `> 📝 *${tweetInfo.authorInfo.bio}*\n\n`;
  }

  // Author profile stats (Task 49)
  if (tweetInfo.authorInfo && (tweetInfo.authorInfo.followersCount || tweetInfo.authorInfo.followingCount)) {
    const profileStats: string[] = [];
    if (tweetInfo.authorInfo.followersCount) {
      profileStats.push(`👥 ${formatNumber(tweetInfo.authorInfo.followersCount)} followers`);
    }
    if (tweetInfo.authorInfo.followingCount) {
      profileStats.push(`➡️ ${formatNumber(tweetInfo.authorInfo.followingCount)} following`);
    }
    if (tweetInfo.authorInfo.location) {
      profileStats.push(`📍 ${tweetInfo.authorInfo.location}`);
    }
    if (tweetInfo.authorInfo.website) {
      profileStats.push(`🔗 [Website](${tweetInfo.authorInfo.website})`);
    }
    if (profileStats.length > 0) {
      markdown += `<small>${profileStats.join(" • ")}</small>\n\n`;
    }
  }

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

  // Thread indicator with count and total stats (Task 49)
  if (tweetInfo.isThread) {
    markdown += `> 🧵 **Thread** (${tweetInfo.threadLength} tweets`;
    if (tweetInfo.hasMoreInThread) {
      markdown += ` + more`;
    }
    markdown += `)\n\n`;

    // Thread total stats summary (Task 49)
    if (tweetInfo.threadStats) {
      const stats = tweetInfo.threadStats;
      markdown += `> **Thread Totals:** `;
      const totalStats: string[] = [];
      totalStats.push(`💬 ${formatNumber(stats.totalReplies)} replies`);
      totalStats.push(`🔄 ${formatNumber(stats.totalRetweets)} reposts`);
      totalStats.push(`❤️ ${formatNumber(stats.totalLikes)} likes`);
      if (stats.totalViews) {
        totalStats.push(`👁️ ${formatNumber(stats.totalViews)} views`);
      }
      if (stats.totalBookmarks) {
        totalStats.push(`🔖 ${formatNumber(stats.totalBookmarks)} bookmarks`);
      }
      markdown += totalStats.join(" • ");
      markdown += `\n`;

      // Add average engagement
      markdown += `> *Avg per tweet: ${formatNumber(stats.avgEngagement.likes)} likes, ${formatNumber(stats.avgEngagement.retweets)} reposts, ${formatNumber(stats.avgEngagement.replies)} replies*\n\n`;
    }
  }

  markdown += `---\n\n`;

  // Task 50: Format thread tweets as clean paragraphs with timestamps, separated by ---
  if (tweetInfo.isThread && tweetInfo.threadTweets && tweetInfo.threadTweets.length > 0) {
    for (let i = 0; i < tweetInfo.threadTweets.length; i++) {
      const tweet = tweetInfo.threadTweets[i];

      // Task 50: Each tweet as a clean paragraph with timestamp
      // Timestamp first (compact inline format)
      if (tweet.timestamp) {
        const date = new Date(tweet.timestamp);
        const dateStr = date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
        markdown += `*${dateStr}`;
        if (tweet.isRetweet) {
          markdown += ` — 🔄 Repost`;
        }
        markdown += `*\n\n`;
      }

      // Retweet attribution if applicable
      if (tweet.isRetweet && tweet.retweetAuthorName && tweet.retweetAuthorHandle) {
        markdown += `**Originally by ${tweet.retweetAuthorName} (@${tweet.retweetAuthorHandle}):**\n\n`;
      }

      // Tweet text as paragraph
      if (tweet.text) {
        markdown += `${tweet.text}\n`;
      }

      // Media attachments inline
      if (tweet.media.length > 0) {
        markdown += `\n`;
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

      // Poll (Task 48) - simplified format
      if (tweet.poll) {
        markdown += `\n\n📊 **Poll:**`;
        for (const option of tweet.poll.options) {
          let optText = ` ${option.label}`;
          if (option.percentage !== undefined) {
            optText += ` (${option.percentage}%)`;
          }
          markdown += optText;
        }
        if (tweet.poll.totalVotes) {
          markdown += ` — ${formatNumber(tweet.poll.totalVotes)} votes`;
        }
      }

      // Link card (Task 48) - simplified format
      if (tweet.linkCard) {
        markdown += `\n\n🔗 [${tweet.linkCard.title || tweet.linkCard.domain || "Link"}](${tweet.linkCard.url})`;
      }

      // Quoted tweet
      if (tweet.quotedTweet) {
        markdown += `\n\n> **Quoted @${tweet.quotedTweet.authorHandle}:** ${tweet.quotedTweet.text}`;
      }

      // Task 50: --- separator between tweets
      markdown += `\n\n---\n\n`;
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
      if (hasAuthWall) {
        markdown += `> 🔒 **Auth wall detected.** `;
        markdown += `Try logging in to X/Twitter for full content access.\n`;
      }
    }

    // Task 54: Add source attribution if fallback was used
    if (fallbackResult && fallbackResult.text) {
      markdown += `\n\n> ℹ️ *Content extracted via ${fallbackResult.source === "oembed" ? "Twitter oEmbed API" : "Nitter"} fallback.*\n`;
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

    // Poll (Task 48)
    if (tweetInfo.poll) {
      markdown += formatPollAsMarkdown(tweetInfo.poll);
    }

    // Link card (Task 48)
    if (tweetInfo.linkCard) {
      markdown += formatLinkCardAsMarkdown(tweetInfo.linkCard);
    }

    // Quoted tweet
    if (tweetInfo.quotedTweet) {
      markdown += `\n\n---\n\n`;
      markdown += `**Quoted Tweet from @${tweetInfo.quotedTweet.authorHandle}:**\n\n`;
      markdown += `> ${tweetInfo.quotedTweet.text}\n`;
    }
  }

  // Engagement stats (total from main tweet, or thread totals if thread)
  const { engagement, isThread, threadStats } = tweetInfo;
  markdown += `\n\n---\n\n`;

  if (isThread && threadStats) {
    // For threads, show aggregated stats (already shown at top, but also here for reference)
    markdown += `**Thread Engagement Total:** `;
    const stats: string[] = [];
    stats.push(`💬 ${formatNumber(threadStats.totalReplies)} replies`);
    stats.push(`🔄 ${formatNumber(threadStats.totalRetweets)} reposts`);
    stats.push(`❤️ ${formatNumber(threadStats.totalLikes)} likes`);
    if (threadStats.totalBookmarks) {
      stats.push(`🔖 ${formatNumber(threadStats.totalBookmarks)} bookmarks`);
    }
    if (threadStats.totalViews) {
      stats.push(`👁️ ${formatNumber(threadStats.totalViews)} views`);
    }
    markdown += stats.join(" • ");
    markdown += `\n`;
  } else {
    // Single tweet engagement
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
    markdown += stats.length > 0 ? stats.join(" • ") : "No engagement data";
    markdown += `\n`;
  }

  markdown += `\n---\n\n`;
  markdown += `[View on X/Twitter](${result.url})\n`;

  result.markdown = markdown;

  return result;
}
