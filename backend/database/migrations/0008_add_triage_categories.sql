-- Migration: Add triage categories support
-- This migration extends the issue_categories table to support new triage-specific categories
-- and adds fields needed for the triage dashboard

-- Drop existing constraint if it exists
ALTER TABLE issue_categories
DROP CONSTRAINT IF EXISTS issue_categories_category_check;

-- Add new constraint with extended category options
ALTER TABLE issue_categories
ADD CONSTRAINT issue_categories_category_check
CHECK (category IN (
  -- Existing categories (keep for backward compatibility)
  'duplicate',
  'implemented',
  'fixed_in_pr',
  'theme_cluster',
  -- New triage categories
  'critical',         -- High priority issues (security, crashes, breaking)
  'bug',             -- Confirmed bugs
  'feature_request', -- New feature requests
  'question',        -- User questions
  'low_priority'     -- Spam, unclear, or very minor issues
));

-- Add triage-specific fields to issue_categories table
ALTER TABLE issue_categories
ADD COLUMN IF NOT EXISTS priority_score INTEGER DEFAULT 0;

ALTER TABLE issue_categories
ADD COLUMN IF NOT EXISTS needs_response BOOLEAN DEFAULT false;

ALTER TABLE issue_categories
ADD COLUMN IF NOT EXISTS doc_links TEXT[] DEFAULT '{}';

-- Add comment to explain the new fields
COMMENT ON COLUMN issue_categories.priority_score IS 'Priority score for triage (0-100, higher = more urgent)';
COMMENT ON COLUMN issue_categories.needs_response IS 'Whether this issue needs a human response';
COMMENT ON COLUMN issue_categories.doc_links IS 'Array of related documentation file paths';

-- Create index on priority_score for faster sorting
CREATE INDEX IF NOT EXISTS idx_issue_categories_priority
ON issue_categories(priority_score DESC);

-- Create index on needs_response for filtering
CREATE INDEX IF NOT EXISTS idx_issue_categories_needs_response
ON issue_categories(needs_response)
WHERE needs_response = true;
