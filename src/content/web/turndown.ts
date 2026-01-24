import TurndownService from "turndown";

// Initialize Turndown service at module load (bundled)
export const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_"
});

// Add custom rules for better markdown conversion
turndownService.addRule("strikethrough", {
  filter: (node: HTMLElement) => ["DEL", "S", "STRIKE"].includes(node.tagName),
  replacement: (content: string) => `~~${content}~~`
});

// Handle images with alt text
turndownService.addRule("images", {
  filter: "img",
  replacement: (_content: string, node: HTMLElement) => {
    const img = node as HTMLImageElement;
    const alt = img.alt || "";
    const src = img.src || "";
    const title = img.title || "";
    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  }
});