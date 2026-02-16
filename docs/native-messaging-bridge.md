# Native Messaging Bridge

The Obsidian Web Clipper extension uses Chrome's Native Messaging API to communicate with a local host binary, enabling direct CLI integration for saving clips to Obsidian vaults.

## Overview

Chrome extensions (Manifest V3) cannot directly spawn local processes from service workers. To work around this limitation, we use a **Native Messaging Host** - a small native binary that Chrome can communicate with via stdin/stdout.

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Extension      │      │  Native Host     │      │  Obsidian CLI   │
│  (Service       │─────▶│  (host binary)   │─────▶│  (obsidian)     │
│   Worker)       │◀─────│                  │◀─────│                 │
└─────────────────┘      └──────────────────┘      └─────────────────┘
     chrome.               stdin/stdout              spawn CLI
  sendNativeMessage()      protocol                 processes
```

## Host Name

`com.t3rpz.obsidian_web_clipper`

This must match the host manifest installed on your local machine.

## Prerequisites

### Required
- **Bun** (recommended) or **Node.js 18+**
- **Obsidian CLI** (`obsidian` command) - available from the Obsidian app or obsidian-cli package
- **Chrome, Chromium, Brave, or Edge** browser

### Installing Bun

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

Verify installation:
```bash
bun --version
```

### Installing Obsidian CLI

The Obsidian CLI comes bundled with the Obsidian app. On macOS, it's typically at:
```
/Applications/Obsidian.app/Contents/MacOS/obsidian
```

You can also install it via package managers:
```bash
# macOS (Homebrew)
brew install --cask obsidian

# The CLI should then be available as:
which obsidian
# /opt/homebrew/bin/obsidian (Apple Silicon)
# /usr/local/bin/obsidian (Intel)
```

## Installation

### Step 1: Find Your Extension ID

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right corner)
3. Find **Obsidian Web Clipper** in the list
4. Copy the **ID** shown below the extension name (32 lowercase characters)

Example: `abcdefghijklmnopqrstuvwxyz123456`

### Step 2: Run the Installer

Open a terminal and navigate to the extension's `native-host` directory:

```bash
cd /path/to/obsidian-web-clipper/native-host
```

#### macOS / Linux

```bash
# Basic installation (Chrome)
./install.sh --extension-id YOUR_EXTENSION_ID

# For Brave browser
./install.sh --extension-id YOUR_EXTENSION_ID --browser brave

# For Chromium
./install.sh --extension-id YOUR_EXTENSION_ID --browser chromium

# For Microsoft Edge
./install.sh --extension-id YOUR_EXTENSION_ID --browser edge
```

#### Windows

Open Command Prompt or PowerShell:

```cmd
REM Basic installation (Chrome)
install.bat --extension-id YOUR_EXTENSION_ID

REM For Brave browser
install.bat --extension-id YOUR_EXTENSION_ID --browser brave

REM For Chromium
install.bat --extension-id YOUR_EXTENSION_ID --browser chromium

