/* eslint-disable */
import { isTabRequest } from "../shared/guards";
import { clipPage, getPageInfo, getTemplateInfo } from "./clipper";
import { getSelection } from "./selection";
import { initChatGPTInjector } from "./chatgpt/injector";

import type { PageInfo, SelectionInfo, TabResponse, TemplateInfo } from "../shared/messages";

/** Max chars for selection preview */
const SELECTION_PREVIEW_MAX = 100;

// Listen for messages from popup and background and delegate to clipper
chrome.runtime.onMessage.addListener(
  (request: unknown, _sender: chrome.runtime.MessageSender, sendResponse) => {
    if (!isTabRequest(request)) return false;

    switch (request.action) {
      case "clip":
        void clipPage(request).then((response: TabResponse) => sendResponse(response));
        return true;
      case "getPageInfo": {
        const response: PageInfo = getPageInfo();
        sendResponse(response);
        return true;
      }
      case "getSelectionInfo": {
        const sel = getSelection();
        const preview = sel.text.length > SELECTION_PREVIEW_MAX
          ? sel.text.slice(0, SELECTION_PREVIEW_MAX) + "..."
          : sel.text;
        const response: SelectionInfo = {
          hasSelection: sel.hasSelection,
          preview
        };
        sendResponse(response);
        return true;
      }
      case "getTemplateInfo": {
        const response: TemplateInfo = getTemplateInfo(request.settings);
        sendResponse(response);
        return true;
      }
      default: {
        // Exhaustive check: this will fail to compile if any TabRequest action is missing
        const _exhaustive: never = request;
        console.error("Unhandled TabRequest action:", (_exhaustive as { action: string }).action);
        return false;
      }
    }
  }
);

// Initialize ChatGPT clip button injector
initChatGPTInjector();