# GitHub README Relative-Link Canonicalization Contract

## Purpose

This contract defines the specification for canonicalizing relative markdown links in GitHub READMEs to absolute GitHub URLs before depth-1 link-follow filtering. This ensures deterministic behavior for processing relative link forms (`./`, `../`, root-relative, `/tree/...`, `/blob/...`) that would otherwise be silently skipped or inconsistently deduped during knowledge-base building.

## Contract Version

- **Version**: 1.0.0
- **Created**: 2026-03-02
- **Slice**: TASKPAD Intake Slice (2026-03-02): GitHub README relative-link canonicalization for depth-1 link-follow parity
- **Status**: Active

## Problem Statement

GitHub README link-follow now handles repo links, but many high-value docs use relative markdown targets that are not guaranteed to resolve into clip-ready canonical URLs:

- **Same-directory relative links**: `./docs/api.md`
- **Parent directory links**: `../README.md`
- **Root-relative links**: `/docs/guide.md`
- **GitHub-specific links**: `/tree/main/docs/api.md`, `/blob/main/src/index.ts`
- **Fragment-only links**: `#installation` (page anchors)

This creates silent capture gaps for knowledge-base building: clipping appears successful while linked sibling documentation is skipped or inconsistently deduped.

## Scope

### In Scope

1. **Relative-link canonicalization** — Deterministic resolution of same-repo relative markdown targets into absolute GitHub URLs
2. **Input form validation** — Recognized relative link patterns and their parsing rules
3. **Normalization rules** — Transformations to produce canonical GitHub URLs
4. **Reject rules** — Stable rejection criteria for non-canonicalizable links
5. **Deterministic ordering** — Stable ordering semantics for processed link lists
6. **Error handling** — Deterministic diagnostics for malformed links

### Out of Scope

1. Multi-depth crawling beyond existing depth-1 limits
2. Non-GitHub link-follow expansion
3. Cross-repo relative link resolution
4. External URL canonicalization
5. Broader intake-pipeline or verification-pack architecture changes

---

## Input Forms: Recognized Relative Link Patterns

### Category 1: Same-Directory Relative Links

#### Pattern: `./filename` or `filename`
- **Description**: Links to files or directories in the same directory as the current README
- **Examples**:
  - `./CONTRIBUTING.md`
  - `docs/api.md`
  - `./docs/guide.md`
- **Resolution**: Base path from current README location → resolve relative path

#### Context
- Current README URL: `https://github.com/owner/repo/blob/main/README.md`
- Link: `./docs/api.md`
- Resolved: `https://github.com/owner/repo/blob/main/docs/api.md`

### Category 2: Parent Directory Links

#### Pattern: `../filename`
- **Description**: Links to files or directories in the parent directory
- **Examples**:
  - `../README.md`
  - `../docs/guide.md`
  - `../../package.json`
- **Resolution**: Navigate up from current README location → resolve relative path

#### Context
- Current README URL: `https://github.com/owner/repo/blob/main/docs/README.md`
- Link: `../CONTRIBUTING.md`
- Resolved: `https://github.com/owner/repo/blob/main/CONTRIBUTING.md`

### Category 3: Root-Relative Links

#### Pattern: `/path/to/file`
- **Description**: Links starting with `/` are relative to repository root
- **Examples**:
  - `/docs/api.md`
  - `/src/index.ts`
  - `/LICENSE`
- **Resolution**: Repository root path → append path

#### Context
- Current README URL: `https://github.com/owner/repo/blob/main/deep/nested/README.md`
- Link: `/docs/guide.md`
- Resolved: `https://github.com/owner/repo/blob/main/docs/guide.md`

### Category 4: GitHub Tree/Blob Links

#### Pattern: `/tree/branch/path` or `/blob/branch/path`
- **Description**: GitHub-specific links to files or directories at specific branches
- **Examples**:
  - `/tree/main/docs/api.md`
  - `/blob/develop/src/index.ts`
  - `/tree/v1.2.3/README.md`
- **Resolution**: Repository root + branch → append path

#### Context
- Current README URL: `https://github.com/owner/repo/blob/main/README.md`
- Link: `/tree/main/docs/guide.md`
- Resolved: `https://github.com/owner/repo/tree/main/docs/guide.md`

