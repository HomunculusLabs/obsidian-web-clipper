/**
 * Medium site template for extracting articles.
 * 
 * Handles:
 * - Medium.com articles and blog posts
 * - Member-only content preview detection
 * - Author and publication metadata
 * - Paywall detection (using existing paywall.ts)
 * 
 * Medium has various subdomains (medium.com, *.medium.com, custom domains)
 * so the template uses wildcards to match all variations.
 */

import type { SiteTemplate } from "../../shared/templates";
import { registerBuiltInTemplates } from "./registry";

/**
 * Main Medium template for article pages.
 * Matches medium.com and all subdomains (username.medium.com, publication.medium.com).
 */
export const mediumTemplate: SiteTemplate = {
  domain: "*.medium.com",
  name: "Medium",
  description: "Extract Medium articles with author and publication metadata",
  enabled: true,
  priority: 100,
  selectors: {
    // Article title
    title: "h1, article h1, [data-testid='storyTitle']",
    // Main article content
    content: "article, main article, [data-testid='postContent'], .postArticle-content",
    // Author name
    author: "[data-testid='authorName'], .author-name a, a[href*='/@'], .ds-link[href*='/@']",
    // Publication date
    date: "time, [data-testid='storyPublishDate'], .postMeta time",
    // Tags (topics)
    tags: "[data-testid='tagButton'], a[href*='/tag/'], .topic a",
    // Article subtitle/description
    description: "h1 + p, article h1 + p, [data-testid='storySubtitle'], .subtitle",
    // Canonical URL
    url: "link[rel='canonical']",
    // Main article image
    image: "article img, figure img, [data-testid='postContent'] img:first-of-type"
  },
  removeSelectors: [
    // Remove clap/recommend buttons
    "[data-testid='clapButton'], .clap-button, .multi-vote-button",
    // Remove response/comment sections
    "[data-testid='responsesTab'], .responsesStream",
    // Remove author bio popup
    "[data-testid='authorInfoTooltip'], .authorInfo-tooltipContainer",
    // Remove membership prompts
    "[data-testid='membership-promo'], .membership-promo",
    // Remove paywall overlay
    ".paywall, [data-testid='paywall'], .upsell-banner",
    // Remove footer
    "footer, .postFooter",
    // Remove sidebar
    "aside, .sidebar",
    // Remove follow button
    "[data-testid='follow-button'], .follow-button",
    // Remove share buttons
    "[data-testid='share-button'], .share-button",
    // Remove membership-only content marker
    ".member-only, [data-testid='memberOnly']"
  ],
  frontmatterExtras: {
    site: "medium"
  }
};

/**
 * Template for medium.com main domain (higher priority than wildcard).
 */
export const mediumMainTemplate: SiteTemplate = {
  domain: "medium.com",
  name: "Medium",
  description: "Extract Medium articles from medium.com",
  enabled: true,
  priority: 150, // Higher priority than wildcard
  selectors: {
    title: "h1, article h1, [data-testid='storyTitle']",
    content: "article, main article, [data-testid='postContent'], .postArticle-content",
    author: "[data-testid='authorName'], .author-name a, a[href*='/@']",
    date: "time, [data-testid='storyPublishDate']",
    tags: "[data-testid='tagButton'], a[href*='/tag/']",
    description: "h1 + p, article h1 + p"
  },
  removeSelectors: [
    "[data-testid='clapButton']",
    "[data-testid='responsesTab']",
    "[data-testid='membership-promo']",
    ".paywall",
    "[data-testid='paywall']",
    "footer"
  ],
  frontmatterExtras: {
    site: "medium"
  }
};

/**
 * Extract the author handle from a Medium page.
 * Medium authors have handles like @username.
 */
