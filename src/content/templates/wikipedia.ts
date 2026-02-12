/**
 * Wikipedia site template for extracting clean article content.
 * 
 * Handles:
 * - Wikipedia article pages (en.wikipedia.org and other language variants)
 * - Cleans up edit links, reference markers, and navigation clutter
 * - Extracts infobox data as frontmatter
 */

import type { SiteTemplate } from "../../shared/templates";
import { registerBuiltInTemplates } from "./registry";

// ============================================================================
// Template Definitions
// ============================================================================

/**
 * Main Wikipedia article template.
 * Matches all wikipedia.org domains (en, de, fr, etc.)
 */
export const wikipediaTemplate: SiteTemplate = {
  domain: "*.wikipedia.org",
  name: "Wikipedia",
  description: "Extract Wikipedia articles with clean content and infobox metadata",
  enabled: true,
  priority: 100,
  urlPattern: "^/wiki/", // Only match article pages
  selectors: {
    // Article title from the first heading
    title: "#firstHeading, .mw-first-heading",
    // Main article content
    content: "#mw-content-text .mw-parser-output",
    // Last edited date
    date: "#footer-info-lastmod time, .mw-last-modified time",
    // Categories as potential tags
    tags: "#mw-normal-catlinks ul li a"
  },
  removeSelectors: [
    // Remove edit links and sections
    ".mw-editsection",
    ".mw-editsection-bracket",
    ".mw-editsection-divider",
    "span.mw-editsection",
    // Remove reference markers and footnotes
    ".reference",
    ".mw-ref",
    "sup.reference",
    // Remove navigation boxes
    ".navbox",
    ".navbox-inner",
    ".mw-navbox",
    // Remove table of contents (usually redundant in markdown)
    ".toc",
    "#toc",
    // Remove sidebar and footer
    ".mw-sidebar",
    "#mw-sidebar",
    "#footer",
    ".mw-footer",
    // Remove "See also" and "External links" sections (keep content)
    ".mw-headline",
    // Remove infobox for content (we extract it separately as frontmatter)
    ".infobox",
    ".mw-infobox",
    // Remove coordinates
    "#coordinates",
    ".geo-default",
    // Remove authority control
    ".authority-control",
    // Remove "citation needed" and similar markers
    ".noprint",
    ".Template-Fact",
    // Remove image gallery placeholders
    ".gallery-text",
    // Remove hidden categories
    "#mw-hidden-catlinks",
    // Remove "Good article" and similar badges
    ".mw-indicators",
    // Remove short description (we extract it separately)
    ".shortdescription"
  ],
  frontmatterExtras: {
    site: "wikipedia"
  }
};

/**
 * English Wikipedia specific template with higher priority.
 */
export const englishWikipediaTemplate: SiteTemplate = {
  domain: "en.wikipedia.org",
  name: "Wikipedia (English)",
  description: "Extract English Wikipedia articles with enhanced metadata",
  enabled: true,
  priority: 150,
  urlPattern: "^/wiki/",
  selectors: {
    title: "#firstHeading, .mw-first-heading",
    content: "#mw-content-text .mw-parser-output",
    date: "#footer-info-lastmod time, .mw-last-modified time",
    tags: "#mw-normal-catlinks ul li a"
  },
  removeSelectors: wikipediaTemplate.removeSelectors,
  frontmatterExtras: {
    site: "wikipedia",
    language: "en"
  }
};

// ============================================================================
// Extraction Utilities
// ============================================================================

/**
 * Extract article title from URL.
 * Wikipedia URLs are like: /wiki/Article_Title
 */
export function extractArticleTitle(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    if (pathname.startsWith("/wiki/")) {
      const title = pathname.replace("/wiki/", "");
      // Decode URL encoding and replace underscores with spaces
      return decodeURIComponent(title).replace(/_/g, " ");
    }
  } catch {
    // Invalid URL
  }
  return null;
}

/**
 * Extract Wikipedia language code from URL.
 */
export function extractLanguage(url: string): string {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    // Format: en.wikipedia.org, de.wikipedia.org, etc.
    const match = hostname.match(/^([a-z]+)\.wikipedia\.org$/);
    if (match) {
      return match[1];
    }
  } catch {
    // Invalid URL
  }
  return "en";
}

/**
 * Extract the short description from a Wikipedia article.
 * This appears at the top of articles and provides a brief summary.
 */
