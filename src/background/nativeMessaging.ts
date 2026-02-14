export const OBSIDIAN_NATIVE_HOST = "com.t3rpz.obsidian_web_clipper";

type NativeBridgeError = {
  success: false;
  error: string;
  code?: string;
};

type NativeBridgeSuccess<T> = {
  success: true;
  data?: T;
};

export type NativeBridgeResponse<T> = NativeBridgeSuccess<T> | NativeBridgeError;

function getLastErrorMessage(): string | null {
  const lastError = chrome.runtime.lastError;
  return lastError?.message ?? null;
}

export async function sendNativeBridgeMessage<TResponse>(
  message: Record<string, unknown>
): Promise<NativeBridgeResponse<TResponse>> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendNativeMessage) {
    return {
      success: false,
      error:
        "Native Messaging is not available in this environment. Ensure this is running as a Chrome extension with the nativeMessaging permission."
    };
  }

  return await new Promise<NativeBridgeResponse<TResponse>>((resolve) => {
    chrome.runtime.sendNativeMessage(OBSIDIAN_NATIVE_HOST, message, (response: unknown) => {
      const runtimeError = getLastErrorMessage();
      if (runtimeError) {
        resolve({
          success: false,
          error: `Native Messaging bridge error: ${runtimeError}`
        });
        return;
      }

      if (!response || typeof response !== "object") {
        resolve({
          success: false,
          error: "Native Messaging bridge returned an invalid response payload"
        });
        return;
      }

      const bridgeResponse = response as {
        success?: boolean;
        error?: string;
        code?: string;
        data?: TResponse;
      };

      if (!bridgeResponse.success) {
        resolve({
          success: false,
          error: bridgeResponse.error || "Native Messaging bridge returned an unknown error",
          code: bridgeResponse.code
        });
        return;
      }

      resolve({
        success: true,
        data: bridgeResponse.data
      });
    });
  });
}
