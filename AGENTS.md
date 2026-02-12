# Obsidian Web Clipper - Agent Configuration

## Project Overview
Chrome extension (Manifest V3) that clips web pages, PDFs, YouTube videos, and ChatGPT conversations to clean markdown for Obsidian.

## Tech Stack
- **Runtime**: TypeScript 5.4+, Bun (build + tools)
- **Build**: Custom `build/build.ts` using Bun.build (IIFE bundles)
- **Extension**: Chrome Manifest V3
- **Libraries**: Readability.js, Turndown.js, PDF.js, Puppeteer (tools)

## Project Structure
```
src/
├── background/          # Service worker (message routing, handlers)
├── content/             # Content scripts
│   ├── extractors/      # Web, YouTube, PDF extractors
│   ├── chatgpt/         # ChatGPT injector
│   └── web/             # Turndown, metadata, paywall, wiki-links
├── popup/               # Extension popup UI
├── options/             # Settings page
├── offscreen/           # Offscreen document (PDF extraction)
├── shared/              # Shared types, settings, utils
│   ├── types.ts         # Core types (PageType, ClipResult, etc.)
│   ├── messages.ts      # Message types (RuntimeRequest, TabRequest)
│   ├── settings.ts      # Settings interface + defaults
│   └── ...
├── manifest.json
tools/
├── chatgpt-clipper.ts   # Headless Puppeteer ChatGPT clipper CLI
build/
├── build.ts             # Bun build script
specs/
├── chrome-extension.md  # Original spec
```

## Commands
```bash
# Build
bun run build          # Production build → dist/
bun run dev            # Watch mode build

# Type check
bun run typecheck      # tsc --noEmit

# Tools
bun run clip:chatgpt   # ChatGPT headless clipper

# Test (when tests exist)
bun test               # Bun test runner
```

## Key Architecture Notes
- Content script handles page extraction, sends results via chrome.runtime messages
- Popup orchestrates clip flow: detect page type → clip → save to Obsidian
- Save uses `obsidian://new` URI scheme, with clipboard fallback for large content
- Settings stored in chrome.storage.sync
- ChatGPT injector uses MutationObserver to inject "Clip to Obsidian" buttons

## Adding New Extractors
1. Create `src/content/extractors/{name}.ts`
2. Export an `extract{Name}Content(result: ClipResult, ...): Promise<ClipResult>` function
3. Add new PageType to `src/shared/types.ts`
4. Add detection to `src/shared/pageType.ts`
5. Add case to `src/content/clipper.ts` switch
6. Update popup UI in `src/popup/ui.ts`

## Adding New CLI Tools
1. Create `tools/{name}.ts`
2. Add script to `package.json`
3. Use Puppeteer for headless browser automation
4. Support `--json` and `--stdout` flags for agentic use

## Git Remotes
- `gitea`: `ssh://git@localhost:4582/homunculus-labs/obsidian-web-clipper.git`
- `origin`: GitHub
