// PDF extraction - delegates to background service worker
import type { ExtractPdfResponse } from "./messages";

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
  console.log("[PDF] Requesting extraction from background:", url);

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
          console.error("[PDF] chrome.runtime.lastError:", chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message || "Failed to extract PDF"));
          return;
        }
        if (!response) {
          console.error("[PDF] No response from background");
          reject(new Error("No response from background worker"));
          return;
        }
        if (!response.success) {
          console.error("[PDF] Extraction failed:", response.error);
          reject(new Error(response.error || "Failed to extract PDF"));
          return;
        }
        console.log("[PDF] Extraction complete. Pages:", response.pageCount);
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
