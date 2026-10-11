# dcc backend

Independent Node.js 22+ / Fastify 5 / strict TypeScript service. Install with `npm ci` inside this directory. Authentication, PostgreSQL persistence and migrations, planner/manual tasks, calendar API and synchronization, mail and prices are implemented in `src/`; available capabilities depend on configuration. Repository-level capability and safety limits are summarized in `../README.md`.

- `npm run dev`: watch TypeScript sources
- `npm run check`: typecheck, Node test runner via tsx, production build
- `npm run build && npm start`: compiled server
- Copy `.env.example` to private `.env` to configure the service, including HOST, PORT and LOG_LEVEL. The server loads `.env` from its working directory; shell environment takes precedence. Never commit credentials.
- Development default and template: `http://127.0.0.1:5301`, separate from Pebble on 3001. Explicit `PORT` overrides remain supported; production's explicit port is unchanged. An existing private `.env` may override the default.
- `GET /health`: process health, not database readiness
- `GET /api/v1/status`: version and configured capability flags, not live integration readiness. With no configured dependencies, flags are false.

`src/app.ts` constructs the app without listening; `src/server.ts` loads the private environment, configures dependencies, listens and handles graceful shutdown. Without database or integration configuration, the process can boot with limited capabilities. When `DATABASE_URL` is set, startup creates a PostgreSQL pool and runs database, planner, mail and price migrations before listening; database availability and migration success then affect startup. Authentication requires the database plus configured username, password and exact app origin. Calendar capabilities require the database and calendar configuration; planner, manual-task, mail and price routes depend on the database, while external refreshes require their separately configured workers/connectors. Cloning or starting the service does not automatically provision integrations.

Fastify supplies request logging and JSON error handling. Unknown routes return 404; unavailable dependency-backed routes may return 503, and protected routes require authentication. Keep the service and integration bridges private. Implemented authentication is not production hardening or production sign-off.

Frontend runs independently at `http://localhost:5173`, preserving the existing browser-storage origin, and proxies `/api` to `http://127.0.0.1:5301` during development. If you override the backend port, update the target in `../frontend/vite.config.ts` to match; changing backend `PORT` alone does not change that proxy. Root `dev:backend`, `check:backend`, `build:backend`, and `start:backend` scripts are optional shortcuts.
