# Obsidian Web Clipper - Implementation Plan

> Intake-driven execution plan. Keep one active, high-impact/low-risk unchecked slice at the top.

---

> Trimmed to active TASKPAD intake slices only.
> Archived legacy/completed phases: `docs/archive/IMPLEMENTATION_PLAN_ARCHIVE_2026-02-26.md`

---

## TASKPAD Intake Slice (2026-03-03): Execution Queue archive-prune + parity gate for executable queue hygiene

### Distilled Scope
**Problem**
- Queue-health now treats `## Execution Queue` as an executable intake surface, but archival tooling only prunes `## Work Queue` completed/planned bullets.
- As execution-ops intake grows, stale checked entries in `## Execution Queue` can accumulate and dilute active signal quality for autonomous queue-health and ideation flows.
- There is no deterministic parity gate proving Execution Queue archive entries match exactly what was pruned from TASKPAD.

**In scope**
- Add deterministic `taskpad:execution-queue-prune` command to archive completed/planned `## Execution Queue` bullets into monthly `docs/archive/TASKPAD_ARCHIVE_YYYY-MM.md` while preserving unchecked execution tasks.
- Add deterministic `taskpad:execution-queue-archive-parity` gate that validates archive↔TASKPAD fingerprint parity for pruned Execution Queue entries.
- Add focused fixtures/tests for prune pass/noop/missing-section and parity pass/fail drift states.
- Wire scripts/docs so execution-queue prune + parity can run in canonical intake-auto verification flow.

**Out of scope**
- Product clipping/extractor behavior changes.
- Queue ranking heuristics or target-queue routing logic redesign.
- Work Queue prune semantics (already covered by existing tooling).

### Ideation Candidates Considered
1. **[AUTOMATION]** Add `taskpad:execution-queue-prune` + `taskpad:execution-queue-archive-parity` to keep secondary executable queue history compact and auditable. **(selected)**
2. **[RELIABILITY]** Add `taskpad:queue-heading-bootstrap` to auto-create missing executable queue sections when queue-health fails on missing headings.
3. **[OBSERVABILITY]** Add `taskpad:executable-queue-drift-report` summarizing Work vs Execution queue stale/active ratios per run.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "taskpad:auto-ideation|taskpad:intake-autoplan|taskpad:queue-health|work-queue|execution queue|verification-pack"`
  - `select set IMPLEMENTATION_PLAN.md tools/taskpad-auto-ideation.ts tools/taskpad-intake-autoplan.ts tools/taskpad-queue-health.ts tests/tools/taskpad-auto-ideation.test.ts tests/tools/taskpad-intake-autoplan.test.ts README.md package.json docs/quality/taskpad-auto-ideation.md docs/quality/taskpad-queue-health.md`
  - `context --files --tree`
- **Selected files (core):**
  - `tools/taskpad-queue-health.ts`
  - `tools/taskpad-intake-autoplan.ts`
  - `tools/taskpad-auto-ideation.ts`
  - `tests/tools/taskpad-intake-autoplan.test.ts`
  - `tests/tools/taskpad-auto-ideation.test.ts`
  - `docs/quality/taskpad-queue-health.md`
  - `package.json`

### Task Graph
- [x] **TP001**: Define `taskpad:execution-queue-prune` + `taskpad:execution-queue-archive-parity` contracts (inputs, archive policy, fingerprint schema, deterministic rule IDs, output ordering).
- [ ] **TP002**: Implement `tools/taskpad-execution-queue-prune.ts` to archive checked/planned Execution Queue bullets while preserving unchecked entries and deterministic summaries.
- [ ] **TP003**: Implement `tools/taskpad-execution-queue-archive-parity.ts` to validate archive↔TASKPAD fingerprint parity and fail with actionable drift diagnostics.
- [ ] **TP004**: Add fixtures/tests (`tests/tools/taskpad-execution-queue-prune.test.ts`, `tests/tools/taskpad-execution-queue-archive-parity.test.ts`) covering pass/noop/missing-section and parity drift outcomes.
- [ ] **TP005**: Wire scripts/docs (`package.json`, `README.md`, `docs/quality/taskpad-queue-health.md`) and integrate execution-queue prune/parity commands into intake-auto verification guidance.

### Acceptance Criteria
- Execution Queue prune archives only checked/planned `## Execution Queue` bullets and preserves unchecked executable items.
- Archive parity gate deterministically detects missing/extra/mutated archived Execution Queue entries.
- Tests lock stable diagnostics and pass/noop/fail behavior for prune + parity commands.
- Canonical scripts/docs include execution-queue prune/parity in machine-auditable intake verification flow.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-execution-queue-prune.test.ts
bun test tests/tools/taskpad-execution-queue-archive-parity.test.ts
bun run taskpad:execution-queue-prune -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" --format json
bun run taskpad:execution-queue-archive-parity -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" --format json
bun run verify:taskpad:intake:auto -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
```

## TASKPAD Intake Slice (2026-03-03): Work Queue archive-prune + parity gate for deterministic ideation signal

### Distilled Scope
**Problem**
- `TASKPAD.md` currently accumulates large volumes of checked/planned `## Work Queue` bullets, which degrades ideation readability and weakens queue-health signal quality even when executable queues are empty.
- Existing `taskpad:plan-prune` targets `IMPLEMENTATION_PLAN.md` slices, but there is no canonical Work Queue prune command + parity gate that proves archived entries exactly match removed bullets.
- Without deterministic Work Queue archive parity, intake loops can drift between what was marked planned and what remains visible in TASKPAD, increasing false confidence in autonomous planning runs.

**In scope**
- Add deterministic `taskpad:work-queue-prune` command that archives completed/planned Work Queue bullets into monthly `docs/archive/TASKPAD_ARCHIVE_YYYY-MM.md` while preserving unchecked active items in TASKPAD.
- Add deterministic `taskpad:work-queue-archive-parity` gate validating one-to-one fingerprint parity between pruned TASKPAD bullets and archive entries.
- Add focused fixtures/tests for prune pass/noop/missing-section and archive-parity pass/fail drift states.
- Wire canonical script/docs coverage so intake-auto flows can invoke Work Queue pruning with machine-readable outcomes.

**Out of scope**
- Product clipping/extractor feature changes.
- Re-ranking ideation candidate heuristics.
- Broad redesign of TASKPAD schema outside Work Queue prune/parity surfaces.

### Ideation Candidates Considered
1. **[AUTOMATION]** Add deterministic `taskpad:work-queue-prune` + `taskpad:work-queue-archive-parity` flow and wire into intake-auto so completed Work Queue history is archived without losing auditability. **(selected)**
2. **[RELIABILITY]** Add `taskpad:work-queue-staleness-gate` that fails when checked/planned Work Queue density exceeds threshold and suggests prune actions.
3. **[OBSERVABILITY]** Add `taskpad:queue-burndown-report` telemetry for unchecked/planned/archived queue deltas per intake run.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "markitdown|document conversion|golden-corpus|retirement-contract|auto-ideation|work queue"`
  - `search "queue-health|workQueueUncheckedCount|QH001_EXECUTABLE_QUEUES_EMPTY|plan-prune|planned-command-parity|implementation-plan-integrity" package.json tools tests docs/quality README.md`
  - `select set IMPLEMENTATION_PLAN.md tools/taskpad-queue-health.ts tools/taskpad-auto-ideation.ts tools/taskpad-planned-command-parity.ts tools/taskpad-plan-prune.ts tests/tools/taskpad-queue-health.test.ts tests/tools/taskpad-auto-ideation.test.ts docs/quality/taskpad-queue-health.md README.md package.json`
  - `context --files --tree`
- **Selected files (core):**
  - `tools/taskpad-plan-prune.ts`
  - `tools/taskpad-queue-health.ts`
  - `tools/taskpad-auto-ideation.ts`
  - `tests/tools/taskpad-queue-health.test.ts`
  - `docs/quality/taskpad-queue-health.md`
  - `README.md`
  - `package.json`

### Task Graph
- [x] **TP001**: Define `taskpad:work-queue-prune` and `taskpad:work-queue-archive-parity` contracts (inputs, archive path policy, fingerprint schema, deterministic rule IDs, and JSON output ordering).
- [x] **TP002**: Implement `tools/taskpad-work-queue-prune.ts` to archive checked/planned Work Queue bullets atomically, preserve unchecked bullets in-place, and emit deterministic prune summaries.
- [x] **TP003**: Implement `tools/taskpad-work-queue-archive-parity.ts` to validate archive↔TASKPAD fingerprint parity and fail with actionable rule-ID diagnostics on drift.
- [x] **TP004**: Add fixtures + tests (`tests/tools/taskpad-work-queue-prune.test.ts`, `tests/tools/taskpad-work-queue-archive-parity.test.ts`) covering pass/noop/missing-heading and parity drift conditions.
- [x] **TP005**: Wire scripts/docs (`package.json`, `README.md`, `docs/quality/taskpad-queue-health.md`) and integrate canonical invocation into intake-auto verification flow.

### Acceptance Criteria
- Running Work Queue prune archives only checked/planned Work Queue bullets and leaves unchecked executable items intact.
- Archive parity gate deterministically detects missing/extra/mutated archive entries against TASKPAD source fingerprints.
- New tests lock pass/noop/fail behavior and stable diagnostics ordering.
- Canonical scripts/docs make prune + parity invocations part of machine-auditable intake-auto flow.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-work-queue-prune.test.ts
bun test tests/tools/taskpad-work-queue-archive-parity.test.ts
bun run taskpad:work-queue-prune -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" --format json
bun run taskpad:work-queue-archive-parity -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" --format json
bun run verify:taskpad:intake:auto -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
```

## TASKPAD Intake Slice (2026-03-03): Work Queue parity-count correctness for auto-ideation routing

### Distilled Scope
**Problem**
- `taskpad:auto-ideation` currently computes `queueParityStatus.targetQueueUncheckedCount` for `--target-queue work` using `autonomousUncheckedCount` instead of `workQueueUncheckedCount`, which can report incorrect parity state even when Work Queue routing succeeds.
- This creates false diagnostics in autonomous intake flows (`verify:taskpad:intake:auto`) and weakens confidence in queue-readiness telemetry used for planning decisions.
- With no unchecked intake queue items available, this is the highest-impact reliability correction to keep ideation/autoplan reporting trustworthy.

**In scope**
- Correct Work Queue parity-count source mapping in `taskpad:auto-ideation` so `targetQueue="work"` derives from `workQueueUncheckedCount`.
- Add deterministic test coverage for empty/mixed queue states that previously masked this mismatch.
- Extend intake-autoplan verification coverage so Work Queue-target ideation assertions fail on parity-field regressions.
- Update quality docs with the corrected queueParityStatus contract examples.

**Out of scope**
- New product clipping capabilities.
- Queue ranking/scoring heuristic redesign.
- Broad mutator-contract refactors beyond this parity-count correctness slice.

### Ideation Candidates Considered
1. **[RELIABILITY]** Fix Work Queue parity accounting in `taskpad:auto-ideation` so `queueParityStatus` uses `workQueueUncheckedCount` for Work Queue routing. **(selected)**
2. **[RELIABILITY]** Add cross-queue parity contract tests that compare reported target counts against `taskpad:queue-health` for every target queue.
3. **[AUTOMATION]** Add an intake-auto parity audit command that snapshots pre/post queue metrics and flags mismatched target-queue counters.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "chatgpt|response-only|frontmatter|save mode|clip action|work queue|execution queue|verification-pack"`
  - `select set IMPLEMENTATION_PLAN.md tools/taskpad-auto-ideation.ts tests/tools/taskpad-auto-ideation.test.ts docs/quality/taskpad-auto-ideation.md`
  - `context --files --tree`
- **Selected files (core):**
  - `tools/taskpad-auto-ideation.ts`
  - `tests/tools/taskpad-auto-ideation.test.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `IMPLEMENTATION_PLAN.md`

### Task Graph
- [x] **TP001**: Define the parity-count correctness contract for Work Queue routing (`targetQueue=work`) and document expected `queueParityStatus` values for empty, seeded, and mixed queue states.
- [x] **TP002**: Patch `computeQueueParityStatus` so Work Queue-target calculations read from `workQueueUncheckedCount` (not intake-queue counters) with deterministic behavior preserved.
- [x] **TP003**: Add/adjust `tests/tools/taskpad-auto-ideation.test.ts` coverage to assert Work Queue parity counts and `parityStatus` outcomes across seeded + no-op scenarios.
- [x] **TP004**: Extend `tests/tools/taskpad-intake-autoplan.test.ts` (or nearest intake-auto suite) to assert downstream parity integrity when auto-ideation is invoked with `--target-queue work`.
- [x] **TP005**: Update `docs/quality/taskpad-auto-ideation.md` examples/checklists so `queueParityStatus` references the corrected Work Queue count semantics.

### Acceptance Criteria
- Work Queue-target ideation reports `queueParityStatus.targetQueueUncheckedCount` from Work Queue unchecked items only.
- Empty/mixed queue fixtures fail before the fix and pass after the fix with deterministic outputs.
- Intake-auto orchestration tests catch parity-count regressions on Work Queue-target runs.
- Documentation examples and evidence checklists match implemented parity semantics.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-auto-ideation.test.ts
bun test tests/tools/taskpad-intake-autoplan.test.ts
bun run verify:taskpad:intake:auto -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
```

## TASKPAD Intake Slice (2026-03-02): Queue-health executable coverage for Work/Execution queue empty-state detection

### Distilled Scope
**Problem**
- Current intake automation can report queue health based on autonomous/self-improvement sections while missing whether there are executable unchecked items in `## Work Queue` and `## Execution Queue`.
- The present TASKPAD state demonstrates this gap: intake sections can appear healthy for automation paths while the real execution queues have no unchecked work, forcing manual intervention.
- This weakens autonomous ideation/autoplan reliability and can produce false-green readiness when no immediately runnable item exists.

**In scope**
- Expand queue-health parsing to include unchecked counts/signals for `## Work Queue` and `## Execution Queue` alongside existing autonomous/self-improvement metrics.
- Update intake-auto decision logic to treat "no unchecked executable queue items" as the canonical ideation trigger condition.
- Add deterministic diagnostics fields so command output explicitly reports per-queue unchecked counts and executable readiness verdicts.
- Add fixtures/tests for mixed queue states (work-only, execution-only, autonomous-only, fully empty, and mixed checked/planned states).
- Document the updated queue-health contract and autonomous intake behavior.

**Out of scope**
- Product clipping feature implementation.
- Re-ranking ideation candidate heuristics beyond queue readiness gating.
- Broad TASKPAD schema redesign.

### Ideation Candidates Considered
1. **[RELIABILITY]** Expand queue-health and intake-auto gates to include `Work Queue` + `Execution Queue` unchecked coverage so empty executable states are detected deterministically. **(selected)**
2. **[AUTOMATION]** Add a `taskpad:queue-bootstrap` command that seeds one Work Queue item when all executable queues are empty.
3. **[OBSERVABILITY]** Add queue-state trend telemetry to track day-over-day drift between planned markers and executable unchecked items.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "test-vault|headless|github|verification-pack|clip-scenario-manifest|queue-health|auto-ideation"`
  - `search "taskpad:verification-pack-repair|taskpad:verification-pack-refresh|taskpad:verification-pack-execution-gate|verify:taskpad:intake:auto|taskpad:queue-health" package.json README.md tools tests docs/quality`
  - `search "taskpad:plan-prune|queue compactor|archive completed work queue|TASKPAD_ARCHIVE|trimmed to active" tools tests docs README.md package.json`
  - `search "taskpad:plan-prune" package.json tools/tests docs README.md`
  - `select set IMPLEMENTATION_PLAN.md package.json tools/taskpad-auto-ideation.ts tools/taskpad-intake-autoplan.ts tools/taskpad-queue-health.ts tools/taskpad-plan-prune.ts tests/tools/taskpad-auto-ideation.test.ts tests/tools/taskpad-intake-autoplan.test.ts docs/quality/taskpad-auto-ideation.md`
  - `context --files --tree`
- **Selected files (core):**
  - `tools/taskpad-queue-health.ts`
  - `tools/taskpad-intake-autoplan.ts`
  - `tools/taskpad-auto-ideation.ts`
  - `tests/tools/taskpad-intake-autoplan.test.ts`
  - `tests/tools/taskpad-auto-ideation.test.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `package.json`

### Task Graph
- [x] **TP001**: Define queue-health contract updates for executable queues (`Work Queue`, `Execution Queue`) including deterministic per-section count fields and readiness semantics.
- [x] **TP002**: Implement parser updates in `tools/taskpad-queue-health.ts` to count unchecked items across all required sections with stable JSON/human output ordering.
- [x] **TP003**: Update intake orchestration (`tools/taskpad-intake-autoplan.ts` and related callsites) to use executable-queue-aware readiness checks for auto-ideation/autoplan branching.
- [x] **TP004**: Add/extend fixtures and tests for queue-health and intake-autoplan to cover fully-empty executable queues, partial coverage, and non-regression on legacy autonomous/self-improvement-only cases.
- [x] **TP005**: Update README/quality docs with the new executable queue-health contract and canonical verification flow.

### Acceptance Criteria
- Queue-health outputs include deterministic unchecked counts for `Work Queue` and `Execution Queue` in addition to existing intake queues.
- Intake auto flow triggers ideation when executable queues are empty, even if non-executable backlog sections contain unchecked items.
- Fixture-backed tests fail on queue coverage drift and pass deterministically for mixed queue states.
- Documentation matches implemented behavior and verification commands.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-queue-health.test.ts
bun test tests/tools/taskpad-intake-autoplan.test.ts
bun run verify:taskpad:intake:auto -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
```

## TASKPAD Intake Slice (2026-03-02): GitHub README relative-link canonicalization for depth-1 link-follow parity

### Distilled Scope
**Problem**
- GitHub README link-follow now handles repo links, but many high-value docs use relative markdown targets (`./docs/...`, `../`, anchors, and root-relative `/tree/...`) that are not guaranteed to resolve into clip-ready canonical URLs.
- This creates silent capture gaps for knowledge-base building: clipping appears successful while linked sibling documentation is skipped or inconsistently deduped.
- Current intake context is saturated with verification automation; the highest product-impact follow-on is improving actual clipped content completeness for GitHub READMEs.

**In scope**
- Add deterministic GitHub README relative-link normalization that resolves same-repo markdown links (`./`, `../`, `/tree/...`, `/blob/...`) into canonical absolute GitHub URLs before depth-1 link-follow filtering.
- Enforce stable allow/deny rules for non-repo/external links, fragment-only links, and unsupported schemes.
- Preserve deterministic dedupe and sibling-note naming parity after normalization.
- Add fixture + template/headless regression coverage for relative-link resolution outcomes.
- Document canonical relative-link follow behavior in GitHub clipping quality docs.

**Out of scope**
- Multi-depth crawling beyond existing depth-1 limits.
- Non-GitHub link-follow expansion.
- Broad intake-pipeline or verification-pack architecture changes.

### Ideation Candidates Considered
1. **[PRODUCT]** Add GitHub README relative-link canonicalization (`./`, `../`, `/tree/...`, `/blob/...`) before depth-1 clipping with deterministic dedupe parity. **(selected)**
2. **[RELIABILITY]** Add GitHub fixture freshness watchdog that fails when reported-failure fixtures drift from live canonical URL forms.
3. **[AUTOMATION]** Add Work Queue completion archival compactor to keep active TASKPAD context lean for ideation ranking.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper"`
  - `search "verification-pack|auto-ideation|Work Queue|Current pain points|headless" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper"`
  - `select set "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/SCRATCHPAD.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/IMPLEMENTATION_PLAN.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TEST_REQUIREMENTS.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/docs/archive/TASKPAD_ARCHIVE_2026-03.md"`
  - `context --files --tree`
- **Selected files (core):**
  - `8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/SCRATCHPAD.md`
  - `8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md`
  - `8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/IMPLEMENTATION_PLAN.md`
  - `8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TEST_REQUIREMENTS.md`
  - `8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/docs/archive/TASKPAD_ARCHIVE_2026-03.md`

### Task Graph
- [x] **TP001**: Specify relative-link canonicalization contract for GitHub README parsing (input forms, normalized URL rules, reject rules, and deterministic ordering semantics).
- [x] **TP002**: Implement normalization helper for same-repo relative targets (`./`, `../`, root-relative `/`, `/tree/...`, `/blob/...`) with repo-branch/path awareness.
- [x] **TP003**: Integrate canonicalization into README link-follow extraction before depth-1 filtering and dedupe passes.
- [x] **TP004**: Extend template-level GitHub tests with fixture cases covering canonicalization pass/fail classes and deterministic sibling-target ordering.
- [x] **TP005**: Extend headless harness scenarios to validate note creation parity for normalized relative-link targets in disposable vault runs.
- [x] **TP006**: Update docs/verification guidance to codify relative-link follow behavior and expected command sequence for regression checks.

### Acceptance Criteria
- README links using `./`, `../`, root-relative, `/tree/...`, and `/blob/...` forms are deterministically normalized to canonical GitHub URLs before depth-1 clipping.
- Fragment-only, external, and unsupported scheme links are filtered with stable diagnostics/behavior.
- Template + headless tests fail on canonicalization drift and pass with stable ordering/dedupe outcomes.
- Regression docs clearly describe supported relative-link behavior and verification flow.

### Verification Commands
```bash
bun run typecheck
bun test tests/templates/github.test.ts
bun test tests/e2e/headless-clip-harness.test.ts
bun run test:github:reported-failures
```

## TASKPAD Intake Slice (2026-03-02): GitHub regression contract parity gate for live verification references

### Distilled Scope
**Problem**
- The current TASKPAD context emphasizes deterministic verification, but `tests/fixtures/github-regression-fixtures.md` still references non-live test entrypoints (`tests/templates/github-regression.test.ts`, `tests/e2e/headless-clip-harness-regression.test.ts`) that do not exist in the repo.
- This allows docs/contracts to drift from executable command surfaces, creating false confidence in regression readiness and violating the intake expectation that verification commands are fully runnable.
- Without an explicit parity gate for GitHub regression contracts, future loops can reintroduce stale test references while `test:github:reported-failures` still appears healthy.

**In scope**
- Add `taskpad:github-regression-contract-parity` to validate GitHub regression contract docs and mapped verification commands against live repo files/scripts.
- Validate declared regression test files + commands from contract docs (`tests/fixtures/github-regression-fixtures.md`, related quality docs) and emit deterministic failures for missing paths/scripts.
- Emit stable machine-readable diagnostics and remediation hints that point to canonical live commands (`test:github:reported-failures`, `tests/templates/github.test.ts`, `tests/e2e/headless-clip-harness.test.ts`).
- Add fixture-backed tests for pass/fail/noop parity states and deterministic output ordering.
- Document parity-gate usage in regression quality docs/README verification sequence.

**Out of scope**
- New GitHub clipping product behavior.
- Expanding link-follow depth or adding new regression fixture domains.
- Broad intake-pipeline redesign beyond this focused GitHub regression parity gate.

### Ideation Candidates Considered
1. **[RELIABILITY]** Add `taskpad:github-regression-contract-parity` gate enforcing live file/script parity for GitHub regression contract docs and verification references. **(selected)**
2. **[AUTOMATION]** Add `taskpad:github-regression-contract-refresh` to rewrite stale doc command blocks from current package scripts/test paths.
3. **[OBSERVABILITY]** Add `taskpad:github-regression-contract-history` NDJSON telemetry tracking drift rule IDs and first-seen/last-seen stale references.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "clip-scenario-manifest|required: true|test-vault-sandbox|headless-clip-harness"`
  - `select set IMPLEMENTATION_PLAN.md package.json tests/fixtures/github-regression-fixtures.md tests/templates/github.test.ts tests/e2e/headless-clip-harness.test.ts docs/quality/github-regression-gate.md tools/taskpad-verification-pack-contract.ts tools/taskpad-verification-pack.ts tools/taskpad-planned-command-parity.ts`
  - `context --files --tree`
- **Selected files (core):**
  - `tests/fixtures/github-regression-fixtures.md`
  - `docs/quality/github-regression-gate.md`
  - `package.json`
  - `tests/templates/github.test.ts`
  - `tests/e2e/headless-clip-harness.test.ts`
  - `tools/taskpad-planned-command-parity.ts`

### Task Graph
- [x] **TP001**: Define `taskpad:github-regression-contract-parity` contract (inputs, allowed reference surfaces, rule IDs, deterministic output schema, and severity mapping).
- [x] **TP002**: Implement parser/extractor for GitHub regression contract docs that resolves declared test files and command references with deterministic normalization.
- [x] **TP003**: Implement parity evaluator that validates extracted references against live repo files and `package.json` scripts, including canonical command mapping hints.
- [x] **TP004**: Emit deterministic diagnostics/remediation payloads for missing file paths, stale command references, and unsupported reference formats.
- [x] **TP005**: Add fixture corpus + `tests/tools/taskpad-github-regression-contract-parity.test.ts` covering pass/fail/noop and stable ordering.
- [x] **TP006**: Wire npm script/docs updates (`taskpad:github-regression-contract-parity`, README, regression quality docs) and integrate the gate into the reported-failures verification flow.

### Acceptance Criteria
- `bun run taskpad:github-regression-contract-parity -- --fixtures-doc tests/fixtures/github-regression-fixtures.md --package package.json --format json` fails deterministically when contract docs reference non-existent tests/scripts.
- On aligned references, the gate passes with stable diagnostics and zero drift violations.
- Test coverage locks deterministic rule IDs/order for missing-file, missing-script, and stale-command classes.
- Regression docs/verification guidance clearly point to live canonical command surfaces used by autonomous intake loops.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-github-regression-contract-parity.test.ts
bun run taskpad:github-regression-contract-parity -- --fixtures-doc tests/fixtures/github-regression-fixtures.md --package package.json --format json
bun run test:github:reported-failures
```

## TASKPAD Intake Slice (2026-03-02): Real-world GitHub link-follow regression matrix for known failing repos

### Distilled Scope
**Problem**
- TASKPAD pain points still call out GitHub link-follow failures for `charmbracelet/vhs`, `charmbracelet/lipgloss`, and `charmbracelet/crush`, even after recent README/link-follow planning slices were marked planned.
- Current tests validate generic GitHub behavior but do not lock deterministic coverage for these known failing real-world URLs, leaving regression risk on the exact user-reported cases.
- Without fixture-backed parity on these URLs, autonomous loops can report green while practical clipping quality drifts on high-value knowledge-capture repos.

**In scope**
- Add deterministic fixtures + expectations for the three known failing GitHub repos and their README link-follow outcomes.
- Extend GitHub template and headless harness tests to assert package-name filename parity, `/tree/...` README extraction parity, and depth-1 sibling note creation for these concrete URLs.
- Ensure deterministic ordering/dedupe expectations for link-follow outputs so reruns remain stable for autonomous verification.
- Document this matrix as the canonical regression gate for reported GitHub link-follow failures.

**Out of scope**
- New product features beyond regression coverage for the already-defined GitHub clipping behavior.
- Changes to broader TASKPAD intake tooling/verification-pack pipeline.
- Multi-depth crawling or non-GitHub link-follow expansion.

