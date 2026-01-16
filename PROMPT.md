You are finishing the Obsidian Web Clipper Chrome extension.

Read @AGENT.md for project context and @fix_plan.md for remaining work.

## Remaining Tasks

### 1. Convert Icons to PNG
The icons/ folder has SVG placeholders. Create proper PNG icons:
- icons/icon16.png (16x16)
- icons/icon48.png (48x48)
- icons/icon128.png (128x128)

Use a simple, recognizable design (scissors, clipboard, or paper clip icon).
You can use canvas in a Node.js script, ImageMagick, or create them programmatically.

### 2. Test Edge Cases
Test the extension on challenging content and add graceful error handling:

**Paywalled sites:**
- Detect when Readability.js returns minimal content
- Show user-friendly message: "This page may be paywalled"
- Offer to clip visible content anyway

**Single Page Apps:**
- Test on React/Vue documentation sites
- Ensure dynamic content is captured
- May need to wait for content to load

**YouTube edge cases:**
- Live streams (no transcript)
- Shorts
- Age-restricted videos
- Unavailable transcripts

**PDF edge cases:**
- Scanned PDFs (image-based, no text)
- Password-protected PDFs
- Large PDFs

### 3. Update fix_plan.md
Mark all remaining items as complete when done.

## Success Criteria
- [ ] PNG icons display correctly in Chrome toolbar and extensions page
- [ ] Paywalled sites show helpful message, don't crash
- [ ] SPAs clip content successfully (or fail gracefully)
- [ ] YouTube handles missing transcripts gracefully
- [ ] PDF handles edge cases with user feedback
- [ ] All @fix_plan.md items marked [x]

When all criteria are met, output: <promise>COMPLETE</promise>
