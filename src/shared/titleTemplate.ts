/**
 * Title template system for customizing note titles.
 *
 * Task 64: Title template system
 * - Support placeholders: {title}, {date}, {domain}, {type}, {author}, {year}
 * - Allow users to define custom templates in settings
 * - Provide built-in templates as presets
 */

import type { ClipMetadata, PageType } from "./types";

/**
 * Available placeholders for title templates.
 */
export type TitlePlaceholder =
  | "title"      // The cleaned page title
  | "date"       // Current date (YYYY-MM-DD)
  | "time"       // Current time (HH-mm)
  | "datetime"   // Current date and time (YYYY-MM-DD-HHmm)
  | "domain"     // Website domain (e.g., "github.com")
  | "type"       // Page type (web, youtube, pdf, twitter)
  | "author"     // Author name if available
  | "year"       // Current year (YYYY)
  | "month"      // Current month (MM)
  | "day"        // Current day (DD)
  | "siteName"   // Site name from metadata
  | "tags"       // First tag from the clip
  | "folder";    // Default folder name (last segment)

/**
 * A title template definition.
 */
export interface TitleTemplate {
  /** Unique identifier for the template */
  id: string;
  /** Human-readable name */
  name: string;
  /** The template string with placeholders */
  template: string;
  /** Whether this is a built-in template */
  builtIn?: boolean;
  /** Whether this template is enabled */
  enabled?: boolean;
}

/**
 * Context for rendering a title template.
 */
export interface TitleTemplateContext {
  /** The cleaned title */
  title: string;
  /** Clip metadata */
  metadata: ClipMetadata;
  /** Page type */
  pageType: PageType;
  /** Default folder path */
  folder?: string;
  /** Tags for the clip */
  tags?: string[];
}

/**
 * Built-in title templates available as presets.
 */
export const BUILTIN_TITLE_TEMPLATES: TitleTemplate[] = [
  {
    id: "default",
    name: "Default (Title Only)",
    template: "{title}",
    builtIn: true,
    enabled: true
  },
  {
    id: "date-title",
    name: "Date - Title",
    template: "{date} - {title}",
    builtIn: true,
    enabled: false
  },
  {
    id: "domain-title",
    name: "Domain/Title",
    template: "{domain}/{title}",
    builtIn: true,
    enabled: false
  },
  {
    id: "type-title",
    name: "Type - Title",
    template: "{type} - {title}",
    builtIn: true,
    enabled: false
  },
  {
    id: "author-title",
    name: "Author - Title",
    template: "{author} - {title}",
    builtIn: true,
    enabled: false
  },
  {
    id: "year-month-title",
    name: "Year/Month - Title",
    template: "{year}/{month} - {title}",
    builtIn: true,
    enabled: false
  },
  {
    id: "site-title",
    name: "Site Name - Title",
    template: "{siteName} - {title}",
    builtIn: true,
    enabled: false
  },
  {
    id: "datetime-title",
    name: "DateTime - Title",
    template: "{datetime} - {title}",
    builtIn: true,
    enabled: false
  }
];

/**
 * Gets the default title template.
 */
export function getDefaultTitleTemplate(): TitleTemplate {
  return BUILTIN_TITLE_TEMPLATES[0]!;
}

/**
 * Extracts placeholders from a template string.
 *
 * @param template - The template string
 * @returns Array of placeholder names found in the template
 *
 * @example
 * ```ts
 * extractPlaceholders("{date} - {title}")
 * // ["date", "title"]
 * ```
 */
export function extractPlaceholders(template: string): string[] {
  const regex = /\{(\w+)\}/g;
  const placeholders: string[] = [];
  let match;

  while ((match = regex.exec(template)) !== null) {
    if (match[1] && !placeholders.includes(match[1])) {
      placeholders.push(match[1]);
    }
  }

  return placeholders;
}

/**
 * Validates a title template string.
 *
 * @param template - The template string to validate
 * @returns Object with isValid flag and error message if invalid
 */
export function validateTitleTemplate(template: string): { isValid: boolean; error?: string } {
  if (!template || template.trim() === "") {
    return { isValid: false, error: "Template cannot be empty" };
  }

  // Check for unclosed braces
  const openBraces = (template.match(/\{/g) || []).length;
  const closeBraces = (template.match(/\}/g) || []).length;

  if (openBraces !== closeBraces) {
    return { isValid: false, error: "Unmatched braces in template" };
  }

  // Extract and validate placeholders
  const placeholders = extractPlaceholders(template);
  const validPlaceholders: TitlePlaceholder[] = [
    "title", "date", "time", "datetime", "domain", "type",
    "author", "year", "month", "day", "siteName", "tags", "folder"
  ];

  for (const placeholder of placeholders) {
    if (!validPlaceholders.includes(placeholder as TitlePlaceholder)) {
      return {
        isValid: false,
        error: `Unknown placeholder: {${placeholder}}`
      };
    }
  }

  // Template must contain {title} placeholder
  if (!placeholders.includes("title")) {
    return {
      isValid: false,
      error: "Template must include {title} placeholder"
    };
  }

  return { isValid: true };
}

