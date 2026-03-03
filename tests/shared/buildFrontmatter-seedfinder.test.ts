import { describe, expect, test } from "bun:test";

import { buildFrontmatterFromClip } from "../../src/shared/buildFrontmatter";
import { buildFrontmatterYaml } from "../../src/shared/markdown";
import { DEFAULT_SETTINGS } from "../../src/shared/settings";
import type { ClipResult } from "../../src/shared/types";

function createSeedFinderClipResult(overrides: Partial<ClipResult["metadata"]> = {}): ClipResult {
  return {
    url: "https://en.seedfinder.eu/strain-info/Blue_Dream/",
    title: "Blue Dream",
    markdown: "# Blue Dream\n\nCross of Blueberry x Haze",
    metadata: {
      url: "https://en.seedfinder.eu/strain-info/Blue_Dream/",
      title: "Blue Dream",
      type: "article",
      ...overrides
    }
  };
}

describe("buildFrontmatterFromClip SeedFinder profile mapping", () => {
  test("maps normalized lineage and parent list into legacy frontmatter compatibility fields", () => {
    const result = createSeedFinderClipResult({
      lineage: "  Blueberry x Haze  ",
      lineageParents: [" Blueberry ", "", "Haze "]
    });

    const built = buildFrontmatterFromClip({
      result,
      settings: DEFAULT_SETTINGS,
      pageType: "web",
      currentTabUrl: result.url
    });

    expect(built.frontmatter.extra?.lineage).toBe("Blueberry x Haze");
    expect(built.frontmatter.extra?.lineage_parents).toEqual(["Blueberry", "Haze"]);
  });

  test("serializes full SeedFinder profile keys into frontmatter extra + YAML", () => {
    const result = createSeedFinderClipResult({
      seedFinderProfile: {
        lineage: " Blueberry x Haze ",
        lineageParents: ["Blueberry", " ", "Haze"],
        potency: {
          thc: {
            raw: "18-22%",
            minPercent: 18,
            maxPercent: 22
          },
          cbd: {
            raw: "<1%",
            maxPercent: 1,
            comparator: "<"
          }
        },
        flowering: {
          raw: "63-70 days",
          minDays: 63,
          maxDays: 70,
          minWeeks: 9,
          maxWeeks: 10,
          harvestWindow: "late October"
        },
        breeder: " Soma Seeds ",
        aroma: ["Berry", " ", "Haze"],
        effects: ["Happy", "Creative"],
        rawSourceValues: {
          lineage: "Blueberry x Haze",
          lineageParents: ["Blueberry", "Haze"],
          thc: "18-22%",
          cbd: "<1%",
          flowering: "63-70 days",
          breeder: "Soma Seeds",
          aroma: "berry, haze",
          effects: ["happy", "creative"]
        }
      }
    });

    const built = buildFrontmatterFromClip({
      result,
      settings: DEFAULT_SETTINGS,
      pageType: "web",
      currentTabUrl: result.url
    });

    const extra = built.frontmatter.extra;
    const yaml = buildFrontmatterYaml(built.frontmatter);

    expect(extra?.seedfinder_lineage).toBe("Blueberry x Haze");
    expect(extra?.seedfinder_lineage_parents).toEqual(["Blueberry", "Haze"]);
    expect(extra?.seedfinder_thc_raw).toBe("18-22%");
    expect(extra?.seedfinder_thc_min_percent).toBe(18);
    expect(extra?.seedfinder_thc_max_percent).toBe(22);
    expect(extra?.seedfinder_cbd_raw).toBe("<1%");
    expect(extra?.seedfinder_cbd_max_percent).toBe(1);
    expect(extra?.seedfinder_cbd_comparator).toBe("<");
    expect(extra?.seedfinder_flowering_raw).toBe("63-70 days");
    expect(extra?.seedfinder_flowering_min_days).toBe(63);
    expect(extra?.seedfinder_flowering_max_days).toBe(70);
    expect(extra?.seedfinder_flowering_min_weeks).toBe(9);
    expect(extra?.seedfinder_flowering_max_weeks).toBe(10);
    expect(extra?.seedfinder_flowering_harvest_window).toBe("late October");
    expect(extra?.seedfinder_breeder).toBe("Soma Seeds");
    expect(extra?.seedfinder_aroma).toEqual(["Berry", "Haze"]);
    expect(extra?.seedfinder_effects).toEqual(["Happy", "Creative"]);
    expect(extra?.seedfinder_raw_lineage).toBe("Blueberry x Haze");
    expect(extra?.seedfinder_raw_lineage_parents).toEqual(["Blueberry", "Haze"]);
    expect(extra?.seedfinder_raw_thc).toBe("18-22%");
    expect(extra?.seedfinder_raw_cbd).toBe("<1%");
    expect(extra?.seedfinder_raw_flowering).toBe("63-70 days");
    expect(extra?.seedfinder_raw_breeder).toBe("Soma Seeds");
    expect(extra?.seedfinder_raw_aroma).toEqual(["berry, haze"]);
    expect(extra?.seedfinder_raw_effects).toEqual(["happy", "creative"]);

    expect(extra?.lineage).toBe("Blueberry x Haze");
    expect(extra?.lineage_parents).toEqual(["Blueberry", "Haze"]);

    expect(yaml).toContain('seedfinder_lineage: "Blueberry x Haze"');
    expect(yaml).toContain("seedfinder_thc_min_percent: 18");
    expect(yaml).toContain('seedfinder_cbd_comparator: "<"');
    expect(yaml).toContain("seedfinder_aroma:");
    expect(yaml).toContain("seedfinder_raw_effects:");
    expect(yaml).toContain('lineage: "Blueberry x Haze"');
  });

  test("omits empty SeedFinder profile keys while keeping partial populated values", () => {
    const result = createSeedFinderClipResult({
      seedFinderProfile: {
        lineage: "   ",
        lineageParents: ["", "   "],
        potency: {
          thc: {
            raw: "  ",
            minPercent: 20
          },
          cbd: {
            raw: " ",
            comparator: undefined
          }
        },
        flowering: {
          raw: " ",
          harvestWindow: ""
        },
        breeder: "   ",
        aroma: [" ", ""],
        effects: [],
        rawSourceValues: {
          lineage: " ",
          lineageParents: ["", "   "],
          thc: " ",
          cbd: "",
          flowering: " ",
          breeder: " ",
          aroma: ["", "  "],
          effects: "  "
        }
      }
    });

    const built = buildFrontmatterFromClip({
      result,
      settings: DEFAULT_SETTINGS,
      pageType: "web",
      currentTabUrl: result.url
    });

    const extra = built.frontmatter.extra;
    const yaml = buildFrontmatterYaml(built.frontmatter);

    expect(extra?.seedfinder_thc_min_percent).toBe(20);
    expect(extra?.seedfinder_thc_raw).toBeUndefined();
    expect(extra?.seedfinder_thc_max_percent).toBeUndefined();
    expect(extra?.seedfinder_thc_comparator).toBeUndefined();

    expect(extra?.seedfinder_lineage).toBeUndefined();
    expect(extra?.seedfinder_lineage_parents).toBeUndefined();
    expect(extra?.seedfinder_cbd_raw).toBeUndefined();
    expect(extra?.seedfinder_cbd_min_percent).toBeUndefined();
    expect(extra?.seedfinder_cbd_max_percent).toBeUndefined();
    expect(extra?.seedfinder_cbd_comparator).toBeUndefined();
    expect(extra?.seedfinder_flowering_raw).toBeUndefined();
    expect(extra?.seedfinder_flowering_min_days).toBeUndefined();
    expect(extra?.seedfinder_flowering_max_days).toBeUndefined();
    expect(extra?.seedfinder_flowering_min_weeks).toBeUndefined();
    expect(extra?.seedfinder_flowering_max_weeks).toBeUndefined();
    expect(extra?.seedfinder_flowering_harvest_window).toBeUndefined();
    expect(extra?.seedfinder_breeder).toBeUndefined();
    expect(extra?.seedfinder_aroma).toBeUndefined();
    expect(extra?.seedfinder_effects).toBeUndefined();

    expect(extra?.seedfinder_raw_lineage).toBeUndefined();
    expect(extra?.seedfinder_raw_lineage_parents).toBeUndefined();
    expect(extra?.seedfinder_raw_thc).toBeUndefined();
    expect(extra?.seedfinder_raw_cbd).toBeUndefined();
    expect(extra?.seedfinder_raw_flowering).toBeUndefined();
    expect(extra?.seedfinder_raw_breeder).toBeUndefined();
    expect(extra?.seedfinder_raw_aroma).toBeUndefined();
    expect(extra?.seedfinder_raw_effects).toBeUndefined();

    expect(extra?.lineage).toBeUndefined();
    expect(extra?.lineage_parents).toBeUndefined();

    expect(yaml).toContain("seedfinder_thc_min_percent: 20");
    expect(yaml).not.toContain("seedfinder_lineage:");
    expect(yaml).not.toContain("seedfinder_lineage_parents:");
    expect(yaml).not.toContain("seedfinder_cbd_raw:");
    expect(yaml).not.toContain("seedfinder_flowering_raw:");
    expect(yaml).not.toContain("seedfinder_breeder:");
    expect(yaml).not.toContain("seedfinder_raw_thc:");
    expect(yaml).not.toContain("seedfinder_raw_aroma:");
    expect(yaml).not.toContain("lineage:");
    expect(yaml).not.toContain("lineage_parents:");
  });
});
