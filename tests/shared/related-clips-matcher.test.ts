/**
 * Related Clips Matcher Tests
 *
 * Tests for the matcher that integrates vault indexing with the
 * related clips contract.
 */

import { describe, expect, test } from "bun:test";
import { promises as fs } from "fs";
import * as path from "path";
import { tmpdir } from "os";

import {
  clipResultToInput,
  clipMetadataToInput,
  buildMatcherInput,
  excludeCurrentNote,
  matchRelatedClips,
  matchRelatedClipsFromMetadata,
  matchRelatedClipsFromCandidates,
  getMatcherDiagnostics,
  getNoMatchDiagnostics,
  type RelatedClipsMatcherOptions,
  type RelatedClipsMatcherResult
} from "../../src/shared/relatedClipsMatcher";

import type { ClipResult, ClipMetadata } from "../../src/shared/types";
import type { CandidateNote } from "../../src/shared/relatedClipsContract";
import { DEFAULT_NO_MATCH_DIAGNOSTICS } from "../../src/shared/relatedClipsContract";

describe("clipResultToInput", () => {
  test("converts clip result to related clips input", () => {
    const clipResult: ClipResult = {
      url: "https://example.com/article",
      title: "Test Article",
      markdown: "# Content",
      metadata: {
        url: "https://example.com/article",
        title: "Test Article",
        type: "article",
        keywords: ["typescript", "api"],
        canonicalUrl: "https://example.com/article/canonical"
      }
    };

    const input = clipResultToInput(clipResult);

    expect(input.sourceUrl).toBe("https://example.com/article/canonical");
    expect(input.domain).toBe("example.com");
    expect(input.contentType).toBe("article");
    expect(input.entities).toEqual(["typescript", "api"]);
    expect(input.tags).toEqual([]);
    expect(input.timestamp).toBeTruthy();
  });

  test("falls back to URL when canonical URL not present", () => {
    const clipResult: ClipResult = {
      url: "https://example.com/article",
      title: "Test Article",
      markdown: "# Content",
      metadata: {
        url: "https://example.com/article",
        title: "Test Article",
        type: "article"
      }
    };

    const input = clipResultToInput(clipResult);

    expect(input.sourceUrl).toBe("https://example.com/article");
  });

  test("handles keywords as comma-separated string", () => {
    const clipResult: ClipResult = {
      url: "https://example.com/article",
      title: "Test Article",
      markdown: "# Content",
      metadata: {
        url: "https://example.com/article",
        title: "Test Article",
        type: "article",
        keywords: "typescript, api, testing"
      }
    };

    const input = clipResultToInput(clipResult);

    expect(input.entities).toEqual(["typescript", "api", "testing"]);
  });

  test("handles missing keywords", () => {
    const clipResult: ClipResult = {
      url: "https://example.com/article",
      title: "Test Article",
      markdown: "# Content",
      metadata: {
        url: "https://example.com/article",
        title: "Test Article",
        type: "article"
      }
    };

    const input = clipResultToInput(clipResult);

    expect(input.entities).toEqual([]);
  });

  test("defaults content type to article", () => {
    const clipResult: ClipResult = {
      url: "https://example.com/article",
      title: "Test Article",
      markdown: "# Content",
      metadata: {
        url: "https://example.com/article",
        title: "Test Article"
      }
    };

    const input = clipResultToInput(clipResult);

    expect(input.contentType).toBe("article");
  });

  test("extracts domain correctly", () => {
    const clipResult: ClipResult = {
      url: "https://github.com/user/repo",
      title: "GitHub Repo",
      markdown: "# Content",
      metadata: {
        url: "https://github.com/user/repo",
        title: "GitHub Repo",
        type: "article"
      }
    };

    const input = clipResultToInput(clipResult);

    expect(input.domain).toBe("github.com");
  });
});

describe("clipMetadataToInput", () => {
  test("converts metadata to related clips input", () => {
    const metadata: ClipMetadata = {
      url: "https://example.com/article",
      title: "Test Article",
      type: "article",
      keywords: ["typescript", "api"]
    };

    const input = clipMetadataToInput(metadata, "https://example.com/article");

    expect(input.sourceUrl).toBe("https://example.com/article");
    expect(input.domain).toBe("example.com");
    expect(input.contentType).toBe("article");
    expect(input.entities).toEqual(["typescript", "api"]);
  });

  test("uses url parameter when not in metadata", () => {
    const metadata: ClipMetadata = {
      title: "Test Article",
      type: "article"
    };

    const input = clipMetadataToInput(metadata, "https://example.com/article");

    expect(input.sourceUrl).toBe("https://example.com/article");
  });
});

