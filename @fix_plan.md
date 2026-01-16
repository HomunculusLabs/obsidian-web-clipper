# Ralph Fix Plan - Obsidian Web Clipper

## High Priority (Core Functionality)
- [x] Create manifest.json for Chrome extension (manifest v3)
- [x] Set up basic extension structure (popup, background, content scripts)
- [x] Bundle Turndown.js for HTML-to-markdown conversion
- [x] Bundle Readability.js for article extraction
- [x] Implement web page clipping with clean markdown output
- [x] Add frontmatter generation with metadata

## Medium Priority (Additional Sources)
- [x] Implement YouTube video detection
- [x] Add YouTube transcript fetching (timedtext API)
- [x] Format transcript as markdown with optional timestamps
- [x] Implement PDF detection in browser
- [x] Add PDF text extraction
- [x] Create popup UI with page type detection

## Medium Priority (Save & Settings)
- [x] Implement Obsidian URI scheme integration
- [x] Add clipboard fallback for saving
- [x] Create options page for configuration
- [x] Implement settings storage (vault name, default folder, tags)
- [x] Add keyboard shortcut support

## Low Priority (Polish)
- [x] Create extension icons (16, 48, 128px) - Created with ImageMagick
- [x] Add loading states to popup
- [x] Improve error handling and user feedback
- [x] Add folder selection in popup
- [x] Test edge cases (paywalled sites, SPAs, etc.)
  - [x] Paywall detection with visible content fallback
  - [x] SPA content capture with dynamic wait times
  - [x] YouTube edge cases (live streams, shorts, age-restricted, unavailable)
  - [x] PDF edge cases (password-protected, scanned/image-based, large PDFs)

## Completed
- [x] Project initialization
- [x] Ralph project setup
- [x] Specs written
- [x] Chrome extension implementation (all core features)
- [x] Edge case handling and polish

## Notes
- Used manifest v3 (service workers, not background pages)
- PNG icons created using ImageMagick with document/clip design
- Paywall detection uses content length analysis and keyword matching
- SPA support includes wait times for dynamic content rendering
- YouTube handles: live streams, shorts, age-restricted videos, unavailable videos
- PDF handles: password-protected, scanned/image-based, large PDFs with truncation