### Category 5: Repository-Relative Links (owner/repo form)

#### Pattern: `owner/repo` or `[alias](owner/repo)`
- **Description**: Shorthand links to other repositories in the same organization
- **Examples**:
  - `[related](owner/repo)`
  - `[bubbletea](charmbracelet/bubbletea)`
- **Resolution**: `https://github.com/owner/repo`

#### Context
- Current README URL: `https://github.com/charmbracelet/vhs`
- Link: `[bubbletea](charmbracelet/bubbletea)`
- Resolved: `https://github.com/charmbracelet/bubbletea`

### Category 6: Fragment-Only Links

#### Pattern: `#anchor`
- **Description**: Links to page anchors (fragments)
- **Examples**:
  - `#installation`
  - `#getting-started`
  - `[install](#installation)`
- **Resolution**: **REJECT** — These are page anchors, not separate resources

---

## Normalization Rules: Canonical URL Production

### Rule NL01: URL Resolution Algorithm

For each markdown link target extracted from README content:

1. **Parse** the link target from markdown: `[text](target)`
2. **Classify** the target into one of the input form categories
3. **Resolve** to canonical URL using category-specific rules
4. **Validate** the resolved URL against reject rules
5. **Dedupe** using URL-based deduplication
6. **Sort** deterministically (alphabetical by canonical URL)

### Rule NL02: Branch/Tag Detection

When resolving links, determine the default branch from context:

1. **Primary**: Extract branch from current README URL path (`/blob/{branch}/...` or `/tree/{branch}/...`)
2. **Fallback**: Use repository metadata (default branch from API if available)
3. **Default**: Assume `main` if no branch information is available

#### Examples
- Current URL: `https://github.com/owner/repo/blob/develop/README.md`
- Link: `./docs/api.md`
- Resolved: `https://github.com/owner/repo/blob/develop/docs/api.md` (inherits `develop` branch)

### Rule NL03: Same-Directory Resolution

For `./path` or `path` (no `../` prefix):

```
canonical_url = base_url (without filename) + "/" + relative_path
```

#### Examples
- Base: `https://github.com/owner/repo/blob/main/README.md`
- Link: `./docs/api.md`
- Resolve: `https://github.com/owner/repo/blob/main/docs/api.md`

- Base: `https://github.com/owner/repo/blob/main/docs/README.md`
- Link: `guide.md`
- Resolve: `https://github.com/owner/repo/blob/main/docs/guide.md`

### Rule NL04: Parent Directory Resolution

For `../path` (one or more `../` prefixes):

```
canonical_url = base_url + ("/.." repeated for each prefix) + "/" + relative_path
```

#### Examples
- Base: `https://github.com/owner/repo/blob/main/docs/api/README.md`
- Link: `../guide.md`
- Resolve: `https://github.com/owner/repo/blob/main/docs/guide.md`

- Base: `https://github.com/owner/repo/blob/main/docs/api/README.md`
- Link: `../../README.md`
- Resolve: `https://github.com/owner/repo/blob/main/README.md`

### Rule NL05: Root-Relative Resolution

For `/path` (absolute path within repository):

```
canonical_url = repo_root_url + "/" + relative_path
```

Where `repo_root_url` is: `https://github.com/owner/repo/blob/{branch}/`

#### Examples
- Base: `https://github.com/owner/repo/blob/main/deep/nested/README.md`
- Link: `/docs/api.md`
- Resolve: `https://github.com/owner/repo/blob/main/docs/api.md`

### Rule NL06: GitHub Tree/Blob Resolution

For `/tree/{branch}/path` or `/blob/{branch}/path`:

```
canonical_url = "https://github.com/owner/repo" + "/tree/{branch}/" + path
```

#### Examples
- Base: `https://github.com/owner/repo/blob/main/README.md`
- Link: `/tree/develop/docs/api.md`
- Resolve: `https://github.com/owner/repo/tree/develop/docs/api.md`

- Base: `https://github.com/owner/repo/blob/main/README.md`
- Link: `/blob/v1.2.3/src/index.ts`
- Resolve: `https://github.com/owner/repo/blob/v1.2.3/src/index.ts`

