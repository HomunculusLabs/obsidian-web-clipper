import { isRecord } from "./errors";

import type { RuntimeRequest, TabRequest, TabResponse } from "./messages";
import type { ClipResult } from "./types";

export function isTabRequest(value: unknown): value is TabRequest {
  if (!isRecord(value)) return false;
  const action = value.action;
  return action === "clip" || action === "getPageInfo";
}

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!isRecord(value)) return false;
  const action = value.action;
  return (
    action === "getSettings" ||
    action === "copyToClipboard" ||
    action === "openObsidianUri" ||
    action === "extractPdf"
  );
}

export function isTabResponse(value: unknown): value is TabResponse {
  if (!isRecord(value)) return false;
  return "ok" in value;
}

export function isClipResult(value: unknown): value is ClipResult {
  if (!isRecord(value)) return false;
  return "url" in value && "title" in value && "markdown" in value;
}