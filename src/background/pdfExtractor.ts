// PDF extraction via offscreen document
// Service workers can't run PDF.js directly (no DOM), so we delegate to offscreen

import type { PdfOffscreenRequest, PdfOffscreenResponse } from "../shared/pdfOffscreenMessages";
import { ExtractionError } from "../shared/errors";
import { debug } from "../shared/debug";

export type PdfExtractResult = {
  text: string;
  pageCount: number;
  truncated: boolean;
  hasTextLayer: boolean;
};

type OffscreenApi = {
  createDocument?: (options: {
    url: string;
    reasons: string[];
    justification: string;
  }) => Promise<void>;
  Reason?: {
    DOM_PARSER?: string;
  };
};

let creatingOffscreen: Promise<void> | null = null;

function getOffscreenApi(): OffscreenApi | undefined {
  return (chrome as unknown as Record<string, unknown>)["offscreen"] as OffscreenApi | undefined;
}

function supportsOffscreenPdfExtraction(): boolean {
  const offscreen = getOffscreenApi();
  return (
    typeof offscreen?.createDocument === "function" &&
    typeof chrome.runtime.getContexts === "function" &&
    typeof chrome.runtime.ContextType?.OFFSCREEN_DOCUMENT === "string"
  );
}

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

  const offscreen = getOffscreenApi();
  if (!offscreen?.createDocument || !offscreen.Reason?.DOM_PARSER) {
    throw new ExtractionError(
      "PDF extraction is not available in this browser build yet",
      "PDF_EXTRACTION_FAILED"
    );
  }

  creatingOffscreen = offscreen.createDocument({
    url: offscreenUrl,
    reasons: [offscreen.Reason.DOM_PARSER],
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
  debug("PDF Background", "Delegating to offscreen document:", url);

  if (!supportsOffscreenPdfExtraction()) {
    throw new ExtractionError(
      "PDF extraction is not available in this browser build yet",
      "PDF_EXTRACTION_FAILED"
    );
  }

  await ensureOffscreenDocument();

  const request: PdfOffscreenRequest = {
    type: "extract-pdf",
    url,
    maxPages,
    maxChars
  };

  const rawResponse = await chrome.runtime.sendMessage(request);
  const response = rawResponse as PdfOffscreenResponse;

  if (!response.success) {
    throw new ExtractionError(response.error || "PDF extraction failed", "PDF_EXTRACTION_FAILED");
  }

  return {
    text: response.text,
    pageCount: response.pageCount,
    truncated: response.truncated,
    hasTextLayer: response.hasTextLayer
  };
}
