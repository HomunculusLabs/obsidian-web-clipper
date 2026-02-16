/**
 * Configuration Library for CLI Tools
 *
 * Loads tool defaults from `.webclipper.json` config file.
 * Supports hierarchical config: CLI args > config file > env vars > defaults
 *
 * Config file lookup (in order):
 * 1. --config <path> explicit path
 * 2. ./webclipper.json (no dot, current directory)
 * 3. ./.webclipper.json (dot file, current directory)
 * 4. ~/.webclipper.json (home directory)
 * 5. ~/.config/webclipper/config.json (XDG config directory)
 *
 * Usage:
 *   import { loadConfig, mergeWithDefaults, type WebClipperConfig } from './lib/config';
 *
 *   const config = await loadConfig();
 *   const opts = mergeWithDefaults(cliArgs, config);
 */

import { resolve, dirname, basename } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { CommonCLIOptions, Logger } from "./clipper-core";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Configuration file schema for .webclipper.json
 */
export interface WebClipperConfig {
  /** Config file version for future migrations */
  version?: number;

  /** Obsidian CLI settings */
  obsidian?: {
    /** Use Obsidian CLI by default */
    cli?: boolean;
    /** Path to obsidian-cli binary */
    cliPath?: string;
    /** Default vault name */
    vault?: string;
    /** Default folder path within vault */
    folder?: string;
  };

  /** Browser settings */
  browser?: {
    /** Chrome user data directory for auth */
    profile?: string;
    /** Run in headless mode by default */
    headless?: boolean;
    /** Default wait time for page load (ms) */
    wait?: number;
    /** Default page load timeout (ms) */
    timeout?: number;
  };

  /** Content settings */
  content?: {
    /** Default tags to apply */
    tags?: string[];
    /** Include timestamps in YouTube transcripts */
    timestamps?: boolean;
    /** Image handling mode: "link" | "download-api" | "base64" */
    imageHandling?: string;
  };

  /** Tool-specific settings */
  tools?: {
    /** Batch clip concurrency */
    concurrency?: number;
    /** Continue on error by default */
    continueOnError?: boolean;
    /** Show progress bars */
    progress?: boolean;
    /** Scrape site max depth */
    maxDepth?: number;
    /** Scrape site max pages */
    maxPages?: number;
  };

  /** MCP server settings */
  mcp?: {
    /** Server name for MCP protocol */
    name?: string;
    /** Server version */
    version?: string;
    /** Transport: "stdio" | "http" */
    transport?: "stdio" | "http";
    /** HTTP port (if transport is http) */
    port?: number;
  };

  /** Debug settings */
  debug?: {
    /** Enable debug logging */
    enabled?: boolean;
    /** Log file path */
    logFile?: string;
  };
}

/**
 * Result of loading config
 */
export interface LoadConfigResult {
  /** Loaded config (empty object if no config found) */
  config: WebClipperConfig;
  /** Path to the config file that was loaded (null if none found) */
  configPath: string | null;
  /** Any errors encountered while loading (non-fatal) */
  warnings: string[];
}

/**
 * Options for loading config
 */
