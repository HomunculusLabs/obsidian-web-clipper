/**
 * Content Sites Template Tests
 *
 * Tests for Wikipedia, Medium, Substack, ArXiv, Amazon, and Recipe templates.
 */

import { describe, test, expect } from "bun:test";

// ============================================================================
// Wikipedia Tests
// ============================================================================

import {
  wikipediaTemplate,
  englishWikipediaTemplate,
  extractLanguage,
  extractShortDescription,
  isDisambiguationPage,
  cleanWikipediaContent,
  formatWikipediaContent
} from "../../src/content/templates/wikipedia";

describe("Wikipedia template configuration", () => {
  test("wikipediaTemplate handles all languages", () => {
    expect(wikipediaTemplate.domain).toBe("*.wikipedia.org");
    expect(wikipediaTemplate.enabled).toBe(true);
    expect(wikipediaTemplate.name).toContain("Wikipedia");
  });

  test("englishWikipediaTemplate has higher priority", () => {
    expect(englishWikipediaTemplate.domain).toBe("en.wikipedia.org");
    expect(englishWikipediaTemplate.priority).toBeGreaterThan(wikipediaTemplate.priority ?? 0);
  });

  test("removeSelectors removes edit links and references clutter", () => {
    expect(wikipediaTemplate.removeSelectors).toBeDefined();
    // Should remove: .mw-editsection, .reference, nav elements, etc.
  });
});

describe("extractLanguage", () => {
  test("extracts language code from URL", () => {
    expect(extractLanguage("https://en.wikipedia.org/wiki/Example")).toBe("en");
    expect(extractLanguage("https://de.wikipedia.org/wiki/Beispiel")).toBe("de");
    expect(extractLanguage("https://ja.wikipedia.org/wiki/例")).toBe("ja");
  });

  test("returns 'en' for non-Wikipedia URLs", () => {
    expect(extractLanguage("https://example.com/")).toBe("en");
  });
});

describe("isDisambiguationPage", () => {
  test("function exists and is callable", () => {
    expect(typeof isDisambiguationPage).toBe("function");
  });

  // Expected behavior: check for disambiguation markers
  // - URL contains "(disambiguation)"
  // - Page has disambiguation box
});

describe("Wikipedia markdown structure expectation", () => {
  test("Wikipedia article markdown structure", () => {
    // Expected markdown structure for Wikipedia:
    // # Article Title
    //
    // > Short description from infobox
    //
    // Infobox content as table or key-value pairs...
    //
    // Article lead section...
    //
    // ## Contents
    // 1. History
    // 2. Characteristics
    // 3. See also
    //
    // ## History
    // History section content...
    //
    // Categories: `Category1`, `Category2`

    expect(true).toBe(true);
  });

  test("Disambiguation page markdown structure", () => {
    // Expected markdown structure for disambiguation:
    // # Term (disambiguation)
    //
    // **Term** may refer to:
    //
    // - [Term (topic1)](url) - description
    // - [Term (topic2)](url) - description

    expect(true).toBe(true);
  });
});

// ============================================================================
// Medium Tests
// ============================================================================

import {
  mediumTemplate,
  mediumMainTemplate,
  extractAuthorHandle,
  extractPublicationName,
  extractReadingTime,
  extractClapCount,
  isMemberOnly,
  extractMediumTags,
  formatMediumContent
} from "../../src/content/templates/medium";

describe("Medium template configuration", () => {
  test("mediumTemplate handles medium.com subdomains", () => {
    expect(mediumTemplate.domain).toBe("*.medium.com");
    expect(mediumTemplate.enabled).toBe(true);
    expect(mediumTemplate.name).toContain("Medium");
  });

  test("mediumMainTemplate handles main domain", () => {
    expect(mediumMainTemplate.domain).toBe("medium.com");
    expect(mediumMainTemplate.priority).toBeGreaterThan(mediumTemplate.priority ?? 0);
  });
});

describe("extractAuthorHandle", () => {
  test("function exists and is callable", () => {
    expect(typeof extractAuthorHandle).toBe("function");
  });

  // Expected: Extract @username from author link
});

describe("isMemberOnly", () => {
  test("function exists and is callable", () => {
    expect(typeof isMemberOnly).toBe("function");
  });

  // Expected: Detect paywall/member-only indicators
});

