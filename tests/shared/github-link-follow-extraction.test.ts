/**
 * GitHub Link-Follow Extraction Tests (TP003)
 *
 * Tests for integrating canonicalization into README link-follow extraction
 * before depth-1 filtering and dedupe passes.
 */

import { describe, test, expect } from "bun:test";
import {
  extractGitHubLinkFollow,
  extractContextSection,
  type GitHubLinkFollowResult,
  type GitHubLinkFollowChild
} from "../../src/shared/githubLinkFollowExtraction";

// ============================================================================
// Fixtures
// ============================================================================

const VHS_README_MARKDOWN = `# VHS

Your CLI home video recorder.

## Installation

\`\`\`sh
go install github.com/charmbracelet/vhs@latest
\`\`\`

## Usage

Create a .tape file.

## Related Projects

VHS is part of the Charmbracelet ecosystem. Check out these related projects:

- [charmbracelet/lipgloss](https://github.com/charmbracelet/lipgloss) - Style definitions for nice terminal layouts
- [charmbracelet/bubbletea](https://github.com/charmbracelet/bubbletea) - A powerful little TUI framework
- [charmbracelet/gum](https://github.com/charmbracelet/gum) - Gum: A tool for glamorous shell scripts

## Contributing

Contributions are welcome!
`;

const VHS_RELATIVE_LINKS_README = `# VHS

## Documentation

- [API Guide](./docs/api.md)
- [User Manual](../README.md)
- [Contributing](/CONTRIBUTING.md)

## Source Code

- [Main branch](https://github.com/charmbracelet/vhs/tree/main)
- [Develop branch](https://github.com/charmbracelet/vhs/tree/develop)

## Related

- [bubbletea](../bubbletea)
`;

const LIPGLOSS_README_MARKDOWN = `# Lip Gloss

Style definitions for nice terminal layouts.

## Related Projects

Check out these related projects:

- [charmbracelet/bubbletea](https://github.com/charmbracelet/bubbletea)
- [charmbracelet/vhs](https://github.com/charmbracelet/vhs)
- [charmbracelet/gum](https://github.com/charmbracelet/gum)
`;

const CRUSH_README_MARKDOWN = `# Crush

## Related Projects

Related projects in the Charmbracelet ecosystem:

- [charmbracelet/bubbletea](https://github.com/charmbracelet/bubbletea)
- [charmbracelet/lipgloss](https://github.com/charmbracelet/lipgloss)
- [charmbracelet/vhs](https://github.com/charmbracelet/vhs)
`;

// ============================================================================
// Basic Extraction Tests
// ============================================================================

