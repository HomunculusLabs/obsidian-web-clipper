#!/usr/bin/env bun
/**
 * ChatGPT Headless Clipper
 *
 * A Puppeteer-based CLI tool to extract ChatGPT conversation responses
 * and save them as Obsidian-compatible markdown files.
 *
 * Usage:
 *   # Single conversation
 *   bun run tools/chatgpt-clipper.ts https://chatgpt.com/c/abc123
 *
 *   # Multiple conversations
 *   bun run tools/chatgpt-clipper.ts https://chatgpt.com/c/abc123 https://chatgpt.com/c/def456
 *
 *   # From a file (one URL per line)
 *   bun run tools/chatgpt-clipper.ts --file urls.txt
 *
 *   # Custom output directory
 *   bun run tools/chatgpt-clipper.ts --outdir ./my-clips https://chatgpt.com/c/abc123
 *
 *   # With Obsidian vault integration (opens obsidian:// URIs)
 *   bun run tools/chatgpt-clipper.ts --obsidian --vault "My Vault" https://chatgpt.com/c/abc123
 *
 *   # Use Obsidian CLI for file creation
 *   bun run tools/chatgpt-clipper.ts --cli --vault "My Vault" https://chatgpt.com/c/abc123
 *
 *   # Use existing Chrome profile (for auth - RECOMMENDED)
 *   bun run tools/chatgpt-clipper.ts --profile /path/to/chrome/profile https://chatgpt.com/c/abc123
 *
 *   # Show the browser (non-headless, useful for debugging/logging in)
 *   bun run tools/chatgpt-clipper.ts --no-headless https://chatgpt.com/c/abc123
 *
 *   # Wait longer for slow connections
 *   bun run tools/chatgpt-clipper.ts --wait 15000 https://chatgpt.com/c/abc123
 *
 * Prerequisites:
 *   bun add puppeteer    (or: npm install puppeteer)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import TurndownService from "turndown";
import { saveViaCli, type CliSaveResult } from "../src/shared/obsidianCliSave";
import { sanitizeFilename } from "../src/shared/sanitize";
import { buildClipMarkdown, type FrontmatterInput } from "../src/shared/markdown";
import {
  launchBrowser,
  createPage,
  resolveUrls,
  createLogger,
  type CommonCLIOptions,
  type Logger,
} from "./lib/clipper-core";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CLIOptions extends CommonCLIOptions {
  urls: string[];
  outdir: string;
  obsidian: boolean;
  perResponse: boolean;
}

interface ExtractedResponse {
  index: number;
  html: string;
  markdown: string;
  preview: string;
}

interface ConversationResult {
  url: string;
  title: string;
  responses: ExtractedResponse[];
  error?: string;
}

// ─── HTML to Markdown Converter (Node.js) ────────────────────────────────────

/**
 * Create a Turndown service configured for ChatGPT content.
 * This is the shared converter used by chatgpt-clipper.ts.
 * The content script uses htmlToMarkdownLite from src/shared/htmlToMarkdown.ts.
 */
function createChatGptTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*"
  });

  // Add strikethrough support
  service.addRule("strikethrough", {
    filter: ["del", "s", "strike"],
    replacement: (content: string) => `~~${content}~~`
  });

  return service;
}

/**
 * Convert HTML to Markdown using Turndown (Node.js context).
 * This is the shared conversion logic - the same conversion is available
 * in browser context via src/shared/htmlToMarkdown.ts.
 */
const turndown = createChatGptTurndown();

