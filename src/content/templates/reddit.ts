/**
 * Reddit site template for extracting posts.
 * 
 * Handles both:
 * - Old Reddit (old.reddit.com)
 * - New Reddit (reddit.com, www.reddit.com)
 * 
 * Extracts post title, body, author, subreddit, score, and top comments.
 * Adds subreddit as a tag for organization.
 */

import type { SiteTemplate } from "../../shared/templates";

/**
 * Reddit template for old.reddit.com
 * Uses classic CSS selectors for the legacy interface.
 */
export const redditOldTemplate: SiteTemplate = {
  domain: "old.reddit.com",
  name: "Reddit (Old)",
  description: "Extract Reddit posts from old.reddit.com",
  enabled: true,
  priority: 100, // Higher priority than the general reddit.com template
  selectors: {
    // Title is in .title > a.title within the "thing" div
    title: "#siteTable .title > a.title, .link .title > a.title",
    // Post content (for self posts)
    content: "#siteTable .expando .usertext-body .md, .link .usertext-body .md, #siteTable .selftext .md",
    // Author username
    author: "#siteTable .author, .link .author",
    // Post date
    date: "#siteTable .tagline time, .link .tagline time",
    // Tags placeholder - subreddit extracted separately
    tags: ""
  },
  removeSelectors: [
    // Remove "reply" buttons, edit forms, vote buttons
    ".flat-list.buttons",
    ".voteButtons",
    ".expando-button",
    ".give-gold-button",
    ".reportform",
    // Remove "load more comments" placeholders - we handle this separately
    ".morecomments"
  ],
  frontmatterExtras: {
    site: "reddit"
  }
};

/**
 * Reddit template for new Reddit (reddit.com, www.reddit.com)
 * Uses shreddit-* web components and modern selectors.
 */
export const redditNewTemplate: SiteTemplate = {
  domain: "reddit.com",
  name: "Reddit",
  description: "Extract Reddit posts from the modern interface",
  enabled: true,
  priority: 50,
  urlPattern: "^/r/[^/]+/comments/", // Only match post pages, not home/listing pages
  selectors: {
    // New Reddit uses shreddit-post web component with title attribute
    title: "shreddit-post [slot='title'], h1[slot='title'], shreddit-post h1",
    // Content is in the shreddit-post or comment-tree
    content: "shreddit-post, div[data-testid='post-container'], article[data-testid='post-content']",
    // Author from shreddit-post author attribute or fallback selectors
    author: "shreddit-post a[href^='/u/'], shreddit-post a[href*='user/'], a[data-click-id='user']",
    // Date from time element
    date: "shreddit-post time, time[datetime], faceplate-timeago time",
    // Tags placeholder - subreddit extracted separately
    tags: ""
  },
  removeSelectors: [
    // Remove buttons, icons, tracking elements
    "shreddit-post button",
    "shreddit-post [data-click-id]",
    "faceplate-tracker",
    ".icon",
    "shreddit-share-button",
    "shreddit-save-button",
    "shreddit-overflow-menu",
    // Remove inline styles that clutter content
    "[style]"
  ],
  frontmatterExtras: {
    site: "reddit"
  }
};

/**
 * Combined Reddit template with custom extraction logic.
 * This template handles both old and new Reddit with specialized extraction.
 */
export const redditTemplate: SiteTemplate = {
  domain: "*.reddit.com", // Match all reddit.com subdomains
  name: "Reddit (Auto-detect)",
  description: "Auto-detect Reddit interface and extract posts with comments",
  enabled: true,
  priority: 10, // Lower priority - specific templates above take precedence
  selectors: {
    // These are fallback selectors; actual extraction uses custom logic below
    title: "h1, [data-testid='post-title'], .title",
    content: "article, .md, [data-testid='post-content']",
    author: "[data-testid='post-author'], .author, a[href*='/u/']",
    date: "time, [data-testid='post-timestamp'], .live-timestamp"
  },
  frontmatterExtras: {
    site: "reddit"
  }
};

/**
 * Extract subreddit name from URL or page content.
 */
function extractSubreddit(doc: Document, url: string): string | null {
  // Try URL extraction first
  const urlMatch = url.match(/reddit\.com\/r\/([^/]+)/i);
  if (urlMatch) {
    return urlMatch[1].toLowerCase();
  }

  // Try page selectors
  const selectors = [
    // Old Reddit
    ".subreddit a[href^='/r/']",
    "a.subreddit",
    ".redditname a",
    // New Reddit
    "a[href^='/r/']",
    "[data-community-name]",
    "shreddit-subreddit-icon"
  ];

  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (el) {
      const text = el.textContent?.trim() || "";
      const href = el.getAttribute("href") || "";
      
      // Extract from text (e.g., "r/programming")
      const textMatch = text.match(/r\/(\w+)/i);
      if (textMatch) return textMatch[1].toLowerCase();
      
      // Extract from href (e.g., "/r/programming/")
      const hrefMatch = href.match(/\/r\/(\w+)/i);
      if (hrefMatch) return hrefMatch[1].toLowerCase();
      
      // Check data-community-name attribute
      const dataName = el.getAttribute("data-community-name");
      if (dataName) return dataName.toLowerCase();
    }
  }

  return null;
}

/**
 * Extract post score from old Reddit.
 */
function extractOldRedditScore(doc: Document): number | null {
  const scoreEl = doc.querySelector("#siteTable .score.unvoted, .link .score.unvoted");
  if (scoreEl) {
    const text = scoreEl.textContent?.trim() || "";
    // Handle formats like "1.2k", "15.3k", etc.
    const num = parseScore(text);
    if (num !== null) return num;
  }
  return null;
}

