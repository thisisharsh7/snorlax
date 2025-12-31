"""Settings management API endpoints."""

from fastapi import APIRouter, HTTPException
import os
from typing import Optional

from models.settings import SettingsRequest, SettingsResponse
from utils.database import get_db_connection

router = APIRouter(prefix="/api", tags=["settings"])


def determine_key_action(key_value: Optional[str]) -> str:
    """
    Determine what action to take for an API key.

    Args:
        key_value: The key value from the request

    Returns:
        'delete': User cleared the field (empty string)
        'update': User provided a new key (non-empty, not masked)
        'noop': User didn't change anything (None or masked)
    """
    if key_value is None:
        return 'noop'  # Field not included in request
    if key_value == "":
        return 'delete'  # User explicitly cleared the field
    if key_value.startswith('••'):
        return 'noop'  # Masked value, no change
    return 'update'  # New key provided


def process_api_key(cur, key_name: str, key_value: Optional[str], env_var_name: str):
    """
    Process an API key: delete, update, or skip.

    Args:
        cur: Database cursor
        key_name: Database key name (e.g., 'anthropic_api_key')
        key_value: Value from request
        env_var_name: Environment variable name (e.g., 'ANTHROPIC_API_KEY')
    """
    action = determine_key_action(key_value)

    if action == 'delete':
        # Delete from database (set to NULL)
        cur.execute(
            """INSERT INTO settings (key, value, updated_at)
               VALUES (%s, NULL, NOW())
               ON CONFLICT (key) DO UPDATE
               SET value = NULL, updated_at = NOW()""",
            (key_name,)
        )
        # Clear from environment
        if env_var_name in os.environ:
            del os.environ[env_var_name]

    elif action == 'update':
        # Update database with new key
        cur.execute(
            """INSERT INTO settings (key, value, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (key) DO UPDATE
               SET value = %s, updated_at = NOW()""",
            (key_name, key_value, key_value)
        )
        # Set in environment
        os.environ[env_var_name] = key_value

    # action == 'noop': do nothing


@router.get("/settings", response_model=SettingsResponse)
async def get_settings():
    """
    Get current settings status (without exposing actual keys).

    Returns:
        SettingsResponse with boolean flags indicating if keys are set
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Get AI provider
        cur.execute("SELECT value FROM settings WHERE key = 'ai_provider'")
        provider_result = cur.fetchone()
        ai_provider = provider_result[0] if provider_result and provider_result[0] else 'anthropic'

        # Check if keys are set (not null)
        cur.execute("SELECT value FROM settings WHERE key = 'anthropic_api_key'")
        anthropic_result = cur.fetchone()

        cur.execute("SELECT value FROM settings WHERE key = 'openai_api_key'")
        openai_result = cur.fetchone()

        cur.execute("SELECT value FROM settings WHERE key = 'openrouter_api_key'")
        openrouter_result = cur.fetchone()

        cur.execute("SELECT value FROM settings WHERE key = 'github_token'")
        github_result = cur.fetchone()

        cur.close()
        conn.close()

        return SettingsResponse(
            ai_provider=ai_provider,
            anthropic_key_set=bool(anthropic_result and anthropic_result[0]),
            openai_key_set=bool(openai_result and openai_result[0]),
            openrouter_key_set=bool(openrouter_result and openrouter_result[0]),
            github_token_set=bool(github_result and github_result[0])
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get settings: {str(e)}"
        )


@router.post("/settings")
async def save_settings(settings: SettingsRequest):
    """
    Save API settings (keys are stored securely in database).

    Args:
        settings: SettingsRequest with optional API keys

    Returns:
        Success message
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Import here to avoid circular dependency
        from services.github.api import GitHubService

        # Update AI provider
        if settings.ai_provider:
            cur.execute(
                """INSERT INTO settings (key, value, updated_at)
                   VALUES ('ai_provider', %s, NOW())
                   ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = NOW()""",
                (settings.ai_provider, settings.ai_provider)
            )
            os.environ['AI_PROVIDER'] = settings.ai_provider

        # Process all API keys uniformly
        process_api_key(cur, 'anthropic_api_key', settings.anthropic_api_key, 'ANTHROPIC_API_KEY')
        process_api_key(cur, 'openai_api_key', settings.openai_api_key, 'OPENAI_API_KEY')
        process_api_key(cur, 'openrouter_api_key', settings.openrouter_api_key, 'OPENROUTER_API_KEY')

        # GitHub token - special handling for service reinitialization
        action = determine_key_action(settings.github_token)
        if action == 'delete':
            cur.execute(
                """INSERT INTO settings (key, value, updated_at)
                   VALUES ('github_token', NULL, NOW())
                   ON CONFLICT (key) DO UPDATE SET value = NULL, updated_at = NOW()"""
            )
            if 'GITHUB_TOKEN' in os.environ:
                del os.environ['GITHUB_TOKEN']
            # Reinitialize GitHub service without token
            global github_service
            from api.github import github_service
            github_service = GitHubService(github_token=None)

        elif action == 'update':
            cur.execute(
                """INSERT INTO settings (key, value, updated_at)
                   VALUES ('github_token', %s, NOW())
                   ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = NOW()""",
                (settings.github_token, settings.github_token)
            )
            os.environ['GITHUB_TOKEN'] = settings.github_token
            # Reinitialize GitHub service with new token
            global github_service
            from api.github import github_service
            github_service = GitHubService(github_token=settings.github_token)

        conn.commit()
        cur.close()
        conn.close()

        return {"status": "success", "message": "Settings saved successfully"}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save settings: {str(e)}"
        )
