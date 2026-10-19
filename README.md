# Hosted app for testing

A small notes application used to validate Rukie hosted-app builds, deployment, configuration, and PostgreSQL and blob persistence across replacement and rollback. This is a reference workload, not the future hosted-app template.

The Go HTTP backend serves a plain HTML/JavaScript frontend and a JSON API from one container. PostgreSQL and blob storage run separately. The application container stores no persistent files. There is no authentication: use synthetic notes only and do not expose it as a private notes service.

## Run locally

```sh
docker compose up --build -d
```

Open http://localhost:8080. Set `PORT=8081` before the command to choose another local port. `docker compose down` preserves notes and attachments. `docker compose down -v` deletes them. Local Compose uses the explicitly local file-backed blob fixture in `devtools`; deployed validation uses the platform API backed by Azure Blob Storage or Azurite.

## Deploy to Rukie

Build a release from an exact commit of this repository. `rukie-app.json` declares the Dockerfile and the `web` endpoint on port 8080. Its `path` is the readiness check; the public endpoint still serves the application root.

The manifest requests the `main` database and private blob storage. Rukie provisions them for this app and injects connection settings; users do not enter credentials. Only `WELCOME_MESSAGE` is optional user configuration.

Runtime bindings:

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection string for this app's database and role. The role needs permission to create its schema tables. Use TLS as required by the database service. |
| `BLOB_STORAGE_URL` | Injected platform blob API endpoint. |
| `BLOB_STORAGE_TOKEN` | Injected app-scoped bearer token; keep it on the backend. |
| `WELCOME_MESSAGE` | Optional message displayed above the notes form. |

Startup applies the SQL files in `migrations` transactionally under a PostgreSQL advisory lock, records schema version 2, and preserves existing notes. `/health/ready` checks database connectivity and schema initialization.

Attachments are limited to 8 MiB. PostgreSQL stores metadata and Azure Blob Storage stores the bytes. The backend mediates downloads; browser code never receives storage credentials. Blob and PostgreSQL writes are not one transaction: an interrupted upload or failed byte cleanup after metadata deletion can leave an unreferenced blob, which app deletion removes with the private container. Deletion commits metadata first so a database failure cannot leave a visible attachment whose bytes were already destroyed. This reference workload does not provide an orphan collector.

`VERSION` is embedded into the application image and displayed in the UI. Changing it and building another release makes replacement and rollback visible without changing the schema. Requests and pooled database connections are bounded. SIGTERM drains HTTP requests before closing the pool.

## Validation contract

Rukie's Validation Platform pins a full source commit. It imports that revision into a local repository, builds and deploys through the real product UI, creates and edits notes through this frontend, replaces the release, rolls back, verifies retained note IDs/content, deletes a note, and removes the runtime and database. A second local commit changes `VERSION`; a separate local commit deliberately breaks the build. Those test mutations are not published here.

The source pin is updated deliberately in the Rukie repository. Validation does not track this repository's `main` branch automatically. Storage provisioning and deletion go through the production VM-plane code. Validation does not create application databases itself.

The public API is intentionally small:

- `GET /api/info`: image version and configured welcome message.
- `GET /api/notes`: most recent 200 notes.
- `POST /api/notes`: create with `{"body":"text"}`.
- `PUT /api/notes/{id}`: replace note text.
- `DELETE /api/notes/{id}`: delete one note.
- `GET /api/notes/{id}/attachments`: list attachment metadata.
- `POST /api/notes/{id}/attachments`: multipart upload using the `file` field.
- `GET /api/attachments/{key}`: download original bytes.
- `DELETE /api/attachments/{key}`: delete metadata and bytes.
- `GET /health/ready`: database and schema readiness.

Frontend requests use relative URLs so the same image works at a domain root or Rukie's development path prefix. No runtime endpoint injects build failures or database faults; validation owns such interventions.

## Public URLs and built frontend

The container always serves a Vite production build. There is no development server or hot reload, including when `RUKIE_APP_ENV=development`.

The manifest declares named ports and `health_path`. VM-plane injects `RUKIE_PUBLIC_URLS` (a JSON map from endpoint names to absolute browser-visible URLs). `RUKIE_APP_ENV` is an optional setting owned by this testing app, defaults to `production`, and can be set locally; it is not part of the hosted-app deployment API or injected by VM-plane. The same image can run behind different hostnames, HTTP/HTTPS, and external ports without rebuilding. The backend exposes only these public settings at `/api/config`; database and blob credentials stay server-side.

Frontend API calls and assets use the endpoint root. `/notes/<id>` supports direct navigation and refresh. “Remember this browser” is a display preference, **not authentication**: it exercises a host-only HttpOnly cookie and an absolute redirect to the assigned URL. Cookies use Secure when that URL is HTTPS.

Run `docker compose up --build` to build both frontend and backend locally. Standalone Compose defaults to `http://localhost:8080/`; set `PUBLIC_APP_URL` for a different external address (the default follows `PORT`). Production deployment obtains it automatically from VM-plane. Endpoint path prefixes are not supported.

`TESTING_APP_SECRET` is an optional runtime secret. `/api/secret-proof` returns whether it is configured and an HMAC of a fixed validation message, never the secret value. Rukie's validation compares the proof across updates and rollback. This endpoint is a testing fixture, not authentication; do not configure real credentials for it. An empty value is configured, while an absent variable is not.