/**
 * Extract post score from new Reddit.
 */
function extractNewRedditScore(doc: Document): number | null {
  // New Reddit stores score in shreddit-post attribute
  const postEl = doc.querySelector("shreddit-post");
  if (postEl) {
    const scoreAttr = postEl.getAttribute("score");
    if (scoreAttr) {
      const num = parseInt(scoreAttr, 10);
      if (!isNaN(num)) return num;
    }
  }

  // Fallback to score display elements
  const scoreEl = doc.querySelector("[data-testid='post-container'] [aria-label*='upvote'], .vote-arrow + span");
  if (scoreEl) {
    const text = scoreEl.textContent?.trim() || "";
    const num = parseScore(text);
    if (num !== null) return num;
  }

  return null;
}

/**
 * Parse a score string like "1.2k", "15.3k", "123" into a number.
 */
function parseScore(text: string): number | null {
  const clean = text.replace(/[^0-9.kKmMbB]/g, "").trim();
  if (!clean) return null;

  const match = clean.match(/^([\d.]+)\s*([kKmMbB]?)$/);
  if (!match) return null;

  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;

  const suffix = match[2].toLowerCase();
  switch (suffix) {
    case "k": return Math.round(num * 1000);
    case "m": return Math.round(num * 1000000);
    case "b": return Math.round(num * 1000000000);
    default: return Math.round(num);
  }
}

/**
 * Extract top comments from old Reddit.
 */
function extractOldRedditComments(doc: Document, maxComments: number = 10): Array<{
  author: string;
  body: string;
  score: string;
}> {
  const comments: Array<{ author: string; body: string; score: string }> = [];
  const commentEls = doc.querySelectorAll(".comment .entry");

  for (const commentEl of Array.from(commentEls).slice(0, maxComments)) {
    const authorEl = commentEl.querySelector(".author");
    const bodyEl = commentEl.querySelector(".md");
    const scoreEl = commentEl.querySelector(".score.unvoted");

    if (bodyEl) {
      comments.push({
        author: authorEl?.textContent?.trim() || "[deleted]",
        body: bodyEl.textContent?.trim() || "",
        score: scoreEl?.textContent?.trim() || "0"
      });
    }
  }

  return comments;
}

/**
 * Extract top comments from new Reddit.
 */
function extractNewRedditComments(doc: Document, maxComments: number = 10): Array<{
  author: string;
  body: string;
  score: string;
}> {
  const comments: Array<{ author: string; body: string; score: string }> = [];
  
  // New Reddit uses shreddit-comment web components
  const commentEls = doc.querySelectorAll("shreddit-comment, [data-testid='comment']");

  for (const commentEl of Array.from(commentEls).slice(0, maxComments)) {
    let author = "[deleted]";
    let body = "";
    let score = "0";

    // Handle shreddit-comment (web component)
    if (commentEl.tagName.toLowerCase() === "shreddit-comment") {
      author = commentEl.getAttribute("author") || "[deleted]";
      const contentEl = commentEl.querySelector("div[slot='comment'], .md, p");
      body = contentEl?.textContent?.trim() || "";
      const permalink = commentEl.getAttribute("permalink") || "";
      // Score might be in an attribute or nested element
      score = commentEl.getAttribute("score") || "0";
    } else {
      // Handle standard HTML comments
      const authorEl = commentEl.querySelector("a[href^='/u/'], a[href*='user/'], [data-testid='comment-author']");
      author = authorEl?.textContent?.trim() || "[deleted]";
      const bodyEl = commentEl.querySelector(".md, [data-testid='comment-body'], p");
      body = bodyEl?.textContent?.trim() || "";
      // Score might be in aria-label or text
      const scoreEl = commentEl.querySelector("[aria-label*='upvote'], .score");
      if (scoreEl) {
        score = scoreEl.getAttribute("aria-label")?.match(/\d+/)?.[0] || 
                scoreEl.textContent?.trim() || "0";
      }
    }

    if (body) {
      comments.push({ author, body, score });
    }
  }

  return comments;
}

/**
 * Detect which Reddit interface is being used.
 */
function detectRedditInterface(doc: Document): "old" | "new" {
  // Old Reddit has #siteTable
  if (doc.querySelector("#siteTable, .linklisting")) {
    return "old";
  }
  // New Reddit uses shreddit-* web components
  if (doc.querySelector("shreddit-post, shreddit-comment, faceplate-tracker")) {
    return "new";
  }
  // Default to new for unknown
  return "new";
}

/**
 * Format comments as markdown.
 */
function formatComments(comments: Array<{ author: string; body: string; score: string }>): string {
  if (comments.length === 0) return "";

  let md = "\n\n## Comments\n\n";
  
  for (const comment of comments) {
    md += `**${comment.author}** (↑${comment.score})\n\n`;
    md += `${comment.body}\n\n---\n\n`;
  }

  return md;
}

// Note: The extractWithTemplate function in web.ts handles selector-based extraction.
// For Reddit, we rely on the specific old/new templates with their selectors.
// The utility functions above (extractSubreddit, extractScore, extractComments)
// can be used in future enhancements to add richer metadata extraction.

// Register the templates
import { registerBuiltInTemplates } from "./registry";

registerBuiltInTemplates([redditOldTemplate, redditNewTemplate, redditTemplate]);

// Also export for testing
export {
  extractSubreddit,
  extractOldRedditScore,
  extractNewRedditScore,
  parseScore,
  extractOldRedditComments,
  extractNewRedditComments,
  detectRedditInterface,
  formatComments
};
