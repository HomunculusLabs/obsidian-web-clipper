/**
 * Twitter/X site template.
 *
 * This template integrates Twitter with the site template system while
 * delegating actual extraction to the dedicated Twitter extractor.
 *
 * Twitter/X has complex DOM extraction needs that don't fit the CSS
 * selector-based template model. The dedicated extractor handles:
 * - Thread detection and extraction
 * - Media attachments (images, videos, GIFs)
 * - Poll data and link cards
 * - Engagement statistics
 * - Auth wall detection and fallback APIs
 *
 * This template exists for:
 * - UI consistency (shows "Twitter" template indicator in popup)
 * - Template management (can be enabled/disabled in settings)
 * - Frontmatter metadata defaults
 */

import type { SiteTemplate } from "../../shared/templates";
import { registerBuiltInTemplate } from "./registry";

/**
 * Twitter template for twitter.com domain.
 *
 * Uses `useDedicatedExtractor: true` to signal that the web extractor
 * should skip this template and let the clipper route to the dedicated
 * Twitter extractor.
 */
export const twitterTemplate: SiteTemplate = {
  domain: "twitter.com",
  name: "Twitter",
  description: "Extract tweets and threads from Twitter/X with full metadata support",
  enabled: true,
  priority: 100,
  // No selectors - uses dedicated extractor
  selectors: {},
  frontmatterExtras: {
    site: "twitter",
    extractor: "dedicated"
  }
};

/**
 * Twitter template for x.com domain (rebranded Twitter).
 */
export const xTemplate: SiteTemplate = {
  domain: "x.com",
  name: "X (Twitter)",
  description: "Extract posts and threads from X.com with full metadata support",
  enabled: true,
  priority: 100,
  // No selectors - uses dedicated extractor
  selectors: {},
  frontmatterExtras: {
    site: "twitter",
    extractor: "dedicated"
  }
};

/**
 * Twitter template for mobile.twitter.com domain.
 */
export const mobileTwitterTemplate: SiteTemplate = {
  domain: "mobile.twitter.com",
  name: "Twitter Mobile",
  description: "Extract tweets from mobile.twitter.com",
  enabled: true,
  priority: 100,
  selectors: {},
  frontmatterExtras: {
    site: "twitter",
    extractor: "dedicated"
  }
};

/**
 * Check if a template uses the dedicated Twitter extractor.
 * Used by the web extractor to skip these templates.
 */
export function isDedicatedExtractorTemplate(
  template: SiteTemplate
): boolean {
  return (
    template.frontmatterExtras?.extractor === "dedicated" &&
    template.frontmatterExtras?.site === "twitter"
  );
}

/**
 * Check if a URL is a Twitter/X URL.
 * Matches the same pattern as the pageType detector.
 */
export function isTwitterTemplate(template: SiteTemplate): boolean {
  const twitterDomains = ["twitter.com", "x.com", "mobile.twitter.com"];
  return (
    twitterDomains.includes(template.domain) ||
    template.frontmatterExtras?.site === "twitter"
  );
}

// Register templates
registerBuiltInTemplate(twitterTemplate);
registerBuiltInTemplate(xTemplate);
registerBuiltInTemplate(mobileTwitterTemplate);
