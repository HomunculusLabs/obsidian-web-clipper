import type { Settings, VaultProfile } from "./settings";
import { DEFAULT_SETTINGS } from "./settings";
import type { ObsidianCliConfig } from "./obsidianCli";

function normalizeProfile(profile: VaultProfile): VaultProfile {
  const fallback = DEFAULT_SETTINGS.vaultProfiles[0]!;
  return {
    id: (profile.id || "").trim() || fallback.id,
    name: (profile.name || "").trim() || profile.vaultName || fallback.name,
    vaultName: (profile.vaultName || "").trim() || fallback.vaultName,
    defaultFolder: (profile.defaultFolder || "").trim() || fallback.defaultFolder,
    defaultTags: (profile.defaultTags || "").trim() || fallback.defaultTags,
    obsidianCli: profile.obsidianCli,
  };
}

export function getVaultProfiles(settings: Settings): VaultProfile[] {
  const normalized = (settings.vaultProfiles || [])
    .map(normalizeProfile)
    .filter((profile, index, all) => all.findIndex((other) => other.id === profile.id) === index);

  return normalized.length > 0 ? normalized : [...DEFAULT_SETTINGS.vaultProfiles];
}

export function getActiveVaultProfile(settings: Settings): VaultProfile {
  const profiles = getVaultProfiles(settings);
  const activeId = (settings.activeVaultProfileId || "").trim();
  return profiles.find((profile) => profile.id === activeId) || profiles[0]!;
}

function mergeCliConfig(baseCli: ObsidianCliConfig, fromProfile?: ObsidianCliConfig): ObsidianCliConfig {
  if (!fromProfile) return baseCli;

  return {
    enabled: fromProfile.enabled ?? baseCli.enabled,
    cliPath: fromProfile.cliPath || baseCli.cliPath,
    vault: fromProfile.vault || baseCli.vault,
  };
}

export function applyVaultProfileToSettings(settings: Settings, profile: VaultProfile): Settings {
  const mergedCli = mergeCliConfig(settings.obsidianCli, profile.obsidianCli);

  return {
    ...settings,
    vaultProfiles: getVaultProfiles(settings),
    activeVaultProfileId: profile.id,
    vaultName: profile.vaultName,
    defaultFolder: profile.defaultFolder,
    defaultTags: profile.defaultTags,
    obsidianCli: {
      ...mergedCli,
      vault: profile.vaultName,
    },
  };
}
