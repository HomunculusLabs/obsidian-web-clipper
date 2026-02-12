/**
 * Hacker News Template Tests
 *
 * Tests for Hacker News content extraction from story pages and listings.
 */

import { describe, test, expect } from "bun:test";

import {
  hackerNewsItemTemplate,
  hackerNewsListingTemplate,
  extractStoryId,
  isItemPage,
  extractPoints,
  extractCommentCount,
  isSelfPost,
  formatComments,
  formatStoriesListing
} from "../../src/content/templates/hackernews";

// ============================================================================
// Template Configuration Tests
// ============================================================================

describe("Hacker News templates configuration", () => {
  test("hackerNewsItemTemplate has correct configuration", () => {
    expect(hackerNewsItemTemplate.domain).toBe("news.ycombinator.com");
    expect(hackerNewsItemTemplate.name).toContain("Hacker News");
    expect(hackerNewsItemTemplate.priority).toBe(100);
    expect(hackerNewsItemTemplate.enabled).toBe(true);
    expect(hackerNewsItemTemplate.urlPattern).toContain("/item");
    expect(hackerNewsItemTemplate.frontmatterExtras?.site).toBe("hacker-news");
  });

  test("hackerNewsListingTemplate has lower priority than item template", () => {
    expect(hackerNewsListingTemplate.domain).toBe("news.ycombinator.com");
    expect(hackerNewsListingTemplate.priority).toBe(50);
    expect(hackerNewsListingTemplate.priority).toBeLessThan(hackerNewsItemTemplate.priority!);
    expect(hackerNewsListingTemplate.frontmatterExtras?.page_type).toBe("listing");
  });

  test("removeSelectors removes voting and navigation elements", () => {
    expect(hackerNewsItemTemplate.removeSelectors).toBeDefined();
    expect(hackerNewsItemTemplate.removeSelectors).toContain(".votearrow");
    expect(hackerNewsItemTemplate.removeSelectors).toContain(".votelinks");
    expect(hackerNewsItemTemplate.removeSelectors).toContain(".reply");
  });
});

// ============================================================================
// extractStoryId Tests
// ============================================================================

describe("extractStoryId", () => {
  test("extracts ID from item URL", () => {
    expect(extractStoryId("https://news.ycombinator.com/item?id=12345")).toBe("12345");
    expect(extractStoryId("https://news.ycombinator.com/item?id=999999")).toBe("999999");
  });

  test("extracts ID with other query params", () => {
    expect(extractStoryId("https://news.ycombinator.com/item?id=12345&foo=bar")).toBe("12345");
  });

  test("returns null for non-item URLs", () => {
    expect(extractStoryId("https://news.ycombinator.com/")).toBeNull();
    expect(extractStoryId("https://example.com/")).toBeNull();
  });
});

// ============================================================================
// isItemPage Tests
// ============================================================================

describe("isItemPage", () => {
  test("returns true for item pages", () => {
    expect(isItemPage("https://news.ycombinator.com/item?id=123")).toBe(true);
    expect(isItemPage("/item?id=456")).toBe(true);
  });

  test("returns false for non-item pages", () => {
    expect(isItemPage("https://news.ycombinator.com/")).toBe(false);
    expect(isItemPage("https://news.ycombinator.com/news")).toBe(false);
    expect(isItemPage("https://news.ycombinator.com/ask")).toBe(false);
  });
});

// ============================================================================
// extractPoints Tests
// ============================================================================

describe("extractPoints", () => {
  // These would need JSDOM to test with real DOM
  // For now, test the expected behavior from score text parsing

  test("function exists and is callable", () => {
    expect(typeof extractPoints).toBe("function");
  });

  // Expected behavior: parse "123 points" from .subtext .score
  // The function parses the score element text
});

// ============================================================================
// extractCommentCount Tests
// ============================================================================

describe("extractCommentCount", () => {
  test("function exists and is callable", () => {
    expect(typeof extractCommentCount).toBe("function");
  });

  // Expected behavior: parse "123 comments" from .subtext
});

// ============================================================================
// isSelfPost Tests
// ============================================================================

