---
artifact: pilot-run-sheet
author: Builder
created_at: 2026-03-01
batch: test-cta-batch
---

# Test Run Sheet with CTA Variants

| Recipient Handle | Channel | Send Status | Sent Timestamp (ISO-8601) | Artifact Link | CTA Variant |
| --- | --- | --- | --- | --- | --- |
| `test_alpha` | X DM | sent | 2026-02-27T10:00:00Z | [demo.md](./demo.md) | CTA-A |
| `test_bravo` | X DM | sent | 2026-02-27T11:00:00Z | [demo.md](./demo.md) | CTA-B |
| `test_charlie` | Discord DM | sent | 2026-02-27T12:00:00Z | [demo.md](./demo.md) | CTA-A |
| `test_delta` | Discord DM | sent | 2026-02-27T13:00:00Z | [demo.md](./demo.md) | CTA-B |

## Send Outcome Log
- 2026-02-27T10:00:00Z — `test_alpha` — **sent** via X DM using CTA-A; immediate outcome: `no response yet`.
- 2026-02-27T11:00:00Z — `test_bravo` — **sent** via X DM using CTA-B; immediate outcome: `no response yet`.
- 2026-02-27T12:00:00Z — `test_charlie` — **sent** via Discord DM using CTA-A; immediate outcome: `no response yet`.
- 2026-02-27T13:00:00Z — `test_delta` — **sent** via Discord DM using CTA-B; immediate outcome: `no response yet`.
