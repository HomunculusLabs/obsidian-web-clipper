---
artifact: pilot-event-log
author: Builder
created_at: 2026-03-01
batch: first-pilot-2026-02
depends_on:
  - TP001
  - TP002
scope:
  - event-types
  - immutable-row-key-strategy
  - required-timestamps
  - transition-matrix
---

# Pilot Event Log

Append-only log of all pilot outreach lifecycle events.

## Events

| Event ID | Event Type | Recipient Handle | Event Timestamp | Payload |
| --- | --- | --- | --- | --- |
| `SEND_OUTREACH-pilot_alpha-0001` | SEND_OUTREACH | pilot_alpha | 2026-02-27T18:51:34Z | {"channel":"X DM","artifactLink":"./seedfinder-demo-clip.md","ctaVariant":"CTA-A","immediateOutcome":"no response yet"} |
| `SEND_OUTREACH-pilot_bravo-0001` | SEND_OUTREACH | pilot_bravo | 2026-02-27T18:53:10Z | {"channel":"Discord DM","artifactLink":"./seedfinder-demo-clip.md","ctaVariant":"CTA-A","immediateOutcome":"no response yet"} |
| `SEND_OUTREACH-pilot_charlie-0001` | SEND_OUTREACH | pilot_charlie | 2026-02-27T23:56:14Z | {"channel":"Email","artifactLink":"./seedfinder-demo-clip.md","ctaVariant":"CTA-A","immediateOutcome":"no response yet"} |
| `SEND_FOLLOWUP-pilot_bravo-0001` | SEND_FOLLOWUP | pilot_bravo | 2026-02-28T00:08:51Z | {"channel":"Discord DM","artifactLink":"./seedfinder-demo-clip.md","ctaVariant":"CTA-A","immediateOutcome":"no response yet"} |
