import { registerActions } from "./definition";
import { createNote } from "../actions/create-note";
import { listNotes } from "../actions/list-notes";
import { InputError } from "../domain/errors";
export const actions = registerActions([createNote, listNotes]);
export function findAction(name: string) {
  const action = actions.get(name);
  if (!action) throw new InputError("Unknown action", 404);
  return action;
}
