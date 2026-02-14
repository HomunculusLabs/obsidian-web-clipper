import {
  DEFAULT_SETTINGS,
  VALID_CODE_BLOCK_LANGUAGE,
  VALID_TABLE_HANDLING,
  type Settings,
  type WikiLinkRule,
  type VaultProfile
} from "../shared/settings";
import type { CodeBlockLanguageMode, TableHandlingMode } from "../shared/types";
import type { SaveMethod } from "../shared/obsidianCli";
import type { DetectCliResponse, TestCliConnectionResponse } from "../shared/messages";
import {
  loadSettings as loadSettingsFromStorage,
  mergeSettings,
  saveSettings as saveSettingsToStorage
} from "../shared/settingsService";
import { getEl, showStatus, populateForm } from "./ui";
import { applyVaultProfileToSettings, getActiveVaultProfile, getVaultProfiles } from "../shared/vaultProfiles";
import { addFolder, renderSavedFolders } from "./folderList";
import {
  renderCustomTemplates,
  setupTemplateEditor
} from "./templateEditor";
import {
  validateTitleTemplate,
  BUILTIN_TITLE_TEMPLATES,
  type TitleTemplate
} from "../shared/titleTemplate";

let settings: Settings = { ...DEFAULT_SETTINGS };
let vaultProfilesDraft: VaultProfile[] = [];
let activeVaultProfileIdDraft = "";

const ONBOARDING_COMPLETED_KEY = "onboardingCompleted";
let onboardingDetectedCliPath = "";
let onboardingConnectionOk = false;

