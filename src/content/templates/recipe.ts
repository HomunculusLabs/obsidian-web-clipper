/**
 * Recipe template for extracting cooking recipe details.
 * 
 * Handles:
 * - Schema.org Recipe JSON-LD (primary method, most reliable)
 * - Major recipe sites (AllRecipes, Food Network, Serious Eats, etc.)
 * - Generic recipe sites with common markup patterns
 * 
 * Extracts recipe name, ingredients, instructions, prep/cook time, servings,
 * nutrition info, and other recipe metadata.
 */

import type { SiteTemplate } from "../../shared/templates";
import { registerBuiltInTemplates } from "./registry";

/**
 * Recipe data structure extracted from recipe pages.
 */
export interface Recipe {
  /** Recipe name/title */
  name: string | null;
  
  /** Recipe description/summary */
  description: string | null;
  
  /** Author of the recipe */
  author: string | null;
  
  /** List of ingredients */
  ingredients: string[];
  
  /** Step-by-step instructions */
  instructions: string[];
  
  /** Prep time (e.g., "15 minutes") */
  prepTime: string | null;
  
  /** Cook time (e.g., "30 minutes") */
  cookTime: string | null;
  
  /** Total time (e.g., "45 minutes") */
  totalTime: string | null;
  
  /** Number of servings */
  servings: string | null;
  
  /** Yield (e.g., "12 cookies", "1 cake") */
  yield: string | null;
  
  /** Recipe category (e.g., "Dessert", "Main Course") */
  category: string | null;
  
  /** Cuisine type (e.g., "Italian", "Mexican") */
  cuisine: string | null;
  
  /** Keywords/tags */
  keywords: string[];
  
  /** Nutrition information */
  nutrition: RecipeNutrition | null;
  
  /** Recipe image URL */
  image: string | null;
  
  /** Rating (0-5) */
  rating: number | null;
  
  /** Number of reviews/ratings */
  reviewCount: number | null;
  
  /** Difficulty level */
  difficulty: string | null;
}

/**
 * Nutrition information structure.
 */
export interface RecipeNutrition {
  calories?: string;
  fatContent?: string;
  carbohydrateContent?: string;
  proteinContent?: string;
  fiberContent?: string;
  sugarContent?: string;
  sodiumContent?: string;
  cholesterolContent?: string;
  saturatedFatContent?: string;
  unsaturatedFatContent?: string;
  transFatContent?: string;
  servingSize?: string;
}

/**
 * Schema.org Recipe JSON-LD structure.
 */
interface SchemaRecipe {
  "@type": "Recipe";
  name?: string;
  description?: string;
  author?: string | { name?: string } | Array<{ name?: string }>;
  recipeIngredient?: string[];
  recipeInstructions?: string | SchemaInstruction[] | string[];
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  recipeYield?: string | number;
  recipeCategory?: string;
  recipeCuisine?: string;
  keywords?: string | string[];
  nutrition?: SchemaNutrition;
  image?: string | { url?: string } | string[];
  aggregateRating?: {
    ratingValue?: string | number;
    ratingCount?: string | number;
  };
  tool?: string | string[];
  cookingMethod?: string;
  suitableForDiet?: string | string[];
}

interface SchemaInstruction {
  "@type": string;
  text?: string;
  name?: string;
  itemListElement?: SchemaInstructionItem[];
}

interface SchemaInstructionItem {
  "@type": string;
  text?: string;
  position?: number;
}

interface SchemaNutrition {
  "@type": "NutritionInformation";
  calories?: string;
  fatContent?: string;
  carbohydrateContent?: string;
  proteinContent?: string;
  fiberContent?: string;
  sugarContent?: string;
  sodiumContent?: string;
  cholesterolContent?: string;
  saturatedFatContent?: string;
  unsaturatedFatContent?: string;
  transFatContent?: string;
  servingSize?: string;
}

/**
 * Parse ISO 8601 duration to human-readable format.
 * e.g., "PT15M" → "15 minutes", "PT1H30M" → "1 hour 30 minutes"
 */
