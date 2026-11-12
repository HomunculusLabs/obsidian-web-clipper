#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/android-env.sh"

if [[ -z "$OWC_ANDROID_FIREFOX_PACKAGE" ]]; then
  echo "$OWC_FIREFOX_ANDROID_PACKAGE_HINT" >&2
  exit 1
fi

cd "$OWC_PROJECT_ROOT"
bun run build:firefox:android

WEB_EXT_ARGS=(
  run
  --source-dir dist-firefox-android
  --target firefox-android
  --firefox-apk "$OWC_ANDROID_FIREFOX_PACKAGE"
  --start-url "$OWC_FIREFOX_ANDROID_START_URL"
)

if [[ -n "$OWC_ANDROID_DEVICE_SERIAL" ]]; then
  WEB_EXT_ARGS+=( --adb-device "$OWC_ANDROID_DEVICE_SERIAL" )
fi

WEB_EXT_ARGS+=("$@")

echo "Running Firefox Android extension against package: $OWC_ANDROID_FIREFOX_PACKAGE"
exec web-ext "${WEB_EXT_ARGS[@]}"
