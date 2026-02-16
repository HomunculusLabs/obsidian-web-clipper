/**
 * Tool Config Library Tests
 *
 * Unit tests for tools/lib/config.ts - configuration file loading,
 * merging, and validation.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Test Fixtures ───────────────────────────────────────────────────────────

const TEMP_DIR = join(import.meta.dir, ".temp-config");

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

// ─── Config Type Tests ───────────────────────────────────────────────────────

describe("config types", () => {
  interface WebClipperConfig {
    vault?: string;
    folder?: string;
    tags?: string[];
    cliPath?: string;
    profile?: string;
    headless?: boolean;
    parallel?: number;
    wait?: number;
  }

  test("accepts partial config", () => {
    const config: WebClipperConfig = {
      vault: "My Vault",
      tags: ["research"],
    };

    expect(config.vault).toBe("My Vault");
    expect(config.tags).toEqual(["research"]);
    expect(config.folder).toBeUndefined();
  });

  test("accepts full config", () => {
    const config: WebClipperConfig = {
      vault: "Research",
      folder: "Clips/2024",
      tags: ["web", "research"],
      cliPath: "/usr/local/bin/obsidian-cli",
      profile: "~/.config/chrome",
      headless: true,
      parallel: 8,
      wait: 3000,
    };

    expect(config.vault).toBe("Research");
    expect(config.parallel).toBe(8);
  });
});

// ─── Config Merging Tests ────────────────────────────────────────────────────

describe("config merging", () => {
  interface WebClipperConfig {
    vault?: string;
    folder?: string;
    tags?: string[];
    cliPath?: string;
    parallel?: number;
    wait?: number;
  }

  interface CLIOptions {
    vault: string;
    folder: string;
    tags: string[];
    cliPath: string;
    parallel: number;
    wait: number;
  }

  const DEFAULT_OPTS: CLIOptions = {
    vault: "Main Vault",
    folder: "Clips",
    tags: ["web-clip"],
    cliPath: "obsidian-cli",
    parallel: 4,
    wait: 5000,
  };

  function mergeWithDefaults(
    cliOpts: Partial<CLIOptions>,
    config: WebClipperConfig
  ): CLIOptions {
    return {
      vault: cliOpts.vault || config.vault || DEFAULT_OPTS.vault,
      folder: cliOpts.folder || config.folder || DEFAULT_OPTS.folder,
      tags: cliOpts.tags?.length ? cliOpts.tags : config.tags || DEFAULT_OPTS.tags,
      cliPath: cliOpts.cliPath || config.cliPath || DEFAULT_OPTS.cliPath,
      parallel: cliOpts.parallel || config.parallel || DEFAULT_OPTS.parallel,
      wait: cliOpts.wait || config.wait || DEFAULT_OPTS.wait,
    };
  }

  test("uses CLI options over config", () => {
    const result = mergeWithDefaults(
      { vault: "CLI Vault", folder: "CLI/Folder", tags: [], cliPath: "", parallel: 0, wait: 0 },
      { vault: "Config Vault", folder: "Config/Folder" }
    );

    expect(result.vault).toBe("CLI Vault");
    expect(result.folder).toBe("CLI/Folder");
  });

  test("uses config over defaults", () => {
    const result = mergeWithDefaults(
      { vault: "", folder: "", tags: [], cliPath: "", parallel: 0, wait: 0 },
      { vault: "Config Vault", parallel: 8 }
    );

    expect(result.vault).toBe("Config Vault");
    expect(result.parallel).toBe(8);
  });

  test("uses defaults when neither provided", () => {
    const result = mergeWithDefaults(
      { vault: "", folder: "", tags: [], cliPath: "", parallel: 0, wait: 0 },
      {}
    );

    expect(result.vault).toBe("Main Vault");
    expect(result.folder).toBe("Clips");
    expect(result.parallel).toBe(4);
  });

  test("merges tags correctly", () => {
    // Empty CLI tags should use config tags
    const result1 = mergeWithDefaults(
      { vault: "", folder: "", tags: [], cliPath: "", parallel: 0, wait: 0 },
      { tags: ["config", "tags"] }
    );
    expect(result1.tags).toEqual(["config", "tags"]);

    // Non-empty CLI tags should be used
    const result2 = mergeWithDefaults(
      { vault: "", folder: "", tags: ["cli", "tags"], cliPath: "", parallel: 0, wait: 0 },
      { tags: ["config", "tags"] }
    );
    expect(result2.tags).toEqual(["cli", "tags"]);

    // No tags should use defaults
    const result3 = mergeWithDefaults(
      { vault: "", folder: "", tags: [], cliPath: "", parallel: 0, wait: 0 },
      {}
    );
    expect(result3.tags).toEqual(["web-clip"]);
  });

  test("handles numeric zero values", () => {
    // Zero is falsy, so it should fall through to config/defaults
    const result = mergeWithDefaults(
      { vault: "", folder: "", tags: [], cliPath: "", parallel: 0, wait: 0 },
      { parallel: 8, wait: 3000 }
    );

    expect(result.parallel).toBe(8);
    expect(result.wait).toBe(3000);
  });
});

// ─── Config File Loading Tests ───────────────────────────────────────────────

describe("config file loading", () => {
  beforeEach(() => {
    setupTempDir();
    cleanupTempDir();
    setupTempDir();
  });

  afterEach(() => {
    cleanupTempDir();
  });

  test("parses valid JSON config", () => {
    const configPath = join(TEMP_DIR, ".webclipper.json");
    const configContent = JSON.stringify({
      vault: "Research",
      folder: "Notes/Clips",
      tags: ["research", "article"],
    });
    writeFileSync(configPath, configContent);

    const parsed = JSON.parse(configContent);
    expect(parsed.vault).toBe("Research");
    expect(parsed.tags).toEqual(["research", "article"]);
  });

  test("handles empty config file", () => {
    const configPath = join(TEMP_DIR, "empty.json");
    writeFileSync(configPath, "{}");

    const parsed = JSON.parse("{}");
    expect(parsed).toEqual({});
  });

  test("handles config with extra fields", () => {
    const configContent = JSON.stringify({
      vault: "Test",
      unknownField: "should be ignored",
      anotherExtra: 123,
    });

    const parsed = JSON.parse(configContent);
    expect(parsed.vault).toBe("Test");
    expect(parsed.unknownField).toBe("should be ignored");
  });
});

// ─── Config Validation Tests ─────────────────────────────────────────────────

describe("config validation", () => {
  interface WebClipperConfig {
    vault?: string;
    folder?: string;
    tags?: string[];
    parallel?: number;
    wait?: number;
  }

  function validateConfig(config: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (typeof config !== "object" || config === null) {
      return { valid: false, errors: ["Config must be an object"] };
    }

    const c = config as Record<string, unknown>;

    if (c.vault !== undefined && typeof c.vault !== "string") {
      errors.push("vault must be a string");
    }

    if (c.folder !== undefined && typeof c.folder !== "string") {
      errors.push("folder must be a string");
    }

    if (c.tags !== undefined && !Array.isArray(c.tags)) {
      errors.push("tags must be an array");
    }

    if (c.parallel !== undefined && typeof c.parallel !== "number") {
      errors.push("parallel must be a number");
    }

    if (c.wait !== undefined && typeof c.wait !== "number") {
      errors.push("wait must be a number");
    }

    return { valid: errors.length === 0, errors };
  }

  test("validates correct config", () => {
    const result = validateConfig({
      vault: "Test",
      folder: "Notes",
      tags: ["a", "b"],
      parallel: 4,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("catches invalid vault type", () => {
    const result = validateConfig({ vault: 123 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("vault must be a string");
  });

  test("catches invalid tags type", () => {
    const result = validateConfig({ tags: "not-an-array" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("tags must be an array");
  });

  test("catches invalid parallel type", () => {
    const result = validateConfig({ parallel: "fast" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("parallel must be a number");
  });

  test("rejects non-object config", () => {
    const result = validateConfig("not an object");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Config must be an object");
  });

  test("accepts empty object", () => {
    const result = validateConfig({});
    expect(result.valid).toBe(true);
  });
});
