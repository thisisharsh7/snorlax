-- Add granular stage tracking to repositories table
-- Tracks current indexing stage for accurate frontend display

ALTER TABLE repositories
ADD COLUMN current_stage VARCHAR(50),
ADD COLUMN stage_started_at TIMESTAMP;

-- Add index for faster stage queries
CREATE INDEX IF NOT EXISTS idx_repositories_current_stage ON repositories(current_stage) WHERE current_stage IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN repositories.current_stage IS 'Current indexing stage: cloning, indexing_code, importing_issues, or NULL when complete';
COMMENT ON COLUMN repositories.stage_started_at IS 'When the current stage started';
