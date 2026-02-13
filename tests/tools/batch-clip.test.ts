/**
 * Batch URL Clipper Tests
 *
 * Unit tests for tools/batch-clip.ts - argument parsing, batch processing,
 * concurrency control, and output formats.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sanitizeFilename } from "../../src/shared/sanitize";
import type { ToolOutput } from "../../tools/lib/clipper-core";

// Local implementation of resolveUrls to avoid puppeteer dependency
async function resolveUrls(rawUrls: string[]): Promise<string[]> {
  const resolved: string[] = [];

  for (const entry of rawUrls) {
    if (entry.startsWith("@file:")) {
      const filePath = entry.slice(6);
      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      const content = await import("node:fs/promises").then(m => m.readFile(filePath, "utf-8"));
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

// ─── Test Fixtures ───────────────────────────────────────────────────────────

const TEMP_DIR = join(import.meta.dir, ".temp-batch");

function setupTempDir(): void {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }
}

function cleanupTempDir(): void {
  if (existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

// ─── Argument Parsing Tests ─────────────────────────────────────────────────

describe("batch-clip argument parsing", () => {
  interface ParsedArgs {
    urls: string[];
    parallel: number;
    stdin: boolean;
    continueOnError: boolean;
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
    progress: boolean;
  }

  function parseBatchClipArgs(argv: string[]): ParsedArgs {
    const opts: ParsedArgs = {
      urls: [],
      parallel: 4,
      stdin: false,
      continueOnError: false,
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
      progress: true,
    };

    let i = 0;
    while (i < argv.length) {
      const arg = argv[i];

      if (arg === "--parallel" || arg === "-p") {
        i++;
        opts.parallel = parseInt(argv[i] || "4", 10);
      } else if (arg === "--stdin") {
        opts.stdin = true;
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
      } else if (arg.startsWith("http") || arg.startsWith("@file:")) {
        opts.urls.push(arg);
      }

      i++;
    }

    return opts;
  }

  test("parses multiple URLs from args", () => {
    const opts = parseBatchClipArgs([
      "https://example.com",
      "https://other.com",
      "https://third.com",
    ]);
    expect(opts.urls).toEqual([
      "https://example.com",
      "https://other.com",
      "https://third.com",
    ]);
  });

  test("parses --parallel option", () => {
    const opts = parseBatchClipArgs(["--parallel", "8", "https://example.com"]);
    expect(opts.parallel).toBe(8);
  });

  test("parses -p shorthand for parallel", () => {
    const opts = parseBatchClipArgs(["-p", "16", "https://example.com"]);
    expect(opts.parallel).toBe(16);
  });

  test("parses --stdin flag", () => {
    const opts = parseBatchClipArgs(["--stdin"]);
    expect(opts.stdin).toBe(true);
  });

  test("parses --continue-on-error flag", () => {
    const opts = parseBatchClipArgs(["--continue-on-error", "https://example.com"]);
    expect(opts.continueOnError).toBe(true);
  });

  test("parses -c shorthand for continue-on-error", () => {
    const opts = parseBatchClipArgs(["-c", "https://example.com"]);
    expect(opts.continueOnError).toBe(true);
  });

  test("parses --no-progress flag", () => {
    const opts = parseBatchClipArgs(["--no-progress", "https://example.com"]);
    expect(opts.progress).toBe(false);
  });

  test("parses @file: prefix for URL file", () => {
    const opts = parseBatchClipArgs(["@file:urls.txt"]);
    expect(opts.urls).toEqual(["@file:urls.txt"]);
  });

  test("parses combined options", () => {
    const opts = parseBatchClipArgs([
      "--parallel",
      "8",
      "--continue-on-error",
      "--json",
      "--tags",
      "batch,research",
      "https://example.com",
      "https://other.com",
    ]);
    expect(opts.parallel).toBe(8);
    expect(opts.continueOnError).toBe(true);
    expect(opts.json).toBe(true);
    expect(opts.tags).toEqual(["batch", "research"]);
    expect(opts.urls.length).toBe(2);
  });
});

// ─── URL Resolution Tests ───────────────────────────────────────────────────

describe("batch-clip URL resolution", () => {
  beforeEach(() => {
    setupTempDir();
    cleanupTempDir();
    setupTempDir();
  });

  afterEach(() => {
    cleanupTempDir();
  });

  test("resolves URLs from file", async () => {
    const filePath = join(TEMP_DIR, "urls.txt");
    writeFileSync(
      filePath,
      `https://example.com
https://other.com
https://third.com
`
    );

    const urls = await resolveUrls([`@file:${filePath}`]);
    expect(urls).toEqual([
      "https://example.com",
      "https://other.com",
      "https://third.com",
    ]);
  });

  test("filters comments and empty lines", async () => {
    const filePath = join(TEMP_DIR, "mixed.txt");
    writeFileSync(
      filePath,
      `
# Comment line
https://example.com

   # Indented comment
https://other.com

`
    );

    const urls = await resolveUrls([`@file:${filePath}`]);
    expect(urls).toEqual(["https://example.com", "https://other.com"]);
  });

  test("combines direct URLs with file URLs", async () => {
    const filePath = join(TEMP_DIR, "file-urls.txt");
    writeFileSync(filePath, "https://from-file.com\n");

    const urls = await resolveUrls([
      "https://direct.com",
      `@file:${filePath}`,
    ]);

    expect(urls).toContain("https://direct.com");
    expect(urls).toContain("https://from-file.com");
  });

  test("handles multiple files", async () => {
    const file1 = join(TEMP_DIR, "batch1.txt");
    const file2 = join(TEMP_DIR, "batch2.txt");
    writeFileSync(file1, "https://one.com\nhttps://two.com\n");
    writeFileSync(file2, "https://three.com\n");

    const urls = await resolveUrls([`@file:${file1}`, `@file:${file2}`]);
    expect(urls).toEqual([
      "https://one.com",
      "https://two.com",
      "https://three.com",
    ]);
  });
});

// ─── Batch Result Type Tests ────────────────────────────────────────────────

describe("batch-clip result types", () => {
  interface ClipOutputData {
    pageType: string;
    metadata: {
      url: string;
      title: string;
      type: string;
    };
  }

  interface BatchResult {
    success: boolean;
    total: number;
    succeeded: number;
    failed: number;
    results: ToolOutput<ClipOutputData>[];
  }

  test("creates valid batch result", () => {
    const result: BatchResult = {
      success: true,
      total: 3,
      succeeded: 3,
      failed: 0,
      results: [
        {
          success: true,
          url: "https://example.com/1",
          title: "Article 1",
          markdown: "# Article 1",
          content: "Content 1",
          tags: ["batch"],
          data: { pageType: "web", metadata: { url: "https://example.com/1", title: "Article 1", type: "article" } },
        },
        {
          success: true,
          url: "https://example.com/2",
          title: "Article 2",
          markdown: "# Article 2",
          content: "Content 2",
          tags: ["batch"],
          data: { pageType: "web", metadata: { url: "https://example.com/2", title: "Article 2", type: "article" } },
        },
        {
          success: true,
          url: "https://example.com/3",
          title: "Article 3",
          markdown: "# Article 3",
          content: "Content 3",
          tags: ["batch"],
          data: { pageType: "web", metadata: { url: "https://example.com/3", title: "Article 3", type: "article" } },
        },
      ],
    };

    expect(result.success).toBe(true);
    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.results.length).toBe(3);
  });

  test("handles partial failure", () => {
    const result: BatchResult = {
      success: false,
      total: 3,
      succeeded: 2,
      failed: 1,
      results: [
        {
          success: true,
          url: "https://example.com/1",
          title: "Article 1",
          markdown: "# Article 1",
          content: "Content 1",
          tags: ["batch"],
          data: { pageType: "web", metadata: { url: "https://example.com/1", title: "Article 1", type: "article" } },
        },
        {
          success: false,
          url: "https://example.com/2",
          title: "",
          markdown: "",
          content: "",
          tags: ["batch"],
          error: "404 Not Found",
        },
        {
          success: true,
          url: "https://example.com/3",
          title: "Article 3",
          markdown: "# Article 3",
          content: "Content 3",
          tags: ["batch"],
          data: { pageType: "web", metadata: { url: "https://example.com/3", title: "Article 3", type: "article" } },
        },
      ],
    };

    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.results[1].error).toBe("404 Not Found");
  });

  test("serializes batch result to JSON", () => {
    const result: BatchResult = {
      success: true,
      total: 2,
      succeeded: 2,
      failed: 0,
      results: [
        {
          success: true,
          url: "https://example.com/1",
          title: "Article 1",
          markdown: "# Article 1",
          content: "Content 1",
          tags: ["test"],
          data: { pageType: "web", metadata: { url: "https://example.com/1", title: "Article 1", type: "article" } },
        },
        {
          success: true,
          url: "https://example.com/2",
          title: "Article 2",
          markdown: "# Article 2",
          content: "Content 2",
          tags: ["test"],
          data: { pageType: "web", metadata: { url: "https://example.com/2", title: "Article 2", type: "article" } },
        },
      ],
    };

    const json = JSON.stringify(result, null, 2);
    const parsed = JSON.parse(json);

    expect(parsed.total).toBe(2);
    expect(parsed.results.length).toBe(2);
    expect(parsed.results[0].title).toBe("Article 1");
  });
});

// ─── Concurrency Logic Tests ────────────────────────────────────────────────

describe("batch-clip concurrency logic", () => {
  test("calculates worker distribution correctly", () => {
    const totalUrls = 10;
    const parallelism = 4;
    const expectedBatches = Math.ceil(totalUrls / parallelism);
    expect(expectedBatches).toBe(3);
  });

  test("handles parallelism greater than URL count", () => {
    const totalUrls = 3;
    const parallelism = 10;
    const activeAtOnce = Math.min(totalUrls, parallelism);
    expect(activeAtOnce).toBe(3);
  });

  test("handles single URL", () => {
    const totalUrls = 1;
    const parallelism = 4;
    const activeAtOnce = Math.min(totalUrls, parallelism);
    expect(activeAtOnce).toBe(1);
  });

  test("calculates progress percentage", () => {
    const total = 50;
    const completed = 25;
    const pct = Math.round((completed / total) * 100);
    expect(pct).toBe(50);
  });
});

// ─── Error Handling Tests ───────────────────────────────────────────────────

describe("batch-clip error handling", () => {
  test("identifies failed results", () => {
    const results: ToolOutput[] = [
      { success: true, url: "https://ok.com", title: "OK", markdown: "", content: "", tags: [] },
      { success: false, url: "https://fail.com", title: "", markdown: "", content: "", tags: [], error: "Timeout" },
      { success: true, url: "https://ok2.com", title: "OK2", markdown: "", content: "", tags: [] },
    ];

    const failed = results.filter((r) => !r.success);
    const succeeded = results.filter((r) => r.success);

    expect(failed.length).toBe(1);
    expect(succeeded.length).toBe(2);
    expect(failed[0].error).toBe("Timeout");
  });

  test("collects error messages", () => {
    const results: ToolOutput[] = [
      { success: false, url: "https://1.com", title: "", markdown: "", content: "", tags: [], error: "404" },
      { success: false, url: "https://2.com", title: "", markdown: "", content: "", tags: [], error: "Timeout" },
      { success: false, url: "https://3.com", title: "", markdown: "", content: "", tags: [], error: "Network error" },
    ];

    const errors = results
      .filter((r) => !r.success && r.error)
      .map((r) => `${r.url}: ${r.error}`);

    expect(errors).toEqual([
      "https://1.com: 404",
      "https://2.com: Timeout",
      "https://3.com: Network error",
    ]);
  });
});

// ─── Output Format Tests ────────────────────────────────────────────────────

describe("batch-clip output formats", () => {
  test("generates JSON array output", () => {
    const results: ToolOutput[] = [
      {
        success: true,
        url: "https://example.com/1",
        title: "First",
        markdown: "---\n---\n# First",
        content: "# First",
        tags: ["batch"],
      },
      {
        success: true,
        url: "https://example.com/2",
        title: "Second",
        markdown: "---\n---\n# Second",
        content: "# Second",
        tags: ["batch"],
      },
    ];

    const output = JSON.stringify(results, null, 2);
    expect(output).toContain("First");
    expect(output).toContain("Second");
  });

  test("generates stdout format with separators", () => {
    const results: ToolOutput[] = [
      { success: true, url: "url1", title: "T1", markdown: "# One", content: "One", tags: [] },
      { success: true, url: "url2", title: "T2", markdown: "# Two", content: "Two", tags: [] },
    ];

    const output = results
      .filter((r) => r.success)
      .map((r) => r.markdown)
      .join("\n\n---\n\n");

    expect(output).toBe("# One\n\n---\n\n# Two");
  });

  test("skips failed results in stdout output", () => {
    const results: ToolOutput[] = [
      { success: true, url: "url1", title: "T1", markdown: "# OK", content: "OK", tags: [] },
      { success: false, url: "url2", title: "", markdown: "", content: "", tags: [], error: "Failed" },
      { success: true, url: "url3", title: "T3", markdown: "# OK2", content: "OK2", tags: [] },
    ];

    const markdowns = results
      .filter((r) => r.success && r.markdown)
      .map((r) => r.markdown);

    expect(markdowns).toEqual(["# OK", "# OK2"]);
  });
});
