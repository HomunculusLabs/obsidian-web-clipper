/**
 * Template registry for site-specific extraction rules.
 * 
 * Matches URLs against registered templates using glob patterns.
 * Templates with higher priority are checked first.
 */

import type { SiteTemplate } from "../../shared/templates";

/**
 * Internal registry of built-in templates.
 * Individual template files register themselves here on import.
 */
const builtInTemplates: SiteTemplate[] = [];

/**
 * Register a built-in template.
 * Called by individual template files when they are imported.
 */
export function registerBuiltInTemplate(template: SiteTemplate): void {
  builtInTemplates.push(template);
}

/**
 * Register multiple built-in templates at once.
 */
export function registerBuiltInTemplates(templates: SiteTemplate[]): void {
  for (const template of templates) {
    registerBuiltInTemplate(template);
  }
}

/**
 * Get all registered built-in templates.
 */
export function getBuiltInTemplates(): SiteTemplate[] {
  return [...builtInTemplates];
}

/**
 * Clear all built-in templates (useful for testing).
 */
export function clearBuiltInTemplates(): void {
  builtInTemplates.length = 0;
}

/**
 * Convert a glob pattern to a RegExp.
 * Supports:
 * - * matches any sequence of characters except dots (subdomain wildcard)
 * - ** matches any sequence of characters including dots
 * - ? matches any single character
 * - [chars] matches any character in the set
 * - Literal dots must match actual dots
 */
export function globToRegex(pattern: string): RegExp {
  let regex = "";
  let i = 0;
  
  while (i < pattern.length) {
    const char = pattern[i];
    
    if (char === "*") {
      // Check for **
      if (pattern[i + 1] === "*") {
        regex += ".*";
        i += 2;
      } else {
        // Single * matches anything except dots (for subdomain matching)
        regex += "[^.]*";
        i++;
      }
    } else if (char === "?") {
      regex += ".";
      i++;
    } else if (char === "[") {
      // Character class - find the closing bracket
      const start = i;
      let end = i + 1;
      while (end < pattern.length && pattern[end] !== "]") {
        end++;
      }
      regex += pattern.substring(start, end + 1);
      i = end + 1;
    } else if (isRegexSpecialChar(char)) {
      // Escape regex special characters
      regex += "\\" + char;
      i++;
    } else {
      regex += char;
      i++;
    }
  }
  
  return new RegExp("^" + regex + "$", "i");
}

/**
 * Check if a character has special meaning in regex.
 */
function isRegexSpecialChar(char: string): boolean {
  return ".^$+{}()|\\/".includes(char);
}

/**
 * Extract the hostname from a URL string.
 */
