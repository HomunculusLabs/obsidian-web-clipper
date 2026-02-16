import { describe, test, expect } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type NativeResponse = {
  success: boolean;
  code?: string;
  error?: string;
  data?: Record<string, unknown>;
};

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const HOST_ENTRY = path.join(REPO_ROOT, "native-host", "host.ts");

function encodeFrame(body: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(body), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

function encodeRawFrame(rawBody: string): Buffer {
  const body = Buffer.from(rawBody, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

class NativeHostHarness {
  private pending = Buffer.alloc(0);
  private responses: NativeResponse[] = [];
  private waiters: Array<(value: NativeResponse) => void> = [];
  private stderrChunks: string[] = [];

  constructor(private readonly proc: ChildProcessWithoutNullStreams) {
    this.proc.stdout.on("data", (chunk: Buffer | string) => {
      const normalized = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.pending = Buffer.concat([this.pending, normalized]);

      while (this.pending.length >= 4) {
        const bodyLength = this.pending.readUInt32LE(0);
        const totalLength = 4 + bodyLength;

        if (this.pending.length < totalLength) {
          break;
        }

        const body = this.pending.subarray(4, totalLength);
        this.pending = this.pending.subarray(totalLength);

        const parsed = JSON.parse(body.toString("utf8")) as NativeResponse;
        const waiter = this.waiters.shift();
        if (waiter) {
          waiter(parsed);
        } else {
          this.responses.push(parsed);
        }
      }
    });

    this.proc.stderr.on("data", (chunk: Buffer | string) => {
      this.stderrChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk);
    });
  }

  sendRaw(buffer: Buffer): void {
    this.proc.stdin.write(buffer);
  }

  async request(message: Record<string, unknown>): Promise<NativeResponse> {
    this.sendRaw(encodeFrame(message));
    return await this.nextResponse();
  }

  async nextResponse(timeoutMs = 4000): Promise<NativeResponse> {
    const existing = this.responses.shift();
    if (existing) {
      return existing;
    }

    return await withTimeout(
      new Promise<NativeResponse>((resolve) => {
        this.waiters.push(resolve);
      }),
      timeoutMs,
      `Timed out waiting for native host response. stderr: ${this.stderr}`
    );
  }

  get stderr(): string {
    return this.stderrChunks.join("");
  }

  async close(): Promise<void> {
    if (this.proc.exitCode !== null) {
      return;
    }

    this.proc.stdin.end();

    try {
      await withTimeout(
        new Promise<void>((resolve) => {
          this.proc.once("exit", () => resolve());
        }),
        1500,
        "Timed out waiting for native host process exit"
      );
    } catch {
      this.proc.kill("SIGKILL");
    }
  }
}

async function startHost(extraEnv: NodeJS.ProcessEnv = {}): Promise<NativeHostHarness> {
  const proc = spawn(process.execPath, ["run", HOST_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  return new NativeHostHarness(proc);
}

type TestEnv = {
  tempDir: string;
  vaultPath: string;
  cliPath: string;
  cliLogPath: string;
  markerPath: string;
};

async function createTestEnv(): Promise<TestEnv> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "owc-native-host-test-"));
  const vaultPath = path.join(tempDir, "vault");
  const cliPath = path.join(tempDir, "mock-cli.cjs");
  const cliLogPath = path.join(tempDir, "mock-cli.log");
  const markerPath = path.join(tempDir, "injected-marker.txt");

  await mkdir(vaultPath, { recursive: true });

  const cliScript = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const logPath = process.env.MOCK_CLI_LOG;
if (logPath) {
  fs.appendFileSync(logPath, JSON.stringify(args) + "\\n");
}

if (args[0] === "--version") {
  console.log("obsidian-cli v9.9.9-test");
  process.exit(0);
}

if (args[0] === "print-default") {
  console.log(process.env.MOCK_CLI_DEFAULT_VAULT || "UnknownVault");
  process.exit(0);
}

if (args[0] === "create") {
  console.log("create ok");
  process.exit(0);
}

console.error("Unknown command");
process.exit(2);
`;

  await writeFile(cliPath, cliScript, "utf8");
  await chmod(cliPath, 0o755);

  return { tempDir, vaultPath, cliPath, cliLogPath, markerPath };
}

async function readCliCalls(logPath: string): Promise<string[][]> {
  try {
    const content = await readFile(logPath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  } catch {
    return [];
  }
}

describe("native host protocol", () => {
  test("handles chunked and concatenated length-prefixed frames", async () => {
    const env = await createTestEnv();
    const host = await startHost({
      MOCK_CLI_LOG: env.cliLogPath,
      MOCK_CLI_DEFAULT_VAULT: "MyVault",
    });

    try {
      const frameOne = encodeFrame({ action: "unknown-action-a" });
      const frameTwo = encodeFrame({ action: "unknown-action-b" });
      const combined = Buffer.concat([frameOne, frameTwo]);

      host.sendRaw(combined.subarray(0, 2));
      await Bun.sleep(5);
      host.sendRaw(combined.subarray(2, 11));
      await Bun.sleep(5);
      host.sendRaw(combined.subarray(11));

      const responseOne = await host.nextResponse();
      const responseTwo = await host.nextResponse();

      expect(responseOne.success).toBe(false);
      expect(responseOne.code).toBe("UNKNOWN_ACTION");
      expect(responseTwo.success).toBe(false);
      expect(responseTwo.code).toBe("UNKNOWN_ACTION");
    } finally {
      await host.close();
      await rm(env.tempDir, { recursive: true, force: true });
    }
  });
});

describe("native host action dispatch", () => {
  test("dispatches saveToCli, testCliConnection, listVaultFolders, createVaultFolder, and saveAttachmentToCli", async () => {
    const env = await createTestEnv();
    const host = await startHost({
      MOCK_CLI_LOG: env.cliLogPath,
      MOCK_CLI_DEFAULT_VAULT: "MyVault",
    });

    try {
      const saveResponse = await host.request({
        action: "saveToCli",
        payload: {
          cliPath: env.cliPath,
          vault: "MyVault",
          filePath: "../../notes/secure.md",
          content: "# Note",
        },
      });

      expect(saveResponse.success).toBe(true);
      expect(saveResponse.data?.filePath).toBe("notes/secure.md");

      const cliCallsAfterSave = await readCliCalls(env.cliLogPath);
      expect(cliCallsAfterSave.length).toBeGreaterThanOrEqual(1);
      expect(cliCallsAfterSave[0]?.[0]).toBe("create");
      expect(cliCallsAfterSave[0]?.[1]).toBe("notes/secure.md");

      const cliConnectionResponse = await host.request({
        action: "testCliConnection",
        payload: {
          cliPath: env.cliPath,
          vault: "MyVault",
        },
      });

      expect(cliConnectionResponse.success).toBe(true);
      expect(cliConnectionResponse.data?.version).toBe("9.9.9-test");
      expect(cliConnectionResponse.data?.vaultAccessible).toBe(true);

      await mkdir(path.join(env.vaultPath, "Articles", "Tech"), { recursive: true });
      await mkdir(path.join(env.vaultPath, ".obsidian"), { recursive: true });

      const listResponse = await host.request({
        action: "listVaultFolders",
        payload: {
          cliPath: env.cliPath,
          vault: "MyVault",
          vaultPath: env.vaultPath,
        },
      });

      expect(listResponse.success).toBe(true);
      expect(listResponse.data?.folders).toEqual(["Articles", "Articles/Tech"]);

      const createFolderResponse = await host.request({
        action: "createVaultFolder",
        payload: {
          cliPath: env.cliPath,
          vault: "MyVault",
          vaultPath: env.vaultPath,
          folderPath: "Projects/NativeHost",
        },
      });

      expect(createFolderResponse.success).toBe(true);
      await expect(stat(path.join(env.vaultPath, "Projects", "NativeHost"))).resolves.toBeDefined();

      const attachmentResponse = await host.request({
        action: "saveAttachmentToCli",
        payload: {
          cliPath: env.cliPath,
          vault: "MyVault",
          vaultPath: env.vaultPath,
          filePath: "Attachments/example.txt",
          base64Data: Buffer.from("hello from attachment", "utf8").toString("base64"),
          mimeType: "text/plain",
        },
      });

      expect(attachmentResponse.success).toBe(true);
      const attachmentPath = path.join(env.vaultPath, "Attachments", "example.txt");
      await expect(readFile(attachmentPath, "utf8")).resolves.toBe("hello from attachment");
    } finally {
      await host.close();
      await rm(env.tempDir, { recursive: true, force: true });
    }
  });
});

describe("native host error handling", () => {
  test("returns structured errors for invalid JSON, unknown action, and missing fields", async () => {
    const env = await createTestEnv();
    const host = await startHost({ MOCK_CLI_LOG: env.cliLogPath });

    try {
      host.sendRaw(encodeRawFrame("this is not json"));
      const invalidJsonResponse = await host.nextResponse();
      expect(invalidJsonResponse.success).toBe(false);
      expect(invalidJsonResponse.code).toBe("INVALID_REQUEST");

      const unknownActionResponse = await host.request({ action: "totally-unknown" });
      expect(unknownActionResponse.success).toBe(false);
      expect(unknownActionResponse.code).toBe("UNKNOWN_ACTION");

      const missingFieldsResponse = await host.request({
        action: "createVaultFolder",
        payload: {
          cliPath: env.cliPath,
          vault: "MyVault",
          vaultPath: env.vaultPath,
        },
      });

      expect(missingFieldsResponse.success).toBe(false);
      expect(missingFieldsResponse.code).toBe("INVALID_FOLDER_PATH");
    } finally {
      await host.close();
      await rm(env.tempDir, { recursive: true, force: true });
    }
  });
});

describe("native host attachment decode and shell-injection guard", () => {
  test("decodes base64 attachment bytes exactly", async () => {
    const env = await createTestEnv();
    const host = await startHost({ MOCK_CLI_LOG: env.cliLogPath });

    try {
      const expectedBytes = Buffer.from([0x00, 0xff, 0x7f, 0x41, 0x42, 0x43]);

      const response = await host.request({
        action: "saveAttachmentToCli",
        payload: {
          cliPath: env.cliPath,
          vault: "MyVault",
          vaultPath: env.vaultPath,
          filePath: "Attachments/binary.bin",
          base64Data: expectedBytes.toString("base64"),
          mimeType: "application/octet-stream",
        },
      });

      expect(response.success).toBe(true);

      const savedBytes = await readFile(path.join(env.vaultPath, "Attachments", "binary.bin"));
      expect(Buffer.compare(savedBytes, expectedBytes)).toBe(0);
    } finally {
      await host.close();
      await rm(env.tempDir, { recursive: true, force: true });
    }
  });

  test("does not execute shell metacharacters embedded in filePath", async () => {
    const env = await createTestEnv();
    const host = await startHost({ MOCK_CLI_LOG: env.cliLogPath });

    try {
      const maliciousPath = `safe.md;touch ${env.markerPath}`;

      const response = await host.request({
        action: "saveToCli",
        payload: {
          cliPath: env.cliPath,
          vault: "MyVault",
          filePath: maliciousPath,
          content: "# harmless",
        },
      });

      expect(response.success).toBe(true);

      await expect(access(env.markerPath)).rejects.toBeDefined();

      const calls = await readCliCalls(env.cliLogPath);
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]?.[1]).toContain(";touch ");
    } finally {
      await host.close();
      await rm(env.tempDir, { recursive: true, force: true });
    }
  });
});
