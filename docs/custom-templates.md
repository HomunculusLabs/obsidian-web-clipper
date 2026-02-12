# Custom Templates Guide

This guide explains how to create, share, and manage custom site templates for the Obsidian Web Clipper.

## What Are Site Templates?

Site templates are custom extraction rules that tell the clipper how to extract content from specific websites. Instead of relying on generic Readability-based extraction, templates use CSS selectors to precisely target the title, content, author, date, and other metadata on a page.

Templates are useful when:

- You frequently clip from the same sites and want consistent formatting
- A site has paywalls or complex layouts that confuse generic extraction
- You want to extract specific metadata (author, tags, date) in a structured way
- You want to add custom frontmatter fields for organization in Obsidian

## Built-in Templates

The clipper includes templates for popular sites:

| Site | Template File | Features |
|------|---------------|----------|
| Reddit | `reddit.ts` | Old/new Reddit, posts, comments, subreddit tags |
| Hacker News | `hackernews.ts` | Stories, comments, points, self-posts |
| Stack Overflow | `stackoverflow.ts` | Questions, answers, code blocks with languages |
| GitHub | `github.ts` | Repos, issues, PRs, code files, gists |
| Wikipedia | `wikipedia.ts` | Articles, infoboxes, categories, disambiguation |
| Medium | `medium.ts` | Articles, author, publication, reading time |
| Substack | `substack.ts` | Newsletters, author, publication, paywall detection |
| ArXiv | `arxiv.ts` | Papers, abstracts, authors, BibTeX generation |
| Documentation Sites | `docs.ts` | MDN, React, Vue, Angular docs with breadcrumbs |
| Amazon | `amazon.ts` | Products, prices, ratings, features |
| Recipe Sites | `recipe.ts` | Recipes with ingredients, instructions, timing |

## Template Structure

A template is defined using the `SiteTemplate` interface:

```typescript
interface SiteTemplate {
  // Domain pattern (required)
  domain: string;
  
  // Human-readable name (required)
  name: string;
  
  // CSS selectors for extraction (required)
  selectors: TemplateSelectors;
  
  // Elements to remove before extraction
  removeSelectors?: string[];
  
  // Extra frontmatter fields
  frontmatterExtras?: Record<string, string>;
  
  // Whether template is active
  enabled: boolean;
  
  // Higher priority = checked first (default: 0)
  priority?: number;
  
  // Description for documentation
  description?: string;
  
  // URL path pattern for finer control
  urlPattern?: string;
}

interface TemplateSelectors {
  title?: string;       // CSS selector for the title
  content?: string;     // CSS selector for main content
  author?: string;      // CSS selector for author name
  date?: string;        // CSS selector for publication date
  tags?: string;        // CSS selector for tags/categories
  description?: string; // CSS selector for summary/description
  url?: string;         // CSS selector for canonical URL
  image?: string;       // CSS selector for main image
}
```

## Creating a Custom Template

### Method 1: Via Options Page (Coming Soon)

The options page will include a template editor where you can create, edit, and test templates visually.

### Method 2: Programmatically

For now, you can create templates by adding files to `src/content/templates/`. Here's how:

#### Step 1: Create the Template File

Create a new file in `src/content/templates/`, e.g., `my-site.ts`:

```typescript
/**
 * My Custom Site Template
 * 
 * Description of what this template extracts.
 */

import type { SiteTemplate } from "../../shared/templates";
import { registerBuiltInTemplates } from "./registry";

// Define your template
export const mySiteTemplate: SiteTemplate = {
  domain: "example.com",
  name: "Example Site",
  description: "Extract articles from example.com",
  enabled: true,
  priority: 50,
  
  selectors: {
    title: "h1.article-title",
    content: ".article-body",
    author: ".author-name",
    date: "time.published-date",
    tags: ".tag-list a"
  },
  
  removeSelectors: [
    ".ad-banner",
    ".newsletter-signup",
    ".related-articles",
    "nav",
    "footer"
  ],
  
  frontmatterExtras: {
    site: "example"
  }
};

// Register the template
registerBuiltInTemplates([mySiteTemplate]);

// Export for testing
export { mySiteTemplate };
```

#### Step 2: Register in index.ts

Add your template to `src/content/templates/index.ts`:

```typescript
// Add import at the top
import "./my-site";

// Add exports at the bottom if you want to export utility functions
export {
  mySiteTemplate
} from "./my-site";
```

#### Step 3: Rebuild

```bash
bun run build
```

## Domain Matching

Templates match URLs using domain patterns. Several matching modes are supported:

### Exact Domain Match

```typescript
domain: "news.ycombinator.com"
```

Matches only `news.ycombinator.com`, not `ycombinator.com` or subdomains.

### Subdomain Wildcard

```typescript
domain: "*.medium.com"
```

Matches any subdomain of medium.com: `blog.medium.com`, `john.medium.com`, etc.

