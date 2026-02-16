/**
 * Site-specific templates module.
 * 
 * Re-exports from registry.ts for convenience.
 * Individual template files (reddit.ts, hackernews.ts, etc.) register
 * themselves on import via side effects.
 * 
 * Provides utilities for loading built-in templates with settings-based
 * enable/disable status.
 */

import type { Settings } from "../../shared/settings";
import type { SiteTemplate } from "../../shared/templates";

// Import built-in templates to trigger registration
import "./reddit";
import "./hackernews";
import "./stackoverflow";
import "./github";
import "./wikipedia";
import "./medium";
import "./substack";
import "./arxiv";
import "./docs";
import "./amazon";
import "./recipe";
import "./twitter"; // Twitter/X - uses dedicated extractor

import {
  getBuiltInTemplates as getRawBuiltInTemplates,
  registerBuiltInTemplate,
  registerBuiltInTemplates,
  clearBuiltInTemplates,
  getTemplateForUrl,
  getAllMatchingTemplates,
  globToRegex,
  matchDomain,
  matchUrlPattern,
  type GetTemplateOptions
} from "./registry";

export {
  // Template registration
  registerBuiltInTemplate,
  registerBuiltInTemplates,
  clearBuiltInTemplates,
  
  // Template matching
  getTemplateForUrl,
  getAllMatchingTemplates,
  
  // Pattern matching utilities (exported for testing)
  globToRegex,
  matchDomain,
  matchUrlPattern,
  
  // Types
  type GetTemplateOptions
};

/**
 * Built-in template with effective enabled status based on settings.
 */
export interface BuiltInTemplateWithStatus extends SiteTemplate {
  /** Whether this template is effectively enabled (not in disabledBuiltIns and enabled=true) */
  isEnabled: boolean;
  /** Whether this template was disabled via settings (not just by default) */
  isDisabledByUser: boolean;
}

/**
 * Get all built-in templates with their effective enabled status based on settings.
 * 
 * This is the recommended way to display built-in templates in the options UI,
 * as it accounts for user preferences stored in settings.
 * 
 * @param settings - Optional current settings object (defaults to all built-ins enabled)
 * @returns Array of built-in templates with their enabled status
 */
export function getBuiltInTemplates(settings?: Settings): BuiltInTemplateWithStatus[] {
  const rawTemplates = getRawBuiltInTemplates();
  const disabledBuiltIns = settings?.disabledBuiltIns || [];
  
  return rawTemplates.map((template) => {
    const isDisabledByUser = disabledBuiltIns.includes(template.domain);
    const isEnabled = template.enabled && !isDisabledByUser;
    
    return {
      ...template,
      isEnabled,
      isDisabledByUser
    };
  });
}

/**
 * Check if a specific built-in template is enabled based on settings.
 * 
 * @param domain - The domain pattern of the built-in template
 * @param settings - The current settings object
 * @returns True if the template is enabled, false otherwise
 */
export function isBuiltInTemplateEnabled(domain: string, settings: Settings): boolean {
  const disabledBuiltIns = settings.disabledBuiltIns || [];
  const rawTemplates = getRawBuiltInTemplates();
  const template = rawTemplates.find((t) => t.domain === domain);
  
  if (!template) {
    return false; // Template doesn't exist
  }
  
  return template.enabled && !disabledBuiltIns.includes(domain);
}

/**
 * Toggle a built-in template's enabled status in settings.
 * 
 * This modifies the settings object's disabledBuiltIns array in place.
 * Callers should save settings after calling this function.
 * 
 * @param domain - The domain pattern of the built-in template
 * @param enabled - Whether to enable or disable the template
 * @param settings - The current settings object (will be modified)
 * @returns True if the change was made, false if template not found
 */
export function setBuiltInTemplateEnabled(
  domain: string,
  enabled: boolean,
  settings: Settings
): boolean {
  const rawTemplates = getRawBuiltInTemplates();
  const template = rawTemplates.find((t) => t.domain === domain);
  
  if (!template) {
    return false; // Template doesn't exist
  }
  
  // Ensure disabledBuiltIns array exists
  if (!settings.disabledBuiltIns) {
    settings.disabledBuiltIns = [];
  }
  
  const disabledBuiltIns = settings.disabledBuiltIns;
  const index = disabledBuiltIns.indexOf(domain);
  
  if (enabled) {
    // Enable: remove from disabledBuiltIns if present
    if (index !== -1) {
      disabledBuiltIns.splice(index, 1);
    }
  } else {
    // Disable: add to disabledBuiltIns if not present
    if (index === -1) {
      disabledBuiltIns.push(domain);
    }
  }
  
  return true;
}

/**
 * Get a summary of built-in templates for display purposes.
 * 
 * @param settings - The current settings object
 * @returns Object with counts and grouped templates
 */
export function getBuiltInTemplatesSummary(settings: Settings): {
  total: number;
  enabled: number;
  disabled: number;
  byCategory: Record<string, BuiltInTemplateWithStatus[]>;
} {
  const templates = getBuiltInTemplates(settings);
  
  let enabled = 0;
  let disabled = 0;
  const byCategory: Record<string, BuiltInTemplateWithStatus[]> = {};
  
  for (const template of templates) {
    if (template.isEnabled) {
      enabled++;
    } else {
      disabled++;
    }
    
    // Group by site type (extract from name or use "Other")
    const category = template.frontmatterExtras?.site || "Other";
    if (!byCategory[category]) {
      byCategory[category] = [];
    }
    byCategory[category].push(template);
  }
  
  return {
    total: templates.length,
    enabled,
    disabled,
    byCategory
  };
}

