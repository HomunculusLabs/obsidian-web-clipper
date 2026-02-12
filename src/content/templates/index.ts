/**
 * Site-specific templates module.
 * 
 * Re-exports from registry.ts for convenience.
 * Individual template files (reddit.ts, hackernews.ts, etc.) register
 * themselves on import via side effects.
 */

// Import built-in templates to trigger registration
import "./reddit";
import "./hackernews";

export {
  // Template registration
  registerBuiltInTemplate,
  registerBuiltInTemplates,
  getBuiltInTemplates,
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
} from "./registry";

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
