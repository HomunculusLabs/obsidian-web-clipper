import { DEFAULT_SETTINGS, type Settings } from "../shared/settings";
import {
  loadSettings as loadSettingsFromStorage,
  saveSettings as saveSettingsToStorage
} from "../shared/settingsService";
import { getEl, showStatus, populateForm } from "./ui";
import { addFolder, renderSavedFolders } from "./folderList";

let settings: Settings = { ...DEFAULT_SETTINGS };

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
  const vaultName = getEl<HTMLInputElement>("vaultName");
  const defaultFolder = getEl<HTMLInputElement>("defaultFolder");
  const defaultTags = getEl<HTMLInputElement>("defaultTags");
  const includeTimestamps = getEl<HTMLInputElement>("includeTimestamps");

  settings = {
    vaultName: (vaultName?.value || "").trim() || DEFAULT_SETTINGS.vaultName,
    defaultFolder: (defaultFolder?.value || "").trim() || DEFAULT_SETTINGS.defaultFolder,
    defaultTags: (defaultTags?.value || "").trim() || DEFAULT_SETTINGS.defaultTags,
    includeTimestamps: includeTimestamps?.checked ?? DEFAULT_SETTINGS.includeTimestamps,
    savedFolders: Array.isArray(settings.savedFolders)
      ? settings.savedFolders
      : [...DEFAULT_SETTINGS.savedFolders]
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