describe("extractGitHubLinkFollow - basic functionality", () => {
  test("extracts children from VHS README with absolute GitHub URLs", () => {
    const result = extractGitHubLinkFollow({
      markdown: VHS_README_MARKDOWN,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    expect(result.parent.owner).toBe("charmbracelet");
    expect(result.parent.repo).toBe("vhs");
    expect(result.parent.url).toBe("https://github.com/charmbracelet/vhs");
    expect(result.parent.filename).toBe("vhs");

    expect(result.link_follow.enabled).toBe(true);
    expect(result.link_follow.depth_limit).toBe(1);
    expect(result.link_follow.dedupe_strategy).toBe("url_deduplication");
    expect(result.link_follow.ordering).toBe("alphabetical_by_url");

    expect(result.children.length).toBe(3);

    // Verify children are in alphabetical order
    expect(result.children[0].repo).toBe("bubbletea");
    expect(result.children[1].repo).toBe("gum");
    expect(result.children[2].repo).toBe("lipgloss");

    // Verify each child
    result.children.forEach(child => {
      expect(child.owner).toBe("charmbracelet");
      expect(child.discovery_source).toBe("readme_link");
      expect(child.depth).toBe(1);
      expect(child.filename).toMatch(/^vhs-/);
      expect(child.url).toMatch(/^https:\/\/github\.com\/charmbracelet\/\w+$/);
    });
  });

  test("extracts children from LipGloss README", () => {
    const result = extractGitHubLinkFollow({
      markdown: LIPGLOSS_README_MARKDOWN,
      readmeUrl: "https://github.com/charmbracelet/lipgloss",
      parentFilename: "lipgloss"
    });

    expect(result.parent.repo).toBe("lipgloss");
    expect(result.children.length).toBe(3);

    const repos = result.children.map(c => c.repo);
    expect(repos).toContain("bubbletea");
    expect(repos).toContain("vhs");
    expect(repos).toContain("gum");
  });

  test("extracts children from Crush README", () => {
    const result = extractGitHubLinkFollow({
      markdown: CRUSH_README_MARKDOWN,
      readmeUrl: "https://github.com/charmbracelet/crush",
      parentFilename: "crush"
    });

    expect(result.parent.repo).toBe("crush");
    expect(result.children.length).toBe(3);

    const repos = result.children.map(c => c.repo);
    expect(repos).toContain("bubbletea");
    expect(repos).toContain("lipgloss");
    expect(repos).toContain("vhs");
  });
});

// ============================================================================
// Canonicalization Integration Tests (TP003)
// ============================================================================

describe("extractGitHubLinkFollow - canonicalization integration", () => {
  test("canonicalizes relative links before depth-1 filtering", () => {
    const result = extractGitHubLinkFollow({
      markdown: VHS_RELATIVE_LINKS_README,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    // Relative links should be canonicalized
    // But they point to non-repo-root URLs, so they should be excluded
    expect(result.discovered_links.total).toBeGreaterThan(0);
    expect(result.children.length).toBe(1); // Only ../bubbletea resolves to repo root

    // The repository shorthand ../bubbletea should resolve
    const bubbleteaChild = result.children.find(c => c.repo === "bubbletea");
    expect(bubbleteaChild).toBeDefined();
    expect(bubbleteaChild?.url).toBe("https://github.com/charmbracelet/bubbletea");
  });

  test("handles repository shorthand links", () => {
    const markdown = `# Test\n\n- [bubbletea](../bubbletea)`;
    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    expect(result.children.length).toBe(1);
    expect(result.children[0].repo).toBe("bubbletea");
    expect(result.children[0].url).toBe("https://github.com/charmbracelet/bubbletea");
  });

  test("handles same-directory relative links", () => {
    const markdown = `# Test\n\n- [docs](./docs)`;
    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    // ./docs should canonicalize to https://github.com/charmbracelet/vhs/blob/main/docs
    // which is NOT a repo root URL, so it should be excluded from depth-1 children
    expect(result.children.length).toBe(0);
    expect(result.discovered_links.after_exclusions).toBe(0);
  });

  test("handles root-relative links", () => {
    const markdown = `# Test\n\n- [Contributing](/CONTRIBUTING.md)`;
    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    // /CONTRIBUTING.md should canonicalize to repo root with path
    // which is NOT a repo root URL, so it should be excluded
    expect(result.children.length).toBe(0);
  });

  test("handles GitHub tree/blob links", () => {
    const markdown = `# Test\n\n- [Source](https://github.com/charmbracelet/vhs/tree/main/src)`;
    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    // /tree/main/src is NOT a repo root URL, should be excluded
    expect(result.children.length).toBe(0);
  });
});

// ============================================================================
// Depth-1 Filtering Tests
// ============================================================================

describe("extractGitHubLinkFollow - depth-1 filtering", () => {
  test("only includes repo root URLs (no path)", () => {
    const markdown = `# Test\n\n` +
      `- [Root](https://github.com/owner/repo)\n` +
      `- [Tree path](https://github.com/owner/repo/tree/main)\n` +
      `- [Blob path](https://github.com/owner/repo/blob/main/file.md)\n` +
      `- [Issues](https://github.com/owner/repo/issues)\n`;

    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/test/test",
      parentFilename: "test"
    });

    // Only the root URL should be included
    expect(result.children.length).toBe(1);
    expect(result.children[0].url).toBe("https://github.com/owner/repo");
  });

  test("filters out non-GitHub URLs", () => {
    const markdown = `# Test\n\n` +
      `- [GitHub](https://github.com/owner/repo)\n` +
      `- [Example](https://example.com)\n` +
      `- [Docs](https://docs.example.com)\n`;

    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/test/test",
      parentFilename: "test"
    });

    // Only GitHub URLs should be included
    expect(result.children.length).toBe(1);
    expect(result.children[0].url).toBe("https://github.com/owner/repo");
  });

  test("filters out self-references", () => {
    const markdown = `# Test\n\n` +
      `- [This repo](https://github.com/charmbracelet/vhs)\n` +
      `- [Other repo](https://github.com/charmbracelet/other)\n`;

    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    // Self-reference should be excluded
    expect(result.children.length).toBe(1);
    expect(result.children[0].repo).toBe("other");
  });

  test("enforces depth_limit=1", () => {
    const markdown = VHS_README_MARKDOWN;
    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    expect(result.link_follow.depth_limit).toBe(1);

    // All children should have depth exactly 1
    result.children.forEach(child => {
      expect(child.depth).toBe(1);
    });

    // No child should have additional path
    result.children.forEach(child => {
      expect(child.url).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
    });
  });
});

// ============================================================================
// Deduplication Tests
// ============================================================================

