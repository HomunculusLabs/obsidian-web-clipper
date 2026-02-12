/**
 * Authentication Library for CLI Tools
 *
 * Shared authentication configuration for headless Puppeteer-based tools.
 * Supports Chrome profile paths, cookie files, and common auth patterns.
 *
 * Usage:
 *   import { getAuthConfig, loadCookies, detectChromeProfile } from './lib/auth';
 *
 *   const auth = await getAuthConfig({ profile: '~/.config/google-chrome/Default' });
 *   const browser = await launchBrowser(auth.browserOptions);
 *   await loadCookies(browser, auth.cookiesPath);
 */

import { resolve, expand } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { launchBrowser, type BrowserLaunchOptions, type Logger } from "./clipper-core";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Authentication configuration for CLI tools
 */
export interface AuthConfig {
  /** Resolved Chrome user data directory path */
  profilePath: string | null;
  /** Path to cookies JSON file (Netscape or JSON format) */
  cookiesPath: string | null;
  /** Browser launch options with auth applied */
  browserOptions: BrowserLaunchOptions;
  /** Whether auth is configured */
  hasAuth: boolean;
  /** Source of auth config (profile, cookies, env, detected) */
  authSource: "profile" | "cookies" | "env" | "detected" | "none";
}

/**
 * Cookie format for loading/saving
 */
export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/**
 * Options for getting auth config
 */
export interface GetAuthConfigOptions {
  /** Chrome user data directory path */
  profile?: string | null;
  /** Path to cookies file */
  cookiesPath?: string | null;
  /** Whether to auto-detect Chrome profile */
  autoDetect?: boolean;
  /** Run in headless mode */
  headless?: boolean;
  /** Custom environment variable prefix */
  envPrefix?: string;
  /** Logger instance */
  log?: Logger;
}

/**
 * Chrome profile information
 */
export interface ChromeProfileInfo {
  path: string;
  name: string;
  browser: "chrome" | "chromium" | "brave" | "edge";
  isDefault: boolean;
}

// ─── Path Expansion ──────────────────────────────────────────────────────────

/**
 * Expand ~ and environment variables in a path
 */
export function expandPath(path: string): string {
  // Expand ~ to home directory
  if (path.startsWith("~")) {
    path = homedir() + path.slice(1);
  }

  // Expand environment variables like $HOME or ${HOME}
  path = path.replace(/\$\{?(\w+)\}?/g, (_, name) => process.env[name] || "");

  return resolve(path);
}

// ─── Chrome Profile Detection ────────────────────────────────────────────────

/**
 * Common Chrome profile locations by platform
 */
const CHROME_PROFILE_PATHS: Record<string, string[]> = {
  darwin: [
    "~/Library/Application Support/Google/Chrome/Default",
    "~/Library/Application Support/Google/Chrome/Profile 1",
    "~/Library/Application Support/Chromium/Default",
    "~/Library/Application Support/BraveSoftware/Brave-Browser/Default",
    "~/Library/Application Support/Microsoft Edge/Default",
  ],
  linux: [
    "~/.config/google-chrome/Default",
    "~/.config/google-chrome/Profile 1",
    "~/.config/chromium/Default",
    "~/.config/BraveSoftware/Brave-Browser/Default",
    "~/.config/microsoft-edge/Default",
    "~/snap/chromium/common/chromium/Default",
  ],
  win32: [
    "~/AppData/Local/Google/Chrome/User Data/Default",
    "~/AppData/Local/Chromium/User Data/Default",
    "~/AppData/Local/BraveSoftware/Brave-Browser/User Data/Default",
    "~/AppData/Local/Microsoft/Edge/User Data/Default",
  ],
};

/**
 * Detect available Chrome profiles on the system
 */
