import { beforeEach, describe, expect, test } from "bun:test";
import { setupChromeMocks, mockChrome } from "./mocks/chrome";
import { addClipHistoryEntry, filterClipHistory, getClipHistory, type ClipHistoryEntry } from "../src/shared/clipHistory";

describe("clip history", () => {
  beforeEach(() => {
    setupChromeMocks();
  });

  function createEntry(index: number, success = true): ClipHistoryEntry {
    return {
      title: `Clip ${index}`,
      url: `https://example.com/${index}`,
      date: new Date(2025, 0, index + 1).toISOString(),
      tags: ["web-clip"],
      folder: "2 - Source Material/Clips",
      success
    };
  }

  test("returns empty history when storage is empty", async () => {
    const history = await getClipHistory();
    expect(history).toEqual([]);
  });

  test("adds new entries to the front", async () => {
    await addClipHistoryEntry(createEntry(1));
    await addClipHistoryEntry(createEntry(2, false));

    const history = await getClipHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.title).toBe("Clip 2");
    expect(history[0]?.success).toBe(false);
    expect(history[1]?.title).toBe("Clip 1");
  });

  test("keeps only last 50 clips", async () => {
    for (let i = 0; i < 55; i += 1) {
      await addClipHistoryEntry(createEntry(i));
    }

    const history = await getClipHistory();
    expect(history).toHaveLength(50);
    expect(history[0]?.title).toBe("Clip 54");
    expect(history[49]?.title).toBe("Clip 5");
  });

  test("filters malformed entries from stored data", async () => {
    mockChrome.storage.local.setValues({
      clipHistory: [
        createEntry(1),
        { title: "bad" },
        { ...createEntry(3), success: "yes" }
      ]
    });

    const history = await getClipHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.title).toBe("Clip 1");
  });

  test("filters history by title, url, and tags", () => {
    const entries: ClipHistoryEntry[] = [
      { ...createEntry(1), tags: ["web-clip", "research"] },
      { ...createEntry(2), title: "Stack Overflow Answer", url: "https://stackoverflow.com/questions/1", tags: ["code"] },
      { ...createEntry(3), title: "YouTube Transcript", url: "https://youtube.com/watch?v=123", tags: ["video"] }
    ];

    expect(filterClipHistory(entries, { query: "stack overflow" })).toHaveLength(1);
    expect(filterClipHistory(entries, { query: "youtube.com" })).toHaveLength(1);
    expect(filterClipHistory(entries, { query: "research" })).toHaveLength(1);
  });

  test("filters history by inclusive date range", () => {
    const entries: ClipHistoryEntry[] = [
      { ...createEntry(1), date: "2025-01-01T10:00:00.000Z" },
      { ...createEntry(2), date: "2025-01-10T15:00:00.000Z" },
      { ...createEntry(3), date: "2025-01-20T09:00:00.000Z" }
    ];

    const filtered = filterClipHistory(entries, {
      startDate: "2025-01-10",
      endDate: "2025-01-20"
    });

    expect(filtered.map((entry) => entry.title)).toEqual(["Clip 2", "Clip 3"]);
  });
});
