# GitHub Reported-Failures Regression Gate

## Purpose

The GitHub reported-failures regression gate provides deterministic validation for known GitHub link-follow failures reported by users. This gate locks behavior for three specific repos (`charmbracelet/vhs`, `charmbracelet/lipgloss`, `charmbracelet/crush`) to prevent regressions on:
- Package-name filename derivation (using `package.json` name instead of repo name)
- Monorepo `/tree/...` README extraction
- README link-follow clipping with depth-1 limit and deduplication
- GitHub README relative-link canonicalization (`./`, `../`, `/tree/...`, `/blob/...`)

## Contract Version

- **Version**: 1.0.0
- **Created**: 2026-03-02
- **Slice**: TASKPAD Intake Slice (2026-03-02): Real-world GitHub link-follow regression matrix
- **Status**: Active

## Scope

This gate validates deterministic GitHub clipping behavior for three real-world repos that have been reported as failing in user workflows:

| Repo | Issue | Coverage |
|------|-------|----------|
| `charmbracelet/vhs` | Package-name filename, README link-follow, relative-link canonicalization | Fixture-based unit + E2E |
| `charmbracelet/lipgloss` | Package-name filename, README link-follow, relative-link canonicalization | Fixture-based unit + E2E |
| `charmbracelet/crush` | Package-name filename, README link-follow, relative-link canonicalization | Fixture-based unit + E2E |

## GitHub Regression Contract Parity Gate

### Purpose

The `taskpad:github-regression-contract-parity` gate validates that GitHub regression contract docs reference only live test files and verification commands. This gate prevents drift between documentation and executable command surfaces, ensuring regression readiness remains verifiable.

### What It Validates

The gate checks contract documentation (`tests/fixtures/github-regression-fixtures.md`, related quality docs) for:

1. **Test File References** — All referenced test files exist in the repo
   - `tests/templates/github.test.ts` — GitHub template unit tests
   - `tests/e2e/headless-clip-harness.test.ts` — Headless harness E2E scenarios
   - Rejects stale references to non-existent test entrypoints

2. **Verification Commands** — All referenced verification commands exist and are executable
   - `test:github:reported-failures` — Primary GitHub regression verification script
   - Other `bun run` or `npm run` commands in `package.json`

3. **Tool Paths** — All referenced tool paths are available in `tools/`

4. **Canonical Command Mappings** — References point to canonical command surfaces used by autonomous intake loops

### Usage

```bash
# Validate GitHub regression contract parity with JSON output
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

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All contract references are valid (parity gate passes) |
| `1` | One or more violations detected (missing files, stale commands, etc.) |
| `2` | Input validation error (invalid arguments, file not found, etc.) |

### Failure Rule IDs

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

### Canonical Command Mappings

The gate validates references against these canonical live commands:

| Canonical Command | Maps To | Notes |
|------------------|---------|-------|
| `test:github:reported-failures` | `bun test tests/templates/github.test.ts tests/e2e/headless-clip-harness.test.ts` | Primary GitHub regression verification script |
| `typecheck` | `bun run typecheck` | TypeScript type checking |
| `tests/templates/github.test.ts` | Direct test file path | GitHub template unit tests |
| `tests/e2e/headless-clip-harness.test.ts` | Direct test file path | Headless harness E2E scenarios |

### Integration with Test Gate

The contract parity gate runs **before** the GitHub regression test execution gate to ensure contract validity before running tests:

```bash
# 1) Typecheck
bun run typecheck

# 2) Contract parity gate (validate docs first)
bun run taskpad:github-regression-contract-parity -- \
  --fixtures-doc tests/fixtures/github-regression-fixtures.md \
  --package package.json \
  --format json

