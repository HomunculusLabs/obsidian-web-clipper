#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/android-env.sh"

SERIAL="${OWC_ANDROID_DEVICE_SERIAL:-}"
GRANT_ALL=0
WAIT_FOR_DEVICE=1
APK_PATHS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --serial)
      SERIAL="$2"
      shift 2
      ;;
    --grant-all|-g)
      GRANT_ALL=1
      shift
      ;;
    --no-wait)
      WAIT_FOR_DEVICE=0
      shift
      ;;
    --)
      shift
      APK_PATHS+=("$@")
      break
      ;;
    *)
      APK_PATHS+=("$1")
      shift
      ;;
  esac
done

if [[ ${#APK_PATHS[@]} -eq 0 ]]; then
  echo "Usage: bash tools/android-install-apks.sh [--serial SERIAL] [--grant-all] apk1.apk [apk2.apk ...]" >&2
  exit 1
fi

ADB_ARGS=()
if [[ -n "$SERIAL" ]]; then
  ADB_ARGS+=( -s "$SERIAL" )
fi

if [[ "$WAIT_FOR_DEVICE" -eq 1 ]]; then
  adb "${ADB_ARGS[@]}" wait-for-device
fi

for apk_path in "${APK_PATHS[@]}"; do
  if [[ ! -f "$apk_path" ]]; then
    echo "APK not found: $apk_path" >&2
    exit 1
  fi

  INSTALL_ARGS=( install -r )
  if [[ "$GRANT_ALL" -eq 1 ]]; then
    INSTALL_ARGS+=( -g )
  fi

  echo "Installing APK: $apk_path"
  adb "${ADB_ARGS[@]}" "${INSTALL_ARGS[@]}" "$apk_path"
done
