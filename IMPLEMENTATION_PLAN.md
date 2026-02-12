# Obsidian Web Clipper - Implementation Plan

> 100+ tasks organized into phases. Each task is self-contained and can be implemented in one iteration.
> Priority: Ship fast, MVP quality, iterate later.

---

## Phase 1: Obsidian CLI Integration (Tasks 1-12)

The new Obsidian CLI (`obsidian-cli`) enables direct file creation, replacing the URI scheme hack.

- [x] **Task 1**: Research Obsidian CLI — Read `obsidian --help`, document available commands for creating/writing files, determine if it supports vault selection, file creation with content from stdin/args. Write findings to `specs/obsidian-cli-research.md`.
- [x] **Task 2**: Create `src/shared/obsidianCli.ts` — Define types for CLI integration: `ObsidianCliConfig { cliPath: string; vault: string; enabled: boolean }`, `SaveMethod = "cli" | "uri" | "clipboard"`. Add to Settings interface.
- [x] **Task 3**: Implement CLI save backend — Create `src/shared/obsidianCliSave.ts` with `saveViaCli(config, filePath, content): Promise<SaveResult>` that spawns the obsidian CLI process to create a note. Handle errors gracefully.
- [x] **Task 4**: Add CLI settings to options page — Add "Obsidian CLI" section to options: enable/disable toggle, CLI path input (with browse), test connection button. Store in settings.
- [x] **Task 5**: Update save pipeline — Modify `src/popup/save.ts` to check `settings.saveMethod` and route to CLI save, URI save, or clipboard. Add automatic fallback chain: CLI → URI → clipboard.
- [x] **Task 6**: Background handler for CLI save — Add `saveToCli` action to `RuntimeRequest` union in `messages.ts`. Add handler in `src/background/handlers/saveToCli.ts` since content scripts can't spawn processes.
- [x] **Task 7**: CLI save for ChatGPT injector — Update `src/content/chatgpt/injector.ts` to use the new save pipeline via background messages instead of directly building URIs.
- [x] **Task 8**: CLI tool integration — Update `tools/chatgpt-clipper.ts` to support `--cli` flag that uses obsidian CLI directly instead of URI scheme or file writes.
- [x] **Task 9**: Create `tools/clip-url.ts` — New headless CLI tool: `bun run tools/clip-url.ts <url>` that clips any URL to Obsidian via CLI. Supports `--json`, `--stdout`, `--cli`, `--vault`, `--folder` flags.
- [x] **Task 10**: Create `tools/clip-stdin.ts` — CLI tool that reads markdown from stdin and saves to Obsidian: `echo "# Note" | bun run tools/clip-stdin.ts --title "My Note"`. For piping from other tools.
- [x] **Task 11**: CLI auto-detection — On extension install/settings load, try to detect obsidian CLI in PATH (`which obsidian` / common install locations). Auto-populate cliPath if found.
- [x] **Task 12**: CLI integration tests — Create `tests/cli-save.test.ts` with mock tests for the CLI save pipeline. Test fallback chain, error handling, path sanitization.

---

## Phase 2: Selection Clipping (Tasks 13-22)

Clip only the user's text selection instead of the full page.

- [x] **Task 13**: Selection detection utility — Create `src/content/selection.ts` with `getSelection(): { html: string; text: string; hasSelection: boolean }` that captures the current DOM selection as both HTML and plain text.
- [x] **Task 14**: Selection-aware web extractor — Modify `src/content/extractors/web.ts` to accept `selectionOnly?: boolean` option. When true, extract only the selection HTML and convert to markdown instead of using Readability.
- [x] **Task 15**: Wire selection through message pipeline — Update `TabRequest` clip action to pass `selectionOnly` flag. Update `clipper.ts` to forward to extractor. Already partially done in context menu.
- [x] **Task 16**: Popup selection indicator — When popup opens, detect if user has text selected on the page. Show a "Selection detected" badge and toggle: "Clip Selection" vs "Clip Full Page".
- [x] **Task 17**: Selection context in frontmatter — When clipping selection, add `clip_mode: selection` and `selection_context: "[surrounding paragraph]"` to frontmatter for context.
- [x] **Task 18**: Context menu selection clip — Update `src/background/contextMenus.ts` to properly pass selection text through to the content script. Currently sends `selectionOnly` but doesn't carry the settings.
- [x] **Task 19**: Keyboard shortcut for selection clip — Add second command `clip-selection` with shortcut `Ctrl+Shift+S` / `Cmd+Shift+S` that clips selection directly without opening popup.
- [x] **Task 20**: Selection clipping for ChatGPT — Update ChatGPT injector to allow selecting specific text within a response and clipping just that portion.
- [x] **Task 21**: Multi-selection support — Handle cases where user has multiple ranges selected (e.g., Ctrl+click). Combine them with `---` separators.
- [x] **Task 22**: Selection clip tests — Test selection extraction with various HTML structures: tables, code blocks, nested lists, across paragraph boundaries.

