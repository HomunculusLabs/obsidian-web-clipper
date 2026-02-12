# TEST_REQUIREMENTS — Obsidian Web Clipper

This file defines the checks used for Y/N gates in `IMPLEMENTATION_PLAN.md`.

## Automated checks (must pass before marking a task complete)

### Typecheck
```bash
bun run typecheck      # tsc --noEmit
```

### Build
```bash
bun run build          # Must produce dist/ without errors
```

### Tests (once test infra exists — Phase 7 Task 98+)
```bash
bun test               # Bun test runner
```

## Unit test priorities (when test infra is set up)

### Shared utilities (`src/shared/`)
- `sanitize.ts`: filename sanitization edge cases (unicode, long names, special chars)
- `tags.ts`: tag parsing, auto-tag injection, deduplication
- `pageType.ts`: URL detection for all page types (web, youtube, pdf, twitter)
- `markdown.ts`: frontmatter building, markdown assembly
- `guards.ts`: type guard correctness for all message types

### Extractors (`src/content/extractors/`)
- Web: Readability output → markdown conversion
- YouTube: transcript formatting with/without timestamps
- PDF: text extraction, truncation handling
- Twitter: thread detection, single vs multi-tweet

### Templates (`src/content/templates/`)
- Each site template: test with fixture HTML → expected markdown output
- Template matching: correct template selected for URL patterns

### CLI Tools (`tools/`)
- JSON output format correctness
- Error handling for invalid URLs
- Auth-required page detection

### Tag/Title Suggestions (`src/shared/`)
- Domain-based tag suggestions
- Keyword extraction accuracy
- Title cleanup (site name removal, entity decoding)

## Manual acceptance tests

### Extension basic flow
- Install extension from `dist/`
- Clip a web page → verify markdown in Obsidian
- Clip a YouTube video → verify transcript
- Clip a PDF → verify text extraction
- Open ChatGPT → verify "Clip to Obsidian" buttons appear

### Selection clipping
- Select text on a page → clip selection only
- Right-click selected text → "Clip to Obsidian" works

### Site templates
- Clip a Reddit post → verify subreddit, author, score in metadata
- Clip a GitHub README → verify repo metadata
- Clip a Stack Overflow question → verify Q&A structure

### CLI tools
- `bun run tools/clip-url.ts --json <url>` → valid JSON output
- `bun run tools/clip-url.ts --stdout <url>` → markdown to stdout
- `bun run tools/batch-clip.ts --file urls.txt --json` → batch output
