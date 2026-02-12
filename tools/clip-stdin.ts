#!/usr/bin/env bun
/**
 * Stdin Markdown Clipper
 *
 * Reads markdown from stdin and saves to Obsidian.
 * Designed for piping from other tools in a CLI pipeline.
 *
 * Usage:
 *   # Basic usage with title
 *   echo "# Note" | bun run tools/clip-stdin.ts --title "My Note"
 *
 *   # Save to specific vault/folder
 *   cat note.md | bun run tools/clip-stdin.ts --cli --vault "My Vault" --folder "Notes"
 *
 *   # With tags
 *   echo "# Research" | bun run tools/clip-stdin.ts --tags "research,important"
 *
 *   # Pipe from another tool
 *   pandoc document.docx -t markdown | bun run tools/clip-stdin.ts --title "Converted Doc"
 *
 *   # JSON output for scripting
 *   echo "# Test" | bun run tools/clip-stdin.ts --json --title "Test Note"
 *
 *   # Set explicit source URL
 *   curl -s https://example.com/api/content | bun run tools/clip-stdin.ts --source "https://example.com/api" --title "API Response"
 */

import { resolve } from "node:path";
import { saveViaCli, type CliSaveResult } from "../src/shared/obsidianCliSave";
import { sanitizeFilename } from "../src/shared/sanitize";
import {
  buildFrontmatterYaml,
  type FrontmatterInput
} from "../src/shared/markdown";
import type { ClipContentType } from "../src/shared/types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CLIOptions {
  title: string;
  source: string;
  type: ClipContentType;
  cli: boolean;
  cliPath: string;
  vault: string;
  folder: string;
  tags: string[];
  json: boolean;
  stdout: boolean;
  overwrite: boolean;
  append: boolean;
  author: string;
}

