import type {
  SeedFinderFloweringProfile,
  SeedFinderPotencyProfile,
  SeedFinderPotencyValue,
  SeedFinderStrainProfile,
  SeedFinderStrainProfileRawSourceValues
} from "../../shared/types";
import type { SiteTemplate } from "../../shared/templates";

export interface SeedFinderProfileExtraction {
  seedFinderProfile: SeedFinderStrainProfile;

  // Legacy compatibility fields retained while metadata migration lands.
  lineage?: string;
  lineageParents?: string[];
}

interface SeedFinderLineageExtraction {
  normalized: string;
  parents: string[];
  rawValue: string;
}

interface SeedFinderPotencyExtraction {
  potency: SeedFinderPotencyProfile;
  rawSourceValues: Pick<SeedFinderStrainProfileRawSourceValues, "thc" | "cbd">;
}

export type SeedFinderProfileCanonicalField =
  | "lineage"
  | "potency"
  | "thc"
  | "cbd"
  | "flowering"
  | "breeder"
  | "aroma"
  | "effects";

export interface SeedFinderProfileTableRow {
  field: SeedFinderProfileCanonicalField;
  rawHeader: string;
  normalizedHeader: string;
  rawValue: string;
  value: string;
}

const PROFILE_HEADER_ALIASES: Record<SeedFinderProfileCanonicalField, readonly string[]> = {
  lineage: [
    "lineage",
    "genetics",
    "genetic",
    "genetic lineage",
    "parentage",
    "cross",
    "crosses"
  ],
  potency: [
    "potency",
    "potency profile",
    "cannabinoids",
    "cannabinoid profile",
    "thc cbd",
    "thc/cbd",
    "cbd/thc"
  ],
  thc: ["thc", "thc content", "thc level", "thc %", "tetrahydrocannabinol"],
  cbd: ["cbd", "cbd content", "cbd level", "cbd %", "cannabidiol"],
  flowering: [
    "flowering",
    "flowering time",
    "flowering period",
    "flower time",
    "blooming time",
    "harvest window"
  ],
  breeder: ["breeder", "breeder seedbank", "seedbank", "bred by", "created by"],
  aroma: ["aroma", "aroma profile", "smell", "flavor", "flavour", "terpenes"],
  effects: ["effects", "effect", "effect profile", "high", "buzz", "experience"]
};

const PROFILE_HEADER_ALIAS_LOOKUP = new Map<string, SeedFinderProfileCanonicalField>();
for (const [field, aliases] of Object.entries(PROFILE_HEADER_ALIASES) as Array<
  [SeedFinderProfileCanonicalField, readonly string[]]
>) {
  for (const alias of aliases) {
    PROFILE_HEADER_ALIAS_LOOKUP.set(normalizeSeedFinderProfileHeader(alias), field);
  }
}

/**
 * True when the active template/page URL represents a SeedFinder strain profile.
 */
export function isSeedFinderStrainTemplate(
  template: SiteTemplate,
  pageUrl: string
): boolean {
  if (!template.domain.toLowerCase().includes("seedfinder.eu")) {
    return false;
  }

  try {
    return /\/strain-info\//i.test(new URL(pageUrl).pathname);
  } catch {
    return /\/strain-info\//i.test(pageUrl);
  }
}

/**
 * Parse SeedFinder profile fields from table/prose cues.
 */
