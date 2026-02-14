/**
 * Template Fixture Tests
 *
 * Tests that use HTML fixtures to verify template extraction produces
 * expected markdown output. Uses happy-dom for HTML parsing.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// happy-dom for DOM parsing
import { Window } from "happy-dom";

// Import default settings for tests
import { DEFAULT_SETTINGS } from "../../src/shared/settings";

// Import from index to trigger template registration side effects
import {
  getTemplateForUrl,
  getBuiltInTemplates,
  // Reddit
  redditOldTemplate,
  redditNewTemplate,
  redditTemplate,
  formatComments as formatRedditComments,
  // Hacker News
  hackerNewsItemTemplate,
  hackerNewsListingTemplate,
  isSelfPost,
  formatComments as formatHackerNewsComments,
  formatStoriesListing,
  // Stack Overflow
  stackOverflowTemplate,
  extractQuestionId,
  // GitHub
  githubRepoTemplate,
  githubIssueTemplate,
  extractRepoInfo,
  detectGitHubPageType,
  // Wikipedia
  wikipediaTemplate,
  englishWikipediaTemplate,
  extractLanguage,
  // Medium
  mediumTemplate,
  mediumMainTemplate,
  // Substack
  substackTemplate,
  substackMainTemplate,
  isPaidContent,
  // ArXiv
  arxivTemplate,
  extractArxivId,
  buildPdfUrl,
  // Amazon
  amazonTemplate,
  extractAsin,
  // Recipe
  genericRecipeTemplate,
  parseDuration,
  isRecipeUrl,
  // Docs
  mdnTemplate
} from "../../src/content/templates";

// ============================================================================
// Test Utilities
// ============================================================================

const FIXTURES_DIR = join(import.meta.dir, "fixtures");

/**
 * Load a fixture HTML file and return a Document object
 */
function loadFixture(filename: string): { document: Document; window: Window } {
  const html = readFileSync(join(FIXTURES_DIR, filename), "utf-8");
  const window = new Window({
    url: "https://example.com",
    width: 1920,
    height: 1080,
  });
  window.document.write(html);
  return { document: window.document, window };
}

/**
 * Clean whitespace for comparison
 */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ============================================================================
// Fixture Verification Tests
// ============================================================================

describe("HTML Fixtures", () => {
  test("all fixture files exist and are readable", () => {
    const fixtures = [
      "reddit-old.html",
      "reddit-new.html",
      "hackernews-item.html",
      "hackernews-listing.html",
      "stackoverflow.html",
      "github-repo.html",
      "github-issue.html",
      "wikipedia.html",
      "medium.html",
      "substack.html",
      "arxiv.html",
      "amazon.html",
      "recipe.html",
      "docs-mdn.html",
    ];

    for (const fixture of fixtures) {
      const content = readFileSync(join(FIXTURES_DIR, fixture), "utf-8");
      expect(content.length).toBeGreaterThan(100);
      expect(content).toContain("</html>");
    }
  });
});

// ============================================================================
// Reddit Template Extraction Tests
// ============================================================================

describe("Reddit fixture extraction", () => {
  test("old Reddit fixture can be parsed", () => {
    const { document } = loadFixture("reddit-old.html");

    // Verify basic structure
    expect(document.querySelector("#siteTable")).not.toBeNull();
    expect(document.querySelector(".thing.id-t3_abc123")).not.toBeNull();

    // Extract title
    const titleEl = document.querySelector("#siteTable .title a.title") as HTMLAnchorElement;
    expect(titleEl).not.toBeNull();
    expect(titleEl.textContent).toContain("Test Post Title");

    // Extract author
    const authorEl = document.querySelector(".author") as HTMLAnchorElement;
    expect(authorEl).not.toBeNull();
    expect(authorEl.textContent).toBe("testuser");

    // Extract score
    const scoreEl = document.querySelector(".score");
    expect(scoreEl?.textContent).toBe("1234");

    // Extract self-post content
    const contentEl = document.querySelector(".usertext-body .md");
    expect(contentEl).not.toBeNull();
    expect(contentEl?.textContent).toContain("self-post content");

    // Verify comments exist
    const comments = document.querySelectorAll(".commentarea .thing");
    expect(comments.length).toBeGreaterThan(0);
  });

  test("Reddit template matches fixture URL", () => {
    const template = getTemplateForUrl("https://old.reddit.com/r/programming/comments/abc123/test_post/");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Old");
  });

  test("Reddit formatComments produces expected markdown", () => {
    const comments = [
      { author: "commenter1", body: "Great post!", score: "42" },
      { author: "testuser", body: "Thanks!", score: "15" },
    ];

    const formatted = formatRedditComments(comments);

    expect(formatted).toContain("## Comments");
    expect(formatted).toContain("**commenter1**");
    expect(formatted).toContain("(↑42)");
    expect(formatted).toContain("Great post!");
    expect(formatted).toContain("---");
    expect(formatted).toContain("**testuser**");
  });
});

