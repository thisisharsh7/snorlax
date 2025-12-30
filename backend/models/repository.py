"""Pydantic models for repository operations."""

from pydantic import BaseModel, HttpUrl
from typing import Optional


class IndexRequest(BaseModel):
    github_url: HttpUrl


class IndexResponse(BaseModel):
    project_id: str
    status: str
    message: str


class StatusResponse(BaseModel):
    status: str
    error_message: Optional[str] = None
    indexed_at: Optional[str] = None


class Repository(BaseModel):
    repo_url: str
    project_id: str
    repo_name: str
    indexed_at: str
    status: str
    last_synced_at: Optional[str] = None
