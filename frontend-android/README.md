# dcc Android

Native Kotlin / Jetpack Compose foundation, separate from the web frontend and backend.
Requires JDK 17 or 21 and Android SDK 35. Minimum phone version: Android 8.0 (API 26).
Pinned build versions are reproducible baseline versions, not a claim to be the newest.

## View and run

Open **this directory** as a project in Android Studio and allow Gradle sync.
Open `app/src/main/java/online/captnuu/dcc/DccApp.kt` in Split/Design mode for
`PhonePreview` and `LargeTextPreview`. Previews require the SDK/dependencies but not a phone.
For full interactions, create an emulator in Device Manager and press Run.
Alternatively enable Developer options + USB debugging on your phone, authorize your computer,
select the phone in Android Studio, and press Run. Android Studio installs the debug app directly;
you do not manually download an APK for each change. Apply Changes can speed up supported edits;
some changes require a rebuild/restart. Wireless debugging is also available on supported devices.

## Command line

Set ANDROID_HOME to your SDK directory or set sdk.dir in ignored local.properties.

```sh
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk` (development only, debug signed).
Do not commit local.properties, signing keys, credentials, SDKs or generated APKs.

## Scope

See PARITY.md for the implemented vertical slices and remaining web parity gaps.
Five bottom tabs and bottom Settings/Refresh controls are implemented. HTTPS API code,
in-memory login, snapshot screens, task checkoff, email importance feedback and a basic
focus timer now build successfully. Persistent sessions/offline sync and full web parity
are NOT complete. Preview functions do not create a ViewModel or call the network.

Changes branch from qa using feature/* or fix/* and target qa. Daniel promotes qa to main.
