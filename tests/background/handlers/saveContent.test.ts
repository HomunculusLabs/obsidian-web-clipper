import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { handleSaveContent } from "../../../src/background/handlers/saveContent";
import type { RuntimeRequest } from "../../../src/shared/messages";
import { mockChrome, setupChromeMocks } from "../../mocks/chrome";

type SaveContentRequest = Extract<RuntimeRequest, { action: "saveContent" }>;
type UriOutcome = "success" | "error";

describe("handleSaveContent", () => {
  const nativeResponses: Array<Record<string, unknown>> = [];
  const nativeCalls: Array<{ host: string; message: Record<string, unknown> }> = [];
  const methodAttempts: string[] = [];
  const clipboardWrites: string[] = [];
  const notificationPayloads: chrome.notifications.NotificationOptions<true>[] = [];
  const uriOutcomes: UriOutcome[] = [];

  let originalClipboardDescriptor: PropertyDescriptor | undefined;

  const flushEffects = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const makeRequest = (
    overrides: Partial<SaveContentRequest> = {}
  ): SaveContentRequest => ({
    action: "saveContent",
    markdown: "# Saved note\n\nSome content",
    filePath: "Inbox/My Note",
    vault: "Request Vault",
    fallbackToClipboard: true,
    ...overrides
  });

  const setStoredSettings = (settings: Record<string, unknown>) => {
    mockChrome.storage.local.setValues(settings);
  };

  const assertSingleSuccessSideEffects = () => {
    expect(notificationPayloads).toHaveLength(1);
    expect(chrome.action.setBadgeBackgroundColor.mock.callCount).toBe(1);
    expect(chrome.action.setBadgeText.mock.callCount).toBe(1);

    const badgeState = mockChrome.storage.local.data.get("badgeCounterState") as
      | { count: number }
      | undefined;
    expect(badgeState?.count).toBe(1);
  };

  beforeEach(() => {
    setupChromeMocks();

    nativeResponses.length = 0;
    nativeCalls.length = 0;
    methodAttempts.length = 0;
    clipboardWrites.length = 0;
    notificationPayloads.length = 0;
    uriOutcomes.length = 0;

    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          methodAttempts.push("clipboard");
          clipboardWrites.push(text);
        }
      }
    });

    (mockChrome.runtime as chrome.runtime.Runtime & {
      sendNativeMessage?: (
        host: string,
        message: Record<string, unknown>,
        callback: (response: unknown) => void
      ) => void;
    }).sendNativeMessage = (
      host: string,
      message: Record<string, unknown>,
      callback: (response: unknown) => void
    ) => {
      methodAttempts.push("cli");
      nativeCalls.push({ host, message });
      callback(nativeResponses.shift() ?? { success: false, error: "No mock response configured" });
    };

    chrome.tabs.create = ((
      createProperties: chrome.tabs.CreateProperties,
      callback?: (tab: chrome.tabs.Tab) => void
    ) => {
      methodAttempts.push("uri");
      const next = uriOutcomes.shift() ?? "success";

      if (next === "error") {
        chrome.runtime.lastError = { message: "URI launch failed" };
        callback?.(undefined as unknown as chrome.tabs.Tab);
        chrome.runtime.lastError = undefined;
        return;
      }

      callback?.({
        id: 1,
        index: 0,
        windowId: createProperties.windowId ?? 1,
        active: createProperties.active ?? true,
        highlighted: true,
        pinned: false,
        incognito: false,
        url: createProperties.url,
        title: "Obsidian URI",
        status: "complete"
      });
    }) as typeof chrome.tabs.create;

    (chrome as typeof chrome & {
      notifications?: {
        create: (options: chrome.notifications.NotificationOptions<true>) => Promise<string>;
      };
    }).notifications = {
      create: async (options: chrome.notifications.NotificationOptions<true>) => {
        notificationPayloads.push(options);
        return "notification-id";
      }
    };
  });

  afterEach(() => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  test("uses configured CLI -> URI order and succeeds on URI fallback", async () => {
    setStoredSettings({
      saveMethod: "cli",
      obsidianCli: { enabled: true, cliPath: "/usr/local/bin/obsidian", vault: "CLI Vault" },
      enableClipNotifications: true,
      badgeCounterEnabled: true
    });

    nativeResponses.push({ success: false, error: "CLI unavailable" });
    uriOutcomes.push("success");

    const result = await handleSaveContent(makeRequest());
    await flushEffects();

    expect(result).toEqual({ success: true, usedMethod: "uri" });
    expect(methodAttempts).toEqual(["cli", "uri"]);
    expect(nativeCalls).toHaveLength(1);
    expect(nativeCalls[0]?.message).toMatchObject({
      action: "saveToCli",
      payload: {
        cliPath: "/usr/local/bin/obsidian",
        vault: "CLI Vault",
        filePath: "Inbox/My Note"
      }
    });
    expect(clipboardWrites).toHaveLength(0);
    assertSingleSuccessSideEffects();
    expect(notificationPayloads[0]?.message).toContain("Vault: Request Vault");
  });

  test("falls back CLI -> URI -> clipboard when needed", async () => {
    setStoredSettings({
      saveMethod: "cli",
      obsidianCli: { enabled: true, cliPath: "/usr/local/bin/obsidian", vault: "CLI Vault" },
      enableClipNotifications: true,
      badgeCounterEnabled: true
    });

    nativeResponses.push({ success: false, error: "CLI failed" });
    uriOutcomes.push("error");

    const request = makeRequest({ markdown: "# Clipboard fallback" });
    const result = await handleSaveContent(request);
    await flushEffects();

    expect(result).toEqual({ success: true, usedMethod: "clipboard" });
    expect(methodAttempts).toEqual(["cli", "uri", "clipboard"]);
    expect(clipboardWrites).toEqual(["# Clipboard fallback"]);
    assertSingleSuccessSideEffects();
  });

  test("does not attempt clipboard when fallbackToClipboard is false", async () => {
    setStoredSettings({
      saveMethod: "cli",
      obsidianCli: { enabled: true, cliPath: "/usr/local/bin/obsidian", vault: "CLI Vault" },
      enableClipNotifications: true,
      badgeCounterEnabled: true
    });

    nativeResponses.push({ success: false, error: "CLI failed" });
    uriOutcomes.push("error");

    const result = await handleSaveContent(makeRequest({ fallbackToClipboard: false }));
    await flushEffects();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("URI launch failed");
    }
    expect(methodAttempts).toEqual(["cli", "uri"]);
    expect(clipboardWrites).toHaveLength(0);
    expect(notificationPayloads).toHaveLength(0);
    expect(chrome.action.setBadgeText.mock.callCount).toBe(0);
  });

  test("uses URI -> clipboard order when saveMethod is uri", async () => {
    setStoredSettings({
      saveMethod: "uri",
      enableClipNotifications: true,
      badgeCounterEnabled: true
    });

    uriOutcomes.push("error");

    const result = await handleSaveContent(makeRequest());
    await flushEffects();

    expect(result).toEqual({ success: true, usedMethod: "clipboard" });
    expect(methodAttempts).toEqual(["uri", "clipboard"]);
    expect(nativeCalls).toHaveLength(0);
    assertSingleSuccessSideEffects();
  });

  test("keeps clipboard-only mode as a single-attempt path", async () => {
    setStoredSettings({
      saveMethod: "clipboard",
      enableClipNotifications: true,
      badgeCounterEnabled: true
    });

    const result = await handleSaveContent(makeRequest({ fallbackToClipboard: false }));
    await flushEffects();

    expect(result).toEqual({ success: true, usedMethod: "clipboard" });
    expect(methodAttempts).toEqual(["clipboard"]);
    expect(nativeCalls).toHaveLength(0);
    assertSingleSuccessSideEffects();
  });
});
