/**
 * Amazon product page template for extracting product details.
 * 
 * Handles:
 * - Amazon.com product pages (amazon.com/dp/*, amazon.com/gp/product/*)
 * - Regional Amazon sites (amazon.co.uk, amazon.de, etc.)
 * 
 * Extracts product name, price, rating, features list, description, and images.
 * Useful for purchase research and price tracking.
 */

import type { SiteTemplate } from "../../shared/templates";
import { registerBuiltInTemplates } from "./registry";

/**
 * Amazon product data structure.
 */
export interface AmazonProduct {
  /** Product title */
  title: string | null;
  
  /** Current price (may include currency symbol) */
  price: string | null;
  
  /** Original/list price before discount */
  listPrice: string | null;
  
  /** Rating as a number (e.g., 4.5) */
  rating: number | null;
  
  /** Total number of reviews */
  reviewCount: number | null;
  
  /** Product features/bullet points */
  features: string[];
  
  /** Product description (HTML or text) */
  description: string | null;
  
  /** Main product image URL */
  mainImage: string | null;
  
  /** Additional product images */
  images: string[];
  
  /** ASIN (Amazon Standard Identification Number) */
  asin: string | null;
  
  /** Product availability status */
  availability: string | null;
  
  /** Brand/seller name */
  brand: string | null;
  
  /** Product category/breadcrumb */
  category: string | null;
}

/**
 * Main Amazon.com template for product pages.
 */
export const amazonTemplate: SiteTemplate = {
  domain: "amazon.com",
  name: "Amazon",
  description: "Extract Amazon product details: name, price, rating, features, description",
  enabled: true,
  priority: 100,
  urlPattern: "^/(?:dp|gp/product)/[A-Z0-9]+",
  selectors: {
    // Product title
    title: "#productTitle, #title span",
    // Main content area (description + features)
    content: "#productDescription, #feature-bullets, #aplus",
    // Brand/seller
    author: "#bylineInfo, #brand, a#bylineInfo",
    // Not used - Amazon doesn't have dates for products
    date: "",
    // Category tags
    tags: "#wayfinding-breadcrumbs_feature_div a, #breadcrumb-back-link"
  },
  removeSelectors: [
    // Remove sponsored products section
    "#sp_detail",
    "#sponsoredProducts_feature_div",
    ".sp_detail",
    // Remove frequently bought together
    "#sims-consolidated-2_feature_div",
    // Remove customer reviews section (we just want count)
    "#reviews-medley_footer",
    "#cm_cr-review_list",
    // Remove A+ content videos
    ".aplus-video-wrapper",
    // Remove ads
    ".adID",
    "[data-ad-id]",
    // Remove comparison tables
    "#HLCXComparisonWidget",
    // Remove "customers who bought this" section
    "#view_to_purchase-sims-feature",
    // Remove wishlist/registry buttons
    "#add-to-wishlist-button-group",
    "#wishlist-button-group",
    // Remove social share buttons
    ".a2a_dd",
    // Remove newsletter signup
    "#newsletter-signup",
    // Remove "what's in the box" if too large
    "#whats-in-the-box_feature_div"
  ],
  frontmatterExtras: {
    site: "amazon",
    type: "product"
  }
};

/**
 * Amazon UK template.
 */
export const amazonUKTemplate: SiteTemplate = {
  domain: "amazon.co.uk",
  name: "Amazon UK",
  description: "Extract Amazon UK product details",
  enabled: true,
  priority: 100,
  urlPattern: "^/(?:dp|gp/product)/[A-Z0-9]+",
  selectors: amazonTemplate.selectors,
  removeSelectors: amazonTemplate.removeSelectors,
  frontmatterExtras: {
    site: "amazon-uk",
    type: "product"
  }
};

/**
 * Amazon Germany template.
 */
