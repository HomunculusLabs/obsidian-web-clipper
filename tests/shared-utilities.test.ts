/**
 * Shared Utilities Tests
 *
 * Unit tests for:
 * - sanitize.ts - filename sanitization
 * - tags.ts - tag parsing and auto-tagging
 * - folders.ts - folder candidate generation
 * - pageType.ts - URL type detection
 * - markdown.ts - frontmatter and markdown building
 * - guards.ts - type guards for messages and results
 */

import { describe, test, expect } from "bun:test";

// ============================================================================
// sanitize.ts Tests
// ============================================================================

describe("sanitizeFilename", () => {
  const { sanitizeFilename } = require("../src/shared/sanitize.ts");

  describe("basic sanitization", () => {
    test("returns input unchanged for valid filenames", () => {
      expect(sanitizeFilename("My Note")).toBe("My Note");
      expect(sanitizeFilename("example-file_2024")).toBe("example-file_2024");
    });

    test("trims whitespace", () => {
      expect(sanitizeFilename("  hello  ")).toBe("hello");
    });

    test("collapses multiple spaces into one", () => {
      expect(sanitizeFilename("hello    world")).toBe("hello world");
    });
  });

  describe("special character handling", () => {
    test("replaces invalid characters with dash", () => {
      expect(sanitizeFilename("file<name>")).toBe("file-name-");
      expect(sanitizeFilename('test:colon"quote')).toBe("test-colon-quote");
      expect(sanitizeFilename("path/to\\file")).toBe("path-to-file");
      expect(sanitizeFilename("what|ever?test*")).toBe("what-ever-test-");
    });

    test("handles all invalid characters", () => {
      // Invalid: < > : " / \ | ? *
      expect(sanitizeFilename("a<b>c:d\"e/f\\g|h?i*j")).toBe("a-b-c-d-e-f-g-h-i-j");
    });
  });

  describe("control character handling", () => {
    test("replaces control characters with space", () => {
      expect(sanitizeFilename("hello\u0000world")).toBe("hello world");
      expect(sanitizeFilename("test\u001Fend")).toBe("test end");
      expect(sanitizeFilename("mid\u007Fdle")).toBe("mid dle");
    });
  });

  describe("fallback behavior", () => {
    test("returns 'Untitled' for empty string", () => {
      expect(sanitizeFilename("")).toBe("Untitled");
    });

    test("returns 'Untitled' for null input", () => {
      expect(sanitizeFilename(null as unknown as string)).toBe("Untitled");
    });

    test("returns 'Untitled' for undefined input", () => {
      expect(sanitizeFilename(undefined as unknown as string)).toBe("Untitled");
    });

    test("returns 'Untitled' for whitespace-only string", () => {
      expect(sanitizeFilename("   ")).toBe("Untitled");
    });
  });

  describe("max length handling", () => {
    test("truncates to default max length (100)", () => {
      const longName = "x".repeat(150);
      expect(sanitizeFilename(longName).length).toBe(100);
    });

    test("respects custom max length", () => {
      expect(sanitizeFilename("hello world", 5)).toBe("hello");
      expect(sanitizeFilename("hello world", 10)).toBe("hello worl");
    });

    test("handles max length of 1", () => {
      expect(sanitizeFilename("hello", 1)).toBe("h");
    });

    test("truncates 'Untitled' fallback to max length when input is whitespace", () => {
      // When input is whitespace, fallback is "Untitled" which gets truncated to maxLen
      expect(sanitizeFilename("   ", 5)).toBe("Untit");
    });
  });

  describe("unicode handling", () => {
    test("preserves unicode characters", () => {
      expect(sanitizeFilename("日本語ノート")).toBe("日本語ノート");
      expect(sanitizeFilename("café résumé")).toBe("café résumé");
      expect(sanitizeFilename("emoji 🌍 test")).toBe("emoji 🌍 test");
    });
  });
});

// ============================================================================
// tags.ts Tests
// ============================================================================