---

## Phase 3: Site-Specific Templates (Tasks 23-42)

Custom extraction rules per domain for optimal clipping.

- [x] **Task 23**: Template system types — Create `src/shared/templates.ts` with `SiteTemplate { domain: string; name: string; selectors: { title?: string; content?: string; author?: string; date?: string; tags?: string }; removeSelectors?: string[]; frontmatterExtras?: Record<string, string>; enabled: boolean }`.
- [x] **Task 24**: Template registry — Create `src/content/templates/registry.ts` with `getTemplateForUrl(url: string): SiteTemplate | null` that matches URLs against registered templates. Support glob patterns.
- [x] **Task 25**: Template-aware web extraction — Modify `extractWebPageContent()` to check for matching template first. If found, use template selectors instead of Readability for extraction.
- [x] **Task 26**: Reddit template — `src/content/templates/reddit.ts`: Extract post title, body, author, subreddit, score, comments. Handle old.reddit.com and new reddit. Add subreddit as tag.
- [x] **Task 27**: Hacker News template — `src/content/templates/hackernews.ts`: Extract story title, URL, points, author, top comments. Handle comment pages vs story pages.
- [x] **Task 28**: Stack Overflow template — `src/content/templates/stackoverflow.ts`: Extract question, accepted answer, top answers with votes. Preserve code blocks with language hints.
- [x] **Task 29**: GitHub template — `src/content/templates/github.ts`: Handle README pages, issue pages, PR pages, code file pages. Extract repo metadata.
- [x] **Task 30**: Wikipedia template — `src/content/templates/wikipedia.ts`: Clean extraction removing edit links, references section cleanup, infobox extraction as frontmatter.
- [x] **Task 31**: Medium template — `src/content/templates/medium.ts`: Handle paywall detection (already exists), clean extraction of member-only content preview, author/publication metadata.
- [x] **Task 32**: Substack template — `src/content/templates/substack.ts`: Extract newsletter content, author, publication name, date. Handle free vs paid content indicators.
- [x] **Task 33**: ArXiv template — `src/content/templates/arxiv.ts`: Extract paper title, authors, abstract, PDF link. Format citation in frontmatter.
- [x] **Task 34**: Documentation site template — `src/content/templates/docs.ts`: Generic template for docs sites (MDN, React docs, etc.). Extract breadcrumb path, code examples, navigation context.
- [x] **Task 35**: Amazon product template — `src/content/templates/amazon.ts`: Extract product name, price, rating, features list, description. Useful for purchase research.
- [x] **Task 36**: Recipe template — `src/content/templates/recipe.ts`: Extract recipe name, ingredients list, instructions, prep/cook time. Use schema.org Recipe JSON-LD when available.
- [x] **Task 37**: Custom template editor — Add UI in options page to create/edit/delete custom templates. JSON editor with preview. Import/export templates as JSON.
- [x] **Task 38**: Template matching in popup — Show which template matched in the popup (if any). Allow user to override or disable template for current clip.
- [x] **Task 39**: Template priority system — Allow user to set priority order when multiple templates could match. Add `priority: number` to SiteTemplate.
- [x] **Task 40**: Template test harness — Create `tests/templates/` with test HTML fixtures for each site template. Verify extraction produces expected markdown.
- [x] **Task 41**: Template contribution guide — Write `docs/custom-templates.md` explaining how to create and share site templates.
- [x] **Task 42**: Built-in template bundle — Create `src/content/templates/index.ts` that exports all built-in templates. Load from settings which ones are enabled.

---

## Phase 4: Twitter/X Thread Clipping (Tasks 43-55)

Full thread extraction from Twitter/X.