export const amazonDETemplate: SiteTemplate = {
  domain: "amazon.de",
  name: "Amazon Germany",
  description: "Extract Amazon Germany product details",
  enabled: true,
  priority: 100,
  urlPattern: "^/(?:dp|gp/product)/[A-Z0-9]+",
  selectors: amazonTemplate.selectors,
  removeSelectors: amazonTemplate.removeSelectors,
  frontmatterExtras: {
    site: "amazon-de",
    type: "product"
  }
};

/**
 * Amazon Canada template.
 */
export const amazonCATemplate: SiteTemplate = {
  domain: "amazon.ca",
  name: "Amazon Canada",
  description: "Extract Amazon Canada product details",
  enabled: true,
  priority: 100,
  urlPattern: "^/(?:dp|gp/product)/[A-Z0-9]+",
  selectors: amazonTemplate.selectors,
  removeSelectors: amazonTemplate.removeSelectors,
  frontmatterExtras: {
    site: "amazon-ca",
    type: "product"
  }
};

/**
 * Generic Amazon template for all other regional sites.
 */
export const amazonGenericTemplate: SiteTemplate = {
  domain: "*.amazon.*",
  name: "Amazon (Generic)",
  description: "Extract Amazon product details from any regional site",
  enabled: true,
  priority: 50,
  urlPattern: "^/(?:dp|gp/product)/[A-Z0-9]+",
  selectors: amazonTemplate.selectors,
  removeSelectors: amazonTemplate.removeSelectors,
  frontmatterExtras: {
    site: "amazon",
    type: "product"
  }
};

/**
 * Extract ASIN from URL.
 * ASINs are 10-character alphanumeric codes used to identify products.
 * 
 * @param url - The Amazon product URL
 * @returns The ASIN or null if not found
 */
export function extractAsin(url: string): string | null {
  // Match patterns like:
  // /dp/B08N5WRWNW
  // /gp/product/B08N5WRWNW
  // /product/B08N5WRWNW
  // ?asin=B08N5WRWNW
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /\/gp\/product\/([A-Z0-9]{10})/i,
    /\/product\/([A-Z0-9]{10})/i,
    /[?&]asin=([A-Z0-9]{10})/i,
    /\/([A-Z0-9]{10})(?:[/?]|$)/i
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  
  return null;
}

/**
 * Extract product title from the page.
 */
export function extractTitle(doc: Document): string | null {
  const titleEl = doc.querySelector("#productTitle, #title span");
  if (!titleEl) return null;
  return titleEl.textContent?.trim() || null;
}

/**
 * Extract current price from the page.
 * Amazon has multiple price display formats depending on the product type.
 */
export function extractPrice(doc: Document): string | null {
  // Try various price selectors in order of reliability
  const priceSelectors = [
    // Regular price
    "#priceblock_ourprice .a-offscreen",
    "#priceblock_ourprice",
    ".a-price .a-offscreen",
    ".a-price",
    // Deal price
    "#priceblock_dealprice .a-offscreen",
    "#priceblock_dealprice",
    // Sale price
    "#priceblock_saleprice .a-offscreen",
    "#priceblock_saleprice",
    // Buy box price
    "#priceblock_buybox .a-offscreen",
    "#priceblock_buybox",
    // Offer price
    "#priceblock_pospromoprice .a-offscreen",
    "#priceblock_pospromoprice",
    // Unified price (newer UI)
    "#corePrice_feature_div .a-offscreen",
    "#corePrice_feature_div .a-price-whole",
    // Kindle price
    "#kindle-price .a-offscreen",
    "#kindle-price",
    // Generic price (fallback)
    "[data-a-color='price'] .a-offscreen",
    ".a-price-range .a-offscreen"
  ];
  
  for (const selector of priceSelectors) {
    const priceEl = doc.querySelector(selector);
    if (priceEl) {
      const price = priceEl.textContent?.trim();
      if (price && price.length > 0 && price !== "$0.00") {
        return price;
      }
    }
  }
  
  return null;
}

/**
 * Extract list/original price (before discount).
 */
