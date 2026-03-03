/**
 * SeedFinder Template Tests
 *
 * Coverage for:
 * - URL matching precedence for SeedFinder strain pages
 * - Selector expectations against the seedfinder-strain fixture
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { Window } from "happy-dom";

import {
  getTemplateForUrl,
  getAllMatchingTemplates,
  seedFinderTemplate
} from "../../src/content/templates";
import type { SiteTemplate } from "../../src/shared/templates";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");

function loadSeedfinderFixture(): { document: Document; window: Window } {
  const html = readFileSync(join(FIXTURES_DIR, "seedfinder-strain.html"), "utf-8");
  const window = new Window({
    url: "https://en.seedfinder.eu/strain-info/Blue_Dream/",
    width: 1920,
    height: 1080
  });
  window.document.write(html);
  return { document: window.document, window };
}

function normalizeText(text: string | undefined | null): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function applyRemoveSelectors(doc: Document, selectors: string[] | undefined): void {
  if (!selectors) return;

  for (const selector of selectors) {
    const elements = doc.querySelectorAll(selector);
    elements.forEach((el) => el.remove());
  }
}

describe("SeedFinder template URL matching precedence", () => {
  const strainUrl = "https://en.seedfinder.eu/strain-info/Blue_Dream/";
  const breederUrl = "https://en.seedfinder.eu/breeder/humboldt-seed-organization/";

  const genericSeedfinderTemplate: SiteTemplate = {
    domain: "seedfinder.eu",
    name: "Generic SeedFinder",
    selectors: { content: "#content" },
    enabled: true,
    priority: 25
  };

  test("matches built-in SeedFinder template for /strain-info URLs", () => {
    const template = getTemplateForUrl(strainUrl);
    expect(template).not.toBeNull();
    expect(template?.name).toBe("SeedFinder");
    expect(template?.urlPattern).toBe("^/strain-info/");
  });

  test("prefers built-in SeedFinder strain template over lower-priority generic domain template", () => {
    const template = getTemplateForUrl(strainUrl, {
      customTemplates: [genericSeedfinderTemplate],
      includeBuiltIns: true
    });

    expect(template).not.toBeNull();
    expect(template?.name).toBe("SeedFinder");

    const allMatches = getAllMatchingTemplates(strainUrl, {
      customTemplates: [genericSeedfinderTemplate],
      includeBuiltIns: true
    });

    expect(allMatches.length).toBeGreaterThanOrEqual(2);
    expect(allMatches[0]?.name).toBe("SeedFinder");
    expect(allMatches[1]?.name).toBe("Generic SeedFinder");
  });

  test("falls back to generic template when URL does not satisfy SeedFinder urlPattern", () => {
    const template = getTemplateForUrl(breederUrl, {
      customTemplates: [genericSeedfinderTemplate],
      includeBuiltIns: true
    });

    expect(template).not.toBeNull();
    expect(template?.name).toBe("Generic SeedFinder");

    const builtInOnly = getTemplateForUrl(breederUrl);
    expect(builtInOnly).toBeNull();
  });
});

describe("SeedFinder template selectors against fixture", () => {
  test("extracts expected title/content/author/date/tag targets from fixture", () => {
    const { document } = loadSeedfinderFixture();

    // Match web extractor behavior: remove noise first, then extract
    applyRemoveSelectors(document, seedFinderTemplate.removeSelectors);

    const titleEl = document.querySelector(seedFinderTemplate.selectors.title!);
    expect(normalizeText(titleEl?.textContent)).toBe("Blue Dream");

    const contentEl = document.querySelector(seedFinderTemplate.selectors.content!);
    expect(contentEl).not.toBeNull();
    const contentText = normalizeText(contentEl?.textContent);
    expect(contentText).toContain("Blue Dream is a balanced hybrid known for sweet berry aromas");
    expect(contentText).toContain("Cross of Blueberry x Haze");
    expect(contentText).toContain("Blueberry (mother) x Haze (father)");
    expect(contentText).not.toContain("Buy grow lights");
    expect(contentText).not.toContain("Related Strains");

    const lineageRow = Array.from(document.querySelectorAll("table.strain-metadata tr")).find((row) =>
      normalizeText(row.querySelector("th")?.textContent).toLowerCase() === "lineage"
    );
    expect(lineageRow).not.toBeUndefined();
    expect(normalizeText(lineageRow?.querySelector("td")?.textContent)).toBe("Blueberry × Haze");

    const authorEl = document.querySelector(seedFinderTemplate.selectors.author!);
    expect(normalizeText(authorEl?.textContent)).toBe("Humboldt Seed Organization");

    const dateEl = document.querySelector(seedFinderTemplate.selectors.date!);
    expect(dateEl?.getAttribute("datetime") || normalizeText(dateEl?.textContent)).toBe("2025-11-03");

    const tags = Array.from(document.querySelectorAll(seedFinderTemplate.selectors.tags!))
      .map((el) => normalizeText(el.textContent))
      .filter(Boolean);

    expect(tags).toEqual(["Blue Dream", "Sativa-leaning", "Berry Terps"]);
  });

  test("preserves lineage cues needed for SeedFinder normalization", () => {
    const { document } = loadSeedfinderFixture();

    applyRemoveSelectors(document, seedFinderTemplate.removeSelectors);

    const proseText = normalizeText(
      document.querySelector(".strain_info")?.textContent
    );
    expect(proseText).toContain("Cross of Blueberry x Haze");

    const lineageCell = Array.from(document.querySelectorAll("table.strain-metadata tr"))
      .find(
        (row) => normalizeText(row.querySelector("th")?.textContent).toLowerCase() === "lineage"
      )
      ?.querySelector("td");

    expect(normalizeText(lineageCell?.textContent)).toBe("Blueberry × Haze");
  });

  test("removeSelectors strips known SeedFinder fixture noise blocks", () => {
    const { document } = loadSeedfinderFixture();

    // Sanity checks before removal
    expect(document.querySelector("#navigation")).not.toBeNull();
    expect(document.querySelector(".sidebar")).not.toBeNull();
    expect(document.querySelector("#comments")).not.toBeNull();

    applyRemoveSelectors(document, seedFinderTemplate.removeSelectors);

    expect(document.querySelector("#navigation")).toBeNull();
    expect(document.querySelector(".sidebar")).toBeNull();
    expect(document.querySelector("#comments")).toBeNull();
    expect(document.querySelector(".sorte_info")).not.toBeNull();
  });
});
