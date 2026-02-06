import type { Settings } from "./settings";

export function getFolderCandidates(settings: Settings): string[] {
  const candidates = [
    ...(Array.isArray(settings.savedFolders) ? settings.savedFolders : []),
    settings.defaultFolder
  ]
    .map((s) => (s || "").trim())
    .filter((s) => s.length > 0);

  const seen = new Set<string>();
  return candidates.filter((folder) => {
    const key = folder.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}