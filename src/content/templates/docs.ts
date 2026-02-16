/**
 * Documentation site template for extracting technical documentation.
 * 
 * Handles:
 * - MDN Web Docs (developer.mozilla.org)
 * - React docs (react.dev)
 * - TypeScript docs (typescriptlang.org)
 * - Vue.js docs (vuejs.org)
 * - Angular docs (angular.io)
 * - Node.js docs (nodejs.org)
 * - Generic docs sites
 * 
 * Extracts breadcrumb path, code examples, and navigation context.
 */

import type { SiteTemplate } from "../../shared/templates";
import { registerBuiltInTemplates } from "./registry";

// ============================================================================
// Template Definitions
// ============================================================================

/**
 * MDN Web Docs template.
 * Matches: developer.mozilla.org/en-US/docs/...
 */
export const mdnTemplate: SiteTemplate = {
  domain: "developer.mozilla.org",
  name: "MDN Web Docs",
  description: "Extract MDN documentation with code examples and browser compatibility",
  enabled: true,
  priority: 100,
  urlPattern: "^/[^/]+/docs/",
  selectors: {
    // Article title
    title: "h1#title, article h1",
    // Main content area
    content: "article.main-page-content, #content article, .main-content",
    // Last updated date
    date: ".last-modified-date time, .document-meta time",
    // Tags from sidebar
    tags: ".tags-list li a, .document-tags a"
  },
  removeSelectors: [
    // Remove edit buttons
    ".button.edit-button",
    "a.edit-section",
    // Remove "On this page" sidebar
    ".toc, #toc-aside",
    // Remove sidebar navigation
    ".sidebar, #sidebar-quicklinks",
    // Remove browser compat table (keep content, just the interactive JS part)
    ".bc-github-link",
    ".bc-notifications",
    // Remove feedback buttons
    ".on-github",
    // Remove language selector
    ".language-menu",
    // Remove "Found a problem" footer
    ".document-meta .on-github",
    // Remove print button
    "a[href*='print']",
    // Remove contribution section
    ".contribution-info"
  ],
  frontmatterExtras: {
    site: "mdn",
    type: "documentation"
  }
};

/**
 * React documentation template.
 * Matches: react.dev/learn, react.dev/reference, react.dev/blog
 */
export const reactDocsTemplate: SiteTemplate = {
  domain: "react.dev",
  name: "React Documentation",
  description: "Extract React docs with code examples and live playgrounds",
  enabled: true,
  priority: 100,
  selectors: {
    // Article title
    title: "h1, article h1",
    // Main content
    content: "article, .content, main .markdown",
    // Last updated (from git history)
    date: ".last-updated time, .git-info time"
  },
  removeSelectors: [
    // Remove "Edit this page" links
    "a[href*='github.com/facebook/react/tree/main']",
    // Remove table of contents
    ".toc, nav[aria-label='Table of contents']",
    // Remove breadcrumbs (we extract them separately)
    ".breadcrumbs",
    // Remove next/prev navigation
    ".pagination, .nav-links",
    // Remove live playground controls (keep code)
    ".sp-preview-container",
    ".sp-preview-wrapper",
    // Remove "Can you provide a translation?" banner
    ".translation-banner"
  ],
  frontmatterExtras: {
    site: "react",
    type: "documentation"
  }
};

/**
 * TypeScript documentation template.
 * Matches: typescriptlang.org/docs, typescriptlang.org/handbook
 */
export const typeScriptDocsTemplate: SiteTemplate = {
  domain: "typescriptlang.org",
  name: "TypeScript Documentation",
  description: "Extract TypeScript docs with code examples",
  enabled: true,
  priority: 100,
  selectors: {
    // Article title
    title: "h1, article h1, .content h1",
    // Main content
    content: "article, .content, .markdown-body",
    // Last updated
    date: ".last-updated, .modified-date"
  },
  removeSelectors: [
    // Remove edit links
    "a[href*='github.com/Microsoft/TypeScript-Handbook']",
    // Remove sidebar
    ".sidebar, nav.guide",
    // Remove breadcrumbs
    ".breadcrumbs",
    // Remove "Improve this page" link
    ".improve-this-page",
    // Remove navigation
    ".nav-links, .pagination"
  ],
  frontmatterExtras: {
    site: "typescript",
    type: "documentation"
  }
};

/**
 * Vue.js documentation template.
 * Matches: vuejs.org/guide, vuejs.org/api, vuejs.org/examples
 */
