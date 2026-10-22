# Invocation

Use `invoke_hosted_app` with body `{"action":"create_note","text":"Quarterly report"}`.
Creates one persistent note and returns `{"id":123,"body":"Quarterly report","updated_at":"..."}`.

Optional attachments must be text files of at most 4 KiB each; their names and text
are appended to the note. Larger files are rejected by this example handler even
though the platform supports larger attachments. No room grant is needed.

For retry validation only, add `"lose_response_once":true`: the app commits the note,
returns one temporary failure, then returns the original note when the platform
retries the same invocation. Other actions and empty text are rejected.
