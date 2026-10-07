# Current calendar integration

Calendar API, worker, authentication, and offline-queue behavior are implemented in `src/`; repository-level capability and safety limits are summarized in `../README.md`.

# Daymark backend

Independent Node.js 22+ / Fastify 5 / strict TypeScript service. Install with `npm ci` inside this directory. No frontend, database or integration dependency is required to boot.

- `npm run dev`: watch TypeScript sources
- `npm run check`: typecheck, Node test runner via tsx, production build
- `npm run build && npm start`: compiled server
- Copy `.env.example` to `.env` to override HOST, PORT, LOG_LEVEL. Shell environment takes precedence.
- Default: `http://127.0.0.1:3001`. Keep local until authentication and deployment boundaries are designed.
- `GET /health`: process health, not database readiness
- `GET /api/v1/status`: version and explicitly unavailable capabilities

`src/app.ts` constructs the app; `src/server.ts` handles environment, listen and graceful shutdown. Fastify supplies request logging and JSON error handling. Unknown routes return 404. No permissive CORS, provider credentials, database, or placeholder business endpoints are configured.

Frontend runs independently on port 5173 and proxies `/api` to this service during development. Root `dev:backend`, `check:backend`, `build:backend`, and `start:backend` scripts are optional shortcuts.
