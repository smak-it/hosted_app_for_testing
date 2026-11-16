# Deployment

The notes UI and private invocation API need no room access. For the “Send to Rukie”
form, include the containing room of the destination conversation in deployment
`connections.rooms`, for example `{"reports":"<room UUID>"}`. This also authorizes
messages to its task conversations. The alias need not be declared in the manifest. Set `REPORT_CONVERSATION_ID` to that conversation ID as its default;
the form also lets the user enter a destination explicitly. Grant only test rooms:
this reference app has no authentication.

`WELCOME_MESSAGE` optionally customizes the notes page. PostgreSQL and blob bindings
come from the manifest and are supplied by the platform. Choose a subdomain for `web`.
