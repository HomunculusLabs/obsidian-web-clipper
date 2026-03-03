---
artifact: pilot-response-log
author: Test Fixture
created_at: 2026-03-01
updated_at: 2026-03-01
batch: test-pilot-2026-03
source_rubric: OFFER_BRIEF.md#pilot-response-logging-template
---

# Pilot Response Log (Out of Range WTP Fixture)

Test fixture with WTP values outside the allowed $8-$19 range to trigger WTP_OUT_OF_RANGE error.

## Recipient Entries

| Recipient | Source Channel | Workflow Sentence | Objection Type | WTP ($/mo) | Next-Step Decision | Decision Rationale | Response State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `alpha_test` | X DM | `I need a web clipper for Obsidian to save tweets and articles` | `workflow-fit` | `12` | `advance` | User clearly needs the feature, WTP matches anchor price | `PILOT YES` |
| `bravo_test` | Discord DM | `I want to clip blog posts and organize them in my vault` | `price` | `5` | `nurture` | Interested but budget constrained, price too low | `PILOT NO` |
| `charlie_test` | Email | `Need to clip screenshots from Twitter threads` | `trust` | `25` | `advance` | Very interested but WTP above test range | `PILOT YES` |
| `delta_test` | X DM | `Looking for a browser extension for quick clipping` | `workflow-fit` | `7` | `nurture` | Feature fit but price below acceptable range | `PILOT NO` |
| `echo_test` | Discord DM | `Want to clip YouTube videos and save transcripts` | `missing-feature` | `20` | `advance` | WTP is at upper edge of test range | `PILOT YES` |
| `foxtrot_test` | Email | `I need to clip research papers for my PhD` | `none` | `30` | `nurture` | Excellent product but expecting enterprise pricing | `PILOT NO` |