export interface LoadConfigOptions {
  /** Explicit config file path (--config flag) */
  configPath?: string;
  /** Starting directory for lookup (defaults to cwd) */
  cwd?: string;
  /** Logger instance */
  log?: Logger;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Current config schema version */
const CONFIG_VERSION = 1;

/** Config file names to search (in priority order) */
const CONFIG_FILE_NAMES = [
  "webclipper.json",      // No dot, current directory
  ".webclipper.json",     // Dot file, current directory
];

/** Home directory config paths */
function getHomeConfigPaths(): string[] {
  const home = homedir();
  return [
    resolve(home, ".webclipper.json"),
    resolve(home, ".config", "webclipper", "config.json"),
  ];
}

// ─── Config Loading ──────────────────────────────────────────────────────────

/**
 * Expand ~ and environment variables in a path
 */
export function expandConfigPath(path: string): string {
  // Expand ~ to home directory
  if (path.startsWith("~")) {
    path = homedir() + path.slice(1);
  }

  // Expand environment variables like $HOME or ${HOME}
  path = path.replace(/\$\{?(\w+)\}?/g, (_, name) => process.env[name] || "");

  return resolve(path);
}

/**
 * Find the config file by searching standard locations
 */
export function findConfigFile(
  explicitPath?: string,
  cwd: string = process.cwd()
): string | null {
  // 1. Explicit path takes priority
  if (explicitPath) {
    const expanded = expandConfigPath(explicitPath);
    if (existsSync(expanded)) {
      return expanded;
    }
    return null;
  }

  // 2. Search current directory
  for (const name of CONFIG_FILE_NAMES) {
    const path = resolve(cwd, name);
    if (existsSync(path)) {
      return path;
    }
  }

  // 3. Search home directory
  for (const path of getHomeConfigPaths()) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

/**
 * Read and parse a config file
 */
export async function readConfigFile(filePath: string): Promise<WebClipperConfig> {
  const content = await readFile(filePath, "utf-8");

  try {
    const parsed = JSON.parse(content);
    return validateConfig(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse config file ${filePath}: ${message}`);
  }
}

/**
 * Validate and normalize config object
 */
export function validateConfig(raw: unknown): WebClipperConfig {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }

  const config = raw as Record<string, unknown>;
  const result: WebClipperConfig = {};

  // Version
  if (typeof config.version === "number") {
    result.version = config.version;
  }

  // Obsidian settings
  if (config.obsidian && typeof config.obsidian === "object") {
    const obs = config.obsidian as Record<string, unknown>;
    result.obsidian = {};

    if (typeof obs.cli === "boolean") result.obsidian.cli = obs.cli;
    if (typeof obs.cliPath === "string") result.obsidian.cliPath = obs.cliPath;
    if (typeof obs.vault === "string") result.obsidian.vault = obs.vault;
    if (typeof obs.folder === "string") result.obsidian.folder = obs.folder;
  }

  // Browser settings
  if (config.browser && typeof config.browser === "object") {
    const br = config.browser as Record<string, unknown>;
    result.browser = {};

    if (typeof br.profile === "string") result.browser.profile = br.profile;
    if (typeof br.headless === "boolean") result.browser.headless = br.headless;
    if (typeof br.wait === "number") result.browser.wait = br.wait;
    if (typeof br.timeout === "number") result.browser.timeout = br.timeout;
  }

  // Content settings
  if (config.content && typeof config.content === "object") {
    const ct = config.content as Record<string, unknown>;
    result.content = {};

    if (Array.isArray(ct.tags)) {
      result.content.tags = ct.tags.filter((t): t is string => typeof t === "string");
    }
    if (typeof ct.timestamps === "boolean") result.content.timestamps = ct.timestamps;
    if (typeof ct.imageHandling === "string") result.content.imageHandling = ct.imageHandling;
  }

  // Tools settings
  if (config.tools && typeof config.tools === "object") {
    const tl = config.tools as Record<string, unknown>;
    result.tools = {};

    if (typeof tl.concurrency === "number") result.tools.concurrency = tl.concurrency;
    if (typeof tl.continueOnError === "boolean") result.tools.continueOnError = tl.continueOnError;
    if (typeof tl.progress === "boolean") result.tools.progress = tl.progress;
    if (typeof tl.maxDepth === "number") result.tools.maxDepth = tl.maxDepth;
    if (typeof tl.maxPages === "number") result.tools.maxPages = tl.maxPages;
  }

  // MCP settings
  if (config.mcp && typeof config.mcp === "object") {
    const mcp = config.mcp as Record<string, unknown>;
    result.mcp = {};

    if (typeof mcp.name === "string") result.mcp.name = mcp.name;
    if (typeof mcp.version === "string") result.mcp.version = mcp.version;
    if (mcp.transport === "stdio" || mcp.transport === "http") {
      result.mcp.transport = mcp.transport;
    }
    if (typeof mcp.port === "number") result.mcp.port = mcp.port;
  }

  // Debug settings
  if (config.debug && typeof config.debug === "object") {
    const dbg = config.debug as Record<string, unknown>;
    result.debug = {};

    if (typeof dbg.enabled === "boolean") result.debug.enabled = dbg.enabled;
    if (typeof dbg.logFile === "string") result.debug.logFile = dbg.logFile;
  }

  return result;
}

/**
 * Load config from file with automatic discovery
 *
 * @param options Load options including explicit config path
 * @returns Config and metadata about where it was loaded from
 */
export async function loadConfig(
  options: LoadConfigOptions = {}
): Promise<LoadConfigResult> {
  const { configPath: explicitPath, cwd, log } = options;
  const warnings: string[] = [];

  // Find config file
  const configPath = findConfigFile(explicitPath, cwd);

  if (!configPath) {
    if (explicitPath) {
      warnings.push(`Config file not found: ${explicitPath}`);
    }
    return { config: {}, configPath: null, warnings };
  }

  // Read and parse
  try {
    const config = await readConfigFile(configPath);
    log?.(`  ℹ️ Loaded config from: ${configPath}`);

    // Check version
    if (config.version && config.version > CONFIG_VERSION) {
      warnings.push(
        `Config version ${config.version} is newer than supported (${CONFIG_VERSION}). ` +
        `Some options may not be recognized.`
      );
    }

    return { config, configPath, warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to load config from ${configPath}: ${message}`);
    return { config: {}, configPath: null, warnings };
  }
}

// ─── Config Merging ──────────────────────────────────────────────────────────

/**
 * Get config values from environment variables
 */
export function getConfigFromEnv(): Partial<WebClipperConfig> {
  const config: Partial<WebClipperConfig> = {};

  // Obsidian settings from env
  const cli = process.env.WEBCLIPPER_CLI;
  const cliPath = process.env.WEBCLIPPER_CLI_PATH;
  const vault = process.env.WEBCLIPPER_VAULT;
  const folder = process.env.WEBCLIPPER_FOLDER;

  if (cli !== undefined || cliPath || vault || folder) {
    config.obsidian = {};
    if (cli !== undefined) config.obsidian.cli = cli === "true" || cli === "1";
    if (cliPath) config.obsidian.cliPath = cliPath;
    if (vault) config.obsidian.vault = vault;
    if (folder) config.obsidian.folder = folder;
  }

  // Browser settings from env
  const profile = process.env.WEBCLIPPER_CHROME_PROFILE || process.env.WEBCLIPPER_PROFILE;
  const headless = process.env.WEBCLIPPER_HEADLESS;
  const wait = process.env.WEBCLIPPER_WAIT;

  if (profile || headless !== undefined || wait) {
    config.browser = {};
    if (profile) config.browser.profile = profile;
    if (headless !== undefined) config.browser.headless = headless !== "false" && headless !== "0";
    if (wait) config.browser.wait = parseInt(wait, 10);
  }

  // Content settings from env
  const tags = process.env.WEBCLIPPER_TAGS;
  const timestamps = process.env.WEBCLIPPER_TIMESTAMPS;

  if (tags || timestamps !== undefined) {
    config.content = {};
    if (tags) config.content.tags = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (timestamps !== undefined) config.content.timestamps = timestamps !== "false" && timestamps !== "0";
  }

  // Tools settings from env
  const concurrency = process.env.WEBCLIPPER_CONCURRENCY;
  const continueOnError = process.env.WEBCLIPPER_CONTINUE_ON_ERROR;

  if (concurrency || continueOnError !== undefined) {
    config.tools = {};
    if (concurrency) config.tools.concurrency = parseInt(concurrency, 10);
    if (continueOnError !== undefined) {
      config.tools.continueOnError = continueOnError === "true" || continueOnError === "1";
    }
  }

  return config;
}

/**
 * Merge config layers: CLI args > config file > env vars > defaults
 *
 * CLI args that are explicitly set override config file values.
 * Config file values override environment variables.
 * Environment variables override defaults.
 */
export function mergeWithDefaults(
  cliOptions: Partial<CommonCLIOptions>,
  fileConfig: WebClipperConfig = {}
): CommonCLIOptions & { concurrency?: number; continueOnError?: boolean; progress?: boolean; timestamps?: boolean } {
  // Start with env config
  const envConfig = getConfigFromEnv();

  // Merge file and env (file takes priority over env)
  const mergedConfig: WebClipperConfig = {
    ...envConfig,
    obsidian: { ...envConfig.obsidian, ...fileConfig.obsidian },
    browser: { ...envConfig.browser, ...fileConfig.browser },
    content: { ...envConfig.content, ...fileConfig.content },
    tools: { ...envConfig.tools, ...fileConfig.tools },
    mcp: { ...envConfig.mcp, ...fileConfig.mcp },
    debug: { ...envConfig.debug, ...fileConfig.debug },
  };

  // Build final options with CLI overrides
  const result: CommonCLIOptions & { concurrency?: number; continueOnError?: boolean; progress?: boolean; timestamps?: boolean } = {
    // Defaults
    cli: false,
    cliPath: "obsidian-cli",
    vault: "Main Vault",
    folder: "Clips",
    profile: null,
    headless: true,
    wait: 5000,
    tags: ["web-clip"],
    json: false,
    stdout: false,

    // Apply merged config values
    ...(mergedConfig.obsidian?.cli !== undefined && { cli: mergedConfig.obsidian.cli }),
    ...(mergedConfig.obsidian?.cliPath && { cliPath: mergedConfig.obsidian.cliPath }),
    ...(mergedConfig.obsidian?.vault && { vault: mergedConfig.obsidian.vault }),
    ...(mergedConfig.obsidian?.folder && { folder: mergedConfig.obsidian.folder }),
    ...(mergedConfig.browser?.profile && { profile: mergedConfig.browser.profile }),
    ...(mergedConfig.browser?.headless !== undefined && { headless: mergedConfig.browser.headless }),
    ...(mergedConfig.browser?.wait && { wait: mergedConfig.browser.wait }),
    ...(mergedConfig.content?.tags && { tags: mergedConfig.content.tags }),
    ...(mergedConfig.tools?.concurrency && { concurrency: mergedConfig.tools.concurrency }),
    ...(mergedConfig.tools?.continueOnError !== undefined && { continueOnError: mergedConfig.tools.continueOnError }),
    ...(mergedConfig.tools?.progress !== undefined && { progress: mergedConfig.tools.progress }),
    ...(mergedConfig.content?.timestamps !== undefined && { timestamps: mergedConfig.content.timestamps }),

    // Apply CLI overrides (only for explicitly set values)
    ...(cliOptions.cli !== undefined && { cli: cliOptions.cli }),
    ...(cliOptions.cliPath && { cliPath: cliOptions.cliPath }),
    ...(cliOptions.vault && { vault: cliOptions.vault }),
    ...(cliOptions.folder && { folder: cliOptions.folder }),
    ...(cliOptions.profile !== undefined && { profile: cliOptions.profile }),
    ...(cliOptions.headless !== undefined && { headless: cliOptions.headless }),
    ...(cliOptions.wait !== undefined && { wait: cliOptions.wait }),
    ...(cliOptions.tags && cliOptions.tags.length > 0 && { tags: cliOptions.tags }),
    ...(cliOptions.json !== undefined && { json: cliOptions.json }),
    ...(cliOptions.stdout !== undefined && { stdout: cliOptions.stdout }),
  };

  return result;
}

/**
 * Generate a sample config file
 */
export function generateSampleConfig(): WebClipperConfig {
  return {
    version: CONFIG_VERSION,
    obsidian: {
      cli: false,
      cliPath: "obsidian-cli",
      vault: "Main Vault",
      folder: "Clips",
    },
    browser: {
      profile: "~/.config/google-chrome/Default",
      headless: true,
      wait: 5000,
      timeout: 60000,
    },
    content: {
      tags: ["web-clip"],
      timestamps: true,
      imageHandling: "link",
    },
    tools: {
      concurrency: 4,
      continueOnError: false,
      progress: true,
      maxDepth: 2,
      maxPages: 50,
    },
    mcp: {
      name: "web-clipper",
      version: "1.0.0",
      transport: "stdio",
      port: 3000,
    },
    debug: {
      enabled: false,
      logFile: null,
    },
  };
}

/**
 * Generate help text for config file usage
 */
export function getConfigHelpText(): string {
  return `
CONFIG FILE:
  Tools load defaults from .webclipper.json in the current directory,
  or from ~/.webclipper.json for global defaults.

  Example config:
    {
      "version": 1,
      "obsidian": {
        "vault": "My Vault",
        "folder": "Notes/Clips"
      },
      "browser": {
        "profile": "~/.config/google-chrome/Default"
      },
      "content": {
        "tags": ["research", "clipped"]
      },
      "tools": {
        "concurrency": 8
      }
    }

  Environment variables (WEBCLIPPER_*) can also set defaults:
    WEBCLIPPER_VAULT="My Vault"
    WEBCLIPPER_FOLDER="Notes/Clips"
    WEBCLIPPER_CHROME_PROFILE="~/.config/google-chrome/Default"
    WEBCLIPPER_TAGS="research,clipped"
    WEBCLIPPER_CONCURRENCY="8"

  Priority: CLI args > config file > env vars > defaults
`;
}
