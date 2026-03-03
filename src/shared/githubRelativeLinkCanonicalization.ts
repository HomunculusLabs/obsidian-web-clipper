/**
 * GitHub README Relative-Link Canonicalization
 *
 * Normalizes relative markdown links in GitHub READMEs to absolute GitHub URLs.
 * Supports same-repo relative targets (./, ../, /, /tree/..., /blob/...) with
 * repo-branch/path awareness.
 *
 * Contract: docs/quality/github-relative-link-canonicalization-contract.md
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Relative link classification categories per contract
 */
export type RelativeLinkCategory =
  | "same-directory"
  | "parent-directory"
  | "root-relative"
  | "github-tree-blob"
  | "github-repo-url"
  | "github-url-with-path"
  | "repository-shorthand"
  | "fragment-only"
  | "external-url"
  | "unsupported-scheme"
  | "self-reference"
  | "cross-repo-relative"
  | "malformed"
  | "unknown";

/**
 * Reject rule IDs per contract
 */
export type RejectRuleId =
  | "RJ01_FRAGMENT_ONLY"
  | "RJ02_EXTERNAL_URL"
  | "RJ03_UNSUPPORTED_SCHEME"
  | "RJ04_SELF_REFERENCE"
  | "RJ05_CROSS_REPO_RELATIVE"
  | "RJ06_MALFORMED_LINK"
  | "RJ07_NON_MARKDOWN_RESOURCE"
  | "none"; // No rejection

/**
 * Error rule IDs per contract
 */
export type ErrorRuleId =
  | "EH01_MALFORMED_MARKDOWN"
  | "EH02_RESOLUTION_FAILURE"
  | "EH03_BRANCH_DETECTION_FAILURE"
  | "none"; // No error

/**
 * Parsed markdown link
 */
export interface MarkdownLink {
  /** Link text content */
  text: string;
  /** Link target/URL (raw, as it appears in markdown) */
  target: string;
  /** Start position in source (if available) */
  position?: number;
}

/**
 * Normalization result for a single link
 */
export interface NormalizationResult {
  /** Original link */
  original: MarkdownLink;
  /** Link category */
  category: RelativeLinkCategory;
  /** Resolved canonical URL (if successful) */
  canonicalUrl: string | null;
  /** Reject rule (if rejected) */
  rejectRule: RejectRuleId;
  /** Error rule (if error occurred) */
  errorRule: ErrorRuleId;
  /** Diagnostic message for errors/rejections */
  diagnostic?: string;
}

/**
 * Batch normalization output
 */
export interface NormalizationOutput {
  /** Individual results for each link (after deduplication and sorting) */
  results: NormalizationResult[];
  /** Original results before deduplication (for stats) */
  originalResults: NormalizationResult[];
  /** Successfully canonicalized links (sorted, deduped) */
  canonicalLinks: string[];
  /** Rejected links count */
  rejectedCount: number;
  /** Error count */
  errorCount: number;
}

/**
 * GitHub repository context for resolution
 */
export interface GitHubRepoContext {
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Default branch (main, master, etc.) */
  defaultBranch: string;
  /** Current README path (e.g., "blob/main/README.md" or empty for root) */
  currentPath: string;
  /** Current full URL (for self-reference detection) */
  currentUrl: string;
}

// ============================================================================
// Markdown Link Parser
// ============================================================================

const MARKDOWN_LINK_REGEX = /\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Extract markdown links from markdown content.
 * Returns array of parsed links with text and target.
 */
export function extractMarkdownLinks(markdown: string): MarkdownLink[] {
  if (!markdown) return [];

  const links: MarkdownLink[] = [];
  let match: RegExpExecArray | null;

  while ((match = MARKDOWN_LINK_REGEX.exec(markdown)) !== null) {
    const [, text, target] = match;
    links.push({
      text: text || "",
      target: target || "",
      position: match.index
    });
  }

  return links;
}

// ============================================================================
// Link Classifier
// ============================================================================

/**
 * Classify a link target into its category.
 */