- [x] **Task 43**: Add Twitter/X page type — Add `"twitter"` to PageType union in `types.ts`. Update `pageType.ts` detection for twitter.com and x.com domains.
- [x] **Task 44**: Twitter extractor scaffolding — Create `src/content/extractors/twitter.ts` with `extractTwitterContent(result: ClipResult): Promise<ClipResult>`. Register in `clipper.ts` switch.
- [x] **Task 45**: Single tweet extraction — Extract tweet text, author, handle, timestamp, media links, engagement stats from a single tweet page.
- [x] **Task 46**: Thread detection — Detect if current page is a thread (multiple tweets by same author in sequence). Walk the DOM to find all thread tweets.
- [x] **Task 47**: Thread extraction — Extract full thread in order: each tweet as a section with timestamp. Handle quoted tweets, retweets within thread.
- [x] **Task 48**: Twitter media handling — Extract images (as markdown image links), video thumbnails, poll data, link cards from tweets.
- [x] **Task 49**: Twitter metadata — Extract author info (name, handle, verified status, bio), thread stats (likes, retweets, replies total).
- [x] **Task 50**: Twitter markdown formatting — Format thread as clean markdown: `# Thread by @handle`, then each tweet as a paragraph with timestamp. Include `---` between tweets.
- [x] **Task 51**: Twitter frontmatter — Custom frontmatter for Twitter: `type: tweet`, `author_handle`, `thread_length`, `engagement` fields.
- [x] **Task 52**: Twitter popup UI — Update popup to show Twitter icon and "Tweet/Thread" label. Show thread count if detected.
- [x] **Task 53**: Headless Twitter clipper — Create `tools/twitter-clipper.ts` for headless thread extraction via Puppeteer. Support `--profile` for auth, `--json`, `--stdout`.
- [x] **Task 54**: Twitter API fallback — If DOM extraction fails (auth wall), try Twitter's public embed API or nitter instances as fallback.
- [x] **Task 55**: Twitter template integration — Register Twitter as a site template so the template system is used. Ensure template and extractor don't conflict.

---

## Phase 5: Smart Tag & Name Suggestions (Tasks 56-68)

Auto-suggest tags and note titles based on page content.

- [x] **Task 56**: Tag suggestion engine — Create `src/shared/tagSuggestion.ts` with `suggestTags(metadata: ClipMetadata, content: string): string[]` that analyzes content and returns tag suggestions.
- [x] **Task 57**: Domain-based tags — Auto-suggest tags based on domain: github.com → `github`, youtube.com → `youtube`, arxiv.org → `research`, etc. Configurable mapping in settings.
- [x] **Task 58**: Content keyword extraction — Extract top keywords from article content using TF-IDF-like scoring (word frequency vs common English words stoplist). Suggest as tags.
- [x] **Task 59**: JSON-LD/meta tag mining — Extract tags from existing page metadata: `<meta name="keywords">`, JSON-LD keywords, Open Graph tags, article:tag meta.
- [x] **Task 60**: Category detection — Simple content classifier: detect if content is code/tutorial, news, research, opinion, product, recipe. Suggest category tag.
- [x] **Task 61**: Tag suggestion UI in popup — Show suggested tags as clickable chips below the tags input. Click to add, X to dismiss. Remember dismissed suggestions.
- [ ] **Task 62**: Smart title generation — Create `src/shared/titleSuggestion.ts` with `suggestTitle(metadata, content): string[]` that generates 2-3 title options.
- [ ] **Task 63**: Title cleanup — Clean extracted titles: remove site names (` - Medium`, ` | HN`), decode entities, normalize whitespace, title case option.
- [ ] **Task 64**: Title template system — Allow users to define title templates: `{date} - {title}`, `{domain}/{title}`, `{type} - {title}`. Apply in settings.
- [ ] **Task 65**: Tag history/frequency — Track previously used tags in chrome.storage. Suggest frequent tags and show autocomplete from history.
- [ ] **Task 66**: Tag rules engine — Create user-configurable rules: "If domain contains 'github.com', add tag 'code'". "If title contains 'tutorial', add tag 'learning'". Store in settings.
- [ ] **Task 67**: Name suggestion in popup — Show 2-3 suggested titles as radio options in popup, plus the original. Let user pick or edit.
- [ ] **Task 68**: Suggestion tests — Test tag and title suggestions with various page types and content.

---

## Phase 6: Agentic CLI Tools (Tasks 69-88)

Headless Puppeteer tools for research pipeline automation.

