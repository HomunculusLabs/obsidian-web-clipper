import type { ClipResult, YouTubeVideoType } from "../../shared/types";

interface YouTubeVideoInfo {
  title: string;
  channel: string;
  duration: string;
}

interface TranscriptSegment {
  utf8: string;
}

export interface TranscriptEvent {
  tStartMs: number;
  segs?: TranscriptSegment[];
}

interface YouTubeVideoTypeCheck {
  type: YouTubeVideoType;
  supported: boolean;
  message?: string;
}

// Check YouTube video type and restrictions
function getYouTubeVideoType(): YouTubeVideoTypeCheck {
  const url = window.location.href;

  // Check for Shorts
  if (/^https?:\/\/(www\.)?youtube\.com\/shorts/.test(url)) {
    return { type: "shorts", supported: true };
  }

  // Check for live stream
  const isLive =
    document.querySelector(".ytp-live-badge") !== null ||
    document.querySelector('[data-live="true"]') !== null ||
    (document.body.textContent || "").includes("Watching live");

  if (isLive) {
    return {
      type: "live",
      supported: false,
      message: "Live streams do not have transcripts available."
    };
  }

  // Check for age-restricted
  const isAgeRestricted =
    (document.body.textContent || "").includes("sign in to confirm your age") ||
    document.querySelector(".ytp-age-gate") !== null ||
    (document.querySelector("#account-container")?.textContent || "").includes(
      "age"
    );

  if (isAgeRestricted) {
    return {
      type: "age-restricted",
      supported: false,
      message:
        "This video is age-restricted and the transcript cannot be accessed."
    };
  }

  // Check for unavailable video
  const isUnavailable =
    (document.body.textContent || "").includes("This video is unavailable") ||
    (document.querySelector(".yt-alert-message")?.textContent || "").includes(
      "unavailable"
    );

  if (isUnavailable) {
    return {
      type: "unavailable",
      supported: false,
      message: "This video is unavailable or private."
    };
  }

  return { type: "normal", supported: true };
}

// Get YouTube video info
function getYouTubeVideoInfo(): YouTubeVideoInfo {
  const title = (document.title || "").replace(" - YouTube", "").trim();

  const channel =
    document.querySelector<HTMLAnchorElement>("#channel-name a")?.textContent?.trim() ||
    "";

  const duration =
    document.querySelector<HTMLSpanElement>("span.ytp-time-duration")?.textContent ||
    getDurationFromMeta() ||
    "";

  return {
    title: title || "",
    channel,
    duration
  };
}

// Get duration from meta tags
function getDurationFromMeta(): string {
  const metaTags = document.querySelectorAll("meta");
  for (const tag of metaTags) {
    if (tag.getAttribute("itemprop") === "duration") {
      return tag.getAttribute("content") || "";
    }
  }
  return "";
}

// Extract YouTube transcript
export async function extractYouTubeContent(
  result: ClipResult,
  includeTimestamps: boolean
): Promise<ClipResult> {
  result.metadata.type = "video";

  // Check video type and restrictions first
  const videoType = getYouTubeVideoType();

  // Get video info first
  const videoInfo = getYouTubeVideoInfo();

  result.metadata.channel = videoInfo.channel || "";
  result.metadata.duration = videoInfo.duration || "";
  result.metadata.title = videoInfo.title || result.title;
  result.metadata.videoType = videoType.type;

  // Handle unsupported video types
  if (!videoType.supported) {
    result.markdown =
      `# ${videoInfo.title || result.title}\n\n` +
      `**Channel:** ${videoInfo.channel || "Unknown"}\n` +
      `**Duration:** ${videoInfo.duration || "Unknown"}\n` +
      `**Type:** ${videoType.type}\n\n` +
      `> ⚠️ **Note:** ${videoType.message}\n\n` +
      `You can still save the video metadata for reference.`;
    return result;
  }

  const transcript = await getYouTubeTranscript();

  if (transcript) {
    result.markdown = formatTranscript(transcript, videoInfo, includeTimestamps);
  } else {
    result.markdown =
      `# ${videoInfo.title || result.title}\n\n` +
      `**Channel:** ${videoInfo.channel || "Unknown"}\n` +
      `**Duration:** ${videoInfo.duration || "Unknown"}\n\n` +
      `> ⚠️ **Transcript not available.** This video may not have captions enabled, or they may be disabled by the uploader.\n\n` +
      `You can still save the video metadata for reference.`;
  }

  return result;
}

