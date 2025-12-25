-- Add last_synced_at column to repositories table
-- Tracks when repositories were last synced from GitHub

ALTER TABLE repositories
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;

-- Add index for faster queries on sync status
CREATE INDEX IF NOT EXISTS idx_repositories_last_synced_at ON repositories(last_synced_at);
