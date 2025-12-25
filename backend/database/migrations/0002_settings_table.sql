-- Settings table for application configuration
-- Stores API keys and other configuration values

CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

-- Insert default values (empty)
INSERT INTO settings (key, value)
VALUES ('anthropic_api_key', NULL)
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES ('github_token', NULL)
ON CONFLICT (key) DO NOTHING;
