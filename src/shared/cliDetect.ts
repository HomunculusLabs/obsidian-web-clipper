/**
 * CLI Auto-Detection Utility
 *
 * Attempts to detect the Obsidian CLI installation path based on platform.
 * Since MV3 service workers cannot spawn processes, this uses common installation
 * locations rather than actual filesystem checks.
 *
 * For full detection with verification, a Native Messaging host is required (Task E2).
 */

/**
 * Common installation paths for Obsidian CLI by platform.
 * These are the most likely locations where users might have the CLI installed.
 */
const COMMON_CLI_PATHS: Record<string, string[]> = {
  // macOS
  // Prefer obsidian-cli package paths first because the app binary is not a
  // reliable command-line interface for note operations.
  darwin: [
    "/opt/homebrew/bin/obsidian-cli",
    "/usr/local/bin/obsidian-cli",
    "~/.local/bin/obsidian-cli",
    "~/bin/obsidian-cli",
    "/Applications/Obsidian.app/Contents/MacOS/obsidian",
    "/usr/local/bin/obsidian",
    "/opt/homebrew/bin/obsidian",
  ],
  // Linux
  linux: [
    "/usr/local/bin/obsidian-cli",
    "/usr/bin/obsidian-cli",
    "~/.local/bin/obsidian-cli",
    "~/bin/obsidian-cli",
    "/usr/local/bin/obsidian",
    "/usr/bin/obsidian",
    "/snap/bin/obsidian",
  ],
  // Windows
  win32: [
    "C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\obsidian-cli\\obsidian-cli.exe",
    "C:\\Program Files\\obsidian-cli\\obsidian-cli.exe",
    "C:\\Program Files (x86)\\obsidian-cli\\obsidian-cli.exe",
    "C:\\Program Files\\Obsidian\\obsidian.exe",
    "C:\\Program Files (x86)\\Obsidian\\obsidian.exe",
    "C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\Obsidian\\obsidian.exe",
    "C:\\Obsidian\\obsidian.exe",
  ],
};

/**
 * Detect the current platform.
 * Returns 'darwin', 'linux', 'win32', or 'unknown'.
 */
export function detectPlatform(): string {
  // In extension context, use navigator.platform
  const platform = navigator.platform || navigator.userAgent || "";

  if (platform.toLowerCase().includes("mac")) return "darwin";
  if (platform.toLowerCase().includes("win")) return "win32";
  if (platform.toLowerCase().includes("linux")) return "linux";

  // Fallback: check userAgent
  const ua = navigator.userAgent || "";
  if (ua.includes("Mac")) return "darwin";
  if (ua.includes("Windows")) return "win32";
  if (ua.includes("Linux")) return "linux";

  return "unknown";
}

/**
 * Get the most likely CLI path for the current platform.
 * Returns the first common path, or empty string if platform is unknown.
 */
export function getDefaultCliPath(): string {
  const platform = detectPlatform();
  const paths = COMMON_CLI_PATHS[platform];

  if (paths && paths.length > 0) {
    return paths[0];
  }

  return "";
}

/**
 * Get all common CLI paths for the current platform.
 * Useful for showing suggestions in the UI.
 */
export function getCommonCliPaths(): string[] {
  const platform = detectPlatform();
  return COMMON_CLI_PATHS[platform] || [];
}

/**
 * CLI detection result
 */
export interface CliDetectionResult {
  /** Whether detection was attempted */
  attempted: boolean;
  /** The detected or guessed path (may be empty) */
  cliPath: string;
  /** The platform that was detected */
  platform: string;
  /** List of alternative paths to try */
  alternatives: string[];
  /** Note about detection limitations */
  note: string;
}

/**
 * Attempt to detect the Obsidian CLI.
 *
 * Since MV3 service workers cannot execute shell commands, this function
 * provides a best-guess based on platform detection and common installation paths.
 *
 * @returns CliDetectionResult with the detected path and metadata
 */
export function detectObsidianCli(): CliDetectionResult {
  const platform = detectPlatform();
  const cliPath = getDefaultCliPath();
  const alternatives = getCommonCliPaths().filter((p) => p !== cliPath);

  return {
    attempted: true,
    cliPath,
    platform,
    alternatives,
    note: platform === "unknown"
      ? "Could not detect platform. Please enter the CLI path manually."
      : "Auto-detection provides common paths. Verify the path exists on your system.",
  };
}