export function detectChromeProfiles(): ChromeProfileInfo[] {
  const platform = process.platform;
  const paths = CHROME_PROFILE_PATHS[platform] || [];
  const profiles: ChromeProfileInfo[] = [];

  for (const path of paths) {
    const expanded = expandPath(path);
    if (existsSync(expanded)) {
      // Determine browser type from path
      let browser: ChromeProfileInfo["browser"] = "chrome";
      if (path.includes("Chromium")) browser = "chromium";
      else if (path.includes("Brave")) browser = "brave";
      else if (path.includes("Edge")) browser = "edge";

      // Extract profile name
      const name = path.split("/").pop() || "Default";

      profiles.push({
        path: expanded,
        name,
        browser,
        isDefault: name === "Default",
      });
    }
  }

  return profiles;
}

/**
 * Detect the first available Chrome profile
 */
export function detectChromeProfile(): string | null {
  const profiles = detectChromeProfiles();
  // Prefer Default profile
  const defaultProfile = profiles.find((p) => p.isDefault);
  if (defaultProfile) return defaultProfile.path;
  return profiles[0]?.path || null;
}

// ─── Cookie Management ───────────────────────────────────────────────────────

/**
 * Parse Netscape cookies.txt format
 */
export function parseNetscapeCookies(content: string): Cookie[] {
  const cookies: Cookie[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith("#") || !line.trim()) continue;

    // Format: domain\tflag\tpath\tsecure\texpiration\tname\tvalue
    const parts = line.split("\t");
    if (parts.length >= 7) {
      cookies.push({
        domain: parts[0],
        path: parts[2],
        secure: parts[3] === "TRUE",
        expires: parseInt(parts[4], 10) || undefined,
        name: parts[5],
        value: parts[6],
      });
    }
  }

  return cookies;
}

/**
 * Load cookies from a file (supports JSON and Netscape format)
 */
export async function loadCookiesFromFile(filePath: string): Promise<Cookie[]> {
  const expanded = expandPath(filePath);

  if (!existsSync(expanded)) {
    throw new Error(`Cookies file not found: ${expanded}`);
  }

  const content = await readFile(expanded, "utf-8");

  // Try JSON first
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    // Handle { cookies: [...] } format
    if (parsed.cookies && Array.isArray(parsed.cookies)) {
      return parsed.cookies;
    }
  } catch {
    // Not JSON, try Netscape format
  }

  // Try Netscape format
  const netscapeCookies = parseNetscapeCookies(content);
  if (netscapeCookies.length > 0) {
    return netscapeCookies;
  }

  throw new Error(`Could not parse cookies file: ${expanded}`);
}

/**
 * Save cookies to a JSON file
 */
export async function saveCookiesToFile(
  cookies: Cookie[],
  filePath: string
): Promise<void> {
  const expanded = expandPath(filePath);
  await writeFile(expanded, JSON.stringify(cookies, null, 2), "utf-8");
}

/**
 * Load cookies into a Puppeteer page
 */
export async function setCookiesOnPage(
  page: import("puppeteer").Page,
  cookies: Cookie[]
): Promise<void> {
  await page.setCookie(...cookies);
}

/**
 * Extract cookies from a Puppeteer page
 */
export async function getCookiesFromPage(
  page: import("puppeteer").Page
): Promise<Cookie[]> {
  const cookies = await page.cookies();
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite as Cookie["sameSite"],
  }));
}

// ─── Environment Variables ───────────────────────────────────────────────────

/**
 * Get auth config from environment variables
 */
export function getAuthFromEnv(prefix = "WEBCLIPPER"): {
  profile: string | null;
  cookiesPath: string | null;
} {
  const profile = process.env[`${prefix}_CHROME_PROFILE`] ||
                  process.env[`${prefix}_PROFILE`] ||
                  process.env.CHROME_PROFILE ||
                  null;

  const cookiesPath = process.env[`${prefix}_COOKIES_FILE`] ||
                      process.env[`${prefix}_COOKIES`] ||
                      process.env.COOKIES_FILE ||
                      null;

  return {
    profile: profile ? expandPath(profile) : null,
    cookiesPath: cookiesPath ? expandPath(cookiesPath) : null,
  };
}

// ─── Main Auth Config Function ───────────────────────────────────────────────