// Get YouTube transcript from page data
async function getYouTubeTranscript(): Promise<TranscriptEvent[] | null> {
  try {
    // Method 1: Try yt-initial-player-response (most common location)
    const playerResponseText =
      document.querySelector("script#yt-initial-player-response")?.textContent ||
      null;

    if (playerResponseText) {
      const parsed = safeJsonParse(playerResponseText);
      if (parsed) {
        const result = await parseTranscriptFromConfig(parsed);
        if (result) return result;
      }
    }

    // Method 2: Try from ytInitialData (newer YouTube structure)
    const allScripts = Array.from(document.querySelectorAll("script"));
    const ytDataScript = allScripts.find((s) =>
      (s.textContent || "").includes("ytInitialData")
    );

    if (ytDataScript && ytDataScript.textContent) {
      const match = ytDataScript.textContent.match(
        /ytInitialData\s*=\s*([\s\S]+?);\s*(?:var|\/\*|window\.|const|let)/m
      );

      if (match) {
        const ytData = safeJsonParse(match[1]);
        if (ytData) {
          const captions =
            ytData?.playerOverlays?.playerOverlayRenderer
              ?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer?.playerBar
              ?.multiMarkersPlayerBarRenderer?.markersMap;

          if (captions) {
            const result = await parseTranscriptFromNewStructure(ytData);
            if (result) return result;
          }
        }
      }
    }

    // Method 3: Find ytInitialPlayerResponse in any script
    for (const script of allScripts) {
      const text = script.textContent || "";
      if (!text.includes("ytInitialPlayerResponse")) continue;

      const match = text.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]+?});/m);
      if (match) {
        const parsed = safeJsonParse(match[1]);
        if (parsed) {
          const result = await parseTranscriptFromConfig(parsed);
          if (result) return result;
        }
      }
    }

    // Method 4: Try to get from yt player config
    const ytConfigText =
      document.querySelector("div#player")?.getAttribute("data-config") || null;

    if (ytConfigText) {
      const parsed = safeJsonParse(ytConfigText);
      if (parsed) {
        const result = await parseTranscriptFromConfig(parsed);
        if (result) return result;
      }
    }

    return null;
  } catch (error) {
    console.error("Transcript extraction error:", error);
    return null;
  }
}

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Parse transcript from YouTube player config
async function parseTranscriptFromConfig(
  config: any
): Promise<TranscriptEvent[] | null> {
  try {
    let tracks =
      config?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    // Newer structure path
    if (!tracks) {
      tracks =
        config?.playerResponse?.captions?.playerCaptionsTracklistRenderer
          ?.captionTracks;
    }

    // Another path for embed player
    if (!tracks) {
      tracks =
        config?.frameworkUpdates?.entityBatchUpdate?.mutations?.[0]?.payload
          ?.playerCaptionsTracklistRenderer?.captionTracks;
    }

    if (!Array.isArray(tracks) || tracks.length === 0) {
      return null;
    }

    // Prefer manual captions over auto-generated (better quality)
    const preferred =
      tracks.find((t: any) => t && t.kind !== "asr") || tracks[0];

    const baseUrl: string | undefined = preferred?.baseUrl;
    if (!baseUrl) return null;

    const response = await fetch(`${baseUrl}&fmt=json3`);
    const data = (await response.json()) as { events?: TranscriptEvent[] };

    const events = Array.isArray(data.events)
      ? data.events.filter((e) => Array.isArray(e.segs))
      : [];

    return events.length > 0 ? events : null;
  } catch (error) {
    console.error("Transcript parsing error:", error);
    return null;
  }
}

// Parse transcript from newer YouTube data structure
async function parseTranscriptFromNewStructure(
  ytData: any
): Promise<TranscriptEvent[] | null> {
  try {
    const captions =
      ytData?.frameworkUpdates?.entityBatchUpdate?.mutations?.[0]?.payload
        ?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!Array.isArray(captions) || captions.length === 0) {
      return null;
    }

    const track = captions[0];
    const baseUrl: string | undefined = track?.baseUrl;
    if (!baseUrl) return null;

    const response = await fetch(`${baseUrl}&fmt=json3`);
    const data = (await response.json()) as { events?: TranscriptEvent[] };

    const events = Array.isArray(data.events)
      ? data.events.filter((e) => Array.isArray(e.segs))
      : [];

    return events.length > 0 ? events : null;
  } catch {
    return null;
  }
}

// Format transcript as markdown
function formatTranscript(
  transcript: TranscriptEvent[],
  videoInfo: YouTubeVideoInfo,
  includeTimestamps: boolean
): string {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return `# ${videoInfo.title}\n\nTranscript not available.`;
  }

  let markdown = `# ${videoInfo.title}\n\n`;
  markdown += `**Channel:** ${videoInfo.channel}\n`;
  markdown += `**Duration:** ${videoInfo.duration}\n\n`;
  markdown += `---\n\n## Transcript\n\n`;

  const segments: string[] = [];

  for (const event of transcript) {
    if (!event || !Array.isArray(event.segs)) continue;

    const text = event.segs.map((seg) => seg.utf8).join("").trim();
    if (!text) continue;

    if (includeTimestamps && typeof event.tStartMs === "number") {
      const startTime = formatTimestamp(event.tStartMs / 1000);
      segments.push(`**[${startTime}]** ${text}`);
    } else {
      segments.push(text);
    }
  }

  markdown += segments.join("\n\n");
  return markdown;
}

// Format timestamp as HH:MM:SS
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}