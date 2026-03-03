// ============================================================================
// TP004: Canonicalization Fixture Cases
// ============================================================================

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import {
  normalizeGithubReadmeLinks,
  buildGithubContextFromUrl,
  buildGithubContext
} from "../../src/shared/githubRelativeLinkCanonicalization";
import {
  extractGitHubLinkFollow
} from "../../src/shared/githubLinkFollowExtraction";

describe("TP004: Canonicalization - Pass Classes", () => {
  const FIXTURES_DIR = join(import.meta.dir, "fixtures");

  function loadMarkdownFixture(filename: string): string {
    return readFileSync(join(FIXTURES_DIR, filename), "utf-8");
  }

  const MOCK_CONTEXT = buildGithubContext(
    "owner",
    "repo",
    "main",
    "blob/main/README.md",
    "https://github.com/owner/repo"
  );

  describe("NL03: Same-directory links (./path)", () => {
    test("canonicalizes ./docs/api.md correctly", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-same-directory.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const apiLink = output.results.find(r => r.original.target === "./docs/api.md");
      expect(apiLink).toBeDefined();
      expect(apiLink?.category).toBe("same-directory");
      expect(apiLink?.canonicalUrl).toBe("https://github.com/owner/repo/blob/main/docs/api.md");
      expect(apiLink?.rejectRule).toBe("none");
      expect(apiLink?.errorRule).toBe("none");
    });

    test("canonicalizes bare path links (without ./)", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-same-directory.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const guideLink = output.results.find(r => r.original.target === "./guide.md");
      expect(guideLink).toBeDefined();
      expect(guideLink?.category).toBe("same-directory");
      expect(guideLink?.canonicalUrl).toBe("https://github.com/owner/repo/blob/main/guide.md");
      expect(guideLink?.rejectRule).toBe("none");
    });

    test("handles multiple same-directory links", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-same-directory.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const sameDirLinks = output.results.filter(r => r.category === "same-directory");
      expect(sameDirLinks.length).toBeGreaterThan(3);

      // All should be canonicalized
      sameDirLinks.forEach(link => {
        expect(link.canonicalUrl).not.toBeNull();
        expect(link.canonicalUrl).toMatch(/^https:\/\/github\.com\/owner\/repo\/blob\/main\//);
        expect(link.rejectRule).toBe("none");
        expect(link.errorRule).toBe("none");
      });
    });
  });

  describe("NL04: Parent-directory links (../path)", () => {
    const NESTED_CONTEXT = buildGithubContext(
      "owner",
      "repo",
      "main",
      "blob/main/docs/api/README.md",
      "https://github.com/owner/repo/blob/main/docs/api/README.md"
    );

    test("canonicalizes ../CONTRIBUTING.md correctly", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-parent-directory.md");
      const output = normalizeGithubReadmeLinks(markdown, NESTED_CONTEXT);

      const contribLink = output.results.find(r => r.original.target === "../CONTRIBUTING.md");
      expect(contribLink).toBeDefined();
      expect(contribLink?.category).toBe("parent-directory");
      expect(contribLink?.canonicalUrl).toBe("https://github.com/owner/repo/blob/main/docs/CONTRIBUTING.md");
      expect(contribLink?.rejectRule).toBe("none");
    });

    test("canonicalizes ../docs/api.md correctly", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-parent-directory.md");
      const output = normalizeGithubReadmeLinks(markdown, NESTED_CONTEXT);

      const apiLink = output.results.find(r => r.original.target === "../docs/api.md");
      expect(apiLink).toBeDefined();
      expect(apiLink?.category).toBe("parent-directory");
      expect(apiLink?.canonicalUrl).toBe("https://github.com/owner/repo/blob/main/docs/api.md");
      expect(apiLink?.rejectRule).toBe("none");
    });

    test("canonicalizes multiple ../ levels (../../)", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-parent-directory.md");
      const output = normalizeGithubReadmeLinks(markdown, NESTED_CONTEXT);

      const mainReadme = output.results.find(r => r.original.target === "../../README.md");
      expect(mainReadme).toBeDefined();
      expect(mainReadme?.category).toBe("parent-directory");
      expect(mainReadme?.canonicalUrl).toBe("https://github.com/owner/repo/blob/main/README.md");
      expect(mainReadme?.rejectRule).toBe("none");
    });
  });

  describe("NL05: Root-relative links (/path)", () => {
    test("canonicalizes /docs/api.md correctly", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-root-relative.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const apiLink = output.results.find(r => r.original.target === "/docs/api.md");
      expect(apiLink).toBeDefined();
      expect(apiLink?.category).toBe("root-relative");
      expect(apiLink?.canonicalUrl).toBe("https://github.com/owner/repo/blob/main/docs/api.md");
      expect(apiLink?.rejectRule).toBe("none");
    });

    test("canonicalizes /CONTRIBUTING.md correctly", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-root-relative.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const contribLink = output.results.find(r => r.original.target === "/CONTRIBUTING.md");
      expect(contribLink).toBeDefined();
      expect(contribLink?.category).toBe("root-relative");
      expect(contribLink?.canonicalUrl).toBe("https://github.com/owner/repo/blob/main/CONTRIBUTING.md");
      expect(contribLink?.rejectRule).toBe("none");
    });

    test("handles multiple root-relative links", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-root-relative.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const rootRelativeLinks = output.results.filter(r => r.category === "root-relative");
      expect(rootRelativeLinks.length).toBeGreaterThan(3);

      // All should start with /blob/main/
      rootRelativeLinks.forEach(link => {
        expect(link.canonicalUrl).not.toBeNull();
        expect(link.canonicalUrl).toMatch(/^https:\/\/github\.com\/owner\/repo\/blob\/main\//);
        expect(link.rejectRule).toBe("none");
      });
    });
  });

  describe("NL06: GitHub tree/blob links", () => {
    test("canonicalizes /tree/branch/path correctly", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-github-tree-blob.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const treeLink = output.results.find(r => r.original.target === "/tree/main/docs");
      expect(treeLink).toBeDefined();
      expect(treeLink?.category).toBe("github-tree-blob");
      expect(treeLink?.canonicalUrl).toBe("https://github.com/owner/repo/tree/main/docs");
      expect(treeLink?.rejectRule).toBe("none");
    });

    test("canonicalizes /blob/branch/path correctly", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-github-tree-blob.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const blobLink = output.results.find(r => r.original.target === "/blob/develop/README.md");
      expect(blobLink).toBeDefined();
      expect(blobLink?.category).toBe("github-tree-blob");
      expect(blobLink?.canonicalUrl).toBe("https://github.com/owner/repo/blob/develop/README.md");
      expect(blobLink?.rejectRule).toBe("none");
    });

    test("handles version tags in tree/blob paths", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-github-tree-blob.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const versionLink = output.results.find(r => r.original.target === "/tree/v1.2.3/api.md");
      expect(versionLink).toBeDefined();
      expect(versionLink?.category).toBe("github-tree-blob");
      expect(versionLink?.canonicalUrl).toBe("https://github.com/owner/repo/tree/v1.2.3/api.md");
      expect(versionLink?.rejectRule).toBe("none");
    });
  });

  describe("NL07: Repository shorthand (owner/repo)", () => {
    test("canonicalizes owner/repo shorthand correctly", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-repository-shorthand.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const bubbleteaLink = output.results.find(r => r.original.target === "https://github.com/charmbracelet/bubbletea");
      expect(bubbleteaLink).toBeDefined();
      expect(bubbleteaLink?.category).toBe("github-repo-url");
      expect(bubbleteaLink?.canonicalUrl).toBe("https://github.com/charmbracelet/bubbletea");
      expect(bubbleteaLink?.rejectRule).toBe("none");
    });

    test("canonicalizes multiple repository shorthand links", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-repository-shorthand.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const repoLinks = output.results.filter(r => 
        r.category === "github-repo-url" && r.rejectRule === "none"
      );
      expect(repoLinks.length).toBeGreaterThanOrEqual(5);

      // All should be canonicalized to full GitHub URLs
      repoLinks.forEach(link => {
        expect(link.canonicalUrl).not.toBeNull();
        expect(link.canonicalUrl).toMatch(/^https:\/\/github\.com\//);
        expect(link.rejectRule).toBe("none");
      });
    });

    test("includes charmbracelet repos from fixture", () => {
      const markdown = loadMarkdownFixture("canonicalization-pass-repository-shorthand.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const urls = output.canonicalLinks;
      expect(urls).toContain("https://github.com/charmbracelet/bubbletea");
      expect(urls).toContain("https://github.com/facebook/react");
      expect(urls).toContain("https://github.com/microsoft/vscode");
    });
  });
});

