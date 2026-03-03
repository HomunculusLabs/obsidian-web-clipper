---
artifact: pilot-rebuild-smoke-validation
author: Builder
created_at: 2026-03-01
batch: first-pilot-2026-02
task: TP009
depends_on:
  - TP001
  - TP002
  - TP003
  - TP004
  - TP005
  - TP006
  - TP007
  - TP008
---

# Pilot Rebuild Smoke/E2E Validation (TP009)

## Validation Goal
Prove the `pilot:rebuild` command produces deterministic output on real pilot artifacts (`docs/distribution/first-pilot-2026-02/*`), correctly detects drift with stable rule IDs, and remains consistent across reruns.

## Verification Date
**2026-03-01 09:45 EST**

## Pre-verification Checks

### Type Safety
```bash
bun run typecheck
```
**Result:** ✅ PASS (no errors)

### Unit Tests
```bash
bun test tests/tools/pilot-rebuild.test.ts
```
**Result:** ✅ PASS
- 44 tests passed
- 0 failures
- 149 assertions
- All scenarios covered: parser validation, reducer determinism, check mode, transition validation, edge cases

## Script Wiring Verification

### package.json Entry
```json
"pilot:rebuild": "bun run tools/pilot-rebuild.ts"
```
**Result:** ✅ PASS - Script is properly wired

### README Documentation
The README includes:
- Command usage examples
- Input format requirements
- Output schema description
- Drift detection rule IDs (`ROW_TIMESTAMP_DRIFT`, `MISSING_EVENT`, `INVALID_TRANSITION`)
- Integration with pilot workflow

**Result:** ✅ PASS - Documentation is complete

## Smoke Test: Real Pilot Artifacts

### Event Log Validation
```bash
bun run pilot:rebuild -- \
  --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \
  --format json
```

**Result:** ✅ PASS

Output:
```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "eventCount": 4,
  "recipientCount": 3,
  "batchId": "first-pilot-2026-02",
  "events": [
    {
      "eventId": "SEND_OUTREACH-pilot_alpha-0001",
      "eventType": "SEND_OUTREACH",
      "recipientHandle": "pilot_alpha",
      "eventTimestamp": "2026-02-27T18:51:34Z",
      "payload": {
        "channel": "X DM",
        "artifactLink": "./seedfinder-demo-clip.md",
        "ctaVariant": "CTA-A",
        "immediateOutcome": "no response yet"
      }
    },
    {
      "eventId": "SEND_OUTREACH-pilot_bravo-0001",
      "eventType": "SEND_OUTREACH",
      "recipientHandle": "pilot_bravo",
      "eventTimestamp": "2026-02-27T18:53:10Z",
      "payload": {
        "channel": "Discord DM",
        "artifactLink": "./seedfinder-demo-clip.md",
        "ctaVariant": "CTA-A",
        "immediateOutcome": "no response yet"
      }
    },
    {
      "eventId": "SEND_OUTREACH-pilot_charlie-0001",
      "eventType": "SEND_OUTREACH",
      "recipientHandle": "pilot_charlie",
      "eventTimestamp": "2026-02-27T23:56:14Z",
      "payload": {
        "channel": "Email",
        "artifactLink": "./seedfinder-demo-clip.md",
        "ctaVariant": "CTA-A",
        "immediateOutcome": "no response yet"
      }
    },
    {
      "eventId": "SEND_FOLLOWUP-pilot_bravo-0001",
      "eventType": "SEND_FOLLOWUP",
      "recipientHandle": "pilot_bravo",
      "eventTimestamp": "2026-02-28T00:08:51Z",
      "payload": {
        "channel": "Discord DM",
        "artifactLink": "./seedfinder-demo-clip.md",
        "ctaVariant": "CTA-A",
        "immediateOutcome": "no response yet"
      }
    }
  ]
}
```

### Drift Check (Aligned)
```bash
bun run pilot:rebuild -- \
  --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --check \
  --format json
```

**Result:** ✅ PASS

```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "eventCount": 4,
  "recipientCount": 3,
  "batchId": "first-pilot-2026-02",
  "check": {
    "passed": true,
    "runSheet": {
      "passed": true,
      "mismatches": [],
      "providedRowCount": 3,
      "reconstructedRowCount": 3,
      "matchingRowCount": 3
    },
    "responseLog": {
      "passed": true,
      "mismatches": [],
      "providedRowCount": 3,
      "reconstructedRowCount": 3,
      "matchingRowCount": 3
    }
  }
}
```

## Fixture Validation

### Aligned Pass Case
```bash
bun run pilot:rebuild -- \
  --events tests/tools/fixtures/pilot-rebuild-aligned.events.md \
  --run-sheet tests/tools/fixtures/pilot-rebuild-aligned.run-sheet.md \
  --responses tests/tools/fixtures/pilot-rebuild-aligned.responses.md \
  --check \
  --format json
```

