/**
 * Handler for auto-detecting Obsidian CLI installation.
 *
 * Uses platform detection and common installation paths since MV3
 * service workers cannot execute shell commands.
 */

import { detectObsidianCli } from "../../shared/cliDetect";
import type { DetectCliResponse } from "../../shared/messages";

interface DetectCliRequest {
  action: "detectCli";
}

/**
 * Handle CLI detection request.
 * Returns common CLI paths based on the detected platform.
 */
export async function handleDetectCli(
  _request: DetectCliRequest
): Promise<DetectCliResponse> {
  return detectObsidianCli();
}
