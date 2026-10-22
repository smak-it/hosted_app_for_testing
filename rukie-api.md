# Invocation

Use `invoke_hosted_app` with body `{"action":"create_note","text":"Quarterly report"}`.
Creates one persistent note and returns `{"id":123,"body":"Quarterly report","updated_at":"..."}`.

Optional attachments may be any file type, including PNGs: up to 50 files of
32 MiB each. Files appear as downloadable note attachments; the note text stays
unchanged. Duplicate file references create one attachment. No room grant is needed.

For retry validation only, add `"lose_response_once":true`: the app commits the note,
returns one temporary failure, then returns the original note when the platform
retries the same invocation. Other actions and empty text are rejected.