export function classifyLink(target: string): RelativeLinkCategory {
  if (!target || target.trim() === "") {
    return "malformed";
  }

  const trimmed = target.trim();

  // Self-references (RJ04) - must check before same-directory
  if (trimmed === "." || trimmed === "./") {
    return "self-reference";
  }

  // Fragment-only links (RJ01)
  if (trimmed.startsWith("#") && !trimmed.includes("/")) {
    return "fragment-only";
  }

  // External URLs with schemes (RJ02, RJ03)
  const urlMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (urlMatch) {
    const scheme = urlMatch[1].toLowerCase();
    if (scheme === "http" || scheme === "https") {
      const urlObj = tryParseUrl(trimmed);
      if (urlObj && urlObj.hostname === "github.com") {
        // Classify GitHub URLs more specifically
        const pathParts = urlObj.pathname.split("/").filter(Boolean);
        // https://github.com/owner/repo (repo root)
        if (pathParts.length === 2) {
          return "github-repo-url";
        }
        // https://github.com/owner/repo/tree/..., https://github.com/owner/repo/blob/..., etc.
        if (pathParts.length >= 3) {
          return "github-url-with-path";
        }
        // Other GitHub URLs (issues, pull, etc.)
        return "external-url";
      }
      return "external-url";
    }
    return "unsupported-scheme";
  }

  // GitHub tree/blob links (NL06)
  if (trimmed.startsWith("/tree/") || trimmed.startsWith("/blob/")) {
    return "github-tree-blob";
  }

  // Root-relative links (NL05)
  if (trimmed.startsWith("/")) {
    return "root-relative";
  }

  // Repository shorthand (NL07) - owner/repo pattern (exactly 2 parts, both alphanumeric)
  // Also handles ../repo pattern when at repo root (sibling repo reference)
  const parts = trimmed.split("/");
  if (parts.length === 2 && /^[a-zA-Z0-9_-]+$/.test(parts[0]) && /^[a-zA-Z0-9_-]+$/.test(parts[1])) {
    return "repository-shorthand";
  }
  // Sibling repo reference: ../other-repo (when at repo root)
  if (parts.length === 2 && parts[0] === ".." && /^[a-zA-Z0-9_-]+$/.test(parts[1])) {
    return "repository-shorthand";
  }

  // Parent directory links (NL04) - ../ and other relative navigation
  if (trimmed.startsWith("../")) {
    return "parent-directory";
  }

  // Same-directory links (NL03) - handles both "./path" and "path"
  // At this point, check if it's a valid path (contains only valid characters)
  // Valid path characters: alphanumeric, hyphens, underscores, periods, spaces, and forward slashes
  if (/^[a-zA-Z0-9_\-.\/\s]+$/.test(trimmed)) {
    return "same-directory";
  }

  // Anything else is unknown/malformed
  return "unknown";
}

// ============================================================================
// URL Resolver
// ============================================================================

/**
 * Try to parse a URL, returning null on failure.
 */
function tryParseUrl(urlString: string): URL | null {
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}

/**
 * Parse branch from a GitHub blob/tree path.
 * Returns branch name or null if not found.
 */
export function extractBranchFromPath(path: string): string | null {
  // Path format: blob/{branch}/... or tree/{branch}/...
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2 && (parts[0] === "blob" || parts[0] === "tree")) {
    return parts[1];
  }
  return null;
}

/**
 * Resolve a same-directory relative link (NL03).
 * Examples: ./docs/api.md, docs/api.md
 */
function resolveSameDirectory(
  target: string,
  context: GitHubRepoContext
): string {
  // Remove ./ prefix if present
  const relativePath = target.startsWith("./") ? target.slice(2) : target;

  // Determine current directory from context
  const currentParts = context.currentPath.split("/").filter(Boolean);
  
  // Remove type (blob/tree) and filename to get directory
  const dirParts = currentParts.slice(1, -1); // Skip type, keep branch + dirs
  const currentDir = dirParts.join("/") || context.defaultBranch;

  // Build resolved path
  const resolvedPath = currentDir 
    ? `${currentDir}/${relativePath}`
    : relativePath;

  // Construct canonical URL
  return `https://github.com/${context.owner}/${context.repo}/blob/${resolvedPath}`;
}

/**
 * Resolve a parent directory link (NL04).
 * Examples: ../README.md, ../../CONTRIBUTING.md
 */
