/**
 * Debug logging utility that only logs when settings.debug is true.
 * Use this instead of console.log for all development/debugging output.
 */

let debugEnabled = false;

/**
 * Initialize debug mode. Call this on extension load with settings.
 */
export function initDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

/**
 * Check if debug mode is enabled.
 */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

/**
 * Log a debug message if debug mode is enabled.
 * Prefixes all messages with [Clipper] for easy filtering.
 * 
 * @param tag - Module/component tag (e.g., "PDF", "Twitter", "Clip")
 * @param args - Values to log
 */
export function debug(tag: string, ...args: unknown[]): void {
  if (!debugEnabled) return;
  
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`[${timestamp}] [Clipper/${tag}]`, ...args);
}

/**
 * Log a debug warning if debug mode is enabled.
 * @param tag - Module/component tag
 * @param args - Values to log
 */
export function debugWarn(tag: string, ...args: unknown[]): void {
  if (!debugEnabled) return;
  
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  console.warn(`[${timestamp}] [Clipper/${tag}]`, ...args);
}

/**
 * Log a debug error if debug mode is enabled.
 * @param tag - Module/component tag
 * @param args - Values to log
 */
export function debugError(tag: string, ...args: unknown[]): void {
  if (!debugEnabled) return;
  
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  console.error(`[${timestamp}] [Clipper/${tag}]`, ...args);
}
