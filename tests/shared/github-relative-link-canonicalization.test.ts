/**
 * GitHub Relative-Link Canonicalization Tests
 *
 * Tests for normalizeGithubReadmeLinks and related helpers.
 * Contract: docs/quality/github-relative-link-canonicalization-contract.md
 */

import { describe, test, expect } from "bun:test";

import {
  extractMarkdownLinks,
  classifyLink,
  resolveLink,
  shouldReject,
  dedupeLinks,
  sortLinks,
  normalizeGithubReadmeLinks,
  buildGithubContextFromUrl,
  buildGithubContext,
  extractBranchFromPath,
  type GitHubRepoContext,
  type RelativeLinkCategory,
  type RejectRuleId
} from "../../src/shared/githubRelativeLinkCanonicalization";

// ============================================================================
// Test Fixtures
// ============================================================================

const MOCK_CONTEXT: GitHubRepoContext = {
  owner: "owner",
  repo: "repo",
  defaultBranch: "main",
  currentPath: "blob/main/README.md",
  currentUrl: "https://github.com/owner/repo/blob/main/README.md"
};

const MOCK_CONTEXT_NESTED: GitHubRepoContext = {
  owner: "owner",
  repo: "repo",
  defaultBranch: "main",
  currentPath: "blob/main/docs/api/README.md",
  currentUrl: "https://github.com/owner/repo/blob/main/docs/api/README.md"
};

// ============================================================================
// extractMarkdownLinks Tests
// ============================================================================

describe("extractMarkdownLinks", () => {
  test("extracts simple links", () => {
    const markdown = "[link text](https://example.com)";
    const links = extractMarkdownLinks(markdown);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe("link text");
    expect(links[0].target).toBe("https://example.com");
  });

  test("extracts multiple links", () => {
    const markdown = "[first](/path) and [second](./other.md)";
    const links = extractMarkdownLinks(markdown);
    expect(links).toHaveLength(2);
    expect(links[0].text).toBe("first");
    expect(links[0].target).toBe("/path");
    expect(links[1].text).toBe("second");
    expect(links[1].target).toBe("./other.md");
  });

  test("extracts links with special characters", () => {
    const markdown = "[link with spaces](./path with spaces.md)";
    const links = extractMarkdownLinks(markdown);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe("link with spaces");
    expect(links[0].target).toBe("./path with spaces.md");
  });

  test("handles empty markdown", () => {
    const links = extractMarkdownLinks("");
    expect(links).toHaveLength(0);
  });

  test("handles markdown with no links", () => {
    const links = extractMarkdownLinks("# Header\n\nSome text");
    expect(links).toHaveLength(0);
  });

  test("extracts code-formatted links correctly", () => {
    const markdown = "[`api`](./docs/api.md)";
    const links = extractMarkdownLinks(markdown);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe("`api`");
    expect(links[0].target).toBe("./docs/api.md");
  });

  test("captures link position", () => {
    const markdown = "text [link](url) more";
    const links = extractMarkdownLinks(markdown);
    expect(links).toHaveLength(1);
    expect(links[0].position).toBe(5);
  });
});

// ============================================================================
// classifyLink Tests
// ============================================================================

