/**
 * Handler for testing if the Native Messaging host is installed.
 *
 * This is a lightweight ping to check if the native host binary exists
 * and can communicate, without requiring a valid CLI configuration.
 */

import { sendNativeBridgeMessage } from "../nativeMessaging";

export interface TestNativeHostRequest {
  action: "testNativeHost";
}

export interface TestNativeHostResponse {
  success: boolean;
  error?: string;
  code?: string;
}

/**
 * Test if the native messaging host is installed and responding.
 * Uses a minimal ping request that doesn't require CLI configuration.
 */
export async function handleTestNativeHost(
  _request: TestNativeHostRequest
): Promise<TestNativeHostResponse> {
  // Try to send a test message to the native host
  // We use testCliConnection with empty params as a ping
  // The native host will respond even if CLI path is invalid
  const bridgeResponse = await sendNativeBridgeMessage<unknown>({
    action: "testCliConnection",
    payload: {
      cliPath: "",
      vault: ""
    }
  });

  if (!bridgeResponse.success) {
    // Check if the error indicates the host is missing
    const error = bridgeResponse.error || "";
    if (
      error.includes("Specified native messaging host not found") ||
      error.includes("native messaging host not found") ||
      error.includes("HOST_NOT_FOUND")
    ) {
      return {
        success: false,
        error: "Native messaging host not installed",
        code: "HOST_NOT_FOUND"
      };
    }

    // If we got an error but it's not about the host being missing,
    // that means the host IS installed but there was an issue with the request
    // (e.g., invalid CLI path), which is fine for our ping purposes
    if (
      error.includes("INVALID_CLI_PATH") ||
      error.includes("INVALID_VAULT") ||
      error.includes("CLI must be") ||
      error.includes("must be a non-empty")
    ) {
      // The host is installed and responding - the error is just about invalid params
      return { success: true };
    }

    // Other error - host might be installed but having issues
    return {
      success: false,
      error: bridgeResponse.error,
      code: bridgeResponse.code
    };
  }

  // Success - host is installed and working
  return { success: true };
}
