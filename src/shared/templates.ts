/**
 * Site-specific template types for custom extraction rules per domain.
 * Templates allow fine-grained control over how content is extracted
 * from specific sites, replacing the generic Readability-based extraction.
 */

/**
 * CSS selectors for extracting specific content from a page.
 * All selectors are optional - only provide what you need to customize.
 */
export interface TemplateSelectors {
  /** CSS selector for the main title/heading */
  title?: string;
  
  /** CSS selector for the main content area */
  content?: string;
  
  /** CSS selector for the author name */
  author?: string;
  
  /** CSS selector for the publication date */
  date?: string;
  
  /** CSS selector for tags/categories */
  tags?: string;
  
  /** CSS selector for the description/summary */
  description?: string;
  
  /** CSS selector for the canonical URL */
  url?: string;
  
  /** CSS selector for the main image */
  image?: string;
}

/**
 * A site-specific template that defines custom extraction rules for a domain.
 * When a template matches a URL, its selectors are used instead of Readability.
 */
export interface SiteTemplate {
  /** Domain pattern to match (e.g., "reddit.com", "*.medium.com", "old.reddit.com") */
  domain: string;
  
  /** Human-readable name for the template (e.g., "Reddit", "Hacker News") */
  name: string;
  
  /** CSS selectors for content extraction */
  selectors: TemplateSelectors;
  
  /** CSS selectors for elements to remove before extraction (e.g., ads, nav, footer) */
  removeSelectors?: string[];
  
  /** Additional frontmatter fields to include (key-value pairs) */
  frontmatterExtras?: Record<string, string>;
  
  /** Whether this template is currently enabled */
  enabled: boolean;
  
  /** Priority for template matching (higher = checked first). Default: 0 */
  priority?: number;
  
  /** Optional description of what this template does */
  description?: string;
  
  /** Optional URL pattern for more precise matching (regex or glob) */
  urlPattern?: string;
}

/**
 * Result of template matching for a URL.
 */
export interface TemplateMatchResult {
  /** The matching template, if any */
  template: SiteTemplate | null;
  
  /** The domain that was matched */
  matchedDomain: string;
  
  /** Whether the match was from a built-in or custom template */
  source: "built-in" | "custom";
}

/**
 * Template configuration stored in settings.
 */
export interface TemplateSettings {
  /** Custom user-defined templates */
  customTemplates: SiteTemplate[];
  
  /** Built-in templates that have been disabled by the user */
  disabledBuiltIns: string[];
  
  /** Whether template system is enabled globally */
  templatesEnabled: boolean;
}

/**
 * Default template settings.
 */
export const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = {
  customTemplates: [],
  disabledBuiltIns: [],
  templatesEnabled: true
};

/**
 * Built-in template definitions will be registered in src/content/templates/
 * Each template file exports a SiteTemplate object.
 * 
 * Example built-in templates:
 * - Reddit (old.reddit.com and new reddit)
 * - Hacker News
 * - Stack Overflow
 * - GitHub
 * - Wikipedia
 * - Medium
 * - Substack
 * - ArXiv
 * - Documentation sites
 * - Amazon products
 * - Recipe sites
 */
