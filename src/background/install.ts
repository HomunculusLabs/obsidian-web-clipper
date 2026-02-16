import { DEFAULT_SETTINGS, type Settings } from "../shared/settings";
import { storageSet } from "../shared/chromeAsync";
import { detectObsidianCli } from "../shared/cliDetect";
import { debug } from "../shared/debug";

export async function ensureDefaultsOnInstall(details: chrome.runtime.InstalledDetails): Promise<void> {
  if (details.reason !== "install") return;

  // Start with default settings
  const settings = { ...DEFAULT_SETTINGS };

  // Auto-detect Obsidian CLI path
  try {
    const detection = detectObsidianCli();
    if (detection.cliPath) {
      settings.obsidianCli = {
        ...settings.obsidianCli,
        cliPath: detection.cliPath,
      };
      debug(
        "CLI Auto-Detect",
        `Platform: ${detection.platform}, Suggested path: ${detection.cliPath}`
      );
    }
  } catch (err) {
    console.warn("[CLI Auto-Detect] Failed to detect CLI:", err);
  }

  await storageSet<Settings>(settings);

  try {
    chrome.runtime.openOptionsPage();
  } catch (err) {
    console.error("Failed to open options page:", err);
  }
}