export function extractListPrice(doc: Document): string | null {
  const listPriceSelectors = [
    ".a-price[data-a-strike='true'] .a-offscreen",
    ".basisPrice .a-offscreen",
    "#listPrice .a-offscreen",
    ".a-price.a-text-price .a-offscreen",
    ".a-price.a-text-price"
  ];
  
  for (const selector of listPriceSelectors) {
    const priceEl = doc.querySelector(selector);
    if (priceEl) {
      const price = priceEl.textContent?.trim();
      if (price && price.length > 0) {
        return price;
      }
    }
  }
  
  return null;
}

/**
 * Extract rating from the page.
 */
export function extractRating(doc: Document): number | null {
  // Try the rating popover (most reliable)
  const ratingEl = doc.querySelector("#acrPopover, #reviewStarsPopover, i[data-hook='average-star-rating']");
  if (ratingEl) {
    // Try data attribute first
    const ratingText = ratingEl.getAttribute("title") || 
                       ratingEl.textContent?.trim() || "";
    
    // Parse "4.5 out of 5 stars" or similar formats
    const match = ratingText.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      const rating = parseFloat(match[1]);
      if (rating >= 0 && rating <= 5) {
        return rating;
      }
    }
  }
  
  // Try alternative selectors
  const altRatingEl = doc.querySelector(".a-icon-star-small .a-icon-alt, .a-icon-star .a-icon-alt");
  if (altRatingEl) {
    const ratingText = altRatingEl.textContent?.trim() || "";
    const match = ratingText.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      return parseFloat(match[1]);
    }
  }
  
  return null;
}

/**
 * Extract review count from the page.
 */
export function extractReviewCount(doc: Document): number | null {
  const countSelectors = [
    "#acrCustomerReviewText",
    "[data-hook='total-review-count']",
    "#reviews-medley-footer .a-row.a-spacing-medium span"
  ];
  
  for (const selector of countSelectors) {
    const countEl = doc.querySelector(selector);
    if (countEl) {
      const text = countEl.textContent?.trim() || "";
      // Parse "1,234 ratings" or "1,234 reviews" or "1234"
      const match = text.match(/([0-9,]+)/);
      if (match) {
        const count = parseInt(match[1].replace(/,/g, ""), 10);
        if (!isNaN(count) && count > 0) {
          return count;
        }
      }
    }
  }
  
  return null;
}

/**
 * Extract product features/bullet points.
 */
export function extractFeatures(doc: Document): string[] {
  const features: string[] = [];
  const featuresContainer = doc.querySelector("#feature-bullets ul, #about-this-item ul");
  
  if (featuresContainer) {
    const listItems = featuresContainer.querySelectorAll("li");
    for (const li of Array.from(listItems)) {
      // Get text and remove the "›" character Amazon sometimes adds
      const text = li.textContent?.trim().replace(/^›\s*/, "") || "";
      // Skip empty items and "See more" links
      if (text.length > 0 && 
          !text.toLowerCase().includes("see more") && 
          !text.toLowerCase().includes("read more")) {
        features.push(text);
      }
    }
  }
  
  return features;
}

/**
 * Extract product description.
 */
export function extractDescription(doc: Document): string | null {
  // Try product description section
  const descEl = doc.querySelector("#productDescription p, #productDescription");
  if (descEl) {
    const desc = descEl.textContent?.trim();
    if (desc && desc.length > 0) {
      return desc;
    }
  }
  
  // Try A+ content (enhanced brand content)
  const aplusEl = doc.querySelector("#aplus p, #aplus-feature_div .aplus-module");
  if (aplusEl) {
    return aplusEl.innerHTML;
  }
  
  // Try feature description
  const featureDescEl = doc.querySelector("#bookDescription_feature_div iframe");
  if (featureDescEl) {
    // For books, the description is in an iframe - we'd need to access its contentDocument
    // This is a limitation when running in content scripts
    return null;
  }
  
  return null;
}