export function parseDuration(isoDuration: string | undefined): string | null {
  if (!isoDuration) return null;
  
  // If already not ISO format, return as-is
  if (!isoDuration.startsWith("PT")) {
    return isoDuration;
  }
  
  const duration = isoDuration.slice(2); // Remove "PT"
  
  const parts: string[] = [];
  
  // Parse days
  const daysMatch = duration.match(/(\d+)D/);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  }
  
  // Parse hours
  const hoursMatch = duration.match(/(\d+)H/);
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1], 10);
    parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  }
  
  // Parse minutes
  const minsMatch = duration.match(/(\d+)M/);
  if (minsMatch) {
    const mins = parseInt(minsMatch[1], 10);
    parts.push(`${mins} ${mins === 1 ? "minute" : "minutes"}`);
  }
  
  // Parse seconds (rare for recipes but possible)
  const secsMatch = duration.match(/(\d+)S/);
  if (secsMatch) {
    const secs = parseInt(secsMatch[1], 10);
    parts.push(`${secs} ${secs === 1 ? "second" : "seconds"}`);
  }
  
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Extract schema.org Recipe JSON-LD from the page.
 * Returns the first Recipe found in the JSON-LD data.
 */
export function extractSchemaRecipe(doc: Document): SchemaRecipe | null {
  const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
  
  for (const script of Array.from(jsonLdScripts)) {
    try {
      const text = script.textContent?.trim();
      if (!text) continue;
      
      const data = JSON.parse(text);
      
      // Handle @graph (multiple items in one script)
      const items = data["@graph"] || (Array.isArray(data) ? data : [data]);
      
      for (const item of Array.isArray(items) ? items : [items]) {
        if (item["@type"] === "Recipe") {
          return item as SchemaRecipe;
        }
      }
    } catch {
      // Invalid JSON, continue to next script
    }
  }
  
  return null;
}

/**
 * Parse schema.org recipe instructions into an array of strings.
 */
function parseInstructions(
  instructions: SchemaRecipe["recipeInstructions"]
): string[] {
  if (!instructions) return [];
  
  // If it's already a string, split by newlines or return as single item
  if (typeof instructions === "string") {
    const lines = instructions.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    return lines.length > 0 ? lines : [instructions];
  }
  
  // If it's an array of strings
  if (Array.isArray(instructions) && typeof instructions[0] === "string") {
    return instructions as string[];
  }
  
  // If it's an array of HowToStep or similar objects
  if (Array.isArray(instructions)) {
    const steps: string[] = [];
    for (const item of instructions) {
      if (typeof item === "string") {
        steps.push(item);
      } else if (typeof item === "object" && item !== null) {
        // Handle HowToStep with itemListElement
        if (item.itemListElement && Array.isArray(item.itemListElement)) {
          for (const subItem of item.itemListElement) {
            if (subItem.text) {
              steps.push(subItem.text);
            }
          }
        } else if (item.text) {
          steps.push(item.text);
        } else if (item.name) {
          steps.push(item.name);
        }
      }
    }
    return steps;
  }
  
  return [];
}

/**
 * Parse author from various schema.org author formats.
 */
function parseAuthor(author: SchemaRecipe["author"]): string | null {
  if (!author) return null;
  
  if (typeof author === "string") return author;
  
  if (Array.isArray(author)) {
    const names = author
      .map((a) => (typeof a === "string" ? a : a.name))
      .filter(Boolean);
    return names.length > 0 ? names.join(", ") : null;
  }
  
  return author.name || null;
}

/**
 * Extract recipe data from schema.org JSON-LD.
 */