export function extractSeedFinderProfile(
  doc: Document,
  contentEl: Element
): SeedFinderProfileExtraction | null {
  const rows = extractSeedFinderRows(doc, contentEl);
  const lineage = extractSeedFinderLineage(doc, contentEl);
  const potency = extractSeedFinderPotency(rows);
  const flowering = extractSeedFinderFlowering(rows);
  const breeder = extractSeedFinderBreeder(doc, contentEl, rows);
  const aroma = extractSeedFinderListField(rows, "aroma");
  const effects = extractSeedFinderListField(rows, "effects");

  if (!lineage && !potency && !flowering && !breeder && !aroma && !effects) {
    return null;
  }

  const seedFinderProfile: SeedFinderStrainProfile = {};
  const rawSourceValues: SeedFinderStrainProfileRawSourceValues = {};

  if (lineage) {
    seedFinderProfile.lineage = lineage.normalized;
    seedFinderProfile.lineageParents = lineage.parents;
    rawSourceValues.lineage = lineage.rawValue;
    rawSourceValues.lineageParents = [...lineage.parents];
  }

  if (potency) {
    seedFinderProfile.potency = potency.potency;

    if (potency.rawSourceValues.thc) {
      rawSourceValues.thc = potency.rawSourceValues.thc;
    }
    if (potency.rawSourceValues.cbd) {
      rawSourceValues.cbd = potency.rawSourceValues.cbd;
    }
  }

  if (flowering) {
    seedFinderProfile.flowering = flowering;
    if (flowering.raw) {
      rawSourceValues.flowering = flowering.raw;
    }
  }

  if (breeder) {
    seedFinderProfile.breeder = breeder;
    rawSourceValues.breeder = breeder;
  }

  if (aroma) {
    seedFinderProfile.aroma = aroma;
    rawSourceValues.aroma = [...aroma];
  }

  if (effects) {
    seedFinderProfile.effects = effects;
    rawSourceValues.effects = [...effects];
  }

  if (Object.keys(rawSourceValues).length > 0) {
    seedFinderProfile.rawSourceValues = rawSourceValues;
  }

  const profile: SeedFinderProfileExtraction = {
    seedFinderProfile
  };

  if (seedFinderProfile.lineage) {
    profile.lineage = seedFinderProfile.lineage;
  }

  if (seedFinderProfile.lineageParents && seedFinderProfile.lineageParents.length > 0) {
    profile.lineageParents = [...seedFinderProfile.lineageParents];
  }

  return profile;
}

/**
 * Render normalized SeedFinder profile values into a deterministic markdown block.
 */
export function renderSeedFinderProfileMarkdown(profile: SeedFinderStrainProfile): string {
  const lines: string[] = [];

  const lineage = normalizeSeedFinderText(profile.lineage || "");
  if (lineage) {
    lines.push(renderSeedFinderProfileLine("Lineage", lineage));
  }

  if (profile.lineageParents?.length) {
    const parents = profile.lineageParents
      .map((parent) => normalizeSeedFinderText(parent))
      .filter((parent): parent is string => Boolean(parent));
    if (parents.length > 0) {
      lines.push(renderSeedFinderProfileLine("Lineage Parents", parents.join(", ")));
    }
  }

  const thc = formatSeedFinderPotencyMarkdownValue(profile.potency?.thc);
  if (thc) {
    lines.push(renderSeedFinderProfileLine("THC", thc));
  }

  const cbd = formatSeedFinderPotencyMarkdownValue(profile.potency?.cbd);
  if (cbd) {
    lines.push(renderSeedFinderProfileLine("CBD", cbd));
  }

  const flowering = formatSeedFinderFloweringMarkdownValue(profile.flowering);
  if (flowering) {
    lines.push(renderSeedFinderProfileLine("Flowering", flowering));
  }

  const harvestWindow = normalizeSeedFinderText(profile.flowering?.harvestWindow || "");
  if (harvestWindow) {
    lines.push(renderSeedFinderProfileLine("Harvest Window", harvestWindow));
  }

  const breeder = normalizeSeedFinderText(profile.breeder || "");
  if (breeder) {
    lines.push(renderSeedFinderProfileLine("Breeder", breeder));
  }

  const aroma = formatSeedFinderListMarkdownValue(profile.aroma);
  if (aroma) {
    lines.push(renderSeedFinderProfileLine("Aroma", aroma));
  }

  const effects = formatSeedFinderListMarkdownValue(profile.effects);
  if (effects) {
    lines.push(renderSeedFinderProfileLine("Effects", effects));
  }

  if (lines.length === 0) {
    return "";
  }

  return `## Strain Profile\n\n${lines.join("\n")}`;
}

function renderSeedFinderProfileLine(label: string, value: string): string {
  return `- **${label}**: ${value}`;
}

function formatSeedFinderListMarkdownValue(values?: string[]): string | null {
  if (!values || values.length === 0) {
    return null;
  }

  const normalizedValues = values
    .map((value) => normalizeSeedFinderText(value))
    .filter((value): value is string => Boolean(value));

  if (normalizedValues.length === 0) {
    return null;
  }

  return normalizedValues.join(", ");
}

function formatSeedFinderPotencyMarkdownValue(value?: SeedFinderPotencyValue): string | null {
  if (!value) {
    return null;
  }

  const comparator = value.comparator || "";
  const hasMin = typeof value.minPercent === "number";
  const hasMax = typeof value.maxPercent === "number";

  if (hasMin && hasMax) {
    const min = Math.min(value.minPercent!, value.maxPercent!);
    const max = Math.max(value.minPercent!, value.maxPercent!);
    if (min === max) {
      return `${comparator}${formatSeedFinderMarkdownNumber(min)}%`;
    }

    return `${comparator}${formatSeedFinderMarkdownNumber(min)}-${formatSeedFinderMarkdownNumber(max)}%`;
  }

  if (hasMin) {
    return `${comparator}${formatSeedFinderMarkdownNumber(value.minPercent!)}%`;
  }

  if (hasMax) {
    return `${comparator}${formatSeedFinderMarkdownNumber(value.maxPercent!)}%`;
  }

  const raw = normalizeSeedFinderText(value.raw || "");
  return raw || null;
}

