/**
 * Substack site template for extracting newsletter content.
 * 
 * Handles:
 * - Substack.com newsletters and custom domains
 * - Author and publication metadata
 * - Free vs paid content detection
 * - Subscription/paywall indicators
 * - Comments and engagement metrics
 */

import type { SiteTemplate } from "../../shared/templates";
import { registerBuiltInTemplates } from "./registry";

/**
 * Main Substack template for *.substack.com domains.
 * Matches all Substack-hosted newsletters.
 */
export const substackTemplate: SiteTemplate = {
  domain: "*.substack.com",
  name: "Substack",
  description: "Extract Substack newsletters with author and publication metadata",
  enabled: true,
  priority: 100,
  selectors: {
    // Article title
    title: "h1.post-title, h1[class*='title'], article h1, .post-header h1",
    // Main content
    content: ".post-content, .body, .available-content, article, [class*='postContent']",
    // Author
    author: ".author-name, .byline a, [class*='author-name'], .post-meta a[href*='/profile/']",
    // Date
    date: ".post-date, .byline time, [class*='publishDate'], time[datetime]",
    // Tags/topics
    tags: "[class*='topic'], .tag, [class*='tag']",
    // Description/subtitle
    description: ".subtitle, .post-description, h1 + p, [class*='subtitle']",
    // Main image
    image: ".post-content img, figure img, [class*='postImage'] img"
  },
  removeSelectors: [
    // Remove paywall content
    ".paywall, [class*='paywall'], .show-paywall",
    // Remove subscription prompts
    ".subscribe-widget, [class*='subscribe'], .subscription-promo",
    // Remove comment section (kept separately)
    ".comment-list, [class*='comments'], #comments",
    // Remove like/share buttons
    ".like-button, .share-button, [class*='likeButton'], [class*='shareButton']",
    // Remove footer newsletter signup
    ".footer-subscribe, [class*='footerSubscribe']",
    // Remove author bio footer
    ".author-bio, [class*='authorBio']",
    // Remove app download banner
    ".app-banner, [class*='appBanner']",
    // Remove navigation
    "nav, header, .nav, [class*='navbar']"
  ],
  frontmatterExtras: {
    site: "substack"
  }
};

/**
 * Template for substack.com main domain (higher priority than wildcard).
 */
export const substackMainTemplate: SiteTemplate = {
  domain: "substack.com",
  name: "Substack",
  description: "Extract Substack content from substack.com",
  enabled: true,
  priority: 150,
  selectors: {
    title: "h1.post-title, h1[class*='title'], article h1",
    content: ".post-content, .body, .available-content, article",
    author: ".author-name, .byline a",
    date: ".post-date, .byline time"
  },
  removeSelectors: [
    ".paywall",
    "[class*='paywall']",
    ".subscribe-widget",
    "[class*='subscribe']",
    ".comment-list",
    "#comments"
  ],
  frontmatterExtras: {
    site: "substack"
  }
};

/**
 * Detect if a page is a Substack newsletter.
 * Checks for Substack-specific signatures in the DOM.
 */
export function isSubstackPage(doc: Document): boolean {
  // Check for Substack meta tag
  const generator = doc.querySelector('meta[name="generator"]');
  if (generator?.getAttribute("content")?.toLowerCase().includes("substack")) {
    return true;
  }
  
  // Check for Substack-specific classes
  if (doc.querySelector('[class*="substack"], .post-content, .publication-logo')) {
    return true;
  }
  
  // Check for Substack JavaScript
  const scripts = doc.querySelectorAll('script[src*="substack"], script[src*="c.substack"]');
  if (scripts.length > 0) {
    return true;
  }
  
  return false;
}

/**
 * Extract the publication name from a Substack page.
 * Substack blogs often have custom names separate from the author.
 */
export function extractPublicationName(doc: Document): string | null {
  // Check for publication logo/name in header
  const publicationLogo = doc.querySelector('.publication-logo, [class*="publicationName"], .pub-name');
  if (publicationLogo) {
    return publicationLogo.textContent?.trim() || null;
  }
  
  // Check Open Graph site_name
  const ogSiteName = doc.querySelector('meta[property="og:site_name"]');
  if (ogSiteName) {
    const content = ogSiteName.getAttribute("content");
    if (content && content !== "Substack") {
      return content;
    }
  }
  
  // Check meta application-name
  const appName = doc.querySelector('meta[name="application-name"]');
  if (appName) {
    const content = appName.getAttribute("content");
    if (content && content !== "Substack") {
      return content;
    }
  }
  
  return null;
}

