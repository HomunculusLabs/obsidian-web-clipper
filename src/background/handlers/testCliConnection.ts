/**
 * Handler for testing Obsidian CLI connection via Native Messaging.
 *
 * MV3 service workers cannot spawn local processes directly, so this delegates
 * binary + vault validation to the native bridge host.
 */

import type { TestCliConnectionResponse } from "../../shared/messages";
import { sendNativeBridgeMessage } from "../nativeMessaging";

interface TestCliConnectionRequest {
  action: "testCliConnection";
  cliPath: string;
  vault: string;
}

type TestCliBridgeData = {
  version?: unknown;
  cliVersion?: unknown;
};

function getVersion(data: TestCliBridgeData | undefined): string | undefined {
  const version =
    typeof data?.version === "string"
      ? data.version.trim()
      : typeof data?.cliVersion === "string"
        ? data.cliVersion.trim()
        : "";

  return version.length > 0 ? version : undefined;
}

export async function handleTestCliConnection(
  request: TestCliConnectionRequest
): Promise<TestCliConnectionResponse> {
  const cliPath = request.cliPath?.trim();
  const vault = request.vault?.trim();

  if (!cliPath) {
    return { success: false, error: "CLI path is required" };
  }

  if (!vault) {
    return { success: false, error: "Vault name is required" };
  }

  const bridgeResponse = await sendNativeBridgeMessage<TestCliBridgeData>({
    action: "testCliConnection",
    payload: {
      cliPath,
      vault
    }
  });

  if (!bridgeResponse.success) {
    return {
      success: false,
      error: bridgeResponse.error
    };
  }

  return {
    success: true,
    version: getVersion(bridgeResponse.data)
  };
}