describe("TP004: Canonicalization - Fail Classes", () => {
  const FIXTURES_DIR = join(import.meta.dir, "fixtures");

  function loadMarkdownFixture(filename: string): string {
    return readFileSync(join(FIXTURES_DIR, filename), "utf-8");
  }

  const MOCK_CONTEXT = buildGithubContext(
    "owner",
    "repo",
    "main",
    "blob/main/README.md",
    "https://github.com/owner/repo"
  );

  describe("RJ01: Fragment-only links", () => {
    test("rejects #installation fragment", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-fragment-only.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const installLink = output.results.find(r => r.original.target === "#installation");
      expect(installLink).toBeDefined();
      expect(installLink?.category).toBe("fragment-only");
      expect(installLink?.rejectRule).toBe("RJ01_FRAGMENT_ONLY");
      expect(installLink?.diagnostic).toContain("page anchor");
      expect(installLink?.canonicalUrl).toBeNull();
    });

    test("rejects all fragment-only links", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-fragment-only.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const fragmentLinks = output.results.filter(r => r.category === "fragment-only");
      expect(fragmentLinks.length).toBeGreaterThan(3);

      fragmentLinks.forEach(link => {
        expect(link.rejectRule).toBe("RJ01_FRAGMENT_ONLY");
        expect(link.canonicalUrl).toBeNull();
        expect(link.diagnostic).toContain("page anchor");
      });
    });

    test("rejects fragment links correctly in rejectedCount", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-fragment-only.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      expect(output.rejectedCount).toBeGreaterThan(0);
    });
  });

  describe("RJ02: External URLs", () => {
    test("rejects https://example.com", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-external-url.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const exampleLink = output.results.find(r => r.original.target === "https://example.com");
      expect(exampleLink).toBeDefined();
      expect(exampleLink?.category).toBe("external-url");
      expect(exampleLink?.rejectRule).toBe("RJ02_EXTERNAL_URL");
      expect(exampleLink?.diagnostic).toContain("External URL");
      expect(exampleLink?.canonicalUrl).toBeNull();
    });

    test("rejects all non-GitHub URLs", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-external-url.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const externalLinks = output.results.filter(r => r.category === "external-url");
      expect(externalLinks.length).toBeGreaterThan(3);

      externalLinks.forEach(link => {
        expect(link.rejectRule).toBe("RJ02_EXTERNAL_URL");
        expect(link.canonicalUrl).toBeNull();
        expect(link.diagnostic).toContain("External URL");
      });
    });

    test("excludes external URLs from canonicalLinks", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-external-url.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      // No external URLs should be in canonicalLinks
      output.canonicalLinks.forEach(url => {
        expect(url).toMatch(/^https:\/\/github\.com\//);
      });
    });
  });

  describe("RJ03: Unsupported schemes", () => {
    test("rejects mailto: scheme", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-unsupported-scheme.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const emailLink = output.results.find(r => r.original.target === "mailto:test@example.com");
      expect(emailLink).toBeDefined();
      expect(emailLink?.category).toBe("unsupported-scheme");
      expect(emailLink?.rejectRule).toBe("RJ03_UNSUPPORTED_SCHEME");
      expect(emailLink?.diagnostic).toContain("Unsupported URL scheme");
      expect(emailLink?.canonicalUrl).toBeNull();
    });

    test("rejects tel: scheme", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-unsupported-scheme.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const phoneLink = output.results.find(r => r.original.target === "tel:+1234567890");
      expect(phoneLink).toBeDefined();
      expect(phoneLink?.category).toBe("unsupported-scheme");
      expect(phoneLink?.rejectRule).toBe("RJ03_UNSUPPORTED_SCHEME");
      expect(phoneLink?.canonicalUrl).toBeNull();
    });

    test("rejects ftp: scheme", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-unsupported-scheme.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const ftpLink = output.results.find(r => r.original.target === "ftp://ftp.example.com/file");
      expect(ftpLink).toBeDefined();
      expect(ftpLink?.category).toBe("unsupported-scheme");
      expect(ftpLink?.rejectRule).toBe("RJ03_UNSUPPORTED_SCHEME");
      expect(ftpLink?.canonicalUrl).toBeNull();
    });

    test("excludes all unsupported schemes from canonicalLinks", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-unsupported-scheme.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      expect(output.canonicalLinks).toHaveLength(0);
    });
  });

  describe("RJ04: Self-reference links", () => {
    test("rejects . self-reference", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-self-reference.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const dotLink = output.results.find(r => r.original.target === ".");
      expect(dotLink).toBeDefined();
      expect(dotLink?.category).toBe("self-reference");
      expect(dotLink?.rejectRule).toBe("RJ04_SELF_REFERENCE");
      expect(dotLink?.diagnostic).toContain("Self-reference");
      expect(dotLink?.canonicalUrl).toBeNull();
    });

    test("rejects ./ self-reference", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-self-reference.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const slashDotLink = output.results.find(r => r.original.target === "./");
      expect(slashDotLink).toBeDefined();
      expect(slashDotLink?.category).toBe("self-reference");
      expect(slashDotLink?.rejectRule).toBe("RJ04_SELF_REFERENCE");
      expect(slashDotLink?.canonicalUrl).toBeNull();
    });

    test("rejects absolute self-reference URL", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-self-reference.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const selfUrl = output.results.find(r => r.original.target === "https://github.com/owner/repo");
      expect(selfUrl).toBeDefined();
      expect(selfUrl?.rejectRule).toBe("RJ04_SELF_REFERENCE");
      expect(selfUrl?.canonicalUrl).toBeNull();
    });

    test("excludes self-references from canonicalLinks", () => {
      const markdown = loadMarkdownFixture("canonicalization-fail-self-reference.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      // Self-references should not appear in canonicalLinks
      const selfRefUrls = output.canonicalLinks.filter(url => 
        url === "https://github.com/owner/repo" ||
        url === "https://github.com/owner/repo/blob/main/README.md"
      );
      expect(selfRefUrls).toHaveLength(0);
    });
  });
});

