---
artifact: pilot-response-log
author: Test
created_at: 2026-03-01
batch: test-row-timestamp-drift
---

# Pilot Response Log - Row Timestamp Drift Test

This response-log has INTENTIONALLY WRONG timestamps to trigger ROW_TIMESTAMP_DRIFT errors.

| Recipient | Source Channel | Workflow Sentence | Objection Type | WTP ($/mo) | Next-Step Decision | Decision Rationale | Response State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `drift_user` | X DM | no response yet | no response yet | no response yet | pending | Outreach sent/followed up 2026-02-28T10:00:00Z; awaiting first reply in CTA format. | no response yet |
| `drift_user2` | Discord DM | Looking for automation tools | no response yet | no response yet | pending | Reply received at 2026-02-28T15:30:00Z; awaiting decision. | replied |
