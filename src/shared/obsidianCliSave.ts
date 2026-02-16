/**
 * Obsidian CLI Save Backend
 *
 * Provides functionality to save content to Obsidian via the obsidian-cli tool.
 * This module is designed to work in Node.js/Bun environments (CLI tools).
 *
 * For browser extension use, this must be called via a bridge mechanism
 * (Native Messaging host or local companion service) since MV3 service
 * workers cannot spawn local processes.
 */

import type { ObsidianCliConfig } from "./obsidianCli";

/**
 * Result of a CLI save operation
 */
export interface CliSaveResult {
  /** Whether the save operation succeeded */
  success: boolean;
  
  /** Error message if save failed */
  error?: string;
  
  /** The CLI command that was executed (for debugging) */
  command?: string;
  
  /** Exit code of the CLI process */
  exitCode?: number;
  
  /** Whether clipboard fallback was used */
  usedClipboardFallback?: boolean;
}

/**
 * Options for the CLI save operation
 */
export interface CliSaveOptions {
  /** Path to save the note (relative to vault root, without .md extension) */
  filePath: string;
  
  /** Markdown content to save */
  content: string;
  
  /** Whether to overwrite existing note (default: true) */
  overwrite?: boolean;
  
  /** Whether to append to existing note instead of overwriting */
  append?: boolean;
}

/**
 * Check if we're in a Node.js/Bun environment where we can spawn processes
 */
export function canSpawnProcess(): boolean {
  // Check if we have access to child_process (Node/Bun environment)
  // In browser/MV3 extension, this will be false
  try {
    // @ts-ignore - Bun global
    if (typeof Bun !== "undefined") return true;
    if (typeof process !== "undefined" && process.versions?.node) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Save content to Obsidian via the obsidian-cli tool
 *
 * @param config - CLI configuration (path, vault, enabled)
 * @param options - Save options (filePath, content, overwrite, append)
 * @returns Promise<CliSaveResult> indicating success/failure
 *
 * @example
 * ```ts
 * const result = await saveViaCli(
 *   { cliPath: "/opt/homebrew/bin/obsidian-cli", vault: "MyVault", enabled: true },
 *   { filePath: "Notes/My Note", content: "# Hello\n\nWorld!" }
 * );
 * ```
 */
export async function saveViaCli(
  config: ObsidianCliConfig,
  options: CliSaveOptions
): Promise<CliSaveResult> {
  const { cliPath, vault, enabled } = config;
  const { filePath, content, overwrite = true, append = false } = options;

  // Validate config
  if (!enabled) {
    return {
      success: false,
      error: "Obsidian CLI integration is disabled in settings"
    };
  }

  if (!cliPath) {
    return {
      success: false,
      error: "Obsidian CLI path is not configured"
    };
  }

  if (!vault) {
    return {
      success: false,
      error: "Vault name is not configured"
    };
  }

  // Check if we can spawn processes
  if (!canSpawnProcess()) {
    return {
      success: false,
      error: "Cannot spawn processes in current environment (browser/MV3). Use a bridge mechanism."
    };
  }

  // Build command arguments
  // obsidian-cli create <note> --content "..." --vault "..." [--overwrite | --append]
  const args = ["create", filePath];
  
  // Add content (escape quotes for shell safety)
  args.push("--content", content);
  args.push("--vault", vault);

  // Handle overwrite/append flags
  if (append) {
    args.push("--append");
  } else if (overwrite) {
    args.push("--overwrite");
  }

  try {
    // Dynamic import for Node.js/Bun environment only
    const { spawn } = await import("child_process");
    
    const result = await new Promise<CliSaveResult>((resolve) => {
      const proc = spawn(cliPath, args, {
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (err) => {
        resolve({
          success: false,
          error: `Failed to spawn obsidian-cli: ${err.message}`,
          command: `${cliPath} ${args.join(" ")}`
        });
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve({
            success: true,
            exitCode: code,
            command: `${cliPath} ${args.join(" ")}`
          });
        } else {
          // Extract meaningful error from stderr
          const errorMsg = stderr.trim() || stdout.trim() || `CLI exited with code ${code}`;
          resolve({
            success: false,
            error: errorMsg,
            exitCode: code ?? undefined,
            command: `${cliPath} ${args.join(" ")}`
          });
        }
      });
    });

    return result;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      command: `${cliPath} ${args.join(" ")}`
    };
  }
}

/**
 * Test the CLI connection by checking if the binary exists and is executable
 *
 * @param config - CLI configuration
 * @returns Promise<CliSaveResult> indicating if connection test passed
 */
export async function testCliConnection(config: ObsidianCliConfig): Promise<CliSaveResult> {
  const { cliPath, vault } = config;

  if (!cliPath) {
    return {
      success: false,
      error: "CLI path is not configured"
    };
  }

  if (!canSpawnProcess()) {
    return {
      success: false,
      error: "Cannot spawn processes in current environment"
    };
  }

  try {
    const { spawn } = await import("child_process");
    
    // Try to run `obsidian-cli --version` to verify the binary exists
    const result = await new Promise<CliSaveResult>((resolve) => {
      const proc = spawn(cliPath, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (err) => {
        resolve({
          success: false,
          error: `CLI not found or not executable: ${err.message}`
        });
      });

      proc.on("close", (code) => {
        if (code === 0) {
          const version = stdout.trim();
          resolve({
            success: true,
            command: `${cliPath} --version`,
            error: version ? `CLI version: ${version}` : undefined
          });
        } else {
          resolve({
            success: false,
            error: stderr.trim() || `CLI test failed with code ${code}`
          });
        }
      });
    });

    // If we have a vault configured, try to verify it exists
    if (result.success && vault) {
      // Use print-default to check if vault is configured
      const vaultTest = await new Promise<boolean>((resolve) => {
        const proc = spawn(cliPath, ["print-default"], {
          stdio: ["ignore", "pipe", "pipe"]
        });

        let output = "";
        proc.stdout?.on("data", (data) => {
          output += data.toString();
        });

        proc.on("close", () => {
          // If default is set or vault arg works, we're good
          resolve(true);
        });

        proc.on("error", () => {
          resolve(false);
        });
      });

      if (!vaultTest) {
        return {
          success: true,
          error: `CLI found but could not verify vault "${vault}". Ensure vault exists and is accessible.`
        };
      }
    }

    return result;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Build a CLI save command string for debugging or manual execution
 * Useful for showing the user what command would be run
 */
export function buildCliCommand(
  config: ObsidianCliConfig,
  options: CliSaveOptions
): string {
  const { cliPath, vault } = config;
  const { filePath, content, overwrite = true, append = false } = options;

  const args = ["create", filePath];
  args.push("--content", content);
  args.push("--vault", vault);

  if (append) {
    args.push("--append");
  } else if (overwrite) {
    args.push("--overwrite");
  }

  // Escape arguments for shell display
  const escapedArgs = args.map(arg => {
    if (arg.includes(" ") || arg.includes('"') || arg.includes("'")) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  });

  return `${cliPath} ${escapedArgs.join(" ")}`;
}
