-- Migration 005: Add UNIQUE constraint to user_media.hash
--
-- This migration adds a UNIQUE constraint to the `hash` field in the user_media table.
-- The `id` column contains the business identifier (timestamp_random format),
-- and the `hash` column contains the same value for flexibility.
-- The UNIQUE constraint ensures data integrity and allows for efficient lookups by hash.
--
-- Date: 2026-02-23
-- Context: Exercise information storage fix and data migration

-- Add UNIQUE constraint to hash field
ALTER TABLE user_media ADD CONSTRAINT user_media_hash_key UNIQUE (hash);

-- Create index for efficient hash lookups (if not already exists)
CREATE INDEX IF NOT EXISTS idx_user_media_hash ON user_media(hash);

-- Update table comments
COMMENT ON TABLE user_media IS 'User uploaded media files. Both id and hash contain the same business identifier (timestamp_random format).';
COMMENT ON COLUMN user_media.id IS 'Primary key: Business identifier (timestamp_random format) used as file identifier';
COMMENT ON COLUMN user_media.hash IS 'Hash: Same value as id, kept for flexibility and query compatibility';
