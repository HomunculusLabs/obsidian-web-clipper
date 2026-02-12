/**
 * GitHub site template for extracting repository content, issues, and pull requests.
 * 
 * Handles:
 * - Repository main pages (README)
 * - Issue pages
 * - Pull request pages
 * - Code file pages
 * 
 * Extracts repo metadata (stars, forks, language), issue/PR details,
 * and code with syntax highlighting.
 */

import type { SiteTemplate } from "../../shared/templates";
import { registerBuiltInTemplates } from "./registry";

// ============================================================================
// Template Definitions
// ============================================================================

/**
 * Main GitHub repository template for README pages.
 * Matches: github.com/{owner}/{repo} and github.com/{owner}/{repo}/tree/{branch}
 */
export const githubRepoTemplate: SiteTemplate = {
  domain: "github.com",
  name: "GitHub Repository",
  description: "Extract GitHub repository README and metadata",
  enabled: true,
  priority: 100,
  urlPattern: "^/[^/]+/[^/]+(/tree/.*)?$",
  selectors: {
    // README content - GitHub uses article.markdown-body
    content: "article.markdown-body, .repository-content .readme article",
    // Repo title shown in the header
    title: "h1 [itemprop='name'] a, .author a, strong[itemprop='name'] a",
    // Description shown below title
    description: ".Layout-sidebar p.f4, p.f4.my-3",
    // Primary language
    tags: "[itemprop='programmingLanguage'], .Layout-sidebar span[data-ga-click*='language']"
  },
  removeSelectors: [
    // Remove edit buttons on README
    ".markdown-body .octicon-pencil",
    ".markdown-body a[aria-label*='Edit']",
    // Remove copy buttons
    "button[data-clipboard-target]",
    ".zeroclipboard-button",
    // Remove anchor links
    ".markdown-body a.anchor",
    // Remove "on this page" TOC
    ".Layout-sidebar nav[aria-label='Page navigation']",
    // Remove action buttons
    ".file-navigation",
    ".js-socket-channel",
    // Remove "Raw" and "Blame" buttons on file views
    ".js-permalink-shortcut",
    "[data-hotkey='b']",
    // Remove reaction buttons
    ".social-reactions",
    // Remove lazy loaded image placeholders
    "img[data-canonical-src]"
  ],
  frontmatterExtras: {
    site: "github"
  }
};

/**
 * GitHub issue template.
 * Matches: github.com/{owner}/{repo}/issues/{number}
 */
export const githubIssueTemplate: SiteTemplate = {
  domain: "github.com",
  name: "GitHub Issue",
  description: "Extract GitHub issue with title, body, and comments",
  enabled: true,
  priority: 150, // Higher than repo template
  urlPattern: "^/[^/]+/[^/]+/issues/\\d+",
  selectors: {
    // Issue title
    title: ".js-issue-title, h1[data-testid='issue-header'] .js-issue-title",
    // Issue body + comments container
    content: "#discussion_bucket, .discussion-timeline, [data-testid='issue-viewer']",
    // Issue author
    author: ".timeline-comment-header .author, [data-testid='issue-header'] .author",
    // Issue creation date
    date: ".timeline-comment-header time, [data-testid='issue-header'] time",
    // Labels as tags
    tags: ".js-issue-labels .IssueLabel, [data-testid='issue-labels'] .IssueLabel"
  },
  removeSelectors: [
    // Remove reaction buttons
    ".reaction-popover-container",
    ".social-reaction-summary",
    // Remove edit/delete buttons
    ".timeline-comment-actions",
    "button[aria-label*='Edit']",
    // Remove reference links
    ".devsite-references",
    // Remove sidebar
    ".discussion-sidebar",
    "[data-testid='issue-metadata']",
    // Remove "Subscribe" button
    ".thread-subscription-status",
    // Remove copy buttons
    "button[data-clipboard-target]"
  ],
  frontmatterExtras: {
    site: "github",
    type: "issue"
  }
};

