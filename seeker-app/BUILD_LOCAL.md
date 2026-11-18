# Local release build (Windows, no EAS servers)

Builds the same signed release APK as the EAS `preview` profile, on this PC. Use it when EAS builds aren't available
(the free plan's monthly Android builds are used up).

## What it does

1. `npx expo prebuild -p android --clean` generates `android/` from `app.json` and its plugins, exactly as EAS does.
   `android/` is generated and git-ignored: don't edit it by hand. Native settings belong in `app.json` and config plugins.
   JS patches in `patches/` were already applied by `npm install` (`postinstall: patch-package`).
2. Adds a release signing config that reads the key from Gradle properties. The script passes them as
   `ORG_GRADLE_PROJECT_*` environment variables, so the passwords never land in a file inside the repo.
3. Runs `gradlew assembleRelease`. That bundles the JS into the APK (no dev server needed), with Hermes, a release
   variant and `__DEV__ = false`, so there's no developer panel.
4. Checks with `apksigner` that the APK carries the EAS certificate
   `E3:7B:D8:EE:…:6D:C6:39` (the one in `website/.well-known/assetlinks.json`). It refuses to finish otherwise.
   Same certificate = installs as an update over EAS builds and keeps the app's data and phone keys.
5. Copies the APK to `dist/lock-in-<version>-<commit>.apk` (git-ignored).

## One-time setup (already done on this PC, 2026-10-12)

| What                                                                         | Where                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| JDK 17 (portable Temurin; Java 8 stays the system Java)                      | `%USERPROFILE%\.jdks\jdk-17.0.20.1+1`                                    |
| Android SDK: platform 36, build-tools 36.0.0                                 | `%LOCALAPPDATA%\Android\Sdk`                                             |
| NDK 27.1.12297006 and CMake 3.22.1 (the versions React Native 0.83 asks for) | same SDK, installed with `sdkmanager "ndk/27.1.12297006" "cmake/3.22.1"` |
| Windows long paths                                                           | enabled (`LongPathsEnabled=1`); the C++ builds need it                   |
| Signing key                                                                  | `node scripts/fetch-eas-keystore.mjs` → `%USERPROFILE%\.lockin-signing\` |

`fetch-eas-keystore.mjs` downloads the app's existing EAS key with your Expo login (`npx eas-cli login`). It doesn't
create a key. **Never commit `.lockin-signing`**, and keep a copy of it somewhere safe: without this key the app can't be
updated in the dApp Store.

## Build

```
cd seeker-app
node scripts/build-release-local.mjs
```

- Default ABIs: `arm64-v8a` (phones) and `x86_64` (emulator). For all four, like EAS:
  `LOCKIN_ABIS=armeabi-v7a,arm64-v8a,x86,x86_64 node scripts/build-release-local.mjs`
- `versionCode` comes from `app.json` (1). A dApp Store update needs a higher one: `LOCKIN_VERSION_CODE=2 …`.
  Installing over a build with the same versionCode works (`adb install -r`), a lower one doesn't.
- A first build takes a while: it downloads Gradle and dependencies and compiles the native libraries. Close the
  emulator if memory is short: Gradle uses up to 4 GB.

## Install over the existing app (keeps its data)

```
adb install -r dist\lock-in-1.0.0-<commit>.apk
```

Never `adb uninstall` the app to install a build: that deletes the phone's check-in keys (goals would need
"Link this phone" again).
