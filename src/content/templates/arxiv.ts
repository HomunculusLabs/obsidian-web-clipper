/**
 * ArXiv site template for extracting academic papers.
 * 
 * Handles:
 * - ArXiv abstract pages (arxiv.org/abs/...)
 * - Extracts paper title, authors, abstract, PDF link
 * - Formats citation in frontmatter for easy referencing
 */

import type { SiteTemplate } from "../../shared/templates";
import { registerBuiltInTemplates } from "./registry";

// ============================================================================
// Template Definitions
// ============================================================================

/**
 * Main ArXiv template for abstract pages.
 * Matches arxiv.org and all subdomains (like ar5iv.org for HTML versions).
 */
export const arxivTemplate: SiteTemplate = {
  domain: "arxiv.org",
  name: "ArXiv",
  description: "Extract academic papers with title, authors, abstract, and citation info",
  enabled: true,
  priority: 100,
  urlPattern: "^/abs/", // Only match abstract pages
  selectors: {
    // Paper title
    title: "h1.title, .title, #title",
    // Abstract content
    content: "blockquote.abstract, .abstract, #abstract",
    // Authors list
    author: "div.authors, .authors, #authors",
    // Submission date
    date: "div.dateline, .dateline, .submission-date",
    // Categories/tags
    tags: ".subjects, .keywords, #keywords"
  },
  removeSelectors: [
    // Remove extra navigation
    ".extra-ref",
    ".extra-services",
    // Remove download buttons (we extract links separately)
    ".download-pdf",
    // Remove comment/version info
    ".metabox",
    // Remove endorsement links
    ".endorsement"
  ],
  frontmatterExtras: {
    site: "arxiv",
    type: "paper"
  }
};

/**
 * ar5iv.org template (HTML5 version of ArXiv).
 * This site provides a cleaner HTML version of ArXiv papers.
 */
export const ar5ivTemplate: SiteTemplate = {
  domain: "ar5iv.org",
  name: "ar5iv (ArXiv HTML)",
  description: "Extract ArXiv papers from ar5iv.org HTML versions",
  enabled: true,
  priority: 100,
  urlPattern: "^/abs/",
  selectors: {
    title: "h1.ltx_title, .ltx_title, h1.title",
    content: ".ltx_abstract, .abstract, #abstract",
    author: ".ltx_author, .authors",
    date: ".ltx_date, .dateline"
  },
  removeSelectors: [
    ".ltx_page_footer",
    ".ltx_page_navbar"
  ],
  frontmatterExtras: {
    site: "arxiv",
    type: "paper",
    source: "ar5iv"
  }
};

// ============================================================================
// Extraction Utilities
// ============================================================================

/**
 * Extract the ArXiv paper ID from URL.
 * Formats:
 * - /abs/2301.12345 (new format)
 * - /abs/hep-th/9901001 (old format with archive/class)
 * - /pdf/2301.12345.pdf (PDF link)
 */
export function extractArxivId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // Match new format: /abs/2301.12345 or /pdf/2301.12345
    const newFormatMatch = pathname.match(/\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/);
    if (newFormatMatch) {
      return newFormatMatch[1];
    }
    
    // Match old format: /abs/hep-th/9901001
    const oldFormatMatch = pathname.match(/\/(?:abs|pdf)\/([a-z-]+\/\d{7})(?:v\d+)?/);
    if (oldFormatMatch) {
      return oldFormatMatch[1];
    }
  } catch {
    // Invalid URL
  }
  return null;
}

/**
 * Extract the version number from ArXiv URL.
 * Returns null if no version specified (defaults to v1).
 */