### Ideation Candidates Considered
1. **[RELIABILITY]** Add real-world regression fixtures/tests for the three reported failing GitHub URLs (`vhs`, `lipgloss`, `crush`) across template + headless harness parity. **(selected)**
2. **[AUTOMATION]** Add `test:github:reported-failures` orchestration command that bundles deterministic fixture refresh + targeted regression run envelope.
3. **[OBSERVABILITY]** Add a GitHub link-follow evidence report artifact summarizing per-URL clipped children, dedupe decisions, and filename outputs for recent runs.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "Work Queue|Current pain points|Scratchpad|test vault|headless"`
  - `select set IMPLEMENTATION_PLAN.md README.md tests/e2e/headless-clip-harness.test.ts tests/e2e/support/test-vault-sandbox.ts src/content/templates/github.ts docs/quality/taskpad-auto-ideation.md`
  - `context --files --tree`
- **Selected files (core):**
  - `src/content/templates/github.ts`
  - `tests/e2e/headless-clip-harness.test.ts`
  - `tests/e2e/support/test-vault-sandbox.ts`
  - `README.md`
  - `IMPLEMENTATION_PLAN.md`

### Task Graph
- [x] **TP001**: Define deterministic real-world GitHub regression fixture contract for `vhs`, `lipgloss`, and `crush` (inputs, expected README extraction mode, expected link-follow children, and stable ordering rules).
- [x] **TP002**: Add/curate fixture corpus and expected outputs covering package-name filename derivation + `/tree/...` README extraction for the three target repos.
- [x] **TP003**: Extend `tests/templates/github.test.ts` assertions to validate deterministic link-follow + dedupe behavior against the new real-world fixtures.
- [x] **TP004**: Extend `tests/e2e/headless-clip-harness.test.ts` scenario matrix to include deterministic pass/fail gates for the three reported URLs using disposable test-vault outputs.
- [x] **TP005**: Update README/quality docs with the canonical reported-failures regression gate and verification run sequence.

### Acceptance Criteria
- Running `bun test tests/templates/github.test.ts` includes deterministic assertions for `vhs`, `lipgloss`, and `crush` fixture flows and fails on link-follow/filename parity drift.
- Running `bun test tests/e2e/headless-clip-harness.test.ts` validates end-to-end clipping parity for the three reported URLs in disposable test-vault runs.
- Regression outputs remain deterministic across reruns (stable ordering, dedupe outcomes, and expected sibling note creation).
- Docs clearly identify this matrix as the required gate for user-reported GitHub link-follow failures before handoff.

### Verification Commands
```bash
bun run typecheck
bun test tests/templates/github.test.ts
bun test tests/e2e/headless-clip-harness.test.ts
bun run verify:taskpad:intake:full -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
```

## TASKPAD Intake Slice (2026-03-02): Verification-pack execution gate for runtime-proofed Builder handoff

### Distilled Scope
**Problem**
- Current intake safeguards (`taskpad:planned-command-parity`, verification-pack contract/readiness checks, and history telemetry) validate structure and liveness, but they do not prove that the newest verification-pack command set can execute successfully in the current repo state.
- This leaves a remaining false-green path: a pack can be syntactically valid while at least one referenced command fails at runtime, causing Builder-loop stalls after handoff.
- TASKPAD context is now saturated with verification-pack lineage work, making runtime-proof enforcement the highest-impact reliability follow-on.

**In scope**
- Add `taskpad:verification-pack-execution-gate` to evaluate the newest verification-pack command set against deterministic execution policy (`allowed commands`, `guarded invocation`, `stable verdict envelope`).
- Reuse verification-pack + contract artifacts to avoid duplicate parsing and guarantee gate inputs are tied to current TASKPAD/plan fingerprints.
- Emit deterministic machine-readable diagnostics for per-command outcomes and failure taxonomy (e.g., missing script, non-zero exit, unsupported command class, stale pack linkage).
- Add focused fixtures/tests for pass, deterministic fail classes, and stable output ordering.
- Document execution-gate usage and compose it into canonical intake verification flow.

**Out of scope**
- Product clipping/extractor feature changes.
- Rewriting existing verification-pack schema beyond fields needed for execution gate linkage.
- Broad intake orchestration redesign outside adding this gate and its contract coverage.

### Ideation Candidates Considered
1. **[RELIABILITY]** Add `taskpad:verification-pack-execution-gate` to require deterministic runtime-proof of newest pack commands before Builder handoff. **(selected)**
2. **[AUTOMATION]** Add `taskpad:verification-pack-remediate` orchestration that runs autofix + refresh on contract/readiness failures and emits one next-action packet.
3. **[OBSERVABILITY]** Add `taskpad:verification-pack-failure-clusters` reporting to rank recurring gate failures by rule ID + command surface drift.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "verification-pack-refresh|verification-pack-readiness-gate|verification-pack-drift-report|verification-pack-autofix"`
  - `search "taskpad:verification-pack|verification-pack-contract|verification-pack-history|taskpad:verification-pack-readiness-gate"`
  - `select set IMPLEMENTATION_PLAN.md package.json README.md tools/taskpad-verification-pack.ts tools/lib/taskpad-verification-pack-history.ts tests/tools/taskpad-verification-pack-history.test.ts docs/quality/taskpad-verification-pack-history.md`
  - `context --files --tree`
- **Selected files (core):**
  - `tools/taskpad-verification-pack.ts`
  - `tools/lib/taskpad-verification-pack-history.ts`
  - `tests/tools/taskpad-verification-pack-history.test.ts`
  - `docs/quality/taskpad-verification-pack-history.md`
  - `package.json`
  - `README.md`

### Task Graph
- [x] **TP001**: Define execution-gate contract (`input sources`, `allowed command policy`, rule IDs, deterministic output schema, and stale-pack linkage rules).
- [x] **TP002**: Implement `taskpad:verification-pack-execution-gate` command scaffold that loads pack + taskpad + plan context and resolves execution targets deterministically.
- [x] **TP003**: Implement guarded command evaluator (script resolution + bounded invocation + stable timeout/non-zero handling) with deterministic reason-code mapping.
- [x] **TP004**: Compose gate output with verification-pack contract/readiness lineage fields (`sliceId`, `workQueueFingerprint`, `packHash`, `history linkage`) and deterministic ordering.
- [x] **TP005**: Add fixture corpus + `tests/tools/taskpad-verification-pack-execution-gate.test.ts` for pass/fail/noop cases and stable diagnostics.
- [x] **TP006**: Wire npm script/docs updates and canonical verification flow guidance (`README` + quality docs + intake command sequence).

### Acceptance Criteria
- `bun run taskpad:verification-pack-execution-gate -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --pack docs/quality/taskpad-verification-pack.json --package package.json --format json` returns deterministic pass/fail output with stable per-command diagnostics.
- Gate fails when a referenced verification command cannot be resolved/executed or exits non-zero under policy, with actionable rule IDs.
- Gate passes on aligned fixtures/runs and links verdicts to current pack/taskpad fingerprints.
- Docs/tests codify the execution-gate contract as part of the canonical intake handoff sequence.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-verification-pack-execution-gate.test.ts
bun run taskpad:verification-pack -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --out docs/quality/taskpad-verification-pack.json --history docs/quality/taskpad-verification-pack-history.ndjson --format json
bun run taskpad:verification-pack-contract -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --pack docs/quality/taskpad-verification-pack.json --history docs/quality/taskpad-verification-pack-history.ndjson --package package.json --format json
bun run taskpad:verification-pack-execution-gate -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --pack docs/quality/taskpad-verification-pack.json --package package.json --format json
bun run verify:taskpad:intake:full -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
```

## TASKPAD Intake Slice (2026-03-02): Verification-pack history telemetry for deterministic Builder handoff traceability

### Distilled Scope
**Problem**
- `taskpad:verification-pack` / `taskpad:verification-pack-contract` are intended to produce deterministic Builder handoff state, but there is no canonical run-history artifact that records each generated pack hash and contract verdict.
- Without run-to-run telemetry, intake loops can appear green while drift/regressions in handoff packets become hard to attribute across autonomous cycles.
- Current TASKPAD context marks verification-pack + contract as planned, with `taskpad:verification-pack-history` still outstanding as the highest-impact follow-on for auditability.

**In scope**
- Add `taskpad:verification-pack-history` NDJSON telemetry contract capturing deterministic fields (`sliceId`, `workQueueFingerprint`, `packHash`, `driftRuleId`, `generatedAt`, `sourceCommand`).
- Wire history emission into both `taskpad:verification-pack` generation and `taskpad:verification-pack-contract` evaluation paths.
- Add deterministic dedupe/idempotency behavior for repeated runs on unchanged inputs so history remains auditable without noisy duplicates.
- Add focused fixture + test coverage for history append, deterministic ordering, and failure reason-code mapping.
- Document canonical history usage + verification flow in README and taskpad quality docs.

**Out of scope**
- Product clipping feature changes.
- Reworking verification-pack payload schema beyond fields needed for history linkage.
- Broad intake pipeline redesign outside verification-pack telemetry.

### Ideation Candidates Considered
1. **[OBSERVABILITY]** Add `taskpad:verification-pack-history` NDJSON telemetry for per-run pack + contract evidence lineage. **(selected)**
2. **[AUTOMATION]** Add `taskpad:verification-pack-autofix` deterministic patch hints for contract failures without source mutation.
3. **[RELIABILITY]** Add `taskpad:verification-pack-replay-check` gate that rebuilds pack snapshots from the latest slice and fails hash drift.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "verification-pack|verification-pack-contract|verify-command-liveness|taskpad:intake:full|plan-slice-history"`
  - `search "taskpad:verification-pack-history|taskpad:verification-pack-contract|taskpad:verification-pack|taskpad:verify-command-liveness|taskpad:plan-prune-safe"`
  - `select set IMPLEMENTATION_PLAN.md package.json README.md docs/quality/taskpad-auto-ideation.md docs/quality/taskpad-planned-command-parity.md tools/taskpad-intake-autoplan.ts tools/taskpad-plan-seed.ts tools/taskpad-planned-command-parity.ts tools/taskpad-queue-health.ts tests/tools/taskpad-intake-autoplan.test.ts tests/tools/taskpad-planned-command-parity.test.ts tests/tools/taskpad-auto-ideation.test.ts`
  - `context --files --tree`
- **Selected files (core):**
  - `package.json`
  - `README.md`
  - `tools/taskpad-intake-autoplan.ts`
  - `tools/taskpad-plan-seed.ts`
  - `tools/taskpad-planned-command-parity.ts`
  - `tests/tools/taskpad-planned-command-parity.test.ts`
  - `docs/quality/taskpad-auto-ideation.md`

### Task Graph
- [x] **TP001**: Define `taskpad:verification-pack-history` schema/contract (required fields, rule IDs, idempotency semantics, and append ordering).
- [x] **TP002**: Implement reusable history writer/parser helper for NDJSON append + deterministic dedupe on unchanged fingerprints.
- [x] **TP003**: Wire history emission into `taskpad:verification-pack` outputs (success + failure paths) with stable `sourceCommand` attribution.
- [x] **TP004**: Wire history emission into `taskpad:verification-pack-contract` outputs, linking contract verdicts to pack hash/fingerprint.
- [x] **TP005**: Add fixtures/tests for append success, duplicate suppression, malformed history recovery, and deterministic reason-code ordering.
- [x] **TP006**: Add npm script/docs updates for `--history` usage and canonical verification flow.

### Acceptance Criteria
- `taskpad:verification-pack` and `taskpad:verification-pack-contract` can both append deterministic events to `docs/quality/taskpad-verification-pack-history.ndjson` via `--history`.
- Re-running commands with unchanged inputs does not create duplicate semantic events (or emits deterministic noop metadata).
- History records deterministically map each contract outcome to a specific pack hash + queue/slice fingerprint.
- Tests lock JSON shape/order and failure rule IDs for history write/read paths.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-verification-pack-history.test.ts
bun run taskpad:verification-pack -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --out docs/quality/taskpad-verification-pack.json --history docs/quality/taskpad-verification-pack-history.ndjson --format json
bun run taskpad:verification-pack-contract -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --pack docs/quality/taskpad-verification-pack.json --history docs/quality/taskpad-verification-pack-history.ndjson --package package.json --format json
bun run verify:taskpad:intake:full -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
```

## TASKPAD Intake Slice (2026-03-02): Auto-intake Work Queue routing enforcement for executable empty-queue recovery

### Distilled Scope
**Problem**
- `taskpad:auto-ideation` now supports `--target-queue work`, but `verify:taskpad:intake:auto` still invokes auto-ideation without that flag.
- In empty-queue runs, auto intake can therefore seed `## Self-Improvement Backlog` by default and still require manual promotion before Builder has an immediately executable Work Queue item.
- This creates avoidable loop friction and weakens the canonical contract introduced in the latest Work Queue-targeted ideation slice.

**In scope**
- Update `verify:taskpad:intake:auto` flow to enforce Work Queue seeding (`--target-queue work`) when queue-health reports no unchecked executable queue items.
- Add deterministic auto-mode diagnostics/metadata assertions so routing behavior is observable in CLI/test outputs.
- Add/extend focused tests for empty-queue auto flow, non-empty no-op flow, and fallback-artifact path parity under enforced Work Queue routing.
- Update README + quality docs to make Work Queue-targeted auto intake the canonical default for autonomous empty-queue recovery.

**Out of scope**
- Product clipping feature work.
- Re-ranking ideation candidate logic itself.
- Broad queue schema redesign beyond auto-intake routing behavior.

### Ideation Candidates Considered
1. **[AUTOMATION]** Make `verify:taskpad:intake:auto` always call `taskpad:auto-ideation --target-queue work` on empty-queue detection and surface deterministic routing diagnostics. **(selected)**
2. **[RELIABILITY]** Add `taskpad:auto-ideation-default-target` contract enforcing `work` as global CLI default and deprecating implicit Self-Improvement fallback.
3. **[OBSERVABILITY]** Add `taskpad:intake:auto-route-report` history logging (`queueState`, `targetQueue`, `seeded|deduped|fallback`, `parityStatus`) for every autonomous run.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "verify:taskpad:intake:auto|--target-queue work|DEFAULT_TARGET_QUEUE|TQR003_DEFAULT_TARGET_QUEUE"`
  - `search "taskpad:queue-target-contract|taskpad:queue-health|verify:taskpad:intake:full|planned-command-parity"`
  - `select set IMPLEMENTATION_PLAN.md package.json README.md tools/taskpad-auto-ideation.ts tools/taskpad-intake-recover.ts tools/taskpad-intake-autoplan.ts tests/tools/taskpad-auto-ideation.test.ts tests/tools/taskpad-intake-recover.test.ts docs/quality/taskpad-auto-ideation.md`
  - `context --files --tree`
- **Selected files (core):**
  - `package.json`
  - `tools/taskpad-auto-ideation.ts`
  - `tools/taskpad-intake-recover.ts`
  - `tools/taskpad-intake-autoplan.ts`
  - `tests/tools/taskpad-auto-ideation.test.ts`
  - `README.md`
  - `docs/quality/taskpad-auto-ideation.md`

### Task Graph
- [x] **TP001**: Define explicit auto-intake routing contract for empty queues (`verify:taskpad:intake:auto` must call `taskpad:auto-ideation --target-queue work`) with deterministic failure/diagnostic semantics.
- [x] **TP002**: Update `package.json` `verify:taskpad:intake:auto` script wiring to pass `--target-queue work` in the empty-queue branch while preserving existing argument passthrough.
- [x] **TP003**: Extend/adjust tooling outputs or wrappers (if needed) so auto-mode routing choice is machine-observable and deterministic in logs/tests.
- [x] **TP004**: Add fixture-backed tests covering empty-queue enforced Work Queue seeding, non-empty no-op branch, and fallback-artifact branch parity.
- [x] **TP005**: Update README + `docs/quality/taskpad-auto-ideation.md` canonical flow docs to reflect enforced Work Queue routing in auto intake.

### Acceptance Criteria
- `bun run verify:taskpad:intake:auto -- --taskpad tests/tools/fixtures/taskpad-queue-health-empty.md --plan IMPLEMENTATION_PLAN.md` triggers auto-ideation with Work Queue routing semantics and exits with deterministic pass/fail behavior.
- Empty-queue autonomous runs no longer depend on implicit Self-Improvement default behavior to produce executable intake output.
- Existing non-empty queue path remains unchanged (`verify:taskpad:intake:full` direct path).
- Tests lock deterministic behavior for all affected branches and prevent regressions to Self-Improvement-targeted auto seeding.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-auto-ideation.test.ts
bun test tests/tools/taskpad-intake-recover.test.ts
bun run verify:taskpad:intake:auto -- --taskpad tests/tools/fixtures/taskpad-queue-health-empty.md --plan IMPLEMENTATION_PLAN.md
bun run taskpad:auto-ideation -- --taskpad tests/tools/fixtures/taskpad-queue-health-empty.md --plan IMPLEMENTATION_PLAN.md --target-queue work --format json
```

## TASKPAD Intake Slice (2026-03-02): Work Queue-targeted auto-ideation seeding for empty-queue intake loops

### Distilled Scope
**Problem**
- Current auto-ideation behavior seeds `## Self-Improvement Backlog` when intake queues are empty, but this can leave the project without a directly executable `## Work Queue` item for the next Engineer loop.
- The latest TASKPAD state has no unchecked items across tracked intake queues, so autonomous ideation needs a deterministic path that produces one immediately plannable Work Queue slice instead of staging-only backlog churn.
- Without queue-target control + canonical verify scaffolding, intake can report ideation success while still requiring manual queue promotion before execution.

**In scope**
- Add deterministic `--target-queue work` support to `taskpad:auto-ideation` so selected candidates can be inserted into `## Work Queue` when queues are empty.
- Reuse canonical bullet shaping + semantic dedupe logic for Work Queue insertion while preserving marker and verify-command parity contracts.
- Emit explicit machine-readable metadata indicating target queue, insertion outcome, and queue-health parity after mutation.
- Add focused fixture/test coverage for Work Queue insert, dedupe/noop behavior, and deterministic output ordering.
- Document the Work Queue-target ideation contract in README/quality docs as the default path for empty executable queues.

**Out of scope**
- Product clipping feature implementation.
- Reworking candidate ranking heuristics beyond queue-target routing.
- Broad TASKPAD section redesign outside deterministic insertion path updates.

### Ideation Candidates Considered
1. **[AUTOMATION]** Add `taskpad:auto-ideation --target-queue work` so empty-queue ideation writes directly to `## Work Queue` with canonical verify scaffolding. **(selected)**
2. **[RELIABILITY]** Add `taskpad:queue-target-contract` lint that blocks ideation output unless at least one unchecked executable Work Queue bullet exists.
3. **[OBSERVABILITY]** Add `taskpad:auto-ideation-target-report` telemetry capturing queue-target decisions, insertion/dedupe outcomes, and follow-on queue-health status.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "taskpad:auto-ideation|taskpad:plan-seed|taskpad:queue-health|planned-command-parity|fallback-artifact-parity"`
  - `select set IMPLEMENTATION_PLAN.md README.md tools/taskpad-auto-ideation.ts tools/taskpad-plan-seed.ts tools/taskpad-intake-autoplan.ts tools/taskpad-planned-command-parity.ts tools/taskpad-fallback-artifact-parity.ts tests/tools/taskpad-auto-ideation.test.ts tests/tools/taskpad-plan-seed.test.ts tests/tools/taskpad-intake-autoplan.test.ts tests/tools/taskpad-planned-command-parity.test.ts docs/quality/taskpad-auto-ideation.md docs/quality/taskpad-planned-command-parity.md docs/quality/taskpad-fallback-artifact-parity.md`
  - `context --files --tree`
- **Selected files (core):**
  - `tools/taskpad-auto-ideation.ts`
  - `tests/tools/taskpad-auto-ideation.test.ts`
  - `tools/taskpad-plan-seed.ts`
  - `tools/taskpad-intake-autoplan.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `README.md`

### Task Graph
- [x] **TP001**: Define Work Queue target-routing contract for `taskpad:auto-ideation` (allowed queue values, default behavior, deterministic rule IDs, and backward compatibility).
- [x] **TP002**: Refactor insertion path to support `## Work Queue` placement while preserving canonical bullet format, verify-command scaffold compatibility, and semantic dedupe keys.
- [x] **TP003**: Extend CLI/output schema with queue-target metadata (`targetQueue`, `insertionSection`, `queueParityStatus`) and stable ordering for JSON output.
- [x] **TP004**: Add fixture corpus for Work Queue insert pass, semantic-dedupe noop, missing-heading failure, and mixed-marker TASKPAD states.
- [x] **TP005**: Add focused tests in `tests/tools/taskpad-auto-ideation.test.ts` validating deterministic Work Queue-target behavior and non-regression for existing Self-Improvement mode.
- [x] **TP006**: Update README + quality docs with canonical `--target-queue work` flow and verification guidance in the intake pipeline.

### Acceptance Criteria
- `bun run taskpad:auto-ideation -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --target-queue work --format json` inserts (or dedupes) exactly one canonical Work Queue bullet with deterministic machine-readable metadata.
- Queue-health checks reflect an executable Work Queue item after ideation on empty-queue fixtures/targets.
- Existing behavior for non-targeted runs remains deterministic and backward compatible.
- Tests lock deterministic diagnostics for insertion success, dedupe noop, and missing-target-section failures.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-auto-ideation.test.ts
bun run taskpad:auto-ideation -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --target-queue work --format json
bun run taskpad:queue-health -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --format json
bun run verify:taskpad:intake:full -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
```

## TASKPAD Intake Slice (2026-03-02): Planned-marker normalization for Work Queue command-parity reliability

### Distilled Scope
**Problem**
- `TASKPAD.md` planned items currently use marker shape `_(planned-YYYY-MM-DD)_`, while parity tooling historically expects `planned-YYYY-MM-DD` detection patterns.
- This marker-shape drift allows real planned Work Queue items to be skipped by `taskpad:planned-command-parity`, creating a false-green intake state even when Verify commands are stale/non-executable.
- We need one deterministic contract that recognizes both marker shapes (or canonicalizes them) so planned-item parity checks cover the real queue state.

**In scope**
- Extend planned-item parsing in `taskpad:planned-command-parity` to deterministically detect both `planned-YYYY-MM-DD` and `(planned-YYYY-MM-DD)` marker styles in checked Work Queue bullets.
- Add deterministic normalization/metadata in parity output so marker shape handling is explicit and stable.
- Add focused fixture + test coverage for mixed marker styles, invalid/ambiguous markers, and deterministic ordering.
- Document marker-shape contract + migration guidance in README/quality docs used by TASKPAD intake verification.

**Out of scope**
- Product clipping workflow/features.
- Rewriting broader queue ranking or auto-ideation heuristics.
- Implementing unrelated intake gates beyond planned-marker detection/parity coverage.

### Ideation Candidates Considered
1. **[RELIABILITY]** Add dual-shape planned-marker detection in `taskpad:planned-command-parity` with deterministic diagnostics. **(selected)**
2. **[AUTOMATION]** Add `taskpad:normalize-planned-markers` command to rewrite legacy marker styles before parity checks.
3. **[OBSERVABILITY]** Add `taskpad:planned-marker-coverage` telemetry (`plannedItemsDetected`, marker-shape counts, undetected candidates).

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "test-vault:bootstrap|test:e2e:matrix|test:quality:headless|agent-smoke|headless"`
  - `search "taskpad:auto-ideation|Work Queue|Candidate improvements|test:e2e:agent-smoke|taskpad:planned-command-parity"`
  - `select set IMPLEMENTATION_PLAN.md package.json README.md tools/taskpad-planned-command-parity.ts tests/tools/taskpad-planned-command-parity.test.ts tools/test-e2e-matrix.ts tests/tools/test-e2e-matrix.test.ts`
  - `context --files --tree`
- **Selected files (core):**
  - `tools/taskpad-planned-command-parity.ts`
  - `tests/tools/taskpad-planned-command-parity.test.ts`
  - `README.md`
  - `package.json`
  - `IMPLEMENTATION_PLAN.md`

### Task Graph
- [x] **TP001**: Define planned-marker detection contract (accepted marker shapes, ambiguity rules, and deterministic rule IDs) for Work Queue checked items.
- [x] **TP002**: Update `parseTaskpadPlannedItems` logic to parse canonical + parenthesized planned markers without false positives.
- [x] **TP003**: Extend parity report schema to include marker-shape metadata for detected planned items and deterministic ordering in mixed-style queues.
- [x] **TP004**: Add fixtures for mixed marker styles, malformed markers, and undetected-item regression cases.
- [x] **TP005**: Add focused tests in `tests/tools/taskpad-planned-command-parity.test.ts` asserting deterministic detection + diagnostics across marker variants.
- [x] **TP006**: Update README/quality docs to document marker-shape contract and canonical formatting guidance for future TASKPAD planning runs.

### Acceptance Criteria
- `bun run taskpad:planned-command-parity -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --package package.json --format json` detects planned Work Queue items regardless of whether marker shape is `planned-YYYY-MM-DD` or `(planned-YYYY-MM-DD)`.
- Mixed-marker fixtures produce deterministic planned-item counts and stable violation ordering.
- Non-canonical/malformed markers fail with explicit deterministic diagnostics instead of silent omission.
- README/quality docs document accepted marker shapes and preferred canonical output style.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-planned-command-parity.test.ts
bun run taskpad:planned-command-parity -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --package package.json --format json
bun run verify:taskpad:intake:full -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
```

## TASKPAD Intake Slice (2026-03-02): Fallback-artifact parity gate for vault-safe intake reliability

### Distilled Scope
**Problem**
- The intake toolchain now emits deterministic fallback artifacts when TASKPAD paths are non-writable, but intake verification can still pass without proving those artifacts were actually resolved (`applied|noop|rejected`).
- `taskpad:planned-command-parity` explicitly excludes fallback artifact lifecycle checks, leaving a high-impact drift gap between “planned” status and real TASKPAD/plan mutation parity on vault paths.
- We need one deterministic gate that blocks autonomous handoff when mutator fallback artifacts remain unresolved.

**In scope**
- Add deterministic `taskpad:fallback-artifact-parity` contract that inspects newest mutator outcomes (`taskpad:auto-ideation`, `taskpad:plan-seed`, `taskpad:intake:autoplan`) and validates artifact lifecycle state.
- Require path/SHA/evidence parity for fallback artifacts before intake can return pass (`applied`, idempotent `noop`, or explicit deterministic `rejected` with reason code).
- Add machine-readable diagnostics for pending/missing/mismatched artifact states with stable rule IDs and ordering.
- Add focused fixture + test coverage for pass/fail scenarios and idempotent re-run behavior.
- Compose this gate into `verify:taskpad:intake:full` docs/workflow so unresolved fallback artifacts fail fast before Builder dispatch.

**Out of scope**
- Product clipping feature changes.
- Reworking candidate ranking heuristics for auto-ideation.
- Broad redesign of queue contracts beyond fallback artifact lifecycle validation.

### Ideation Candidates Considered
1. **[RELIABILITY]** Add `taskpad:fallback-artifact-parity` to block intake pass when mutator fallback artifacts are unresolved. **(selected)**
2. **[AUTOMATION]** Add `taskpad:intake:doctor` to auto-run fallback apply after recover/plan-seed and emit one combined verdict.
3. **[OBSERVABILITY]** Add `taskpad:fallback-history` trend reporting (`generated`, `applied`, `stale`, `rejected`) across loops.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "AUTO_IDEATION|Work Queue|Execution Queue|taskpad:auto-ideation|taskpad:plan-seed|verify:taskpad:intake:full|taskpad:queue-plan-parity"`
  - `search "fallback artifact|apply-fallback|artifactPath|artifactApplied|pending artifact|EPERM"`
  - `select set IMPLEMENTATION_PLAN.md README.md docs/quality/taskpad-auto-ideation.md docs/quality/taskpad-planned-command-parity.md tools/taskpad-apply-fallback.ts tools/taskpad-intake-autoplan.ts tools/taskpad-plan-seed.ts tests/tools/taskpad-intake-autoplan.test.ts tests/tools/taskpad-apply-fallback.test.ts`
  - `context --files --tree`
- **Selected files (core):**
  - `tools/taskpad-apply-fallback.ts`
  - `tools/taskpad-intake-autoplan.ts`
  - `tools/taskpad-plan-seed.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `docs/quality/taskpad-planned-command-parity.md`
  - `tests/tools/taskpad-apply-fallback.test.ts`
  - `tests/tools/taskpad-intake-autoplan.test.ts`

### Task Graph
- [x] **TP001**: Define `taskpad:fallback-artifact-parity` rule contract (artifact lifecycle states, required evidence fields, and deterministic rule ID taxonomy).
- [x] **TP002**: Implement parser/resolver that discovers newest mutator fallback artifacts and correlates them with apply outcomes (`taskpad:apply-fallback` or equivalent deterministic status records).
- [x] **TP003**: Implement gate evaluation logic that fails unresolved artifacts and emits stable machine-readable diagnostics (`PENDING_ARTIFACT`, `MISSING_APPLY_EVIDENCE`, `SHA_PATH_MISMATCH`, `STALE_ARTIFACT`).
- [x] **TP004**: Add fixture corpus covering pass (`applied`, `noop`), fail (pending, mismatched, stale), and deterministic ordering/idempotency cases.
- [x] **TP005**: Add focused tests for the new gate and integration points in intake orchestration verification.
- [x] **TP006**: Wire npm script + README/quality docs and compose gate into `verify:taskpad:intake:full` execution contract.

### Acceptance Criteria
- `bun run taskpad:fallback-artifact-parity -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json` returns deterministic pass/fail with stable rule IDs.
- Intake verification fails when fallback artifacts are unresolved or mismatched and passes when evidence proves `applied|noop|rejected` deterministically.
- Fixture + test coverage locks deterministic output ordering and reason-code mapping.
- README/quality docs include this gate in canonical intake verification flow before Builder handoff.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-apply-fallback.test.ts
bun test tests/tools/taskpad-intake-autoplan.test.ts
bun run taskpad:fallback-artifact-parity -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
bun run verify:taskpad:intake:full -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
```

## TASKPAD Intake Slice (2026-03-01): Planned-command parity gate for TASKPAD intake reliability

### Distilled Scope
**Problem**
- `TASKPAD.md` currently contains many `planned-YYYY-MM-DD` items whose referenced commands are not guaranteed to exist in `package.json` scripts or executable tool paths.
- This allows intake slices to look complete while handoff verification can still fail late (or silently drift) when a planned command is missing.
- We need one deterministic contract that proves every newly planned Work Queue item remains executable from queue marker → plan slice → command surface.

**In scope**
- Add a deterministic `taskpad:planned-command-parity` gate that scans planned Work Queue items and the newest mapped intake slice.
- Parse command references from backlog `Verify:` clauses and newest slice `Verification Commands` block, then validate command executability against `package.json` scripts and direct tool entrypoints.
- Emit machine-readable diagnostics with stable rule IDs for missing/unmapped/non-executable command references.
- Add fixture coverage for aligned pass and deterministic failure classes.
- Wire the gate into intake verification docs/workflow so Builder handoff fails fast on command-surface drift.

**Out of scope**
- Implementing product clipping features.
- Rewriting existing queue selection heuristics.
- Broad redesign of TASKPAD ranking or monetization planning loops.

