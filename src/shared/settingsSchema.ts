/**
 * Zod schema for Settings validation.
 * Task 95: Settings validation — Add Zod schema for Settings.
 * 
 * Provides:
 * - Schema validation on settings load
 * - Migration support for version changes
 * - Graceful handling of corrupt storage
 */

import { z } from "zod";

// ============================================================================
// Sub-schemas for nested types
// ============================================================================

/**
 * Wiki-link injection rule schema.
 */
export const WikiLinkRuleSchema = z.object({
  term: z.string().min(1, "Wiki-link term cannot be empty"),
  note: z.string().min(1, "Wiki-link note cannot be empty"),
});

export type WikiLinkRuleZod = z.infer<typeof WikiLinkRuleSchema>;

/**
 * Obsidian CLI configuration schema.
 */
export const ObsidianCliConfigSchema = z.object({
  cliPath: z.string().default(""),
  vault: z.string().default(""),
  enabled: z.boolean().default(false),
});

export type ObsidianCliConfigZod = z.infer<typeof ObsidianCliConfigSchema>;

/**
 * Vault profile schema for multi-vault support.
 */
export const VaultProfileSchema = z.object({
  id: z.string().min(1, "Vault profile ID is required"),
  name: z.string().min(1, "Vault profile name is required"),
  vaultName: z.string().min(1, "Vault name is required"),
  defaultFolder: z.string().default("2 - Source Material/Clips"),
  defaultTags: z.string().default("web-clip"),
  obsidianCli: ObsidianCliConfigSchema.optional(),
});

export type VaultProfileZod = z.infer<typeof VaultProfileSchema>;

/**
 * Template selectors schema.
 */
export const TemplateSelectorsSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  author: z.string().optional(),
  date: z.string().optional(),
  tags: z.string().optional(),
  description: z.string().optional(),
  url: z.string().optional(),
  image: z.string().optional(),
});

export type TemplateSelectorsZod = z.infer<typeof TemplateSelectorsSchema>;

/**
 * Site template schema.
 */
export const SiteTemplateSchema = z.object({
  domain: z.string().min(1, "Template domain cannot be empty"),
  name: z.string().min(1, "Template name cannot be empty"),
  selectors: TemplateSelectorsSchema,
  removeSelectors: z.array(z.string()).optional(),
  frontmatterExtras: z.record(z.string()).optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().optional(),
  description: z.string().optional(),
  urlPattern: z.string().optional(),
});

export type SiteTemplateZod = z.infer<typeof SiteTemplateSchema>;

/**
 * Domain tag rule schema.
 */
export const DomainTagRuleSchema = z.object({
  domain: z.string().min(1, "Domain pattern cannot be empty"),
  tags: z.array(z.string()).min(1, "At least one tag is required"),
  enabled: z.boolean().default(true),
});

export type DomainTagRuleZod = z.infer<typeof DomainTagRuleSchema>;

/**
 * Tag rule condition type schema.
 */
export const TagRuleConditionTypeSchema = z.enum([
  "domain-contains",
  "url-contains",
  "title-contains",
  "content-contains",
  "keywords-contain",
  "category-is",
  "author-contains",
  "site-name-contains",
]);

export type TagRuleConditionTypeZod = z.infer<typeof TagRuleConditionTypeSchema>;

/**
 * Tag rule condition schema.
 */
export const TagRuleConditionSchema = z.object({
  type: TagRuleConditionTypeSchema,
  value: z.string().min(1, "Condition value cannot be empty"),
  invert: z.boolean().optional(),
});

export type TagRuleConditionZod = z.infer<typeof TagRuleConditionSchema>;

/**
 * Tag rule schema.
 */
export const TagRuleSchema = z.object({
  id: z.string().min(1, "Rule ID is required"),
  name: z.string().min(1, "Rule name is required"),
  condition: TagRuleConditionSchema,
  tags: z.array(z.string()).min(1, "At least one tag is required"),
  enabled: z.boolean().default(true),
  priority: z.number().int().optional(),
});

export type TagRuleZod = z.infer<typeof TagRuleSchema>;

/**
 * Title template schema.
 */
