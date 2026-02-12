#!/usr/bin/env bun
/**
 * Site Scraper Tool
 *
 * Crawl a site starting from a URL, clip all pages up to depth N.
 * Respects same-domain policy by default, with option to follow subdomains.
 *
 * Usage:
 *   # Crawl site with default settings (depth 1, max 20 pages)
 *   bun run tools/scrape-site.ts --url https://docs.example.com
 *
 *   # Crawl with depth 2 and max 50 pages
 *   bun run tools/scrape-site.ts --url https://example.com --depth 2 --max-pages 50
 *
 *   # Output as JSON manifest
 *   bun run tools/scrape-site.ts --url https://example.com --json
 *
 *   # Save directly to Obsidian via CLI
 *   bun run tools/scrape-site.ts --url https://example.com --cli --vault "Research"
 *
 *   # Include subdomains (e.g., blog.example.com, api.example.com)
 *   bun run tools/scrape-site.ts --url https://example.com --include-subdomains
 *
 *   # Use Chrome profile for authenticated scraping
 *   bun run tools/scrape-site.ts --profile ~/.config/google-chrome/Default --url https://app.example.com/docs
 *
 *   # Continue on errors (skip failed pages)
 *   bun run tools/scrape-site.ts --url https://example.com --continue-on-error
 *
 *   # Delay between requests (be polite!)
 *   bun run tools/scrape-site.ts --url https://example.com --delay 1000
 */

import { resolve } from "node:path";
import { URL } from "node:url";
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
  url: string;
  depth: number;
  maxPages: number;
  includeSubdomains: boolean;
  continueOnError: boolean;
  delay: number;
  progress: boolean;
  timestamps: boolean;
  userAgent: string;
}

interface ClipOutputData {
  pageType: PageType;
  depth: number;
  metadata: ToolMetadata;
  links: string[];
}

type ClipOutput = ToolOutput<ClipOutputData>;

interface CrawlQueueItem {
  url: string;
  depth: number;
  parentUrl?: string;
}

interface ScraperResult {
  success: boolean;
  startUrl: string;
  total: number;
  succeeded: number;
  failed: number;
  maxDepth: number;
  pages: ClipOutput[];
  manifest: PageManifest[];
  error?: string;
}