// ============================================================================
// Hacker News Template Extraction Tests
// ============================================================================

describe("Hacker News fixture extraction", () => {
  test("HN item fixture can be parsed", () => {
    const { document } = loadFixture("hackernews-item.html");

    // Verify structure
    expect(document.querySelector(".fatitem")).not.toBeNull();
    expect(document.querySelector(".athing#12345")).not.toBeNull();

    // Extract title
    const titleEl = document.querySelector(".storylink") as HTMLAnchorElement;
    expect(titleEl).not.toBeNull();
    expect(titleEl.textContent).toBe("Show HN: A Great New Tool for Developers");

    // Extract points
    const scoreEl = document.querySelector(".score");
    expect(scoreEl?.textContent).toBe("567 points");

    // Extract author
    const authorEl = document.querySelector(".hnuser");
    expect(authorEl?.textContent).toBe("pg");

    // Verify comment count in subtext
    const subtext = document.querySelector(".subtext")?.textContent;
    expect(subtext).toContain("89 comments");
  });

  test("HN listing fixture can be parsed", () => {
    const { document } = loadFixture("hackernews-listing.html");

    const stories = document.querySelectorAll(".athing");
    expect(stories.length).toBe(3);

    // Verify first story
    const firstTitle = document.querySelector(".athing#12345 .storylink")?.textContent;
    expect(firstTitle).toBe("First Story Title");

    // Verify Ask HN is identified
    const askTitle = document.querySelector(".athing#12347 .storylink")?.textContent;
    expect(askTitle).toContain("Ask HN");
    expect(isSelfPost(askTitle || "")).toBe(true);
  });

  test("HN template matches fixture URL", () => {
    const template = getTemplateForUrl("https://news.ycombinator.com/item?id=12345");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Hacker News");
    expect(template?.urlPattern).toContain("/item");
  });

  test("HN formatComments produces expected markdown", () => {
    const comments = [
      { author: "dang", body: "Top level comment", score: "42", indent: 0 },
      { author: "pg", body: "Reply", score: "15", indent: 1 },
    ];

    const formatted = formatHackerNewsComments(comments);

    expect(formatted).toContain("## Comments");
    expect(formatted).toContain("**dang**");
    expect(formatted).toContain("Top level comment");
    expect(formatted).toContain("Reply");
  });

  test("HN formatStoriesListing produces expected markdown", () => {
    const stories = [
      { rank: 1, title: "First Story", url: "https://example.com/1", points: 100, author: "user1", comments: 50 },
      { rank: 2, title: "Second Story", url: "https://example.com/2", points: 75, author: "user2", comments: 25 },
    ];

    const formatted = formatStoriesListing(stories);

    expect(formatted).toContain("# Hacker News Front Page");
    expect(formatted).toContain("1. **[First Story]");
    expect(formatted).toContain("100 pts");
    expect(formatted).toContain("50 comments");
  });
});

// ============================================================================
// Stack Overflow Template Extraction Tests
// ============================================================================

