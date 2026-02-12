#!/usr/bin/env bun
/**
 * Universal URL Clipper
 *
 * A Puppeteer-based CLI tool to clip any URL to Obsidian-compatible markdown.
 * Supports web pages, YouTube videos, and PDFs.
 *
 * Usage:
 *   # Clip a web page
 *   bun run tools/clip-url.ts https://example.com/article
 *
 *   # Clip a YouTube video (extracts transcript)
 *   bun run tools/clip-url.ts https://youtube.com/watch?v=abc123
 *
 *   # Output as JSON (for LLM tool calls)
 *   bun run tools/clip-url.ts --json https://example.com
 *
 *   # Dump markdown to stdout
 *   bun run tools/clip-url.ts --stdout https://example.com
 *
 *   # Save directly to Obsidian via CLI
 *   bun run tools/clip-url.ts --cli --vault "My Vault" --folder "Notes/Clips" https://example.com
 *
 *   # Use Chrome profile for authenticated pages
 *   bun run tools/clip-url.ts --profile ~/.config/google-chrome/Default https://example.com
 *
 *   # Show browser for debugging
 *   bun run tools/clip-url.ts --no-headless https://example.com
 */

import puppeteer, { type Browser, type Page } from "puppeteer";
import { resolve } from "node:path";
import { saveViaCli, type CliSaveResult } from "../src/shared/obsidianCliSave";
import { sanitizeFilename } from "../src/shared/sanitize";
import {
  buildFrontmatterYaml,
  type FrontmatterInput
} from "../src/shared/markdown";
import {
  detectPageType,
  isYouTubeUrl,
  isPdfUrl
} from "../src/shared/pageType";
import type { ClipResult, ClipContentType, PageType } from "../src/shared/types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CLIOptions {
  url: string;
  cli: boolean;
  cliPath: string;
  vault: string;
  folder: string;
  profile: string | null;
  headless: boolean;
  wait: number;
  tags: string[];
  json: boolean;
  stdout: boolean;
  timestamps: boolean; // For YouTube transcripts
}

interface ClipOutput {
  success: boolean;
  url: string;
  title: string;
  pageType: PageType;
  markdown: string;
  metadata: ClipResult["metadata"];
  error?: string;
}

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[]): CLIOptions {
  const opts: CLIOptions = {
    url: "",
    cli: false,
    cliPath: "obsidian-cli",
    vault: "Main Vault",
    folder: "Clips",
    profile: null,
    headless: true,
    wait: 5000,
    tags: ["web-clip"],
    json: false,
    stdout: false,
    timestamps: true
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
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("http")) {
      opts.url = arg;
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }

    i++;
  }

  return opts;
}

function printHelp(): void {
  console.log(`
Universal URL Clipper — Clip any URL to Obsidian markdown

USAGE:
  bun run tools/clip-url.ts [OPTIONS] <URL>

OPTIONS:
  --cli                 Use Obsidian CLI directly for file creation
  --cli-path <path>     Path to obsidian-cli binary (default: obsidian-cli from PATH)
  --vault <name>        Obsidian vault name (default: "Main Vault")
  --folder <path>       Obsidian folder path (default: "Clips")
  --profile <path>      Chrome user data dir (for auth cookies)
  --no-headless         Show the browser window
  --wait <ms>           Wait time for page load (default: 5000)
  --tags <a,b,c>        Comma-separated tags (default: "web-clip")
  --json                Output structured JSON to stdout (for LLM tool calls)
  --stdout              Dump raw markdown to stdout (for piping)
  --no-timestamps       Don't include timestamps in YouTube transcripts
  --help, -h            Show this help message

EXAMPLES:
  # Clip a web page
  bun run tools/clip-url.ts https://example.com/article

  # Clip a YouTube video with transcript
  bun run tools/clip-url.ts https://youtube.com/watch?v=abc123

  # Save directly to Obsidian via CLI
  bun run tools/clip-url.ts --cli --vault "My Vault" --folder "Notes/Clips" https://example.com

  # LLM tool call: get structured JSON back
  bun run tools/clip-url.ts --json https://example.com

  # Use Chrome profile for authenticated pages
  bun run tools/clip-url.ts --profile ~/.config/google-chrome/Default https://example.com/member-only
`);
}

