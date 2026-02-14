import { describe, expect, test } from "bun:test";
import {
  SettingsSchema,
  migrateSettings,
  validateSettingsWithDefaults,
  CURRENT_SETTINGS_VERSION,
} from "../src/shared/settingsSchema";
import { mergeSettings } from "../src/shared/settingsService";

describe("SettingsSchema", () => {
  test("applies defaults for empty input", () => {
    const settings = SettingsSchema.parse({});

    expect(settings.vaultName).toBe("Main Vault");
    expect(settings.defaultFolder).toBe("2 - Source Material/Clips");
    expect(settings.saveMethod).toBe("uri");
    expect(settings.enableClipNotifications).toBe(true);
    expect(settings.settingsVersion).toBeUndefined();
  });

  test("validates and resets invalid enum fields to defaults", () => {
    const invalid = {
      saveMethod: "not-a-method",
      tableHandling: "invalid-mode",
      codeBlockLanguageMode: "bad-mode",
      imageHandling: "bad-image-mode",
    } as Record<string, unknown>;

    const result = validateSettingsWithDefaults(invalid);

    expect(result.settings.saveMethod).toBe("uri");
    expect(result.settings.tableHandling).toBe("gfm");
    expect(result.settings.codeBlockLanguageMode).toBe("class-only");
    expect(result.settings.imageHandling).toBe("keep");
    expect(result.resetFields).toEqual(
      expect.arrayContaining([
        "saveMethod",
        "tableHandling",
        "codeBlockLanguageMode",
        "imageHandling",
      ])
    );
  });
});

describe("settings migration", () => {
  test("migrates version 0 settings to current version", () => {
    const legacySettings = {
      vaultName: "Legacy Vault",
      settingsVersion: 0,
      obsidianCli: null,
      titleTemplates: null,
      savedFolders: "not-an-array",
      wikiLinkRules: "not-an-array",
    } as Record<string, unknown>;

    const migration = migrateSettings(legacySettings);

    expect(migration.migrated).toBe(true);
    expect(migration.fromVersion).toBe(0);
    expect(migration.toVersion).toBe(CURRENT_SETTINGS_VERSION);
    expect((migration.settings as { settingsVersion?: number }).settingsVersion).toBe(1);
    expect(Array.isArray((migration.settings as { savedFolders?: unknown }).savedFolders)).toBe(true);
    expect(Array.isArray((migration.settings as { wikiLinkRules?: unknown }).wikiLinkRules)).toBe(true);
    expect((migration.settings as { obsidianCli?: unknown }).obsidianCli).toEqual({
      cliPath: "",
      vault: "",
      enabled: false,
    });
  });

  test("mergeSettings handles invalid/corrupt values gracefully", () => {
    const merged = mergeSettings({
      vaultName: 123 as unknown as string,
      wikiLinkMaxPerTerm: -10 as unknown as number,
      debug: "yes" as unknown as boolean,
      saveMethod: "bad" as unknown as "cli",
    });

    expect(merged.vaultName).toBe("Main Vault");
    expect(merged.wikiLinkMaxPerTerm).toBe(1);
    expect(merged.debug).toBe(false);
    expect(merged.saveMethod).toBe("uri");
  });
});
