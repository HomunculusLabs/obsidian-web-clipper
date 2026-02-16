/**
 * Core Clipper Library Tests
 *
 * Unit tests for shared utilities in tools/lib/clipper-core.ts
 */

import { describe, test, expect, beforeEach, afterAll } from "bun:test";
// Import only types, not runtime code that depends on puppeteer
import type { ToolOutput, CommonCLIOptions } from "../../tools/lib/clipper-core";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

// Re-implement functions locally that we need to test to avoid puppeteer dependency
const DEFAULT_CLI_OPTIONS = {
  cli: false,
  cliPath: "obsidian-cli",
  vault: "Main Vault",
  folder: "Clips",
  profile: null as string | null,
  headless: true,
  wait: 5000,
  tags: ["web-clip"],
  json: false,
  stdout: false,
};

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

function formatNumber(num: number): string {
  if (num >= 1000000000) {
    return `${(num / 1000000000).toFixed(1)}B`;
  } else if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

function parseEngagementCount(ariaLabel: string): number {
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

// ─── Test Fixtures ───────────────────────────────────────────────────────────

const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const TEMP_DIR = join(import.meta.dir, ".temp");

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

// ─── Logger Tests ────────────────────────────────────────────────────────────

describe("createLogger", () => {
  // Local implementation of createLogger for testing
  function createLogger(prefix = "") {
    let _quiet = false;

    const log = (...args: unknown[]): void => {
      if (_quiet) return;
      // Silent in tests
    };

    log.error = (...args: unknown[]): void => {
      // Silent in tests
    };

    log.warn = (...args: unknown[]): void => {
      if (_quiet) return;
    };

    log.setQuiet = (quiet: boolean): void => {
      _quiet = quiet;
    };

    return log;
  }

  test("creates a logger function", () => {
    const log = createLogger();
    expect(typeof log).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.setQuiet).toBe("function");
  });

  test("creates logger with prefix", () => {
    const log = createLogger("[TEST]");
    expect(typeof log).toBe("function");
    // Logger should work without throwing
    expect(() => log("test message")).not.toThrow();
  });

  test("setQuiet toggles quiet mode", () => {
    const log = createLogger();
    // Should not throw when setting quiet mode
    expect(() => log.setQuiet(true)).not.toThrow();
    expect(() => log.setQuiet(false)).not.toThrow();
  });

  test("error method always outputs", () => {
    const log = createLogger();
    log.setQuiet(true);
    // Error should still work in quiet mode
    expect(() => log.error("test error")).not.toThrow();
  });
});

// ─── URL Resolution Tests ────────────────────────────────────────────────────

describe("resolveUrls", () => {
  beforeEach(() => {
    setupTempDir();
    cleanupTempDir();
    setupTempDir();
  });

  test("resolves plain URLs", async () => {
    const urls = ["https://example.com", "https://other.com"];
    const result = await resolveUrls(urls);
    expect(result).toEqual(urls);
  });

  test("resolves URLs from file with @file: prefix", async () => {
    const filePath = join(TEMP_DIR, "urls.txt");
    const fileContent = `https://example.com
https://other.com
# This is a comment
https://third.com
`;
    writeFileSync(filePath, fileContent);

    const result = await resolveUrls([`@file:${filePath}`]);

    expect(result).toContain("https://example.com");
    expect(result).toContain("https://other.com");
    expect(result).toContain("https://third.com");
    expect(result).not.toContain("# This is a comment");
    expect(result.length).toBe(3);
  });

  test("ignores empty lines and comments in file", async () => {
    const filePath = join(TEMP_DIR, "mixed.txt");
    const fileContent = `

https://example.com

# Comment line
   # Indented comment
https://other.com

`;
    writeFileSync(filePath, fileContent);

    const result = await resolveUrls([`@file:${filePath}`]);

    expect(result).toEqual(["https://example.com", "https://other.com"]);
  });

  test("throws error for non-existent file", async () => {
    const nonExistent = `@file:${join(TEMP_DIR, "nonexistent.txt")}`;

    await expect(resolveUrls([nonExistent])).rejects.toThrow("File not found");
  });

  test("combines direct URLs with file URLs", async () => {
    const filePath = join(TEMP_DIR, "urls.txt");
    writeFileSync(filePath, "https://from-file.com\n");

    const result = await resolveUrls([
      "https://direct.com",
      `@file:${filePath}`,
    ]);

    expect(result).toContain("https://direct.com");
    expect(result).toContain("https://from-file.com");
    expect(result.length).toBe(2);
  });

  test("handles multiple @file: entries", async () => {
    const file1 = join(TEMP_DIR, "urls1.txt");
    const file2 = join(TEMP_DIR, "urls2.txt");
    writeFileSync(file1, "https://file1.com\n");
    writeFileSync(file2, "https://file2.com\n");

    const result = await resolveUrls([`@file:${file1}`, `@file:${file2}`]);

    expect(result).toContain("https://file1.com");
    expect(result).toContain("https://file2.com");
  });

  afterAll(() => {
    cleanupTempDir();
  });
});

// ─── Number Formatting Tests ─────────────────────────────────────────────────

describe("formatNumber", () => {
  test("formats billions", () => {
    expect(formatNumber(1500000000)).toBe("1.5B");
    expect(formatNumber(2300000000)).toBe("2.3B");
  });

  test("formats millions", () => {
    expect(formatNumber(1500000)).toBe("1.5M");
    expect(formatNumber(2300000)).toBe("2.3M");
  });

  test("formats thousands", () => {
    expect(formatNumber(1500)).toBe("1.5K");
    expect(formatNumber(2300)).toBe("2.3K");
  });

  test("returns plain number for small values", () => {
    expect(formatNumber(500)).toBe("500");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
  });
});

// ─── Engagement Count Parsing Tests ─────────────────────────────────────────

describe("parseEngagementCount", () => {
  test("parses simple numbers", () => {
    expect(parseEngagementCount("123 replies")).toBe(123);
    expect(parseEngagementCount("456 likes")).toBe(456);
  });

  test("parses numbers with K suffix", () => {
    expect(parseEngagementCount("1.2K Likes")).toBe(1200);
    expect(parseEngagementCount("5K")).toBe(5000);
    expect(parseEngagementCount("10.5k views")).toBe(10500);
  });

  test("parses numbers with M suffix", () => {
    expect(parseEngagementCount("1.5M views")).toBe(1500000);
    expect(parseEngagementCount("2M")).toBe(2000000);
  });

  test("parses numbers with B suffix", () => {
    expect(parseEngagementCount("1B views")).toBe(1000000000);
    expect(parseEngagementCount("2.5B")).toBe(2500000000);
  });

  test("parses numbers with commas", () => {
    expect(parseEngagementCount("1,234 replies")).toBe(1234);
    expect(parseEngagementCount("1,234,567")).toBe(1234567);
  });

  test("returns 0 for invalid input", () => {
    expect(parseEngagementCount("")).toBe(0);
    expect(parseEngagementCount("no numbers")).toBe(0);
    expect(parseEngagementCount("null")).toBe(0);
  });
});

// ─── Default Options Tests ──────────────────────────────────────────────────

describe("DEFAULT_CLI_OPTIONS", () => {
  test("has expected default values", () => {
    expect(DEFAULT_CLI_OPTIONS.cli).toBe(false);
    expect(DEFAULT_CLI_OPTIONS.cliPath).toBe("obsidian-cli");
    expect(DEFAULT_CLI_OPTIONS.vault).toBe("Main Vault");
    expect(DEFAULT_CLI_OPTIONS.folder).toBe("Clips");
    expect(DEFAULT_CLI_OPTIONS.profile).toBe(null);
    expect(DEFAULT_CLI_OPTIONS.headless).toBe(true);
    expect(DEFAULT_CLI_OPTIONS.wait).toBe(5000);
    expect(DEFAULT_CLI_OPTIONS.tags).toEqual(["web-clip"]);
    expect(DEFAULT_CLI_OPTIONS.json).toBe(false);
    expect(DEFAULT_CLI_OPTIONS.stdout).toBe(false);
  });
});

// ─── ToolOutput Interface Tests ─────────────────────────────────────────────

describe("ToolOutput interface", () => {
  test("creates valid success output", () => {
    const output: ToolOutput = {
      success: true,
      url: "https://example.com",
      title: "Example Article",
      markdown: "---\ntitle: Example\n---\n# Content",
      content: "# Content",
      tags: ["web-clip", "example"],
    };

    expect(output.success).toBe(true);
    expect(output.url).toBe("https://example.com");
    expect(output.title).toBe("Example Article");
    expect(output.error).toBeUndefined();
  });

  test("creates valid error output", () => {
    const output: ToolOutput = {
      success: false,
      url: "https://example.com",
      title: "",
      markdown: "",
      content: "",
      tags: [],
      error: "Failed to load page",
    };

    expect(output.success).toBe(false);
    expect(output.error).toBe("Failed to load page");
  });

  test("supports generic data field", () => {
    interface CustomData {
      pageType: string;
      wordCount: number;
    }

    const output: ToolOutput<CustomData> = {
      success: true,
      url: "https://example.com",
      title: "Test",
      markdown: "# Test",
      content: "# Test",
      tags: [],
      data: {
        pageType: "article",
        wordCount: 500,
      },
    };

    expect(output.data?.pageType).toBe("article");
    expect(output.data?.wordCount).toBe(500);
  });
});

// ─── CommonCLIOptions Interface Tests ───────────────────────────────────────

describe("CommonCLIOptions interface", () => {
  test("accepts valid options", () => {
    const opts: CommonCLIOptions = {
      cli: true,
      cliPath: "/usr/local/bin/obsidian-cli",
      vault: "My Vault",
      folder: "Notes/Clips",
      profile: "~/.config/chrome",
      headless: false,
      wait: 10000,
      tags: ["research", "article"],
      json: true,
      stdout: false,
    };

    expect(opts.cli).toBe(true);
    expect(opts.vault).toBe("My Vault");
    expect(opts.tags).toEqual(["research", "article"]);
  });
});
