# Deployment

**Send to Rukie** sends note reports and attachments to the `reports` room.
The `reviewer` alias is the human a report can mention for review.

The notes web endpoint is public. Use synthetic data and a test room.

The separate `viewer` endpoint requires Rukie sign-in. After deployment, open the
app's settings in Rukie and grant access to the workspace users who should see it.
Open the viewer URL from the app menu to see your Rukie user ID. The endpoint
uses its own listener so the public notes endpoint cannot serve viewer requests.

`WELCOME_MESSAGE` optionally customizes the notes page.
