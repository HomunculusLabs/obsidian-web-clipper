# Phase 8: UX Polish & New Features (Tasks 103-120)

## Goal
User-facing improvements, quality of life features, and visual polish.

## Key Features

### Reader Mode Preview (Task 103)
- Add "Preview" tab in popup next to clip button
- Render cleaned markdown as HTML using a simple renderer
- Show before clipping so user can verify extraction quality
- Toggle between raw markdown and rendered preview

### Clip History (Tasks 104-106)
- Store in `chrome.storage.local`: `{ clips: ClipHistoryEntry[] }`
- Max 50 entries, FIFO eviction
- Entry: `{ title, url, date, tags, folder, success }`
- Add "History" icon in popup header → opens history panel
- Search by title/URL/tags
- "Re-clip" button fetches URL again with current settings

### Batch Tab Clipping (Tasks 107-108)
- "Clip All Tabs" button in popup footer
- Iterates `chrome.tabs.query({ currentWindow: true })`
- Progress bar: "Clipping 3/12..."
- Skip chrome:// and extension pages
- Tab group awareness: detect groups, clip as collection

### Dark Mode (Task 110)
- CSS custom properties for colors
- `prefers-color-scheme: dark` media query
- Manual toggle in popup header (stored in settings)

### Popup Keyboard Shortcuts (Task 111)
- `Enter` → Clip
- `Tab` → Navigate between fields
- `Escape` → Close popup
- `Ctrl+P` → Toggle preview
- Focus management for accessibility

### Multi-Vault Support (Task 113)
- Settings: array of `{ name: string; cliPath?: string }`
- Popup: vault selector dropdown
- Each vault can have its own default folder/tags

### Image Downloading (Task 119)
- When `imageHandling: "download-api"`:
  1. Find all `![](url)` in markdown
  2. Download each image via fetch
  3. Save to `{vault}/{attachmentsFolder}/{filename}`
  4. Rewrite markdown URLs to relative paths
- Requires Obsidian CLI (Phase 1)

### Popup Redesign (Task 120)
- Collapsible sections: Basic / Advanced / Tags / Template
- Tag chips (click to remove, type to add)
- Template indicator: "Using: Reddit template"
- Save method indicator: "Saving via: CLI"
- Responsive: works in narrow popup and as full tab
