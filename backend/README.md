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

## Conversation admission and no-action receipts

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
