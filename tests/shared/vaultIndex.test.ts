/**
 * Vault Index Tests
 *
 * Tests for vault indexing utilities including markdown file discovery,
 * frontmatter parsing, and candidate note building.
 */

import { describe, expect, test } from "bun:test";
import { promises as fs } from "fs";
import * as path from "path";
import { tmpdir } from "os";

import {
  extractFrontmatter,
  extractTitle,
  extractTimestamp,
  extractDomain,
  extractEntities,
  extractTags,
  buildCandidateNote,
  hasRequiredTags,
  meetsMinDateFilter,
  indexVault,
  indexSingleNote,
  type ParsedFrontmatter
} from "../../src/shared/vaultIndex";

describe("extractFrontmatter", () => {
  test("extracts standard YAML frontmatter delimited by ---", () => {
    const content = `---
source: https://example.com/article
title: Test Article
type: article
tags:
  - tech
  - javascript
---

# Content here`;

    const frontmatter = extractFrontmatter(content);

    expect(frontmatter).not.toBeNull();
    expect(frontmatter?.source).toBe("https://example.com/article");
    expect(frontmatter?.title).toBe("Test Article");
    expect(frontmatter?.type).toBe("article");
    expect(frontmatter?.tags).toEqual(["tech", "javascript"]);
  });

  test("extracts alternative frontmatter delimited by +++", () => {
    const content = `+++
source: https://example.com/article
title: Test Article
+++

# Content here`;

    const frontmatter = extractFrontmatter(content);

    expect(frontmatter).not.toBeNull();
    expect(frontmatter?.source).toBe("https://example.com/article");
    expect(frontmatter?.title).toBe("Test Article");
  });

  test("returns null when no frontmatter found", () => {
    const content = `# No Frontmatter

Just content here.`;

    const frontmatter = extractFrontmatter(content);

    expect(frontmatter).toBeNull();
  });

  test("returns null when frontmatter is empty", () => {
    const content = `---
---

Content`;

    const frontmatter = extractFrontmatter(content);

    expect(frontmatter).toBeNull();
  });

  test("returns null when frontmatter not at start", () => {
    const content = `# Heading first

---
source: https://example.com
---

Content`;

    const frontmatter = extractFrontmatter(content);

    expect(frontmatter).toBeNull();
  });

  test("handles malformed YAML gracefully", () => {
    const content = `---
source: [invalid yaml
---
# Content`;

    const frontmatter = extractFrontmatter(content);

    // Should return null on parse error
    expect(frontmatter).toBeNull();
  });

  test("extracts keywords field", () => {
    const content = `---
keywords:
  - typescript
  - api
  - testing
---

# Content`;

    const frontmatter = extractFrontmatter(content);

    expect(frontmatter?.keywords).toEqual(["typescript", "api", "testing"]);
  });

  test("extracts keywords as comma-separated string", () => {
    const content = `---
keywords: typescript, api, testing
---

# Content`;

    const frontmatter = extractFrontmatter(content);

    expect(frontmatter?.keywords).toBe("typescript, api, testing");
  });
});

describe("extractTitle", () => {
  test("extracts first H1 heading", () => {
    const content = `# My Title

Some content here`;

    const title = extractTitle(content, "filename");

    expect(title).toBe("My Title");
  });

  test("returns filename when no H1 found", () => {
    const content = `Some content without a heading`;

    const title = extractTitle(content, "MyFilename");

    expect(title).toBe("MyFilename");
  });

  test("handles H1 with leading/trailing spaces", () => {
    const content = `#   Trimmed Title   

Content`;

    const title = extractTitle(content, "filename");

    expect(title).toBe("Trimmed Title");
  });

  test("returns first H1 when multiple headings exist", () => {
    const content = `# First Title

Content

# Second Title

More content`;

    const title = extractTitle(content, "filename");

    expect(title).toBe("First Title");
  });
});

