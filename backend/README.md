# dcc backend

Independent Node.js 22+ / Fastify 5 / strict TypeScript service. Install with `npm ci` inside this directory. Authentication, PostgreSQL persistence and migrations, planner/manual tasks, calendar API and synchronization, and mail are implemented in `src/`; available capabilities depend on configuration. Prices are retired; historical storage is preserved. Repository-level capability and safety limits are summarized in `../README.md`.

- `npm run dev`: watch TypeScript sources
- `npm run check`: typecheck, Node test runner via tsx, production build
- `npm run build && npm start`: compiled server
- Copy `.env.example` to private `.env` to configure the service, including HOST, PORT and LOG_LEVEL. The server loads `.env` from its working directory; shell environment takes precedence. Never commit credentials.
- Development default and template: `http://127.0.0.1:5301`, separate from Pebble on 3001. Explicit `PORT` overrides remain supported; production's explicit port is unchanged. An existing private `.env` may override the default.
- `GET /health`: process health, not database readiness
- `GET /api/v1/status`: version and configured capability flags, not live integration readiness. With no configured dependencies, flags are false.

`src/app.ts` constructs the app without listening; `src/server.ts` loads the private environment, configures dependencies, listens and handles graceful shutdown. Without database or integration configuration, the process can boot with limited capabilities. When `DATABASE_URL` is set, startup creates a PostgreSQL pool and runs database, planner and mail migrations before listening; database availability and migration success then affect startup. Authentication requires the database plus configured username, password and exact app origin. Calendar capabilities require the database and calendar configuration; planner, manual-task and mail routes depend on the database, while external refreshes require their separately configured workers/connectors. Retired price routes retain normal authentication/Origin checks but return HTTP410 without SQL; no startup price migration, worker scheduling or connector dispatch remains active. Historical rows/tables are untouched. Cloning or starting the service does not automatically provision integrations.

Fastify supplies request logging and JSON error handling. Unknown routes return 404; unavailable dependency-backed routes may return 503, and protected routes require authentication. Keep the service and integration bridges private. Implemented authentication is not production hardening or production sign-off.

Frontend runs independently at `http://localhost:5173`, preserving the existing browser-storage origin, and proxies `/api` to `http://127.0.0.1:5301` during development. If you override the backend port, update the target in `../frontend/vite.config.ts` to match; changing backend `PORT` alone does not change that proxy. Root `dev:backend`, `check:backend`, `build:backend`, and `start:backend` scripts are optional shortcuts.

## Conversation-first chat

### Optional native display synchronization

Authenticated discovery advertises `conversationDisplaySyncVersion: 1`. Only
requests carrying `X-Dcc-Display-Sync: 1` can receive optional `displaySync` on the
existing conversation response. No execution admission, fingerprint, runtime
policy, model prompt or journal schema changes. Old native/web envelopes and
strict validators remain unchanged when the header is absent.

The projection requires a live closed chat root and matching owner/client/root
journal binding. It checks actor-scoped durable operation receipts against full
bounded journal commands/results (48 calls / 16 writes), not natural prose or the
four-target receipt. Output is at most 16 affected task/calendar identities and
16 KiB: task result versions plus projected display fields; saved calendar
mutation/calendar/resource-hash/UID/date identities. No provider URL, raw result,
notes, description or capability is added. Invalid/missing evidence grants no
display confirmation. Provider/DB transport errors do not retry a command.

Projection uses existing SQL receipts and the configured cache-only calendar
snapshot accessor, never the writer or calendar refresh endpoint. Resource/UID
ambiguity remains pending; deletion and series completion are not certified from
absence or one cached occurrence. The native client performs finite cache GETs
and reconciles local tasks without uploading phone edits. Source tests are in
`test/mcp/conversation-first.test.ts`; synthetic SQL/provider adapters do not
establish live model, PostgreSQL concurrency or production acceptance.

The explicitly negotiated conversation route (`chatVersion: 1`, with
`replyVersion: 1`) treats each explicit
Send as an independent conversational turn with bounded recent history. Hermes
may chat, explain, brainstorm, clarify naturally or select the existing MCP
tools. It does not regex-parse study requests into executable checklists and it
does not hold an unanswered-question slot. A later message can change topic.
No tool is required to finish a turn. Discovery advertises
`conversationChatVersion: 1`; the response echoes `chatVersion: 1`. The older
`conversationReplyVersion: 1` flag only negotiates display text and is not a chat
opt-in. Clients never strip fields or retry through the legacy route on error.
Legacy callers, including reply-enabled ones, retain their existing contract;
old records are not migrated into new execution.

