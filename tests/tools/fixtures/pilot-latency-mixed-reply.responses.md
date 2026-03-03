---
artifact: pilot-response-log
author: Builder
created_at: 2026-03-01
batch: test-mixed-reply-batch
---

# Test Response Log - Mixed Reply Scenario

Mix of replied and non-replied recipients (all sent 96+ hours ago):
- mixed_alpha: replied after 2 hours
- mixed_bravo: replied after 6 hours
- mixed_charlie: replied after 12 hours
- mixed_delta: no response yet (cold-aged)
- mixed_echo: replied after 48 hours
- mixed_foxtrot: no response yet (cold-aged)

| Recipient | Source Channel | Workflow Sentence | Objection Type | WTP ($/mo) | Next-Step Decision | Decision Rationale | Response State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `mixed_alpha` | X DM | Interested in learning more about the product. | none | 50 | advance | Strong interest signal; schedule demo. | replied 2026-02-25T12:00:00Z |
| `mixed_bravo` | X DM | Can you tell me more about pricing? | pricing | 100 | advance | Pricing question indicates buying intent. | replied 2026-02-25T17:00:00Z |
| `mixed_charlie` | Discord DM | This looks interesting but I need to think about it. | timing | 25 | nurture | Needs time; add to nurture sequence. | replied 2026-02-26T00:00:00Z |
| `mixed_delta` | Discord DM | `no response yet` | `no response yet` | `no response yet` | `pending` | Outreach sent 2026-02-25T13:00:00Z; awaiting first reply. | `no response yet` |
| `mixed_echo` | Email | I've been looking for something like this! | none | 200 | advance | High WTP and strong fit; fast-track. | replied 2026-02-27T14:00:00Z |
| `mixed_foxtrot` | Email | `no response yet` | `no response yet` | `no response yet` | `pending` | Outreach sent 2026-02-25T15:00:00Z; awaiting first reply. | `no response yet` |