/**
 * Get complete auth configuration for CLI tools
 *
 * Priority order:
 * 1. Explicit options (profile, cookiesPath)
 * 2. Environment variables (WEBCLIPPER_CHROME_PROFILE, WEBCLIPPER_COOKIES)
 * 3. Auto-detected Chrome profile (if autoDetect is true)
 */
export async function getAuthConfig(options: GetAuthConfigOptions = {}): Promise<AuthConfig> {
  const {
    profile: explicitProfile,
    cookiesPath: explicitCookies,
    autoDetect = true,
    headless = true,
    envPrefix = "WEBCLIPPER",
    log,
  } = options;

  let profilePath: string | null = null;
  let cookiesPath: string | null = null;
  let authSource: AuthConfig["authSource"] = "none";

  // 1. Check explicit options
  if (explicitProfile) {
    profilePath = expandPath(explicitProfile);
    authSource = "profile";
  } else if (explicitCookies) {
    cookiesPath = expandPath(explicitCookies);
    authSource = "cookies";
  }

  // 2. Check environment variables
  if (!profilePath && !cookiesPath) {
    const envAuth = getAuthFromEnv(envPrefix);
    if (envAuth.profile) {
      profilePath = envAuth.profile;
      authSource = "env";
    } else if (envAuth.cookiesPath) {
      cookiesPath = envAuth.cookiesPath;
      authSource = "env";
    }
  }

  // 3. Auto-detect Chrome profile
  if (!profilePath && !cookiesPath && autoDetect) {
    const detected = detectChromeProfile();
    if (detected) {
      profilePath = detected;
      authSource = "detected";
      log?.(`  ℹ️ Auto-detected Chrome profile: ${detected}`);
    }
  }

  const hasAuth = profilePath !== null || cookiesPath !== null;

  const browserOptions: BrowserLaunchOptions = {
    headless,
    profile: profilePath,
    extraArgs: profilePath
      ? [
          // Use existing profile without locking it
          "--disable-extensions",
          "--no-first-run",
          "--disable-default-apps",
        ]
      : undefined,
  };

  return {
    profilePath,
    cookiesPath,
    browserOptions,
    hasAuth,
    authSource,
  };
}

/**
 * Create a browser with authentication applied
 */
export async function createAuthenticatedBrowser(
  options: GetAuthConfigOptions = {}
): Promise<{
  browser: import("puppeteer").Browser;
  auth: AuthConfig;
}> {
  const auth = await getAuthConfig(options);
  const browser = await launchBrowser(auth.browserOptions);

  // Load cookies if provided
  if (auth.cookiesPath) {
    const page = await browser.newPage();
    try {
      const cookies = await loadCookiesFromFile(auth.cookiesPath);
      await setCookiesOnPage(page, cookies);
      options.log?.(`  ℹ️ Loaded ${cookies.length} cookies from ${auth.cookiesPath}`);
    } catch (err) {
      options.log?.(`  ⚠️ Failed to load cookies: ${err}`);
    }
    // Close this page - the caller will create their own
    await page.close();
  }

  return { browser, auth };
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Check if a URL requires authentication
 */
export function requiresAuth(url: string): boolean {
  const parsed = new URL(url);

  // Common sites that require auth for full content
  const authRequiredDomains = [
    "twitter.com",
    "x.com",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "medium.com",
    "substack.com",
    "nytimes.com",
    "wsj.com",
    "washingtonpost.com",
    "theverge.com",
  ];

  return authRequiredDomains.some(
    (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
  );
}

/**
 * Get recommended auth method for a URL
 */
export function getRecommendedAuthMethod(url: string): "profile" | "cookies" | "none" {
  if (!requiresAuth(url)) return "none";

  const parsed = new URL(url);

  // Sites that work better with cookies
  const cookiePreferred = [
    "medium.com",
    "substack.com",
  ];

  if (cookiePreferred.some((d) => parsed.hostname.endsWith(d))) {
    return "cookies";
  }

  return "profile";
}