describe("extractGitHubLinkFollow - deduplication", () => {
  test("removes duplicate URLs", () => {
    const markdown = `# Test\n\n` +
      `- [Repo 1](https://github.com/owner/repo)\n` +
      `- [Repo 2](https://github.com/owner/repo)\n` +
      `- [Repo 3](https://github.com/owner/repo)\n`;

    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/test/test",
      parentFilename: "test"
    });

    // Only one child should be returned (deduped)
    expect(result.children.length).toBe(1);
    expect(result.discovered_links.after_dedupe).toBe(1);
  });

  test("dedupe_stats are accurate", () => {
    const markdown = `# Test\n\n` +
      `- [Unique 1](https://github.com/owner/repo1)\n` +
      `- [Duplicate](https://github.com/owner/repo2)\n` +
      `- [Duplicate](https://github.com/owner/repo2)\n` +
      `- [Unique 2](https://github.com/owner/repo3)\n` +
      `- [Fragment](#section)\n` +
      `- [External](https://example.com)\n`;

    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/test/test",
      parentFilename: "test"
    });

    // Stats should reflect the flow
    expect(result.discovered_links.total).toBeGreaterThan(0);
    expect(result.discovered_links.unique).toBeGreaterThan(0);
    expect(result.discovered_links.after_dedupe).toBe(3); // 3 unique repo roots
    expect(result.discovered_links.after_exclusions).toBe(3);
  });
});

// ============================================================================
// Alphabetical Ordering Tests
// ============================================================================

describe("extractGitHubLinkFollow - alphabetical ordering", () => {
  test("sorts children alphabetically by URL", () => {
    const markdown = `# Test\n\n` +
      `- [VHS](https://github.com/charmbracelet/vhs)\n` +
      `- [Bubbletea](https://github.com/charmbracelet/bubbletea)\n` +
      `- [LipGloss](https://github.com/charmbracelet/lipgloss)\n` +
      `- [Gum](https://github.com/charmbracelet/gum)\n`;

    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/test/test",
      parentFilename: "test"
    });

    expect(result.link_follow.ordering).toBe("alphabetical_by_url");

    const urls = result.children.map(c => c.url);
    const sortedUrls = [...urls].sort();

    expect(urls).toEqual(sortedUrls);
  });

  test("VHS children are in alphabetical order", () => {
    const result = extractGitHubLinkFollow({
      markdown: VHS_README_MARKDOWN,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    const urls = result.children.map(c => c.url);
    const sortedUrls = [...urls].sort();

    expect(urls).toEqual(sortedUrls);
  });
});

// ============================================================================
// Filename Derivation Tests
// ============================================================================