The registered SDK/typed service adapter, authentication, owner/root binding,
durable reservation-before-dispatch, backend-owned IDs/operation keys, version/
ETag checks, and unknown-operation fences remain authoritative. Technical bounds
are 48 calls / 16 writes / 120 seconds only for explicitly marked chat journals;
unmarked legacy/task-only journals retain 12 calls / 4 writes and their original
policy. The immutable guard carries the chat marker; retries cannot upgrade it.
The runtime retains
its independent 90-second budget with at most 32 iterations. Six creations are
allowed, not synthesized by a host checklist. Calendar `saved` remains pending
confirmation, not a synced-event claim. Domain APIs and schemas are unchanged.

Natural assistant prose is preserved, including combined create-and-explain
responses. No keyword filter classifies conversational text as mutation success.
Actual tool results supply a separate bounded `toolSummary`, counted from the
full admitted journal without a predeclared expected count. Failed/interrupted
or provider-pending results retain plain partial/error facts. The summary is a
fallback when final text is unavailable, not a mandatory replacement response.
Prose is not execution authority or semantically verified by the host; actual MCP
results must be asserted separately. Scripted tests cannot prove genuine-model
reasoning or end-user delivery. The old bounded receipt envelope remains an
internal/compatibility detail, not a normal chat card or a limit on actual writes.
Duplicate keys/read/reopen never rerun a claimed turn; a failed turn does not
prevent a different new message. No automatic retry or legacy-task replay exists.

Tracked `deploy/task_action_runtime.py` uses the supported Hermes `AIAgent` and
MCP registration seam, excluding the fixed clarification tool only for explicitly
versioned chat. The tracked bridge/runtime forward `chatVersion` separately from
the final-text `replyVersion`; a legacy bridge rejects unsupported fields rather
than silently downgrading. The launcher is unchanged. Legacy reply envelopes and
non-opted-in lifecycle ACKs remain unchanged.
Installed runtime files are not changed by editing these source candidates.

Focused deterministic targets: `test/mcp/conversation-first.test.ts`,
`test/mcp/assistant-reply.test.ts`, and `deploy/test_task_action_runtime.py`.
They use the actual registered MCP adapter with synthetic stores/provider stubs.
Real isolated PostgreSQL persistence, genuine-model acceptance, deployment and
handset acceptance are distinct gates; none is implied by the source fixtures.

## Legacy conversation admission and no-action receipts

A genuinely fresh start can supersede an unexpired unanswered clarification in
the same authenticated owner/client slot only after the existing strict intent
store validates its current turn journal: completed phase, matching owner/client/
old-root guard binding, and no admitted write commands. Question status alone is
not evidence of safety. Missing, corrupt, unavailable, active, uncertain or
binding-mismatched journals and any admitted write (including a reservation or a
rejected write) remain fenced. Running conversations are not superseded.

The slot/root transaction closes the old clarification with a failed/superseded
receipt and discards its disposable text before transferring the slot. Both
changes commit together or roll back together. The journal and original keys
remain intact. Old answers cannot resume; same-key duplicates return existing
receipts without dispatch. Closing the old question invokes no runner or tools.
The lock order remains conversation slot/root then intent legacy advisory lock,
legacy row and journal row. Supersession uses the caller-owned transaction read
on that same planner connection, with the ordinary strict actor/journal/legacy
validation; it neither checks out another connection nor manages the transaction
lifecycle. The ordinary intent-store read API is unchanged. The conversation
transaction is released before any new runner invocation.
Cancelling a never-arrived root still creates only that root's tombstone; it does
not by itself close a different root referenced by the slot.

With explicit `replyVersion: 1`, a completed journal with zero calls can report
`read-only` / `No actions performed.` without requiring a read-only prompt guard.
This is no-action evidence, not fulfillment of a requested mutation. Checklist
failure and write/readback requirements are unchanged. Assistant text remains a
separate bounded display field, never evidence of effects. Legacy non-opted-in
zero-call receipts keep their existing behavior; active/unknown journals never
become no-action success.

Focused synthetic regressions are in `test/mcp/conversation.test.ts` and
`test/mcp/assistant-reply.test.ts`. They cover safe supersession, old answers and
duplicates, adverse journals/bindings and writes, rollback, slot contention, late
completion, generic no-tool replies and legacy/unknown receipt behavior. The
query/lock fake is not PostgreSQL concurrency proof, and scripted runners are
not provider/model acceptance. Actual PostgreSQL HTTP, typecheck, full tests and
build verification remain separate checks; no live integrations are needed for
these unit fixtures.