/**
 * GitHub pull request template.
 * Matches: github.com/{owner}/{repo}/pull/{number}
 */
export const githubPRTemplate: SiteTemplate = {
  domain: "github.com",
  name: "GitHub Pull Request",
  description: "Extract GitHub PR with description, commits, and comments",
  enabled: true,
  priority: 150, // Higher than repo template
  urlPattern: "^/[^/]+/[^/]+/pull/\\d+",
  selectors: {
    // PR title
    title: ".js-issue-title, h1[data-testid='prheader-title'] .js-issue-title",
    // PR body + discussion + files changed container
    content: "#discussion_bucket, .discussion-timeline, [data-testid='pr-viewer']",
    // PR author
    author: ".timeline-comment-header .author, [data-testid='prheader-author'] .author",
    // PR creation date
    date: ".timeline-comment-header time, [data-testid='prheader-author'] time",
    // Labels as tags
    tags: ".js-issue-labels .IssueLabel, [data-testid='pr-labels'] .IssueLabel"
  },
  removeSelectors: [
    // Remove reaction buttons
    ".reaction-popover-container",
    ".social-reaction-summary",
    // Remove edit/delete buttons
    ".timeline-comment-actions",
    "button[aria-label*='Edit']",
    // Remove sidebar (reviewers, assignees, etc.)
    ".discussion-sidebar",
    // Remove merge controls
    ".mergeability-details",
    // Remove file diff stats
    ".diffstat",
    // Remove copy buttons
    "button[data-clipboard-target]"
  ],
  frontmatterExtras: {
    site: "github",
    type: "pull-request"
  }
};

/**
 * GitHub code file template.
 * Matches: github.com/{owner}/{repo}/blob/{branch}/{path}
 */
export const githubCodeTemplate: SiteTemplate = {
  domain: "github.com",
  name: "GitHub Code File",
  description: "Extract GitHub code file with syntax highlighting",
  enabled: true,
  priority: 140, // Higher than repo template, lower than issue/PR
  urlPattern: "^/[^/]+/[^/]+/blob/",
  selectors: {
    // File content - use the code table
    content: ".blob-wrapper-embedded, .highlight, [data-testid='file-content']",
    // File name from breadcrumb
    title: ".breadcrumb strong.final-path, [data-testid='file-name']",
    // Author info from blame (if available)
    author: ".blame-commit .user-mention"
  },
  removeSelectors: [
    // Remove line numbers
    ".blob-num",
    "td[data-line-number]",
    // Remove copy button
    "button[data-clipboard-target]",
    // Remove "View raw" link
    ".js-permalink-shortcut",
    // Remove blame toggle
    "[data-hotkey='b']"
  ],
  frontmatterExtras: {
    site: "github",
    type: "code"
  }
};

/**
 * GitHub gist template.
 * Matches: gist.github.com/{user}/{gist_id}
 */
export const githubGistTemplate: SiteTemplate = {
  domain: "gist.github.com",
  name: "GitHub Gist",
  description: "Extract GitHub gist content",
  enabled: true,
  priority: 100,
  selectors: {
    // All gist files
    content: ".gist-details, .file",
    // Gist title (from filename or description)
    title: ".gist-description, .file-header strong",
    // Gist author
    author: ".author, .creator a",
    // Creation date
    date: "time, .timestamp"
  },
  removeSelectors: [
    // Remove copy buttons
    "button[data-clipboard-target]",
    ".zeroclipboard-button",
    // Remove line numbers for cleaner extraction
    ".blob-num",
    "td[data-line-number]",
    // Remove edit/delete buttons
    ".octicon-pencil",
    ".octicon-trashcan",
    // Remove "Embed" link
    "[data-ga-click*='Embed']"
  ],
  frontmatterExtras: {
    site: "github",
    type: "gist"
  }
};

// ============================================================================
// Extraction Utilities
// ============================================================================

/**
 * Extract repo owner and name from URL.
 * Returns null if not a valid repo URL.
 */
