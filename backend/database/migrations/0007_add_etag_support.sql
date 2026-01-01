-- Add ETag support for efficient GitHub sync
-- ETags allow conditional requests that don't count against rate limit

ALTER TABLE repositories
ADD COLUMN IF NOT EXISTS issues_etag TEXT;

ALTER TABLE repositories
ADD COLUMN IF NOT EXISTS prs_etag TEXT;

ALTER TABLE repositories
ADD COLUMN IF NOT EXISTS last_issues_sync TIMESTAMP;

ALTER TABLE repositories
ADD COLUMN IF NOT EXISTS last_prs_sync TIMESTAMP;

-- Add indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_repositories_last_issues_sync ON repositories(last_issues_sync);
CREATE INDEX IF NOT EXISTS idx_repositories_last_prs_sync ON repositories(last_prs_sync);
