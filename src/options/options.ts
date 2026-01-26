import {
  DEFAULT_SETTINGS,
  VALID_CODE_BLOCK_LANGUAGE,
  VALID_TABLE_HANDLING,
  type Settings,
  type WikiLinkRule
} from "../shared/settings";
import type { CodeBlockLanguageMode, TableHandlingMode } from "../shared/types";
import {
  loadSettings as loadSettingsFromStorage,
  saveSettings as saveSettingsToStorage
} from "../shared/settingsService";
import { getEl, showStatus, populateForm } from "./ui";
import { addFolder, renderSavedFolders } from "./folderList";

let settings: Settings = { ...DEFAULT_SETTINGS };

// --- Parsing helpers ---

function parseWikiLinkRules(raw: string): { rules: WikiLinkRule[]; errors: string[] } {
  const rules: WikiLinkRule[] = [];
  const errors: string[] = [];

  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i] ?? "";
    const line = original.trim();
    if (!line) continue;

    const arrowIndex = line.indexOf("->");
    if (arrowIndex === -1) {
      errors.push(`Wiki-link rule line ${i + 1}: missing "->"`);
      continue;
    }

    const term = line.slice(0, arrowIndex).trim();
    const note = line.slice(arrowIndex + 2).trim();

    if (!term || !note) {
      errors.push(`Wiki-link rule line ${i + 1}: expected "Term -> Note"`);
      continue;
    }

    rules.push({ term, note });
  }

  return { rules, errors };
}

function parseNoteIndex(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const original of raw.split(/\r?\n/)) {
    const name = (original ?? "").trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }

  return out;
}

function parseMinInt(raw: string | undefined, fallback: number, min: number): number {
  const n = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
  return Math.max(min, n);
}

function coerceEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  if (!value) return fallback;
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

// --- Lifecycle ---

async function loadSettings(): Promise<void> {
  settings = await loadSettingsFromStorage();
  populateForm(settings);
}

function setupEventListeners(): void {
  const saveBtn = getEl<HTMLButtonElement>("saveBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      void saveCurrentSettings();
    });
  }

  const resetBtn = getEl<HTMLButtonElement>("resetBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      void resetSettings();
    });
  }

  const addFolderBtn = getEl<HTMLButtonElement>("addFolder");
  if (addFolderBtn) {
    addFolderBtn.addEventListener("click", () => {
      void addFolder(settings);
    });
  }

  const newFolder = getEl<HTMLInputElement>("newFolder");
  if (newFolder) {
    newFolder.addEventListener("keypress", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void addFolder(settings);
      }
    });
  }
}

