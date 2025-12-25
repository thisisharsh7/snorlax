-- Add last_synced_at column to repositories table
-- Run this with: psql $APP_DATABASE_URL -f migration_add_last_synced_at.sql

ALTER TABLE repositories
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_repositories_last_synced_at ON repositories(last_synced_at);

-- Show the updated table structure
\d repositories;