export function extractFromSchema(schema: SchemaRecipe): Partial<Recipe> {
  return {
    name: schema.name || null,
    description: schema.description || null,
    author: parseAuthor(schema.author),
    ingredients: schema.recipeIngredient || [],
    instructions: parseInstructions(schema.recipeInstructions),
    prepTime: parseDuration(schema.prepTime),
    cookTime: parseDuration(schema.cookTime),
    totalTime: parseDuration(schema.totalTime),
    servings: typeof schema.recipeYield === "number" 
      ? String(schema.recipeYield) 
      : schema.recipeYield || null,
    yield: typeof schema.recipeYield === "number"
      ? String(schema.recipeYield)
      : schema.recipeYield || null,
    category: schema.recipeCategory || null,
    cuisine: schema.recipeCuisine || null,
    keywords: typeof schema.keywords === "string"
      ? schema.keywords.split(",").map((k) => k.trim())
      : schema.keywords || [],
    nutrition: schema.nutrition ? {
      calories: schema.nutrition.calories,
      fatContent: schema.nutrition.fatContent,
      carbohydrateContent: schema.nutrition.carbohydrateContent,
      proteinContent: schema.nutrition.proteinContent,
      fiberContent: schema.nutrition.fiberContent,
      sugarContent: schema.nutrition.sugarContent,
      sodiumContent: schema.nutrition.sodiumContent,
      cholesterolContent: schema.nutrition.cholesterolContent,
      saturatedFatContent: schema.nutrition.saturatedFatContent,
      unsaturatedFatContent: schema.nutrition.unsaturatedFatContent,
      transFatContent: schema.nutrition.transFatContent,
      servingSize: schema.nutrition.servingSize
    } : null,
    image: typeof schema.image === "string"
      ? schema.image
      : Array.isArray(schema.image)
        ? schema.image[0]
        : schema.image?.url || null,
    rating: schema.aggregateRating?.ratingValue
      ? parseFloat(String(schema.aggregateRating.ratingValue))
      : null,
    reviewCount: schema.aggregateRating?.ratingCount
      ? parseInt(String(schema.aggregateRating.ratingCount), 10)
      : null
  };
}

/**
 * Generic recipe template that works with schema.org and common selectors.
 * Used as a fallback for any recipe site.
 */
export const genericRecipeTemplate: SiteTemplate = {
  domain: "*",
  name: "Recipe (Generic)",
  description: "Extract recipe details using schema.org JSON-LD and common selectors",
  enabled: true,
  priority: 0, // Lowest priority - used as fallback
  selectors: {
    title: "[itemprop='name'], .recipe-title, h1.recipe-name, h1",
    content: "[itemprop='recipeInstructions'], .recipe-instructions, .instructions",
    author: "[itemprop='author'], .recipe-author, .byline a",
    date: "[itemprop='datePublished'], .recipe-date, time",
    description: "[itemprop='description'], .recipe-description, .summary"
  },
  removeSelectors: [
    ".comments",
    ".related-recipes",
    ".social-share",
    ".newsletter-signup",
    ".ad",
    ".advertisement",
    "[class*='sidebar']",
    "nav",
    "footer"
  ],
  frontmatterExtras: {
    type: "recipe"
  }
};

/**
 * AllRecipes.com template.
 */
export const allRecipesTemplate: SiteTemplate = {
  domain: "allrecipes.com",
  name: "AllRecipes",
  description: "Extract recipes from AllRecipes.com",
  enabled: true,
  priority: 100,
  selectors: {
    title: "h1.article-heading, h1.headline",
    content: ".recipe__steps-content, .instructions-section",
    author: ".author-name, .contributor-name",
    date: ".publish-date time"
  },
  removeSelectors: [
    ".recipe-servings",
    ".recipe-print",
    ".recipe-save",
    ".related-content",
    ".feedback-section",
    ".ad-container"
  ],
  frontmatterExtras: {
    site: "allrecipes",
    type: "recipe"
  }
};

/**
 * Food Network template.
 */