export const TitleTemplateSchema = z.object({
  id: z.string().min(1, "Template ID is required"),
  name: z.string().min(1, "Template name is required"),
  template: z.string().min(1, "Template string is required"),
  builtIn: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export type TitleTemplateZod = z.infer<typeof TitleTemplateSchema>;

/**
 * Title template settings schema.
 */
export const TitleTemplateSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  selectedTemplate: z.string().default("default"),
  customTemplates: z.array(TitleTemplateSchema).default([]),
});

export type TitleTemplateSettingsZod = z.infer<typeof TitleTemplateSettingsSchema>;

// ============================================================================
// Enum schemas
// ============================================================================

export const SaveMethodSchema = z.enum(["cli", "uri", "clipboard"]);
export type SaveMethodZod = z.infer<typeof SaveMethodSchema>;

export const TableHandlingModeSchema = z.enum(["gfm", "html", "remove"]);
export type TableHandlingModeZod = z.infer<typeof TableHandlingModeSchema>;

export const CodeBlockLanguageModeSchema = z.enum(["off", "class-only", "class-heuristic"]);
export type CodeBlockLanguageModeZod = z.infer<typeof CodeBlockLanguageModeSchema>;

export const ImageHandlingModeSchema = z.enum(["keep", "remove", "data-uri", "download-api"]);
export type ImageHandlingModeZod = z.infer<typeof ImageHandlingModeSchema>;

// ============================================================================
// Main Settings schema
// ============================================================================

/**
 * Full Settings schema with all fields.
 */
export const SettingsSchema = z.object({
  // --- Core settings ---
  vaultName: z.string().default("Main Vault"),
  defaultFolder: z.string().default("2 - Source Material/Clips"),
  defaultTags: z.string().default("web-clip"),
  vaultProfiles: z.array(VaultProfileSchema).default([
    {
      id: "default-vault",
      name: "Main Vault",
      vaultName: "Main Vault",
      defaultFolder: "2 - Source Material/Clips",
      defaultTags: "web-clip",
      obsidianCli: { cliPath: "", vault: "", enabled: false },
    },
  ]),
  activeVaultProfileId: z.string().default("default-vault"),
  includeTimestamps: z.boolean().default(true),
  savedFolders: z.array(z.string()).default(["2 - Source Material/Clips"]),
  enableClipNotifications: z.boolean().default(true),

  // --- Save method settings ---
  saveMethod: SaveMethodSchema.default("uri"),
  obsidianCli: ObsidianCliConfigSchema.default({ cliPath: "", vault: "", enabled: false }),

  // --- Metadata settings ---
  includeOGFields: z.boolean().default(true),
  includeTwitterFields: z.boolean().default(false),
  parseJsonLd: z.boolean().default(true),
  includeKeywords: z.boolean().default(true),
  computeReadingStats: z.boolean().default(true),
  preferCanonicalUrl: z.boolean().default(true),

  // --- Wiki-link settings ---
  enableWikiLinks: z.boolean().default(false),
  wikiLinkRules: z.array(WikiLinkRuleSchema).default([]),
  wikiLinkExistingNotesOnly: z.boolean().default(false),
  wikiLinkNoteIndex: z.array(z.string()).default([]),
  wikiLinkCaseSensitive: z.boolean().default(false),
  wikiLinkWholeWord: z.boolean().default(true),
  wikiLinkMaxPerTerm: z.number().int().positive().default(1),

  // --- Code block settings ---
  codeBlockLanguageMode: CodeBlockLanguageModeSchema.default("class-only"),

  // --- Table settings ---
  tableHandling: TableHandlingModeSchema.default("gfm"),

  // --- Image settings ---
  imageHandling: ImageHandlingModeSchema.default("keep"),
  imageDownloadEndpoint: z.string().default(""),
  imageAttachmentsFolder: z.string().default("attachments"),

  // --- Template settings ---
  templatesEnabled: z.boolean().default(true),
  customTemplates: z.array(SiteTemplateSchema).default([]),
  disabledBuiltIns: z.array(z.string()).default([]),

  // --- Tag suggestion settings ---
  domainTagRules: z.array(DomainTagRuleSchema).default([]),
  useDefaultDomainTags: z.boolean().default(true),

  // --- Tag rules engine ---
  tagRules: z.array(TagRuleSchema).default([]),
  useDefaultTagRules: z.boolean().default(true),

  // --- Title cleanup settings ---
  cleanTitles: z.boolean().default(true),
  preferTitleCase: z.boolean().default(true),

  // --- Title template settings ---
  titleTemplates: TitleTemplateSettingsSchema.default({
    enabled: false,
    selectedTemplate: "default",
    customTemplates: [],
  }),

  // --- Debug settings ---
  debug: z.boolean().default(false),

  // --- Settings version for migration ---
  settingsVersion: z.number().int().optional(),
});

