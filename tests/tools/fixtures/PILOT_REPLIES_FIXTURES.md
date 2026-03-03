# Pilot Reply Ingestion Fixtures

This directory contains fixture files for testing the `pilot:ingest-replies` command.

## Base Fixtures

### pilot-ingest-replies-base.responses.md
Base pilot-response-log with 3 known recipients:
- `pilot_alpha`
- `pilot_bravo`
- `pilot_charlie`

### pilot-ingest-replies-base.events.md
Base pilot-event-log with SEND_OUTREACH events for the 3 known recipients.

### pilot-replies-existing-events.events.md
Extended event log with existing RECEIVE_REPLY events for testing duplicate detection against historical data.

## Test Scenarios

### 1. Happy Path (pilot-replies.ndjson)
**Purpose:** Test successful ingestion of valid reply data.

**Input:** 3 valid NDJSON rows with known recipients
**Expected:** All rows processed successfully, 3 response-log upserts, 3 event-log upserts
**Status:** success
**Snapshot:** `pilot-replies.expected.json`

### 2. Duplicate Replay Within Batch (pilot-replies-duplicates.ndjson)
**Purpose:** Test duplicate message ID detection within a single batch.

**Input:** 5 rows with duplicate message IDs (msg-001 and msg-002 appear twice)
**Expected:** 3 unique rows processed, 2 duplicates suppressed
**Status:** partial
**Snapshot:** `pilot-replies-duplicates.expected.json`

### 3. Duplicate Against Existing Events (pilot-replies-duplicate-existing.ndjson)
**Purpose:** Test duplicate detection against existing event-log history.

**Input:** 3 rows, 2 of which duplicate existing RECEIVE_REPLY events
**Requires:** `pilot-replies-existing-events.events.md`
**Expected:** 1 unique row processed, 2 duplicates suppressed
**Status:** partial
**Snapshot:** `pilot-replies-duplicate-existing.expected.json`

### 4. Unknown Recipient (pilot-replies-unknown-recipient.ndjson)
**Purpose:** Test UNKNOWN_RECIPIENT rule ID validation.

**Input:** 4 rows, 2 with unknown recipients (@unknown_user, random_person)
**Expected:** 2 valid rows processed, 2 UNKNOWN_RECIPIENT errors
**Status:** failed
**Snapshot:** `pilot-replies-unknown-recipient.expected.json`

### 5. Invalid Decision State (pilot-replies-invalid-decision.ndjson)
**Purpose:** Test INVALID_DECISION_STATE rule ID validation.

**Input:** 4 rows, 2 with invalid decision values (not-a-valid-state, maybe)
**Expected:** 2 valid rows processed, 2 INVALID_DECISION_STATE errors
**Status:** failed
**Snapshot:** `pilot-replies-invalid-decision.expected.json`

### 6. Multiple Error Types (pilot-replies-errors.ndjson)
**Purpose:** Test multiple validation errors in a single batch.

**Input:** 5 rows + 1 malformed line with various errors:
- MALFORMED_ROW (invalid JSON)
- UNKNOWN_RECIPIENT (unknown recipient)
- INVALID_CHANNEL (invalid channel value)
- INVALID_DECISION_STATE (invalid decision state)
- MISSING_MESSAGE_ID (empty/missing messageId field)

**Expected:** 0 rows processed, 6 validation errors
**Status:** failed
**Snapshot:** `pilot-replies-errors.expected.json`

## Rule IDs

The fixtures test the following deterministic rule IDs:

| Rule ID | Description | Tested By |
|---------|-------------|-----------|
| `UNKNOWN_RECIPIENT` | Recipient handle not found in pilot artifacts | pilot-replies-unknown-recipient.ndjson, pilot-replies-errors.ndjson |
| `DUPLICATE_MESSAGE_ID` | Message ID already exists in batch or event history | pilot-replies-duplicates.ndjson, pilot-replies-duplicate-existing.ndjson |
| `INVALID_DECISION_STATE` | Decision value is not a valid DecisionState enum | pilot-replies-invalid-decision.ndjson, pilot-replies-errors.ndjson |
| `INVALID_CHANNEL` | Channel value is not a valid Channel enum | pilot-replies-errors.ndjson |
| `INVALID_TIMESTAMP` | Timestamp cannot be parsed | (future fixture) |
| `INVALID_OBJECTION` | Objection value is not a valid ObjectionType | (future fixture) |
| `MISSING_MESSAGE_ID` | Required messageId field is missing | pilot-replies-errors.ndjson |
| `MISSING_RECIPIENT` | Required recipientHandle field is missing | (future fixture) |
| `MISSING_TIMESTAMP` | Required timestamp field is missing | (future fixture) |
| `MISSING_WORKFLOW_SENTENCE` | Required workflowSentence field is missing | (future fixture) |
| `MALFORMED_ROW` | Row cannot be parsed as valid JSON | pilot-replies-errors.ndjson |

## Usage

Run the pilot:ingest-replies command against any fixture:

```bash
# Happy path
bun run tools/pilot-ingest-replies.ts \
  --input tests/tools/fixtures/pilot-replies.ndjson \
  --responses tests/tools/fixtures/pilot-ingest-replies-base.responses.md \
  --events tests/tools/fixtures/pilot-ingest-replies-base.events.md \
  --format json

# Duplicate detection against existing events
bun run tools/pilot-ingest-replies.ts \
  --input tests/tools/fixtures/pilot-replies-duplicate-existing.ndjson \
  --responses tests/tools/fixtures/pilot-ingest-replies-base.responses.md \
  --events tests/tools/fixtures/pilot-replies-existing-events.events.md \
  --format json
```

## Verification

Each fixture has a corresponding `.expected.json` snapshot file that captures the expected command output. Tests should compare actual output against these snapshots to ensure deterministic behavior.

## Acceptance Criteria

✅ Happy path fixture processes all valid rows successfully
✅ Duplicate replay fixtures suppress duplicate message IDs deterministically
✅ Unknown recipient fixture emits UNKNOWN_RECIPIENT errors
✅ Invalid decision state fixture emits INVALID_DECISION_STATE errors
✅ Malformed row fixture emits MALFORMED_ROW and other validation errors
✅ All fixtures have corresponding expected JSON snapshots
✅ Command output is deterministic across reruns