async function saveCurrentSettings(): Promise<void> {
  // Core settings
  const vaultName = getEl<HTMLInputElement>("vaultName");
  const defaultFolder = getEl<HTMLInputElement>("defaultFolder");
  const defaultTags = getEl<HTMLInputElement>("defaultTags");
  const includeTimestamps = getEl<HTMLInputElement>("includeTimestamps");

  // Metadata settings
  const includeOGFields = getEl<HTMLInputElement>("includeOGFields");
  const includeTwitterFields = getEl<HTMLInputElement>("includeTwitterFields");
  const parseJsonLd = getEl<HTMLInputElement>("parseJsonLd");
  const includeKeywords = getEl<HTMLInputElement>("includeKeywords");
  const computeReadingStats = getEl<HTMLInputElement>("computeReadingStats");
  const preferCanonicalUrl = getEl<HTMLInputElement>("preferCanonicalUrl");

  // Wiki-link settings
  const enableWikiLinks = getEl<HTMLInputElement>("enableWikiLinks");
  const wikiLinkRulesEl = getEl<HTMLTextAreaElement>("wikiLinkRules");
  const wikiLinkExistingNotesOnly = getEl<HTMLInputElement>("wikiLinkExistingNotesOnly");
  const wikiLinkNoteIndexEl = getEl<HTMLTextAreaElement>("wikiLinkNoteIndex");
  const wikiLinkCaseSensitive = getEl<HTMLInputElement>("wikiLinkCaseSensitive");
  const wikiLinkWholeWord = getEl<HTMLInputElement>("wikiLinkWholeWord");
  const wikiLinkMaxPerTerm = getEl<HTMLInputElement>("wikiLinkMaxPerTerm");

  // Code blocks / Tables
  const codeBlockLanguageMode = getEl<HTMLSelectElement>("codeBlockLanguageMode");
  const tableHandling = getEl<HTMLSelectElement>("tableHandling");

  // Parse wiki-link rules
  const { rules: wikiLinkRules, errors: wikiRuleErrors } = parseWikiLinkRules(
    wikiLinkRulesEl?.value ?? ""
  );
  if (wikiRuleErrors.length > 0) {
    showStatus("error", wikiRuleErrors[0] ?? "Invalid wiki-link rules");
    return;
  }

  // Parse note index
  const wikiLinkNoteIndex = parseNoteIndex(wikiLinkNoteIndexEl?.value ?? "");

  // Build updated settings
  settings = {
    ...settings,

    // Core
    vaultName: (vaultName?.value || "").trim() || DEFAULT_SETTINGS.vaultName,
    defaultFolder: (defaultFolder?.value || "").trim() || DEFAULT_SETTINGS.defaultFolder,
    defaultTags: (defaultTags?.value || "").trim() || DEFAULT_SETTINGS.defaultTags,
    includeTimestamps: includeTimestamps?.checked ?? DEFAULT_SETTINGS.includeTimestamps,
    savedFolders: Array.isArray(settings.savedFolders)
      ? settings.savedFolders
      : [...DEFAULT_SETTINGS.savedFolders],

    // Metadata
    includeOGFields: includeOGFields?.checked ?? DEFAULT_SETTINGS.includeOGFields,
    includeTwitterFields: includeTwitterFields?.checked ?? DEFAULT_SETTINGS.includeTwitterFields,
    parseJsonLd: parseJsonLd?.checked ?? DEFAULT_SETTINGS.parseJsonLd,
    includeKeywords: includeKeywords?.checked ?? DEFAULT_SETTINGS.includeKeywords,
    computeReadingStats: computeReadingStats?.checked ?? DEFAULT_SETTINGS.computeReadingStats,
    preferCanonicalUrl: preferCanonicalUrl?.checked ?? DEFAULT_SETTINGS.preferCanonicalUrl,

    // Wiki-links
    enableWikiLinks: enableWikiLinks?.checked ?? DEFAULT_SETTINGS.enableWikiLinks,
    wikiLinkRules,
    wikiLinkExistingNotesOnly:
      wikiLinkExistingNotesOnly?.checked ?? DEFAULT_SETTINGS.wikiLinkExistingNotesOnly,
    wikiLinkNoteIndex,
    wikiLinkCaseSensitive:
      wikiLinkCaseSensitive?.checked ?? DEFAULT_SETTINGS.wikiLinkCaseSensitive,
    wikiLinkWholeWord: wikiLinkWholeWord?.checked ?? DEFAULT_SETTINGS.wikiLinkWholeWord,
    wikiLinkMaxPerTerm: parseMinInt(
      wikiLinkMaxPerTerm?.value,
      DEFAULT_SETTINGS.wikiLinkMaxPerTerm,
      1
    ),

    // Code blocks
    codeBlockLanguageMode: coerceEnum<CodeBlockLanguageMode>(
      codeBlockLanguageMode?.value,
      VALID_CODE_BLOCK_LANGUAGE,
      DEFAULT_SETTINGS.codeBlockLanguageMode
    ),

    // Tables
    tableHandling: coerceEnum<TableHandlingMode>(
      tableHandling?.value,
      VALID_TABLE_HANDLING,
      DEFAULT_SETTINGS.tableHandling
    )
  };

  await saveSettingsToStorage(settings);
  showStatus("success", "Settings saved successfully!");
}

async function resetSettings(): Promise<void> {
  const ok = window.confirm(
    "Are you sure you want to reset all settings to default values?"
  );
  if (!ok) return;

  settings = { ...DEFAULT_SETTINGS };
  populateForm(settings);
  renderSavedFolders(settings);

  await saveSettingsToStorage(settings);
  showStatus("success", "Settings reset to defaults!");
}

async function init(): Promise<void> {
  await loadSettings();
  setupEventListeners();
  renderSavedFolders(settings);
}

document.addEventListener("DOMContentLoaded", () => {
  void init().catch((err: unknown) => {
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to load settings";
    console.error("Options init error:", err);
    showStatus("error", message);
  });
});