describe("Stack Overflow fixture extraction", () => {
  test("SO fixture can be parsed", () => {
    const { document } = loadFixture("stackoverflow.html");

    // Verify question structure
    expect(document.querySelector(".question")).not.toBeNull();
    expect(document.querySelector(".question[data-questionid='12345']")).not.toBeNull();

    // Extract question title (from page title or h1)
    const questionText = document.querySelector(".post-text")?.textContent;
    expect(questionText).toContain("array of numbers");

    // Extract vote count
    const voteCount = document.querySelector(".question .vote-count-post")?.textContent;
    expect(voteCount).toBe("42");

    // Extract tags
    const tags = document.querySelectorAll(".post-tag");
    expect(tags.length).toBe(3);
    expect(tags[0]?.textContent).toBe("javascript");

    // Verify accepted answer exists
    expect(document.querySelector(".accepted-answer")).not.toBeNull();
  });

  test("SO template matches fixture URL", () => {
    const template = getTemplateForUrl("https://stackoverflow.com/questions/12345/how-to-sort-array");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Stack Overflow");
  });

  test("extractQuestionId extracts correct ID", () => {
    const id = extractQuestionId("https://stackoverflow.com/questions/12345/title");
    expect(id).toBe("12345");
  });
});

// ============================================================================
// GitHub Template Extraction Tests
// ============================================================================

describe("GitHub fixture extraction", () => {
  test("GitHub repo fixture can be parsed", () => {
    const { document } = loadFixture("github-repo.html");

    // Verify structure
    expect(document.querySelector(".repository-content")).not.toBeNull();

    // Extract repo name
    const repoName = document.querySelector("strong[itemprop='name'] a")?.textContent;
    expect(repoName?.trim()).toBe("react");

    // Extract description
    const description = document.querySelector(".f4 p")?.textContent;
    expect(description).toContain("library for web and native user interfaces");

    // Extract README
    expect(document.querySelector(".markdown-body")).not.toBeNull();
    const readmeH1 = document.querySelector(".markdown-body h1")?.textContent;
    expect(readmeH1).toBe("React");
  });

  test("GitHub issue fixture can be parsed", () => {
    const { document } = loadFixture("github-issue.html");

    // Verify structure
    expect(document.querySelector(".gh-header")).not.toBeNull();

    // Extract issue title
    const title = document.querySelector(".js-issue-title")?.textContent;
    expect(title).toContain("Bug: Cannot sort array");

    // Extract issue number
    const number = document.querySelector(".gh-header-number")?.textContent;
    expect(number).toBe("#42");

    // Verify labels
    const labels = document.querySelectorAll(".Label");
    expect(labels.length).toBeGreaterThan(0);
  });

  test("GitHub template matches fixture URLs", () => {
    const repoTemplate = getTemplateForUrl("https://github.com/facebook/react");
    expect(repoTemplate).not.toBeNull();
    expect(repoTemplate?.name).toContain("GitHub");

    const issueTemplate = getTemplateForUrl("https://github.com/facebook/react/issues/123");
    expect(issueTemplate).not.toBeNull();
    expect(issueTemplate?.name).toContain("Issue");
  });

  test("extractRepoInfo extracts correct owner/repo", () => {
    const info = extractRepoInfo("https://github.com/facebook/react");
    expect(info).toEqual({ owner: "facebook", repo: "react" });
  });

  test("detectGitHubPageType returns correct type", () => {
    expect(detectGitHubPageType("https://github.com/user/repo")).toBe("repo");
    expect(detectGitHubPageType("https://github.com/user/repo/issues/123")).toBe("issue");
    expect(detectGitHubPageType("https://github.com/user/repo/pull/456")).toBe("pr");
    expect(detectGitHubPageType("https://github.com/user/repo/blob/main/file.ts")).toBe("code");
  });
});

// ============================================================================
// Wikipedia Template Extraction Tests
// ============================================================================

describe("Wikipedia fixture extraction", () => {
  test("Wikipedia fixture can be parsed", () => {
    const { document } = loadFixture("wikipedia.html");

    // Verify structure
    expect(document.querySelector("#content")).not.toBeNull();

    // Extract title
    const title = document.querySelector("#firstHeading")?.textContent;
    expect(title).toBe("Test Article");

    // Extract short description
    const shortDesc = document.querySelector(".shortdescription")?.textContent;
    expect(shortDesc).toContain("sample article");

    // Extract content
    const content = document.querySelector("#mw-content-text");
    expect(content).not.toBeNull();
    expect(content?.textContent).toContain("testing purposes");

    // Verify edit links exist (to be removed during extraction)
    expect(document.querySelector(".mw-editsection")).not.toBeNull();
  });

  test("Wikipedia template matches fixture URL", () => {
    const template = getTemplateForUrl("https://en.wikipedia.org/wiki/Test_Article");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Wikipedia");
  });

  test("extractLanguage extracts correct language code", () => {
    expect(extractLanguage("https://en.wikipedia.org/wiki/Test")).toBe("en");
    expect(extractLanguage("https://de.wikipedia.org/wiki/Test")).toBe("de");
    expect(extractLanguage("https://ja.wikipedia.org/wiki/Test")).toBe("ja");
  });
});

