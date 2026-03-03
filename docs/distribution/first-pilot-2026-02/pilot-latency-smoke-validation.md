---
artifact: pilot-latency-smoke-validation
author: Builder
created_at: 2026-03-01
batch: first-pilot-2026-02
task: TP007
depends_on:
  - TP001
  - TP002
  - TP003
  - TP004
  - TP005
  - TP006
---

# Pilot Latency Analyzer Smoke/E2E Validation (TP007)

## Validation Goal
Prove the `pilot:latency` command produces deterministic, stable output on real pilot artifacts (`docs/distribution/first-pilot-2026-02/*`) that matches fixture expectations and remains consistent across reruns.

## Verification Date
**2026-03-01 08:40 EST**

## Pre-verification Checks

### Type Safety
```bash
bun run typecheck
```
**Result:** ✅ PASS (no errors)

### Unit Tests
```bash
bun test tests/tools/pilot-latency.test.ts
```
**Result:** ✅ PASS
- 10 tests passed
- 0 failures
- 91 assertions
- All scenarios covered: no-reply, mixed-reply, followup-conversion, CTA variants, error handling, deterministic output

## Smoke Test: Real Pilot Artifacts

### Command Execution
```bash
bun run pilot:latency -- \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --format json
```

**Result:** ✅ PASS - Command executes successfully

### Output Validation

#### Batch Metadata
- `batchId`: "first-pilot-2026-02" ✅
- Analysis timestamp present and valid ISO-8601 ✅

#### Summary Metrics
- `totalSent`: 3 ✅
- `totalReplied`: 0 ✅
- `totalNoReply`: 3 ✅
- `totalColdAged`: 0 ✅ (expected - sent <72 hours ago)
- `replyRate`: 0 ✅

#### Latency Metrics
- `hoursToFirstReply`: [] ✅ (expected - no replies yet)
- `medianHoursToFirstReply`: null ✅
- `p90HoursToFirstReply`: null ✅
- `meanHoursToFirstReply`: null ✅

#### Conversion Metrics
- `followupConversionRate`: 0 ✅
- `followupConvertedCount`: 0 ✅
- `followupAttemptedCount`: 1 ✅ (one follow-up sent to pilot_bravo)

#### Channel Breakdown
All three channels present with deterministic sorting:
- Discord DM: sent=1, replied=0, replyRate=0, coldAgedCount=0 ✅
- Email: sent=1, replied=0, replyRate=0, coldAgedCount=0 ✅
- X DM: sent=1, replied=0, replyRate=0, coldAgedCount=0 ✅

### Determinism Test

Executed command twice within 60 seconds, compared outputs (excluding `analysisTimestamp`):

**Run 1:** (timestamp: 2026-03-01T13:40:21.672Z)
**Run 2:** (timestamp: 2026-03-01T13:40:45.123Z)

**Comparison Result:** ✅ IDENTICAL (except timestamp)

All metric values, array structures, object keys, and numeric precision remain stable across reruns.

## Fixture Validation

### Mixed-Reply Fixture
```bash
bun run pilot:latency -- \
  --run-sheet tests/tools/fixtures/pilot-latency-mixed-reply.run-sheet.md \
  --responses tests/tools/fixtures/pilot-latency-mixed-reply.responses.md \
  --format json
```

**Result:** ✅ PASS

Expected outputs match test assertions:
- `totalSent`: 6
- `totalReplied`: 4
- `replyRate`: 0.67
- `totalColdAged`: 2 (2 recipients >72 hours with no reply)
- Channel breakdown with deterministic sorting (Discord DM, Email, X DM)

### No-Reply Fixture
All recipients cold-aged, no replies - verified in unit tests.

### Followup-Conversion Fixture
Follow-up detection and conversion metrics - verified in unit tests.

### CTA Variant Fixture
Per-CTA breakdown with `byCTA` field - verified in unit tests.

## Contract Compliance

✅ **Deterministic JSON output** - All numeric values rounded to 2 decimal places
✅ **Per-channel breakdown** - Channels sorted alphabetically, all required fields present
✅ **Cold-aging threshold** - 72-hour threshold correctly applied
✅ **Follow-up detection** - Send outcome log parsing works correctly
✅ **Error handling** - Invalid inputs fail with actionable error codes (verified in tests)

## Stability Evidence

### Repeatability
- Command can be run multiple times with identical results (excluding timestamp)
- No random/non-deterministic behavior observed
- Sorting, rounding, and metric calculations are stable

### Edge Case Handling
- Empty reply arrays correctly produce null median/p90/mean
- Missing CTA data correctly omits `byCTA` field
- Malformed inputs fail with clear error codes (tested in unit tests)

## Integration with Pilot Workflow

The `pilot:latency` command is now integrated into the pilot observability workflow:

```bash
# After recording sends and responses, run latency analysis:
bun run pilot:latency -- \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --format json
```

Output can be:
- Parsed by automation for decision-making
- Logged for historical tracking
- Compared across batches for channel/CTA optimization

## Verdict

✅ **PASS — pilot:latency command is production-ready**

The command:
1. Executes successfully on real pilot artifacts
2. Produces deterministic, stable output across reruns
3. Matches fixture expectations verified by unit tests
4. Includes all required metric fields (medianHoursToFirstReply, p90HoursToFirstReply, followupConversionRate, coldAgedCount)
5. Provides per-channel and per-CTA breakdowns for optimization insights
6. Handles edge cases gracefully (no replies, missing CTA data)

## Next Steps

This verification artifact proves TP007 is complete. The pilot-latency analyzer can now be used for:
- Response timing analysis in future pilot batches
- Channel/CTA performance comparison
- Monetization decision support based on latency metrics
- Automated reporting in outreach workflows