describe("buildMatcherInput", () => {
  test("builds input from raw values", () => {
    const input = buildMatcherInput(
      "https://example.com/article",
      "article",
      ["typescript", "api"],
      ["tech", "tutorial"],
      "2026-03-03T10:00:00Z"
    );

    expect(input.sourceUrl).toBe("https://example.com/article");
    expect(input.domain).toBe("example.com");
    expect(input.contentType).toBe("article");
    expect(input.entities).toEqual(["typescript", "api"]);
    expect(input.tags).toEqual(["tech", "tutorial"]);
    expect(input.timestamp).toBe("2026-03-03T10:00:00Z");
  });

  test("defaults empty arrays for entities and tags", () => {
    const input = buildMatcherInput("https://example.com/article", "article");

    expect(input.entities).toEqual([]);
    expect(input.tags).toEqual([]);
  });

  test("defaults timestamp to current time", () => {
    const input = buildMatcherInput("https://example.com/article", "article");

    expect(input.timestamp).toBeTruthy();
    const timestamp = new Date(input.timestamp);
    const now = new Date();
    const diff = Math.abs(now.getTime() - timestamp.getTime());
    expect(diff).toBeLessThan(1000); // Within 1 second
  });

  test("extracts domain from URL", () => {
    const input = buildMatcherInput(
      "https://docs.example.com/path/to/page",
      "article"
    );

    expect(input.domain).toBe("docs.example.com");
  });
});

describe("excludeCurrentNote", () => {
  test("excludes note with matching path", () => {
    const candidates: CandidateNote[] = [
      { path: "path/to/note1.md", title: "Note 1", sourceUrl: "https://example.com/1", domain: "example.com", contentType: "article", entities: [], tags: [], timestamp: "2026-03-03T10:00:00Z", id: "path/to/note1.md" },
      { path: "path/to/note2.md", title: "Note 2", sourceUrl: "https://example.com/2", domain: "example.com", contentType: "article", entities: [], tags: [], timestamp: "2026-03-03T10:00:00Z", id: "path/to/note2.md" },
      { path: "path/to/note3.md", title: "Note 3", sourceUrl: "https://example.com/3", domain: "example.com", contentType: "article", entities: [], tags: [], timestamp: "2026-03-03T10:00:00Z", id: "path/to/note3.md" }
    ];

    const filtered = excludeCurrentNote(candidates, "path/to/note2.md");

    expect(filtered.length).toBe(2);
    expect(filtered.find((c) => c.path === "path/to/note2.md")).toBeUndefined();
  });

  test("returns all candidates when excludePath is undefined", () => {
    const candidates: CandidateNote[] = [
      { path: "path/to/note1.md", title: "Note 1", sourceUrl: "https://example.com/1", domain: "example.com", contentType: "article", entities: [], tags: [], timestamp: "2026-03-03T10:00:00Z", id: "path/to/note1.md" }
    ];

    const filtered = excludeCurrentNote(candidates, undefined);

    expect(filtered.length).toBe(1);
  });

  test("returns all candidates when excludePath is empty string", () => {
    const candidates: CandidateNote[] = [
      { path: "path/to/note1.md", title: "Note 1", sourceUrl: "https://example.com/1", domain: "example.com", contentType: "article", entities: [], tags: [], timestamp: "2026-03-03T10:00:00Z", id: "path/to/note1.md" }
    ];

    const filtered = excludeCurrentNote(candidates, "");

    expect(filtered.length).toBe(1);
  });
});

