---
author: Builder
date: 2026-02-27
status: Draft
owner: Obsidian Web Clipper team
---

# OFFER_BRIEF

## Document Control
- **Canonical location**: `OFFER_BRIEF.md` (repo root)
- **Project**: `obsidian-web-clipper`
- **Last updated**: 2026-02-27

## Quality Baseline Status
- **Gate verdict**: `stable` (from `SEEDFINDER_QUALITY_REPORT.md`, updated 2026-02-27 13:16:55 EST)
- **Baseline evidence**: 8/8 quality commands passing; 0 blockers; unresolved gaps: none.
- **Required release chain (latest consolidated pass)**: `bun run typecheck && bun run test:seedfinder && bun run test:seedfinder:smoke`
- **Branch/commit at report time**: `gatekeeper-test` @ `49293b1`

## Ideal Customer Profile (Pilot User)
**Primary ICP (pilot archetype):**
- **Role**: Solo technical founder / indie builder who researches heavily and works in Obsidian daily.
- **Environment**: Captures ideas from docs/blogs/forums and wants one searchable personal knowledge base.
- **Current stack**: Browser reading + manual copy/paste + ad-hoc markdown cleanup + Obsidian notes.
- **Pilot fit criteria**:
  - Clips 10+ web pages per week.
  - Already stores notes in Obsidian (not starting from zero).
  - Feels active pain from inconsistent metadata/formatting and fragmented notes.

## Job to Be Done + Workflow Pain Points
**Core job-to-be-done:**
> When I find useful content online, help me capture it into Obsidian quickly in a clean, structured format so I can actually retrieve and use it later when building.

**Current workflow pain points (clipping + KB building):**
1. **Manual cleanup tax**: copy/paste flows require repeated title cleanup, formatting fixes, and metadata edits.
2. **Inconsistent structure**: notes land in different shapes, making Dataview/Bases queries brittle.
3. **Context loss during capture**: source URL/template metadata often gets missed or stored inconsistently.
4. **High friction breaks capture habit**: when clipping is annoying, valuable pages stay in tabs/bookmarks and never enter the knowledge base.
5. **Poor retrieval confidence**: even when notes exist, weak normalization makes later search/filtering unreliable.

## Value Promise (Verified-Capability Only)
> For Obsidian-first builders who clip research-heavy web content, Obsidian Web Clipper reliably captures pages into clean Markdown with stable metadata/frontmatter (including SeedFinder strain profile fields) so notes stay queryable and reusable instead of requiring manual cleanup.

## Proof Points / Evidence
- **Quality gate is currently green and recent**: `SEEDFINDER_QUALITY_REPORT.md` (updated 2026-02-27 13:16:55 EST) records a `stable` verdict with **8/8 commands passing**, **0 blockers**, and no unresolved gaps.
- **Value claim is backed by a repeatable command contract**: `SEEDFINDER_COMMAND_CONTRACT.md` defines the exact verification chain (`bun run typecheck`, `bun run test:seedfinder`, `bun run test:seedfinder:smoke`, plus non-SeedFinder guard smoke) so "reliably captures into clean Markdown with stable metadata/frontmatter" is tied to executable checks, not opinion.
- **Extractor → frontmatter persistence is explicitly tested**: `SEEDFINDER_QUALITY_REPORT.md` cites smoke evidence (`2 pass`, `0 fail`, `29 expect() calls`) for `bun run test:seedfinder:smoke`, including canonical + sparse fixture assertions that validate full-profile metadata survives into frontmatter.
- **Regression isolation is verified**: `SEEDFINDER_QUALITY_REPORT.md` records `Non-SeedFinder regression guards` passing (`2 pass`, `0 fail`), supporting the promise that SeedFinder-specific metadata handling does not leak into unrelated templates.

## Pricing Hypothesis
- **Initial pilot price point (monthly)**: **$12/mo** for solo builders.
- **Acceptable test range**: **$8-$19/mo** during pilot interviews (positioning test, not final public pricing).
- **Rationale**:
  1. **ICP economics**: solo technical founders/indie builders already paying for dev and productivity tooling can absorb a low double-digit utility subscription without procurement friction.
  2. **Value-to-effort tradeoff**: if the clipper consistently removes manual cleanup and preserves queryable metadata/frontmatter, saving even ~1-2 cleanup sessions per week should exceed a $12/mo perceived value threshold.
  3. **Risk-aware positioning**: current quality baseline is stable for SeedFinder workflows, but distribution is still gated; a moderate pilot price avoids overpromising enterprise-grade breadth while still testing real willingness to pay.
- **Validation signal (supports hypothesis)**:
  - In first 10 qualified pilot conversations, **>=3 explicit "yes" commitments** at **$12/mo** _or_ **>=5 qualified users** selecting a value point within the **$8-$19/mo** range (without requiring custom scope promises).
- **Invalidation signal (rejects hypothesis)**:
  - **<2 of first 10 qualified pilots** accept $12/mo-equivalent value, or most responses cluster **below $8/mo** unless additional non-core features/services are bundled.

## Pilot CTA
**Exact ask (single CTA):**
> Reply with: `PILOT YES - <your Obsidian workflow in 1 sentence> - <price you'd pay in $/mo from $8-$19>` if you're willing to run a 14-day pilot and give structured feedback.

**Required response format:**
- Prefix: `PILOT YES` (commit signal)
- Workflow sentence: current clipping + retrieval workflow in one line
- Price signal: one monthly willingness-to-pay value in the `$8-$19` test range

**Success signal for this CTA:**
- First outreach batch (10 qualified ICP contacts) yields **>=3 correctly formatted `PILOT YES` replies**, each including both workflow context and a concrete $/mo signal.

