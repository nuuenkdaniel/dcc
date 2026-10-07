# Daymark

A web-first personal workspace for daily tasks, assignments, exam preparation, calendars, email briefings, and price tracking.

## Stack

- React, TypeScript and Vite (`frontend/`)
- Node.js 22+, Fastify and PostgreSQL (`backend/`)
- Private Python connectors for Hermes, read-only email and browser-based price checks

## Development

```sh
npm --prefix frontend ci
npm --prefix backend ci
npm run dev
```

The frontend serves on localhost:5173. To configure the backend, copy `backend/.env.example` to `backend/.env` and supply your own credentials. Set `POSTGRES_PASSWORD` for the optional Compose database and `DATABASE_URL` for the backend connection. Never place secrets in frontend environment variables.

```sh
cd backend
docker compose up -d
npm run dev
```

See package.json files for worker, database-check and test commands. Calendar, email and planning require separately configured integrations; cloning this repository does not provision them. Deployment scripts currently contain development-host paths and must be adapted before use. Personal service units and operational notes are intentionally excluded.

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
