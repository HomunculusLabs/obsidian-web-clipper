// Content script for page extraction
// Note: Libraries (turndown.js, readability.js) are loaded via manifest.json in order

// Initialize Turndown service
let turndownService = null;

// Initialize on load
if (typeof TurndownService !== 'undefined') {
  turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_'
  });

  // Add custom rules for better markdown conversion
  turndownService.addRule('strikethrough', {
    filter: ['del', 's', 'strike'],
    replacement: (content) => `~~${content}~~`
  });

  // Handle images with alt text
  turndownService.addRule('images', {
    filter: 'img',
    replacement: (content, node) => {
      const alt = node.alt || '';
      const src = node.src || '';
      const title = node.title || '';
      return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
    }
  });
}

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'clip') {
    handleClip(request).then(result => sendResponse(result));
    return true;  // Keep message channel open for async response
  }

  if (request.action === 'getPageInfo') {
    const result = getPageInfo();
    sendResponse(result);
    return true;
  }
});

// Handle clip action
async function handleClip(request) {
  const url = window.location.href;
  const pageType = detectPageType(url);

  let result = {
    url: url,
    title: document.title,
    markdown: '',
    metadata: {
      url: url,
      title: document.title,
      type: 'article'
    }
  };

  try {
    switch (pageType) {
      case 'youtube':
        result = await extractYouTubeContent(result);
        break;
      case 'pdf':
        result = extractPDFContent(result);
        break;
      default:
        result = extractWebPageContent(result);
    }

    return result;
  } catch (error) {
    console.error('Clip error:', error);
    return {
      error: error.message,
      markdown: `# Error: ${error.message}\n\nFailed to clip this page.`
    };
  }
}

// Detect page type from URL
function detectPageType(url) {
  // YouTube
  if (/^https?:\/\/(www\.)?youtube\.com\/watch/.test(url)) {
    return 'youtube';
  }

  // PDF
  if (/^https?:\/\/.*\.pdf(\?|$)/i.test(url) || document.contentType === 'application/pdf') {
    return 'pdf';
  }

  // Default to web page
  return 'web';
}

// Extract web page content using Readability
function extractWebPageContent(result) {
  // Use Readability to extract article content
  const documentClone = document.cloneNode(true);
  const article = new Readability(documentClone, {
    charThreshold: 100
  }).parse();

  if (!article || !article.content) {
    throw new Error('Could not extract article content');
  }

  // Add metadata
  result.metadata.author = article.byline || '';
  result.metadata.publishedDate = article.publishedTime || '';
  result.metadata.description = article.excerpt || '';

  // Convert HTML to markdown
  const markdown = turndownService.turndown(article.content);

  // Build final markdown with title and content
  result.markdown = `# ${article.title || result.title}\n\n${article.excerpt ? `> ${article.excerpt}\n\n` : ''}${markdown}`;

  return result;
}

// Extract YouTube transcript
async function extractYouTubeContent(result) {
  result.metadata.type = 'video';

  // Get video info first
  const videoInfo = getYouTubeVideoInfo();
  result.metadata.channel = videoInfo.channel || '';
  result.metadata.duration = videoInfo.duration || '';
  result.metadata.title = videoInfo.title || result.title;

  // Try to get transcript from ytInitialPlayerResponse
  const transcript = await getYouTubeTranscript();

  if (transcript) {
    // Format transcript as markdown
    result.markdown = formatTranscript(transcript, videoInfo);
  } else {
    // Fallback: just provide video info
    result.markdown = `# ${videoInfo.title || result.title}\n\n**Channel:** ${videoInfo.channel || 'Unknown'}\n**Duration:** ${videoInfo.duration || 'Unknown'}\n\n> Note: Transcript not available. You may need to enable captions on the video.`;
  }

  return result;
}

// Get YouTube transcript from page data
async function getYouTubeTranscript() {
  try {
    // Method 1: Try yt-initial-player-response (most common location)
    let playerResponse = document.querySelector('script#yt-initial-player-response')?.textContent;
    if (playerResponse) {
      const result = await parseTranscriptFromConfig(JSON.parse(playerResponse));
      if (result) return result;
    }

    // Method 2: Try from ytInitialData (newer YouTube structure)
    const ytDataScript = document.querySelector('script[var="ytInitialData"]') ||
                         Array.from(document.querySelectorAll('script'))
                           .find(s => s.textContent.includes('ytInitialData'));

    if (ytDataScript) {
      const match = ytDataScript.textContent.match(/ytInitialData\s*=\s*({.+?});?\s*(?:var|\/\*)/);
      if (match) {
        const ytData = JSON.parse(match[1]);
        // Try to find captions in the newer structure
        const captions = ytData?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap;
        if (captions) {
          const result = await parseTranscriptFromNewStructure(ytData);
          if (result) return result;
        }
      }
    }

    // Method 3: Find ytInitialPlayerResponse in any script
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent;
      if (text.includes('ytInitialPlayerResponse')) {
        const match = text.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (match) {
          const result = await parseTranscriptFromConfig(JSON.parse(match[1]));
          if (result) return result;
        }
      }
    }

    // Method 4: Try to get from yt player config
    const ytConfig = document.querySelector('div#player')?.getAttribute('data-config');
    if (ytConfig) {
      try {
        const config = JSON.parse(ytConfig);
        const result = await parseTranscriptFromConfig(config);
        if (result) return result;
      } catch {}
    }

    return null;
  } catch (error) {
    console.error('Transcript extraction error:', error);
    return null;
  }
}

