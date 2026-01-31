-- Track sync progress per repository per state
-- This provides persistent tracking across multiple sync jobs

CREATE TABLE IF NOT EXISTS repository_sync_state (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES repositories(project_id) ON DELETE CASCADE,
    item_type VARCHAR(10) NOT NULL, -- 'issue' or 'pr'
    state VARCHAR(10) NOT NULL,     -- 'open' or 'closed'
    total_count INTEGER,             -- Total from GitHub API
    synced_count INTEGER DEFAULT 0,  -- How many we've synced
    last_synced_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Unique constraint: one row per (project, item_type, state) combination
    UNIQUE(project_id, item_type, state)
);

-- Index for fast lookups
CREATE INDEX idx_repo_sync_state_project ON repository_sync_state(project_id);

-- Add comments for clarity
COMMENT ON TABLE repository_sync_state IS 'Tracks sync progress per repository to detect when data is already fully synced';
COMMENT ON COLUMN repository_sync_state.total_count IS 'Total count from GitHub API (NULL if unknown)';
COMMENT ON COLUMN repository_sync_state.synced_count IS 'Number of items successfully synced so far';
COMMENT ON COLUMN repository_sync_state.last_synced_at IS 'Last time this category was synced (used for staleness checks)';
