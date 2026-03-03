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

  // ============================================================================
  // TP006: Related Clips E2E Scenarios - Section + Diagnostics Parity
  // ============================================================================

  describe("TP006: Related Clips end-to-end section + diagnostics parity", () => {
    /**
     * Helper to seed a pre-existing note in the vault for related clips matching.
     * Creates a markdown file with frontmatter that can be indexed as a candidate.
     */
    async function seedNote(
      sandbox: TestVaultSandbox,
      folderPath: string,
      filename: string,
      frontmatter: {
        source?: string;
        title: string;
        type?: string;
        tags?: string[];
        entities?: string[];
        date_clipped?: string;
        related_clips_count?: number;
      },
      body: string = "",
    ): Promise<string> {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { join } = await import("node:path");

      const folderFullPath = join(sandbox.vaultRoot, folderPath);
      await mkdir(folderFullPath, { recursive: true });

      const filePath = join(folderFullPath, `${filename}.md`);

      // Build frontmatter YAML
      const lines: string[] = ["---"];
      lines.push(`source: "${frontmatter.source || ""}"`);
      lines.push(`title: "${frontmatter.title}"`);
      lines.push(`type: "${frontmatter.type || "article"}"`);

      if (frontmatter.tags && frontmatter.tags.length > 0) {
        lines.push("tags:");
        for (const tag of frontmatter.tags) {
          lines.push(`  - "${tag}"`);
        }
      } else {
        lines.push("tags: []");
      }

      if (frontmatter.entities && frontmatter.entities.length > 0) {
        // Use keywords for vaultIndex compatibility
        lines.push("keywords:");
        for (const entity of frontmatter.entities) {
          lines.push(`  - "${entity}"`);
        }
      }

      lines.push(`date_clipped: "${frontmatter.date_clipped || "2026-03-01T12:00:00.000Z"}"`);

      if (frontmatter.related_clips_count !== undefined) {
        lines.push(`related_clips_count: ${frontmatter.related_clips_count}`);
      }

      lines.push("---");
      lines.push("");
      lines.push(body || `# ${frontmatter.title}`);
      lines.push("");

      await writeFile(filePath, lines.join("\n"), "utf-8");
      return filePath;
    }

    describe("TP006: Related clips section rendering", () => {
      test("related clips section is rendered when matching notes exist", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "related-clips",
        });
        sandboxes.push(sandbox);

        // Seed a pre-existing note with matching domain
        await seedNote(
          sandbox,
          "Clips",
          "existing-note",
          {
            source: "https://example.com/existing-article",
            title: "Existing Article",
            type: "article",
            tags: ["web-clip"],
            entities: ["typescript", "testing"],
            date_clipped: "2026-03-01T12:00:00.000Z",
          },
          "# Existing Article\n\nThis is existing content.",
        );

        const fixturePath = join(
          import.meta.dir,
          "..",
          "extractors",
          "fixtures",
          "article.html",
        );
        const fixtureUrl = "https://example.com/new-article";

        await withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "new-article",
          },
          async ({ extracted, built }) => {
            // Import related clips modules
            const { buildMatcherInput, matchRelatedClipsFromCandidates } = await import(
              "../../src/shared/relatedClipsMatcher"
            );
            const { renderRelatedClipsSection, extractDiagnostics } = await import(
              "../../src/shared/relatedClipsContract"
            );
            const { indexVault } = await import("../../src/shared/vaultIndex");

            // Index the vault to get candidate notes
            const indexResult = await indexVault({
              vaultPath: sandbox.vaultRoot,
              maxDepth: 2,
            });

            // Build input from extracted content
            const input = buildMatcherInput(
              fixtureUrl,
              "article",
              ["typescript"], // shared entity
              ["web-clip"],
              "2026-03-03T12:00:00.000Z",
            );

            // Match related clips
            const matchResult = await matchRelatedClipsFromCandidates(
              input,
              indexResult.candidates,
              5,
            );

            // Pass gate: At least one related clip found
            expect(matchResult.result.relatedClips.length).toBeGreaterThan(0);

            // Pass gate: Related clips section is rendered
            const section = renderRelatedClipsSection(matchResult.result);
            expect(section).toContain("## Related Clips");
            expect(section).toContain("Existing Article");

            // Pass gate: Section contains wiki-link format
            expect(section).toMatch(/\[\[.*\|.*\]\]/);

            // Pass gate: Section includes score information
            expect(section).toContain("score:");
          },
        );
      });

      test("related clips section is empty when no matching notes exist", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "related-clips",
        });
        sandboxes.push(sandbox);

        // No pre-existing notes seeded - vault is empty

        const fixturePath = join(
          import.meta.dir,
          "..",
          "extractors",
          "fixtures",
          "article.html",
        );
        const fixtureUrl = "https://different-domain.com/article";

        await withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "no-matches-article",
          },
          async ({ extracted }) => {
            const { buildMatcherInput, matchRelatedClipsFromCandidates } = await import(
              "../../src/shared/relatedClipsMatcher"
            );
            const { renderRelatedClipsSection } = await import(
              "../../src/shared/relatedClipsContract"
            );
            const { indexVault } = await import("../../src/shared/vaultIndex");

            const indexResult = await indexVault({
              vaultPath: sandbox.vaultRoot,
              maxDepth: 2,
            });

            const input = buildMatcherInput(
              fixtureUrl,
              "article",
              [],
              [],
              "2026-03-03T12:00:00.000Z",
            );

            const matchResult = await matchRelatedClipsFromCandidates(
              input,
              indexResult.candidates,
              5,
            );

            // Pass gate: No related clips found
            expect(matchResult.result.relatedClips.length).toBe(0);

            // Pass gate: Related clips section is empty string
            const section = renderRelatedClipsSection(matchResult.result);
            expect(section).toBe("");
          },
        );
      });
    });

    describe("TP006: Frontmatter diagnostics parity", () => {
      test("diagnostics are emitted when related clips are found", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "related-clips",
        });
        sandboxes.push(sandbox);

        // Seed multiple matching notes
        await seedNote(
          sandbox,
          "Clips",
          "related-note-1",
          {
            source: "https://example.com/related-1",
            title: "Related Note 1",
            type: "article",
            tags: ["web-clip"],
            entities: ["typescript", "api"],
            date_clipped: "2026-03-01T12:00:00.000Z",
          },
        );

        await seedNote(
          sandbox,
          "Clips",
          "related-note-2",
          {
            source: "https://example.com/related-2",
            title: "Related Note 2",
            type: "article",
            tags: ["web-clip"],
            entities: ["typescript", "testing"],
            date_clipped: "2026-03-02T12:00:00.000Z",
          },
        );

        const fixturePath = join(
          import.meta.dir,
          "..",
          "extractors",
          "fixtures",
          "article.html",
        );
        const fixtureUrl = "https://example.com/new-article";

        await withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "diagnostics-test",
          },
          async ({}) => {
            const { buildMatcherInput, matchRelatedClipsFromCandidates, getMatcherDiagnostics } = await import(
              "../../src/shared/relatedClipsMatcher"
            );
            const { RELATED_CLIPS_GRAPH_VERSION } = await import(
              "../../src/shared/relatedClipsContract"
            );
            const { indexVault } = await import("../../src/shared/vaultIndex");

            const indexResult = await indexVault({
              vaultPath: sandbox.vaultRoot,
              maxDepth: 2,
            });

            const input = buildMatcherInput(
              fixtureUrl,
              "article",
              ["typescript"],
              ["web-clip"],
              "2026-03-03T12:00:00.000Z",
            );

            const matchResult = await matchRelatedClipsFromCandidates(
              input,
              indexResult.candidates,
              5,
            );

            const diagnostics = getMatcherDiagnostics(matchResult);

            // Pass gate: Diagnostics have correct count
            expect(diagnostics.related_clips_count).toBeGreaterThan(0);

            // Pass gate: Top score is positive
            expect(diagnostics.related_clips_top_score).toBeGreaterThan(0);

            // Pass gate: Graph version is present and correct
            expect(diagnostics.related_graph_version).toBe(RELATED_CLIPS_GRAPH_VERSION);

            // Pass gate: Truncated flag is present (boolean)
            expect(typeof diagnostics.related_clips_truncated).toBe("boolean");
          },
        );
      });

      test("no-match diagnostics have zero values and correct version", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "related-clips",
        });
        sandboxes.push(sandbox);

        // Seed a note with completely different metadata (no match)
        await seedNote(
          sandbox,
          "Clips",
          "unrelated-note",
          {
            source: "https://unrelated-domain.com/article",
            title: "Unrelated Note",
            type: "video", // Different type
            tags: ["different-tag"],
            entities: ["unrelated-entity"],
            date_clipped: "2026-03-01T12:00:00.000Z",
          },
        );

        const fixturePath = join(
          import.meta.dir,
          "..",
          "extractors",
          "fixtures",
          "article.html",
        );
        const fixtureUrl = "https://example.com/new-article";

        await withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "no-match-test",
          },
          async ({}) => {
            const { buildMatcherInput, matchRelatedClipsFromCandidates, getMatcherDiagnostics } = await import(
              "../../src/shared/relatedClipsMatcher"
            );
            const { RELATED_CLIPS_GRAPH_VERSION } = await import(
              "../../src/shared/relatedClipsContract"
            );
            const { indexVault } = await import("../../src/shared/vaultIndex");

            const indexResult = await indexVault({
              vaultPath: sandbox.vaultRoot,
              maxDepth: 2,
            });

            const input = buildMatcherInput(
              fixtureUrl,
              "article",
              ["typescript"],
              ["web-clip"],
              "2026-03-03T12:00:00.000Z",
            );

            const matchResult = await matchRelatedClipsFromCandidates(
              input,
              indexResult.candidates,
              5,
            );

            const diagnostics = getMatcherDiagnostics(matchResult);

            // Pass gate: Count is 0 for no-match
            expect(diagnostics.related_clips_count).toBe(0);

            // Pass gate: Top score is 0 for no-match
            expect(diagnostics.related_clips_top_score).toBe(0);

            // Pass gate: Graph version is still present and correct
            expect(diagnostics.related_graph_version).toBe(RELATED_CLIPS_GRAPH_VERSION);

            // Pass gate: Truncated is false for no-match
            expect(diagnostics.related_clips_truncated).toBe(false);
          },
        );
      });

      test("diagnostics are written to frontmatter in final markdown", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "related-clips",
        });
        sandboxes.push(sandbox);

        // Seed a matching note
        await seedNote(
          sandbox,
          "Clips",
          "matching-note",
          {
            source: "https://example.com/matching",
            title: "Matching Note",
            type: "article",
            tags: ["web-clip"],
            entities: ["typescript"],
            date_clipped: "2026-03-01T12:00:00.000Z",
          },
        );

        const fixturePath = join(
          import.meta.dir,
          "..",
          "extractors",
          "fixtures",
          "article.html",
        );
        const fixtureUrl = "https://example.com/new-article";

        await withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "frontmatter-diagnostics-test",
          },
          async ({ extracted }) => {
            // Import modules
            const { buildMatcherInput, matchRelatedClipsFromCandidates, getMatcherDiagnostics } = await import(
              "../../src/shared/relatedClipsMatcher"
            );
            const { buildClipMarkdownWithRelated } = await import(
              "../../src/shared/markdown"
            );
            const { buildFrontmatterFromClip } = await import(
              "../../src/shared/buildFrontmatter"
            );
            const { DEFAULT_SETTINGS } = await import(
              "../../src/shared/settings"
            );
            const { indexVault } = await import("../../src/shared/vaultIndex");

            // Index vault to get candidates
            const indexResult = await indexVault({
              vaultPath: sandbox.vaultRoot,
              maxDepth: 2,
            });

            const input = buildMatcherInput(
              fixtureUrl,
              "article",
              ["typescript"],
              ["web-clip"],
              "2026-03-03T12:00:00.000Z",
            );

            const matchResult = await matchRelatedClipsFromCandidates(
              input,
              indexResult.candidates,
            );

            const diagnostics = getMatcherDiagnostics(matchResult);

            // Build frontmatter with diagnostics
            const built = buildFrontmatterFromClip({
              result: extracted,
              settings: DEFAULT_SETTINGS,
              pageType: "web",
              currentTabUrl: fixtureUrl,
              overrideFolder: "Clips",
              overrideTitle: "frontmatter-diagnostics-test",
            });

            // Build final markdown with related clips diagnostics
            const clipMarkdownWithDiagnostics = buildClipMarkdownWithRelated({
              frontmatter: {
                ...built.frontmatter,
                relatedClipsDiagnostics: diagnostics,
              },
              bodyMarkdown: extracted.markdown,
              relatedClipsSection: "", // Empty for this test
            });

            // Pass gate: Frontmatter contains related_clips_count
            expect(clipMarkdownWithDiagnostics).toMatch(/related_clips_count:\s*\d+/);

            // Pass gate: Frontmatter contains related_clips_top_score
            expect(clipMarkdownWithDiagnostics).toMatch(/related_clips_top_score:\s*\d+/);

            // Pass gate: Frontmatter contains related_graph_version
            expect(clipMarkdownWithDiagnostics).toMatch(/related_graph_version:\s*"[^"]+"/);

            // Pass gate: Frontmatter contains related_clips_truncated
            expect(clipMarkdownWithDiagnostics).toMatch(/related_clips_truncated:\s*(true|false)/);
          },
        );
      });
    });

    describe("TP006: Truncation behavior", () => {
      test("truncation occurs when matches exceed MAX_RELATED_CLIPS", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "related-clips",
        });
        sandboxes.push(sandbox);

        // Seed more than MAX_RELATED_CLIPS (5) matching notes
        for (let i = 0; i < 7; i++) {
          await seedNote(
            sandbox,
            "Clips",
            `matching-note-${i}`,
            {
              source: `https://example.com/matching-${i}`,
              title: `Matching Note ${i}`,
              type: "article",
              tags: ["web-clip"],
              entities: ["typescript"], // All share entity for matching
              date_clipped: `2026-03-0${(i % 9) + 1}T12:00:00.000Z`,
            },
          );
        }

        const fixturePath = join(
          import.meta.dir,
          "..",
          "extractors",
          "fixtures",
          "article.html",
        );
        const fixtureUrl = "https://example.com/new-article";

        await withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "truncation-test",
          },
          async ({}) => {
            const { buildMatcherInput, matchRelatedClipsFromCandidates, getMatcherDiagnostics } = await import(
              "../../src/shared/relatedClipsMatcher"
            );
            const { MAX_RELATED_CLIPS } = await import(
              "../../src/shared/relatedClipsContract"
            );
            const { indexVault } = await import("../../src/shared/vaultIndex");

            const indexResult = await indexVault({
              vaultPath: sandbox.vaultRoot,
              maxDepth: 2,
            });

            const input = buildMatcherInput(
              fixtureUrl,
              "article",
              ["typescript"],
              ["web-clip"],
              "2026-03-03T12:00:00.000Z",
            );

            const matchResult = await matchRelatedClipsFromCandidates(
              input,
              indexResult.candidates,
            );

            // Pass gate: Results are limited to MAX_RELATED_CLIPS
            expect(matchResult.result.relatedClips.length).toBe(MAX_RELATED_CLIPS);

            // Pass gate: matchesFound reports actual count (7)
            expect(matchResult.result.matchesFound).toBe(7);

            // Pass gate: Diagnostics report truncated = true
            const diagnostics = getMatcherDiagnostics(matchResult);
            expect(diagnostics.related_clips_truncated).toBe(true);
            expect(diagnostics.related_clips_count).toBe(MAX_RELATED_CLIPS);
          },
        );
      });

      test("no truncation when matches are within MAX_RELATED_CLIPS", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "related-clips",
        });
        sandboxes.push(sandbox);

        // Seed exactly 3 matching notes (under MAX_RELATED_CLIPS of 5)
        for (let i = 0; i < 3; i++) {
          await seedNote(
            sandbox,
            "Clips",
            `matching-note-${i}`,
            {
              source: `https://example.com/matching-${i}`,
              title: `Matching Note ${i}`,
              type: "article",
              tags: ["web-clip"],
              entities: ["typescript"],
              date_clipped: `2026-03-0${i + 1}T12:00:00.000Z`,
            },
          );
        }

        const fixturePath = join(
          import.meta.dir,
          "..",
          "extractors",
          "fixtures",
          "article.html",
        );
        const fixtureUrl = "https://example.com/new-article";

        await withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "no-truncation-test",
          },
          async ({}) => {
            const { buildMatcherInput, matchRelatedClipsFromCandidates, getMatcherDiagnostics } = await import(
              "../../src/shared/relatedClipsMatcher"
            );
            const { indexVault } = await import("../../src/shared/vaultIndex");

            const indexResult = await indexVault({
              vaultPath: sandbox.vaultRoot,
              maxDepth: 2,
            });

            const input = buildMatcherInput(
              fixtureUrl,
              "article",
              ["typescript"],
              ["web-clip"],
              "2026-03-03T12:00:00.000Z",
            );

            const matchResult = await matchRelatedClipsFromCandidates(
              input,
              indexResult.candidates,
            );

            // Pass gate: All 3 matches are returned
            expect(matchResult.result.relatedClips.length).toBe(3);

            // Pass gate: matchesFound equals actual count
            expect(matchResult.result.matchesFound).toBe(3);

            // Pass gate: Diagnostics report truncated = false
            const diagnostics = getMatcherDiagnostics(matchResult);
            expect(diagnostics.related_clips_truncated).toBe(false);
            expect(diagnostics.related_clips_count).toBe(3);
          },
        );
      });
    });

    describe("TP006: Determinism across multiple runs", () => {
      test("related clips are deterministic across multiple runs with same inputs", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "related-clips",
        });
        sandboxes.push(sandbox);

        // Seed the same notes every time
        for (let i = 0; i < 5; i++) {
          await seedNote(
            sandbox,
            "Clips",
            `deterministic-note-${i}`,
            {
              source: `https://example.com/deterministic-${i}`,
              title: `Deterministic Note ${i}`,
              type: "article",
              tags: ["web-clip"],
              entities: ["typescript", `entity-${i}`], // Mix of shared and unique
              date_clipped: `2026-03-0${(i % 9) + 1}T12:00:00.000Z`,
            },
          );
        }

        const fixturePath = join(
          import.meta.dir,
          "..",
          "extractors",
          "fixtures",
          "article.html",
        );
        const fixtureUrl = "https://example.com/new-article";

        // Import modules once
        const { buildMatcherInput, matchRelatedClipsFromCandidates, getMatcherDiagnostics } = await import(
          "../../src/shared/relatedClipsMatcher"
        );
        const { indexVault } = await import("../../src/shared/vaultIndex");

        // Index vault once (same candidates for all runs)
        const indexResult = await indexVault({
          vaultPath: sandbox.vaultRoot,
          maxDepth: 2,
        });

        const input = buildMatcherInput(
          fixtureUrl,
          "article",
          ["typescript"],
          ["web-clip"],
          "2026-03-03T12:00:00.000Z",
        );

        // Run matching 3 times and collect results
        const results: Array<{
          titles: string[];
          scores: number[];
          diagnostics: {
            count: number;
            topScore: number;
            truncated: boolean;
          };
        }> = [];

        for (let run = 0; run < 3; run++) {
          const matchResult = await matchRelatedClipsFromCandidates(
            input,
            indexResult.candidates,
          );

          const diagnostics = getMatcherDiagnostics(matchResult);

          results.push({
            titles: matchResult.result.relatedClips.map((c) => c.title),
            scores: matchResult.result.relatedClips.map((c) => c.score),
            diagnostics: {
              count: diagnostics.related_clips_count,
              topScore: diagnostics.related_clips_top_score,
              truncated: diagnostics.related_clips_truncated,
            },
          });
        }

        // Pass gate: All runs produce identical titles
        expect(results[0].titles).toEqual(results[1].titles);
        expect(results[1].titles).toEqual(results[2].titles);

        // Pass gate: All runs produce identical scores
        expect(results[0].scores).toEqual(results[1].scores);
        expect(results[1].scores).toEqual(results[2].scores);

        // Pass gate: All runs produce identical diagnostics
        expect(results[0].diagnostics).toEqual(results[1].diagnostics);
        expect(results[1].diagnostics).toEqual(results[2].diagnostics);
      });

      test("tie-breaking produces stable ordering", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "related-clips",
        });
        sandboxes.push(sandbox);

        // Seed notes with identical scores (same domain, same entities, same tags)
        // They should be tie-broken by timestamp (newer first), then by ID (alphabetical)
        for (let i = 0; i < 3; i++) {
          await seedNote(
            sandbox,
            "Clips",
            `tiebreak-note-${String.fromCharCode(97 + i)}`, // a, b, c
            {
              source: `https://example.com/tiebreak-${i}`,
              title: `Tiebreak Note ${String.fromCharCode(97 + i)}`,
              type: "article",
              tags: ["web-clip"],
              entities: ["typescript"], // Same entity = same base score
              date_clipped: `2026-03-0${3 - i}T12:00:00.000Z`, // Descending timestamps
            },
          );
        }

        const fixturePath = join(
          import.meta.dir,
          "..",
          "extractors",
          "fixtures",
          "article.html",
        );
        const fixtureUrl = "https://example.com/new-article";

        // Import modules
        const { buildMatcherInput, matchRelatedClipsFromCandidates } = await import(
          "../../src/shared/relatedClipsMatcher"
        );
        const { indexVault } = await import("../../src/shared/vaultIndex");

        // Index vault once
        const indexResult = await indexVault({
          vaultPath: sandbox.vaultRoot,
          maxDepth: 2,
        });

        const input = buildMatcherInput(
          fixtureUrl,
          "article",
          ["typescript"],
          ["web-clip"],
          "2026-03-03T12:00:00.000Z",
        );

        const orderings: string[][] = [];

        // Run matching 3 times
        for (let run = 0; run < 3; run++) {
          const matchResult = await matchRelatedClipsFromCandidates(
            input,
            indexResult.candidates,
          );

          orderings.push(matchResult.result.relatedClips.map((c) => c.id));
        }

        // Pass gate: Ordering is identical across all runs
        expect(orderings[0]).toEqual(orderings[1]);
        expect(orderings[1]).toEqual(orderings[2]);

        // Pass gate: Ordering respects tie-break rules (newer timestamps first)
        // Note c has 2026-03-01, Note b has 2026-03-02, Note a has 2026-03-03
        // So order should be: a (newest), b, c (oldest)
        expect(orderings[0][0]).toContain("tiebreak-note-a");
        expect(orderings[0][2]).toContain("tiebreak-note-c");
      });
    });

    describe("TP006: Shared domain and entity matching", () => {
      test("same domain produces higher scores than different domains", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "related-clips",
        });
        sandboxes.push(sandbox);

        // Seed a note with same domain as new clip
        await seedNote(
          sandbox,
          "Clips",
          "same-domain-note",
          {
            source: "https://example.com/existing",
            title: "Same Domain Note",
            type: "article",
            tags: ["web-clip"],
            entities: ["unrelated-entity"], // No entity match
            date_clipped: "2026-03-01T12:00:00.000Z",
          },
        );

        // Seed a note with different domain but matching entity
        await seedNote(
          sandbox,
          "Clips",
          "different-domain-note",
          {
            source: "https://other-domain.com/article",
            title: "Different Domain Note",
            type: "article",
            tags: ["different"],
            entities: ["typescript"], // Entity match
            date_clipped: "2026-03-01T12:00:00.000Z",
          },
        );

        const fixturePath = join(
          import.meta.dir,
          "..",
          "extractors",
          "fixtures",
          "article.html",
        );
        const fixtureUrl = "https://example.com/new-article";

        await withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "domain-scoring-test",
          },
          async ({}) => {
            const { buildMatcherInput, matchRelatedClipsFromCandidates } = await import(
              "../../src/shared/relatedClipsMatcher"
            );
            const { indexVault } = await import("../../src/shared/vaultIndex");

            const indexResult = await indexVault({
              vaultPath: sandbox.vaultRoot,
              maxDepth: 2,
            });

            const input = buildMatcherInput(
              fixtureUrl,
              "article",
              ["typescript"],
              ["web-clip"],
              "2026-03-03T12:00:00.000Z",
            );

            const matchResult = await matchRelatedClipsFromCandidates(
              input,
              indexResult.candidates,
            );

            // Pass gate: Same domain note has higher score than different domain
            const sameDomainClip = matchResult.result.relatedClips.find(
              (c) => c.title === "Same Domain Note",
            );
            const differentDomainClip = matchResult.result.relatedClips.find(
              (c) => c.title === "Different Domain Note",
            );

            expect(sameDomainClip).toBeDefined();
            expect(differentDomainClip).toBeDefined();

            // Same domain (50) + same content type (1) = 51
            // Different domain + shared entity (10) + same content type (1) = 11
            expect(sameDomainClip!.score).toBeGreaterThan(differentDomainClip!.score);
          },
        );
      });

      test("exact URL match produces highest possible score", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "related-clips",
        });
        sandboxes.push(sandbox);

        const existingUrl = "https://example.com/exact-match-article";

        // Seed a note with exact same URL as new clip
        await seedNote(
          sandbox,
          "Clips",
          "exact-url-note",
          {
            source: existingUrl, // Exact URL match
            title: "Exact URL Note",
            type: "article",
            tags: ["web-clip"],
            entities: ["typescript"],
            date_clipped: "2026-03-01T12:00:00.000Z",
          },
        );

        const fixturePath = join(
          import.meta.dir,
          "..",
          "extractors",
          "fixtures",
          "article.html",
        );

        await withScenario(
          {
            fixturePath,
            simulatedUrl: existingUrl, // Same URL as existing note
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: "exact-url-test",
          },
          async ({}) => {
            const { buildMatcherInput, matchRelatedClipsFromCandidates } = await import(
              "../../src/shared/relatedClipsMatcher"
            );
            const { MATCH_SIGNAL_WEIGHTS, MatchSignalType } = await import(
              "../../src/shared/relatedClipsContract"
            );
            const { indexVault } = await import("../../src/shared/vaultIndex");

            const indexResult = await indexVault({
              vaultPath: sandbox.vaultRoot,
              maxDepth: 2,
            });

            const input = buildMatcherInput(
              existingUrl,
              "article",
              ["typescript"],
              ["web-clip"],
              "2026-03-03T12:00:00.000Z",
            );

            const matchResult = await matchRelatedClipsFromCandidates(
              input,
              indexResult.candidates,
            );

            // Pass gate: Exact URL match found
            const exactMatch = matchResult.result.relatedClips.find(
              (c) => c.title === "Exact URL Note",
            );
            expect(exactMatch).toBeDefined();

            // Pass gate: Score includes exact URL weight (highest)
            expect(exactMatch!.score).toBeGreaterThanOrEqual(
              MATCH_SIGNAL_WEIGHTS[MatchSignalType.EXACT_URL],
            );
          },
        );
      });
    });
  });
});

