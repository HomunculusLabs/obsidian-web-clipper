#!/bin/bash
#
# Native Messaging Host Installer for Obsidian Web Clipper
# Supports: macOS, Linux
#
# Usage: ./install.sh --extension-id <id> [--cli-path <path>] [--browser chrome|chromium|brave|edge]
#
# Examples:
#   ./install.sh --extension-id abcdefghijklmnopqrstuvwxyz123456
#   ./install.sh --extension-id abcdefghijklmnopqrstuvwxyz123456 --browser brave
#

set -e

# Default values
BROWSER="chrome"
CLI_PATH=""
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

smoke_test_host() {
    local smoke_test_script
    local smoke_test_output

    smoke_test_script=$(cat <<'EOF'
const { spawn } = await import("node:child_process");

function encodeFrame(body) {
  const json = Buffer.from(JSON.stringify(body), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

const hostPath = process.env.HOST_BIN_PATH;
if (!hostPath) {
  console.error("Missing HOST_BIN_PATH");
  process.exit(1);
}

const proc = spawn(hostPath, [], { stdio: ["pipe", "pipe", "pipe"] });
let pending = Buffer.alloc(0);
let stderr = "";
let settled = false;

const timeoutId = setTimeout(() => {
  if (settled) return;
  settled = true;
  try {
    proc.kill();
  } catch {
    // ignore
  }
  console.error("Host smoke test timed out");
  process.exit(1);
}, 5000);

function fail(message) {
  if (settled) return;
  settled = true;
  clearTimeout(timeoutId);
  try {
    proc.kill();
  } catch {
    // ignore
  }
  console.error(message);
  process.exit(1);
}

proc.on("error", (error) => {
  fail(`Failed to launch host binary: ${error.message}`);
});

proc.stdout.on("data", (chunk) => {
  pending = Buffer.concat([pending, Buffer.from(chunk)]);

  if (pending.length < 4) {
    return;
  }

  const bodyLength = pending.readUInt32LE(0);
  const totalLength = 4 + bodyLength;
  if (pending.length < totalLength) {
    return;
  }

  clearTimeout(timeoutId);
  settled = true;

  try {
    proc.kill();
  } catch {
    // ignore
  }

  process.exit(0);
});

proc.stderr.on("data", (chunk) => {
  stderr += Buffer.from(chunk).toString("utf8");
});

proc.on("close", (code) => {
  if (!settled) {
    fail(stderr.trim() || `Host exited before responding (code ${code ?? "unknown"})`);
  }
});

proc.stdin.write(
  encodeFrame({
    action: "testCliConnection",
    payload: {
      cliPath: "",
      vault: "",
    },
  })
);
proc.stdin.end();
EOF
)

    if ! smoke_test_output=$(HOST_BIN_PATH="$HOST_BIN_PATH" bun -e "$smoke_test_script" 2>&1); then
        print_error "Native host smoke test failed"
        echo "$smoke_test_output"
        exit 1
    fi

    print_success "Native host smoke test passed"
}

usage() {
    cat << EOF
Native Messaging Host Installer for Obsidian Web Clipper

Usage: $0 [OPTIONS]

Required:
  --extension-id <id>    Chrome extension ID (32 character string)

Optional:
  --browser <name>       Target browser: chrome (default), chromium, brave, edge
  --cli-path <path>      Path to obsidian CLI (auto-detected if not provided)
  --uninstall            Remove the native messaging host instead of installing
  --help                 Show this help message

Examples:
  $0 --extension-id abcdefghijklmnopqrstuvwxyz123456
  $0 --extension-id abcdefghijklmnopqrstuvwxyz123456 --browser brave
  $0 --uninstall

How to find your extension ID:
  1. Open chrome://extensions
  2. Enable "Developer mode" (top right)
  3. Find "Obsidian Web Clipper" and copy the ID

Supported browsers:
  chrome   - Google Chrome (default)
  chromium - Chromium
  brave    - Brave Browser
  edge     - Microsoft Edge
EOF
    exit 0
}

# Parse arguments
UNINSTALL=false
EXTENSION_ID=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --extension-id)
            EXTENSION_ID="$2"
            shift 2
            ;;
        --browser)
            BROWSER="$2"
            shift 2
            ;;
        --cli-path)
            CLI_PATH="$2"
            shift 2
            ;;
        --uninstall)
            UNINSTALL=true
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

# Validate extension ID
if [ "$UNINSTALL" = false ]; then
    if [ -z "$EXTENSION_ID" ]; then
        print_error "Extension ID is required. Use --extension-id <id>"
        echo ""
        usage
    fi

    if ! [[ "$EXTENSION_ID" =~ ^[a-z]{32}$ ]]; then
        print_warning "Extension ID doesn't look like a standard Chrome extension ID (expected 32 lowercase letters)"
        read -p "Continue anyway? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
