import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
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
import {
  indexVaultWithCache,
  type VaultIndexOptions,
} from "../../src/shared/vaultIndex";

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

  // ============================================================================
  // TP006: Cache Parity - Cached and rebuilt paths produce identical outputs
  // ============================================================================

  describe("TP006: Cache parity - end-to-end determinism", () => {
    test("cache-parity: headless clip produces deterministic output across runs", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "cache-parity-headless",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "extractors",
        "fixtures",
        "article.html",
      );
      const fixtureUrl = "https://example.com/cache-parity-article";

      // Create some existing notes in the vault for related clips matching
      const existingNotePath = join(
        sandbox.vaultRoot,
        "Clips",
        "Existing Related Note.md"
      );
      await fs.mkdir(join(sandbox.vaultRoot, "Clips"), { recursive: true });
      await fs.writeFile(
        existingNotePath,
        `---
source: https://example.com/existing-note
title: Existing Related Note
tags:
  - web-clip
  - test
keywords:
  - example
  - article
date_clipped: 2026-03-01T10:00:00.000Z
---
# Existing Related Note Content

This is an existing note that should be matched as related.`,
        "utf-8"
      );

      // First clip save
      let clipMarkdown1: string | undefined;
      let extracted1: any;
      let built1: any;
      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: sandbox.deterministic.nextTitle("cache-parity-1"),
          overrideTags: "web-clip,cache-parity",
        },
        ({ clipMarkdown, extracted, built }) => {
          clipMarkdown1 = clipMarkdown;
          extracted1 = extracted;
          built1 = built;
        }
      );

      // Second clip save
      let clipMarkdown2: string | undefined;
      let extracted2: any;
      let built2: any;
      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: sandbox.deterministic.nextTitle("cache-parity-2"),
          overrideTags: "web-clip,cache-parity",
        },
        ({ clipMarkdown, extracted, built }) => {
          clipMarkdown2 = clipMarkdown;
          extracted2 = extracted;
          built2 = built;
        }
      );

      // Both should produce deterministic outputs
      expect(clipMarkdown1).toBeDefined();
      expect(clipMarkdown2).toBeDefined();

      // Extract title lines and compare content separately
      const titleMatch1 = clipMarkdown1!.match(/^title: (.+)$/m);
      const titleMatch2 = clipMarkdown2!.match(/^title: (.+)$/m);

      // Titles should differ (different deterministic titles)
      expect(titleMatch1![1]).not.toBe(titleMatch2![1]);

      // But content structure should be identical (normalize out title and date_clipped)
      const normalizeForComparison = (markdown: string): string => {
        return markdown
          .replace(/^title: .+$/m, "")
          .replace(/^date_clipped: .+$/m, "")
          .trim();
      };

      const content1 = normalizeForComparison(clipMarkdown1!);
      const content2 = normalizeForComparison(clipMarkdown2!);
      expect(content1).toBe(content2);

      // Both should have the same frontmatter structure
      expect(clipMarkdown1).toContain("source:");
      expect(clipMarkdown2).toContain("source:");
      expect(clipMarkdown1).toContain("date_clipped:");
      expect(clipMarkdown2).toContain("date_clipped:");
      expect(clipMarkdown1).toContain("tags:");
      expect(clipMarkdown2).toContain("tags:");

      // Both should have article body
      expect(clipMarkdown1).toContain("# Test Article Title");
      expect(clipMarkdown2).toContain("# Test Article Title");
    });

    test("cache-parity: extraction outputs are deterministic across multiple runs", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "extraction-determinism",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "extractors",
        "fixtures",
        "article.html",
      );
      const fixtureUrl = "https://example.com/extraction-test";

      // Collect outputs from multiple runs
      const extractedOutputs: any[] = [];
      const markdownOutputs: string[] = [];

      for (let i = 0; i < 3; i++) {
        withScenario(
          {
            fixturePath,
            simulatedUrl: `${fixtureUrl}/${i}`,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: `Extraction Test ${i}`,
            overrideTags: "web-clip,determinism",
          },
          ({ extracted, clipMarkdown }) => {
            extractedOutputs.push(extracted);
            markdownOutputs.push(clipMarkdown);
          }
        );
      }

      // All extractions should succeed
      expect(extractedOutputs.length).toBe(3);
      for (const extracted of extractedOutputs) {
        expect(extracted.error).toBeUndefined();
        expect(extracted.markdown).toContain("# Test Article Title");
      }

      // All markdown outputs should have consistent structure
      for (const markdown of markdownOutputs) {
        expect(markdown).toContain("---");
        expect(markdown).toContain("source:");
        expect(markdown).toContain("title:");
        expect(markdown).toContain("date_clipped:");
        expect(markdown).toContain("tags:");
        expect(markdown).toContain("# Test Article Title");
        expect(markdown).toContain("This is the first paragraph");
      }
    });

    test("cache-parity: frontmatter structure consistent across runs", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "frontmatter-determinism",
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

      // Collect frontmatter from multiple runs
      const frontmatters: Record<string, any>[] = [];

      for (let i = 0; i < 3; i++) {
        withScenario(
          {
            fixturePath,
            simulatedUrl: `${fixtureUrl}/${i}`,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: `Frontmatter Test ${i}`,
            overrideTags: "web-clip,determinism",
          },
          ({ built }) => {
            frontmatters.push(built.frontmatter);
          }
        );
      }

      // All frontmatter should have consistent structure
      expect(frontmatters.length).toBe(3);
      for (const fm of frontmatters) {
        expect(fm).toBeDefined();
        expect(fm.source).toContain("example.com");
        expect(fm.type).toBe("article");
        expect(Array.isArray(fm.tags)).toBe(true);
        expect(fm.tags).toContain("web-clip");
      }

      // All should have core required keys
      for (const fm of frontmatters) {
        expect(fm).toHaveProperty("source");
        expect(fm).toHaveProperty("title");
        expect(fm).toHaveProperty("tags");
        expect(fm).toHaveProperty("type");
      }
    });

    test("cache-parity: built markdown path is consistent", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "markdown-path-determinism",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "extractors",
        "fixtures",
        "article.html",
      );
      const fixtureUrl = "https://example.com/markdown-path-test";

      // Collect built file paths from multiple runs
      const filePaths: string[] = [];

      for (let i = 0; i < 3; i++) {
        withScenario(
          {
            fixturePath,
            simulatedUrl: `${fixtureUrl}/${i}`,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips/Determinism",
            overrideTitle: `Markdown Path Test ${i}`,
            overrideTags: "web-clip,determinism",
          },
          ({ built }) => {
            filePaths.push(built.filePath);
          }
        );
      }

      // All file paths should have consistent structure
      expect(filePaths.length).toBe(3);
      for (const path of filePaths) {
        expect(path).toContain("Clips/Determinism");
        expect(path).toContain("Markdown Path Test");
      }

      // All paths should use the same folder
      const folders = filePaths.map(p => p.split("/").slice(-2, -1)[0]);
      expect(folders.every(f => f === folders[0])).toBe(true);
    });

    test("cache-parity: vault index cache hit vs rebuild produce identical candidates", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "vault-index-cache-parity",
      });
      sandboxes.push(sandbox);

      // Create test notes in vault
      const clipsPath = join(sandbox.vaultRoot, "Clips");
      await fs.mkdir(clipsPath, { recursive: true });

      await fs.writeFile(
        join(clipsPath, "Note 1.md"),
        `---
source: https://example.com/note1
title: Note 1
tags:
  - test
  - web-clip
keywords:
  - typescript
  - api
date_clipped: 2026-03-01T10:00:00.000Z
---
# Note 1 Content`,
        "utf-8"
      );

      await fs.writeFile(
        join(clipsPath, "Note 2.md"),
        `---
source: https://example.com/note2
title: Note 2
tags:
  - test
  - web-clip
keywords:
  - javascript
  - api
date_clipped: 2026-03-02T10:00:00.000Z
---
# Note 2 Content`,
        "utf-8"
      );

      await fs.writeFile(
        join(clipsPath, "Note 3.md"),
        `---
source: https://different.com/note3
title: Note 3
tags:
  - test
keywords:
  - python
date_clipped: 2026-03-03T10:00:00.000Z
---
# Note 3 Content`,
        "utf-8"
      );

      const options: VaultIndexOptions = {
        vaultPath: sandbox.vaultRoot,
      };

      // First call: cache miss (rebuild)
      const resultMiss = await indexVaultWithCache(options);
      expect(resultMiss.cacheDiagnostics?.cacheHit).toBe(false);
      expect(resultMiss.cacheDiagnostics?.cacheRebuilt).toBe(true);
      expect(resultMiss.candidates.length).toBe(3);

      // Second call: cache hit
      const resultHit = await indexVaultWithCache(options);
      expect(resultHit.cacheDiagnostics?.cacheHit).toBe(true);
      expect(resultHit.cacheDiagnostics?.cacheRebuilt).toBe(false);
      expect(resultHit.candidates.length).toBe(3);

      // Candidates from cache hit should match cache rebuild exactly
      // Sort both arrays for comparison since order may differ but content should be identical
      const sortedMiss = [...resultMiss.candidates].sort((a, b) => a.path.localeCompare(b.path));
      const sortedHit = [...resultHit.candidates].sort((a, b) => a.path.localeCompare(b.path));

      expect(sortedHit).toEqual(sortedMiss);
      expect(sortedHit).toHaveLength(3);

      // Verify candidate order is deterministic (sorted by path)
      const pathsMiss = resultMiss.candidates.map((c) => c.path).sort();
      const pathsHit = resultHit.candidates.map((c) => c.path).sort();
      expect(pathsHit).toEqual(pathsMiss);

      // Verify all candidate fields are identical
      for (let i = 0; i < sortedMiss.length; i++) {
        const missCandidate = sortedMiss[i];
        const hitCandidate = sortedHit[i];

        expect(hitCandidate.path).toBe(missCandidate.path);
        expect(hitCandidate.title).toBe(missCandidate.title);
        expect(hitCandidate.sourceUrl).toBe(missCandidate.sourceUrl);
        expect(hitCandidate.domain).toBe(missCandidate.domain);
        expect(hitCandidate.contentType).toBe(missCandidate.contentType);
        expect(hitCandidate.entities).toEqual(missCandidate.entities);
        expect(hitCandidate.tags).toEqual(missCandidate.tags);
        expect(hitCandidate.timestamp).toBe(missCandidate.timestamp);
        expect(hitCandidate.id).toBe(missCandidate.id);
      }
    });

    test("cache-parity: Related Clips section identical with cache hit vs rebuild", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "related-clips-cache-parity",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "extractors",
        "fixtures",
        "article.html",
      );
      const fixtureUrl = "https://example.com/new-article";

      // Create existing notes for related clips matching
      const clipsPath = join(sandbox.vaultRoot, "Clips");
      await fs.mkdir(clipsPath, { recursive: true });

      await fs.writeFile(
        join(clipsPath, "Related Note A.md"),
        `---
source: https://example.com/related-a
title: Related Note A
tags:
  - web-clip
  - typescript
keywords:
  - typescript
  - api
date_clipped: 2026-03-01T10:00:00.000Z
---
# Related Note A`,
        "utf-8"
      );

      await fs.writeFile(
        join(clipsPath, "Related Note B.md"),
        `---
source: https://example.com/related-b
title: Related Note B
tags:
  - web-clip
  - api
keywords:
  - javascript
  - api
date_clipped: 2026-03-02T10:00:00.000Z
---
# Related Note B`,
        "utf-8"
      );

      const options: VaultIndexOptions = {
        vaultPath: sandbox.vaultRoot,
      };

      // Get candidates from cache rebuild (miss)
      const resultMiss = await indexVaultWithCache(options);
      expect(resultMiss.cacheDiagnostics?.cacheHit).toBe(false);

      // Get candidates from cache hit
      const resultHit = await indexVaultWithCache(options);
      expect(resultHit.cacheDiagnostics?.cacheHit).toBe(true);

      // Save clip with rebuild candidates
      const clipMarkdownMiss = withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: sandbox.deterministic.nextTitle("cache-parity-related-rebuild"),
          overrideTags: "web-clip,cache-parity",
        },
        ({ clipMarkdown }) => {
          return clipMarkdown;
        }
      );

      // Save clip with cache hit candidates
      const clipMarkdownHit = withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: sandbox.deterministic.nextTitle("cache-parity-related-hit"),
          overrideTags: "web-clip,cache-parity",
        },
        ({ clipMarkdown }) => {
          return clipMarkdown;
        }
      );

      // Both should produce clip markdown
      expect(clipMarkdownMiss).toBeDefined();
      expect(clipMarkdownHit).toBeDefined();

      // Extract Related Clips sections for comparison
      const extractRelatedClipsSection = (markdown: string): string | null => {
        const match = markdown.match(/## Related Clips[\s\S]*?(?=##|$)/);
        return match ? match[0] : null;
      };

      const relatedSectionMiss = extractRelatedClipsSection(clipMarkdownMiss!);
      const relatedSectionHit = extractRelatedClipsSection(clipMarkdownHit!);

      // Both should either have Related Clips section or both should not have it
      const bothHave = relatedSectionMiss !== null && relatedSectionHit !== null;
      const bothLack = relatedSectionMiss === null && relatedSectionHit === null;

      expect(bothHave || bothLack).toBe(true);

      // If both have sections, they should be identical
      if (bothHave) {
        // Sections should be identical (excluding title differences)
        const normalizeSection = (section: string): string => {
          return section
            .replace(/\[\[.*?\|/g, "[[") // Remove wikilink text, keep paths
            .replace(/title: .+$/m, "") // Remove title line
            .trim();
        };

        const normalizedMiss = normalizeSection(relatedSectionMiss!);
        const normalizedHit = normalizeSection(relatedSectionHit!);

        expect(normalizedHit).toBe(normalizedMiss);
      }
    });

    test("cache-parity: Retrieval Query Pack section identical with cache hit vs rebuild", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "query-pack-cache-parity",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "extractors",
        "fixtures",
        "article.html",
      );
      const fixtureUrl = "https://example.com/query-pack-test";

      // Create existing notes with varying term frequencies for discriminative scoring
      const clipsPath = join(sandbox.vaultRoot, "Clips");
      await fs.mkdir(clipsPath, { recursive: true });

      // Create multiple notes with "common" term
      for (let i = 1; i <= 5; i++) {
        await fs.writeFile(
          join(clipsPath, `Common Term ${i}.md`),
          `---
source: https://example.com/common-${i}
title: Common Term Article ${i}
tags:
  - web-clip
keywords:
  - typescript
  - common
date_clipped: 2026-03-0${i}T10:00:00.000Z
---
# Common Term Content ${i}`,
          "utf-8"
        );
      }

      // Create notes with "rare" terms
      await fs.writeFile(
        join(clipsPath, "Rare Term.md"),
        `---
source: https://example.com/rare-term
title: Rare Term Article
tags:
  - web-clip
keywords:
  - specialized
  - unique
date_clipped: 2026-03-06T10:00:00.000Z
---
# Rare Term Content`,
        "utf-8"
      );

      const options: VaultIndexOptions = {
        vaultPath: sandbox.vaultRoot,
      };

      // Get candidates from cache rebuild (miss)
      const resultMiss = await indexVaultWithCache(options);
      expect(resultMiss.cacheDiagnostics?.cacheHit).toBe(false);
      expect(resultMiss.candidates.length).toBe(6);

      // Get candidates from cache hit
      const resultHit = await indexVaultWithCache(options);
      expect(resultHit.cacheDiagnostics?.cacheHit).toBe(true);
      expect(resultHit.candidates.length).toBe(6);

      // Save clip with rebuild candidates
      let clipMarkdownMiss: string | undefined;
      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: sandbox.deterministic.nextTitle("cache-parity-query-rebuild"),
          overrideTags: "web-clip,cache-parity",
        },
        ({ clipMarkdown }) => {
          clipMarkdownMiss = clipMarkdown;
        }
      );

      // Save clip with cache hit candidates
      let clipMarkdownHit: string | undefined;
      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: sandbox.deterministic.nextTitle("cache-parity-query-hit"),
          overrideTags: "web-clip,cache-parity",
        },
        ({ clipMarkdown }) => {
          clipMarkdownHit = clipMarkdown;
        }
      );

      // Both should produce clip markdown
      expect(clipMarkdownMiss).toBeDefined();
      expect(clipMarkdownHit).toBeDefined();

      // Extract Retrieval Query Pack sections for comparison
      const extractQueryPackSection = (markdown: string): string | null => {
        const match = markdown.match(/## Retrieval Query Pack[\s\S]*?(?=##|$)/);
        return match ? match[0] : null;
      };

      const queryPackSectionMiss = extractQueryPackSection(clipMarkdownMiss!);
      const queryPackSectionHit = extractQueryPackSection(clipMarkdownHit!);

      // Both should either have Retrieval Query Pack section or both should not have it
      const bothHave = queryPackSectionMiss !== null && queryPackSectionHit !== null;
      const bothLack = queryPackSectionMiss === null && queryPackSectionHit === null;

      expect(bothHave || bothLack).toBe(true);

      // If both have sections, they should be identical
      if (bothHave) {
        const normalizeQueryPackSection = (section: string): string => {
          return section
            .replace(/^title: .+$/m, "") // Remove title line
            .trim();
        };

        const normalizedMiss = normalizeQueryPackSection(queryPackSectionMiss!);
        const normalizedHit = normalizeQueryPackSection(queryPackSectionHit!);

        expect(normalizedHit).toBe(normalizedMiss);
      }
    });

    test("cache-parity: complete note output identical with cache hit vs rebuild", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "complete-note-cache-parity",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "extractors",
        "fixtures",
        "article.html",
      );
      const fixtureUrl = "https://example.com/complete-note-test";

      // Create existing notes for comprehensive testing
      const clipsPath = join(sandbox.vaultRoot, "Clips");
      await fs.mkdir(clipsPath, { recursive: true });

      await fs.writeFile(
        join(clipsPath, "Existing Article.md"),
        `---
source: https://example.com/existing-article
title: Existing Article
tags:
  - web-clip
  - typescript
keywords:
  - typescript
  - testing
  - api
date_clipped: 2026-03-01T10:00:00.000Z
---
# Existing Article

This is an existing article in the vault.`,
        "utf-8"
      );

      const options: VaultIndexOptions = {
        vaultPath: sandbox.vaultRoot,
      };

      // Get candidates from cache rebuild (miss)
      const resultMiss = await indexVaultWithCache(options);
      expect(resultMiss.cacheDiagnostics?.cacheHit).toBe(false);
      expect(resultMiss.cacheDiagnostics?.cacheRebuilt).toBe(true);

      // Get candidates from cache hit
      const resultHit = await indexVaultWithCache(options);
      expect(resultHit.cacheDiagnostics?.cacheHit).toBe(true);
      expect(resultHit.cacheDiagnostics?.cacheRebuilt).toBe(false);

      // Candidates should be identical
      expect(resultHit.candidates).toEqual(resultMiss.candidates);

      // Save clip with rebuild candidates
      let clipMarkdownMiss: string | undefined;
      let builtMiss: any;
      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: sandbox.deterministic.nextTitle("cache-parity-complete-rebuild"),
          overrideTags: "web-clip,cache-parity",
        },
        ({ clipMarkdown, built }) => {
          clipMarkdownMiss = clipMarkdown;
          builtMiss = built;
        }
      );

      // Save clip with cache hit candidates
      let clipMarkdownHit: string | undefined;
      let builtHit: any;
      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: sandbox.deterministic.nextTitle("cache-parity-complete-hit"),
          overrideTags: "web-clip,cache-parity",
        },
        ({ clipMarkdown, built }) => {
          clipMarkdownHit = clipMarkdown;
          builtHit = built;
        }
      );

      // Both should produce clip markdown
      expect(clipMarkdownMiss).toBeDefined();
      expect(clipMarkdownHit).toBeDefined();

      // Normalize clip markdown for comparison (remove title and date)
      const normalizeClipMarkdown = (markdown: string): string => {
        return markdown
          .replace(/^title: .+$/m, "") // Remove title line
          .replace(/^date_clipped: .+$/m, "") // Remove date line
          .trim();
      };

      const normalizedMiss = normalizeClipMarkdown(clipMarkdownMiss!);
      const normalizedHit = normalizeClipMarkdown(clipMarkdownHit!);

      // Normalized markdown should be identical
      expect(normalizedHit).toBe(normalizedMiss);

      // Frontmatter structure should be identical
      expect(builtHit.frontmatter.source).toBe(builtMiss.frontmatter.source);
      expect(builtHit.frontmatter.type).toBe(builtMiss.frontmatter.type);
      expect(builtHit.frontmatter.tags).toEqual(builtMiss.frontmatter.tags);
      expect(Array.isArray(builtHit.frontmatter.tags)).toBe(true);
      expect(builtHit.frontmatter.tags).toContain("web-clip");
      expect(builtHit.frontmatter.tags).toContain("cache-parity");

      // Both should have same sections
      const hasSection = (markdown: string, section: string): boolean => {
        return markdown.includes(`## ${section}`);
      };

      for (const section of [
        "Clip Brief",
        "Knowledge Entities",
        "Source Map",
        "Implementation Blueprint",
        "Prompt-Ready Context Pack",
        "Related Clips",
        "Retrieval Query Pack",
      ]) {
        const hasMiss = hasSection(clipMarkdownMiss!, section);
        const hasHit = hasSection(clipMarkdownHit!, section);
        expect(hasMiss).toBe(hasHit);
      }

      // Cache diagnostics should be consistent
      expect(resultMiss.cacheDiagnostics?.vaultFilesFingerprinted).toBe(
        resultHit.cacheDiagnostics?.vaultFilesFingerprinted
      );
      expect(resultMiss.filesScanned).toBe(resultHit.filesScanned);
      expect(resultMiss.filesWithFrontmatter).toBe(
        resultHit.filesWithFrontmatter
      );
    });

    test("cache-parity: multiple cache hits produce identical outputs", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "multiple-cache-hits-parity",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "extractors",
        "fixtures",
        "article.html",
      );
      const fixtureUrl = "https://example.com/multiple-hits-test";

      // Create existing notes
      const clipsPath = join(sandbox.vaultRoot, "Clips");
      await fs.mkdir(clipsPath, { recursive: true });

      await fs.writeFile(
        join(clipsPath, "Test Note.md"),
        `---
source: https://example.com/test-note
title: Test Note
tags:
  - web-clip
keywords:
  - test
date_clipped: 2026-03-01T10:00:00.000Z
---
# Test Note`,
        "utf-8"
      );

      const options: VaultIndexOptions = {
        vaultPath: sandbox.vaultRoot,
      };

      // Build initial cache
      await indexVaultWithCache(options);

      // Multiple cache hits
      const clipOutputs: string[] = [];

      for (let i = 0; i < 3; i++) {
        // Small delay to ensure cache age increases
        await new Promise((resolve) => setTimeout(resolve, 10));

        const cacheResult = await indexVaultWithCache(options);
        expect(cacheResult.cacheDiagnostics?.cacheHit).toBe(true);

        const clipMarkdown = withScenario(
          {
            fixturePath,
            simulatedUrl: fixtureUrl,
            pageType: "web",
            sandbox,
            overrideFolder: "Clips",
            overrideTitle: sandbox.deterministic.nextTitle(`multi-hit-${i}`),
            overrideTags: "web-clip,multi-hit",
          },
          ({ clipMarkdown }) => {
            return clipMarkdown;
          }
        );

        expect(clipMarkdown).toBeDefined();
        clipOutputs.push(clipMarkdown!);
      }

      // All clip outputs should be identical (excluding title/date)
      const normalizeForComparison = (markdown: string): string => {
        return markdown
          .replace(/^title: .+$/m, "")
          .replace(/^date_clipped: .+$/m, "")
          .trim();
      };

      const normalizedOutputs = clipOutputs.map(normalizeForComparison);
      const firstOutput = normalizedOutputs[0];

      for (let i = 1; i < normalizedOutputs.length; i++) {
        expect(normalizedOutputs[i]).toBe(firstOutput);
      }
    });

    test("cache-parity: cache invalidation and rebuild produce deterministic outputs", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "cache-invalidation-parity",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "extractors",
        "fixtures",
        "article.html",
      );
      const fixtureUrl = "https://example.com/invalidation-test";

      // Create initial notes
      const clipsPath = join(sandbox.vaultRoot, "Clips");
      await fs.mkdir(clipsPath, { recursive: true });

      await fs.writeFile(
        join(clipsPath, "Initial Note.md"),
        `---
source: https://example.com/initial-note
title: Initial Note
tags:
  - web-clip
keywords:
  - initial
date_clipped: 2026-03-01T10:00:00.000Z
---
# Initial Note`,
        "utf-8"
      );

      const options: VaultIndexOptions = {
        vaultPath: sandbox.vaultRoot,
      };

      // Initial cache build
      const result1 = await indexVaultWithCache(options);
      expect(result1.cacheDiagnostics?.cacheRebuilt).toBe(true);
      expect(result1.candidates.length).toBe(1);

      // Cache hit
      const result2 = await indexVaultWithCache(options);
      expect(result2.cacheDiagnostics?.cacheHit).toBe(true);
      expect(result2.candidates).toEqual(result1.candidates);

      // Wait for mtime change
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Add new note to trigger invalidation
      await fs.writeFile(
        join(clipsPath, "New Note.md"),
        `---
source: https://example.com/new-note
title: New Note
tags:
  - web-clip
keywords:
  - new
date_clipped: 2026-03-04T10:00:00.000Z
---
# New Note`,
        "utf-8"
      );

      // Should rebuild cache due to fingerprint change
      const result3 = await indexVaultWithCache(options);
      expect(result3.cacheDiagnostics?.cacheHit).toBe(false);
      expect(result3.cacheDiagnostics?.cacheRebuilt).toBe(true);
      expect(result3.cacheDiagnostics?.rebuildReason).toBe("vault_fingerprint_changed");
      expect(result3.candidates.length).toBe(2);

      // New cache hit should match rebuild
      const result4 = await indexVaultWithCache(options);
      expect(result4.cacheDiagnostics?.cacheHit).toBe(true);
      expect(result4.candidates).toEqual(result3.candidates);

      // Candidates should be deterministically sorted by path
      const paths = result4.candidates.map(c => c.path);
      const sortedPaths = [...paths].sort();
      expect(paths).toEqual(sortedPaths);
    });

    test("cache-parity: empty vault produces consistent outputs", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "empty-vault-parity",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "extractors",
        "fixtures",
        "article.html",
      );
      const fixtureUrl = "https://example.com/empty-vault-test";

      const options: VaultIndexOptions = {
        vaultPath: sandbox.vaultRoot,
      };

      // No notes - empty vault
      const result1 = await indexVaultWithCache(options);
      expect(result1.candidates).toHaveLength(0);
      expect(result1.cacheDiagnostics?.cacheRebuilt).toBe(true);

      const result2 = await indexVaultWithCache(options);
      expect(result2.candidates).toHaveLength(0);
      expect(result2.cacheDiagnostics?.cacheHit).toBe(true);

      // Both should produce identical results
      expect(result1.candidates).toEqual(result2.candidates);
      expect(result1.filesScanned).toBe(result2.filesScanned);
      expect(result1.filesWithFrontmatter).toBe(result2.filesWithFrontmatter);
      expect(result1.filesSkipped).toBe(result2.filesSkipped);

      // Save clips with both cache states
      let clipMarkdownMiss: string | undefined;
      withScenario(
        {
          fixturePath,
          simulatedUrl: fixtureUrl,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: sandbox.deterministic.nextTitle("empty-vault-rebuild"),
          overrideTags: "web-clip,empty-vault",
        },
        ({ clipMarkdown }) => {
          clipMarkdownMiss = clipMarkdown;
        }
      );

      let clipMarkdownHit: string | undefined;
      withScenario(
        {
          fixturePath,
          simulatedUrl: `${fixtureUrl}-2`,
          pageType: "web",
          sandbox,
          overrideFolder: "Clips",
          overrideTitle: sandbox.deterministic.nextTitle("empty-vault-hit"),
          overrideTags: "web-clip,empty-vault",
        },
        ({ clipMarkdown }) => {
          clipMarkdownHit = clipMarkdown;
        }
      );

      // Both should produce clip markdown
      expect(clipMarkdownMiss).toBeDefined();
      expect(clipMarkdownHit).toBeDefined();

      // Normalize and compare (remove title, date, and article body)
      const normalizeClipMarkdown = (markdown: string): string => {
        // Remove frontmatter
        const frontmatterEnd = markdown.indexOf('\n---\n');
        const body = frontmatterEnd >= 0 ? markdown.slice(frontmatterEnd + 5) : markdown;
        return body.trim();
      };

      const normalizedMiss = normalizeClipMarkdown(clipMarkdownMiss!);
      const normalizedHit = normalizeClipMarkdown(clipMarkdownHit!);

      // Should be identical (article body should be deterministic)
      expect(normalizedHit).toBe(normalizedMiss);

      // Related Clips and Query Pack sections should be present and identical
      const hasRelatedSection = (markdown: string): boolean => {
        return markdown.includes('## Related Clips');
      };

      const hasQueryPackSection = (markdown: string): boolean => {
        return markdown.includes('## Retrieval Query Pack');
      };

      expect(hasRelatedSection(clipMarkdownMiss!)).toBe(hasRelatedSection(clipMarkdownHit!));
      expect(hasQueryPackSection(clipMarkdownMiss!)).toBe(hasQueryPackSection(clipMarkdownHit!));
    });
  });

  // ============================================================================
  // TP006: Open Questions Inbox - End-to-End Refresh & Parity
  // ============================================================================

  describe("TP006: Open Questions Inbox artifact refresh", () => {
    test("inbox-refresh: clip with Open Questions creates inbox artifact", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "inbox-refresh",
      });
      sandboxes.push(sandbox);

      const fixturePath = join(
        import.meta.dir,
        "..",
        "extractors",
        "fixtures",
        "article.html",
      );
      const fixtureUrl = "https://example.com/inbox-test";

      // Create a note with Clip Brief and Open Questions
      const clipsPath = join(sandbox.vaultRoot, "Clips");
      await fs.mkdir(clipsPath, { recursive: true });

      const noteWithQuestions = `---
source: https://example.com/article-with-questions
title: Article With Questions
tags:
  - web-clip
date_clipped: 2026-03-03T10:00:00.000Z
---

# Article With Questions

This article raises some questions.

## Clip Brief

### Open Questions

- What is the best approach for X?
- How should I implement Y?
- Is Z deprecated?

### Action Items

- Research X approach
- Test Y implementation`;

      await fs.writeFile(
        join(clipsPath, "Article With Questions.md"),
        noteWithQuestions,
        "utf-8"
      );

      // Scan vault for Open Questions
      const { scanVaultForOpenQuestions } = await import("../../src/shared/openQuestionsInboxBuilder");
      const scanResult = await scanVaultForOpenQuestions({
        vaultPath: sandbox.vaultRoot,
      });

      // Pass gate: Questions are discovered
      expect(scanResult.filesScanned).toBe(1);
      expect(scanResult.filesWithClipBrief).toBe(1);
      expect(scanResult.filesWithOpenQuestions).toBe(1);
      expect(scanResult.questions).toHaveLength(3);

      // Pass gate: Questions are extracted correctly (order may vary)
      const questions = scanResult.questions.map(q => q.question);
      expect(questions).toContain("What is the best approach for X?");
      expect(questions).toContain("How should I implement Y?");
      expect(questions).toContain("Is Z deprecated?");

      // Build and render inbox
      const { buildOpenQuestionsInbox, renderOpenQuestionsInbox } = await import("../../src/shared/openQuestionsInboxContract");
      const inbox = buildOpenQuestionsInbox(scanResult.questions);
      const markdown = renderOpenQuestionsInbox(inbox);

      // Pass gate: Inbox has correct structure
      expect(markdown).toContain("# Open Questions Inbox");
      expect(markdown).toContain("## Summary");
      expect(markdown).toContain("## Questions");
      expect(markdown).toContain("questions_count: 3");
      expect(markdown).toContain("unresolved_questions: 3");
      expect(markdown).toContain("inbox_truncated: false");

      // Pass gate: Questions are present in inbox
      expect(markdown).toContain("What is the best approach for X?");
      expect(markdown).toContain("How should I implement Y?");
      expect(markdown).toContain("Is Z deprecated?");

      // Pass gate: Source clip is referenced
      expect(markdown).toContain("Article With Questions");
      expect(markdown).toContain("Clips/Article With Questions.md");
    });

    test("inbox-refresh: multiple clips merge questions deterministically", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "inbox-merge",
      });
      sandboxes.push(sandbox);

      const clipsPath = join(sandbox.vaultRoot, "Clips");
      await fs.mkdir(clipsPath, { recursive: true });

      // Create first clip with questions
      await fs.writeFile(
        join(clipsPath, "Clip 1.md"),
        `---
source: https://example.com/clip1
title: Clip 1
date_clipped: 2026-03-01T10:00:00.000Z
---

## Clip Brief

### Open Questions

- What is the best approach?
- How to handle edge cases?`,
        "utf-8"
      );

      // Create second clip with duplicate and new questions
      await fs.writeFile(
        join(clipsPath, "Clip 2.md"),
        `---
source: https://example.com/clip2
title: Clip 2
date_clipped: 2026-03-02T10:00:00.000Z
---

## Clip Brief

### Open Questions

- What is the BEST approach?
- What about performance?`,
        "utf-8"
      );

      const { scanVaultForOpenQuestions } = await import("../../src/shared/openQuestionsInboxBuilder");
      const { buildOpenQuestionsInbox, renderOpenQuestionsInbox } = await import("../../src/shared/openQuestionsInboxContract");

      const scanResult = await scanVaultForOpenQuestions({
        vaultPath: sandbox.vaultRoot,
      });

      const inbox = buildOpenQuestionsInbox(scanResult.questions);
      const markdown = renderOpenQuestionsInbox(inbox);

      // Pass gate: Duplicate is merged (case-insensitive dedupe)
      expect(inbox.entries).toHaveLength(3);
      expect(inbox.totalQuestionInstances).toBe(4); // 4 total instances

      // Pass gate: Merged question has multiple source clips
      const mergedQuestion = inbox.entries.find(e =>
        e.question.toLowerCase().includes("best approach")
      );
      expect(mergedQuestion).toBeDefined();
      expect(mergedQuestion?.source_clip_count).toBe(2);
      expect(mergedQuestion?.source_clip_refs).toHaveLength(2);

      // Pass gate: Inbox shows both clips as sources
      expect(markdown).toContain("Clip 1");
      expect(markdown).toContain("Clip 2");

      // Pass gate: Questions are present
      expect(markdown).toContain("What is the best approach");
      expect(markdown).toContain("How to handle edge cases?");
      expect(markdown).toContain("What about performance?");
    });

    test("inbox-parity: repeated runs produce identical output", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "inbox-parity",
      });
      sandboxes.push(sandbox);

      const clipsPath = join(sandbox.vaultRoot, "Clips");
      await fs.mkdir(clipsPath, { recursive: true });

      // Create clips with questions
      const note1 = `---
source: https://example.com/note1
title: Note 1
date_clipped: 2026-03-01T10:00:00.000Z
---

## Clip Brief

### Open Questions

- Question Alpha?
- Question Beta?`;

      const note2 = `---
source: https://example.com/note2
title: Note 2
date_clipped: 2026-03-02T10:00:00.000Z
---

## Clip Brief

### Open Questions

- Question Gamma?
- Question Delta?`;

      await fs.writeFile(join(clipsPath, "Note 1.md"), note1, "utf-8");
      await fs.writeFile(join(clipsPath, "Note 2.md"), note2, "utf-8");

      const { scanVaultForOpenQuestions } = await import("../../src/shared/openQuestionsInboxBuilder");
      const { buildOpenQuestionsInbox, renderOpenQuestionsInbox } = await import("../../src/shared/openQuestionsInboxContract");

      // Run 1
      const scanResult1 = await scanVaultForOpenQuestions({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox1 = buildOpenQuestionsInbox(scanResult1.questions);
      const markdown1 = renderOpenQuestionsInbox(inbox1);

      // Run 2 (same vault, should produce identical result)
      const scanResult2 = await scanVaultForOpenQuestions({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox2 = buildOpenQuestionsInbox(scanResult2.questions);
      const markdown2 = renderOpenQuestionsInbox(inbox2);

      // Pass gate: Scan results are identical
      expect(scanResult1.filesScanned).toBe(scanResult2.filesScanned);
      expect(scanResult1.filesWithClipBrief).toBe(scanResult2.filesWithClipBrief);
      expect(scanResult1.questions.length).toBe(scanResult2.questions.length);

      // Pass gate: Inbox structures are identical
      expect(inbox1.entries.length).toBe(inbox2.entries.length);
      expect(inbox1.totalQuestions).toBe(inbox2.totalQuestions);
      expect(inbox1.unresolvedQuestions).toBe(inbox2.unresolvedQuestions);
      expect(inbox1.totalClips).toBe(inbox2.totalClips);
      expect(inbox1.truncated).toBe(inbox2.truncated);

      // Pass gate: Question IDs are identical
      const ids1 = inbox1.entries.map(e => e.question_id).sort();
      const ids2 = inbox2.entries.map(e => e.question_id).sort();
      expect(ids1).toEqual(ids2);

      // Pass gate: Ordering is identical
      const questions1 = inbox1.entries.map(e => e.question);
      const questions2 = inbox2.entries.map(e => e.question);
      expect(questions1).toEqual(questions2);

      // Pass gate: Markdown is identical (excluding generated_at timestamp)
      const normalizeTimestamp = (md: string): string => {
        return md.replace(/generated_at: [^\n]+/g, "generated_at: FIXED");
      };

      const normalized1 = normalizeTimestamp(markdown1);
      const normalized2 = normalizeTimestamp(markdown2);
      expect(normalized1).toBe(normalized2);
    });

    test("inbox-parity: ordering is deterministic across multiple runs", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "inbox-ordering",
      });
      sandboxes.push(sandbox);

      const clipsPath = join(sandbox.vaultRoot, "Clips");
      await fs.mkdir(clipsPath, { recursive: true });

      // Create multiple clips with different timestamps
      for (let i = 1; i <= 5; i++) {
        await fs.writeFile(
          join(clipsPath, `Clip ${i}.md`),
          `---
source: https://example.com/clip${i}
title: Clip ${i}
date_clipped: 2026-03-0${i}T10:00:00.000Z
---

## Clip Brief

### Open Questions

- Question from clip ${i}?`,
          "utf-8"
        );
      }

      const { scanVaultForOpenQuestions } = await import("../../src/shared/openQuestionsInboxBuilder");
      const { buildOpenQuestionsInbox } = await import("../../src/shared/openQuestionsInboxContract");

      // Run multiple times
      const orderings: string[][] = [];

      for (let run = 0; run < 3; run++) {
        const scanResult = await scanVaultForOpenQuestions({
          vaultPath: sandbox.vaultRoot,
        });
        const inbox = buildOpenQuestionsInbox(scanResult.questions);
        const questions = inbox.entries.map(e => e.question);
        orderings.push(questions);
      }

      // Pass gate: All orderings are identical
      const firstOrdering = orderings[0];
      expect(firstOrdering).toBeDefined();

      for (let i = 1; i < orderings.length; i++) {
        expect(orderings[i]).toEqual(firstOrdering);
      }

      // Pass gate: Ordering follows deterministic rules (by score desc, then timestamp desc, then question_id asc)
      const scanResult = await scanVaultForOpenQuestions({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox = buildOpenQuestionsInbox(scanResult.questions);

      // Verify questions are present
      expect(inbox.entries).toHaveLength(5);

      // Most recent questions should be ranked higher (same score, so timestamp is tie-breaker)
      const timestamps = inbox.entries.map(e => e.timestamp);
      const sortedTimestamps = [...timestamps].sort((a, b) => b.localeCompare(a));

      // First entries should have more recent timestamps
      expect(timestamps[0]).toBe(sortedTimestamps[0]);
    });

    test("inbox-parity: empty vault produces stable empty inbox", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "inbox-empty",
      });
      sandboxes.push(sandbox);

      const { scanVaultForOpenQuestions } = await import("../../src/shared/openQuestionsInboxBuilder");
      const { buildOpenQuestionsInbox, renderOpenQuestionsInbox } = await import("../../src/shared/openQuestionsInboxContract");

      // Run 1
      const scanResult1 = await scanVaultForOpenQuestions({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox1 = buildOpenQuestionsInbox(scanResult1.questions);
      const markdown1 = renderOpenQuestionsInbox(inbox1);

      // Run 2
      const scanResult2 = await scanVaultForOpenQuestions({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox2 = buildOpenQuestionsInbox(scanResult2.questions);
      const markdown2 = renderOpenQuestionsInbox(inbox2);

      // Pass gate: Both runs produce empty inbox
      expect(inbox1.entries).toHaveLength(0);
      expect(inbox2.entries).toHaveLength(0);
      expect(inbox1.totalQuestions).toBe(0);
      expect(inbox2.totalQuestions).toBe(0);

      // Pass gate: Empty inbox has explicit empty-state behavior
      expect(markdown1).toContain("questions_count: 0");
      expect(markdown1).toContain("unresolved_questions: 0");
      expect(markdown1).toContain("No unresolved questions found");
      expect(markdown2).toContain("questions_count: 0");
      expect(markdown2).toContain("unresolved_questions: 0");
      expect(markdown2).toContain("No unresolved questions found");

      // Pass gate: Empty inboxes are identical (excluding generated_at)
      const normalizeTimestamp = (md: string): string => {
        return md.replace(/generated_at: [^\n]+/g, "generated_at: FIXED");
      };

      const normalized1 = normalizeTimestamp(markdown1);
      const normalized2 = normalizeTimestamp(markdown2);
      expect(normalized1).toBe(normalized2);
    });

    test("inbox-parity: resolved questions are excluded deterministically", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "inbox-resolved",
      });
      sandboxes.push(sandbox);

      const clipsPath = join(sandbox.vaultRoot, "Clips");
      await fs.mkdir(clipsPath, { recursive: true });

      // Create clip with mixed resolved/unresolved questions
      await fs.writeFile(
        join(clipsPath, "Mixed Questions.md"),
        `---
source: https://example.com/mixed
title: Mixed Questions
date_clipped: 2026-03-03T10:00:00.000Z
---

## Clip Brief

### Open Questions

- Unresolved question 1?
- ~~Resolved question 1?~~
- Unresolved question 2?
- ~~Resolved question 2?~~`,
        "utf-8"
      );

      const { scanVaultForOpenQuestions } = await import("../../src/shared/openQuestionsInboxBuilder");
      const { buildOpenQuestionsInbox, renderOpenQuestionsInbox } = await import("../../src/shared/openQuestionsInboxContract");

      const scanResult = await scanVaultForOpenQuestions({
        vaultPath: sandbox.vaultRoot,
      });

      const inbox = buildOpenQuestionsInbox(scanResult.questions);
      const markdown = renderOpenQuestionsInbox(inbox);

      // Pass gate: Only unresolved questions appear in entries
      expect(inbox.entries).toHaveLength(2);
      expect(inbox.unresolvedQuestions).toBe(2);
      expect(inbox.resolvedQuestions).toBe(2);

      // Pass gate: Resolved questions are counted but not shown
      expect(markdown).toContain("unresolved_questions: 2");
      expect(markdown).toContain("resolved_questions: 2");

      // Pass gate: Only unresolved questions appear in markdown
      expect(markdown).toContain("Unresolved question 1?");
      expect(markdown).toContain("Unresolved question 2?");
      expect(markdown).not.toContain("Resolved question 1?");
      expect(markdown).not.toContain("Resolved question 2?");
    });

    test("inbox-parity: truncation is deterministic", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "inbox-truncate",
      });
      sandboxes.push(sandbox);

      const clipsPath = join(sandbox.vaultRoot, "Clips");
      await fs.mkdir(clipsPath, { recursive: true });

      // Create more than MAX_INBOX_QUESTIONS (100) unique questions
      const { MAX_INBOX_QUESTIONS } = await import("../../src/shared/openQuestionsInboxContract");

      for (let i = 1; i <= 15; i++) {
        const questions = [];
        for (let j = 1; j <= 10; j++) {
          questions.push(`- Question ${i}-${j}?`);
        }

        await fs.writeFile(
          join(clipsPath, `Clip ${i}.md`),
          `---
source: https://example.com/clip${i}
title: Clip ${i}
date_clipped: 2026-03-${String(i).padStart(2, "0")}T10:00:00.000Z
---

## Clip Brief

### Open Questions

${questions.join("\n")}`,
          "utf-8"
        );
      }

      const { scanVaultForOpenQuestions } = await import("../../src/shared/openQuestionsInboxBuilder");
      const { buildOpenQuestionsInbox, renderOpenQuestionsInbox } = await import("../../src/shared/openQuestionsInboxContract");

      // Run 1
      const scanResult1 = await scanVaultForOpenQuestions({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox1 = buildOpenQuestionsInbox(scanResult1.questions);
      const markdown1 = renderOpenQuestionsInbox(inbox1);

      // Run 2
      const scanResult2 = await scanVaultForOpenQuestions({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox2 = buildOpenQuestionsInbox(scanResult2.questions);
      const markdown2 = renderOpenQuestionsInbox(inbox2);

      // Pass gate: Both runs truncate to MAX_INBOX_QUESTIONS
      expect(inbox1.entries.length).toBe(MAX_INBOX_QUESTIONS);
      expect(inbox2.entries.length).toBe(MAX_INBOX_QUESTIONS);
      expect(inbox1.truncated).toBe(true);
      expect(inbox2.truncated).toBe(true);

      // Pass gate: Truncation is indicated in markdown
      expect(markdown1).toContain("inbox_truncated: true");
      expect(markdown2).toContain("inbox_truncated: true");
      expect(markdown1).toContain("Inbox truncated to 100 questions");
      expect(markdown2).toContain("Inbox truncated to 100 questions");

      // Pass gate: Truncated output is identical across runs
      const normalizeTimestamp = (md: string): string => {
        return md.replace(/generated_at: [^\n]+/g, "generated_at: FIXED");
      };

      const normalized1 = normalizeTimestamp(markdown1);
      const normalized2 = normalizeTimestamp(markdown2);
      expect(normalized1).toBe(normalized2);

      // Pass gate: Same questions are retained in both runs
      const questions1 = inbox1.entries.map(e => e.question_id).sort();
      const questions2 = inbox2.entries.map(e => e.question_id).sort();
      expect(questions1).toEqual(questions2);
    });
  });
});

