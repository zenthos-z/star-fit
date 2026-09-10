-- 009: Uninstall the pgvector extension entirely.
-- Preceded by 008, which dropped the exercises.embedding column and its HNSW
-- index. No vector column remains, so the extension only adds startup/resident
-- cost. Idempotent; CASCADE is unnecessary (nothing depends on it anymore).
DROP EXTENSION IF EXISTS vector;

-- Record migration
INSERT INTO migration_metadata (version, name, applied_at)
VALUES ('009', 'drop_pgvector_extension', NOW())
ON CONFLICT (version) DO NOTHING;
