import type { NotesService } from "../services/notes";
export type Metadata = { name: string; size_bytes: number; content_type: string };
export type ActionInput = { body: Record<string, unknown>; attachments: Metadata[] };
export type Invocation = {
  invocation_id: string;
  body: {
    operation: string;
    action: string;
    body: Record<string, unknown>;
    attachments?: Metadata[];
  };
  attachments?: { name: string; blob_key: string }[];
};
export type ActionResponse = { result: unknown; response_markdown: string };
export type ActionDefinition<P, R> = {
  name: string;
  description: string;
  read_only: boolean;
  markdown: string;
  validate: (input: ActionInput) => P;
  formatRequest: (preview: P) => string;
  execute: (service: NotesService, input: Invocation) => Promise<R>;
  formatResult: (result: R, input: Invocation) => string;
};
function nonempty(value: string) {
  if (!value?.trim()) throw new Error("Action Markdown must not be empty");
  return value;
}
export function defineAction<P, R>(definition: ActionDefinition<P, R>) {
  for (const value of [definition.name, definition.description, definition.markdown])
    nonempty(value);
  if (
    typeof definition.read_only !== "boolean" ||
    [
      definition.validate,
      definition.formatRequest,
      definition.execute,
      definition.formatResult,
    ].some((f) => typeof f !== "function")
  )
    throw new Error("Incomplete action definition");
  return {
    name: definition.name,
    description: definition.description,
    read_only: definition.read_only,
    markdown: definition.markdown,
    preview(input: ActionInput) {
      return nonempty(definition.formatRequest(definition.validate(input)));
    },
    async run(service: NotesService, input: Invocation): Promise<ActionResponse> {
      definition.validate({
        body: input.body.body,
        attachments: (input.attachments ?? []).map((file) => ({
          ...file,
          size_bytes: 0,
          content_type: "",
        })),
      });
      const result = await definition.execute(service, input);
      return {
        result,
        response_markdown: nonempty(definition.formatResult(result, input)),
      };
    },
  };
}
export type RegisteredAction = ReturnType<typeof defineAction<unknown, unknown>>;
export function registerActions(actions: RegisteredAction[]) {
  const registry = new Map<string, RegisteredAction>();
  for (const action of actions) {
    if (registry.has(action.name)) throw new Error(`Duplicate action: ${action.name}`);
    registry.set(action.name, action);
  }
  return registry;
}
