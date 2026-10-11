# dcc

A web-first personal workspace for daily tasks, assignments, exam preparation, calendars, email briefings, and price tracking.

## Stack

- React, TypeScript and Vite (`frontend/`)
- Node.js 22+, Fastify and PostgreSQL (`backend/`)
- Native Android: Kotlin and Compose (`frontend-android/`)
- Private Python connectors for Hermes, read-only email and browser-based price checks

## Development

```sh
npm --prefix frontend ci
npm --prefix backend ci
npm run dev
```

The frontend stays at `http://localhost:5173`, preserving the existing browser-storage origin. Its development `/api` proxy targets the backend at `http://127.0.0.1:5301`, keeping dcc development separate from Pebble on port 3001. The backend default and `.env.example` use port 5301; explicit `PORT` overrides remain supported, so production's explicit port is unchanged. An existing private `backend/.env` may override the default. If you override the backend port, keep the proxy target in `frontend/vite.config.ts` consistent.

To configure the backend, copy `backend/.env.example` to private `backend/.env` and supply your own configuration; shell environment takes precedence. The server loads `.env` from its working directory and runs database migrations on startup when `DATABASE_URL` is configured. Set `POSTGRES_PASSWORD` for the optional Compose database and `DATABASE_URL` for the backend connection. Never place secrets in frontend environment variables.

```sh
cd backend
docker compose up -d
npm run dev
```

Authentication, database support, planner, calendar, mail and prices are implemented, but available capabilities depend on configuration. `GET /health` reports process health, not database or integration readiness; `GET /api/v1/status` reports configured capability flags, not live integration health. See package.json files for worker, database-check and test commands. Calendar, email, planning and price checks require separately configured integrations; cloning this repository does not automatically provision them. Deployment scripts currently contain development-host paths and must be adapted before use. Personal service units and operational notes are intentionally excluded. These setup instructions are not production sign-off.

## Checks

```sh
npm run check
npm run check:backend
npm run test:e2e
```

Database integration tests require a configured test environment. Live integration scripts access real services: review them and obtain permission before execution.

## Current capabilities and limits

- Unified daily actions, assignment breakdowns and simple morning rollover; completing a step does not complete its parent obligation.
- Calendar synchronization, event editing and an offline outbox.
- Read-only multi-account Inbox and today's important-email summaries; no sending or mailbox flag changes.
- Inbox link heuristics only identify plausible public web URLs. They cannot verify site reputation, redirects, or DNS results, and provide no safety guarantees or trust badges in the UI.
- Price tracking for a specific XPS configuration, with separate new/open-box views. Additional products require verified connectors; local inventory filtering is unfinished.
- Cached views survive warm backend outages. Cold offline startup remains incomplete. Manual tasks save locally first and can synchronize across signed-in web and Android clients.
- Focus timer supports ordered sessions; reload persistence is not implemented.

This is an evolving single-user development application, not a hardened public multi-user service. Keep its API, browser control and integration bridges private. Browser caches contain personal data; plan backups and device access accordingly.

## Repository hygiene

Environment files, credentials, database exports, personal notes, local service units, dependencies, build outputs and browser-test artifacts are excluded from Git. Only empty environment templates belong in source control. Never commit mailbox exports, session cookies, private keys or access tokens.
