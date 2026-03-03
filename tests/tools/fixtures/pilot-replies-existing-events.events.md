---
artifact: pilot-event-log
author: Test
created_at: 2026-02-20
batch: test-batch
---

# Pilot Event Log (Test Fixture with Existing Replies)

## Events

| Event ID | Event Type | Recipient Handle | Event Timestamp | Payload |
| --- | --- | --- | --- | --- |
| `SEND_OUTREACH-pilot_alpha-0001` | SEND_OUTREACH | pilot_alpha | 2026-02-19T10:00:00Z | {"channel":"X DM","artifactLink":"./test.md","immediateOutcome":"no response yet"} |
| `SEND_OUTREACH-pilot_bravo-0001` | SEND_OUTREACH | pilot_bravo | 2026-02-19T11:00:00Z | {"channel":"Discord DM","artifactLink":"./test.md","immediateOutcome":"no response yet"} |
| `SEND_OUTREACH-pilot_charlie-0001` | SEND_OUTREACH | pilot_charlie | 2026-02-19T12:00:00Z | {"channel":"Email","artifactLink":"./test.md","immediateOutcome":"no response yet"} |
| `RECEIVE_REPLY-pilot_alpha-0001` | RECEIVE_REPLY | pilot_alpha | 2026-02-20T10:00:00Z | {"messageId":"existing-msg-001","channel":"X DM","workflowSentence":"Existing reply from alpha"} |
| `RECEIVE_REPLY-pilot_bravo-0001` | RECEIVE_REPLY | pilot_bravo | 2026-02-20T11:00:00Z | {"messageId":"existing-msg-002","channel":"Discord DM","workflowSentence":"Existing reply from bravo"} |
