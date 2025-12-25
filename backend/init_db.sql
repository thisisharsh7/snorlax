-- Create repositories tracking table
CREATE TABLE IF NOT EXISTS repositories (
    repo_url TEXT PRIMARY KEY,
    project_id TEXT UNIQUE NOT NULL,
    repo_name TEXT NOT NULL,
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'indexing' CHECK (status IN ('indexing', 'indexed', 'failed'))
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_repositories_project_id ON repositories(project_id);
CREATE INDEX IF NOT EXISTS idx_repositories_indexed_at ON repositories(indexed_at DESC);
