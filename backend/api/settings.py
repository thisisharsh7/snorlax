"""Settings management API endpoints."""

from fastapi import APIRouter, HTTPException
import os

from models.settings import SettingsRequest, SettingsResponse
from utils.database import get_db_connection

router = APIRouter(prefix="/api", tags=["settings"])


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

        # Update anthropic key if provided (and not masked)
        if settings.anthropic_api_key and not settings.anthropic_api_key.startswith('••'):
            cur.execute(
                """INSERT INTO settings (key, value, updated_at)
                   VALUES ('anthropic_api_key', %s, NOW())
                   ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = NOW()""",
                (settings.anthropic_api_key, settings.anthropic_api_key)
            )
            os.environ['ANTHROPIC_API_KEY'] = settings.anthropic_api_key

        # Update openai key if provided (and not masked)
        if settings.openai_api_key and not settings.openai_api_key.startswith('••'):
            cur.execute(
                """INSERT INTO settings (key, value, updated_at)
                   VALUES ('openai_api_key', %s, NOW())
                   ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = NOW()""",
                (settings.openai_api_key, settings.openai_api_key)
            )
            os.environ['OPENAI_API_KEY'] = settings.openai_api_key

        # Update openrouter key if provided (and not masked)
        if settings.openrouter_api_key and not settings.openrouter_api_key.startswith('••'):
            cur.execute(
                """INSERT INTO settings (key, value, updated_at)
                   VALUES ('openrouter_api_key', %s, NOW())
                   ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = NOW()""",
                (settings.openrouter_api_key, settings.openrouter_api_key)
            )
            os.environ['OPENROUTER_API_KEY'] = settings.openrouter_api_key

        # Update github token if provided (and not masked)
        if settings.github_token and not settings.github_token.startswith('••'):
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