// Parse transcript from YouTube player config
async function parseTranscriptFromConfig(config) {
  try {
    // Try multiple paths to caption tracks
    let tracks = config?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    // Newer structure path
    if (!tracks) {
      tracks = config?.playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    }

    // Another path for embed player
    if (!tracks) {
      tracks = config?.frameworkUpdates?.entityBatchUpdate?.mutations?.[0]?.payload?.playerCaptionsTracklistRenderer?.captionTracks;
    }

    if (!tracks || tracks.length === 0) {
      return null;
    }

    // Prefer manual captions over auto-generated (better quality)
    // Fall back to auto-generated if no manual captions
    let track = tracks.find(t => t.kind !== 'asr') || tracks[0];
    const baseUrl = track.baseUrl;

    if (!baseUrl) {
      return null;
    }

    // Fetch transcript data
    const response = await fetch(baseUrl + '&fmt=json3');
    const data = await response.json();

    // Parse transcript events
    const events = data.events?.filter(e => e.segs) || [];
    if (events.length > 0) {
      return events;
    }

    return null;
  } catch (error) {
    console.error('Transcript parsing error:', error);
    return null;
  }
}

// Parse transcript from newer YouTube data structure
async function parseTranscriptFromNewStructure(ytData) {
  try {
    // This is a fallback for newer YouTube structures
    // The transcript might be in a different location
    const captions = ytData?.frameworkUpdates?.entityBatchUpdate?.mutations?.[0]?.payload?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captions || captions.length === 0) {
      return null;
    }

    const track = captions[0];
    if (!track.baseUrl) {
      return null;
    }

    const response = await fetch(track.baseUrl + '&fmt=json3');
    const data = await response.json();
    return data.events?.filter(e => e.segs) || null;
  } catch (error) {
    return null;
  }
}

// Get YouTube video info
function getYouTubeVideoInfo() {
  const info = {
    title: document.title.replace(' - YouTube', '') || '',
    channel: document.querySelector('#channel-name a')?.textContent?.trim() || '',
    duration: document.querySelector('span.ytp-time-duration')?.textContent || getDurationFromMeta()
  };

  return info;
}

// Get duration from meta tags
function getDurationFromMeta() {
  const metaTags = document.querySelectorAll('meta');
  for (const tag of metaTags) {
    if (tag.getAttribute('itemprop') === 'duration') {
      return tag.getAttribute('content');
    }
  }
  return '';
}

// Format transcript as markdown
function formatTranscript(transcript, videoInfo) {
  if (!transcript) {
    return `# ${videoInfo.title}\n\nTranscript not available.`;
  }

  let markdown = `# ${videoInfo.title}\n\n`;
  markdown += `**Channel:** ${videoInfo.channel}\n`;
  markdown += `**Duration:** ${videoInfo.duration}\n\n`;
  markdown += `---\n\n## Transcript\n\n`;

  // Format transcript segments
  const segments = [];

  if (Array.isArray(transcript)) {
    transcript.forEach(event => {
      if (event.segs) {
        const text = event.segs.map(seg => seg.utf8).join('').trim();
        if (text) {
          const startTime = formatTimestamp(event.tStartMs / 1000);
          segments.push(`**[${startTime}]** ${text}`);
        }
      }
    });
  }

  markdown += segments.join('\n\n');

  return markdown;
}

// Format timestamp as HH:MM:SS
function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Extract PDF content (basic implementation)
function extractPDFContent(result) {
  result.metadata.type = 'document';

  // For PDFs viewed in browser's PDF viewer
  const textContent = extractPDFText();

  if (textContent) {
    result.markdown = `# ${result.title}\n\n${textContent}`;
  } else {
    result.markdown = `# ${result.title}\n\n> PDF text extraction not available in this viewer.\n> Consider downloading the file and using a PDF extraction tool.`;
  }

  return result;
}

// Extract text from PDF viewer (basic)
function extractPDFText() {
  // Try to get text from PDF.js text layer
  const textLayer = document.querySelector('.textLayer');

  if (textLayer) {
    // PDF.js renders text in span elements
    const spans = textLayer.querySelectorAll('span');
    const lines = [];

    let currentLine = '';
    let lastY = null;

    spans.forEach(span => {
      const transform = span.style.transform;
      const match = transform?.match(/translate\(([^,]+),\s*([^)]+)\)/);

      if (match) {
        const y = parseFloat(match[2]);

        if (lastY !== null && Math.abs(y - lastY) > 12) {
          if (currentLine.trim()) {
            lines.push(currentLine.trim());
          }
          currentLine = '';
        }

        lastY = y;
        currentLine += span.textContent + ' ';
      }
    });

    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    return lines.join('\n\n');
  }

  // Fallback: try body text
  return document.body?.textContent || '';
}

// Get basic page info without full extraction
function getPageInfo() {
  return {
    url: window.location.href,
    title: document.title,
    type: detectPageType(window.location.href)
  };
}
