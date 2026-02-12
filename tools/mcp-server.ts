#!/usr/bin/env bun
/**
 * MCP Server for Obsidian Web Clipper
 *
 * Implements the Model Context Protocol (MCP) to expose clipping tools
 * for AI agent integration. Uses stdio transport for communication.
 *
 * Usage:
 *   # Run the MCP server (typically called by an MCP client)
 *   bun run tools/mcp-server.ts
 *
 *   # The server communicates over stdio using JSON-RPC 2.0
 *   # AI clients like Claude Desktop can connect to this server
 *
 * Configuration example for Claude Desktop (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "obsidian-clipper": {
 *       "command": "bun",
 *       "args": ["run", "/path/to/tools/mcp-server.ts"]
 *     }
 *   }
 * }
 *
 * Available MCP Tools:
 *   - clip_url: Clip any URL to markdown
 *   - clip_search: Search Google and clip top results
 *   - save_to_obsidian: Save content directly to Obsidian
 *   - clip_youtube: Get YouTube video transcript
 *   - clip_twitter: Extract Twitter/X thread
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

// ─── MCP Protocol Types ──────────────────────────────────────────────────────

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      default?: unknown;
    }>;
    required?: string[];
  };
}

interface ToolCallResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

const TOOLS: MCPTool[] = [
  {
    name: "clip_url",
    description: "Clip any URL to markdown. Supports web pages, YouTube videos, and PDFs. Returns structured output with title, markdown content, and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to clip (web page, YouTube, or PDF)",
        },
        tags: {
          type: "string",
          description: "Comma-separated tags to add to the clip",
          default: "web-clip",
        },
        vault: {
          type: "string",
          description: "Obsidian vault name (if using --cli save)",
          default: "Main Vault",
        },
        folder: {
          type: "string",
          description: "Obsidian folder path (if using --cli save)",
          default: "Clips",
        },
        save_to_obsidian: {
          type: "boolean",
          description: "Whether to save directly to Obsidian via CLI",
          default: false,
        },
      },
      required: ["url"],
    },
  },
  {
    name: "clip_search",
    description: "Search Google for a query and clip the top N results. Useful for research and gathering multiple sources on a topic.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
        top_n: {
          type: "number",
          description: "Number of top results to clip",
          default: 5,
        },
        tags: {
          type: "string",
          description: "Comma-separated tags to add to clips",
          default: "research",
        },
        vault: {
          type: "string",
          description: "Obsidian vault name (if using --cli save)",
          default: "Main Vault",
        },
        folder: {
          type: "string",
          description: "Obsidian folder path (if using --cli save)",
          default: "Research",
        },
        save_to_obsidian: {
          type: "boolean",
          description: "Whether to save directly to Obsidian via CLI",
          default: false,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "save_to_obsidian",
    description: "Save content directly to Obsidian via the CLI. Creates a new note with the provided content.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Note title",
        },
        content: {
          type: "string",
          description: "Markdown content for the note",
        },
        folder: {
          type: "string",
          description: "Obsidian folder path",
          default: "Notes",
        },
        vault: {
          type: "string",
          description: "Obsidian vault name",
          default: "Main Vault",
        },
        tags: {
          type: "string",
          description: "Comma-separated tags",
          default: "",
        },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "clip_youtube",
    description: "Extract transcript from a YouTube video. Returns the full transcript with optional timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "YouTube video URL",
        },
        include_timestamps: {
          type: "boolean",
          description: "Include timestamps in transcript",
          default: true,
        },
        tags: {
          type: "string",
          description: "Comma-separated tags",
          default: "youtube,video",
        },
        save_to_obsidian: {
          type: "boolean",
          description: "Whether to save directly to Obsidian via CLI",
          default: false,
        },
      },
      required: ["url"],
    },
  },
  {
    name: "clip_twitter",
    description: "Extract a Twitter/X thread. Returns all tweets in the thread with metadata.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Twitter/X tweet URL (first tweet of thread)",
        },
        tags: {
          type: "string",
          description: "Comma-separated tags",
          default: "twitter,thread",
        },
        save_to_obsidian: {
          type: "boolean",
          description: "Whether to save directly to Obsidian via CLI",
          default: false,
        },
      },
      required: ["url"],
    },
  },
];

// ─── Tool Execution ──────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = resolve(__dirname);

/**
 * Run a CLI tool and capture its JSON output
 */