/**
 * Extract main product image URL.
 */
export function extractMainImage(doc: Document): string | null {
  // Try the main landing image
  const mainImgSelectors = [
    "#landingImage",
    "#imgTagWrapperId img",
    "#main-image-container img",
    "#imageBlock img",
    ".a-dynamic-image"
  ];
  
  for (const selector of mainImgSelectors) {
    const imgEl = doc.querySelector(selector);
    if (imgEl) {
      // Try data-old-hires for highest quality
      const hiresUrl = imgEl.getAttribute("data-old-hires") || 
                       imgEl.getAttribute("data-a-dynamic-image");
      if (hiresUrl) {
        // Parse the JSON if it's the dynamic image attribute
        try {
          if (hiresUrl.startsWith("{")) {
            const imageData = JSON.parse(hiresUrl);
            const urls = Object.keys(imageData);
            if (urls.length > 0) {
              return urls[0];
            }
          }
        } catch {
          // Not JSON, use as-is
        }
        return hiresUrl;
      }
      
      // Fall back to src attribute
      const src = imgEl.getAttribute("src");
      if (src && !src.includes("transparent-pixel")) {
        return src;
      }
    }
  }
  
  return null;
}

/**
 * Extract additional product images.
 */
export function extractImages(doc: Document): string[] {
  const images: string[] = [];
  const seenUrls = new Set<string>();
  
  // Get all thumbnail images from the gallery
  const thumbSelectors = [
    "#altImages img",
    "#imageBlockThumbnails img",
    ".a-button-thumb img"
  ];
  
  for (const selector of thumbSelectors) {
    const thumbEls = doc.querySelectorAll(selector);
    for (const thumbEl of Array.from(thumbEls)) {
      // Get the hi-res URL from data attribute
      const hiresUrl = thumbEl.getAttribute("data-a-hires") ||
                       thumbEl.getAttribute("data-a-dynamic-image");
      
      if (hiresUrl) {
        let url = hiresUrl;
        // Parse JSON if needed
        try {
          if (hiresUrl.startsWith("{")) {
            const imageData = JSON.parse(hiresUrl);
            url = Object.keys(imageData)[0];
          }
        } catch {
          // Use as-is
        }
        
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          images.push(url);
        }
      }
    }
  }
  
  return images;
}

/**
 * Extract availability status.
 */
export function extractAvailability(doc: Document): string | null {
  const availEl = doc.querySelector("#availability, #deliveryMessageMirId");
  if (availEl) {
    // Check for specific availability classes
    const availText = availEl.textContent?.trim();
    if (availText && !availText.includes("Loading")) {
      return availText;
    }
  }
  
  // Check for "Currently unavailable" message
  const unavailableEl = doc.querySelector("#availability .a-color-price");
  if (unavailableEl) {
    const text = unavailableEl.textContent?.trim();
    if (text) {
      return text;
    }
  }
  
  return null;
}

/**
 * Extract brand/seller name.
 */
export function extractBrand(doc: Document): string | null {
  const brandSelectors = [
    "#bylineInfo",
    "#brand",
    "a#bylineInfo",
    "#productTitle .a-link-normal",
    ".po-brand .po-break-word"
  ];
  
  for (const selector of brandSelectors) {
    const brandEl = doc.querySelector(selector);
    if (brandEl) {
      let brand = brandEl.textContent?.trim() || "";
      // Clean up common prefixes
      brand = brand.replace(/^(Visit the |Brand: |by )/i, "");
      if (brand.length > 0) {
        return brand;
      }
    }
  }
  
  return null;
}

/**
 * Extract category/breadcrumb.
 */
export function extractCategory(doc: Document): string | null {
  // Try breadcrumb navigation
  const breadcrumbEl = doc.querySelector("#wayfinding-breadcrumbs_feature_div");
  if (breadcrumbEl) {
    const links = breadcrumbEl.querySelectorAll("a");
    const parts: string[] = [];
    for (const link of Array.from(links)) {
      const text = link.textContent?.trim();
      if (text && text.length > 0) {
        parts.push(text);
      }
    }
    if (parts.length > 0) {
      return parts.join(" > ");
    }
  }
  
  return null;
}