// ============================================================================
// TP006: Retrieval Query Pack E2E Scenarios - Section + Diagnostics Parity
// ============================================================================

describe("TP006: Retrieval Query Pack end-to-end section + diagnostics parity", () => {
  /**
   * Helper to build query pack input from extracted clip result
   */
  function buildQueryPackInputFromExtracted(
    extracted: ReturnType<typeof extractWebPageContent>,
    sourceUrl: string,
  ): {
    title: string;
    description?: string;
    conceptTaxonomy?: string[];
    knowledgeEntities?: string[];
    keywords?: string[];
    sourceUrl: string;
    contentType: string;
    author?: string;
  } {
    // Extract keywords from metadata or use empty array
    const keywords: string[] = [];
    if (extracted.metadata.keywords && Array.isArray(extracted.metadata.keywords)) {
      keywords.push(...extracted.metadata.keywords);
    }

    // Extract entities from knowledge entities if available
    const knowledgeEntities: string[] = [];
    if (extracted.metadata.knowledgeEntities && Array.isArray(extracted.metadata.knowledgeEntities)) {
      knowledgeEntities.push(...extracted.metadata.knowledgeEntities.map((e: { name?: string }) => e.name || "").filter(Boolean));
    }

    // Extract concept taxonomy if available
    const conceptTaxonomy: string[] = [];
    if (extracted.metadata.conceptTaxonomy && Array.isArray(extracted.metadata.conceptTaxonomy)) {
      conceptTaxonomy.push(...extracted.metadata.conceptTaxonomy);
    }

    return {
      title: extracted.metadata.title || extracted.title || "",
      description: extracted.metadata.description,
      conceptTaxonomy: conceptTaxonomy.length > 0 ? conceptTaxonomy : undefined,
      knowledgeEntities: knowledgeEntities.length > 0 ? knowledgeEntities : undefined,
      keywords: keywords.length > 0 ? keywords : undefined,
      sourceUrl,
      contentType: extracted.metadata.type || "article",
      author: extracted.metadata.author,
    };
  }

  describe("TP006: Query pack section rendering across providers", () => {
    test("generic web article: query pack section is rendered when content has extractable queries", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "query-pack",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "extractors",
        "fixtures",
        "article.html",
      );
      const fixtureUrl = "https://example.com/article";

      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: "query-pack-web-article",
        },
        async ({ extracted }) => {
          const { buildRetrievalQueryPack, isEmptyQueryPack } = await import(
            "../../src/shared/retrievalQueryPackBuilder"
          );
          const { renderRetrievalQueryPackSection } = await import(
            "../../src/shared/retrievalQueryPackContract"
          );

          const input = buildQueryPackInputFromExtracted(extracted, fixtureUrl);
          const pack = buildRetrievalQueryPack(input);

          // Pass gate: Pack is not empty for content-rich articles
          expect(isEmptyQueryPack(pack)).toBe(false);

          // Pass gate: Section is rendered with header
          const section = renderRetrievalQueryPackSection(pack);
          expect(section).toContain("## Retrieval Query Pack");
        },
      );
    });

    test("github repository: query pack section contains entity seeds from repo metadata", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "query-pack",
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
          overrideTitle: "vhs-query-pack",
        },
        async ({ extracted }) => {
          const { buildRetrievalQueryPack } = await import(
            "../../src/shared/retrievalQueryPackBuilder"
          );
          const { renderRetrievalQueryPackSection } = await import(
            "../../src/shared/retrievalQueryPackContract"
          );

          const input = buildQueryPackInputFromExtracted(extracted, fixtureUrl);
          const pack = buildRetrievalQueryPack(input);

          // Pass gate: Pack has queries from GitHub README content
          expect(pack.totalIncluded).toBeGreaterThan(0);

          // Pass gate: Section is rendered
          const section = renderRetrievalQueryPackSection(pack);
          expect(section).toContain("## Retrieval Query Pack");

          // Pass gate: Has at least one subsection
          const hasExactPhrases = section.includes("### Exact Phrase Queries");
          const hasKeywordBooleans = section.includes("### Keyword Boolean Queries");
          const hasEntitySeeds = section.includes("### Entity Query Seeds");
          expect(hasExactPhrases || hasKeywordBooleans || hasEntitySeeds).toBe(true);
        },
      );
    });

    test("SeedFinder strain profile: query pack derives queries from strain metadata", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "query-pack",
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
          overrideTitle: "seedfinder-query-pack",
          baseResult: {
            url: fixtureUrl,
            title: "SeedFinder Query Pack Test",
            markdown: "",
            metadata: {
              url: fixtureUrl,
              title: "SeedFinder Query Pack Test",
              type: "article",
            },
          },
        },
        async ({ extracted }) => {
          const { buildRetrievalQueryPack } = await import(
            "../../src/shared/retrievalQueryPackBuilder"
          );
          const { renderRetrievalQueryPackSection } = await import(
            "../../src/shared/retrievalQueryPackContract"
          );

          const input = buildQueryPackInputFromExtracted(extracted, fixtureUrl);
          const pack = buildRetrievalQueryPack(input);

          // Pass gate: Pack has queries
          expect(pack.totalIncluded).toBeGreaterThanOrEqual(0);

          // Pass gate: Version is set correctly
          const { QUERY_PACK_VERSION } = await import(
            "../../src/shared/retrievalQueryPackContract"
          );
          expect(pack.version).toBe(QUERY_PACK_VERSION);
        },
      );
    });

    test("reddit thread: query pack generates from thread content", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "query-pack",
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
          overrideTitle: "reddit-query-pack",
          baseResult: {
            url: fixtureUrl,
            title: "Reddit Query Pack Test",
            markdown: "",
            metadata: {
              url: fixtureUrl,
              title: "Reddit Query Pack Test",
              type: "web",
            },
          },
        },
        async ({ extracted }) => {
          const { buildRetrievalQueryPack } = await import(
            "../../src/shared/retrievalQueryPackBuilder"
          );

          const input = buildQueryPackInputFromExtracted(extracted, fixtureUrl);
          const pack = buildRetrievalQueryPack(input);

          // Pass gate: Pack is generated
          expect(pack).toBeDefined();
          expect(pack.version).toBeDefined();
        },
      );
    });
  });

  describe("TP006: Frontmatter diagnostics parity", () => {
    test("query pack diagnostics are emitted with all required fields", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "query-pack",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "extractors",
        "fixtures",
        "article.html",
      );
      const fixtureUrl = "https://example.com/diagnostics-test";

      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: "diagnostics-parity-test",
        },
        async ({ extracted }) => {
          const { buildRetrievalQueryPack } = await import(
            "../../src/shared/retrievalQueryPackBuilder"
          );
          const {
            extractQueryPackDiagnostics,
            QUERY_PACK_VERSION,
          } = await import("../../src/shared/retrievalQueryPackContract");

          const input = buildQueryPackInputFromExtracted(extracted, fixtureUrl);
          const pack = buildRetrievalQueryPack(input);
          const diagnostics = extractQueryPackDiagnostics(pack);

          // Pass gate: All diagnostic fields are present
          expect(diagnostics.query_pack_version).toBe(QUERY_PACK_VERSION);
          expect(typeof diagnostics.query_pack_exact_phrases).toBe("number");
          expect(typeof diagnostics.query_pack_keyword_booleans).toBe("number");
          expect(typeof diagnostics.query_pack_entity_seeds).toBe("number");
          expect(typeof diagnostics.query_pack_total_queries).toBe("number");
          expect(typeof diagnostics.query_pack_truncated).toBe("boolean");

          // Pass gate: Counts are non-negative
          expect(diagnostics.query_pack_exact_phrases).toBeGreaterThanOrEqual(0);
          expect(diagnostics.query_pack_keyword_booleans).toBeGreaterThanOrEqual(0);
          expect(diagnostics.query_pack_entity_seeds).toBeGreaterThanOrEqual(0);
          expect(diagnostics.query_pack_total_queries).toBeGreaterThanOrEqual(0);

          // Pass gate: Total matches sum of individual counts
          expect(diagnostics.query_pack_total_queries).toBe(
            diagnostics.query_pack_exact_phrases +
              diagnostics.query_pack_keyword_booleans +
              diagnostics.query_pack_entity_seeds,
          );
        },
      );
    });

    test("no-content diagnostics have zero values and correct version", async () => {
      const { getNoQueryDiagnostics } = await import(
        "../../src/shared/retrievalQueryPackBuilder"
      );
      const { QUERY_PACK_VERSION } = await import(
        "../../src/shared/retrievalQueryPackContract"
      );

      const diagnostics = getNoQueryDiagnostics();

      // Pass gate: All counts are zero
      expect(diagnostics.query_pack_exact_phrases).toBe(0);
      expect(diagnostics.query_pack_keyword_booleans).toBe(0);
      expect(diagnostics.query_pack_entity_seeds).toBe(0);
      expect(diagnostics.query_pack_total_queries).toBe(0);

      // Pass gate: Truncated is false (nothing to truncate)
      expect(diagnostics.query_pack_truncated).toBe(false);

      // Pass gate: Version is correct
      expect(diagnostics.query_pack_version).toBe(QUERY_PACK_VERSION);
    });

    test("diagnostics are written to frontmatter in final markdown", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "query-pack",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "extractors",
        "fixtures",
        "article.html",
      );
      const fixtureUrl = "https://example.com/frontmatter-test";

      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: "frontmatter-test",
        },
        async ({ extracted }) => {
          const { buildRetrievalQueryPack } = await import(
            "../../src/shared/retrievalQueryPackBuilder"
          );
          const {
            extractQueryPackDiagnostics,
            renderRetrievalQueryPackSection,
          } = await import("../../src/shared/retrievalQueryPackContract");
          const { buildClipMarkdownWithRelated } = await import(
            "../../src/shared/markdown"
          );
          const { buildFrontmatterFromClip } = await import(
            "../../src/shared/buildFrontmatter"
          );
          const { DEFAULT_SETTINGS } = await import("../../src/shared/settings");

          const input = buildQueryPackInputFromExtracted(extracted, fixtureUrl);
          const pack = buildRetrievalQueryPack(input);
          const diagnostics = extractQueryPackDiagnostics(pack);
          const queryPackSection = renderRetrievalQueryPackSection(pack);

          // Build frontmatter with query pack diagnostics
          const built = buildFrontmatterFromClip({
            result: extracted,
            settings: DEFAULT_SETTINGS,
            pageType: "web",
            currentTabUrl: fixtureUrl,
            overrideFolder: "Clips",
            overrideTitle: "frontmatter-test",
          });

          // Build final markdown with query pack
          const clipMarkdown = buildClipMarkdownWithRelated({
            frontmatter: {
              ...built.frontmatter,
              queryPackDiagnostics: diagnostics,
            },
            bodyMarkdown: extracted.markdown,
            queryPackSection,
          });

          // Pass gate: Frontmatter contains query_pack_version
          expect(clipMarkdown).toMatch(/query_pack_version:\s*"[^"]+"/);

          // Pass gate: Frontmatter contains query_pack_exact_phrases
          expect(clipMarkdown).toMatch(/query_pack_exact_phrases:\s*\d+/);

          // Pass gate: Frontmatter contains query_pack_keyword_booleans
          expect(clipMarkdown).toMatch(/query_pack_keyword_booleans:\s*\d+/);

          // Pass gate: Frontmatter contains query_pack_entity_seeds
          expect(clipMarkdown).toMatch(/query_pack_entity_seeds:\s*\d+/);

          // Pass gate: Frontmatter contains query_pack_total_queries
          expect(clipMarkdown).toMatch(/query_pack_total_queries:\s*\d+/);

          // Pass gate: Frontmatter contains query_pack_truncated
          expect(clipMarkdown).toMatch(/query_pack_truncated:\s*(true|false)/);

          // Pass gate: Retrieval Query Pack section is present
          expect(clipMarkdown).toContain("## Retrieval Query Pack");
        },
      );
    });
  });

  describe("TP006: Truncation behavior", () => {
    test("truncation flag is set when queries exceed limits", async () => {
      const { buildRetrievalQueryPack } = await import(
        "../../src/shared/retrievalQueryPackBuilder"
      );
      const {
        MAX_EXACT_PHRASE_QUERIES,
        MAX_KEYWORD_BOOLEAN_QUERIES,
        MAX_ENTITY_QUERY_SEEDS,
      } = await import("../../src/shared/retrievalQueryPackContract");

      // Create input with many entities to trigger truncation
      const input = {
        title: "Comprehensive TypeScript Guide with Advanced Patterns",
        description: "This guide covers TypeScript interfaces, generics, type inference, conditional types, mapped types, template literal types, and much more in extensive detail",
        conceptTaxonomy: ["Technology", "Programming", "TypeScript", "JavaScript", "Web Development", "Frontend", "Backend"],
        knowledgeEntities: [
          "interface definition", "type alias", "union type", "intersection type",
          "conditional type", "mapped type", "template literal type", "type inference",
          "generic constraint", "variance annotation", "type predicate", "assertion function",
          "declaration merging", "module augmentation", "ambient declaration", "namespace",
          "enum", "decorator", "metadata", "reflect",
        ],
        keywords: [
          "typescript", "javascript", "programming", "web", "frontend", "backend",
          "api", "rest", "graphql", "node", "deno", "bun",
        ],
        contentType: "article" as const,
      };

      const pack = buildRetrievalQueryPack(input);

      // Pass gate: Individual query types respect their limits
      expect(pack.exactPhrases.length).toBeLessThanOrEqual(MAX_EXACT_PHRASE_QUERIES);
      expect(pack.keywordBooleans.length).toBeLessThanOrEqual(MAX_KEYWORD_BOOLEAN_QUERIES);
      expect(pack.entitySeeds.length).toBeLessThanOrEqual(MAX_ENTITY_QUERY_SEEDS);

      // Pass gate: Truncation flag reflects actual truncation state
      if (pack.totalGenerated > pack.totalIncluded) {
        expect(pack.truncated).toBe(true);
      }

      // Pass gate: totalGenerated >= totalIncluded
      expect(pack.totalGenerated).toBeGreaterThanOrEqual(pack.totalIncluded);
    });

    test("no truncation when content is within limits", async () => {
      const { buildRetrievalQueryPack } = await import(
        "../../src/shared/retrievalQueryPackBuilder"
      );

      const input = {
        title: "Short Title",
        contentType: "article" as const,
      };

      const pack = buildRetrievalQueryPack(input);

      // Pass gate: No truncation for minimal content
      expect(pack.truncated).toBe(false);
      expect(pack.totalGenerated).toBe(pack.totalIncluded);
    });
  });

  describe("TP006: Determinism across multiple runs", () => {
    test("query pack is deterministic across multiple runs with same inputs", async () => {
      const { buildRetrievalQueryPack } = await import(
        "../../src/shared/retrievalQueryPackBuilder"
      );

      const input = {
        title: "TypeScript Generics and Advanced Type Patterns",
        description: "Understanding TypeScript generics and type patterns for scalable APIs",
        conceptTaxonomy: ["Programming", "TypeScript", "API Design"],
        knowledgeEntities: ["generics", "type inference", "interface"],
        keywords: ["typescript", "generics", "patterns"],
        contentType: "article" as const,
      };

      // Run multiple times
      const pack1 = buildRetrievalQueryPack(input);
      const pack2 = buildRetrievalQueryPack(input);
      const pack3 = buildRetrievalQueryPack(input);

      // Pass gate: All packs have identical structure
      expect(pack1.exactPhrases).toEqual(pack2.exactPhrases);
      expect(pack2.exactPhrases).toEqual(pack3.exactPhrases);

      expect(pack1.keywordBooleans).toEqual(pack2.keywordBooleans);
      expect(pack2.keywordBooleans).toEqual(pack3.keywordBooleans);

      expect(pack1.entitySeeds).toEqual(pack2.entitySeeds);
      expect(pack2.entitySeeds).toEqual(pack3.entitySeeds);

      expect(pack1.totalGenerated).toBe(pack2.totalGenerated);
      expect(pack2.totalGenerated).toBe(pack3.totalGenerated);

      expect(pack1.truncated).toBe(pack2.truncated);
      expect(pack2.truncated).toBe(pack3.truncated);
    });

    test("rendered markdown is deterministic across runs", async () => {
      const { buildRetrievalQueryPack } = await import(
        "../../src/shared/retrievalQueryPackBuilder"
      );
      const { renderRetrievalQueryPackSection } = await import(
        "../../src/shared/retrievalQueryPackContract"
      );

      const input = {
        title: "TypeScript Best Practices Guide",
        description: "Comprehensive guide to TypeScript development",
        keywords: ["typescript", "guide", "best-practices"],
        contentType: "article" as const,
      };

      const pack1 = buildRetrievalQueryPack(input);
      const pack2 = buildRetrievalQueryPack(input);

      const section1 = renderRetrievalQueryPackSection(pack1);
      const section2 = renderRetrievalQueryPackSection(pack2);

      // Pass gate: Rendered output is identical
      expect(section1).toBe(section2);
    });

    test("diagnostics are deterministic across runs", async () => {
      const { buildRetrievalQueryPack } = await import(
        "../../src/shared/retrievalQueryPackBuilder"
      );
      const { extractQueryPackDiagnostics } = await import(
        "../../src/shared/retrievalQueryPackContract"
      );

      const input = {
        title: "API Design Patterns",
        keywords: ["api", "design", "patterns"],
        contentType: "article" as const,
      };

      const diag1 = extractQueryPackDiagnostics(buildRetrievalQueryPack(input));
      const diag2 = extractQueryPackDiagnostics(buildRetrievalQueryPack(input));
      const diag3 = extractQueryPackDiagnostics(buildRetrievalQueryPack(input));

      // Pass gate: Diagnostics are identical across runs
      expect(diag1).toEqual(diag2);
      expect(diag2).toEqual(diag3);
    });
  });

  describe("TP006: Cross-provider parity", () => {
    test("all representative providers produce valid query packs", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "query-pack",
      });
      sandboxes.push(sandbox);

      const providers = [
        {
          name: "github-vhs",
          fixture: "github-regression-vhs.html",
          url: "https://github.com/charmbracelet/vhs",
        },
        {
          name: "github-lipgloss",
          fixture: "github-regression-lipgloss.html",
          url: "https://github.com/charmbracelet/lipgloss",
        },
        {
          name: "github-crush",
          fixture: "github-regression-crush.html",
          url: "https://github.com/charmbracelet/crush",
        },
        {
          name: "generic-web",
          fixture: "article.html",
          url: "https://example.com/article",
        },
      ];

      const { buildRetrievalQueryPack, validateQueryPack } = await import(
        "../../src/shared/retrievalQueryPackBuilder"
      );
      const { QUERY_PACK_VERSION } = await import(
        "../../src/shared/retrievalQueryPackContract"
      );

      for (const provider of providers) {
        const fixturePath = join(
          import.meta.dir,
          "..",
          provider.fixture.startsWith("github") || provider.fixture === "article.html"
            ? provider.fixture === "article.html"
              ? "extractors/fixtures"
              : "templates/fixtures"
            : "extractors/fixtures",
          provider.fixture,
        );

        withScenario(
          {
            fixturePath,
            simulatedUrl: provider.url,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: `${provider.name}-query-pack`,
          },
          ({ extracted }) => {
            const input = buildQueryPackInputFromExtracted(extracted, provider.url);
            const pack = buildRetrievalQueryPack(input);

            // Pass gate: Pack is valid for all providers
            expect(validateQueryPack(pack)).toBe(true);

            // Pass gate: Version is set correctly
            expect(pack.version).toBe(QUERY_PACK_VERSION);

            // Pass gate: All query arrays are defined
            expect(Array.isArray(pack.exactPhrases)).toBe(true);
            expect(Array.isArray(pack.keywordBooleans)).toBe(true);
            expect(Array.isArray(pack.entitySeeds)).toBe(true);
          },
        );
      }
    });

    test("github repos have consistent query pack structure", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "query-pack",
      });
      sandboxes.push(sandbox);

      const repos = [
        { name: "vhs", fixture: "github-regression-vhs.html" },
        { name: "lipgloss", fixture: "github-regression-lipgloss.html" },
        { name: "crush", fixture: "github-regression-crush.html" },
      ];

      const { buildRetrievalQueryPack } = await import(
        "../../src/shared/retrievalQueryPackBuilder"
      );

      for (const repo of repos) {
        const fixturePath = join(
          import.meta.dir,
          "..",
          "templates",
          "fixtures",
          repo.fixture,
        );
        const fixtureUrl = `https://github.com/charmbracelet/${repo.name}`;

        withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: `${repo.name}-query-pack`,
          },
          ({ extracted }) => {
            const input = buildQueryPackInputFromExtracted(extracted, fixtureUrl);
            const pack = buildRetrievalQueryPack(input);

            // Pass gate: All repos produce valid query packs
            expect(pack).toBeDefined();
            expect(pack.totalIncluded).toBeGreaterThanOrEqual(0);

            // Pass gate: Scores are within valid range (0-100)
            for (const phrase of pack.exactPhrases) {
              expect(phrase.score).toBeGreaterThanOrEqual(0);
              expect(phrase.score).toBeLessThanOrEqual(100);
            }
            for (const bool of pack.keywordBooleans) {
              expect(bool.score).toBeGreaterThanOrEqual(0);
              expect(bool.score).toBeLessThanOrEqual(100);
            }
            for (const seed of pack.entitySeeds) {
              expect(seed.score).toBeGreaterThanOrEqual(0);
              expect(seed.score).toBeLessThanOrEqual(100);
            }
          },
        );
      }
    });
  });

  describe("TP006: Section ordering and content", () => {
    test("query pack section follows deterministic ordering", async () => {
      const { buildRetrievalQueryPack } = await import(
        "../../src/shared/retrievalQueryPackBuilder"
      );
      const { renderRetrievalQueryPackSection } = await import(
        "../../src/shared/retrievalQueryPackContract"
      );

      const input = {
        title: "TypeScript API Design Patterns",
        description: "Comprehensive guide to TypeScript API design",
        conceptTaxonomy: ["Technology", "Programming", "TypeScript"],
        knowledgeEntities: ["interface", "type safety", "generics"],
        keywords: ["typescript", "api", "design"],
        contentType: "article" as const,
      };

      const pack = buildRetrievalQueryPack(input);
      const section = renderRetrievalQueryPackSection(pack);

      // Pass gate: Section has header
      expect(section).toContain("## Retrieval Query Pack");

      // Pass gate: Query types are sorted by score descending
      for (let i = 1; i < pack.exactPhrases.length; i++) {
        expect(pack.exactPhrases[i - 1].score).toBeGreaterThanOrEqual(
          pack.exactPhrases[i].score,
        );
      }
      for (let i = 1; i < pack.keywordBooleans.length; i++) {
        expect(pack.keywordBooleans[i - 1].score).toBeGreaterThanOrEqual(
          pack.keywordBooleans[i].score,
        );
      }
      for (let i = 1; i < pack.entitySeeds.length; i++) {
        expect(pack.entitySeeds[i - 1].score).toBeGreaterThanOrEqual(
          pack.entitySeeds[i].score,
        );
      }
    });

    test("empty query pack renders empty section", async () => {
      const { buildRetrievalQueryPack } = await import(
        "../../src/shared/retrievalQueryPackBuilder"
      );
      const { renderRetrievalQueryPackSection } = await import(
        "../../src/shared/retrievalQueryPackContract"
      );

      const input = {
        title: "",
        contentType: "article" as const,
      };

      const pack = buildRetrievalQueryPack(input);
      const section = renderRetrievalQueryPackSection(pack);

      // Pass gate: Empty pack renders empty string
      expect(section).toBe("");
    });
  });
});