// ─── Logging (stderr when --json/--stdout so stdout stays clean) ─────────────

function log(...args: any[]): void {
  console.error(...args);
}

// ─── Page Extraction Functions ───────────────────────────────────────────────

/**
 * Extract web page content using Readability-style extraction in browser context
 */
function extractWebContentInPage(): {
  title: string;
  content: string;
  excerpt: string;
  byline: string;
  publishedTime: string;
} {
  // Simple content extraction using DOM APIs
  const title =
    document.querySelector("meta[property='og:title']")?.getAttribute("content") ||
    document.querySelector("title")?.textContent ||
    "Untitled";

  // Try to find main content
  const mainSelectors = [
    "article",
    "[role='main']",
    "main",
    ".post-content",
    ".article-content",
    ".entry-content",
    ".content"
  ];

  let contentEl: Element | null = null;
  for (const selector of mainSelectors) {
    contentEl = document.querySelector(selector);
    if (contentEl) break;
  }

  // Fallback to body
  if (!contentEl) {
    contentEl = document.body;
  }

  // Get excerpt
  const excerpt =
    document.querySelector("meta[name='description']")?.getAttribute("content") ||
    document.querySelector("meta[property='og:description']")?.getAttribute("content") ||
    "";

  // Get author
  const byline =
    document.querySelector("meta[name='author']")?.getAttribute("content") ||
    document.querySelector("[rel='author']")?.textContent ||
    "";

  // Get publish date
  const publishedTime =
    document.querySelector("meta[property='article:published_time']")?.getAttribute("content") ||
    document.querySelector("time")?.getAttribute("datetime") ||
    "";

  // Clean up content - remove scripts, styles, nav, etc.
  const clone = contentEl.cloneNode(true) as Element;
  const removeSelectors = [
    "script",
    "style",
    "nav",
    "header",
    "footer",
    "aside",
    ".sidebar",
    ".comments",
    ".advertisement",
    ".ad",
    ".social-share",
    "[role='navigation']"
  ];

  for (const selector of removeSelectors) {
    clone.querySelectorAll(selector).forEach((el) => el.remove());
  }

  return {
    title: title.trim(),
    content: clone.innerHTML,
    excerpt: excerpt.trim(),
    byline: byline.trim(),
    publishedTime: publishedTime.trim()
  };
}

/**
 * Convert HTML to markdown (lightweight, runs in browser context)
 */
