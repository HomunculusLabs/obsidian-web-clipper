/**
 * Settings Service - Load, validate, migrate, and save settings.
 * 
 * Task 95: Settings validation — Add Zod schema for Settings.
 * 
 * Uses Zod for:
 * - Schema validation on settings load
 * - Migration support for version changes
 * - Graceful handling of corrupt storage
 */

import { z } from "zod";
import {
  SettingsSchema,
  migrateSettings,
  validateSettingsWithDefaults,
  CURRENT_SETTINGS_VERSION,
  type PartialSettingsZod,
} from "./settingsSchema";
import { storageGet, storageSet } from "./chromeAsync";
import { initDebug } from "./debug";
import type { Settings } from "./settings";

// Re-export for backwards compatibility
export { CURRENT_SETTINGS_VERSION };

/**
 * Result of loading settings.
 */
export interface LoadSettingsResult {
  /** Loaded settings (guaranteed to be valid with all defaults applied) */
  settings: Settings;
  /** Whether the load encountered any issues */
  hadIssues: boolean;
  /** Whether migration was performed */
  migrated: boolean;
  /** Fields that were reset to defaults due to validation failures */
  resetFields: string[];
  /** Fields that were migrated */
  migratedFields: string[];
}

/**
 * Result of a corrupt storage recovery.
 */
export interface CorruptStorageRecoveryResult {
  /** Whether recovery was successful */
  recovered: boolean;
  /** The backup/recovered settings */
  settings: Settings;
  /** Error message if recovery failed */
  error?: string;
}

/**
 * Merges stored partial settings with defaults using Zod validation.
 * This is the pure merge function useful for testing.
 * 
 * @param stored - Partial settings from storage (may be undefined/corrupt)
 * @returns Complete, validated settings
 */
export function mergeSettings(stored: PartialSettingsZod | undefined | null): Settings {
  // Handle null/undefined storage
  if (!stored || typeof stored !== "object") {
    return SettingsSchema.parse({}) as Settings;
  }

  // Perform migration if needed
  const migrationResult = migrateSettings(stored as Record<string, unknown>);
  const settingsToValidate = migrationResult.settings;

  // Validate with defaults for invalid fields
  const validationResult = validateSettingsWithDefaults(
    settingsToValidate as Record<string, unknown>
  );

  // Cast to Settings type (Zod schema matches Settings interface)
  return validationResult.settings as Settings;
}

/**
 * Loads settings from chrome.storage.local with full validation and migration.
 * 
 * This function:
 * 1. Loads settings from storage
 * 2. Validates using Zod schema
 * 3. Migrates from older versions if needed
 * 4. Handles corrupt storage gracefully
 * 5. Initializes debug logging
 * 
 * @returns Complete, validated Settings object
 */
export async function loadSettings(): Promise<Settings> {
  const result = await loadSettingsWithMeta();
  return result.settings;
}

/**
 * Loads settings with full metadata about the load operation.
 * Use this when you need to know if migration occurred or fields were reset.
 * 
 * @returns LoadSettingsResult with validated settings and status info
 */
export async function loadSettingsWithMeta(): Promise<LoadSettingsResult> {
  try {
    // Load all settings keys from storage
    const rawStored = await storageGet<Record<string, unknown>>(null);
    
    // Handle completely empty storage
    if (!rawStored || Object.keys(rawStored).length === 0) {
      const defaultSettings = SettingsSchema.parse({}) as Settings;
      initDebug(false);
      
      return {
        settings: defaultSettings,
        hadIssues: false,
        migrated: false,
        resetFields: [],
        migratedFields: [],
      };
    }

    // Extract only known settings keys
    const stored: Record<string, unknown> = {};
    const knownKeys = Object.keys(SettingsSchema.shape);
    for (const key of knownKeys) {
      if (key in rawStored) {
        stored[key] = rawStored[key];
      }
    }

    // Perform migration
    const migrationResult = migrateSettings(stored);
    
    // Validate and get result
    const validationResult = validateSettingsWithDefaults(
      migrationResult.settings as Record<string, unknown>
    );

    const settings = validationResult.settings as Settings;
    
    // Initialize debug logging
    initDebug(settings.debug ?? false);

    // If we migrated or reset fields, save the updated settings
    if (migrationResult.migrated || validationResult.resetFields.length > 0) {
      await saveSettings(settings);
    }

    return {
      settings,
      hadIssues: validationResult.resetFields.length > 0,
      migrated: migrationResult.migrated,
      resetFields: validationResult.resetFields,
      migratedFields: migrationResult.migratedFields,
    };
  } catch (error) {
    // Handle corrupt storage - return defaults and log error
    console.error("[SettingsService] Failed to load settings, using defaults:", error);
    
    const defaultSettings = SettingsSchema.parse({}) as Settings;
    initDebug(false);

    return {
      settings: defaultSettings,
      hadIssues: true,
      migrated: false,
      resetFields: ["*"], // Indicates full reset
      migratedFields: [],
    };
  }
}

/**
 * Saves settings to chrome.storage.local with validation.
 * 
 * @param settings - Partial settings to save
 * @throws Error if validation fails (caller should handle gracefully)
 */
export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  // Ensure settings version is set
  const settingsWithVersion = {
    ...settings,
    settingsVersion: CURRENT_SETTINGS_VERSION,
  };

  // Validate the settings before saving
  const validationResult = SettingsSchema.partial().safeParse(settingsWithVersion);
  
  if (!validationResult.success) {
    console.error("[SettingsService] Validation failed:", validationResult.error.errors);
    // Still save, but log the error - the load function will handle recovery
  }

  await storageSet<Record<string, unknown>>(settingsWithVersion as Record<string, unknown>);
}

/**
 * Attempts to recover from corrupt storage.
 * This clears all settings and returns defaults.
 * 
 * @returns Recovery result with default settings
 */
export async function recoverFromCorruptStorage(): Promise<CorruptStorageRecoveryResult> {
  try {
    // Clear all storage
    await chrome.storage.local.clear();
    
    // Return defaults
    const defaultSettings = SettingsSchema.parse({}) as Settings;
    
    // Save defaults
    await saveSettings(defaultSettings);
    
    return {
      recovered: true,
      settings: defaultSettings,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[SettingsService] Recovery failed:", error);
    
    return {
      recovered: false,
      settings: SettingsSchema.parse({}) as Settings,
      error: errorMessage,
    };
  }
}

/**
 * Validates a single settings value without saving.
 * Useful for form validation in the options page.
 * 
 * @param key - Settings key
 * @param value - Value to validate
 * @returns Object with isValid flag and optional error message
 */
export function validateSingleSetting(
  key: string,
  value: unknown
): { isValid: boolean; error?: string } {
  const schema = SettingsSchema.shape;
  
  if (!(key in schema)) {
    return { isValid: false, error: `Unknown setting: ${key}` };
  }

  const result = (schema[key as keyof typeof schema] as z.ZodTypeAny).safeParse(value);
  
  if (result.success) {
    return { isValid: true };
  }

  // Format the first error
  const firstError = result.error.errors[0];
  const message = firstError?.message || "Invalid value";
  
  return {
    isValid: false,
    error: `${key}: ${message}`,
  };
}

