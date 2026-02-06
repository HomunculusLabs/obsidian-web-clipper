import { extractPdfFromUrl } from "../pdfExtractor";
import { toErrorMessage } from "../../shared/errors";
import type { RuntimeRequest, ExtractPdfResponse } from "../../shared/messages";

type ExtractPdfRequest = Extract<RuntimeRequest, { action: "extractPdf" }>;

export async function handleExtractPdf(request: ExtractPdfRequest): Promise<ExtractPdfResponse> {
  try {
    const result = await extractPdfFromUrl(request.url, request.maxPages ?? 200, request.maxChars ?? 120000);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to extract PDF") };
  }
}