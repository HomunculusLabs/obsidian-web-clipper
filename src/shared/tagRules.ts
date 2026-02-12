/**
 * Tag Rules Engine - User-configurable rules for automatic tag suggestions.
 * Implements Task 66 - Tag rules engine.
 * 
 * Rules can match against various conditions (domain, title, content, etc.)
 * and automatically suggest tags when conditions are met.
 */

import type { ClipMetadata } from "./types";
import { detectCategories as detectCategoriesImpl } from "./categoryDetection";

/**
 * Condition types for tag rules.
 */
export type TagRuleConditionType =
  | "domain-contains"      // URL domain contains text
  | "url-contains"         // Full URL contains text
  | "title-contains"       // Page title contains text
  | "content-contains"     // Markdown content contains text
  | "keywords-contain"     // Meta keywords contain text
  | "category-is"          // Detected category matches
  | "author-contains"      // Author field contains text
  | "site-name-contains";  // Site name contains text

/**
 * A single condition in a tag rule.
 */
export interface TagRuleCondition {
  /** Type of condition to check */
  type: TagRuleConditionType;
  /** Value to match against (case-insensitive for most types) */
  value: string;
  /** Whether to invert the match (NOT condition) */
  invert?: boolean;
}

/**
 * A user-configurable tag rule.
 */
export interface TagRule {
  /** Unique identifier for the rule */
  id: string;
  /** Human-readable name for the rule */
  name: string;
  /** Condition(s) that must be met */
  condition: TagRuleCondition;
  /** Tags to add when the condition matches */
  tags: string[];
  /** Whether this rule is enabled */
  enabled: boolean;
  /** Rule priority (higher = checked first, default: 0) */
  priority?: number;
}

/**
 * Result of evaluating a tag rule.
 */
export interface TagRuleMatch {
  rule: TagRule;
  matchedTags: string[];
}

/**
 * Default tag rules providing common use cases.
 */
export const DEFAULT_TAG_RULES: TagRule[] = [
  {
    id: "github-code",
    name: "GitHub → code tag",
    condition: { type: "domain-contains", value: "github.com" },
    tags: ["code"],
    enabled: true,
    priority: 10,
  },
  {
    id: "tutorial-learning",
    name: "Tutorial → learning tag",
    condition: { type: "title-contains", value: "tutorial" },
    tags: ["learning", "tutorial"],
    enabled: true,
    priority: 5,
  },
  {
    id: "guide-learning",
    name: "Guide → learning tag",
    condition: { type: "title-contains", value: "guide" },
    tags: ["learning", "guide"],
    enabled: true,
    priority: 5,
  },
  {
    id: "howto-learning",
    name: "How-to → learning tag",
    condition: { type: "title-contains", value: "how to" },
    tags: ["learning", "howto"],
    enabled: true,
    priority: 5,
  },
  {
    id: "documentation-reference",
    name: "Documentation → reference tag",
    condition: { type: "title-contains", value: "documentation" },
    tags: ["reference", "docs"],
    enabled: true,
    priority: 5,
  },
  {
    id: "api-reference",
    name: "API → reference tag",
    condition: { type: "title-contains", value: "api" },
    tags: ["reference", "api"],
    enabled: true,
    priority: 5,
  },
  {
    id: "video-content",
    name: "Video content tag",
    condition: { type: "category-is", value: "video" },
    tags: ["video"],
    enabled: true,
    priority: 8,
  },
  {
    id: "research-content",
    name: "Research content tag",
    condition: { type: "category-is", value: "research" },
    tags: ["research"],
    enabled: true,
    priority: 8,
  },
  {
    id: "news-content",
    name: "News content tag",
    condition: { type: "category-is", value: "news" },
    tags: ["news"],
    enabled: true,
    priority: 8,
  },
  {
    id: "recipe-content",
    name: "Recipe content tag",
    condition: { type: "category-is", value: "recipe" },
    tags: ["recipe"],
    enabled: true,
    priority: 8,
  },
];

/**
 * Evaluates a single condition against metadata and content.
 * 
 * @param condition - The condition to evaluate
 * @param metadata - Clip metadata
 * @param content - Markdown content
 * @returns True if the condition matches
 */
