---
artifact: pilot-response-log
author: Builder
created_at: 2026-03-01
batch: test-under-threshold-batch
---

# Test Response Log - Under-Threshold Scenario

This response log has 2 replies, which is below the minReplies=3 threshold
defined in the corresponding brief fixture.

Current state:
- Total sent: 6 (below threshold of 10)
- Total replied: 2 (below threshold of 3)
- Pending: 4
- Cold-aged: 0 (all sent within last 24 hours)

| Recipient | Source Channel | Workflow Sentence | Objection Type | WTP ($/mo) | Next-Step Decision | Decision Rationale | Response State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `under_alpha` | X DM | Interested in learning more. | none | 15 | advance | Strong interest signal. | replied 2026-03-01T12:00:00Z |
| `under_bravo` | X DM | `no response yet` | `no response yet` | `no response yet` | `pending` | Outreach sent 2026-03-01T11:00:00Z; awaiting first reply. | `no response yet` |
| `under_charlie` | Discord DM | What's the pricing? | pricing | 12 | advance | Pricing question indicates intent. | replied 2026-03-01T14:00:00Z |
| `under_delta` | Discord DM | `no response yet` | `no response yet` | `no response yet` | `pending` | Outreach sent 2026-03-01T13:00:00Z; awaiting first reply. | `no response yet` |
| `under_echo` | Email | `no response yet` | `no response yet` | `no response yet` | `pending` | Outreach sent 2026-03-01T14:00:00Z; awaiting first reply. | `no response yet` |
| `under_foxtrot` | Email | `no response yet` | `no response yet` | `no response yet` | `pending` | Outreach sent 2026-03-01T15:00:00Z; awaiting first reply. | `no response yet` |
