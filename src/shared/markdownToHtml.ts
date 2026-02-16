/**
 * Simple markdown-to-HTML converter for preview rendering.
 * Handles common markdown elements without external dependencies.
 */

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert markdown text to HTML for preview display.
 * This is a lightweight implementation that handles the most common elements.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return "";

  // Split into lines for processing
  const lines = markdown.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];
  let inList = false;
  let listItems: string[] = [];
  let listIsOrdered = false;

  function flushList() {
    if (listItems.length > 0) {
      const tag = listIsOrdered ? "ol" : "ul";
      result.push(`<${tag}>`);
      for (const item of listItems) {
        result.push(`<li>${item}</li>`);
      }
      result.push(`</${tag}>`);
      listItems = [];
      inList = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks (fenced)
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        flushList();
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeBlockLines = [];
      } else {
        // End code block
        const codeContent = codeBlockLines
          .map((l) => escapeHtml(l))
          .join("\n");
        result.push(
          `<pre><code${codeBlockLang ? ` class="language-${escapeHtml(codeBlockLang)}"` : ""}>${codeContent}</code></pre>`
        );
        inCodeBlock = false;
        codeBlockLang = "";
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Frontmatter (YAML) - render as code block
    if (line === "---" && i === 0) {
      // Skip opening frontmatter delimiter, we'll handle it specially
      let endFound = false;
      let yamlLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j] === "---") {
          endFound = true;
          i = j; // Skip to after frontmatter
          break;
        }
        yamlLines.push(lines[j]);
      }
      if (endFound && yamlLines.length > 0) {
        result.push(
          `<div class="frontmatter"><pre><code>${yamlLines.map((l) => escapeHtml(l)).join("\n")}</code></pre></div>`
        );
      }
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushList();
      result.push("<hr>");
      continue;
    }

    // Headers (must check before other patterns)
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      flushList();
      const level = headerMatch[1].length;
      const content = parseInline(headerMatch[2]);
      result.push(`<h${level}>${content}</h${level}>`);
      continue;
    }

    // Unordered list items
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listIsOrdered) {
        flushList();
        inList = true;
        listIsOrdered = false;
      }
      listItems.push(parseInline(ulMatch[2]));
      continue;
    }

    // Ordered list items
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inList || !listIsOrdered) {
        flushList();
        inList = true;
        listIsOrdered = true;
      }
      listItems.push(parseInline(olMatch[2]));
      continue;
    }

    // Blockquotes
    const bqMatch = line.match(/^>\s*(.*)$/);
    if (bqMatch) {
      flushList();
      result.push(`<blockquote>${parseInline(bqMatch[1])}</blockquote>`);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      flushList();
      continue;
    }

    // Regular paragraph
    flushList();
    result.push(`<p>${parseInline(line)}</p>`);
  }

  // Flush any remaining list
  flushList();

  return result.join("\n");
}

/**
 * Parse inline markdown elements (bold, italic, code, links, images)
 */
function parseInline(text: string): string {
  let result = escapeHtml(text);

  // Images: ![alt](url)
  result = result.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1">'
  );

  // Links: [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );

  // Inline code: `code`
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold: **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__([^_]+)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  result = result.replace(/_([^_]+)_/g, "<em>$1</em>");

  // Strikethrough: ~~text~~
  result = result.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  return result;
}
