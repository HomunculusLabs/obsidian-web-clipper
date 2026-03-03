---
artifact: pilot-run-sheet
author: Builder
created_at: 2026-02-27
batch: first-pilot-2026-02
depends_on:
  - TP001
  - TP007
artifacts:
  outreach_template: docs/distribution/first-pilot-2026-02/pilot-outreach-message.md
  demo_clip: docs/distribution/first-pilot-2026-02/seedfinder-demo-clip.md
---

# Pilot Distribution Run Sheet

This run sheet is the send-tracking source of truth for TP009–TP011.

| Recipient Handle | Channel | Send Status | Sent Timestamp (ISO-8601) | Artifact Link | Follow-Up Timestamp |
| --- | --- | --- | --- | --- | --- |
| `pilot_alpha` | X DM | sent | 2026-02-27T18:51:34Z | [seedfinder-demo-clip.md](./seedfinder-demo-clip.md) | |
| `pilot_bravo` | Discord DM | sent | 2026-02-27T18:53:10Z | [seedfinder-demo-clip.md](./seedfinder-demo-clip.md) | 2026-02-28T00:08:51Z |
| `pilot_charlie` | Email | sent | 2026-02-27T23:56:14Z | [seedfinder-demo-clip.md](./seedfinder-demo-clip.md) | |

## Notes
- Recipient handles/channels mirror `pilot-user-selection.md`.
- Update one row immediately after each send attempt (including failed/blocked send attempts).
- Keep statuses constrained to: `not sent`, `sent`, `failed`, `blocked`.

## Send Outcome Log
- 2026-02-27T18:51:34Z — `pilot_alpha` — **sent** via X DM using the locked CTA from `pilot-outreach-message.md` and demo artifact link `seedfinder-demo-clip.md`; immediate outcome: `no response yet`.
- 2026-02-27T18:53:10Z — `pilot_bravo` — **sent** via Discord DM using the locked CTA from `pilot-outreach-message.md` and demo artifact link `seedfinder-demo-clip.md`; immediate outcome: `no response yet`.
- 2026-02-28T00:08:51Z — `pilot_bravo` — **sent** follow-up via Discord DM using the same locked CTA and demo artifact link `seedfinder-demo-clip.md`; immediate outcome: `no response yet`.
- 2026-02-27T23:56:14Z — `pilot_charlie` — **sent** via Email using the locked CTA from `pilot-outreach-message.md` and demo artifact link `seedfinder-demo-clip.md`; immediate outcome: `no response yet`.
