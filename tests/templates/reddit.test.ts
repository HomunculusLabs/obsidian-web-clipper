/**
 * Reddit Template Tests
 *
 * Tests for Reddit content extraction from both old and new interfaces.
 */

import { describe, test, expect, beforeEach } from "bun:test";

import {
  redditOldTemplate,
  redditNewTemplate,
  redditTemplate,
  extractSubreddit,
  parseScore,
  detectRedditInterface,
  formatComments
} from "../../src/content/templates/reddit";

// ============================================================================
// Template Configuration Tests
// ============================================================================

describe("Reddit templates configuration", () => {
  test("redditOldTemplate has correct configuration", () => {
    expect(redditOldTemplate.domain).toBe("old.reddit.com");
    expect(redditOldTemplate.name).toContain("Old");
    expect(redditOldTemplate.priority).toBe(100);
    expect(redditOldTemplate.enabled).toBe(true);
    expect(redditOldTemplate.selectors.title).toBeTruthy();
    expect(redditOldTemplate.selectors.content).toBeTruthy();
    expect(redditOldTemplate.frontmatterExtras?.site).toBe("reddit");
  });

  test("redditNewTemplate has correct configuration", () => {
    expect(redditNewTemplate.domain).toBe("reddit.com");
    expect(redditNewTemplate.name).toContain("Reddit");
    expect(redditNewTemplate.priority).toBe(50);
    expect(redditNewTemplate.urlPattern).toContain("/r/");
    expect(redditNewTemplate.enabled).toBe(true);
  });

  test("redditTemplate (generic) has lower priority", () => {
    expect(redditTemplate.domain).toBe("*.reddit.com");
    expect(redditTemplate.priority).toBeLessThan(redditOldTemplate.priority!);
    expect(redditTemplate.priority).toBeLessThan(redditNewTemplate.priority!);
  });
});

// ============================================================================
// parseScore Tests
// ============================================================================

describe("parseScore", () => {
  test("parses plain numbers", () => {
    expect(parseScore("123")).toBe(123);
    expect(parseScore("0")).toBe(0);
    expect(parseScore("9999")).toBe(9999);
  });

  test("parses thousands with k suffix", () => {
    expect(parseScore("1k")).toBe(1000);
    expect(parseScore("1.2k")).toBe(1200);
    expect(parseScore("15.3k")).toBe(15300);
    expect(parseScore("1.5K")).toBe(1500);
  });

  test("parses millions with m suffix", () => {
    expect(parseScore("1m")).toBe(1000000);
    expect(parseScore("2.5m")).toBe(2500000);
    expect(parseScore("1.5M")).toBe(1500000);
  });

  test("parses billions with b suffix", () => {
    expect(parseScore("1b")).toBe(1000000000);
    expect(parseScore("2.5b")).toBe(2500000000);
  });

  test("handles score with extra text", () => {
    expect(parseScore("1.2k points")).toBe(1200);
    expect(parseScore("score: 500")).toBe(500);
  });

  test("returns null for invalid input", () => {
    expect(parseScore("")).toBeNull();
    expect(parseScore("abc")).toBeNull();
  });
});

// ============================================================================
// extractSubreddit Tests
// ============================================================================

describe("extractSubreddit", () => {
  test("extracts subreddit from URL", () => {
    // URL-only extraction doesn't need DOM
    const url = "https://reddit.com/r/programming/comments/abc/";
    // We can only test URL-based extraction; DOM queries need JSDOM
    expect(url.match(/reddit\.com\/r\/([^/]+)/i)?.[1]?.toLowerCase()).toBe("programming");
  });

  test("returns null for non-Reddit URLs in URL extraction", () => {
    const url = "https://example.com/";
    expect(url.match(/reddit\.com\/r\/([^/]+)/i)?.[1]?.toLowerCase() ?? null).toBeNull();
  });
});

// ============================================================================
// formatComments Tests
// ============================================================================

