---
artifact: pilot-response-log
author: Test
created_at: 2026-03-01
batch: test-batch-duplicate-binding
---

# Pilot Response Log (Test Fixture - One-to-One Binding)

| Recipient | Source Channel | Workflow Sentence | Objection Type | WTP ($/mo) | Next-Step Decision | Decision Rationale | Response State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `test_alpha` | X DM | `I need to clip research papers` | `trust` | `10` | `advance` | Ready to proceed with beta access. | `responded 2026-02-28` |
| `test_alpha` | X DM | `Follow-up response` | `none` | `12` | `nurture` | Second response from same recipient. | `responded 2026-02-28` |
| `test_charlie` | Email | `no response yet` | `no response yet` | `no response yet` | `pending` | Outreach sent; awaiting reply. | `no response yet` |
