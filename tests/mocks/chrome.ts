/**
 * Chrome Extension API Mocks for Testing
 *
 * Provides comprehensive mocks for Chrome extension APIs used throughout
 * the codebase. Import and call setupChromeMocks() before each test.
 *
 * Usage:
 * ```ts
 * import { describe, test, expect, beforeEach } from "bun:test";
 * import { setupChromeMocks, mockChrome } from "../mocks/chrome";
 *
 * describe("My test", () => {
 *   beforeEach(() => {
 *     setupChromeMocks();
 *   });
 *
 *   test("uses chrome API", async () => {
 *     mockChrome.storage.local.data.set({ myKey: "value" });
 *     const result = await chrome.storage.local.get("myKey");
 *     expect(result.myKey).toBe("value");
 *   });
 * });
 * ```
 */

import { mock } from "bun:test";

/**
 * Mock function type with tracking capabilities
 */
interface MockFn<T extends (...args: unknown[]) => unknown> {
  (...args: Parameters<T>): ReturnType<T>;
  mock: {
    calls: unknown[][];
    callCount: number;
    results: unknown[];
  };
  mockReturnValue(value: ReturnType<T>): MockFn<T>;
  mockResolvedValue(value: Awaited<ReturnType<T>>): MockFn<T>;
  mockImplementation(impl: T): MockFn<T>;
  mockClear(): void;
}

/**
 * Create a tracked mock function
 */
function createMockFn<T extends (...args: unknown[]) => unknown>(implementation?: T): MockFn<T> {
  const calls: unknown[][] = [];
  const results: unknown[] = [];
  let currentImpl = implementation;

  const fn = ((...args: Parameters<T>) => {
    calls.push(args);
    if (currentImpl) {
      const result = currentImpl(...args);
      results.push(result);
      return result;
    }
    results.push(undefined);
    return undefined;
  }) as MockFn<T>;

  fn.mock = {
    get calls() { return calls; },
    get callCount() { return calls.length; },
    get results() { return results; },
  };

  fn.mockReturnValue = (value: ReturnType<T>) => {
    currentImpl = (() => value) as T;
    return fn;
  };

  fn.mockResolvedValue = (value: Awaited<ReturnType<T>>) => {
    currentImpl = (() => Promise.resolve(value)) as T;
    return fn;
  };

  fn.mockImplementation = (impl: T) => {
    currentImpl = impl;
    return fn;
  };

  fn.mockClear = () => {
    calls.length = 0;
    results.length = 0;
  };

  return fn;
}

/**
 * Create a mock storage area that mimics chrome.storage behavior
 */
function createMockStorageArea() {
  const data = new Map<string, unknown>();

  return {
    /** The underlying Map storage for direct manipulation in tests */
    data,

    /** Directly set values for test setup (convenience method) */
    setValues(values: Record<string, unknown>) {
      for (const [key, value] of Object.entries(values)) {
        data.set(key, value);
      }
    },

    /** Get data from storage */
    get: createMockFn((keys?: string | string[] | null, callback?: (items: Record<string, unknown>) => void) => {
      const result: Record<string, unknown> = {};

      if (keys === null || keys === undefined) {
        // Return all data
        for (const [key, value] of data.entries()) {
          result[key] = value;
        }
      } else if (typeof keys === "string") {
        if (data.has(keys)) {
          result[keys] = data.get(keys);
        }
      } else if (Array.isArray(keys)) {
        for (const key of keys) {
          if (data.has(key)) {
            result[key] = data.get(key);
          }
        }
      }

      if (callback) {
        callback(result);
      }
      return Promise.resolve(result);
    }),

    /** Set data in storage */
    set: createMockFn((items: Record<string, unknown>, callback?: () => void) => {
      for (const [key, value] of Object.entries(items)) {
        data.set(key, value);
      }
      if (callback) {
        callback();
      }
      return Promise.resolve();
    }),

    /** Remove data from storage */
    remove: createMockFn((keys: string | string[], callback?: () => void) => {
      const keysArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keysArray) {
        data.delete(key);
      }
      if (callback) {
        callback();
      }
      return Promise.resolve();
    }),

    /** Clear all data from storage */
    clear: createMockFn((callback?: () => void) => {
      data.clear();
      if (callback) {
        callback();
      }
      return Promise.resolve();
    }),

    /** Get storage usage and quota */
    getBytesInUse: createMockFn((keys?: string | string[] | null, callback?: (bytesInUse: number) => void) => {
      let size = 0;
      const keysToCheck = keys === null || keys === undefined
        ? Array.from(data.keys())
        : typeof keys === "string"
          ? [keys]
          : keys;

      for (const key of keysToCheck) {
        const value = data.get(key);
        if (value !== undefined) {
          size += JSON.stringify({ [key]: value }).length;
        }
      }

      if (callback) {
        callback(size);
      }
      return Promise.resolve(size);
    }),
  };
}