describe("isSelfPost", () => {
  test("identifies Ask HN posts", () => {
    expect(isSelfPost("Ask HN: What are you working on?")).toBe(true);
    expect(isSelfPost("ask hn: lowercase version")).toBe(true);
  });

  test("identifies Show HN posts", () => {
    expect(isSelfPost("Show HN: My new project")).toBe(true);
    expect(isSelfPost("SHOW HN: UPPERCASE")).toBe(true);
  });

  test("identifies Tell HN and Launch HN posts", () => {
    expect(isSelfPost("Tell HN: Something important")).toBe(true);
    expect(isSelfPost("Launch HN: New Startup")).toBe(true);
  });

  test("returns false for regular posts", () => {
    expect(isSelfPost("Some random article title")).toBe(false);
    expect(isSelfPost("How to do X in JavaScript")).toBe(false);
  });
});

// ============================================================================
// formatComments Tests
// ============================================================================

describe("formatComments (Hacker News)", () => {
  test("formats comments with indentation", () => {
    const comments = [
      { author: "alice", body: "Top level comment", score: "10", indent: 0 },
      { author: "bob", body: "Reply to alice", score: "5", indent: 1 },
      { author: "charlie", body: "Deep reply", score: "2", indent: 2 }
    ];
    const result = formatComments(comments);

    expect(result).toContain("## Comments");
    expect(result).toContain("**alice**");
    expect(result).toContain("Top level comment");
    expect(result).toContain("**bob**");
    expect(result).toContain("Reply to alice");
  });

  test("handles empty comments array", () => {
    expect(formatComments([])).toBe("");
  });

  test("includes score when available", () => {
    const comments = [{ author: "user", body: "Comment", score: "42", indent: 0 }];
    const result = formatComments(comments);
    expect(result).toContain("(42)");
  });
});

// ============================================================================
// formatStoriesListing Tests
// ============================================================================

describe("formatStoriesListing", () => {
  test("formats story listing as markdown", () => {
    const stories = [
      { rank: 1, title: "First Story", url: "https://example.com/1", points: 100, author: "user1", comments: 50 },
      { rank: 2, title: "Second Story", url: "https://example.com/2", points: 75, author: "user2", comments: 25 }
    ];
    const result = formatStoriesListing(stories);

    expect(result).toContain("# Hacker News Front Page");
    expect(result).toContain("1. **[First Story]");
    expect(result).toContain("100 pts");
    expect(result).toContain("50 comments");
    expect(result).toContain("by user1");
    expect(result).toContain("2. **[Second Story]");
  });

  test("handles stories without points or comments", () => {
    const stories = [
      { rank: 1, title: "New Story", url: "https://example.com", points: null, author: "anon", comments: null }
    ];
    const result = formatStoriesListing(stories);

    expect(result).toContain("New Story");
    expect(result).toContain("by anon");
  });
});

// ============================================================================
// Expected Markdown Output Tests
// ============================================================================

describe("Expected Hacker News markdown output", () => {
  test("HN story markdown structure expectation", () => {
    // Expected markdown structure for an HN story:
    // # Story Title
    //
    // > External URL: https://...
    //
    // Points: 123 | Author: username | 45 comments
    //
    // ## Comments
    //
    // **username1** (score)
    //
    // Comment body...
    //
    // > **username2** (score)
    // >
    // > Reply content...

    const comments = [
      { author: "dang", body: "Moderator comment", score: "50", indent: 0 },
      { author: "user", body: "Thanks!", score: "5", indent: 1 }
    ];
    const formatted = formatComments(comments);

    expect(formatted).toContain("dang");
    expect(formatted).toContain("Moderator comment");
  });

  test("HN listing markdown structure expectation", () => {
    // Expected markdown structure for HN front page:
    // # Hacker News Front Page
    //
    // 1. **[Story Title](url)** (points pts, N comments) by author
    // 2. **[Another Story](url)** ...

    const stories = [
      { rank: 1, title: "Test Story", url: "https://example.com", points: 42, author: "pg", comments: 10 }
    ];
    const formatted = formatStoriesListing(stories);

    expect(formatted).toContain("# Hacker News Front Page");
    expect(formatted).toContain("**[Test Story]");
    expect(formatted).toContain("42 pts");
    expect(formatted).toContain("10 comments");
    expect(formatted).toContain("by pg");
  });
});