### Rule NL07: Repository Shorthand Resolution

For `owner/repo` pattern (extracted from link text or href):

```
canonical_url = "https://github.com/" + owner + "/" + repo
```

#### Examples
- Link: `[bubbletea](charmbracelet/bubbletea)`
- Resolve: `https://github.com/charmbracelet/bubbletea`

- Link: `[docs](owner/docs)`
- Resolve: `https://github.com/owner/docs`

---

## Reject Rules: Non-Canonicalizable Links

### Reject Rule RJ01: Fragment-Only Links

**Rule ID**: `RJ01_FRAGMENT_ONLY`
**Severity**: `info` (not an error, just excluded)

Reject links that are page anchors only (no resource change).

#### Pattern
- Starts with `#` and has no other path component
- Link text may include `#` but target is fragment-only

#### Examples
- `#installation` → **REJECT**
- `[install](#installation)` → **REJECT**
- `#getting-started` → **REJECT**

#### Rationale
Fragment links navigate within the same page, not to separate resources. They should not trigger additional clipping.

### Reject Rule RJ02: External URLs

**Rule ID**: `RJ02_EXTERNAL_URL`
**Severity**: `info`

Reject links to external domains (not GitHub.com).

#### Pattern
- URL has a non-GitHub domain
- Schemes other than `https:` or `http:`

#### Examples
- `https://example.com/docs` → **REJECT**
- `https://npmjs.com/package/foo` → **REJECT**
- `mailto:user@example.com` → **REJECT**
- `javascript:void(0)` → **REJECT**

#### Rationale
External links are outside the scope of GitHub README link-follow. They may be handled separately.

### Reject Rule RJ03: Unsupported Schemes

**Rule ID**: `RJ03_UNSUPPORTED_SCHEME`
**Severity**: `info`

Reject links with unsupported URL schemes.

#### Pattern
- Non-web schemes: `mailto:`, `tel:`, `ftp:`, `file:`, `data:`, `javascript:`, etc.
- Only `https:` and `http:` are supported

#### Examples
- `mailto:user@example.com` → **REJECT**
- `tel:+1234567890` → **REJECT**
- `ftp://ftp.example.com/file` → **REJECT**
- `data:text/plain,hello` → **REJECT**

#### Rationale
Only HTTP/HTTPS URLs are valid for web clipping. Other schemes represent protocols not supported by the clipper.

### Reject Rule RJ04: Self-References

**Rule ID**: `RJ04_SELF_REFERENCE`
**Severity**: `info`

Reject links that point to the current repository/page (self-links).

#### Pattern
- Resolved URL matches the current README URL exactly
- Resolved URL matches the repository root URL
- Link is `[repo](.)` or `[repo](./)` style self-reference

#### Examples
- Current: `https://github.com/owner/repo/blob/main/README.md`
- Link: `[this repo](.)` → **REJECT**
- Link: `[self](./)` → **REJECT**
- Link: `[repo](../)` → **REJECT** (when at repo root)

#### Rationale
Self-references would create redundant clipping of the same content.

### Reject Rule RJ05: Cross-Repo Relative Links

**Rule ID**: `RJ05_CROSS_REPO_RELATIVE`
**Severity**: `warning` (may indicate malformed link)

Reject relative links that would cross repository boundaries.

#### Pattern
- `../` navigation goes beyond repository root
- Attempted resolution includes paths like `../../other-repo/README.md`

#### Examples
- Current: `https://github.com/owner/repo/blob/main/README.md`
- Link: `../../other-repo/README.md` → **REJECT**

#### Rationale
Cross-repo relative links are not valid GitHub URLs. They likely indicate a broken or malformed link.

### Reject Rule RJ06: Malformed Links

**Rule ID**: `RJ06_MALFORMED_LINK`
**Severity**: `warning`

Reject links that cannot be parsed or resolved.

#### Pattern
- Empty link targets: `[]()`, `[text]()`
- Invalid URL characters after resolution
- Links with only whitespace

#### Examples
- `[empty]()` → **REJECT**
- `[space](   )` → **REJECT**

#### Rationale
Malformed links cannot be resolved to valid URLs.