export const foodNetworkTemplate: SiteTemplate = {
  domain: "foodnetwork.com",
  name: "Food Network",
  description: "Extract recipes from Food Network",
  enabled: true,
  priority: 100,
  selectors: {
    title: "h1.o-Recipe-title, .recipe-title",
    content: ".o-Method__m-Body, .recipe-directions",
    author: ".o-Attribution__a-Name, .author-name",
    date: ".o-Attribution__a-Date time"
  },
  removeSelectors: [
    ".o-RecipeComponent",
    ".related-recipes",
    ".o-SocialShare",
    ".ad-slot"
  ],
  frontmatterExtras: {
    site: "foodnetwork",
    type: "recipe"
  }
};

/**
 * Serious Eats template.
 */
export const seriousEatsTemplate: SiteTemplate = {
  domain: "seriouseats.com",
  name: "Serious Eats",
  description: "Extract recipes from Serious Eats",
  enabled: true,
  priority: 100,
  selectors: {
    title: "h1.heading-content, h1.article-title",
    content: ".recipe-procedure, .instructions",
    author: ".author-name, .byline a",
    date: ".publish-date time"
  },
  removeSelectors: [
    ".related-posts",
    ".newsletter-signup",
    ".ad-container",
    ".comment-section"
  ],
  frontmatterExtras: {
    site: "seriouseats",
    type: "recipe"
  }
};

/**
 * Bon Appétit template.
 */
export const bonAppetitTemplate: SiteTemplate = {
  domain: "bonappetit.com",
  name: "Bon Appétit",
  description: "Extract recipes from Bon Appétit",
  enabled: true,
  priority: 100,
  selectors: {
    title: "h1[data-testid='ContentHeaderHed'], h1.recipe-title",
    content: "[data-testid='InstructionsWrapper'], .recipe-instructions",
    author: ".byline a, [data-testid='BylineName']"
  },
  removeSelectors: [
    ".related-content",
    ".newsletter-signup",
    ".ad-container"
  ],
  frontmatterExtras: {
    site: "bonappetit",
    type: "recipe"
  }
};

/**
 * Epicurious template.
 */
export const epicuriousTemplate: SiteTemplate = {
  domain: "epicurious.com",
  name: "Epicurious",
  description: "Extract recipes from Epicurious",
  enabled: true,
  priority: 100,
  selectors: {
    title: "h1[data-testid='ContentHeaderHed'], h1.recipe-title",
    content: "[data-testid='InstructionsWrapper'], .recipe-instructions",
    author: ".byline a"
  },
  removeSelectors: [
    ".related-content",
    ".newsletter-signup",
    ".ad-container"
  ],
  frontmatterExtras: {
    site: "epicurious",
    type: "recipe"
  }
};

/**
 * Tasty template (BuzzFeed).
 */
export const tastyTemplate: SiteTemplate = {
  domain: "tasty.co",
  name: "Tasty",
  description: "Extract recipes from Tasty",
  enabled: true,
  priority: 100,
  selectors: {
    title: "h1.recipe-name, h1",
    content: ".prep-steps, .instructions",
    author: ".author-name"
  },
  removeSelectors: [
    ".related-recipes",
    ".social-share",
    ".ad-container"
  ],
  frontmatterExtras: {
    site: "tasty",
    type: "recipe"
  }
};

/**
 * BBC Good Food template.
 */
export const bbcGoodFoodTemplate: SiteTemplate = {
  domain: "bbcgoodfood.com",
  name: "BBC Good Food",
  description: "Extract recipes from BBC Good Food",
  enabled: true,
  priority: 100,
  selectors: {
    title: "h1.heading-1, h1.recipe-title",
    content: ".recipe__method, .recipe-method",
    author: ".author-name, .post-author a"
  },
  removeSelectors: [
    ".related-content",
    ".newsletter-signup",
    ".ad-container"
  ],
  frontmatterExtras: {
    site: "bbcgoodfood",
    type: "recipe"
  }
};

/**
 * NYT Cooking template.
 */
