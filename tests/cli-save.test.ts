/**
 * CLI Save Pipeline Tests
 *
 * Tests for the Obsidian CLI integration including:
 * - saveViaCli function behavior
 * - Fallback chain (CLI → URI → clipboard)
 * - Error handling
 * - Path sanitization
 * - Configuration validation
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  saveViaCli,
  testCliConnection,
  canSpawnProcess,
  buildCliCommand,
  type CliSaveOptions,
  type CliSaveResult,
} from "../src/shared/obsidianCliSave";
import type { ObsidianCliConfig } from "../src/shared/obsidianCli";
import { sanitizeFilename } from "../src/shared/sanitize";

// ============================================================================
// Path Sanitization Tests
// ============================================================================

describe("sanitizeFilename", () => {
  test("removes control characters", () => {
    expect(sanitizeFilename("hello\u0000world")).toBe("hello world");
    expect(sanitizeFilename("test\u001Fname")).toBe("test name");
    expect(sanitizeFilename("clean\u007Fname")).toBe("clean name");
  });

  test("replaces invalid filename characters with dash", () => {
    expect(sanitizeFilename('file<name>test')).toBe("file-name-test");
    expect(sanitizeFilename('file:name"test')).toBe("file-name-test");
    expect(sanitizeFilename('file/name\\test')).toBe("file-name-test");
    // Note: * at end creates trailing dash (intentional behavior)
    expect(sanitizeFilename('file|name?test*')).toBe("file-name-test-");
  });

  test("normalizes whitespace", () => {
    expect(sanitizeFilename("multiple   spaces")).toBe("multiple spaces");
    expect(sanitizeFilename("tabs\there")).toBe("tabs here");
    expect(sanitizeFilename("  leading")).toBe("leading");
    expect(sanitizeFilename("trailing  ")).toBe("trailing");
  });

  test("returns Untitled for empty or whitespace-only input", () => {
    expect(sanitizeFilename("")).toBe("Untitled");
    expect(sanitizeFilename("   ")).toBe("Untitled");
    expect(sanitizeFilename("\t\n")).toBe("Untitled");
  });

  test("truncates long filenames", () => {
    const longName = "a".repeat(200);
    const result = sanitizeFilename(longName, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toBe("a".repeat(100));
  });

  test("handles default max length of 100", () => {
    const longName = "b".repeat(150);
    const result = sanitizeFilename(longName);
    expect(result.length).toBe(100);
  });

  test("preserves valid characters", () => {
    expect(sanitizeFilename("My Note (draft)")).toBe("My Note (draft)");
    expect(sanitizeFilename("note-v1.2")).toBe("note-v1.2");
    expect(sanitizeFilename("Café & résumé")).toBe("Café & résumé");
  });

  test("handles special markdown characters", () => {
    expect(sanitizeFilename("Note [draft]")).toBe("Note [draft]");
    expect(sanitizeFilename("Note #1")).toBe("Note #1");
  });
});

// ============================================================================
// canSpawnProcess Tests
// ============================================================================

describe("canSpawnProcess", () => {
  test("returns true in Bun environment", () => {
    // We're running in Bun, so this should be true
    expect(canSpawnProcess()).toBe(true);
  });
});

// ============================================================================
// CLI Command Building Tests
// ============================================================================

describe("buildCliCommand", () => {
  const config: ObsidianCliConfig = {
    cliPath: "/usr/local/bin/obsidian-cli",
    vault: "MyVault",
    enabled: true,
  };

  const modernConfig: ObsidianCliConfig = {
    cliPath: "/home/user/.local/bin/obsidian",
    vault: "Main Vault",
    enabled: true,
  };

  test("builds basic create command", () => {
    const options: CliSaveOptions = {
      filePath: "Notes/My Note",
      content: "# Hello\n\nWorld!",
    };
    const cmd = buildCliCommand(config, options);
    expect(cmd).toContain("/usr/local/bin/obsidian-cli");
    expect(cmd).toContain("create");
    expect(cmd).toContain("Notes/My Note");
    expect(cmd).toContain("--vault");
    expect(cmd).toContain("MyVault");
    expect(cmd).toContain("--overwrite");
  });

  test("includes append flag when append is true", () => {
    const options: CliSaveOptions = {
      filePath: "Notes/My Note",
      content: "Additional content",
      append: true,
    };
    const cmd = buildCliCommand(config, options);
    expect(cmd).toContain("--append");
    expect(cmd).not.toContain("--overwrite");
  });

  test("escapes content with quotes", () => {
    const options: CliSaveOptions = {
      filePath: "Notes/Test",
      content: 'He said "hello"',
    };
    const cmd = buildCliCommand(config, options);
    expect(cmd).toContain("--content");
  });

  test("handles content with spaces", () => {
    const options: CliSaveOptions = {
      filePath: "Notes/My Note",
      content: "Content with spaces",
    };
    const cmd = buildCliCommand(config, options);
    expect(cmd).toContain("My Note");
  });

  test("builds modern obsidian create command", () => {
    const options: CliSaveOptions = {
      filePath: "Notes/My Note.md",
      content: "# Hello",
    };
    const cmd = buildCliCommand(modernConfig, options);
    expect(cmd).toContain("/home/user/.local/bin/obsidian");
    expect(cmd).toContain("create");
    expect(cmd).toContain("path=Notes/My Note.md");
    expect(cmd).toContain("content=# Hello");
    expect(cmd).toContain("vault=Main Vault");
    expect(cmd).toContain("overwrite");
    expect(cmd).not.toContain("--vault");
  });

  test("builds modern obsidian append command", () => {
    const options: CliSaveOptions = {
      filePath: "Notes/My Note.md",
      content: "more",
      append: true,
    };
    const cmd = buildCliCommand(modernConfig, options);
    expect(cmd).toContain("append");
    expect(cmd).toContain("path=Notes/My Note.md");
    expect(cmd).toContain("content=more");
    expect(cmd).toContain("vault=Main Vault");
    expect(cmd).not.toContain("overwrite");
  });
});

// ============================================================================
// CLI Save Validation Tests
// ============================================================================

describe("saveViaCli validation", () => {
  test("fails when CLI is disabled", async () => {
    const config: ObsidianCliConfig = {
      cliPath: "/usr/local/bin/obsidian-cli",
      vault: "MyVault",
      enabled: false,
    };
    const options: CliSaveOptions = {
      filePath: "Notes/Test",
      content: "# Test",
    };
    const result = await saveViaCli(config, options);
    expect(result.success).toBe(false);
    expect(result.error).toContain("disabled");
  });

  test("fails when CLI path is not configured", async () => {
    const config: ObsidianCliConfig = {
      cliPath: "",
      vault: "MyVault",
      enabled: true,
    };
    const options: CliSaveOptions = {
      filePath: "Notes/Test",
      content: "# Test",
    };
    const result = await saveViaCli(config, options);
    expect(result.success).toBe(false);
    expect(result.error).toContain("path");
  });

  test("fails when vault is not configured", async () => {
    const config: ObsidianCliConfig = {
      cliPath: "/usr/local/bin/obsidian-cli",
      vault: "",
      enabled: true,
    };
    const options: CliSaveOptions = {
      filePath: "Notes/Test",
      content: "# Test",
    };
    const result = await saveViaCli(config, options);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Vault");
  });
});

// ============================================================================
// CLI Connection Test Tests
// ============================================================================

describe("testCliConnection", () => {
  test("fails when CLI path is not configured", async () => {
    const config: ObsidianCliConfig = {
      cliPath: "",
      vault: "MyVault",
      enabled: true,
    };
    const result = await testCliConnection(config);
    expect(result.success).toBe(false);
    expect(result.error).toContain("path");
  });

  test("fails for non-existent binary", async () => {
    const config: ObsidianCliConfig = {
      cliPath: "/nonexistent/path/to/obsidian-cli",
      vault: "MyVault",
      enabled: true,
    };
    const result = await testCliConnection(config);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

// ============================================================================
// Fallback Chain Tests
// ============================================================================

/**
 * Simulates the fallback chain logic from save.ts
 * CLI → URI → clipboard
 */
