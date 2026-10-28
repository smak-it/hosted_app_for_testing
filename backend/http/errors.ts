import { InputError } from "../domain/errors";
export function failure(error: unknown): Response {
  if (error instanceof InputError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof SyntaxError)
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  console.error("Request failed", error);
  return Response.json({ error: "Storage unavailable. Please try again." }, { status: 503 });
}
