import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { Window } from "happy-dom";

import {
  extractSeedFinderProfile,
  extractSeedFinderProfileTableRows,
  mapSeedFinderProfileHeaderToField,
  parseSeedFinderPotencyValue
} from "../../src/content/extractors/seedfinderProfile";

const SEEDFINDER_FIXTURE_PATH = join(import.meta.dir, "..", "templates", "fixtures", "seedfinder-strain.html");
const SEEDFINDER_VARIANT_FIXTURE_PATH = join(
  import.meta.dir,
  "..",
  "templates",
  "fixtures",
  "seedfinder-strain-variant.html"
);
const SEEDFINDER_VARIANT_SPARSE_FIXTURE_PATH = join(
  import.meta.dir,
  "..",
  "templates",
  "fixtures",
  "seedfinder-strain-variant-sparse.html"
);

function createDocument(html: string, url = "https://en.seedfinder.eu/strain-info/Blue_Dream/"): Document {
  const window = new Window({
    url,
    width: 1920,
    height: 1080
  });
  window.document.write(html);
  return window.document;
}

describe("SeedFinder profile header alias mapping", () => {
  test("maps known headers to canonical profile fields", () => {
    const expectations: Array<[string, string | null]> = [
      ["Lineage", "lineage"],
      ["Genetics", "lineage"],
      ["Flowering Time", "flowering"],
      ["THC", "thc"],
      ["CBD %", "cbd"],
      ["Breeder / Seedbank", "breeder"],
      ["Aroma Profile", "aroma"],
      ["Effects", "effects"],
      ["Type", null]
    ];

    for (const [header, expectedField] of expectations) {
      expect(mapSeedFinderProfileHeaderToField(header)).toBe(expectedField);
    }
  });
});

describe("SeedFinder parser edge-case coverage", () => {
  test("maps extended alias variants used by alternate fixtures", () => {
    const expectations: Array<[string, string | null]> = [
      ["Genetic Lineage", "lineage"],
      ["THC/CBD", "potency"],
      ["Flowering Period", "flowering"],
      ["Harvest Window", "flowering"],
      ["Flavour", "aroma"],
      ["Cannabinoid Profile", "potency"]
    ];

    for (const [header, expectedField] of expectations) {
      expect(mapSeedFinderProfileHeaderToField(header)).toBe(expectedField);
    }
  });

  test("parses numeric potency ranges with ordered bounds and '<1%' upper-bound semantics", () => {
    expect(parseSeedFinderPotencyValue("23 to 20%")).toEqual({
      raw: "23 to 20%",
      minPercent: 20,
      maxPercent: 23
    });

    expect(parseSeedFinderPotencyValue("<1%")).toEqual({
      raw: "<1%",
      comparator: "<",
      maxPercent: 1
    });
  });

  test("tolerates sparse profile tables with missing optional fields", () => {
    const html = readFileSync(SEEDFINDER_VARIANT_SPARSE_FIXTURE_PATH, "utf-8");
    const document = createDocument(html, "https://en.seedfinder.eu/strain-info/Sunset_Sherbet_Auto/");
    const contentEl = document.querySelector(".sorte_info");

    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile).not.toBeNull();
    expect(profile?.seedFinderProfile.lineage).toBe("Sunset Sherbet x Ruderalis");
    expect(profile?.seedFinderProfile.potency?.thc).toEqual({
      raw: "20-23%",
      minPercent: 20,
      maxPercent: 23
    });
    expect(profile?.seedFinderProfile.potency?.cbd).toEqual({
      raw: "<1%",
      comparator: "<",
      maxPercent: 1
    });
    expect(profile?.seedFinderProfile.flowering).toEqual({
      raw: "63-67 days | late September",
      minDays: 63,
      maxDays: 67,
      minWeeks: 9,
      maxWeeks: 9.57,
      harvestWindow: "late September"
    });
    expect(profile?.seedFinderProfile.aroma).toBeUndefined();
    expect(profile?.seedFinderProfile.effects).toBeUndefined();
    expect(profile?.seedFinderProfile.rawSourceValues?.aroma).toBeUndefined();
    expect(profile?.seedFinderProfile.rawSourceValues?.effects).toBeUndefined();
  });
});

