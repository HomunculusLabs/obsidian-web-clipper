# SeedFinder Quality Report

_Last updated: 2026-02-27 13:16:55 EST_

## Environment
- Date/time: 2026-02-27 13:16:55 EST
- Branch/commit: `gatekeeper-test` @ `49293b1`
- OS/runtime: Darwin 24.5.0
- Bun version: 1.2.22
- Node version: v23.3.0
- Runner: Builder (non-interactive)

## Command Runs
| Command | Status (pass/fail) | Runtime | Notes | Evidence |
| --- | --- | --- | --- | --- |
| `bun run typecheck` | ✅ pass | 1s | No diagnostics emitted. | `tsc --noEmit` completed with exit code 0. |
| `bun run test:seedfinder` | ✅ pass | 0.20s | 93/93 tests passed across 4 files; 0 failures; 405 assertions. Slowest observed test: `Web Extractor Types > ExtractWebPageArgs interface is correct` (32.63ms). No obvious flaky signal in this run. | Bun output: `93 pass`, `0 fail`, `Ran 93 tests across 4 files. [188.00ms]` |
| `bun run test:seedfinder:smoke` | ✅ pass | 0.10s | TP012 impacted rerun executed both full-profile smoke assertions (canonical + sparse fixture) and confirmed extractor → frontmatter persistence for each path. | Bun output: `2 pass`, `0 fail`, `29 expect() calls`, `Ran 2 tests across 1 file. [98.00ms]` |
| `bun run typecheck && bun run test:seedfinder && bun run test:seedfinder:smoke` | ✅ pass | ~1.3s | **TP015 consolidated verification pass** completed in one chained execution; all commands remained green. | Typecheck exited 0; SeedFinder suite: `95 pass`, `0 fail`, `426 expect() calls`; Smoke suite: `2 pass`, `0 fail`, `29 expect() calls` (run timestamp: 2026-02-27 13:16:55 EST). |
| `bun test tests/extractors/seedfinder-profile-normalization.test.ts` | ✅ pass | 0.11s | 20/20 tests passed (151 assertions). Edge-case coverage explicitly exercises header aliases, potency comparators/ranges, flowering range+harvest windows, and sparse-row omission behavior. | Bun output: `20 pass`, `0 fail`, `151 expect() calls`, `Ran 20 tests across 1 file. [104.00ms]` |
| `bun test tests/shared/buildFrontmatter-seedfinder.test.ts` | ✅ pass | 0.01s | 3/3 tests passed (74 assertions). No key omission or serialization drift observed; full-profile keys serialize to frontmatter/YAML and empty values are omitted while partial populated values persist. | Bun output: `3 pass`, `0 fail`, `74 expect() calls`, `Ran 3 tests across 1 file. [12.00ms]` |
| `bun test tests/templates/seedfinder.test.ts tests/extractors/web.test.ts -t "SeedFinder"` | ✅ pass | 0.13s | 12/12 SeedFinder-filtered tests passed across template + extractor smoke paths; markdown profile rendering and extractor/frontmatter persistence checks remained deterministic in this run. | Bun output: `12 pass`, `0 fail`, `111 expect() calls`, `Ran 12 tests across 2 files. [132.00ms]` |
| `bun test tests/extractors/web.test.ts -t "Non-SeedFinder regression guards"` | ✅ pass | 0.10s | TP012 impacted rerun validated both Reddit + Hacker News isolation guards; no SeedFinder metadata/frontmatter leakage into unrelated templates. | Bun output: `2 pass`, `0 fail`, `25 expect() calls`, `Ran 2 tests across 1 file. [99.00ms]` |

## Pass/Fail Summary
- Overall gate: ✅ stable (TP015 consolidated verification pass stamped at 2026-02-27 13:16:55 EST)
- Commands passed: 8 / 8
- Commands failed: 0 / 8
- TP012 impacted rerun: 2 / 2 suites passed (`test:seedfinder:smoke`, `Non-SeedFinder regression guards`)
- Blockers: 0

## Gate Verdict
- **Verdict**: `stable`
- **Reason**: TP015 executed the required consolidated command chain in a single pass and all commands remained green:
  - `bun run typecheck && bun run test:seedfinder && bun run test:seedfinder:smoke`

