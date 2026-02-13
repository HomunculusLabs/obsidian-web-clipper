/**
 * AppError - Standardized error handling for Obsidian Web Clipper
 *
 * This module provides a typed error hierarchy for consistent error handling
 * across the extension. All custom errors extend AppError and include:
 * - A code for programmatic error handling
 * - Optional cause for error chaining
 * - Optional context for debugging
 */

// Error codes for programmatic handling
export type ErrorCode =
  // Extraction errors
  | "EXTRACTION_FAILED"
  | "ARTICLE_NOT_FOUND"
  | "PDF_EXTRACTION_FAILED"
  | "YOUTUBE_EXTRACTION_FAILED"
  | "TWITTER_EXTRACTION_FAILED"
  // Save errors
  | "SAVE_FAILED"
  | "SAVE_ALL_METHODS_FAILED"
  | "URI_TOO_LARGE"
  | "URI_OPEN_FAILED"
  // Tab/URL errors
  | "TAB_NOT_FOUND"
  | "TAB_NO_ID"
  | "URL_UNSUPPORTED"
  | "CONTENT_SCRIPT_INJECT_FAILED"
  // Router errors
  | "UNKNOWN_ACTION"
  | "UNKNOWN_PAGE_TYPE"
  // CLI errors
  | "CLI_NOT_ENABLED"
  | "CLI_NOT_CONFIGURED"
  | "CLI_SPAWN_FAILED"
  | "CLI_EXECUTION_FAILED"
  // Clipboard errors
  | "CLIPBOARD_UNAVAILABLE"
  | "CLIPBOARD_WRITE_FAILED"
  // Network errors
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  // Generic
  | "UNKNOWN_ERROR";

/**
 * Base class for all application errors.
 * Extends the native Error class with error codes and cause chaining.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly cause?: Error;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: ErrorCode = "UNKNOWN_ERROR",
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.cause = options?.cause;
    this.context = options?.context;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Returns a JSON-serializable representation of the error
   */
  toJSON(): { name: string; message: string; code: ErrorCode; cause?: string; context?: Record<string, unknown> } {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      cause: this.cause?.message,
      context: this.context
    };
  }
}

/**
 * Error during content extraction from a page
 */
export class ExtractionError extends AppError {
  constructor(
    message: string,
    code: Extract<ErrorCode, "EXTRACTION_FAILED" | "ARTICLE_NOT_FOUND" | "PDF_EXTRACTION_FAILED" | "YOUTUBE_EXTRACTION_FAILED" | "TWITTER_EXTRACTION_FAILED"> = "EXTRACTION_FAILED",
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, code, options);
    this.name = "ExtractionError";
  }
}

/**
 * Error during saving to Obsidian
 */
export class SaveError extends AppError {
  constructor(
    message: string,
    code: Extract<ErrorCode, "SAVE_FAILED" | "SAVE_ALL_METHODS_FAILED" | "URI_TOO_LARGE" | "URI_OPEN_FAILED"> = "SAVE_FAILED",
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, code, options);
    this.name = "SaveError";
  }
}

/**
 * Error related to tab access or URL validation
 */
export class TabError extends AppError {
  constructor(
    message: string,
    code: Extract<ErrorCode, "TAB_NOT_FOUND" | "TAB_NO_ID" | "URL_UNSUPPORTED" | "CONTENT_SCRIPT_INJECT_FAILED"> = "TAB_NOT_FOUND",
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, code, options);
    this.name = "TabError";
  }
}

/**
 * Error in message routing or action handling
 */
export class RouterError extends AppError {
  constructor(
    message: string,
    code: Extract<ErrorCode, "UNKNOWN_ACTION" | "UNKNOWN_PAGE_TYPE"> = "UNKNOWN_ACTION",
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, code, options);
    this.name = "RouterError";
  }
}

/**
 * Error related to Obsidian CLI operations
 */
export class CliError extends AppError {
  constructor(
    message: string,
    code: Extract<ErrorCode, "CLI_NOT_ENABLED" | "CLI_NOT_CONFIGURED" | "CLI_SPAWN_FAILED" | "CLI_EXECUTION_FAILED"> = "CLI_EXECUTION_FAILED",
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, code, options);
    this.name = "CliError";
  }
}

/**
 * Error related to clipboard operations
 */
export class ClipboardError extends AppError {
  constructor(
    message: string,
    code: Extract<ErrorCode, "CLIPBOARD_UNAVAILABLE" | "CLIPBOARD_WRITE_FAILED"> = "CLIPBOARD_UNAVAILABLE",
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, code, options);
    this.name = "ClipboardError";
  }
}

/**
 * Error related to network/HTTP operations
 */
export class NetworkError extends AppError {
  constructor(
    message: string,
    code: Extract<ErrorCode, "NETWORK_ERROR" | "HTTP_ERROR"> = "NETWORK_ERROR",
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, code, options);
    this.name = "NetworkError";
  }
}

// ============================================================================
// Type Guards and Utilities
// ============================================================================

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Type guard to check if an error has a specific code
 */
export function hasErrorCode(error: unknown, code: ErrorCode): error is AppError {
  return isAppError(error) && error.code === code;
}

/**
 * Convert an unknown error to an AppError
 */
export function toAppError(err: unknown, fallbackCode: ErrorCode = "UNKNOWN_ERROR"): AppError {
  if (isAppError(err)) {
    return err;
  }

  if (err instanceof Error) {
    return new AppError(err.message, fallbackCode, { cause: err });
  }

  if (typeof err === "string") {
    return new AppError(err, fallbackCode);
  }

  return new AppError("An unknown error occurred", fallbackCode, { context: { originalError: err } });
}

/**
 * Check if a value is a record (object)
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Convert an error to a user-friendly message
 */
export function toErrorMessage(err: unknown, fallback: string = "Unknown error"): string {
  if (isAppError(err)) {
    return err.message || fallback;
  }
  if (err instanceof Error) {
    return err.message || fallback;
  }
  if (typeof err === "string") {
    return err || fallback;
  }
  return fallback;
}

/**
 * Get the deepest cause message from an error chain
 */
export function getRootCause(err: unknown): string {
  if (!isAppError(err) || !err.cause) {
    return toErrorMessage(err);
  }
  return getRootCause(err.cause);
}
