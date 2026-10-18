CREATE TABLE IF NOT EXISTS attachments (
    id text PRIMARY KEY,
    note_id bigint NOT NULL REFERENCES notes(id),
    filename text NOT NULL,
    content_type text NOT NULL,
    size bigint NOT NULL
);
INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;