## Unresolved Gaps (Explicit)
- None. Consolidated verification stamp recorded and no failing commands observed.

## Observed Gaps
> Capture failures, weak assertions, command drift, and missing coverage.

- **Test failure**: None observed in TP003-TP015 command runs (8/8 passing).  
  **Next action**: Monitor in normal CI cadence; no immediate remediation required.
- **Assertion weakness**: Previously the smoke path validated canonical fixture persistence only (`Blue Dream`) and did not assert sparse/alias-heavy profile persistence.
  **Next action**: ✅ Addressed in TP011 (sparse smoke assertion added) and validated in TP012 impacted rerun.
- **Command drift**: `-t` smoke/guard filters remain a watch item; TP012 rerun and TP015 consolidated pass both confirmed expected assertion sets execute (2 tests each).
  **Next action**: Keep watch-only in CI, no immediate action.
- **Missing coverage**: Previously the non-SeedFinder guard checked Reddit isolation only.
  **Next action**: ✅ Addressed in TP011 by adding Hacker News isolation guard and validated in TP012 rerun.

## Owner / Next Action Tracking
| Gap / Issue | Category | Owner | Next Action | Target Date | Status |
| --- | --- | --- | --- | --- | --- |
| No failing commands in TP003-TP015 | test failure | Builder | TP015 consolidated run completed green; continue routine CI monitoring for regressions/flakes. | TP015 run | resolved |
| Smoke path only validates canonical fixture persistence | assertion weakness | Builder | Added sparse fixture extractor→frontmatter smoke assertion in TP011; verified by TP012 rerun. | TP011-TP012 | resolved |
| `-t` filter name drift can silently weaken smoke/guard command intent | command drift | Builder | TP012 rerun + TP015 consolidated pass confirmed smoke/guard filters execute expanded assertion sets (2 tests each). | TP011-TP015 | resolved |
| Non-SeedFinder isolation guard covers Reddit only | missing coverage | Builder | Added Hacker News isolation guard in TP011 and validated alongside Reddit in TP012 rerun. | TP011-TP012 | resolved |

## Notes
- Use this report as the canonical artifact for TP003-TP015 command evidence and triage.
- TP004 signal snapshot: no failures, no reruns/timeouts, and no obvious flaky behavior in a single run; monitor `tests/extractors/web.test.ts` duration trends (current slowest assertion observed at 32.63ms).
- TP005 smoke snapshot: targeted full-profile smoke assertion passed and explicitly checks extractor metadata against frontmatter extras (lineage, potency, flowering/raw lineage, breeder) to guard persistence path.
- TP006 parser-normalization snapshot: suite passes with direct coverage for alias normalization (`Genetic Lineage`, `THC/CBD`, `Harvest Window`), comparator/range potency parsing (`>=`, `<`, `~`, reversed ranges), flowering conversions (weeks↔days + harvest windows), and sparse fixture behavior that intentionally omits aroma/effects when source rows are missing/placeholders).
- TP007 frontmatter mapping snapshot: direct suite pass confirms expected SeedFinder key serialization into frontmatter/YAML and omission behavior for empty values; no key omission or serialization drift observed in this run.
- TP008 template+extractor subset snapshot: SeedFinder-filtered run passed (12 tests, 111 assertions) across `tests/templates/seedfinder.test.ts` and `tests/extractors/web.test.ts`, confirming deterministic markdown profile rendering plus extractor/frontmatter persistence smoke checks in this run.
- TP009 non-SeedFinder guard snapshot: targeted `Non-SeedFinder regression guards` run passed (1 test, 15 assertions) and confirms SeedFinder profile/frontmatter fields did not leak into Reddit extraction output in this run.
- TP010 triage snapshot: no active test failures, but actionable gaps were identified in smoke assertion breadth, `-t` command drift resilience, and non-SeedFinder guard coverage breadth; mapped follow-up actions are queued for TP011/TP012.
- TP012 impacted-suite rerun snapshot: post-TP011 reruns passed for both impacted commands — `bun run test:seedfinder:smoke` (2 smoke tests, 29 assertions) and `bun test tests/extractors/web.test.ts -t "Non-SeedFinder regression guards"` (2 guard tests, 25 assertions). No regressions were observed in impacted areas.
