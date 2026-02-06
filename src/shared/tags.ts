import type { PageType } from "./types";

export function parseTags(raw: string): string[] {
  const cleaned = (raw || "")
    .split(/\s*,\s*/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const seen = new Set<string>();
  return cleaned.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Mutates and returns the same `tags` array (matches existing popup behavior).
 */
export function addAutoTags(tags: string[], pageType: PageType): string[] {
  if (pageType === "youtube" && !tags.some((t) => t.toLowerCase() === "youtube")) {
    tags.push("youtube");
  }
  if (pageType === "pdf" && !tags.some((t) => t.toLowerCase() === "pdf")) {
    tags.push("pdf");
  }

  if (tags.length === 0) {
    tags.push("web-clip");
  }

  return tags;
}