# 3) Test execution gate (run tests only if contracts are valid)
bun run test:github:reported-failures
```

If the contract parity gate fails, the test execution gate should not run, as the contract docs would reference stale or non-existent files/commands.

### When to Run

Run the contract parity gate:
- After modifying GitHub regression contract docs (`tests/fixtures/github-regression-fixtures.md`)
- After adding or removing test files referenced in contracts
- After renaming or moving test entrypoints
- Before the GitHub regression test execution gate (to ensure contract validity first)
- As part of pre-handoff verification for GitHub-related feature work
- In CI/CD as part of the automated quality gate sequence

## Verification Run Sequence

### Canonical Verification Flow

For complete GitHub regression gate verification before Builder handoff:

```bash
# 1) Typecheck (ensure no compilation errors)
bun run typecheck

# 2) GitHub regression contract parity gate (validate contract docs reference live files/commands)
bun run taskpad:github-regression-contract-parity -- \
  --fixtures-doc tests/fixtures/github-regression-fixtures.md \
  --package package.json \
  --format json

# 3) GitHub template unit tests (fixture-based deterministic assertions)
bun test tests/templates/github.test.ts

# 4) Headless harness E2E scenarios (end-to-end validation in disposable test vaults)
bun test tests/e2e/headless-clip-harness.test.ts

# 5) Full quality gate (optional: includes all headless quality tests)
bun run test:quality:headless
```

### Quick Verification (Orchestration Script)

```bash
# Run the full GitHub regression verification sequence via npm script
bun run test:github:reported-failures
```

This script runs the complete gate sequence (steps 2-4 above) and is the canonical entry point for GitHub regression verification.

### Quick Verification (Unit Tests Only)

```bash
# Run only GitHub template unit tests
bun test tests/templates/github.test.ts
```

### Full Verification (Unit + E2E)

```bash
# Run both regression gates together
bun test tests/templates/github.test.ts && bun test tests/e2e/headless-clip-harness.test.ts
```

### CI/CD Integration

```bash
# CI-friendly sequence with JSON output (if supported)
bun run typecheck
bun test tests/templates/github.test.ts --reporter=json
bun test tests/e2e/headless-clip-harness.test.ts --reporter=json
```

## Expected Output

### Unit Tests Output

```
bun test tests/templates/github.test.ts

✅ vhs regression fixture passes
✅ lipgloss regression fixture passes
✅ crush regression fixture passes

- Package-name filename derivation: PASS
- Monorepo /tree/... README extraction: PASS
- README link-follow discovery: PASS
- Depth-1 limit enforcement: PASS
- Deduplication: PASS
- Stable ordering: PASS

18 pass
0 fail
```

### E2E Headless Harness Output

```
bun test tests/e2e/headless-clip-harness.test.ts

✅ github-regression-vhs scenario passed
✅ github-regression-lipgloss scenario passed
✅ github-regression-crush scenario passed

All deterministic parity checks passed for:
- Filename derivation (package.json name)
- README content extraction (root and /tree/... paths)
- Link-follow children (depth-1, alphabetical ordering, deduped)

