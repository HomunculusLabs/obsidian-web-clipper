/* eslint-disable */
import { isTabRequest } from "../shared/guards";
import { clipPage, getPageInfo } from "./clipper";
import { initChatGPTInjector } from "./chatgpt/injector";

import type { PageInfo, TabResponse } from "../shared/messages";

// Listen for messages from popup and background and delegate to clipper
chrome.runtime.onMessage.addListener(
  (request: unknown, _sender: chrome.runtime.MessageSender, sendResponse) => {
    if (!isTabRequest(request)) return false;

    if (request.action === "clip") {
      void clipPage(request).then((response: TabResponse) => sendResponse(response));
      return true;
    }

    if (request.action === "getPageInfo") {
      const response: PageInfo = getPageInfo();
      sendResponse(response);
      return true;
    }

    return false;
  }
);

// Initialize ChatGPT clip button injector
initChatGPTInjector();