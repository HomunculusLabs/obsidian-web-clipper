---
artifact: pilot-response-log
author: Test Fixture
created_at: 2026-03-01
updated_at: 2026-03-01
batch: test-pilot-2026-02
source_rubric: OFFER_BRIEF.md#pilot-response-logging-template
---

# Pilot Response Log (Missing WTP Value Fixture)

Test fixture with missing WTP values to trigger MISSING_WTP_VALUE error.

## Recipient Entries

| Recipient | Source Channel | Workflow Sentence | Objection Type | WTP ($/mo) | Next-Step Decision | Decision Rationale | Response State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `alpha_test` | X DM | `I need a web clipper for Obsidian to save tweets and articles` | `workflow-fit` | `12` | `advance` | User clearly needs the feature, WTP matches anchor price | `PILOT YES` |
| `bravo_test` | Discord DM | `I want to clip blog posts and organize them in my vault` | `price` | `` | `nurture` | Interested but forgot to specify price | `PILOT NO` |
| `charlie_test` | Email | `Need to clip screenshots from Twitter threads` | `trust` | `no response yet` | `pending` | Outreach sent; awaiting reply. | `no response yet` |
| `delta_test` | X DM | `Looking for a browser extension for quick clipping` | `workflow-fit` | `10` | `nurture` | Feature fit but price too high for current needs | `PILOT NO` |
| `echo_test` | Discord DM | `Want to clip YouTube videos and save transcripts` | `missing-feature` | `` | `advance` | WTP is high, needs video transcript feature | `PILOT YES` |