function resolveParentDirectory(
  target: string,
  context: GitHubRepoContext
): { url: string | null; error: ErrorRuleId; diagnostic?: string } {
  const parts = context.currentPath.split("/").filter(Boolean);
  
  // Remove type (blob/tree) and filename to get directory parts
  const dirParts = parts.slice(1, -1); // Skip type, keep branch + dirs
  
  // Count ../ prefixes
  const upCount = (target.match(/\.\.\//g) || []).length;
  const relativePart = target.replace(/\.\.\/+/g, "");

  // Check if navigation would go beyond branch root
  if (dirParts.length < upCount) {
    return {
      url: null,
      error: "EH02_RESOLUTION_FAILURE",
      diagnostic: `Parent directory navigation goes beyond repository root: ${target}`
    };
  }

  // Navigate up
  const newPathParts = dirParts.slice(0, dirParts.length - upCount);
  const resolvedPath = newPathParts.length > 0 
    ? `${newPathParts.join("/")}/${relativePart}`
    : `${context.defaultBranch}/${relativePart}`;

  return {
    url: `https://github.com/${context.owner}/${context.repo}/blob/${resolvedPath}`,
    error: "none"
  };
}

/**
 * Resolve a root-relative link (NL05).
 * Examples: /docs/api.md, /src/index.ts
 */
function resolveRootRelative(
  target: string,
  context: GitHubRepoContext
): string {
  const relativePath = target.startsWith("/") ? target.slice(1) : target;
  return `https://github.com/${context.owner}/${context.repo}/blob/${context.defaultBranch}/${relativePath}`;
}

/**
 * Resolve a GitHub tree/blob link (NL06).
 * Examples: /tree/main/docs/api.md, /blob/develop/src/index.ts
 */
function resolveGitHubTreeBlob(
  target: string,
  context: GitHubRepoContext
): { url: string | null; error: ErrorRuleId; diagnostic?: string } {
  // Format: /tree/{branch}/{path} or /blob/{branch}/{path}
  const parts = target.split("/").filter(Boolean);
  
  // Check if it starts with tree or blob
  if (parts.length === 0 || (parts[0] !== "tree" && parts[0] !== "blob")) {
    return {
      url: null,
      error: "EH02_RESOLUTION_FAILURE",
      diagnostic: `Invalid GitHub tree/blob link format: ${target}`
    };
  }

  // Must have at least branch and path
  if (parts.length < 3) {
    return {
      url: null,
      error: "EH02_RESOLUTION_FAILURE",
      diagnostic: `GitHub tree/blob link has no path: ${target}`
    };
  }

  const [, branch, ...pathParts] = parts;
  const path = pathParts.join("/");

  if (!path) {
    return {
      url: null,
      error: "EH02_RESOLUTION_FAILURE",
      diagnostic: `GitHub tree/blob link has no path: ${target}`
    };
  }

  return {
    url: `https://github.com/${context.owner}/${context.repo}/${parts[0]}/${branch}/${path}`,
    error: "none"
  };
}

/**
 * Resolve a repository shorthand link (NL07).
 * Examples: owner/repo, charmbracelet/bubbletea
 */
function resolveRepositoryShorthand(
  target: string,
  context: GitHubRepoContext
): string {
  // Handle sibling repo reference: ../other-repo
  if (target.startsWith("../")) {
    const siblingRepo = target.slice(3); // Remove ../
    return `https://github.com/${context.owner}/${siblingRepo}`;
  }
  // Regular owner/repo shorthand
  return `https://github.com/${target}`;
}

/**
 * Main resolver for a single link based on its category.
 */
export function resolveLink(
  target: string,
  category: RelativeLinkCategory,
  context: GitHubRepoContext
): { url: string | null; error: ErrorRuleId; diagnostic?: string } {
  switch (category) {
    case "same-directory":
      return { url: resolveSameDirectory(target, context), error: "none" };

    case "parent-directory":
      return resolveParentDirectory(target, context);

    case "root-relative":
      return { url: resolveRootRelative(target, context), error: "none" };

    case "github-tree-blob":
      return resolveGitHubTreeBlob(target, context);

    case "repository-shorthand":
      return { url: resolveRepositoryShorthand(target, context), error: "none" };

    case "github-repo-url":
      // Absolute GitHub repo URL - already canonical
      return { url: target, error: "none" };

    case "github-url-with-path":
      // Absolute GitHub URL with path - reject in canonicalization (depth-1 filter will handle)
      return { url: null, error: "none" };

    case "fragment-only":
    case "external-url":
    case "unsupported-scheme":
    case "self-reference":
    case "cross-repo-relative":
    case "malformed":
    case "unknown":
      // These don't get resolved - they're rejected
      return { url: null, error: "none" };

    default:
      const _exhaustive: never = category;
      return { url: null, error: "none" };
  }
}

// ============================================================================
// Reject Filter
// ============================================================================

/**
 * Determine if a link should be rejected and the reason.
 */
export function shouldReject(
  category: RelativeLinkCategory,
  target: string,
  canonicalUrl: string | null,
  context: GitHubRepoContext
): { reject: boolean; rule: RejectRuleId; diagnostic?: string } {
  switch (category) {
    case "fragment-only":
      return {
        reject: true,
        rule: "RJ01_FRAGMENT_ONLY",
        diagnostic: "Fragment-only link (page anchor)"
      };

    case "external-url":
      return {
        reject: true,
        rule: "RJ02_EXTERNAL_URL",
        diagnostic: "External URL (non-GitHub)"
      };

    case "unsupported-scheme":
      return {
        reject: true,
        rule: "RJ03_UNSUPPORTED_SCHEME",
        diagnostic: "Unsupported URL scheme"
      };

    case "self-reference":
      return {
        reject: true,
        rule: "RJ04_SELF_REFERENCE",
        diagnostic: "Self-reference link"
      };

    case "malformed":
      return {
        reject: true,
        rule: "RJ06_MALFORMED_LINK",
        diagnostic: "Malformed link"
      };

    case "github-repo-url":
      // Check for self-reference
      if (canonicalUrl && canonicalUrl === context.currentUrl) {
        return {
          reject: true,
          rule: "RJ04_SELF_REFERENCE",
          diagnostic: "Self-reference (absolute URL matches current repo)"
        };
      }
      // Otherwise, accept (depth-1 filter will keep repo roots)
      break;

    case "github-url-with-path":
      // GitHub URL with path - reject (not a repo root, depth-1 will filter)
      // But we need to check for self-reference first
      if (canonicalUrl) {
        const urlObj = tryParseUrl(canonicalUrl);
        if (urlObj && urlObj.hostname === "github.com") {
          const pathParts = urlObj.pathname.split("/").filter(Boolean);
          // Check if it's the same repo
          if (pathParts.length >= 2 && pathParts[0] === context.owner && pathParts[1] === context.repo) {
            // Same repo with path - reject (not depth-1)
            return {
              reject: true,
              rule: "none", // Not a standard reject rule, just not depth-1
              diagnostic: "Same repo with additional path (not depth-1)"
            };
          }
        }
      }
      // Other repo with path - also reject (not depth-1)
      return {
        reject: true,
        rule: "none",
        diagnostic: "GitHub URL with path (not depth-1)"
      };

    case "parent-directory":
      // Check if it would cross repo boundary
      const parts = context.currentPath.split("/").filter(Boolean);
      // Remove type (blob/tree) and filename to get directory parts
      const dirParts = parts.slice(1, -1); // Skip type, keep branch + dirs
      const upCount = (target.match(/\.\.\//g) || []).length;
      if (dirParts.length < upCount) {
        return {
          reject: true,
          rule: "RJ05_CROSS_REPO_RELATIVE",
          diagnostic: "Cross-repo relative link (navigation beyond root)"
        };
      }
      break;

    case "same-directory":
    case "root-relative":
    case "github-tree-blob":
    case "repository-shorthand":
      // Check for self-reference after resolution
      if (canonicalUrl && canonicalUrl === context.currentUrl) {
        return {
          reject: true,
          rule: "RJ04_SELF_REFERENCE",
          diagnostic: "Self-reference (resolved URL matches current)"
        };
      }
      break;

    case "unknown":
      return {
        reject: true,
        rule: "RJ06_MALFORMED_LINK",
        diagnostic: "Unknown link format"
      };

    case "cross-repo-relative":
      return {
        reject: true,
        rule: "RJ05_CROSS_REPO_RELATIVE",
        diagnostic: "Cross-repo relative link"
      };
  }

  return { reject: false, rule: "none" };
}

// ============================================================================
// Deduplication (OR02)
// ============================================================================

/**
 * Remove duplicate links based on canonical URL.
 * Keeps the first occurrence of each URL.
 */
export function dedupeLinks(results: NormalizationResult[]): NormalizationResult[] {
  const seen = new Set<string>();
  const deduped: NormalizationResult[] = [];

  for (const result of results) {
    if (result.canonicalUrl) {
      if (!seen.has(result.canonicalUrl)) {
        seen.add(result.canonicalUrl);
        deduped.push(result);
      }
    }
  }

  return deduped;
}

// ============================================================================
// Sorting (OR01)
// ============================================================================

/**
 * Sort links alphabetically by canonical URL (OR01).
 */
export function sortLinks(results: NormalizationResult[]): NormalizationResult[] {
  return [...results].sort((a, b) => {
    const urlA = a.canonicalUrl;
    const urlB = b.canonicalUrl;
    
    // Sort null canonical URLs to the end
    if (!urlA && urlB) return 1;
    if (urlA && !urlB) return -1;
    if (!urlA && !urlB) return 0;
    
    // Both have canonical URLs, sort alphabetically (case-sensitive)
    if (urlA! < urlB!) return -1;
    if (urlA! > urlB!) return 1;
    return 0;
  });
}

// ============================================================================
// Main Normalization Function (NL01)
// ============================================================================

/**
 * Normalize all markdown links in a GitHub README.
 * This is the main entry point that implements NL01 algorithm.
 *
 * @param markdown - README markdown content
 * @param context - GitHub repository context
 * @returns Normalization output with sorted, deduped canonical links
 */
export function normalizeGithubReadmeLinks(
  markdown: string,
  context: GitHubRepoContext
): NormalizationOutput {
  // Step 1: Parse links from markdown
  const links = extractMarkdownLinks(markdown);

  // Step 2: Classify and resolve each link
  const results: NormalizationResult[] = [];
  
  for (const link of links) {
    const category = classifyLink(link.target);
    const { url, error, diagnostic } = resolveLink(link.target, category, context);
    
    // Step 3: Check rejection rules
    const { reject, rule: rejectRule, diagnostic: rejectDiagnostic } = shouldReject(
      category,
      link.target,
      url,
      context
    );

    results.push({
      original: link,
      category,
      canonicalUrl: reject ? null : url,
      rejectRule: reject ? rejectRule : "none",
      errorRule: error,
      diagnostic: rejectDiagnostic || diagnostic
    });
  }

  // Step 4: Dedupe (OR02)
  const deduped = dedupeLinks(results);

  // Step 5: Sort (OR01)
  const sorted = sortLinks(deduped);

  // Extract canonical links for easy access
  const canonicalLinks = sorted
    .filter((r) => r.canonicalUrl !== null)
    .map((r) => r.canonicalUrl!);

  // Count rejects and errors (from original results)
  const rejectedCount = results.filter((r) => r.rejectRule !== "none").length;
  const errorCount = results.filter((r) => r.errorRule !== "none").length;

  return {
    results: sorted,  // Return deduped and sorted results
    originalResults: results,  // Original results before deduplication (for stats)
    canonicalLinks,
    rejectedCount,
    errorCount
  };
}

// ============================================================================
// Context Builder Helpers
// ============================================================================

/**
 * Build GitHub repository context from a README URL.
 * Parses owner, repo, branch, and path from a GitHub URL.
 */
export function buildGithubContextFromUrl(
  readmeUrl: string,
  defaultBranch: string = "main"
): GitHubRepoContext | null {
  const url = tryParseUrl(readmeUrl);
  if (!url || url.hostname !== "github.com") {
    return null;
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  
  // Expected format: /{owner}/{repo}/{blob|tree}/{branch}/{path}
  if (pathParts.length < 2) {
    return null;
  }

  const [owner, repo, type, ...rest] = pathParts;

  // If no blob/tree, assume root README
  if (type !== "blob" && type !== "tree") {
    return {
      owner,
      repo,
      defaultBranch,
      currentPath: `${defaultBranch}/README.md`,
      currentUrl: readmeUrl
    };
  }

  // Extract branch
  const branch = rest[0] || defaultBranch;
  const path = rest.slice(1).join("/") || "README.md";

  return {
    owner,
    repo,
    defaultBranch,
    currentPath: `${type}/${branch}/${path}`,
    currentUrl: readmeUrl
  };
}

/**
 * Build GitHub repository context from components.
 */
export function buildGithubContext(
  owner: string,
  repo: string,
  defaultBranch: string,
  currentPath: string,
  currentUrl: string
): GitHubRepoContext {
  return {
    owner,
    repo,
    defaultBranch,
    currentPath,
    currentUrl
  };
}
