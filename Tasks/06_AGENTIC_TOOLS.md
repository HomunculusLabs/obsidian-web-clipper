# Phase 6: Agentic CLI Tools (Tasks 69-88)

## Goal
Headless Puppeteer-based CLI tools for AI agent research pipelines. MCP server for direct LLM integration.

## Key Files to Create

### Core Library
- `tools/lib/clipper-core.ts` — Shared browser launch, page extraction (Task 69)
- `tools/lib/auth.ts` — Chrome profile + cookie management (Task 84)
- `tools/lib/config.ts` — `.webclipper.json` config file loader (Task 85)
- `tools/lib/output.ts` — Standardized `ToolOutput` format (Task 77)

### CLI Tools
- `tools/clip-url.ts` — Universal URL clipper (Task 70, builds on Task 9)
- `tools/batch-clip.ts` — Batch URL clipper with concurrency (Task 71)
- `tools/youtube-transcript.ts` — YouTube transcript extractor (Task 72)
- `tools/twitter-clipper.ts` — Twitter thread clipper (Task 73)
- `tools/search-clip.ts` — Google search → clip top N (Task 74)
- `tools/pdf-clip.ts` — PDF text extraction CLI (Task 75)
- `tools/scrape-site.ts` — Site crawler + clipper (Task 76)
- `tools/pipeline.ts` — Pipeline composition tool (Task 86)

### MCP Server
- `tools/mcp-server.ts` — MCP server entry point (Task 78)
- `tools/mcp/clip-url.ts` — clip_url tool (Task 79)
- `tools/mcp/clip-search.ts` — clip_search tool (Task 80)
- `tools/mcp/save-to-obsidian.ts` — save_to_obsidian tool (Task 81)
- `tools/mcp/clip-youtube.ts` — clip_youtube tool (Task 82)
- `tools/mcp/clip-twitter.ts` — clip_twitter tool (Task 83)

### Docs
- `docs/cli-tools.md` — Tool documentation (Task 87)

## Standardized ToolOutput Format
```typescript
interface ToolOutput {
  success: boolean;
  url: string;
  title: string;
  markdown: string;
  metadata: ClipMetadata;
  tags: string[];
  error?: string;
  timing?: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
}
```

All tools output this format with `--json` flag. With `--stdout`, output raw markdown.

## Shared Clipper Core
Extract from `chatgpt-clipper.ts`:
- Browser launch with profile support
- Page navigation + wait strategies
- Content extraction via `page.evaluate()`
- Markdown conversion
- Frontmatter generation

## MCP Server Architecture
```
LLM Agent → MCP Protocol → tools/mcp-server.ts
                              ├── clip_url(url, options)
                              ├── clip_search(query, topN)
                              ├── save_to_obsidian(title, content, folder, tags)
                              ├── clip_youtube(url, timestamps)
                              └── clip_twitter(url)
```

## `.webclipper.json` Config
```json
{
  "vault": "Main Vault",
  "folder": "2 - Source Material/Clips",
  "tags": ["web-clip"],
  "chromeProfile": "~/.config/google-chrome/Default",
  "concurrency": 4,
  "timeout": 30000,
  "obsidianCli": "/usr/local/bin/obsidian"
}
```

## package.json Scripts to Add
```json
{
  "clip:url": "bun run tools/clip-url.ts",
  "clip:batch": "bun run tools/batch-clip.ts",
  "clip:youtube": "bun run tools/youtube-transcript.ts",
  "clip:twitter": "bun run tools/twitter-clipper.ts",
  "clip:search": "bun run tools/search-clip.ts",
  "clip:pdf": "bun run tools/pdf-clip.ts",
  "clip:scrape": "bun run tools/scrape-site.ts",
  "mcp": "bun run tools/mcp-server.ts"
}
```