### Subdomain Inheritance

```typescript
domain: "medium.com"
```

Matches `medium.com` AND any subdomain like `blog.medium.com`.

### Multiple Templates for One Domain

You can have multiple templates for the same domain with different `urlPattern` or `priority`:

```typescript
// High priority for comment pages
const redditCommentsTemplate: SiteTemplate = {
  domain: "reddit.com",
  name: "Reddit Comments",
  urlPattern: "^/r/[^/]+/comments/",
  priority: 100,
  // ...
};

// Lower priority for general pages
const redditGeneralTemplate: SiteTemplate = {
  domain: "reddit.com",
  name: "Reddit General",
  priority: 50,
  // ...
};
```

## URL Pattern Matching

Use `urlPattern` for finer control over which pages a template matches:

```typescript
// Regex patterns (matched against URL path)
urlPattern: "^/r/[^/]+/comments/"  // Reddit comment pages
urlPattern: "^/questions/\\d+"     // Stack Overflow questions
urlPattern: "^/issues/\\d+"        // GitHub issues

// Glob patterns (converted to regex)
urlPattern: "/articles/*"          // Any /articles/ path
urlPattern: "/docs/**/*.html"      // Any .html file under /docs/
```

## Selectors Guide

### Finding Selectors

1. Open the page in Chrome
2. Right-click the element you want to extract
3. Select "Inspect"
4. Find a unique CSS selector (class, id, or attribute)

### Selector Tips

**Be Specific:**

```typescript
// Good - targets specific element
title: "h1.article-title"

// Less reliable - too generic
title: "h1"
```

**Use Multiple Fallbacks:**

```typescript
title: "h1.title, h1.article-title, header h1"
```

**Handle Dynamic Content:**

```typescript
// Modern web components
content: "article-body, my-article, [data-content]"

// Shadow DOM requires custom extraction logic
```

**Extract Nested Content:**

```typescript
// Content within shadow DOM or slots
content: "shreddit-post [slot='content'], article .body"
```

### Remove Selectors

Clean up the content before extraction:

```typescript
removeSelectors: [
  // Ads
  ".ad-container",
  "[data-ad]",
  
  // Navigation
  "nav",
  ".sidebar",
  ".breadcrumb",
  
  // Social widgets
  ".share-buttons",
  ".social-links",
  
  // Comments (if not wanted)
  ".comments-section",
  
  // Footers
  "footer",
  ".related-posts"
]
```

## Advanced Extraction

For complex sites, you can add custom extraction functions:

```typescript
/**
 * Extract custom data from the page.
 */
function extractCustomData(doc: Document, url: string): {
  customField: string;
  tags: string[];
} {
  // Custom extraction logic
  const tags: string[] = [];
  const tagEls = doc.querySelectorAll(".tag");
  for (const el of Array.from(tagEls)) {
    tags.push(el.textContent?.trim() || "");
  }
  
  return {
    customField: "value",
    tags
  };
}

/**
 * Format the extracted content as markdown.
 */
function formatCustomContent(data: ReturnType<typeof extractCustomData>): string {
  let md = "";
  
  md += `## Tags\n\n`;
  for (const tag of data.tags) {
    md += `- ${tag}\n`;
  }
  
  return md;
}
```

## Frontmatter Customization

Add extra fields to the YAML frontmatter:

```typescript
frontmatterExtras: {
  site: "hacker-news",
  page_type: "story",
  source_quality: "high"
}
```

Results in:

```yaml
---
title: "My Clipped Article"
url: "https://example.com/article"
date: "2024-01-15"
site: "hacker-news"
page_type: "story"
source_quality: "high"
---
```

## Testing Templates

### Manual Testing

1. Build the extension: `bun run build`
2. Load in Chrome as an unpacked extension
3. Navigate to a target page
4. Open the clipper popup and check the "Template" indicator

### Unit Testing

Create a test file in `tests/templates/`:

```typescript
import { test, expect } from "bun:test";
import { getTemplateForUrl, matchDomain } from "../../src/content/templates";

test("domain matching", () => {
  expect(matchDomain("example.com", "example.com")).toBe(true);
  expect(matchDomain("*.example.com", "blog.example.com")).toBe(true);
  expect(matchDomain("example.com", "blog.example.com")).toBe(true);
});

test("template matching", () => {
  const template = getTemplateForUrl("https://example.com/article");
  expect(template).not.toBeNull();
  expect(template?.name).toBe("Example Site");
});
```

Run tests:

```bash
bun test tests/templates/
```

### Test Fixtures

Save HTML fixtures for reliable testing:

```typescript
// tests/fixtures/example-article.html
const fixture = `
<!DOCTYPE html>
<html>
<head><title>Test Article</title></head>
<body>
  <h1 class="article-title">My Article</h1>
  <div class="article-body">
    <p>Article content here.</p>
  </div>
</body>
</html>
`;

