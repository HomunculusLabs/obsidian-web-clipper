/**
 * Core Clipper Library
 *
 * Shared utilities for Puppeteer-based CLI clipping tools.
 * Extracts common browser launch, page setup, logging, and utility functions.
 *
 * Usage:
 *   import { launchBrowser, resolveUrls, htmlToMarkdown, createLogger } from './lib/clipper-core';
 */

import puppeteer, { type Browser, type Page } from "puppeteer";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Common CLI options shared across all clipping tools
 */
export interface CommonCLIOptions {
  /** Use Obsidian CLI directly for file creation */
  cli: boolean;
  /** Path to obsidian-cli binary */
  cliPath: string;
  /** Obsidian vault name */
  vault: string;
  /** Obsidian folder path */
  folder: string;
  /** Chrome user data dir (for auth cookies) */
  profile: string | null;
  /** Run in headless mode */
  headless: boolean;
  /** Wait time for page load in ms */
  wait: number;
  /** Tags to add to frontmatter */
  tags: string[];
  /** Output structured JSON to stdout */
  json: boolean;
  /** Dump raw markdown to stdout */
  stdout: boolean;
}

/**
 * Default CLI option values
 */
export const DEFAULT_CLI_OPTIONS: Omit<CommonCLIOptions, 'urls' | 'url'> = {
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
};

/**
 * Standardized tool output format for LLM agent integration
 */
export interface ToolOutput<T = unknown> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Source URL that was processed */
  url: string;
  /** Extracted or generated title */
  title: string;
  /** Full markdown content with frontmatter */
  markdown: string;
  /** Content without frontmatter */
  content: string;
  /** Extracted metadata */
  metadata: Record<string, unknown>;
  /** Error message if not successful */
  error?: string;
  /** Tool-specific additional data */
  data?: T;
}

/**
 * Browser launch options
 */
export interface BrowserLaunchOptions {
  /** Run in headless mode */
  headless: boolean;
  /** Chrome user data directory for auth */
  profile: string | null;
  /** Additional puppeteer launch args */
  extraArgs?: string[];
}

/**
 * Logger with quiet mode support
 */
export interface Logger {
  (...args: unknown[]): void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  setQuiet: (quiet: boolean) => void;
}

// ─── Logging ────────────────────────────────────────────────────────────────

/**
 * Create a logger that writes to stderr when quiet mode is off.
 * In --json/--stdout mode, stdout must stay clean for piped output.
 */
export function createLogger(prefix = ""): Logger {
  let _quiet = false;

  const log = (...args: unknown[]): void => {
    if (_quiet) return;
    const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    console.error(prefix ? `${prefix} ${message}` : message);
  };

  log.error = (...args: unknown[]): void => {
    const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    console.error(prefix ? `${prefix} ${message}` : message);
  };

  log.warn = (...args: unknown[]): void => {
    if (_quiet) return;
    const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    console.error(`⚠️ ${prefix ? `${prefix} ` : ''}${message}`);
  };

  log.setQuiet = (quiet: boolean): void => {
    _quiet = quiet;
  };

  return log;
}

// ─── URL Resolution ──────────────────────────────────────────────────────────

/**
 * Resolve URLs that may include @file: prefixes.
 * Reads URLs from a file (one per line) when prefixed with @file:
 */
export async function resolveUrls(rawUrls: string[]): Promise<string[]> {
  const resolved: string[] = [];

  for (const entry of rawUrls) {
    if (entry.startsWith("@file:")) {
      const filePath = entry.slice(6);
      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      const content = await readFile(filePath, "utf-8");
      const lines = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#"));
      resolved.push(...lines);
    } else {
      resolved.push(entry);
    }
  }

  return resolved;
}

// ─── Browser Launch ──────────────────────────────────────────────────────────

/**
 * Launch a Puppeteer browser with common configuration.
 */
export async function launchBrowser(options: BrowserLaunchOptions): Promise<Browser> {
  const launchOpts: Parameters<typeof puppeteer.launch>[0] = {
    headless: options.headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      ...(options.extraArgs || []),
    ],
  };

  if (options.profile) {
    launchOpts.userDataDir = resolve(options.profile);
  }

  return puppeteer.launch(launchOpts);
}

/**
 * Create a new page with standard viewport and user agent.
 */
export async function createPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  return page;
}

/**
 * Navigate to a URL and wait for content to load.
 */
export async function navigateAndWait(
  page: Page,
  url: string,
  waitMs: number,
  selector?: string
): Promise<void> {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  await new Promise((r) => setTimeout(r, waitMs));

  if (selector) {
    try {
      await page.waitForSelector(selector, { timeout: 15000 });
    } catch {
      // Selector not found, continue anyway
    }
  }

  // Additional settling time
  await new Promise((r) => setTimeout(r, 1000));
}

// ─── HTML to Markdown Conversion ─────────────────────────────────────────────

/**
 * Convert HTML to markdown (lightweight, runs in browser context).
 * This function is serialized and executed in the page context.
 */
export function htmlToMarkdown(html: string): string {
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
 * Get the htmlToMarkdown function as a string for page.evaluate()
 */
export function getHtmlToMarkdownFn(): string {
  return htmlToMarkdown.toString();
}

// ─── Web Content Extraction ──────────────────────────────────────────────────

/**
 * Extract web page content using DOM APIs.
 * This function runs in browser context.
 */
export function extractWebContentInPage(): {
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

  // Try to find main content
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

/**
 * Get the extractWebContentInPage function as a string for page.evaluate()
 */
export function getExtractWebContentFn(): string {
  return extractWebContentInPage.toString();
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Format a number for display (e.g., 1234 -> "1.2K")
 */
export function formatNumber(num: number): string {
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
 * Parse engagement count from aria-label strings like "123 replies", "1.2K Likes"
 */
export function parseEngagementCount(ariaLabel: string): number {
  if (!ariaLabel) return 0;

  const match = ariaLabel.match(/[\d,.]+[KkMmBb]?/);
  if (!match) return 0;

  let numStr = match[0].replace(/,/g, "");

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
 * Common help text for CLI options (to include in tool help messages)
 */
export const COMMON_HELP_TEXT = `
COMMON OPTIONS:
  --cli                 Use Obsidian CLI directly for file creation
  --cli-path <path>     Path to obsidian-cli binary (default: obsidian-cli from PATH)
  --vault <name>        Obsidian vault name (default: "Main Vault")
  --folder <path>       Obsidian folder path (default varies by tool)
  --profile <path>      Chrome user data dir (for auth cookies)
  --no-headless         Show the browser window
  --wait <ms>           Wait time for page load (default: 5000)
  --tags <a,b,c>        Comma-separated tags (default: "web-clip")
  --json                Output structured JSON to stdout (for LLM tool calls)
  --stdout              Dump raw markdown to stdout (for piping)
`;
