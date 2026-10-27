import type { SQL, TransactionSQL } from "bun";
import { NotesDao } from "../dao/notes";
import { BlobStorage, contentType } from "../integrations/blobs";
import { InputError } from "../domain/errors";
import { MAX_FILE_BYTES, type Attachment } from "../../shared/notes";
export class NotesService {
  readonly dao: NotesDao;
  constructor(
    readonly db: SQL | TransactionSQL,
    readonly blobs: BlobStorage,
  ) {
    this.dao = new NotesDao(db);
  }
  async transaction<T>(apply: (service: NotesService) => Promise<T>): Promise<T> {
    return (this.db as SQL).begin((tx) => apply(new NotesService(tx, this.blobs))) as Promise<T>;
  }
  async save(body: unknown, id?: number) {
    if (typeof body === "string") body = body.trim();
    if (typeof body !== "string" || !body.trim() || Buffer.byteLength(body) > 4000)
      throw new InputError("Write a note of at most 4000 bytes.");
    const note = id === undefined ? await this.dao.create(body) : await this.dao.update(id, body);
    if (!note) throw new InputError("Note not found.", 404);
    return note;
  }
  async upload(id: number, file: File) {
    if (!file.size || file.size > MAX_FILE_BYTES)
      throw new InputError("Upload one non-empty file up to 32 MiB.", 413);
    const data = new Uint8Array(await file.arrayBuffer());
    const item: Attachment = {
      id: Bun.randomUUIDv7(),
      note_id: id,
      filename: file.name,
      content_type: contentType(data),
      size: data.length,
    };
    await this.transaction(async (tx) => {
      if (!(await tx.dao.lock(id))) throw new InputError("Note not found.", 404);
      await tx.blobs.put(item.id, data);
      await tx.dao.addAttachment(item);
    });
    // Keep bytes on an ambiguous commit failure: they may belong to a saved note.
    return item;
  }
  async remove(id: number) {
    const files = await this.transaction(async (tx) => {
      if (!(await tx.dao.lock(id))) throw new InputError("Note not found.", 404);
      const files = await tx.dao.attachments(id);
      await tx.dao.remove(id);
      return files;
    });
    for (const file of files) await this.blobs.remove(file.id);
  }
  async removeAttachment(id: string) {
    if (!(await this.dao.removeAttachment(id)).length)
      throw new InputError("Attachment not found.", 404);
    await this.blobs.remove(id);
  }
  async createFromInvocation(text: string, attachments: { name: string; blob_key: string }[]) {
    const note = await this.dao.create(text);
    const seen = new Set<string>();
    const deadline = AbortSignal.timeout(15000);
    for (const file of attachments) {
      if (seen.has(file.blob_key)) continue;
      seen.add(file.blob_key);
      const metadata = await this.blobs.describe(file.blob_key, deadline);
      await this.dao.addAttachment({
        id: file.blob_key,
        note_id: note.id,
        filename: file.name,
        ...metadata,
      });
    }
    return note;
  }
}
