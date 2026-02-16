/**
 * Selection detection utility for clipping user-selected text.
 * Captures DOM selection as both HTML and plain text.
 */

export interface SelectionResult {
  /** Whether user has any text selected */
  hasSelection: boolean;
  /** Selected content as HTML string */
  html: string;
  /** Selected content as plain text */
  text: string;
  /** Number of selection ranges (for multi-selection support) */
  rangeCount: number;
  /** Whether this is a multi-selection (Ctrl+click multiple ranges) */
  isMultiSelection: boolean;
}

/**
 * Get the current DOM selection.
 * Returns both HTML representation and plain text of the selected content.
 * Handles multiple selection ranges (Ctrl+click multi-select).
 */
export function getSelection(): SelectionResult {
  const domSelection = window.getSelection();

  // No selection object available
  if (!domSelection) {
    return {
      hasSelection: false,
      html: "",
      text: "",
      rangeCount: 0,
      isMultiSelection: false
    };
  }

  const rangeCount = domSelection.rangeCount;

  // No ranges selected or selection is collapsed (cursor position, no actual selection)
  if (rangeCount === 0 || domSelection.isCollapsed) {
    return {
      hasSelection: false,
      html: "",
      text: "",
      rangeCount: 0,
      isMultiSelection: false
    };
  }

  // Extract HTML and text from all ranges
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  for (let i = 0; i < rangeCount; i++) {
    const range = domSelection.getRangeAt(i);

    // Skip collapsed ranges
    if (range.collapsed) {
      continue;
    }

    // Get text for this range
    const rangeText = range.toString().trim();
    if (rangeText) {
      textParts.push(rangeText);
    }

    // Clone range contents to a DocumentFragment
    const fragment = range.cloneContents();

    // Create a temporary container to serialize to HTML
    const div = document.createElement("div");
    div.appendChild(fragment);
    const html = div.innerHTML.trim();

    if (html) {
      htmlParts.push(html);
    }
  }

  // No valid content after processing
  if (htmlParts.length === 0) {
    return {
      hasSelection: false,
      html: "",
      text: "",
      rangeCount: 0,
      isMultiSelection: false
    };
  }

  const isMultiSelection = htmlParts.length > 1;

  // Join multiple ranges with separator (for multi-selection)
  const html = htmlParts.join("\n\n---\n\n");
  const text = textParts.join("\n\n---\n\n");

  return {
    hasSelection: true,
    html,
    text,
    rangeCount: htmlParts.length,
    isMultiSelection
  };
}

/**
 * Check if there is any meaningful text selection on the page.
 * Quick check without extracting the full content.
 */
export function hasSelection(): boolean {
  const domSelection = window.getSelection();

  if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
    return false;
  }

  const text = domSelection.toString().trim();
  return text.length > 0;
}

/**
 * Get just the selected text (faster than full HTML extraction).
 */
export function getSelectionText(): string {
  const domSelection = window.getSelection();

  if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
    return "";
  }

  return domSelection.toString().trim();
}