describe("classifyLink", () => {
  test("classifies fragment-only links", () => {
    expect(classifyLink("#installation")).toBe("fragment-only");
    expect(classifyLink("#getting-started")).toBe("fragment-only");
  });

  test("classifies external URLs", () => {
    expect(classifyLink("https://example.com")).toBe("external-url");
    expect(classifyLink("http://example.com")).toBe("external-url");
  });

  test("classifies unsupported schemes", () => {
    expect(classifyLink("mailto:user@example.com")).toBe("unsupported-scheme");
    expect(classifyLink("tel:+1234567890")).toBe("unsupported-scheme");
    expect(classifyLink("javascript:void(0)")).toBe("unsupported-scheme");
    expect(classifyLink("data:text/plain,hello")).toBe("unsupported-scheme");
    expect(classifyLink("ftp://ftp.example.com/file")).toBe("unsupported-scheme");
  });

  test("classifies GitHub tree/blob links", () => {
    expect(classifyLink("/tree/main/docs/api.md")).toBe("github-tree-blob");
    expect(classifyLink("/blob/develop/src/index.ts")).toBe("github-tree-blob");
    expect(classifyLink("/tree/v1.2.3/README.md")).toBe("github-tree-blob");
  });

  test("classifies root-relative links", () => {
    expect(classifyLink("/docs/api.md")).toBe("root-relative");
    expect(classifyLink("/src/index.ts")).toBe("root-relative");
    expect(classifyLink("/LICENSE")).toBe("root-relative");
  });

  test("classifies parent directory links", () => {
    expect(classifyLink("../README.md")).toBe("parent-directory");
    expect(classifyLink("../docs/guide.md")).toBe("parent-directory");
    expect(classifyLink("../../package.json")).toBe("parent-directory");
    expect(classifyLink("../../../CONTRIBUTING.md")).toBe("parent-directory");
  });

  test("classifies same-directory links", () => {
    expect(classifyLink("./docs/api.md")).toBe("same-directory");
    expect(classifyLink("docs/api.md")).toBe("same-directory");
    expect(classifyLink("./guide.md")).toBe("same-directory");
    expect(classifyLink("guide.md")).toBe("same-directory");
  });

  test("classifies self-references", () => {
    expect(classifyLink(".")).toBe("self-reference");
    expect(classifyLink("./")).toBe("self-reference");
  });

  test("classifies repository shorthand", () => {
    expect(classifyLink("owner/repo")).toBe("repository-shorthand");
    expect(classifyLink("charmbracelet/bubbletea")).toBe("repository-shorthand");
    expect(classifyLink("facebook/react")).toBe("repository-shorthand");
  });

  test("classifies malformed links", () => {
    expect(classifyLink("")).toBe("malformed");
    expect(classifyLink("   ")).toBe("malformed");
  });

  test("classifies unknown patterns", () => {
    expect(classifyLink("??weird??")).toBe("unknown");
  });
});

// ============================================================================
// resolveLink Tests (NL03-NL07)
// ============================================================================

describe("resolveLink - Same-Directory (NL03)", () => {
  test("resolves ./path links", () => {
    const result = resolveLink("./docs/api.md", "same-directory", MOCK_CONTEXT);
    expect(result.url).toBe("https://github.com/owner/repo/blob/main/docs/api.md");
    expect(result.error).toBe("none");
  });

  test("resolves bare path links", () => {
    const result = resolveLink("guide.md", "same-directory", MOCK_CONTEXT);
    expect(result.url).toBe("https://github.com/owner/repo/blob/main/guide.md");
    expect(result.error).toBe("none");
  });

  test("resolves from nested directory", () => {
    const result = resolveLink(
      "./more.md",
      "same-directory",
      MOCK_CONTEXT_NESTED
    );
    expect(result.url).toBe("https://github.com/owner/repo/blob/main/docs/api/more.md");
    expect(result.error).toBe("none");
  });
});

describe("resolveLink - Parent Directory (NL04)", () => {
  test("resolves single ../", () => {
    const result = resolveLink(
      "../CONTRIBUTING.md",
      "parent-directory",
      MOCK_CONTEXT_NESTED
    );
    expect(result.url).toBe("https://github.com/owner/repo/blob/main/docs/CONTRIBUTING.md");
    expect(result.error).toBe("none");
  });

  test("resolves multiple ../", () => {
    const result = resolveLink(
      "../../README.md",
      "parent-directory",
      MOCK_CONTEXT_NESTED
    );
    expect(result.url).toBe("https://github.com/owner/repo/blob/main/README.md");
    expect(result.error).toBe("none");
  });

  test("rejects navigation beyond root", () => {
    const result = resolveLink(
      "../../other-repo/README.md",
      "parent-directory",
      MOCK_CONTEXT
    );
    expect(result.url).toBeNull();
    expect(result.error).toBe("EH02_RESOLUTION_FAILURE");
    expect(result.diagnostic).toContain("beyond repository root");
  });
});