describe("parseTags", () => {
  const { parseTags } = require("../src/shared/tags.ts");

  describe("basic parsing", () => {
    test("parses comma-separated tags", () => {
      expect(parseTags("tag1, tag2, tag3")).toEqual(["tag1", "tag2", "tag3"]);
    });

    test("trims whitespace from tags", () => {
      expect(parseTags("  tag1  ,  tag2  ")).toEqual(["tag1", "tag2"]);
    });

    test("handles single tag", () => {
      expect(parseTags("solo")).toEqual(["solo"]);
    });

    test("handles empty string", () => {
      expect(parseTags("")).toEqual([]);
    });

    test("handles null/undefined", () => {
      expect(parseTags(null as unknown as string)).toEqual([]);
      expect(parseTags(undefined as unknown as string)).toEqual([]);
    });
  });

  describe("deduplication", () => {
    test("removes duplicate tags", () => {
      expect(parseTags("tag1, tag2, tag1")).toEqual(["tag1", "tag2"]);
    });

    test("removes duplicates case-insensitively", () => {
      expect(parseTags("Tag, tag, TAG")).toEqual(["Tag"]);
    });

    test("preserves first occurrence case", () => {
      expect(parseTags("MyTag, mytag, MYTAG")).toEqual(["MyTag"]);
    });
  });

  describe("edge cases", () => {
    test("filters out empty tags", () => {
      expect(parseTags("tag1, , tag2,")).toEqual(["tag1", "tag2"]);
    });

    test("handles whitespace-only tags", () => {
      expect(parseTags("tag1,   , tag2")).toEqual(["tag1", "tag2"]);
    });

    test("handles tags with internal spaces", () => {
      expect(parseTags("my tag, your tag")).toEqual(["my tag", "your tag"]);
    });
  });
});

describe("addAutoTags", () => {
  const { addAutoTags } = require("../src/shared/tags.ts");

  describe("page type auto-tagging", () => {
    test("adds 'youtube' tag for youtube page type", () => {
      const tags: string[] = [];
      addAutoTags(tags, "youtube");
      expect(tags).toContain("youtube");
    });

    test("adds 'pdf' tag for pdf page type", () => {
      const tags: string[] = [];
      addAutoTags(tags, "pdf");
      expect(tags).toContain("pdf");
    });

    test("does not add duplicate youtube tag", () => {
      const tags = ["youtube", "video"];
      addAutoTags(tags, "youtube");
      expect(tags.filter((t) => t.toLowerCase() === "youtube")).toHaveLength(1);
    });

    test("does not add duplicate pdf tag", () => {
      const tags = ["pdf", "document"];
      addAutoTags(tags, "pdf");
      expect(tags.filter((t) => t.toLowerCase() === "pdf")).toHaveLength(1);
    });
  });

  describe("default tag behavior", () => {
    test("adds 'web-clip' when no other tags exist", () => {
      const tags: string[] = [];
      addAutoTags(tags, "web");
      expect(tags).toContain("web-clip");
    });

    test("does not add 'web-clip' when other tags exist", () => {
      const tags = ["existing"];
      addAutoTags(tags, "web");
      expect(tags).not.toContain("web-clip");
    });

    test("does not add 'web-clip' for youtube page type", () => {
      const tags: string[] = [];
      addAutoTags(tags, "youtube");
      expect(tags).not.toContain("web-clip");
      expect(tags).toContain("youtube");
    });

    test("does not add 'web-clip' for pdf page type", () => {
      const tags: string[] = [];
      addAutoTags(tags, "pdf");
      expect(tags).not.toContain("web-clip");
      expect(tags).toContain("pdf");
    });
  });

  describe("mutation behavior", () => {
    test("mutates and returns the same array", () => {
      const tags: string[] = [];
      const result = addAutoTags(tags, "web");
      expect(result).toBe(tags); // Same reference
    });
  });
});

// ============================================================================
// folders.ts Tests
// ============================================================================

