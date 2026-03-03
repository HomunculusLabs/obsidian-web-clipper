# Pilot Sample Gap Planner - Test Fixtures

This directory contains fixture files for testing the `pilot:sample-gap-planner` tool.

## Fixture Scenarios

### 1. Under-Threshold Scenario
**Files:**
- `pilot-sample-gap-planner-under-threshold.brief.md`
- `pilot-sample-gap-planner-under-threshold.run-sheet.md`
- `pilot-sample-gap-planner-under-threshold.responses.md`
- `pilot-sample-gap-planner-under-threshold.expected.json`

**Scenario:**
- Threshold requirements: minSent=10, minReplies=3
- Current state: totalSent=6, totalReplied=2
- Gap analysis: remainingSent=4, requiredBatches=2
- Recommendation: SEND_MORE

**Verification:**
```bash
bun run tools/pilot-sample-gap-planner.ts \
  --brief tests/tools/fixtures/pilot-sample-gap-planner-under-threshold.brief.md \
  --run-sheet tests/tools/fixtures/pilot-sample-gap-planner-under-threshold.run-sheet.md \
  --responses tests/tools/fixtures/pilot-sample-gap-planner-under-threshold.responses.md \
  --batch-size 3 \
  --now 2026-03-01T16:00:00Z \
  --format json
```

### 2. Threshold-Met Scenario
**Files:**
- `pilot-sample-gap-planner-threshold-met.brief.md`
- `pilot-sample-gap-planner-threshold-met.run-sheet.md`
- `pilot-sample-gap-planner-threshold-met.responses.md`
- `pilot-sample-gap-planner-threshold-met.expected.json`

**Scenario:**
- Threshold requirements: minSent=5, minReplies=2
- Current state: totalSent=6, totalReplied=3
- Gap analysis: remainingSent=0, requiredBatches=0
- Recommendation: THRESHOLD_MET

**Verification:**
```bash
bun run tools/pilot-sample-gap-planner.ts \
  --brief tests/tools/fixtures/pilot-sample-gap-planner-threshold-met.brief.md \
  --run-sheet tests/tools/fixtures/pilot-sample-gap-planner-threshold-met.run-sheet.md \
  --responses tests/tools/fixtures/pilot-sample-gap-planner-threshold-met.responses.md \
  --batch-size 3 \
  --now 2026-03-01T16:00:00Z \
  --format json
```

## Acceptance Criteria Met

✅ Under-threshold fixture emits positive `remainingSent` (4), `requiredBatches >= 1` (2), deterministic `channelMix`, and deterministic `latestSendBy`.

✅ Threshold-met fixture emits `remainingSent = 0`, `requiredBatches = 0`, and no contradictory send recommendation while retaining deterministic envelope shape.

✅ Both fixtures produce byte-stable JSON outputs when run with the same `--now` timestamp.

## Notes

- The `--now` timestamp is fixed to `2026-03-01T16:00:00Z` for deterministic testing
- All sent timestamps are within the last 24 hours (no cold-aged contacts in these fixtures)
- Channel distribution is balanced across X DM, Discord DM, and Email
- The expected JSON files capture the exact output format for regression testing
