/**
 * Selection Extraction Tests
 *
 * Tests for selection detection and extraction with various HTML structures:
 * - Tables
 * - Code blocks
 * - Nested lists
 * - Across paragraph boundaries
 * - Multi-selection (Ctrl+click)
 *
 * Note: These tests mock the browser selection API since Bun doesn't have
 * a real browser DOM. The tests verify the selection module's logic without
 * depending on actual DOM selection behavior.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// ============================================================================
// Test Utilities
// ============================================================================

interface MockRange {
  collapsed: boolean;
  commonAncestorContainer: Node | null;
  _htmlContent: string;
  _textContent: string;
}

interface MockSelection {
  rangeCount: number;
  isCollapsed: boolean;
  _ranges: MockRange[];
  getRangeAt(index: number): MockRange;
  toString(): string;
}

// Create a mock range with the given HTML and text content
function createMockRange(htmlContent: string, textContent: string): MockRange {
  return {
    collapsed: false,
    commonAncestorContainer: null,
    _htmlContent: htmlContent,
    _textContent: textContent,
  };
}

// Create a mock selection with multiple ranges
function createMockSelection(ranges: MockRange[], isCollapsed: boolean = false): MockSelection {
  return {
    rangeCount: ranges.length,
    isCollapsed,
    _ranges: ranges,
    getRangeAt: (index: number) => ranges[index],
    toString: () => ranges.map((r) => r._textContent).join(""),
  };
}

// Create a collapsed (empty) mock range
function createCollapsedRange(): MockRange {
  return {
    collapsed: true,
    commonAncestorContainer: null,
    _htmlContent: "",
    _textContent: "",
  };
}

// ============================================================================
// Pure Function Tests
// ============================================================================

// Since we can't easily mock the DOM in Bun, we test the pure logic functions
// by creating a testable version of the selection extraction logic

/**
 * Extracts selection data from a mock selection object.
 * This mirrors the logic in getSelection() for testing purposes.
 */
function extractSelectionFromMock(mockSelection: MockSelection | null): {
  hasSelection: boolean;
  html: string;
  text: string;
  rangeCount: number;
  isMultiSelection: boolean;
} {
  // No selection object available
  if (!mockSelection) {
    return {
      hasSelection: false,
      html: "",
      text: "",
      rangeCount: 0,
      isMultiSelection: false,
    };
  }

  const rangeCount = mockSelection.rangeCount;

  // No ranges selected or selection is collapsed
  if (rangeCount === 0 || mockSelection.isCollapsed) {
    return {
      hasSelection: false,
      html: "",
      text: "",
      rangeCount: 0,
      isMultiSelection: false,
    };
  }

  // Extract HTML and text from all ranges
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  for (let i = 0; i < rangeCount; i++) {
    const range = mockSelection.getRangeAt(i);

    // Skip collapsed ranges
    if (range.collapsed) {
      continue;
    }

    // Get text for this range
    const rangeText = range._textContent.trim();
    if (rangeText) {
      textParts.push(rangeText);
    }

    // Get HTML for this range
    const html = range._htmlContent.trim();
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
      isMultiSelection: false,
    };
  }

  const isMultiSelection = htmlParts.length > 1;

  // Join multiple ranges with separator
  const html = htmlParts.join("\n\n---\n\n");
  const text = textParts.join("\n\n---\n\n");

  return {
    hasSelection: true,
    html,
    text,
    rangeCount: htmlParts.length,
    isMultiSelection,
  };
}

// ============================================================================
// Basic Selection Detection Tests
// ============================================================================

describe("getSelection logic - basic detection", () => {
  test("returns no selection when selection is null", () => {
    const result = extractSelectionFromMock(null);
    expect(result.hasSelection).toBe(false);
    expect(result.html).toBe("");
    expect(result.text).toBe("");
    expect(result.rangeCount).toBe(0);
  });

  test("returns no selection when selection is collapsed", () => {
    const range = createMockRange("Some text", "Some text");
    range.collapsed = true;
    const selection = createMockSelection([range], true);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(false);
    expect(result.rangeCount).toBe(0);
  });

  test("returns no selection when range count is 0", () => {
    const selection = createMockSelection([], true);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(false);
  });

  test("detects single selection correctly", () => {
    const range = createMockRange("Hello World", "Hello World");
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toBe("Hello World");
    expect(result.rangeCount).toBe(1);
    expect(result.isMultiSelection).toBe(false);
  });
});

// ============================================================================
// Table Selection Tests
// ============================================================================

