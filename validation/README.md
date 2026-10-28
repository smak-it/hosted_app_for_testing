# Notes workspace validation

28 October 2026. Production Compose image, real PostgreSQL and local blob/Rukie fixtures.

- `docker compose run --rm checks`: formatting, types, lint, nine tests / 67 assertions
  and production frontend build pass. The production Docker image also builds.
- Chromium at 1440 px and 390 px: created and edited notes, uploaded/downloaded a file,
  sent a message to the local Rukie receiver, checked testing information, deleted a
  temporary note, and reloaded a direct note link. Existing notes remain readable.
- Messaging opens with focus in its text field; Escape closes it and restores focus.
  Mobile shows the list or detail separately. Long unbroken content wraps without
  horizontal page overflow. Empty state offers a clear next action.
- Controlled browser HTTP responses verified a direct-linked note absent from the
  list, Back during a delayed read, a failed refresh after a successful save, and
  Back during a failed save. Detail settles correctly, successful writes cannot be
  resubmitted from the creation form, and failed saves retain the editable draft.
- No browser page errors. Screenshots are kept outside Git. This is local UI validation,
  not a new deployment to the hosted VM environment.

To review manually, create a multiline note, attach a file, edit it, open its direct
link and use browser Back. Repeat at mobile width. Open Send to Rukie and its optional
settings, then Testing tools. Check empty and error states with browser request controls.

---

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
