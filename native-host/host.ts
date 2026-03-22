#!/usr/bin/env bun
/**
 * Chrome Native Messaging host entry point for Obsidian Web Clipper.
 *
 * Protocol:
 * - stdin:  4-byte LE uint32 length prefix + UTF-8 JSON message
 * - stdout: 4-byte LE uint32 length prefix + UTF-8 JSON response
 */

type NativeRequest = {
  action: string;
  payload?: Record<string, unknown>;
};

type NativeResponse = {
  success: boolean;
  error?: string;
  code?: string;
  data?: Record<string, unknown>;
};

type ActionHandler = (payload: Record<string, unknown>) => Promise<NativeResponse>;

function writeNativeMessage(response: NativeResponse): void {
  const json = Buffer.from(JSON.stringify(response), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}

function parseRequest(jsonBuffer: Buffer): NativeRequest | null {
  try {
    const parsed = JSON.parse(jsonBuffer.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const maybe = parsed as { action?: unknown; payload?: unknown };
    if (typeof maybe.action !== "string" || maybe.action.trim() === "") return null;

    const payload =
      maybe.payload && typeof maybe.payload === "object" && !Array.isArray(maybe.payload)
        ? (maybe.payload as Record<string, unknown>)
        : {};

    return { action: maybe.action, payload };
  } catch {
    return null;
  }
}

/**
 * Validate that a value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Basic path sanitization to prevent directory traversal.
 * Removes null bytes, strips ".." path segments (but leaves ".." inside
 * filenames like "foo..bar" intact), normalizes slashes.
 */
function sanitizePath(rawPath: string): string {
  const cleaned = rawPath
    .replace(/\0/g, "")           // Remove null bytes
    .replace(/\\/g, "/")          // Normalize backslashes to forward slashes
    .replace(/\/+/g, "/")         // Collapse multiple slashes
    .trim();

  // Split into segments, drop any that are exactly ".." (traversal),
  // but keep segments that merely contain ".." (e.g. "foo..bar").
  const segments = cleaned
    .split("/")
    .filter((seg) => seg !== ".." && seg !== ".");

  return segments
    .join("/")
    .replace(/^\/+/, "");         // Remove leading slashes
}

function usesModernObsidianCli(cliPath: string): boolean {
  const normalized = cliPath.trim().toLowerCase();
  const slashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const commandName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  return commandName === "obsidian" || commandName === "obsidian.exe";
}

function buildCreateArgs(cliPath: string, filePath: string, content: string, vault: string, overwrite: boolean): string[] {
  if (usesModernObsidianCli(cliPath)) {
    const args = ["create", `path=${filePath}`, `content=${content}`, `vault=${vault}`];
    if (overwrite) {
      args.push("overwrite");
    }
    return args;
  }

  const args = ["create", filePath, "--content", content, "--vault", vault];
  if (overwrite) {
    args.push("--overwrite");
  }
  return args;
}

async function handleSaveToCli(payload: Record<string, unknown>): Promise<NativeResponse> {
  // Extract and validate required fields
  const cliPath = payload.cliPath;
  const vault = payload.vault;
  const filePath = payload.filePath;
  const content = payload.content;
  const overwrite = payload.overwrite;
  const vaultPathOverride = payload.vaultPath;

  if (!isNonEmptyString(cliPath)) {
    return {
      success: false,
      code: "INVALID_CLI_PATH",
      error: "cliPath must be a non-empty string"
    };
  }

  if (!isNonEmptyString(vault)) {
    return {
      success: false,
      code: "INVALID_VAULT",
      error: "vault must be a non-empty string"
    };
  }

  if (!isNonEmptyString(filePath)) {
    return {
      success: false,
      code: "INVALID_FILE_PATH",
      error: "filePath must be a non-empty string"
    };
  }

  if (typeof content !== "string") {
    return {
      success: false,
      code: "INVALID_CONTENT",
      error: "content must be a string"
    };
  }

  // Sanitize the file path to prevent directory traversal
  const sanitizedPath = sanitizePath(filePath);
  if (!sanitizedPath) {
    return {
      success: false,
      code: "INVALID_FILE_PATH",
      error: "filePath resolves to an empty path after sanitization"
    };
  }

  // Extension sends note path without extension; write markdown files directly.
  const notePath = sanitizedPath.endsWith(".md") ? sanitizedPath : `${sanitizedPath}.md`;

  // NOTE:
  // We prefer direct filesystem writes over obsidian-cli --content because the
  // current obsidian-cli implementation is URI-backed and truncates at
  // characters like '&' in content payloads.

  async function saveViaCliProcess(): Promise<NativeResponse> {
    const args = buildCreateArgs(cliPath, sanitizedPath, content, vault, overwrite !== false);

    try {
      const { spawn } = await import("child_process");

      return await new Promise<NativeResponse>((resolve) => {
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
            code: "SPAWN_ERROR",
            error: `Failed to spawn CLI: ${err.message}`
          });
        });

        proc.on("close", (code) => {
          if (code === 0) {
            resolve({
              success: true,
              data: {
                filePath: sanitizedPath,
                vault
              }
            });
          } else {
            const errorMsg = stderr.trim() || stdout.trim() || `CLI exited with code ${code}`;
            resolve({
              success: false,
              code: "CLI_ERROR",
              error: errorMsg,
              data: {
                exitCode: code ?? undefined
              }
            });
          }
        });
      });
    } catch (err) {
      return {
        success: false,
        code: "EXECUTION_ERROR",
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  // Resolve vault path. If unavailable, fall back to cli process behavior for
  // compatibility with environments that rely on cli-only flow.
  const vaultResult = await resolveVaultPath(vault, isNonEmptyString(vaultPathOverride) ? vaultPathOverride : undefined);
  if ("error" in vaultResult) {
    return saveViaCliProcess();
  }

  const resolvedVaultPath = vaultResult.path;

  try {
    const path = await import("path");
    const fs = await import("fs");

    const normalizedVaultRoot = path.resolve(resolvedVaultPath);

    // Resolve and guard destination path to remain inside vault root
    const destinationPath = path.resolve(normalizedVaultRoot, notePath);
    const relativeToVault = path.relative(normalizedVaultRoot, destinationPath);

    if (relativeToVault.startsWith("..") || path.isAbsolute(relativeToVault)) {
      return {
        success: false,
        code: "INVALID_FILE_PATH",
        error: "File path escapes vault root"
      };
    }

    // Check that vault directory exists and is accessible
    try {
      const stat = await fs.promises.stat(normalizedVaultRoot);
      if (!stat.isDirectory()) {
        return {
          success: false,
          code: "VAULT_NOT_DIR",
          error: `Vault path "${normalizedVaultRoot}" is not a directory`
        };
      }
    } catch (statErr) {
      if ((statErr as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          success: false,
          code: "VAULT_NOT_FOUND",
          error: `Vault directory "${normalizedVaultRoot}" does not exist`
        };
      }
      if ((statErr as NodeJS.ErrnoException).code === "EACCES") {
        return {
          success: false,
          code: "VAULT_ACCESS_DENIED",
          error: `Permission denied accessing vault directory "${normalizedVaultRoot}"`
        };
      }
      throw statErr;
    }

    // Ensure parent directories exist
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });

    // Preserve overwrite semantics (default true unless explicitly false)
    if (overwrite === false) {
      try {
        await fs.promises.writeFile(destinationPath, content, { encoding: "utf8", flag: "wx" });
      } catch (writeErr) {
        if ((writeErr as NodeJS.ErrnoException).code === "EEXIST") {
          return {
            success: false,
            code: "FILE_EXISTS",
            error: `File already exists: ${notePath}`
          };
        }
        throw writeErr;
      }
    } else {
      await fs.promises.writeFile(destinationPath, content, "utf8");
    }

    return {
      success: true,
      data: {
        filePath: sanitizedPath,
        vault,
        writtenPath: destinationPath
      }
    };
  } catch (err) {
    return {
      success: false,
      code: "EXECUTION_ERROR",
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Resolve the filesystem path for a vault by name.
 * Reads Obsidian's obsidian.json config to find vault paths.
 * Accepts an optional vaultPath override.
 */
async function resolveVaultPath(
  vaultName: string,
  vaultPathOverride?: string
): Promise<{ path: string } | { error: string; code: string }> {
  // If vaultPath is explicitly provided, use it
  if (vaultPathOverride && vaultPathOverride.trim()) {
    return { path: vaultPathOverride.trim() };
  }

  // Try to resolve from Obsidian's config
  const os = await import("os");
  const path = await import("path");
  const fs = await import("fs");

  const homeDir = os.homedir();
  const platform = os.platform();

  // Obsidian config locations by platform
  let configDir: string;
  if (platform === "darwin") {
    configDir = path.join(homeDir, "Library", "Application Support", "obsidian");
  } else if (platform === "win32") {
    configDir = path.join(homeDir, "AppData", "Roaming", "obsidian");
  } else {
    // Linux and others
    configDir = path.join(homeDir, ".config", "obsidian");
  }

  const configPath = path.join(configDir, "obsidian.json");

  try {
    const configContent = await fs.promises.readFile(configPath, "utf8");
    const config = JSON.parse(configContent) as {
      vaults?: Record<string, { path?: string; name?: string }>;
    };

    if (config.vaults) {
      const normalizedRequestedName = vaultName.trim().toLowerCase();

      // Find vault by explicit name or by folder basename.
      for (const vaultId of Object.keys(config.vaults)) {
        const vault = config.vaults[vaultId];
        if (!vault.path) continue;

        const explicitName = (vault.name ?? "").trim().toLowerCase();
        const basenameName = path.basename(vault.path).trim().toLowerCase();

        if (explicitName === normalizedRequestedName || basenameName === normalizedRequestedName) {
          return { path: vault.path };
        }
      }

      // Fallback: if only one vault is configured, use it.
      const vaultEntries = Object.values(config.vaults);
      if (vaultEntries.length === 1 && vaultEntries[0]?.path) {
        return { path: vaultEntries[0].path };
      }
    }

    return {
      error: `Vault "${vaultName}" not found in Obsidian config at ${configPath}`,
      code: "VAULT_NOT_FOUND"
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        error: `Obsidian config not found at ${configPath}. Please provide vaultPath in the request.`,
        code: "CONFIG_NOT_FOUND"
      };
    }
    return {
      error: `Failed to read Obsidian config: ${err instanceof Error ? err.message : String(err)}`,
      code: "CONFIG_READ_ERROR"
    };
  }
}

async function handleSaveAttachmentToCli(
  payload: Record<string, unknown>
): Promise<NativeResponse> {
  // Extract and validate required fields
  const cliPath = payload.cliPath;
  const vault = payload.vault;
  const filePath = payload.filePath;
  const base64Data = payload.base64Data;
  const mimeType = payload.mimeType;
  const vaultPathOverride = payload.vaultPath;

  if (!isNonEmptyString(cliPath)) {
    return {
      success: false,
      code: "INVALID_CLI_PATH",
      error: "cliPath must be a non-empty string"
    };
  }

  if (!isNonEmptyString(vault)) {
    return {
      success: false,
      code: "INVALID_VAULT",
      error: "vault must be a non-empty string"
    };
  }

  if (!isNonEmptyString(filePath)) {
    return {
      success: false,
      code: "INVALID_FILE_PATH",
      error: "filePath must be a non-empty string"
    };
  }

  if (!isNonEmptyString(base64Data)) {
    return {
      success: false,
      code: "INVALID_DATA",
      error: "base64Data must be a non-empty string"
    };
  }

  // Sanitize the file path to prevent directory traversal
  const sanitizedPath = sanitizePath(filePath);
  if (!sanitizedPath) {
    return {
      success: false,
      code: "INVALID_FILE_PATH",
      error: "filePath resolves to an empty path after sanitization"
    };
  }

  // Resolve vault path
  const vaultResult = await resolveVaultPath(vault, isNonEmptyString(vaultPathOverride) ? vaultPathOverride : undefined);
  if ("error" in vaultResult) {
    return {
      success: false,
      code: vaultResult.code,
      error: vaultResult.error
    };
  }

  const resolvedVaultPath = vaultResult.path;

  try {
    const os = await import("os");
    const path = await import("path");
    const fs = await import("fs");

    // Decode base64 data
    let buffer: Buffer;
    try {
      // Handle data URL prefix if present (e.g., "data:image/png;base64,...")
      const base64String = base64Data.includes(",")
        ? (base64Data.split(",")[1] ?? "")
        : base64Data;
      buffer = Buffer.from(base64String, "base64");

      if (buffer.length === 0) {
        return {
          success: false,
          code: "DECODE_ERROR",
          error: "Decoded attachment content is empty"
        };
      }
    } catch (decodeErr) {
      return {
        success: false,
        code: "DECODE_ERROR",
        error: `Failed to decode base64 data: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}`
      };
    }

    // Resolve and guard destination path to remain inside vault root.
    const normalizedVaultRoot = path.resolve(resolvedVaultPath);
    const destinationPath = path.resolve(normalizedVaultRoot, sanitizedPath);
    const relativeToVault = path.relative(normalizedVaultRoot, destinationPath);

    if (
      relativeToVault.startsWith("..") ||
      path.isAbsolute(relativeToVault)
    ) {
      return {
        success: false,
        code: "INVALID_FILE_PATH",
        error: "Attachment path escapes vault root"
      };
    }

    const destinationDir = path.dirname(destinationPath);
    await fs.promises.mkdir(destinationDir, { recursive: true });

    // Write through a temp file first, then atomically rename into place.
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "owc-attach-"));
    const tempFile = path.join(tempDir, path.basename(sanitizedPath) || "attachment.bin");

    try {
      await fs.promises.writeFile(tempFile, buffer);
      await fs.promises.rename(tempFile, destinationPath);
    } finally {
      // Best-effort cleanup.
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }

    return {
      success: true,
      data: {
        filePath: sanitizedPath,
        savedPath: destinationPath,
        vault,
        mimeType: isNonEmptyString(mimeType) ? mimeType : undefined
      }
    };
  } catch (err) {
    return {
      success: false,
      code: "WRITE_ERROR",
      error: `Failed to write attachment: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

async function handleTestCliConnection(
  payload: Record<string, unknown>
): Promise<NativeResponse> {
  // Extract and validate required fields
  const cliPath = payload.cliPath;
  const vault = payload.vault;

  if (!isNonEmptyString(cliPath)) {
    return {
      success: false,
      code: "INVALID_CLI_PATH",
      error: "cliPath must be a non-empty string"
    };
  }

  if (!isNonEmptyString(vault)) {
    return {
      success: false,
      code: "INVALID_VAULT",
      error: "vault must be a non-empty string"
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
          resolve({
            stdout: "",
            stderr: err.message,
            code: null
          });
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
    for (const args of versionAttempts) {
      const result = await runCommand(args);
      if (result.code === 0) {
        versionResult = result;
        break;
      }
      if (result.code === null) {
        versionResult = result;
        break;
      }
      versionResult = result;
    }

    if (!versionResult || versionResult.code === null) {
      return {
        success: false,
        code: "CLI_SPAWN_ERROR",
        error: `Failed to spawn CLI at ${cliPath}: ${versionResult?.stderr || "unknown error"}`
      };
    }

    if (versionResult.code !== 0) {
      return {
        success: false,
        code: "CLI_ERROR",
        error: versionResult.stderr.trim() || `CLI exited with code ${versionResult.code}`,
        data: {
          exitCode: versionResult.code
        }
      };
    }

    const versionOutput = versionResult.stdout.trim();
    const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/);
    const version = versionMatch?.[1] ?? versionOutput.split("\n")[0]?.trim() ?? versionOutput;

    let vaultAccessible = false;
    const vaultAttempts = usesModernObsidianCli(cliPath)
      ? [["vaults"], ["print-default"]]
      : [["print-default"], ["vaults"]];

    for (const args of vaultAttempts) {
      const vaultCheckResult = await runCommand(args);
      if (vaultCheckResult.code === 0) {
        const output = `${vaultCheckResult.stdout}\n${vaultCheckResult.stderr}`.toLowerCase();
        if (output.includes(vault.toLowerCase())) {
          vaultAccessible = true;
        }
        break;
      }
      if (vaultCheckResult.code === null) {
        break;
      }
    }

    return {
      success: true,
      data: {
        version,
        cliVersion: version,
        vaultAccessible,
        rawVersionOutput: versionOutput
      }
    };
  } catch (err) {
    return {
      success: false,
      code: "EXECUTION_ERROR",
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

async function handleListVaultFolders(payload: Record<string, unknown>): Promise<NativeResponse> {
  // Extract and validate required fields
  const cliPath = payload.cliPath;
  const vault = payload.vault;
  const vaultPathOverride = payload.vaultPath;

  if (!isNonEmptyString(cliPath)) {
    return {
      success: false,
      code: "INVALID_CLI_PATH",
      error: "cliPath must be a non-empty string"
    };
  }

  if (!isNonEmptyString(vault)) {
    return {
      success: false,
      code: "INVALID_VAULT",
      error: "vault must be a non-empty string"
    };
  }

  // Resolve vault path
  const vaultResult = await resolveVaultPath(vault, isNonEmptyString(vaultPathOverride) ? vaultPathOverride : undefined);
  if ("error" in vaultResult) {
    return {
      success: false,
      code: vaultResult.code,
      error: vaultResult.error
    };
  }

  const resolvedVaultPath = vaultResult.path;

  try {
    const path = await import("path");
    const fs = await import("fs");

    const normalizedVaultRoot = path.resolve(resolvedVaultPath);

    // Check that vault directory exists and is accessible
    try {
      const stat = await fs.promises.stat(normalizedVaultRoot);
      if (!stat.isDirectory()) {
        return {
          success: false,
          code: "VAULT_NOT_DIR",
          error: `Vault path "${normalizedVaultRoot}" is not a directory`
        };
      }
    } catch (statErr) {
      if ((statErr as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          success: false,
          code: "VAULT_NOT_FOUND",
          error: `Vault directory "${normalizedVaultRoot}" does not exist`
        };
      }
      if ((statErr as NodeJS.ErrnoException).code === "EACCES") {
        return {
          success: false,
          code: "VAULT_ACCESS_DENIED",
          error: `Permission denied accessing vault directory "${normalizedVaultRoot}"`
        };
      }
      throw statErr;
    }

    // Recursively walk the vault directory and collect folder paths
    const folders: string[] = [];
    const hiddenPattern = /^\./; // Match hidden files/folders (starting with .)

    async function walkDirectory(dirPath: string, relativePath: string): Promise<void> {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      } catch (readErr) {
        // Skip directories we can't read (permission issues, etc.)
        console.error(`Warning: Could not read directory "${dirPath}": ${readErr}`);
        return;
      }

      for (const entry of entries) {
        // Skip hidden directories (like .obsidian, .trash, etc.)
        if (hiddenPattern.test(entry.name)) {
          continue;
        }

        if (entry.isDirectory()) {
          const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          folders.push(entryRelativePath);

          // Recurse into subdirectory
          const entryFullPath = path.join(dirPath, entry.name);
          await walkDirectory(entryFullPath, entryRelativePath);
        }
      }
    }

    await walkDirectory(normalizedVaultRoot, "");

    // Sort folders alphabetically for consistent ordering
    folders.sort((a, b) => a.localeCompare(b));

    return {
      success: true,
      data: {
        folders,
        vaultPath: normalizedVaultRoot
      }
    };
  } catch (err) {
    return {
      success: false,
      code: "EXECUTION_ERROR",
      error: `Failed to list vault folders: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

async function handleCreateVaultFolder(payload: Record<string, unknown>): Promise<NativeResponse> {
  // Extract and validate required fields
  const cliPath = payload.cliPath;
  const vault = payload.vault;
  const folderPath = payload.folderPath;
  const vaultPathOverride = payload.vaultPath;

  if (!isNonEmptyString(cliPath)) {
    return {
      success: false,
      code: "INVALID_CLI_PATH",
      error: "cliPath must be a non-empty string"
    };
  }

  if (!isNonEmptyString(vault)) {
    return {
      success: false,
      code: "INVALID_VAULT",
      error: "vault must be a non-empty string"
    };
  }

  if (!isNonEmptyString(folderPath)) {
    return {
      success: false,
      code: "INVALID_FOLDER_PATH",
      error: "folderPath must be a non-empty string"
    };
  }

  // Sanitize the folder path to prevent directory traversal
  const sanitizedPath = sanitizePath(folderPath);
  if (!sanitizedPath) {
    return {
      success: false,
      code: "INVALID_FOLDER_PATH",
      error: "folderPath resolves to an empty path after sanitization"
    };
  }

  // Resolve vault path
  const vaultResult = await resolveVaultPath(vault, isNonEmptyString(vaultPathOverride) ? vaultPathOverride : undefined);
  if ("error" in vaultResult) {
    return {
      success: false,
      code: vaultResult.code,
      error: vaultResult.error
    };
  }

  const resolvedVaultPath = vaultResult.path;

  try {
    const path = await import("path");
    const fs = await import("fs");

    const normalizedVaultRoot = path.resolve(resolvedVaultPath);

    // Resolve and guard destination path to remain inside vault root
    const destinationPath = path.resolve(normalizedVaultRoot, sanitizedPath);
    const relativeToVault = path.relative(normalizedVaultRoot, destinationPath);

    if (
      relativeToVault.startsWith("..") ||
      path.isAbsolute(relativeToVault)
    ) {
      return {
        success: false,
        code: "INVALID_FOLDER_PATH",
        error: "Folder path escapes vault root"
      };
    }

    // Check that vault directory exists and is accessible
    try {
      const stat = await fs.promises.stat(normalizedVaultRoot);
      if (!stat.isDirectory()) {
        return {
          success: false,
          code: "VAULT_NOT_DIR",
          error: `Vault path "${normalizedVaultRoot}" is not a directory`
        };
      }
    } catch (statErr) {
      if ((statErr as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          success: false,
          code: "VAULT_NOT_FOUND",
          error: `Vault directory "${normalizedVaultRoot}" does not exist`
        };
      }
      if ((statErr as NodeJS.ErrnoException).code === "EACCES") {
        return {
          success: false,
          code: "VAULT_ACCESS_DENIED",
          error: `Permission denied accessing vault directory "${normalizedVaultRoot}"`
        };
      }
      throw statErr;
    }

    // Create the directory with recursive option (equivalent to mkdir -p)
    await fs.promises.mkdir(destinationPath, { recursive: true });

    return {
      success: true,
      data: {
        folderPath: sanitizedPath,
        createdPath: destinationPath,
        vault
      }
    };
  } catch (err) {
    return {
      success: false,
      code: "EXECUTION_ERROR",
      error: `Failed to create vault folder: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

const handlers: Record<string, ActionHandler> = {
  saveToCli: handleSaveToCli,
  saveAttachmentToCli: handleSaveAttachmentToCli,
  testCliConnection: handleTestCliConnection,
  listVaultFolders: handleListVaultFolders,
  createVaultFolder: handleCreateVaultFolder
};

async function dispatch(request: NativeRequest): Promise<NativeResponse> {
  const handler = handlers[request.action];
  if (!handler) {
    return {
      success: false,
      code: "UNKNOWN_ACTION",
      error: `Unknown action: ${request.action}`
    };
  }

  try {
    return await handler(request.payload ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      code: "HANDLER_ERROR",
      error: message
    };
  }
}

async function main(): Promise<void> {
  let pending = Buffer.alloc(0);

  for await (const chunk of process.stdin) {
    pending = Buffer.concat([pending, Buffer.from(chunk)]);

    while (pending.length >= 4) {
      const bodyLength = pending.readUInt32LE(0);
      const totalLength = 4 + bodyLength;

      if (pending.length < totalLength) break;

      const body = pending.subarray(4, totalLength);
      pending = pending.subarray(totalLength);

      const request = parseRequest(body);
      if (!request) {
        writeNativeMessage({
          success: false,
          code: "INVALID_REQUEST",
          error: "Invalid native messaging request JSON"
        });
        continue;
      }

      const response = await dispatch(request);
      writeNativeMessage(response);
    }
  }

  // stdin EOF: exit cleanly
  if (pending.length > 0) {
    // Leftover bytes indicate a truncated/partial frame at EOF.
    // Log to stderr only (stdout is reserved for protocol frames).
    console.error("Native host received partial frame before EOF");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Native host fatal error: ${message}`);
  process.exit(1);
});
