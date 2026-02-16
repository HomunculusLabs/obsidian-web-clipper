#!/usr/bin/env bash
set -euo pipefail

MODE="build"
MAX_ITERATIONS=999999
SLEEP_SECONDS=2
PROVIDER=""
MODEL=""
THINKING=""
TIMEOUT_DURATION=""
HEARTBEAT_SECONDS=30
PI_VANILLA=0
DRY_RUN=0

# If you run with --thinking xhigh and do not specify --timeout, we default to a generous timeout.
DEFAULT_TIMEOUT_XHIGH="90m"

usage() {
  cat <<'USAGE'
Usage:
  ./.ralph-loop.sh --mode plan|build [options]

Options:
  --mode <plan|build>         Which prompt to run
  --max-iterations <N>        Stop after N iterations (build mode)
  --sleep <seconds>           Sleep between iterations (build mode)
  --provider <name>           pi --provider
  --model <id>                pi --model
  --thinking <level>          pi --thinking (off|minimal|low|medium|high|xhigh)
  --timeout <duration>        Kill pi if it runs longer than this (e.g. 20m, 300s)
  --heartbeat <seconds>       Append a heartbeat line every N seconds while pi is running (default: 30)
  --vanilla                   Run pi with extensions/skills disabled (useful if something is sandboxing tools)
  --dry-run                   Print the pi command that would run, do not execute

Notes:
- This is the Ralph Wiggum loop driver for the *Pi coding agent*.
- Each iteration is non-interactive (-p) and ephemeral (--no-session) to avoid context carryover.
- Progress must be persisted to files (especially IMPLEMENTATION_PLAN.md) and git commits.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    --sleep) SLEEP_SECONDS="$2"; shift 2 ;;
    --provider) PROVIDER="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --thinking) THINKING="$2"; shift 2 ;;
    --timeout) TIMEOUT_DURATION="$2"; shift 2 ;;
    --heartbeat) HEARTBEAT_SECONDS="$2"; shift 2 ;;
    --vanilla) PI_VANILLA=1; shift 1 ;;
    --dry-run) DRY_RUN=1; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 1 ;;
  esac
done

# Ensure we run from repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Basic sanity checks
[[ -f "AGENTS.md" ]] || { echo "Missing AGENTS.md"; exit 1; }
[[ -f "IMPLEMENTATION_PLAN.md" ]] || { echo "Missing IMPLEMENTATION_PLAN.md"; exit 1; }
[[ -f "TEST_REQUIREMENTS.md" ]] || { echo "Missing TEST_REQUIREMENTS.md"; exit 1; }
[[ -f "PROMPT_plan.md" ]] || { echo "Missing PROMPT_plan.md"; exit 1; }
[[ -f "PROMPT_build.md" ]] || { echo "Missing PROMPT_build.md"; exit 1; }

# Optional: load secrets/config from .env.ralph (not committed)
if [[ -f ".env.ralph" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.ralph"
  set +a
fi

# Optional: fail fast if API keys are missing for the chosen provider.
#
# Default is OFF because some providers (e.g. codex) may use stored auth and not env vars.
# Enable by exporting: RALPH_REQUIRE_KEYS=1
if [[ "${RALPH_REQUIRE_KEYS:-0}" == "1" && -n "$PROVIDER" ]]; then
  case "$PROVIDER" in
    openai*|azure-openai*)
      if [[ -z "${OPENAI_API_KEY:-}" && -z "${AZURE_OPENAI_API_KEY:-}" ]]; then
        echo "Missing OPENAI_API_KEY (or AZURE_OPENAI_API_KEY) for provider '$PROVIDER'."
        echo "Set it in your shell or create .env.ralph with OPENAI_API_KEY=..."
        exit 3
      fi
      ;;
    anthropic*)
      if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${ANTHROPIC_OAUTH_TOKEN:-}" ]]; then
        echo "Missing ANTHROPIC_API_KEY (or ANTHROPIC_OAUTH_TOKEN) for provider '$PROVIDER'."
        echo "Set it in your shell or create .env.ralph with ANTHROPIC_API_KEY=..."
        exit 3
      fi
      ;;
    google*)
      if [[ -z "${GEMINI_API_KEY:-}" ]]; then
        echo "Missing GEMINI_API_KEY for provider '$PROVIDER'."
        echo "Set it in your shell or create .env.ralph with GEMINI_API_KEY=..."
        exit 3
      fi
      ;;
  esac
fi

PROMPT_FILE=""
case "$MODE" in
  plan) PROMPT_FILE="PROMPT_plan.md" ;;
  build) PROMPT_FILE="PROMPT_build.md" ;;
  *) echo "Invalid --mode: $MODE"; usage; exit 1 ;;
 esac

mkdir -p "logs/ralph"

timestamp() { date '+%Y-%m-%d_%H-%M-%S'; }

pi_cmd_base=(pi --no-session -p)

# Vanilla mode disables all extensions/skills/prompt-templates/themes.
# This can help if a global extension is sandboxing tool execution.
if [[ "$PI_VANILLA" == "1" ]]; then
  pi_cmd_base+=(--no-extensions --no-skills --no-prompt-templates --no-themes)
