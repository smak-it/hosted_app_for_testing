# Testing notes app

This small reference app exercises notes, files, messaging and idempotent actions.
It has no customer authentication. Use synthetic data and keep examples small and
deterministic. Preserve existing note/attachment IDs and HTTP response shapes.
The documented `lose_response_once` action option demonstrates a committed result
whose reply is lost; it is part of this testing app's contract.

## What a hosted app is

A hosted app is an independent web application with a container image, public HTTP
endpoints, and optional PostgreSQL and private blob storage. Rukie is a collaboration
app where people and agents work in rooms and task conversations. A hosted app can
send messages to granted conversations and expose actions that Rukie can invoke.
The app owns its customer identity, authorization, business rules, and UI.

## Structure and changes

- `frontend/`: browser UI and HTTP client code. Never import backend code or credentials.
- `shared/`: types and pure domain code used on both sides; no database, network or environment access.
- `backend/http/`: parse requests, call services and map errors to HTTP responses.
- `backend/actions/`: one file per action and an explicit registry. Each action declares
  description, help, read-only status, validation, request Markdown, execution and result Markdown.
- `backend/services/`: business operations and transaction boundaries. Add a service
  for a real workflow; avoid wrappers that only forward a DAO call.
- `backend/dao/`: explicit SQL and persistence operations. Put SQL on its own lines,
  with readable clauses and named columns. Pass transaction handles from services.
- `backend/integrations/`: blob and Rukie clients.
- `backend/db/migrations/`: ordered SQL migrations. Add the next numbered file; never
  edit applied migrations. Startup applies them under a lock before accepting requests.
- `tests/`: HTTP/action journeys with real PostgreSQL and controlled external boundaries.
- `devtools/`: local fixtures, excluded from the application image.

Keep the existing UI and public contracts when refactoring. Use small concrete
components; no general-purpose repository framework or speculative abstraction.

## App-facing interfaces

`rukie-app.json` declares public endpoints, health paths, storage and the private
`rukie_api` listener. The image serves a built frontend using same-origin API URLs.
`DATABASE_URL`, `BLOB_STORAGE_URL` and `BLOB_STORAGE_TOKEN` are backend bindings;
`RUKIE_PUBLIC_URLS` maps endpoint names to public URLs. Persist durable data in
PostgreSQL and blobs, not the container filesystem.

`POST $RUKIE_API_URL/messages` sends `{request_id, conversation_id, content,
attachments?: [{blob_key, name}]}`. Reuse the request ID after an ambiguous failure.
Conversation destinations are app configuration. Only granted rooms are writable;
this API does not provide conversation history or customer authentication.

The private action request is `{invocation_id, body: {operation, action?, body?,
attachments?}, attachments?}`. Operations are `list`, `describe`, `validate`, `invoke`.
Validation receives attachment metadata (`name`, `size_bytes`, `content_type`), has
no side effects, and returns `{request_markdown, errors}`. Execution receives outer
attachment blob references (`name`, `blob_key`) and returns `{result, response_markdown}`.
Keep read-only actions non-mutating. Execution checks current domain state; a preview
is not authorization. Commit mutations and the complete response receipt together;
repeated invocation IDs return the saved response without repeating effects.

Keep `rukie-app.md`, `rukie-deploy.md` and `rukie-api.md` concise and specific to this
app: purpose, configuration/message destinations, and action usage. They are captured
with releases. Do not put credentials, real conversation IDs or platform internals there.

## Development and validation

Use Docker: `docker compose up -d --build` runs the app and local dependencies.
`docker compose run --rm checks` checks formatting, types, lint, real PostgreSQL
journeys and a production build. `docker compose run --rm checks bun run format`
formats source. Checks use a separate disposable database; never point them at app data.

For a new action, add an executable example to the catalog contract test. It must
exercise help, a valid and invalid preview, execution and a readable result. Test
retry behavior for mutations. For schema changes, prove upgrade preserves existing data.
Use a browser for UI changes. Keep fixtures and test controls outside production code.