function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;

  // Code blocks
  body.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    const lang =
      code?.className?.match(/language-(\w+)/)?.[1] ||
      pre.className?.match(/language-(\w+)/)?.[1] ||
      "";
    const text = code?.textContent || pre.textContent || "";
    const ph = document.createElement("p");
    ph.textContent = `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
    pre.replaceWith(ph);
  });

  // Inline code
  body.querySelectorAll("code").forEach((el) => {
    if (!el.closest("pre")) {
      el.textContent = `\`${el.textContent}\``;
    }
  });

  // Headers
  for (let i = 1; i <= 6; i++) {
    body.querySelectorAll(`h${i}`).forEach((el) => {
      el.textContent = `${"#".repeat(i)} ${el.textContent}\n\n`;
    });
  }

  // Bold
  body.querySelectorAll("strong, b").forEach((el) => {
    el.textContent = `**${el.textContent}**`;
  });

  // Italic
  body.querySelectorAll("em, i").forEach((el) => {
    el.textContent = `*${el.textContent}*`;
  });

  // Links
  body.querySelectorAll("a").forEach((el) => {
    const href = el.getAttribute("href") || "";
    const text = el.textContent || "";
    if (href && text) {
      el.textContent = `[${text}](${href})`;
    }
  });

  // Images
  body.querySelectorAll("img").forEach((el) => {
    const src = el.getAttribute("src") || "";
    const alt = el.getAttribute("alt") || "image";
    if (src) {
      const ph = document.createElement("p");
      ph.textContent = `![${alt}](${src})\n`;
      el.replaceWith(ph);
    }
  });

  // Unordered lists
  body.querySelectorAll("ul").forEach((ul) => {
    const items = ul.querySelectorAll(":scope > li");
    let text = "\n";
    items.forEach((li) => {
      text += `- ${li.textContent?.trim()}\n`;
    });
    text += "\n";
    const ph = document.createElement("p");
    ph.textContent = text;
    ul.replaceWith(ph);
  });

  // Ordered lists
  body.querySelectorAll("ol").forEach((ol) => {
    const items = ol.querySelectorAll(":scope > li");
    let text = "\n";
    items.forEach((li, i) => {
      text += `${i + 1}. ${li.textContent?.trim()}\n`;
    });
    text += "\n";
    const ph = document.createElement("p");
    ph.textContent = text;
    ol.replaceWith(ph);
  });

  // Blockquotes
  body.querySelectorAll("blockquote").forEach((bq) => {
    const lines = (bq.textContent || "").split("\n");
    bq.textContent = lines.map((l) => `> ${l}`).join("\n") + "\n\n";
  });

  // Tables
  body.querySelectorAll("table").forEach((table) => {
    const rows = table.querySelectorAll("tr");
    let md = "\n";
    rows.forEach((row, rowIdx) => {
      const cells = row.querySelectorAll("th, td");
      const cellTexts: string[] = [];
      cells.forEach((cell) =>
        cellTexts.push((cell.textContent || "").trim())
      );
      md += `| ${cellTexts.join(" | ")} |\n`;
      if (rowIdx === 0) {
        md += `| ${cellTexts.map(() => "---").join(" | ")} |\n`;
      }
    });
    md += "\n";
    const ph = document.createElement("p");
    ph.textContent = md;
    table.replaceWith(ph);
  });

  // Paragraphs
  body.querySelectorAll("p").forEach((p) => {
    if (!p.textContent?.trim()) return;
    p.textContent = `${p.textContent?.trim()}\n\n`;
  });

  // Br tags
  body.querySelectorAll("br").forEach((br) => {
    br.replaceWith(document.createTextNode("\n"));
  });

  let text = body.textContent || "";
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}

/**
 * Extract YouTube video info and transcript
 */
function extractYouTubeInPage(): {
  title: string;
  channel: string;
  duration: string;
  description: string;
} {
  const title =
    document.querySelector("meta[property='og:title']")?.getAttribute("content") ||
    document.querySelector("title")?.textContent?.replace(" - YouTube", "").trim() ||
    "";

  const channel =
    document.querySelector("#channel-name a")?.textContent?.trim() ||
    document.querySelector("a.yt-formatted-string.yt-simple-endpoint")?.textContent?.trim() ||
    "";

  const duration =
    document.querySelector("span.ytp-time-duration")?.textContent ||
    document.querySelector("meta[itemprop='duration']")?.getAttribute("content") ||
    "";

  const description =
    document.querySelector("#description-inline-expander yt-attributed-string")?.textContent?.trim() ||
    document.querySelector("#description yt-formatted-string")?.textContent?.trim() ||
    document.querySelector("meta[property='og:description']")?.getAttribute("content") ||
    "";

  return { title, channel, duration, description };
}

// ─── Core Extraction Logic ───────────────────────────────────────────────────

