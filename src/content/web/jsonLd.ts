// src/content/web/jsonLd.ts
import type { JsonLdMetadata } from "../../shared/types";

type JsonObject = Record<string, unknown>;

const PREFERRED_TYPES = ["NewsArticle", "Article", "BlogPosting", "WebPage"] as const;

export function extractJsonLdMetadata(doc: Document): JsonLdMetadata | undefined {
  const nodes = collectJsonLdNodes(doc);
  if (nodes.length === 0) return undefined;

  const best = pickBestNode(nodes);
  if (!best) return undefined;

  const schemaTypes = getSchemaTypes(best);
  const schemaType = pickPrimaryType(schemaTypes);

  const metadata: JsonLdMetadata = {
    schemaType,
    name: getString(best, "name"),
    headline: getString(best, "headline") ?? getString(best, "name"),
    description: getString(best, "description"),
    author: extractAuthor(best),
    datePublished: getDate(best, ["datePublished", "dateCreated"]),
    dateModified: getDate(best, ["dateModified", "dateUpdated"]),
    publisher: extractPublisher(best),
    keywords: extractKeywords(best),
    articleSection: extractArticleSection(best),
    wordCount: extractWordCount(best),
    image: extractImage(best)
  };

  return hasAnyValue(metadata) ? metadata : undefined;
}

function collectJsonLdNodes(doc: Document): JsonObject[] {
  const scripts = Array.from(
    doc.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')
  );

  const out: JsonObject[] = [];
  for (const script of scripts) {
    const raw = script.textContent ?? "";
    const parsed = safeParseJson(raw);
    if (!parsed) continue;
    out.push(...flattenJsonLd(parsed));
  }

  return out;
}

function safeParseJson(raw: string): unknown | undefined {
  const cleaned = raw
    .trim()
    .replace(/^\s*<!--/, "")
    .replace(/-->\s*$/, "")
    .replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\/\s*/i, "")
    .replace(/\s*\/\*\s*\]\]>\s*\*\/\s*$/i, "")
    .trim();

  if (!cleaned) return undefined;

  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    return undefined;
  }
}

function flattenJsonLd(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);

  if (!isObject(value)) return [];

  const graph = value["@graph"];
  if (Array.isArray(graph)) {
    const rest = { ...value };
    delete rest["@graph"];
    return [...flattenJsonLd(graph), ...(hasAnyValue(rest) ? [rest] : [])];
  }

  return [value];
}

function pickBestNode(nodes: JsonObject[]): JsonObject | undefined {
  let best: JsonObject | undefined;
  let bestScore = -1;

  for (const node of nodes) {
    const types = getSchemaTypes(node);
    if (types.length === 0) continue;

    const typeScore = scoreTypes(types);
    const fieldScore =
      (extractAuthor(node) ? 2 : 0) +
      (getDate(node, ["datePublished", "dateCreated"]) ? 2 : 0) +
      (getString(node, "headline") ? 2 : 0) +
      (getString(node, "name") ? 1 : 0) +
      (getString(node, "description") ? 1 : 0) +
      (extractPublisher(node) ? 1 : 0) +
      (extractImage(node) ? 1 : 0);

    const score = typeScore * 10 + fieldScore;

    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }

  return best;
}

function scoreTypes(types: string[]): number {
  const idx = (t: string) => (PREFERRED_TYPES as readonly string[]).indexOf(t);
  const bestIdx = Math.min(...types.map((t) => idx(t)).filter((i) => i >= 0), 999);
  return bestIdx === 999 ? 0 : PREFERRED_TYPES.length - bestIdx;
}

function pickPrimaryType(types: string[]): string | undefined {
  for (const preferred of PREFERRED_TYPES) {
    if (types.includes(preferred)) return preferred;
  }
  return types[0];
}

function getSchemaTypes(node: JsonObject): string[] {
  const raw = node["@type"];
  const types = toStringArray(raw)
    .map(normalizeSchemaType)
    .filter(Boolean) as string[];

  return Array.from(new Set(types));
}

function normalizeSchemaType(type: string): string {
  const t = type.trim();
  if (!t) return "";
  return t
    .replace(/^https?:\/\/schema\.org\//i, "")
    .replace(/^schema:/i, "")
    .replace(/^https?:\/\/www\.schema\.org\//i, "");
}

function extractAuthor(node: JsonObject): string | string[] | undefined {
  const raw = node.author ?? node.creator;
  const names = extractNameList(raw);
  if (names.length === 0) return undefined;
  return names.length === 1 ? names[0] : names;
}

function extractPublisher(node: JsonObject): string | undefined {
  const publisher = node.publisher;
  const names = extractNameList(publisher);
  return names[0] || undefined;
}

function extractKeywords(node: JsonObject): string[] | undefined {
  const raw = node.keywords;
  const keywords =
    typeof raw === "string"
      ? raw
          .split(/[,\n]/g)
          .map(cleanString)
          .filter(Boolean)
      : toStringArray(raw).map(cleanString).filter(Boolean);

  const deduped = Array.from(new Set(keywords));
  return deduped.length ? deduped : undefined;
}

function extractArticleSection(node: JsonObject): string | undefined {
  const raw = node.articleSection;
  const values = toStringArray(raw).map(cleanString).filter(Boolean);
  return values[0] || undefined;
}

function extractWordCount(node: JsonObject): number | undefined {
  const raw = node.wordCount;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function extractImage(node: JsonObject): string | string[] | undefined {
  const raw = node.image ?? node.thumbnailUrl;
  const urls = extractUrlList(raw);
  if (urls.length === 0) return undefined;
  return urls.length === 1 ? urls[0] : urls;
}

function getDate(node: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = node[key];
    if (typeof v === "string") {
      const s = cleanString(v);
      if (s) return s;
    }
  }
  return undefined;
}

function extractNameList(value: unknown): string[] {
  if (typeof value === "string") {
    const s = cleanString(value);
    return s ? [s] : [];
  }

  if (Array.isArray(value)) return value.flatMap(extractNameList);

  if (isObject(value)) {
    const name = value.name;
    if (typeof name === "string") {
      const s = cleanString(name);
      return s ? [s] : [];
    }
  }

  return [];
}

function extractUrlList(value: unknown): string[] {
  if (typeof value === "string") {
    const s = cleanString(value);
    return s ? [s] : [];
  }

  if (Array.isArray(value)) return value.flatMap(extractUrlList);

  if (isObject(value)) {
    const url = value.url ?? value.contentUrl;
    if (typeof url === "string") {
      const s = cleanString(url);
      return s ? [s] : [];
    }
    if (Array.isArray(url)) {
      return url
        .filter((u): u is string => typeof u === "string")
        .map(cleanString)
        .filter(Boolean);
    }
  }

  return [];
}

function getString(obj: JsonObject, key: string): string | undefined {
  const v = obj[key];
  if (typeof v !== "string") return undefined;
  const s = cleanString(v);
  return s || undefined;
}

function toStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function cleanString(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasAnyValue<T extends object>(obj: T): boolean {
  return Object.values(obj).some((v) => {
    if (v === undefined || v === null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
}
