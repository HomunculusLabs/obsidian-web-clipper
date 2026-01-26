import TurndownService from "turndown";
// @ts-expect-error - no types available for turndown-plugin-gfm
import { tables as gfmTables } from "turndown-plugin-gfm";

import type { Settings } from "../../shared/settings";

/**
 * Check if a table has complex structure that GFM can't represent
 */
function isComplexTable(table: HTMLElement): boolean {
  // GFM tables cannot represent colspan/rowspan reliably
  if (table.querySelector("[colspan], [rowspan]")) return true;

  // Nested tables are almost always "complex" for markdown conversion
  if (table.querySelector("table")) return true;

  return false;
}

/**
 * Normalize common language aliases to standard names
 */
function normalizeLanguageToken(raw: string): string {
  const lang = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    sh: "bash",
    shell: "bash",
    yml: "yaml",
    rb: "ruby",
    rs: "rust",
    kt: "kotlin",
    cs: "csharp",
    cpp: "c++",
    objc: "objective-c",
    md: "markdown"
  };
  return map[lang] ?? lang;
}

/**
 * Detect language from class names like "language-javascript" or "lang-python"
 */
function detectLanguageFromClasses(el: Element | null): string | undefined {
  if (!el) return undefined;

  const classNames = (el.getAttribute("class") || "")
    .split(/\s+/)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const c of classNames) {
    // Match patterns like: language-js, lang-python, highlight-typescript
    const m =
      /^language-([a-z0-9_+-]+)$/i.exec(c) ||
      /^lang-([a-z0-9_+-]+)$/i.exec(c) ||
      /^highlight-([a-z0-9_+-]+)$/i.exec(c);
    if (m?.[1]) return normalizeLanguageToken(m[1]);

    // Some sites use just the language name as a class
    const knownLangs = [
      "javascript", "typescript", "python", "ruby", "rust", "go", "java",
      "kotlin", "swift", "bash", "shell", "sql", "json", "yaml", "xml",
      "html", "css", "scss", "markdown", "c", "cpp", "csharp"
    ];
    if (knownLangs.includes(c.toLowerCase())) {
      return normalizeLanguageToken(c);
    }
  }

  return undefined;
}

/**
 * Heuristic language detection based on code content
 */