export type SettingsZod = z.infer<typeof SettingsSchema>;

// ============================================================================
// Partial settings schema for loading from storage
// ============================================================================

/**
 * Schema for partial settings (what we load from chrome.storage).
 * All fields are optional since storage may only contain user overrides.
 */
export const PartialSettingsSchema = SettingsSchema.partial();

export type PartialSettingsZod = z.infer<typeof PartialSettingsSchema>;

// ============================================================================
// Migration utilities
// ============================================================================

/**
 * Current settings schema version.
 * Increment when making breaking changes to settings structure.
 */
export const CURRENT_SETTINGS_VERSION = 1;

/**
 * Result of migration operation.
 */
export interface MigrationResult {
  /** Migrated settings */
  settings: PartialSettingsZod;
  /** Whether migration was performed */
  migrated: boolean;
  /** Version migrated from */
  fromVersion: number;
  /** Version migrated to */
  toVersion: number;
  /** List of fields that were migrated/transformed */
  migratedFields: string[];
}

/**
 * Migrates settings from an older version to the current version.
 * 
 * @param settings - Partial settings loaded from storage
 * @returns Migration result with migrated settings
 */
export function migrateSettings(
  settings: Record<string, unknown>
): MigrationResult {
  const version = typeof settings.settingsVersion === "number" 
    ? settings.settingsVersion 
    : 0;
  
  const migratedFields: string[] = [];
  let result = { ...settings };

  // No migration needed if already at current version
  if (version >= CURRENT_SETTINGS_VERSION) {
    return {
      settings: result as PartialSettingsZod,
      migrated: false,
      fromVersion: version,
      toVersion: CURRENT_SETTINGS_VERSION,
      migratedFields: [],
    };
  }

  // Migration from version 0 (no version) to version 1
  if (version < 1) {
    // Ensure all new fields have defaults
    // This handles the case where older settings don't have newer fields
    
    // Example migration: If we renamed a field in the future
    // if ("oldFieldName" in result) {
    //   result.newFieldName = result.oldFieldName;
    //   delete result.oldFieldName;
    //   migratedFields.push("oldFieldName -> newFieldName");
    // }

    // Ensure arrays exist
    if (!Array.isArray(result.savedFolders)) {
      result.savedFolders = ["2 - Source Material/Clips"];
      migratedFields.push("savedFolders");
    }
    if (!Array.isArray(result.vaultProfiles)) {
      const fallbackVaultName = typeof result.vaultName === "string" && result.vaultName.trim()
        ? result.vaultName.trim()
        : "Main Vault";
      const fallbackDefaultFolder =
        typeof result.defaultFolder === "string" && result.defaultFolder.trim()
          ? result.defaultFolder.trim()
          : "2 - Source Material/Clips";
      const fallbackDefaultTags =
        typeof result.defaultTags === "string" && result.defaultTags.trim()
          ? result.defaultTags.trim()
          : "web-clip";

      result.vaultProfiles = [
        {
          id: "default-vault",
          name: fallbackVaultName,
          vaultName: fallbackVaultName,
          defaultFolder: fallbackDefaultFolder,
          defaultTags: fallbackDefaultTags,
        },
      ];
      migratedFields.push("vaultProfiles");
    }
    if (typeof result.activeVaultProfileId !== "string" || !result.activeVaultProfileId) {
      result.activeVaultProfileId = "default-vault";
      migratedFields.push("activeVaultProfileId");
    }
    if (!Array.isArray(result.wikiLinkRules)) {
      result.wikiLinkRules = [];
      migratedFields.push("wikiLinkRules");
    }
    if (!Array.isArray(result.wikiLinkNoteIndex)) {
      result.wikiLinkNoteIndex = [];
      migratedFields.push("wikiLinkNoteIndex");
    }
    if (!Array.isArray(result.customTemplates)) {
      result.customTemplates = [];
      migratedFields.push("customTemplates");
    }
    if (!Array.isArray(result.disabledBuiltIns)) {
      result.disabledBuiltIns = [];
      migratedFields.push("disabledBuiltIns");
    }
    if (!Array.isArray(result.domainTagRules)) {
      result.domainTagRules = [];
      migratedFields.push("domainTagRules");
    }
    if (!Array.isArray(result.tagRules)) {
      result.tagRules = [];
      migratedFields.push("tagRules");
    }

    // Ensure nested objects exist
    if (typeof result.obsidianCli !== "object" || result.obsidianCli === null) {
      result.obsidianCli = { cliPath: "", vault: "", enabled: false };
      migratedFields.push("obsidianCli");
    }
    if (typeof result.titleTemplates !== "object" || result.titleTemplates === null) {
      result.titleTemplates = { enabled: false, selectedTemplate: "default", customTemplates: [] };
      migratedFields.push("titleTemplates");
    }

    // Set version to 1
    result.settingsVersion = 1;
  }

  // Future migrations would go here:
  // if (version < 2) { ... }

  return {
    settings: result as PartialSettingsZod,
    migrated: true,
    fromVersion: version,
    toVersion: CURRENT_SETTINGS_VERSION,
    migratedFields,
  };
}

