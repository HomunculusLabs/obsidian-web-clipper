import type { PageType } from "./types";

export const YOUTUBE_URL_RE = /^https?:\/\/(www\.)?youtube\.com\/watch/;
export const YOUTUBE_SHORTS_RE = /^https?:\/\/(www\.)?youtube\.com\/shorts/;
export const PDF_URL_RE = /^https?:\/\/.*\.pdf(\?|$)/i;

export function isYouTubeUrl(url: string): boolean {
  return YOUTUBE_URL_RE.test(url) || YOUTUBE_SHORTS_RE.test(url);
}

export function isPdfUrl(url: string): boolean {
  return PDF_URL_RE.test(url);
}

export function detectPageType(url: string, contentType?: string): PageType {
  // YouTube
  if (isYouTubeUrl(url)) {
    return "youtube";
  }

  // PDF
  if (isPdfUrl(url) || contentType === "application/pdf") {
    return "pdf";
  }

  // Default to web page
  return "web";
}