function formatSeedFinderFloweringMarkdownValue(
  flowering?: SeedFinderFloweringProfile
): string | null {
  if (!flowering) {
    return null;
  }

  const days = formatSeedFinderDurationRange(flowering.minDays, flowering.maxDays, "days");
  const weeks = formatSeedFinderDurationRange(flowering.minWeeks, flowering.maxWeeks, "weeks");

  if (days && weeks) {
    return `${days} (${weeks})`;
  }

  if (days || weeks) {
    return days || weeks;
  }

  const raw = normalizeSeedFinderText(flowering.raw || "");
  return raw || null;
}

function formatSeedFinderDurationRange(
  minValue: number | undefined,
  maxValue: number | undefined,
  unit: "days" | "weeks"
): string | null {
  const hasMin = typeof minValue === "number";
  const hasMax = typeof maxValue === "number";

  if (!hasMin && !hasMax) {
    return null;
  }

  if (hasMin && hasMax) {
    const lower = Math.min(minValue!, maxValue!);
    const upper = Math.max(minValue!, maxValue!);
    if (lower === upper) {
      return `${formatSeedFinderMarkdownNumber(lower)} ${unit}`;
    }

    return `${formatSeedFinderMarkdownNumber(lower)}-${formatSeedFinderMarkdownNumber(upper)} ${unit}`;
  }

  const value = hasMin ? minValue! : maxValue!;
  return `${formatSeedFinderMarkdownNumber(value)} ${unit}`;
}

function formatSeedFinderMarkdownNumber(value: number): string {
  const rounded = Number.parseFloat(value.toFixed(4));
  return Number.isFinite(rounded) ? `${rounded}` : `${value}`;
}

/**
 * Normalize a table header string so alias matching can be deterministic.
 */
export function normalizeSeedFinderProfileHeader(rawHeader: string): string {
  return normalizeSeedFinderText(rawHeader)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[–—−]+/g, "-")
    .replace(/[×✕✖]/g, " x ")
    .replace(/[_/|:]+/g, " ")
    .replace(/[^a-z0-9%+&\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:-]+|[\s:-]+$/g, "");
}

/**
 * Map any known SeedFinder profile table header to a canonical field key.
 */
export function mapSeedFinderProfileHeaderToField(
  rawHeader: string
): SeedFinderProfileCanonicalField | null {
  const normalizedHeader = normalizeSeedFinderProfileHeader(rawHeader);
  if (!normalizedHeader) {
    return null;
  }

  const direct = PROFILE_HEADER_ALIAS_LOOKUP.get(normalizedHeader);
  if (direct) {
    return direct;
  }

  for (const [alias, field] of PROFILE_HEADER_ALIAS_LOOKUP) {
    if (
      normalizedHeader.startsWith(`${alias} `) ||
      normalizedHeader.endsWith(` ${alias}`) ||
      normalizedHeader.includes(` ${alias} `)
    ) {
      return field;
    }
  }

  return null;
}

/**
 * Extract canonicalized profile rows from SeedFinder metadata tables.
 */
export function extractSeedFinderProfileTableRows(root: ParentNode): SeedFinderProfileTableRow[] {
  const rows = Array.from(root.querySelectorAll("table tr"));
  const extractedRows: SeedFinderProfileTableRow[] = [];

  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll("th, td"));
    if (cells.length < 2) {
      continue;
    }

    const rawHeader = cells[0]?.textContent || "";
    const normalizedHeader = normalizeSeedFinderProfileHeader(rawHeader);
    const field = mapSeedFinderProfileHeaderToField(rawHeader);
    if (!field) {
      continue;
    }

    const rawValue = cells
      .slice(1)
      .map((cell) => cell.textContent || "")
      .join(" ");
    const value = normalizeSeedFinderText(rawValue).replace(/^[\s:;-]+/, "");
    if (!value) {
      continue;
    }

    extractedRows.push({
      field,
      rawHeader,
      normalizedHeader,
      rawValue,
      value
    });
  }

  return extractedRows;
}

function extractSeedFinderRows(doc: Document, contentEl: Element): SeedFinderProfileTableRow[] {
  return [...extractSeedFinderProfileTableRows(contentEl), ...extractSeedFinderProfileTableRows(doc)];
}

