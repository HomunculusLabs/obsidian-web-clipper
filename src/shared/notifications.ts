import type { Settings } from "./settings";

const MAX_NOTIFICATION_FIELD_LENGTH = 120;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function getSafeTitle(rawTitle: string): string {
  const trimmed = rawTitle.trim();
  if (!trimmed) {
    return "Untitled";
  }

  return truncate(trimmed, MAX_NOTIFICATION_FIELD_LENGTH);
}

function getSafeVault(rawVault: string): string {
  const trimmed = rawVault.trim();
  if (!trimmed) {
    return "Main Vault";
  }

  return truncate(trimmed, MAX_NOTIFICATION_FIELD_LENGTH);
}

export async function showClipSavedNotification(
  settings: Settings,
  noteTitle: string,
  vaultName: string
): Promise<void> {
  if (!settings.enableClipNotifications) {
    return;
  }

  if (!chrome.notifications?.create) {
    return;
  }

  const title = getSafeTitle(noteTitle);
  const vault = getSafeVault(vaultName);

  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "Clip saved to Obsidian",
      message: `${title}\nVault: ${vault}`,
      priority: 1
    });
  } catch {
    // Notification failures should never block clipping flow.
  }
}
