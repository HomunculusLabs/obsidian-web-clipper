// Pass state: All router wiring present

import type { RuntimeRequest } from "../shared/messages";
import { handleRefreshContradictionInbox } from "./handlers/refreshContradictionInbox";
import { handleRefreshEvidenceGapInbox } from "./handlers/refreshEvidenceGapInbox";
import { handleRefreshEvidenceGapStateSync } from "./handlers/refreshEvidenceGapStateSync";

export async function dispatch(request: RuntimeRequest): Promise<unknown> {
  switch (request.action) {
    case "refreshContradictionInbox":
      return handleRefreshContradictionInbox(request);
    case "refreshEvidenceGapInbox":
      return handleRefreshEvidenceGapInbox(request);
    case "refreshEvidenceGapStateSync":
      return handleRefreshEvidenceGapStateSync(request);
    default:
      throw new Error("Unknown action");
  }
}
