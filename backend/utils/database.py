"""Database helper functions."""

import os
import psycopg
import re


def get_db_connection():
    """Get database connection."""
    return psycopg.connect(os.getenv("APP_DATABASE_URL"))


def extract_repo_name(github_url: str) -> str:
    """Extract repository name from GitHub URL."""
    # Match patterns like github.com/owner/repo or github.com/owner/repo.git
    match = re.search(r'github\.com[:/]([^/]+)/([^/\.]+)', github_url)
    if match:
        owner, repo = match.groups()
        return f"{owner}/{repo}"
    return "unknown"


def update_repository_status(project_id: str, status: str, error_message: str = None):
    """Update repository status in database with optional error message."""
    conn = get_db_connection()
    cur = conn.cursor()

    if error_message:
        cur.execute(
            """UPDATE repositories
               SET status = %s,
                   indexed_at = NOW(),
                   error_message = %s,
                   last_error_at = NOW()
               WHERE project_id = %s""",
            (status, error_message, project_id)
        )
    else:
        cur.execute(
            """UPDATE repositories
               SET status = %s,
                   indexed_at = NOW(),
                   error_message = NULL
               WHERE project_id = %s""",
            (status, project_id)
        )

    conn.commit()
    cur.close()
    conn.close()


def load_settings_from_db():
    """Load API keys from database and set environment variables."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Load anthropic key
        cur.execute("SELECT value FROM settings WHERE key = 'anthropic_api_key'")
        anthropic_result = cur.fetchone()
        if anthropic_result and anthropic_result[0]:
            os.environ['ANTHROPIC_API_KEY'] = anthropic_result[0]

        # Load github token
        cur.execute("SELECT value FROM settings WHERE key = 'github_token'")
        github_result = cur.fetchone()
        if github_result and github_result[0]:
            os.environ['GITHUB_TOKEN'] = github_result[0]

        cur.close()
        conn.close()
    except Exception as e:
        print(f"Warning: Could not load settings from database: {e}")
