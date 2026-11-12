#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/android-env.sh"

echo "ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT"
echo "JAVA_HOME=${JAVA_HOME:-<unset>}"
echo "OWC_ANDROID_AVD_NAME=$OWC_ANDROID_AVD_NAME"

echo
echo "== tool versions =="
adb version | head -n 1
emulator -version | head -n 1
appium -v
scrcpy --version | head -n 1

echo
echo "== appium driver =="
appium driver list --installed
appium driver doctor uiautomator2

echo
echo "== avds =="
avdmanager list avd || true

echo
echo "== devices =="
adb devices -l
