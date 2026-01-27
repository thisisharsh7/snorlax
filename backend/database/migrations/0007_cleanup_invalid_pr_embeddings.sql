-- Cleanup migration: Remove invalid PR embeddings
-- This removes PR embeddings that were incorrectly stored with issue_number instead of pr_number
-- This was caused by a bug in backend/services/ai/embeddings.py that has been fixed

-- Delete invalid PR embeddings (those with issue_number set when they should have pr_number set)
DELETE FROM issue_embeddings
WHERE type = 'pr' AND issue_number IS NOT NULL;

-- Note: After running this migration, PR embeddings will need to be regenerated
-- Run the embedding generation for any projects that had PRs indexed
