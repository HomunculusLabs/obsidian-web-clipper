---
artifact: pilot-response-log
author: Test
created_at: 2026-03-01
batch: test-batch-duplicate-proof-rows
---

# Pilot Response Log (Test Fixture - Duplicate Proof Rows)

This fixture tests the edge case where the proof index contains duplicate messageIds.
The response log has valid rows, but the evidence file has duplicate messageIds.

| Recipient | Source Channel | Workflow Sentence | Objection Type | WTP ($/mo) | Next-Step Decision | Decision Rationale | Response State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dup_alpha` | X DM | `I need to clip research papers` | `trust` | `10` | `advance` | Ready to proceed with beta access. | `responded 2026-02-28` |
| `dup_bravo` | Discord DM | `Workflow looks good` | `none` | `15` | `nurture` | Interested but needs time. | `responded 2026-02-27` |
| `dup_charlie` | Email | `no response yet` | `no response yet` | `no response yet` | `pending` | Outreach sent; awaiting reply. | `no response yet` |
