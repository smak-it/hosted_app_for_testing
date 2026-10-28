import { resolve } from "node:path";
import type { Config } from "../config";
import type { NotesService } from "../services/notes";
import { Rukie } from "../integrations/rukie";
import { failure } from "./errors";
import { InputError } from "../domain/errors";

function noteID(value: string) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)
    throw new InputError("Invalid note ID.");
  return Number(value);
}
export function publicHandler(service: NotesService, config: Config, version: string) {
  const rukie = new Rukie(config.messagingURL, config.conversation);
  const route = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    const method = req.method;
    if (path === "/health/ready") {
      await service.dao.ready();
      return Response.json({ status: "ready" });
    }
    if (path === "/api/info" && method === "GET")
      return Response.json({ version, message: config.message });
    if (path === "/api/config" && method === "GET")
      return Response.json({ environment: config.environment, urls: config.urls });
    if (path === "/session/start" && method === "GET")
      return new Response(null, {
        status: 303,
        headers: {
          Location: config.urls.web,
          "Set-Cookie": `notes_demo=remembered; Path=/; HttpOnly; SameSite=Lax${new URL(config.urls.web).protocol === "https:" ? "; Secure" : ""}`,
        },
      });
    if (path === "/api/session" && method === "GET")
      return Response.json({
        remembered: (req.headers.get("Cookie") || "")
          .split(";")
          .some((v) => v.trim() === "notes_demo=remembered"),
      });
    if (path === "/api/messaging") {
      if (method === "GET")
        return Response.json({
          enabled: !!config.messagingURL,
          conversation_id: config.conversation,
        });
      if (method === "POST") {
        const text = await req.text();
        if (Buffer.byteLength(text) > 128 * 1024) throw new InputError("Invalid message.", 413);
        return rukie.send(JSON.parse(text));
      }
    }
    if (path === "/api/notes" && method === "GET") return Response.json(await service.dao.list());
    const note = path.match(/^\/api\/notes\/(\d+)$/);
    if ((path === "/api/notes" && method === "POST") || (note && method === "PUT")) {
      const text = await req.text();
      if (Buffer.byteLength(text) > 16384) throw new InputError("Invalid note.", 413);
      const input = JSON.parse(text);
      if (!input || Object.keys(input).some((key) => key !== "body"))
        throw new InputError("Invalid note.");
      return Response.json(await service.save(input.body, note ? noteID(note[1]) : undefined), {
        status: note ? 200 : 201,
      });
    }
    if (note) {
      const id = noteID(note[1]);
      if (method === "GET") {
        const value = await service.dao.get(id);
        if (!value) throw new InputError("Note not found.", 404);
        return Response.json(value);
      }
      if (method === "DELETE") {
        await service.remove(id);
        return new Response(null, { status: 204 });
      }
    }
    const files = path.match(/^\/api\/notes\/(\d+)\/attachments$/);
    if (files) {
      const id = noteID(files[1]);
      if (method === "GET") return Response.json(await service.dao.attachments(id));
      if (method === "POST") {
        const file = (await req.formData()).get("file");
        if (!(file instanceof File)) throw new InputError("Choose a file.");
        return Response.json(await service.upload(id, file), { status: 201 });
      }
    }
    const file = path.match(/^\/api\/attachments\/([^/]+)$/);
    if (file) {
      const key = decodeURIComponent(file[1]);
      if (method === "DELETE") {
        await service.removeAttachment(key);
        return new Response(null, { status: 204 });
      }
      if (method === "GET") {
        const item = await service.dao.attachment(key);
        if (!item) throw new InputError("Attachment not found.", 404);
        const blob = await service.blobs.request("GET", key);
        return new Response(blob.body, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(item.filename)}`,
            "Content-Length": String(item.size),
          },
        });
      }
    }
    if (path.startsWith("/api/") || path.startsWith("/rukie") || method !== "GET")
      return new Response(null, { status: 404 });
    const root = resolve(import.meta.dir, "../../dist");
    const target = resolve(root, "." + decodeURIComponent(path));
    if (!target.startsWith(root + "/") && target !== root)
      return new Response(null, { status: 404 });
    const asset = Bun.file(
      path === "/" || /^\/notes\/\d+\/?$/.test(path) ? root + "/index.html" : target,
    );
    return (await asset.exists()) ? new Response(asset) : new Response(null, { status: 404 });
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
