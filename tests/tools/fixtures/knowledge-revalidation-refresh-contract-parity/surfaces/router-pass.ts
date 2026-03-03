// Pass state: All router cases present

import { handleRefreshContradictionInbox } from "./handlers/refreshContradictionInbox";
import { handleRefreshKnowledgeRevalidationInbox } from "./handlers/refreshKnowledgeRevalidationInbox";
import { handleRefreshKnowledgeRevalidationStateSync } from "./handlers/refreshKnowledgeRevalidationStateSync";

export async function dispatch(request: RuntimeRequest): Promise<unknown> {
  switch (request.action) {
    case "refreshContradictionInbox":
      return handleRefreshContradictionInbox(request);
    case "refreshKnowledgeRevalidationInbox":
      return handleRefreshKnowledgeRevalidationInbox(request);
    case "refreshKnowledgeRevalidationStateSync":
      return handleRefreshKnowledgeRevalidationStateSync(request);
    case "testNativeHost":
      return handleTestNativeHost(request);
    default: {
      const _exhaustive: never = request;
      throw new Error(`Unknown action: ${(_exhaustive as { action: string }).action}`);
    }
  }
}