async function clipUrl(page: Page, url: string, opts: CLIOptions): Promise<ClipOutput> {
  const pageType = detectPageType(url);
  const result: ClipOutput = {
    success: false,
    url,
    title: "",
    pageType,
    markdown: "",
    metadata: {
      url,
      title: "",
      type: "article"
    }
  };

  try {
    log(`  → Navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    log(`  → Waiting ${opts.wait}ms for content to render...`);
    await new Promise((r) => setTimeout(r, opts.wait));

    if (pageType === "youtube") {
      return await extractYouTube(page, url, opts);
    } else if (pageType === "pdf") {
      // PDF extraction is more complex, requires offscreen document in extension
      // For CLI tool, we'll extract text from PDF viewer if available
      return await extractPdfFromViewer(page, url, opts);
    } else {
      return await extractWebPage(page, url, opts);
    }
  } catch (err: any) {
    result.error = err.message || String(err);
    return result;
  }
}

async function extractWebPage(
  page: Page,
  url: string,
  opts: CLIOptions
): Promise<ClipOutput> {
  const result: ClipOutput = {
    success: false,
    url,
    title: "",
    pageType: "web",
    markdown: "",
    metadata: {
      url,
      title: "",
      type: "article"
    }
  };

  try {
    const pageData = await page.evaluate(extractWebContentInPage);
    const markdown = await page.evaluate(htmlToMarkdown, pageData.content);

    result.title = pageData.title;
    result.metadata.title = pageData.title;
    result.metadata.author = pageData.byline;
    result.metadata.publishedDate = pageData.publishedTime;
    result.metadata.description = pageData.excerpt;

    // Build markdown with title
    let bodyMarkdown = `# ${pageData.title}\n\n`;
    if (pageData.excerpt) {
      bodyMarkdown += `> ${pageData.excerpt}\n\n`;
    }
    bodyMarkdown += markdown;

    result.markdown = bodyMarkdown;
    result.success = true;

    log(`  ✓ Extracted web page: "${pageData.title}"`);
    return result;
  } catch (err: any) {
    result.error = `Failed to extract web page: ${err.message}`;
    return result;
  }
}

async function extractYouTube(
  page: Page,
  url: string,
  opts: CLIOptions
): Promise<ClipOutput> {
  const result: ClipOutput = {
    success: false,
    url,
    title: "",
    pageType: "youtube",
    markdown: "",
    metadata: {
      url,
      title: "",
      type: "video"
    }
  };

  try {
    // Wait for video info to load
    await page.waitForSelector("#title h1, h1.title", { timeout: 10000 }).catch(() => {});

    const videoInfo = await page.evaluate(extractYouTubeInPage);

    result.title = videoInfo.title;
    result.metadata.title = videoInfo.title;
    result.metadata.channel = videoInfo.channel;
    result.metadata.duration = videoInfo.duration;
    result.metadata.description = videoInfo.description;

    // Try to get transcript
    const transcript = await getYouTubeTranscriptInPage(page);

    let bodyMarkdown = `# ${videoInfo.title}\n\n`;
    bodyMarkdown += `**Channel:** ${videoInfo.channel || "Unknown"}\n`;
    bodyMarkdown += `**Duration:** ${videoInfo.duration || "Unknown"}\n`;
    bodyMarkdown += `**URL:** ${url}\n\n`;

    if (videoInfo.description) {
      bodyMarkdown += `## Description\n\n${videoInfo.description}\n\n`;
    }

    if (transcript) {
      bodyMarkdown += `---\n\n## Transcript\n\n${transcript}\n`;
    } else {
      bodyMarkdown += `> ⚠️ **Transcript not available.** This video may not have captions enabled.\n`;
    }

    result.markdown = bodyMarkdown;
    result.success = true;

    log(`  ✓ Extracted YouTube video: "${videoInfo.title}"`);
    return result;
  } catch (err: any) {
    result.error = `Failed to extract YouTube video: ${err.message}`;
    return result;
  }
}

async function getYouTubeTranscriptInPage(page: Page): Promise<string | null> {
  try {
    // Try to click "Show transcript" button if available
    const transcriptButton = await page.$(
      'button[aria-label*="transcript" i], button[aria-label*="transcripts" i], ytd-button-renderer:has-text("Show transcript")'
    );

    if (transcriptButton) {
      await transcriptButton.click();
      await page.waitForSelector("ytd-transcript-segment-renderer", {
        timeout: 5000
      }).catch(() => {});
    }

    // Try to extract transcript from the panel
    const transcript = await page.evaluate(() => {
      const segments = document.querySelectorAll(
        "ytd-transcript-segment-renderer, .cue-group"
      );
      if (segments.length === 0) return null;

      const lines: string[] = [];
      segments.forEach((seg) => {
        const timeEl = seg.querySelector(
          ".segment-timestamp, .cue-group-start-offset"
        );
        const textEl = seg.querySelector(
          ".segment-text, .cue"
        );
        if (textEl?.textContent?.trim()) {
          const time = timeEl?.textContent?.trim() || "";
          const text = textEl.textContent.trim();
          if (time) {
            lines.push(`**[${time}]** ${text}`);
          } else {
            lines.push(text);
          }
        }
      });

      return lines.length > 0 ? lines.join("\n\n") : null;
    });

    return transcript;
  } catch {
    return null;
  }
}

async function extractPdfFromViewer(
  page: Page,
  url: string,
  opts: CLIOptions
): Promise<ClipOutput> {
  const result: ClipOutput = {
    success: false,
    url,
    title: "",
    pageType: "pdf",
    markdown: "",
    metadata: {
      url,
      title: "",
      type: "document"
    }
  };

  try {
    // Check if this is a Chrome built-in PDF viewer
    const isBuiltInViewer = url.includes("chrome-extension://") && url.includes("pdf");

    if (isBuiltInViewer) {
      // Try to extract from Chrome's PDF viewer
      const pdfData = await page.evaluate(() => {
        const title = document.title || "PDF Document";
        // Chrome PDF viewer doesn't expose text content easily
        return { title, content: null };
      });

      result.title = pdfData.title;
      result.metadata.title = pdfData.title;
      result.markdown = `# ${pdfData.title}\n\n> PDF content extraction in CLI requires downloading the file. Use the browser extension for full PDF support.\n\n**URL:** ${url}\n`;
      result.success = true;
      return result;
    }

    // For other PDF URLs, note that full extraction needs download
    const filename = url.split("/").pop() || "Document.pdf";
    result.title = filename.replace(/\.pdf$/i, "");
    result.metadata.title = result.title;
    result.markdown = `# ${result.title}\n\n> PDF content extraction requires downloading the file. Consider using the browser extension for full PDF support.\n\n**URL:** ${url}\n`;
    result.success = true;

    log(`  ✓ PDF detected: "${result.title}" (limited extraction)`);
    return result;
  } catch (err: any) {
    result.error = `Failed to extract PDF: ${err.message}`;
    return result;
  }
}

// ─── Save Logic ──────────────────────────────────────────────────────────────

function buildFullMarkdown(result: ClipOutput, opts: CLIOptions): string {
  const contentType: ClipContentType =
    result.pageType === "youtube" ? "video" :
    result.pageType === "pdf" ? "document" : "article";

  const frontmatterInput: FrontmatterInput = {
    source: result.url,
    title: result.title || "Untitled",
    type: contentType,
    dateClippedISO: new Date().toISOString(),
    tags: opts.tags,
    author: result.metadata.author,
    channel: result.metadata.channel,
    duration: result.metadata.duration,
    extra: {
      page_type: result.pageType
    }
  };

  const frontmatter = buildFrontmatterYaml(frontmatterInput);
  return frontmatter + result.markdown + (result.markdown.endsWith("\n") ? "" : "\n");
}

async function saveResult(result: ClipOutput, opts: CLIOptions): Promise<void> {
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

  // --json mode: handled in main (accumulate results)
  if (opts.json) {
    return;
  }

  // --cli mode: use obsidian-cli directly for file creation
  if (opts.cli) {
    const title = sanitizeFilename(result.title || "Untitled");
    const filePath = opts.folder ? `${opts.folder}/${title}` : title;

    const saveResult: CliSaveResult = await saveViaCli(
      { cliPath: opts.cliPath, vault: opts.vault, enabled: true },
      { filePath, content: fullMarkdown, overwrite: true }
    );

    if (saveResult.success) {
      log(`  📎 Saved via CLI: ${title}`);
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
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.url) {
    console.error("No URL provided. Use --help for usage info.");
    process.exit(1);
  }

  log(`\n🔖 Universal URL Clipper`);
  log(`   URL: ${opts.url}`);
  log(`   Type: ${detectPageType(opts.url)}\n`);

  const launchOpts: Parameters<typeof puppeteer.launch>[0] = {
    headless: opts.headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  };

  if (opts.profile) {
    launchOpts.userDataDir = resolve(opts.profile);
    log(`   Using Chrome profile: ${opts.profile}\n`);
  }

  const browser: Browser = await puppeteer.launch(launchOpts);

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    const result = await clipUrl(page, opts.url, opts);

    // --json mode: output structured JSON to stdout
    if (opts.json) {
      const output: ClipOutput & { markdown: string; content: string } = {
        ...result,
        markdown: result.success ? buildFullMarkdown(result, opts) : "",
        content: result.markdown
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      await saveResult(result, opts);
    }

    if (result.success) {
      log(`\n────────────────────────────────────`);
      log(`✅ Done`);
    } else {
      log(`\n────────────────────────────────────`);
      log(`❌ Failed: ${result.error}`);
    }
    log();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
