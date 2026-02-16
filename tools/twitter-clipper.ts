#!/usr/bin/env bun
/**
 * Twitter/X Headless Clipper
 *
 * A Puppeteer-based CLI tool to extract Twitter/X threads and save them
 * as Obsidian-compatible markdown files.
 *
 * Usage:
 *   # Single tweet or thread
 *   bun run tools/twitter-clipper.ts https://twitter.com/user/status/123456
 *   bun run tools/twitter-clipper.ts https://x.com/user/status/123456
 *
 *   # Multiple URLs
 *   bun run tools/twitter-clipper.ts https://x.com/user1/status/111 https://x.com/user2/status/222
 *
 *   # From a file (one URL per line)
 *   bun run tools/twitter-clipper.ts --file urls.txt
 *
 *   # Output as JSON (for LLM tool calls)
 *   bun run tools/twitter-clipper.ts --json https://x.com/user/status/123456
 *
 *   # Dump markdown to stdout
 *   bun run tools/twitter-clipper.ts --stdout https://x.com/user/status/123456
 *
 *   # Save directly to Obsidian via CLI
 *   bun run tools/twitter-clipper.ts --cli --vault "My Vault" --folder "Notes/Twitter" https://x.com/user/status/123456
 *
 *   # Use Chrome profile for authenticated access (RECOMMENDED for full threads)
 *   bun run tools/twitter-clipper.ts --profile ~/.config/google-chrome/Default https://x.com/user/status/123456
 *
 *   # Show the browser (for debugging/logging in)
 *   bun run tools/twitter-clipper.ts --no-headless https://x.com/user/status/123456
 *
 *   # Wait longer for slow connections
 *   bun run tools/twitter-clipper.ts --wait 15000 https://x.com/user/status/123456
 *
 * Prerequisites:
 *   bun add puppeteer    (or: npm install puppeteer)
 */

import { resolve } from "node:path";
import { saveViaCli, type CliSaveResult } from "../src/shared/obsidianCliSave";
import { sanitizeFilename } from "../src/shared/sanitize";
import { buildFrontmatterYaml, type FrontmatterInput } from "../src/shared/markdown";
import {
  launchBrowser,
  createPage,
  resolveUrls,
  createLogger,
  formatNumber,
  parseEngagementCount,
  type CommonCLIOptions,
  type Logger,
  type ToolOutput,
} from "./lib/clipper-core";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Twitter-specific data included in ToolOutput.data
 */
interface TwitterOutputData {
  tweet_id: string;
  author_handle: string;
  author_name: string;
  is_thread: boolean;
  thread_length?: number;
  text: string;
  engagement: TwitterEngagement;
  media: TwitterMedia[];
  thread_tweets: TwitterThreadTweet[];
  quoted_tweet?: {
    authorHandle: string;
    text: string;
  };
}

interface CLIOptions extends CommonCLIOptions {
  urls: string[];
}

interface TwitterMedia {
  type: "image" | "video" | "gif";
  url: string;
  altText?: string;
}

interface TwitterEngagement {
  replies: number;
  retweets: number;
  likes: number;
  views?: number;
  bookmarks?: number;
}

interface TwitterThreadTweet {
  text: string;
  timestamp: string;
  position: number;
  media: TwitterMedia[];
  engagement: TwitterEngagement;
  isRetweet?: boolean;
  retweetAuthorHandle?: string;
  retweetAuthorName?: string;
  quotedTweet?: {
    authorHandle: string;
    text: string;
  };
}

interface TwitterAuthorInfo {
  name: string;
  handle: string;
  bio?: string;
  avatar?: string;
  isVerified?: boolean;
  followersCount?: number;
  followingCount?: number;
  location?: string;
  website?: string;
}

interface ExtractedTweet {
  tweetId: string;
  url: string;
  text: string;
  authorName: string;
  authorHandle: string;
  authorAvatar?: string;
  isVerified?: boolean;
  timestamp: string;
  isThread: boolean;
  threadLength?: number;
  threadTweets: TwitterThreadTweet[];
  media: TwitterMedia[];
  engagement: TwitterEngagement;
  quotedTweet?: {
    authorHandle: string;
    text: string;
  };
  authorInfo?: TwitterAuthorInfo;
  hasMoreInThread?: boolean;
  error?: string;
}

interface ThreadResult {
  url: string;
  success: boolean;
  tweet?: ExtractedTweet;
  markdown?: string;
  error?: string;
}