describe("SeedFinder table-row normalization", () => {
  test("extracts canonical rows from the SeedFinder fixture table", () => {
    const html = readFileSync(SEEDFINDER_FIXTURE_PATH, "utf-8");
    const document = createDocument(html);
    const contentEl = document.querySelector(".sorte_info");

    expect(contentEl).not.toBeNull();

    const rows = extractSeedFinderProfileTableRows(contentEl!);
    const rowByField = new Map(rows.map((row) => [row.field, row.value]));

    expect(rowByField.get("lineage")).toBe("Blueberry × Haze");
    expect(rowByField.get("flowering")).toBe("63-70 days");
    expect(rowByField.get("thc")).toBe("17-24%");
    expect(rowByField.get("cbd")).toBe("<1%");
    expect(rowByField.get("aroma")).toBe("Berry, Sweet, Herbal");
  });

  test("extracts sparse variant fixture rows with alternate labels and mixed unit formats", () => {
    const html = readFileSync(SEEDFINDER_VARIANT_FIXTURE_PATH, "utf-8");
    const document = createDocument(html, "https://en.seedfinder.eu/strain-info/Gelato_33/");
    const contentEl = document.querySelector(".sorte_info");

    expect(contentEl).not.toBeNull();

    const rows = extractSeedFinderProfileTableRows(contentEl!);
    const floweringRows = rows.filter((row) => row.field === "flowering");
    const rowByField = new Map(rows.map((row) => [row.field, row.value]));

    expect(floweringRows).toHaveLength(2);
    expect(floweringRows.map((row) => row.value)).toEqual([
      "9-10 weeks",
      "Late September to early October"
    ]);
    expect(rowByField.get("lineage")).toBe("Gelato × G13");
    expect(rowByField.get("thc")).toBe(">=18%");
    expect(rowByField.get("cbd")).toBe("0.4%");
    expect(rowByField.get("breeder")).toBe("Garden of the Gods Seedbank");
    expect(rowByField.get("aroma")).toBeUndefined();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile?.seedFinderProfile?.lineage).toBe("Gelato x G13");
    expect(profile?.seedFinderProfile?.lineageParents).toEqual(["Gelato", "G13"]);
    expect(profile?.seedFinderProfile?.potency?.thc).toEqual({
      raw: ">=18%",
      comparator: ">=",
      minPercent: 18
    });
    expect(profile?.seedFinderProfile?.potency?.cbd).toEqual({
      raw: "0.4%",
      minPercent: 0.4,
      maxPercent: 0.4
    });
    expect(profile?.seedFinderProfile?.flowering).toEqual({
      raw: "9-10 weeks | Late September to early October",
      minDays: 63,
      maxDays: 70,
      minWeeks: 9,
      maxWeeks: 10,
      harvestWindow: "Late September to early October"
    });
    expect(profile?.seedFinderProfile?.breeder).toBe("Garden of the Gods Seedbank");
    expect(profile?.seedFinderProfile?.rawSourceValues?.flowering).toBe(
      "9-10 weeks | Late September to early October"
    );
  });

  test("lineage extraction uses normalized table alias headers", () => {
    const document = createDocument(`
      <article class="sorte_info">
        <table>
          <tr>
            <th>Genetics</th>
            <td>Blueberry × Haze</td>
          </tr>
        </table>
      </article>
    `);

    const contentEl = document.querySelector(".sorte_info");
    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile?.lineage).toBe("Blueberry x Haze");
    expect(profile?.lineageParents).toEqual(["Blueberry", "Haze"]);
    expect(profile?.seedFinderProfile.lineage).toBe("Blueberry x Haze");
    expect(profile?.seedFinderProfile.lineageParents).toEqual(["Blueberry", "Haze"]);
  });
});

