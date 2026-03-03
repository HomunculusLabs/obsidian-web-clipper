---
artifact: pilot-run-sheet
author: Builder
created_at: 2026-03-01
batch: test-under-threshold-batch
---

# Test Run Sheet - Under-Threshold Scenario

This run sheet has 6 sent messages, which is below the minSent=10 threshold
defined in the corresponding brief fixture.

| Recipient Handle | Channel | Send Status | Sent Timestamp (ISO-8601) | Artifact Link |
| --- | --- | --- | --- | --- |
| `under_alpha` | X DM | sent | 2026-03-01T10:00:00Z | [demo.md](./demo.md) |
| `under_bravo` | X DM | sent | 2026-03-01T11:00:00Z | [demo.md](./demo.md) |
| `under_charlie` | Discord DM | sent | 2026-03-01T12:00:00Z | [demo.md](./demo.md) |
| `under_delta` | Discord DM | sent | 2026-03-01T13:00:00Z | [demo.md](./demo.md) |
| `under_echo` | Email | sent | 2026-03-01T14:00:00Z | [demo.md](./demo.md) |
| `under_foxtrot` | Email | sent | 2026-03-01T15:00:00Z | [demo.md](./demo.md) |

## Send Outcome Log
- 2026-03-01T10:00:00Z — `under_alpha` — **sent** via X DM; immediate outcome: `no response yet`.
- 2026-03-01T11:00:00Z — `under_bravo` — **sent** via X DM; immediate outcome: `no response yet`.
- 2026-03-01T12:00:00Z — `under_charlie` — **sent** via Discord DM; immediate outcome: `no response yet`.
- 2026-03-01T13:00:00Z — `under_delta` — **sent** via Discord DM; immediate outcome: `no response yet`.
- 2026-03-01T14:00:00Z — `under_echo` — **sent** via Email; immediate outcome: `no response yet`.
- 2026-03-01T15:00:00Z — `under_foxtrot` — **sent** via Email; immediate outcome: `no response yet`.
