# Android local testing stack

This project now has a local Android test stack for Firefox + Obsidian development on macOS.

## Host tools installed

- Android Studio: `/Applications/Android Studio.app`
- Android SDK root: `~/Library/Android/sdk`
- AVD name: `owc-firefox-android-35`
- `adb`: Android SDK Platform Tools
- `emulator`: Android Emulator 36.4.9
- `appium`: 2.19.0
- `uiautomator2` Appium driver: 3.9.1
- `scrcpy`: installed via Homebrew
- `gstreamer`: installed via Homebrew
- `bundletool.jar`: exposed at `/opt/homebrew/bin/bundletool.jar`

## Repo helpers

```bash
bun run android:doctor
bun run android:emulator
bun run android:emulator:headless
bun run android:appium
bun run android:scrcpy
bun run android:install:apks -- /path/to/firefox.apk /path/to/obsidian.apk
bun run android:install:default-apps
bun run android:smoke:appium
bun run test:e2e:android:smoke
bun run build:firefox:android
bun run firefox:android:lint
bun run firefox:android:run
bun run firefox:android:package
bun run firefox:android:sign
```

These scripts source `tools/android-env.sh`, so they share the same SDK, Java, AVD, package, signing, and Appium defaults.

## Environment variables

Common overrides:

- `OWC_ANDROID_DEVICE_SERIAL`
- `OWC_ANDROID_FIREFOX_APK`
- `OWC_ANDROID_OBSIDIAN_APK`
- `OWC_ANDROID_FIREFOX_PACKAGE` (required for the Firefox Android lane; set this to the installed Nightly/Beta/dev package you are targeting)
- `OWC_ANDROID_OBSIDIAN_PACKAGE` (default: `md.obsidian`)
- `OWC_APPIUM_SERVER_URL` (default: `http://127.0.0.1:4723`)
- `OWC_ANDROID_OBSIDIAN_VAULT` (optional deep-link smoke check)
- `OWC_AMO_API_KEY`
- `OWC_AMO_API_SECRET`
- `OWC_FIREFOX_SIGN_CHANNEL` (default: `unlisted`)

## Recommended workflow

1. Run `bun run android:doctor`
2. Start the emulator with `bun run android:emulator`
3. In another terminal, start Appium with `bun run android:appium`
4. Install Firefox and Obsidian APKs:
   - explicit paths: `bun run android:install:apks -- /path/to/firefox.apk /path/to/obsidian.apk`
   - env-driven helper: set `OWC_ANDROID_FIREFOX_APK` and `OWC_ANDROID_OBSIDIAN_APK`, then run `bun run android:install:default-apps`
5. Set `OWC_ANDROID_FIREFOX_PACKAGE` to the installed Firefox Android development package you want to target
6. Temporarily load the extension into Firefox for Android with `bun run firefox:android:run`
7. Run the smoke lane with `bun run android:smoke:appium`

## What the Appium smoke lane checks

`bun run android:smoke:appium` verifies:

- the emulator/device is visible over ADB
- the Firefox package is installed
- the Obsidian package is installed
- Appium can create a UiAutomator2 session
- Firefox launches and can foreground a URL
- Obsidian launches and can foreground
- optionally, an Obsidian deep link works if `OWC_ANDROID_OBSIDIAN_VAULT` is set

This is intentionally a bring-up smoke test, not a full ChatGPT account/login automation flow.

## Firefox Android development vs distribution

### Temporary development install

Mozilla’s Firefox Extension Workshop docs describe temporary Android loading with:

```bash
web-ext run -t firefox-android
```

This repo wraps that flow in:

```bash
bun run firefox:android:run
```

The wrapper builds `dist-firefox-android/` first, then calls `web-ext run` against the configured Firefox Android development package. Do not treat this as a stable-user install path for stock Firefox release builds.

### Signed package / persistent distribution

For a persistent install path, build and sign the Android-focused Firefox artifact:

```bash
bun run firefox:android:package
bun run firefox:android:sign
```

Signing requires `OWC_AMO_API_KEY` and `OWC_AMO_API_SECRET`.

See `docs/distribution/firefox-android.md` for the persistent install options and policy constraints.

## Firefox Android compatibility notes

- The Android-focused Firefox build target is `firefox-android`, which outputs to `dist-firefox-android/`.
- The Android Firefox lane expects an explicit development-capable Firefox Android package selection through `OWC_ANDROID_FIREFOX_PACKAGE`.
- That target strips Android-inapplicable manifest surface such as `nativeMessaging`.
- It also adds Firefox-specific metadata needed for `web-ext lint` Android compatibility checks and AMO submission, including explicit data-collection disclosure for clipped page URL/content export to Obsidian.
- PDF extraction is still not available on Firefox Android because this repo’s current PDF path depends on offscreen APIs that Firefox Android does not provide.

## Notes

- `scrcpy` is mainly useful for a real Android phone connected over ADB. The Android emulator already provides its own window.
- BlueStacks is not part of this setup. On this Apple Silicon Mac, the Android Studio emulator is the primary and automation-friendly path.
- If you want a clean emulator state, run `bun run android:emulator -- --wipe-data`
- You can lint the Android Firefox artifact with `bun run firefox:android:lint`.

## Official references

- Firefox Extension Workshop: Developing extensions for Firefox for Android
  https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/
- Firefox Extension Workshop: Signing and distribution overview
  https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- Mozilla Support: Find and install add-ons in Firefox for Android
  https://support.mozilla.org/en-US/kb/find-and-install-add-ons-firefox-android
