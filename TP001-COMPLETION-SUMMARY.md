# TP001 Completion Summary

## Task
**TP001**: Define deterministic real-world GitHub regression fixture contract for `vhs`, `lipgloss`, and `crush` (inputs, expected README extraction mode, expected link-follow children, and stable ordering rules).

## Status
✅ **COMPLETE** - Marked as checked in IMPLEMENTATION_PLAN.md

---

## Deliverables

### 1. Contract Definition Document
**File**: `tests/fixtures/github-regression-fixtures.md`

A comprehensive contract specification that defines:
- Purpose and scope for regression testing
- Three fixture definitions (vhs, lipgloss, crush)
- README extraction mode contracts for each repo
- Link-follow children contracts for each repo
- Stable ordering rules
- Filename derivation rules (package.json → repo name fallback)
- Discovery rules and exclusion patterns
- Deterministic execution requirements
- Test harness integration expectations

### 2. HTML Fixtures (3 files)
**Location**: `tests/templates/fixtures/`

- `github-regression-vhs.html` (4,201 bytes)
- `github-regression-lipgloss.html` (4,631 bytes)
- `github-regression-crush.html` (4,798 bytes)

Each fixture includes:
- Simulated GitHub page structure
- README content with markdown links
- Repository metadata (stars, forks, language, topics)
- Related project links in "Related Projects" section
- Elements for remove selectors testing

### 3. Fixture Contracts (6 JSON files)
**Location**: `tests/templates/fixtures/`

Per-repo contracts (vhs, lipgloss, crush):
- `{repo}.contract.json` - Expected clipping behavior
  - Package name derivation
  - README extraction mode
  - URL variants (root, tree path)
  - Expected frontmatter structure
  - Markdown structure expectations
  - Metadata extraction selectors
  - Discovery configuration

- `{repo}.children.json` - Expected link-follow children
  - Child repo URLs discovered from README
  - Filename derivation (parent-child prefixing)
  - Discovery source and depth tracking
  - Dedupe and exclusion rules
  - Assertion expectations

### 4. JSON Schemas (2 files)
**Location**: `tests/fixtures/schemas/`

- `github-regression-contract.schema.json` (7,817 bytes)
  - Schema for fixture contracts
  - Validation rules for all contract fields
  - Supports contract versioning

- `github-regression-children.schema.json` (9,061 bytes)
  - Schema for children contracts
  - Validation rules for link-follow expectations
  - Supports child assertion definitions

---

## Contract Coverage

### Fixture 1: charmbracelet/vhs
- **URL**: https://github.com/charmbracelet/vhs
- **Package name**: `vhs`
- **Expected filename**: `vhs.md`
- **Expected children**: 3 (bubbletea, gum, lipgloss)
- **Discovery depth**: 1

### Fixture 2: charmbracelet/lipgloss
- **URL**: https://github.com/charmbracelet/lipgloss
- **Package name**: `lipgloss`
- **Expected filename**: `lipgloss.md`
- **Expected children**: 3 (bubbletea, gum, vhs)
- **Discovery depth**: 1

### Fixture 3: charmbracelet/crush
- **URL**: https://github.com/charmbracelet/crush
- **Package name**: `crush`
- **Expected filename**: `crush.md`
- **Expected children**: 3 (bubbletea, gum, lipgloss)
- **Discovery depth**: 1

---

## Key Contract Rules

### Filename Derivation
1. **Primary source**: `package.json` → `name` field
2. **Fallback**: Repository name from URL path
3. **Sanitization rules**:
   - Remove leading/trailing whitespace
   - Replace non-alphanumeric with hyphens (except `_`, `-`, `.`)
   - Collapse consecutive hyphens
   - Remove leading/trailing hyphens

### README Extraction
- **Content selector priority**: `article.markdown-body` → `.repository-content .readme article` → `.markdown-body`
- **Remove selectors**: Edit buttons, copy buttons, anchor links, navigation, action buttons
- **URL variant support**: Root repo, tree path (`/tree/main`), subdirectory README

### Link-Follow Discovery
- **Include patterns**: `https://github.com/owner/repo` (exact match)
- **Exclude patterns**: Self-references, non-GitHub URLs, paths beyond `/owner/repo`, tree paths
- **Dedupe strategy**: URL-based deduplication
- **Ordering**: Alphabetical by URL string
- **Depth limit**: 1 (no recursive follows)

### Child Note Creation
- **Filename pattern**: `{parent}-{child}.md` (e.g., `vhs-lipgloss.md`)
- **Discovery metadata**: `github_discovered_from`, `github_discovery_depth`, `github_sibling_of`

---

## Verification Results

All verification commands passed:

```bash
✓ bun test tests/templates/github.test.ts
  23 pass, 0 fail, 40 expect() calls

✓ bun test tests/e2e/headless-clip-harness.test.ts
  5 pass, 0 fail, 53 expect() calls

✓ bun run typecheck
  No TypeScript errors

✓ All JSON contracts validated
  8 JSON files validated successfully
```

---

## Files Created/Modified

### Created (11 files)
1. `tests/fixtures/github-regression-fixtures.md`
2. `tests/fixtures/schemas/github-regression-contract.schema.json`
3. `tests/fixtures/schemas/github-regression-children.schema.json`
4. `tests/templates/fixtures/github-regression-vhs.html`
5. `tests/templates/fixtures/github-regression-vhs.contract.json`
6. `tests/templates/fixtures/github-regression-vhs.children.json`
7. `tests/templates/fixtures/github-regression-lipgloss.html`
8. `tests/templates/fixtures/github-regression-lipgloss.contract.json`
9. `tests/templates/fixtures/github-regression-lipgloss.children.json`
10. `tests/templates/fixtures/github-regression-crush.html`
11. `tests/templates/fixtures/github-regression-crush.contract.json`

### Modified (1 file)
1. `IMPLEMENTATION_PLAN.md` - Marked TP001 as complete `[x]`

---

## Next Steps (TP002-T005)

The fixtures and contracts are now ready for:
- **TP002**: Adding/curating fixture corpus and expected outputs
- **TP003**: Extending GitHub test assertions to use new fixtures
- **TP004**: Extending headless-clip-harness for real-world URL regression
- **TP005**: Updating README/quality docs with regression gate

---

## Contract Version
- **Version**: 1.0.0
- **Created**: 2026-03-02
- **Slice**: TASKPAD Intake Slice (2026-03-02)
- **Status**: Active

---

## RepoPrompt Evidence

**Context Mode**: RepoPrompt

**Commands Used**:
- `tree --depth 3` - Explored project structure
- `search "link-follow|link follow|README|github.*extraction"` - Found relevant code
- `search "vhs|lipgloss|crush|charmbracelet"` - Found failing repo references

**Selected Files**:
- `src/content/templates/github.ts` - GitHub template implementation
- `tests/templates/github.test.ts` - Existing GitHub tests
- `tests/e2e/headless-clip-harness.test.ts` - E2E test harness
- `tests/e2e/support/test-vault-sandbox.ts` - Sandbox infrastructure
- `tests/templates/fixtures/github-repo.html` - Example fixture
- `docs/quality/headless-harness-spec.md` - Harness contract spec
- `IMPLEMENTATION_PLAN.md` - Task definitions

---

**TP001 COMPLETE ✅**