3 pass
0 fail
```

## Failure Rule IDs

| Rule ID | Severity | Description | Remediation |
|---------|----------|-------------|-------------|
| `GHR001_FILENAME_MISMATCH` | `error` | Filename doesn't match `package.json` name | Fix filename derivation in `src/content/templates/github.ts` to use `package.json` name field |
| `GHR002_TREE_PATH_EXTRACTION_FAILED` | `error` | README not extracted from `/tree/...` path | Fix content selector for non-root paths (`article.markdown-body` should work at any depth) |
| `GHR003_LINK_FOLLOW_DISCOVERY_MISMATCH` | `error` | Expected child links not discovered | Fix link pattern extraction (markdown and HTML regex) or filter rules |
| `GHR004_DEDUPE_FAILED` | `error` | Duplicate child links in output | Fix dedupe logic for child URLs (use full URL as dedupe key) |
| `GHR005_ORDERING_NOT_STABLE` | `warning` | Children not in alphabetical order | Fix sorting logic for child URLs (alphabetical by URL string) |
| `GHR006_DEPTH_LIMIT_VIOLATION` | `error` | Recursive link-follow beyond depth-1 | Enforce depth limit in link-follow logic (stop at depth-1) |
| `GHR007_CHILD_FRONTMATTER_MISSING` | `error` | Child note missing discovery metadata | Add `github_discovered_from`, `github_discovery_depth`, `github_sibling_of` fields to child frontmatter |

## Contract Coverage

Each regression fixture validates the following categories:

### Category 1: Filename Derivation

**Assertions:**
- Filename matches `package.json` name field (when available)
- Filename falls back to repo name when `package.json` unavailable
- Filename sanitization rules applied correctly (remove leading/trailing whitespace, replace non-alphanumeric chars with hyphens, collapse consecutive hyphens)

**Examples:**
- `@scope/package-name` → `package-name`
- `my.package_name` → `my.package_name`
- `  spaced--name  ` → `spaced-name`

### Category 2: README Content Extraction

**Assertions:**
- README content selector finds expected elements at root paths
- README content selector finds expected elements at `/tree/...` paths (monorepo support)
- Remove selectors clean artifacts (edit buttons, copy buttons, anchor links)
- Metadata extraction works (stars, forks, language)

**Content Selector Priority:**
1. Primary: `article.markdown-body`
2. Secondary: `.repository-content .readme article`
3. Fallback: `.markdown-body` (any in page)

### Category 3: Link-Follow Discovery

**Assertions:**
- Exact set of child URLs discovered from README
- Dedupe removes self-references and duplicate URLs
- Children are ordered alphabetically by URL string
- Only `github.com/owner/repo` patterns are extracted
- Non-github.com URLs are filtered out
- URLs with paths beyond `/owner/repo` are excluded

**Link Pattern Detection:**
```typescript
// Markdown links in README
/\[([^\]]+)\]\(https:\/\/github\.com\/[^/]+\/[^/]+(?:\/[^)]*)?\)/g

// HTML links in README
/<a\s+href="(https:\/\/github\.com\/[^/]+\/[^/]+(?:\/[^"]*)?)"/gi
```

### Category 4: Child Note Creation

**Assertions:**
- Child note filenames follow `{parent}-{child}.md` pattern
- Child frontmatter includes discovery metadata:
  - `github_discovered_from`: parent repo URL
  - `github_discovery_depth`: depth level (always 1)
  - `github_sibling_of`: parent filename
- Depth limit enforced (no recursive follows)

**Child Frontmatter Example:**
```json
{
  "source": "https://github.com/charmbracelet/lipgloss",
  "title": "charmbracelet/lipgloss",
  "filename": "lipgloss",
  "type": "github-repo",
  "site": "github",
  "extra": {
    "github_owner": "charmbracelet",
    "github_repo": "lipgloss",
    "github_package_name": "lipgloss",
    "github_discovered_from": "https://github.com/charmbracelet/vhs",
    "github_discovery_depth": 1,
    "github_sibling_of": "vhs"
  }
}
```

### Category 5: Monorepo `/tree/...` Paths

**Assertions:**
- README extracted from non-root paths (`/tree/main/docs`)
- Filename derivation works regardless of path depth
- Link-follow discovery works from any README path

**URL Pattern Matching:**
```typescript
// Root repo
/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/

// Tree path
/^https:\/\/github\.com\/[^/]+\/[^/]+\/tree\/[^/]+(\/.*)?$/

// Subdirectory README
/^https:\/\/github\.com\/[^/]+\/[^/]+\/tree\/[^/]+\/.*\/README\.md$/
```

### Category 6: Relative-Link Canonicalization

**Assertions:**
- Same-directory relative links (`./docs/api.md`, `docs/api.md`) resolve to canonical blob URLs
- Parent directory links (`../README.md`, `../../package.json`) resolve correctly
- Root-relative links (`/docs/guide.md`, `/LICENSE`) resolve to repo root paths
- GitHub tree paths (`/tree/main/docs/api.md`) preserve branch and path
- GitHub blob paths (`/blob/develop/src/index.ts`) preserve branch and path
- Fragment-only links (`#installation`) are rejected (not navigable)
- External non-GitHub links are filtered
- Cross-repo relative links are excluded (only same-repo normalization)
- Dedupe keys remain stable after normalization
- Alphabetical ordering is preserved

