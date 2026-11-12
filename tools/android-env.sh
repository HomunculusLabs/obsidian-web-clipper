#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export OWC_ANDROID_TOOLS_DIR="$SCRIPT_DIR"
export OWC_PROJECT_ROOT="${OWC_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
export OWC_ANDROID_SDK_ROOT="${OWC_ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}"
export ANDROID_HOME="$OWC_ANDROID_SDK_ROOT"
export ANDROID_SDK_ROOT="$OWC_ANDROID_SDK_ROOT"
export OWC_ANDROID_AVD_NAME="${OWC_ANDROID_AVD_NAME:-owc-firefox-android-35}"
export OWC_ANDROID_DEVICE_SERIAL="${OWC_ANDROID_DEVICE_SERIAL:-}"
export OWC_ANDROID_FIREFOX_APK="${OWC_ANDROID_FIREFOX_APK:-}"
export OWC_ANDROID_OBSIDIAN_APK="${OWC_ANDROID_OBSIDIAN_APK:-}"
export OWC_ANDROID_FIREFOX_PACKAGE="${OWC_ANDROID_FIREFOX_PACKAGE:-}"
export OWC_ANDROID_OBSIDIAN_PACKAGE="${OWC_ANDROID_OBSIDIAN_PACKAGE:-md.obsidian}"
export OWC_APPIUM_SERVER_URL="${OWC_APPIUM_SERVER_URL:-http://127.0.0.1:4723}"
export OWC_FIREFOX_ANDROID_START_URL="${OWC_FIREFOX_ANDROID_START_URL:-https://chatgpt.com/}"
export OWC_FIREFOX_ANDROID_PACKAGE_HINT="${OWC_FIREFOX_ANDROID_PACKAGE_HINT:-Set OWC_ANDROID_FIREFOX_PACKAGE to your installed Firefox Android development package before running the Android Firefox lane.}"
export OWC_FIREFOX_SIGN_CHANNEL="${OWC_FIREFOX_SIGN_CHANNEL:-unlisted}"
export OWC_FIREFOX_ANDROID_ARTIFACTS_DIR="${OWC_FIREFOX_ANDROID_ARTIFACTS_DIR:-$OWC_PROJECT_ROOT/web-ext-artifacts/firefox-android}"
export OWC_AMO_API_KEY="${OWC_AMO_API_KEY:-}"
export OWC_AMO_API_SECRET="${OWC_AMO_API_SECRET:-}"
export OWC_AMO_METADATA_JSON="${OWC_AMO_METADATA_JSON:-}"
export OWC_FIREFOX_UPLOAD_SOURCE_CODE="${OWC_FIREFOX_UPLOAD_SOURCE_CODE:-}"
export OWC_ANDROID_OBSIDIAN_VAULT="${OWC_ANDROID_OBSIDIAN_VAULT:-}"

if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  elif [[ -d "/Applications/Android Studio.app/Contents/jre/Contents/Home" ]]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jre/Contents/Home"
  fi
fi

prepend_path() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    export PATH="$dir:$PATH"
  fi
}

prepend_path "/opt/homebrew/bin"
prepend_path "$ANDROID_SDK_ROOT/emulator"
prepend_path "$ANDROID_SDK_ROOT/platform-tools"
prepend_path "$ANDROID_SDK_ROOT/cmdline-tools/latest/bin"
prepend_path "$OWC_PROJECT_ROOT/node_modules/.bin"
if [[ -n "${JAVA_HOME:-}" ]]; then
  prepend_path "$JAVA_HOME/bin"
fi