### Reject Rule RJ07: Non-Markdown Resources

**Rule ID**: `RJ07_NON_MARKDOWN_RESOURCE`
**Severity**: `info` (optional filtering, may be configurable)

Reject links to non-markdown resources (optional based on configuration).

#### Pattern
- File extensions indicating non-markdown content (optional reject list)
- Configurable: images, videos, binaries, etc.

#### Examples (configurable)
- `./images/logo.png` → **REJECT** (if images are excluded)
- `./dist/bundle.js` → **REJECT** (if binaries are excluded)

#### Rationale
Non-markdown resources may not be meaningful for knowledge-base building. This is configurable.

---

## Deterministic Ordering Semantics

### Ordering Rule OR01: Alphabetical by Canonical URL

**Rule ID**: `OR01_ALPHABETICAL_BY_URL`

All canonicalized links MUST be sorted alphabetically by their resolved canonical URL string.

#### Sorting Algorithm
1. Canonicalize all links first (apply normalization rules)
2. Remove rejected links
3. Dedupe by canonical URL
4. Sort the remaining links alphabetically (case-sensitive, standard string comparison)

#### Examples

**Input Links (unsorted):**
```markdown
- [Guide](./docs/guide.md)
- [API](/docs/api.md)
- [Contributing](../CONTRIBUTING.md)
- [Readme](../README.md)
```

**Canonicalized URLs (before sorting):```
- https://github.com/owner/repo/blob/main/docs/guide.md
- https://github.com/owner/repo/blob/main/docs/api.md
- https://github.com/owner/repo/blob/main/CONTRIBUTING.md
- https://github.com/owner/repo/blob/main/README.md
```

**Final Order (alphabetical):**
1. `https://github.com/owner/repo/blob/main/CONTRIBUTING.md`
2. `https://github.com/owner/repo/blob/main/README.md`
3. `https://github.com/owner/repo/blob/main/docs/api.md`
4. `https://github.com/owner/repo/blob/main/docs/guide.md`

### Ordering Rule OR02: Deduplication Strategy

**Rule ID**: `OR02_URL_DEDUPLICATION`

Duplicate links MUST be removed using URL-based deduplication. Two links are considered duplicates if their canonical URLs are identical after normalization.

#### Dedupe Algorithm
1. Normalize all links using NL01-NL07 rules
2. Filter out rejected links
3. Build a set of canonical URLs
4. Keep only the first occurrence of each URL (before sorting)
5. Apply OR01 (alphabetical sorting) to the deduped list

#### Examples

**Input with duplicates:**
```markdown
- [API](./docs/api.md)
- [API Reference](/docs/api.md)  // Same as above after normalization
- [Guide](./docs/guide.md)
- [API Docs](../docs/api.md)  // Same as above after normalization
```

**After canonicalization (before dedupe):**
- `https://github.com/owner/repo/blob/main/docs/api.md` (from `./docs/api.md`)
- `https://github.com/owner/repo/blob/main/docs/api.md` (from `/docs/api.md`)
- `https://github.com/owner/repo/blob/main/docs/guide.md`
- `https://github.com/owner/repo/blob/main/docs/api.md` (from `../docs/api.md`)

**After dedupe (first occurrence kept):**
- `https://github.com/owner/repo/blob/main/docs/api.md`
- `https://github.com/owner/repo/blob/main/docs/guide.md`

### Ordering Rule OR03: Stable Output Ordering

**Rule ID**: `OR03_STABLE_ORDERING`

For identical inputs, the output MUST produce the same ordering every time (deterministic behavior).

#### Requirements
1. Sort algorithm must be stable (preserves order of equal elements, though URLs should be unique)
2. No random factors or timestamp-based ordering
3. URL comparison must be deterministic (same URL strings compare equal)
4. Re-running canonicalization on the same README produces identical output

#### Testing Requirement
- Regression tests MUST assert that the canonicalized link list is identical across multiple runs
- Tests MUST use fixture HTML/markdown with known link structures

---

## Error Handling and Diagnostics

### Error Rule EH01: Malformed Markdown

**Rule ID**: `EH01_MALFORMED_MARKDOWN`
**Severity**: `warning`

