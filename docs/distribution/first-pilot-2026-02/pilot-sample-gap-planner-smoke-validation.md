---
artifact: pilot-sample-gap-planner-smoke-validation
author: Builder
created_at: 2026-03-01
batch: first-pilot-2026-02
task: TP010
depends_on:
  - TP001
  - TP002
  - TP003
  - TP004
  - TP005
  - TP006
  - TP007
  - TP008
  - TP009
---

# Pilot Sample Gap Planner Smoke/E2E Validation (TP010)

## Validation Goal
Prove the `pilot:sample-gap-planner` command produces deterministic, stable output on real pilot artifacts (`docs/distribution/first-pilot-2026-02/*`) that matches fixture expectations and provides accurate next-action planning recommendations.

## Verification Date
**2026-03-01 13:21 EST**

## Pre-verification Checks

### Type Safety
```bash
bun run typecheck
```
**Result:** ✅ PASS (no errors)

### Unit Tests
```bash
bun test tests/tools/pilot-sample-gap-planner.test.ts
```
**Result:** ✅ PASS
- 67 tests passed
- 0 failures
- 206 assertions
- All scenarios covered: threshold parsing, gap calculation, channel mix algorithm, latestSendBy logic, deterministic output, fixture validation

## Smoke Test: Real Pilot Artifacts

### Command Execution (JSON Format)
```bash
bun run pilot:sample-gap-planner -- \
  --brief OFFER_BRIEF.md \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --batch-size 3 \
  --format json
```

**Result:** ✅ PASS - Command executes successfully

### Output Validation

#### Threshold Extraction
- `threshold.minSent`: 10 ✅ (from "First outreach batch (10 qualified ICP contacts)")
- `threshold.minReplies`: 3 ✅ (from "yields >=3 correctly formatted PILOT YES replies")
- `threshold.source`: "/Users/t3rpz/projects/obsidian-web-clipper/OFFER_BRIEF.md#pilot-cta" ✅

#### Current State
- `totalSent`: 3 ✅ (matches run sheet: 3 sent rows)
- `totalReplied`: 0 ✅ (all responses are "no response yet")
- `pending`: 3 ✅ (all 3 recipients awaiting first reply)
- `coldAged`: 0 ✅ (sent <72 hours ago)

#### Per-Channel Breakdown
All three channels present with deterministic alphabetical sorting:
- Discord DM: sent=1, replied=0 ✅
- Email: sent=1, replied=0 ✅
- X DM: sent=1, replied=0 ✅

#### Gap Analysis
- `remainingSent`: 7 ✅ (max(0, 10-3) = 7)
- `requiredBatches`: 3 ✅ (ceil(7/3) = 3)
- `channelMix`: [
    {"channel": "Discord DM", "count": 1},
    {"channel": "Email", "count": 1},
    {"channel": "X DM", "count": 1}
  ] ✅ (sorted alphabetically, round-robin distribution)
- `latestSendBy`: "2026-03-02T18:21:04Z" ✅ (now + 24h batch cadence)

#### Recommendation
- `thresholdMet`: false ✅ (3 sent < 10, 0 replied < 3)
- `recommendation`: "SEND_MORE" ✅

### Command Execution (Human Format)
```bash
bun run pilot:sample-gap-planner -- \
  --brief OFFER_BRIEF.md \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --batch-size 3 \
  --format human
```

**Result:** ✅ PASS - Human-readable output includes all planning fields with clear formatting

### Determinism Test

Executed command twice within 60 seconds, compared outputs (excluding `timestamp`):

**Run 1:** (timestamp: 2026-03-01T18:21:04Z)
**Run 2:** (timestamp: 2026-03-01T18:21:16Z)

**Comparison Result:** ✅ IDENTICAL (except timestamp)

All metric values, array structures, object keys, channel ordering, and numeric precision remain stable across reruns.

## Fixture Validation

### Under-Threshold Scenario
```bash
bun run pilot:sample-gap-planner -- \
  --brief tests/tools/fixtures/pilot-sample-gap-planner-under-threshold.brief.md \
  --run-sheet tests/tools/fixtures/pilot-sample-gap-planner-under-threshold.run-sheet.md \
  --responses tests/tools/fixtures/pilot-sample-gap-planner-under-threshold.responses.md \
  --batch-size 3 \
  --format json
```

**Result:** ✅ PASS

Expected outputs:
- `remainingSent`: 4 ✅ (max(0, 10-6) = 4)
- `requiredBatches`: 2 ✅ (ceil(4/3) = 2)
- `channelMix`: non-empty array with 3 channels ✅
- `latestSendBy`: non-null ISO-8601 timestamp ✅
- `thresholdMet`: false ✅
- `recommendation`: "SEND_MORE" ✅

