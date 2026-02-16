#!/usr/bin/env bun
/**
 * PDF Extraction CLI
 *
 * Extract text from PDF URLs or local files.
 * Part of the Agentic CLI Tools suite for LLM agent integration.
 *
 * Usage:
 *   # Extract text from a PDF URL
 *   bun run tools/pdf-clip.ts https://example.com/document.pdf
 *
 *   # Extract from local file
 *   bun run tools/pdf-clip.ts ./document.pdf
 *
 *   # Output as JSON (for LLM tool calls)
 *   bun run tools/pdf-clip.ts --json https://example.com/document.pdf
 *
 *   # Dump text to stdout (plain text)
 *   bun run tools/pdf-clip.ts --stdout https://example.com/document.pdf
 *
 *   # Extract specific pages
 *   bun run tools/pdf-clip.ts --pages 1-5 https://example.com/document.pdf
 *   bun run tools/pdf-clip.ts --pages 1,3,5-7 https://example.com/document.pdf
 *
 *   # Save directly to Obsidian via CLI
 *   bun run tools/pdf-clip.ts --cli --vault "My Vault" --folder "Notes/PDFs" ./document.pdf
 */

import { resolve } from "node:path";
import * as pdfjs from "pdfjs-dist";
import { sanitizeFilename } from "../src/shared/sanitize";
import { buildFrontmatterYaml, type FrontmatterInput } from "../src/shared/markdown";
import { saveViaCli, type CliSaveResult } from "../src/shared/obsidianCliSave";
import { createLogger, type CommonCLIOptions, type Logger, type ToolOutput } from "./lib/clipper-core";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Common CLI options shared across all clipping tools
 */
interface CLIOptions extends CommonCLIOptions {
  source: string;
  pages: string | null;
  maxPages: number;
  maxChars: number;
  metadata: boolean;
}

interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  creator: string;
  producer: string;
  creationDate: string | null;
  modifiedDate: string | null;
  pageCount: number;
}

interface PdfExtractResult {
  text: string;
  pageCount: number;
  extractedPages: number[];
  truncated: boolean;
  hasTextLayer: boolean;
}

interface PdfOutputData {
  metadata: PdfMetadata;
  extraction: {
    pageCount: number;
    extractedPages: number[];
    truncated: boolean;
    hasTextLayer: boolean;
  };
}

type PdfOutput = ToolOutput<PdfOutputData>;

// ─── PDF.js Setup ────────────────────────────────────────────────────────────

