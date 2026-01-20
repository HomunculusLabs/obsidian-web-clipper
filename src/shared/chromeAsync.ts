function rejectOnLastError(reject: (err: Error) => void): boolean {
  const lastError = chrome.runtime?.lastError;
  if (!lastError) return false;
  reject(new Error(lastError.message || "Chrome API error"));
  return true;
}

export function storageGet<T extends Record<string, unknown>>(
  keys: readonly (keyof T)[] | null
): Promise<Partial<T>> {
  return new Promise((resolve, reject) => {
    const chromeKeys = keys === null ? null : (keys as readonly string[]);
    chrome.storage.local.get(chromeKeys as any, (items) => {
      if (rejectOnLastError(reject)) return;
      resolve(items as Partial<T>);
    });
  });
}

export function storageSet<T extends Record<string, unknown>>(
  items: Partial<T>
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items as any, () => {
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
    chrome.tabs.sendMessage(tabId, message as any, (response) => {
      if (rejectOnLastError(reject)) return;
      resolve(response as TRes);
    });
  });
}

export function runtimeSendMessage<TReq, TRes>(
  message: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message as any, (response) => {
      if (rejectOnLastError(reject)) return;
      resolve(response as TRes);
    });
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