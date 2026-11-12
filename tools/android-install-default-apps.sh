#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/android-env.sh"

APK_PATHS=()
if [[ -n "$OWC_ANDROID_FIREFOX_APK" ]]; then
  APK_PATHS+=("$OWC_ANDROID_FIREFOX_APK")
fi
if [[ -n "$OWC_ANDROID_OBSIDIAN_APK" ]]; then
  APK_PATHS+=("$OWC_ANDROID_OBSIDIAN_APK")
fi

if [[ ${#APK_PATHS[@]} -eq 0 ]]; then
  echo "Set OWC_ANDROID_FIREFOX_APK and/or OWC_ANDROID_OBSIDIAN_APK before running this helper." >&2
  exit 1
fi

exec "$SCRIPT_DIR/android-install-apks.sh" "$@" -- "${APK_PATHS[@]}"