function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[], log: Logger): CLIOptions {
  const opts: CLIOptions = {
    urls: [],
    outdir: "./chatgpt-clips",
    obsidian: false,
    cli: false,
    cliPath: "obsidian-cli",
    vault: "Main Vault",
    folder: "2 - Source Material/Clips/ChatGPT",
    profile: null,
    headless: true,
    wait: 8000,
    tags: ["chatgpt", "web-clip"],
    perResponse: true,
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
    } else if (arg === "--outdir" || arg === "-o") {
      i++;
      opts.outdir = argv[i] || opts.outdir;
    } else if (arg === "--obsidian") {
      opts.obsidian = true;
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
    } else if (arg === "--merged") {
      opts.perResponse = false;
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
ChatGPT Headless Clipper — Extract ChatGPT responses to Obsidian markdown

USAGE:
  bun run tools/chatgpt-clipper.ts [OPTIONS] <URL> [<URL> ...]

OPTIONS:
  --file, -f <path>     Read URLs from a text file (one per line)
  --outdir, -o <dir>    Output directory (default: ./chatgpt-clips)
  --obsidian            Open obsidian:// URIs instead of saving files
  --cli                 Use Obsidian CLI directly for file creation
  --cli-path <path>     Path to obsidian-cli binary (default: obsidian-cli from PATH)
  --vault <name>        Obsidian vault name (default: "Main Vault")
  --folder <path>       Obsidian folder path (default: "2 - Source Material/Clips/ChatGPT")
  --profile <path>      Chrome user data dir (for auth cookies)
  --no-headless         Show the browser window
  --wait <ms>           Wait time for page load (default: 8000)
  --tags <a,b,c>        Comma-separated tags (default: "chatgpt,web-clip")
  --merged              Save all responses in one file per conversation
  --json                Output structured JSON to stdout (for LLM tool calls)
  --stdout              Dump raw markdown to stdout (for piping)
  --help, -h            Show this help message

EXAMPLES:
  # Clip a single conversation
  bun run tools/chatgpt-clipper.ts https://chatgpt.com/c/abc123

  # Clip multiple conversations from a file
  bun run tools/chatgpt-clipper.ts --file my-urls.txt --outdir ./clips

  # Use your Chrome profile for auth (find path in chrome://version)
  bun run tools/chatgpt-clipper.ts --profile ~/.config/google-chrome/Default https://chatgpt.com/c/abc123

  # Debug mode: see the browser
  bun run tools/chatgpt-clipper.ts --no-headless https://chatgpt.com/c/abc123

  # Save directly to Obsidian via CLI (recommended for automation)
  bun run tools/chatgpt-clipper.ts --cli --vault "My Vault" --folder "Notes/ChatGPT" https://chatgpt.com/c/abc123

  # Use a specific CLI path
  bun run tools/chatgpt-clipper.ts --cli --cli-path /opt/homebrew/bin/obsidian-cli https://chatgpt.com/c/abc123

  # LLM tool call: get structured JSON back
  bun run tools/chatgpt-clipper.ts --json --profile ~/.config/google-chrome/Default https://chatgpt.com/c/abc123

  # Pipe markdown to another tool
  bun run tools/chatgpt-clipper.ts --stdout https://chatgpt.com/c/abc123 | head -100
`);
}

// ─── Page Extraction ─────────────────────────────────────────────────────────

/**
 * This function runs inside the browser page context to extract all
 * assistant responses as HTML. The HTML→Markdown conversion happens
 * in Node.js context using the shared htmlToMarkdown function (via Turndown).
 */
function extractResponsesInPage(): { title: string; responses: { index: number; html: string; preview: string }[] } {
  const title = document.title.replace(/ \| ChatGPT$/, "").trim() || "ChatGPT Conversation";

  // Find all assistant message containers
  const messageDivs = document.querySelectorAll('[data-message-author-role="assistant"]');
  const responses: { index: number; html: string; preview: string }[] = [];

  messageDivs.forEach((msgDiv, idx) => {
    const contentEl =
      msgDiv.querySelector(".markdown") ||
      msgDiv.querySelector(".prose") ||
      msgDiv;

    const html = (contentEl as HTMLElement).innerHTML;

    // Get preview from first text content
    const text = (contentEl as HTMLElement).textContent || "";
    const firstLine = text.split("\n").find((l) => l.trim().length > 0) || "Response";
    const preview = firstLine.replace(/^#+\s*/, "").trim().slice(0, 80);

    responses.push({ index: idx + 1, html, preview });
  });

  return { title, responses };
}

// ─── Core Extraction Logic ───────────────────────────────────────────────────

async function extractConversation(
  page: import("puppeteer").Page,
  url: string,
  waitMs: number,
  log: Logger
): Promise<ConversationResult> {
  try {
    log(`  → Navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    log(`  → Waiting ${waitMs}ms for content to render...`);
    await new Promise((r) => setTimeout(r, waitMs));

    try {
      await page.waitForSelector('[data-message-author-role="assistant"]', { timeout: 15000 });
    } catch {
      log.warn("No assistant messages found after waiting. Page might require login.");
    }

    await new Promise((r) => setTimeout(r, 2000));

    const result = await page.evaluate(extractResponsesInPage);

    if (result.responses.length === 0) {
      return { url, title: result.title, responses: [], error: "No assistant responses found — you may need to log in (use --profile or --no-headless)" };
    }

    // Convert HTML to Markdown using the shared converter (Turndown-based)
    const responses: ExtractedResponse[] = result.responses.map((r) => ({
      index: r.index,
      html: r.html,
      markdown: htmlToMarkdown(r.html),
      preview: r.preview
    }));

    log(`  ✓ Found ${responses.length} response(s) in "${result.title}"`);
    return { url, title: result.title, responses };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { url, title: "Unknown", responses: [], error: message };
  }
}

