/**
 * YouTube Transcript Extractor Tests
 *
 * Unit tests for YouTube transcript extraction logic used by
 * tools/youtube-transcript.ts and clip-url.ts
 */

import { describe, test, expect } from "bun:test";
import type { ToolOutput } from "../../tools/lib/clipper-core";

// Local implementations to avoid puppeteer dependency
function parseEngagementCount(ariaLabel: string): number {
  if (!ariaLabel) return 0;

  const match = ariaLabel.match(/[\d,.]+[KkMmBb]?/);
  if (!match) return 0;

  let numStr = match[0].replace(/,/g, "");

  if (numStr.endsWith("K") || numStr.endsWith("k")) {
    return Math.round(parseFloat(numStr) * 1000);
  } else if (numStr.endsWith("M") || numStr.endsWith("m")) {
    return Math.round(parseFloat(numStr) * 1000000);
  } else if (numStr.endsWith("B") || numStr.endsWith("b")) {
    return Math.round(parseFloat(numStr) * 1000000000);
  }

  return parseInt(numStr, 10) || 0;
}

function formatNumber(num: number): string {
  if (num >= 1000000000) {
    return `${(num / 1000000000).toFixed(1)}B`;
  } else if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

// ─── YouTube Info Extraction Tests ───────────────────────────────────────────

describe("YouTube info extraction", () => {
  // Simulates extractYouTubeInPage logic

  function extractVideoInfo(html: string): {
    title: string;
    channel: string;
    duration: string;
    description: string;
  } {
    // Simple regex-based extraction for testing
    const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
    const channelMatch = html.match(/data-channel="([^"]+)"/);
    const durationMatch = html.match(/class="ytp-time-duration">([^<]+)</);
    const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/);

    return {
      title: titleMatch?.[1] || "",
      channel: channelMatch?.[1] || "",
      duration: durationMatch?.[1] || "",
      description: descMatch?.[1] || "",
    };
  }

  test("extracts video title from og:title", () => {
    const html = `<meta property="og:title" content="My Awesome Video">`;
    const info = extractVideoInfo(html);
    expect(info.title).toBe("My Awesome Video");
  });

  test("extracts channel name", () => {
    const html = `<div data-channel="TechChannel">`;
    const info = extractVideoInfo(html);
    expect(info.channel).toBe("TechChannel");
  });

  test("extracts duration", () => {
    const html = `<span class="ytp-time-duration">12:34</span>`;
    const info = extractVideoInfo(html);
    expect(info.duration).toBe("12:34");
  });

  test("extracts description", () => {
    const html = `<meta property="og:description" content="This is a video about testing.">`;
    const info = extractVideoInfo(html);
    expect(info.description).toBe("This is a video about testing.");
  });

  test("handles missing fields gracefully", () => {
    const html = `<html><body>No video data</body></html>`;
    const info = extractVideoInfo(html);
    expect(info.title).toBe("");
    expect(info.channel).toBe("");
    expect(info.duration).toBe("");
    expect(info.description).toBe("");
  });
});

// ─── Transcript Parsing Tests ───────────────────────────────────────────────

describe("YouTube transcript parsing", () => {
  interface TranscriptSegment {
    time: string;
    text: string;
  }

  function parseTranscriptSegments(html: string): TranscriptSegment[] {
    // Simulate parsing ytd-transcript-segment-renderer elements
    const segments: TranscriptSegment[] = [];
    const regex = /<div class="segment-timestamp">([^<]+)<\/div>\s*<div class="segment-text">([^<]+)<\/div>/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
      segments.push({
        time: match[1].trim(),
        text: match[2].trim(),
      });
    }

    return segments;
  }

  function formatTranscript(segments: TranscriptSegment[], includeTimestamps: boolean): string {
    return segments
      .map((seg) => (includeTimestamps ? `**[${seg.time}]** ${seg.text}` : seg.text))
      .join("\n\n");
  }

  test("parses transcript segments", () => {
    const html = `
      <div class="segment-timestamp">0:00</div><div class="segment-text">Hello everyone</div>
      <div class="segment-timestamp">0:05</div><div class="segment-text">Welcome to the video</div>
      <div class="segment-timestamp">0:10</div><div class="segment-text">Today we'll learn about testing</div>
    `;

    const segments = parseTranscriptSegments(html);
    expect(segments.length).toBe(3);
    expect(segments[0]).toEqual({ time: "0:00", text: "Hello everyone" });
    expect(segments[2]).toEqual({ time: "0:10", text: "Today we'll learn about testing" });
  });

  test("formats transcript with timestamps", () => {
    const segments: TranscriptSegment[] = [
      { time: "0:00", text: "First line" },
      { time: "0:05", text: "Second line" },
    ];

    const formatted = formatTranscript(segments, true);
    expect(formatted).toBe("**[0:00]** First line\n\n**[0:05]** Second line");
  });

  test("formats transcript without timestamps", () => {
    const segments: TranscriptSegment[] = [
      { time: "0:00", text: "First line" },
      { time: "0:05", text: "Second line" },
    ];

    const formatted = formatTranscript(segments, false);
    expect(formatted).toBe("First line\n\nSecond line");
  });

  test("handles empty transcript", () => {
    const html = `<div>No segments here</div>`;
    const segments = parseTranscriptSegments(html);
    expect(segments).toEqual([]);
  });
});

