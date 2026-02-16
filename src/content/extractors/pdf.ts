import { extractPdfTextFromUrl } from "../../shared/pdf";
import { toErrorMessage } from "../../shared/errors";
import { debug } from "../../shared/debug";

import type { ClipResult } from "../../shared/types";

// Extract PDF content using PDF.js (delegates to background)
export async function extractPDFContent(result: ClipResult): Promise<ClipResult> {
  result.metadata.type = "document";
  debug("PDF", "extractPDFContent called");
  debug("PDF", "result.url:", result.url);
  debug("PDF", "window.location.href:", window.location.href);
  debug("PDF", "document.contentType:", document.contentType);

  try {
    debug("PDF", "Calling extractPdfTextFromUrl...");
    const { text, pageCount, truncated, hasTextLayer } =
      await extractPdfTextFromUrl(result.url, {
        maxPages: 200,
        maxChars: 120000,
        includePageHeadings: true
      });
    debug(
      "PDF",
      "Extraction complete. Pages:",
      pageCount,
      "hasTextLayer:",
      hasTextLayer
    );

    result.metadata.pdfPageCount = pageCount;
    result.metadata.pdfHasTextLayer = hasTextLayer;
    result.metadata.truncated = truncated || result.metadata.truncated;

    if (!hasTextLayer) {
      result.metadata.scannedPDF = true;
      result.markdown =
        `# ${result.title}\n\n` +
        `> ⚠️ **No selectable text found in this PDF.**\n\n` +
        `This PDF may be scanned or image-based. Try OCR, or download the file and extract text with an OCR-capable tool.\n\n` +
        `**Source:** ${result.url}`;
      return result;
    }

    const truncatedNote = truncated
      ? `> ⚠️ **Note:** Extracted text was truncated to keep the clip size reasonable.\n\n`
      : "";

    result.markdown = `# ${result.title}\n\n${truncatedNote}${text || ""}`.trimEnd();
    return result;
  } catch (error) {
    const message = toErrorMessage(error);
    if (message.toLowerCase().includes("password")) {
      result.metadata.passwordProtected = true;
      result.markdown =
        `# ${result.title}\n\n` +
        `> ⚠️ **This PDF is password-protected.**\n\n` +
        `Text extraction requires a password and is not available without unlocking the PDF.\n\n` +
        `**Source:** ${result.url}`;
      return result;
    }

    throw error;
  }
}