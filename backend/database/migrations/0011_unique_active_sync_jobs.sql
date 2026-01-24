-- Migration: Add unique constraint to prevent duplicate active sync jobs
-- Date: 2026-01-23
-- Description: Prevents multiple active (queued/in_progress) sync jobs for the same project
--              This is a partial unique index that only applies to active jobs,
--              allowing multiple completed jobs for historical tracking.

-- Prevent multiple active sync jobs for the same project
-- This is a "partial unique index" that only applies to queued/in_progress jobs
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_jobs_active_per_project
ON sync_jobs (project_id)
WHERE status IN ('queued', 'in_progress');

-- Note: This index allows multiple completed/failed jobs for the same project
-- (for historical record), but prevents duplicate active jobs.
