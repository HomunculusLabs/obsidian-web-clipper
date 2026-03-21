import type { SiteTemplate } from "../../shared/templates";

export interface SeedFinderProfile {
  name?: string;
  strain?: string;
  lineage?: string;
  lineageParents?: string[];
  description?: string;
  thc?: string;
  cbd?: string;
  floweringTime?: string;
  yield?: string;
}

export interface SeedFinderProfileResult {
  seedFinderProfile: SeedFinderProfile;
}

function textOf(selector: string, root: ParentNode): string | undefined {
  const el = root.querySelector(selector);
  const text = el?.textContent?.trim();
  return text || undefined;
}

function parseLineage(text: string): { lineage?: string; lineageParents?: string[] } {
  const normalized = text.replace(/\s+/g, " ").trim();

  const lineageMatch = normalized.match(/(?:lineage|genetics)\s*[:\-]\s*([^\n\r]+)/i);
  const lineage = lineageMatch?.[1]?.trim();

  const parents = lineage
    ? lineage
        .split(/\s*[x×]\s*|\s*\/\s*|\s+cross\s+/i)
        .map(part => part.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];

  return {
    lineage,
    lineageParents: parents.length > 1 ? parents : undefined
  };
}

export function isSeedFinderStrainTemplate(template: SiteTemplate | null, pageUrl: string): boolean {
  const domain = template?.domain?.toLowerCase() ?? "";
  const name = template?.name?.toLowerCase() ?? "";
  return domain.includes("seedfinder") || name.includes("seedfinder") || pageUrl.toLowerCase().includes("seedfinder");
}

export function extractSeedFinderProfile(doc: Document, contentEl: Element | null): SeedFinderProfileResult | null {
  const root = contentEl ?? doc.body ?? doc.documentElement;
  if (!root) return null;

  const text = root.textContent?.trim() || "";
  if (!text) return null;

  const name = textOf("h1", doc) || textOf("title", doc) || undefined;
  const description = textOf('meta[name="description"]', doc) || undefined;
  const lineageInfo = parseLineage(text);

  const profile: SeedFinderProfile = {
    name,
    strain: name,
    description,
    ...lineageInfo,
    thc: text.match(/THC\s*[:\-]\s*([\d.]+%?)/i)?.[1],
    cbd: text.match(/CBD\s*[:\-]\s*([\d.]+%?)/i)?.[1],
    floweringTime: text.match(/flowering\s*time\s*[:\-]\s*([^\n\r]+)/i)?.[1]?.trim(),
    yield: text.match(/yield\s*[:\-]\s*([^\n\r]+)/i)?.[1]?.trim()
  };

  const hasMeaningfulData = Object.values(profile).some(value => {
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  });

  return hasMeaningfulData ? { seedFinderProfile: profile } : null;
}

export function renderSeedFinderProfileMarkdown(profile: SeedFinderProfile): string {
  const lines: string[] = ["## SeedFinder Profile"];

  if (profile.strain) lines.push(`- **Strain**: ${profile.strain}`);
  if (profile.lineage) lines.push(`- **Lineage**: ${profile.lineage}`);
  if (profile.lineageParents?.length) lines.push(`- **Parents**: ${profile.lineageParents.join(" × ")}`);
  if (profile.thc) lines.push(`- **THC**: ${profile.thc}`);
  if (profile.cbd) lines.push(`- **CBD**: ${profile.cbd}`);
  if (profile.floweringTime) lines.push(`- **Flowering time**: ${profile.floweringTime}`);
  if (profile.yield) lines.push(`- **Yield**: ${profile.yield}`);
  if (profile.description) lines.push(`- **Description**: ${profile.description}`);

  return lines.join("\n");
}