fi

[[ -n "$PROVIDER" ]] && pi_cmd_base+=(--provider "$PROVIDER")
[[ -n "$MODEL" ]] && pi_cmd_base+=(--model "$MODEL")
[[ -n "$THINKING" ]] && pi_cmd_base+=(--thinking "$THINKING")

run_once() {
  local iter="$1"
  local ts; ts="$(timestamp)"
  local out_file="logs/ralph/${ts}_${MODE}_iter-${iter}.log"

  local cmd=("${pi_cmd_base[@]}" "@${PROMPT_FILE}" "Execute the instructions in ${PROMPT_FILE}. Persist progress to files. One task only if in build mode.")

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "──────────────────────────────────────────────"
    echo "Ralph iteration ${iter} (${MODE}) @ ${ts}"
    echo "Repo: $(pwd)"
    printf 'DRY RUN: %q ' "${cmd[@]}"; echo
    return 0
  fi

  # Initialize log file and write iteration header into it.
  : > "$out_file"
  {
    echo "──────────────────────────────────────────────"
    echo "Ralph iteration ${iter} (${MODE}) @ ${ts}"
    echo "Repo: $(pwd)"
    echo "Command: ${cmd[*]}"
    echo "(heartbeat every ${HEARTBEAT_SECONDS}s; timeout=${TIMEOUT_DURATION:-none})"
    echo
  } >> "$out_file"

  # Stream the log file into the terminal so we see progress as it arrives.
  tail -n +1 -f "$out_file" &
  local tail_pid=$!

  local started_epoch
  started_epoch="$(date +%s)"

  local hb_pid=""

  cleanup() {
    [[ -n "$hb_pid" ]] && kill "$hb_pid" 2>/dev/null || true
    kill "$tail_pid" 2>/dev/null || true
    wait "$tail_pid" 2>/dev/null || true
  }
  trap cleanup RETURN

  # Run pi in the background so we can append a heartbeat even if it is silent.
  if [[ -n "$TIMEOUT_DURATION" ]]; then
    timeout "$TIMEOUT_DURATION" "${cmd[@]}" >>"$out_file" 2>&1 &
  else
    "${cmd[@]}" >>"$out_file" 2>&1 &
  fi
  local pi_pid=$!

  # Heartbeat writer: append a line every N seconds while pi is still running.
  (
    while kill -0 "$pi_pid" 2>/dev/null; do
      sleep "$HEARTBEAT_SECONDS"
      if kill -0 "$pi_pid" 2>/dev/null; then
        local now elapsed
        now="$(date +%s)"
        elapsed=$((now - started_epoch))
        echo "[heartbeat] iter=${iter} elapsed=${elapsed}s (still running)" >> "$out_file"
      fi
    done
  ) &
  hb_pid=$!

  # Wait for pi to finish and capture exit code.
  set +e
  wait "$pi_pid"
  local code=$?
  set -e

  # If timeout killed it, record that in the log.
  if [[ $code -eq 124 ]]; then
    echo "pi timed out after $TIMEOUT_DURATION" >> "$out_file"
    echo "Hint: increase --timeout for slow tasks (xhigh can take a long time)." >> "$out_file"
  fi

  if [[ $code -ne 0 ]]; then
    echo "pi exited non-zero ($code)" >> "$out_file"

    # If interrupted (Ctrl+C => 130) or killed (SIGKILL => 137) or timed out (124), stop safely.
    if [[ $code -eq 130 || $code -eq 124 || $code -eq 137 ]]; then
      return 2
    fi

    return "$code"
  fi

  # Safety: in build mode we expect a RALPH_COMPLETE marker
  if [[ "$MODE" == "build" ]]; then
    if ! grep -q "^RALPH_COMPLETE:" "$out_file"; then
      echo "No RALPH_COMPLETE marker found. Stopping for safety." >> "$out_file"
      return 2
    fi
  fi

  return 0
}

if [[ "$MODE" == "plan" ]]; then
  run_once 1
  exit $?
fi

# If using xhigh thinking, default timeout upward unless user explicitly set one.
if [[ -z "$TIMEOUT_DURATION" && "${THINKING:-}" == "xhigh" ]]; then
  TIMEOUT_DURATION="$DEFAULT_TIMEOUT_XHIGH"
fi

# build mode loop
for ((i=1; i<=MAX_ITERATIONS; i++)); do
  if ! grep -q "\[ \]" IMPLEMENTATION_PLAN.md 2>/dev/null; then
    echo "All tasks complete (no [ ] remain)."
    exit 0
  fi

  run_once "$i"
  code=$?

  if [[ $code -ne 0 ]]; then
    echo "Iteration failed/stopped with code $code. See latest logs in logs/ralph/."
    exit $code
  fi

  # Stop if plan is done
  if ! grep -q "\[ \]" IMPLEMENTATION_PLAN.md 2>/dev/null; then
    echo "All tasks complete (no [ ] remain)."
    exit 0
  fi

  sleep "$SLEEP_SECONDS"
done

echo "Reached max iterations: $MAX_ITERATIONS"
exit 0