- [ ] **Task 69**: Core clipper library — Extract shared clipping logic from `tools/chatgpt-clipper.ts` into `tools/lib/clipper-core.ts`. Shared browser launch, page extraction, markdown generation.
- [ ] **Task 70**: Universal URL clipper — `tools/clip-url.ts`: Clip any URL headlessly. `bun run tools/clip-url.ts --json <url>` → structured JSON with markdown, metadata, tags. Already planned in Task 9, ensure full implementation.
- [ ] **Task 71**: Batch URL clipper — `tools/batch-clip.ts`: Clip multiple URLs from stdin, file, or args. Support concurrency (`--parallel 4`), progress reporting, JSON array output.
- [ ] **Task 72**: YouTube transcript CLI — `tools/youtube-transcript.ts`: Extract YouTube transcript headlessly. `bun run tools/youtube-transcript.ts --json <url>` → JSON with transcript, metadata.
- [ ] **Task 73**: Twitter thread CLI — Already planned as Task 53. Ensure `--json` output format matches other tools.
- [ ] **Task 74**: Search-and-clip tool — `tools/search-clip.ts`: Google search a query, clip top N results. `bun run tools/search-clip.ts --query "obsidian plugins" --top 5 --json`. For research pipelines.
- [ ] **Task 75**: PDF extraction CLI — `tools/pdf-clip.ts`: Extract text from PDF URLs or local files. Support `--json`, `--stdout`, `--pages 1-5`.
- [ ] **Task 76**: Site scraper tool — `tools/scrape-site.ts`: Crawl a site starting from URL, clip all pages up to depth N. `--depth 2 --max-pages 50 --json`. Output manifest of all clipped pages.
- [ ] **Task 77**: CLI output format standardization — Define `ToolOutput { success: boolean; url: string; title: string; markdown: string; metadata: ClipMetadata; tags: string[]; error?: string }` shared across all tools.
- [ ] **Task 78**: MCP server scaffolding — Create `tools/mcp-server.ts` implementing Model Context Protocol for AI agent integration. Expose clip operations as MCP tools.
- [ ] **Task 79**: MCP tool: clip_url — Register `clip_url(url, options)` tool in MCP server. Returns clipped markdown + metadata.
- [ ] **Task 80**: MCP tool: clip_search — Register `clip_search(query, topN)` tool. Searches and clips results.
- [ ] **Task 81**: MCP tool: save_to_obsidian — Register `save_to_obsidian(title, content, folder, tags)` tool. Saves content via Obsidian CLI.
- [ ] **Task 82**: MCP tool: clip_youtube — Register `clip_youtube(url, includeTimestamps)` tool. Returns transcript + metadata.
- [ ] **Task 83**: MCP tool: clip_twitter — Register `clip_twitter(url)` tool. Returns thread content.
- [ ] **Task 84**: Tool authentication — Create shared auth config for headless tools: Chrome profile path, cookies file. `tools/lib/auth.ts`.
- [ ] **Task 85**: Tool config file — Support `.webclipper.json` config file for tool defaults: vault, folder, tags, chrome profile, concurrency. `tools/lib/config.ts`.
- [ ] **Task 86**: Pipeline composition — `tools/pipeline.ts`: Chain tools together. `bun run tools/pipeline.ts --steps "search:obsidian plugins -> clip:top5 -> save:obsidian"`. Configurable via JSON.
- [ ] **Task 87**: Tool documentation — Write `docs/cli-tools.md` with usage examples for all CLI tools. Include examples for LLM agent integration.
- [ ] **Task 88**: Tool integration tests — Create `tests/tools/` with tests for each CLI tool using mock pages.

---

## Phase 7: Refactoring & Code Quality (Tasks 89-102)

Clean up and strengthen the codebase.

- [ ] **Task 89**: Extract HTML-to-markdown converter — The ChatGPT injector and chatgpt-clipper.ts both have inline HTML→markdown converters. Extract to `src/shared/htmlToMarkdown.ts` and reuse Turndown.
- [ ] **Task 90**: Consolidate frontmatter building — `buildClipMarkdown` in `shared/markdown.ts` and `buildFrontmatter` in `chatgpt-clipper.ts` are duplicated. Unify into one shared function.
- [ ] **Task 91**: Extract sanitization utilities — `sanitizeFilename` exists in both `shared/sanitize.ts` and `chatgpt-clipper.ts`. Remove the duplicate, import from shared.
- [ ] **Task 92**: Message type safety — Add exhaustive switch checks to `router.ts` and `clipper.ts`. Add `satisfies` checks for message types. Remove `any` casts.
- [ ] **Task 93**: Error handling standardization — Create `src/shared/errors.ts` AppError class hierarchy. Replace string errors with typed errors throughout.
- [ ] **Task 94**: Remove console.log statements — Clean up debug logging in `clipper.ts`, `popup.ts`, etc. Replace with a `debug()` utility that only logs when `settings.debug` is true.
- [ ] **Task 95**: Settings validation — Add Zod schema for Settings. Validate on load, migrate on version change. Handle corrupt storage gracefully.
- [ ] **Task 96**: Extract save pipeline — `save.ts` is 150 lines of frontmatter building. Extract field mapping to a separate `buildFrontmatter.ts` function.
- [ ] **Task 97**: Add ESLint + Prettier config — Add `.eslintrc.json` and `.prettierrc`. Configure for TypeScript. Add `lint` and `format` scripts.
- [ ] **Task 98**: Add test infrastructure — Set up Bun test runner with `tests/` directory. Add `bun test` to package.json. Create test utilities for mocking chrome APIs.
- [ ] **Task 99**: Test shared utilities — Unit tests for `sanitize.ts`, `tags.ts`, `folders.ts`, `pageType.ts`, `markdown.ts`, `guards.ts`.
- [ ] **Task 100**: Test extractors — Unit tests for web, YouTube, and PDF extractors using fixture HTML/data.
- [ ] **Task 101**: Type-check CI — Ensure `bun run typecheck` passes cleanly. Fix any existing type errors. Add to CI/test command.
- [ ] **Task 102**: Build optimization — Analyze bundle sizes. Consider code splitting for content script (only load YouTube extractor on YouTube, etc.). Tree-shake unused code.

