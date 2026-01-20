import type { RuntimeRequest } from '../shared/messages';
import { DEFAULT_SETTINGS, SETTINGS_KEYS, type Settings } from '../shared/settings';
import { storageGet, storageSet, tabsCreate } from '../shared/chromeAsync';

type CopyToClipboardResponse = { success: boolean; error?: string };
type OpenObsidianUriResponse = { success: boolean; error?: string };

function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!value || typeof value !== 'object') return false;
  const v = value as { action?: unknown };
  return (
    v.action === 'getSettings' ||
    v.action === 'copyToClipboard' ||
    v.action === 'openObsidianUri'
  );
}

async function getMergedSettings(): Promise<Settings> {
  const stored = await storageGet<Settings>(SETTINGS_KEYS);
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
}

async function ensureDefaultsOnInstall(
  details: chrome.runtime.InstalledDetails
): Promise<void> {
  if (details.reason !== 'install') return;

  await storageSet<Settings>(DEFAULT_SETTINGS);

  try {
    chrome.runtime.openOptionsPage();
  } catch (err) {
    console.error('Failed to open options page:', err);
  }
}

async function createContextMenu(): Promise<void> {
  if (!chrome.contextMenus) return;

  await new Promise<void>((resolve) => {
    try {
      chrome.contextMenus.removeAll(() => resolve());
    } catch {
      resolve();
    }
  });

  try {
    chrome.contextMenus.create({
      id: 'clipToObsidian',
      title: 'Clip to Obsidian',
      contexts: ['page', 'selection']
    });
  } catch (err) {
    console.error('Failed to create context menu:', err);
  }
}

async function bestEffortClipboardWrite(text: string): Promise<void> {
  const clipboard = (typeof navigator !== 'undefined' ? navigator.clipboard : undefined) as
    | Clipboard
    | undefined;

  if (!clipboard || typeof clipboard.writeText !== 'function') {
    throw new Error('Clipboard API is unavailable in this service worker context');
  }

  await clipboard.writeText(text);
}

chrome.commands.onCommand.addListener((command: string) => {
  if (command !== 'clip-page') return;

  try {
    const maybePromise = chrome.action.openPopup();
    void Promise.resolve(maybePromise);
  } catch (err) {
    console.error('Failed to open popup:', err);
  }
});

chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
  void (async () => {
    await ensureDefaultsOnInstall(details);
    await createContextMenu();
  })().catch((err: unknown) => {
    console.error('onInstalled handler failed:', err);
  });
});

chrome.contextMenus.onClicked.addListener(
  (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
    if (info.menuItemId !== 'clipToObsidian') return;
    if (!tab?.id) return;

    const selectionOnly = typeof info.selectionText === 'string' && info.selectionText.length > 0;

    try {
      chrome.tabs.sendMessage(tab.id, {
        action: 'clip',
        selectionOnly
      });
    } catch (err) {
      console.error('Failed to send clip message to tab:', err);
    }
  }
);

chrome.runtime.onMessage.addListener(
  (request: unknown, _sender: chrome.runtime.MessageSender, sendResponse) => {
    if (!isRuntimeRequest(request)) {
      return false;
    }

    void (async () => {
      if (request.action === 'getSettings') {
        const merged = await getMergedSettings();
        sendResponse(merged);
        return;
      }

      if (request.action === 'copyToClipboard') {
        const response: CopyToClipboardResponse = { success: false };

        try {
          await bestEffortClipboardWrite(request.data);
          response.success = true;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : typeof err === 'string' ? err : 'Clipboard write failed';
          response.success = false;
          response.error = message;
        }

        sendResponse(response);
        return;
      }

      if (request.action === 'openObsidianUri') {
        const response: OpenObsidianUriResponse = { success: false };

        try {
          const tab = await tabsCreate({ url: request.uri });
          response.success = Boolean(tab);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : typeof err === 'string' ? err : 'Failed to open Obsidian URI';
          response.success = false;
          response.error = message;
        }

        sendResponse(response);
        return;
      }
    })().catch((err: unknown) => {
      console.error('runtime.onMessage handler failed:', err);
      try {
        sendResponse({ success: false, error: 'Unhandled background error' });
      } catch {
        // ignore
      }
    });

    return true;
  }
);