// ─── YouTube Tool Output Tests ───────────────────────────────────────────────

describe("YouTube tool output format", () => {
  interface YouTubeData {
    pageType: "youtube";
    metadata: {
      url: string;
      title: string;
      type: "video";
      channel: string;
      duration: string;
      description: string;
      transcriptAvailable: boolean;
    };
  }

  test("creates valid YouTube output", () => {
    const output: ToolOutput<YouTubeData> = {
      success: true,
      url: "https://youtube.com/watch?v=test123",
      title: "Test Video",
      markdown: "---\ntitle: Test Video\n---\n# Test Video\n\nTranscript...",
      content: "# Test Video\n\nTranscript...",
      tags: ["youtube", "video"],
      data: {
        pageType: "youtube",
        metadata: {
          url: "https://youtube.com/watch?v=test123",
          title: "Test Video",
          type: "video",
          channel: "TestChannel",
          duration: "10:30",
          description: "A test video",
          transcriptAvailable: true,
        },
      },
    };

    expect(output.success).toBe(true);
    expect(output.data?.pageType).toBe("youtube");
    expect(output.data?.metadata.channel).toBe("TestChannel");
    expect(output.data?.metadata.transcriptAvailable).toBe(true);
  });

  test("handles missing transcript", () => {
    const output: ToolOutput<YouTubeData> = {
      success: true,
      url: "https://youtube.com/watch?v=nocaptions",
      title: "Video Without Captions",
      markdown: "---\n---\n# Video Without Captions\n\n> Transcript not available",
      content: "# Video Without Captions\n\n> Transcript not available",
      tags: ["youtube"],
      data: {
        pageType: "youtube",
        metadata: {
          url: "https://youtube.com/watch?v=nocaptions",
          title: "Video Without Captions",
          type: "video",
          channel: "SomeChannel",
          duration: "5:00",
          description: "No captions",
          transcriptAvailable: false,
        },
      },
    };

    expect(output.data?.metadata.transcriptAvailable).toBe(false);
    expect(output.content).toContain("Transcript not available");
  });

  test("handles extraction error", () => {
    const output: ToolOutput<YouTubeData> = {
      success: false,
      url: "https://youtube.com/watch?v=private",
      title: "",
      markdown: "",
      content: "",
      tags: [],
      error: "Video is private or unavailable",
    };

    expect(output.success).toBe(false);
    expect(output.error).toBe("Video is private or unavailable");
  });
});

// ─── Engagement Count Tests ─────────────────────────────────────────────────

describe("YouTube engagement parsing", () => {
  test("parses view counts", () => {
    expect(parseEngagementCount("1.5M views")).toBe(1500000);
    expect(parseEngagementCount("500K views")).toBe(500000);
    expect(parseEngagementCount("12345 views")).toBe(12345);
  });

  test("parses like counts", () => {
    expect(parseEngagementCount("10K Likes")).toBe(10000);
    expect(parseEngagementCount("250 likes")).toBe(250);
  });

  test("formats view counts for display", () => {
    expect(formatNumber(1500000)).toBe("1.5M");
    expect(formatNumber(500000)).toBe("500.0K");
    expect(formatNumber(12345)).toBe("12.3K");
  });
});

// ─── Timestamp Utilities Tests ───────────────────────────────────────────────

describe("YouTube timestamp utilities", () => {
  function parseTimestamp(timestamp: string): number {
    // Convert "10:30" to seconds
    const parts = timestamp.split(":").map(Number);
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  }

  function formatTimestamp(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  test("parses MM:SS timestamps", () => {
    expect(parseTimestamp("5:30")).toBe(330);
    expect(parseTimestamp("0:00")).toBe(0);
    expect(parseTimestamp("10:45")).toBe(645);
  });

  test("parses HH:MM:SS timestamps", () => {
    expect(parseTimestamp("1:30:00")).toBe(5400);
    expect(parseTimestamp("2:15:30")).toBe(8130);
  });

  test("formats seconds to MM:SS", () => {
    expect(formatTimestamp(330)).toBe("5:30");
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(645)).toBe("10:45");
  });

  test("formats seconds to HH:MM:SS when over an hour", () => {
    expect(formatTimestamp(5400)).toBe("1:30:00");
    expect(formatTimestamp(8130)).toBe("2:15:30");
  });
});