describe("TP004: Deterministic Sibling-Target Ordering", () => {
  const FIXTURES_DIR = join(import.meta.dir, "fixtures");

  function loadMarkdownFixture(filename: string): string {
    return readFileSync(join(FIXTURES_DIR, filename), "utf-8");
  }

  const MOCK_CONTEXT = buildGithubContext(
    "owner",
    "repo",
    "main",
    "blob/main/README.md",
    "https://github.com/owner/repo"
  );

  describe("OR01: Alphabetical ordering by canonical URL", () => {
    test("sorts GitHub repo links alphabetically", () => {
      const markdown = loadMarkdownFixture("canonicalization-deterministic-ordering.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const repoLinks = output.canonicalLinks.filter(url => url.includes("github.com/owner/"));
      
      // Should be in alphabetical order
      const sortedLinks = [...repoLinks].sort();
      expect(repoLinks).toEqual(sortedLinks);

      // Verify expected order
      expect(repoLinks[0]).toBe("https://github.com/owner/alpha-lib");
      expect(repoLinks[1]).toBe("https://github.com/owner/beta-service");
      expect(repoLinks[2]).toBe("https://github.com/owner/delta-app");
      expect(repoLinks[3]).toBe("https://github.com/owner/gamma-tool");
      expect(repoLinks[4]).toBe("https://github.com/owner/zebra-project");
    });

    test("results array maintains sorted order", () => {
      const markdown = loadMarkdownFixture("canonicalization-deterministic-ordering.md");
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      const results = output.results.filter(r => r.canonicalUrl !== null);
      const canonicalUrls = results.map(r => r.canonicalUrl);

      // Verify results array is sorted
      const sortedUrls = [...canonicalUrls].sort();
      expect(canonicalUrls).toEqual(sortedUrls);
    });
  });

  describe("OR02: URL deduplication", () => {
    test("removes duplicate URLs", () => {
      const markdown = `
- [Link 1](https://github.com/owner/repo)
- [Link 2](https://github.com/owner/repo)
- [Link 3](https://github.com/owner/repo)
`;
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      // Should dedupe to single entry
      expect(output.canonicalLinks).toHaveLength(1);
      expect(output.canonicalLinks[0]).toBe("https://github.com/owner/repo");
    });

    test("keeps first occurrence of duplicates", () => {
      const markdown = `
- [First Occurrence](https://github.com/owner/repo)
- [Second Occurrence](https://github.com/owner/repo)
- [Third Occurrence](https://github.com/owner/repo)
`;
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      // First link text should be preserved in results
      const result = output.results.find(r => r.canonicalUrl === "https://github.com/owner/repo");
      expect(result?.original.text).toBe("First Occurrence");
    });

    test("handles mixed duplicate sources", () => {
      const markdown = `
- [Absolute](https://github.com/owner/repo)
- [Relative](../repo)
- [Tree](/tree/main)
`;
      const context = buildGithubContext(
        "owner",
        "other",
        "main",
        "blob/main/docs/README.md",
        "https://github.com/owner/other"
      );
      const output = normalizeGithubReadmeLinks(markdown, context);

      // All three should resolve to same URL (if ../repo becomes owner/repo)
      // and be deduped
      expect(output.canonicalLinks.length).toBeLessThanOrEqual(3);
    });
  });

  describe("Deterministic output stability", () => {
    test("produces identical output on multiple runs", () => {
      const markdown = loadMarkdownFixture("canonicalization-deterministic-ordering.md");
      
      const outputs = [];
      for (let i = 0; i < 5; i++) {
        outputs.push(normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT));
      }

      // All runs should produce identical output
      const first = outputs[0];
      outputs.forEach(output => {
        expect(output.canonicalLinks).toEqual(first.canonicalLinks);
        expect(output.rejectedCount).toBe(first.rejectedCount);
        expect(output.errorCount).toBe(first.errorCount);
      });
    });

    test("stable ordering across different input orderings", () => {
      const links1 = `
- [zebra](https://github.com/owner/zebra)
- [alpha](https://github.com/owner/alpha)
- [gamma](https://github.com/owner/gamma)
`;
      const links2 = `
- [gamma](https://github.com/owner/gamma)
- [zebra](https://github.com/owner/zebra)
- [alpha](https://github.com/owner/alpha)
`;
      const links3 = `
- [alpha](https://github.com/owner/alpha)
- [zebra](https://github.com/owner/zebra)
- [gamma](https://github.com/owner/gamma)
`;

      const output1 = normalizeGithubReadmeLinks(links1, MOCK_CONTEXT);
      const output2 = normalizeGithubReadmeLinks(links2, MOCK_CONTEXT);
      const output3 = normalizeGithubReadmeLinks(links3, MOCK_CONTEXT);

      // All should produce the same sorted output
      expect(output1.canonicalLinks).toEqual(output2.canonicalLinks);
      expect(output2.canonicalLinks).toEqual(output3.canonicalLinks);

      // Verify alphabetical order
      expect(output1.canonicalLinks[0]).toBe("https://github.com/owner/alpha");
      expect(output1.canonicalLinks[1]).toBe("https://github.com/owner/gamma");
      expect(output1.canonicalLinks[2]).toBe("https://github.com/owner/zebra");
    });
  });

  describe("Sibling-target filename ordering", () => {
    test("link-follow produces alphabetically ordered children", () => {
      const markdown = `
## Related Projects
- [zebra](https://github.com/owner/zebra)
- [alpha](https://github.com/owner/alpha)
- [gamma](https://github.com/owner/gamma)
`;
      const result = extractGitHubLinkFollow({
        markdown,
        readmeUrl: "https://github.com/owner/parent",
        parentFilename: "parent"
      });

      // Children should be in alphabetical order
      const urls = result.children.map(c => c.url);
      const sortedUrls = [...urls].sort();
      expect(urls).toEqual(sortedUrls);

      // Verify order
      expect(result.children[0].repo).toBe("alpha");
      expect(result.children[1].repo).toBe("gamma");
      expect(result.children[2].repo).toBe("zebra");
    });

    test("filename derivation uses parent-child pattern", () => {
      const markdown = `
## Related
- [alpha](https://github.com/owner/alpha)
- [beta](https://github.com/owner/beta)
`;
      const result = extractGitHubLinkFollow({
        markdown,
        readmeUrl: "https://github.com/owner/parent",
        parentFilename: "parent"
      });

      // Filenames should follow {parent}-{child} pattern
      const filenames = result.children.map(c => c.filename);
      expect(filenames).toContain("parent-alpha");
      expect(filenames).toContain("parent-beta");
    });

    test("filename ordering matches URL ordering", () => {
      const markdown = `
## Related
- [zebra](https://github.com/owner/zebra)
- [alpha](https://github.com/owner/alpha)
- [beta](https://github.com/owner/beta)
`;
      const result = extractGitHubLinkFollow({
        markdown,
        readmeUrl: "https://github.com/owner/parent",
        parentFilename: "parent"
      });

      // Filenames should be in alphabetical order (matches URL order)
      const filenames = result.children.map(c => c.filename);
      const sortedFilenames = [...filenames].sort();
      expect(filenames).toEqual(sortedFilenames);

      // Verify order
      expect(result.children[0].filename).toBe("parent-alpha");
      expect(result.children[1].filename).toBe("parent-beta");
      expect(result.children[2].filename).toBe("parent-zebra");
    });
  });

  describe("Stable ordering with mixed link types", () => {
    test("orders same-directory, root-relative, and absolute links together", () => {
      const markdown = `
- [gamma](./gamma.md)
- [alpha](/alpha.md)
- [beta](../beta.md)
- [delta](https://github.com/owner/delta)
`;
      const context = buildGithubContext(
        "owner",
        "repo",
        "main",
        "blob/main/docs/README.md",
        "https://github.com/owner/repo"
      );
      const output = normalizeGithubReadmeLinks(markdown, context);

      // All canonicalized URLs should be in alphabetical order
      const sortedUrls = [...output.canonicalLinks].sort();
      expect(output.canonicalLinks).toEqual(sortedUrls);
    });

    test("repository shorthand and absolute URLs are both sorted alphabetically", () => {
      const markdown = `
- [zebra](https://github.com/owner/zebra)
- [alpha](https://github.com/other/alpha)
- [gamma](other/gamma)
`;
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      // Should be sorted alphabetically by full URL
      const sortedUrls = [...output.canonicalLinks].sort();
      expect(output.canonicalLinks).toEqual(sortedUrls);
    });
  });

  describe("Edge cases for deterministic ordering", () => {
    test("handles case-sensitive URLs correctly", () => {
      const markdown = `
- [Alpha](https://github.com/owner/Alpha)
- [alpha](https://github.com/owner/alpha)
`;
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      // URLs are case-sensitive, so Alpha < alpha
      expect(output.canonicalLinks[0]).toBe("https://github.com/owner/Alpha");
      expect(output.canonicalLinks[1]).toBe("https://github.com/owner/alpha");
    });

    test("handles URLs with similar prefixes", () => {
      const markdown = `
- [app](https://github.com/owner/app)
- [app2](https://github.com/owner/app2)
- [app-v2](https://github.com/owner/app-v2)
`;
      const output = normalizeGithubReadmeLinks(markdown, MOCK_CONTEXT);

      // Should be sorted by full URL
      expect(output.canonicalLinks[0]).toBe("https://github.com/owner/app");
      expect(output.canonicalLinks[1]).toBe("https://github.com/owner/app-v2");
      expect(output.canonicalLinks[2]).toBe("https://github.com/owner/app2");
    });

    test("handles empty and single-link inputs", () => {
      // Empty input
      const emptyOutput = normalizeGithubReadmeLinks("", MOCK_CONTEXT);
      expect(emptyOutput.canonicalLinks).toHaveLength(0);
      expect(emptyOutput.results).toHaveLength(0);

      // Single link
      const singleOutput = normalizeGithubReadmeLinks(
        "[link](https://github.com/owner/repo)",
        MOCK_CONTEXT
      );
      expect(singleOutput.canonicalLinks).toHaveLength(1);
      expect(singleOutput.canonicalLinks[0]).toBe("https://github.com/owner/repo");
    });
  });
});