Issue with parsing markdown link syntax.

#### Detection
- Invalid markdown link syntax: `[text` (missing closing bracket)
- Unclosed link: `[text](url` (missing closing parenthesis)
- Nested brackets causing ambiguity

#### Action
- Emit diagnostic warning with link context
- Skip the malformed link (treat as rejected)
- Continue processing other links

### Error Rule EH02: Resolution Failure

**Rule ID**: `EH02_RESOLUTION_FAILURE`
**Severity**: `warning`

Unable to resolve relative link to canonical URL.

#### Detection
- `../` navigation goes beyond repository root
- Invalid characters in path components
- URL construction produces invalid URL

#### Action
- Emit diagnostic with original link and resolution failure reason
- Treat as rejected link
- Continue processing other links

### Error Rule EH03: Branch Detection Failure

**Rule ID**: `EH03_BRANCH_DETECTION_FAILURE`
**Severity**: `warning`

Unable to determine default branch for repository.

#### Detection
- No branch in current README URL
- Repository metadata unavailable
- API call to detect branch fails (if API is used)

#### Action
- Fall back to `main` as default branch
- Emit diagnostic warning about fallback behavior
- Continue with assumed branch

---

## Contract Compliance Matrix

| Category | Input Form | Normalization Rule | Reject Rule | Ordering Rule |
|----------|------------|-------------------|-------------|---------------|
| Same-directory | `./path`, `path` | NL03 | — | OR01, OR02, OR03 |
| Parent directory | `../path` | NL04 | RJ05 (if cross-repo) | OR01, OR02, OR03 |
| Root-relative | `/path` | NL05 | — | OR01, OR02, OR03 |
| GitHub tree/blob | `/tree/branch/path` | NL06 | — | OR01, OR02, OR03 |
| Repository shorthand | `owner/repo` | NL07 | — | OR01, OR02, OR03 |
| Fragment-only | `#anchor` | — | RJ01 | — |
| External URL | `https://example.com` | — | RJ02 | — |
| Unsupported scheme | `mailto:...` | — | RJ03 | — |
| Self-reference | `.`, `./`, `../` (at root) | — | RJ04 | — |

---

## Implementation Expectations

### TP002: Normalization Helper Implementation

The normalization helper (TP002) MUST implement:

1. **Link parser** — Extract markdown link targets from README content
2. **Link classifier** — Categorize links into input form categories
3. **URL resolver** — Apply NL01-NL07 normalization rules
4. **Reject filter** — Apply RJ01-RJ07 reject rules
5. **Deduper** — Apply OR02 URL deduplication
6. **Sorter** — Apply OR01 alphabetical ordering

### TP003: Integration into Link-Follow Extraction

The integration (TP003) MUST:

1. **Canonicalize before filtering** — Apply canonicalization before depth-1 filtering
2. **Preserve metadata** — Track discovery source, context section, link text
3. **Emit diagnostics** — Provide deterministic diagnostics for rejected links
4. **Maintain stability** — Ensure deterministic output across runs

### TP004: Fixture + Template Coverage

Tests (TP004) MUST cover:

1. **Canonicalization pass/fail classes** — Each input form and reject rule
2. **Deterministic ordering** — Alphabetical sorting stability
3. **Deduplication** — Duplicate link removal
4. **Branch detection** — Branch inheritance and fallback behavior
5. **Error handling** — Malformed links and resolution failures

---

## Verification Commands

```bash
# Typecheck (ensure no compilation errors)
bun run typecheck

# GitHub template unit tests (including canonicalization tests)
bun test tests/templates/github.test.ts

# Headless harness E2E scenarios (end-to-end validation)
bun test tests/e2e/headless-clip-harness.test.ts

# GitHub reported-failures regression gate
bun run test:github:reported-failures
```

---

## Document References

- **IMPLEMENTATION_PLAN.md**: TASKPAD Intake Slice (2026-03-02): GitHub README relative-link canonicalization
- **tests/fixtures/github-regression-fixtures.md**: Regression fixture contracts
- **docs/quality/github-regression-gate.md**: GitHub regression quality gate
- **README.md**: GitHub clipping quality documentation

---

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-02 | Initial contract specification for TP001 |
