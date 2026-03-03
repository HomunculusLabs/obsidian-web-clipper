/**
 * GitHub README Link-Follow Extraction
 *
 * Integrates canonicalization into README link-follow extraction before
 * depth-1 filtering and dedupe passes. This is TP003 implementation.
 *
 * Contract: docs/quality/github-relative-link-canonicalization-contract.md
 */

import {
  normalizeGithubReadmeLinks,
  buildGithubContextFromUrl,
  extractMarkdownLinks,
  type NormalizationOutput,
  type NormalizationResult,
  type GitHubRepoContext,
  type MarkdownLink
} from "./githubRelativeLinkCanonicalization";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Depth-1 child link extracted from GitHub README.
 */
export interface GitHubLinkFollowChild {
  /** Canonical URL of the child repo */
  url: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Derived filename for sibling note (parent-repo-child-repo) */
  filename: string;
  /** How this link was discovered */
  discovery_source: "readme_link" | "manual" | "other";
  /** Depth level (always 1 for this implementation) */
  depth: number;
  /** Original link text from README */
  link_text: string;
  /** Section heading where link was found (if available) */
  context_section?: string;
}

/**
 * Discovered links statistics.
 */
export interface DiscoveredLinksStats {
  /** Total raw links found in README */
  total: number;
  /** Unique links after canonicalization */
  unique: number;
  /** After deduplication */
  after_dedupe: number;
  /** After depth-1 filtering */
  after_exclusions: number;
}

/**
 * Excluded link with reason.
 */
export interface ExcludedLink {
  /** Original link */
  original: string;
  /** Rejection rule ID from canonicalization */
  reject_rule: string;
  /** Diagnostic message */
  diagnostic?: string;
  /** Exclusion category */
  category: "self_reference" | "non_github" | "has_path_beyond_repo" | "tree_path" | "other";
}

/**
 * Link-follow configuration.
 */
export interface GitHubLinkFollowConfig {
  /** Whether link-follow is enabled */
  enabled: boolean;
  /** Maximum depth (always 1 for current implementation) */
  depth_limit: number;
  /** Deduplication strategy */
  dedupe_strategy: "url_deduplication";
  /** Ordering strategy */
  ordering: "alphabetical_by_url";
  /** URL patterns to include */
  include_patterns: string[];
  /** URL patterns to exclude */
  exclude_patterns: string[];
}

/**
 * Link-follow extraction result.
 */
export interface GitHubLinkFollowResult {
  /** Parent repository info */
  parent: {
    owner: string;
    repo: string;
    url: string;
    filename: string;
  };
  /** Link-follow configuration */
  link_follow: GitHubLinkFollowConfig;
  /** Extracted children (depth-1 repos) */
  children: GitHubLinkFollowChild[];
  /** Discovered links statistics */
  discovered_links: DiscoveredLinksStats;
  /** Excluded links with reasons */
  excluded_links: ExcludedLink[];
  /** Exclusion reasons by category */
  exclusion_reasons: {
    self_reference: string[];
    non_github: string[];
    has_path_beyond_repo: string[];
    tree_path: string[];
  };
}

/**
 * Extraction options.
 */
export interface GitHubLinkFollowOptions {
  /** README markdown content */
  markdown: string;
  /** Full README URL */
  readmeUrl: string;
  /** Parent filename for sibling note naming */
  parentFilename: string;
  /** Default branch (defaults to "main") */
  defaultBranch?: string;
  /** Custom context section (optional) */
  contextSection?: string;
}

// ============================================================================
// Link-Follow Extraction
// ============================================================================

/**
 * Extract GitHub repo links from README content with canonicalization.
 *
 * This is the main entry point for TP003 integration. It:
 * 1. Builds GitHub context from README URL
 * 2. Normalizes all markdown links using canonicalization helper
 * 3. Filters to depth-1 (repo root URLs only)
 * 4. Applies deduplication and sorting
 * 5. Returns structured output with children, stats, and exclusions
 *
 * @param options - Extraction options
 * @returns Link-follow extraction result
 */
