#!/usr/bin/env bun
/**
 * Cross-platform Native Messaging Host Installer for Obsidian Web Clipper
 *
 * Usage: bun run install.ts --extension-id <id> [--browser chrome|chromium|brave|edge]
 *
 * This script handles the installation of the native messaging host for
 * Chrome-based browsers on macOS, Linux, and Windows.
 */

import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const HOST_NAME = "com.t3rpz.obsidian_web_clipper";

type Browser = "chrome" | "chromium" | "brave" | "edge";

interface InstallConfig {
  extensionId: string;
  browser: Browser;
  uninstall: boolean;
}

interface BrowserPaths {
  manifestDir: string;
  registryPath?: string; // Windows only
}

function getBrowserPaths(browser: Browser): BrowserPaths {
  const platform = os.platform();
  const homeDir = os.homedir();

  switch (browser) {
    case "chrome":
      if (platform === "darwin") {
        return {
          manifestDir: path.join(
            homeDir,
            "Library",
            "Application Support",
            "Google",
            "Chrome",
            "NativeMessagingHosts"
          ),
        };
      } else if (platform === "win32") {
        return {
          manifestDir: path.join(
            process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"),
            "Google",
            "Chrome",
            "NativeMessagingHosts"
          ),
          registryPath:
            "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\" + HOST_NAME,
        };
      } else {
        return {
          manifestDir: path.join(homeDir, ".config", "google-chrome", "NativeMessagingHosts"),
        };
      }

    case "chromium":
      if (platform === "darwin") {
        return {
          manifestDir: path.join(
            homeDir,
            "Library",
            "Application Support",
            "Chromium",
            "NativeMessagingHosts"
          ),
        };
      } else if (platform === "win32") {
        return {
          manifestDir: path.join(
            process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"),
            "Chromium",
            "NativeMessagingHosts"
          ),
          registryPath:
            "HKCU\\Software\\Chromium\\NativeMessagingHosts\\" + HOST_NAME,
        };
      } else {
        return {
          manifestDir: path.join(homeDir, ".config", "chromium", "NativeMessagingHosts"),
        };
      }

    case "brave":
      if (platform === "darwin") {
        return {
          manifestDir: path.join(
            homeDir,
            "Library",
            "Application Support",
            "BraveSoftware",
            "Brave-Browser",
            "NativeMessagingHosts"
          ),
        };
      } else if (platform === "win32") {
        return {
          manifestDir: path.join(
            process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"),
            "BraveSoftware",
            "Brave-Browser",
            "NativeMessagingHosts"
          ),
          registryPath:
            "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\" +
            HOST_NAME,
        };
      } else {
        return {
          manifestDir: path.join(
            homeDir,
            ".config",
            "BraveSoftware",
            "Brave-Browser",
            "NativeMessagingHosts"
          ),
        };
      }

    case "edge":
      if (platform === "darwin") {
        return {
          manifestDir: path.join(
            homeDir,
            "Library",
            "Application Support",
            "Microsoft Edge",
            "NativeMessagingHosts"
          ),
        };
      } else if (platform === "win32") {
        return {
          manifestDir: path.join(
            process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"),
            "Microsoft",
            "Edge",
            "NativeMessagingHosts"
          ),
          registryPath:
            "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\" + HOST_NAME,
        };
      } else {
        return {
          manifestDir: path.join(homeDir, ".config", "microsoft-edge", "NativeMessagingHosts"),
        };
      }
  }
}

function getHostBinPath(): string {
  const platform = os.platform();
  const homeDir = os.homedir();

  if (platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"),
      "ObsidianWebClipper",
      "host.exe"
    );
  } else {
    return path.join(homeDir, ".local", "share", "obsidian-web-clipper", "host");
  }
}

function getManifestPath(browser: Browser): string {
  const { manifestDir } = getBrowserPaths(browser);
  return path.join(manifestDir, `${HOST_NAME}.json`);
}

