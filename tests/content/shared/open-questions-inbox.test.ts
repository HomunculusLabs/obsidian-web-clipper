/**
 * Tests for Open Questions Inbox Builder
 *
 * Tests the extraction, parsing, and building utilities for the Open Questions Inbox.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  parseFrontmatter,
  parseClipBriefSection,
  clipBriefToInputs,
  extractOpenQuestionsFromNote,
  scanVaultForOpenQuestions,
  type ScanVaultOptions,
  type ParsedClipBrief
} from "../../../src/shared/openQuestionsInboxBuilder";
import type { OpenQuestionInput, OpenQuestionsInbox } from "../../../src/shared/openQuestionsInboxContract";
import { QuestionStatus } from "../../../src/shared/openQuestionsInboxContract";
import { buildOpenQuestionsInbox, renderOpenQuestionsInbox } from "../../../src/shared/openQuestionsInboxContract";
import {
  resolveInboxPath,
  isInboxEmpty,
  renderEmptyInbox,
  exportOpenQuestionsInbox,
  exportEmptyInbox,
  inboxFileExists,
  readInboxFile,
  deleteInboxFile,
  getDefaultExportOptions,
  DEFAULT_INBOX_FILENAME,
  type ExportInboxOptions,
  type ExportInboxResult
} from "../../../src/shared/openQuestionsInboxExporter";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

describe("parseFrontmatter", () => {
  it("should parse simple YAML frontmatter", () => {
    const content = `---
title: Test Note
source: https://example.com
date_clipped: 2026-03-03T10:00:00.000Z
tags: [tag1, tag2]
---

# Body`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result?.title).toBe("Test Note");
    expect(result?.source).toBe("https://example.com");
    expect(result?.date_clipped).toBe("2026-03-03T10:00:00.000Z");
    expect(result?.tags).toEqual(["tag1", "tag2"]);
  });

  it("should return null when no frontmatter present", () => {
    const content = "# Body without frontmatter";
    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it("should return null when frontmatter is not at start", () => {
    const content = `# Title
---
title: Test Note
---`;
    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it("should handle boolean values", () => {
    const content = `---
flag_true: true
flag_false: false
---

# Body`;
    const result = parseFrontmatter(content);
    expect(result?.flag_true).toBe(true);
    expect(result?.flag_false).toBe(false);
  });

  it("should handle numeric values", () => {
    const content = `---
count: 42
price: 19.99
---

# Body`;
    const result = parseFrontmatter(content);
    expect(result?.count).toBe(42);
    expect(result?.price).toBe(19.99);
  });

  it("should handle multiline arrays", () => {
    const content = `---
tags:
  - tag1
  - tag2
  - tag3
---

# Body`;
    const result = parseFrontmatter(content);
    expect(result?.tags).toEqual(["tag1", "tag2", "tag3"]);
  });

  it("should handle inline arrays", () => {
    const content = `---
tags: [tag1, tag2, tag3]
---

# Body`;
    const result = parseFrontmatter(content);
    expect(result?.tags).toEqual(["tag1", "tag2", "tag3"]);
  });

  it("should handle empty arrays", () => {
    const content = `---
tags: []
---

# Body`;
    const result = parseFrontmatter(content);
    expect(result?.tags).toEqual([]);
  });
});

describe("parseClipBriefSection", () => {
  it("should parse Clip Brief section with Open Questions", () => {
    const content = `---
title: Test Clip
source: https://example.com/article
date_clipped: 2026-03-03T10:00:00.000Z
---

# Article Content

## Clip Brief

### Open Questions

- What is the best approach for X?
- How should I implement Y?
- ~~Is Z necessary?~~

### Action Items

- Action item 1
`;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.noteTitle).toBe("Test Clip");
      expect(result.sourceUrl).toBe("https://example.com/article");
      expect(result.timestamp).toBe("2026-03-03T10:00:00.000Z");
      expect(result.openQuestions).toHaveLength(3);

      expect(result.openQuestions[0]?.question).toBe("What is the best approach for X?");
      expect(result.openQuestions[0]?.status).toBe(QuestionStatus.UNRESOLVED);

      expect(result.openQuestions[1]?.question).toBe("How should I implement Y?");
      expect(result.openQuestions[1]?.status).toBe(QuestionStatus.UNRESOLVED);

      expect(result.openQuestions[2]?.question).toBe("Is Z necessary?");
      expect(result.openQuestions[2]?.status).toBe(QuestionStatus.RESOLVED);
    }
  });

  it("should return null when no Clip Brief section exists", () => {
    const content = `---
title: Test Note
---

# Content without Clip Brief`;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).toBeNull();
  });

  it("should handle empty Open Questions list", () => {
    const content = `---
title: Test Clip
---

## Clip Brief

### Open Questions

### Action Items
- Some action`;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.openQuestions).toHaveLength(0);
    }
  });

  it("should use filename as title when frontmatter title is missing", () => {
    const content = `---
source: https://example.com
---

## Clip Brief

### Open Questions

- Test question?`;

    const result = parseClipBriefSection(content, "/path/to/MyNote.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.noteTitle).toBe("MyNote");
    }
  });

  it("should handle case-insensitive section headings", () => {
    const content = `---
title: Test
---

## clip brief

### open questions

- Question 1?
- Question 2?`;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.openQuestions).toHaveLength(2);
    }
  });

  it("should skip non-list items in Open Questions", () => {
    const content = `---
title: Test
---

## Clip Brief

### Open Questions

- Valid question 1?
This is not a list item
- Valid question 2?
### Another Section`;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.openQuestions).toHaveLength(2);
      expect(result.openQuestions[0]?.question).toBe("Valid question 1?");
      expect(result.openQuestions[1]?.question).toBe("Valid question 2?");
    }
  });

  it("should strip whitespace from questions", () => {
    const content = `---
title: Test
---

## Clip Brief

### Open Questions

-  What is the question?  
-   Another question?  `;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.openQuestions[0]?.question).toBe("What is the question?");
      expect(result.openQuestions[1]?.question).toBe("Another question?");
    }
  });
});

describe("clipBriefToInputs", () => {
  it("should convert ParsedClipBrief to OpenQuestionInput array", () => {
    const clipBrief: ParsedClipBrief = {
      noteTitle: "Test Clip",
      sourceUrl: "https://example.com",
      timestamp: "2026-03-03T10:00:00.000Z",
      openQuestions: [
        {
          question: "Question 1?",
          status: QuestionStatus.UNRESOLVED,
          lineNumber: 10
        },
        {
          question: "Question 2?",
          status: QuestionStatus.RESOLVED,
          lineNumber: 11
        }
      ]
    };

    const result = clipBriefToInputs(clipBrief, "/path/to/clip.md");

    expect(result).toHaveLength(2);

    expect(result[0]?.question).toBe("Question 1?");
    expect(result[0]?.clipPath).toBe("/path/to/clip.md");
    expect(result[0]?.clipTitle).toBe("Test Clip");
    expect(result[0]?.clipUrl).toBe("https://example.com");
    expect(result[0]?.clipTimestamp).toBe("2026-03-03T10:00:00.000Z");
    expect(result[0]?.clipId).toBe("/path/to/clip.md");
    expect(result[0]?.status).toBe(QuestionStatus.UNRESOLVED);

    expect(result[1]?.question).toBe("Question 2?");
    expect(result[1]?.status).toBe(QuestionStatus.RESOLVED);
  });

  it("should handle empty open questions", () => {
    const clipBrief: ParsedClipBrief = {
      noteTitle: "Test Clip",
      sourceUrl: "https://example.com",
      timestamp: "2026-03-03T10:00:00.000Z",
      openQuestions: []
    };

    const result = clipBriefToInputs(clipBrief, "/path/to/clip.md");
    expect(result).toHaveLength(0);
  });
});

describe("extractOpenQuestionsFromNote", () => {
  it("should extract questions from a complete note", () => {
    const content = `---
title: Complete Note
source: https://example.com
date_clipped: 2026-03-03T10:00:00.000Z
---

# Article Title

Some content here.

## Clip Brief

### Open Questions

- How does X work?
- What about Y?
- ~~Is Z deprecated?~~

## Another Section

More content.`;

    const result = extractOpenQuestionsFromNote(content, "/path/to/note.md");

    expect(result).toHaveLength(3);
    expect(result[0]?.question).toBe("How does X work?");
    expect(result[1]?.question).toBe("What about Y?");
    expect(result[2]?.question).toBe("Is Z deprecated?");
    expect(result[2]?.status).toBe(QuestionStatus.RESOLVED);
  });

  it("should return empty array for note without Clip Brief", () => {
    const content = `---
title: No Brief
---

# Just content`;

    const result = extractOpenQuestionsFromNote(content, "/path/to/note.md");
    expect(result).toHaveLength(0);
  });
});

describe("scanVaultForOpenQuestions", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = path.join(os.tmpdir(), `open-questions-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  it("should scan a vault directory for Open Questions", async () => {
    // Create test notes
    const note1Content = `---
title: Note 1
source: https://example.com/1
date_clipped: 2026-03-03T10:00:00.000Z
---

## Clip Brief

### Open Questions

- Question 1?
- Question 2?`;

    const note2Content = `---
title: Note 2
source: https://example.com/2
date_clipped: 2026-03-03T11:00:00.000Z
---

## Clip Brief

### Open Questions

- Question 3?
- ~~Question 4?~~`;

    const note3Content = `---
title: No Brief
---

# Just content`;

    await fs.writeFile(path.join(tempDir, "note1.md"), note1Content);
    await fs.writeFile(path.join(tempDir, "note2.md"), note2Content);
    await fs.writeFile(path.join(tempDir, "note3.md"), note3Content);

    const options: ScanVaultOptions = {
      vaultPath: tempDir
    };

    const result = await scanVaultForOpenQuestions(options);

    expect(result.filesScanned).toBe(3);
    expect(result.filesWithClipBrief).toBe(2);
    expect(result.filesWithOpenQuestions).toBe(2);
    expect(result.filesSkipped).toBe(1);
    expect(result.questions).toHaveLength(4);

    // Check questions are sorted deterministically
    expect(result.questions[0]?.question).toBe("Question 1?");
    expect(result.questions[1]?.question).toBe("Question 2?");
    expect(result.questions[2]?.question).toBe("Question 3?");
    expect(result.questions[3]?.question).toBe("Question 4?");
    expect(result.questions[3]?.status).toBe(QuestionStatus.RESOLVED);

    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should filter by file extension", async () => {
    const noteContent = `---
title: Test
---

## Clip Brief

### Open Questions

- Question?`;

    await fs.writeFile(path.join(tempDir, "note.md"), noteContent);
    await fs.writeFile(path.join(tempDir, "note.txt"), "not markdown");

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      extensions: [".md"]
    };

    const result = await scanVaultForOpenQuestions(options);

    expect(result.filesScanned).toBe(1);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should filter by minDate", async () => {
    const noteContent = `---
title: Test
date_clipped: 2026-03-03T10:00:00.000Z
---

## Clip Brief

### Open Questions

- Question?`;

    const filePath = path.join(tempDir, "note.md");
    await fs.writeFile(filePath, noteContent);

    // Set mtime to an old date
    const oldDate = new Date("2026-01-01T00:00:00.000Z");
    await fs.utimes(filePath, oldDate, oldDate);

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      minDate: "2026-03-01T00:00:00.000Z"
    };

    const result = await scanVaultForOpenQuestions(options);

    expect(result.filesScanned).toBe(0);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should filter by required tags", async () => {
    const note1Content = `---
title: Note 1
tags: [important, research]
---

## Clip Brief

### Open Questions

- Question 1?`;

    const note2Content = `---
title: Note 2
tags: [other]
---

## Clip Brief

### Open Questions

- Question 2?`;

    await fs.writeFile(path.join(tempDir, "note1.md"), note1Content);
    await fs.writeFile(path.join(tempDir, "note2.md"), note2Content);

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      requiredTags: ["important"]
    };

    const result = await scanVaultForOpenQuestions(options);

    expect(result.filesScanned).toBe(2); // Both files scanned
    expect(result.filesSkipped).toBe(1); // One skipped due to missing tag
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.question).toBe("Question 1?");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should limit scan with maxFiles", async () => {
    const noteContent = `---
title: Test
---

## Clip Brief

### Open Questions

- Question?`;

    await fs.writeFile(path.join(tempDir, "a.md"), noteContent);
    await fs.writeFile(path.join(tempDir, "b.md"), noteContent);
    await fs.writeFile(path.join(tempDir, "c.md"), noteContent);

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      maxFiles: 2
    };

    const result = await scanVaultForOpenQuestions(options);

    expect(result.filesScanned).toBe(2);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should scan subdirectories recursively", async () => {
    const noteContent = `---
title: Test
---

## Clip Brief

### Open Questions

- Question?`;

    await fs.writeFile(path.join(tempDir, "root.md"), noteContent);
    await fs.mkdir(path.join(tempDir, "subdir"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "subdir", "nested.md"), noteContent);

    const options: ScanVaultOptions = {
      vaultPath: tempDir
    };

    const result = await scanVaultForOpenQuestions(options);

    expect(result.filesScanned).toBe(2);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should handle maxDepth option", async () => {
    const noteContent = `---
title: Test
---

## Clip Brief

### Open Questions

- Question?`;

    await fs.writeFile(path.join(tempDir, "root.md"), noteContent);
    await fs.mkdir(path.join(tempDir, "subdir"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "subdir", "nested"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "subdir", "level1.md"), noteContent);
    await fs.writeFile(path.join(tempDir, "subdir", "nested", "level2.md"), noteContent);

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      maxDepth: 1 // Only root + 1 level deep
    };

    const result = await scanVaultForOpenQuestions(options);

    expect(result.filesScanned).toBe(2); // root.md and level1.md

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should exclude hidden files by default", async () => {
    const noteContent = `---
title: Test
---

## Clip Brief

### Open Questions

- Question?`;

    await fs.writeFile(path.join(tempDir, "visible.md"), noteContent);
    await fs.writeFile(path.join(tempDir, ".hidden.md"), noteContent);

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      includeHidden: false
    };

    const result = await scanVaultForOpenQuestions(options);

    expect(result.filesScanned).toBe(1);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should include hidden files when includeHidden is true", async () => {
    const noteContent = `---
title: Test
---

## Clip Brief

### Open Questions

- Question?`;

    await fs.writeFile(path.join(tempDir, "visible.md"), noteContent);
    await fs.writeFile(path.join(tempDir, ".hidden.md"), noteContent);

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      includeHidden: true
    };

    const result = await scanVaultForOpenQuestions(options);

    expect(result.filesScanned).toBe(2);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should handle read errors gracefully", async () => {
    const noteContent = `---
title: Test
---

## Clip Brief

### Open Questions

- Question?`;

    await fs.writeFile(path.join(tempDir, "good.md"), noteContent);
    await fs.writeFile(path.join(tempDir, "unreadable.md"), noteContent);
    await fs.chmod(path.join(tempDir, "unreadable.md"), 0o000);

    const options: ScanVaultOptions = {
      vaultPath: tempDir
    };

    const result = await scanVaultForOpenQuestions(options);

    expect(result.filesScanned).toBe(2); // Both files attempted
    expect(result.filesWithClipBrief).toBe(1); // Only one parsed successfully
    expect(result.errors).toHaveLength(1);

    // Restore permissions for cleanup
    await fs.chmod(path.join(tempDir, "unreadable.md"), 0o644);
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});

describe("buildOpenQuestionsInbox", () => {
  it("should build inbox with deduplication", () => {
    const inputs: OpenQuestionInput[] = [
      {
        question: "What is X?",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: QuestionStatus.UNRESOLVED
      },
      {
        question: "What is X?",  // Duplicate
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T11:00:00.000Z",
        clipId: "clip2",
        status: QuestionStatus.UNRESOLVED
      },
      {
        question: "How to do Y?",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: QuestionStatus.UNRESOLVED
      }
    ];

    const inbox = buildOpenQuestionsInbox(inputs);

    expect(inbox.entries).toHaveLength(2); // 2 unique questions
    expect(inbox.totalQuestions).toBe(2);
    expect(inbox.unresolvedQuestions).toBe(2);
    expect(inbox.totalClips).toBe(2);
    expect(inbox.totalQuestionInstances).toBe(3);

    // Check that duplicate was merged
    const duplicateEntry = inbox.entries.find(e => e.question === "What is X?");
    expect(duplicateEntry?.source_clip_count).toBe(2);
    expect(duplicateEntry?.source_clip_refs).toHaveLength(2);
  });

  it("should filter out resolved questions", () => {
    const inputs: OpenQuestionInput[] = [
      {
        question: "Question 1?",
        clipPath: "/path/to/clip.md",
        clipTitle: "Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: QuestionStatus.UNRESOLVED
      },
      {
        question: "Question 2?",
        clipPath: "/path/to/clip.md",
        clipTitle: "Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: QuestionStatus.RESOLVED
      }
    ];

    const inbox = buildOpenQuestionsInbox(inputs);

    expect(inbox.entries).toHaveLength(1); // Only unresolved
    expect(inbox.unresolvedQuestions).toBe(1);
    expect(inbox.resolvedQuestions).toBe(1);
    expect(inbox.entries[0]?.question).toBe("Question 1?");
  });

  it("should handle empty inputs", () => {
    const inbox = buildOpenQuestionsInbox([]);

    expect(inbox.entries).toHaveLength(0);
    expect(inbox.totalQuestions).toBe(0);
    expect(inbox.unresolvedQuestions).toBe(0);
    expect(inbox.resolvedQuestions).toBe(0);
    expect(inbox.totalClips).toBe(0);
    expect(inbox.totalQuestionInstances).toBe(0);
    expect(inbox.truncated).toBe(false);
  });
});

describe("renderOpenQuestionsInbox", () => {
  it("should render a complete inbox with questions", () => {
    const inputs: OpenQuestionInput[] = [
      {
        question: "What is the best approach?",
        clipPath: "/path/to/clip.md",
        clipTitle: "Test Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: QuestionStatus.UNRESOLVED
      }
    ];

    const inbox = buildOpenQuestionsInbox(inputs);
    const markdown = renderOpenQuestionsInbox(inbox);

    // Check frontmatter is present
    expect(markdown).toContain("---");
    expect(markdown).toContain("inbox_version:");
    expect(markdown).toContain("questions_count: 1");
    expect(markdown).toContain("source_clips_processed: 1");
    expect(markdown).toContain("unresolved_questions: 1");
    expect(markdown).toContain("inbox_truncated: false");

    // Check body structure
    expect(markdown).toContain("# Open Questions Inbox");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Questions");
    expect(markdown).toContain("What is the best approach?");
    expect(markdown).toContain("[[Test Clip|/path/to/clip.md]]");
  });

  it("should render empty inbox with explicit empty-state behavior", () => {
    const inbox = buildOpenQuestionsInbox([]);
    const markdown = renderOpenQuestionsInbox(inbox);

    // Check frontmatter is present with explicit zero values
    expect(markdown).toContain("---");
    expect(markdown).toContain("inbox_version:");
    expect(markdown).toContain("questions_count: 0");
    expect(markdown).toContain("source_clips_processed: 0");
    expect(markdown).toContain("unresolved_questions: 0");
    expect(markdown).toContain("resolved_questions: 0");
    expect(markdown).toContain("inbox_truncated: false");

    // Check body structure with empty state message
    expect(markdown).toContain("# Open Questions Inbox");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Questions");
    expect(markdown).toContain("> No unresolved questions found.");
  });

  it("should render truncation warning when inbox is truncated", () => {
    // Create more than MAX_INBOX_QUESTIONS questions
    const inputs: OpenQuestionInput[] = [];
    for (let i = 0; i < 110; i++) {
      inputs.push({
        question: `Question ${i}?`,
        clipPath: `/path/to/clip${i}.md`,
        clipTitle: `Clip ${i}`,
        clipUrl: `https://example.com/${i}`,
        clipTimestamp: `2026-03-03T10:00:00.000Z`,
        clipId: `clip${i}`,
        status: QuestionStatus.UNRESOLVED
      });
    }

    const inbox = buildOpenQuestionsInbox(inputs);
    const markdown = renderOpenQuestionsInbox(inbox);

    // Check truncation is indicated
    expect(markdown).toContain("inbox_truncated: true");
    expect(markdown).toContain("Inbox truncated to 100 questions");
  });

  it("should render resolved question count in summary", () => {
    const inputs: OpenQuestionInput[] = [
      {
        question: "Unresolved?",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: QuestionStatus.UNRESOLVED
      },
      {
        question: "Resolved?",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: QuestionStatus.RESOLVED
      }
    ];

    const inbox = buildOpenQuestionsInbox(inputs);
    const markdown = renderOpenQuestionsInbox(inbox);

    expect(markdown).toContain("**Resolved:** 1");
    expect(markdown).toContain("unresolved_questions: 1");
    expect(markdown).toContain("resolved_questions: 1");
  });
});

describe("resolveInboxPath", () => {
  it("should resolve to vault root by default", () => {
    const options: ExportInboxOptions = {
      vaultPath: "/path/to/vault"
    };

    const result = resolveInboxPath(options);

    expect(result).toBe(path.join("/path/to/vault", DEFAULT_INBOX_FILENAME));
  });

  it("should resolve to custom folder when specified", () => {
    const options: ExportInboxOptions = {
      vaultPath: "/path/to/vault",
      inboxFolder: "Inbox"
    };

    const result = resolveInboxPath(options);

    expect(result).toBe(path.join("/path/to/vault", "Inbox", DEFAULT_INBOX_FILENAME));
  });

  it("should resolve to custom filename when specified", () => {
    const options: ExportInboxOptions = {
      vaultPath: "/path/to/vault",
      inboxFilename: "my-questions.md"
    };

    const result = resolveInboxPath(options);

    expect(result).toBe(path.join("/path/to/vault", "my-questions.md"));
  });

  it("should handle nested folder paths", () => {
    const options: ExportInboxOptions = {
      vaultPath: "/path/to/vault",
      inboxFolder: "Notes/Questions"
    };

    const result = resolveInboxPath(options);

    expect(result).toBe(path.join("/path/to/vault", "Notes", "Questions", DEFAULT_INBOX_FILENAME));
  });

  it("should normalize folder paths with slashes", () => {
    const options: ExportInboxOptions = {
      vaultPath: "/path/to/vault",
      inboxFolder: "/Inbox/"
    };

    const result = resolveInboxPath(options);

    expect(result).toBe(path.join("/path/to/vault", "Inbox", DEFAULT_INBOX_FILENAME));
  });
});

describe("isInboxEmpty", () => {
  it("should return true for empty inbox", () => {
    const inbox: OpenQuestionsInbox = {
      entries: [],
      totalQuestions: 0,
      unresolvedQuestions: 0,
      resolvedQuestions: 0,
      totalClips: 0,
      totalQuestionInstances: 0,
      truncated: false,
      inbox_version: "1.0.0",
      generated_at: "2026-03-03T10:00:00.000Z"
    };

    expect(isInboxEmpty(inbox)).toBe(true);
  });

  it("should return false for inbox with questions", () => {
    const inputs: OpenQuestionInput[] = [
      {
        question: "Test question?",
        clipPath: "/path/to/clip.md",
        clipTitle: "Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: QuestionStatus.UNRESOLVED
      }
    ];

    const inbox = buildOpenQuestionsInbox(inputs);

    expect(isInboxEmpty(inbox)).toBe(false);
  });

  it("should return true for inbox with only resolved questions", () => {
    const inputs: OpenQuestionInput[] = [
      {
        question: "Resolved question?",
        clipPath: "/path/to/clip.md",
        clipTitle: "Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: QuestionStatus.RESOLVED
      }
    ];

    const inbox = buildOpenQuestionsInbox(inputs);

    // Resolved questions are filtered out, so inbox is empty
    expect(isInboxEmpty(inbox)).toBe(true);
  });
});

describe("renderEmptyInbox", () => {
  it("should render valid markdown for empty inbox", () => {
    const markdown = renderEmptyInbox("2026-03-03T10:00:00.000Z");

    expect(markdown).toContain("---");
    expect(markdown).toContain("inbox_version:");
    expect(markdown).toContain("questions_count: 0");
    expect(markdown).toContain("> No unresolved questions found.");
    expect(markdown).toContain("generated_at: 2026-03-03T10:00:00.000Z");
  });

  it("should use current timestamp when not specified", () => {
    const before = new Date().toISOString();
    const markdown = renderEmptyInbox();
    const after = new Date().toISOString();

    // Extract generated_at from markdown
    const match = markdown.match(/generated_at: (.+)/);
    expect(match).not.toBeNull();
    const generatedAt = match![1];

    expect(generatedAt >= before).toBe(true);
    expect(generatedAt <= after).toBe(true);
  });
});

describe("exportOpenQuestionsInbox", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `open-questions-export-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should export inbox to vault root", async () => {
    const inputs: OpenQuestionInput[] = [
      {
        question: "Test question?",
        clipPath: "/path/to/clip.md",
        clipTitle: "Test Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: QuestionStatus.UNRESOLVED
      }
    ];

    const inbox = buildOpenQuestionsInbox(inputs);
    const options: ExportInboxOptions = { vaultPath: tempDir };

    const result = await exportOpenQuestionsInbox(inbox, options);

    expect(result.filePath).toBe(path.join(tempDir, DEFAULT_INBOX_FILENAME));
    expect(result.created).toBe(true);
    expect(result.isEmpty).toBe(false);
    expect(result.metadata.questions_count).toBe(1);
    expect(result.warnings).toHaveLength(0);

    // Verify file exists and has content
    const content = await fs.readFile(result.filePath, "utf-8");
    expect(content).toContain("Test question?");
  });

  it("should export inbox to custom folder", async () => {
    const inputs: OpenQuestionInput[] = [
      {
        question: "Test question?",
        clipPath: "/path/to/clip.md",
        clipTitle: "Test Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: QuestionStatus.UNRESOLVED
      }
    ];

    const inbox = buildOpenQuestionsInbox(inputs);
    const options: ExportInboxOptions = {
      vaultPath: tempDir,
      inboxFolder: "Inbox"
    };

    const result = await exportOpenQuestionsInbox(inbox, options);

    expect(result.filePath).toBe(path.join(tempDir, "Inbox", DEFAULT_INBOX_FILENAME));
    expect(result.created).toBe(true);

    // Verify folder was created
    const folderExists = await fs.access(path.join(tempDir, "Inbox")).then(() => true).catch(() => false);
    expect(folderExists).toBe(true);
  });

  it("should export empty inbox with explicit empty-state behavior", async () => {
    const inbox = buildOpenQuestionsInbox([]);
    const options: ExportInboxOptions = { vaultPath: tempDir };

    const result = await exportOpenQuestionsInbox(inbox, options);

    expect(result.isEmpty).toBe(true);
    expect(result.metadata.questions_count).toBe(0);
    expect(result.warnings).toContain("Inbox is empty (no unresolved questions)");

    // Verify file still exists with empty state
    const content = await fs.readFile(result.filePath, "utf-8");
    expect(content).toContain("questions_count: 0");
    expect(content).toContain("> No unresolved questions found.");
  });

  it("should update existing inbox file", async () => {
    const options: ExportInboxOptions = { vaultPath: tempDir };

    // First export
    const inbox1 = buildOpenQuestionsInbox([
      {
        question: "First question?",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: QuestionStatus.UNRESOLVED
      }
    ]);

    const result1 = await exportOpenQuestionsInbox(inbox1, options);
    expect(result1.created).toBe(true);

    // Second export (update)
    const inbox2 = buildOpenQuestionsInbox([
      {
        question: "Second question?",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T11:00:00.000Z",
        clipId: "clip2",
        status: QuestionStatus.UNRESOLVED
      }
    ]);

    const result2 = await exportOpenQuestionsInbox(inbox2, options);
    expect(result2.created).toBe(false);

    // Verify file was updated
    const content = await fs.readFile(result2.filePath, "utf-8");
    expect(content).toContain("Second question?");
    expect(content).not.toContain("First question?");
  });

  it("should fail gracefully when folder cannot be created", async () => {
    const inbox = buildOpenQuestionsInbox([]);
    const options: ExportInboxOptions = {
      vaultPath: tempDir,
      inboxFolder: "nonexistent/subfolder",
      createFolder: false
    };

    await expect(exportOpenQuestionsInbox(inbox, options)).rejects.toHaveProperty("errorType", "folder_error");
  });

  it("should include truncation warning when inbox is truncated", async () => {
    // Create more than MAX_INBOX_QUESTIONS questions
    const inputs: OpenQuestionInput[] = [];
    for (let i = 0; i < 110; i++) {
      inputs.push({
        question: `Question ${i}?`,
        clipPath: `/path/to/clip${i}.md`,
        clipTitle: `Clip ${i}`,
        clipUrl: `https://example.com/${i}`,
        clipTimestamp: `2026-03-03T10:00:00.000Z`,
        clipId: `clip${i}`,
        status: QuestionStatus.UNRESOLVED
      });
    }

    const inbox = buildOpenQuestionsInbox(inputs);
    const options: ExportInboxOptions = { vaultPath: tempDir };

    const result = await exportOpenQuestionsInbox(inbox, options);

    expect(result.metadata.inbox_truncated).toBe(true);
    expect(result.warnings.some(w => w.includes("truncated"))).toBe(true);
  });
});

describe("exportEmptyInbox", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `open-questions-export-empty-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should export empty inbox placeholder", async () => {
    const options: ExportInboxOptions = { vaultPath: tempDir };

    const result = await exportEmptyInbox(options, "2026-03-03T10:00:00.000Z");

    expect(result.isEmpty).toBe(true);
    expect(result.created).toBe(true);
    expect(result.metadata.questions_count).toBe(0);

    const content = await fs.readFile(result.filePath, "utf-8");
    expect(content).toContain("generated_at: 2026-03-03T10:00:00.000Z");
  });
});

describe("inboxFileExists", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `open-questions-exists-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return false when file does not exist", async () => {
    const options: ExportInboxOptions = { vaultPath: tempDir };
    const exists = await inboxFileExists(options);
    expect(exists).toBe(false);
  });

  it("should return true when file exists", async () => {
    const options: ExportInboxOptions = { vaultPath: tempDir };
    await exportEmptyInbox(options);

    const exists = await inboxFileExists(options);
    expect(exists).toBe(true);
  });
});

describe("readInboxFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `open-questions-read-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return null when file does not exist", async () => {
    const options: ExportInboxOptions = { vaultPath: tempDir };
    const content = await readInboxFile(options);
    expect(content).toBeNull();
  });

  it("should return file content when file exists", async () => {
    const options: ExportInboxOptions = { vaultPath: tempDir };
    await exportEmptyInbox(options, "2026-03-03T10:00:00.000Z");

    const content = await readInboxFile(options);
    expect(content).not.toBeNull();
    expect(content).toContain("Open Questions Inbox");
  });
});

describe("deleteInboxFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `open-questions-delete-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return false when file does not exist", async () => {
    const options: ExportInboxOptions = { vaultPath: tempDir };
    const deleted = await deleteInboxFile(options);
    expect(deleted).toBe(false);
  });

  it("should delete file and return true when file exists", async () => {
    const options: ExportInboxOptions = { vaultPath: tempDir };
    await exportEmptyInbox(options);

    const deleted = await deleteInboxFile(options);
    expect(deleted).toBe(true);

    const exists = await inboxFileExists(options);
    expect(exists).toBe(false);
  });
});

describe("getDefaultExportOptions", () => {
  it("should return default options for a vault", () => {
    const vaultPath = "/path/to/vault";
    const options = getDefaultExportOptions(vaultPath);

    expect(options.vaultPath).toBe(vaultPath);
    expect(options.inboxFolder).toBeUndefined();
    expect(options.inboxFilename).toBe(DEFAULT_INBOX_FILENAME);
    expect(options.createFolder).toBe(true);
  });
});