// ============================================================================
// Validation utilities
// ============================================================================

/**
 * Result of settings validation.
 */
export interface ValidationResult {
  /** Whether validation passed */
  success: boolean;
  /** Validated settings (with defaults applied) */
  settings: SettingsZod;
  /** Validation errors if any */
  errors: z.ZodError["errors"];
  /** Fields that failed validation and were reset to defaults */
  resetFields: string[];
}

/**
 * Validates settings and applies defaults for invalid fields.
 * 
 * @param settings - Partial settings to validate
 * @returns Validation result with valid settings and any errors
 */
export function validateSettingsWithDefaults(
  settings: Record<string, unknown>
): ValidationResult {
  const errors: z.ZodError["errors"] = [];
  const resetFields: string[] = [];
  const validated: Record<string, unknown> = {};

  // Validate each field individually to allow partial success
  const schema = SettingsSchema.shape;
  
  for (const [key, parser] of Object.entries(schema)) {
    if (key in settings) {
      const result = (parser as z.ZodTypeAny).safeParse(settings[key]);
      if (result.success) {
        validated[key] = result.data;
      } else {
        // Field failed validation, use default
        errors.push(...result.error.errors);
        resetFields.push(key);
        // Get default value
        const defaultResult = (parser as z.ZodTypeAny).safeParse(undefined);
        if (defaultResult.success) {
          validated[key] = defaultResult.data;
        }
      }
    }
    // If key not in settings, the default will be applied when we parse the full object
  }

  // Now parse the full object to apply remaining defaults
  const fullResult = SettingsSchema.safeParse(validated);
  
  if (fullResult.success) {
    return {
      success: resetFields.length === 0,
      settings: fullResult.data,
      errors,
      resetFields,
    };
  }

  // This shouldn't happen if we handled all fields above, but just in case
  return {
    success: false,
    settings: SettingsSchema.parse({}), // All defaults
    errors: [...errors, ...fullResult.error.errors],
    resetFields,
  };
}

/**
 * Validates a single settings field.
 * 
 * @param key - Settings key
 * @param value - Value to validate
 * @returns True if valid, false otherwise
 */
export function validateSettingsField(
  key: string,
  value: unknown
): boolean {
  const schema = SettingsSchema.shape;
  if (!(key in schema)) {
    return false;
  }
  const result = (schema[key as keyof typeof schema] as z.ZodTypeAny).safeParse(value);
  return result.success;
}

/**
 * Gets the default value for a settings field.
 * 
 * @param key - Settings key
 * @returns Default value for the field
 */
export function getSettingsFieldDefault(key: string): unknown {
  const schema = SettingsSchema.shape;
  if (!(key in schema)) {
    return undefined;
  }
  const result = (schema[key as keyof typeof schema] as z.ZodTypeAny).safeParse(undefined);
  return result.success ? result.data : undefined;
}

// ============================================================================
// Export default settings from schema
// ============================================================================

/**
 * Default settings derived from the Zod schema.
 * This ensures defaults are always in sync with the schema.
 */
export const DEFAULT_SETTINGS_FROM_SCHEMA: SettingsZod = SettingsSchema.parse({});