## Anti-Goals (What We Will Not Promise)
- We will **not** promise broad, all-site clipping reliability beyond currently verified SeedFinder-focused quality evidence.
- We will **not** promise enterprise features (team admin, SOC2/compliance, SLA guarantees, priority support) in this pilot.
- We will **not** promise custom integrations, bespoke automation, or one-off feature delivery as a condition of pilot participation.
- We will **not** promise production readiness while the distribution quality gate remains `blocked`.

## Quality Gate Before Distribution
Distribution remains **blocked** until all three commands below have fresh pass evidence captured in this brief (see TP011).

### Fresh pass evidence checklist (required before any pilot outreach)
- [x] `bun run typecheck` — timestamped pass captured with branch/commit
- [x] `bun run test:seedfinder` — timestamped pass captured with branch/commit
- [x] `bun run test:seedfinder:smoke` — timestamped pass captured with branch/commit

### TP011 verification evidence (current distribution window)
- **Run context**: branch `gatekeeper-test`, commit `49293b1`
- `2026-02-27 13:34:29 EST` — `bun run typecheck` — **PASS**
- `2026-02-27 13:34:32 EST` — `bun run test:seedfinder` — **PASS**
- `2026-02-27 13:34:34 EST` — `bun run test:seedfinder:smoke` — **PASS**

### Freshness rule
- Evidence must come from a **new run in the current distribution window** (do not rely on stale historical report snapshots).
- If code or fixtures change after evidence capture, rerun all three commands and refresh the evidence block.

## Pilot Response Logging Template
Use one entry per pilot reply so decisions stay consistent and auditable.

### Response Entry Template
```markdown
### Pilot Response — {{name_or_handle}} — {{date}}
- **Source channel**: {{DM/email/community}}
- **ICP fit**: {{high/medium/low}} — {{why}}
- **Workflow context (their words)**: {{1 sentence summary}}

#### Feedback Signals
- **Most valuable outcome they want**: {{free text}}
- **Current pain level**: {{1-5}}
- **Confidence this solves their workflow**: {{1-5}}
- **Requested capability gaps**:
  - {{gap 1}}
  - {{gap 2}}

#### Objections / Risks
- **Primary objection category**: {{trust|price|workflow-fit|missing-feature|timing|other}}
- **Exact objection quote**: "{{verbatim quote}}"
- **Can objection be addressed without custom scope?**: {{yes/no}}
- **Mitigation note**: {{how we respond or what evidence is missing}}

#### Willingness to Pay
- **Stated WTP ($/mo)**: {{number or range}}
- **At $12/mo today**: {{yes|maybe|no}}
- **Minimum acceptable value point ($/mo)**: {{number}}
- **Conditions for yes**: {{what must be true}}

#### Next-Step Decision Rubric
- **Decision**: {{advance|nurture|disqualify}}
- **Rubric checks**:
  - [ ] ICP fit is high/medium
  - [ ] Shared a concrete workflow pain
  - [ ] Provided a numeric WTP signal
  - [ ] No hard blocker requiring custom feature scope
- **Decision rationale**: {{1-2 sentences}}
- **Owner**: {{name}}
- **Follow-up by**: {{date}}
```

### Decision Rubric (quick reference)
- **Advance**: ICP fit high/medium, clear pain, numeric WTP in/near `$8-$19`, and no custom-scope blocker.
- **Nurture**: potential fit but missing one key signal (usually timing, unclear pain, or weak WTP confidence).
- **Disqualify**: low ICP fit, no real clipping pain, or requires out-of-scope custom commitments.

## TP010 Content QA Pass (Section Completeness + Contradiction Check)
- **QA run timestamp**: 2026-02-27 13:31 EST
- **Completeness check**: ✅ Required sections present (`ICP`, `Job to Be Done + Workflow Pain Points`, `Value Promise`, `Proof Points / Evidence`, `Pricing Hypothesis`, `Pilot CTA`, `Quality Gate Before Distribution`, `Pilot Response Logging Template`, `Distribution Readiness Verdict`).
- **Contradiction check vs `SEEDFINDER_QUALITY_REPORT.md`**: ✅ No claim-level conflicts found.
  - Quality baseline references in this brief match report facts: verdict `stable`, update time `2026-02-27 13:16:55 EST`, consolidated gate chain, and 8/8 command pass status.
- **Correction made in this pass**: Distribution verdict reason updated to remove stale "content sections are incomplete" language.

## TP012 Final Smoke Review (Go/No-Go)
- **Smoke review timestamp**: 2026-02-27 13:36 EST
- **Target user present**: ✅ `Ideal Customer Profile (Pilot User)` defines one primary ICP with fit criteria.
- **Value promise present**: ✅ `Value Promise (Verified-Capability Only)` provides a single constrained promise tied to verified capabilities.
- **Price hypothesis present**: ✅ `Pricing Hypothesis` defines $12/mo anchor, $8-$19 test range, and explicit validation/invalidation signals.
- **CTA present**: ✅ `Pilot CTA` provides one exact response format and success threshold.
- **Explicit gate verdict present**: ✅ `Quality Baseline Status` cites `stable` verdict and `Quality Gate Before Distribution` includes fresh TP011 command evidence.
- **Go/No-go decision**: ✅ `go` — all required brief elements and gate evidence are present with no unresolved quality blockers.

## Distribution Readiness Verdict
- **Status**: `ready`
- **Reason**: TP012 final smoke review confirms required offer components (target user, value promise, pricing hypothesis, CTA) and explicit gate verdict/evidence are complete; distribution is unblocked for pilot outreach.
