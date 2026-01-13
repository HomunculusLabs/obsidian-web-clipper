// Background service worker for Obsidian Web Clipper

// Handle keyboard shortcut command
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'clip-page') {
    // Open popup when shortcut is pressed
    chrome.action.openPopup();
  }
});

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set default settings on install
    chrome.storage.local.set({
      vaultName: 'Main',
      defaultFolder: '2 - Source Material/Clips',
      defaultTags: 'web-clip',
      includeTimestamps: true,
      savedFolders: ['2 - Source Material/Clips']
    });

    // Open options page for first-time setup
    chrome.runtime.openOptionsPage();
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSettings') {
    // Return settings to requester
    chrome.storage.local.get([
      'vaultName',
      'defaultFolder',
      'defaultTags',
      'includeTimestamps',
      'savedFolders'
    ], (result) => {
      sendResponse(result);
    });
    return true; // Keep message channel open for async response
  }

  if (request.action === 'copyToClipboard') {
    // Copy markdown to clipboard as fallback
    navigator.clipboard.writeText(request.data).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'openObsidianUri') {
    // Open Obsidian URI
    chrome.tabs.create({ url: request.uri }, (tab) => {
      sendResponse({ success: !!tab });
    });
    return true;
  }
});

// Handle context menu (optional - for right-click clipping)
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'clipToObsidian',
    title: 'Clip to Obsidian',
    contexts: ['page', 'selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'clipToObsidian') {
    // Send message to content script to clip
    chrome.tabs.sendMessage(tab.id, {
      action: 'clip',
      selectionOnly: info.selectionText !== undefined
    });
  }
});
