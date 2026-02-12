/**
 * Handler for testing Obsidian CLI connection.
 *
 * NOTE: Manifest V3 service workers cannot spawn local processes directly.
 * This handler validates the CLI path format and returns a placeholder response.
 * Full CLI integration requires a Native Messaging host (to be implemented in Task 6/E2).
 */

import type { TestCliConnectionResponse } from "../../shared/messages";

interface TestCliConnectionRequest {
  action: "testCliConnection";
  cliPath: string;
  vault: string;
}

/**
 * Validates that the CLI path looks like a valid file path.
 * Does not actually test the connection (requires Native Messaging host).
 */
export async function handleTestCliConnection(
  request: TestCliConnectionRequest
): Promise<TestCliConnectionResponse> {
  const { cliPath, vault } = request;

  // Basic path validation
  if (!cliPath || cliPath.trim() === "") {
    return { success: false, error: "CLI path is required" };
  }

  // Check for obvious invalid paths
  const trimmedPath = cliPath.trim();

  // Basic validation: should contain at least a filename
  if (trimmedPath.length < 3) {
    return { success: false, error: "Path too short" };
  }

  // Check for common path separators (Unix or Windows)
  const hasValidPathChars = /[\/\\]/.test(trimmedPath) || /^[a-zA-Z]:/.test(trimmedPath);
  if (!hasValidPathChars && !trimmedPath.includes("obsidian")) {
    return {
      success: false,
      error: "Path should be an absolute path to the obsidian CLI binary"
    };
  }

  // MV3 limitation: cannot actually spawn processes from service worker
  // Full test requires Native Messaging host (Task 6/E2)
  // For now, return success if path looks valid
  return {
    success: true,
    version: "validation-only"
  };
}