fi

# Detect platform
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

print_info "Platform: $PLATFORM ($ARCH)"
print_info "Browser: $BROWSER"

# Set browser-specific paths
case "$BROWSER" in
    chrome)
        if [ "$PLATFORM" = "darwin" ]; then
            MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
        else
            MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
        fi
        ;;
    chromium)
        if [ "$PLATFORM" = "darwin" ]; then
            MANIFEST_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
        else
            MANIFEST_DIR="$HOME/.config/chromium/NativeMessagingHosts"
        fi
        ;;
    brave)
        if [ "$PLATFORM" = "darwin" ]; then
            MANIFEST_DIR="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
        else
            MANIFEST_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
        fi
        ;;
    edge)
        if [ "$PLATFORM" = "darwin" ]; then
            MANIFEST_DIR="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
        else
            MANIFEST_DIR="$HOME/.config/microsoft-edge/NativeMessagingHosts"
        fi
        ;;
    *)
        print_error "Unsupported browser: $BROWSER"
        print_info "Supported browsers: chrome, chromium, brave, edge"
        exit 1
        ;;
esac

MANIFEST_PATH="$MANIFEST_DIR/$HOST_NAME.json"

# Uninstall mode
if [ "$UNINSTALL" = true ]; then
    print_info "Uninstalling native messaging host..."
    
    if [ -f "$MANIFEST_PATH" ]; then
        rm "$MANIFEST_PATH"
        print_success "Removed manifest: $MANIFEST_PATH"
    else
        print_warning "Manifest not found: $MANIFEST_PATH"
    fi
    
    # Also try to remove the executable
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
    
    print_success "Uninstall complete!"
    exit 0
fi

# Check for bun
if ! command -v bun &> /dev/null; then
    print_error "Bun is required but not installed."
    print_info "Install bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

print_info "Bun version: $(bun --version)"

# Detect obsidian CLI if not provided
if [ -z "$CLI_PATH" ]; then
    if command -v obsidian &> /dev/null; then
        CLI_PATH=$(which obsidian)
        print_info "Auto-detected obsidian CLI: $CLI_PATH"
    else
        print_warning "Could not auto-detect obsidian CLI. You may need to configure it in extension settings."
    fi
fi

# Create host binary directory
HOST_BIN_DIR="$HOME/.local/share/obsidian-web-clipper"
HOST_BIN_PATH="$HOST_BIN_DIR/host"

print_info "Creating host binary directory..."
mkdir -p "$HOST_BIN_DIR"

# Compile host.ts to standalone executable
print_info "Compiling native messaging host..."
cd "$SCRIPT_DIR"

# Use bun build --compile to create standalone executable
bun build --compile --outfile="$HOST_BIN_PATH" ./host.ts

# Make executable
chmod +x "$HOST_BIN_PATH"

print_success "Created host binary: $HOST_BIN_PATH"

# Verify the compiled host can answer a native messaging frame before installing it
print_info "Running native host smoke test..."
smoke_test_host

# Create manifest directory
print_info "Creating manifest directory..."
mkdir -p "$MANIFEST_DIR"

# Generate manifest JSON
MANIFEST_CONTENT=$(cat << EOF
{
  "name": "$HOST_NAME",
  "description": "Native messaging host for Obsidian Web Clipper - enables direct CLI integration for saving clips to Obsidian vaults",
  "path": "$HOST_BIN_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF
)

# Write manifest
echo "$MANIFEST_CONTENT" > "$MANIFEST_PATH"

print_success "Created manifest: $MANIFEST_PATH"

# Verify installation
print_info "Verifying installation..."

if [ -x "$HOST_BIN_PATH" ]; then
    print_success "Host binary is executable"
else
    print_error "Host binary is not executable"
    exit 1
fi

if [ -f "$MANIFEST_PATH" ]; then
    print_success "Manifest file exists"
else
    print_error "Manifest file not found"
    exit 1
fi

# Print summary
echo ""
echo "=========================================="
print_success "Native Messaging Host Installed Successfully!"
echo "=========================================="
echo ""
echo "Host binary: $HOST_BIN_PATH"
echo "Manifest:    $MANIFEST_PATH"
echo "Extension:   $EXTENSION_ID"
echo ""

if [ -n "$CLI_PATH" ]; then
    echo "Obsidian CLI detected: $CLI_PATH"
else
    echo "⚠ Obsidian CLI not found in PATH."
    echo "  Make sure to install and configure it, then set the path in extension settings."
fi

echo ""
echo "Next steps:"
echo "  1. Restart $BROWSER if it's running"
echo "  2. Open the Obsidian Web Clipper extension"
echo "  3. Go to Settings → Obsidian CLI"
echo "  4. Enable 'Use Obsidian CLI' and configure your vault"
echo ""
print_info "To uninstall, run: $0 --uninstall"