REM For Microsoft Edge
install.bat --extension-id YOUR_EXTENSION_ID --browser edge
```

### Step 3: Restart Your Browser

After installation, **restart your browser** to ensure the native messaging host is detected.

### Step 4: Configure the Extension

1. Open the Obsidian Web Clipper extension
2. Go to **Settings → Obsidian CLI Integration**
3. Set **Save Method** to "Obsidian CLI"
4. Enter the path to the Obsidian CLI (or click **Auto-detect**)
5. Enter your vault name
6. Click **Test CLI Connection** to verify everything works

## What Gets Installed

### Host Binary

The installer compiles `host.ts` into a standalone executable:

| Platform | Location |
|----------|----------|
| macOS/Linux | `~/.local/share/obsidian-web-clipper/host` |
| Windows | `%LOCALAPPDATA%\ObsidianWebClipper\host.exe` |

### Host Manifest

The installer creates a manifest file that tells Chrome where to find the host:

| Platform | Location |
|----------|----------|
| macOS (Chrome) | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.t3rpz.obsidian_web_clipper.json` |
| Linux (Chrome) | `~/.config/google-chrome/NativeMessagingHosts/com.t3rpz.obsidian_web_clipper.json` |
| Windows (Chrome) | Registry: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.t3rpz.obsidian_web_clipper` |

### Browser-Specific Paths

| Browser | macOS | Linux | Windows |
|---------|-------|-------|---------|
| Chrome | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` | `~/.config/google-chrome/NativeMessagingHosts/` | `HKCU\Software\Google\Chrome\NativeMessagingHosts\` |
| Chromium | `~/Library/Application Support/Chromium/NativeMessagingHosts/` | `~/.config/chromium/NativeMessagingHosts/` | `HKCU\Software\Chromium\NativeMessagingHosts\` |
| Brave | `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/` | `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/` | `HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\` |
| Edge | `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/` | `~/.config/microsoft-edge/NativeMessagingHosts/` | `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\` |

## Uninstallation

To remove the native messaging host:

### macOS / Linux

```bash
./install.sh --uninstall
```

### Windows

```cmd
install.bat --uninstall
```

## Troubleshooting

### "Native Messaging bridge error: Specified native messaging host not found"

This error means Chrome cannot find the native messaging host manifest.

**Solutions:**

1. **Verify the manifest exists:**
   ```bash
   # macOS
   cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.t3rpz.obsidian_web_clipper.json

   # Linux
   cat ~/.config/google-chrome/NativeMessagingHosts/com.t3rpz.obsidian_web_clipper.json
   ```

2. **Check the manifest contents:**
   - Ensure the `path` field points to an existing file
   - Ensure the `allowed_origins` contains your correct extension ID

3. **Restart Chrome completely:**
   - Close all Chrome windows (not just the current one)
   - On macOS: Cmd+Q to quit
   - Reopen Chrome

4. **Re-run the installer with the correct extension ID:**
   ```bash
   ./install.sh --extension-id YOUR_CORRECT_ID
   ```

### "Failed to spawn CLI" or "CLI exited with code 1"

The native host is working, but cannot execute the Obsidian CLI.

**Solutions:**

1. **Verify the CLI path:**
   ```bash
   which obsidian
   # or
   ls -la /usr/local/bin/obsidian
   ```

2. **Test the CLI manually:**
   ```bash
   obsidian --version
   obsidian print-default
   ```

3. **Check CLI path in settings:**
   - Go to extension settings → Obsidian CLI Integration
   - Ensure the CLI Path is correct
   - On macOS, it might be `/Applications/Obsidian.app/Contents/MacOS/obsidian`

### "Permission denied" errors

The host binary or CLI is not executable.

**Solutions:**

1. **Make host executable:**
   ```bash
   chmod +x ~/.local/share/obsidian-web-clipper/host
   ```

2. **Make CLI executable:**
   ```bash
   chmod +x /path/to/obsidian
   ```

### "Vault not found in Obsidian config"

The vault name doesn't match any vault in your Obsidian configuration.

**Solutions:**

1. **Check exact vault name:**
   - Open Obsidian
   - Note the exact vault name in the vault switcher
   - Vault names are case-sensitive

2. **Check Obsidian config:**
   ```bash
   # macOS
   cat ~/Library/Application\ Support/obsidian/obsidian.json

   # Linux
   cat ~/.config/obsidian/obsidian.json

   # Windows
   type %APPDATA%\obsidian\obsidian.json
   ```

### Chrome shows "This extension requires additional permissions"

The extension needs the `nativeMessaging` permission.

**Solutions:**

1. **Accept the permission prompt** when prompted
2. **Check permissions:**
   - Go to `chrome://extensions`
   - Click "Details" on the extension
   - Verify native messaging access is granted

### Installation fails with "Bun is required"

**Solutions:**

1. **Install Bun:**
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Restart your terminal** after installation

3. **Verify Bun:**
   ```bash
   bun --version
   ```

### Windows: Registry errors

**Solutions:**

1. **Run as Administrator** if you get permission errors
2. **Check registry manually:**
   ```cmd
   reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.t3rpz.obsidian_web_clipper"
   ```

## Message Contract

### Request Format

All requests follow this structure:

```typescript
interface NativeRequest {
  action: string;  // The action to perform
  payload: Record<string, unknown>;  // Action-specific parameters
}
```

### Response Format

```typescript
interface NativeResponse {
  success: boolean;
  error?: string;      // Error message if success is false
  code?: string;       // Error code for programmatic handling
  data?: Record<string, unknown>;  // Response data on success
}
```

### Supported Actions

#### `saveToCli`

Save content to an Obsidian note.