describe("matchRelatedClips integration tests", () => {
  test("matches related clips for new clip", async () => {
    const tempDir = path.join(tmpdir(), `matcher-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
    // Create existing notes
    const note1Path = path.join(tempDir, "note1.md");
    await fs.writeFile(note1Path, `---
source: https://example.com/article1
title: Related Article 1
type: article
tags:
  - clip
keywords:
  - typescript
  - api
date_clipped: 2026-03-01T10:00:00Z
---

# Related Article 1`);

    const note2Path = path.join(tempDir, "note2.md");
    await fs.writeFile(note2Path, `---
source: https://example.com/article2
title: Related Article 2
type: article
tags:
  - clip
keywords:
  - testing
date_clipped: 2026-03-02T10:00:00Z
---

# Related Article 2`);

    // Create new clip result
    const newClip: ClipResult = {
      url: "https://example.com/new-article",
      title: "New Article",
      markdown: "# New Article",
      metadata: {
        url: "https://example.com/new-article",
        title: "New Article",
        type: "article",
        keywords: ["typescript", "testing"]
      }
    };

    const options: RelatedClipsMatcherOptions = {
      vaultPath: tempDir,
      requiredTags: ["clip"]
    };

    const result = await matchRelatedClips(newClip, options);

    expect(result.result.relatedClips.length).toBeGreaterThan(0);
    expect(result.index.filesScanned).toBe(2);
    expect(result.index.filesWithFrontmatter).toBe(2);
    expect(result.matching.positiveMatches).toBeGreaterThan(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("finds exact URL match", async () => {
    const tempDir = path.join(tmpdir(), `matcher-test-exact-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const existingPath = path.join(tempDir, "existing.md");
      await fs.writeFile(existingPath, `---
source: https://example.com/same-url
title: Existing Note
type: article
tags:
  - clip
date_clipped: 2026-03-01T10:00:00Z
---

# Existing Note`);

      const newClip: ClipResult = {
        url: "https://example.com/same-url",
        title: "New Clip",
        markdown: "# New Clip",
        metadata: {
          url: "https://example.com/same-url",
          title: "New Clip",
          type: "article"
        }
      };

      const options: RelatedClipsMatcherOptions = {
        vaultPath: tempDir,
        requiredTags: ["clip"],
        excludePath: existingPath
      };

      const result = await matchRelatedClips(newClip, options);

      // Should find the existing note if not excluded
      // When excluded, should return no matches
      expect(result.result.relatedClips.length).toBe(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("returns no matches when vault is empty", async () => {
    const tempDir = path.join(tmpdir(), `matcher-test-empty-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const newClip: ClipResult = {
        url: "https://example.com/article",
        title: "New Article",
        markdown: "# New Article",
        metadata: {
          url: "https://example.com/article",
          title: "New Article",
          type: "article"
        }
      };

      const options: RelatedClipsMatcherOptions = {
        vaultPath: tempDir
      };

      const result = await matchRelatedClips(newClip, options);

      expect(result.result.relatedClips.length).toBe(0);
      expect(result.result.topScore).toBe(0);
      expect(result.index.filesScanned).toBe(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("respects maxRelatedClips limit", async () => {
    const tempDir = path.join(tmpdir(), `matcher-test-limit-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      // Create multiple related notes
      for (let i = 1; i <= 10; i++) {
        const notePath = path.join(tempDir, `note${i}.md`);
        await fs.writeFile(notePath, `---
source: https://example.com/article${i}
title: Note ${i}
type: article
tags:
  - clip
keywords:
  - typescript
date_clipped: 2026-03-${String(i).padStart(2, "0")}T10:00:00Z
---

# Note ${i}`);
      }

      const newClip: ClipResult = {
        url: "https://example.com/new",
        title: "New Article",
        markdown: "# New Article",
        metadata: {
          url: "https://example.com/new",
          title: "New Article",
          type: "article",
          keywords: ["typescript"]
        }
      };

      const options: RelatedClipsMatcherOptions = {
        vaultPath: tempDir,
        requiredTags: ["clip"],
        maxRelatedClips: 3
      };

      const result = await matchRelatedClips(newClip, options);

      expect(result.result.relatedClips.length).toBeLessThanOrEqual(3);
      expect(result.result.truncated).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("filters candidates by required tags", async () => {
    const tempDir = path.join(tmpdir(), `matcher-test-tags-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const note1Path = path.join(tempDir, "note1.md");
      await fs.writeFile(note1Path, `---
source: https://example.com/1
title: With Tag
type: article
tags:
  - clip
date_clipped: 2026-03-01T10:00:00Z
---

# Note 1`);

      const note2Path = path.join(tempDir, "note2.md");
      await fs.writeFile(note2Path, `---
source: https://example.com/2
title: Without Tag
type: article
tags:
  - other
date_clipped: 2026-03-02T10:00:00Z
---

# Note 2`);

      const newClip: ClipResult = {
        url: "https://example.com/new",
        title: "New Article",
        markdown: "# New Article",
        metadata: {
          url: "https://example.com/new",
          title: "New Article",
          type: "article"
        }
      };

      const options: RelatedClipsMatcherOptions = {
        vaultPath: tempDir,
        requiredTags: ["clip"]
      };

      const result = await matchRelatedClips(newClip, options);

      expect(result.index.candidatesEvaluated).toBeLessThan(2);
      expect(result.matching.input.sourceUrl).toBe("https://example.com/new");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("matchRelatedClipsFromMetadata", () => {
  test("matches from metadata without full clip result", async () => {
    const metadata: ClipMetadata = {
      url: "https://example.com/new",
      title: "New Article",
      type: "article",
      keywords: ["typescript"]
    };

    const options: RelatedClipsMatcherOptions = {
      vaultPath: path.join(tmpdir(), `test-${Date.now()}`) // Empty vault
    };

    const result = await matchRelatedClipsFromMetadata(metadata, "https://example.com/new", options);

    expect(result).toBeDefined();
    expect(result.matching.input.sourceUrl).toBe("https://example.com/new");
  });
});

describe("matchRelatedClipsFromCandidates", () => {
  test("matches from pre-indexed candidates", async () => {
    const candidates: CandidateNote[] = [
      {
        path: "note1.md",
        title: "Note 1",
        sourceUrl: "https://example.com/1",
        domain: "example.com",
        contentType: "article",
        entities: ["typescript", "api"],
        tags: ["tech"],
        timestamp: "2026-03-01T10:00:00Z",
        id: "note1.md"
      },
      {
        path: "note2.md",
        title: "Note 2",
        sourceUrl: "https://example.com/2",
        domain: "example.com",
        contentType: "article",
        entities: ["testing"],
        tags: ["tech"],
        timestamp: "2026-03-02T10:00:00Z",
        id: "note2.md"
      }
    ];

    const input = buildMatcherInput(
      "https://example.com/new",
      "article",
      ["typescript", "testing"]
    );

    const result = await matchRelatedClipsFromCandidates(input, candidates, 5);

    expect(result.result.relatedClips.length).toBeGreaterThan(0);
    expect(result.result.topScore).toBeGreaterThan(0);
  });

  test("excludes current note from candidates", async () => {
    const candidates: CandidateNote[] = [
      {
        path: "current.md",
        title: "Current Note",
        sourceUrl: "https://example.com/current",
        domain: "example.com",
        contentType: "article",
        entities: ["typescript"],
        tags: [],
        timestamp: "2026-03-03T10:00:00Z",
        id: "current.md"
      },
      {
        path: "other.md",
        title: "Other Note",
        sourceUrl: "https://example.com/other",
        domain: "example.com",
        contentType: "article",
        entities: ["typescript"],
        tags: [],
        timestamp: "2026-03-02T10:00:00Z",
        id: "other.md"
      }
    ];

    const input = buildMatcherInput(
      "https://example.com/current",
      "article",
      ["typescript"]
    );

    const result = await matchRelatedClipsFromCandidates(
      input,
      candidates,
      5,
      "current.md"
    );

    expect(result.result.relatedClips.length).toBe(1);
    expect(result.result.relatedClips[0].title).toBe("Other Note");
  });
});

describe("getMatcherDiagnostics", () => {
  test("extracts diagnostics from matcher result", () => {
    const mockResult: RelatedClipsMatcherResult = {
      result: {
        relatedClips: [
          {
            path: "note1.md",
            title: "Note 1",
            score: 42,
            timestamp: "2026-03-01T10:00:00Z",
            id: "note1.md"
          }
        ],
        candidatesEvaluated: 5,
        matchesFound: 3,
        truncated: true,
        topScore: 42,
        graphVersion: "1.0.0"
      },
      index: {
        candidatesEvaluated: 5,
        filesScanned: 10,
        filesWithFrontmatter: 5,
        filesSkipped: 5,
        errors: []
      },
      matching: {
        input: {
          sourceUrl: "https://example.com/new",
          domain: "example.com",
          contentType: "article",
          entitiesCount: 2,
          tagsCount: 0,
          timestamp: "2026-03-03T10:00:00Z"
        },
        positiveMatches: 3,
        truncated: true
      }
    };

    const diagnostics = getMatcherDiagnostics(mockResult);

    expect(diagnostics.related_clips_count).toBe(1);
    expect(diagnostics.related_clips_top_score).toBe(42);
    expect(diagnostics.related_graph_version).toBe("1.0.0");
    expect(diagnostics.related_clips_truncated).toBe(true);
  });
});

describe("getNoMatchDiagnostics", () => {
  test("returns default no-match diagnostics", () => {
    const diagnostics = getNoMatchDiagnostics();

    expect(diagnostics).toEqual(DEFAULT_NO_MATCH_DIAGNOSTICS);
    expect(diagnostics.related_clips_count).toBe(0);
    expect(diagnostics.related_clips_top_score).toBe(0);
    expect(diagnostics.related_clips_truncated).toBe(false);
  });
});