export function extractRepoInfo(url: string): { owner: string; repo: string } | null {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    
    if (pathParts.length >= 2) {
      return {
        owner: pathParts[0],
        repo: pathParts[1]
      };
    }
  } catch {
    // Invalid URL
  }
  return null;
}

/**
 * Extract issue/PR number from URL.
 * Returns null if not an issue or PR URL.
 */
export function extractIssueOrPRNumber(url: string): number | null {
  try {
    const urlObj = new URL(url);
    const match = urlObj.pathname.match(/\/(issues|pull)\/(\d+)/);
    if (match) {
      return parseInt(match[2], 10);
    }
  } catch {
    // Invalid URL
  }
  return null;
}

/**
 * Detect the type of GitHub page.
 */
export type GitHubPageType = "repo" | "issue" | "pr" | "code" | "gist" | "unknown";

export function detectGitHubPageType(url: string): GitHubPageType {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const pathname = urlObj.pathname;
    
    // Gist
    if (hostname === "gist.github.com") {
      return "gist";
    }
    
    // PR
    if (pathname.includes("/pull/")) {
      return "pr";
    }
    
    // Issue
    if (pathname.includes("/issues/")) {
      return "issue";
    }
    
    // Code file (blob)
    if (pathname.includes("/blob/")) {
      return "code";
    }
    
    // Default to repo
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return "repo";
    }
    
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Extract repo stats from the page.
 */
export function extractRepoStats(doc: Document): {
  stars: number;
  forks: number;
  watchers: number;
  language: string;
} {
  // Try to find the stats in the sidebar or header
  let stars = 0;
  let forks = 0;
  let watchers = 0;
  let language = "";
  
  // Stars - look for the star count button
  const starButton = doc.querySelector("[data-ga-click*='star button'], a[href*='/stargazers']");
  if (starButton) {
    const starText = starButton.textContent || "";
    const match = starText.match(/(\d[\d,]*)\s*Star/i) || starText.match(/(\d[\d,]*)/);
    if (match) {
      stars = parseInt(match[1].replace(/,/g, ""), 10);
    }
  }
  
  // Forks
  const forkButton = doc.querySelector("[data-ga-click*='fork button'], a[href*='/forks']");
  if (forkButton) {
    const forkText = forkButton.textContent || "";
    const match = forkText.match(/(\d[\d,]*)\s*Fork/i) || forkText.match(/(\d[\d,]*)/);
    if (match) {
      forks = parseInt(match[1].replace(/,/g, ""), 10);
    }
  }
  
  // Watchers
  const watchButton = doc.querySelector("[data-ga-click*='watch button'], a[href*='/watchers']");
  if (watchButton) {
    const watchText = watchButton.textContent || "";
    const match = watchText.match(/(\d[\d,]*)\s*Watch/i) || watchText.match(/(\d[\d,]*)/);
    if (match) {
      watchers = parseInt(match[1].replace(/,/g, ""), 10);
    }
  }
  
  // Primary language
  const langEl = doc.querySelector("[itemprop='programmingLanguage'], .Layout-sidebar span[data-ga-click*='language']");
  if (langEl) {
    language = langEl.textContent?.trim() || "";
  }
  
  return { stars, forks, watchers, language };
}

/**
 * Extract issue/PR metadata from the page.
 */