interface PageManifest {
  url: string;
  title: string;
  depth: number;
  status: "success" | "failed";
  error?: string;
  filePath?: string;
}

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[], log: Logger): CLIOptions {
  const opts: CLIOptions = {
    url: "",
    depth: 1,
    maxPages: 20,
    includeSubdomains: false,
    continueOnError: false,
    delay: 500,
    progress: true,
    timestamps: true,
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ObsidianWebClipper/1.0",
    ...DEFAULT_CLI_OPTIONS,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--url" || arg === "-u") {
      i++;
      opts.url = argv[i] || "";
    } else if (arg === "--depth" || arg === "-d") {
      i++;
      opts.depth = parseInt(argv[i] || "1", 10);
    } else if (arg === "--max-pages" || arg === "-m") {
      i++;
      opts.maxPages = parseInt(argv[i] || "20", 10);
    } else if (arg === "--include-subdomains") {
      opts.includeSubdomains = true;
    } else if (arg === "--continue-on-error" || arg === "-c") {
      opts.continueOnError = true;
    } else if (arg === "--delay") {
      i++;
      opts.delay = parseInt(argv[i] || "500", 10);
    } else if (arg === "--no-progress") {
      opts.progress = false;
    } else if (arg === "--user-agent") {
      i++;
      opts.userAgent = argv[i] || opts.userAgent;
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
Site Scraper Tool — Crawl and clip entire sites

USAGE:
  bun run tools/scrape-site.ts [OPTIONS] --url <start-url>

OPTIONS:
  --url, -u <url>           Starting URL to crawl (required)
  --depth, -d <n>           Maximum crawl depth (default: 1, 0 = only start page)
  --max-pages, -m <n>       Maximum pages to clip (default: 20)
  --include-subdomains      Follow links to subdomains (e.g., blog.example.com)
  --continue-on-error       Continue scraping if a page fails (default: stop on error)
  --delay <ms>              Delay between requests in ms (default: 500, be polite!)
  --no-progress             Disable progress display
  --user-agent <string>     Custom user agent string

  --cli                     Use Obsidian CLI directly for file creation
  --cli-path <path>         Path to obsidian-cli binary (default: obsidian-cli from PATH)
  --vault <name>            Obsidian vault name (default: "Main Vault")
  --folder <path>           Obsidian folder path (default: "Clips")
  --profile <path>          Chrome user data dir (for auth cookies)
  --no-headless             Show the browser window
  --wait <ms>               Wait time for page load (default: 5000)
  --tags <a,b,c>            Comma-separated tags (default: "web-clip")
  --json                    Output structured JSON manifest to stdout
  --stdout                  Dump all markdown to stdout (separated by ---)
  --no-timestamps           Don't include timestamps in YouTube transcripts
  --help, -h                Show this help message

CRAWL BEHAVIOR:
  - By default, only follows links within the same domain
  - Depth 0 = only the start page
  - Depth 1 = start page + all linked pages on same domain
  - Depth 2 = + pages linked from those, etc.
  - Ignores: mailto:, tel:, javascript:, #anchors, common binary files

OUTPUT:
  - Returns a manifest of all clipped pages with status
  - With --json: structured JSON with full results
  - With --stdout: concatenated markdown separated by ---

EXAMPLES:
  # Scrape docs site with depth 2
  bun run tools/scrape-site.ts --url https://docs.example.com --depth 2 --max-pages 50

  # Crawl and save to Obsidian
  bun run tools/scrape-site.ts --url https://blog.example.com --cli --vault "Notes"

  # Authenticated scraping with Chrome profile
  bun run tools/scrape-site.ts --profile ~/.config/google-chrome/Default \\
    --url https://app.example.com/docs --depth 2

  # Get JSON manifest for LLM processing
  bun run tools/scrape-site.ts --url https://example.com --json
`);
}

// ─── URL Utilities ───────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash for consistency
    let normalized = parsed.origin + parsed.pathname.replace(/\/$/, "") + parsed.search;
    // Remove common tracking params
    const cleanParams = new URLSearchParams();
    for (const [key, value] of parsed.searchParams) {
      if (!['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].includes(key)) {
        cleanParams.set(key, value);
      }
    }
    const searchStr = cleanParams.toString();
    normalized = parsed.origin + parsed.pathname.replace(/\/$/, "") + (searchStr ? '?' + searchStr : '');
    return normalized;
  } catch {
    return url;
  }
}

function isSameDomain(url1: string, url2: string, includeSubdomains: boolean): boolean {
  try {
    const parsed1 = new URL(url1);
    const parsed2 = new URL(url2);

    if (includeSubdomains) {
      // Check if they share the same root domain
      const getRootDomain = (hostname: string): string => {
        const parts = hostname.split('.');
        if (parts.length <= 2) return hostname;
        return parts.slice(-2).join('.');
      };
      return getRootDomain(parsed1.hostname) === getRootDomain(parsed2.hostname);
    } else {
      return parsed1.hostname === parsed2.hostname;
    }
  } catch {
    return false;
  }
}

function shouldSkipUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Skip non-http(s) protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return true;
    }

    // Skip common binary/media files
    const skipExtensions = [
      '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
      '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',
      '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.exe', '.dmg', '.apk', '.app',
    ];

    const path = parsed.pathname.toLowerCase();
    if (skipExtensions.some(ext => path.endsWith(ext))) {
      return true;
    }

    // Skip common non-content paths
    const skipPaths = [
      '/login', '/signin', '/signup', '/register',
      '/logout', '/admin', '/api/',
      '/search', '/tag/', '/tags/',
    ];

    if (skipPaths.some(p => path.startsWith(p))) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

// ─── Page Extraction Functions ───────────────────────────────────────────────

function extractLinksAndContent(): {
  title: string;
  content: string;
  excerpt: string;
  byline: string;
  publishedTime: string;
  links: string[];
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
    "#content",
    ".post",
    ".article",
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
    ".navigation",
    ".menu",
    "[role='navigation']",
    ".cookie-banner",
    ".popup",
    ".modal",
  ];

  for (const selector of removeSelectors) {
    clone.querySelectorAll(selector).forEach((el) => el.remove());
  }

  // Extract links from the original page (not the cleaned clone)
  const links: string[] = [];
  const seenLinks = new Set<string>();

  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!href) return;

    try {
      // Resolve relative URLs
      const absoluteUrl = new URL(href, window.location.href).href;

      // Skip anchor-only links
      if (href.startsWith('#')) return;

      // Skip mailto/tel/javascript
      if (/^(mailto:|tel:|javascript:)/i.test(href)) return;

      const normalized = absoluteUrl.split('#')[0]; // Remove anchors
      if (!seenLinks.has(normalized)) {
        seenLinks.add(normalized);
        links.push(normalized);
      }
    } catch {
      // Invalid URL, skip
    }
  });

  return {
    title: title.trim(),
    content: clone.innerHTML,
    excerpt: excerpt.trim(),
    byline: byline.trim(),
    publishedTime: publishedTime.trim(),
    links,
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

async function clipPage(
  page: import("puppeteer").Page,
  url: string,
  depth: number,
  opts: CLIOptions,
  log: Logger
): Promise<ClipOutput> {
  const pageType = detectPageType(url);
  const result: ClipOutput = {
    success: false,
    url,
    depth,
    title: "",
    markdown: "",
    content: "",
    tags: opts.tags,
    data: {
      pageType,
      depth,
      metadata: {
        url,
        title: "",
        type: "article",
      },
      links: [],
    },
  };

  try {
    log(`    → [D${depth}] ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, opts.wait));

    if (pageType === "youtube") {
      // Skip YouTube pages in site scraping - they're not typically part of a site
      result.error = "Skipping YouTube page in site scrape";
      result.data!.metadata.type = "video";
      return result;
    } else if (pageType === "pdf") {
      return await extractPdfFromViewer(page, url, depth, opts, log);
    } else {
      return await extractWebPage(page, url, depth, opts, log);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = message;
    log(`    ✗ [D${depth}] Failed: ${message}`);
    return result;
  }
}

