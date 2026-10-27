import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { beforeAll, beforeEach, afterAll, test, expect } from "bun:test";
import { SQL } from "bun";
import { migrate } from "../backend/db/migrate";
import { NotesService } from "../backend/services/notes";
import { BlobStorage } from "../backend/integrations/blobs";
import { publicHandler } from "../backend/http/public";
import { privateHandler } from "../backend/http/private";
import { actions } from "../backend/actions/registry";
import {
  defineAction,
  registerActions,
  type ActionDefinition,
} from "../backend/actions/definition";
import type { Note, Attachment } from "../shared/notes";
import { configuration } from "../backend/config";
const db = new SQL(process.env.TEST_DATABASE_URL!);
const objects = new Map<string, Uint8Array>();
const messages: unknown[] = [];
const boundary = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/messages") {
      messages.push(await req.json());
      return Response.json({ message_id: "message-id" });
    }
    if (req.headers.get("authorization") !== "Bearer test-token")
      return new Response(null, { status: 401 });
    const key = decodeURIComponent(path.slice(1));
    if (req.method === "PUT") {
      objects.set(key, new Uint8Array(await req.arrayBuffer()));
      return new Response(null, { status: 204 });
    }
    if (req.method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return objects.has(key)
      ? new Response(objects.get(key)! as BodyInit)
      : new Response(null, { status: 404 });
  },
});
const config = configuration({
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  BLOB_STORAGE_URL: boundary.url.href,
  BLOB_STORAGE_TOKEN: "test-token",
  RUKIE_PUBLIC_URLS: '{"web":"https://notes.example/"}',
  RUKIE_API_URL: boundary.url.href,
  REPORT_CONVERSATION_ID: "conversation",
});
const service = new NotesService(db, new BlobStorage(config.blobURL, config.blobToken));
const web = publicHandler(service, config, "test");
const api = privateHandler(service);
const call = (
  operation: string,
  action = "",
  body: Record<string, unknown> = {},
  id = Bun.randomUUIDv7(),
  files: unknown[] = [],
  previewFiles: unknown[] = [],
) =>
  api(
    new Request("http://app/rukie", {
      method: "POST",
      body: JSON.stringify({
        invocation_id: id,
        body: { operation, action, body, attachments: previewFiles },
        attachments: files,
      }),
    }),
  );
const request = (path: string, method = "GET", body?: unknown) =>
  web(
    new Request("https://notes.example" + path, {
      method,
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    }),
  );
beforeAll(async () => {
  // Start from the original Go schema and a saved note, as on an existing app.
  await db`DROP SCHEMA public CASCADE`;
  await db`CREATE SCHEMA public`;
  for (const name of ["001_notes.sql", "002_attachments.sql", "003_invocations.sql"])
    await db.unsafe(
      await Bun.file(new URL(`../backend/db/migrations/${name}`, import.meta.url)).text(),
    );
  const [old] = await db`INSERT INTO notes (body) VALUES ('Saved before TypeScript') RETURNING id`;
  await Promise.all([migrate(db), migrate(db)]);
  expect((await service.dao.get(old.id))?.body).toBe("Saved before TypeScript");
  const ledger = await db`SELECT checksum FROM schema_migrations`;
  expect(ledger.length).toBe(3);
  expect(ledger.every((row: { checksum: string }) => row.checksum?.length === 64)).toBe(true);
  console.log(
    "Migration evidence: concurrent startup preserved the original Go note and baselined 3 migrations.",
  );
});
beforeEach(async () => {
  await db`TRUNCATE rukie_invocations, attachments, notes RESTART IDENTITY`;
  objects.clear();
  messages.length = 0;
});
afterAll(async () => {
  await db.close();
  await boundary.stop(true);
});