export function extractShortDescription(doc: Document): string | null {
  // Short description is usually in a specific container
  const shortDescEl = doc.querySelector(".shortdescription");
  if (shortDescEl) {
    return shortDescEl.textContent?.trim() || null;
  }
  
  // Sometimes it's in the hatnote
  const hatnote = doc.querySelector(".hatnote");
  if (hatnote) {
    const text = hatnote.textContent?.trim() || "";
    // Hatnotes often say "This article is about..." or redirect notes
    // Only use if it's a short description style
    if (text.length < 200 && !text.startsWith("For the")) {
      return text;
    }
  }
  
  return null;
}

/**
 * Extract infobox data as a key-value record.
 * Infoboxes appear on the right side of articles and contain structured data.
 */
export function extractInfobox(doc: Document): Record<string, string> {
  const infobox: Record<string, string> = {};
  
  // Find the infobox element
  const infoboxEl = doc.querySelector(".infobox, .mw-infobox, table.infobox");
  if (!infoboxEl) {
    return infobox;
  }
  
  // Extract title (usually in a caption or header)
  const caption = infoboxEl.querySelector("caption, .infobox-title");
  if (caption) {
    const title = caption.textContent?.trim();
    if (title) {
      infobox.title = title;
    }
  }
  
  // Extract image if present
  const imageEl = infoboxEl.querySelector("img");
  if (imageEl) {
    const src = imageEl.getAttribute("src");
    if (src) {
      infobox.image = src.startsWith("//") ? `https:${src}` : src;
    }
  }
  
  // Extract rows (th/td pairs)
  const rows = infoboxEl.querySelectorAll("tr");
  for (const row of Array.from(rows)) {
    const header = row.querySelector("th");
    const data = row.querySelector("td");
    
    if (header && data) {
      const key = header.textContent?.trim().toLowerCase().replace(/[:\s]+/g, "_") || "";
      let value = data.textContent?.trim() || "";
      
      // Clean up the value (remove reference markers, etc.)
      value = value.replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
      
      if (key && value && !key.startsWith("infobox")) {
        // Limit key length and sanitize
        const cleanKey = key.substring(0, 50).replace(/[^a-z0-9_]/g, "_");
        if (cleanKey && value.length < 500) {
          infobox[cleanKey] = value;
        }
      }
    }
  }
  
  return infobox;
}

/**
 * Extract categories from the article.
 */
export function extractCategories(doc: Document): string[] {
  const categories: string[] = [];
  
  // Normal categories
  const catLinks = doc.querySelectorAll("#mw-normal-catlinks ul li a, .mw-normal-catlinks a");
  for (const link of Array.from(catLinks)) {
    const cat = link.textContent?.trim();
    if (cat && !categories.includes(cat)) {
      categories.push(cat);
    }
  }
  
  return categories;
}

/**
 * Extract the lead section (first paragraph) as a summary.
 */
export function extractLeadSection(doc: Document): string | null {
  const content = doc.querySelector("#mw-content-text .mw-parser-output");
  if (!content) {
    return null;
  }
  
  // Get the first paragraph(s) before any heading
  const paragraphs: string[] = [];
  let node = content.firstChild;
  
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      
      // Stop at first heading
      if (el.tagName.match(/^H[2-6]$/)) {
        break;
      }
      
      // Collect paragraphs (skip infobox, hatnote, etc.)
      if (el.tagName === "P" && !el.classList.contains("mw-empty-elt")) {
        const text = el.textContent?.trim();
        if (text && text.length > 50) {
          // Clean up reference markers
          const cleaned = text.replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
          paragraphs.push(cleaned);
          
          // Limit to first 2 paragraphs
          if (paragraphs.length >= 2) {
            break;
          }
        }
      }
    }
    node = node.nextSibling;
  }
  
  return paragraphs.length > 0 ? paragraphs.join("\n\n") : null;
}

/**
 * Extract the last modified date.
 */
export function extractLastModified(doc: Document): string | null {
  const timeEl = doc.querySelector("#footer-info-lastmod time, .mw-last-modified time");
  if (timeEl) {
    return timeEl.getAttribute("datetime") || timeEl.textContent?.trim() || null;
  }
  
  // Try the text format: "This page was last edited on..."
  const lastModEl = doc.querySelector("#footer-info-lastmod, .mw-last-modified");
  if (lastModEl) {
    const text = lastModEl.textContent || "";
    // Try to extract a date
    const dateMatch = text.match(/(\d+\s+\w+\s+\d{4})/);
    if (dateMatch) {
      return dateMatch[1];
    }
  }
  
  return null;
}

/**
 * Check if the current page is a disambiguation page.
 */
export function isDisambiguationPage(doc: Document): boolean {
  // Check for disambiguation template or category
  if (doc.querySelector(".disambiguation, .disambig, #disambig")) {
    return true;
  }
  
  // Check for "disambiguation" in title or categories
  const title = doc.querySelector("#firstHeading, .mw-first-heading")?.textContent || "";
  if (title.toLowerCase().includes("(disambiguation)")) {
    return true;
  }
  
  // Check hatnote
  const hatnote = doc.querySelector(".hatnote");
  if (hatnote?.textContent?.toLowerCase().includes("disambiguation")) {
    return true;
  }
  
  return false;
}