type TwitterOutput = ToolOutput<TwitterOutputData>;

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[], log: Logger): CLIOptions {
  const opts: CLIOptions = {
    urls: [],
    cli: false,
    cliPath: "obsidian-cli",
    vault: "Main Vault",
    folder: "Clips/Twitter",
    profile: null,
    headless: true,
    wait: 8000,
    tags: ["twitter", "social", "web-clip"],
    json: false,
    stdout: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--file" || arg === "-f") {
      i++;
      const filePath = argv[i];
      if (!filePath) {
        log.error("--file requires a path argument");
        process.exit(1);
      }
      opts.urls.push(`@file:${filePath}`);
    } else if (arg === "--cli") {
      opts.cli = true;
    } else if (arg === "--cli-path") {
      i++;
      opts.cliPath = argv[i] || opts.cliPath;
    } else if (arg === "--vault") {
      i++;
      opts.vault = argv[i] || opts.vault;
    } else if (arg === "--folder") {
      i++;
      opts.folder = argv[i] || opts.folder;
    } else if (arg === "--profile") {
      i++;
      opts.profile = argv[i] || null;
    } else if (arg === "--no-headless") {
      opts.headless = false;
    } else if (arg === "--wait") {
      i++;
      opts.wait = parseInt(argv[i] || "8000", 10);
    } else if (arg === "--tags") {
      i++;
      opts.tags = (argv[i] || "").split(",").map((t) => t.trim()).filter(Boolean);
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--stdout") {
      opts.stdout = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("http")) {
      opts.urls.push(arg);
    } else {
      log.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }

    i++;
  }

  return opts;
}

function printHelp(): void {
  console.log(`
Twitter/X Headless Clipper — Extract tweets and threads to Obsidian markdown

USAGE:
  bun run tools/twitter-clipper.ts [OPTIONS] <URL> [<URL> ...]

OPTIONS:
  --file, -f <path>     Read URLs from a text file (one per line)
  --cli                 Use Obsidian CLI directly for file creation
  --cli-path <path>     Path to obsidian-cli binary (default: obsidian-cli from PATH)
  --vault <name>        Obsidian vault name (default: "Main Vault")
  --folder <path>       Obsidian folder path (default: "Clips/Twitter")
  --profile <path>      Chrome user data dir (for auth cookies)
  --no-headless         Show the browser window
  --wait <ms>           Wait time for page load (default: 8000)
  --tags <a,b,c>        Comma-separated tags (default: "twitter,social,web-clip")
  --json                Output structured JSON to stdout (for LLM tool calls)
  --stdout              Dump raw markdown to stdout (for piping)
  --help, -h            Show this help message

EXAMPLES:
  # Clip a single tweet
  bun run tools/twitter-clipper.ts https://x.com/user/status/123456

  # Clip a full thread (requires --profile for private accounts)
  bun run tools/twitter-clipper.ts --profile ~/.config/google-chrome/Default https://x.com/user/status/123456

  # Save directly to Obsidian via CLI
  bun run tools/twitter-clipper.ts --cli --vault "My Vault" --folder "Notes/Twitter" https://x.com/user/status/123456

  # LLM tool call: get structured JSON back
  bun run tools/twitter-clipper.ts --json https://x.com/user/status/123456

  # Pipe markdown to another tool
  bun run tools/twitter-clipper.ts --stdout https://x.com/user/status/123456 | head -100

OUTPUT FORMAT (--json):
  Single URL:
    {
      "success": true,
      "url": "https://x.com/user/status/...",
      "title": "Tweet by @user",
      "markdown": "...",
      "content": "Tweet text...",
      "metadata": {
        "tweet_id": "123456",
        "author_handle": "user",
        "author_name": "Display Name",
        "is_thread": false,
        "engagement": { "replies": 10, "retweets": 5, "likes": 50 },
        ...
      },
      "data": {
        "tweet_id": "...",
        "text": "...",
        "thread_tweets": [...],
        ...
      }
    }

  Multiple URLs (batch):
    {
      "success": true,
      "total": 2,
      "succeeded": 2,
      "failed": 0,
      "results": [ ToolOutput, ToolOutput, ... ]
    }
`);
}

// ─── Page Extraction Functions ───────────────────────────────────────────────

/**
 * Extract tweet ID from URL
 */
function extractTweetId(url: string): string {
  const match = url.match(/status\/(\d+)/);
  return match?.[1] || "";
}

