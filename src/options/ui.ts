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
