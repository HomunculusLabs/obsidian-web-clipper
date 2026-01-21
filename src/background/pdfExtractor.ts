// PDF extraction via offscreen document
// Service workers can't run PDF.js directly (no DOM), so we delegate to offscreen

export type PdfExtractResult = {
  text: string;
  pageCount: number;
  truncated: boolean;
  hasTextLayer: boolean;
};

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL("offscreen/offscreen.html");

  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // Avoid race condition if multiple calls happen simultaneously
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: "PDF.js requires DOM access for web worker setup"
  });

  await creatingOffscreen;
  creatingOffscreen = null;
}

export async function extractPdfFromUrl(
  url: string,
  maxPages = 200,
  maxChars = 120000
): Promise<PdfExtractResult> {
  console.log("[PDF Background] Delegating to offscreen document:", url);

  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    type: "extract-pdf",
    url,
    maxPages,
    maxChars
  });

  if (!response.success) {
    throw new Error(response.error || "PDF extraction failed");
  }

  return response.result;
}
