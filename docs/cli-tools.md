# CLI Tools Documentation

This document covers all headless Puppeteer-based CLI tools in the `tools/` directory. These tools enable automated web clipping for research pipelines, LLM agent integration, and batch processing.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Configuration](#configuration)
3. [Tool Reference](#tool-reference)
   - [clip-url](#clip-url) — Universal URL clipper
   - [clip-stdin](#clip-stdin) — Stdin markdown saver
   - [batch-clip](#batch-clip) — Concurrent batch clipping
   - [search-clip](#search-clip) — Google search and clip
   - [youtube-transcript](#youtube-transcript) — YouTube transcript extraction
   - [twitter-clipper](#twitter-clipper) — Twitter/X thread extraction
   - [chatgpt-clipper](#chatgpt-clipper) — ChatGPT conversation extraction
   - [pdf-clip](#pdf-clip) — PDF text extraction
   - [scrape-site](#scrape-site) — Site crawler
   - [pipeline](#pipeline) — Multi-tool composition
   - [mcp-server](#mcp-server) — AI agent integration
4. [Output Formats](#output-formats)
5. [LLM Agent Integration](#llm-agent-integration)
6. [Common Patterns](#common-patterns)

---

## Quick Start

All tools are Bun/TypeScript scripts. Run them with:

```bash
# Clip any URL
bun run tools/clip-url.ts https://example.com/article

# Get structured JSON output
bun run tools/clip-url.ts --json https://example.com

# Save directly to Obsidian
bun run tools/clip-url.ts --cli --vault "My Vault" https://example.com
```

### Prerequisites

```bash
# Install dependencies
bun install

# Ensure Puppeteer can run (may need on Linux)
bun add puppeteer
```

---

## Configuration

### Config File

Create `.webclipper.json` for default settings:

```json
{
  "version": 1,
  "obsidian": {
    "cli": true,
    "cliPath": "obsidian-cli",
    "vault": "My Vault",
    "folder": "Notes/Clips"
  },
  "browser": {
    "profile": "~/.config/google-chrome/Default",
    "headless": true,
    "wait": 5000
  },
  "content": {
    "tags": ["web-clip"],
    "timestamps": true
  },
  "tools": {
    "concurrency": 4,
    "continueOnError": false
  }
}
```

**Config file lookup order:**
1. `--config <path>` explicit path
2. `./webclipper.json` (no dot)
3. `./.webclipper.json` (dot file)
4. `~/.webclipper.json` (home directory)
5. `~/.config/webclipper/config.json` (XDG config)

### Environment Variables

All settings can be configured via environment variables with `WEBCLIPPER_` prefix:

```bash
export WEBCLIPPER_VAULT="My Vault"
export WEBCLIPPER_FOLDER="Notes/Clips"
export WEBCLIPPER_CHROME_PROFILE="~/.config/google-chrome/Default"
export WEBCLIPPER_TAGS="research,clipped"
export WEBCLIPPER_CONCURRENCY="8"
```

### Priority Order

```
CLI args > config file > env vars > defaults
```

---

## Tool Reference

### clip-url

**Universal URL clipper** — Clips any URL to Obsidian-compatible markdown.

**Supports:**
- Web pages (HTML → Markdown)
- YouTube videos (with transcript extraction)
- PDFs (basic extraction)

```bash
bun run tools/clip-url.ts [OPTIONS] <URL>
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--cli` | false | Use Obsidian CLI for direct file creation |
| `--cli-path <path>` | `obsidian-cli` | Path to obsidian-cli binary |
| `--vault <name>` | `"Main Vault"` | Obsidian vault name |
| `--folder <path>` | `"Clips"` | Obsidian folder path |
| `--profile <path>` | null | Chrome user data dir (for auth) |
| `--no-headless` | - | Show browser window |
| `--wait <ms>` | 5000 | Wait time for page load |
| `--tags <a,b,c>` | `"web-clip"` | Comma-separated tags |
| `--json` | false | Output structured JSON |
| `--stdout` | false | Dump markdown to stdout |
| `--no-timestamps` | - | Exclude timestamps in YouTube |
| `--config <path>` | - | Path to config file |

**Examples:**

```bash
# Basic usage
bun run tools/clip-url.ts https://example.com/article

# YouTube video with transcript
bun run tools/clip-url.ts https://youtube.com/watch?v=abc123

# Save to Obsidian via CLI
bun run tools/clip-url.ts --cli --vault "Research" --folder "Papers" https://arxiv.org/abs/2401.12345

# Use Chrome profile for authenticated pages
bun run tools/clip-url.ts --profile ~/.config/google-chrome/Default https://member-site.com/article

# LLM agent: get JSON output
bun run tools/clip-url.ts --json https://example.com
```

---

### clip-stdin

**Stdin markdown clipper** — Reads markdown from stdin and saves to Obsidian. Perfect for piping from other tools.

```bash
bun run tools/clip-stdin.ts [OPTIONS]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--title, -t <name>` | from H1 | Note title |
| `--source, -s <url>` | `"stdin"` | Source URL for frontmatter |
| `--type <type>` | `"article"` | Content type (article, video, document, tweet, post) |
| `--author, -a <name>` | - | Author name |
| `--cli` | false | Use Obsidian CLI |
| `--vault, -v <name>` | `"Main Vault"` | Vault name |
| `--folder, -f <path>` | root | Folder path |
| `--tags <a,b,c>` | - | Tags |
| `--json` | false | Output JSON |
| `--stdout` | false | Dump to stdout |
| `--overwrite` | true | Overwrite existing |
| `--append` | false | Append to existing |

**Examples:**

```bash
# Basic pipe
echo "# Quick Note\n\nSome content" | bun run tools/clip-stdin.ts --title "Quick Note"

# Convert and clip with pandoc
pandoc document.docx -t markdown | bun run tools/clip-stdin.ts --title "Converted Doc" --folder "Imports"

# Save with tags
cat research.md | bun run tools/clip-stdin.ts --cli --vault "Research" --tags "paper,ML,2024"

# Append to existing note
echo "\n## Update\nNew info" | bun run tools/clip-stdin.ts --title "Daily Log" --append

# LLM pipeline: save generated content
some-llm-tool --generate | bun run tools/clip-stdin.ts --cli --title "AI Response"
```

---

### batch-clip

**Batch URL clipper** — Clips multiple URLs concurrently with progress reporting.

```bash
bun run tools/batch-clip.ts [OPTIONS] <URLs...>
bun run tools/batch-clip.ts [OPTIONS] @file:urls.txt
cat urls.txt | bun run tools/batch-clip.ts [OPTIONS] --stdin
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--parallel, -p <n>` | 4 | Concurrent workers |
| `--stdin` | false | Read URLs from stdin |
| `--continue-on-error, -c` | false | Continue if URL fails |
| `--no-progress` | false | Disable progress display |
| (Common options) | - | See clip-url options |

**Input Sources:**

URLs can be provided via:
- Command line: `url1 url2 url3`
- File: `@file:path/to/urls.txt` (one URL per line, `#` for comments)
- Stdin: `--stdin` flag

**Examples:**

```bash
# Clip multiple URLs
bun run tools/batch-clip.ts https://example.com https://other.com

# From file with 8 parallel workers
bun run tools/batch-clip.ts --parallel 8 @file:urls.txt

# Pipe URLs and output JSON
cat urls.txt | bun run tools/batch-clip.ts --stdin --json

# Save all to Obsidian, continue on errors
bun run tools/batch-clip.ts --cli --vault "Research" --continue-on-error @file:urls.txt
```

**Output (`--json`):**

```json
{
  "success": true,
  "total": 10,
  "succeeded": 9,
  "failed": 1,
  "results": [
    {
      "success": true,
      "url": "https://example.com",
      "title": "Article Title",
      "markdown": "---\n...",
      "content": "...",
      "tags": ["web-clip"]
    }
  ]
}
```

---

### search-clip

**Search-and-clip tool** — Searches Google and clips top N results. Ideal for research pipelines.

```bash
bun run tools/search-clip.ts [OPTIONS] --query "search query"
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--query, -q <text>` | required | Search query |
| `--top, -n <n>` | 5 | Number of results to clip |
| `--continue-on-error, -c` | false | Continue if clip fails |
| `--no-progress` | false | Disable progress |
| (Common options) | - | See clip-url options |

**Examples:**

```bash
# Search and clip top 5 results
bun run tools/search-clip.ts --query "obsidian plugins"

# Clip top 10 and save to Obsidian
bun run tools/search-clip.ts --query "TypeScript tutorials" --top 10 --cli --vault "Notes"

# LLM tool call: get structured JSON
bun run tools/search-clip.ts --query "latest AI research" --json

# Use Chrome profile for personalized results
bun run tools/search-clip.ts --profile ~/.config/google-chrome/Default --query "news"
```

---

### youtube-transcript

**YouTube transcript extractor** — Extracts video transcripts with timestamps and metadata.

```bash
bun run tools/youtube-transcript.ts [OPTIONS] <YOUTUBE_URL>
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--json` | false | Output structured JSON |
| `--stdout` | false | Dump transcript to stdout |
| `--no-timestamps` | false | Exclude timestamps |
| `--format <type>` | `"text"` | Output format: `text` or `segments` |
| `--folder <path>` | `"Clips/YouTube"` | Default folder |
| `--tags <a,b,c>` | `"youtube,transcript"` | Default tags |

**Examples:**

```bash
# Extract transcript with timestamps
bun run tools/youtube-transcript.ts https://youtube.com/watch?v=abc123

# LLM tool call: get structured JSON
bun run tools/youtube-transcript.ts --json https://youtube.com/watch?v=abc123

# Pipe plain transcript to another tool
bun run tools/youtube-transcript.ts --stdout --no-timestamps https://youtube.com/watch?v=abc123

# Get segment-level data
bun run tools/youtube-transcript.ts --json --format segments https://youtube.com/watch?v=abc123
```

**Output (`--json --format segments`):**

```json
{
  "success": true,
  "url": "https://youtube.com/watch?v=abc123",
  "title": "Video Title",
  "markdown": "---\n...",
  "content": "...",
  "data": {
    "transcript": [
      { "timestamp": "0:00", "timestampSeconds": 0, "text": "Hello everyone..." },
      { "timestamp": "0:15", "timestampSeconds": 15, "text": "Today we'll discuss..." }
    ],
    "transcriptText": "Hello everyone... Today we'll discuss...",
    "metadata": {
      "videoId": "abc123",
      "title": "Video Title",
      "channel": "Channel Name",
      "duration": "10:30",
      "durationSeconds": 630,
      "viewCount": 12345,
      "likeCount": 500
    }
  }
}
```

---

### twitter-clipper

**Twitter/X thread clipper** — Extracts threads and individual tweets with full metadata.

```bash
bun run tools/twitter-clipper.ts [OPTIONS] <TWITTER_URL>
```

**Supports:**
- twitter.com and x.com URLs
- Single tweets and full threads
- Media (images, videos, GIFs)
- Quoted tweets
- Engagement stats

**Examples:**

```bash
# Single tweet or thread
bun run tools/twitter-clipper.ts https://twitter.com/user/status/123456
bun run tools/twitter-clipper.ts https://x.com/user/status/123456

# From file
bun run tools/twitter-clipper.ts --file urls.txt

# Output as JSON
bun run tools/twitter-clipper.ts --json https://x.com/user/status/123456

# Use Chrome profile (RECOMMENDED for full threads)
bun run tools/twitter-clipper.ts --profile ~/.config/google-chrome/Default https://x.com/user/status/123456
```

**Output Structure:**

```json
{
  "success": true,
  "url": "https://x.com/user/status/123456",
  "title": "Thread by @username",
  "data": {
    "tweet_id": "123456",
    "author_handle": "username",
    "author_name": "Display Name",
    "is_thread": true,
    "thread_length": 5,
    "text": "Full thread text...",
    "engagement": {
      "replies": 42,
      "retweets": 128,
      "likes": 512
    },
    "thread_tweets": [
      { "text": "First tweet...", "timestamp": "2024-01-15T10:30:00Z", "position": 1 }
    ]
  }
}
```

---

### chatgpt-clipper

**ChatGPT conversation clipper** — Extracts ChatGPT conversations to Obsidian markdown.

```bash
bun run tools/chatgpt-clipper.ts [OPTIONS] <CHATGPT_URL>
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--file, -f <path>` | - | Read URLs from file |
| `--outdir <path>` | `./chatgpt-clips` | Output directory |
| `--obsidian` | false | Use obsidian:// URI scheme |
| `--per-response` | true | Save each response separately |
| (Common options) | - | See clip-url options |

**Examples:**

```bash
# Single conversation
bun run tools/chatgpt-clipper.ts https://chatgpt.com/c/abc123

# Multiple conversations from file
bun run tools/chatgpt-clipper.ts --file urls.txt

# Use Chrome profile (RECOMMENDED for auth)
bun run tools/chatgpt-clipper.ts --profile ~/.config/google-chrome/Default https://chatgpt.com/c/abc123

# Save via Obsidian CLI
bun run tools/chatgpt-clipper.ts --cli --vault "AI" --folder "ChatGPT" https://chatgpt.com/c/abc123
```

---

### pdf-clip

**PDF text extractor** — Extracts text from PDF URLs or local files.

```bash
bun run tools/pdf-clip.ts [OPTIONS] <PDF_URL_OR_PATH>
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--pages <spec>` | all | Pages to extract (e.g., `1-5`, `1,3,5-7`) |
| `--max-pages <n>` | 100 | Maximum pages to process |
| `--max-chars <n>` | 100000 | Maximum characters |
| `--metadata` | true | Include PDF metadata |

**Examples:**

```bash
# Extract from URL
bun run tools/pdf-clip.ts https://example.com/document.pdf

# Extract from local file
bun run tools/pdf-clip.ts ./document.pdf

# Extract specific pages
bun run tools/pdf-clip.ts --pages 1-5 https://example.com/paper.pdf
bun run tools/pdf-clip.ts --pages 1,3,5-7 ./document.pdf

# Save to Obsidian
bun run tools/pdf-clip.ts --cli --vault "Papers" --folder "PDFs" ./research.pdf
```

---

### scrape-site

**Site scraper/crawler** — Crawls a site and clips all pages up to depth N.

```bash
bun run tools/scrape-site.ts [OPTIONS] --url <START_URL>
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--url <url>` | required | Starting URL |
| `--depth <n>` | 1 | Crawl depth |
| `--max-pages <n>` | 20 | Maximum pages to clip |
| `--include-subdomains` | false | Follow subdomain links |
| `--continue-on-error` | false | Continue on failures |
| `--delay <ms>` | 500 | Delay between requests |
| `--user-agent <ua>` | default | Custom user agent |

**Examples:**

```bash
# Crawl with defaults (depth 1, max 20 pages)
bun run tools/scrape-site.ts --url https://docs.example.com

# Deep crawl (depth 2, max 50 pages)
bun run tools/scrape-site.ts --url https://example.com --depth 2 --max-pages 50

# Include subdomains
bun run tools/scrape-site.ts --url https://example.com --include-subdomains

# Authenticated scraping
bun run tools/scrape-site.ts --profile ~/.config/google-chrome/Default --url https://app.example.com/docs

# Polite scraping with delay
bun run tools/scrape-site.ts --url https://example.com --delay 1000 --depth 2
```

**Output (`--json`):**

```json
{
  "success": true,
  "startUrl": "https://docs.example.com",
  "total": 15,
  "succeeded": 14,
  "failed": 1,
  "maxDepth": 2,
  "manifest": [
    {
      "url": "https://docs.example.com/guide",
      "title": "Getting Started Guide",
      "depth": 1,
      "status": "success"
    }
  ]
}
```

---

### pipeline

**Pipeline composer** — Chain multiple tools together with a simple DSL or JSON config.

```bash
bun run tools/pipeline.ts --steps "step1 -> step2 -> step3"
bun run tools/pipeline.ts --config pipeline.json
```

**DSL Syntax:**

```
step1 -> step2 -> step3
```

**Step Types:**

| Step | Description |
|------|-------------|
| `search:<query>` | Search Google for query |
| `clip:<url>[,url2,...]` | Clip specific URLs |
| `clip:top<N>` | Clip top N results from previous search |
| `clip:all` | Clip all results from previous search |
| `youtube:<url>` | Clip YouTube video with transcript |
| `save:obsidian` | Save all results to Obsidian |
| `filter:<field>:<value>` | Filter results by field |
| `tags:<tag1,tag2>` | Add tags to results |
| `output:stdout` | Output results to stdout |

**Examples:**

```bash
# Search and clip top 5
bun run tools/pipeline.ts --steps "search:obsidian plugins -> clip:top5 -> save:obsidian"

# Clip specific URLs
bun run tools/pipeline.ts --steps "clip:https://example.com,https://other.com -> save:obsidian"

# YouTube + search combo
bun run tools/pipeline.ts --steps "youtube:https://youtube.com/watch?v=abc -> save:obsidian"

# With filtering
bun run tools/pipeline.ts --steps "search:AI news -> clip:top10 -> filter:pageType:web -> save:obsidian"

# Output as JSON
bun run tools/pipeline.ts --steps "search:obsidian plugins -> clip:top3" --json
```

**JSON Config (`pipeline.json`):**

```json
{
  "name": "Research Pipeline",
  "steps": [
    { "type": "search", "params": { "query": "AI research papers 2024" } },
    { "type": "clip", "params": { "topN": 5 } },
    { "type": "tags", "params": { "tags": ["research", "AI", "2024"] } },
    { "type": "save", "params": {} }
  ],
  "obsidian": {
    "cli": true,
    "vault": "Research",
    "folder": "Papers"
  },
  "continueOnError": true
}
```

---

### mcp-server

**MCP Server for AI Agents** — Exposes clipping tools via the Model Context Protocol for Claude Desktop and other MCP-compatible AI agents.

```bash
bun run tools/mcp-server.ts
```

The server communicates over stdio using JSON-RPC 2.0. It's typically started automatically by MCP clients.

**Claude Desktop Configuration:**

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "obsidian-clipper": {
      "command": "bun",
      "args": ["run", "/path/to/obsidian-web-clipper/tools/mcp-server.ts"]
    }
  }
}
```

**Available MCP Tools:**

| Tool | Description |
|------|-------------|
| `clip_url` | Clip any URL to markdown |
| `clip_search` | Search Google and clip top results |
| `save_to_obsidian` | Save content directly to Obsidian |
| `clip_youtube` | Get YouTube video transcript |
| `clip_twitter` | Extract Twitter/X thread |

**Example MCP Tool Calls:**

When Claude or another MCP client uses this server:

```json
// clip_url call
{
  "name": "clip_url",
  "arguments": {
    "url": "https://example.com/article",
    "tags": "research,important",
    "save_to_obsidian": true
  }
}

// clip_search call
{
  "name": "clip_search",
  "arguments": {
    "query": "obsidian plugins",
    "top_n": 5,
    "save_to_obsidian": false
  }
}
```

---

## Output Formats

### ToolOutput Schema

All tools use a standardized `ToolOutput<T>` format for `--json` output:

```typescript
interface ToolOutput<T = unknown> {
  success: boolean;       // Whether the operation succeeded
  url: string;            // Source URL that was processed
  title: string;          // Extracted or generated title
  markdown: string;       // Full markdown with frontmatter
  content: string;        // Content without frontmatter (raw body)
  tags: string[];         // Tags applied to this clip
  error?: string;         // Error message if not successful
  data?: T;               // Tool-specific additional data
}
```

### Markdown Output

All tools generate Obsidian-compatible markdown with YAML frontmatter:

```markdown
---
source: https://example.com/article
title: Article Title
type: article
date_clipped: 2024-01-15T10:30:00.000Z
tags:
  - web-clip
  - research
author: John Doe
---

# Article Title

> Brief excerpt from the article...

Article content here...
```

---

## LLM Agent Integration

### Using --json Flag

All tools support `--json` for structured output that LLMs can parse:

```bash
# Get structured clip data
bun run tools/clip-url.ts --json https://example.com

# Get search results
bun run tools/search-clip.ts --json --query "AI research"

# Get YouTube transcript
bun run tools/youtube-transcript.ts --json https://youtube.com/watch?v=abc123
```

### MCP Integration

The MCP server (`mcp-server.ts`) provides the most seamless integration with AI agents:

1. **Claude Desktop**: Add to `claude_desktop_config.json`
2. **Other MCP Clients**: Connect via stdio transport

Once connected, the AI agent can:
- Clip URLs directly
- Search and clip multiple results
- Save content to Obsidian
- Extract YouTube transcripts
- Capture Twitter threads

### Script Integration

Use `--stdout` to pipe output to other tools:

```bash
# Pipe to another tool
bun run tools/clip-url.ts --stdout https://example.com | other-tool

# Combine with jq
bun run tools/clip-url.ts --json https://example.com | jq '.data.metadata'

# Pipe through multiple tools
bun run tools/youtube-transcript.ts --stdout --no-timestamps https://youtube.com/... | \
  summarize-tool | \
  bun run tools/clip-stdin.ts --title "Summary"
```

---

## Common Patterns

### Research Pipeline

```bash
# 1. Search and clip top results
bun run tools/search-clip.ts \
  --query "machine learning papers 2024" \
  --top 10 \
  --cli --vault "Research" --folder "Papers" \
  --tags "ML,research,2024"

# 2. Or use the pipeline tool
bun run tools/pipeline.ts \
  --steps "search:machine learning papers 2024 -> clip:top10 -> tags:ML,research,2024 -> save:obsidian" \
  --cli --vault "Research" --folder "Papers"
```

### Daily News Digest

```bash
# Create a file with news URLs
cat > news-urls.txt << EOF
https://news.ycombinator.com
https://techcrunch.com
EOF

# Batch clip
bun run tools/batch-clip.ts \
  --parallel 4 \
  --cli --vault "Notes" --folder "News/$(date +%Y-%m-%d)" \
  --tags "news,daily" \
  @file:news-urls.txt
```

### YouTube Playlist to Notes

```bash
# Extract video IDs from playlist page, then batch clip
cat playlist-urls.txt | \
  xargs -I {} bun run tools/youtube-transcript.ts \
    --cli --vault "Learning" --folder "YouTube" \
    --tags "youtube,learning" \
    {}
```

### Twitter Thread Archive

```bash
# Clip Twitter threads from a file
bun run tools/twitter-clipper.ts \
  --cli --vault "Archive" --folder "Twitter" \
  --tags "twitter,thread" \
  --file threads.txt
```

### Authenticated Content

```bash
# Use Chrome profile for sites requiring login
bun run tools/clip-url.ts \
  --profile ~/.config/google-chrome/Default \
  --cli --vault "Personal" --folder "Clips" \
  https://member-only-site.com/premium-article
```

### Debugging

```bash
# Show browser for debugging
bun run tools/clip-url.ts --no-headless https://example.com

# Longer wait for slow pages
bun run tools/clip-url.ts --wait 15000 https://slow-site.com

# Continue on errors for batch processing
bun run tools/batch-clip.ts --continue-on-error @file:urls.txt
```

---

## Troubleshooting

### Puppeteer Issues

```bash
# Install Chromium if needed
bunx puppeteer browsers install chrome

# On Linux, may need dependencies
sudo apt-get install -y chromium-browser
```

### Chrome Profile

For authenticated clipping, use your Chrome profile:

```bash
# macOS
--profile ~/Library/Application\ Support/Google/Chrome/Default

# Linux
--profile ~/.config/google-chrome/Default

# Windows (WSL)
--profile /mnt/c/Users/YOURUSER/AppData/Local/Google/Chrome/User\ Data/Default
```

### Obsidian CLI

Ensure `obsidian-cli` is installed and in PATH:

```bash
# Check if available
which obsidian-cli

# Or specify path
--cli-path /usr/local/bin/obsidian-cli
```

---

## Tool Library Reference

The `tools/lib/` directory contains shared utilities:

### clipper-core.ts

Core utilities for all clipping tools:

```typescript
import {
  launchBrowser,
  createPage,
  createLogger,
  resolveUrls,
  htmlToMarkdown,
  extractWebContentInPage,
  type CommonCLIOptions,
  type ToolOutput,
  type ToolMetadata,
  DEFAULT_CLI_OPTIONS,
} from './lib/clipper-core';
```

### config.ts

Configuration loading and merging:

```typescript
import {
  loadConfig,
  mergeWithDefaults,
  findConfigFile,
  generateSampleConfig,
  type WebClipperConfig,
} from './lib/config';
```

### auth.ts

Shared authentication configuration for headless tools.

---

## See Also

- [Custom Templates](./custom-templates.md) — Site-specific extraction rules
- [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) — Full feature roadmap
- [README.md](../README.md) — Extension usage documentation
