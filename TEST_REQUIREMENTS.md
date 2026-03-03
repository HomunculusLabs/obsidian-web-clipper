# TEST_REQUIREMENTS — Obsidian Web Clipper

This file defines the current quality gates used by `IMPLEMENTATION_PLAN.md` tasks.

## Automated gates (required before task completion)

### Core quality gate (single command)
```bash
bun run test:quality:headless
# runs: typecheck + SeedFinder regression + SeedFinder smoke + headless harness
```

### Equivalent explicit command stack
```bash
bun run typecheck
bun run test:seedfinder
bun run test:seedfinder:smoke
bun run test:e2e:headless
```

### Additional automated checks (run when relevant)
```bash
bun run build
bun test
```

### Intake gate checks (required for intake loops)
```bash
# 1) Validate TASKPAD queue is not empty
bun run taskpad:queue-health -- --taskpad "/absolute/path/to/TASKPAD.md"

# 2) Validate newest IMPLEMENTATION_PLAN intake slice contract
bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md

# 3) Run full intake gate in one command (typecheck + both gates)
bun run verify:taskpad:intake:full -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md
```

If queue-health fails due to zero unchecked items, add one canonical seed:

```markdown
- [ ] planned-YYYY-MM-DD <actionable next step>
```

## Unit test priorities

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

### CLI tools (`tools/`)
- JSON output format correctness
- Error handling for invalid URLs
- Auth-required page detection
- CLI save contract behavior (`saveViaCli` payload/path assertions)

### Harness / integration (`tests/e2e/`)
- Headless test-vault harness scenarios:
  - generic web clip output + frontmatter stability
  - SeedFinder profile integrity through extraction/serialization
  - CLI save path contract via safe process mocking

### Tag/title suggestions (`src/shared/`)
- Domain-based tag suggestions
- Keyword extraction accuracy
- Title cleanup (site name removal, entity decoding)

## Manual acceptance tests (non-automated checks)

Run these for UX/runtime changes that automated suites do not fully cover.

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
