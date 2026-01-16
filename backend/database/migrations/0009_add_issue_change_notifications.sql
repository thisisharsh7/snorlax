-- Migration 0009: Add PostgreSQL triggers for real-time issue/PR change notifications
-- This enables CocoIndex to automatically regenerate embeddings when data changes

-- ============================================================================
-- NOTIFICATION FUNCTIONS
-- ============================================================================

-- Function to notify when github_issues table changes
CREATE OR REPLACE FUNCTION notify_github_issues_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Send notification with project_id for selective listening
    PERFORM pg_notify(
        'github_issues_changed',
        json_build_object(
            'project_id', NEW.project_id,
            'issue_number', NEW.issue_number,
            'operation', TG_OP
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to notify when github_pull_requests table changes
CREATE OR REPLACE FUNCTION notify_github_prs_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Send notification with project_id for selective listening
    PERFORM pg_notify(
        'github_prs_changed',
        json_build_object(
            'project_id', NEW.project_id,
            'pr_number', NEW.pr_number,
            'operation', TG_OP
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Attach trigger to github_issues table
-- Fires AFTER each row is inserted or updated
DROP TRIGGER IF EXISTS github_issues_change_trigger ON github_issues;
CREATE TRIGGER github_issues_change_trigger
AFTER INSERT OR UPDATE ON github_issues
FOR EACH ROW
EXECUTE FUNCTION notify_github_issues_change();

-- Attach trigger to github_pull_requests table
-- Fires AFTER each row is inserted or updated
DROP TRIGGER IF EXISTS github_prs_change_trigger ON github_pull_requests;
CREATE TRIGGER github_prs_change_trigger
AFTER INSERT OR UPDATE ON github_pull_requests
FOR EACH ROW
EXECUTE FUNCTION notify_github_prs_change();

-- ============================================================================
-- COCOINDEX FLOWS TRACKING TABLE
-- ============================================================================

-- Table to track active CocoIndex flows per project
CREATE TABLE IF NOT EXISTS cocoindex_flows (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES repositories(project_id) ON DELETE CASCADE,
    flow_type TEXT NOT NULL CHECK (flow_type IN ('code', 'issues', 'prs')),
    enabled BOOLEAN DEFAULT TRUE,
    last_update TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    -- Ensure one flow per project per type
    UNIQUE(project_id, flow_type)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_cocoindex_flows_project_id ON cocoindex_flows(project_id);
CREATE INDEX IF NOT EXISTS idx_cocoindex_flows_enabled ON cocoindex_flows(enabled);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify triggers were created (run after migration)
-- SELECT tgname, tgtype, tgenabled FROM pg_trigger WHERE tgname LIKE '%github%';

-- Verify functions were created
-- SELECT proname, prosrc FROM pg_proc WHERE proname LIKE 'notify_github%';

-- Test notification manually (in separate sessions):
-- Session 1: LISTEN github_issues_changed;
-- Session 2: INSERT INTO github_issues (...) VALUES (...);
-- Session 1 should receive notification
