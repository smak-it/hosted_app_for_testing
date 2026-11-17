# Deployment

The manifest declares two connections used by **Send to Rukie**:

- Room `reports`: the room that receives note reports and attachments.
- User `reviewer`: the human or agent mentioned by `@{reviewer}` in a report.

Bind both connections to appropriate test targets in Rukie. The reviewer must belong
to the destination conversation to receive the normal mention notification or agent
trigger. This reference app has no authentication; use synthetic data and test rooms.
The app sends `room_alias: "reports"` and does not need tenant IDs in environment variables.

`WELCOME_MESSAGE` optionally customizes the notes page. PostgreSQL and blob bindings
come from the manifest and are supplied by the platform. Choose a subdomain for `web`.