/**
 * Main extraction function for Amazon product pages.
 * Extracts all available product information.
 */
export function extractAmazonProduct(
  doc: Document,
  url: string
): AmazonProduct {
  return {
    title: extractTitle(doc),
    price: extractPrice(doc),
    listPrice: extractListPrice(doc),
    rating: extractRating(doc),
    reviewCount: extractReviewCount(doc),
    features: extractFeatures(doc),
    description: extractDescription(doc),
    mainImage: extractMainImage(doc),
    images: extractImages(doc),
    asin: extractAsin(url),
    availability: extractAvailability(doc),
    brand: extractBrand(doc),
    category: extractCategory(doc)
  };
}

/**
 * Format Amazon product data as markdown.
 */
export function formatAmazonContent(product: AmazonProduct): string {
  let md = "";
  
  // Title
  if (product.title) {
    md += `# ${product.title}\n\n`;
  }
  
  // Metadata block
  const metaItems: string[] = [];
  
  if (product.brand) {
    metaItems.push(`**Brand:** ${product.brand}`);
  }
  
  if (product.price) {
    let priceLine = `**Price:** ${product.price}`;
    if (product.listPrice && product.listPrice !== product.price) {
      priceLine += ` ~~${product.listPrice}~~`;
    }
    metaItems.push(priceLine);
  }
  
  if (product.rating !== null) {
    const stars = "★".repeat(Math.round(product.rating)) + 
                  "☆".repeat(5 - Math.round(product.rating));
    let ratingLine = `**Rating:** ${stars} ${product.rating}/5`;
    if (product.reviewCount !== null) {
      ratingLine += ` (${product.reviewCount.toLocaleString()} reviews)`;
    }
    metaItems.push(ratingLine);
  }
  
  if (product.availability) {
    metaItems.push(`**Availability:** ${product.availability}`);
  }
  
  if (product.category) {
    metaItems.push(`**Category:** ${product.category}`);
  }
  
  if (product.asin) {
    metaItems.push(`**ASIN:** \`${product.asin}\``);
  }
  
  if (metaItems.length > 0) {
    md += metaItems.join("\n\n") + "\n\n";
  }
  
  // Main image
  if (product.mainImage) {
    md += `![Product Image](${product.mainImage})\n\n`;
  }
  
  // Features
  if (product.features.length > 0) {
    md += `## Features\n\n`;
    for (const feature of product.features) {
      md += `- ${feature}\n`;
    }
    md += "\n";
  }
  
  // Description
  if (product.description) {
    md += `## Description\n\n`;
    md += product.description + "\n\n";
  }
  
  // Additional images (if any)
  if (product.images.length > 0) {
    md += `## Images\n\n`;
    const uniqueImages = [...new Set([product.mainImage, ...product.images])]
      .filter(Boolean) as string[];
    // Only show images that weren't already shown as main
    const additionalImages = uniqueImages.filter(img => img !== product.mainImage);
    for (const img of additionalImages.slice(0, 4)) { // Limit to 4 additional images
      md += `![Product Image](${img})\n`;
    }
    md += "\n";
  }
  
  return md;
}

/**
 * Generate a filename for the product note.
 */
export function generateAmazonFilename(product: AmazonProduct): string {
  if (!product.title) {
    return product.asin || "amazon-product";
  }
  
  // Sanitize title for filename
  let filename = product.title
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  
  // Add ASIN if available
  if (product.asin) {
    filename += `-${product.asin}`;
  }
  
  return filename;
}

// Register all Amazon templates
registerBuiltInTemplates([
  amazonTemplate,
  amazonUKTemplate,
  amazonDETemplate,
  amazonCATemplate,
  amazonGenericTemplate
]);
