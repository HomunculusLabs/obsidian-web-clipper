---
artifact: pilot-run-sheet
author: Builder
created_at: 2026-03-01
batch: test-threshold-met-batch
---

# Test Run Sheet - Threshold-Met Scenario

This run sheet has 6 sent messages, which meets/exceeds the minSent=5 threshold
defined in the corresponding brief fixture.

| Recipient Handle | Channel | Send Status | Sent Timestamp (ISO-8601) | Artifact Link |
| --- | --- | --- | --- | --- |
| `met_alpha` | X DM | sent | 2026-03-01T10:00:00Z | [demo.md](./demo.md) |
| `met_bravo` | X DM | sent | 2026-03-01T11:00:00Z | [demo.md](./demo.md) |
| `met_charlie` | Discord DM | sent | 2026-03-01T12:00:00Z | [demo.md](./demo.md) |
| `met_delta` | Discord DM | sent | 2026-03-01T13:00:00Z | [demo.md](./demo.md) |
| `met_echo` | Email | sent | 2026-03-01T14:00:00Z | [demo.md](./demo.md) |
| `met_foxtrot` | Email | sent | 2026-03-01T15:00:00Z | [demo.md](./demo.md) |

## Send Outcome Log
- 2026-03-01T10:00:00Z — `met_alpha` — **sent** via X DM; immediate outcome: `no response yet`.
- 2026-03-01T11:00:00Z — `met_bravo` — **sent** via X DM; immediate outcome: `no response yet`.
- 2026-03-01T12:00:00Z — `met_charlie` — **sent** via Discord DM; immediate outcome: `no response yet`.
- 2026-03-01T13:00:00Z — `met_delta` — **sent** via Discord DM; immediate outcome: `no response yet`.
- 2026-03-01T14:00:00Z — `met_echo` — **sent** via Email; immediate outcome: `no response yet`.
- 2026-03-01T15:00:00Z — `met_foxtrot` — **sent** via Email; immediate outcome: `no response yet`.
