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

**DCC parent-only build gate:** `app/build.gradle.kts` currently inspects signing
configuration under JVM `user.home` even for debug builds. Do not run these
commands with a real signing home. Use the parent's already verified empty JVM
home for both launcher and Gradle daemon, retain the actual cached
`GRADLE_USER_HOME`, and use cached Gradle/JDK21/SDK35 offline. No signing-file read,
SDK/package install, device update or release signing is part of this source task.

Set ANDROID_HOME to your SDK directory or set sdk.dir in ignored local.properties.

```sh
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk` (development only, debug signed).
Do not commit local.properties, signing keys, credentials, SDKs or generated APKs.

## Scope

See PARITY.md for the implemented vertical slices and remaining web parity gaps.
The native shell-bottom Hermes composer and GET-only post-receipt task reconciliation
share the [bounded server contract](../backend/src/mcp/CLARIFICATION-RECEIPTS.md).
Hermes requires the online authenticated API; no model/credentials or synthetic
effects run on the phone. Drafts/receipts use owner-scoped encrypted storage;
offline manual work and conflict review stay separate.

Optional actual assistant text uses authenticated `conversationReplyVersion:1`
discovery and a start-only `replyVersion:1`, separate from receipt authority.
The existing layout renders one bounded reply per turn plus inspectable receipt
details. Reply text is at most 2,048 UTF-16 units / 4,096 UTF-8 bytes, owner-bound
and expires with disposable text (at most 24h). Missing support sends legacy
bodies; claimed requests are never stripped/retried. See the paired rollout and
parent-only acceptance prerequisites in
[`../backend/test/acceptance/NATURAL-REPLIES.md`](../backend/test/acceptance/NATURAL-REPLIES.md).

Contextual native chat source changes require fresh verification. The closed
entrance is a 48dp rounded pill; conversation actions are under the accessible
"Conversation actions" overflow, not a permanent recovery row. X/Back remain
UI-only. The existing full-window/short-landscape host and workspace IME ownership
remain in place.

After capability negotiation (`conversationContextVersion:1`), a fresh draft
captures settled live owner-encrypted history as untrusted reference. Later/in-
flight completions cannot enter that draft snapshot. Send freezes it with the
durable claim; edits/reloads never resend it. Limits: six entries, 320 UTF-16
units each, 1,200 text units / 2,304 UTF-8 encoded bytes total, max age 24 hours.
Expired references are pruned; owner/logout and existing encrypted text TTL apply.
No IDs or tool-result objects are supplied as authority. Current server tool
readback is required. Old servers receive the legacy request shape; a failed
claimed request is never stripped/retried automatically. Generic verified update
batches can continue without claiming full natural-language/checklist completion.

Parent verification targets: `HermesReferenceTest`, `HermesSubmissionTest`,
`HermesStateTest`, `HermesChatHistoryTest`, `HermesComposerTest`, `HermesShellTest`.
Use the signing-free/offline JVM home described above for
`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest`.
Device tests require the existing isolated QA application/emulator only; include
`compactPillHas48dpTargetAndRecoveryIsAvailableOnlyThroughAccessibleOverflow` and
the retained first-character, Back, exact Inbox-scroll, closed-completion and
landscape/capture tests. These changes have not been compiled or run in this pass.

Parent previously built the feature checkpoint and ran its unit/lint gates;
subsequent fixes and tests are unverified until rerun. Parent can compile
`:app:assembleDebugAndroidTest` using that same safe-home/offline setup. Running
`HermesComposerTest` requires a separately approved disposable emulator only;
never the daily device/emulator. Its empty ComponentActivity fixture uses no
WorkspaceModel/network. It covers short scrollable layouts, text/IME interaction,
modal chat, receipt View, UI-only close, partial/failure editing and activity recreation.
Real keyboard insets, portrait/landscape visual review and process/Keystore behavior
still need parent device acceptance; unit success is not Compose verification.
Four bottom tabs (Today, Inbox, Focus, Projects) and Settings/Refresh controls are implemented.
Hermes reserves a compact dock immediately above navigation across these screens;
focus/typing opens a full-window modal chat with a pinned IME-aware editor. Closing
chat hides only the UI/keyboard: it does not cancel, clear or resend a request.
The workspace remains composed beneath it. Inbox controls scroll
with messages. Prices/navigation/settings/fetching are retired; historical caches
are preserved and old destination restoration falls back to Today.
`HermesShellTest` adds synthetic shell geometry, navigation/draft retention, Inbox
scroll and receipt/recreation regressions; these are UNRUN, including test-APK
compilation. Parent must verify real IME/rotation on an approved disposable device.
`HermesChatHistoryTest` covers optional encrypted-state timeline migration, stable
turns, independent request keys, owner/TTL fences and protected-history bounds.
History is non-authoritative (40 entries / 64 KiB UTF-8 / 24-hour transcript TTL);
only settled groups may be pruned. Unresolved records can block new sends.
The source-only full-screen-chat changes are UNRUN. Parent's synthetic
`HermesShellTest.fullWindowVisualAcceptanceCompactChatImeMultiTurnReceiptAndClosedTasks`
generates `full-window-compact.png`, `full-window-chat-ime.png`,
`full-window-multi-turn-receipt.png` and `full-window-closed-tasks.png` under the
target app's `externalFilesDir/qa-ui-captures/`; no success images exist until run.
HTTPS API code,
encrypted persistent sessions and workspace caches, a durable encrypted planner/calendar
outbox, snapshot screens, manual-task sync, task checkoff, email importance feedback and
a persistent focus timer are available. Cold offline sign-in, every web workflow, and full
web parity are not complete. Preview functions do not create a ViewModel or call the network.

Changes branch from qa using feature/* or fix/* and target qa. Daniel promotes qa to main.