---

## Phase 8: UX Polish & New Features (Tasks 103-120)

User-facing improvements and additional features.

- [ ] **Task 103**: Reader mode preview — Add "Preview" tab in popup that shows cleaned markdown rendering before clipping. Use a simple markdown→HTML renderer.
- [ ] **Task 104**: Clip history — Store last 50 clips in chrome.storage.local with title, URL, date, tags. Add "History" view in popup.
- [ ] **Task 105**: History search — Add search/filter to clip history by title, URL, tags, date range.
- [ ] **Task 106**: Re-clip from history — "Re-clip" button in history to re-clip a previously saved URL with current settings.
- [ ] **Task 107**: Batch tab clipping — Add "Clip All Tabs" button in popup. Iterate through tabs in current window, clip each, save with progress indicator.
- [ ] **Task 108**: Tab group clipping — Detect Chrome tab groups. Allow clipping all tabs in a group as related notes with backlinks.
- [ ] **Task 109**: Notification system — Show Chrome notification on successful clip (optional, settings toggle). Include note title and vault.
- [ ] **Task 110**: Dark mode popup — Add dark mode support to popup CSS. Detect system preference or add toggle.
- [ ] **Task 111**: Popup keyboard shortcuts — Add keyboard navigation in popup: Enter to clip, Tab between fields, Escape to close.
- [ ] **Task 112**: Folder creation — If target folder doesn't exist in Obsidian, offer to create it (via CLI). Show folder tree from vault.
- [ ] **Task 113**: Multi-vault support — Add vault selector to settings and popup. Store multiple vault configs. Switch between them.
- [ ] **Task 114**: Clip formatting options — Add popup toggle for: include images, include links, include metadata, clean formatting. Quick presets.
- [ ] **Task 115**: Export settings — Add import/export buttons in options for all settings (templates, rules, folders, etc.) as JSON.
- [ ] **Task 116**: Onboarding flow — First-run wizard: detect Obsidian installation, set vault name, choose default folder, test connection.
- [ ] **Task 117**: Badge counter — Show clip count on extension badge icon. Reset daily or weekly (configurable).
- [ ] **Task 118**: Right-click "Clip Link" — Context menu on links: clip the linked page without navigating to it. Open in background tab, clip, close.
- [ ] **Task 119**: Image downloading — When `imageHandling: "download-api"`, download images and save to attachments folder via Obsidian CLI. Rewrite markdown image URLs.
- [ ] **Task 120**: Popup redesign — Modernize popup with better layout: collapsible sections, tag chips, template indicator, save method indicator.

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| 1. Obsidian CLI | 1-12 | CLI integration, save pipeline |
| 2. Selection Clipping | 13-22 | Selection-based clipping |
| 3. Site Templates | 23-42 | Per-site extraction rules |
| 4. Twitter/X | 43-55 | Thread extraction |
| 5. Smart Suggestions | 56-68 | Auto tags & titles |
| 6. Agentic Tools | 69-88 | CLI tools, MCP server |
| 7. Refactoring | 89-102 | Code quality, tests |
| 8. UX Polish | 103-120 | New features, UI improvements |

**Total: 120 tasks**

---

## Emergent — Discovered Work

Tasks added during implementation that don't fit an existing phase.

- [ ] **Task E1**: Validate which CLI is the Phase 1 target (`obsidian` app binary vs `obsidian-cli` package), and document whether it performs direct filesystem writes or wraps `obsidian://` URIs.
- [ ] **Task E2**: Define an extension-compatible local execution bridge for CLI saves (Native Messaging host or local companion service), since MV3 service workers cannot spawn local processes.

<!-- New tasks will be added here by the Ralph loop as they are discovered -->
