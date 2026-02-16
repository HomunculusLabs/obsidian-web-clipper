# Phase 7: Refactoring & Code Quality (Tasks 89-102)

## Goal
Clean up tech debt, add test infrastructure, improve type safety. This phase can be interleaved with other phases — tasks here are independent.

## Deduplication Targets (Tasks 89-91)

### HTML-to-Markdown (Task 89)
**Problem:** Two identical inline HTML→MD converters:
- `src/content/chatgpt/injector.ts` lines ~100-180 (`htmlToMarkdown()`)
- `tools/chatgpt-clipper.ts` lines ~200-280 (`extractResponsesInPage()`)

**Fix:** Extract to `src/shared/htmlToMarkdown.ts`. For the browser context (injector), import directly. For the tool, it runs in `page.evaluate()` so keep a copy but mark it as generated from the shared version.

### Frontmatter Building (Task 90)
**Problem:** Two frontmatter builders:
- `src/shared/markdown.ts` → `buildClipMarkdown()`
- `tools/chatgpt-clipper.ts` → `buildFrontmatter()`

**Fix:** Unify into `src/shared/markdown.ts`. Tools import from there.

### Filename Sanitization (Task 91)
**Problem:** `sanitizeFilename()` exists in:
- `src/shared/sanitize.ts`
- `tools/chatgpt-clipper.ts`

**Fix:** Delete the copy in tools, import from shared.

## Type Safety (Tasks 92-93)

### Message exhaustiveness (Task 92)
Add `default: never` to switch statements in:
- `src/background/router.ts`
- `src/content/clipper.ts`

### Error hierarchy (Task 93)
Create typed errors:
```typescript
class ClipError extends Error { constructor(msg: string, public code: string) {...} }
class ExtractError extends ClipError {}
class SaveError extends ClipError {}
class TemplateError extends ClipError {}
```

## Test Infrastructure (Tasks 98-101)

### Setup (Task 98)
- Create `tests/` directory structure
- Create `tests/helpers/mockChrome.ts` — Mock `chrome.runtime`, `chrome.storage`, `chrome.tabs`
- Create `tests/helpers/fixtures.ts` — HTML fixture loader
- Verify `bun test` discovers and runs tests
- Add `"test": "bun test"` to package.json if missing

### Test directories
```
tests/
├── helpers/
│   ├── mockChrome.ts
│   └── fixtures.ts
├── shared/
│   ├── sanitize.test.ts
│   ├── tags.test.ts
│   ├── pageType.test.ts
│   └── markdown.test.ts
├── extractors/
│   ├── web.test.ts
│   └── youtube.test.ts
├── templates/
│   ├── fixtures/       # HTML files per site
│   └── *.test.ts
└── tools/
    └── *.test.ts
```
