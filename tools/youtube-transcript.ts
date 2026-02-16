#!/usr/bin/env bun
/**
 * YouTube Transcript CLI
 *
 * Extract YouTube video transcripts headlessly using Puppeteer.
 * Part of the Agentic CLI Tools suite for LLM agent integration.
 *
 * Usage:
 *   # Extract transcript from a YouTube video
 *   bun run tools/youtube-transcript.ts https://youtube.com/watch?v=abc123
 *
 *   # Output as JSON (for LLM tool calls)
 *   bun run tools/youtube-transcript.ts --json https://youtube.com/watch?v=abc123
 *
 *   # Dump transcript to stdout (plain text)
 *   bun run tools/youtube-transcript.ts --stdout https://youtube.com/watch?v=abc123
 *
 *   # Exclude timestamps
 *   bun run tools/youtube-transcript.ts --no-timestamps https://youtube.com/watch?v=abc123
 *
 *   # Use Chrome profile for authenticated pages
 *   bun run tools/youtube-transcript.ts --profile ~/.config/google-chrome/Default https://youtube.com/watch?v=abc123
 *
 *   # Show browser for debugging
 *   bun run tools/youtube-transcript.ts --no-headless https://youtube.com/watch?v=abc123
 */

import { sanitizeFilename } from "../src/shared/sanitize";
import { buildFrontmatterYaml, type FrontmatterInput } from "../src/shared/markdown";
import {
  launchBrowser,
  createPage,
  createLogger,
  type CommonCLIOptions,
  type Logger,
  type ToolOutput,
} from "./lib/clipper-core";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CLIOptions extends CommonCLIOptions {
  url: string;
  timestamps: boolean;
  format: "text" | "segments";
}

interface TranscriptSegment {
  timestamp: string;
  timestampSeconds: number;
  text: string;
}

interface YouTubeMetadata {
  url: string;
  title: string;
  channel: string;
  channelId: string;
  duration: string;
  durationSeconds: number;
  description: string;
  publishedDate: string;
  viewCount: number;
  likeCount: number;
  videoId: string;
}

interface TranscriptOutputData {
  transcript: TranscriptSegment[];
  transcriptText: string;
  metadata: YouTubeMetadata;
}

