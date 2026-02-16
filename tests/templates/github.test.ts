/**
 * GitHub Template Tests
 *
 * Tests for GitHub content extraction (repos, issues, PRs, code files).
 */

import { describe, test, expect } from "bun:test";

import {
  githubRepoTemplate,
  githubIssueTemplate,
  githubPRTemplate,
  githubCodeTemplate,
  githubGistTemplate,
  extractRepoInfo,
  extractIssueOrPRNumber,
  detectGitHubPageType,
  type GitHubPageType,
  extractRepoStats,
  formatGitHubContent
} from "../../src/content/templates/github";

// ============================================================================
// Template Configuration Tests
// ============================================================================

describe("GitHub templates configuration", () => {
  test("githubRepoTemplate has correct configuration", () => {
    expect(githubRepoTemplate.domain).toBe("github.com");
    expect(githubRepoTemplate.name).toContain("GitHub");
    expect(githubRepoTemplate.enabled).toBe(true);
    expect(githubRepoTemplate.frontmatterExtras?.site).toBe("github");
  });

  test("githubIssueTemplate has URL pattern for issues", () => {
    expect(githubIssueTemplate.domain).toBe("github.com");
    expect(githubIssueTemplate.urlPattern).toContain("issues");
  });

  test("githubPRTemplate has URL pattern for pull requests", () => {
    expect(githubPRTemplate.domain).toBe("github.com");
    expect(githubPRTemplate.urlPattern).toContain("pull");
  });

  test("githubCodeTemplate handles code file views", () => {
    expect(githubCodeTemplate.domain).toBe("github.com");
    expect(githubCodeTemplate.name).toContain("Code");
  });

  test("githubGistTemplate handles gists", () => {
    expect(githubGistTemplate.domain).toBe("gist.github.com");
    expect(githubGistTemplate.name).toContain("Gist");
  });

  test("all templates have required selectors", () => {
    const templates = [githubRepoTemplate, githubIssueTemplate, githubPRTemplate, githubCodeTemplate];
    for (const template of templates) {
      expect(template.selectors).toBeDefined();
    }
  });
});

// ============================================================================
// extractRepoInfo Tests
// ============================================================================

describe("extractRepoInfo", () => {
  test("extracts owner/repo from URL", () => {
    expect(extractRepoInfo("https://github.com/facebook/react")).toEqual({
      owner: "facebook",
      repo: "react"
    });
    expect(extractRepoInfo("https://github.com/microsoft/vscode/")).toEqual({
      owner: "microsoft",
      repo: "vscode"
    });
  });

  test("extracts from URLs with additional path", () => {
    expect(extractRepoInfo("https://github.com/user/repo/issues/123")).toEqual({
      owner: "user",
      repo: "repo"
    });
    expect(extractRepoInfo("https://github.com/user/repo/tree/main/src")).toEqual({
      owner: "user",
      repo: "repo"
    });
  });

  test("returns null for non-repo URLs", () => {
    expect(extractRepoInfo("https://github.com/")).toBeNull();
    expect(extractRepoInfo("https://github.com/features")).toBeNull();
    expect(extractRepoInfo("https://example.com/")).toBeNull();
  });
});

// ============================================================================
// extractIssueOrPRNumber Tests
// ============================================================================

describe("extractIssueOrPRNumber", () => {
  test("extracts issue number", () => {
    expect(extractIssueOrPRNumber("https://github.com/user/repo/issues/123")).toBe(123);
    expect(extractIssueOrPRNumber("https://github.com/user/repo/issues/1")).toBe(1);
  });

  test("extracts PR number", () => {
    expect(extractIssueOrPRNumber("https://github.com/user/repo/pull/456")).toBe(456);
  });

  test("returns null for non-issue/PR URLs", () => {
    expect(extractIssueOrPRNumber("https://github.com/user/repo")).toBeNull();
    expect(extractIssueOrPRNumber("https://github.com/user/repo/wiki")).toBeNull();
  });
});

// ============================================================================
// detectGitHubPageType Tests
// ============================================================================

describe("detectGitHubPageType", () => {
  test("detects repo root", () => {
    expect(detectGitHubPageType("https://github.com/user/repo")).toBe("repo");
    expect(detectGitHubPageType("https://github.com/user/repo/")).toBe("repo");
  });

  test("detects issue pages", () => {
    expect(detectGitHubPageType("https://github.com/user/repo/issues/123")).toBe("issue");
  });

  test("detects PR pages", () => {
    expect(detectGitHubPageType("https://github.com/user/repo/pull/456")).toBe("pr");
  });

  test("detects code/blob pages", () => {
    expect(detectGitHubPageType("https://github.com/user/repo/blob/main/file.ts")).toBe("code");
  });

  test("detects gist pages", () => {
    expect(detectGitHubPageType("https://gist.github.com/user/abc123")).toBe("gist");
  });
});

// ============================================================================
// extractRepoStats Tests
// ============================================================================

describe("extractRepoStats", () => {
  test("function exists and is callable", () => {
    expect(typeof extractRepoStats).toBe("function");
  });

  // Expected behavior: extract stars, forks, watchers, open issues count
});

// ============================================================================
// formatGitHubContent Tests
// ============================================================================

describe("formatGitHubContent", () => {
  test("function exists and is callable", () => {
    expect(typeof formatGitHubContent).toBe("function");
  });

  // Expected markdown structure for repo:
  // # owner/repo
  //
  // ⭐ 42k | 🍴 5k | 👀 1k | 📝 100 issues
  //
  // Repository description...
  //
  // ## README
  // README content...
});

// ============================================================================
// Expected Markdown Output Tests
// ============================================================================

describe("Expected GitHub markdown output", () => {
  test("GitHub repo markdown structure expectation", () => {
    // Expected markdown structure for a GitHub repo:
    // # facebook/react
    //
    // ⭐ 200k | 🍴 40k | 👀 5k | 📝 500 issues
    //
    // A declarative, efficient, and flexible JavaScript library...
    //
    // ## README
    //
    // # React
    //
    // README content...

    expect(true).toBe(true); // Placeholder
  });

  test("GitHub issue markdown structure expectation", () => {
    // Expected markdown structure for a GitHub issue:
    // # Issue Title (#123)
    //
    // **Author:** username | **Created:** 2023-01-15 | **Status:** Open
    //
    // Labels: `bug`, `priority: high`
    //
    // Issue body...
    //
    // ## Comments
    //
    // **commenter1** on 2023-01-16
    // Comment body...

    expect(true).toBe(true);
  });

  test("GitHub PR markdown structure expectation", () => {
    // Expected markdown structure for a GitHub PR:
    // # PR Title (#456)
    //
    // **Author:** username | **Branch:** feature-branch → main | **Status:** Open
    //
    // PR description...
    //
    // ## Commits
    //
    // - abc123: Fix bug in X
    // - def456: Add tests for X
    //
    // ## Files Changed
    //
    // - `src/file.ts` (+10, -5)
    // - `tests/file.test.ts` (+20)

    expect(true).toBe(true);
  });

  test("GitHub code file markdown structure expectation", () => {
    // Expected markdown structure for a GitHub code file:
    // # user/repo - src/index.ts
    //
    // Path: `src/index.ts` | Branch: `main`
    //
    // ```typescript
    // // File content
    // export function hello() {
    //   return "world";
    // }
    // ```

    expect(true).toBe(true);
  });
});
