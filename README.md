# Hosted app for testing

A small notes application used to validate Rukie hosted-app builds, deployment, configuration, and PostgreSQL persistence across replacement and rollback. This is a reference workload, not the future hosted-app template.

The Go HTTP backend serves a plain HTML/JavaScript frontend and a JSON API from one container. PostgreSQL runs separately. The application container stores no persistent files. There is no authentication: use synthetic notes only and do not expose it as a private notes service.

## Run locally

```sh
docker compose up --build -d
```

Open http://localhost:8080. Set `PORT=8081` before the command to choose another local port. `docker compose down` preserves notes. `docker compose down -v` deletes them.

## Deploy to Rukie

Build a release from an exact commit of this repository. `rukie-app.json` declares the Dockerfile and the `web` endpoint on port 8080. Its `path` is the readiness check; the public endpoint still serves the application root.

Supply these runtime configuration values:

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection string for this app's database and role. The role needs permission to create its schema tables. Use TLS as required by the database service. |
| `WELCOME_MESSAGE` | Optional message displayed above the notes form. |

The development preview does not provision the database or manage secrets. Rukie validation supplies a disposable, isolated database with synthetic credentials. Do not put production database credentials into the preview's ordinary configuration field.

Startup runs `migrations/001_notes.sql` transactionally under a PostgreSQL advisory lock. The migration is repeatable, records schema version 1, and never deletes existing notes. Startup fails if initialization fails. `/health/ready` checks connectivity and the notes schema; it returns 503 while the database is unavailable.

`VERSION` is embedded into the application image and displayed in the UI. Changing it and building another release makes replacement and rollback visible without changing the schema. Requests and pooled database connections are bounded. SIGTERM drains HTTP requests before closing the pool.

## Validation contract

Rukie's Validation Platform pins a full source commit. It imports that revision into a local repository, builds and deploys through the real product UI, creates and edits notes through this frontend, replaces the release, rolls back, verifies retained note IDs/content, deletes a note, and removes the runtime and database. A second local commit changes `VERSION`; a separate local commit deliberately breaks the build. Those test mutations are not published here.

The source pin is updated deliberately in the Rukie repository. Validation does not track this repository's `main` branch automatically. PostgreSQL setup belongs to the validation fixture until database provisioning is implemented in the product.

The public API is intentionally small:

- `GET /api/info`: image version and configured welcome message.
- `GET /api/notes`: most recent 200 notes.
- `POST /api/notes`: create with `{"body":"text"}`.
- `PUT /api/notes/{id}`: replace note text.
- `DELETE /api/notes/{id}`: delete one note.
- `GET /health/ready`: database and schema readiness.

Frontend requests use relative URLs so the same image works at a domain root or Rukie's development path prefix. No runtime endpoint injects build failures or database faults; validation owns such interventions.
