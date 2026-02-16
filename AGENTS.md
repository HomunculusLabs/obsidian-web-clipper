# AGENTS.md — Obsidian Web Clipper (Ralph Loop Driver)

This file defines the **execution commands** and **loop contract** for the Pi coding agent (Ralph-style iterations).

## Loop Contract (one task per iteration)
Each iteration must:
1. Read `IMPLEMENTATION_PLAN.md` and pick the **first unchecked** `- [ ]` task.
2. If the task maps to a phase execution plan, open the corresponding file in `Tasks/`.
3. Implement **only that one task**.
4. **Create new tasks** if you discover bugs, missing prerequisites, test gaps, refactor needs, or follow-up work. Add them as `- [ ]` entries in the appropriate section of `IMPLEMENTATION_PLAN.md` (or the `Emergent — Discovered Work` section). Do NOT work on newly created tasks in the same iteration.
5. Run the relevant checks (below).
6. Commit changes (including any new tasks).
7. Mark the task complete (`[x]`) in `IMPLEMENTATION_PLAN.md`.
8. Output:

```
RALPH_COMPLETE: <task description>
RALPH_TASKS_ADDED: <N> new tasks created  (only if N > 0)
```

Then stop so the next iteration can start clean.

## Canonical Artifacts
- Plan: `IMPLEMENTATION_PLAN.md`
- Expanded execution plans: `Tasks/*.md`
- Test gates: `TEST_REQUIREMENTS.md`
- Specs: `specs/`

## Project Overview
Chrome extension (Manifest V3) that clips web pages, PDFs, YouTube videos, and ChatGPT conversations to clean markdown for Obsidian.

## Tech Stack
- **Runtime**: TypeScript 5.4+, Bun (build + tools)
- **Build**: Custom `build/build.ts` using Bun.build (IIFE bundles)
- **Extension**: Chrome Manifest V3
- **Libraries**: Readability.js, Turndown.js, PDF.js, Puppeteer (tools)

## Project Structure
```
src/
├── background/          # Service worker (message routing, handlers)
├── content/             # Content scripts
│   ├── extractors/      # Web, YouTube, PDF extractors
│   ├── chatgpt/         # ChatGPT injector
│   └── web/             # Turndown, metadata, paywall, wiki-links
├── popup/               # Extension popup UI
├── options/             # Settings page
├── offscreen/           # Offscreen document (PDF extraction)
├── shared/              # Shared types, settings, utils
│   ├── types.ts         # Core types (PageType, ClipResult, etc.)
│   ├── messages.ts      # Message types (RuntimeRequest, TabRequest)
│   ├── settings.ts      # Settings interface + defaults
│   └── ...
├── manifest.json
tools/
├── chatgpt-clipper.ts   # Headless Puppeteer ChatGPT clipper CLI
build/
├── build.ts             # Bun build script
specs/
├── chrome-extension.md  # Original spec
Tasks/
├── 00_INDEX.md          # Phase ordering
├── NN_*.md              # Phase execution plans
```

## Commands

### Build
```bash
bun run build          # Production build → dist/
bun run dev            # Watch mode build
```

### Typecheck
```bash
bun run typecheck      # tsc --noEmit
```

### Test
```bash
bun test               # Bun test runner (once test infra exists)
```

### Tools
```bash
bun run clip:chatgpt   # ChatGPT headless clipper
```

## Git
Commit after every completed task:
```bash
git status
git add -A
git commit -m "feat: <short description>"
```

## Adding New Extractors
1. Create `src/content/extractors/{name}.ts`
2. Export an `extract{Name}Content(result: ClipResult, ...): Promise<ClipResult>` function
3. Add new PageType to `src/shared/types.ts`
4. Add detection to `src/shared/pageType.ts`
5. Add case to `src/content/clipper.ts` switch
6. Update popup UI in `src/popup/ui.ts`

## Adding New CLI Tools
1. Create `tools/{name}.ts`
2. Add script to `package.json`
3. Use Puppeteer for headless browser automation
4. Support `--json` and `--stdout` flags for agentic use

## Guardrails (stop and ask)
Stop and report blockers if:
- Specs are ambiguous enough to change architecture.
- A required script (typecheck/build/test) is missing and you can't create it.
- Tests fail and you cannot resolve quickly.
- Changes would break existing extension functionality.
