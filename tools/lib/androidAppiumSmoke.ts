import { spawnSync } from "node:child_process";

import { buildObsidianContentUri } from "../../src/shared/obsidianUri";

export interface AndroidAppiumSmokeConfig {
  appiumServerUrl: string;
  deviceSerial?: string;
  firefoxPackage: string;
  obsidianPackage: string;
  firefoxStartUrl?: string;
  obsidianVault?: string;
}

export interface AndroidAppiumSmokeResult {
  deviceSerial: string;
  firefoxPackage: string;
  obsidianPackage: string;
  foregroundPackageAfterFirefoxLaunch: string;
  foregroundPackageAfterObsidianLaunch: string;
  deepLinkTested: boolean;
}

interface AppiumSessionResponse {
  value?: {
    sessionId?: string;
  };
  sessionId?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runAdb(args: string[], deviceSerial?: string) {
  const adbArgs = deviceSerial ? ["-s", deviceSerial, ...args] : args;
  const result = spawnSync("adb", adbArgs, {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `adb failed: ${adbArgs.join(" ")}`);
  }

  return result.stdout.trim();
}

function detectDeviceSerial(preferred?: string) {
  if (preferred) {
    return preferred;
  }

  const output = runAdb(["devices"]);
  const deviceLines = output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.endsWith("\tdevice"));

  if (deviceLines.length === 0) {
    throw new Error("No Android device/emulator detected. Start the emulator first.");
  }

  if (deviceLines.length > 1) {
    throw new Error("Multiple Android devices detected. Set OWC_ANDROID_DEVICE_SERIAL.");
  }

  return deviceLines[0]!.split("\t")[0]!;
}

function ensurePackageInstalled(packageName: string, deviceSerial: string) {
  const output = runAdb(["shell", "pm", "list", "packages", packageName], deviceSerial);
  if (!output.includes(`package:${packageName}`)) {
    throw new Error(
      `Package not installed on device: ${packageName}. Install APKs first with bun run android:install:apks or bun run android:install:default-apps.`
    );
  }
}