describe("extractGitHubLinkFollow - filename derivation", () => {
  test("derives sibling note filenames as parent-child", () => {
    const result = extractGitHubLinkFollow({
      markdown: VHS_README_MARKDOWN,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    result.children.forEach(child => {
      expect(child.filename).toMatch(/^vhs-/);
      expect(child.filename).toContain(`-${child.repo}`);
    });
  });

  test("vhs-bubbletea, vhs-gum, vhs-lipgloss for VHS", () => {
    const result = extractGitHubLinkFollow({
      markdown: VHS_README_MARKDOWN,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    const filenames = result.children.map(c => c.filename).sort();
    expect(filenames).toEqual(["vhs-bubbletea", "vhs-gum", "vhs-lipgloss"]);
  });

  test("lipgloss-bubbletea, lipgloss-gum, lipgloss-vhs for LipGloss", () => {
    const result = extractGitHubLinkFollow({
      markdown: LIPGLOSS_README_MARKDOWN,
      readmeUrl: "https://github.com/charmbracelet/lipgloss",
      parentFilename: "lipgloss"
    });

    const filenames = result.children.map(c => c.filename).sort();
    expect(filenames).toEqual(["lipgloss-bubbletea", "lipgloss-gum", "lipgloss-vhs"]);
  });

  test("crush-bubbletea, crush-lipgloss, crush-vhs for Crush", () => {
    const result = extractGitHubLinkFollow({
      markdown: CRUSH_README_MARKDOWN,
      readmeUrl: "https://github.com/charmbracelet/crush",
      parentFilename: "crush"
    });

    const filenames = result.children.map(c => c.filename).sort();
    expect(filenames).toEqual(["crush-bubbletea", "crush-lipgloss", "crush-vhs"]);
  });
});

// ============================================================================
// Context Section Tests
// ============================================================================

describe("extractContextSection", () => {
  test("extracts heading context for link", () => {
    const markdown = `# Title\n\n## Section 1\n\n[Link 1](https://example.com/1)\n\n## Section 2\n\n[Link 2](https://example.com/2)`;

    const section1 = extractContextSection(markdown, 0);
    const section2 = extractContextSection(markdown, 1);

    expect(section1).toBe("Section 1");
    expect(section2).toBe("Section 2");
  });

  test("returns undefined for link before any heading", () => {
    const markdown = `[Link](https://example.com)\n\n## Section`;

    const section = extractContextSection(markdown, 0);
    expect(section).toBeUndefined();
  });

  test("handles multiple links in same section", () => {
    const markdown = `# Title\n\n## Section\n\n[Link 1](https://example.com/1)\n\n[Link 2](https://example.com/2)`;

    const section1 = extractContextSection(markdown, 0);
    const section2 = extractContextSection(markdown, 1);

    expect(section1).toBe("Section");
    expect(section2).toBe("Section");
  });
});

// ============================================================================
// Excluded Links Tests
// ============================================================================

describe("extractGitHubLinkFollow - excluded links", () => {
  test("categorizes excluded links correctly", () => {
    const markdown = `# Test\n\n` +
      `- [Fragment](#section)\n` +
      `- [External](https://example.com)\n` +
      `- [Self](https://github.com/charmbracelet/vhs)\n` +
      `- [Valid](https://github.com/charmbracelet/other)\n`;

    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    expect(result.excluded_links.length).toBeGreaterThan(0);

    // Check categories
    expect(result.exclusion_reasons.self_reference.length).toBeGreaterThan(0);
    expect(result.exclusion_reasons.non_github.length).toBeGreaterThan(0);
  });

  test("includes reject_rule and diagnostic for excluded links", () => {
    const markdown = `# Test\n\n[External](https://example.com)`;

    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    const externalLink = result.excluded_links.find(l => l.original === "https://example.com");
    expect(externalLink).toBeDefined();
    expect(externalLink?.reject_rule).toBe("RJ02_EXTERNAL_URL");
    expect(externalLink?.category).toBe("non_github");
  });
});

// ============================================================================
// Link Text Tests
// ============================================================================

describe("extractGitHubLinkFollow - link text", () => {
  test("preserves original link text", () => {
    const markdown = `# Test\n\n- [VHS - Video for Shell](https://github.com/charmbracelet/vhs)`;

    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/test/test",
      parentFilename: "test"
    });

    expect(result.children[0].link_text).toBe("VHS - Video for Shell");
  });

  test("uses target URL when no text", () => {
    const markdown = `# Test\n\n- [](https://github.com/charmbracelet/vhs)`;

    const result = extractGitHubLinkFollow({
      markdown,
      readmeUrl: "https://github.com/test/test",
      parentFilename: "test"
    });

    expect(result.children[0].link_text).toBe("https://github.com/charmbracelet/vhs");
  });
});

// ============================================================================
// Regression Fixture Parity Tests
// ============================================================================

describe("extractGitHubLinkFollow - regression fixture parity", () => {
  test("vhs fixture matches expected output", () => {
    const result = extractGitHubLinkFollow({
      markdown: VHS_README_MARKDOWN,
      readmeUrl: "https://github.com/charmbracelet/vhs",
      parentFilename: "vhs"
    });

    // Child count
    expect(result.children.length).toBe(3);

    // Expected URLs (alphabetical order)
    const expectedUrls = [
      "https://github.com/charmbracelet/bubbletea",
      "https://github.com/charmbracelet/gum",
      "https://github.com/charmbracelet/lipgloss"
    ];
    expect(result.children.map(c => c.url)).toEqual(expectedUrls);

    // All children owned by charmbracelet
    result.children.forEach(child => {
      expect(child.owner).toBe("charmbracelet");
    });

    // All children at depth 1
    result.children.forEach(child => {
      expect(child.depth).toBe(1);
    });

    // All from readme_link
    result.children.forEach(child => {
      expect(child.discovery_source).toBe("readme_link");
    });
  });

  test("lipgloss fixture matches expected output", () => {
    const result = extractGitHubLinkFollow({
      markdown: LIPGLOSS_README_MARKDOWN,
      readmeUrl: "https://github.com/charmbracelet/lipgloss",
      parentFilename: "lipgloss"
    });

    expect(result.children.length).toBe(3);

    const repos = result.children.map(c => c.repo).sort();
    expect(repos).toEqual(["bubbletea", "gum", "vhs"]);
  });

  test("crush fixture matches expected output", () => {
    const result = extractGitHubLinkFollow({
      markdown: CRUSH_README_MARKDOWN,
      readmeUrl: "https://github.com/charmbracelet/crush",
      parentFilename: "crush"
    });

    expect(result.children.length).toBe(3);

    const repos = result.children.map(c => c.repo).sort();
    expect(repos).toEqual(["bubbletea", "lipgloss", "vhs"]);
  });
});
