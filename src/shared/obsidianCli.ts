/**
 * Obsidian CLI Integration Types
 * 
 * Types for integrating with the Obsidian CLI for direct file operations.
 */

/**
 * Configuration for the Obsidian CLI integration
 */
export interface ObsidianCliConfig {
  /** Path to the obsidian CLI binary (e.g., '/opt/homebrew/bin/obsidian-cli') */
  cliPath: string;
  
  /** Target vault name for saves */
  vault: string;
  
  /** Enable/disable CLI integration */
  enabled: boolean;
}

/**
 * Available save methods for clipping content
 * - cli: Use Obsidian CLI for direct file creation
 * - uri: Use obsidian:// URI scheme
 * - clipboard: Copy to clipboard
 */
export type SaveMethod = "cli" | "uri" | "clipboard";
