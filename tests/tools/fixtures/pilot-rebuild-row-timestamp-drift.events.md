---
artifact: pilot-event-log
author: Test
created_at: 2026-03-01
batch: test-row-timestamp-drift
depends_on:
  - TP007
scope:
  - drift-detection
  - timestamp-validation
---

# Pilot Event Log - Row Timestamp Drift Test

Test fixture for validating ROW_TIMESTAMP_DRIFT error emission.

## Events

| Event ID | Event Type | Recipient Handle | Event Timestamp | Payload |
| --- | --- | --- | --- | --- |
| `SEND_OUTREACH-drift_user-0001` | SEND_OUTREACH | drift_user | 2026-02-27T10:00:00Z | {"channel":"X DM","artifactLink":"./test.md","ctaVariant":"CTA-A","immediateOutcome":"no response yet"} |
| `SEND_FOLLOWUP-drift_user-0001` | SEND_FOLLOWUP | drift_user | 2026-02-28T10:00:00Z | {"channel":"X DM","artifactLink":"./test.md","ctaVariant":"CTA-A","immediateOutcome":"no response yet"} |
| `SEND_OUTREACH-drift_user2-0001` | SEND_OUTREACH | drift_user2 | 2026-02-27T11:00:00Z | {"channel":"Discord DM","artifactLink":"./test.md","immediateOutcome":"no response yet"} |
| `RECEIVE_REPLY-drift_user2-0001` | RECEIVE_REPLY | drift_user2 | 2026-02-28T14:30:00Z | {"channel":"Discord DM","workflowSentence":"Looking for automation tools","replyTimestamp":"2026-02-28T14:30:00Z"} |