function detectLanguageHeuristic(code: string): string | undefined {
  const s = code.trim();
  if (!s) return undefined;

  // JSON - starts with { or [ and is valid JSON
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try {
      JSON.parse(s);
      return "json";
    } catch {
      // Not valid JSON
    }
  }

  // XML/HTML - contains tags
  if (/<[a-z][\s\S]*>/i.test(s) && /<\/[a-z]+>/i.test(s)) {
    if (/<html|<head|<body|<div|<span|<p\b/i.test(s)) return "html";
    return "xml";
  }

  // CSS - selector { ... } pattern
  if (/^\s*([.#@]?[a-z0-9_-]+)\s*\{[\s\S]*\}\s*$/im.test(s)) return "css";

  // Shell - shebang or common commands
  if (/^#!.*(?:bash|sh|zsh)/.test(s)) return "bash";
  if (/^\s*(?:cd|ls|cat|curl|wget|git|npm|yarn|pnpm|bun|docker|kubectl)\s/m.test(s)) return "bash";

  // Python - def/class/import patterns
  if (/^\s*(?:def|class)\s+\w+.*:/m.test(s)) return "python";
  if (/^\s*(?:import|from)\s+\w+/m.test(s) && !/\b(?:require|import)\s*\(/m.test(s)) return "python";

  // SQL - common keywords
  if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)\b/im.test(s)) return "sql";

  // YAML - key: value patterns or document separators
  if (/^---\s*$/m.test(s) || /^\s*[\w-]+\s*:\s*(?:\S|$)/m.test(s)) {
    // Avoid false positives with JS objects
    if (!/[{};]/.test(s)) return "yaml";
  }

  // JavaScript/TypeScript - common patterns
  if (/\b(?:const|let|var|function|=>|async|await|export|import)\b/.test(s)) {
    // Check for TypeScript-specific syntax
    if (/:\s*(?:string|number|boolean|any|void|never)\b/.test(s)) return "typescript";
    if (/(?:interface|type)\s+\w+/.test(s)) return "typescript";
    return "javascript";
  }

  // Go
  if (/^\s*(?:package|func|import)\s+\w+/m.test(s)) return "go";

  // Rust
  if (/^\s*(?:fn|let\s+mut|impl|struct|enum|pub\s+fn)\s+/m.test(s)) return "rust";

  // Java/Kotlin
  if (/^\s*(?:public|private|protected)\s+(?:class|interface|void|static)/m.test(s)) return "java";

  return undefined;
}

/**
 * Pick the right backtick fence length to avoid conflicts with code content
 */
function pickBacktickFence(code: string): string {
  const matches = code.match(/`+/g);
  const longest = matches ? Math.max(...matches.map((m) => m.length)) : 0;
  const fenceLen = Math.max(3, longest + 1);
  return "`".repeat(fenceLen);
}

/**
 * Create a configured TurndownService based on settings
 */
export function createTurndownService(settings: Settings): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_"
  });

  // --- Table handling ---
  if (settings.tableHandling === "gfm") {
    // Use GFM tables plugin for simple tables
    service.use(gfmTables);

    // Fallback complex tables to HTML (GFM can't express colspan/rowspan)
    service.addRule("complex-tables-fallback", {
      filter: (node) =>
        node instanceof HTMLElement &&
        node.tagName === "TABLE" &&
        isComplexTable(node),
      replacement: (_content, node) => {
        const table = node as HTMLElement;
        return `\n\n${table.outerHTML}\n\n`;
      }
    });
  } else if (settings.tableHandling === "html") {
    // Keep all tables as HTML
    service.addRule("tables-as-html", {
      filter: (node) => node instanceof HTMLElement && node.tagName === "TABLE",
      replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML}\n\n`
    });
  } else if (settings.tableHandling === "remove") {
    // Strip all tables
    service.addRule("remove-tables", {
      filter: (node) => node instanceof HTMLElement && node.tagName === "TABLE",
      replacement: () => ""
    });
  }

  // --- Code block language detection ---
  if (settings.codeBlockLanguageMode !== "off") {
    service.addRule("fenced-codeblocks-with-language", {
      filter: (node) => node instanceof HTMLElement && node.tagName === "PRE",
      replacement: (_content, node) => {
        const pre = node as HTMLElement;
        const codeEl = pre.querySelector("code");
        const codeText = (codeEl?.textContent ?? pre.textContent ?? "").replace(/\n+$/, "");

        // Try to detect language from class names first
        const classLang =
          detectLanguageFromClasses(codeEl) ?? detectLanguageFromClasses(pre);

        // Apply heuristics if enabled and no class-based language found
        const lang =
          settings.codeBlockLanguageMode === "class-only"
            ? classLang
            : classLang ?? detectLanguageHeuristic(codeText);

        const fence = pickBacktickFence(codeText);
        const info = lang ? `${fence}${normalizeLanguageToken(lang)}` : fence;

        return `\n\n${info}\n${codeText}\n${fence}\n\n`;
      }
    });
  }

  // --- Strikethrough support ---
  service.addRule("strikethrough", {
    filter: (node: HTMLElement) => ["DEL", "S", "STRIKE"].includes(node.tagName),
    replacement: (content: string) => `~~${content}~~`
  });

  // --- Image handling with alt text and title ---
  service.addRule("images", {
    filter: "img",
    replacement: (_content: string, node: HTMLElement) => {
      const img = node as HTMLImageElement;
      const alt = img.alt || "";
      const src = img.src || "";
      const title = img.title || "";
      return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
    }
  });

  return service;
}

// Legacy export for backward compatibility (uses defaults)
// TODO: Remove once all call sites are updated
import { DEFAULT_SETTINGS } from "../../shared/settings";
export const turndownService = createTurndownService(DEFAULT_SETTINGS);