export const vueDocsTemplate: SiteTemplate = {
  domain: "vuejs.org",
  name: "Vue.js Documentation",
  description: "Extract Vue.js docs with code examples and API references",
  enabled: true,
  priority: 100,
  selectors: {
    // Article title
    title: "h1, .content h1, .title",
    // Main content
    content: ".content, article, .theme-default-content",
    // Last updated
    date: ".last-updated time, .page-meta time"
  },
  removeSelectors: [
    // Remove edit links
    "a[href*='github.com/vuejs/docs/edit']",
    // Remove table of contents
    ".table-of-contents, .toc",
    // Remove sidebar
    ".sidebar, aside",
    // Remove navigation
    ".page-nav, .nav-links",
    // Remove "Suggest changes" link
    ".suggest-changes"
  ],
  frontmatterExtras: {
    site: "vue",
    type: "documentation"
  }
};

/**
 * Angular documentation template.
 * Matches: angular.io/guide, angular.io/api, angular.io/tutorial
 */
export const angularDocsTemplate: SiteTemplate = {
  domain: "angular.io",
  name: "Angular Documentation",
  description: "Extract Angular docs with code examples",
  enabled: true,
  priority: 100,
  selectors: {
    // Article title
    title: "h1, article h1, .content h1",
    // Main content
    content: "article, .content, .docs-content",
    // Last updated (from git history)
    date: ".git-link, .last-updated"
  },
  removeSelectors: [
    // Remove edit links
    "a[href*='github.com/angular/angular/edit']",
    // Remove table of contents
    ".toc, .vertical-menu-item-container",
    // Remove side navigation
    "mat-sidenav, .sidenav",
    // Remove feedback widget
    ".feedback, aio-feedback",
    // Remove print button
    "button[print]"
  ],
  frontmatterExtras: {
    site: "angular",
    type: "documentation"
  }
};

/**
 * Node.js documentation template.
 * Matches: nodejs.org/api, nodejs.org/dist/latest/docs
 */
export const nodejsDocsTemplate: SiteTemplate = {
  domain: "nodejs.org",
  name: "Node.js Documentation",
  description: "Extract Node.js API documentation",
  enabled: true,
  priority: 100,
  urlPattern: "^/(api|dist/.*/docs/)",
  selectors: {
    // Section title
    title: "h1, #content h1",
    // API documentation content
    content: "#apicontent, #content, .api-content",
    // Version info
    description: ".version, .info"
  },
  removeSelectors: [
    // Remove edit links
    "a[href*='github.com/nodejs/node/edit']",
    // Remove navigation
    "#nav, nav",
    // Remove "Previous" / "Next" links
    ".nav",
    // Remove "Jump to" sections (we keep TOC though)
    ".jump"
  ],
  frontmatterExtras: {
    site: "nodejs",
    type: "documentation"
  }
};

/**
 * Next.js documentation template.
 * Matches: nextjs.org/docs
 */
export const nextjsDocsTemplate: SiteTemplate = {
  domain: "nextjs.org",
  name: "Next.js Documentation",
  description: "Extract Next.js docs with code examples",
  enabled: true,
  priority: 100,
  urlPattern: "^/docs",
  selectors: {
    // Article title
    title: "h1, .docs-content h1",
    // Main content
    content: ".docs-content, article, .content",
    // Last updated
    date: ".last-updated time, .modified-date"
  },
  removeSelectors: [
    // Remove edit links
    "a[href*='github.com/vercel/next.js/edit']",
    // Remove sidebar navigation
    ".docs-sidebar, nav",
    // Remove table of contents
    ".table-of-contents, .toc",
    // Remove "Previous" / "Next" links
    ".docs-footer, .pagination",
    // Remove feedback section
    ".docs-feedback, .feedback-form"
  ],
  frontmatterExtras: {
    site: "nextjs",
    type: "documentation"
  }
};

/**
 * Tailwind CSS documentation template.
 * Matches: tailwindcss.com/docs
 */
