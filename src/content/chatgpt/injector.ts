/**
 * ChatGPT Clip Button Injector
 *
 * Injects a "Clip to Obsidian" button into the action bar of each ChatGPT
 * assistant response. Uses a MutationObserver to handle dynamically loaded
 * and streamed messages.
 */

import { runtimeSendMessage } from "../../shared/chromeAsync";
import { buildClipMarkdown, type FrontmatterInput } from "../../shared/markdown";
import { DEFAULT_SETTINGS, type Settings } from "../../shared/settings";
import { sanitizeFilename } from "../../shared/sanitize";
import { parseTags, addAutoTags } from "../../shared/tags";
import type { RuntimeRequest, SaveContentResponse } from "../../shared/messages";
import { getSelection } from "../selection";
import { htmlToMarkdownLite } from "../../shared/htmlToMarkdown";

const CLIP_BUTTON_ATTR = "data-obsidian-clip-injected";

// SVG icon for the clip button (a small bookmark/clip icon)
const CLIP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`;

/**
 * Find the message content element associated with an action bar.
 * ChatGPT structure: the action bar is a sibling or nearby element to
 * the message content within a turn container.
 */
function findMessageContent(actionBar: HTMLElement): HTMLElement | null {
  // Walk up to find the turn/message container, then find the markdown content
  let container: HTMLElement | null = actionBar;

  // Walk up a few levels to find the message turn container
  for (let i = 0; i < 8; i++) {
    container = container?.parentElement ?? null;
    if (!container) return null;

    // Look for the markdown content div within this container
    const markdownEl = container.querySelector(
      '[data-message-author-role="assistant"] .markdown'
    ) as HTMLElement | null;
    if (markdownEl) return markdownEl;

    // Alternative: look for prose class used in some ChatGPT versions
    const proseEl = container.querySelector(
      '[data-message-author-role="assistant"] .prose'
    ) as HTMLElement | null;
    if (proseEl) return proseEl;
  }

  return null;
}

/**
 * Extract a short title from the message content for the filename.
 */
function extractTitle(text: string): string {
  // Use the first line or first ~60 chars as a title
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) || "ChatGPT Response";
  const cleaned = firstLine.replace(/^#+\s*/, "").trim();
  return cleaned.length > 60 ? cleaned.slice(0, 57) + "..." : cleaned;
}

/**
 * Check if a selection range is contained within a given element.
 */
function isSelectionInElement(element: HTMLElement): boolean {
  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
    return false;
  }

  const range = domSelection.getRangeAt(0);
  return element.contains(range.commonAncestorContainer);
}

/**
 * Clip a single ChatGPT message to Obsidian using the save pipeline.
 * If the user has text selected within the message, clips just that selection.
 */
async function clipMessage(messageEl: HTMLElement): Promise<void> {
  // Check for selection within this message
  const selection = getSelection();
  const hasSelectionInMessage = selection.hasSelection && isSelectionInElement(messageEl);

  let html: string;
  let markdown: string;
  let clipMode: "full" | "selection" = "full";

  if (hasSelectionInMessage) {
    // Clip only the selected portion
    html = selection.html;
    markdown = htmlToMarkdownLite(html);
    clipMode = "selection";
  } else {
    // Clip the full message
    html = messageEl.innerHTML;
    markdown = htmlToMarkdownLite(html);
  }

  const shortTitle = extractTitle(markdown);

  // Get settings from background
  let settings: Settings;
  try {
    settings = (await runtimeSendMessage<RuntimeRequest, Settings>({
      action: "getSettings",
    })) || DEFAULT_SETTINGS;
  } catch {
    settings = DEFAULT_SETTINGS;
  }

  // Get conversation title from the page
  const pageTitle = document.title.replace(/ \| ChatGPT$/, "").trim() || "ChatGPT Conversation";
  const finalTitle = sanitizeFilename(`${pageTitle} - ${shortTitle}`);

  const folder = (settings.defaultFolder || DEFAULT_SETTINGS.defaultFolder).trim();
  const filePath = folder ? `${folder}/${finalTitle}` : finalTitle;

  const rawTags = (settings.defaultTags || DEFAULT_SETTINGS.defaultTags || "").trim();
  const tags = addAutoTags(parseTags(rawTags), "web");
  // Add chatgpt-specific tag
  if (!tags.includes("chatgpt")) tags.push("chatgpt");

  const frontmatter: FrontmatterInput = {
    source: window.location.href,
    title: finalTitle,
    type: "article",
    dateClippedISO: new Date().toISOString(),
    tags,
    extra: {
      page_type: "chatgpt",
      conversation_title: pageTitle,
      clip_mode: clipMode,
    },
  };

  const body = `# ${shortTitle}\n\n${markdown}`;
  const fullMarkdown = buildClipMarkdown(frontmatter, body);

  const vault = (settings.vaultName || DEFAULT_SETTINGS.vaultName).trim() || "Main Vault";

  // Use the save pipeline (URI → clipboard fallback)
  try {
    const response = await runtimeSendMessage<RuntimeRequest, SaveContentResponse>({
      action: "saveContent",
      markdown: fullMarkdown,
      filePath,
      vault,
      fallbackToClipboard: true,
    });

    if (response?.success) {
      if (response.usedMethod === "clipboard") {
        const modeMsg = clipMode === "selection" ? "Selection" : "Content";
        showToast(`${modeMsg} copied to clipboard (too large for URI). Paste into Obsidian.`);
      } else {
        const modeMsg = clipMode === "selection" ? "Selection" : "Response";
        showToast(`${modeMsg} clipped to Obsidian ✓`);
      }
    } else {
      // Save failed, show error
      console.error("[Obsidian Clipper] Save failed:", response?.error);
      showToast(`Failed to clip: ${response?.error || "Unknown error"}`);
    }
  } catch (err) {
    console.error("[Obsidian Clipper] Failed to clip:", err);
    showToast("Failed to clip message.");
  }
}

