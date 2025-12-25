-- Initial schema setup
-- Creates core tables for the application

-- Enable pgvector extension for vector embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Create projects table (CocoIndex internal tracking)
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_url TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    indexed_at TIMESTAMP,
    error_message TEXT
);

-- Create index on status for faster queries
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- Create repositories tracking table (application-level tracking)
CREATE TABLE IF NOT EXISTS repositories (
    repo_url TEXT PRIMARY KEY,
    project_id TEXT UNIQUE NOT NULL,
    repo_name TEXT NOT NULL,
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'indexing' CHECK (status IN ('indexing', 'indexed', 'failed'))
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_repositories_project_id ON repositories(project_id);
CREATE INDEX IF NOT EXISTS idx_repositories_indexed_at ON repositories(indexed_at DESC);
