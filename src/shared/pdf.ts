// PDF extraction - delegates to background service worker
import type { ExtractPdfResponse } from "./messages";
import { debug } from "./debug";

export type PdfExtractOptions = {
  maxPages?: number;
  maxChars?: number;
  includePageHeadings?: boolean;
};

export type PdfExtractResult = {
  text: string;
  pageCount: number;
  truncated: boolean;
  hasTextLayer: boolean;
};

export async function extractPdfTextFromUrl(
  url: string,
  options?: PdfExtractOptions
): Promise<PdfExtractResult> {
  debug("PDF", "Requesting extraction from background:", url);

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "extractPdf",
        url,
        maxPages: options?.maxPages ?? 200,
        maxChars: options?.maxChars ?? 120000
      },
      (response: ExtractPdfResponse) => {
        if (chrome.runtime.lastError) {
          debug("PDF", "chrome.runtime.lastError:", chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message || "Failed to extract PDF"));
          return;
        }
        if (!response) {
          debug("PDF", "No response from background");
          reject(new Error("No response from background worker"));
          return;
        }
        if (!response.success) {
          debug("PDF", "Extraction failed:", response.error);
          reject(new Error(response.error || "Failed to extract PDF"));
          return;
        }
        debug("PDF", "Extraction complete. Pages:", response.pageCount);
        resolve({
          text: response.text,
          pageCount: response.pageCount,
          truncated: response.truncated,
          hasTextLayer: response.hasTextLayer
        });
      }
    );
  });
}
