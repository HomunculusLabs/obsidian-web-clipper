// Pass state: All router wiring present for markitdown priority brief

import type { RuntimeRequest } from "../shared/messages";
import { handleRefreshContradictionInbox } from "./handlers/refreshContradictionInbox";
import { handleRefreshMarkitdownConversionPriorityBrief } from "./handlers/refreshMarkitdownConversionPriorityBrief";

export async function dispatch(request: RuntimeRequest): Promise<unknown> {
  switch (request.action) {
    case "refreshContradictionInbox":
      return handleRefreshContradictionInbox(request);
    case "refreshMarkitdownConversionPriorityBrief":
      return handleRefreshMarkitdownConversionPriorityBrief(request);
    default:
      throw new Error("Unknown action");
  }
}
