---
artifact: pilot-run-sheet
author: Builder
created_at: 2026-03-01
batch: test-mixed-reply-batch
---

# Test Run Sheet - Mixed Reply Scenario

Mix of replied and non-replied recipients with varying latency.

| Recipient Handle | Channel | Send Status | Sent Timestamp (ISO-8601) | Artifact Link |
| --- | --- | --- | --- | --- |
| `mixed_alpha` | X DM | sent | 2026-02-25T10:00:00Z | [demo.md](./demo.md) |
| `mixed_bravo` | X DM | sent | 2026-02-25T11:00:00Z | [demo.md](./demo.md) |
| `mixed_charlie` | Discord DM | sent | 2026-02-25T12:00:00Z | [demo.md](./demo.md) |
| `mixed_delta` | Discord DM | sent | 2026-02-25T13:00:00Z | [demo.md](./demo.md) |
| `mixed_echo` | Email | sent | 2026-02-25T14:00:00Z | [demo.md](./demo.md) |
| `mixed_foxtrot` | Email | sent | 2026-02-25T15:00:00Z | [demo.md](./demo.md) |

## Send Outcome Log
- 2026-02-25T10:00:00Z — `mixed_alpha` — **sent** via X DM; immediate outcome: `no response yet`.
- 2026-02-25T11:00:00Z — `mixed_bravo` — **sent** via X DM; immediate outcome: `no response yet`.
- 2026-02-25T12:00:00Z — `mixed_charlie` — **sent** via Discord DM; immediate outcome: `no response yet`.
- 2026-02-25T13:00:00Z — `mixed_delta` — **sent** via Discord DM; immediate outcome: `no response yet`.
- 2026-02-25T14:00:00Z — `mixed_echo` — **sent** via Email; immediate outcome: `no response yet`.
- 2026-02-25T15:00:00Z — `mixed_foxtrot` — **sent** via Email; immediate outcome: `no response yet`.