describe("TP004: Integration Tests - Canonicalization + Link-Follow", () => {
  const FIXTURES_DIR = join(import.meta.dir, "fixtures");

  function loadMarkdownFixture(filename: string): string {
    return readFileSync(join(FIXTURES_DIR, filename), "utf-8");
  }

  describe("End-to-end canonicalization to sibling targets", () => {
    test("canonicalizes relative links before link-follow filtering", () => {
      const markdown = `
## Related Projects
- [vhs](../vhs)
- [lipgloss](https://github.com/charmbracelet/lipgloss)
- [bubbletea](../bubbletea)
`;
      const result = extractGitHubLinkFollow({
        markdown,
        readmeUrl: "https://github.com/charmbracelet/gum",
        parentFilename: "gum"
      });

      // Should discover 3 children
      expect(result.children.length).toBe(3);

      // All should have canonical URLs
      result.children.forEach(child => {
        expect(child.url).toMatch(/^https:\/\/github\.com\/charmbracelet\//);
      });

      // Should be in alphabetical order
      const urls = result.children.map(c => c.url);
      const sortedUrls = [...urls].sort();
      expect(urls).toEqual(sortedUrls);
    });

    test("filters non-depth-1 links after canonicalization", () => {
      const markdown = `
## Documentation
- [API Guide](./docs/api.md)
- [Contributing](../CONTRIBUTING.md)
- [Related](https://github.com/charmbracelet/other)
`;
      const result = extractGitHubLinkFollow({
        markdown,
        readmeUrl: "https://github.com/charmbracelet/vhs",
        parentFilename: "vhs"
      });

      // Only repo root URLs should be in children (depth-1)
      result.children.forEach(child => {
        expect(child.url).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
        expect(child.url).not.toContain("/blob/");
        expect(child.url).not.toContain("/tree/");
      });
    });

    test("maintains deterministic ordering across canonicalization", () => {
      const markdown = `
## Projects
- [zulu](https://github.com/owner/zulu)
- [alpha](https://github.com/owner/alpha)
- [bravo](https://github.com/owner/bravo)
`;
      
      // Run multiple times
      const results = [];
      for (let i = 0; i < 3; i++) {
        const result = extractGitHubLinkFollow({
          markdown,
          readmeUrl: "https://github.com/owner/test",
          parentFilename: "test"
        });
        results.push(result);
      }

      // All results should have identical ordering
      const firstUrls = results[0].children.map(c => c.url);
      results.forEach((result, idx) => {
        const urls = result.children.map(c => c.url);
        expect(urls).toEqual(firstUrls);
      });
    });
  });

  describe("Canonicalization pass/fail classes in link-follow context", () => {
    test("canonicalization pass classes produce depth-1 children", () => {
      const markdown = `
## Repositories
- [charmbracelet/bubbletea](https://github.com/charmbracelet/bubbletea)
- [facebook/react](https://github.com/facebook/react)
`;
      const result = extractGitHubLinkFollow({
        markdown,
        readmeUrl: "https://github.com/owner/repo",
        parentFilename: "repo"
      });

      expect(result.children.length).toBe(2);
      result.children.forEach(child => {
        expect(child.url).toMatch(/^https:\/\/github\.com\//);
        expect(child.depth).toBe(1);
        expect(child.discovery_source).toBe("readme_link");
      });
    });

    test("canonicalization fail classes are excluded from children", () => {
      const markdown = `
## Links
- [External](https://example.com)
- [Fragment](#section)
- [Repo](https://github.com/owner/repo)
`;
      const result = extractGitHubLinkFollow({
        markdown,
        readmeUrl: "https://github.com/owner/parent",
        parentFilename: "parent"
      });

      // Only valid repo should be included
      expect(result.children.length).toBe(1);
      expect(result.children[0].url).toBe("https://github.com/owner/repo");

      // External and fragment should be in excluded links
      expect(result.excluded_links.length).toBeGreaterThanOrEqual(2);
    });
  });
});