function printUsage(): void {
  console.log(`
Native Messaging Host Installer for Obsidian Web Clipper

Usage: bun run install.ts [OPTIONS]

Required:
  --extension-id <id>    Chrome extension ID (32 character string)

Optional:
  --browser <name>       Target browser: chrome (default), chromium, brave, edge
  --uninstall            Remove the native messaging host instead of installing
  --help                 Show this help message

Examples:
  bun run install.ts --extension-id abcdefghijklmnopqrstuvwxyz123456
  bun run install.ts --extension-id abcdefghijklmnopqrstuvwxyz123456 --browser brave
  bun run install.ts --uninstall

How to find your extension ID:
  1. Open chrome://extensions
  2. Enable "Developer mode" (top right)
  3. Find "Obsidian Web Clipper" and copy the ID

Supported browsers:
  chrome   - Google Chrome (default)
  chromium - Chromium
  brave    - Brave Browser
  edge     - Microsoft Edge
`);
}

function validateExtensionId(id: string): boolean {
  return /^[a-z]{32}$/.test(id);
}

async function runCommand(
  cmd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", () => {
      resolve({ stdout, stderr, code: null });
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

async function compileHost(hostBinPath: string): Promise<boolean> {
  const scriptDir = import.meta.dir;
  const hostSource = path.join(scriptDir, "host.ts");

  console.log(`[INFO] Compiling native messaging host...`);

  // Build compile args - for Windows, add --windows-hide-console
  const compileArgs = ["build", "--compile"];
  if (os.platform() === "win32") {
    compileArgs.push("--windows-hide-console");
  }
  compileArgs.push("--outfile", hostBinPath, hostSource);

  const result = await runCommand("bun", compileArgs);

  if (result.code !== 0) {
    console.error(`[ERROR] Failed to compile host: ${result.stderr || result.stdout}`);
    return false;
  }

  // Make executable on Unix
  if (os.platform() !== "win32") {
    fs.chmodSync(hostBinPath, 0o755);
  }

  console.log(`[SUCCESS] Created host binary: ${hostBinPath}`);
  return true;
}

function createManifest(manifestPath: string, hostBinPath: string, extensionId: string): void {
  const manifestDir = path.dirname(manifestPath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(manifestDir)) {
    fs.mkdirSync(manifestDir, { recursive: true });
    console.log(`[INFO] Created directory: ${manifestDir}`);
  }

  const manifest = {
    name: HOST_NAME,
    description:
      "Native messaging host for Obsidian Web Clipper - enables direct CLI integration for saving clips to Obsidian vaults",
    path: hostBinPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[SUCCESS] Created manifest: ${manifestPath}`);
}

async function createWindowsRegistryEntry(registryPath: string, manifestPath: string): Promise<boolean> {
  // On Windows, we need to create a registry entry instead of a manifest file
  const result = await runCommand("reg", ["add", registryPath, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"]);

  if (result.code !== 0) {
    console.error(`[ERROR] Failed to create registry entry: ${result.stderr || result.stdout}`);
    return false;
  }

  console.log(`[SUCCESS] Created registry entry: ${registryPath}`);
  return true;
}

function uninstall(config: InstallConfig): void {
  console.log(`[INFO] Uninstalling native messaging host...`);

  const hostBinPath = getHostBinPath();
  const manifestPath = getManifestPath(config.browser);
  const { registryPath } = getBrowserPaths(config.browser);

  // Remove manifest file (Unix) or registry entry (Windows)
  if (os.platform() === "win32" && registryPath) {
    // Remove registry entry
    const result = spawn("reg", ["delete", registryPath, "/f"], { stdio: "inherit" });
    if (result.exitCode === 0) {
      console.log(`[SUCCESS] Removed registry entry`);
    } else {
      console.log(`[INFO] Registry entry not found or already removed`);
    }

    // Also remove the manifest file if it exists
    if (fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
      console.log(`[SUCCESS] Removed manifest: ${manifestPath}`);
    }
  } else {
    // Remove manifest file (macOS/Linux)
    if (fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
      console.log(`[SUCCESS] Removed manifest: ${manifestPath}`);
    } else {
      console.log(`[INFO] Manifest not found: ${manifestPath}`);
    }
  }

  // Remove host binary
  if (fs.existsSync(hostBinPath)) {
    fs.unlinkSync(hostBinPath);
    console.log(`[SUCCESS] Removed host binary: ${hostBinPath}`);
  }

  // Try to clean up empty directory
  const hostBinDir = path.dirname(hostBinPath);
  if (fs.existsSync(hostBinDir)) {
    const files = fs.readdirSync(hostBinDir);
    if (files.length === 0) {
      fs.rmdirSync(hostBinDir);
      console.log(`[INFO] Removed empty directory: ${hostBinDir}`);
    }
  }

  console.log(`\n[SUCCESS] Uninstall complete!`);
}

async function install(config: InstallConfig): Promise<void> {
  const hostBinPath = getHostBinPath();
  const manifestPath = getManifestPath(config.browser);
  const { registryPath } = getBrowserPaths(config.browser);

  console.log(`[INFO] Platform: ${os.platform()} (${os.arch()})`);
  console.log(`[INFO] Browser: ${config.browser}`);
  console.log(`[INFO] Extension ID: ${config.extensionId}`);

  // Create host binary directory
  const hostBinDir = path.dirname(hostBinPath);
  if (!fs.existsSync(hostBinDir)) {
    fs.mkdirSync(hostBinDir, { recursive: true });
    console.log(`[INFO] Created host binary directory: ${hostBinDir}`);
  }

  // Compile host
  const compiled = await compileHost(hostBinPath);
  if (!compiled) {
    process.exit(1);
  }

  // Create manifest (Unix) or registry entry (Windows)
  if (os.platform() === "win32" && registryPath) {
    // Windows: Create manifest file AND registry entry
    createManifest(manifestPath, hostBinPath, config.extensionId);
    const registryCreated = await createWindowsRegistryEntry(registryPath, manifestPath);
    if (!registryCreated) {
      process.exit(1);
    }
  } else {
    // macOS/Linux: Create manifest file
    createManifest(manifestPath, hostBinPath, config.extensionId);
  }

  // Verify installation
  console.log(`\n[INFO] Verifying installation...`);

  if (fs.existsSync(hostBinPath)) {
    console.log(`[SUCCESS] Host binary exists`);
  } else {
    console.error(`[ERROR] Host binary not found`);
    process.exit(1);
  }

  if (fs.existsSync(manifestPath)) {
    console.log(`[SUCCESS] Manifest file exists`);
  } else {
    console.error(`[ERROR] Manifest file not found`);
    process.exit(1);
  }

  // Print summary
  console.log(`
==========================================
[SUCCESS] Native Messaging Host Installed Successfully!
==========================================

Host binary: ${hostBinPath}
Manifest:    ${manifestPath}
Extension:   ${config.extensionId}

Next steps:
  1. Restart ${config.browser} if it's running
  2. Open the Obsidian Web Clipper extension
  3. Go to Settings → Obsidian CLI
  4. Enable 'Use Obsidian CLI' and configure your vault

[INFO] To uninstall, run: bun run install.ts --uninstall
`);
}

async function main(): Promise<void> {
  const args = parseArgs({
    options: {
      "extension-id": { type: "string", short: "e" },
      browser: { type: "string", short: "b", default: "chrome" },
      uninstall: { type: "boolean", short: "u", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositional: false,
  });

  if (args.values.help) {
    printUsage();
    process.exit(0);
  }

  const browser = args.values.browser as Browser;
  const validBrowsers: Browser[] = ["chrome", "chromium", "brave", "edge"];

  if (!validBrowsers.includes(browser)) {
    console.error(`[ERROR] Unsupported browser: ${browser}`);
    console.log(`[INFO] Supported browsers: ${validBrowsers.join(", ")}`);
    process.exit(1);
  }

  const config: InstallConfig = {
    extensionId: args.values["extension-id"] || "",
    browser,
    uninstall: args.values.uninstall,
  };

  if (config.uninstall) {
    uninstall(config);
    return;
  }

  if (!config.extensionId) {
    console.error(`[ERROR] Extension ID is required. Use --extension-id <id>`);
    console.log();
    printUsage();
    process.exit(1);
  }

  if (!validateExtensionId(config.extensionId)) {
    console.warn(
      `[WARNING] Extension ID doesn't look like a standard Chrome extension ID (expected 32 lowercase letters)`
    );
  }

  // Check for bun
  const bunCheck = await runCommand("bun", ["--version"]);
  if (bunCheck.code !== 0) {
    console.error(`[ERROR] Bun is required but not installed.`);
    console.log(`[INFO] Install bun: https://bun.sh`);
    process.exit(1);
  }

  console.log(`[INFO] Bun version: ${bunCheck.stdout.trim()}`);

  await install(config);
}

main().catch((err) => {
  console.error(`[ERROR] ${err.message}`);
  process.exit(1);
});
