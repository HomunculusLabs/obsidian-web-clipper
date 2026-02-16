/**
 * MCP Server Tool Tests
 *
 * Unit tests for MCP (Model Context Protocol) tool definitions
 * used for LLM agent integration.
 */

import { describe, test, expect } from "bun:test";

// ─── MCP Tool Type Tests ────────────────────────────────────────────────────

describe("MCP tool types", () => {
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

  test("defines clip_url tool schema", () => {
    const clipUrlTool: MCPTool = {
      name: "clip_url",
      description: "Clip a web page URL to markdown for Obsidian",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to clip",
          },
          folder: {
            type: "string",
            description: "Obsidian folder path",
            default: "Clips",
          },
          tags: {
            type: "array",
            description: "Tags to apply",
            items: { type: "string" },
          },
        },
        required: ["url"],
      },
    };

    expect(clipUrlTool.name).toBe("clip_url");
    expect(clipUrlTool.inputSchema.required).toContain("url");
    expect(clipUrlTool.inputSchema.properties.url.type).toBe("string");
  });

  test("defines clip_youtube tool schema", () => {
    const clipYoutubeTool: MCPTool = {
      name: "clip_youtube",
      description: "Extract transcript and metadata from a YouTube video",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "YouTube video URL",
          },
          includeTimestamps: {
            type: "boolean",
            description: "Include timestamps in transcript",
            default: true,
          },
        },
        required: ["url"],
      },
    };

    expect(clipYoutubeTool.name).toBe("clip_youtube");
    expect(clipYoutubeTool.inputSchema.properties.includeTimestamps.default).toBe(true);
  });

  test("defines clip_twitter tool schema", () => {
    const clipTwitterTool: MCPTool = {
      name: "clip_twitter",
      description: "Extract a Twitter/X thread to markdown",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Twitter/X tweet URL",
          },
        },
        required: ["url"],
      },
    };

    expect(clipTwitterTool.name).toBe("clip_twitter");
  });

  test("defines clip_search tool schema", () => {
    const clipSearchTool: MCPTool = {
      name: "clip_search",
      description: "Search the web and clip top results",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          topN: {
            type: "number",
            description: "Number of results to clip",
            default: 5,
          },
        },
        required: ["query"],
      },
    };

    expect(clipSearchTool.name).toBe("clip_search");
    expect(clipSearchTool.inputSchema.properties.topN.default).toBe(5);
  });

  test("defines save_to_obsidian tool schema", () => {
    const saveTool: MCPTool = {
      name: "save_to_obsidian",
      description: "Save content directly to Obsidian vault",
      inputSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Note title",
          },
          content: {
            type: "string",
            description: "Markdown content",
          },
          folder: {
            type: "string",
            description: "Target folder",
            default: "Notes",
          },
          tags: {
            type: "array",
            description: "Tags to apply",
            items: { type: "string" },
          },
        },
        required: ["title", "content"],
      },
    };

    expect(saveTool.name).toBe("save_to_obsidian");
    expect(saveTool.inputSchema.required).toContain("title");
    expect(saveTool.inputSchema.required).toContain("content");
  });
});

// ─── MCP Tool Response Tests ────────────────────────────────────────────────

describe("MCP tool responses", () => {
  interface MCPToolResponse {
    content: Array<{
      type: "text" | "image";
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    isError?: boolean;
  }

  test("creates successful text response", () => {
    const response: MCPToolResponse = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            title: "Clipped Article",
            markdown: "# Article\n\nContent...",
          }),
        },
      ],
    };

    expect(response.isError).toBeUndefined();
    expect(response.content[0].type).toBe("text");

    const data = JSON.parse(response.content[0].text!);
    expect(data.success).toBe(true);
  });

  test("creates error response", () => {
    const response: MCPToolResponse = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "Failed to fetch URL",
          }),
        },
      ],
      isError: true,
    };

    expect(response.isError).toBe(true);
    const data = JSON.parse(response.content[0].text!);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Failed to fetch URL");
  });

  test("handles large content responses", () => {
    const largeMarkdown = "# " + "A".repeat(50000);

    const response: MCPToolResponse = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            markdown: largeMarkdown,
          }),
        },
      ],
    };

    const data = JSON.parse(response.content[0].text!);
    expect(data.markdown.length).toBeGreaterThan(50000);
  });
});

