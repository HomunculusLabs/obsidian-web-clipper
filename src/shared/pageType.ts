import type { PageType } from "./types";

export const YOUTUBE_URL_RE = /^https?:\/\/(www\.)?youtube\.com\/watch/;
export const YOUTUBE_SHORTS_RE = /^https?:\/\/(www\.)?youtube\.com\/shorts/;
export const PDF_URL_RE = /^https?:\/\/.*\.pdf(\?|$)/i;
export const TWITTER_URL_RE =
  /^https?:\/\/(www\.|mobile\.)?(twitter|x)\.com\//;

export function isYouTubeUrl(url: string): boolean {
  return YOUTUBE_URL_RE.test(url) || YOUTUBE_SHORTS_RE.test(url);
}

export function isPdfUrl(url: string): boolean {
  return PDF_URL_RE.test(url);
}

export function isTwitterUrl(url: string): boolean {
  return TWITTER_URL_RE.test(url);
}

export function detectPageType(url: string, contentType?: string): PageType {
  // Twitter/X
  if (isTwitterUrl(url)) {
    return "twitter";
  }

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