/**
 * Handler for auto-detecting Obsidian CLI installation.
 *
 * Uses the native messaging bridge to verify candidate paths so the UI
 * only reports a CLI path when it can actually spawn successfully.
 */

import { detectPlatform, getCommonCliPaths } from "../../shared/cliDetect";
import type { DetectCliResponse } from "../../shared/messages";
import { sendNativeBridgeMessage } from "../nativeMessaging";

interface DetectCliRequest {
  action: "detectCli";
}

type CliProbeResponse = {
  version?: string;
  cliVersion?: string;
};

type CliProbeState = {
  verified: boolean;
  hostMissing: boolean;
};

function uniqueCandidates(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of paths) {
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

async function probeCliPath(cliPath: string): Promise<CliProbeState> {
  const response = await sendNativeBridgeMessage<CliProbeResponse>({
    action: "testCliConnection",
    payload: {
      cliPath,
      vault: "Obsidian Web Clipper"
    }
  });

  if (response.success) {
    return { verified: true, hostMissing: false };
  }

  const error = response.error || "";
  const hostMissing =
    error.includes("Specified native messaging host not found") ||
    error.includes("native messaging host not found") ||
    error.includes("HOST_NOT_FOUND") ||
    error.includes("Native Messaging bridge error");

  return { verified: false, hostMissing };
}

function normalizeProbeResult(result: CliProbeState | boolean): CliProbeState {
  if (typeof result === "boolean") {
    return { verified: result, hostMissing: false };
  }

  return result;
}

/**
 * Verify the CLI path against the native host.
 * Returns the first working CLI path, or an empty result if none are verified.
 */
export async function detectVerifiedCli(
  bridgeProbe: typeof probeCliPath = probeCliPath
): Promise<DetectCliResponse> {
  const platform = detectPlatform();
  const candidates = uniqueCandidates([
    ...getCommonCliPaths(),
    "obsidian-cli",
    "obsidian"
  ]);

  for (const candidate of candidates) {
    const probe = normalizeProbeResult(await bridgeProbe(candidate));
    if (probe.verified) {
      return {
        attempted: true,
        cliPath: candidate,
        platform,
        alternatives: candidates.filter((value) => value !== candidate),
        note: `Verified Obsidian CLI path via native host: ${candidate}`
      };
    }

    if (probe.hostMissing) {
      return {
        attempted: true,
        cliPath: "",
        platform,
        alternatives: candidates,
        note:
          "Native Messaging host is not installed, so the CLI path cannot be verified yet. Install the host first, then run detection again."
      };
    }
  }

  return {
    attempted: true,
    cliPath: "",
    platform,
    alternatives: candidates,
    note:
      "No working Obsidian CLI path could be verified. Enter the path manually or ensure obsidian-cli is available in PATH."
  };
}

/**
 * Handle CLI detection request.
 */
export async function handleDetectCli(
  _request: DetectCliRequest
): Promise<DetectCliResponse> {
  return await detectVerifiedCli();
}