### Ideation Candidates Considered
1. **[RELIABILITY]** Add `taskpad:planned-command-parity` to enforce planned item ↔ executable command surface parity. **(selected)**
2. **[OBSERVABILITY]** Add `taskpad:intake:telemetry-diff` snapshots that capture command-surface drift trends per loop.
3. **[AUTOMATION]** Add `taskpad:verification-autofix` suggestions that rewrite stale Verify command strings to nearest valid scripts.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "taskpad:verification-runner|verification-contract|Verification Commands|taskpad:intake:autoplan|plan:integrity"`
  - `search "taskpad:queue-plan-parity|taskpad:plan-rollover|taskpad:plan-seed|Work Queue|Execution Queue"`
  - `select set IMPLEMENTATION_PLAN.md README.md docs/quality/taskpad-auto-ideation.md tools/taskpad-intake-autoplan.ts tools/taskpad-plan-seed.ts tools/taskpad-queue-health.ts tools/implementation-plan-integrity.ts tools/taskpad-apply-fallback.ts tests/tools/taskpad-intake-autoplan.test.ts tests/tools/taskpad-plan-seed.test.ts tests/tools/taskpad-apply-fallback.test.ts tests/tools/taskpad-queue-health.test.ts tests/tools/taskpad-queue-reconcile.test.ts`
  - `context --files --tree`
- **Selected files (core):**
  - `tools/taskpad-intake-autoplan.ts`
  - `tools/taskpad-plan-seed.ts`
  - `tools/implementation-plan-integrity.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `tests/tools/taskpad-intake-autoplan.test.ts`
  - `README.md`

### Task Graph
- [x] **TP001**: Define `taskpad:planned-command-parity` contract (input args, deterministic output schema, rule taxonomy, and queue→slice linking assumptions).
- [x] **TP002**: Implement parser that resolves planned Work Queue items and extracts candidate command references from `Verify:` clauses.
- [x] **TP003**: Implement command-surface resolver that validates each referenced command against `package.json` scripts and direct tool file paths.
- [x] **TP004**: Implement deterministic mismatch diagnostics with stable rule IDs (e.g., missing mapping, missing script, non-executable path, stale reference).
- [x] **TP005**: Add fixture corpus for pass/fail classes under `tests/tools/fixtures/` and lock deterministic output ordering.
- [x] **TP006**: Add `tests/tools/taskpad-planned-command-parity.test.ts` coverage for aligned, unmapped, and non-executable scenarios.
- [x] **TP007**: Wire script + docs (`package.json`, `README.md`, quality contract docs) and compose with intake verification flow.

### Acceptance Criteria
- `bun run taskpad:planned-command-parity -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --package package.json --format json` emits deterministic pass/fail output.
- Planned Work Queue items that reference missing or non-executable commands fail with stable actionable rule IDs.
- Aligned fixtures pass with zero drift and stable JSON ordering.
- Intake verification docs clearly include this gate before Builder dispatch.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-intake-autoplan.test.ts
bun test tests/tools/taskpad-plan-seed.test.ts
bun test tests/tools/taskpad-apply-fallback.test.ts
bun run taskpad:planned-command-parity -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --package package.json --format json
bun run verify:taskpad:intake:full -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
```

## TASKPAD Intake Slice (2026-03-01): Vault-safe fallback artifacts for TASKPAD mutator writes

### Distilled Scope
**Problem**
- The real vault TASKPAD still shows canonical-queue drift symptoms (notably missing `Execution Queue`) despite multiple queue-contract/reconcile slices being marked planned.
- Current fallback/apply flow is scoped to `taskpad:auto-ideation`; other mutators (`taskpad:plan-seed`, `taskpad:intake:autoplan`, reconcile-backed writes) can still fail or noop under vault write restrictions without a unified auditable patch/apply path.
- This creates high-risk intake drift: plan/queue contracts look complete in repo flows while real TASKPAD targets can remain stale.

**In scope**
- Define one shared write-fallback contract for TASKPAD mutators that produce content edits (`plan-seed`, `intake:autoplan`, queue-reconcile write paths).
- Extend mutators to emit deterministic fallback artifacts (pre/post SHA, target path, patch payload, reason code) when preflight mode is `fallback-artifact`.
- Reuse/extend `taskpad:apply-fallback` validation so mutator artifacts can be applied safely and idempotently on vault targets.
- Add focused tests/fixtures for vault-style non-writable paths proving parity: fallback artifact -> apply -> queue/plan state matches direct-write semantics.
- Document contract + operator flow in quality docs/README.

**Out of scope**
- Product clipping/extractor feature work.
- Reworking ranking heuristics for auto-ideation candidate scoring.
- Multi-slice backlog expansion beyond this single reliability slice.

### Ideation Candidates Considered
1. **[RELIABILITY]** Add a unified write-fallback artifact contract for all TASKPAD mutators, not just auto-ideation. **(selected)**
2. **[OBSERVABILITY]** Add a `taskpad:mutation-audit` ledger capturing pre/post SHA + changed sections for every intake mutation.
3. **[AUTOMATION]** Add `taskpad:sync-state` orchestration to run queue-reconcile + parity + strict-active-slice checks and auto-apply fallback artifacts in one pass.

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "taskpad:apply-fallback|fallback artifact|EPERM|queue-reconcile|plan-rollover"`
  - `search "taskpad:plan-rollover|taskpad-plan-rollover|queue-reconcile|plan-seed"`
  - `select set IMPLEMENTATION_PLAN.md tools/taskpad-write-preflight.ts tools/taskpad-intake-autoplan.ts tools/taskpad-plan-seed.ts tools/lib/taskpad-queue-reconcile.ts tools/taskpad-apply-fallback.ts tests/tools/taskpad-intake-autoplan.test.ts tests/tools/taskpad-plan-seed.test.ts tests/tools/taskpad-apply-fallback.test.ts tests/tools/taskpad-write-preflight.test.ts tests/tools/taskpad-queue-reconcile.test.ts docs/quality/taskpad-auto-ideation.md README.md`
  - `context --files --tree`
- **Selected files (core):**
  - `tools/taskpad-plan-seed.ts`
  - `tools/taskpad-intake-autoplan.ts`
  - `tools/taskpad-apply-fallback.ts`
  - `tools/taskpad-write-preflight.ts`
  - `tools/lib/taskpad-queue-reconcile.ts`
  - `tests/tools/taskpad-apply-fallback.test.ts`
  - `tests/tools/taskpad-intake-autoplan.test.ts`
  - `docs/quality/taskpad-auto-ideation.md`

### Task Graph
- [x] **TP001**: Define/normalize a shared mutator write-mode contract (`direct-write|fallback-artifact|error`) with deterministic reason-code mapping and artifact schema for non-writable TASKPAD targets.
- [x] **TP002**: Refactor `taskpad:plan-seed` write path to route through shared preflight and emit deterministic fallback artifact metadata instead of failing/nooping silently on vault-restricted paths.
- [x] **TP003**: Refactor `taskpad:intake:autoplan` post-recover/plan-seed mutation path to propagate mutator fallback artifacts and preserve one actionable blocker/action hint.
- [x] **TP004**: Extend `taskpad:apply-fallback` validation/apply logic to accept mutator artifact types beyond auto-ideation while preserving SHA/path/idempotency guarantees.
- [x] **TP005**: Add fixture coverage for fallback parity (mutator fallback artifact generated, applied once, re-run noops) across plan-seed/autoplan scenarios.
- [x] **TP006**: Add focused tests asserting deterministic JSON envelopes/reason codes for mutator fallback mode and parity with direct-write outcomes.
- [x] **TP007**: Update README + `docs/quality/taskpad-auto-ideation.md` (or split contract doc) to document canonical mutator fallback/apply flow.

### Acceptance Criteria
- Mutating commands (`taskpad:plan-seed`, `taskpad:intake:autoplan`) return deterministic fallback-artifact outputs on non-writable vault targets instead of ambiguous failures/noops.
- `taskpad:apply-fallback` can safely apply mutator-generated artifacts with path/SHA validation and idempotent re-run behavior.
- Post-apply outputs show queue/plan parity equivalent to direct-write mode for covered fixtures.
- Tests lock deterministic reason codes and machine-readable artifact schema for mutator fallback flows.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-apply-fallback.test.ts
bun test tests/tools/taskpad-plan-seed.test.ts
bun test tests/tools/taskpad-intake-autoplan.test.ts
bun test tests/tools/taskpad-queue-reconcile.test.ts
bun run taskpad:plan-seed -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
bun run taskpad:intake:autoplan -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
```

## TASKPAD Intake Slice (2026-03-01): Strict active-slice contract enforcement + autoplan rollover diagnostics

### Distilled Scope
**Problem**
- `TASKPAD.md` is marking strict-active-slice work as planned, but current `tools/implementation-plan-integrity.ts` does not enforce a `--strict-active-slice` path and allows a fully checked top slice to pass as "active".
- This creates intake drift: autonomous loops can continue with no executable unchecked TP tasks while still appearing healthy.
- We need deterministic enforcement + one clear autoplan failure reason so loops stop safely instead of silently degrading plan quality.

**In scope**
- Add a real `--strict-active-slice` mode to `plan:integrity` that fails when the newest intake slice has zero unchecked TP tasks or when top-slice activeness is ambiguous.
- Extend integrity output with deterministic rule IDs for strict-mode failures (machine-readable + human-readable parity).
- Wire `taskpad:intake:autoplan` to surface strict-active-slice contract failures as one actionable blocker (no duplicate slice insertion/no silent continuation).
- Add focused fixtures/tests for fully-complete top slice and strict-mode pass cases.
- Document strict-active-slice semantics in README/intake contract docs.

**Out of scope**
- Reworking queue-reconcile/queue-contract logic unrelated to active-slice enforcement.
- Product clipping feature changes.
- Broad archive/prune strategy redesign.

### Ideation Candidates Considered
1. **[RELIABILITY]** Enforce `plan:integrity --strict-active-slice` with deterministic failures for fully-complete top slices and autoplan blocker propagation. **(selected)**
2. **[AUTOMATION]** Add `taskpad:plan-rollover` command that archives a fully-complete top slice and scaffolds the next one automatically.
3. **[OBSERVABILITY]** Add `taskpad:intake:history` strict-slice trend reporting (`completeTopSliceCount`, `blockedByStrictSlice`, `medianRecoveryLoops`).

### RepoPrompt Builder Context
- **Commands used:**
  - `tree`
  - `search "taskpad:intake:autoplan|taskpad:plan-seed|taskpad:queue-contract|test:vault:bootstrap|plan:integrity"`
  - `search "taskpad:plan-contract|taskpad:queue-reconcile|strict-active-slice|Execution Queue"`
  - `select set IMPLEMENTATION_PLAN.md tools/taskpad-auto-ideation.ts tools/taskpad-intake-autoplan.ts tools/taskpad-plan-seed.ts tools/implementation-plan-integrity.ts tools/taskpad-plan-prune.ts tests/tools/taskpad-auto-ideation.test.ts tests/tools/taskpad-intake-autoplan.test.ts tests/tools/taskpad-plan-seed.test.ts tests/tools/implementation-plan-integrity.test.ts docs/quality/taskpad-auto-ideation.md README.md`
  - `context --files --tree`
- **Selected files (core):**
  - `tools/implementation-plan-integrity.ts`
  - `tools/taskpad-intake-autoplan.ts`
  - `tests/tools/implementation-plan-integrity.test.ts`
  - `tests/tools/taskpad-intake-autoplan.test.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `README.md`

### Task Graph
- [x] **TP001**: Define strict-active-slice rule contract (success/failure matrix + deterministic rule IDs) and align with existing integrity rule taxonomy.
- [x] **TP002**: Implement `--strict-active-slice` CLI argument parsing and execution path in `tools/implementation-plan-integrity.ts`.
- [x] **TP003**: Add active-slice task-state evaluator that deterministically detects `zero unchecked TP tasks` and ambiguous top-slice states.
- [x] **TP004**: Emit machine-readable strict-mode diagnostics (stable rule IDs/order) and keep human-readable output parity.
- [x] **TP005**: Wire strict-mode invocation handling in `tools/taskpad-intake-autoplan.ts` so failures surface as one actionable `plan-contract` blocker without duplicate slice churn.
- [x] **TP006**: Add/extend fixtures + tests in `tests/tools/implementation-plan-integrity.test.ts` for strict pass/fail scenarios (including fully-complete top slice).
- [x] **TP007**: Add focused `tests/tools/taskpad-intake-autoplan.test.ts` coverage asserting strict-slice blocker propagation and deterministic failure metadata.
- [x] **TP008**: Update `README.md` + quality contract docs with strict-active-slice semantics and verification flow.

### Acceptance Criteria
- `bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice --format json` fails deterministically when newest slice has no unchecked TP tasks and returns stable strict-mode rule IDs.
- Strict mode passes when exactly one top slice contains unchecked TP tasks and required sections remain valid.
- `taskpad:intake:autoplan` surfaces strict-slice failure as a single actionable blocker and does not create duplicate/empty top slices.
- Regression tests lock strict-mode behavior and deterministic diagnostic ordering.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/implementation-plan-integrity.test.ts
bun test tests/tools/taskpad-intake-autoplan.test.ts
bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice --format json
bun run verify:taskpad:intake:full -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md
```

## TASKPAD Intake Slice (2026-03-01): Post-seed queue reconcile + `Execution Queue` self-heal on target TASKPAD path

### Distilled Scope
**Problem**
- Current TASKPAD state shows `Work Queue` items but no explicit `## Execution Queue` section, despite prior queue-contract/canonical-promotion slices being marked planned.
- This indicates a high-risk drift class: queue contracts can appear green while the actual target TASKPAD path used by intake still misses canonical section structure.
- When autonomous intake loops run against drifted files, planning selection, queue promotion, and human auditability all degrade.

**In scope**
- Add a deterministic post-seed reconcile step that runs after `taskpad:plan-seed` / `taskpad:intake:autoplan` and validates canonical queue section presence/order on the same TASKPAD target path.
- Auto-heal missing canonical headings (especially `## Execution Queue`) in-place with deterministic insertion position and idempotent behavior.
- Emit machine-readable reconcile diagnostics in command output (`queueReconcile.status`, `sectionsPresent`, `healedSections`, `reasonCodes`).
- Add fixture coverage for drifted TASKPAD layouts (missing `Execution Queue`, out-of-order sections, canonical+legacy mixed layouts) and stable output ordering.
- Document reconcile contract + failure taxonomy for autonomous loops.

**Out of scope**
- Changing backlog ranking/selection heuristics beyond queue-structure reconciliation.
- Reworking unrelated plan-prune/archive logic.
- Product feature implementation outside intake tooling.

### Ideation Candidates Considered
1. **[RELIABILITY]** Add post-seed queue reconcile + auto-heal for canonical queue headings on the actual TASKPAD target path. **(selected)**
2. **[OBSERVABILITY]** Add `taskpad:queue-drift-report` weekly trend output for section drift classes and frequency by path.
3. **[AUTOMATION]** Add `taskpad:execution-seed` that always mirrors the selected Work Queue item into Execution Queue with immutable queue item IDs.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md`
  - `8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/IMPLEMENTATION_PLAN.md`
  - `8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/SCRATCHPAD.md`
  - `tools/taskpad-intake-autoplan.ts`
  - `tools/taskpad-plan-seed.ts`
  - `tools/taskpad-queue-contract.ts`
  - `tools/taskpad-queue-health.ts`
  - `tests/tools/taskpad-intake-autoplan.test.ts`
  - `tests/tools/taskpad-plan-seed.test.ts`
  - `tests/tools/taskpad-queue-contract.test.ts`
  - `tests/tools/fixtures/taskpad-*.md`
- **Search queries/patterns:**
  - `search "Work Queue|Execution Queue|taskpad:auto-ideation|taskpad:plan-seed|taskpad:queue-contract|test:e2e:matrix"`
  - `search "test vault"`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "Work Queue|Execution Queue|taskpad:auto-ideation|taskpad:plan-seed|taskpad:queue-contract|test:e2e:matrix"`
  - `search "test vault"`
  - `select set "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/SCRATCHPAD.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/IMPLEMENTATION_PLAN.md"`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define canonical post-seed queue reconcile contract (section order, heal rules, idempotency, and reason-code taxonomy) in docs/README.
- [x] **TP002**: Implement reconcile helper that inspects target TASKPAD markdown AST/text blocks and computes deterministic section-presence/order diff.
- [x] **TP003**: Implement auto-heal for missing/out-of-order canonical headings with stable insertion anchors and no duplicate heading creation.
- [x] **TP004**: Wire reconcile helper into `taskpad:plan-seed` and `taskpad:intake:autoplan` post-mutation path, including deterministic machine-readable output fields.
- [x] **TP005**: Add/extend fixtures for drift classes: missing `Execution Queue`, missing multiple canonical sections, out-of-order canonical sections, and canonical+legacy mixed layout.
- [x] **TP006**: Add focused tests asserting idempotent healing, deterministic reason code ordering, and no-op behavior on already-canonical files.
- [x] **TP007**: Add regression tests ensuring queue selection/promotion still works after reconcile on healed fixtures.
- [x] **TP008**: Update CLI docs/examples to include reconcile metadata expectations and recommended verification flow for autonomous loops.

### Acceptance Criteria
- Running `taskpad:plan-seed` or `taskpad:intake:autoplan` on a TASKPAD missing `## Execution Queue` deterministically heals the section and reports reconcile metadata.
- Repeated runs on the healed file are idempotent (no extra heading churn, stable output semantics).
- Machine-readable output includes deterministic reason codes and explicit `executionQueue.present=true` signal after successful reconcile.
- Existing queue contract/health checks remain compatible and pass for canonical fixtures.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-queue-contract.test.ts
bun test tests/tools/taskpad-plan-seed.test.ts
bun test tests/tools/taskpad-intake-autoplan.test.ts
bun run taskpad:queue-contract -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --format json
bun run taskpad:intake:autoplan -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --format json
bun run taskpad:queue-health -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --format json
```

## TASKPAD Intake Slice (2026-03-01): Deterministic headless scenario-matrix gate for clip workflows (`test:e2e:matrix`)

### Distilled Scope
**Problem**
- `SCRATCHPAD.md` explicitly calls for a test vault that validates clip actions with headless browsing, but current coverage is concentrated in a single harness test file and does not enforce a canonical scenario matrix across major clip entrypoints.
- Without a deterministic scenario manifest + machine-readable gate output, autonomous loops can ship changes that quietly reduce clip workflow coverage or drift verification expectations.
- The next highest-impact improvement is a reliability gate that turns “representative harness tests” into an auditable contract for web clip workflows.

**In scope**
- Define a deterministic scenario-manifest contract for headless clip validation (scenario id, fixture source, clip path, expected frontmatter/markdown/save assertions, required tags).
- Add a focused orchestration command (`test:e2e:matrix`) that runs/validates required headless scenarios and emits machine-readable pass/fail output with missing-coverage diagnostics.
- Wire existing harness scenarios (generic web, SeedFinder, CLI-save) into the manifest contract and add at least one additional clip-path scenario already supported by fixtures/tools.
- Add regression tests for manifest parsing, deterministic scenario ordering, and failure diagnostics when required scenarios are missing/drifted.
- Document usage in `README.md` and ensure it composes cleanly with `test:quality:headless`.

**Out of scope**
- Implementing new product clipping features or extractor logic.
- Replacing existing unit/integration suites outside the headless scenario matrix contract.
- Broad CI policy refactors beyond wiring this specific deterministic gate.

### Ideation Candidates Considered
1. **[RELIABILITY]** Add a deterministic headless scenario-matrix gate that enforces required clip workflow coverage and emits machine-readable diagnostics. **(selected)**
2. **[OBSERVABILITY]** Add `test:quality:history` artifact logging so each quality run records scenario coverage + failure taxonomy for trend review.
3. **[AUTOMATION]** Add `clip:fixture-replay` that replays fixture inputs across clip entrypoints and auto-generates/update expected markdown snapshots.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tests/e2e/headless-clip-harness.test.ts`
  - `tests/e2e/support/test-vault-sandbox.ts`
  - `tests/extractors/fixtures/article.html`
  - `tests/templates/fixtures/seedfinder-strain.html`
  - `tools/clip-url.ts`
  - `tools/clip-stdin.ts`
  - `src/shared/obsidianCliSave.ts`
  - `package.json`
  - `README.md`
  - `tests/tools/taskpad-auto-ideation.test.ts` (deterministic fixture/output style reference)
