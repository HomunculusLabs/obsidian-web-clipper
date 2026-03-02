function rejectOnLastError(reject: (err: Error) => void): boolean {
  const lastError = chrome.runtime?.lastError;
  if (!lastError) return false;
  reject(new Error(lastError.message || "Chrome API error"));
  return true;
}

function isMissingReceiverMessage(message: string): boolean {
  return /receiving end does not exist|could not establish connection/i.test(message);
}

export function storageGet<T extends Record<string, unknown>>(
  keys: readonly (keyof T)[] | null
): Promise<Partial<T>> {
  return new Promise((resolve, reject) => {
    // Chrome API accepts string[] or null, not readonly arrays
    const chromeKeys: string[] | null = keys === null 
      ? null 
      : (keys as readonly string[]) as string[];
    chrome.storage.local.get(chromeKeys, (items) => {
      if (rejectOnLastError(reject)) return;
      resolve(items as Partial<T>);
    });
  });
}

export function storageSet<T extends Record<string, unknown>>(
  items: Partial<T>
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Cast to satisfy Chrome API - the types are compatible at runtime
    chrome.storage.local.set(items as Record<string, unknown>, () => {
      if (rejectOnLastError(reject)) return;
      resolve();
    });
  });
}

export function tabsQuery(
  queryInfo: chrome.tabs.QueryInfo
): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (rejectOnLastError(reject)) return;
      resolve(tabs);
    });
  });
}

export function tabsSendMessage<TReq, TRes>(
  tabId: number,
  message: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    const send = (attempt: number): void => {
      // Chrome messaging API accepts any serializable message
      chrome.tabs.sendMessage(tabId, message, (response: TRes) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          const errorMessage = lastError.message || "Chrome API error";
          if (attempt === 0 && isMissingReceiverMessage(errorMessage)) {
            setTimeout(() => send(attempt + 1), 80);
            return;
          }
          reject(new Error(errorMessage));
          return;
        }
        resolve(response);
      });
    };

    send(0);
  });
}

export function runtimeSendMessage<TReq, TRes>(
  message: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    const send = (attempt: number): void => {
      // Chrome messaging API accepts any serializable message
      chrome.runtime.sendMessage(message, (response: TRes) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          const errorMessage = lastError.message || "Chrome API error";
          if (attempt === 0 && isMissingReceiverMessage(errorMessage)) {
            setTimeout(() => send(attempt + 1), 80);
            return;
          }
          reject(new Error(errorMessage));
          return;
        }
        resolve(response);
      });
    };

    send(0);
  });
}

export function tabsCreate(
  createProperties: chrome.tabs.CreateProperties
): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      if (rejectOnLastError(reject)) return;
      resolve(tab);
    });
  });
}

export function scriptingExecuteScript<Args extends unknown[], Result>(
  injection: chrome.scripting.ScriptInjection<Args, Result>
): Promise<chrome.scripting.InjectionResult<Result>[]> {
  return new Promise((resolve, reject) => {
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      reject(new Error("chrome.scripting.executeScript is unavailable in this context"));
      return;
    }

    chrome.scripting.executeScript(injection, (results) => {
      if (rejectOnLastError(reject)) return;
      resolve((results || []) as chrome.scripting.InjectionResult<Result>[]);
    });
  });
}