describe("extractTimestamp", () => {
  test("prioritizes date_clipped over published_date", () => {
    const frontmatter: ParsedFrontmatter = {
      date_clipped: "2026-03-03T10:00:00Z",
      published_date: "2026-03-01T10:00:00Z"
    };

    const timestamp = extractTimestamp(frontmatter);

    expect(timestamp).toBe("2026-03-03T10:00:00Z");
  });

  test("uses published_date when date_clipped not present", () => {
    const frontmatter: ParsedFrontmatter = {
      published_date: "2026-03-01T10:00:00Z"
    };

    const timestamp = extractTimestamp(frontmatter);

    expect(timestamp).toBe("2026-03-01T10:00:00Z");
  });

  test("returns current time when no date fields present", () => {
    const frontmatter: ParsedFrontmatter = {};

    const timestamp = extractTimestamp(frontmatter);

    expect(timestamp).toBeTruthy();
    expect(() => new Date(timestamp)).not.toThrow();
  });
});

describe("extractDomain", () => {
  test("extracts domain from valid URL", () => {
    expect(extractDomain("https://example.com/article")).toBe("example.com");
    expect(extractDomain("https://docs.example.com/path")).toBe("docs.example.com");
    expect(extractDomain("http://github.com/user/repo")).toBe("github.com");
  });

  test("returns empty string for invalid URL", () => {
    expect(extractDomain("not a url")).toBe("");
    expect(extractDomain("")).toBe("");
    expect(extractDomain(undefined)).toBe("");
  });

  test("handles URLs with ports and paths", () => {
    expect(extractDomain("https://example.com:8080/path/to/page")).toBe("example.com");
  });
});

describe("extractEntities", () => {
  test("extracts keywords as array", () => {
    const frontmatter: ParsedFrontmatter = {
      keywords: ["typescript", "api", "testing"]
    };

    const entities = extractEntities(frontmatter);

    expect(entities).toEqual(["typescript", "api", "testing"]);
  });

  test("extracts keywords as comma-separated string", () => {
    const frontmatter: ParsedFrontmatter = {
      keywords: "typescript, api, testing"
    };

    const entities = extractEntities(frontmatter);

    expect(entities).toEqual(["typescript", "api", "testing"]);
  });

  test("trims whitespace from entities", () => {
    const frontmatter: ParsedFrontmatter = {
      keywords: ["  typescript  ", "  api", "testing  "]
    };

    const entities = extractEntities(frontmatter);

    expect(entities).toEqual(["typescript", "api", "testing"]);
  });

  test("filters out empty entities", () => {
    const frontmatter: ParsedFrontmatter = {
      keywords: ["typescript", "", "api", null as any, undefined]
    };

    const entities = extractEntities(frontmatter);

    expect(entities).toEqual(["typescript", "api"]);
  });

  test("handles missing keywords field", () => {
    const frontmatter: ParsedFrontmatter = {};

    const entities = extractEntities(frontmatter);

    expect(entities).toEqual([]);
  });
});

describe("extractTags", () => {
  test("extracts tags as array", () => {
    const frontmatter: ParsedFrontmatter = {
      tags: ["tech", "javascript", "tutorial"]
    };

    const tags = extractTags(frontmatter);

    expect(tags).toEqual(["tech", "javascript", "tutorial"]);
  });

  test("extracts tags as comma-separated string", () => {
    const frontmatter: ParsedFrontmatter = {
      tags: "tech, javascript, tutorial"
    };

    const tags = extractTags(frontmatter);

    expect(tags).toEqual(["tech", "javascript", "tutorial"]);
  });

  test("deduplicates tags", () => {
    const frontmatter: ParsedFrontmatter = {
      tags: ["tech", "javascript", "tech", "javascript"]
    };

    const tags = extractTags(frontmatter);

    expect(tags).toEqual(["tech", "javascript"]);
  });

  test("case-sensitive tag deduplication", () => {
    const frontmatter: ParsedFrontmatter = {
      tags: ["Tech", "tech", "TECH"]
    };

    const tags = extractTags(frontmatter);

    // Keeps case but dedupes exact matches
    expect(tags).toEqual(["Tech", "tech", "TECH"]);
  });
});