- **Search queries/patterns:**
  - `search "headless-clip-harness|test-vault-sandbox|scenario #|saveViaCli"`
  - `search "test:e2e:headless|test:quality:headless|clip:url|clip:stdin"`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "taskpad:auto-ideation|taskpad:plan-seed|taskpad:plan-prune|taskpad:queue-contract"`
  - `select set "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/SCRATCHPAD.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/IMPLEMENTATION_PLAN.md.pre-reset-20260301-001055"`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define the headless scenario-matrix contract (required scenario IDs, manifest schema, deterministic ordering/tie-break rules, and machine-readable failure codes) in docs/README.
- [x] **TP002**: Add manifest fixture(s) under `tests/e2e/fixtures/` capturing current required scenarios (generic web, SeedFinder, CLI-save) and expected assertion targets.
- [x] **TP003**: Implement matrix runner utility that loads manifest, invokes mapped scenario validators, and returns deterministic result envelopes (`status`, `passed`, `failed`, `missingRequired`, `diagnostics`).
- [x] **TP004**: Refactor `tests/e2e/headless-clip-harness.test.ts` (or companion helper) so scenario definitions are reusable by the matrix runner without changing existing behavioral assertions.
- [x] **TP005**: Add at least one additional scenario path already supported in repo tooling/fixtures and register it as required in the manifest.
- [x] **TP006**: Add focused tests (new `tests/tools` or `tests/e2e` target) for manifest validation failures, deterministic ordering, and missing-required-scenario diagnostics.
- [x] **TP007**: Wire `test:e2e:matrix` in `package.json`, document execution + expected output in `README.md`, and add recommendation for autonomous intake verification usage.

### Acceptance Criteria
- `bun run test:e2e:matrix -- --manifest tests/e2e/fixtures/clip-scenario-manifest.json --format json` emits deterministic output with stable ordering and explicit diagnostics when required scenarios are missing.
- Matrix gate covers at minimum generic web, SeedFinder, and CLI-save scenarios via a shared manifest contract.
- Failure output includes actionable machine-readable reason codes for schema drift, missing scenarios, and assertion mismatch classes.
- `test:quality:headless` remains runnable and compatible with the new matrix gate workflow.

### Verification Commands
```bash
bun run typecheck
bun run test:e2e:headless
bun run test:e2e:matrix -- --manifest tests/e2e/fixtures/clip-scenario-manifest.json --format json
bun test tests/e2e/headless-clip-harness.test.ts
```

## TASKPAD Intake Slice (2026-03-01): Price-bucket anchor recommendation analyzer (`pilot:price-signal`)

### Distilled Scope
**Problem**
- Pricing signals are currently scattered across pilot response logs, forcing manual interpretation of WTP snippets and `PILOT YES` acceptance trends.
- The backlog target requires deterministic per-price-bucket telemetry that turns raw responses into a concrete next pricing experiment recommendation.
- Without deterministic confidence framing, anchor decisions can drift run-to-run and become hard to trust in autonomous loops.

**In scope**
- Define `pilot:price-signal` CLI contract (`--root`, `--brief`, `--format`) and deterministic JSON envelope containing `priceBucketCounts`, `pilotYesRateByBucket`, `recommendedNextAnchor`, and `confidenceBand`.
- Parse pilot artifacts under `docs/distribution/*` plus pricing constraints from `OFFER_BRIEF.md` (`$8-$19` range and `$12` anchor context).
- Implement deterministic WTP validation paths for missing/non-numeric/out-of-range values with actionable diagnostics.
- Compute per-bucket acceptance telemetry (`PILOT YES` rate, median WTP, objection mix) and deterministic recommendation logic for the next anchor test.
- Add fixture-backed tests for happy-path output determinism and required validation failures.

**Out of scope**
- Mutating pilot artifacts, auto-dispatching outreach, or rewriting response rows.
- Changing pricing policy in `OFFER_BRIEF.md` beyond deterministic parsing/validation.
- Replacing higher-level hypothesis verdict tooling; this slice only produces pricing experiment recommendation telemetry.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tools/pilot-price-signal.ts` (new)
  - `tests/tools/pilot-price-signal.test.ts` (new)
  - `tests/tools/fixtures/pilot-price-signal-*` (new fixtures)
  - `docs/distribution/first-pilot-2026-02/pilot-response-log.md`
  - `docs/distribution/first-pilot-2026-02/pilot-batch-summary.md`
  - `docs/distribution/first-pilot-2026-02/pilot-run-sheet.md`
  - `OFFER_BRIEF.md`
  - `tools/pilot-sample-gap-planner.ts` (threshold parsing/output-style reference)
  - `tools/pilot-response-proof.ts` (deterministic rule-id diagnostics reference)
  - `tools/pilot-latency.ts` (artifact parsing/statistics helper patterns)
  - `tests/tools/pilot-sample-gap-planner.test.ts` (deterministic fixture assertions)
  - `tests/tools/pilot-response-proof.test.ts` (diagnostic assertion patterns)
  - `package.json`
  - `README.md`
- **Search queries/patterns:**
  - `search "pilot:price-signal|price-signal|priceBucket|WTP|recommendedNextAnchor|confidenceBand"`
  - `search "pilot:metrics|pilot:mrr-trajectory|pilot:objection-intel|pilot:funnel-leak|OFFER_BRIEF|price hypothesis"`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "pilot:price-signal|price-signal|priceBucket|WTP|recommendedNextAnchor|confidenceBand"`
  - `search "pilot:metrics|pilot:mrr-trajectory|pilot:objection-intel|pilot:funnel-leak|OFFER_BRIEF|price hypothesis"`
  - `select set IMPLEMENTATION_PLAN.md OFFER_BRIEF.md README.md package.json tools/pilot-sample-gap-planner.ts tools/pilot-response-proof.ts tools/pilot-ingest-replies.ts tools/pilot-latency.ts tests/tools/pilot-sample-gap-planner.test.ts tests/tools/pilot-response-proof.test.ts tests/tools/pilot-ingest-replies.test.ts tests/tools/pilot-latency.test.ts docs/distribution/first-pilot-2026-02/pilot-run-sheet.md docs/distribution/first-pilot-2026-02/pilot-response-log.md docs/distribution/first-pilot-2026-02/pilot-batch-summary.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define `pilot:price-signal` output contract and deterministic bucket policy (bucket boundaries, tie-break ordering, rounding rules, recommendation precedence, and confidence-band semantics) in README/docs.
- [x] **TP002**: Scaffold `tools/pilot-price-signal.ts` CLI argument parsing and deterministic output envelope (`status`, `inputs`, telemetry payload, diagnostics) with `--format json|human` parity.
- [x] **TP003**: Implement artifact discovery/loader for `--root docs/distribution` batches and deterministic normalization of candidate response rows used for pricing analysis.
- [x] **TP004**: Implement WTP extraction/validation pipeline using `OFFER_BRIEF.md` allowed range; fail missing/non-numeric/out-of-range values with actionable rule IDs and row pointers.
- [x] **TP005**: Implement per-price-bucket reducers for `priceBucketCounts`, `pilotYesRateByBucket`, median WTP, and objection-mix telemetry with stable key ordering.
- [x] **TP006**: Implement deterministic recommendation engine producing `recommendedNextAnchor` from bucket performance + anchor context (`$12` baseline) with explicit tie-breaks.
- [x] **TP007**: Implement confidence-band calculator for the recommendation (documented deterministic method and minimum-sample behavior for low-data scenarios).
- [x] **TP008**: Add fixtures under `tests/tools/fixtures/` for deterministic happy path plus validation failures (`MISSING_WTP_VALUE`, `WTP_OUT_OF_RANGE`, malformed table/field drift).
- [x] **TP009**: Add `tests/tools/pilot-price-signal.test.ts` asserting deterministic JSON bytes/stable ordering for pass fixtures and exact actionable diagnostics for failure fixtures.
- [x] **TP010**: Wire script in `package.json`, document usage in `README.md`, and add smoke validation notes for running against live `docs/distribution` artifacts.

### Acceptance Criteria
- `bun run pilot:price-signal -- --root docs/distribution --brief OFFER_BRIEF.md --format json` emits deterministic JSON with required top-level fields: `priceBucketCounts`, `pilotYesRateByBucket`, `recommendedNextAnchor`, `confidenceBand`.
- Output includes deterministic per-bucket acceptance telemetry and objection mix derived from pilot response artifacts without mutating source files.
- Missing or invalid WTP inputs fail with actionable diagnostics that identify offending batch/row and failure rule.
- WTP values outside the allowed range from `OFFER_BRIEF.md` fail deterministically (same rule IDs/order across reruns).

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/pilot-price-signal.test.ts
bun run pilot:price-signal -- --root tests/tools/fixtures/pilot-price-signal-happy-root --brief tests/tools/fixtures/pilot-price-signal.brief.md --format json
bun run pilot:price-signal -- --root tests/tools/fixtures/pilot-price-signal-missing-wtp-root --brief tests/tools/fixtures/pilot-price-signal.brief.md --format json
bun run pilot:price-signal -- --root tests/tools/fixtures/pilot-price-signal-out-of-range-root --brief tests/tools/fixtures/pilot-price-signal.brief.md --format json
bun run pilot:price-signal -- --root docs/distribution --brief OFFER_BRIEF.md --format json
```

## TASKPAD Intake Slice (2026-03-01): Decision-grade sample gap planner (`pilot:sample-gap-planner`)

### Distilled Scope
**Problem**
- The pilot loop can stall in underpowered 3-send batches while `OFFER_BRIEF.md` requires larger evidence thresholds (e.g., sent/reply minimums) before decision-grade verdicts.
- Operators currently need manual math to answer: how many sends remain, how many additional batches are needed, what channel mix to send next, and by when.
- The backlog target requires a deterministic command that compares live pilot artifacts against brief thresholds and emits exact next-action planning fields: `remainingSent`, `requiredBatches`, `channelMix`, `latestSendBy`.

**In scope**
- Define deterministic planner contract for `pilot:sample-gap-planner` with inputs `--brief`, `--run-sheet`, `--responses`, `--batch-size`, `--format`.
- Parse threshold signals from `OFFER_BRIEF.md` and current pilot state from run-sheet/response artifacts.
- Compute deterministic gap outputs for both under-threshold and threshold-met states.
- Add fixture-backed tests for both required scenarios and stable JSON output ordering.
- Wire script/docs and include a smoke/E2E command against live `docs/distribution/first-pilot-2026-02` artifacts.

**Out of scope**
- Auto-dispatching outreach messages or mutating pilot artifacts.
- Changing threshold policy semantics in `OFFER_BRIEF.md` beyond deterministic parsing/validation.
- Broader pricing verdict/scoring logic (`offer:hypothesis-verdict`) outside sample-gap planning outputs.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tools/pilot-sample-gap-planner.ts` (new)
  - `tests/tools/pilot-sample-gap-planner.test.ts` (new)
  - `tests/tools/fixtures/pilot-sample-gap-planner-under-threshold.*` (new)
  - `tests/tools/fixtures/pilot-sample-gap-planner-threshold-met.*` (new)
  - `OFFER_BRIEF.md`
  - `docs/distribution/first-pilot-2026-02/pilot-run-sheet.md`
  - `docs/distribution/first-pilot-2026-02/pilot-response-log.md`
  - `docs/distribution/first-pilot-2026-02/pilot-batch-summary.md`
  - `tools/pilot-latency.ts` (existing parser/CLI/error-contract reference)
  - `tools/pilot-response-proof.ts` (existing deterministic rule-ID/output style reference)
  - `tests/tools/pilot-latency.test.ts` (existing deterministic fixture assertion patterns)
  - `tests/tools/pilot-response-proof.test.ts` (existing deterministic error-contract assertion patterns)
  - `package.json`
  - `README.md`
- **Search queries/patterns:**
  - `search "OFFER_BRIEF|Validation signal|Invalidation signal|Pilot CTA|10 qualified"`
  - `search "pilot-run-sheet|pilot-response-log|Next-Step Decision|Response State|sent"`
  - `search "pilot:latency|pilot:response-proof|deterministic JSON|ruleId|format json"`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "pilot:sample-gap-planner|sample-gap|evidence-thresholds|OFFER_BRIEF|requiredBatches|channelMix|latestSendBy"`
  - `search "pilot:mrr-trajectory|pilot:metrics|pilot:cadence|pilot:ops-sync|decision-grade|minSent|minReplies"`
  - `select set IMPLEMENTATION_PLAN.md OFFER_BRIEF.md README.md package.json tools/pilot-latency.ts tools/pilot-response-proof.ts tools/pilot-ingest-replies.ts tests/tools/pilot-latency.test.ts tests/tools/pilot-response-proof.test.ts docs/distribution/first-pilot-2026-02/pilot-run-sheet.md docs/distribution/first-pilot-2026-02/pilot-response-log.md docs/distribution/first-pilot-2026-02/pilot-batch-summary.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define `pilot:sample-gap-planner` contract (input args, output schema, deterministic rounding/ordering, error codes) in README/docs, including exact field semantics for `remainingSent`, `requiredBatches`, `channelMix`, and `latestSendBy`.
- [x] **TP002**: Implement CLI scaffold in `tools/pilot-sample-gap-planner.ts` (arg parsing, file loading, `--format json|human`, deterministic envelope) aligned with existing pilot tool conventions.
- [x] **TP003**: Implement `OFFER_BRIEF.md` threshold parser extracting decision-grade requirements (minimum sent/replies and any explicit sample-size constraints) with deterministic validation failures for missing/ambiguous thresholds.
- [x] **TP004**: Implement run-sheet/response state reducer that derives live counts (`sent`, `replied`, per-channel sent/replied, pending decision state) using canonical parsing assumptions shared with current pilot tools.
- [x] **TP005**: Implement deterministic gap math engine: `remainingSent = max(0, minSent - currentSent)` and `requiredBatches = ceil(remainingSent / batchSize)` plus threshold-met short-circuit semantics.
- [x] **TP006**: Implement deterministic `channelMix` recommendation algorithm using current channel distribution + configured tie-break rules so output is stable across reruns and threshold states.
- [x] **TP007**: Implement `latestSendBy` planner timestamp logic based on batch cadence assumptions (documented default cadence + deterministic calculation from current artifact timestamps/now input if provided).
- [x] **TP008**: Add fixture corpus for under-threshold and threshold-met scenarios (`tests/tools/fixtures/pilot-sample-gap-planner-*`) with locked expected JSON outputs.
- [x] **TP009**: Add focused tests in `tests/tools/pilot-sample-gap-planner.test.ts` asserting deterministic outputs for both required scenarios and stable ordering/value rounding across reruns.
- [x] **TP010**: Wire `pilot:sample-gap-planner` script in `package.json`, add usage docs in `README.md`, and capture smoke/E2E validation command notes for live pilot artifacts.

### Acceptance Criteria
- `bun run pilot:sample-gap-planner -- --brief OFFER_BRIEF.md --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md --batch-size 3 --format json` returns deterministic output envelope with non-null planning fields.
- Under-threshold fixture emits positive `remainingSent`, `requiredBatches >= 1`, deterministic `channelMix`, and deterministic `latestSendBy`.
- Threshold-met fixture emits `remainingSent = 0`, `requiredBatches = 0`, and no contradictory send recommendation while retaining deterministic envelope shape.
- Repeated runs over the same fixtures return byte-stable JSON except documented runtime fields (if any).

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/pilot-sample-gap-planner.test.ts
bun run pilot:sample-gap-planner -- --brief tests/tools/fixtures/pilot-sample-gap-planner-under-threshold.brief.md --run-sheet tests/tools/fixtures/pilot-sample-gap-planner-under-threshold.run-sheet.md --responses tests/tools/fixtures/pilot-sample-gap-planner-under-threshold.responses.md --batch-size 3 --format json
bun run pilot:sample-gap-planner -- --brief tests/tools/fixtures/pilot-sample-gap-planner-threshold-met.brief.md --run-sheet tests/tools/fixtures/pilot-sample-gap-planner-threshold-met.run-sheet.md --responses tests/tools/fixtures/pilot-sample-gap-planner-threshold-met.responses.md --batch-size 3 --format json
bun run pilot:sample-gap-planner -- --brief OFFER_BRIEF.md --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md --batch-size 3 --format json
```

## TASKPAD Intake Slice (2026-03-01): Immutable inbound reply evidence gate (`pilot:response-proof`)

### Distilled Scope
**Problem**
- Pricing/hypothesis conclusions currently rely on mutable `pilot-response-log.md` rows that can drift from raw inbound messages.
- We need a deterministic gate that only counts non-`pending` decisions when each row maps to immutable inbound proof (`messageId`, source export hash, response timestamp).
- The backlog target requires deterministic fail behavior with rule IDs: `MISSING_REPLY_PROOF`, `RECIPIENT_MISMATCH`, `RESPONSE_TIMESTAMP_DRIFT`.

**In scope**
- Define `pilot-reply-proof-index.ndjson` contract and normalization rules (immutable fields, timestamp format, recipient key policy, duplicate handling).
- Implement `pilot:response-proof` CLI validation over `pilot-response-log.md` + proof index with deterministic JSON/human output.
- Enforce gating rule: every non-`pending` decision row must resolve to exactly one compatible proof record.
- Emit deterministic mismatch diagnostics with required rule IDs and row pointers.
- Add fixture-backed tests for aligned pass + deterministic mismatch classes, plus smoke/E2E command evidence for the live pilot batch.

**Out of scope**
- Ingesting raw provider exports (`pilot:ingest-replies`) or writing/upserting response rows.
- Send-proof and outbound delivery validation (`pilot:send-proof`, `pilot:dispatch-batch`).
- Changing pricing verdict algorithms beyond proof-eligibility gating.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tools/pilot-response-proof.ts` (new)
  - `tests/tools/pilot-response-proof.test.ts` (new)
  - `tests/tools/fixtures/pilot-response-proof-*.ndjson` (new aligned/mismatch fixtures)
  - `tests/tools/fixtures/pilot-response-proof-*.md` (new response-log fixtures)
  - `docs/distribution/first-pilot-2026-02/pilot-response-log.md`
  - `docs/distribution/first-pilot-2026-02/pilot-reply-proof-index.ndjson` (new)
  - `tools/pilot-ingest-replies.ts` (existing parser/error contract reference)
  - `tools/pilot-latency.ts` (existing deterministic `RECIPIENT_MISMATCH` handling reference)
  - `tests/tools/pilot-ingest-replies.test.ts` (existing deterministic rule-ID assertion patterns)
  - `package.json`
  - `README.md`
- **Search queries/patterns:**
  - `search "pilot:response-proof|response-proof|pilot-reply-proof-index|MISSING_REPLY_PROOF|RECIPIENT_MISMATCH|RESPONSE_TIMESTAMP_DRIFT"`
  - `search "pilot:send-proof|proof-index|pilot-response-log|pilot-ingest-replies|pilot:decision-gate"`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "pilot:response-proof|response-proof|pilot-reply-proof-index|MISSING_REPLY_PROOF|RECIPIENT_MISMATCH|RESPONSE_TIMESTAMP_DRIFT"`
  - `search "pilot:send-proof|proof-index|pilot-response-log|pilot-ingest-replies|pilot:decision-gate"`
  - `select set IMPLEMENTATION_PLAN.md package.json README.md tools/pilot-ingest-replies.ts tools/pilot-latency.ts tests/tools/pilot-ingest-replies.test.ts tests/tools/fixtures/pilot-replies.ndjson tests/tools/fixtures/pilot-replies.expected.json docs/distribution/first-pilot-2026-02/pilot-response-log.md docs/distribution/first-pilot-2026-02/pilot-event-log.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define `pilot-reply-proof-index.ndjson` schema + canonical field contract (recipient key, immutable message ID, source export hash, response timestamp, optional provenance metadata) in README/docs with explicit normalization rules.
- [x] **TP002**: Implement `tools/pilot-response-proof.ts` CLI arg parsing (`--responses`, `--evidence`, `--format`) and deterministic output envelope (`status`, `eligibleDecisions`, `validated`, `errors`).
- [x] **TP003**: Implement robust response-log parser for decision-state rows and deterministic filtering for `non-pending` candidates only.
- [x] **TP004**: Implement proof-index NDJSON loader/validator with deterministic rejection for malformed/duplicate proof records before cross-artifact matching.
- [x] **TP005**: Implement row→proof matcher requiring exact recipient alignment and one-to-one binding for non-`pending` rows; emit `MISSING_REPLY_PROOF` when no record exists.
- [x] **TP006**: Implement recipient-integrity rule path that emits `RECIPIENT_MISMATCH` when proof recipient identity disagrees with response-log row identity.
- [x] **TP007**: Implement timestamp-integrity rule path that emits `RESPONSE_TIMESTAMP_DRIFT` when normalized response timestamp differs from immutable proof timestamp.
- [x] **TP008**: Add fixture corpus for aligned pass and each deterministic mismatch case, plus edge cases (pending rows ignored, duplicate proof rows) under `tests/tools/fixtures/`.
- [x] **TP009**: Add focused tests in `tests/tools/pilot-response-proof.test.ts` asserting deterministic pass/fail behavior, exact rule IDs, and stable JSON payload ordering.
- [x] **TP010**: Wire `pilot:response-proof` script in `package.json`, document usage in `README.md`, and add smoke/E2E validation note for `docs/distribution/first-pilot-2026-02` artifacts.

### Acceptance Criteria
- `bun run pilot:response-proof -- --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md --evidence docs/distribution/first-pilot-2026-02/pilot-reply-proof-index.ndjson --format json` passes aligned fixtures and live-batch-aligned artifacts.
- Deterministic mismatch fixtures fail with exact required rule IDs: `MISSING_REPLY_PROOF`, `RECIPIENT_MISMATCH`, `RESPONSE_TIMESTAMP_DRIFT`.
- Only non-`pending` decisions are counted toward proof-eligibility totals; pending rows are reported as ignored/non-blocking.
- Output is deterministic across reruns (stable ordering, stable rule emission, stable summary counts).

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/pilot-response-proof.test.ts
bun run pilot:response-proof -- --responses tests/tools/fixtures/pilot-response-proof-aligned.responses.md --evidence tests/tools/fixtures/pilot-response-proof-aligned.evidence.ndjson --format json
bun run pilot:response-proof -- --responses tests/tools/fixtures/pilot-response-proof-missing-proof.responses.md --evidence tests/tools/fixtures/pilot-response-proof-missing-proof.evidence.ndjson --format json
bun run pilot:response-proof -- --responses tests/tools/fixtures/pilot-response-proof-recipient-mismatch.responses.md --evidence tests/tools/fixtures/pilot-response-proof-recipient-mismatch.evidence.ndjson --format json
bun run pilot:response-proof -- --responses tests/tools/fixtures/pilot-response-proof-timestamp-drift.responses.md --evidence tests/tools/fixtures/pilot-response-proof-timestamp-drift.evidence.ndjson --format json
bun run pilot:response-proof -- --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md --evidence docs/distribution/first-pilot-2026-02/pilot-reply-proof-index.ndjson --format json
```

## TASKPAD Intake Slice (2026-03-01): Deterministic reply-ingestion upserts (`pilot:ingest-replies`)

### Distilled Scope
**Problem**
- Reply capture is still manually transcribed into `pilot-response-log.md` and `pilot-event-log.md`, which delays follow-up/pricing decisions and introduces transcription drift.
- The backlog target requires a single ingestion command over raw inbox/channel exports that deterministically upserts both artifacts.
- The command must suppress duplicate message IDs and fail malformed rows with actionable deterministic rule IDs: `UNKNOWN_RECIPIENT`, `DUPLICATE_MESSAGE_ID`, `INVALID_DECISION_STATE`.

**In scope**
- Define a strict NDJSON ingestion contract for raw replies (`messageId`, recipient handle, timestamp, channel, workflow sentence, optional decision/objection/WTP payloads).
- Implement `pilot:ingest-replies` CLI orchestration to read input rows, normalize fields, and build deterministic upsert plans for response-log + event-log.
- Add duplicate-message suppression logic that is deterministic across reruns and across already-recorded events.
- Validate malformed/unknown rows with stable machine-readable rule IDs and row pointers.
- Add fixture-backed tests and smoke validation evidence for repo fixtures and real batch artifacts.

**Out of scope**
- Outbound send automation and proof-index workflows (`pilot:dispatch-batch`, `pilot:send-proof`).
- Replacing existing markdown artifact formats (`pilot-response-log.md`, `pilot-event-log.md`).
- Broad changes to monetization verdict logic outside ingestion/upsert correctness.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tools/pilot-ingest-replies.ts` (new)
  - `tests/tools/pilot-ingest-replies.test.ts` (new)
  - `tests/tools/fixtures/pilot-replies.ndjson` (new)
  - `tests/tools/fixtures/pilot-replies-*.ndjson` (new malformed/duplicate scenarios)
  - `tools/pilot-rebuild.ts` (existing parser/reducer/error-contract reference)
  - `tests/tools/pilot-rebuild.test.ts` (existing deterministic rule assertion patterns)
  - `docs/distribution/first-pilot-2026-02/pilot-event-log.md`
  - `docs/distribution/first-pilot-2026-02/pilot-response-log.md`
  - `package.json`
  - `README.md`
- **Search queries/patterns:**
  - `search "pilot:ingest-replies|pilot-ingest|ingest-replies|DUPLICATE_MESSAGE_ID|UNKNOWN_RECIPIENT|INVALID_DECISION_STATE"`
  - `search "pilot-response-log|pilot-event-log|pilot:rebuild|RECEIVE_REPLY|parseExistingResponseLog"`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "pilot:ingest-replies|pilot-ingest|ingest-replies|DUPLICATE_MESSAGE_ID|UNKNOWN_RECIPIENT|INVALID_DECISION_STATE"`
  - `search "pilot-response-log|pilot-event-log|pilot:rebuild|RECEIVE_REPLY|parseExistingResponseLog"`
  - `select set IMPLEMENTATION_PLAN.md package.json README.md tools/pilot-rebuild.ts tests/tools/pilot-rebuild.test.ts docs/distribution/first-pilot-2026-02/pilot-event-log.md docs/distribution/first-pilot-2026-02/pilot-response-log.md docs/distribution/first-pilot-2026-02/pilot-run-sheet.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define ingestion contract + normalization matrix in docs/README section (required NDJSON keys, optional fields, enum mapping, stable defaulting rules, and row-level diagnostics schema).
- [x] **TP002**: Implement `tools/pilot-ingest-replies.ts` CLI argument parsing (`--input`, `--responses`, `--events`, `--format`) and deterministic command output envelope (`status`, `processed`, `upserts`, `suppressed`, `errors`).
- [x] **TP003**: Implement NDJSON parser/validator pipeline with row indexing + schema checks that emits deterministic failure entries for malformed payloads and invalid decision-state values (`INVALID_DECISION_STATE`).
- [x] **TP004**: Implement recipient resolution against existing pilot artifacts (and/or event-derived recipient set) so unknown handles fail with `UNKNOWN_RECIPIENT` while valid handles proceed.
- [x] **TP005**: Implement duplicate-message suppression keyed by immutable `messageId` across input batch and existing event history; ensure deterministic suppression semantics and `DUPLICATE_MESSAGE_ID` diagnostics.
- [x] **TP006**: Implement deterministic upsert planner that appends canonical reply events to `pilot-event-log.md` and updates matching recipient rows in `pilot-response-log.md` atomically (stable sort/order + stable timestamps handling).
- [x] **TP007**: Add fixture corpus for happy path, duplicate replay, unknown recipient, invalid decision state, and malformed row scenarios under `tests/tools/fixtures/` with expected JSON/error snapshots.
- [x] **TP008**: Add focused tests in `tests/tools/pilot-ingest-replies.test.ts` asserting deterministic upsert summaries, duplicate suppression behavior, and exact rule-ID failures.
- [x] **TP009**: Wire `pilot:ingest-replies` script in `package.json`, document usage in `README.md`, and add smoke/E2E validation note for real batch ingestion replayability.

### Acceptance Criteria
- `bun run pilot:ingest-replies -- --input tests/tools/fixtures/pilot-replies.ndjson --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md --events docs/distribution/first-pilot-2026-02/pilot-event-log.md --format json` emits deterministic upsert summaries across reruns.
- Duplicate message IDs are deterministically suppressed/flagged with actionable diagnostics and do not create duplicate response/event mutations.
- Malformed rows fail with deterministic rule IDs including `UNKNOWN_RECIPIENT`, `DUPLICATE_MESSAGE_ID`, and `INVALID_DECISION_STATE`.
- Smoke validation shows ingestion updates are compatible with downstream `pilot:rebuild --check` consistency expectations.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/pilot-ingest-replies.test.ts
bun run pilot:ingest-replies -- --input tests/tools/fixtures/pilot-replies.ndjson --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md --events docs/distribution/first-pilot-2026-02/pilot-event-log.md --format json
bun run pilot:ingest-replies -- --input tests/tools/fixtures/pilot-replies-duplicates.ndjson --responses tests/tools/fixtures/pilot-ingest-replies-base.responses.md --events tests/tools/fixtures/pilot-ingest-replies-base.events.md --format json
bun run pilot:ingest-replies -- --input tests/tools/fixtures/pilot-replies-invalid-decision.ndjson --responses tests/tools/fixtures/pilot-ingest-replies-base.responses.md --events tests/tools/fixtures/pilot-ingest-replies-base.events.md --format json
bun run pilot:rebuild -- --events docs/distribution/first-pilot-2026-02/pilot-event-log.md --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md --check
```

## TASKPAD Intake Slice (2026-03-01): Append-only pilot event log + deterministic rebuild gate (`pilot:rebuild`)

### Distilled Scope
**Problem**
- Pilot outreach evidence is currently maintained via manual dual edits across `pilot-run-sheet.md` and `pilot-response-log.md`, which already shows timestamp drift risk (follow-up/send mismatch).
- Monetization decisions need an auditable source-of-truth trail; mutable markdown rows without an append-only ledger can hide state-history mistakes.
- The backlog target requires a deterministic `pilot:rebuild --check` command that rebuilds both artifacts from events and fails drift with stable rule IDs: `ROW_TIMESTAMP_DRIFT`, `MISSING_EVENT`, `INVALID_TRANSITION`.

**In scope**
- Define an append-only `pilot-event-log` artifact contract (event schema, required fields, allowed transitions, ordering assumptions, deterministic tie-break rules).
- Implement deterministic reducers that derive canonical run-sheet and response-log row state from events.
- Add a `pilot:rebuild` CLI with `--events`, `--run-sheet`, `--responses`, `--check` to compare reconstructed outputs against markdown artifacts.
- Add fixture-backed tests for aligned pass and deterministic drift failure cases mapped to the required rule IDs.
- Add smoke/E2E verification notes for real-batch artifact checking in `docs/distribution/first-pilot-2026-02`.

**Out of scope**
- Inbox/provider ingestion automation (`pilot:ingest-replies`) and outbound dispatch automation.
- Changing monetization verdict logic (`offer:hypothesis-verdict`) beyond artifact consistency checks.
- Replacing markdown artifact format wholesale; this slice validates/rebuilds existing contract outputs.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tools/pilot-rebuild.ts` (new)
  - `tests/tools/pilot-rebuild.test.ts` (new)
  - `tests/tools/fixtures/` (new `pilot-rebuild-*` aligned/drift fixtures)
  - `docs/distribution/first-pilot-2026-02/pilot-event-log.md` (new)
  - `docs/distribution/first-pilot-2026-02/pilot-run-sheet.md`
  - `docs/distribution/first-pilot-2026-02/pilot-response-log.md`
  - `tools/pilot-latency.ts` (existing parser/CLI/error handling reference)
  - `package.json`
  - `README.md`
- **Search queries/patterns:**
  - `search "pilot-run-sheet|pilot-response-log|Send Outcome Log|Response State|no response yet"`
  - `search "pilot-event-log|pilot:rebuild|ROW_TIMESTAMP_DRIFT|MISSING_EVENT|INVALID_TRANSITION"`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "pilot-run-sheet|pilot-response-log|Send Outcome Log|Response State|no response yet"`
  - `search "pilot-event-log|pilot:rebuild|ROW_TIMESTAMP_DRIFT|MISSING_EVENT|INVALID_TRANSITION"`
  - `select set IMPLEMENTATION_PLAN.md package.json README.md tools/pilot-latency.ts tests/tools/pilot-latency.test.ts docs/distribution/first-pilot-2026-02/pilot-run-sheet.md docs/distribution/first-pilot-2026-02/pilot-response-log.md docs/distribution/first-pilot-2026-02/pilot-latency-contract.md docs/distribution/first-pilot-2026-02/pilot-latency-smoke-validation.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define `pilot-event-log` contract doc (`docs/distribution/first-pilot-2026-02/pilot-event-log.md` + brief README note): event types, immutable row key strategy, required timestamps, and transition matrix for send/follow-up/response/decision updates.
- [x] **TP002**: Implement event-log parser/validator in `tools/pilot-rebuild.ts` (frontmatter + markdown table/event rows) with deterministic ordering and structural validation diagnostics.
- [x] **TP003**: Implement deterministic run-sheet reducer from events (one canonical row per recipient) including send/follow-up timestamp derivation and duplicate/conflict handling.
- [x] **TP004**: Implement deterministic response-log reducer from events (workflow sentence, objection enum, WTP signal, decision state, rationale, response timestamp invariants).
- [x] **TP005**: Implement transition/rule engine that emits deterministic failure payloads for invalid lifecycle movement (`INVALID_TRANSITION`) before artifact comparison.
- [x] **TP006**: Implement `--check` comparison mode to diff reconstructed rows against provided `pilot-run-sheet.md` + `pilot-response-log.md`, emitting deterministic mismatch codes (`ROW_TIMESTAMP_DRIFT`, `MISSING_EVENT`) and offending recipient/field pointers.
- [x] **TP007**: Add fixture corpus (`tests/tools/fixtures/pilot-rebuild-*.md`) for aligned pass + each required drift class, including stable expected error snapshots.
- [x] **TP008**: Add focused tests (`tests/tools/pilot-rebuild.test.ts`) covering parser validation, reducer determinism, and `--check` pass/fail branches with exact rule-ID assertions.
- [x] **TP009**: Wire `pilot:rebuild` script in `package.json`, add usage docs in `README.md`, and create a smoke/E2E evidence note for real-batch command output against `docs/distribution/first-pilot-2026-02/*`.

### Acceptance Criteria
- `bun run pilot:rebuild -- --events docs/distribution/first-pilot-2026-02/pilot-event-log.md --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md --check` passes aligned fixtures deterministically.
- Drift fixtures fail deterministically with exact required rule IDs: `ROW_TIMESTAMP_DRIFT`, `MISSING_EVENT`, `INVALID_TRANSITION`.
- Reducers are deterministic across reruns (stable row ordering + stable rule emission for the same input).
- Smoke validation proves real batch artifacts can be audited from event log without manual dual-edit assumptions.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/pilot-rebuild.test.ts
bun run pilot:rebuild -- --events tests/tools/fixtures/pilot-rebuild-aligned.events.md --run-sheet tests/tools/fixtures/pilot-rebuild-aligned.run-sheet.md --responses tests/tools/fixtures/pilot-rebuild-aligned.responses.md --check
bun run pilot:rebuild -- --events tests/tools/fixtures/pilot-rebuild-row-timestamp-drift.events.md --run-sheet tests/tools/fixtures/pilot-rebuild-row-timestamp-drift.run-sheet.md --responses tests/tools/fixtures/pilot-rebuild-row-timestamp-drift.responses.md --check
bun run pilot:rebuild -- --events docs/distribution/first-pilot-2026-02/pilot-event-log.md --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md --check
```

---

## TASKPAD Intake Slice (2026-03-01): Pilot response-latency analyzer (`pilot:latency`) for channel/CTA conversion timing

### Distilled Scope
**Problem**
- Current pilot observability tracks send/reply counts and decision states, but does not quantify response timing by channel/CTA variant.
- Without deterministic latency metrics (`hoursToFirstReply`, follow-up conversion, time-to-cold), monetization decisions can overweight raw reply counts and miss which outreach pattern actually advances conversations.
- The target backlog requires deterministic JSON outputs (`medianHoursToFirstReply`, `p90HoursToFirstReply`, `followupConversionRate`, `coldAgedCount`) that match fixture expectations.

**In scope**
- Add a deterministic `pilot:latency` CLI command that reads pilot run sheet + response log and emits per-batch/per-channel latency metrics in JSON (and optional human-readable summary).
- Define canonical parsing/normalization rules for send timestamps, first-reply timestamps, follow-up detection, and cold-aging thresholds so repeated runs are stable.
- Add fixture-driven tests covering no-reply, mixed-reply, and follow-up-converted scenarios, including deterministic percentile/median rounding behavior.
- Wire script/docs references so latency analysis is runnable in the same workflow as other pilot observability commands.

**Out of scope**
- Building message ingestion automation from external inbox exports.
- Changing pilot artifact schemas beyond minimal metadata needed for deterministic latency derivation.
- Offer/pricing verdict logic outside latency metric generation.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tools/pilot-latency.ts`
  - `tools/lib/` (shared markdown-table parsing + metric helpers, if introduced)
  - `tests/tools/pilot-latency.test.ts`
  - `tests/tools/fixtures/` (latency scenarios + expected JSON)
  - `docs/distribution/first-pilot-2026-02/pilot-run-sheet.md`
  - `docs/distribution/first-pilot-2026-02/pilot-response-log.md`
  - `package.json`
  - `README.md`
- **Search queries/patterns:**
  - `search "pilot-run-sheet|pilot-response-log|Sent Timestamp|Response State|pending|no response yet" "docs/distribution"`
  - `search "tools/.*pilot|markdown table|deterministic json|percentile|median" "tools" "tests/tools" "package.json"`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "pilot-run-sheet|pilot-response-log|no response yet|pending|follow-up" "docs/distribution" "tools" "tests/tools"`
  - `select set IMPLEMENTATION_PLAN.md tools/pilot-latency.ts tests/tools/pilot-latency.test.ts tests/tools/fixtures docs/distribution/first-pilot-2026-02/pilot-run-sheet.md docs/distribution/first-pilot-2026-02/pilot-response-log.md package.json README.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define `pilot:latency` contract in docs (`docs/distribution` QA note or README section): required inputs, timestamp assumptions, cold-aging rule, and deterministic metric field definitions.
- [x] **TP002**: Implement `tools/pilot-latency.ts` CLI argument parsing + artifact loading (`--run-sheet`, `--responses`, `--format json`) with stable error codes for malformed/missing data.
- [x] **TP003**: Implement deterministic metric engine for: `hoursToFirstReply`, `medianHoursToFirstReply`, `p90HoursToFirstReply`, `followupConversionRate`, and `coldAgedCount`, including explicit rounding/percentile policy.
- [x] **TP004**: Add per-channel/per-batch grouping output so channel + CTA comparisons are queryable from one run without post-processing.
- [x] **TP005**: Add fixtures + focused tests (`tests/tools/pilot-latency.test.ts`) for deterministic no-reply, mixed-reply, and follow-up-conversion scenarios with expected JSON snapshots.
- [x] **TP006**: Wire npm script (`pilot:latency`) in `package.json` and document runnable verification flow in `README.md` (or distribution QA doc).
- [x] **TP007**: Add smoke/E2E verification artifact note proving command output on `docs/distribution/first-pilot-2026-02/*` matches fixture expectations and is stable across reruns.

### Acceptance Criteria
- `bun run pilot:latency -- --run-sheet <path> --responses <path> --format json` emits deterministic JSON including `medianHoursToFirstReply`, `p90HoursToFirstReply`, `followupConversionRate`, and `coldAgedCount`.
- Output includes per-channel latency/conversion breakdown suitable for channel/CTA comparison.
- Fixture tests lock median/p90/ratio calculations and pass consistently across repeated runs.
- Malformed timestamps, missing recipient mappings, or invalid states fail with actionable deterministic diagnostics.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/pilot-latency.test.ts
bun run pilot:latency -- --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md --format json
bun run pilot:latency -- --run-sheet tests/tools/fixtures/pilot-latency-mixed.run-sheet.md --responses tests/tools/fixtures/pilot-latency-mixed.responses.md --format json
```

---

## TASKPAD Intake Slice (2026-03-01): Preflight writable-path probe contract + routing gate before intake mutations

### Distilled Scope
**Problem**
- Writeability probing exists as an internal helper, but there is no first-class preflight command contract that operators/orchestrators can run directly before mutation flows.
- The target backlog asks for deterministic `writable=true|false` evidence across repo fixture paths versus vault TASKPAD paths, with routing behavior that matches preflight output.
- Intake automation should decide direct-write vs fallback-artifact mode up front and avoid unhandled permission-class (`EPERM`/`EACCES`/`EROFS`) exits during auto-ideation mutations.

**In scope**
- Define and expose a deterministic `taskpad:write-preflight` CLI command (machine-readable + human output) backed by the shared probe utility.
- Ensure `taskpad:auto-ideation` routing is preflight-first, with explicit contract fields proving mode selection (`direct-write|fallback-artifact|error`) from probe output.
- Add focused verification coverage for repo fixture writable path vs vault TASKPAD path, plus permission-class fallback behavior without unhandled exits.
- Update intake docs/quality evidence so Builder/Tester can run one clear preflight check before mutation commands.

**Out of scope**
- Reworking candidate ranking heuristics or semantic dedupe behavior.
- Changing fallback artifact schema/validator beyond what routing-proof needs.
- Any product clipping/runtime features outside TASKPAD intake tooling.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tools/taskpad-write-preflight.ts`
  - `tools/taskpad-auto-ideation.ts`
  - `tools/taskpad-intake-recover.ts`
  - `tests/tools/taskpad-write-preflight.test.ts`
  - `tests/tools/taskpad-auto-ideation.test.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `README.md`
  - `package.json`
- **Search queries/patterns:**
  - `search "probeTaskpadWriteability|PRECHECK_|taskpad-write-preflight|writable" "tools/taskpad-write-preflight.ts" "tests/tools/taskpad-write-preflight.test.ts" "package.json" "README.md"`
  - `search "preflight.mode|preflight.writable|fallback-artifact|EPERM|taskpad:auto-ideation" "tools/taskpad-auto-ideation.ts" "tests/tools/taskpad-auto-ideation.test.ts" "tools/taskpad-intake-recover.ts"`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "preflight|writable|taskpad:auto-ideation|EPERM|taskpad:apply-fallback" "tools" "tests/tools" "package.json" "README.md" "docs/quality" "IMPLEMENTATION_PLAN.md"`
  - `select set IMPLEMENTATION_PLAN.md tools/taskpad-write-preflight.ts tools/taskpad-auto-ideation.ts tools/taskpad-intake-recover.ts tests/tools/taskpad-write-preflight.test.ts tests/tools/taskpad-auto-ideation.test.ts docs/quality/taskpad-auto-ideation.md README.md package.json`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define `taskpad:write-preflight` command contract in `docs/quality/taskpad-auto-ideation.md` (inputs, output schema, deterministic reason-code mapping, exit semantics).
- [x] **TP002**: Implement CLI entrypoint behavior in `tools/taskpad-write-preflight.ts` (arg parsing, machine-readable JSON packet, stable human summary including `writable=true|false`).
- [x] **TP003**: Wire npm script + docs references (`package.json`, `README.md`) so preflight can be run independently before `taskpad:auto-ideation`/`taskpad:intake:recover`.
- [x] **TP004**: Harden `tools/taskpad-auto-ideation.ts` routing assertions so preflight outcome is the primary mode selector and permission-class write races still degrade deterministically to fallback (never unhandled `EPERM`).
- [x] **TP005**: Extend `tests/tools/taskpad-write-preflight.test.ts` with deterministic command-contract coverage (writable fixture path, missing-path/non-writable branches, reason-code stability).
- [x] **TP006**: Extend `tests/tools/taskpad-auto-ideation.test.ts` (and recover flow tests if needed) to assert mode selection aligns with preflight output and permission-denied scenarios return fallback/result packets instead of process crashes.
- [x] **TP007**: Add smoke verification notes in `docs/quality/taskpad-auto-ideation-report.md` for repo-fixture vs vault-path preflight runs and matching auto-ideation routing evidence.

### Acceptance Criteria
- `taskpad:write-preflight` returns deterministic `writable=true|false` + stable reason code for both writable repo fixture path and vault TASKPAD path scenarios.
- `taskpad:auto-ideation` mode selection (`direct-write|fallback-artifact|error`) matches preflight output and avoids unhandled permission-class exits.
- Tests cover command contract + routing alignment and remain deterministic.
- README/quality docs show the preflight-before-mutation workflow and expected evidence fields.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-write-preflight.test.ts
bun test tests/tools/taskpad-auto-ideation.test.ts
bun run taskpad:write-preflight -- --taskpad tests/tools/fixtures/taskpad-queue-health-empty.md
bun run taskpad:write-preflight -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md"
bun run taskpad:auto-ideation -- --taskpad tests/tools/fixtures/taskpad-queue-health-empty.md --plan IMPLEMENTATION_PLAN.md
bun run taskpad:auto-ideation -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md
```

---

## TASKPAD Intake Slice (2026-03-01): Deterministic `taskpad:apply-fallback` apply step for read-only auto-ideation artifacts

### Distilled Scope
**Problem**
- Intake auto-ideation now produces fallback patch artifacts on read-only TASKPAD paths, but the loop still stalls when apply behavior is not exercised as one deterministic step.
- The current `EPERM` failure class needs an auditable, single-command recovery path that proves insertion happened and exits cleanly.
- Engineer handoff needs one focused slice that formalizes artifact-apply validation and E2E smoke evidence for vault TASKPAD targets.

**In scope**
- Plan and enforce a deterministic `taskpad:apply-fallback` apply workflow for read-only auto-ideation artifacts (`taskpadSha256` + target-path alignment + insertion apply).
- Add/confirm focused command/test coverage for success, stale artifact rejection, path mismatch rejection, and idempotent re-run behavior.
- Add an explicit E2E smoke path that runs `taskpad:auto-ideation` (read-only/fallback mode) then `taskpad:apply-fallback` and verifies backlog insertion + clean exit semantics.
- Ensure machine-readable output and reason codes are stable for orchestrator consumption.

**Out of scope**
- Reworking auto-ideation ranking heuristics or queue-health thresholds.
- Any product feature implementation outside TASKPAD intake/recovery tooling.
- Manual patch editing workflows outside deterministic artifact contracts.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tools/taskpad-auto-ideation.ts`
  - `tools/taskpad-apply-fallback.ts`
  - `tools/taskpad-intake-recover.ts`
  - `tests/tools/taskpad-auto-ideation.test.ts`
  - `tests/tools/taskpad-apply-fallback.test.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `README.md`
  - `package.json`
- **Search queries/patterns:**
  - `search "taskpad:apply-fallback|fallback|artifactPath|taskpadSha256|EPERM" "tools" "tests/tools" "docs/quality" "README.md" "package.json"`
  - `search "taskpad:auto-ideation|taskpad:intake:recover|apply-fallback" "tools/taskpad-intake-recover.ts" "tools/taskpad-auto-ideation.ts"`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "taskpad:apply-fallback|taskpad:auto-ideation|EPERM|fallback" "tools" "tests/tools" "package.json" "README.md" "docs/quality" "IMPLEMENTATION_PLAN.md"`
  - `select set IMPLEMENTATION_PLAN.md tools/taskpad-auto-ideation.ts tools/taskpad-apply-fallback.ts tools/taskpad-intake-recover.ts tests/tools/taskpad-apply-fallback.test.ts docs/quality/taskpad-auto-ideation.md package.json README.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Tighten/confirm `taskpad:apply-fallback` contract in `docs/quality/taskpad-auto-ideation.md` (required fields, validation order, deterministic status/reason-code matrix).
- [x] **TP002**: Implement or harden `tools/taskpad-apply-fallback.ts` validation/apply pipeline to guarantee target-path + `taskpadSha256` checks before mutation and deterministic `applied|noop|rejected` outcomes.
- [x] **TP003**: Add/extend focused tests in `tests/tools/taskpad-apply-fallback.test.ts` for happy path insertion, hash/path mismatch rejection, malformed artifact rejection, and idempotent re-run.
- [x] **TP004**: Add a read-only recovery smoke path that chains `taskpad:auto-ideation` artifact generation to `taskpad:apply-fallback` apply verification with clean exit semantics.
- [x] **TP005**: Update `README.md` + script/docs references for the canonical fallback flow and machine-readable evidence expectations.

### Acceptance Criteria
- `taskpad:apply-fallback` deterministically applies valid fallback artifacts and updates TASKPAD exactly once.
- Stale/tampered artifacts fail with deterministic reason codes and no partial file mutation.
- Re-running against already-applied artifacts returns stable safe outcome (`noop` or documented equivalent) with clean exit.
- End-to-end fallback smoke flow proves read-only auto-ideation artifact can be applied via one auditable step.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-apply-fallback.test.ts
bun run taskpad:auto-ideation -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md
bun run taskpad:apply-fallback -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --artifact "<artifact-path>"
```

---

## TASKPAD Intake Slice (2026-02-28): Deterministic completed-slice pruning for intake plan maintainability (`taskpad:plan-prune`)

### Distilled Scope
**Problem**
- `IMPLEMENTATION_PLAN.md` has accumulated many completed intake slices, which increases context noise and token cost during autonomous planning loops.
- Existing process relies on manual trimming/archiving, so hygiene drifts and older completed slices can crowd out current context.
- We need one deterministic command to prune/archive completed slices while preserving the active planning contract.

**In scope**
- Add `taskpad:plan-prune` command that moves completed intake slices older than a configurable keep window (default newest 5) into `docs/archive/IMPLEMENTATION_PLAN_ARCHIVE_YYYY-MM-DD.md`.
- Keep newest slices in-place, preserve heading order, and leave active/incomplete slices untouched.
- Emit machine-readable output (`status`, `prunedCount`, `keptCount`, `archivePath`, `reasonCode`) for orchestrator loops.
- Add focused tests for no-op, prune success, and guardrail behavior when required headings are missing.

**Out of scope**
- Rewriting historical archive content.
- Changing queue-health, auto-ideation ranking, or plan-contract semantics.
- Any Builder implementation outside intake/planning tooling.

### Ideation Candidates Considered
1. **[AUTOMATION]** Add deterministic `taskpad:plan-prune` command to archive older completed slices and keep top-of-plan context compact. **(selected)**
2. **[RELIABILITY]** Add a stale-slice detector that blocks autoplan when the newest active slice age exceeds a configured freshness threshold.
3. **[OBSERVABILITY]** Add an intake-plan growth telemetry report (slice count/tokens over time) with trend alerts.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `IMPLEMENTATION_PLAN.md`
  - `tools/taskpad-plan-seed.ts`
  - `tools/taskpad-intake-autoplan.ts`
  - `tools/implementation-plan-integrity.ts`
  - `package.json`
  - `README.md`
- **Search queries/patterns:**
  - `search "TASKPAD Intake Slice|Trimmed to active|archive|planned-" IMPLEMENTATION_PLAN.md docs/archive package.json tools`
  - `search "taskpad:intake:autoplan|taskpad:plan-seed|plan:integrity" tools package.json README.md`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "TASKPAD Intake Slice|Trimmed to active|archive|planned-" "IMPLEMENTATION_PLAN.md" "docs/archive" "tools" "package.json"`
  - `select set IMPLEMENTATION_PLAN.md package.json tools/taskpad-intake-autoplan.ts tools/taskpad-plan-seed.ts tools/implementation-plan-integrity.ts README.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define `taskpad:plan-prune` contract in `docs/quality/taskpad-auto-ideation.md` (keep-window rules, archive naming, machine-readable output schema, reason codes).
- [x] **TP002**: Implement `tools/taskpad-plan-prune.ts` parser utilities to identify completed vs active slices and calculate prune set deterministically.
- [x] **TP003**: Implement archive writer + plan rewriter with atomic file update semantics and guardrails for malformed heading structures.
- [x] **TP004**: Add focused tests (`tests/tools/taskpad-plan-prune.test.ts`) covering no-op (already compact), prune success, and missing-heading rejection.
- [x] **TP005**: Wire npm script (`taskpad:plan-prune`) in `package.json` and add usage docs/evidence checklist in `README.md` + quality docs.

### Acceptance Criteria
- Running `taskpad:plan-prune` keeps newest completed slices within configured window and archives older completed slices deterministically.
- Active/incomplete slice content remains untouched.
- Command outputs stable machine-readable summary for orchestration.
- Tests cover core deterministic success/failure branches.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-plan-prune.test.ts
bun run taskpad:plan-prune -- --plan tests/tools/fixtures/taskpad-plan-seed-ready.plan.md --keep 2
bun run plan:integrity -- --plan tests/tools/fixtures/taskpad-plan-seed-ready.plan.md
```

---

## TASKPAD Intake Slice (2026-02-28): Unified intake-to-plan orchestration (`taskpad:intake:autoplan`)

### Distilled Scope
**Problem**
- Intake recovery (`taskpad:intake:recover`) and backlog promotion (`taskpad:plan-seed`) now exist, but autonomous loops still require multi-command sequencing and manual interpretation between steps.
- This split increases drift risk (recover succeeds but planning is skipped, or planning runs without final gate validation).
- We need one deterministic command that executes recovery + planning + contract verification and returns a single machine-readable handoff packet.

**In scope**
- Add `taskpad:intake:autoplan` command that runs `taskpad:intake:recover`, then `taskpad:plan-seed`, then `taskpad:plan-contract` (or equivalent contract validator) in deterministic order.
- Emit one stable JSON summary with per-step status, selected backlog line, planned marker, newest slice heading, and final verdict (`ready|hold|blocked`).
- Add focused fixture tests for already-ready/no-op, empty-queue-with-ideation path, and contract-fail path.
- Wire script entry in `package.json` and document autonomous usage in README/quality docs.

**Out of scope**
- Changing ranking heuristics in auto-ideation.
- Rewriting existing queue-health or plan-integrity rule semantics.
- Implementing product feature code outside intake orchestration/tooling.

### Ideation Candidates Considered
1. **[AUTOMATION]** Add deterministic `taskpad:intake:autoplan` orchestration that runs recover → plan-seed → plan-contract and emits one final verdict packet. **(selected)**
2. **[RELIABILITY]** Add a stricter `taskpad:plan-contract` rule that also validates theme similarity between backlog bullet and newest slice title.
3. **[OBSERVABILITY]** Add `taskpad:intake:timeline` reporting for seeded→planned→completed latency per item.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md`
  - `8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/IMPLEMENTATION_PLAN.md`
  - `tools/taskpad-intake-recover.ts`
  - `tools/taskpad-plan-seed.ts`
  - `tools/implementation-plan-integrity.ts`
  - `package.json`
- **Search queries/patterns:**
  - `search "taskpad:plan-seed|taskpad:plan-contract|taskpad:intake:recover|queue-health|planned-" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/IMPLEMENTATION_PLAN.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md"`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "taskpad:plan-seed|taskpad:plan-contract|taskpad:intake:recover|queue-health|planned-" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/IMPLEMENTATION_PLAN.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md"`
  - `select set "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/IMPLEMENTATION_PLAN.md"`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define `taskpad:intake:autoplan` contract in `docs/quality/taskpad-auto-ideation.md` (step order, no-op semantics, output schema, reason codes).
- [x] **TP002**: Implement `tools/taskpad-intake-autoplan.ts` to orchestrate recover → plan-seed → plan-contract with deterministic branching and exit semantics.
- [x] **TP003**: Add machine-readable output payload fields (`status`, `verdict`, `steps`, `selectedBacklogLine`, `plannedMarker`, `newSliceHeading`, `reasonCode`).
- [x] **TP004**: Add/extend tests (`tests/tools/taskpad-intake-autoplan.test.ts`) covering no-op ready path, empty-queue planned path, and contract-fail path.
- [x] **TP005**: Wire npm script (`taskpad:intake:autoplan`) in `package.json` and document usage in `README.md` + quality docs.

### Acceptance Criteria
- One command deterministically transitions intake from queue check through planned slice creation and contract validation.
- Command returns a single machine-readable verdict with step-level statuses for orchestrators.
- No-op and failure paths are deterministic with actionable reason codes.
- Focused tests validate core orchestration branches.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-intake-autoplan.test.ts
bun run taskpad:intake:autoplan -- --taskpad tests/tools/fixtures/taskpad-plan-seed-ready.taskpad.md --plan tests/tools/fixtures/taskpad-plan-seed-ready.plan.md --date 2026-02-28
bun run plan:integrity -- --plan tests/tools/fixtures/taskpad-plan-seed-ready.plan.md
```

---

## TASKPAD Intake Slice (2026-02-28): Deterministic backlog-to-plan promotion (`taskpad:plan-seed`)

### Distilled Scope
**Problem**
- Auto-ideation can reseed TASKPAD backlog items, but planning still depends on manual Engineer edits to both `TASKPAD.md` and `IMPLEMENTATION_PLAN.md`.
- This manual handoff introduces drift risk (item planned in plan but not marked in TASKPAD, or marked in TASKPAD without a valid top slice).
- We need one deterministic command that promotes the highest-priority unchecked self-improvement item into a plan slice scaffold and applies the planned marker in the same flow.

**In scope**
- Add `taskpad:plan-seed` command that reads TASKPAD + IMPLEMENTATION_PLAN, selects the first unchecked bullet in `## Self-Improvement Backlog`, and appends a new top intake slice scaffold.
- Generate deterministic scaffold content (`Distilled Scope`, `RepoPrompt Builder Context`, `Task Graph`, `Acceptance Criteria`, `Verification Commands`) with placeholder TP tasks ready for Engineer refinement.
- Mark the promoted TASKPAD bullet as planned using canonical lifecycle formatting (`planned-YYYY-MM-DD`) in the same command run.
- Add focused tests for: happy path promotion, no-op when no unchecked self-improvement item exists, and drift-safe rejection when target sections/headings are missing.

**Out of scope**
- Auto-writing final TP task details beyond scaffold placeholders.
- Re-ranking auto-ideation candidates or changing queue-health semantics.
- Any Builder implementation changes outside intake/planning tooling.

### Ideation Candidates Considered
1. **[AUTOMATION]** Add deterministic `taskpad:plan-seed` promotion command that atomically creates a new intake-slice scaffold and marks the source backlog item planned. **(selected)**
2. **[RELIABILITY]** Add cross-file contract gate requiring every newly `planned-YYYY-MM-DD` self-improvement item to map to the newest plan slice heading.
3. **[OBSERVABILITY]** Extend `taskpad:intake:history` with planned-item latency metrics (seeded → planned → first TP completion).

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tools/taskpad-auto-ideation.ts`
  - `tools/taskpad-intake-recover.ts`
  - `tools/implementation-plan-integrity.ts`
  - `IMPLEMENTATION_PLAN.md`
  - `README.md`
  - `package.json`
- **Search queries/patterns:**
  - `search "Self-Improvement Backlog|planned-|TASKPAD Intake Slice|Task Graph|Verification Commands" IMPLEMENTATION_PLAN.md tools README.md`
  - `search "taskpad:auto-ideation|taskpad:intake:recover|plan:integrity|verify:taskpad:intake:full" package.json tools`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "Self-Improvement Backlog|planned-|TASKPAD Intake Slice|Task Graph|Verification Commands" "IMPLEMENTATION_PLAN.md" "tools" "README.md"`
  - `select set IMPLEMENTATION_PLAN.md package.json tools/taskpad-auto-ideation.ts tools/taskpad-intake-recover.ts tools/implementation-plan-integrity.ts README.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define `taskpad:plan-seed` contract in `docs/quality/taskpad-auto-ideation.md` (selection order, scaffold template, atomic update semantics, failure reason codes).
- [x] **TP002**: Implement `tools/taskpad-plan-seed.ts` parser utilities to locate first unchecked self-improvement bullet and validate destination headings in both TASKPAD and IMPLEMENTATION_PLAN.
- [x] **TP003**: Implement deterministic intake-slice scaffold writer that inserts a new top `## TASKPAD Intake Slice (...)` block with required headings and placeholder TP tasks.
- [x] **TP004**: Implement TASKPAD mutation step that marks the selected bullet planned (`planned-YYYY-MM-DD`) and persists both files with atomic write semantics.
- [x] **TP005**: Wire npm script entry (`taskpad:plan-seed`) in `package.json` and output machine-readable summary (`status`, `selectedBacklogLine`, `newSliceHeading`, `reasonCode`).
- [x] **TP006**: Add focused tests (`tests/tools/taskpad-plan-seed.test.ts`) for success, no-unchecked-item no-op, and missing-heading rejection cases.

### Acceptance Criteria
- Running `taskpad:plan-seed` with a valid unchecked self-improvement item creates exactly one new top intake-slice scaffold in `IMPLEMENTATION_PLAN.md`.
- The promoted TASKPAD item is marked planned in canonical format during the same successful run.
- Command exits deterministically with actionable reason codes for no-op and structural validation failures.
- Tests cover core happy/fail branches and keep behavior deterministic.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-plan-seed.test.ts
bun run taskpad:plan-seed -- --taskpad tests/tools/fixtures/taskpad-plan-seed-ready.taskpad.md --plan tests/tools/fixtures/taskpad-plan-seed-ready.plan.md --date 2026-02-28
bun run plan:integrity -- --plan tests/tools/fixtures/taskpad-plan-seed-ready.plan.md
```

---

## TASKPAD Intake Slice (2026-02-28): Deterministic intake recovery orchestrator (`taskpad:intake:recover`)

### Distilled Scope
**Problem**
- Intake recovery still requires manual command choreography (`taskpad:queue-health`, `taskpad:auto-ideation`, optional `taskpad:apply-fallback`, `plan:integrity`, and full verify).
- Multi-step manual execution creates avoidable drift in autonomous loops (missed sub-step, inconsistent exit handling, weak machine-readable handoff).
- We need one deterministic orchestration command that executes the existing gates in order and emits a single actionable verdict.

**In scope**
- Add `taskpad:intake:recover` orchestration command that runs queue health, invokes auto-ideation when queues are empty, conditionally applies fallback artifacts, then runs plan-integrity/full intake verify.
- Emit a stable machine-readable output packet with per-step status, final verdict (`ready|hold|blocked`), and next-action hints.
- Add focused test coverage for: already-ready queue path, empty-queue direct-write path, empty-queue fallback-apply path, and deterministic hold/fail semantics.
- Document operator/autonomous usage and verification flow in quality docs/README.

**Out of scope**
- Reworking auto-ideation ranking heuristics.
- Introducing new queue-health or plan-integrity rules.
- Any feature implementation outside intake tooling orchestration.

### Ideation Candidates Considered
1. **[AUTOMATION]** Add deterministic `taskpad:intake:recover` orchestration that executes queue-health → auto-ideation → fallback-apply (if needed) → plan-integrity/full verify with one verdict packet. **(selected)**
2. **[OBSERVABILITY]** Add a run-history reporter that summarizes telemetry trends (`pass/fail streak`, top reason codes, time-to-recover).
3. **[RELIABILITY]** Add a contract check that blocks stale fallback artifacts older than a configurable max age before apply.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tools/taskpad-queue-health.ts`
  - `tools/taskpad-auto-ideation.ts`
  - `tools/taskpad-apply-fallback.ts`
  - `tools/implementation-plan-integrity.ts`
  - `package.json`
  - `tests/tools/taskpad-auto-ideation.test.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `README.md`
- **Search queries/patterns:**
  - `search "taskpad:queue-health|taskpad:auto-ideation|taskpad:apply-fallback|verify:taskpad:intake:auto|verify:taskpad:intake:full" tools package.json README.md`
  - `search "fallback|artifactPath|preflight|status|reasonCode|selectedCandidateId" tools/taskpad-auto-ideation.ts tools/taskpad-apply-fallback.ts tests/tools`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "taskpad:auto-ideation|taskpad:apply-fallback|verify:taskpad:intake:auto|verify:taskpad:intake:full|candidate|ranking|dedupe" "tools" "tests/tools" "docs/quality" "package.json" "IMPLEMENTATION_PLAN.md"`
  - `select set IMPLEMENTATION_PLAN.md package.json tools/taskpad-auto-ideation.ts tools/taskpad-apply-fallback.ts tools/taskpad-queue-health.ts tools/implementation-plan-integrity.ts tests/tools/taskpad-auto-ideation.test.ts docs/quality/taskpad-auto-ideation.md README.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define `taskpad:intake:recover` command contract in `docs/quality/taskpad-auto-ideation.md` (step order, branching rules, deterministic output schema, verdict semantics).
- [x] **TP002**: Implement a new orchestration tool (`tools/taskpad-intake-recover.ts`) that composes existing intake utilities/commands without duplicating business rules.
- [x] **TP003**: Implement deterministic branching for empty-queue handling: auto-ideation run, fallback-artifact detection, conditional fallback apply, then re-check queue health.
- [x] **TP004**: Integrate plan-integrity + full intake verify as terminal gates and emit one machine-readable summary (`ready|hold|blocked` + reason codes + next actions).
- [x] **TP005**: Wire script entry in `package.json` (`taskpad:intake:recover`) and ensure exit code semantics are stable for autonomous callers.
- [x] **TP006**: Add focused tests (new `tests/tools/taskpad-intake-recover.test.ts` + fixture additions) for direct-write, fallback-apply, no-op-ready, and deterministic hold/fail flows.
- [x] **TP007**: Update `README.md` + `docs/quality/taskpad-auto-ideation-report.md` with runnable examples and verification evidence expectations.

### Acceptance Criteria
- One command deterministically executes intake recovery flow and outputs a single actionable verdict packet.
- Empty-queue scenarios auto-recover through direct write or fallback apply without manual command stitching.
- Orchestrator output includes step-level statuses and deterministic reason codes suitable for automation retries.
- Tests cover all core branches and command exits non-zero only on deterministic `hold|blocked` outcomes.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-intake-recover.test.ts
bun run taskpad:intake:recover -- --taskpad tests/tools/fixtures/taskpad-queue-health-empty.md --plan IMPLEMENTATION_PLAN.md
bun run verify:taskpad:intake:full -- --taskpad tests/tools/fixtures/taskpad-queue-health-pass.md --plan IMPLEMENTATION_PLAN.md
```

---

## TASKPAD Intake Slice (2026-02-28): Deterministic auto-ideation ranking drift gate

### Distilled Scope
**Problem**
- Auto-ideation now has deterministic queue-health, fallback, preflight, telemetry, and semantic dedupe safeguards, but candidate ranking can still drift silently as heuristics evolve.
- Ranking/tie-break drift changes which backlog bullet gets seeded first, which can alter autonomous planning direction without an explicit quality signal.
- We need a deterministic guard that snapshots candidate ordering rationale and fails fast when ranking behavior changes unintentionally.

**In scope**
- Define a ranking snapshot contract for `taskpad:auto-ideation` candidate output (score breakdown + tie-break fields + stable ordering key).
- Add fixture-based snapshot coverage for at least two queue-empty scenarios that assert exact top-3 ordering.
- Add a verification command that compares current ranking output vs snapshot fixtures and returns deterministic pass/fail diagnostics.
- Document how to intentionally update snapshots when ranking logic is deliberately changed.

**Out of scope**
- Reworking semantic dedupe logic.
- Introducing non-deterministic/LLM ranking heuristics.
- Expanding intake telemetry schema beyond ranking drift signals needed for this gate.

### Ideation Candidates Considered
1. **[RELIABILITY]** Add deterministic auto-ideation ranking snapshot fixtures + drift gate so score/tie-break behavior changes are caught before queue reseeding output shifts. **(selected)**
2. **[OBSERVABILITY]** Add a queue-health trend reporter that rolls telemetry history into pass/fail streak metrics and top failure reasons.
3. **[AUTOMATION]** Add an intake orchestration wrapper that runs queue-health + plan-integrity + auto-ideation + fallback apply as one command packet.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tools/taskpad-auto-ideation.ts`
  - `tests/tools/taskpad-auto-ideation.test.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `docs/quality/taskpad-auto-ideation-report.md`
  - `package.json`
  - `IMPLEMENTATION_PLAN.md`
- **Search queries/patterns:**
  - `search "auto-ideation|candidate|ranking|score|tie-break|dedupe" tools/taskpad-auto-ideation.ts tests/tools/taskpad-auto-ideation.test.ts docs/quality/taskpad-auto-ideation.md`
  - `search "verify:taskpad:intake:auto|taskpad:auto-ideation|queue-health|plan-integrity" package.json README.md IMPLEMENTATION_PLAN.md`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "AUTO_IDEATION|Self-Improvement Backlog|TASKPAD Intake Slice" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper"`
  - `search "semantic dedupe|candidate ranking|tie-break|auto-ideation|queue-health|plan-integrity" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/IMPLEMENTATION_PLAN.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md"`
  - `select set "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/IMPLEMENTATION_PLAN.md" "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/AGENTS.md"`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define ranking snapshot contract in `docs/quality/taskpad-auto-ideation.md` (required fields, stable sort keys, and tie-break expectations).
- [x] **TP002**: Extend `tools/taskpad-auto-ideation.ts` output plumbing (if needed) so candidate ranking emits deterministic comparison fields suitable for fixture assertions.
- [x] **TP003**: Add fixture scenarios under `tests/tools/fixtures/` that represent queue-empty states with known candidate mixes and expected ordering.
- [x] **TP004**: Add/extend `tests/tools/taskpad-auto-ideation.test.ts` to assert exact top-3 order + score/tie-break metadata for snapshot fixtures.
- [x] **TP005**: Add a scriptable ranking-drift verification command (via existing test target or a dedicated script entry) and wire it in `package.json`.
- [x] **TP006**: Update `docs/quality/taskpad-auto-ideation-report.md` with ranking drift verification evidence and snapshot update protocol.

### Acceptance Criteria
- Ranking output for identical fixtures is deterministic and explicitly asserted via snapshot/ordering tests.
- Any ranking heuristic change that alters candidate order fails verification with actionable diff output.
- Engineers can intentionally update snapshots with a documented workflow when ranking behavior is deliberately revised.
- Intake auto-ideation verification command suite includes ranking drift coverage.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-auto-ideation.test.ts
bun run taskpad:auto-ideation -- --taskpad tests/tools/fixtures/taskpad-queue-health-empty.md --plan IMPLEMENTATION_PLAN.md
bun run verify:taskpad:intake:auto -- --taskpad tests/tools/fixtures/taskpad-queue-health-empty.md --plan IMPLEMENTATION_PLAN.md
```

---

## TASKPAD Intake Slice (2026-02-28): Semantic dedupe guardrails for AUTO_IDEATION backlog seeding

### Distilled Scope
**Problem**
- Current auto-ideation dedupe canonicalization is mostly lexical (whitespace/date/casing normalization), so near-duplicate backlog phrasing can still bypass dedupe and create churn across repeated loops.
- Queue reseeding reliability is now strong (fallback apply + preflight), but duplicate semantic intent still causes avoidable planning noise.
- We need deterministic, testable guardrails that collapse phrasing variants into one canonical backlog intent before insertion/planning.

**In scope**
- Add deterministic semantic-key normalization for self-improvement backlog bullets in `taskpad:auto-ideation` (phrase canonicalization + synonym/stopword handling with static rules only).
- Enforce semantic dedupe checks against existing unchecked self-improvement bullets before insertion.
- Extend tool tests with near-duplicate fixtures proving deterministic dedupe outcomes.
- Update quality/docs contract for semantic dedupe behavior and verification expectations.

**Out of scope**
- LLM/embedding-based similarity scoring.
- Re-ranking candidate generation heuristics.
- Retroactive rewriting of historical checked backlog lines.

### Ideation Candidates Considered
1. Add semantic dedupe guardrails for auto-ideation/planning bullets to prevent near-duplicate backlog churn across loops. **(selected)**
2. Add deterministic candidate ranking fixture snapshots to detect scoring/tie-break drift.
3. Add active-slice recency weighting hardening so candidate themes always prioritize newest completed slice signals.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tools/taskpad-auto-ideation.ts`
  - `tests/tools/taskpad-auto-ideation.test.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `IMPLEMENTATION_PLAN.md`
  - `README.md`
  - `package.json`
- **Search queries/patterns:**
  - `search "semantic dedupe|dedupe|duplicate|near-duplicate|normalize" tools/taskpad-auto-ideation.ts tests/tools/taskpad-auto-ideation.test.ts docs/quality/taskpad-auto-ideation.md`
  - `search "telemetry|history|queue-health|plan-integrity|auto-ideation outcomes|taskpad-intake" tools tests docs package.json`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "semantic dedupe|dedupe|duplicate|near-duplicate|normalize" tools/taskpad-auto-ideation.ts tests/tools/taskpad-auto-ideation.test.ts docs/quality/taskpad-auto-ideation.md`
  - `search "telemetry|history|queue-health|plan-integrity|auto-ideation outcomes|taskpad-intake" tools tests docs package.json`
  - `select set IMPLEMENTATION_PLAN.md package.json tools/taskpad-auto-ideation.ts tests/tools/taskpad-auto-ideation.test.ts docs/quality/taskpad-auto-ideation.md README.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define semantic dedupe normalization contract in `docs/quality/taskpad-auto-ideation.md` (tokenization, synonym folding, ignored tokens, deterministic ordering).
- [x] **TP002**: Implement canonical semantic key builder in `tools/taskpad-auto-ideation.ts` for unchecked self-improvement bullets using static, repo-local rules.
- [x] **TP003**: Integrate semantic key matching into backlog insertion path so near-duplicate selected candidates resolve to `deduped` instead of inserted.
- [x] **TP004**: Add focused fixture tests in `tests/tools/taskpad-auto-ideation.test.ts` for equivalent-meaning phrasing variants and non-equivalent edge cases.
- [x] **TP005**: Update machine-readable output/documentation notes if needed to expose semantic dedupe rationale without breaking existing contract fields.
- [x] **TP006**: Capture verification evidence update in `docs/quality/taskpad-auto-ideation-report.md` with deterministic pass/fail results.

### Acceptance Criteria
- Near-duplicate self-improvement bullets with equivalent intent dedupe deterministically to one canonical item.
- Distinct intents still insert as new backlog bullets.
- Auto-ideation output semantics remain backward compatible (`seeded|deduped|noop|fallback`).
- Tests cover semantic-equivalent and non-equivalent cases and remain deterministic.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-auto-ideation.test.ts
bun run taskpad:auto-ideation -- --taskpad tests/tools/fixtures/taskpad-queue-health-empty.md --plan IMPLEMENTATION_PLAN.md
bun run verify:taskpad:intake:auto -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md
```

---

## TASKPAD Intake Slice (2026-02-28): Writable-path preflight gate for deterministic TASKPAD mutation routing

### Distilled Scope
**Problem**
- Intake tooling currently discovers write restrictions only after attempting TASKPAD mutations, then pivots to fallback behavior.
- This wastes cycles and creates avoidable noisy failures on read-only vault paths (`EPERM`/`EACCES`/`EROFS`) even when the final behavior is deterministic.
- Existing queue-health, auto-ideation, and fallback-apply flows are strong, but they still lack a shared preflight decision primitive (`writable=true|false`) before mutation attempts.

**In scope**
- Add a reusable preflight probe utility that deterministically classifies a TASKPAD target as writable or non-writable before any write path executes.
- Integrate probe results into `taskpad:auto-ideation` flow routing so direct-write vs fallback-artifact mode is chosen from preflight state rather than first-failure behavior.
- Surface probe result fields in machine-readable output contracts used by intake verification commands.
- Add focused tests and docs updates covering writable fixture path, read-only simulation path, and routing assertions.

**Out of scope**
- Changing candidate ranking heuristics.
- Reworking `taskpad:apply-fallback` artifact schema.
- Broad filesystem permission remediation beyond deterministic preflight classification.

### Ideation Candidates Considered
1. Add deterministic writable-path preflight probe and route intake mutation mode from preflight state. **(selected)**
2. Add semantic dedupe guardrails for near-duplicate self-improvement bullets across repeated loops.
3. Add auto-ideation candidate quality harness that snapshots score/tie-break order for drift detection.

### RepoPrompt Builder Context
- **Entry files (paths):**
  - `tools/taskpad-auto-ideation.ts`
  - `tools/taskpad-apply-fallback.ts`
  - `tests/tools/taskpad-auto-ideation.test.ts`
  - `tests/tools/taskpad-apply-fallback.test.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `README.md`
  - `package.json`
- **Search queries/patterns:**
  - `search "taskpad:auto-ideation|taskpad:apply-fallback|verify:taskpad:intake:auto|writable|EPERM|permission" package.json tools/taskpad-auto-ideation.ts tools/taskpad-apply-fallback.ts tests/tools/taskpad-auto-ideation.test.ts README.md`
  - `search "writable|EPERM|applyHint|artifactPath|taskpadSha256|fallback"`
- **Suggested `rp_exec` sequence:**
  - `tree`
  - `search "taskpad:auto-ideation|taskpad:apply-fallback|verify:taskpad:intake:auto|writable|EPERM|permission" package.json tools/taskpad-auto-ideation.ts tools/taskpad-apply-fallback.ts tests/tools/taskpad-auto-ideation.test.ts README.md`
  - `search "writable|EPERM|applyHint|artifactPath|taskpadSha256|fallback"`
  - `select set IMPLEMENTATION_PLAN.md package.json README.md tools/taskpad-auto-ideation.ts tools/taskpad-apply-fallback.ts tests/tools/taskpad-auto-ideation.test.ts tests/tools/taskpad-apply-fallback.test.ts docs/quality/taskpad-auto-ideation.md docs/quality/taskpad-auto-ideation-report.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define writable-path preflight contract in `docs/quality/taskpad-auto-ideation.md` (inputs, deterministic output schema, error semantics, and allowed permission-class outcomes).
- [x] **TP002**: Implement shared preflight utility (new helper under `tools/`) that probes target path writeability without mutating business content and returns stable `writable=true|false` + reason code.
- [x] **TP003**: Integrate preflight utility into `tools/taskpad-auto-ideation.ts` so write-mode routing is selected before mutation attempts (`direct-write` vs `fallback-artifact`).
- [x] **TP004**: Extend machine-readable CLI output for `taskpad:auto-ideation` with preflight metadata (`preflight.mode`, `preflight.writable`, `preflight.reasonCode`) while preserving backward-compatible fields.
- [x] **TP005**: Add focused tests in `tests/tools/taskpad-auto-ideation.test.ts` for deterministic preflight routing on writable fixture path vs simulated permission-denied path.
- [x] **TP006**: Add focused tests (or adjust existing) in `tests/tools/taskpad-apply-fallback.test.ts` to assert compatibility when preflight routes to fallback mode.
- [x] **TP007**: Update `README.md` + `docs/quality/taskpad-auto-ideation-report.md` with preflight-first intake flow and verification evidence checklist.

### Acceptance Criteria
- A deterministic preflight probe reports writable classification before any TASKPAD mutation path runs.
- `taskpad:auto-ideation` chooses direct-write or fallback-artifact mode from preflight result, not first write failure.
- CLI machine-readable output includes stable preflight metadata for intake automation consumers.
- Focused tests cover writable and read-only routing behavior and remain deterministic.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-auto-ideation.test.ts
bun test tests/tools/taskpad-apply-fallback.test.ts
bun run taskpad:auto-ideation -- --taskpad tests/tools/fixtures/taskpad-queue-health-empty.md --plan IMPLEMENTATION_PLAN.md
bun run taskpad:auto-ideation -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md
```

---

## TASKPAD Intake Slice (2026-02-28): Deterministic `taskpad:apply-fallback` for read-only AUTO_IDEATION artifacts

### Distilled Scope
**Problem**
- `taskpad:auto-ideation` now emits deterministic fallback patch artifacts (`status: "fallback"`, `artifactPath`, `applyHint`) when vault writes fail with permission-denied errors.
- There is no first-class repo command that validates and applies these artifacts in one auditable step, so recovery still depends on ad-hoc/manual patch handling.
- This keeps the `EPERM` intake loop only partially solved: ideation can continue, but deterministic application is not yet automated.

**In scope**
- Add a deterministic CLI tool (`tools/taskpad-apply-fallback.ts`) that reads fallback patch JSON, validates artifact contract (`kind/version`, `taskpadPath`, `taskpadSha256`, `patch.targetPath`), and applies the unified diff insertion safely.
- Add npm script wiring (`taskpad:apply-fallback`) and optionally integrate it into intake docs/flow examples.
- Add focused tests for happy path, hash/path mismatch rejection, malformed artifact rejection, and idempotent re-run behavior.
- Document operational usage and verification in `docs/quality/taskpad-auto-ideation.md` + `README.md`.

**Out of scope**
- Reworking candidate ranking heuristics or queue-health semantics.
- Broad git patch tooling beyond the fallback artifact format already emitted by `taskpad:auto-ideation`.
- Filesystem permission remediation outside deterministic artifact application.

### Ideation Candidates Considered
1. Add deterministic `taskpad:apply-fallback` artifact applier with contract validation + auditable output. **(selected)**
2. Add intake-gate telemetry history for queue-health/plan-integrity/auto-ideation outcomes.
3. Add writable-path preflight probing to choose direct-write vs fallback mode before mutation attempts.

### RepoPrompt Builder Context
- **Entry files (paths)**:
  - `tools/taskpad-auto-ideation.ts`
  - `tests/tools/taskpad-auto-ideation.test.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `docs/quality/taskpad-auto-ideation-report.md`
  - `package.json`
  - `README.md`
  - `IMPLEMENTATION_PLAN.md`
- **Search queries/patterns**:
  - `search "taskpad:auto-ideation|taskpad:apply-fallback|fallback|artifact|EPERM|apply" package.json tools/taskpad-auto-ideation.ts tests/tools/taskpad-auto-ideation.test.ts docs/quality/taskpad-auto-ideation.md README.md`
  - `search "taskpad:apply-fallback|fallback artifact|EPERM|artifactPath|applyHint|writeFileSync"`
  - `search "verify:taskpad:intake:auto|verify:taskpad:intake:full|queue-health|plan:integrity" package.json README.md IMPLEMENTATION_PLAN.md`
- **RepoPrompt evidence highlights**:
  - `package.json` includes `taskpad:auto-ideation` and `verify:taskpad:intake:auto`, but no `taskpad:apply-fallback` command.
  - `tools/taskpad-auto-ideation.ts` already emits fallback artifacts with `taskpadSha256`, `patch`, and `applyHint` contract fields.
  - `tests/tools/taskpad-auto-ideation.test.ts` validates fallback artifact generation but does not cover an artifact-apply command.
- **Suggested `rp_exec` sequence**:
  - `tree`
  - `search "taskpad:apply-fallback|fallback artifact|EPERM|artifactPath|applyHint|writeFileSync"`
  - `select set IMPLEMENTATION_PLAN.md package.json README.md tools/taskpad-auto-ideation.ts docs/quality/taskpad-auto-ideation.md docs/quality/taskpad-auto-ideation-report.md tests/tools/taskpad-auto-ideation.test.ts`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define the `taskpad:apply-fallback` contract in `docs/quality/taskpad-auto-ideation.md` (required JSON fields, validation rules, failure semantics, idempotency expectations).
- [x] **TP002**: Implement artifact parser/validator utilities in `tools/taskpad-apply-fallback.ts` for `kind/version`, required fields, and deterministic error codes/messages.
- [x] **TP003**: Implement pre-apply safety checks: `taskpadPath` existence, `patch.targetPath` alignment, and `taskpadSha256` match against current target file.
- [x] **TP004**: Implement deterministic unified-diff apply logic limited to this artifact format and write updated TASKPAD atomically.
- [x] **TP005**: Emit machine-readable + human summary output (`applied|noop|rejected`) with clear remediation hints for hash/path mismatch and malformed artifacts.
- [x] **TP006**: Add npm script wiring in `package.json` (`taskpad:apply-fallback`) and, if needed, update `verify:taskpad:intake:auto` docs/examples to show fallback recovery sequence.
- [x] **TP007**: Add focused tests (new `tests/tools/taskpad-apply-fallback.test.ts`) for apply success, mismatch rejection, malformed artifact rejection, and idempotent re-run.
- [x] **TP008**: Update `README.md` + `docs/quality/taskpad-auto-ideation-report.md` with deterministic fallback application workflow and verification evidence checklist.

### Acceptance Criteria
- `bun run taskpad:apply-fallback -- --taskpad <path> --artifact <artifact-path>` applies a valid fallback artifact deterministically and updates TASKPAD exactly once.
- Command rejects stale or tampered artifacts via path/hash/shape validation with actionable diagnostics and non-zero exit.
- Re-running against already-applied artifact is deterministic (explicit `noop`/safe rejection semantics documented and tested).
- Docs and scripts clearly show the end-to-end read-only recovery flow without manual patch editing.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-auto-ideation.test.ts
bun test tests/tools/taskpad-apply-fallback.test.ts
bun run taskpad:auto-ideation -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md
bun run taskpad:apply-fallback -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --artifact "<artifact-path>"
```

---

## TASKPAD Intake Slice (2026-02-28): Read-only-safe AUTO_IDEATION fallback for TASKPAD write-restricted environments

### Distilled Scope
**Problem**
- Current `taskpad:auto-ideation` flow assumes direct write access to the vault TASKPAD path.
- Latest verification report shows deterministic `EPERM` failures when writing to `/Users/t3rpz/Documents/Obsidian Vault/.../TASKPAD.md`, which blocks end-to-end intake automation despite passing type/tests.
- When this happens, autonomous loops lose momentum because candidate generation exists, but there is no fallback artifact for downstream planning/apply steps.

**In scope**
- Add a read-only-safe fallback path in `tools/taskpad-auto-ideation.ts` that preserves deterministic candidate ranking and selection when direct TASKPAD writes fail.
- Emit a deterministic patch artifact (or equivalent machine-applicable delta) plus machine-readable metadata so orchestrator/Engineer can apply changes in a writable step.
- Add focused tests for write-failure fallback behavior and keep current no-op/dedupe semantics unchanged.
- Document fallback behavior and usage in `docs/quality/taskpad-auto-ideation.md` + `README.md`.

**Out of scope**
- Reworking queue-health or plan-integrity gate logic.
- Adding LLM-based ideation or non-deterministic ranking heuristics.
- Auto-applying filesystem permission fixes outside this repo.

### Ideation Candidates Considered
1. Add read-only-safe auto-ideation fallback with deterministic patch artifact emission on TASKPAD write failure. **(selected)**
2. Add quality-evidence freshness gate that fails when report artifacts exceed configured max age.
3. Add semantic duplicate detector for planned `Self-Improvement Backlog` bullets prior to marking `planned-YYYY-MM-DD`.

### RepoPrompt Builder Context
- **Entry files (paths)**:
  - `IMPLEMENTATION_PLAN.md`
  - `tools/taskpad-auto-ideation.ts`
  - `docs/quality/taskpad-auto-ideation.md`
  - `docs/quality/taskpad-auto-ideation-report.md`
  - `package.json`
  - `README.md`
- **Search queries/patterns**:
  - `search "taskpad:auto-ideation|verify:taskpad:intake:auto|taskpad-queue-health|plan:integrity" package.json README.md IMPLEMENTATION_PLAN.md docs/quality/taskpad-auto-ideation-report.md docs/quality/taskpad-auto-ideation.md`
  - `search "EPERM|operation not permitted|writable|write" docs/quality/taskpad-auto-ideation-report.md tools/taskpad-auto-ideation.ts`
- **Risks/edge cases to inspect**:
  - Fallback mode accidentally mutating TASKPAD while reporting read-only recovery.
  - Patch artifact drift (non-deterministic formatting, unstable line endings/date stamping).
  - CLI output contract regressions for existing consumers expecting `seeded|deduped|noop` statuses.
- **Suggested `rp_exec` sequence**:
  - `tree`
  - `search "taskpad:auto-ideation|verify:taskpad:intake:auto|taskpad-queue-health|plan:integrity" package.json README.md IMPLEMENTATION_PLAN.md docs/quality/taskpad-auto-ideation-report.md docs/quality/taskpad-auto-ideation.md`
  - `search "EPERM|operation not permitted|writable|write" docs/quality/taskpad-auto-ideation-report.md tools/taskpad-auto-ideation.ts`
  - `select set IMPLEMENTATION_PLAN.md package.json tools/taskpad-auto-ideation.ts docs/quality/taskpad-auto-ideation.md docs/quality/taskpad-auto-ideation-report.md README.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define fallback contract in `docs/quality/taskpad-auto-ideation.md` (trigger condition: write failure, patch artifact schema/location, status semantics).
- [x] **TP002**: Extend `tools/taskpad-auto-ideation.ts` to catch write failures (`EPERM`/permission-denied class) after candidate selection and switch to deterministic fallback mode.
- [x] **TP003**: Implement deterministic patch/delta artifact generation for `## Self-Improvement Backlog` insertion (stable date formatting + newline handling).
- [x] **TP004**: Extend machine-readable CLI output with fallback metadata (`status`, `selectedOutcome`, `artifactPath`, `applyHint`) while preserving backward compatibility.
- [x] **TP005**: Add focused tests in `tests/tools/taskpad-auto-ideation.test.ts` for permission failure fallback, artifact determinism, and unchanged behavior in writable/no-op/dedupe scenarios.
- [x] **TP006**: Document fallback usage in `README.md` and add verification evidence note update in `docs/quality/taskpad-auto-ideation-report.md`.

### Acceptance Criteria
- `taskpad:auto-ideation` no longer hard-fails autonomous intake on TASKPAD write-permission errors; it emits deterministic fallback output.
- Fallback output includes enough data/artifact to apply exactly one selected backlog insertion without ambiguity.
- Existing no-op/dedupe behavior remains deterministic and covered by tests.
- Documentation explains when fallback occurs and how to apply generated artifact output.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-auto-ideation.test.ts
bun run taskpad:auto-ideation -- --taskpad tests/tools/fixtures/taskpad-queue-health-empty.md --plan IMPLEMENTATION_PLAN.md
bun run taskpad:auto-ideation -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md
```

---

## TASKPAD Intake Slice (2026-02-28): AUTO_IDEATION queue seeder for empty TASKPAD intake loops

### Distilled Scope
**Problem**
- The intake gates now correctly fail when both execution queues are empty, but they only emit guidance and still depend on a human/Engineer to manually seed the next backlog item.
- Autonomous intake loops can repeatedly stall at the same failure point (`queue health: FAIL`) despite having rich recent implementation history that could be mined for the next highest-impact improvement.
- There is no deterministic repo-side tool that turns current TASKPAD + IMPLEMENTATION_PLAN state into ranked candidate improvements and seeds one queue item automatically.

**In scope**
- Add one deterministic auto-ideation tool that reads TASKPAD + IMPLEMENTATION_PLAN and generates exactly 3 candidate self-improvements when both queues are empty.
- Rank candidates via explicit heuristics (intake-gate failures, most recent completed slice themes, unresolved quality risks) and select one best next action.
- Append one canonical unchecked bullet under `## Self-Improvement Backlog` for the selected candidate (dedupe-aware), then emit machine-readable output for orchestrator/Engineer handoff.
- Wire script/docs/tests so this can run before or alongside `verify:taskpad:intake:full` when empty-queue failure is detected.

**Out of scope**
- Full LLM-based freeform roadmap generation.
- Auto-planning full TP task graphs (Engineer still owns planning slice authoring).
- Modifying queue items when either execution queue already has unchecked work.

### Ideation Candidates Considered
1. Add deterministic `taskpad:auto-ideation` that generates 3 candidates from local project state and seeds one canonical backlog bullet when queues are empty. **(selected)**
2. Add stale-quality-evidence checker that fails when `SEEDFINDER_QUALITY_REPORT.md` timestamps drift past a configured age.
3. Add TASKPAD semantic-dedupe guard that flags near-duplicate backlog bullets before they are marked planned.

### RepoPrompt Builder Context
- **Entry files (paths)**:
  - `IMPLEMENTATION_PLAN.md`
  - `package.json`
  - `README.md`
  - `tools/taskpad-queue-health.ts`
  - `tools/implementation-plan-integrity.ts`
  - `tests/tools/taskpad-queue-health.test.ts`
  - `tests/tools/implementation-plan-integrity.test.ts`
  - `docs/quality/taskpad-queue-health.md`
  - `docs/quality/implementation-plan-integrity.md`
- **Search queries/patterns**:
  - `search "verify:taskpad:intake:full|taskpad:queue-health|plan:integrity|AUTO_IDEATION|Self-Improvement Backlog|Autonomous Kickoff Queue" package.json tools README.md IMPLEMENTATION_PLAN.md tests/tools`
  - `search "Self-Improvement Backlog|Autonomous Kickoff Queue|planned-|Engineer Intake|READY|queue" tools/taskpad-queue-health.ts tests/tools/taskpad-queue-health.test.ts`
  - `search "TASKPAD Intake Slice|required headings|Verification Commands|TP\d\d\d|active slice" tools/implementation-plan-integrity.ts tests/tools/implementation-plan-integrity.test.ts docs/quality/implementation-plan-integrity.md`
- **Risks/edge cases to inspect**:
  - Non-deterministic candidate ordering causing flaky autonomous behavior.
  - Duplicate seed bullets when ideation re-runs on unchanged files.
  - False-positive “empty queue” detection when checkboxes appear in unrelated TASKPAD sections.
  - Candidate quality regressions if parsing only old archived slices instead of active top slices.
- **Suggested `rp_exec` sequence**:
  - `tree`
  - `search "verify:taskpad:intake:full|taskpad:queue-health|plan:integrity|AUTO_IDEATION|Self-Improvement Backlog|Autonomous Kickoff Queue" package.json tools README.md IMPLEMENTATION_PLAN.md tests/tools`
  - `search "Self-Improvement Backlog|Autonomous Kickoff Queue|planned-|Engineer Intake|READY|queue" tools/taskpad-queue-health.ts tests/tools/taskpad-queue-health.test.ts`
  - `search "TASKPAD Intake Slice|required headings|Verification Commands|TP\d\d\d|active slice" tools/implementation-plan-integrity.ts tests/tools/implementation-plan-integrity.test.ts docs/quality/implementation-plan-integrity.md`
  - `select set IMPLEMENTATION_PLAN.md package.json README.md tools/taskpad-queue-health.ts tools/implementation-plan-integrity.ts tests/tools/taskpad-queue-health.test.ts tests/tools/implementation-plan-integrity.test.ts docs/quality/taskpad-queue-health.md docs/quality/implementation-plan-integrity.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define deterministic auto-ideation contract in `docs/quality/taskpad-auto-ideation.md` (trigger condition, 3-candidate requirement, ranking inputs, dedupe rule, output schema).
- [x] **TP002**: Implement `tools/taskpad-auto-ideation.ts` parser utilities for TASKPAD queues + active intake status reuse (compatible with existing queue-health semantics).
- [x] **TP003**: Implement candidate synthesis from recent `IMPLEMENTATION_PLAN.md` slices + queue-health/intake signals and produce exactly 3 ranked candidate bullets.
- [x] **TP004**: Implement best-candidate selection + canonical backlog insertion under `## Self-Improvement Backlog` as unchecked bullet, with duplicate suppression.
- [x] **TP005**: Add CLI output contract (human summary + machine-readable JSON block) for orchestrator/Engineer consumption.
- [x] **TP006**: Add focused tests (`tests/tools/taskpad-auto-ideation.test.ts`) for: empty-queue seed pass, non-empty no-op, deterministic ranking order, and dedupe behavior.
- [x] **TP007**: Wire npm scripts in `package.json` (`taskpad:auto-ideation`, optional `verify:taskpad:intake:auto`) and document decision flow in `README.md`.
- [x] **TP008**: Run verification commands and capture concise evidence in a new quality note (`docs/quality/taskpad-auto-ideation-report.md`).

### Acceptance Criteria
- When both queue sections are empty, running auto-ideation generates 3 ranked candidates and appends exactly one deduped unchecked backlog bullet under `## Self-Improvement Backlog`.
- When either queue already has unchecked work, auto-ideation exits no-op and does not modify TASKPAD.
- Candidate selection is deterministic for identical input files.
- Script/tests/docs are wired so autonomous loops can recover from empty-queue failure without manual ideation.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-auto-ideation.test.ts
bun run taskpad:auto-ideation -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md
bun run verify:taskpad:intake:auto -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md
```

---

## TASKPAD Intake Slice (2026-02-27): IMPLEMENTATION_PLAN integrity gate for deterministic Builder handoff

### Distilled Scope
**Problem**
- TASKPAD queue-health now prevents empty-queue stalls, but intake quality can still drift when newly added plan slices miss required sections, contain malformed TP numbering, or omit runnable verification commands.
- Builder depends on predictable plan structure; when plan hygiene drifts, execution loops waste cycles on clarification instead of implementation.
- There is no deterministic pre-dispatch check that validates plan-slice contract quality before work is handed to Builder.

**In scope**
- Add one repository-side plan-integrity checker for `IMPLEMENTATION_PLAN.md` that validates required section presence for the newest TASKPAD intake slice.
- Validate TP task formatting and ordering (`- [ ] **TP###**:` ascending without duplicates) for the active slice.
- Validate that the active slice includes a non-empty `### Verification Commands` block with runnable command lines.
- Wire checker into scripts/docs so intake can run queue-health + plan-integrity gates together.

**Out of scope**
- Auto-rewriting malformed plan slices.
- Validating historical archived slices.
- Changes to Builder runtime beyond consuming the gate output.

### Ideation Candidates Considered
1. Add an `IMPLEMENTATION_PLAN` integrity checker for required sections, TP ID ordering, and verification command presence. **(selected)**
2. Add a distribution artifact freshness checker that fails when quality evidence timestamps are stale.
3. Add a TASKPAD backlog dedupe assistant that flags semantically duplicate self-improvement bullets before planning.

### RepoPrompt Builder Context
- **Entry files (paths)**:
  - `IMPLEMENTATION_PLAN.md`
  - `AGENTS.md`
  - `README.md`
  - `TEST_REQUIREMENTS.md`
  - `package.json`
  - `tools/taskpad-queue-health.ts`
  - `tests/tools/taskpad-queue-health.test.ts`
- **Search queries/patterns**:
  - `search "taskpad|queue-health|planned-YYYY-MM-DD|Self-Improvement Backlog" IMPLEMENTATION_PLAN.md AGENTS.md README.md tests/tools/taskpad-queue-health.test.ts tools/taskpad-queue-health.ts`
  - `search "verify:taskpad:intake|taskpad:queue-health|headless|test:seedfinder|quality gate|RELEASE_CHECKLIST" package.json README.md TEST_REQUIREMENTS.md docs/quality/taskpad-queue-health.md`
- **Risks/edge cases to inspect**:
  - False positives when legacy slices use alternate heading capitalization or spacing.
  - TP numbering validation that fails on completed slices vs active-slice-only intent.
  - Verification block parsing drift when fenced code blocks include comments/blank lines.
  - Gate usability risk if failures are not actionable enough for autonomous retry.
- **Suggested `rp_exec` sequence**:
  - `tree`
  - `search "taskpad|queue-health|planned-YYYY-MM-DD|Self-Improvement Backlog" IMPLEMENTATION_PLAN.md AGENTS.md README.md tests/tools/taskpad-queue-health.test.ts tools/taskpad-queue-health.ts`
  - `search "verify:taskpad:intake|taskpad:queue-health|headless|test:seedfinder|quality gate|RELEASE_CHECKLIST" package.json README.md TEST_REQUIREMENTS.md docs/quality/taskpad-queue-health.md`
  - `select set IMPLEMENTATION_PLAN.md AGENTS.md README.md package.json tools/taskpad-queue-health.ts tests/tools/taskpad-queue-health.test.ts TEST_REQUIREMENTS.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define the active-slice plan-integrity contract in `docs/quality/implementation-plan-integrity.md` (required headings, TP format/order rule, verification block rule, exit semantics).
- [x] **TP002**: Implement `tools/implementation-plan-integrity.ts` to parse `IMPLEMENTATION_PLAN.md`, isolate the newest `## TASKPAD Intake Slice ...` block, and validate required section presence.
- [x] **TP003**: Add TP task-line validator enforcing `- [ ] **TP###**:` format plus strictly ascending unique IDs inside the active slice.
- [x] **TP004**: Add verification-block validator requiring a non-empty fenced bash block under `### Verification Commands` with at least one runnable command line.
- [x] **TP005**: Emit actionable pass/fail output (including failing rule IDs + remediation hints) and non-zero exit code on integrity failure.
- [x] **TP006**: Add focused tests (`tests/tools/implementation-plan-integrity.test.ts`) with fixtures for pass, missing-section fail, TP-order fail, and empty-verification fail cases.
- [x] **TP007**: Wire npm scripts in `package.json` (`plan:integrity`, `verify:taskpad:intake:full`) combining queue-health + plan-integrity checks.
- [x] **TP008**: Update `README.md` and/or `TEST_REQUIREMENTS.md` with intake gate usage examples and run final verification evidence capture.

### Acceptance Criteria
- Running plan-integrity check against a valid active slice exits 0 and reports pass.
- Missing required headings, malformed TP IDs/order, or empty verification commands in the active slice deterministically fail with actionable diagnostics.
- Automated tests cover positive path and core failure modes.
- Intake docs/scripts expose a single command that runs both queue-health and plan-integrity gates.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/implementation-plan-integrity.test.ts
bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md
bun run verify:taskpad:intake:full -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md
```

### TP008 Final Verification Evidence (2026-02-28)
- `bun run typecheck` → **PASS**
- `bun test tests/tools/implementation-plan-integrity.test.ts` → **PASS** (4 passed, 0 failed)
- `bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md` → **PASS** (active-slice integrity rules validated)
- `bun run verify:taskpad:intake:full -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md` → **EXPECTED FAIL (gate active)** due to empty intake queues (`autonomousUncheckedCount: 0`, `selfImprovementUncheckedCount: 0`) with canonical seed guidance emitted.
- Reusable full-gate sanity check:
  - `bun run verify:taskpad:intake:full -- --taskpad tests/tools/fixtures/taskpad-queue-health-pass.md --plan IMPLEMENTATION_PLAN.md` → **PASS**

---

## TASKPAD Intake Slice (2026-02-27): TASKPAD queue-health guard (prevent empty-backlog intake stalls)

### Distilled Scope
**Problem**
- Current TASKPAD state can reach `READY` while both `Self-Improvement Backlog` and `Autonomous Kickoff Queue` have no unchecked items, which stalls orchestrator intake loops.
- There is no deterministic repository-side guard that detects this condition and provides a machine-readable failure reason + next-action guidance.
- Manual ideation recovery works, but it is reactive and fragile under repeated autonomous loops.

**In scope**
- Add one deterministic queue-health checker for TASKPAD markdown that validates at least one unchecked item exists across the two execution queues.
- Emit a clear pass/fail status and actionable guidance (including suggested seed format) when both queues are empty.
- Wire checker into npm scripts + docs so Builder/Tester can run it as a pre-intake gate.

**Out of scope**
- Full autonomous ideation generation logic in this slice.
- Modifying orchestrator runtime behavior beyond invoking the checker.
- Rewriting broader TASKPAD structure outside queue-health checks.

### Ideation Candidates Considered
1. Add TASKPAD queue-health checker + pre-intake guard script that blocks empty-queue stalls and prints seed guidance. **(selected)**
2. Add IMPLEMENTATION_PLAN archival automation that trims completed slices to a rolling window.
3. Add distribution/quality artifact freshness linter that fails when evidence timestamps go stale.

### RepoPrompt Builder Context
- **Entry files (paths)**:
  - `AGENTS.md`
  - `IMPLEMENTATION_PLAN.md`
  - `README.md`
  - `package.json`
- **Search queries/patterns**:
  - `search "TASKPAD|first unchecked|top active TASKPAD intake slice" AGENTS.md IMPLEMENTATION_PLAN.md`
  - `search "test:quality:headless|typecheck|scripts" package.json README.md TEST_REQUIREMENTS.md`
- **Risks/edge cases to inspect**:
  - Markdown checkbox parsing drift when bullets include nested notes/annotations.
  - False positives from unchecked items outside the two target queue sections.
  - Broken path handling when TASKPAD file is passed via absolute vault path.
- **Suggested `rp_exec` sequence**:
  - `tree`
  - `search "TASKPAD|first unchecked|top active TASKPAD intake slice" AGENTS.md IMPLEMENTATION_PLAN.md`
  - `select set IMPLEMENTATION_PLAN.md AGENTS.md README.md package.json`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define parser contract for the two queue sections (`## Autonomous Kickoff Queue` + `## Self-Improvement Backlog`) and expected fail/pass semantics in a short spec note (inline in new tool or `docs/quality/taskpad-queue-health.md`).
- [x] **TP002**: Implement `tools/taskpad-queue-health.ts` to read TASKPAD markdown (path arg), detect unchecked bullets in target sections, and return non-zero exit code when both are empty.
- [x] **TP003**: Add actionable fail output including one canonical seed bullet template and explicit mention of `planned-YYYY-MM-DD` lifecycle.
- [x] **TP004**: Add focused tests (e.g., `tests/tools/taskpad-queue-health.test.ts`) covering pass (one unchecked in either queue), fail (both empty), and section-order/whitespace edge cases.
- [x] **TP005**: Wire npm scripts in `package.json` (`taskpad:queue-health` and optional `verify:taskpad:intake`) and document usage in `README.md` or `TEST_REQUIREMENTS.md`.
- [x] **TP006**: Run final verification and capture concise evidence in plan notes so future intake runs can reuse the gate.

### Acceptance Criteria
- Queue-health command deterministically passes when at least one unchecked queue item exists in either target section.
- Queue-health command deterministically fails when both queues have zero unchecked items and prints actionable seed guidance.
- Tests cover markdown parsing edge cases and prevent regressions.
- Script is callable via npm and documented for orchestrator/Builder use.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-queue-health.test.ts
bun run taskpad:queue-health -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md"
```

### TP006 Final Verification Evidence (2026-02-27)
- `bun run typecheck` → **PASS**
- `bun test tests/tools/taskpad-queue-health.test.ts` → **PASS** (5 passed, 0 failed)
- `bun run taskpad:queue-health -- --taskpad "/Users/t3rpz/Documents/Obsidian Vault/8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md"` → **EXPECTED FAIL (gate active)** with `autonomousUncheckedCount: 0`, `selfImprovementUncheckedCount: 0`, and canonical seed guidance emitted.
- Reusable gate sanity checks:
  - `bun run taskpad:queue-health -- --taskpad tests/tools/fixtures/taskpad-queue-health-pass.md` → **PASS**
  - `bun run taskpad:queue-health -- --taskpad tests/tools/fixtures/taskpad-queue-health-empty.md` → **EXPECTED FAIL**

---

## TASKPAD Intake Slice (2026-02-27): Headless test-vault regression harness for agent clip workflows

### Distilled Scope
**Problem**
- TASKPAD calls out a missing “test vault with headless browsing” path, but current verification is split across unit suites and manual acceptance notes.
- There is no single deterministic harness that proves end-to-end clip behavior (web extraction, SeedFinder profile/frontmatter integrity, and CLI save handoff) in one reproducible run.
- `TEST_REQUIREMENTS.md` still references pre-infra language, creating drift between current quality gates and what Builder/Tester should trust.

**In scope**
- Define one reproducible headless harness slice that exercises representative clip flows against fixtures/URLs and writes deterministic assertions for markdown/frontmatter/save outcomes.
- Cover at least three critical paths: generic web clip, SeedFinder strain profile clip integrity, and CLI save path contract (with safe test doubles).
- Add explicit scripts + docs so the harness is runnable by agents in one command and referenced in quality planning artifacts.

**Out of scope**
- New product features/templates unrelated to verification harness infrastructure.
- Full browser-extension UI automation (popup/options click-through) beyond this CLI/headless workflow slice.
- Monetization/distribution artifact changes unless needed to consume harness outputs.

### Ideation Candidates Considered
1. Add a headless test-vault harness for representative clip flows and artifact assertions. **(selected)**
2. Add a CI workflow gate that blocks merges without SeedFinder + distribution artifact consistency checks.
3. Build a pilot-feedback metrics normalizer that turns `pilot-response-log.md` into trend summaries for monetization loops.

### RepoPrompt Builder Context
- **Entry files (paths)**:
  - `tools/clip-url.ts`
  - `tools/lib/clipper-core.ts`
  - `src/shared/obsidianCliSave.ts`
  - `tests/tools/clip-url.test.ts`
  - `tests/tools/clipper-core.test.ts`
  - `tests/cli-save.test.ts`
  - `TEST_REQUIREMENTS.md`
  - `package.json`
- **Search queries/patterns**:
  - `search "saveViaCli|obsidianCliSave|--cli|vault|folder" tools/clip-url.ts src/shared/obsidianCliSave.ts tests`
  - `search "manual acceptance tests|headless|test infra" TEST_REQUIREMENTS.md README.md IMPLEMENTATION_PLAN.md`
  - `search "test:seedfinder|test:seedfinder:smoke|ci:full|quality" package.json README.md TEST_REQUIREMENTS.md`
- **Risks/edge cases to inspect**:
  - Harness flakiness from network dependence (must prefer deterministic fixtures/local HTML where possible).
  - False-positive CLI save checks that don’t verify command payload/file path semantics.
  - SeedFinder integrity checks asserting only presence, not normalized schema/frontmatter correctness.
  - Documentation drift if new harness scripts are added but `TEST_REQUIREMENTS.md` remains stale.
- **Suggested `rp_exec` sequence**:
  - `tree`
  - `search "saveViaCli|obsidianCliSave|--cli|vault|folder" tools/clip-url.ts src/shared/obsidianCliSave.ts tests`
  - `search "manual acceptance tests|headless|test infra" TEST_REQUIREMENTS.md README.md IMPLEMENTATION_PLAN.md`
  - `select set IMPLEMENTATION_PLAN.md TEST_REQUIREMENTS.md README.md package.json tools/clip-url.ts tools/lib/clipper-core.ts tests/tools/clip-url.test.ts tests/tools/clipper-core.test.ts`
  - `select add src/shared/obsidianCliSave.ts tests/cli-save.test.ts`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Define the harness scope contract in-repo (target flows, required assertions, fixture/URL sources, deterministic execution constraints) and store it in a new quality doc (`docs/quality/headless-harness-spec.md`).
- [x] **TP002**: Add reusable test-vault sandbox helpers (temp vault root creation, cleanup, deterministic timestamp/title controls) for headless clipping tests.
- [x] **TP003**: Add a focused headless harness test entrypoint (e.g., `tests/e2e/headless-clip-harness.test.ts`) wired to shared helpers and existing clip tooling.
- [x] **TP004**: Implement harness scenario #1 (generic web clip) asserting output success, markdown body presence, and stable frontmatter keys.
- [x] **TP005**: Implement harness scenario #2 (SeedFinder clip) asserting normalized profile fields survive extraction → markdown → frontmatter expectations.
- [x] **TP006**: Implement harness scenario #3 (CLI save path contract) using safe process mocking to assert `saveViaCli` invocation payloads (vault/folder/file path/content) without touching a real vault.
- [x] **TP007**: Add/standardize runnable scripts in `package.json` (e.g., `test:e2e:headless`) and ensure they compose with existing quality gates.
- [x] **TP008**: Update `TEST_REQUIREMENTS.md` + `README.md` so automated vs manual gates reflect the new harness and remove outdated “once test infra exists” language.
- [x] **TP009**: Run final verification pass and emit a compact run artifact (`docs/quality/headless-harness-report.md`) summarizing command outputs and pass/fail verdict.

### Acceptance Criteria
- A single command executes a deterministic headless harness covering web clip, SeedFinder integrity, and CLI save contract scenarios.
- Harness assertions validate meaningful data quality (normalized SeedFinder/frontmatter fields), not just command success.
- Documentation clearly maps required automated checks to actual runnable scripts with no stale pre-infra notes.
- A timestamped harness report artifact exists for auditability and future intake reference.

### Verification Commands
```bash
bun run typecheck
bun test tests/e2e/headless-clip-harness.test.ts
bun run test:seedfinder
bun run test:seedfinder:smoke
bun run test:e2e:headless
```

---

## TASKPAD Intake Slice (2026-02-27): First pilot distribution run (demo artifact + 3-user outreach + response log)

### Distilled Scope
**Problem**
- `OFFER_BRIEF.md` now marks distribution as `ready`, but there is no execution-ready distribution packet/run log that proves outreach actually happened with the agreed CTA and quality gate evidence.
- Without a reproducible first outreach slice, the team cannot measure pilot conversion signals (`PILOT YES`, price signal, workflow fit) or iterate the monetization loop.

**In scope**
- Package one demo artifact for pilot sharing with clear provenance (source clip + quality gate timestamp + usage context).
- Create/send one standardized outreach message to exactly 3 qualified pilot users based on the existing CTA in `OFFER_BRIEF.md`.
- Capture all outreach attempts + responses in a structured, auditable log artifact in-repo.
- Add validation tasks that confirm quality gate freshness, payload consistency, and response-log completeness.

**Out of scope**
- Broad public launch, pricing page/checkout setup, or marketing funnel automation.
- Expanding beyond 3 pilot recipients in this slice.
- New extraction feature work unrelated to distribution execution artifacts.

### RepoPrompt Builder Context
- **Entry files (paths)**:
  - `IMPLEMENTATION_PLAN.md`
  - `OFFER_BRIEF.md`
  - `SEEDFINDER_QUALITY_REPORT.md`
  - `SEEDFINDER_COMMAND_CONTRACT.md`
  - `README.md`
  - `package.json`
- **Search queries/patterns**:
  - `search "distribution|pilot|ready|blocked|PILOT YES|quality gate before distribution" OFFER_BRIEF.md IMPLEMENTATION_PLAN.md`
  - `search "seedfinder-demo-clip|demo artifact|pilot response|distribution log|outreach" README.md IMPLEMENTATION_PLAN.md OFFER_BRIEF.md`
  - `search "OFFER_BRIEF|RELEASE_CHECKLIST|SEEDFINDER_QUALITY_REPORT|seedfinder-demo-clip|pilot users|distribution"`
- **Risks/edge cases to inspect**:
  - Distribution copy drifting from the exact CTA/anti-goals committed in `OFFER_BRIEF.md`.
  - Sending outreach without fresh quality gate evidence in the same distribution window.
  - Incomplete response logging (missing no-response states, missing WTP signals, or mixed formats).
  - Demo artifact lacking reproducibility metadata (source URL/template/commit/timestamp).
- **Suggested `rp_exec` sequence**:
  - `tree`
  - `search "distribution|pilot|ready|blocked|PILOT YES|quality gate before distribution" OFFER_BRIEF.md IMPLEMENTATION_PLAN.md`
  - `search "seedfinder-demo-clip|demo artifact|pilot response|distribution log|outreach" README.md IMPLEMENTATION_PLAN.md OFFER_BRIEF.md`
  - `select set IMPLEMENTATION_PLAN.md OFFER_BRIEF.md SEEDFINDER_QUALITY_REPORT.md SEEDFINDER_COMMAND_CONTRACT.md package.json README.md`
  - `context --files --tree`

### TP001 Canonical Artifact Location + Naming Convention
- **Batch root (canonical)**: `docs/distribution/first-pilot-2026-02/`
- **File naming rule**: lowercase kebab-case markdown files, one artifact per file, fixed names for this 3-user pilot batch to keep links stable across tasks.
- **Required artifacts in this slice**:
  - **Demo clip artifact**: `docs/distribution/first-pilot-2026-02/seedfinder-demo-clip.md`
  - **Outreach message template**: `docs/distribution/first-pilot-2026-02/pilot-outreach-message.md`
  - **Pilot response log**: `docs/distribution/first-pilot-2026-02/pilot-response-log.md`
- **Related batch tracking artifacts (same root)**:
  - `docs/distribution/first-pilot-2026-02/pilot-run-sheet.md`
  - `docs/distribution/first-pilot-2026-02/pilot-batch-summary.md`

### Task Graph
- [x] **TP001**: Define the canonical location and naming convention for distribution artifacts (demo clip, outreach message, pilot log) and document it in-plan.
- [x] **TP002**: Re-validate distribution gate freshness by rerunning `typecheck`, `test:seedfinder`, and `test:seedfinder:smoke`; capture timestamp/branch/commit for this outreach window.
- [x] **TP003**: Create a demo artifact scaffold (markdown note) with required metadata fields: source URL, clip timestamp, template used, and quality-gate evidence reference. _(depends: TP001, TP002)_
- [x] **TP004**: Generate/update one demo clip artifact using the current SeedFinder-capable flow and confirm it matches promised output quality (clean markdown + frontmatter signal visibility). _(depends: TP003)_
- [x] **TP005**: Add a concise “How to review this demo artifact” section so pilots know what to inspect in under 2 minutes. _(depends: TP004)_
- [x] **TP006**: Draft a single outreach message template that exactly reuses `OFFER_BRIEF.md` CTA language (`PILOT YES ...`) and preserves anti-goals/no-overpromise guardrails.
- [x] **TP007**: Define pilot-user selection criteria for this batch (fit checklist + exclusion criteria) and record why each of the 3 recipients qualifies. _(depends: TP006)_
- [x] **TP008**: Create a distribution run sheet for this batch containing recipient handle/channel, send status, sent timestamp, and artifact link. _(depends: TP001, TP007)_
- [x] **TP009**: Send outreach message + demo artifact to pilot user #1 and record outcome in the run sheet/log. _(depends: TP008)_
- [x] **TP010**: Send outreach message + demo artifact to pilot user #2 and record outcome in the run sheet/log. _(depends: TP008)_
- [x] **TP011**: Send outreach message + demo artifact to pilot user #3 and record outcome in the run sheet/log. _(depends: TP008)_
- [x] **TP012**: Create/maintain a pilot response log using the existing rubric (workflow sentence, objection type, WTP, next-step decision) for each recipient, including explicit `no response yet` states. _(depends: TP009, TP010, TP011)_
- [x] **TP013**: Run a consistency QA pass: outreach copy vs `OFFER_BRIEF.md` CTA, recipient count exactly 3, and all send timestamps present. _(depends: TP012)_
- [x] **TP014**: Run a response-data QA pass: every recipient has one structured log entry with decision state (`advance|nurture|disqualify|pending`) and rationale. _(depends: TP012)_
- [x] **TP015**: Produce a one-page batch summary (sent count, reply count, `PILOT YES` count, WTP signal spread, top objections, next recommended action) and link all underlying artifacts. _(depends: TP013, TP014)_
- [x] **TP016**: Final smoke/E2E validation: prove the full chain from quality gate evidence → demo artifact → 3 sends → structured logging is complete and auditable; mark slice ready for next monetization iteration. _(depends: TP015)_

### TP002 Freshness Evidence (Current Outreach Window)
- **Run context**: branch `gatekeeper-test`, commit `49293b1`
- `2026-02-27 13:40:40 EST` — `bun run typecheck` — **PASS**
- `2026-02-27 13:40:44 EST` — `bun run test:seedfinder` — **PASS**
- `2026-02-27 13:40:47 EST` — `bun run test:seedfinder:smoke` — **PASS**

### TP016 Final Smoke / E2E Evidence
- Validation artifact: `docs/distribution/first-pilot-2026-02/pilot-final-e2e-validation.md`
- Verdict: **PASS** (full chain auditable: quality gate evidence → demo artifact → 3 sends → structured response log)
- Slice status: **ready for next monetization iteration**

### Acceptance Criteria
- Distribution artifacts exist in canonical repo locations and include reproducibility metadata.
- Exactly 3 qualified pilot users receive the standardized outreach payload with demo artifact.
- A structured response log exists for all 3 recipients, including pending/non-response states.
- Batch summary reports conversion signals (`PILOT YES`, WTP, objections) and a clear next step.
- Final validation confirms end-to-end traceability from quality gate evidence to outreach and logging.

### Verification Commands
```bash
bun run typecheck
bun run test:seedfinder
bun run test:seedfinder:smoke
test -f OFFER_BRIEF.md
grep -n "^## Distribution Readiness Verdict\|PILOT YES\|Quality Gate Before Distribution" OFFER_BRIEF.md
find . -maxdepth 3 -type f | grep -E "(pilot|distribution|demo|artifact|outreach)" || true
```

---

## TASKPAD Intake Slice (2026-02-27): OFFER_BRIEF monetization test definition (quality-gated)

### Distilled Scope
**Problem**
- The next monetization queue item requires a concrete `OFFER_BRIEF.md`, but the project currently lacks a single source of truth for target user, value promise, pricing hypothesis, and CTA tied to the current SeedFinder quality baseline.
- Without a quality-gated offer brief, distribution tasks risk messaging a value promise before product stability is explicitly verified.

**In scope**
- Create a first-pass `OFFER_BRIEF.md` aligned to current repo capabilities and quality evidence.
- Define explicit sections for ICP, pain points, value promise, proof points, pricing hypothesis, CTA, and pilot feedback capture.
- Add a release gate in the brief so outreach remains blocked when quality baseline evidence is stale/failed.
- Add focused validation tasks (content completeness + quality-gate command evidence + smoke checklist) before considering the distribution queue item.

**Out of scope**
- Executing pilot outreach/distribution (sending to users, collecting replies).
- Broad product packaging, billing implementation, or landing-page build.
- Reworking SeedFinder extraction logic unless quality-gate verification fails.

### RepoPrompt Builder Context
- **Entry files (paths)**:
  - `IMPLEMENTATION_PLAN.md`
  - `SEEDFINDER_QUALITY_REPORT.md`
  - `SEEDFINDER_COMMAND_CONTRACT.md`
  - `package.json`
  - `README.md`
  - `TEST_REQUIREMENTS.md`
  - `docs/cli-tools.md`
- **Search queries/patterns**:
  - `search "OFFER_BRIEF|monetization|pilot users|distribution"`
  - `search "test:seedfinder:smoke|quality baseline|SEEDFINDER_QUALITY_REPORT|RELEASE_CHECKLIST"`
- **Risks/edge cases to inspect**:
  - Offer claims that exceed currently verified product behavior.
  - CTA ambiguity (unclear ask, no defined pilot response capture path).
  - Pricing hypothesis not tied to a concrete testable segment.
  - Quality baseline drift (report or commands stale relative to current branch).
- **Suggested `rp_exec` sequence**:
  - `tree`
  - `search "OFFER_BRIEF|monetization|pilot users|distribution"`
  - `search "test:seedfinder:smoke|quality baseline|SEEDFINDER_QUALITY_REPORT|RELEASE_CHECKLIST"`
  - `select set IMPLEMENTATION_PLAN.md SEEDFINDER_QUALITY_REPORT.md SEEDFINDER_COMMAND_CONTRACT.md package.json README.md`
  - `select add TEST_REQUIREMENTS.md docs/cli-tools.md`
  - `context`

### Task Graph
- [x] **TP001**: Decide `OFFER_BRIEF.md` location and ownership metadata (author/date/status) and scaffold the file with required top-level headings.
- [x] **TP002**: Extract the current quality gate summary from `SEEDFINDER_QUALITY_REPORT.md` and record a concise “quality baseline status” block in `OFFER_BRIEF.md`.
- [x] **TP003**: Define one primary ICP (pilot user archetype) with job-to-be-done and current workflow pain points tied to clipping + knowledge-base building.
- [x] **TP004**: Draft one tight value promise statement constrained to already-verified capabilities (no speculative claims). _(depends: TP002, TP003)_
- [x] **TP005**: Add proof points/evidence bullets that cite existing repo artifacts (quality report, command contract, test evidence) supporting the value promise. _(depends: TP004)_
- [x] **TP006**: Define initial pricing hypothesis (price point/range, rationale, and what signal would validate or invalidate it).
- [x] **TP007**: Define one clear CTA for pilot outreach (exact ask + response format + success signal) and include anti-goals (what not to promise).
- [x] **TP008**: Add a “quality gate before distribution” checklist to `OFFER_BRIEF.md` requiring fresh pass evidence for `typecheck`, `test:seedfinder`, and `test:seedfinder:smoke`.
- [x] **TP009**: Add a pilot response logging template section (feedback fields, objections, willingness-to-pay, next-step decision rubric).
- [x] **TP010**: Run content QA pass on `OFFER_BRIEF.md` for required-section completeness and contradiction checks versus `SEEDFINDER_QUALITY_REPORT.md`.
- [x] **TP011**: Execute quality baseline verification commands and capture timestamped pass/fail status in `OFFER_BRIEF.md` gate section. _(depends: TP008)_
- [x] **TP012**: Perform final smoke review: confirm brief has target user, value promise, price hypothesis, CTA, and explicit gate verdict; then mark distribution item still blocked/unblocked accordingly. _(depends: TP010, TP011)_

### Acceptance Criteria
- `OFFER_BRIEF.md` exists with explicit sections for target user, value promise, pricing hypothesis, CTA, and pilot feedback capture.
- The brief includes quality-gate requirements and a current gate verdict based on command evidence.
- Claims in the brief are traceable to verified capabilities/artifacts, with no unstated speculative promises.
- Brief ends with a binary distribution readiness note (`blocked` or `ready`) tied to gate results.

### Verification Commands
```bash
bun run typecheck
bun run test:seedfinder
bun run test:seedfinder:smoke
test -f OFFER_BRIEF.md
grep -n "^## \|^### " OFFER_BRIEF.md
```

---

## TASKPAD Intake Slice (2026-02-27): SeedFinder quality regression sweep + gap log

### Distilled Scope
**Problem**
- The next kickoff item requires a focused quality regression sweep and a durable gap log in `SEEDFINDER_QUALITY_REPORT.md`, but the current baseline only defines the matrix/checklist and does not capture a pass/fail run artifact with actionable follow-ups.
- Without a concrete report, "quality baseline stable" remains ambiguous and blocks monetization/distribution tasks.

**In scope**
- Execute the SeedFinder regression command stack (`typecheck`, focused suites, targeted smoke assertions) and capture outcomes in a single report artifact.
- Validate that parser, extractor, frontmatter, and smoke guards still hold after recent full-profile rollout.
- Log any failures/coverage gaps with owner + next action so Builder/Tester can pick up deterministic follow-on work.

**Out of scope**
- New SeedFinder feature work beyond quality verification and targeted smoke assertion hardening.
- Offer/distribution execution (`OFFER_BRIEF`, pilot outreach) before the quality baseline is confirmed.

### RepoPrompt Builder Context
- **Entry files (paths)**:
  - `package.json`
  - `tests/extractors/web.test.ts`
  - `tests/extractors/seedfinder-profile-normalization.test.ts`
  - `tests/extractors/seedfinder-profile.test.ts`
  - `tests/shared/buildFrontmatter-seedfinder.test.ts`
  - `tests/templates/seedfinder.test.ts`
  - `SEEDFINDER_QUALITY_REPORT.md` (create/update)
- **Search queries/patterns**:
  - `search "SeedFinder full profile smoke|SeedFinder smoke|Non-SeedFinder regression guards" tests/extractors/web.test.ts`
  - `search "seedfinder|SeedFinder profile" tests/extractors tests/shared tests/templates`
  - `search "test:seedfinder|test:seedfinder:smoke|typecheck" package.json`
- **Risks/edge cases to inspect**:
  - Test name drift causing smoke filters (`-t`) to silently skip expected assertions.
  - Overlap/duplication between `seedfinder-profile.test.ts` and `seedfinder-profile-normalization.test.ts` hiding untested paths.
  - Report quality drift (raw command output captured without actionable gap triage).
  - Non-SeedFinder guard regressions masked by only running SeedFinder-tagged tests.
- **Suggested `rp_exec` sequence**:
  - `tree tests`
  - `search "SeedFinder full profile smoke|SeedFinder smoke|Non-SeedFinder regression guards" tests/extractors/web.test.ts`
  - `search "seedfinder|SeedFinder profile" tests/extractors tests/shared tests/templates`
  - `search "test:seedfinder|test:seedfinder:smoke|typecheck" package.json`
  - `select set package.json tests/extractors/web.test.ts tests/extractors/seedfinder-profile-normalization.test.ts tests/extractors/seedfinder-profile.test.ts tests/shared/buildFrontmatter-seedfinder.test.ts tests/templates/seedfinder.test.ts`
  - `select add SEEDFINDER_QUALITY_REPORT.md`
  - `context --files --tree`

### Task Graph
- [x] **TP001**: Confirm/report baseline command contract by reconciling `SEEDFINDER_QUALITY_MATRIX.md`, `TEST_REQUIREMENTS.md`, and npm scripts in `package.json` (identify exact commands to run, expected suite scope, and expected smoke test names).
- [x] **TP002**: Create `SEEDFINDER_QUALITY_REPORT.md` scaffold with sections for environment, command runs, pass/fail summary, observed gaps, and owner/next-action tracking.
- [x] **TP003**: Run `bun run typecheck` and record status, runtime, and any diagnostics in the report.
- [x] **TP004**: Run full focused SeedFinder regression suite (`bun run test:seedfinder`) and record counts, failures, and flaky/slow-test signals.
- [x] **TP005**: Run targeted smoke command (`bun run test:seedfinder:smoke`) and verify the extractor → frontmatter assertion path still exercises full-profile persistence.
- [x] **TP006**: Run parser normalization suite directly (`bun test tests/extractors/seedfinder-profile-normalization.test.ts`) and record edge-case coverage findings (aliases/comparators/ranges/sparse rows).
- [x] **TP007**: Run frontmatter mapping suite directly (`bun test tests/shared/buildFrontmatter-seedfinder.test.ts`) and record any key omission/serialization drift.
- [x] **TP008**: Run template + extractor smoke subset (`bun test tests/templates/seedfinder.test.ts tests/extractors/web.test.ts -t "SeedFinder"`) to verify markdown profile rendering remains deterministic.
- [x] **TP009**: Run non-SeedFinder guard subset (`bun test tests/extractors/web.test.ts -t "Non-SeedFinder regression guards"`) and log whether SeedFinder changes leaked into unrelated templates.
- [x] **TP010**: Triage all failures/gaps into categories (test failure, assertion weakness, command drift, missing coverage) and map each to a concrete next action.
- [x] **TP011**: Add/adjust targeted smoke assertions only where TP010 reveals real coverage gaps (prioritize extractor → frontmatter persistence and non-SeedFinder isolation). _(depends: TP010)_
- [x] **TP012**: Re-run only impacted suites after TP011 and confirm failures are resolved without introducing regressions. _(depends: TP011)_
- [x] **TP013**: Finalize `SEEDFINDER_QUALITY_REPORT.md` with a clear gate verdict (`stable` / `blocked`), command evidence, and an explicit unresolved-gap list.
- [x] **TP014**: If unresolved gaps remain, append at most one concrete follow-on backlog item to `TASKPAD.md` under `## Self-Improvement Backlog` (deduped) and reference it from the report. _(depends: TP013)_
- [x] **TP015**: Execute a final consolidated verification pass (`bun run typecheck && bun run test:seedfinder && bun run test:seedfinder:smoke`) and stamp the report with final result timestamp. _(depends: TP012, TP013)_

### Acceptance Criteria
- `SEEDFINDER_QUALITY_REPORT.md` exists and contains command-by-command pass/fail evidence for the agreed regression stack.
- Report includes explicit gap triage with owner + next action (not just raw logs).
- SeedFinder smoke path and non-SeedFinder guard path are both validated and documented.
- Final gate verdict clearly states whether quality baseline is stable enough to unblock monetization/distribution backlog items.

### Verification Commands
```bash
bun run typecheck
bun run test:seedfinder
bun run test:seedfinder:smoke
bun test tests/extractors/seedfinder-profile-normalization.test.ts
bun test tests/shared/buildFrontmatter-seedfinder.test.ts
bun test tests/templates/seedfinder.test.ts tests/extractors/web.test.ts -t "SeedFinder"
bun test tests/extractors/web.test.ts -t "Non-SeedFinder regression guards"
```

---

## TASKPAD Intake Slice (2026-02-26): RepoPrompt-online retry for SeedFinder full strain profile rollout

### Distilled Scope
**Problem**
- The prior Engineer intake for SeedFinder full profile work proceeded in degraded mode because RepoPrompt MCP was offline, so Builder context was not backed by live `tree/search/select/context` evidence.
- Current repo state shows partial rollout landed (lineage-focused parser + typed schema scaffolding), but the remaining profile fields and regression coverage still need a clear, RepoPrompt-backed execution graph.

**In scope**
- Re-run intake with live RepoPrompt evidence and refresh Builder context with a real selected file set + concrete search traces.
- Re-baseline the active SeedFinder full profile implementation tasks against current code state.
- Keep one executable task graph for Builder covering parser completion, markdown/frontmatter mapping, and test hardening.

**Out of scope**
- New product scope beyond the existing SeedFinder full-profile objective.
- Cross-domain template expansion or broad extractor architecture rewrites.

### RepoPrompt Builder Context
- **Entry files (paths)**:
  - `src/content/extractors/web.ts`
  - `src/content/extractors/seedfinderProfile.ts`
  - `src/shared/types.ts`
  - `src/shared/buildFrontmatter.ts`
  - `src/content/templates/seedfinder.ts`
  - `tests/templates/fixtures/seedfinder-strain.html`
  - `tests/templates/seedfinder.test.ts`
  - `tests/extractors/web.test.ts`
  - `tests/shared/buildFrontmatter-seedfinder.test.ts`
- **Search queries/patterns**:
  - `search "seedfinder|SeedFinder|lineageParents|seedFinderProfile" src tests` → 50 matches / 5 files (top hits: `seedfinderProfile.ts`, `web.ts`, `types.ts`)
  - `search "extractSeedFinderProfile|isSeedFinderStrainTemplate|seedFinderProfile" src/content/extractors/web.ts src/content/extractors/seedfinderProfile.ts tests/extractors/web.test.ts` → 5 matches / 1 file (`web.ts` integration points)
  - `search "lineage|potency|flowering|breeder|aroma|effects" src/content/extractors/seedfinderProfile.ts src/shared/types.ts src/shared/buildFrontmatter.ts` → 42 matches / 1 file (lineage-only parser concentration)
- **Risks/edge cases to inspect**:
  - Header alias drift for profile rows (`Lineage`, `Genetics`, `Flowering Time`, `THC`, `CBD`, etc.).
  - Potency/flowering values with comparators/ranges/mixed units (`<1%`, `18-22%`, `63-70 days`, `9-10 weeks`).
  - Aroma/effects values represented as prose fragments vs delimited lists.
  - Omission behavior: avoid emitting empty frontmatter keys while preserving legacy lineage compatibility fields.
- **Suggested `rp_exec` sequence**:
  - `tree src/content`
  - `tree tests`
  - `search "seedfinder|SeedFinder|lineageParents|seedFinderProfile" src tests`
  - `search "extractSeedFinderProfile|isSeedFinderStrainTemplate|seedFinderProfile" src/content/extractors/web.ts src/content/extractors/seedfinderProfile.ts tests/extractors/web.test.ts`
  - `select set src/content/extractors/web.ts src/content/extractors/seedfinderProfile.ts src/shared/types.ts src/shared/buildFrontmatter.ts src/content/templates/seedfinder.ts`
  - `select add tests/templates/fixtures/seedfinder-strain.html tests/templates/seedfinder.test.ts tests/extractors/web.test.ts tests/shared/buildFrontmatter-seedfinder.test.ts`
  - `context --files --tree` (current selection: 12 files, 22,505 tokens total)

### Task Graph
- [x] **TP001**: Expand `SeedFinderProfileExtraction` and related parser contracts in `src/content/extractors/seedfinderProfile.ts` to include potency, flowering, breeder, aroma, effects, and raw source values (not lineage-only).
- [x] **TP002**: Add canonical header/label normalization utilities for SeedFinder profile rows (alias mapping + cleanup) and route all table parsing through them. _(depends: TP001)_
- [x] **TP003**: Implement THC/CBD potency parsing with comparator/range handling (`<`, `<=`, `>`, `>=`, `~`, single value, range) and preserve raw values. _(depends: TP002)_
- [x] **TP004**: Implement flowering parsing with unit-aware normalization to days/weeks plus optional harvest-window extraction and raw fallback retention. _(depends: TP002)_
- [x] **TP005**: Implement breeder extraction fallback chain (table → selector/prose) with trim/dedupe safeguards. _(depends: TP002)_
- [x] **TP006**: Implement aroma/effects normalization into deterministic arrays (delimiter/prose cleanup, dedupe, stable order). _(depends: TP002)_
- [x] **TP007**: Assemble full `seedFinderProfile` output in `extractSeedFinderProfile` with partial-field tolerance and legacy lineage compatibility fields retained. _(depends: TP003, TP004, TP005, TP006)_
- [x] **TP008**: Integrate full profile attachment in `src/content/extractors/web.ts` by writing `metadata.seedFinderProfile` and keeping `metadata.lineage`/`metadata.lineageParents` mirrored for backward compatibility. _(depends: TP007)_
- [x] **TP009**: Add deterministic markdown rendering for SeedFinder profile fields (e.g., `## Strain Profile`) in template extraction output so normalized values are visible in note body. _(depends: TP008)_
- [x] **TP010**: Extend `src/shared/buildFrontmatter.ts` to serialize full SeedFinder profile fields to stable frontmatter keys with strict omission of empty/null values. _(depends: TP008)_
- [x] **TP011**: Expand SeedFinder fixture coverage with at least one variant/sparse fixture expressing alternate labels and mixed unit formats for parser resilience.
- [x] **TP012**: Add focused parser unit tests (new `tests/extractors/seedfinder-profile.test.ts`) covering alias mapping, potency comparators/ranges, flowering unit conversion, and aroma/effects normalization. _(depends: TP002, TP003, TP004, TP006, TP011)_
- [x] **TP013**: Extend `tests/extractors/web.test.ts` SeedFinder integration assertions for `metadata.seedFinderProfile` completeness and markdown profile block output (canonical + sparse fixtures). _(depends: TP008, TP009, TP011)_
- [x] **TP014**: Extend `tests/shared/buildFrontmatter-seedfinder.test.ts` to verify full profile key serialization and omission behavior for partial/empty fields. _(depends: TP010)_
- [x] **TP015**: Add regression guard coverage ensuring non-SeedFinder template extraction/frontmatter behavior remains unchanged after profile rollout. _(depends: TP008, TP010)_
- [x] **TP016**: Run final verification sweep (typecheck + focused SeedFinder suites + smoke assertion) and record any command/test updates needed for CI parity. _(depends: TP012, TP013, TP014, TP015)_

### Acceptance Criteria
- Engineer handoff includes live RepoPrompt evidence (tree/search/select/context) tied to actual SeedFinder extraction/frontmatter files.
- SeedFinder extraction emits a normalized `metadata.seedFinderProfile` containing lineage, potency, flowering, breeder, aroma, effects, and raw source values when available.
- SeedFinder markdown output includes a deterministic profile section with normalized values.
- Frontmatter includes stable SeedFinder profile keys and omits empty values, while legacy lineage keys remain intact.
- Regression coverage includes parser units, extractor integration (canonical + sparse), frontmatter serialization/omission, and non-SeedFinder guard checks.

### Verification Commands
```bash
bun run typecheck
bun test tests/templates/seedfinder.test.ts tests/extractors/web.test.ts tests/shared/buildFrontmatter-seedfinder.test.ts tests/extractors/seedfinder-profile.test.ts
bun test tests/extractors/web.test.ts -t "SeedFinder full profile smoke"
```

---

## TASKPAD Intake Slice (2026-02-26): SeedFinder full strain profile schema normalized to markdown + frontmatter

### Distilled Scope
**Problem**
- The current SeedFinder slice only normalizes lineage. The active backlog item now requires a fuller, stable strain profile contract (lineage, potency, flowering, breeder, aroma/effects) that is machine-usable in both markdown and frontmatter with regression protection.

**In scope**
- Define and persist a normalized SeedFinder strain profile schema in extraction metadata.
- Parse profile fields from table + prose cues for lineage, potency (THC/CBD), flowering, breeder, aroma, and effects.
- Render the normalized profile into clip markdown in a deterministic section that survives fixture variation.
- Serialize profile fields into frontmatter extras using stable keys and omission rules for empty values.
- Add robust regression coverage (unit normalization + extractor integration + frontmatter + smoke/E2E).

**Out of scope**
- Cross-site cannabis schema generalization beyond SeedFinder.
- Historical backfill/migration for previously clipped notes.
- Broad extractor architecture rewrites not required for this profile schema.

### RepoPrompt Builder Context
- **Status**: RepoPrompt MCP unavailable in this run (`RepoPrompt app is not running or MCP is disabled`). Planning proceeded in degraded file-read mode.
- **Entry files (paths)**:
  - `src/content/extractors/web.ts`
  - `src/shared/types.ts`
  - `src/shared/buildFrontmatter.ts`
  - `src/content/templates/seedfinder.ts`
  - `tests/templates/fixtures/seedfinder-strain.html`
  - `tests/templates/seedfinder.test.ts`
  - `tests/extractors/web.test.ts`
  - `tests/shared/buildFrontmatter-seedfinder.test.ts`
- **Search queries/patterns**:
  - `SeedFinder|seedfinder|lineage|lineageParents`
  - `flowering|THC|CBD|aroma|effects|breeder`
  - `buildFrontmatter|frontmatter.extra|templateUsed`
- **Risks/edge cases to inspect**:
  - Header alias drift in SeedFinder tables (`Lineage` vs `Genetics`, `Flowering Time` vs variants).
  - Potency and flowering ranges expressed as mixed units (`63-70 days`, `9-10 weeks`, `<1%`).
  - Aroma/effects text appearing as comma-separated strings, prose sentences, or absent entirely.
  - Preventing non-SeedFinder template regressions and avoiding frontmatter key pollution when values are empty.
- **Suggested `rp_exec` sequence**:
  - `tree`
  - `search "SeedFinder lineage THC CBD flowering aroma effects"`
  - `select set src/content/extractors/web.ts src/shared/types.ts src/shared/buildFrontmatter.ts`
  - `select add src/content/templates/seedfinder.ts tests/templates/fixtures/seedfinder-strain.html tests/extractors/web.test.ts tests/shared/buildFrontmatter-seedfinder.test.ts`
  - `context`

### Task Graph
- [x] **TP001**: Define a `SeedFinderStrainProfile` schema in `src/shared/types.ts` (lineage + parents, potency, flowering, breeder, aroma, effects, raw source values) and wire it into `ClipMetadata`.
- [x] **TP002**: Extract SeedFinder profile parsing into a dedicated helper module (e.g., `src/content/extractors/seedfinderProfile.ts`) to keep `web.ts` template flow clean and testable.
- [x] **TP003**: Implement table-row normalization utilities with canonical header alias mapping for profile fields (lineage, potency, flowering, breeder, aroma, effects). _(depends: TP002)_
- [x] **TP004**: Implement lineage normalization in the new helper and preserve current `lineage` + `lineageParents` compatibility fields from normalized schema output. _(depends: TP001, TP003)_
- [x] **TP005**: Implement potency normalization (THC/CBD raw + parsed bounds when detectable) with safe fallback for `<`, ranges, and single-value percentages. _(depends: TP003)_
- [x] **TP006**: Implement flowering normalization (raw value + parsed days/weeks/harvest-window when inferable) with unit-aware parsing and no hard failures on ambiguous text. _(depends: TP003)_
- [x] **TP007**: Implement breeder normalization with selector/table/prose fallback and trimming/deduplication rules. _(depends: TP003)_
- [x] **TP008**: Implement aroma/effects normalization into string arrays with delimiter cleanup, duplicate removal, and stable ordering. _(depends: TP003)_
- [x] **TP009**: Integrate full profile extraction into `extractWithTemplate` for SeedFinder strain URLs; attach `metadata.seedFinderProfile` and keep extraction resilient when only partial fields exist. _(depends: TP004, TP005, TP006, TP007, TP008)_
- [x] **TP010**: Add deterministic markdown rendering for normalized profile data (e.g., `## Strain Profile` block) so key fields are visible in note body in addition to metadata. _(depends: TP009)_
- [x] **TP011**: Extend `src/shared/buildFrontmatter.ts` to map full profile schema to stable frontmatter keys (including legacy lineage keys) and omit empty/undefined values. _(depends: TP001, TP009)_
- [x] **TP012**: Expand SeedFinder fixtures with at least one profile-variant case (alternate labels/units + sparse fields) for regression coverage (`tests/templates/fixtures/`).
- [x] **TP013**: Add focused parser unit tests for normalization edge cases (alias mapping, numeric range parsing, `<1%` handling, missing-field tolerance). _(depends: TP002, TP003, TP005, TP006, TP008, TP012)_
- [x] **TP014**: Extend extractor integration tests in `tests/extractors/web.test.ts` to assert full schema metadata + markdown profile block for canonical and sparse fixtures. _(depends: TP009, TP010, TP012)_
- [x] **TP015**: Expand `tests/shared/buildFrontmatter-seedfinder.test.ts` to verify full schema serialization + omission behavior for empty fields and partial profiles. _(depends: TP011)_
- [x] **TP016**: Add regression guard tests ensuring non-SeedFinder template extraction paths and existing template metadata behavior remain unchanged. _(depends: TP009)_
- [x] **TP017**: Final smoke/E2E validation pass: run typecheck + focused SeedFinder suites and add/refresh one smoke test assertion path proving schema survives extractor → frontmatter pipeline. _(depends: TP013, TP014, TP015, TP016)_

### Acceptance Criteria
- SeedFinder strain clips expose a normalized full profile schema in metadata covering lineage, potency (THC/CBD), flowering, breeder, aroma, and effects.
- The clip markdown contains a deterministic profile section reflecting normalized values, not just incidental prose/table remnants.
- Frontmatter output includes stable profile keys with cleaned values and omits empty keys.
- Legacy lineage expectations continue to pass (`lineage`, `lineage_parents`) for backward compatibility.
- Regression coverage includes canonical + sparse/variant fixtures, parser edge cases, extractor integration, frontmatter serialization, and at least one smoke/E2E assertion path.

### Verification Commands
```bash
bun run typecheck
bun test tests/templates/seedfinder.test.ts tests/extractors/web.test.ts tests/shared/buildFrontmatter-seedfinder.test.ts tests/extractors/seedfinder-profile.test.ts
bun test tests/extractors/web.test.ts -t "SeedFinder full profile smoke"
```

---

## TASKPAD Intake Slice (2026-02-26): SeedFinder lineage/genetics captured in clean markdown + frontmatter

### Distilled Scope
**Problem**
- The active TASKPAD backlog item says SeedFinder clips must capture genetics/lineage (the highest-value strain field), but current extraction only preserves lineage incidentally in body text and does not persist a clean, structured lineage field for downstream note workflows.

**In scope (first slice)**
- Add SeedFinder-specific lineage extraction for strain pages by parsing genetics cues from the metadata table and profile copy (e.g., `Cross of ...`).
- Normalize extracted lineage into explicit clip metadata fields (string + optional parent list) so it is durable and testable.
- Map normalized lineage metadata into saved frontmatter keys for clipped notes.
- Add focused tests that validate lineage capture in both markdown output and frontmatter-ready metadata, plus one explicit smoke validation path.

**Out of scope (defer)**
- Full normalization of all strain agronomic/chemotype fields (THC/CBD, flowering, aroma taxonomy, etc.).
- New multi-site cannabis templates beyond SeedFinder.
- Broad architecture refactors or comment sweeps unrelated to lineage extraction.

### First Slice Task List
- [x] **TP1**: Add/adjust SeedFinder fixture coverage (`tests/templates/fixtures/seedfinder-strain.html`) to include stable lineage signals (table and prose variants) needed for deterministic parsing tests.
- [x] **TP2**: Implement SeedFinder lineage parsing helper(s) in template extraction flow (`src/content/extractors/web.ts`) that derive a normalized lineage string from strain metadata/table + fallback prose patterns.
- [x] **TP3**: Extend shared clip metadata typing (`src/shared/types.ts`) and SeedFinder extraction mapping so lineage is stored as explicit metadata fields (e.g., normalized lineage + optional parent list).
- [x] **TP4**: Map the new lineage metadata into saved frontmatter extras in `src/shared/buildFrontmatter.ts` with stable key names for Obsidian querying.
- [x] **TP5**: Add focused tests in `tests/templates/seedfinder.test.ts`, `tests/extractors/web.test.ts`, and a new frontmatter mapping test file to assert clean lineage capture and serialization.
- [x] **TP6**: End-to-end smoke validation — run focused SeedFinder smoke coverage ensuring a strain fixture clip contains the normalized lineage in markdown context and frontmatter-ready metadata.

### Acceptance Criteria
- SeedFinder strain clipping produces a single normalized lineage value for pages containing genetics/cross information.
- Lineage data is exposed in clip metadata with stable field names (not only buried in unstructured body markdown).
- Frontmatter build output includes lineage keys with correct values for SeedFinder clips.
- SeedFinder-focused tests fail before the slice and pass after implementation without regressions to existing SeedFinder extraction behavior.
- A documented smoke validation command/check confirms lineage survives through extraction into frontmatter-ready output.

### Verification Commands
```bash
bun run typecheck
bun test tests/templates/seedfinder.test.ts tests/extractors/web.test.ts tests/shared/buildFrontmatter-seedfinder.test.ts
bun test tests/extractors/web.test.ts -t "SeedFinder lineage smoke"
```

---

## TASKPAD Intake Slice (2026-02-26): SeedFinder strain pages get a clean first-class clipping template

### Distilled Scope
**Problem**
- `TASKPAD.md` calls out a custom SeedFinder clipper as a priority, but current generic extraction does not reliably produce clean, strain-focused notes for `seedfinder.eu` pages.

**In scope (first slice)**
- Add one built-in `seedfinder.eu` template focused on strain profile pages (`/strain-info/...`) with tuned selectors for title/content and noise removal.
- Register/export the template so the existing template matcher and settings surfaces can use it without new architecture.
- Add focused fixture + tests that validate domain/url matching and extraction quality for a representative strain page.
- Add one explicit smoke validation path that exercises the full web extractor flow against a SeedFinder strain fixture.

**Out of scope (defer)**
- Obsidian official clipper repo research/comparative analysis.
- Broad clean-architecture refactors/comment sweeps across the whole codebase.
- Multi-site cannabis template expansion beyond SeedFinder.
- Advanced dynamic parsing for every strain metric field (THC/CBD/lineage normalization) beyond baseline extraction.

### First Slice Task List
- [x] **TP1**: Create `src/content/templates/seedfinder.ts` with a built-in SeedFinder template (`domain`, `urlPattern`, selectors, and `removeSelectors`) tuned for strain profile pages.
- [x] **TP2**: Wire template registration/exports in `src/content/templates/index.ts` so SeedFinder participates in built-in matching and is available to tests/UI listing.
- [x] **TP3**: Add `tests/templates/fixtures/seedfinder-strain.html` fixture capturing realistic strain-page structure (headline, profile content blocks, metadata table/sidebar).
- [x] **TP4**: Add `tests/templates/seedfinder.test.ts` coverage for URL matching precedence and template selector expectations against the new fixture.
- [x] **TP5**: Add/extend web extractor integration coverage in `tests/extractors/web.test.ts` to assert SeedFinder fixture output is clean markdown with expected title + metadata fields.
- [x] **TP6**: End-to-end smoke validation — run a focused smoke test/checklist command that verifies a SeedFinder strain fixture resolves through template matching and produces one coherent clip output.

### Acceptance Criteria
- A SeedFinder strain URL (matching `/strain-info/`) resolves to the new built-in SeedFinder template.
- Extracted markdown from SeedFinder fixture content is coherent (single clip body, no major nav/ad noise, correct strain title).
- Template registration keeps existing built-ins intact (no regressions in template discovery behavior).
- Focused template + extractor tests for SeedFinder fail before implementation and pass after implementation.
- A documented smoke validation step exists and passes for the SeedFinder first slice.

### Verification Commands
```bash
bun run typecheck
bun test tests/templates/seedfinder.test.ts tests/extractors/web.test.ts
bun test tests/extractors/web.test.ts -t "SeedFinder smoke"
```

---

## TASKPAD Intake Slice (2026-02-26): ChatGPT clipper should save one conversation note by default

### Distilled Scope (from `TASKPAD.md`)
**Problem**
- ChatGPT clipping currently creates one note per assistant message in key flows, which fragments long conversations and hurts downstream knowledge-base workflows.

**In scope (this first slice)**
- Make `tools/chatgpt-clipper.ts` default to one note per conversation across local file saves, `--cli`, and `--obsidian` flows.
- Keep per-response output as an explicit opt-in mode for users who still want granular notes.
- Add focused automated verification for save-mode behavior.

**Out of scope (defer)**
- Obsidian official clipper competitive analysis.
- Seedfinder.eu custom extractor/template.
- Broad architecture or refactor sweeps beyond what this save-mode change requires.

### First Slice Task List
- [x] **TP1**: Update ChatGPT clipper CLI mode flags in `tools/chatgpt-clipper.ts` so conversation-level save is default (`saveMode: "conversation"`), add explicit `--per-response`, and keep `--merged` as a backward-compatible alias.
- [x] **TP2**: Refactor save execution in `tools/chatgpt-clipper.ts` to use a shared conversation document builder so local file, `--cli`, and `--obsidian` flows all honor the selected save mode consistently.
- [x] **TP3**: Standardize conversation note format for conversation mode (`title`, `source`, response sections, response count metadata) without changing existing per-response note shape.
- [x] **TP4**: Add targeted tests in `tests/tools/chatgpt-clipper-save-mode.test.ts` for argument parsing + save behavior across conversation vs per-response modes (including CLI/Obsidian dispatch counts).
- [x] **TP5**: Update user-facing docs/help text (`tools/chatgpt-clipper.ts` help output and `README.md`) to reflect default conversation mode and explicit per-response opt-in.

### Acceptance Criteria
- Running `bun run tools/chatgpt-clipper.ts <chatgpt-conversation-url>` creates exactly **one** markdown note per conversation in default file-output mode.
- Running with `--cli` or `--obsidian` in default mode triggers exactly **one** save action per conversation.
- Running with `--per-response` creates one note/save action per assistant response.
- `--merged` remains accepted and maps to conversation mode (no CLI breakage).
- New tests fail before implementation and pass after implementation for both modes.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/chatgpt-clipper-save-mode.test.ts
```

---