/**
 * Extract engagement stats from aria-labels in the page (runs in browser context)
 */
function extractEngagementInPage(): TwitterEngagement {
  const engagement: TwitterEngagement = {
    replies: 0,
    retweets: 0,
    likes: 0,
  };

  const buttons = document.querySelectorAll('button[aria-label]');

  for (const button of buttons) {
    const label = button.getAttribute("aria-label")?.toLowerCase() || "";
    const value = button.getAttribute("aria-label") || "";

    if (label.includes("repl")) {
      engagement.replies = parseEngagementCount(value);
    } else if (label.includes("repost") || label.includes("retweet")) {
      engagement.retweets = parseEngagementCount(value);
    } else if (label.includes("like")) {
      engagement.likes = parseEngagementCount(value);
    } else if (label.includes("view")) {
      engagement.views = parseEngagementCount(value);
    } else if (label.includes("bookmark")) {
      engagement.bookmarks = parseEngagementCount(value);
    }
  }

  return engagement;
}

/**
 * Get author handle from a tweet article element (runs in browser context)
 */
function getAuthorHandleFromArticle(article: Element): string {
  const authorLinks = article.querySelectorAll('a[role="link"]');
  for (const link of authorLinks) {
    const href = link.getAttribute("href") || "";
    if (href.startsWith("/") && !href.includes("/status/") && !href.includes("/photo/") && !href.includes("/video/")) {
      return href.slice(1);
    }
  }
  return "";
}

/**
 * Get tweet text from article element (runs in browser context)
 */
function getTextFromArticle(article: Element): string {
  const tweetTextEl = article.querySelector('div[data-testid="tweetText"]');
  return tweetTextEl?.textContent?.trim() || "";
}

/**
 * Get timestamp from article element (runs in browser context)
 */
function getTimestampFromArticle(article: Element): string {
  const timeEl = article.querySelector("time");
  return timeEl?.getAttribute("datetime") || timeEl?.textContent?.trim() || "";
}

/**
 * Get media from article element (runs in browser context)
 */
function getMediaFromArticle(article: Element): TwitterMedia[] {
  const media: TwitterMedia[] = [];

  const images = article.querySelectorAll('div[data-testid="tweetPhoto"] img');
  for (const img of images) {
    const src = img.getAttribute("src");
    if (src && !src.includes("profile_images")) {
      media.push({
        type: "image",
        url: src,
        altText: img.getAttribute("alt") || undefined,
      });
    }
  }

  const videos = article.querySelectorAll("video");
  for (const video of videos) {
    const poster = video.getAttribute("poster");
    const src = video.querySelector("source")?.getAttribute("src") || poster;
    if (src) {
      const isGif = src.includes("tweet_video_gif") || video.hasAttribute("loop");
      media.push({
        type: isGif ? "gif" : "video",
        url: poster || src,
      });
    }
  }

  return media;
}

/**
 * Get engagement stats from a specific article element (runs in browser context)
 */
function getEngagementFromArticle(article: Element): TwitterEngagement {
  const engagement: TwitterEngagement = {
    replies: 0,
    retweets: 0,
    likes: 0,
  };

  const buttons = article.querySelectorAll('button[aria-label]');
  for (const button of buttons) {
    const label = button.getAttribute("aria-label")?.toLowerCase() || "";
    const value = button.getAttribute("aria-label") || "";

    if (label.includes("repl")) {
      engagement.replies = parseEngagementCount(value);
    } else if (label.includes("repost") || label.includes("retweet")) {
      engagement.retweets = parseEngagementCount(value);
    } else if (label.includes("like")) {
      engagement.likes = parseEngagementCount(value);
    } else if (label.includes("view")) {
      engagement.views = parseEngagementCount(value);
    } else if (label.includes("bookmark")) {
      engagement.bookmarks = parseEngagementCount(value);
    }
  }

  return engagement;
}

/**
 * Get quoted tweet from article element (runs in browser context)
 */
function getQuotedTweetFromArticle(article: Element): TwitterThreadTweet["quotedTweet"] {
  const quoteContainer = article.querySelector('div[data-testid="tweet"] > div[role="link"]');
  if (!quoteContainer) return undefined;

  const quoteText = quoteContainer.querySelector('div[data-testid="tweetText"]')?.textContent?.trim();
  if (!quoteText) return undefined;

  const quoteHandleMatch = quoteContainer.textContent?.match(/@(\w+)/);
  if (!quoteHandleMatch) return undefined;

  return {
    authorHandle: quoteHandleMatch[1],
    text: quoteText,
  };
}