interface ClipOutput {
  success: boolean;
  title: string;
  filePath: string;
  markdown: string;
  error?: string;
}

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[]): CLIOptions {
  const opts: CLIOptions = {
    title: "",
    source: "stdin",
    type: "article",
    cli: false,
    cliPath: "obsidian-cli",
    vault: "Main Vault",
    folder: "",
    tags: [],
    json: false,
    stdout: false,
    overwrite: true,
    append: false,
    author: ""
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--title" || arg === "-t") {
      i++;
      opts.title = argv[i] || "";
    } else if (arg === "--source" || arg === "-s") {
      i++;
      opts.source = argv[i] || "stdin";
    } else if (arg === "--type") {
      i++;
      const typeVal = argv[i] || "article";
      if (["article", "video", "document", "tweet", "post"].includes(typeVal)) {
        opts.type = typeVal as ClipContentType;
      }
    } else if (arg === "--author" || arg === "-a") {
      i++;
      opts.author = argv[i] || "";
    } else if (arg === "--cli") {
      opts.cli = true;
    } else if (arg === "--cli-path") {
      i++;
      opts.cliPath = argv[i] || opts.cliPath;
    } else if (arg === "--vault" || arg === "-v") {
      i++;
      opts.vault = argv[i] || opts.vault;
    } else if (arg === "--folder" || arg === "-f") {
      i++;
      opts.folder = argv[i] || "";
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
    } else if (arg === "--overwrite") {
      opts.overwrite = true;
      opts.append = false;
    } else if (arg === "--append") {
      opts.append = true;
      opts.overwrite = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
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
Stdin Markdown Clipper — Save stdin markdown to Obsidian

USAGE:
  bun run tools/clip-stdin.ts [OPTIONS]

DESCRIPTION:
  Reads markdown content from stdin and saves it to Obsidian.
  Perfect for piping output from other tools.

OPTIONS:
  --title, -t <name>     Note title (required for meaningful filename)
  --source, -s <url>     Source URL for frontmatter (default: "stdin")
  --type <type>          Content type: article, video, document, tweet, post
  --author, -a <name>    Author name for frontmatter
  --cli                  Use Obsidian CLI directly for file creation
  --cli-path <path>      Path to obsidian-cli binary (default: obsidian-cli)
  --vault, -v <name>     Obsidian vault name (default: "Main Vault")
  --folder, -f <path>    Obsidian folder path (default: vault root)
  --tags <a,b,c>         Comma-separated tags
  --json                 Output structured JSON to stdout
  --stdout               Dump processed markdown to stdout (no save)
  --overwrite            Overwrite existing note (default)
  --append               Append to existing note instead of overwrite
  --help, -h             Show this help message

EXAMPLES:
  # Basic pipe
  echo "# Quick Note\\n\\nSome content" | bun run tools/clip-stdin.ts --title "Quick Note"

  # Convert and clip
  pandoc doc.docx -t markdown | bun run tools/clip-stdin.ts --title "Converted Doc" --folder "Imports"

  # Save with tags
  cat research.md | bun run tools/clip-stdin.ts --cli --vault "Research" --tags "paper,ML,2024"

  # Append to existing note
  echo "\\n## Update\\nNew info" | bun run tools/clip-stdin.ts --title "Daily Log" --append

  # Get JSON output for scripting
  echo "# Test" | bun run tools/clip-stdin.ts --json --title "Test"

  # LLM pipeline: save generated content
  some-llm-tool --generate | bun run tools/clip-stdin.ts --cli --title "AI Response"
`);
}

// ─── Logging (stderr when --json/--stdout so stdout stays clean) ─────────────

function log(...args: any[]): void {
  console.error(...args);
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", (chunk) => {
      data += chunk;
    });

    process.stdin.on("end", () => {
      resolve(data);
    });

    process.stdin.on("error", (err) => {
      reject(err);
    });
  });
}

function buildFullMarkdown(content: string, opts: CLIOptions): { markdown: string; title: string } {
  // Extract title from content if not provided
  let title = opts.title;
  if (!title) {
    // Try to extract title from first H1
    const h1Match = content.match(/^#\s+(.+?)(?:\n|$)/m);
    if (h1Match) {
      title = h1Match[1].trim();
    } else {
      title = "Untitled";
    }
  }

  // Build frontmatter
  const frontmatterInput: FrontmatterInput = {
    source: opts.source,
    title: title,
    type: opts.type,
    dateClippedISO: new Date().toISOString(),
    tags: opts.tags,
    author: opts.author || undefined
  };

  const frontmatter = buildFrontmatterYaml(frontmatterInput);

  // Clean content - remove leading whitespace but preserve structure
  const cleanedContent = content.replace(/^\s+/, "");

  // Combine frontmatter with content
  const fullMarkdown = frontmatter + cleanedContent + (cleanedContent.endsWith("\n") ? "" : "\n");

  return { markdown: fullMarkdown, title };
}

async function processAndSave(content: string, opts: CLIOptions): Promise<ClipOutput> {
  const { markdown, title } = buildFullMarkdown(content, opts);

  // Build file path
  const safeTitle = sanitizeFilename(title);
  const filePath = opts.folder ? `${opts.folder}/${safeTitle}` : safeTitle;

  const result: ClipOutput = {
    success: true,
    title,
    filePath,
    markdown
  };

  // --stdout mode: dump markdown to stdout
  if (opts.stdout) {
    return result;
  }

  // --json mode: return structured output (handled in main)
  if (opts.json) {
    return result;
  }

  // --cli mode: use obsidian-cli directly
  if (opts.cli) {
    const saveResult: CliSaveResult = await saveViaCli(
      { cliPath: opts.cliPath, vault: opts.vault, enabled: true },
      { filePath, content: markdown, overwrite: opts.overwrite, append: opts.append }
    );

    if (!saveResult.success) {
      result.success = false;
      result.error = saveResult.error;
    }

    return result;
  }

  // Default: output markdown to stdout
  return result;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  log(`\n📎 Stdin Markdown Clipper`);
  if (opts.title) {
    log(`   Title: ${opts.title}`);
  }
  if (opts.cli) {
    log(`   Vault: ${opts.vault}`);
    log(`   Folder: ${opts.folder || "(root)"}`);
  }
  log();

  // Read content from stdin
  let content: string;
  try {
    content = await readStdin();
  } catch (err: any) {
    console.error(`Failed to read stdin: ${err.message}`);
    process.exit(1);
  }

  if (!content.trim()) {
    console.error("No content provided on stdin");
    process.exit(1);
  }

  // Process and save
  const result = await processAndSave(content, opts);

  // Handle output modes
  if (opts.json) {
    // JSON output to stdout
    console.log(JSON.stringify(result, null, 2));
  } else if (opts.stdout) {
    // Raw markdown to stdout
    console.log(result.markdown);
  } else if (opts.cli) {
    // CLI save result
    if (result.success) {
      log(`  ✅ Saved: ${result.filePath}`);
    } else {
      log(`  ❌ Failed: ${result.error}`);
    }
  } else {
    // Default: output markdown
    console.log(result.markdown);
  }

  // Exit with appropriate code
  if (!result.success) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