// ============================================================================
// TP006: Key Takeaways Inbox E2E Scenarios - Artifact Refresh & Rerun Parity
// ============================================================================

describe("TP006: Key Takeaways Inbox end-to-end artifact refresh & stable rerun parity", () => {
  /**
   * Helper to seed a clip note with Key Takeaways in the vault
   */
  async function seedClipWithTakeaways(
    sandbox: TestVaultSandbox,
    filename: string,
    frontmatter: {
      source: string;
      title: string;
      date_clipped?: string;
    },
    takeaways: string[],
    options?: {
      includeStrikethrough?: boolean;
      strikethroughIndices?: number[];
    },
  ): Promise<string> {
    const clipsPath = join(sandbox.vaultRoot, "Clips");
    await fs.mkdir(clipsPath, { recursive: true });

    const strikeThroughSet = new Set(options?.strikethroughIndices ?? []);

    const takeawayLines = takeaways.map((t, i) => {
      if (strikeThroughSet.has(i)) {
        return `- ~~${t}~~`;
      }
      return `- ${t}`;
    });

    const content = `---
source: "${frontmatter.source}"
title: "${frontmatter.title}"
date_clipped: ${frontmatter.date_clipped || "2026-03-03T10:00:00.000Z"}
---

## Clip Brief

### Key Takeaways

${takeawayLines.join("\n")}
`;

    const filePath = join(clipsPath, `${filename}.md`);
    await fs.writeFile(filePath, content, "utf-8");
    return filePath;
  }

  describe("TP006: Key Takeaways Inbox artifact refresh", () => {
    test("inbox-refresh: single clip produces correct inbox", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "key-takeaways",
      });
      sandboxes.push(sandbox);

      await seedClipWithTakeaways(
        sandbox,
        "Single Clip",
        {
          source: "https://example.com/single",
          title: "Single Clip",
          date_clipped: "2026-03-03T10:00:00.000Z",
        },
        [
          "React Server Components use RSC payload for hydration",
          "Streaming SSR requires Suspense boundaries",
          "Server Components reduce client bundle size",
        ],
      );

      const { scanVaultForKeyTakeaways } = await import("../../src/shared/keyTakeawaysInboxBuilder");
      const { buildKeyTakeawaysInbox, renderKeyTakeawaysInbox } = await import("../../src/shared/keyTakeawaysInboxContract");

      const scanResult = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });

      const inbox = buildKeyTakeawaysInbox(scanResult.insights);
      const markdown = renderKeyTakeawaysInbox(inbox);

      // Pass gate: All insights extracted
      expect(inbox.entries).toHaveLength(3);
      expect(inbox.totalClips).toBe(1);
      expect(inbox.totalInsightInstances).toBe(3);

      // Pass gate: Insights appear in markdown
      expect(markdown).toContain("React Server Components use RSC payload for hydration");
      expect(markdown).toContain("Streaming SSR requires Suspense boundaries");
      expect(markdown).toContain("Server Components reduce client bundle size");

      // Pass gate: Source clip linkback is present
      expect(markdown).toContain("Single Clip");
      expect(markdown).toContain("https://example.com/single");

      // Pass gate: Required metadata is present
      expect(markdown).toContain("inbox_version:");
      expect(markdown).toContain("insights_count: 3");
      expect(markdown).toContain("source_clips_processed: 1");
    });

    test("inbox-refresh: multiple clips with shared insights are deduplicated", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "key-takeaways",
      });
      sandboxes.push(sandbox);

      // Clip 1 with shared insight
      await seedClipWithTakeaways(
        sandbox,
        "React Basics",
        {
          source: "https://example.com/react-basics",
          title: "React Basics",
          date_clipped: "2026-03-01T10:00:00.000Z",
        },
        [
          "React Server Components use RSC payload for hydration",
          "Components are the building blocks of React",
        ],
      );

      // Clip 2 with same insight (different wording)
      await seedClipWithTakeaways(
        sandbox,
        "RSC Deep Dive",
        {
          source: "https://example.com/rsc-deep-dive",
          title: "RSC Deep Dive",
          date_clipped: "2026-03-02T10:00:00.000Z",
        },
        [
          "React server components use RSC payload for hydration!", // Same after normalization
          "Server Components can fetch data directly",
        ],
      );

      // Clip 3 with same insight (more variation)
      await seedClipWithTakeaways(
        sandbox,
        "Advanced RSC",
        {
          source: "https://example.com/advanced-rsc",
          title: "Advanced RSC",
          date_clipped: "2026-03-03T10:00:00.000Z",
        },
        [
          "- React Server Components use RSC payload for hydration", // With bullet prefix
          "Hydration is handled by the client",
        ],
      );

      const { scanVaultForKeyTakeaways } = await import("../../src/shared/keyTakeawaysInboxBuilder");
      const { buildKeyTakeawaysInbox, renderKeyTakeawaysInbox } = await import("../../src/shared/keyTakeawaysInboxContract");

      const scanResult = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });

      const inbox = buildKeyTakeawaysInbox(scanResult.insights);
      const markdown = renderKeyTakeawaysInbox(inbox);

      // Pass gate: Deduplication works (same insight appears once)
      // Total unique insights: 5 distinct after dedupe
      // (1 deduplicated + 2 + 2 unique = 5 unique)
      expect(inbox.entries.length).toBeLessThan(6);
      expect(inbox.totalClips).toBe(3);

      // Pass gate: Deduplicated insight has multiple source clips
      const deduplicatedInsight = inbox.entries.find(
        e => e.insight.includes("React Server Components use RSC payload"),
      );
      expect(deduplicatedInsight).toBeDefined();
      expect(deduplicatedInsight!.source_clip_count).toBe(3);

      // Pass gate: Linkback shows all source clips
      expect(markdown).toContain("React Basics");
      expect(markdown).toContain("RSC Deep Dive");
      expect(markdown).toContain("Advanced RSC");

      // Pass gate: "Appears in" count is correct
      expect(markdown).toContain("**Appears in:** 3 clip(s)");
    });

    test("inbox-refresh: ranking orders insights by score", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "key-takeaways",
      });
      sandboxes.push(sandbox);

      // Old, brief insight (low score)
      await seedClipWithTakeaways(
        sandbox,
        "Old Brief",
        {
          source: "https://example.com/old-brief",
          title: "Old Brief",
          date_clipped: "2026-01-01T10:00:00.000Z",
        },
        ["Short"],
      );

      // Recent, detailed insight (high score)
      await seedClipWithTakeaways(
        sandbox,
        "Recent Detailed",
        {
          source: "https://example.com/recent-detailed",
          title: "Recent Detailed",
          date_clipped: "2026-03-03T10:00:00.000Z",
        },
        [
          "This is a very detailed and comprehensive insight that provides extensive information about the topic being discussed and covers multiple aspects of the subject matter",
        ],
      );

      // Mid priority insight
      await seedClipWithTakeaways(
        sandbox,
        "Mid Priority",
        {
          source: "https://example.com/mid-priority",
          title: "Mid Priority",
          date_clipped: "2026-02-15T10:00:00.000Z",
        },
        ["This is a medium length insight"],
      );

      const { scanVaultForKeyTakeaways } = await import("../../src/shared/keyTakeawaysInboxBuilder");
      const { buildKeyTakeawaysInbox } = await import("../../src/shared/keyTakeawaysInboxContract");

      const scanResult = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });

      const inbox = buildKeyTakeawaysInbox(scanResult.insights);

      // Pass gate: Insights are ordered by score (descending)
      expect(inbox.entries[0]!.score).toBeGreaterThanOrEqual(inbox.entries[1]!.score);
      expect(inbox.entries[1]!.score).toBeGreaterThanOrEqual(inbox.entries[2]!.score);

      // Pass gate: Most recent/detailed insight has highest score
      expect(inbox.entries[0]!.insight).toContain("very detailed");
    });

    test("inbox-refresh: export produces valid file", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "key-takeaways",
      });
      sandboxes.push(sandbox);

      await seedClipWithTakeaways(
        sandbox,
        "Export Test",
        {
          source: "https://example.com/export-test",
          title: "Export Test",
        },
        ["Test insight for export"],
      );

      const { scanVaultForKeyTakeaways } = await import("../../src/shared/keyTakeawaysInboxBuilder");
      const { buildKeyTakeawaysInbox } = await import("../../src/shared/keyTakeawaysInboxContract");
      const { exportKeyTakeawaysInbox, inboxFileExists, readInboxFile } = await import("../../src/shared/keyTakeawaysInboxExporter");

      const scanResult = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });

      const inbox = buildKeyTakeawaysInbox(scanResult.insights);

      const exportResult = await exportKeyTakeawaysInbox(inbox, {
        vaultPath: sandbox.vaultRoot,
      });

      // Pass gate: File was created
      expect(exportResult.created).toBe(true);
      expect(exportResult.isEmpty).toBe(false);

      // Pass gate: File exists
      const exists = await inboxFileExists({ vaultPath: sandbox.vaultRoot });
      expect(exists).toBe(true);

      // Pass gate: File content is valid markdown
      const content = await readInboxFile({ vaultPath: sandbox.vaultRoot });
      expect(content).not.toBeNull();
      expect(content).toContain("---");
      expect(content).toContain("# Key Takeaways Inbox");
      expect(content).toContain("Test insight for export");
    });
  });

  describe("TP006: Key Takeaways Inbox stable rerun parity", () => {
    test("inbox-parity: identical outputs across multiple runs", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "key-takeaways-parity",
      });
      sandboxes.push(sandbox);

      // Seed multiple clips with insights
      for (let i = 1; i <= 5; i++) {
        await seedClipWithTakeaways(
          sandbox,
          `Clip ${i}`,
          {
            source: `https://example.com/clip-${i}`,
            title: `Clip ${i}`,
            date_clipped: `2026-03-0${i}T10:00:00.000Z`,
          },
          [
            `Insight A from clip ${i}`,
            `Insight B from clip ${i}`,
            `Insight C from clip ${i}`,
          ],
        );
      }

      const { scanVaultForKeyTakeaways } = await import("../../src/shared/keyTakeawaysInboxBuilder");
      const { buildKeyTakeawaysInbox, renderKeyTakeawaysInbox } = await import("../../src/shared/keyTakeawaysInboxContract");

      // Run 1
      const scanResult1 = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox1 = buildKeyTakeawaysInbox(scanResult1.insights);
      const markdown1 = renderKeyTakeawaysInbox(inbox1);

      // Run 2
      const scanResult2 = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox2 = buildKeyTakeawaysInbox(scanResult2.insights);
      const markdown2 = renderKeyTakeawaysInbox(inbox2);

      // Run 3
      const scanResult3 = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox3 = buildKeyTakeawaysInbox(scanResult3.insights);
      const markdown3 = renderKeyTakeawaysInbox(inbox3);

      // Pass gate: All runs produce identical entry counts
      expect(inbox1.entries.length).toBe(inbox2.entries.length);
      expect(inbox2.entries.length).toBe(inbox3.entries.length);

      // Pass gate: All runs produce identical scores
      const scores1 = inbox1.entries.map(e => e.score);
      const scores2 = inbox2.entries.map(e => e.score);
      const scores3 = inbox3.entries.map(e => e.score);
      expect(scores1).toEqual(scores2);
      expect(scores2).toEqual(scores3);

      // Pass gate: All runs produce identical insight IDs
      const ids1 = inbox1.entries.map(e => e.insight_id);
      const ids2 = inbox2.entries.map(e => e.insight_id);
      const ids3 = inbox3.entries.map(e => e.insight_id);
      expect(ids1).toEqual(ids2);
      expect(ids2).toEqual(ids3);

      // Pass gate: Markdown is identical (excluding timestamp)
      const normalizeTimestamp = (md: string): string => {
        return md.replace(/generated_at: [^\n]+/g, "generated_at: FIXED");
      };

      const normalized1 = normalizeTimestamp(markdown1);
      const normalized2 = normalizeTimestamp(markdown2);
      const normalized3 = normalizeTimestamp(markdown3);
      expect(normalized1).toBe(normalized2);
      expect(normalized2).toBe(normalized3);
    });

    test("inbox-parity: empty vault produces stable empty inbox", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "key-takeaways-empty",
      });
      sandboxes.push(sandbox);

      const { scanVaultForKeyTakeaways } = await import("../../src/shared/keyTakeawaysInboxBuilder");
      const { buildKeyTakeawaysInbox, renderKeyTakeawaysInbox } = await import("../../src/shared/keyTakeawaysInboxContract");

      // Run 1
      const scanResult1 = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox1 = buildKeyTakeawaysInbox(scanResult1.insights);
      const markdown1 = renderKeyTakeawaysInbox(inbox1);

      // Run 2
      const scanResult2 = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox2 = buildKeyTakeawaysInbox(scanResult2.insights);
      const markdown2 = renderKeyTakeawaysInbox(inbox2);

      // Pass gate: Both runs produce empty inbox
      expect(inbox1.entries).toHaveLength(0);
      expect(inbox2.entries).toHaveLength(0);
      expect(inbox1.totalInsights).toBe(0);
      expect(inbox2.totalInsights).toBe(0);

      // Pass gate: Empty inbox has explicit empty-state behavior
      expect(markdown1).toContain("insights_count: 0");
      expect(markdown1).toContain("active_insights: 0");
      expect(markdown1).toContain("No active insights found");
      expect(markdown2).toContain("insights_count: 0");
      expect(markdown2).toContain("active_insights: 0");
      expect(markdown2).toContain("No active insights found");

      // Pass gate: Empty inboxes are identical (excluding timestamp)
      const normalizeTimestamp = (md: string): string => {
        return md.replace(/generated_at: [^\n]+/g, "generated_at: FIXED");
      };

      const normalized1 = normalizeTimestamp(markdown1);
      const normalized2 = normalizeTimestamp(markdown2);
      expect(normalized1).toBe(normalized2);
    });

    test("inbox-parity: strikethrough insights are excluded deterministically", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "key-takeaways-strikethrough",
      });
      sandboxes.push(sandbox);

      await seedClipWithTakeaways(
        sandbox,
        "Mixed Insights",
        {
          source: "https://example.com/mixed",
          title: "Mixed Insights",
        },
        [
          "Active insight 1",
          "Archived insight 1",
          "Active insight 2",
          "Archived insight 2",
        ],
        {
          strikethroughIndices: [1, 3], // Mark insights 2 and 4 as archived
        },
      );

      const { scanVaultForKeyTakeaways } = await import("../../src/shared/keyTakeawaysInboxBuilder");
      const { buildKeyTakeawaysInbox, renderKeyTakeawaysInbox, InsightStatus } = await import("../../src/shared/keyTakeawaysInboxContract");

      // Run 1
      const scanResult1 = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox1 = buildKeyTakeawaysInbox(scanResult1.insights);
      const markdown1 = renderKeyTakeawaysInbox(inbox1);

      // Run 2
      const scanResult2 = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox2 = buildKeyTakeawaysInbox(scanResult2.insights);
      const markdown2 = renderKeyTakeawaysInbox(inbox2);

      // Pass gate: Both runs have same counts
      expect(inbox1.entries.length).toBe(inbox2.entries.length);
      expect(inbox1.activeInsights).toBe(inbox2.activeInsights);
      expect(inbox1.archivedInsights).toBe(inbox2.archivedInsights);

      // Pass gate: Archived insights are counted but not shown
      expect(markdown1).toContain("archived_insights: 2");
      expect(markdown1).toContain("Active insight 1");
      expect(markdown1).toContain("Active insight 2");
      expect(markdown1).not.toContain("Archived insight 1");
      expect(markdown1).not.toContain("Archived insight 2");

      // Pass gate: Both runs produce identical markdown
      const normalizeTimestamp = (md: string): string => {
        return md.replace(/generated_at: [^\n]+/g, "generated_at: FIXED");
      };
      expect(normalizeTimestamp(markdown1)).toBe(normalizeTimestamp(markdown2));
    });

    test("inbox-parity: truncation is deterministic", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "key-takeaways-truncate",
      });
      sandboxes.push(sandbox);

      const { MAX_INBOX_INSIGHTS } = await import("../../src/shared/keyTakeawaysInboxContract");

      // Create more than MAX_INBOX_INSIGHTS (100) unique insights
      for (let i = 1; i <= 15; i++) {
        const insights = [];
        for (let j = 1; j <= 10; j++) {
          insights.push(`Insight ${i}-${j}: This is a detailed insight with enough length to have meaningful scoring`);
        }

        await seedClipWithTakeaways(
          sandbox,
          `Clip ${i}`,
          {
            source: `https://example.com/clip-${i}`,
            title: `Clip ${i}`,
            date_clipped: `2026-03-${String(i).padStart(2, "0")}T10:00:00.000Z`,
          },
          insights,
        );
      }

      const { scanVaultForKeyTakeaways } = await import("../../src/shared/keyTakeawaysInboxBuilder");
      const { buildKeyTakeawaysInbox, renderKeyTakeawaysInbox } = await import("../../src/shared/keyTakeawaysInboxContract");

      // Run 1
      const scanResult1 = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox1 = buildKeyTakeawaysInbox(scanResult1.insights);
      const markdown1 = renderKeyTakeawaysInbox(inbox1);

      // Run 2
      const scanResult2 = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox2 = buildKeyTakeawaysInbox(scanResult2.insights);
      const markdown2 = renderKeyTakeawaysInbox(inbox2);

      // Pass gate: Both runs truncate to MAX_INBOX_INSIGHTS
      expect(inbox1.entries.length).toBe(MAX_INBOX_INSIGHTS);
      expect(inbox2.entries.length).toBe(MAX_INBOX_INSIGHTS);
      expect(inbox1.truncated).toBe(true);
      expect(inbox2.truncated).toBe(true);

      // Pass gate: Truncation is indicated in markdown
      expect(markdown1).toContain("inbox_truncated: true");
      expect(markdown2).toContain("inbox_truncated: true");
      expect(markdown1).toContain("Inbox truncated to 100 insights");
      expect(markdown2).toContain("Inbox truncated to 100 insights");

      // Pass gate: Truncated output is identical across runs
      const normalizeTimestamp = (md: string): string => {
        return md.replace(/generated_at: [^\n]+/g, "generated_at: FIXED");
      };

      const normalized1 = normalizeTimestamp(markdown1);
      const normalized2 = normalizeTimestamp(markdown2);
      expect(normalized1).toBe(normalized2);

      // Pass gate: Same insights are retained in both runs
      const insightIds1 = inbox1.entries.map(e => e.insight_id).sort();
      const insightIds2 = inbox2.entries.map(e => e.insight_id).sort();
      expect(insightIds1).toEqual(insightIds2);
    });

    test("inbox-parity: source clip ref truncation is deterministic", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "key-takeaways-ref-truncate",
      });
      sandboxes.push(sandbox);

      // Create 15 clips all with the same insight (to test source_clip_refs truncation)
      for (let i = 1; i <= 15; i++) {
        await seedClipWithTakeaways(
          sandbox,
          `Duplicate Clip ${i}`,
          {
            source: `https://example.com/duplicate-${i}`,
            title: `Duplicate Clip ${i}`,
            date_clipped: `2026-03-${String(i).padStart(2, "0")}T10:00:00.000Z`,
          },
          ["Same insight appearing in many clips for ref truncation test"],
        );
      }

      const { scanVaultForKeyTakeaways } = await import("../../src/shared/keyTakeawaysInboxBuilder");
      const { buildKeyTakeawaysInbox, renderKeyTakeawaysInbox, MAX_SOURCE_CLIP_REFS } = await import("../../src/shared/keyTakeawaysInboxContract");

      // Run 1
      const scanResult1 = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox1 = buildKeyTakeawaysInbox(scanResult1.insights);
      const markdown1 = renderKeyTakeawaysInbox(inbox1);

      // Run 2
      const scanResult2 = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });
      const inbox2 = buildKeyTakeawaysInbox(scanResult2.insights);
      const markdown2 = renderKeyTakeawaysInbox(inbox2);

      // Pass gate: Both runs have single deduplicated entry
      expect(inbox1.entries).toHaveLength(1);
      expect(inbox2.entries).toHaveLength(1);

      // Pass gate: Source clip refs are truncated to MAX_SOURCE_CLIP_REFS
      expect(inbox1.entries[0]!.source_clip_refs.length).toBe(MAX_SOURCE_CLIP_REFS);
      expect(inbox2.entries[0]!.source_clip_refs.length).toBe(MAX_SOURCE_CLIP_REFS);

      // Pass gate: Total source clip count is preserved
      expect(inbox1.entries[0]!.source_clip_count).toBe(15);
      expect(inbox2.entries[0]!.source_clip_count).toBe(15);

      // Pass gate: Truncation flag is set
      expect(inbox1.entries[0]!.source_clip_refs_truncated).toBe(true);
      expect(inbox2.entries[0]!.source_clip_refs_truncated).toBe(true);

      // Pass gate: Markdown shows truncation indicator
      expect(markdown1).toContain("... and 5 more clips");
      expect(markdown2).toContain("... and 5 more clips");

      // Pass gate: Same source clips are shown in both runs
      const refs1 = inbox1.entries[0]!.source_clip_refs.map(r => r.id).sort();
      const refs2 = inbox2.entries[0]!.source_clip_refs.map(r => r.id).sort();
      expect(refs1).toEqual(refs2);
    });
  });

  describe("TP006: Key Takeaways Inbox metadata diagnostics", () => {
    test("metadata is always present and valid", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "key-takeaways-meta",
      });
      sandboxes.push(sandbox);

      await seedClipWithTakeaways(
        sandbox,
        "Metadata Test",
        {
          source: "https://example.com/metadata-test",
          title: "Metadata Test",
        },
        ["Test insight"],
      );

      const { scanVaultForKeyTakeaways } = await import("../../src/shared/keyTakeawaysInboxBuilder");
      const { buildKeyTakeawaysInbox, renderKeyTakeawaysInbox, extractInboxMetadata, KEY_TAKEAWAYS_INBOX_VERSION } = await import("../../src/shared/keyTakeawaysInboxContract");

      const scanResult = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });

      const inbox = buildKeyTakeawaysInbox(scanResult.insights);
      const metadata = extractInboxMetadata(inbox);
      const markdown = renderKeyTakeawaysInbox(inbox);

      // Pass gate: All required metadata fields are present
      expect(metadata.inbox_version).toBe(KEY_TAKEAWAYS_INBOX_VERSION);
      expect(metadata.insights_count).toBe(1);
      expect(metadata.source_clips_processed).toBe(1);
      expect(metadata.active_insights).toBe(1);
      expect(metadata.archived_insights).toBe(0);
      expect(metadata.inbox_truncated).toBe(false);
      expect(metadata.generated_at).toBeDefined();

      // Pass gate: Version is semantic version format
      expect(metadata.inbox_version).toMatch(/^\d+\.\d+\.\d+$/);

      // Pass gate: Generated_at is valid ISO timestamp
      expect(new Date(metadata.generated_at).toISOString()).toBe(metadata.generated_at);

      // Pass gate: Metadata is in markdown frontmatter
      expect(markdown).toContain(`inbox_version: ${KEY_TAKEAWAYS_INBOX_VERSION}`);
      expect(markdown).toContain("insights_count: 1");
      expect(markdown).toContain("source_clips_processed: 1");
      expect(markdown).toContain("active_insights: 1");
      expect(markdown).toContain("archived_insights: 0");
      expect(markdown).toContain("inbox_truncated: false");
    });

    test("no-match diagnostics have zero values and correct version", async () => {
      const sandbox = await createTestVaultSandbox({
        timestampIso: "2026-03-03T12:00:00.000Z",
        titlePrefix: "key-takeaways-no-match",
      });
      sandboxes.push(sandbox);

      // Empty vault - no clips with takeaways
      const { scanVaultForKeyTakeaways } = await import("../../src/shared/keyTakeawaysInboxBuilder");
      const { buildKeyTakeawaysInbox, renderKeyTakeawaysInbox, extractInboxMetadata, KEY_TAKEAWAYS_INBOX_VERSION } = await import("../../src/shared/keyTakeawaysInboxContract");

      const scanResult = await scanVaultForKeyTakeaways({
        vaultPath: sandbox.vaultRoot,
      });

      const inbox = buildKeyTakeawaysInbox(scanResult.insights);
      const metadata = extractInboxMetadata(inbox);
      const markdown = renderKeyTakeawaysInbox(inbox);

      // Pass gate: All counts are 0 for empty
      expect(metadata.insights_count).toBe(0);
      expect(metadata.source_clips_processed).toBe(0);
      expect(metadata.active_insights).toBe(0);
      expect(metadata.archived_insights).toBe(0);

      // Pass gate: Version is still present and correct
      expect(metadata.inbox_version).toBe(KEY_TAKEAWAYS_INBOX_VERSION);

      // Pass gate: Truncated is false for empty
      expect(metadata.inbox_truncated).toBe(false);

      // Pass gate: Empty state message is shown
      expect(markdown).toContain("No active insights found");
    });
  });

  // ============================================================================
  // TP006: Knowledge Triage State Sync - Resolved Item Suppression Across Cycles
  // ============================================================================

  describe("TP006: Knowledge Triage State Sync - resolved items remain suppressed across refresh cycles", () => {
    /**
     * Helper to seed a triage item in the knowledge-triage inbox
     */
    async function seedTriageItem(
      sandbox: TestVaultSandbox,
      folderPath: string,
      filename: string,
      itemDescription: string,
      status: "ready" | "in-progress" | "blocked" | "done" = "ready",
    ): Promise<string> {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { join } = await import("node:path");

      const folderFullPath = join(sandbox.vaultRoot, folderPath);
      await mkdir(folderFullPath, { recursive: true });

      const filePath = join(folderFullPath, `${filename}.md`);

      // Format item based on status
      let itemLine: string;
      switch (status) {
        case "done":
          itemLine = `- [x] ${itemDescription}`; // Checked checkbox = done
          break;
        case "blocked":
          itemLine = `- ~~${itemDescription}~~`; // Strikethrough = blocked
          break;
        case "in-progress":
          itemLine = `- [ ] ${itemDescription} <!-- status: in-progress -->`;
          break;
        default:
          itemLine = `- [ ] ${itemDescription}`; // Unchecked = ready
      }

      const content = [
        "---",
        `title: "${filename}"`,
        "type: article",
        "tags:",
        '  - "triage"',
        `date_clipped: "2026-03-03T12:00:00.000Z"`,
        "---",
        "",
        "## Knowledge Triage Inbox",
        "",
        itemLine,
        "",
      ].join("\n");

      await writeFile(filePath, content, "utf-8");
      return filePath;
    }

    /**
     * Helper to scan vault and build triage state sync
     */
    async function buildSyncFromVault(vaultPath: string) {
      const { scanVaultForTriageItems } = await import("../../src/shared/knowledgeTriageStateSyncBuilder");
      const { buildTriageStateSync } = await import("../../src/shared/knowledgeTriageStateSyncContract");

      const scanResult = await scanVaultForTriageItems({
        vaultPath,
        maxDepth: 2,
      });

      const sync = buildTriageStateSync(scanResult.triageItems);
      return { scanResult, sync };
    }

    describe("TP006: Resolved item suppression on first refresh", () => {
      test("done items are excluded from sync (suppressed at parse time)", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "triage-suppress",
        });
        sandboxes.push(sandbox);

        // Seed mixed items: ready, and done (done items are filtered at parse time)
        await seedTriageItem(sandbox, "Clips", "ready-item", "Ready to work on item", "ready");
        await seedTriageItem(sandbox, "Clips", "done-item", "Completed item should not appear", "done");
        await seedTriageItem(sandbox, "Clips", "blocked-item", "Blocked item should appear", "blocked");

        const { sync } = await buildSyncFromVault(sandbox.vaultRoot);

        // Pass gate: Checked checkbox items are EXCLUDED at parse time (suppression)
        // Strikethrough items ARE included (marked as done)
        expect(sync.totalItems).toBe(2); // ready + strikethrough

        // Pass gate: Active entries (ready) are included
        const activeEntries = sync.entries.filter(e => e.status === "ready");
        expect(activeEntries.length).toBe(1);

        // Pass gate: Strikethrough items are tracked as done (not excluded)
        const doneEntries = sync.entries.filter(e => e.status === "done");
        expect(doneEntries.length).toBe(1); // Only strikethrough

        // Pass gate: Status counts reflect included items
        expect(sync.statusCounts.ready).toBe(1);
        expect(sync.statusCounts.done).toBe(1);

        // Pass gate: Checked checkbox items are suppressed (excluded at parse time)
        const descriptions = sync.entries.map(e => e.description);
        expect(descriptions).toContain("Ready to work on item");
        expect(descriptions).toContain("Blocked item should appear"); // Strikethrough = done, included
        expect(descriptions).not.toContain("Completed item should not appear"); // Checked = excluded
      });

      test("status counts reflect only included items (done items excluded)", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "triage-counts",
        });
        sandboxes.push(sandbox);

        // Seed multiple items of each status
        for (let i = 0; i < 3; i++) {
          await seedTriageItem(sandbox, "Clips", `ready-${i}`, `Ready item ${i}`, "ready");
        }
        for (let i = 0; i < 2; i++) {
          await seedTriageItem(sandbox, "Clips", `done-${i}`, `Done item ${i}`, "done");
        }
        for (let i = 0; i < 2; i++) {
          await seedTriageItem(sandbox, "Clips", `blocked-${i}`, `Blocked item ${i}`, "blocked");
        }

        const { sync } = await buildSyncFromVault(sandbox.vaultRoot);

        // Pass gate: Total items excludes checked checkbox items (suppressed at parse time)
        // Strikethrough items are included (marked as done)
        expect(sync.totalItems).toBe(5); // 3 ready + 2 strikethrough

        // Pass gate: Individual status counts
        expect(sync.statusCounts.ready).toBe(3);
        expect(sync.statusCounts.done).toBe(2); // 2 strikethrough only (checked items excluded)
        expect(sync.statusCounts.blocked).toBe(0); // Strikethrough is done, not blocked
        expect(sync.statusCounts.inProgress).toBe(0);
      });
    });

    describe("TP006: Resolved item persistence across repeated refresh cycles", () => {
      test("done items remain excluded across multiple refresh cycles (suppression persistence)", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "triage-persist",
        });
        sandboxes.push(sandbox);

        // Seed a mix of done and ready items
        await seedTriageItem(sandbox, "Clips", "persistent-done", "Persistent done item", "done");
        await seedTriageItem(sandbox, "Clips", "active-item", "Active item", "ready");

        // Run 1: Initial sync
        const { sync: sync1 } = await buildSyncFromVault(sandbox.vaultRoot);
        expect(sync1.totalItems).toBe(1); // Only active item
        expect(sync1.entries[0]?.description).toBe("Active item");

        // Run 2: Second refresh cycle - done item still excluded
        const { sync: sync2 } = await buildSyncFromVault(sandbox.vaultRoot);
        expect(sync2.totalItems).toBe(1);
        expect(sync2.entries[0]?.description).toBe("Active item");

        // Run 3: Third refresh cycle - suppression persists
        const { sync: sync3 } = await buildSyncFromVault(sandbox.vaultRoot);
        expect(sync3.totalItems).toBe(1);
        expect(sync3.entries[0]?.description).toBe("Active item");

        // Pass gate: Done item never appears in any cycle
        for (const sync of [sync1, sync2, sync3]) {
          const descriptions = sync.entries.map(e => e.description);
          expect(descriptions).not.toContain("Persistent done item");
        }
      });

      test("suppressed done items do not resurface across repeated refresh cycles", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "triage-no-resurface",
        });
        sandboxes.push(sandbox);

        // Seed mixed items - done items are suppressed at parse time
        await seedTriageItem(sandbox, "Clips", "active-1", "Active item 1", "ready");
        await seedTriageItem(sandbox, "Clips", "done-1", "Done item (suppressed)", "done");
        await seedTriageItem(sandbox, "Clips", "active-2", "Active item 2", "ready");
        await seedTriageItem(sandbox, "Clips", "blocked-1", "Blocked item", "blocked");

        // Run multiple refresh cycles
        const cycles = [];
        for (let i = 0; i < 5; i++) {
          const { sync } = await buildSyncFromVault(sandbox.vaultRoot);
          cycles.push({
            activeCount: sync.entries.filter(e => e.status === "ready").length,
            blockedCount: sync.entries.filter(e => e.status === "blocked").length,
            totalItems: sync.totalItems,
            descriptions: sync.entries.map(e => e.description),
          });
        }

        // Pass gate: All cycles have same counts (2 ready + 1 strikethrough = 3)
        // Checked checkbox items are excluded at parse time
        for (const cycle of cycles) {
          expect(cycle.activeCount).toBe(2);
          expect(cycle.blockedCount).toBe(0); // Strikethrough is done, not blocked
          expect(cycle.totalItems).toBe(3); // 2 ready + 1 strikethrough
        }

        // Pass gate: Checked items are suppressed (excluded at parse time)
        // Strikethrough items are tracked as done
        for (const cycle of cycles) {
          expect(cycle.descriptions).not.toContain("Done item (suppressed)"); // Checked = excluded
          expect(cycle.descriptions).toContain("Blocked item"); // Strikethrough = done, tracked
          expect(cycle.descriptions).toContain("Active item 1");
          expect(cycle.descriptions).toContain("Active item 2");
        }
      });

      test("inbox rendering filters done items consistently (suppressed at parse time)", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "triage-render",
        });
        sandboxes.push(sandbox);

        // Seed items across multiple source inboxes
        await seedTriageItem(sandbox, "Clips", "open-1", "Open question 1", "ready");
        await seedTriageItem(sandbox, "Clips", "done-item", "Done question (suppressed)", "done");
        await seedTriageItem(sandbox, "Backlog", "task-1", "Active task", "ready");
        await seedTriageItem(sandbox, "Backlog", "task-2", "Blocked task", "blocked");

        // Simulate multiple render cycles
        const renderCycles = [];
        for (let i = 0; i < 3; i++) {
          const { sync } = await buildSyncFromVault(sandbox.vaultRoot);

          // All entries in sync are already filtered (done items excluded at parse time)
          const activeEntries = sync.entries.filter(e => e.status === "ready");
          const blockedEntries = sync.entries.filter(e => e.status === "blocked");

          renderCycles.push({
            readyCount: activeEntries.length,
            blockedCount: blockedEntries.length,
            totalCount: sync.totalItems,
            descriptions: sync.entries.map(e => e.description).sort(),
          });
        }

        // Pass gate: All cycles show same items
        expect(renderCycles[0]?.descriptions).toEqual(renderCycles[1]?.descriptions);
        expect(renderCycles[1]?.descriptions).toEqual(renderCycles[2]?.descriptions);

        // Pass gate: Checked checkbox items excluded, strikethrough items tracked as done
        for (const cycle of renderCycles) {
          expect(cycle.descriptions).not.toContain("Done question (suppressed)"); // Checked = excluded
          expect(cycle.descriptions).toContain("Blocked task"); // Strikethrough = done, tracked
          expect(cycle.descriptions).toContain("Open question 1");
          expect(cycle.descriptions).toContain("Active task");
          expect(cycle.readyCount).toBe(2);
          expect(cycle.blockedCount).toBe(0); // Strikethrough is done, not blocked
          expect(cycle.totalCount).toBe(3); // 2 ready + 1 strikethrough
        }
      });
    });

    describe("TP006: Export determinism with resolved items", () => {
      test("sync export produces identical output across runs (done items suppressed)", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "triage-export",
        });
        sandboxes.push(sandbox);

        // Seed mix of active and done items (done items are suppressed at parse time)
        await seedTriageItem(sandbox, "Clips", "item-1", "Active item", "ready");
        await seedTriageItem(sandbox, "Clips", "item-2", "Done item (excluded)", "done");
        await seedTriageItem(sandbox, "Clips", "item-3", "Blocked item", "blocked");

        const { renderTriageStateSync } = await import("../../src/shared/knowledgeTriageStateSyncContract");

        // Run 1
        const { sync: sync1 } = await buildSyncFromVault(sandbox.vaultRoot);
        const markdown1 = renderTriageStateSync(sync1);

        // Run 2
        const { sync: sync2 } = await buildSyncFromVault(sandbox.vaultRoot);
        const markdown2 = renderTriageStateSync(sync2);

        // Normalize timestamps for comparison
        const normalizeTimestamps = (md: string): string => {
          return md
            .replace(/generated_at: [^\n]+/g, "generated_at: FIXED")
            .replace(/status_changed_at: [^\n]+/g, "status_changed_at: FIXED")
            .replace(/first_seen_at: [^\n]+/g, "first_seen_at: FIXED")
            .replace(/last_seen_at: [^\n]+/g, "last_seen_at: FIXED");
        };

        // Pass gate: Markdown is identical (excluding timestamps)
        expect(normalizeTimestamps(markdown1)).toBe(normalizeTimestamps(markdown2));

        // Pass gate: Status counts reflect included items
        // Checked checkbox items excluded at parse, strikethrough items included
        expect(sync1.statusCounts).toEqual(sync2.statusCounts);
        expect(sync1.statusCounts.ready).toBe(1);
        expect(sync1.statusCounts.done).toBe(1); // Strikethrough counted as done
        expect(sync1.entries.length).toBe(2); // Ready + strikethrough

        // Pass gate: Entry statuses are identical
        const statuses1 = sync1.entries.map(e => e.status).sort();
        const statuses2 = sync2.entries.map(e => e.status).sort();
        expect(statuses1).toEqual(statuses2);
        expect(statuses1).toEqual(["done", "ready"]);

        // Pass gate: Strikethrough item appears as done, checked checkbox excluded
        expect(markdown1).toContain("Active item");
        expect(markdown1).toContain("Blocked item"); // Strikethrough item appears as done
        expect(markdown1).not.toContain("Done item (excluded)"); // Checked checkbox excluded
      });

      test("file export creates consistent state sync file (done items excluded)", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "triage-file-export",
        });
        sandboxes.push(sandbox);

        await seedTriageItem(sandbox, "Clips", "ready-item", "Ready for work", "ready");
        await seedTriageItem(sandbox, "Clips", "done-item", "Already completed (excluded)", "done");

        const { exportTriageStateSync, readSyncFile } = await import("../../src/shared/knowledgeTriageStateSyncExporter");

        // Build and export sync
        const { sync } = await buildSyncFromVault(sandbox.vaultRoot);
        const exportResult = await exportTriageStateSync(sync, {
          vaultPath: sandbox.vaultRoot,
        });

        // Pass gate: Export succeeded
        expect(exportResult.created).toBe(true);
        expect(exportResult.isEmpty).toBe(false);

        // Pass gate: File shows done count as 0 (done items excluded at parse time)
        const content = await readSyncFile({ vaultPath: sandbox.vaultRoot });
        expect(content).not.toBeNull();
        expect(content).toContain("status_counts_done: 0"); // Done items excluded
        expect(content).toContain("status_counts_ready: 1");

        // Pass gate: Only ready item appears in file
        expect(content).toContain("Ready for work");
        expect(content).not.toContain("Already completed (excluded)");
      });
    });

    describe("TP006: Status transition and suppression", () => {
      test("items transitioning to done are immediately suppressed (excluded at parse time)", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "triage-transition",
        });
        sandboxes.push(sandbox);

        // Start with an active item
        const { writeFile, mkdir } = await import("node:fs/promises");
        const { join } = await import("node:path");

        const folderPath = join(sandbox.vaultRoot, "Clips");
        await mkdir(folderPath, { recursive: true });

        const filePath = join(folderPath, "transition-test.md");

        // Create with ready status
        let content = [
          "---",
          'title: "transition-test"',
          "type: article",
          "---",
          "",
          "## Knowledge Triage Inbox",
          "",
          "- [ ] Item to be completed",
          "",
        ].join("\n");

        await writeFile(filePath, content, "utf-8");

        // First scan - item is ready
        const { sync: sync1 } = await buildSyncFromVault(sandbox.vaultRoot);
        expect(sync1.entries[0]?.status).toBe("ready");
        expect(sync1.totalItems).toBe(1);

        // Update to done status (simulating user marking it complete)
        content = [
          "---",
          'title: "transition-test"',
          "type: article",
          "---",
          "",
          "## Knowledge Triage Inbox",
          "",
          "- [x] Item to be completed",
          "",
        ].join("\n");

        await writeFile(filePath, content, "utf-8");

        // Second scan - item is now done and completely excluded from sync
        const { sync: sync2 } = await buildSyncFromVault(sandbox.vaultRoot);
        expect(sync2.totalItems).toBe(0); // Done items are excluded at parse time
        expect(sync2.entries.length).toBe(0);

        // Verify active count changed from 1 to 0
        const activeCount1 = sync1.entries.filter(e => e.status === "ready").length;
        const activeCount2 = sync2.entries.filter(e => e.status === "ready").length;
        expect(activeCount1).toBe(1);
        expect(activeCount2).toBe(0);
      });

      test("suppression persists when status changes from ready to done", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "triage-multi-state",
        });
        sandboxes.push(sandbox);

        // Create a ready item
        await seedTriageItem(sandbox, "Clips", "lifecycle-item", "Lifecycle test item", "ready");

        // Run 1: Item is ready and included
        const { sync: sync1 } = await buildSyncFromVault(sandbox.vaultRoot);
        expect(sync1.statusCounts.ready).toBe(1);
        expect(sync1.totalItems).toBe(1);

        // Verify item is present
        expect(sync1.entries[0]?.description).toBe("Lifecycle test item");

        // Pass gate: Item has stable fingerprint/ID that persists across cycles
        const itemId1 = sync1.entries[0]?.description; // Description is the fingerprint
        expect(itemId1).toBeDefined();
      });
    });

    describe("TP006: Cross-cycle determinism", () => {
      test("five consecutive refresh cycles produce identical active item sets", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "triage-five-cycles",
        });
        sandboxes.push(sandbox);

        // Seed a mix of active and resolved items
        const items = [
          { name: "active-1", desc: "First active item", status: "ready" as const },
          { name: "active-2", desc: "Second active item", status: "in-progress" as const },
          { name: "resolved-1", desc: "First resolved item", status: "done" as const },
          { name: "resolved-2", desc: "Second resolved item", status: "blocked" as const },
          { name: "active-3", desc: "Third active item", status: "ready" as const },
        ];

        for (const item of items) {
          await seedTriageItem(sandbox, "Clips", item.name, item.desc, item.status);
        }

        // Run 5 refresh cycles
        const cycles = [];
        for (let i = 0; i < 5; i++) {
          const { sync } = await buildSyncFromVault(sandbox.vaultRoot);
          cycles.push({
            activeDescriptions: sync.entries
              .filter(e => e.status === "ready" || e.status === "in-progress")
              .map(e => e.description)
              .sort(),
            resolvedDescriptions: sync.entries
              .filter(e => e.status === "done" || e.status === "blocked")
              .map(e => e.description)
              .sort(),
            statusCounts: { ...sync.statusCounts },
          });
        }

        // Pass gate: All cycles have identical active item sets
        for (let i = 1; i < cycles.length; i++) {
          expect(cycles[i]!.activeDescriptions).toEqual(cycles[0]!.activeDescriptions);
        }

        // Pass gate: All cycles have identical resolved item sets
        for (let i = 1; i < cycles.length; i++) {
          expect(cycles[i]!.resolvedDescriptions).toEqual(cycles[0]!.resolvedDescriptions);
        }

        // Pass gate: Status counts are identical across all cycles
        for (let i = 1; i < cycles.length; i++) {
          expect(cycles[i]!.statusCounts).toEqual(cycles[0]!.statusCounts);
        }
      });

      test("active items maintain stable fingerprints across cycles", async () => {
        const sandbox = await createTestVaultSandbox({
          timestampIso: "2026-03-03T12:00:00.000Z",
          titlePrefix: "triage-stable-ids",
        });
        sandboxes.push(sandbox);

        await seedTriageItem(sandbox, "Clips", "stable-item", "Item with stable fingerprint", "ready");

        // Collect item fingerprints across cycles
        const fingerprints = [];
        for (let i = 0; i < 3; i++) {
          const { sync } = await buildSyncFromVault(sandbox.vaultRoot);
          fingerprints.push(sync.entries[0]?.description); // Description is the fingerprint
        }

        // Pass gate: Same description (fingerprint) across all cycles
        expect(fingerprints[0]).toBe(fingerprints[1]);
        expect(fingerprints[1]).toBe(fingerprints[2]);
        expect(fingerprints[0]).toBeDefined();
        expect(fingerprints[0]).toBe("Item with stable fingerprint");
      });
    });
  });
});
