import type { Settings } from "../shared/settings";

export type StatusType = "success" | "error";

let statusTimer: number | null = null;

export function getEl<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function showStatus(type: StatusType, message: string): void {
  const status = getEl<HTMLDivElement>("status");
  if (!status) return;

  status.className = `status ${type}`;
  status.textContent = message;

  if (statusTimer !== null) {
    window.clearTimeout(statusTimer);
    statusTimer = null;
  }

  statusTimer = window.setTimeout(() => {
    status.className = "status";
    status.textContent = "";
    statusTimer = null;
  }, 3000);
}

export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function populateForm(settings: Settings): void {
  // Core settings
  const vaultName = getEl<HTMLInputElement>("vaultName");
  const defaultFolder = getEl<HTMLInputElement>("defaultFolder");
  const defaultTags = getEl<HTMLInputElement>("defaultTags");
  const includeTimestamps = getEl<HTMLInputElement>("includeTimestamps");

  if (vaultName) vaultName.value = settings.vaultName || "";
  if (defaultFolder) defaultFolder.value = settings.defaultFolder || "";
  if (defaultTags) defaultTags.value = settings.defaultTags || "";
  if (includeTimestamps) includeTimestamps.checked = settings.includeTimestamps !== false;

  // Metadata settings
  const includeOGFields = getEl<HTMLInputElement>("includeOGFields");
  const includeTwitterFields = getEl<HTMLInputElement>("includeTwitterFields");
  const parseJsonLd = getEl<HTMLInputElement>("parseJsonLd");
  const includeKeywords = getEl<HTMLInputElement>("includeKeywords");
  const computeReadingStats = getEl<HTMLInputElement>("computeReadingStats");
  const preferCanonicalUrl = getEl<HTMLInputElement>("preferCanonicalUrl");

  if (includeOGFields) includeOGFields.checked = !!settings.includeOGFields;
  if (includeTwitterFields) includeTwitterFields.checked = !!settings.includeTwitterFields;
  if (parseJsonLd) parseJsonLd.checked = !!settings.parseJsonLd;
  if (includeKeywords) includeKeywords.checked = !!settings.includeKeywords;
  if (computeReadingStats) computeReadingStats.checked = !!settings.computeReadingStats;
  if (preferCanonicalUrl) preferCanonicalUrl.checked = !!settings.preferCanonicalUrl;

  // Wiki-link settings
  const enableWikiLinks = getEl<HTMLInputElement>("enableWikiLinks");
  const wikiLinkRules = getEl<HTMLTextAreaElement>("wikiLinkRules");
  const wikiLinkExistingNotesOnly = getEl<HTMLInputElement>("wikiLinkExistingNotesOnly");
  const wikiLinkNoteIndex = getEl<HTMLTextAreaElement>("wikiLinkNoteIndex");
  const wikiLinkCaseSensitive = getEl<HTMLInputElement>("wikiLinkCaseSensitive");
  const wikiLinkWholeWord = getEl<HTMLInputElement>("wikiLinkWholeWord");
  const wikiLinkMaxPerTerm = getEl<HTMLInputElement>("wikiLinkMaxPerTerm");

  if (enableWikiLinks) enableWikiLinks.checked = !!settings.enableWikiLinks;
  if (wikiLinkRules) {
    wikiLinkRules.value = (settings.wikiLinkRules ?? [])
      .map((r) => `${r.term} -> ${r.note}`)
      .join("\n");
  }
  if (wikiLinkExistingNotesOnly) {
    wikiLinkExistingNotesOnly.checked = !!settings.wikiLinkExistingNotesOnly;
  }
  if (wikiLinkNoteIndex) {
    wikiLinkNoteIndex.value = (settings.wikiLinkNoteIndex ?? []).join("\n");
  }
  if (wikiLinkCaseSensitive) wikiLinkCaseSensitive.checked = !!settings.wikiLinkCaseSensitive;
  if (wikiLinkWholeWord) wikiLinkWholeWord.checked = !!settings.wikiLinkWholeWord;
  if (wikiLinkMaxPerTerm) wikiLinkMaxPerTerm.value = String(settings.wikiLinkMaxPerTerm ?? 1);

  // Code block settings
  const codeBlockLanguageMode = getEl<HTMLSelectElement>("codeBlockLanguageMode");
  if (codeBlockLanguageMode) codeBlockLanguageMode.value = settings.codeBlockLanguageMode;

  // Table settings
  const tableHandling = getEl<HTMLSelectElement>("tableHandling");
  if (tableHandling) tableHandling.value = settings.tableHandling;

  // CLI settings
  const saveMethod = getEl<HTMLSelectElement>("saveMethod");
  const cliEnabled = getEl<HTMLInputElement>("cliEnabled");
  const cliPath = getEl<HTMLInputElement>("cliPath");
  const cliVault = getEl<HTMLInputElement>("cliVault");
  const cliSettings = getEl<HTMLDivElement>("cliSettings");

  if (saveMethod) saveMethod.value = settings.saveMethod || "uri";
  if (cliEnabled) cliEnabled.checked = settings.obsidianCli?.enabled ?? false;
  if (cliPath) cliPath.value = settings.obsidianCli?.cliPath || "";
  if (cliVault) cliVault.value = settings.obsidianCli?.vault || "";

  // Show/hide CLI settings based on save method
  if (cliSettings) {
    cliSettings.style.display = saveMethod?.value === "cli" ? "block" : "none";
  }
}
