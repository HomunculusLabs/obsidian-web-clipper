export function sanitizeFilename(name: string, maxLen: number = 100): string {
  const raw = (name || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[<>:"/\\\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const fallback = raw.length > 0 ? raw : "Untitled";

  const trimmed = fallback.substring(0, Math.max(1, maxLen)).trim();

  return trimmed.length > 0 ? trimmed : "Untitled";
}