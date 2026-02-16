/**
 * Hacker News site template for extracting posts and comments.
 * 
 * Handles:
 * - Story pages (news.ycombinator.com/item?id=...) with comments
 * - The main page listing (news.ycombinator.com) for clipping individual stories
 * 
 * Extracts story title, URL, points, author, top comments.
 * Adds "hacker-news" tag for organization.
 */

import type { SiteTemplate } from "../../shared/templates";
import { registerBuiltInTemplates } from "./registry";

/**
 * Main Hacker News template for story/comment pages.
 * Matches item pages with the full post and comments.
 */
export const hackerNewsItemTemplate: SiteTemplate = {
  domain: "news.ycombinator.com",
  name: "Hacker News",
  description: "Extract Hacker News stories and comments",
  enabled: true,
  priority: 100,
  urlPattern: "^/item", // Only match item pages
  selectors: {
    // Title in the title row
    title: ".titleline > a, .athing .title a",
    // Story link (if external URL)
    url: ".titleline > a, .athing .title a",
    // Content is the comment tree + possibly the text post
    content: "#hnmain",
    // Author from the subtext area
    author: ".subtext a.hnuser, .subtext a[href*='user']",
    // Date from the age span
    date: ".subtext .age, .subtext span[class*='age']"
  },
  removeSelectors: [
    // Remove voting buttons and forms
    ".votearrow",
    ".votelinks",
    ".vote",
    // Remove reply links and forms
    ".reply",
    ".togg",
    // Remove navigation
    ".pagetop",
    // Remove footer
    "table:nth-child(3)",
    // Remove spacer rows
    ".spacer"
  ],
  frontmatterExtras: {
    site: "hacker-news"
  }
};

/**
 * Hacker News homepage template for clipping the front page listing.
 * Extracts story titles, points, and links.
 */
export const hackerNewsListingTemplate: SiteTemplate = {
  domain: "news.ycombinator.com",
  name: "Hacker News (Listing)",
  description: "Extract the front page story listing",
  enabled: true,
  priority: 50,
  selectors: {
    // No specific title for the listing
    title: "",
    // Content is the stories table
    content: ".itemlist, table#hnmain",
    // No author for listing
    author: "",
    // No date for listing
    date: ""
  },
  removeSelectors: [
    ".votearrow",
    ".votelinks",
    ".vote",
    ".pagetop",
    "table:nth-child(3)",
    ".spacer",
    ".morelink"
  ],
  frontmatterExtras: {
    site: "hacker-news",
    page_type: "listing"
  }
};

/**
 * Extract story ID from the URL.
 */
export function extractStoryId(url: string): string | null {
  const match = url.match(/[?&]id=(\d+)/);
  return match ? match[1] : null;
}

/**
 * Check if this is an item page (story with comments).
 */
export function isItemPage(url: string): boolean {
  return url.includes("/item");
}

/**
 * Extract story points from the page.
 */