export const tailwindDocsTemplate: SiteTemplate = {
  domain: "tailwindcss.com",
  name: "Tailwind CSS Documentation",
  description: "Extract Tailwind docs with utility examples",
  enabled: true,
  priority: 100,
  urlPattern: "^/docs",
  selectors: {
    // Article title
    title: "h1, .docs-content h1",
    // Main content
    content: ".docs-content, article, .prose",
    // Category from sidebar (for context)
    description: ".category-name"
  },
  removeSelectors: [
    // Remove edit links
    "a[href*='github.com/tailwindlabs/tailwindcss.com/edit']",
    // Remove sidebar
    ".docs-sidebar, nav",
    // Remove table of contents
    ".docs-toc, .toc",
    // Remove "On this page" navigation
    ".on-this-page"
  ],
  frontmatterExtras: {
    site: "tailwindcss",
    type: "documentation"
  }
};

/**
 * Svelte documentation template.
 * Matches: svelte.dev/docs
 */
export const svelteDocsTemplate: SiteTemplate = {
  domain: "svelte.dev",
  name: "Svelte Documentation",
  description: "Extract Svelte docs with REPL examples",
  enabled: true,
  priority: 100,
  urlPattern: "^/docs",
  selectors: {
    // Article title
    title: "h1, .content h1",
    // Main content
    content: ".content, article, .docs-content",
    // Last updated
    date: ".last-modified, .updated"
  },
  removeSelectors: [
    // Remove edit links
    "a[href*='github.com/sveltejs/svelte/edit']",
    // Remove sidebar navigation
    ".sidebar, nav",
    // Remove REPL controls
    ".repl-controls",
    // Remove "Edit this page" button
    ".edit-link"
  ],
  frontmatterExtras: {
    site: "svelte",
    type: "documentation"
  }
};

/**
 * Nuxt documentation template.
 * Matches: nuxt.com/docs
 */
export const nuxtDocsTemplate: SiteTemplate = {
  domain: "nuxt.com",
  name: "Nuxt Documentation",
  description: "Extract Nuxt docs with code examples",
  enabled: true,
  priority: 100,
  urlPattern: "^/docs",
  selectors: {
    // Article title
    title: "h1, .docs-content h1",
    // Main content
    content: ".docs-content, article, .prose"
  },
  removeSelectors: [
    // Remove edit links
    "a[href*='github.com/nuxt/nuxt.com/edit']",
    // Remove sidebar
    ".docs-sidebar, nav",
    // Remove table of contents
    ".docs-toc",
    // Remove feedback
    ".docs-feedback"
  ],
  frontmatterExtras: {
    site: "nuxt",
    type: "documentation"
  }
};

// ============================================================================
// Extraction Utilities
// ============================================================================

/**
 * Extract breadcrumb path from documentation page.
 * Common patterns:
 * - nav.breadcrumb / nav[aria-label="breadcrumb"]
 * - ol.breadcrumb / ul.breadcrumb
 * - .breadcrumbs / #breadcrumbs
 */
export function extractBreadcrumbs(doc: Document): string[] {
  const breadcrumbs: string[] = [];
  
  // Try common breadcrumb selectors
  const selectors = [
    "nav[aria-label*='breadcrumb'] ol li a",
    "nav[aria-label*='breadcrumb'] ul li a",
    ".breadcrumb ol li a",
    ".breadcrumb ul li a",
    ".breadcrumbs ol li a",
    ".breadcrumbs ul li a",
    "#breadcrumbs a",
    "ol.breadcrumb li a",
    "ul.breadcrumb li a",
    // MDN specific
    ".breadcrumbs a",
    // Generic fallback
    "nav.breadcrumb a",
    "[itemtype*='BreadcrumbList'] a"
  ];
  
  for (const selector of selectors) {
    const links = doc.querySelectorAll(selector);
    if (links.length > 0) {
      for (const link of Array.from(links)) {
        const text = link.textContent?.trim();
        if (text && text.length > 0) {
          breadcrumbs.push(text);
        }
      }
      if (breadcrumbs.length > 0) {
        return breadcrumbs;
      }
    }
  }
  
  return breadcrumbs;
}

/**
 * Extract the current page's position in the documentation hierarchy.
 * Useful for context and organization.
 */
export function extractDocsNavigationContext(doc: Document): {
  section: string;
  subsection: string;
  breadcrumbs: string[];
} {
  const breadcrumbs = extractBreadcrumbs(doc);
  
  // Section is typically the first breadcrumb
  const section = breadcrumbs.length > 0 ? breadcrumbs[0] : "";
  
  // Subsection is typically the second-to-last (last is current page)
  const subsection = breadcrumbs.length > 1 
    ? breadcrumbs[breadcrumbs.length - 2] 
    : "";
  
  return {
    section,
    subsection,
    breadcrumbs
  };
}

