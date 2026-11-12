import { expect, test } from "bun:test";

import { runAndroidAppiumSmoke } from "../../tools/lib/androidAppiumSmoke";

const smokeTest = process.env.RUN_ANDROID_SMOKE === "1" ? test : test.skip;

smokeTest("launches Firefox and Obsidian on Android via Appium", async () => {
  const result = await runAndroidAppiumSmoke();

  expect(result.deviceSerial.length).toBeGreaterThan(0);
  expect(result.foregroundPackageAfterFirefoxLaunch).toBe(result.firefoxPackage);
  expect(result.foregroundPackageAfterObsidianLaunch).toBe(result.obsidianPackage);
});