type TranscriptOutput = ToolOutput<TranscriptOutputData>;

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[], log: Logger): CLIOptions {
  const opts: CLIOptions = {
    url: "",
    cli: false,
    cliPath: "obsidian-cli",
    vault: "Main Vault",
    folder: "Clips/YouTube",
    profile: null,
    headless: true,
    wait: 5000,
    tags: ["youtube", "transcript"],
    json: false,
    stdout: false,
    timestamps: true,
    format: "text",
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--cli") {
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
      opts.wait = parseInt(argv[i] || "5000", 10);
    } else if (arg === "--tags") {
      i++;
      opts.tags = (argv[i] || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--stdout") {
      opts.stdout = true;
    } else if (arg === "--no-timestamps") {
      opts.timestamps = false;
    } else if (arg === "--format") {
      i++;
      opts.format = (argv[i] as "text" | "segments") || "text";
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("http")) {
      opts.url = arg;
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
YouTube Transcript CLI — Extract YouTube transcripts headlessly

USAGE:
  bun run tools/youtube-transcript.ts [OPTIONS] <YOUTUBE_URL>

OPTIONS:
  --json                Output structured JSON to stdout (for LLM tool calls)
  --stdout              Dump raw transcript text to stdout (for piping)
  --no-timestamps       Don't include timestamps in output
  --format <type>       Output format: "text" (default) or "segments"
  --cli                 Use Obsidian CLI directly for file creation
  --cli-path <path>     Path to obsidian-cli binary (default: obsidian-cli)
  --vault <name>        Obsidian vault name (default: "Main Vault")
  --folder <path>       Obsidian folder path (default: "Clips/YouTube")
  --profile <path>      Chrome user data dir (for auth cookies)
  --no-headless         Show the browser window
  --wait <ms>           Wait time for page load (default: 5000)
  --tags <a,b,c>        Comma-separated tags (default: "youtube,transcript")
  --help, -h            Show this help message

EXAMPLES:
  # Extract transcript with timestamps
  bun run tools/youtube-transcript.ts https://youtube.com/watch?v=abc123

  # LLM tool call: get structured JSON back
  bun run tools/youtube-transcript.ts --json https://youtube.com/watch?v=abc123

  # Pipe plain transcript to another tool
  bun run tools/youtube-transcript.ts --stdout --no-timestamps https://youtube.com/watch?v=abc123

  # Get segment-level data with timestamps
  bun run tools/youtube-transcript.ts --json --format segments https://youtube.com/watch?v=abc123

  # Use Chrome profile for member-only videos
  bun run tools/youtube-transcript.ts --profile ~/.config/google-chrome/Default https://youtube.com/watch?v=abc123

OUTPUT FORMAT (--json):
  {
    "success": true,
    "url": "https://youtube.com/watch?v=...",
    "title": "Video Title",
    "markdown": "...",
    "content": "...",
    "metadata": {
      "videoId": "...",
      "title": "...",
      "channel": "...",
      "duration": "10:30",
      "durationSeconds": 630,
      "viewCount": 12345,
      ...
    },
    "transcript": [
      { "timestamp": "0:00", "timestampSeconds": 0, "text": "..." },
      ...
    ],
    "data": {
      "transcript": [...],
      "transcriptText": "...",
      "metadata": {...}
    }
  }
`);
}

// ─── Video ID Extraction ─────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);

    // Handle youtube.com/watch?v=...
    if (parsed.hostname === "www.youtube.com" || parsed.hostname === "youtube.com" || 
        parsed.hostname === "m.youtube.com") {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v");
      }
      // Handle youtube.com/v/...
      if (parsed.pathname.startsWith("/v/")) {
        return parsed.pathname.slice(3).split("/")[0] || null;
      }
      // Handle shorts
      if (parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.slice(8).split("/")[0] || null;
      }
      // Handle embeds
      if (parsed.pathname.startsWith("/embed/")) {
        return parsed.pathname.slice(7).split("/")[0] || null;
      }
    }

    // Handle youtu.be/...
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.slice(1).split("/")[0] || null;
    }
  } catch {
    return null;
  }

  return null;
}

// ─── Page Extraction Functions ───────────────────────────────────────────────

/**
 * Extract YouTube video info from the page
 */
function extractYouTubeInfoInPage(): {
  title: string;
  channel: string;
  channelId: string;
  duration: string;
  durationSeconds: number;
  description: string;
  publishedDate: string;
  viewCount: number;
  likeCount: number;
  videoId: string;
} {
  const title =
    document.querySelector("meta[property='og:title']")?.getAttribute("content") ||
    document.querySelector("title")?.textContent?.replace(" - YouTube", "").trim() ||
    "";

  const channel =
    document.querySelector("#channel-name a")?.textContent?.trim() ||
    document.querySelector("a.yt-formatted-string.yt-simple-endpoint")?.textContent?.trim() ||
    document.querySelector("ytd-channel-name a")?.textContent?.trim() ||
    "";

  const channelLink =
    document.querySelector("#channel-name a")?.getAttribute("href") ||
    document.querySelector("ytd-channel-name a")?.getAttribute("href") ||
    "";
  const channelId = channelLink?.split("/").pop() || "";

  // Try multiple sources for duration
  const durationText =
    document.querySelector("span.ytp-time-duration")?.textContent ||
    document.querySelector(".ytp-time-display span:nth-child(2)")?.textContent ||
    document.querySelector("meta[itemprop='duration']")?.getAttribute("content") ||
    "";

  // Parse duration to seconds
  let durationSeconds = 0;
  if (durationText) {
    const parts = durationText.split(":").map(Number);
    if (parts.length === 2) {
      durationSeconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }

  const description =
    document.querySelector("#description-inline-expander yt-attributed-string")?.textContent?.trim() ||
    document.querySelector("#description yt-formatted-string")?.textContent?.trim() ||
    document.querySelector("meta[property='og:description']")?.getAttribute("content") ||
    "";

  const publishedDate =
    document.querySelector("meta[itemprop='datePublished']")?.getAttribute("content") ||
    document.querySelector("meta[property='article:published_time']")?.getAttribute("content") ||
    document.querySelector("#info-strings yt-formatted-string")?.textContent ||
    "";

  // Parse view count from various sources
  let viewCount = 0;
  const viewCountText =
    document.querySelector("meta[itemprop='interactionCount']")?.getAttribute("content") ||
    document.querySelector("#count yt-view-count-view-model")?.getAttribute("aria-label") ||
    "";
  if (viewCountText) {
    const match = viewCountText.match(/[\d,]+/);
    if (match) {
      viewCount = parseInt(match[0].replace(/,/g, ""), 10);
    }
  }

  // Parse like count
  let likeCount = 0;
  const likeButton = document.querySelector("like-button-view-model button, #top-level-buttons-computed like-button-view-model");
  const likeAria = likeButton?.getAttribute("aria-label") || "";
  if (likeAria) {
    const match = likeAria.match(/[\d,]+/);
    if (match) {
      likeCount = parseInt(match[0].replace(/,/g, ""), 10);
    }
  }

  // Get video ID from URL or page
  const videoId =
    document.querySelector("meta[itemprop='videoId']")?.getAttribute("content") ||
    new URLSearchParams(window.location.search).get("v") ||
    "";

  return {
    title,
    channel,
    channelId,
    duration: durationText,
    durationSeconds,
    description,
    publishedDate,
    viewCount,
    likeCount,
    videoId,
  };
}

/**
 * Parse timestamp string (MM:SS or HH:MM:SS) to seconds
 */
function parseTimestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(":").map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * Click transcript button if available
 */
async function openTranscriptPanel(page: import("puppeteer").Page): Promise<boolean> {
  try {
    // Try multiple selectors for the transcript button
    const selectors = [
      'button[aria-label*="transcript" i]',
      'button[aria-label*="transcripts" i]',
      'ytd-button-renderer[id*="transcript"] button',
      'ytd-toggle-button-renderer[id*="transcript"] button',
      'button:has-text("Show transcript")',
      '[target-id*="transcript"] button',
    ];

    for (const selector of selectors) {
      const button = await page.$(selector);
      if (button) {
        await button.click();
        // Wait for transcript panel to appear
        await page.waitForSelector(
          "ytd-transcript-segment-renderer, .segment, .transcript-segment",
          { timeout: 5000 }
        ).catch(() => {});
        return true;
      }
    }

    // Try clicking the "...more" menu and looking for transcript option
    const moreButton = await page.$('button[aria-label="More actions"], ytd-menu-renderer button[aria-label="More actions"]');
    if (moreButton) {
      await moreButton.click();
      await new Promise(r => setTimeout(r, 500));

      // Check for transcript in the menu
      const menuItem = await page.$('tp-yt-paper-item:has-text("Open transcript"), ytd-menu-service-item-renderer:has-text("transcript" i)');
      if (menuItem) {
        await menuItem.click();
        await page.waitForSelector(
          "ytd-transcript-segment-renderer, .segment, .transcript-segment",
          { timeout: 5000 }
        ).catch(() => {});
        return true;
      }

      // Close menu if transcript not found
      await page.keyboard.press("Escape").catch(() => {});
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Extract transcript segments from the page
 */
async function extractTranscriptInPage(
  page: import("puppeteer").Page
): Promise<TranscriptSegment[]> {
  const segments = await page.evaluate(() => {
    const results: Array<{ timestamp: string; timestampSeconds: number; text: string }> = [];

    // Try multiple selectors for transcript segments
    const segmentSelectors = [
      "ytd-transcript-segment-renderer",
      ".cue-group",
      ".transcript-segment",
      "[class*='transcript'] [class*='segment']",
      "div.ytd-transcript-segment-renderer",
    ];

    let elements: NodeListOf<Element> | null = null;
    for (const selector of segmentSelectors) {
      elements = document.querySelectorAll(selector);
      if (elements.length > 0) break;
    }

    if (!elements || elements.length === 0) {
      // Try alternative: look for caption cues
      elements = document.querySelectorAll(".caption-visual-line");
    }

    elements?.forEach((seg) => {
      // Try multiple selectors for timestamp
      const timeEl = seg.querySelector(
        ".segment-timestamp, .cue-group-start-offset, [class*='timestamp'], .yt-time"
      );
      // Try multiple selectors for text
      const textEl = seg.querySelector(
        ".segment-text, .cue, [class*='text'], .transcript-text"
      );

      if (textEl?.textContent?.trim()) {
        let time = timeEl?.textContent?.trim() || "";
        
        // If no time element, try to extract from aria or data attributes
        if (!time) {
          time = seg.getAttribute("data-timestamp") || 
                 seg.querySelector("[data-start]")?.getAttribute("data-start") || "";
        }

        // Parse timestamp to seconds
        let timestampSeconds = 0;
        if (time) {
          const parts = time.split(":").map(Number);
          if (parts.length === 2) {
            timestampSeconds = parts[0] * 60 + parts[1];
          } else if (parts.length === 3) {
            timestampSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
          }
        }

        results.push({
          timestamp: time,
          timestampSeconds,
          text: textEl.textContent.trim(),
        });
      }
    });

    return results;
  });

  return segments;
}

// ─── Core Extraction Logic ───────────────────────────────────────────────────

async function extractTranscript(
  page: import("puppeteer").Page,
  url: string,
  opts: CLIOptions,
  log: Logger
): Promise<TranscriptOutput> {
  const videoId = extractVideoId(url);

  const result: TranscriptOutput = {
    success: false,
    url,
    title: "",
    markdown: "",
    content: "",
    tags: opts.tags,
    data: {
      transcript: [],
      transcriptText: "",
      metadata: {
        url,
        title: "",
        channel: "",
        channelId: "",
        duration: "",
        durationSeconds: 0,
        description: "",
        publishedDate: "",
        viewCount: 0,
        likeCount: 0,
        videoId: videoId || "",
      },
    },
  };

  if (!videoId) {
    result.error = "Invalid YouTube URL: Could not extract video ID";
    return result;
  }

  try {
    log(`  → Navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    log(`  → Waiting ${opts.wait}ms for content to render...`);
    await new Promise((r) => setTimeout(r, opts.wait));

    // Wait for video info to load
    await page.waitForSelector("#title h1, h1.title, ytd-watch-metadata", { timeout: 10000 }).catch(() => {});

    // Extract video metadata
    const videoInfo = await page.evaluate(extractYouTubeInfoInPage);

    result.title = videoInfo.title;
    result.data!.metadata = videoInfo;

    log(`  → Video: "${videoInfo.title}" by ${videoInfo.channel}`);

    // Try to open transcript panel
    log(`  → Opening transcript panel...`);
    const transcriptAvailable = await openTranscriptPanel(page);

    if (!transcriptAvailable) {
      result.error = "Transcript not available. This video may not have captions enabled.";
      log(`  ⚠ Transcript panel not available`);
      
      // Still build partial output
      result.markdown = buildMarkdown(result, opts);
      return result;
    }

    // Wait a bit for transcript to render
    await new Promise((r) => setTimeout(r, 1000));

    // Extract transcript segments
    log(`  → Extracting transcript...`);
    const segments = await extractTranscriptInPage(page);

    if (segments.length === 0) {
      result.error = "Could not extract transcript segments. The transcript may be loading or unavailable.";
      log(`  ⚠ No transcript segments found`);
      
      // Still build partial output
      result.markdown = buildMarkdown(result, opts);
      return result;
    }

    result.data!.transcript = segments;
    result.data!.transcriptText = segments.map(s => s.text).join(" ");
    result.success = true;

    log(`  ✓ Extracted ${segments.length} transcript segments`);

    // Build markdown
    result.markdown = buildMarkdown(result, opts);
    result.content = buildTranscriptText(segments, opts.timestamps);

    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Failed to extract transcript: ${message}`;
    return result;
  }
}

// ─── Output Formatting ───────────────────────────────────────────────────────

function buildTranscriptText(segments: TranscriptSegment[], includeTimestamps: boolean): string {
  if (includeTimestamps) {
    return segments
      .map((s) => `**[${s.timestamp}]** ${s.text}`)
      .join("\n\n");
  }
  return segments.map((s) => s.text).join(" ");
}

function formatDuration(seconds: number): string {
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function buildMarkdown(result: TranscriptOutput, opts: CLIOptions): string {
  const { metadata, transcript } = result.data!;

  let md = `# ${metadata.title || "YouTube Transcript"}\n\n`;

  // Video info
  md += `**Channel:** ${metadata.channel || "Unknown"}\n`;
  if (metadata.duration) {
    md += `**Duration:** ${metadata.duration}\n`;
  }
  if (metadata.viewCount > 0) {
    md += `**Views:** ${metadata.viewCount.toLocaleString()}\n`;
  }
  if (metadata.likeCount > 0) {
    md += `**Likes:** ${metadata.likeCount.toLocaleString()}\n`;
  }
  if (metadata.publishedDate) {
    md += `**Published:** ${metadata.publishedDate}\n`;
  }
  md += `**URL:** ${metadata.url}\n`;
  md += `**Video ID:** ${metadata.videoId}\n\n`;

  // Description
  if (metadata.description) {
    md += `## Description\n\n${metadata.description}\n\n`;
  }

  // Transcript
  if (transcript.length > 0) {
    md += `---\n\n## Transcript\n\n`;
    md += buildTranscriptText(transcript, opts.timestamps);
    md += "\n";
  } else {
    md += `> ⚠️ **Transcript not available.** This video may not have captions enabled.\n`;
  }

  return md;
}

function buildFullMarkdown(result: TranscriptOutput, opts: CLIOptions): string {
  const metadata = result.data!.metadata;

  const frontmatterInput: FrontmatterInput = {
    source: result.url,
    title: result.title || "Untitled",
    type: "video",
    dateClippedISO: new Date().toISOString(),
    tags: opts.tags,
    channel: metadata.channel,
    duration: metadata.duration,
    extra: {
      video_id: metadata.videoId,
      channel_id: metadata.channelId,
      duration_seconds: metadata.durationSeconds,
      view_count: metadata.viewCount,
      like_count: metadata.likeCount,
      published_date: metadata.publishedDate,
    },
  };

  const frontmatter = buildFrontmatterYaml(frontmatterInput);
  return frontmatter + result.markdown + (result.markdown.endsWith("\n") ? "" : "\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const log = createLogger();
  const opts = parseArgs(process.argv.slice(2), log);

  // Enable quiet mode for JSON/stdout output
  if (opts.json || opts.stdout) {
    log.setQuiet(true);
  }

  if (!opts.url) {
    log.error("No URL provided. Use --help for usage info.");
    process.exit(1);
  }

  // Validate URL
  const videoId = extractVideoId(opts.url);
  if (!videoId) {
    log.error("Invalid YouTube URL. Must be a valid YouTube video URL.");
    process.exit(1);
  }

  log(`\n🎬 YouTube Transcript CLI`);
  log(`   URL: ${opts.url}`);
  log(`   Video ID: ${videoId}\n`);

  if (opts.profile) {
    log(`   Using Chrome profile: ${opts.profile}\n`);
  }

  const browser = await launchBrowser({
    headless: opts.headless,
    profile: opts.profile,
  });

  try {
    const page = await createPage(browser);
    const result = await extractTranscript(page, opts.url, opts, log);

    // --json mode: output structured JSON to stdout
    if (opts.json) {
      const output: TranscriptOutput = {
        success: result.success,
        url: result.url,
        title: result.title,
        markdown: result.success ? buildFullMarkdown(result, opts) : "",
        content: result.content,
        tags: result.tags,
        error: result.error,
        data: result.data,
      };
      console.log(JSON.stringify(output, null, 2));
    } else if (opts.stdout) {
      // --stdout mode: dump transcript text to stdout
      if (result.success && result.transcript.length > 0) {
        console.log(buildTranscriptText(result.transcript, opts.timestamps));
      } else {
        console.error(result.error || "Failed to extract transcript");
        process.exit(1);
      }
    } else {
      // Default: output markdown to stdout
      if (result.success) {
        console.log(buildFullMarkdown(result, opts));
      } else {
        log.error(`\n✗ ${result.error}`);
        process.exit(1);
      }
    }

    if (!opts.json && !opts.stdout) {
      if (result.success) {
        log(`\n────────────────────────────────────`);
        log(`✅ Done — ${result.transcript.length} segments extracted`);
      } else {
        log(`\n────────────────────────────────────`);
        log(`❌ Failed: ${result.error}`);
      }
      log();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
