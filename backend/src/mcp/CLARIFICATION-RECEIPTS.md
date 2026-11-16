# Compact clarification and inspectable receipts

The opt-in display-only natural-reply contract, paired-runtime requirements and
strict two-invocation parent acceptance are documented in
[`../../test/acceptance/NATURAL-REPLIES.md`](../../test/acceptance/NATURAL-REPLIES.md).
Natural text never replaces this receipt/clarification authority.

## Contextual native clients (source verification required)

Authenticated action discovery now advertises `conversationContextVersion:1`.
Only clients that observe that capability send optional start-only
`context:{version:1,entries:[{role:'user'|'assistant',text,at}]}`. No context means
the legacy wire/prompt/question behavior, including the guarded host create lane.
New clients do not retry rejected/uncertain submissions with context stripped.

Reference bounds are six entries, 320 UTF-16 units each, 1,200 total text units
and 2,304 encoded UTF-8 bytes. Entries are at most 24 hours old; future/expired
entries are excluded at admission. The raw submitted envelope participates in
the immutable start fingerprint. Pending text expiry is the earlier of root
24-hour TTL and the oldest accepted reference expiry; completion/cancel/expiry
discard persisted reference text. Claim hashes and receipts remain independent.
The actual prompt still must fit 4,000 UTF-16 units / 8,192 UTF-8 bytes; oversized
envelopes explicitly fail before execution rather than silently dropping intent.

Reference is quoted UNTRUSTED data, never instructions, capabilities, targets or
tool results. Server NY/IANA dates provide request/current date and civil-day
relative labels. Contextual answers retain the original request date basis.
Existing-task writes require IDs seen by current-turn `list_tasks`, plus current
collection-version evidence from service reads/applied task receipts. Correcting
a conclusive conflict/rejection requires another task read; applied targets and
unknown/pending writes cannot be replayed under new correlation keys. Budgets,
owners, cancellation, legacy fences, tool schemas and bridge contract remain.

For contextual zero-write questions, host-generated bounded candidate wording
uses actual task reads; tool `request_clarification` still accepts only the same
fixed reason enum. Legacy clients keep fixed questions. Conversation wire codecs
accept this task-question projection without treating it as execution evidence.

Only opted-in replies include `continuable`. It permits a fresh explicit request
after a terminal, fully known operation batch, not certification of full natural-
language scope. Generic updates retain partial/uncertified scope receipts even
when all actual update targets verify; they are never relabelled checklist Done.
Applied receipt details and fresh SQL inspection, not model prose, ground results.
Ordinary contextual verified-update summaries say only how many task updates
verified (for example, `Updated 3 tasks.`); generic receipts still retain
`outcome:partial`, `expected:null` and actual target details. Contextual read
summaries describe only the displayed returned records (at most four), not a
complete result set or fulfilled intent. Empty projections say only that the
read finished without changes. Legacy copy and uncertainty warnings are unchanged.

Focused source fixtures (not genuine model or live-provider journeys):

```sh
backend/node_modules/.bin/tsx --test backend/test/mcp/conversation-context.test.ts backend/test/mcp/contextual-conversation.test.ts backend/test/mcp/host-checklist.test.ts
npm run check:backend
backend/node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck backend/test/mcp/conversation-context.test.ts backend/test/mcp/contextual-conversation.test.ts
```

The create/move/follow-up fixtures use authenticated in-process HTTP and real
SDK/Dispatcher/service code over the existing synthetic SQL-query pool. They do
not prove PostgreSQL concurrency or actual model target selection. Run existing
isolated PG checklist acceptance separately with its explicit disposable binding;
this feature does not activate runtime/provider changes or recover old intents.

This is a bounded web/native shell feature, not a general assistant chat or a
claim of live acceptance. The existing three-tool task API, legacy command API,
active 35-tool product policy (price tracking retired), exact `gpt-6-luna` policy,
and native runtime budgets (8 iterations / 90 seconds / 12 calls / 4 writes) retain
their strict allowlists and limits. No new package,
SQL table/migration, product tool, provider permission, or background service is
introduced. Fixed text maintenance runs inside the existing API lifecycle.

