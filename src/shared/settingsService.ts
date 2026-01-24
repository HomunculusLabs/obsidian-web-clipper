import { DEFAULT_SETTINGS, SETTINGS_KEYS, type Settings } from "./settings";
import { storageGet, storageSet } from "./chromeAsync";

// Pure merge function (useful for testing)
export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

// Async load from chrome.storage.local
export async function loadSettings(): Promise<Settings> {
  const stored = await storageGet<Settings>(SETTINGS_KEYS);
  return mergeSettings(stored);
}

// Async save to chrome.storage.local
export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  await storageSet<Settings>(settings);
}