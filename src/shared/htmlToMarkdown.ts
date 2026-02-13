/**
 * Shared HTML to Markdown conversion utilities.
 *
 * This module provides a lightweight HTML→Markdown converter that works
 * in any JavaScript context (content scripts, browser page context, Node.js).
 * It does NOT depend on Turndown or other libraries, making it suitable for
 * use in Puppeteer's page.evaluate() context.
 *
 * For richer conversion with settings support, use the Turndown-based
 * converter from src/content/web/turndown.ts instead.
 */

/**
 * Convert HTML to Markdown using a lightweight inline approach.
 *
 * This function is designed to be self-contained with no external dependencies,
 * so it can be serialized and run in Puppeteer's page.evaluate() context.
 *
 * Handles: code blocks, inline code, headers, bold, italic, links, lists,
 * blockquotes, and tables.
 *
 * @param html - The HTML string to convert
 * @returns Markdown string
 */
export function htmlToMarkdownLite(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;

  // Process code blocks first to preserve them
  const pres = body.querySelectorAll("pre");
  pres.forEach((pre) => {
    const code = pre.querySelector("code");
    const lang = code?.className?.match(/language-(\w+)/)?.[1] || "";
    const text = code?.textContent || pre.textContent || "";
    const placeholder = document.createElement("p");
    placeholder.textContent = `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
    pre.replaceWith(placeholder);
  });

  // Process inline code (after code blocks are handled)
  body.querySelectorAll("code").forEach((el) => {
    el.textContent = `\`${el.textContent}\``;
  });

  // Process headers
  for (let i = 1; i <= 6; i++) {
    body.querySelectorAll(`h${i}`).forEach((el) => {
      el.textContent = `${"#".repeat(i)} ${el.textContent}\n\n`;
    });
  }

  // Process bold
  body.querySelectorAll("strong, b").forEach((el) => {
    el.textContent = `**${el.textContent}**`;
  });

  // Process italic
  body.querySelectorAll("em, i").forEach((el) => {
    el.textContent = `*${el.textContent}*`;
  });

  // Process links
  body.querySelectorAll("a").forEach((el) => {
    const href = el.getAttribute("href") || "";
    el.textContent = `[${el.textContent}](${href})`;
  });

  // Process unordered lists
  body.querySelectorAll("ul").forEach((ul) => {
    const items = ul.querySelectorAll(":scope > li");
    let text = "\n";
    items.forEach((li) => {
      text += `- ${li.textContent?.trim()}\n`;
    });
    text += "\n";
    const placeholder = document.createElement("p");
    placeholder.textContent = text;
    ul.replaceWith(placeholder);
  });

  // Process ordered lists
  body.querySelectorAll("ol").forEach((ol) => {
    const items = ol.querySelectorAll(":scope > li");
    let text = "\n";
    items.forEach((li, idx) => {
      text += `${idx + 1}. ${li.textContent?.trim()}\n`;
    });
    text += "\n";
    const placeholder = document.createElement("p");
    placeholder.textContent = text;
    ol.replaceWith(placeholder);
  });

  // Process blockquotes
  body.querySelectorAll("blockquote").forEach((bq) => {
    const lines = (bq.textContent || "").split("\n");
    bq.textContent = lines.map((l) => `> ${l}`).join("\n") + "\n\n";
  });

  // Process tables
  body.querySelectorAll("table").forEach((table) => {
    const rows = table.querySelectorAll("tr");
    let md = "\n";
    rows.forEach((row, rowIdx) => {
      const cells = row.querySelectorAll("th, td");
      const cellTexts: string[] = [];
      cells.forEach((cell) => cellTexts.push((cell.textContent || "").trim()));
      md += `| ${cellTexts.join(" | ")} |\n`;
      if (rowIdx === 0) {
        md += `| ${cellTexts.map(() => "---").join(" | ")} |\n`;
      }
    });
    md += "\n";
    const placeholder = document.createElement("p");
    placeholder.textContent = md;
    table.replaceWith(placeholder);
  });

  // Get the final text, normalizing whitespace between blocks
  let text = body.textContent || "";
  // Clean up excessive newlines
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}