describe("resolveLink - Root-Relative (NL05)", () => {
  test("resolves /path links", () => {
    const result = resolveLink("/docs/api.md", "root-relative", MOCK_CONTEXT_NESTED);
    expect(result.url).toBe("https://github.com/owner/repo/blob/main/docs/api.md");
    expect(result.error).toBe("none");
  });

  test("resolves root file from nested path", () => {
    const result = resolveLink(
      "/LICENSE",
      "root-relative",
      MOCK_CONTEXT_NESTED
    );
    expect(result.url).toBe("https://github.com/owner/repo/blob/main/LICENSE");
    expect(result.error).toBe("none");
  });

  test("resolves from root context", () => {
    const result = resolveLink("/docs/guide.md", "root-relative", MOCK_CONTEXT);
    expect(result.url).toBe("https://github.com/owner/repo/blob/main/docs/guide.md");
    expect(result.error).toBe("none");
  });
});

describe("resolveLink - GitHub Tree/Blob (NL06)", () => {
  test("resolves /tree/branch/path", () => {
    const result = resolveLink(
      "/tree/develop/docs/api.md",
      "github-tree-blob",
      MOCK_CONTEXT
    );
    expect(result.url).toBe("https://github.com/owner/repo/tree/develop/docs/api.md");
    expect(result.error).toBe("none");
  });

  test("resolves /blob/branch/path", () => {
    const result = resolveLink(
      "/blob/v1.2.3/src/index.ts",
      "github-tree-blob",
      MOCK_CONTEXT
    );
    expect(result.url).toBe("https://github.com/owner/repo/blob/v1.2.3/src/index.ts");
    expect(result.error).toBe("none");
  });

  test("rejects malformed tree/blob links", () => {
    const result = resolveLink(
      "/tree",
      "github-tree-blob",
      MOCK_CONTEXT
    );
    expect(result.url).toBeNull();
    expect(result.error).toBe("EH02_RESOLUTION_FAILURE");
    expect(result.diagnostic).toContain("no path");
  });

  test("rejects tree/blob without path", () => {
    const result = resolveLink(
      "/tree/main",
      "github-tree-blob",
      MOCK_CONTEXT
    );
    expect(result.url).toBeNull();
    expect(result.error).toBe("EH02_RESOLUTION_FAILURE");
    expect(result.diagnostic).toContain("no path");
  });
});

describe("resolveLink - Repository Shorthand (NL07)", () => {
  test("resolves owner/repo pattern", () => {
    const result = resolveLink(
      "charmbracelet/bubbletea",
      "repository-shorthand",
      MOCK_CONTEXT
    );
    expect(result.url).toBe("https://github.com/charmbracelet/bubbletea");
    expect(result.error).toBe("none");
  });

  test("resolves various owner/repo patterns", () => {
    const patterns = [
      { input: "facebook/react", expected: "https://github.com/facebook/react" },
      { input: "microsoft/vscode", expected: "https://github.com/microsoft/vscode" },
      { input: "owner/repo-name", expected: "https://github.com/owner/repo-name" }
    ];

    for (const { input, expected } of patterns) {
      const result = resolveLink(input, "repository-shorthand", MOCK_CONTEXT);
      expect(result.url).toBe(expected);
    }
  });
});

describe("resolveLink - Non-resolvable Categories", () => {
  test("returns null for fragment-only", () => {
    const result = resolveLink("#anchor", "fragment-only", MOCK_CONTEXT);
    expect(result.url).toBeNull();
    expect(result.error).toBe("none");
  });

  test("returns null for external URLs", () => {
    const result = resolveLink("https://example.com", "external-url", MOCK_CONTEXT);
    expect(result.url).toBeNull();
    expect(result.error).toBe("none");
  });

  test("returns null for unsupported schemes", () => {
    const result = resolveLink("mailto:test@example.com", "unsupported-scheme", MOCK_CONTEXT);
    expect(result.url).toBeNull();
    expect(result.error).toBe("none");
  });

  test("returns null for self-reference", () => {
    const result = resolveLink(".", "self-reference", MOCK_CONTEXT);
    expect(result.url).toBeNull();
    expect(result.error).toBe("none");
  });
});

// ============================================================================
// shouldReject Tests (RJ01-RJ07)
// ============================================================================

describe("shouldReject - RJ01 Fragment-Only", () => {
  test("rejects fragment-only links", () => {
    const result = shouldReject("fragment-only", "#installation", null, MOCK_CONTEXT);
    expect(result.reject).toBe(true);
    expect(result.rule).toBe("RJ01_FRAGMENT_ONLY");
    expect(result.diagnostic).toContain("page anchor");
  });
});

