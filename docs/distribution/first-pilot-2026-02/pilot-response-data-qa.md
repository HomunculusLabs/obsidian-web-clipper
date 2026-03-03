---
artifact: pilot-response-data-qa
author: Builder
created_at: 2026-02-27
batch: first-pilot-2026-02
depends_on:
  - TP012
checks:
  - response-log-row-per-recipient
  - decision-state-enum-valid
  - decision-rationale-present
---

# Pilot Response Data QA (TP014)

## Scope
- Validate every recipient in the run sheet has exactly one structured row in `pilot-response-log.md`.
- Validate decision state values are constrained to: `advance|nurture|disqualify|pending`.
- Validate every response-log row includes non-empty decision rationale text.

## Evidence
- `run_sheet_recipient_rows=3`
- `response_log_rows=3`
- `unique_response_recipients=3`
- `missing_response_entries=0`
- `invalid_decision_states=0`
- `rows_missing_rationale=0`

## Command
```bash
cd /Users/t3rpz/projects/obsidian-web-clipper && run_sheet_file='docs/distribution/first-pilot-2026-02/pilot-run-sheet.md' && response_file='docs/distribution/first-pilot-2026-02/pilot-response-log.md' && run_sheet_recipients=$(grep -E '^\| `pilot_' "$run_sheet_file" | sed -E 's/^\| `([^`]+)`.*/\1/' | sort) && response_recipients=$(grep -E '^\| `pilot_' "$response_file" | sed -E 's/^\| `([^`]+)`.*/\1/' | sort) && echo "run_sheet_recipient_rows=$(echo "$run_sheet_recipients" | sed '/^$/d' | wc -l | tr -d ' ')" && echo "response_log_rows=$(grep -E '^\| `pilot_' "$response_file" | wc -l | tr -d ' ')" && echo "unique_response_recipients=$(echo "$response_recipients" | sed '/^$/d' | uniq | wc -l | tr -d ' ')" && echo "missing_response_entries=$(comm -23 <(echo "$run_sheet_recipients") <(echo "$response_recipients") | sed '/^$/d' | wc -l | tr -d ' ')" && echo "invalid_decision_states=$(awk -F'|' '/^\| `pilot_/ {val=$7; gsub(/^[ \t`]+|[ \t`]+$/, "", val); if (val=="advance" || val=="nurture" || val=="disqualify" || val=="pending") ok++; else bad++} END {print bad+0}' "$response_file")" && echo "rows_missing_rationale=$(awk -F'|' '/^\| `pilot_/ {val=$8; gsub(/^[ \t]+|[ \t]+$/, "", val); if (length(val)==0) bad++} END {print bad+0}' "$response_file")"
```

## Result
✅ **PASS** — Each of the 3 recipients has exactly one structured response-log row, all decision states are valid enum values, and all rows include rationale.
