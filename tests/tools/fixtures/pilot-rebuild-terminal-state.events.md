---
artifact: pilot-event-log
author: Test
created_at: 2026-03-01
batch: test-terminal-state
depends_on:
  - TP005
scope:
  - transition-validation
  - terminal-state-violation
---

# Pilot Event Log - Terminal State Violation Test

Test fixture for validating INVALID_TRANSITION error for events after terminal state (FAILED/BLOCKED).

## Events

| Event ID | Event Type | Recipient Handle | Event Timestamp | Payload |
| --- | --- | --- | --- | --- |
| `SEND_OUTREACH-test_user-0001` | SEND_OUTREACH | test_user | 2026-02-27T10:00:00Z | {"channel":"X DM","artifactLink":"./test.md","immediateOutcome":"no response yet"} |
| `MARK_FAILED-test_user-0001` | MARK_FAILED | test_user | 2026-02-27T11:00:00Z | {"channel":"X DM","reason":"Account suspended"} |
| `RECEIVE_REPLY-test_user-0001` | RECEIVE_REPLY | test_user | 2026-02-27T12:00:00Z | {"channel":"X DM","workflowSentence":"Actually I'm still interested","replyTimestamp":"2026-02-27T12:00:00Z"} |
