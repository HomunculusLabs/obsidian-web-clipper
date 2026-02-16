/**
 * PDF Extraction Worker
 * 
 * This file is designed to run with Node.js (not Bun) for pdfjs-dist compatibility.
 * It's spawned as a child process by pdf-clip.ts.
 * 
 * Communication: Receives JSON on stdin, outputs JSON on stdout.
 */

const pdfjs = require("pdfjs-dist");
const fs = require("fs");
const path = require("path");

// Suppress worker errors
pdfjs.GlobalWorkerOptions.workerSrc = "";

/**
 * Extract text from PDF text content
 */
function extractTextFromTextContent(textContent) {
  const items = textContent?.items;
  if (!Array.isArray(items)) return "";

  const lines = [];
  let currentLine = "";

  for (const item of items) {
    let str = "";
    if (typeof item?.str === "string") {
      str = item.str;
    } else if (item?.str != null) {
      str = String(item.str);
    }
    const hasEOL = item?.hasEOL === true;

    if (str) {
      currentLine += str;
    }

    if (hasEOL) {
      const cleaned = currentLine.replace(/\s+/g, " ").trim();
      if (cleaned) lines.push(cleaned);
      currentLine = "";
      continue;
    }

    if (str) {
      currentLine += " ";
    }
  }

  const cleaned = currentLine.replace(/\s+/g, " ").trim();
  if (cleaned) lines.push(cleaned);

  return lines.join("\n");
}

/**
 * Parse page range string
 */
function parsePageRange(rangeStr, maxPage) {
  const pages = new Set();
  const parts = rangeStr.split(",").map((s) => s.trim());

  for (const part of parts) {
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-").map((s) => s.trim());
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.max(1, start); i <= Math.min(maxPage, end); i++) {
          pages.add(i);
        }
      }
    } else {
      const page = parseInt(part, 10);
      if (!isNaN(page) && page >= 1 && page <= maxPage) {
        pages.add(page);
      }
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Extract PDF content
 */
async function extractPdf(options) {
  const { source, pageRange, maxPages, maxChars } = options;

  let data;
  let isUrl = false;

  // Load PDF data
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    data = new Uint8Array(buffer);
    isUrl = true;
  } else {
    const filePath = path.resolve(source);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    data = new Uint8Array(fs.readFileSync(filePath));
  }

  // Load PDF
  const loadingTask = pdfjs.getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  });

  try {
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages || 0;

    // Extract metadata
    let info = null;
    try {
      info = await pdf.getMetadata();
    } catch {}

    const metadata = {
      title: info?.info?.Title || path.basename(source).replace(/\.pdf$/i, ""),
      author: info?.info?.Author || "",
      subject: info?.info?.Subject || "",
      creator: info?.info?.Creator || "",
      producer: info?.info?.Producer || "",
      creationDate: info?.info?.CreationDate || null,
      modifiedDate: info?.info?.ModDate || null,
      pageCount: totalPages,
    };

    // Determine which pages to extract
    let pagesToExtract;
    if (pageRange) {
      pagesToExtract = parsePageRange(pageRange, totalPages);
      if (pagesToExtract.length === 0) {
        throw new Error(`Invalid page range: ${pageRange}`);
      }
    } else {
      pagesToExtract = Array.from(
        { length: Math.min(totalPages, maxPages) },
        (_, i) => i + 1
      );
    }

    // Extract text
    let text = "";
    let truncated = false;
    let hasTextLayer = false;
    let remaining = maxChars;

    const append = (chunk) => {
      if (!chunk || truncated) return;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      if (chunk.length <= remaining) {
        text += chunk;
        remaining -= chunk.length;
        return;
      }
      text += chunk.slice(0, remaining);
      remaining = 0;
      truncated = true;
    };

    const extractedPages = [];

    for (const pageNumber of pagesToExtract) {
      if (truncated) break;

      const page = await pdf.getPage(pageNumber);
      try {
        const textContent = await page.getTextContent();
        const pageText = extractTextFromTextContent(textContent);

        if (!pageText.trim()) {
          continue;
        }

        hasTextLayer = true;
        extractedPages.push(pageNumber);
        append(`## Page ${pageNumber}\n\n`);
        append(pageText);
        append("\n\n");
      } finally {
        try {
          page.cleanup();
        } catch {}
      }
    }

    if (pagesToExtract.length > maxPages) {
      truncated = true;
    }

    return {
      success: true,
      result: {
        text: text.trimEnd(),
        pageCount: totalPages,
        extractedPages,
        truncated,
        hasTextLayer,
      },
      metadata,
      isUrl,
    };
  } finally {
    try {
      loadingTask.destroy();
    } catch {}
  }
}

// Main - read input from stdin
async function main() {
  let input = "";

  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  if (!input.trim()) {
    console.error("No input provided");
    process.exit(1);
  }

  try {
    const options = JSON.parse(input);
    const result = await extractPdf(options);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(
      JSON.stringify({
        success: false,
        error: error.message || String(error),
      })
    );
  }
}

main();