describe("getFolderCandidates", () => {
  const { getFolderCandidates } = require("../src/shared/folders.ts");

  const createMockSettings = (
    savedFolders: string[] | undefined,
    defaultFolder: string
  ) => ({
    savedFolders,
    defaultFolder,
    // Minimal required settings properties
    vault: "test-vault",
    saveMethod: "clipboard" as const,
    imageHandling: "keep" as const,
    tableHandling: "gfm" as const,
    codeBlockLanguage: "off" as const,
  });

  describe("basic functionality", () => {
    test("combines saved folders with default folder", () => {
      const settings = createMockSettings(["folder1", "folder2"], "default");
      const result = getFolderCandidates(settings);
      expect(result).toContain("folder1");
      expect(result).toContain("folder2");
      expect(result).toContain("default");
    });

    test("includes default folder when no saved folders", () => {
      const settings = createMockSettings([], "Inbox");
      expect(getFolderCandidates(settings)).toEqual(["Inbox"]);
    });

    test("includes default folder when saved folders is undefined", () => {
      const settings = createMockSettings(undefined, "Inbox");
      expect(getFolderCandidates(settings)).toEqual(["Inbox"]);
    });
  });

  describe("deduplication", () => {
    test("removes duplicate folders", () => {
      const settings = createMockSettings(
        ["Notes", "Archive", "Notes"],
        "Notes"
      );
      expect(getFolderCandidates(settings)).toEqual(["Notes", "Archive"]);
    });

    test("removes duplicates case-insensitively", () => {
      const settings = createMockSettings(["Notes", "NOTES"], "notes");
      expect(getFolderCandidates(settings)).toEqual(["Notes"]);
    });
  });

  describe("edge cases", () => {
    test("filters out empty strings", () => {
      const settings = createMockSettings(["", "folder1", "  "], "");
      expect(getFolderCandidates(settings)).toEqual(["folder1"]);
    });

    test("trims folder names", () => {
      const settings = createMockSettings(["  folder1  "], "  Inbox  ");
      expect(getFolderCandidates(settings)).toEqual(["folder1", "Inbox"]);
    });

    test("returns empty array when all folders are empty", () => {
      const settings = createMockSettings(["", "  "], "");
      expect(getFolderCandidates(settings)).toEqual([]);
    });
  });
});

// ============================================================================
// pageType.ts Tests
// ============================================================================

describe("pageType detection", () => {
  const { isYouTubeUrl, isPdfUrl, isTwitterUrl, detectPageType } =
    require("../src/shared/pageType.ts");

  describe("isYouTubeUrl", () => {
    test("matches standard YouTube watch URLs", () => {
      expect(isYouTubeUrl("https://www.youtube.com/watch?v=abc123")).toBe(true);
      expect(isYouTubeUrl("http://youtube.com/watch?v=test")).toBe(true);
    });

    test("matches YouTube shorts URLs", () => {
      expect(isYouTubeUrl("https://www.youtube.com/shorts/abc123")).toBe(true);
      expect(isYouTubeUrl("https://youtube.com/shorts/test")).toBe(true);
    });

    test("rejects non-YouTube URLs", () => {
      expect(isYouTubeUrl("https://example.com")).toBe(false);
      expect(isYouTubeUrl("https://notyoutube.com/watch?v=abc")).toBe(false);
    });

    test("rejects YouTube embed URLs (not watch/shorts)", () => {
      expect(isYouTubeUrl("https://www.youtube.com/embed/abc123")).toBe(false);
    });
  });

  describe("isPdfUrl", () => {
    test("matches PDF URLs", () => {
      expect(isPdfUrl("https://example.com/doc.pdf")).toBe(true);
      expect(isPdfUrl("http://site.org/path/to/file.pdf")).toBe(true);
    });

    test("matches PDF URLs with query strings", () => {
      expect(isPdfUrl("https://example.com/doc.pdf?download=1")).toBe(true);
      expect(isPdfUrl("https://site.org/file.pdf?page=2")).toBe(true);
    });

    test("rejects non-PDF URLs", () => {
      expect(isPdfUrl("https://example.com/doc.html")).toBe(false);
      expect(isPdfUrl("https://example.com/pdf")).toBe(false);
    });

    test("is case-insensitive", () => {
      expect(isPdfUrl("https://example.com/doc.PDF")).toBe(true);
      expect(isPdfUrl("https://example.com/doc.Pdf")).toBe(true);
    });
  });

  describe("isTwitterUrl", () => {
    test("matches twitter.com URLs", () => {
      expect(isTwitterUrl("https://twitter.com/user/status/123")).toBe(true);
      expect(isTwitterUrl("https://www.twitter.com/user")).toBe(true);
      expect(isTwitterUrl("https://mobile.twitter.com/user")).toBe(true);
    });

    test("matches x.com URLs", () => {
      expect(isTwitterUrl("https://x.com/user/status/123")).toBe(true);
      expect(isTwitterUrl("https://www.x.com/user")).toBe(true);
      expect(isTwitterUrl("https://mobile.x.com/user")).toBe(true);
    });

    test("rejects non-Twitter URLs", () => {
      expect(isTwitterUrl("https://example.com")).toBe(false);
      expect(isTwitterUrl("https://twitter.example.com")).toBe(false);
    });
  });

  describe("detectPageType", () => {
    test("detects YouTube pages", () => {
      expect(detectPageType("https://www.youtube.com/watch?v=abc")).toBe(
        "youtube"
      );
      expect(detectPageType("https://youtube.com/shorts/xyz")).toBe("youtube");
    });

    test("detects Twitter/X pages", () => {
      expect(detectPageType("https://twitter.com/user")).toBe("twitter");
      expect(detectPageType("https://x.com/user/status/123")).toBe("twitter");
    });

    test("detects PDF by URL", () => {
      expect(detectPageType("https://example.com/doc.pdf")).toBe("pdf");
    });

    test("detects PDF by content type", () => {
      expect(detectPageType("https://example.com/doc", "application/pdf")).toBe(
        "pdf"
      );
    });

    test("defaults to web for other URLs", () => {
      expect(detectPageType("https://example.com")).toBe("web");
      expect(detectPageType("https://github.com/repo")).toBe("web");
    });

    test("prioritizes Twitter over other checks", () => {
      // Twitter check comes first in implementation
      expect(detectPageType("https://x.com/something")).toBe("twitter");
    });
  });
});