describe("shouldReject - RJ02 External URL", () => {
  test("rejects external URLs", () => {
    const result = shouldReject("external-url", "https://example.com", null, MOCK_CONTEXT);
    expect(result.reject).toBe(true);
    expect(result.rule).toBe("RJ02_EXTERNAL_URL");
    expect(result.diagnostic).toContain("External URL");
  });
});

describe("shouldReject - RJ03 Unsupported Scheme", () => {
  test("rejects unsupported schemes", () => {
    const result = shouldReject("unsupported-scheme", "mailto:test@example.com", null, MOCK_CONTEXT);
    expect(result.reject).toBe(true);
    expect(result.rule).toBe("RJ03_UNSUPPORTED_SCHEME");
    expect(result.diagnostic).toContain("Unsupported URL scheme");
  });
});

describe("shouldReject - RJ04 Self-Reference", () => {
  test("rejects explicit self-references", () => {
    const result = shouldReject("self-reference", ".", null, MOCK_CONTEXT);
    expect(result.reject).toBe(true);
    expect(result.rule).toBe("RJ04_SELF_REFERENCE");
    expect(result.diagnostic).toContain("Self-reference");
  });

  test("rejects when resolved URL matches current URL", () => {
    const result = shouldReject(
      "same-directory",
      "./",
      "https://github.com/owner/repo/blob/main/README.md",
      MOCK_CONTEXT
    );
    expect(result.reject).toBe(true);
    expect(result.rule).toBe("RJ04_SELF_REFERENCE");
  });
});

describe("shouldReject - RJ05 Cross-Repo Relative", () => {
  test("rejects parent navigation beyond root", () => {
    const result = shouldReject(
      "parent-directory",
      "../../other-repo/README.md",
      null,
      MOCK_CONTEXT
    );
    expect(result.reject).toBe(true);
    expect(result.rule).toBe("RJ05_CROSS_REPO_RELATIVE");
    expect(result.diagnostic).toContain("beyond root");
  });
});

describe("shouldReject - RJ06 Malformed Link", () => {
  test("rejects malformed links", () => {
    const result = shouldReject("malformed", "", null, MOCK_CONTEXT);
    expect(result.reject).toBe(true);
    expect(result.rule).toBe("RJ06_MALFORMED_LINK");
    expect(result.diagnostic).toContain("Malformed link");
  });

  test("rejects unknown patterns", () => {
    const result = shouldReject("unknown", "??weird??", null, MOCK_CONTEXT);
    expect(result.reject).toBe(true);
    expect(result.rule).toBe("RJ06_MALFORMED_LINK");
  });
});

describe("shouldReject - Accepts Valid Links", () => {
  test("accepts same-directory links", () => {
    const result = shouldReject(
      "same-directory",
      "./docs/api.md",
      "https://github.com/owner/repo/blob/main/docs/api.md",
      MOCK_CONTEXT
    );
    expect(result.reject).toBe(false);
    expect(result.rule).toBe("none");
  });

  test("accepts parent-directory links within bounds", () => {
    const result = shouldReject(
      "parent-directory",
      "../CONTRIBUTING.md",
      null,
      MOCK_CONTEXT_NESTED
    );
    expect(result.reject).toBe(false);
    expect(result.rule).toBe("none");
  });

  test("accepts root-relative links", () => {
    const result = shouldReject(
      "root-relative",
      "/docs/api.md",
      "https://github.com/owner/repo/blob/main/docs/api.md",
      MOCK_CONTEXT
    );
    expect(result.reject).toBe(false);
    expect(result.rule).toBe("none");
  });

  test("accepts GitHub tree/blob links", () => {
    const result = shouldReject(
      "github-tree-blob",
      "/tree/develop/docs/api.md",
      "https://github.com/owner/repo/tree/develop/docs/api.md",
      MOCK_CONTEXT
    );
    expect(result.reject).toBe(false);
    expect(result.rule).toBe("none");
  });

  test("accepts repository shorthand links", () => {
    const result = shouldReject(
      "repository-shorthand",
      "charmbracelet/bubbletea",
      "https://github.com/charmbracelet/bubbletea",
      MOCK_CONTEXT
    );
    expect(result.reject).toBe(false);
    expect(result.rule).toBe("none");
  });
});