describe("SeedFinder potency parsing", () => {
  test("parses comparator and range variants with raw value preservation", () => {
    const expectations: Array<{
      raw: string;
      comparator?: "<" | "<=" | ">" | ">=" | "~";
      minPercent?: number;
      maxPercent?: number;
    }> = [
      { raw: "<1%", comparator: "<", maxPercent: 1 },
      { raw: "<=1%", comparator: "<=", maxPercent: 1 },
      { raw: ">20%", comparator: ">", minPercent: 20 },
      { raw: ">=20%", comparator: ">=", minPercent: 20 },
      { raw: "~18%", comparator: "~", minPercent: 18, maxPercent: 18 },
      { raw: "17-24%", minPercent: 17, maxPercent: 24 },
      { raw: "21%", minPercent: 21, maxPercent: 21 }
    ];

    for (const expectation of expectations) {
      const parsed = parseSeedFinderPotencyValue(expectation.raw);
      expect(parsed).not.toBeNull();
      expect(parsed?.raw).toBe(expectation.raw);
      expect(parsed?.comparator).toBe(expectation.comparator);
      expect(parsed?.minPercent).toBe(expectation.minPercent);
      expect(parsed?.maxPercent).toBe(expectation.maxPercent);
    }
  });

  test("extracts profile contracts with potency + non-lineage fields and raw source values", () => {
    const html = readFileSync(SEEDFINDER_FIXTURE_PATH, "utf-8");
    const document = createDocument(html);
    const contentEl = document.querySelector(".sorte_info");

    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile?.lineage).toBe("Blueberry x Haze");
    expect(profile?.lineageParents).toEqual(["Blueberry", "Haze"]);
    expect(profile?.seedFinderProfile?.potency?.thc).toEqual({
      raw: "17-24%",
      minPercent: 17,
      maxPercent: 24
    });
    expect(profile?.seedFinderProfile?.potency?.cbd).toEqual({
      raw: "<1%",
      comparator: "<",
      maxPercent: 1
    });
    expect(profile?.seedFinderProfile?.flowering).toEqual({
      raw: "63-70 days",
      minDays: 63,
      maxDays: 70,
      minWeeks: 9,
      maxWeeks: 10
    });
    expect(profile?.seedFinderProfile?.breeder).toBe("Humboldt Seed Organization");
    expect(profile?.seedFinderProfile?.aroma).toEqual(["Berry", "Sweet", "Herbal"]);

    expect(profile?.seedFinderProfile?.rawSourceValues?.lineage).toBe("Blueberry × Haze");
    expect(profile?.seedFinderProfile?.rawSourceValues?.lineageParents).toEqual(["Blueberry", "Haze"]);
    expect(profile?.seedFinderProfile?.rawSourceValues?.thc).toBe("17-24%");
    expect(profile?.seedFinderProfile?.rawSourceValues?.cbd).toBe("<1%");
    expect(profile?.seedFinderProfile?.rawSourceValues?.flowering).toBe("63-70 days");
    expect(profile?.seedFinderProfile?.rawSourceValues?.breeder).toBe("Humboldt Seed Organization");
    expect(profile?.seedFinderProfile?.rawSourceValues?.aroma).toEqual(["Berry", "Sweet", "Herbal"]);
  });

  test("parses combined THC/CBD potency row fallback", () => {
    const document = createDocument(`
      <article class="sorte_info">
        <table>
          <tr>
            <th>Lineage</th>
            <td>Blueberry x Haze</td>
          </tr>
          <tr>
            <th>THC/CBD</th>
            <td>&gt;=21% / ~0.5%</td>
          </tr>
        </table>
      </article>
    `);

    const contentEl = document.querySelector(".sorte_info");
    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile?.seedFinderProfile?.potency?.thc).toEqual({
      raw: ">=21%",
      comparator: ">=",
      minPercent: 21
    });
    expect(profile?.seedFinderProfile?.potency?.cbd).toEqual({
      raw: "~0.5%",
      comparator: "~",
      minPercent: 0.5,
      maxPercent: 0.5
    });

    expect(profile?.seedFinderProfile?.rawSourceValues?.thc).toBe(">=21%");
    expect(profile?.seedFinderProfile?.rawSourceValues?.cbd).toBe("~0.5%");
  });

  test("respects explicit CBD/THC ordering in combined potency rows", () => {
    const document = createDocument(`
      <article class="sorte_info">
        <table>
          <tr>
            <th>Lineage</th>
            <td>Blueberry x Haze</td>
          </tr>
          <tr>
            <th>CBD/THC</th>
            <td>0.8% / 22%</td>
          </tr>
        </table>
      </article>
    `);

    const contentEl = document.querySelector(".sorte_info");
    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile?.seedFinderProfile?.potency?.cbd).toEqual({
      raw: "0.8%",
      minPercent: 0.8,
      maxPercent: 0.8
    });
    expect(profile?.seedFinderProfile?.potency?.thc).toEqual({
      raw: "22%",
      minPercent: 22,
      maxPercent: 22
    });

    expect(profile?.seedFinderProfile?.rawSourceValues?.cbd).toBe("0.8%");
    expect(profile?.seedFinderProfile?.rawSourceValues?.thc).toBe("22%");
  });
});

