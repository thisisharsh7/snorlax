-- GitHub integration tables
-- Creates tables for storing GitHub issues, pull requests, and comments

-- Issues table
CREATE TABLE IF NOT EXISTS github_issues (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES repositories(project_id),
    issue_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    state TEXT NOT NULL, -- 'open' or 'closed'
    author TEXT NOT NULL,
    labels TEXT[], -- Array of label names
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    closed_at TIMESTAMP,
    comments_count INTEGER DEFAULT 0,
    github_url TEXT NOT NULL,
    is_pull_request BOOLEAN DEFAULT FALSE,
    UNIQUE(project_id, issue_number)
);

-- Pull Requests table
CREATE TABLE IF NOT EXISTS github_pull_requests (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES repositories(project_id),
    pr_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    state TEXT NOT NULL, -- 'open', 'closed', or 'merged'
    author TEXT NOT NULL,
    labels TEXT[],
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    closed_at TIMESTAMP,
    merged_at TIMESTAMP,
    comments_count INTEGER DEFAULT 0,
    review_comments_count INTEGER DEFAULT 0,
    commits_count INTEGER DEFAULT 0,
    additions INTEGER DEFAULT 0,
    deletions INTEGER DEFAULT 0,
    changed_files INTEGER DEFAULT 0,
    github_url TEXT NOT NULL,
    head_branch TEXT,
    base_branch TEXT,
    mergeable BOOLEAN,
    UNIQUE(project_id, pr_number)
);

-- Comments table (for both issues and PRs)
CREATE TABLE IF NOT EXISTS github_comments (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES repositories(project_id),
    comment_id BIGINT UNIQUE NOT NULL,
    issue_number INTEGER,
    pr_number INTEGER,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    github_url TEXT NOT NULL
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_issues_project_state ON github_issues(project_id, state);
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON github_issues(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prs_project_state ON github_pull_requests(project_id, state);
CREATE INDEX IF NOT EXISTS idx_prs_created_at ON github_pull_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_issue ON github_comments(project_id, issue_number);
CREATE INDEX IF NOT EXISTS idx_comments_pr ON github_comments(project_id, pr_number);