async function runTool(
  toolScript: string,
  args: string[]
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", ["run", toolScript, "--json", ...args], {
      cwd: TOOLS_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          // If not JSON, return raw output
          resolve({ raw: stdout, stderr });
        }
      } else if (stdout.trim()) {
        try {
          const result = JSON.parse(stdout);
          if (result.success === false) {
            reject(new Error(result.error || "Tool failed"));
          } else {
            resolve(result);
          }
        } catch {
          reject(new Error(stderr || `Tool exited with code ${code}`));
        }
      } else {
        reject(new Error(stderr || `Tool exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Handle clip_url tool call
 */
async function handleClipUrl(params: Record<string, unknown>): Promise<ToolCallResult> {
  const url = String(params.url || "");
  const tags = String(params.tags || "web-clip");
  const vault = String(params.vault || "Main Vault");
  const folder = String(params.folder || "Clips");
  const saveToObsidian = Boolean(params.save_to_obsidian);

  const args = ["--tags", tags];
  if (saveToObsidian) {
    args.push("--cli", "--vault", vault, "--folder", folder);
  }

  try {
    const result = await runTool(resolve(TOOLS_DIR, "clip-url.ts"), [...args, url]);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handle clip_search tool call
 */
async function handleClipSearch(params: Record<string, unknown>): Promise<ToolCallResult> {
  const query = String(params.query || "");
  const topN = Number(params.top_n || 5);
  const tags = String(params.tags || "research");
  const vault = String(params.vault || "Main Vault");
  const folder = String(params.folder || "Research");
  const saveToObsidian = Boolean(params.save_to_obsidian);

  const args = [
    "--query", query,
    "--top", String(topN),
    "--tags", tags,
  ];
  if (saveToObsidian) {
    args.push("--cli", "--vault", vault, "--folder", folder);
  }

  try {
    const result = await runTool(resolve(TOOLS_DIR, "search-clip.ts"), args);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handle save_to_obsidian tool call
 */
async function handleSaveToObsidian(params: Record<string, unknown>): Promise<ToolCallResult> {
  const title = String(params.title || "");
  const content = String(params.content || "");
  const folder = String(params.folder || "Notes");
  const vault = String(params.vault || "Main Vault");
  const tags = String(params.tags || "");

  const args = [
    "--title", title,
    "--folder", folder,
    "--vault", vault,
    "--cli",
  ];
  if (tags) {
    args.push("--tags", tags);
  }

  try {
    // Pass content via stdin
    const result = await new Promise<unknown>((resolve, reject) => {
      const proc = spawn("bun", ["run", resolve(TOOLS_DIR, "clip-stdin.ts"), ...args], {
        cwd: TOOLS_DIR,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.stdin.write(content);
      proc.stdin.end();

      proc.on("close", (code) => {
        if (code === 0 || stdout.trim()) {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            resolve({ success: true, message: "Saved to Obsidian" });
          }
        } else {
          reject(new Error(stderr || `Tool exited with code ${code}`));
        }
      });

      proc.on("error", reject);
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handle clip_youtube tool call
 */
async function handleClipYoutube(params: Record<string, unknown>): Promise<ToolCallResult> {
  const url = String(params.url || "");
  const includeTimestamps = params.include_timestamps !== false;
  const tags = String(params.tags || "youtube,video");
  const saveToObsidian = Boolean(params.save_to_obsidian);

  const args = ["--tags", tags];
  if (!includeTimestamps) {
    args.push("--no-timestamps");
  }
  if (saveToObsidian) {
    args.push("--cli");
  }

  try {
    const result = await runTool(resolve(TOOLS_DIR, "youtube-transcript.ts"), [...args, url]);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handle clip_twitter tool call
 */
async function handleClipTwitter(params: Record<string, unknown>): Promise<ToolCallResult> {
  const url = String(params.url || "");
  const tags = String(params.tags || "twitter,thread");
  const saveToObsidian = Boolean(params.save_to_obsidian);

  const args = ["--tags", tags];
  if (saveToObsidian) {
    args.push("--cli");
  }

  try {
    const result = await runTool(resolve(TOOLS_DIR, "twitter-clipper.ts"), [...args, url]);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
}

// ─── MCP Protocol Handler ────────────────────────────────────────────────────

/**
 * Send a JSON-RPC response to stdout
 */
function sendResponse(response: JSONRPCResponse): void {
  console.log(JSON.stringify(response));
}

/**
 * Handle incoming JSON-RPC request
 */
async function handleRequest(request: JSONRPCRequest): Promise<void> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case "initialize": {
        sendResponse({
          jsonrpc: "2.0",
          id: id ?? null,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "obsidian-web-clipper",
              version: "1.0.0",
            },
          },
        });
        break;
      }

      case "tools/list": {
        sendResponse({
          jsonrpc: "2.0",
          id: id ?? null,
          result: {
            tools: TOOLS,
          },
        });
        break;
      }

      case "tools/call": {
        const callParams = params as { name: string; arguments?: Record<string, unknown> };
        const toolName = callParams.name;
        const toolArgs = callParams.arguments || {};

        let result: ToolCallResult;

        switch (toolName) {
          case "clip_url":
            result = await handleClipUrl(toolArgs);
            break;
          case "clip_search":
            result = await handleClipSearch(toolArgs);
            break;
          case "save_to_obsidian":
            result = await handleSaveToObsidian(toolArgs);
            break;
          case "clip_youtube":
            result = await handleClipYoutube(toolArgs);
            break;
          case "clip_twitter":
            result = await handleClipTwitter(toolArgs);
            break;
          default:
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
                },
              ],
              isError: true,
            };
        }

        sendResponse({
          jsonrpc: "2.0",
          id: id ?? null,
          result,
        });
        break;
      }

      case "ping": {
        sendResponse({
          jsonrpc: "2.0",
          id: id ?? null,
          result: {},
        });
        break;
      }

      case "notifications/initialized": {
        // Notification, no response needed
        break;
      }

      default:
        sendResponse({
          jsonrpc: "2.0",
          id: id ?? null,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        });
    }
  } catch (error) {
    sendResponse({
      jsonrpc: "2.0",
      id: id ?? null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : "Internal error",
      },
    });
  }
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Start the MCP server
 */
function main(): void {
  // Log startup to stderr (stdout is for JSON-RPC)
  console.error("Obsidian Web Clipper MCP Server starting...");
  console.error("Available tools:", TOOLS.map((t) => t.name).join(", "));

  // Read JSON-RPC messages from stdin
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr, // We don't write to stdout except for responses
    terminal: false,
  });

  rl.on("line", (line) => {
    if (!line.trim()) return;

    try {
      const request = JSON.parse(line) as JSONRPCRequest;
      handleRequest(request);
    } catch (error) {
      sendResponse({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error",
          data: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  rl.on("close", () => {
    console.error("MCP Server shutting down...");
    process.exit(0);
  });
}

// Run if executed directly
main();