**Supported Input Forms:**
```markdown
[API Docs](./docs/api.md)
[Guide](../guide.md)
[License](/LICENSE)
[Source](/tree/main/src/index.ts)
[Config](/blob/develop/config.json)
```

**Reject Rules:**
```markdown
[Installation](#installation)           <!-- Fragment-only: rejected -->
[Other Repo](https://other.com/repo)     <!-- External: filtered -->
[Cross Repo](../other-repo/README.md)     <!-- Cross-repo: excluded -->
[Email](mailto:user@example.com)         <!-- Unsupported scheme: rejected -->
```

**For full contract documentation**, see: `docs/quality/github-relative-link-canonicalization-contract.md`

## Fixture Files

### Input Fixtures

Each fixture includes HTML simulating the GitHub repo page:

1. `tests/templates/fixtures/github-regression-vhs.html`
2. `tests/templates/fixtures/github-regression-lipgloss.html`
3. `tests/templates/fixtures/github-regression-crush.html`

### Expected Output Contracts

Each fixture includes JSON contracts defining expected clipping behavior:

1. `tests/templates/fixtures/github-regression-vhs.contract.json`
2. `tests/templates/fixtures/github-regression-lipgloss.contract.json`
3. `tests/templates/fixtures/github-regression-crush.contract.json`

### Expected Children Contracts

Each fixture includes JSON contracts defining expected link-follow children:

1. `tests/templates/fixtures/github-regression-vhs.children.json`
2. `tests/templates/fixtures/github-regression-lipgloss.children.json`
3. `tests/templates/fixtures/github-regression-crush.children.json`

## Test Files

### Unit Tests

`tests/templates/github.test.ts` — Fixture-based deterministic assertions for GitHub template logic:
- Filename derivation from `package.json`
- README extraction from root and `/tree/...` paths
- Link-follow discovery, deduplication, and ordering
- Child note creation with metadata

### E2E Tests

`tests/e2e/headless-clip-harness.test.ts` — End-to-end scenarios in disposable test vaults:
- Full clipping pipeline validation
- CLI save contract assertions
- Frontmatter metadata verification
- Markdown structure validation

## Integration with Quality Gates

### When to Run

The GitHub reported-failures regression gate should run:
- **Before** any GitHub template changes (package.json parsing, filename derivation, link-follow logic)
- **After** modifying `src/content/templates/github.ts`
- **As part of** pre-handoff verification for Builder loops working on GitHub clipping features
- **In CI/CD** as part of the automated quality gate sequence

The GitHub regression contract parity gate should run:
- **After** modifying GitHub regression contract docs (`tests/fixtures/github-regression-fixtures.md`)
- **After** adding or removing test files referenced in contracts
- **After** renaming or moving test entrypoints
- **Before** the GitHub regression test execution gate (to ensure contract validity first)

### Gate Sequence

Recommended gate sequence for GitHub-related work:

```bash
# 1) Typecheck
bun run typecheck

# 2) GitHub regression gate (this gate)
bun test tests/templates/github.test.ts
bun test tests/e2e/headless-clip-harness.test.ts

# 3) Headless scenario matrix (broader E2E coverage)
bun run test:e2e:matrix

# 4) Full quality gate
bun run test:quality:headless
```

### Relationship to Other Gates

| Gate | Scope | Relationship |
|------|-------|-------------|
| **GitHub Regression Gate** | Specific repos (vhs, lipgloss, crush) | Deep deterministic coverage for reported failures |
| **Headless Scenario Matrix** | Generic scenarios (web clip, SeedFinder, CLI save) | Broader coverage across clip entrypoints |
| **test:quality:headless** | All headless tests | Full test suite for quick quality gate |

