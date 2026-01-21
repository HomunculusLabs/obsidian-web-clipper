// Offscreen document for PDF.js processing
// This runs in a hidden document context with DOM access
import * as pdfjs from "pdfjs-dist";

// Set worker path - offscreen documents have document access
pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdfjs/pdf.worker.js");

type PdfExtractResult = {
  text: string;
  pageCount: number;
  truncated: boolean;
  hasTextLayer: boolean;
};

function extractTextFromTextContent(textContent: unknown): string {
  const items = (textContent as any)?.items;
  if (!Array.isArray(items)) return "";

  const lines: string[] = [];
  let currentLine = "";

  for (const item of items) {
    const str = typeof item?.str === "string" ? item.str : "";
    const hasEOL = item?.hasEOL === true;

    if (str) {
      currentLine += str;
    }

    if (hasEOL) {
      const cleaned = currentLine.replace(/\s+/g, " ").trim();
      if (cleaned) lines.push(cleaned);
      currentLine = "";
      continue;
    }

    if (str) {
      currentLine += " ";
    }
  }

  const cleaned = currentLine.replace(/\s+/g, " ").trim();
  if (cleaned) lines.push(cleaned);

  return lines.join("\n");
}

async function extractPdf(
  url: string,
  maxPages: number,
  maxChars: number
): Promise<PdfExtractResult> {
  console.log("[PDF Offscreen] Fetching PDF:", url);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const data = new Uint8Array(buffer);
  console.log("[PDF Offscreen] Got", data.length, "bytes");

  const loadingTask = pdfjs.getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false
  });

  try {
    console.log("[PDF Offscreen] Parsing PDF...");
    const pdf = await loadingTask.promise;
    const pageCount: number = pdf.numPages || 0;
    const pageLimit = Math.min(pageCount, maxPages);
    console.log("[PDF Offscreen] PDF has", pageCount, "pages");

    let text = "";
    let truncated = false;
    let hasTextLayer = false;
    let remaining = maxChars;

    const append = (chunk: string) => {
      if (!chunk || truncated) return;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      if (chunk.length <= remaining) {
        text += chunk;
        remaining -= chunk.length;
        return;
      }
      text += chunk.slice(0, remaining);
      remaining = 0;
      truncated = true;
    };

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
      if (truncated) break;

      const page = await pdf.getPage(pageNumber);
      try {
        const textContent = await page.getTextContent();
        const pageText = extractTextFromTextContent(textContent);

        if (!pageText.trim()) {
          continue;
        }

        hasTextLayer = true;
        append(`## Page ${pageNumber}\n\n`);
        append(pageText);
        append("\n\n");
      } finally {
        try {
          page.cleanup();
        } catch {}
      }
    }

    if (pageCount > maxPages) {
      truncated = true;
    }

    console.log("[PDF Offscreen] Extraction complete. hasTextLayer:", hasTextLayer);
    return {
      text: text.trimEnd(),
      pageCount,
      truncated,
      hasTextLayer
    };
  } finally {
    try {
      loadingTask.destroy();
    } catch {}
  }
}

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "extract-pdf") return false;

  const { url, maxPages = 200, maxChars = 120000 } = message;

  extractPdf(url, maxPages, maxChars)
    .then((result) => {
      sendResponse({ success: true, result });
    })
    .catch((error) => {
      console.error("[PDF Offscreen] Error:", error);
      sendResponse({ success: false, error: error.message });
    });

  return true; // Keep channel open for async response
});
