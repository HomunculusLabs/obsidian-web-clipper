# Phase 5: Smart Tag & Name Suggestions (Tasks 56-68)

## Goal
Automatically suggest tags and note titles based on page content, domain, and metadata. Reduce manual tagging effort.

## Key Files to Create
- `src/shared/tagSuggestion.ts` — Tag suggestion engine (Tasks 56-60)
- `src/shared/titleSuggestion.ts` — Title suggestion engine (Tasks 62-64)
- `src/shared/stopwords.ts` — English stopword list for keyword extraction (Task 58)
- `src/shared/domainTags.ts` — Domain → tag mapping (Task 57)

## Modified Files
- `src/popup/popup.ts` — Show suggestions UI (Tasks 61, 67)
- `src/popup/ui.ts` — Tag chip components, title radio options (Tasks 61, 67)
- `src/popup/popup.css` — Styles for suggestion chips
- `src/shared/settings.ts` — Tag rules, title templates, tag history settings (Tasks 64-66)

## Tag Suggestion Pipeline
```
Page loaded
  ├── 1. Domain-based tags (fast, always runs)
  │     github.com → "github", "code"
  │     youtube.com → "youtube", "video"
  │     arxiv.org → "research", "paper"
  │
  ├── 2. Meta tag mining (fast)
  │     <meta name="keywords"> → split, clean, suggest
  │     JSON-LD keywords → suggest
  │     article:tag → suggest
  │
  ├── 3. Content keyword extraction (slightly slower)
  │     TF-IDF-like: word frequency vs stopwords
  │     Top 5 keywords → suggest as tags
  │
  ├── 4. Category detection (simple classifier)
  │     Code indicators: "function", "import", "```"
  │     Research indicators: "abstract", "methodology"
  │     News indicators: "reported", "according to"
  │
  └── 5. User rules engine (from settings)
        domain contains "github.com" → add "code"
        title contains "tutorial" → add "learning"
```

## Title Suggestion Pipeline
```
Page title extracted
  ├── 1. Clean: remove site suffix (" - Medium", " | HN")
  ├── 2. Decode HTML entities
  ├── 3. Apply template: "{date} - {title}", "{domain}/{title}"
  └── 4. Generate 2-3 variants for user to pick
```

## Tag History
- Store used tags in `chrome.storage.local` (not sync, can be large)
- Track frequency: `{ tag: string; count: number; lastUsed: string }`
- Autocomplete from history when typing in tag input
- Suggest frequent tags that match current content