async function extractWebPage(
  page: import("puppeteer").Page,
  url: string,
  depth: number,
  opts: CLIOptions,
  log: Logger
): Promise<ClipOutput> {
  const result: ClipOutput = {
    success: false,
    url,
    depth,
    title: "",
    markdown: "",
    content: "",
    tags: opts.tags,
    data: {
      pageType: "web",
      depth,
      metadata: {
        url,
        title: "",
        type: "article",
      },
      links: [],
    },
  };

  try {
    const pageData = await page.evaluate(extractLinksAndContent);
    const markdown = await page.evaluate(htmlToMarkdownInBrowser, pageData.content);

    result.title = pageData.title;
    result.data!.links = pageData.links;
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

    log(`    ✓ [D${depth}] "${pageData.title}" (${pageData.links.length} links)`);
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Failed to extract: ${message}`;
    return result;
  }
}

async function extractPdfFromViewer(
  page: import("puppeteer").Page,
  url: string,
  depth: number,
  opts: CLIOptions,
  log: Logger
): Promise<ClipOutput> {
  const result: ClipOutput = {
    success: false,
    url,
    depth,
    title: "",
    markdown: "",
    content: "",
    tags: opts.tags,
    data: {
      pageType: "pdf",
      depth,
      metadata: {
        url,
        title: "",
        type: "document",
      },
      links: [],
    },
  };

  const filename = url.split("/").pop() || "Document.pdf";
  result.title = filename.replace(/\.pdf$/i, "");
  result.data!.metadata.title = result.title;
  result.content = `# ${result.title}\n\n> PDF content extraction requires downloading.\n\n**URL:** ${url}\n`;
  result.success = true;

  log(`    ✓ [D${depth}] PDF: "${result.title}"`);
  return result;
}

// ─── Save Logic ──────────────────────────────────────────────────────────────

function buildFullMarkdown(result: ClipOutput, opts: CLIOptions): string {
  const pageType = result.data?.pageType || "web";
  const depth = result.data?.depth || 0;
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
    extra: {
      crawl_depth: depth,
      page_type: pageType,
    },
  };

  const frontmatter = buildFrontmatterYaml(frontmatterInput);
  return frontmatter + result.content + (result.content.endsWith("\n") ? "" : "\n");
}

async function saveResult(result: ClipOutput, opts: CLIOptions, log: Logger): Promise<string | undefined> {
  if (!result.success) return undefined;

  const fullMarkdown = buildFullMarkdown(result, opts);
  result.markdown = fullMarkdown;

  if (opts.cli) {
    const title = sanitizeFilename(result.title || "Untitled");
    // Create depth-based folder structure
    const depth = result.data?.depth || 0;
    const folderPath = opts.folder ? `${opts.folder}/depth-${depth}` : `depth-${depth}`;
    const filePath = `${folderPath}/${title}`;

    const saveResult: CliSaveResult = await saveViaCli(
      { cliPath: opts.cliPath, vault: opts.vault, enabled: true },
      { filePath, content: fullMarkdown, overwrite: true }
    );

    if (saveResult.success) {
      log(`    📎 Saved: ${filePath}`);
      return filePath;
    } else {
      log(`    ✗ Save failed: ${saveResult.error}`);
      return undefined;
    }
  }

  return undefined;
}

// ─── Crawl Logic ─────────────────────────────────────────────────────────────

