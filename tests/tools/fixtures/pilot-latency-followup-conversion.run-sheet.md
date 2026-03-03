---
artifact: pilot-run-sheet
author: Builder
created_at: 2026-03-01
batch: test-followup-conversion-batch
---

# Test Run Sheet - Follow-up Conversion Scenario

Recipients with follow-up attempts and conversions.

| Recipient Handle | Channel | Send Status | Sent Timestamp (ISO-8601) | Artifact Link |
| --- | --- | --- | --- | --- |
| `follow_alpha` | X DM | sent | 2026-02-26T10:00:00Z | [demo.md](./demo.md) |
| `follow_bravo` | X DM | sent | 2026-02-26T11:00:00Z | [demo.md](./demo.md) |
| `follow_charlie` | Discord DM | sent | 2026-02-26T12:00:00Z | [demo.md](./demo.md) |
| `follow_delta` | Discord DM | sent | 2026-02-26T13:00:00Z | [demo.md](./demo.md) |

## Send Outcome Log
- 2026-02-26T10:00:00Z — `follow_alpha` — **sent** via X DM; immediate outcome: `no response yet`.
- 2026-02-26T11:00:00Z — `follow_bravo` — **sent** via X DM; immediate outcome: `no response yet`.
- 2026-02-26T12:00:00Z — `follow_charlie` — **sent** via Discord DM; immediate outcome: `no response yet`.
- 2026-02-26T13:00:00Z — `follow_delta` — **sent** via Discord DM; immediate outcome: `no response yet`.
- 2026-02-27T10:00:00Z — `follow_alpha` — **sent** (follow-up #1) via X DM; immediate outcome: `replied`.
- 2026-02-27T11:00:00Z — `follow_bravo` — **sent** (follow-up #1) via X DM; immediate outcome: `no response yet`.
- 2026-02-27T12:00:00Z — `follow_charlie` — **sent** (follow-up #1) via Discord DM; immediate outcome: `replied`.
- 2026-02-27T13:00:00Z — `follow_delta` — **sent** (follow-up #1) via Discord DM; immediate outcome: `no response yet`.
