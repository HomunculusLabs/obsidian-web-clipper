# Firefox Android distribution

This project now has a dedicated Firefox Android build target:

```bash
bun run build:firefox:android
```

The build output is written to:

```text
dist-firefox-android/
```

## Development install (temporary)

For local development on an emulator or device connected over ADB, use:

```bash
bun run firefox:android:run
```

That wrapper builds `dist-firefox-android/` and then calls `web-ext run -t firefox-android`.

Before running it, set `OWC_ANDROID_FIREFOX_PACKAGE` to the installed Firefox Android development package you are targeting.

This is the fastest way to validate the extension on Firefox for Android without going through AMO signing first. Treat it as a development-only flow, not a stock-release distribution path.

## Package artifact

To create an unsigned Android-focused XPI artifact:

```bash
bun run firefox:android:package
```

Artifacts are written under `web-ext-artifacts/firefox-android/` by default.

## Signed artifact

To request a signed artifact from AMO:

```bash
export OWC_AMO_API_KEY="..."
export OWC_AMO_API_SECRET="..."
bun run firefox:android:sign
```

Optional knobs:

- `OWC_FIREFOX_SIGN_CHANNEL` (`unlisted` by default)
- `OWC_AMO_METADATA_JSON`
- `OWC_FIREFOX_UPLOAD_SOURCE_CODE`

## Persistent Android install options

There are two practical persistent Android paths:

1. **AMO-supported install flow** for add-ons exposed through Firefox Android’s supported add-ons surface
2. **Custom add-on collections on Firefox Nightly / Firefox Beta** for self-managed Android distribution

Mozilla’s official posts state that custom add-on collections are available on Firefox Nightly and Firefox Beta for Android. Use that path if you need persistent Android installs before or instead of a normal AMO-listed rollout.

## Current Android build assumptions

The `firefox-android` target is stricter than the desktop Firefox target.

It currently:

- removes `sidePanel`
- removes `offscreen`
- removes `nativeMessaging`
- uses Firefox-compatible `background.scripts`
- sets `action.default_popup`
- includes Firefox metadata for signing/distribution review, including explicit data-collection disclosure for clipped browsing activity and website content exported into Obsidian

## Known limitations

- PDF extraction is not supported on Firefox Android in this repo yet.
- Native messaging / CLI save is not part of the Android Firefox lane.
- The Appium smoke lane validates app bring-up and temporary development install prerequisites, not a full authenticated ChatGPT end-to-end flow.

## Official references

- Firefox Extension Workshop: Developing extensions for Firefox for Android  
  https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/
- Firefox Extension Workshop: Signing and distribution overview  
  https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- Mozilla Support: Find and install add-ons in Firefox for Android  
  https://support.mozilla.org/en-US/kb/find-and-install-add-ons-firefox-android
- Mozilla Add-ons Blog: Add-ons for Firefox Android are here  
  https://blog.mozilla.org/addons/2020/02/10/help-test-out-the-first-extensions-compatible-with-firefox-for-android/
- Mozilla Add-ons Blog: Expanded extension support in Firefox for Android Nightly  
  https://blog.mozilla.org/addons/2022/10/04/expanded-extension-support-in-firefox-for-android-nightly/
