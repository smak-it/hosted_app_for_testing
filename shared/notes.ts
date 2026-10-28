export type Note = { id: number; body: string; updated_at: string };
export type Attachment = {
  id: string;
  note_id: number;
  filename: string;
  content_type: string;
  size: number;
};
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