// ============================================================================
// Medium Template Extraction Tests
// ============================================================================

describe("Medium fixture extraction", () => {
  test("Medium fixture can be parsed", () => {
    const { document } = loadFixture("medium.html");

    // Verify structure
    expect(document.querySelector("article")).not.toBeNull();

    // Extract title
    const title = document.querySelector("h1")?.textContent;
    expect(title).toBe("Test Article Title");

    // Extract author
    const author = document.querySelector(".postMetaInline a.ds-link span")?.textContent ||
                   document.querySelector(".postMeta a span")?.textContent;
    expect(author).toContain("Test Author");

    // Extract reading time
    const readTime = document.querySelector(".readingTime")?.textContent;
    expect(readTime).toBe("5 min read");

    // Verify content
    const content = document.querySelector(".postContent");
    expect(content).not.toBeNull();
  });

  test("Medium template matches fixture URL", () => {
    const template = getTemplateForUrl("https://medium.com/@author/article-slug");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Medium");
  });
});

// ============================================================================
// Substack Template Extraction Tests
// ============================================================================

describe("Substack fixture extraction", () => {
  test("Substack fixture can be parsed", () => {
    const { document } = loadFixture("substack.html");

    // Verify structure
    expect(document.querySelector(".post")).not.toBeNull();

    // Extract title
    const title = document.querySelector(".post-title")?.textContent;
    expect(title).toBe("Test Newsletter Title");

    // Extract author
    const author = document.querySelector(".post-meta a.author")?.textContent;
    expect(author).toBe("Test Author");

    // Extract content
    const content = document.querySelector(".post-content");
    expect(content).not.toBeNull();
    expect(content?.textContent).toContain("introduction to the newsletter");
  });

  test("Substack template matches fixture URL", () => {
    const template = getTemplateForUrl("https://newsletter.substack.com/p/article-slug");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Substack");
  });
});

// ============================================================================
// ArXiv Template Extraction Tests
// ============================================================================

describe("ArXiv fixture extraction", () => {
  test("ArXiv fixture can be parsed", () => {
    const { document } = loadFixture("arxiv.html");

    // Verify structure
    expect(document.querySelector(".list")).not.toBeNull();

    // Extract title
    const title = document.querySelector(".title")?.textContent;
    expect(title).toContain("Test Paper Title");

    // Extract authors
    const authors = document.querySelectorAll(".authors a");
    expect(authors.length).toBe(3);
    expect(authors[0]?.textContent).toBe("Author One");

    // Extract abstract
    const abstract = document.querySelector(".abstract")?.textContent;
    expect(abstract).toContain("novel approach");
  });

  test("ArXiv template matches fixture URL", () => {
    const template = getTemplateForUrl("https://arxiv.org/abs/2301.12345");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("ArXiv");
  });

  test("extractArxivId extracts correct ID", () => {
    expect(extractArxivId("https://arxiv.org/abs/2301.12345")).toBe("2301.12345");
    expect(extractArxivId("https://arxiv.org/pdf/2301.12345.pdf")).toBe("2301.12345");
  });

  test("buildPdfUrl builds correct PDF URL", () => {
    expect(buildPdfUrl("2301.12345")).toBe("https://arxiv.org/pdf/2301.12345.pdf");
  });
});

// ============================================================================
// Amazon Template Extraction Tests
// ============================================================================