test("every catalog action has help, side-effect-free preview and a formatted executable result", async () => {
  const examples: Record<string, Record<string, unknown>> = {
    list_notes: {},
    create_note: { text: "Contract note", lose_response_once: true },
  };
  const catalog = await (await call("list")).json();
  expect(catalog.actions.map((a: { name: string }) => a.name).sort()).toEqual(
    Object.keys(examples).sort(),
  );
  for (const action of catalog.actions) {
    const help = await (await call("describe", action.name)).json();
    expect(help.markdown.trim().length).toBeGreaterThan(0);
    const count = (await service.dao.list()).length;
    const preview = await (await call("validate", action.name, examples[action.name])).json();
    expect(preview.errors).toEqual([]);
    expect(preview.request_markdown.length).toBeGreaterThan(0);
    expect((await service.dao.list()).length).toBe(count);
    const invalid = await (
      await call(
        "validate",
        action.name,
        {},
        undefined,
        [],
        [{ name: "file", size_bytes: 1, content_type: "text/plain" }],
      )
    ).json();
    expect(invalid.errors.length).toBeGreaterThan(0);
    const id = Bun.randomUUIDv7();
    let result = await call("invoke", action.name, examples[action.name], id);
    if (!action.read_only) {
      expect(result.status).toBe(503);
      result = await call("invoke", action.name, examples[action.name], id);
    }
    expect(result.status).toBe(200);
    const data = await result.json();
    expect(data.result).toBeDefined();
    expect(data.response_markdown.trim().length).toBeGreaterThan(0);
    if (!action.read_only) {
      expect(await (await call("invoke", action.name, examples[action.name], id)).json()).toEqual(
        data,
      );
      expect((await service.dao.list()).length).toBe(count + 1);
    }
  }
});
test("public notes, binary attachments, preference cookie and restart persistence", async () => {
  const created = await request("/api/notes", "POST", { body: "  Hello  " });
  expect(created.status).toBe(201);
  const note = (await created.json()) as Note;
  expect(typeof note.id).toBe("number");
  expect(note.body).toBe("Hello");
  expect((await request(`/api/notes/${note.id}`, "PUT", { body: "Updated" })).status).toBe(200);
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
  const form = new FormData();
  form.append("file", new File([png], "screenshot.png"));
  const upload = await request(`/api/notes/${note.id}/attachments`, "POST", form);
  expect(upload.status).toBe(201);
  const attachment = (await upload.json()) as Attachment;
  expect(attachment.content_type).toBe("image/png");
  expect(
    new Uint8Array(await (await request(`/api/attachments/${attachment.id}`)).arrayBuffer()),
  ).toEqual(png);
  const restarted = new NotesService(db, service.blobs);
  expect((await restarted.dao.get(note.id))?.body).toBe("Updated");
  expect((await restarted.dao.attachments(note.id)).length).toBe(1);
  const session = await request("/session/start");
  expect(session.status).toBe(303);
  expect(session.headers.get("Location")).toBe("https://notes.example/");
  expect(session.headers.get("Set-Cookie")).toContain("Secure");
  expect((await request(`/api/notes/${note.id}`, "DELETE")).status).toBe(204);
  expect(objects.size).toBe(0);
  expect((await request(`/api/notes/${note.id}`)).status).toBe(404);
  expect((await request("/api/notes", "POST", { body: "x".repeat(4001) })).status).toBe(400);
});
test("invocation copies binary metadata, concurrent retries keep one note and replay after lost reply", async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
  objects.set("imported", png);
  const id = Bun.randomUUIDv7();
  const files = [{ blob_key: "imported", name: "screenshot.png" }];
  const responses = await Promise.all([
    call("invoke", "create_note", { text: "Screenshot", lose_response_once: true }, id, files),
    call("invoke", "create_note", { text: "Screenshot", lose_response_once: true }, id, files),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 503]);
  const replay = await (
    await call("invoke", "create_note", { text: "Different retry" }, id, files)
  ).json();
  const notes = await service.dao.list();
  expect(notes.length).toBe(1);
  expect(notes[0].body).toBe("Screenshot");
  expect(replay.result.body).toBe("Screenshot");
  expect((await service.dao.attachments(notes[0].id))[0].content_type).toBe("image/png");
  expect(new Uint8Array(await (await request("/api/attachments/imported")).arrayBuffer())).toEqual(
    png,
  );
});
test("format failure rolls back the mutation and receipts replay without formatting", async () => {
  let empty = true;
  let executions = 0;
  const action = defineAction({
    name: "format_failure",
    description: "Test",
    read_only: false,
    markdown: "Test",
    validate: () => undefined,
    formatRequest: () => "Request",
    execute: async (service) => {
      executions++;
      return service.dao.create("Formatted");
    },
    formatResult: () => (empty ? " " : "Created"),
  });
  actions.set(action.name, action);
  try {
    const id = Bun.randomUUIDv7();
    expect((await call("invoke", action.name, {}, id)).status).toBe(503);
    expect(await service.dao.list()).toEqual([]);
    empty = false;
    const saved = await (await call("invoke", action.name, {}, id)).json();
    empty = true;
    expect(await (await call("invoke", action.name, {}, id)).json()).toEqual(saved);
    expect(executions).toBe(2);
  } finally {
    actions.delete(action.name);
  }
});
test("messaging forwards stable identities and blob references with configured destination", async () => {
  const payload = {
    request_id: Bun.randomUUIDv7(),
    content: "@reviewer Review",
    attachments: [{ blob_key: "file", name: "file.pdf" }],
  };
  expect((await request("/api/messaging", "POST", payload)).status).toBe(200);
  expect(messages).toEqual([{ ...payload, conversation_id: "conversation" }]);
});
test("migration checksum rejects edited history", async () => {
  await db`UPDATE schema_migrations SET checksum = 'changed' WHERE version = 1`;
  await expect(migrate(db)).rejects.toThrow("Migration changed");
  await db`UPDATE schema_migrations SET checksum = NULL WHERE version = 1`;
  await migrate(db);
});
test("action definitions require all presentation and execution handlers", () => {
  const definition: ActionDefinition<void, number> = {
    name: "example",
    description: "Example",
    read_only: true,
    markdown: "Help",
    validate: () => {},
    formatRequest: () => "Preview",
    execute: async () => 7,
    formatResult: String,
  };
  for (const key of ["validate", "formatRequest", "execute", "formatResult"] as const)
    expect(() =>
      defineAction({ ...definition, [key]: undefined } as unknown as typeof definition),
    ).toThrow();
  expect(() => defineAction({ ...definition, markdown: " " })).toThrow();
  const action = defineAction(definition);
  expect(() => registerActions([action, action])).toThrow("Duplicate");
});