export const nytCookingTemplate: SiteTemplate = {
  domain: "cooking.nytimes.com",
  name: "NYT Cooking",
  description: "Extract recipes from NYT Cooking",
  enabled: true,
  priority: 100,
  selectors: {
    title: "h1.recipe-title, h1.title",
    content: ".recipe-steps, .instructions",
    author: ".recipe-author, .byline a"
  },
  removeSelectors: [
    ".related-recipes",
    ".social-share",
    ".ad-container",
    ".subscription-prompt"
  ],
  frontmatterExtras: {
    site: "nytcooking",
    type: "recipe"
  }
};

/**
 * Simply Recipes template.
 */
export const simplyRecipesTemplate: SiteTemplate = {
  domain: "simplyrecipes.com",
  name: "Simply Recipes",
  description: "Extract recipes from Simply Recipes",
  enabled: true,
  priority: 100,
  selectors: {
    title: "h1.entry-title, h1.recipe-title",
    content: ".recipe-instructions, .instructions",
    author: ".author-name, .byline a"
  },
  removeSelectors: [
    ".related-posts",
    ".newsletter-signup",
    ".ad-container"
  ],
  frontmatterExtras: {
    site: "simplyrecipes",
    type: "recipe"
  }
};

/**
 * King Arthur Baking template.
 */
export const kingArthurTemplate: SiteTemplate = {
  domain: "kingarthurbaking.com",
  name: "King Arthur Baking",
  description: "Extract recipes from King Arthur Baking",
  enabled: true,
  priority: 100,
  selectors: {
    title: "h1.recipe-title, h1",
    content: ".recipe-instructions, .instructions",
    author: ".recipe-author"
  },
  removeSelectors: [
    ".related-recipes",
    ".newsletter-signup",
    ".ad-container"
  ],
  frontmatterExtras: {
    site: "kingarthur",
    type: "recipe"
  }
};

/**
 * Recipe sites for which we have specific templates.
 * Used to quickly check if we should attempt recipe extraction.
 */
export const RECIPE_SITES = [
  "allrecipes.com",
  "foodnetwork.com",
  "seriouseats.com",
  "bonappetit.com",
  "epicurious.com",
  "tasty.co",
  "bbcgoodfood.com",
  "cooking.nytimes.com",
  "simplyrecipes.com",
  "kingarthurbaking.com",
  // Additional common recipe sites that use schema.org
  "food.com",
  "myrecipes.com",
  "cookinglight.com",
  "eatingwell.com",
  "delish.com",
  "geniuskitchen.com",
  "yummly.com",
  "tasteofhome.com",
  "sallysbakingaddiction.com",
  "cookieandkate.com",
  "minimalistbaker.com",
  "smittenkitchen.com",
  "budgetbytes.com",
  "damndelicious.net",
  "pinchofyum.com",
  "recipetineats.com"
];

/**
 * Extract recipe from page using both schema.org and DOM fallbacks.
 */
export function extractRecipe(doc: Document, url: string): Recipe {
  // Start with empty recipe
  const recipe: Recipe = {
    name: null,
    description: null,
    author: null,
    ingredients: [],
    instructions: [],
    prepTime: null,
    cookTime: null,
    totalTime: null,
    servings: null,
    yield: null,
    category: null,
    cuisine: null,
    keywords: [],
    nutrition: null,
    image: null,
    rating: null,
    reviewCount: null,
    difficulty: null
  };
  
  // First, try schema.org JSON-LD (most reliable)
  const schema = extractSchemaRecipe(doc);
  if (schema) {
    const schemaData = extractFromSchema(schema);
    Object.assign(recipe, schemaData);
  }
  
  // If schema didn't provide key data, fall back to DOM extraction
  if (!recipe.name) {
    recipe.name = extractDomTitle(doc);
  }
  
  if (recipe.ingredients.length === 0) {
    recipe.ingredients = extractDomIngredients(doc);
  }
  
  if (recipe.instructions.length === 0) {
    recipe.instructions = extractDomInstructions(doc);
  }
  
  if (!recipe.prepTime) {
    recipe.prepTime = extractDomTime(doc, "prep");
  }
  
  if (!recipe.cookTime) {
    recipe.cookTime = extractDomTime(doc, "cook");
  }
  
  if (!recipe.totalTime) {
    recipe.totalTime = extractDomTime(doc, "total");
  }
  
  if (!recipe.servings) {
    recipe.servings = extractDomServings(doc);
  }
  
  if (!recipe.image) {
    recipe.image = extractDomImage(doc);
  }
  
  if (!recipe.author) {
    recipe.author = extractDomAuthor(doc);
  }
  
  if (!recipe.description) {
    recipe.description = extractDomDescription(doc);
  }
  
  if (recipe.rating === null) {
    const rating = extractDomRating(doc);
    if (rating !== null) {
      recipe.rating = rating;
    }
  }
  
  return recipe;
}

