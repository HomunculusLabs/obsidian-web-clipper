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

function usesModernObsidianCli(cliPath: string): boolean {
  const normalized = cliPath.trim().toLowerCase();
  const slashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const commandName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  return commandName === "obsidian" || commandName === "obsidian.exe";
}

function buildSaveArgs(
  cliPath: string,
  filePath: string,
  content: string,
  vault: string,
  overwrite: boolean,
  append: boolean
): string[] {
  if (usesModernObsidianCli(cliPath)) {
    if (append) {
      return ["append", `path=${filePath}`, `content=${content}`, `vault=${vault}`];
    }

    const args = ["create", `path=${filePath}`, `content=${content}`, `vault=${vault}`];
    if (overwrite) {
      args.push("overwrite");
    }
    return args;
  }

  const args = ["create", filePath, "--content", content, "--vault", vault];
  if (append) {
    args.push("--append");
  } else if (overwrite) {
    args.push("--overwrite");
  }
  return args;
}

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

  // Build command arguments for either legacy obsidian-cli or modern obsidian CLI.
  const args = buildSaveArgs(cliPath, filePath, content, vault, overwrite, append);

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
    
    const runCommand = async (args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> => {
      return await new Promise((resolve) => {
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
          resolve({ stdout: "", stderr: err.message, code: null });
        });

        proc.on("close", (code) => {
          resolve({ stdout, stderr, code });
        });
      });
    };

    const versionAttempts = usesModernObsidianCli(cliPath)
      ? [["version"], ["--version"]]
      : [["--version"], ["version"]];

    let versionResult: { stdout: string; stderr: string; code: number | null } | null = null;
    let versionCommand = "";

    for (const args of versionAttempts) {
      const result = await runCommand(args);
      versionResult = result;
      versionCommand = `${cliPath} ${args.join(" ")}`;
      if (result.code === 0 || result.code === null) {
        break;
      }
    }

    if (!versionResult || versionResult.code === null) {
      return {
        success: false,
        error: `CLI not found or not executable: ${versionResult?.stderr || "unknown error"}`
      };
    }

    if (versionResult.code !== 0) {
      return {
        success: false,
        error: versionResult.stderr.trim() || `CLI test failed with code ${versionResult.code}`
      };
    }

    const version = versionResult.stdout.trim();
    const result: CliSaveResult = {
      success: true,
      command: versionCommand,
      error: version ? `CLI version: ${version}` : undefined
    };

    if (result.success && vault) {
      const vaultAttempts = usesModernObsidianCli(cliPath)
        ? [["vaults"], ["print-default"]]
        : [["print-default"], ["vaults"]];

      let vaultVerified = false;
      let attemptedVaultCheck = false;

      for (const args of vaultAttempts) {
        const vaultResult = await runCommand(args);
        if (vaultResult.code === null) {
          continue;
        }
        if (vaultResult.code === 0) {
          attemptedVaultCheck = true;
          const output = `${vaultResult.stdout}\n${vaultResult.stderr}`.toLowerCase();
          vaultVerified = output.includes(vault.toLowerCase());
          break;
        }
      }

      if (attemptedVaultCheck && !vaultVerified) {
        return {
          success: true,
          command: versionCommand,
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

  const args = buildSaveArgs(cliPath, filePath, content, vault, overwrite, append);

  // Escape arguments for shell display
  const escapedArgs = args.map(arg => {
    if (arg.includes(" ") || arg.includes('"') || arg.includes("'")) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  });

  return `${cliPath} ${escapedArgs.join(" ")}`;
}