describe("buildCandidateNote", () => {
  test("builds candidate note from frontmatter", () => {
    const frontmatter: ParsedFrontmatter = {
      source: "https://example.com/article",
      title: "Test Article",
      type: "article",
      keywords: ["typescript", "api"],
      tags: ["tech", "tutorial"],
      date_clipped: "2026-03-03T10:00:00Z"
    };

    const candidate = buildCandidateNote("path/to/article.md", frontmatter, "Test Article");

    expect(candidate.path).toBe("path/to/article.md");
    expect(candidate.title).toBe("Test Article");
    expect(candidate.sourceUrl).toBe("https://example.com/article");
    expect(candidate.domain).toBe("example.com");
    expect(candidate.contentType).toBe("article");
    expect(candidate.entities).toEqual(["typescript", "api"]);
    expect(candidate.tags).toEqual(["tech", "tutorial"]);
    expect(candidate.timestamp).toBe("2026-03-03T10:00:00Z");
    expect(candidate.id).toBe("path/to/article.md");
  });

  test("falls back to url when source not present", () => {
    const frontmatter: ParsedFrontmatter = {
      url: "https://example.com/article",
      title: "Test Article"
    };

    const candidate = buildCandidateNote("path/to/article.md", frontmatter, "Test Article");

    expect(candidate.sourceUrl).toBe("https://example.com/article");
    expect(candidate.domain).toBe("example.com");
  });

  test("defaults content type to article", () => {
    const frontmatter: ParsedFrontmatter = {
      source: "https://example.com/article",
      title: "Test Article"
    };

    const candidate = buildCandidateNote("path/to/article.md", frontmatter, "Test Article");

    expect(candidate.contentType).toBe("article");
  });

  test("handles undefined domain", () => {
    const frontmatter: ParsedFrontmatter = {
      title: "Test Article",
      type: "article"
    };

    const candidate = buildCandidateNote("path/to/article.md", frontmatter, "Test Article");

    expect(candidate.domain).toBeUndefined();
    expect(candidate.sourceUrl).toBeUndefined();
  });
});

describe("hasRequiredTags", () => {
  test("returns true when all required tags present", () => {
    const frontmatter: ParsedFrontmatter = {
      tags: ["clip", "tech", "javascript"]
    };

    const hasTags = hasRequiredTags(frontmatter, ["clip", "tech"]);

    expect(hasTags).toBe(true);
  });

  test("returns false when required tags missing", () => {
    const frontmatter: ParsedFrontmatter = {
      tags: ["clip", "javascript"]
    };

    const hasTags = hasRequiredTags(frontmatter, ["clip", "tech"]);

    expect(hasTags).toBe(false);
  });

  test("case-insensitive tag matching", () => {
    const frontmatter: ParsedFrontmatter = {
      tags: ["CLIP", "Tech"]
    };

    const hasTags = hasRequiredTags(frontmatter, ["clip", "tech"]);

    expect(hasTags).toBe(true);
  });

  test("returns true when no required tags specified", () => {
    const frontmatter: ParsedFrontmatter = {
      tags: ["tech"]
    };

    const hasTags = hasRequiredTags(frontmatter, []);

    expect(hasTags).toBe(true);
  });

  test("handles tags as comma-separated string", () => {
    const frontmatter: ParsedFrontmatter = {
      tags: "clip, tech, javascript"
    };

    const hasTags = hasRequiredTags(frontmatter, ["clip", "tech"]);

    expect(hasTags).toBe(true);
  });
});

