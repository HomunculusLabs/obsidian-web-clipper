import { isRecord } from "./errors";

import type { RuntimeRequest, TabRequest, TabResponse } from "./messages";
import type { ClipResult } from "./types";

// All valid TabRequest actions for type guard
const TAB_REQUEST_ACTIONS = ["clip", "getPageInfo", "getSelectionInfo", "getTemplateInfo"] as const;

export function isTabRequest(value: unknown): value is TabRequest {
  if (!isRecord(value)) return false;
  const action = value.action;
  return typeof action === "string" && TAB_REQUEST_ACTIONS.includes(action as typeof TAB_REQUEST_ACTIONS[number]);
}

// All valid RuntimeRequest actions for type guard
const RUNTIME_REQUEST_ACTIONS = [
  "getSettings",
  "copyToClipboard",
  "openObsidianUri",
  "extractPdf",
  "testCliConnection",
  "detectCli",
  "saveToCli",
  "saveAttachmentToCli",
  "listVaultFolders",
  "createVaultFolder",
  "saveContent",
  "testNativeHost"
] as const;

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!isRecord(value)) return false;
  const action = value.action;
  return typeof action === "string" && RUNTIME_REQUEST_ACTIONS.includes(action as typeof RUNTIME_REQUEST_ACTIONS[number]);
}

export function isTabResponse(value: unknown): value is TabResponse {
  if (!isRecord(value)) return false;
  return "ok" in value;
}

export function isClipResult(value: unknown): value is ClipResult {
  if (!isRecord(value)) return false;
  return "url" in value && "title" in value && "markdown" in value;
}