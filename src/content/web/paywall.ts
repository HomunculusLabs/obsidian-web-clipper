export type ReadabilityArticleLike =
  | {
      title?: string;
      content?: string;
      textContent?: string;
      excerpt?: string;
      byline?: string;
      publishedTime?: string | null;
    }
  | null;

// Check if content appears to be paywalled
export function isPaywalled(
  article: ReadabilityArticleLike,
  documentClone: Document
): boolean {
  if (!article || !article.content) {
    return true;
  }

  // Check content length - very short content may indicate paywall
  const textContent = article.textContent || "";
  const textLength = textContent.trim().length;

  // Check for common paywall indicators
  const bodyText = documentClone.body?.textContent || "";
  const paywallIndicators = [
    "subscribe",
    "subscription",
    "premium",
    "paywall",
    "limited access",
    "create an account",
    "sign in to continue",
    "free trial",
    "upgrade to read",
    "member exclusive",
    "premium content"
  ];

  // Check if page has many paywall indicators
  let paywallSignCount = 0;
  const lowerBodyText = bodyText.toLowerCase();
  for (const indicator of paywallIndicators) {
    if (lowerBodyText.includes(indicator)) {
      paywallSignCount++;
    }
  }

  // Short content with paywall indicators
  if (textLength < 500 && paywallSignCount >= 2) {
    return true;
  }

  // Content significantly shorter than total page text
  if (bodyText.length > 2000 && textLength < bodyText.length * 0.1) {
    return true;
  }

  return false;
}

// Extract visible content as fallback for paywalled pages
export function extractVisibleContent(): string {
  // Get main content areas
  const selectors = [
    "main",
    "article",
    '[role="main"]',
    ".content",
    ".article-content",
    ".post-content",
    ".entry-content",
    "#content",
    "main p"
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const paragraphs = element.querySelectorAll(
        "p, h1, h2, h3, h4, h5, h6"
      );
      if (paragraphs.length > 2) {
        const content = Array.from(paragraphs)
          .map((p) => (p.textContent || "").trim())
          .filter((text) => text.length > 0)
          .join("\n\n");
        if (content.length > 200) {
          return content;
        }
      }
    }
  }

  // Last resort: get visible paragraphs from body
  const allParagraphs = document.querySelectorAll("body p");
  const visibleContent = Array.from(allParagraphs)
    .map((p) => (p.textContent || "").trim())
    .filter((text) => text.length > 50)
    .slice(0, 20) // Limit to first 20 paragraphs
    .join("\n\n");

  return visibleContent || "No extractable content found.";
}