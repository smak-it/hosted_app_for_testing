import type { Invocation } from "../actions/definition";
import { findAction } from "../actions/registry";
import { InputError } from "../domain/errors";
import { InvocationsDao } from "../dao/invocations";
import type { NotesService } from "./notes";
import type { TransactionSQL } from "bun";
export async function invoke(service: NotesService, input: Invocation) {
  const action = findAction(input.body.action);
  if (
    typeof input.invocation_id !== "string" ||
    !input.invocation_id ||
    !input.body.body ||
    typeof input.body.body !== "object" ||
    Array.isArray(input.body.body)
  )
    throw new InputError("Expected invocation_id and a JSON body object");
  const files = input.attachments ?? [];
  if (
    !Array.isArray(files) ||
    files.length > 50 ||
    files.some(
      (file) =>
        typeof file?.name !== "string" ||
        !file.name.trim() ||
        typeof file.blob_key !== "string" ||
        !file.blob_key,
    )
  )
    throw new InputError("At most 50 attachments with name and blob_key");
  if (action.read_only) return action.run(service, input);
  let replay = false;
  const response = await service.transaction(async (tx) => {
    const receipts = new InvocationsDao(tx.db as TransactionSQL);
    await receipts.lock(input.invocation_id);
    const old = await receipts.receipt(input.invocation_id);
    if (old) {
      replay = true;
      return old;
    }
    const result = await action.run(tx, input);
    await receipts.record(input.invocation_id, result);
    return result;
  });
  if (!replay && input.body.body.lose_response_once)
    throw new InputError("Validation: successful response lost; retry the same invocation", 503);
  return response;
}
