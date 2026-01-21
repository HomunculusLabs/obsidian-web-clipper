export type PageType = "web" | "youtube" | "pdf";

export type ClipContentType = "article" | "video" | "document";

export type YouTubeVideoType =
  | "normal"
  | "shorts"
  | "live"
  | "age-restricted"
  | "unavailable";

export interface ClipMetadata {
  url: string;
  title: string;
  type: ClipContentType;

  author?: string;
  publishedDate?: string;
  description?: string;

  channel?: string;
  duration?: string;
  videoType?: YouTubeVideoType;

  paywalled?: boolean;

  pdfPageCount?: number;
  pdfHasTextLayer?: boolean;

  passwordProtected?: boolean;
  scannedPDF?: boolean;
  truncated?: boolean;
}

export interface ClipResult {
  url: string;
  title: string;
  markdown: string;
  metadata: ClipMetadata;
  error?: string;
}