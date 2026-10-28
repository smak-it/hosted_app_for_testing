import { defineAction } from "../action-api/definition";
import { InputError } from "../domain/errors";
export const listNotes = defineAction({
  name: "list_notes",
  description: "Read the latest 200 notes.",
  read_only: true,
  markdown:
    "Body: `{}`. Returns {result: an array of notes with id, body and updated_at, response_markdown}. No attachments.",
  validate(input) {
    if (input.attachments.length) throw new InputError("list_notes does not accept attachments.");
    return input;
  },
  formatRequest: () => "Read the latest 200 notes.",
  execute: (service) => service.dao.list(),
  formatResult: (notes) =>
    `${notes.length} notes.\n` +
    notes.map((note) => `\n    ${JSON.stringify(note.body)}\n`).join(""),
});