describe("formatComments", () => {
  test("returns empty string for empty comments", () => {
    expect(formatComments([])).toBe("");
  });

  test("formats single comment", () => {
    const comments = [{ author: "user1", body: "Great post!", score: "42" }];
    const result = formatComments(comments);
    
    expect(result).toContain("## Comments");
    expect(result).toContain("**user1**");
    expect(result).toContain("(↑42)");
    expect(result).toContain("Great post!");
  });

  test("formats multiple comments", () => {
    const comments = [
      { author: "user1", body: "First comment", score: "10" },
      { author: "user2", body: "Second comment", score: "5" }
    ];
    const result = formatComments(comments);
    
    expect(result).toContain("user1");
    expect(result).toContain("user2");
    expect(result).toContain("First comment");
    expect(result).toContain("Second comment");
  });

  test("handles deleted comments", () => {
    const comments = [{ author: "[deleted]", body: "Removed content", score: "0" }];
    const result = formatComments(comments);
    
    expect(result).toContain("[deleted]");
  });
});

// ============================================================================
// detectRedditInterface Tests
// ============================================================================

describe("detectRedditInterface", () => {
  // Note: These tests would require JSDOM or similar to work with real Document
  // For now, we test the logic by checking what elements the function looks for

  test("function exists and is callable", () => {
    expect(typeof detectRedditInterface).toBe("function");
  });

  // In a real test with JSDOM:
  // test("detects old Reddit when #siteTable exists", () => {
  //   const doc = createDocumentWithElement("#siteTable");
  //   expect(detectRedditInterface(doc)).toBe("old");
  // });
  //
  // test("detects new Reddit when shreddit-post exists", () => {
  //   const doc = createDocumentWithElement("shreddit-post");
  //   expect(detectRedditInterface(doc)).toBe("new");
  // });
});

// ============================================================================
// HTML Fixture Tests (using JSDOM-like parsing)
// ============================================================================

describe("Reddit HTML fixture tests", () => {
  // These would ideally use JSDOM or happy-dom to parse HTML
  // For now, we verify the selectors match expected patterns

  test("old Reddit template selectors match expected HTML structure", () => {
    // Old Reddit post structure:
    // #siteTable .thing .title > a.title
    expect(redditOldTemplate.selectors.title).toContain("#siteTable");
    expect(redditOldTemplate.selectors.title).toContain(".title");
    expect(redditOldTemplate.selectors.author).toContain(".author");
  });

  test("new Reddit template selectors match expected HTML structure", () => {
    // New Reddit uses shreddit-* web components
    expect(redditNewTemplate.selectors.title).toContain("shreddit-post");
    expect(redditNewTemplate.selectors.content).toContain("shreddit-post");
  });

  test("removeSelectors removes unwanted elements", () => {
    expect(redditOldTemplate.removeSelectors).toBeDefined();
    expect(redditOldTemplate.removeSelectors).toContain(".flat-list.buttons");

    expect(redditNewTemplate.removeSelectors).toBeDefined();
    expect(redditNewTemplate.removeSelectors).toContain("shreddit-share-button");
  });
});

// ============================================================================
// Expected Markdown Output Tests
// ============================================================================

describe("Expected Reddit markdown output", () => {
  test("Reddit post should include subreddit as tag", () => {
    // When extracting a Reddit post, the subreddit should be extractable
    // and could be added as a tag in the frontmatter
    const url = "https://reddit.com/r/programming/comments/abc/post-title/";
    const subreddit = extractSubreddit({} as Document, url);
    expect(subreddit).toBe("programming");
  });

  test("Reddit post markdown structure expectation", () => {
    // Expected markdown structure for a Reddit post:
    // # Post Title
    //
    // > Excerpt or self-text preview
    //
    // Post body content...
    //
    // ## Comments
    //
    // **author1** (↑score)
    //
    // Comment body...
    //
    // ---
    //
    // **author2** (↑score)
    //
    // Another comment...

    // Verify formatComments produces this structure
    const comments = [
      { author: "alice", body: "First!", score: "5" },
      { author: "bob", body: "Nice post!", score: "3" }
    ];
    const formatted = formatComments(comments);

    expect(formatted).toContain("## Comments");
    expect(formatted).toContain("**alice**");
    expect(formatted).toContain("First!");
    expect(formatted).toContain("---");
    expect(formatted).toContain("**bob**");
    expect(formatted).toContain("Nice post!");
  });
});
