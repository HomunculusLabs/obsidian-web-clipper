export type PdfOffscreenRequest = {
  type: "extract-pdf";
  url: string;
  maxPages?: number;
  maxChars?: number;
  includePageHeadings?: boolean;
};

export type PdfOffscreenResponse =
  | { success: true; text: string; pageCount: number; truncated: boolean; hasTextLayer: boolean }
  | { success: false; error: string };