/**
 * Gets the value for a placeholder from the context.
 */
function getPlaceholderValue(
  placeholder: string,
  context: TitleTemplateContext
): string {
  const now = new Date();

  switch (placeholder) {
    case "title":
      return context.title || "Untitled";

    case "date":
      return formatDate(now);

    case "time":
      return formatTime(now);

    case "datetime":
      return `${formatDate(now)}-${formatTime(now)}`;

    case "year":
      return now.getFullYear().toString();

    case "month":
      return (now.getMonth() + 1).toString().padStart(2, "0");

    case "day":
      return now.getDate().toString().padStart(2, "0");

    case "domain":
      return extractDomain(context.metadata.url);

    case "type":
      return context.pageType || "web";

    case "author":
      return context.metadata.author || "Unknown";

    case "siteName":
      return context.metadata.siteName || extractDomain(context.metadata.url);

    case "tags":
      return context.tags?.[0] || "untagged";

    case "folder":
      return extractFolderName(context.folder);

    default:
      return "";
  }
}

/**
 * Formats a date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats a time as HH-mm.
 */
function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}-${minutes}`;
}

/**
 * Extracts the domain from a URL.
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove www. prefix if present
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

/**
 * Extracts the last folder name from a path.
 */
function extractFolderName(folder?: string): string {
  if (!folder) return "Clips";
  const parts = folder.split("/").filter(Boolean);
  return parts[parts.length - 1] || "Clips";
}

/**
 * Renders a title template with the given context.
 *
 * @param template - The template string with placeholders
 * @param context - The context containing values for placeholders
 * @returns The rendered title
 *
 * @example
 * ```ts
 * renderTitleTemplate("{date} - {title}", {
 *   title: "My Article",
 *   metadata: { url: "https://example.com/article" },
 *   pageType: "web"
 * })
 * // "2024-01-15 - My Article"
 * ```
 */
export function renderTitleTemplate(
  template: string,
  context: TitleTemplateContext
): string {
  let result = template;

  // Get all placeholders in the template
  const placeholders = extractPlaceholders(template);

  // Replace each placeholder with its value
  for (const placeholder of placeholders) {
    const value = getPlaceholderValue(placeholder, context);
    result = result.replace(new RegExp(`\\{${placeholder}\\}`, "g"), value);
  }

  // Clean up any resulting double spaces or slashes
  result = result
    .replace(/\s+/g, " ")
    .replace(/\/+/g, "/")
    .replace(/\s*-\s*-\s*/g, " - ")
    .trim();

  // Clean up leading/trailing separators
  result = result.replace(/^[\s/-]+|[\s/-]+$/g, "");

  return result;
}

/**
 * Title template settings.
 */
export interface TitleTemplateSettings {
  /** Whether title templates are enabled */
  enabled: boolean;
  /** The ID of the selected template (built-in or custom) */
  selectedTemplate: string;
  /** Custom user-defined templates */
  customTemplates: TitleTemplate[];
}

/**
 * Default title template settings.
 */
export const DEFAULT_TITLE_TEMPLATE_SETTINGS: TitleTemplateSettings = {
  enabled: false,
  selectedTemplate: "default",
  customTemplates: []
};

/**
 * Gets a template by ID, checking both built-in and custom templates.
 */
export function getTitleTemplateById(
  id: string,
  customTemplates?: TitleTemplate[]
): TitleTemplate | undefined {
  // Check built-in templates first
  const builtIn = BUILTIN_TITLE_TEMPLATES.find((t) => t.id === id);
  if (builtIn) return builtIn;

  // Check custom templates
  if (customTemplates) {
    return customTemplates.find((t) => t.id === id);
  }

  return undefined;
}

/**
 * Gets all available templates (built-in + custom).
 */
export function getAllTemplates(customTemplates?: TitleTemplate[]): TitleTemplate[] {
  return [...BUILTIN_TITLE_TEMPLATES, ...(customTemplates || [])];
}

/**
 * Applies the selected title template to generate the final title.
 *
 * @param title - The cleaned title
 * @param context - Template context
 * @param settings - Title template settings
 * @returns The rendered title
 */
export function applyTitleTemplate(
  title: string,
  context: Omit<TitleTemplateContext, "title">,
  settings: TitleTemplateSettings
): string {
  // If templates are disabled, just return the title
  if (!settings.enabled) {
    return title;
  }

  // Get the selected template
  const template = getTitleTemplateById(
    settings.selectedTemplate,
    settings.customTemplates
  );

  if (!template) {
    // Fallback to default if selected template not found
    return title;
  }

  // Render the template
  return renderTitleTemplate(template.template, {
    ...context,
    title
  });
}
