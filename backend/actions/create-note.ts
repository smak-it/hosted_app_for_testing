import { defineAction } from "../action-api/definition";
import { InputError } from "../domain/errors";
export const createNote = defineAction({
  name: "create_note",
  description: "Create a note with optional file attachments.",
  read_only: false,
  markdown:
    'Body: `{"text":"Review ready"}`. Returns {result: the created note, response_markdown}. Up to 50 attachments, each up to 32 MiB, are saved on the note, including screenshots. Optional `lose_response_once: true` simulates a lost reply for validation; retries reuse the invocation ID.',
  validate(input) {
    if (typeof input.body.text !== "string" || !input.body.text.trim())
      throw new InputError("text must be a non-empty string.");
    if (
      input.body.lose_response_once !== undefined &&
      typeof input.body.lose_response_once !== "boolean"
    )
      throw new InputError("lose_response_once must be a boolean.");
    return { text: input.body.text, count: input.attachments.length };
  },
  formatRequest: (input) =>
    `Create a note with ${input.count} attachment(s).\n\n    ${JSON.stringify(input.text)}`,
  execute: (service, input) =>
    service.createFromInvocation(input.body.body.text as string, input.attachments ?? []),
  formatResult: (result, input) =>
    `Created a note with ${new Set((input.attachments ?? []).map((file) => file.blob_key)).size} attachment(s).\n\n    ${JSON.stringify(result.body)}`,
});