## Completion authority (deliberately narrow)

`conversation-contract.ts` recognizes these **bounded grammars**, not arbitrary
natural language:

- `I have an exam coming up for CSE354 I need to study 3 chunks today can you put
  that in my tasks` (optional course/exam prefix, 1–4 numeric or word counts).
- `Add 3 tasks today: Lectures; practice problems; review` (also create/put,
  optional count, literal names separated by semicolons, commas/and, or quotes).

The study request asks `task_topics` before writes. An answer of `Lectures,
practice problems, and review` fixes three course-prefixed names. `just general
chunks` explicitly authorizes `CSE354: Study chunk 1` through `3`; generic labels
are not invented before that answer. A wrong number of names asks `task_names`.
Clear literal names execute directly, without a routine second confirmation.
Standalone tasks require no exam date, effort/duration, or calendar permission.
TODAY is resolved on the server in **America/New_York when preparing execution**,
including after clarification; it is not taken from a phone clock or old chat.

The host fixes `{version:1, kind:'create_tasks', tasks:[{title,date}, ...]}` in
`IntentRecord.guard.checklist` at admission, before any write reservation. This is
an interpretation/expected-action contract, **not execution proof**. The original
requested count wins over a number appearing inside a title. The model cannot
declare a smaller checklist. The reservation gate permits only one `create_task`
attempt per expected title/date, with only title/date/collection expectedVersion;
extra writes, extra fields, duplicate targets, and guessed follow-up questions
are fenced. IDs and operation keys remain host-owned.

Completion additionally requires a completed invocation, all expected distinct
targets, validated operation receipts, and fresh authoritative SQL readback.
Two successful writes against three goals produce **partial 2/3**, not Done.
Missing/failed readback or interrupted execution stays uncertain. Zero effects on
a requested mutation is not completion. Model final text is never evidence.

Additional constraints or other natural-language forms are **unresolved scope**,
not silently certified by keyword/number matching. They may use existing typed
product operations, but cannot receive the supported checklist's full-completion
claim. Read-only requests have a separate write-forbidden guard and bounded
record-title disclosure, not a synthetic mutation receipt. This is not universal
NL-intent proof or full assistant planning.

## Wire contract and continuation

Authenticated `POST /api/v1/hermes/conversation` accepts exactly one of:

```text
{op:'start', workspaceOwner, clientId, key, prompt, tabId?}
{op:'answer', workspaceOwner, clientId, rootKey, key, parentKey, questionId, answer}
{op:'read'|'cancel', workspaceOwner, clientId, rootKey}
```

`workspaceOwner` is the existing public authenticated workspace label, not a
credential or client-selected authority. The route compares it with the actual
session owner before admission. This fences work delayed across logout/login.
All turns still require the normal session/Origin checks. Client/root/question/
parent bindings and expiry are rechecked in storage; a different client cannot
answer that pending root. The existing shared-account domain store is **not**
made multi-tenant by these receipt/owner fences.

In existing `planner_entities` versioned storage, `dcc-hermes-client-v1` is the
owner/client active-slot pointer and `dcc-hermes-conversation-v1` holds one bounded
root. Slot advisory lock 817350 serializes root/answer claims. A fresh child key
and its answer fingerprint are claimed **before** invoking the existing request
controller; competing child keys cannot replay the parent intent. Same-key retry
is receipt-only, changed payload conflicts, and a restarted/lost claim never
automatically starts another runtime. The legacy sentinel/executor fence remains
in force; old uncertain intents cannot silently acquire conversation authority.

