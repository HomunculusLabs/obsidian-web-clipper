---
artifact: pilot-event-log
author: Test
created_at: 2026-03-01
batch: test-missing-event
depends_on:
  - TP007
scope:
  - drift-detection
  - missing-event-validation
---

# Pilot Event Log - Missing Event Test

Test fixture for validating MISSING_EVENT error emission.

This event log is MISSING events for `ghost_user` who appears in the run-sheet/response-log.

## Events

| Event ID | Event Type | Recipient Handle | Event Timestamp | Payload |
| --- | --- | --- | --- | --- |
| `SEND_OUTREACH-real_user-0001` | SEND_OUTREACH | real_user | 2026-02-27T10:00:00Z | {"channel":"X DM","artifactLink":"./test.md","immediateOutcome":"no response yet"} |
