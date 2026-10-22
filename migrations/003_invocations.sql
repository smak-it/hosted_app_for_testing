CREATE TABLE IF NOT EXISTS rukie_invocations (
    id text PRIMARY KEY,
    request_digest text NOT NULL,
    result jsonb NOT NULL
);
INSERT INTO schema_migrations (version) VALUES (3) ON CONFLICT DO NOTHING;