export function evaluateCondition(
  condition: TagRuleCondition,
  metadata: ClipMetadata,
  content: string
): boolean {
  let matches = false;

  switch (condition.type) {
    case "domain-contains": {
      try {
        const url = new URL(metadata.url);
        matches = url.hostname.toLowerCase().includes(condition.value.toLowerCase());
      } catch {
        matches = false;
      }
      break;
    }

    case "url-contains": {
      matches = metadata.url.toLowerCase().includes(condition.value.toLowerCase());
      break;
    }

    case "title-contains": {
      matches = metadata.title.toLowerCase().includes(condition.value.toLowerCase());
      break;
    }

    case "content-contains": {
      matches = content.toLowerCase().includes(condition.value.toLowerCase());
      break;
    }

    case "keywords-contain": {
      const keywords = metadata.keywords ?? [];
      matches = keywords.some(k => k.toLowerCase().includes(condition.value.toLowerCase()));
      break;
    }

    case "category-is": {
      // Detect categories and check if the specified category is detected
      const detectedCategories = detectCategoriesImpl(metadata, content);
      matches = detectedCategories.some(
        c => c.category.toLowerCase() === condition.value.toLowerCase()
      );
      break;
    }

    case "author-contains": {
      const author = metadata.author ?? "";
      matches = author.toLowerCase().includes(condition.value.toLowerCase());
      break;
    }

    case "site-name-contains": {
      const siteName = metadata.siteName ?? "";
      matches = siteName.toLowerCase().includes(condition.value.toLowerCase());
      break;
    }

    default:
      matches = false;
  }

  // Apply inversion if specified
  return condition.invert ? !matches : matches;
}

/**
 * Evaluates all tag rules against metadata and content.
 * Rules are processed in priority order (highest first).
 * 
 * @param rules - Tag rules to evaluate
 * @param metadata - Clip metadata
 * @param content - Markdown content
 * @returns Array of matched rules with their suggested tags
 */
export function evaluateTagRules(
  rules: TagRule[],
  metadata: ClipMetadata,
  content: string
): TagRuleMatch[] {
  const matches: TagRuleMatch[] = [];

  // Sort rules by priority (highest first)
  const sortedRules = [...rules]
    .filter(r => r.enabled)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of sortedRules) {
    if (evaluateCondition(rule.condition, metadata, content)) {
      matches.push({
        rule,
        matchedTags: rule.tags,
      });
    }
  }

  return matches;
}

/**
 * Extracts suggested tags from rule matches.
 * Deduplicates tags while preserving order.
 * 
 * @param matches - Rule matches from evaluateTagRules
 * @returns Array of unique suggested tags
 */
export function extractTagsFromMatches(matches: TagRuleMatch[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const match of matches) {
    for (const tag of match.matchedTags) {
      const normalized = tag.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        tags.push(tag);
      }
    }
  }

  return tags;
}

/**
 * Convenience function to get tag suggestions from rules.
 * Combines evaluateTagRules and extractTagsFromMatches.
 * 
 * @param rules - Tag rules to evaluate
 * @param metadata - Clip metadata
 * @param content - Markdown content
 * @returns Array of suggested tags with confidence scores
 */
export function suggestTagsFromRules(
  rules: TagRule[],
  metadata: ClipMetadata,
  content: string
): Array<{ tag: string; confidence: number; source: "rule" }> {
  const matches = evaluateTagRules(rules, metadata, content);
  
  // Assign confidence based on rule priority (higher priority = higher confidence)
  return matches.flatMap(match => {
    const priority = match.rule.priority ?? 0;
    // Map priority to confidence: 0-10 maps to 0.6-0.9
    const confidence = Math.min(0.9, Math.max(0.6, 0.6 + (priority / 10) * 0.3));
    
    return match.matchedTags.map(tag => ({
      tag,
      confidence,
      source: "rule" as const,
    }));
  });
}

/**
 * Validates a tag rule.
 * Returns an error message if invalid, or null if valid.
 */
export function validateTagRule(rule: Partial<TagRule>): string | null {
  if (!rule.id || rule.id.trim() === "") {
    return "Rule ID is required";
  }

  if (!rule.name || rule.name.trim() === "") {
    return "Rule name is required";
  }

  if (!rule.condition) {
    return "Condition is required";
  }

  if (!rule.condition.type) {
    return "Condition type is required";
  }

  if (!rule.condition.value || rule.condition.value.trim() === "") {
    return "Condition value is required";
  }

  if (!rule.tags || rule.tags.length === 0) {
    return "At least one tag is required";
  }

  // Validate condition type
  const validTypes: TagRuleConditionType[] = [
    "domain-contains",
    "url-contains",
    "title-contains",
    "content-contains",
    "keywords-contain",
    "category-is",
    "author-contains",
    "site-name-contains",
  ];

  if (!validTypes.includes(rule.condition.type)) {
    return `Invalid condition type: ${rule.condition.type}`;
  }

  return null;
}

/**
 * Generates a unique ID for a new rule.
 */
export function generateRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