test("malformed attachments are validation errors, not retryable storage failures", async () => {
  for (const file of [null, { name: 17 }, { name: "file", size_bytes: 1.5 }]) {
    const preview = await call("validate", "create_note", { text: "Note" }, undefined, [], [file]);
    expect(preview.status).toBe(200);
    expect((await preview.json()).errors.length).toBeGreaterThan(0);
    expect((await call("invoke", "create_note", { text: "Note" }, undefined, [file])).status).toBe(
      400,
    );
  }
});

test("startup discovers the next migration and rejects edits without losing saved data", async () => {
  const directory = await mkdtemp(tmpdir() + "/app-migrations-");
  const url = pathToFileURL(directory + "/");
  await cp(new URL("../backend/db/migrations/", import.meta.url), directory, { recursive: true });
  await Bun.write(
    new URL("004_probe.sql", url),
    "CREATE TABLE migration_probe (value text); INSERT INTO migration_probe VALUES ('preserved');",
  );
  try {
    await Promise.all([migrate(db, url), migrate(db, url)]);
    expect((await db`SELECT value FROM migration_probe`)[0].value).toBe("preserved");
    await Bun.write(new URL("004_probe.sql", url), "DROP TABLE migration_probe;");
    await expect(migrate(db, url)).rejects.toThrow("Migration changed");
    expect((await db`SELECT value FROM migration_probe`)[0].value).toBe("preserved");
  } finally {
    await db`DELETE FROM schema_migrations WHERE version = 4`;
    await db`DROP TABLE IF EXISTS migration_probe`;
    await rm(directory, { recursive: true, force: true });
  }
});