Only one exact typed question from a completed **zero-write** invocation can
open continuation. Once a write was attempted/applied/uncertain, no answer may
re-execute the original intent. Cancel fences further reservations, including a
not-yet-admitted turn; it does not undo in-flight/committed effects. A closed
tombstone also fences a delayed start that arrives after cancellation. Read and
receipt checks never dispatch recovery writes or new model invocations.

The reply is `ConversationView` version 1: root/turn keys, expiry, question count,
optional bounded original+typed question/id, and `ActionReceipt` version 1.
`conversation-wire.ts` and the native codec validate the same JSON shape. A shared
synthetic asset at `frontend-android/app/src/androidTest/assets/hermes-conversation.json`
is checked against the real backend projection over service-query fakes, then
used by web/native tests. These fakes are not live SQL/model acceptance evidence.

## Bounds, storage and expiry

- One active request per authenticated owner/client; **three questions total**.
  The initial question counts as round 1. The third answer may execute a resolved
  checklist, but may not produce a fourth question. At most four turn claims are
  stored (initial + three answers).
- Original plus all submitted answers: **at most 4,000 UTF-16 code units AND
  8,192 UTF-8 bytes**, whichever binds first. JS `String.length` and Kotlin
  `String.length` both count UTF-16, so an astral character counts twice. Both
  codecs reject unpaired surrogates and forbidden control characters. No silent
  truncation, compression/model calls, or unbounded answer log.
- The actual model prompt, including its JSON envelope/instructions, is also
  bounded by those limits. A near-limit unsupported request can fail that stricter
  envelope check before execution; the failure is explicit, not truncated.
- Pending text expires **24 hours from root creation**, not from the latest edit,
  answer, reload or disclosure. Expired questions cannot be answered. Client
  timers clear text while alive; restore/access checks also expire it. The API
  scrubs expired text before readiness, once per minute while running, and on
  conversation access. Logical expiry is exact; physical DB reclamation can lag
  one maintenance interval or an API outage. Failed maintenance emits a fixed
  warning. This is not guaranteed secure erasure from MVCC/backups.
- Closed/completed roots discard original, answer text and disposable prompt;
  canonical checklist, answer/claim fingerprints, durable operation receipts,
  uncertainty records and task deletion tombstones remain independent.
- Web drafts/latest receipt are owner-scoped **per-tab sessionStorage**: reload
  survives, closing the tab abandons text. This prevents another tab's late reply
  replacing a draft. Existing localStorage legacy history (20 entries) is retained
  separately; matching old text requires deliberate duplicate-risk confirmation.
  New failure history is at most 20 structured receipts, not parallel transcripts.
- Android uses the existing encrypted storage implementation in owner-scoped
  `hermes-<owner>.enc`, no password/model credentials. One pending state, one latest
  receipt, and at most 20 structured failure receipts; encoded restore guard is
  2,000,000 characters. No Hermes write is queued for offline replay. Reconnect and
  process restore may read receipts only.

## Receipts and clients

`ServiceTransport` captures allowlisted before/after fields with the domain write
and operation receipt in the same transaction. Inspection checks receipt actor,
command fingerprint and validated result, and reads the canonical record again.
For multiple substeps on a target, historical per-operation snapshots remain
inspectable and the last state is checked against fresh readback. Counts use
distinct kind/ID pairs, not operation-call count. Task removal retains its title
and deleted tombstone. Titles/dates/status/completion and available scalar changes
are disclosed; notes, descriptions, message bodies, HTML, arbitrary model prose
and provider payloads are deliberately omitted.

`saved` calendar effects stay **snapshot_pending/uncertain**. Their reference is
explicitly a calendar mutation ID, not a fabricated event ID or verified sync.
No guessed record URLs are added: View presents truthful record details/IDs.
The known calendar ID-transcription defect is not repaired by this feature.