export function extractVersion(url: string): number | null {
  const match = url.match(/v(\d+)(?:\.pdf)?$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Build the canonical ArXiv URL from an ID.
 */
export function buildArxivUrl(arxivId: string): string {
  return `https://arxiv.org/abs/${arxivId}`;
}

/**
 * Build the PDF URL from an ArXiv ID.
 */
export function buildPdfUrl(arxivId: string): string {
  return `https://arxiv.org/pdf/${arxivId}.pdf`;
}

/**
 * Build the ar5iv HTML URL from an ArXiv ID.
 */
export function buildAr5ivUrl(arxivId: string): string {
  return `https://ar5iv.org/abs/${arxivId}`;
}

/**
 * Extract paper title from the page.
 */
export function extractTitle(doc: Document): string | null {
  // Try multiple selectors
  const selectors = ["h1.title", ".title", "#title", "h1.ltx_title"];
  
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (el) {
      // Remove any child elements that might contain metadata
      const text = el.textContent?.trim() || "";
      // Clean up: remove line breaks and extra spaces
      const cleaned = text.replace(/\s+/g, " ").trim();
      if (cleaned) {
        return cleaned;
      }
    }
  }
  
  return null;
}

/**
 * Extract authors from the page.
 */
export function extractAuthors(doc: Document): string[] {
  const authors: string[] = [];
  
  // Try authors div
  const authorsEl = doc.querySelector("div.authors, .authors, #authors, .ltx_author");
  if (authorsEl) {
    // Authors are typically links
    const authorLinks = authorsEl.querySelectorAll("a");
    for (const link of Array.from(authorLinks)) {
      const name = link.textContent?.trim();
      if (name && name.length > 1 && !authors.includes(name)) {
        authors.push(name);
      }
    }
    
    // If no links found, try splitting by comma
    if (authors.length === 0) {
      const text = authorsEl.textContent?.trim() || "";
      const parts = text.split(/,\s*/);
      for (const part of parts) {
        const name = part.trim();
        if (name && name.length > 1 && !authors.includes(name)) {
          authors.push(name);
        }
      }
    }
  }
  
  return authors;
}

/**
 * Extract abstract from the page.
 */
export function extractAbstract(doc: Document): string | null {
  const selectors = [
    "blockquote.abstract",
    ".abstract",
    "#abstract",
    ".ltx_abstract",
    "div.abstract"
  ];
  
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (el) {
      // Get text content, clean it up
      let text = el.textContent?.trim() || "";
      
      // Remove "Abstract:" prefix if present
      text = text.replace(/^Abstract:\s*/i, "");
      
      // Clean up whitespace
      text = text.replace(/\s+/g, " ").trim();
      
      if (text) {
        return text;
      }
    }
  }
  
  return null;
}

/**
 * Extract submission date from the page.
 */
export function extractSubmissionDate(doc: Document): string | null {
  const selectors = [".dateline", ".submission-date", ".ltx_date"];
  
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (el) {
      const text = el.textContent?.trim() || "";
      
      // Format is usually: "[Submitted on 1 Jan 2024]" or similar
      const match = text.match(/(\d{1,2}\s+\w+\s+\d{4})/);
      if (match) {
        return match[1];
      }
      
      // Try ISO format
      const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) {
        return isoMatch[1];
      }
      
      // Return raw text if nothing matched
      if (text) {
        return text.replace(/[\[\]]/g, "").trim();
      }
    }
  }
  
  return null;
}

/**
 * Extract subjects/categories from the page.
 */
export function extractSubjects(doc: Document): string[] {
  const subjects: string[] = [];
  
  // Try subjects div
  const subjectsEl = doc.querySelector(".subjects, .keywords, #keywords");
  if (subjectsEl) {
    const text = subjectsEl.textContent?.trim() || "";
    
    // Categories are often in format: "Primary: cs.AI; Secondary: cs.LG, I.2.7"
    // or just: "cs.AI, cs.LG"
    
    // Extract primary category
    const primaryMatch = text.match(/Primary:\s*([a-z-]+\.[A-Z]+)/i);
    if (primaryMatch) {
      subjects.push(primaryMatch[1]);
    }
    
    // Extract secondary categories
    const secondaryMatch = text.match(/Secondary:\s*([\w.,\s;-]+)/i);
    if (secondaryMatch) {
      const secondaries = secondaryMatch[1].split(/[;,]/);
      for (const cat of secondaries) {
        const cleaned = cat.trim();
        if (cleaned && !subjects.includes(cleaned)) {
          subjects.push(cleaned);
        }
      }
    }
    
    // If no structured format, just split by comma/semicolon
    if (subjects.length === 0 && text) {
      const parts = text.split(/[,;]/);
      for (const part of parts) {
        const cleaned = part.trim();
        // Filter out obvious non-categories
        if (cleaned && cleaned.length > 2 && !cleaned.startsWith("Primary") && !cleaned.startsWith("Secondary")) {
          subjects.push(cleaned);
        }
      }
    }
  }
  
  return subjects;
}

