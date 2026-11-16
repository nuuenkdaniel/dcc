# Project-local Android toolchain

DCC's Android development tools and generated build state live at the repository root in **`.android-build/`**. That entire directory is ignored by the root `.gitignore` and contains private development keys and emulator data. Do not add it to Git or upload it wholesale.

## Build

From the repository root:

```sh
./frontend-android/android-env gradle :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

From `frontend-android/`, use `./android-env gradle ...`. Builds default to **offline** using Gradle 8.11.1. If a pinned project dependency is genuinely missing, explicitly allow public repository downloads for that invocation:

```sh
./frontend-android/android-env gradle --online :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

`--online` does not change the project's pinned dependency versions. No global shell exports, SDK installation or system Java changes are required. Use this wrapper, not bare Gradle, old one-off QA runners or Android Studio, for the isolated workflow.

Outputs:

- Debug APK: `.android-build/outputs/app/outputs/apk/debug/app-debug.apk`
- Unit results: `.android-build/outputs/app/test-results/testDebugUnitTest/`
- Lint: `.android-build/outputs/app/reports/lint-results-debug.html`
- Migration evidence/logs: `.android-build/logs/`, `cleanup.json`, `emulator-verification.json`.

## What is isolated

| Directory | Purpose |
|---|---|
| `java/` | Reused standalone JetBrains Java 21.0.11; does not depend on the system Java installation |
| `sdk/` | SDK 35 platform/build-tools, platform-tools, command-line tools, emulator, licenses and preserved AVD system images |
| `gradle/` | Gradle 8.11.1 distribution and dependency caches |
| `home/` | Signing-free JVM/process HOME; `.android` points to the local Android user directory |
| `android-user/` | Preserved ADB keys, original debug keystore, settings and both AVDs |
| `previous-qa-home/` | Preserved earlier isolated QA home/debug key; not merged with the original developer key |
| `outputs/`, `project-cache/`, `kotlin-project/`, `kotlin-daemon/` | Build and compiler state |
| `tmp/`, `xdg/` | Tool-owned temporary/cache/config/data paths |
| `config/build-isolation.gradle` | Redirects Gradle project output directories |
| `retained/` | Potentially unique IDE settings/Local History, package recipe, original AVD text configs and obsolete one-off runners |
| `legacy-cache/` | Prior Android-only QA source/evidence/APKs/reports; regenerated intermediates/caches removed |

The wrapper explicitly sets Java, SDK, Gradle, Android user/AVD, HOME, XDG and temporary paths. It unsets deprecated `ANDROID_SDK_HOME`/`ANDROID_PREFS_ROOT` to prevent conflicting preference-location settings. It sets JVM `user.home` for both launcher and Gradle daemon, disables automatic Java provisioning, and redirects Kotlin/project caches. It fails when the toolchain is absent rather than rebuilding global state.

The existing SDK-35 image supports `dcc-validation-api35`. The API-37 system image is retained **only to preserve the existing `Medium_Phone_API_37.0` AVD**; it is not the compile SDK. API-36/37 compile platforms, API-37 sources, build-tools 36 and Gradle 8.14.3 were removed after verification. Do not delete the retained image/AVD without an explicit data-preservation decision.

## Signing safety

This is a **debug-only** wrapper. It refuses release-task arguments. The signing-free JVM home prevents `app/build.gradle.kts` from loading the real release-signing configuration even during debug configuration.

The existing release-signing directory under the real user's `~/.local/share/dcc-signing` was **not opened, moved, copied or changed**. Release signing remains a separate, explicitly approved procedure. No release APK or phone update was performed during migration. Do not repoint JVM HOME at the real home to work around the wrapper's guard. Do not regenerate or merge development keys to fix a signature mismatch.

## Emulator commands

```sh
./frontend-android/android-env emulator -list-avds
./frontend-android/android-env java -version
./frontend-android/android-env env
```

Automated migration verification used **only** `dcc-validation-api35`, serial `emulator-5580`, with `-read-only -no-snapshot-load -no-snapshot-save -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect` and an isolated ADB server on port 5038. Both owned processes were stopped afterward. No app installation or instrumentation run was needed for this toolchain migration.

For an explicitly approved repeat QA boot, set `ANDROID_ADB_SERVER_PORT=5038` and `ADB_SERVER_SOCKET=tcp:localhost:5038` on both emulator and ADB invocations, select `-s emulator-5580` for every guest command, and check port/process ownership first. Never boot, wipe, install into or test against `Medium_Phone_API_37.0` or a physical phone without approval. Prefer this wrapper over historical runners, which retain obsolete absolute paths.

## Removing the toolchain later

1. Stop all Gradle/Kotlin/ADB processes and emulators using this directory.
2. Independently preserve any needed keys, AVD data and unique source/evidence from `retained/` and `legacy-cache/` before deletion. Inspect potential secrets privately; never print them.
3. Deliberately delete the repository-root `.android-build/` directory only after confirming its exact path and the backup decision.
4. Remove the ignored `frontend-android/local.properties` if Android builds will no longer be used. The small `android-env` script and this document may remain; the wrapper will report a missing toolchain.

**WARNING: Removing `.android-build/` also deletes its ADB identity, original debug keystore, previous QA debug key, emulator userdata/encryption keys/snapshots, local build outputs and retained unique IDE/QA material.** Recreating a debug key can prevent in-place app updates. This is not a disposable cache-only directory. The separately excluded release-signing directory is not removed by this operation.

Android Studio was already absent from pacman's installed package inventory and `/opt/android-studio` at migration time. No sudo operation was required. If it is reinstalled later, `sudo pacman -R android-studio` is the package-manager removal command; do not manually delete package-managed files. Keep system Java and common Java packages: Maven still needs them.

## Migration verification

On the preserved dirty `fix/hermes-contextual-chat` checkout, relocated debug assembly, all **152 JVM tests** and lint passed in a forced **offline** run after cleanup. Lint reported **24 warnings, no errors/fatals**. Dedicated API-35 AVD discovery/startup passed read-only; the daily AVD was not booted. Existing source changes were hash-checked for preservation, apart from the intentional appended README instructions; no app source, branch, commit or remote was changed. Successful toolchain verification is not new acceptance of all unreleased application behavior.
