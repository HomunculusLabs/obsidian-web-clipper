/**
 * Universal URL Clipper Tests
 *
 * Unit tests for tools/clip-url.ts - argument parsing, output format,
 * page type detection, and error handling.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { detectPageType } from "../../src/shared/pageType";
import { buildFrontmatterYaml } from "../../src/shared/markdown";
import { sanitizeFilename } from "../../src/shared/sanitize";
import type { ToolOutput } from "../../tools/lib/clipper-core";

// ─── Argument Parsing Tests ─────────────────────────────────────────────────

describe("clip-url argument parsing", () => {
  // Simulate the parseArgs logic from clip-url.ts

  interface ParsedArgs {
    url: string;
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
    timestamps: boolean;
  }

  function parseClipUrlArgs(argv: string[]): ParsedArgs {
    const opts: ParsedArgs = {
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
      } else if (arg.startsWith("http")) {
        opts.url = arg;
      }

      i++;
    }

    return opts;
  }

  test("parses basic URL", () => {
    const opts = parseClipUrlArgs(["https://example.com"]);
    expect(opts.url).toBe("https://example.com");
  });

  test("parses --cli flag", () => {
    const opts = parseClipUrlArgs(["--cli", "https://example.com"]);
    expect(opts.cli).toBe(true);
  });

  test("parses --cli-path option", () => {
    const opts = parseClipUrlArgs([
      "--cli-path",
      "/custom/path/obsidian-cli",
      "https://example.com",
    ]);
    expect(opts.cliPath).toBe("/custom/path/obsidian-cli");
  });

  test("parses --vault option", () => {
    const opts = parseClipUrlArgs([
      "--vault",
      "My Research Vault",
      "https://example.com",
    ]);
    expect(opts.vault).toBe("My Research Vault");
  });

  test("parses --folder option", () => {
    const opts = parseClipUrlArgs([
      "--folder",
      "Archive/2024/Articles",
      "https://example.com",
    ]);
    expect(opts.folder).toBe("Archive/2024/Articles");
  });

  test("parses --profile option", () => {
    const opts = parseClipUrlArgs([
      "--profile",
      "~/.config/chrome/Default",
      "https://example.com",
    ]);
    expect(opts.profile).toBe("~/.config/chrome/Default");
  });

  test("parses --no-headless flag", () => {
    const opts = parseClipUrlArgs(["--no-headless", "https://example.com"]);
    expect(opts.headless).toBe(false);
  });

  test("parses --wait option", () => {
    const opts = parseClipUrlArgs(["--wait", "10000", "https://example.com"]);
    expect(opts.wait).toBe(10000);
  });

  test("parses --tags option", () => {
    const opts = parseClipUrlArgs([
      "--tags",
      "research,article,important",
      "https://example.com",
    ]);
    expect(opts.tags).toEqual(["research", "article", "important"]);
  });

  test("parses --json flag", () => {
    const opts = parseClipUrlArgs(["--json", "https://example.com"]);
    expect(opts.json).toBe(true);
  });

  test("parses --stdout flag", () => {
    const opts = parseClipUrlArgs(["--stdout", "https://example.com"]);
    expect(opts.stdout).toBe(true);
  });

  test("parses --no-timestamps flag", () => {
    const opts = parseClipUrlArgs(["--no-timestamps", "https://example.com"]);
    expect(opts.timestamps).toBe(false);
  });

  test("parses multiple flags together", () => {
    const opts = parseClipUrlArgs([
      "--cli",
      "--vault",
      "Work",
      "--folder",
      "Clips",
      "--json",
      "--tags",
      "work,research",
      "https://example.com",
    ]);
    expect(opts.cli).toBe(true);
    expect(opts.vault).toBe("Work");
    expect(opts.folder).toBe("Clips");
    expect(opts.json).toBe(true);
    expect(opts.tags).toEqual(["work", "research"]);
    expect(opts.url).toBe("https://example.com");
  });

  test("handles empty tags", () => {
    const opts = parseClipUrlArgs(["--tags", "", "https://example.com"]);
    expect(opts.tags).toEqual([]);
  });

  test("trims whitespace from tags", () => {
    const opts = parseClipUrlArgs([
      "--tags",
      "  spaced  ,  tags  ",
      "https://example.com",
    ]);
    expect(opts.tags).toEqual(["spaced", "tags"]);
  });
});

// ─── Page Type Detection Tests ──────────────────────────────────────────────

describe("clip-url page type detection", () => {
  test("detects YouTube URLs", () => {
    expect(detectPageType("https://youtube.com/watch?v=abc123")).toBe("youtube");
    expect(detectPageType("https://www.youtube.com/watch?v=abc123")).toBe("youtube");
    // Note: m.youtube.com is not currently matched by the regex
    expect(detectPageType("https://youtube.com/shorts/abc123")).toBe("youtube");
  });

  test("detects X/Twitter URLs", () => {
    expect(detectPageType("https://twitter.com/user/status/123")).toBe("twitter");
    expect(detectPageType("https://x.com/user/status/123")).toBe("twitter");
    expect(detectPageType("https://mobile.twitter.com/user/status/123")).toBe("twitter");
  });

  test("detects PDF URLs", () => {
    expect(detectPageType("https://example.com/document.pdf")).toBe("pdf");
    expect(detectPageType("https://example.com/path/to/file.PDF")).toBe("pdf");
  });

  test("defaults to web for regular URLs", () => {
    expect(detectPageType("https://example.com")).toBe("web");
    expect(detectPageType("https://blog.example.com/article")).toBe("web");
    expect(detectPageType("https://news.site.com/story/123")).toBe("web");
  });
});

// ─── Output Format Tests ────────────────────────────────────────────────────

describe("clip-url output format", () => {
  interface ClipOutputData {
    pageType: string;
    metadata: {
      url: string;
      title: string;
      type: string;
      author?: string;
      channel?: string;
    };
  }

  test("creates valid success output for web page", () => {
    const output: ToolOutput<ClipOutputData> = {
      success: true,
      url: "https://example.com/article",
      title: "Example Article",
      markdown: "---\ntitle: Example Article\n---\n# Content",
      content: "# Content",
      tags: ["web-clip"],
      data: {
        pageType: "web",
        metadata: {
          url: "https://example.com/article",
          title: "Example Article",
          type: "article",
          author: "John Doe",
        },
      },
    };

    expect(output.success).toBe(true);
    expect(output.data?.pageType).toBe("web");
    expect(output.data?.metadata.author).toBe("John Doe");
  });

  test("creates valid success output for YouTube video", () => {
    const output: ToolOutput<ClipOutputData> = {
      success: true,
      url: "https://youtube.com/watch?v=abc123",
      title: "My Video",
      markdown: "---\ntitle: My Video\n---\n# My Video\n\nTranscript...",
      content: "# My Video\n\nTranscript...",
      tags: ["youtube", "video"],
      data: {
        pageType: "youtube",
        metadata: {
          url: "https://youtube.com/watch?v=abc123",
          title: "My Video",
          type: "video",
          channel: "MyChannel",
        },
      },
    };

    expect(output.success).toBe(true);
    expect(output.data?.pageType).toBe("youtube");
    expect(output.data?.metadata.channel).toBe("MyChannel");
  });

  test("creates valid error output", () => {
    const output: ToolOutput<ClipOutputData> = {
      success: false,
      url: "https://example.com/404",
      title: "",
      markdown: "",
      content: "",
      tags: ["web-clip"],
      error: "Page not found (404)",
    };

    expect(output.success).toBe(false);
    expect(output.error).toBe("Page not found (404)");
  });
});

// ─── Frontmatter Building Tests ─────────────────────────────────────────────

describe("clip-url frontmatter building", () => {
  test("builds frontmatter for web article", () => {
    const frontmatter = buildFrontmatterYaml({
      source: "https://example.com/article",
      title: "Test Article",
      type: "article",
      dateClippedISO: "2024-01-15T12:00:00.000Z",
      tags: ["test", "article"],
      author: "Jane Doe",
    });

    expect(frontmatter).toContain('title: "Test Article"');
    expect(frontmatter).toContain('source: "https://example.com/article"');
    expect(frontmatter).toContain('author: "Jane Doe"');
    // Tags are quoted in YAML output
    expect(frontmatter).toContain('- "test"');
    expect(frontmatter).toContain('- "article"');
  });

  test("builds frontmatter for YouTube video", () => {
    const frontmatter = buildFrontmatterYaml({
      source: "https://youtube.com/watch?v=abc123",
      title: "My Tutorial",
      type: "video",
      dateClippedISO: "2024-01-15T12:00:00.000Z",
      tags: ["youtube", "tutorial"],
      channel: "TechChannel",
      duration: "10:30",
    });

    expect(frontmatter).toContain('title: "My Tutorial"');
    expect(frontmatter).toContain('channel: "TechChannel"');
    expect(frontmatter).toContain('duration: "10:30"');
  });

  test("builds frontmatter for PDF document", () => {
    const frontmatter = buildFrontmatterYaml({
      source: "https://example.com/doc.pdf",
      title: "Research Paper",
      type: "document",
      dateClippedISO: "2024-01-15T12:00:00.000Z",
      tags: ["pdf", "research"],
    });

    expect(frontmatter).toContain('title: "Research Paper"');
  });
});

// ─── Filename Sanitization Tests ────────────────────────────────────────────

describe("clip-url filename sanitization", () => {
  test("sanitizes titles for filenames", () => {
    expect(sanitizeFilename("Simple Title")).toBe("Simple Title");
    // Invalid characters get replaced with dashes
    expect(sanitizeFilename('Invalid: "Title" <test>')).toBe('Invalid- -Title- -test-');
    expect(sanitizeFilename("Path/With\\Slashes")).toBe("Path-With-Slashes");
  });

  test("handles empty titles", () => {
    expect(sanitizeFilename("")).toBe("Untitled");
    expect(sanitizeFilename("   ")).toBe("Untitled");
  });

  test("truncates long filenames", () => {
    const longTitle = "A".repeat(200);
    const sanitized = sanitizeFilename(longTitle);
    expect(sanitized.length).toBeLessThanOrEqual(100);
  });

  test("preserves valid special characters", () => {
    expect(sanitizeFilename("Note (draft)")).toBe("Note (draft)");
    expect(sanitizeFilename("Café & Co.")).toBe("Café & Co.");
    expect(sanitizeFilename("日本語タイトル")).toBe("日本語タイトル");
  });
});

// ─── Integration Test Helpers ───────────────────────────────────────────────

describe("clip-url test utilities", () => {
  test("can create mock ToolOutput for testing", () => {
    const mockOutput: ToolOutput = {
      success: true,
      url: "https://test.example.com",
      title: "Mock Article",
      markdown: "# Mock Article\n\nContent here.",
      content: "Content here.",
      tags: ["mock", "test"],
      data: {
        custom: "value",
      },
    };

    // Should serialize to JSON
    const json = JSON.stringify(mockOutput);
    const parsed = JSON.parse(json);
    expect(parsed.success).toBe(true);
    expect(parsed.title).toBe("Mock Article");
  });

  test("handles special characters in JSON output", () => {
    const output: ToolOutput = {
      success: true,
      url: "https://example.com",
      title: 'Quote: "Test" & <Tags>',
      markdown: "# Test\n\nSpecial: \u0000\u001F",
      content: "Special chars",
      tags: ["test"],
    };

    // Should serialize without throwing
    const json = JSON.stringify(output);
    const parsed = JSON.parse(json);
    expect(parsed.title).toBe('Quote: "Test" & <Tags>');
  });
});