function buildVaultProfileId(): string {
  return `vault-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function syncDraftProfileFromForm(profileId: string): void {
  const profile = vaultProfilesDraft.find((item) => item.id === profileId);
  if (!profile) return;

  const name = getEl<HTMLInputElement>("vaultProfileName")?.value?.trim() || "";
  const vaultName = getEl<HTMLInputElement>("vaultProfileVaultName")?.value?.trim() || "";
  const defaultFolder = getEl<HTMLInputElement>("vaultProfileDefaultFolder")?.value?.trim() || "";
  const defaultTags = getEl<HTMLInputElement>("vaultProfileDefaultTags")?.value?.trim() || "";

  profile.name = name || vaultName || profile.name;
  profile.vaultName = vaultName || profile.vaultName;
  profile.defaultFolder = defaultFolder || profile.defaultFolder;
  profile.defaultTags = defaultTags || profile.defaultTags;
}

function renderVaultProfileEditor(): void {
  const select = getEl<HTMLSelectElement>("vaultProfileSelect");
  const nameInput = getEl<HTMLInputElement>("vaultProfileName");
  const vaultNameInput = getEl<HTMLInputElement>("vaultProfileVaultName");
  const defaultFolderInput = getEl<HTMLInputElement>("vaultProfileDefaultFolder");
  const defaultTagsInput = getEl<HTMLInputElement>("vaultProfileDefaultTags");

  if (!select || !nameInput || !vaultNameInput || !defaultFolderInput || !defaultTagsInput) return;

  select.innerHTML = "";
  for (const profile of vaultProfilesDraft) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    select.appendChild(option);
  }

  if (!vaultProfilesDraft.some((profile) => profile.id === activeVaultProfileIdDraft)) {
    activeVaultProfileIdDraft = vaultProfilesDraft[0]?.id || "";
  }

  select.value = activeVaultProfileIdDraft;
  const activeProfile = vaultProfilesDraft.find((profile) => profile.id === activeVaultProfileIdDraft);
  if (!activeProfile) return;

  nameInput.value = activeProfile.name;
  vaultNameInput.value = activeProfile.vaultName;
  defaultFolderInput.value = activeProfile.defaultFolder;
  defaultTagsInput.value = activeProfile.defaultTags;
}

function loadVaultProfilesDraft(sourceSettings: Settings): void {
  vaultProfilesDraft = getVaultProfiles(sourceSettings).map((profile) => ({ ...profile }));
  activeVaultProfileIdDraft = getActiveVaultProfile(sourceSettings).id;
  renderVaultProfileEditor();
}

function setOnboardingStatus(id: "onboardingDetectStatus" | "onboardingTestStatus", message: string, state: "neutral" | "success" | "error" = "neutral"): void {
  const el = getEl<HTMLParagraphElement>(id);
  if (!el) return;
  el.textContent = message;
  el.className = "onboarding-status-text";
  if (state !== "neutral") {
    el.classList.add(state);
  }
}

function syncProfileBasics(vaultName: string, defaultFolder: string): void {
  const activeProfile = vaultProfilesDraft.find((profile) => profile.id === activeVaultProfileIdDraft);
  if (!activeProfile) return;

  const nextVaultName = vaultName.trim() || activeProfile.vaultName;
  const nextDefaultFolder = defaultFolder.trim() || activeProfile.defaultFolder;

  activeProfile.vaultName = nextVaultName;
  activeProfile.name = nextVaultName;
  activeProfile.defaultFolder = nextDefaultFolder;
}

async function markOnboardingComplete(): Promise<void> {
  await chrome.storage.local.set({ [ONBOARDING_COMPLETED_KEY]: true });
}

async function isOnboardingCompleted(): Promise<boolean> {
  const raw = await chrome.storage.local.get(ONBOARDING_COMPLETED_KEY);
  return raw[ONBOARDING_COMPLETED_KEY] === true;
}

function setOnboardingVisibility(visible: boolean): void {
  const wizard = getEl<HTMLDivElement>("onboardingWizard");
  if (!wizard) return;
  wizard.style.display = visible ? "flex" : "none";
}

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

/**
 * Build custom templates array from user input.
 */
function buildCustomTemplates(
  selectedTemplate: string | undefined,
  customTemplateStr: string | undefined
): TitleTemplate[] {
  const customTemplates: TitleTemplate[] = [];

  // If the user entered a custom template, validate and add it
  if (customTemplateStr && customTemplateStr.trim()) {
    const trimmed = customTemplateStr.trim();

    // Check if it's different from all built-in templates
    const isBuiltIn = BUILTIN_TITLE_TEMPLATES.some((t) => t.template === trimmed);

    if (!isBuiltIn) {
      const validation = validateTitleTemplate(trimmed);
      if (validation.isValid) {
        customTemplates.push({
          id: "custom",
          name: "Custom Template",
          template: trimmed,
          builtIn: false,
          enabled: true
        });
      }
    }
  }

  return customTemplates;
}

interface SettingsExportFile {
  format: "obsidian-web-clipper-settings";
  exportedAt: string;
  settings: Settings;
}

function triggerJsonDownload(filename: string, json: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function exportCurrentSettings(): void {
  const payload: SettingsExportFile = {
    format: "obsidian-web-clipper-settings",
    exportedAt: new Date().toISOString(),
    settings
  };

  const datePart = payload.exportedAt.slice(0, 10);
  const json = JSON.stringify(payload, null, 2);
  triggerJsonDownload(`obsidian-web-clipper-settings-${datePart}.json`, json);
  showStatus("success", "Settings exported");
}

async function importSettingsFromFile(): Promise<void> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;

    void (async () => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;

        const maybeWrapped =
          typeof parsed === "object" && parsed !== null && "settings" in parsed
            ? (parsed as { settings?: unknown }).settings
            : parsed;

        if (typeof maybeWrapped !== "object" || maybeWrapped === null) {
          showStatus("error", "Invalid settings JSON format");
          return;
        }

        const confirmed = window.confirm(
          "Import settings and replace current values? This will overwrite your existing settings."
        );
        if (!confirmed) return;

        const merged = mergeSettings(maybeWrapped as Record<string, unknown>);
        await saveSettingsToStorage(merged);

        settings = applyVaultProfileToSettings(merged, getActiveVaultProfile(merged));
        populateForm(settings);
        loadVaultProfilesDraft(settings);
        renderSavedFolders(settings);
        renderCustomTemplates(settings.customTemplates || []);

        showStatus("success", "Settings imported");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to import settings";
        showStatus("error", message);
      }
    })();
  });

  input.click();
}

// --- Lifecycle ---

async function loadSettings(): Promise<void> {
  settings = await loadSettingsFromStorage();
  settings = applyVaultProfileToSettings(settings, getActiveVaultProfile(settings));
  populateForm(settings);
  loadVaultProfilesDraft(settings);
}

/**
 * Set up tab switching for the template editor modal.
 */
function setupTabSwitching(): void {
  const tabBtns = document.querySelectorAll(".tab-btn");
  
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabName = (btn as HTMLButtonElement).dataset.tab;
      if (!tabName) return;

      // Update button states
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Update content visibility
      const tabContents = document.querySelectorAll(".tab-content");
      tabContents.forEach((content) => {
        if ((content as HTMLElement).dataset.tab === tabName) {
          content.classList.add("active");
        } else {
          content.classList.remove("active");
        }
      });
    });
  });
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

  const exportSettingsBtn = getEl<HTMLButtonElement>("exportSettingsBtn");
  if (exportSettingsBtn) {
    exportSettingsBtn.addEventListener("click", () => {
      exportCurrentSettings();
    });
  }

  const importSettingsBtn = getEl<HTMLButtonElement>("importSettingsBtn");
  if (importSettingsBtn) {
    importSettingsBtn.addEventListener("click", () => {
      void importSettingsFromFile();
    });
  }

  const addFolderBtn = getEl<HTMLButtonElement>("addFolder");
  if (addFolderBtn) {
    addFolderBtn.addEventListener("click", () => {
      void addFolder(settings);
    });
  }

  const vaultProfileSelect = getEl<HTMLSelectElement>("vaultProfileSelect");
  if (vaultProfileSelect) {
    vaultProfileSelect.addEventListener("change", () => {
      syncDraftProfileFromForm(activeVaultProfileIdDraft);
      activeVaultProfileIdDraft = vaultProfileSelect.value;
      renderVaultProfileEditor();
    });
  }

  const addVaultProfileBtn = getEl<HTMLButtonElement>("addVaultProfileBtn");
  if (addVaultProfileBtn) {
    addVaultProfileBtn.addEventListener("click", () => {
      syncDraftProfileFromForm(activeVaultProfileIdDraft);
      const next: VaultProfile = {
        id: buildVaultProfileId(),
        name: "New Vault",
        vaultName: "New Vault",
        defaultFolder: DEFAULT_SETTINGS.defaultFolder,
        defaultTags: DEFAULT_SETTINGS.defaultTags
      };
      vaultProfilesDraft.push(next);
      activeVaultProfileIdDraft = next.id;
      renderVaultProfileEditor();
    });
  }

  const removeVaultProfileBtn = getEl<HTMLButtonElement>("removeVaultProfileBtn");
  if (removeVaultProfileBtn) {
    removeVaultProfileBtn.addEventListener("click", () => {
      if (vaultProfilesDraft.length <= 1) {
        showStatus("error", "At least one vault profile is required");
        return;
      }

      const removingId = activeVaultProfileIdDraft;
      vaultProfilesDraft = vaultProfilesDraft.filter((profile) => profile.id !== removingId);
      activeVaultProfileIdDraft = vaultProfilesDraft[0]?.id || "";
      renderVaultProfileEditor();
    });
  }

  const vaultProfileFields = ["vaultProfileName", "vaultProfileVaultName", "vaultProfileDefaultFolder", "vaultProfileDefaultTags"] as const;
  for (const fieldId of vaultProfileFields) {
    const input = getEl<HTMLInputElement>(fieldId);
    if (!input) continue;
    input.addEventListener("input", () => {
      syncDraftProfileFromForm(activeVaultProfileIdDraft);
      renderVaultProfileEditor();
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

  // Save method dropdown - show/hide CLI settings
  const saveMethod = getEl<HTMLSelectElement>("saveMethod");
  if (saveMethod) {
    saveMethod.addEventListener("change", () => {
      const cliSettings = getEl<HTMLDivElement>("cliSettings");
      if (cliSettings) {
        cliSettings.style.display = saveMethod.value === "cli" ? "block" : "none";
      }
    });
  }

  // Test CLI connection button
  const testCliBtn = getEl<HTMLButtonElement>("testCliBtn");
  if (testCliBtn) {
    testCliBtn.addEventListener("click", () => {
      void testCliConnection();
    });
  }

  // Auto-detect CLI button
  const autoDetectCliBtn = getEl<HTMLButtonElement>("autoDetectCliBtn");
  if (autoDetectCliBtn) {
    autoDetectCliBtn.addEventListener("click", () => {
      void autoDetectCli();
    });
  }

  const onboardingDetectBtn = getEl<HTMLButtonElement>("onboardingDetectBtn");
  if (onboardingDetectBtn) {
    onboardingDetectBtn.addEventListener("click", () => {
      void runOnboardingCliDetection();
    });
  }

  const onboardingTestBtn = getEl<HTMLButtonElement>("onboardingTestBtn");
  if (onboardingTestBtn) {
    onboardingTestBtn.addEventListener("click", () => {
      void runOnboardingConnectionTest();
    });
  }

  const onboardingSkipBtn = getEl<HTMLButtonElement>("onboardingSkipBtn");
  if (onboardingSkipBtn) {
    onboardingSkipBtn.addEventListener("click", () => {
      void skipOnboarding();
    });
  }

  const onboardingFinishBtn = getEl<HTMLButtonElement>("onboardingFinishBtn");
  if (onboardingFinishBtn) {
    onboardingFinishBtn.addEventListener("click", () => {
      void finishOnboarding();
    });
  }

  // Title templates toggle - show/hide template settings
  const titleTemplatesEnabled = getEl<HTMLInputElement>("titleTemplatesEnabled");
  if (titleTemplatesEnabled) {
    titleTemplatesEnabled.addEventListener("change", () => {
      const templateSettings = getEl<HTMLDivElement>("titleTemplateSettings");
      if (templateSettings) {
        templateSettings.style.display = titleTemplatesEnabled.checked ? "block" : "none";
      }
    });
  }

  // Custom template input - switch select to custom when user types
  const customTitleTemplate = getEl<HTMLInputElement>("customTitleTemplate");
  if (customTitleTemplate) {
    customTitleTemplate.addEventListener("input", () => {
      const select = getEl<HTMLSelectElement>("selectedTitleTemplate");
      if (select && customTitleTemplate.value.trim()) {
        // Check if it matches a built-in template
        const matchingBuiltIn = BUILTIN_TITLE_TEMPLATES.find(
          (t) => t.template === customTitleTemplate.value.trim()
        );
        if (!matchingBuiltIn) {
          // Add or select "custom" option
          let customOption = select.querySelector<HTMLOptionElement>('option[value="custom"]');
          if (!customOption) {
            customOption = document.createElement("option");
            customOption.value = "custom";
            customOption.textContent = "Custom Template";
            select.appendChild(customOption);
          }
          select.value = "custom";
        }
      }
    });
  }
}

async function saveCurrentSettings(): Promise<void> {
  // Core settings
  const includeTimestamps = getEl<HTMLInputElement>("includeTimestamps");
  const enableClipNotifications = getEl<HTMLInputElement>("enableClipNotifications");
  const badgeCounterEnabled = getEl<HTMLInputElement>("badgeCounterEnabled");
  const badgeCounterResetInterval = getEl<HTMLSelectElement>("badgeCounterResetInterval");

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

  // CLI settings
  const saveMethodEl = getEl<HTMLSelectElement>("saveMethod");
  const cliEnabled = getEl<HTMLInputElement>("cliEnabled");
  const cliPath = getEl<HTMLInputElement>("cliPath");
  const cliVault = getEl<HTMLInputElement>("cliVault");

  // Title cleanup settings
  const cleanTitlesEl = getEl<HTMLInputElement>("cleanTitles");
  const preferTitleCaseEl = getEl<HTMLInputElement>("preferTitleCase");

  // Title template settings
  const titleTemplatesEnabledEl = getEl<HTMLInputElement>("titleTemplatesEnabled");
  const selectedTitleTemplateEl = getEl<HTMLSelectElement>("selectedTitleTemplate");
  const customTitleTemplateEl = getEl<HTMLInputElement>("customTitleTemplate");

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

  syncDraftProfileFromForm(activeVaultProfileIdDraft);
  const normalizedVaultProfiles = vaultProfilesDraft
    .map((profile) => ({
      ...profile,
      name: (profile.name || "").trim() || (profile.vaultName || "").trim() || "Vault",
      vaultName: (profile.vaultName || "").trim() || DEFAULT_SETTINGS.vaultName,
      defaultFolder: (profile.defaultFolder || "").trim() || DEFAULT_SETTINGS.defaultFolder,
      defaultTags: (profile.defaultTags || "").trim() || DEFAULT_SETTINGS.defaultTags
    }))
    .filter((profile) => profile.id);

  const activeProfile =
    normalizedVaultProfiles.find((profile) => profile.id === activeVaultProfileIdDraft) ||
    normalizedVaultProfiles[0] ||
    DEFAULT_SETTINGS.vaultProfiles[0]!;

  // Build updated settings
  settings = {
    ...settings,

    // Core
    vaultName: activeProfile.vaultName,
    defaultFolder: activeProfile.defaultFolder,
    defaultTags: activeProfile.defaultTags,
    vaultProfiles: normalizedVaultProfiles.length > 0 ? normalizedVaultProfiles : [...DEFAULT_SETTINGS.vaultProfiles],
    activeVaultProfileId: activeProfile.id,
    includeTimestamps: includeTimestamps?.checked ?? DEFAULT_SETTINGS.includeTimestamps,
    savedFolders: Array.isArray(settings.savedFolders)
      ? settings.savedFolders
      : [...DEFAULT_SETTINGS.savedFolders],
    enableClipNotifications:
      enableClipNotifications?.checked ?? DEFAULT_SETTINGS.enableClipNotifications,
    badgeCounterEnabled:
      badgeCounterEnabled?.checked ?? DEFAULT_SETTINGS.badgeCounterEnabled,
    badgeCounterResetInterval:
      badgeCounterResetInterval?.value === "weekly" ? "weekly" : "daily",

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
    ),

    // CLI / Save method
    saveMethod: coerceEnum<SaveMethod>(
      saveMethodEl?.value,
      ["cli", "uri", "clipboard"] as const,
      DEFAULT_SETTINGS.saveMethod
    ),
    obsidianCli: {
      enabled: cliEnabled?.checked ?? false,
      cliPath: (cliPath?.value || "").trim(),
      vault: (cliVault?.value || "").trim() || activeProfile.vaultName
    },

    // Title cleanup
    cleanTitles: cleanTitlesEl?.checked ?? DEFAULT_SETTINGS.cleanTitles,
    preferTitleCase: preferTitleCaseEl?.checked ?? DEFAULT_SETTINGS.preferTitleCase,

    // Title templates
    titleTemplates: {
      enabled: titleTemplatesEnabledEl?.checked ?? false,
      selectedTemplate: selectedTitleTemplateEl?.value || "default",
      customTemplates: buildCustomTemplates(
        selectedTitleTemplateEl?.value,
        customTitleTemplateEl?.value
      )
    }
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
  loadVaultProfilesDraft(settings);
  renderSavedFolders(settings);

  await saveSettingsToStorage(settings);
  showStatus("success", "Settings reset to defaults!");
}

async function testCliConnection(): Promise<void> {
  const testBtn = getEl<HTMLButtonElement>("testCliBtn");
  const testResult = getEl<HTMLSpanElement>("cliTestResult");
  const cliPath = getEl<HTMLInputElement>("cliPath");
  const cliVault = getEl<HTMLInputElement>("cliVault");
  const vaultName = getEl<HTMLInputElement>("vaultName");

  if (!testBtn || !testResult) return;

  const cliPathValue = (cliPath?.value || "").trim();
  if (!cliPathValue) {
    testResult.textContent = "Please enter a CLI path first";
    testResult.className = "test-result error";
    return;
  }

  // Disable button and show testing state
  testBtn.disabled = true;
  testResult.textContent = "Testing...";
  testResult.className = "test-result";

  try {
    // Send test request to background script
    const response = await chrome.runtime.sendMessage({
      action: "testCliConnection",
      cliPath: cliPathValue,
      vault: (cliVault?.value || "").trim() || (vaultName?.value || "").trim()
    });

    if (response?.success) {
      testResult.textContent = "✓ Connection successful!";
      testResult.className = "test-result success";
    } else {
      testResult.textContent = `✗ ${response?.error || "Connection failed"}`;
      testResult.className = "test-result error";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    testResult.textContent = `✗ ${message}`;
    testResult.className = "test-result error";
  } finally {
    testBtn.disabled = false;
  }
}

async function autoDetectCli(): Promise<void> {
  const autoDetectBtn = getEl<HTMLButtonElement>("autoDetectCliBtn");
  const cliPath = getEl<HTMLInputElement>("cliPath");
  const testResult = getEl<HTMLSpanElement>("cliTestResult");

  if (!autoDetectBtn || !cliPath) return;

  // Disable button and show detecting state
  autoDetectBtn.disabled = true;
  if (testResult) {
    testResult.textContent = "Detecting...";
    testResult.className = "test-result";
  }

  try {
    // Send detect request to background script
    const response = await chrome.runtime.sendMessage({
      action: "detectCli"
    });

    if (response?.cliPath) {
      cliPath.value = response.cliPath;
      if (testResult) {
        const platform = response.platform || "unknown";
        testResult.textContent = `✓ Detected (${platform}): ${response.cliPath}`;
        testResult.className = "test-result success";
      }
    } else {
      if (testResult) {
        testResult.textContent = `No CLI found. ${response?.note || "Please enter the path manually."}`;
        testResult.className = "test-result error";
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (testResult) {
      testResult.textContent = `✗ Detection failed: ${message}`;
      testResult.className = "test-result error";
    }
  } finally {
    autoDetectBtn.disabled = false;
  }
}

async function runOnboardingCliDetection(): Promise<void> {
  const detectBtn = getEl<HTMLButtonElement>("onboardingDetectBtn");
  const vaultNameInput = getEl<HTMLInputElement>("onboardingVaultName");

  if (!detectBtn) return;

  detectBtn.disabled = true;
  setOnboardingStatus("onboardingDetectStatus", "Detecting...", "neutral");

  try {
    const response = await chrome.runtime.sendMessage({
      action: "detectCli"
    }) as DetectCliResponse;

    if (response?.cliPath) {
      onboardingDetectedCliPath = response.cliPath;

      const cliPathInput = getEl<HTMLInputElement>("cliPath");
      const cliVaultInput = getEl<HTMLInputElement>("cliVault");
      const cliEnabled = getEl<HTMLInputElement>("cliEnabled");

      if (cliPathInput) cliPathInput.value = response.cliPath;
      if (cliVaultInput) cliVaultInput.value = (vaultNameInput?.value || "").trim() || settings.vaultName;
      if (cliEnabled) cliEnabled.checked = true;

      setOnboardingStatus(
        "onboardingDetectStatus",
        `Detected ${response.cliPath}${response.platform ? ` (${response.platform})` : ""}`,
        "success"
      );
    } else {
      onboardingDetectedCliPath = "";
      setOnboardingStatus(
        "onboardingDetectStatus",
        response?.note || "No CLI found. You can still continue with URI save method.",
        "error"
      );
    }
  } catch (err) {
    onboardingDetectedCliPath = "";
    const message = err instanceof Error ? err.message : "Detection failed";
    setOnboardingStatus("onboardingDetectStatus", message, "error");
  } finally {
    detectBtn.disabled = false;
  }
}

async function runOnboardingConnectionTest(): Promise<void> {
  const testBtn = getEl<HTMLButtonElement>("onboardingTestBtn");
  if (!testBtn) return;

  const vaultName = (getEl<HTMLInputElement>("onboardingVaultName")?.value || "").trim();
  const cliPath = (getEl<HTMLInputElement>("cliPath")?.value || "").trim() || onboardingDetectedCliPath;

  if (!cliPath) {
    onboardingConnectionOk = false;
    setOnboardingStatus("onboardingTestStatus", "Set or detect a CLI path first.", "error");
    return;
  }

  testBtn.disabled = true;
  setOnboardingStatus("onboardingTestStatus", "Testing connection...", "neutral");

  try {
    const response = await chrome.runtime.sendMessage({
      action: "testCliConnection",
      cliPath,
      vault: vaultName || settings.vaultName
    }) as TestCliConnectionResponse;

    onboardingConnectionOk = !!response?.success;
    if (response?.success) {
      setOnboardingStatus("onboardingTestStatus", "Connection successful.", "success");
      return;
    }

    setOnboardingStatus(
      "onboardingTestStatus",
      response?.error || "Connection test failed.",
      "error"
    );
  } catch (err) {
    onboardingConnectionOk = false;
    const message = err instanceof Error ? err.message : "Connection test failed";
    setOnboardingStatus("onboardingTestStatus", message, "error");
  } finally {
    testBtn.disabled = false;
  }
}

async function skipOnboarding(): Promise<void> {
  await markOnboardingComplete();
  setOnboardingVisibility(false);
  showStatus("success", "Onboarding skipped. You can configure settings anytime.");
}

async function finishOnboarding(): Promise<void> {
  const vaultNameInput = getEl<HTMLInputElement>("onboardingVaultName");
  const defaultFolderInput = getEl<HTMLInputElement>("onboardingDefaultFolder");
  const saveMethodInput = getEl<HTMLSelectElement>("saveMethod");
  const cliEnabledInput = getEl<HTMLInputElement>("cliEnabled");
  const cliVaultInput = getEl<HTMLInputElement>("cliVault");

  const vaultName = (vaultNameInput?.value || "").trim() || settings.vaultName;
  const defaultFolder = (defaultFolderInput?.value || "").trim() || settings.defaultFolder;

  const vaultNameField = getEl<HTMLInputElement>("vaultName");
  const defaultFolderField = getEl<HTMLInputElement>("defaultFolder");
  if (vaultNameField) vaultNameField.value = vaultName;
  if (defaultFolderField) defaultFolderField.value = defaultFolder;

  syncProfileBasics(vaultName, defaultFolder);

  if (cliVaultInput) {
    cliVaultInput.value = vaultName;
  }

  if (onboardingDetectedCliPath) {
    const cliPathInput = getEl<HTMLInputElement>("cliPath");
    if (cliPathInput) cliPathInput.value = onboardingDetectedCliPath;
    if (cliEnabledInput) cliEnabledInput.checked = true;
  }

  if (saveMethodInput && onboardingDetectedCliPath) {
    saveMethodInput.value = onboardingConnectionOk ? "cli" : "uri";
    const cliSettings = getEl<HTMLDivElement>("cliSettings");
    if (cliSettings) {
      cliSettings.style.display = saveMethodInput.value === "cli" ? "block" : "none";
    }
  }

  await saveCurrentSettings();
  await markOnboardingComplete();
  setOnboardingVisibility(false);
  showStatus("success", "Onboarding complete. Settings saved.");
}

async function maybeShowOnboarding(): Promise<void> {
  const completed = await isOnboardingCompleted();
  if (completed) return;

  onboardingDetectedCliPath = settings.obsidianCli?.cliPath || "";
  onboardingConnectionOk = false;

  const vaultNameInput = getEl<HTMLInputElement>("onboardingVaultName");
  const defaultFolderInput = getEl<HTMLInputElement>("onboardingDefaultFolder");
  if (vaultNameInput) vaultNameInput.value = settings.vaultName || DEFAULT_SETTINGS.vaultName;
  if (defaultFolderInput) defaultFolderInput.value = settings.defaultFolder || DEFAULT_SETTINGS.defaultFolder;

  if (onboardingDetectedCliPath) {
    setOnboardingStatus("onboardingDetectStatus", `Using existing CLI path: ${onboardingDetectedCliPath}`, "success");
  } else {
    setOnboardingStatus("onboardingDetectStatus", "Not detected yet.", "neutral");
  }
  setOnboardingStatus("onboardingTestStatus", "Connection not tested yet.", "neutral");

  setOnboardingVisibility(true);
}

async function init(): Promise<void> {
  await loadSettings();
  setupEventListeners();
  renderSavedFolders(settings);
  renderCustomTemplates(settings.customTemplates || []);
  setupTemplateEditor(
    settings.customTemplates || [],
    async () => {
      await saveSettingsToStorage({ customTemplates: settings.customTemplates });
    }
  );
  setupTabSwitching();
  await maybeShowOnboarding();
}

document.addEventListener("DOMContentLoaded", () => {
  void init().catch((err: unknown) => {
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to load settings";
    console.error("Options init error:", err);
    showStatus("error", message);
  });
});