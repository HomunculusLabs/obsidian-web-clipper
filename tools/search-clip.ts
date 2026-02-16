#!/usr/bin/env bun
/**
 * Search-and-Clip Tool
 *
 * Search Google for a query, then clip the top N results.
 * Useful for research pipelines and automated content gathering.
 *
 * Usage:
 *   # Search and clip top 5 results
 *   bun run tools/search-clip.ts --query "obsidian plugins" --top 5
 *
 *   # Output as JSON (for LLM tool calls)
 *   bun run tools/search-clip.ts --query "TypeScript best practices" --json
 *
 *   # Save directly to Obsidian via CLI
 *   bun run tools/search-clip.ts --query "AI research papers" --cli --vault "Research"
 *
 *   # Use Chrome profile for personalized results
 *   bun run tools/search-clip.ts --profile ~/.config/google-chrome/Default --query "news today" --top 10
 *
 *   # Continue on errors (skip failed clips)
 *   bun run tools/search-clip.ts --query "topic" --continue-on-error
 */

import { resolve } from "node:path";
import { saveViaCli, type CliSaveResult } from "../src/shared/obsidianCliSave";
import { sanitizeFilename } from "../src/shared/sanitize";
import { buildFrontmatterYaml, type FrontmatterInput } from "../src/shared/markdown";
import { detectPageType } from "../src/shared/pageType";
import type { ClipContentType, PageType } from "../src/shared/types";
import {
  launchBrowser,
  createPage,
  createLogger,
  type CommonCLIOptions,
  type Logger,
  type ToolOutput,
  type ToolMetadata,
  DEFAULT_CLI_OPTIONS,
} from "./lib/clipper-core";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CLIOptions extends CommonCLIOptions {
  query: string;
  top: number;
  continueOnError: boolean;
  progress: boolean;
  timestamps: boolean;
}

interface ClipOutputData {
  pageType: PageType;
  metadata: ToolMetadata;
}

type ClipOutput = ToolOutput<ClipOutputData>;

interface SearchResult {
  url: string;
  title: string;
}

interface SearchClipResult {
  success: boolean;
  query: string;
  total: number;
  succeeded: number;
  failed: number;
  results: ClipOutput[];
  searchResults: SearchResult[];
  error?: string;
}

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[], log: Logger): CLIOptions {
  const opts: CLIOptions = {
    query: "",
    top: 5,
    continueOnError: false,
    progress: true,
    timestamps: true,
    ...DEFAULT_CLI_OPTIONS,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--query" || arg === "-q") {
      i++;
      opts.query = argv[i] || "";
    } else if (arg === "--top" || arg === "-n") {
      i++;
      opts.top = parseInt(argv[i] || "5", 10);
    } else if (arg === "--continue-on-error" || arg === "-c") {
      opts.continueOnError = true;
    } else if (arg === "--no-progress") {
      opts.progress = false;
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
Search-and-Clip Tool — Search Google and clip top results

USAGE:
  bun run tools/search-clip.ts [OPTIONS] --query "search query"

OPTIONS:
  --query, -q <text>    Search query (required)
  --top, -n <n>         Number of results to clip (default: 5)
  --continue-on-error   Continue clipping if a result fails (default: stop on error)
  --no-progress         Disable progress display

  --cli                 Use Obsidian CLI directly for file creation
  --cli-path <path>     Path to obsidian-cli binary (default: obsidian-cli from PATH)
  --vault <name>        Obsidian vault name (default: "Main Vault")
  --folder <path>       Obsidian folder path (default: "Clips")
  --profile <path>      Chrome user data dir (for auth cookies / personalized results)
  --no-headless         Show the browser window
  --wait <ms>           Wait time for page load (default: 5000)
  --tags <a,b,c>        Comma-separated tags (default: "web-clip")
  --json                Output structured JSON to stdout (for LLM tool calls)
  --stdout              Dump all markdown to stdout (separated by ---)
  --no-timestamps       Don't include timestamps in YouTube transcripts
  --help, -h            Show this help message

EXAMPLES:
  # Search and clip top 5 results
  bun run tools/search-clip.ts --query "obsidian plugins"

  # Clip top 10 and save to Obsidian
  bun run tools/search-clip.ts --query "TypeScript tutorials" --top 10 --cli --vault "Notes"

  # LLM tool call: get structured JSON back
  bun run tools/search-clip.ts --query "latest AI research" --json

  # Use Chrome profile for personalized search results
  bun run tools/search-clip.ts --profile ~/.config/google-chrome/Default --query "news"
`);
}

// ─── Google Search Extraction ────────────────────────────────────────────────

/**
 * Extract search results from Google SERP.
 * This function runs in browser context.
 */
function extractGoogleSearchResults(): { url: string; title: string }[] {
  const results: { url: string; title: string }[] = [];

  // Standard organic results
  const resultSelectors = [
    '#search .g a[href^="http"]',           // Standard results
    '#rso .g a[href^="http"]',              // Results container
    'div[data-hveid] a[href^="http"]',      // Alternative structure
  ];

  const seenUrls = new Set<string>();

  for (const selector of resultSelectors) {
    const links = document.querySelectorAll(selector);

    for (const link of Array.from(links)) {
      const href = link.getAttribute('href');
      if (!href || seenUrls.has(href)) continue;

      // Skip Google's own URLs and common non-content URLs
      if (href.includes('google.com/search') ||
          href.includes('google.com/url') ||
          href.includes('webcache.googleusercontent.com') ||
          href.includes('accounts.google.com')) {
        continue;
      }

      // Get title - check various possible locations
      let title = '';
      const parent = link.closest('.g') || link.closest('div[data-hveid]');
      if (parent) {
        const h3 = parent.querySelector('h3');
        title = h3?.textContent?.trim() || '';
      }
      if (!title) {
        title = link.textContent?.trim() || '';
      }

      // Skip if no meaningful title
      if (!title || title.length < 3) continue;

      seenUrls.add(href);
      results.push({ url: href, title });
    }
  }

  return results;
}

// ─── Page Extraction Functions ───────────────────────────────────────────────

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

async function performSearch(
  page: import("puppeteer").Page,
  query: string,
  topN: number,
  log: Logger
): Promise<SearchResult[]> {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  log(`  → Searching: "${query}"`);
  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 30000 });

  // Wait for results to load
  await page.waitForSelector('#search, #rso', { timeout: 10000 }).catch(() => {});

  // Additional settling time
  await new Promise((r) => setTimeout(r, 2000));

  const results = await page.evaluate(extractGoogleSearchResults);
  const topResults = results.slice(0, topN);

  log(`  ✓ Found ${results.length} results, clipping top ${topResults.length}`);

  return topResults;
}

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
    log(`    → Clipping: ${url}`);
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
    log(`    ✗ Failed: ${message}`);
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

    log(`    ✓ "${pageData.title}"`);
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Failed to extract: ${message}`;
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

    log(`    ✓ YouTube: "${videoInfo.title}"`);
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Failed to extract YouTube: ${message}`;
    return result;
  }
}

async function getYouTubeTranscriptInPage(
  page: import("puppeteer").Page,
  includeTimestamps: boolean
): Promise<string | null> {
  try {
    const transcriptButton = await page.$(
      'button[aria-label*="transcript" i], button[aria-label*="transcripts" i]'
    );

    if (transcriptButton) {
      await transcriptButton.click();
      await page.waitForSelector("ytd-transcript-segment-renderer", { timeout: 5000 }).catch(() => {});
    }

    const transcript = await page.evaluate((timestamps) => {
      const segments = document.querySelectorAll("ytd-transcript-segment-renderer, .cue-group");
      if (segments.length === 0) return null;

      const lines: string[] = [];
      segments.forEach((seg) => {
        const timeEl = seg.querySelector(".segment-timestamp, .cue-group-start-offset");
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
  result.content = `# ${result.title}\n\n> PDF content extraction requires downloading.\n\n**URL:** ${url}\n`;
  result.success = true;

  log(`    ✓ PDF: "${result.title}"`);
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
  if (!result.success) return;

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
      log(`    📎 Saved: ${title}`);
    } else {
      log(`    ✗ Save failed: ${saveResult.error}`);
    }
  }
}