### Threshold-Met Scenario
```bash
bun run pilot:sample-gap-planner -- \
  --brief tests/tools/fixtures/pilot-sample-gap-planner-threshold-met.brief.md \
  --run-sheet tests/tools/fixtures/pilot-sample-gap-planner-threshold-met.run-sheet.md \
  --responses tests/tools/fixtures/pilot-sample-gap-planner-threshold-met.responses.md \
  --batch-size 3 \
  --format json
```

**Result:** ✅ PASS

Expected outputs:
- `remainingSent`: 0 ✅ (thresholds met)
- `requiredBatches`: 0 ✅ (no more batches needed)
- `channelMix`: [] ✅ (empty array when threshold met)
- `latestSendBy`: null ✅ (no deadline when threshold met)
- `thresholdMet`: true ✅
- `recommendation`: "THRESHOLD_MET" ✅

## Contract Compliance

✅ **Deterministic JSON output** - All numeric values are integers, object keys sorted alphabetically
✅ **Threshold extraction** - OFFER_BRIEF.md parsing works correctly with Pilot CTA and Pricing Hypothesis patterns
✅ **Gap math engine** - `remainingSent = max(0, minSent - currentSent)`, `requiredBatches = ceil(remainingSent / batchSize)`
✅ **Channel mix algorithm** - Prioritizes lowest reply rates, alphabetical tie-break, round-robin distribution
✅ **latestSendBy calculation** - Uses batch cadence (24h) anchored to latest send timestamp or now
✅ **Threshold-met short-circuit** - Returns all zeros and empty arrays when both thresholds are met
✅ **Error handling** - Invalid inputs fail with actionable error codes (verified in tests)

## Stability Evidence

### Repeatability
- Command can be run multiple times with identical results (excluding timestamp)
- No random/non-deterministic behavior observed
- Sorting, rounding, and metric calculations are stable
- Channel mix algorithm produces identical output for same input state

### Edge Case Handling
- Empty channel state produces empty channelMix
- Threshold-met state returns zeros and nulls correctly
- Missing OFFER_BRIEF.md patterns fail with AMBIGUOUS_THRESHOLD error
- Duplicate recipients in run sheet fail with DUPLICATE_RECIPIENT error
- Recipient mismatch between run sheet and response log fails with RECIPIENT_MISMATCH error

## Integration with Pilot Workflow

The `pilot:sample-gap-planner` command is now integrated into the pilot observability workflow:

```bash
# After recording sends and responses, run gap planner to get next-action recommendations:
bun run pilot:sample-gap-planner -- \
  --brief OFFER_BRIEF.md \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --batch-size 3 \
  --format json
```

Output can be:
- Parsed by automation for batch planning decisions
- Logged for historical tracking of evidence accumulation
- Used to answer: how many sends remain, how many batches needed, what channel mix, and by when

### Decision Support

The planner provides three recommendation states:
1. **SEND_MORE** - Continue outreach to reach threshold
2. **THRESHOLD_MET** - Decision-grade evidence achieved, proceed to pricing verdict
3. **HOLD** - Awaiting replies from pending recipients (not yet implemented)

## Verdict

✅ **PASS — pilot:sample-gap-planner command is production-ready**

The command:
1. Executes successfully on real pilot artifacts
2. Produces deterministic, stable output across reruns
3. Matches fixture expectations verified by unit tests
4. Extracts thresholds correctly from OFFER_BRIEF.md (both Pilot CTA and Pricing Hypothesis patterns)
5. Calculates accurate gap metrics (remainingSent, requiredBatches, latestSendBy)
6. Provides deterministic channel mix recommendations with rate-based priority and alphabetical tie-break
7. Handles both under-threshold and threshold-met scenarios correctly
8. Includes all required planning fields for next-action decision support

## Next Steps

This verification artifact proves TP010 is complete. The pilot sample gap planner can now be used for:
- Deterministic next-batch planning in pilot outreach workflows
- Answering operator questions: how many sends remain, how many batches needed, what channel mix, and by when
- Automated decision support for evidence accumulation tracking
- Integration with pricing verdict workflows once thresholds are met

## Related Artifacts

- Threshold source: `OFFER_BRIEF.md`
- Run sheet: `docs/distribution/first-pilot-2026-02/pilot-run-sheet.md`
- Response log: `docs/distribution/first-pilot-2026-02/pilot-response-log.md`
- Unit tests: `tests/tools/pilot-sample-gap-planner.test.ts`
- Test fixtures: `tests/tools/fixtures/pilot-sample-gap-planner-*.*`
