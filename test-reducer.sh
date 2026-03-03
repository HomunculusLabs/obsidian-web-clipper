#!/bin/bash
cd /Users/t3rpz/projects/obsidian-web-clipper
bun run tools/pilot-rebuild.ts --events docs/distribution/first-pilot-2026-02/pilot-event-log.md --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md --format json