/**
 * Show a brief toast notification.
 */
function showToast(message: string): void {
  const existing = document.getElementById("obsidian-clip-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "obsidian-clip-toast";
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    background: "#7c3aed",
    color: "#fff",
    padding: "12px 20px",
    borderRadius: "8px",
    fontSize: "14px",
    fontFamily: "system-ui, sans-serif",
    zIndex: "999999",
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
    transition: "opacity 0.3s ease",
    opacity: "1",
  });
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

/**
 * Create and return a clip button element.
 */
function createClipButton(actionBar: HTMLElement): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "text-token-text-secondary hover:bg-token-bg-secondary rounded-lg";
  btn.setAttribute("aria-label", "Clip to Obsidian");
  btn.setAttribute(CLIP_BUTTON_ATTR, "true");
  btn.title = "Clip to Obsidian";

  const span = document.createElement("span");
  span.className = "flex items-center justify-center touch:w-10 h-8 w-8";
  span.innerHTML = CLIP_ICON_SVG;
  btn.appendChild(span);

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const messageEl = findMessageContent(actionBar);
    if (!messageEl) {
      showToast("Could not find message content.");
      return;
    }

    // Visual feedback
    btn.style.opacity = "0.5";
    btn.style.pointerEvents = "none";

    try {
      await clipMessage(messageEl);
    } catch (err) {
      console.error("[Obsidian Clipper] Error:", err);
      showToast("Failed to clip message.");
    } finally {
      btn.style.opacity = "1";
      btn.style.pointerEvents = "auto";
    }
  });

  return btn;
}

/**
 * Scan the page for action bars and inject clip buttons where missing.
 */