/**
 * Extract title from DOM selectors.
 */
function extractDomTitle(doc: Document): string | null {
  const selectors = [
    "[itemprop='name']",
    ".recipe-title",
    ".recipe-name",
    "h1.recipe-title",
    "h1"
  ];
  
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text && text.length > 0 && text.length < 500) {
      return text;
    }
  }
  
  return null;
}

/**
 * Extract ingredients from DOM selectors.
 */
function extractDomIngredients(doc: Document): string[] {
  const ingredients: string[] = [];
  
  // Try itemprop first (schema.org microdata)
  const itemPropEls = doc.querySelectorAll("[itemprop='recipeIngredient'], [itemprop='ingredients']");
  if (itemPropEls.length > 0) {
    for (const el of Array.from(itemPropEls)) {
      const text = el.textContent?.trim();
      if (text && text.length > 0) {
        ingredients.push(text);
      }
    }
    if (ingredients.length > 0) return ingredients;
  }
  
  // Try common ingredient list selectors
  const listSelectors = [
    ".recipe-ingredients li",
    ".ingredients li",
    ".ingredient-list li",
    "[class*='ingredient'] li",
    "ul.ingredients li"
  ];
  
  for (const selector of listSelectors) {
    const els = doc.querySelectorAll(selector);
    if (els.length > 0) {
      for (const el of Array.from(els)) {
        const text = el.textContent?.trim();
        if (text && text.length > 0 && text.length < 500) {
          ingredients.push(text);
        }
      }
      if (ingredients.length > 0) return ingredients;
    }
  }
  
  return ingredients;
}

/**
 * Extract instructions from DOM selectors.
 */
function extractDomInstructions(doc: Document): string[] {
  const instructions: string[] = [];
  
  // Try itemprop first (schema.org microdata)
  const itemPropEls = doc.querySelectorAll("[itemprop='recipeInstructions'] li, [itemprop='recipeInstructions'] p");
  if (itemPropEls.length > 0) {
    for (const el of Array.from(itemPropEls)) {
      const text = el.textContent?.trim();
      if (text && text.length > 0) {
        instructions.push(text);
      }
    }
    if (instructions.length > 0) return instructions;
  }
  
  // Try common instruction selectors
  const stepSelectors = [
    ".recipe-instructions li",
    ".recipe-steps li",
    ".instructions li",
    ".method li",
    "[class*='instruction'] li",
    "[class*='step'] li"
  ];
  
  for (const selector of stepSelectors) {
    const els = doc.querySelectorAll(selector);
    if (els.length > 0) {
      for (const el of Array.from(els)) {
        const text = el.textContent?.trim();
        if (text && text.length > 0) {
          instructions.push(text);
        }
      }
      if (instructions.length > 0) return instructions;
    }
  }
  
  // Try paragraph-based instructions
  const paraSelectors = [
    ".recipe-instructions p",
    ".instructions p",
    ".method p"
  ];
  
  for (const selector of paraSelectors) {
    const els = doc.querySelectorAll(selector);
    if (els.length > 0) {
      for (const el of Array.from(els)) {
        const text = el.textContent?.trim();
        if (text && text.length > 10) {
          instructions.push(text);
        }
      }
      if (instructions.length > 0) return instructions;
    }
  }
  
  return instructions;
}

