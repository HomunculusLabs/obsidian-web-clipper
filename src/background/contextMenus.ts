export async function createContextMenu(): Promise<void> {
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
      id: "clipToObsidian",
      title: "Clip to Obsidian",
      contexts: ["page", "selection"]
    });
  } catch (err) {
    console.error("Failed to create context menu:", err);
  }
}

export function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined
): void {
  if (info.menuItemId !== "clipToObsidian") return;
  if (!tab?.id) return;

  const selectionOnly = typeof info.selectionText === "string" && info.selectionText.length > 0;

  try {
    chrome.tabs.sendMessage(tab.id, {
      action: "clip",
      selectionOnly
    });
  } catch (err) {
    console.error("Failed to send clip message to tab:", err);
  }
}