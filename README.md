# Testing notes app

A small hosted app exercising persistent notes, binary attachments, Rukie messages and
private actions. Both backend and frontend use TypeScript; Bun serves the built Vite
frontend and JSON API. There is no authentication: use synthetic data.

## Run and check

```sh
docker compose up -d --build
docker compose run --rm checks
```

Open http://localhost:8080 (`PORT=8082` selects another port). `PUBLIC_APP_URL` sets the
browser-facing address when using a proxy. Data survives `docker compose down`.
Checks use a separate disposable PostgreSQL database and controlled HTTP boundaries.
Local blob and message fixtures run in `devtools`. Messages appear in its logs.

## Development

[AGENTS.md](AGENTS.md) describes directory ownership, app-facing interfaces and change rules.
`frontend` owns the UI, `shared` owns API types, and `backend` contains HTTP adapters,
actions, services, DAOs and external clients. Each private action supplies help, validation
and both request/result Markdown through one definition in `backend/actions`.

Migrations in `backend/db/migrations` run in order before readiness under a transaction
lock. Checksums detect edited applied files. The three original SQL files and their
version ledger are preserved: existing notes, attachments and invocation receipts survive
upgrading from the Go implementation. Their checksums are recorded on first startup.

## Public API

- `GET /api/info`, `/api/config`, `/api/session`: public settings and browser preference.
- `GET/POST /api/notes`, `GET/PUT/DELETE /api/notes/{id}`: notes.
- `GET/POST /api/notes/{id}/attachments`: metadata and multipart `file` uploads.
- `GET/DELETE /api/attachments/{key}`: original bytes and deletion.
- `GET/POST /api/messaging`: configuration and message delivery.
- `GET /health/ready`: initialized database readiness.

Attachments support 32 MiB, including screenshots. Storage credentials stay in the
backend. Metadata deletion commits before best-effort blob deletion; interrupted uploads
or failed cleanup can leave private unreferenced objects until app deletion.
`/notes/<id>` supports direct navigation and refresh. “Remember this browser” sets a
host-only HttpOnly cookie and redirects to the configured URL; it is not authentication.

## Deploy and use

Build `docker build --platform linux/amd64 -t testing-notes:dev .` and publish the image
with this repository directory. The manifest declares public port 8080, private loopback
port 8081, PostgreSQL and blobs. [rukie-deploy.md](rukie-deploy.md) describes configuration;
[rukie-api.md](rukie-api.md) describes actions. `VERSION` identifies the image in the UI.
`RUKIE_APP_ENV` is an optional app display setting, defaulting to `production`.

The Send to Rukie form keeps its request ID for unchanged retries. `create_note` keeps
its mutation and full response in one database transaction; `lose_response_once` demonstrates
retrying after a committed response was lost. `list_notes` is read-only.
See [validation/README.md](validation/README.md) for evidence and boundaries.