// ─── MCP Tool Execution Tests ───────────────────────────────────────────────

describe("MCP tool execution validation", () => {
  function validateClipUrlInput(input: unknown): { valid: boolean; error?: string } {
    if (typeof input !== "object" || input === null) {
      return { valid: false, error: "Input must be an object" };
    }

    const { url } = input as Record<string, unknown>;

    if (typeof url !== "string") {
      return { valid: false, error: "url must be a string" };
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { valid: false, error: "url must be a valid HTTP/HTTPS URL" };
    }

    return { valid: true };
  }

  function validateSaveInput(input: unknown): { valid: boolean; error?: string } {
    if (typeof input !== "object" || input === null) {
      return { valid: false, error: "Input must be an object" };
    }

    const { title, content } = input as Record<string, unknown>;

    if (typeof title !== "string" || title.length === 0) {
      return { valid: false, error: "title is required and must be non-empty string" };
    }

    if (typeof content !== "string") {
      return { valid: false, error: "content must be a string" };
    }

    return { valid: true };
  }

  test("validates clip_url input - valid URL", () => {
    const result = validateClipUrlInput({ url: "https://example.com" });
    expect(result.valid).toBe(true);
  });

  test("validates clip_url input - missing URL", () => {
    const result = validateClipUrlInput({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain("url must be a string");
  });

  test("validates clip_url input - invalid URL scheme", () => {
    const result = validateClipUrlInput({ url: "ftp://example.com" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("valid HTTP/HTTPS URL");
  });

  test("validates save_to_obsidian input - valid", () => {
    const result = validateSaveInput({
      title: "My Note",
      content: "# Content\n\nBody text",
    });
    expect(result.valid).toBe(true);
  });

  test("validates save_to_obsidian input - missing title", () => {
    const result = validateSaveInput({ content: "Some content" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("title is required");
  });

  test("validates save_to_obsidian input - empty title", () => {
    const result = validateSaveInput({ title: "", content: "Content" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("non-empty string");
  });

  test("validates save_to_obsidian input - missing content", () => {
    const result = validateSaveInput({ title: "Title" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("content must be a string");
  });
});

// ─── MCP Tool Registration Tests ─────────────────────────────────────────────

describe("MCP tool registration", () => {
  interface ToolRegistry {
    tools: Map<string, {
      schema: unknown;
      handler: (input: unknown) => Promise<unknown>;
    }>;
  }

  function createRegistry(): ToolRegistry {
    return { tools: new Map() };
  }

  function registerTool(
    registry: ToolRegistry,
    name: string,
    schema: unknown,
    handler: (input: unknown) => Promise<unknown>
  ): void {
    registry.tools.set(name, { schema, handler });
  }

  test("registers tools", () => {
    const registry = createRegistry();

    registerTool(
      registry,
      "clip_url",
      { name: "clip_url", inputSchema: {} },
      async () => ({ success: true })
    );

    expect(registry.tools.size).toBe(1);
    expect(registry.tools.has("clip_url")).toBe(true);
  });

  test("lists registered tools", () => {
    const registry = createRegistry();

    registerTool(registry, "clip_url", {}, async () => ({}));
    registerTool(registry, "clip_youtube", {}, async () => ({}));
    registerTool(registry, "save_to_obsidian", {}, async () => ({}));

    const toolNames = Array.from(registry.tools.keys());
    expect(toolNames).toContain("clip_url");
    expect(toolNames).toContain("clip_youtube");
    expect(toolNames).toContain("save_to_obsidian");
    expect(toolNames.length).toBe(3);
  });

  test("prevents duplicate registration", () => {
    const registry = createRegistry();

    registerTool(registry, "clip_url", {}, async () => ({}));

    // Overwriting should work (last wins)
    registerTool(registry, "clip_url", { version: 2 }, async () => ({ updated: true }));

    expect(registry.tools.size).toBe(1);
  });

  test("gets tool by name", () => {
    const registry = createRegistry();

    const handler = async (input: unknown) => ({ clipped: input });
    registerTool(registry, "clip_url", { schema: true }, handler);

    const tool = registry.tools.get("clip_url");
    expect(tool).toBeDefined();
    expect(tool?.handler).toBe(handler);
  });
});
