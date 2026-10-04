# Android parity checklist

Work branch: feature/android-foundation (from qa). No LXC/backend modifications.

## Implemented, build-verified (not yet device-verified)
- Five bottom destinations: Today, Inbox, Focus, Projects, Prices; Settings and Refresh immediately above navigation.
- Native Material icons, scrollable lazy lists, dark Material3 styling and edge-to-edge insets.
- ViewModel + lifecycle-aware StateFlow; async OkHttp requests on IO; no repeating network poll.
- HTTPS sign-in/logout against the existing API, Origin header, in-memory cookie jar, no password persistence; 401 marks signed-out and 409 reports conflict. No redirect forwarding of credentials.
- Snapshot retrieval for planner/calendar/mail/prices, manual Refresh.
- Selected-date daily actions and completion updates using original record version; snapshots reread after writes.
- Inbox subject/sender search, account and importance filters, expandable text body, manual importance feedback.
- Read-only project details/generated steps and price condition views with observations/availability/verification notes.
- Focus start/pause/reset, minute setting; monotonic clock instead of decrement-based timing.
- Independent network-free Compose previews for login/phone, larger text, Inbox, Prices, Focus.

## Required before claiming web parity
- Keystore-backed persistent session + account-scoped encrypted local data/cache; offline outbox and conflict resolution.
- API pagination/incremental sync (current mail endpoint returns full snapshot).
- Device/emulator UI, accessibility, navigation/back-stack and real API integration tests; current unit test covers destination contract only.
- Manual tasks (backend sharing absent), grouped generated tasks, importance/edit/delete, search and daily briefing.
- Calendar multi-day/timezone rendering, event CRUD/outbox, preparation/material upload/review/feedback.
- Projects: real-device/API verification and offline conflict-resolution UI remain. Create/edit projects and assignments, optional due dates, category/priority/allowance, instructions, progress/status, PDF/TXT/MD extraction (5 MB; 20 resources / 100,000 chars), active/complete/all filters, expandable generated tasks and completion, sync and planning request controls are implemented. Versioned saves retain the editor on error; no offline save queue. Cards hide descriptions and task notes until expanded. Save/Cancel remain at the bottom of the editor. APK/unit tests/lint pass (five project validation/upload tests); real account writes/uploads and visual rendering have not been tested.
- Attachments, email rule settings and account sync status.
- Price history, target/pause/refresh controls, store links.
- Full focus break/mini-timer sequences, process-death persistence and notifications.
- Appearance/preferences and privacy controls. Launcher icon and backup-extraction rules.

Known limitations: session and snapshots are in-memory, so process restart requires sign-in. Local-mode currently only has Focus; other screens show available memory snapshots/empty state. Android build is not a deployed replacement for the web frontend. Credentials and private data must never be embedded in previews. Production host is fixed to dcc.home.captnuu.online for now. No real-mail or write-flow verification from Android has been performed.