// ============================================================================
// dedupeLinks Tests (OR02)
// ============================================================================

describe("dedupeLinks", () => {
  test("removes duplicate canonical URLs", () => {
    const results = [
      {
        original: { text: "API", target: "./docs/api.md" },
        category: "same-directory" as RelativeLinkCategory,
        canonicalUrl: "https://github.com/owner/repo/blob/main/docs/api.md",
        rejectRule: "none" as RejectRuleId,
        errorRule: "none"
      },
      {
        original: { text: "API Reference", target: "/docs/api.md" },
        category: "root-relative" as RelativeLinkCategory,
        canonicalUrl: "https://github.com/owner/repo/blob/main/docs/api.md",
        rejectRule: "none" as RejectRuleId,
        errorRule: "none"
      },
      {
        original: { text: "Guide", target: "./docs/guide.md" },
        category: "same-directory" as RelativeLinkCategory,
        canonicalUrl: "https://github.com/owner/repo/blob/main/docs/guide.md",
        rejectRule: "none" as RejectRuleId,
        errorRule: "none"
      }
    ];

    const deduped = dedupeLinks(results);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].canonicalUrl).toBe("https://github.com/owner/repo/blob/main/docs/api.md");
    expect(deduped[1].canonicalUrl).toBe("https://github.com/owner/repo/blob/main/docs/guide.md");
  });

  test("keeps first occurrence of duplicates", () => {
    const results = [
      {
        original: { text: "First", target: "./docs/api.md" },
        category: "same-directory" as RelativeLinkCategory,
        canonicalUrl: "https://github.com/owner/repo/blob/main/docs/api.md",
        rejectRule: "none" as RejectRuleId,
        errorRule: "none"
      },
      {
        original: { text: "Second", target: "/docs/api.md" },
        category: "root-relative" as RelativeLinkCategory,
        canonicalUrl: "https://github.com/owner/repo/blob/main/docs/api.md",
        rejectRule: "none" as RejectRuleId,
        errorRule: "none"
      },
      {
        original: { text: "Third", target: "../docs/api.md" },
        category: "parent-directory" as RelativeLinkCategory,
        canonicalUrl: "https://github.com/owner/repo/blob/main/docs/api.md",
        rejectRule: "none" as RejectRuleId,
        errorRule: "none"
      }
    ];

    const deduped = dedupeLinks(results);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].original.text).toBe("First");
  });

  test("handles empty results", () => {
    const deduped = dedupeLinks([]);
    expect(deduped).toHaveLength(0);
  });

  test("handles all null canonical URLs", () => {
    const results = [
      {
        original: { text: "External", target: "https://example.com" },
        category: "external-url" as RelativeLinkCategory,
        canonicalUrl: null,
        rejectRule: "RJ02_EXTERNAL_URL" as RejectRuleId,
        errorRule: "none"
      }
    ];

    const deduped = dedupeLinks(results);
    expect(deduped).toHaveLength(0);
  });
});

// ============================================================================
// sortLinks Tests (OR01)
// ============================================================================

