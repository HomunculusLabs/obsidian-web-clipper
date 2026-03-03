---
artifact: pilot-event-log
author: Test
created_at: 2026-03-01
batch: test-aligned
---

# Pilot Event Log (Test: Aligned Pass)

Simple aligned pass case with no follow-ups, matching current parser capabilities.

| Event ID | Event Type | Recipient Handle | Event Timestamp | Payload |
| --- | --- | --- | --- | --- |
| `SEND_OUTREACH-user_alpha-0001` | SEND_OUTREACH | user_alpha | 2026-02-27T10:00:00Z | {"channel":"X DM","artifactLink":"./clip.md","ctaVariant":"CTA-A","immediateOutcome":"no response yet"} |
| `SEND_OUTREACH-user_bravo-0001` | SEND_OUTREACH | user_bravo | 2026-02-27T11:00:00Z | {"channel":"Discord DM","artifactLink":"./clip.md","ctaVariant":"CTA-B","immediateOutcome":"no response yet"} |
| `MARK_FAILED-user_bravo-0001` | MARK_FAILED | user_bravo | 2026-02-27T12:00:00Z | {"channel":"Discord DM","reason":"Account deleted"} |
| `SEND_OUTREACH-user_charlie-0001` | SEND_OUTREACH | user_charlie | 2026-02-27T13:00:00Z | {"channel":"Email","artifactLink":"./clip.md","immediateOutcome":"no response yet"} |