/**
 * Extract the author's handle/username from Substack.
 */
export function extractAuthorHandle(doc: Document): string | null {
  // Look for profile links
  const profileLinks = doc.querySelectorAll('a[href*="/profile/"], a[href*="/@"]');
  for (const link of Array.from(profileLinks)) {
    const href = link.getAttribute("href") || "";
    // Match /profile/12345-handle or /@handle patterns
    let match = href.match(/\/profile\/\d+-(\w+)/);
    if (match) {
      return match[1];
    }
    match = href.match(/\/@(\w+)/);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Check if the content is behind a paywall (paid subscribers only).
 */
export function isPaidContent(doc: Document): boolean {
  // Check for paywall elements
  const paywallSelectors = [
    ".paywall",
    "[class*='paywall']",
    ".show-paywall",
    ".subscription-required",
    "[class*='paidContent']"
  ];
  
  for (const selector of paywallSelectors) {
    if (doc.querySelector(selector)) {
      return true;
    }
  }
  
  // Check for paywall text indicators
  const bodyText = doc.body?.textContent?.toLowerCase() || "";
  const paidIndicators = [
    "this post is for paid subscribers",
    "for paid subscribers only",
    "upgrade to paid",
    "become a paid subscriber",
    "paid subscriber",
    "subscription required"
  ];
  
  for (const indicator of paidIndicators) {
    if (bodyText.includes(indicator)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract the available content preview from a paywalled Substack post.
 * Returns the portion visible before the paywall.
 */
export function extractPaywallPreview(doc: Document): string | null {
  // Substack typically shows content in .available-content before paywall
  const availableContent = doc.querySelector(".available-content, [class*='availableContent']");
  if (availableContent) {
    return availableContent.textContent?.trim() || null;
  }
  
  // Fallback: get paragraphs before paywall element
  const content = doc.querySelector(".post-content, .body, article");
  if (!content) return null;
  
  const paragraphs = content.querySelectorAll("p, h2, h3");
  const visibleParagraphs: string[] = [];
  
  for (const p of Array.from(paragraphs)) {
    // Stop if we hit a paywall marker
    if (p.closest(".paywall, [class*='paywall']")) {
      break;
    }
    
    const text = p.textContent?.trim() || "";
    if (text.length > 0) {
      visibleParagraphs.push(text);
    }
  }
  
  // Return first few paragraphs as preview
  const preview = visibleParagraphs.slice(0, 5).join("\n\n");
  return preview.length > 100 ? preview : null;
}

/**
 * Extract like count from a Substack post.
 */
export function extractLikeCount(doc: Document): number | null {
  // Look for like button with count
  const likeButton = doc.querySelector('.like-button, [class*="likeButton"], a[href*="/like"]');
  if (likeButton) {
    const text = likeButton.textContent || likeButton.getAttribute("aria-label") || "";
    const match = text.match(/(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  
  // Check for standalone like count
  const likeCount = doc.querySelector('.like-count, [class*="likeCount"]');
  if (likeCount) {
    const text = likeCount.textContent || "";
    const match = text.match(/(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  
  return null;
}

/**
 * Extract comment count from a Substack post.
 */
export function extractCommentCount(doc: Document): number | null {
  // Look for comment link with count
  const commentLink = doc.querySelector('a[href*="#comments"], a[href*="/comments"], .comment-count');
  if (commentLink) {
    const text = commentLink.textContent || commentLink.getAttribute("aria-label") || "";
    const match = text.match(/(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  
  return null;
}

/**
 * Extract tags/topics from a Substack post.
 */
export function extractSubstackTags(doc: Document): string[] {
  const tags: Set<string> = new Set();
  
  // Check for topic tags
  const topicLinks = doc.querySelectorAll('a[href*="/topic/"], .topic-tag, [class*="topicLink"]');
  for (const link of Array.from(topicLinks)) {
    const text = link.textContent?.trim() || "";
    if (text && text.length > 0 && text.length < 50) {
      tags.add(text);
    }
  }
  
  // Check meta keywords
  const metaKeywords = doc.querySelector('meta[name="keywords"]');
  if (metaKeywords) {
    const content = metaKeywords.getAttribute("content") || "";
    for (const keyword of content.split(",")) {
      const trimmed = keyword.trim();
      if (trimmed.length > 0 && trimmed.length < 50) {
        tags.add(trimmed);
      }
    }
  }
  
  // Check article:tag meta elements
  const articleTags = doc.querySelectorAll('meta[property="article:tag"]');
  for (const tag of Array.from(articleTags)) {
    const content = tag.getAttribute("content") || "";
    if (content.length > 0) {
      tags.add(content);
    }
  }
  
  return Array.from(tags);
}

/**
 * Extract the canonical URL from a Substack post.
 */
export function extractCanonicalUrl(doc: Document): string | null {
  const canonical = doc.querySelector('link[rel="canonical"]');
  if (canonical) {
    return canonical.getAttribute("href");
  }
  
  // Fallback to Open Graph URL
  const ogUrl = doc.querySelector('meta[property="og:url"]');
  if (ogUrl) {
    return ogUrl.getAttribute("content");
  }
  
  return null;
}

/**
 * Extract the post ID from a Substack URL.
 */
export function extractPostId(doc: Document, url: string): string | null {
  // Try to find in meta tags
  const articleId = doc.querySelector('meta[property="article:id"], meta[name="article:id"]');
  if (articleId) {
    return articleId.getAttribute("content");
  }
  
  // Try to extract from URL (Substack URLs typically contain post ID)
  const match = url.match(/\/p\/([a-zA-Z0-9-]+)/);
  if (match) {
    return match[1];
  }
  
  return null;
}

/**
 * Check if the post is free (not behind paywall).
 */
export function isFreePost(doc: Document): boolean {
  // If there's no paywall, it's free
  if (!isPaidContent(doc)) {
    return true;
  }
  
  // Check for explicit free indicator
  const freeIndicator = doc.querySelector('.free-post, [class*="freePost"]');
  if (freeIndicator) {
    return true;
  }
  
  return false;
}

/**
 * Extract the full newsletter metadata from a Substack page.
 */
export function extractSubstackNewsletter(doc: Document, url: string): {
  title: string;
  author: string;
  authorHandle: string | null;
  publication: string | null;
  date: string | null;
  postId: string | null;
  tags: string[];
  likes: number | null;
  comments: number | null;
  isPaid: boolean;
  isFree: boolean;
  previewContent: string | null;
  canonicalUrl: string | null;
} {
  // Title
  const titleEl = doc.querySelector("h1.post-title, h1[class*='title'], article h1");
  const title = titleEl?.textContent?.trim() || "";
  
  // Author
  const authorEl = doc.querySelector(".author-name, .byline a, [class*='author-name']");
  const author = authorEl?.textContent?.trim() || "";
  
  // Date
  const dateEl = doc.querySelector(".post-date, .byline time, [class*='publishDate']");
  const dateAttr = dateEl?.getAttribute("datetime");
  const date = dateAttr || dateEl?.textContent?.trim() || null;
  
  return {
    title,
    author,
    authorHandle: extractAuthorHandle(doc),
    publication: extractPublicationName(doc),
    date,
    postId: extractPostId(doc, url),
    tags: extractSubstackTags(doc),
    likes: extractLikeCount(doc),
    comments: extractCommentCount(doc),
    isPaid: isPaidContent(doc),
    isFree: isFreePost(doc),
    previewContent: isPaidContent(doc) ? extractPaywallPreview(doc) : null,
    canonicalUrl: extractCanonicalUrl(doc)
  };
}

/**
 * Format Substack newsletter content with metadata.
 */
export function formatSubstackContent(
  content: string,
  metadata: {
    title: string;
    author: string;
    authorHandle: string | null;
    publication: string | null;
    date: string | null;
    isPaid: boolean;
  }
): string {
  let md = "";
  
  // Add paywall warning if paid content
  if (metadata.isPaid) {
    md += "> ⚠️ **This is a paid subscriber-only post. Only the preview content is included.**\n\n";
  }
  
  // Add main content
  md += content;
  
  // Add metadata footer
  md += "\n\n---\n\n";
  
  const metaParts: string[] = [];
  
  if (metadata.author) {
    let authorStr = `By **${metadata.author}**`;
    if (metadata.authorHandle) {
      authorStr += ` (@${metadata.authorHandle})`;
    }
    metaParts.push(authorStr);
  }
  
  if (metadata.publication) {
    metaParts.push(`Published in _${metadata.publication}_`);
  }
  
  if (metadata.date) {
    metaParts.push(`Published: ${metadata.date}`);
  }
  
  if (metaParts.length > 0) {
    md += metaParts.join(" • ") + "\n";
  }
  
  return md;
}

// Register the templates
registerBuiltInTemplates([substackMainTemplate, substackTemplate]);