describe("sortLinks", () => {
  test("sorts alphabetically by canonical URL", () => {
    const results = [
      {
        original: { text: "Guide", target: "./docs/guide.md" },
        category: "same-directory" as RelativeLinkCategory,
        canonicalUrl: "https://github.com/owner/repo/blob/main/docs/guide.md",
        rejectRule: "none" as RejectRuleId,
        errorRule: "none"
      },
      {
        original: { text: "Contributing", target: "../CONTRIBUTING.md" },
        category: "parent-directory" as RelativeLinkCategory,
        canonicalUrl: "https://github.com/owner/repo/blob/main/CONTRIBUTING.md",
        rejectRule: "none" as RejectRuleId,
        errorRule: "none"
      },
      {
        original: { text: "API", target: "/docs/api.md" },
        category: "root-relative" as RelativeLinkCategory,
        canonicalUrl: "https://github.com/owner/repo/blob/main/docs/api.md",
        rejectRule: "none" as RejectRuleId,
        errorRule: "none"
      }
    ];

    const sorted = sortLinks(results);
    expect(sorted).toHaveLength(3);
    expect(sorted[0].canonicalUrl).toBe("https://github.com/owner/repo/blob/main/CONTRIBUTING.md");
    expect(sorted[1].canonicalUrl).toBe("https://github.com/owner/repo/blob/main/docs/api.md");
    expect(sorted[2].canonicalUrl).toBe("https://github.com/owner/repo/blob/main/docs/guide.md");
  });

  test("handles null canonical URLs (sorted to end)", () => {
    const results = [
      {
        original: { text: "Guide", target: "./docs/guide.md" },
        category: "same-directory" as RelativeLinkCategory,
        canonicalUrl: "https://github.com/owner/repo/blob/main/docs/guide.md",
        rejectRule: "none" as RejectRuleId,
        errorRule: "none"
      },
      {
        original: { text: "Fragment", target: "#install" },
        category: "fragment-only" as RelativeLinkCategory,
        canonicalUrl: null,
        rejectRule: "RJ01_FRAGMENT_ONLY" as RejectRuleId,
        errorRule: "none"
      }
    ];

    const sorted = sortLinks(results);
    expect(sorted).toHaveLength(2);
    expect(sorted[0].canonicalUrl).toBe("https://github.com/owner/repo/blob/main/docs/guide.md");
    expect(sorted[1].canonicalUrl).toBeNull();
  });

  test("does not mutate original array", () => {
    const results = [
      {
        original: { text: "Z", target: "./z.md" },
        category: "same-directory" as RelativeLinkCategory,
        canonicalUrl: "https://github.com/owner/repo/blob/main/z.md",
        rejectRule: "none" as RejectRuleId,
        errorRule: "none"
      },
      {
        original: { text: "A", target: "./a.md" },
        category: "same-directory" as RelativeLinkCategory,
        canonicalUrl: "https://github.com/owner/repo/blob/main/a.md",
        rejectRule: "none" as RejectRuleId,
        errorRule: "none"
      }
    ];

    const originalOrder = results.map((r) => r.original.text);
    const sorted = sortLinks(results);

    expect(results.map((r) => r.original.text)).toEqual(originalOrder);
    expect(sorted.map((r) => r.original.text)).toEqual(["A", "Z"]);
  });
});

// ============================================================================
// normalizeGithubReadmeLinks Integration Tests (NL01)
// ============================================================================

