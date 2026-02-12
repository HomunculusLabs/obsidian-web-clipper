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
import "./stackoverflow";
import "./github";
import "./wikipedia";
import "./medium";
import "./substack";
import "./arxiv";
import "./docs";

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