/**
 * Extract ACM computing categories if present.
 */
export function extractAcmCategories(doc: Document): string[] {
  const categories: string[] = [];
  
  // ACM categories are sometimes listed separately
  const acmEl = doc.querySelector(".acm-classes, .msc-classes");
  if (acmEl) {
    const text = acmEl.textContent?.trim() || "";
    const parts = text.split(/[;,]/);
    for (const part of parts) {
      const cleaned = part.trim();
      if (cleaned) {
        categories.push(cleaned);
      }
    }
  }
  
  return categories;
}

/**
 * Extract comments/notes from the page.
 */
export function extractComments(doc: Document): string | null {
  const commentsEl = doc.querySelector(".comments, #comments");
  if (commentsEl) {
    const text = commentsEl.textContent?.trim() || "";
    // Clean up "Comments:" prefix
    return text.replace(/^Comments:\s*/i, "").trim() || null;
  }
  return null;
}

/**
 * Extract journal reference if present.
 */
export function extractJournalRef(doc: Document): string | null {
  const journalEl = doc.querySelector(".journal-ref, #journal-ref");
  if (journalEl) {
    const text = journalEl.textContent?.trim() || "";
    return text.replace(/^Journal [Rr]eference:\s*/i, "").trim() || null;
  }
  return null;
}

/**
 * Extract DOI if present.
 */