function extractHostname(url: string): string | null {
  try {
    // Handle URLs without protocol
    if (!url.includes("://")) {
      url = "https://" + url;
    }
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Check if a domain pattern matches a hostname.
 * 
 * @param pattern - The domain pattern (e.g., "*.medium.com", "reddit.com")
 * @param hostname - The hostname to match (e.g., "blog.medium.com")
 * @returns True if the pattern matches
 */
export function matchDomain(pattern: string, hostname: string): boolean {
  // Normalize both to lowercase for case-insensitive matching
  const normalizedPattern = pattern.toLowerCase();
  const normalizedHostname = hostname.toLowerCase();
  
  // Exact match
  if (normalizedPattern === normalizedHostname) {
    return true;
  }
  
  // Glob pattern match
  if (pattern.includes("*") || pattern.includes("?") || pattern.includes("[")) {
    const regex = globToRegex(normalizedPattern);
    return regex.test(normalizedHostname);
  }
  
  // Subdomain match: pattern "medium.com" matches "blog.medium.com"
  // This allows templates to match all subdomains without explicit wildcards
  if (normalizedHostname.endsWith("." + normalizedPattern)) {
    return true;
  }
  
  return false;
}

/**
 * Check if a URL matches a template's URL pattern (if specified).
 * 
 * @param urlPattern - Optional regex or glob pattern for URL path matching
 * @param url - The full URL to match
 * @returns True if no pattern or pattern matches
 */
export function matchUrlPattern(urlPattern: string | undefined, url: string): boolean {
  if (!urlPattern) {
    return true; // No pattern means match any URL on the domain
  }
  
  try {
    // Extract path for path-based patterns
    const urlObj = new URL(url);
    const pathWithQuery = urlObj.pathname + urlObj.search;
    
    // Try as regex first
    if (urlPattern.startsWith("^") || urlPattern.endsWith("$")) {
      // Regex patterns are tested against the PATH, not the full URL
      // This allows patterns like "^/r/[^/]+/comments/" to work correctly
      const regex = new RegExp(urlPattern, "i");
      return regex.test(pathWithQuery);
    }
    
    // Treat as glob pattern for the path
    const regex = globToRegex(urlPattern);
    return regex.test(pathWithQuery);
  } catch {
    return false;
  }
}

/**
 * Options for template matching.
 */
export interface GetTemplateOptions {
  /** Custom templates to include in matching (from user settings) */
  customTemplates?: SiteTemplate[];
  
  /** Built-in template domains to exclude (from user settings) */
  disabledBuiltIns?: string[];
  
  /** Whether to include built-in templates (default: true) */
  includeBuiltIns?: boolean;
}

/**
 * Find the best matching template for a URL.
 * 
 * Checks templates in priority order (highest first) and returns the first match.
 * Built-in templates are included by default unless disabled.
 * Custom templates are merged with built-ins and can override them.
 * 
 * @param url - The URL to find a template for
 * @param options - Matching options
 * @returns The matching template, or null if no match
 */
export function getTemplateForUrl(
  url: string,
  options: GetTemplateOptions = {}
): SiteTemplate | null {
  const {
    customTemplates = [],
    disabledBuiltIns = [],
    includeBuiltIns = true
  } = options;
  
  const hostname = extractHostname(url);
  if (!hostname) {
    return null;
  }
  
  // Combine templates: custom templates + built-in templates (filtered)
  let allTemplates: SiteTemplate[];
  
  if (includeBuiltIns) {
    const enabledBuiltIns = builtInTemplates.filter(
      (t) => !disabledBuiltIns.includes(t.domain) && t.enabled
    );
    allTemplates = [...customTemplates, ...enabledBuiltIns];
  } else {
    allTemplates = [...customTemplates];
  }
  
  // Sort by priority (highest first), then by specificity
  allTemplates.sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    if (priorityA !== priorityB) {
      return priorityB - priorityA;
    }
    // Longer domain patterns are more specific
    return b.domain.length - a.domain.length;
  });
  
  // Find first matching template
  for (const template of allTemplates) {
    if (!template.enabled) {
      continue;
    }
    
    if (matchDomain(template.domain, hostname)) {
      // Check URL pattern if specified
      if (matchUrlPattern(template.urlPattern, url)) {
        return template;
      }
    }
  }
  
  return null;
}

/**
 * Get all templates that match a URL (not just the best one).
 * Useful for showing user options or debugging.
 * 
 * @param url - The URL to find templates for
 * @param options - Matching options
 * @returns Array of all matching templates, sorted by priority
 */
export function getAllMatchingTemplates(
  url: string,
  options: GetTemplateOptions = {}
): SiteTemplate[] {
  const {
    customTemplates = [],
    disabledBuiltIns = [],
    includeBuiltIns = true
  } = options;
  
  const hostname = extractHostname(url);
  if (!hostname) {
    return [];
  }
  
  let allTemplates: SiteTemplate[];
  
  if (includeBuiltIns) {
    const enabledBuiltIns = builtInTemplates.filter(
      (t) => !disabledBuiltIns.includes(t.domain) && t.enabled
    );
    allTemplates = [...customTemplates, ...enabledBuiltIns];
  } else {
    allTemplates = [...customTemplates];
  }
  
  // Filter to matching templates
  const matching = allTemplates.filter((template) => {
    if (!template.enabled) {
      return false;
    }
    return (
      matchDomain(template.domain, hostname) &&
      matchUrlPattern(template.urlPattern, url)
    );
  });
  
  // Sort by priority (highest first)
  matching.sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    if (priorityA !== priorityB) {
      return priorityB - priorityA;
    }
    return b.domain.length - a.domain.length;
  });
  
  return matching;
}
