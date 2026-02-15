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
 * Basic path sanitization to prevent directory traversal
 * Removes null bytes, prevents .. traversal, normalizes slashes
 */
function sanitizePath(path: string): string {
  return path
    .replace(/\0/g, "")           // Remove null bytes
    .replace(/\.\./g, "")         // Prevent directory traversal
    .replace(/\/+/g, "/")         // Normalize multiple slashes
    .replace(/^\/+/, "")          // Remove leading slashes
    .trim();
}

async function handleSaveToCli(payload: Record<string, unknown>): Promise<NativeResponse> {
  // Extract and validate required fields
  const cliPath = payload.cliPath;
  const vault = payload.vault;
  const filePath = payload.filePath;
  const content = payload.content;
  const overwrite = payload.overwrite;

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

  // Build command arguments
  // obsidian-cli create <note> --content "..." --vault "..." [--overwrite]
  const args = [
    "create",
    sanitizedPath,
    "--content",
    content,
    "--vault",
    vault
  ];

  // Add overwrite flag (default true unless explicitly set to false)
  if (overwrite !== false) {
    args.push("--overwrite");
  }

  try {
    const { spawn } = await import("child_process");

    const result = await new Promise<NativeResponse>((resolve) => {
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
          // Extract meaningful error from stderr
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

    return result;
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
  _payload: Record<string, unknown>
): Promise<NativeResponse> {
  return {
    success: false,
    code: "NOT_IMPLEMENTED",
    error: "testCliConnection is not implemented yet"
  };
}

async function handleListVaultFolders(_payload: Record<string, unknown>): Promise<NativeResponse> {
  return {
    success: false,
    code: "NOT_IMPLEMENTED",
    error: "listVaultFolders is not implemented yet"
  };
}

async function handleCreateVaultFolder(_payload: Record<string, unknown>): Promise<NativeResponse> {
  return {
    success: false,
    code: "NOT_IMPLEMENTED",
    error: "createVaultFolder is not implemented yet"
  };
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
