// Missing state: No knowledge-revalidation router cases

import { handleRefreshContradictionInbox } from "./handlers/refreshContradictionInbox";

export async function dispatch(request: RuntimeRequest): Promise<unknown> {
  switch (request.action) {
    case "refreshContradictionInbox":
      return handleRefreshContradictionInbox(request);
    case "testNativeHost":
      return handleTestNativeHost(request);
    default: {
      const _exhaustive: never = request;
      throw new Error(`Unknown action: ${(_exhaustive as { action: string }).action}`);
    }
  }
}
