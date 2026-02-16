/**
 * Template Registry Tests
 *
 * Tests for the template registry system:
 * - globToRegex pattern conversion
 * - matchDomain for domain matching
 * - matchUrlPattern for URL path matching
 * - getTemplateForUrl for finding the best matching template
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";

// Import the registry functions
import {
  globToRegex,
  matchDomain,
  matchUrlPattern,
  getTemplateForUrl,
  getAllMatchingTemplates,
  getBuiltInTemplates,
  clearBuiltInTemplates,
  registerBuiltInTemplate,
  type GetTemplateOptions
} from "../../src/content/templates/registry";

// Import the templates module to register all built-ins
import "../../src/content/templates";

// ============================================================================
// globToRegex Tests
// ============================================================================

describe("globToRegex", () => {
  test("converts simple domain without wildcards", () => {
    const regex = globToRegex("example.com");
    expect(regex.test("example.com")).toBe(true);
    expect(regex.test("sub.example.com")).toBe(false);
    expect(regex.test("example.org")).toBe(false);
  });

  test("converts single wildcard (*) for subdomain matching", () => {
    const regex = globToRegex("*.example.com");
    expect(regex.test("blog.example.com")).toBe(true);
    expect(regex.test("www.example.com")).toBe(true);
    expect(regex.test("deep.nested.example.com")).toBe(false); // * doesn't match dots
    expect(regex.test("example.com")).toBe(false); // * requires at least one char
  });

  test("converts double wildcard (**) for any sequence including dots", () => {
    const regex = globToRegex("**.example.com");
    expect(regex.test("blog.example.com")).toBe(true);
    expect(regex.test("deep.nested.example.com")).toBe(true);
    // Note: ** still requires at least one character before the dot
    expect(regex.test("example.com")).toBe(false);
  });

  test("handles literal dots", () => {
    const regex = globToRegex("www.example.com");
    expect(regex.test("www.example.com")).toBe(true);
    expect(regex.test("wwwXexampleXcom")).toBe(false);
  });

  test("handles character classes", () => {
    const regex = globToRegex("sub[123].example.com");
    expect(regex.test("sub1.example.com")).toBe(true);
    expect(regex.test("sub2.example.com")).toBe(true);
    expect(regex.test("sub3.example.com")).toBe(true);
    expect(regex.test("sub4.example.com")).toBe(false);
  });

  test("handles question mark wildcard", () => {
    const regex = globToRegex("file?.txt");
    expect(regex.test("file1.txt")).toBe(true);
    expect(regex.test("fileA.txt")).toBe(true);
    expect(regex.test("file12.txt")).toBe(false);
  });

  test("escapes regex special characters", () => {
    const regex = globToRegex("example.com/path?query=value");
    expect(regex.test("example.com/path?query=value")).toBe(true);
    // The ? is treated as a glob wildcard (matches single char), not literal
  });

  test("is case-insensitive", () => {
    const regex = globToRegex("Example.COM");
    expect(regex.test("example.com")).toBe(true);
    expect(regex.test("EXAMPLE.COM")).toBe(true);
  });
});

// ============================================================================
// matchDomain Tests
// ============================================================================

describe("matchDomain", () => {
  test("matches exact domain", () => {
    expect(matchDomain("example.com", "example.com")).toBe(true);
    expect(matchDomain("example.com", "other.com")).toBe(false);
  });

  test("matches subdomain when pattern is parent domain", () => {
    // "medium.com" pattern matches "blog.medium.com"
    expect(matchDomain("medium.com", "blog.medium.com")).toBe(true);
    expect(matchDomain("medium.com", "www.medium.com")).toBe(true);
    expect(matchDomain("medium.com", "medium.com")).toBe(true);
  });

  test("matches subdomain wildcard", () => {
    expect(matchDomain("*.medium.com", "blog.medium.com")).toBe(true);
    expect(matchDomain("*.medium.com", "medium.com")).toBe(false);
  });

  test("matches double wildcard", () => {
    expect(matchDomain("**.medium.com", "blog.medium.com")).toBe(true);
    expect(matchDomain("**.medium.com", "a.b.medium.com")).toBe(true);
    // Note: **.medium.com doesn't match bare "medium.com" (needs at least 1 char)
    // But "medium.com" pattern DOES match subdomains via implicit subdomain matching
    expect(matchDomain("medium.com", "a.b.medium.com")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(matchDomain("Example.COM", "example.com")).toBe(true);
    expect(matchDomain("example.com", "EXAMPLE.COM")).toBe(true);
  });

  test("handles reddit.com patterns", () => {
    expect(matchDomain("reddit.com", "www.reddit.com")).toBe(true);
    expect(matchDomain("reddit.com", "old.reddit.com")).toBe(true);
    expect(matchDomain("old.reddit.com", "old.reddit.com")).toBe(true);
    expect(matchDomain("old.reddit.com", "new.reddit.com")).toBe(false);
  });

  test("handles *.reddit.com wildcard", () => {
    expect(matchDomain("*.reddit.com", "www.reddit.com")).toBe(true);
    expect(matchDomain("*.reddit.com", "old.reddit.com")).toBe(true);
    expect(matchDomain("*.reddit.com", "reddit.com")).toBe(false);
  });

  test("handles news.ycombinator.com", () => {
    expect(matchDomain("news.ycombinator.com", "news.ycombinator.com")).toBe(true);
    expect(matchDomain("news.ycombinator.com", "ycombinator.com")).toBe(false);
  });
});

// ============================================================================
// matchUrlPattern Tests
// ============================================================================

describe("matchUrlPattern", () => {
  test("returns true when no pattern specified", () => {
    expect(matchUrlPattern(undefined, "https://example.com/anything")).toBe(true);
  });

  test("matches regex patterns against URL path", () => {
    // Regex patterns (^ or $) are tested against the URL PATH
    expect(matchUrlPattern("^/r/[^/]+/comments/", "https://reddit.com/r/programming/comments/abc/")).toBe(true);
    expect(matchUrlPattern("^/r/[^/]+/comments/", "https://reddit.com/r/programming")).toBe(false);
  });

  test("matches glob patterns for paths", () => {
    expect(matchUrlPattern("/item*", "https://news.ycombinator.com/item?id=123")).toBe(true);
    expect(matchUrlPattern("/item*", "https://news.ycombinator.com/other")).toBe(false);
  });

  test("handles query strings", () => {
    expect(matchUrlPattern("*id=*", "https://news.ycombinator.com/item?id=123")).toBe(true);
  });
});

// ============================================================================
// getTemplateForUrl Tests
// ============================================================================

describe("getTemplateForUrl", () => {
  test("returns null for unrecognized domains", () => {
    const template = getTemplateForUrl("https://unknown-random-site-12345.com/article");
    expect(template).toBeNull();
  });

  test("matches reddit.com URLs", () => {
    const template = getTemplateForUrl("https://reddit.com/r/programming/comments/abc123/title/");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Reddit");
  });

  test("matches old.reddit.com with higher priority template", () => {
    const template = getTemplateForUrl("https://old.reddit.com/r/programming/comments/abc123/");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Old");
  });

  test("matches news.ycombinator.com item pages", () => {
    const template = getTemplateForUrl("https://news.ycombinator.com/item?id=12345");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Hacker News");
  });

  test("matches github.com URLs", () => {
    const template = getTemplateForUrl("https://github.com/user/repo");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("GitHub");
  });

  test("matches wikipedia.org URLs", () => {
    const template = getTemplateForUrl("https://en.wikipedia.org/wiki/Example");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Wikipedia");
  });

  test("matches medium.com URLs", () => {
    const template = getTemplateForUrl("https://medium.com/@author/article-slug");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Medium");
  });

  test("matches substack.com URLs", () => {
    const template = getTemplateForUrl("https://newsletter.substack.com/p/article-slug");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Substack");
  });

  test("matches arxiv.org URLs", () => {
    const template = getTemplateForUrl("https://arxiv.org/abs/2301.12345");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("ArXiv");
  });

  test("matches stackoverflow.com URLs", () => {
    const template = getTemplateForUrl("https://stackoverflow.com/questions/12345/question-title");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Stack Overflow");
  });

  test("matches amazon.com URLs", () => {
    const template = getTemplateForUrl("https://www.amazon.com/dp/B0XXXXXXX");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Amazon");
  });

  test("respects disabledBuiltIns option", () => {
    // Get the template normally - use a URL that matches the reddit template
    const normalTemplate = getTemplateForUrl("https://reddit.com/r/test/comments/abc/title/");
    expect(normalTemplate).not.toBeNull();

    // Disable reddit.com templates
    const options: GetTemplateOptions = {
      disabledBuiltIns: ["reddit.com"]
    };
    const disabledTemplate = getTemplateForUrl("https://reddit.com/r/test/", options);
    
    // Should still get a template because old.reddit.com has different domain
    // But if we disable *.reddit.com it won't match
    const options2: GetTemplateOptions = {
      disabledBuiltIns: ["*.reddit.com", "reddit.com", "old.reddit.com"]
    };
    const disabledTemplate2 = getTemplateForUrl("https://reddit.com/r/test/", options2);
    expect(disabledTemplate2).toBeNull();
  });

  test("includes custom templates", () => {
    const customTemplate = {
      domain: "custom-test-site.example",
      name: "Custom Test",
      selectors: { content: "body" },
      enabled: true
    };

    const options: GetTemplateOptions = {
      customTemplates: [customTemplate],
      includeBuiltIns: false
    };

    const template = getTemplateForUrl("https://custom-test-site.example/page", options);
    expect(template).not.toBeNull();
    expect(template?.name).toBe("Custom Test");
  });

  test("prioritizes higher priority templates", () => {
    // Hacker News has different templates for item pages vs listing
    // The item template has priority 100, listing has priority 50
    const template = getTemplateForUrl("https://news.ycombinator.com/item?id=123");
    expect(template?.priority).toBe(100);
  });

  test("returns null for invalid URLs", () => {
    expect(getTemplateForUrl("not a url")).toBeNull();
    expect(getTemplateForUrl("")).toBeNull();
  });

  test("includeBuiltIns: false excludes built-in templates", () => {
    const options: GetTemplateOptions = {
      includeBuiltIns: false
    };
    const template = getTemplateForUrl("https://reddit.com/r/test/", options);
    expect(template).toBeNull();
  });
});

// ============================================================================
// getAllMatchingTemplates Tests
// ============================================================================

describe("getAllMatchingTemplates", () => {
  test("returns all matching templates sorted by priority", () => {
    const templates = getAllMatchingTemplates("https://reddit.com/r/programming/comments/abc/");
    expect(templates.length).toBeGreaterThan(0);
    
    // Check that they're sorted by priority (highest first)
    for (let i = 1; i < templates.length; i++) {
      const prevPriority = templates[i - 1].priority ?? 0;
      const currPriority = templates[i].priority ?? 0;
      expect(prevPriority).toBeGreaterThanOrEqual(currPriority);
    }
  });

  test("returns empty array for non-matching URL", () => {
    const templates = getAllMatchingTemplates("https://unknown-site-xyz.com/");
    expect(templates).toHaveLength(0);
  });
});

// ============================================================================
// Template Registration Tests
// ============================================================================

describe("template registration", () => {
  // These tests manage their own template state
  
  test("registerBuiltInTemplate adds template", () => {
    clearBuiltInTemplates();
    const template = {
      domain: "test.example",
      name: "Test",
      selectors: { content: "body" },
      enabled: true
    };
    
    registerBuiltInTemplate(template);
    const all = getBuiltInTemplates();
    expect(all).toContainEqual(template);
  });

  test("clearBuiltInTemplates removes all templates", () => {
    clearBuiltInTemplates();
    const template = {
      domain: "test.example",
      name: "Test",
      selectors: { content: "body" },
      enabled: true
    };
    
    registerBuiltInTemplate(template);
    expect(getBuiltInTemplates()).toHaveLength(1);
    
    clearBuiltInTemplates();
    expect(getBuiltInTemplates()).toHaveLength(0);
  });
});

// ============================================================================
// Built-in Templates Verification
// ============================================================================

// Import template modules directly to verify they exist
import * as redditTmpl from "../../src/content/templates/reddit";
import * as hnTmpl from "../../src/content/templates/hackernews";
import * as soTmpl from "../../src/content/templates/stackoverflow";
import * as ghTmpl from "../../src/content/templates/github";
import * as wikiTmpl from "../../src/content/templates/wikipedia";
import * as mediumTmpl from "../../src/content/templates/medium";
import * as substackTmpl from "../../src/content/templates/substack";
import * as arxivTmpl from "../../src/content/templates/arxiv";
import * as amazonTmpl from "../../src/content/templates/amazon";

describe("built-in templates verification", () => {
  test("all built-in templates have required fields", () => {
    // Clear and re-register by importing fresh from each module
    clearBuiltInTemplates();
    
    // Register templates from each module
    redditTmpl && registerBuiltInTemplate(redditTmpl.redditOldTemplate);
    redditTmpl && registerBuiltInTemplate(redditTmpl.redditNewTemplate);
    redditTmpl && registerBuiltInTemplate(redditTmpl.redditTemplate);
    hnTmpl && registerBuiltInTemplate(hnTmpl.hackerNewsItemTemplate);
    hnTmpl && registerBuiltInTemplate(hnTmpl.hackerNewsListingTemplate);
    soTmpl && registerBuiltInTemplate(soTmpl.stackOverflowTemplate);
    ghTmpl && registerBuiltInTemplate(ghTmpl.githubRepoTemplate);
    wikiTmpl && registerBuiltInTemplate(wikiTmpl.wikipediaTemplate);
    mediumTmpl && registerBuiltInTemplate(mediumTmpl.mediumTemplate);
    substackTmpl && registerBuiltInTemplate(substackTmpl.substackTemplate);
    arxivTmpl && registerBuiltInTemplate(arxivTmpl.arxivTemplate);
    amazonTmpl && registerBuiltInTemplate(amazonTmpl.amazonTemplate);
    
    const templates = getBuiltInTemplates();
    
    for (const template of templates) {
      expect(template.domain).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.selectors).toBeDefined();
      expect(template.enabled).toBeDefined();
    }
  });

  test("all built-in templates are enabled by default", () => {
    const templates = getBuiltInTemplates();
    const disabledTemplates = templates.filter(t => !t.enabled);
    expect(disabledTemplates).toHaveLength(0);
  });

  test("expected templates are registered", () => {
    const templates = getBuiltInTemplates();
    const domains = templates.map(t => t.domain);

    // Check that key templates are present
    expect(domains.some(d => d.includes("reddit.com"))).toBe(true);
    expect(domains.some(d => d.includes("ycombinator.com"))).toBe(true);
    expect(domains.some(d => d.includes("github.com"))).toBe(true);
    expect(domains.some(d => d.includes("wikipedia.org"))).toBe(true);
    expect(domains.some(d => d.includes("stackoverflow.com"))).toBe(true);
    expect(domains.some(d => d.includes("medium.com"))).toBe(true);
    expect(domains.some(d => d.includes("substack.com"))).toBe(true);
    expect(domains.some(d => d.includes("arxiv.org"))).toBe(true);
    expect(domains.some(d => d.includes("amazon.com"))).toBe(true);
  });
});
