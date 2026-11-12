#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/android-env.sh"

cd "$OWC_PROJECT_ROOT"
bun run build:firefox:android
mkdir -p "$OWC_FIREFOX_ANDROID_ARTIFACTS_DIR"

VERSION="$(node -p "require('./dist-firefox-android/manifest.json').version || '0.0.0'")"
FILENAME="obsidian-web-clipper-firefox-android-${VERSION}.xpi"

echo "Packaging Firefox Android artifact: $FILENAME"
exec web-ext build \
  --source-dir dist-firefox-android \
  --artifacts-dir "$OWC_FIREFOX_ANDROID_ARTIFACTS_DIR" \
  --filename "$FILENAME" \
  --overwrite-dest \
  "$@"