// Re-export individual templates for testing/direct use
export {
  redditOldTemplate,
  redditNewTemplate,
  redditTemplate,
  extractSubreddit,
  extractOldRedditScore,
  extractNewRedditScore,
  parseScore,
  extractOldRedditComments,
  extractNewRedditComments,
  detectRedditInterface,
  formatComments
} from "./reddit";

export {
  hackerNewsItemTemplate,
  hackerNewsListingTemplate,
  extractStoryId,
  isItemPage,
  extractPoints,
  extractStoryUrl,
  extractStoryText,
  extractCommentCount,
  extractComments as extractHackerNewsComments,
  formatComments as formatHackerNewsComments,
  extractHackerNewsStory,
  isSelfPost,
  extractStoriesFromListing,
  formatStoriesListing
} from "./hackernews";

export {
  stackOverflowTemplate,
  stackExchangeTemplate,
  serverFaultTemplate,
  superUserTemplate,
  askUbuntuTemplate,
  extractQuestionId,
  extractVoteCount,
  extractCodeLanguage,
  enhanceCodeBlocks,
  isAcceptedAnswer,
  extractQuestionBody,
  extractQuestionTags,
  extractAnswers,
  formatStackOverflowContent,
  extractStackOverflowQuestion
} from "./stackoverflow";

export {
  githubRepoTemplate,
  githubIssueTemplate,
  githubPRTemplate,
  githubCodeTemplate,
  githubGistTemplate,
  extractRepoInfo,
  extractIssueOrPRNumber,
  detectGitHubPageType,
  type GitHubPageType,
  extractRepoStats,
  extractIssueMetadata,
  extractCodeLanguages,
  formatGitHubContent
} from "./github";

export {
  wikipediaTemplate,
  englishWikipediaTemplate,
  extractArticleTitle,
  extractLanguage,
  extractShortDescription,
  extractInfobox,
  extractCategories,
  extractLeadSection,
  extractLastModified,
  isDisambiguationPage,
  extractDisambiguationEntries,
  cleanWikipediaContent,
  formatWikipediaContent,
  formatDisambiguationPage
} from "./wikipedia";

export {
  mediumTemplate,
  mediumMainTemplate,
  extractAuthorHandle,
  extractPublicationName,
  extractReadingTime,
  extractClapCount,
  isMemberOnly,
  extractPaywallPreview,
  extractMediumTags,
  extractCanonicalUrl,
  extractMediumArticle,
  formatMediumContent
} from "./medium";

export {
  substackTemplate,
  substackMainTemplate,
  isSubstackPage,
  extractPublicationName as extractSubstackPublicationName,
  extractAuthorHandle as extractSubstackAuthorHandle,
  isPaidContent,
  extractPaywallPreview as extractSubstackPaywallPreview,
  extractLikeCount,
  extractCommentCount as extractSubstackCommentCount,
  extractSubstackTags,
  extractCanonicalUrl as extractSubstackCanonicalUrl,
  extractPostId,
  isFreePost,
  extractSubstackNewsletter,
  formatSubstackContent
} from "./substack";

export {
  arxivTemplate,
  ar5ivTemplate,
  extractArxivId,
  extractVersion,
  buildArxivUrl,
  buildPdfUrl,
  buildAr5ivUrl,
  extractTitle as extractArxivTitle,
  extractAuthors as extractArxivAuthors,
  extractAbstract,
  extractSubmissionDate,
  extractSubjects,
  extractAcmCategories,
  extractComments,
  extractJournalRef,
  extractDoi,
  extractArxivPaper,
  generateBibtex,
  generateCitation,
  formatArxivContent,
  type ArxivPaper
} from "./arxiv";

export {
  mdnTemplate,
  reactDocsTemplate,
  typeScriptDocsTemplate,
  vueDocsTemplate,
  angularDocsTemplate,
  nodejsDocsTemplate,
  nextjsDocsTemplate,
  tailwindDocsTemplate,
  svelteDocsTemplate,
  nuxtDocsTemplate,
  extractBreadcrumbs,
  extractDocsNavigationContext,
  countCodeExamples,
  extractCodeLanguages as extractDocsCodeLanguages,
  hasInteractiveExamples,
  formatDocsContent,
  generateDocsFilename
} from "./docs";

export {
  amazonTemplate,
  amazonUKTemplate,
  amazonDETemplate,
  amazonCATemplate,
  amazonGenericTemplate,
  extractAsin,
  extractTitle as extractAmazonTitle,
  extractPrice,
  extractListPrice,
  extractRating,
  extractReviewCount,
  extractFeatures,
  extractDescription,
  extractMainImage,
  extractImages,
  extractAvailability,
  extractBrand,
  extractCategory,
  extractAmazonProduct,
  formatAmazonContent,
  generateAmazonFilename,
  type AmazonProduct
} from "./amazon";

export {
  genericRecipeTemplate,
  allRecipesTemplate,
  foodNetworkTemplate,
  seriousEatsTemplate,
  bonAppetitTemplate,
  epicuriousTemplate,
  tastyTemplate,
  bbcGoodFoodTemplate,
  nytCookingTemplate,
  simplyRecipesTemplate,
  kingArthurTemplate,
  RECIPE_SITES,
  parseDuration,
  extractSchemaRecipe,
  extractRecipe,
  formatRecipeContent,
  generateRecipeFilename,
  isRecipeUrl,
  type Recipe,
  type RecipeNutrition
} from "./recipe";

export {
  twitterTemplate,
  xTemplate,
  mobileTwitterTemplate,
  isDedicatedExtractorTemplate,
  isTwitterTemplate
} from "./twitter";
