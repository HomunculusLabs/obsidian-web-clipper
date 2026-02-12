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

## Practical implication for upcoming Phase 1 tasks
- Browser extension code (MV3) cannot directly spawn local processes.
- Even if a CLI exists, extension-side CLI invocation likely needs a bridge (native messaging host / local helper process).
- If current `obsidian-cli` is URI-backed, fallback/size-limit strategy must be revisited before implementing Task 3+.
