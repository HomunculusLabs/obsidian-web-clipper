/**
 * Chrome Mocks Test Suite
 *
 * Tests that the Chrome API mocks work correctly for testing.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { setupChromeMocks, resetChromeMocks, mockChrome } from "./chrome";

describe("Chrome Mocks", () => {
  beforeEach(() => {
    setupChromeMocks();
  });

  describe("chrome.storage.local", () => {
    test("get returns empty object for missing keys", async () => {
      const result = await chrome.storage.local.get("nonexistent");
      expect(result).toEqual({});
    });

    test("set and get work together", async () => {
      await chrome.storage.local.set({ myKey: "myValue" });
      const result = await chrome.storage.local.get("myKey");
      expect(result.myKey).toBe("myValue");
    });

    test("get with array of keys returns all values", async () => {
      await chrome.storage.local.set({ a: 1, b: 2, c: 3 });
      const result = await chrome.storage.local.get(["a", "c"]);
      expect(result).toEqual({ a: 1, c: 3 });
    });

    test("get with null returns all data", async () => {
      await chrome.storage.local.set({ x: 10, y: 20 });
      const result = await chrome.storage.local.get(null as unknown as string[]);
      expect(result).toEqual({ x: 10, y: 20 });
    });

    test("clear removes all data", async () => {
      await chrome.storage.local.set({ key: "value" });
      await chrome.storage.local.clear();
      const result = await chrome.storage.local.get("key");
      expect(result).toEqual({});
    });

    test("remove deletes specific keys", async () => {
      await chrome.storage.local.set({ a: 1, b: 2 });
      await chrome.storage.local.remove("a");
      const result = await chrome.storage.local.get(["a", "b"]);
      expect(result).toEqual({ b: 2 });
    });

    test("direct data.set for test setup", async () => {
      mockChrome.storage.local.data.set("preloaded", true);
      const result = await chrome.storage.local.get("preloaded");
      expect(result.preloaded).toBe(true);
    });

    test("callback style is supported", (done) => {
      chrome.storage.local.set({ test: "callback" }, () => {
        chrome.storage.local.get("test", (result) => {
          expect(result.test).toBe("callback");
          done();
        });
      });
    });
  });

  describe("chrome.runtime", () => {
    test("getURL returns extension URL", () => {
      const url = chrome.runtime.getURL("path/to/file.html");
      expect(url).toContain("chrome-extension://");
      expect(url).toContain("path/to/file.html");
    });

    test("getURL respects registered URLs", () => {
      mockChrome.runtime.setUrl("custom/path", "https://example.com/custom");
      const url = chrome.runtime.getURL("custom/path");
      expect(url).toBe("https://example.com/custom");
    });

    test("openOptionsPage resolves", async () => {
      await expect(chrome.runtime.openOptionsPage()).resolves.toBeUndefined();
    });

    test("sendMessage returns undefined by default", async () => {
      const response = await chrome.runtime.sendMessage({ type: "test" });
      expect(response).toBeUndefined();
    });

    test("onMessage listener can be added", () => {
      const listener = () => false;
      chrome.runtime.onMessage.addListener(listener);
      expect(chrome.runtime.onMessage.hasListener(listener)).toBe(true);
    });

    test("onMessage._emit sends message to listeners", async () => {
      let received: unknown;
      chrome.runtime.onMessage.addListener((message) => {
        received = message;
        return false;
      });

      await mockChrome.runtime.onMessage._emit({ type: "test", data: 123 });
      expect(received).toEqual({ type: "test", data: 123 });
    });

    test("onMessage._emit captures sendResponse", async () => {
      chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
        sendResponse({ result: "ok" });
        return false;
      });

      const response = await mockChrome.runtime.onMessage._emit({ type: "test" });
      expect(response).toEqual({ result: "ok" });
    });

    test("onInstalled._emit triggers listeners", () => {
      let installed = false;
      chrome.runtime.onInstalled.addListener(() => {
        installed = true;
      });

      mockChrome.runtime.onInstalled._emit({ reason: "install" } as chrome.runtime.InstalledDetails);
      expect(installed).toBe(true);
    });
  });

  describe("chrome.tabs", () => {
    test("query returns empty array by default", async () => {
      const tabs = await chrome.tabs.query({});
      expect(tabs).toEqual([]);
    });

    test("addTab creates tab for testing", async () => {
      const tab = mockChrome.tabs.addTab({ url: "https://example.com", title: "Example" });
      const tabs = await chrome.tabs.query({});
      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toEqual(tab);
    });

    test("query with active filter", async () => {
      mockChrome.tabs.addTab({ url: "https://example.com", active: true });
      mockChrome.tabs.addTab({ url: "https://other.com", active: false });

      const activeTabs = await chrome.tabs.query({ active: true });
      expect(activeTabs).toHaveLength(1);
      expect(activeTabs[0].url).toBe("https://example.com");
    });

    test("get returns tab by id", async () => {
      const tab = mockChrome.tabs.addTab({ url: "https://test.com" });
      const result = await chrome.tabs.get(tab.id!);
      expect(result).toEqual(tab);
    });

    test("get rejects for unknown tab", async () => {
      await expect(chrome.tabs.get(999)).rejects.toThrow("not found");
    });

    test("create creates new tab", async () => {
      const tab = await chrome.tabs.create({ url: "https://created.com" });
      expect(tab.url).toBe("https://created.com");
      expect(tab.id).toBeDefined();
    });

    test("sendMessage to tab", async () => {
      const tab = mockChrome.tabs.addTab({});
      const response = await chrome.tabs.sendMessage(tab.id!, { type: "test" });
      expect(response).toBeUndefined();
    });

    test("update modifies tab", async () => {
      const tab = mockChrome.tabs.addTab({ url: "https://original.com" });
      const updated = await chrome.tabs.update(tab.id!, { url: "https://updated.com" });
      expect(updated.url).toBe("https://updated.com");
    });

    test("remove deletes tab", async () => {
      const tab = mockChrome.tabs.addTab({});
      await chrome.tabs.remove(tab.id!);
      await expect(chrome.tabs.get(tab.id!)).rejects.toThrow("not found");
    });
  });

  describe("chrome.scripting", () => {
    test("executeScript returns default result", async () => {
      const results = await chrome.scripting.executeScript({
        target: { tabId: 1 },
        files: ["script.js"],
      });
      expect(results).toHaveLength(1);
      expect(results[0].frameId).toBe(0);
    });
  });

  describe("chrome.contextMenus", () => {
    test("create adds menu item", () => {
      chrome.contextMenus.create({ id: "test-menu", title: "Test" });
      expect(mockChrome.contextMenus.items.has("test-menu")).toBe(true);
    });

    test("remove deletes menu item", () => {
      chrome.contextMenus.create({ id: "to-remove", title: "Remove Me" });
      chrome.contextMenus.remove("to-remove");
      expect(mockChrome.contextMenus.items.has("to-remove")).toBe(false);
    });

    test("removeAll clears all items", () => {
      chrome.contextMenus.create({ id: "menu1", title: "Menu 1" });
      chrome.contextMenus.create({ id: "menu2", title: "Menu 2" });
      chrome.contextMenus.removeAll();
      expect(mockChrome.contextMenus.items.size).toBe(0);
    });

    test("onClicked._emit triggers listeners", () => {
      let clicked: string | undefined;
      chrome.contextMenus.onClicked.addListener((info) => {
        clicked = info.menuItemId as string;
      });

      mockChrome.contextMenus.onClicked._emit({ menuItemId: "test-id" } as chrome.contextMenus.OnClickData);
      expect(clicked).toBe("test-id");
    });
  });

  describe("chrome.commands", () => {
    test("onCommand._emit triggers listeners", () => {
      let command: string | undefined;
      chrome.commands.onCommand.addListener((cmd) => {
        command = cmd;
      });

      mockChrome.commands.onCommand._emit("clip-page");
      expect(command).toBe("clip-page");
    });
  });

  describe("chrome.action", () => {
    test("openPopup resolves", async () => {
      await expect(chrome.action.openPopup()).resolves.toBeUndefined();
    });

    test("setBadgeText is callable", async () => {
      await chrome.action.setBadgeText({ text: "3" });
      expect(chrome.action.setBadgeText.mock.callCount).toBe(1);
    });
  });

  describe("chrome.offscreen", () => {
    test("createDocument resolves", async () => {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: "test",
      });
      expect(mockChrome.offscreen.hasDocument()).toBe(true);
    });

    test("closeDocument clears state", async () => {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: "test",
      });
      await chrome.offscreen.closeDocument();
      expect(mockChrome.offscreen.hasDocument()).toBe(false);
    });
  });

  describe("resetChromeMocks", () => {
    test("clears storage", () => {
      mockChrome.storage.local.data.set({ key: "value" });
      resetChromeMocks();
      expect(mockChrome.storage.local.data.size).toBe(0);
    });

    test("clears tabs", () => {
      mockChrome.tabs.addTab({});
      resetChromeMocks();
      expect(mockChrome.tabs.tabs.size).toBe(0);
    });
  });
});
