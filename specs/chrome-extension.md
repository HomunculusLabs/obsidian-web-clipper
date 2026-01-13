# Obsidian Web Clipper - Chrome Extension Spec

## Overview

A Chrome extension that clips web pages, PDFs, and YouTube videos to clean markdown for Obsidian.

## Target User

Someone who uses Obsidian for knowledge management and wants to quickly save web content as source material to `2 - Source Material/` folder.

## Core Features

### 1. Web Page Clipping
- Click extension icon or keyboard shortcut (Ctrl+Shift+O)
- Extract main content using Readability.js (skip nav/ads/footers)
- Convert HTML to markdown using Turndown.js
- Preserve:
  - Headings hierarchy
  - Links (markdown format)
  - Images (as markdown image links)
  - Code blocks
  - Lists (ordered/unordered)
  - Blockquotes
  - Tables
- Add frontmatter:
  ```yaml
  ---
  source: [URL]
  title: [Page title]
  author: [If detectable]
  date_clipped: [Timestamp]
  tags: [web-clip]
  type: article
  ---
  ```

### 2. PDF Extraction
- Detect PDF pages in browser
- Extract text content via PDF.js or text layer
- Preserve structure where possible
- Frontmatter with source PDF URL/filename

### 3. YouTube Transcript
- Detect YouTube video pages
- Fetch transcript via timedtext API or ytInitialPlayerResponse
- Format options:
  - With timestamps as headers
  - Clean flowing text without timestamps
- Include video metadata:
  ```yaml
  ---
  source: [YouTube URL]
  title: [Video title]
  channel: [Channel name]
  duration: [Video length]
  date_clipped: [Timestamp]
  tags: [youtube, transcript]
  type: video
  ---
  ```

### 4. Save Methods
- **Primary**: Obsidian URI scheme
  - `obsidian://new?vault=Main%20Vault&file=2%20-%20Source%20Material/Clips/[filename]&content=[encoded-markdown]`
- **Fallback**: Copy to clipboard
- **Alternative**: Download as .md file

## Technical Requirements

### Extension Structure
```
obsidian-web-clipper/
├── manifest.json          # Chrome extension manifest v3
├── background.js          # Service worker
├── content.js             # Content script for page extraction
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
├── lib/
│   ├── turndown.min.js    # HTML to markdown
│   ├── readability.js     # Article extraction
│   └── pdf.min.js         # PDF extraction (optional)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Manifest v3 Requirements
- Service workers (not background pages)
- Permissions:
  - `activeTab`
  - `storage`
  - `clipboardWrite`
- Host permissions for YouTube API if needed

### Dependencies
- Turndown.js - https://github.com/mixmark-io/turndown
- Readability.js - https://github.com/mozilla/readability
- PDF.js (optional) - https://github.com/nickmccurdy/pdf.js-dist

## UI Design

### Popup
- Shows detected page type icon (Web/PDF/YouTube)
- Title preview (editable)
- Save location dropdown (configured folders)
- Tags input
- "Clip to Obsidian" button
- Settings gear icon

### Options Page
- Vault name configuration
- Default save folder path
- Default tags
- Format preferences (timestamps for YouTube)
- Keyboard shortcut info

## Success Criteria

- [ ] Extension loads in Chrome without errors
- [ ] Web page clipping produces clean markdown
- [ ] YouTube transcript extraction works
- [ ] PDF text extraction works
- [ ] Settings persist across sessions
- [ ] Popup UI responds to page type
- [ ] Obsidian URI integration works
- [ ] Frontmatter is properly formatted YAML

## Out of Scope (v1)

- Image downloading/embedding
- Highlighting/annotations
- Multiple vault support
- Browser sync
- Firefox/Safari ports
