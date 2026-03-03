---
artifact: pilot-run-sheet
author: Builder
created_at: 2026-03-01
batch: test-no-reply-batch
---

# Test Run Sheet - No Reply Scenario

All recipients sent 96+ hours ago with no replies (cold-aged).

| Recipient Handle | Channel | Send Status | Sent Timestamp (ISO-8601) | Artifact Link |
| --- | --- | --- | --- | --- |
| `no_reply_alpha` | X DM | sent | 2026-02-25T10:00:00Z | [demo.md](./demo.md) |
| `no_reply_bravo` | X DM | sent | 2026-02-25T11:00:00Z | [demo.md](./demo.md) |
| `no_reply_charlie` | Discord DM | sent | 2026-02-25T12:00:00Z | [demo.md](./demo.md) |
| `no_reply_delta` | Email | sent | 2026-02-25T13:00:00Z | [demo.md](./demo.md) |

## Send Outcome Log
- 2026-02-25T10:00:00Z — `no_reply_alpha` — **sent** via X DM; immediate outcome: `no response yet`.
- 2026-02-25T11:00:00Z — `no_reply_bravo` — **sent** via X DM; immediate outcome: `no response yet`.
- 2026-02-25T12:00:00Z — `no_reply_charlie` — **sent** via Discord DM; immediate outcome: `no response yet`.
- 2026-02-25T13:00:00Z — `no_reply_delta` — **sent** via Email; immediate outcome: `no response yet`.
