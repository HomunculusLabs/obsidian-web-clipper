import type { Settings } from "../shared/settings";
import { saveSettings as saveSettingsToStorage } from "../shared/settingsService";
import { getEl, showStatus, escapeHtml } from "./ui";

export async function addFolder(settings: Settings): Promise<void> {
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
  renderSavedFolders(settings);

  await saveSettingsToStorage({
    savedFolders: settings.savedFolders
  });
}

export async function removeFolder(settings: Settings, folder: string): Promise<void> {
  settings.savedFolders = settings.savedFolders.filter((f) => f !== folder);
  renderSavedFolders(settings);

  await saveSettingsToStorage({
    savedFolders: settings.savedFolders
  });
}

export function renderSavedFolders(settings: Settings): void {
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
      const folderName = btn.dataset.folder;
      if (!folderName) return;
      void removeFolder(settings, folderName);
    });
  });
}