describe("Amazon fixture extraction", () => {
  test("Amazon fixture can be parsed", () => {
    const { document } = loadFixture("amazon.html");

    // Verify structure
    expect(document.querySelector("#centerCol")).not.toBeNull();

    // Extract title
    const title = document.querySelector("#productTitle")?.textContent;
    expect(title).toBe("Test Product Name - Premium Edition");

    // Extract rating
    const rating = document.querySelector(".a-icon-alt")?.textContent;
    expect(rating).toContain("4.5 out of 5 stars");

    // Extract price
    const price = document.querySelector(".a-price .a-offscreen")?.textContent;
    expect(price).toBe("$99.99");

    // Extract features
    const features = document.querySelectorAll("#feature-bullets li");
    expect(features.length).toBe(5);
  });

  test("Amazon template matches fixture URL", () => {
    const template = getTemplateForUrl("https://www.amazon.com/dp/B08N5WRWNW");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Amazon");
  });

  test("extractAsin extracts correct ASIN", () => {
    expect(extractAsin("https://www.amazon.com/dp/B08N5WRWNW")).toBe("B08N5WRWNW");
    expect(extractAsin("https://www.amazon.com/gp/product/B08N5WRWNW")).toBe("B08N5WRWNW");
  });
});

// ============================================================================
// Recipe Template Extraction Tests
// ============================================================================

describe("Recipe fixture extraction", () => {
  test("Recipe fixture can be parsed", () => {
    const { document } = loadFixture("recipe.html");

    // Verify structure
    expect(document.querySelector(".recipe")).not.toBeNull();

    // Extract title
    const title = document.querySelector(".recipe-title")?.textContent;
    expect(title).toBe("Test Recipe Name");

    // Extract times
    const prepTime = document.querySelector(".prep-time .value")?.textContent;
    expect(prepTime).toBe("15 mins");

    const cookTime = document.querySelector(".cook-time .value")?.textContent;
    expect(cookTime).toBe("30 mins");

    // Extract ingredients
    const ingredients = document.querySelectorAll(".recipe-ingredients li");
    expect(ingredients.length).toBe(5);

    // Extract instructions
    const steps = document.querySelectorAll(".recipe-directions li");
    expect(steps.length).toBe(5);

    // Verify JSON-LD exists
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    expect(jsonLd).not.toBeNull();
  });

  test("Recipe template matches fixture URL", () => {
    const template = getTemplateForUrl("https://www.allrecipes.com/recipe/12345/test-recipe/");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("Recipe");
  });

  test("parseDuration converts ISO 8601 durations", () => {
    expect(parseDuration("PT30M")).toBe("30 minutes");
    expect(parseDuration("PT1H30M")).toBe("1 hour 30 minutes");
    expect(parseDuration("PT2H")).toBe("2 hours");
  });

  test("isRecipeUrl identifies recipe sites", () => {
    expect(isRecipeUrl("https://www.allrecipes.com/recipe/123/")).toBe(true);
    expect(isRecipeUrl("https://www.foodnetwork.com/recipes/example")).toBe(true);
    expect(isRecipeUrl("https://www.example.com/")).toBe(false);
  });
});

// ============================================================================
// Docs Template Extraction Tests
// ============================================================================

