"""Database helper functions."""

import os
import psycopg
import re
from contextlib import contextmanager
from typing import Generator


def get_db_connection():
    """Get database connection."""
    return psycopg.connect(os.getenv("APP_DATABASE_URL"))


@contextmanager
def get_db_connection_ctx() -> Generator[psycopg.Connection, None, None]:
    """
    Context manager for database connections.

    Ensures connections are properly closed even if exceptions occur.

    Usage:
        with get_db_connection_ctx() as conn:
            cur = conn.cursor()
            cur.execute("SELECT ...")
            # Connection automatically closed on exit
    """
    conn = None
    try:
        conn = get_db_connection()
        yield conn
    finally:
        if conn:
            conn.close()


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

        # Load AI provider
        cur.execute("SELECT value FROM settings WHERE key = 'ai_provider'")
        provider_result = cur.fetchone()
        if provider_result and provider_result[0]:
            os.environ['AI_PROVIDER'] = provider_result[0]

        # Load anthropic key
        cur.execute("SELECT value FROM settings WHERE key = 'anthropic_api_key'")
        anthropic_result = cur.fetchone()
        if anthropic_result and anthropic_result[0]:
            os.environ['ANTHROPIC_API_KEY'] = anthropic_result[0]

        # Load openai key
        cur.execute("SELECT value FROM settings WHERE key = 'openai_api_key'")
        openai_result = cur.fetchone()
        if openai_result and openai_result[0]:
            os.environ['OPENAI_API_KEY'] = openai_result[0]

        # Load openrouter key
        cur.execute("SELECT value FROM settings WHERE key = 'openrouter_api_key'")
        openrouter_result = cur.fetchone()
        if openrouter_result and openrouter_result[0]:
            os.environ['OPENROUTER_API_KEY'] = openrouter_result[0]

        # Load github token
        cur.execute("SELECT value FROM settings WHERE key = 'github_token'")
        github_result = cur.fetchone()
        if github_result and github_result[0]:
            os.environ['GITHUB_TOKEN'] = github_result[0]

        cur.close()
        conn.close()
    except Exception as e:
        print(f"Warning: Could not load settings from database: {e}")
