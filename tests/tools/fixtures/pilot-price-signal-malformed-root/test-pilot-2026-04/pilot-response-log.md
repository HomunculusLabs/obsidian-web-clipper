---
artifact: pilot-response-log
author: Test Fixture
created_at: 2026-03-01
updated_at: 2026-03-01
batch: test-pilot-2026-04
source_rubric: OFFER_BRIEF.md#pilot-response-logging-template
---

# Pilot Response Log (Malformed Table Fixture)

Test fixture with invalid WTP values to trigger INVALID_WTP_VALUE error.

## Recipient Entries

| Recipient | Source Channel | Workflow Sentence | Objection Type | WTP ($/mo) | Next-Step Decision | Decision Rationale | Response State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `alpha_test` | X DM | `I need a web clipper for Obsidian` | `workflow-fit` | `not-a-number` | `advance` | Invalid WTP value | `PILOT YES` |
| `bravo_test` | Discord DM | `I want to clip blog posts` | `price` | `abc123` | `nurture` | Malformed numeric value | `PILOT NO` |
| `charlie_test` | Email | `Need a number` | `trust` | `15` | `advance` | Valid WTP | `PILOT YES` |
| `delta_test` | X DM | `N/A value` | `workflow-fit` | `N/A` | `nurture` | Not applicable value | `PILOT NO` |