type MockStorageArea = ReturnType<typeof createMockStorageArea>;

/**
 * Create mock runtime API
 */
function createMockRuntime() {
  const messageListeners: Array<(message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => boolean | void> = [];
  const installedListeners: Array<(details: chrome.runtime.InstalledDetails) => void> = [];
  const urls = new Map<string, string>();

  return {
    lastError: undefined as chrome.runtime.LastError | undefined,

    /** URL mapping for extension resources */
    urls,

    /** Register a URL mapping for getURL */
    setUrl(path: string, url: string) {
      urls.set(path, url);
    },

    /** Get extension URL */
    getURL: createMockFn((path: string) => {
      if (urls.has(path)) {
        return urls.get(path)!;
      }
      return `chrome-extension://mock-extension-id/${path}`;
    }),

    /** Send message to extension */
    sendMessage: createMockFn(<TRes = unknown>(
      message: unknown,
      callbackOrOptions?: ((response: TRes) => void) | chrome.runtime.SendMessageOptions
    ): Promise<TRes> | void => {
      let callback: ((response: TRes) => void) | undefined;
      if (typeof callbackOrOptions === "function") {
        callback = callbackOrOptions;
      }

      // Default: resolve with undefined
      const response = undefined as TRes;
      if (callback) {
        callback(response);
        return undefined;
      }
      return Promise.resolve(response);
    }),

    /** Listen for messages */
    onMessage: {
      addListener: createMockFn((callback: (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean | void) => {
        messageListeners.push(callback);
      }),
      removeListener: createMockFn((callback: typeof messageListeners[0]) => {
        const index = messageListeners.indexOf(callback);
        if (index > -1) {
          messageListeners.splice(index, 1);
        }
      }),
      hasListener: createMockFn((callback: typeof messageListeners[0]) => {
        return messageListeners.includes(callback);
      }),
      /** Simulate receiving a message (for testing) */
      _emit: (message: unknown, sender?: chrome.runtime.MessageSender): Promise<unknown> => {
        return new Promise((resolve) => {
          let resolved = false;
          for (const listener of messageListeners) {
            const result = listener(message, sender || {}, (response) => {
              if (!resolved) {
                resolved = true;
                resolve(response);
              }
            });
            if (result === true) {
              // Listener wants to send response async
            }
          }
          if (!resolved) {
            resolve(undefined);
          }
        });
      },
    },

    /** Listen for extension install/update */
    onInstalled: {
      addListener: createMockFn((callback: (details: chrome.runtime.InstalledDetails) => void) => {
        installedListeners.push(callback);
      }),
      removeListener: createMockFn((callback: typeof installedListeners[0]) => {
        const index = installedListeners.indexOf(callback);
        if (index > -1) {
          installedListeners.splice(index, 1);
        }
      }),
      /** Simulate install event (for testing) */
      _emit: (details: chrome.runtime.InstalledDetails) => {
        for (const listener of installedListeners) {
          listener(details);
        }
      },
    },

    /** Open options page */
    openOptionsPage: createMockFn(() => Promise.resolve()),

    /** Get available contexts */
    getContexts: createMockFn((_filter: chrome.runtime.ContextFilter) => Promise.resolve([])),

    /** Context types enum */
    ContextType: {
      OFFSCREEN_DOCUMENT: "offscreen_document",
    } as const,
  };
}

type MockRuntime = ReturnType<typeof createMockRuntime>;

/**
 * Create mock tabs API
 */
function createMockTabs() {
  const mockTabs = new Map<number, chrome.tabs.Tab>();
  let nextTabId = 1;

  return {
    /** Mock tab storage */
    tabs: mockTabs,

    /** Add a mock tab for testing */
    addTab(tab: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
      const id = tab.id ?? nextTabId++;
      const fullTab: chrome.tabs.Tab = {
        id,
        index: tab.index ?? 0,
        windowId: tab.windowId ?? 1,
        active: tab.active ?? true,
        highlighted: tab.highlighted ?? true,
        pinned: tab.pinned ?? false,
        incognito: tab.incognito ?? false,
        url: tab.url ?? "https://example.com",
        title: tab.title ?? "Test Page",
        status: tab.status ?? "complete",
        ...tab,
      };
      mockTabs.set(id, fullTab);
      return fullTab;
    },

    /** Query tabs */
    query: createMockFn((queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> => {
      const results: chrome.tabs.Tab[] = [];
      for (const tab of mockTabs.values()) {
        let matches = true;
        if (queryInfo.active !== undefined && tab.active !== queryInfo.active) {
          matches = false;
        }
        if (queryInfo.url !== undefined && tab.url !== queryInfo.url) {
          matches = false;
        }
        if (queryInfo.status !== undefined && tab.status !== queryInfo.status) {
          matches = false;
        }
        if (matches) {
          results.push(tab);
        }
      }
      return Promise.resolve(results);
    }),

    /** Get tab by ID */
    get: createMockFn((tabId: number): Promise<chrome.tabs.Tab> => {
      const tab = mockTabs.get(tabId);
      if (!tab) {
        return Promise.reject(new Error(`Tab ${tabId} not found`));
      }
      return Promise.resolve(tab);
    }),

    /** Create a new tab */
    create: createMockFn((createProperties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> => {
      const tab = {
        id: nextTabId++,
        index: 0,
        windowId: createProperties.windowId ?? 1,
        active: createProperties.active ?? true,
        highlighted: createProperties.active ?? true,
        pinned: false,
        incognito: false,
        url: createProperties.url ?? "about:blank",
        title: "New Tab",
        status: "loading",
      };
      mockTabs.set(tab.id, tab);
      return Promise.resolve(tab);
    }),

    /** Send message to tab */
    sendMessage: createMockFn(<TRes = unknown>(
      tabId: number,
      message: unknown,
      optionsOrCallback?: chrome.tabs.MessageSendOptions | ((response: TRes) => void),
      callback?: (response: TRes) => void
    ): Promise<TRes> | void => {
      let cb: ((response: TRes) => void) | undefined;
      if (typeof optionsOrCallback === "function") {
        cb = optionsOrCallback;
      } else if (callback) {
        cb = callback;
      }

      // Default: resolve with undefined
      const response = undefined as TRes;
      if (cb) {
        cb(response);
        return undefined;
      }
      return Promise.resolve(response);
    }),

    /** Update tab */
    update: createMockFn((tabId: number, updateProperties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab> => {
      const tab = mockTabs.get(tabId);
      if (!tab) {
        return Promise.reject(new Error(`Tab ${tabId} not found`));
      }
      Object.assign(tab, updateProperties);
      return Promise.resolve(tab);
    }),

    /** Remove tab */
    remove: createMockFn((tabIds: number | number[]): Promise<void> => {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      for (const id of ids) {
        mockTabs.delete(id);
      }
      return Promise.resolve();
    }),
  };
}

type MockTabs = ReturnType<typeof createMockTabs>;

/**
 * Create mock scripting API
 */
function createMockScripting() {
  return {
    /** Execute script in tab */
    executeScript: createMockFn(<Result = unknown>(
      injection: chrome.scripting.ScriptInjection<unknown[], Result>,
      callback?: (results: chrome.scripting.InjectionResult<Result>[]) => void
    ): Promise<chrome.scripting.InjectionResult<Result>[]> => {
      const results: chrome.scripting.InjectionResult<Result>[] = [
        {
          frameId: injection.target.frameId ?? 0,
          result: undefined as Result,
        },
      ];
      if (callback) {
        callback(results);
      }
      return Promise.resolve(results);
    }),
  };
}

type MockScripting = ReturnType<typeof createMockScripting>;

/**
 * Create mock contextMenus API
 */
function createMockContextMenus() {
  const menuItems = new Map<string, chrome.contextMenus.CreateProperties>();
  const clickListeners: Array<(info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab | undefined) => void> = [];

  return {
    /** Created menu items */
    items: menuItems,

    /** Create menu item */
    create: createMockFn((createProperties: chrome.contextMenus.CreateProperties, callback?: () => void) => {
      if (createProperties.id) {
        menuItems.set(createProperties.id, createProperties);
      }
      if (callback) {
        callback();
      }
    }),

    /** Update menu item */
    update: createMockFn((id: string, updateProperties: chrome.contextMenus.UpdateProperties, callback?: () => void) => {
      const item = menuItems.get(id);
      if (item) {
        Object.assign(item, updateProperties);
      }
      if (callback) {
        callback();
      }
    }),

    /** Remove menu item */
    remove: createMockFn((menuItemId: string, callback?: () => void) => {
      menuItems.delete(menuItemId);
      if (callback) {
        callback();
      }
    }),

    /** Remove all menu items */
    removeAll: createMockFn((callback?: () => void) => {
      menuItems.clear();
      if (callback) {
        callback();
      }
    }),

    /** Listen for menu clicks */
    onClicked: {
      addListener: createMockFn((callback: (info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab | undefined) => void) => {
        clickListeners.push(callback);
      }),
      removeListener: createMockFn((callback: typeof clickListeners[0]) => {
        const index = clickListeners.indexOf(callback);
        if (index > -1) {
          clickListeners.splice(index, 1);
        }
      }),
      /** Simulate menu click (for testing) */
      _emit: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
        for (const listener of clickListeners) {
          listener(info, tab);
        }
      },
    },
  };
}

type MockContextMenus = ReturnType<typeof createMockContextMenus>;

/**
 * Create mock commands API
 */
function createMockCommands() {
  const commandListeners: Array<(command: string) => void> = [];

  return {
    /** Listen for keyboard commands */
    onCommand: {
      addListener: createMockFn((callback: (command: string) => void) => {
        commandListeners.push(callback);
      }),
      removeListener: createMockFn((callback: typeof commandListeners[0]) => {
        const index = commandListeners.indexOf(callback);
        if (index > -1) {
          commandListeners.splice(index, 1);
        }
      }),
      /** Simulate command (for testing) */
      _emit: (command: string) => {
        for (const listener of commandListeners) {
          listener(command);
        }
      },
    },
  };
}

type MockCommands = ReturnType<typeof createMockCommands>;

/**
 * Create mock action API (MV3)
 */
function createMockAction() {
  return {
    /** Open extension popup */
    openPopup: createMockFn(() => Promise.resolve()),

    /** Set badge text */
    setBadgeText: createMockFn((_details: chrome.action.BadgeTextDetails) => Promise.resolve()),

    /** Get badge text */
    getBadgeText: createMockFn((_details: chrome.action.TabDetails) => Promise.resolve("")),

    /** Set badge background color */
    setBadgeBackgroundColor: createMockFn((_details: chrome.action.BadgeColorDetails) => Promise.resolve()),

    /** Set icon */
    setIcon: createMockFn((_details: chrome.action.IconDetails) => Promise.resolve()),
  };
}

type MockAction = ReturnType<typeof createMockAction>;

/**
 * Create mock offscreen API (MV3)
 */
function createMockOffscreen() {
  let hasDocument = false;

  return {
    /** Create offscreen document */
    createDocument: createMockFn((parameters: chrome.offscreen.CreateParameters) => {
      hasDocument = true;
      return Promise.resolve(parameters);
    }),

    /** Close offscreen document */
    closeDocument: createMockFn(() => {
      hasDocument = false;
      return Promise.resolve();
    }),

    /** Check if has document */
    hasDocument: () => hasDocument,

    /** Reason enum */
    Reason: {
      DOM_PARSER: "DOM_PARSER",
      CLIPBOARD: "CLIPBOARD",
      BLOBS: "BLOBS",
      WORKERS: "WORKERS",
    } as const,
  };
}

type MockOffscreen = ReturnType<typeof createMockOffscreen>;

/**
 * Full mock Chrome API object
 */
export interface MockChrome {
  storage: {
    local: MockStorageArea;
    sync: MockStorageArea;
    managed: MockStorageArea;
  };
  runtime: MockRuntime;
  tabs: MockTabs;
  scripting: MockScripting;
  contextMenus: MockContextMenus;
  commands: MockCommands;
  action: MockAction;
  offscreen: MockOffscreen;
}

/**
 * Mock chrome global object
 *
 * Use this to access mock-specific methods like:
 * - `mockChrome.storage.local.data.set({ key: value })`
 * - `mockChrome.tabs.addTab({ url: '...' })`
 * - `mockChrome.runtime.onMessage._emit(message)`
 * - `mockChrome.contextMenus.onClicked._emit(info, tab)`
 */
export let mockChrome: MockChrome;

/**
 * Set up all Chrome API mocks on the global `chrome` object
 *
 * Call this in beforeEach() to ensure a fresh state for each test.
 */
export function setupChromeMocks(): void {
  mockChrome = {
    storage: {
      local: createMockStorageArea(),
      sync: createMockStorageArea(),
      managed: createMockStorageArea(),
    },
    runtime: createMockRuntime(),
    tabs: createMockTabs(),
    scripting: createMockScripting(),
    contextMenus: createMockContextMenus(),
    commands: createMockCommands(),
    action: createMockAction(),
    offscreen: createMockOffscreen(),
  };

  // Cast to any to allow assignment of mock properties
  (globalThis as Record<string, unknown>).chrome = mockChrome;
}

/**
 * Reset all Chrome mock state
 *
 * Useful for cleaning up between tests when not using beforeEach.
 */
export function resetChromeMocks(): void {
  if (mockChrome) {
    mockChrome.storage.local.data.clear();
    mockChrome.storage.sync.data.clear();
    mockChrome.storage.managed.data.clear();
    mockChrome.tabs.tabs.clear();
    mockChrome.contextMenus.items.clear();
  }
}