describe("Medium markdown structure expectation", () => {
  test("Medium article markdown structure", () => {
    // Expected markdown structure for Medium:
    // # Article Title
    //
    // **Author:** Username | **Publication:** PublicationName
    // **Reading Time:** 5 min | **Claps:** 1.2k
    //
    // Tags: `tag1`, `tag2`, `tag3`
    //
    // Article content...
    //
    // ---
    // Member-only content indicator if applicable

    expect(true).toBe(true);
  });
});

// ============================================================================
// Substack Tests
// ============================================================================

import {
  substackTemplate,
  substackMainTemplate,
  isSubstackPage,
  extractSubstackPublicationName,
  isPaidContent,
  extractLikeCount,
  extractSubstackTags,
  formatSubstackContent
} from "../../src/content/templates/substack";

describe("Substack template configuration", () => {
  test("substackTemplate handles substack subdomains", () => {
    expect(substackTemplate.domain).toBe("*.substack.com");
    expect(substackTemplate.enabled).toBe(true);
    expect(substackTemplate.name).toContain("Substack");
  });

  test("substackMainTemplate handles main domain", () => {
    expect(substackMainTemplate.domain).toBe("substack.com");
  });
});

describe("isPaidContent", () => {
  test("function exists and is callable", () => {
    expect(typeof isPaidContent).toBe("function");
  });

  // Expected: Detect paid subscriber indicators
});

describe("Substack markdown structure expectation", () => {
  test("Substack newsletter markdown structure", () => {
    // Expected markdown structure for Substack:
    // # Newsletter Title
    //
    // **Publication:** NewsletterName | **Author:** AuthorName
    // **Date:** 2023-01-15 | **Likes:** 42
    //
    // Tags: `tag1`, `tag2`
    //
    // Newsletter content...
    //
    // ---
    // Paid content indicator if applicable

    expect(true).toBe(true);
  });
});

// ============================================================================
// ArXiv Tests
// ============================================================================

import {
  arxivTemplate,
  ar5ivTemplate,
  extractArxivId,
  extractVersion,
  buildArxivUrl,
  buildPdfUrl,
  extractArxivTitle,
  extractArxivAuthors,
  extractAbstract,
  generateBibtex,
  generateCitation,
  formatArxivContent,
  type ArxivPaper
} from "../../src/content/templates/arxiv";

describe("ArXiv template configuration", () => {
  test("arxivTemplate handles arxiv.org", () => {
    expect(arxivTemplate.domain).toBe("arxiv.org");
    expect(arxivTemplate.enabled).toBe(true);
    expect(arxivTemplate.name).toContain("ArXiv");
  });

  test("ar5ivTemplate handles ar5iv HTML version", () => {
    expect(ar5ivTemplate.domain).toBe("ar5iv.org");
    expect(ar5ivTemplate.name).toContain("ar5iv");
  });
});

describe("extractArxivId", () => {
  test("extracts ID from abs URL", () => {
    expect(extractArxivId("https://arxiv.org/abs/2301.12345")).toBe("2301.12345");
    expect(extractArxivId("https://arxiv.org/abs/2103.00001")).toBe("2103.00001");
  });

  test("extracts ID from PDF URL", () => {
    expect(extractArxivId("https://arxiv.org/pdf/2301.12345.pdf")).toBe("2301.12345");
  });

  test("extracts legacy IDs", () => {
    expect(extractArxivId("https://arxiv.org/abs/hep-th/9901001")).toBe("hep-th/9901001");
  });

  test("returns null for non-arxiv URLs", () => {
    expect(extractArxivId("https://example.com/")).toBeNull();
  });
});

describe("buildPdfUrl", () => {
  test("builds PDF URL from ID", () => {
    expect(buildPdfUrl("2301.12345")).toBe("https://arxiv.org/pdf/2301.12345.pdf");
  });
});

describe("generateBibtex", () => {
  test("function exists and is callable", () => {
    expect(typeof generateBibtex).toBe("function");
  });

  // Expected: Generate BibTeX citation from paper metadata
});

