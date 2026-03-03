# Real-World GitHub Regression Fixtures Contract

## Purpose
Define deterministic fixture contract for three reported failing GitHub repos (`vhs`, `lipgloss`, `crush`) to lock GitHub link-follow behavior and prevent regressions.

## Scope
This contract covers regression testing for:
1. **Package-name filename derivation** - Extracting note filenames from package.json name (not just repo name)
2. **Monorepo `/tree/...` README extraction** - Reliably extracting READMEs from non-root paths
3. **README link-follow clipping** - Capturing repo links found in README content, deduping targets, and clipping to sibling notes with depth-1 limit

## Contract Version
- **Version**: 1.0.0
- **Created**: 2026-03-02
- **Slice**: TASKPAD Intake Slice (2026-03-02): Real-world GitHub link-follow regression matrix
- **Status**: Active

---

## Fixture Definitions

### Fixtures Structure

Each fixture consists of:

1. **Input HTML** - Simulated GitHub page HTML saved in `tests/templates/fixtures/github-regression-{repo}.html`
2. **Expected Output Contract** - JSON contract defining expected clipping behavior in `tests/templates/fixtures/github-regression-{repo}.contract.json`
3. **Expected Children Contract** - JSON contract defining expected link-follow children in `tests/templates/fixtures/github-regression-{repo}.children.json`

---

## Fixture 1: charmbracelet/vhs

### URL
```
https://github.com/charmbracelet/vhs
```

### Repo Metadata
- **Owner**: `charmbracelet`
- **Repo**: `vhs`
- **Package Name** (from package.json): `vhs`
- **Expected Filename**: `vhs.md` (package name matches repo name)

### README Extraction Mode

#### Expected Input URL Variants
1. Root repo: `https://github.com/charmbracelet/vhs`
2. Tree path (if monorepo): `https://github.com/charmbracelet/vhs/tree/main`
3. Subdirectory README (if applicable): `https://github.com/charmbracelet/vhs/tree/main/docs`

#### Expected Output

**Frontmatter Contract:**
```json
{
  "source": "https://github.com/charmbracelet/vhs",
  "title": "charmbracelet/vhs",
  "filename": "vhs",
  "type": "github-repo",
  "site": "github",
  "extra": {
    "github_owner": "charmbracelet",
    "github_repo": "vhs",
    "github_package_name": "vhs",
    "github_stars": { "extract": true, "assert": "> 0" },
    "github_forks": { "extract": true, "assert": "> 0" },
    "github_language": { "extract": true, "expected": "Go" }
  }
}
```

**Markdown Structure:**
```markdown
# charmbracelet/vhs

> Repository: [charmbracelet/vhs](https://github.com/charmbracelet/vhs) | ⭐ {stars} | 🍴 {forks} | 🌐 Go

README content...

## Links in README

- Related repos discovered in README:
  - [charmbracelet/lipgloss](https://github.com/charmbracelet/lipgloss)
  - [charmbracelet/bubbletea](https://github.com/charmbracelet/bubbletea)
```

### Link-Follow Children

#### Discovery Rules
1. **Extract links** from README markdown: `github.com/owner/repo` patterns
2. **Dedupe targets**: Remove duplicates and self-references
3. **Depth limit**: Only follow direct links (depth-1), not recursive
4. **Stable ordering**: Sort by URL alphabetically for deterministic output

#### Expected Children
```json
{
  "children": [
    {
      "url": "https://github.com/charmbracelet/lipgloss",
      "owner": "charmbracelet",
      "repo": "lipgloss",
      "filename": "lipgloss",
      "discovery_source": "readme_link",
      "depth": 1
    },
    {
      "url": "https://github.com/charmbracelet/bubbletea",
      "owner": "charmbracelet",
      "repo": "bubbletea",
      "filename": "bubbletea",
      "discovery_source": "readme_link",
      "depth": 1
    }
  ],
  "dedupe_strategy": "url_deduplication",
  "max_depth": 1,
  "ordering": "alphabetical_by_url"
}
```

### Stable Ordering Rules

1. **Filename**: Derived from `package.json` name field, fallback to repo name
2. **Children ordering**: Alphabetically by URL string
3. **Dedupe keys**: `url` (full GitHub URL)
4. **Exclusions**: Self-referential links, non-github.com URLs

---

## Fixture 2: charmbracelet/lipgloss

### URL
```
https://github.com/charmbracelet/lipgloss
```

### Repo Metadata
- **Owner**: `charmbracelet`
- **Repo**: `lipgloss`
- **Package Name** (from package.json): `lipgloss`
- **Expected Filename**: `lipgloss.md` (package name matches repo name)

### README Extraction Mode

#### Expected Input URL Variants
1. Root repo: `https://github.com/charmbracelet/lipgloss`
2. Tree path (if monorepo): `https://github.com/charmbracelet/lipgloss/tree/main`
3. Subdirectory README (if applicable): `https://github.com/charmbracelet/lipgloss/tree/main/docs`

#### Expected Output

