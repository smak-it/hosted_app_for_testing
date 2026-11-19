import type { AdminOverview, SampleNoteResult } from "../../shared/admin";
import type { NotesService } from "../services/notes";
import { InputError } from "../domain/errors";
import { failure } from "./errors";
import { frontendFile } from "./frontend";

const userIDPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nilID = "00000000-0000-0000-0000-000000000000";
const sampleNote = "Sample note\nCreated from the Notes admin demo.";

export function adminHandler(service: NotesService, version: string) {
  const route = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    if (path === "/health/ready" && req.method === "GET") {
      await service.dao.ready();
      return Response.json({ status: "ready" });
    }

    // The hosted ingress strips client-supplied identity and adds the verified ID.
    const header = req.headers.get("X-Rukie-User-Id");
    const userID = header && userIDPattern.test(header) && header !== nilID ? header : null;

    if (path === "/api/admin" && req.method === "GET") {
      const overview: AdminOverview = {
        version,
        rukie_user_id: userID,
        ...(await service.dao.counts()),
      };
      return Response.json(overview);
    }
    if (path === "/api/admin/sample-note" && req.method === "POST") {
      if (!userID) throw new InputError("A Rukie identity is required.", 401);
      const result = await service.transaction(async (tx): Promise<SampleNoteResult> => {
        const note = await tx.save(sampleNote);
        return { note_id: note.id, ...(await tx.dao.counts()) };
      });
      return Response.json(result, { status: 201 });
    }
    if (req.method === "GET")
      return frontendFile(path === "/" ? "/admin.html" : path, "admin.html");
    return new Response(null, { status: 404 });
  };

  return async (req: Request) => {
    let response: Response;
    try {
      response = await route(req);
    } catch (error) {
      response = failure(error);
    }
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  };
}
