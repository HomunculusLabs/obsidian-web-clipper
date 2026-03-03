---
artifact: pilot-consistency-qa
author: Builder
created_at: 2026-02-27
batch: first-pilot-2026-02
depends_on:
  - TP012
checks:
  - outreach-copy-vs-offer-cta
  - recipient-count-exactly-3
  - send-timestamps-present
---

# Pilot Consistency QA (TP013)

## Scope
- Validate outreach copy uses the exact CTA from `OFFER_BRIEF.md`.
- Validate run sheet recipient count is exactly 3.
- Validate all run sheet send rows include ISO-8601 send timestamps.

## Evidence
- `offer_cta_matches=1`
- `outreach_cta_matches=1`
- `recipient_rows=3`
- `rows_missing_iso_timestamp=0`

## Command
```bash
cd /Users/t3rpz/projects/obsidian-web-clipper && cta='Reply with: `PILOT YES - <your Obsidian workflow in 1 sentence> - <price you'"'"'d pay in $/mo from $8-$19>` if you'"'"'re willing to run a 14-day pilot and give structured feedback.' && echo "offer_cta_matches=$(grep -F "$cta" OFFER_BRIEF.md | wc -l | tr -d ' ')" && echo "outreach_cta_matches=$(grep -F "$cta" docs/distribution/first-pilot-2026-02/pilot-outreach-message.md | wc -l | tr -d ' ')" && echo "recipient_rows=$(grep -E '^\| `pilot_' docs/distribution/first-pilot-2026-02/pilot-run-sheet.md | wc -l | tr -d ' ')" && echo "rows_missing_iso_timestamp=$(grep -E '^\| `pilot_' docs/distribution/first-pilot-2026-02/pilot-run-sheet.md | grep -vcE '\| [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z \|' )"
```

## Result
✅ **PASS** — Outreach CTA is consistent with `OFFER_BRIEF.md`, recipient count is exactly 3, and all send rows include timestamps.