describe("SeedFinder flowering parsing", () => {
  test("normalizes weeks into days and extracts harvest window cues", () => {
    const document = createDocument(`
      <article class="sorte_info">
        <table>
          <tr>
            <th>Lineage</th>
            <td>Blueberry x Haze</td>
          </tr>
          <tr>
            <th>Flowering Time</th>
            <td>9-10 weeks (harvest in early to mid-October)</td>
          </tr>
        </table>
      </article>
    `);

    const contentEl = document.querySelector(".sorte_info");
    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile?.seedFinderProfile?.flowering).toEqual({
      raw: "9-10 weeks (harvest in early to mid-October)",
      minDays: 63,
      maxDays: 70,
      minWeeks: 9,
      maxWeeks: 10,
      harvestWindow: "early to mid-October"
    });
    expect(profile?.seedFinderProfile?.rawSourceValues?.flowering).toBe(
      "9-10 weeks (harvest in early to mid-October)"
    );
  });

  test("retains raw flowering value when no numeric duration is inferable", () => {
    const document = createDocument(`
      <article class="sorte_info">
        <table>
          <tr>
            <th>Lineage</th>
            <td>Blueberry x Haze</td>
          </tr>
          <tr>
            <th>Flowering Time</th>
            <td>around two months depending on phenotype</td>
          </tr>
        </table>
      </article>
    `);

    const contentEl = document.querySelector(".sorte_info");
    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile?.seedFinderProfile?.flowering).toEqual({
      raw: "around two months depending on phenotype"
    });
    expect(profile?.seedFinderProfile?.rawSourceValues?.flowering).toBe(
      "around two months depending on phenotype"
    );
  });

  test("extracts harvest-window-only rows via header aliases", () => {
    const document = createDocument(`
      <article class="sorte_info">
        <table>
          <tr>
            <th>Lineage</th>
            <td>Blueberry x Haze</td>
          </tr>
          <tr>
            <th>Harvest Window</th>
            <td>Late September to early October</td>
          </tr>
        </table>
      </article>
    `);

    const contentEl = document.querySelector(".sorte_info");
    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile?.seedFinderProfile?.flowering).toEqual({
      raw: "Late September to early October",
      harvestWindow: "Late September to early October"
    });
    expect(profile?.seedFinderProfile?.rawSourceValues?.flowering).toBe("Late September to early October");
  });
});

describe("SeedFinder breeder extraction", () => {
  test("prefers table breeder value over selector/prose fallbacks", () => {
    const document = createDocument(`
      <article class="sorte_info">
        <table>
          <tr>
            <th>Lineage</th>
            <td>Blueberry x Haze</td>
          </tr>
          <tr>
            <th>Breeder / Seedbank</th>
            <td>  Humboldt Seed Organization  </td>
          </tr>
        </table>

        <p class="sorte_zuechter">
          Breeder: <a href="/breeder/other-seedbank/">Other Seedbank</a>
        </p>

        <p>Bred by Third Seedbank.</p>
      </article>
    `);

    const contentEl = document.querySelector(".sorte_info");
    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile?.seedFinderProfile?.breeder).toBe("Humboldt Seed Organization");
    expect(profile?.seedFinderProfile?.rawSourceValues?.breeder).toBe("Humboldt Seed Organization");
  });

  test("falls back to selector/prose values with trim + dedupe safeguards", () => {
    const document = createDocument(`
      <article class="sorte_info">
        <table>
          <tr>
            <th>Lineage</th>
            <td>Blueberry x Haze</td>
          </tr>
        </table>

        <p class="sorte_zuechter">
          <a href="/breeder/humboldt-seed-organization/">Breeder: Humboldt Seed Organization</a>
        </p>

        <p>Breeder: Humboldt Seed Organization.</p>
      </article>
    `);

    const contentEl = document.querySelector(".sorte_info");
    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile?.seedFinderProfile?.breeder).toBe("Humboldt Seed Organization");
    expect(profile?.seedFinderProfile?.rawSourceValues?.breeder).toBe("Humboldt Seed Organization");
  });
});