function extractPackageFromActivityDump(text: string) {
  const patterns = [
    /mResumedActivity:.*\s([A-Za-z0-9._]+)\/[A-Za-z0-9.$_]+/,
    /topResumedActivity=ActivityRecord\{[^ ]+ [^ ]+ ([A-Za-z0-9._]+)\/[A-Za-z0-9.$_]+/,
    /mCurrentFocus=Window\{[^ ]+ [^ ]+ ([A-Za-z0-9._]+)\/[A-Za-z0-9.$_]+/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function getForegroundPackage(deviceSerial: string) {
  const activityOutput = runAdb(
    ["shell", "dumpsys", "activity", "activities"],
    deviceSerial
  );
  const fromActivities = extractPackageFromActivityDump(activityOutput);
  if (fromActivities) {
    return fromActivities;
  }

  const windowOutput = runAdb(["shell", "dumpsys", "window"], deviceSerial);
  return extractPackageFromActivityDump(windowOutput);
}

async function appiumRequest<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const json = (await response.json()) as T & { value?: { error?: string; message?: string } };
  if (!response.ok) {
    const errorMessage = json?.value?.message || json?.value?.error || response.statusText;
    throw new Error(`Appium request failed for ${path}: ${errorMessage}`);
  }

  return json as T;
}

async function createSession(baseUrl: string, deviceSerial: string) {
  const response = await appiumRequest<AppiumSessionResponse>(baseUrl, "/session", {
    method: "POST",
    body: JSON.stringify({
      capabilities: {
        alwaysMatch: {
          platformName: "Android",
          "appium:automationName": "UiAutomator2",
          "appium:newCommandTimeout": 120,
          "appium:noReset": true,
          "appium:udid": deviceSerial,
          "appium:deviceName": deviceSerial,
        },
        firstMatch: [{}],
      },
    }),
  });

  const sessionId = response.value?.sessionId || response.sessionId;
  if (!sessionId) {
    throw new Error("Appium did not return a sessionId.");
  }

  return sessionId;
}

async function deleteSession(baseUrl: string, sessionId: string) {
  await appiumRequest(baseUrl, `/session/${sessionId}`, {
    method: "DELETE",
  });
}

async function activateApp(baseUrl: string, sessionId: string, packageName: string) {
  await appiumRequest(baseUrl, `/session/${sessionId}/appium/device/activate_app`, {
    method: "POST",
    body: JSON.stringify({ appId: packageName }),
  });
}

async function waitForForegroundPackage(
  deviceSerial: string,
  packageName: string,
  timeoutMs = 30000
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const foregroundPackage = getForegroundPackage(deviceSerial);
    if (foregroundPackage === packageName) {
      return foregroundPackage;
    }
    await sleep(1000);
  }

  throw new Error(`Timed out waiting for foreground package ${packageName}.`);
}

function openUrlInFirefox(deviceSerial: string, packageName: string, url: string) {
  runAdb(
    [
      "shell",
      "am",
      "start",
      "-W",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      url,
      packageName,
    ],
    deviceSerial
  );
}

function triggerObsidianDeepLink(deviceSerial: string, vaultName: string) {
  const deepLink = buildObsidianContentUri(
    vaultName,
    "Android Smoke/obsidian-smoke",
    "Android smoke test"
  );
  runAdb(
    [
      "shell",
      "am",
      "start",
      "-W",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      deepLink,
    ],
    deviceSerial
  );
}

export async function runAndroidAppiumSmoke(
  config: Partial<AndroidAppiumSmokeConfig> = {}
): Promise<AndroidAppiumSmokeResult> {
  const deviceSerial = detectDeviceSerial(config.deviceSerial || process.env.OWC_ANDROID_DEVICE_SERIAL || undefined);
  const appiumServerUrl = config.appiumServerUrl || process.env.OWC_APPIUM_SERVER_URL || "http://127.0.0.1:4723";
  const firefoxPackage = config.firefoxPackage || process.env.OWC_ANDROID_FIREFOX_PACKAGE || "";
  const obsidianPackage = config.obsidianPackage || process.env.OWC_ANDROID_OBSIDIAN_PACKAGE || "md.obsidian";
  const firefoxStartUrl = config.firefoxStartUrl || process.env.OWC_FIREFOX_ANDROID_START_URL || "https://chatgpt.com/";
  const obsidianVault = config.obsidianVault || process.env.OWC_ANDROID_OBSIDIAN_VAULT || undefined;

  if (!firefoxPackage) {
    throw new Error("Set OWC_ANDROID_FIREFOX_PACKAGE to the installed Firefox Android package before running the smoke lane.");
  }

  runAdb(["wait-for-device"], deviceSerial);
  ensurePackageInstalled(firefoxPackage, deviceSerial);
  ensurePackageInstalled(obsidianPackage, deviceSerial);

  const sessionId = await createSession(appiumServerUrl, deviceSerial);

  try {
    await activateApp(appiumServerUrl, sessionId, firefoxPackage);
    openUrlInFirefox(deviceSerial, firefoxPackage, firefoxStartUrl);
    const foregroundPackageAfterFirefoxLaunch = await waitForForegroundPackage(deviceSerial, firefoxPackage);

    await activateApp(appiumServerUrl, sessionId, obsidianPackage);
    const foregroundPackageAfterObsidianLaunch = await waitForForegroundPackage(deviceSerial, obsidianPackage);

    let deepLinkTested = false;
    if (obsidianVault) {
      triggerObsidianDeepLink(deviceSerial, obsidianVault);
      await waitForForegroundPackage(deviceSerial, obsidianPackage);
      deepLinkTested = true;
    }

    return {
      deviceSerial,
      firefoxPackage,
      obsidianPackage,
      foregroundPackageAfterFirefoxLaunch,
      foregroundPackageAfterObsidianLaunch,
      deepLinkTested,
    };
  } finally {
    await deleteSession(appiumServerUrl, sessionId);
  }
}
