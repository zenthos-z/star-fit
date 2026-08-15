-- 008: Drop the exercises vector-search infrastructure.
-- The agent now loads the whole exercise library in-context via the
-- list_exercises MCP tool; vector/semantic search is no longer used.
-- Idempotent. Table was empty at drop time — no data loss.
DROP INDEX IF EXISTS idx_exercises_embedding_hnsw;
ALTER TABLE exercises DROP COLUMN IF EXISTS embedding;
