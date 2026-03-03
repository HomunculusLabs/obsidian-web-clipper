---
artifact: pilot-run-sheet
author: Test
created_at: 2026-03-01
batch: test-row-timestamp-drift
---

# Pilot Run Sheet - Row Timestamp Drift Test

This run-sheet has INTENTIONALLY WRONG timestamps to trigger ROW_TIMESTAMP_DRIFT errors.

| Recipient Handle | Channel | Send Status | Sent Timestamp | Artifact Link | Follow-Up Timestamp |
| --- | --- | --- | --- | --- | --- |
| `drift_user` | X DM | sent | 2026-02-27T09:00:00Z | ./test.md | 2026-02-28T11:00:00Z |
| `drift_user2` | Discord DM | sent | 2026-02-27T12:00:00Z | ./test.md | |
