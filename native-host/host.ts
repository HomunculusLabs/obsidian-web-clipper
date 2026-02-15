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

async function handleSaveToCli(_payload: Record<string, unknown>): Promise<NativeResponse> {
  return {
    success: false,
    code: "NOT_IMPLEMENTED",
    error: "saveToCli is not implemented yet"
  };
}

async function handleSaveAttachmentToCli(
  _payload: Record<string, unknown>
): Promise<NativeResponse> {
  return {
    success: false,
    code: "NOT_IMPLEMENTED",
    error: "saveAttachmentToCli is not implemented yet"
  };
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