**Request:**
```json
{
  "action": "saveToCli",
  "payload": {
    "cliPath": "/usr/local/bin/obsidian",
    "vault": "Main Vault",
    "filePath": "Folder/Note Name",
    "content": "# My Note\n\nContent here...",
    "overwrite": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "filePath": "Folder/Note Name",
    "vault": "Main Vault"
  }
}
```

#### `saveAttachmentToCli`

Save binary attachments (images, etc.) to the vault.

**Request:**
```json
{
  "action": "saveAttachmentToCli",
  "payload": {
    "cliPath": "/usr/local/bin/obsidian",
    "vault": "Main Vault",
    "filePath": "attachments/image-1.png",
    "base64Data": "iVBORw0KGgoAAAANSUhEUg...",
    "mimeType": "image/png"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "filePath": "attachments/image-1.png",
    "savedPath": "/path/to/vault/attachments/image-1.png"
  }
}
```

#### `testCliConnection`

Verify CLI connectivity and vault access.

**Request:**
```json
{
  "action": "testCliConnection",
  "payload": {
    "cliPath": "/usr/local/bin/obsidian",
    "vault": "Main Vault"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "version": "1.5.3",
    "vaultAccessible": true
  }
}
```

#### `listVaultFolders`

List all folders in a vault.

**Request:**
```json
{
  "action": "listVaultFolders",
  "payload": {
    "cliPath": "/usr/local/bin/obsidian",
    "vault": "Main Vault"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "folders": ["Notes", "Archive", "Projects", "Projects/Active"],
    "vaultPath": "/Users/you/Obsidian/Main Vault"
  }
}
```

#### `createVaultFolder`

Create a new folder in the vault.

**Request:**
```json
{
  "action": "createVaultFolder",
  "payload": {
    "cliPath": "/usr/local/bin/obsidian",
    "vault": "Main Vault",
    "folderPath": "New Folder/Subfolder"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "folderPath": "New Folder/Subfolder",
    "createdPath": "/Users/you/Obsidian/Main Vault/New Folder/Subfolder"
  }
}
```

## Protocol Details

The native messaging protocol uses a simple length-prefixed format:

1. **Request**: Chrome sends a 4-byte little-endian uint32 message length, followed by UTF-8 JSON
2. **Response**: Host sends the same format back

```
┌──────────────┬─────────────────────────────┐
│ 4 bytes      │ N bytes                     │
│ (uint32 LE)  │ (UTF-8 JSON)                │
│ message len  │ request/response body       │
└──────────────┴─────────────────────────────┘
```

## Security Considerations

1. **Extension ID verification**: The host manifest only allows connections from your specific extension ID
2. **Path sanitization**: All file paths are sanitized to prevent directory traversal attacks
3. **Vault root confinement**: File operations are constrained to the vault root directory
4. **No network access**: The host only communicates via stdin/stdout with Chrome

## Manual Installation

If the installer script doesn't work, you can manually install:

### 1. Compile the host

```bash
cd native-host
bun build --compile --outfile=./host ./host.ts
```

### 2. Create the manifest

Create `com.t3rpz.obsidian_web_clipper.json`:

```json
{
  "name": "com.t3rpz.obsidian_web_clipper",
  "description": "Native messaging host for Obsidian Web Clipper",
  "path": "/ABSOLUTE/PATH/TO/host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/"
  ]
}
```

Replace:
- `/ABSOLUTE/PATH/TO/host` with the actual path to the compiled host binary
- `YOUR_EXTENSION_ID` with your 32-character extension ID

### 3. Place the manifest

**macOS:**
```bash
mkdir -p ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts
cp com.t3rpz.obsidian_web_clipper.json ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/
```

**Linux:**
```bash
mkdir -p ~/.config/google-chrome/NativeMessagingHosts
cp com.t3rpz.obsidian_web_clipper.json ~/.config/google-chrome/NativeMessagingHosts/
```

**Windows:**
```cmd
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.t3rpz.obsidian_web_clipper" /ve /t REG_SZ /d "C:\path\to\com.t3rpz.obsidian_web_clipper.json" /f
```

## Fallback Behavior

If the native messaging host is not installed or fails:

1. The extension falls back to the **URI scheme** (`obsidian://`) save method
2. If that also fails, it falls back to **copying to clipboard**

You can configure the preferred save method in extension settings.