function injectButtons(): void {
  // Target: the copy button in each action bar, use its parent container
  const copyButtons = document.querySelectorAll(
    'button[data-testid="copy-turn-action-button"]'
  );

  copyButtons.forEach((copyBtn) => {
    const actionBar = copyBtn.parentElement;
    if (!actionBar) return;

    // Skip if already injected
    if (actionBar.querySelector(`[${CLIP_BUTTON_ATTR}]`)) return;

    const clipBtn = createClipButton(actionBar);

    // Insert the clip button right after the copy button
    copyBtn.insertAdjacentElement("afterend", clipBtn);
  });
}

/**
 * Clip ALL assistant responses on the current page to Obsidian.
 * Each response becomes its own note, with a short delay between clips
 * so Obsidian can handle the rapid-fire URIs.
 */
async function clipAllMessages(): Promise<void> {
  const copyButtons = document.querySelectorAll(
    'button[data-testid="copy-turn-action-button"]'
  );

  // Collect all message elements we can find
  const messageEls: HTMLElement[] = [];
  copyButtons.forEach((copyBtn) => {
    const actionBar = copyBtn.parentElement;
    if (!actionBar) return;
    const msgEl = findMessageContent(actionBar);
    if (msgEl) messageEls.push(msgEl);
  });

  if (messageEls.length === 0) {
    showToast("No assistant responses found on this page.");
    return;
  }

  showToast(`Clipping ${messageEls.length} response(s)...`);

  let clipped = 0;
  let failed = 0;

  for (const msgEl of messageEls) {
    try {
      await clipMessage(msgEl);
      clipped++;
      // Stagger clips so Obsidian doesn't choke on rapid URIs
      if (clipped < messageEls.length) {
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (err) {
      console.error("[Obsidian Clipper] Failed to clip message:", err);
      failed++;
    }
  }

  const msg = failed > 0
    ? `Clipped ${clipped}/${messageEls.length} responses (${failed} failed)`
    : `Clipped all ${clipped} responses ✓`;
  showToast(msg);
}

const CLIP_ALL_BUTTON_ID = "obsidian-clip-all-btn";

const CLIP_ALL_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path><line x1="12" y1="8" x2="12" y2="14"></line><line x1="9" y1="11" x2="15" y2="11"></line></svg>`;

/**
 * Inject a floating "Clip All" button on ChatGPT pages.
 */
function injectClipAllButton(): void {
  if (document.getElementById(CLIP_ALL_BUTTON_ID)) return;

  const btn = document.createElement("button");
  btn.id = CLIP_ALL_BUTTON_ID;
  btn.title = "Clip All Responses to Obsidian";
  btn.innerHTML = `${CLIP_ALL_ICON_SVG} <span style="margin-left:6px;">Clip All</span>`;
  Object.assign(btn.style, {
    position: "fixed",
    bottom: "24px",
    left: "24px",
    zIndex: "999998",
    display: "flex",
    alignItems: "center",
    padding: "10px 16px",
    background: "#7c3aed",
    color: "#fff",
    border: "none",
    borderRadius: "10px",
    cursor: "pointer",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
    fontWeight: "600",
    boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
    transition: "opacity 0.2s, transform 0.2s",
  });

  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "scale(1.05)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.transform = "scale(1)";
  });

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    btn.style.opacity = "0.5";
    btn.style.pointerEvents = "none";
    try {
      await clipAllMessages();
    } finally {
      btn.style.opacity = "1";
      btn.style.pointerEvents = "auto";
    }
  });

  document.body.appendChild(btn);
}

/**
 * Initialize the ChatGPT injector with a MutationObserver.
 */
export function initChatGPTInjector(): void {
  // Only run on ChatGPT
  if (
    !window.location.hostname.includes("chat.openai.com") &&
    !window.location.hostname.includes("chatgpt.com")
  ) {
    return;
  }

  console.log("[Obsidian Clipper] ChatGPT detected, initializing injector...");

  // Initial scan
  injectButtons();
  injectClipAllButton();

  // Watch for new messages (streaming, navigation, etc.)
  const observer = new MutationObserver(() => {
    injectButtons();
    injectClipAllButton();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
