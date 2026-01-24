import { loadSettings } from "../../shared/settingsService";
import type { Settings } from "../../shared/settings";

export async function handleGetSettings(): Promise<Settings> {
  return loadSettings();
}