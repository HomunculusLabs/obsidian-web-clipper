#!/usr/bin/env bash
#
# Inner loop for tmux-based Ralph — runs pi with full TUI.
# Called by ralph-tmux.sh inside the main tmux pane.
#

set -euo pipefail

PROJECT_DIR="/Users/t3rpz/projects/Obsidian-web-clipper"
SENTINEL_DIR="$PROJECT_DIR/logs/ralph/sentinels"
PI_PROVIDER="${PI_PROVIDER:-zai}"
PI_MODEL="${PI_MODEL:-glm-5}"
MAX_ITERATIONS="${MAX_ITERATIONS:-100}"
COOLDOWN="${COOLDOWN:-5}"

mkdir -p "$SENTINEL_DIR" 2>/dev/null || true

RALPH_PROMPT='You are executing ONE iteration of the Ralph loop.

Read AGENTS.md for the full loop contract, then:

1. Read IMPLEMENTATION_PLAN.md and find the FIRST unchecked `- [ ]` task.
2. Implement ONLY that one task.
3. Create new tasks if you discover bugs/gaps (add as `- [ ]` in IMPLEMENTATION_PLAN.md).
4. Run checks: bun run build && bun run typecheck (and bun test if tests exist).
5. git add -A && git commit.
6. Mark the task `[x]` in IMPLEMENTATION_PLAN.md and commit that too.
7. Output RALPH_COMPLETE: <task> (and RALPH_TASKS_ADDED: N if applicable).

8. As your FINAL action, run this bash command to signal you are done:
   touch logs/ralph/sentinels/done

Then WAIT. The loop driver will handle exiting and starting the next iteration.'

cd "$PROJECT_DIR"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     RALPH LOOP — INTERACTIVE TUI         ║"
echo "║     Provider: $PI_PROVIDER / $PI_MODEL"
echo "║     Max iterations: $MAX_ITERATIONS                ║"
echo "║     Cooldown: ${COOLDOWN}s between tasks           ║"
echo "╚══════════════════════════════════════════╝"
echo ""

for iter in $(seq 1 "$MAX_ITERATIONS"); do
  echo ""
  echo "══════════════════════════════════════════════════════════"
  echo "  RALPH ITERATION #${iter}  —  $(date '+%H:%M:%S')"
  echo "══════════════════════════════════════════════════════════"
  echo ""

  # Check if there are tasks remaining
  if ! grep -q '\- \[ \]' "$PROJECT_DIR/IMPLEMENTATION_PLAN.md"; then
    echo "🎉 ALL TASKS COMPLETE!"
    break
  fi

  # Clean sentinel
  rm -f "$SENTINEL_DIR/done"

  # Run pi with full TUI
  pi \
    --provider "$PI_PROVIDER" \
    --model "$PI_MODEL" \
    --no-session \
    "$RALPH_PROMPT"

  echo ""
  echo "⏳ Next iteration in ${COOLDOWN}s..."
  sleep "$COOLDOWN"
done

echo ""
echo "═══ Ralph loop finished at $(date '+%H:%M:%S') ═══"
