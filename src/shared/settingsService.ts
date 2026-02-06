import {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  VALID_TABLE_HANDLING,
  VALID_CODE_BLOCK_LANGUAGE,
  VALID_IMAGE_HANDLING,
  type Settings
} from "./settings";
import { storageGet, storageSet } from "./chromeAsync";
import type {
  TableHandlingMode,
  CodeBlockLanguageMode,
  ImageHandlingMode
} from "./types";

// Validate and sanitize enum settings
function validateEnumSetting<T extends string>(
  value: unknown,
  validValues: readonly T[],
  defaultValue: T
): T {
  if (typeof value === "string" && validValues.includes(value as T)) {
    return value as T;
  }
  return defaultValue;
}

// Validate settings and fix invalid enum values
function validateSettings(settings: Partial<Settings>): Partial<Settings> {
  const validated = { ...settings };

  // Validate tableHandling enum
  if ("tableHandling" in validated) {
    validated.tableHandling = validateEnumSetting<TableHandlingMode>(
      validated.tableHandling,
      VALID_TABLE_HANDLING,
      DEFAULT_SETTINGS.tableHandling
    );
  }

  // Validate codeBlockLanguageMode enum
  if ("codeBlockLanguageMode" in validated) {
    validated.codeBlockLanguageMode = validateEnumSetting<CodeBlockLanguageMode>(
      validated.codeBlockLanguageMode,
      VALID_CODE_BLOCK_LANGUAGE,
      DEFAULT_SETTINGS.codeBlockLanguageMode
    );
  }

  // Validate imageHandling enum
  if ("imageHandling" in validated) {
    validated.imageHandling = validateEnumSetting<ImageHandlingMode>(
      validated.imageHandling,
      VALID_IMAGE_HANDLING,
      DEFAULT_SETTINGS.imageHandling
    );
  }

  // Validate wikiLinkMaxPerTerm (must be positive integer)
  if ("wikiLinkMaxPerTerm" in validated) {
    const val = validated.wikiLinkMaxPerTerm;
    if (typeof val !== "number" || !Number.isInteger(val) || val < 1) {
      validated.wikiLinkMaxPerTerm = DEFAULT_SETTINGS.wikiLinkMaxPerTerm;
    }
  }

  // Validate wikiLinkRules (must be array of { term, note } objects)
  if ("wikiLinkRules" in validated) {
    const rules = validated.wikiLinkRules;
    if (!Array.isArray(rules)) {
      validated.wikiLinkRules = DEFAULT_SETTINGS.wikiLinkRules;
    } else {
      validated.wikiLinkRules = rules.filter(
        (r): r is { term: string; note: string } =>
          typeof r === "object" &&
          r !== null &&
          typeof r.term === "string" &&
          typeof r.note === "string"
      );
    }
  }

  // Validate wikiLinkNoteIndex (must be array of strings)
  if ("wikiLinkNoteIndex" in validated) {
    const index = validated.wikiLinkNoteIndex;
    if (!Array.isArray(index)) {
      validated.wikiLinkNoteIndex = DEFAULT_SETTINGS.wikiLinkNoteIndex;
    } else {
      validated.wikiLinkNoteIndex = index.filter(
        (item): item is string => typeof item === "string"
      );
    }
  }

  return validated;
}

// Pure merge function (useful for testing)
export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  const validated = stored ? validateSettings(stored) : {};
  return { ...DEFAULT_SETTINGS, ...validated };
}

// Async load from chrome.storage.local
export async function loadSettings(): Promise<Settings> {
  const stored = await storageGet<Settings>(SETTINGS_KEYS);
  return mergeSettings(stored);
}

// Async save to chrome.storage.local
export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  const validated = validateSettings(settings);
  await storageSet<Settings>(validated);
}