The GitHub regression gate complements the headless scenario matrix by providing deep, deterministic coverage for the three specific user-reported GitHub link-follow failures.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All GitHub regression gates passed |
| `1` | One or more regression failures detected |
| `2` | Test execution error (fixture missing, parse error, etc.) |

## Version Control and Updates

### Contract Versioning

- Increment **major** version when contract structure changes
- Increment **minor** version when adding new fixtures
- Increment **patch** version when clarifying expectations without structural changes

### Change Process

1. Update contract version in this document
2. Add change notes below
3. Update fixture files to match new contract
4. Update tests to assert new contract
5. Update IMPLEMENTATION_PLAN.md slice reference if applicable

### Change Log

- **1.0.0** (2026-03-02): Initial contract definition for vhs, lipgloss, crush regressions

## References

- **Fixture Contract**: `tests/fixtures/github-regression-fixtures.md`
- **IMPLEMENTATION_PLAN.md**: TASKPAD Intake Slice (2026-03-02): Real-world GitHub link-follow regression matrix
- **GitHub Template**: `src/content/templates/github.ts`
- **Headless Harness Spec**: `docs/quality/headless-harness-spec.md`
- **README.md**: Quality Gates section — GitHub Reported-Failures Regression Gate

## Runnable Examples

### Verify All GitHub Regression Gates

```bash
# Full verification sequence
bun run typecheck
bun test tests/templates/github.test.ts
bun test tests/e2e/headless-clip-harness.test.ts
```

### Quick Unit Test Verification

```bash
# Unit tests only (fast feedback during development)
bun test tests/templates/github.test.ts
```

### E2E Verification

```bash
# E2E scenarios only
bun test tests/e2e/headless-clip-harness.test.ts
```

### CI/CD Verification

```bash
# CI-friendly sequence
bun run typecheck && \
bun test tests/templates/github.test.ts && \
bun test tests/e2e/headless-clip-harness.test.ts && \
echo "GitHub regression gate: PASS"
```

## Troubleshooting

### Common Issues

**Issue**: `GHR001_FILENAME_MISMATCH` — Filename doesn't match expected

**Solution**: Check filename derivation logic in `src/content/templates/github.ts`. Ensure `package.json` name field is extracted and used as primary source.

**Issue**: `GHR003_LINK_FOLLOW_DISCOVERY_MISMATCH` — Expected child links not discovered

**Solution**: Verify link pattern extraction regex captures both markdown and HTML links. Check filter rules don't incorrectly exclude expected URLs.

**Issue**: `GHR004_DEDUPE_FAILED` — Duplicate child links in output

**Solution**: Ensure dedupe logic uses full URL as dedupe key. Check that self-references are filtered out.

**Issue**: `GHR006_DEPTH_LIMIT_VIOLATION` — Recursive link-follow beyond depth-1

**Solution**: Verify depth limit is enforced in link-follow logic. Stop at depth-1 and don't follow links from child repo READMEs.

### Debug Mode

To debug regression test failures:

```bash
# Run tests with verbose output
bun test tests/templates/github.test.ts --verbose

# Run single test file
bun test tests/templates/github.test.ts

# Run with --bail to stop on first failure
bun test tests/templates/github.test.ts --bail
```

## Summary

The GitHub reported-failures regression gate provides deterministic, fixture-based validation for three specific GitHub repos that were reported as failing in user workflows. By locking behavior for these repos, the gate prevents regressions on:

1. Package-name filename derivation (using `package.json` name instead of repo name)
2. Monorepo `/tree/...` README extraction
3. README link-follow clipping with depth-1 limit and deduplication
4. GitHub README relative-link canonicalization (`./`, `../`, `/tree/...`, `/blob/...`)

Run this gate before any GitHub template changes and as part of pre-handoff verification for Builder loops working on GitHub clipping features.
