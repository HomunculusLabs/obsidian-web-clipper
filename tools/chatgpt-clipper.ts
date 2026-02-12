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

import puppeteer, { type Browser, type Page } from "puppeteer";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { saveViaCli, type CliSaveResult } from "../src/shared/obsidianCliSave";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CLIOptions {
  urls: string[];
  outdir: string;
  obsidian: boolean;
  cli: boolean;         // Use Obsidian CLI directly
  cliPath: string;      // Path to obsidian-cli binary
  vault: string;
  folder: string;
  profile: string | null;
  headless: boolean;
  wait: number;
  tags: string[];
  perResponse: boolean; // true = one file per response, false = one file per conversation
  json: boolean;        // Output structured JSON to stdout (for LLM tool calls)
  stdout: boolean;      // Dump markdown to stdout instead of files
}

interface ExtractedResponse {
  index: number;
  markdown: string;
  preview: string; // first ~80 chars for filename
}

interface ConversationResult {
  url: string;
  title: string;
  responses: ExtractedResponse[];
  error?: string;
}

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[]): CLIOptions {
  const opts: CLIOptions = {
    urls: [],
    outdir: "./chatgpt-clips",
    obsidian: false,
    cli: false,
    cliPath: "obsidian-cli",  // Default to PATH lookup
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
        console.error("--file requires a path argument");
        process.exit(1);
      }
      // Will be loaded later
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

// ─── URL Resolution ──────────────────────────────────────────────────────────

async function resolveUrls(rawUrls: string[]): Promise<string[]> {
  const resolved: string[] = [];

  for (const entry of rawUrls) {
    if (entry.startsWith("@file:")) {
      const filePath = entry.slice(6);
      if (!existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
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

  // Validate URLs
  for (const url of resolved) {
    if (!url.includes("chatgpt.com") && !url.includes("chat.openai.com")) {
      console.warn(`⚠ URL doesn't look like ChatGPT: ${url}`);
    }
  }

  return resolved;
}

// ─── Markdown Helpers ────────────────────────────────────────────────────────

function sanitizeFilename(name: string, maxLen = 100): string {
  return (
    name
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, maxLen)
      .trim() || "Untitled"
  );
}

function buildFrontmatter(opts: {
  title: string;
  source: string;
  tags: string[];
  extra?: Record<string, string | undefined>;
}): string {
  const lines = ["---"];
  lines.push(`source: "${opts.source.replace(/"/g, '\\"')}"`);
  lines.push(`title: "${opts.title.replace(/"/g, '\\"')}"`);
  lines.push(`date_clipped: "${new Date().toISOString()}"`);
  lines.push(`tags:`);
  for (const tag of opts.tags) {
    lines.push(`  - "${tag}"`);
  }
  lines.push(`type: "article"`);
  if (opts.extra) {
    for (const [k, v] of Object.entries(opts.extra)) {
      if (v) lines.push(`${k}: "${v.replace(/"/g, '\\"')}"`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

// ─── Page Extraction ─────────────────────────────────────────────────────────

/**
 * This function runs inside the browser page context to extract all
 * assistant responses and convert them to markdown.
 */
function extractResponsesInPage(): { title: string; responses: { index: number; markdown: string; preview: string }[] } {
  const title = document.title.replace(/ \| ChatGPT$/, "").trim() || "ChatGPT Conversation";

  // Find all assistant message containers
  const messageDivs = document.querySelectorAll('[data-message-author-role="assistant"]');
  const responses: { index: number; markdown: string; preview: string }[] = [];

  messageDivs.forEach((msgDiv, idx) => {
    const contentEl =
      msgDiv.querySelector(".markdown") ||
      msgDiv.querySelector(".prose") ||
      msgDiv;

    const html = (contentEl as HTMLElement).innerHTML;

    // Lightweight HTML→Markdown conversion (runs in browser context)
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

    body.querySelectorAll("code").forEach((el) => {
      el.textContent = `\`${el.textContent}\``;
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
      el.textContent = `[${el.textContent}](${href})`;
    });

    body.querySelectorAll("ul").forEach((ul) => {
      const items = ul.querySelectorAll(":scope > li");
      let text = "\n";
      items.forEach((li) => { text += `- ${li.textContent?.trim()}\n`; });
      text += "\n";
      const ph = document.createElement("p");
      ph.textContent = text;
      ul.replaceWith(ph);
    });

    body.querySelectorAll("ol").forEach((ol) => {
      const items = ol.querySelectorAll(":scope > li");
      let text = "\n";
      items.forEach((li, i) => { text += `${i + 1}. ${li.textContent?.trim()}\n`; });
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
        cells.forEach((cell) => cellTexts.push((cell.textContent || "").trim()));
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

    let text = body.textContent || "";
    text = text.replace(/\n{3,}/g, "\n\n").trim();

    const firstLine = text.split("\n").find((l) => l.trim().length > 0) || "Response";
    const preview = firstLine.replace(/^#+\s*/, "").trim().slice(0, 80);

    responses.push({ index: idx + 1, markdown: text, preview });
  });

  return { title, responses };
}

// ─── Logging (stderr when --json/--stdout so stdout stays clean) ─────────────

let _quiet = false;
function log(...args: any[]): void {
  if (!_quiet) console.error(...args);
}

// ─── Core Extraction Logic ───────────────────────────────────────────────────

async function extractConversation(
  page: Page,
  url: string,
  waitMs: number
): Promise<ConversationResult> {
  try {
    log(`  → Navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    log(`  → Waiting ${waitMs}ms for content to render...`);
    await new Promise((r) => setTimeout(r, waitMs));

    try {
      await page.waitForSelector('[data-message-author-role="assistant"]', { timeout: 15000 });
    } catch {
      log("  ⚠ No assistant messages found after waiting. Page might require login.");
    }

    await new Promise((r) => setTimeout(r, 2000));

    const result = await page.evaluate(extractResponsesInPage);

    if (result.responses.length === 0) {
      return { url, title: result.title, responses: [], error: "No assistant responses found — you may need to log in (use --profile or --no-headless)" };
    }

    log(`  ✓ Found ${result.responses.length} response(s) in "${result.title}"`);
    return { url, title: result.title, responses: result.responses };
  } catch (err: any) {
    return { url, title: "Unknown", responses: [], error: err.message || String(err) };
  }
}

// ─── Save Logic ──────────────────────────────────────────────────────────────

async function saveConversation(
  conv: ConversationResult,
  opts: CLIOptions
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
      const fm = buildFrontmatter({
        title,
        source: conv.url,
        tags: opts.tags,
        extra: { page_type: "chatgpt", conversation_title: conv.title },
      });
      const content = fm + body + "\n";
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
      const fm = buildFrontmatter({
        title,
        source: conv.url,
        tags: opts.tags,
        extra: { page_type: "chatgpt", conversation_title: conv.title },
      });
      const content = fm + body + "\n";
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
    const fm = buildFrontmatter({
      title,
      source: conv.url,
      tags: opts.tags,
      extra: {
        page_type: "chatgpt",
        response_count: String(conv.responses.length),
      },
    });

    let body = `# ${conv.title}\n\n`;
    for (const resp of conv.responses) {
      body += `---\n\n## Response ${resp.index}\n\n${resp.markdown}\n\n`;
    }

    const filePath = join(outdir, `${title}.md`);
    await writeFile(filePath, fm + body, "utf-8");
    log(`  💾 Saved: ${filePath}`);
    return;
  }

  for (const resp of conv.responses) {
    const title = sanitizeFilename(
      `${conv.title} - Response ${resp.index} - ${resp.preview}`
    );
    const fm = buildFrontmatter({
      title,
      source: conv.url,
      tags: opts.tags,
      extra: {
        page_type: "chatgpt",
        conversation_title: conv.title,
        response_index: String(resp.index),
      },
    });

    const body = `# ${resp.preview}\n\n${resp.markdown}\n`;
    const filePath = join(outdir, `${title}.md`);
    await writeFile(filePath, fm + body, "utf-8");
    log(`  💾 Saved: ${filePath}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const urls = await resolveUrls(opts.urls);

  if (urls.length === 0) {
    console.error("No URLs provided. Use --help for usage info.");
    process.exit(1);
  }

  // In --json and --stdout mode, all status goes to stderr so stdout is clean
  _quiet = false; // always log to stderr
  if (opts.json || opts.stdout) {
    // log() already uses console.error, so stdout stays clean
  }

  log(`\n🔖 ChatGPT Headless Clipper`);
  log(`   ${urls.length} conversation(s) to process\n`);

  const launchOpts: Parameters<typeof puppeteer.launch>[0] = {
    headless: opts.headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };

  if (opts.profile) {
    launchOpts.userDataDir = resolve(opts.profile);
    log(`   Using Chrome profile: ${opts.profile}\n`);
  }

  const browser: Browser = await puppeteer.launch(launchOpts);
  const allResults: ConversationResult[] = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      log(`\n[${i + 1}/${urls.length}] Processing: ${url}`);

      const result = await extractConversation(page, url, opts.wait);
      allResults.push(result);
      await saveConversation(result, opts);

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
