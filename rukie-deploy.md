# Deployment

The manifest declares two connections used by **Send to Rukie**:

- Room `reports`: the room that receives note reports and attachments.
- User `reviewer`: the human mentioned by `@{reviewer}` in a report.

Configure both connections with their descriptions and appropriate test targets in
Rukie. The manifest guides the agent; Rukie settings are independent. Copy the
reviewer's `human_only: true` requirement into its Rukie binding. The reviewer must
belong to the destination conversation to receive the normal mention notification.
This reference app has no authentication; use synthetic data and test rooms.
The report endpoint sends `room_alias: "reports"`; tenant IDs are not app settings.

`WELCOME_MESSAGE` optionally customizes the notes page. PostgreSQL and blob bindings
come from the manifest and are supplied by the platform. Choose a subdomain for `web`.

Choose an alerts destination in Rukie on first deployment, normally the implementation
room. Alerts routing belongs to Rukie and is not an app alias.