// Note: pdfjs-dist has compatibility issues with Bun's runtime.
// We use a Node.js subprocess to handle PDF extraction.
// The worker script is at tools/pdf-extract-worker.js

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __pdfDirname = dirname(fileURLToPath(import.meta.url));
const workerPath = resolve(__pdfDirname, "pdf-extract-worker.js");

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[], log: Logger): CLIOptions {
  const opts: CLIOptions = {
    source: "",
    cli: false,
    cliPath: "obsidian-cli",
    vault: "Main Vault",
    folder: "Clips/PDFs",
    profile: null,
    headless: true,
    wait: 5000,
    tags: ["pdf"],
    json: false,
    stdout: false,
    pages: null,
    maxPages: 200,
    maxChars: 120000,
    metadata: true,
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
    } else if (arg === "--pages") {
      i++;
      opts.pages = argv[i] || null;
    } else if (arg === "--max-pages") {
      i++;
      opts.maxPages = parseInt(argv[i] || "200", 10);
    } else if (arg === "--max-chars") {
      i++;
      opts.maxChars = parseInt(argv[i] || "120000", 10);
    } else if (arg === "--no-metadata") {
      opts.metadata = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("http") || arg.endsWith(".pdf") || arg.startsWith("/") || arg.startsWith("./") || arg.startsWith("~")) {
      opts.source = arg;
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
PDF Extraction CLI — Extract text from PDF URLs or local files

USAGE:
  bun run tools/pdf-clip.ts [OPTIONS] <PDF_URL_OR_FILE>

OPTIONS:
  --json                Output structured JSON to stdout (for LLM tool calls)
  --stdout              Dump raw text to stdout (for piping)
  --pages <spec>        Pages to extract: "1-5" or "1,3,5-7" (default: all)
  --max-pages <n>       Maximum pages to extract (default: 200)
  --max-chars <n>       Maximum characters to extract (default: 120000)
  --no-metadata         Exclude PDF metadata from output
  --cli                 Use Obsidian CLI directly for file creation
  --cli-path <path>     Path to obsidian-cli binary (default: obsidian-cli)
  --vault <name>        Obsidian vault name (default: "Main Vault")
  --folder <path>       Obsidian folder path (default: "Clips/PDFs")
  --tags <a,b,c>        Comma-separated tags (default: "pdf")
  --help, -h            Show this help message

EXAMPLES:
  # Extract from a PDF URL
  bun run tools/pdf-clip.ts https://example.com/paper.pdf

  # Extract from a local file
  bun run tools/pdf-clip.ts ./document.pdf

  # LLM tool call: get structured JSON back
  bun run tools/pdf-clip.ts --json https://arxiv.org/pdf/2301.12345.pdf

  # Extract specific pages only
  bun run tools/pdf-clip.ts --pages 1-5 ./document.pdf
  bun run tools/pdf-clip.ts --pages 1,3,5-7 ./document.pdf

  # Save directly to Obsidian via CLI
  bun run tools/pdf-clip.ts --cli --vault "My Vault" ./document.pdf

  # Pipe text to another tool
  bun run tools/pdf-clip.ts --stdout ./document.pdf | head -50

OUTPUT FORMAT (--json):
  {
    "success": true,
    "url": "file:///path/to/document.pdf",
    "title": "Document Title",
    "markdown": "...",
    "content": "...",
    "metadata": {
      "title": "...",
      "author": "...",
      "pageCount": 10,
      ...
    },
    "data": {
      "metadata": {...},
      "extraction": {
        "pageCount": 10,
        "extractedPages": [1, 2, 3],
        "truncated": false,
        "hasTextLayer": true
      }
    }
  }
`);
}

// ─── PDF Extraction via Node.js Worker ────────────────────────────────────────

/**
 * Extract PDF content by spawning a Node.js subprocess.
 * This is necessary because pdfjs-dist has compatibility issues with Bun.
 */
async function extractPdf(
  source: string,
  pageRange: string | null,
  maxPages: number,
  maxChars: number,
  log: Logger
): Promise<{ result: PdfExtractResult; metadata: PdfMetadata; isUrl: boolean }> {
  log(`  → Extracting PDF: ${source}`);

  return new Promise((resolve, reject) => {
    const input = JSON.stringify({
      source,
      pageRange,
      maxPages,
      maxChars,
    });

    const child = spawn("node", [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data;
    });

    child.stderr.on("data", (data) => {
      stderr += data;
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`PDF extraction failed: ${stderr || `Exit code ${code}`}`));
        return;
      }

      try {
        const response = JSON.parse(stdout);

        if (!response.success) {
          reject(new Error(response.error || "PDF extraction failed"));
          return;
        }

        log(`  → Extracted ${response.result.extractedPages.length} pages, ${response.result.text.length.toLocaleString()} characters`);

        if (!response.result.hasTextLayer) {
          log(`  ⚠ No text layer found (PDF may be scanned/image-based)`);
        }
        if (response.result.truncated) {
          log(`  ⚠ Output truncated at ${maxChars.toLocaleString()} characters`);
        }

        resolve({
          result: response.result,
          metadata: response.metadata,
          isUrl: response.isUrl,
        });
      } catch (err) {
        reject(new Error(`Failed to parse PDF extraction result: ${err}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn PDF extraction worker: ${err.message}`));
    });

    // Send input to the worker
    child.stdin.write(input);
    child.stdin.end();
  });
}
// ─── Output Formatting ───────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  // PDF dates are like "D:20231015T120000Z"
  const match = dateStr.match(/D:(\d{4})(\d{2})(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return dateStr;
}

function buildMarkdown(result: PdfExtractResult, metadata: PdfMetadata, includeMetadata: boolean): string {
  let md = "";

  // Title
  md += `# ${metadata.title || "PDF Document"}\n\n`;

  // Metadata section
  if (includeMetadata) {
    md += `## Metadata\n\n`;
    if (metadata.author) md += `**Author:** ${metadata.author}\n`;
    if (metadata.subject) md += `**Subject:** ${metadata.subject}\n`;
    if (metadata.creator) md += `**Creator:** ${metadata.creator}\n`;
    if (metadata.producer) md += `**Producer:** ${metadata.producer}\n`;
    if (metadata.creationDate) md += `**Created:** ${formatDate(metadata.creationDate)}\n`;
    if (metadata.modifiedDate) md += `**Modified:** ${formatDate(metadata.modifiedDate)}\n`;
    md += `**Pages:** ${metadata.pageCount}\n`;
    if (result.extractedPages.length < metadata.pageCount) {
      md += `**Extracted Pages:** ${result.extractedPages.join(", ")}\n`;
    }
    md += "\n";

    // Warnings
    if (!result.hasTextLayer) {
      md += `> ⚠️ **No selectable text found.** This PDF may be scanned or image-based. Consider using OCR for better extraction.\n\n`;
    }
    if (result.truncated) {
      md += `> ⚠️ **Output truncated.** Use --max-chars to extract more content.\n\n`;
    }

    md += "---\n\n";
  }

  // Content
  md += `## Content\n\n`;
  md += result.text;
  md += "\n";

  return md;
}

function buildFullMarkdown(result: PdfExtractResult, metadata: PdfMetadata, opts: CLIOptions, source: string): string {
  const frontmatterInput: FrontmatterInput = {
    source: source,
    title: metadata.title || "Untitled",
    type: "document",
    dateClippedISO: new Date().toISOString(),
    tags: opts.tags,
    author: metadata.author,
    extra: {
      pdf_page_count: metadata.pageCount,
      pdf_extracted_pages: result.extractedPages.map(String),  // Convert to strings
      pdf_has_text_layer: result.hasTextLayer,
      pdf_truncated: result.truncated,
      pdf_creator: metadata.creator,
      pdf_producer: metadata.producer,
    },
  };

  const frontmatter = buildFrontmatterYaml(frontmatterInput);
  const bodyMarkdown = buildMarkdown(result, metadata, opts.metadata);
  return frontmatter + bodyMarkdown + (bodyMarkdown.endsWith("\n") ? "" : "\n");
}

// ─── Save Logic ──────────────────────────────────────────────────────────────

async function saveResult(
  result: PdfExtractResult,
  metadata: PdfMetadata,
  source: string,
  opts: CLIOptions,
  log: Logger
): Promise<void> {
  const fullMarkdown = buildFullMarkdown(result, metadata, opts, source);

  // --stdout mode: dump text directly to stdout
  if (opts.stdout) {
    console.log(result.text);
    return;
  }

  // --json mode: handled in main
  if (opts.json) {
    return;
  }

  // --cli mode: use obsidian-cli directly
  if (opts.cli) {
    const title = sanitizeFilename(metadata.title || "Untitled");
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

  // Enable quiet mode for JSON/stdout output
  if (opts.json || opts.stdout) {
    log.setQuiet(true);
  }

  if (!opts.source) {
    log.error("No PDF source provided. Use --help for usage info.");
    process.exit(1);
  }

  const isUrl = opts.source.startsWith("http://") || opts.source.startsWith("https://");
  const displaySource = isUrl ? opts.source : resolve(opts.source);

  log(`\n📄 PDF Extraction CLI`);
  log(`   Source: ${displaySource}\n`);

  try {
    const { result, metadata } = await extractPdf(
      opts.source,
      opts.pages,
      opts.maxPages,
      opts.maxChars,
      log
    );

    // Build output
    const output: PdfOutput = {
      success: result.hasTextLayer,
      url: isUrl ? opts.source : `file://${displaySource}`,
      title: metadata.title || "Untitled",
      markdown: buildFullMarkdown(result, metadata, opts, displaySource),
      content: result.text,
      tags: opts.tags,
      error: result.hasTextLayer ? undefined : "No text layer found. PDF may be scanned/image-based.",
      data: {
        metadata,
        extraction: {
          pageCount: result.pageCount,
          extractedPages: result.extractedPages,
          truncated: result.truncated,
          hasTextLayer: result.hasTextLayer,
        },
      },
    };

    // --json mode
    if (opts.json) {
      console.log(JSON.stringify(output, null, 2));
    } else if (opts.stdout) {
      console.log(result.text);
    } else {
      await saveResult(result, metadata, displaySource, opts, log);
    }

    if (!opts.json && !opts.stdout) {
      if (result.hasTextLayer) {
        log(`\n────────────────────────────────────`);
        log(`✅ Done — ${result.extractedPages.length} pages extracted`);
      } else {
        log(`\n────────────────────────────────────`);
        log(`⚠️ No text layer found`);
      }
      log();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (opts.json) {
      const output: PdfOutput = {
        success: false,
        url: isUrl ? opts.source : `file://${displaySource}`,
        title: "",
        markdown: "",
        content: "",
        tags: opts.tags,
        error: message,
        data: {
          metadata: {
            title: "",
            author: "",
            subject: "",
            creator: "",
            producer: "",
            creationDate: null,
            modifiedDate: null,
            pageCount: 0,
          },
          extraction: {
            pageCount: 0,
            extractedPages: [],
            truncated: false,
            hasTextLayer: false,
          },
        },
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      log.error(`\n✗ Error: ${message}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
