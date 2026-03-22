import { describe, expect, test } from "bun:test";
import { applyVaultProfileToSettings, getActiveVaultProfile } from "../src/shared/vaultProfiles";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/settings";

describe("vault profile CLI merging", () => {
  test("active profile CLI config overrides top-level settings when persisted on the profile", () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      obsidianCli: {
        enabled: true,
        cliPath: "/home/user/.local/bin/obsidian",
        vault: "Main Vault"
      },
      vaultProfiles: [
        {
          id: "default-vault",
          name: "Main Vault",
          vaultName: "Main Vault",
          defaultFolder: "Clips",
          defaultTags: "web-clip",
          obsidianCli: {
            enabled: true,
            cliPath: "/home/user/.local/bin/obsidian",
            vault: "Main Vault"
          }
        }
      ],
      activeVaultProfileId: "default-vault"
    };

    const applied = applyVaultProfileToSettings(settings, getActiveVaultProfile(settings));
    expect(applied.obsidianCli.enabled).toBe(true);
    expect(applied.obsidianCli.cliPath).toBe("/home/user/.local/bin/obsidian");
    expect(applied.obsidianCli.vault).toBe("Main Vault");
  });

  test("stale profile CLI config can disable top-level CLI settings", () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      obsidianCli: {
        enabled: true,
        cliPath: "/home/user/.local/bin/obsidian",
        vault: "Main Vault"
      },
      vaultProfiles: [
        {
          id: "default-vault",
          name: "Main Vault",
          vaultName: "Main Vault",
          defaultFolder: "Clips",
          defaultTags: "web-clip",
          obsidianCli: {
            enabled: false,
            cliPath: "",
            vault: ""
          }
        }
      ],
      activeVaultProfileId: "default-vault"
    };

    const applied = applyVaultProfileToSettings(settings, getActiveVaultProfile(settings));
    expect(applied.obsidianCli.enabled).toBe(false);
    expect(applied.obsidianCli.cliPath).toBe("/home/user/.local/bin/obsidian");
  });
});