export function extractGitHubLinkFollow(
  options: GitHubLinkFollowOptions
): GitHubLinkFollowResult {
  const {
    markdown,
    readmeUrl,
    parentFilename,
    defaultBranch = "main",
    contextSection
  } = options;

  // Step 1: Build GitHub context
  const context = buildGithubContextFromUrl(readmeUrl, defaultBranch);
  if (!context) {
    throw new Error(`Unable to build GitHub context from URL: ${readmeUrl}`);
  }

  // Step 2: Normalize all links using canonicalization helper (TP003 integration)
  const normalizationOutput: NormalizationOutput = normalizeGithubReadmeLinks(
    markdown,
    context
  );

  // Step 3: Filter to depth-1 (repo root URLs only)
  const depth1Children = filterToDepth1(
    normalizationOutput.results,
    context,
    contextSection
  );

  // Step 4: Build excluded links from normalization results
  const excludedLinks = buildExcludedLinks(
    normalizationOutput.originalResults,
    context
  );

  // Step 5: Build discovered links statistics
  const stats: DiscoveredLinksStats = {
    total: normalizationOutput.originalResults.length,
    unique: normalizationOutput.originalResults.filter(
      r => r.canonicalUrl !== null
    ).length,
    after_dedupe: depth1Children.length,
    after_exclusions: depth1Children.length
  };

  // Step 6: Build result
  const result: GitHubLinkFollowResult = {
    parent: {
      owner: context.owner,
      repo: context.repo,
      url: readmeUrl,
      filename: parentFilename
    },
    link_follow: {
      enabled: true,
      depth_limit: 1,
      dedupe_strategy: "url_deduplication",
      ordering: "alphabetical_by_url",
      include_patterns: [
        "^https://github\\.com/[^/]+/[^/]+$"
      ],
      exclude_patterns: [
        `^${readmeUrl}$`,
        "^https://github\\.com/[^/]+/[^/]+/(issues|pull|tree|blob|wiki|actions|releases)/",
        "^https://github\\.com/[^/]+/[^/]+/tree/[^/]+/"
      ]
    },
    children: depth1Children,
    discovered_links: stats,
    excluded_links: excludedLinks,
    exclusion_reasons: {
      self_reference: excludedLinks
        .filter(l => l.category === "self_reference")
        .map(l => l.original),
      non_github: excludedLinks
        .filter(l => l.category === "non_github")
        .map(l => l.original),
      has_path_beyond_repo: excludedLinks
        .filter(l => l.category === "has_path_beyond_repo")
        .map(l => l.original),
      tree_path: excludedLinks
        .filter(l => l.category === "tree_path")
        .map(l => l.original)
    }
  };

  return result;
}

/**
 * Filter canonicalization results to depth-1 repo root URLs.
 * Depth-1 means: https://github.com/owner/repo (no additional path)
 */
function filterToDepth1(
  results: NormalizationResult[],
  context: GitHubRepoContext,
  contextSection?: string
): GitHubLinkFollowChild[] {
  const children: GitHubLinkFollowChild[] = [];

  // Regex for GitHub repo root URLs
  // Match: https://github.com/owner/repo (no path after repo name)
  const repoRootPattern = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/;

  for (const result of results) {
    // Skip rejected links
    if (result.canonicalUrl === null) {
      continue;
    }

    const match = result.canonicalUrl.match(repoRootPattern);
    if (!match) {
      // Not a repo root URL - would be depth > 1
      continue;
    }

    const [, owner, repo] = match;

    // Build child object
    const child: GitHubLinkFollowChild = {
      url: result.canonicalUrl,
      owner,
      repo,
      filename: `${context.repo}-${repo}`,
      discovery_source: "readme_link",
      depth: 1,
      link_text: result.original.text || result.original.target,
      context_section: contextSection
    };

    children.push(child);
  }

  // Sort alphabetically by URL (canonicalization helper already does this,
  // but we sort again to be deterministic)
  return children.sort((a, b) => a.url.localeCompare(b.url));
}

/**
 * Build excluded links from normalization results.
 */
function buildExcludedLinks(
  results: NormalizationResult[],
  context: GitHubRepoContext
): ExcludedLink[] {
  const excluded: ExcludedLink[] = [];

  for (const result of results) {
    // Skip successfully canonicalized links with no rejection
    if (result.canonicalUrl !== null && result.rejectRule === "none") {
      continue;
    }

    // Determine exclusion category
    let category: ExcludedLink["category"] = "other";
    if (result.category === "github-url-with-path") {
      category = "tree_path";
    } else if (result.rejectRule === "RJ01_FRAGMENT_ONLY") {
      category = "other"; // Fragment links
    } else if (result.rejectRule === "RJ02_EXTERNAL_URL") {
      category = "non_github";
    } else if (result.rejectRule === "RJ04_SELF_REFERENCE") {
      category = "self_reference";
    } else if (result.rejectRule === "RJ05_CROSS_REPO_RELATIVE") {
      category = "has_path_beyond_repo";
    }

    excluded.push({
      original: result.original.target,
      reject_rule: result.rejectRule,
      diagnostic: result.diagnostic,
      category
    });
  }

  return excluded;
}

// ============================================================================
// Context Section Extraction
// ============================================================================

/**
 * Extract context section from markdown for a given link.
 * Returns the nearest heading text above the link.
 */
export function extractContextSection(
  markdown: string,
  linkIndex: number
): string | undefined {
  // Find all headings
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  const headings: Array<{ index: number; level: number; text: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(markdown)) !== null) {
    headings.push({
      index: match.index,
      level: match[1].length,
      text: match[2].trim()
    });
  }

  // Find all links to determine link positions
  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  let linkPosition = 0;
  let currentLinkIndex = 0;

  while ((match = linkPattern.exec(markdown)) !== null) {
    if (currentLinkIndex === linkIndex) {
      linkPosition = match.index;
      break;
    }
    currentLinkIndex++;
  }

  // Find nearest heading before this link
  let nearestHeading: typeof headings[0] | undefined;
  for (const heading of headings) {
    if (heading.index < linkPosition) {
      nearestHeading = heading;
    } else {
      break;
    }
  }

  return nearestHeading ? nearestHeading.text : undefined;
}

// ============================================================================
// Exports
// ============================================================================

export {
  // Re-export from canonicalization helper for convenience
  buildGithubContextFromUrl,
  extractMarkdownLinks,
  normalizeGithubReadmeLinks
};

export type {
  // Re-export types
  NormalizationOutput,
  NormalizationResult,
  GitHubRepoContext,
  MarkdownLink
};
