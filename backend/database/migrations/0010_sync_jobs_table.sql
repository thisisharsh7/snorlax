-- Migration: Add sync_jobs table for tracking background import progress
-- Date: 2026-01-23
-- Description: Enables progressive background import with priority-based fetching

CREATE TABLE IF NOT EXISTS sync_jobs (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL,
    job_type TEXT NOT NULL,  -- 'issues' or 'prs'
    status TEXT NOT NULL,     -- 'queued', 'in_progress', 'completed', 'failed'
    priority TEXT NOT NULL,   -- 'open' or 'closed'
    total_count INTEGER,
    imported_count INTEGER DEFAULT 0,
    current_batch INTEGER DEFAULT 0,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_sync_jobs_project_id ON sync_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_project_status ON sync_jobs(project_id, status);

-- Add composite index for queries filtering by project_id and job_type
CREATE INDEX IF NOT EXISTS idx_sync_jobs_project_type ON sync_jobs(project_id, job_type);
