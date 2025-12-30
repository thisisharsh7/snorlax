"""Pydantic models for query operations."""

from pydantic import BaseModel
from typing import List, Optional


class QueryRequest(BaseModel):
    question: str
    mode: Optional[str] = None  # 'search' or 'ai'


class Source(BaseModel):
    filename: str
    code: str
    language: str
    start_line: int
    end_line: int
    similarity: float


class QueryResponse(BaseModel):
    answer: Optional[str] = None
    sources: List[Source]
    mode: str = "full"  # "full" or "search_only"
    has_llm_answer: bool = True
    llm_error: Optional[str] = None
