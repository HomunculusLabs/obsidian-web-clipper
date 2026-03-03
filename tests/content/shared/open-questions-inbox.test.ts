/**
 * Tests for Open Questions Inbox Builder
 *
 * Tests the extraction, parsing, and building utilities for the Open Questions Inbox.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  parseFrontmatter,
  parseClipBriefSection,
  clipBriefToInputs,
  extractOpenQuestionsFromNote,
  scanVaultForOpenQuestions,
  type ScanVaultOptions,
  type ParsedClipBrief
} from "../../../src/shared/openQuestionsInboxBuilder";
import type { OpenQuestionInput } from "../../../src/shared/openQuestionsInboxContract";
import { QuestionStatus } from "../../../src/shared/openQuestionsInboxContract";
import { buildOpenQuestionsInbox } from "../../../src/shared/openQuestionsInboxContract";
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