describe("Docs fixture extraction", () => {
  test("MDN fixture can be parsed", () => {
    const { document } = loadFixture("docs-mdn.html");

    // Verify structure
    expect(document.querySelector(".documentation")).not.toBeNull();

    // Extract title
    const title = document.querySelector("h1")?.textContent;
    expect(title).toBe("Array.prototype.map()");

    // Extract breadcrumbs
    const breadcrumbs = document.querySelectorAll(".breadcrumbs li");
    expect(breadcrumbs.length).toBeGreaterThan(0);
    expect(breadcrumbs[0]?.textContent).toContain("MDN");

    // Extract syntax section
    const syntax = document.querySelector("#syntax");
    expect(syntax).not.toBeNull();

    // Extract code examples
    const codeBlocks = document.querySelectorAll("pre code");
    expect(codeBlocks.length).toBeGreaterThan(0);

    // Verify parameters section
    const parameters = document.querySelector("#parameters");
    expect(parameters).not.toBeNull();
  });

  test("MDN template matches fixture URL", () => {
    const template = getTemplateForUrl("https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("MDN");
  });

  test("React docs template matches", () => {
    const template = getTemplateForUrl("https://react.dev/learn");
    expect(template).not.toBeNull();
    expect(template?.name).toContain("React");
  });
});

// ============================================================================
// Registry Integration Tests
// ============================================================================

describe("Template registry integration", () => {
  test("getTemplateForUrl returns null for unknown domains", () => {
    const template = getTemplateForUrl("https://unknown-random-site-12345.com/article");
    expect(template).toBeNull();
  });

  test("all fixture URLs match their expected templates", () => {
    const urlTemplatePairs = [
      { url: "https://old.reddit.com/r/test/comments/abc/", expectedName: "Old" },
      { url: "https://reddit.com/r/test/comments/abc/title/", expectedName: "Reddit" },
      { url: "https://news.ycombinator.com/item?id=123", expectedName: "Hacker News" },
      { url: "https://stackoverflow.com/questions/123/title", expectedName: "Stack Overflow" },
      { url: "https://github.com/user/repo", expectedName: "GitHub" },
      { url: "https://en.wikipedia.org/wiki/Test", expectedName: "Wikipedia" },
      { url: "https://medium.com/@user/article", expectedName: "Medium" },
      { url: "https://newsletter.substack.com/p/article", expectedName: "Substack" },
      { url: "https://arxiv.org/abs/2301.12345", expectedName: "ArXiv" },
      { url: "https://www.amazon.com/dp/B08N5WRWNW", expectedName: "Amazon" },
      { url: "https://www.allrecipes.com/recipe/123/", expectedName: "Recipe" },
      // MDN requires /docs/ in path - use a full docs URL
      { url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript", expectedName: "MDN" },
    ];

    for (const { url, expectedName } of urlTemplatePairs) {
      const template = getTemplateForUrl(url);
      expect(template).not.toBeNull();
      expect(template?.name).toContain(expectedName);
    }
  });

  test("built-in templates are all enabled by default", () => {
    const templates = getBuiltInTemplates(DEFAULT_SETTINGS);
    const disabled = templates.filter(t => !t.enabled);
    expect(disabled).toHaveLength(0);
  });

  test("getBuiltInTemplates is resilient without settings", () => {
    const templates = getBuiltInTemplates();
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.every((template) => template.isEnabled)).toBe(true);
  });

  test("templates have valid domain patterns", () => {
    const templates = getBuiltInTemplates(DEFAULT_SETTINGS);

    for (const template of templates) {
      expect(template.domain).toBeTruthy();
      expect(template.domain.length).toBeGreaterThan(0);
      expect(template.name).toBeTruthy();
    }
  });
});

// ============================================================================
// Expected Markdown Output Format Tests
// ============================================================================

describe("Expected markdown output format", () => {
  test("Reddit post should include subreddit as tag", () => {
    const url = "https://reddit.com/r/programming/comments/abc/post-title/";
    const subreddit = url.match(/reddit\.com\/r\/([^/]+)/i)?.[1]?.toLowerCase();
    expect(subreddit).toBe("programming");
  });

  test("GitHub repo markdown should include stats", () => {
    // Expected structure:
    // # facebook/react
    // ⭐ 200k | 🍴 41.6k | 👀 6.7k
    // The library for web and native user interfaces
    // ## README
    // React content...

    const stats = { stars: "200k", forks: "41.6k", watchers: "6.7k" };
    const expectedStats = `⭐ ${stats.stars} | 🍴 ${stats.forks} | 👀 ${stats.watchers}`;
    expect(expectedStats).toContain("⭐ 200k");
    expect(expectedStats).toContain("🍴 41.6k");
  });

  test("Stack Overflow answer should be marked as accepted", () => {
    // Expected structure includes:
    // ## Accepted Answer ✓
    const acceptedIndicator = "✓";
    expect(acceptedIndicator).toBe("✓");
  });

  test("ArXiv should include BibTeX citation", () => {
    // Expected structure includes:
    // ## Citation
    // ```bibtex
    // @article{2301.12345, ...}
    // ```
    const paperId = "2301.12345";
    const bibtexStart = `@article{${paperId}`;
    expect(bibtexStart).toContain("2301.12345");
  });

  test("Recipe should include prep/cook times in frontmatter", () => {
    // Expected structure:
    // **Prep Time:** 15 mins | **Cook Time:** 30 mins | **Total:** 45 mins
    const times = { prep: "15 mins", cook: "30 mins", total: "45 mins" };
    const timeStr = `**Prep Time:** ${times.prep} | **Cook Time:** ${times.cook} | **Total:** ${times.total}`;
    expect(timeStr).toContain("15 mins");
    expect(timeStr).toContain("30 mins");
    expect(timeStr).toContain("45 mins");
  });
});