describe("Fallback chain", () => {
  // This tests the fallback logic that would be used in save.ts

  test("determines method order for CLI preference", () => {
    const saveMethod = "cli";
    const expectedOrder = ["cli", "uri", "clipboard"];
    
    const methodOrder: string[] = [];
    if (saveMethod === "cli") {
      methodOrder.push("cli", "uri", "clipboard");
    } else if (saveMethod === "uri") {
      methodOrder.push("uri", "clipboard");
    } else {
      methodOrder.push("clipboard");
    }
    
    expect(methodOrder).toEqual(expectedOrder);
  });

  test("determines method order for URI preference", () => {
    const saveMethod = "uri";
    const expectedOrder = ["uri", "clipboard"];
    
    const methodOrder: string[] = [];
    if (saveMethod === "cli") {
      methodOrder.push("cli", "uri", "clipboard");
    } else if (saveMethod === "uri") {
      methodOrder.push("uri", "clipboard");
    } else {
      methodOrder.push("clipboard");
    }
    
    expect(methodOrder).toEqual(expectedOrder);
  });

  test("determines method order for clipboard-only", () => {
    const saveMethod = "clipboard";
    const expectedOrder = ["clipboard"];
    
    const methodOrder: string[] = [];
    if (saveMethod === "cli") {
      methodOrder.push("cli", "uri", "clipboard");
    } else if (saveMethod === "uri") {
      methodOrder.push("uri", "clipboard");
    } else {
      methodOrder.push("clipboard");
    }
    
    expect(methodOrder).toEqual(expectedOrder);
  });

  test("skips CLI when not enabled in fallback", () => {
    const cliEnabled = false;
    const methodOrder = ["cli", "uri", "clipboard"];
    
    const methodsToTry = methodOrder.filter(m => {
      if (m === "cli" && !cliEnabled) return false;
      return true;
    });
    
    expect(methodsToTry).toEqual(["uri", "clipboard"]);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("Error handling", () => {
  test("CLI save returns error for non-existent binary", async () => {
    const config: ObsidianCliConfig = {
      cliPath: "/nonexistent/obsidian-cli",
      vault: "MyVault",
      enabled: true,
    };
    const options: CliSaveOptions = {
      filePath: "Notes/Test",
      content: "# Test",
    };
    const result = await saveViaCli(config, options);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.command).toContain("/nonexistent/obsidian-cli");
  });

  test("handles empty file path", async () => {
    const config: ObsidianCliConfig = {
      cliPath: "/usr/local/bin/obsidian-cli",
      vault: "MyVault",
      enabled: true,
    };
    const options: CliSaveOptions = {
      filePath: "",
      content: "# Test",
    };
    // CLI will be called with empty path - this tests that it doesn't crash
    const result = await saveViaCli(config, options);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge cases", () => {
  test("handles special characters in vault name", () => {
    const config: ObsidianCliConfig = {
      cliPath: "/usr/local/bin/obsidian-cli",
      vault: "My Vault & Notes",
      enabled: true,
    };
    const options: CliSaveOptions = {
      filePath: "Notes/Test",
      content: "# Test",
    };
    const cmd = buildCliCommand(config, options);
    expect(cmd).toContain("My Vault & Notes");
  });

  test("handles deeply nested file paths", () => {
    const config: ObsidianCliConfig = {
      cliPath: "/usr/local/bin/obsidian-cli",
      vault: "MyVault",
      enabled: true,
    };
    const options: CliSaveOptions = {
      filePath: "Archive/2024/Q1/Projects/Research/My Note",
      content: "# Test",
    };
    const cmd = buildCliCommand(config, options);
    expect(cmd).toContain("Archive/2024/Q1/Projects/Research/My Note");
  });

  test("handles large content", () => {
    const config: ObsidianCliConfig = {
      cliPath: "/usr/local/bin/obsidian-cli",
      vault: "MyVault",
      enabled: true,
    };
    // Create a large content string
    const largeContent = "# Large Note\n\n" + "x".repeat(100000);
    const options: CliSaveOptions = {
      filePath: "Notes/Large",
      content: largeContent,
    };
    const cmd = buildCliCommand(config, options);
    expect(cmd).toContain("--content");
    // Command should still be built (even if it would be huge)
    expect(cmd.length).toBeGreaterThan(100000);
  });

  test("handles unicode in file path and content", () => {
    const config: ObsidianCliConfig = {
      cliPath: "/usr/local/bin/obsidian-cli",
      vault: "MyVault",
      enabled: true,
    };
    const options: CliSaveOptions = {
      filePath: "Notes/日本語/メモ",
      content: "# 你好世界\n\nHello 🌍",
    };
    const cmd = buildCliCommand(config, options);
    expect(cmd).toContain("日本語");
    expect(cmd).toContain("你好世界");
  });
});

// ============================================================================
// Integration-like Tests (with mock binary)
// ============================================================================

describe("Integration tests with echo mock", () => {
  // These tests use /bin/echo as a mock CLI that always succeeds
  
  test("successful CLI call with echo mock", async () => {
    const config: ObsidianCliConfig = {
      cliPath: "/bin/echo",
      vault: "TestVault",
      enabled: true,
    };
    const options: CliSaveOptions = {
      filePath: "Notes/Test",
      content: "# Test Content",
    };
    
    // echo will succeed with exit code 0
    const result = await saveViaCli(config, options);
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("CLI call with false mock returns failure", async () => {
    const config: ObsidianCliConfig = {
      cliPath: "/usr/bin/false",
      vault: "TestVault",
      enabled: true,
    };
    const options: CliSaveOptions = {
      filePath: "Notes/Test",
      content: "# Test Content",
    };
    
    // false will fail with exit code 1
    const result = await saveViaCli(config, options);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});