// ─── Main Processing Logic ───────────────────────────────────────────────────

async function processSearch(
  query: string,
  opts: CLIOptions,
  log: Logger
): Promise<SearchClipResult> {
  const browser = await launchBrowser({
    headless: opts.headless,
    profile: opts.profile,
  });

  const results: ClipOutput[] = [];
  let succeeded = 0;
  let failed = 0;

  try {
    const searchPage = await createPage(browser);

    // Perform search
    const searchResults = await performSearch(searchPage, query, opts.top, log);

    if (searchResults.length === 0) {
      log(`  ⚠️ No search results found`);
      return {
        success: true,
        query,
        total: 0,
        succeeded: 0,
        failed: 0,
        results: [],
        searchResults: [],
      };
    }

    // Clip each result
    let completed = 0;
    for (const searchResult of searchResults) {
      completed++;

      if (opts.progress && !opts.json && !opts.stdout) {
        process.stderr.write(`\r  Progress: ${completed}/${searchResults.length} - ✓${succeeded} ✗${failed}`);
      }

      const clipPage = await createPage(browser);
      const result = await clipUrl(clipPage, searchResult.url, opts, log);

      if (result.success) {
        succeeded++;
        await saveResult(result, opts, log);
      } else {
        failed++;
        if (!opts.continueOnError) {
          log.error(`\n  Stopping due to failure. Use --continue-on-error to continue.`);
          results.push(result);
          break;
        }
      }

      results.push(result);
      await clipPage.close();
    }

    if (opts.progress && !opts.json && !opts.stdout) {
      process.stderr.write("\n");
    }

    await searchPage.close();

    return {
      success: true,
      query,
      total: searchResults.length,
      succeeded,
      failed,
      results,
      searchResults,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      query,
      total: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      searchResults: [],
      error: message,
    };
  } finally {
    await browser.close();
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const log = createLogger();
  const opts = parseArgs(process.argv.slice(2), log);

  // Quiet mode for JSON/stdout
  if (opts.json || opts.stdout) {
    log.setQuiet(true);
  }

  if (!opts.query) {
    log.error("No search query provided. Use --query or -q to specify a search.");
    printHelp();
    process.exit(1);
  }

  log(`\n🔍 Search-and-Clip Tool`);
  log(`   Query: "${opts.query}"`);
  log(`   Top N: ${opts.top}`);
  log(`   Continue on error: ${opts.continueOnError}\n`);

  if (opts.profile) {
    log(`   Using Chrome profile: ${opts.profile}\n`);
  }

  const result = await processSearch(opts.query, opts, log);

  // Output results
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (opts.stdout) {
    // Output all markdown separated by ---
    for (const clip of result.results) {
      if (clip.success && clip.markdown) {
        console.log(clip.markdown);
        console.log("\n---\n");
      }
    }
  } else {
    log(`\n────────────────────────────────────`);
    log(`✅ Complete: ${result.succeeded}/${result.total} clipped`);
    if (result.failed > 0) {
      log(`❌ Failed: ${result.failed}`);
      for (const clip of result.results) {
        if (!clip.success) {
          log(`   - ${clip.url}: ${clip.error}`);
        }
      }
    }
    log();
  }

  // Exit with error code if any failed
  if (result.failed > 0 && !opts.continueOnError) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
