# Phase 2: Selection Clipping (Tasks 13-22)

## Goal
Allow users to clip only their text selection instead of the full page. Currently the extension always clips the entire article via Readability.

## Key Files to Create/Modify

### New Files
- `src/content/selection.ts` — Selection capture utility (Task 13)

### Modified Files
- `src/content/extractors/web.ts` — Accept `selectionOnly` flag, bypass Readability when true (Task 14)
- `src/shared/messages.ts` — Already has `selectionOnly` in TabRequest, verify it flows correctly (Task 15)
- `src/content/clipper.ts` — Forward `selectionOnly` to web extractor (Task 15)
- `src/popup/popup.ts` — Detect selection, show toggle (Task 16)
- `src/popup/ui.ts` — Selection indicator badge UI (Task 16)
- `src/shared/markdown.ts` — Add `clip_mode` to frontmatter (Task 17)
- `src/background/contextMenus.ts` — Pass settings with selection clip (Task 18)
- `src/manifest.json` — Add `clip-selection` command (Task 19)
- `src/background/background.ts` — Handle new keyboard shortcut (Task 19)
- `src/content/chatgpt/injector.ts` — Selection within response (Task 20)

## Architecture Notes
- `window.getSelection()` returns a Selection object with potentially multiple Ranges
- Need to capture the HTML (not just text) to preserve formatting
- Use `Range.cloneContents()` → serialize to HTML → Turndown → markdown
- Selection can span across DOM elements, need to handle partial selections gracefully

## Edge Cases
- Selection across multiple paragraphs
- Selection including tables, code blocks, images
- Selection in shadow DOM (some SPAs)
- No selection when user clicks "Clip Selection" → fall back to full page
- Multi-range selections (Ctrl+click on Firefox, less common on Chrome)