// ============================================================================
// markdown.ts Tests
// ============================================================================

describe("markdown utilities", () => {
  const { buildFrontmatterYaml, buildClipMarkdown } =
    require("../src/shared/markdown.ts");

  describe("buildFrontmatterYaml", () => {
    test("builds basic frontmatter", () => {
      const input = {
        source: "https://example.com",
        title: "Test Article",
        type: "article" as const,
        dateClippedISO: "2024-01-15T10:30:00Z",
        tags: ["test", "example"],
      };

      const result = buildFrontmatterYaml(input);

      expect(result).toContain("---");
      expect(result).toContain("source:");
      expect(result).toContain("https://example.com");
      expect(result).toContain("title:");
      expect(result).toContain("Test Article");
      expect(result).toContain("type:");
      expect(result).toContain("article");
      expect(result).toContain("date_clipped:");
      expect(result).toContain("tags:");
      expect(result).toContain("- \"test\"");
    });

    test("includes optional fields when provided", () => {
      const input = {
        source: "https://example.com",
        title: "Test",
        type: "article" as const,
        dateClippedISO: "2024-01-15T10:30:00Z",
        tags: [],
        author: "John Doe",
        channel: "TechChannel",
        duration: "10:30",
      };

      const result = buildFrontmatterYaml(input);

      expect(result).toContain("author:");
      expect(result).toContain("John Doe");
      expect(result).toContain("channel:");
      expect(result).toContain("TechChannel");
      expect(result).toContain("duration:");
      expect(result).toContain("10:30");
    });

    test("handles empty tags array", () => {
      const input = {
        source: "https://example.com",
        title: "Test",
        type: "article" as const,
        dateClippedISO: "2024-01-15T10:30:00Z",
        tags: [],
      };

      const result = buildFrontmatterYaml(input);

      expect(result).toContain("tags: []");
    });

    test("includes extra fields", () => {
      const input = {
        source: "https://example.com",
        title: "Test",
        type: "article" as const,
        dateClippedISO: "2024-01-15T10:30:00Z",
        tags: [],
        extra: {
          custom_field: "custom value",
          score: 42,
        },
      };

      const result = buildFrontmatterYaml(input);

      expect(result).toContain("custom_field:");
      expect(result).toContain("custom value");
      expect(result).toContain("score:");
      expect(result).toContain("42");
    });

    test("does not include reserved keys from extra", () => {
      const input = {
        source: "https://example.com",
        title: "Test",
        type: "article" as const,
        dateClippedISO: "2024-01-15T10:30:00Z",
        tags: [],
        extra: {
          title: "Should not appear",
          source: "Also not",
        },
      };

      const result = buildFrontmatterYaml(input);

      // Should not have duplicate keys
      const titleMatches = result.match(/title:/g);
      expect(titleMatches?.length).toBe(1);
    });

    test("escapes special YAML characters", () => {
      const input = {
        source: "https://example.com",
        title: 'Test with "quotes" and \\backslash\\',
        type: "article" as const,
        dateClippedISO: "2024-01-15T10:30:00Z",
        tags: [],
      };

      const result = buildFrontmatterYaml(input);

      expect(result).toContain('\\"quotes\\"');
      expect(result).toContain("\\\\backslash\\\\");
    });

    test("handles multiline strings", () => {
      const input = {
        source: "https://example.com",
        title: "Test",
        type: "article" as const,
        dateClippedISO: "2024-01-15T10:30:00Z",
        tags: [],
        extra: {
          description: "Line 1\nLine 2\r\nLine 3",
        },
      };

      const result = buildFrontmatterYaml(input);

      // Newlines should be escaped
      expect(result).toContain("\\n");
    });
  });

  describe("buildClipMarkdown", () => {
    test("combines frontmatter with body", () => {
      const frontmatter = {
        source: "https://example.com",
        title: "Test",
        type: "article" as const,
        dateClippedISO: "2024-01-15T10:30:00Z",
        tags: ["test"],
      };

      const result = buildClipMarkdown(frontmatter, "# Hello\n\nWorld");

      expect(result).toContain("---");
      expect(result).toContain("# Hello");
      expect(result).toContain("World");
    });

    test("handles empty body", () => {
      const frontmatter = {
        source: "https://example.com",
        title: "Test",
        type: "article" as const,
        dateClippedISO: "2024-01-15T10:30:00Z",
        tags: [],
      };

      const result = buildClipMarkdown(frontmatter, "");

      expect(result).toContain("---");
      // Should still end with newline
      expect(result.endsWith("\n")).toBe(true);
    });

    test("strips leading whitespace from body", () => {
      const frontmatter = {
        source: "https://example.com",
        title: "Test",
        type: "article" as const,
        dateClippedISO: "2024-01-15T10:30:00Z",
        tags: [],
      };

      const result = buildClipMarkdown(frontmatter, "   \n\n# Hello");

      expect(result).toContain("# Hello");
      // Should not have leading whitespace before heading
      expect(result).toMatch(/---\n\n# Hello/);
    });

    test("ensures trailing newline", () => {
      const frontmatter = {
        source: "https://example.com",
        title: "Test",
        type: "article" as const,
        dateClippedISO: "2024-01-15T10:30:00Z",
        tags: [],
      };

      const resultNoNewline = buildClipMarkdown(frontmatter, "No newline");
      expect(resultNoNewline.endsWith("\n")).toBe(true);

      const resultWithNewline = buildClipMarkdown(frontmatter, "Has newline\n");
      expect(resultWithNewline.endsWith("\n")).toBe(true);
    });
  });
});

// ============================================================================
// guards.ts Tests
// ============================================================================

describe("type guards", () => {
  const {
    isTabRequest,
    isRuntimeRequest,
    isTabResponse,
    isClipResult,
  } = require("../src/shared/guards.ts");

  describe("isTabRequest", () => {
    test("returns true for valid tab request actions", () => {
      expect(isTabRequest({ action: "clip" })).toBe(true);
      expect(isTabRequest({ action: "getPageInfo" })).toBe(true);
      expect(isTabRequest({ action: "getSelectionInfo" })).toBe(true);
      expect(isTabRequest({ action: "getTemplateInfo" })).toBe(true);
    });

    test("returns false for invalid actions", () => {
      expect(isTabRequest({ action: "unknown" })).toBe(false);
      expect(isTabRequest({ action: "getSettings" })).toBe(false);
    });

    test("returns false for non-objects", () => {
      expect(isTabRequest(null)).toBe(false);
      expect(isTabRequest(undefined)).toBe(false);
      expect(isTabRequest("clip")).toBe(false);
      expect(isTabRequest(123)).toBe(false);
    });

    test("returns false for objects without action", () => {
      expect(isTabRequest({})).toBe(false);
      expect(isTabRequest({ type: "clip" })).toBe(false);
    });
  });

  describe("isRuntimeRequest", () => {
    test("returns true for valid runtime request actions", () => {
      expect(isRuntimeRequest({ action: "getSettings" })).toBe(true);
      expect(isRuntimeRequest({ action: "copyToClipboard" })).toBe(true);
      expect(isRuntimeRequest({ action: "openObsidianUri" })).toBe(true);
      expect(isRuntimeRequest({ action: "extractPdf" })).toBe(true);
      expect(isRuntimeRequest({ action: "testCliConnection" })).toBe(true);
      expect(isRuntimeRequest({ action: "detectCli" })).toBe(true);
      expect(isRuntimeRequest({ action: "saveToCli" })).toBe(true);
      expect(isRuntimeRequest({ action: "saveContent" })).toBe(true);
    });

    test("returns false for invalid actions", () => {
      expect(isRuntimeRequest({ action: "clip" })).toBe(false);
      expect(isRuntimeRequest({ action: "unknown" })).toBe(false);
    });

    test("returns false for non-objects", () => {
      expect(isRuntimeRequest(null)).toBe(false);
      expect(isRuntimeRequest(undefined)).toBe(false);
      expect(isRuntimeRequest("getSettings")).toBe(false);
    });
  });

  describe("isTabResponse", () => {
    test("returns true for objects with 'ok' property", () => {
      expect(isTabResponse({ ok: true })).toBe(true);
      expect(isTabResponse({ ok: false })).toBe(true);
      expect(isTabResponse({ ok: true, data: {} })).toBe(true);
    });

    test("returns false for objects without 'ok' property", () => {
      expect(isTabResponse({})).toBe(false);
      expect(isTabResponse({ success: true })).toBe(false);
    });

    test("returns false for non-objects", () => {
      expect(isTabResponse(null)).toBe(false);
      expect(isTabResponse(undefined)).toBe(false);
      expect(isTabResponse("ok")).toBe(false);
    });
  });

  describe("isClipResult", () => {
    test("returns true for valid ClipResult objects", () => {
      expect(
        isClipResult({
          url: "https://example.com",
          title: "Test",
          markdown: "# Test",
          metadata: { url: "https://example.com", title: "Test", type: "article" },
        })
      ).toBe(true);
    });

    test("returns true for ClipResult with error", () => {
      expect(
        isClipResult({
          url: "https://example.com",
          title: "Test",
          markdown: "",
          metadata: { url: "https://example.com", title: "Test", type: "article" },
          error: "Something went wrong",
        })
      ).toBe(true);
    });

    test("returns false for missing required fields", () => {
      expect(isClipResult({})).toBe(false);
      expect(isClipResult({ url: "https://example.com" })).toBe(false);
      expect(
        isClipResult({ url: "https://example.com", title: "Test" })
      ).toBe(false);
    });

    test("returns false for non-objects", () => {
      expect(isClipResult(null)).toBe(false);
      expect(isClipResult(undefined)).toBe(false);
      expect(isClipResult("not an object")).toBe(false);
    });
  });
});

// ============================================================================
// Module Exports Verification
// ============================================================================

describe("module exports", () => {
  test("sanitize.ts exports sanitizeFilename", async () => {
    const module = await import("../src/shared/sanitize.ts");
    expect(typeof module.sanitizeFilename).toBe("function");
  });

  test("tags.ts exports parseTags and addAutoTags", async () => {
    const module = await import("../src/shared/tags.ts");
    expect(typeof module.parseTags).toBe("function");
    expect(typeof module.addAutoTags).toBe("function");
  });

  test("folders.ts exports getFolderCandidates", async () => {
    const module = await import("../src/shared/folders.ts");
    expect(typeof module.getFolderCandidates).toBe("function");
  });

  test("pageType.ts exports detection functions", async () => {
    const module = await import("../src/shared/pageType.ts");
    expect(typeof module.isYouTubeUrl).toBe("function");
    expect(typeof module.isPdfUrl).toBe("function");
    expect(typeof module.isTwitterUrl).toBe("function");
    expect(typeof module.detectPageType).toBe("function");
  });

  test("markdown.ts exports build functions", async () => {
    const module = await import("../src/shared/markdown.ts");
    expect(typeof module.buildFrontmatterYaml).toBe("function");
    expect(typeof module.buildClipMarkdown).toBe("function");
  });

  test("guards.ts exports type guard functions", async () => {
    const module = await import("../src/shared/guards.ts");
    expect(typeof module.isTabRequest).toBe("function");
    expect(typeof module.isRuntimeRequest).toBe("function");
    expect(typeof module.isTabResponse).toBe("function");
    expect(typeof module.isClipResult).toBe("function");
  });
});