/**
 * Check for retweet indicator (runs in browser context)
 */
function getRetweetInfo(article: Element): { retweeterHandle: string; retweeterName: string } | null {
  const socialContext = article.querySelector('[data-testid="socialContext"]');
  if (socialContext) {
    const text = socialContext.textContent?.toLowerCase() || "";
    if (text.includes("reposted") || text.includes("retweeted")) {
      const match = socialContext.textContent?.match(/^(.+?)\s+Reposted/i);
      if (match) {
        let retweeterName = match[1].trim();
        if (retweeterName.startsWith("@")) {
          return { retweeterHandle: retweeterName.slice(1), retweeterName: retweeterName.slice(1) };
        }
        return { retweeterHandle: "", retweeterName };
      }
    }
  }
  return null;
}

/**
 * Get original author from a retweet article (runs in browser context)
 */
function getOriginalAuthorFromArticle(article: Element): { handle: string; name: string } {
  let handle = "";
  let name = "";

  const authorLinks = article.querySelectorAll('a[role="link"]');
  for (const link of authorLinks) {
    const href = link.getAttribute("href") || "";
    if (href.startsWith("/") && !href.includes("/status/") && !href.includes("/photo/") && !href.includes("/video/")) {
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
 * Check for thread continuation indicator (runs in browser context)
 */
function hasThreadContinuation(): boolean {
  const showMoreButtons = document.querySelectorAll('div[role="button"], span');
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
 * Detect and extract a thread of tweets from the page (runs in browser context)
 */
function detectAndExtractThread(mainTweetHandle: string): TwitterThreadTweet[] {
  const threadTweets: TwitterThreadTweet[] = [];

  const allArticles = document.querySelectorAll('article[data-testid="tweet"]');
  if (allArticles.length <= 1) {
    return threadTweets;
  }

  let position = 0;
  let foundMainTweet = false;
  let threadEnded = false;

  for (const article of allArticles) {
    const handle = getAuthorHandleFromArticle(article);

    if (!foundMainTweet) {
      if (handle === mainTweetHandle) {
        foundMainTweet = true;
        position = 1;
        threadTweets.push({
          text: getTextFromArticle(article),
          timestamp: getTimestampFromArticle(article),
          position: 1,
          media: getMediaFromArticle(article),
          engagement: getEngagementFromArticle(article),
          quotedTweet: getQuotedTweetFromArticle(article),
        });
      }
      continue;
    }

    if (threadEnded) break;

    if (handle === mainTweetHandle) {
      position++;
      threadTweets.push({
        text: getTextFromArticle(article),
        timestamp: getTimestampFromArticle(article),
        position,
        media: getMediaFromArticle(article),
        engagement: getEngagementFromArticle(article),
        quotedTweet: getQuotedTweetFromArticle(article),
      });
    } else {
      const retweetInfo = getRetweetInfo(article);
      if (retweetInfo && (
        retweetInfo.retweeterHandle.toLowerCase() === mainTweetHandle.toLowerCase() ||
        retweetInfo.retweeterName.toLowerCase() === mainTweetHandle.toLowerCase()
      )) {
        const originalAuthor = getOriginalAuthorFromArticle(article);
        position++;
        threadTweets.push({
          text: getTextFromArticle(article),
          timestamp: getTimestampFromArticle(article),
          position,
          media: getMediaFromArticle(article),
          engagement: getEngagementFromArticle(article),
          quotedTweet: getQuotedTweetFromArticle(article),
          isRetweet: true,
          retweetAuthorHandle: originalAuthor.handle || handle,
          retweetAuthorName: originalAuthor.name,
        });
      } else {
        threadEnded = true;
      }
    }
  }

  return threadTweets.length > 1 ? threadTweets : [];
}

/**
 * Extract tweet content from the page (runs in browser context)
 */
function extractTweetInPage(): ExtractedTweet {
  const url = window.location.href;
  const tweetIdMatch = url.match(/status\/(\d+)/);
  const tweetId = tweetIdMatch?.[1] || "";

  const tweetArticle = document.querySelector('article[data-testid="tweet"]');

  let text = "";
  let authorName = "";
  let authorHandle = "";
  let authorAvatar: string | undefined;
  let isVerified = false;
  let timestamp = "";

  if (tweetArticle) {
    const tweetTextEl = tweetArticle.querySelector('div[data-testid="tweetText"]');
    if (tweetTextEl) {
      text = tweetTextEl.textContent?.trim() || "";
    }

    const authorLinks = tweetArticle.querySelectorAll('a[role="link"]');
    for (const link of authorLinks) {
      const href = link.getAttribute("href") || "";
      if (href.startsWith("/") && !href.includes("/status/")) {
        authorHandle = href.slice(1);
        const nameEl = link.querySelector('span[lang]');
        if (nameEl) {
          authorName = nameEl.textContent?.trim() || "";
        }
        break;
      }
    }

    isVerified = tweetArticle.querySelector('[data-testid="icon-verified"]') !== null;

    const timeEl = tweetArticle.querySelector("time");
    if (timeEl) {
      timestamp = timeEl.getAttribute("datetime") || timeEl.textContent?.trim() || "";
    }

    const avatarImg = tweetArticle.querySelector('img[src*="profile_images"]');
    if (avatarImg) {
      authorAvatar = avatarImg.getAttribute("src") || undefined;
    }
  }

  // Fallback to meta tags
  if (!text) {
    text =
      document.querySelector('meta[name="description"]')?.getAttribute("content") ||
      document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
      "";

    const metaMatch = text.match(/^[""](.+?)[""]\s*[—-]\s*@/);
    if (metaMatch) {
      text = metaMatch[1];
    }
  }

  if (!authorName || !authorHandle) {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
    const titleMatch = ogTitle.match(/^(.+?)\s+(?:on\s+(?:X|Twitter)|\(@(.+?)\))/);
    if (titleMatch) {
      if (!authorName) authorName = titleMatch[1].trim();
      if (!authorHandle) authorHandle = titleMatch[2] || "";
    }
  }

  if (!authorHandle) {
    const handleMatch = url.match(/(?:twitter|x)\.com\/([^/]+)(?:\/status)?/);
    if (handleMatch && handleMatch[1] !== "status" && handleMatch[1] !== "i") {
      authorHandle = handleMatch[1];
    }
  }

  // Get media and engagement
  const media: TwitterMedia[] = [];

  if (tweetArticle) {
    const images = tweetArticle.querySelectorAll('div[data-testid="tweetPhoto"] img');
    for (const img of images) {
      const src = img.getAttribute("src");
      if (src && !src.includes("profile_images")) {
        media.push({
          type: "image",
          url: src,
          altText: img.getAttribute("alt") || undefined,
        });
      }
    }

    const videos = tweetArticle.querySelectorAll("video");
    for (const video of videos) {
      const poster = video.getAttribute("poster");
      const src = video.querySelector("source")?.getAttribute("src") || poster;
      if (src) {
        const isGif = src.includes("tweet_video_gif") || video.hasAttribute("loop");
        media.push({
          type: isGif ? "gif" : "video",
          url: poster || src,
        });
      }
    }
  }

  const engagement = extractEngagementInPage();

  // Check for quoted tweet
  let quotedTweet: ExtractedTweet["quotedTweet"];
  const quoteDiv = tweetArticle?.querySelector('div[data-testid="tweet"] div[role="link"]');
  if (quoteDiv) {
    const quoteText = quoteDiv.querySelector('div[data-testid="tweetText"]')?.textContent?.trim();
    const quoteHandleMatch = quoteDiv.innerHTML.match(/@(\w+)/);
    if (quoteText && quoteHandleMatch) {
      quotedTweet = {
        authorHandle: quoteHandleMatch[1],
        text: quoteText,
      };
    }
  }

  // Detect thread
  const threadTweets = detectAndExtractThread(authorHandle);
  const isThread = threadTweets.length > 0;
  const threadLength = isThread ? threadTweets.length : undefined;
  const hasMoreInThread = isThread && hasThreadContinuation();

  return {
    tweetId,
    url,
    text: text.trim(),
    authorName,
    authorHandle,
    authorAvatar,
    isVerified,
    timestamp,
    isThread,
    threadLength,
    threadTweets,
    media,
    engagement,
    quotedTweet,
    hasMoreInThread,
  };
}

// ─── Core Extraction Logic ───────────────────────────────────────────────────

async function extractThread(
  page: import("puppeteer").Page,
  url: string,
  waitMs: number,
  log: Logger
): Promise<ThreadResult> {
  try {
    log(`  → Navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    log(`  → Waiting ${waitMs}ms for content to render...`);
    await new Promise((r) => setTimeout(r, waitMs));

    // Wait for tweet to load
    try {
      await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });
    } catch {
      log.warn("No tweet found after waiting. Page might require login.");
    }

    // Additional wait for dynamic content
    await new Promise((r) => setTimeout(r, 2000));

    const tweet = await page.evaluate(extractTweetInPage);

    if (!tweet.text && tweet.media.length === 0) {
      return {
        url,
        success: false,
        error: "No tweet content found — you may need to log in (use --profile or --no-headless)",
      };
    }

    log(`  ✓ Extracted tweet${tweet.isThread ? ` (thread: ${tweet.threadLength} tweets)` : ""} by @${tweet.authorHandle}`);

    return {
      url,
      success: true,
      tweet,
      markdown: buildTweetMarkdown(tweet),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      url,
      success: false,
      error: message,
    };
  }
}

// ─── Markdown Generation ─────────────────────────────────────────────────────

function buildTweetMarkdown(tweet: ExtractedTweet): string {
  let markdown = "";

  // Title
  if (tweet.isThread) {
    markdown = `# Thread by @${tweet.authorHandle || "Unknown"}`;
    if (tweet.authorName) {
      markdown += ` (${tweet.authorName})`;
    }
    markdown += "\n\n";
  } else {
    markdown = `# ${tweet.authorName || "Unknown Author"}`;
    if (tweet.authorHandle) {
      markdown += ` (@${tweet.authorHandle})`;
    }
    if (tweet.isVerified) {
      markdown += ` ✓`;
    }
    markdown += "\n\n";
  }

  // Timestamp
  if (tweet.timestamp) {
    const date = new Date(tweet.timestamp);
    const dateStr = date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    markdown += `> 📅 ${dateStr}\n\n`;
  }

  // Thread indicator
  if (tweet.isThread) {
    markdown += `> 🧵 **Thread** (${tweet.threadLength} tweets`;
    if (tweet.hasMoreInThread) {
      markdown += ` + more`;
    }
    markdown += `)\n\n`;
  }

  markdown += `---\n\n`;

  // Thread tweets
  if (tweet.isThread && tweet.threadTweets.length > 0) {
    for (const threadTweet of tweet.threadTweets) {
      // Timestamp
      if (threadTweet.timestamp) {
        const date = new Date(threadTweet.timestamp);
        const dateStr = date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        markdown += `*${dateStr}`;
        if (threadTweet.isRetweet) {
          markdown += ` — 🔄 Repost`;
        }
        markdown += `*\n\n`;
      }

      // Retweet attribution
      if (threadTweet.isRetweet && threadTweet.retweetAuthorName && threadTweet.retweetAuthorHandle) {
        markdown += `**Originally by ${threadTweet.retweetAuthorName} (@${threadTweet.retweetAuthorHandle}):**\n\n`;
      }

      // Tweet text
      if (threadTweet.text) {
        markdown += `${threadTweet.text}\n`;
      }

      // Media
      if (threadTweet.media.length > 0) {
        markdown += `\n`;
        for (const media of threadTweet.media) {
          if (media.type === "image") {
            markdown += `\n![${media.altText || "Image"}](${media.url})`;
          } else if (media.type === "video" || media.type === "gif") {
            const emoji = media.type === "gif" ? "🎬" : "🎥";
            markdown += `\n${emoji} [${media.type === "gif" ? "GIF" : "Video"}](${media.url})`;
          }
        }
      }

      // Quoted tweet
      if (threadTweet.quotedTweet) {
        markdown += `\n\n> **Quoted @${threadTweet.quotedTweet.authorHandle}:** ${threadTweet.quotedTweet.text}`;
      }

      markdown += `\n\n---\n\n`;
    }

    // Note if there's more content
    if (tweet.hasMoreInThread) {
      markdown += `> ⚠️ **Note:** This thread has additional tweets not visible on the current page.\n`;
      markdown += `> [View full thread on X/Twitter](${tweet.url})\n\n`;
    }
  } else {
    // Single tweet
    if (tweet.text) {
      markdown += `${tweet.text}\n`;
    }

    // Media
    if (tweet.media.length > 0) {
      markdown += `\n\n**Media:**\n`;
      for (const media of tweet.media) {
        if (media.type === "image") {
          markdown += `\n![${media.altText || "Image"}](${media.url})`;
        } else if (media.type === "video" || media.type === "gif") {
          const emoji = media.type === "gif" ? "🎬" : "🎥";
          markdown += `\n${emoji} [${media.type === "gif" ? "GIF" : "Video"}](${media.url})`;
        }
      }
    }

    // Quoted tweet
    if (tweet.quotedTweet) {
      markdown += `\n\n---\n\n`;
      markdown += `**Quoted Tweet from @${tweet.quotedTweet.authorHandle}:**\n\n`;
      markdown += `> ${tweet.quotedTweet.text}\n`;
    }
  }

  // Engagement stats
  markdown += `\n\n---\n\n`;

  if (tweet.isThread && tweet.threadTweets.length > 0) {
    // Calculate thread totals
    let totalReplies = 0, totalRetweets = 0, totalLikes = 0;
    for (const t of tweet.threadTweets) {
      totalReplies += t.engagement.replies;
      totalRetweets += t.engagement.retweets;
      totalLikes += t.engagement.likes;
    }

    markdown += `**Thread Engagement Total:** `;
    const stats: string[] = [];
    stats.push(`💬 ${formatNumber(totalReplies)} replies`);
    stats.push(`🔄 ${formatNumber(totalRetweets)} reposts`);
    stats.push(`❤️ ${formatNumber(totalLikes)} likes`);
    markdown += stats.join(" • ");
    markdown += `\n`;
  } else {
    markdown += `**Engagement:** `;
    const stats: string[] = [];
    if (tweet.engagement.replies > 0) stats.push(`💬 ${formatNumber(tweet.engagement.replies)} replies`);
    if (tweet.engagement.retweets > 0) stats.push(`🔄 ${formatNumber(tweet.engagement.retweets)} reposts`);
    if (tweet.engagement.likes > 0) stats.push(`❤️ ${formatNumber(tweet.engagement.likes)} likes`);
    if (tweet.engagement.bookmarks && tweet.engagement.bookmarks > 0) {
      stats.push(`🔖 ${formatNumber(tweet.engagement.bookmarks)} bookmarks`);
    }
    if (tweet.engagement.views && tweet.engagement.views > 0) {
      stats.push(`👁️ ${formatNumber(tweet.engagement.views)} views`);
    }
    markdown += stats.length > 0 ? stats.join(" • ") : "No engagement data";
    markdown += `\n`;
  }

  markdown += `\n---\n\n`;
  markdown += `[View on X/Twitter](${tweet.url})\n`;

  return markdown;
}

function buildFullMarkdown(result: ThreadResult, opts: CLIOptions): string {
  if (!result.tweet) {
    return `# Error\n\n${result.error || "Unknown error"}\n`;
  }

  const tweet = result.tweet;

  const frontmatterInput: FrontmatterInput = {
    source: result.url,
    title: tweet.isThread
      ? `Thread by @${tweet.authorHandle}`
      : `Tweet by @${tweet.authorHandle}`,
    type: "article",
    dateClippedISO: new Date().toISOString(),
    tags: opts.tags,
    author: tweet.authorName,
    extra: {
      twitter_handle: tweet.authorHandle,
      tweet_id: tweet.tweetId,
      is_thread: tweet.isThread,
      thread_length: tweet.threadLength,
      verified: tweet.isVerified,
    },
  };

  const frontmatter = buildFrontmatterYaml(frontmatterInput);
  const body = result.markdown || "";

  return frontmatter + body + (body.endsWith("\n") ? "" : "\n");
}

// ─── Save Logic ──────────────────────────────────────────────────────────────

async function saveResult(result: ThreadResult, opts: CLIOptions, log: Logger): Promise<void> {
  if (!result.success) {
    log(`  ✗ Failed: ${result.error}`);
    return;
  }

  const fullMarkdown = buildFullMarkdown(result, opts);

  // --stdout mode: dump markdown directly to stdout
  if (opts.stdout) {
    console.log(fullMarkdown);
    return;
  }

  // --json mode: handled in main
  if (opts.json) {
    return;
  }

  // --cli mode: use obsidian-cli directly
  if (opts.cli) {
    const title = result.tweet?.isThread
      ? `Thread by @${result.tweet.authorHandle}`
      : `Tweet by @${result.tweet?.authorHandle || "unknown"}`;

    const safeTitle = sanitizeFilename(title);
    const filePath = opts.folder ? `${opts.folder}/${safeTitle}` : safeTitle;

    const saveResult: CliSaveResult = await saveViaCli(
      { cliPath: opts.cliPath, vault: opts.vault, enabled: true },
      { filePath, content: fullMarkdown, overwrite: true }
    );

    if (saveResult.success) {
      log(`  📎 Saved via CLI: ${safeTitle}`);
    } else {
      log(`  ✗ CLI save failed: ${saveResult.error}`);
      log(`    Command: ${saveResult.command}`);
    }
    return;
  }

  // Default: output markdown to stdout
  console.log(fullMarkdown);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const log = createLogger();
  const opts = parseArgs(process.argv.slice(2), log);

  // Enable quiet mode for JSON/stdout output
  if (opts.json || opts.stdout) {
    log.setQuiet(true);
  }

  const urls = await resolveUrls(opts.urls);

  // Validate URLs
  for (const url of urls) {
    if (!url.includes("twitter.com") && !url.includes("x.com")) {
      log.warn(`URL doesn't look like Twitter/X: ${url}`);
    }
  }

  if (urls.length === 0) {
    log.error("No URLs provided. Use --help for usage info.");
    process.exit(1);
  }

  log(`\n🔖 Twitter/X Headless Clipper`);
  log(`   ${urls.length} URL(s) to process\n`);

  if (opts.profile) {
    log(`   Using Chrome profile: ${opts.profile}\n`);
  }

  const browser = await launchBrowser({
    headless: opts.headless,
    profile: opts.profile,
  });

  const allResults: ThreadResult[] = [];

  try {
    const page = await createPage(browser);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      log(`\n[${i + 1}/${urls.length}] Processing: ${url}`);

      const result = await extractThread(page, url, opts.wait, log);
      allResults.push(result);

      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }

      if (!opts.json && !opts.stdout) {
        await saveResult(result, opts, log);
      }

      if (i < urls.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // --json mode: output structured JSON to stdout using ToolOutput format
    if (opts.json) {
      // For single URL, output single ToolOutput object
      // For multiple URLs, output array with batch wrapper
      if (allResults.length === 1) {
        const r = allResults[0];
        const output: TwitterOutput = {
          success: r.success,
          url: r.url,
          title: r.tweet
            ? (r.tweet.isThread
                ? `Thread by @${r.tweet.authorHandle}`
                : `Tweet by @${r.tweet.authorHandle}`)
            : "",
          markdown: r.markdown || "",
          content: r.tweet?.text || "",
          tags: opts.tags,
          error: r.error,
          data: r.tweet
            ? {
                tweet_id: r.tweet.tweetId,
                author_handle: r.tweet.authorHandle,
                author_name: r.tweet.authorName,
                is_thread: r.tweet.isThread,
                thread_length: r.tweet.threadLength,
                text: r.tweet.text,
                engagement: r.tweet.engagement,
                media: r.tweet.media,
                thread_tweets: r.tweet.threadTweets,
                quoted_tweet: r.tweet.quotedTweet,
              }
            : undefined,
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        // Batch output: wrap in batch structure with individual ToolOutput results
        const output = {
          success: failCount === 0,
          total: urls.length,
          succeeded: successCount,
          failed: failCount,
          results: allResults.map((r): TwitterOutput => ({
            success: r.success,
            url: r.url,
            title: r.tweet
              ? (r.tweet.isThread
                  ? `Thread by @${r.tweet.authorHandle}`
                  : `Tweet by @${r.tweet.authorHandle}`)
              : "",
            markdown: r.markdown || "",
            content: r.tweet?.text || "",
            tags: opts.tags,
            error: r.error,
            data: r.tweet
              ? {
                  tweet_id: r.tweet.tweetId,
                  author_handle: r.tweet.authorHandle,
                  author_name: r.tweet.authorName,
                  is_thread: r.tweet.isThread,
                  thread_length: r.tweet.threadLength,
                  text: r.tweet.text,
                  engagement: r.tweet.engagement,
                  media: r.tweet.media,
                  thread_tweets: r.tweet.threadTweets,
                  quoted_tweet: r.tweet.quotedTweet,
                }
              : undefined,
          })),
        };
        console.log(JSON.stringify(output, null, 2));
      }
    }

    log(`\n────────────────────────────────────`);
    log(`✅ Done: ${successCount} succeeded, ${failCount} failed`);
    log();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
