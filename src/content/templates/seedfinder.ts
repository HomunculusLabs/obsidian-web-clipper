/**
 * SeedFinder site template for extracting cannabis strain profile pages.
 *
 * Focused on URLs like:
 * - https://en.seedfinder.eu/strain-info/.../
 *
 * Goal: capture the main strain profile content while removing common
 * navigation, ads, social widgets, and footer noise.
 */

import type { SiteTemplate } from "../../shared/templates";
import { registerBuiltInTemplate } from "./registry";

/**
 * SeedFinder template for strain profile pages.
 */
export const seedFinderTemplate: SiteTemplate = {
  domain: "seedfinder.eu",
  name: "SeedFinder",
  description: "Extract SeedFinder strain profile pages (/strain-info/...)",
  enabled: true,
  priority: 120,
  urlPattern: "^/strain-info/",
  selectors: {
    // Strain page title/headline
    title: "h1[itemprop='name'], #content h1, .sorte_name h1, .strain-title",

    // Main strain profile content area
    content:
      "#content .sorte_info, #content .strain_info, #content .strain-profile, #content article, main #content, #content",

    // Breeder / author-ish attribution
    author:
      "#content a[href*='/breeder/'], #content .sorte_zuechter a, #content .breeder a",

    // Last update / published timestamp when present
    date: "#content time[datetime], #content .lastupdate, #content .date",

    // Tag-like links for strain family/category metadata
    tags:
      "#content .tags a, #content a[href*='/strain-info/'], #content a[href*='/strainfinder/']"
  },
  removeSelectors: [
    // Global chrome and navigation
    "header",
    "nav",
    "footer",
    "#header",
    "#navigation",
    "#footer",
    ".menu",
    ".breadcrumbs",
    ".breadcrumb",

    // Sidebar/secondary blocks and related content
    ".sidebar",
    ".related",
    ".related-strains",

    // Utility/noise blocks
    ".share",
    ".social",
    ".comments",
    "#comments",
    ".noprint",
    ".cookie",

    // Ad/embedded noise
    ".ad",
    ".ads",
    "[id^='ad_']",
    "[class*=' ad-']",
    "iframe",

    // Non-content tags
    "script",
    "style",
    "noscript"
  ],
  frontmatterExtras: {
    site: "seedfinder",
    content_type: "strain-profile"
  }
};

registerBuiltInTemplate(seedFinderTemplate);
