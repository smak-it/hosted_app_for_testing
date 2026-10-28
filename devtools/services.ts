// Local development boundary only; never copied into the hosted app image.
import { mkdir, unlink } from "node:fs/promises";
const root = process.env.DATA_DIR || "/data";
await mkdir(root, { recursive: true });
Bun.serve({
  port: 8080,
  maxRequestBodySize: 33 * 1024 * 1024,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/messages" && request.method === "POST") {
      const message = await request.json();
      console.log("Rukie message accepted by local fixture", JSON.stringify(message));
      return Response.json({ message_id: message.request_id });
    }
    if (request.headers.get("Authorization") !== "Bearer local-development-only")
      return new Response(null, { status: 401 });
    const match = path.match(/^\/blobs\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,127})$/);
    if (!match) return new Response(null, { status: 404 });
    const filename = `${root}/${match[1]}`;
    if (request.method === "PUT") {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.length || bytes.length > 32 * 1024 * 1024)
        return new Response(null, { status: 413 });
      await Bun.write(filename, bytes);
      return new Response(null, { status: 204 });
    }
    if (request.method === "DELETE") {
      await unlink(filename).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      return new Response(null, { status: 204 });
    }
    const file = Bun.file(filename);
    return request.method === "GET" && (await file.exists())
      ? new Response(file)
      : new Response(null, { status: 404 });
  },
});