// Use in tests
const doc = new DOMParser().parseFromString(fixture, "text/html");
```

## Sharing Templates

### Export/Import

Templates can be exported as JSON for sharing:

```json
{
  "domain": "example.com",
  "name": "Example Site",
  "selectors": {
    "title": "h1.article-title",
    "content": ".article-body"
  },
  "enabled": true
}
```

Import via the options page (coming soon).

### Contributing Built-ins

To contribute a template to the extension:

1. Fork the repository
2. Add your template to `src/content/templates/`
3. Register it in `src/content/templates/index.ts`
4. Add tests in `tests/templates/`
5. Add a test HTML fixture
6. Submit a pull request

### Template Guidelines

When contributing templates:

1. **Test thoroughly** across multiple pages on the site
2. **Handle edge cases** - missing elements, different page types
3. **Use fallbacks** - multiple selectors for resilience
4. **Document** - add comments explaining the site structure
5. **Keep it minimal** - only extract what's useful
6. **Consider variations** - mobile vs desktop, A/B tests, etc.

## Troubleshooting

### Template Not Matching

1. Check the domain pattern matches the URL
2. Verify `enabled: true`
3. Check priority if multiple templates could match
4. Use `urlPattern` for path-specific matching

### Selectors Not Working

1. Inspect the page to verify selectors
2. Check if content is in Shadow DOM (requires custom logic)
3. Look for dynamically generated classes (use attribute selectors)
4. Test selectors in the browser console: `document.querySelector("your-selector")`

### Content Missing or Incomplete

1. Add `removeSelectors` to clean up noise
2. Check if content is loaded via JavaScript (may need wait logic)
3. Verify the content selector targets the right container

### Wrong Template Used

1. Check priority values
2. Use `urlPattern` for disambiguation
3. Check for overlapping domain patterns

## API Reference

### TemplateRegistry

```typescript
// Register a built-in template
registerBuiltInTemplate(template: SiteTemplate): void

// Register multiple templates
registerBuiltInTemplates(templates: SiteTemplate[]): void

// Get all built-in templates
getBuiltInTemplates(): SiteTemplate[]

// Clear all templates (for testing)
clearBuiltInTemplates(): void
```

### Template Matching

```typescript
// Get the best matching template for a URL
getTemplateForUrl(
  url: string,
  options?: GetTemplateOptions
): SiteTemplate | null

// Get all matching templates
getAllMatchingTemplates(
  url: string,
  options?: GetTemplateOptions
): SiteTemplate[]

// Check if domain pattern matches a hostname
matchDomain(pattern: string, hostname: string): boolean

// Convert glob pattern to regex
globToRegex(pattern: string): RegExp
```

### GetTemplateOptions

```typescript
interface GetTemplateOptions {
  // User's custom templates
  customTemplates?: SiteTemplate[];
  
  // Built-in domains to exclude
  disabledBuiltIns?: string[];
  
  // Whether to include built-ins (default: true)
  includeBuiltIns?: boolean;
}
```

## Examples

### Simple Blog Template

```typescript
export const blogTemplate: SiteTemplate = {
  domain: "myblog.com",
  name: "My Blog",
  enabled: true,
  selectors: {
    title: "h1",
    content: "article",
    author: ".author",
    date: "time"
  }
};
```

### Complex Site with Multiple Page Types

```typescript
// Product pages
export const shopProductTemplate: SiteTemplate = {
  domain: "shop.example.com",
  name: "Shop - Products",
  urlPattern: "^/products/",
  priority: 100,
  selectors: {
    title: "h1.product-name",
    content: ".product-description",
    image: ".product-image img"
  },
  frontmatterExtras: {
    page_type: "product"
  }
};

// Category pages
export const shopCategoryTemplate: SiteTemplate = {
  domain: "shop.example.com",
  name: "Shop - Categories",
  urlPattern: "^/category/",
  priority: 100,
  selectors: {
    title: "h1.category-title",
    content: ".product-listing"
  },
  frontmatterExtras: {
    page_type: "category"
  }
};

// Catch-all for other pages
export const shopGeneralTemplate: SiteTemplate = {
  domain: "shop.example.com",
  name: "Shop - General",
  priority: 10,
  selectors: {
    title: "h1",
    content: "main"
  }
};
```

### Documentation Site

```typescript
export const docsTemplate: SiteTemplate = {
  domain: "docs.myapi.com",
  name: "My API Docs",
  enabled: true,
  selectors: {
    title: "h1",
    content: ".markdown-body",
    description: ".lead"
  },
  removeSelectors: [
    ".edit-link",
    ".nav-links",
    ".toc-sidebar"
  ],
  frontmatterExtras: {
    site: "my-api-docs",
    type: "documentation"
  }
};
```

---

For more information, see the source code in `src/content/templates/` and `src/shared/templates.ts`.
