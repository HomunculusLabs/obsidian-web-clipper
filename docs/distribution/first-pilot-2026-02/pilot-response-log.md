---
artifact: pilot-response-log
author: Builder
created_at: 2026-02-27
updated_at: 2026-02-28
batch: first-pilot-2026-02
depends_on:
  - TP009
  - TP010
  - TP011
source_rubric: OFFER_BRIEF.md#pilot-response-logging-template
---

# Pilot Response Log

Structured response log for all 3 recipients in this pilot batch.

## Rubric Snapshot
- **Workflow sentence**: one-sentence clipping/retrieval workflow context from recipient.
- **Objection type**: `trust|price|workflow-fit|missing-feature|timing|other`.
- **WTP**: numeric willingness-to-pay signal in $/mo when provided.
- **Next-step decision**: `advance|nurture|disqualify|pending`.

## Recipient Entries

| Recipient | Source Channel | Workflow Sentence | Objection Type | WTP ($/mo) | Next-Step Decision | Decision Rationale | Response State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pilot_alpha` | X DM | `no response yet` | `no response yet` | `no response yet` | `pending` | Outreach sent 2026-02-27T18:51:34Z; awaiting first reply in CTA format. | `no response yet` |
| `pilot_bravo` | Discord DM | `no response yet` | `no response yet` | `no response yet` | `pending` | Outreach sent/followed up 2026-02-28T00:08:51Z; awaiting first reply in CTA format. | `no response yet` |
| `pilot_charlie` | Email | `no response yet` | `no response yet` | `no response yet` | `pending` | Outreach sent 2026-02-27T23:56:14Z; awaiting first reply in CTA format. | `no response yet` |

## Maintenance Rules
- Keep exactly one active row per recipient for this batch.
- Replace `no response yet` placeholders immediately when a recipient responds.
- When a reply arrives, update all rubric fields and keep decision rationale to 1-2 sentences.
- Decision must remain one of: `advance`, `nurture`, `disqualify`, `pending`.