Both clients retain a directly typeable compact textbox, inline questions with
the original request, and a single latest one-line receipt with View/dismiss.
Only supported confirmed completion clears the transcript and returns to a fresh
compact input (read-only results remain separately labelled). Partial/uncertain
work stays visible, editable and clearable, without forced retry or auto resend.
Close disclosure preserves the pending draft. Generation, root/turn and owner
checks prevent late replies replacing a newer draft. Capability discovery does
not disable/replace the web input with a loader: confirmed v2 upgrades transfer
typed text/focus; failed discovery never selects a fallback executor. Pinned old
requests retain their original key, executor, response validation and history.
Receipt-only reload preserves an unsent answer to the same question. An explicit
receipt check confirming older work preserves text edited into a newer draft;
it does not silently clear that draft or submit it.
Read-only results release the write-forbidden read slot but leave the query
editable and explicitly do not certify full natural-language scope. They are not
green mutation completion, including when a mixed request attempted no writes.

Native Android reserves a lower shell band immediately above bottom navigation
on Today, Inbox, Focus and Projects. The directly typeable editor stays pinned
below independently scrollable question/receipt details; the dock is capped at
55% of the available viewport, not screenshot pixels. The shell lifts above IME;
navigation/header temporarily hide while editing and return with the same page.
Scaffold padding reserves content space: no list/navigation overlay. Per-page
saveable state retains scroll/filter state; Focus scrolls in a reduced viewport.
Inbox search/account/importance/search-all/reset/mail-settings are LazyColumn
header items and scroll away with messages, rather than remaining above them.
After a task effect, its list refresh is **GET-only**. Full owner/generation,
receipt key, unchanged local/base/version and non-stale remote-version fences
precede publishing. Three-way merge preserves dirty local edits, unknown fields,
recurrence and tombstones; conflicts leave the cache/base untouched for explicit
review. No offline/outbox entry is posted, acknowledged or discarded by it.
An edit/sync racing the read causes publication to be skipped, not forced; a
subsequent receipt change or completed explicit sync can request a fresh GET.

## Price retirement and compatibility

Web/Android no longer offer price navigation, settings or offer screens. Web
`/prices` is a truthful retirement notice for old bookmarks; a restored Android
`Prices` destination falls back to Today with a notice. Historical caches, rows,
tables and parser helpers are preserved; no cleanup/migration is introduced.
The three authenticated old price endpoints return HTTP410 without SQL. API and
worker startup no longer migrate/schedule prices; `checkPrices` is inert, the
bridge returns410 for `price-check`, and connector dispatch refuses before browser
activation. Source retirement still requires parent deployment/restart of the
reviewed runtime components to stop an already installed old worker/bridge.

`ACTIVE_TOOLS` and Python/product schemas advertise exactly **35** tools, with no
price capability. `TOOLS.list_prices` remains historical decode metadata only:
new schema generation/validators/dispatch refuse it. Explicit historical journal
decoding retains strict old shapes so frozen 36-tool journals can recover their
nonprice receipts without another model run; archived price reads are omitted
from client receipts. The reliability inventory is **265** pending cases
(35×3 tool + 120 UI + 40 workflow), not evidence of executed acceptance.

## Verification boundary

Parent reported the preceding source snapshot: Android assemble/unit/lint passed
(42 tests, 11 suites, no failures; lint 0 errors/12 warnings), Python action tests
20 PASS; debug APK created, **not installed**. Web had 14 failures / 237 passes;
backend and strict runner were blocked by TS2367. The subsequent narrowing,
discovery/compatibility, native readback, shell dock, scrolling Inbox, price
retirement, shared-fixture and instrumentation edits
require **fresh parent execution**. No worker test/build/live integration was run.

See [the opt-in runner guide](../../test/acceptance/README.md#clarificationreceipt-campaign-parent-only)
for the reviewed finite real CSE campaign. Parent owns checks, isolated PG/model
execution, Chromium, safe-home Android builds/test-APK compilation, approved
disposable-emulator verification, APK delivery and LXC deployment. Neither source
fixtures nor the earlier build prove Compose IME/recreation visuals or live CSE
completion. Calendar ID repair and the DOMPurify advisory remain outside scope.
