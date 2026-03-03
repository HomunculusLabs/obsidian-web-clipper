/**
 * Tests for Key Takeaways Inbox Builder
 *
 * Tests the extraction, parsing, and building utilities for the Key Takeaways Inbox.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  parseFrontmatter,
  parseClipBriefSection,
  clipBriefToInputs,
  extractKeyTakeawaysFromNote,
  scanVaultForKeyTakeaways,
  normalizeInsight,
  mergeDuplicateInsights,
  type ScanVaultOptions,
  type ParsedClipBrief
} from "../../../src/shared/keyTakeawaysInboxBuilder";
import type { KeyTakeawayInput, KeyTakeawaysInbox, InboxEntry, SourceClipRef } from "../../../src/shared/keyTakeawaysInboxContract";
import {
  InsightStatus,
  buildKeyTakeawaysInbox,
  renderKeyTakeawaysInbox,
  computeInsightFingerprint,
  insightsAreEquivalent,
  computeEntryScore,
  sortEntriesDeterministically,
  buildSourceClipRefs,
  buildInboxEntry,
  MAX_INBOX_INSIGHTS,
  MAX_SOURCE_CLIP_REFS,
  KEY_TAKEAWAYS_INBOX_VERSION
} from "../../../src/shared/keyTakeawaysInboxContract";
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
  it("should parse Clip Brief section with Key Takeaways", () => {
    const content = `---
title: Test Clip
source: https://example.com/article
date_clipped: 2026-03-03T10:00:00.000Z
---

# Article Content

## Clip Brief

### Key Takeaways

- React Server Components use RSC payload for hydration
- Streaming SSR requires Suspense boundaries
- ~~Deprecated approach using getServerSideProps~~

### Action Items

- Action item 1
`;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.noteTitle).toBe("Test Clip");
      expect(result.sourceUrl).toBe("https://example.com/article");
      expect(result.timestamp).toBe("2026-03-03T10:00:00.000Z");
      expect(result.keyTakeaways).toHaveLength(3);

      expect(result.keyTakeaways[0]?.insight).toBe("React Server Components use RSC payload for hydration");
      expect(result.keyTakeaways[0]?.status).toBe(InsightStatus.ACTIVE);

      expect(result.keyTakeaways[1]?.insight).toBe("Streaming SSR requires Suspense boundaries");
      expect(result.keyTakeaways[1]?.status).toBe(InsightStatus.ACTIVE);

      expect(result.keyTakeaways[2]?.insight).toBe("Deprecated approach using getServerSideProps");
      expect(result.keyTakeaways[2]?.status).toBe(InsightStatus.ARCHIVED);
    }
  });

  it("should accept 'Takeaways' as alias for 'Key Takeaways'", () => {
    const content = `---
title: Test Clip
---

## Clip Brief

### Takeaways

- Insight 1
- Insight 2`;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.keyTakeaways).toHaveLength(2);
    }
  });

  it("should accept 'Insights' as alias for 'Key Takeaways'", () => {
    const content = `---
title: Test Clip
---

## Clip Brief

### Insights

- Insight 1
- Insight 2`;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.keyTakeaways).toHaveLength(2);
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

  it("should handle empty Key Takeaways list", () => {
    const content = `---
title: Test Clip
---

## Clip Brief

### Key Takeaways

### Action Items
- Some action`;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.keyTakeaways).toHaveLength(0);
    }
  });

  it("should use filename as title when frontmatter title is missing", () => {
    const content = `---
source: https://example.com
---

## Clip Brief

### Key Takeaways

- Test insight`;

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

### key takeaways

- Insight 1
- Insight 2`;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.keyTakeaways).toHaveLength(2);
    }
  });

  it("should skip non-list items in Key Takeaways", () => {
    const content = `---
title: Test
---

## Clip Brief

### Key Takeaways

- Valid insight 1
This is not a list item
- Valid insight 2
### Another Section`;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.keyTakeaways).toHaveLength(2);
      expect(result.keyTakeaways[0]?.insight).toBe("Valid insight 1");
      expect(result.keyTakeaways[1]?.insight).toBe("Valid insight 2");
    }
  });

  it("should strip whitespace from insights", () => {
    const content = `---
title: Test
---

## Clip Brief

### Key Takeaways

-  What is the insight?  
-   Another insight?  `;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.keyTakeaways[0]?.insight).toBe("What is the insight?");
      expect(result.keyTakeaways[1]?.insight).toBe("Another insight?");
    }
  });

  it("should remove leading bullet markers from insight text", () => {
    const content = `---
title: Test
---

## Clip Brief

### Key Takeaways

- - Nested bullet insight
- * Another nested`;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.keyTakeaways[0]?.insight).toBe("Nested bullet insight");
      expect(result.keyTakeaways[1]?.insight).toBe("Another nested");
    }
  });

  it("should remove checkbox markers from insight text", () => {
    const content = `---
title: Test
---

## Clip Brief

### Key Takeaways

- [ ] Unchecked insight
- [x] Checked insight`;

    const result = parseClipBriefSection(content, "/path/to/test.md");
    expect(result).not.toBeNull();

    if (result) {
      expect(result.keyTakeaways[0]?.insight).toBe("Unchecked insight");
      expect(result.keyTakeaways[1]?.insight).toBe("Checked insight");
    }
  });
});

describe("clipBriefToInputs", () => {
  it("should convert ParsedClipBrief to KeyTakeawayInput array", () => {
    const clipBrief: ParsedClipBrief = {
      noteTitle: "Test Clip",
      sourceUrl: "https://example.com",
      timestamp: "2026-03-03T10:00:00.000Z",
      keyTakeaways: [
        {
          insight: "Insight 1",
          status: InsightStatus.ACTIVE,
          lineNumber: 10
        },
        {
          insight: "Insight 2",
          status: InsightStatus.ARCHIVED,
          lineNumber: 11
        }
      ]
    };

    const result = clipBriefToInputs(clipBrief, "/path/to/clip.md");

    expect(result).toHaveLength(2);

    expect(result[0]?.insight).toBe("Insight 1");
    expect(result[0]?.clipPath).toBe("/path/to/clip.md");
    expect(result[0]?.clipTitle).toBe("Test Clip");
    expect(result[0]?.clipUrl).toBe("https://example.com");
    expect(result[0]?.clipTimestamp).toBe("2026-03-03T10:00:00.000Z");
    expect(result[0]?.clipId).toBe("/path/to/clip.md");
    expect(result[0]?.status).toBe(InsightStatus.ACTIVE);

    expect(result[1]?.insight).toBe("Insight 2");
    expect(result[1]?.status).toBe(InsightStatus.ARCHIVED);
  });

  it("should handle empty key takeaways", () => {
    const clipBrief: ParsedClipBrief = {
      noteTitle: "Test Clip",
      sourceUrl: "https://example.com",
      timestamp: "2026-03-03T10:00:00.000Z",
      keyTakeaways: []
    };

    const result = clipBriefToInputs(clipBrief, "/path/to/clip.md");
    expect(result).toHaveLength(0);
  });
});

describe("extractKeyTakeawaysFromNote", () => {
  it("should extract insights from a complete note", () => {
    const content = `---
title: Complete Note
source: https://example.com
date_clipped: 2026-03-03T10:00:00.000Z
---

# Article Title

Some content here.

## Clip Brief

### Key Takeaways

- React Server Components enable streaming SSR
- Suspense boundaries are required for streaming
- ~~getServerSideProps is deprecated for RSC~~

## Another Section

More content.`;

    const result = extractKeyTakeawaysFromNote(content, "/path/to/note.md");

    expect(result).toHaveLength(3);
    expect(result[0]?.insight).toBe("React Server Components enable streaming SSR");
    expect(result[1]?.insight).toBe("Suspense boundaries are required for streaming");
    expect(result[2]?.insight).toBe("getServerSideProps is deprecated for RSC");
    expect(result[2]?.status).toBe(InsightStatus.ARCHIVED);
  });

  it("should return empty array for note without Clip Brief", () => {
    const content = `---
title: No Brief
---

# Just content`;

    const result = extractKeyTakeawaysFromNote(content, "/path/to/note.md");
    expect(result).toHaveLength(0);
  });
});

describe("scanVaultForKeyTakeaways", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = path.join(os.tmpdir(), `key-takeaways-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should scan a vault directory for Key Takeaways", async () => {
    // Create test notes
    const note1Content = `---
title: Note 1
source: https://example.com/1
date_clipped: 2026-03-03T10:00:00.000Z
---

## Clip Brief

### Key Takeaways

- Insight 1
- Insight 2`;

    const note2Content = `---
title: Note 2
source: https://example.com/2
date_clipped: 2026-03-03T11:00:00.000Z
---

## Clip Brief

### Key Takeaways

- Insight 3
- ~~Insight 4~~`;

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

    const result = await scanVaultForKeyTakeaways(options);

    expect(result.filesScanned).toBe(3);
    expect(result.filesWithClipBrief).toBe(2);
    expect(result.filesWithKeyTakeaways).toBe(2);
    expect(result.filesSkipped).toBe(1);
    expect(result.insights).toHaveLength(4);

    // Check insights are sorted deterministically
    expect(result.insights[0]?.insight).toBe("Insight 1");
    expect(result.insights[1]?.insight).toBe("Insight 2");
    expect(result.insights[2]?.insight).toBe("Insight 3");
    expect(result.insights[3]?.insight).toBe("Insight 4");
    expect(result.insights[3]?.status).toBe(InsightStatus.ARCHIVED);
  });

  it("should filter by file extension", async () => {
    const noteContent = `---
title: Test
---

## Clip Brief

### Key Takeaways

- Insight?`;

    await fs.writeFile(path.join(tempDir, "note.md"), noteContent);
    await fs.writeFile(path.join(tempDir, "note.txt"), "not markdown");

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      extensions: [".md"]
    };

    const result = await scanVaultForKeyTakeaways(options);

    expect(result.filesScanned).toBe(1);
  });

  it("should filter by minDate", async () => {
    const noteContent = `---
title: Test
date_clipped: 2026-03-03T10:00:00.000Z
---

## Clip Brief

### Key Takeaways

- Insight?`;

    const filePath = path.join(tempDir, "note.md");
    await fs.writeFile(filePath, noteContent);

    // Set mtime to an old date
    const oldDate = new Date("2026-01-01T00:00:00.000Z");
    await fs.utimes(filePath, oldDate, oldDate);

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      minDate: "2026-03-01T00:00:00.000Z"
    };

    const result = await scanVaultForKeyTakeaways(options);

    expect(result.filesScanned).toBe(0);
  });

  it("should filter by required tags", async () => {
    const note1Content = `---
title: Note 1
tags: [important, research]
---

## Clip Brief

### Key Takeaways

- Insight 1`;

    const note2Content = `---
title: Note 2
tags: [other]
---

## Clip Brief

### Key Takeaways

- Insight 2`;

    await fs.writeFile(path.join(tempDir, "note1.md"), note1Content);
    await fs.writeFile(path.join(tempDir, "note2.md"), note2Content);

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      requiredTags: ["important"]
    };

    const result = await scanVaultForKeyTakeaways(options);

    expect(result.filesScanned).toBe(2); // Both files scanned
    expect(result.filesSkipped).toBe(1); // One skipped due to missing tag
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0]?.insight).toBe("Insight 1");
  });

  it("should limit scan with maxFiles", async () => {
    const noteContent = `---
title: Test
---

## Clip Brief

### Key Takeaways

- Insight?`;

    await fs.writeFile(path.join(tempDir, "a.md"), noteContent);
    await fs.writeFile(path.join(tempDir, "b.md"), noteContent);
    await fs.writeFile(path.join(tempDir, "c.md"), noteContent);

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      maxFiles: 2
    };

    const result = await scanVaultForKeyTakeaways(options);

    expect(result.filesScanned).toBe(2);
  });

  it("should scan subdirectories recursively", async () => {
    const noteContent = `---
title: Test
---

## Clip Brief

### Key Takeaways

- Insight?`;

    await fs.writeFile(path.join(tempDir, "root.md"), noteContent);
    await fs.mkdir(path.join(tempDir, "subdir"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "subdir", "nested.md"), noteContent);

    const options: ScanVaultOptions = {
      vaultPath: tempDir
    };

    const result = await scanVaultForKeyTakeaways(options);

    expect(result.filesScanned).toBe(2);
  });

  it("should handle maxDepth option", async () => {
    const noteContent = `---
title: Test
---

## Clip Brief

### Key Takeaways

- Insight?`;

    await fs.writeFile(path.join(tempDir, "root.md"), noteContent);
    await fs.mkdir(path.join(tempDir, "subdir"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "subdir", "nested"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "subdir", "level1.md"), noteContent);
    await fs.writeFile(path.join(tempDir, "subdir", "nested", "level2.md"), noteContent);

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      maxDepth: 1 // Only root + 1 level deep
    };

    const result = await scanVaultForKeyTakeaways(options);

    expect(result.filesScanned).toBe(2); // root.md and level1.md
  });

  it("should exclude hidden files by default", async () => {
    const noteContent = `---
title: Test
---

## Clip Brief

### Key Takeaways

- Insight?`;

    await fs.writeFile(path.join(tempDir, "visible.md"), noteContent);
    await fs.writeFile(path.join(tempDir, ".hidden.md"), noteContent);

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      includeHidden: false
    };

    const result = await scanVaultForKeyTakeaways(options);

    expect(result.filesScanned).toBe(1);
  });

  it("should include hidden files when includeHidden is true", async () => {
    const noteContent = `---
title: Test
---

## Clip Brief

### Key Takeaways

- Insight?`;

    await fs.writeFile(path.join(tempDir, "visible.md"), noteContent);
    await fs.writeFile(path.join(tempDir, ".hidden.md"), noteContent);

    const options: ScanVaultOptions = {
      vaultPath: tempDir,
      includeHidden: true
    };

    const result = await scanVaultForKeyTakeaways(options);

    expect(result.filesScanned).toBe(2);
  });
});

describe("normalizeInsight", () => {
  it("should normalize insight text to lowercase", () => {
    const result = normalizeInsight("React Server Components Use RSC Payload");
    expect(result).toBe("react server components use rsc payload");
  });

  it("should trim whitespace", () => {
    const result = normalizeInsight("  Trimmed insight  ");
    expect(result).toBe("trimmed insight");
  });

  it("should collapse multiple whitespace", () => {
    const result = normalizeInsight("Multiple   spaces   here");
    expect(result).toBe("multiple spaces here");
  });

  it("should remove trailing punctuation", () => {
    const result = normalizeInsight("Insight with trailing punctuation!");
    expect(result).toBe("insight with trailing punctuation");
  });

  it("should remove leading bullet markers", () => {
    const result = normalizeInsight("- Bullet point insight");
    expect(result).toBe("bullet point insight");
  });

  it("should remove checkbox markers", () => {
    const result = normalizeInsight("[ ] Checkbox insight");
    expect(result).toBe("checkbox insight");
  });

  it("should handle complex normalization", () => {
    const result = normalizeInsight("  - [x]  COMPLEX   Insight!!!  ");
    expect(result).toBe("complex insight");
  });
});

describe("mergeDuplicateInsights", () => {
  it("should merge duplicate insights from multiple sources", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "React Server Components use RSC payload",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "react server components use rsc payload", // Same normalized
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T11:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Different insight",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      }
    ];

    const merged = mergeDuplicateInsights(inputs);

    expect(merged.size).toBe(2); // 2 unique normalized insights

    const rscKey = "react server components use rsc payload";
    const rscGroup = merged.get(rscKey);
    expect(rscGroup).toBeDefined();
    expect(rscGroup?.length).toBe(2);
  });

  it("should handle empty inputs", () => {
    const merged = mergeDuplicateInsights([]);
    expect(merged.size).toBe(0);
  });

  it("should handle all unique insights", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Insight 1",
        clipPath: "/path/to/clip.md",
        clipTitle: "Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Insight 2",
        clipPath: "/path/to/clip.md",
        clipTitle: "Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: InsightStatus.ACTIVE
      }
    ];

    const merged = mergeDuplicateInsights(inputs);
    expect(merged.size).toBe(2);
  });
});

describe("buildKeyTakeawaysInbox", () => {
  it("should build inbox with deduplication", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "React Server Components use RSC payload",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "React Server Components use RSC payload",  // Duplicate
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T11:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Streaming SSR requires Suspense",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries).toHaveLength(2); // 2 unique insights
    expect(inbox.totalInsights).toBe(2);
    expect(inbox.activeInsights).toBe(2);
    expect(inbox.totalClips).toBe(2);
    expect(inbox.totalInsightInstances).toBe(3);

    // Check that duplicate was merged
    const duplicateEntry = inbox.entries.find(e => 
      e.insight.toLowerCase().includes("rsc payload")
    );
    expect(duplicateEntry?.source_clip_count).toBe(2);
    expect(duplicateEntry?.source_clip_refs).toHaveLength(2);
  });

  it("should filter out archived insights", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Active insight",
        clipPath: "/path/to/clip.md",
        clipTitle: "Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Archived insight",
        clipPath: "/path/to/clip.md",
        clipTitle: "Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: InsightStatus.ARCHIVED
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries).toHaveLength(1); // Only active
    expect(inbox.activeInsights).toBe(1);
    expect(inbox.archivedInsights).toBe(1);
    expect(inbox.entries[0]?.insight).toBe("Active insight");
  });

  it("should handle empty inputs", () => {
    const inbox = buildKeyTakeawaysInbox([]);

    expect(inbox.entries).toHaveLength(0);
    expect(inbox.totalInsights).toBe(0);
    expect(inbox.activeInsights).toBe(0);
    expect(inbox.archivedInsights).toBe(0);
    expect(inbox.totalClips).toBe(0);
    expect(inbox.totalInsightInstances).toBe(0);
    expect(inbox.truncated).toBe(false);
  });
});

describe("renderKeyTakeawaysInbox", () => {
  it("should render a complete inbox with insights", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "React Server Components use RSC payload for hydration",
        clipPath: "/path/to/clip.md",
        clipTitle: "Test Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    // Check frontmatter is present
    expect(markdown).toContain("---");
    expect(markdown).toContain("inbox_version:");
    expect(markdown).toContain("insights_count: 1");
    expect(markdown).toContain("source_clips_processed: 1");
    expect(markdown).toContain("active_insights: 1");
    expect(markdown).toContain("inbox_truncated: false");

    // Check body structure
    expect(markdown).toContain("# Key Takeaways Inbox");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Key Takeaways");
    expect(markdown).toContain("React Server Components use RSC payload for hydration");
    expect(markdown).toContain("[[Test Clip|/path/to/clip.md]]");
  });

  it("should render empty inbox with explicit empty-state behavior", () => {
    const inbox = buildKeyTakeawaysInbox([]);
    const markdown = renderKeyTakeawaysInbox(inbox);

    // Check frontmatter is present with explicit zero values
    expect(markdown).toContain("---");
    expect(markdown).toContain("inbox_version:");
    expect(markdown).toContain("insights_count: 0");
    expect(markdown).toContain("source_clips_processed: 0");
    expect(markdown).toContain("active_insights: 0");
    expect(markdown).toContain("archived_insights: 0");
    expect(markdown).toContain("inbox_truncated: false");

    // Check body structure with empty state message
    expect(markdown).toContain("# Key Takeaways Inbox");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Key Takeaways");
    expect(markdown).toContain("> No active insights found.");
  });

  it("should render truncation warning when inbox is truncated", () => {
    // Create more than MAX_INBOX_INSIGHTS insights
    const inputs: KeyTakeawayInput[] = [];
    for (let i = 0; i < 110; i++) {
      inputs.push({
        insight: `Insight ${i}`,
        clipPath: `/path/to/clip${i}.md`,
        clipTitle: `Clip ${i}`,
        clipUrl: `https://example.com/${i}`,
        clipTimestamp: `2026-03-03T10:00:00.000Z`,
        clipId: `clip${i}`,
        status: InsightStatus.ACTIVE
      });
    }

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    // Check truncation is indicated
    expect(markdown).toContain("inbox_truncated: true");
    expect(markdown).toContain("Inbox truncated to 100 insights");
  });

  it("should render archived insight count in summary", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Active insight",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Archived insight",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ARCHIVED
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("**Archived:** 1");
    expect(markdown).toContain("active_insights: 1");
    expect(markdown).toContain("archived_insights: 1");
  });
});

// ============================================================================
// CONTRACT TESTS - Dedupe, Rank Ordering, Linkback Rendering, Truncation
// ============================================================================

describe("computeInsightFingerprint", () => {
  it("should produce deterministic fingerprint for same insight", () => {
    const fp1 = computeInsightFingerprint("React Server Components use RSC payload");
    const fp2 = computeInsightFingerprint("React Server Components use RSC payload");

    expect(fp1.hash).toBe(fp2.hash);
    expect(fp1.normalizedInsight).toBe(fp2.normalizedInsight);
  });

  it("should normalize case for fingerprinting", () => {
    const fp1 = computeInsightFingerprint("React Server Components Use RSC Payload");
    const fp2 = computeInsightFingerprint("react server components use rsc payload");

    expect(fp1.hash).toBe(fp2.hash);
    expect(fp1.normalizedInsight).toBe("react server components use rsc payload");
    expect(fp2.normalizedInsight).toBe("react server components use rsc payload");
  });

  it("should trim whitespace for fingerprinting", () => {
    const fp1 = computeInsightFingerprint("  React Server Components  ");
    const fp2 = computeInsightFingerprint("React Server Components");

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("should collapse multiple whitespace for fingerprinting", () => {
    const fp1 = computeInsightFingerprint("React   Server   Components");
    const fp2 = computeInsightFingerprint("React Server Components");

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("should remove trailing punctuation for fingerprinting", () => {
    const fp1 = computeInsightFingerprint("React Server Components!");
    const fp2 = computeInsightFingerprint("React Server Components.");

    expect(fp1.hash).toBe(fp2.hash);
    expect(fp1.normalizedInsight).toBe("react server components");
  });

  it("should produce different fingerprints for different insights", () => {
    const fp1 = computeInsightFingerprint("React Server Components use RSC payload");
    const fp2 = computeInsightFingerprint("Streaming SSR requires Suspense boundaries");

    expect(fp1.hash).not.toBe(fp2.hash);
  });

  it("should produce 64-character hex hash", () => {
    const fp = computeInsightFingerprint("Test insight");

    expect(fp.hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(fp.hash)).toBe(true);
  });

  it("should remove bullet markers for fingerprinting", () => {
    const fp1 = computeInsightFingerprint("- Bullet point insight");
    const fp2 = computeInsightFingerprint("Bullet point insight");

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("should remove checkbox markers for fingerprinting", () => {
    const fp1 = computeInsightFingerprint("[ ] Checkbox insight");
    const fp2 = computeInsightFingerprint("Checkbox insight");

    expect(fp1.hash).toBe(fp2.hash);
  });
});

describe("insightsAreEquivalent", () => {
  it("should return true for identical insights", () => {
    expect(insightsAreEquivalent("React uses JSX", "React uses JSX")).toBe(true);
  });

  it("should return true for case-different insights", () => {
    expect(insightsAreEquivalent("REACT USES JSX", "react uses jsx")).toBe(true);
  });

  it("should return true for whitespace-different insights", () => {
    expect(insightsAreEquivalent("  React uses JSX  ", "React uses JSX")).toBe(true);
  });

  it("should return false for semantically different insights", () => {
    expect(insightsAreEquivalent("React uses JSX", "Vue uses templates")).toBe(false);
  });

  it("should accept fingerprint objects", () => {
    const fp1 = computeInsightFingerprint("React uses JSX");
    const fp2 = computeInsightFingerprint("react uses jsx");

    expect(insightsAreEquivalent(fp1, fp2)).toBe(true);
  });

  it("should accept mixed fingerprint and string", () => {
    const fp = computeInsightFingerprint("React uses JSX");

    expect(insightsAreEquivalent(fp, "REACT USES JSX")).toBe(true);
    expect(insightsAreEquivalent("react uses jsx", fp)).toBe(true);
  });
});

describe("computeEntryScore", () => {
  const createEntry = (overrides: Partial<InboxEntry> = {}): InboxEntry => ({
    insight_id: "test-id",
    insight: "Test insight",
    source_clip_refs: [],
    source_clip_count: 1,
    source_clip_refs_truncated: false,
    insight_status: InsightStatus.ACTIVE,
    score: 0,
    timestamp: new Date().toISOString(),
    ...overrides
  });

  it("should give higher score to more recent clips", () => {
    const recentEntry = createEntry({
      timestamp: new Date().toISOString()
    });

    const oldEntry = createEntry({
      timestamp: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() // 60 days ago
    });

    const recentScore = computeEntryScore(recentEntry);
    const oldScore = computeEntryScore(oldEntry);

    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it("should give higher score to insights appearing in more clips", () => {
    const frequentEntry = createEntry({
      source_clip_count: 10
    });

    const rareEntry = createEntry({
      source_clip_count: 1
    });

    const frequentScore = computeEntryScore(frequentEntry);
    const rareScore = computeEntryScore(rareEntry);

    expect(frequentScore).toBeGreaterThan(rareScore);
  });

  it("should give higher score to longer, more detailed insights", () => {
    const detailedEntry = createEntry({
      insight: "React Server Components enable streaming server-side rendering with automatic code splitting and improved performance characteristics for large applications"
    });

    const briefEntry = createEntry({
      insight: "RSC is fast"
    });

    const detailedScore = computeEntryScore(detailedEntry);
    const briefScore = computeEntryScore(briefEntry);

    expect(detailedScore).toBeGreaterThan(briefScore);
  });

  it("should produce score between 0 and 100", () => {
    const entry = createEntry();
    const score = computeEntryScore(entry);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("should produce deterministic scores for same inputs", () => {
    const entry = createEntry({
      timestamp: "2026-03-03T10:00:00.000Z",
      source_clip_count: 5,
      insight: "Test insight for determinism"
    });

    const score1 = computeEntryScore(entry);
    const score2 = computeEntryScore(entry);

    expect(score1).toBe(score2);
  });

  it("should round scores to 2 decimal places", () => {
    const entry = createEntry();
    const score = computeEntryScore(entry);

    // Check that score has at most 2 decimal places
    const decimalPart = score.toString().split(".")[1];
    expect(decimalPart?.length || 0).toBeLessThanOrEqual(2);
  });
});

describe("sortEntriesDeterministically", () => {
  const createEntry = (overrides: Partial<InboxEntry> = {}): InboxEntry => ({
    insight_id: `id-${Math.random().toString(36).slice(2)}`,
    insight: "Test insight",
    source_clip_refs: [],
    source_clip_count: 1,
    source_clip_refs_truncated: false,
    insight_status: InsightStatus.ACTIVE,
    score: 50,
    timestamp: "2026-03-03T10:00:00.000Z",
    ...overrides
  });

  it("should sort by score descending (primary sort)", () => {
    const entries = [
      createEntry({ insight_id: "low", score: 30 }),
      createEntry({ insight_id: "high", score: 90 }),
      createEntry({ insight_id: "mid", score: 60 })
    ];

    const sorted = sortEntriesDeterministically(entries);

    expect(sorted[0]?.insight_id).toBe("high");
    expect(sorted[1]?.insight_id).toBe("mid");
    expect(sorted[2]?.insight_id).toBe("low");
  });

  it("should use timestamp as secondary sort (more recent first)", () => {
    const entries = [
      createEntry({ insight_id: "old", score: 50, timestamp: "2026-01-01T10:00:00.000Z" }),
      createEntry({ insight_id: "new", score: 50, timestamp: "2026-03-03T10:00:00.000Z" }),
      createEntry({ insight_id: "mid", score: 50, timestamp: "2026-02-15T10:00:00.000Z" })
    ];

    const sorted = sortEntriesDeterministically(entries);

    expect(sorted[0]?.insight_id).toBe("new");
    expect(sorted[1]?.insight_id).toBe("mid");
    expect(sorted[2]?.insight_id).toBe("old");
  });

  it("should use insight_id as tertiary sort (ascending for determinism)", () => {
    const entries = [
      createEntry({ insight_id: "zzz", score: 50, timestamp: "2026-03-03T10:00:00.000Z" }),
      createEntry({ insight_id: "aaa", score: 50, timestamp: "2026-03-03T10:00:00.000Z" }),
      createEntry({ insight_id: "mmm", score: 50, timestamp: "2026-03-03T10:00:00.000Z" })
    ];

    const sorted = sortEntriesDeterministically(entries);

    expect(sorted[0]?.insight_id).toBe("aaa");
    expect(sorted[1]?.insight_id).toBe("mmm");
    expect(sorted[2]?.insight_id).toBe("zzz");
  });

  it("should use source_clip_count as quaternary sort (descending)", () => {
    const entries = [
      createEntry({
        insight_id: "same",
        score: 50,
        timestamp: "2026-03-03T10:00:00.000Z",
        source_clip_count: 1
      }),
      createEntry({
        insight_id: "same",
        score: 50,
        timestamp: "2026-03-03T10:00:00.000Z",
        source_clip_count: 10
      }),
      createEntry({
        insight_id: "same",
        score: 50,
        timestamp: "2026-03-03T10:00:00.000Z",
        source_clip_count: 5
      })
    ];

    const sorted = sortEntriesDeterministically(entries);

    expect(sorted[0]?.source_clip_count).toBe(10);
    expect(sorted[1]?.source_clip_count).toBe(5);
    expect(sorted[2]?.source_clip_count).toBe(1);
  });

  it("should not mutate input array", () => {
    const entries = [
      createEntry({ insight_id: "a", score: 10 }),
      createEntry({ insight_id: "b", score: 90 })
    ];

    const originalOrder = entries.map(e => e.insight_id);
    sortEntriesDeterministically(entries);
    const afterOrder = entries.map(e => e.insight_id);

    expect(originalOrder).toEqual(afterOrder);
  });

  it("should produce identical output for identical input order", () => {
    const entries = [
      createEntry({ insight_id: "a", score: 50, timestamp: "2026-03-03T10:00:00.000Z" }),
      createEntry({ insight_id: "b", score: 50, timestamp: "2026-03-03T10:00:00.000Z" })
    ];

    const sorted1 = sortEntriesDeterministically([...entries]);
    const sorted2 = sortEntriesDeterministically([...entries]);

    expect(sorted1.map(e => e.insight_id)).toEqual(sorted2.map(e => e.insight_id));
  });

  it("should handle empty array", () => {
    const sorted = sortEntriesDeterministically([]);
    expect(sorted).toHaveLength(0);
  });

  it("should handle single entry", () => {
    const entries = [createEntry({ insight_id: "only" })];
    const sorted = sortEntriesDeterministically(entries);

    expect(sorted).toHaveLength(1);
    expect(sorted[0]?.insight_id).toBe("only");
  });
});

describe("buildSourceClipRefs", () => {
  const createRef = (overrides: Partial<SourceClipRef> = {}): SourceClipRef => ({
    path: "/path/to/clip.md",
    title: "Test Clip",
    url: "https://example.com",
    timestamp: "2026-03-03T10:00:00.000Z",
    id: "clip-id",
    ...overrides
  });

  it("should sort refs by timestamp descending (most recent first)", () => {
    const refs = [
      createRef({ id: "old", timestamp: "2026-01-01T10:00:00.000Z" }),
      createRef({ id: "new", timestamp: "2026-03-03T10:00:00.000Z" }),
      createRef({ id: "mid", timestamp: "2026-02-15T10:00:00.000Z" })
    ];

    const result = buildSourceClipRefs(refs);

    expect(result.refs[0]?.id).toBe("new");
    expect(result.refs[1]?.id).toBe("mid");
    expect(result.refs[2]?.id).toBe("old");
  });

  it("should truncate to MAX_SOURCE_CLIP_REFS", () => {
    const refs = Array.from({ length: 15 }, (_, i) =>
      createRef({ id: `ref-${i}`, timestamp: `2026-03-0${(i % 9) + 1}T10:00:00.000Z` })
    );

    const result = buildSourceClipRefs(refs);

    expect(result.refs.length).toBe(MAX_SOURCE_CLIP_REFS);
    expect(result.truncated).toBe(true);
  });

  it("should not truncate when under limit", () => {
    const refs = [
      createRef({ id: "a" }),
      createRef({ id: "b" }),
      createRef({ id: "c" })
    ];

    const result = buildSourceClipRefs(refs);

    expect(result.refs.length).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("should handle empty refs array", () => {
    const result = buildSourceClipRefs([]);

    expect(result.refs).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it("should not mutate input array", () => {
    const refs = [
      createRef({ id: "old", timestamp: "2026-01-01T10:00:00.000Z" }),
      createRef({ id: "new", timestamp: "2026-03-03T10:00:00.000Z" })
    ];

    const originalOrder = refs.map(r => r.id);
    buildSourceClipRefs(refs);
    const afterOrder = refs.map(r => r.id);

    expect(originalOrder).toEqual(afterOrder);
  });
});

describe("buildInboxEntry", () => {
  const createInput = (overrides: Partial<KeyTakeawayInput> = {}): KeyTakeawayInput => ({
    insight: "Test insight",
    clipPath: "/path/to/clip.md",
    clipTitle: "Test Clip",
    clipUrl: "https://example.com",
    clipTimestamp: "2026-03-03T10:00:00.000Z",
    clipId: "clip-id",
    status: InsightStatus.ACTIVE,
    ...overrides
  });

  it("should build entry with correct insight_id", () => {
    const inputs = [createInput({ insight: "Unique insight" })];
    const entry = buildInboxEntry(inputs, "Unique insight");

    const expectedFp = computeInsightFingerprint("Unique insight");
    expect(entry.insight_id).toBe(expectedFp.hash);
  });

  it("should use most recent clip's timestamp", () => {
    const inputs = [
      createInput({ clipId: "old", clipTimestamp: "2026-01-01T10:00:00.000Z" }),
      createInput({ clipId: "new", clipTimestamp: "2026-03-03T10:00:00.000Z" }),
      createInput({ clipId: "mid", clipTimestamp: "2026-02-15T10:00:00.000Z" })
    ];

    const entry = buildInboxEntry(inputs, "Test insight");

    expect(entry.timestamp).toBe("2026-03-03T10:00:00.000Z");
  });

  it("should merge all source clip refs", () => {
    const inputs = [
      createInput({ clipId: "clip1", clipTitle: "Clip 1" }),
      createInput({ clipId: "clip2", clipTitle: "Clip 2" }),
      createInput({ clipId: "clip3", clipTitle: "Clip 3" })
    ];

    const entry = buildInboxEntry(inputs, "Test insight");

    expect(entry.source_clip_count).toBe(3);
    expect(entry.source_clip_refs.length).toBe(3);
    expect(entry.source_clip_refs.map(r => r.title)).toContain("Clip 1");
    expect(entry.source_clip_refs.map(r => r.title)).toContain("Clip 2");
    expect(entry.source_clip_refs.map(r => r.title)).toContain("Clip 3");
  });

  it("should compute score based on entry properties", () => {
    const inputs = [createInput()];
    const entry = buildInboxEntry(inputs, "Test insight");

    expect(entry.score).toBeGreaterThanOrEqual(0);
    expect(entry.score).toBeLessThanOrEqual(100);
  });

  it("should use most recent clip's status", () => {
    const inputs = [
      createInput({ status: InsightStatus.ARCHIVED, clipTimestamp: "2026-01-01T10:00:00.000Z" }),
      createInput({ status: InsightStatus.ACTIVE, clipTimestamp: "2026-03-03T10:00:00.000Z" })
    ];

    const entry = buildInboxEntry(inputs, "Test insight");

    expect(entry.insight_status).toBe(InsightStatus.ACTIVE);
  });

  it("should mark source_clip_refs_truncated when over limit", () => {
    const inputs = Array.from({ length: 15 }, (_, i) =>
      createInput({ clipId: `clip-${i}` })
    );

    const entry = buildInboxEntry(inputs, "Test insight");

    expect(entry.source_clip_count).toBe(15);
    expect(entry.source_clip_refs.length).toBe(MAX_SOURCE_CLIP_REFS);
    expect(entry.source_clip_refs_truncated).toBe(true);
  });
});

describe("Contract Constants", () => {
  it("should have MAX_INBOX_INSIGHTS = 100", () => {
    expect(MAX_INBOX_INSIGHTS).toBe(100);
  });

  it("should have MAX_SOURCE_CLIP_REFS = 10", () => {
    expect(MAX_SOURCE_CLIP_REFS).toBe(10);
  });

  it("should have KEY_TAKEAWAYS_INBOX_VERSION as semantic version", () => {
    expect(KEY_TAKEAWAYS_INBOX_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("Linkback Rendering Contract", () => {
  it("should render Obsidian wikilink format for source clips", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Test insight",
        clipPath: "Clips/MyClip.md",
        clipTitle: "My Clip",
        clipUrl: "https://example.com/article",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    // Should render as [[Title|Path]] format
    expect(markdown).toContain("[[My Clip|Clips/MyClip.md]]");
  });

  it("should include source URL in linkback", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Test insight",
        clipPath: "Clips/MyClip.md",
        clipTitle: "My Clip",
        clipUrl: "https://example.com/article",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("https://example.com/article");
  });

  it("should include date from timestamp in linkback", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Test insight",
        clipPath: "Clips/MyClip.md",
        clipTitle: "My Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("(2026-03-03)");
  });

  it("should render multiple source clips in linkback section", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Same insight",
        clipPath: "Clips/Clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Same insight",
        clipPath: "Clips/Clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("[[Clip 1|Clips/Clip1.md]]");
    expect(markdown).toContain("[[Clip 2|Clips/Clip2.md]]");
    expect(markdown).toContain("https://example.com/1");
    expect(markdown).toContain("https://example.com/2");
  });

  it("should show truncation indicator when source clips exceed limit", () => {
    const inputs: KeyTakeawayInput[] = Array.from({ length: 15 }, (_, i) => ({
      insight: "Same insight",
      clipPath: `Clips/Clip${i}.md`,
      clipTitle: `Clip ${i}`,
      clipUrl: `https://example.com/${i}`,
      clipTimestamp: `2026-03-0${(i % 9) + 1}T10:00:00.000Z`,
      clipId: `clip${i}`,
      status: InsightStatus.ACTIVE
    }));

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    // Should show "... and X more clips"
    expect(markdown).toMatch(/\.\.\. and \d+ more clips/);
  });
});

describe("Truncation Contract", () => {
  it("should truncate inbox to MAX_INBOX_INSIGHTS entries", () => {
    const inputs: KeyTakeawayInput[] = Array.from({ length: 150 }, (_, i) => ({
      insight: `Insight ${i}`,
      clipPath: `Clips/Clip${i}.md`,
      clipTitle: `Clip ${i}`,
      clipUrl: `https://example.com/${i}`,
      clipTimestamp: `2026-03-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
      clipId: `clip${i}`,
      status: InsightStatus.ACTIVE
    }));

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries.length).toBe(MAX_INBOX_INSIGHTS);
    expect(inbox.truncated).toBe(true);
    expect(inbox.activeInsights).toBe(150);
  });

  it("should not truncate when under MAX_INBOX_INSIGHTS", () => {
    const inputs: KeyTakeawayInput[] = Array.from({ length: 50 }, (_, i) => ({
      insight: `Insight ${i}`,
      clipPath: `Clips/Clip${i}.md`,
      clipTitle: `Clip ${i}`,
      clipUrl: `https://example.com/${i}`,
      clipTimestamp: `2026-03-03T10:00:00.000Z`,
      clipId: `clip${i}`,
      status: InsightStatus.ACTIVE
    }));

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries.length).toBe(50);
    expect(inbox.truncated).toBe(false);
  });

  it("should set inbox_truncated in frontmatter when truncated", () => {
    const inputs: KeyTakeawayInput[] = Array.from({ length: 150 }, (_, i) => ({
      insight: `Insight ${i}`,
      clipPath: `Clips/Clip${i}.md`,
      clipTitle: `Clip ${i}`,
      clipUrl: `https://example.com/${i}`,
      clipTimestamp: `2026-03-03T10:00:00.000Z`,
      clipId: `clip${i}`,
      status: InsightStatus.ACTIVE
    }));

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("inbox_truncated: true");
  });

  it("should include truncation warning in body when truncated", () => {
    const inputs: KeyTakeawayInput[] = Array.from({ length: 150 }, (_, i) => ({
      insight: `Insight ${i}`,
      clipPath: `Clips/Clip${i}.md`,
      clipTitle: `Clip ${i}`,
      clipUrl: `https://example.com/${i}`,
      clipTimestamp: `2026-03-03T10:00:00.000Z`,
      clipId: `clip${i}`,
      status: InsightStatus.ACTIVE
    }));

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("Inbox truncated to 100 insights");
  });
});

describe("Empty-State Determinism", () => {
  it("should produce identical output for empty inputs across multiple runs", () => {
    const inbox1 = buildKeyTakeawaysInbox([]);
    const inbox2 = buildKeyTakeawaysInbox([]);

    // Check all deterministic fields match (except generated_at which uses current time)
    expect(inbox1.entries).toEqual(inbox2.entries);
    expect(inbox1.totalInsights).toBe(inbox2.totalInsights);
    expect(inbox1.activeInsights).toBe(inbox2.activeInsights);
    expect(inbox1.archivedInsights).toBe(inbox2.archivedInsights);
    expect(inbox1.totalClips).toBe(inbox2.totalClips);
    expect(inbox1.totalInsightInstances).toBe(inbox2.totalInsightInstances);
    expect(inbox1.truncated).toBe(inbox2.truncated);
    expect(inbox1.inbox_version).toBe(inbox2.inbox_version);
  });

  it("should always include all required frontmatter fields in empty inbox", () => {
    const inbox = buildKeyTakeawaysInbox([]);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("inbox_version:");
    expect(markdown).toContain("insights_count: 0");
    expect(markdown).toContain("source_clips_processed: 0");
    expect(markdown).toContain("active_insights: 0");
    expect(markdown).toContain("archived_insights: 0");
    expect(markdown).toContain("inbox_truncated: false");
    expect(markdown).toContain("generated_at:");
  });

  it("should show empty state message when no active insights", () => {
    const inbox = buildKeyTakeawaysInbox([]);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(markdown).toContain("No active insights found");
  });

  it("should show empty state when all insights are archived", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Archived insight",
        clipPath: "/path/to/clip.md",
        clipTitle: "Clip",
        clipUrl: "https://example.com",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip",
        status: InsightStatus.ARCHIVED
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);
    const markdown = renderKeyTakeawaysInbox(inbox);

    expect(inbox.entries).toHaveLength(0);
    expect(inbox.archivedInsights).toBe(1);
    expect(markdown).toContain("No active insights found");
  });

  it("should have consistent structure for empty inbox", () => {
    const inbox = buildKeyTakeawaysInbox([]);
    const markdown = renderKeyTakeawaysInbox(inbox);

    // Check structure is present even when empty
    expect(markdown).toContain("# Key Takeaways Inbox");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Key Takeaways");
    expect(markdown).toContain("---"); // Frontmatter delimiters
  });
});

describe("Dedupe Contract", () => {
  it("should dedupe insights with different case", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "React Server Components use RSC payload",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "react server components use rsc payload",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]?.source_clip_count).toBe(2);
  });

  it("should dedupe insights with different trailing punctuation", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "RSC uses payload",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "RSC uses payload!",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]?.source_clip_count).toBe(2);
  });

  it("should dedupe insights with different whitespace", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "RSC   uses   payload",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "  RSC uses payload  ",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]?.source_clip_count).toBe(2);
  });

  it("should dedupe insights with bullet markers", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "- RSC uses payload",
        clipPath: "/path/to/clip1.md",
        clipTitle: "Clip 1",
        clipUrl: "https://example.com/1",
        clipTimestamp: "2026-03-01T10:00:00.000Z",
        clipId: "clip1",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "RSC uses payload",
        clipPath: "/path/to/clip2.md",
        clipTitle: "Clip 2",
        clipUrl: "https://example.com/2",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "clip2",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]?.source_clip_count).toBe(2);
  });
});

describe("Stable Source-Link Ordering", () => {
  it("should sort source clips by timestamp (most recent first)", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Same insight",
        clipPath: "/path/to/old.md",
        clipTitle: "Old Clip",
        clipUrl: "https://example.com/old",
        clipTimestamp: "2026-01-01T10:00:00.000Z",
        clipId: "old",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Same insight",
        clipPath: "/path/to/new.md",
        clipTitle: "New Clip",
        clipUrl: "https://example.com/new",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "new",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Same insight",
        clipPath: "/path/to/mid.md",
        clipTitle: "Mid Clip",
        clipUrl: "https://example.com/mid",
        clipTimestamp: "2026-02-15T10:00:00.000Z",
        clipId: "mid",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox = buildKeyTakeawaysInbox(inputs);

    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]?.source_clip_refs[0]?.id).toBe("new");
    expect(inbox.entries[0]?.source_clip_refs[1]?.id).toBe("mid");
    expect(inbox.entries[0]?.source_clip_refs[2]?.id).toBe("old");
  });

  it("should produce stable ordering across multiple runs", () => {
    const inputs: KeyTakeawayInput[] = [
      {
        insight: "Same insight",
        clipPath: "/path/to/a.md",
        clipTitle: "A",
        clipUrl: "https://example.com/a",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "a",
        status: InsightStatus.ACTIVE
      },
      {
        insight: "Same insight",
        clipPath: "/path/to/b.md",
        clipTitle: "B",
        clipUrl: "https://example.com/b",
        clipTimestamp: "2026-03-03T10:00:00.000Z",
        clipId: "b",
        status: InsightStatus.ACTIVE
      }
    ];

    const inbox1 = buildKeyTakeawaysInbox([...inputs]);
    const inbox2 = buildKeyTakeawaysInbox([...inputs]);

    const refs1 = inbox1.entries[0]?.source_clip_refs.map(r => r.id);
    const refs2 = inbox2.entries[0]?.source_clip_refs.map(r => r.id);

    expect(refs1).toEqual(refs2);
  });
});
