// Missing router state: evidence-gap router cases are NOT present

import type { RuntimeRequest } from "../shared/messages";
import { handleRefreshContradictionInbox } from "./handlers/refreshContradictionInbox";
// Missing: import { handleRefreshEvidenceGapInbox }
// Missing: import { handleRefreshEvidenceGapStateSync }

export async function dispatch(request: RuntimeRequest): Promise<unknown> {
  switch (request.action) {
    case "refreshContradictionInbox":
      return handleRefreshContradictionInbox(request);
    // Missing: case "refreshEvidenceGapInbox"
    // Missing: case "refreshEvidenceGapStateSync"
    default:
      throw new Error("Unknown action");
  }
}
