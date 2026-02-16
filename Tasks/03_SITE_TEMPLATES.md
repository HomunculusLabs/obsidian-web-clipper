# Phase 3: Site-Specific Templates (Tasks 23-42)

## Goal
Custom extraction rules per domain. Instead of always using Readability (which loses site-specific structure), templates define exactly what to extract and how to format it.

## Key Files to Create

### Core Template System
- `src/shared/templates.ts` — `SiteTemplate` type, template settings (Task 23)
- `src/content/templates/registry.ts` — URL matching, template lookup (Task 24)

### Built-in Templates
- `src/content/templates/reddit.ts` (Task 26)
- `src/content/templates/hackernews.ts` (Task 27)
- `src/content/templates/stackoverflow.ts` (Task 28)
- `src/content/templates/github.ts` (Task 29)
- `src/content/templates/wikipedia.ts` (Task 30)
- `src/content/templates/medium.ts` (Task 31)
- `src/content/templates/substack.ts` (Task 32)
- `src/content/templates/arxiv.ts` (Task 33)
- `src/content/templates/docs.ts` (Task 34)
- `src/content/templates/amazon.ts` (Task 35)
- `src/content/templates/recipe.ts` (Task 36)
- `src/content/templates/index.ts` — Bundle all templates (Task 42)

### UI
- Options page template editor section (Task 37)

### Tests
- `tests/templates/` — Fixture HTML per site (Task 40)

## Modified Files
- `src/content/extractors/web.ts` — Check template registry before Readability (Task 25)
- `src/popup/popup.ts` — Show matched template name (Task 38)
- `src/shared/settings.ts` — Add template enable/disable, custom templates array

## Template Interface
```typescript
interface SiteTemplate {
  id: string;
  name: string;
  domains: string[];        // e.g. ["reddit.com", "old.reddit.com"]
  urlPattern?: RegExp;      // Optional URL refinement
  priority: number;         // Higher wins when multiple match
  enabled: boolean;
  
  selectors: {
    title?: string;         // CSS selector
    content?: string;       // CSS selector for main content
    author?: string;
    date?: string;
    tags?: string;
  };
  
  removeSelectors?: string[];  // Elements to strip before extraction
  
  // Custom extraction function (for complex sites)
  extract?: (doc: Document, url: string) => TemplateExtractionResult;
  
  frontmatterExtras?: Record<string, string>;  // Static extras
}
```

## Architecture Notes
- Templates run BEFORE Readability — if a template matches, Readability is skipped
- Each template can use CSS selectors (simple) or a custom `extract()` function (complex)
- Templates are loaded from settings (user custom) + built-in bundle
- User can disable built-in templates or override them
- Template matching: domain match first, then URL pattern if specified