export function extractPoints(doc: Document): number | null {
  // Points are in the subtext area, format: "123 points"
  const scoreEl = doc.querySelector(".subtext .score");
  if (scoreEl) {
    const text = scoreEl.textContent?.trim() || "";
    const match = text.match(/(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  
  // Alternative: look for points in the subtext area
  const subtext = doc.querySelector(".subtext");
  if (subtext) {
    const text = subtext.textContent || "";
    const match = text.match(/(\d+)\s*points?/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  
  return null;
}

/**
 * Extract the external URL from a story (if not a text post).
 */
export function extractStoryUrl(doc: Document): string | null {
  // The story link has the external URL
  const titleLink = doc.querySelector(".titleline > a, .athing .title a.storylink");
  if (titleLink) {
    const href = titleLink.getAttribute("href");
    if (href && !href.startsWith("item?id=") && !href.startsWith("/item?id=")) {
      return href;
    }
  }
  return null;
}

/**
 * Extract the text content of a self-post (Ask HN, Show HN, etc.)
 */
export function extractStoryText(doc: Document): string | null {
  // Text posts have content in a div after the subtext
  // It's in a tr with class "athing" but as a comment-expanded area
  const textEl = doc.querySelector(".tohtml, .comment-tree + tr .commtext");
  if (textEl) {
    return textEl.textContent?.trim() || null;
  }
  
  // Alternative: Look for the text in the fattest paragraph
  const commtext = doc.querySelector(".commtext");
  if (commtext) {
    return commtext.textContent?.trim() || null;
  }
  
  return null;
}

/**
 * Extract the number of comments.
 */
export function extractCommentCount(doc: Document): number | null {
  // Comment count is in the subtext area, format: "123 comments"
  const subtext = doc.querySelector(".subtext");
  if (subtext) {
    const text = subtext.textContent || "";
    const match = text.match(/(\d+)\s*comments?/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

/**
 * Extract top comments from the page.
 */
export function extractComments(doc: Document, maxComments: number = 10): Array<{
  author: string;
  body: string;
  score: string;
  indent: number;
}> {
  const comments: Array<{ author: string; body: string; score: string; indent: number }> = [];
  
  // Comments are in .comtr elements
  const commentEls = doc.querySelectorAll(".comtr");
  
  for (const commentEl of Array.from(commentEls).slice(0, maxComments)) {
    // Author
    const authorEl = commentEl.querySelector(".hnuser, a[href*='user']");
    const author = authorEl?.textContent?.trim() || "[deleted]";
    
    // Comment body
    const bodyEl = commentEl.querySelector(".commtext");
    const body = bodyEl?.textContent?.trim() || "";
    
    // Score (might not be visible for all)
    const scoreEl = commentEl.querySelector(".score");
    const score = scoreEl?.textContent?.trim() || "";
    
    // Indentation level (based on width of .ind element)
    const indEl = commentEl.querySelector(".ind");
    let indent = 0;
    if (indEl) {
      const width = indEl.getAttribute("width") || indEl.getAttribute("indent");
      if (width) {
        indent = Math.floor(parseInt(width, 10) / 40); // HN uses 40px per level
      }
    }
    
    if (body) {
      comments.push({ author, body, score, indent });
    }
  }
  
  return comments;
}

/**
 * Format comments as markdown with proper indentation.
 */
export function formatComments(comments: Array<{
  author: string;
  body: string;
  score: string;
  indent: number;
}>): string {
  if (comments.length === 0) return "";
  
  let md = "\n\n## Comments\n\n";
  
  for (const comment of comments) {
    // Add indentation using blockquote nesting
    const indent = "  ".repeat(comment.indent);
    const prefix = comment.indent > 0 ? "> ".repeat(comment.indent) : "";
    
    md += `${prefix}**${comment.author}**${comment.score ? ` (${comment.score})` : ""}\n\n`;
    md += `${prefix}${comment.body.split("\n").join(`\n${prefix}`)}\n\n`;
  }
  
  return md;
}

/**
 * Extract the full story with metadata and comments.
 * This is the main extraction function used by the template system.
 */
export function extractHackerNewsStory(doc: Document, url: string): {
  title: string;
  url: string | null;
  author: string;
  points: number | null;
  commentCount: number | null;
  storyText: string | null;
  comments: Array<{ author: string; body: string; score: string; indent: number }>;
  storyId: string | null;
} {
  // Title
  const titleEl = doc.querySelector(".titleline > a, .athing .title a");
  const title = titleEl?.textContent?.trim() || "";
  
  // Author
  const authorEl = doc.querySelector(".subtext a.hnuser, .subtext a[href*='user']");
  const author = authorEl?.textContent?.trim() || "";
  
  return {
    title,
    url: extractStoryUrl(doc),
    author,
    points: extractPoints(doc),
    commentCount: extractCommentCount(doc),
    storyText: extractStoryText(doc),
    comments: extractComments(doc, 15),
    storyId: extractStoryId(url)
  };
}

/**
 * Check if this is an "Ask HN", "Show HN", or other self-post.
 */
export function isSelfPost(title: string): boolean {
  const selfPostPrefixes = ["Ask HN:", "Show HN:", "Tell HN:", "Launch HN:"];
  return selfPostPrefixes.some((prefix) => 
    title.toLowerCase().startsWith(prefix.toLowerCase())
  );
}

/**
 * Extract stories from the front page listing.
 */
export function extractStoriesFromListing(doc: Document): Array<{
  rank: number;
  title: string;
  url: string;
  points: number | null;
  author: string;
  comments: number | null;
}> {
  const stories: Array<{
    rank: number;
    title: string;
    url: string;
    points: number | null;
    author: string;
    comments: number | null;
  }> = [];
  
  // Each story is in an .athing element
  const storyEls = doc.querySelectorAll(".athing");
  
  for (const storyEl of Array.from(storyEls)) {
    // Rank
    const rankEl = storyEl.querySelector(".rank");
    const rankText = rankEl?.textContent?.trim() || "";
    const rank = parseInt(rankText.replace(/\./g, ""), 10) || (stories.length + 1);
    
    // Title and URL
    const titleEl = storyEl.querySelector(".titleline > a, .title a");
    const title = titleEl?.textContent?.trim() || "";
    const url = titleEl?.getAttribute("href") || "";
    
    // Points and author are in the next sibling (subtext row)
    const subtextEl = storyEl.nextElementSibling?.querySelector(".subtext");
    const subtext = subtextEl?.textContent || "";
    
    // Points
    const pointsMatch = subtext.match(/(\d+)\s*points?/i);
    const points = pointsMatch ? parseInt(pointsMatch[1], 10) : null;
    
    // Author
    const authorEl = subtextEl?.querySelector(".hnuser, a[href*='user']");
    const author = authorEl?.textContent?.trim() || "";
    
    // Comments
    const commentsMatch = subtext.match(/(\d+)\s*comments?/i);
    const comments = commentsMatch ? parseInt(commentsMatch[1], 10) : null;
    
    if (title) {
      stories.push({ rank, title, url, points, author, comments });
    }
  }
  
  return stories;
}

/**
 * Format a listing of stories as markdown.
 */
export function formatStoriesListing(stories: Array<{
  rank: number;
  title: string;
  url: string;
  points: number | null;
  author: string;
  comments: number | null;
}>): string {
  let md = "# Hacker News Front Page\n\n";
  
  for (const story of stories) {
    md += `${story.rank}. **[${story.title}](${story.url})**`;
    if (story.points !== null) {
      md += ` (${story.points} pts`;
      if (story.comments !== null) {
        md += `, ${story.comments} comments`;
      }
      md += ")";
    }
    if (story.author) {
      md += ` by ${story.author}`;
    }
    md += "\n";
  }
  
  return md;
}

// Register the templates
registerBuiltInTemplates([hackerNewsItemTemplate, hackerNewsListingTemplate]);
