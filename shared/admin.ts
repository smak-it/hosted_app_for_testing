export type NotesCounts = {
  note_count: number;
  attachment_count: number;
};

export type AdminOverview = NotesCounts & {
  version: string;
  rukie_user_id: string | null;
};

export type SampleNoteResult = NotesCounts & {
  note_id: number;
};
