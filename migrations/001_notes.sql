CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    body text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
