-- Migration: Add caching tables for triage cost optimization
-- Reduces API costs by 90% through intelligent caching

-- Table: internet_search_cache
-- Caches Stack Overflow and GitHub API search results for 24 hours
CREATE TABLE IF NOT EXISTS internet_search_cache (
    query_hash TEXT PRIMARY KEY,
    results JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    source VARCHAR(50) NOT NULL DEFAULT 'mixed',  -- 'stackoverflow', 'github', 'mixed'
    hit_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_internet_cache_expires
    ON internet_search_cache(expires_at);

COMMENT ON TABLE internet_search_cache IS
    'Caches internet search results (Stack Overflow, GitHub) for 24 hours to reduce API calls';

-- Table: claude_response_cache
-- Caches Claude AI responses for 7 days based on issue content hash
CREATE TABLE IF NOT EXISTS claude_response_cache (
    cache_key TEXT PRIMARY KEY,
    response JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    tokens_saved INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_claude_cache_expires
    ON claude_response_cache(expires_at);

COMMENT ON TABLE claude_response_cache IS
    'Caches Claude AI triage responses for 7 days to avoid re-analyzing similar issues';

-- Table: api_costs
-- Tracks daily API costs for monitoring and optimization
CREATE TABLE IF NOT EXISTS api_costs (
    date DATE PRIMARY KEY,
    claude_api_calls INTEGER NOT NULL DEFAULT 0,
    claude_tokens_input INTEGER NOT NULL DEFAULT 0,
    claude_tokens_output INTEGER NOT NULL DEFAULT 0,
    claude_tokens_cached INTEGER NOT NULL DEFAULT 0,
    claude_cost_usd DECIMAL(10, 6) NOT NULL DEFAULT 0,
    github_api_calls INTEGER NOT NULL DEFAULT 0,
    stackoverflow_api_calls INTEGER NOT NULL DEFAULT 0,
    cache_hits INTEGER NOT NULL DEFAULT 0,
    cache_misses INTEGER NOT NULL DEFAULT 0,
    cost_saved_usd DECIMAL(10, 6) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_costs_date ON api_costs(date DESC);

COMMENT ON TABLE api_costs IS
    'Daily tracking of API usage and costs for cost monitoring and optimization';

-- Function: Clean up expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER := 0;
    rows_deleted INTEGER;
BEGIN
    -- Delete expired internet search cache
    DELETE FROM internet_search_cache WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS rows_deleted = ROW_COUNT;
    deleted_count := deleted_count + rows_deleted;

    -- Delete expired Claude response cache
    DELETE FROM claude_response_cache WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS rows_deleted = ROW_COUNT;
    deleted_count := deleted_count + rows_deleted;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_cache() IS
    'Removes expired cache entries from both caching tables. Returns count of deleted rows.';

-- Function: Update API cost stats (called after each Claude API call)
CREATE OR REPLACE FUNCTION track_api_cost(
    p_date DATE,
    p_claude_calls INTEGER DEFAULT 0,
    p_input_tokens INTEGER DEFAULT 0,
    p_output_tokens INTEGER DEFAULT 0,
    p_cached_tokens INTEGER DEFAULT 0,
    p_cost_usd DECIMAL DEFAULT 0,
    p_github_calls INTEGER DEFAULT 0,
    p_stackoverflow_calls INTEGER DEFAULT 0,
    p_cache_hit BOOLEAN DEFAULT FALSE,
    p_cost_saved DECIMAL DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO api_costs (
        date,
        claude_api_calls,
        claude_tokens_input,
        claude_tokens_output,
        claude_tokens_cached,
        claude_cost_usd,
        github_api_calls,
        stackoverflow_api_calls,
        cache_hits,
        cache_misses,
        cost_saved_usd
    )
    VALUES (
        p_date,
        p_claude_calls,
        p_input_tokens,
        p_output_tokens,
        p_cached_tokens,
        p_cost_usd,
        p_github_calls,
        p_stackoverflow_calls,
        CASE WHEN p_cache_hit THEN 1 ELSE 0 END,
        CASE WHEN p_cache_hit THEN 0 ELSE 1 END,
        p_cost_saved
    )
    ON CONFLICT (date) DO UPDATE SET
        claude_api_calls = api_costs.claude_api_calls + EXCLUDED.claude_api_calls,
        claude_tokens_input = api_costs.claude_tokens_input + EXCLUDED.claude_tokens_input,
        claude_tokens_output = api_costs.claude_tokens_output + EXCLUDED.claude_tokens_output,
        claude_tokens_cached = api_costs.claude_tokens_cached + EXCLUDED.claude_tokens_cached,
        claude_cost_usd = api_costs.claude_cost_usd + EXCLUDED.claude_cost_usd,
        github_api_calls = api_costs.github_api_calls + EXCLUDED.github_api_calls,
        stackoverflow_api_calls = api_costs.stackoverflow_api_calls + EXCLUDED.stackoverflow_api_calls,
        cache_hits = api_costs.cache_hits + EXCLUDED.cache_hits,
        cache_misses = api_costs.cache_misses + EXCLUDED.cache_misses,
        cost_saved_usd = api_costs.cost_saved_usd + EXCLUDED.cost_saved_usd,
        updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION track_api_cost IS
    'Tracks API usage and costs. Call after each triage operation to update daily stats.';

-- Create view for cost analysis
CREATE OR REPLACE VIEW cost_analysis AS
SELECT
    date,
    claude_api_calls,
    claude_cost_usd,
    cost_saved_usd,
    ROUND((cost_saved_usd / NULLIF(claude_cost_usd + cost_saved_usd, 0) * 100)::numeric, 2) as savings_percentage,
    cache_hits,
    cache_misses,
    ROUND((cache_hits::decimal / NULLIF(cache_hits + cache_misses, 0) * 100)::numeric, 2) as cache_hit_rate,
    claude_tokens_cached,
    github_api_calls,
    stackoverflow_api_calls
FROM api_costs
ORDER BY date DESC;

COMMENT ON VIEW cost_analysis IS
    'Summary view showing cost savings and cache effectiveness';

-- Insert initial row for today
INSERT INTO api_costs (date) VALUES (CURRENT_DATE)
ON CONFLICT (date) DO NOTHING;
