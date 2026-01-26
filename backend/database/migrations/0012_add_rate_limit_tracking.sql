-- Migration: Add rate limit tracking to sync_jobs
-- Date: 2026-01-26
-- Description: Adds fields to track when jobs are waiting for GitHub rate limit reset
--              This prevents endless polling when rate limited and provides clear user feedback

-- Add rate_limited flag to indicate job is waiting for rate limit reset
ALTER TABLE sync_jobs
ADD COLUMN IF NOT EXISTS rate_limited BOOLEAN DEFAULT FALSE;

-- Add rate_limit_reset_time to track when the rate limit will reset
ALTER TABLE sync_jobs
ADD COLUMN IF NOT EXISTS rate_limit_reset_time TIMESTAMP;

-- Add index for efficient queries on rate_limited status
CREATE INDEX IF NOT EXISTS idx_sync_jobs_rate_limited ON sync_jobs(rate_limited);

-- Add comment for documentation
COMMENT ON COLUMN sync_jobs.rate_limited IS 'Indicates job is waiting for GitHub API rate limit to reset';
COMMENT ON COLUMN sync_jobs.rate_limit_reset_time IS 'Timestamp when the GitHub API rate limit will reset (Unix epoch)';
