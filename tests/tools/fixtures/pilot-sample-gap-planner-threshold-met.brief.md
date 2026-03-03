---
author: Builder
date: 2026-03-01
status: Draft
---

# OFFER_BRIEF (Test Fixture - Threshold-Met Scenario)

## Test Context
This is a minimal OFFER_BRIEF fixture for testing the pilot-sample-gap-planner tool.
It defines thresholds that ARE met by the corresponding run-sheet/responses fixtures.

## Pricing Hypothesis
- **Initial pilot price point**: $12/mo
- **Test range**: $8-$19/mo
- **Validation signal**: In first 5 qualified pilot conversations, **>=2 explicit "yes" commitments**

## Pilot CTA
**Exact ask:**
> Reply with: `PILOT YES - <your workflow in 1 sentence> - <price you'd pay in $/mo from $8-$19>`

**Success signal for this CTA:**
- First outreach batch (5 qualified ICP contacts) yields **>=2 correctly formatted `PILOT YES` replies**.
