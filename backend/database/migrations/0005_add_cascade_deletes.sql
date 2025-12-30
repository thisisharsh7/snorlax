-- Add CASCADE delete to foreign key constraints
-- This allows deleting repositories to automatically delete all related data

-- Drop and recreate github_issues foreign key with CASCADE
ALTER TABLE github_issues
DROP CONSTRAINT IF EXISTS github_issues_project_id_fkey;

ALTER TABLE github_issues
ADD CONSTRAINT github_issues_project_id_fkey
FOREIGN KEY (project_id) REFERENCES repositories(project_id)
ON DELETE CASCADE;

-- Drop and recreate github_pull_requests foreign key with CASCADE
ALTER TABLE github_pull_requests
DROP CONSTRAINT IF EXISTS github_pull_requests_project_id_fkey;

ALTER TABLE github_pull_requests
ADD CONSTRAINT github_pull_requests_project_id_fkey
FOREIGN KEY (project_id) REFERENCES repositories(project_id)
ON DELETE CASCADE;

-- Drop and recreate github_comments foreign key with CASCADE
ALTER TABLE github_comments
DROP CONSTRAINT IF EXISTS github_comments_project_id_fkey;

ALTER TABLE github_comments
ADD CONSTRAINT github_comments_project_id_fkey
FOREIGN KEY (project_id) REFERENCES repositories(project_id)
ON DELETE CASCADE;

-- Verify the constraints
SELECT
    conname AS constraint_name,
    conrelid::regclass AS table_name,
    confdeltype AS delete_action
FROM pg_constraint
WHERE conname LIKE '%project_id_fkey%';
