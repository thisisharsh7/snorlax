"""Pydantic models for settings operations."""

from pydantic import BaseModel
from typing import Optional


class SettingsRequest(BaseModel):
    ai_provider: Optional[str] = "anthropic"
    anthropic_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    github_token: Optional[str] = None


class SettingsResponse(BaseModel):
    ai_provider: str
    anthropic_key_set: bool
    openai_key_set: bool
    openrouter_key_set: bool
    github_token_set: bool
