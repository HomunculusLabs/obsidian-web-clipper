// Missing router state: markitdown priority brief router wiring is NOT present

import type { RuntimeRequest } from "../shared/messages";
import { handleRefreshContradictionInbox } from "./handlers/refreshContradictionInbox";
// Missing: import for handleRefreshMarkitdownConversionPriorityBrief

export async function dispatch(request: RuntimeRequest): Promise<unknown> {
  switch (request.action) {
    case "refreshContradictionInbox":
      return handleRefreshContradictionInbox(request);
    // Missing: case "refreshMarkitdownConversionPriorityBrief"
    default:
      throw new Error("Unknown action");
  }
}