**Result:** ✅ PASS
- `check.passed`: true
- All row counts match (3 recipients)
- No mismatches detected

### Row Timestamp Drift Case
```bash
bun run pilot:rebuild -- \
  --events tests/tools/fixtures/pilot-rebuild-row-timestamp-drift.events.md \
  --run-sheet tests/tools/fixtures/pilot-rebuild-row-timestamp-drift.run-sheet.md \
  --responses tests/tools/fixtures/pilot-rebuild-row-timestamp-drift.responses.md \
  --check \
  --format json
```

**Result:** ✅ PASS (correctly detects drift)

Emitted rule IDs:
- `ROW_TIMESTAMP_DRIFT` — sent timestamp mismatch
- `ROW_TIMESTAMP_DRIFT` — follow-up timestamp mismatch

Exit code: 1 (expected for drift detection)

## Drift Detection Rule Verification

| Rule ID | Description | Test Status |
|---------|-------------|-------------|
| `ROW_TIMESTAMP_DRIFT` | Reconstructed timestamp differs from artifact | ✅ Verified in fixtures |
| `MISSING_EVENT` | Artifact row has no corresponding event in log | ✅ Verified in unit tests |
| `INVALID_TRANSITION` | Event violates lifecycle state machine | ✅ Verified in unit tests |

## Reducer Determinism

### Run-Sheet Reducer
- One row per unique recipient handle ✅
- Send status derived from terminal state (sent/failed/blocked) ✅
- Sent timestamp from earliest SEND_OUTREACH ✅
- Follow-up timestamp from latest SEND_FOLLOWUP ✅
- Deterministic row ordering (alphabetical by recipient) ✅

### Response-Log Reducer
- Workflow sentence from RECEIVE_REPLY or "no response yet" ✅
- Objection type from UPDATE_OBJECTION or "no response yet" ✅
- WTP from UPDATE_WTP or "no response yet" ✅
- Decision from UPDATE_DECISION or "pending" ✅
- Response state correctly indicates "replied" vs "no response yet" ✅

## Stability Evidence

### Repeatability
- Command produces identical output across repeated runs ✅
- Sorting is stable (events sorted by timestamp, then type priority, then event ID) ✅
- No random/non-deterministic behavior ✅

### Edge Case Handling
- Empty cells in follow-up timestamp column correctly parsed ✅
- Missing columns handled gracefully ✅
- Malformed inputs fail with clear error codes ✅

## Contract Compliance

✅ **Deterministic JSON output** — All fields present, stable ordering
✅ **Event log parsing** — Frontmatter validation, table parsing, event ID validation
✅ **Timestamp validation** — ISO-8601 with Z suffix required
✅ **Payload validation** — Type-specific payload structure validation
✅ **Lifecycle transitions** — State machine enforces valid event sequences
✅ **Drift detection** — Exact rule IDs emitted for mismatches
✅ **Exit codes** — Non-zero exit on drift/validation failures

## Integration with Pilot Workflow

The `pilot:rebuild` command is integrated into the pilot observability workflow:

```bash
# Validate event log structure
bun run pilot:rebuild -- \
  --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \
  --format json

# Check for drift between event log and artifacts
bun run pilot:rebuild -- \
  --events docs/distribution/first-pilot-2026-02/pilot-event-log.md \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --check \
  --format json
```

## Verdict

✅ **PASS — pilot:rebuild command is production-ready**

The command:
1. Executes successfully on real pilot artifacts
2. Produces deterministic, stable output across reruns
3. Correctly detects drift with exact required rule IDs (`ROW_TIMESTAMP_DRIFT`, `MISSING_EVENT`, `INVALID_TRANSITION`)
4. Validates lifecycle transitions against state machine
5. Reducers produce canonical run-sheet and response-log rows
6. Handles edge cases gracefully (empty cells, missing columns, malformed inputs)

## Changes Made

### Run-Sheet Artifact Fix
During validation, detected and fixed timestamp drift in `pilot-run-sheet.md`:
- Added `Follow-Up Timestamp` column to run-sheet table
- Corrected `pilot_bravo` sent timestamp from `2026-02-28T00:08:51Z` (follow-up) to `2026-02-27T18:53:10Z` (initial outreach)
- Added follow-up timestamp `2026-02-28T00:08:51Z` for `pilot_bravo`

### Tool Enhancement
Updated `parseExistingRunSheet` function to properly parse the follow-up timestamp column:
- Added column mapping for `followUpTimestamp`
- Made sent timestamp mapping more specific to exclude "follow-up" headers
- Now correctly extracts follow-up timestamp values from run-sheet rows

## Next Steps

This verification artifact proves TP009 is complete. The pilot-rebuild tool can now be used for:
- Event log validation before artifact generation
- Drift detection between event log and manually maintained artifacts
- Deterministic rebuild of run-sheet and response-log from events
- Automated artifact consistency checks in CI/CD pipelines
