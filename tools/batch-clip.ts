#!/usr/bin/env bun
/**
 * Batch URL Clipper
 *
 * Clip multiple URLs concurrently and output as a JSON array.
 * Reads URLs from command line args, stdin, or a file.
 *
 * Usage:
 *   # Clip multiple URLs from args
 *   bun run tools/batch-clip.ts https://example.com https://other.com
 *
 *   # Clip from a file (one URL per line)
 *   bun run tools/batch-clip.ts @file:urls.txt
 *
 *   # Pipe URLs via stdin
 *   cat urls.txt | bun run tools/batch-clip.ts --stdin
 *
 *   # Parallel processing (default: 4)
 *   bun run tools/batch-clip.ts --parallel 8 @file:urls.txt
 *
 *   # Output as JSON array
 *   bun run tools/batch-clip.ts --json https://example.com https://other.com
 *
 *   # Continue on errors
 *   bun run tools/batch-clip.ts --continue-on-error @file:urls.txt
 *
 *   # Save to Obsidian via CLI
 *   bun run tools/batch-clip.ts --cli --vault "My Vault" @file:urls.txt
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { saveViaCli, type CliSaveResult } from "../src/shared/obsidianCliSave";
import { sanitizeFilename } from "../src/shared/sanitize";
import { buildFrontmatterYaml, type FrontmatterInput } from "../src/shared/markdown";
import { detectPageType } from "../src/shared/pageType";
import type { ClipContentType, PageType } from "../src/shared/types";
import {
  launchBrowser,
  createPage,
  createLogger,
  resolveUrls,
  type CommonCLIOptions,
  type Logger,
  type ToolOutput,
  type ToolMetadata,
  DEFAULT_CLI_OPTIONS,
} from "./lib/clipper-core";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CLIOptions extends CommonCLIOptions {
  urls: string[];
  parallel: number;
  stdin: boolean;
  continueOnError: boolean;
  timestamps: boolean;
  progress: boolean;
}

interface ClipOutputData {
  pageType: PageType;
  metadata: ToolMetadata;
}

type ClipOutput = ToolOutput<ClipOutputData>;

interface BatchResult {
  success: boolean;
  total: number;
  succeeded: number;
  failed: number;
  results: ClipOutput[];
}

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[], log: Logger): CLIOptions {
  const opts: CLIOptions = {
    urls: [],
    ...DEFAULT_CLI_OPTIONS,
    parallel: 4,
    stdin: false,
    continueOnError: false,
    timestamps: true,
    progress: true,
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
    } else if (arg === "--parallel" || arg === "-p") {
      i++;
      opts.parallel = parseInt(argv[i] || "4", 10);
    } else if (arg === "--stdin") {
      opts.stdin = true;
    } else if (arg === "--continue-on-error" || arg === "-c") {
      opts.continueOnError = true;
    } else if (arg === "--no-progress") {
      opts.progress = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("http") || arg.startsWith("@file:")) {
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
Batch URL Clipper — Clip multiple URLs concurrently

USAGE:
  bun run tools/batch-clip.ts [OPTIONS] <URLs...>
  bun run tools/batch-clip.ts [OPTIONS] @file:urls.txt
  cat urls.txt | bun run tools/batch-clip.ts [OPTIONS] --stdin

OPTIONS:
  --parallel, -p <n>    Number of concurrent workers (default: 4)
  --stdin               Read URLs from stdin (one per line)
  --continue-on-error   Continue processing if a URL fails (default: stop on error)
  --no-progress         Disable progress display
  --cli                 Use Obsidian CLI directly for file creation
  --cli-path <path>     Path to obsidian-cli binary (default: obsidian-cli from PATH)
  --vault <name>        Obsidian vault name (default: "Main Vault")
  --folder <path>       Obsidian folder path (default: "Clips")
  --profile <path>      Chrome user data dir (for auth cookies)
  --no-headless         Show the browser window
  --wait <ms>           Wait time for page load (default: 5000)
  --tags <a,b,c>        Comma-separated tags (default: "web-clip")
  --json                Output structured JSON array to stdout
  --stdout              Dump all markdown to stdout (separated by ---)
  --no-timestamps       Don't include timestamps in YouTube transcripts
  --help, -h            Show this help message

INPUT SOURCES:
  URLs can be provided via:
  - Command line args: url1 url2 url3
  - File: @file:path/to/urls.txt (one URL per line, # comments ignored)
  - Stdin: --stdin flag reads one URL per line

EXAMPLES:
  # Clip multiple URLs
  bun run tools/batch-clip.ts https://example.com https://other.com

  # Clip from a file with 8 parallel workers
  bun run tools/batch-clip.ts --parallel 8 @file:urls.txt

  # Pipe URLs and output as JSON
  cat urls.txt | bun run tools/batch-clip.ts --stdin --json

  # Save all to Obsidian, continue on errors
  bun run tools/batch-clip.ts --cli --vault "Research" --continue-on-error @file:urls.txt
`);
}

// ─── Page Extraction Functions ───────────────────────────────────────────────

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

function extractWebContentInPage(): {
  title: string;
  content: string;
  excerpt: string;
  byline: string;
  publishedTime: string;
} {
  const title =
    document.querySelector("meta[property='og:title']")?.getAttribute("content") ||
    document.querySelector("title")?.textContent ||
    "Untitled";

  const mainSelectors = [
    "article",
    "[role='main']",
    "main",
    ".post-content",
    ".article-content",
    ".entry-content",
    ".content",
  ];

  let contentEl: Element | null = null;
  for (const selector of mainSelectors) {
    contentEl = document.querySelector(selector);
    if (contentEl) break;
  }

  if (!contentEl) {
    contentEl = document.body;
  }

  const excerpt =
    document.querySelector("meta[name='description']")?.getAttribute("content") ||
    document.querySelector("meta[property='og:description']")?.getAttribute("content") ||
    "";

  const byline =
    document.querySelector("meta[name='author']")?.getAttribute("content") ||
    document.querySelector("[rel='author']")?.textContent ||
    "";

  const publishedTime =
    document.querySelector("meta[property='article:published_time']")?.getAttribute("content") ||
    document.querySelector("time")?.getAttribute("datetime") ||
    "";

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
    "[role='navigation']",
  ];

  for (const selector of removeSelectors) {
    clone.querySelectorAll(selector).forEach((el) => el.remove());
  }

  return {
    title: title.trim(),
    content: clone.innerHTML,
    excerpt: excerpt.trim(),
    byline: byline.trim(),
    publishedTime: publishedTime.trim(),
  };
}

function htmlToMarkdownInBrowser(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;

  body.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    const lang = code?.className?.match(/language-(\w+)/)?.[1] || "";
    const text = code?.textContent || pre.textContent || "";
    const ph = document.createElement("p");
    ph.textContent = `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
    pre.replaceWith(ph);
  });

  body.querySelectorAll("code").forEach((el) => {
    if (!el.closest("pre")) {
      el.textContent = `\`${el.textContent}\``;
    }
  });

  for (let i = 1; i <= 6; i++) {
    body.querySelectorAll(`h${i}`).forEach((el) => {
      el.textContent = `${"#".repeat(i)} ${el.textContent}\n\n`;
    });
  }

  body.querySelectorAll("strong, b").forEach((el) => {
    el.textContent = `**${el.textContent}**`;
  });

  body.querySelectorAll("em, i").forEach((el) => {
    el.textContent = `*${el.textContent}*`;
  });

  body.querySelectorAll("a").forEach((el) => {
    const href = el.getAttribute("href") || "";
    const text = el.textContent || "";
    if (href && text) {
      el.textContent = `[${text}](${href})`;
    }
  });

  body.querySelectorAll("img").forEach((el) => {
    const src = el.getAttribute("src") || "";
    const alt = el.getAttribute("alt") || "image";
    if (src) {
      const ph = document.createElement("p");
      ph.textContent = `![${alt}](${src})\n`;
      el.replaceWith(ph);
    }
  });

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

  body.querySelectorAll("blockquote").forEach((bq) => {
    const lines = (bq.textContent || "").split("\n");
    bq.textContent = lines.map((l) => `> ${l}`).join("\n") + "\n\n";
  });

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

  body.querySelectorAll("p").forEach((p) => {
    if (!p.textContent?.trim()) return;
    p.textContent = `${p.textContent?.trim()}\n\n`;
  });

  body.querySelectorAll("br").forEach((br) => {
    br.replaceWith(document.createTextNode("\n"));
  });

  let text = body.textContent || "";
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
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
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
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
    const markdown = await page.evaluate(htmlToMarkdownInBrowser, pageData.content);

    result.title = pageData.title;
    result.data!.metadata.title = pageData.title;
    result.data!.metadata.author = pageData.byline;
    result.data!.metadata.publishedDate = pageData.publishedTime;
    result.data!.metadata.description = pageData.excerpt;

    let bodyMarkdown = `# ${pageData.title}\n\n`;
    if (pageData.excerpt) {
      bodyMarkdown += `> ${pageData.excerpt}\n\n`;
    }
    bodyMarkdown += markdown;

    result.content = bodyMarkdown;
    result.success = true;

    log(`  ✓ "${pageData.title}"`);
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
    await page.waitForSelector("#title h1, h1.title", { timeout: 10000 }).catch(() => {});

    const videoInfo = await page.evaluate(extractYouTubeInPage);

    result.title = videoInfo.title;
    result.data!.metadata.title = videoInfo.title;
    result.data!.metadata.channel = videoInfo.channel;
    result.data!.metadata.duration = videoInfo.duration;
    result.data!.metadata.description = videoInfo.description;

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
      bodyMarkdown += `> ⚠️ **Transcript not available.**\n`;
    }

    result.content = bodyMarkdown;
    result.success = true;

    log(`  ✓ YouTube: "${videoInfo.title}"`);
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
    const transcriptButton = await page.$(
      'button[aria-label*="transcript" i], button[aria-label*="transcripts" i], ytd-button-renderer:has-text("Show transcript")'
    );

    if (transcriptButton) {
      await transcriptButton.click();
      await page.waitForSelector("ytd-transcript-segment-renderer", {
        timeout: 5000,
      }).catch(() => {});
    }

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

  const filename = url.split("/").pop() || "Document.pdf";
  result.title = filename.replace(/\.pdf$/i, "");
  result.data!.metadata.title = result.title;
  result.content = `# ${result.title}\n\n> PDF content extraction requires downloading the file.\n\n**URL:** ${url}\n`;
  result.success = true;

  log(`  ✓ PDF: "${result.title}"`);
  return result;
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
  return frontmatter + result.content + (result.content.endsWith("\n") ? "" : "\n");
}

async function saveResult(result: ClipOutput, opts: CLIOptions, log: Logger): Promise<void> {
  if (!result.success) {
    return;
  }

  const fullMarkdown = buildFullMarkdown(result, opts);
  result.markdown = fullMarkdown;

  if (opts.cli) {
    const title = sanitizeFilename(result.title || "Untitled");
    const filePath = opts.folder ? `${opts.folder}/${title}` : title;

    const saveResult: CliSaveResult = await saveViaCli(
      { cliPath: opts.cliPath, vault: opts.vault, enabled: true },
      { filePath, content: fullMarkdown, overwrite: true }
    );

    if (saveResult.success) {
      log(`  📎 Saved: ${title}`);
    } else {
      log(`  ✗ Save failed: ${saveResult.error}`);
    }
  }
}

// ─── Concurrency Control ─────────────────────────────────────────────────────

async function processBatch(
  urls: string[],
  opts: CLIOptions,
  log: Logger
): Promise<BatchResult> {
  const results: ClipOutput[] = [];
  let succeeded = 0;
  let failed = 0;
  const total = urls.length;

  // Progress tracking
  let completed = 0;
  const updateProgress = () => {
    completed++;
    if (opts.progress && !opts.json && !opts.stdout) {
      const pct = Math.round((completed / total) * 100);
      process.stderr.write(`\rProgress: ${completed}/${total} (${pct}%) - ✓${succeeded} ✗${failed}`);
    }
  };

  // Worker function
  const processUrl = async (url: string): Promise<ClipOutput> => {
    const browser = await launchBrowser({
      headless: opts.headless,
      profile: opts.profile,
    });

    try {
      const page = await createPage(browser);
      const result = await clipUrl(page, url, opts, log);
      await saveResult(result, opts, log);

      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }

      updateProgress();
      return result;
    } finally {
      await browser.close();
    }
  };

  // Process with concurrency limit
  const workerQueue = [...urls];
  const activeWorkers: Promise<ClipOutput>[] = [];

  while (workerQueue.length > 0 || activeWorkers.length > 0) {
    // Fill up to parallel limit
    while (activeWorkers.length < opts.parallel && workerQueue.length > 0) {
      const url = workerQueue.shift()!;
      const promise = processUrl(url).then((result) => {
        // Remove self from active list
        const idx = activeWorkers.indexOf(promise);
        if (idx !== -1) activeWorkers.splice(idx, 1);
        return result;
      });

      activeWorkers.push(promise);
      results.push(await promise); // Wait for each to complete for ordered results

      // Check for failure if not continuing on error
      if (!opts.continueOnError && failed > 0) {
        log.error(`\nStopping due to failure. Use --continue-on-error to continue.`);
        // Wait for active workers to finish
        await Promise.all(activeWorkers);
        break;
      }
    }

    // Wait for at least one worker if we're at capacity
    if (activeWorkers.length >= opts.parallel) {
      await Promise.race(activeWorkers);
    }
  }

  if (opts.progress && !opts.json && !opts.stdout) {
    process.stderr.write("\n");
  }

  return {
    total,
    succeeded,
    failed,
    results,
  };
}

// ─── Stdin Reader ────────────────────────────────────────────────────────────

async function readStdin(): Promise<string[]> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const content = Buffer.concat(chunks).toString("utf-8");
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && l.startsWith("http"));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const log = createLogger();
  const opts = parseArgs(process.argv.slice(2), log);

  // Quiet mode for JSON/stdout
  if (opts.json || opts.stdout) {
    log.setQuiet(true);
  }

  // Resolve URLs
  let urls: string[] = [];

  if (opts.stdin) {
    urls = await readStdin();
  } else if (opts.urls.length > 0) {
    urls = await resolveUrls(opts.urls);
  }

  if (urls.length === 0) {
    log.error("No URLs provided. Use --help for usage info.");
    process.exit(1);
  }

  log(`\n🔖 Batch URL Clipper`);
  log(`   URLs: ${urls.length}`);
  log(`   Parallel: ${opts.parallel}`);
  log(`   Continue on error: ${opts.continueOnError}\n`);

  if (opts.profile) {
    log(`   Using Chrome profile: ${opts.profile}\n`);
  }

  const batchResult = await processBatch(urls, opts, log);

  // Output results
  if (opts.json) {
    // Mark overall success based on failures
    batchResult.success = batchResult.failed === 0;
    console.log(JSON.stringify(batchResult, null, 2));
  } else if (opts.stdout) {
    // Output all markdown separated by ---
    for (const result of batchResult.results) {
      if (result.success && result.markdown) {
        console.log(result.markdown);
        console.log("\n---\n");
      }
    }
  } else {
    log(`\n────────────────────────────────────`);
    log(`✅ Complete: ${batchResult.succeeded}/${batchResult.total} succeeded`);
    if (batchResult.failed > 0) {
      log(`❌ Failed: ${batchResult.failed}`);
      for (const result of batchResult.results) {
        if (!result.success) {
          log(`   - ${result.url}: ${result.error}`);
        }
      }
    }
    log();
  }

  // Exit with error code if any failed
  if (batchResult.failed > 0 && !opts.continueOnError) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
