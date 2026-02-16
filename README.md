# Obsidian Web Clipper

Obsidian Web Clipper is a TypeScript-based toolkit for turning web content into clean, Obsidian-friendly Markdown.

It includes:
- A Chrome Manifest V3 extension for interactive clipping
- A full CLI suite for headless and automated workflows
- A native messaging bridge for direct local Obsidian CLI saves
- An MCP server for AI agent integration

## Table of Contents

1. [What Is Included](#what-is-included)
2. [Tool Catalog](#tool-catalog)
3. [Quick Start](#quick-start)
4. [Development Commands](#development-commands)
5. [Configuration](#configuration)
6. [Repository Structure](#repository-structure)
7. [Documentation](#documentation)

## What Is Included

### 1) Browser Extension Runtime

The extension handles in-browser capture flows:
- Web page clipping (HTML to Markdown)
- YouTube extraction (including transcript support)
- PDF extraction (via offscreen support)
- Chat-oriented extraction modules (for supported chat pages)
- Popup UI and options UI for save and clipping preferences

Primary source directories:
- `src/background/`
- `src/content/`
- `src/popup/`
- `src/options/`
- `src/offscreen/`
- `src/shared/`

### 2) CLI Tooling

The `tools/` directory provides composable command-line tools for automation, pipelines, and agent workflows.

### 3) Integration Surfaces

- Native messaging host installer and bridge scripts in `native-host/`
- MCP server (`tools/mcp-server.ts`) for Model Context Protocol clients

## Tool Catalog

This section outlines all major tools in the repository.

### CLI Tools in `tools/`

| Tool | Entry | Script Alias | Purpose |
|---|---|---|---|
| URL Clipper | `tools/clip-url.ts` | `npm run clip:url` | Clip a single URL (web page, YouTube, PDF patterns) into Markdown |
| Stdin Clipper | `tools/clip-stdin.ts` | `npm run clip:stdin` | Save Markdown from stdin into clip output format |
| Batch Clipper | `tools/batch-clip.ts` | Direct file run | Clip many URLs concurrently |
| Search Clipper | `tools/search-clip.ts` | `npm run clip:search` | Search and clip top results in one flow |
| YouTube Transcript | `tools/youtube-transcript.ts` | Direct file run | Extract transcript and metadata from YouTube |
| Twitter/X Clipper | `tools/twitter-clipper.ts` | `npm run clip:twitter` | Extract tweet/thread content and metadata |
| ChatGPT Clipper | `tools/chatgpt-clipper.ts` | `npm run clip:chatgpt` | Extract ChatGPT conversation content |
| PDF Clipper | `tools/pdf-clip.ts` | `npm run clip:pdf` | Extract text from PDF URL or file |
| Site Scraper | `tools/scrape-site.ts` | `npm run clip:scrape` | Crawl and clip sites up to depth and page limits |
| Pipeline Runner | `tools/pipeline.ts` | `npm run pipeline` | Compose multi-step clipping workflows |
| MCP Server | `tools/mcp-server.ts` | `npm run mcp` | Expose clipping tools to MCP-compatible AI clients |
| PDF Worker | `tools/pdf-extract-worker.js` | Internal | Worker used by PDF extraction flows |

### Shared CLI Libraries in `tools/lib/`

| Library | Purpose |
|---|---|
| `tools/lib/clipper-core.ts` | Shared browser launch, extraction, markdown, logging, common options |
| `tools/lib/config.ts` | Config discovery, loading, and merge behavior |
| `tools/lib/auth.ts` | Shared auth/profile support for sites requiring login |

### Native Host Tooling

| Tool | Entry | Script Alias | Purpose |
|---|---|---|---|
| Native host installer (shell) | `native-host/install.sh` | `npm run native:install` | Install native messaging host for browser integration |
| Native host installer (Bun/TS) | `native-host/install.ts` | `npm run native:install:bun` | Bun-based host install path |
| Native host uninstall | `native-host/uninstall.sh` | `npm run native:uninstall` | Remove native messaging host registration |

## Quick Start

### Prerequisites

- Bun (recommended runtime for scripts and build)
- Chromium-based browser for extension usage
- Optional: Obsidian CLI if using direct CLI save methods

### Install Dependencies

```bash
bun install
```

### Build Extension

```bash
bun run build
```

Output is generated in `dist/`.

### Run in Watch Mode

```bash
bun run dev
```

### Example CLI Runs

```bash
# Clip a URL
npm run clip:url -- https://example.com

# Clip markdown from stdin
echo "# Note" | npm run clip:stdin -- --title "Quick Note"

# Search then clip
npm run clip:search -- --query "obsidian workflow"

# Start MCP server
npm run mcp
```

## Development Commands

| Command | Description |
|---|---|
| `npm run build` | Build production extension bundles |
| `npm run dev` | Build in watch mode |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint across `src`, `tools`, `tests`, `build` |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Prettier write mode |
| `npm run format:check` | Prettier check mode |
| `npm run test` | Bun test runner |
| `npm run test:full` | Typecheck + lint + test |
| `npm run ci:full` | Typecheck + lint + format check + test |

## Configuration

Use `webclipper.json` or `.webclipper.json` to define defaults for browser profile, tags, vault, and tool behavior.

A baseline config template is provided at:
- `webclipper.json.example`

Common precedence model:
1. CLI arguments
2. Config file
3. Environment variables
4. Tool defaults

## Repository Structure

```text
src/                  Extension source (background/content/popup/options/offscreen/shared)
tools/                CLI and automation tools
native-host/          Native messaging host installer and runtime bridge
build/                Build system
docs/                 In-depth docs (CLI tools, templates, native bridge)
tests/                Test suites
dist/                 Build output
```

## Documentation

- CLI tools reference: `docs/cli-tools.md`
- Custom templates guide: `docs/custom-templates.md`
- Native messaging bridge: `docs/native-messaging-bridge.md`
- Implementation plan: `IMPLEMENTATION_PLAN.md`
- Specs: `specs/`

If you want, I can also generate:
- A concise "User README" for non-developers
- A separate "Developer README" with architecture diagrams and contribution workflow
- Per-tool deep-dive pages under `docs/tools/` for long-term maintenance
