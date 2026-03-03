# SeedFinder Baseline Command Contract (TP001)

Date: 2026-02-27
Owner: Builder

## Source reconciliation
- `SEEDFINDER_QUALITY_MATRIX.md` (project planning artifact in Obsidian vault): defines SeedFinder-specific quality gates and command set.
- `TEST_REQUIREMENTS.md` (repo): defines global repo gates (`typecheck`, `build`, and generic `bun test`).
- `package.json` scripts (repo): provides executable command aliases used for this SeedFinder sweep.

## Contracted commands for this intake slice

### 1) Type safety gate
- Command: `bun run typecheck`
- Source: matrix + `TEST_REQUIREMENTS.md` + `package.json`
- Scope: TypeScript compile/no-emit across repo.

### 2) Focused SeedFinder regression suite
- Command: `bun run test:seedfinder`
- Source: `package.json` (explicit script), aligned to plan/matrix intent
- Expands to:
  - `bun test tests/templates/seedfinder.test.ts`
  - `bun test tests/extractors/web.test.ts`
  - `bun test tests/shared/buildFrontmatter-seedfinder.test.ts`
  - `bun test tests/extractors/seedfinder-profile.test.ts`
- Scope expectation:
  - parser normalization
  - extractor integration
  - markdown rendering
  - frontmatter serialization

### 3) SeedFinder smoke gate (targeted)
- Command: `bun run test:seedfinder:smoke`
- Source: matrix + `package.json`
- Expands to:
  - `bun test tests/extractors/web.test.ts -t "SeedFinder full profile smoke"`
- Expected targeted test name:
  - `SeedFinder full profile smoke: preserves profile through extractor -> frontmatter pipeline`

### 4) Non-SeedFinder regression guard smoke (targeted)
- Command: `bun test tests/extractors/web.test.ts -t "Non-SeedFinder regression guards"`
- Source: implementation plan verification list; test exists in `web.test.ts`
- Expected targeted suite/test names:
  - describe: `Non-SeedFinder regression guards`
  - test: `template extraction/frontmatter for Reddit remains free of SeedFinder profile fields`

## Reconciliation outcome
- Canonical command stack for this slice:
  1. `bun run typecheck`
  2. `bun run test:seedfinder`
  3. `bun run test:seedfinder:smoke`
  4. `bun test tests/extractors/web.test.ts -t "Non-SeedFinder regression guards"`
- `TEST_REQUIREMENTS.md` remains broader/global (`bun run build`, `bun test`), while this intake slice uses the narrower SeedFinder-focused contract above.
