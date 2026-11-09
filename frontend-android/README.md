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

### Active conversation-first chat

The composer requires `conversationChatVersion: 1` and reply support before
sending a `chatVersion: 1` turn, and validates the echoed version. Older reply
support alone cannot enable it. Unsupported/error responses never cause a
stripped-field retry or legacy fallback. The composer sends ordinary bounded
conversational turns. A
clarification is assistant text; the next message may answer it or change topic.
Normal chat shows user/assistant bubbles, not receipt cards, expected/verified
counts or a close-unresolved ritual. The full-window editor, selection owner,
Back/IME hiding and X-only dismissal remain in place. A failed message gets plain
feedback and does not own Send for an unrelated draft. Exact repeated unknown
submissions are not silently replayed; reopen/refresh never sends a message.

After an eligible reply-delivery failure, chat may read the exact original
owner/client/root once under the 15-second receipt deadline (12-second HTTP
read/call bounds). It never repeats start/answer/cancel. Only a validated,
correlated, unexpired `chatVersion: 1` reply with stored final assistant text or
tool summary replaces the pending bubble. A running receipt alone is not final
evidence. A newer Send or owner change fences/cancels the lookup; unsent draft
edits survive recovery. Auth loss, cancellation and blocked storage do not
initiate a lookup. Local acceptance is saved before releasing the original claim.

Content-free delivery feedback distinguishes AUTH, HTTP with numeric status,
TIMEOUT, NETWORK, DECODE, INVALID and STORAGE; failed lookup feedback separately
retains the original category and a finite recovery outcome (including NO_FINAL,
EXPIRED or CANCELLED). Raw exception messages, bodies and claim identifiers are
not diagnostic text. Recovery does not establish the cause of an earlier failure
or prove task effects independently of the stored result.

Additional focused JVM target: `online.captnuu.dcc.HermesReplyDeliveryTest`.
Synthetic full-window HTTP recovery target:
`HermesShellTest.lostChatAcknowledgementRecoversViaNativeHttpWithoutReplayAndPreservesDraftAcrossX`.
Its terminating HTTP interceptor uses synthetic responses only, not a live API.
Source coverage is not a passing build/emulator result; those checks are parent-owned.

New chat uses owner-bound encrypted `hermes-chat-<owner>-v1.enc` storage, with an
explicit separate protected recovery record when needed. Original
`hermes-<owner>.enc` and earlier separate recovery records are read for legacy
history/draft compatibility, never rewritten, deleted or sent. Their existing
client identity is retained on first use. **Previous action details** exposes
that history outside the normal rhythm. A valid new chat record remains usable
when optional historical decoding fails. An unreadable primary chat record
still blocks writes unless an explicit separate recovery is saved; no storage/
key clearing is used to escape old state. Old task data and server journals are
not migrated.

Current history remains bounded at 40 entries / 64 KiB with reply-space
reservation, owner/operation fences, TTL and protected-save-before-dispatch.
Natural assistant text is preserved; separate **Tool results** facts are grounded
in MCP results, not inferred from prose keywords. Neither prose nor scripted
fixtures establish real effects independently. The legacy four-target envelope is
not the number of allowed writes. No live provider/model or six-task result is
established by native rendering tests.

Focused JVM target: `online.captnuu.dcc.HermesConversationFirstTest`.
Full-window synthetic target:
`HermesShellTest.conversationFirstShowsNaturalReplyWithoutCardsAndPreservesDraftAcrossBackAndX`.
These source tests require independent compilation/execution. Earlier candidate
sections below document legacy compatibility behavior, not the active chat UX.

### Unresolved-turn receipt feedback and fresh-message candidate

An unresolved earlier claim is never retried by Send. A different unsent draft
now has an actionable Send choice: **Keep draft** does nothing to the server;
**Close earlier request** explicitly calls the existing fence/cancel operation
(not a rollback). Only after its response validates and the closed local state
is written successfully can a separate, later Send create a new root for the
fresh text. Client identity is unchanged. Earlier uncertain receipt/details stay
uncertain and inspectable; failed close/save cannot unlock a new submission.
Literal/whitespace-equivalent repeats of retained unconfirmed requests instead
offer receipt review, not a safe-retry claim. This is not semantic duplicate
detection, and expired text is not retained just to compare future drafts.

Check receipt publishes **Checking receipt…** immediately and a terminal checked
result even when the server returns the identical uncertain receipt. It is
deduplicated while active and performs only `op:read`. No-request, storage,
authentication, inactive scope, busy execution, HTTP, network, decode, validation,
correlation and timeout outcomes use fixed content-free feedback. No raw error,
header, body, ID or prompt is logged. Compact feedback remains above the editor
instead of depending on an offscreen/history change. It is not persisted as an
effect receipt or fed into recent-reference context. Original claim identities
survive failed/unchanged reads; owner/turn fences discard late callbacks.

Only the conversation transport changes: start/answer keep the existing 180s
whole-call allowance and explicitly use a 180s socket read timeout instead of
OkHttp's inherited 10s default. Server 90s/bridge 105s execution budgets and the
four-write cap are unchanged. Reads use 12s read/call bounds plus a 15s controller
bound; cancel uses 20s read/call plus a 22s controller bound. The cancellable
async adapter cancels the actual call and closes its response body,
disables retry/redirects and shares the existing cookie jar/owner checks. Other
workspace transports retain their prior timeout settings. These source findings
do not establish the transport/effects or install version of a reported handset.

