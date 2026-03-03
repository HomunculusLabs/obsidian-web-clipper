---
artifact: pilot-response-log
author: Builder
created_at: 2026-03-01
batch: test-followup-conversion-batch
---

# Test Response Log - Follow-up Conversion Scenario

Recipients who received follow-ups:
- follow_alpha: follow-up sent, converted (advance decision)
- follow_bravo: follow-up sent, no conversion (pending decision)
- follow_charlie: follow-up sent, converted (advance decision)
- follow_delta: follow-up sent, no conversion (pending decision)

| Recipient | Source Channel | Workflow Sentence | Objection Type | WTP ($/mo) | Next-Step Decision | Decision Rationale | Response State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `follow_alpha` | X DM | Follow-up worked! Ready to move forward. | none | 150 | advance | Responded to follow-up; high intent. | replied 2026-02-27T10:30:00Z |
| `follow_bravo` | X DM | `no response yet` | `no response yet` | `no response yet` | `pending` | Follow-up sent 2026-02-27T11:00:00Z; still waiting. | `no response yet` |
| `follow_charlie` | Discord DM | Thanks for following up! Let's schedule a call. | none | 75 | advance | Responded to follow-up; ready to advance. | replied 2026-02-27T12:30:00Z |
| `follow_delta` | Discord DM | `no response yet` | `no response yet` | `no response yet` | `pending` | Follow-up sent 2026-02-27T13:00:00Z; still waiting. | `no response yet` |