**Frontmatter Contract:**
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
    "github_stars": { "extract": true, "assert": "> 0" },
    "github_forks": { "extract": true, "assert": "> 0" },
    "github_language": { "extract": true, "expected": "Go" }
  }
}
```

**Markdown Structure:**
```markdown
# charmbracelet/lipgloss

> Repository: [charmbracelet/lipgloss](https://github.com/charmbracelet/lipgloss) | ⭐ {stars} | 🍴 {forks} | 🌐 Go

README content...

## Links in README

- Related repos discovered in README:
  - [charmbracelet/vhs](https://github.com/charmbracelet/vhs)
  - [charmbracelet/bubbletea](https://github.com/charmbracelet/bubbletea)
```

### Link-Follow Children

#### Expected Children
```json
{
  "children": [
    {
      "url": "https://github.com/charmbracelet/bubbletea",
      "owner": "charmbracelet",
      "repo": "bubbletea",
      "filename": "bubbletea",
      "discovery_source": "readme_link",
      "depth": 1
    },
    {
      "url": "https://github.com/charmbracelet/vhs",
      "owner": "charmbracelet",
      "repo": "vhs",
      "filename": "vhs",
      "discovery_source": "readme_link",
      "depth": 1
    }
  ],
  "dedupe_strategy": "url_deduplication",
  "max_depth": 1,
  "ordering": "alphabetical_by_url"
}
```

### Stable Ordering Rules

Same as Fixture 1.

---

## Fixture 3: charmbracelet/crush

### URL
```
https://github.com/charmbracelet/crush
```

### Repo Metadata
- **Owner**: `charmbracelet`
- **Repo**: `crush`
- **Package Name** (from package.json): `crush`
- **Expected Filename**: `crush.md` (package name matches repo name)

### README Extraction Mode

#### Expected Input URL Variants
1. Root repo: `https://github.com/charmbracelet/crush`
2. Tree path (if monorepo): `https://github.com/charmbracelet/crush/tree/main`
3. Subdirectory README (if applicable): `https://github.com/charmbracelet/crush/tree/main/docs`

#### Expected Output

**Frontmatter Contract:**
```json
{
  "source": "https://github.com/charmbracelet/crush",
  "title": "charmbracelet/crush",
  "filename": "crush",
  "type": "github-repo",
  "site": "github",
  "extra": {
    "github_owner": "charmbracelet",
    "github_repo": "crush",
    "github_package_name": "crush",
    "github_stars": { "extract": true, "assert": "> 0" },
    "github_forks": { "extract": true, "assert": "> 0" },
    "github_language": { "extract": true, "expected": "Go" }
  }
}
```

**Markdown Structure:**
```markdown
# charmbracelet/crush

> Repository: [charmbracelet/crush](https://github.com/charmbracelet/crush) | ⭐ {stars} | 🍴 {forks} | 🌐 Go

README content...

## Links in README

- Related repos discovered in README:
  - [charmbracelet/lipgloss](https://github.com/charmbracelet/lipgloss)
  - [charmbracelet/bubbletea](https://github.com/charmbracelet/bubbletea)
```

### Link-Follow Children

#### Expected Children
```json
{
  "children": [
    {
      "url": "https://github.com/charmbracelet/bubbletea",
      "owner": "charmbracelet",
      "repo": "bubbletea",
      "filename": "bubbletea",
      "discovery_source": "readme_link",
      "depth": 1
    },
    {
      "url": "https://github.com/charmbracelet/lipgloss",
      "owner": "charmbracelet",
      "repo": "lipgloss",
      "filename": "lipgloss",
      "discovery_source": "readme_link",
      "depth": 1
    }
  ],
  "dedupe_strategy": "url_deduplication",
  "max_depth": 1,
  "ordering": "alphabetical_by_url"
}
```

### Stable Ordering Rules

Same as Fixture 1.

---

## Contract Enforcement Rules

### Filename Derivation Rules

1. **Primary source**: `package.json` → `name` field
2. **Fallback**: Repository name from URL path
3. **Sanitization**:
   - Remove leading/trailing whitespace
   - Replace non-alphanumeric characters with hyphens (except underscore, hyphen, period)
   - Collapse consecutive hyphens
   - Remove leading/trailing hyphens
4. **Examples**:
   - `@scope/package-name` → `package-name`
   - `my.package_name` → `my.package_name`
   - `  spaced--name  ` → `spaced-name`

### README Extraction Rules

#### URL Pattern Matching
```typescript
// Root repo
/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/

// Tree path
/^https:\/\/github\.com\/[^/]+\/[^/]+\/tree\/[^/]+(\/.*)?$/

// Subdirectory README
/^https:\/\/github\.com\/[^/]+\/[^/]+\/tree\/[^/]+\/.*\/README\.md$/
```

#### Content Selector Priority
1. Primary: `article.markdown-body`
2. Secondary: `.repository-content .readme article`
3. Fallback: `.markdown-body` (any in page)

#### Remove Selectors
- Edit buttons: `.markdown-body .octicon-pencil`, `.markdown-body a[aria-label*='Edit']`
- Copy buttons: `button[data-clipboard-target]`, `.zeroclipboard-button`
- Anchor links: `.markdown-body a.anchor`
- "On this page" TOC: `.Layout-sidebar nav[aria-label='Page navigation']`
- Action buttons: `.file-navigation`, `.js-socket-channel`

### Link-Follow Discovery Rules

#### Link Pattern Detection
```typescript
// Markdown links in README
/\[([^\]]+)\]\(https:\/\/github\.com\/[^/]+\/[^/]+(?:\/[^)]*)?\)/g

// HTML links in README
/<a\s+href="(https:\/\/github\.com\/[^/]+\/[^/]+(?:\/[^"]*)?)"/gi
```

#### Filter Rules
1. **Include only**: URLs matching `https://github.com/owner/repo` pattern
2. **Exclude**:
   - Same URL as parent repo (self-reference)
   - Non-github.com URLs
   - URLs with paths beyond `/owner/repo` (e.g., `/owner/repo/issues/123`)
   - URLs with `tree/` paths (treated as monorepo sub-repos, out of scope for v1)
3. **Dedupe**: Use full URL as dedupe key
4. **Ordering**: Sort alphabetically by URL string

### Child Note Creation Rules

#### Filename for Children
- Apply same filename derivation rules as parent repo
- Prefix with parent filename for sibling grouping: `{parent}-{child}.md`
  - Example: `vhs-lipgloss.md`, `vhs-bubbletea.md`

#### Frontmatter for Children
```typescript
{
  source: childUrl,
  title: childRepoTitle,
  filename: childFilename,
  type: "github-repo",
  site: "github",
  extra: {
    github_owner: childOwner,
    github_repo: childRepo,
    github_package_name: childPackageName,
    github_discovered_from: parentUrl,
    github_discovery_depth: 1,
    github_sibling_of: parentFilename
  }
}
```

#### Depth Limit Enforcement
- **Max depth**: 1 (only follow links from primary repo README)
- **No recursive follow**: Do not follow links from child repo READMEs
- **Depth tracking**: Add `github_discovery_depth` field to frontmatter

---

## Deterministic Execution Contract

### Test Execution Requirements

When running regression tests for these fixtures:

1. **Use HTML fixtures** (not live URLs) for deterministic behavior
2. **Freeze timestamps** using sandbox deterministic controls
3. **Alphabetical ordering** for all list/array assertions
4. **No network calls** - all content from fixture files
5. **Disposable test vault** - create temp vault, cleanup after each test

### Assertion Categories

#### Category 1: Filename Derivation
- Assert filename matches `package.json` name (when available)
- Assert fallback to repo name when package name unavailable
- Assert filename sanitization rules applied

#### Category 2: README Content Extraction
- Assert README content selector finds expected elements
- Assert remove selectors clean artifacts
- Assert metadata extraction (stars, forks, language)

#### Category 3: Link-Follow Discovery
- Assert exact set of child URLs discovered
- Assert dedupe removes self-references and duplicates
- assert alphabetical ordering of children

#### Category 4: Child Note Creation
- Assert child note filenames follow `{parent}-{child}.md` pattern
- Assert child frontmatter includes discovery metadata
- Assert depth limit enforced (no recursive follows)

#### Category 5: Monorepo `/tree/...` Paths
- Assert README extracted from non-root paths
- Assert filename derivation works regardless of path depth
- Assert link-follow discovery works from any README path

---

## Test Harness Integration

### Expected Test Files

1. `tests/templates/github-regression.test.ts` - Unit tests for fixture contracts
2. `tests/e2e/headless-clip-harness-regression.test.ts` - E2E scenarios for real-world repos

### Expected Fixture Files

1. `tests/templates/fixtures/github-regression-vhs.html`
2. `tests/templates/fixtures/github-regression-vhs.contract.json`
3. `tests/templates/fixtures/github-regression-vhs.children.json`
4. (Repeat for lipgloss and crush)

### Expected Test Commands

```bash
# Run regression tests
bun test tests/templates/github-regression.test.ts

# Run headless harness regression scenarios
bun test tests/e2e/headless-clip-harness-regression.test.ts

# Typecheck
bun run typecheck

# Full verification gate
bun test tests/templates/github.test.ts && \
bun test tests/e2e/headless-clip-harness.test.ts && \
bun run typecheck
```

---

## Version Control and Updates

### Contract Versioning
- Increment **major** version when contract structure changes
- Increment **minor** version when adding new fixtures
- Increment **patch** version when clarifying expectations without structural changes

### Change Process
1. Update contract version
2. Add change notes below
3. Update fixture files to match new contract
4. Update tests to assert new contract
5. Update IMPLEMENTATION_PLAN.md slice reference

### Change Log
- **1.0.0** (2026-03-02): Initial contract definition for vhs, lipgloss, crush

---

## References

- **IMPLEMENTATION_PLAN.md**: TASKPAD Intake Slice (2026-03-02): Real-world GitHub link-follow regression matrix
- **TASKPAD.md**: Current pain points for GitHub clipping (package-name filename, monorepo `/tree/...` routes, link-follow failures)
- **Headless Harness Spec**: `docs/quality/headless-harness-spec.md`
- **GitHub Template**: `src/content/templates/github.ts`
