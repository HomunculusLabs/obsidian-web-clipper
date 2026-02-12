/**
 * Tag History - Tracks previously used tags with frequency counts.
 * Part of Task 65 - Tag history/frequency.
 */

import { storageGet, storageSet } from "./chromeAsync";

/** Storage key for tag history */
const TAG_HISTORY_KEY = "tagHistory";

/** Maximum number of tags to keep in history */
const MAX_HISTORY_SIZE = 200;

/** Maximum number of frequent tags to return */
const MAX_FREQUENT_TAGS = 20;

/** Minimum usage count to appear in suggestions */
const MIN_USAGE_FOR_SUGGESTION = 2;

/**
 * Represents a tag with its usage frequency.
 */
export interface TagHistoryEntry {
  tag: string;
  count: number;
  lastUsed: string; // ISO timestamp
}

/**
 * The tag history storage format.
 * Maps lowercase tag name to entry.
 */
type TagHistoryMap = Record<string, TagHistoryEntry>;

/**
 * Loads the tag history from chrome.storage.
 */
async function loadTagHistory(): Promise<TagHistoryMap> {
  try {
    const result = await storageGet<{ [TAG_HISTORY_KEY]: TagHistoryMap }>([TAG_HISTORY_KEY]);
    return result[TAG_HISTORY_KEY] || {};
  } catch {
    return {};
  }
}

/**
 * Saves the tag history to chrome.storage.
 */
async function saveTagHistory(history: TagHistoryMap): Promise<void> {
  try {
    await storageSet<{ [TAG_HISTORY_KEY]: TagHistoryMap }>({ [TAG_HISTORY_KEY]: history });
  } catch (err) {
    console.error("Failed to save tag history:", err);
  }
}

/**
 * Records tags as used, incrementing their count and updating lastUsed timestamp.
 *
 * @param tags - Array of tags to record
 */
export async function recordTagUsage(tags: string[]): Promise<void> {
  if (!tags || tags.length === 0) return;

  const history = await loadTagHistory();
  const now = new Date().toISOString();

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    const existing = history[key];

    if (existing) {
      existing.count += 1;
      existing.lastUsed = now;
    } else {
      history[key] = {
        tag: trimmed,
        count: 1,
        lastUsed: now
      };
    }
  }

  // Prune if too large - remove least recently used tags with lowest counts
  const keys = Object.keys(history);
  if (keys.length > MAX_HISTORY_SIZE) {
    // Sort by (count ascending, then lastUsed ascending)
    const sortedKeys = keys.sort((a, b) => {
      const entryA = history[a];
      const entryB = history[b];
      if (entryA.count !== entryB.count) {
        return entryA.count - entryB.count;
      }
      return new Date(entryA.lastUsed).getTime() - new Date(entryB.lastUsed).getTime();
    });

    // Remove oldest/least-used entries
    const toRemove = sortedKeys.slice(0, keys.length - MAX_HISTORY_SIZE);
    for (const key of toRemove) {
      delete history[key];
    }
  }

  await saveTagHistory(history);
}

/**
 * Gets frequently used tags sorted by usage count (descending).
 *
 * @param limit - Maximum number of tags to return (default: 20)
 * @returns Array of tag entries sorted by frequency
 */
export async function getFrequentTags(limit: number = MAX_FREQUENT_TAGS): Promise<TagHistoryEntry[]> {
  const history = await loadTagHistory();

  // Filter tags that meet minimum usage threshold
  const entries = Object.values(history).filter(
    (entry) => entry.count >= MIN_USAGE_FOR_SUGGESTION
  );

  // Sort by count (descending), then by lastUsed (descending)
  entries.sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime();
  });

  return entries.slice(0, limit);
}

/**
 * Gets tag suggestions based on a prefix (for autocomplete).
 *
 * @param prefix - The partial tag to match
 * @param limit - Maximum number of suggestions (default: 5)
 * @returns Array of matching tag entries sorted by frequency
 */
export async function getTagSuggestionsForPrefix(
  prefix: string,
  limit: number = 5
): Promise<TagHistoryEntry[]> {
  const history = await loadTagHistory();
  const lowerPrefix = prefix.toLowerCase().trim();

  if (!lowerPrefix) {
    return getFrequentTags(limit);
  }

  // Find tags that start with the prefix
  const matching = Object.values(history).filter((entry) =>
    entry.tag.toLowerCase().startsWith(lowerPrefix)
  );

  // Sort by count (descending)
  matching.sort((a, b) => b.count - a.count);

  return matching.slice(0, limit);
}

/**
 * Clears all tag history.
 */
export async function clearTagHistory(): Promise<void> {
  await saveTagHistory({});
}

/**
 * Gets the total number of tags in history.
 */
export async function getTagHistoryCount(): Promise<number> {
  const history = await loadTagHistory();
  return Object.keys(history).length;
}

/**
 * Gets tags that are frequently used together (based on recency).
 * This is a simple implementation that returns the most recent tags.
 *
 * @param limit - Maximum number of tags to return
 * @returns Array of recent tag entries
 */
export async function getRecentTags(limit: number = 10): Promise<TagHistoryEntry[]> {
  const history = await loadTagHistory();

  const entries = Object.values(history);

  // Sort by lastUsed (descending)
  entries.sort((a, b) => {
    return new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime();
  });

  return entries.slice(0, limit);
}
