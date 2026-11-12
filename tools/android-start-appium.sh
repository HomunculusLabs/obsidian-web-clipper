#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/android-env.sh"

APPIUM_HOST="${APPIUM_HOST:-127.0.0.1}"
APPIUM_PORT="${APPIUM_PORT:-4723}"

echo "Starting Appium on ${APPIUM_HOST}:${APPIUM_PORT}"
exec appium --address "$APPIUM_HOST" --port "$APPIUM_PORT" "$@"
