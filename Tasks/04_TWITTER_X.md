# Phase 4: Twitter/X Thread Clipping (Tasks 43-55)

## Goal
Extract full Twitter/X threads as clean markdown. Twitter's SPA makes this tricky — DOM-based extraction in a content script.

## Key Files to Create
- `src/content/extractors/twitter.ts` — Main extractor (Tasks 44-51)
- `src/content/templates/twitter.ts` — Template integration (Task 55)
- `tools/twitter-clipper.ts` — Headless Puppeteer clipper (Task 53)

## Modified Files
- `src/shared/types.ts` — Add `"twitter"` to PageType union (Task 43)
- `src/shared/pageType.ts` — Detection for twitter.com, x.com (Task 43)
- `src/content/clipper.ts` — Add twitter case to switch (Task 44)
- `src/popup/ui.ts` — Twitter icon/label (Task 52)
- `src/shared/types.ts` — Twitter-specific metadata fields (Task 49, 51)

## Twitter DOM Structure (as of 2025)
```
article[data-testid="tweet"]
  ├── div[data-testid="User-Name"]     → author name + handle
  ├── div[data-testid="tweetText"]     → tweet text
  ├── div[data-testid="tweetPhoto"]    → images
  ├── div[data-testid="videoPlayer"]   → video
  ├── time[datetime]                    → timestamp
  └── div[role="group"]                → engagement stats (likes, retweets, etc.)
```

## Thread Detection Strategy
1. Check if URL is a single tweet: `x.com/{user}/status/{id}`
2. Find the "main" tweet (the one matching the URL)
3. Look for a thread indicator: consecutive tweets by the same author
4. Walk DOM upward/downward to collect all tweets in the thread
5. Handle "Show more replies" / "Show this thread" lazy loading

## Fallback Strategy
- If DOM extraction fails (auth wall, rate limit):
  1. Try nitter.net mirror
  2. Try Twitter embed oEmbed API
  3. Return metadata-only result with warning

## Markdown Format
```markdown
# Thread by @handle

**@handle** · Jan 15, 2025

First tweet text here.

---

**@handle** · Jan 15, 2025

Second tweet in thread.

![](image-url.jpg)

---

**@handle** · Jan 15, 2025

Final tweet.

---

*Thread stats: 3 tweets · 1.2K likes · 340 retweets*
```
