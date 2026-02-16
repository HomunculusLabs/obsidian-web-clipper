#!/bin/bash
#
# Native Messaging Host Uninstaller for Obsidian Web Clipper
# Supports: macOS, Linux
#
# Usage: ./uninstall.sh [--browser chrome|chromium|brave|edge]
#
# Examples:
#   ./uninstall.sh
#   ./uninstall.sh --browser brave
#

set -e

# Default values
BROWSER="chrome"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_NAME="com.t3rpz.obsidian_web_clipper"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

usage() {
    cat << EOF
Native Messaging Host Uninstaller for Obsidian Web Clipper

Usage: $0 [OPTIONS]

Optional:
  --browser <name>       Target browser: chrome (default), chromium, brave, edge
  --all                  Remove from all installed browsers
  --help                 Show this help message

Examples:
  $0
  $0 --browser brave
  $0 --all

Supported browsers:
  chrome   - Google Chrome (default)
  chromium - Chromium
  brave    - Brave Browser
  edge     - Microsoft Edge
EOF
    exit 0
}

# Parse arguments
REMOVE_ALL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --browser)
            BROWSER="$2"
            shift 2
            ;;
        --all)
            REMOVE_ALL=true
            shift
            ;;
        --help|-h)
            usage
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            ;;
    esac
done

# Detect platform
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

print_info "Platform: $PLATFORM ($ARCH)"

# Function to get manifest directory for a browser
get_manifest_dir() {
    local browser="$1"
    case "$browser" in
        chrome)
            if [ "$PLATFORM" = "darwin" ]; then
                echo "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
            else
                echo "$HOME/.config/google-chrome/NativeMessagingHosts"
            fi
            ;;
        chromium)
            if [ "$PLATFORM" = "darwin" ]; then
                echo "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
            else
                echo "$HOME/.config/chromium/NativeMessagingHosts"
            fi
            ;;
        brave)
            if [ "$PLATFORM" = "darwin" ]; then
                echo "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
            else
                echo "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
            fi
            ;;
        edge)
            if [ "$PLATFORM" = "darwin" ]; then
                echo "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
            else
                echo "$HOME/.config/microsoft-edge/NativeMessagingHosts"
            fi
            ;;
        *)
            echo ""
            ;;
    esac
}

# Function to uninstall from a specific browser
uninstall_browser() {
    local browser="$1"
    local manifest_dir
    manifest_dir=$(get_manifest_dir "$browser")
    
    if [ -z "$manifest_dir" ]; then
        print_error "Unsupported browser: $browser"
        return 1
    fi
    
    local manifest_path="$manifest_dir/$HOST_NAME.json"
    
    print_info "Checking $browser..."
    
    if [ -f "$manifest_path" ]; then
        rm "$manifest_path"
        print_success "Removed manifest: $manifest_path"
    else
        print_warning "Manifest not found for $browser: $manifest_path"
    fi
}

# Main uninstall logic
echo ""
echo "=========================================="
echo "  Obsidian Web Clipper - Native Host Uninstaller"
echo "=========================================="
echo ""

if [ "$REMOVE_ALL" = true ]; then
    print_info "Removing from all browsers..."
    for b in chrome chromium brave edge; do
        uninstall_browser "$b"
    done
else
    print_info "Browser: $BROWSER"
    uninstall_browser "$BROWSER"
fi

# Also remove the host binary (shared across all browsers)
HOST_BIN_DIR="$HOME/.local/share/obsidian-web-clipper"
if [ -f "$HOST_BIN_DIR/host" ]; then
    rm -f "$HOST_BIN_DIR/host"
    print_success "Removed host binary: $HOST_BIN_DIR/host"
fi

# Clean up empty directory
if [ -d "$HOST_BIN_DIR" ] && [ -z "$(ls -A "$HOST_BIN_DIR" 2>/dev/null)" ]; then
    rmdir "$HOST_BIN_DIR"
    print_info "Removed empty directory: $HOST_BIN_DIR"
fi

echo ""
echo "=========================================="
print_success "Uninstall Complete!"
echo "=========================================="
echo ""
echo "The native messaging host has been removed."
echo "Restart your browser(s) to complete the cleanup."
echo ""