export function extractAuthorHandle(doc: Document): string | null {
  // Look for links containing /@username
  const authorLinks = doc.querySelectorAll('a[href*="/@"]');
  for (const link of Array.from(authorLinks)) {
    const href = link.getAttribute("href") || "";
    const match = href.match(/\/(@[\w-]+)/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Extract the publication name (if the article is in a publication).
 */
export function extractPublicationName(doc: Document): string | null {
  // Publication name appears in header or meta
  const publicationLink = doc.querySelector('a[href*="/publication/"], [data-testid="publicationName"]');
  if (publicationLink) {
    return publicationLink.textContent?.trim() || null;
  }
  
  // Check for custom domain publication
  const metaPublication = doc.querySelector('meta[property="article:section"]');
  if (metaPublication) {
    return metaPublication.getAttribute("content");
  }
  
  return null;
}

/**
 * Extract reading time from Medium article.
 */
export function extractReadingTime(doc: Document): number | null {
  const readingTimeEl = doc.querySelector("[data-testid='storyReadTime'], .readingTime, .postMeta time[title]");
  if (readingTimeEl) {
    const text = readingTimeEl.textContent || readingTimeEl.getAttribute("title") || "";
    const match = text.match(/(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  
  // Check for aria-label format like "5 min read"
  const metaReadTime = doc.querySelector('meta[name="twitter:data1"]');
  if (metaReadTime) {
    const content = metaReadTime.getAttribute("content") || "";
    const match = content.match(/(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  
  return null;
}

/**
 * Extract clap count (Medium's "like" system).
 */
export function extractClapCount(doc: Document): number | null {
  // Clap count is shown in the claps button
  const clapButton = doc.querySelector("[data-testid='clapButton'], .clap-count, [aria-label*='clap']");
  if (clapButton) {
    const text = clapButton.textContent || clapButton.getAttribute("aria-label") || "";
    const match = text.match(/(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

/**
 * Check if this is a member-only article (paywalled).
 */
export function isMemberOnly(doc: Document): boolean {
  // Check for member-only indicators
  const memberOnlyIndicators = [
    "[data-testid='memberOnly']",
    ".member-only",
    ".metered-content",
    "[data-testid='paywall']",
    ".paywall"
  ];
  
  for (const selector of memberOnlyIndicators) {
    if (doc.querySelector(selector)) {
      return true;
    }
  }
  
  // Check for member-only text in the page
  const bodyText = doc.body?.textContent?.toLowerCase() || "";
  const memberOnlyKeywords = [
    "member-only",
    "member only",
    "members only",
    "become a member",
    "upgrade to read full",
    "unlimited access"
  ];
  
  for (const keyword of memberOnlyKeywords) {
    if (bodyText.includes(keyword)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract visible content preview from a paywalled Medium article.
 * Returns the portion that's visible before the paywall.
 */
export function extractPaywallPreview(doc: Document): string | null {
  // Medium typically shows the first few paragraphs before paywall
  const article = doc.querySelector("article, [data-testid='postContent'], .postArticle-content");
  if (!article) return null;
  
  // Get all paragraph elements
  const paragraphs = article.querySelectorAll("p, h1, h2, h3");
  const visibleParagraphs: string[] = [];
  
  // Check each paragraph
  for (const p of Array.from(paragraphs)) {
    // Stop if we hit a paywall marker
    if (p.closest("[data-testid='paywall'], .paywall, .metered-content")) {
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
 * Extract article tags/topics from Medium page.
 */
export function extractMediumTags(doc: Document): string[] {
  const tags: Set<string> = new Set();
  
  // Primary: tag buttons in the article
  const tagButtons = doc.querySelectorAll("[data-testid='tagButton'] a, a[href*='/tag/']");
  for (const tag of Array.from(tagButtons)) {
    const text = tag.textContent?.trim() || "";
    if (text && text.length > 0 && text.length < 50) {
      tags.add(text);
    }
  }
  
  // Fallback: meta keywords
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
  
  // Fallback: article:tag meta elements
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
 * Extract the canonical Medium URL.
 */
export function extractCanonicalUrl(doc: Document): string | null {
  const canonical = doc.querySelector('link[rel="canonical"]');
  if (canonical) {
    return canonical.getAttribute("href");
  }
  
  // Fallback: Open Graph URL
  const ogUrl = doc.querySelector('meta[property="og:url"]');
  if (ogUrl) {
    return ogUrl.getAttribute("content");
  }
  
  return null;
}

/**
 * Extract full Medium article metadata.
 */
export function extractMediumArticle(doc: Document, url: string): {
  title: string;
  author: string;
  authorHandle: string | null;
  publication: string | null;
  date: string | null;
  readingTime: number | null;
  clapCount: number | null;
  tags: string[];
  isMemberOnly: boolean;
  previewContent: string | null;
  canonicalUrl: string | null;
} {
  // Title
  const titleEl = doc.querySelector("h1, article h1, [data-testid='storyTitle']");
  const title = titleEl?.textContent?.trim() || "";
  
  // Author
  const authorEl = doc.querySelector("[data-testid='authorName'], .author-name a, a[href*='/@']");
  const author = authorEl?.textContent?.trim() || "";
  
  // Date
  const dateEl = doc.querySelector("time, [data-testid='storyPublishDate']");
  const dateAttr = dateEl?.getAttribute("datetime");
  const date = dateAttr || dateEl?.textContent?.trim() || null;
  
  return {
    title,
    author,
    authorHandle: extractAuthorHandle(doc),
    publication: extractPublicationName(doc),
    date,
    readingTime: extractReadingTime(doc),
    clapCount: extractClapCount(doc),
    tags: extractMediumTags(doc),
    isMemberOnly: isMemberOnly(doc),
    previewContent: extractPaywallPreview(doc),
    canonicalUrl: extractCanonicalUrl(doc)
  };
}

/**
 * Format Medium article as markdown with metadata.
 */
export function formatMediumContent(
  content: string,
  metadata: {
    title: string;
    author: string;
    authorHandle: string | null;
    publication: string | null;
    date: string | null;
    readingTime: number | null;
    isMemberOnly: boolean;
  }
): string {
  let md = "";
  
  // Add paywall warning if member-only
  if (metadata.isMemberOnly) {
    md += "> ⚠️ **This is a member-only article. Only the preview content is included.**\n\n";
  }
  
  // Add article content
  md += content;
  
  // Add metadata footer
  md += "\n\n---\n\n";
  
  let metaParts: string[] = [];
  if (metadata.author) {
    let authorStr = `By **${metadata.author}**`;
    if (metadata.authorHandle) {
      authorStr += ` (${metadata.authorHandle})`;
    }
    metaParts.push(authorStr);
  }
  
  if (metadata.publication) {
    metaParts.push(`Published in _${metadata.publication}_`);
  }
  
  if (metadata.date) {
    metaParts.push(`Published: ${metadata.date}`);
  }
  
  if (metadata.readingTime) {
    metaParts.push(`${metadata.readingTime} min read`);
  }
  
  if (metaParts.length > 0) {
    md += metaParts.join(" • ") + "\n";
  }
  
  return md;
}

// Register the templates
registerBuiltInTemplates([mediumMainTemplate, mediumTemplate]);
