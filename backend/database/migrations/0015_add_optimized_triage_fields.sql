-- Migration: Add optimized triage format fields
-- This migration adds columns to store the new optimized triage format

-- Add new columns for optimized triage format
ALTER TABLE issue_categories
ADD COLUMN IF NOT EXISTS decision TEXT,
ADD COLUMN IF NOT EXISTS primary_message TEXT,
ADD COLUMN IF NOT EXISTS evidence_bullets TEXT[],
ADD COLUMN IF NOT EXISTS draft_response TEXT,
ADD COLUMN IF NOT EXISTS action_button_text TEXT,
ADD COLUMN IF NOT EXISTS action_button_style TEXT,
ADD COLUMN IF NOT EXISTS related_links JSONB;

-- Add comments
COMMENT ON COLUMN issue_categories.decision IS 'Optimized decision type (CLOSE_DUPLICATE, VALID_FEATURE, etc.)';
COMMENT ON COLUMN issue_categories.primary_message IS 'One-sentence explanation of the decision';
COMMENT ON COLUMN issue_categories.evidence_bullets IS 'Array of evidence points supporting the decision';
COMMENT ON COLUMN issue_categories.draft_response IS 'Draft response ready to post on GitHub';
COMMENT ON COLUMN issue_categories.action_button_text IS 'Text for the action button';
COMMENT ON COLUMN issue_categories.action_button_style IS 'Style for action button (danger, success, primary, warning)';
COMMENT ON COLUMN issue_categories.related_links IS 'JSON array of related links with text, url, and source';