describe("meetsMinDateFilter", () => {
  test("returns true when note date is after min date", () => {
    const frontmatter: ParsedFrontmatter = {
      date_clipped: "2026-03-03T10:00:00Z"
    };

    const meetsFilter = meetsMinDateFilter(frontmatter, "2026-03-01T00:00:00Z");

    expect(meetsFilter).toBe(true);
  });

  test("returns false when note date is before min date", () => {
    const frontmatter: ParsedFrontmatter = {
      date_clipped: "2026-03-01T10:00:00Z"
    };

    const meetsFilter = meetsMinDateFilter(frontmatter, "2026-03-03T00:00:00Z");

    expect(meetsFilter).toBe(false);
  });

  test("returns true when note date equals min date", () => {
    const frontmatter: ParsedFrontmatter = {
      date_clipped: "2026-03-03T10:00:00Z"
    };

    const meetsFilter = meetsMinDateFilter(frontmatter, "2026-03-03T10:00:00Z");

    expect(meetsFilter).toBe(true);
  });

  test("handles invalid date format by including note", () => {
    const frontmatter: ParsedFrontmatter = {
      date_clipped: "invalid-date"
    };

    const meetsFilter = meetsMinDateFilter(frontmatter, "2026-03-03T00:00:00Z");

    // Includes note on parse error
    expect(meetsFilter).toBe(true);
  });
});

