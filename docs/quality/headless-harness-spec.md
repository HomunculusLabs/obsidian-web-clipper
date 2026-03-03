# Headless Harness Spec

## Purpose
Define the contract for a deterministic headless regression harness that validates core clip workflows in one reproducible run.

## Scope Contract

### In scope (required in this slice)
The harness MUST cover these three flows:

1. **Generic web clip flow**
   - URL/fixture input is clipped through existing headless tooling.
   - Output markdown + frontmatter are validated.

2. **SeedFinder strain profile flow**
   - SeedFinder-specific extraction path is exercised end to end.
   - Normalized profile data is validated in metadata/frontmatter and markdown output.

3. **CLI save contract flow**
   - `saveViaCli` integration path is validated with safe process mocking.
   - Command payload semantics are asserted without writing to a real vault.

### Out of scope (for this slice)
- Browser extension UI automation (popup/options/manual click-through).
- Real Obsidian vault mutation as part of harness CI run.
- Broad site-template coverage beyond representative generic + SeedFinder paths.

---

## Required Assertions

### Flow 1: Generic web clip
Harness MUST assert all of:
- Clip result reports success (no extraction error path).
- Markdown body is non-empty and includes expected fixture/body signal.
- Stable frontmatter keys exist: `title`, `source`, `type`, `date`, `tags`.
- Non-deterministic noise is excluded from assertions (no exact timestamp equality unless injected/frozen).

### Flow 2: SeedFinder clip integrity
Harness MUST assert all of:
- SeedFinder template path is selected for SeedFinder strain URL pattern.
- `metadata.seedFinderProfile` exists with normalized fields expected by current schema (including lineage compatibility fields).
- Frontmatter includes stable SeedFinder keys when values are present and omits empty/undefined keys.
- Markdown output contains deterministic strain profile section content (not only raw table remnants).

### Flow 3: CLI save contract
Harness MUST assert all of:
- `saveViaCli` is invoked with expected vault/folder-derived file path semantics.
- Payload includes the built markdown content that would be saved.
- Overwrite/append flag behavior is explicit and deterministic for the tested path.
- No real process side effects are required (mocked spawn/process boundary).

---

## Fixture and URL Source Contract

### Primary sources (deterministic by default)
1. **Local HTML fixtures in `tests/`** (preferred)
2. **Static in-test content strings** for focused assertion surfaces
3. **Mocked process responses** for CLI save behavior

### Approved fixture references
- SeedFinder: `tests/templates/fixtures/seedfinder-strain.html` and any dedicated sparse/variant fixture already used by SeedFinder suites.
- Generic web: add/maintain a local representative article fixture under `tests/` for harness use (not live internet content).

### Live URL policy
- Live URLs are **not required** for pass criteria.
- If a live URL smoke is added later, it must be opt-in and excluded from required deterministic gate.

---

## Deterministic Execution Constraints
Harness runs MUST satisfy:

1. **Headless-only default** (`headless: true`) in automated runs.
2. **Isolated filesystem sandbox** for any temp vault/output paths.
3. **No dependency on user-local Obsidian vault state**.
4. **No dependency on real `obsidian-cli` binary for required pass path** (mock process layer in CLI flow).
5. **Stable time/title controls** for assertions sensitive to timestamps/filenames (freeze/inject values where needed).
6. **Order-stable assertions** for lists/arrays in normalized profile outputs.
7. **Network independence** for required gate scenarios (fixtures over live fetch).
8. **Single-command reproducibility** for Builder/Tester execution once harness entrypoint is wired.

---

## Expected Harness Outputs
A required harness run should produce:
- Pass/fail per scenario (generic, SeedFinder, CLI save contract).
- Assertion-level diagnostics sufficient to triage extraction/frontmatter/save regressions.
- A compact run summary artifact in `docs/quality/` (added in later TP tasks).

## Change Control
Any future harness expansion MUST preserve this contract:
- Keep the three required flows as non-optional gate scenarios.
- Add new scenarios without weakening deterministic constraints.
- Keep docs and runnable scripts in sync with `TEST_REQUIREMENTS.md` and `README.md` updates in later tasks.
