---
artifact: pilot-event-log
author: Test
created_at: 2026-03-01
batch: test-batch
---

# Test Event Log - Reply Before Send (Invalid)

| Event ID | Event Type | Recipient Handle | Event Timestamp | Payload |
| --- | --- | --- | --- | --- |
| `SEND_OUTREACH-test_user-0001` | SEND_OUTREACH | test_user | 2026-02-28T14:00:00Z | {"channel":"X DM","artifactLink":"./test.md","immediateOutcome":"no response yet"} |
| `RECEIVE_REPLY-test_user-0001` | RECEIVE_REPLY | test_user | 2026-02-28T12:00:00Z | {"channel":"X DM","workflowSentence":"Reply before send","replyTimestamp":"2026-02-28T12:00:00Z"} |
