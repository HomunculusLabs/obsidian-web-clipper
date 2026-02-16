# Phase 1: Obsidian CLI Integration (Tasks 1-12)

## Goal
Replace the `obsidian://new` URI scheme with direct Obsidian CLI file creation. The URI scheme has size limits (~180KB) and requires Obsidian to be open. CLI removes both limitations.

## Key Files to Create/Modify

### New Files
- `specs/obsidian-cli-research.md` — CLI capability research (Task 1)
- `src/shared/obsidianCli.ts` — Types + config for CLI integration (Task 2)
- `src/shared/obsidianCliSave.ts` — CLI save backend (Task 3)
- `src/background/handlers/saveToCli.ts` — Background handler (Task 6)
- `tools/clip-url.ts` — Headless URL clipper (Task 9)
- `tools/clip-stdin.ts` — Stdin-to-Obsidian pipe (Task 10)
- `tests/cli-save.test.ts` — Integration tests (Task 12)

### Modified Files
- `src/shared/settings.ts` — Add `ObsidianCliConfig` fields, `saveMethod` setting
- `src/shared/messages.ts` — Add `saveToCli` action to `RuntimeRequest`
- `src/popup/save.ts` — Route to CLI/URI/clipboard based on `saveMethod`
- `src/background/router.ts` — Register `saveToCli` handler
- `src/content/chatgpt/injector.ts` — Use save pipeline via background messages (Task 7)
- `tools/chatgpt-clipper.ts` — Add `--cli` flag (Task 8)
- `src/options/` — Add CLI settings section (Task 4)
- `package.json` — Add new tool scripts

## Architecture Notes
- Content scripts cannot spawn processes → CLI save must go through background service worker
- Background service worker also cannot spawn processes in MV3 → may need native messaging host or Node.js sidecar
- **Alternative**: If Obsidian CLI is a local HTTP API, use `fetch()` from background
- Task 1 research should clarify which approach works

## Fallback Chain
```
CLI (preferred) → URI scheme (original) → Clipboard (last resort)
```
Settings let user choose preferred method; fallback happens automatically on failure.

## Dependencies
- Task 1 (research) must complete first — it determines the implementation approach for Tasks 2-11
- Tasks 2-3 are the core implementation
- Tasks 4-8 wire it through the existing extension
- Tasks 9-10 are standalone CLI tools
- Task 11 is nice-to-have polish
- Task 12 validates everything