/**
 * Extract time from DOM selectors.
 */
function extractDomTime(doc: Document, type: "prep" | "cook" | "total"): string | null {
  const selectors = [
    `[itemprop='${type === "total" ? "totalTime" : type + "Time"}']`,
    `[data-test='${type}-time']`,
    `.${type}-time`,
    `#recipe-${type}-time`,
    `[class*='${type}Time']`,
    `[aria-label*='${type.charAt(0).toUpperCase() + type.slice(1)}']`
  ];
  
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const text = el?.textContent?.trim() || el?.getAttribute("content");
    if (text && text.length > 0) {
      return parseDuration(text) || text;
    }
  }
  
  return null;
}

/**
 * Extract servings from DOM selectors.
 */
function extractDomServings(doc: Document): string | null {
  const selectors = [
    "[itemprop='recipeYield']",
    "[itemprop='servings']",
    ".servings",
    ".recipe-yield",
    ".yield",
    "[data-test='servings']"
  ];
  
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text && text.length > 0) {
      return text;
    }
  }
  
  return null;
}

/**
 * Extract main image from DOM.
 */
function extractDomImage(doc: Document): string | null {
  const selectors = [
    "[itemprop='image']",
    ".recipe-image img",
    ".recipe-hero img",
    "img[itemprop='image']",
    "figure img"
  ];
  
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (el instanceof HTMLImageElement) {
      const src = el.src || el.dataset.src;
      if (src && !src.includes("placeholder")) {
        return src;
      }
    }
  }
  
  return null;
}

/**
 * Extract author from DOM.
 */
function extractDomAuthor(doc: Document): string | null {
  const selectors = [
    "[itemprop='author']",
    ".recipe-author",
    ".author-name",
    ".byline a"
  ];
  
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text && text.length > 0 && text.length < 200) {
      return text;
    }
  }
  
  return null;
}

/**
 * Extract description from DOM.
 */
function extractDomDescription(doc: Document): string | null {
  const selectors = [
    "[itemprop='description']",
    ".recipe-description",
    ".recipe-summary",
    ".summary"
  ];
  
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text && text.length > 10 && text.length < 2000) {
      return text;
    }
  }
  
  return null;
}

/**
 * Extract rating from DOM.
 */
function extractDomRating(doc: Document): number | null {
  const selectors = [
    "[itemprop='ratingValue']",
    ".rating-value",
    ".recipe-rating",
    "[data-rating]"
  ];
  
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const text = el?.textContent?.trim() || el?.getAttribute("data-rating") || el?.getAttribute("content");
    if (text) {
      const rating = parseFloat(text);
      if (!isNaN(rating) && rating >= 0 && rating <= 5) {
        return rating;
      }
    }
  }
  
  return null;
}

/**
 * Format recipe data as markdown.
 */
