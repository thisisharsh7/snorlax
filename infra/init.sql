-- Create CocoIndex internal database
CREATE DATABASE cocoindex;

-- Create application database
CREATE DATABASE snorlax;

-- Connect to snorlax and enable pgvector
\c snorlax

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create projects table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_url TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    indexed_at TIMESTAMP,
    error_message TEXT
);

-- Create index on status for faster queries
CREATE INDEX idx_projects_status ON projects(status);
