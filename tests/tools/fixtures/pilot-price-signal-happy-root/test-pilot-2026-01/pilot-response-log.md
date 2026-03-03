---
artifact: pilot-response-log
author: Test Fixture
created_at: 2026-03-01
updated_at: 2026-03-01
batch: test-pilot-2026-01
source_rubric: OFFER_BRIEF.md#pilot-response-logging-template
---

# Pilot Response Log (Happy Path Fixture)

Test fixture with valid responses covering all price buckets.

## Recipient Entries

| Recipient | Source Channel | Workflow Sentence | Objection Type | WTP ($/mo) | Next-Step Decision | Decision Rationale | Response State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `alpha_test` | X DM | `I need a web clipper for Obsidian to save tweets and articles` | `workflow-fit` | `12` | `advance` | User clearly needs the feature, WTP matches anchor price | `PILOT YES` |
| `bravo_test` | Discord DM | `I want to clip blog posts and organize them in my vault` | `price` | `8` | `nurture` | Interested but budget constrained, lower price point preferred | `PILOT NO` |
| `charlie_test` | Email | `Need to clip screenshots from Twitter threads` | `trust` | `15` | `advance` | High WTP, interested in advanced screenshot features | `PILOT YES` |
| `delta_test` | X DM | `Looking for a browser extension for quick clipping` | `workflow-fit` | `$10` | `nurture` | Feature fit but price too high for current needs | `PILOT NO` |
| `echo_test` | Discord DM | `Want to clip YouTube videos and save transcripts` | `missing-feature` | `18` | `advance` | WTP is high, needs video transcript feature | `PILOT YES` |
| `foxtrot_test` | Email | `I need to clip research papers for my PhD` | `none` | `11` | `advance` | Feature set is perfect for academic workflow | `PILOT YES` |
| `golf_test` | X DM | `Building a personal knowledge base with blog posts` | `workflow-fit` | `13` | `nurture` | Like the tool but waiting for more features | `PILOT NO` |
| `hotel_test` | Discord DM | `Organizing my DevRel content into Obsidian` | `trust` | `$16` | `advance` | Professional tooling worth the investment | `PILOT YES` |
| `india_test` | Email | `Clipping developer documentation for reference` | `none` | `17` | `nurture` | Good product but exploring alternatives | `PILOT NO` |
| `juliet_test` | X DM | `Capturing startup content for my newsletter` | `workflow-fit` | `19` | `advance` | Perfect fit for content curation workflow | `PILOT YES` |