export function extractIssueMetadata(doc: Document): {
  status: "open" | "closed" | "merged";
  labels: string[];
  assignees: string[];
  milestone: string;
} {
  let status: "open" | "closed" | "merged" = "open";
  const labels: string[] = [];
  const assignees: string[] = [];
  let milestone = "";
  
  // Status - look for state badge
  const stateEl = doc.querySelector("[data-ga-click*='State'], .State");
  if (stateEl) {
    const stateClass = stateEl.className;
    if (stateClass.includes("closed") || stateClass.includes("State--closed")) {
      status = "closed";
    } else if (stateClass.includes("merged") || stateClass.includes("State--merged")) {
      status = "merged";
    }
  }
  
  // Labels
  const labelEls = doc.querySelectorAll(".IssueLabel, .js-issue-labels a");
  for (const el of Array.from(labelEls)) {
    const label = el.textContent?.trim();
    if (label) {
      labels.push(label);
    }
  }
  
  // Assignees
  const assigneeEls = doc.querySelectorAll(".assignee, [data-testid='assignee'] a, .sidebar-assignee a");
  for (const el of Array.from(assigneeEls)) {
    const assignee = el.getAttribute("href")?.replace("/", "@") || el.textContent?.trim();
    if (assignee && !assignees.includes(assignee)) {
      assignees.push(assignee);
    }
  }
  
  // Milestone
  const milestoneEl = doc.querySelector(".milestone-name, [data-testid='milestone'] a");
  if (milestoneEl) {
    milestone = milestoneEl.textContent?.trim() || "";
  }
  
  return { status, labels, assignees, milestone };
}

/**
 * Extract all code blocks from a page and add language hints.
 * GitHub code blocks have syntax highlighting via CSS classes.
 */
export function extractCodeLanguages(doc: Document): Map<Element, string> {
  const result = new Map<Element, string>();
  
  // Find all code blocks
  const codeBlocks = doc.querySelectorAll("pre, .highlight");
  
  for (const block of Array.from(codeBlocks)) {
    // Check for language class on the highlight div
    const highlightDiv = block.closest(".highlight");
    if (highlightDiv) {
      const classes = highlightDiv.className.split(/\s+/);
      for (const cls of classes) {
        // GitHub uses classes like "highlight-source-js", "highlight-language-python"
        const match = cls.match(/highlight-(?:source-|language-)?(\w+)/);
        if (match && match[1] !== "highlight") {
          result.set(block, match[1]);
          break;
        }
      }
    }
    
    // Check data-lang attribute
    if (!result.has(block)) {
      const lang = block.getAttribute("data-lang");
      if (lang) {
        result.set(block, lang);
      }
    }
  }
  
  return result;
}

/**
 * Build enhanced markdown for GitHub content.
 */
export function formatGitHubContent(
  title: string,
  content: string,
  pageType: GitHubPageType,
  repoInfo: { owner: string; repo: string } | null,
  stats: ReturnType<typeof extractRepoStats> | null,
  issueMeta: ReturnType<typeof extractIssueMetadata> | null
): string {
  let md = `# ${title}\n\n`;
  
  // Add repo context
  if (repoInfo) {
    md += `> Repository: [${repoInfo.owner}/${repoInfo.repo}](https://github.com/${repoInfo.owner}/${repoInfo.repo})`;
    
    if (pageType === "repo" && stats) {
      const statsParts: string[] = [];
      if (stats.stars > 0) statsParts.push(`⭐ ${stats.stars.toLocaleString()}`);
      if (stats.forks > 0) statsParts.push(`🍴 ${stats.forks.toLocaleString()}`);
      if (stats.language) statsParts.push(`🌐 ${stats.language}`);
      if (statsParts.length > 0) {
        md += ` | ${statsParts.join(" | ")}`;
      }
    }
    md += "\n\n";
  }
  
  // Add issue/PR metadata
  if ((pageType === "issue" || pageType === "pr") && issueMeta) {
    const statusIcon = {
      open: "🟢",
      closed: "🔴",
      merged: "🟣"
    }[issueMeta.status];
    
    md += `> ${statusIcon} Status: **${issueMeta.status}**`;
    
    if (issueMeta.labels.length > 0) {
      md += ` | Labels: ${issueMeta.labels.map((l) => `\`${l}\``).join(", ")}`;
    }
    
    if (issueMeta.milestone) {
      md += ` | Milestone: ${issueMeta.milestone}`;
    }
    
    md += "\n\n";
  }
  
  // Add content
  md += content;
  
  return md;
}

// Register all GitHub templates
registerBuiltInTemplates([
  githubRepoTemplate,
  githubIssueTemplate,
  githubPRTemplate,
  githubCodeTemplate,
  githubGistTemplate
]);