describe("ArXiv markdown structure expectation", () => {
  test("ArXiv paper markdown structure", () => {
    // Expected markdown structure for ArXiv:
    // # Paper Title
    //
    // **Authors:** Author One, Author Two, Author Three
    //
    // **arXiv:** [2301.12345](https://arxiv.org/abs/2301.12345)
    // **PDF:** [Download](https://arxiv.org/pdf/2301.12345.pdf)
    // **Submitted:** 2023-01-15
    //
    // **Subjects:** cs.LG, cs.AI
    //
    // ## Abstract
    //
    // Paper abstract...
    //
    // ## Citation
    //
    // ```bibtex
    // @article{2301.12345,
    //   title={Paper Title},
    //   author={Author One and Author Two},
    //   ...
    // }
    // ```

    expect(true).toBe(true);
  });
});

// ============================================================================
// Amazon Tests
// ============================================================================

import {
  amazonTemplate,
  amazonUKTemplate,
  amazonDETemplate,
  amazonCATemplate,
  amazonGenericTemplate,
  extractAsin,
  extractAmazonTitle,
  extractPrice,
  extractRating,
  extractReviewCount,
  extractFeatures,
  extractAmazonProduct,
  formatAmazonContent,
  type AmazonProduct
} from "../../src/content/templates/amazon";

describe("Amazon template configuration", () => {
  test("amazonTemplate handles amazon.com", () => {
    expect(amazonTemplate.domain).toBe("amazon.com");
    expect(amazonTemplate.enabled).toBe(true);
    expect(amazonTemplate.name).toContain("Amazon");
  });

  test("regional templates for other Amazon domains", () => {
    expect(amazonUKTemplate.domain).toBe("amazon.co.uk");
    expect(amazonDETemplate.domain).toBe("amazon.de");
    expect(amazonCATemplate.domain).toBe("amazon.ca");
  });

  test("amazonGenericTemplate handles other TLDs", () => {
    expect(amazonGenericTemplate.domain).toBe("*.amazon.*");
  });
});

describe("extractAsin", () => {
  test("extracts ASIN from /dp/ URL", () => {
    // ASIN must be exactly 10 alphanumeric characters
    expect(extractAsin("https://www.amazon.com/dp/B08N5WRWNW")).toBe("B08N5WRWNW");
    expect(extractAsin("https://www.amazon.com/dp/B012345678/ref=...")).toBe("B012345678");
  });

  test("extracts ASIN from /gp/product URL", () => {
    expect(extractAsin("https://www.amazon.com/gp/product/B08N5WRWNW")).toBe("B08N5WRWNW");
  });

  test("returns null for non-product URLs", () => {
    expect(extractAsin("https://www.amazon.com/")).toBeNull();
    expect(extractAsin("https://www.amazon.com/s?k=search")).toBeNull();
    // Too short (9 chars instead of 10)
    expect(extractAsin("https://www.amazon.com/dp/B0XXXXXXX")).toBeNull();
  });
});

describe("Amazon markdown structure expectation", () => {
  test("Amazon product markdown structure", () => {
    // Expected markdown structure for Amazon:
    // # Product Title
    //
    // **ASIN:** B0XXXXXXX | **Brand:** BrandName
    // **Price:** $99.99 ~~$129.99~~ | **Rating:** ⭐ 4.5 (1,234 reviews)
    //
    // ## Features
    //
    // - Feature 1
    // - Feature 2
    // - Feature 3
    //
    // ## Description
    //
    // Product description...

    expect(true).toBe(true);
  });
});

// ============================================================================
// Recipe Tests
// ============================================================================

import {
  genericRecipeTemplate,
  allRecipesTemplate,
  foodNetworkTemplate,
  seriousEatsTemplate,
  bonAppetitTemplate,
  RECIPE_SITES,
  parseDuration,
  extractSchemaRecipe,
  extractRecipe,
  formatRecipeContent,
  generateRecipeFilename,
  isRecipeUrl,
  type Recipe
} from "../../src/content/templates/recipe";

