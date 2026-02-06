import { DEFAULT_SETTINGS, type Settings } from "../shared/settings";
import { storageSet } from "../shared/chromeAsync";

export async function ensureDefaultsOnInstall(details: chrome.runtime.InstalledDetails): Promise<void> {
  if (details.reason !== "install") return;

  await storageSet<Settings>(DEFAULT_SETTINGS);

  try {
    chrome.runtime.openOptionsPage();
  } catch (err) {
    console.error("Failed to open options page:", err);
  }
}