// ─── Save Logic ──────────────────────────────────────────────────────────────

/**
 * Helper to create FrontmatterInput for ChatGPT content.
 */
function createChatGptFrontmatter(
  title: string,
  source: string,
  tags: string[],
  extra?: Record<string, string | undefined>
): FrontmatterInput {
  return {
    source,
    title,
    type: "article",
    dateClippedISO: new Date().toISOString(),
    tags,
    extra,
  };
}

async function saveConversation(
  conv: ConversationResult,
  opts: CLIOptions,
  log: Logger
): Promise<void> {
  if (conv.error) {
    log(`  ✗ Error for ${conv.url}: ${conv.error}`);
    return;
  }

  // --stdout mode: dump markdown directly to stdout
  if (opts.stdout) {
    if (!opts.perResponse) {
      // Merged
      console.log(`# ${conv.title}\n`);
      console.log(`> Source: ${conv.url}\n`);
      for (const resp of conv.responses) {
        console.log(`---\n\n## Response ${resp.index}\n\n${resp.markdown}\n`);
      }
    } else {
      for (const resp of conv.responses) {
        console.log(`---\n# ${conv.title} — Response ${resp.index}\n`);
        console.log(`> Source: ${conv.url}\n`);
        console.log(`${resp.markdown}\n`);
      }
    }
    return;
  }

  // --json mode: accumulate results (handled in main)
  if (opts.json) return;

  const outdir = resolve(opts.outdir);
  await mkdir(outdir, { recursive: true });

  if (opts.obsidian) {
    for (const resp of conv.responses) {
      const title = sanitizeFilename(`${conv.title} - Response ${resp.index}`);
      const body = `# ${resp.preview}\n\n${resp.markdown}`;
      const content = buildClipMarkdown(
        createChatGptFrontmatter(title, conv.url, opts.tags, {
          page_type: "chatgpt",
          conversation_title: conv.title,
        }),
        body
      );
      const filePath = opts.folder ? `${opts.folder}/${title}` : title;
      const uri = `obsidian://new?vault=${encodeURIComponent(opts.vault)}&file=${encodeURIComponent(filePath)}&content=${encodeURIComponent(content)}`;

      const { exec } = await import("node:child_process");
      const platform = process.platform;
      const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
      exec(`${cmd} '${uri}'`);

      log(`  📎 Sent to Obsidian: ${title}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    return;
  }

  // --cli mode: use obsidian-cli directly for file creation
  if (opts.cli) {
    for (const resp of conv.responses) {
      const title = sanitizeFilename(`${conv.title} - Response ${resp.index}`);
      const body = `# ${resp.preview}\n\n${resp.markdown}`;
      const content = buildClipMarkdown(
        createChatGptFrontmatter(title, conv.url, opts.tags, {
          page_type: "chatgpt",
          conversation_title: conv.title,
        }),
        body
      );
      const filePath = opts.folder ? `${opts.folder}/${title}` : title;

      const result: CliSaveResult = await saveViaCli(
        { cliPath: opts.cliPath, vault: opts.vault, enabled: true },
        { filePath, content, overwrite: true }
      );

      if (result.success) {
        log(`  📎 Saved via CLI: ${title}`);
      } else {
        log(`  ✗ CLI save failed: ${result.error}`);
        log(`    Command: ${result.command}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return;
  }

  if (!opts.perResponse) {
    const title = sanitizeFilename(conv.title);

    let body = `# ${conv.title}\n\n`;
    for (const resp of conv.responses) {
      body += `---\n\n## Response ${resp.index}\n\n${resp.markdown}\n\n`;
    }

    const content = buildClipMarkdown(
      createChatGptFrontmatter(title, conv.url, opts.tags, {
        page_type: "chatgpt",
        response_count: String(conv.responses.length),
      }),
      body
    );

    const filePath = join(outdir, `${title}.md`);
    await writeFile(filePath, content, "utf-8");
    log(`  💾 Saved: ${filePath}`);
    return;
  }

  for (const resp of conv.responses) {
    const title = sanitizeFilename(
      `${conv.title} - Response ${resp.index} - ${resp.preview}`
    );
    const body = `# ${resp.preview}\n\n${resp.markdown}\n`;
    const content = buildClipMarkdown(
      createChatGptFrontmatter(title, conv.url, opts.tags, {
        page_type: "chatgpt",
        conversation_title: conv.title,
        response_index: String(resp.index),
      }),
      body
    );
    const filePath = join(outdir, `${title}.md`);
    await writeFile(filePath, content, "utf-8");
    log(`  💾 Saved: ${filePath}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const log = createLogger();
  const opts = parseArgs(process.argv.slice(2), log);

  // In --json and --stdout mode, all status goes to stderr so stdout is clean
  log.setQuiet(false);

  const urls = await resolveUrls(opts.urls);

  // Validate URLs
  for (const url of urls) {
    if (!url.includes("chatgpt.com") && !url.includes("chat.openai.com")) {
      log.warn(`URL doesn't look like ChatGPT: ${url}`);
    }
  }

  if (urls.length === 0) {
    log.error("No URLs provided. Use --help for usage info.");
    process.exit(1);
  }

  log(`\n🔖 ChatGPT Headless Clipper`);
  log(`   ${urls.length} conversation(s) to process\n`);

  if (opts.profile) {
    log(`   Using Chrome profile: ${opts.profile}\n`);
  }

  const browser = await launchBrowser({
    headless: opts.headless,
    profile: opts.profile,
  });

  const allResults: ConversationResult[] = [];

  try {
    const page = await createPage(browser);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      log(`\n[${i + 1}/${urls.length}] Processing: ${url}`);

      const result = await extractConversation(page, url, opts.wait, log);
      allResults.push(result);
      await saveConversation(result, opts, log);

      if (result.error) {
        failCount++;
      } else {
        successCount++;
      }

      if (i < urls.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // --json mode: output structured JSON to stdout at the end
    if (opts.json) {
      const output = {
        success: failCount === 0,
        total: urls.length,
        succeeded: successCount,
        failed: failCount,
        conversations: allResults.map((conv) => ({
          url: conv.url,
          title: conv.title,
          error: conv.error || null,
          response_count: conv.responses.length,
          responses: conv.responses.map((r) => ({
            index: r.index,
            preview: r.preview,
            markdown: r.markdown,
          })),
        })),
      };
      console.log(JSON.stringify(output, null, 2));
    }

    log(`\n────────────────────────────────────`);
    log(`✅ Done: ${successCount} succeeded, ${failCount} failed`);
    if (!opts.obsidian && !opts.cli && !opts.json && !opts.stdout) {
      log(`📁 Output: ${resolve(opts.outdir)}`);
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
