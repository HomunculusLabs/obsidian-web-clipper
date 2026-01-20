export interface Settings {
  vaultName: string;
  defaultFolder: string;
  defaultTags: string;
  includeTimestamps: boolean;
  savedFolders: string[];
  [key: string]: string | boolean | string[] | undefined;
}

export const DEFAULT_SETTINGS: Settings = {
  vaultName: "Main Vault",
  defaultFolder: "2 - Source Material/Clips",
  defaultTags: "web-clip",
  includeTimestamps: true,
  savedFolders: ["2 - Source Material/Clips"]
};

export const SETTINGS_KEYS = [
  "vaultName",
  "defaultFolder",
  "defaultTags",
  "includeTimestamps",
  "savedFolders"
] as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[number];