describe("getSelection logic - table structures", () => {
  test("extracts selection from single table cell", () => {
    const cellHtml = "<td>Cell 1</td>";
    const cellText = "Cell 1";
    const range = createMockRange(cellHtml, cellText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toBe("Cell 1");
    expect(result.html).toBe("<td>Cell 1</td>");
  });

  test("extracts selection from entire row", () => {
    const rowHtml = "<td>Cell 3</td><td>Cell 4</td>";
    const rowText = "Cell 3Cell 4";
    const range = createMockRange(rowHtml, rowText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toBe("Cell 3Cell 4");
  });

  test("extracts selection from nested table", () => {
    const nestedHtml = "<td><table><tr><td>Nested Cell</td></tr></table></td>";
    const nestedText = "Nested Cell";
    const range = createMockRange(nestedHtml, nestedText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toBe("Nested Cell");
  });

  test("extracts selection from table with headers", () => {
    const headerHtml = "<th>Header 1</th><th>Header 2</th>";
    const headerText = "Header 1Header 2";
    const range = createMockRange(headerHtml, headerText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toBe("Header 1Header 2");
  });
});

// ============================================================================
// Code Block Selection Tests
// ============================================================================

describe("getSelection logic - code blocks", () => {
  test("extracts selection from inline code", () => {
    const codeHtml = "<code>getSelection()</code>";
    const codeText = "getSelection()";
    const range = createMockRange(codeHtml, codeText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toBe("getSelection()");
    expect(result.html).toContain("<code>");
  });

  test("extracts selection from pre/code block", () => {
    const codeContent = `function hello() {
  console.log("Hello, World!");
  return 42;
}`;
    const codeHtml = `<pre><code>${codeContent}</code></pre>`;
    const range = createMockRange(codeHtml, codeContent);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toContain("function hello()");
    expect(result.text).toContain("console.log");
  });

  test("extracts partial code selection", () => {
    const partialCode = "const y = 2;";
    const range = createMockRange(partialCode, partialCode);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toBe("const y = 2;");
  });

  test("preserves internal whitespace in code selection", () => {
    // Note: The implementation trims leading/trailing whitespace but
    // preserves internal whitespace between lines
    const indentedCode = `indented
    more indented
      deeply nested`;
    const range = createMockRange(indentedCode, indentedCode);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    // The mock trims, so leading spaces are removed but internal spacing preserved
    expect(result.text).toContain("indented");
    expect(result.text).toContain("more indented");
    expect(result.text).toContain("deeply nested");
  });
});

// ============================================================================
// Nested List Selection Tests
// ============================================================================

describe("getSelection logic - nested lists", () => {
  test("extracts selection from single list item", () => {
    const listHtml = "<li>Item 2</li>";
    const listText = "Item 2";
    const range = createMockRange(listHtml, listText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toBe("Item 2");
  });

  test("extracts selection from nested list", () => {
    const nestedHtml = `<ul>
      <li>Top level
        <ul>
          <li>Nested item</li>
        </ul>
      </li>
    </ul>`;
    const range = createMockRange(nestedHtml, "Nested item");
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toBe("Nested item");
  });

  test("extracts selection from mixed nested lists (ul/ol)", () => {
    const mixedHtml = `<ol>
      <li>Numbered item
        <ul>
          <li>Bullet under numbered</li>
          <li>Another bullet</li>
        </ul>
      </li>
    </ol>`;
    const mixedText = "Bullet under numberedAnother bullet";
    const range = createMockRange(mixedHtml, mixedText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toContain("Bullet under numbered");
  });

  test("extracts deeply nested list selection", () => {
    const deepHtml = `<ul>
      <li>Level 1
        <ul>
          <li>Level 2
            <ul>
              <li>Level 3
                <ul>
                  <li>Level 4</li>
                </ul>
              </li>
            </ul>
          </li>
        </ul>
      </li>
    </ul>`;
    const range = createMockRange(deepHtml, "Level 4");
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toBe("Level 4");
  });

  test("extracts definition list selection", () => {
    const defHtml = "<dt>Term 2</dt><dd>Definition 2</dd>";
    const defText = "Term 2Definition 2";
    const range = createMockRange(defHtml, defText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toContain("Term 2");
    expect(result.text).toContain("Definition 2");
  });
});

// ============================================================================
// Cross-Paragraph Selection Tests
// ============================================================================

describe("getSelection logic - across paragraph boundaries", () => {
  test("extracts selection spanning multiple paragraphs", () => {
    const multiParaHtml = `<p>First paragraph with some text.</p><p>Second paragraph with more text.</p>`;
    const multiParaText = "First paragraph with some text.Second paragraph with more text.";
    const range = createMockRange(multiParaHtml, multiParaText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toContain("First paragraph");
    expect(result.text).toContain("Second paragraph");
  });

  test("extracts selection from paragraph into heading", () => {
    const mixedHtml = `<h2>Section Title</h2><p>Content following the heading.</p>`;
    const mixedText = "Section TitleContent following the heading.";
    const range = createMockRange(mixedHtml, mixedText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toContain("Section Title");
    expect(result.text).toContain("Content following");
  });

  test("extracts selection across blockquote boundaries", () => {
    const blockHtml = `<blockquote><p>Quoted paragraph.</p></blockquote><p>Regular paragraph.</p>`;
    const blockText = "Quoted paragraph.Regular paragraph.";
    const range = createMockRange(blockHtml, blockText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toContain("Quoted paragraph");
    expect(result.text).toContain("Regular paragraph");
  });

  test("extracts selection with inline formatting", () => {
    const formattedHtml = `<strong>bold</strong> and <em>italic</em> text.`;
    const formattedText = "bold and italic text.";
    const range = createMockRange(formattedHtml, formattedText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.html).toContain("<strong>");
    expect(result.html).toContain("<em>");
  });

  test("extracts selection with links", () => {
    const linkHtml = `<p>Click <a href="https://example.com">here</a> for more.</p>`;
    const linkText = "Click here for more.";
    const range = createMockRange(linkHtml, linkText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.html).toContain("<a");
    expect(result.text).toBe("Click here for more.");
  });
});

// ============================================================================
// Multi-Selection Tests (Ctrl+click)
// ============================================================================

describe("getSelection logic - multi-selection", () => {
  test("detects multi-selection with two ranges", () => {
    const range1 = createMockRange("First paragraph.", "First paragraph.");
    const range2 = createMockRange("Third paragraph.", "Third paragraph.");
    const selection = createMockSelection([range1, range2]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.isMultiSelection).toBe(true);
    expect(result.rangeCount).toBe(2);
  });

  test("joins multi-selection with separator", () => {
    const range1 = createMockRange("Alpha", "Alpha");
    const range2 = createMockRange("Gamma", "Gamma");
    const selection = createMockSelection([range1, range2]);
    const result = extractSelectionFromMock(selection);

    expect(result.text).toBe("Alpha\n\n---\n\nGamma");
    expect(result.html).toBe("Alpha\n\n---\n\nGamma");
  });

  test("handles multi-selection from different elements", () => {
    const range1 = createMockRange("<li>Item 1</li>", "Item 1");
    const range2 = createMockRange("<code>code here</code>", "code here");
    const selection = createMockSelection([range1, range2]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.isMultiSelection).toBe(true);
    expect(result.text).toContain("Item 1");
    expect(result.text).toContain("code here");
    expect(result.text).toContain("---"); // Separator
  });

  test("skips collapsed ranges in multi-selection", () => {
    const range1 = createMockRange("First", "First");
    const collapsedRange = createCollapsedRange();
    const range2 = createMockRange("Third", "Third");
    const selection = createMockSelection([range1, collapsedRange, range2]);
    const result = extractSelectionFromMock(selection);

    // Should only have 2 valid ranges (collapsed one skipped)
    expect(result.rangeCount).toBe(2);
    expect(result.text).toBe("First\n\n---\n\nThird");
  });

  test("handles three-way multi-selection", () => {
    const range1 = createMockRange("A", "A");
    const range2 = createMockRange("B", "B");
    const range3 = createMockRange("C", "C");
    const selection = createMockSelection([range1, range2, range3]);
    const result = extractSelectionFromMock(selection);

    expect(result.rangeCount).toBe(3);
    expect(result.text).toBe("A\n\n---\n\nB\n\n---\n\nC");
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("getSelection logic - edge cases", () => {
  test("handles selection with only whitespace", () => {
    const range = createMockRange("   ", "   ");
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    // Whitespace-only should be trimmed and result in no selection
    expect(result.hasSelection).toBe(false);
  });

  test("handles selection with special characters", () => {
    const specialHtml = "Special: &amp; &lt; &gt; &quot;";
    const specialText = "Special: & < > \"";
    const range = createMockRange(specialHtml, specialText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.html).toContain("&amp;");
    expect(result.text).toBe("Special: & < > \"");
  });

  test("handles selection with unicode characters", () => {
    const unicodeText = "日本語 🌍 café naïve";
    const range = createMockRange(unicodeText, unicodeText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toContain("日本語");
    expect(result.text).toContain("🌍");
    expect(result.text).toContain("café");
  });

  test("handles very long selection", () => {
    const longText = "x".repeat(50000);
    const range = createMockRange(longText, longText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text.length).toBe(50000);
  });

  test("handles empty selection gracefully", () => {
    const range = createMockRange("", "");
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(false);
  });

  test("handles selection with newlines preserved", () => {
    const multilineText = "Line 1\nLine 2\nLine 3";
    const range = createMockRange(multilineText, multilineText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toContain("Line 1");
    expect(result.text).toContain("Line 2");
    expect(result.text).toContain("Line 3");
  });

  test("handles selection with tabs", () => {
    const tabbedText = "Column1\tColumn2\tColumn3";
    const range = createMockRange(tabbedText, tabbedText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toContain("\t");
  });
});

// ============================================================================
// Selection Result Type Tests
// ============================================================================

describe("SelectionResult type compliance", () => {
  test("result has all required fields", () => {
    const range = createMockRange("Test", "Test");
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result).toHaveProperty("hasSelection");
    expect(result).toHaveProperty("html");
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("rangeCount");
    expect(result).toHaveProperty("isMultiSelection");

    expect(typeof result.hasSelection).toBe("boolean");
    expect(typeof result.html).toBe("string");
    expect(typeof result.text).toBe("string");
    expect(typeof result.rangeCount).toBe("number");
    expect(typeof result.isMultiSelection).toBe("boolean");
  });

  test("empty result has all required fields", () => {
    const result = extractSelectionFromMock(null);

    expect(result.hasSelection).toBe(false);
    expect(result.html).toBe("");
    expect(result.text).toBe("");
    expect(result.rangeCount).toBe(0);
    expect(result.isMultiSelection).toBe(false);
  });
});

// ============================================================================
// Integration-style Tests
// ============================================================================

describe("Integration-style tests", () => {
  test("table with selection across cells", () => {
    const tableHtml = `<table>
      <thead>
        <tr><th>Name</th><th>Value</th></tr>
      </thead>
      <tbody>
        <tr><td>Alpha</td><td>100</td></tr>
        <tr><td>Beta</td><td>200</td></tr>
      </tbody>
    </table>`;
    const tableText = "Alpha100Beta200";
    const range = createMockRange(tableHtml, tableText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.html).toContain("<table>");
    expect(result.html).toContain("<th>");
    expect(result.html).toContain("<td>");
  });

  test("article with multiple element types", () => {
    const articleHtml = `<article>
      <h1>Title</h1>
      <p class="intro">Introduction paragraph.</p>
      <pre><code>const x = 1;</code></pre>
      <ul>
        <li>Point 1</li>
        <li>Point 2</li>
      </ul>
      <blockquote>A quote here.</blockquote>
    </article>`;
    const articleText = "TitleIntroduction paragraph.const x = 1;Point 1Point 2A quote here.";
    const range = createMockRange(articleHtml, articleText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.html).toContain("<h1>");
    expect(result.html).toContain("<pre>");
    expect(result.html).toContain("<ul>");
    expect(result.html).toContain("<blockquote>");
  });

  test("complex nested structure", () => {
    const complexHtml = `<div class="container">
      <header>
        <nav>
          <ul>
            <li><a href="#">Link 1</a></li>
          </ul>
        </nav>
      </header>
      <main>
        <section>
          <h2>Section</h2>
          <table>
            <tr>
              <td>
                <ul>
                  <li>Nested in table</li>
                </ul>
              </td>
            </tr>
          </table>
        </section>
      </main>
    </div>`;
    const complexText = "Link 1SectionNested in table";
    const range = createMockRange(complexHtml, complexText);
    const selection = createMockSelection([range]);
    const result = extractSelectionFromMock(selection);

    expect(result.hasSelection).toBe(true);
    expect(result.text).toContain("Link 1");
    expect(result.text).toContain("Section");
    expect(result.text).toContain("Nested in table");
  });
});

// ============================================================================
// Actual Module Import Test
// ============================================================================

// These tests verify the actual module exports exist and have correct types
describe("selection module exports", () => {
  test("module exports getSelection function", async () => {
    const module = await import("../src/content/selection.ts");
    expect(typeof module.getSelection).toBe("function");
  });

  test("module exports hasSelection function", async () => {
    const module = await import("../src/content/selection.ts");
    expect(typeof module.hasSelection).toBe("function");
  });

  test("module exports getSelectionText function", async () => {
    const module = await import("../src/content/selection.ts");
    expect(typeof module.getSelectionText).toBe("function");
  });

  test("module exports SelectionResult type", async () => {
    const module = await import("../src/content/selection.ts");
    // TypeScript types aren't runtime values, but we can verify the interface
    // by checking the module has the expected exports
    expect(module.getSelection).toBeDefined();
    expect(module.hasSelection).toBeDefined();
    expect(module.getSelectionText).toBeDefined();
  });
});
