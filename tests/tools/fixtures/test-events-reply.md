---
artifact: pilot-event-log
author: Test
created_at: 2026-03-01
batch: test-batch
---

# Test Event Log

| Event ID | Event Type | Recipient Handle | Event Timestamp | Payload |
| --- | --- | --- | --- | --- |
| `SEND_OUTREACH-test_user-0001` | SEND_OUTREACH | test_user | 2026-02-28T12:00:00Z | {"channel":"X DM","artifactLink":"./test.md","immediateOutcome":"no response yet"} |
| `RECEIVE_REPLY-test_user-0001` | RECEIVE_REPLY | test_user | 2026-02-28T14:00:00Z | {"channel":"X DM","workflowSentence":"I need help with workflow automation","replyTimestamp":"2026-02-28T14:00:00Z"} |
| `UPDATE_DECISION-test_user-0001` | UPDATE_DECISION | test_user | 2026-02-28T15:00:00Z | {"decision":"advance","rationale":"Strong fit for automation use case"} |
| `UPDATE_WTP-test_user-0001` | UPDATE_WTP | test_user | 2026-02-28T15:30:00Z | {"wtp":20,"source":"explicit"} |
| `UPDATE_OBJECTION-test_user-0001` | UPDATE_OBJECTION | test_user | 2026-02-28T16:00:00Z | {"objectionType":"workflow-fit","notes":"Concerned about integration complexity"} |
