#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/android-env.sh"

HEADLESS=0
WIPE_DATA=0
PASSTHROUGH=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --avd)
      OWC_ANDROID_AVD_NAME="$2"
      shift 2
      ;;
    --headless)
      HEADLESS=1
      shift
      ;;
    --wipe-data)
      WIPE_DATA=1
      shift
      ;;
    --)
      shift
      PASSTHROUGH+=("$@")
      break
      ;;
    *)
      PASSTHROUGH+=("$1")
      shift
      ;;
  esac
done

CMD=(emulator -avd "$OWC_ANDROID_AVD_NAME" -no-snapshot -no-boot-anim)
if [[ "$HEADLESS" -eq 1 ]]; then
  CMD+=( -no-window )
fi
if [[ "$WIPE_DATA" -eq 1 ]]; then
  CMD+=( -wipe-data )
fi
if [[ ${#PASSTHROUGH[@]} -gt 0 ]]; then
  CMD+=("${PASSTHROUGH[@]}")
fi

echo "Starting emulator: $OWC_ANDROID_AVD_NAME"
exec "${CMD[@]}"
