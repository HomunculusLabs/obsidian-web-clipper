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

import { resolve } from "node:path";
import { saveViaCli, type CliSaveResult } from "../src/shared/obsidianCliSave";
import { sanitizeFilename } from "../src/shared/sanitize";
import { buildFrontmatterYaml, type FrontmatterInput } from "../src/shared/markdown";
import {
  detectPageType,
} from "../src/shared/pageType";
import type { ClipContentType, PageType } from "../src/shared/types";
import {
  launchBrowser,
  createPage,
  createLogger,
  htmlToMarkdown,
  extractWebContentInPage,
  type CommonCLIOptions,
  type Logger,
  type ToolOutput,
  type ToolMetadata,
} from "./lib/clipper-core";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CLIOptions extends CommonCLIOptions {
  url: string;
  timestamps: boolean;
}

interface ClipOutputData {
  pageType: PageType;
  metadata: ToolMetadata;
}

type ClipOutput = ToolOutput<ClipOutputData>;

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[], log: Logger): CLIOptions {
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
    timestamps: true,
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

// ─── Page Extraction Functions ───────────────────────────────────────────────

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

async function clipUrl(
  page: import("puppeteer").Page,
  url: string,
  opts: CLIOptions,
  log: Logger
): Promise<ClipOutput> {
  const pageType = detectPageType(url);
  const result: ClipOutput = {
    success: false,
    url,
    title: "",
    markdown: "",
    content: "",
    tags: opts.tags,
    data: {
      pageType,
      metadata: {
        url,
        title: "",
        type: "article",
      },
    },
  };

  try {
    log(`  → Navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    log(`  → Waiting ${opts.wait}ms for content to render...`);
    await new Promise((r) => setTimeout(r, opts.wait));

    if (pageType === "youtube") {
      return await extractYouTube(page, url, opts, log);
    } else if (pageType === "pdf") {
      return await extractPdfFromViewer(page, url, opts, log);
    } else {
      return await extractWebPage(page, url, opts, log);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = message;
    return result;
  }
}

async function extractWebPage(
  page: import("puppeteer").Page,
  url: string,
  opts: CLIOptions,
  log: Logger
): Promise<ClipOutput> {
  const result: ClipOutput = {
    success: false,
    url,
    title: "",
    markdown: "",
    content: "",
    tags: opts.tags,
    data: {
      pageType: "web",
      metadata: {
        url,
        title: "",
        type: "article",
      },
    },
  };

  try {
    const pageData = await page.evaluate(extractWebContentInPage);
    const markdown = await page.evaluate(
      (html: string) => {
        // Inline htmlToMarkdown for browser context
        const doc = new DOMParser().parseFromString(html, "text/html");
        const body = doc.body;

        // Code blocks
        body.querySelectorAll("pre").forEach((pre) => {
          const code = pre.querySelector("code");
          const lang = code?.className?.match(/language-(\w+)/)?.[1] || "";
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
      },
      pageData.content
    );

    result.title = pageData.title;
    result.data!.metadata.title = pageData.title;
    result.data!.metadata.author = pageData.byline;
    result.data!.metadata.publishedDate = pageData.publishedTime;
    result.data!.metadata.description = pageData.excerpt;

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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Failed to extract web page: ${message}`;
    return result;
  }
}

async function extractYouTube(
  page: import("puppeteer").Page,
  url: string,
  opts: CLIOptions,
  log: Logger
): Promise<ClipOutput> {
  const result: ClipOutput = {
    success: false,
    url,
    title: "",
    markdown: "",
    content: "",
    tags: opts.tags,
    data: {
      pageType: "youtube",
      metadata: {
        url,
        title: "",
        type: "video",
      },
    },
  };

  try {
    // Wait for video info to load
    await page.waitForSelector("#title h1, h1.title", { timeout: 10000 }).catch(() => {});

    const videoInfo = await page.evaluate(extractYouTubeInPage);

    result.title = videoInfo.title;
    result.data!.metadata.title = videoInfo.title;
    result.data!.metadata.channel = videoInfo.channel;
    result.data!.metadata.duration = videoInfo.duration;
    result.data!.metadata.description = videoInfo.description;

    // Try to get transcript
    const transcript = await getYouTubeTranscriptInPage(page, opts.timestamps);

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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Failed to extract YouTube video: ${message}`;
    return result;
  }
}

async function getYouTubeTranscriptInPage(
  page: import("puppeteer").Page,
  includeTimestamps: boolean
): Promise<string | null> {
  try {
    // Try to click "Show transcript" button if available
    const transcriptButton = await page.$(
      'button[aria-label*="transcript" i], button[aria-label*="transcripts" i], ytd-button-renderer:has-text("Show transcript")'
    );

    if (transcriptButton) {
      await transcriptButton.click();
      await page.waitForSelector("ytd-transcript-segment-renderer", {
        timeout: 5000,
      }).catch(() => {});
    }

    // Try to extract transcript from the panel
    const transcript = await page.evaluate((timestamps) => {
      const segments = document.querySelectorAll(
        "ytd-transcript-segment-renderer, .cue-group"
      );
      if (segments.length === 0) return null;

      const lines: string[] = [];
      segments.forEach((seg) => {
        const timeEl = seg.querySelector(
          ".segment-timestamp, .cue-group-start-offset"
        );
        const textEl = seg.querySelector(".segment-text, .cue");
        if (textEl?.textContent?.trim()) {
          const time = timeEl?.textContent?.trim() || "";
          const text = textEl.textContent.trim();
          if (timestamps && time) {
            lines.push(`**[${time}]** ${text}`);
          } else {
            lines.push(text);
          }
        }
      });

      return lines.length > 0 ? lines.join("\n\n") : null;
    }, includeTimestamps);

    return transcript;
  } catch {
    return null;
  }
}

async function extractPdfFromViewer(
  page: import("puppeteer").Page,
  url: string,
  opts: CLIOptions,
  log: Logger
): Promise<ClipOutput> {
  const result: ClipOutput = {
    success: false,
    url,
    title: "",
    markdown: "",
    content: "",
    tags: opts.tags,
    data: {
      pageType: "pdf",
      metadata: {
        url,
        title: "",
        type: "document",
      },
    },
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
      result.data!.metadata.title = pdfData.title;
      result.markdown = `# ${pdfData.title}\n\n> PDF content extraction in CLI requires downloading the file. Use the browser extension for full PDF support.\n\n**URL:** ${url}\n`;
      result.success = true;
      return result;
    }

    // For other PDF URLs, note that full extraction needs download
    const filename = url.split("/").pop() || "Document.pdf";
    result.title = filename.replace(/\.pdf$/i, "");
    result.data!.metadata.title = result.title;
    result.markdown = `# ${result.title}\n\n> PDF content extraction requires downloading the file. Consider using the browser extension for full PDF support.\n\n**URL:** ${url}\n`;
    result.success = true;

    log(`  ✓ PDF detected: "${result.title}" (limited extraction)`);
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Failed to extract PDF: ${message}`;
    return result;
  }
}

// ─── Save Logic ──────────────────────────────────────────────────────────────

function buildFullMarkdown(result: ClipOutput, opts: CLIOptions): string {
  const pageType = result.data?.pageType || "web";
  const metadata = result.data?.metadata;

  const contentType: ClipContentType =
    pageType === "youtube" ? "video" :
    pageType === "pdf" ? "document" : "article";

  const frontmatterInput: FrontmatterInput = {
    source: result.url,
    title: result.title || "Untitled",
    type: contentType,
    dateClippedISO: new Date().toISOString(),
    tags: opts.tags,
    author: metadata?.author,
    channel: metadata?.channel,
    duration: metadata?.duration,
    extra: {
      page_type: pageType,
    },
  };

  const frontmatter = buildFrontmatterYaml(frontmatterInput);
  return frontmatter + result.markdown + (result.markdown.endsWith("\n") ? "" : "\n");
}

async function saveResult(result: ClipOutput, opts: CLIOptions, log: Logger): Promise<void> {
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
  const log = createLogger();
  const opts = parseArgs(process.argv.slice(2), log);

  if (!opts.url) {
    log.error("No URL provided. Use --help for usage info.");
    process.exit(1);
  }

  log(`\n🔖 Universal URL Clipper`);
  log(`   URL: ${opts.url}`);
  log(`   Type: ${detectPageType(opts.url)}\n`);

  if (opts.profile) {
    log(`   Using Chrome profile: ${opts.profile}\n`);
  }

  const browser = await launchBrowser({
    headless: opts.headless,
    profile: opts.profile,
  });

  try {
    const page = await createPage(browser);
    const result = await clipUrl(page, opts.url, opts, log);

    // --json mode: output structured JSON to stdout using ToolOutput format
    if (opts.json) {
      const output: ClipOutput = {
        success: result.success,
        url: result.url,
        title: result.title,
        markdown: result.success ? buildFullMarkdown(result, opts) : "",
        content: result.markdown,
        tags: result.tags,
        error: result.error,
        data: result.data,
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      await saveResult(result, opts, log);
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
