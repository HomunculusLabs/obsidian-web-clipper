/**
 * Domain Tag Rules - Maps domain patterns to suggested tags.
 * Part of Task 57 - Domain-based tags.
 */

/**
 * A rule that maps a domain pattern to suggested tags.
 */
export interface DomainTagRule {
  /** Domain pattern (supports wildcards: *.example.com, exact: github.com) */
  domain: string;
  /** Tags to suggest when this domain matches */
  tags: string[];
  /** Whether this rule is enabled */
  enabled: boolean;
}

/**
 * Default domain-to-tag mappings.
 * These are used when no custom rules are configured.
 */
export const DEFAULT_DOMAIN_TAG_RULES: DomainTagRule[] = [
  { domain: "github.com", tags: ["github", "code"], enabled: true },
  { domain: "*.github.com", tags: ["github", "code"], enabled: true },
  { domain: "youtube.com", tags: ["youtube", "video"], enabled: true },
  { domain: "youtu.be", tags: ["youtube", "video"], enabled: true },
  { domain: "*.youtube.com", tags: ["youtube", "video"], enabled: true },
  { domain: "twitter.com", tags: ["twitter"], enabled: true },
  { domain: "x.com", tags: ["twitter"], enabled: true },
  { domain: "*.twitter.com", tags: ["twitter"], enabled: true },
  { domain: "reddit.com", tags: ["reddit"], enabled: true },
  { domain: "*.reddit.com", tags: ["reddit"], enabled: true },
  { domain: "stackoverflow.com", tags: ["stackoverflow", "code"], enabled: true },
  { domain: "*.stackoverflow.com", tags: ["stackoverflow", "code"], enabled: true },
  { domain: "stackexchange.com", tags: ["stackoverflow"], enabled: true },
  { domain: "*.stackexchange.com", tags: ["stackoverflow"], enabled: true },
  { domain: "medium.com", tags: ["medium", "article"], enabled: true },
  { domain: "*.medium.com", tags: ["medium", "article"], enabled: true },
  { domain: "substack.com", tags: ["newsletter", "article"], enabled: true },
  { domain: "*.substack.com", tags: ["newsletter", "article"], enabled: true },
  { domain: "arxiv.org", tags: ["research", "paper"], enabled: true },
  { domain: "*.arxiv.org", tags: ["research", "paper"], enabled: true },
  { domain: "wikipedia.org", tags: ["wikipedia", "reference"], enabled: true },
  { domain: "*.wikipedia.org", tags: ["wikipedia", "reference"], enabled: true },
  { domain: "news.ycombinator.com", tags: ["hacker-news", "tech"], enabled: true },
  { domain: "amazon.com", tags: ["amazon", "product"], enabled: true },
  { domain: "*.amazon.com", tags: ["amazon", "product"], enabled: true },
  { domain: "linkedin.com", tags: ["linkedin", "professional"], enabled: true },
  { domain: "*.linkedin.com", tags: ["linkedin", "professional"], enabled: true },
  { domain: "dev.to", tags: ["dev-to", "code", "article"], enabled: true },
  { domain: "*.dev.to", tags: ["dev-to", "code", "article"], enabled: true },
  { domain: "hashnode.com", tags: ["hashnode", "article"], enabled: true },
  { domain: "*.hashnode.com", tags: ["hashnode", "article"], enabled: true },
  { domain: "npmjs.com", tags: ["npm", "package"], enabled: true },
  { domain: "*.npmjs.com", tags: ["npm", "package"], enabled: true },
  { domain: "pypi.org", tags: ["pypi", "python", "package"], enabled: true },
  { domain: "crates.io", tags: ["crates", "rust", "package"], enabled: true },
  { domain: "docs.google.com", tags: ["google-docs", "document"], enabled: true },
  { domain: "notion.so", tags: ["notion"], enabled: true },
  { domain: "*.notion.so", tags: ["notion"], enabled: true },
  { domain: "figma.com", tags: ["figma", "design"], enabled: true },
  { domain: "*.figma.com", tags: ["figma", "design"], enabled: true },
];

/**
 * Checks if a domain matches a pattern.
 * Supports wildcards: *.example.com matches sub.example.com but not example.com
 *
 * @param domain - The actual domain to check (e.g., "www.github.com")
 * @param pattern - The pattern to match against (e.g., "*.github.com" or "github.com")
 * @returns True if the domain matches the pattern
 */
export function domainMatchesPattern(domain: string, pattern: string): boolean {
  // Normalize both: strip www. prefix from domain for matching
  const normalizedDomain = domain.replace(/^www\./, "");
  const normalizedPattern = pattern.replace(/^www\./, "");

  // Exact match
  if (normalizedDomain === normalizedPattern) {
    return true;
  }

  // Wildcard match (*.example.com)
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2); // Remove "*."
    // Domain should end with .suffix (e.g., sub.github.com matches *.github.com)
    return normalizedDomain.endsWith(`.${suffix}`);
  }

  return false;
}

/**
 * Extracts tags for a URL based on domain tag rules.
 *
 * @param url - The URL to extract domain tags for
 * @param rules - The domain tag rules to use (defaults to DEFAULT_DOMAIN_TAG_RULES)
 * @returns Array of tags with confidence scores
 */
export function extractDomainTagsFromRules(
  url: string,
  rules: DomainTagRule[] = DEFAULT_DOMAIN_TAG_RULES
): Array<{ tag: string; confidence: number }> {
  const results: Array<{ tag: string; confidence: number }> = [];

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    // Find all matching rules
    for (const rule of rules) {
      if (!rule.enabled) continue;

      if (domainMatchesPattern(domain, rule.domain)) {
        for (const tag of rule.tags) {
          results.push({
            tag,
            confidence: 0.8, // High confidence for explicit domain rules
          });
        }
      }
    }
  } catch {
    // Invalid URL, skip domain extraction
  }

  return results;
}
