# TypeScript port validation

2026-10-27, Bun 1.4.2, PostgreSQL 18, production Vite assets.

Run `docker compose run --rm checks`. Nine tests / 67 assertions passed; test execution
was about 0.17 seconds. Formatting, types, lint, frontend build and the production
Docker image build also passed.

| Journey | Observed result |
| --- | --- |
| Upgrade from original Go SQL | Existing note retained; concurrent startup records three migration checksums |
| New migration | Discovered and applied once; edited content rejected without data loss |
| Action contracts | Every catalog action has help, valid/invalid previews, execution and result Markdown |
| Lost response / concurrent retry | One saved note and the same complete response |
| Formatter failure | Mutation and receipt roll back together |
| Notes and binary files | Create/edit/read/delete, PNG bytes and metadata, retained state on new service instance |
| Message delivery | Stable request ID and blob references reach the configured conversation |
| Invalid attachments | Caller errors, without retryable storage failures |

Chromium checked the built Docker image: created a note, uploaded a PNG, opened and
reloaded its direct URL, and sent a message to the local Rukie receiver. No page errors.

PostgreSQL and the app code are real. Blob storage and Rukie messaging use controlled
HTTP boundaries. These checks do not claim a new live Rukie deployment.
