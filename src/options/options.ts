import { DEFAULT_SETTINGS, SETTINGS_KEYS, type Settings } from "../shared/settings";
import { storageGet, storageSet } from "../shared/chromeAsync";

type StatusType = "success" | "error";

let settings: Settings = { ...DEFAULT_SETTINGS };
let statusTimer: number | null = null;

function getEl<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function showStatus(type: StatusType, message: string): void {
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

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function loadSettings(): Promise<void> {
  const stored = await storageGet<Settings>(SETTINGS_KEYS);
  settings = { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
  populateForm();
}

function populateForm(): void {
  const vaultName = getEl<HTMLInputElement>("vaultName");
  const defaultFolder = getEl<HTMLInputElement>("defaultFolder");
  const defaultTags = getEl<HTMLInputElement>("defaultTags");
  const includeTimestamps = getEl<HTMLInputElement>("includeTimestamps");

  if (vaultName) vaultName.value = settings.vaultName || "";
  if (defaultFolder) defaultFolder.value = settings.defaultFolder || "";
  if (defaultTags) defaultTags.value = settings.defaultTags || "";

  if (includeTimestamps) {
    includeTimestamps.checked = settings.includeTimestamps !== false;
  }
}

function setupEventListeners(): void {
  const saveBtn = getEl<HTMLButtonElement>("saveBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      void saveSettings();
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
      void addFolder();
    });
  }

  const newFolder = getEl<HTMLInputElement>("newFolder");
  if (newFolder) {
    newFolder.addEventListener("keypress", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void addFolder();
      }
    });
  }
}

async function saveSettings(): Promise<void> {
  const vaultName = getEl<HTMLInputElement>("vaultName");
  const defaultFolder = getEl<HTMLInputElement>("defaultFolder");
  const defaultTags = getEl<HTMLInputElement>("defaultTags");
  const includeTimestamps = getEl<HTMLInputElement>("includeTimestamps");

  settings = {
    vaultName: (vaultName?.value || "").trim() || DEFAULT_SETTINGS.vaultName,
    defaultFolder:
      (defaultFolder?.value || "").trim() || DEFAULT_SETTINGS.defaultFolder,
    defaultTags: (defaultTags?.value || "").trim() || DEFAULT_SETTINGS.defaultTags,
    includeTimestamps: includeTimestamps?.checked ?? DEFAULT_SETTINGS.includeTimestamps,
    savedFolders: Array.isArray(settings.savedFolders)
      ? settings.savedFolders
      : [...DEFAULT_SETTINGS.savedFolders]
  };

  await storageSet<Settings>(settings);
  showStatus("success", "Settings saved successfully!");
}

async function resetSettings(): Promise<void> {
  const ok = window.confirm(
    "Are you sure you want to reset all settings to default values?"
  );
  if (!ok) return;

  settings = { ...DEFAULT_SETTINGS };
  populateForm();
  renderSavedFolders();

  await storageSet<Settings>(settings);
  showStatus("success", "Settings reset to defaults!");
}

async function addFolder(): Promise<void> {
  const input = getEl<HTMLInputElement>("newFolder");
  if (!input) return;

  const folder = input.value.trim();

  if (!folder) {
    showStatus("error", "Please enter a folder path");
    return;
  }

  if (settings.savedFolders.includes(folder)) {
    showStatus("error", "Folder already exists");
    return;
  }

  settings.savedFolders.push(folder);
  input.value = "";
  renderSavedFolders();

  await storageSet<Pick<Settings, "savedFolders">>({
    savedFolders: settings.savedFolders
  });
}

async function removeFolder(folder: string): Promise<void> {
  settings.savedFolders = settings.savedFolders.filter((f) => f !== folder);
  renderSavedFolders();

  await storageSet<Pick<Settings, "savedFolders">>({
    savedFolders: settings.savedFolders
  });
}

function renderSavedFolders(): void {
  const container = getEl<HTMLDivElement>("savedFolders");
  if (!container) return;

  container.innerHTML = "";

  for (const folder of settings.savedFolders) {
    const div = document.createElement("div");
    div.className = "folder-tag";
    div.innerHTML = `
      <span>${escapeHtml(folder)}</span>
      <button class="remove-btn" data-folder="${escapeHtml(folder)}">&times;</button>
    `;
    container.appendChild(div);
  }

  container.querySelectorAll<HTMLButtonElement>(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const folder = btn.dataset.folder;
      if (!folder) return;
      void removeFolder(folder);
    });
  });
}

async function init(): Promise<void> {
  await loadSettings();
  setupEventListeners();
  renderSavedFolders();
}

document.addEventListener("DOMContentLoaded", () => {
  void init().catch((err: unknown) => {
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to load settings";
    console.error("Options init error:", err);
    showStatus("error", message);
  });
});