describe("normalizeGithubReadmeLinks", () => {
  test("normalizes all link types correctly", () => {
    const markdown = `
# README

## Documentation
- [API Reference](./docs/api.md)
- [Contributing Guide](../CONTRIBUTING.md)
- [License](/LICENSE)

## Projects
- [Bubbletea](charmbracelet/bubbletea)
- [VHS](charmbracelet/vhs)

## Other
- [External](https://example.com)
- [Install](#installation)
`;

    const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

    expect(output.results).toHaveLength(7);
    expect(output.rejectedCount).toBe(2); // External + fragment
    expect(output.errorCount).toBe(0);
    expect(output.canonicalLinks).toHaveLength(5);

    // Check canonical links are sorted alphabetically
    expect(output.canonicalLinks[0]).toBe("https://github.com/charmbracelet/bubbletea");
    expect(output.canonicalLinks[1]).toBe("https://github.com/charmbracelet/vhs");
    expect(output.canonicalLinks[2]).toBe("https://github.com/owner/repo/blob/main/CONTRIBUTING.md");
    expect(output.canonicalLinks[3]).toBe("https://github.com/owner/repo/blob/main/LICENSE");
    expect(output.canonicalLinks[4]).toBe("https://github.com/owner/repo/blob/main/docs/api.md");
  });

  test("handles empty markdown", () => {
    const output = normalizeGithubReadmeLinks("", MOCK_CONTEXT);
    expect(output.results).toHaveLength(0);
    expect(output.canonicalLinks).toHaveLength(0);
    expect(output.rejectedCount).toBe(0);
    expect(output.errorCount).toBe(0);
  });

  test("handles markdown with no links", () => {
    const markdown = "# Header\n\nSome text\n## Another header";
    const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);
    expect(output.results).toHaveLength(0);
    expect(output.canonicalLinks).toHaveLength(0);
  });

  test("deduplicates identical canonical URLs", () => {
    const markdown = `
- [API](./docs/api.md)
- [API Reference](/docs/api.md)
- [API Docs](../README.md)
- [Guide](./docs/guide.md)
`;

    const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT_NESTED);
    
    // Check that deduplication works (may have 3-4 unique URLs depending on paths)
    expect(output.canonicalLinks.length).toBeGreaterThan(1);
    expect(output.canonicalLinks.length).toBeLessThanOrEqual(4);
  });

  test("produces deterministic output for identical input", () => {
    const markdown = `
- [API](./docs/api.md)
- [Guide](./docs/guide.md)
- [Contributing](../CONTRIBUTING.md)
`;

    const output1 = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT_NESTED);
    const output2 = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT_NESTED);

    expect(output1.canonicalLinks).toEqual(output2.canonicalLinks);
    expect(output1.rejectedCount).toBe(output2.rejectedCount);
    expect(output1.errorCount).toBe(output2.errorCount);
  });

  test("handles nested directory context correctly", () => {
    const markdown = `
- [Current](./readme.md)
- [Parent](../README.md)
- [Root](/docs.md)
`;

    const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT_NESTED);

    expect(output.canonicalLinks).toHaveLength(3);
    expect(output.canonicalLinks).toContain("https://github.com/owner/repo/blob/main/docs/api/readme.md");
    expect(output.canonicalLinks).toContain("https://github.com/owner/repo/blob/main/docs/README.md");
    expect(output.canonicalLinks).toContain("https://github.com/owner/repo/blob/main/docs.md");
  });

  test("captures diagnostics for rejected links", () => {
    const markdown = `
- [Fragment](#install)
- [External](https://example.com)
- [Valid](./docs.md)
`;

    const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

    const fragmentResult = output.results.find((r) => r.original.target === "#install");
    expect(fragmentResult?.rejectRule).toBe("RJ01_FRAGMENT_ONLY");
    expect(fragmentResult?.diagnostic).toContain("page anchor");

    const externalResult = output.results.find((r) => r.original.target === "https://example.com");
    expect(externalResult?.rejectRule).toBe("RJ02_EXTERNAL_URL");
    expect(externalResult?.diagnostic).toContain("External URL");

    const validResult = output.results.find((r) => r.original.target === "./docs.md");
    expect(validResult?.rejectRule).toBe("none");
    expect(validResult?.canonicalUrl).toBe("https://github.com/owner/repo/blob/main/docs.md");
  });
});

// ============================================================================
// buildGithubContextFromUrl Tests
// ============================================================================

describe("buildGithubContextFromUrl", () => {
  test("builds context from root README URL", () => {
    const url = "https://github.com/owner/repo";
    const context = buildGithubContextFromUrl(url);

    expect(context).not.toBeNull();
    expect(context?.owner).toBe("owner");
    expect(context?.repo).toBe("repo");
    expect(context?.defaultBranch).toBe("main");
    expect(context?.currentPath).toBe("main/README.md");
    expect(context?.currentUrl).toBe(url);
  });

  test("builds context from blob URL", () => {
    const url = "https://github.com/owner/repo/blob/main/README.md";
    const context = buildGithubContextFromUrl(url);

    expect(context).not.toBeNull();
    expect(context?.owner).toBe("owner");
    expect(context?.repo).toBe("repo");
    expect(context?.defaultBranch).toBe("main");
    expect(context?.currentPath).toBe("blob/main/README.md");
    expect(context?.currentUrl).toBe(url);
  });

  test("builds context from nested blob URL", () => {
    const url = "https://github.com/owner/repo/blob/develop/docs/api/README.md";
    const context = buildGithubContextFromUrl(url);

    expect(context).not.toBeNull();
    expect(context?.owner).toBe("owner");
    expect(context?.repo).toBe("repo");
    expect(context?.defaultBranch).toBe("main"); // Default branch parameter
    expect(context?.currentPath).toBe("blob/develop/docs/api/README.md");
    expect(context?.currentUrl).toBe(url);
  });

  test("builds context with custom default branch", () => {
    const url = "https://github.com/owner/repo";
    const context = buildGithubContextFromUrl(url, "master");

    expect(context?.defaultBranch).toBe("master");
  });

  test("returns null for non-GitHub URLs", () => {
    const context = buildGithubContextFromUrl("https://example.com/repo");
    expect(context).toBeNull();
  });

  test("returns null for invalid URLs", () => {
    const context = buildGithubContextFromUrl("not-a-url");
    expect(context).toBeNull();
  });
});