function extractSeedFinderFlowering(
  rows: SeedFinderProfileTableRow[]
): SeedFinderFloweringProfile | null {
  const floweringRows = rows.filter((row) => row.field === "flowering");
  if (floweringRows.length === 0) {
    return null;
  }

  const rawFlowering = Array.from(
    new Set(
      floweringRows
        .map((row) => normalizeSeedFinderText(row.value))
        .filter((value): value is string => Boolean(value))
    )
  ).join(" | ");

  const profile: SeedFinderFloweringProfile = {
    raw: rawFlowering
  };

  for (const row of floweringRows) {
    const duration = parseSeedFinderFloweringDuration(row.value);
    if (duration) {
      applySeedFinderFloweringDuration(profile, duration);
    }

    if (!profile.harvestWindow) {
      const harvestWindow = extractSeedFinderHarvestWindow(row);
      if (harvestWindow) {
        profile.harvestWindow = harvestWindow;
      }
    }
  }

  normalizeSeedFinderFloweringUnits(profile);

  return profile;
}

function parseSeedFinderFloweringDuration(
  value: string
): { min: number; max: number; unit: "days" | "weeks" } | null {
  const normalized = normalizeSeedFinderText(value);
  if (!normalized) {
    return null;
  }

  const rangeMatch = normalized.match(
    /(-?\d+(?:[.,]\d+)?)\s*(?:-|–|—|to)\s*(-?\d+(?:[.,]\d+)?)\s*(days?|day|d|weeks?|week|wks?|wk|w)/i
  );

  if (rangeMatch) {
    const first = parseSeedFinderPercentNumber(rangeMatch[1]);
    const second = parseSeedFinderPercentNumber(rangeMatch[2]);
    const unit = normalizeSeedFinderFloweringUnit(rangeMatch[3]);

    if (first !== null && second !== null && unit) {
      return {
        min: Math.min(first, second),
        max: Math.max(first, second),
        unit
      };
    }
  }

  const singleMatch = normalized.match(
    /(-?\d+(?:[.,]\d+)?)\s*(days?|day|d|weeks?|week|wks?|wk|w)/i
  );

  if (!singleMatch) {
    return null;
  }

  const numericValue = parseSeedFinderPercentNumber(singleMatch[1]);
  const unit = normalizeSeedFinderFloweringUnit(singleMatch[2]);
  if (numericValue === null || !unit) {
    return null;
  }

  return {
    min: numericValue,
    max: numericValue,
    unit
  };
}

function normalizeSeedFinderFloweringUnit(rawUnit: string): "days" | "weeks" | null {
  const unit = rawUnit.toLowerCase();

  if (/^(?:d|day|days)$/.test(unit)) {
    return "days";
  }

  if (/^(?:w|wk|wks|week|weeks)$/.test(unit)) {
    return "weeks";
  }

  return null;
}

function applySeedFinderFloweringDuration(
  profile: SeedFinderFloweringProfile,
  duration: { min: number; max: number; unit: "days" | "weeks" }
): void {
  if (duration.unit === "days") {
    profile.minDays =
      profile.minDays === undefined ? duration.min : Math.min(profile.minDays, duration.min);
    profile.maxDays =
      profile.maxDays === undefined ? duration.max : Math.max(profile.maxDays, duration.max);
    return;
  }

  profile.minWeeks =
    profile.minWeeks === undefined ? duration.min : Math.min(profile.minWeeks, duration.min);
  profile.maxWeeks =
    profile.maxWeeks === undefined ? duration.max : Math.max(profile.maxWeeks, duration.max);
}

function normalizeSeedFinderFloweringUnits(profile: SeedFinderFloweringProfile): void {
  const hasDays = profile.minDays !== undefined || profile.maxDays !== undefined;
  const hasWeeks = profile.minWeeks !== undefined || profile.maxWeeks !== undefined;

  if (hasWeeks && !hasDays) {
    if (profile.minWeeks !== undefined) {
      profile.minDays = normalizeSeedFinderFloweringNumber(profile.minWeeks * 7);
    }
    if (profile.maxWeeks !== undefined) {
      profile.maxDays = normalizeSeedFinderFloweringNumber(profile.maxWeeks * 7);
    }
  }

  if (hasDays && !hasWeeks) {
    if (profile.minDays !== undefined) {
      profile.minWeeks = normalizeSeedFinderFloweringNumber(profile.minDays / 7);
    }
    if (profile.maxDays !== undefined) {
      profile.maxWeeks = normalizeSeedFinderFloweringNumber(profile.maxDays / 7);
    }
  }
}

function normalizeSeedFinderFloweringNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }

  return Number.isInteger(value) ? value : Number.parseFloat(value.toFixed(2));
}

function extractSeedFinderHarvestWindow(row: SeedFinderProfileTableRow): string | null {
  if (row.normalizedHeader.includes("harvest")) {
    return normalizeSeedFinderHarvestWindowText(row.value);
  }

  return extractSeedFinderHarvestWindowFromValue(row.value);
}

function extractSeedFinderHarvestWindowFromValue(value: string): string | null {
  const normalized = normalizeSeedFinderText(value);
  if (!normalized) {
    return null;
  }

  const explicitHarvestMatch = normalized.match(
    /\bharvest(?:\s+window|\s+time)?\s*(?:is|:|usually|typically|normally|often|lands|falls|around|during|in|by)?\s*([^.;\n]+)/i
  );
  if (explicitHarvestMatch?.[1]) {
    return normalizeSeedFinderHarvestWindowText(explicitHarvestMatch[1]);
  }

  const monthWindowMatch = normalized.match(
    /\b(?:early\s+to\s+mid|mid\s+to\s+late|early\s+to\s+late|early|mid|late|start(?:\s+of)?|beginning(?:\s+of)?|end(?:\s+of)?)?\s*-?\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*(?:to|-|–|—)\s*(?:early|mid|late|start(?:\s+of)?|beginning(?:\s+of)?|end(?:\s+of)?)?\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?))?/i
  );

  if (monthWindowMatch?.[0]) {
    return normalizeSeedFinderHarvestWindowText(monthWindowMatch[0]);
  }

  return null;
}

function normalizeSeedFinderHarvestWindowText(value: string): string {
  return normalizeSeedFinderText(value)
    .replace(/^[\s:;,\-()]+/, "")
    .replace(/^(?:in|around|during|by)\s+/i, "")
    .replace(/[\s.;,)\]]+$/, "");
}

const SEEDFINDER_BREEDER_SELECTORS = [
  ".sorte_zuechter a",
  ".breeder a",
  "a[href*='/breeder/']"
] as const;

function extractSeedFinderBreeder(
  doc: Document,
  contentEl: Element,
  rows: SeedFinderProfileTableRow[]
): string | null {
  const tableCandidates = dedupeSeedFinderBreederValues(
    rows.filter((row) => row.field === "breeder").map((row) => row.value)
  );
  if (tableCandidates.length > 0) {
    return tableCandidates[0];
  }

  const selectorCandidates = dedupeSeedFinderBreederValues([
    ...extractSeedFinderBreederFromSelectors(contentEl),
    ...extractSeedFinderBreederFromSelectors(doc)
  ]);

  const proseCandidates = dedupeSeedFinderBreederValues([
    ...extractSeedFinderBreederFromProse(contentEl),
    ...extractSeedFinderBreederFromProse(doc)
  ]);

  return dedupeSeedFinderBreederValues([...selectorCandidates, ...proseCandidates])[0] ?? null;
}

function extractSeedFinderBreederFromSelectors(root: ParentNode): string[] {
  const values: string[] = [];

  for (const selector of SEEDFINDER_BREEDER_SELECTORS) {
    for (const el of Array.from(root.querySelectorAll(selector))) {
      const text = el.textContent || "";
      if (text) {
        values.push(text);
      }
    }
  }

  return values;
}

function extractSeedFinderBreederFromProse(root: ParentNode): string[] {
  const prose = normalizeSeedFinderText(root.textContent || "");
  if (!prose) {
    return [];
  }

  const candidates: string[] = [];
  const patterns = [
    /\b(?:breeder|seedbank)\s*(?:is|:|[-–—])\s*([^.;\n|]+)/gi,
    /\b(?:bred\s+by|created\s+by)\s+([^.;\n|]+)/gi
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = pattern.exec(prose);
    while (match) {
      if (match[1]) {
        candidates.push(match[1]);
      }
      match = pattern.exec(prose);
    }
  }

  return candidates;
}

function dedupeSeedFinderBreederValues(values: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeSeedFinderBreederValue(value);
    if (!normalized) {
      continue;
    }

    const dedupeKey = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    deduped.push(normalized);
  }

  return deduped;
}

function normalizeSeedFinderBreederValue(value: string): string | null {
  const normalized = normalizeSeedFinderText(value)
    .replace(/^(?:breeder(?:\s*\/\s*seedbank)?|seedbank|bred\s+by|created\s+by)\s*[:=-]?\s*/i, "")
    .replace(/^[:;,-]+/, "")
    .replace(/[\s:;,-]+$/, "");

  if (!normalized || /^(?:n\/a|unknown|none|null)$/i.test(normalized)) {
    return null;
  }

  return normalized;
}

