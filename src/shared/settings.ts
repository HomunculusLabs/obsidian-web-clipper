import type {
  TableHandlingMode,
  CodeBlockLanguageMode,
  ImageHandlingMode
} from "./types";
import type { ObsidianCliConfig, SaveMethod } from "./obsidianCli";
import type { SiteTemplate, TemplateSettings } from "./templates";
import type { DomainTagRule } from "./domainTags";
import type { TitleTemplate, TitleTemplateSettings } from "./titleTemplate";
import type { TagRule } from "./tagRules";

// Wiki-link injection rule: maps a term to a note name
export interface WikiLinkRule {
  term: string;
  note: string;
}

export interface Settings {
  // --- Core settings ---
  vaultName: string;
  defaultFolder: string;
  defaultTags: string;
  includeTimestamps: boolean;
  savedFolders: string[];
  
  // --- Save method settings ---
  saveMethod: SaveMethod;
  obsidianCli: ObsidianCliConfig;

  // --- Metadata settings ---
  includeOGFields: boolean;
  includeTwitterFields: boolean;
  parseJsonLd: boolean;
  includeKeywords: boolean;
  computeReadingStats: boolean;
  preferCanonicalUrl: boolean;

  // --- Wiki-link settings ---
  enableWikiLinks: boolean;
  wikiLinkRules: WikiLinkRule[];
  wikiLinkExistingNotesOnly: boolean;
  wikiLinkNoteIndex: string[]; // List of known note names for "existing only" mode
  wikiLinkCaseSensitive: boolean;
  wikiLinkWholeWord: boolean;
  wikiLinkMaxPerTerm: number;

  // --- Code block settings ---
  codeBlockLanguageMode: CodeBlockLanguageMode;

  // --- Table settings ---
  tableHandling: TableHandlingMode;

  // --- Image settings ---
  imageHandling: ImageHandlingMode;
  imageDownloadEndpoint: string; // For future Obsidian plugin API integration
  imageAttachmentsFolder: string;

  // --- Template settings ---
  templatesEnabled: boolean;
  customTemplates: SiteTemplate[];
  disabledBuiltIns: string[];

  // --- Tag suggestion settings ---
  domainTagRules: DomainTagRule[];
  useDefaultDomainTags: boolean;

  // --- Tag rules engine (Task 66) ---
  tagRules: TagRule[];
  useDefaultTagRules: boolean;

  // --- Title cleanup settings ---
  cleanTitles: boolean; // Whether to clean titles (remove site names, decode entities)
  preferTitleCase: boolean; // Whether to apply title case to cleaned titles

  // --- Title template settings ---
  titleTemplates: TitleTemplateSettings;

  // Index signature for dynamic access
  [key: string]:
    | string
    | boolean
    | string[]
    | number
    | WikiLinkRule[]
    | ObsidianCliConfig
    | SiteTemplate[]
    | DomainTagRule[]
    | TagRule[]
    | TitleTemplateSettings
    | TitleTemplate[]
    | undefined;
}

export const DEFAULT_SETTINGS: Settings = {
  // --- Core settings ---
  vaultName: "Main Vault",
  defaultFolder: "2 - Source Material/Clips",
  defaultTags: "web-clip",
  includeTimestamps: true,
  savedFolders: ["2 - Source Material/Clips"],
  
  // --- Save method settings ---
  saveMethod: "uri",
  obsidianCli: {
    cliPath: "",
    vault: "",
    enabled: false
  },

  // --- Metadata settings ---
  includeOGFields: true,
  includeTwitterFields: false,
  parseJsonLd: true,
  includeKeywords: true,
  computeReadingStats: true,
  preferCanonicalUrl: true,

  // --- Wiki-link settings ---
  enableWikiLinks: false,
  wikiLinkRules: [],
  wikiLinkExistingNotesOnly: false,
  wikiLinkNoteIndex: [],
  wikiLinkCaseSensitive: false,
  wikiLinkWholeWord: true,
  wikiLinkMaxPerTerm: 1,

  // --- Code block settings ---
  codeBlockLanguageMode: "class-only",

  // --- Table settings ---
  tableHandling: "gfm",

  // --- Image settings ---
  imageHandling: "keep",
  imageDownloadEndpoint: "",
  imageAttachmentsFolder: "attachments",

  // --- Template settings ---
  templatesEnabled: true,
  customTemplates: [],
  disabledBuiltIns: [],

  // --- Tag suggestion settings ---
  domainTagRules: [], // Custom rules; combined with defaults if useDefaultDomainTags is true
  useDefaultDomainTags: true,

  // --- Tag rules engine (Task 66) ---
  tagRules: [], // Custom tag rules; combined with defaults if useDefaultTagRules is true
  useDefaultTagRules: true,

  // --- Title cleanup settings ---
  cleanTitles: true, // Clean titles by default
  preferTitleCase: true, // Apply title case by default

  // --- Title template settings ---
  titleTemplates: {
    enabled: false,
    selectedTemplate: "default",
    customTemplates: []
  }
};

export const SETTINGS_KEYS = [
  // Core
  "vaultName",
  "defaultFolder",
  "defaultTags",
  "includeTimestamps",
  "savedFolders",
  // Save method
  "saveMethod",
  "obsidianCli",
  // Metadata
  "includeOGFields",
  "includeTwitterFields",
  "parseJsonLd",
  "includeKeywords",
  "computeReadingStats",
  "preferCanonicalUrl",
  // Wiki-links
  "enableWikiLinks",
  "wikiLinkRules",
  "wikiLinkExistingNotesOnly",
  "wikiLinkNoteIndex",
  "wikiLinkCaseSensitive",
  "wikiLinkWholeWord",
  "wikiLinkMaxPerTerm",
  // Code blocks
  "codeBlockLanguageMode",
  // Tables
  "tableHandling",
  // Images
  "imageHandling",
  "imageDownloadEndpoint",
  "imageAttachmentsFolder",
  // Templates
  "templatesEnabled",
  "customTemplates",
  "disabledBuiltIns",
  // Tag suggestions
  "domainTagRules",
  "useDefaultDomainTags",
  // Tag rules engine
  "tagRules",
  "useDefaultTagRules",
  // Title cleanup
  "cleanTitles",
  "preferTitleCase",
  // Title templates
  "titleTemplates"
] as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[number];

// Valid values for enum settings (used for validation during load)
export const VALID_TABLE_HANDLING: TableHandlingMode[] = ["gfm", "html", "remove"];
export const VALID_CODE_BLOCK_LANGUAGE: CodeBlockLanguageMode[] = [
  "off",
  "class-only",
  "class-heuristic"
];
export const VALID_IMAGE_HANDLING: ImageHandlingMode[] = [
  "keep",
  "remove",
  "data-uri",
  "download-api"
];