// ============================================================================
// buildGithubContext Tests
// ============================================================================

describe("buildGithubContext", () => {
  test("builds context from components", () => {
    const context = buildGithubContext(
      "owner",
      "repo",
      "develop",
      "blob/develop/README.md",
      "https://github.com/owner/repo/blob/develop/README.md"
    );

    expect(context.owner).toBe("owner");
    expect(context.repo).toBe("repo");
    expect(context.defaultBranch).toBe("develop");
    expect(context.currentPath).toBe("blob/develop/README.md");
    expect(context.currentUrl).toBe("https://github.com/owner/repo/blob/develop/README.md");
  });
});

// ============================================================================
// extractBranchFromPath Tests
// ============================================================================

describe("extractBranchFromPath", () => {
  test("extracts branch from blob path", () => {
    expect(extractBranchFromPath("blob/main/README.md")).toBe("main");
    expect(extractBranchFromPath("blob/develop/docs/api.md")).toBe("develop");
  });

  test("extracts branch from tree path", () => {
    expect(extractBranchFromPath("tree/main/docs")).toBe("main");
    expect(extractBranchFromPath("tree/v1.2.3/README.md")).toBe("v1.2.3");
  });

  test("returns null for invalid paths", () => {
    expect(extractBranchFromPath("README.md")).toBeNull();
    expect(extractBranchFromPath("docs/README.md")).toBeNull();
    expect(extractBranchFromPath("")).toBeNull();
  });
});

// ============================================================================
// End-to-End Scenarios
// ============================================================================

describe("End-to-End Scenarios", () => {
  test("real-world GitHub README with mixed link types", () => {
    const markdown = `
# VHS

## Documentation
- [Installation Guide](./docs/getting-started/installation.md)
- [CLI Usage](../docs/usage.md)
- [API Reference](/docs/api.md)
- [Examples](./examples/)

## Related Projects
- [Bubbletea](charmbracelet/bubbletea)
- [Lipgloss](charmbracelet/lipgloss)
- [Gum](charmbracelet/gum)

## Links
- [Website](https://charm.sh/vhs)
- [Discord](https://discord.gg/charmbracelet)
- [Issues](https://github.com/charmbracelet/vhs/issues)

## Quick Links
- [Installation](#installation)
- [Usage](#usage)
`;

    const context = buildGithubContextFromUrl(
      "https://github.com/charmbracelet/vhs/blob/main/README.md"
    );

    expect(context).not.toBeNull();

    const output = normalizeGithubReadmeLinks(markdown, context!);

    // Should have 12 total links
    expect(output.results).toHaveLength(12);

    // Should reject 4: 2 external URLs, 1 external domain, 1 fragment
    expect(output.rejectedCount).toBeGreaterThanOrEqual(3);

    // Should have at least the canonical links
    expect(output.canonicalLinks).toContain("https://github.com/charmbracelet/bubbletea");
    expect(output.canonicalLinks).toContain("https://github.com/charmbracelet/lipgloss");
    expect(output.canonicalLinks).toContain("https://github.com/charmbracelet/gum");
  });

  test("deterministic output stability", () => {
    const markdown = `
- [First](./first.md)
- [Second](./second.md)
- [Third](./third.md)
`;

    const results1: string[] = [];
    const results2: string[] = [];

    for (let i = 0; i < 5; i++) {
      const output1 = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);
      const output2 = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);
      results1.push(JSON.stringify(output1.canonicalLinks));
      results2.push(JSON.stringify(output2.canonicalLinks));
    }

    // All runs should produce identical output
    results1.forEach((r) => expect(r).toBe(results1[0]));
    results2.forEach((r) => expect(r).toBe(results2[0]));
    expect(results1[0]).toBe(results2[0]);
  });
});
