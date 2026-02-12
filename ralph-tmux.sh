#!/usr/bin/env bash
#
# Ralph Loop — Tmux split view with full pi TUI
# Uses the existing .ralph-loop.sh but wraps it in tmux for visibility.
#
# Usage:
#   ./ralph-tmux.sh                   # start with defaults (glm-5)
#   ./ralph-tmux.sh --model glm-4.7   # override model
#   tmux attach -t ralph-clipper      # watch
#   Ctrl+B D                          # detach
#   tmux kill-session -t ralph-clipper # stop
#
# Layout:
#   ┌──────────────────────────────────────────┐
#   │  Pi TUI — full interactive interface     │
#   ├─────────────────────┬────────────────────┤
#   │  Git log + changes  │  Progress tracker  │
#   └─────────────────────┴────────────────────┘

set -euo pipefail

PROJECT_DIR="/Users/t3rpz/projects/Obsidian-web-clipper"
SESSION="ralph-clipper"
SENTINEL_DIR="$PROJECT_DIR/logs/ralph/sentinels"

# Defaults — override with args or env vars
PI_PROVIDER="${RALPH_PROVIDER:-zai}"
PI_MODEL="${RALPH_MODEL:-glm-5}"
MAX_ITERATIONS="${RALPH_MAX_ITERATIONS:-100}"
COOLDOWN="${RALPH_COOLDOWN:-5}"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider) PI_PROVIDER="$2"; shift 2 ;;
    --model) PI_MODEL="$2"; shift 2 ;;
    --max) MAX_ITERATIONS="$2"; shift 2 ;;
    --cooldown) COOLDOWN="$2"; shift 2 ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

mkdir -p "$SENTINEL_DIR" 2>/dev/null || true

# Kill existing session
tmux kill-session -t "$SESSION" 2>/dev/null || true

# Create session — main pane
tmux new-session -d -s "$SESSION" -c "$PROJECT_DIR" -x 220 -y 60

# ─── Bottom-left: git watch ───
tmux split-window -t "$SESSION" -v -p 25 -c "$PROJECT_DIR"
tmux send-keys -t "$SESSION":0.1 'while true; do clear; echo "═══ Recent Commits ═══"; git log --oneline --graph -15 2>/dev/null; echo ""; echo "═══ Working Tree ═══"; git diff --stat 2>/dev/null; git diff --cached --stat 2>/dev/null; sleep 5; done' Enter

# ─── Bottom-right: progress + sentinel watcher ───
tmux split-window -t "$SESSION":0.1 -h -p 50 -c "$PROJECT_DIR"
tmux send-keys -t "$SESSION":0.2 'while true; do
  clear
  DONE=$(grep -c "\\- \\[x\\]" IMPLEMENTATION_PLAN.md 2>/dev/null || echo 0)
  TODO=$(grep -c "\\- \\[ \\]" IMPLEMENTATION_PLAN.md 2>/dev/null || echo 0)
  TOTAL=$((DONE + TODO))
  PCT=0; [ $TOTAL -gt 0 ] && PCT=$((DONE * 100 / TOTAL))
  echo "═══ Task Progress ═══"
  echo "  Done: $DONE / $TOTAL  ($PCT%)"
  BAR_WIDTH=30; FILLED=$((PCT * BAR_WIDTH / 100)); EMPTY=$((BAR_WIDTH - FILLED))
  printf "  ["; printf "%0.s█" $(seq 1 $FILLED 2>/dev/null); printf "%0.s░" $(seq 1 $EMPTY 2>/dev/null); printf "]\n\n"
  echo "═══ Next 5 Tasks ═══"
  grep "\\- \\[ \\]" IMPLEMENTATION_PLAN.md 2>/dev/null | head -5 | sed "s/^/  /"
  echo ""
  echo "═══ Sentinel Watcher ═══"
  if [ -f logs/ralph/sentinels/done ]; then
    echo "  ✅ Agent signaled DONE — sending exit..."
    rm -f logs/ralph/sentinels/done
    sleep 2
    tmux send-keys -t ralph-clipper:0.0 C-d
    sleep 3
  else
    echo "  ⏳ Agent working..."
  fi
  echo "  $(date +%H:%M:%S)"
  sleep 3
done' Enter

# Select main pane and write the inner loop inline
tmux select-pane -t "$SESSION":0.0

# Export vars for the inner loop
INNER_CMD="export PI_PROVIDER='$PI_PROVIDER' PI_MODEL='$PI_MODEL' MAX_ITERATIONS='$MAX_ITERATIONS' COOLDOWN='$COOLDOWN'; bash .ralph-tmux-inner.sh"
tmux send-keys -t "$SESSION":0.0 "$INNER_CMD" Enter

echo ""
echo "🚀 Ralph loop started in tmux session '$SESSION'"
echo "   Provider: $PI_PROVIDER  Model: $PI_MODEL"
echo ""
echo "   tmux attach -t $SESSION        # watch pi work (full TUI)"
echo "   Ctrl+B D                       # detach (loop continues)"
echo "   tmux kill-session -t $SESSION  # stop everything"
echo ""
