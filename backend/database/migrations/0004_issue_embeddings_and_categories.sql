-- Migration: Add issue embeddings and categorization tables
-- Created: 2025-12-29
-- Description: Tables for storing issue/PR embeddings and AI-powered categorization

-- Table to store embeddings for issues and PRs
CREATE TABLE IF NOT EXISTS issue_embeddings (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL,
    issue_number INTEGER,
    pr_number INTEGER,
    type TEXT NOT NULL CHECK (type IN ('issue', 'pr')),
    embedding vector(384), -- Same dimension as code embeddings (sentence-transformers/all-MiniLM-L6-v2)
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Ensure either issue_number or pr_number is set, not both
    CHECK (
        (type = 'issue' AND issue_number IS NOT NULL AND pr_number IS NULL) OR
        (type = 'pr' AND pr_number IS NOT NULL AND issue_number IS NULL)
    ),

    -- Unique constraint for issue embeddings
    CONSTRAINT unique_issue_embedding UNIQUE (project_id, type, issue_number),
    -- Unique constraint for PR embeddings
    CONSTRAINT unique_pr_embedding UNIQUE (project_id, type, pr_number),

    -- Foreign key to repositories table
    FOREIGN KEY (project_id) REFERENCES repositories(project_id) ON DELETE CASCADE
);

-- Create vector similarity index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_issue_embeddings_vector
ON issue_embeddings USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_issue_embeddings_project
ON issue_embeddings(project_id);

CREATE INDEX IF NOT EXISTS idx_issue_embeddings_type
ON issue_embeddings(type);


-- Table to store AI-powered categorization results
CREATE TABLE IF NOT EXISTS issue_categories (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('duplicate', 'implemented', 'fixed_in_pr', 'theme_cluster')),
    confidence FLOAT NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    reasoning TEXT NOT NULL, -- Full explanation from Claude

    -- Related entities (JSON format)
    related_issues INTEGER[] DEFAULT '{}', -- Array of issue numbers
    related_prs INTEGER[] DEFAULT '{}', -- Array of PR numbers
    related_files TEXT[] DEFAULT '{}', -- Array of file paths

    -- Theme cluster specific fields
    theme_name TEXT, -- For theme_cluster category
    theme_description TEXT, -- Detailed theme explanation

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Unique constraint: one category per issue
    CONSTRAINT unique_issue_category UNIQUE (project_id, issue_number, category),

    -- Foreign key to repositories table
    FOREIGN KEY (project_id) REFERENCES repositories(project_id) ON DELETE CASCADE
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_issue_categories_project
ON issue_categories(project_id);

CREATE INDEX IF NOT EXISTS idx_issue_categories_issue
ON issue_categories(project_id, issue_number);

CREATE INDEX IF NOT EXISTS idx_issue_categories_category
ON issue_categories(category);

CREATE INDEX IF NOT EXISTS idx_issue_categories_confidence
ON issue_categories(confidence);

-- Index for finding issues in a theme
CREATE INDEX IF NOT EXISTS idx_issue_categories_theme
ON issue_categories(theme_name) WHERE theme_name IS NOT NULL;
