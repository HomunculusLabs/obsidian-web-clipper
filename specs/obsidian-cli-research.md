# Obsidian CLI Research

Date: 2026-02-12

## Goal
Validate command-line support for creating/writing notes, vault selection, and content input mode (stdin vs args).

## Environment Probed
- `obsidian` binary: `/Applications/Obsidian.app/Contents/MacOS/obsidian`
- `obsidian-cli` binary: `/opt/homebrew/bin/obsidian-cli`
- `obsidian-cli --version`: `v0.2.2`

## Findings

### 1) `obsidian --help`
Running `obsidian --help` did **not** print a command help menu in this environment. It attempted app-level startup and emitted macOS XPC errors, then hung until killed.

Observed stderr (abbrev):
- `Connection Invalid error for service com.apple.hiservices-xpcservice.`
- `an error occurred while attempting to obtain endpoint for listener 'ClientCallsAuxiliary'`

Conclusion: the installed `obsidian` app binary does not behave like a standard shell CLI here.

---

### 2) Available commands in `obsidian-cli`
`obsidian-cli --help` reports:
- `create` (create note)
- `daily` (create/open daily note)
- `delete` (delete note)
- `move` (move/rename note)
- `frontmatter` (print/edit/delete YAML frontmatter)
- `print` (print note contents)
- `open`, `search`, `search-content`
- `set-default`, `print-default`

Commands relevant to writing/updating content:
- `create` — supports:
  - positional note arg (required; error says accepts 1 arg)
  - `--content string`
  - `--append`
  - `--overwrite`
  - `--vault string`
- `daily` — create/open daily note, supports `--vault`
- `frontmatter` — supports `--edit/--delete`, `--key`, `--value`, `--vault`
- `move` — rename/move note (requires 2 args), supports `--vault`

---

### 3) Vault selection support
Yes.
- Most commands expose `--vault string`.
- `set-default`/`print-default` manage default vault config.
- If no default exists and `--vault` is omitted, commands fail, e.g.:
  - `Cannot find vault config, please use set-default command to set default vault or use --vault flag`

---

### 4) Content from stdin vs args
- **Args:** supported via `create --content "..."`.
- **stdin:** no `--stdin` flag or stdin behavior documented in help output.

Current conclusion: documented path is argument-based content (`--content`), not stdin.

---

### 5) Important implementation caveat
When executing `obsidian-cli create` with invalid vault input, the tool returns:
- `Failed to execute Obsidian URI`

Also, binary string inspection includes `obsidian://new` and URI-related symbols.

This strongly suggests the installed `obsidian-cli` implementation is URI-driven, not direct filesystem writes. If so, URI limitations may still apply (size limits/app dependency), contrary to the Phase 1 assumption that CLI fully replaces URI constraints.

## 6) Phase 1 target validation (E1)

### Candidate A: `obsidian` app binary
- Binary path: `/Applications/Obsidian.app/Contents/MacOS/obsidian`
- Behavior in shell: launches desktop app/runtime; `--help` did not expose stable subcommands for note CRUD.
- Conclusion: **not** the intended automation CLI for this project.

### Candidate B: `obsidian-cli` package binary
- Binary path: `/opt/homebrew/bin/obsidian-cli`
- Behavior in shell: exposes note-oriented commands (`create`, `move`, `delete`, `frontmatter`, etc.) and `--vault` support.
- Conclusion: this is the **Phase 1 target CLI** used by the current codebase (`cliPath` defaults and tool help all target `obsidian-cli`).

## 7) Direct filesystem writes vs URI wrapper

Validated indicators:
1. Runtime error text includes `Failed to execute Obsidian URI` for invalid vault invocation.
2. Binary string inspection includes `obsidian://new` literals.
3. No documented mode in help text claims direct file I/O bypassing the app URI flow.

Conclusion: current tested `obsidian-cli` (`v0.2.2`) appears to be a **URI-backed wrapper** (opens/dispatches Obsidian URI actions), not a guaranteed direct filesystem writer.

## Practical implication for upcoming work
- Browser extension code (MV3) cannot directly spawn local processes.
- Even with a CLI binary, extension-side save requires a bridge (Native Messaging host / local helper service).
- Because `obsidian-cli` is URI-backed in this environment, URI-size/open-app constraints may still apply; treat CLI mode as UX/automation convenience, not a proven hard replacement for URI transport limits.