describe("SeedFinder aroma/effects normalization", () => {
  test("normalizes delimited values into deterministic arrays with dedupe", () => {
    const document = createDocument(`
      <article class="sorte_info">
        <table>
          <tr>
            <th>Lineage</th>
            <td>Blueberry x Haze</td>
          </tr>
          <tr>
            <th>Aroma Profile</th>
            <td>Aroma profile: Berry, Sweet / Herbal; Sweet and Citrus & Berry</td>
          </tr>
          <tr>
            <th>Effects</th>
            <td>Effects: Clear-headed euphoria; calm body relaxation and creative focus</td>
          </tr>
        </table>
      </article>
    `);

    const contentEl = document.querySelector(".sorte_info");
    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile?.seedFinderProfile?.aroma).toEqual(["Berry", "Sweet", "Herbal", "Citrus"]);
    expect(profile?.seedFinderProfile?.effects).toEqual([
      "Clear-headed euphoria",
      "calm body relaxation",
      "creative focus"
    ]);
    expect(profile?.seedFinderProfile?.rawSourceValues?.aroma).toEqual(["Berry", "Sweet", "Herbal", "Citrus"]);
    expect(profile?.seedFinderProfile?.rawSourceValues?.effects).toEqual([
      "Clear-headed euphoria",
      "calm body relaxation",
      "creative focus"
    ]);
  });

  test("drops empty or placeholder list values", () => {
    const document = createDocument(`
      <article class="sorte_info">
        <table>
          <tr>
            <th>Lineage</th>
            <td>Blueberry x Haze</td>
          </tr>
          <tr>
            <th>Aroma</th>
            <td>n/a, unknown, none</td>
          </tr>
          <tr>
            <th>Effects</th>
            <td> - </td>
          </tr>
        </table>
      </article>
    `);

    const contentEl = document.querySelector(".sorte_info");
    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile?.seedFinderProfile?.aroma).toBeUndefined();
    expect(profile?.seedFinderProfile?.effects).toBeUndefined();
    expect(profile?.seedFinderProfile?.rawSourceValues?.aroma).toBeUndefined();
    expect(profile?.seedFinderProfile?.rawSourceValues?.effects).toBeUndefined();
  });
});

describe("SeedFinder profile assembly", () => {
  test("assembles nested seedFinderProfile output and retains lineage compatibility fields", () => {
    const html = readFileSync(SEEDFINDER_FIXTURE_PATH, "utf-8");
    const document = createDocument(html);
    const contentEl = document.querySelector(".sorte_info");

    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile).not.toBeNull();
    expect(profile?.seedFinderProfile).toBeDefined();
    expect(profile?.seedFinderProfile.lineage).toBe("Blueberry x Haze");
    expect(profile?.seedFinderProfile.lineageParents).toEqual(["Blueberry", "Haze"]);
    expect(profile?.lineage).toBe("Blueberry x Haze");
    expect(profile?.lineageParents).toEqual(["Blueberry", "Haze"]);
  });

  test("returns partial seedFinderProfile when only a subset of fields is present", () => {
    const document = createDocument(`
      <article class="sorte_info">
        <table>
          <tr>
            <th>Breeder</th>
            <td>Humboldt Seed Organization</td>
          </tr>
          <tr>
            <th>Aroma</th>
            <td>Berry / Sweet</td>
          </tr>
        </table>
      </article>
    `);

    const contentEl = document.querySelector(".sorte_info");
    expect(contentEl).not.toBeNull();

    const profile = extractSeedFinderProfile(document, contentEl!);

    expect(profile).not.toBeNull();
    expect(profile?.seedFinderProfile.breeder).toBe("Humboldt Seed Organization");
    expect(profile?.seedFinderProfile.aroma).toEqual(["Berry", "Sweet"]);
    expect(profile?.lineage).toBeUndefined();
    expect(profile?.lineageParents).toBeUndefined();
  });
});