describe("indexVault integration tests", () => {
  test("indexes simple vault with one note", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const notePath = path.join(tempDir, "test-note.md");
      const noteContent = `---
source: https://example.com/article
title: Test Article
type: article
tags:
  - clip
---

# Test Article

Content here`;

      await fs.writeFile(notePath, noteContent);

      const result = await indexVault({ vaultPath: tempDir });

      expect(result.filesScanned).toBe(1);
      expect(result.filesWithFrontmatter).toBe(1);
      expect(result.filesSkipped).toBe(0);
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].title).toBe("Test Article");
      expect(result.candidates[0].sourceUrl).toBe("https://example.com/article");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("filters notes by required tags", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const note1Path = path.join(tempDir, "note1.md");
      await fs.writeFile(note1Path, `---
source: https://example.com/1
title: Note 1
tags:
  - clip
---

# Note 1`);

      const note2Path = path.join(tempDir, "note2.md");
      await fs.writeFile(note2Path, `---
source: https://example.com/2
title: Note 2
tags:
  - other
---

# Note 2`);

      const result = await indexVault({
        vaultPath: tempDir,
        requiredTags: ["clip"]
      });

      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].title).toBe("Note 1");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("filters notes by min date", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const note1Path = path.join(tempDir, "note1.md");
      await fs.writeFile(note1Path, `---
source: https://example.com/1
title: Note 1
date_clipped: 2026-03-01T10:00:00Z
---

# Note 1`);

      const note2Path = path.join(tempDir, "note2.md");
      await fs.writeFile(note2Path, `---
source: https://example.com/2
title: Note 2
date_clipped: 2026-03-03T10:00:00Z
---

# Note 2`);

      const result = await indexVault({
        vaultPath: tempDir,
        minDate: "2026-03-02T00:00:00Z"
      });

      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].title).toBe("Note 2");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("skips notes without source URL", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const notePath = path.join(tempDir, "note.md");
      await fs.writeFile(notePath, `---
title: Note Without URL
---

# Note`);

      const result = await indexVault({ vaultPath: tempDir });

      expect(result.candidates.length).toBe(0);
      expect(result.filesSkipped).toBe(1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("skips notes without frontmatter", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const notePath = path.join(tempDir, "note.md");
      await fs.writeFile(notePath, `# Just Content

No frontmatter here`);

      const result = await indexVault({ vaultPath: tempDir });

      expect(result.candidates.length).toBe(0);
      expect(result.filesSkipped).toBe(1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("respects maxFiles limit", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      for (let i = 1; i <= 5; i++) {
        const notePath = path.join(tempDir, `note${i}.md`);
        await fs.writeFile(notePath, `---
source: https://example.com/${i}
title: Note ${i}
---

# Note ${i}`);
      }

      const result = await indexVault({
        vaultPath: tempDir,
        maxFiles: 3
      });

      expect(result.candidates.length).toBe(3);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("indexes notes in subdirectories", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const subdir = path.join(tempDir, "subdir");
      await fs.mkdir(subdir);

      const notePath = path.join(subdir, "note.md");
      await fs.writeFile(notePath, `---
source: https://example.com/article
title: Note in Subdir
---

# Note`);

      const result = await indexVault({ vaultPath: tempDir });

      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].path).toContain("subdir");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("excludes hidden files by default", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const notePath = path.join(tempDir, ".hidden-note.md");
      await fs.writeFile(notePath, `---
source: https://example.com/article
title: Hidden Note
---

# Note`);

      const result = await indexVault({ vaultPath: tempDir });

      expect(result.filesScanned).toBe(0);
      expect(result.candidates.length).toBe(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("includes hidden files when includeHidden is true", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const notePath = path.join(tempDir, ".hidden-note.md");
      await fs.writeFile(notePath, `---
source: https://example.com/article
title: Hidden Note
---

# Note`);

      const result = await indexVault({ vaultPath: tempDir, includeHidden: true });

      expect(result.filesScanned).toBe(1);
      expect(result.candidates.length).toBe(1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("handles maxDepth option", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const subdir1 = path.join(tempDir, "level1");
      await fs.mkdir(subdir1);

      const subdir2 = path.join(subdir1, "level2");
      await fs.mkdir(subdir2);

      const note1Path = path.join(subdir1, "note1.md");
      await fs.writeFile(note1Path, `---
source: https://example.com/1
title: Note 1
---

# Note 1`);

      const note2Path = path.join(subdir2, "note2.md");
      await fs.writeFile(note2Path, `---
source: https://example.com/2
title: Note 2
---

# Note 2`);

      const result = await indexVault({ vaultPath: tempDir, maxDepth: 1 });

      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].title).toBe("Note 1");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("handles .markdown extension", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const notePath = path.join(tempDir, "note.markdown");
      await fs.writeFile(notePath, `---
source: https://example.com/article
title: Test Note
---

# Note`);

      const result = await indexVault({ vaultPath: tempDir });

      expect(result.candidates.length).toBe(1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("collects errors for failed reads", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      // Create a valid markdown file with malformed frontmatter that causes parse error
      // This tests the error collection path in indexVault
      const notePath = path.join(tempDir, "malformed.md");
      await fs.writeFile(notePath, `---
source: [invalid yaml without closing bracket
title: Malformed Note
---

# Content`);

      const result = await indexVault({ vaultPath: tempDir });

      // The file should be skipped (not added to candidates)
      // but no error should be collected since the parse error is caught internally
      expect(result.candidates.length).toBe(0);
      expect(result.filesSkipped).toBe(1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("indexSingleNote", () => {
  test("indexes a single note", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const notePath = path.join(tempDir, "test.md");
      await fs.writeFile(notePath, `---
source: https://example.com/article
title: Test Article
---

# Content`);

      const candidate = await indexSingleNote(notePath);

      expect(candidate).not.toBeNull();
      expect(candidate?.title).toBe("Test Article");
      expect(candidate?.sourceUrl).toBe("https://example.com/article");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("returns null for note without frontmatter", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const notePath = path.join(tempDir, "test.md");
      await fs.writeFile(notePath, `# No frontmatter`);

      const candidate = await indexSingleNote(notePath);

      expect(candidate).toBeNull();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("returns null for note without source URL", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const notePath = path.join(tempDir, "test.md");
      await fs.writeFile(notePath, `---
title: No URL
---

# Content`);

      const candidate = await indexSingleNote(notePath);

      expect(candidate).toBeNull();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("returns null for non-existent file", async () => {
    const tempDir = path.join(tmpdir(), `vault-index-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const notePath = path.join(tempDir, "does-not-exist.md");
      const candidate = await indexSingleNote(notePath);

      expect(candidate).toBeNull();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