export function extractDoi(doc: Document): string | null {
  const doiEl = doc.querySelector(".doi, #doi, a[href*='doi.org']");
  if (doiEl) {
    // Check for DOI link
    const href = doiEl.getAttribute("href");
    if (href && href.includes("doi.org")) {
      return href.replace(/.*doi\.org\//, "");
    }
    
    // Check text content
    const text = doiEl.textContent?.trim() || "";
    const match = text.match(/10\.\d{4,}\/[^\s]+/);
    if (match) {
      return match[0];
    }
  }
  return null;
}

/**
 * Full extraction result for an ArXiv paper.
 */
export interface ArxivPaper {
  arxivId: string | null;
  title: string | null;
  authors: string[];
  abstract: string | null;
  subjects: string[];
  acmCategories: string[];
  comments: string | null;
  journalRef: string | null;
  doi: string | null;
  submissionDate: string | null;
  version: number | null;
  pdfUrl: string | null;
  absUrl: string | null;
  htmlUrl: string | null;
}

/**
 * Extract all relevant information from an ArXiv page.
 */
export function extractArxivPaper(doc: Document, url: string): ArxivPaper {
  const arxivId = extractArxivId(url);
  
  return {
    arxivId,
    title: extractTitle(doc),
    authors: extractAuthors(doc),
    abstract: extractAbstract(doc),
    subjects: extractSubjects(doc),
    acmCategories: extractAcmCategories(doc),
    comments: extractComments(doc),
    journalRef: extractJournalRef(doc),
    doi: extractDoi(doc),
    submissionDate: extractSubmissionDate(doc),
    version: extractVersion(url),
    pdfUrl: arxivId ? buildPdfUrl(arxivId) : null,
    absUrl: arxivId ? buildArxivUrl(arxivId) : null,
    htmlUrl: arxivId ? buildAr5ivUrl(arxivId) : null
  };
}

/**
 * Generate a BibTeX citation for the paper.
 */
export function generateBibtex(paper: ArxivPaper): string {
  if (!paper.arxivId || !paper.title) {
    return "";
  }
  
  // Generate citation key from first author's last name and year
  const firstAuthor = paper.authors[0] || "Unknown";
  const lastName = firstAuthor.split(/\s+/).pop() || firstAuthor;
  const yearMatch = paper.submissionDate?.match(/\d{4}/);
  const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();
  const citeKey = `${lastName.toLowerCase()}${year}${paper.arxivId.replace(/[./]/g, "")}`;
  
  let bibtex = `@article{${citeKey},\n`;
  bibtex += `  title     = {${paper.title}},\n`;
  
  if (paper.authors.length > 0) {
    bibtex += `  author    = {${paper.authors.join(" and ")}},\n`;
  }
  
  bibtex += `  journal   = {arXiv preprint arXiv:${paper.arxivId}},\n`;
  bibtex += `  year      = {${year}},\n`;
  
  if (paper.doi) {
    bibtex += `  doi       = {${paper.doi}},\n`;
  }
  
  bibtex += `  url       = {${paper.absUrl || `https://arxiv.org/abs/${paper.arxivId}`}}\n`;
  bibtex += `}`;
  
  return bibtex;
}

/**
 * Generate a simple citation string.
 */
export function generateCitation(paper: ArxivPaper): string {
  if (!paper.title) {
    return "";
  }
  
  const authors = paper.authors.length > 0 
    ? paper.authors.length > 2 
      ? `${paper.authors[0]} et al.`
      : paper.authors.join(" & ")
    : "Unknown Author";
  
  const yearMatch = paper.submissionDate?.match(/\d{4}/);
  const year = yearMatch ? ` (${yearMatch[0]})` : "";
  
  const arxivRef = paper.arxivId ? ` arXiv:${paper.arxivId}` : "";
  
  return `${authors}${year}. "${paper.title}".${arxivRef}`;
}

/**
 * Format ArXiv content as markdown.
 */
export function formatArxivContent(paper: ArxivPaper, includeBibtex: boolean = true): string {
  let md = "";
  
  // Title
  if (paper.title) {
    md += `# ${paper.title}\n\n`;
  }
  
  // Authors
  if (paper.authors.length > 0) {
    md += `**Authors:** ${paper.authors.join(", ")}\n\n`;
  }
  
  // ArXiv ID and links
  if (paper.arxivId) {
    md += `**ArXiv ID:** [\`${paper.arxivId}\`](${paper.absUrl})\n\n`;
    
    // Quick links
    md += `[PDF](${paper.pdfUrl}) | [HTML](${paper.htmlUrl})\n\n`;
  }
  
  // Submission date
  if (paper.submissionDate) {
    md += `**Submitted:** ${paper.submissionDate}\n\n`;
  }
  
  // Subjects
  if (paper.subjects.length > 0) {
    md += `**Subjects:** ${paper.subjects.map(s => `\`${s}\``).join(", ")}\n\n`;
  }
  
  // Abstract
  if (paper.abstract) {
    md += `## Abstract\n\n${paper.abstract}\n\n`;
  }
  
  // Comments
  if (paper.comments) {
    md += `> **Comments:** ${paper.comments}\n\n`;
  }
  
  // Journal reference
  if (paper.journalRef) {
    md += `**Journal Reference:** ${paper.journalRef}\n\n`;
  }
  
  // DOI
  if (paper.doi) {
    md += `**DOI:** [${paper.doi}](https://doi.org/${paper.doi})\n\n`;
  }
  
  // BibTeX citation
  if (includeBibtex && paper.arxivId) {
    md += `## Citation\n\n`;
    md += `\`\`\`bibtex\n${generateBibtex(paper)}\n\`\`\`\n\n`;
  }
  
  return md;
}

// Register the templates
registerBuiltInTemplates([arxivTemplate, ar5ivTemplate]);
