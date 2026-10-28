import type { SQL, TransactionSQL } from "bun";
import type { Note, Attachment } from "../../shared/notes";

type NoteRow = { id: string | number; body: string; updated_at: Date };
const note = (row: NoteRow): Note => ({
  ...row,
  id: Number(row.id),
  updated_at: row.updated_at.toISOString(),
});
const attachment = (row: Attachment): Attachment => ({
  ...row,
  note_id: Number(row.note_id),
  size: Number(row.size),
});
export class NotesDao {
  constructor(readonly db: SQL | TransactionSQL) {}
  async ready() {
    await this.db`
      SELECT 1
      FROM notes LIMIT 1
    `;
  }
  async list(): Promise<Note[]> {
    const rows: NoteRow[] = await this.db`
      SELECT id, body, updated_at
      FROM notes
      ORDER BY id DESC LIMIT 200
    `;
    return rows.map(note);
  }
  async get(id: number): Promise<Note | undefined> {
    const [row] = await this.db`
      SELECT id, body, updated_at
      FROM notes
      WHERE id = ${id}
    `;
    return row ? note(row) : undefined;
  }
  async lock(id: number) {
    const [row] = await this.db`
      SELECT id
      FROM notes
      WHERE id = ${id}
      FOR UPDATE
    `;
    return row;
  }
  async create(body: string): Promise<Note> {
    const [row] = await this.db`
      INSERT INTO notes (body)
      VALUES (${body})
      RETURNING id, body, updated_at
    `;
    return note(row);
  }
  async update(id: number, body: string): Promise<Note | undefined> {
    const [row] = await this.db`
      UPDATE notes
      SET body = ${body}, updated_at = now()
      WHERE id = ${id}
      RETURNING id, body, updated_at
    `;
    return row ? note(row) : undefined;
  }
  async attachments(id: number): Promise<Attachment[]> {
    const rows: Attachment[] = await this.db`
      SELECT id, note_id, filename, content_type, size
      FROM attachments
      WHERE note_id = ${id}
      ORDER BY id
    `;
    return rows.map(attachment);
  }
  async attachment(id: string): Promise<Attachment | undefined> {
    const [row] = await this.db`
      SELECT id, note_id, filename, content_type, size
      FROM attachments
      WHERE id = ${id}
    `;
    return row ? attachment(row) : undefined;
  }
  async addAttachment(file: Attachment) {
    await this.db`
      INSERT INTO attachments (id, note_id, filename, content_type, size)
      VALUES (${file.id}, ${file.note_id}, ${file.filename}, ${file.content_type}, ${file.size})
    `;
  }
  async remove(id: number) {
    await this.db`
      DELETE
      FROM attachments
      WHERE note_id = ${id}
    `;
    await this.db`
      DELETE
      FROM notes
      WHERE id = ${id}
    `;
  }
  async removeAttachment(id: string) {
    return this.db`
      DELETE
      FROM attachments
      WHERE id = ${id}
      RETURNING id
    `;
  }
}