export function formatRecipeContent(recipe: Recipe): string {
  let md = "";
  
  // Title
  if (recipe.name) {
    md += `# ${recipe.name}\n\n`;
  }
  
  // Metadata block
  const metaItems: string[] = [];
  
  if (recipe.author) {
    metaItems.push(`**Author:** ${recipe.author}`);
  }
  
  // Times
  const times: string[] = [];
  if (recipe.prepTime) times.push(`Prep: ${recipe.prepTime}`);
  if (recipe.cookTime) times.push(`Cook: ${recipe.cookTime}`);
  if (recipe.totalTime) times.push(`Total: ${recipe.totalTime}`);
  if (times.length > 0) {
    metaItems.push(`**Time:** ${times.join(" | ")}`);
  }
  
  if (recipe.servings || recipe.yield) {
    metaItems.push(`**Yield:** ${recipe.servings || recipe.yield}`);
  }
  
  if (recipe.category) {
    metaItems.push(`**Category:** ${recipe.category}`);
  }
  
  if (recipe.cuisine) {
    metaItems.push(`**Cuisine:** ${recipe.cuisine}`);
  }
  
  if (recipe.rating !== null) {
    const stars = "★".repeat(Math.round(recipe.rating)) + 
                  "☆".repeat(5 - Math.round(recipe.rating));
    let ratingLine = `**Rating:** ${stars} ${recipe.rating}/5`;
    if (recipe.reviewCount !== null) {
      ratingLine += ` (${recipe.reviewCount.toLocaleString()} reviews)`;
    }
    metaItems.push(ratingLine);
  }
  
  if (metaItems.length > 0) {
    md += metaItems.join("\n\n") + "\n\n";
  }
  
  // Main image
  if (recipe.image) {
    md += `![Recipe Image](${recipe.image})\n\n`;
  }
  
  // Description
  if (recipe.description) {
    md += `## Description\n\n${recipe.description}\n\n`;
  }
  
  // Ingredients
  if (recipe.ingredients.length > 0) {
    md += `## Ingredients\n\n`;
    for (const ingredient of recipe.ingredients) {
      md += `- ${ingredient}\n`;
    }
    md += "\n";
  }
  
  // Instructions
  if (recipe.instructions.length > 0) {
    md += `## Instructions\n\n`;
    for (let i = 0; i < recipe.instructions.length; i++) {
      md += `${i + 1}. ${recipe.instructions[i]}\n`;
    }
    md += "\n";
  }
  
  // Nutrition
  if (recipe.nutrition) {
    const nutritionItems: string[] = [];
    
    if (recipe.nutrition.calories) {
      nutritionItems.push(`**Calories:** ${recipe.nutrition.calories}`);
    }
    if (recipe.nutrition.proteinContent) {
      nutritionItems.push(`**Protein:** ${recipe.nutrition.proteinContent}`);
    }
    if (recipe.nutrition.carbohydrateContent) {
      nutritionItems.push(`**Carbs:** ${recipe.nutrition.carbohydrateContent}`);
    }
    if (recipe.nutrition.fatContent) {
      nutritionItems.push(`**Fat:** ${recipe.nutrition.fatContent}`);
    }
    if (recipe.nutrition.fiberContent) {
      nutritionItems.push(`**Fiber:** ${recipe.nutrition.fiberContent}`);
    }
    if (recipe.nutrition.sodiumContent) {
      nutritionItems.push(`**Sodium:** ${recipe.nutrition.sodiumContent}`);
    }
    
    if (nutritionItems.length > 0) {
      md += `## Nutrition\n\n`;
      md += nutritionItems.join(" | ") + "\n\n";
    }
  }
  
  // Keywords/tags
  if (recipe.keywords.length > 0) {
    md += `## Tags\n\n`;
    md += recipe.keywords.map((k) => `#${k.replace(/\s+/g, "-")}`).join(" ") + "\n\n";
  }
  
  return md;
}

/**
 * Generate a filename for the recipe note.
 */
export function generateRecipeFilename(recipe: Recipe): string {
  if (!recipe.name) {
    return "recipe";
  }
  
  // Sanitize title for filename
  let filename = recipe.name
    .toLowerCase()
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  
  return filename || "recipe";
}

/**
 * Check if a URL looks like a recipe page.
 */
export function isRecipeUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/^www\./, "");
    const path = urlObj.pathname.toLowerCase();
    
    // Check if it's a known recipe site
    if (RECIPE_SITES.includes(hostname)) {
      return true;
    }
    
    // Check for recipe-related path patterns
    const recipePathPatterns = [
      /\/recipe\//,
      /\/recipes\//,
      /\/cooking\//,
      /\/food\//,
      /-recipe-/,
      /-recipes-/,
      /\.recipe\./
    ];
    
    for (const pattern of recipePathPatterns) {
      if (pattern.test(path)) {
        return true;
      }
    }
    
    return false;
  } catch {
    return false;
  }
}

// Register all recipe templates
registerBuiltInTemplates([
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
  kingArthurTemplate
]);