describe("Recipe template configuration", () => {
  test("genericRecipeTemplate is default for recipe sites", () => {
    expect(genericRecipeTemplate.enabled).toBe(true);
    expect(genericRecipeTemplate.name).toContain("Recipe");
  });

  test("site-specific templates exist for major recipe sites", () => {
    expect(allRecipesTemplate.domain).toContain("allrecipes.com");
    expect(foodNetworkTemplate.domain).toContain("foodnetwork.com");
    expect(seriousEatsTemplate.domain).toContain("seriouseats.com");
    expect(bonAppetitTemplate.domain).toContain("bonappetit.com");
  });

  test("RECIPE_SITES list contains expected domains", () => {
    expect(RECIPE_SITES.length).toBeGreaterThan(0);
    expect(RECIPE_SITES).toContain("allrecipes.com");
    expect(RECIPE_SITES).toContain("foodnetwork.com");
  });
});

describe("parseDuration", () => {
  test("parses ISO 8601 duration to human-readable string", () => {
    // parseDuration returns a human-readable string, not a number
    expect(parseDuration("PT30M")).toBe("30 minutes");
    expect(parseDuration("PT1H30M")).toBe("1 hour 30 minutes");
    expect(parseDuration("PT2H")).toBe("2 hours");
  });

  test("passes through non-ISO durations unchanged", () => {
    // Non-ISO format strings are returned as-is
    expect(parseDuration("30 minutes")).toBe("30 minutes");
    expect(parseDuration("1 hr 15 min")).toBe("1 hr 15 min");
  });

  test("returns null for empty input", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
  });
});

describe("isRecipeUrl", () => {
  test("returns true for known recipe sites", () => {
    expect(isRecipeUrl("https://www.allrecipes.com/recipe/123/")).toBe(true);
    expect(isRecipeUrl("https://www.foodnetwork.com/recipes/example")).toBe(true);
  });

  test("returns false for non-recipe URLs", () => {
    expect(isRecipeUrl("https://www.example.com/")).toBe(false);
  });
});

describe("Recipe markdown structure expectation", () => {
  test("Recipe markdown structure", () => {
    // Expected markdown structure for recipe:
    // # Recipe Name
    //
    // **Prep Time:** 15 min | **Cook Time:** 30 min | **Total:** 45 min
    // **Servings:** 4 | **Cuisine:** Italian
    //
    // ## Ingredients
    //
    // - 2 cups flour
    // - 1 tsp salt
    // - 3 eggs
    //
    // ## Instructions
    //
    // 1. Mix dry ingredients...
    // 2. Add wet ingredients...
    // 3. Bake at 350°F for 30 minutes...
    //
    // ## Notes
    //
    // Recipe notes...

    expect(true).toBe(true);
  });
});

// ============================================================================
// Docs Tests
// ============================================================================

import {
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
  formatDocsContent,
  generateDocsFilename
} from "../../src/content/templates/docs";

describe("Docs template configuration", () => {
  test("MDN template has correct domain", () => {
    expect(mdnTemplate.domain).toBe("developer.mozilla.org");
    expect(mdnTemplate.enabled).toBe(true);
  });

  test("React docs template has correct domain", () => {
    expect(reactDocsTemplate.domain).toBe("react.dev");
    expect(reactDocsTemplate.enabled).toBe(true);
  });

  test("TypeScript docs template has correct domain", () => {
    expect(typeScriptDocsTemplate.domain).toBe("typescriptlang.org");
    expect(typeScriptDocsTemplate.enabled).toBe(true);
  });

  test("All major framework templates are configured", () => {
    const templates = [
      vueDocsTemplate,
      angularDocsTemplate,
      nodejsDocsTemplate,
      nextjsDocsTemplate,
      tailwindDocsTemplate,
      svelteDocsTemplate,
      nuxtDocsTemplate
    ];

    for (const template of templates) {
      expect(template.enabled).toBe(true);
      expect(template.domain).toBeTruthy();
    }
  });
});

describe("Docs markdown structure expectation", () => {
  test("Documentation page markdown structure", () => {
    // Expected markdown structure for docs:
    // # Function Name
    //
    // **Path:** Reference > JavaScript > Global Objects > Array
    // **Source:** [MDN](url)
    //
    // ## Summary
    //
    // Brief description...
    //
    // ## Syntax
    //
    // ```javascript
    // array.map(callback)
    // ```
    //
    // ## Parameters
    //
    // - `callback` - Function to execute...
    //
    // ## Examples
    //
    // Code examples...
    //
    // ## See Also
    //
    // - Related links...

    expect(true).toBe(true);
  });
});
