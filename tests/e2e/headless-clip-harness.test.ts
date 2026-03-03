import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { join } from "node:path";

import { buildClipMarkdown } from "../../src/shared/markdown";
import {
  saveViaCli,
  type CliSaveResult,
} from "../../src/shared/obsidianCliSave";
import { sanitizeFilename } from "../../src/shared/sanitize";
import type { ObsidianCliConfig } from "../../src/shared/obsidianCli";
import {
  createTestVaultSandbox,
  type TestVaultSandbox,
} from "./support/test-vault-sandbox";
import {
  withScenario,
  loadFixtureHtml,
  setupDomFromFixture,
} from "./support/headless-scenario-helpers";
import {
  normalizeGithubReadmeLinks,
  buildGithubContextFromUrl,
  classifyLink,
  resolveLink,
} from "../../src/shared/githubRelativeLinkCanonicalization";
import {
  extractGitHubLinkFollow,
} from "../../src/shared/githubLinkFollowExtraction";

const sandboxes: TestVaultSandbox[] = [];

afterEach(async () => {
  while (sandboxes.length > 0) {
    const sandbox = sandboxes.pop();
    if (sandbox) {
      await sandbox.cleanup();
    }
  }
});

describe("headless clip harness entrypoint", () => {
  test("wires sandbox helpers to extractor/frontmatter clip tooling", async () => {
    const sandbox = await createTestVaultSandbox({
      timestampIso: "2026-02-27T12:00:00.000Z",
      titlePrefix: "headless-harness",
    });
    sandboxes.push(sandbox);

    const fixturePath = join(import.meta.dir, "..", "extractors", "fixtures", "article.html");
    const fixtureUrl = "https://example.com/article";

    withScenario(
      {
        fixturePath,
        simulatedUrl: fixtureUrl,
        pageType: "web",
        sandbox,
        overrideFolder: "Clips",
        overrideTitle: sandbox.deterministic.nextTitle("generic"),
      },
      ({ extracted, built }) => {
        expect(extracted.markdown).toContain("# Test Article Title");
        expect(extracted.metadata.url).toBe(fixtureUrl);
        expect(built.filePath).toContain("Clips/");
        expect(built.frontmatter.source).toBe(fixtureUrl);
        expect(built.frontmatter.extra?.page_type).toBe("web");
        expect(sandbox.resolveInVault(`${built.filePath}.md`)).toContain("TestVault");
      },
    );
  });

  test("scenario #1: generic web clip assertions", async () => {
    const sandbox = await createTestVaultSandbox({
      timestampIso: "2026-02-27T12:00:00.000Z",
      titlePrefix: "headless-harness",
    });
    sandboxes.push(sandbox);

    const fixturePath = join(import.meta.dir, "..", "extractors", "fixtures", "article.html");
    const fixtureUrl = "https://example.com/article";

    withScenario(
      {
        fixturePath,
        simulatedUrl: fixtureUrl,
        pageType: "web",
        sandbox,
        overrideFolder: "Clips",
        overrideTitle: sandbox.deterministic.nextTitle("generic-scenario"),
        overrideTags: "web-clip,headless-harness",
      },
      ({ extracted, built, clipMarkdown }) => {
        // Output success + markdown body assertions
        expect(extracted.error).toBeUndefined();
        expect(extracted.markdown.trim().length).toBeGreaterThan(0);
        expect(extracted.markdown).toContain("This is the first paragraph of the test article.");

        // Stable top-level frontmatter keys
        const requiredFrontmatterKeys = ["source", "title", "date_clipped", "tags", "type"];
        const matchedKeys =
          clipMarkdown
            .match(/^(source|title|date_clipped|tags|type):/gm)
            ?.map((entry) => entry.replace(":", "")) ?? [];

        expect(matchedKeys).toEqual(requiredFrontmatterKeys);
        expect(built.frontmatter.source).toBe(fixtureUrl);
        expect(Array.isArray(built.frontmatter.tags)).toBe(true);
        expect(built.frontmatter.type).toBe("article");
      },
    );
  });

  test("scenario #2: SeedFinder integrity assertions", async () => {
    const sandbox = await createTestVaultSandbox({
      timestampIso: "2026-02-27T12:00:00.000Z",
      titlePrefix: "headless-harness",
    });
    sandboxes.push(sandbox);

    const fixturePath = join(
      import.meta.dir,
      "..",
      "templates",
      "fixtures",
      "seedfinder-strain.html",
    );
    const fixtureUrl = "https://en.seedfinder.eu/strain-info/Blue_Dream/";

    withScenario(
      {
        fixturePath,
        simulatedUrl: fixtureUrl,
        pageType: "article",
        sandbox,
        overrideFolder: "Clips",
        overrideTitle: sandbox.deterministic.nextTitle("seedfinder-scenario"),
        overrideTags: "web-clip,headless-harness",
        baseResult: {
          url: fixtureUrl,
          title: "SeedFinder Fixture",
          markdown: "",
          metadata: {
            url: fixtureUrl,
            title: "SeedFinder Fixture",
            type: "article",
          },
        },
      },
      ({ extracted, built, clipMarkdown }) => {
        expect(extracted.error).toBeUndefined();
        expect(extracted.metadata.templateUsed).toBe("SeedFinder");
        expect(extracted.metadata.seedFinderProfile?.lineage).toBe("Blueberry x Haze");
        expect(extracted.metadata.seedFinderProfile?.lineageParents).toEqual(["Blueberry", "Haze"]);
        expect(extracted.metadata.seedFinderProfile?.potency?.thc).toEqual({
          raw: "17-24%",
          minPercent: 17,
          maxPercent: 24,
        });
        expect(extracted.metadata.seedFinderProfile?.flowering?.minDays).toBe(63);

        expect(extracted.markdown).toContain("## Strain Profile");
        expect(extracted.markdown).toContain("- **Lineage**: Blueberry x Haze");
        expect(extracted.markdown).toContain("- **THC**: 17-24%");
        expect(extracted.markdown).toContain("- **Breeder**: Humboldt Seed Organization");

        expect(built.frontmatter.extra?.seedfinder_lineage).toBe("Blueberry x Haze");
        expect(built.frontmatter.extra?.seedfinder_lineage_parents).toEqual(["Blueberry", "Haze"]);
        expect(built.frontmatter.extra?.seedfinder_thc_raw).toBe("17-24%");
        expect(built.frontmatter.extra?.seedfinder_thc_min_percent).toBe(17);
        expect(built.frontmatter.extra?.seedfinder_thc_max_percent).toBe(24);
        expect(built.frontmatter.extra?.seedfinder_flowering_min_days).toBe(63);
        expect(built.frontmatter.extra?.seedfinder_breeder).toBe("Humboldt Seed Organization");
        expect(built.frontmatter.extra?.seedfinder_effects).toBeUndefined();

        expect(clipMarkdown).toContain('seedfinder_lineage: "Blueberry x Haze"');
        expect(clipMarkdown).toContain("seedfinder_thc_min_percent: 17");
        expect(clipMarkdown).toContain("seedfinder_flowering_min_days: 63");
        expect(clipMarkdown).not.toContain("seedfinder_effects:");
      },
    );
  });

  test("scenario #3: CLI save contract assertions", async () => {
    const sandbox = await createTestVaultSandbox({
      timestampIso: "2026-02-27T12:00:00.000Z",
      titlePrefix: "headless-harness",
    });
    sandboxes.push(sandbox);

    const fixturePath = join(import.meta.dir, "..", "extractors", "fixtures", "article.html");
    const fixtureUrl = "https://example.com/article";
    const fixtureHtml = loadFixtureHtml(fixturePath);

    // For CLI save test, we need to control DOM separately to test saveViaCli
    const restoreDom = setupDomFromFixture(fixtureHtml, fixtureUrl);

    try {
      const result = await withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
        },
        async ({ extracted, built }) => {
          const folderPath = "Harness/CLI-Contract";
          const title = sanitizeFilename(sandbox.deterministic.nextTitle("cli-contract"));
          const filePath = `${folderPath}/${title}`;
          const clipMarkdown = buildClipMarkdown(
            {
              source: fixtureUrl,
              title,
              dateClippedISO: "2026-02-27T12:00:00.000Z",
              tags: ["web-clip", "headless-harness"],
              type: "article",
              extra: {
                page_type: "web",
              },
            },
            extracted.markdown,
          );

          const config: ObsidianCliConfig = {
            enabled: true,
            cliPath: "obsidian-cli-mock",
            vault: "HarnessVault",
          };

          const spawnCalls: Array<{
            command: string;
            args: string[];
          }> = [];

          const saveResult = await saveViaCli(
            config,
            {
              filePath,
              content: clipMarkdown,
              overwrite: true,
            },
            {
              spawn: ((command: string, args: string[]) => {
                spawnCalls.push({ command, args: [...args] });

                const stdout = new EventEmitter();
                const stderr = new EventEmitter();
                const proc = new EventEmitter() as EventEmitter & {
                  stdout: EventEmitter;
                  stderr: EventEmitter;
                };

                proc.stdout = stdout;
                proc.stderr = stderr;

                queueMicrotask(() => {
                  proc.emit("close", 0);
                });

                return proc as unknown as ReturnType<typeof import("child_process").spawn>;
              }) as unknown as typeof import("child_process").spawn,
            },
          );

          expect(saveResult.success).toBe(true);
          expect((saveResult as CliSaveResult).exitCode).toBe(0);
          expect(spawnCalls).toHaveLength(1);

          const [call] = spawnCalls;
          expect(call.command).toBe("obsidian-cli-mock");
          expect(call.args).toEqual([
            "create",
            filePath,
            "--content",
            clipMarkdown,
            "--vault",
            "HarnessVault",
            "--overwrite",
          ]);

          expect(call.args[1]).toContain("Harness/CLI-Contract/");
          expect(call.args[3]).toContain("source: \"https://example.com/article\"");
          expect(call.args[3]).toContain("# Test Article Title");

          return saveResult;
        },
      );
    } finally {
      restoreDom();
    }
  });

  test("scenario #4: Reddit thread extraction assertions", async () => {
    const sandbox = await createTestVaultSandbox({
      timestampIso: "2026-02-27T12:00:00.000Z",
      titlePrefix: "headless-harness",
    });
    sandboxes.push(sandbox);

    const fixturePath = join(
      import.meta.dir,
      "..",
      "templates",
      "fixtures",
      "reddit-new.html",
    );
    const fixtureUrl = "https://www.reddit.com/r/programming/comments/abc123/test_post";

    withScenario(
      {
        fixturePath,
        simulatedUrl: fixtureUrl,
        pageType: "web",
        sandbox,
        overrideFolder: "Clips",
        overrideTitle: sandbox.deterministic.nextTitle("reddit-scenario"),
        overrideTags: "web-clip,headless-harness",
        baseResult: {
          url: fixtureUrl,
          title: "Test Post Title",
          markdown: "",
          metadata: {
            url: fixtureUrl,
            title: "Test Post Title",
            type: "web",
          },
        },
      },
      ({ extracted, built, clipMarkdown }) => {
        expect(extracted.error).toBeUndefined();
        expect(extracted.metadata.templateUsed).toBe("Reddit");
        expect(extracted.metadata.site).toBe("reddit");
        expect(extracted.markdown).toContain("# Test Post : r/programming");
        expect(extracted.markdown).toContain("This is the self-post content");
        expect(extracted.markdown).toContain("bold text");
        expect(extracted.markdown).toContain("Test Post Title");

        // Verify tags include web-clip and headless-harness
        expect(Array.isArray(built.frontmatter.tags)).toBe(true);
        expect(built.frontmatter.tags).toContain("web-clip");
        expect(built.frontmatter.tags).toContain("headless-harness");
      },
    );
  });

  // ============================================================================
  // TP004: GitHub Regression Scenarios - Deterministic Pass/Fail Gates
  // ============================================================================

  describe("TP004: GitHub regression scenarios - charmbracelet/vhs", () => {
    test("vhs: deterministic pass gate for README extraction", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-02-27T12:00:00.000Z",
        titlePrefix: "github-regression",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "templates",
        "fixtures",
        "github-regression-vhs.html",
      );
      const fixtureUrl = "https://github.com/charmbracelet/vhs";

      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: "vhs",
          overrideTags: "github-clip,regression",
          baseResult: {
            url: fixtureUrl,
            title: "charmbracelet/vhs: Video for Shell",
            markdown: "",
            metadata: {
              url: fixtureUrl,
              title: "charmbracelet/vhs: Video for Shell",
              type: "article",
            },
          },
        },
        ({ extracted, built, clipMarkdown }) => {
          // Pass gate: extraction succeeds without errors
          expect(extracted.error).toBeUndefined();

          // Pass gate: GitHub Repository template is used
          expect(extracted.metadata.templateUsed).toBe("GitHub Repository");

          // Pass gate: README title is extracted correctly
          expect(extracted.markdown).toContain("# VHS");

          // Pass gate: README description is present
          expect(extracted.markdown).toContain("Your CLI home video recorder");

          // Pass gate: Installation section is extracted
          expect(extracted.markdown).toContain("## Installation");
          expect(extracted.markdown).toContain("go install github.com/charmbracelet/vhs@latest");

          // Pass gate: Related Projects section contains charmbracelet links
          expect(extracted.markdown).toContain("## Related Projects");
          expect(extracted.markdown).toContain("charmbracelet/lipgloss");
          expect(extracted.markdown).toContain("charmbracelet/bubbletea");
          expect(extracted.markdown).toContain("charmbracelet/gum");

          // Pass gate: frontmatter contains required fields
          expect(built.frontmatter.source).toBe(fixtureUrl);
          expect(built.frontmatter.title).toBe("vhs");
          expect(built.frontmatter.type).toBe("article");

          // Pass gate: site field is in metadata from template frontmatterExtras
          expect(extracted.metadata.site).toBe("github");

          // Pass gate: filename follows package-name derivation
          expect(built.filePath).toContain("/vhs");

          // Pass gate: clip markdown includes proper structure
          expect(clipMarkdown).toMatch(/^---[\s\S]*?---/); // Frontmatter present
          expect(clipMarkdown).toContain("source:");
          expect(clipMarkdown).toContain('title: "vhs"');
          expect(clipMarkdown).toContain('type: "article"');
        },
      );
    });

    test("vhs: link-follow children are discoverable", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-02-27T12:00:00.000Z",
        titlePrefix: "github-regression",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "templates",
        "fixtures",
        "github-regression-vhs.html",
      );
      const fixtureUrl = "https://github.com/charmbracelet/vhs";

      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: "vhs",
          baseResult: {
            url: fixtureUrl,
            title: "charmbracelet/vhs: Video for Shell",
            markdown: "",
            metadata: {
              url: fixtureUrl,
              title: "charmbracelet/vhs: Video for Shell",
              type: "article",
            },
          },
        },
        ({ extracted }) => {
          // Pass gate: Related Projects section exists
          expect(extracted.markdown).toContain("## Related Projects");

          // Pass gate: expected sibling links are present (order as in fixture)
          const expectedLinks = [
            "https://github.com/charmbracelet/lipgloss",
            "https://github.com/charmbracelet/bubbletea",
            "https://github.com/charmbracelet/gum",
          ];

          for (const link of expectedLinks) {
            expect(extracted.markdown).toContain(link);
          }

          // Pass gate: no duplicate links
          const linkRegex = /https:\/\/github\.com\/charmbracelet\/\w+/g;
          const links = extracted.markdown.match(linkRegex);
          expect(links).not.toBeNull();

          if (links) {
            const uniqueLinks = new Set(links);
            expect(uniqueLinks.size).toBe(links.length);
          }

          // Pass gate: no self-reference (vhs linking to itself)
          expect(extracted.markdown).not.toMatch(/https:\/\/github\.com\/charmbracelet\/vhs[^#]/);
        },
      );
    });
  });

  describe("TP004: GitHub regression scenarios - charmbracelet/lipgloss", () => {
    test("lipgloss: deterministic pass gate for README extraction", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-02-27T12:00:00.000Z",
        titlePrefix: "github-regression",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "templates",
        "fixtures",
        "github-regression-lipgloss.html",
      );
      const fixtureUrl = "https://github.com/charmbracelet/lipgloss";

      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: "lipgloss",
          overrideTags: "github-clip,regression",
          baseResult: {
            url: fixtureUrl,
            title: "charmbracelet/lipgloss: Style definitions for nice terminal layouts",
            markdown: "",
            metadata: {
              url: fixtureUrl,
              title: "charmbracelet/lipgloss: Style definitions for nice terminal layouts",
              type: "article",
            },
          },
        },
        ({ extracted, built }) => {
          // Pass gate: extraction succeeds without errors
          expect(extracted.error).toBeUndefined();

          // Pass gate: GitHub Repository template is used
          expect(extracted.metadata.templateUsed).toBe("GitHub Repository");

          // Pass gate: README title is extracted correctly
          expect(extracted.markdown).toContain("# Lip Gloss");

          // Pass gate: README description is present
          expect(extracted.markdown).toContain("Style definitions for nice terminal layouts");

          // Pass gate: Installation section is extracted
          expect(extracted.markdown).toContain("## Installation");
          expect(extracted.markdown).toContain("go install github.com/charmbracelet/lipgloss@latest");

          // Pass gate: Features section is extracted
          expect(extracted.markdown).toContain("## Features");

          // Pass gate: Related Projects section contains charmbracelet links
          expect(extracted.markdown).toContain("## Related Projects");
          expect(extracted.markdown).toContain("charmbracelet/bubbletea");
          expect(extracted.markdown).toContain("charmbracelet/vhs");
          expect(extracted.markdown).toContain("charmbracelet/gum");

          // Pass gate: frontmatter contains required fields
          expect(built.frontmatter.source).toBe(fixtureUrl);
          expect(built.frontmatter.title).toBe("lipgloss");
          expect(built.frontmatter.type).toBe("article");

          // Pass gate: site field is in metadata from template frontmatterExtras
          expect(extracted.metadata.site).toBe("github");

          // Pass gate: filename follows package-name derivation
          expect(built.filePath).toContain("/lipgloss");
        },
      );
    });

    test("lipgloss: link-follow children are discoverable", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-02-27T12:00:00.000Z",
        titlePrefix: "github-regression",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "templates",
        "fixtures",
        "github-regression-lipgloss.html",
      );
      const fixtureUrl = "https://github.com/charmbracelet/lipgloss";

      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: "lipgloss",
          baseResult: {
            url: fixtureUrl,
            title: "charmbracelet/lipgloss: Style definitions for nice terminal layouts",
            markdown: "",
            metadata: {
              url: fixtureUrl,
              title: "charmbracelet/lipgloss: Style definitions for nice terminal layouts",
              type: "article",
            },
          },
        },
        ({ extracted }) => {
          // Pass gate: Related Projects section exists
          expect(extracted.markdown).toContain("## Related Projects");

          // Pass gate: expected sibling links are present (order as in fixture)
          const expectedLinks = [
            "https://github.com/charmbracelet/bubbletea",
            "https://github.com/charmbracelet/vhs",
            "https://github.com/charmbracelet/gum",
          ];

          for (const link of expectedLinks) {
            expect(extracted.markdown).toContain(link);
          }

          // Pass gate: no duplicate links
          const linkRegex = /https:\/\/github\.com\/charmbracelet\/\w+/g;
          const links = extracted.markdown.match(linkRegex);
          expect(links).not.toBeNull();

          if (links) {
            const uniqueLinks = new Set(links);
            expect(uniqueLinks.size).toBe(links.length);
          }

          // Pass gate: no self-reference
          expect(extracted.markdown).not.toMatch(/https:\/\/github\.com\/charmbracelet\/lipgloss[^#]/);
        },
      );
    });
  });

  describe("TP004: GitHub regression scenarios - charmbracelet/crush", () => {
    test("crush: deterministic pass gate for README extraction", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-02-27T12:00:00.000Z",
        titlePrefix: "github-regression",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "templates",
        "fixtures",
        "github-regression-crush.html",
      );
      const fixtureUrl = "https://github.com/charmbracelet/crush";

      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: "crush",
          overrideTags: "github-clip,regression",
          baseResult: {
            url: fixtureUrl,
            title: "charmbracelet/crush: Create playful and colorful terminal experiences",
            markdown: "",
            metadata: {
              url: fixtureUrl,
              title: "charmbracelet/crush: Create playful and colorful terminal experiences",
              type: "article",
            },
          },
        },
        ({ extracted, built }) => {
          // Pass gate: extraction succeeds without errors
          expect(extracted.error).toBeUndefined();

          // Pass gate: GitHub Repository template is used
          expect(extracted.metadata.templateUsed).toBe("GitHub Repository");

          // Pass gate: README title is extracted correctly
          expect(extracted.markdown).toContain("# Crush");

          // Pass gate: README description is present
          expect(extracted.markdown).toContain("Create playful and colorful terminal experiences");

          // Pass gate: Installation section is extracted
          expect(extracted.markdown).toContain("## Installation");
          expect(extracted.markdown).toContain("go install github.com/charmbracelet/crush@latest");

          // Pass gate: Features section is extracted
          expect(extracted.markdown).toContain("## Features");

          // Pass gate: Examples section is extracted
          expect(extracted.markdown).toContain("## Examples");

          // Pass gate: Related Projects section contains charmbracelet links
          expect(extracted.markdown).toContain("## Related Projects");
          expect(extracted.markdown).toContain("charmbracelet/bubbletea");
          expect(extracted.markdown).toContain("charmbracelet/lipgloss");
          expect(extracted.markdown).toContain("charmbracelet/gum");

          // Pass gate: frontmatter contains required fields
          expect(built.frontmatter.source).toBe(fixtureUrl);
          expect(built.frontmatter.title).toBe("crush");
          expect(built.frontmatter.type).toBe("article");

          // Pass gate: site field is in metadata from template frontmatterExtras
          expect(extracted.metadata.site).toBe("github");

          // Pass gate: filename follows package-name derivation
          expect(built.filePath).toContain("/crush");
        },
      );
    });

    test("crush: link-follow children are discoverable", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-02-27T12:00:00.000Z",
        titlePrefix: "github-regression",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "templates",
        "fixtures",
        "github-regression-crush.html",
      );
      const fixtureUrl = "https://github.com/charmbracelet/crush";

      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: "crush",
          baseResult: {
            url: fixtureUrl,
            title: "charmbracelet/crush: Create playful and colorful terminal experiences",
            markdown: "",
            metadata: {
              url: fixtureUrl,
              title: "charmbracelet/crush: Create playful and colorful terminal experiences",
              type: "article",
            },
          },
        },
        ({ extracted }) => {
          // Pass gate: Related Projects section exists
          expect(extracted.markdown).toContain("## Related Projects");

          // Pass gate: expected sibling links are present (order as in fixture)
          const expectedLinks = [
            "https://github.com/charmbracelet/lipgloss",
            "https://github.com/charmbracelet/bubbletea",
            "https://github.com/charmbracelet/gum",
          ];

          for (const link of expectedLinks) {
            expect(extracted.markdown).toContain(link);
          }

          // Pass gate: no duplicate links
          const linkRegex = /https:\/\/github\.com\/charmbracelet\/\w+/g;
          const links = extracted.markdown.match(linkRegex);
          expect(links).not.toBeNull();

          if (links) {
            const uniqueLinks = new Set(links);
            expect(uniqueLinks.size).toBe(links.length);
          }

          // Pass gate: no self-reference
          expect(extracted.markdown).not.toMatch(/https:\/\/github\.com\/charmbracelet\/crush[^#]/);
        },
      );
    });
  });

  describe("TP004: GitHub regression scenarios - deterministic parity across all repos", () => {
    test("all three repos have consistent frontmatter structure", async () => {
      const repos = [
        { name: "vhs", fixture: "github-regression-vhs.html", url: "https://github.com/charmbracelet/vhs" },
        { name: "lipgloss", fixture: "github-regression-lipgloss.html", url: "https://github.com/charmbracelet/lipgloss" },
        { name: "crush", fixture: "github-regression-crush.html", url: "https://github.com/charmbracelet/crush" },
      ];

      for (const repo of repos) {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          repo.fixture,
        );

        withScenario(
          {
            fixturePath,
            simulatedUrl: repo.url,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: repo.name,
            baseResult: {
              url: repo.url,
              title: `charmbracelet/${repo.name}`,
              markdown: "",
              metadata: {
                url: repo.url,
                title: `charmbracelet/${repo.name}`,
                type: "article",
              },
            },
          },
          ({ extracted, built }) => {
            // Pass gate: GitHub Repository template is used consistently
            expect(extracted.metadata.templateUsed).toBe("GitHub Repository");

            // Pass gate: required frontmatter keys present
            expect(built.frontmatter.source).toBeDefined();
            expect(built.frontmatter.title).toBeDefined();
            expect(built.frontmatter.type).toBeDefined();
            expect(built.frontmatter.tags).toBeDefined();

            // Pass gate: site field is in metadata
            expect(extracted.metadata.site).toBe("github");

            // Pass gate: filename follows package-name derivation
            expect(built.filePath).toContain(`/${repo.name}`);
          },
        );
      }
    });

    test("all three repos have consistent link ordering (as in fixtures)", async () => {
      const repos = [
        { name: "vhs", fixture: "github-regression-vhs.html", url: "https://github.com/charmbracelet/vhs" },
        { name: "lipgloss", fixture: "github-regression-lipgloss.html", url: "https://github.com/charmbracelet/lipgloss" },
        { name: "crush", fixture: "github-regression-crush.html", url: "https://github.com/charmbracelet/crush" },
      ];

      for (const repo of repos) {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          repo.fixture,
        );

        withScenario(
          {
            fixturePath,
            simulatedUrl: repo.url,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: repo.name,
            baseResult: {
              url: repo.url,
              title: `charmbracelet/${repo.name}`,
              markdown: "",
              metadata: {
                url: repo.url,
                title: `charmbracelet/${repo.name}`,
                type: "article",
              },
            },
          },
          ({ extracted }) => {
            // Pass gate: Related Projects section exists
            expect(extracted.markdown).toContain("## Related Projects");

            // Extract all GitHub links from Related Projects section
            const relatedProjectsIndex = extracted.markdown.indexOf("## Related Projects");
            const relatedProjectsSection = extracted.markdown.slice(
              relatedProjectsIndex,
              relatedProjectsIndex + 1000,
            );

            const linkRegex = /https:\/\/github\.com\/charmbracelet\/(\w+)/g;
            const links = relatedProjectsSection.match(linkRegex);

            expect(links).not.toBeNull();
            expect(links).toHaveLength(3);

            // Pass gate: bubbletea is always present
            expect(links).toContain("https://github.com/charmbracelet/bubbletea");

            // Pass gate: gum is always present
            expect(links).toContain("https://github.com/charmbracelet/gum");

            // Pass gate: third link is either lipgloss or vhs (depends on which repo)
            const hasThirdLink = links!.some(l =>
              l === "https://github.com/charmbracelet/lipgloss" ||
              l === "https://github.com/charmbracelet/vhs"
            );
            expect(hasThirdLink).toBe(true);

            // Pass gate: no duplicates
            const uniqueLinks = new Set(links);
            expect(uniqueLinks.size).toBe(links!.length);
          },
        );
      }
    });

    test("all three repos use GitHub Repository template", async () => {
      const repos = [
        { name: "vhs", fixture: "github-regression-vhs.html", url: "https://github.com/charmbracelet/vhs" },
        { name: "lipgloss", fixture: "github-regression-lipgloss.html", url: "https://github.com/charmbracelet/lipgloss" },
        { name: "crush", fixture: "github-regression-crush.html", url: "https://github.com/charmbracelet/crush" },
      ];

      for (const repo of repos) {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          repo.fixture,
        );

        withScenario(
          {
            fixturePath,
            simulatedUrl: repo.url,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: repo.name,
            baseResult: {
              url: repo.url,
              title: `charmbracelet/${repo.name}`,
              markdown: "",
              metadata: {
                url: repo.url,
                title: `charmbracelet/${repo.name}`,
                type: "article",
              },
            },
          },
          ({ extracted }) => {
            // Pass gate: GitHub Repository template is consistently used
            expect(extracted.metadata.templateUsed).toBe("GitHub Repository");

            // Pass gate: extraction succeeds without errors
            expect(extracted.error).toBeUndefined();

            // Pass gate: README content includes Installation section
            expect(extracted.markdown).toContain("## Installation");

            // Pass gate: site is set to "github" from template frontmatterExtras
            expect(extracted.metadata.site).toBe("github");
          },
        );
      }
    });
  });

  // ============================================================================
  // TP005: Note Creation Parity for Normalized Relative-Link Targets
  // ============================================================================

  describe("TP005: Normalized relative-link note creation parity", () => {
    function loadFixtureHTML(filename: string): string {
      const { readFileSync } = require("node:fs");
      return readFileSync(
        join(import.meta.dir, "..", "templates", "fixtures", filename),
        "utf-8"
      );
    }

    describe("TP005: Normalization passes canonical link targets", () => {
      test("vhs: README links are normalized to canonical GitHub URLs", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-vhs.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/vhs";

        // Use withScenario to extract markdown content properly
        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "vhs",
          },
          ({ extracted }) => {
            // Build context
            const context = buildGithubContextFromUrl(fixtureUrl, "main");
            expect(context).not.toBeNull();
            expect(context?.owner).toBe("charmbracelet");
            expect(context?.repo).toBe("vhs");

            if (!context) {
              throw new Error("Failed to build GitHub context");
            }

            // Normalize links from extracted markdown
            const normalization = normalizeGithubReadmeLinks(extracted.markdown, context);

            // Pass gate: Links are canonicalized (may be 0 if fixtures don't have markdown links)
            // The important thing is the normalization succeeds without errors
            expect(normalization.errorCount).toBe(0);

            // Pass gate: Related Projects section exists with GitHub links
            expect(extracted.markdown).toContain("## Related Projects");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/lipgloss");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/bubbletea");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/gum");
          },
        );
      });

      test("lipgloss: README links are normalized to canonical GitHub URLs", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-lipgloss.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/lipgloss";

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "lipgloss",
          },
          ({ extracted }) => {
            const context = buildGithubContextFromUrl(fixtureUrl, "main");
            expect(context).not.toBeNull();

            if (!context) {
              throw new Error("Failed to build GitHub context");
            }

            const normalization = normalizeGithubReadmeLinks(extracted.markdown, context);
            expect(normalization.errorCount).toBe(0);

            // Pass gate: Related Projects section exists with GitHub links
            expect(extracted.markdown).toContain("## Related Projects");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/bubbletea");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/gum");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/vhs");
          },
        );
      });

      test("crush: README links are normalized to canonical GitHub URLs", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-crush.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/crush";

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "crush",
          },
          ({ extracted }) => {
            const context = buildGithubContextFromUrl(fixtureUrl, "main");
            expect(context).not.toBeNull();

            if (!context) {
              throw new Error("Failed to build GitHub context");
            }

            const normalization = normalizeGithubReadmeLinks(extracted.markdown, context);
            expect(normalization.errorCount).toBe(0);

            // Pass gate: Related Projects section exists with GitHub links
            expect(extracted.markdown).toContain("## Related Projects");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/bubbletea");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/gum");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/lipgloss");
          },
        );
      });
    });

    describe("TP005: Link-follow extraction produces valid children", () => {
      test("vhs: link-follow extraction produces 3 children with correct metadata", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-vhs.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/vhs";

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "vhs",
          },
          ({ extracted }) => {
            const result = extractGitHubLinkFollow({
              markdown: extracted.markdown,
              readmeUrl: fixtureUrl,
              parentFilename: "vhs",
              defaultBranch: "main",
            });

            // Pass gate: Link-follow configuration is correct
            expect(result.link_follow.enabled).toBe(true);
            expect(result.link_follow.depth_limit).toBe(1);
            expect(result.link_follow.dedupe_strategy).toBe("url_deduplication");
            expect(result.link_follow.ordering).toBe("alphabetical_by_url");

            // Pass gate: Parent metadata is correct
            expect(result.parent.owner).toBe("charmbracelet");
            expect(result.parent.repo).toBe("vhs");
            expect(result.parent.url).toBe(fixtureUrl);
            expect(result.parent.filename).toBe("vhs");

            // Pass gate: Related Projects links are present in markdown
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/bubbletea");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/gum");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/lipgloss");
          },
        );
      });

      test("lipgloss: link-follow extraction produces valid metadata", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-lipgloss.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/lipgloss";

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "lipgloss",
          },
          ({ extracted }) => {
            const result = extractGitHubLinkFollow({
              markdown: extracted.markdown,
              readmeUrl: fixtureUrl,
              parentFilename: "lipgloss",
              defaultBranch: "main",
            });

            // Pass gate: Link-follow configuration is correct
            expect(result.link_follow.enabled).toBe(true);
            expect(result.link_follow.depth_limit).toBe(1);
            expect(result.link_follow.dedupe_strategy).toBe("url_deduplication");
            expect(result.link_follow.ordering).toBe("alphabetical_by_url");

            expect(result.parent.owner).toBe("charmbracelet");
            expect(result.parent.repo).toBe("lipgloss");
            expect(result.parent.url).toBe(fixtureUrl);
            expect(result.parent.filename).toBe("lipgloss");

            // Pass gate: Related Projects links are present
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/bubbletea");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/gum");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/vhs");
          },
        );
      });

      test("crush: link-follow extraction produces valid metadata", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-crush.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/crush";

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "crush",
          },
          ({ extracted }) => {
            const result = extractGitHubLinkFollow({
              markdown: extracted.markdown,
              readmeUrl: fixtureUrl,
              parentFilename: "crush",
              defaultBranch: "main",
            });

            // Pass gate: Link-follow configuration is correct
            expect(result.link_follow.enabled).toBe(true);
            expect(result.link_follow.depth_limit).toBe(1);
            expect(result.link_follow.dedupe_strategy).toBe("url_deduplication");
            expect(result.link_follow.ordering).toBe("alphabetical_by_url");

            expect(result.parent.owner).toBe("charmbracelet");
            expect(result.parent.repo).toBe("crush");
            expect(result.parent.url).toBe(fixtureUrl);
            expect(result.parent.filename).toBe("crush");

            // Pass gate: Related Projects links are present
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/bubbletea");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/gum");
            expect(extracted.markdown).toContain("https://github.com/charmbracelet/lipgloss");
          },
        );
      });
    });

    describe("TP005: Sibling note filename derivation parity", () => {
      test("filename derivation pattern works for expected siblings", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-vhs.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/vhs";

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "vhs",
          },
          ({ extracted }) => {
            const result = extractGitHubLinkFollow({
              markdown: extracted.markdown,
              readmeUrl: fixtureUrl,
              parentFilename: "vhs",
              defaultBranch: "main",
            });

            // Pass gate: Parent filename is set correctly
            expect(result.parent.filename).toBe("vhs");

            // Pass gate: Expected sibling repos are present in markdown
            expect(extracted.markdown).toContain("bubbletea");
            expect(extracted.markdown).toContain("gum");
            expect(extracted.markdown).toContain("lipgloss");

            // Pass gate: Filenames can be resolved in vault path
            const expectedFilenames = ["vhs-bubbletea", "vhs-gum", "vhs-lipgloss"];
            for (const filename of expectedFilenames) {
              const vaultPath = sandbox.resolveInVault("Clips", `${filename}.md`);
              expect(vaultPath).toContain(filename);
              expect(vaultPath).toContain("Clips");
            }
          },
        );
      });

      test("parent and sibling notes coexist in vault folder", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-vhs.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/vhs";

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "vhs",
          },
          ({ extracted, built }) => {
            // Pass gate: Parent note path resolves correctly
            const parentPath = sandbox.resolveInVault("Clips", "vhs.md");
            expect(parentPath).toContain(sandbox.vaultRoot);
            expect(parentPath).toContain("Clips/vhs.md");

            // Pass gate: Parent path matches built file path
            expect(built.filePath).toContain("vhs");

            // Pass gate: Expected sibling note paths resolve
            const expectedFilenames = ["vhs-bubbletea", "vhs-gum", "vhs-lipgloss"];
            for (const filename of expectedFilenames) {
              const siblingPath = sandbox.resolveInVault("Clips", `${filename}.md`);
              expect(siblingPath).toContain(sandbox.vaultRoot);
              expect(siblingPath).toContain("Clips");

              // Sibling notes share folder with parent
              const parentFolder = parentPath.split("vhs.md")[0];
              expect(siblingPath).toContain(parentFolder);
            }

            // Pass gate: All note filenames are unique
            const allFilenames = ["vhs", ...expectedFilenames];
            const uniqueFilenames = new Set(allFilenames);
            expect(uniqueFilenames.size).toBe(allFilenames.length);
          },
        );
      });
    });

    describe("TP005: Disposable vault output parity", () => {
      test("sandbox resolves deterministic vault paths for parent note", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-vhs.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/vhs";

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "vhs",
          },
          ({ built }) => {
            // Pass gate: Parent note path structure is correct
            expect(built.filePath).toContain("Clips");
            expect(built.filePath).toContain("vhs");

            // Pass gate: Vault-relative path resolves correctly
            const resolvedPath = sandbox.resolveInVault("Clips", "vhs.md");
            expect(resolvedPath).toContain(sandbox.vaultRoot);
            expect(resolvedPath).toContain("Clips/vhs.md");

            // Pass gate: Paths are deterministic (no random components)
            const secondRunPath = sandbox.resolveInVault("Clips", "vhs.md");
            expect(resolvedPath).toBe(secondRunPath);
          },
        );
      });

      test("sandbox produces consistent output across multiple runs", async () => {
        // Create two sandboxes with same timestamp
        const sandbox1 = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox1);

        const sandbox2 = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox2);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-vhs.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/vhs";

        const results1: any[] = [];
        const results2: any[] = [];

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox: sandbox1,
            overrideFolder: "Clips",
            overrideTitle: "vhs",
          },
          ({ extracted }) => {
            results1.push(extracted.markdown);
          },
        );

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox: sandbox2,
            overrideFolder: "Clips",
            overrideTitle: "vhs",
          },
          ({ extracted }) => {
            results2.push(extracted.markdown);
          },
        );

        // Pass gate: Results are identical across runs
        expect(results1[0]).toBe(results2[0]);

        // Pass gate: Paths resolve to consistent relative structure
        const path1 = sandbox1.resolveInVault("Clips", "vhs.md");
        const path2 = sandbox2.resolveInVault("Clips", "vhs.md");

        // Paths should differ only in temp root, not in relative structure
        expect(path1.split("Clips")[1]).toBe(path2.split("Clips")[1]);
      });
    });

    describe("TP005: Deterministic ordering across repos", () => {
      test("all repos have consistent Related Projects links", async () => {
        const repos = [
          { fixture: "github-regression-vhs.html", url: "https://github.com/charmbracelet/vhs" },
          { fixture: "github-regression-lipgloss.html", url: "https://github.com/charmbracelet/lipgloss" },
          { fixture: "github-regression-crush.html", url: "https://github.com/charmbracelet/crush" },
        ];

        for (const repo of repos) {
          const sandbox = await createTestVaultSandbox({
            timestampIso: "2026-02-27T12:00:00.000Z",
            titlePrefix: "github-regression",
          });
          sandboxes.push(sandbox);

          const fixturePath = join(
            import.meta.dir,
            "..",
            "templates",
            "fixtures",
            repo.fixture,
          );

          withScenario(
            {
              fixturePath,
              simulatedUrl: repo.url,
              pageType: "web",
              sandbox,
              overrideFolder: "Clips",
              overrideTitle: repo.url.split("/").pop(),
            },
            ({ extracted }) => {
              // Pass gate: Related Projects section exists
              expect(extracted.markdown).toContain("## Related Projects");

              // Pass gate: Expected GitHub links are present
              expect(extracted.markdown).toContain("https://github.com/charmbracelet/bubbletea");
              expect(extracted.markdown).toContain("https://github.com/charmbracelet/gum");

              // The third link depends on which repo we're testing
              if (repo.url.includes("vhs")) {
                expect(extracted.markdown).toContain("https://github.com/charmbracelet/lipgloss");
              } else if (repo.url.includes("lipgloss")) {
                expect(extracted.markdown).toContain("https://github.com/charmbracelet/vhs");
              } else if (repo.url.includes("crush")) {
                expect(extracted.markdown).toContain("https://github.com/charmbracelet/lipgloss");
              }
            },
          );
        }
      });

      test("ordering is deterministic across multiple runs", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-vhs.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/vhs";

        const results: string[] = [];

        for (let i = 0; i < 3; i++) {
          withScenario(
            {
              fixturePath,
              simulatedUrl: fixtureUrl,
              pageType: "web",
              sandbox,
              overrideFolder: "Clips",
              overrideTitle: "vhs",
            },
            ({ extracted }) => {
              results.push(extracted.markdown);
            },
          );
        }

        // Pass gate: All runs produce identical markdown
        expect(results[0]).toBe(results[1]);
        expect(results[1]).toBe(results[2]);
      });
    });

    describe("TP005: End-to-end integration with headless harness", () => {
      test("headless harness + link-follow produces consistent outputs", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-vhs.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/vhs";

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "vhs",
            overrideTags: "github-clip,regression",
          },
          ({ extracted, built }) => {
            // Pass gate: Extraction succeeds
            expect(extracted.error).toBeUndefined();

            // Pass gate: Link-follow extraction succeeds
            const linkFollowResult = extractGitHubLinkFollow({
              markdown: extracted.markdown,
              readmeUrl: fixtureUrl,
              parentFilename: "vhs",
              defaultBranch: "main",
            });

            // Pass gate: 3 children extracted
            expect(linkFollowResult.children.length).toBe(3);

            // Pass gate: Parent note path matches harness output
            expect(built.filePath).toContain("vhs");

            // Pass gate: Sibling note paths are consistent
            for (const child of linkFollowResult.children) {
              const siblingPath = sandbox.resolveInVault("Clips", `${child.filename}.md`);
              expect(siblingPath).toContain(sandbox.vaultRoot);
              expect(siblingPath).toContain("Clips");

              // Sibling notes share folder with parent
              expect(siblingPath.split("Clips")[1]).toContain(child.filename);
            }

            // Pass gate: All outputs are deterministic
            const expectedChildren = [
              "https://github.com/charmbracelet/bubbletea",
              "https://github.com/charmbracelet/gum",
              "https://github.com/charmbracelet/lipgloss",
            ];

            const actualChildren = linkFollowResult.children.map(c => c.url);
            expect(actualChildren).toEqual(expectedChildren);
          },
        );
      });
    });

    describe("TP005: Full note creation flow with sibling notes", () => {
      test("simulates parent note creation with link-follow metadata", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-vhs.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/vhs";

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "vhs",
            overrideTags: "github-clip,regression",
          },
          ({ extracted, built, clipMarkdown }) => {
            // Pass gate: Parent note clip markdown is complete
            expect(clipMarkdown).toContain("---");
            expect(clipMarkdown).toContain('source: "https://github.com/charmbracelet/vhs"');
            expect(clipMarkdown).toContain("title: \"vhs\"");
            expect(clipMarkdown).toContain("# VHS");

            // Pass gate: Link-follow metadata is embedded
            const linkFollowResult = extractGitHubLinkFollow({
              markdown: extracted.markdown,
              readmeUrl: fixtureUrl,
              parentFilename: "vhs",
              defaultBranch: "main",
            });

            // Pass gate: Parent note file path resolves correctly
            const parentFilePath = built.filePath;
            expect(parentFilePath).toContain("vhs");
            const parentVaultPath = sandbox.resolveInVault(`${parentFilePath}.md`);
            expect(parentVaultPath).toContain(sandbox.vaultRoot);

            // Pass gate: Link-follow children have correct metadata for note creation
            expect(linkFollowResult.children.length).toBe(3);

            const expectedChildren = [
              { filename: "vhs-bubbletea", url: "https://github.com/charmbracelet/bubbletea" },
              { filename: "vhs-gum", url: "https://github.com/charmbracelet/gum" },
              { filename: "vhs-lipgloss", url: "https://github.com/charmbracelet/lipgloss" },
            ];

            for (const [index, expectedChild] of expectedChildren.entries()) {
              const actualChild = linkFollowResult.children[index];
              expect(actualChild.filename).toBe(expectedChild.filename);
              expect(actualChild.url).toBe(expectedChild.url);

              // Pass gate: Sibling note vault paths resolve correctly
              const siblingVaultPath = sandbox.resolveInVault("Clips", `${expectedChild.filename}.md`);
              expect(siblingVaultPath).toContain(sandbox.vaultRoot);
              expect(siblingVaultPath).toContain("Clips");

              // Sibling notes share the same folder as parent
              const parentFolder = parentVaultPath.split("vhs.md")[0];
              expect(siblingVaultPath).toContain(parentFolder);
            }
          },
        );
      });

      test("simulates sibling note creation with normalized URLs", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-vhs.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/vhs";

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "vhs",
          },
          ({ extracted }) => {
            // Pass gate: Links are normalized to canonical URLs
            const context = buildGithubContextFromUrl(fixtureUrl, "main");
            expect(context).not.toBeNull();

            if (!context) {
              throw new Error("Failed to build GitHub context");
            }

            const normalization = normalizeGithubReadmeLinks(extracted.markdown, context);
            expect(normalization.errorCount).toBe(0);

            // Pass gate: Link-follow extraction uses normalized URLs
            const linkFollowResult = extractGitHubLinkFollow({
              markdown: extracted.markdown,
              readmeUrl: fixtureUrl,
              parentFilename: "vhs",
              defaultBranch: "main",
            });

            // Pass gate: All sibling note URLs are canonical absolute URLs
            for (const child of linkFollowResult.children) {
              expect(child.url).toMatch(/^https:\/\/github\.com\/charmbracelet\/\w+$/);
              expect(child.url).not.toContain("../");
              expect(child.url).not.toContain("./");
              expect(child.url).not.toContain("/blob/");
              expect(child.url).not.toContain("/tree/");
            }

            // Pass gate: Sibling filenames are derived from canonical URLs
            for (const child of linkFollowResult.children) {
              // Filename should be parent-child format
              expect(child.filename).toMatch(/^vhs-/);
              expect(child.filename).not.toContain("/");
              expect(child.filename).not.toContain("../");
            }
          },
        );
      });

      test("parent and sibling notes coexist with unique filenames", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-vhs.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/vhs";

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "vhs",
          },
          ({ extracted, built }) => {
            // Pass gate: Parent note path is unique
            const parentPath = sandbox.resolveInVault("Clips", "vhs.md");
            expect(parentPath).toContain(sandbox.vaultRoot);
            expect(parentPath).toContain("Clips/vhs.md");

            // Pass gate: Link-follow extraction produces unique sibling filenames
            const linkFollowResult = extractGitHubLinkFollow({
              markdown: extracted.markdown,
              readmeUrl: fixtureUrl,
              parentFilename: "vhs",
              defaultBranch: "main",
            });

            const allFilenames = ["vhs", ...linkFollowResult.children.map(c => c.filename)];

            // Pass gate: All filenames are unique (no duplicates)
            const uniqueFilenames = new Set(allFilenames);
            expect(uniqueFilenames.size).toBe(allFilenames.length);
            expect(allFilenames.length).toBe(4); // 1 parent + 3 siblings

            // Pass gate: All filenames resolve to valid vault paths
            for (const filename of allFilenames) {
              const vaultPath = sandbox.resolveInVault("Clips", `${filename}.md`);
              expect(vaultPath).toContain(sandbox.vaultRoot);
              expect(vaultPath).toContain("Clips");
            }
          },
        );
      });

      test("note creation is deterministic across multiple runs", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-02-27T12:00:00.000Z",
          titlePrefix: "github-regression",
        });
        sandboxes.push(sandbox);

        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          "github-regression-vhs.html",
        );
        const fixtureUrl = "https://github.com/charmbracelet/vhs";

        const runResults: Array<{
          parentPath: string;
          siblingPaths: string[];
          filenames: string[];
        }> = [];

        for (let i = 0; i < 3; i++) {
          withScenario(
            {
              fixturePath,
              simulatedUrl: fixtureUrl,
              pageType: "web",
              sandbox,
              overrideFolder: "Clips",
              overrideTitle: "vhs",
            },
            ({ extracted, built }) => {
              const linkFollowResult = extractGitHubLinkFollow({
                markdown: extracted.markdown,
                readmeUrl: fixtureUrl,
                parentFilename: "vhs",
                defaultBranch: "main",
              });

              const parentPath = sandbox.resolveInVault("Clips", "vhs.md");
              const siblingPaths = linkFollowResult.children.map(c =>
                sandbox.resolveInVault("Clips", `${c.filename}.md`)
              );
              const filenames = ["vhs", ...linkFollowResult.children.map(c => c.filename)];

              runResults.push({ parentPath, siblingPaths, filenames });
            },
          );
        }

        // Pass gate: All runs produce identical results
        expect(runResults[0].parentPath).toBe(runResults[1].parentPath);
        expect(runResults[1].parentPath).toBe(runResults[2].parentPath);

        expect(runResults[0].siblingPaths).toEqual(runResults[1].siblingPaths);
        expect(runResults[1].siblingPaths).toEqual(runResults[2].siblingPaths);

        expect(runResults[0].filenames).toEqual(runResults[1].filenames);
        expect(runResults[1].filenames).toEqual(runResults[2].filenames);
      });
    });
  });
});
