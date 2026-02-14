import { storageGet, storageSet } from "./chromeAsync";

export interface ClipHistoryEntry {
  title: string;
  url: string;
  date: string;
  tags: string[];
  folder: string;
  success: boolean;
}

interface ClipHistoryStorage extends Record<string, unknown> {
  clipHistory: ClipHistoryEntry[];
}

const CLIP_HISTORY_KEY = "clipHistory";
const MAX_HISTORY_ENTRIES = 50;

export async function getClipHistory(): Promise<ClipHistoryEntry[]> {
  try {
    const result = await storageGet<ClipHistoryStorage>([CLIP_HISTORY_KEY]);
    const history = result[CLIP_HISTORY_KEY];
    if (!Array.isArray(history)) {
      return [];
    }

    return history
      .filter((entry): entry is ClipHistoryEntry => {
        if (!entry || typeof entry !== "object") return false;
        const candidate = entry as Partial<ClipHistoryEntry>;
        return (
          typeof candidate.title === "string" &&
          typeof candidate.url === "string" &&
          typeof candidate.date === "string" &&
          Array.isArray(candidate.tags) &&
          typeof candidate.folder === "string" &&
          typeof candidate.success === "boolean"
        );
      })
      .slice(0, MAX_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

export async function addClipHistoryEntry(entry: ClipHistoryEntry): Promise<void> {
  try {
    const history = await getClipHistory();
    const updated = [entry, ...history].slice(0, MAX_HISTORY_ENTRIES);
    await storageSet<ClipHistoryStorage>({ [CLIP_HISTORY_KEY]: updated });
  } catch {
    // Non-fatal: history should never break clipping flow.
  }
}
