-- Add error_message column to repositories table
ALTER TABLE repositories
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Add last_error_at timestamp
ALTER TABLE repositories
ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMP;