function extractSeedFinderListField(
  rows: SeedFinderProfileTableRow[],
  field: "aroma" | "effects"
): string[] | null {
  const listValues = rows.filter((row) => row.field === field).map((row) => row.value);
  if (listValues.length === 0) {
    return null;
  }

  const normalizedValues = normalizeSeedFinderListValues(listValues, field);
  return normalizedValues.length > 0 ? normalizedValues : null;
}

function normalizeSeedFinderListValues(
  values: string[],
  field: "aroma" | "effects"
): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const entries = splitSeedFinderListValue(value, field);

    for (const entry of entries) {
      const normalizedEntry = normalizeSeedFinderListEntry(entry);
      if (!normalizedEntry) {
        continue;
      }

      const dedupeKey = normalizedEntry.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (!dedupeKey || seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      deduped.push(normalizedEntry);
    }
  }

  return deduped;
}

function splitSeedFinderListValue(value: string, field: "aroma" | "effects"): string[] {
  const fieldPrefix =
    field === "aroma"
      ? /^(?:aroma(?:\s+profile)?|aromas|smell|flavo(?:u)?r(?:s)?|terpenes?)\s*(?:is|are|:|-)?\s*/i
      : /^(?:effects?|effect\s+profile|high|buzz|experience)\s*(?:is|are|:|-)?\s*/i;

  const normalized = normalizeSeedFinderText(value)
    .replace(/^[\s:;-]+/, "")
    .replace(fieldPrefix, "")
    .replace(/\bn\/a\b/gi, "__SEEDFINDER_NA__")
    .replace(/[•·]+/g, ",")
    .replace(/\s*(?:\/|\||;)\s*/g, ",")
    .replace(/\s+(?:\+|&|and)\s+/gi, ",")
    .replace(/\s*,\s*/g, ",");

  return normalized
    .split(",")
    .map((entry) => normalizeSeedFinderText(entry).replace(/__SEEDFINDER_NA__/g, "n/a"))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeSeedFinderListEntry(value: string): string | null {
  const normalized = normalizeSeedFinderText(value)
    .replace(/^[\s:;,.!?"'()`-]+/, "")
    .replace(/^(?:notes?\s+of|hints?\s+of|undertones?\s+of|tones?\s+of|with|plus|for)\s+/i, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/[\s:;,.!?"'()`-]+$/, "")
    .replace(/\b(?:notes?|undertones?|tones?)$/i, "")
    .trim();

  if (!normalized || /^(?:n\/a|unknown|none|null)$/i.test(normalized)) {
    return null;
  }

  return normalized;
}

export function parseSeedFinderPotencyValue(rawValue: string): SeedFinderPotencyValue | null {
  const sanitizedRaw = normalizeSeedFinderPotencyRaw(rawValue);
  if (!sanitizedRaw) {
    return null;
  }

  const normalized = sanitizedRaw
    .replace(/^≤/, "<=")
    .replace(/^≥/, ">=")
    .replace(/^≈/, "~");

  const result: SeedFinderPotencyValue = { raw: sanitizedRaw };

  const comparatorMatch = normalized.match(/^(<=|>=|<|>|~)\s*/);
  const comparator = comparatorMatch?.[1] as SeedFinderPotencyValue["comparator"] | undefined;
  const numericPart = comparator ? normalized.slice(comparatorMatch![0].length) : normalized;

  const rangeMatch = numericPart.match(
    /(-?\d+(?:[.,]\d+)?)\s*%?\s*(?:-|–|—|to)\s*(-?\d+(?:[.,]\d+)?)\s*%?/i
  );

  if (rangeMatch) {
    const first = parseSeedFinderPercentNumber(rangeMatch[1]);
    const second = parseSeedFinderPercentNumber(rangeMatch[2]);
    if (first !== null && second !== null) {
      result.minPercent = Math.min(first, second);
      result.maxPercent = Math.max(first, second);
      if (comparator) {
        result.comparator = comparator;
      }
      return result;
    }
  }

  const numberMatch = numericPart.match(/(-?\d+(?:[.,]\d+)?)/);
  const numericValue = numberMatch ? parseSeedFinderPercentNumber(numberMatch[1]) : null;

  if (numericValue === null) {
    return result;
  }

  if (comparator) {
    result.comparator = comparator;
    if (comparator === "<" || comparator === "<=") {
      result.maxPercent = numericValue;
    } else if (comparator === ">" || comparator === ">=") {
      result.minPercent = numericValue;
    } else {
      result.minPercent = numericValue;
      result.maxPercent = numericValue;
    }
    return result;
  }

  result.minPercent = numericValue;
  result.maxPercent = numericValue;
  return result;
}

function extractSeedFinderLineage(
  doc: Document,
  contentEl: Element
): SeedFinderLineageExtraction | null {
  const fromTable =
    extractSeedFinderLineageFromTables(contentEl) ?? extractSeedFinderLineageFromTables(doc);
  if (fromTable) {
    return fromTable;
  }

  const prose = normalizeSeedFinderText(contentEl.textContent || "");
  if (!prose) {
    return null;
  }

  const prosePatterns: Array<{ regex: RegExp; convertAndSeparator?: boolean }> = [
    { regex: /\bcross\s+of\s+([^.!?\n;]+)/i },
    { regex: /\bcross\s+between\s+([^.!?\n;]+)/i, convertAndSeparator: true },
    { regex: /\b(?:lineage|parentage|genetics?)\s*(?:is|as|:)\s+([^.!?\n;]+)/i },
    { regex: /\b(?:lineage|parentage|genetics?)\s+([^.!?\n;]+)/i }
  ];

  for (const pattern of prosePatterns) {
    const match = prose.match(pattern.regex);
    if (!match?.[1]) {
      continue;
    }

    const normalized = normalizeLineageValue(match[1], {
      convertAndSeparator: pattern.convertAndSeparator === true,
      rawValue: normalizeSeedFinderText(match[1])
    });
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractSeedFinderLineageFromTables(root: ParentNode): SeedFinderLineageExtraction | null {
  const lineageRow = extractSeedFinderProfileTableRows(root).find((row) => row.field === "lineage");
  if (!lineageRow) {
    return null;
  }

  return normalizeLineageValue(lineageRow.value, { rawValue: lineageRow.value });
}

function extractSeedFinderPotency(rows: SeedFinderProfileTableRow[]): SeedFinderPotencyExtraction | null {
  let thcRaw = getFirstSeedFinderRowValue(rows, "thc");
  let cbdRaw = getFirstSeedFinderRowValue(rows, "cbd");

  if (!thcRaw || !cbdRaw) {
    for (const potencyRow of rows.filter((row) => row.field === "potency")) {
      const pair = parseSeedFinderCombinedPotencyValue(potencyRow.value, potencyRow.rawHeader);

      if (!thcRaw && pair.thc) {
        thcRaw = pair.thc;
      }
      if (!cbdRaw && pair.cbd) {
        cbdRaw = pair.cbd;
      }

      if (thcRaw && cbdRaw) {
        break;
      }
    }
  }

  if (!thcRaw && !cbdRaw) {
    return null;
  }

  const potency: SeedFinderPotencyProfile = {};
  const rawSourceValues: Pick<SeedFinderStrainProfileRawSourceValues, "thc" | "cbd"> = {};

  if (thcRaw) {
    rawSourceValues.thc = thcRaw;
    const thc = parseSeedFinderPotencyValue(thcRaw);
    if (thc) {
      potency.thc = thc;
    }
  }

  if (cbdRaw) {
    rawSourceValues.cbd = cbdRaw;
    const cbd = parseSeedFinderPotencyValue(cbdRaw);
    if (cbd) {
      potency.cbd = cbd;
    }
  }

  if (!potency.thc && !potency.cbd) {
    return null;
  }

  return {
    potency,
    rawSourceValues
  };
}

function getFirstSeedFinderRowValue(
  rows: SeedFinderProfileTableRow[],
  field: SeedFinderProfileCanonicalField
): string | undefined {
  return rows.find((row) => row.field === field)?.value;
}

function parseSeedFinderCombinedPotencyValue(
  rawValue: string,
  rawHeader?: string
): { thc?: string; cbd?: string } {
  const normalized = normalizeSeedFinderText(rawValue).replace(/^[\s:;-]+/, "");
  if (!normalized) {
    return {};
  }

  const explicitOrder =
    parseSeedFinderCombinedPotencyOrder(rawHeader) ?? parseSeedFinderCombinedPotencyOrder(normalized);

  if (explicitOrder) {
    const [firstLabel, secondLabel] = explicitOrder;
    const valueWithoutHeaderPrefix = normalized.replace(
      /^\s*(?:thc\s*\/\s*cbd|cbd\s*\/\s*thc)\s*[:=-]?\s*/i,
      ""
    );
    const orderedParts = splitSeedFinderPotencyParts(valueWithoutHeaderPrefix);

    if (orderedParts.length >= 2) {
      const orderedPair: { thc?: string; cbd?: string } = {};
      orderedPair[firstLabel] = orderedParts[0];
      orderedPair[secondLabel] = orderedParts[1];
      return orderedPair;
    }
  }

  const pairValue = normalized.replace(/^\s*potency(?:\s+profile)?\s*[:=-]?\s*/i, "");
  const parts = splitSeedFinderPotencyParts(pairValue);

  if (parts.length >= 2) {
    return {
      thc: parts[0],
      cbd: parts[1]
    };
  }

  const thcLabeled = extractLabeledPotencyRaw(normalized, "thc");
  const cbdLabeled = extractLabeledPotencyRaw(normalized, "cbd");
  if (thcLabeled || cbdLabeled) {
    return {
      thc: thcLabeled,
      cbd: cbdLabeled
    };
  }

  return {};
}

function parseSeedFinderCombinedPotencyOrder(
  value?: string
): ["thc" | "cbd", "thc" | "cbd"] | null {
  if (!value) {
    return null;
  }

  const labels =
    normalizeSeedFinderProfileHeader(value)
      .match(/\b(?:thc|cbd)\b/gi)
      ?.map((label) => label.toLowerCase() as "thc" | "cbd") ?? [];

  if (labels.length < 2) {
    return null;
  }

  const firstLabel = labels[0];
  const secondLabel = labels[1];

  if (firstLabel === secondLabel) {
    return null;
  }

  return [firstLabel, secondLabel];
}

function splitSeedFinderPotencyParts(value: string): string[] {
  let parts = value
    .split(/\s*(?:\/|\||;)\s*/)
    .map((part) => normalizeSeedFinderPotencyRaw(part))
    .filter((part): part is string => Boolean(part));

  if (parts.length < 2) {
    parts = value
      .split(/\s*,\s*(?=[<>~≤≥≈]?\s*\d)/)
      .map((part) => normalizeSeedFinderPotencyRaw(part))
      .filter((part): part is string => Boolean(part));
  }

  return parts;
}

function extractLabeledPotencyRaw(value: string, label: "thc" | "cbd"): string | undefined {
  const pattern = new RegExp(
    `\\b${label}\\b\\s*[:=-]?\\s*([<>]=?|~|≤|≥|≈)?\\s*(-?\\d+(?:[.,]\\d+)?(?:\\s*(?:-|–|—|to)\\s*-?\\d+(?:[.,]\\d+)?)?\\s*%?)`,
    "i"
  );

  const match = value.match(pattern);
  if (!match) {
    return undefined;
  }

  return normalizeSeedFinderPotencyRaw(`${match[1] || ""}${match[2] || ""}`) || undefined;
}

function normalizeSeedFinderText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSeedFinderPotencyRaw(value: string): string {
  return normalizeSeedFinderText(value)
    .replace(/^(?:thc|cbd)\s*[:=-]?\s*/i, "")
    .replace(/^[\s:;-]+/, "")
    .replace(/[\s,;|/]+$/, "");
}

function parseSeedFinderPercentNumber(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLineageValue(
  rawValue: string,
  options: { convertAndSeparator?: boolean; rawValue?: string } = {}
): SeedFinderLineageExtraction | null {
  let lineage = normalizeSeedFinderText(rawValue);
  if (!lineage) {
    return null;
  }

  lineage = lineage
    .replace(/^[\s:;-]+/, "")
    .replace(/\((?:mother|father|female|male|seed\s+parent|pollen\s+donor)\)/gi, "")
    .replace(/[×✕✖]/g, " x ")
    .replace(/\b[xX]\b/g, " x ")
    .replace(/\s*\/\s*/g, " x ");

  if (options.convertAndSeparator && !/\bx\b/i.test(lineage)) {
    lineage = lineage.replace(/\s+(?:and|&)\s+/gi, " x ");
  }

  lineage = normalizeSeedFinderText(lineage)
    .replace(/[.,;:]+$/, "")
    .replace(/\s*x\s*x\s*/gi, " x ");

  const parents = lineage
    .split(/\sx\s/i)
    .map((parent) => normalizeSeedFinderText(parent.replace(/^[\s"'`([{]+|[\s"'`)]}+$/g, "")))
    .filter(Boolean);

  if (parents.length < 2) {
    return null;
  }

  return {
    normalized: parents.join(" x "),
    parents,
    rawValue: options.rawValue ?? normalizeSeedFinderText(rawValue)
  };
}
