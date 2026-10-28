import { actions, findAction } from "../action-api/registry";
import type { Invocation } from "../action-api/definition";
import type { NotesService } from "../services/notes";
import { invoke } from "../services/invocation";
import { failure } from "./errors";
import { InputError } from "../domain/errors";
import { MAX_FILE_BYTES } from "../../shared/notes";
export function privateHandler(service: NotesService) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/rukie")
        return new Response(null, { status: 404 });
      const input = (await request.json()) as Invocation;
      if (!input?.body) throw new InputError("Expected action request");
      const query = input.body;
      if (query.operation === "list")
        return Response.json({
          actions: [...actions.values()].map(({ name, description, read_only }) => ({
            name,
            description,
            read_only,
          })),
        });
      const action = findAction(query.action);
      if (query.operation === "describe") {
        const { name, description, read_only, markdown } = action;
        return Response.json({ name, description, read_only, markdown });
      }
      if (query.operation === "validate") {
        try {
          if (!query.body || typeof query.body !== "object" || Array.isArray(query.body))
            throw new InputError("Expected a JSON body object.");
          const files = query.attachments ?? [];
          if (!Array.isArray(files) || files.length > 50)
            throw new InputError("At most 50 attachments.");
          if (
            files.some(
              (file) =>
                typeof file?.name !== "string" ||
                !file.name ||
                !Number.isInteger(file.size_bytes) ||
                file.size_bytes <= 0 ||
                file.size_bytes > MAX_FILE_BYTES,
            )
          )
            throw new InputError("Attachments require a name and 1 byte to 32 MiB.");
          return Response.json({
            request_markdown: action.preview({ body: query.body, attachments: files }),
            errors: [],
          });
        } catch (error) {
          if (error instanceof InputError)
            return Response.json({ request_markdown: "", errors: [error.message] });
          throw error;
        }
      }
      if (query.operation === "invoke") return Response.json(await invoke(service, input));
      throw new InputError("Unknown operation");
    } catch (error) {
      return failure(error);
    }
  };
}
