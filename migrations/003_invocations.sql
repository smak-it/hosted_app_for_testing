CREATE TABLE IF NOT EXISTS rukie_invocations (
    id text PRIMARY KEY,
    result jsonb NOT NULL
);
INSERT INTO schema_migrations (version) VALUES (3) ON CONFLICT DO NOTHING;
