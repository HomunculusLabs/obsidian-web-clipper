#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/android-env.sh"

if [[ -z "$OWC_AMO_API_KEY" || -z "$OWC_AMO_API_SECRET" ]]; then
  echo "Set OWC_AMO_API_KEY and OWC_AMO_API_SECRET before signing." >&2
  exit 1
fi

cd "$OWC_PROJECT_ROOT"
bun run build:firefox:android
mkdir -p "$OWC_FIREFOX_ANDROID_ARTIFACTS_DIR"

WEB_EXT_ARGS=(
  sign
  --source-dir dist-firefox-android
  --artifacts-dir "$OWC_FIREFOX_ANDROID_ARTIFACTS_DIR"
  --channel "$OWC_FIREFOX_SIGN_CHANNEL"
  --api-key "$OWC_AMO_API_KEY"
  --api-secret "$OWC_AMO_API_SECRET"
  --no-input
)

if [[ -n "${OWC_AMO_METADATA_JSON:-}" ]]; then
  WEB_EXT_ARGS+=( --amo-metadata "$OWC_AMO_METADATA_JSON" )
fi
if [[ -n "${OWC_FIREFOX_UPLOAD_SOURCE_CODE:-}" ]]; then
  WEB_EXT_ARGS+=( --upload-source-code "$OWC_FIREFOX_UPLOAD_SOURCE_CODE" )
fi

WEB_EXT_ARGS+=("$@")

echo "Signing Firefox Android artifact for channel: $OWC_FIREFOX_SIGN_CHANNEL"
exec web-ext "${WEB_EXT_ARGS[@]}"
