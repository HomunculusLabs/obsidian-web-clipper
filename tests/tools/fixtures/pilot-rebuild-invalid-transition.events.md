---
artifact: pilot-event-log
author: Test
created_at: 2026-03-01
batch: test-invalid-transition
depends_on:
  - TP005
scope:
  - transition-validation
  - invalid-lifecycle-movement
---

# Pilot Event Log - Invalid Transition Test

Test fixture for validating INVALID_TRANSITION error emission.

## Events

| Event ID | Event Type | Recipient Handle | Event Timestamp | Payload |
| --- | --- | --- | --- | --- |
| `SEND_OUTREACH-test_user-0001` | SEND_OUTREACH | test_user | 2026-02-27T10:00:00Z | {"channel":"X DM","artifactLink":"./test.md","immediateOutcome":"no response yet"} |
| `RECEIVE_REPLY-test_user-0001` | RECEIVE_REPLY | test_user | 2026-02-27T11:00:00Z | {"channel":"X DM","workflowSentence":"Interested in learning more","replyTimestamp":"2026-02-27T11:00:00Z"} |
| `SEND_FOLLOWUP-test_user-0001` | SEND_FOLLOWUP | test_user | 2026-02-27T12:00:00Z | {"channel":"X DM","artifactLink":"./test.md","immediateOutcome":"no response yet"} |