Parent focused JVM targets (signing-free cached/offline setup only):

- `online.captnuu.dcc.HermesSubmissionTest.receiptRecheckAfterStartTimeoutImmediatelyShowsCheckingThenIdenticalUnconfirmedResultWithoutReplay`
- `online.captnuu.dcc.HermesReceiptJourneyTest`
- `online.captnuu.dcc.HermesConversationTransportTest`

The first target is the preserved missing-progress regression. New coverage also
checks bounded failure/recheck, inactive/storage/auth guards, durable-close
failure, unchanged client/new-root identity, repeated-request refusal, reload
and late owner/turn feedback. No fixture opens a real endpoint or runs a model.

New dedicated-QA instrumentation target:
`HermesShellTest.unresolvedDraftChecksReceiptThenExplicitlyClosesBeforeSeparateFreshSend`.
It hosts the production Workspace/full-window composer with a synthetic
controller, the actual HTTP adapter/codec and a terminating OkHttp application
interceptor (no DNS/socket). It checks the real overflow lookup, visible progress,
draft/selection, dismiss-without-HTTP, explicit old-close only, later fresh Send,
truthful historical details and X/Inbox restoration. Success captures are
`unresolved-receipt-checked.png` and `unresolved-fresh-turn.png` under
`externalFilesDir/qa-ui-captures/`; failures use the existing pre-cleanup artifact
helper. New GREEN/full/native results and screenshots require parent execution.
No live task/provider/model acceptance is implied.

### Android Send/recovery and keyboard repair candidate

Source changes require fresh parent verification; they do not diagnose the exact
cause of a handset restore failure or prove upgrade compatibility with real data.
Both published 0.2.3 and 0.2.4 emitted composer version 2 / history version 1;
the earlier composer-version-1 migration remains supported. Restore validates
owner, versions, identities, receipts, view, history and references before any
write. Read, decode, version, validation, history-capacity and write failures have
finite content-free status codes, not a shared claim of bad encryption.

Blocked recovery disables Send and all persistence/clear/request paths. Editing
is memory-only. Original client/root/turn identities and uncertain claims are
never reconstructed with new keys. Valid expired text is discarded separately
from claim/receipt evidence. Increased history reply reservation can make valid
older unresolved history capacity-blocked; it must not be labelled corruption.

`Conversation actions → Start separate local chat` requires local confirmation.
It preserves the original `hermes-<owner>.enc` file and creates only
`hermes-<owner>-separate-v1.enc`, using the existing protected-storage key/AAD and
AtomicFile primitives, with owner-bound recovery-version metadata. The current
memory draft is written/read-validated there before readiness is published.
Later binds prefer the separate file, even after logout/reload, and never fall
back over or overwrite an unreadable separate record. No stored request is
replayed; the next request requires an explicit Send. Earlier effects are not
reconciled by local recovery. There is intentionally no repeated-fork/reset or
deletion path. If the existing key is absent/unusable, recovery stays blocked;
no key rotation/provisioning or data deletion is authorized by this interaction.
Strict reads do not generate missing keys and recognize legacy AtomicFile
backups; orphaned strict in-progress records are not treated as an empty store.

Android Back dismisses transient controls or hides the keyboard, **never chat**.
IME hiding (including an external/down-chevron lifecycle) suppresses automatic
focus/show on viewport changes. An editor tap reopens it; draft/selection remain
controlled. A second Back with IME hidden still leaves chat open. X alone closes
the chat presentation and restores the composed workspace, without fencing work.
The stable `BasicTextField(singleLine=false)` and adaptive maxLines are retained.

Parent signing-free/offline gate (existing empty JVM home for launcher **and**
daemon, cached SDK35/JDK21/Gradle; never the signing home):
`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest`.
New JVM class: `HermesRecoveryTest` (11 methods; expected total 89 from baseline
78). Instrumentation discovery now has **27** methods from baseline 24:

- `HermesComposerTest.blockedRestoreDisablesSendAndExplicitSeparateRecoveryKeepsDraftWithoutSending`
- `HermesShellTest.realBackAndExternalImeHideKeepChatSelectionAndExactInboxUntilX`
- `SecureStorageTest.separateHermesRecoveryPreservesCorruptCiphertextAndRestoresUpdatedDraft`

Existing `firstCharacterOpensWithoutSendAndSelectionDraftSurviveCloseAndAndroidBack`
and busy-close/completion tests retain draft/no-resend coverage with the new Back
contract. Rerun the complete dedicated `online.captnuu.dcc.contextqa` suite, not a
personal app. The shell test captures `keyboard-back-keeps-chat.png` and
`keyboard-external-hide-keeps-chat.png` in `externalFilesDir/qa-ui-captures/` and
uses pre-cleanup failure artifacts. The external hide test uses the actual Dialog
IME token via InputMethodManager (the down-chevron lifecycle seam); it does not
claim an automated tap on an IME-vendor-specific chevron. No new screenshots or
RED/GREEN results exist until parent execution. The earlier initial-activity
"no Compose hierarchies" failure, followed by passing exact/full reruns without
changes, remains a test-startup limitation rather than evidence of this repair.

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