async function crawlSite(
  startUrl: string,
  opts: CLIOptions,
  log: Logger
): Promise<ScraperResult> {
  const browser = await launchBrowser({
    headless: opts.headless,
    profile: opts.profile,
  });

  const pages: ClipOutput[] = [];
  const manifest: PageManifest[] = [];
  const visited = new Set<string>();
  const queue: CrawlQueueItem[] = [{ url: normalizeUrl(startUrl), depth: 0 }];
  let succeeded = 0;
  let failed = 0;
  let pageCount = 0;

  try {
    const page = await createPage(browser);
    await page.setUserAgent(opts.userAgent);

    while (queue.length > 0 && pageCount < opts.maxPages) {
      const item = queue.shift()!;
      const normalizedUrl = normalizeUrl(item.url);

      // Skip if already visited
      if (visited.has(normalizedUrl)) {
        continue;
      }

      // Skip if should be skipped
      if (shouldSkipUrl(normalizedUrl)) {
        log(`    ⊘ Skipping: ${normalizedUrl}`);
        continue;
      }

      visited.add(normalizedUrl);
      pageCount++;

      // Update progress
      if (opts.progress && !opts.json && !opts.stdout) {
        process.stderr.write(`\r  Progress: ${pageCount}/${opts.maxPages} pages, depth ${item.depth}, queue ${queue.length}`);
      }

      // Clip the page
      const result = await clipPage(page, normalizedUrl, item.depth, opts, log);

      if (result.success) {
        succeeded++;
        const filePath = await saveResult(result, opts, log);
        manifest.push({
          url: normalizedUrl,
          title: result.title,
          depth: item.depth,
          status: "success",
          filePath,
        });

        // Add links to queue if we haven't reached max depth
        if (item.depth < opts.depth) {
          const links = result.data?.links || [];
          for (const link of links) {
            const normalizedLink = normalizeUrl(link);

            // Skip if already visited or queued
            if (visited.has(normalizedLink)) continue;

            // Check same-domain policy
            if (!isSameDomain(startUrl, normalizedLink, opts.includeSubdomains)) continue;

            // Skip URLs that should be skipped
            if (shouldSkipUrl(normalizedLink)) continue;

            queue.push({
              url: normalizedLink,
              depth: item.depth + 1,
              parentUrl: normalizedUrl,
            });
          }
        }
      } else {
        failed++;
        manifest.push({
          url: normalizedUrl,
          title: result.title || "Unknown",
          depth: item.depth,
          status: "failed",
          error: result.error,
        });

        if (!opts.continueOnError) {
          log.error(`\n  Stopping due to failure. Use --continue-on-error to continue.`);
          pages.push(result);
          break;
        }
      }

      pages.push(result);

      // Delay between requests
      if (opts.delay > 0 && queue.length > 0) {
        await new Promise((r) => setTimeout(r, opts.delay));
      }
    }

    if (opts.progress && !opts.json && !opts.stdout) {
      process.stderr.write("\n");
    }

    // Calculate max depth reached
    const maxDepthReached = Math.max(...pages.map(p => p.data?.depth || 0), 0);

    return {
      success: true,
      startUrl,
      total: pages.length,
      succeeded,
      failed,
      maxDepth: maxDepthReached,
      pages,
      manifest,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      startUrl,
      total: pages.length,
      succeeded,
      failed,
      maxDepth: 0,
      pages,
      manifest,
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

  if (!opts.url) {
    log.error("No URL provided. Use --url or -u to specify a starting URL.");
    printHelp();
    process.exit(1);
  }

  // Validate URL
  try {
    new URL(opts.url);
  } catch {
    log.error(`Invalid URL: ${opts.url}`);
    process.exit(1);
  }

  log(`\n🕷️  Site Scraper Tool`);
  log(`   Start URL: ${opts.url}`);
  log(`   Max Depth: ${opts.depth}`);
  log(`   Max Pages: ${opts.maxPages}`);
  log(`   Include Subdomains: ${opts.includeSubdomains}`);
  log(`   Delay: ${opts.delay}ms`);
  log(`   Continue on error: ${opts.continueOnError}\n`);

  if (opts.profile) {
    log(`   Using Chrome profile: ${opts.profile}\n`);
  }

  const result = await crawlSite(opts.url, opts, log);

  // Output results
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (opts.stdout) {
    // Output all markdown separated by ---
    for (const page of result.pages) {
      if (page.success && page.markdown) {
        console.log(page.markdown);
        console.log("\n---\n");
      }
    }
  } else {
    log(`\n────────────────────────────────────`);
    log(`✅ Complete: ${result.succeeded}/${result.total} pages clipped`);
    log(`   Max depth reached: ${result.maxDepth}`);
    log(`   Queue remaining: ${result.maxPages - result.total}`);

    if (result.failed > 0) {
      log(`\n❌ Failed: ${result.failed}`);
      for (const m of result.manifest) {
        if (m.status === "failed") {
          log(`   - [D${m.depth}] ${m.url}: ${m.error}`);
        }
      }
    }

    log(`\n📋 Manifest:`);
    for (const m of result.manifest) {
      const icon = m.status === "success" ? "✓" : "✗";
      log(`   ${icon} [D${m.depth}] ${m.title || m.url}`);
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