/**
 * Count code examples in the documentation.
 * Useful for understanding the technical depth of a page.
 */
export function countCodeExamples(doc: Document): number {
  // Count pre blocks (typically code examples)
  const codeBlocks = doc.querySelectorAll("pre, .highlight, .code-example");
  return codeBlocks.length;
}

/**
 * Extract languages used in code examples.
 */
export function extractCodeLanguages(doc: Document): string[] {
  const languages = new Set<string>();
  
  // Check for language classes on code blocks
  const codeBlocks = doc.querySelectorAll("pre code, .highlight");
  
  for (const block of Array.from(codeBlocks)) {
    const classList = block.className;
    
    // Common language class patterns
    const patterns = [
      /language-(\w+)/,
      /lang-(\w+)/,
      /highlight-(?:source-)?(\w+)/,
      /(\w+)-code/,
      /^(\w+)$/  // Some sites just use the language name directly
    ];
    
    for (const pattern of patterns) {
      const match = classList.match(pattern);
      if (match && !["highlight", "code", "block", "example"].includes(match[1])) {
        languages.add(match[1].toLowerCase());
        break;
      }
    }
    
    // Check data-lang attribute
    const dataLang = block.getAttribute("data-lang");
    if (dataLang) {
      languages.add(dataLang.toLowerCase());
    }
  }
  
  return Array.from(languages).sort();
}

/**
 * Check if the page has interactive examples (JSFiddle, CodePen, StackBlitz, etc.).
 */
export function hasInteractiveExamples(doc: Document): boolean {
  const selectors = [
    "iframe[src*='jsfiddle']",
    "iframe[src*='codepen']",
    "iframe[src*='stackblitz']",
    "iframe[src*='codesandbox']",
    "iframe[src*='replit']",
    ".interactive-example",
    "[data-live-example]",
    ".live-editor",
    ".playground"
  ];
  
  for (const selector of selectors) {
    if (doc.querySelector(selector)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Format documentation content with breadcrumb context.
 */
export function formatDocsContent(
  title: string,
  content: string,
  navContext: ReturnType<typeof extractDocsNavigationContext>,
  codeLanguages: string[],
  hasInteractive: boolean
): string {
  let md = `# ${title}\n\n`;
  
  // Add breadcrumb context
  if (navContext.breadcrumbs.length > 0) {
    md += `> 📍 Path: ${navContext.breadcrumbs.join(" → ")}\n`;
    
    // Add section/subsection if available
    if (navContext.section && navContext.section !== title) {
      md += `> 📁 Section: ${navContext.section}\n`;
    }
    
    md += "\n";
  }
  
  // Add metadata about code examples
  if (codeLanguages.length > 0) {
    md += `> 💻 Languages: ${codeLanguages.map(l => `\`${l}\``).join(", ")}\n`;
  }
  
  if (hasInteractive) {
    md += `> ▶️ This page has interactive examples\n`;
  }
  
  if (codeLanguages.length > 0 || hasInteractive) {
    md += "\n";
  }
  
  // Add main content
  md += content;
  
  return md;
}

/**
 * Generate a suggested filename from breadcrumbs and title.
 * Example: "React > Hooks > useState" → "react-hooks-usestate.md"
 */
export function generateDocsFilename(
  breadcrumbs: string[],
  title: string,
  maxLength: number = 80
): string {
  const parts = [...breadcrumbs];
  
  // Don't duplicate title if it's already the last breadcrumb
  const lastBreadcrumb = parts[parts.length - 1]?.toLowerCase();
  const titleLower = title.toLowerCase();
  if (lastBreadcrumb !== titleLower) {
    parts.push(title);
  }
  
  // Join with hyphens and sanitize
  const filename = parts
    .map(part => part
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    )
    .filter(part => part.length > 0)
    .join("-");
  
  // Truncate if too long
  if (filename.length > maxLength) {
    return filename.substring(0, maxLength).replace(/-[^-]*$/, "");
  }
  
  return filename || "documentation";
}

// Register all documentation templates
registerBuiltInTemplates([
  mdnTemplate,
  reactDocsTemplate,
  typeScriptDocsTemplate,
  vueDocsTemplate,
  angularDocsTemplate,
  nodejsDocsTemplate,
  nextjsDocsTemplate,
  tailwindDocsTemplate,
  svelteDocsTemplate,
  nuxtDocsTemplate
]);
