-- Migrate user_media.id from UUID to TEXT
-- This converts the existing UUID column to TEXT to support business IDs

-- Step 1: Drop the old UUID primary key constraint
ALTER TABLE user_media DROP CONSTRAINT user_media_pkey;

-- Step 2: Alter the id column type from UUID to TEXT
ALTER TABLE user_media ALTER COLUMN id TYPE TEXT USING id::TEXT;

-- Step 3: Re-add the primary key constraint on the TEXT id column
ALTER TABLE user_media ADD PRIMARY KEY (id);