/**
 * Extract disambiguation entries from a disambiguation page.
 */
export function extractDisambiguationEntries(doc: Document): Array<{
  title: string;
  description: string;
  link: string;
}> {
  const entries: Array<{ title: string; description: string; link: string }> = [];
  
  const content = doc.querySelector("#mw-content-text .mw-parser-output");
  if (!content) {
    return entries;
  }
  
  // Disambiguation pages typically have entries in list items
  const items = content.querySelectorAll("ul li, dl dd");
  
  for (const item of Array.from(items).slice(0, 20)) {
    const link = item.querySelector("a");
    if (!link) continue;
    
    const title = link.textContent?.trim() || "";
    const href = link.getAttribute("href") || "";
    
    // Get the description (text after the link)
    let description = item.textContent?.trim() || "";
    if (title && description.startsWith(title)) {
      description = description.substring(title.length).replace(/^[\s\-–—:]+/, "").trim();
    }
    
    if (title && title.length > 1) {
      entries.push({
        title,
        description: description.substring(0, 200),
        link: href.startsWith("/") ? `https://en.wikipedia.org${href}` : href
      });
    }
  }
  
  return entries;
}

/**
 * Clean Wikipedia content for markdown conversion.
 * Removes reference markers, cleans up links, etc.
 */
export function cleanWikipediaContent(doc: Document): void {
  // Remove reference markers from text
  const refs = doc.querySelectorAll(".reference, .mw-ref, sup.reference");
  for (const ref of Array.from(refs)) {
    ref.remove();
  }
  
  // Convert internal Wikipedia links to just text (or keep as relative links)
  const links = doc.querySelectorAll("a[href^='/wiki/']");
  for (const link of Array.from(links)) {
    const href = link.getAttribute("href") || "";
    const text = link.textContent || "";
    
    // For disambiguation pages or navigation, keep the link
    // For inline references, consider converting to just text
    // Here we'll keep them but make them absolute
    if (href && text) {
      const lang = extractLanguage(window.location.href);
      link.setAttribute("href", `https://${lang}.wikipedia.org${href}`);
    }
  }
  
  // Remove edit section links
  const editLinks = doc.querySelectorAll(".mw-editsection");
  for (const editLink of Array.from(editLinks)) {
    editLink.remove();
  }
  
  // Remove coordinates
  const coords = doc.querySelectorAll("#coordinates, .geo-default, .geo-nondefault");
  for (const coord of Array.from(coords)) {
    coord.remove();
  }
}

/**
 * Format Wikipedia article content as markdown.
 */
export function formatWikipediaContent(
  title: string,
  content: string,
  shortDescription: string | null,
  infobox: Record<string, string>,
  categories: string[],
  language: string
): string {
  let md = `# ${title}\n\n`;
  
  // Add short description as quote
  if (shortDescription) {
    md += `> ${shortDescription}\n\n`;
  }
  
  // Add infobox summary (top 5 fields)
  const infoboxKeys = Object.keys(infobox).filter((k) => k !== "title" && k !== "image");
  if (infoboxKeys.length > 0) {
    md += `**Quick Facts**\n`;
    for (const key of infoboxKeys.slice(0, 5)) {
      const label = key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
      md += `- **${label}**: ${infobox[key]}\n`;
    }
    md += "\n";
  }
  
  // Add content
  md += content;
  
  // Add categories as tags
  if (categories.length > 0) {
    md += "\n\n---\n\n";
    md += `**Categories**: ${categories.slice(0, 10).map((c) => `\`${c}\``).join(", ")}\n`;
  }
  
  // Add language indicator if not English
  if (language !== "en") {
    md += `\n\n_Language: ${language.toUpperCase()}_`;
  }
  
  return md;
}

/**
 * Format a disambiguation page as markdown.
 */
export function formatDisambiguationPage(
  title: string,
  entries: Array<{ title: string; description: string; link: string }>
): string {
  let md = `# ${title}\n\n`;
  md += "_This is a disambiguation page. Below are articles that could be referred to by this title._\n\n";
  
  for (const entry of entries) {
    md += `- **[${entry.title}](${entry.link})**`;
    if (entry.description) {
      md += ` — ${entry.description}`;
    }
    md += "\n";
  }
  
  return md;
}

// Register all Wikipedia templates
registerBuiltInTemplates([wikipediaTemplate, englishWikipediaTemplate]);
