# Obsidian Web Clipper

Obsidian Web Clipper is a TypeScript-based toolkit for turning web content into clean, Obsidian-friendly Markdown.

It includes:
- A Chrome Manifest V3 extension for interactive clipping
- A full CLI suite for headless and automated workflows
- A native messaging bridge for direct local Obsidian CLI saves
- An MCP server for AI agent integration

## Table of Contents

1. [What Is Included](#what-is-included)
2. [Tool Catalog](#tool-catalog)
3. [Quick Start](#quick-start)
4. [Development Commands](#development-commands)
5. [Quality Gates](#quality-gates)
6. [Configuration](#configuration)
7. [Repository Structure](#repository-structure)
8. [Documentation](#documentation)

## What Is Included

### 1) Browser Extension Runtime

The extension handles in-browser capture flows:
- Web page clipping (HTML to Markdown)
- YouTube extraction (including transcript support)
- PDF extraction (via offscreen support)
- Chat-oriented extraction modules (for supported chat pages)
- Popup UI and options UI for save and clipping preferences

Primary source directories:
- `src/background/`
- `src/content/`
- `src/popup/`
- `src/options/`
- `src/offscreen/`
- `src/shared/`

### 2) CLI Tooling

The `tools/` directory provides composable command-line tools for automation, pipelines, and agent workflows.

### 3) Integration Surfaces

- Native messaging host installer and bridge scripts in `native-host/`
- MCP server (`tools/mcp-server.ts`) for Model Context Protocol clients

## Tool Catalog

This section outlines all major tools in the repository.

### CLI Tools in `tools/`

| Tool | Entry | Script Alias | Purpose |
|---|---|---|---|
| URL Clipper | `tools/clip-url.ts` | `npm run clip:url` | Clip a single URL (web page, YouTube, PDF patterns) into Markdown |
| Stdin Clipper | `tools/clip-stdin.ts` | `npm run clip:stdin` | Save Markdown from stdin into clip output format |
| Batch Clipper | `tools/batch-clip.ts` | Direct file run | Clip many URLs concurrently |
| Search Clipper | `tools/search-clip.ts` | `npm run clip:search` | Search and clip top results in one flow |
| YouTube Transcript | `tools/youtube-transcript.ts` | Direct file run | Extract transcript and metadata from YouTube |
| Twitter/X Clipper | `tools/twitter-clipper.ts` | `npm run clip:twitter` | Extract tweet/thread content and metadata |
| ChatGPT Clipper | `tools/chatgpt-clipper.ts` | `npm run clip:chatgpt` | Extract ChatGPT conversation content (default: one note per conversation; use `--per-response` to opt in per assistant response) |
| PDF Clipper | `tools/pdf-clip.ts` | `npm run clip:pdf` | Extract text from PDF URL or file |
| Site Scraper | `tools/scrape-site.ts` | `npm run clip:scrape` | Crawl and clip sites up to depth and page limits |
| Pipeline Runner | `tools/pipeline.ts` | `npm run pipeline` | Compose multi-step clipping workflows |
| MCP Server | `tools/mcp-server.ts` | `npm run mcp` | Expose clipping tools to MCP-compatible AI clients |
| PDF Worker | `tools/pdf-extract-worker.js` | Internal | Worker used by PDF extraction flows |
| Pilot Price Signal Analyzer | `tools/pilot-price-signal.ts` | `npm run pilot:price-signal` | Analyze price signals from pilot responses and recommend next anchor price point |

### Shared CLI Libraries in `tools/lib/`

| Library | Purpose |
|---|---|
| `tools/lib/clipper-core.ts` | Shared browser launch, extraction, markdown, logging, common options |
| `tools/lib/config.ts` | Config discovery, loading, and merge behavior |
| `tools/lib/auth.ts` | Shared auth/profile support for sites requiring login |

### Native Host Tooling

| Tool | Entry | Script Alias | Purpose |
|---|---|---|---|
| Native host installer (shell) | `native-host/install.sh` | `npm run native:install` | Install native messaging host for browser integration |
| Native host installer (Bun/TS) | `native-host/install.ts` | `npm run native:install:bun` | Bun-based host install path |
| Native host uninstall | `native-host/uninstall.sh` | `npm run native:uninstall` | Remove native messaging host registration |

## Quick Start

### Prerequisites

- Bun (recommended runtime for scripts and build)
- Chromium-based browser for extension usage
- Optional: Obsidian CLI if using direct CLI save methods

### Install Dependencies

```bash
bun install
```

### Build Extension

```bash
bun run build
```

Output is generated in `dist/`.

### Run in Watch Mode

```bash
bun run dev
```

### Example CLI Runs

```bash
# Clip a URL
npm run clip:url -- https://example.com

# Clip a ChatGPT conversation (default: one note per conversation)
npm run clip:chatgpt -- https://chatgpt.com/c/abc123

# Opt in to one note per assistant response
npm run clip:chatgpt -- --per-response https://chatgpt.com/c/abc123

# Clip markdown from stdin
echo "# Note" | npm run clip:stdin -- --title "Quick Note"

# Search then clip
npm run clip:search -- --query "obsidian workflow"

# Start MCP server
npm run mcp
```

## Development Commands

| Command | Description |
|---|---|
| `npm run build` | Build production extension bundles |
| `npm run dev` | Build in watch mode |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint across `src`, `tools`, `tests`, `build` |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Prettier write mode |
| `npm run format:check` | Prettier check mode |
| `npm run test` | Bun test runner |
| `npm run test:full` | Typecheck + lint + test |
| `npm run ci:full` | Typecheck + lint + format check + test |

## Quality Gates

Automated and manual checks are split explicitly:

### Automated gate (required)
Run either:

```bash
bun run test:quality:headless
```

or the equivalent explicit stack:

```bash
bun run typecheck
bun run test:seedfinder
bun run test:seedfinder:smoke
bun run test:e2e:headless
```

### Headless scenario matrix (deterministic E2E gate)
The scenario matrix provides a deterministic validation gate for web clip workflows. It enforces required coverage for major clip entrypoints and emits machine-readable diagnostics.

```bash
# Run with default manifest
bun run test:e2e:matrix

# Run with explicit manifest path
bun run test:e2e:matrix -- --manifest tests/e2e/fixtures/clip-scenario-manifest.json

# Get JSON output for CI/automation
bun run test:e2e:matrix -- --format json

# Run specific scenario only
bun run test:e2e:matrix -- --scenario generic-web-clip
```

**Expected output (human format):**
```
Headless Scenario Matrix
─────────────────────────
Manifest: tests/e2e/fixtures/clip-scenario-manifest.json
Status: OK
Time: 0.135s

Summary: 4/4 passed

✅ cli-save-contract (required) - 6ms
✅ generic-web-clip (required) - 98ms
✅ reddit-thread (required) - 5ms
✅ seedfinder-strain-profile (required) - 16ms

Failed assertions: 0
Errors: 0
```

**Expected output (JSON format):**
```json
{
  "status": "OK",
  "manifestPath": "tests/e2e/fixtures/clip-scenario-manifest.json",
  "timestamp": "2026-03-01T20:00:00.000Z",
  "total": 4,
  "passed": 4,
  "failed": 0,
  "missingRequired": [],
  "scenarios": [
    {
      "id": "cli-save-contract",
      "passed": true,
      "required": true,
      "durationMs": 6,
      "failures": []
    },
    ...
  ],
  "errors": []
}
```

**Required scenarios:** The matrix MUST include at minimum:
- `generic-web-clip` — Generic web page clipping through headless extraction
- `seedfinder-strain-profile` — SeedFinder strain profile with template extraction
- `cli-save-contract` — CLI save contract validation

**For full contract documentation, manifest schema, and failure codes, see:** `docs/README.md#headless-scenario-matrix`

**Recommendation for autonomous intake verification:**
The scenario matrix is designed for autonomous verification in CI/CD pipelines and intake loops. Use `--format json` output to:
- Integrate with quality gate automation (exit code 0 = pass, 1 = fail)
- Capture diagnostic evidence for decision-grade intake verification
- Track coverage drift and missing-required scenarios over time
- Compose with `test:quality:headless` for fast coverage gate before full suite

**Exit codes:**
- `0` — All required scenarios passed (status: OK)
- `1` — One or more required scenarios failed, or manifest errors (status: FAIL or ERROR)

### GitHub Reported-Failures Regression Gate (required for GitHub link-follow behavior)

The GitHub reported-failures regression gate provides deterministic validation for known GitHub link-follow failures reported by users. This gate locks behavior for three specific repos (`charmbracelet/vhs`, `charmbracelet/lipgloss`, `charmbracelet/crush`) to prevent regressions on:
- Package-name filename derivation (using `package.json` name instead of repo name)
- Monorepo `/tree/...` README extraction
- README link-follow clipping with depth-1 limit and deduplication

**Purpose:** Ensure GitHub clipping behavior remains deterministic for the three reported failing repos and prevent regressions on package-name filename parity, `/tree/...` README extraction, and depth-1 link-follow behavior.

**Usage:**

```bash
# Run GitHub template unit tests with regression fixtures
bun test tests/templates/github.test.ts

# Run headless harness E2E scenarios for reported failures
bun test tests/e2e/headless-clip-harness.test.ts

# Run both regression gates together
bun test tests/templates/github.test.ts && bun test tests/e2e/headless-clip-harness.test.ts

# Full verification sequence (includes typecheck)
bun run typecheck
bun test tests/templates/github.test.ts
bun test tests/e2e/headless-clip-harness.test.ts
```

**Expected output (unit tests):**

```
✅ vhs regression fixture passes
✅ lipgloss regression fixture passes
✅ crush regression fixture passes

- Package-name filename derivation: PASS
- Monorepo /tree/... README extraction: PASS
- README link-follow discovery: PASS
- Depth-1 limit enforcement: PASS
- Deduplication: PASS
- Stable ordering: PASS
```

**Expected output (E2E headless harness):**

```
✅ github-regression-vhs scenario passed
✅ github-regression-lipgloss scenario passed
✅ github-regression-crush scenario passed

All deterministic parity checks passed for:
- Filename derivation (package.json name)
- README content extraction (root and /tree/... paths)
- Link-follow children (depth-1, alphabetical ordering, deduped)
```

**Covered Scenarios:**

| Scenario | Repo | Coverage |
|----------|------|----------|
| `github-regression-vhs` | `charmbracelet/vhs` | Package-name filename, README link-follow, depth-1 children |
| `github-regression-lipgloss` | `charmbracelet/lipgloss` | Package-name filename, README link-follow, depth-1 children |
| `github-regression-crush` | `charmbracelet/crush` | Package-name filename, README link-follow, depth-1 children |

**Contract Coverage:**

Each regression fixture validates:

1. **Filename Derivation** — Note filename derived from `package.json` name field, not just repo name
2. **Monorepo `/tree/...` Paths** — README extraction works for non-root paths (`/tree/main/docs`)
3. **README Link-Follow Discovery** — Extract repo links from README, dedupe targets, stable alphabetical ordering
4. **Depth-1 Limit Enforcement** — Only follow direct README links, no recursive follow
5. **Child Note Creation** — Child notes follow `{parent}-{child}.md` naming pattern with discovery metadata

**Failure Rule IDs:**

| Rule ID | Description | Remediation |
|---------|-------------|-------------|
| `GHR001_FILENAME_MISMATCH` | Filename doesn't match `package.json` name | Fix filename derivation in `src/content/templates/github.ts` |
| `GHR002_TREE_PATH_EXTRACTION_FAILED` | README not extracted from `/tree/...` path | Fix content selector for non-root paths |
| `GHR003_LINK_FOLLOW_DISCOVERY_MISMATCH` | Expected child links not discovered | Fix link pattern extraction or filter rules |
| `GHR004_DEDUPE_FAILED` | Duplicate child links in output | Fix dedupe logic for child URLs |
| `GHR005_ORDERING_NOT_STABLE` | Children not in alphabetical order | Fix sorting logic for child URLs |
| `GHR006_DEPTH_LIMIT_VIOLATION` | Recursive link-follow beyond depth-1 | Enforce depth limit in link-follow logic |
| `GHR007_CHILD_FRONTMATTER_MISSING` | Child note missing discovery metadata | Add `github_discovered_from`, `github_discovery_depth`, `github_sibling_of` fields |

**Canonical Verification Run Sequence:**

For complete GitHub regression gate verification before Builder handoff:

```bash
# 1) Typecheck (ensure no compilation errors)
bun run typecheck

# 2) GitHub template unit tests (fixture-based deterministic assertions)
bun test tests/templates/github.test.ts

# 3) Headless harness E2E scenarios (end-to-end validation in disposable test vaults)
bun test tests/e2e/headless-clip-harness.test.ts

# 4) Full quality gate (optional: includes all headless quality tests)
bun run test:quality:headless
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | All GitHub regression gates passed |
| `1` | One or more regression failures detected |
| `2` | Test execution error (fixture missing, parse error, etc.) |

### GitHub Regression Contract Parity Gate

The `taskpad:github-regression-contract-parity` gate validates that GitHub regression contract docs reference only live test files and verification commands. This gate prevents drift between documentation and executable command surfaces, ensuring regression readiness remains verifiable.

**Purpose:** Validate that GitHub regression contract docs (`tests/fixtures/github-regression-fixtures.md`, related quality docs) reference only:
- Test files that exist in the repo (`tests/templates/github.test.ts`, `tests/e2e/headless-clip-harness.test.ts`)
- Verification commands that exist in `package.json` scripts
- Tool paths that are available in `tools/`
- Canonical command surfaces used by autonomous intake loops

**Usage:**

```bash
# Validate GitHub regression contract parity
bun run taskpad:github-regression-contract-parity -- \
  --fixtures-doc tests/fixtures/github-regression-fixtures.md \
  --package package.json \
  --format json

# Human-readable output
bun run taskpad:github-regression-contract-parity -- \
  --fixtures-doc tests/fixtures/github-regression-fixtures.md \
  --package package.json \
  --format human
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | All contract references are valid (parity gate passes) |
| `1` | One or more violations detected (missing files, stale commands, etc.) |
| `2` | Input validation error (invalid arguments, file not found, etc.) |

**Failure Rule IDs:**

| Rule ID | Severity | Description | Remediation |
|---------|----------|-------------|-------------|
| `GH_PARITY001_MISSING_TEST_FILE` | `error` | Contract references a non-existent test file | Update contract doc to reference existing test file or create the missing test |
| `GH_PARITY002_MISSING_VERIFICATION_COMMAND` | `error` | Contract references a non-existent verification command | Add command to `package.json` or update reference to existing command |
| `GH_PARITY003_MISSING_PACKAGE_SCRIPT` | `error` | Contract references a package.json script that doesn't exist | Add script to `package.json` or update reference |
| `GH_PARITY004_MISSING_TOOL_PATH` | `error` | Contract references a tool path that doesn't exist | Create tool file or fix the path |
| `GH_PARITY005_STALE_TEST_REFERENCE` | `error` | Contract references a deprecated test entrypoint | Update reference to canonical live test |
| `GH_PARITY006_UNSUPPORTED_COMMAND_FORMAT` | `error` | Contract reference is in an unsupported format | Format reference as `bun run <script>` or script name |
| `GH_PARITY007_MISSING_COMMAND_MAPPING` | `error` | Test file exists but has no corresponding verification command | Add verification command mapping for the test |
| `GH_PARITY008_MALFORMED_REFERENCE` | `error` | Contract reference cannot be parsed | Fix reference format (e.g., valid code block, proper shell prompt) |
| `GH_PARITY009_NO_VERIFICATION_REFERENCES` | `warning` | Contract doc has no verification references at all | Add verification commands to contract doc |
| `GH_PARITY010_CANONICAL_COMMAND_MISMATCH` | `error` | Contract references a canonical command that doesn't match expected pattern | Update reference to match canonical command format |

**Canonical Command Mappings:**

The gate validates references against these canonical live commands:

| Canonical Command | Maps To | Notes |
|------------------|---------|-------|
| `test:github:reported-failures` | `bun test tests/templates/github.test.ts tests/e2e/headless-clip-harness.test.ts` | Primary GitHub regression verification script |
| `typecheck` | `bun run typecheck` | TypeScript type checking |
| `tests/templates/github.test.ts` | Direct test file path | GitHub template unit tests |
| `tests/e2e/headless-clip-harness.test.ts` | Direct test file path | Headless harness E2E scenarios |

**Expected Output (Pass):**

```json
{
  "status": "pass",
  "docPath": "tests/fixtures/github-regression-fixtures.md",
  "packagePath": "package.json",
  "totalReferences": 8,
  "validReferences": 8,
  "violations": [],
  "referenceCounts": {
    "test-file": 2,
    "verification-command": 4,
    "package-script": 2
  }
}
```

**Expected Output (Fail - Stale Test Reference):**

```json
{
  "status": "fail",
  "docPath": "tests/fixtures/github-regression-fixtures.md",
  "packagePath": "package.json",
  "totalReferences": 8,
  "validReferences": 7,
  "violations": [
    {
      "ruleId": "GH_PARITY005_STALE_TEST_REFERENCE",
      "lineNumber": 42,
      "rawReference": "tests/templates/github-regression.test.ts",
      "normalizedReference": "tests/templates/github-regression.test.ts",
      "referenceType": "test-file",
      "sourceContext": "code-block",
      "severity": "error",
      "message": "Test file does not exist in repo",
      "remediation": "Update reference to 'tests/templates/github.test.ts' or create the missing test file"
    }
  ],
  "referenceCounts": {
    "test-file": 2,
    "verification-command": 4,
    "package-script": 2
  }
}
```

**Integration with Verification Flow:**

The `taskpad:github-regression-contract-parity` gate should run as part of the canonical GitHub regression verification sequence:

```bash
# 1) Typecheck
bun run typecheck

# 2) GitHub regression contract parity gate
bun run taskpad:github-regression-contract-parity -- \
  --fixtures-doc tests/fixtures/github-regression-fixtures.md \
  --package package.json \
  --format json

# 3) GitHub regression tests
bun run test:github:reported-failures

# 4) Full quality gate (optional)
bun run test:quality:headless
```

**When to Run:**

- After modifying GitHub regression contract docs (`tests/fixtures/github-regression-fixtures.md`)
- After adding or removing test files referenced in contracts
- After renaming or moving test entrypoints
- Before handoff for GitHub-related feature work
- As part of CI/CD quality gates for GitHub regression validation

**For full contract documentation**, see: `docs/quality/github-regression-gate.md`

**Integration with Quality Gates:**

The GitHub reported-failures regression gate is a focused quality gate that should run:
- Before any GitHub template changes (package.json parsing, filename derivation, link-follow logic)
- After modifying `src/content/templates/github.ts`
- As part of pre-handoff verification for Builder loops working on GitHub clipping features

The gate complements the broader headless scenario matrix by providing deep deterministic coverage for the three specific user-reported GitHub link-follow failures.

### GitHub README Relative-Link Canonicalization (required for GitHub link-follow completeness)

The GitHub README relative-link canonicalization feature provides deterministic resolution of same-repo relative markdown links (`./`, `../`, `/tree/...`, `/blob/...`) into canonical absolute GitHub URLs before depth-1 link-follow filtering. This prevents silent capture gaps where linked sibling documentation is skipped or inconsistently deduped during knowledge-base building.

**Purpose:** Ensure GitHub README relative links are deterministically normalized to canonical URLs, enabling complete sibling documentation capture without manual intervention.

**Supported Relative Link Forms:**

| Link Form | Example | Resolves To |
|-----------|---------|-------------|
| Same-directory relative | `./docs/api.md`, `docs/api.md` | `https://github.com/owner/repo/blob/main/docs/api.md` |
| Parent directory | `../README.md`, `../../package.json` | `https://github.com/owner/repo/blob/main/README.md` |
| Root-relative | `/docs/guide.md`, `/LICENSE` | `https://github.com/owner/repo/blob/main/docs/guide.md` |
| GitHub tree link | `/tree/main/docs/api.md` | `https://github.com/owner/repo/tree/main/docs/api.md` |
| GitHub blob link | `/blob/develop/src/index.ts` | `https://github.com/owner/repo/blob/develop/src/index.ts` |

**Reject Rules (Stable Filtering):**

- Fragment-only links (e.g., `#installation`, `#api`) — Page anchors, not navigable content
- External non-GitHub links — Only `github.com/owner/repo` URLs are followed
- Cross-repo links — Only same-repo relative targets are normalized
- Unsupported schemes — Only `http://` and `https://` are processed
- Non-markdown targets — Filtered during depth-1 link-follow validation

**Canonicalization Semantics:**

1. **Deterministic Resolution** — Same input always produces same canonical URL
2. **Branch Awareness** — Respects current README's branch (`/blob/main/`, `/tree/develop/`, etc.)
3. **Path Normalization** — Collapses `../` and `./` segments, removes trailing slashes
4. **Dedupe Parity** — Normalized URLs maintain stable dedupe keys for sibling notes
5. **Ordering Stability** — Alphabetical ordering preserved after normalization

**Verification Run Sequence:**

For complete GitHub relative-link canonicalization verification:

```bash
# 1) Typecheck (ensure no compilation errors)
bun run typecheck

# 2) GitHub template unit tests (fixture-based canonicalization assertions)
bun test tests/templates/github.test.ts

# 3) Headless harness E2E scenarios (end-to-end validation in disposable test vaults)
bun test tests/e2e/headless-clip-harness.test.ts

# 4) Full GitHub regression verification (includes relative-link canonicalization)
bun run test:github:reported-failures
```

**Expected Coverage:**

- ✅ Same-directory relative links (`./docs/api.md`, `docs/api.md`)
- ✅ Parent directory links (`../README.md`, `../../package.json`)
- ✅ Root-relative links (`/docs/guide.md`, `/LICENSE`)
- ✅ GitHub tree paths (`/tree/main/docs/api.md`)
- ✅ GitHub blob paths (`/blob/develop/src/index.ts`)
- ✅ Fragment-only links rejected (`#installation`)
- ✅ External links filtered (non-GitHub URLs)
- ✅ Cross-repo links excluded
- ✅ Stable dedupe after normalization
- ✅ Alphabetical ordering preserved

**When to Run:**

- Before GitHub link-follow feature changes
- After modifying `src/shared/githubRelativeLinkCanonicalization.ts`
- After modifying `src/shared/githubLinkFollowExtraction.ts`
- After updating relative-link normalization logic
- As part of CI/CD for GitHub-related feature work
- Before Builder handoff for GitHub clipping tasks

**Failure Rule IDs:**

| Rule ID | Description | Remediation |
|---------|-------------|-------------|
| `RLC001_SAME_DIR_RESOLUTION_FAILED` | Same-directory relative link not resolved | Fix `./` and same-dir resolution logic in `normalizeGithubReadmeLinks` |
| `RLC002_PARENT_DIR_RESOLUTION_FAILED` | Parent directory link not resolved | Fix `../` path traversal logic in `normalizeGithubReadmeLinks` |
| `RLC003_ROOT_RELATIVE_RESOLUTION_FAILED` | Root-relative link not resolved | Fix `/` path resolution to repo root in `normalizeGithubReadmeLinks` |
| `RLC004_TREE_PATH_RESOLUTION_FAILED` | `/tree/...` path not resolved | Fix GitHub tree path parsing in `normalizeGithubReadmeLinks` |
| `RLC005_BLOB_PATH_RESOLUTION_FAILED` | `/blob/...` path not resolved | Fix GitHub blob path parsing in `normalizeGithubReadmeLinks` |
| `RLC006_FRAGMENT_NOT_REJECTED` | Fragment-only link should be rejected | Fix fragment detection in link-follow filter logic |
| `RLC007_EXTERNAL_NOT_FILTERED` | External GitHub link should be filtered | Fix same-repo validation in canonicalization |
| `RLC008_DEDUPE_KEY_MISMATCH` | Dedupe key not stable after normalization | Fix dedupe key generation to use canonical URL |
| `RLC009_ORDERING_NOT_STABLE` | Links not alphabetically ordered | Fix sorting logic in `extractGithubReadmeLinks` |
| `RLC010_BRANCH_AWARENESS_FAILED` | Branch not respected in resolution | Fix branch extraction from current README URL |

**For full contract documentation**, see: `docs/quality/github-relative-link-canonicalization-contract.md`

**Integration with GitHub Regression Gate:**

The relative-link canonicalization feature integrates with the GitHub reported-failures regression gate to ensure that the three regression repos (`charmbracelet/vhs`, `charmbracelet/lipgloss`, `charmbracelet/crush`) maintain deterministic behavior for all relative link forms. Running `bun run test:github:reported-failures` validates both the regression fixtures and the relative-link canonicalization logic in a single verification sequence.

### TASKPAD intake gate (required for intake loops)
Run intake gates before autonomous dispatch to ensure both backlog health and active plan-slice integrity:

```bash
# write preflight (deterministic writable-path probe; run before mutation commands)
bun run taskpad:write-preflight -- --taskpad "/absolute/path/to/TASKPAD.md"

# queue health only (TASKPAD has at least one unchecked seed task)
bun run taskpad:queue-health -- --taskpad "/absolute/path/to/TASKPAD.md"

# plan integrity only (newest TASKPAD intake slice structure)
bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md

# plan integrity with strict active-slice enforcement (for autonomous loops)
bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice --format json

# strict mode with human-readable output
bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice

# deterministic auto-ideation (runs only when both queues are empty)
# default: seeds self-improvement backlog
bun run taskpad:auto-ideation -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md

# deterministic auto-ideation targeting Work Queue for immediate execution
# recommended: use --target-queue work when queues are empty to ensure
# an immediately plannable Work Queue item for the next Engineer loop
bun run taskpad:auto-ideation -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --target-queue work

# deterministic auto-intake recovery (enforces Work Queue routing on empty queues)
# recommended: use verify:taskpad:intake:auto for autonomous empty-queue recovery
# this command automatically runs taskpad:auto-ideation --target-queue work
# when queue-health reports no unchecked executable queue items
bun run verify:taskpad:intake:auto -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md

# deterministic fallback artifact applier (run when auto-ideation returns status=fallback)
bun run taskpad:apply-fallback -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --artifact "/absolute/path/to/taskpad-fallback-artifact.json"

# fallback artifact parity (run to verify all fallback artifacts are resolved)
bun run taskpad:fallback-artifact-parity -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md

# full intake gate (typecheck + queue health + planned command parity + fallback artifact parity + plan integrity)
bun run verify:taskpad:intake:full -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md

# deterministic recovery orchestrator (single command for autonomous intake)
bun run taskpad:intake:recover -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md

# deterministic intake-to-plan orchestrator (recover -> plan-seed -> plan-contract)
bun run taskpad:intake:autoplan -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --date 2026-02-28

# deterministic completed-slice pruning (archives older completed slices)
bun run taskpad:plan-prune -- \
  --plan IMPLEMENTATION_PLAN.md \
  --keep 5
```

`taskpad:intake:recover` executes queue-health → auto-ideation (if needed) → fallback-apply (if needed) → queue recheck → plan-integrity/full gate (including fallback artifact parity) and emits one deterministic verdict packet (`ready|hold|blocked`).

`taskpad:intake:autoplan` executes recover → plan-seed → plan-contract (falls back to `plan:integrity` if `taskpad:plan-contract` is not wired yet) and emits one deterministic handoff packet with `selectedBacklogLine`, `plannedMarker`, and `newSliceHeading` when a seed is promoted.

`taskpad:plan-prune` keeps the newest completed intake slices in place (`--keep`, default `5`), archives older completed slices into `docs/archive/IMPLEMENTATION_PLAN_ARCHIVE_YYYY-MM-DD.md`, and leaves active/incomplete slices untouched.

# deterministic Work Queue pruning (archives completed/planned Work Queue bullets)
bun run taskpad:work-queue-prune -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md"

# Work Queue archive parity validation (verifies archive↔TASKPAD fingerprint parity)
bun run taskpad:work-queue-archive-parity -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md"

`taskpad:work-queue-prune` archives checked/planned Work Queue bullets into monthly archive files (`docs/archive/TASKPAD_ARCHIVE_YYYY-MM.md`) while preserving unchecked executable items in-place. This keeps the active TASKPAD lean for ideation while maintaining auditability of completed work.

`taskpad:work-queue-archive-parity` validates one-to-one fingerprint parity between pruned TASKPAD bullets and archive entries, detecting drift with actionable diagnostics (rule IDs: `WQAP001_MISSING_ARCHIVE_ENTRY`, `WQAP002_EXTRA_ARCHIVE_ENTRY`, `WQAP003_FINGERPRINT_MISMATCH`).

**Canonical Work Queue maintenance flow:**

```bash
# 1) Prune completed/planned Work Queue items to monthly archive
bun run taskpad:work-queue-prune -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --archive "docs/archive/TASKPAD_ARCHIVE_$(date +%Y-%m).md" \
  --format json

# 2) Verify archive parity (deterministic audit gate)
bun run taskpad:work-queue-archive-parity -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --archive "docs/archive/TASKPAD_ARCHIVE_$(date +%Y-%m).md" \
  --format json
```

**Canonical Execution Queue maintenance flow:**

```bash
# 1) Prune completed/planned Execution Queue items to monthly archive
bun run taskpad:execution-queue-prune -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --archive "docs/archive/TASKPAD_ARCHIVE_$(date +%Y-%m).md" \
  --format json

# 2) Verify archive parity (deterministic audit gate)
bun run taskpad:execution-queue-archive-parity -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --archive "docs/archive/TASKPAD_ARCHIVE_$(date +%Y-%m).md" \
  --format json
```

`taskpad:execution-queue-prune` archives checked/planned Execution Queue bullets into monthly archive files (`docs/archive/TASKPAD_ARCHIVE_YYYY-MM.md`) while preserving unchecked executable items in-place. This keeps the active TASKPAD lean for runtime/ops task tracking while maintaining auditability of completed execution work.

`taskpad:execution-queue-archive-parity` validates one-to-one fingerprint parity between pruned TASKPAD Execution Queue bullets and archive entries, detecting drift with actionable diagnostics (rule IDs: `EQAP001_PARITY_OK`, `EQAP006_PARITY_MISSING_FROM_ARCHIVE`, `EQAP007_PARITY_EXTRA_IN_ARCHIVE`, `EQAP008_PARITY_MUTATED_FINGERPRINT`).

**Integration with intake-auto flow:**

The `verify:taskpad:intake:auto` command now automatically runs both Work Queue and Execution Queue prune and archive parity as part of the canonical intake verification sequence:

1. Queue health check (triggers ideation if empty)
2. **Work Queue prune** (archives completed/planned Work Queue bullets)
3. **Work Queue archive parity** (validates Work Queue fingerprint parity)
4. **Execution Queue prune** (archives completed/planned Execution Queue bullets)
5. **Execution Queue archive parity** (validates Execution Queue fingerprint parity)
6. Full intake verification (`verify:taskpad:intake:full`)

This ensures completed Work Queue and Execution Queue history is archived without losing auditability on every autonomous intake run.

### TASKPAD Auto-Intake Recovery (`verify:taskpad:intake:auto`)

The `verify:taskpad:intake:auto` command provides deterministic autonomous recovery for empty-queue intake loops. It enforces Work Queue routing to ensure immediate executability without manual queue promotion.

**Purpose:** Automatically detect empty intake queues and seed an immediately plannable Work Queue item, then run full intake verification. This eliminates the need for manual queue promotion when autonomous loops encounter empty state.

**Enforced Behavior:**
- When `taskpad:queue-health` reports no unchecked executable items (`executableQueueTotal === 0`):
  - Automatically invokes `taskpad:auto-ideation --target-queue work` to seed Work Queue
  - Runs full intake verification (`verify:taskpad:intake:full`) post-ideation
- When queues already have unchecked items:
  - Skips auto-ideation entirely
  - Runs full intake verification directly

**Usage:**

```bash
# Autonomous empty-queue recovery (enforced Work Queue routing)
bun run verify:taskpad:intake:auto -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md
```

**Expected flow:**

```bash
# 1) Queue health check runs first
bun run taskpad:queue-health -- --taskpad "/absolute/path/to/TASKPAD.md"

# 2) If empty (exit code 1), auto-ideation runs with Work Queue routing
bun run taskpad:auto-ideation -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --target-queue work

# 3) Full intake verification always runs
bun run verify:taskpad:intake:full -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md
```

**Machine-readable output:**

When empty-queue recovery triggers, you'll see auto-ideation output with `targetQueueRouting` metadata:

```json
{
  "targetQueueRouting": {
    "targetQueue": "work",
    "insertionSection": "## Work Queue",
    "ruleId": "TQR004_WORK_QUEUE_PATH"
  }
}
```

**Key differences from direct `taskpad:auto-ideation` invocation:**

| Aspect | `taskpad:auto-ideation --target-queue work` | `verify:taskpad:intake:auto` |
|--------|--------------------------------------------|------------------------------|
| Queue check required? | Yes (manual) | Yes (automatic) |
| Work Queue routing | Optional flag | **Enforced** when queues empty |
| Full verification | No (ideation only) | Yes (always runs) |
| Intended use case | Manual ideation | Autonomous intake recovery |

**For full contract documentation**, see: `docs/quality/taskpad-auto-ideation.md#auto-intake-recovery-contract`

### TASKPAD Work Queue-Target Ideation

When autonomous intake loops detect empty queues (no unchecked Work Queue items), the canonical path is to use `--target-queue work` to seed an immediately executable Work Queue item. This ensures the next Engineer loop has a plannable task without manual queue promotion.

**Canonical flow for empty executable queues:**

```bash
# 1) Check queue health to confirm empty state
bun run taskpad:queue-health -- --taskpad "/absolute/path/to/TASKPAD.md"

# 2) Seed Work Queue with immediately executable item
bun run taskpad:auto-ideation -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --target-queue work \
  --format json

# 3) Verify Work Queue has unchecked item after ideation
bun run taskpad:queue-health -- --taskpad "/absolute/path/to/TASKPAD.md"

# 4) Run full intake verification before Builder dispatch
bun run verify:taskpad:intake:full -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md
```

**Expected machine-readable output for Work Queue-target ideation:**

```json
{
  "status": "seeded|deduped",
  "triggered": true,
  "targetQueueRouting": {
    "targetQueue": "work",
    "insertionSection": "## Work Queue",
    "ruleId": "TQR004_WORK_QUEUE_PATH"
  },
  "queueHealth": {
    "workQueueUncheckedCount": 1,
    "executionQueueUncheckedCount": 0,
    "autonomousUncheckedCount": 1,
    "selfImprovementUncheckedCount": 0,
    "executableQueueTotal": 1,
    "intakeQueueTotal": 1,
    "totalUnchecked": 2
  },
  "selectedOutcome": {
    "action": "inserted|deduped",
    "taskpadPath": "/absolute/path/to/TASKPAD.md",
    "insertedLine": 42,
    "matchedExistingLine": null
  }
}
```

**Target queue options:**

| Queue Value | Insertion Section | Use Case |
|-------------|-------------------|----------|
| `work` | `## Work Queue` | Immediately executable work items (recommended for empty queues) |
| `self-improvement` | `## Self-Improvement Backlog` | Staging area for future improvement ideas (default) |

**Verification guidance:**

- After `--target-queue work` ideation, confirm `queueHealth.workQueueUncheckedCount >= 1` and `queueHealth.executableQueueTotal >= 1`
- Queue health re-check should reflect at least one unchecked Work Queue item
- The inserted bullet follows canonical format: `- [ ] planned-YYYY-MM-DD <actionable next step>`
- Full intake verification (`verify:taskpad:intake:full`) must pass before Builder handoff

**For full contract documentation**, see: `docs/quality/taskpad-auto-ideation.md#target-queue-routing-contract`

### TASKPAD Planned Command Parity

Validates that every planned Work Queue item has an executable command reference in `package.json` or tool paths. This gate ensures intake slices remain actionable by proving command executability from queue marker → plan slice → command surface.

**Usage:**

```bash
# Check command parity for planned items
bun run taskpad:planned-command-parity -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --package package.json

# Get JSON output for CI/automation
bun run taskpad:planned-command-parity -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --package package.json \
  --format json

# Human-readable output
bun run taskpad:planned-command-parity -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --package package.json \
  --format human
```

**Exit codes:**
- `0`: All planned commands have parity (all commands are executable)
- `1`: One or more commands fail parity (missing/unmapped/non-executable)
- `2`: Input validation failure (invalid arguments or file paths)

**Canonical Formatting for Planned Work Queue Items**

When creating or updating planned Work Queue items in TASKPAD, follow these canonical formatting guidelines to ensure deterministic parity checking:

**Accepted Marker Shapes:**

| Marker Shape | Format | Example | Canonical Preference |
|--------------|---------|---------|---------------------|
| Unparenthesized | `planned-YYYY-MM-DD` | `planned-2026-03-01` | ✅ **Preferred** (canonical) |
| Parenthesized | `(planned-YYYY-MM-DD)` | `(planned-2026-03-01)` | ✅ Accepted (legacy) |

**Canonical Planned Item Format:**

```markdown
- [ ] planned-YYYY-MM-DD <task description> Verify: <command>
```

**Examples:**

```markdown
# Canonical (preferred)
- [ ] planned-2026-03-01 Implement feature X Verify: typecheck
- [ ] planned-2026-03-02 Add test coverage Verify: bun test tests/feature.test.ts

# Legacy but accepted (no migration required)
- [ ] (planned-2026-03-01) Implement feature Y Verify: lint
- [ ] (planned-2026-03-02) Fix bug Z Verify: bun run test:smoke

# Multiple commands (comma-separated)
- [ ] planned-2026-03-03 Integrate with API Verify: typecheck, bun test tests/api.test.ts
```

**Key Formatting Rules:**

1. **Use unparenthesized marker** as canonical form for new planned items
2. **Date must be ISO 8601 format**: `YYYY-MM-DD` (e.g., `2026-03-01`, not `2026-3-1`)
3. **Marker immediately follows checkbox**: `- [ ] planned-YYYY-MM-DD ...` (no space between `]` and marker)
4. **Verify: clause** is optional but recommended for parity validation
5. **Multiple commands** can be comma-separated in the Verify: clause

**For full marker-shape contract details**, including validation rules, ambiguity handling, and migration guidance, see: `docs/quality/taskpad-planned-command-parity.md#planned-marker-detection-contract`

**Rule IDs:**

| Rule ID | Condition | Remediation |
|---------|-----------|-------------|
| `PARITY001_MISSING_SCRIPT` | Referenced package.json script does not exist | Add the script to package.json or update the reference |
| `PARITY002_MISSING_TOOL_PATH` | Referenced tool file does not exist | Create the tool file or fix the path |
| `PARITY003_NON_EXECUTABLE_PATH` | Path is not executable (wrong extension, invalid location) | Fix the path to point to a valid executable |
| `PARITY004_STALE_REFERENCE` | Script/path exists but is deprecated | Update reference to current script/path |
| `PARITY005_NO_COMMAND_REFERENCE` | Planned item has no `Verify:` clause | Add a verification command to the planned item |
| `PARITY006_AMBIGUOUS_MAPPING` | Command could map to multiple scripts | Disambiguate the command reference |
| `PARITY007_PARSE_FAILURE` | TASKPAD or IMPLEMENTATION_PLAN has malformed structure | Fix markdown structure |

**Integration with intake verification:**

The `taskpad:planned-command-parity` gate is included in `verify:taskpad:intake:full` and runs after `taskpad:queue-health` and before `plan:integrity`:

```bash
# Full intake gate includes command parity validation
bun run verify:taskpad:intake:full -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md
```

**For full contract documentation**, see: `docs/quality/taskpad-planned-command-parity.md`

### TASKPAD Fallback Artifact Parity

Validates that mutator fallback artifacts are in a resolved state (`applied`, `noop`, or `rejected`) before allowing autonomous Builder handoff. This gate ensures that fallback artifacts emitted when TASKPAD paths are non-writable have been properly resolved or explicitly rejected.

**Usage:**

```bash
# Check fallback artifact parity
bun run taskpad:fallback-artifact-parity -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md

# Get JSON output for CI/automation
bun run taskpad:fallback-artifact-parity -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --format json

# Human-readable output
bun run taskpad:fallback-artifact-parity -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --format human
```

**Exit codes:**
- `0`: All fallback artifacts are in resolved state (`applied`, `noop`, or `rejected`)
- `1`: One or more fallback artifacts are unresolved (`pending` or `stale`)
- `2`: Input validation failure (invalid arguments or file paths)

**Rule IDs:**

| Rule ID | Condition | Remediation |
|---------|-----------|-------------|
| `FAP001_PENDING_ARTIFACT` | Fallback artifact exists but has not been applied | Apply the fallback artifact using `taskpad:apply-fallback` or explicitly reject it |
| `FAP002_MISSING_APPLY_EVIDENCE` | Artifact exists but no apply evidence found | Run `taskpad:apply-fallback` to generate apply evidence |
| `FAP003_SHA_PATH_MISMATCH` | Artifact taskpadPath does not match input TASKPAD | Verify the artifact is for the correct TASKPAD file |
| `FAP004_STALE_ARTIFACT` | Artifact is superseded by a newer artifact | Use the newer artifact instead |
| `FAP005_ARTIFACT_NOT_FOUND` | Referenced artifact file does not exist | Verify artifact path or regenerate artifact |
| `FAP006_ARTIFACT_PARSE_ERROR` | Artifact JSON cannot be parsed | Fix artifact JSON format |
| `FAP007_ARTIFACT_SCHEMA_INVALID` | Artifact does not match required schema | Add missing required fields or fix field types |
| `FAP008_ARTIFACT_VERSION_UNSUPPORTED` | Artifact version is not supported | Update artifact to supported version |
| `FAP009_ARTIFACT_KIND_UNKNOWN` | Artifact kind is not recognized | Verify artifact kind is supported |
| `FAP010_REJECTED_ARTIFACT` | Artifact was explicitly rejected by apply-fallback | Review rejection reason and fix underlying issue |

**Integration with intake verification:**

The `taskpad:fallback-artifact-parity` gate is included in `verify:taskpad:intake:full` and runs after `taskpad:planned-command-parity` and before `plan:integrity`:

```bash
# Full intake gate includes fallback artifact parity validation
bun run verify:taskpad:intake:full -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md
```

**For full contract documentation**, see: `docs/quality/taskpad-fallback-artifact-parity.md`

### TASKPAD Verification Pack

The `taskpad:verification-pack` and `taskpad:verification-pack-contract` commands provide deterministic Builder handoff state from TASKPAD and IMPLEMENTATION_PLAN. With the `--history` flag, they emit NDJSON telemetry events for tracking pack generation and contract evaluation across autonomous intake loops.

**Purpose:** Generate reproducible handoff packs and evaluate them against current state, with run-to-run traceability for drift detection and auditability.

**Usage - Generate verification pack with history:**

```bash
# Generate pack to stdout with history tracking
bun run taskpad:verification-pack -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --history docs/quality/taskpad-verification-pack-history.ndjson

# Generate pack to file with history tracking
bun run taskpad:verification-pack -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --out docs/quality/taskpad-verification-pack.json \
  --history docs/quality/taskpad-verification-pack-history.ndjson

# Generate pack with human-readable output
bun run taskpad:verification-pack -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --format human \
  --history docs/quality/taskpad-verification-pack-history.ndjson
```

**Usage - Evaluate verification pack with history:**

```bash
# Evaluate pack with history tracking
bun run taskpad:verification-pack-contract -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --pack docs/quality/taskpad-verification-pack.json \
  --history docs/quality/taskpad-verification-pack-history.ndjson

# Evaluate pack with package.json validation and history tracking
bun run taskpad:verification-pack-contract -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --pack docs/quality/taskpad-verification-pack.json \
  --package package.json \
  --history docs/quality/taskpad-verification-pack-history.ndjson \
  --format json
```

**History Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--history <path>` | Path to NDJSON history file | `docs/quality/taskpad-verification-pack-history.ndjson` |
| `--history-dedupe <mode>` | Dedupe mode: `skip`, `append`, or `noop` | `skip` |

**Dedupe Modes:**

| Mode | Behavior |
|------|----------|
| `skip` (default) | Do not append duplicate events; emit diagnostic with `VPH010_DUPLICATE_EVENT_SUPPRESSED` |
| `append` | Append all events with new `eventId` and `metadata.duplicateOf` reference to original |
| `noop` | Append a minimal noop event with `eventType="duplicate-suppressed"` for duplicates |

**History Event Schema:**

Each line in the NDJSON history file represents one event:

```json
{
  "version": 1,
  "eventType": "pack-generated|contract-evaluated",
  "sliceId": "2026-03-02-verification-pack-history",
  "workQueueFingerprint": "abc123...",
  "packHash": "def456...",
  "generatedAt": "2026-03-02T15:30:00.000Z",
  "sourceCommand": "taskpad:verification-pack|taskpad:verification-pack-contract",
  "driftRuleId": "VPH001_SLICE_ID_MISMATCH|null",
  "eventId": "evt-550e8400-e29b-41d4-a716-446655440000",
  "planPath": "/absolute/path/to/IMPLEMENTATION_PLAN.md",
  "taskpadPath": "/absolute/path/to/TASKPAD.md",
  "durationMs": 123,
  "metadata": {
    "uncheckedCount": 6,
    "plannedCount": 3,
    "commandCount": 5,
    "inputHash": "deadbeef..."
  }
}
```

**Rule IDs:**

| Rule ID | Severity | Description |
|---------|----------|-------------|
| `VPH001_SLICE_ID_MISMATCH` | `error` | Pack slice ID doesn't match current active slice |
| `VPH002_FINGERPRINT_MISMATCH` | `error` | Work queue fingerprint doesn't match current state |
| `VPH003_PACK_HASH_MISMATCH` | `error` | Pack content hash doesn't match expected value |
| `VPH004_PACK_NOT_FOUND` | `error` | Referenced pack file does not exist |
| `VPH005_PACK_PARSE_ERROR` | `error` | Pack file is not valid JSON |
| `VPH006_MISSING_REQUIRED_FIELD` | `error` | Pack is missing required fields |
| `VPH007_COMMAND_NOT_EXECUTABLE` | `warning` | Verification command not found in package.json |
| `VPH008_HISTORY_APPEND_FAILED` | `error` | Failed to append event to history file |
| `VPH009_HISTORY_READ_FAILED` | `error` | Failed to read/parse history file |
| `VPH010_DUPLICATE_EVENT_SUPPRESSED` | `info` | Duplicate event was not appended (idempotency) |

**Exit Codes (taskpad:verification-pack):**

| Code | Meaning |
|------|---------|
| `0` | Pack generated successfully |
| `1` | Pack generation failed |
| `2` | Input validation failure |

**Exit Codes (taskpad:verification-pack-contract):**

| Code | Meaning |
|------|---------|
| `0` | Contract passed |
| `1` | Contract failed |
| `2` | Input validation failure |

**Idempotency:**

Both commands with `--history` are idempotent for repeated runs on unchanged inputs:

- **First run:** Appends full event to history with new `eventId`
- **Duplicate run:** With `--history-dedupe=skip` (default), does not append; emits diagnostic with `VPH010_DUPLICATE_EVENT_SUPPRESSED`

Duplicate detection uses these fields: `sliceId`, `workQueueFingerprint`, `packHash`, `sourceCommand`, `driftRuleId`.

**Canonical Verification Flow with History:**

For autonomous intake verification with full traceability:

```bash
# 1) Generate verification pack with history tracking
bun run taskpad:verification-pack -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --out docs/quality/taskpad-verification-pack.json \
  --history docs/quality/taskpad-verification-pack-history.ndjson

# 2) Evaluate pack against current state with history tracking
bun run taskpad:verification-pack-contract -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --pack docs/quality/taskpad-verification-pack.json \
  --history docs/quality/taskpad-verification-pack-history.ndjson \
  --package package.json

# 3) Review history for drift detection and auditability
cat docs/quality/taskpad-verification-pack-history.ndjson | jq '.'
```

**History File Format:**

- **Format:** NDJSON (Newline Delimited JSON)
- **Encoding:** UTF-8
- **Line ending:** LF (`\n`)
- **Default path:** `docs/quality/taskpad-verification-pack-history.ndjson`

**Example History Content:**

```ndjson
{"version":1,"eventType":"pack-generated","sliceId":"2026-03-02-verification-pack-history","workQueueFingerprint":"abc123...","packHash":"def456...","generatedAt":"2026-03-02T15:30:00.000Z","sourceCommand":"taskpad:verification-pack","driftRuleId":null,"eventId":"evt-550e8400-e29b-41d4-a716-446655440000","planPath":"/absolute/path/to/IMPLEMENTATION_PLAN.md","taskpadPath":"/absolute/path/to/TASKPAD.md","metadata":{"uncheckedCount":6,"plannedCount":3,"commandCount":5,"inputHash":"deadbeef..."}}
{"version":1,"eventType":"contract-evaluated","sliceId":"2026-03-02-verification-pack-history","workQueueFingerprint":"abc123...","packHash":"def456...","generatedAt":"2026-03-02T15:31:00.000Z","sourceCommand":"taskpad:verification-pack-contract","driftRuleId":null,"eventId":"evt-550e8400-e29b-41d4-a716-446655440001","durationMs":123}
```

**For full contract documentation**, see: `docs/quality/taskpad-verification-pack-history.md`

### TASKPAD Verification Pack Execution Gate

The `taskpad:verification-pack-execution-gate` command provides runtime-proof that verification commands in the newest pack can execute successfully before Builder handoff. This gate closes the false-green path where a pack is syntactically valid but commands fail at runtime.

**Purpose:** Execute verification commands from the pack against current repo state and emit deterministic pass/fail verdict with per-command diagnostics.

**Usage:**

```bash
# Run execution gate (requires pack to be generated first)
bun run taskpad:verification-pack-execution-gate -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --pack docs/quality/taskpad-verification-pack.json \
  --package package.json

# Get JSON output for CI/automation
bun run taskpad:verification-pack-execution-gate -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --pack docs/quality/taskpad-verification-pack.json \
  --package package.json \
  --format json

# Human-readable output
bun run taskpad:verification-pack-execution-gate -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --pack docs/quality/taskpad-verification-pack.json \
  --package package.json \
  --format human
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | Execution gate passed (all commands executed successfully) |
| `1` | Execution gate failed (at least one command failed or pack is stale) |
| `2` | Input validation error (missing or invalid inputs) |

**Rule IDs:**

| Rule ID | Severity | Description |
|---------|----------|-------------|
| `EG001_COMMAND_NOT_RESOLVED` | `error` | Command could not be resolved to any known command class |
| `EG002_SCRIPT_NOT_FOUND` | `error` | Referenced package.json script does not exist |
| `EG003_TOOL_NOT_FOUND` | `error` | Referenced tool file does not exist in `tools/` |
| `EG004_TEST_FILE_NOT_FOUND` | `error` | Referenced test file does not exist |
| `EG005_COMMAND_CLASS_DISALLOWED` | `error` | Command belongs to a disallowed command class |
| `EG101_COMMAND_TIMEOUT` | `error` | Command execution exceeded timeout limit (default: 30s) |
| `EG102_NON_ZERO_EXIT` | `error` | Command exited with non-zero status code |
| `EG103_EXECUTION_ERROR` | `error` | Command failed to start (spawn error) |
| `EG104_OUTPUT_TRUNCATED` | `warning` | Command output exceeded capture limit (100KB) |
| `EG201_STALE_PACK_HASH` | `error` | Pack hash does not match current state |
| `EG202_STALE_SLICE_ID` | `error` | Pack slice ID does not match current active slice |
| `EG203_STALE_FINGERPRINT` | `error` | Pack work queue fingerprint does not match current state |

**Command Classes:**

The execution gate resolves commands in this priority order:

| Command Class | Pattern | Examples |
|---------------|---------|----------|
| `package-script` | Script name from package.json | `typecheck`, `test`, `lint` |
| `test-runner` | `bun test <pattern>` | `bun test tests/tools/*.test.ts` |
| `tool-entry` | Tool file in `tools/` | `bun run tools/taskpad-queue-health.ts` |
| `verification-command` | Known verification tools | `bun run taskpad:verification-pack` |

**Guarded Invocation Policy:**

| Rule | Description |
|------|-------------|
| **G001_TIMEOUT_BOUND** | Maximum 30s per command (configurable with `--timeout`) |
| **G002_STDOUT_CAPTURE** | stdout/stderr captured up to 100KB per stream |
| **G003_NO_MUTATION** | Commands run in read-only mode; file mutations are disallowed |
| **G004_DETERMINISTIC_CWD** | Commands execute from project root |
| **G005_ENV_SANITIZED** | Only allowlisted environment variables passed |

**Canonical Verification Flow:**

The execution gate is the final step in the canonical intake verification sequence:

```bash
# 1) Generate verification pack
bun run taskpad:verification-pack -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --out docs/quality/taskpad-verification-pack.json \
  --history docs/quality/taskpad-verification-pack-history.ndjson

# 2) Evaluate pack contract
bun run taskpad:verification-pack-contract -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --pack docs/quality/taskpad-verification-pack.json \
  --history docs/quality/taskpad-verification-pack-history.ndjson \
  --package package.json

# 3) Execute commands (runtime proof)
bun run taskpad:verification-pack-execution-gate -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --pack docs/quality/taskpad-verification-pack.json \
  --package package.json

# 4) Full intake verification (includes all gates)
bun run verify:taskpad:intake:full -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md
```

**Integration with `verify:taskpad:intake:full`:**

The execution gate runs automatically as part of the full intake verification:

```
typecheck → queue-health → planned-command-parity → fallback-artifact-parity
  → verification-pack (generate)
  → verification-pack-contract (evaluate)
  → verification-pack-execution-gate (execute) ← NEW
  → plan:integrity
```

**Expected JSON Output (Pass):**

```json
{
  "version": 1,
  "status": "pass",
  "packHash": "f6e5d4c3b2a1...",
  "workQueueFingerprint": "a1b2c3d4e5f6...",
  "sliceId": "2026-03-02-verification-pack-execution-gate",
  "commandCount": 3,
  "passedCount": 3,
  "failedCount": 0,
  "commandResults": [
    {
      "command": "bun run typecheck",
      "commandType": "package-script",
      "resolved": true,
      "passed": true,
      "exitCode": 0,
      "durationMs": 1234,
      "ruleId": null,
      "message": "Command executed successfully"
    }
  ],
  "lineage": {
    "sliceId": "2026-03-02-verification-pack-execution-gate",
    "workQueueFingerprint": "a1b2c3d4e5f6...",
    "packHash": "f6e5d4c3b2a1...",
    "packGeneratedAt": "2026-03-02T10:00:00.000Z"
  },
  "diagnostics": ["Execution gate passed: all 3 commands executed successfully"],
  "evaluatedAt": "2026-03-02T11:00:00.000Z"
}
```

**Expected JSON Output (Fail - Stale Pack):**

```json
{
  "version": 1,
  "status": "fail",
  "packHash": "f6e5d4c3b2a1...",
  "workQueueFingerprint": "a1b2c3d4e5f6...",
  "sliceId": "2026-03-01-old-slice",
  "commandCount": 0,
  "passedCount": 0,
  "failedCount": 0,
  "commandResults": [],
  "lineage": {
    "sliceId": "2026-03-01-old-slice",
    "workQueueFingerprint": "a1b2c3d4e5f6...",
    "packHash": "f6e5d4c3b2a1...",
    "packGeneratedAt": "2026-03-01T10:00:00.000Z"
  },
  "diagnostics": [
    "Stale pack detected: slice ID '2026-03-01-old-slice' does not match current active slice",
    "Rule ID: EG202_STALE_SLICE_ID",
    "Suggestion: Run 'bun run taskpad:verification-pack' to generate a fresh pack"
  ],
  "evaluatedAt": "2026-03-02T11:00:00.000Z"
}
```

**For full contract documentation**, see: `docs/quality/taskpad-verification-pack-execution-gate.md`

### Strict Active-Slice Mode

Strict active-slice mode adds deterministic enforcement for autonomous loops to prevent continued execution when the newest intake slice has no unchecked work or when top-slice activeness is ambiguous. This prevents intake drift where loops appear healthy while no executable TP tasks exist.

**Purpose:** Ensure autonomous loops stop safely instead of silently degrading plan quality when:
- The newest intake slice is fully complete (all TP tasks checked)
- Multiple candidate slices create ambiguous active-slice state

**Invocation:**

```bash
# Base mode (backward compatible; structural validation only)
bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md

# Strict mode with JSON output (recommended for autonomous loops)
bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice --format json

# Strict mode with human-readable output
bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice
```

**Strict Mode Rules:**

| Rule ID | Condition | Exit Code | Remediation |
|----------|-----------|------------|-------------|
| `PLI009_NO_UNCHECKED_TP_TASKS` | Newest slice has zero unchecked TP tasks | 1 | Archive completed slice via `taskpad:plan-prune` or add new tasks |
| `PLI010_AMBIGUOUS_ACTIVE_SLICE` | Cannot deterministically identify active slice | 1 | Fix IMPLEMENTATION_PLAN.md to have exactly one active slice with valid date |

**Success/Failure Matrix:**

| Scenario | Base Mode | Strict Mode | Strict Rule IDs Fired |
|----------|-----------|-------------|---------------------|
| Valid slice with unchecked tasks | ✅ PASS | ✅ PASS | None |
| Valid slice, all tasks checked | ✅ PASS | ❌ FAIL | PLI009 |
| Multiple candidate slices | ⚠️ PASS* | ❌ FAIL | PLI010 |
| Slice heading missing date | ⚠️ PASS* | ❌ FAIL | PLI010 |
| No TASKPAD slice at all | ❌ FAIL | ❌ FAIL | PLI001 |
| Missing required heading | ❌ FAIL | ❌ FAIL | PLI002/PLI003 |

*Base mode may select first matching slice by simple regex, accepting ambiguous state as "good enough" for manual review.

**Expected JSON Output (Strict Mode):**

```json
{
  "status": "fail",
  "mode": "strict",
  "activeSlice": {
    "heading": "## TASKPAD Intake Slice (2026-03-01): ...",
    "line": 1,
    "hasUncheckedTasks": false,
    "totalTpTasks": 5,
    "uncheckedTpTasks": 0,
    "checkedTpTasks": 5
  },
  "violations": [
    {
      "ruleId": "PLI009_NO_UNCHECKED_TP_TASKS",
      "summary": "Newest intake slice has no unchecked TP tasks.",
      "details": {
        "totalTpTasks": 5,
        "uncheckedTpTasks": 0,
        "checkedTpTasks": 5
      },
      "remediation": "Archive the completed slice or add new unchecked TP tasks."
    }
  ],
  "validatedRules": [
    "PLI001_ACTIVE_SLICE_MISSING",
    "PLI002_REQUIRED_HEADING_MISSING",
    "PLI009_NO_UNCHECKED_TP_TASKS",
    "PLI010_AMBIGUOUS_ACTIVE_SLICE"
  ]
}
```

**Integration with Autoplan Orchestrator:**

The `taskpad:intake:autoplan` tool uses strict mode to surface actionable blockers:

- **When PLI009 fires** (no unchecked tasks):
  - Verdict: `hold` (intentional stop point, not blocked)
  - Reason code: `AUTOPLAN_HOLD_STRICT_NO_UNCHECKED_TASKS`
  - Next action: Archive completed slice via `taskpad:plan-prune -- --plan IMPLEMENTATION_PLAN.md --keep 5` or add new tasks
  - Does NOT create duplicate top slices

- **When PLI010 fires** (ambiguous active slice):
  - Verdict: `blocked` (contract violation requiring manual fix)
  - Reason code: `AUTOPLAN_BLOCKED_STRICT_AMBIGUOUS_SLICE`
  - Next action: Fix IMPLEMENTATION_PLAN.md to have exactly one active slice with valid `(YYYY-MM-DD)` date

- **When base rules fire in strict mode:**
  - Verdict: `hold` (same as base mode)
  - Reason code: `AUTOPLAN_HOLD_PLAN_CONTRACT`
  - Next action: Fix base integrity issues per remediation guidance

**Verification Flow for Autonomous Loops:**

For autonomous intake verification using strict mode, follow this flow:

1. **Pre-flight checks** (before any mutations):
   ```bash
   # Verify plan structure with strict mode
   bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice --format json
   ```

2. **Parse exit status and violations**:
   - Exit `0` → Continue with intake flow
   - Exit `1` → Check `violations[].ruleId` for deterministic next action

3. **Handle PLI009 (no unchecked tasks)**:
   ```bash
   # Archive completed slices to make room for new work
   bun run taskpad:plan-prune -- --plan IMPLEMENTATION_PLAN.md --keep 5

   # Either:
   # a) Add new unchecked TP tasks to active slice, or
   # b) Run taskpad:plan-seed to promote a backlog item into a new slice
   bun run taskpad:plan-seed -- \
     --taskpad "/path/to/TASKPAD.md" \
     --plan IMPLEMENTATION_PLAN.md
   ```

4. **Handle PLI010 (ambiguous active slice)**:
   - Manual fix required: Edit `IMPLEMENTATION_PLAN.md`
   - Ensure exactly one H2 heading matches `## TASKPAD Intake Slice (YYYY-MM-DD)`
   - Re-run strict mode to validate fix

5. **Post-mutation verification**:
   ```bash
   # After plan-seed or plan-prune, verify strict mode passes
   bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice --format json

   # Then run full intake autoplan
   bun run taskpad:intake:autoplan -- \
     --taskpad "/path/to/TASKPAD.md" \
     --plan IMPLEMENTATION_PLAN.md \
     --date 2026-03-01
   ```

**For full contract documentation**, see: `docs/quality/implementation-plan-integrity.md`

This document includes:
- Complete rule taxonomy with deterministic IDs
- Detailed pass/failure matrix for all scenarios
- Machine-readable output format specification
- Integration patterns with autonomous intake tools

Runnable examples:

```bash
# ready path (queue already has unchecked work; auto-ideation/fallback steps are skipped)
bun run taskpad:intake:recover -- \
  --taskpad tests/tools/fixtures/taskpad-queue-health-pass.md \
  --plan IMPLEMENTATION_PLAN.md

# hold path (empty queue fixture in read-only context => fallback apply cannot write)
bun run taskpad:intake:recover -- \
  --taskpad tests/tools/fixtures/taskpad-queue-health-empty.md \
  --plan IMPLEMENTATION_PLAN.md

# autoplan invocation (provide writable taskpad/plan paths)
bun run taskpad:intake:autoplan -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan "/absolute/path/to/IMPLEMENTATION_PLAN.md" \
  --date 2026-02-28
```

Canonical fallback flow (single auditable apply step):

```bash
# 1) Generate candidate + fallback artifact when target TASKPAD path is read-only
# (can use --target-queue work for Work Queue seeding)
bun run taskpad:auto-ideation -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --target-queue work

# 2) Apply exactly that artifact via deterministic contract validation
bun run taskpad:apply-fallback -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --artifact "/absolute/path/to/taskpad-fallback-artifact.json"
```

Expected machine-readable evidence for this flow:
- `taskpad:auto-ideation` (fallback branch): `status="fallback"`, non-null `artifactPath`, `applyHint`, and `preflight.*` metadata.
- `taskpad:apply-fallback`: deterministic terminal `status` (`applied|noop|rejected`) with non-null `reasonCode` on rejection and stable `taskpadPath` + `artifactPath` fields.

Preflight-first recovery behavior (inside orchestration):
- `auto-ideation` step emits `preflight.mode`, `preflight.writable`, and `preflight.reasonCode` whenever recovery branch runs.
- `preflight.mode: "direct-write"` continues with normal insert/dedupe behavior.
- `preflight.mode: "fallback-artifact"` emits deterministic `artifactPath` + `applyHint` and triggers `taskpad:apply-fallback` attempt.
- If fallback apply cannot mutate TASKPAD (for example `EPERM`), verdict remains deterministic `hold` with actionable reason codes.

Verification evidence checklist (intake-recover TP007):
- [ ] Include one `ready` run and one deterministic non-ready (`hold` or `blocked`) run.
- [ ] For each run, capture `verdict` + top-level `reasonCode` from the JSON packet.
- [ ] Confirm step-level statuses are present for all orchestrator steps (`queue-health-initial`, `auto-ideation`, `apply-fallback`, `queue-health-recheck`, `plan-integrity`, `verify-intake-full`).
- [ ] If fallback branch executes, capture `preflight.*`, `artifactPath`, and fallback-apply outcome (`applied|noop|rejected`).
- [ ] Keep compact command outputs in `docs/quality/taskpad-auto-ideation-report.md` for auditability and replay.

Verification evidence checklist (fallback apply flow TP005):
- [ ] Capture one `taskpad:auto-ideation` fallback run with `status="fallback"` and non-null `artifactPath`.
- [ ] Capture the corresponding `taskpad:apply-fallback` run using that exact artifact path.
- [ ] Record top-level fields from apply output: `status`, `reasonCode`, `taskpadPath`, `artifactPath`.
- [ ] Confirm apply status semantics are deterministic (`applied|noop|rejected`) and that mismatch/tamper failures keep TASKPAD unchanged.
- [ ] Keep command + compact JSON snippets in `docs/quality/taskpad-auto-ideation-report.md`.

Verification evidence checklist (`taskpad:plan-prune` TP005):
- [ ] Capture one `pruned` run (`reasonCode: PLAN_PRUNE_OK`) showing non-zero `prunedCount` and non-null `archivePath`.
- [ ] Capture one `noop` run (`reasonCode: PLAN_PRUNE_NOOP_WITHIN_KEEP_WINDOW`) showing `prunedCount: 0` and `archivePath: null`.
- [ ] Verify `keptCount + prunedCount === completedSliceCount` in both outputs.
- [ ] Confirm archived headings preserve source order and active/incomplete slice content remains unchanged.
- [ ] Keep compact command/result snippets in `docs/quality/taskpad-auto-ideation-report.md` for replay.

Verification evidence checklist (strict-active-slice mode TP008):
- [ ] Capture one strict mode pass run where active slice has unchecked tasks (`status: "pass"`, `violations: []`).
- [ ] Capture one PLI009 failure run where active slice has no unchecked tasks (verify `ruleId: PLI009_NO_UNCHECKED_TP_TASKS`, `activeSlice.uncheckedTpTasks: 0`).
- [ ] Capture one PLI010 failure run showing ambiguous active slice state (verify `ruleId: PLI010_AMBIGUOUS_ACTIVE_SLICE`, multiple candidates or missing date).
- [ ] Confirm strict mode JSON output includes deterministic `activeSlice` fields: `heading`, `line`, `hasUncheckedTasks`, `totalTpTasks`, `uncheckedTpTasks`, `checkedTpTasks`.
- [ ] Verify `violations[].ruleId` ordering is deterministic: `PLI001` → `PLI010` → `PLI009` → base rules.
- [ ] Capture autoplan integration evidence showing `reasonCode: AUTOPLAN_HOLD_STRICT_NO_UNCHECKED_TASKS` or `AUTOPLAN_BLOCKED_STRICT_AMBIGUOUS_SLICE` when strict rules fire.
- [ ] Store compact command + JSON snippets in `docs/quality/implementation-plan-integrity.md` for auditability.

### Queue Reconcile Metadata

Both `taskpad:plan-seed` and `taskpad:intake:autoplan` run a post-mutation queue reconcile step that validates and auto-heals canonical queue section structure on the target TASKPAD file. This reconcile step addresses drift where queue contracts may appear green in validation tools while the actual TASKPAD file used by intake misses canonical section headings.

**Expected reconcile metadata in CLI output:**

When running `taskpad:plan-seed` or `taskpad:intake:autoplan`, check for these fields in the output:

```bash
bun run taskpad:plan-seed -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --date 2026-03-01

# Output includes queueReconcile section with:
# - queueReconcile.status: "canonical" | "healed" | "error"
# - queueReconcile.reasonCodes: ["RECONCILE_CANONICAL", "RECONCILE_HEALED", ...]
# - queueReconcile.sectionsPresent.workQueue: true/false
# - queueReconcile.sectionsPresent.executionQueue: true/false
# - queueReconcile.sectionsPresent.autonomousKickoffQueue: true/false
# - queueReconcile.sectionsPresent.selfImprovementBacklog: true/false
# - queueReconcile.healedSections: ["## Execution Queue", ...] (empty if status=canonical)
# - queueReconcile.mutated: true/false (indicates whether file was written)
```

**Machine-readable JSON output:**

When using `--format json` (default for autonomous loops), extract the `queueReconcile` object from the JSON envelope:

```json
{
  "status": "seeded",
  "queueReconcile": {
    "status": "healed",
    "reasonCodes": ["RECONCILE_MISSING_SECTION", "RECONCILE_HEALED"],
    "sectionsPresent": {
      "workQueue": true,
      "executionQueue": true,
      "autonomousKickoffQueue": true,
      "selfImprovementBacklog": true
    },
    "healedSections": ["## Execution Queue"],
    "ordering": {
      "currentOrder": ["## Work Queue", "## Execution Queue", "## Autonomous Kickoff Queue", "## Self-Improvement Backlog"],
      "expectedOrder": ["## Work Queue", "## Execution Queue", "## Autonomous Kickoff Queue", "## Self-Improvement Backlog"],
      "isCanonicalOrder": true
    },
    "mutated": true
  }
}
```

**Recommended verification flow for autonomous loops:**

For autonomous intake verification, follow this three-step validation:

1. **Check reconcile status**:
   - `status: "canonical"` → TASKPAD is healthy, proceed with intake
   - `status: "healed"` → Drift was detected and auto-healed, verify healedSections array
   - `status: "error"` → File I/O or parse error, check reason codes

2. **Verify canonical sections are present**:
   ```bash
   # In autonomous verification, assert:
   queueReconcile.sectionsPresent.workQueue === true
   queueReconcile.sectionsPresent.executionQueue === true
   queueReconcile.sectionsPresent.autonomousKickoffQueue === true
   queueReconcile.sectionsPresent.selfImprovementBacklog === true
   ```

3. **Validate no unexpected drift on subsequent runs**:
   - After first run with `status: "healed"`, repeat the same command
   - Second run should return `status: "canonical"` with empty `healedSections` array
   - This confirms idempotency and prevents heading churn

**Key reason codes to monitor:**

| Code | Severity | Action Required |
|------|----------|-----------------|
| `RECONCILE_CANONICAL` | success | No action, TASKPAD structure is valid |
| `RECONCILE_HEALED` | info | Review `healedSections` to confirm expected changes |
| `RECONCILE_MISSING_SECTION` | warning | Section was auto-added, verify insertion position |
| `RECONCILE_OUT_OF_ORDER` | warning | Sections were reordered, verify final order |
| `RECONCILE_DUPLICATE_HEADING` | warning | Duplicate canonical headings detected, manual review recommended |
| `RECONCILE_TASKPAD_NOT_FOUND` | error | File path is incorrect or file does not exist |
| `RECONCILE_TASKPAD_READ_FAILED` | error | File I/O permission issue, check path and permissions |
| `RECONCILE_TASKPAD_PARSE_FAILED` | error | Malformed markdown, check file syntax |

**For full contract documentation**, see: `docs/README.md#taskpad-queue-reconcile-contract`

This section includes:
- Canonical queue section ordering rules
- Healing behavior and idempotency guarantees
- Machine-readable reason-code taxonomy
- Integration details with intake tools

### TASKPAD Mutator Fallback/Apply Flow

All TASKPAD mutators that produce content edits follow a **shared write-mode contract** to handle non-writable targets deterministically. This contract ensures consistent artifact schema and validation across all mutator types.

**Mutators using this contract:**
- `taskpad:plan-seed` — Promotes backlog items into new plan slices
- `taskpad:intake:autoplan` — Orchestrates recover → plan-seed → plan-contract flow
- `taskpad:auto-ideation` — Auto-generates self-improvement candidates when queues empty
- Queue-reconcile write paths — Auto-heals canonical queue structure
- Any future TASKPAD mutation commands

**Contract location:** `tools/lib/taskpad-mutator-contract.ts`

#### Write Modes

The shared contract defines three deterministic write modes:

| Mode | Description | Exit Code |
|-------|-------------|------------|
| `direct-write` | Mutator proceeds with direct file writes (target is writable). | 0 |
| `fallback-artifact` | Mutator emits a deterministic fallback artifact instead of mutating. | 0 |
| `error` | Mutator fails with non-zero exit; no writes or artifacts generated. | 1 |

#### Deterministic Reason-Code Mapping

**Preflight reason codes** (writeability probe, from `taskpad:write-preflight`):

| Reason Code | Write Mode | Permission Class | Description |
|------------|-------------|-----------------|-------------|
| `MUTATOR_PREFLIGHT_OK` | `direct-write` | `none` | Probe file created/removed successfully; TASKPAD is writable. |
| `MUTATOR_PERMISSION_EPERM` | `fallback-artifact` | `permission-denied` | Operation not permitted (EPERM) when writing probe. |
| `MUTATOR_PERMISSION_EACCES` | `fallback-artifact` | `permission-denied` | Permission denied (EACCES) when writing probe. |
| `MUTATOR_PERMISSION_EROFS` | `fallback-artifact` | `permission-denied` | Read-only file system (EROFS) when writing probe. |
| `MUTATOR_PERMISSION_DENIED_GENERIC` | `fallback-artifact` | `permission-denied` | Generic permission denied error. |
| `MUTATOR_TARGET_NOT_FOUND` | `error` | `non-permission` | TASKPAD file does not exist. |
| `MUTATOR_TARGET_PATH_INVALID` | `error` | `non-permission` | TASKPAD path is invalid or not a file. |
| `MUTATOR_TARGET_NOT_WRITABLE_FILE` | `error` | `non-permission` | TASKPAD path exists but is not a writable file. |
| `MUTATOR_PARENT_DIR_NOT_FOUND` | `error` | `non-permission` | Parent directory does not exist. |
| `MUTATOR_IO_UNEXPECTED` | `error` | `non-permission` | Unexpected I/O error during probe. |

**Execution reason codes** (mutation outcome):

| Reason Code | Description |
|------------|-------------|
| `MUTATOR_EXECUTION_OK` | Mutation succeeded. |
| `MUTATOR_EXECUTION_NOOP` | Mutation no-op (e.g., duplicate detected). |
| `MUTATOR_FALLBACK_ARTIFACT_GENERATED` | Artifact emitted instead of mutation. |
| `MUTATOR_WRITE_FAILED` | Write operation failed. |
| `MUTATOR_ATOMIC_COMMIT_FAILED` | Atomic transaction failed. |
| `MUTATOR_VALIDATION_FAILED` | Pre-apply validation failed. |
| `MUTATOR_CONTRACT_VIOLATION` | Contract requirements violated. |

#### Shared Artifact Schema

All mutator fallback artifacts MUST follow the `MutatorFallbackArtifact` schema from `tools/lib/taskpad-mutator-contract.ts`:

```json
{
  "version": 1,
  "kind": "taskpad-auto-ideation-fallback-patch|taskpad-plan-seed-fallback-patch|taskpad-intake-autoplan-fallback-patch|taskpad-queue-reconcile-fallback-patch|taskpad-generic-fallback-patch",
  "taskpadPath": "/absolute/path/to/TASKPAD.md",
  "taskpadSha256": "64-char-hex-sha256",
  "mutationId": "mutator-specific-id",
  "mutationOutcome": {
    "action": "would-insert|would-update|would-delete|would-reorder",
    "canonicalContent": "canonical-form-of-mutation",
    "targetLine": 1
  },
  "patch": {
    "format": "unified-diff",
    "targetPath": "/absolute/path/to/TASKPAD.md",
    "content": "unified-diff-content"
  },
  "applyHint": "bun run taskpad:apply-fallback -- --taskpad /absolute/path/to/TASKPAD.md --artifact /absolute/path/to/artifact.json"
}
```

**Required fields:**
- `version`: MUST be 1
- `kind`: Mutator-specific artifact kind (e.g., `taskpad-auto-ideation-fallback-patch`, `taskpad-plan-seed-fallback-patch`)
- `taskpadPath`: Absolute path to target TASKPAD
- `taskpadSha256`: SHA-256 hash of target content at generation time (64 lowercase hex chars)
- `mutationId`: Mutator-specific identifier
- `mutationOutcome.action`: Action type
- `mutationOutcome.canonicalContent`: Canonical form of mutation
- `mutationOutcome.targetLine`: Target line (1-indexed) or null
- `patch.format`: MUST be `unified-diff`
- `patch.targetPath`: MUST match `taskpadPath`
- `patch.content`: Valid unified-diff
- `applyHint`: Human-readable apply instructions

#### Canonical Fallback Flow

**Step 1: Preflight check** (via `taskpad:write-preflight`)

```bash
bun run taskpad:write-preflight -- --taskpad "/absolute/path/to/TASKPAD.md"
```

Expected output includes:
- `writable: true|false`
- `reasonCode`: One of `MUTATOR_PREFLIGHT_OK`, `MUTATOR_PERMISSION_*`, etc.
- `mode`: `direct-write|fallback-artifact|error`
- `permissionClass`: `none|permission-denied|non-permission`

**Step 2: Mutator execution with fallback**

When a mutator runs and `preflight.mode` is `fallback-artifact`:

1. Mutator generates a deterministic artifact JSON file
2. Artifact is written to `artifacts/<mutator-name>/<taskpad-basename>.<mutator-name>.patch.json`
3. Mutator exits with code 0 (success, but using artifact path)
4. CLI output includes:
   - `artifactPath`: Path to generated artifact
   - `preflight.*`: Preflight metadata
   - `status`: `fallback`

**Step 3: Apply fallback artifact** (via `taskpad:apply-fallback`)

```bash
# Auto-ideation artifact (single-file patch)
bun run taskpad:apply-fallback -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --artifact "/absolute/path/to/taskpad-fallback-artifact.json"

# Plan-seed artifact (dual-file patch)
bun run taskpad:apply-fallback -- \
  --taskpad "/absolute/path/to/TASKPAD.md" \
  --plan IMPLEMENTATION_PLAN.md \
  --artifact "/absolute/path/to/taskpad-plan-seed-artifact.json"
```

**Validation order (deterministic, pre-write):**
1. Parse artifact JSON → validate schema/version/kind
2. Validate CLI paths match artifact paths
3. Validate target TASKPAD exists and is readable
4. Validate SHA-256 hash matches `taskpadSha256`
5. Validate unified-diff format and simulate apply in-memory
6. Write atomically (temp file + rename)

**Output status matrix:**

| Status | Reason Code | Exit Code | Description |
|--------|-------------|------------|-------------|
| `applied` | `null` | 0 | Valid artifact, patch applied, atomic write succeeded |
| `noop` | `null` | 0 | Valid artifact, hash matches, diff already reflected |
| `rejected` | `ERR_*` | 1 | Any parse/schema/path/hash/patch/write failure |

**Error codes:**
- `ERR_ARTIFACT_PARSE` — Artifact file not found or invalid JSON
- `ERR_ARTIFACT_SCHEMA` — Required fields missing or invalid types
- `ERR_ARTIFACT_VERSION_UNSUPPORTED` — Unsupported artifact version
- `ERR_TASKPAD_PATH_MISMATCH` — CLI `--taskpad` does not match artifact paths
- `ERR_TASKPAD_NOT_FOUND` — Target TASKPAD does not exist
- `ERR_TASKPAD_HASH_MISMATCH` — Current TASKPAD hash does not match artifact
- `ERR_PATCH_FORMAT_INVALID` — Unified diff is malformed
- `ERR_PATCH_APPLY_FAILED` — Diff does not match current file state
- `ERR_WRITE_FAILED` — Atomic write failed

#### Idempotency Guarantees

- Re-running with the same artifact produces identical output (deterministic).
- Re-run after successful apply returns `status="noop"` (no duplicate changes).
- Re-run after TASKPAD drift (hash mismatch) returns `status="rejected"` with `ERR_TASKPAD_HASH_MISMATCH`.
- Best-effort merge/coercion is forbidden — only exact pre-image matches apply.

#### Exit Semantics

- Exit `0` when mode is `direct-write` or `fallback-artifact`.
- Exit non-zero when mode is `error`.
- Non-zero exits MUST still emit full machine-readable output.

**For full contract documentation**, see:
- `tools/lib/taskpad-mutator-contract.ts` — Shared contract implementation
- `tools/taskpad-write-preflight.ts` — Preflight probe implementation
- `tools/taskpad-apply-fallback.ts` — Artifact validation and apply implementation
- `docs/quality/taskpad-auto-ideation.md` — Auto-ideation-specific contract

### Pilot Observability Commands

Pilot outreach analysis tools for response timing and conversion metrics:

```bash
# Analyze pilot response latency by channel/CTA variant
bun run pilot:latency -- \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --format json

# Alternative: run directly via tools path
bun run tools/pilot-latency.ts -- \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --format json

# Human-readable output
bun run pilot:latency -- \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --format human
```

**Output includes:**
- Batch-level summary (total sent, replied, no-reply, cold-aged)
- Latency metrics: `medianHoursToFirstReply`, `p90HoursToFirstReply`, `meanHoursToFirstReply`
- Conversion metrics: `followupConversionRate`, follow-up counts
- Per-channel breakdown with reply rates and latency
- Per-CTA variant breakdown (when CTA data is available)

**Required input format:**
- Run sheet: Markdown table with frontmatter `artifact: pilot-run-sheet`, columns for Recipient Handle, Channel, Send Status, Sent Timestamp (ISO-8601), Artifact Link, and optional CTA Variant
- Response log: Markdown table with frontmatter `artifact: pilot-response-log`, columns for Recipient, Source Channel, workflow/objection/decision fields, and Response State

**Verification:**
```bash
# Run against production pilot data
bun run pilot:latency -- \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --format json

# Run against test fixtures
bun run pilot:latency -- \
  --run-sheet tests/tools/fixtures/pilot-latency-mixed.run-sheet.md \
  --responses tests/tools/fixtures/pilot-latency-mixed.responses.md \
  --format json

# Run unit tests for latency analyzer
bun test tests/tools/pilot-latency.test.ts
```

**Error codes:**
- Exit 1: Invalid run sheet (missing/invalid frontmatter, table structure, or data)
- Exit 2: Invalid response log (missing/invalid frontmatter, table structure, or data)
- Exit 3: Invalid timestamp format (expected ISO-8601 with Z suffix)
- Exit 4: Recipient mismatch (response log contains recipient not in run sheet)
- Exit 5: Duplicate recipient in run sheet
- Exit 6: No sent rows in run sheet
- Exit 7: Channel mismatch (recipient's channel differs between run sheet and response log)

#### Pilot Event Log (`pilot:rebuild`)

The pilot event log is an append-only source of truth for all pilot outreach lifecycle events. It enables deterministic rebuild of `pilot-run-sheet.md` and `pilot-response-log.md` artifacts, eliminating manual dual-edit drift risk.

**Contract documentation:** `docs/distribution/first-pilot-2026-02/pilot-event-log.md`

**Event types:** `SEND_OUTREACH`, `SEND_FOLLOWUP`, `RECEIVE_REPLY`, `UPDATE_DECISION`, `UPDATE_WTP`, `UPDATE_OBJECTION`, `MARK_FAILED`, `MARK_BLOCKED`

**Row key format:** `<eventType>-<recipientHandle>-<sequence>` (e.g., `SEND_OUTREACH-pilot_alpha-0001`)

**Drift detection rule IDs:**
- `ROW_TIMESTAMP_DRIFT` — Reconstructed timestamp differs from artifact
- `MISSING_EVENT` — Artifact row has no corresponding event in log
- `INVALID_TRANSITION` — Event violates lifecycle state machine

**Usage (planned):**
```bash
# Rebuild run sheet and response log from event log
bun run pilot:rebuild -- \
  --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md

# Check for drift between event log and artifacts
bun run pilot:rebuild -- \
  --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --check
```

#### Pilot Reply Ingestion Contract (`pilot:ingest-replies`)

The `pilot:ingest-replies` command reads NDJSON exports of raw replies and deterministically upserts them into `pilot-response-log.md` and `pilot-event-log.md`. This contract defines the expected input schema, normalization rules, and row-level diagnostics.

**Required NDJSON keys:**

| Key | Type | Description |
|-----|------|-------------|
| `messageId` | string | Immutable unique identifier for the reply (used for deduplication) |
| `recipientHandle` | string | Handle/identifier matching a recipient in existing pilot artifacts |
| `timestamp` | string | ISO-8601 timestamp with Z suffix (e.g., `2026-02-28T14:32:00Z`) |
| `channel` | enum | Communication channel (see enum mapping below) |
| `workflowSentence` | string | One-sentence clipping/retrieval workflow context from recipient |

**Optional fields:**

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `decision` | enum | `pending` | Next-step decision (see enum mapping below) |
| `objectionType` | enum \| null | `null` | Objection category if expressed |
| `wtp` | number \| null | `null` | Willingness-to-pay signal in $/mo |
| `wtpSource` | enum | `"inferred"` | Source of WTP signal (see enum mapping below) |
| `rationale` | string \| null | `null` | Decision rationale text |
| `ctaVariant` | string \| null | `null` | CTA variant identifier if known |
| `artifactLink` | string \| null | `null` | Link to clipping artifact if referenced |

**Enum mapping:**

| Enum | Valid Values |
|------|--------------|
| `channel` | `"X DM"`, `"Discord DM"`, `"Email"` |
| `decision` | `"advance"`, `"nurture"`, `"disqualify"`, `"pending"` |
| `objectionType` | `"trust"`, `"price"`, `"workflow-fit"`, `"missing-feature"`, `"timing"`, `"other"`, `null` |
| `wtpSource` | `"explicit"`, `"inferred"`, `"demo-response"` |

**Stable defaulting rules:**

| Scenario | Default Behavior |
|----------|------------------|
| Missing `decision` | Set to `"pending"` |
| Missing `objectionType` | Set to `null` (no objection recorded) |
| Missing `wtp` | Set to `null` (no WTP signal) |
| Missing `wtpSource` | Set to `"inferred"` (only applies when `wtp` is present) |
| Missing `rationale` | Set to auto-generated message: `"Reply received [timestamp]; awaiting decision."` |
| Missing `ctaVariant` | Set to `null` (not tracked) |
| Missing `artifactLink` | Set to `null` (not tracked) |
| Invalid `channel` | Row fails with `INVALID_CHANNEL` (no default fallback) |
| Invalid `decision` | Row fails with `INVALID_DECISION_STATE` (no default fallback) |
| Invalid `objectionType` | Row fails with `INVALID_OBJECTION_TYPE` (no default fallback) |

**Row-level diagnostics schema:**

Each input row is validated and may emit a diagnostic entry in the output envelope. The `ruleId` field is machine-readable and stable across reruns.

| Rule ID | Severity | Condition | Resolution |
|---------|----------|-----------|------------|
| `UNKNOWN_RECIPIENT` | error | `recipientHandle` not found in existing pilot artifacts (run-sheet or event-derived recipient set) | Add recipient to pilot artifacts or correct the handle |
| `DUPLICATE_MESSAGE_ID` | suppressed | `messageId` already exists in event history or current batch | Row is suppressed (not an error; tracked in `suppressed` count) |
| `INVALID_DECISION_STATE` | error | `decision` value is not in valid enum set | Correct to one of: `advance`, `nurture`, `disqualify`, `pending` |
| `INVALID_CHANNEL` | error | `channel` value is not in valid enum set | Correct to one of: `X DM`, `Discord DM`, `Email` |
| `INVALID_OBJECTION_TYPE` | error | `objectionType` is non-null and not in valid enum set | Correct to one of: `trust`, `price`, `workflow-fit`, `missing-feature`, `timing`, `other`, or set to `null` |
| `INVALID_WTP_VALUE` | error | `wtp` is present but not a number or `null` | Set `wtp` to a numeric value or `null` |
| `INVALID_WTP_SOURCE` | error | `wtpSource` is present but not in valid enum set | Correct to one of: `explicit`, `inferred`, `demo-response` |
| `INVALID_TIMESTAMP` | error | `timestamp` is not valid ISO-8601 with Z suffix | Use format: `YYYY-MM-DDTHH:MM:SSZ` |
| `MALFORMED_ROW` | error | Row is not valid JSON or missing required keys | Fix JSON syntax and ensure all required keys are present |
| `MISSING_REQUIRED_KEY` | error | One or more required keys (`messageId`, `recipientHandle`, `timestamp`, `channel`, `workflowSentence`) are missing | Add missing required keys |

**Deterministic output envelope:**

```json
{
  "status": "ok|partial|error",
  "processed": 10,
  "upserts": 8,
  "suppressed": 1,
  "errors": [
    {
      "rowIndex": 3,
      "ruleId": "UNKNOWN_RECIPIENT",
      "message": "Recipient handle 'unknown_user' not found in pilot artifacts",
      "input": { "messageId": "msg-003", "recipientHandle": "unknown_user", "..." }
    }
  ],
  "timestamp": "2026-03-01T12:00:00Z"
}
```

**Usage:**

```bash
# Ingest replies from NDJSON export
bun run pilot:ingest-replies -- \
  --input tests/tools/fixtures/pilot-replies.ndjson \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \
  --format json

# Human-readable output
bun run pilot:ingest-replies -- \
  --input tests/tools/fixtures/pilot-replies.ndjson \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \
  --format human

# Test duplicate detection with existing message IDs
bun run pilot:ingest-replies -- \
  --input tests/tools/fixtures/pilot-replies-duplicates.ndjson \
  --responses tests/tools/fixtures/pilot-ingest-replies-base.responses.md \
  --events tests/tools/fixtures/pilot-ingest-replies-base.events.md \
  --format json

# Test invalid decision state detection
bun run pilot:ingest-replies -- \
  --input tests/tools/fixtures/pilot-replies-invalid-decision.ndjson \
  --responses tests/tools/fixtures/pilot-ingest-replies-base.responses.md \
  --events tests/tools/fixtures/pilot-ingest-replies-base.events.md \
  --format json
```

**Verification:**

```bash
# Run unit tests for reply ingestion
bun test tests/tools/pilot-ingest-replies.test.ts

# Smoke test against real batch artifacts
bun run pilot:ingest-replies -- \
  --input tests/tools/fixtures/pilot-replies.ndjson \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \
  --format json

# Verify downstream rebuild consistency
bun run pilot:rebuild -- \
  --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --check
```

**Smoke/E2E validation evidence:**
- See `docs/distribution/first-pilot-2026-02/pilot-ingest-replies-smoke-validation.md` for real batch ingestion replayability verification

**Idempotency guarantees:**
- Re-running with the same input produces identical output (deterministic suppression)
- `DUPLICATE_MESSAGE_ID` rows are suppressed, not errored, enabling safe replay
- Upsert order is stable (sorted by `timestamp`, then `messageId`)
- Partial failures (some rows error) do not mutate artifacts; all-or-nothing semantics

#### Pilot Sample Gap Planner (`pilot:sample-gap-planner`)

The `pilot:sample-gap-planner` command compares live pilot artifacts against brief thresholds and emits deterministic next-action planning fields. This enables operators to answer: how many sends remain, how many additional batches are needed, what channel mix to send next, and by when.

**Usage:**

```bash
# Analyze sample gap and get next-action recommendations
bun run pilot:sample-gap-planner -- \
  --brief OFFER_BRIEF.md \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --batch-size 3 \
  --format json

# Human-readable output
bun run pilot:sample-gap-planner -- \
  --brief OFFER_BRIEF.md \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --batch-size 3 \
  --format human
```

**CLI arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `--brief <path>` | ✅ | Path to OFFER_BRIEF.md file containing decision-grade thresholds |
| `--run-sheet <path>` | ✅ | Path to pilot-run-sheet.md file with send tracking data |
| `--responses <path>` | ✅ | Path to pilot-response-log.md file with response state data |
| `--batch-size <n>` | ❌ | Number of sends per batch (default: 3) |
| `--format <format>` | ❌ | Output format: "json" or "human" (default: json) |
| `--now <timestamp>` | ❌ | ISO-8601 timestamp for deterministic testing (default: current time) |
| `--help, -h` | ❌ | Show help message |

**Output schema:**

```json
{
  "status": "ok|error",
  "threshold": {
    "minSent": 10,
    "minReplies": 3,
    "source": "OFFER_BRIEF.md#pilot-cta"
  },
  "currentState": {
    "totalSent": 7,
    "totalReplied": 2,
    "pending": 3,
    "coldAged": 1,
    "byChannel": {
      "X DM": { "sent": 3, "replied": 1 },
      "Discord DM": { "sent": 2, "replied": 1 },
      "Email": { "sent": 2, "replied": 0 }
    }
  },
  "gap": {
    "remainingSent": 3,
    "requiredBatches": 1,
    "channelMix": [
      { "channel": "Email", "count": 2 },
      { "channel": "X DM", "count": 1 }
    ],
    "latestSendBy": "2026-03-02T12:00:00Z"
  },
  "thresholdMet": false,
  "recommendation": "SEND_MORE",
  "timestamp": "2026-03-01T12:00:00Z"
}
```

**Field semantics:**

| Field | Type | Description |
|-------|------|-------------|
| `status` | enum | `"ok"` if parsing succeeded, `"error"` if validation failed |
| `threshold.minSent` | number | Minimum sends required from OFFER_BRIEF.md (e.g., 10 for "first 10 qualified pilot conversations") |
| `threshold.minReplies` | number | Minimum replies required from OFFER_BRIEF.md (e.g., 3 for ">=3 correctly formatted PILOT YES replies") |
| `threshold.source` | string | Canonical reference to threshold source in OFFER_BRIEF.md |
| `currentState.totalSent` | number | Total sent count from run sheet (rows with Send Status = "sent") |
| `currentState.totalReplied` | number | Total replied count from response log (rows with Response State ≠ "no response yet") |
| `currentState.pending` | number | Recipients awaiting first reply (Response State = "no response yet") |
| `currentState.coldAged` | number | Pending recipients >72 hours since send (cold-aged threshold) |
| `currentState.byChannel` | object | Per-channel breakdown of sent/replied counts (keys sorted alphabetically) |
| `gap.remainingSent` | number | **Exact calculation**: `max(0, threshold.minSent - currentState.totalSent)` |
| `gap.requiredBatches` | number | **Exact calculation**: `ceil(gap.remainingSent / batchSize)` (0 if threshold met) |
| `gap.channelMix` | array | **Deterministic recommendation** for next batch channel distribution (sorted by channel name, then count) |
| `gap.channelMix[].channel` | string | Channel identifier: "X DM", "Discord DM", or "Email" |
| `gap.channelMix[].count` | number | Recommended send count for this channel in next batch |
| `gap.latestSendBy` | string | **ISO-8601 timestamp** for when next batch should be sent (based on batch cadence; null if threshold met) |
| `thresholdMet` | boolean | `true` if `totalSent >= minSent` AND `totalReplied >= minReplies` |
| `recommendation` | enum | `"SEND_MORE"` if threshold not met, `"THRESHOLD_MET"` if threshold met, `"HOLD"` if awaiting replies |

**Deterministic rounding and ordering rules:**

1. **Rounding**:
   - All numeric values are integers (no rounding needed)
   - `requiredBatches` uses ceiling function: `ceil(remainingSent / batchSize)`
   - Example: `remainingSent = 5`, `batchSize = 3` → `requiredBatches = 2`

2. **Channel ordering**:
   - `currentState.byChannel` keys are sorted alphabetically (case-sensitive)
   - `gap.channelMix` array is sorted by channel name, then by count (descending)
   - Example: `["Discord DM", "Email", "X DM"]` (alphabetical)

3. **Timestamp normalization**:
   - All timestamps are ISO-8601 with Z suffix: `YYYY-MM-DDTHH:MM:SSZ`
   - `gap.latestSendBy` is calculated using deterministic batch cadence logic (see **Batch cadence assumptions** below)
   - Milliseconds are stripped (second precision)

4. **Byte-stable JSON output**:
   - Repeated runs with same inputs produce identical JSON (except `timestamp` field)
   - Object keys are sorted alphabetically
   - Array elements maintain deterministic order
   - No runtime-dependent fields except `timestamp`

**Channel mix recommendation algorithm:**

The `channelMix` field provides a deterministic recommendation for the next batch's channel distribution:

1. **Threshold not met** (`remainingSent > 0`):
   - Calculate per-channel reply rates from current state
   - Prioritize channels with lower reply rates (need more evidence)
   - Distribute `min(remainingSent, batchSize)` sends across channels
   - Tie-break by alphabetical channel name
   - Result is deterministic for same input state

2. **Threshold met** (`remainingSent = 0`):
   - `channelMix` is empty array `[]`
   - `latestSendBy` is `null`
   - Recommendation is `"THRESHOLD_MET"`

3. **Example calculation**:
   - Current state: X DM (3 sent, 1 replied), Discord DM (2 sent, 1 replied), Email (2 sent, 0 replied)
   - Reply rates: X DM (33%), Discord DM (50%), Email (0%)
   - Batch size: 3, remaining sends: 3
   - Priority: Email (lowest rate), X DM (middle), Discord DM (highest)
   - Recommendation: Email (2), X DM (1) → fills batch of 3

**Batch cadence assumptions (TP007):**

The `latestSendBy` timestamp is calculated using deterministic batch cadence logic:

1. **Default cadence**: 24 hours between consecutive batches
   - This assumes operators send one batch per day to maintain decision-grade evidence accumulation pace
   - The cadence is defined by `DEFAULT_BATCH_CADENCE_HOURS = 24` in the tool

2. **Calculation formula**:
   ```
   latestSendBy = max(now, latestSentTimestamp) + batchCadenceHours
   ```
   - `now`: Current timestamp (or `--now` argument for deterministic testing)
   - `latestSentTimestamp`: Most recent send timestamp from the run sheet (extracted from `Sent Timestamp` column)
   - `batchCadenceHours`: Default 24 hours

3. **Determinism guarantees**:
   - If the last send was in the past, uses `now` as baseline (prevents unrealistic past deadlines)
   - If the last send was in the future (scheduled), uses that timestamp as baseline
   - Output is identical for same inputs when using `--now` flag

4. **Threshold-met behavior**:
   - When both sent AND reply thresholds are met, `latestSendBy` is `null`
   - No deadline is needed when no more sends are required

5. **Example calculations**:
   - Last send: `2026-02-27T10:00:00Z`, now: `2026-03-01T12:00:00Z`
     - Uses `now` (later) → `latestSendBy = 2026-03-02T12:00:00Z`
   - Last send: `2026-03-01T14:00:00Z` (future scheduled), now: `2026-03-01T12:00:00Z`
     - Uses last send (later) → `latestSendBy = 2026-03-02T14:00:00Z`
   - No sends yet: Uses `now` → `latestSendBy = now + 24h`

**Threshold parsing from OFFER_BRIEF.md:**

The planner extracts decision-grade thresholds from the following OFFER_BRIEF.md sections:

1. **Pilot CTA → Success signal**:
   - Pattern: "First outreach batch \((\d+) qualified.*\) yields >=(\d+) .*replies"
   - Extracts: `minSent` (batch size), `minReplies` (reply threshold)
   - Example: "First outreach batch (10 qualified ICP contacts) yields >=3 correctly formatted PILOT YES replies"
     - `minSent = 10`
     - `minReplies = 3`

2. **Pricing Hypothesis → Validation signal**:
   - Pattern: "In first (\d+) qualified.*>= (\d+).*commitments"
   - Provides secondary validation (not used for gap calculation)
   - Used for pricing verdict, not sample gap planning

3. **Validation failures**:
   - If threshold patterns are missing or ambiguous, command fails with `AMBIGUOUS_THRESHOLD` error
   - If OFFER_BRIEF.md file is malformed, command fails with `INVALID_BRIEF` error

**Error codes:**

| Exit Code | Rule ID | Condition |
|-----------|---------|-----------|
| 1 | `INVALID_BRIEF` | OFFER_BRIEF.md file not found, unreadable, or missing required sections |
| 2 | `INVALID_RUN_SHEET` | Run sheet file not found, invalid frontmatter, or malformed table |
| 3 | `INVALID_RESPONSE_LOG` | Response log file not found, invalid frontmatter, or malformed table |
| 4 | `AMBIGUOUS_THRESHOLD` | Threshold patterns not found or ambiguous in OFFER_BRIEF.md |
| 5 | `INVALID_BATCH_SIZE` | Batch size is not a positive integer |
| 6 | `RECIPIENT_MISMATCH` | Response log contains recipient not present in run sheet |
| 7 | `DUPLICATE_RECIPIENT` | Run sheet contains duplicate recipient handles |
| 8 | `CALCULATION_ERROR` | Internal calculation error (should not occur with valid inputs) |

**Deterministic output guarantee:**

- Running the command multiple times with the same inputs produces byte-identical JSON output (except `timestamp` field)
- Use `--now` flag for fully deterministic testing: `--now 2026-03-01T12:00:00Z`
- All sorting uses stable algorithms (alphabetical for strings, ascending for numbers)
- No random or runtime-dependent values in calculation logic

**Verification:**

```bash
# Run against production pilot data
bun run pilot:sample-gap-planner -- \
  --brief OFFER_BRIEF.md \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --batch-size 3 \
  --format json

# Run against test fixtures (under-threshold scenario)
bun run pilot:sample-gap-planner -- \
  --brief tests/tools/fixtures/pilot-sample-gap-planner-under-threshold.brief.md \
  --run-sheet tests/tools/fixtures/pilot-sample-gap-planner-under-threshold.run-sheet.md \
  --responses tests/tools/fixtures/pilot-sample-gap-planner-under-threshold.responses.md \
  --batch-size 3 \
  --format json

# Run against test fixtures (threshold-met scenario)
bun run pilot:sample-gap-planner -- \
  --brief tests/tools/fixtures/pilot-sample-gap-planner-threshold-met.brief.md \
  --run-sheet tests/tools/fixtures/pilot-sample-gap-planner-threshold-met.run-sheet.md \
  --responses tests/tools/fixtures/pilot-sample-gap-planner-threshold-met.responses.md \
  --batch-size 3 \
  --format json

# Run unit tests for sample gap planner
bun test tests/tools/pilot-sample-gap-planner.test.ts
```

**Acceptance criteria:**

- Command returns deterministic JSON output for under-threshold scenario with:
  - `remainingSent > 0`
  - `requiredBatches >= 1`
  - Non-empty `channelMix` array with deterministic ordering
  - Non-null `latestSendBy` timestamp
- Command returns deterministic JSON output for threshold-met scenario with:
  - `remainingSent = 0`
  - `requiredBatches = 0`
  - Empty `channelMix` array
  - `null` `latestSendBy` value
  - `thresholdMet = true`
  - `recommendation = "THRESHOLD_MET"`
- Repeated runs with same inputs produce byte-identical JSON (except `timestamp` field)
- Error conditions fail with specific exit codes and actionable error messages

**Smoke/E2E validation evidence:**
- See `docs/distribution/first-pilot-2026-02/pilot-sample-gap-planner-smoke-validation.md` for real pilot artifact verification and determinism testing

#### Pilot Price Signal Analyzer (`pilot:price-signal`)

The `pilot:price-signal` command analyzes pilot response artifacts to compute deterministic price-bucket telemetry and recommend the next anchor price point for testing. This transforms scattered WTP snippets and `PILOT YES` acceptance trends into concrete, actionable pricing experiment recommendations.

**Contract documentation:** This section defines the complete output contract and deterministic bucket policy.

**Usage:**

```bash
# Analyze price signals from pilot artifacts
bun run pilot:price-signal -- \
  --root docs/distribution \
  --brief OFFER_BRIEF.md \
  --format json

# Human-readable output
bun run pilot:price-signal -- \
  --root docs/distribution \
  --brief OFFER_BRIEF.md \
  --format human
```

**CLI arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `--root <path>` | ✅ | Path to distribution root containing pilot batch directories (e.g., `docs/distribution`) |
| `--brief <path>` | ✅ | Path to OFFER_BRIEF.md file containing pricing constraints ($8-$19 range and $12 anchor context) |
| `--format <format>` | ❌ | Output format: "json" or "human" (default: json) |
| `--help, -h` | ❌ | Show help message |

**Deterministic Output Schema:**

```json
{
  "status": "ok|error",
  "inputs": {
    "rootPath": "/path/to/distribution",
    "briefPath": "/path/to/OFFER_BRIEF.md",
    "batchesAnalyzed": ["first-pilot-2026-02"],
    "totalResponses": 10
  },
  "telemetry": {
    "priceBucketCounts": {
      "$8-$11": 3,
      "$12": 4,
      "$13-$15": 2,
      "$16-$19": 1
    },
    "pilotYesRateByBucket": {
      "$8-$11": { "yes": 2, "total": 3, "rate": 0.667 },
      "$12": { "yes": 3, "total": 4, "rate": 0.75 },
      "$13-$15": { "yes": 1, "total": 2, "rate": 0.5 },
      "$16-$19": { "yes": 0, "total": 1, "rate": 0.0 }
    },
    "medianWTP": 12,
    "objectionMix": {
      "trust": 2,
      "price": 3,
      "workflow-fit": 1,
      "missing-feature": 0,
      "timing": 1,
      "other": 1
    }
  },
  "recommendation": {
    "recommendedNextAnchor": 12,
    "anchorContext": "baseline",
    "rationale": "$12 anchor maintains highest PILOT YES rate (75%) among tested buckets with sufficient sample size (n=4)",
    "precedenceChain": ["highest_yes_rate", "sample_size", "anchor_familiarity"]
  },
  "confidence": {
    "band": "medium",
    "level": 0.65,
    "minimumSampleMet": true,
    "sampleSize": 10,
    "reasoning": "10 responses above minimum threshold (n>=5) with mixed bucket distribution; confidence constrained by low sample in $13-$15 and $16-$19 buckets"
  },
  "diagnostics": [],
  "timestamp": "2026-03-01T12:00:00Z"
}
```

**Field semantics:**

| Field | Type | Description |
|-------|------|-------------|
| `status` | enum | `"ok"` if analysis succeeded, `"error"` if validation failed |
| `inputs.rootPath` | string | Canonical path to distribution root |
| `inputs.briefPath` | string | Canonical path to OFFER_BRIEF.md |
| `inputs.batchesAnalyzed` | string[] | List of batch directories processed (sorted alphabetically) |
| `inputs.totalResponses` | number | Total response rows with valid WTP values |
| `telemetry.priceBucketCounts` | object | Count of responses in each price bucket (keys sorted by price) |
| `telemetry.pilotYesRateByBucket` | object | Per-bucket `PILOT YES` acceptance rate with `{yes, total, rate}` entries |
| `telemetry.medianWTP` | number | Median WTP across all valid responses (rounded to nearest integer) |
| `telemetry.objectionMix` | object | Count of each objection type (keys sorted alphabetically) |
| `recommendation.recommendedNextAnchor` | number | Recommended anchor price point in $/mo (must be within OFFER_BRIEF.md range) |
| `recommendation.anchorContext` | enum | `"baseline"` ($12 anchor), `"lower"` (<$12), `"higher"` (>$12) |
| `recommendation.rationale` | string | One-sentence explanation of recommendation logic |
| `recommendation.precedenceChain` | string[] | Ordered list of rules applied (highest priority first) |
| `confidence.band` | enum | `"low"`, `"medium"`, `"high"` - confidence level in recommendation |
| `confidence.level` | number | Numeric confidence score (0.0-1.0) |
| `confidence.minimumSampleMet` | boolean | Whether minimum sample size threshold is met |
| `confidence.sampleSize` | number | Total sample size used for confidence calculation |
| `confidence.reasoning` | string | Explanation of confidence band determination |
| `diagnostics` | array | Validation warnings/errors (empty if all WTP values valid) |
| `timestamp` | string | ISO-8601 timestamp with Z suffix |

---

### Deterministic Bucket Policy

This section defines the deterministic bucket boundaries, tie-break ordering, rounding rules, recommendation precedence, and confidence-band semantics for `pilot:price-signal`.

#### Bucket Boundaries

Price buckets partition the **OFFER_BRIEF.md test range ($8-$19/mo)** into discrete groups for analysis:

| Bucket | Range | Description |
|--------|-------|-------------|
| `$8-$11` | 8 ≤ WTP < 12 | Below anchor price |
| `$12` | 11.5 ≤ WTP < 12.5 | **Anchor price point** (rounds to 12) |
| `$13-$15` | 12.5 ≤ WTP < 15.5 | Above anchor (mid-high) |
| `$16-$19` | 15.5 ≤ WTP ≤ 20 | Above anchor (high) |

**Deterministic assignment rules:**

1. **Rounding to nearest integer**: Raw WTP values are rounded to the nearest $/mo before bucket assignment.
   - Example: `11.4` → `11` → `$8-$11` bucket
   - Example: `11.6` → `12` → `$12` bucket

2. **Anchor bucket rounding**: Values within ±0.5 of $12 round to the anchor bucket.
   - Range: `11.5 ≤ WTP < 12.5` → `$12` bucket

3. **Boundary handling**:
   - Lower boundary: `WTP < 8` → validation error (`WTP_OUT_OF_RANGE`)
   - Upper boundary: `WTP > 19` → validation error (`WTP_OUT_OF_RANGE`)
   - Bucket floors are inclusive, ceilings are exclusive (except top bucket)

4. **Out-of-range handling**: WTP values below $8 or above $19 fail validation with deterministic rule ID `WTP_OUT_OF_RANGE` and row pointer.

#### Tie-Break Ordering

When multiple buckets have identical metrics (e.g., equal `PILOT YES` rates), tie-break rules ensure deterministic recommendations:

**Tie-break precedence (highest to lowest priority):**

1. **Sample size**: Prefer bucket with higher total responses.
   - Rationale: More evidence = more reliable signal.

2. **Anchor familiarity**: Prefer `$12` anchor bucket over others.
   - Rationale: Anchor has established positioning and comparison baseline.

3. **Proximity to anchor**: Prefer bucket closer to $12 anchor.
   - Order: `$12` > `$13-$15` > `$8-$11` > `$16-$19`
   - Rationale: Smaller price distance reduces user friction.

4. **Alphabetical bucket label**: Final tie-break on bucket label string.
   - Rationale: Ensures deterministic output when all else is equal.

**Example tie-break scenarios:**

```
Scenario 1: Equal PILOT YES rate
- $8-$11: 2/3 (67%), n=3
- $12: 2/3 (67%), n=3
→ Winner: $12 (rule 2: anchor familiarity)

Scenario 2: Equal rate, different sample sizes
- $13-$15: 3/4 (75%), n=4
- $16-$19: 3/4 (75%), n=3
→ Winner: $13-$15 (rule 1: higher sample size)

Scenario 3: All metrics equal
- $8-$11 and $13-$15 both 50% rate, n=2 each
→ Winner: $13-$15 (rule 3: closer to anchor)
```

#### Rounding Rules

All numeric outputs follow deterministic rounding policies:

| Field | Rounding Rule | Example |
|-------|---------------|---------|
| `medianWTP` | Round to nearest integer (standard rounding) | `12.4` → `12`, `12.5` → `13` |
| `pilotYesRateByBucket[].rate` | Round to 3 decimal places | `0.6666...` → `0.667` |
| `confidence.level` | Round to 2 decimal places | `0.6543...` → `0.65` |

**Edge case handling:**
- Empty bucket: `rate = 0.0` (not `NaN` or `null`)
- Single response: `rate = 1.0` if `PILOT YES`, else `0.0`

#### Recommendation Precedence

The recommendation engine applies rules in priority order to select `recommendedNextAnchor`:

**Precedence chain (evaluated in order):**

1. **Validation gate**: All WTP values must be within OFFER_BRIEF.md range ($8-$19).
   - Failure: Emit `WTP_OUT_OF_RANGE` error and halt.

2. **Minimum sample gate**: At least `n >= 5` valid WTP responses required.
   - Below threshold: Set `confidence.band = "low"` and `minimumSampleMet = false`.
   - Recommendation still generated but flagged as preliminary.

3. **Highest `PILOT YES` rate**: Select bucket with highest acceptance rate.
   - Tie-handled by tie-break ordering rules.

4. **Sample size threshold**: Require bucket with `n >= 3` responses.
   - If no bucket meets threshold, select highest-rate bucket with most responses.
   - Flag in `rationale` as "preliminary signal".

5. **Anchor context**: Determine `anchorContext` enum value.
   - `$12` → `"baseline"`
   - `$8-$11` → `"lower"`
   - `$13-$15` or `$16-$19` → `"higher"`

**Output `precedenceChain` field:**

The `precedenceChain` array records which rules were applied:

```json
{
  "recommendedNextAnchor": 12,
  "precedenceChain": ["highest_yes_rate", "sample_size", "anchor_familiarity"]
}
```

Possible chain entries:
- `validation_gate` - All WTP values passed range validation
- `minimum_sample_gate` - Minimum sample size threshold met
- `highest_yes_rate` - Selected bucket with highest PILOT YES rate
- `sample_size` - Applied sample size threshold
- `anchor_familiarity` - Preferred anchor bucket on tie
- `proximity_to_anchor` - Preferred bucket closer to $12 on tie
- `alphabetical_label` - Final tie-break on bucket label

#### Confidence-Band Semantics

Confidence bands quantify reliability of the recommendation based on sample size and bucket distribution:

| Band | Level | Description | Minimum Sample | Bucket Distribution |
|------|-------|-------------|----------------|-------------------|
| `low` | 0.0-0.49 | Preliminary signal, insufficient evidence | `n < 5` | Any distribution |
| `medium` | 0.5-0.74 | Moderate confidence, some evidence | `n >= 5` | ≥2 buckets with responses |
| `high` | 0.75-1.0 | High confidence, strong evidence | `n >= 10` | All buckets represented or dominant bucket `n >= 5` |

**Confidence calculation algorithm:**

```typescript
function calculateConfidence(totalResponses: number, bucketCounts: object): ConfidenceBand {
  // Rule 1: Minimum sample gate
  const minimumSampleMet = totalResponses >= 5;
  if (!minimumSampleMet) {
    return {
      band: "low",
      level: Math.min(0.49, totalResponses / 10),
      minimumSampleMet: false,
      reasoning: "Below minimum sample threshold (n<5); recommendation is preliminary"
    };
  }

  // Rule 2: Bucket distribution factor
  const bucketKeys = Object.keys(bucketCounts);
  const nonEmptyBuckets = bucketKeys.filter(k => bucketCounts[k] > 0).length;
  const distributionFactor = nonEmptyBuckets >= 2 ? 0.2 : 0.0;

  // Rule 3: Dominant bucket factor
  const maxCount = Math.max(...Object.values(bucketCounts));
  const dominantFactor = maxCount >= 5 ? 0.15 : 0.0;

  // Rule 4: Total sample factor
  const sampleFactor = Math.min(0.15, totalResponses / 100);

  // Base level starts at 0.5 for medium band
  let level = 0.5 + distributionFactor + dominantFactor + sampleFactor;

  // Cap at 1.0 for high band
  level = Math.min(1.0, level);

  // Determine band
  let band: "low" | "medium" | "high";
  if (level < 0.5) band = "low";
  else if (level < 0.75) band = "medium";
  else band = "high";

  return {
    band,
    level: Math.round(level * 100) / 100, // Round to 2 decimal places
    minimumSampleMet: true,
    sampleSize: totalResponses,
    reasoning: `${totalResponses} responses with ${nonEmptyBuckets} non-empty buckets; ${dominantFactor > 0 ? "dominant bucket present" : "no dominant bucket"}`
  };
}
```

**Deterministic guarantees:**

- Same input always produces same confidence band and level.
- `minimumSampleMet` is deterministic based on `totalResponses >= 5` threshold.
- Rounding to 2 decimal places ensures byte-stable JSON output.

**Low-data behavior:**

When `minimumSampleMet = false`:
- `confidence.band` is always `"low"`
- `confidence.level` is `totalResponses / 10` (capped at 0.49)
- `recommendation.rationale` includes "preliminary signal" warning
- Tool continues to emit recommendation (not an error) but flags low confidence

#### WTP Validation Rule IDs

Missing, non-numeric, or out-of-range WTP values fail with actionable deterministic rule IDs:

| Rule ID | Condition | Severity | Resolution |
|---------|-----------|----------|------------|
| `MISSING_WTP_VALUE` | Response row has no WTP field or value is empty/whitespace | error | Add WTP signal to response log or exclude row from analysis |
| `WTP_NOT_NUMERIC` | WTP field is present but not a valid number | error | Correct WTP to numeric value or exclude row |
| `WTP_OUT_OF_RANGE` | WTP value is outside OFFER_BRIEF.md allowed range ($8-$19) | error | Correct WTP to within range or verify if offer brief range needs adjustment |
| `WTP_NEGATIVE` | WTP value is negative (< 0) | error | Correct to positive value or exclude row |

**Diagnostics output:**

```json
{
  "diagnostics": [
    {
      "ruleId": "WTP_OUT_OF_RANGE",
      "recipient": "pilot_alpha",
      "wtpValue": 25,
      "message": "WTP value 25 is outside allowed range $8-$19 from OFFER_BRIEF.md",
      "rowReference": "docs/distribution/first-pilot-2026-02/pilot-response-log.md#row-2"
    }
  ]
}
```

**Error handling:**

- Individual row validation errors are collected in `diagnostics` array.
- Tool continues analysis if at least one valid WTP response exists.
- If all WTP values are invalid, `status = "error"` and exit code is non-zero.
- Tool does not mutate source pilot artifacts (read-only analysis).

#### Artifact Discovery

The `--root` argument specifies a directory containing one or more pilot batch directories:

```
docs/distribution/
├── first-pilot-2026-02/
│   ├── pilot-run-sheet.md
│   ├── pilot-response-log.md
│   └── pilot-batch-summary.md
└── second-pilot-2026-03/
    ├── pilot-run-sheet.md
    ├── pilot-response-log.md
    └── pilot-batch-summary.md
```

**Discovery rules:**

1. **Batch identification**: Subdirectories matching pattern `*-pilot-*` are treated as pilot batches.
2. **Deterministic ordering**: Batches are sorted alphabetically for consistent processing.
3. **Response extraction**: WTP signals are extracted from `pilot-response-log.md` tables in each batch.
4. **Aggregation**: All batches under `--root` are aggregated into combined telemetry.

**Smoke/E2E validation evidence:**
- See `docs/distribution/first-pilot-2026-02/pilot-price-signal-smoke-validation.md` for real pilot artifact verification and determinism testing

---

#### Pilot Reply Proof Index Contract (`pilot:response-proof`)

The `pilot-reply-proof-index.ndjson` file is an immutable evidence ledger that binds each non-`pending` response-log row to cryptographic proof of the original inbound message. This enables deterministic validation that pricing/hypothesis conclusions are grounded in tamper-evident source data.

**Schema: `pilot-reply-proof-index.ndjson`**

Each line is a JSON object with the following canonical fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `recipientKey` | string | ✅ | Canonical recipient identifier matching `pilot-response-log.md` Recipient column (normalized, no leading `@`) |
| `messageId` | string | ✅ | Immutable unique identifier for the inbound reply (must match `RECEIVE_REPLY` event payload `messageId`) |
| `sourceExportHash` | string | ✅ | SHA-256 hash of the source export file (e.g., inbox export JSON) that contained this reply, hex-encoded |
| `responseTimestamp` | string | ✅ | ISO-8601 timestamp with Z suffix of when the reply was received (normalized from source export) |
| `channel` | enum | ✅ | Communication channel: `"X DM"`, `"Discord DM"`, or `"Email"` |
| `provenance` | object | ❌ | Optional provenance metadata (see below) |

**Provenance metadata schema (optional):**

| Field | Type | Description |
|-------|------|-------------|
| `sourceFile` | string | Original export filename (e.g., `inbox-export-2026-02-28.json`) |
| `exportTimestamp` | string | ISO-8601 timestamp when the export was generated |
| `exportTool` | string | Tool used to generate export (e.g., `twitter-api-export`, `discord-chat-exporter`) |
| `rawMessageHash` | string | SHA-256 hash of the raw message payload before normalization |

**Canonical field contract:**

1. **Recipient key normalization**:
   - Strip leading `@` if present
   - Lowercase for case-insensitive matching
   - Must exactly match the Recipient column in `pilot-response-log.md` after normalization
   - Example: `@Pilot_Alpha` → `pilot_alpha`

2. **Immutable message ID**:
   - Must be unique across all proof records (no duplicates allowed)
   - Must match the `messageId` field in the corresponding `RECEIVE_REPLY` event in `pilot-event-log.md`
   - Deterministically derived from source export (e.g., Twitter snowflake ID, Discord message ID, Email Message-ID header)

3. **Source export hash**:
   - SHA-256 hash of the complete source export file (not individual messages)
   - Hex-encoded lowercase string (64 characters)
   - Enables verification that proof records derive from unmodified source exports
   - Multiple proof records may share the same `sourceExportHash` if from the same export batch

4. **Response timestamp normalization**:
   - Must be ISO-8601 with Z suffix: `YYYY-MM-DDTHH:MM:SSZ`
   - Derived from source export timestamp, converted to UTC
   - Milliseconds are stripped (second precision)
   - Must be within the time range of the source export

5. **Channel validation**:
   - Must be one of: `"X DM"`, `"Discord DM"`, `"Email"`
   - Must match the channel in the corresponding `RECEIVE_REPLY` event

**Duplicate handling rules:**

| Scenario | Behavior |
|----------|----------|
| Duplicate `messageId` in same file | Validation fails with `DUPLICATE_MESSAGE_ID_IN_PROOF_INDEX` |
| Same `messageId` as existing `RECEIVE_REPLY` event | Allowed (proof records bind to existing events) |
| Multiple records for same recipient | Allowed (recipient may have multiple replies) |
| `recipientKey` not in response log | Validation passes (proof may exist for pending recipient) |

**Deterministic mismatch rule IDs:**

| Rule ID | Condition | Severity |
|---------|-----------|----------|
| `MISSING_REPLY_PROOF` | Non-`pending` response-log row has no matching proof record | error |
| `RECIPIENT_MISMATCH` | Proof record `recipientKey` does not match response-log Recipient | error |
| `RESPONSE_TIMESTAMP_DRIFT` | Proof record `responseTimestamp` differs from response-log timestamp | error |
| `DUPLICATE_MESSAGE_ID_IN_PROOF_INDEX` | Same `messageId` appears multiple times in proof index | error |
| `INVALID_SOURCE_EXPORT_HASH` | `sourceExportHash` is not valid SHA-256 hex | error |
| `INVALID_RESPONSE_TIMESTAMP` | `responseTimestamp` is not valid ISO-8601 with Z suffix | error |
| `INVALID_CHANNEL` | `channel` is not in valid enum set | error |

**Example proof index entry:**

```json
{"recipientKey":"pilot_alpha","messageId":"msg_1234567890123456789","sourceExportHash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","responseTimestamp":"2026-02-28T14:32:00Z","channel":"X DM","provenance":{"sourceFile":"x-dm-export-2026-02-28.json","exportTimestamp":"2026-02-28T15:00:00Z","exportTool":"twitter-api-export"}}
```

**File location convention:**
- Proof index files should be colocated with the pilot batch artifacts
- Example: `docs/distribution/first-pilot-2026-02/pilot-reply-proof-index.ndjson`

**Usage (planned):**

```bash
# Validate response log against proof index
bun run pilot:response-proof -- \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --evidence docs/distribution/first-pilot-2026-02/pilot-reply-proof-index.ndjson \
  --format json

# Human-readable output
bun run pilot:response-proof -- \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --evidence docs/distribution/first-pilot-2026-02/pilot-reply-proof-index.ndjson \
  --format human
```

**Deterministic output envelope:**

```json
{
  "status": "pass|fail",
  "eligibleDecisions": 5,
  "validated": 5,
  "errors": [
    {
      "ruleId": "MISSING_REPLY_PROOF",
      "recipient": "pilot_alpha",
      "message": "No proof record found for non-pending decision row"
    }
  ],
  "timestamp": "2026-03-01T12:00:00Z"
}
```

**Acceptance criteria:**
- Every non-`pending` decision row in `pilot-response-log.md` must have exactly one matching proof record
- Matching is by normalized `recipientKey` + `messageId` alignment
- Pending rows are ignored (not counted in `eligibleDecisions`)
- Output is deterministic across reruns (stable ordering, stable rule emission)

### Manual acceptance (as-needed)
Manual acceptance checks are documented in `TEST_REQUIREMENTS.md` and should be run for extension UX/runtime changes that automation does not fully cover.

## Configuration

Use `webclipper.json` or `.webclipper.json` to define defaults for browser profile, tags, vault, and tool behavior.

A baseline config template is provided at:
- `webclipper.json.example`

Common precedence model:
1. CLI arguments
2. Config file
3. Environment variables
4. Tool defaults

## Repository Structure

```text
src/                  Extension source (background/content/popup/options/offscreen/shared)
tools/                CLI and automation tools
native-host/          Native messaging host installer and runtime bridge
build/                Build system
docs/                 In-depth docs (CLI tools, templates, native bridge)
tests/                Test suites
dist/                 Build output
```

## Documentation

- **Project docs hub**: `docs/README.md` (headless scenario matrix, quality gates, distribution artifacts)
- CLI tools reference: `docs/cli-tools.md`
- Custom templates guide: `docs/custom-templates.md`
- Native messaging bridge: `docs/native-messaging-bridge.md`
- Implementation plan: `IMPLEMENTATION_PLAN.md`
- Specs: `specs/`

If you want, I can also generate:
- A concise "User README" for non-developers
- A separate "Developer README" with architecture diagrams and contribution workflow
- Per-tool deep-dive pages under `docs/tools/` for long-term maintenance
# AI Gatekeeper Test
